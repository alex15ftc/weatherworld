--!strict
-- Every road as parts, laid on the graded terrain along the road network (RoadNet), with its
-- markings and furniture, after US practice (MUTCD) at 12-stud lanes:
--   lines 0.5 studs wide; broken lines 9 on, 27 off (10 ft dashes in 40 ft);
--   divided roads: solid white right edge, solid yellow left (median) edge, broken white
--     between lanes;
--   two-lane highways: double solid yellow centre, solid white edges;
--   county roads: broken yellow centre, solid white edges; arterials: double yellow centre,
--     broken white lane lines; city streets: double yellow, white parking-lane lines;
--   paint stops where a road of equal or higher rank crosses; stop bars on stop-controlled
--     approaches; crosswalks and signals at town and downtown crossings;
--   signs, signals, lights and poles stand beyond the road's edge (and sidewalks), never on a
--     road.
-- Town roads have a concrete gutter along the pavement's edge, a curb, then the verge (grass,
-- on suburban streets) and the sidewalk. Sidewalks stop at the edge of a crossing road's
-- footprint; each street corner is a concrete pad between the two curbs. Cul-de-sacs (RoadNet
-- bulbs) are a round turning circle with a curb and sidewalk round it, open where the street
-- comes in. Where a road continues along the same line at a narrower width, its pavement tapers
-- over a short distance instead of stepping in.
-- Gravel and dirt roads are parts too (no paint). Each chunk lays the parts inside it.

local Builder = require(script.Parent.Builder)
local RoadNet = require(script.Parent.RoadNet)

local Roads = {}

local M = Enum.Material
local hash = Builder.hash
local rgb = Color3.fromRGB

Roads.LIFT = 0.25 -- road top above the graded terrain
-- Road strips are laid in straight pieces between breakpoints worked out once a segment (and
-- shared by its pavement, edges and paint, so their seams line up): each piece as long as the
-- grade stays within FIT_TOL studs of the straight line (sampled every FIT_STEP studs), from
-- Roads.PIECE (the old fixed length, used wherever even that bends more) up to FIT_MAX, with a
-- breakpoint at each end of the segment's part in the chunk and wherever another road crosses it.
Roads.PIECE = 32
local FIT_TOL, FIT_STEP, FIT_MAX = 0.02, 8, 128
-- Road slabs are this thick, their tops on the grade: smooth terrain draws its surface a stud or
-- two above the height written, so the ground is cut well below the road (see ChunkGen) and the
-- slab's sides close the gap.
Roads.BED = 4
local LINE_W, LINE_T = 0.5, 0.06
local DASH, CYCLE = 9, 36

local SURFACE = {
	asphalt = { colour = rgb(54, 54, 58), material = M.Asphalt },
	gravel = { colour = rgb(158, 148, 128), material = M.Pebble },
	dirt = { colour = rgb(128, 102, 72), material = M.Ground },
}
local CONCRETE = rgb(178, 174, 166)
local CURB_COLOUR = rgb(196, 192, 184)
local GUTTER = rgb(150, 148, 142)
local VERGE = rgb(92, 128, 70)
local CURB = RoadNet.CURB
local CURB_RISE = 0.6 -- curb and sidewalk tops above the road's
local GUTTER_W = 1.2
local WHITE = rgb(238, 238, 232)
local YELLOW = rgb(232, 182, 36)
local POLE = rgb(118, 122, 128)
local WOOD = rgb(104, 84, 62)
local LAMP = rgb(255, 226, 170)

export type Ctx = {
	x0: number, z0: number, x1: number, z1: number,
	props: Builder.Props,
	net: RoadNet.Net,
	inside: (x: number, z: number) -> boolean,
	gradeTop: (x: number, z: number) -> number,
	ground: (x: number, z: number) -> number,
	coverKey: (x: number, z: number) -> string,
	bridged: (x: number, z: number, g: RoadNet.Segment?) -> boolean,
	downtown: (x: number, z: number) -> boolean,
}

type Line = { offset: number, colour: Color3, dashed: boolean }

