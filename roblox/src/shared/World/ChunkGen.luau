--!strict
-- Builds one chunk of the world from the generated map: terrain voxels (ground and water) and
-- the props standing on it (Props/: roads as parts, bridges, buildings, trees). Pure
-- computation, so it can run in a parallel phase; the caller writes the voxels with
-- Terrain:WriteVoxels and creates the props with ChunkGen.place in serial.
--
-- Per column of voxels: the ground (Heightfield) and its surface from the land cover (fields by
-- quarter section, centre-pivot circles, pasture, woods, towns); then lakes; then rivers, each a
-- channel below a water level set a bank's height under the ground along its centre line, with
-- banks rising from the water; then the road network (Props/RoadNet), whose roads are graded to
-- Heightfield.gradeM along their centre lines and flattened (with their sidewalks) to that grade,
-- the road parts laid on top. Server only.

local Config = require(script.Parent.Config)
local WorldMap = require(script.Parent.WorldMap)
local Heightfield = require(script.Parent.Heightfield)
local Builder = require(script.Parent.Props.Builder)
local Trees = require(script.Parent.Props.Trees)
local RoadNet = require(script.Parent.Props.RoadNet)
local Roads = require(script.Parent.Props.Roads)
local Bridges = require(script.Parent.Props.Bridges)
local Buildings = require(script.Parent.Props.Buildings)
local Interchanges = require(script.Parent.Interchanges)

local ChunkGen = {}

local SIZE = Config.CHUNK_STUDS
local VOXEL = Config.VOXEL_STUDS
local N = SIZE // VOXEL
local MILE = Config.STUDS_PER_MILE
local HALF_MAP = Config.MAP_MILES / 2
local SEED_Z = Config.SEED * 29.7 + 0.5
local toStuds = Heightfield.toStuds
local C = WorldMap.cover
local COVER_KEYS = WorldMap.meta.cover :: { string }
local REGION_KEYS = WorldMap.meta.regions :: { string }
local hash = Builder.hash

ChunkGen.VOXEL = VOXEL

local M = Enum.Material
local AIR, WATER = M.Air, M.Water

local SHOULDER = 18 -- studs over which a road's grade blends into the land beyond its edge
local ROAD_RAISE_M = 0.3 -- graded road top above the ground under its centre line
-- The ground is cut this far (m) below a road's grade under the road and its sidewalks (hidden by
-- the road slabs), and lies this far below it at the road's edge (a ditch in the country), rising
-- to the natural ground over the shoulder.
local VERTICAL = Config.STUDS_PER_METRE_VERTICAL
local ROAD_CUT_M, DITCH_M, TOWN_DITCH_M, MEDIAN_M = 3.2 / VERTICAL, 1.6 / VERTICAL, 0.7 / VERTICAL, 1.6 / VERTICAL

-- River channel: map width (m, as drawn) to studs; the water sits a bank's height below the
-- smoothed ground along the centre line; the channel is at least two voxels deep so it holds water.
local RIVER_STUDS_PER_M = 0.18
local RIVER_MIN, RIVER_MAX = 12, 220
-- Each river runs in a valley: the land within VALLEY_BASE + half x VALLEY_PER_HALF studs of the
-- channel slopes down to just above the water. Every road crossing is bridged; town streets
-- (below county rank) bridge only creeks narrower than STREET_BRIDGE_HALF and stop at the bank of
-- anything wider.
local VALLEY_BASE, VALLEY_PER_HALF = 50, 1.2
local STREET_BRIDGE_HALF = 30
local DOWNTOWN = { metro = 650, city = 420 }

local function bankDropM(half: number): number
	return math.clamp(1.8 + half * 0.025, 1.8, 5)
end
local function channelDepthM(half: number): number
	return math.clamp(half * 0.09, 7, 15)
end

