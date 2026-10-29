--!nonstrict
-- The game's storms (2026-10-27; replaces WeatherFeed's frames + client/StormView). The game server
-- runs the storm lab's atmosphere (ReplicatedStorage.StormLab.Sim: soundings, storms, rain, cold
-- pools, tornadoes, the one wind field) for the window of the map round this place, and publishes
-- it as storm frames v2 (docs/stormlab/FRAME-V2.md) through the lab's Publisher; every client draws
-- them with the lab's billboard renderers (client/Weather). The weather engine stays the authority:
--   engine  (a feed URL is set) GET {url}/api/game/v1/lab/window?x&y (km) for the window's
--           soundings, boundaries and storms; then every POLL s /lab/storms: each engine storm's
--           position, motion, updraft, size, rotation and occlusion ARE the lab copy's
--           (Storm.setEngine / followEngine: carried on along the engine's motion between polls,
--           held still while the engine's clock is paused; new engine storms are added, gone ones
--           die), and so is its tornado: on the ground, as strong, as wide and where the engine
--           says (Tornado.setEngine). The lab only draws from them (rain, outflow, wall cloud,
--           funnel shape). The lab's own initiation and genesis are off. The
--           window is fetched again every REWINDOW s (its soundings change through the day), and
--           moved when the players' centre drifts more than RECENTRE m from it (one window a server:
--           the players' mean position; clients rebuild their frame on the scenario event).
--   lab     (no URL, or Workspace attribute StormSource = "lab") a lab scenario
--           (ReplicatedStorage.StormLab.Data.<StormHostScenario or Supercell>) set down at the start
--           point: for Studio without the engine. Its own initiation and genesis stay on.
-- The frame: lab metres, x east, y north from the window centre; the clients turn it into studs
-- with the frame below (map scale across, origin at the window centre's studs, a smooth ground
-- datum) - see Weather.frameFor. Ground heights reach clients as a coarse grid (WeatherGround).
-- The clock runs at the game's 8x (a game day in 3 real hours; 12x until 2026-10-29).
local HttpService = game:GetService("HttpService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local Config = require(ReplicatedStorage.Shared.World.Config)
local WorldMap = require(ReplicatedStorage.Shared.World.WorldMap)
local ChunkGen = require(ReplicatedStorage.Shared.World.ChunkGen)

local lab = ReplicatedStorage:WaitForChild("StormLab")
local Sim = lab:WaitForChild("Sim")
local LabConfig = require(lab:WaitForChild("LabConfig"))
local Json = require(Sim:WaitForChild("Json"))
local World = require(Sim:WaitForChild("World"))
local EngineFollow = require(Sim:WaitForChild("EngineFollow"))
local Frames = require(Sim:WaitForChild("Frames"))
local Publisher = require(script.Parent:WaitForChild("StormPublisher"))

local StormHost = {}

local TIME_SCALE = 8 -- the game's clock (server/WeatherAuthorityRuntime.js SIM_HOURS_PER_REAL_MINUTE)
local POLL = 37.5 -- s between engine storm polls (one engine storm tick: 5 sim minutes at 8x)
local REWINDOW = 1800 -- s between window (soundings) refreshes
local SLOW_BUDGET = 3 / 1000 -- s of server time a frame for the slow simulation
local GROUND_CELL = 1000 -- m, the ground grid clients get
local GROUND_HALF = 60000 -- m each way from the window centre
local RECENTRE = 35000 -- m: the players' centre this far from the window centre moves the window

local state: any = { ready = false, world = nil, centreKm = nil, mode = nil, scenarioName = nil, dataJson = nil, dataJsonNext = nil, profileSeen = {} }
StormHost.state = state
local follower = EngineFollow.new() -- (the engine-following state: clock, stalls, missing storms)

local function log(fmt: string, ...)
	print("[StormHost] " .. string.format(fmt, ...))
end

-- remotes, named as the lab's (the lab's client Net reads them)
local net = Instance.new("Folder")
net.Name = LabConfig.NET_FOLDER
local remotes = {}
for key, name in LabConfig.REMOTES do
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
local groundFn = Instance.new("RemoteFunction")
groundFn.Name = "WeatherGround"
groundFn.Parent = net
net.Parent = ReplicatedStorage

