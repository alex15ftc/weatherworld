--!strict
-- The tornado's wind, as plain numbers: no Roblox types, so the server, the clients and the
-- offline tests (tools/windfield) all run the same maths. Vortex.luau builds the parameters
-- from a tornado's state; this module only evaluates them.
--
-- The model (docs/tornado-physics/README.md has the sources and the reasoning):
--
--   tangential  Wood & White (2011) profile: solid-body core, smooth peak at the radius of
--               maximum wind rc, outer decay r^-alpha (Doppler-radar fits give alpha 0.5-0.8,
--               "modified Rankine"). rc widens slowly with height; a no-slip surface layer
--               (zero at the ground) with a near-ground jet overshoot (the strongest winds are
--               10-50 m up, Kosiba & Wurman 2013); a far-field taper so the vortex ends.
--   inflow and  one streamfunction psi = Psi0 F(r/rm) G(z), so air is conserved exactly:
--   updraft     a shallow inflow layer of depth h turning up into the core (corner flow);
--               a two-celled vortex (downdraught on the axis, updraught ring) as the swirl
--               ratio rises (Church et al. 1979; Refan et al. 2014).
--   sub-        at high swirl, 2-6 small vortices (Vatistas n=2) orbiting near rc, each living
--   vortices    10-40 s, strongest at the ground (El Reno 2013).
--   motion      the tornado's translation near the core, the environment's wind far away:
--               ground-relative winds are strongest on the right of the track.
--   turbulence  divergence-free noise (the curl of a noise potential) carried round with the
--               flow, ~20% of the local wind, plus slow pulsing of the whole vortex.
--
-- Frame: x, z horizontal, y up (Roblox); spin anticlockwise from above (cyclonic).
local WindField = {}

export type Params = {
	vc: number, -- peak tangential speed (storm-relative), speed units
	rc: number, -- radius of maximum wind at the ground, length units
	alpha: number, -- outer decay exponent
	eta: number, -- peak sharpness (smaller = sharper)
	z0: number, -- surface roughness depth: the wind rises from 0 at the ground over ~3 z0
	zj: number, -- height of the near-ground jet
	jet: number, -- jet overshoot share (epsilon)
	top: number, -- funnel height (cloud base)
	widen: number, -- rc grows by this share from the ground to the top
	inflow: number, -- peak inflow speed U_m, x vc
	depth: number, -- inflow layer depth h, x rc
	twoCell: number, -- d: 0 one-celled, ~1.2 two-celled, 1.5 strongly two-celled
	cellWidth: number, -- s: width of the central downdraught, x rc
	subCount: number, -- sub-vortices (0 = none; fractional: the last fades in)
	subShare: number, -- 0-1: how developed they are (fades them in and out with the swirl)
	subRadius: number, -- x rc
	subSpeed: number, -- x vc
	subOrbit: number, -- orbit radius, x rc
	subRate: number, -- orbit angular speed, x vc / rc
	subDecay: number, -- height they fade over (length units)
	turb: number, -- turbulence, share of the local wind
	turbScale: number, -- eddy size, x rc
	pulseAmp: number, -- share the whole vortex pulses by
	pulsePeriod: number, -- seconds
	taperIn: number, -- the vortex fades out between taperIn and taperOut x rc
	taperOut: number,
	moveX: number, -- translation (speed units)
	moveZ: number,
	ambientX: number, -- environmental wind far from the tornado
	ambientZ: number,
	blend: number, -- translation dominates within blend x rc
	seed: number,
}

local TAU = 2 * math.pi
local E = math.exp(1)

local function smoothstep(a: number, b: number, x: number): number
	local t = math.clamp((x - a) / (b - a), 0, 1)
	return t * t * (3 - 2 * t)
end

local function hash(seed: number, k: number): number
	-- 0-1, steady for a (seed, k)
	local x = math.sin(seed * 12.9898 + k * 78.233) * 43758.5453
	return x - math.floor(x)
