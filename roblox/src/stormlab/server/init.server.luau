--!nonstrict
-- Storm lab server (roblox/src/stormlab; docs/stormlab/ARCHITECTURE.md). Server-authoritative
-- simulation (guide section 8): it owns the atmosphere (Sim/World), the test town's damage, the
-- vehicles and the debris record, and replicates compact state; clients render.
--   every frame       World.stepFast (tornadoes), vehicles, debris, town damage
--   in the background World.stepSlow in a coroutine with a time budget per frame (it pauses
--                     itself at World.pause points), so storms, rain and cold pools never stall
--                     the tornado
--   replication       tornadoes 15 Hz, world 2 Hz, profiles on change, cold pool / rain volume
--                     every 10 s, flashes and events as they happen; all of it as storm frames
--                     (Sim/Frames) through server/Publisher, which can also record them
--   source            LabConfig.SOURCE (or the Workspace attribute StormLabSource): "sim" runs the
--                     lab's simulation; "replay" / "feed" relay recorded or HTTP frames instead
--                     (server/Relay), the way the main game will relay the engine's
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
-- (the lab's tornado genesis boost: its scenarios should make tornadoes to look at)
Storm.GENESIS_EASE = LabConfig.GENESIS_EASE or 1
local EngineFollow = require(Sim:WaitForChild("EngineFollow"))
local Town = require(script:WaitForChild("Town"))
local Vehicles = require(script:WaitForChild("Vehicles"))
local ServerDebris = require(script:WaitForChild("ServerDebris"))
local VisualTests = require(lab:WaitForChild("VisualTests"))
local Frames = require(Sim:WaitForChild("Frames"))
local Publisher = require(script:WaitForChild("Publisher"))
local Relay = require(script:WaitForChild("Relay"))
local LabTerrain = require(script:WaitForChild("Terrain"))

Players.CharacterAutoLoads = false
Workspace.Gravity = 9.81 * LabConfig.SCALE -- (9.81 m/s^2 in studs at the lab's scale)

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

-- every frame goes through the publisher (only clients that said "ready" get broadcasts)
local world: any = nil
local relay: any = nil
local lastRecording: string? = nil
local source = "sim" -- (set below from LabConfig.SOURCE)
local pub = Publisher.new(remotes, Frames, function(): number
	return if world then world.time elseif relay then relay:time() else 0
end)

local settings = {
	timeScale = LabConfig.DEFAULT_TIME_SCALE,
	paused = false,
	genesis = true,
	initiation = true,
	-- the storms: "engine" = driven by the engine's updates in the scenario (its polls), exactly
	-- as the game drives them (Sim/EngineFollow); "own" = the lab's own dynamics from the start
	-- state (initiation, genesis, occlusion cycles). Workspace attribute StormLabStorms.
	storms = Workspace:GetAttribute("StormLabStorms") or LabConfig.DEFAULT_STORMS,
}
local follower = EngineFollow.new()
local nextPoll = 1 -- (the scenario's next engine update to apply)

local scenarioName = Workspace:GetAttribute("StormLabScenario") or LabConfig.DEFAULT_SCENARIO
local data: any = nil
local town: any = nil
local vehicles = Vehicles.new(Workspace)
local debris = ServerDebris.new(function(e)
	pub:send("event", e)
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
	-- the uneven ground round the town (LabConfig.GROUND.relief; the town sits on a flat pad).
	-- Built in the background, nearest the town first (a newer build stops this one); the town
	-- doesn't wait for it: every height comes from LabConfig.groundAt, not the voxels.
	LabConfig.groundCentre = { x = x, y = y }
	task.defer(function() -- (deferred: none of the build runs inside the caller, e.g. a panel command)
		local t0 = os.clock()
		Workspace:SetAttribute("TerrainBuilding", true) -- (the F4 perf sweep reports it)
		local voxels = LabTerrain.build(LabConfig, x, y, function()
			task.wait()
		end)
		Workspace:SetAttribute("TerrainBuilding", false)
		log("terrain: %d hill voxels in %.1f s", voxels, os.clock() - t0)
	end)
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
	pub:send("event", { kind = "town", x = x, y = y, bearing = bearing })
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
	-- (the analysis, spin-up and lab scenes yield between chunks: no script timeout)
	local function yieldNow()
		task.wait()
	end
	local engine = settings.storms == "engine" and data.polls ~= nil and #data.polls > 0
	world = World.new(data, { yield = yieldNow, followEngine = engine })
	world.yield = yieldNow
	world.genesis = settings.genesis
	world.initiation = settings.initiation
	world.engineDriven = engine
	if engine then
		EngineFollow.beforeSpinUp(world, LabConfig.SPIN_UP_SECONDS, false)
	end
	world:spinUp(LabConfig.SPIN_UP_SECONDS)
	nextPoll = 1
	if engine then
		EngineFollow.afterSpinUp(follower, world, data, 0, false)
		EngineFollow.startTornadoes(world, data.storms)
	elseif settings.storms == "engine" then
		warn("[StormLab] scenario " .. name .. " has no engine updates (re-export it): its storms run on the lab's own dynamics")
	end
	profileSeen = {}
	scenarioName = name
	log("scenario %s (seed %d, %s UTC %.2f): %d storms (%s), spun up in %.1f s", name, data.meta.seed, data.meta.focus, data.meta.simHourUtc, #world.storms, if engine then "engine-driven" else "own dynamics", os.clock() - t0)
	ready = true
	-- the town and its ground are built after: the relief (LabConfig.GROUND.relief) takes minutes at
	-- the lab's scale, and the clients waited for it with nothing on screen (2026-10-29)
	local site = { townSite() }
	task.spawn(function()
		placeTown(table.unpack(site))
	end)
end

-- (set before the scenario loads: its spin-up yields for seconds, and a client that asked
-- meanwhile, with no handler set yet, waited forever - 2026-10-29. It waits for `ready` instead.)
remotes.hello.OnServerInvoke = function(player)
	while not ready do
		task.wait(0.2)
	end
	-- (the newcomer gets the full state once its listeners are connected: the "ready" command)
	return {
		scenario = scenarioName,
		time = if world then world.time else relay:time(),
		settings = settings,
		source = source,
		frameVersion = Frames.VERSION,
		town = if town then { x = town.cx, y = town.cy } else nil, -- (the ground's relief centre)
	}
end

source = Workspace:GetAttribute("StormLabSource") or LabConfig.SOURCE.mode or "sim"
if source == "sim" then
	loadScenario(scenarioName)
else
	-- relay recorded or HTTP frames instead of simulating (server/Relay)
	local opts = table.clone(LabConfig.SOURCE)
	opts.recording = Workspace:GetAttribute("StormLabRecording") or opts.recording
	opts.scenario = scenarioName
	local ok, r = pcall(Relay.new, source, opts, pub, Frames)
	if ok then
		relay = r
		relay.settings = settings
		scenarioName = relay.scenario or scenarioName
		log("relaying %s frames (scenario %s)", source, scenarioName)
		ready = true
	else
		warn("[StormLab] " .. tostring(r) .. "; running the simulation instead")
		source = "sim"
		loadScenario(scenarioName)
	end
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
		pub:join(player)
		if town then
			pub:sendTo(player, "event", { kind = "town", x = town.cx, y = town.cy })
		end
		return
	end
	if c == "source" then
		-- switch the running server between its simulation and replaying a recording (the last
		-- one made, or cmd.recording): the clients rebuild from the scenario event, then the
		-- recording's first frames restore the full state
		pub:stop()
		if cmd.mode == "replay" then
			local name = if type(cmd.recording) == "string" then cmd.recording else lastRecording
			local ok, r = pcall(Relay.new, "replay", { recording = name, scenario = scenarioName }, pub, Frames)
			if not ok then
				warn("[StormLab] " .. tostring(r))
				return
			end
			relay = r
			relay.settings = settings
			world = nil
			source = "replay"
			log("replaying %s", tostring(name))
		elseif relay then
			relay = nil
			source = "sim"
			loadScenario(scenarioName)
		end
		pub:reset()
		pub:send("event", { kind = "scenario", scenario = scenarioName, source = source })
		return
	end
	if c == "record" then
		-- record the frames sent from now on (ServerStorage.StormLabRecordings.<name>)
		if cmd.on then
			local name = if type(cmd.name) == "string" then cmd.name else os.date("!lab-%Y%m%d-%H%M%S")
			lastRecording = name
			local where = pub:record(name, { Scenario = scenarioName, Source = source })
			log("recording frames to %s", where)
		else
			local nF, nSkip = pub:stop()
			log("recording stopped: %d frames (%d not encodable)", nF, nSkip)
		end
		pub:send("event", { kind = "recording", on = pub:recording() })
		return
	end
	if relay then
		-- (relaying: only the playback clock can be changed)
		if c == "timeScale" then
			settings.timeScale = math.clamp(tonumber(cmd.value) or 1, 0.1, 120)
		elseif c == "pause" then
			settings.paused = not settings.paused
		end
		return
	end
	if c == "timeScale" then
		settings.timeScale = math.clamp(tonumber(cmd.value) or 1, 0.1, 120)
	elseif c == "pause" then
		settings.paused = not settings.paused
	elseif c == "scenario" and type(cmd.name) == "string" then
		pub:reset()
		loadScenario(cmd.name)
		pub:send("event", { kind = "scenario", scenario = scenarioName })
		task.wait()
		pub:send("profiles", world:profileSnapshot(profileSeen))
		pub:send("coldPool", world:packColdPool())
		pub:send("precip", world.precip:pack())
		pub:send("precipLite", world.precip:packLite())
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
	elseif c == "storms" then
		-- engine-driven <-> own dynamics: the scenario is rebuilt
		settings.storms = if settings.storms == "engine" then "own" else "engine"
		pub:reset()
		loadScenario(scenarioName)
		pub:send("event", { kind = "scenario", scenario = scenarioName })
		task.wait()
		pub:send("profiles", world:profileSnapshot(profileSeen))
		pub:send("coldPool", world:packColdPool())
		pub:send("precip", world.precip:pack())
		pub:send("precipLite", world.precip:packLite())
	elseif c == "testScene" and type(cmd.id) == "string" then
		-- a deterministic visual test scene (shared/VisualTests): blocks the server a few seconds
		local scene = VisualTests.byId(cmd.id)
		if scene then
			-- the rain-wrap toggle: the same scene with its rain wrapped round the tornado
			if cmd.rainWrap then
				scene = table.clone(scene)
				scene.storm = table.clone(scene.storm)
				scene.storm.rearShare = VisualTests.RAIN_WRAP_SHARE
			end
			-- the tornado toggle: the same storm with a tornado added (held mature) or taken away
			if type(cmd.tornado) == "boolean" and cmd.tornado == (scene.noTornado == true) then
				scene = table.clone(scene)
				scene.noTornado = not cmd.tornado
				if cmd.tornado then
					scene.run = math.max(scene.run or 60, 150)
				end
			end
			local t0 = os.clock()
			local t = world:labScene(scene, VisualTests.SITE)
			log("visual test %s built in %.1f s: %s", scene.id, os.clock() - t0, if t then string.format("%s %s vc %.0f rc %.0f S %.2f", t.id, t.stage, t.vc, t.rc, t.swirl) else "no tornado")
			pub:send("event", { kind = "labScene", id = scene.id, rainWrap = cmd.rainWrap == true, tornado = t and t.id, x = t and t.x, y = t and t.y })
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
	pub:send("state", world:snapshot(), settings)
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

local timers = { tornado = 0, state = 0, cold = 0, precip = 0, precipFull = 0 }
local townAcc = 0
local stats = { slowMs = 0, fastMs = 0, frames = 0 }

RunService.Heartbeat:Connect(function(dt)
	if not ready then
		return
	end
	if relay then
		relay:step(math.min(dt, 0.1), settings.timeScale, settings.paused)
		return
	end
	local t0 = os.clock()
	local simDt = if settings.paused then 0 else math.min(dt, 0.1) * settings.timeScale
	-- the engine's updates (engine-driven storms): each applied when the lab's clock reaches it,
	-- as the game applies each /lab/storms poll
	if world.engineDriven and data.polls then
		while nextPoll <= #data.polls and world.time >= data.polls[nextPoll].min * 60 do
			local p = data.polls[nextPoll]
			EngineFollow.apply(follower, world, p.storms, p.simHourUtc, false, log)
			nextPoll += 1
			if nextPoll > #data.polls then
				log("the scenario's engine updates end here: storms carry on along their last motion")
			end
		end
	end
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
				pub:send("event", { kind = "damage", reports = reports })
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
		-- one tornado a message: the unreliable remote drops payloads over ~900 bytes, and one
		-- snapshot is ~600 (the client merges them: client/Net)
		for _, t in world:tornadoSnapshot() do
			pub:send("tornado", { t }, world.time)
		end
	end
	if timers.state >= 1 / LabConfig.RATES.stateHz then
		timers.state = 0
		local profiles = world:profileSnapshot(profileSeen)
		if #profiles > 0 then
			pub:send("profiles", profiles)
		end
		pub:send("state", world:snapshot(), settings)
		Workspace:SetAttribute("StormLabFrameMs", math.floor((stats.fastMs + stats.slowMs) / math.max(1, stats.frames) * 100) / 100)
		Workspace:SetAttribute("StormLabSimTime", math.floor(world.time))
		Workspace:SetAttribute("StormLabParcels", world.precip.n)
		stats.fastMs, stats.slowMs, stats.frames = 0, 0, 0
	end
	if timers.cold >= LabConfig.RATES.coldPoolEvery then
		timers.cold = 0
		pub:send("coldPool", world:packColdPool())
	end
	if timers.precip >= LabConfig.RATES.precipEvery then
		timers.precip = 0
		pub:send("precipLite", world.precip:packLite())
	end
	local fullEvery = LabConfig.RATES.precipFullEvery or 0
	if fullEvery > 0 and timers.precipFull >= fullEvery then
		timers.precipFull = 0
		pub:send("precip", world.precip:pack())
	end
	if #world.flashes > 0 then
		pub:send("flash", world.flashes)
		world.flashes = {}
	end
	if #world.events > 0 then
		for _, e in world.events do
			pub:send("event", e)
			if e.kind == "tornado" then
				log("tornado %s from %s at t=%.0f s", e.id, e.parent, e.time)
			end
		end
		world.events = {}
	end
end)
