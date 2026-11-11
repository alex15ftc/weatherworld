--!nonstrict
-- The trees' breaking (2026-11-11): every tree the chunk generator stands up is recorded on its
-- chunk's props model ("Trees", Shared/Foliage/Records); this server loads each loaded tree with
-- the 3-s gust over it (Modules/FoliageWind: the same shared weather on every server) through the
-- wood mechanics (Shared/Foliage/Mechanics, checked against the EF scale's tree indicator), and
-- writes what breaks onto the chunk ("TreeDamage"), which every client draws (FoliageController:
-- the skinned tree swapped for its pieces at its current pose, the broken part falling to the
-- rest pose Mechanics.rest gives everywhere alike).
--
-- Only where it matters: each loaded chunk is sampled at its middle every TICK s, and its trees
-- one by one only while that gust is over HOT_MS or a tornado is within reach of it (most of the
-- time none are). At most BUDGET_TREES trees a tick, round-robin.
--
-- Damage is permanent and shared by every server (the owner, 2026-11-11): kept in the DataStore
-- STORE, one key a region of REGION x REGION chunks ({ [chunk name] = Records damage }), merged
-- (union) on every write; read when a region's first chunk loads; written at most every FLUSH s
-- a region; and published on MessagingService TOPIC so the other running servers draw a break at
-- once. Without DataStore access (Studio without API services) damage lasts the session.
local DataStoreService = game:GetService("DataStoreService")
local MessagingService = game:GetService("MessagingService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerStorage = game:GetService("ServerStorage")
local HttpService = game:GetService("HttpService")

local Shared = ReplicatedStorage.Shared
local Config = require(Shared.World.Config)
local Profiler = require(Shared.Profiler)
local Rig = require(Shared.Foliage.Rig)
local Mechanics = require(Shared.Foliage.Mechanics)
local Records = require(Shared.Foliage.Records)
local Assets = require(Shared.Foliage.Assets)
local Noise = require(Shared.StormLab.Sim.Noise)
local WorldMap = require(ServerStorage.World.WorldMap)
local FoliageWind = require(ServerStorage.Modules.FoliageWind)

local FoliageService = {}

local TICK = 1 -- s
local HOT_MS = 17 -- m/s (38 mph) 3-s gust at a chunk's middle: below this no tree part can break
local BUDGET_TREES = 2500
local REGION = 16 -- chunks a side
local FLUSH = 30 -- s
local STORE = "FoliageDamage1"
local TOPIC = "FoliageDamage1"

type Chunk = {
	model: Model,
	name: string,
	cx: number, cz: number,
	trees: { Records.Tree },
	damage: { Records.Damage },
	states: { [number]: any },
	cursor: number,
}
type Region = { key: string, loaded: boolean, data: { [string]: string }, dirty: boolean, lastFlush: number }

local chunks: { [Model]: Chunk } = {}
local byName: { [string]: Chunk } = {}
local regions: { [string]: Region } = {}
local store: DataStore? = nil

FoliageService.stats = { evaluated = 0, hotChunks = 0, breaks = 0 }

local function regionKey(cx: number, cz: number): string
	return `r{cx // REGION}_{cz // REGION}`
end

local function seedOf(c: Chunk, i: number): number
	return Noise.hashInt(c.cx, c.cz, i, 51) % 2147483647
end

-- tree-local direction from a world one (the tree turned by yaw about y)
local function toLocal(dx: number, dz: number, yaw: number): (number, number)
	local c, s = math.cos(yaw), math.sin(yaw)
	-- local x axis in world (c, 0, -s), local z axis (s, 0, c)
	return dx * c - dz * s, dx * s + dz * c
end

local function stateOf(c: Chunk, i: number): any
	local st = c.states[i]
	if st then
		return st
	end
	local t = c.trees[i]
	local rig = Rig.get(t.name)
	st = Mechanics.newState(rig, seedOf(c, i))
	for _, d in c.damage do
		if d.tree == i then
			Mechanics.apply(rig, st, d.bone)
		end
	end
	c.states[i] = st
	return st
end

local function merge(into: { Records.Damage }, add: { Records.Damage }): boolean
	local have = {}
	for _, d in into do
		have[d.tree * 256 + d.bone] = true
	end
	local changed = false
	for _, d in add do
		local k = d.tree * 256 + d.bone
		if not have[k] then
			have[k] = true
			table.insert(into, d)
			changed = true
		end
	end
	return changed
end

local function publishAttribute(c: Chunk)
	c.model:SetAttribute("TreeDamage", Records.encodeDamage(c.damage))
end

-- damage from elsewhere (the store, another server) into a loaded chunk
local function absorb(c: Chunk, list: { Records.Damage })
	if merge(c.damage, list) then
		for _, d in list do
			local st = c.states[d.tree]
			if st then
				Mechanics.apply(Rig.get(c.trees[d.tree].name), st, d.bone)
			end
		end
		publishAttribute(c)
	end
end

local function loadRegion(key: string): Region
	local r = regions[key]
	if r then
		return r
	end
	r = { key = key, loaded = false, data = {}, dirty = false, lastFlush = os.clock() }
	regions[key] = r
	if store then
		task.spawn(function()
			local ok, value = pcall(function()
				return (store :: DataStore):GetAsync(key)
			end)
			if ok and type(value) == "table" then
				for name, s in value do
					if type(s) == "string" then
						local list = Records.decodeDamage(s)
						local mine = Records.decodeDamage(r.data[name] or "")
						merge(mine, list)
						r.data[name] = Records.encodeDamage(mine)
						local c = byName[name]
						if c then
							absorb(c, list)
						end
					end
				end
			end
			r.loaded = true
		end)
	else
		r.loaded = true
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
					local list = Records.decodeDamage(if type(out[name]) == "string" then out[name] else "")
					merge(list, Records.decodeDamage(s))
					out[name] = Records.encodeDamage(list)
				end
				return out
			end)
		end)
		if not ok then
			r.dirty = true
			warn("[Foliage] saving " .. r.key .. " failed: " .. tostring(err))
		end
	end)