end

-- Wood & White normalised profile, lambda = 1 (solid-body core), kappa = 1 + alpha:
--   f(R) = R / ((1 - 1/kappa) + (1/kappa) R^(kappa/eta))^eta, peak f(1) = 1.
function WindField.profile(R: number, alpha: number, eta: number): number
	local kappa = 1 + alpha
	return R / ((1 - 1 / kappa) + R ^ (kappa / eta) / kappa) ^ eta
end

-- The vortex's strength at time t: slow pulsing of +-pulseAmp (two incommensurate waves).
function WindField.pulse(p: Params, t: number): number
	local T = math.max(p.pulsePeriod, 1)
	local a = hash(p.seed, 1) * TAU
	local b = hash(p.seed, 2) * TAU
	return 1 + p.pulseAmp * (0.65 * math.sin(TAU * t / T + a) + 0.35 * math.sin(TAU * t / (T * 0.37) + b))
end

-- Radius of maximum wind at height z, and the peak speed there (angular momentum is partly
-- kept as the core widens: vc falls as (rc0 / rc)^0.5).
function WindField.coreAt(p: Params, z: number): (number, number)
	local grow = 1 + p.widen * math.clamp(z / math.max(p.top, 1), 0, 1.5)
	return p.rc * grow, p.vc / math.sqrt(grow)
end

-- Height factor of the tangential wind: 0 at the ground, the jet overshoot near zj inside ~2 rc.
local function heightFactor(p: Params, z: number, r: number, rc: number): number
	if z <= 0 then
		return 0
	end
	local surface = 1 - math.exp(-z / math.max(p.z0, 0.01))
	local zr = z / math.max(p.zj, 1)
	local jet = p.jet * zr * math.exp(1 - zr) * math.exp(-(r / (2 * rc)) ^ 2)
	-- above the cloud base the vortex gives way to the broader parent rotation
	local aloft = 1 - 0.7 * smoothstep(p.top, p.top * 1.5, z)
	return surface * (1 + jet) * aloft
end

WindField.heightFactor = heightFactor

-- Tangential (storm-relative) speed at radius r and height z, without sub-vortices or noise.
function WindField.tangential(p: Params, r: number, z: number, t: number?): number
	local rc, vc = WindField.coreAt(p, z)
	local strength = if t then WindField.pulse(p, t) else 1
	local taper = 1 - smoothstep(p.taperIn * p.rc, p.taperOut * p.rc, r)
	return vc * strength * WindField.profile(r / rc, p.alpha, p.eta) * heightFactor(p, z, r, rc) * taper
end

-- Inflow (negative = inward) and vertical wind from the streamfunction psi = Psi0 F(rb) G(z),
-- rb = r / rm. u = -(1/r) dpsi/dz, w = (1/r) dpsi/dr: air is conserved exactly. F/rb and
-- F'/rb are written out so nothing divides by r at the axis.
--   F(rb) = rb^2/(1+rb^2) - d rb^2 exp(-rb^2/s^2)        (d > 0: downdraught on the axis)
--   G(z)  = 1 - (1 + z/h) exp(-z/h),  G' = (z/h^2) exp(-z/h), peak inflow at z = h
-- Psi0 = 2e h rm Um puts the one-celled peak inflow at -Um, at (rm, h).
function WindField.secondary(p: Params, r: number, z: number, t: number?): (number, number)
	if z <= 0 then
		return 0, 0
	end
	local rm = p.rc
	local h = math.max(p.depth * rm, 1)
	local Um = p.inflow * p.vc * (if t then WindField.pulse(p, t) else 1)
	local psi0 = 2 * E * h * rm * Um
	local rb = r / rm
	local rb2 = rb * rb
	local d = p.twoCell
	local s2 = math.max(p.cellWidth, 0.05) ^ 2
	local g = math.exp(-rb2 / s2)
	local fOverR = rb / (1 + rb2) - d * rb * g
	local fpOverR = 2 / (1 + rb2) ^ 2 - 2 * d * (1 - rb2 / s2) * g
	local zh = z / h
	local ez = math.exp(-zh)
	local G = 1 - (1 + zh) * ez
	local Gp = (z / (h * h)) * ez
	local taper = 1 - smoothstep(p.taperIn * p.rc, p.taperOut * p.rc, r)
	local u = -(psi0 / rm) * fOverR * Gp * taper
	-- the updraught stops above the cloud base (the small mass mismatch up there is irrelevant)
	local w = (psi0 / (rm * rm)) * fpOverR * G * (1 - smoothstep(0.9 * p.top, 1.2 * p.top, z)) * taper
	return u, w
