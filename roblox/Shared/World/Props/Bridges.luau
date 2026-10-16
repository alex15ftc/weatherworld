--!strict
-- Bridges where a road crosses a river too wide for a culvert. The chunk holding the crossing
-- point builds the whole bridge (it may reach into the next chunks). The kind follows the span
-- and the road, with a hash for variety:
--   under 70 studs           concrete beam bridge on round piers;
--   70 to 150                steel girder, steel through truss, or concrete deck arch;
--   over 150, interstates    suspension or cable-stayed;
--   over 150, other roads    steel tied arch or long through truss.
-- The deck sits clear of the water; where that is above the road on either bank, an embanked
-- ramp brings the road up to it.

local Builder = require(script.Parent.Builder)

local Bridges = {}

local M = Enum.Material
local hash = Builder.hash

local CONCRETE = Color3.fromRGB(170, 166, 158)
local ASPHALT = Color3.fromRGB(52, 52, 56)
local WHITE = Color3.fromRGB(236, 236, 230)
local YELLOW = Color3.fromRGB(230, 184, 40)
local STEELS = { Color3.fromRGB(70, 110, 90), Color3.fromRGB(110, 116, 124), Color3.fromRGB(60, 84, 120) }
local SUSPENSION = { Color3.fromRGB(190, 70, 40), Color3.fromRGB(150, 156, 162), Color3.fromRGB(196, 170, 70) }

Bridges.BANK_EXTRA = 18 -- the bridge reaches this far past each side of the water

-- A crossing of a river, or (overpass) of a road the bridge's road passes over: riverHalf is then
-- that road's half-width along the bridge, water its surface, clearance the headroom over it.
export type Crossing = { x: number, z: number, ux: number, uz: number, riverHalf: number, water: number, roadHalf: number, kind: number, surface: string?, priority: number?, overpass: boolean?, clearance: number?, belowDivided: boolean? }
-- What a bridge occupies, ramps included: a centre line and a half-width.
export type Footprint = { ax: number, az: number, bx: number, bz: number, half: number }

export type Ctx = {
	props: Builder.Props,
	gradeTop: (x: number, z: number) -> number,
	ground: (x: number, z: number) -> number,
}

local function along(c: Crossing, s: number, side: number, y: number): Vector3
	-- s along the road from the crossing point, side across it (to the right of travel).
	return Vector3.new(c.x + c.ux * s - c.uz * side, y, c.z + c.uz * s + c.ux * side)
end

local function pier(props: Builder.Props, c: Crossing, s: number, halfWidth: number, top: number, bottom: number)
	for _, side in { -1, 1 } do
		local p = along(c, s, side * (halfWidth - 4), 0)
		Builder.rod(props, Vector3.new(p.X, bottom, p.Z), Vector3.new(p.X, top - 2, p.Z), 4, CONCRETE, M.Concrete)
	end
	local a, b = along(c, s, -halfWidth + 1, top - 2), along(c, s, halfWidth - 1, top - 2)
	Builder.beam(props, a, b, 3.2, CONCRETE, M.Concrete)
end

-- y of a parabolic arch from 0 at the ends of [0, span] to rise at the middle.
local function arch(s: number, span: number, rise: number): number
	local t = s / span
	return 4 * rise * t * (1 - t)
end

