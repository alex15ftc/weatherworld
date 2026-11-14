-- Runs the Roblox world generator outside Roblox, on a Rojo build of the place, and checks what
-- it puts on the ground: every chunk in a few 3 x 3 groups (the metro, the city, towns, an
-- interchange, open country) is built with ChunkGen.build exactly as the game builds it (the
-- place's own modules, loaded from the file), and the buildings' footprints are tested against
-- the roads, each other (within a chunk and across chunk edges), water and bridges.
--   cd roblox && rojo build default.project.json -o build/harness.rbxl
--   lune run tools/worldmap/run-chunks.luau roblox/build/harness.rbxl [out.json] [groups] [radius] [mode]
-- mode: "places" (default), "crossings" (interchanges and overpasses across the map) or
-- "at:x,z;x,z" (map miles). DEBUG_PARTS=1 lists the parts around each hole in a road.
-- groups: how many places to visit (default 8); radius: chunks either side of each (default 1).
-- A chunk that throws is reported with its error: this is also the offline check that the
-- generator runs at all.
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
local buildingRuns: { { props: any, from: number, to: number } } = {}
Buildings.build = function(ctx)
	seenBuildings = ctx
	local from = #ctx.props
	local result = buildBuildings(ctx)
	table.insert(buildingRuns, { props = ctx.props, from = from + 1, to = #ctx.props })
	return result
end
Roads.build = function(ctx)
	seenRoads = ctx
	return buildRoads(ctx)
end

local WORLD = Config.WORLD_SCALE or 1
local SIZE, MILE, HALF = Config.CHUNK_STUDS, Config.DESIGN_STUDS_PER_MILE, Config.MAP_MILES / 2
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
	-- More open country, beside towns across the map (farmsteads, wells and field roads).
	local towns = byKind.town or {}
	for _, at in { 0.05, 0.2, 0.35, 0.5, 0.65, 0.8, 0.95 } do
		local s = towns[math.clamp(math.round(at * #towns), 1, #towns)]
		if s then
			addPlace(`country by {s.name}`, s.x + s.extentMi + 1.3, s.y + 0.7)
		end
	end
end
if string.sub(MODE, 1, 3) == "at:" then
	-- at:x,z[;x,z...]: the places at these map miles.
	table.clear(places)
	for pair in string.gmatch(string.sub(MODE, 4), "[^;]+") do
		local mx, my = string.match(pair, "([%d.]+),([%d.]+)")
		addPlace("at " .. pair, tonumber(mx) :: number, tonumber(my) :: number)
	end
end
if MODE == "crossings" then
	table.clear(places)
	local seen = 0
	for step = 0, 399 do
		local index = (step * 37) % 400
		local ti, tj = index % 20, index // 20
		local tile = WorldMap.tilesFor(ti * 25 + 1, tj * 25 + 1, ti * 25 + 2, tj * 25 + 2)[1]
		local found = {}
		if tile then
			for i = 1, #tile.crossings, 11 do
				local kind = tile.crossings[i]
				if not found[kind] and #places < GROUPS then
					found[kind] = true
					seen += 1
					addPlace((if kind == 1 then "interchange " else "overpass ") .. seen, tile.crossings[i + 2], tile.crossings[i + 3])
				end
			end
		end
	end
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
	if #examples[kind] < 400 then
		table.insert(examples[kind], text)
	end
end
local falls: { number }, buried: { number } = {}, {}
local roadGaps: { number } = {}
local bends: { number } = {}
local roadSamples, roadPokes, roadFloats = 0, 0, 0
local buildingParts, partsOnRoads = 0, 0
local surfaceSamples, surfaceHoles, surfaceSteps, surfaceOff, trenches = 0, 0, 0, 0, 0
local drops: { number } = {}
local bridgeViews, bridgeMissing, bridgeDiffers = 0, 0, 0
-- (a road's top this far above the columns around it is clear of the drawn terrain: half a voxel
-- of the place's 4-stud voxels, in design studs)
local CLEAR_MIN = 2 / WORLD
local clearGrade: { number }, clearRamp: { number } = {}, {}
local buriedGrade, buriedRamp = 0, 0
local function miles(x: number, z: number): string
	return string.format("(%.3f, %.3f) mi", x / MILE + HALF, z / MILE + HALF)
end

for _, placeAt in places do
	local cx0, cz0 = math.floor(placeAt.x / SIZE), math.floor(placeAt.z / SIZE)
	local group = { name = placeAt.name, chunks = 0, failed = 0, footprints = 0, intoRoad = 0, overlapInChunk = 0, overlapAcross = 0, inWater = 0, props = 0, segments = 0, errors = {} }
	local feet: { Foot } = {}
	local built: { { rc: any, props: any, inner: boolean, columns: { number }, cx: number, cz: number } } = {}
	for cx = cx0 - RADIUS, cx0 + RADIUS do
		for cz = cz0 - RADIUS, cz0 + RADIUS do
			seenBuildings, seenRoads = nil, nil
			table.clear(buildingRuns)
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
				if seenRoads then
					table.insert(built, { rc = seenRoads, props = result.props, columns = result.columns, bridges = result.bridges, cx = cx, cz = cz, inner = math.max(math.abs(cx - cx0), math.abs(cz - cz0)) < math.max(RADIUS, 1) or RADIUS == 0 })
				end
			-- Roads against the ground under them: a road's slab is BED studs thick with its top
			-- on the grade along its centre line, and the ground is cut to just inside it. Sampled
			-- along every road piece in the chunk, at its middle and near both edges: ground above
			-- the road's top shows through it; ground below the slab's underside leaves it in the air.
			local rc = seenRoads
			if rc then
				-- Bends: the turn where two pieces of one road meet end to end.
				local ends: { [string]: any } = {}
				for _, g in rc.net.segments do
					if not g.bulb and g.length > 0.5 then
						for _, e in { { g.ax, g.az, g.ux, g.uz }, { g.bx, g.bz, -g.ux, -g.uz } } do
							local key = g.chain .. "," .. math.round(e[1] * 20) .. "," .. math.round(e[2] * 20)
							local first = ends[key]
							if not first then
								ends[key] = e
							elseif rc.inside(e[1], e[2]) then
								local turn = math.deg(math.acos(math.clamp(-(first[3] * e[3] + first[4] * e[4]), -1, 1)))
								if turn > 0.3 then
									table.insert(bends, turn)
									if turn > 6 then
										note("sharpBend", string.format("%s: a %s turns %.0f degrees at %s", placeAt.name, g.spec.key, turn, miles(e[1], e[2])))
									end
								end
							end
						end
					end
				end
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
											if gap < 0.3 / WORLD then
												roadPokes += 1
												note("groundThroughRoad", string.format("%s: the ground stands %.1f studs above a %s's top at %s", placeAt.name, 0.3 - gap + 0.0, g.spec.key, miles(x, z)))
											elseif gap > Roads.BED + 1.5 / WORLD then
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
			-- Buildings against the roads, by their parts (not the footprints they claim): every
			-- upright block the building pass made, sampled across its base, against every road's
			-- pavement. Flat things (paths, drives, lots, fences' rails) and roofs are left out.
			if rc then
				for _, run in buildingRuns do
					if run.props == result.props then
						for index = run.from, run.to do
							local part = run.props[index]
							if part and part.shape == "Block" and part.size.Y >= 4 and math.abs(part.cf.UpVector.Y) > 0.99 then
								local sx, sz = part.size.X, part.size.Z
								local worst, road = 0, nil
								local nx, nz = math.max(1, math.ceil(sx / 4)), math.max(1, math.ceil(sz / 4))
								for i = 0, nx do
									for j = 0, nz do
										local p = part.cf * Vector3.new((i / nx - 0.5) * sx, 0, (j / nz - 0.5) * sz)
										for _, g in rc.net.segments do
											if not g.bulb then
												local inside = g.spec.pavement - RoadNet.toSegment(g, p.X, p.Z)
												if inside > worst and not rc.bridged(p.X, p.Z, g) then
													worst, road = inside, g
												end
											end
										end
									end
								end
								buildingParts += 1
								if worst > 1 and road then
									partsOnRoads += 1
									note("partOnRoad", string.format("%s: a part %.0f x %.0f x %.0f high at %s stands %.1f studs into a %s's pavement", placeAt.name, sx, sz, part.size.Y, miles(part.cf.X, part.cf.Z), worst, road.spec.key))
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
	-- The surface a car drives on, along every road of the inner chunks (bridges, ramps and
	-- junctions included): the tops of the flat parts all the place's chunks laid, every 4 studs
	-- along each carriageway. No part under a point is a hole in the road; two points 4 studs
	-- apart with no tops within STEP of each other are a step (a deck that does not meet its
	-- road, a ramp that ends in the air); and off a bridge the top must be near the road's grade.
	do
		local CELL, STEP = 64, 1.2
		local grid: { [number]: { any } } = {}
		for _, b in built do
			for _, part in b.props do
				if part.shape == "Block" and part.collide ~= false and part.cf.UpVector.Y > 0.9 and math.min(part.size.X, part.size.Z) >= 2 and math.max(part.size.X, part.size.Z) >= 8 and part.size.Y <= 12 then
					local r = math.sqrt(part.size.X ^ 2 + part.size.Z ^ 2) / 2
					for gx = math.floor((part.cf.X - r) / CELL), math.floor((part.cf.X + r) / CELL) do
						for gz = math.floor((part.cf.Z - r) / CELL), math.floor((part.cf.Z + r) / CELL) do
							local key = gx * 100003 + gz
							grid[key] = grid[key] or {}
							table.insert(grid[key], part)
						end
					end
				end
			end
		end
		local function tops(x: number, z: number): { number }
			local out = {}
			for _, part in grid[math.floor(x / CELL) * 100003 + math.floor(z / CELL)] or {} do
				local cf = part.cf
				local l0 = cf:PointToObjectSpace(Vector3.new(x, 0, z))
				local u = cf:VectorToObjectSpace(Vector3.new(0, 1, 0))
				local y = (part.size.Y / 2 - l0.Y) / u.Y
				local l = l0 + u * y
				if math.abs(l.X) <= part.size.X / 2 + 0.05 and math.abs(l.Z) <= part.size.Z / 2 + 0.05 then
					table.insert(out, y)
				end
			end
			return out
		end
		-- Bridges: every chunk plans the bridges around it for itself, and the chunk a bridge's
		-- crossing lies in builds it. A bridge one chunk reckons with (it leaves the road off
		-- there) that its owner does not plan, or plans at another height, is a hole or a step.
		do
			local byChunk: { [number]: any } = {}
			for _, b in built do
				byChunk[b.cx * 100003 + b.cz] = b
			end
			for _, b in built do
				for _, plan in b.bridges or {} do
					local c = plan.crossing
					local owner = byChunk[math.floor(c.x / SIZE) * 100003 + math.floor(c.z / SIZE)]
					if owner and owner ~= b then
						bridgeViews += 1
						local same = nil
						for _, other in owner.bridges or {} do
							if (other.crossing.x - c.x) ^ 2 + (other.crossing.z - c.z) ^ 2 < 4 then
								same = other
								break
							end
						end
						if not same then
							bridgeMissing += 1
							note("bridgeNotBuilt", string.format("%s: chunk %d,%d reckons with a bridge at %s (priority %s, overpass %s) that its own chunk %d,%d does not plan", placeAt.name, b.cx, b.cz, miles(c.x, c.z), tostring(c.priority), tostring(c.overpass), owner.cx, owner.cz))
						elseif math.abs(same.footprint.deck - plan.footprint.deck) > 0.2 or math.abs(same.footprint.rampA - plan.footprint.rampA) > 2 or math.abs(same.footprint.rampB - plan.footprint.rampB) > 2 then
							bridgeDiffers += 1
							note("bridgeDiffers", string.format("%s: chunks %d,%d and %d,%d see the bridge at %s differently (deck %.1f / %.1f, ramps %.0f+%.0f / %.0f+%.0f)", placeAt.name, b.cx, b.cz, owner.cx, owner.cz, miles(c.x, c.z), plan.footprint.deck, same.footprint.deck, plan.footprint.rampA, plan.footprint.rampB, same.footprint.rampA, same.footprint.rampB))
						end
					end
				end
			end
		end
		-- The terrain against the driving surface. Roblox draws smooth terrain from columns VOXEL
		-- apart and its surface can stand up to about half a voxel above the heights written, so a
		-- road is safely clear of it only where its top is well above the highest column around
		-- the point. Across each road's width, bridges' ramps included.
		local VOX = Config.DESIGN_VOXEL_STUDS
		local NV = SIZE // VOX
		local columnsOf: { [number]: any } = {}
		for _, b in built do
			columnsOf[b.cx * 100003 + b.cz] = b
		end
		local function terrainAround(x: number, z: number): number?
			local high = -math.huge
			for _, o in { { -0.5, -0.5 }, { 0.5, -0.5 }, { -0.5, 0.5 }, { 0.5, 0.5 } } do
				local px, pz = x + o[1] * VOX, z + o[2] * VOX
				local b = columnsOf[math.floor(px / SIZE) * 100003 + math.floor(pz / SIZE)]
				if not b or not b.columns then
					return nil
				end
				local ix, iz = math.floor((px - b.cx * SIZE) / VOX) + 1, math.floor((pz - b.cz * SIZE) / VOX) + 1
				high = math.max(high, b.columns[(ix - 1) * NV + iz])
			end
			return high
		end
		for _, b in built do
			if b.inner then
				local rc = b.rc
				for _, g in rc.net.segments do
					if not g.bulb and g.length > 1 then
						local lanes = if g.spec.median > 0 then { g.spec.median + 2, (g.spec.median + g.spec.pavement) / 2, g.spec.pavement - 2 } else { 0, g.spec.pavement - 2 }
						for t = 2, g.length - 2, 6 do
							for _, lane in lanes do
								for _, side in (if lane == 0 then { 1 } else { -1, 1 }) do
									local x, z = g.ax + g.ux * t - g.uz * side * lane, g.az + g.uz * t + g.ux * side * lane
									if rc.inside(x, z) then
										local here = tops(x, z)
										local around = terrainAround(x, z)
										if #here > 0 and around then
											local onBridge = rc.bridged(x, z, g)
											local top = -math.huge
											if onBridge then
												for _, y in here do
													top = math.max(top, y)
												end
											else
												local grade = rc.gradeTop(g.ax + g.ux * t, g.az + g.uz * t)
												for _, y in here do
													if math.abs(y - grade) < math.abs(top - grade) then
														top = y
													end
												end
											end
											local clear = top - around
											table.insert(if onBridge then clearRamp else clearGrade, clear)
											if clear < CLEAR_MIN then
												if onBridge then
													buriedRamp += 1
												else
													buriedGrade += 1
												end
												note(if clear < 0 then "terrainAboveRoad" elseif onBridge then "terrainOverRamp" else "terrainOverRoad", string.format("%s: the terrain's columns reach %.1f studs %s a %s's surface, %d studs from its centre line at %s", placeAt.name, math.abs(clear), if clear < 0 then "above" else "below (too little)", g.spec.key, lane, miles(x, z)))
											end
										end
									end
								end
							end
						end
					end
				end
			end
		end
		for _, b in built do
			if b.inner then
				local rc = b.rc
				for _, g in rc.net.segments do
					if not g.bulb and g.length > 1 then
						local offsets = if g.spec.median > 0 then { -(g.spec.median + g.spec.pavement) / 2, (g.spec.median + g.spec.pavement) / 2 } else { 0 }
						for _, across in offsets do
							local before: { number }? = nil
							local n = math.max(1, math.ceil(g.length / 4))
							for i = 0, n do
								local t = g.length * i / n
								local x, z = g.ax + g.ux * t - g.uz * across, g.az + g.uz * t + g.ux * across
								if not rc.inside(x, z) then
									before = nil
									continue
								end
								local here = tops(x, z)
								surfaceSamples += 1
								local onBridge = rc.bridged(x, z, g) or rc.bridged(x, z)
								if #here == 0 then
									surfaceHoles += 1
									note("hole", string.format("%s: no road surface under a %s at %s (on a bridge or ramp: %s; the ground is %.1f below the grade; %s)", placeAt.name, g.spec.key, miles(x, z), tostring(onBridge), rc.gradeTop(x, z) - rc.ground(x, z), (function()
										local text = string.format("piece %.0f long, %.0f along, chain %s, kept off as carried or stopped: %s", g.length, t, tostring(g.chain), tostring(rc.bridged(x, z, g)))
										if process.env.DEBUG_PARTS then
											local n = 0
											for _, bb in built do
												for _, part in bb.props do
													if n < 6 and part.shape == "Block" and math.max(part.size.X, part.size.Z) >= 8 and (part.cf.X - x) ^ 2 + (part.cf.Z - z) ^ 2 < (math.max(part.size.X, part.size.Z) / 2 + 4) ^ 2 then
														n += 1
														text ..= string.format(" [part %.0fx%.1fx%.0f up %.2f y %.1f at %.0f,%.0f off]", part.size.X, part.size.Y, part.size.Z, part.cf.UpVector.Y, part.cf.Y, part.cf.X - x, part.cf.Z - z)
													end
												end
											end
											text ..= string.format(" centre kept off %s;", tostring(rc.bridged(g.ax + g.ux * t, g.az + g.uz * t, g)))
											for _, o in rc.net.segments do
												if o ~= g and RoadNet.toSegment(o, g.ax + g.ux * t, g.az + g.uz * t) < o.spec.pavement then
													text ..= string.format(" centre in %s chain %s prio %s cos %.2f;", o.spec.key, tostring(o.chain), tostring(o.spec.priority), math.abs(o.ux * g.ux + o.uz * g.uz))
												end
											end
											text ..= string.format(" grade %.1f inside %s seg (%.0f,%.0f)->(%.0f,%.0f) rel", rc.gradeTop(x, z), tostring(rc.inside(g.ax + g.ux * t, g.az + g.uz * t)), g.ax - x, g.az - z, g.bx - x, g.bz - z)
										end
										for _, o in rc.net.segments do
											if o ~= g and o.chain ~= g.chain and RoadNet.toSegment(o, x, z) < o.spec.total then
												text ..= string.format("; %.0f studs from a %s's centre (median %d, pavement %d, cos %.2f)", RoadNet.toSegment(o, x, z), o.spec.key, o.spec.median, o.spec.pavement, math.abs(o.ux * g.ux + o.uz * g.uz))
											end
										end
										return text
									end)()))
								else
									if not onBridge then
										local grade, nearest = rc.gradeTop(x, z), math.huge
										for _, y in here do
											nearest = math.min(nearest, math.abs(y - grade))
										end
										if nearest > 1.5 then
											surfaceOff += 1
											note("offGrade", string.format("%s: a %s's surface is %.1f studs from its grade at %s", placeAt.name, g.spec.key, nearest, miles(x, z)))
										end
									end
									if before then
										local least = math.huge
										for _, y in here do
											for _, y0 in before do
												least = math.min(least, math.abs(y - y0))
											end
										end
										if least > STEP then
											surfaceSteps += 1
											note("step", string.format("%s: a %s's surface steps %.1f studs at %s (on a bridge or ramp: %s; grade here %.1f, 4 studs back %.1f, ground %.1f; heading %.2f,%.2f; piece %.0f long; carried here %s, 8 back %s, 8 on %s; any bridge here %s, 8 back %s)", placeAt.name, g.spec.key, least, miles(x, z), tostring(onBridge), rc.gradeTop(x, z), rc.gradeTop(x - g.ux * 4, z - g.uz * 4), rc.ground(x, z), g.ux, g.uz, g.length, tostring(rc.bridged(x, z, g)), tostring(rc.bridged(x - g.ux * 8, z - g.uz * 8, g)), tostring(rc.bridged(x + g.ux * 8, z + g.uz * 8, g)), tostring(rc.bridged(x, z)), tostring(rc.bridged(x - g.ux * 8, z - g.uz * 8))))
										end
									end
								end
								before = if #here > 0 then here else nil
							end
						end
						-- The ground beside the road: how far it lies below the road's top, out to
						-- 60 studs past the pavement (a ditch is a stud or two; more is a trench).
						if g.spec.priority >= 7 then
							for t = 4, g.length - 4, 16 do
								local cx1, cz1 = g.ax + g.ux * t, g.az + g.uz * t
								if rc.inside(cx1, cz1) and not rc.bridged(cx1, cz1) then
									local top = rc.gradeTop(cx1, cz1)
									for _, side in { -1, 1 } do
										for d = 0, g.spec.pavement + 60, 4 do
											local x, z = cx1 - g.uz * side * d, cz1 + g.ux * side * d
											if (d < g.spec.median - 2 or d > g.spec.pavement + 1) and rc.inside(x, z) and not rc.bridged(x, z) and not (rc.water and rc.water(x, z)) then
												local other = rc.net:near(x, z, 80)
												local drop = top - rc.ground(x, z)
												table.insert(drops, drop)
												if drop > 9 and (other == nil or other == g or other.chain == g.chain) then
													trenches += 1
													note("trench", string.format("%s: the ground lies %.1f studs below a %s's top, %d studs from its centre line at %s", placeAt.name, drop, g.spec.key, d, miles(x, z)))
												end
											end
										end
									end
								end
							end
						end
					end
				end
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
print(string.format("building parts against roads: %d upright parts, %d standing in a road's pavement", buildingParts, partsOnRoads))
for _, e in { { "roads on the ground", clearGrade, buriedGrade }, { "bridges and ramps", clearRamp, buriedRamp } } do
	local list = e[2] :: { number }
	table.sort(list)
	if #list > 0 then
		print(string.format("terrain under %s: %d samples; surface above the highest column around it (studs) least %.1f, 1%% %.1f, median %.1f; %d (%.1f%%) with less than %.1f", e[1] :: string, #list, list[1], list[math.max(1, math.floor(0.01 * #list))], list[math.ceil(0.5 * #list)], e[3] :: number, 100 * (e[3] :: number) / #list, CLEAR_MIN))
	end
end
print(string.format("bridges seen from a neighbouring chunk: %d; %d not planned by their own chunk, %d planned differently", bridgeViews, bridgeMissing, bridgeDiffers))
table.sort(drops)
print(string.format("driving surface: %d samples; %d holes, %d steps, %d off the grade", surfaceSamples, surfaceHoles, surfaceSteps, surfaceOff))
if #drops > 0 then
	print(string.format("ground beside main roads, below the road's top (studs): median %.1f, 99%% %.1f, most %.1f; %d trench samples", drops[math.ceil(0.5 * #drops)], drops[math.ceil(0.99 * #drops)], drops[#drops], trenches))
end
table.sort(bends)
if #bends > 0 then
	local over = 0
	for _, v in bends do
		over += if v > 4 then 1 else 0
	end
	print(string.format("bends where a road's pieces meet: %d; turn (degrees) median %.1f, 90%% %.1f, most %.1f; %d over 4 degrees", #bends, bends[math.ceil(0.5 * #bends)], bends[math.ceil(0.9 * #bends)], bends[#bends], over))
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
