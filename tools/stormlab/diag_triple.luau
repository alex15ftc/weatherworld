-- Where the low-level circulation "should" sit by the fields, against where it sits now
-- (Storm.lowMesoAt, fixed bearing lowAngle). Score around C001 on the Supercell day:
--   baroclinity |grad D| (K/km: horizontal vorticity made along the outflow edge)
--   x updraft footprint exp(-(r/Ru)^2) (stretching)
--   x warm enough to be stretched (1 - ramp(D, 1.5, 5))
-- Prints the best point's bearing from motion (deg, CCW positive = left) and distance (Ru),
-- and a score map (0-9, U updraft, L current low meso, * best), up = motion.
local Json = require("../../roblox/src/stormlab/shared/Sim/Json")
local World = require("../../roblox/src/stormlab/shared/Sim/World")
local Storm = require("../../roblox/src/stormlab/shared/Sim/Storm")
local world = World.new(Json.decode(require("../../roblox/src/stormlab/data/Supercell")))
world:spinUp(600)
local function ramp(x, a, b) return math.clamp((x - a) / (b - a), 0, 1) end
for step = 1, 720 do
	world:step(5)
	if step % 120 == 0 then
		local s
		for _, st in world.storms do if st.id == "C001" then s = st end end
		if not s then break end
		local cp = world.coldPool
		local m = math.sqrt(s.u * s.u + s.v * s.v)
		local hx, hy = s.u / m, s.v / m
		local rx, ry = hy, -hx -- right of motion
		local Ru = s.Ru
		local best, ba, bb = -1, 0, 0
		local grid = {}
		local N = 10
		for jb = N, -N, -1 do -- along motion (rows)
			local row = {}
			for ia = -N, N do -- across (columns, right positive)
				local a, b = jb * 0.15 * Ru, ia * 0.15 * Ru
				local px, py = s.x + hx * a + rx * b, s.y + hy * a + ry * b
				local gx, gy = cp.D:gradient(px, py)
				local g = math.sqrt(gx * gx + gy * gy) * 1000
				local d = cp:deficitAt(px, py)
				local r = math.sqrt(a * a + b * b) / Ru
				local sc = g * math.exp(-r * r) * (1 - ramp(d, 1.5, 5))
				row[#row + 1] = sc
				if sc > best then best, ba, bb = sc, a, b end
			end
			grid[#grid + 1] = row
		end
		local lx, ly = Storm.lowMesoAt(s)
		local la = ((lx - s.x) * hx + (ly - s.y) * hy)
		local lb = ((lx - s.x) * rx + (ly - s.y) * ry)
		print(string.format("== t=%d min C001 W %.0f Ru %.0f m vlow %.1f occl %.2f | best: bearing %4.0f deg, %.2f Ru, score %.2f | now: bearing %4.0f deg, %.2f Ru",
			step * 5 // 60, s.W, Ru, s.vlow, s.occl, math.deg(math.atan2(-bb, ba)), math.sqrt(ba * ba + bb * bb) / Ru, best,
			math.deg(math.atan2(-lb, la)), math.sqrt(la * la + lb * lb) / Ru))
		for jr, row in grid do
			local line = ""
			for ic, sc in row do
				local a, b = (N + 1 - jr) * 0.15 * Ru, (ic - N - 1) * 0.15 * Ru
				local ch = tostring(math.clamp(math.floor(sc / math.max(best, 1e-6) * 9 + 0.5), 0, 9))
				if math.abs(a - ba) < 1 and math.abs(b - bb) < 1 then ch = "*"
				elseif math.abs(a) < 0.08 * Ru and math.abs(b) < 0.08 * Ru then ch = "U"
				elseif math.abs(a - la) < 0.08 * Ru and math.abs(b - lb) < 0.08 * Ru then ch = "L" end
				line ..= ch
			end
			print(line)
		end
	end
end