local pub = Publisher.new(remotes, Frames, function(): number
	return if state.world then state.world.time else 0
end)
local settings = { timeScale = TIME_SCALE, paused = false }

-- the place's start point in map miles (Explore's rule), then km
local function startKm(): (number, number)
	local text = workspace:GetAttribute("StartMiles")
	local mx, my = WorldMap.meta.start.x, WorldMap.meta.start.y
	if typeof(text) == "string" then
		local x, y = string.match(text, "^%s*([%d%.%-]+)%s*,%s*([%d%.%-]+)%s*$")
		if x and y then
			mx, my = tonumber(x) :: number, tonumber(y) :: number
		end
	end
	return mx * Config.KM_PER_MILE, my * Config.KM_PER_MILE
end

-- the ground (studs) under a lab point, given the window centre (map km, y south)
local function groundStudsAt(cx: number, cy: number, x: number, y: number): number
	local mx = (cx + x / 1000) / Config.KM_PER_MILE
	local my = (cy - y / 1000) / Config.KM_PER_MILE
	if mx < 0 or my < 0 or mx > Config.MAP_MILES or my > Config.MAP_MILES then
		return 0
	end
	local sx, sz = WorldMap.studsAt(mx, my)
	local ok, h = pcall(ChunkGen.groundStudsAt, sx, sz)
	return if ok then h else 0
end

-- the coarse ground grid for clients: u16 studs x 4 (to 16,383 studs), row-major from the
-- window's south-west corner, GROUND_CELL apart
local groundBlob = nil
local function buildGround(cx: number, cy: number)
	local n = math.floor(2 * GROUND_HALF / GROUND_CELL) + 1
	local b = buffer.create(n * n * 2)
	for j = 0, n - 1 do
		for i = 0, n - 1 do
			local h = groundStudsAt(cx, cy, -GROUND_HALF + i * GROUND_CELL, -GROUND_HALF + j * GROUND_CELL)
			buffer.writeu16(b, 2 * (j * n + i), math.clamp(math.floor(h * 4 + 0.5), 0, 65535))
		end
		if j % 8 == 0 then
			task.wait()
		end
	end
	groundBlob = { n = n, cell = GROUND_CELL, half = GROUND_HALF, data = b }
	state.groundVersion = (state.groundVersion or 0) + 1
end

groundFn.OnServerInvoke = function()
	while not (state.ready and groundBlob) do
		task.wait(0.2)
	end
	return {
		centreKm = state.centreKm, n = groundBlob.n, version = state.groundVersion, cell = groundBlob.cell, half = groundBlob.half, data = groundBlob.data,
		studsPerMile = Config.STUDS_PER_MILE, mapMiles = Config.MAP_MILES,
	}
end

-- HTTP to the engine
local url = ""
local key = nil
local function get(path: string): any?
	local ok, response = pcall(HttpService.RequestAsync, HttpService, {
		Url = url .. path, Method = "GET", Headers = if key then { ["x-api-key"] = key } else nil,
	})
	if not ok or not response.Success then
		warn("[StormHost] " .. path .. ": " .. tostring(if ok then response.StatusCode else response))
		return nil
	end
	local ok2, body = pcall(HttpService.JSONDecode, HttpService, response.Body)
	return if ok2 then body else nil
end

