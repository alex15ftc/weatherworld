--!strict
-- The road network round one chunk, as straight segments with a cross-section each, taken from
-- the map's road graph (js/worldmap/streets.js, read through WorldMap.roadEdges): every road from
-- the interstates down to the town streets is an edge of that graph, already cut, joined and ended
-- by the map's road rules, so nothing here decides where a road runs or what it meets. Everything
-- else asks the network where the roads are: the terrain is flattened under them, road parts are
-- laid along them, and signs, lights, poles, buildings and trees keep clear of them.
--
-- Cross-sections follow US practice, at 12-stud lanes (about 12 ft at character scale); their
-- half-widths are the ones the map plans with (streets.js HALF_MI):
--   interstate   two 12-stud lanes each way, 10-stud outer and 4-stud inner shoulders, a
--                26-stud grass median;
--   expressway   two lanes each way, 8 and 2-stud shoulders, a 10-stud median;
--   highway      one lane each way, 6-stud shoulders;
--   arterial     two 11-stud lanes each way, sidewalks (paved section lines in towns);
--   collector    one 11-stud lane each way, a 4-stud parking strip and a sidewalk each side (the
--                half-mile roads through city neighbourhoods);
--   county       one 11-stud lane each way, 2-stud shoulders (paved section lines; frontage
--                roads and the airfields' and campuses' own roads take it too);
--   avenue       one 11-stud lane each way, an 8-stud parking lane each side, sidewalks (the
--                streets of town and city centres: the graph's wide streets);
--   street       one 10-stud lane each way, a grass strip and a sidewalk each side (town streets);
--   gravel 20 studs wide, dirt 13.
-- Town roads with sidewalks have a CURB-stud curb at the pavement's edge; the sidewalk lies at
-- the back of the verge.
--
-- A road's end comes from its node in the graph: a cul-de-sac (a bulb: a segment of no length
-- whose pavement is the turning circle), a dead end, or a barrier where a paved road stops at an
-- interstate. Junction controls (stop signs, signals) come from the nodes as well.

local RoadNet = {}

export type Spec = {
	key: string,
	priority: number, -- where roads cross, the higher one's surface and paint run through
	pavement: number, -- half-width of the surface, shoulders included
	total: number, -- half-width including sidewalks or verges
	median: number, -- half-width of a grass median (divided roads)
	lane: number,
	lanesEach: number,
	innerShoulder: number,
	sidewalk: number,
	surface: string, -- "asphalt", "gravel", "dirt"
	town: boolean,
}

local function spec(t: { [string]: any }): Spec
	t.median = t.median or 0
	t.innerShoulder = t.innerShoulder or 0
	t.sidewalk = t.sidewalk or 0
	t.surface = t.surface or "asphalt"
	t.town = t.town or false
	t.total = t.total or t.pavement
	return (t :: any) :: Spec
end

RoadNet.SPECS = {
	interstate = spec({ key = "interstate", priority = 9, pavement = 13 + 4 + 24 + 10, median = 13, lane = 12, lanesEach = 2, innerShoulder = 4 }),
	expressway = spec({ key = "expressway", priority = 8, pavement = 5 + 2 + 24 + 8, median = 5, lane = 12, lanesEach = 2, innerShoulder = 2 }),
	highway = spec({ key = "highway", priority = 7, pavement = 18, lane = 12, lanesEach = 1 }),
	arterial = spec({ key = "arterial", priority = 6, pavement = 22, total = 29, lane = 11, lanesEach = 2, sidewalk = 7, town = true }),
	county = spec({ key = "county", priority = 5, pavement = 13, lane = 11, lanesEach = 1 }),
	urban = spec({ key = "urban", priority = 4, pavement = 19, total = 26, lane = 11, lanesEach = 1, sidewalk = 7, town = true }),
	collector = spec({ key = "collector", priority = 4.2, pavement = 15, total = 22, lane = 11, lanesEach = 1, sidewalk = 6, town = true }),
	suburban = spec({ key = "suburban", priority = 3, pavement = 10, total = 18, lane = 10, lanesEach = 1, sidewalk = 5, town = true }),
	-- An interchange ramp: one 12-stud lane, shoulders either side.
	ramp = spec({ key = "ramp", priority = 4.5, pavement = 11, lane = 12, lanesEach = 1 }),
	gravel = spec({ key = "gravel", priority = 2, pavement = 10, lane = 10, lanesEach = 1, surface = "gravel" }),
	dirt = spec({ key = "dirt", priority = 1, pavement = 6.5, lane = 6.5, lanesEach = 1, surface = "dirt" }),
}
local S = RoadNet.SPECS
-- The cross-section of each kind of road in the graph (Meta.graph.kinds).
RoadNet.KINDS = {
	interstate = S.interstate, expressway = S.expressway, highway = S.highway, ramp = S.ramp,
	arterial = S.arterial, county = S.county, collector = S.collector, ["local"] = S.county,
	street = S.suburban, avenue = S.urban, gravel = S.gravel, dirt = S.dirt, frontage = S.county,
} :: { [string]: Spec }
local MAIN = { interstate = true, expressway = true, highway = true, ramp = true }
RoadNet.MAX_TOTAL = S.interstate.total
RoadNet.CURB = 1

