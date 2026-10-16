--!strict
-- Ground height: the generated world map's large-scale ground (WorldMap, smooth between its
-- half-mile cells) plus fine detail the map is too coarse to hold: low hummocks everywhere,
-- dune crests in the Sandhills, rougher ground in the Red Hills and breaks. Rivers, lakes and
-- roads are cut into this by ChunkGen. Server only (reads ServerStorage.WorldData).

local Config = require(script.Parent.Config)
local WorldMap = require(script.Parent.WorldMap)

local Heightfield = {}

local SEED_Z = Config.SEED * 17.31 + 0.5 -- math.noise is zero on integer lattice points
local VERTICAL = Config.STUDS_PER_METRE_VERTICAL
local BASE_M = WorldMap.meta.baseM :: number
local R = WorldMap.regions
-- Vehicle jitter test: dead-flat ground, so any bounce of a car at steady speed is precision noise.
local FLAT = workspace:GetAttribute("TestDrive") == true and workspace:GetAttribute("TestFlatGround") == true
local FLAT_METRES = BASE_M + 40

Heightfield.BASE_M = BASE_M

-- How much of each kind of relief the land round a point has (0 to 1), blended between the
-- map's half-mile cells so the hills change gradually where regions meet. The plains (High
-- Plains, Midwest farmland) have none: their ground is the map's own gentle slope with barely a
-- roll in it.
local DUNES = { [R.sandhills] = 1 }
local ROUGH = { [R.redHills] = 1, [R.flintHills] = 0.8, [R.ozarkEdge] = 1.1, [R.smokyHills] = 0.5 }
local function reliefMix(mx: number, my: number): (number, number)
	local cell = WorldMap.meta.cellMiles :: number
	local gx, gy = mx / cell - 0.5, my / cell - 0.5
	local i0, j0 = math.floor(gx), math.floor(gy)
	local fx, fy = gx - i0, gy - j0
	local dunes, rough = 0, 0
	for _, c in { { 0, 0, (1 - fx) * (1 - fy) }, { 1, 0, fx * (1 - fy) }, { 0, 1, (1 - fx) * fy }, { 1, 1, fx * fy } } do
		local _, region = WorldMap.cellAt((i0 + c[1] + 0.5) * cell, (j0 + c[2] + 0.5) * cell)
		dunes += c[3] * (DUNES[region] or 0)
		rough += c[3] * (ROUGH[region] or 0)
	end
	return dunes, rough
end

-- Fine detail (m) at map miles (mx, my): barely a roll on the plains; dune ridges in the
-- Sandhills; hills in the Red, Flint and Smoky Hills and the Ozark edge.
function Heightfield.detailM(mx: number, my: number, _region: number?): number
	local h = 0.8 * math.noise(mx * 1.5, my * 1.5, SEED_Z + 21.7) + 0.3 * math.noise(mx * 9, my * 9, SEED_Z)
	local dunes, rough = reliefMix(mx, my)
	if dunes > 0 then
		h += dunes * 5 * (1 - 2 * math.abs(math.noise(mx * 2.6, my * 1.4, SEED_Z + 7.7))) -- dune crests
	end
	if rough > 0 then
		h += rough * (5 * math.noise(mx * 3, my * 3, SEED_Z + 11.3) + 1.5 * math.noise(mx * 9, my * 9, SEED_Z + 13.9))
	end
	return h
end

-- Ground height in metres at a stud position (before rivers, lakes and roads).
function Heightfield.metresAt(x: number, z: number): number
	if FLAT then
		return FLAT_METRES
	end
	local mx, my = WorldMap.milesAt(x, z)
	local _, region = WorldMap.cellAt(mx, my)
	return WorldMap.elevationM(mx, my) + Heightfield.detailM(mx, my, region)
end

-- The grade roads are built to (m) at a point on a road's centre line: the ground without its
-- smallest bumps, so a road rides the land's swells but not every hummock.
--
-- Roads take a long, smooth grade: the map's ground averaged over a few hundred studs and drawn
-- smoothly between points of a 400-stud lattice, so a road rises and falls only with the
-- land's broad slope (none of the small hills), and the ground is cut or banked to meet it.
local GRADE_STEP = 400
local gradeCache: { [number]: number } = {}
local gradeCached = 0
local function latticeM(i: number, j: number): number
	local key = i * 2003 + j
	local v = gradeCache[key]
	if v then
		return v
	end
	local sum = 0
	for di = -1, 1 do
		for dj = -1, 1 do
			sum += WorldMap.elevationM(WorldMap.milesAt(i * GRADE_STEP + di * GRADE_STEP * 0.5, j * GRADE_STEP + dj * GRADE_STEP * 0.5))
		end
	end
	local mean = sum / 9
	if gradeCached > 200000 then
		table.clear(gradeCache)
		gradeCached = 0
	end
	gradeCache[key] = mean
	gradeCached += 1
	return mean
end

local function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number
	return p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)))
end

function Heightfield.gradeM(mx: number, my: number): number
	if FLAT then
		return FLAT_METRES
	end
	local x, z = WorldMap.studsAt(mx, my)
	local gx, gz = x / GRADE_STEP, z / GRADE_STEP
	local i0, j0 = math.floor(gx), math.floor(gz)
	local fx, fz = gx - i0, gz - j0
	local rows = table.create(4, 0)
	for b = -1, 2 do
		rows[b + 2] = catmull(latticeM(i0 - 1, j0 + b), latticeM(i0, j0 + b), latticeM(i0 + 1, j0 + b), latticeM(i0 + 2, j0 + b), fx)
	end
	return catmull(rows[1], rows[2], rows[3], rows[4], fz)
end

-- Metres to studs above the place's zero (the map's base height).
function Heightfield.toStuds(metres: number): number
	return (metres - BASE_M) * VERTICAL
end

function Heightfield.studsAt(x: number, z: number): number
	return Heightfield.toStuds(Heightfield.metresAt(x, z))
end

return Heightfield
