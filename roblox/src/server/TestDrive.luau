--!strict
-- Chunk-streaming test. With the Workspace attribute TestDrive = true, each player's character
-- is anchored at TestOriginX, waits for the ground around it to load, then is moved along +X at
-- TestSpeed studs/s for TestSeconds while loading stats are printed every 5 seconds. At the end
-- it stands still on the terrain next to a dropped block to measure physics jitter there.
-- With TestJitterSweep = true as well, it skips the drive and measures jitter at several distances.
-- With TestVehicle = true instead, it runs the physics car test (see TestVehicle).

local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage.Shared.World.Config)
local Heightfield = require(ReplicatedStorage.Shared.World.Heightfield)
local ChunkManager = require(script.Parent.ChunkManager)
local TestVehicle = require(script.Parent.TestVehicle)

local TestDrive = {}

local LOG_SECONDS = 5
local NEAR_STUDS = 1024
local ROOT_HEIGHT = 4 -- HumanoidRootPart centre above the ground for a standing character
local SETTLE_SECONDS = 3
local SAMPLE_SECONDS = 5

local function attribute(name: string, default: number): number
	local value = workspace:GetAttribute(name)
	return if typeof(value) == "number" then value else default
end

local function fmt(n: number): string
	return string.format("%.1f", n)
end

-- Spacing between neighbouring 32-bit float values at this coordinate (Roblox stores positions as floats).
local function floatStep(x: number): number
	return 2 ^ (math.floor(math.log(math.max(math.abs(x), 1), 2)) - 23)
end

