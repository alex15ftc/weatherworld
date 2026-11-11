-- Physics checks of the lab's wind (docs/stormlab/PHYSICS-AUDIT-2026-11-03.md): whether the air the
-- storms are built from obeys the laws it should - mass conservation, smoothness, the observed
-- sizes and strengths of the circulations, the balances of a tornado and of the outflow, storm
-- motion. Runs a lab day, then measures every strong rotating storm and every tornado.
--   luau --codegen tools/stormlab/test_wind_physics.luau -a [minutes] [Supercell|SquallLine]
-- Each line PASS/FAIL with the measured value; ends with the count. Targets are from observations
-- and theory (sources at each check), not from the sim's own numbers.
local Json = require("../../roblox/Shared/StormLab/Sim/Json")
local World = require("../../roblox/Shared/StormLab/Sim/World")
local Storm = require("../../roblox/Shared/StormLab/Sim/Storm")
local Vortex = require("../../roblox/Shared/StormLab/Sim/Vortex")
local ColdPool = require("../../roblox/Shared/StormLab/Sim/ColdPool")
local Thermo = require("../../roblox/Shared/StormLab/Sim/Thermo")

local args = { ... }
-- (args[3] "depth": ColdPool.DEPTH_MEAN, the pool's wind set against the depth-mean air)
if args[3] == "depth" then
	ColdPool.DEPTH_MEAN = true
end
local minutes = tonumber(args[1]) or 40
local day = args[2] or "Supercell"
local sqrt, exp, abs, max, min, pi = math.sqrt, math.exp, math.abs, math.max, math.min, math.pi

local fails, total = 0, 0
local function check(name: string, ok: boolean, detail: string)
	total += 1
	if not ok then
		fails += 1
	end
	print(string.format("  %s  %-50s %s", if ok then "PASS" else "FAIL", name, detail))
end

local data = Json.decode(require("../../roblox/Shared/StormLab/Data/" .. day))
local world = World.new(data)
world:spinUp(600)
for _ = 1, minutes do
	for _ = 1, 60 do
		world:step(1)
	end
end

-- the base-state density (anelastic: a scale height of ~8.5 km)
local HRHO = 8500
local function rho(z: number): number
	return 1.2 * exp(-z / HRHO)
end
-- the storms' air (the tornado measured on its own below)
local function wind(x: number, y: number, z: number): (number, number, number)
	return world:windAt(x, y, z, true)
end

local storms = {}
for _, s in world.storms do
	if not s.dead and (s.rot or 0) > 0.5 and s.W > 20 then
		table.insert(storms, s)
	end
end
table.sort(storms, function(a, b)
	return a.W > b.W
end)
print(string.format("%s day, %d min: %d strong rotating storms, %d tornadoes", day, minutes, #storms, #world.tornadoes))

for si = 1, min(#storms, 3) do
	local s = storms[si]
	Storm.prepare(s)
	local R = s.Ru
	print(string.format("\n%s  W %.0f m/s  Ru %.0f m  base %.0f m  top %.0f m  vlow %.1f  vmid %.1f  occl %.2f  motion %.1f %.1f", tostring(s.id), s.W, R, s.base, s.top, s.vlow, s.vmid, s.occl, s.u, s.v))

	-- 1. Mass conservation, anelastic: div(rho u) / rho = du/dx + dv/dy + dw/dz - w / H ~ 0. The
	-- storm's own scale for it is W / Ru (an updraft W m/s over Ru m). (Ogura & Phillips 1962)
	do
		-- (a 2 m step: the cold pool's wind is bilinear on its 2 km grid, its slope steps at the
		-- cell lines, and a wider difference straddling one reads that step as divergence)
		local h = 2
		local vals, worst, wx, wy, wz = {}, 0, 0, 0, 0
		local levels = { 100, 400, s.base - 150, s.base + 150, 2500, 4000, 6000, 8000, 10000, 0.8 * s.top }
		for i = -6, 6 do
			for j = -6, 6 do
				local x, y = s.x + i * R / 3, s.y + j * R / 3
				for _, z in levels do
					if z > h then
						local ux1 = wind(x + h, y, z)
						local ux0 = wind(x - h, y, z)
						local _, vy1 = wind(x, y + h, z)
						local _, vy0 = wind(x, y - h, z)
						local _, _, wz1 = wind(x, y, z + h)
						local _, _, wz0 = wind(x, y, z - h)
						local _, _, w = wind(x, y, z)
						local D = (ux1 - ux0 + vy1 - vy0 + wz1 - wz0) / (2 * h) - w / HRHO
						local q = abs(D) / (s.W / R)
						table.insert(vals, q)
						if q > worst then
							worst, wx, wy, wz = q, x - s.x, y - s.y, z
						end
					end
				end
			end
		end
		table.sort(vals)
		local p95 = vals[math.floor(0.95 * #vals)]
		check("mass: divergence p95 < 0.1 W/Ru", p95 < 0.1, string.format("p95 %.2f  (worst %.2f at %.1f, %.1f Ru, z %.0f m)", p95, worst, wx / R, wy / R, wz))
		check("mass: divergence max < 0.3 W/Ru", worst < 0.3, string.format("max %.2f", worst))
	end

	-- 2. The air budget of a cylinder 3 Ru round the storm: what flows in through its side up to
	-- height z must equal what rises through height z (mass continuity integrated). Also the base
	-- inflow against the updraft at the base, and what leaves under the anvil against the peak.
	do
		local Rc = 3 * R
		local N = 72
		local dA = (R / 4) ^ 2
		local function upFlux(z: number): number
			local m = 0
			for i = -12, 12 do
				for j = -12, 12 do
					local dx, dy = i * R / 4, j * R / 4
					if dx * dx + dy * dy <= Rc * Rc then
						local _, _, w = wind(s.x + dx, s.y + dy, z)
						m += rho(z) * w * dA
					end
				end
			end
			return m
		end
		local function sideIn(z: number): number -- kg/s per m of height
			local m = 0
			for k = 0, N - 1 do
				local a = 2 * pi * k / N
				local cx, cy = math.cos(a), math.sin(a)
				local u, v = wind(s.x + Rc * cx, s.y + Rc * cy, z)
				m -= rho(z) * (u * cx + v * cy) * (2 * pi * Rc / N)
			end
			return m
		end
		local dz = 500
		local acc, worst, peak = 0, 0, 0
		local inBelow, outAbove = 0, 0
		local mBase = upFlux(s.base)
		local zt = s.top + 1000
		local z = 0
		while z < zt do
			local zm = z + 0.5 * dz
			local L = sideIn(zm) * dz
			acc += L
			if zm < s.base then
				inBelow += L
			end
			if zm > 0.6 * s.top and L < 0 then
				outAbove -= L
			end
			local M = upFlux(z + dz)
			peak = max(peak, abs(M))
			worst = max(worst, abs(M - acc))
			z += dz
		end
		check("mass: cylinder budget residual < 15% of peak flux", worst < 0.15 * peak, string.format("residual %.0f%% of %.2e kg/s", 100 * worst / max(peak, 1), peak))
		check("mass: inflow below base = updraft at base (+-20%)", abs(inBelow - mBase) < 0.2 * abs(mBase), string.format("in %.2e  up %.2e kg/s", inBelow, mBase))
		check("mass: anvil outflow = peak updraft flux (+-20%)", abs(outAbove - peak) < 0.2 * peak, string.format("out %.2e  peak %.2e kg/s", outAbove, peak))
	end

	-- 3. No jumps: the air on either side of the pieces' edges (1 m apart) differs by < 0.5 m/s
	do
		local function jump(x0, y0, z0, x1, y1, z1)
			local a, b, c = wind(x0, y0, z0)
			local d, e, f = wind(x1, y1, z1)
			return sqrt((a - d) ^ 2 + (b - e) ^ 2 + (c - f) ^ 2)
		end
		local jb = 0
		for k = 0, 7 do
			local a = 2 * pi * k / 8
			local x, y = s.x + 0.3 * R * math.cos(a), s.y + 0.3 * R * math.sin(a)
			jb = max(jb, jump(x, y, s.base - 0.5, x, y, s.base + 0.5))
		end
		check("smooth: across the cloud base < 0.5 m/s", jb < 0.5, string.format("%.2f m/s", jb))
		local jr = 0
		local reach = s.cReach or (4.5 * R + 5000)
		for k = 0, 15 do
			local a = 2 * pi * k / 16
			local cx, cy = math.cos(a), math.sin(a)
			for _, z in { 500, 3000, 10000 } do
				jr = max(jr, jump(s.x + (reach - 0.5) * cx, s.y + (reach - 0.5) * cy, z, s.x + (reach + 0.5) * cx, s.y + (reach + 0.5) * cy, z))
			end
		end
		check("smooth: across the storm's reach < 0.5 m/s", jr < 0.5, string.format("%.2f m/s", jr))
	end

	-- 4. The mesocyclone: storm-relative rotation round its centre at 5 km (and 1 km, shown).
	-- Observed: rotational velocity 10-35 m/s, core diameter 2-10 km (Stumpf et al. 1998; Trapp
	-- 2005); the updraft and the vertical vorticity correlated (> 0.5) at mid levels
	-- (Droegemeier et al. 1993).
	do
		local function rotation(cx: number, cy: number, z: number): (number, number)
			local best, bestR = 0, 0
			local sign = if s.leftMover then -1 else 1
			for r = 250, 8000, 250 do
				local vt = 0
				for k = 0, 15 do
					local a = 2 * pi * k / 16
					local ca, sa = math.cos(a), math.sin(a)
					local u, v = wind(cx + r * ca, cy + r * sa, z)
					vt += ((u - s.u) * -sa + (v - s.v) * ca) * sign
				end
				vt /= 16
				if vt > best then
					best, bestR = vt, r
				end
			end
			return best, bestR
		end
		local mx, my = Storm.midMesoAt(s, 5000)
		local v5, r5 = rotation(mx, my, 5000)
		local lx, ly = Storm.lowMesoAt(s)
		local v1, r1 = rotation(lx, ly, 1000)
		check("meso: rotation at 5 km 10-35 m/s", v5 >= 10 and v5 <= 35, string.format("%.1f m/s (1 km: %.1f m/s)", v5, v1))
		check("meso: core diameter at 5 km 2-10 km", 2 * r5 >= 2000 and 2 * r5 <= 10000, string.format("%.1f km (1 km: %.1f km)", 2 * r5 / 1000, 2 * r1 / 1000))
		-- w-zeta correlation at 4 km
		local h = 50
		local ws, zs = {}, {}
		local _, tx, ty = 0, 0, 0
		for i = -9, 9 do
			for j = -9, 9 do
				local x, y = mx + i * R / 6, my + j * R / 6
				local _, v1x = wind(x + h, y, 4000)
				local _, v0x = wind(x - h, y, 4000)
				local u1y = wind(x, y + h, 4000)
				local u0y = wind(x, y - h, 4000)
				local _, _, w = wind(x, y, 4000)
				table.insert(ws, w)
				table.insert(zs, ((v1x - v0x) - (u1y - u0y)) / (2 * h) * (if s.leftMover then -1 else 1))
			end
		end
		local n = #ws
		local mw, mz = 0, 0
		for k = 1, n do
			mw += ws[k]
			mz += zs[k]
		end
		mw /= n
		mz /= n
		local cov, vw, vz = 0, 0, 0
		for k = 1, n do
			cov += (ws[k] - mw) * (zs[k] - mz)
			vw += (ws[k] - mw) ^ 2
			vz += (zs[k] - mz) ^ 2
		end
		local corr = cov / sqrt(max(vw * vz, 1e-12))
		check("meso: updraft-vorticity correlation at 4 km > 0.5", corr > 0.5, string.format("r = %.2f", corr))
	end

	-- 5. One wind for the outflow: the cold air at the pool's head moves the way the pool itself
	-- moves (ColdPool.step's spreading velocity AU, AV - which runs its head at the density-current
	-- speed c = 0.75 sqrt(g h dT/T), Benjamin 1968), so the wind that carries rain, dust and cards
	-- and the pool's own motion agree. The pool moves as one slab (at the 0-1 km wind plus its
	-- spreading), so the comparison is the wind averaged over the pool's depth (the environment's
	-- shear makes any one height differ). Median of (depth-mean wind . n) / (pool motion . n)
	-- across the head (n outward). Well above 1 means the outflow is counted twice.
	-- (Not at the downdraft cores: there the sinking air feeds an outflow faster than the front, as
	-- in a downburst.)
	do
		local ratios = {}
		local cp = world.coldPool
		for i = -16, 16 do
			for j = -16, 16 do
				local x, y = s.x + i * R / 4, s.y + j * R / 4
				if cp.EDGE:sample(x, y) > 0.3 and cp.AU then
					local _, gx, gy = cp.D:sampleGrad(x, y)
					local gm = sqrt(gx * gx + gy * gy)
					if gm > 1e-7 then
						local nx, ny = -gx / gm, -gy / gm
						local an = cp.AU:sample(x, y) * nx + cp.AV:sample(x, y) * ny
						if an > 2 then
							local _, _, h = cp:deficitAt(x, y)
							h = max(h, ColdPool.depthOf(1))
							local un = 0
							for kz = 1, 5 do
								local u, v = wind(x, y, (kz - 0.5) / 5 * h)
								un += (u * nx + v * ny) / 5
							end
							table.insert(ratios, un / an)
						end
					end
				end
			end
		end
		table.sort(ratios)
		local med = if #ratios > 0 then ratios[math.floor(0.5 * #ratios) + 1] else 0
		check("outflow: head wind moves with the pool (0.75-1.25)", #ratios > 0 and med >= 0.75 and med <= 1.25, string.format("median %.2f (%d head points)", med, #ratios))
	end

	-- 6. Storm motion: a right mover close to Bunkers' estimate (the 0-6 km mean wind + 7.5 m/s
	-- to the right of the 0-6 km shear; Bunkers et al. 2000: mean error ~4-5 m/s)
	do
		local prof = s.prof
		if prof then
			local mu, mv, n = 0, 0, 0
			for z = 0, 6000, 250 do
				local u, v = Thermo.windAt(prof, z)
				mu += u
				mv += v
				n += 1
			end
			mu /= n
			mv /= n
			local function layer(z0, z1)
				local a, b, k = 0, 0, 0
				for z = z0, z1, 100 do
					local u, v = Thermo.windAt(prof, z)
					a += u
					b += v
					k += 1
				end
				return a / k, b / k
			end
			local u0, v0 = layer(0, 500)
			local u6, v6 = layer(5500, 6000)
			local sx, sy = u6 - u0, v6 - v0
			local sm = max(sqrt(sx * sx + sy * sy), 1e-3)
			local side = if s.leftMover then -1 else 1
			local bu, bv = mu + side * 7.5 * sy / sm, mv - side * 7.5 * sx / sm
			local e = sqrt((s.u - bu) ^ 2 + (s.v - bv) ^ 2)
			check("motion: within 5 m/s of Bunkers", e < 5, string.format("%.1f m/s off (storm %.1f %.1f, Bunkers %.1f %.1f)", e, s.u, s.v, bu, bv))
		end
	end
end

-- 7. Tornadoes: cyclostrophic balance (the pressure deficit its own wind needs: dp/dr = rho v^2/r)
-- and its mass flux against its parent's updraft
for _, t in world.tornadoes do
	if not t.ended and t.params then
		local p = t.params
		print(string.format("\ntornado of %s  vc %.0f m/s  rc %.0f m  cloud base %.0f m", tostring(t.parentId), t.vc or 0, t.rc or 0, t.cloudBase or 0))
		-- (at 150 m: above the corner flow, whose swirl near the ground runs faster than vc - the
		-- model impresses the swirl above it down to the ground)
		local z = math.min(150, 0.5 * (t.cloudBase or 500))
		local ax, ay = Vortex.axisAt(p, z)
		-- (about the vortex the wind is drawn round - its params - not the live track point, which
		-- moves between their refreshes: an off-centre ring read C001 6.6% short, 2026-11-04)
		local cx, cy = (p.x or t.x) + ax, (p.y or t.y) + ay
		local dr = max(2, (t.rc or 50) / 25)
		local dp = 0
		-- (from the eye wall out: a two-cell tornado's eye is calm, its pressure flat - Vortex.deficit)
		local r0 = Vortex.hollowR(p) * (t.rc or 50)
		local r = r0 + dr / 2
		-- (without the corner flow's jet: its extra swirl near the ground is supergradient - the
		-- pressure there is the one imposed from above, which is why the model leaves it out - and
		-- at the model's own air density. With both, the check was 5-12% off on every tornado,
		-- 2026-11-04: ~3% the jet's tail at 150 m, 4.3% density 1.2 against 1.15)
		local jet0 = p.jet
		p.jet = 0
		-- (and the mean flow only: balance holds for the azimuthal mean, and one 32-point ring snapshot
		-- of the turbulence eddies left a strong tornado's mean swirl ~3% low, 6% in pressure, 2026-11-04)
		local turb0 = p.turbulence
		p.turbulence = 0
		while r < 40 * (t.rc or 50) do
			local vt = 0
			for k = 0, 31 do
				local a = 2 * pi * k / 32
				local ca, sa = math.cos(a), math.sin(a)
				local u, v = Vortex.sample(p, cx + r * ca, cy + r * sa, z)
				vt += -u * sa + v * ca
			end
			vt /= 32
			dp += Vortex.RHO * vt * vt / r * dr
			r += dr
		end
		p.jet = jet0
		p.turbulence = turb0
		local model = Vortex.deficit(t, r0, z)
		check("tornado: cyclostrophic deficit matches its wind (5%)", abs(dp - model) < 0.05 * model + 50, string.format("wind needs %.0f hPa, model %.0f hPa", dp / 100, model / 100))
		-- (within what the strongest measured winds allow: mobile radar has seen ~135 m/s ground-relative
		-- in the most violent tornadoes, Bridge Creek 1999 and El Reno 2013 (Wurman et al.), i.e. a core
		-- swirl up to ~110 m/s - a deficit up to 2.06 rho vc^2 ~ 300 hPa with this profile. In-situ
		-- probes have measured ~100 hPa (Manchester SD 2003), but they rarely hit the core.)
		check("tornado: within the strongest observed (vc <= 110 m/s)", (t.vc or 0) <= 110 and model <= 30000, string.format("vc %.0f m/s, %.0f hPa", t.vc or 0, model / 100))
		-- mass: its rising core at half its cloud base against its parent's updraft at 1 km
		local zm = 0.5 * max(t.cloudBase or 500, 200)
		local mt = 0
		local rr = dr / 2
		while rr < 3 * (t.rc or 50) do
			local wsum = 0
			for k = 0, 15 do
				local a = 2 * pi * k / 16
				local _, _, w = Vortex.sample(p, cx + rr * math.cos(a), cy + rr * math.sin(a), zm)
				wsum += w
			end
			mt += rho(zm) * (wsum / 16) * 2 * pi * rr * dr
			rr += dr
		end
		local parent
		for _, s in world.storms do
			if tostring(s.id) == tostring(t.parentId) then
				parent = s
			end
		end
		if parent then
			local mp = 0
			local R = parent.Ru
			for i = -10, 10 do
				for j = -10, 10 do
					local dx, dy = i * R / 5, j * R / 5
					if dx * dx + dy * dy <= (2 * R) ^ 2 then
						local _, _, w = wind(parent.x + dx, parent.y + dy, 1000)
						if w > 0 then
							mp += rho(1000) * w * (R / 5) ^ 2
						end
					end
				end
			end
			check("tornado: core flux <= parent updraft flux at 1 km", mt <= mp, string.format("%.2e vs %.2e kg/s", mt, mp))
		end
	end
end

print(string.format("\n%d of %d checks passed", total - fails, total))