end

-- Sub-vortex k: where it is (relative to the axis) and how strong (0-1), at time t.
function WindField.subVortex(p: Params, k: number, t: number): (number, number, number)
	local n = math.max(math.ceil(p.subCount), 1)
	local life = 10 + 30 * hash(p.seed, 10 + k) -- seconds
	local phase = (t + life * hash(p.seed, 20 + k)) / life
	local cycle = math.floor(phase)
	local f = phase - cycle
	local envelope = math.sin(math.pi * f) ^ 2 -- born, grows, dies
	local orbit = p.subOrbit * p.rc * (0.85 + 0.15 * hash(p.seed + cycle, 30 + k))
	local angle = TAU * (k - 1) / n
		+ 0.8 * (hash(p.seed + cycle, 40 + k) - 0.5)
		+ p.subRate * (p.vc / p.rc) * t
	-- a fractional count fades the last one in, so a change in the count never pops
	local present = math.clamp(p.subCount - (k - 1), 0, 1)
	return math.cos(angle) * orbit, math.sin(angle) * orbit, envelope * p.subShare * present
end

-- Turbulence: a divergence-free horizontal part (curl of a noise potential, finite differences)
-- and a smaller vertical part. The noise pattern is carried round the axis with the flow; two
-- copies offset by half a period are crossfaded so the winding never piles up.
local function turbulence(p: Params, x: number, z: number, y: number, t: number, local_: number): (number, number, number)
	if p.turb <= 0 or local_ <= 0 then
		return 0, 0, 0
	end
	local L = math.max(p.turbScale * p.rc, 2)
	local omega = 0.7 * p.vc / p.rc
	local period = 8
	local eps = 0.15 * L
	local ux, uz = 0, 0
	for copy = 0, 1 do
		local tc = t + copy * period * 0.5
		local age = tc % period
		local weight = math.sin(math.pi * age / period) -- 0 at the swaps, so no jumps
		-- angle the eddies have been carried round since this copy was laid down
		local r = math.sqrt(x * x + z * z)
		local carried = age * omega / (1 + (r / p.rc) ^ 1.5)
		local c, s = math.cos(carried), math.sin(carried)
		local salt = math.floor(tc / period) * 17.31 + copy * 5.7 + p.seed % 97
		local function phi(px: number, pz: number): number
			local qx = (px * c + pz * s) / L
			local qz = (-px * s + pz * c) / L
			return math.noise(qx + salt, qz, y / (2 * L) + 0.13 * tc)
		end
		local p0 = phi(x, z)
		ux += weight * (phi(x, z + eps) - p0) / eps
		uz -= weight * (phi(x + eps, z) - p0) / eps
	end
	-- calibrated so the horizontal part's rms is p.turb x the local wind (tools/windfield/test)
	local k = 0.81 * L * p.turb * local_
	local wy = 0.5 * p.turb * local_ * 2.6 * math.noise(x / L + 31.7, z / L, y / L + 0.21 * t)
	return k * ux, wy, k * uz
end