-- Vibration: mean size of the frame-to-frame change in motion (zero for smooth sliding, large for
-- shaking back and forth). Net: distance between the first and last sample (slow sliding/settling).
local function motion(samples: { Vector3 }): (number, number)
	local vibration, n = 0, 0
	for i = 3, #samples do
		vibration += ((samples[i] - samples[i - 1]) - (samples[i - 1] - samples[i - 2])).Magnitude
		n += 1
	end
	return if n > 0 then vibration / n else 0, (samples[#samples] - samples[1]).Magnitude
end

local function measureJitter(character: Model, root: BasePart, x: number, z: number): (number, number)
	local block = Instance.new("Part")
	block.Name = "JitterProbe"
	block.Size = Vector3.new(4, 4, 4)
	block.CustomPhysicalProperties = PhysicalProperties.new(2, 2, 0, 100, 1)
	block.Position = Vector3.new(x + 12, Heightfield.studsAt(x + 12, z) + 6, z)
	block.Parent = workspace
	root.Anchored = false

	task.wait(SETTLE_SECONDS)
	local blockSamples, rootSamples = {}, {}
	local started = os.clock()
	while os.clock() - started < SAMPLE_SECONDS do
		table.insert(blockSamples, block.Position)
		table.insert(rootSamples, root.Position)
		RunService.Heartbeat:Wait()
	end
	local blockShake, blockNet = motion(blockSamples)
	local rootShake, rootNet = motion(rootSamples)
	print(`[TestDrive] jitter at x={math.floor(x)}: float step {floatStep(x)} studs | block vibration {string.format("%.4f", blockShake)}, net {string.format("%.4f", blockNet)} | character vibration {string.format("%.4f", rootShake)}, net {string.format("%.4f", rootNet)} (studs, {SAMPLE_SECONDS}s at rest)`)
	block:Destroy()
	return blockShake, rootShake
end

local SWEEP_X = { 160000, 240000, 320000, 480000, 640000, 1000000 }

-- Whether there is solid terrain under a point (terrain writes may stop working far from the origin).
local function groundBelow(x: number, z: number): boolean
	local params = RaycastParams.new()
	params.FilterType = Enum.RaycastFilterType.Include
	params.FilterDescendantsInstances = { workspace.Terrain }
	return workspace:Raycast(Vector3.new(x, Config.RAY_TOP_STUDS, z), Vector3.new(0, -2 * Config.RAY_TOP_STUDS, 0), params) ~= nil
end

-- Jitter only (Workspace attribute TestJitterSweep = true): stands the character at each distance
-- from the centre in turn, once its ground has loaded, and measures drift at rest there.
local function sweep(character: Model, root: BasePart)
	local z = 0
	local rows = {}
	for _, x in SWEEP_X do
		root.Anchored = true
		local position = Vector3.new(x, Heightfield.studsAt(x, z) + ROOT_HEIGHT, z)
		character:PivotTo(CFrame.lookAt(position, position + Vector3.xAxis))
		while ChunkManager.missingWithin(position, 512) > 0 do
			task.wait(0.1)
		end
		local ground = groundBelow(x, z)
		local blockShake, rootShake = measureJitter(character, root, x, z)
		table.insert(rows, `x={x}: ground {ground}, block {string.format("%.4f", blockShake)}, character {string.format("%.4f", rootShake)}`)
	end
	print(`[TestDrive] SWEEP vibration {table.concat(rows, " | ")}`)
	character:SetAttribute("TestDriveDone", true)
end

local function run(character: Model)
	local root = character:WaitForChild("HumanoidRootPart") :: BasePart
	if workspace:GetAttribute("TestVehicle") == true then
		TestVehicle.run(character, root)
		return
	end
	if workspace:GetAttribute("TestJitterSweep") == true then
		sweep(character, root)
		return
	end
	local originX = attribute("TestOriginX", Config.TEST_ORIGIN_X)
	local speed = attribute("TestSpeed", Config.TEST_SPEED_STUDS)
	local seconds = attribute("TestSeconds", Config.TEST_SECONDS)
	local z = 0
	local x = originX

	local function place(atX: number)
		local position = Vector3.new(atX, Heightfield.studsAt(atX, z) + ROOT_HEIGHT, z)
		character:PivotTo(CFrame.lookAt(position, position + Vector3.xAxis))
	end

	root.Anchored = true
	place(x)
	print(`[TestDrive] start at x={originX}, {speed} studs/s for {seconds}s, {Config.WORKERS} workers`)

	local waitStart = os.clock()
	while ChunkManager.missingWithin(root.Position, NEAR_STUDS) > 0 do
		task.wait(0.1)
	end
	local spawnSeconds = os.clock() - waitStart
	local initial = ChunkManager.takeStats()
	print(`[TestDrive] spawn area ({NEAR_STUDS}-stud radius) ready in {fmt(spawnSeconds)}s; {initial.built} chunks, build {fmt(initial.buildMean)} ms mean / {fmt(initial.buildMax)} max, write {fmt(initial.writeMean)} / {fmt(initial.writeMax)} ms`)

	local totals = { built = 0, buildMs = 0, writeMs = 0, buildMax = 0, writeMax = 0, minLead = math.huge, maxMissing = 0, minFps = math.huge, frameMax = 0 }
	local driveStart = os.clock()
	local lastLog = driveStart
	local connection: RBXScriptConnection
	connection = RunService.Heartbeat:Connect(function(dt: number)
		x += speed * dt
		place(x)
		local lead = ChunkManager.leadAlong(root.Position, Vector3.xAxis, Config.LOAD_RADIUS_STUDS)
		local missing = ChunkManager.missingWithin(root.Position, NEAR_STUDS)
		totals.minLead = math.min(totals.minLead, lead)
		totals.maxMissing = math.max(totals.maxMissing, missing)

		local now = os.clock()
		local finished = now - driveStart >= seconds
		if now - lastLog >= LOG_SECONDS or finished then
			lastLog = now
			local s = ChunkManager.takeStats()
			totals.built += s.built
			totals.buildMs += s.buildMean * s.built
			totals.writeMs += s.writeMean * s.built
			totals.buildMax = math.max(totals.buildMax, s.buildMax)
			totals.writeMax = math.max(totals.writeMax, s.writeMax)
			totals.minFps = math.min(totals.minFps, s.fps)
			totals.frameMax = math.max(totals.frameMax, s.frameMaxMs)
			print(`[TestDrive] t={math.floor(now - driveStart)}s x={math.floor(x)} | built {s.built} ({fmt(s.built / s.seconds)}/s) build {fmt(s.buildMean)}/{fmt(s.buildMax)} ms, write {fmt(s.writeMean)}/{fmt(s.writeMax)} ms | unloaded {s.unloaded} ({fmt(s.unloadMean)} ms) | loaded {s.loaded}, pending {s.pending} | lead {math.floor(lead)} studs, missing<{NEAR_STUDS}: {missing} | server {fmt(s.fps)} fps, worst frame {fmt(s.frameMaxMs)} ms`)
		end
		if finished then
			connection:Disconnect()
			local n = math.max(totals.built, 1)
			print(`[TestDrive] SUMMARY {math.floor(x - originX)} studs in {seconds}s: {totals.built} chunks ({fmt(totals.built / seconds)}/s), build {fmt(totals.buildMs / n)} mean / {fmt(totals.buildMax)} max ms, write {fmt(totals.writeMs / n)} mean / {fmt(totals.writeMax)} max ms; lowest lead {math.floor(totals.minLead)} studs (of {Config.LOAD_RADIUS_STUDS}), most missing within {NEAR_STUDS}: {totals.maxMissing}; lowest server fps {fmt(totals.minFps)}, worst frame {fmt(totals.frameMax)} ms`)
			task.spawn(function()
				measureJitter(character, root, x, z)
				print("[TestDrive] done. Look around: does the character, block or terrain shimmer or shake?")
				character:SetAttribute("TestDriveDone", true)
			end)
		end
	end)
end

function TestDrive.start()
	if workspace:GetAttribute("TestDrive") ~= true then
		return
	end
	local function onPlayer(player: Player)
		player.CharacterAdded:Connect(run)
		if player.Character then
			task.spawn(run, player.Character)
		end
	end
	Players.PlayerAdded:Connect(onPlayer)
	for _, player in Players:GetPlayers() do
		onPlayer(player)
	end
end

return TestDrive
