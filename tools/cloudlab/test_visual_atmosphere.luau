-- Offline checks of the visual atmosphere (roblox/Shared/CloudModel/VisualAtmosphere.luau),
-- pass/fail, a second or two. With a near client frame (a .bin from js/cloudmodel/FrameCodec.js
-- clientFrame) it also reads that frame's tornado and nest.
--   lune run tools/cloudlab/test_visual_atmosphere.luau [near.bin]
local fs = require("@lune/fs")
local process = require("@lune/process")
local ClientFrame = require("../../roblox/Shared/CloudModel/ClientFrame")
local VA = require("../../roblox/Shared/CloudModel/VisualAtmosphere")
VA.ClientFrame = ClientFrame

local fails = 0
local function check(ok: boolean, what: string)
	print((if ok then "pass  " else "FAIL  ") .. what)
	if not ok then fails += 1 end
end

-- a synthetic vortex (as vortexFrom gives) with core R (m), swirl V (m/s), updraught w, wall base Bt
local function vortex(R: number, V: number, w: number, Bt: number, r0: number?): any
	local rhoG = 11.5
	local rho = rhoG / 9.81
	local P = rho * V * V
	local core = r0 or 4500
	return { x = 0, y = 0, R = R, P = P, Bt = Bt, tip = math.max(0, Bt - P / rhoG), rhoG = rhoG, rho = rho, V = V, mph = V / 0.44704,
		wTor = w, r0 = core, S = R * V / (core * w), levels = {}, mesoV = 5, mesoR = 1000 }
end

-- 1. noise: continuous, bounded, deterministic
do
	local maxJump, lo, hi = 0, 1, -1
	local prev = VA.noise(0, 0.3, 0.7, 5)
	for q = 1, 4000 do
		local x = q * 0.001
		local n = VA.noise(x, 0.3, 0.7, 5)
		maxJump = math.max(maxJump, math.abs(n - prev))
		lo, hi = math.min(lo, n), math.max(hi, n)
		prev = n
	end
	check(maxJump < 0.01, ("noise continuous (largest step %.4f over 0.001)"):format(maxJump))
	check(lo >= -1 and hi <= 1, ("noise bounded (%.2f..%.2f)"):format(lo, hi))
	check(VA.fbm(1.3, 2.1, 0.4, 9, 3) == VA.fbm(1.3, 2.1, 0.4, 9, 3), "fbm deterministic")
	check(VA.noise(1.3, 2.1, 0.4, 9) ~= VA.noise(1.3, 2.1, 0.4, 10), "seed changes noise")
end

-- 2. the funnel: radius from the tip (0) up to the base (wide), monotonic; optical depth grows inward
do
	local v = vortex(60, 70, 25, 800)
	local last, mono = -1, true
	for z = v.tip, v.Bt - 1, 5 do
		local r = VA.funnelRadius(v, z, 3)
		if r < last - 1e-6 then mono = false end
		last = r
	end
	check(VA.funnelRadius(v, v.tip - 5, 3) == 0, "no cloud below the tip")
	check(mono, "funnel widens monotonically up to the base")
	check(math.abs(VA.funnelRadius(v, v.Bt - 0.01, 3) - 3 * v.R) < 1e-6, "flare capped at 3 R at the base")
	local zMid = 0.5 * (v.tip + v.Bt)
	local rc = VA.funnelRadius(v, zMid, 3)
	local t0, t5, t9 = VA.chordTau(v, zMid, 0, rc), VA.chordTau(v, zMid, 0.5 * rc, rc), VA.chordTau(v, zMid, 0.95 * rc, rc)
	check(t0 > t5 and t5 > t9 and t9 >= 0, ("chord optical depth falls toward the edge (%.2f, %.2f, %.2f)"):format(t0, t5, t9))
	check(VA.parentBeta(v, rc * 1.01, zMid) == 0, "clear air just outside the condensation radius")
	-- soft edge: the outer tenth of the radius stops much less light than the centre
	check(1 - math.exp(-t9) < 0.5 * (1 - math.exp(-t0)), "edge see-through against the core")
	-- a rope is fainter than a wedge
	local rope, wedge = vortex(8, 45, 20, 900), vortex(400, 90, 25, 700)
	local function midA(x: any): number
		local z = 0.5 * (x.tip + x.Bt)
		return 1 - math.exp(-VA.chordTau(x, z, 0, VA.funnelRadius(x, z, 3)))
	end
	check(midA(rope) < midA(wedge), ("rope fainter than wedge (%.2f vs %.2f)"):format(midA(rope), midA(wedge)))
end

-- 3. swirl ratio: subvortices only from S, smoothly
do
	local laminar = vortex(40, 50, 20, 800)
	local _, st = VA.subvortices(laminar)
	check(laminar.S < 0.2 and st == 0, ("narrow vortex laminar (S %.2f), no subvortices"):format(laminar.S))
	local wide = vortex(700, 95, 12, 700)
	local n, st2 = VA.subvortices(wide)
	check(wide.S > 1 and st2 > 0.9 and n >= 3, ("wide strong vortex (S %.2f): %.1f subvortices at %.0f%%"):format(wide.S, n, st2 * 100))
	-- same wind and width, a stronger updraught: lower S, fewer subvortices (not from intensity alone)
	local fed = vortex(700, 95, 40, 700)
	local n3 = VA.subvortices(fed)
	check(fed.S < wide.S and n3 <= n, ("stronger updraught lowers S (%.2f) and the count (%.1f)"):format(fed.S, n3))
	local maxJump, prevN, prevSt = 0, nil, nil
	for q = 0, 300 do
		local x = vortex(100 + q * 3, 90, 15, 700)
		local nn, ss = VA.subvortices(x)
		if prevN then maxJump = math.max(maxJump, math.abs(nn * ss - prevN * prevSt)) end
		prevN, prevSt = nn, ss
	end
	check(maxJump < 0.05, ("subvortex count and strength change smoothly with S (largest step %.3f)"):format(maxJump))
	local Rs, Ps, om = VA.subvortex(wide, n, st2)
	check(Rs < wide.R and Ps < wide.P and om > 0, ("subvortex core %.0f m, drop %.0f Pa, orbit %.2f rad/s"):format(Rs, Ps, om))
