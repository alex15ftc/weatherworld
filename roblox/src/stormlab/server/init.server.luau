--!nonstrict
-- Storm lab server (roblox/src/stormlab; docs/stormlab/ARCHITECTURE.md). Server-authoritative
-- simulation (guide section 8): it owns the atmosphere (Sim/World), the test town's damage, the
-- vehicles and the debris record, and replicates compact state; clients render.
--   every frame       World.stepFast (tornadoes), vehicles, debris, town damage
--   in the background World.stepSlow in a coroutine with a time budget per frame (it pauses
--                     itself at World.pause points), so storms, rain and cold pools never stall
--                     the tornado
--   replication       tornadoes 15 Hz, world 2 Hz, profiles on change, cold pool / rain volume
--                     every 10 s, flashes and events as they happen
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local Workspace = game:GetService("Workspace")

local lab = ReplicatedStorage:WaitForChild("StormLab")
local Sim = lab:WaitForChild("Sim")
local LabConfig = require(lab:WaitForChild("LabConfig"))
local Json = require(Sim:WaitForChild("Json"))
local World = require(Sim:WaitForChild("World"))
local Storm = require(Sim:WaitForChild("Storm"))
local Town = require(script:WaitForChild("Town"))
local Vehicles = require(script:WaitForChild("Vehicles"))
local ServerDebris = require(script:WaitForChild("ServerDebris"))
local VisualTests = require(lab:WaitForChild("VisualTests"))

Players.CharacterAutoLoads = false
Workspace.Gravity = 9.81 -- 1 stud = 1 m

-- the cloud kit's uploaded meshes (ReplicatedStorage.CloudKitMeshes) for the cloud renderer
do
	local shared = ReplicatedStorage:FindFirstChild("Shared")
	local weather = shared and shared:FindFirstChild("Weather")
	local kit = weather and weather:FindFirstChild("CloudKit")
	if kit then
		local ok, err = pcall(function()
			require(kit).serverLoad(LabConfig.CLOUD_KIT_ASSET)
		end)
		if not ok then
			warn("[StormLab] cloud kit: " .. tostring(err))
		end
	end
end

-- remotes
local net = Instance.new("Folder")
net.Name = LabConfig.NET_FOLDER
local R = LabConfig.REMOTES
local remotes = {}
for key, name in R do
	local inst
	if key == "tornado" then
		inst = Instance.new("UnreliableRemoteEvent")
	elseif key == "hello" then
		inst = Instance.new("RemoteFunction")
	else
		inst = Instance.new("RemoteEvent")
	end
	inst.Name = name
	inst.Parent = net
	remotes[key] = inst
end
net.Parent = ReplicatedStorage

-- clients that have said hello (their listeners are connected): only they get broadcasts
local joined: { [Player]: boolean } = {}
local function broadcast(remote: any, ...)
	for p in joined do
		if p.Parent then
			remote:FireClient(p, ...)
		else
			joined[p] = nil
		end
	end
end

local settings = {
	timeScale = LabConfig.DEFAULT_TIME_SCALE,
	paused = false,
	genesis = true,
	initiation = true,
}

local scenarioName = Workspace:GetAttribute("StormLabScenario") or LabConfig.DEFAULT_SCENARIO
local world: any = nil
local data: any = nil
local town: any = nil
local vehicles = Vehicles.new(Workspace)
local debris = ServerDebris.new(function(e)
	broadcast(remotes.event, e)
end)
local ready = false
local profileSeen = {}

local function log(fmt: string, ...)
	print("[StormLab] " .. string.format(fmt, ...))
end

