-- Checks the buildings' tornado damage outside Roblox (2026-11-17), on a Rojo build of the place:
--   1. the generator records its houses and farm buildings (Buildings.take -> ChunkGen.place: a
--      model "B<n>" with DI, Frame, Size and a Role on each part), the same each time it builds;
--   2. every degree of a house and a barn shows (StructureDamage.apply) as its group says, and the
--      debris lies in the same places each time (what makes every server alike);
--   3. the EF components (Sim/Damage) fail alike for the same seed, and a stronger tornado never
--      does less damage.
--   cd roblox && rojo build default.project.json -o build/harness.rbxl
--   lune run tools/worldmap/test-building-damage.luau roblox/build/harness.rbxl
-- (the loader below is run-chunks.luau's)
local fs = require("@lune/fs")
local luau = require("@lune/luau")
local process = require("@lune/process")
local roblox = require("@lune/roblox")
local serde = require("@lune/serde")
local task = require("@lune/task")
local Vector3 = (roblox :: any).Vector3

local placePath, outPath = process.args[1], process.args[2]
local GROUPS, RADIUS = tonumber(process.args[3]) or 8, tonumber(process.args[4]) or 1
-- mode "crossings": visit interchanges and overpasses across the whole map instead of the towns.
local MODE = process.args[5] or "places"
assert(placePath, "usage: run-chunks.luau <place.rbxl> [out.json] [groups] [radius]")
-- (Everything is already in a place read from a file.)
roblox.implementMethod("Instance", "WaitForChild", function(self: any, name: string)
	return self:FindFirstChild(name)
end)
local place = roblox.deserializePlace(fs.readFile(placePath))

-- EncodingService, as far as the map reader uses it.
local B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
local b64Value = table.create(256, 0)
for i = 1, #B64 do
	b64Value[string.byte(B64, i) + 1] = i - 1
end
local EncodingService = {}
function EncodingService:Base64Decode(input: buffer): buffer
	local n = buffer.len(input)
	local pad = 0
	while n - pad > 0 and buffer.readu8(input, n - pad - 1) == 61 do
		pad += 1
	end
	local out = buffer.create(n // 4 * 3 - pad)
	local size, at = buffer.len(out), 0
	for i = 0, n - 4, 4 do
		local v = b64Value[buffer.readu8(input, i) + 1] * 262144 + b64Value[buffer.readu8(input, i + 1) + 1] * 4096
			+ b64Value[buffer.readu8(input, i + 2) + 1] * 64 + b64Value[buffer.readu8(input, i + 3) + 1]
		if at < size then buffer.writeu8(out, at, v // 65536) end
		if at + 1 < size then buffer.writeu8(out, at + 1, (v // 256) % 256) end
		if at + 2 < size then buffer.writeu8(out, at + 2, v % 256) end
		at += 3
	end
	return out
end
function EncodingService:DecompressBuffer(input: buffer, _algorithm: any): buffer
	local text = serde.decompress("zstd", buffer.tostring(input))
	return if type(text) == "string" then buffer.fromstring(text) else text
end

local RunService = { IsStudio = function() return false end }
local workspaceStub = { GetAttribute = function() return nil end }
local game = {
	GetService = function(_, name: string): any
		if name == "EncodingService" then
			return EncodingService
		elseif name == "RunService" then
			return RunService
		end
		return place:GetService(name)
	end,
}

-- Roblox's Random, as far as the damage uses it (a seeded stream: any fixed one will do here).
local RandomStub = {}
RandomStub.__index = RandomStub
function RandomStub.new(seed: number?): any
	return setmetatable({ s = math.floor(seed or 1) % 2147483647 + 1 }, RandomStub)
end
function RandomStub:NextNumber(lo: number?, hi: number?): number
	self.s = (self.s * 48271) % 2147483647
	local u = self.s / 2147483647
	return if lo then lo + (hi :: number - lo) * u else u
end
function RandomStub:NextInteger(lo: number, hi: number): number
	return lo + math.floor(self:NextNumber() * (hi - lo + 1))
end

-- The place's modules, each run once (copies made with Clone are run afresh, as in Roblox).
local cache: { [string]: { value: any } } = {}
local requireModule
local function environment(module: any): { [string]: any }
	local env = {
		script = module, game = game, workspace = workspaceStub, require = function(target: any) return requireModule(target) end,
		task = task, warn = function(...) print("[warn]", ...) end, Random = RandomStub,
	}
	for _, name in { "CFrame", "Vector3", "Vector2", "Color3", "Enum", "Region3", "Instance", "UDim2", "UDim", "NumberRange", "BrickColor", "Rect" } do
		env[name] = (roblox :: any)[name]
	end
	return env
end
function requireModule(module: any): any
	assert(typeof(module) == "Instance", `require of {tostring(module)}: not a module of the place`)
	local key = if module.Parent then module:GetFullName() else nil
	if key and cache[key] then
		return cache[key].value
	end
	local run = luau.load(module.Source, { debugName = module:GetFullName(), environment = environment(module) })
	local value = run()
	if key then
		cache[key] = { value = value }
	end
	return value
end

local Shared = place:GetService("ReplicatedStorage").Shared
local Config = requireModule(Shared.World.Config)
local WorldMap = requireModule(place:GetService("ServerStorage").World.WorldMap)
local ChunkGen = requireModule(place:GetService("ServerStorage").World.ChunkGen)
local StructureDamage = requireModule(place:GetService("ServerStorage").Modules.StructureDamage)
local Damage = requireModule(Shared.StormLab.Sim.Damage)
local Instance = (roblox :: any).Instance

local failures = 0
local function check(ok: boolean, text: string)
	if not ok then
		failures += 1
		print("FAIL " .. text)
	end
end

local SIZE, MILE, HALF = Config.CHUNK_STUDS, Config.DESIGN_STUDS_PER_MILE, Config.MAP_MILES / 2
local function chunkAt(mx: number, my: number): (number, number)
	return math.floor((mx - HALF) * MILE / SIZE), math.floor((my - HALF) * MILE / SIZE)
end
local function placed(cx: number, cz: number): any
	ChunkGen.prepare(cx, cz)
	local chunk = ChunkGen.build(cx, cz)
	local root = Instance.new("Folder")
	return (ChunkGen.place(chunk.props, root, ChunkGen.name(cx, cz)))
end
local function buildingsOf(model: any): { any }
	local out = {}
	for _, m in model:GetChildren() do
		if string.match(m.Name, "^B%d+$") then
			table.insert(out, m)
		end
	end
	table.sort(out, function(a, b)
		return (tonumber(string.sub(a.Name, 2)) :: number) < (tonumber(string.sub(b.Name, 2)) :: number)
	end)
	return out
end
local function roleCount(m: any): { [string]: number }
	local out = {}
	for _, p in m:GetChildren() do
		local r = p:GetAttribute("Role")
		if r then
			out[r] = (out[r] or 0) + 1
		end
	end
	return out
end

-- 1. Records: a town's chunks (houses) and the country beside it (farmsteads).
-- (the biggest places first: the metro's towers, the city's malls and campuses, then towns)
local towns = {}
for _, s in WorldMap.meta.settlements do
	table.insert(towns, s)
end
table.sort(towns, function(a, b)
	return a.population > b.population
end)
local found: { [string]: any } = {}
local counts: { [string]: number } = { house = 0, barn = 0 }
local visits = {}
for i = 1, math.min(8, #towns) do
	local s = towns[i]
	table.insert(visits, { s.x + 0.15, s.y + 0.15 })
	table.insert(visits, { s.x + s.coreMi + 0.3, s.y - 0.2 })
	table.insert(visits, { s.x + s.extentMi + 1.3, s.y + 0.7 })
	table.insert(visits, { s.x - s.extentMi - 1.6, s.y - 0.9 })
end
-- (apartments: a city's core round downtown, outside its land-use areas; malls, big boxes, travel
-- centres and campuses: their sites)
local Sites = requireModule(place:GetService("ServerStorage").World.Sites)
local wantKinds = { mall = 2, shopping = 2, travel = 2 }
local campuses = 0
for i = 1, math.min(8, #towns) do
	local s = towns[i]
	if i <= 3 then
		for _, a in { 0, 1.6, 3.2, 4.7 } do
			table.insert(visits, { s.x + math.cos(a) * s.coreMi * 0.4, s.y + math.sin(a) * s.coreMi * 0.4 })
		end
	end
	local x, z = WorldMap.studsAt(s.x, s.y)
	local ext = s.extentMi * MILE
	local set = Sites.near(x - ext, z - ext, x + ext, z + ext, 0)
	for _, c in set.campuses do
		if campuses < 2 then
			campuses += 1
			local cx, cz = Sites.rect(c.area)
			table.insert(visits, { cx / MILE + HALF, cz / MILE + HALF })
		end
	end
	for _, area in set.areas do
		if area.block and (wantKinds[area.kind] or 0) > 0 then
			wantKinds[area.kind] -= 1
			local b = area.box
			table.insert(visits, { (b[1] + b[3]) / 2 / MILE + HALF, (b[2] + b[4]) / 2 / MILE + HALF })
		end
	end
end
local chunksSeen = 0
for _, v in visits do
	local cx0, cz0 = chunkAt(v[1], v[2])
	for dx = -1, 1 do
		for dz = -1, 1 do
			local cx, cz = cx0 + dx, cz0 + dz
			local ok, model = pcall(placed, cx, cz)
			check(ok, "chunk " .. cx .. "," .. cz .. " builds: " .. (if ok then "" else tostring(model)))
			if ok then
				chunksSeen += 1
				for _, b in buildingsOf(model) do
					local di = b:GetAttribute("DI")
					counts[di] = (counts[di] or 0) + 1
					check(Damage.DI[di] ~= nil, b.Name .. ": DI " .. tostring(di) .. " is an indicator")
					check(typeof(b:GetAttribute("Frame")) == "CFrame" and typeof(b:GetAttribute("Size")) == "Vector3", b.Name .. ": Frame and Size")
					local roles = roleCount(b)
					check((roles.wall or 0) >= 1, b.Name .. " (" .. tostring(di) .. "): has walls")
					if not found[di] and (roles.wall or 0) >= 1 and (di ~= "house" or ((roles.roof or 0) >= 1 and (roles.glass or 0) >= 1)) then
						found[di] = { cx = cx, cz = cz, name = b.Name }
					end
				end
			end
		end
	end

end
local kinds = {}
for di, n in counts do
	table.insert(kinds, di .. " " .. n)
end
table.sort(kinds)
print(("chunks built: %d; buildings by indicator: %s"):format(chunksSeen, table.concat(kinds, ", ")))
check(found.house ~= nil, "a house with roof and windows was found")
check(found.barn ~= nil, "a farm building with a roof was found")

-- the same chunk built again: the same buildings in the same places
local function signature(model: any): string
	local out = {}
	for _, b in buildingsOf(model) do
		local f = b:GetAttribute("Frame")
		table.insert(out, ("%s:%s:%d:%d:%d"):format(b.Name, b:GetAttribute("DI"), math.floor(f.X * 100), math.floor(f.Z * 100), #b:GetChildren()))
	end
	return table.concat(out, "|")
end
if found.house then
	local a, b = placed(found.house.cx, found.house.cz), placed(found.house.cx, found.house.cz)
	check(signature(a) == signature(b) and signature(a) ~= "", "a chunk built twice records the same buildings")
end

-- a chunk's buildings planned without building it (ChunkGen.structures, the survey's unseen
-- ground) are the buildings it places
if found.house then
	local cx, cz = found.house.cx, found.house.cz
	ChunkGen.prepare(cx, cz)
	local plan = ChunkGen.structures(ChunkGen.build(cx, cz).props)
	local out = {}
	for _, s in plan do
		table.insert(out, ("B%d:%s:%d:%d"):format(s.n, s.di, math.floor(s.frame.X * 100), math.floor(s.frame.Z * 100)))
	end
	local placedOut = {}
	for _, b in buildingsOf(placed(cx, cz)) do
		local f = b:GetAttribute("Frame")
		table.insert(placedOut, ("%s:%s:%d:%d"):format(b.Name, b:GetAttribute("DI"), math.floor(f.X * 100), math.floor(f.Z * 100)))
	end
	check(#out > 0 and table.concat(out, "|") == table.concat(placedOut, "|"), "a chunk's planned buildings are the ones it places")
end

-- 2. Every degree shows, and its debris lies alike each time.
local function walk(kind: string): (string, { string })
	local spot = found[kind]
	local model = placed(spot.cx, spot.cz)
	local b = model:FindFirstChild(spot.name)
	local frame = b:GetAttribute("Frame")
	local function ground(_x: number, _z: number): number
		return frame.Y
	end
	local dx, dz = StructureDamage.dirOf(64) -- toward the east
	local log = {}
	local roofChecked = false
	local h0 = 0
	for _, p in b:GetChildren() do
		if p:GetAttribute("Role") == "wall" then
			h0 = math.max(h0, p.Size.Y)
		end
	end
	for degree = 1, #Damage.DI[kind] do
		local group = Damage.DI[kind][degree][8]
		if group == "roofFrame" and not roofChecked then
			roofChecked = true
			check((roleCount(b).roof or 0) > 0, kind .. " " .. degree .. ": a roof to lose")
		end
		StructureDamage.apply(b, kind, degree, dx, dz, 4242, ground, false)
		local roles = roleCount(b)
		local hw = 0
		for _, p in b:GetChildren() do
			if p:GetAttribute("Role") == "wall" then
				hw = math.max(hw, p.Size.Y)
			end
		end
		local rf = b:FindFirstChild("Rubble")
		local pieces = if rf then #rf:GetChildren() else 0
		table.insert(log, ("  %s %d %s: walls %d (height %d%%), roof %d, glass %d, door %d, slab %d, debris %d"):format(
			kind, degree, group, roles.wall or 0, math.floor(hw / math.max(h0, 1e-6) * 100), roles.roof or 0, roles.glass or 0, roles.door or 0, roles.slab or 0, pieces))
		if group == "windows" or group == "curtain" then
			check((roles.glass or 0) == 0, kind .. " " .. degree .. ": glass gone")
		elseif group == "roofFrame" then
			check((roles.roof or 0) == 0, kind .. " " .. degree .. ": roof gone")
		elseif group == "extWalls" then
			check(hw <= h0 * 0.46 + 1e-6 or (roles.wall or 0) == 0, kind .. " " .. degree .. ": walls under half")
		elseif group == "slab" then
			check((roles.slab or 0) == 1 and (roles.wall or 0) == 0, kind .. " " .. degree .. ": a bare slab")
		end
	end
	local rf = b:FindFirstChild("Rubble")
	local list = if rf then rf:GetChildren() else {}
	local rubble, east = {}, 0
	for _, p in list do
		local c = p.CFrame
		table.insert(rubble, ("%d,%d,%d"):format(math.floor(c.X * 1000), math.floor(c.Z * 1000), math.floor(p.Size.X * 1000)))
		if c.X > frame.X then
			east += 1
		end
	end
	table.sort(rubble)
	check(east >= #rubble * 0.6, ("%s: debris lies downwind (%d of %d east)"):format(kind, east, #rubble))
	local last = Damage.DI[kind][#Damage.DI[kind]][8]
	if last == "slab" then
		check(roleCount(b).wall == nil, kind .. ": nothing standing at its last degree")
	end
	return table.concat(rubble, ";"), log
end
local walked = {}
for kind in found do
	table.insert(walked, kind)
end
table.sort(walked)
for _, kind in walked do
	if found[kind] then
		local a, log = walk(kind)
		local b = walk(kind)
		for _, line in log do
			print(line)
		end
		check(a == b and a ~= "", kind .. ": debris in the same places when shown again")
	end
end

-- 2b. A lifted tornado run past a chunk's planned buildings (SurveyReplay, the survey's jobs):
-- alike every time, nothing beyond its edge, a stronger tornado never does less.
local SurveyReplay = requireModule(place:GetService("ServerStorage").Modules.SurveyReplay)
do
	local spot = found.MRB or found.LRB or found.house
	ChunkGen.prepare(spot.cx, spot.cz)
	local plan = ChunkGen.structures(ChunkGen.build(spot.cx, spot.cz).props)
	local bx, by = WorldMap.worldMilesAt(plan[1].frame.X, plan[1].frame.Z)
	local function pass(mph: number): ({ any }, { any }, { any })
		local samples = SurveyReplay.samples({ { bx - 1, by + 0.01, 20, mph, 600 }, { bx + 1, by + 0.01, 20.1, mph, 600 } })
		local recs, events = SurveyReplay.run(spot.cx, spot.cz, plan, samples)
		return recs, events, samples
	end
	local recs, events, samples = pass(190)
	local recs2, events2 = pass(190)
	local function text(list: { any }): string
		local out = {}
		for _, e in list do
			table.insert(out, table.concat(e, ","))
		end
		return table.concat(out, "|")
	end
	check(#recs > 0 and #recs == #events, "a 190 mph tornado over a town chunk breaks something")
	check(text(events) == text(events2), "a survey replay is the same each time")
	local edge = 600 / 1760 / 2
	local beyond = true
	local worst: { [number]: number } = {}
	for _, e in events do
		local x, y = e[4], e[5]
		if math.abs(y - (by + 0.01)) > edge + 0.002 then
			beyond = false
		end
		worst[e[2]] = math.max(worst[e[2]] or 0, e[6])
	end
	check(beyond, "nothing breaks beyond the tornado's edge")
	local _, weak = pass(120)
	local weaker = true
	for _, e in weak do
		if e[6] > (worst[e[2]] or 0) then
			weaker = false
		end
	end
	check(weaker and #weak <= #events, "a weaker tornado never does more")
	local name = ChunkGen.name(spot.cx, spot.cz)
	local listed, skipped = false, false
	for _, ch in SurveyReplay.chunks(samples, {}) do
		listed = listed or ch.name == name
	end
	for _, ch in SurveyReplay.chunks(samples, { [name] = true }) do
		skipped = skipped or ch.name == name
	end
	check(listed and not skipped, "the swath's chunks, without those already looked at")
	print(("survey replay: %d buildings planned, %d failures at 190 mph, %d at 120 mph"):format(#plan, #events, #weak))
end

-- 2c. The messages to the other servers: each within 1 kB, everything sent, the live flag kept.
local DamageMessages = requireModule(place:GetService("ServerStorage").Modules.DamageMessages)
do
	local outgoing = {}
	local big = {}
	for n = 1, 300 do
		table.insert(big, { n = n, degree = 1 + n % 9, dir = (n * 37) % 256 })
	end
	table.insert(outgoing, { c = "-1234,567", list = big, live = true })
	for k = 1, 5 do
		table.insert(outgoing, { c = `{k},{-k}`, list = { { n = k, degree = 2, dir = 64 } }, live = false })
	end
	local got: { [string]: { any } } = {}
	local liveOk, sizeOk, messages = true, true, 0
	while true do
		local batch = DamageMessages.pack(outgoing, 900)
		if not batch then
			break
		end
		messages += 1
		local bytes = 40
		for _, e in batch do
			bytes += #e[1] + #e[2] + 16
			got[e[1]] = got[e[1]] or {}
			DamageMessages.merge(got[e[1]], DamageMessages.decode(e[2]))
			if (e[1] == "-1234,567") ~= (e[3] == 1) then
				liveOk = false
			end
		end
		sizeOk = sizeOk and bytes <= 1000
	end
	check(#(got["-1234,567"] or {}) == 300 and #(got["3,-3"] or {}) == 1, "every record sent")
	check(sizeOk and liveOk, "each message within 1 kB, live records marked live")
	print(("messages: 305 records in %d messages"):format(messages))
end

-- 3. The EF components: alike for a seed; a stronger tornado never does less.
local function pass(seed: number, peakMph: number): number
	local s = Damage.newStructure("t", "house", 0, 0, 8, seed, 1)
	-- the tornado's core crossing: the gust up to its peak and down again, 4 game-s a step
	for k = -12, 12 do
		local v = peakMph * 0.44704 * math.exp(-(k / 5) ^ 2)
		Damage.apply(s, 4, v, v)
	end
	return s.stage
end
local monotone, alike = true, true
local line = {}
for _, seed in { 11, 222, 3333, 44444 } do
	local last = 0
	for mph = 60, 230, 10 do
		local st = pass(seed, mph)
		if st < last then
			monotone = false
		end
		last = st
		if pass(seed, mph) ~= st then
			alike = false
		end
		if seed == 11 and mph % 30 == 0 then
			table.insert(line, mph .. " mph: DOD " .. st)
		end
	end
end
print("house, one seed: " .. table.concat(line, ", "))
check(monotone, "a stronger pass never does less damage")
check(alike, "the same seed and wind give the same damage")

print(if failures == 0 then "OK: building damage checks pass" else failures .. " check(s) failed")
process.exit(if failures == 0 then 0 else 1)
