--!strict
-- The cloud model's storms, live (docs/cloudlab/PLAN.md H3): the engine runs a cloud model beside
-- each storm near a player (js/game/StormWorkers.js) and this server passes their frames on.
--   every POLL_S: say where this server's players are (POST /api/game/v1/storm/players, map km,
--   y south) and fetch the frames newer than held (GET /api/game/v1/storm/frames, read by
--   Shared.CloudModel.StormFrames). The bundle also says where each storm is (map km, as of the
--   engine's last storm tick), how it moves, the tick's hour and whether the engine is paused.
--   every SEND_S (a game minute at the 8x clock): each player gets each storm's newest client
--   frame, near within NEAR_KM of them and far beyond, as a buffer (still Zstd; LiveStormNet.Frame),
--   with where the storm is now, its motion and the engine's look record (LiveStormsController).
--   Only players whose client said Ready get frames (a frame it dropped would not come again).
-- The full frames are kept here (for the winds and damage to come) but not used yet.
-- Lightning (the engine's own storms): each storm's flashes a minute and how many reach the ground
-- and are positive come with the bundle (js/storms/Lightning.js); where they go comes from its
-- near frame, as the engine's rule: ground strikes about the precipitation core (columns weighted
-- by their rain and hail), positive ones from the anvil (cloud only aloft) where there is one,
-- cloud flashes through the deep cloud (columns weighted by their depth). Drawn a game second at a
-- time, each seeded by the storm and the second, so every server makes the same flashes; sent to
-- every client as ("flash", list in map km) for the lab's lightning to draw (WeatherController).
-- Off unless workspace attribute LiveStorms = true (the engine then runs a model a storm near
-- players: up to WEATHER_STORM_WORKERS of them). Uses StormHost's engine: WeatherFeedUrl or
-- Config.WEATHER_FEED_URL, with the weather_feed_key secret. Status in workspace LiveStormsStatus.
local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerStorage = game:GetService("ServerStorage")
local EncodingService = game:GetService("EncodingService")

local Shared = ReplicatedStorage.Shared
local Config = require(Shared.World.Config)
local LiveStormNet = require(Shared.Net.LiveStormNet)
local StormFrames = require(Shared.CloudModel.StormFrames) :: any
local FrameCodec = require(Shared.CloudModel.FrameCodec) :: any
local ClientFrame = require(Shared.CloudModel.ClientFrame) :: any
local WorldMap = require(ServerStorage.World.WorldMap)

local LiveStormsService = {}

local POLL_S = 3
local SEND_S = 7.5
local NEAR_KM = 30
local CLOCK = 8 -- game seconds a real second (StormHost TIME_SCALE; the engine's SIM_HOURS_PER_REAL_MINUTE)
local FLASH_STEP_S = 1 -- game seconds one draw of flashes covers
local FLASH_CATCH_UP = 40 -- at most this many steps drawn at once (after a stall)
local ANVIL_BASE_M = 5000 -- a column whose cloud starts this high is anvil (cloud only aloft)
local CHARGE_TOP_M = 5000 -- cloud flashes stay in columns whose cloud reaches this high (the charge region)

type Held = { seq: number, nest: boolean, ended: boolean, full: buffer?, near: buffer?, far: buffer? }
local held: { [string]: Held } = {}
local where: { [string]: any } = {}
local sent: { [Player]: { [string]: number } } = {}
local sentBytes: { [Player]: number } = {}
local startedAt = os.clock()
-- the engine's storm clock: the tick hour last seen and when it was first seen (os.clock)
local tickHour, tickSeenAt, paused = -1, 0, false
-- the tick's wall-clock time (server time s, the bundle's tickAtMs): when the engine's clock and
-- this server's agree (within CLOCK_TRUST_S), storms are moved on from it - the same moment on
-- every server (from when this server first saw the tick, servers polling 3 s apart placed the
-- same storm up to ~400 m apart, and drew its flashes at different moments)
local tickAt: number? = nil
local CLOCK_TRUST_S = 300
local url, key = "", nil :: string?
local frameServer = LiveStormNet.Frame:Server() :: any -- (one event, several message shapes)
-- players whose client has its listener set (LiveStormNet.Ready)
local ready: { [Player]: boolean } = {}

local lastPrinted = ""
local function status(text: string)
	-- (debug: printed when it changes, the rate left out of the comparison)
	local key = string.gsub(text, "up to [%d%.]+ KB/s", "")
	if workspace:GetAttribute("EngineStormsDebugCam") == true and key ~= lastPrinted then
		lastPrinted = key
		print("[LiveStorms] " .. text)
	end
	workspace:SetAttribute("LiveStormsStatus", text)
end

local function request(method: string, path: string, body: string?): (boolean, string)
	local headers: { [string]: string } = {}
	if key then headers["x-api-key"] = key end
	if body then headers["Content-Type"] = "application/json" end
	local ok, res = pcall(HttpService.RequestAsync, HttpService, { Url = url .. path, Method = method, Body = body, Headers = headers })
	if not ok then return false, tostring(res) end
	if not res.Success then return false, ("HTTP %d"):format(res.StatusCode) end
	return true, res.Body
end

-- A player's place on the map (km, y south), or nil before their character is in.
local function playerKm(p: Player): (number?, number?)
	local root = p.Character and p.Character:FindFirstChild("HumanoidRootPart") :: BasePart?
	if not root then return nil, nil end
	local mx, my = WorldMap.milesAt(root.Position.X, root.Position.Z)
	return mx * Config.KM_PER_MILE, my * Config.KM_PER_MILE
end

-- Game seconds since the engine's storm tick at `hour` (none while paused).
local function gameSince(hour: number): number
	if paused then return 0 end
	if tickAt then
		return (tickHour - hour) * 3600 + math.max(0, workspace:GetServerTimeNow() - tickAt) * CLOCK
	end
	return (tickHour - hour) * 3600 + (os.clock() - tickSeenAt) * CLOCK
end

-- The engine's UTC hour now, the same on every server (its storm tick moved on from the tick's
-- wall-clock time; held while the engine is paused), or nil until a trusted tick has come.
-- (StormHostService's clock in frame-fed cards mode)
function LiveStormsService.clockUtc(): number?
	if not tickAt or tickHour < 0 then return nil end
	return tickHour + gameSince(tickHour) / 3600
end

-- The engine's storms as this server holds them, for their winds (FoliageService's blowdowns):
-- each one's place now (map km, y south) and its newest full frame (FrameCodec.decodeHeader: the
-- ground wind of every column and the tornado), decoded once a frame.
local decoded: { [string]: { seq: number, frame: any } } = {}
function LiveStormsService.stormsNow(): { { id: string, xKm: number, yKm: number, frame: any } }
	local out = {}
	local dt = if tickHour >= 0 then gameSince(tickHour) else 0
	for id, h in held do
		local w = where[id]
		if w and h.full and not h.ended then
			local d = decoded[id]
			if not d or d.seq ~= h.seq then
				local ok, f = pcall(function()
					local b = h.full :: buffer
					local okz, raw = pcall(EncodingService.DecompressBuffer, EncodingService, b, Enum.CompressionAlgorithm.Zstd)
					return FrameCodec.decodeHeader(if okz then raw else b)
				end)
				d = { seq = h.seq, frame = if ok then f else nil }
				decoded[id] = d
			end
			if d.frame then
				table.insert(out, { id = id, xKm = w.xKm + w.ue * dt / 1000, yKm = w.yKm - w.ve * dt / 1000, frame = d.frame })
			end
		end
	end
	for id in decoded do
		if not held[id] then
			decoded[id] = nil
		end
	end
	return out