-- (a newcomer gets everything once its listeners are connected: the lab client's "ready")
remotes.hello.OnServerInvoke = function()
	while not state.ready do
		task.wait(0.2)
	end
	return {
		scenario = state.scenarioName or "live", time = state.world.time, settings = settings, source = state.mode,
		frameVersion = Frames.VERSION, data = state.dataJson, centreKm = state.centreKm,
	}
end
remotes.command.OnServerEvent:Connect(function(player, cmd)
	if type(cmd) == "table" and cmd.cmd == "ready" and state.ready then
		pub:join(player)
	end
	-- (players can't change the shared weather: other lab commands are ignored)
end)

local function yieldNow()
	task.wait()
end

-- build the world from window data (lab frame), spin it up (engine mode: the engine drives the
-- storms - Sim/EngineFollow, shared with the storm lab's engine mode)
local function adopt(data: any, mode: string, shiftX: number?, shiftY: number?)
	local engine = mode == "engine"
	local w = World.new(data, { yield = yieldNow, followEngine = engine })
	w.yield = yieldNow
	local spin = LabConfig.SPIN_UP_SECONDS
	-- the engine's clock is paused: its storms are where it says, and stay there (w.holdStill)
	local paused = engine and data.meta ~= nil and data.meta.paused == true
	if engine then
		EngineFollow.beforeSpinUp(w, spin, paused)
	end
	local t0 = os.clock()
	w:spinUp(spin)
	if engine then
		-- (the engine ran on while this window was fetched and spun up)
		local late = if state.fetchedAt then math.clamp((os.clock() - state.fetchedAt) * TIME_SCALE, 0, 900) else 0
		EngineFollow.afterSpinUp(follower, w, data, late, paused)
		local old = state.world
		if old then
			local n = EngineFollow.carryTornadoes(old, w, shiftX or 0, shiftY or 0)
			if n > 0 then
				log("%d tornado(es) carried into the new window", n)
			end
		end
		EngineFollow.startTornadoes(w, data.storms)
	end
	state.world = w
	state.dataJson = state.dataJsonNext
	pub:reset()
	pub:send("event", { kind = "scenario", scenario = state.scenarioName or "live", source = mode, data = state.dataJson })
	pub:send("profiles", w:profileSnapshot({}))
	state.profileSeen = {}
	w:profileSnapshot(state.profileSeen)
	log("%s window: %d storms, spun up in %.1f s", mode, #w.storms, os.clock() - t0)
end

-- keep the lab's storms in step with the engine's (Sim/EngineFollow.apply)
local function nudge(list: { any }, stampUtc: number?, paused: boolean?)
	if state.world then
		EngineFollow.apply(follower, state.world, list, stampUtc, paused, log)
	end
end

-- the players' mean position in map km (y south), or nil with nobody in the world yet
local function playersKm(): (number?, number?)
	local sx, sy, n = 0, 0, 0
	for _, p in game:GetService("Players"):GetPlayers() do
		local ch = p.Character
		local root = ch and ch:FindFirstChild("HumanoidRootPart")
		if root then
			local mx, my = WorldMap.milesAt(root.Position.X, root.Position.Z)
			sx += mx * Config.KM_PER_MILE
			sy += my * Config.KM_PER_MILE
			n += 1
		end
	end
	if n == 0 then
		return nil, nil
	end
	return sx / n, sy / n
end

local function runEngine(cx: number, cy: number)
	-- fetch the window round (x, y) map km: the ground grid first when the centre moves (clients
	-- ask for it when they rebuild on the scenario event adopt sends)
	local function window(x: number, y: number): boolean
		local data = get(string.format("/api/game/v1/lab/window?x=%.2f&y=%.2f&half=7", x, y))
		state.fetchedAt = os.clock()
		if not data or not data.cells then
			return false
		end
		local c = { x = data.meta.centreMapKm.x, y = data.meta.centreMapKm.y }
		local moved = not state.centreKm or c.x ~= state.centreKm.x or c.y ~= state.centreKm.y
		if moved then
			groundBlob = nil
			buildGround(c.x, c.y)
		end
		-- (lab metres from the old centre to the new: carried tornadoes keep their map spot)
		local was = state.centreKm or c
		local shiftX, shiftY = (was.x - c.x) * 1000, -(was.y - c.y) * 1000
		state.centreKm = c
		state.dataJsonNext = HttpService:JSONEncode(data)
		adopt(data, "engine", shiftX, shiftY)
		cx, cy = x, y
		return true
	end
	while not window(cx, cy) do
		task.wait(30)
	end
	state.ready = true
	local since = 0
	while true do
		task.wait(POLL)
		since += POLL
		local px, py = playersKm()
		-- (measured from the point the window was asked for, not its centre: near the map's edge the
		-- engine clamps the centre inward, and players by the edge were "far" from it forever - the
		-- window was rebuilt every poll and its tornado restarted each time. 2026-10-28)
		local far = px ~= nil and ((px - cx) ^ 2 + (py - cy) ^ 2) * 1e6 > RECENTRE * RECENTRE
		if far then
			log("players moved %.0f km from the window's point: moving the window", math.sqrt((px - cx) ^ 2 + (py - cy) ^ 2))
			window(px :: number, py :: number)
			since = 0
		else
			local r = get(string.format("/api/game/v1/lab/storms?x=%.2f&y=%.2f&half=7", cx, cy))
			if r and r.storms then
				nudge(r.storms, r.simHourUtc, r.paused)
			end
			if since >= REWINDOW then
				since = 0
				-- (fresh soundings: the storms carry over by their engine ids next poll)
				window(cx, cy)
			end
		end
	end
end

local function runLab(cx: number, cy: number)
	local name = workspace:GetAttribute("StormHostScenario") or LabConfig.DEFAULT_SCENARIO
	local mod = lab:WaitForChild("Data"):FindFirstChild(name)
	if not mod then
		warn("[StormHost] no lab scenario " .. tostring(name))
		return
	end
	state.dataJsonNext = nil -- (clients have the scenario module themselves)
	state.scenarioName = name
	local data = Json.decode(require(mod))
	state.centreKm = { x = cx, y = cy }
	adopt(data, "lab")
	state.scenarioName = name
	buildGround(cx, cy)
	state.ready = true
end

-- the simulation and replication, every frame
local slowThread, slowPending, deadline = nil, 0, 0
local timers = { tornado = 0, state = 0, cold = 0, precip = 0, precipFull = 0 }
local function yieldFn()
	if os.clock() > deadline then
		coroutine.yield()
	end
end

local function heartbeat(dt: number)
	local w = state.world
	if not state.ready or not w then
		return
	end
	local simDt = math.min(dt, 0.1) * settings.timeScale
	-- (the engine's storms are placed by Storm.followEngine; its updates' jumps eased there)
	w:stepFast(simDt)
	slowPending += simDt
	deadline = os.clock() + SLOW_BUDGET
	w.yieldFn = yieldFn
	if not slowThread and slowPending > 0 then
		local d = slowPending
		slowPending = 0
		slowThread = coroutine.create(function()
			w:stepSlow(d)
		end)
	end
	if slowThread then
		local ok, err = coroutine.resume(slowThread)
		if not ok then
			warn("[StormHost] slow step: " .. tostring(err))
			slowThread = nil
		elseif coroutine.status(slowThread) == "dead" then
			slowThread = nil
		end
	end
	w.yieldFn = nil
	for k, v in timers do
		timers[k] = v + dt
	end
	local R = LabConfig.RATES
	if timers.tornado >= 1 / R.tornadoHz then
		timers.tornado = 0
		-- one tornado a message: the unreliable remote drops payloads over ~900 bytes, and one
		-- snapshot is ~600 (the client merges them: Weather/Net)
		for _, t in w:tornadoSnapshot() do
			pub:send("tornado", { t }, w.time)
		end
	end
	if timers.state >= 1 / R.stateHz then
		timers.state = 0
		local profiles = w:profileSnapshot(state.profileSeen)
		if #profiles > 0 then
			pub:send("profiles", profiles)
		end
		pub:send("state", w:snapshot(), settings)
	end
	if timers.cold >= R.coldPoolEvery then
		timers.cold = 0
		pub:send("coldPool", w:packColdPool())
	end
	if timers.precip >= R.precipEvery then
		timers.precip = 0
		pub:send("precipLite", w.precip:packLite())
	end
	if (R.precipFullEvery or 0) > 0 and timers.precipFull >= R.precipFullEvery then
		timers.precipFull = 0
		pub:send("precip", w.precip:pack())
	end
	if #w.flashes > 0 then
		pub:send("flash", w.flashes)
		w.flashes = {}
	end
	if #w.events > 0 then
		for _, e in w.events do
			pub:send("event", e)
		end
		w.events = {}
	end
end

function StormHost.start()
	local source = workspace:GetAttribute("StormSource")
	url = string.gsub((workspace:GetAttribute("WeatherFeedUrl") :: string?) or Config.WEATHER_FEED_URL, "/+$", "")
	pcall(function()
		key = HttpService:GetSecret("weather_feed_key")
	end)
	local cx, cy = startKm()
	state.mode = if source == "lab" or url == "" then "lab" else "engine"
	log("storms from the %s (round map km %.0f, %.0f)", state.mode, cx, cy)
	task.spawn(function()
		if state.mode == "engine" then
			runEngine(cx, cy)
		else
			runLab(cx, cy)
		end
	end)
	RunService.Heartbeat:Connect(heartbeat)
end

return StormHost
