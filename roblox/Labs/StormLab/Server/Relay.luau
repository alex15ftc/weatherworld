--!nonstrict
-- The lab server as a relay: instead of simulating, it plays storm frames (Sim/Frames) from a
-- source through the Publisher, so the clients (and the renderers) work exactly as with the lab's
-- own simulation. This is the seam the main game uses: its server relays the engine's frames.
--
--   replay  a recording (Publisher:record) from ServerStorage.StormLabRecordings.<name>, or a
--           ModuleScript under ReplicatedStorage.StormLab.Data.Recordings returning the same JSON
--           lines (a string or a list of strings); loops at the end
--   feed    an HTTP source: GET <url>?after=<seq> -> { v = 2, seq = n, scenario = name?,
--           frames = { frame, ... } } (frames as Frames.encode makes them), polled every
--           `poll` s; frames are played `lag` s behind the newest, so the stream stays smooth
--           between polls (as the main game's 40 s feed lag)
-- Frames are sent when the playback clock (sim seconds, advancing at the time scale) reaches
-- their time stamp. Scenario events carry the environment: { kind = "scenario", scenario,
-- data? } (data: the scenario JSON when the client has no module of that name).
local HttpService = game:GetService("HttpService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerStorage = game:GetService("ServerStorage")

local Relay = {}
Relay.__index = Relay

local function lines(text: string, out: { any })
	for line in string.gmatch(text, "[^\n]+") do
		local ok, f = pcall(HttpService.JSONDecode, HttpService, line)
		if ok and type(f) == "table" and f.k then
			table.insert(out, f)
		end
	end
end

-- frames of a recording, in time order
function Relay.loadRecording(name: string): ({ any }?, { [string]: any }?)
	local frames = {}
	local meta = {}
	local root = ServerStorage:FindFirstChild("StormLabRecordings")
	local folder = root and root:FindFirstChild(name)
	if folder then
		local parts = folder:GetChildren()
		table.sort(parts, function(a, b)
			return a.Name < b.Name
		end)
		-- (the parts are one text cut at fixed lengths: join, then split lines)
		local text = {}
		for _, v in parts do
			if v:IsA("StringValue") then
				table.insert(text, v.Value)
			end
		end
		lines(table.concat(text), frames)
		meta = folder:GetAttributes()
	else
		local lab = ReplicatedStorage:FindFirstChild("StormLab")
		local data = lab and lab:FindFirstChild("Data")
		local recs = data and data:FindFirstChild("Recordings")
		local mod = recs and recs:FindFirstChild(name)
		if not mod then
			return nil, nil
		end
		local src = require(mod)
		if type(src) == "string" then
			lines(src, frames)
		else
			for _, s in src.lines or src do
				lines(s, frames)
			end
			meta = src.meta or {}
		end
	end
	table.sort(frames, function(a, b)
		return (a.t or 0) < (b.t or 0)
	end)
	return frames, meta
end

function Relay.new(mode: string, opts: { [string]: any }, pub: any, Frames: any): any
	local self = setmetatable({}, Relay)
	self.mode = mode
	self.opts = opts
	self.pub = pub
	self.Frames = Frames
	self.queue = {}
	self.i = 1
	self.clock = nil -- playback sim time
	self.scenario = opts.scenario
	self.seq = 0
	self.pollAt = 0
	if mode == "replay" then
		local frames, meta = Relay.loadRecording(opts.recording)
		if not frames then
			error("no recording " .. tostring(opts.recording))
		end
		self.queue = frames
		self.scenario = (meta and meta.Scenario) or opts.scenario
		self.loop = true
	end
	return self
end

-- the time of the newest frame queued (nil when none)
function Relay:newest(): number?
	local f = self.queue[#self.queue]
	return f and f.t
end

function Relay:_poll()
	local o = self.opts
	local url = string.format("%s?after=%d", o.url, self.seq)
	local ok, body = pcall(HttpService.GetAsync, HttpService, url, true)
	if not ok then
		warn("[StormLab] feed: " .. tostring(body))
		return
	end
	local ok2, msg = pcall(HttpService.JSONDecode, HttpService, body)
	if not ok2 or type(msg) ~= "table" then
		return
	end
	if msg.v and msg.v ~= self.Frames.VERSION then
		warn(string.format("[StormLab] feed sends frame version %s, the lab reads %d", tostring(msg.v), self.Frames.VERSION))
	end
	self.seq = msg.seq or self.seq
	if msg.scenario then
		self.scenario = msg.scenario
	end
	for _, f in msg.frames or {} do
		table.insert(self.queue, f)
	end
end

-- advance playback by dt real seconds at `timeScale`; sends the frames that are due
function Relay:step(dt: number, timeScale: number, paused: boolean)
	if self.mode == "feed" then
		self.pollAt -= dt
		if self.pollAt <= 0 then
			self.pollAt = self.opts.poll or 5
			task.spawn(function()
				self:_poll()
			end)
		end
	end
	local q = self.queue
	if #q == 0 then
		return
	end
	if not self.clock then
		-- start at the first frame (replay), or `lag` s behind the newest (feed)
		self.clock = if self.mode == "feed" then math.max(q[1].t or 0, (self:newest() or 0) - (self.opts.lag or 15)) else (q[1].t or 0)
		self.t0 = self.clock
	end
	if not paused then
		self.clock += dt * timeScale
	end
	while self.i <= #q and (q[self.i].t or 0) <= self.clock do
		local kind, _, args = self.Frames.decode(q[self.i])
		if kind == "state" and self.settings then
			args[2] = self.settings -- (the relay's own playback settings, not the recorded ones)
		end
		self.pub:send(kind, table.unpack(args, 1, math.max(#args, 1)))
		self.i += 1
	end
	if self.mode == "replay" and self.i > #q and self.loop then
		-- loop: start again (the first frames restore the full state)
		self.i = 1
		self.clock = nil
	elseif self.mode == "feed" and self.i > 512 then
		-- (drop played frames)
		local rest = {}
		for k = self.i, #q do
			table.insert(rest, q[k])
		end
		self.queue = rest
		self.i = 1
	end
end

-- the playback clock (for hello and the client's clock)
function Relay:time(): number
	return self.clock or 0
end

return Relay
