-- Offline checks of the tornado wind field and wind physics (no Roblox needed):
--   luau tools/windfield/test.luau
-- Prints each check with PASS/FAIL and the numbers behind it.
local WF = require("../../roblox/src/shared/Tornado/WindField")
local WP = require("../../roblox/src/shared/Tornado/WindPhysics")

local fails = 0
local function check(name: string, ok: boolean, detail: string)
	print(string.format("%s  %-48s %s", if ok then "PASS" else "FAIL", name, detail))
	if not ok then
		fails += 1
	end
end

local EF = { 33.5, 43.8, 55.0, 67.0, 81.8, 98.3 }
local SWIRL = { 0.2, 0.3, 0.5, 0.7, 0.9, 1.1 }
local JET = { 0.15, 0.15, 0.2, 0.2, 0.25, 0.25 }
local INFLOW = { 0.6, 0.6, 0.55, 0.5, 0.5, 0.45 }
local RC = { 30, 45, 70, 100, 150, 200 }
local function ramp(x, a, b)
	return math.clamp((x - a) / (b - a), 0, 1)
end

-- Mirrors Vortex.params (Config.wind defaults) for EF level e (0-5), moving at speed move (+x).
local function params(e: number, move: number, turb: number?): any
	local S = SWIRL[e + 1]
	local subShare = ramp(S, 0.9, 1.1)
	local p = {
		vc = 1, rc = RC[e + 1], alpha = 0.6, eta = 0.5, z0 = 3, zj = 30,
		jet = JET[e + 1] * (1 + 0.5 * (1 - ramp(S, 0.2, 0.8))), top = 600, widen = 0.3,
		inflow = INFLOW[e + 1], depth = 0.15, twoCell = 1.2 * ramp(S, 0.3, 0.8), cellWidth = 0.6,
		subCount = if subShare > 0 then math.clamp(2 + 3 * (S - 1), 2, 6) else 0, subShare = subShare,
		subRadius = 0.1, subSpeed = 0.4, subOrbit = 1, subRate = 0.7, subDecay = 150,
		turb = turb or 0, turbScale = 0.5, pulseAmp = 0, pulsePeriod = 40, taperIn = 8, taperOut = 15,
		moveX = move, moveZ = 0, ambientX = move, ambientZ = 0, blend = 5, seed = 7,
	}
	local target = EF[e + 1] * (1 - 0.1 * subShare)
	WF.calibrate(p, target, 10)
	return p
end

-- 1. Profile: peak 1 at R = 1
do
	local best, at = 0, 0
	for i = 1, 4000 do
		local R = i / 1000
		local f = WF.profile(R, 0.6, 0.5)
		if f > best then
			best, at = f, R
		end
	end
	check("profile peak at R=1, value 1", math.abs(best - 1) < 1e-3 and math.abs(at - 1) < 0.01, string.format("peak %.4f at R=%.3f", best, at))
	local tail = WF.profile(100, 0.6, 0.5) * 100 ^ 0.6
	check("outer decay ~ R^-0.6", tail > 1 and tail < 1.6, string.format("f(100)*100^0.6 = %.3f", tail))
end

-- 2. Continuity of the inflow/updraught: (1/r) d(r u)/dr + dw/dz = 0
for _, d in { 0, 1.2 } do
	local p = params(3, 0)
	p.twoCell = d
	local worst, scale = 0, 0
	for _, r in { 10, 40, 80, 100, 150, 300 } do
		for _, z in { 2, 10, 15, 30, 80 } do
			local e = 0.01
			local u1 = WF.secondary(p, r + e, z)
			local u0 = WF.secondary(p, r - e, z)
			local _, w1 = WF.secondary(p, r, z + e)
			local _, w0 = WF.secondary(p, r, z - e)
			local div = ((r + e) * u1 - (r - e) * u0) / (2 * e * r) + (w1 - w0) / (2 * e)
			worst = math.max(worst, math.abs(div))
			scale = math.max(scale, math.abs(u1) / r)
		end
	end
	check(string.format("mass conserved (twoCell %.1f)", d), worst < 1e-3 * scale + 1e-6, string.format("max |div| %.2e (scale %.2e)", worst, scale))
end