end

-- Where a storm's flashes can go, from its newest near frame: per column the weight of a ground
-- strike (rain + hail, mm/h), of a positive anvil strike and of a cloud flash (cloud depth, m),
-- and its cloud's base and top (m).
type Sites = { seq: number, f: any, core: { number }, anvil: { number }, cloud: { number }, base: { number }, top: { number }, sums: { number } }
local sites: { [string]: Sites } = {}
local lastSlot: { [string]: number } = {}

local function sitesOf(id: string, h: Held): Sites?
	local s = sites[id]
	if s and s.seq == h.seq then return s end
	if not h.near then return nil end
	local f = ClientFrame.decode(EncodingService:DecompressBuffer(h.near :: buffer, Enum.CompressionAlgorithm.Zstd))
	local n = f.nx * f.ny
	local core, anvil, cloud, base, top = table.create(n, 0), table.create(n, 0), table.create(n, 0), table.create(n, 0), table.create(n, 0)
	local sums = { 0, 0, 0 }
	for j = 1, f.ny do
		for i = 1, f.nx do
			local c = (j - 1) * f.nx + i
			local b1, t1 = ClientFrame.cloudM(ClientFrame.byte(f, "base1", i, j)), ClientFrame.cloudM(ClientFrame.byte(f, "top1", i, j))
			local b2, t2 = ClientFrame.cloudM(ClientFrame.byte(f, "base2", i, j)), ClientFrame.cloudM(ClientFrame.byte(f, "top2", i, j))
			local depth = math.max(0, t1 - b1) + math.max(0, t2 - b2)
			local hi = math.max(t1, t2)
			base[c], top[c] = if t1 > b1 then b1 else b2, hi
			core[c] = ClientFrame.rateMmh(ClientFrame.byte(f, "rain", i, j)) + ClientFrame.rateMmh(ClientFrame.byte(f, "hail", i, j))
			anvil[c] = if t1 > b1 and b1 >= ANVIL_BASE_M then depth else 0
			cloud[c] = if hi >= CHARGE_TOP_M then depth else 0
			sums[1] += core[c]
			sums[2] += anvil[c]
			sums[3] += cloud[c]
		end
	end
	s = { seq = h.seq, f = f, core = core, anvil = anvil, cloud = cloud, base = base, top = top, sums = sums }
	sites[id] = s
	return s
