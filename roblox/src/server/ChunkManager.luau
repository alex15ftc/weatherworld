--!strict
-- Minecraft-style chunk streaming: keeps terrain loaded within LOAD_RADIUS_STUDS of every
-- player's character, nearest chunks first, and clears chunks beyond the radius plus a margin.
-- Each chunk's props (trees, buildings) live in a folder named by its key under Workspace.WorldProps.

local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local ServerScriptService = game:GetService("ServerScriptService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage.Shared.World.Config)
local ChunkGen = require(ReplicatedStorage.Shared.World.ChunkGen)

local ChunkManager = {}

local SIZE = Config.CHUNK_STUDS
local VOXEL = Config.VOXEL_STUDS
local REFRESH_SECONDS = 0.25

type Loaded = { cx: number, cz: number, yMin: number, yMax: number }
type Want = { cx: number, cz: number, d2: number }

local terrain = workspace.Terrain
local propsRoot = workspace:FindFirstChild("WorldProps") or Instance.new("Folder")
propsRoot.Name = "WorldProps"
propsRoot.Parent = workspace
local loaded: { [string]: Loaded } = {}
local inFlight: { [string]: boolean } = {}
local loadedCount = 0
local pending: { Want } = {}
local idleActors: { Actor } = {}

local function newWindow()
	return { built = 0, buildMs = 0, buildMax = 0, writeMs = 0, writeMax = 0, unloaded = 0, unloadMs = 0, frames = 0, frameMax = 0, startedAt = os.clock() }
end

-- Timings for the current stats window, reset by takeStats().
local window = newWindow()

local function record(buildMs: number, writeMs: number)
	window.built += 1
	window.buildMs += buildMs
	window.buildMax = math.max(window.buildMax, buildMs)
	window.writeMs += writeMs
	window.writeMax = math.max(window.writeMax, writeMs)
end

local function markLoaded(cx: number, cz: number, yMin: number, yMax: number)
	local key = ChunkGen.key(cx, cz)
	inFlight[key] = nil
	if not loaded[key] then
		loadedCount += 1
	end
	loaded[key] = { cx = cx, cz = cz, yMin = yMin, yMax = yMax }
end

local function unload(key: string, chunk: Loaded)
	local t0 = os.clock()
	local x0, z0 = chunk.cx * SIZE, chunk.cz * SIZE
	local region = Region3.new(Vector3.new(x0, chunk.yMin, z0), Vector3.new(x0 + SIZE, chunk.yMax, z0 + SIZE))
	terrain:FillRegion(region, VOXEL, Enum.Material.Air)
	local props = propsRoot:FindFirstChild(key)
	if props then
		props:Destroy()
	end
	loaded[key] = nil
	loadedCount -= 1
	window.unloaded += 1
	window.unloadMs += (os.clock() - t0) * 1000
end

local function playerPositions(): { Vector3 }
	local positions = {}
	for _, player in Players:GetPlayers() do
		local character = player.Character
		local root = if character then character:FindFirstChild("HumanoidRootPart") :: BasePart? else nil
		if root then
			table.insert(positions, root.Position)
		end
	end
	return positions
end

local function refresh()
	local wanted: { [string]: Want } = {}
	local keep: { [string]: boolean } = {}
	local r = Config.LOAD_RADIUS_STUDS / SIZE
	local rKeep = (Config.LOAD_RADIUS_STUDS + Config.UNLOAD_MARGIN_STUDS) / SIZE
	for _, p in playerPositions() do
		local pcx, pcz = p.X / SIZE, p.Z / SIZE
		for cx = math.floor(pcx - rKeep), math.floor(pcx + rKeep) do
			for cz = math.floor(pcz - rKeep), math.floor(pcz + rKeep) do
				local dx, dz = cx + 0.5 - pcx, cz + 0.5 - pcz
				local d2 = dx * dx + dz * dz
				local key = ChunkGen.key(cx, cz)
				if d2 <= rKeep * rKeep then
					keep[key] = true
				end
				if d2 <= r * r then
					local want = wanted[key]
					if not want or d2 < want.d2 then
						wanted[key] = { cx = cx, cz = cz, d2 = d2 }
					end
				end
			end
		end
	end

	for key, chunk in loaded do
		if not keep[key] then
			unload(key, chunk)
		end
	end

	pending = {}
	for key, want in wanted do
		if not loaded[key] and not inFlight[key] then
			table.insert(pending, want)
		end
	end
	table.sort(pending, function(a, b)
		return a.d2 > b.d2 -- nearest last, so table.remove pops it
	end)
end

local function dispatchParallel()
	while #idleActors > 0 and #pending > 0 do
		local want = table.remove(pending) :: Want
		local actor = table.remove(idleActors) :: Actor
		inFlight[ChunkGen.key(want.cx, want.cz)] = true
		actor:SendMessage("Build", want.cx, want.cz)
	end
end

local function buildSerial()
	local deadline = os.clock() + Config.SERIAL_BUDGET_MS / 1000
	while #pending > 0 and os.clock() < deadline do
		local want = table.remove(pending) :: Want
		local t0 = os.clock()
		ChunkGen.prepare(want.cx, want.cz)
		local chunk = ChunkGen.build(want.cx, want.cz)
		local t1 = os.clock()
		terrain:WriteVoxels(chunk.region, VOXEL, chunk.materials, chunk.occupancy)
		ChunkGen.place(chunk.props, propsRoot, ChunkGen.key(want.cx, want.cz))
		record((t1 - t0) * 1000, (os.clock() - t1) * 1000)
		markLoaded(want.cx, want.cz, chunk.yMin, chunk.yMax)
	end
end

local function startWorkers(template: Actor)
	local folder = Instance.new("Folder")
	folder.Name = "ChunkWorkers"
	local done = Instance.new("BindableEvent")
	done.Name = "ChunkDone"
	done.Parent = folder
	folder.Parent = ServerScriptService

	done.Event:Connect(function(actor: Actor, cx: number, cz: number, yMin: number, yMax: number, buildMs: number, writeMs: number)
		record(buildMs, writeMs)
		markLoaded(cx, cz, yMin, yMax)
		table.insert(idleActors, actor)
	end)

	for i = 1, Config.WORKERS do
		local actor = template:Clone()
		actor.Name = `ChunkWorker{i}`
		actor.Parent = folder
		actor:GetAttributeChangedSignal("Ready"):Once(function()
			table.insert(idleActors, actor)
		end)
		local worker = actor:FindFirstChild("Worker") :: Script
		worker.Enabled = true
	end
end

function ChunkManager.start(template: Actor)
	if Config.WORKERS > 0 then
		startWorkers(template)
	end
	local sinceRefresh = math.huge
	RunService.Heartbeat:Connect(function(dt: number)
		window.frames += 1
		window.frameMax = math.max(window.frameMax, dt)
		sinceRefresh += dt
		if sinceRefresh >= REFRESH_SECONDS then
			sinceRefresh = 0
			refresh()
		end
		if Config.WORKERS > 0 then
			dispatchParallel()
		else
			buildSerial()
		end
	end)
end

function ChunkManager.isLoadedAt(x: number, z: number): boolean
	return loaded[ChunkGen.key(math.floor(x / SIZE), math.floor(z / SIZE))] ~= nil
end

-- Number of chunks within radius of a point that are not loaded yet.
function ChunkManager.missingWithin(position: Vector3, radius: number): number
	local missing = 0
	local pcx, pcz, r = position.X / SIZE, position.Z / SIZE, radius / SIZE
	for cx = math.floor(pcx - r), math.floor(pcx + r) do
		for cz = math.floor(pcz - r), math.floor(pcz + r) do
			local dx, dz = cx + 0.5 - pcx, cz + 0.5 - pcz
			if dx * dx + dz * dz <= r * r and not loaded[ChunkGen.key(cx, cz)] then
				missing += 1
			end
		end
	end
	return missing
end

-- How far ahead along a direction the terrain is loaded without a gap (capped at maxDistance).
function ChunkManager.leadAlong(position: Vector3, direction: Vector3, maxDistance: number): number
	for d = 0, maxDistance, SIZE / 4 do
		local p = position + direction * d
		if not ChunkManager.isLoadedAt(p.X, p.Z) then
			return d
		end
	end
	return maxDistance
end

export type Stats = {
	seconds: number,
	built: number,
	buildMean: number,
	buildMax: number,
	writeMean: number,
	writeMax: number,
	unloaded: number,
	unloadMean: number,
	fps: number,
	frameMaxMs: number,
	loaded: number,
	pending: number,
}

function ChunkManager.takeStats(): Stats
	local w = window
	local seconds = os.clock() - w.startedAt
	window = newWindow()
	return {
		seconds = seconds,
		built = w.built,
		buildMean = if w.built > 0 then w.buildMs / w.built else 0,
		buildMax = w.buildMax,
		writeMean = if w.built > 0 then w.writeMs / w.built else 0,
		writeMax = w.writeMax,
		unloaded = w.unloaded,
		unloadMean = if w.unloaded > 0 then w.unloadMs / w.unloaded else 0,
		fps = if seconds > 0 then w.frames / seconds else 0,
		frameMaxMs = w.frameMax * 1000,
		loaded = loadedCount,
		pending = #pending,
	}
end

return ChunkManager
