--!nonstrict
--!native
-- The tornado's three-dimensional wind field (guide sections 1, 2 and 7), as plain numbers.
-- Pure: no Roblox APIs, so the server, every client and the offline tests evaluate the same
-- field from the same replicated state.
--
-- Structure (r measured from the vortex axis at that height, R = r / rc(z)):
--   tangential  Wood & White (2011): V = Vc R / (0.375 + 0.625 R^3.2)^0.5  (peak 1 at R = 1,
--               modified-Rankine tail R^-0.6), times a surface layer (zero at the ground) with a
--               near-ground jet 10-50 m up close to the core;
--   radial/vertical from one streamfunction psi = Psi0 F(r/rc) G(z): inflow concentrated in the
--               lowest ~0.15 rc, updraft in the core, and with swirl ratio S > 0.3 a central
--               downdraft (two-celled vortex) - so air is conserved exactly;
--   sub-vortices (S > ~0.7): up to six Vatistas n=2 vortices orbiting on the radius of maximum
--               wind, each with its own phase, life and strength (deterministic from the seed);
--   turbulence: smooth noise gusts at ~18% of the local wind, carried round with the flow;
--   axis:       a curve C(z) from the ground contact to the cloud base: the top's offset (tilt),
--               an S-bend and travelling helical waves (rope contortion);
--   translation: the vortex's motion is added near the core and blends to the environment's
--               low-level wind beyond ~5 rc.
-- The pressure deficit (cyclostrophic balance) gives the condensation funnel's radius at each
-- height: where the deficit equals the pressure fall from that height to the cloud base.
local function dep(name: string): any
	if script then
		return require((script :: any).Parent:FindFirstChild(name))
	end
	return (require :: any)("./" .. name)
end
local Noise = dep("Noise")

local Vortex = {}

local RHO = 1.15
local G = 9.81
local exp, sqrt, sin, cos, atan2 = math.exp, math.sqrt, math.sin, math.cos, math.atan2

-- the replicated tornado state the field is built from (Tornado.luau owns and evolves it)
export type State = {
	x: number, y: number, -- ground contact (m)
	ut: number, vt: number, -- translation (m/s)
	envU: number, envV: number, -- environment's low-level wind there
	vc: number, -- peak tangential wind at the core radius, vortex-relative (m/s)
	rc: number, -- core radius (radius of maximum wind) at 10 m (m)
	swirl: number, -- swirl ratio S
	inflow: number, -- peak inflow as a share of vc
	cloudBase: number, -- m above ground at the tornado
	topX: number, topY: number, -- axis top (at the cloud base) relative to the contact
	bendX: number, bendY: number, -- mid-height S-bend offset
	wave: number, -- helical wave amplitude (m)
	decay: number?, -- 0-1: how far it has dissipated (its outer flow spun down: Vortex.profile)
	seed: number,
	time: number, -- seconds (wrapped by the owner)
}

export type Params = State & {
	jet: number,
	twoCell: number,
	subCount: number,
	h: number, -- inflow depth (m)
	psi0: number,
	sOrbit: number,
	pressureScale: number,
}

-- Wood-White normalised tangential profile (fed: outside the core the swirl falls as R^-0.6)
local function wwFed(R: number): number
	return R / sqrt(0.375 + 0.625 * R ^ 3.2)
end
-- cut off from its inflow (dissipating): the outer flow is no longer spun up by the converging
-- inflow and spins down first while the core holds on (a free vortex outside, R^-1) - why a
-- roping-out tornado is thin, condenses no wider than its core and damages a narrow path. With the
-- fed profile kept to the end a rope condensed out to ~3 core radii, 2026-10-29
local function wwCut(R: number): number
	return R / sqrt(0.375 + 0.625 * R ^ 4)