end

local function pick(w: { number }, sum: number, rng: Random): number
	local x, acc = rng:NextNumber() * sum, 0
	for c, v in w do
		acc += v
		if acc >= x and v > 0 then return c end
	end
	return #w
end

local function poisson(rng: Random, mean: number): number
	local k, p, limit = 0, 1, math.exp(-mean)
	repeat
		k += 1
		p *= rng:NextNumber()
	until p <= limit or k > 50
	return k - 1
end

local function normal(rng: Random): number
	return math.sqrt(-2 * math.log(1 - rng:NextNumber())) * math.cos(2 * math.pi * rng:NextNumber())
end

local function hash(text: string): number
	local h = 2166136261
	for i = 1, #text do h = (bit32.bxor(h, string.byte(text, i)) * 16777619) % 4294967296 end
	return h
end

-- The flashes of storm id in game-second slot (map km across, y south; heights m above the
-- ground), with the storm at (xKm, yKm) now.
local function flashesIn(id: string, s: Sites, w: any, slot: number, xKm: number, yKm: number, out: { any })
	local rng = Random.new((hash(id) + slot * 7919) % 2147483647)
	local n = poisson(rng, (w.flashesPerMin or 0) / 60 * FLASH_STEP_S)
	local f = s.f
	local function km(c: number): (number, number)
		local i, j = (c - 1) % f.nx + 1, (c - 1) // f.nx + 1
		local xm, ym = (i - 1 + rng:NextNumber()) * f.dx, (j - 1 + rng:NextNumber()) * f.dx
		return xKm + (xm - f.anchorX) / 1000, yKm - (ym - f.anchorY) / 1000
	end
	for _ = 1, n do
		local e: any = { seed = rng:NextInteger(1, 1e9), current = 0 }
		if rng:NextNumber() < (w.groundShare or 0) and s.sums[1] > 0 then
			local positive = rng:NextNumber() < (w.positiveShare or 0)
			local c = if positive and s.sums[2] > 0 then pick(s.anvil, s.sums[2], rng) else pick(s.core, s.sums[1], rng)
			e.kind = if positive then "+cg" else "cg"
			e.x1, e.y1 = km(c)
			e.z1 = 0
			e.x0, e.y0 = e.x1 + normal(rng) * 1.5, e.y1 + normal(rng) * 1.5
			local top = math.max(s.top[c], 6000)
			e.z0 = if positive then math.min(top, 8000 + 3000 * rng:NextNumber()) else math.min(top - 500, 4500 + 3000 * rng:NextNumber())
			e.current = if positive then 40 + 160 * rng:NextNumber() else math.exp(normal(rng) * 0.5) * 25
		elseif s.sums[3] > 0 then
			local c = pick(s.cloud, s.sums[3], rng)
			local lo = math.max(s.base[c] + 1000, 5500)
			local hi = math.max(s.top[c] - 1000, lo)
			local len, a = 3 + 9 * rng:NextNumber(), 2 * math.pi * rng:NextNumber()
			e.kind = "ic"
			e.x0, e.y0 = km(c)
			e.z0 = lo + (hi - lo) * rng:NextNumber()
			e.x1, e.y1, e.z1 = e.x0 + len * math.cos(a), e.y0 + len * math.sin(a), e.z0 + 1500 * (2 * rng:NextNumber() - 1)
		end
		if e.kind then table.insert(out, e) end
	end