-- The wind at (x, y, z) relative to the axis at that height (x, z) and above the ground (y),
-- ground-relative, at time t. Returns wx, wy, wz.
function WindField.at(p: Params, x: number, y: number, z: number, t: number): (number, number, number)
	local r = math.sqrt(x * x + z * z)
	local vt = WindField.tangential(p, r, y, t)
	local u, w = WindField.secondary(p, r, y, t)
	local wx, wy, wz = 0, w, 0
	if r > 1e-6 then
		local ox, oz = x / r, z / r
		-- anticlockwise from above: tangent = up x outward = (oz, 0, -ox)
		wx += oz * vt + ox * u
		wz += -ox * vt + oz * u
	end
	-- sub-vortices
	if p.subCount > 0 and p.subShare > 0 and y > 0 then
		local fade = math.exp(-y / math.max(p.subDecay, 1)) * (1 - math.exp(-y / math.max(p.z0, 0.01)))
		local rs = math.max(p.subRadius * p.rc, 1)
		local vs = p.subSpeed * p.vc
		for k = 1, math.ceil(p.subCount) do
			local sx, sz, strength = WindField.subVortex(p, k, t)
			if strength > 0.001 then
				local dx, dz = x - sx, z - sz
				local d = math.sqrt(dx * dx + dz * dz)
				if d > 1e-6 and d < 12 * rs then
					local R = d / rs
					-- Vatistas n = 2: smooth core, peak 1 at R = 1
					local v = vs * strength * fade * math.sqrt(2) * R / math.sqrt(1 + R ^ 4)
					wx += (dz / d) * v
					wz += (-dx / d) * v
				end
			end
		end
	end
	-- motion: the translation near the core, the environment's wind far away (added once)
	local beta = math.exp(-(r / (p.blend * p.rc)) ^ 2)
	wx += beta * p.moveX + (1 - beta) * p.ambientX
	wz += beta * p.moveZ + (1 - beta) * p.ambientZ
	-- turbulence scaled by the local storm-relative wind
	local localSpeed = math.sqrt(vt * vt + u * u + w * w)
	local zj = math.max(p.zj, 1)
	local tx, ty, tz = turbulence(p, x, z, y, t, localSpeed * (1 + 0.5 * math.exp(-y / zj)))
	return wx + tx, wy + ty, wz + tz
end

-- Set p.vc so the peak ground-relative horizontal wind at height z (on the strong, right-hand
-- side of the track) is `target`, counting the inflow and the translation as well as the spin.
-- Gusts, pulsing and sub-vortices are left out (they are the short peaks on top).
function WindField.calibrate(p: Params, target: number, z: number)
	local turb, subs, pulse = p.turb, p.subCount, p.pulseAmp
	p.turb, p.subCount, p.pulseAmp = 0, 0, 0
	-- the right of the track: outward direction with the spin along the motion
	local mx, mz = p.moveX, p.moveZ
	local m = math.sqrt(mx * mx + mz * mz)
	local ox, oz = 0, 1
	if m > 1e-6 then
		-- tangent (oz, -ox) parallel to the motion: outward = (-mz, mx) / m
		ox, oz = -mz / m, mx / m
	end
	p.vc = math.max(target, 1)
	for _ = 1, 4 do
		local peak = 0
		for i = 0, 24 do
			local r = (0.7 + 0.6 * i / 24) * p.rc
			local wx, _, wz = WindField.at(p, ox * r, z, oz * r, 0)
			peak = math.max(peak, math.sqrt(wx * wx + wz * wz))
		end
		if peak <= 1e-6 then
			break
		end
		-- the translation doesn't scale with vc: rescale only the vortex's part
		local own = math.max(peak - m, 0.3 * peak)
		p.vc *= math.max(target - (peak - own), 0.3 * target) / own
	end
	p.turb, p.subCount, p.pulseAmp = turb, subs, pulse
end

