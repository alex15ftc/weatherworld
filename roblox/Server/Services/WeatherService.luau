--!strict
-- Brings the storm frames in and hands them to the players.
--
-- Source (Workspace attribute StormSource, else "http" when a feed URL is set, else "replay"):
--   http    polls the weather server's GET /api/game/v1/frames?after=<seq> every
--           WEATHER_POLL_SECONDS (12 of the 500 requests a minute a game server may make).
--           Needs HTTP requests allowed (Experience Settings > Security) and a URL the game
--           server can reach (not localhost); errors back off up to a minute.
--   replay  plays ServerStorage.WorldData.StormReplay (scripts/export-storm-replay.mjs), looping,
--           starting a few frames before its tornado touches down. Unless StartMiles is set,
--           players start a few miles from the touchdown.
--
-- The frames carry atMs on the weather server's clock. This server works out that clock's
-- offset from its own (workspace:GetServerTimeNow), keeping the estimate from the quickest
-- round trip, and publishes it as the attribute ClockOffsetMs on ReplicatedStorage.Weather, so
-- every client shows a frame at the same moment: weather clock = server time (ms) + offset.
-- Each storm gets the height of the ground under it (groundStuds; tornado.groundStuds), which
-- only the server knows (the map is in ServerStorage).

local HttpService = game:GetService("HttpService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerStorage = game:GetService("ServerStorage")

local Config = require(ReplicatedStorage.Shared.World.Config)
local ChunkGen = require(ReplicatedStorage.Shared.World.ChunkGen)
local WorldMap = require(ReplicatedStorage.Shared.World.WorldMap)
local StormTrack = require(ReplicatedStorage.Shared.Weather.StormTrack)
local Net = require(ReplicatedStorage.Shared.Weather.Net)

local WeatherService = {}
WeatherService.track = StormTrack.new()

-- The replay, as loaded (nil until it is), and where its storms are moved to (km east and south
-- of the recording's). Changing the shift restarts the replay from its first frame.
local replayMeta: any = nil
local replayShift = { x = 0, y = 0 }
local replayRevision = 0
local replayEpoch = 0

-- Holds only the clock offset; the frames go out through Shared/Weather/Net.
local folder = Instance.new("Folder")
folder.Name = "Weather"
folder:SetAttribute("ClockOffsetMs", 0)
folder.Parent = ReplicatedStorage

local function serverMs(): number
	return workspace:GetServerTimeNow() * 1000
end

-- Weather-server clock now, as this server reckons it.
function WeatherService.nowMs(): number
	return serverMs() + (folder:GetAttribute("ClockOffsetMs") :: number)
end

local function groundAt(xKm: number, yKm: number): number
	local mx, my = xKm / Config.KM_PER_MILE, yKm / Config.KM_PER_MILE
	local x, z = WorldMap.studsAt(mx, my)
	if mx < 0 or my < 0 or mx > Config.MAP_MILES or my > Config.MAP_MILES then
		return 0
	end
	local ok, y = pcall(ChunkGen.groundStudsAt, x, z)
	return if ok then y else 0
end

local function annotate(frames: { any })
	for _, frame in frames do
		for _, storm in frame.storms do
			storm.groundStuds = groundAt(storm.xKm, storm.yKm)
			if storm.tornado then
				storm.tornado.groundStuds = groundAt(storm.tornado.xKm, storm.tornado.yKm)
			end
		end
	end
end

local function publish(frames: { any }, reset: boolean, epoch: number?)
	annotate(frames)
	WeatherService.track:add(frames, reset, epoch)
	if #frames > 0 or reset then
		Net.Frames:Server():FireAll({ frames = frames, reset = reset, epoch = epoch })
	end
end

-- A player joining gets what is held.
Net.AskFrames:Server():On(function(player: Player)
	Net.Frames:Server():Fire(player, { frames = WeatherService.track.frames, reset = true, epoch = WeatherService.track.epoch })
end)

local function runHttp(url: string)
	local key: any = nil
	pcall(function()
		key = HttpService:GetSecret("weather_feed_key")
	end)
	local lastSeq = 0
	local bestRtt = math.huge
	local failures = 0
	print(`[WeatherFeed] polling {url} every {Config.WEATHER_POLL_SECONDS} s`)
	while true do
		local sent = serverMs()
		local ok, response = pcall(HttpService.RequestAsync, HttpService, {
			Url = `{url}/api/game/v1/frames?after={lastSeq}`,
			Method = "GET",
			Headers = if key then { ["x-api-key"] = key } else nil,
		})
		local received = serverMs()
		if ok and response.Success then
			failures = 0
			local decoded, body = pcall(HttpService.JSONDecode, HttpService, response.Body)
			if decoded then
				-- The weather clock's offset, from the poll that came back quickest (and slowly
				-- forgiving, so a change of route is taken up).
				local rtt = received - sent
				bestRtt = bestRtt * 1.02
				if rtt <= bestRtt then
					bestRtt = rtt
					folder:SetAttribute("ClockOffsetMs", body.nowMs - (sent + received) / 2)
				end
				publish(body.frames, body.reset, body.epoch)
				lastSeq = body.latestSeq
			end
			task.wait(Config.WEATHER_POLL_SECONDS)
		else
			failures += 1
			if failures == 1 or failures % 10 == 0 then
				warn(`[WeatherFeed] {url}: {if ok then `HTTP {response.StatusCode}` else tostring(response)} ({failures} failures)`)
			end
			task.wait(math.min(60, Config.WEATHER_POLL_SECONDS * 2 ^ math.min(failures, 4)))
		end
	end
end

-- A copy of a frame with every position (the xKm and yKm fields) moved by dx, dy km.
local function moved(value: any, dx: number, dy: number): any
	if type(value) ~= "table" then
		return value
	end
	local out = {}
	for key, item in value do
		if key == "xKm" and type(item) == "number" then
			out[key] = item + dx
		elseif key == "yKm" and type(item) == "number" then
			out[key] = item + dy
		else
			out[key] = moved(item, dx, dy)
		end
	end
	return out
end

local function runReplay()
	local data = ServerStorage:FindFirstChild("WorldData")
	local replay = data and data:FindFirstChild("StormReplay")
	if not replay then
		warn("[WeatherFeed] no replay: run `node scripts/export-storm-replay.mjs`, or set WeatherFeedUrl")
		return
	end
	local meta = require(replay:WaitForChild("Meta") :: ModuleScript) :: any
	local frames = {}
	for i = 1, meta.frames do
		local module = replay:WaitForChild(string.format("F%03d", i)) :: ModuleScript
		table.insert(frames, HttpService:JSONDecode(require(module) :: any))
	end
	replayMeta = meta
	if workspace:GetAttribute("StartMiles") == nil then
		-- South-east of the touchdown, looking back at the storm.
		workspace:SetAttribute("StartMiles", `{meta.focusMiles.x + 3},{meta.focusMiles.y + 3}`)
	end
	local first = math.max(1, (workspace:GetAttribute("ReplayStartFrame") :: number?) or meta.tornado.touchdownFrame - 3)
	print(`[WeatherFeed] replay of seed {meta.seed}: {meta.frames} frames, {meta.tornado.peakMph} mph tornado at frame {meta.tornado.touchdownFrame}, starting at frame {first}`)
	while true do
		-- A copy of the recording, moved by the current shift (WeatherService.moveReplay).
		local revision = replayRevision
		local run = {}
		for i, frame in frames do
			run[i] = moved(frame, replayShift.x, replayShift.y)
		end
		annotate(run)
		-- The replay's clock: frame `first` is shown now, and the loop restarts after the last.
		local offset = run[first].atMs - serverMs()
		folder:SetAttribute("ClockOffsetMs", offset)
		replayEpoch += 1
		local epoch = replayEpoch
		local released = 0
		-- Hand frames over as the live feed would: each one a tick ahead of being shown.
		while released < meta.frames and revision == replayRevision do
			local now = serverMs() + offset
			local give = {}
			while released < meta.frames and run[released + 1].atMs <= now + meta.tickMs * 1.6 do
				released += 1
				table.insert(give, run[released])
			end
			if #give > 0 then
				WeatherService.track:add(give, released == #give, epoch)
				Net.Frames:Server():FireAll({ frames = give, reset = released == #give, epoch = epoch })
			end
			task.wait(1)
		end
		if revision == replayRevision then
			task.wait((run[meta.frames].atMs - (serverMs() + offset)) / 1000 + 5)
		end
	end
end

-- Where the recorded tornado touches down now, in map miles (nil while no replay is loaded).
function WeatherService.tornadoMiles(): (number?, number?)
	if not replayMeta then
		return nil, nil
	end
	local km = Config.KM_PER_MILE
	return replayMeta.focusMiles.x + replayShift.x / km, replayMeta.focusMiles.y + replayShift.y / km
end

-- Moves the replayed storms so that their tornado touches down at (xMiles, yMiles) (map miles east
-- and south of the north-west corner, as the recording's touchdown is). Without a point, the
-- recording goes back to where it was. The replay restarts from its first frame.
function WeatherService.moveReplay(xMiles: number?, yMiles: number?): (boolean, string)
	if not replayMeta then
		return false, `no storm replay is loaded (StormSource is "{workspace:GetAttribute("StormSource") or "feed"}")`
	end
	if xMiles == nil or yMiles == nil then
		replayShift = { x = 0, y = 0 }
	else
		local km = Config.KM_PER_MILE
		replayShift = {
			x = (xMiles - replayMeta.focusMiles.x) * km,
			y = (yMiles - replayMeta.focusMiles.y) * km,
		}
	end
	replayRevision += 1
	return true, "replay moved"
end

-- In Init, ahead of every Start: a replay sets the players' start point (StartMiles) before
-- ExploreService places anyone. Neither source yields before then.
function WeatherService.Init()
	local source = workspace:GetAttribute("StormSource")
	local url = (workspace:GetAttribute("WeatherFeedUrl") :: string?) or Config.WEATHER_FEED_URL
	if source == "http" or (source == nil and url ~= "") then
		task.spawn(runHttp, (string.gsub(url, "/+$", "")))
	else
		task.spawn(runReplay)
	end
end


return WeatherService