export type Chunk = {
	region: Region3,
	materials: { { { Enum.Material } } },
	occupancy: { { { number } } },
	yMin: number,
	yMax: number,
	props: Builder.Props,
}

-- Loads the map tiles a chunk reads (call in serial before ChunkGen.build in parallel).
function ChunkGen.prepare(cx: number, cz: number)
	local mx0, my0 = WorldMap.milesAt(cx * SIZE, cz * SIZE)
	local mx1, my1 = WorldMap.milesAt((cx + 1) * SIZE, (cz + 1) * SIZE)
	WorldMap.ensure(mx0, my0, mx1, my1)
end

function ChunkGen.key(cx: number, cz: number): string
	return `{cx},{cz}`
end

local function toSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): (number, number)
	local dx, dz = bx - ax, bz - az
	local len2 = dx * dx + dz * dz
	local t = if len2 > 0 then math.clamp(((px - ax) * dx + (pz - az) * dz) / len2, 0, 1) else 0
	local qx, qz = ax + dx * t - px, az + dz * t - pz
	return math.sqrt(qx * qx + qz * qz), t
end

-- Road top (studs) at a point on a road's centre line.
local function gradeTop(x: number, z: number): number
	local mx, my = WorldMap.milesAt(x, z)
	return toStuds(Heightfield.gradeM(mx, my) + ROAD_RAISE_M) + Roads.LIFT
end

local function coverKeyAt(x: number, z: number): string
	local cover = WorldMap.cellAt(WorldMap.milesAt(x, z))
	return COVER_KEYS[cover + 1]
end

-- Surface material of open land of a cover at a point (stud x, z; map miles mx, my).
local function landMaterial(cover: number, mx: number, my: number, paved: boolean): Enum.Material
	if cover == C.cropland or cover == C.irrigated then
		local qx, qy = math.floor(mx * 2), math.floor(my * 2) -- quarter sections
		if cover == C.irrigated then
			local cx, cy = (qx + 0.5) / 2, (qy + 0.5) / 2
			if (mx - cx) ^ 2 + (my - cy) ^ 2 < 0.235 ^ 2 then
				return if hash(qx, qy, 3) < 0.7 then M.LeafyGrass else M.Sandstone
			end
			return M.Grass
		end
		local crop = hash(qx, qy, 1)
		if crop < 0.35 then
			return M.Sandstone -- wheat and stubble
		elseif crop < 0.6 then
			return M.Ground -- worked ground
		elseif crop < 0.86 then
			return M.LeafyGrass -- corn, soybeans
		end
		return M.Grass -- pasture
	elseif cover == C.forest or cover == C.riparian then
		return M.LeafyGrass
	elseif cover == C.sandhillGrass then
		return if math.noise(mx * 9, my * 9, SEED_Z) > 0.42 then M.Sand else M.Grass
	elseif cover == C.redRange then
		return if math.noise(mx * 6, my * 6, SEED_Z + 2) > 0.2 then M.Salt else M.Grass -- red soil (Salt recoloured)
	elseif cover == C.breaks then
		return if math.noise(mx * 8, my * 8, SEED_Z + 4) > 0 then M.Ground else M.Grass
	elseif cover == C.tallgrass then
		return M.LeafyGrass
	elseif cover == C.urban then
		return if paved then M.Pavement else M.Grass
	end
	return M.Grass
end

-- Settlements within reach of the chunk, in studs.
local function settlementsNear(x: number, z: number): { Buildings.Settlement }
	local list = {}
	local mx, my = WorldMap.milesAt(x, z)
	for _, s in WorldMap.meta.settlements do
		if math.sqrt((s.x - mx) ^ 2 + (s.y - my) ^ 2) < s.extentMi + 2 then
			local sx, sz = WorldMap.studsAt(s.x, s.y)
			table.insert(list, { kind = s.kind, x = sx, z = sz, core = s.coreMi * MILE, extent = s.extentMi * MILE, population = s.population or 0, name = s.name })
		end
	end
	return list
