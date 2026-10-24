-- Offline checks of the lab's tornado wind field.  luau tools/stormlab/test_vortex.luau
local Vortex = require("../../roblox/src/stormlab/shared/Sim/Vortex")
local fails = 0
local function check(name, ok, detail)
	print(string.format("%s  %-44s %s", ok and "PASS" or "FAIL", name, detail))
	if not ok then fails += 1 end
end
local function state(vc, rc, S)
	return { x = 0, y = 0, ut = 15, vt = 5, envU = 8, envV = 6, vc = vc, rc = rc, swirl = S, inflow = 0.55,
		cloudBase = 900, topX = 150, topY = 60, bendX = 30, bendY = -20, wave = 0, seed = 7, time = 12.3 }
end
check("profile peaks at R=1", math.abs(Vortex.profile(1) - 1) < 1e-9, string.format("%.4f", Vortex.profile(1)))
check("central deficit ~2.06 rho vc^2", math.abs(Vortex.CENTRAL_DEFICIT - 2.06) < 0.1, string.format("%.3f", Vortex.CENTRAL_DEFICIT))
-- divergence of the vortex-relative field (no turbulence: the speed check makes noise; measure with S low, translation 0)
local s = state(60, 100, 0.5); s.ut, s.vt, s.envU, s.envV = 0, 0, 0, 0; s.turbulence = 0; s.cloudBase = 1e7; s.topX, s.topY, s.bendX, s.bendY = 0, 0, 0, 0
local p = Vortex.params(s)
local pReal = Vortex.params(state(60, 100, 0.5))
local maxDiv, maxScale = 0, 0
local h = 0.5
-- turn turbulence off for this check by sampling a copy whose noise amplitude is removed: use small seed trick not possible; estimate on a calm field instead
for _, r in { 50, 100, 150, 250 } do
	for _, z in { 5, 15, 40, 120 } do
		local x, y = r, 0
		local ax, ay = Vortex.axisAt(p, z)
		x += ax; y += ay
		local u1 = Vortex.sample(p, x + h, y, z); local u0 = Vortex.sample(p, x - h, y, z)
		local _, v1 = Vortex.sample(p, x, y + h, z); local _, v0 = Vortex.sample(p, x, y - h, z)
		local _, _, w1 = Vortex.sample(p, x, y, z + h); local _, _, w0 = Vortex.sample(p, x, y, z - h)
		local div = (u1 - u0 + v1 - v0 + w1 - w0) / (2 * h)
		maxDiv = math.max(maxDiv, math.abs(div)); maxScale = math.max(maxScale, 60 / 100)
	end
end
check("mass conserved (straight, no turbulence)", maxDiv < 0.02, string.format("max |div| %.4f /s vs vc/rc %.2f", maxDiv, maxScale))
p = pReal
-- peak and inflow
local best, bestR = 0, 0
for r = 10, 400, 5 do
	local ax, ay = Vortex.axisAt(p, 10)
	local u, v = Vortex.sample(p, r + ax, ay, 10)
	local sp = math.sqrt(u * u + v * v)
	if sp > best then best, bestR = sp, r end
end
check("peak near rc at 10 m", bestR > 60 and bestR < 160, string.format("%.0f m/s at %d m", best, bestR))
local ax, ay = Vortex.axisAt(p, p.h)
local ur = Vortex.sample(p, 100 + ax, ay, p.h)
check("inflow at (rc, h) is inward", ur < -10, string.format("ur %.1f m/s", ur))
local _, _, wAx = Vortex.sample(p, ax, ay, 300)
print(string.format("      axis w at 300 m, S=0.5: %.1f m/s", wAx))
local p1 = Vortex.params(state(60, 100, 0.1))
local a1x, a1y = Vortex.axisAt(p1, 300)
local _, _, w1 = Vortex.sample(p1, a1x, a1y, 300)
check("one-celled S=0.1 rises on axis", w1 > 10, string.format("w %.1f", w1))
local p2 = Vortex.params(state(60, 100, 1.0))
local a2x, a2y = Vortex.axisAt(p2, 300)
local _, _, w2 = Vortex.sample(p2, a2x, a2y, 300)
check("two-celled S=1.0 sinks on axis", w2 < 0, string.format("w %.1f, subvortices %.1f", w2, p2.subCount))
-- condensation radius
for _, z in { 0, 100, 400, 800 } do
	print(string.format("      funnel radius at %d m: %.0f m (rc %.0f)", z, Vortex.condensationRadius(p, z), Vortex.rcAt(p, z)))
end
local weak = state(25, 100, 0.3)
check("weak vortex: funnel off the ground", Vortex.condensationRadius(weak, 2) == 0, string.format("%.0f m at ground", Vortex.condensationRadius(weak, 2)))
-- rating
local pk = Vortex.peakWind(p)
print(string.format("      peak ground-relative 10 m: %.0f m/s -> EF%d", pk, Vortex.efOf(pk)))
-- cost
local t0 = os.clock()
local n = 0
for i = 1, 20000 do
	local u = Vortex.sample(p2, (i % 200) * 3, (i % 37) * 5, (i % 50) * 4)
	n += u
end
print(string.format("      cost %.2f us/sample (S=1, 6 sub-vortices max)", (os.clock() - t0) / 20000 * 1e6))
print(fails == 0 and "all passed" or (fails .. " failed"))