end
-- k: how far the outer flow has spun down (the tornado's decay, 0-1)
local function ww(R: number, k: number?): number
	local c = k or 0
	if c <= 0 then
		return wwFed(R)
	end
	return wwFed(R) * (1 - c) + wwCut(R) * c
end
Vortex.profile = ww

-- the cyclostrophic deficit integral I(R) = int_R^inf f(R')^2 / R' dR' (tabulated), for each
-- outer profile (a blend between them: the blend of the two)
local I_DR = 0.02
local I_MAX = 40
local function tabulate(f: (number) -> number, tail: number): { number }
	local tab: { number } = {}
	local n = math.floor(I_MAX / I_DR)
	local acc = tail
	tab[n + 1] = tail
	for i = n, 1, -1 do
		local R0, R1 = (i - 1) * I_DR, i * I_DR
		local m = 0.5 * (R0 + R1)
		local v = f(m)
		acc += v * v / math.max(1e-6, m) * I_DR
		tab[i] = acc
	end
	return tab
end
-- tails beyond I_MAX: fed f ~ 1.265 R^-0.6, f^2/R ~ 1.6 R^-2.2 -> 1.6/1.2 R^-1.2; cut f ~ 1.265
-- R^-1, f^2/R ~ 1.6 R^-3 -> 1.6/2 R^-2
local I_FED = tabulate(wwFed, 1.6 / 1.2 * I_MAX ^ -1.2)
local I_CUT = tabulate(wwCut, 1.6 / 2 * I_MAX ^ -2)

local function deficitIntegral(R: number, k: number?): number
	local c = k or 0
	local a, b
	if R >= I_MAX then
		a, b = 1.6 / 1.2 * R ^ -1.2, 1.6 / 2 * R ^ -2
	else
		local g = R / I_DR + 1
		local i = math.floor(g)
		local f = g - i
		a = I_FED[i] * (1 - f) + I_FED[i + 1] * f
		b = I_CUT[i] * (1 - f) + I_CUT[i + 1] * f
	end
	return a * (1 - c) + b * c
end
Vortex.deficitIntegral = deficitIntegral
Vortex.CENTRAL_DEFICIT = deficitIntegral(0) -- ~2.06 (times rho vc^2)

local function ramp(x: number, a: number, b: number): number
	return math.clamp((x - a) / (b - a), 0, 1)
end

function Vortex.params(s: State): Params
	local p = table.clone(s) :: any
	local S = s.swirl
	p.twoCell = 1.2 * ramp(S, 0.3, 0.8)
	p.jet = 0.25 - 0.12 * ramp(S, 0.2, 1.0)
	-- (sub-vortices only in the multi-vortex stage, swirl > 1.0 as Tornado's stage label and
	-- docs/tornado-physics/DEBRIS-CLOUD.md; from 0.7 a cone or stovepipe had one stray sub-vortex
	-- orbiting it, 2026-10-30. Steeper, so a multi-vortex keeps ~5)
	p.subCount = math.clamp((S - 1.0) * 10, 0, 6)
	p.h = math.max(8, 0.15 * s.rc)
	local d = p.twoCell
	local sw = 0.7 -- downdraft width (in rc units) of the two-cell term
	local F1 = 0.5 - d * exp(-1 / (sw * sw))
	p.sw = sw
	local um = s.inflow * s.vc
	p.psi0 = um * s.rc * p.h * math.exp(1) / math.max(0.05, F1)
	p.sOrbit = 0.7 * s.vc / math.max(1, s.rc)
	if p.turbulence == nil then
		p.turbulence = 1
	end
	-- gust waves: three seeded plane waves per component (cheap smooth turbulence)
	local waves = {}
	for c = 1, 3 do
		for k = 1, 3 do
			local h1 = Noise.hash(c, k, 1, s.seed)
			local h2 = Noise.hash(c, k, 2, s.seed)
			local h3 = Noise.hash(c, k, 3, s.seed)
			local th, ph = h1 * 2 * math.pi, (h2 - 0.5) * math.pi
			table.insert(waves, { cos(th) * cos(ph), sin(th) * cos(ph), sin(ph), h3 * 2 * math.pi, 0.6 + 0.8 * Noise.hash(c, k, 4, s.seed) })
		end
	end
	p.waves = waves
	return p :: Params
end

local subvortex: (Params, number, number) -> (number, number)

-- Sub-vortex positions for the state's time, worked out once per state (they don't change within
-- a frame): { angle, weight, orbit radius share }
local function subList(p: Params): { { number } }
	local cached = (p :: any).subs
	if cached then
		return cached
	end
	local list = {}
	for i = 1, math.ceil(p.subCount) do
		local ang, w = subvortex(p, i, p.time)
		if w > 0.01 then
			-- (orbit radius wanders 0.6-0.9 of the core radius: NOTES.md; it was 0.9 +- 0.12, a
			-- regular ring on the parent's edge)
			local ro = 0.75 + 0.1 * Noise.value1(p.time / 7 + i, p.seed + 11) + 0.06 * Noise.value1(p.time / 2.5 + i * 2.3, p.seed + 13)
			table.insert(list, { ang, 0, w, ro, i })
		end
	end
	;(p :: any).subs = list
	return list
end

-- How deep the sub-vortices reach (m): they live in the corner flow, the inflow layer where the
-- air turns up (depth h), and weaken with height above it (Lewellen LES). Seen, they rise from the
-- ground and fade ~20-35% of the way to the cloud base, under the bowl. (At max(100, 1.5 rc), ~750 m
-- for a multi-vortex, they ran up into the bowl, 2026-10-30)
function Vortex.subDepth(p: any): number
	return math.max(60, 2.5 * (p.h or 0.15 * p.rc))
end

-- core radius at height z: grows 30% from the ground to the cloud base
local function rcAt(p: Params, z: number): number
	return p.rc * (1 + 0.3 * math.clamp(z / math.max(50, p.cloudBase), 0, 1))
end
Vortex.rcAt = rcAt

-- The axis position (offset from the ground contact) at height z and time t.
function Vortex.axisAt(p: State, z: number): (number, number)
	local zb = math.max(50, p.cloudBase)
	local u = math.clamp(z / zb, 0, 1.2)
	-- Hermite blend from the contact (0) to the top offset, leaving and entering vertically:
	-- h(u) = 3u^2 - 2u^3; the S-bend peaks at mid-height: 4u(1-u) with sign change across
	local h = u * u * (3 - 2 * u)
	local bend = sin(math.pi * math.min(u, 1)) -- one lobe
	local ox = p.topX * h + p.bendX * bend
	local oy = p.topY * h + p.bendY * bend
	if p.wave > 0 then
		-- three helical travelling waves running up the axis (rope contortion), deterministic:
		-- wavelengths 1 : 0.62 : 0.41, the shorter faster (docs/tornado-reference/NOTES.md)
		local t = p.time
		local l1 = math.max(80, zb * 0.55)
		local k1, w1 = 2 * math.pi / l1, 0.35
		local k2, w2 = 2 * math.pi / (0.62 * l1), 0.55
		local k3, w3 = 2 * math.pi / (0.41 * l1), 0.8
		local ph = (p.seed % 97) * 0.37
		-- pinned at the cloud base; the foot is loose (a rope's foot swings about its contact)
		local um = math.min(u, 1)
		local env = math.max(sin(math.pi * um) ^ 0.7, 0.35 * (1 - um) ^ 2)
		-- (each wave at most a fifth of its wavelength: steeper, the axis zig-zagged tens of metres
		-- every few metres of height and the funnel drew as a star of spikes, 2026-10-29)
		local a1 = math.min(p.wave, 0.2 * l1) * env
		local a2 = math.min(0.55 * p.wave, 0.2 * 0.62 * l1) * env
		local a3 = math.min(0.35 * p.wave, 0.2 * 0.41 * l1) * env
		ox += a1 * cos(k1 * z - w1 * t + ph) + a2 * cos(k2 * z - w2 * t + 2 * ph) + a3 * cos(k3 * z - w3 * t + 3 * ph)
		oy += a1 * sin(k1 * z - w1 * t + ph) + a2 * sin(k2 * z - w2 * t + 2 * ph) + a3 * sin(k3 * z - w3 * t + 3 * ph)
	end
	return ox, oy
end

-- sub-vortex i (1..6): its angle, weight (0..1) and strength at time t
function subvortex(p: Params, i: number, t: number): (number, number)
	local seed = p.seed + i * 7919
	local phase0 = Noise.hash(i, 1, 0, p.seed) * 2 * math.pi
	-- orbit with a slowly wandering angular speed
	-- (the orbit angle: integrated by the owner when it keeps one - p.orbit - since a rate x time
	-- product jumps whenever vc or rc changes)
	local orbit = (p :: any).orbit or p.sOrbit * t
	-- (plus a quicker wander: they speed up, stall and loop back - 0-79 m/s on looping paths at
	-- El Reno, docs/tornado-physics/DEBRIS-CLOUD.md; a steady orbit read as a turning ring)
	local ang = phase0 + orbit * (0.85 + 0.3 * Noise.hash(i, 2, 0, p.seed)) + 0.6 * Noise.value1(t / 23 + i * 3.1, seed)
		+ 0.45 * Noise.value1(t / 6 + i * 5.3, seed + 7)
	-- life: each sub-vortex waxes and wanes over 10-40 s
	local life = 0.5 + 0.5 * Noise.value1(t / (10 + 30 * Noise.hash(i, 3, 0, p.seed)) + i * 1.7, seed + 3)
	local present = math.clamp(p.subCount - (i - 1), 0, 1)
	return ang, present * math.clamp(life * 1.6 - 0.3, 0, 1)
end

-- Every sub-vortex's centre offset from the axis, weight and stable id (1..6): { {dx, dy, w, id} }
function Vortex.subvortices(p: Params, z: number): { { number } }
	local out = {}
	local rc = rcAt(p, z)
	-- each sub-vortex is a tube wrapped round the parent as a helix: the air at its orbit turns
	-- about vc while it rises at about vc too (two-celled core), so it climbs about one core radius
	-- per radian (straight vertical columns read as blobs, not vortex tubes, 2026-10-29)
	local twist = z / math.max(30, p.rc)
	for _, sv in subList(p) do
		local ro = rc * sv[4]
		local a = sv[1] + twist
		table.insert(out, { ro * cos(a), ro * sin(a), sv[3], sv[5] }) -- {dx, dy, weight, stable id}
	end
	return out
end

-- Ground-relative wind (u east, v north, w up) of the vortex at (x, y, z), EXCLUDING the
-- environment's own wind (the caller adds it). The translation is added near the core and the
-- environment's low-level flow is subtracted there (so far away only the environment remains).
function Vortex.sample(p: Params, x: number, y: number, z: number): (number, number, number)
	if z < 0 then
		z = 0
	end
	local ax, ay = Vortex.axisAt(p, z)
	local dx, dy = x - (p.x + ax), y - (p.y + ay)
	local r = sqrt(dx * dx + dy * dy)
	local rc = rcAt(p, z)
	local R = r / rc
	if R > 60 then
		return 0, 0, 0
	end
	local er_x, er_y = 1, 0
	if r > 1e-3 then
		er_x, er_y = dx / r, dy / r
	end
	-- tangential: counter-clockwise (cyclonic) in the north-up frame: e_theta = (-er_y, er_x)
	local zj = 30
	local surface = 1 - exp(-z / 3)
	local jet = 1 + p.jet * (z / zj) * exp(1 - z / zj) * exp(-(R * 0.5) ^ 2)
	-- above the cloud base the vortex hands over to the storm's circulation
	local aloft = 1 - ramp(z, p.cloudBase, p.cloudBase + 400)
	local vt = p.vc * ww(R, p.decay) * surface * jet * aloft
	-- radial and vertical from the streamfunction
	local h = p.h
	local rb = R -- r / rm with rm = rc
	local d, sw = p.twoCell, (p :: any).sw :: number
	local e2 = exp(-(rb * rb) / (sw * sw))
	local F = rb * rb / (1 + rb * rb) - d * rb * rb * e2
	local Fp = 2 * rb / (1 + rb * rb) ^ 2 - d * (2 * rb * e2 - rb * rb * (2 * rb / (sw * sw)) * e2)
	local zh = z / h
	local Gz = 1 - (1 + zh) * exp(-zh)
	local Gp = (z / (h * h)) * exp(-zh)
	local ur, w = 0, 0
	if r > 0.5 then
		ur = -(p.psi0 * F * Gp) / r
		w = p.psi0 * Gz * Fp / (rc * r)
	else
		-- on the axis: w = psi0 * Gz * 2(1 - 2d... ) / rc^2 limit of Fp / rb
		w = p.psi0 * Gz * (2 - 2 * d) / (rc * rc)
	end
	w *= aloft
	ur *= aloft
	-- the tornado's own outer flow hands over to the storm's: the R^-0.6 profile is measured out
	-- to a few core radii (DOW); beyond that the swirl and inflow are the parent mesocyclone's,
	-- which Storm.windAt already adds. Kept to 60 rc the circulation grew without bound and an
	-- EF2's 8 m/s dust-lifting wind reached ~19 rc (9 km), 2026-10-30. (The pressure deficit,
	-- Vortex.deficit, keeps the whole profile: the meso's swirl lowers the pressure too.)
	if R > 3 then
		local out = exp(-((R - 3) / 2.5) ^ 2)
		vt *= out
		ur *= out
	end
	local u = ur * er_x - vt * er_y
	local v = ur * er_y + vt * er_x
	-- sub-vortices on the radius of maximum wind
	if p.subCount > 0 and R < 3 then
		local hs = Vortex.subDepth(p)
		local fz = surface * exp(-z / hs)
		if fz > 0.02 then
			local rs = 0.12 * rc
			local vs = 0.45 * p.vc
			for _, sv in subList(p) do
				local wgt = sv[3]
				do
					local ro = rc * sv[4]
					local sa = sv[1] + z / math.max(30, p.rc) -- (the helix: Vortex.subvortices)
					local sx, sy = dx - ro * cos(sa), dy - ro * sin(sa)
					local rr = sqrt(sx * sx + sy * sy)
					local Rs = rr / rs
					local vsub = vs * wgt * fz * 1.41421 * Rs / sqrt(1 + Rs ^ 4)
					if rr > 1e-3 then
						u += -vsub * sy / rr
						v += vsub * sx / rr
						-- a sub-vortex is a little suction column: strong updraft in its core
						w += vs * wgt * fz * 0.6 * exp(-Rs * Rs)
					end
				end
			end
		end
	end
	-- turbulence: gusts ~18% of the local speed, eddies ~0.5 rc, rotating with the flow
	local speed = sqrt(u * u + v * v + w * w)
	local turb = (p :: any).turbulence :: number
	if speed > 2 and turb > 0 then
		local L = 0.5 * rc
		local rot = (p :: any).orbit or p.sOrbit * p.time
		local cr, sr = cos(rot), sin(rot)
		local qx, qy = (dx * cr + dy * sr) / L, (-dx * sr + dy * cr) / L
		local qz, qt = z / L, p.time * 0.35
		local amp = 0.18 * speed * turb / 1.6 -- (three unit waves sum to rms ~1.2)
		local waves = (p :: any).waves :: { { number } }
		local g = { 0, 0, 0 }
		for c = 1, 3 do
			local sum = 0
			for k = 1, 3 do
				local wv = waves[(c - 1) * 3 + k]
				sum += sin((qx * wv[1] + qy * wv[2] + qz * wv[3]) * wv[5] + wv[4] + qt * wv[5])
			end
			g[c] = sum
		end
		u += amp * g[1]
		v += amp * g[2]
		w += 0.6 * amp * g[3]
	end
	-- translation near the core, replacing the environment's low-level wind there
	local blendT = exp(-(R / 5) ^ 2)
	u += (p.ut - p.envU) * blendT
	v += (p.vt - p.envV) * blendT
	return u, v, w
end

-- The steady upward wind (m/s) at radius r (m) from the axis, height z: the axisymmetric part of
-- Vortex.sample's w only - no sub-vortices, gusts or translation. (For the renderer's ascending
-- condensation filaments, 2026-10-31: they climb at this and turn at the swirl.)
function Vortex.updraftAt(p: Params, r: number, z: number): number
	z = math.max(z, 0)
	local rc = rcAt(p, z)
	local R = math.max(r, 0.5) / rc
	if R > 60 then
		return 0
	end
	local d, sw = p.twoCell, (p :: any).sw :: number
	local e2 = exp(-(R * R) / (sw * sw))
	local Fp = 2 * R / (1 + R * R) ^ 2 - d * (2 * R * e2 - R * R * (2 * R / (sw * sw)) * e2)
	local zh = z / p.h
	local Gz = 1 - (1 + zh) * exp(-zh)
	local w = p.psi0 * Gz * Fp / (rc * math.max(r, 0.5))
	w *= 1 - ramp(z, p.cloudBase, p.cloudBase + 400)
	if R > 3 then
		w *= exp(-((R - 3) / 2.5) ^ 2)
	end
	return w
end

-- Pressure deficit (Pa, positive = lower than ambient) at radius r from the axis, height z.
-- The deficit comes from the swirl above the surface layer (vc), impressed down through that thin
-- layer (pressure is near hydrostatic there): neither the wind's drop to zero at the ground nor the
-- near-ground swirl jet of the corner flow (Vortex.sample) changes it. (Letting the jet deepen it
-- made condensation reappear at the ground under a clear gap: a detached "teardrop".)
function Vortex.deficit(p: State, r: number, z: number): number
	local rc = rcAt(p :: any, z)
	local aloft = 1 - ramp(z, p.cloudBase, p.cloudBase + 400)
	local v = p.vc * aloft
	return RHO * v * v * deficitIntegral(r / rc, p.decay)
end

-- The condensation funnel's radius (m) at height z, or 0 if the funnel does not reach that low.
-- humidity: 0..1 extra lowering (air in the core moistened by rain/RFD; 0 = dry adiabatic only)
function Vortex.condensationRadius(p: State, z: number): number
	local zb = p.cloudBase
	if z >= zb then
		return 0
	end
	local need = RHO * G * (zb - z) -- Pa: the pressure fall from z to the cloud base
	local rc = rcAt(p :: any, z)
	local v = p.vc -- (the swirl above the surface layer, impressed to the ground: Vortex.deficit)
	local scale = RHO * v * v
	if scale <= 0 then
		return 0
	end
	local target = need / scale
	local k = (p :: any).decay
	if target >= deficitIntegral(0, k) then
		return 0
	end
	-- I(R) decreases with R: bisect
	local lo, hi = 0, I_MAX
	for _ = 1, 24 do
		local mid = 0.5 * (lo + hi)
		if deficitIntegral(mid, k) > target then
			lo = mid
		else
			hi = mid
		end
	end
	return 0.5 * (lo + hi) * rc
end

-- The peak ground-relative wind at 10 m (m/s): samples a ring around the core. Used for the
-- lab's rating display and damage calibration.
function Vortex.peakWind(p: Params, envU: number?, envV: number?): number
	local best = 0
	-- a 3-s gust: the mean field plus about half of the instantaneous turbulence
	local keepTurb = (p :: any).turbulence
	;(p :: any).turbulence = 0.5 * (keepTurb or 1)
	local eu, ev = envU or p.envU, envV or p.envV
	for k = 0, 23 do
		local a = k / 24 * 2 * math.pi
		for _, rr in { 0.8, 1.0, 1.2 } do
			local ax, ay = Vortex.axisAt(p, 10)
			local x = p.x + ax + rr * p.rc * cos(a)
			local y = p.y + ay + rr * p.rc * sin(a)
			local u, v = Vortex.sample(p, x, y, 10)
			local s = sqrt((u + eu) ^ 2 + (v + ev) ^ 2)
			if s > best then
				best = s
			end
		end
	end
	;(p :: any).turbulence = keepTurb
	return best
end

-- EF rating from a 3-s gust (m/s): EF0 29-38, EF1 38-49, EF2 50-60, EF3 61-74, EF4 74-89, EF5 >89
function Vortex.efOf(speed: number): number
	if speed < 29 then
		return -1
	elseif speed < 38.5 then
		return 0
	elseif speed < 49.6 then
		return 1
	elseif speed < 60.4 then
		return 2
	elseif speed < 73.8 then
		return 3
	elseif speed < 89.4 then
		return 4
	end
	return 5
end

return Vortex