end

function ChunkGen.build(cx: number, cz: number): Chunk
	local x0, z0 = cx * SIZE, cz * SIZE
	local x1, z1 = x0 + SIZE, z0 + SIZE
	local mx0, my0 = WorldMap.milesAt(x0, z0)
	local mx1, my1 = WorldMap.milesAt(x1, z1)

	-- Rivers and the map's roads near the chunk, in studs (far enough for bridges reaching in).
	local reach = (RIVER_MAX + 2 * Bridges.BANK_EXTRA + 260) / MILE
	local rivers, mapRoads, crossings = {}, {}, {}
	local seen = {}
	for _, tile in WorldMap.tilesFor(mx0 - reach, my0 - reach, mx1 + reach, my1 + reach) do
		local list = tile.rivers
		for i = 1, #list, 8 do
			local ax, ay, bx, by = list[i], list[i + 1], list[i + 2], list[i + 3]
			if math.max(ax, bx) >= mx0 - reach and math.min(ax, bx) <= mx1 + reach and math.max(ay, by) >= my0 - reach and math.min(ay, by) <= my1 + reach then
				local key = `r{ax},{ay},{bx},{by}`
				if not seen[key] then
					seen[key] = true
					local sax, saz = WorldMap.studsAt(ax, ay)
					local sbx, sbz = WorldMap.studsAt(bx, by)
					table.insert(rivers, {
						ax = sax, az = saz, bx = sbx, bz = sbz,
						h0 = math.clamp(list[i + 4] * RIVER_STUDS_PER_M, RIVER_MIN, RIVER_MAX) / 2,
						h1 = math.clamp(list[i + 5] * RIVER_STUDS_PER_M, RIVER_MIN, RIVER_MAX) / 2,
					})
				end
			end
		end
		for _, rec in Interchanges.fromList((tile :: any).crossings or {}, WorldMap.studsAt) do
			local key = `c{math.round(rec.x)},{math.round(rec.z)}`
			local m = reach * MILE
			if not seen[key] and rec.x > x0 - m and rec.x < x1 + m and rec.z > z0 - m and rec.z < z1 + m then
				seen[key] = true
				table.insert(crossings, rec)
			end
		end
		list = tile.roads
		for i = 1, #list, 5 do
			local kind, ax, ay, bx, by = list[i], list[i + 1], list[i + 2], list[i + 3], list[i + 4]
			if math.max(ax, bx) >= mx0 - reach and math.min(ax, bx) <= mx1 + reach and math.max(ay, by) >= my0 - reach and math.min(ay, by) <= my1 + reach then
				local key = `{kind},{ax},{ay},{bx},{by}`
				if not seen[key] then
					seen[key] = true
					local sax, saz = WorldMap.studsAt(ax, ay)
					local sbx, sbz = WorldMap.studsAt(bx, by)
					table.insert(mapRoads, { kind = kind, ax = sax, az = saz, bx = sbx, bz = sbz })
				end
			end
		end
	end
	local nearRivers = {}
	for _, r in rivers do
		local pad = math.max(r.h0, r.h1) * (1 + VALLEY_PER_HALF) + VALLEY_BASE
		if math.max(r.ax, r.bx) >= x0 - pad and math.min(r.ax, r.bx) <= x1 + pad and math.max(r.az, r.bz) >= z0 - pad and math.min(r.az, r.bz) <= z1 + pad then
			table.insert(nearRivers, r)
		end
	end
	-- Water level (m) at the point of a river's centre line nearest a column.
	local function riverLevelM(px: number, pz: number, half: number): number
		return WorldMap.elevationM(WorldMap.milesAt(px, pz)) - bankDropM(half)
	end

	local function mileOf(x: number): number
		return x / MILE + HALF_MAP
	end
	local function mileX(I: number): number
		return (I - HALF_MAP) * MILE
	end
	local net = RoadNet.build({
		x0 = x0, z0 = z0, x1 = x1, z1 = z1, mapRoads = mapRoads, section = WorldMap.sectionAt,
		coverKey = coverKeyAt, mileOf = mileOf, mileX = mileX, crossings = crossings,
	}, RoadNet.MAX_TOTAL + SHOULDER + 30)

	local settlements = settlementsNear(x0 + SIZE / 2, z0 + SIZE / 2)

	-- Bridges, worked out before anything else so the terrain, the roads and everything placed
	-- after keep out of them. Every chunk near a bridge computes the same geometry (from the
	-- ground before roads, Heightfield), so each knows its footprint; only the chunk holding the
	-- crossing builds it.
	--   overpasses: where the map plans a road over an interstate (an interchange or an overpass;
	--     js/worldmap/crossings.js);
	--   over rivers: wherever a road crosses one (town streets only over creeks; at a wider river
	--     they stop at the bank), most important roads first; a bridge that would run into one
	--     already placed is not built, and its road stops at the bank.
	type Planned = { crossing: Bridges.Crossing, footprint: Bridges.Footprint, underX: number?, underZ: number? }
	local planned: { Planned } = {}
	local function footprintsMeet(a: Bridges.Footprint, b: Bridges.Footprint): boolean
		for i = 0, 6 do
			local t = i / 6
			local x, z = a.ax + (a.bx - a.ax) * t, a.az + (a.bz - a.az) * t
			if toSegment(x, z, b.ax, b.az, b.bx, b.bz) < a.half + b.half then
				return true
			end
		end
		return false
	end
	local function plan(crossing: Bridges.Crossing, underX: number?, underZ: number?): boolean
		local footprint = Bridges.build({ props = {}, gradeTop = gradeTop, ground = Heightfield.studsAt }, crossing, true)
		for _, other in planned do
			if footprintsMeet(footprint, other.footprint) then
				return false
			end
		end
		table.insert(planned, { crossing = crossing, footprint = footprint, underX = underX, underZ = underZ })
		return true
	end
	local function kindOf(spec: RoadNet.Spec): number
		return if spec.key == "interstate" then 1 elseif spec.key == "expressway" then 2 else 3
	end
	-- The segment of the network through a point along a direction.
	local function segmentAlong(x: number, z: number, dx: number, dz: number, wantInterstate: boolean?): RoadNet.Segment?
		local best, bestD = nil, 30
		for _, g in net.segments do
			if math.abs(g.ux * dx + g.uz * dz) > 0.9 and (wantInterstate == nil or (g.spec.key == "interstate") == wantInterstate) then
				local d = RoadNet.toSegment(g, x, z)
				if d < bestD then
					best, bestD = g, d
				end
			end
		end
		return best
	end
	for _, rec in crossings do
		local isTee = Interchanges.tee(rec) ~= nil
		local over = not isTee and segmentAlong(rec.x, rec.z, rec.vx, rec.vz, if rec.road == 1 then true else false)
		local under = segmentAlong(rec.x, rec.z, rec.ux, rec.uz, true)
		if over and under then
			local sin = Interchanges.sin(rec)
			plan({
				x = rec.x, z = rec.z, ux = over.ux, uz = over.uz, riverHalf = under.spec.total / sin + 4,
				water = gradeTop(rec.x, rec.z), roadHalf = over.spec.total, kind = kindOf(over.spec),
				surface = "asphalt", priority = over.spec.priority, overpass = true, clearance = 17,
				belowDivided = under.spec.median > 0,
			}, rec.ux, rec.uz)
		end
	end
	local riverCrossings = {}
	for _, g in net.segments do
		local spec = g.spec
		for _, r in rivers do
			local t, u = Bridges.intersect(g.ax, g.az, g.bx, g.bz, r.ax, r.az, r.bx, r.bz)
			if t and u then
				local half = r.h0 + (r.h1 - r.h0) * u
				if spec.priority >= 5 or half < STREET_BRIDGE_HALF then
					local x, z = g.ax + (g.bx - g.ax) * t, g.az + (g.bz - g.az) * t
					-- Headroom over the water by the road's rank and the span.
					local clearance = (if spec.priority >= 9 then 14 elseif spec.priority >= 7 then 10 elseif spec.priority >= 5 then 7 else 4) + (if half > 70 then 8 else 0)
					table.insert(riverCrossings, {
						x = x, z = z, ux = g.ux, uz = g.uz, riverHalf = half,
						water = toStuds(riverLevelM(x, z, half)), roadHalf = spec.total,
						kind = kindOf(spec), surface = spec.surface, priority = spec.priority, clearance = clearance,
					})
				end
			end
		end
	end
	table.sort(riverCrossings, function(a, b)
		if a.priority ~= b.priority then
			return a.priority > b.priority
		end
		return a.x + a.z * 1e-3 < b.x + b.z * 1e-3
	end)
	for _, c in riverCrossings do
		plan(c)
	end
	-- Whether a point of road g lies on one of the bridges (or its ramps) carrying g over, where g
	-- itself is not laid. The road an overpass passes over is laid; and each road resumes a few
	-- studs inside the end of a bridge's ramp, so the two meet without a gap.
	local function carried(g: RoadNet.Segment?, x: number, z: number, margin: number): boolean
		for _, b in planned do
			local f = b.footprint
			local passesUnder = g ~= nil and b.underX ~= nil and g.spec.key == "interstate" and math.abs(g.ux * b.underX + g.uz * (b.underZ :: number)) > 0.9
			if not passesUnder then
				local length = math.sqrt((f.bx - f.ax) ^ 2 + (f.bz - f.az) ^ 2)
				local d, t = toSegment(x, z, f.ax, f.az, f.bx, f.bz)
				local along = t * length
				if d < f.half + margin and (g == nil or (along > 4 and along < length - 4)) then
					return true
				end
			end
		end
		return false
	end
	local function downtown(x: number, z: number): boolean
		for _, s in settlements do
			local radius = DOWNTOWN[s.kind]
			if radius and (s.x - x) ^ 2 + (s.z - z) ^ 2 < radius * radius then
				return true
			end
		end
		return false
	end
	local paved = false
	for _, s in settlements do
		if (s.kind == "metro" or s.kind == "city") and (s.x - (x0 + SIZE / 2)) ^ 2 + (s.z - (z0 + SIZE / 2)) ^ 2 < (s.core * 0.55) ^ 2 then
			paved = true
		end
	end

	local heights = table.create(N * N, 0) -- ground surface (studs)
	local waterTop = table.create(N * N, -math.huge) -- water surface (studs)
	local surface = table.create(N * N, M.Grass) :: { Enum.Material }
	local covers = table.create(N * N, 0)
	local regions = table.create(N * N, 0)
	local busy = table.create(N * N, false) -- road or water: nothing stands here
	local lo, hi = math.huge, -math.huge

	for ix = 1, N do
		for iz = 1, N do
			local x, z = x0 + (ix - 0.5) * VOXEL, z0 + (iz - 0.5) * VOXEL
			local mx, my = WorldMap.milesAt(x, z)
			local cover, region = WorldMap.cellAt(mx, my)
			local h = WorldMap.elevationM(mx, my) + Heightfield.detailM(mx, my, region)
			local material = landMaterial(cover, mx, my, paved)
			local water = -math.huge
			local isBusy = false
			local lake = false

			-- Lakes: water up to the surface where the map has lake; an embankment along its
			-- edge where the ground there is below the water (the dam, and low shores).
			local lakeShare, lakeSurface = WorldMap.lakeAt(mx, my)
			if lakeSurface then
				if lakeShare > 0.5 and h < lakeSurface then
					water = lakeSurface
					isBusy, lake = true, true
					material = M.Mud
				elseif lakeShare > 0.3 and h < lakeSurface + 2 then
					h = lakeSurface + 2
					material = M.Ground
				end
			end

			-- Rivers: a channel below the water; a valley whose sides fall to just above the water
			-- at the channel's edge.
			local riverHalf, nearBridge = 0, false
			for _, r in nearRivers do
				local d, t = toSegment(x, z, r.ax, r.az, r.bx, r.bz)
				local half = r.h0 + (r.h1 - r.h0) * t
				local valley = VALLEY_BASE + half * VALLEY_PER_HALF
				if d < half + valley then
					local px, pz = r.ax + (r.bx - r.ax) * t, r.az + (r.bz - r.az) * t
					local level = riverLevelM(px, pz, half)
					if d < half + Bridges.BANK_EXTRA then
						nearBridge = true
					end
					if d < half then
						local depth = channelDepthM(half)
						h = math.min(h, level - depth * (1 - (d / half) ^ 4) - 0.5)
						water = math.max(water, level)
						material = if d > half * 0.8 then M.Sand else M.Mud
						isBusy = true
						riverHalf = math.max(riverHalf, half)
					else
						local bank = level + 1.2 / VERTICAL
						local f = math.clamp((d - half) / valley, 0, 1)
						local side = bank + (h - bank) * f * f * (3 - 2 * f)
						if h > bank then
							h = math.min(h, side)
						elseif d < half + 10 then
							h = bank -- a low bank is built up to hold the water
						end
						if d < half + 6 and material ~= M.Sand then
							material = M.Ground
						end
					end
				end
			end

			-- Roads: flattened to their grade under the road and its sidewalks, blended beyond.
			local g, d, along = net:near(x, z, SHOULDER)
			if g and riverHalf == 0 and not nearBridge and not lake and not carried(g, x, z, 0) then
				local px, pz = g.ax + g.ux * along, g.az + g.uz * along
				local grade = Heightfield.gradeM(WorldMap.milesAt(px, pz)) + ROAD_RAISE_M
				local spec = g.spec
				if d <= spec.total then
					if spec.median > 0 and d < spec.median - 2 then
						h = grade - MEDIAN_M
						material = M.Grass
					else
						h = grade - ROAD_CUT_M
						material = M.Ground
						isBusy = true
					end
					water = -math.huge
				else
					local edge = grade - (if spec.town then TOWN_DITCH_M else DITCH_M)
					local f = math.clamp((d - spec.total) / SHOULDER, 0, 1)
					h = edge + (h - edge) * f * f * (3 - 2 * f)
				end
			end

			local k = (ix - 1) * N + iz
			local hs = toStuds(h)
			heights[k] = hs
			waterTop[k] = if water > -math.huge then toStuds(water) else -math.huge
			surface[k] = material
			covers[k] = cover
			regions[k] = region
			busy[k] = isBusy
			lo = math.min(lo, hs)
			hi = math.max(hi, hs, waterTop[k])
		end
	end

	-- Steep ground shows bare rock (but not under roads or water).
	for ix = 1, N do
		for iz = 1, N do
			local k = (ix - 1) * N + iz
			if not busy[k] then
				local e, w = heights[math.min(ix, N - 1) * N + iz], heights[(math.max(ix, 2) - 2) * N + iz]
				local s, n = heights[(ix - 1) * N + math.min(iz + 1, N)], heights[(ix - 1) * N + math.max(iz - 1, 1)]
				if math.max(math.abs(e - w), math.abs(s - n)) / (2 * VOXEL) > 0.7 then
					surface[k] = M.Rock
				end
			end
		end
	end

	local yMin = math.floor((lo - Config.FILL_DEPTH_STUDS) / VOXEL) * VOXEL
	local yMax = math.ceil(hi / VOXEL) * VOXEL + VOXEL
	local ny = (yMax - yMin) // VOXEL

	local soil = M.Ground
	local materials, occupancy = table.create(N), table.create(N)
	for ix = 1, N do
		local mxs, oxs = table.create(ny), table.create(ny)
		for iy = 1, ny do
			mxs[iy] = table.create(N)
			oxs[iy] = table.create(N)
		end
		for iz = 1, N do
			local k = (ix - 1) * N + iz
			local h, top, mat = heights[k], waterTop[k], surface[k]
			for iy = 1, ny do
				local bottom = yMin + (iy - 1) * VOXEL
				local depth = h - bottom -- ground surface above this voxel's bottom
				local occ = math.clamp(depth / VOXEL, 0, 1)
				if occ > 0 and not (top > h and occ < 0.5) then
					oxs[iy][iz] = occ
					mxs[iy][iz] = if depth <= 2 * VOXEL then mat else soil
				elseif bottom < top then
					-- Water fills from the ground up (a voxel only partly ground under water is water).
					oxs[iy][iz] = math.clamp((top - bottom) / VOXEL, 0, 1)
					mxs[iy][iz] = WATER
				else
					oxs[iy][iz] = 0
					mxs[iy][iz] = AIR
				end
			end
		end
		materials[ix] = mxs
		occupancy[ix] = oxs
	end

	-- Props -----------------------------------------------------------------------------------
	local props: Builder.Props = {}
	local function column(x: number, z: number): number?
		local ix, iz = math.floor((x - x0) / VOXEL) + 1, math.floor((z - z0) / VOXEL) + 1
		if ix < 1 or iz < 1 or ix > N or iz > N then
			return nil
		end
		return (ix - 1) * N + iz
	end
	local function inside(x: number, z: number): boolean
		return x >= x0 and x < x1 and z >= z0 and z < z1
	end
	local function ground(x: number, z: number): number
		local k = column(x, z)
		return if k then heights[k] else Heightfield.studsAt(x, z)
	end
	local function isBusy(x: number, z: number): boolean
		local k = column(x, z)
		return if k then busy[k] else false
	end
	-- Road g (or any road, when nil) is not laid here: a river's banks, or under a bridge or its
	-- ramps that carries the road over.
	local function bridged(x: number, z: number, g: RoadNet.Segment?): boolean
		for _, r in rivers do
			local d, t = toSegment(x, z, r.ax, r.az, r.bx, r.bz)
			if d < r.h0 + (r.h1 - r.h0) * t + Bridges.BANK_EXTRA then
				return true
			end
		end
		return carried(g, x, z, 0)
	end

	Roads.build({
		x0 = x0, z0 = z0, x1 = x1, z1 = z1, props = props, net = net, inside = inside, gradeTop = gradeTop,
		ground = ground, coverKey = coverKeyAt, bridged = bridged, downtown = downtown,
	})

	for _, b in planned do
		if inside(b.crossing.x, b.crossing.z) then
			Bridges.build({ props = props, gradeTop = gradeTop, ground = Heightfield.studsAt }, b.crossing)
		end
	end
	local function onBridge(x: number, z: number, margin: number): boolean
		return carried(nil, x, z, margin)
	end

	-- Water or a river bank at a point (buildings keep off).
	local function water(x: number, z: number): boolean
		for _, r in rivers do
			local d, t = toSegment(x, z, r.ax, r.az, r.bx, r.bz)
			if d < r.h0 + (r.h1 - r.h0) * t + 10 then
				return true
			end
		end
		local share = WorldMap.lakeAt(WorldMap.milesAt(x, z))
		return share > 0.3
	end

	local occupied: { { cf: CFrame, hx: number, hz: number } } = {}
	Buildings.build({
		x0 = x0, z0 = z0, x1 = x1, z1 = z1, props = props, net = net, inside = inside, ground = ground,
		coverKey = coverKeyAt, busy = isBusy, water = function(x: number, z: number): boolean
			return water(x, z) or onBridge(x, z, 6)
		end, settlements = settlements, occupied = occupied,
	})
	local function inBuilding(x: number, z: number, margin: number): boolean
		for _, o in occupied do
			local p = o.cf:PointToObjectSpace(Vector3.new(x, o.cf.Y, z))
			if math.abs(p.X) < o.hx + margin and math.abs(p.Z) < o.hz + margin then
				return true
			end
		end
		return false
	end

	-- Trees: a chance on each 16-stud patch, scaled by a grove noise so they stand in clumps and
	-- leave clearings; species come in stands. Not on roads, bridges or buildings.
	for px = 0, SIZE - 16, 16 do
		for pz = 0, SIZE - 16, 16 do
			local gx, gz = (x0 + px) // 16, (z0 + pz) // 16
			local x, z = x0 + px + 16 * hash(gx, gz, 12), z0 + pz + 16 * hash(gx, gz, 13)
			local k = column(x, z)
			if k and not busy[k] then
				local key = COVER_KEYS[covers[k] + 1]
				local grove = math.clamp(0.5 + 1.1 * math.noise(x / 140, z / 140, 5.3) + 0.4 * math.noise(x / 45, z / 45, 9.1), 0, 1.8)
				if hash(gx, gz, 11) < (Trees.DENSITY[key] or 0) * grove * 2 and net:clear(x, z, 8) and not onBridge(x, z, 18) and not inBuilding(x, z, 6) then
					local stand = math.clamp(0.5 + 0.9 * math.noise(x / 300, z / 300, 2.2), 0, 0.999)
					Trees.add(props, Trees.species(key, REGION_KEYS[regions[k] + 1], stand, hash(gx, gz, 15)), x, heights[k], z, hash(gx, gz, 14))
				end
			end
		end
	end

	return {
		region = Region3.new(Vector3.new(x0, yMin, z0), Vector3.new(x1, yMax, z1)),
		materials = materials,
		occupancy = occupancy,
		yMin = yMin,
		yMax = yMax,
		props = props,
	}