-- Builds the bridge for a crossing (unless dryRun) and returns its footprint.
function Bridges.build(ctx: Ctx, c: Crossing, dryRun: boolean?): Footprint
	local props: Builder.Props = if dryRun then {} else ctx.props
	local halfSpan = c.riverHalf + Bridges.BANK_EXTRA
	local span = 2 * halfSpan
	local width = 2 * c.roadHalf + 4
	local half = width / 2
	local a, b = along(c, -halfSpan, 0, 0), along(c, halfSpan, 0, 0)
	local gA, gB = ctx.gradeTop(a.X, a.Z), ctx.gradeTop(b.X, b.Z)
	-- Clear of the water by a margin growing with the span, and of the banks under the deck.
	local clear = c.clearance or (if span > 140 then 30 elseif span > 70 then 18 else 9)
	local banks = -math.huge
	for _, f in { -0.95, -0.8, 0.8, 0.95 } do
		local p = along(c, f * halfSpan, 0, 0)
		banks = math.max(banks, ctx.ground(p.X, p.Z) + 1.5)
	end
	local deck = math.max(gA, gB, c.water + clear, banks)
	local bed = if c.overpass then c.water - 2 else c.water - 10
	local r = hash(math.floor(c.x), math.floor(c.z), 91)
	local timber = c.surface == "gravel" or c.surface == "dirt"

	-- Ramps' lengths, for the footprint.
	local ramp = {}
	for i, grade in { gA, gB } do
		local rise = deck - grade
		ramp[i] = if rise > 0.6 then math.clamp(rise * 14, 24, 240) else 0
	end
	local footprint: Footprint = {
		ax = along(c, -halfSpan - ramp[1], 0, 0).X, az = along(c, -halfSpan - ramp[1], 0, 0).Z,
		bx = along(c, halfSpan + ramp[2], 0, 0).X, bz = along(c, halfSpan + ramp[2], 0, 0).Z,
		half = half + 4,
	}
	if dryRun then
		return footprint
	end

	-- Deck, road surface, paint and parapets (timber decks and rails on gravel and dirt roads).
	local d0, d1 = along(c, -halfSpan, 0, deck), along(c, halfSpan, 0, deck)
	if timber then
		Builder.slab(props, d0, d1, width, 2, Color3.fromRGB(110, 86, 62), M.WoodPlanks)
		for _, side in { -1, 1 } do
			Builder.slab(props, along(c, -halfSpan, side * (half - 0.5), deck), along(c, halfSpan, side * (half - 0.5), deck), 0.8, 0.8, Color3.fromRGB(96, 74, 52), M.Wood, 3.2)
			for sp = -halfSpan, halfSpan, 8 do
				local p = along(c, sp, side * (half - 0.5), deck)
				Builder.block(props, CFrame.new(p + Vector3.new(0, 1.6, 0)), 0.8, 3.2, 0.8, Color3.fromRGB(96, 74, 52), M.Wood)
			end
		end
	else
		Builder.slab(props, d0, d1, width, 3, CONCRETE, M.Concrete)
		Builder.slab(props, d0, d1, 2 * c.roadHalf, 0.3, ASPHALT, M.Asphalt, 0.15)
		local divided = c.kind == 1 or c.kind == 2
		if divided then
			Builder.beam(props, d0 + Vector3.new(0, 1, 0), d1 + Vector3.new(0, 1, 0), 1.8, CONCRETE, M.Concrete)
		else
			for _, o in { -0.45, 0.45 } do
				Builder.slab(props, along(c, -halfSpan, o, deck), along(c, halfSpan, o, deck), 0.5, 0.06, YELLOW, M.SmoothPlastic, 0.36)
			end
		end
		for _, side in { -1, 1 } do
			Builder.slab(props, along(c, -halfSpan, side * (c.roadHalf - 1), deck), along(c, halfSpan, side * (c.roadHalf - 1), deck), 0.5, 0.06, WHITE, M.SmoothPlastic, 0.36)
			Builder.slab(props, along(c, -halfSpan, side * (half - 0.9), deck), along(c, halfSpan, side * (half - 0.9), deck), 1.6, 2.4, CONCRETE, M.Concrete, 2.2)
		end
	end

	-- Abutments at each end, down into the bank.
	for _, dir in { -1, 1 } do
		local p = along(c, dir * (halfSpan - 2), 0, 0)
		local base = math.min(ctx.ground(p.X, p.Z), c.water) - 6
		Builder.block(props, CFrame.lookAt(Vector3.new(p.X, (deck - 2 + base) / 2, p.Z), Vector3.new(p.X + c.ux, (deck - 2 + base) / 2, p.Z + c.uz)), width, math.max(2, deck - 2 - base), 5, CONCRETE, M.Concrete)
	end

	-- Ramps up from the road on each bank, on an earth embankment.
	for i, dir in { -1, 1 } do
		local length = ramp[i]
		if length > 0 then
			local farXZ = along(c, dir * (halfSpan + length), 0, 0)
			local near, far = along(c, dir * halfSpan, 0, deck), along(c, dir * (halfSpan + length), 0, ctx.gradeTop(farXZ.X, farXZ.Z))
			-- The ramp's road: as thick as the road it meets, with the same paint.
			Builder.slab(props, near, far, 2 * c.roadHalf, 4, if timber then Color3.fromRGB(150, 140, 120) else ASPHALT, if timber then M.Pebble else M.Asphalt, 0.05)
			if not timber then
				local function ramped(side: number): (Vector3, Vector3)
					return along(c, dir * halfSpan, side, near.Y), along(c, dir * (halfSpan + length), side, far.Y)
				end
				type Line = { offset: number, width: number, colour: Color3, height: number }
				local lines: { Line } = if c.kind == 1 or c.kind == 2
					then { { offset = 0, width = 1.8, colour = CONCRETE, height = 1 } }
					else {
						{ offset = -0.45, width = 0.5, colour = YELLOW, height = 0.1 },
						{ offset = 0.45, width = 0.5, colour = YELLOW, height = 0.1 },
					}
				for _, side in { -1, 1 } do
					table.insert(lines, { offset = side * (c.roadHalf - 1), width = 0.5, colour = WHITE, height = 0.1 })
				end
				for _, l in lines do
					local p0, p1 = ramped(l.offset)
					Builder.slab(props, p0, p1, l.width, l.height, l.colour, if l.colour == CONCRETE then M.Concrete else M.SmoothPlastic, 0.05 + l.height)
				end
			end
			local groundY = ctx.ground(near.X, near.Z) - 2
			local mid = (Vector3.new(near.X, 0, near.Z) + Vector3.new(far.X, 0, far.Z)) / 2
			local height = math.max(1, deck - 1.5 - groundY)
			-- A wedge's slope faces its front: point the front away from the bridge (the low end).
			Builder.add(props, "Wedge", CFrame.lookAt(Vector3.new(mid.X, groundY + height / 2, mid.Z), Vector3.new(far.X, groundY + height / 2, far.Z)), Vector3.new(width + 6, height, length), Color3.fromRGB(110, 120, 70), M.Grass)
		end
	end

	if span < 76 and not c.overpass then
		-- A short bridge: the deck on its abutments, with a pier in the middle of the longer ones.
		if span > 50 then
			pier(props, c, 0, half, deck - (if timber then 2 else 3), bed)
		end
		return footprint
	end

	local steel = STEELS[1 + math.floor(r * 7) % 3]
	local kind
	if c.overpass or span < 110 then
		kind = if r < 0.5 then "beam" else "girder"
	elseif span < 160 then
		kind = if r < 0.35 then "truss" elseif r < 0.7 then "deckArch" else "girder"
	elseif c.kind <= 2 then
		kind = if r < 0.55 then "suspension" else "cableStayed"
	else
		kind = if r < 0.6 then "tiedArch" else "truss"
	end

	if kind == "beam" or kind == "girder" then
		if c.overpass then
			-- Over a road: one pier in its median (or none), never in its lanes.
			if c.belowDivided then
				pier(props, c, 0, half, deck - 3, bed)
			end
		else
			local bays = math.max(1, math.round(span / 34))
			for i = 1, bays - 1 do
				pier(props, c, -halfSpan + span * i / bays, half, deck - 3, bed)
			end
		end
		if kind == "girder" then
			for _, side in { -1, 1 } do
				Builder.slab(props, along(c, -halfSpan, side * (half - 5), deck - 3), along(c, halfSpan, side * (half - 5), deck - 3), 1.2, 6, steel, M.Metal)
			end
		end
	elseif kind == "truss" then
		local panels = math.max(3, math.round(span / 18))
		local height = 20
		for i = 1, panels - 1 do
			if i % 3 == 0 then
				pier(props, c, -halfSpan + span * i / panels, half, deck - 3, bed)
			end
		end
		-- A Pratt truss each side: bottom chord along the deck, top chord over the inner panels,
		-- inclined end posts, verticals, and diagonals sloping down toward the middle.
		for _, side in { -1, 1 } do
			local o = side * (half + 0.6)
			local function bottom(i: number): Vector3
				return along(c, -halfSpan + span * i / panels, o, deck + 0.5)
			end
			local function top(i: number): Vector3
				return along(c, -halfSpan + span * i / panels, o, deck + height)
			end
			Builder.beam(props, bottom(0), bottom(panels), 1.4, steel, M.Metal)
			Builder.beam(props, top(1), top(panels - 1), 1.4, steel, M.Metal)
			Builder.beam(props, bottom(0), top(1), 1.4, steel, M.Metal)
			Builder.beam(props, bottom(panels), top(panels - 1), 1.4, steel, M.Metal)
			for i = 1, panels - 1 do
				Builder.beam(props, bottom(i), top(i), 1, steel, M.Metal)
			end
			for i = 1, panels - 2 do
				if i < panels / 2 then
					Builder.beam(props, top(i), bottom(i + 1), 0.9, steel, M.Metal)
				else
					Builder.beam(props, top(i + 1), bottom(i), 0.9, steel, M.Metal)
				end
			end
		end
		for i = 1, panels - 1 do
			Builder.beam(props, along(c, -halfSpan + span * i / panels, -half - 0.6, deck + height), along(c, -halfSpan + span * i / panels, half + 0.6, deck + height), 0.9, steel, M.Metal, false)
		end
	elseif kind == "deckArch" then
		local springing = c.water + 1
		local rise = deck - 4 - springing
		local segments = 12
		for _, side in { -1, 1 } do
			local o = side * (half - 4)
			for i = 0, segments - 1 do
				local s0, s1 = span * i / segments, span * (i + 1) / segments
				Builder.beam(props, along(c, -halfSpan + s0, o, springing + arch(s0, span, rise)), along(c, -halfSpan + s1, o, springing + arch(s1, span, rise)), 3.5, CONCRETE, M.Concrete)
			end
			for s = 14, span - 14, 14 do
				local y = springing + arch(s, span, rise)
				if deck - 3 - y > 1 then
					Builder.rod(props, along(c, -halfSpan + s, o, y), along(c, -halfSpan + s, o, deck - 3), 1.6, CONCRETE, M.Concrete)
				end
			end
		end
	elseif kind == "tiedArch" then
		local rise = math.clamp(span * 0.2, 30, 70)
		local segments = 14
		for _, side in { -1, 1 } do
			local o = side * (half + 0.8)
			for i = 0, segments - 1 do
				local s0, s1 = span * i / segments, span * (i + 1) / segments
				Builder.beam(props, along(c, -halfSpan + s0, o, deck + arch(s0, span, rise)), along(c, -halfSpan + s1, o, deck + arch(s1, span, rise)), 2.4, steel, M.Metal)
			end
			for s = 12, span - 12, 12 do
				Builder.beam(props, along(c, -halfSpan + s, o, deck), along(c, -halfSpan + s, o, deck + arch(s, span, rise)), 0.35, steel, M.Metal, false)
			end
		end
		for i = 3, segments - 3, 2 do
			local s = span * i / segments
			Builder.beam(props, along(c, -halfSpan + s, -half - 0.8, deck + arch(s, span, rise)), along(c, -halfSpan + s, half + 0.8, deck + arch(s, span, rise)), 1.2, steel, M.Metal, false)
		end
		pier(props, c, -halfSpan + 6, half, deck - 3, bed)
		pier(props, c, halfSpan - 6, half, deck - 3, bed)
	elseif kind == "suspension" then
		local colour = SUSPENSION[1 + math.floor(r * 11) % 3]
		local towerAt = halfSpan * 0.62
		local towerTop = deck + math.clamp(span * 0.22, 40, 110)
		local sag = towerTop - (deck + 4)
		for _, t in { -towerAt, towerAt } do
			for _, side in { -1, 1 } do
				local foot, head = along(c, t, side * (half + 2), bed), along(c, t, side * (half + 2), towerTop)
				Builder.beam(props, foot, head, 4.5, colour, M.Metal)
			end
			for _, y in { deck - 4, (deck + towerTop) / 2, towerTop - 2 } do
				Builder.beam(props, along(c, t, -half - 2, y), along(c, t, half + 2, y), 3, colour, M.Metal)
			end
		end
		for _, side in { -1, 1 } do
			local o = side * (half + 2)
			local mainSpan, segments = 2 * towerAt, 16
			local function cableY(s: number): number -- s from the left tower
				local t = s / mainSpan
				return towerTop - sag * 4 * t * (1 - t)
			end
			for i = 0, segments - 1 do
				local s0, s1 = mainSpan * i / segments, mainSpan * (i + 1) / segments
				Builder.beam(props, along(c, -towerAt + s0, o, cableY(s0)), along(c, -towerAt + s1, o, cableY(s1)), 1.1, colour, M.Metal, false)
			end
			for s = 10, mainSpan - 10, 10 do
				Builder.beam(props, along(c, -towerAt + s, o, deck), along(c, -towerAt + s, o, cableY(s)), 0.3, colour, M.Metal, false)
			end
			-- Back stays down to anchor blocks at the ends of the bridge.
			for _, dir in { -1, 1 } do
				local anchor = along(c, dir * (halfSpan + 4), o, deck + 2)
				Builder.beam(props, along(c, dir * towerAt, o, towerTop), anchor, 1.1, colour, M.Metal, false)
				Builder.block(props, CFrame.lookAt(anchor - Vector3.new(0, 3, 0), anchor - Vector3.new(0, 3, 0) + Vector3.new(c.ux, 0, c.uz)), 7, 10, 10, CONCRETE, M.Concrete)
			end
		end
	else -- cable-stayed: one pylon at the middle with fans of stays to both deck edges
		local top = deck + math.clamp(span * 0.32, 50, 120)
		for _, side in { -1, 1 } do
			Builder.beam(props, along(c, 0, side * (half + 3), bed), along(c, 0, side * 2, top), 5, Color3.fromRGB(200, 198, 192), M.Concrete)
		end
		Builder.beam(props, along(c, 0, -half - 3, deck - 4), along(c, 0, half + 3, deck - 4), 4, Color3.fromRGB(200, 198, 192), M.Concrete)
		for _, side in { -1, 1 } do
			for s = 16, halfSpan - 4, 14 do
				for _, dir in { -1, 1 } do
					local y = top - 4 - (s / halfSpan) * 18
					Builder.beam(props, along(c, 0, side * 2, y), along(c, dir * s, side * (half - 1), deck + 1), 0.35, WHITE, M.Metal, false)
				end
			end
		end
	end
	return footprint
end

-- Where segment a-b meets segment c-d: the point and how far along each (t, u), or nil.
function Bridges.intersect(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): (number?, number?)
	local rx, rz, sx, sz = bx - ax, bz - az, dx - cx, dz - cz
	local den = rx * sz - rz * sx
	if math.abs(den) < 1e-9 then
		return nil, nil
	end
	local t = ((cx - ax) * sz - (cz - az) * sx) / den
	local u = ((cx - ax) * rz - (cz - az) * rx) / den
	if t < 0 or t > 1 or u < 0 or u > 1 then
		return nil, nil
	end
	return t, u
end

return Bridges
