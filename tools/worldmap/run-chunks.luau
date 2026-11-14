-- Runs the Roblox world generator outside Roblox, on a Rojo build of the place, and checks what
-- it puts on the ground: every chunk in a few 3 x 3 groups (the metro, the city, towns, an
-- interchange, open country) is built with ChunkGen.build exactly as the game builds it (the
-- place's own modules, loaded from the file), and the buildings' footprints are tested against
-- the roads, each other (within a chunk and across chunk edges), water and bridges.
--   cd roblox && rojo build default.project.json -o build/harness.rbxl
--   lune run tools/worldmap/run-chunks.luau roblox/build/harness.rbxl [out.json] [groups] [radius]
-- groups: how many places to visit (default 8); radius: chunks either side of each (default 1).
-- A chunk that throws is reported with its error: this is also the offline check that the
-- generator runs at all.
local fs = require("@lune/fs")
local luau = require("@lune/luau")
local process = require("@lune/process")
local roblox = require("@lune/roblox")
local serde = require("@lune/serde")
local task = require("@lune/task")

local placePath, outPath = process.args[1], process.args[2]
local GROUPS, RADIUS = tonumber(process.args[3]) or 8, tonumber(process.args[4]) or 1
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

-- The place's modules, each run once (copies made with Clone are run afresh, as in Roblox).
local cache: { [string]: { value: any } } = {}
local requireModule
local function environment(module: any): { [string]: any }
	local env = {
		script = module, game = game, workspace = workspaceStub, require = function(target: any) return requireModule(target) end,
		task = task, warn = function(...) print("[warn]", ...) end,
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

local World = place:GetService("ServerStorage").World
local Config = requireModule(place:GetService("ReplicatedStorage").Shared.World.Config)
local WorldMap = requireModule(World.WorldMap)
local ChunkGen = requireModule(World.ChunkGen)
local RoadNet = requireModule(World.Props.RoadNet)
local Buildings = requireModule(World.Props.Buildings)
local Roads = requireModule(World.Props.Roads)

-- What each chunk's builders were handed (their contexts hold the network and the footprints).
local seenBuildings, seenRoads
local buildBuildings, buildRoads = Buildings.build, Roads.build
Buildings.build = function(ctx)
	seenBuildings = ctx
	return buildBuildings(ctx)
end
Roads.build = function(ctx)
	seenRoads = ctx
	return buildRoads(ctx)
end

local SIZE, MILE, HALF = Config.CHUNK_STUDS, Config.STUDS_PER_MILE, Config.MAP_MILES / 2
local meta = WorldMap.meta

-- Places to visit: the largest of each kind of settlement, more towns, an interchange and open land.
local places: { { name: string, x: number, z: number } } = {}
local function addPlace(name: string, mx: number, my: number)
	table.insert(places, { name = name, x = (mx - HALF) * MILE, z = (my - HALF) * MILE })
end
local byKind: { [string]: { any } } = {}
for _, s in meta.settlements do
	byKind[s.kind] = byKind[s.kind] or {}
	table.insert(byKind[s.kind], s)
end
for _, kind in { "metro", "city", "smallCity", "town" } do
	local list = byKind[kind] or {}
	table.sort(list, function(a, b) return a.population > b.population end)
	for i = 1, math.min(#list, if kind == "town" then 3 else 1) do
		local s = list[i]
		addPlace(`{s.name} ({kind}) centre`, s.x, s.y)
		if kind ~= "town" then
			addPlace(`{s.name} ({kind}) suburbs`, s.x + s.coreMi + (s.extentMi - s.coreMi) * 0.5, s.y + 0.4)
		end
	end
end
do
	-- An interchange and an overpass from the first map tile that lists them near the city.
	local city = (byKind.city or byKind.metro)[1]
	local tile = WorldMap.tilesFor(city.x - 1, city.y - 1, city.x + 1, city.y + 1)[1]
	local found = {}
	for i = 1, #tile.crossings, 11 do
		local kind = tile.crossings[i]
		if not found[kind] then
			found[kind] = true
			addPlace(if kind == 1 then "an interchange" else "an overpass", tile.crossings[i + 2], tile.crossings[i + 3])
		end
	end
	addPlace("open country", city.x + 40.5, city.y + 30.5)
end
while #places > GROUPS do
	table.remove(places)
end

-- Geometry.
local function toSegment(x: number, z: number, g: any): number
	return (RoadNet.toSegment(g, x, z))
end
type Foot = { x: number, z: number, ux: number, uz: number, hx: number, hz: number, chunk: string, inside: boolean }
local function corners(f: Foot): { { number } }
	local out = {}
	for _, c in { { -1, -1 }, { 1, -1 }, { 1, 1 }, { -1, 1 } } do
		table.insert(out, { f.x + f.ux * c[1] * f.hx - f.uz * c[2] * f.hz, f.z + f.uz * c[1] * f.hx + f.ux * c[2] * f.hz })
	end
	return out
end
-- How far two rectangles overlap (the least depth over the separating axes; 0 if apart).
local function overlap(a: Foot, b: Foot): number
	local least = math.huge
	for _, f in { a, b } do
		for _, axis in { { f.ux, f.uz }, { -f.uz, f.ux } } do
			local function span(g: Foot): (number, number)
				local lo, hi = math.huge, -math.huge
				for _, c in corners(g) do
					local p = c[1] * axis[1] + c[2] * axis[2]
					lo, hi = math.min(lo, p), math.max(hi, p)
				end
				return lo, hi
			end
			local a0, a1 = span(a)
			local b0, b1 = span(b)
			local depth = math.min(a1, b1) - math.max(a0, b0)
			if depth <= 0 then
				return 0
			end
			least = math.min(least, depth)
		end
	end
	return least
end
-- How far a footprint reaches into a road (its sidewalks included): sampled every 3 studs.
local function intoRoad(f: Foot, g: any): number
	local worst = 0
	local nx, nz = math.max(1, math.ceil(2 * f.hx / 3)), math.max(1, math.ceil(2 * f.hz / 3))
	for i = 0, nx do
		for j = 0, nz do
			local a, b = (i / nx * 2 - 1) * f.hx, (j / nz * 2 - 1) * f.hz
			local x, z = f.x + f.ux * a - f.uz * b, f.z + f.uz * a + f.ux * b
			worst = math.max(worst, g.spec.total - toSegment(x, z, g))
		end
	end
	return worst
end

local report = { groups = {}, totals = { chunks = 0, failed = 0, footprints = 0, intoRoad = 0, overlapInChunk = 0, overlapAcross = 0, inWater = 0, props = 0, seconds = 0 } }
local totals = report.totals
local examples: { [string]: { string } } = {}
local function note(kind: string, text: string)
	examples[kind] = examples[kind] or {}
	if #examples[kind] < 12 then
		table.insert(examples[kind], text)
	end
end
local falls: { number }, buried: { number } = {}, {}
local roadGaps: { number } = {}
local roadSamples, roadPokes, roadFloats = 0, 0, 0
local function miles(x: number, z: number): string
	return string.format("(%.3f, %.3f) mi", x / MILE + HALF, z / MILE + HALF)
end

for _, placeAt in places do
	local cx0, cz0 = math.floor(placeAt.x / SIZE), math.floor(placeAt.z / SIZE)
	local group = { name = placeAt.name, chunks = 0, failed = 0, footprints = 0, intoRoad = 0, overlapInChunk = 0, overlapAcross = 0, inWater = 0, props = 0, segments = 0, errors = {} }
	local feet: { Foot } = {}
	for cx = cx0 - RADIUS, cx0 + RADIUS do
		for cz = cz0 - RADIUS, cz0 + RADIUS do
			seenBuildings, seenRoads = nil, nil
			local started = os.clock()
			local ok, result = pcall(function()
				ChunkGen.prepare(cx, cz)
				return ChunkGen.build(cx, cz)
			end)
			totals.seconds += os.clock() - started
			group.chunks += 1
			if not ok then
				group.failed += 1
				if #group.errors < 3 then
					table.insert(group.errors, `chunk {cx},{cz}: {tostring(result)}`)
				end
				continue
			end
			group.props += #result.props
			-- Roads against the ground under them: a road's slab is BED studs thick with its top
			-- on the grade along its centre line, and the ground is cut to just inside it. Sampled
			-- along every road piece in the chunk, at its middle and near both edges: ground above
			-- the road's top shows through it; ground below the slab's underside leaves it in the air.
			local rc = seenRoads
			if rc then
				for _, g in rc.net.segments do
					if not g.bulb and g.length > 1 then
						for t = 4, g.length - 4, 8 do
							local cx1, cz1 = g.ax + g.ux * t, g.az + g.uz * t
							if rc.inside(cx1, cz1) and not rc.bridged(cx1, cz1, g) then
								local top = rc.gradeTop(cx1, cz1)
								-- (a divided road is sampled in its carriageways: its middle is the grass median)
								for _, across in (if g.spec.median > 0 then { -0.6, -0.85, 0.6, 0.85 } else { 0, -0.85, 0.85 }) do
									local x, z = cx1 - g.uz * across * g.spec.pavement, cz1 + g.ux * across * g.spec.pavement
									if rc.inside(x, z) and not rc.bridged(x, z, g) then
										-- (Where a higher road covers the point, that road's slab is the one laid.)
										local covered = false
										for _, o in rc.net.segments do
											if o ~= g and not o.bulb and o.spec.priority > g.spec.priority and RoadNet.toSegment(o, x, z) < o.spec.pavement then
												covered = true
												break
											end
										end
										if not covered then
											local gap = top - rc.ground(x, z)
											roadSamples += 1
											table.insert(roadGaps, gap)
											if gap < 0.3 then
												roadPokes += 1
												note("groundThroughRoad", string.format("%s: the ground stands %.1f studs above a %s's top at %s", placeAt.name, 0.3 - gap + 0.0, g.spec.key, miles(x, z)))
											elseif gap > 5.5 then
												roadFloats += 1
												local nearest, nd = rc.net:near(x, z, 64)
												note("roadInTheAir", string.format("%s: a %s's top is %.1f studs above the ground at %s (nearest road there: %s at %.0f studs; a bridge or ramp stands there: %s; natural grade there would put the top at %.1f)", placeAt.name, g.spec.key, gap, miles(x, z), if nearest then nearest.spec.key else "none", nd, tostring(rc.bridged(x, z)), rc.ground(x, z) + 3.5 - top))
											end
										end
									end
								end
							end
						end
					end
				end
			end
			local ctx = seenBuildings
			if not ctx then
				continue
			end
			group.segments += #ctx.net.segments
			local mine: { Foot } = {}
			for _, o in ctx.occupied do
				local right = o.cf.RightVector
				local f: Foot = { x = o.cf.X, z = o.cf.Z, ux = right.X, uz = right.Z, hx = o.hx, hz = o.hz, chunk = `{cx},{cz}`, inside = ctx.inside(o.cf.X, o.cf.Z) }
				-- (A chunk also plans the lots just beyond its edge, to keep clear of them; only the
				-- footprints it owns are buildings it stands.)
				if not f.inside then
					continue
				end
				table.insert(mine, f)
				group.footprints += 1
				-- The ground under it: how far it falls across the footprint (a building stands on
				-- the lowest of it, so this is how deep its uphill side is buried).
				local lo, hi = math.huge, -math.huge
				for _, c in corners(f) do
					local y = ctx.ground(c[1], c[2])
					lo, hi = math.min(lo, y), math.max(hi, y)
				end
				table.insert(falls, hi - lo)
				if o.cf.Y ~= 0 then -- (footprints kept only to hold ground, such as a farmstead's yard, carry no height)
					table.insert(buried, hi - o.cf.Y)
				end
				if hi - lo > 8 then
					note("steepGround", string.format("%s: the ground falls %.1f studs across a %.0f x %.0f footprint at %s", placeAt.name, hi - lo, 2 * f.hx, 2 * f.hz, miles(f.x, f.z)))
				end
				-- Roads.
				local worst, worstRoad = 0, nil
				for _, g in ctx.net.segments do
					if (g.ax - f.x) ^ 2 + (g.az - f.z) ^ 2 < (g.length + g.spec.total + f.hx + f.hz + 4) ^ 2 then
						local d = intoRoad(f, g)
						if d > worst then
							worst, worstRoad = d, g
						end
					end
				end
				if worst > 1 and worstRoad then
					group.intoRoad += 1
					note("intoRoad", string.format("%s: a %.0f x %.0f footprint at %s reaches %.1f studs into a %s%s", placeAt.name, 2 * f.hx, 2 * f.hz, miles(f.x, f.z), worst, worstRoad.spec.key, if worstRoad.bulb then " cul-de-sac" else ""))
				end
				-- Water.
				for _, c in corners(f) do
					if ctx.water(c[1], c[2]) then
						group.inWater += 1
						note("inWater", string.format("%s: a %.0f x %.0f footprint at %s stands in water or on a bridge", placeAt.name, 2 * f.hx, 2 * f.hz, miles(f.x, f.z)))
						break
					end
				end
			end
			for i = 1, #mine do
				for j = i + 1, #mine do
					local depth = overlap(mine[i], mine[j])
					if depth > 1 then
						group.overlapInChunk += 1
						note("overlapInChunk", string.format("%s: footprints %.0f x %.0f and %.0f x %.0f overlap by %.1f studs at %s", placeAt.name, 2 * mine[i].hx, 2 * mine[i].hz, 2 * mine[j].hx, 2 * mine[j].hz, depth, miles(mine[i].x, mine[i].z)))
					end
				end
				table.insert(feet, mine[i])
			end
		end
	end
	-- Across chunks: footprints built by different chunks.
	for i = 1, #feet do
		for j = i + 1, #feet do
			local a, b = feet[i], feet[j]
			if a.chunk ~= b.chunk and (a.x - b.x) ^ 2 + (a.z - b.z) ^ 2 < (a.hx + a.hz + b.hx + b.hz) ^ 2 then
				local depth = overlap(a, b)
				if depth > 1 then
					group.overlapAcross += 1
					note("overlapAcross", string.format("%s: chunks %s and %s each put a footprint (%.0f x %.0f, %.0f x %.0f) at %s, overlapping by %.1f studs", placeAt.name, a.chunk, b.chunk, 2 * a.hx, 2 * a.hz, 2 * b.hx, 2 * b.hz, miles(a.x, a.z), depth))
				end
			end
		end
	end
	for _, key in { "chunks", "failed", "footprints", "intoRoad", "overlapInChunk", "overlapAcross", "inWater", "props" } do
		(totals :: any)[key] += (group :: any)[key]
	end
	table.insert(report.groups, group)
	print(string.format("%-34s %2d chunks (%d failed)  %5d props  %4d road pieces  %4d footprints: %d into a road, %d overlap in a chunk, %d across chunks, %d in water",
		placeAt.name, group.chunks, group.failed, group.props, group.segments, group.footprints, group.intoRoad, group.overlapInChunk, group.overlapAcross, group.inWater))
	for _, e in group.errors do
		print("    ERROR " .. e)
	end
end

print(string.format("\ntotal: %d chunks, %d failed, %.1f s; %d footprints: %d into a road, %d overlap in a chunk, %d across chunks, %d in water",
	totals.chunks, totals.failed, totals.seconds, totals.footprints, totals.intoRoad, totals.overlapInChunk, totals.overlapAcross, totals.inWater))
table.sort(falls)
if #falls > 0 then
	local function at(q: number): number
		return falls[math.clamp(math.ceil(q * #falls), 1, #falls)]
	end
	local over4, over8 = 0, 0
	for _, v in falls do
		over4 += if v > 4 then 1 else 0
		over8 += if v > 8 then 1 else 0
	end
	print(string.format("ground under footprints falls (studs): median %.1f, 90%% %.1f, 99%% %.1f, most %.1f; %d over 4 studs, %d over 8", at(0.5), at(0.9), at(0.99), falls[#falls], over4, over8))
end
table.sort(roadGaps)
if #roadGaps > 0 then
	print(string.format("roads against the ground: %d samples; road top above the ground (studs) 1%% %.1f, median %.1f, 99%% %.1f; ground through the road at %d (%.2f%%), road in the air at %d (%.2f%%)",
		roadSamples, roadGaps[math.max(1, math.floor(0.01 * #roadGaps))], roadGaps[math.ceil(0.5 * #roadGaps)], roadGaps[math.ceil(0.99 * #roadGaps)], roadPokes, 100 * roadPokes / roadSamples, roadFloats, 100 * roadFloats / roadSamples))
end
table.sort(buried)
if #buried > 0 then
	local deep = 0
	for _, v in buried do
		deep += if v > 6 then 1 else 0
	end
	print(string.format("uphill corner above the building's floor (studs): median %.1f, 90%% %.1f, most %.1f; %d over 6", buried[math.ceil(0.5 * #buried)], buried[math.ceil(0.9 * #buried)], buried[#buried], deep))
end
for kind, list in examples do
	print(`\n{kind}:`)
	for _, text in list do
		print("  " .. text)
	end
end
if outPath and outPath ~= "" then
	(report :: any).examples = examples
	fs.writeFile(outPath, serde.encode("json", report))
end
