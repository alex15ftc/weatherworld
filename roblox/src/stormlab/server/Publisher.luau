--!nonstrict
-- Every frame the server sends goes through here (Sim/Frames: the storm-frame contract), so the
-- lab can record what it sends, and a relay (server/Relay) can send recorded or engine frames
-- through exactly the same path. Clients see no difference between the sources.
--
--   pub:send(kind, ...)            to every client that has said "ready" (one FireAllClients when
--                                  every player in the server has; else one FireClient each)
--   pub:sendTo(player, kind, ...)  to one client
--   pub:join(player)               a client's listeners are connected; it gets the latest state
--                                  (the last state, all profiles, cold pool, precip)
--   pub:record(name) / :stop()     recording: frames as JSON lines, the text cut into
--                                  StringValues (a value holds < 200 000 characters; one precip
--                                  frame alone is ~330 000) under ServerStorage.StormLabRecordings.
--                                  <name>, "0001", "0002", ...: join them in order, then split lines
local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")
local ServerStorage = game:GetService("ServerStorage")

local Publisher = {}
Publisher.__index = Publisher

local CHUNK = 190000

function Publisher.new(remotes: { [string]: any }, Frames: any, clock: () -> number): any
	local self = setmetatable({}, Publisher)
	self.remotes = remotes
	self.Frames = Frames
	self.clock = clock -- sim time stamp for recorded frames
	self.joined = {}
	self.nJoined = 0
	self.last = {} -- kind -> args (the latest of each "full state" kind)
	self.profiles = {} -- storm id -> profile (profiles arrive incrementally)
	self.rec = nil
	return self
end

-- (what a newcomer needs to see the current weather)
local KEEP = { state = true, coldPool = true, precip = true, precipLite = true }

function Publisher:_remember(kind: string, args: { any })
	if KEEP[kind] then
		self.last[kind] = args
	elseif kind == "profiles" then
		for _, p in args[1] or {} do
			self.profiles[p.id] = p
		end
	end
end

function Publisher:_record(kind: string, args: { any })
	local rec = self.rec
	if not rec then
		return
	end
	if kind == "event" and type(args[1]) == "table" and args[1].kind == "recording" then
		return -- (the recorder's own notices are not weather)
	end
	local ok, line = pcall(HttpService.JSONEncode, HttpService, self.Frames.encode(kind, self.clock(), args))
	if not ok then
		rec.skipped += 1
		return
	end
	rec.buf ..= line .. "\n"
	rec.frames += 1
	while #rec.buf >= CHUNK do
		self:_flush()
	end
end

function Publisher:_flush()
	local rec = self.rec
	if not rec or #rec.buf == 0 then
		return
	end
	rec.part += 1
	local v = Instance.new("StringValue")
	v.Name = string.format("%04d", rec.part)
	v.Value = string.sub(rec.buf, 1, CHUNK)
	v.Parent = rec.folder
	rec.buf = string.sub(rec.buf, CHUNK + 1)
end

function Publisher:send(kind: string, ...)
	local args = table.pack(...)
	args.n = nil
	self:_remember(kind, args)
	if self.rec then
		-- (a recording problem must never stop the weather reaching the clients)
		local ok, err = pcall(self._record, self, kind, args)
		if not ok then
			warn("[StormLab] recording: " .. tostring(err))
		end
	end
	local remote = self.remotes[kind]
	local joined = self.joined
	for p in joined do
		if not p.Parent then
			joined[p] = nil
			self.nJoined -= 1
		end
	end
	if self.nJoined <= 0 then
		return
	end
	-- (every player present has joined: one broadcast instead of a send per player)
	local players = Players:GetPlayers()
	local all = #players == self.nJoined
	if all then
		for _, p in players do
			if not joined[p] then
				all = false
				break
			end
		end
	end
	if all then
		remote:FireAllClients(...)
		return
	end
	for p in joined do
		remote:FireClient(p, ...)
	end
end

function Publisher:sendTo(player: Player, kind: string, ...)
	self.remotes[kind]:FireClient(player, ...)
end

-- a client is listening: it gets the latest full state, then the broadcasts
function Publisher:join(player: Player)
	if not self.joined[player] then
		self.joined[player] = true
		self.nJoined += 1
	end
	local list = {}
	for _, p in self.profiles do
		table.insert(list, p)
	end
	if #list > 0 then
		self:sendTo(player, "profiles", list)
	end
	for _, kind in { "state", "coldPool", "precip", "precipLite" } do
		local a = self.last[kind]
		if a then
			self:sendTo(player, kind, table.unpack(a))
		end
	end
end

-- forget the remembered state (a new scenario)
function Publisher:reset()
	self.last = {}
	self.profiles = {}
end

function Publisher:record(name: string, meta: { [string]: any }): string
	self:stop()
	local root = ServerStorage:FindFirstChild("StormLabRecordings")
	if not root then
		root = Instance.new("Folder")
		root.Name = "StormLabRecordings"
		root.Parent = ServerStorage
	end
	local old = root:FindFirstChild(name)
	if old then
		old:Destroy()
	end
	local folder = Instance.new("Folder")
	folder.Name = name
	folder:SetAttribute("FrameVersion", self.Frames.VERSION)
	for k, v in meta do
		folder:SetAttribute(k, v)
	end
	folder.Parent = root
	self.rec = { folder = folder, buf = "", part = 0, frames = 0, skipped = 0 }
	-- (a recording starts from the full current state, so it plays back on its own)
	local list = {}
	for _, p in self.profiles do
		table.insert(list, p)
	end
	self:_record("profiles", { list })
	for _, kind in { "state", "coldPool", "precip", "precipLite" } do
		if self.last[kind] then
			self:_record(kind, self.last[kind])
		end
	end
	return folder:GetFullName()
end

function Publisher:stop(): (number, number)
	local rec = self.rec
	if not rec then
		return 0, 0
	end
	while #rec.buf > 0 do
		self:_flush()
	end
	rec.folder:SetAttribute("Frames", rec.frames)
	rec.folder:SetAttribute("Skipped", rec.skipped)
	self.rec = nil
	return rec.frames, rec.skipped
end

function Publisher:recording(): boolean
	return self.rec ~= nil
end

return Publisher