end

local function lightning()
	if paused or tickHour < 0 then return end
	local now = math.floor((tickHour * 3600 + gameSince(tickHour)) / FLASH_STEP_S)
	local out = {}
	for id, h in held do
		local w = where[id]
		if w and (w.flashesPerMin or 0) > 0 and not h.ended then
			local s = sitesOf(id, h)
			if s then
				local from = math.max((lastSlot[id] or now - 1) + 1, now - FLASH_CATCH_UP)
				local dt = gameSince(tickHour)
				local xKm, yKm = w.xKm + w.ue * dt / 1000, w.yKm - w.ve * dt / 1000
				for slot = from, now do flashesIn(id, s, w, slot, xKm, yKm, out) end
			end
		end
		lastSlot[id] = now
	end
	if #out > 0 then frameServer:FireAll("flash", out) end
end

local function poll()
	local list = {}
	for _, p in Players:GetPlayers() do
		local x, y = playerKm(p)
		-- (who it is, for the chaser network: server/ChaserArchive.js; the public view drops it)
		if x and y then table.insert(list, { x, y, tostring(p.UserId), p.DisplayName, p.Name }) end
	end
	request("POST", "/api/game/v1/storm/players", HttpService:JSONEncode({ server = if game.JobId ~= "" then game.JobId else "studio", players = list }))
	local seqs = {}
	for id, h in held do seqs[id] = h.seq end
	local ok, body = request("GET", "/api/game/v1/storm/frames?have=" .. HttpService:UrlEncode(StormFrames.have(seqs)))
	if not ok then status("frames: " .. body); return end
	local bundle = StormFrames.parse(buffer.fromstring(body))
	for id, e in bundle.frames do
		local h = held[id] or { seq = 0, nest = false, ended = false }
		h.seq, h.nest, h.ended = e.seq, e.nest, e.ended
		h.full, h.near, h.far = e.full or h.full, e.near or h.near, e.far or h.far
		held[id] = h
	end
	paused = bundle.paused
	if bundle.tickHour and bundle.tickHour ~= tickHour then tickHour, tickSeenAt = bundle.tickHour, os.clock() end
	local at = if bundle.tickAtMs and bundle.tickAtMs > 0 then bundle.tickAtMs / 1000 else nil
	tickAt = if at and math.abs(workspace:GetServerTimeNow() - at) < CLOCK_TRUST_S then at else nil
	where = bundle.where
	-- storms no longer shown in detail are dropped (the clients are told)
	local live = {}
	for _, id in bundle.live do live[id] = true end
	for id in held do
		if not live[id] then
			held[id] = nil
			sites[id], lastSlot[id] = nil, nil
			for _, m in sent do m[id] = nil end
			frameServer:FireAll("gone", id)
		end
	end
	local n, warm = 0, {}
	for _ in held do n += 1 end
	for id, w in where do
		if w.warming then table.insert(warm, id) end
	end
	local kbps = 0
	for _, b in sentBytes do kbps = math.max(kbps, b / 1024 / math.max(1, os.clock() - startedAt)) end
	status(("%d storm(s) in detail, %d player(s) | up to %.2f KB/s to a player%s%s"):format(n, #list, kbps,
		if #warm > 0 then " | warming up: " .. table.concat(warm, ", ") else "", if paused then " | engine paused" else ""))
end

local function send()
	for _, p in Players:GetPlayers() do
		if not ready[p] then continue end
		local px, py = playerKm(p)
		local mine = sent[p] or {}
		sent[p] = mine
		for id, h in held do
			local w = where[id]
			if w and px and py and (mine[id] or 0) < h.seq then
				-- where the storm is now (km, y south) and how far from the player
				local dt = gameSince(tickHour)
				local xKm, yKm = w.xKm + w.ue * dt / 1000, w.yKm - w.ve * dt / 1000
				local near = math.sqrt((xKm - px) ^ 2 + (yKm - py) ^ 2) <= NEAR_KM
				local frame = if near then h.near else h.far
				if frame then
					local rate = if paused then 0 else CLOCK
					-- motion in m a real second, east and north; the engine's look record (StormFrames
					-- version 4) moved on to now like the storm, for the client's drawn storm (FrameWorld)
					local look = nil
					if w.look then
						look = table.clone(w.look) :: any
						look.xKm, look.yKm = w.look.xKm + w.ue * dt / 1000, w.look.yKm - w.ve * dt / 1000
					end
					frameServer:Fire(p, "frame", id, xKm, yKm, frame, near, w.ue * rate, w.ve * rate, look)
					mine[id] = h.seq
					sentBytes[p] = (sentBytes[p] or 0) + buffer.len(frame)
				end
			end
		end
	end
end

function LiveStormsService.Start()
	if workspace:GetAttribute("LiveStorms") ~= true then return end
	url = string.gsub((workspace:GetAttribute("WeatherFeedUrl") :: string?) or Config.WEATHER_FEED_URL, "/+$", "")
	if url == "" then
		status("off: no engine (WeatherFeedUrl)")
		return
	end
	pcall(function()
		key = HttpService:GetSecret("weather_feed_key") :: any
	end)
	LiveStormNet.Ready:Server():On(function(p: Player)
		-- (a client that listens again - a reconnect - gets every storm afresh)
		ready[p] = true
		sent[p] = nil
	end)
	Players.PlayerRemoving:Connect(function(p) sent[p] = nil; sentBytes[p] = nil; ready[p] = nil end)
	status("starting")
	task.spawn(function()
		while true do
			local ok, err = pcall(poll)
			if not ok then status("poll failed: " .. tostring(err)) end
			task.wait(POLL_S)
		end
	end)
	task.spawn(function()
		while true do
			task.wait(0.25)
			local ok, err = pcall(lightning)
			if not ok then warn("[LiveStorms] lightning failed: " .. tostring(err)) end
		end
	end)
	task.spawn(function()
		while true do
			task.wait(SEND_S)
			local ok, err = pcall(send)
			if not ok then warn("[LiveStorms] send failed: " .. tostring(err)) end
		end
	end)
end

return LiveStormsService