end

-- 4. easing: no jumps, converges
do
	local a, b = vortex(60, 70, 25, 800), vortex(120, 80, 25, 700)
	local cur = a
	local maxStep = 0
	for _ = 1, 600 do
		local nxt = VA.ease(cur, b, 1 / 60)
		maxStep = math.max(maxStep, math.abs(nxt.R - cur.R))
		cur = nxt
	end
	check(maxStep < 1, ("eased core radius moves at most %.2f m a frame"):format(maxStep))
	check(math.abs(cur.R - b.R) < 3, ("eased vortex converges in 10 s (R %.1f of %.0f)"):format(cur.R, b.R))
end

-- 5. flow: inflow at the ground only, rise in the core
do
	local v = vortex(60, 70, 25, 800)
	local _, vr0, _ = VA.flow(v, 100, 5)
	local _, vr1, _ = VA.flow(v, 100, 600)
	local _, _, w0 = VA.flow(v, 0, 300)
	local _, _, w1 = VA.flow(v, 400, 300)
	check(vr0 < -5 and math.abs(vr1) < 0.2, ("inflow at the ground (%.1f m/s), none aloft (%.2f)"):format(vr0, vr1))
	check(w0 > w1 and w0 > 5, ("rise in the core (%.1f m/s) over outside (%.2f)"):format(w0, w1))
	check(VA.dustRadius(v, 10) > v.R, ("dust out to %.0f m"):format(VA.dustRadius(v, 10)))
	check(VA.dustRadius(vortex(30, 10, 10, 800), 2) == 0, "no dust from a weak whirl")
end

-- 6. a real frame
local path = process.args[1]
if path then
	local b = buffer.fromstring(fs.readFile(path))
	local f = ClientFrame.decode(b)
	check(f.updraught ~= nil, "frame carries the updraught block")
	local v = VA.vortexFrom(f)
	if v then
		print(("  vortex R %d m, swirl %.0f m/s, funnel %d-%d m, w over it %.1f m/s, r0 %.0f m, S %.3f, meso %.1f m/s r %.0f m"):format(v.R, v.V, v.tip, v.Bt, v.wTor, v.r0, v.S, v.mesoV, v.mesoR))
		local lx, ly = VA.leanAt(v.levels, v.Bt)
		check(math.sqrt(lx * lx + ly * ly) < 0.5 * v.Bt, ("funnel leans %.0f m over its %.0f m to the base"):format(math.sqrt(lx * lx + ly * ly), v.Bt))
		local low, up = VA.loweringAt(f, v.x, v.y, v.rhoG)
		check(low ~= nil, ("wall cloud over the tornado: lowered base %s m (unlowered %.0f)"):format(tostring(low and math.floor(low)), up))
	end
	if f.nest then
		local Vm, Rm, mx, my = VA.mesoFromNest(f)
		print(("  nest meso %.1f m/s r %.0f m at (%.0f, %.0f)"):format(Vm, Rm, mx, my))
		-- the lowered base is continuous across the nest (bilinear): no step larger than the field's
		local n = f.nest
		local maxJump, prev = 0, nil
		for q = 0, 400 do
			local x = n.X0 + q / 400 * n.nx * n.dx
			local l = VA.loweringAt(f, x, n.Y0 + 0.5 * n.ny * n.dx)
			if l and prev then maxJump = math.max(maxJump, math.abs(l - prev)) end
			prev = l
		end
		print(("  lowered base along the nest's middle: largest step %.0f m over %.0f m"):format(maxJump, n.nx * n.dx / 400))
	end
	-- cost of a tornado's math (TornadoView): the profile (44 slices x 4 chords) every 0.2 s, and
	-- every step the shape (3 noise calls a slice) and 150 tracers (flow + a table lookup)
	local vv = v or vortex(120, 80, 20, 700)
	local t0 = os.clock()
	for _ = 1, 100 do
		for s = 1, 44 do
			local z = vv.tip + s / 44 * (vv.Bt - vv.tip)
			local rc = math.max(VA.funnelRadius(vv, z, 3), 1)
			for _, bf in { 0, 0.3, 0.6, 0.9 } do VA.chordTau(vv, z, bf * rc, rc, 8) end
		end
	end
	local profMs = (os.clock() - t0) * 1000 / 100
	t0 = os.clock()
	for _ = 1, 100 do
		for s = 1, 44 do
			for c = 1, 3 do VA.fbm(s / 10, 0.1, c, 1, 2) end
		end
		for i = 1, 150 do
			local z = vv.tip + (i / 150) * (vv.Bt - vv.tip)
			VA.flow(vv, 30, z)
			for q = 1, 22 do if q * 30 > z then break end end
		end
	end
	local stepMs = (os.clock() - t0) * 1000 / 100
	print(("  tornado math: profile %.2f ms every 0.2 s, %.2f ms a step: %.2f ms a frame at 60 fps (lune, one core)"):format(profMs, stepMs, stepMs + profMs / 12))
end

print(if fails == 0 then "visual atmosphere: all passed" else ("visual atmosphere: %d FAILED"):format(fails))
if fails > 0 then process.exit(1) end