-- A cul-de-sac's cross-section for a street: a turning circle of two lanes and a bit, the curb
-- and the street's sidewalk round it.
local bulbSpecs: { [string]: Spec } = {}
function RoadNet.bulbSpec(s: Spec): Spec
	local b = bulbSpecs[s.key]
	if not b then
		local r = 2 * s.lane + 6
		b = spec({ key = s.key, priority = s.priority, pavement = r, total = r + RoadNet.CURB + s.sidewalk, lane = s.lane, lanesEach = 1, sidewalk = s.sidewalk, town = true })
		bulbSpecs[s.key] = b
	end
	return b
end

export type Segment = {
	spec: Spec,
	ax: number, az: number, bx: number, bz: number,
	length: number, ux: number, uz: number,
	axis: string?, -- "x" or "z" for roads along the grid (which coordinate runs along them)
	main: boolean, -- an interstate, expressway or highway, or a ramp
	mapLocal: boolean?, -- another road off the grid's lines (its bends filled like the main roads')
	terminal: boolean?, -- a ramp's last piece: its end b meets the crossing road (stop sign there)
	deadEnd: string?, -- "a" or "b": the road stops at that end
	barrier: boolean?, -- a barrier across the dead end (paved roads stopped at an interstate)
	bulb: boolean?, -- a cul-de-sac: no length, its pavement the turning circle round (ax, az)
	controlA: number, -- the junction control at each end (0 none, 1 stop signs, 2 signals)
	controlB: number,
	degreeA: number, -- how many roads meet at each end (2: the road only bends or carries on)
	degreeB: number,
	key: string,
}

export type Net = {
	segments: { Segment }, -- the roads within the pad of the chunk
	all: { Segment }, -- every road handed in (further out: for planning bridges that reach in)
	near: (self: Net, x: number, z: number, pad: number, skip: ((Segment) -> boolean)?) -> (Segment?, number, number),
	clear: (self: Net, x: number, z: number, margin: number) -> boolean,
	clearBox: (self: Net, frame: CFrame, sx: number, sz: number, margin: number) -> boolean,
	covering: (self: Net, x: number, z: number, except: Segment?, pad: number) -> Segment?,
}

local function segment(s: Spec, ax: number, az: number, bx: number, bz: number, main: boolean, axis: string?): Segment
	local length = math.sqrt((bx - ax) ^ 2 + (bz - az) ^ 2)
	return {
		spec = s, ax = ax, az = az, bx = bx, bz = bz, length = length,
		ux = if length > 0 then (bx - ax) / length else 1, uz = if length > 0 then (bz - az) / length else 0,
		axis = axis, main = main, key = `{s.key}{ax},{az},{bx},{bz}`,
		controlA = 0, controlB = 0, degreeA = 2, degreeB = 2,
	}
end

-- Distance from a point to a segment's centre line, and how far along it (studs).
function RoadNet.toSegment(g: Segment, x: number, z: number): (number, number)
	local s = math.clamp((x - g.ax) * g.ux + (z - g.az) * g.uz, 0, g.length)
	local px, pz = g.ax + g.ux * s - x, g.az + g.uz * s - z
	return math.sqrt(px * px + pz * pz), s
end
local toSegment = RoadNet.toSegment

local NetMethods = {}
NetMethods.__index = NetMethods

-- The road whose grade the ground takes at a point: the segment, the distance from its centre
-- line, and how far along it. Where roads' pavements cover the point, the one whose surface is
-- laid there (the highest in priority, as Roads lays them; of equals the one whose centre line is
-- nearer); otherwise the one whose footprint (total half-width plus pad) reaches furthest over
-- it. Segments that skip answers true for are left out (a road not laid at the point: carried on
-- a bridge there).
function NetMethods.near(self: Net, x: number, z: number, pad: number, skip: ((Segment) -> boolean)?): (Segment?, number, number)
	local best, bestEdge, bestD, bestS = nil, math.huge, 0, 0
	local over, overD, overS = nil, 0, 0
	for _, g in self.segments do
		local d, s = toSegment(g, x, z)
		local edge = d - g.spec.total
		if edge < pad and not (skip and skip(g)) then
			if d < g.spec.pavement and (not over or g.spec.priority > over.spec.priority or (g.spec.priority == over.spec.priority and d < overD)) then
				over, overD, overS = g, d, s
			end
			if edge < bestEdge or (edge == bestEdge and best and g.spec.priority > best.spec.priority) then
				best, bestEdge, bestD, bestS = g, edge, d, s
			end
		end
	end
	if over then
		return over, overD, overS
	end
	return best, bestD, bestS
