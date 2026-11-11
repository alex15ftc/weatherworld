--!strict
-- The storm's cloud as one field (docs/stormlab/PHYSICAL-VOLUME-PLAN.md, phase 1, 2026-11-03).
--
-- CloudField.at(world, x, y, z) -> sigma (extinction, 1/m), ice (0..1 glaciated share), q (kg/kg)
--
-- Every visible cloud of the storm is where this is non-zero; renderers sample it, they don't
-- shape parts. Air is cloud where it has risen past its own condensation level zc:
--
--   zc(x, y, z) = LCL(air there) - p'(x, y, z) / (rho g)
--
--   LCL(air)  the inflow's base, lowered where the low-level circulation's air is the moist
--             rain-cooled outflow it ingests (Storm.lowering less its deficit part, vlow^2/g);
--             at a tornado, the condensation level of the air its core takes in (Vortex.coreBase)
--   p'        the pressure deficits: the low-level mesocyclone's (cyclostrophic, Rankine: rho V^2
--             at the centre, rho V^2 R^2 / 2r^2 outside) and the tornado's (Vortex.deficit)
--
-- So the base, the wall cloud and the funnel are one surface: the funnel is that surface pulled
-- down by the tornado's deficit, the wall cloud by the meso's. Above it rising saturated air carries
-- the adiabatic cloud water q = gammaL (z - zc) (Storm.gammaL, ~2 g/kg per km), so a cloud is thin at
-- its underside and thickens upward.
--
-- Across, the cloud is the rising column: the live updraft's cloud (where it still rises at
-- ~1.5 m/s: Ru(z) sqrt(ln(W f / 1.5)) round the tilted centre) or the remembered cloud (Storm's
-- cloud memory), whichever is wider. At its edge air from outside mixes in: a share chi of
-- environment air that needs DQ per kg to saturate, so q (1 - chi) - DQ chi, and the cloud ends where
-- that reaches 0 - a dry environment gives a sharp edge.
--
-- Extinction from the condensate: sigma = 3/2 rho q / (rho_w r_e), r_e 10 um liquid, 30 um ice
-- (q 1 g/kg: sigma ~0.17 /m, a 6 m mean free path - clouds are opaque, their edges are where q
-- falls to ~0).
--
-- The ingested air (2026-11-03, round 42): the moist outflow air lowers the level only inside the
-- low-level circulation's rising core - its radius R, the air its updraft takes in - with a sharp,
-- ragged edge: turbulent eddies a tenth of R across move the edge in and out, and the same eddies lift
-- and drop the condensation level under the whole lowering (the scud and the wall cloud's lumps).
-- The eddies ride round with the circulation (angle less (V / R) t), so the wall cloud's raggedness
-- turns as it does. (Back-trajectories through World.windAt were tried for the edge: the sim's
-- low-level rising air spans ~13 km, nearly all of it off the cold pool, so they gave no edge - see
-- tools/stormlab/diag_airmap.luau; that comes with the phase 2 inflow work.)
--
-- Phase 1 simplifications (to be replaced, see the plan): DQ one value; no anvil.
local function dep(name: string): any
	if script then
		return require((script :: any).Parent:FindFirstChild(name))
	end
	return (require :: any)("./" .. name)
end
local Storm = dep("Storm")
local Vortex = dep("Vortex")
local Noise = dep("Noise")

local CloudField = {}

local RHO, G, RHO_W = 1.15, 9.81, 1000
local RE_LIQ, RE_ICE = 10e-6, 30e-6
local QCAP = 3.5e-3 -- kg/kg: diluted parcels carry at most ~2-4 g/kg in a deep updraft
local DQ = 1.0e-3 -- kg/kg: the saturation deficit of the air mixed in at a cloud's edge
local CHI0, CHI1 = 0.75, 1.15 -- the edge's mixing zone, in column radii
CloudField.QCAP, CloudField.DQ = QCAP, DQ

local function smooth(a: number, b: number, x: number): number
	local t = math.clamp((x - a) / (b - a), 0, 1)
	return t * t * (3 - 2 * t)
end

function CloudField.sigmaOf(q: number, ice: number): number
	if q <= 0 then
		return 0
	end
	local re = RE_LIQ + (RE_ICE - RE_LIQ) * ice
	return 1.5 * RHO * q / (RHO_W * re)
end

-- the live updraft's cloud radius at z (no floors: none where the updraft no longer rises at 1.5 m/s)
local function liveR(s: any, z: number): (number, number, number)
	local W = if s.dead then 0 else math.max(s.W or 0, 0)
	local f, tx, ty = Storm.wprofAt(s, z)
	local Wz = W * math.max(f, 0)
	if Wz <= 1.5 then
		return 0, tx, ty
	end
	return Storm.updraftRadiusAt(s, z) * math.sqrt(math.log(Wz / 1.5)), tx, ty
end
CloudField.liveR = liveR

-- the low-level circulation's pressure deficit (Pa) at distance r: Rankine, confined to the storm
-- as Storm.windAt's (exp(-(r / 3R)^2))
local function mesoDeficit(V: number, R: number, r: number): number
	local d
	if r < R then
		d = RHO * V * V * (1 - 0.5 * (r * r) / (R * R))
	else
		d = RHO * V * V * 0.5 * (R * R) / (r * r)
	end
	return d * math.exp(-(r / (3 * R)) ^ 2)
end

-- the mixed edge: what condensate is left after a share chi of outside air has come in
local function mixed(q: number, x: number): number
	local chi = smooth(CHI0, CHI1, x)
	return q * (1 - chi) - DQ * chi
end

-- The condensation level (m) at (x, y) for air at height z, and how far the storm's lowering has
-- pulled it under the base there (m). (See the header: the moist ingested air round the low-level
-- circulation, its pressure deficit, and at a tornado its core's air and deficit.) far: the point is
-- out of the circulations' reach (nothing lowers it).
local function condLevel(s: any, tor: any?, x: number, y: number, z: number): (number, boolean)
	local base = s.base or 1000
	local zc = base
	local V = math.abs(s.vlow or 0)
	local far = true
	if V > 0.5 and z < base + 1500 then
		-- (the low-level circulation's centre: on the tornado's top when it has one - the tornado is
		-- that circulation's contracted core - else its own)
		local mx, my = s.cLowX or s.x, s.cLowY or s.y
		local p = tor and tor.params
		if p then
			local H = math.max(100, p.cloudBase or base)
			local ax, ay = Vortex.axisAt(p, H)
			mx, my = tor.x + ax, tor.y + ay
		end
		local R = 0.3 * (s.Ru or 3000)
		local rm = math.sqrt((x - mx) ^ 2 + (y - my) ^ 2)
		if rm < 6 * R then
			far = false
			local rot = math.clamp(s.rot or 0, 0, 1)
			-- (the moist ingested air's part of the storm's lowering: the rest is the deficit below,
			-- so at the centre this gives Storm's wallBase - pinned or physical)
			local mixL = math.max(0, (s.lowering or 0) - rot * V * V / G)
			-- (the deficit lowers the level only below ~1.5 km over the base: the low meso's depth)
			local kz = 1 - smooth(base, base + 1500, z)
			-- (the eddies, in the circulation's turning frame)
			local th = math.atan2(y - my, x - mx) - (V / R) * (s.age or 0)
			local ex, ey = mx + rm * math.cos(th), my + rm * math.sin(th)
			local L = 0.1 * R
			local seed = (s.seed or 0) + 71
			local tt = (s.age or 0) / 120
			-- (the core's edge in and out by ~20%: a ragged wall cloud, not a disc; the edge lies within
			-- 0.64-1.2 R, so only there is it worked out)
			local share = 0
			if rm < 0.64 * R then
				share = 1
			elseif rm < 1.2 * R then
				local edge = R * (1 + 0.2 * Noise.fbm3(math.cos(th) * 2.5, math.sin(th) * 2.5, tt, seed, 2))
				share = 1 - smooth(0.8 * edge, edge, rm)
			end
			-- (the eddies' lift: ~w' t over the lowered air, a fifth of its lowering plus scud, out to
			-- 2 R - past that the base is the inflow's, smooth)
			local eddy = 0
			if rm < 2 * R then
				eddy = (0.2 * mixL * share + 15 * rot) * (1 - smooth(1.5 * R, 2 * R, rm))
					* Noise.fbm3((ex - mx) / L, (ey - my) / L, z / (2 * L) + tt, seed + 9, 2)
			end
			zc -= (mixL * share + rot * mesoDeficit(V, R, rm) / (RHO * G) + eddy) * kz
			if p then
				local zz = math.min(z, p.cloudBase or base)
				local ax, ay = Vortex.axisAt(p, zz)
				local rt = math.sqrt((x - tor.x - ax) ^ 2 + (y - tor.y - ay) ^ 2)
				local rc = Vortex.rcAt(p, zz)
				-- (the core's own air - the wall cloud's, mixed toward the cold pool's at the contact -
				-- within a few core radii, then the tornado's deficit on it: Vortex.condensationRadius)
				local kt = math.exp(-(rt / (3 * math.max(rc, 1))) ^ 2)
				zc += (Vortex.coreBase(p) - zc) * kt
				zc -= Vortex.deficit(p, rt, z) / (RHO * G)
			end
		end
	end
	return zc, far
end
CloudField.condLevel = condLevel

-- The storm's (and its tornado's) cloud at a point: q (kg/kg), ice share.
-- tor: the tornado drawn from this circulation (with .params), or nil.
-- Two ways air here is cloud, the more of the two:
--   column    above the base, in the rising column (live updraft or remembered cloud), with its
--             mixed edge
--   lowered   where the circulations have pulled the condensation level down (wall cloud, funnel):
--             below the base any air past it is cloud - it condenses by the pressure fall, no lift
--             needed - and above the base that air goes on rising into the base (the lowering's
--             air, through the low meso's depth). So the lowering is joined to the base it hangs
--             from, whether or not it lies inside the live column (a meso at the column's edge)
function CloudField.storm(s: any, tor: any?, x: number, y: number, z: number): (number, number)
	if not s.cReach then
		Storm.prepare(s)
	end
	local base = s.base or 1000
	if z < 0 or z > (s.top or 12000) + 500 then
		return 0, 0
	end
	local dx0, dy0 = x - s.x, y - s.y
	if dx0 * dx0 + dy0 * dy0 > s.cReach * s.cReach then
		return 0, 0
	end
	local gamma = s.gammaL or 2e-6
	local zk = math.max(z, base)
	local rL, tx, ty = liveR(s, zk)
	local rM, qn = Storm.memAt(s, zk)
	local cx, cy = s.x + tx, s.y + ty
	local r = math.sqrt((x - cx) ^ 2 + (y - cy) ^ 2)
	local rCol = math.max(rL, rM)
	local inCol = z >= base and rCol >= 1 and r < CHI1 * rCol
	local zc, far = condLevel(s, tor, x, y, z)
	if far and not inCol then
		return 0, 0
	end
	local dz = z - zc
	if dz <= 0 then
		return 0, 0
	end
	local qa = math.min(gamma * dz, QCAP)
	local q = 0
	if inCol then
		-- live and remembered cloud (the memory's water as its share of what the updraft brought)
		if rL > 1 then
			q = mixed(qa, r / rL)
		end
		if rM > 1 and qn > 0 then
			q = math.max(q, mixed(qa * math.clamp(qn, 0, 1), r / rM))
		end
	end
	if not far then
		if z < base then
			q = math.max(q, qa)
		else
			-- (the lowering's air rising on: as far as the condensation level under the base here
			-- was pulled down, through the low meso's depth)
			local zcB = condLevel(s, tor, x, y, base - 1)
			local kL = smooth(0, 60, base - zcB) * (1 - smooth(base, base + 1500, z))
			q = math.max(q, qa * kL)
		end
	end
	if q <= 0 then
		return 0, 0
	end
	-- glaciated from ~-20 C to -38 C: ~3 and ~5.5 km over the freezing level
	local fz = s.freezing or 4000
	local ice = smooth(fz + 3000, fz + 5500, z)
	return q, ice
end

-- the tornado drawn from storm s (attached, not ended), or nil
local function tornadoOf(world: any, s: any): any?
	local best, bv = nil, 0
	for _, t in world.tornadoes or {} do
		if not t.ended and t.params and t.parentId ~= nil and tostring(t.parentId) == tostring(s.id) then
			if (t.vc or 0) > bv then
				best, bv = t, t.vc or 0
			end
		end
	end
	return best
end
CloudField.tornadoOf = tornadoOf

-- The whole cloud at a point: sigma (1/m), ice share, q (kg/kg). The storms overlap as the most
-- cloud of any (each is the same air's condensate, not added air).
function CloudField.at(world: any, x: number, y: number, z: number): (number, number, number)
	local q, ice = 0, 0
	for _, s in world.storms do
		local qs, is = CloudField.storm(s, tornadoOf(world, s), x, y, z)
		if qs > q then
			q, ice = qs, is
		end
	end
	return CloudField.sigmaOf(q, ice), ice, q
end

return CloudField