-- 3. One-celled peak inflow is -Um at (rc, h)
do
	local p = params(3, 0)
	p.twoCell = 0
	local u = WF.secondary(p, p.rc, 0.15 * p.rc)
	local Um = p.inflow * p.vc
	check("peak inflow -Um at (rc, h)", math.abs(u + Um) < 1e-6 * Um + 1e-9, string.format("u %.2f, Um %.2f", u, Um))
	local _, w = WF.secondary(p, 0, 400)
	print(string.format("      one-celled axis updraught aloft: %.1f m/s (%.2f x vc)", w, w / p.vc))
end

-- 4. Two-celled: downdraught on the axis, updraught ring
do
	local p = params(4, 0)
	local _, wAxis = WF.secondary(p, 0, 300)
	local best, at = -math.huge, 0
	for i = 0, 200 do
		local r = i / 100 * p.rc
		local _, w = WF.secondary(p, r, 300)
		if w > best then
			best, at = w, r
		end
	end
	check("two-celled: axis downdraught, ring updraught", wAxis < 0 and at > 0.5 * p.rc and at < 0.85 * p.rc,
		string.format("d=%.2f axis w %.1f, ring peak %.1f m/s at %.2f rc", p.twoCell, wAxis, best, at / p.rc))
end

-- 5. Ratings: peak ground-relative wind at 10 m (right of the track) equals the EF centre
print("      EF  vc    rc   S    peak@10m  target  left-side  max@any-height (z)")
for e = 0, 5 do
	local move = 13
	local p = params(e, move)
	local peak, left = 0, 0
	for i = 0, 400 do
		local r = (0.5 + i / 400) * p.rc
		-- moving +x; anticlockwise spin: at outward (0,0,+1) the tangent is (+1,0,0), with the
		-- motion, so +z is the strong (right-hand) side
		local wx, _, wz = WF.at(p, 0, 10, r, 0)
		peak = math.max(peak, math.sqrt(wx * wx + wz * wz))
		local lx, _, lz = WF.at(p, 0, 10, -r, 0)
		left = math.max(left, math.sqrt(lx * lx + lz * lz))
	end
	local best, bz = 0, 0
	for z = 1, 200 do
		local wx, _, wz = WF.at(p, 0, z, p.rc, 0)
		local s = math.sqrt(wx * wx + wz * wz)
		if s > best then
			best, bz = s, z
		end
	end
	local target = EF[e + 1] * (1 - 0.1 * p.subShare)
	print(string.format("      %d  %5.1f %4d  %.1f  %6.1f   %6.1f   %6.1f     %6.1f (%d m)", e, p.vc, p.rc, SWIRL[e + 1], peak, target, left, best, bz))
	check(string.format("EF%d peak at 10 m = target", e), math.abs(peak - target) < 0.03 * target, "")
end

-- 6. Sub-vortices: an EF5 (S 1.1) has them, and they add short peaks
do
	local p = params(5, 13)
	local q = table.clone(p)
	q.subCount = 0
	local base, peak = 0, 0
	for t = 0, 60, 0.5 do
		for a = 0, 63 do
			local th = a / 64 * 2 * math.pi
			for _, rr in { 0.9, 1.0, 1.1 } do
				local x, z = math.cos(th) * rr * p.rc, math.sin(th) * rr * p.rc
				local wx, _, wz = WF.at(p, x, 10, z, t)
				peak = math.max(peak, math.sqrt(wx * wx + wz * wz))
				if t == 0 then
					local bx, _, bz = WF.at(q, x, 10, z, t)
					base = math.max(base, math.sqrt(bx * bx + bz * bz))
				end
			end
		end
	end
	check("EF5 sub-vortices add short peaks", peak > base * 1.1, string.format("count %.1f, peak without %.1f, with %.1f m/s", p.subCount, base, peak))
end

-- 7. Turbulence: rms ~ 20% of the local wind
do
	local p = params(3, 0, 0.2)
	local q = params(3, 0, 0)
	local sum, n = 0, 0
	for i = 1, 3000 do
		local r = (0.3 + 3 * ((i * 0.618034) % 1)) * p.rc
		local th = (i * 0.414214 % 1) * 2 * math.pi
		local t = (i * 0.7548777 % 1) * 200
		local x, z = r * math.cos(th), r * math.sin(th)
		local ax, _, az = WF.at(p, x, 20, z, t)
		local bx, by, bz = WF.at(q, x, 20, z, t)
		local base = math.sqrt(bx * bx + by * by + bz * bz)
		sum += ((ax - bx) ^ 2 + (az - bz) ^ 2) / (base * base)
		n += 1
	end
	local rms = math.sqrt(sum / n)
	check("turbulence rms ~ 0.2 of local wind", rms > 0.15 and rms < 0.25, string.format("rms share %.3f", rms))