end

local function track(model: Instance)
	if not model:IsA("Model") or chunks[model] then
		return
	end
	local text = model:GetAttribute("Trees")
	if type(text) ~= "string" then
		return
	end
	local cx, cz = string.match(model.Name, "^(%-?%d+),(%-?%d+)$")
	if not cx then
		return
	end
	local c: Chunk = {
		model = model, name = model.Name, cx = tonumber(cx) :: number, cz = tonumber(cz) :: number,
		trees = Records.decodeTrees(text), damage = {}, states = {}, cursor = 1,
	}
	chunks[model] = c
	byName[c.name] = c
	local r = loadRegion(regionKey(c.cx, c.cz))
	local saved = r.data[c.name]
	if saved then
		absorb(c, Records.decodeDamage(saved))
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

-- a break here: on the chunk now, in its region's record, and to the other servers
local function broke(c: Chunk, list: { Records.Damage })
	merge(c.damage, list)
	publishAttribute(c)
	FoliageService.stats.breaks += #list
	local r = loadRegion(regionKey(c.cx, c.cz))
	local mine = Records.decodeDamage(r.data[c.name] or "")
	merge(mine, list)
	r.data[c.name] = Records.encodeDamage(mine)
	r.dirty = true
	task.spawn(pcall, function()
		MessagingService:PublishAsync(TOPIC, HttpService:JSONEncode({ c = c.name, d = Records.encodeDamage(list), j = game.JobId }))
	end)
end

-- where tornadoes are (studs) and how far their damaging winds can reach (studs)
local function hotspots(): { { x: number, z: number, reach: number } }
	local out = {}
	local host = FoliageService.host
	local st = host and host.state
	local c = st and st.centreKm
	local function add(kx: number, ky: number, reachM: number)
		local sx, sz = WorldMap.studsAt(kx / Config.KM_PER_MILE, ky / Config.KM_PER_MILE)
		local studsPerM = Config.STUDS_PER_MILE / (Config.KM_PER_MILE * 1000)
		table.insert(out, { x = sx, z = sz, reach = reachM * studsPerM + Config.CHUNK_STUDS })
	end
	if st and st.world and c then
		for _, t in st.world.tornadoes or {} do
			if not t.ended and t.x and t.y then
				add(c.x + t.x / 1000, c.y - t.y / 1000, 3000)
			end
		end
	end
	local live = FoliageService.live
	if live then
		for _, s in live.stormsNow() do
			local t = s.frame.tornado
			if t and t.mph > 0 then
				local f = s.frame
				add(s.xKm + (t.x - f.anchorX) / 1000, s.yKm - (t.y - f.anchorY) / 1000, math.max(12 * t.R, 1500))
			end
		end
	end
	return out
end

local function tick()
	local now = workspace:GetServerTimeNow()
	local spots = hotspots()
	local budget = BUDGET_TREES
	local hot = 0
	for _, c in chunks do
		if not c.model.Parent then
			continue
		end
		local mx, mz = (c.cx + 0.5) * Config.CHUNK_STUDS, (c.cz + 0.5) * Config.CHUNK_STUDS
		local near = false
		for _, s in spots do
			if (s.x - mx) ^ 2 + (s.z - mz) ^ 2 < s.reach * s.reach then
				near = true
				break
			end
		end
		if not near then
			local g = FoliageWind.gustAt(mx, mz)
			if g < HOT_MS then
				continue
			end
		end
		hot += 1
		local n = #c.trees
		local found: { Records.Damage } = {}
		for _ = 1, math.min(n, budget) do
			local i = c.cursor
			c.cursor = c.cursor % n + 1
			budget -= 1
			local t = c.trees[i]
			local st = stateOf(c, i)
			if st.down then
				continue
			end
			local g, dx, dz = FoliageWind.gustAt(t.x, t.z)
			if g < HOT_MS * 0.8 then
				continue
			end
			FoliageService.stats.evaluated += 1
			local qx, qz = Records.quantiseDir(dx, dz)
			local lx, lz = toLocal(qx, qz, t.yaw)
			for _, b in Mechanics.step(Rig.get(t.name), st, g, lx, lz, TICK) do
				table.insert(found, { tree = i, bone = b.bone, dirX = qx, dirZ = qz, at = now, gust = g })
			end
		end
		if #found > 0 then
			broke(c, found)
		end
		if budget <= 0 then
			break
		end
	end
	FoliageService.stats.hotChunks = hot
	for _, r in regions do
		if r.dirty and os.clock() - r.lastFlush > FLUSH then
			flush(r)
		end
	end