-- Pressure deficit. Cyclostrophic balance, dp/dr = rho v^2 / r, so
--   deficit(r) = rho vc^2 P(r / rc),  P(R) = integral from R to infinity of f(R')^2 / R' dR'.
-- P is tabulated once per (alpha, eta) on a log grid; the tail beyond the table is analytic.
type Table = { R: { number }, P: { number } }
local tables: { [string]: Table } = {}

local function pressureTable(alpha: number, eta: number): Table
	local key = string.format("%.3f/%.3f", alpha, eta)
	local tab = tables[key]
	if tab then
		return tab
	end
	local N = 400
	local lo, hi = math.log(1e-3), math.log(1e3)
	local R: { number } = table.create(N, 0)
	local P: { number } = table.create(N, 0)
	for i = 1, N do
		R[i] = math.exp(lo + (hi - lo) * (i - 1) / (N - 1))
	end
	-- beyond R = 1e3 the profile is c R^-alpha: integral = c^2 R^(-2 alpha) / (2 alpha)
	local Rend = R[N]
	local fend = WindField.profile(Rend, alpha, eta)
	P[N] = fend * fend / (2 * alpha)
	for i = N - 1, 1, -1 do
		-- trapezoid in ln R: integrand f^2 / R dR = f^2 d(ln R)
		local fa = WindField.profile(R[i], alpha, eta)
		local fb = WindField.profile(R[i + 1], alpha, eta)
		P[i] = P[i + 1] + 0.5 * (fa * fa + fb * fb) * (math.log(R[i + 1]) - math.log(R[i]))
	end
	tab = { R = R, P = P }
	tables[key] = tab
	return tab
end

-- P(R): the normalised deficit (deficit / (rho vc^2)).
function WindField.deficitShare(alpha: number, eta: number, R: number): number
	local tab = pressureTable(alpha, eta)
	local Rs, Ps = tab.R, tab.P
	if R <= Rs[1] then
		-- solid-body core: P(R) = P(R1) + (R1^2 - R^2) f'(0)^2 / 2
		local slope = WindField.profile(Rs[1], alpha, eta) / Rs[1]
		return Ps[1] + 0.5 * slope * slope * (Rs[1] * Rs[1] - R * R)
	elseif R >= Rs[#Rs] then
		local f = WindField.profile(R, alpha, eta)
		return f * f / (2 * alpha)
	end
	local x = (math.log(R) - math.log(Rs[1])) / (math.log(Rs[#Rs]) - math.log(Rs[1])) * (#Rs - 1) + 1
	local i = math.floor(x)
	local f = x - i
	return Ps[i] + (Ps[i + 1] - Ps[i]) * f
end

-- Pressure deficit (Pa when rho is kg/m^3 and speeds m/s) at radius r, height z.
function WindField.deficit(p: Params, rho: number, r: number, z: number): number
	local rc, vc = WindField.coreAt(p, z)
	return rho * vc * vc * WindField.deficitShare(p.alpha, p.eta, r / rc)
end

-- Radius of the condensation funnel at height z: where the deficit (x condense, for what a dry
-- vortex leaves out) equals the pressure fall from the ground to the cloud base, rho g (top - z).
-- 0 where the cloud doesn't reach down to z. g in length/s^2.
function WindField.funnelRadius(p: Params, z: number, g: number, condense: number): number
	local rc, vc = WindField.coreAt(p, z)
	local need = g * math.max(p.top - z, 0) / math.max(condense * vc * vc, 1e-6)
	if need <= 0 then
		return math.huge
	end
	if WindField.deficitShare(p.alpha, p.eta, 0) < need then
		return 0
	end
	-- P falls with R: bisect in ln R
	local lo, hi = math.log(1e-3), math.log(1e3)
	for _ = 1, 40 do
		local mid = 0.5 * (lo + hi)
		if WindField.deficitShare(p.alpha, p.eta, math.exp(mid)) >= need then
			lo = mid
		else
			hi = mid
		end
	end
	return math.exp(lo) * rc
end

return WindField