end

-- True when no road (with its sidewalks) comes within margin of the point.
function NetMethods.clear(self: Net, x: number, z: number, margin: number): boolean
	for _, g in self.segments do
		local d = toSegment(g, x, z)
		if d < g.spec.total + margin then
			return false
		end
	end
	return true
end

-- True when a box (centre frame, size across x and z) stands clear of every road by margin:
-- tested at its corners and across it at points no more than CLEAR_STEP studs apart (closer than
-- the narrowest road is wide, so none can pass between them: a slanted road, a dead-end stub or a
-- cul-de-sac reaching into a block).
local CLEAR_STEP = 12
function NetMethods.clearBox(self: Net, frame: CFrame, sx: number, sz: number, margin: number): boolean
	local nx, nz = math.max(2, math.ceil(sx / CLEAR_STEP)), math.max(2, math.ceil(sz / CLEAR_STEP))
	for i = 0, nx do
		for j = 0, nz do
			local p = frame * Vector3.new((i / nx - 0.5) * sx, 0, (j / nz - 0.5) * sz)
			if not self:clear(p.X, p.Z, margin) then
				return false
			end
		end
	end
	return true
end

-- Another segment whose paved surface (plus pad) covers the point.
function NetMethods.covering(self: Net, x: number, z: number, except: Segment?, pad: number): Segment?
	for _, g in self.segments do
		if g ~= except and toSegment(g, x, z) < g.spec.pavement + pad then
			return g
		end
	end
	return nil
end

export type Edge = { kind: string, ax: number, az: number, bx: number, bz: number, endA: number, endB: number, controlA: number, controlB: number, degreeA: number, degreeB: number }
export type Ctx = {
	x0: number, z0: number, x1: number, z1: number,
	edges: { Edge }, -- the graph's edges round the box (WorldMap.roadEdges)
}

local END_BULB, END_BARRIER = 1, 3

-- Builds the network from the graph's edges: `segments` holds those within pad studs of the box.
function RoadNet.build(ctx: Ctx, pad: number): Net
	local segments: { Segment }, all: { Segment } = {}, {}
	local x0, z0, x1, z1 = ctx.x0 - pad, ctx.z0 - pad, ctx.x1 + pad, ctx.z1 + pad
	local bulbs: { [string]: boolean } = {}
	for _, e in ctx.edges do
		local s = RoadNet.KINDS[e.kind]
		if s then
			-- A ramp runs towards its controlled end (where it meets the crossing road).
			local flip = e.kind == "ramp" and e.controlA > 0 and e.controlB == 0
			local ax, az, bx, bz = e.ax, e.az, e.bx, e.bz
			local endA, endB, controlA, controlB, degreeA, degreeB = e.endA, e.endB, e.controlA, e.controlB, e.degreeA, e.degreeB
			if flip then
				ax, az, bx, bz = bx, bz, ax, az
				endA, endB, controlA, controlB, degreeA, degreeB = endB, endA, controlB, controlA, degreeB, degreeA
			end
			local main = MAIN[e.kind] == true
			-- (The main roads take no axis, as they never did: their junctions are worked out
			-- where they cross, Roads.build, and their paint is measured from their starts.)
			local axis = if main then nil elseif ax == bx then "z" elseif az == bz then "x" else nil
			local g = segment(s, ax, az, bx, bz, main, axis)
			g.mapLocal = not main and axis == nil
			g.controlA, g.controlB, g.degreeA, g.degreeB = controlA, controlB, degreeA, degreeB
			g.terminal = e.kind == "ramp" and controlB > 0
			if endA > END_BULB then
				g.deadEnd, g.barrier = "a", endA == END_BARRIER
			elseif endB > END_BULB then
				g.deadEnd, g.barrier = "b", endB == END_BARRIER
			end
			local near = math.max(ax, bx) >= x0 and math.min(ax, bx) <= x1 and math.max(az, bz) >= z0 and math.min(az, bz) <= z1
			table.insert(all, g)
			if near then
				table.insert(segments, g)
			end
			-- Cul-de-sacs at the street ends the graph marks.
			for _, tip in { { endA, ax, az }, { endB, bx, bz } } do
				local x, z = tip[2], tip[3]
				if tip[1] == END_BULB and s.town and not bulbs[`{x},{z}`] and x >= x0 and x <= x1 and z >= z0 and z <= z1 then
					bulbs[`{x},{z}`] = true
					local b = segment(RoadNet.bulbSpec(s), x, z, x, z, false)
					b.bulb = true
					table.insert(segments, b)
				end
			end
		end
	end
	return setmetatable({ segments = segments, all = all }, NetMethods) :: any
end

return RoadNet