-- The painted lines of a cross-section (offsets from the centre line, + to the right of travel
-- in the segment's direction).
local function linesFor(s: RoadNet.Spec): { Line }
	local lines: { Line } = {}
	local function add(offset: number, colour: Color3, dashed: boolean)
		table.insert(lines, { offset = offset, colour = colour, dashed = dashed })
	end
	local key = s.key
	if key == "interstate" or key == "expressway" then
		for _, side in { -1, 1 } do
			local inner = s.median + s.innerShoulder
			add(side * (inner + LINE_W / 2), YELLOW, false)
			add(side * (inner + s.lane), WHITE, true)
			add(side * (inner + 2 * s.lane - LINE_W / 2), WHITE, false)
		end
	elseif key == "highway" then
		add(-0.45, YELLOW, false)
		add(0.45, YELLOW, false)
		add(-(s.lane - LINE_W / 2), WHITE, false)
		add(s.lane - LINE_W / 2, WHITE, false)
	elseif key == "arterial" then
		add(-0.45, YELLOW, false)
		add(0.45, YELLOW, false)
		add(-s.lane, WHITE, true)
		add(s.lane, WHITE, true)
	elseif key == "county" then
		add(0, YELLOW, true)
		add(-(s.lane - LINE_W / 2), WHITE, false)
		add(s.lane - LINE_W / 2, WHITE, false)
	elseif key == "ramp" then
		add(-(s.lane / 2 + 0.25), YELLOW, false)
		add(s.lane / 2 + 0.25, WHITE, false)
	elseif key == "collector" or key == "urban" then
		add(-0.45, YELLOW, false)
		add(0.45, YELLOW, false)
		add(-s.lane, WHITE, false)
		add(s.lane, WHITE, false)
	end
	return lines
end

-- A segment's road top as straight pieces: breakpoints s (distances along it) and the grade top
-- h at each.
type Fit = { s: { number }, h: { number } }

local function fitGrade(ctx: Ctx, g: RoadNet.Segment, t0: number, t1: number): Fit
	local function top(t: number): number
		return ctx.gradeTop(g.ax + g.ux * t, g.az + g.uz * t)
	end
	-- Fixed breakpoints: the chunk's edges (so pieces meet the next chunk's) and the crossings.
	local fixed = { t0, t1 }
	for _, o in ctx.net.segments do
		if o ~= g then
			local t: number? = nil
			local wx, wz = o.ax - g.ax, o.az - g.az
			if o.bulb then
				if math.abs(wx * -g.uz + wz * g.ux) < o.spec.total + g.spec.total then
					t = wx * g.ux + wz * g.uz
				end
			else
				local den = g.ux * o.uz - g.uz * o.ux
				if math.abs(den) > 0.05 then
					local u = (wx * g.uz - wz * g.ux) / den -- along o
					local pad = (o.spec.total + g.spec.total) / math.abs(den)
					if u >= -pad and u <= o.length + pad then
						t = (wx * o.uz - wz * o.ux) / den -- along g
					end
				end
			end
			if t and t > t0 + 1 and t < t1 - 1 then
				table.insert(fixed, t)
			end
		end
	end
	table.sort(fixed)
	local fit: Fit = { s = { t0 }, h = { top(t0) } }
	local prevFixed = t0
	for f = 2, #fixed do
		local B = fixed[f]
		if B - prevFixed >= 1 or f == #fixed then
			local A = prevFixed
			-- Samples every FIT_STEP studs from A to B (the last at B).
			local n = math.max(1, math.ceil((B - A) / FIT_STEP))
			local pos, hs = table.create(n + 1, 0), table.create(n + 1, 0)
			pos[1], hs[1] = A, fit.h[#fit.h]
			for k = 1, n do
				local t = math.min(A + k * FIT_STEP, B)
				pos[k + 1], hs[k + 1] = t, top(t)
			end
			local i = 1
			while i <= n do
				local best = math.min(n + 1, i + Roads.PIECE // FIT_STEP)
				for _, len in { FIT_MAX, 96, 64 } do
					local j = math.min(n + 1, i + len // FIT_STEP)
					if j <= best then
						break
					end
					local ok = true
					local span = pos[j] - pos[i]
					for k = i + 1, j - 1 do
						local line = hs[i] + (hs[j] - hs[i]) * (pos[k] - pos[i]) / span
						if math.abs(hs[k] - line) > FIT_TOL then
							ok = false
							break
						end
					end
					if ok then
						best = j
						break
					end
				end
				table.insert(fit.s, pos[best])
				table.insert(fit.h, hs[best])
				i = best
			end
			prevFixed = B
		end
	end
	-- A little beyond the chunk's edge, for dashes that start inside it.
	if t1 < g.length then
		local te = math.min(g.length, t1 + DASH + 1)
		table.insert(fit.s, te)
		table.insert(fit.h, top(te))
	end
	return fit
end

-- The fitted road top at distance t along the segment (straight beyond the ends).
local function fitAt(fit: Fit, t: number): number
	local s, h = fit.s, fit.h
	local n = #s
	local k = 1
	while k < n - 1 and t > s[k + 1] do
		k += 1
	end
	local span = s[k + 1] - s[k]
	return if span > 1e-6 then h[k] + (h[k + 1] - h[k]) * (t - s[k]) / span else h[k]
end

-- A flat strip along the road between distances a and b, at a sideways offset, its top raise
-- above the road top: straight pieces between the segment's breakpoints, each (but the last)
-- run on over the joint by over studs.
local function strip(ctx: Ctx, g: RoadNet.Segment, fit: Fit, a: number, b: number, offset: number, width: number, thickness: number, raise: number, colour: Color3, material: Enum.Material, collide: boolean?, over: number?)
	if b - a < 0.05 then
		return
	end
	local rx, rz = -g.uz, g.ux -- right of travel
	local function piece(pa: number, pb: number, extra: number)
		local p0 = Vector3.new(g.ax + g.ux * pa + rx * offset, fitAt(fit, pa) + raise, g.az + g.uz * pa + rz * offset)
		local p1 = Vector3.new(g.ax + g.ux * pb + rx * offset, fitAt(fit, pb) + raise, g.az + g.uz * pb + rz * offset)
		local length = (p1 - p0).Magnitude
		if extra > 0 then
			p1 += (p1 - p0) * (extra / length)
			length += extra
		end
		local cf = CFrame.lookAt((p0 + p1) / 2, p1) * CFrame.new(0, -thickness / 2, 0)
		Builder.block(ctx.props, cf, width, thickness, length, colour, material, collide)
	end
	local prev = a
	for _, bp in fit.s do
		if bp > prev + 0.05 and bp < b - 0.05 then
			piece(prev, bp, over or 0)
			prev = bp
		end
	end
	piece(prev, b, 0)
end

-- The part of a segment inside the chunk, as distances along it.
local function clip(ctx: Ctx, g: RoadNet.Segment): (number?, number?)
	local t0, t1 = 0, g.length
	for _, e in { { g.ux, g.ax, ctx.x0, ctx.x1 }, { g.uz, g.az, ctx.z0, ctx.z1 } } do
		local u, a, lo, hi = e[1], e[2], e[3], e[4]
		if math.abs(u) < 1e-9 then
			if a < lo or a >= hi then
				return nil, nil
			end
		else
			local s0, s1 = (lo - a) / u, (hi - a) / u
			if s0 > s1 then
				s0, s1 = s1, s0
			end
			t0, t1 = math.max(t0, s0), math.min(t1, s1)
		end
	end
	if t1 - t0 < 0.01 then
		return nil, nil
	end
	return t0, t1
end

-- Runs [a, b] along the segment (within [t0, t1]) where test holds, sampled every step studs.
local function runs(g: RoadNet.Segment, t0: number, t1: number, step: number, test: (number, number) -> boolean): { { number } }
	local out = {}
	local start: number? = nil
	local n = math.max(1, math.ceil((t1 - t0) / step))
	for i = 0, n do
		local s = t0 + (t1 - t0) * i / n
		local ok = test(g.ax + g.ux * s, g.az + g.uz * s)
		if ok and not start then
			start = s
		elseif not ok and start then
			table.insert(out, { start, s })
			start = nil
		end
	end
	if start then
		table.insert(out, { start, t1 })
	end
	return out
end

-- Where along a segment its dashes fall: absolute position along the axis for grid roads (so
-- they line up across chunks), distance from the start for the map's roads.
local function dashOrigin(g: RoadNet.Segment): number
	if g.axis == "z" then
		return g.az
	elseif g.axis == "x" then
		return g.ax
	end
	return 0
end

local function streetLight(props: Builder.Props, x: number, y: number, z: number, towardX: number, towardZ: number, double: boolean)
	local height = 28
	Builder.rod(props, Vector3.new(x, y - 1, z), Vector3.new(x, y + height, z), 0.8, POLE, M.Metal)
	for _, side in (if double then { 1, -1 } else { 1 }) :: { number } do
		local ex, ez = x + towardX * 8 * side, z + towardZ * 8 * side
		Builder.rod(props, Vector3.new(x, y + height - 0.5, z), Vector3.new(ex, y + height + 0.6, ez), 0.45, POLE, M.Metal, false)
		Builder.block(props, CFrame.lookAt(Vector3.new(ex, y + height + 0.3, ez), Vector3.new(ex + towardX * side, y + height + 0.3, ez + towardZ * side)), 1.4, 0.6, 3.2, LAMP, M.Neon, false)
	end
end

-- A signal mast at (x, z): an arm reaching (ax, az) by reach over the approach lanes, signal
-- heads on it facing (fx, fz), toward the traffic they control.
local function signalMast(props: Builder.Props, x: number, y: number, z: number, ax: number, az: number, reach: number, fx: number, fz: number, lit: string)
	local top = y + 21
	Builder.rod(props, Vector3.new(x, y - 1, z), Vector3.new(x, top + 1, z), 1.1, POLE, M.Metal)
	Builder.rod(props, Vector3.new(x, top, z), Vector3.new(x + ax * reach, top, z + az * reach), 0.6, POLE, M.Metal, false)
	for _, at in { 0.5, 0.85 } do
		local hx, hz = x + ax * reach * at, z + az * reach * at
		local facing = CFrame.lookAt(Vector3.new(hx, top - 3, hz), Vector3.new(hx + fx, top - 3, hz + fz))
		Builder.block(props, facing, 1.6, 4.6, 1.4, rgb(32, 32, 32), M.SmoothPlastic, false)
		Builder.block(props, facing * CFrame.new(0, 0, 0.75), 2.2, 5.2, 0.1, rgb(20, 20, 20), M.SmoothPlastic, false)
		for i, colour in { rgb(225, 40, 30), rgb(235, 170, 30), rgb(40, 210, 90) } do
			local on = (lit == "red" and i == 1) or (lit == "green" and i == 3)
			Builder.add(props, "Ball", facing * CFrame.new(0, 1.45 - (i - 1) * 1.45, -0.72), Vector3.new(1, 1, 1), if on then colour else colour:Lerp(rgb(0, 0, 0), 0.75), if on then M.Neon else M.SmoothPlastic, false)
		end
	end
end

local function stopSign(props: Builder.Props, x: number, y: number, z: number, faceX: number, faceZ: number)
	Builder.rod(props, Vector3.new(x, y - 1, z), Vector3.new(x, y + 7.5, z), 0.3, POLE, M.Metal, false)
	Builder.rod(props, Vector3.new(x, y + 8.4, z), Vector3.new(x + faceX * 0.15, y + 8.4, z + faceZ * 0.15), 3, rgb(196, 28, 28), M.SmoothPlastic, false)
	Builder.rod(props, Vector3.new(x + faceX * 0.16, y + 8.4, z + faceZ * 0.16), Vector3.new(x + faceX * 0.2, y + 8.4, z + faceZ * 0.2), 2.5, WHITE, M.SmoothPlastic, false)
end

-- Another road whose surface (or, with total, its sidewalks too) reaches over the point, not
-- counting pieces of the same road continuing along the same line.
local function crossingRoad(ctx: Ctx, g: RoadNet.Segment, x: number, z: number, total: boolean, pad: number): RoadNet.Segment?
	for _, o in ctx.net.segments do
		if o ~= g and not o.bulb then
			local sameLine = math.abs(o.ux * g.ux + o.uz * g.uz) > 0.995 and math.abs((o.ax - g.ax) * -g.uz + (o.az - g.az) * g.ux) < 1
			if not sameLine and RoadNet.toSegment(o, x, z) < (if total then o.spec.total else o.spec.pavement) + pad then
				return o
			end
		end
	end
	return nil
end

-- Whether the edge of road g (its curb, verge or sidewalk) is taken at a point by another road:
-- within that road's pavement (for the curb) or its whole footprint (verge and sidewalk),
-- measured square to it and only alongside it (not beyond its ends, so a street ending at g
-- takes only g's near side). A cul-de-sac takes the circle of its footprint.
local function edgeTaken(near: { RoadNet.Segment }, g: RoadNet.Segment, x: number, z: number, total: boolean): boolean
	for _, o in near do
		if o ~= g then
			local reach = if total then o.spec.total else o.spec.pavement
			if o.bulb then
				if (x - o.ax) ^ 2 + (z - o.az) ^ 2 < reach * reach then
					return true
				end
			else
				local sameLine = math.abs(o.ux * g.ux + o.uz * g.uz) > 0.995 and math.abs((o.ax - g.ax) * -g.uz + (o.az - g.az) * g.ux) < 1
				if not sameLine then
					local along = (x - o.ax) * o.ux + (z - o.az) * o.uz
					local across = math.abs((x - o.ax) * -o.uz + (z - o.az) * o.ux)
					if along > -0.5 and along < o.length + 0.5 and across < reach then
						return true
					end
				end
			end
		end
	end
	return false
end

-- Whether a point lies in a cul-de-sac's turning circle (less margin).
local function inBulb(ctx: Ctx, x: number, z: number, margin: number): boolean
	for _, o in ctx.net.segments do
		if o.bulb and (x - o.ax) ^ 2 + (z - o.az) ^ 2 < (o.spec.pavement - margin) ^ 2 then
			return true
		end
	end
	return false
end

-- A road's surface, sidewalks and paint inside the chunk.
local function layRoad(ctx: Ctx, g: RoadNet.Segment)
	local t0, t1 = clip(ctx, g)
	if not t0 or not t1 then
		return
	end
	local s = g.spec
	local surface = SURFACE[s.surface]
	local raise = 0.004 * s.priority
	local fit = fitGrade(ctx, g, t0, t1)
	-- Not over bridges, and not where a higher road runs along the same line (map roads often
	-- share a corridor for a stretch).
	local function shadowed(x: number, z: number): boolean
		for _, o in ctx.net.segments do
			if o ~= g and o.spec.priority > s.priority and math.abs(o.ux * g.ux + o.uz * g.uz) > 0.9 and RoadNet.toSegment(o, x, z) < o.spec.pavement then
				return true
			end
		end
		return false
	end
	-- The surface stops at the edge of a higher road it meets (equal roads share a patch).
	local open = runs(g, t0, t1, 2, function(x: number, z: number): boolean
		if ctx.bridged(x, z, g) or shadowed(x, z) then
			return false
		end
		local other = crossingRoad(ctx, g, x, z, false, -2.5)
		return not (other and other.spec.priority > s.priority)
	end)
	for _, run in open do
		local a0, a1 = run[1], run[2]
		if s.median > 0 then
			local width = s.pavement - s.median
			for _, side in { -1, 1 } do
				strip(ctx, g, fit, a0, a1, side * (s.median + width / 2), width, Roads.BED, raise, surface.colour, surface.material, nil, 0.4)
			end
		else
			strip(ctx, g, fit, a0, a1, 0, 2 * s.pavement, Roads.BED, raise, surface.colour, surface.material, nil, 0.4)
		end
	end
	-- Edges of town roads, each side: a gutter on the pavement, the curb, the verge and the
	-- sidewalk. The curb runs to the crossing road's pavement; verge and sidewalk stop at its
	-- footprint (the corner pads fill the corners).
	if s.sidewalk > 0 then
		local verge = s.total - s.sidewalk - s.pavement - CURB
		-- The roads that could reach g's edges.
		local near = {}
		for _, o in ctx.net.segments do
			local reach = s.total + o.spec.total + 1
			if math.max(o.ax, o.bx) > math.min(g.ax, g.bx) - reach and math.min(o.ax, o.bx) < math.max(g.ax, g.bx) + reach
				and math.max(o.az, o.bz) > math.min(g.az, g.bz) - reach and math.min(o.az, o.bz) < math.max(g.az, g.bz) + reach then
				table.insert(near, o)
			end
		end
		for _, side in { -1, 1 } do
			local function lay(offset: number, width: number, total: boolean, thickness: number, top: number, colour: Color3, material: Enum.Material, collide: boolean?)
				if width <= 0.05 then
					return
				end
				local walk = runs(g, t0, t1, 2, function(x: number, z: number): boolean
					local wx, wz = x - g.uz * side * offset, z + g.ux * side * offset
					return not ctx.bridged(wx, wz, g) and not shadowed(x, z) and not edgeTaken(near, g, wx, wz, total)
				end)
				for _, run in walk do
					strip(ctx, g, fit, run[1], run[2], side * offset, width, thickness, top, colour, material, collide)
				end
			end
			lay(s.pavement - GUTTER_W / 2, GUTTER_W, false, LINE_T, raise + LINE_T - 0.02, GUTTER, M.Concrete, false)
			lay(s.pavement + CURB / 2, CURB, false, Roads.BED + CURB_RISE, raise + CURB_RISE + 0.02, CURB_COLOUR, M.Concrete)
			lay(s.pavement + CURB + verge / 2, verge, true, Roads.BED + CURB_RISE, raise + CURB_RISE - 0.05, VERGE, M.Grass)
			lay(s.total - s.sidewalk / 2, s.sidewalk, true, Roads.BED + CURB_RISE, raise + CURB_RISE, CONCRETE, M.Concrete)
		end
	end

	-- Paint, broken where an equal or higher road crosses (and over bridges, which paint their own).
	local lines = linesFor(s)
	if #lines == 0 then
		return
	end
	local function free(x: number, z: number): boolean
		if ctx.bridged(x, z, g) or shadowed(x, z) then
			return false
		end
		if inBulb(ctx, x, z, -2) then
			return false
		end
		local other = crossingRoad(ctx, g, x, z, false, 14) -- lines end at the stop bar
		return not (other and other.spec.priority >= s.priority)
	end
	local clearRuns = runs(g, t0, t1, 3, free)
	local origin = dashOrigin(g)
	for _, line in lines do
		if line.dashed then
			local sign = if g.axis == "z" then g.uz elseif g.axis == "x" then g.ux else 1
			-- Dash starts in absolute terms, converted to distance along the segment.
			local first = math.ceil((origin + sign * t0 - (if sign < 0 then DASH else 0)) / CYCLE)
			for k = first, first + math.ceil((t1 - t0) / CYCLE) + 1 do
				local p = k * CYCLE
				local a = (p - origin) * sign
				local b = a + DASH * sign
				if sign < 0 then
					a, b = b, a
				end
				if a >= t0 and a < t1 then
					local mid = (a + b) / 2
					if free(g.ax + g.ux * mid, g.az + g.uz * mid) then
						strip(ctx, g, fit, a, math.min(b, g.length), line.offset, LINE_W, LINE_T, raise + LINE_T - 0.01, line.colour, M.SmoothPlastic, false)
					end
				end
			end
		else
			for _, run in clearRuns do
				strip(ctx, g, fit, run[1], run[2], line.offset, LINE_W, LINE_T, raise + LINE_T - 0.01, line.colour, M.SmoothPlastic, false)
			end
		end
	end
end

-- A stop-controlled approach: traffic arriving along (dx, dz) toward (x, z) stops before a
-- crossing road cross studs wide (crossTotal with its sidewalks or verges).
local function stopArm(ctx: Ctx, x: number, z: number, top: number, dx: number, dz: number, s: RoadNet.Spec, cross: number, crossTotal: number)
	local rx, rz = dz, -dx -- right of traffic heading (-dx, -dz)
	local lanes = s.lane * s.lanesEach
	if s.surface == "asphalt" then
		local bx, bz = x + dx * (cross + 5) + rx * lanes / 2, z + dz * (cross + 5) + rz * lanes / 2
		local by = ctx.gradeTop(bx - rx * lanes / 2, bz - rz * lanes / 2) + 0.004 * s.priority + LINE_T
		Builder.block(ctx.props, CFrame.lookAt(Vector3.new(bx, by, bz), Vector3.new(bx + dx, by, bz + dz)), lanes, LINE_T, 1.5, WHITE, M.SmoothPlastic, false)
	end
	local px, pz = x + dx * (crossTotal + 6) + rx * (s.total + 3), z + dz * (crossTotal + 6) + rz * (s.total + 3)
	if ctx.inside(px, pz) and ctx.net:clear(px, pz, 0.5) then
		stopSign(ctx.props, px, ctx.ground(px, pz), pz, dx, dz)
	end
end

-- A signalled approach: traffic arriving along (dx, dz) toward (x, z) across a road cross studs
-- wide (crossTotal with its sidewalks): a crosswalk, a stop bar, and a signal mast on its right
-- with the arm reaching over its lanes.
local function signalArm(ctx: Ctx, x: number, z: number, dx: number, dz: number, s: RoadNet.Spec, cross: number, crossTotal: number, lit: string)
	local props = ctx.props
	local rx, rz = dz, -dx -- right of traffic heading (-dx, -dz)
	local lanes = s.lane * s.lanesEach
	local paint = 0.004 * s.priority + LINE_T
	for _, d in { cross + 2, cross + 10 } do
		local cx, cz = x + dx * d, z + dz * d
		local y = ctx.gradeTop(cx, cz) + paint
		Builder.block(props, CFrame.lookAt(Vector3.new(cx, y, cz), Vector3.new(cx + dx, y, cz + dz)), 2 * s.pavement - 1, LINE_T, 0.8, WHITE, M.SmoothPlastic, false)
	end
	local bx, bz = x + dx * (cross + 13) + rx * lanes / 2, z + dz * (cross + 13) + rz * lanes / 2
	local by = ctx.gradeTop(bx - rx * lanes / 2, bz - rz * lanes / 2) + paint
	Builder.block(props, CFrame.lookAt(Vector3.new(bx, by, bz), Vector3.new(bx + dx, by, bz + dz)), lanes, LINE_T, 1.5, WHITE, M.SmoothPlastic, false)
	local px, pz = x + dx * (crossTotal + 3) + rx * (s.total + 2), z + dz * (crossTotal + 3) + rz * (s.total + 2)
	if ctx.inside(px, pz) and ctx.net:clear(px, pz, 0.5) then
		signalMast(props, px, ctx.ground(px, pz), pz, -rx, -rz, s.total, dx, dz, lit)
	end
end

-- Crossings of grid roads (section lines and town streets): an intersection patch where equal
-- roads cross; stop signs and stop bars, or signals and crosswalks.
-- (control: the graph's control at the node, 0 none, 1 stop signs, 2 signals)
type Arm = { g: RoadNet.Segment, dx: number, dz: number, control: number }

local function controlNode(ctx: Ctx, x: number, z: number, arms: { Arm })
	local props = ctx.props
	local top = ctx.gradeTop(x, z)
	local hasX, hasZ = false, false
	local best: RoadNet.Spec? = nil
	local widest = { x = 0, z = 0 }
	for _, arm in arms do
		local s = arm.g.spec
		if arm.dx ~= 0 then
			hasX = true
			widest.z = math.max(widest.z, s.pavement)
		else
			hasZ = true
			widest.x = math.max(widest.x, s.pavement)
		end
		if not best or s.priority > best.priority then
			best = s
		end
	end
	if not (hasX and hasZ) or not best or ctx.bridged(x, z) then
		return
	end
	-- Patch over the crossing, a hair above both roads.
	local surface = SURFACE[best.surface]
	Builder.block(props, CFrame.new(x, top + 0.004 * best.priority + 0.006 - Roads.BED / 2, z), 2 * widest.x, Roads.BED, 2 * widest.z, surface.colour, surface.material)

	local town = best.town or ctx.coverKey(x, z) == "urban" or ctx.coverKey(x, z) == "suburban"
	local function crossHalf(arm: Arm, total: boolean): number
		local h = 0
		for _, other in arms do
			if (other.dx ~= 0) ~= (arm.dx ~= 0) then
				h = math.max(h, if total then other.g.spec.total else other.g.spec.pavement)
			end
		end
		return h
	end
	-- The node's control as the map's road graph has it (streets.js): signals where arterials and
	-- collectors cross in town and where a highway meets a road; stop signs on the lesser
	-- approaches elsewhere on paved roads; none where only gravel and dirt roads meet. A downtown
	-- corner with signs gets signals.
	local control = 0
	for _, arm in arms do
		control = math.max(control, arm.control)
	end
	local signals = control == 2 or (control == 1 and town and ctx.downtown(x, z) and #arms >= 3)
	for _, arm in arms do
		local s = arm.g.spec
		local hx, hz = -arm.dx, -arm.dz -- heading of traffic arriving along this arm
		local rx, rz = -hz, hx -- its right
		local lanes = s.lane * s.lanesEach
		local cross = crossHalf(arm, false)
		local crossTotal = crossHalf(arm, true)
		if signals then
			signalArm(ctx, x, z, arm.dx, arm.dz, s, cross, crossTotal, if arm.dx ~= 0 then "green" else "red")
		else
			-- Stop the lesser road; equal paved roads stop the north-south arms; equal gravel and
			-- dirt roads cross uncontrolled.
			local stop = s.priority < best.priority or (s.priority == best.priority and s.surface == "asphalt" and arm.dx == 0)
			if stop and control > 0 then
				stopArm(ctx, x, z, top, arm.dx, arm.dz, s, cross, crossTotal)
			end
		end
	end

	-- Corner pads: in each corner between two arms with sidewalks, concrete from curb to curb
	-- out to the backs of both sidewalks.
	for _, ax in arms do
		for _, az in arms do
			local a, b = ax.g.spec, az.g.spec
			if ax.dx ~= 0 and az.dz ~= 0 and a.sidewalk > 0 and b.sidewalk > 0 then
				-- ax runs along x (its edges are z offsets), az along z.
				local x0, x1 = b.pavement + CURB, b.total
				local z0, z1 = a.pavement + CURB, a.total
				local cx, cz = x + ax.dx * (x0 + x1) / 2, z + az.dz * (z0 + z1) / 2
				if ctx.inside(cx, cz) then
					local y = ctx.gradeTop(cx, cz) + 0.004 * math.max(a.priority, b.priority) + CURB_RISE
					Builder.block(props, CFrame.new(cx, y - (Roads.BED + CURB_RISE) / 2, cz), x1 - x0, Roads.BED + CURB_RISE, z1 - z0, CONCRETE, M.Concrete)
				end
			end
		end
	end
end

-- A cul-de-sac: the turning circle, then curb and sidewalk round it in short chords, open where
-- a street comes in.
local function layBulb(ctx: Ctx, b: RoadNet.Segment)
	local x, z = b.ax, b.az
	if not ctx.inside(x, z) or ctx.bridged(x, z) then
		return
	end
	local s = b.spec
	local props = ctx.props
	local raise = 0.004 * s.priority
	local top = ctx.gradeTop(x, z) + raise
	local surface = SURFACE[s.surface]
	Builder.add(props, "Cylinder", CFrame.new(x, top - Roads.BED / 2, z) * CFrame.Angles(0, 0, math.pi / 2), Vector3.new(Roads.BED, 2 * s.pavement, 2 * s.pavement), surface.colour, surface.material)
	-- The streets coming in: their directions out of the circle and half-widths.
	local mouths = {}
	for _, g in ctx.net.segments do
		if not g.bulb then
			for _, e in { { g.ax, g.az, g.ux, g.uz }, { g.bx, g.bz, -g.ux, -g.uz } } do
				if math.abs(e[1] - x) < 0.5 and math.abs(e[2] - z) < 0.5 then
					table.insert(mouths, { dx = e[3], dz = e[4], half = g.spec.pavement + 0.5 })
				end
			end
		end
	end
	local SIDES = 28
	for _, ring in { { s.pavement + CURB / 2, CURB, CURB_COLOUR, 0.02 }, { s.pavement + CURB + s.sidewalk / 2, s.sidewalk, CONCRETE, 0 } } do
		local r, width, colour, lift = ring[1], ring[2], ring[3], ring[4]
		for k = 0, SIDES - 1 do
			local a = (k + 0.5) / SIDES * 2 * math.pi
			local dx, dz = math.cos(a), math.sin(a)
			local open = false
			for _, m in mouths do
				-- Across the street's line, this chord's middle lies within its pavement.
				if dx * m.dx + dz * m.dz > 0 and math.abs(dx * m.dz - dz * m.dx) * r < m.half then
					open = true
				end
			end
			if not open then
				local chord = 2 * r * math.sin(math.pi / SIDES) + 0.6
				local cx, cz = x + dx * r, z + dz * r
				local y = top + CURB_RISE + lift
				Builder.block(props, CFrame.new(cx, y - (Roads.BED + CURB_RISE) / 2, cz) * CFrame.Angles(0, -a, 0), width, Roads.BED + CURB_RISE, chord, colour, M.Concrete)
			end
		end
	end
end

-- Where a road meets a narrower one continuing along its line, the wide pavement narrows over
-- a taper on the narrow road's side: two flat triangles from the wide edges in to the narrow
-- road's edges.
local function taper(ctx: Ctx, wide: RoadNet.Segment, x: number, z: number, ux: number, uz: number, narrow: number)
	local s = wide.spec
	local step = s.pavement - narrow
	if step < 1 or s.median > 0 then
		return
	end
	local length = math.clamp(step * 4, 16, 48)
	local mx, mz = x + ux * length / 2, z + uz * length / 2
	if not ctx.inside(mx, mz) or ctx.bridged(mx, mz) then
		return
	end
	local surface = SURFACE[s.surface]
	local top = ctx.gradeTop(mx, mz) + 0.004 * s.priority - 0.003
	local u = Vector3.new(ux, 0, uz)
	for _, side in { -1, 1 } do
		local r = Vector3.new(-uz, 0, ux) * side
		-- A wedge's triangle lies in its YZ plane, the right angle at (-Y, +Z): turned so Y runs
		-- across the road and -Z along it, the triangle lies flat.
		local vy, vz = r, -u
		local vx = vy:Cross(vz)
		local corner = Vector3.new(x, top - Roads.BED / 2, z) + r * narrow
		local centre = corner + vy * step / 2 - vz * length / 2
		Builder.add(ctx.props, "Wedge", CFrame.fromMatrix(centre, vx, vy, vz), Vector3.new(Roads.BED, step, length), surface.colour, surface.material)
	end
end

function Roads.build(ctx: Ctx)
	local props, net = ctx.props, ctx.net
	for _, g in net.segments do
		if g.bulb then
			layBulb(ctx, g)
		else
			layRoad(ctx, g)
		end
	end

	-- Tapers where a road continues along its line at a narrower width.
	for _, g in net.segments do
		if not g.bulb then
			for _, e in { { g.ax, g.az, -g.ux, -g.uz }, { g.bx, g.bz, g.ux, g.uz } } do
				local x, z, ux, uz = e[1], e[2], e[3], e[4]
				for _, o in net.segments do
					if o ~= g and not o.bulb and o.spec.pavement < g.spec.pavement - 1 and math.abs(o.ux * ux + o.uz * uz) > 0.995 then
						local startsHere = (math.abs(o.ax - x) < 1 and math.abs(o.az - z) < 1) or (math.abs(o.bx - x) < 1 and math.abs(o.bz - z) < 1)
						-- Not where another road meets them there (a junction, not a taper).
						local junction = false
						for _, c in net.segments do
							if c ~= g and c ~= o and not c.bulb and RoadNet.toSegment(c, x, z) < c.spec.pavement + 2 then
								junction = true
							end
						end
						if startsHere and not junction then
							taper(ctx, g, x, z, ux, uz, o.spec.pavement)
						end
					end
				end
			end
		end
	end

	-- Bends in the roads off the grid's lines: where two pieces of one road meet at an angle, a
	-- disc of road surface at the joint fills the wedge left between them. A divided road gets a
	-- disc on each carriageway (at the middle of each, along the bend's bisector), so its median
	-- stays grass; where the road only carries straight on, nothing is needed.
	local joints: { [string]: { g: RoadNet.Segment, ux: number, uz: number } } = {}
	for _, g in net.segments do
		if (g.main or g.mapLocal) and not g.bulb then
			local s = g.spec
			for _, e in { { g.ax, g.az, g.ux, g.uz }, { g.bx, g.bz, -g.ux, -g.uz } } do
				local x, z, ux, uz = e[1], e[2], e[3], e[4]
				local key = `{s.key},{math.round(x * 10)},{math.round(z * 10)}`
				local first = joints[key]
				if not first then
					joints[key] = { g = g, ux = ux, uz = uz }
				elseif first.g ~= g and math.abs(first.ux * uz - first.uz * ux) > 0.004 and ctx.inside(x, z) and not ctx.bridged(x, z, g) then
					local top = ctx.gradeTop(x, z) + 0.004 * s.priority - 0.003
					local surface = SURFACE[s.surface]
					if s.median > 0 then
						-- Across the road at the joint: the bisector of the two pieces' normals.
						local nx, nz = -(uz - first.uz), ux - first.ux
						local l = math.sqrt(nx * nx + nz * nz)
						local centre, half = (s.median + s.pavement) / 2, (s.pavement - s.median) / 2
						for _, side in { -1, 1 } do
							local cx, cz = x + nx / l * centre * side, z + nz / l * centre * side
							Builder.add(props, "Cylinder", CFrame.new(cx, top - Roads.BED / 2, cz) * CFrame.Angles(0, 0, math.pi / 2), Vector3.new(Roads.BED, 2 * half, 2 * half), surface.colour, surface.material)
						end
					else
						Builder.add(props, "Cylinder", CFrame.new(x, top - Roads.BED / 2, z) * CFrame.Angles(0, 0, math.pi / 2), Vector3.new(Roads.BED, 2 * s.pavement, 2 * s.pavement), surface.colour, surface.material)
					end
				end
			end
		end
	end

	-- Grid crossings inside the chunk: the ends of grid segments, and where a map road crosses
	-- a grid road.
	local nodes: { [string]: { x: number, z: number, arms: { Arm } } } = {}
	local function node(x: number, z: number): { x: number, z: number, arms: { Arm } }?
		if not ctx.inside(x, z) then
			return nil
		end
		local key = `{math.round(x)},{math.round(z)}`
		local n = nodes[key]
		if not n then
			n = { x = x, z = z, arms = {} }
			nodes[key] = n
		end
		return n
	end
	for _, g in net.segments do
		if g.axis then
			for _, e in { { g.ax, g.az, g.ux, g.uz, g.controlA }, { g.bx, g.bz, -g.ux, -g.uz, g.controlB } } do
				local n = node(e[1], e[2])
				if n then
					table.insert(n.arms, { g = g, dx = e[3], dz = e[4], control = e[5] })
				end
			end
		end
	end
	-- Grid segments are cut at block corners, so a straight-through road shows as two arms;
	-- a map road crossing a grid road adds no node (its own paint runs through).
	for _, n in nodes do
		if #n.arms >= 3 or (#n.arms == 2 and (n.arms[1].dx ~= 0) ~= (n.arms[2].dx ~= 0)) then
			controlNode(ctx, n.x, n.z, n.arms)
		end
	end

	-- Where a US highway (expressway or highway) meets another, or a paved road or street, at
	-- grade: traffic signals on every approach. Where a gravel or dirt road meets a two-lane
	-- highway: stop signs on the gravel road. (Interstates meet nothing at grade; gravel and dirt
	-- roads never reach an expressway.)
	local junctions = {}
	for _, m in net.segments do
		if m.main and (m.spec.key == "highway" or m.spec.key == "expressway") then
			for _, h in net.segments do
				local hKey = h.spec.key
				local unpaved = h.spec.surface ~= "asphalt"
				local other = h ~= m and not h.bulb and (not unpaved or m.spec.key == "highway") and hKey ~= "interstate" and hKey ~= "ramp"
					and not (h.main and h.key < m.key) -- two highways: met once
				local den = m.ux * h.uz - m.uz * h.ux
				if other and math.abs(den) > 0.3 then
					local wx, wz = h.ax - m.ax, h.az - m.az
					local t = (wx * h.uz - wz * h.ux) / den -- along m
					local u = (wx * m.uz - wz * m.ux) / den -- along h
					if t >= -1 and t <= m.length + 1 and u >= -1 and u <= h.length + 1 then
						local x, z = m.ax + m.ux * t, m.az + m.uz * t
						local key = `{math.round(x / 8)},{math.round(z / 8)}`
						if ctx.inside(x, z) and not ctx.bridged(x, z) and not junctions[key] then
							junctions[key] = true
							local sinT = math.abs(den)
							if h.main then
								-- Two highways of equal standing: a disc of surface over the crossing.
								local top = ctx.gradeTop(x, z) + 0.004 * math.max(m.spec.priority, h.spec.priority) + 0.004
								local r = math.max(m.spec.pavement, h.spec.pavement) / sinT
								Builder.add(props, "Cylinder", CFrame.new(x, top - Roads.BED / 2, z) * CFrame.Angles(0, 0, math.pi / 2), Vector3.new(Roads.BED, 2 * r, 2 * r), SURFACE.asphalt.colour, SURFACE.asphalt.material)
							end
							-- Each road's two approaches, where the road continues that way.
							for _, pair in { { h, m }, { m, h } } do
								local road, crossing = pair[1], pair[2]
								for _, dir in { 1, -1 } do
									local probe = crossing.spec.total / sinT + 14
									local px, pz = x + road.ux * dir * probe, z + road.uz * dir * probe
									local there = net:covering(px, pz, nil, 0)
									if there and there.spec.key == road.spec.key then
										if unpaved then
											if road == h then
												stopArm(ctx, x, z, ctx.gradeTop(x, z), road.ux * dir, road.uz * dir, road.spec, crossing.spec.pavement / sinT, crossing.spec.total / sinT)
											end
										else
											signalArm(ctx, x, z, road.ux * dir, road.uz * dir, road.spec, crossing.spec.pavement / sinT, crossing.spec.total / sinT, if road == m then "green" else "red")
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

	-- Where a road stops short of an interstate: a barrier across it.
	for _, g in net.segments do
		if g.deadEnd and g.barrier then
			local x, z = if g.deadEnd == "a" then g.ax else g.bx, if g.deadEnd == "a" then g.az else g.bz
			if ctx.inside(x, z) and not ctx.bridged(x, z, g) then
				local top = ctx.gradeTop(x, z)
				local cf = CFrame.lookAt(Vector3.new(x, top + 2, z), Vector3.new(x + g.ux, top + 2, z + g.uz))
				Builder.block(props, cf, 2 * g.spec.pavement, 2.4, 0.8, WHITE, M.SmoothPlastic)
				for i = -2, 2 do
					Builder.block(props, cf * CFrame.new(i * g.spec.pavement * 0.4, 0, -0.45), 2, 2.2, 0.1, rgb(220, 120, 20), M.SmoothPlastic, false)
				end
				for _, side in { -1, 1 } do
					local post = cf * CFrame.new(side * (g.spec.pavement - 0.5), -1.5, 0)
					Builder.block(props, post, 0.6, 3, 0.6, rgb(90, 90, 90), M.Metal)
				end
			end
		end
	end

	-- Ramps meeting the highway they serve: signals at the ramp's end.
	for _, g in net.segments do
		if g.terminal and ctx.inside(g.bx, g.bz) then
			local cross = 13
			local other = net:covering(g.bx, g.bz, g, 0)
			if other and other.spec.key ~= "ramp" then
				cross = other.spec.pavement
			end
			signalArm(ctx, g.bx, g.bz, -g.ux, -g.uz, g.spec, cross, cross + 4, "red")
		end
	end

	-- Street lights along town roads and through towns, beyond the sidewalk, every 120 studs.
	for _, g in net.segments do
		local s = g.spec
		local t0, t1 = clip(ctx, g)
		if t0 and t1 and (s.town or g.main) then
			local origin = dashOrigin(g)
			local sign = if g.axis == "z" then g.uz elseif g.axis == "x" then g.ux else 1
			local first = math.ceil((origin + sign * math.min(t0, t1)) / 120) - 1
			for k = first, first + math.ceil((t1 - t0) / 120) + 2 do
				local along = (k * 120 + 60 - origin) * sign
				if along >= t0 and along < t1 then
					local cx, cz = g.ax + g.ux * along, g.az + g.uz * along
					local key = ctx.coverKey(cx, cz)
					if (key == "urban" or key == "suburban") and not ctx.bridged(cx, cz) then
						if s.median > 0 then
							if net:covering(cx, cz, g, 2) == nil then
								streetLight(props, cx, ctx.gradeTop(cx, cz), cz, -g.uz, g.ux, true)
							end
						else
							local side = if k % 2 == 0 then 1 else -1
							local lx, lz = cx - g.uz * side * (s.total + 2), cz + g.ux * side * (s.total + 2)
							if ctx.inside(lx, lz) and net:clear(lx, lz, 1) then
								streetLight(props, lx, ctx.ground(lx, lz), lz, g.uz * side, -g.ux * side, false)
							end
						end
					end
				end
			end
		end
	end

	-- Utility poles along country section roads, every 125 studs on the east or south side,
	-- with two wires to the next pole.
	for _, g in net.segments do
		local s = g.spec
		if g.axis and (s.key == "county" or s.key == "gravel" or s.key == "dirt") then
			local offset = s.pavement + 9
			local function poleAt(c: number): Vector3?
				local x = if g.axis == "z" then g.ax + offset else c
				local z = if g.axis == "z" then c else g.az + offset
				local key = ctx.coverKey(x, z)
				if key == "urban" or key == "suburban" or ctx.bridged(x, z) or not net:clear(x, z, 1) then
					return nil
				end
				return Vector3.new(x, ctx.ground(x, z), z)
			end
			local lo = math.min(if g.axis == "z" then g.az else g.ax, if g.axis == "z" then g.bz else g.bx)
			local hi = math.max(if g.axis == "z" then g.az else g.ax, if g.axis == "z" then g.bz else g.bx)
			for c = math.ceil(lo / 125) * 125, hi - 0.001, 125 do
				local here = poleAt(c)
				if here and ctx.inside(here.X, here.Z) then
					local top = here + Vector3.new(0, 30, 0)
					Builder.rod(props, here - Vector3.new(0, 2, 0), top, 1.1, WOOD, M.Wood)
					local arm = if g.axis == "z" then Vector3.new(4, 0, 0) else Vector3.new(0, 0, 4)
					Builder.beam(props, top - Vector3.new(0, 1.5, 0) - arm, top - Vector3.new(0, 1.5, 0) + arm, 0.5, WOOD, M.Wood, false)
					local nextPole = poleAt(c + 125)
					if nextPole then
						local nextTop = nextPole + Vector3.new(0, 28.5, 0)
						for _, side in { -1, 1 } do
							Builder.beam(props, top - Vector3.new(0, 1.2, 0) + arm * side * 0.9, nextTop + arm * side * 0.9 + Vector3.new(0, 0.3, 0), 0.15, rgb(30, 30, 30), M.SmoothPlastic, false)
						end
					end
				end
			end
		end
	end
	local _ = hash
end

return Roads
