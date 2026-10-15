--!strict
-- The road network round one chunk, as straight segments with a cross-section each: the map's
-- interstates, expressways and highways; the section-line roads (paved, gravel, dirt), which
-- become four-lane arterials with sidewalks in towns; and the town street grids (200-stud
-- blocks in town and city cores, 250-stud blocks in suburbs). Everything else asks it where the
-- roads are: the terrain is flattened under them, road parts are laid along them, and signs,
-- lights, poles, buildings and trees keep clear of them.
--
-- Cross-sections follow US practice, at 12-stud lanes (about 12 ft at character scale):
--   interstate   two 12-stud lanes each way, 10-stud outer and 4-stud inner shoulders, a
--                26-stud grass median;
--   expressway   two lanes each way, 8 and 2-stud shoulders, a 10-stud median;
--   highway      one lane each way, 6-stud shoulders;
--   arterial     two 11-stud lanes each way, sidewalks (section lines in towns);
--   county       one 11-stud lane each way, 2-stud shoulders (paved section lines);
--   urban        one 11-stud lane each way, an 8-stud parking lane each side, sidewalks;
--   suburban     one 10-stud lane each way, a grass strip and a sidewalk each side;
--   gravel 20 studs wide, dirt 13.

local Interchanges = require(script.Parent.Parent.Interchanges)

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
	suburban = spec({ key = "suburban", priority = 3, pavement = 10, total = 18, lane = 10, lanesEach = 1, sidewalk = 5, town = true }),
	-- An interchange ramp: one 12-stud lane, shoulders either side.
	ramp = spec({ key = "ramp", priority = 4.5, pavement = 11, lane = 12, lanesEach = 1 }),
	gravel = spec({ key = "gravel", priority = 2, pavement = 10, lane = 10, lanesEach = 1, surface = "gravel" }),
	dirt = spec({ key = "dirt", priority = 1, pavement = 6.5, lane = 6.5, lanesEach = 1, surface = "dirt" }),
}
local S = RoadNet.SPECS
RoadNet.MAP_KINDS = { [1] = S.interstate, [2] = S.expressway, [3] = S.highway }
RoadNet.SECTION_KINDS = { [1] = S.dirt, [2] = S.gravel, [3] = S.county }
RoadNet.URBAN_GRID, RoadNet.SUBURB_GRID = 200, 250
RoadNet.MAX_TOTAL = S.interstate.total

export type Segment = {
	spec: Spec,
	ax: number, az: number, bx: number, bz: number,
	length: number, ux: number, uz: number,
	axis: string?, -- "x" or "z" for grid roads (which coordinate runs along them)
	main: boolean, -- one of the map's interstates, expressways or highways, or a ramp
	terminal: boolean?, -- a ramp's last piece: its end b meets the crossing road (stop sign there)
	deadEnd: string?, -- "a" or "b": the road stops at that end, short of a highway
	barrier: boolean?, -- a barrier across the dead end (roads cut at an interstate)
	key: string,
}

