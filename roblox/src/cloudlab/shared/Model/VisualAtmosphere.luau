--!strict
-- The visual atmosphere: ONE model, between a storm's client frame (ClientFrame.luau) and the views
-- that draw it (TornadoView, WallCloudView), of what the air near a tornado looks like - where it is
-- cloud and how dense, where it is dust, and how it moves. Display only: nothing here goes back to
-- the engine, the radar or damage (docs/visuals/RENDER-ARCHITECTURE.md). Every quantity comes from
-- the frame's fields by a stated relation; the few that the frame lacks are approximations, marked
-- APPROX below and listed in the doc.
--
--   vortex      the frame's tornado block: a Rankine core (radius R, pressure drop P) under the wall
--               cloud's base Bt, its tip where P no longer reaches (tip = Bt - P / (rho g)), leaning
--               by the frame's levels. Swirl V = sqrt(P / rho) (the engine's drop is rho V^2).
--   condensation  air rising in the vortex condenses where it passes its condensation level, lowered
--               by the drop there: zc(r) = Bt - p(r) / (rho g). Above zc the cloud holds liquid water
--               growing at the moist-adiabatic rate GAMMA_L (kg/kg a metre), so its extinction is
--               beta = 3 rho_air q_l / (2 rho_w r_e) (droplets of effective radius R_EFF). So a funnel
--               is not a hard tube: thin and see-through at its edge, where the air is only just
--               condensed, dense in its core and wherever it is long - the shape the drop gives.
--   swirl ratio S = R V / (r0 w): Davies-Jones' r0 Gamma / (2 Q) with Gamma = 2 pi R V (the core's
--               circulation), Q = pi r0^2 w (the updraught's flux, r0 its core radius and w its speed
--               over the tornado, the frame's updraught block). Laboratory vortices (Ward 1972, Church
--               et al. 1979) break down aloft from S ~ 0.2, touch down near 0.45, split into two
--               subvortices from ~0.8 and add one about every 0.35 to six. So the subvortices here
--               come from S, never from the EF rating or the wind alone. APPROX: that table, and the
--               subvortices' size and share of the circulation (SUB_*), are laboratory fits.
--   subvortices n(S) Rankine cores on the parent's radius of maximum wind, going round at half the
--               parent's angular speed there (as laboratory and radar subvortices do), each adding its
--               drop to the parent's, so each condenses where the parent alone does not.
--   flow        Rankine swirl, the surface layer's inflow (APPROX: radial inflow INFLOW_K of the swirl
--               below INFLOW_M, as in the corner flow) and the core's rise (APPROX: CORE_W_K of the
--               updraught over the tornado), for advecting what the views draw.
--   dust        where the ground-relative wind at the ground passes DUST_MS (the speed that lifts dry
--               soil and debris); the views carry it on the flow, and it thins with height.
--   noise       coherent, seeded value noise (the same on every client), sampled in flow-carried
--               coordinates, so structure is continuous in space and moves with the air instead of
--               being redrawn.
-- Every parameter is in VisualAtmosphere.CONFIG (the views read it each frame, so it can be tuned
-- live; workspace attributes named VA_<key> override numbers).
local VisualAtmosphere = {}
-- (ClientFrame, for the nest's planes; offline tests without `script` set it themselves)
VisualAtmosphere.ClientFrame = if (script :: any) ~= nil then require((script :: any).Parent:WaitForChild("ClientFrame")) :: any else nil

local G = 9.81
VisualAtmosphere.CONFIG = {
	RHO_G_DEFAULT = 11.5, -- rho g (Pa a metre) near the ground, when the frame's tip can't give it
	GAMMA_L = 2.0e-6, -- liquid water gained a metre above the condensation level (kg/kg/m; ~2 g/kg/km)
	R_EFF = 10e-6, -- droplets' effective radius (m)
	RHO_W = 1000,
	-- swirl ratio and subvortices (Church et al. 1979, laboratory)
	S_BREAKDOWN = 0.2, -- breakdown aloft from here: turbulence grows
	S_TURBULENT = 0.6, -- ...fully turbulent by here
	S_MULTI = 0.8, -- two subvortices from here
	S_PER_VORTEX = 0.35, -- one more each this much of S
	MAX_SUB = 6,
	SUB_FADE = 0.25, -- subvortices grow in over this much of S below S_MULTI
	SUB_SHARE = 0.5, -- a subvortex's swirl as a share of the parent's
	SUB_PARENT_LOSS = 0.4, -- the parent's drop lost to its subvortices at full strength
	SUB_SIZE = 0.06, -- a subvortex's core: this share of the spacing between them (2 pi R / n): ~0.12 R for three (radar and photogrammetry: tens of metres)
	SUB_ORBIT = 0.5, -- they go round at this share of the parent's angular speed at R
	-- flow (APPROX)
	INFLOW_K = 0.5, INFLOW_M = 120, -- surface-layer inflow: this share of the swirl, below this height
	CORE_W_K = 0.6, -- the core's rise: this share of the updraught over the tornado
	MIN_W = 8, -- (m/s; a frame without the updraught block)
	-- dust
	DUST_MS = 15,
	DUST_DEPTH_K = 1.2, -- dust thins upward over this many dust radii
	DUST_OUTER_K = 3.5, -- the dust's radius levels off toward this many core radii
	-- easing: the vortex the views draw follows the frame's with these time constants (s)
	TAU_SHAPE = 3, TAU_TIP = 4, TAU_S = 6,
	-- the light: the side of the funnel facing the open sky is brighter by up to this share
	SIDE_LIGHT = 0.35,
}
local C = VisualAtmosphere.CONFIG
function VisualAtmosphere.param(key: string): number
	local ws = (workspace :: any)
	local v = if ws then ws:GetAttribute("VA_" .. key) else nil
	if type(v) == "number" then return v end
	return (C :: any)[key]
end
local P_ = VisualAtmosphere.param

-- Coherent noise --------------------------------------------------------------------------------
local function hash(ix: number, iy: number, iz: number, seed: number): number
	local h = bit32.bxor(ix * 374761393, iy * 668265263, iz * 1274126177, seed * 2246822519)
	h = bit32.bxor(h, bit32.rshift(h, 13))
	h = (h * 1274126177) % 4294967296
	h = bit32.bxor(h, bit32.rshift(h, 16))
	return h / 4294967295 * 2 - 1
end
local function fade(t: number): number return t * t * t * (t * (t * 6 - 15) + 10) end
-- value noise in -1..1, smooth (C2) and continuous everywhere
function VisualAtmosphere.noise(x: number, y: number, z: number, seed: number): number
	local ix, iy, iz = math.floor(x), math.floor(y), math.floor(z)
	local fx, fy, fz = fade(x - ix), fade(y - iy), fade(z - iz)
	local function l(a: number, b: number, t: number): number return a + (b - a) * t end
	local x00 = l(hash(ix, iy, iz, seed), hash(ix + 1, iy, iz, seed), fx)
	local x10 = l(hash(ix, iy + 1, iz, seed), hash(ix + 1, iy + 1, iz, seed), fx)
	local x01 = l(hash(ix, iy, iz + 1, seed), hash(ix + 1, iy, iz + 1, seed), fx)
	local x11 = l(hash(ix, iy + 1, iz + 1, seed), hash(ix + 1, iy + 1, iz + 1, seed), fx)
	return l(l(x00, x10, fy), l(x01, x11, fy), fz)
end
-- octaves of it, each half the size and GAIN as strong (large scales dominate)
function VisualAtmosphere.fbm(x: number, y: number, z: number, seed: number, octaves: number, gain: number?): number
	local s, a, f, norm = 0, 1, 1, 0
	local g = gain or 0.45
	for o = 1, octaves do
		s += a * VisualAtmosphere.noise(x * f, y * f, z * f, seed + o * 1013)
		norm += a
		a *= g
		f *= 2.03
	end
	return s / norm
end

-- The vortex -------------------------------------------------------------------------------------
export type Vortex = {
	x: number, y: number, -- box m at the ground
	R: number, P: number, Bt: number, tip: number, rhoG: number, rho: number,
	V: number, mph: number, wTor: number, r0: number, S: number,
	levels: { any },
	mesoV: number, mesoR: number, -- the low-level mesocyclone (m/s, m), for the wall cloud's turn
}

-- The vortex the frame holds (nil without a tornado down).
function VisualAtmosphere.vortexFrom(f: any): Vortex?
	local t = f.tornado
	if not t or t.mph <= 0 or t.R <= 0 then return nil end
	local Bt = math.max(0, t.base)
	local rhoG = if t.tip > 0 and Bt > t.tip then t.drop / (Bt - t.tip) else P_("RHO_G_DEFAULT")
	local rho = rhoG / G
	local V = math.sqrt(math.max(0, t.drop) / rho)
	local up = f.updraught
	local wTor = if up then math.max(P_("MIN_W"), up.wTor) else P_("MIN_W")
	local r0 = if up then math.max(500, up.coreM) else 2000
	-- the mesocyclone over it: the frame's drop of it there (modelDrop: rho Vm^2 (1 - r^2 / 2 Rm^2),
	-- taken at the tornado, near its centre) and its 0-1 km spin (zeta = 2 Vm / Rm)
	local mesoV = math.sqrt(math.max(0, t.modelDrop) / rho)
	local mesoR = if t.zeta > 0 then 2 * mesoV / t.zeta else 1500
	return {
		x = t.x, y = t.y, R = t.R, P = t.drop, Bt = Bt, tip = t.tip, rhoG = rhoG, rho = rho, V = V, mph = t.mph,
		wTor = wTor, r0 = r0, S = t.R * V / (r0 * wTor), levels = t.levels, mesoV = mesoV, mesoR = math.clamp(mesoR, 300, 5000),
	}
