--!nonstrict
-- Funnel shape profiles (visual plan A1-A2). A profile is the visible condensation envelope's
-- radius against normalised height h (0 ground, 1 cloud base), relative to the tornado's visual
-- scale R (StateAdapter). Profiles are blended continuously, so a tornado moves between them
-- (cone -> stovepipe -> wedge, or -> rope) without a model swap. They describe appearance only:
-- never intensity or damage.
--   ProfileLibrary.radius(weights, h) -> radius share (smooth, monotone-cubic between points)
--   ProfileLibrary.weights(state) -> { rope, cone, stovepipe, wedge } from the tornado's fields
local ProfileLibrary = {}

ProfileLibrary.FAMILIES = { "rope", "cone", "stovepipe", "wedge" }

-- control points { h, r }: values are shape, not physical measurements
ProfileLibrary.PROFILES = {
	rope = { { 0.00, 0.55 }, { 0.15, 0.45 }, { 0.40, 0.42 }, { 0.65, 0.48 }, { 0.85, 0.70 }, { 1.00, 1.45 } },
	cone = { { 0.00, 0.30 }, { 0.20, 0.40 }, { 0.45, 0.62 }, { 0.70, 0.88 }, { 0.88, 1.15 }, { 1.00, 1.75 } },
	stovepipe = { { 0.00, 0.92 }, { 0.15, 0.88 }, { 0.45, 0.86 }, { 0.75, 0.92 }, { 0.90, 1.05 }, { 1.00, 1.45 } },
	wedge = { { 0.00, 1.00 }, { 0.15, 1.05 }, { 0.45, 1.12 }, { 0.75, 1.25 }, { 0.90, 1.40 }, { 1.00, 1.75 } },
}

-- how much each family's centreline wanders (share of R per unit height) and its surface roughness
ProfileLibrary.CHARACTER = {
	rope = { bend = 1.0, rough = 0.18, wisps = 0.6 },
	cone = { bend = 0.25, rough = 0.09, wisps = 0.35 },
	stovepipe = { bend = 0.15, rough = 0.07, wisps = 0.25 },
	wedge = { bend = 0.08, rough = 0.12, wisps = 0.5 },
}

-- monotone cubic (Fritsch-Carlson) through a profile's points: no overshoot, no kinks
local cache = {}
local function tangents(pts: { { number } }): { number }
	local c = cache[pts]
	if c then
		return c
	end
	local n = #pts
	local d, m = {}, {}
	for i = 1, n - 1 do
		d[i] = (pts[i + 1][2] - pts[i][2]) / (pts[i + 1][1] - pts[i][1])
	end
	m[1], m[n] = d[1], d[n - 1]
	for i = 2, n - 1 do
		if d[i - 1] * d[i] <= 0 then
			m[i] = 0
		else
			m[i] = 2 / (1 / d[i - 1] + 1 / d[i])
		end
	end
	cache[pts] = m
	return m
end

function ProfileLibrary.eval(pts: { { number } }, h: number): number
	h = math.clamp(h, 0, 1)
	local n = #pts
	local i = 1
	while i < n - 1 and pts[i + 1][1] < h do
		i += 1
	end
	local m = tangents(pts)
	local x0, x1 = pts[i][1], pts[i + 1][1]
	local y0, y1 = pts[i][2], pts[i + 1][2]
	local w = x1 - x0
	local t = (h - x0) / w
	local t2, t3 = t * t, t * t * t
	return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * w * m[i] + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * w * m[i + 1]
end

function ProfileLibrary.radius(weights: { [string]: number }, h: number): number
	local r, wsum = 0, 0
	for name, w in weights do
		if w > 0.001 then
			r += w * ProfileLibrary.eval(ProfileLibrary.PROFILES[name], h)
			wsum += w
		end
	end
	return if wsum > 0 then r / wsum else ProfileLibrary.eval(ProfileLibrary.PROFILES.cone, h)
end

function ProfileLibrary.character(weights: { [string]: number }, key: string): number
	local v, wsum = 0, 0
	for name, w in weights do
		v += w * ProfileLibrary.CHARACTER[name][key]
		wsum += w
	end
	return if wsum > 0 then v / wsum else 0.1
end

local function ramp(x: number, a: number, b: number): number
	return math.clamp((x - a) / (b - a), 0, 1)
end

-- The families' weights from the tornado's own fields (not labels):
--   wedge      the visible width is a large share of the height (wide circulation, low base)
--   rope       a dissipating vortex (decay), or one stretched by tilt
--   stovepipe  a mid swirl ratio with a near-uniform condensed column
--   cone       the rest
function ProfileLibrary.weights(t: any, R: number): { [string]: number }
	local H = math.max(100, t.cloudBase or 800)
	local aspect = 2 * R / H
	local tilt = math.sqrt((t.topX or 0) ^ 2 + (t.topY or 0) ^ 2) / H
	local wedge = ramp(aspect, 0.35, 0.95)
	local rope = math.max(ramp(t.decay or 0, 0.1, 0.55), ramp(tilt, 0.6, 1.4)) * (1 - 0.7 * wedge)
	local S = t.swirl or 0.3
	local stove = ramp(S, 0.36, 0.5) * (1 - ramp(S, 0.75, 1.0)) * (1 - rope) * (1 - wedge) * ramp(aspect, 0.1, 0.25)
	local cone = math.max(0, 1 - wedge - rope - stove)
	return { rope = rope, cone = cone, stovepipe = stove, wedge = wedge }
end

return ProfileLibrary