export type Net = {
	segments: { Segment },
	near: (self: Net, x: number, z: number, pad: number) -> (Segment?, number, number),
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

-- The segment whose footprint (total half-width plus pad) reaches furthest over the point:
-- the segment, the distance from its centre line, and how far along it.
function NetMethods.near(self: Net, x: number, z: number, pad: number): (Segment?, number, number)
	local best, bestEdge, bestD, bestS = nil, math.huge, 0, 0
	for _, g in self.segments do
		local d, s = toSegment(g, x, z)
		local edge = d - g.spec.total
		if edge < pad and (edge < bestEdge or (edge == bestEdge and best and g.spec.priority > best.spec.priority)) then
			best, bestEdge, bestD, bestS = g, edge, d, s
		end
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
-- its corners, edge midpoints and centre are tested.
function NetMethods.clearBox(self: Net, frame: CFrame, sx: number, sz: number, margin: number): boolean
	for _, fx in { -0.5, 0, 0.5 } do
		for _, fz in { -0.5, 0, 0.5 } do
			local p = frame * Vector3.new(fx * sx, 0, fz * sz)
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

export type Ctx = {
	x0: number, z0: number, x1: number, z1: number,
	mapRoads: { any },
	section: (I: number, J: number) -> (number, number),
	coverKey: (x: number, z: number) -> string,
	mileOf: (x: number) -> number,
	mileX: (I: number) -> number,
	crossings: { any }, -- Interchanges records near the box
}

local function isTown(key: string): boolean
	return key == "urban" or key == "suburban"
end

-- Builds the network within pad studs of the box.
function RoadNet.build(ctx: Ctx, pad: number): Net
	local segments: { Segment } = {}
	local x0, z0, x1, z1 = ctx.x0 - pad, ctx.z0 - pad, ctx.x1 + pad, ctx.z1 + pad
	local mains: { Segment } = {}
	for _, road in ctx.mapRoads do
		local g = segment(RoadNet.MAP_KINDS[road.kind], road.ax, road.az, road.bx, road.bz, true)
		table.insert(segments, g)
		table.insert(mains, g)
	end
	local function alongMain(x: number, z: number): boolean
		for _, g in mains do
			-- A main road running along this line (not just crossing it).
			if toSegment(g, x, z) < g.spec.pavement then
				return true
			end
		end
		return false
	end

	-- Section lines, in quarter-mile pieces (so a line can turn arterial where it enters a town).
	local QUARTER = 250
	for _, vertical in { true, false } do
		local lo, hi = if vertical then x0 else z0, if vertical then x1 else z1
		local alo, ahi = if vertical then z0 else x0, if vertical then z1 else x1
		for I = math.ceil(ctx.mileOf(lo)), math.floor(ctx.mileOf(hi)) do
			local line = ctx.mileX(I)
			for q = math.floor(alo / QUARTER), math.floor(ahi / QUARTER) do
				local a, b = q * QUARTER, (q + 1) * QUARTER
				local mid = (a + b) / 2
				local mile = math.floor(ctx.mileOf(mid))
				local class = if vertical then select(2, ctx.section(I, mile)) else (ctx.section(mile, I))
				if class > 0 then
					local mx, mz = if vertical then line else mid, if vertical then mid else line
					-- Dropped only where a main road runs along the line the whole way.
					local q1, q3 = a + QUARTER * 0.2, a + QUARTER * 0.8
					local along = alongMain(mx, mz)
						and alongMain(if vertical then line else q1, if vertical then q1 else line)
						and alongMain(if vertical then line else q3, if vertical then q3 else line)
					if not along then
						local s = if class == 3 and isTown(ctx.coverKey(mx, mz)) then S.arterial else RoadNet.SECTION_KINDS[class]
						if vertical then
							table.insert(segments, segment(s, line, a, line, b, false, "z"))
						else
							table.insert(segments, segment(s, a, line, b, line, false, "x"))
						end
					end
				end
			end
		end
	end

	-- Town street grids, block by block where the land is town.
	for _, grid in { { RoadNet.URBAN_GRID, "urban", S.urban }, { RoadNet.SUBURB_GRID, "suburban", S.suburban } } do
		local step, want, s = grid[1], grid[2], grid[3]
		for _, vertical in { true, false } do
			local lo, hi = if vertical then x0 else z0, if vertical then x1 else z1
			local alo, ahi = if vertical then z0 else x0, if vertical then z1 else x1
			for k = math.ceil(lo / step), math.floor(hi / step) do
				local line = k * step
				if line % 1000 ~= 0 then
					for q = math.floor(alo / step), math.floor(ahi / step) do
						local a, b = q * step, (q + 1) * step
						local mx, mz = if vertical then line else (a + b) / 2, if vertical then (a + b) / 2 else line
						if ctx.coverKey(mx, mz) == want and not alongMain(mx, mz) then
							if vertical then
								table.insert(segments, segment(s, line, a, line, b, false, "z"))
							else
								table.insert(segments, segment(s, a, line, b, line, false, "x"))
							end
						end
					end
				end
			end
		end
	end

	-- Interchange ramps.
	for _, rec in ctx.crossings do
		for rampIndex, ramp in Interchanges.ramps(rec) do
			local pts = ramp.points
			for i = 2, #pts do
				local g = segment(S.ramp, pts[i - 1].X, pts[i - 1].Y, pts[i].X, pts[i].Y, true)
				g.key = `ramp{math.round(rec.x)},{math.round(rec.z)},{rampIndex},{i}`
				g.terminal = i == #pts and not ramp.merges
				table.insert(segments, g)
			end
		end
	end

	-- At a T (one road ends at the interstate crossing), the ending road stops where it splits into
	-- its two ramps.
	for _, rec in ctx.crossings do
		local stem, _, _, split = Interchanges.tee(rec)
		if rec.interchange and stem then
			local stop = split - 3
			local p = Vector2.new(rec.x, rec.z)
			for index = #segments, 1, -1 do
				local g = segments[index]
				local a, b = Vector2.new(g.ax, g.az), Vector2.new(g.bx, g.bz)
				local dir = Vector2.new(g.ux, g.uz)
				if g.spec.key ~= "ramp" and math.abs(dir:Dot(stem)) > 0.9 and RoadNet.toSegment(g, rec.x, rec.z) < 60 + split then
					local da, db = (a - p):Dot(stem), (b - p):Dot(stem)
					if math.max(da, db) <= stop then
						table.remove(segments, index)
					elseif math.min(da, db) < stop then
						-- Move the near end out to where the road stops.
						local t = (stop - da) / (db - da)
						local cut = a:Lerp(b, t)
						local keep = if da < db then b else a
						local g2 = segment(g.spec, cut.X, cut.Y, keep.X, keep.Y, g.main, g.axis)
						segments[index] = g2
					end
				end
			end
		end
	end

	-- Interstates are crossed only where a crossing is planned (an overpass or an interchange);
	-- any other road that would cross one stops short of it on both sides.
	local interstates = {}
	for _, g in segments do
		if g.spec.key == "interstate" then
			table.insert(interstates, g)
		end
	end
	local function planned(x: number, z: number): boolean
		for _, rec in ctx.crossings do
			if (rec.x - x) ^ 2 + (rec.z - z) ^ 2 < 45 * 45 then
				return true
			end
		end
		return false
	end
	local cut = true
	while cut do
		cut = false
		for index, g in segments do
			if g.spec.key ~= "ramp" then
				for _, m in interstates do
					local sin = math.abs(m.ux * g.uz - m.uz * g.ux)
					if m ~= g and sin > 0.25 then
						local den = g.ux * m.uz - g.uz * m.ux
						local wx, wz = m.ax - g.ax, m.az - g.az
						local t = (wx * m.uz - wz * m.ux) / den -- along g
						local u = (wx * g.uz - wz * g.ux) / den -- along m
						if t > 0 and t < g.length and u >= 0 and u <= m.length then
							local x, z = g.ax + g.ux * t, g.az + g.uz * t
							if not planned(x, z) then
								local gap = m.spec.total / sin + 10
								table.remove(segments, index)
								if t - gap > 1 then
									local a = segment(g.spec, g.ax, g.az, g.ax + g.ux * (t - gap), g.az + g.uz * (t - gap), g.main, g.axis)
									a.deadEnd, a.barrier = "b", true
									table.insert(segments, a)
								end
								if g.length - t - gap > 1 then
									local b = segment(g.spec, g.ax + g.ux * (t + gap), g.az + g.uz * (t + gap), g.bx, g.bz, g.main, g.axis)
									b.deadEnd, b.barrier = "a", true
									table.insert(segments, b)
								end
								cut = true
								break
							end
						end
					end
				end
				if cut then
					break
				end
			end
		end
	end

	-- Gravel and dirt roads never reach a highway (an interstate, expressway or highway, or a
	-- ramp): each stops 40 studs short of one it would cross or run into.
	local highways = {}
	for _, g in segments do
		if g.main then
			table.insert(highways, g)
		end
	end
	local trimmed = true
	while trimmed do
		trimmed = false
		for index, g in segments do
			if g.spec.surface ~= "asphalt" then
				for _, m in highways do
					local sin = math.abs(m.ux * g.uz - m.uz * g.ux)
					if sin > 0.2 then
						local den = g.ux * m.uz - g.uz * m.ux
						local wx, wz = m.ax - g.ax, m.az - g.az
						local t = (wx * m.uz - wz * m.ux) / den -- along g
						local u = (wx * g.uz - wz * g.ux) / den -- along m
						local gap = m.spec.total / sin + 40
						if u >= -m.spec.total and u <= m.length + m.spec.total and t > -gap and t < g.length + gap then
							table.remove(segments, index)
							if t - gap > 1 then
								local a = segment(g.spec, g.ax, g.az, g.ax + g.ux * (t - gap), g.az + g.uz * (t - gap), false, g.axis)
								a.deadEnd = "b"
								table.insert(segments, a)
							end
							if g.length - t - gap > 1 then
								local b = segment(g.spec, g.ax + g.ux * (t + gap), g.az + g.uz * (t + gap), g.bx, g.bz, false, g.axis)
								b.deadEnd = "a"
								table.insert(segments, b)
							end
							trimmed = true
							break
						end
					end
				end
				if trimmed then
					break
				end
			end
		end
	end

	return setmetatable({ segments = segments }, NetMethods) :: any
end

return RoadNet