end

-- Ease a drawn vortex toward the frame's (exponential, per step: no jumps when a frame comes).
local EASED: { [string]: string } = { x = "TAU_SHAPE", y = "TAU_SHAPE", R = "TAU_SHAPE", P = "TAU_SHAPE", Bt = "TAU_SHAPE", tip = "TAU_TIP", rhoG = "TAU_SHAPE", V = "TAU_SHAPE", wTor = "TAU_S", S = "TAU_S", mesoV = "TAU_S", mesoR = "TAU_S", mph = "TAU_SHAPE" }
function VisualAtmosphere.ease(cur: Vortex?, want: Vortex, dt: number): Vortex
	if not cur then return table.clone(want) end
	local out = table.clone(want)
	for k, tau in EASED do
		local a = 1 - math.exp(-dt / math.max(0.05, P_(tau)))
		;(out :: any)[k] = (cur :: any)[k] + a * ((want :: any)[k] - (cur :: any)[k])
	end
	out.rho = out.rhoG / G
	-- (the lean eased too: the same levels' offsets)
	if #cur.levels == #want.levels then
		local a = 1 - math.exp(-dt / math.max(0.05, P_("TAU_SHAPE")))
		local lv = {}
		for q, l in want.levels do
			local c = cur.levels[q]
			lv[q] = { z = c.z + a * (l.z - c.z), dx = c.dx + a * (l.dx - c.dx), dy = c.dy + a * (l.dy - c.dy), funnel = l.funnel }
		end
		out.levels = lv
	end
	return out
end

-- The pressure drop (Pa) of a Rankine core (radius R, centre drop P) at radius r.
function VisualAtmosphere.rankineDrop(r: number, R: number, P: number): number
	if R <= 0 or P <= 0 then return 0 end
	if r < R then return P * (1 - 0.5 * (r / R) ^ 2) end
	return 0.5 * P * (R / r) ^ 2
end
local rankineDrop = VisualAtmosphere.rankineDrop

-- The subvortices for swirl ratio S: count (continuous: the last one growing in) and strength 0..1.
function VisualAtmosphere.subvortices(v: Vortex): (number, number)
	local S = v.S
	local strength = math.clamp((S - (P_("S_MULTI") - P_("SUB_FADE"))) / P_("SUB_FADE"), 0, 1)
	strength = strength * strength * (3 - 2 * strength)
	local n = math.clamp(2 + (S - P_("S_MULTI")) / P_("S_PER_VORTEX"), 2, P_("MAX_SUB"))
	return n, strength
end

-- The parent's drop with its subvortices' share taken out.
local function parentP(v: Vortex): number
	local _, st = VisualAtmosphere.subvortices(v)
	return v.P * (1 - P_("SUB_PARENT_LOSS") * st)
end
VisualAtmosphere.parentP = parentP

-- A subvortex: its core radius (m), centre drop (Pa) and the angular speed of its orbit (rad/s).
function VisualAtmosphere.subvortex(v: Vortex, n: number, strength: number): (number, number, number)
	local Rs = P_("SUB_SIZE") * 2 * math.pi * v.R / math.max(2, n)
	local Vs = P_("SUB_SHARE") * v.V * strength
	return Rs, v.rho * Vs * Vs, P_("SUB_ORBIT") * v.V / math.max(1, v.R)
end

-- The parent's condensation radius (m) at height z: where its drop reaches rho g (Bt - z). 0 below
-- the tip; near the base the need goes to nothing and it widens without bound (capped at flare R).
function VisualAtmosphere.funnelRadius(v: Vortex, z: number, flare: number?): number
	local P = parentP(v)
	if v.R <= 0 or P <= 0 then return 0 end
	local need = v.rhoG * math.max(0, v.Bt - z)
	if need >= P then return 0 end
	local r = if need >= P / 2 then v.R * math.sqrt(2 * (1 - need / P)) else v.R * math.sqrt(P / (2 * math.max(need, 1e-6)))
	return math.min(r, (flare or 4) * v.R)
end

-- Extinction (1/m) of cloud with liquid water from rising `above` metres past its condensation level.
function VisualAtmosphere.beta(above: number, rho: number): number
	if above <= 0 then return 0 end
	return 3 * rho * P_("GAMMA_L") * above / (2 * P_("RHO_W") * P_("R_EFF"))
end

-- The parent's cloud extinction at radius r, height z (1/m).
function VisualAtmosphere.parentBeta(v: Vortex, r: number, z: number): number
	local zc = v.Bt - rankineDrop(r, v.R, parentP(v)) / v.rhoG
	return VisualAtmosphere.beta(z - zc, v.rho)
end

-- The optical depth through the funnel along a chord at offset b (m) from its axis at height z,
-- integrated over `steps` points out to the condensation radius rc.
function VisualAtmosphere.chordTau(v: Vortex, z: number, b: number, rc: number, steps: number?): number
	if rc <= b then return 0 end
	local n = steps or 8
	local half = math.sqrt(rc * rc - b * b)
	local dl = 2 * half / n
	local tau = 0
	for q = 0, n - 1 do
		local s = -half + (q + 0.5) * dl
		tau += VisualAtmosphere.parentBeta(v, math.sqrt(s * s + b * b), z) * dl
	end
	return tau
end

-- The funnel axis's offset (m from the ground point) at height z, between the frame's levels.
function VisualAtmosphere.leanAt(lv: { any }, z: number): (number, number)
	if #lv == 0 then return 0, 0 end
	if z <= lv[1].z then
		local a = z / math.max(1, lv[1].z)
		return lv[1].dx * a, lv[1].dy * a
	end
	for k = 2, #lv do
		if z <= lv[k].z then
			local a = (z - lv[k - 1].z) / math.max(1, lv[k].z - lv[k - 1].z)
			return lv[k - 1].dx + a * (lv[k].dx - lv[k - 1].dx), lv[k - 1].dy + a * (lv[k].dy - lv[k - 1].dy)
		end
	end
	return lv[#lv].dx, lv[#lv].dy
end

-- The flow about the axis (m/s): swirl (counter-clockwise from above, the sign the views take
-- from spin), radial (negative inward) and rising, at radius r and height z.
function VisualAtmosphere.flow(v: Vortex, r: number, z: number): (number, number, number)
	local vt = if r <= v.R then v.V * r / math.max(1, v.R) else v.V * v.R / math.max(1, r)
	local inflow = -P_("INFLOW_K") * vt * math.exp(-z / P_("INFLOW_M"))
	local wCore = P_("CORE_W_K") * v.wTor
	local w = wCore * math.exp(-(r / math.max(1, 1.5 * v.R)) ^ 2)
	return vt, inflow, w
end

-- The radius (m) out to which the ground wind lifts dust: where the Rankine swirl plus the
-- tornado's motion on its fast side falls to DUST_MS (0 when even the core is slower).
function VisualAtmosphere.dustRadius(v: Vortex, groundMs: number?): number
	local peak = v.V + (groundMs or 0)
	local th = P_("DUST_MS")
	if peak <= th then return 0 end
	-- (the Rankine wind falls only as 1/r, but a few core radii out the flow is the parent's and the
	-- surface layer's, not the vortex's: the radius levels off smoothly toward DUST_OUTER_K radii -
	-- APPROX, from debris clouds 1.5-3 times the funnel's width)
	local r = v.R * peak / th
	local outer = (P_("DUST_OUTER_K") - 1) * v.R -- (beyond the core)
	return v.R + (r - v.R) * outer / (r - v.R + outer)
end

-- A turbulence strength 0..1 from S: a laminar single vortex (none) to a broken-down one (full).
function VisualAtmosphere.turbulence(v: Vortex): number
	local a = math.clamp((v.S - P_("S_BREAKDOWN")) / (P_("S_TURBULENT") - P_("S_BREAKDOWN")), 0, 1)
	return a * a * (3 - 2 * a)
end

-- The wall cloud (the nest's base lowered by its drop) ------------------------------------------
-- The lowered cloud base (m) at box point (x, y) from the nest (bilinear over its 250 m cells, so it
-- is continuous), the unlowered base there, and whether there is cloud: nil outside the nest.
function VisualAtmosphere.loweringAt(f: any, x: number, y: number, rhoG: number?): (number?, number)
	local n = f.nest
	local ClientFrame = VisualAtmosphere.ClientFrame
	if not n or not ClientFrame then return nil, 0 end
	local gi, gj = (x - n.X0) / n.dx + 0.5, (y - n.Y0) / n.dx + 0.5
	if gi < 1 or gj < 1 or gi > n.nx or gj > n.ny then return nil, 0 end
	local i0, j0 = math.floor(gi), math.floor(gj)
	local fi, fj = gi - i0, gj - j0
	local rg = rhoG or P_("RHO_G_DEFAULT")
	local lw, ub, wsum = 0, 0, 0
	for di = 0, 1 do
		for dj = 0, 1 do
			local i, j = math.min(n.nx, i0 + di), math.min(n.ny, j0 + dj)
			local w = (if di == 1 then fi else 1 - fi) * (if dj == 1 then fj else 1 - fj)
			local zb = ClientFrame.nestBaseM(f, i, j)
			if zb > 0 and w > 0 then
				local lowered = math.max(0, zb - ClientFrame.nestDropPa(f, i, j) / rg)
				lw += w * lowered
				ub += w * zb
				wsum += w
			end
		end
	end
	-- (cloud where most of the four cells have it: the edge is where that share passes a half)
	if wsum < 0.5 then return nil, 0 end
	return lw / wsum, ub / wsum
end

-- The low-level mesocyclone from the nest's drop when there is no tornado block: its centre drop
-- (rho Vm^2) is the largest, its radius where the drop halves (the Rankine drop at Rm is half the
-- centre's). Returns Vm (m/s), Rm (m), centre x, y (box m).
function VisualAtmosphere.mesoFromNest(f: any, rhoG: number?): (number, number, number, number)
	local n = f.nest
	local ClientFrame = VisualAtmosphere.ClientFrame
	if not n or not ClientFrame then return 0, 1500, f.anchorX, f.anchorY end
	local best, bi, bj = 0, 1, 1
	for i = 1, n.nx do
		for j = 1, n.ny do
			local d = ClientFrame.nestDropPa(f, i, j)
			if d > best then best, bi, bj = d, i, j end
		end
	end
	local rho = (rhoG or P_("RHO_G_DEFAULT")) / G
	if best <= 0 then return 0, 1500, f.anchorX, f.anchorY end
	local r = 1
	while bi + r <= n.nx and ClientFrame.nestDropPa(f, bi + r, bj) > best / 2 do r += 1 end
	return math.sqrt(best / rho), math.max(n.dx, (r - 0.5) * n.dx), n.X0 + (bi - 0.5) * n.dx, n.Y0 + (bj - 0.5) * n.dx
end

return VisualAtmosphere