-- Where to put the town: on the engine's own tornado track (the scenario's `track`) a few
-- minutes into its life, else ahead of the focus storm.
local function townSite(): (number, number, number)
	for _, p in data.track or {} do
		if p.tornado then
			local nx = data.track[math.min(#data.track, (table.find(data.track, p) or 1) + 2)]
			local bearing = 0
			if nx and nx.tornado then
				bearing = math.atan2(nx.tornado.pos[2] - p.tornado.pos[2], nx.tornado.pos[1] - p.tornado.pos[1])
			end
			return p.tornado.pos[1], p.tornado.pos[2], bearing
		end
	end
	for _, s in world.storms do
		if s.engineId == data.meta.focusStorm then
			return s.x + s.u * 2400, s.y + s.v * 2400, math.atan2(s.v, s.u)
		end
	end
	return 0, 0, 0
end

local function placeTown(x: number, y: number, bearing: number)
	if town then
		town:destroy()
	end
	vehicles:clear()
	debris:clear()
	town = Town.new(x, y, bearing, 7)
	-- cars and pickups parked along the main street
	local cb, sb = math.cos(bearing), math.sin(bearing)
	for i = 1, 10 do
		local dx = (i - 5.5) * 52
		local dy = if i % 2 == 0 then 6 else -6
		local px, py = x + dx * cb - dy * sb, y + dx * sb + dy * cb
		vehicles:add(if i % 3 == 0 then "pickup" else "car", px, py, bearing, i)
	end
	world.groundFn = function(gx, gy)
		return town:groundAt(gx, gy)
	end
	log("town of %d structures at (%.1f, %.1f) km", #town.structures, x / 1000, y / 1000)
	broadcast(remotes.event, { kind = "town", x = x, y = y, bearing = bearing })
end

local function loadScenario(name: string)
	ready = false
	local module = lab.Data:FindFirstChild(name)
	if not module then
		warn("[StormLab] no scenario " .. name)
		return
	end
	local t0 = os.clock()
	data = Json.decode(require(module))
	world = World.new(data)
	world.genesis = settings.genesis
	world.initiation = settings.initiation
	world:spinUp(LabConfig.SPIN_UP_SECONDS)
	profileSeen = {}
	scenarioName = name
	log("scenario %s (seed %d, %s UTC %.2f): %d storms, spun up in %.1f s", name, data.meta.seed, data.meta.focus, data.meta.simHourUtc, #world.storms, os.clock() - t0)
	placeTown(townSite())
	ready = true
end

loadScenario(scenarioName)

remotes.hello.OnServerInvoke = function(player)
	while not ready do
		task.wait(0.2)
	end
	-- (the newcomer gets the full state once its listeners are connected: the "ready" command)
	return { scenario = scenarioName, time = world.time, settings = settings }
end

-- the strongest live tornado, or nil
local function strongestTornado()
	local best
	for _, t in world.tornadoes do
		if not t.ended and (not best or t.vc > best.vc) then
			best = t
		end
	end
	return best
end

local function stormById(id: string?)
	for _, s in world.storms do
		if s.id == id then
			return s
		end
	end
	return nil
end

remotes.command.OnServerEvent:Connect(function(player, cmd)
	if type(cmd) ~= "table" or not ready then
		return
	end
	local c = cmd.cmd
	if c == "ready" then
		-- the client's listeners are connected: from now on it gets broadcasts, and the full state
		joined[player] = true
		remotes.profiles:FireClient(player, world:profileSnapshot({}))
		remotes.state:FireClient(player, world:snapshot(), settings)
		remotes.coldPool:FireClient(player, world:packColdPool())
		remotes.precip:FireClient(player, world.precip:pack())
		if town then
			remotes.event:FireClient(player, { kind = "town", x = town.cx, y = town.cy })
		end
		return
	end
	if c == "timeScale" then
		settings.timeScale = math.clamp(tonumber(cmd.value) or 1, 0.1, 120)
	elseif c == "pause" then
		settings.paused = not settings.paused
	elseif c == "scenario" and type(cmd.name) == "string" then
		loadScenario(cmd.name)
		broadcast(remotes.event, { kind = "scenario", scenario = scenarioName })
		task.wait()
		broadcast(remotes.profiles, world:profileSnapshot(profileSeen))
		broadcast(remotes.coldPool, world:packColdPool())
		broadcast(remotes.precip, world.precip:pack())
	elseif c == "forceTornado" then
		local s = stormById(cmd.id)
		if not s then
			-- the most strongly rotating live storm
			for _, st in world.storms do
				if not st.dead and not st.tornado and (not s or st.vlow > s.vlow) then
					s = st
				end
			end
		end
		if s then
			world:forceTornado(s)
		end
	elseif c == "townHere" then
		local t = strongestTornado()
		if t then
			-- three minutes ahead of the tornado on its present track
			placeTown(t.x + t.ut * 180, t.y + t.vt * 180, math.atan2(t.vt, t.ut))
		elseif type(cmd.x) == "number" and type(cmd.y) == "number" then
			placeTown(cmd.x, cmd.y, 0)
		else
			placeTown(townSite())
		end
	elseif c == "resetTown" then
		placeTown(town.cx, town.cy, 0)
	elseif c == "genesis" then
		settings.genesis = not settings.genesis
		world.genesis = settings.genesis
	elseif c == "initiation" then
		settings.initiation = not settings.initiation
		world.initiation = settings.initiation
	elseif c == "testScene" and type(cmd.id) == "string" then
		-- a deterministic visual test scene (shared/VisualTests): blocks the server a few seconds
		local scene = VisualTests.byId(cmd.id)
		if scene then
			local t0 = os.clock()
			local t = world:labScene(scene, VisualTests.SITE)
			log("visual test %s built in %.1f s: %s", scene.id, os.clock() - t0, if t then string.format("%s %s vc %.0f rc %.0f S %.2f", t.id, t.stage, t.vc, t.rc, t.swirl) else "no tornado")
			broadcast(remotes.event, { kind = "labScene", id = scene.id, tornado = t and t.id, x = t and t.x, y = t and t.y })
		end
	elseif c == "clearScene" then
		for _, s in world.storms do
			if s.lab then
				s.pin, s.dead, s.deadFor, s.tornado = nil, true, 1e9, nil
			end
		end
		for _, t in world.tornadoes do
			if t.lab then
				t.ended, t.endedFor = true, 1e9
			end
		end
	elseif c == "seedCell" and type(cmd.x) == "number" then
		-- a lab poke: a growing updraft at a point (it lives or dies by its environment)
		local u, v = world.env:windAt(cmd.x, cmd.y, 3000)
		local cell = Storm.new({ x = cmd.x, y = cmd.y, u = u, v = v, W = 8, Ru = 1500 })
		Storm.environment(cell, world)
		table.insert(world.storms, cell)
	end
	broadcast(remotes.state, world:snapshot(), settings)
end)

-- the slow simulation, run as a coroutine with a time budget per frame
local slowThread: thread? = nil
local slowPending = 0
local budget = LabConfig.RATES.slowBudgetMs / 1000
local deadline = 0
local function yieldFn()
	if os.clock() > deadline then
		coroutine.yield()
	end
end

local timers = { tornado = 0, state = 0, cold = 0, precip = 0 }
local townAcc = 0
local stats = { slowMs = 0, fastMs = 0, frames = 0 }

RunService.Heartbeat:Connect(function(dt)
	if not ready then
		return
	end
	local t0 = os.clock()
	local simDt = if settings.paused then 0 else math.min(dt, 0.1) * settings.timeScale
	if simDt > 0 then
		-- the tornadoes, finely: substeps no longer than 0.5 s (stepFast does that itself)
		world:stepFast(simDt)
		slowPending += simDt
		vehicles:update(world)
		debris:update(world, simDt)
		townAcc += simDt
		if town and townAcc >= 0.2 then
			local releases, reports = town:update(world, townAcc)
			townAcc = 0
			if #releases > 0 then
				debris:release(releases, world.time)
			end
			if #reports > 0 then
				broadcast(remotes.event, { kind = "damage", reports = reports })
			end
		end
	end
	stats.fastMs += (os.clock() - t0) * 1000
	-- slow part
	local s0 = os.clock()
	deadline = s0 + budget
	world.yieldFn = yieldFn
	if not slowThread and slowPending > 0 then
		local d = slowPending
		slowPending = 0
		slowThread = coroutine.create(function()
			world:stepSlow(d)
		end)
	end
	if slowThread then
		local ok, err = coroutine.resume(slowThread)
		if not ok then
			warn("[StormLab] slow step failed: " .. tostring(err))
			slowThread = nil
		elseif coroutine.status(slowThread) == "dead" then
			slowThread = nil
		end
	end
	world.yieldFn = nil
	stats.slowMs += (os.clock() - s0) * 1000
	stats.frames += 1

	-- replication (real-time rates)
	for k, v in timers do
		timers[k] = v + dt
	end
	if timers.tornado >= 1 / LabConfig.RATES.tornadoHz then
		timers.tornado = 0
		broadcast(remotes.tornado, world:tornadoSnapshot(), world.time)
	end
	if timers.state >= 1 / LabConfig.RATES.stateHz then
		timers.state = 0
		local profiles = world:profileSnapshot(profileSeen)
		if #profiles > 0 then
			broadcast(remotes.profiles, profiles)
		end
		broadcast(remotes.state, world:snapshot(), settings)
		Workspace:SetAttribute("StormLabFrameMs", math.floor((stats.fastMs + stats.slowMs) / math.max(1, stats.frames) * 100) / 100)
		Workspace:SetAttribute("StormLabSimTime", math.floor(world.time))
		Workspace:SetAttribute("StormLabParcels", world.precip.n)
		stats.fastMs, stats.slowMs, stats.frames = 0, 0, 0
	end
	if timers.cold >= LabConfig.RATES.coldPoolEvery then
		timers.cold = 0
		broadcast(remotes.coldPool, world:packColdPool())
	end
	if timers.precip >= LabConfig.RATES.precipEvery then
		timers.precip = 0
		broadcast(remotes.precip, world.precip:pack())
	end
	if #world.flashes > 0 then
		broadcast(remotes.flash, world.flashes)
		world.flashes = {}
	end
	if #world.events > 0 then
		for _, e in world.events do
			broadcast(remotes.event, e)
			if e.kind == "tornado" then
				log("tornado %s from %s at t=%.0f s", e.id, e.parent, e.time)
			end
		end
		world.events = {}
	end
end)
