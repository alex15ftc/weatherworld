--!strict
-- Live mode: the engine's own storms on the lab's tabletop, from the cloud model workers beside the
-- engine (js/game/StormWorkers.js; docs/cloudlab/PLAN.md H2 with D1). This is the Roblox server's
-- half of the live link, the same loop the main game will run:
--   every POLL_S: say where the players are (POST /api/game/v1/storm/players, map km, y south) and
--   fetch the frames newer than held (GET /api/game/v1/storm/frames, StormFrames.luau); where the
--   storms are now comes from /api/game/v1/lab/storms round the table's centre;
--   every CloudLabLiveEvery seconds (default 7.5: a game minute at the 8x clock): each player gets
--   each storm's newest client frame, near within NEAR_KM of the player and far beyond, as a
--   buffer (still Zstd-compressed; CloudLabNet.LiveFrame; the client unpacks it, LiveViewController).
-- The full frames are kept here (for the winds and damage to come) but not used yet.
-- Motion: the engine's positions are as of its last storm tick (every 5 game minutes), so each send
-- carries the storm's position now (the tick's plus its motion for the game time since, the clock
-- running CLOCK times real time unless the engine is paused) and the motion itself in game m per
-- real s, which the client keeps moving the storm by between sends.
--
-- Workspace attributes:
--   CloudLabLive        true for live mode (the lab's own model then stays idle)
--   CloudLabLiveUrl     the engine (default http://127.0.0.1:3000)
--   CloudLabLiveCentre  "x,y": the map km the table's middle stands for; "" (default) puts it at
--                       the engine's strongest storm when live mode starts
--   CloudLabLiveEvery   seconds between frames sent to a client per storm (default 7.5)
--   CloudLabEngineSideKm  how far east of its storm the engine-built copy ("<id>~engine", the
--                       server's WEATHER_ENGINE_FRAMES=side) is drawn (default 20)
--   CloudLabLiveWalk    true: a player is where they stand on the table; otherwise (the default)
--                       every player counts as at the table's middle: they watch the table from
--                       its edge (the spawn is 34 km south of the middle) and stand for a chaser
--                       at the storm
--   CloudLabLiveStatus  (set here) what the link is doing, for the HUD
-- Needs "Allow HTTP Requests" in the game settings.

local LiveFeedService = {}

function LiveFeedService.Start()
	if workspace:GetAttribute("CloudLabLive") ~= true then return end

	local HttpService = game:GetService("HttpService")
	local Players = game:GetService("Players")
	local ReplicatedStorage = game:GetService("ReplicatedStorage")

	local Shared = ReplicatedStorage.Shared
	local CloudLabNet = require(Shared.Net.CloudLabNet)
	local StormFrames = require(Shared.CloudModel.StormFrames) :: any
	local liveReady = require(script.Parent.CloudLabService).liveReady

	-- studs per metre across: the live game's map scale (its Config, CloudLab.GameConfig), as the
	-- client draws it (LiveView.client.luau)
	local GameConfig = require(Shared.World.Config) :: any
	local SCALE = GameConfig.STUDS_PER_MILE / (GameConfig.KM_PER_MILE * 1000)
	local POLL_S = 3
	local NEAR_KM = 30
	local CLOCK = 8 -- game seconds a real second (the fixed 8x clock)
	local BASE = (workspace:GetAttribute("CloudLabLiveUrl") :: string?) or "http://127.0.0.1:3000"
	local SERVER = if game.JobId ~= "" then game.JobId else "studio"

	local remote = CloudLabNet.LiveFrame:Server() :: any -- (one event, several message shapes)

	local function status(text: string)
		workspace:SetAttribute("CloudLabLiveStatus", text)
	end

	local function request(method: string, path: string, body: string?): (boolean, string)
		local ok, res = pcall(function()
			return HttpService:RequestAsync({ Url = BASE .. path, Method = method, Body = body, Headers = if body then { ["Content-Type"] = "application/json" } else nil })
		end)
		if not ok then return false, tostring(res) end
		if not res.Success then return false, ("HTTP %d"):format(res.StatusCode) end
		return true, res.Body
	end

	-- The table's centre (map km, y south).
	local centre: { x: number, y: number }? = nil
	local text = (workspace:GetAttribute("CloudLabLiveCentre") :: string?) or ""
	local cx, cy = string.match(text, "^%s*([%-%d%.]+)%s*,%s*([%-%d%.]+)%s*$")
	if cx and cy then
		centre = { x = tonumber(cx) :: number, y = tonumber(cy) :: number }
	end
	while not centre do
		local ok, body = request("GET", "/api/live/storms")
		if ok then
			local best: any = nil
			for _, s in HttpService:JSONDecode(body).storms or {} do
				if s.active ~= false and s.positionKm and (not best or (s.intensity or 0) > (best.intensity or 0)) then best = s end
			end
			if best then
				centre = { x = best.positionKm.x, y = best.positionKm.y }
				status(("centred on %s"):format(tostring(best.id)))
			else
				status("waiting for a storm in the engine")
			end
		else
			status("engine unreachable: " .. body)
		end
		if not centre then task.wait(10) end
	end
	local c = centre :: { x: number, y: number }

	-- A player's place on the map (km, y south): the table's middle plus where they stand on it.
	local function mapKm(p: Player): (number, number)
		if workspace:GetAttribute("CloudLabLiveWalk") ~= true then return c.x, c.y end
		local root = p.Character and p.Character:FindFirstChild("HumanoidRootPart") :: BasePart?
		if not root then return c.x, c.y end
		local east, north = root.Position.X / SCALE / 1000, -root.Position.Z / SCALE / 1000
		return c.x + east, c.y - north
	end

	-- What is held: each storm's newest frames, and where it is now (m east, north of the table's middle).
	type Held = { seq: number, nest: boolean, ended: boolean, full: buffer?, near: buffer?, far: buffer?,
		east: number?, north: number?, ue: number, ve: number, at: number, hour: number, warming: boolean, modelMin: number? }
	local held: { [string]: Held } = {}
	local sent: { [Player]: { [string]: number } } = {}
	local sentBytes: { [Player]: number } = {}
	local startedAt = os.clock()
	-- The engine's storm clock: the tick hour last seen and when it was first seen (os.clock).
	local tickHour, tickSeenAt, paused = -1, 0, false
	local function gameSince(hour: number): number
		if paused then return 0 end
		return (tickHour - hour) * 3600 + (os.clock() - tickSeenAt) * CLOCK
	end
	local warmingInfo: { [string]: any } = {}

	Players.PlayerRemoving:Connect(function(p) sent[p] = nil; sentBytes[p] = nil end)

	local function poll()
		local list = {}
		for _, p in Players:GetPlayers() do
			local x, y = mapKm(p)
			table.insert(list, { x, y })
		end
		local okP, pBody = request("POST", "/api/game/v1/storm/players", HttpService:JSONEncode({ server = SERVER, players = list }))
		table.clear(warmingInfo)
		if okP then
			for _, d in HttpService:JSONDecode(pBody).detailed or {} do warmingInfo[tostring(d.id)] = d end
		end
		local seqs = {}
		for id, h in held do seqs[id] = h.seq end
		local ok, body = request("GET", "/api/game/v1/storm/frames?have=" .. HttpService:UrlEncode(StormFrames.have(seqs)))
		if not ok then status("frames: " .. body); return end
		local bundle = StormFrames.parse(buffer.fromstring(body))
		for id, e in bundle.frames do
			local h = held[id] or { seq = 0, nest = false, ended = false, ue = 0, ve = 0, at = 0, hour = 0, warming = false }
			h.seq, h.nest, h.ended = e.seq, e.nest, e.ended
			h.full, h.near, h.far = e.full or h.full, e.near or h.near, e.far or h.far
			held[id] = h
		end
		-- Storms no longer shown in detail are dropped (the clients are told).
		local live = {}
		for _, id in bundle.live do live[id] = true end
		for id in held do
			if not live[id] then
				held[id] = nil
				remote:FireAll("gone", id)
			end
		end
		-- Where the storms are now.
		local okS, sBody = request("GET", ("/api/game/v1/lab/storms?x=%.3f&y=%.3f&half=12"):format(c.x, c.y))
		if okS then
			local data = HttpService:JSONDecode(sBody)
			paused = data.paused == true
			if data.simHourUtc ~= tickHour then tickHour, tickSeenAt = data.simHourUtc, os.clock() end
			-- (the window's centre is snapped to a cell: positions are from that centre)
			local sx, sy = data.centreMapKm.x - c.x, data.centreMapKm.y - c.y
			for _, s in data.storms do
				-- (the engine-built copy, "<id>~engine", side by side: CloudLabEngineSideKm east of it)
				for _, key in { tostring(s.id), tostring(s.id) .. "~engine" } do
					local h = held[key]
					if h then
						local side = if key == tostring(s.id) then 0 else 1000 * (workspace:GetAttribute("CloudLabEngineSideKm") or 20)
						h.east, h.north = s.pos[1] + sx * 1000 + side, s.pos[2] - sy * 1000
						h.ue, h.ve, h.hour = s.motion[1], s.motion[2], data.simHourUtc
					end
				end
			end
		end
		local n = 0
		for _ in held do n += 1 end
		local kbps = 0
		for _, b in sentBytes do kbps = math.max(kbps, b / 1024 / math.max(1, os.clock() - startedAt)) end
		local warm = {}
		for id, d in warmingInfo do
			if d.warming then table.insert(warm, ("%s warming up (model %s min)"):format(id, tostring(d.modelMinutes or "?"))) end
		end
		status(("centre %.0f, %.0f km | %d storm(s) in detail | up to %.2f KB/s to a player%s%s"):format(c.x, c.y, n, kbps,
			if #warm > 0 then " | " else "", table.concat(warm, ", ")) .. (if paused then " | engine paused" else ""))
	end

	local function forward()
		for _, p in Players:GetPlayers() do
			if not liveReady[p] then continue end
			local px, py = mapKm(p)
			local mine = sent[p] or {}
			sent[p] = mine
			for id, h in held do
				if h.east and (mine[id] or 0) < h.seq then
					-- the storm's distance from the player (km)
					-- where it is now
					local dt = gameSince(h.hour)
					local east, north = h.east + h.ue * dt, h.north + h.ve * dt
					local sxKm, syKm = c.x + east / 1000, c.y - north / 1000
					local near = math.sqrt((sxKm - px) ^ 2 + (syKm - py) ^ 2) <= NEAR_KM
					local frame = if near then h.near else h.far
					if frame then
						local rate = if paused then 0 else CLOCK
						remote:Fire(p, "frame", id, east, north, frame, near, h.ue * rate, h.ve * rate)
						mine[id] = h.seq
						sentBytes[p] = (sentBytes[p] or 0) + buffer.len(frame)
					end
				end
			end
		end
	end

	task.spawn(function()
		while true do
			local ok, err = pcall(poll)
			if not ok then status("poll failed: " .. tostring(err)) end
			task.wait(POLL_S)
		end
	end)
	task.spawn(function()
		while true do
			task.wait((workspace:GetAttribute("CloudLabLiveEvery") :: number?) or 7.5)
			local ok, err = pcall(forward)
			if not ok then warn("[LiveFeed] forward failed: " .. tostring(err)) end
		end
	end)
end

return LiveFeedService
