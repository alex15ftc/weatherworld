--!strict
-- Funnel shape presets and blending.
--
-- A preset is the funnel's radius up its height, as a multiple of its radius at the ground:
-- a list of { t, r } with t = 0 at the ground and 1 at the cloud base. A tornado's shape is a
-- weighted blend of presets ({ cone = 0.7, wedge = 0.3 }), so shapes can morph over its life.
local Shape = {}

Shape.PRESETS = {
	-- thin, nearly even, flaring only where it meets the cloud
	rope = { { 0, 1 }, { 0.3, 1.05 }, { 0.6, 1.15 }, { 0.85, 1.6 }, { 1, 3.2 } },
	-- widening slowly from the ground, then flaring into the cloud (docs/tornado-reference/ref1)
	cone = { { 0, 1 }, { 0.3, 1.35 }, { 0.55, 1.8 }, { 0.75, 2.3 }, { 0.9, 2.9 }, { 1, 3.4 } },
	-- a real cone (docs/tornado-reference/real/01_cone_a, 01_cone_b, 07_funnel_b): a concave horn,
	-- narrow at the ground and widening ever faster, ~8x where it meets the cloud
	horn = { { 0, 1 }, { 0.2, 1.35 }, { 0.4, 1.9 }, { 0.6, 2.8 }, { 0.8, 4.3 }, { 0.92, 6 }, { 1, 8 } },
	-- a column, much the same width all the way up
	stovepipe = { { 0, 1 }, { 0.4, 1.04 }, { 0.75, 1.12 }, { 0.92, 1.35 }, { 1, 1.8 } },
	-- a broad V: very wide at the ground and wider still where it merges into the base
	wedge = { { 0, 1 }, { 0.25, 1.15 }, { 0.5, 1.4 }, { 0.75, 1.8 }, { 0.9, 2.2 }, { 1, 2.6 } },
}

local function sample(points: { { number } }, t: number): number
	local n = #points
	if t <= points[1][1] then
		return points[1][2]
	end
	if t >= points[n][1] then
		return points[n][2]
	end
	local i = 1
	while points[i + 1][1] < t do
		i += 1
	end
	-- cubic Hermite with finite-difference slopes (smooth through the points)
	local t0, r0 = points[i][1], points[i][2]
	local t1, r1 = points[i + 1][1], points[i + 1][2]
	local function slope(k: number): number
		local a = points[math.max(k - 1, 1)]
		local b = points[math.min(k + 1, n)]
		return (b[2] - a[2]) / (b[1] - a[1])
	end
	local h = t1 - t0
	local s = (t - t0) / h
	local m0, m1 = slope(i) * h, slope(i + 1) * h
	local s2, s3 = s * s, s * s * s
	return (2 * s3 - 3 * s2 + 1) * r0 + (s3 - 2 * s2 + s) * m0 + (-2 * s3 + 3 * s2) * r1 + (s3 - s2) * m1
end

-- Radius multiple at height share t for a blend of presets (weights need not sum to 1).
function Shape.radius(weights: { [string]: number }, t: number): number
	local sum, total = 0, 0
	for name, w in weights do
		local points = Shape.PRESETS[name]
		if points and w > 0 then
			sum += w * sample(points, t)
			total += w
		end
	end
	if total <= 0 then
		return sample(Shape.PRESETS.cone, t)
	end
	return sum / total
end

-- Blend two weight sets: a at alpha 0, b at 1.
function Shape.blend(a: { [string]: number }, b: { [string]: number }, alpha: number): { [string]: number }
	local out = {}
	for name in Shape.PRESETS do
		local wa, wb = a[name] or 0, b[name] or 0
		local w = wa + (wb - wa) * alpha
		if w > 0 then
			out[name] = w
		end
	end
	return out
end

return Shape
