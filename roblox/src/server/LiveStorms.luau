--!strict
-- The cloud model's storms, live (docs/cloudlab/PLAN.md H3): the engine runs a cloud model beside
-- each storm near a player (js/game/StormWorkers.js) and this server passes their frames on.
--   every POLL_S: say where this server's players are (POST /api/game/v1/storm/players, map km,
--   y south) and fetch the frames newer than held (GET /api/game/v1/storm/frames, read by
--   Shared.CloudModel.StormFrames). The bundle also says where each storm is (map km, as of the
--   engine's last storm tick), how it moves, the tick's hour and whether the engine is paused.
--   every SEND_S (a game minute at the 8x clock): each player gets each storm's newest client
--   frame, near within NEAR_KM of them and far beyond, as a RemoteEvent buffer (still Zstd), with
--   where the storm is now and its motion (client/LiveStorms.luau).
-- The full frames are kept here (for the winds and damage to come) but not used yet.
-- Off unless workspace attribute LiveStorms = true (the engine then runs a model a storm near
-- players: up to WEATHER_STORM_WORKERS of them). Uses StormHost's engine: WeatherFeedUrl or
-- Config.WEATHER_FEED_URL, with the weather_feed_key secret. Status in workspace LiveStormsStatus.
local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage.Shared.World.Config)
local WorldMap = require(ReplicatedStorage.Shared.World.WorldMap)
local StormFrames = require(ReplicatedStorage.Shared.CloudModel.StormFrames) :: any

local LiveStorms = {}

local POLL_S = 3
local SEND_S = 7.5
local NEAR_KM = 30
local CLOCK = 8 -- game seconds a real second (StormHost TIME_SCALE; the engine's SIM_HOURS_PER_REAL_MINUTE)

type Held = { seq: number, nest: boolean, ended: boolean, full: buffer?, near: buffer?, far: buffer? }
local held: { [string]: Held } = {}
local where: { [string]: any } = {}
local sent: { [Player]: { [string]: number } } = {}
local sentBytes: { [Player]: number } = {}
local startedAt = os.clock()
-- the engine's storm clock: the tick hour last seen and when it was first seen (os.clock)
local tickHour, tickSeenAt, paused = -1, 0, false
local url, key = "", nil :: string?
local remote: RemoteEvent

local function status(text: string)
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
	return (tickHour - hour) * 3600 + (os.clock() - tickSeenAt) * CLOCK
end

local function poll()
	local list = {}
	for _, p in Players:GetPlayers() do
		local x, y = playerKm(p)
		if x and y then table.insert(list, { x, y }) end
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
	where = bundle.where
	-- storms no longer shown in detail are dropped (the clients are told)
	local live = {}
	for _, id in bundle.live do live[id] = true end
	for id in held do
		if not live[id] then
			held[id] = nil
			for _, m in sent do m[id] = nil end
			remote:FireAllClients("gone", id)
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
					-- motion in m a real second, east and north
					remote:FireClient(p, "frame", id, xKm, yKm, frame, near, w.ue * rate, w.ve * rate)
					mine[id] = h.seq
					sentBytes[p] = (sentBytes[p] or 0) + buffer.len(frame)
				end
			end
		end
	end
end

function LiveStorms.start()
	if workspace:GetAttribute("LiveStorms") ~= true then return end
	url = string.gsub((workspace:GetAttribute("WeatherFeedUrl") :: string?) or Config.WEATHER_FEED_URL, "/+$", "")
	if url == "" then
		status("off: no engine (WeatherFeedUrl)")
		return
	end
	pcall(function()
		key = HttpService:GetSecret("weather_feed_key") :: any
	end)
	local net = Instance.new("Folder")
	net.Name = "LiveStormNet"
	remote = Instance.new("RemoteEvent")
	remote.Name = "Frame"
	remote.Parent = net
	net.Parent = ReplicatedStorage
	Players.PlayerRemoving:Connect(function(p) sent[p] = nil; sentBytes[p] = nil end)
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
			task.wait(SEND_S)
			local ok, err = pcall(send)
			if not ok then warn("[LiveStorms] send failed: " .. tostring(err)) end
		end
	end)
end

return LiveStorms