end

local CLASSES = { Block = "Part", Ball = "Part", Cylinder = "Part", Wedge = "WedgePart", CornerWedge = "CornerWedgePart" }

-- Creates a chunk's props (serial phase only) in a model under parent.
function ChunkGen.place(props: Builder.Props, parent: Instance, name: string): Model
	local model = Instance.new("Model")
	model.Name = name
	pcall(function()
		model.LevelOfDetail = Enum.ModelLevelOfDetail.StreamingMesh
	end)
	for _, p in props do
		local part = Instance.new(CLASSES[p.shape] or "Part") :: BasePart
		if p.shape == "Ball" then
			(part :: Part).Shape = Enum.PartType.Ball
		elseif p.shape == "Cylinder" then
			(part :: Part).Shape = Enum.PartType.Cylinder
		end
		part.Size = p.size
		part.CFrame = p.cf
		part.Color = p.color
		part.Material = p.material
		part.Anchored = true
		part.CanCollide = p.collide
		part.CanTouch = false
		part.CanQuery = p.collide
		part.CastShadow = p.collide or p.mesh ~= nil
		part.TopSurface = Enum.SurfaceType.Smooth
		part.BottomSurface = Enum.SurfaceType.Smooth
		if p.transparency then
			part.Transparency = p.transparency
		end
		if p.reflectance then
			part.Reflectance = p.reflectance
		end
		if p.mesh then
			local mesh = Instance.new("SpecialMesh")
			mesh.MeshType = Enum.MeshType.Sphere
			mesh.Parent = part
		end
		part.Parent = model
	end
	model.Parent = parent
	return model
end

-- Ground height (studs) at a point, without rivers, lakes or roads: for placing things before
-- their chunk is built.
function ChunkGen.groundStudsAt(x: number, z: number): number
	return Heightfield.studsAt(x, z)
end

return ChunkGen
