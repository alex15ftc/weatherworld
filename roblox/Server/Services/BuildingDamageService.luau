--!nonstrict
-- The buildings' tornado damage (2026-11-17), as FoliageService breaks the trees: every house and
-- farm building the chunk generator stands up is a model "B<n>" of its chunk (ChunkGen.place:
-- its damage indicator DI, Frame and Size); this server loads each one near a tornado with the
-- 3-s gust over it (Modules/FoliageWind: the same shared weather on every server, the tornado at
-- full detail) through the EF scale's components (Shared/StormLab/Sim/Damage: each component's
-- failure speed drawn once from the building's own seed, so a building is as strong on every
-- server), and shows each degree that fails (Modules/StructureDamage: the parts of its group
-- changed, its debris downwind). The server's parts replicate, so every player on it sees it.
--
-- The wind is a game clock's worth: each TICK of real time loads a building for TICK x CLOCK game
-- seconds (the tornado crosses the map at the 8x clock).
--
-- Only where it matters: each loaded chunk is checked at its middle every TICK, and its buildings
-- one by one only while that gust is over HOT_MS or a tornado is within reach of it. At most
-- BUDGET a tick, round-robin.
--
-- Damage is permanent and shared by every server, as the trees': a record is (building, degree,
-- wind direction); records are kept in the DataStore STORE, one key a region of REGION x REGION
-- chunks, merged as a union on every write (so where servers saw a building differently, the
-- worse damage stands), read when a region's first chunk loads, written at most every FLUSH s a
-- region, and published on MessagingService TOPIC so the other running servers show it at once.
-- A chunk built again shows its damage at once. Without DataStore access (Studio without API
-- services) damage lasts the session.
--
-- The surveys (2026-11-17, server/BuildingDamage.js): with the engine's live storms on, what breaks
-- and the chunks looked at near a tornado are reported to the engine every REPORT_S (map miles, the
-- engine's UTC hour), so a tornado's damage survey shows these buildings and the degree each
-- reached. The ground no server had loaded is filled in afterwards: every JOB_S this server asks
-- for a lifted tornado whose track crosses unseen ground, plans those chunks' buildings
-- (ChunkService.plan, without building them), runs the tornado past each as the survey draws its
-- wind (js/reports/damageSurvey.js: its full wind inside its core, falling off as the distance to
-- the power DECAY to 65 mph at the edge of its width), through the same EF components from the
-- same seeds, and reports what broke - and keeps it, as any damage, so the town shows it when a
-- player comes by.
local DataStoreService = game:GetService("DataStoreService")
local MessagingService = game:GetService("MessagingService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerStorage = game:GetService("ServerStorage")
local HttpService = game:GetService("HttpService")

local Shared = ReplicatedStorage.Shared
local Config = require(Shared.World.Config)
local Profiler = require(Shared.Profiler)
local Damage = require(Shared.StormLab.Sim.Damage)
local ChunkGen = require(ServerStorage.World.ChunkGen)
local WorldMap = require(ServerStorage.World.WorldMap)
local SurveyReplay = require(ServerStorage.Modules.SurveyReplay)
local DamageMessages = require(ServerStorage.Modules.DamageMessages)
local FoliageWind = require(ServerStorage.Modules.FoliageWind)
local StructureDamage = require(ServerStorage.Modules.StructureDamage)

local BuildingDamageService = {}
local ChunkService = nil :: any -- (its plans: Start)

local TICK = 0.5 -- s (real)
local CLOCK = 8 -- game seconds a real second (LiveStormsService CLOCK)
-- (m/s, 3-s gust: under this no component of a recorded indicator can fail - the weakest lower
-- bound, 53 mph, at the weakest build, x 0.85)
local HOT_MS = 20
local BUDGET = 1500
local REGION = 16 -- chunks a side
local FLUSH = 30 -- s
local STORE = "BuildingDamage1"
local TOPIC = "BuildingDamage1"
local REPORT_S = 10 -- s between reports to the engine
local JOB_S = 30 -- s between asks for a survey job
local PUBLISH_S = 2 -- s between messages to the other servers (MessagingService: 150 + 60/player a minute)
local MESSAGE_BYTES = 900 -- (a message holds at most 1 kB)

-- One record: building n of its chunk, the degree that failed, the wind's direction (byte).
type Rec = DamageMessages.Rec
type Building = { model: Model, n: number, di: string, x: number, z: number, seed: number, quality: number, state: any, done: boolean }
type Chunk = { model: Model, name: string, cx: number, cz: number, buildings: { Building }, byN: { [number]: Building }, damage: { Rec }, cursor: number }
type Region = { key: string, data: { [string]: string }, dirty: boolean, lastFlush: number }

local chunks: { [Model]: Chunk } = {}
local byName: { [string]: Chunk } = {}
local regions: { [string]: Region } = {}
local store: DataStore? = nil

BuildingDamageService.stats = { evaluated = 0, hotChunks = 0, failures = 0, reported = 0, surveyed = 0 }

local strengthOf = SurveyReplay.strengthOf

-- What goes to the engine at the next report: [chunk, n, di, xMi, yMi, dod, quality, hourUtc]
-- and [chunk, hourUtc] (server/BuildingDamage.js).
local outbox = { events = {} :: { any }, covered = {} :: { any } }
local coveredAt: { [string]: number } = {}
local live = nil -- LiveStormsService (the engine's clock)
local feed = { url = "", key = nil :: string? }

local function regionKey(cx: number, cz: number): string
	return `r{cx // REGION}_{cz // REGION}`
end

local encode, decode, merge = DamageMessages.encode, DamageMessages.decode, DamageMessages.merge

local function ground(x: number, z: number): number
	return ChunkGen.groundStudsAt(x, z)
end

-- a degree failed on a building (here or elsewhere): its component marked, its look shown
local function show(b: Building, r: Rec, fly: boolean)
	for _, c in b.state.components do
		if c.degree == r.degree and not c.failed then
			c.failed = true
			if c.breach then
				b.state.breached = true
			end
		end
	end
	if r.degree > b.state.stage then
		b.state.stage = r.degree
	end
	local dx, dz = StructureDamage.dirOf(r.dir)
	StructureDamage.apply(b.model, b.di, r.degree, dx, dz, b.seed, ground, fly)
	local top = #(Damage.DI[b.di] or {})
	b.done = b.state.stage >= top
	b.model:SetAttribute("Degree", b.state.stage)
end

-- records from elsewhere into a loaded chunk, worst last: flown in when another server saw them
-- happen just now (fly), else shown as they lie (the store, a survey)
local function absorb(c: Chunk, list: { Rec }, fly: boolean?)
	local fresh = merge(c.damage, list)
	table.sort(fresh, function(a, b)
		return a.degree < b.degree
	end)
	for _, r in fresh do
		local b = c.byN[r.n]
		if b then
			show(b, r, fly == true)
		end
	end
end

local function loadRegion(key: string): Region
	local r = regions[key]
	if r then
		return r
	end
	r = { key = key, data = {}, dirty = false, lastFlush = os.clock() }
	regions[key] = r
	if store then
		task.spawn(function()
			local ok, value = pcall(function()
				return (store :: DataStore):GetAsync(key)
			end)
			if ok and type(value) == "table" then
				for name, s in value do
					if type(s) == "string" then
						local list = decode(s)
						local mine = decode(r.data[name] or "")
						merge(mine, list)
						r.data[name] = encode(mine)
						local c = byName[name]
						if c then
							absorb(c, list)
						end
					end
				end
			end
		end)
	end
	return r
end

local function flush(r: Region)
	if not store or not r.dirty then
		return
	end
	r.dirty = false
	r.lastFlush = os.clock()
	local data = table.clone(r.data)
	task.spawn(function()
		local ok, err = pcall(function()
			(store :: DataStore):UpdateAsync(r.key, function(old)
				local out = if type(old) == "table" then old else {}
				for name, s in data do
					local list = decode(if type(out[name]) == "string" then out[name] else "")
					merge(list, decode(s))
					out[name] = encode(list)
				end
				return out
			end)
		end)
		if not ok then
			r.dirty = true
			warn("[BuildingDamage] saving " .. r.key .. " failed: " .. tostring(err))
		end
	end)
end

local function track(model: Instance)
	if not model:IsA("Model") or chunks[model] then
		return
	end
	local cx, cz = string.match(model.Name, "^(%-?%d+),(%-?%d+)$")
	if not cx then
		return
	end
	local c: Chunk = { model = model, name = model.Name, cx = tonumber(cx) :: number, cz = tonumber(cz) :: number, buildings = {}, byN = {}, damage = {}, cursor = 1 }
	for _, m in model:GetChildren() do
		local n = tonumber(string.match(m.Name, "^B(%d+)$"))
		local di = m:GetAttribute("DI")
		local frame = m:GetAttribute("Frame")
		local size = m:GetAttribute("Size")
		if n and m:IsA("Model") and type(di) == "string" and Damage.DI[di] and typeof(frame) == "CFrame" and typeof(size) == "Vector3" then
			-- (its own strength, the same on every server: the seed and build quality from its place)
			local seed, quality = strengthOf(c.cx, c.cz, n)
			local b: Building = {
				model = m, n = n, di = di, x = frame.X, z = frame.Z, seed = seed, quality = quality, done = false,
				state = Damage.newStructure(`{c.name}/{n}`, di, frame.X, frame.Z, size.Y, seed, 0.85 + 0.3 * quality),
			}
			table.insert(c.buildings, b)
			c.byN[n] = b
		end
	end
	if #c.buildings == 0 then
		return
	end
	table.sort(c.buildings, function(a, b)
		return a.n < b.n
	end)
	chunks[model] = c
	byName[c.name] = c
	local r = loadRegion(regionKey(c.cx, c.cz))
	local saved = r.data[c.name]
	if saved then
		absorb(c, decode(saved))
	end
end

local function untrack(model: Instance)
	local c = chunks[model]
	if c then
		chunks[model] = nil
		if byName[c.name] == c then
			byName[c.name] = nil
		end
	end
end

-- What waits to go to the other servers: records by chunk, and whether they happened live (the
-- other servers fly their debris in) or came from a survey.
local outgoing: { DamageMessages.Outgoing } = {}

-- failures of a chunk (by name): in its region's record and, queued, to the other servers
local function keep(name: string, cx: number, cz: number, list: { Rec }, isLive: boolean)
	local r = loadRegion(regionKey(cx, cz))
	local mine = decode(r.data[name] or "")
	merge(mine, list)
	r.data[name] = encode(mine)
	r.dirty = true
	table.insert(outgoing, { c = name, list = list, live = isLive })
end

-- One message of what waits (DamageMessages.pack: as much as fits in MESSAGE_BYTES): { j, b }.
local function nextMessage(): string?
	local batch = DamageMessages.pack(outgoing, MESSAGE_BYTES)
	return if batch then HttpService:JSONEncode({ j = game.JobId, b = batch }) else nil
end

-- A message from another server (nextMessage's, or one of a single chunk { c, d }).
local function received(body: any)
	local entries = if type(body.b) == "table" then body.b else { { body.c, body.d, 0 } }
	for _, e in entries do
		if type(e) ~= "table" or type(e[1]) ~= "string" then
			continue
		end
		local name, list = e[1], decode(if type(e[2]) == "string" then e[2] else "")
		local c = byName[name]
		if c then
			absorb(c, list, e[3] == 1)
		end
		local cx, cz = string.match(name, "^(%-?%d+),(%-?%d+)$")
		if cx then
			local r = regions[regionKey(tonumber(cx) :: number, tonumber(cz) :: number)]
			if r then
				local mine = decode(r.data[name] or "")
				merge(mine, list)
				r.data[name] = encode(mine)
			end
		end
	end
end

-- failures here: on the chunk now, in its region's record, and to the other servers
local function failed(c: Chunk, list: { Rec })
	merge(c.damage, list)
	BuildingDamageService.stats.failures += #list
	keep(c.name, c.cx, c.cz, list, true)
end

-- the engine's hour now, or nil (no engine storms: nothing to report)
local function hourNow(): number?
	return if live and feed.url ~= "" then live.clockUtc() else nil
end

local function event(c: Chunk, b: Building, degree: number, hour: number)
	local mx, my = WorldMap.worldMilesAt(b.x, b.z)
	table.insert(outbox.events, { c.name, b.n, b.di, math.round(mx * 1000) / 1000, math.round(my * 1000) / 1000, degree, math.round(b.quality * 1000) / 1000, hour })
end

local function tick()
	local spots = FoliageWind.hotspots()
	local budget = BUDGET
	local hot = 0
	local dt = TICK * CLOCK
	for _, c in chunks do
		if not c.model.Parent then
			continue
		end
		local mx, mz = (c.cx + 0.5) * Config.CHUNK_WORLD_STUDS, (c.cz + 0.5) * Config.CHUNK_WORLD_STUDS
		local near = false
		for _, s in spots do
			if (s.x - mx) ^ 2 + (s.z - mz) ^ 2 < s.reach * s.reach then
				near = true
				break
			end
		end
		if not near and FoliageWind.gustAt(mx, mz) < HOT_MS then
			continue
		end
		hot += 1
		-- (the ground looked at near a tornado, for its survey: at most once a game minute or so)
		local hour = hourNow()
		if near and hour and math.abs(hour - (coveredAt[c.name] or -1e9)) >= 0.02 then
			coveredAt[c.name] = hour
			table.insert(outbox.covered, { c.name, math.round(hour * 1000) / 1000 })
		end
		local found: { Rec } = {}
		local n = #c.buildings
		for _ = 1, math.min(n, budget) do
			local b = c.buildings[c.cursor]
			c.cursor = c.cursor % n + 1
			budget -= 1
			if b.done then
				continue
			end
			local g, dx, dz = FoliageWind.gustAt(b.x, b.z)
			if g < HOT_MS * 0.8 then
				continue
			end
			BuildingDamageService.stats.evaluated += 1
			-- (the roof takes the same gust: the frames hold no updraft at the ground)
			local list = Damage.apply(b.state, dt, g, g)
			table.sort(list, function(p, q)
				return p.degree < q.degree
			end)
			for _, f in list do
				local r = { n = b.n, degree = f.degree, dir = StructureDamage.byteOf(dx, dz) }
				table.insert(found, r)
				show(b, r, true)
				if hour then
					event(c, b, f.degree, math.round(hour * 1000) / 1000)
				end
			end
		end
		if #found > 0 then
			failed(c, found)
		end
		if budget <= 0 then
			break
		end
	end
	BuildingDamageService.stats.hotChunks = hot
	for _, r in regions do
		if r.dirty and os.clock() - r.lastFlush > FLUSH then
			flush(r)
		end
	end
end

local function request(method: string, path: string, body: string?): (boolean, string)
	local headers: { [string]: string } = {}
	if feed.key then
		headers["x-api-key"] = feed.key
	end
	if body then
		headers["Content-Type"] = "application/json"
	end
	local ok, res = pcall(HttpService.RequestAsync, HttpService, { Url = feed.url .. path, Method = method, Body = body, Headers = headers })
	if not ok then
		return false, tostring(res)
	end
	if not res.Success then
		return false, ("HTTP %d"):format(res.StatusCode)
	end
	return true, res.Body
end

local serverId = if game.JobId ~= "" then game.JobId else "studio"

-- What is waiting goes to the engine (with a survey job's progress); kept for the next try if
-- the engine does not answer.
local function report(job: any?)
	if feed.url == "" or (#outbox.events == 0 and #outbox.covered == 0 and not job) then
		return
	end
	local events, covered = outbox.events, outbox.covered
	outbox.events, outbox.covered = {}, {}
	local ok = request("POST", "/api/game/v1/damage/report", HttpService:JSONEncode({ server = serverId, events = events, covered = covered, job = job }))
	if ok then
		BuildingDamageService.stats.reported += #events
	else
		table.move(events, 1, #events, #outbox.events + 1, outbox.events)
		table.move(covered, 1, #covered, #outbox.covered + 1, outbox.covered)
	end
end

-- One survey job (server/BuildingDamage.js job): the unseen chunks under a lifted tornado's
-- swath planned and run past it (SurveyReplay), what broke reported and kept.
local function survey(job: any)
	local samples = SurveyReplay.samples(job.track or {})
	if #samples == 0 then
		return
	end
	local skip = {}
	for _, name in job.covered or {} do
		skip[name] = true
	end
	local jobRef = { id = job.id, done = false }
	local lastReport = os.clock()
	for _, ch in SurveyReplay.chunks(samples, skip) do
		local recs, events = SurveyReplay.run(ch.cx, ch.cz, ChunkService.plan(ch.cx, ch.cz), samples)
		table.move(events, 1, #events, #outbox.events + 1, outbox.events)
		table.insert(outbox.covered, { ch.name, job.startHourUtc })
		BuildingDamageService.stats.surveyed += 1
		if #recs > 0 then
			BuildingDamageService.stats.failures += #recs
			keep(ch.name, ch.cx, ch.cz, recs, false)
			local loadedChunk = byName[ch.name]
			if loadedChunk then
				absorb(loadedChunk, recs)
			end
		end
		if os.clock() - lastReport > REPORT_S then
			lastReport = os.clock()
			report(jobRef)
		end
	end
	jobRef.done = true
	report(jobRef)
end

-- The engine link: reports every REPORT_S, a survey job asked for every JOB_S.
local function connect()
	if workspace:GetAttribute("LiveStorms") ~= true then
		return
	end
	feed.url = Config.feedUrl()
	if feed.url == "" then
		return
	end
	pcall(function()
		feed.key = HttpService:GetSecret("weather_feed_key") :: any
	end)
	task.spawn(function()
		while true do
			task.wait(REPORT_S)
			local ok, err = pcall(report, nil)
			if not ok then
				warn("[BuildingDamage] report failed: " .. tostring(err))
			end
		end
	end)
	task.spawn(function()
		while true do
			task.wait(JOB_S)
			local ok, err = pcall(function()
				local got, body = request("GET", "/api/game/v1/damage/jobs?server=" .. HttpService:UrlEncode(serverId))
				if not got then
					return
				end
				local answer = HttpService:JSONDecode(body)
				if type(answer) == "table" and type(answer.job) == "table" then
					survey(answer.job)
				end
			end)
			if not ok then
				warn("[BuildingDamage] survey failed: " .. tostring(err))
			end
		end
	end)
end

function BuildingDamageService.Init()
	local ok, ds = pcall(DataStoreService.GetDataStore, DataStoreService, STORE)
	store = if ok then ds else nil
end

function BuildingDamageService.Start()
	live = require(script.Parent.LiveStormsService)
	ChunkService = require(script.Parent.ChunkService)
	FoliageWind.bind(require(script.Parent.StormHostService), live)
	connect()
	-- (a check that the store answers: Studio without API services has none)
	if store then
		local ok = pcall(function()
			(store :: DataStore):GetAsync("probe")
		end)
		if not ok then
			store = nil
			warn("[BuildingDamage] no DataStore access: building damage lasts this session only")
		end
	end
	pcall(function()
		MessagingService:SubscribeAsync(TOPIC, function(msg)
			local ok, body = pcall(HttpService.JSONDecode, HttpService, msg.Data)
			if ok and type(body) == "table" and body.j ~= game.JobId then
				received(body)
			end
		end)
	end)
	-- the queue to the other servers, one message every PUBLISH_S
	task.spawn(function()
		while true do
			task.wait(PUBLISH_S)
			local message = nextMessage()
			if message then
				local ok, err = pcall(MessagingService.PublishAsync, MessagingService, TOPIC, message)
				if not ok then
					warn("[BuildingDamage] publish failed: " .. tostring(err))
				end
			end
		end
	end)
	local root = workspace:WaitForChild("WorldProps")
	for _, m in root:GetChildren() do
		track(m)
	end
	root.ChildAdded:Connect(track)
	root.ChildRemoved:Connect(untrack)
	game:BindToClose(function()
		for _, r in regions do
			flush(r)
		end
		task.wait(2)
	end)
	task.spawn(function()
		while true do
			task.wait(TICK)
			Profiler.Begin("BuildingDamage")
			local ok, err = pcall(tick)
			Profiler.End()
			if not ok then
				warn("[BuildingDamage] " .. tostring(err))
			end
		end
	end)
end

return BuildingDamageService