end

-- 8. Pressure deficit, condensation funnel
do
	local P0 = WF.deficitShare(0.6, 0.5, 0)
	check("central deficit share (Wood-White 0.6/0.5)", P0 > 1.8 and P0 < 2.4, string.format("%.3f x rho vc^2", P0))
	local p = params(3, 0)
	print(string.format("      EF3 central deficit %.0f hPa; funnel radius (x rc) at z = 0, 150, 300, 450, 590:", WF.deficit(p, 1.15, 0, 0) / 100))
	local radii = {}
	for _, z in { 0, 150, 300, 450, 590 } do
		table.insert(radii, string.format("%.2f", WF.funnelRadius(p, z, 9.81, 1) / p.rc))
	end
	print("      condense 1:   " .. table.concat(radii, "  "))
	for _, c in { 1, 1.5, 2 } do
		local row = {}
		for e = 0, 5 do
			local q = params(e, 13)
			table.insert(row, string.format("EF%d %.2f", e, WF.funnelRadius(q, 0, 9.81, c) / q.rc))
		end
		print(string.format("      funnel at the ground (x rc, base 600 m), condense %.1f: %s", c, table.concat(row, "  ")))
	end
end

-- 9. Debris speed-up: FEMA P-361 / NRC RG 1.76 calibration
do
	local function fly(class: string, U: number, seconds: number): number
		local b = WP.newBody(class, false, function()
			return 0.5
		end)
		local vx, vy, vz = 0, 0, 0
		local dt = 1 / 30
		for _ = 1, math.floor(seconds / dt) do
			vx, vy, vz = WP.step(b, vx, vy, vz, U, 0, 0, dt)
			vy = math.max(vy, 0) -- held at the ground: only the horizontal speed-up
		end
		return vx
	end
	for _, c in { { "shingle", 1 }, { "plywood", 1 }, { "board", 2 }, { "player", 3 }, { "car", 4 } } do
		print(string.format("      %-8s in 70 m/s after %ds: %.0f%% of the wind", c[1], c[2], 100 * fly(c[1], 70, c[2]) / 70))
	end
	local board = fly("board", 90, 40 / 60)
	check("2x4 crossing 40 m of a 90 m/s annulus ~ 30-55 m/s", board > 30 and board < 55, string.format("%.0f m/s", board))
	local car = fly("car", 80, 4)
	check("car in 80 m/s for 4 s ~ 20-45 m/s (NRC 41)", car > 20 and car < 45, string.format("%.0f m/s", car))
	local b = WP.newBody("shingle", false, function()
		return 0.5
	end)
	local vx = 0
	for _ = 1, 50 do
		vx = WP.step(b, vx, 0, 0, 70, 0, 0, 0.1)
	end
	check("drag step stable at 10 Hz (shingle)", vx <= 70 + 1e-6 and vx > 60, string.format("%.1f m/s", vx))
end

-- 10. Pickup thresholds against the Tachikawa number
for _, c in { "player", "board", "car", "plywood" } do
	local cls = WP.CLASSES[c]
	print(string.format("      %-7s K at release (%.0f m/s) = %.2f, CL*K = %.2f", c, cls.release, WP.tachikawa(cls, cls.release), cls.cl * WP.tachikawa(cls, cls.release)))
end

-- 11. Cost
do
	local p = params(5, 13, 0.2)
	local t0 = os.clock()
	local N = 20000
	local acc = 0
	for i = 1, N do
		local wx = WF.at(p, (i % 200) - 100, 10 + i % 50, (i % 77) * 2, i * 0.01)
		acc += wx
	end
	local us = (os.clock() - t0) / N * 1e6
	check("cost per sample (EF5, subs + turbulence)", us < 20, string.format("%.2f us", us))
end

print(if fails == 0 then "all checks passed" else fails .. " FAILED")