end

function FoliageService.Init()
	local ok, ds = pcall(DataStoreService.GetDataStore, DataStoreService, STORE)
	store = if ok then ds else nil
end

-- The generated trees' models (Foliage/Assets) into ReplicatedStorage.FoliageTemplates.<tree>,
-- for the clients to clone (they cannot load assets themselves): "Rig", a Model of the skinned
-- MeshPart "Tree" and the importer's "RootPart" holding the Bones, and "Pieces", the break meshes
-- at their rest places. Roblox's importer brings the FBX in at a stud a metre: scaled here to the
-- game's true size (the first trunk bone's length against the rig data), and given the atlas.
local function loadTemplates()
	local InsertService = game:GetService("InsertService")
	local K = Config.STUDS_PER_METRE
	local folder = ReplicatedStorage:FindFirstChild("FoliageTemplates") or Instance.new("Folder")
	folder.Name = "FoliageTemplates"
	for name, ids in Assets.trees do
		if folder:FindFirstChild(name) or not ids.model or ids.model == 0 then
			continue
		end
		local ok, res = pcall(InsertService.LoadAsset, InsertService, ids.model)
		if not ok then
			warn(`[Foliage] loading {name} ({ids.model}) failed: {res}`)
			continue
		end
		local src = res:FindFirstChildWhichIsA("Model") or res
		local poses = src:FindFirstChild("InitialPoses")
		if poses then
			poses:Destroy()
		end
		for _, d in src:GetDescendants() do
			if d:IsA("BasePart") then
				d.Anchored = true
				d.CanCollide = false
				d.CanTouch = false
				d.CanQuery = false
				if d:IsA("MeshPart") then
					if ids.atlas and ids.atlas ~= 0 and d.TextureID == "" then
						d.TextureID = "rbxassetid://" .. ids.atlas
					end
					-- (a MeshPart's texture alpha cuts the leaf cards out only when the part is a
					-- touch transparent: Studio 2026-11-11)
					d.Transparency = 0.02
				end
			end
		end
		local rig = Rig.get(name)
		local b1, b2 = src:FindFirstChild(rig.names[1], true), src:FindFirstChild(rig.names[2], true)
		if b1 and b2 and b1:IsA("Bone") and b2:IsA("Bone") then
			local got = (b2.WorldPosition - b1.WorldPosition).Magnitude
			src.WorldPivot = CFrame.new(b1.WorldPosition)
			if got > 1e-3 then
				src:ScaleTo(src:GetScale() * rig.length[1] * K / got)
			end
		else
			warn(`[Foliage] {name}: the rig's first bones are missing`)
		end
		local entry = Instance.new("Folder")
		entry.Name = name
		local pieces = Instance.new("Folder")
		pieces.Name = "Pieces"
		for _, c in src:GetChildren() do
			if c:IsA("MeshPart") and string.match(c.Name, "^Piece_") then
				c.Parent = pieces
			end
		end
		src.Name = "Rig"
		src.Parent = entry
		pieces.Parent = entry
		entry.Parent = folder
	end
	folder.Parent = ReplicatedStorage
end

function FoliageService.Start()
	task.spawn(loadTemplates)
	FoliageService.host = require(script.Parent.StormHostService)
	FoliageService.live = require(script.Parent.LiveStormsService)
	FoliageWind.bind(FoliageService.host, FoliageService.live)
	-- (a check that the store answers: Studio without API services has none)
	if store then
		local ok = pcall(function()
			(store :: DataStore):GetAsync("probe")
		end)
		if not ok then
			store = nil
			warn("[Foliage] no DataStore access: tree damage lasts this session only")
		end
	end
	pcall(function()
		MessagingService:SubscribeAsync(TOPIC, function(msg)
			local ok, body = pcall(HttpService.JSONDecode, HttpService, msg.Data)
			if not ok or type(body) ~= "table" or body.j == game.JobId then
				return
			end
			local list = Records.decodeDamage(body.d or "")
			local c = byName[body.c]
			if c then
				absorb(c, list)
			end
			local cx, cz = string.match(body.c or "", "^(%-?%d+),(%-?%d+)$")
			if cx then
				local r = regions[regionKey(tonumber(cx) :: number, tonumber(cz) :: number)]
				if r then
					local mine = Records.decodeDamage(r.data[body.c] or "")
					merge(mine, list)
					r.data[body.c] = Records.encodeDamage(mine)
				end
			end
		end)
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
			Profiler.Begin("Foliage")
			local ok, err = pcall(tick)
			Profiler.End()
			if not ok then
				warn("[Foliage] " .. tostring(err))
			end
		end
	end)
end

return FoliageService
