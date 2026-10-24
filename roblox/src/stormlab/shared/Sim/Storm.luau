--!nonstrict
--!native
-- A convective storm cell (guide sections 11 and 13): one updraft with its own vertical structure,
-- mesocyclone, downdrafts, precipitation release, wall cloud and anvil. Ordinary cells,
-- multicell clusters, supercells (classic / HP / LP) and line cells are all this same object;
-- what they become comes out of the environment they sample and of their own precipitation and
-- outflow (no storm-type switch).
--
-- Main relations (all continuous, no thresholds on labels):
--   updraft target  W* = eta(Ru) sqrt(2 CAPE_inflow) x inhibition x cold-pool balance x loading
--                   (eta: entrainment, wider updrafts dilute less; inhibition: CIN against the lift
--                   available from boundaries, gust fronts and the storm's own rotation;
--                   loading: precipitation falling back into the updraft collapses it)
--   vertical shape  w(z) from the inflow parcel's buoyancy (sqrt of its integrated CAPE), an
--                   overshoot above the EL of ~W/N; footprint exp(-(r/Ru)^2); the column tilts
--                   with the storm-relative wind (less when rotating)
--   mid meso        V ~ 1.15 sqrt(SRH03 relative to the storm's OWN motion) x updraft strength
--   low meso        streamwise vorticity stretched by the low updraft (SRH01, LCL) + baroclinic
--                   generation along the forward-flank cold pool + pre-existing boundaries;
--                   suppressed where the outflow under it is too cold; occludes as the RFD wraps
--   motion          0-6 km mean wind + rotation x (Bunkers deviation): deviant motion emerges as
--                   the storm starts rotating; splitting gives a left mover whose survival
--                   depends on its own (negative) helicity
--   tornado         a genesis potential integrates near-ground stretching of the low-level
--                   circulation (with warm/moist RFD and low LCL) over minutes
local function dep(name: string): any
	if script then
		return require((script :: any).Parent:FindFirstChild(name))
	end
	return (require :: any)("./" .. name)
end
local Thermo = dep("Thermo")
local Noise = dep("Noise")

local Storm = {}

local exp, sqrt, cos, sin, atan2 = math.exp, math.sqrt, math.cos, math.sin, math.atan2
local DZ = 250
local NZ = 65

local function ramp(x: number, a: number, b: number): number
	return math.clamp((x - a) / (b - a), 0, 1)
end

local function rot2(x: number, y: number, a: number): (number, number)
	local c, s = cos(a), sin(a)
	return x * c - y * s, x * s + y * c
end

export type Storm = { [string]: any }

local nextId = 0

-- A new storm. o: { x, y, u, v, W, Ru, seed, vmid, vlow, age, leftMover, engineId }
function Storm.new(o: { [string]: any }): Storm
	nextId += 1
	local s: Storm = {
		id = o.id or string.format("C%03d", nextId),
		engineId = o.engineId,
		x = o.x, y = o.y,
		u = o.u or 10, v = o.v or 5,
		age = o.age or 0,
		seed = o.seed or nextId * 7717,
		W = o.W or 2,
		Ru = o.Ru or 1200,
		vmid = o.vmid or 0,
		vlow = o.vlow or 0,
		occl = 0,
		cycle = 0,
		lowAngle = -2.1, -- the low meso's bearing from the updraft centre, relative to motion
		leftMover = o.leftMover or false,
		split = o.split or false,
		G = 0,
		tornado = nil,
		dead = false,
		deadFor = 0,
		weakFor = 0,
		anvilLen = o.anvilLen or 0,
		anvilU = 1, anvilV = 0,
		rfd = 0, ffd = 0, rfdDeficit = 0,
		lowering = 0,
		loading = 0,
		envAge = math.huge,
		precipRate = 0,
		lightning = 0,
		lastPrecip = 0,
		hailMax = 0,
		rot = 0,
		kind = o.kind or "cell",
		systemId = nil,
		-- filled by Storm.environment
		wprof = table.create(NZ, 0),
		tiltX = table.create(NZ, 0),
		tiltY = table.create(NZ, 0),
		base = 1200, el = 10000, top = 11000, freezing = 4000,
		cape = 0, cin = 0, srh01 = 0, srh03 = 0, shear06 = 0, lcl = 1200, pw = 25,
		meanU = 10, meanV = 5, devU = 0, devV = 0, leftU = 0, leftV = 0,
		upperU = 20, upperV = 0, qBase = 0.012, rhMid = 0.5,
	}
	return s
end

-- The inflow point: upstream of the updraft along the storm-relative low-level wind.
local function inflowPoint(s: Storm, env: any): (number, number)
	local eu, ev = env:windAt(s.x, s.y, 500)
	local ru, rv = eu - s.u, ev - s.v
	local m = sqrt(ru * ru + rv * rv)
	if m < 0.5 then
		return s.x, s.y
	end
	local d = 0.9 * s.Ru + 3000
	return s.x - ru / m * d, s.y - rv / m * d
end
Storm.inflowPoint = inflowPoint

-- Refresh what the storm feeds on (every ~20 s of sim time): the inflow profile's parcels,
-- the updraft's vertical structure and tilt, helicity relative to its own motion.
function Storm.environment(s: Storm, world: any)
	local env = world.env
	local ix, iy = inflowPoint(s, env)
	local prof = env:profileAt(ix, iy)
	local sb = Thermo.parcel(prof, "sb")
	local mu = Thermo.parcel(prof, "mu")
	-- surface-based if the surface parcel has the energy, else elevated (above a cold pool)
	local surfaceBased = sb.cape >= 0.6 * mu.cape
	local par = if surfaceBased then sb else mu
	s.surfaceBased = surfaceBased
	s.cape = par.cape * (if surfaceBased then 1 else 0.75)
	s.cin = par.cin
	s.lcl = sb.lclZ
	s.base = math.clamp(par.lclZ, 150, 4000)
	s.el = par.elZ or (s.base + 2000)
	s.lfc = par.lfcZ or 6000
	local a = Thermo.analyse(prof)
	s.shear06 = a.shear06
	s.meanU, s.meanV = a.meanU, a.meanV
	s.devU, s.devV = a.rightU - a.meanU, a.rightV - a.meanV
	s.leftU, s.leftV = a.leftU - a.meanU, a.leftV - a.meanV
	s.freezing = a.freezingZ
	s.pw = a.pw
	s.lapse75 = a.lapse75
	-- helicity relative to the storm's actual motion
	s.srh01 = Thermo.srh(prof, 1000, s.u, s.v)
	s.srh03 = Thermo.srh(prof, 3000, s.u, s.v)
	-- water vapour at cloud base, mid-level humidity, anvil-level storm-relative wind
	s.qBase = Thermo.mixingRatio(Thermo.at(prof, "td", 0), Thermo.at(prof, "p", 0))
	local z5 = 5000
	s.rhMid = Thermo.es(Thermo.at(prof, "td", z5)) / Thermo.es(Thermo.at(prof, "t", z5))
	local zu = math.clamp(s.el - 1000, 6000, 14000)
	local uu, uv = Thermo.windAt(prof, zu)
	s.upperU, s.upperV = uu, uv
	-- updraft profile: parcel speed sqrt(2 g int B / Tv dz) per 250 m level, normalised
	local acc, peak = 0, 0
	local wraw = table.create(NZ, 0)
	local b = par.buoyancy
	for k = 1, NZ do
		local z = (k - 1) * DZ
		local bi = b[math.min(#b, math.floor(z / Thermo.STEP) + 1)] or 0
		if z >= s.base then
			acc = math.max(0, acc + 9.81 * bi / 290 * DZ)
		end
		wraw[k] = sqrt(2 * acc)
		peak = math.max(peak, wraw[k])
	end
	peak = math.max(peak, 1)
	-- overshoot above the EL: decelerates over ~W/N (N ~ 0.02 /s)
	local overshoot = math.clamp(s.W / 0.02, 300, 2500)
	s.top = math.min(16000, s.el + overshoot)
	for k = 1, NZ do
		local z = (k - 1) * DZ
		local f = wraw[k] / peak
		if z < s.base then
			-- below the base the inflow is drawn up: speed grows toward the base
			f = (wraw[math.floor(s.base / DZ) + 2] or 0.3) / peak * (z / s.base) ^ 0.7
			f = math.max(f, 0.25 * (z / s.base))
		elseif z > s.el then
			f = (wraw[math.floor(s.el / DZ) + 1] or 0) / peak * math.max(0, 1 - (z - s.el) / math.max(200, s.top - s.el))
		end
		s.wprof[k] = math.clamp(f, 0, 1)
	end
	-- tilt: air rises at w while drifting with the storm-relative wind; rotation stiffens it
	local tx, ty = 0, 0
	local stiff = 1 - 0.55 * s.rot
	for k = 1, NZ do
		local z = (k - 1) * DZ
		if z > s.base then
			local wz = math.max(8, s.W * s.wprof[k])
			local eu, ev = Thermo.windAt(prof, z)
			tx += (eu - s.u) / wz * DZ * stiff
			ty += (ev - s.v) / wz * DZ * stiff
			local lim = 0.8 * (z - s.base)
			local m = sqrt(tx * tx + ty * ty)
			if m > lim then
				tx, ty = tx / m * lim, ty / m * lim
			end
		end
		s.tiltX[k], s.tiltY[k] = tx, ty
	end
	s.envAge = 0
	s.prof = prof
	s.profVersion = (s.profVersion or 0) + 1
end

local function wprofAt(s: Storm, z: number): (number, number, number)
	local kz = math.clamp(z / DZ + 1, 1, NZ - 0.001)
	local k = math.floor(kz)
	local f = kz - k
	return s.wprof[k] + (s.wprof[k + 1] - s.wprof[k]) * f, s.tiltX[k] + (s.tiltX[k + 1] - s.tiltX[k]) * f, s.tiltY[k] + (s.tiltY[k + 1] - s.tiltY[k]) * f
end
Storm.wprofAt = wprofAt

local function updraftRadiusAt(s: Storm, z: number): number
	return s.Ru * (0.65 + 0.55 * math.clamp(z / math.max(3000, s.el), 0, 1.2))
end
Storm.updraftRadiusAt = updraftRadiusAt

-- unit vector of the storm's motion (or east when still)
local function heading(s: Storm): (number, number)
	local m = sqrt(s.u * s.u + s.v * s.v)
	if m < 0.5 then
		return 1, 0
	end
	return s.u / m, s.v / m
end
Storm.heading = heading

-- Where the circulations sit (offsets from the updraft base centre):
--   low meso: at the rear-right flank (bearing lowAngle from motion), 0.5 Ru out
--   mid meso: over the tilted updraft at 5 km, a little to the rear-right
function Storm.lowMesoAt(s: Storm): (number, number)
	local hx, hy = heading(s)
	local ang = s.lowAngle * (if s.leftMover then -1 else 1)
	local ox, oy = rot2(hx, hy, ang)
	local r = 0.5 * s.Ru
	return s.x + ox * r, s.y + oy * r
end

function Storm.midMesoAt(s: Storm, z: number): (number, number)
	local _, tx, ty = wprofAt(s, z)
	local hx, hy = heading(s)
	local ox, oy = rot2(hx, hy, -2.4 * (if s.leftMover then -1 else 1))
	return s.x + tx + ox * 0.15 * s.Ru, s.y + ty + oy * 0.15 * s.Ru
end

-- forward-flank (the main precipitation region downwind) and rear-flank downdraft centres
function Storm.ffdAt(s: Storm): (number, number)
	local hx, hy = heading(s)
	-- precipitation falls out where the mid/upper storm-relative wind carries it
	local ru, rv = s.upperU - s.u, s.upperV - s.v
	local m = sqrt(ru * ru + rv * rv)
	if m > 1 then
		ru, rv = ru / m, rv / m
	else
		ru, rv = hx, hy
	end
	local d = s.Ru * (1.1 + 0.03 * math.min(m, 40))
	return s.x + ru * d, s.y + rv * d
end

function Storm.rfdAt(s: Storm): (number, number)
	local lx, ly = Storm.lowMesoAt(s)
	local hx, hy = heading(s)
	local ang = (s.lowAngle - 0.6) * (if s.leftMover then -1 else 1)
	local ox, oy = rot2(hx, hy, ang)
	return lx + ox * 0.35 * s.Ru, ly + oy * 0.35 * s.Ru
end

-- Vertical air speed of the storm's updraft at (x, y, z) (m/s).
function Storm.updraftAt(s: Storm, x: number, y: number, z: number): number
	if s.dead or s.W < 0.5 then
		return 0
	end
	local f, tx, ty = wprofAt(s, z)
	local ru = updraftRadiusAt(s, z)
	local dx, dy = x - (s.x + tx), y - (s.y + ty)
	local r2 = (dx * dx + dy * dy) / (ru * ru)
	if r2 > 9 then
		return 0
	end
	return s.W * f * exp(-r2)
end

-- Rotational wind of a modified-Rankine circulation (alpha 0.6) at radius r, core R, peak V
local function rankine(V: number, r: number, R: number): number
	local q = r / R
	if q <= 1 then
		return V * q
	end
	return V * q ^ -0.6
end

-- Work out once per storm step what Storm.windAt needs (circulation centres, base numbers), so
-- the many wind queries a step (precipitation parcels, radar, debris) don't redo it.
function Storm.prepare(s: Storm)
	s.cLowX, s.cLowY = Storm.lowMesoAt(s)
	local hx, hy = heading(s)
	local ox, oy = rot2(hx, hy, -2.4 * (if s.leftMover then -1 else 1))
	s.cMidOX, s.cMidOY = ox * 0.15 * s.Ru, oy * 0.15 * s.Ru
	s.cFfdX, s.cFfdY = Storm.ffdAt(s)
	s.cRfdX, s.cRfdY = Storm.rfdAt(s)
	s.cRb = updraftRadiusAt(s, s.base)
	s.cFb = wprofAt(s, s.base)
	s.cRt = updraftRadiusAt(s, s.el)
	s.cReach = 4.5 * s.Ru + 5000
end

-- the downdraft term of Storm.windAt: sinking air and the outflow it spreads at the ground
local function downdraftWind(x: number, y: number, z: number, cx: number, cy: number, wd: number, R: number): (number, number, number)
	local dx, dy = x - cx, y - cy
	local r2 = (dx * dx + dy * dy) / (R * R)
	if r2 > 16 then
		return 0, 0, 0
	end
	local u, v, w = 0, 0, 0
	if z < 5000 then
		w = -wd * exp(-r2) * math.min(1, z / 300 + 0.05) * (1 - z / 5000)
	end
	if z < 600 and r2 > 1e-8 then
		-- divergent outflow: peaks ~R from the centre, strongest at ~50 m
		local r = sqrt(r2)
		local ur = 1.4 * wd * r * exp(0.5 - 0.5 * r2) * math.min(1, (z + 3) / 50) * (1 - z / 600)
		u = ur * dx / (r * R)
		v = ur * dy / (r * R)
	end
	return u, v, w
end

-- The storm's own air motion (perturbation over the environment) at (x, y, z).
function Storm.windAt(s: Storm, x: number, y: number, z: number): (number, number, number)
	local W = if s.dead then 0 else s.W
	local reach = s.cReach
	if not reach then
		Storm.prepare(s)
		reach = s.cReach
	end
	local ddx, ddy = x - s.x, y - s.y
	if ddx * ddx + ddy * ddy > reach * reach then
		return 0, 0, 0
	end
	local u, v, w = 0, 0, 0
	-- updraft and the mass it moves (inflow below the base, outflow under the anvil)
	if W > 0.5 then
		local f, tx, ty = wprofAt(s, z)
		local ru = updraftRadiusAt(s, z)
		local dx, dy = x - (s.x + tx), y - (s.y + ty)
		local r = sqrt(dx * dx + dy * dy)
		local q = r / ru
		w += W * f * exp(-q * q)
		local rb = s.cRb
		local wb = W * s.cFb
		if z < s.base and r > 1 then
			-- a line sink below the base: u_r = -wb rb^2 / (2 r h) (continuity), tapered far out
			local ur = -wb * rb * rb / (2 * r * s.base) * (1 - exp(-(r / rb) ^ 2)) * exp(-(r / (7 * rb)) ^ 2)
			local surf = math.min(1, (z + 3) / 40)
			u += ur * dx / r * surf
			v += ur * dy / r * surf
		elseif z > 0.75 * s.top and z < s.top + 500 and r > 1 then
			local h = 0.25 * s.top
			local rt = s.cRt
			local ur = wb * rb * rb / (2 * r * h) * (1 - exp(-(r / rt) ^ 2)) * exp(-(r / (12 * rt)) ^ 2)
			local fz = sin(math.pi * math.clamp((z - 0.75 * s.top) / (0.25 * s.top + 500), 0, 1))
			u += ur * dx / r * fz
			v += ur * dy / r * fz
		end
	end
	-- mesocyclone: low-level circulation below ~1.5 km, mid-level 3-8 km, blended between
	local sign = if s.leftMover then -1 else 1
	if math.abs(s.vlow) > 0.5 or math.abs(s.vmid) > 0.5 then
		local lx, ly = s.cLowX, s.cLowY
		local _, mtx, mty = wprofAt(s, math.max(z, 3000))
		local mx, my = s.x + mtx + s.cMidOX, s.y + mty + s.cMidOY
		local blend = ramp(z, 1200, 3500)
		local cx, cy = lx + (mx - lx) * blend, ly + (my - ly) * blend
		local Vr = s.vlow + (s.vmid - s.vlow) * blend
		local R = (0.3 * s.Ru) + (0.45 * s.Ru - 0.3 * s.Ru) * blend
		local aloft = 1 - ramp(z, 0.8 * s.top, s.top)
		local ground = math.min(1, (z + 2) / 30)
		local dx, dy = x - cx, y - cy
		local r = sqrt(dx * dx + dy * dy)
		if r > 1 and r < 12 * R then
			local vt = rankine(Vr, r, R) * aloft * ground * exp(-(r / (8 * R)) ^ 2)
			-- cyclonic for right movers (counter-clockwise), anticyclonic for left movers
			u += -vt * dy / r * sign
			v += vt * dx / r * sign
		end
	end
	-- downdrafts: sinking air in the FFD and RFD and the outflow it spreads at the ground
	if z < 5000 then
		if s.ffd > 0.3 then
			local du, dv, dw = downdraftWind(x, y, z, s.cFfdX, s.cFfdY, s.ffd, 0.9 * s.Ru)
			u += du
			v += dv
			w += dw
		end
		if s.rfd > 0.3 then
			local du, dv, dw = downdraftWind(x, y, z, s.cRfdX, s.cRfdY, s.rfd, 0.35 * s.Ru)
			u += du
			v += dv
			w += dw
		end
	end
	return u, v, w
end

-- How much lift (J/kg) is available to push inflow air through its CIN.
local function liftEnergy(s: Storm, world: any, ix: number, iy: number): number
	local cp = world.coldPool
	local e = 0
	-- the storm's own gust front lifting the inflow (mature storms)
	local edge = cp.EDGE:sample(ix, iy)
	local c = sqrt(cp.VU:sample(ix, iy) ^ 2 + cp.VV:sample(ix, iy) ^ 2)
	e += 0.5 * (edge * c) ^ 2
	-- boundary-layer convergence (dryline, fronts): w ~ -div x 1.5 km, sustained ~20 min
	local conv = world:convergenceAt(ix, iy)
	local wl = math.max(0, conv) * 1500
	e += wl * 1200 * 0.04 -- lift displacement x a small buoyancy penalty per metre
	-- dynamic lifting by the rotating updraft (low pressure aloft in the mesocyclone)
	e += 0.5 * (0.6 * math.abs(s.vmid)) ^ 2
	-- an established updraft keeps lifting its inflow
	e += 0.5 * (0.2 * s.W) ^ 2
	return e
end

-- Advance the storm dt seconds.
function Storm.step(s: Storm, dt: number, world: any)
	s.age += dt
	s.envAge += dt
	if s.dead then
		s.deadFor += dt
		s.anvilLen = math.max(0, s.anvilLen - 4 * dt)
		s.W = s.W * exp(-dt / 400)
		s.ffd *= exp(-dt / 900)
		s.rfd *= exp(-dt / 300)
		s.vmid *= exp(-dt / 900)
		s.vlow *= exp(-dt / 300)
		s.x += s.u * dt
		s.y += s.v * dt
		Storm.prepare(s)
		return
	end
	if s.envAge > 30 then
		Storm.environment(s, world)
	end
	local env, cp = world.env, world.coldPool
	local ix, iy = inflowPoint(s, env)
	local ru = s.Ru

	-- updraft
	local inhib = 1
	if s.cin < -1 then
		local L = liftEnergy(s, world, ix, iy)
		inhib = math.clamp((L + 10) / (-s.cin + 10), 0, 1) ^ 0.5
	end
	local eta = 0.85 * ru / (ru + 1500)
	-- cold-pool / shear balance (RKW): an outflow far stronger than the low-level shear
	-- undercuts and tilts the updraft back over the cold air
	local c = math.sqrt(cp.VU:sample(s.x, s.y) ^ 2 + cp.VV:sample(s.x, s.y) ^ 2)
	local u0, v0 = env:windAt(s.x, s.y, 0)
	local u3, v3 = env:windAt(s.x, s.y, 3000)
	local du = math.max(3, sqrt((u3 - u0) ^ 2 + (v3 - v0) ^ 2))
	s.rkw = c / du
	local balance = 1 - 0.35 * math.clamp(s.rkw - 1.2, 0, 1.5)
	local loadF = 1 / (1 + 0.35 * s.loading)
	local Wt = eta * sqrt(2 * math.max(0, s.cape)) * inhib * balance * loadF * (1 + 0.12 * s.rot)
	local tau = if Wt > s.W then 360 else 600
	s.W += (Wt - s.W) * (1 - exp(-dt / tau))
	-- updraft width: grows with rotation and shear, toward a target over ~15 min
	-- (e-folding radius: a supercell's w > 10 m/s core ends up ~8-10 km across)
	local Rt = 1100 + 1700 * s.rot + 700 * ramp(s.shear06, 10, 30) + 600 * ramp(s.cape, 500, 3500)
	if s.W < 6 then
		Rt = math.min(Rt, 1800)
	end
	s.Ru += (Rt - s.Ru) * (1 - exp(-dt / 900))

	-- motion: mean wind + rotation-driven deviation (Bunkers), relaxing over ~10 min
	local tu, tv = s.meanU, s.meanV
	if s.leftMover then
		tu += s.rot * s.leftU
		tv += s.rot * s.leftV
	else
		tu += s.rot * s.devU
		tv += s.rot * s.devV
	end
	-- cells caught by a line's gust front ride with it (Systems sets lineU/V)
	if s.lineU then
		local share = s.lineShare or 0
		tu += (s.lineU - tu) * share
		tv += (s.lineV - tv) * share
	end
	s.u += (tu - s.u) * (1 - exp(-dt / 600))
	s.v += (tv - s.v) * (1 - exp(-dt / 600))
	s.x += s.u * dt
	s.y += s.v * dt

	-- mid-level mesocyclone from storm-relative helicity (signed: left movers spin anticyclonic)
	local srh3 = s.srh03 * (if s.leftMover then -1 else 1)
	local Vm = 1.15 * sqrt(math.max(0, srh3)) * math.clamp(s.W / 30, 0, 1.3)
	s.vmid += (Vm - s.vmid) * (1 - exp(-dt / 600))
	s.rot = ramp(s.vmid, 7, 17)

	-- low-level mesocyclone
	local lx, ly = Storm.lowMesoAt(s)
	local srh1 = s.srh01 * (if s.leftMover then -1 else 1)
	local fW = wprofAt(s, 1000)
	local wLow = s.W * fW + 0.5 * math.abs(s.vmid)
	local stretch = wLow / 1000
	local fLcl = math.clamp((2200 - s.lcl) / 1400, 0.15, 1)
	local Venv = 1.0 * sqrt(math.max(0, srh1)) * math.clamp(stretch / 0.02, 0, 1.2) * fLcl
	-- baroclinic generation along the forward-flank outflow edge (K/km over the low meso's left-front)
	local hx, hy = heading(s)
	local gx, gy = cp.D:gradient(lx + hx * 2000, ly + hy * 2000)
	local gradK = sqrt(gx * gx + gy * gy) * 1000
	local Vbc = 6 * math.clamp(gradK, 0, 2.5) * s.rot
	-- a pre-existing boundary (environmental surface temperature contrast) at the inflow
	local tgx, tgy = env.surfT:gradient(ix, iy)
	local Vbnd = 8 * math.clamp(sqrt(tgx * tgx + tgy * tgy) * 1000, 0, 1) * s.rot
	-- too-cold outflow under the circulation can't be stretched
	local dMeso = cp:deficitAt(lx, ly)
	local fCold = math.clamp(1 - (dMeso - 2.5) / 5, 0, 1)
	s.lowDeficit = dMeso
	-- the RFD wrapping in tightens the circulation (strongest mid-occlusion); once occluded it is
	-- cut off from warm inflow and weakens
	local fOcc = (1 + 0.5 * math.sin(math.pi * s.occl)) * (1 - 0.7 * ramp(s.occl, 0.8, 1))
	local Vl = (Venv + Vbc + Vbnd) * fCold * fOcc * s.rot
	s.vlow += (Vl - s.vlow) * (1 - exp(-dt / (if Vl > s.vlow then 360 else 240)))

	-- downdrafts: the FFD from the precipitation falling out downwind; the RFD forced by the
	-- low-level circulation's pressure field plus precipitation wrapping round the hook
	local fx, fy = Storm.ffdAt(s)
	local rainF = world.precip.rainRate:sample(fx, fy) -- mm/h
	local ffdT = math.clamp(rainF / 12, 0, 9)
	s.ffd += (ffdT - s.ffd) * (1 - exp(-dt / 300))
	local rx, ry = Storm.rfdAt(s)
	local hookRain = world.precip.rainRate:sample(rx, ry)
	local rfdT = 0.3 * math.abs(s.vlow) + 0.12 * math.abs(s.vmid) + math.clamp(hookRain / 20, 0, 4)
	rfdT *= s.rot
	s.rfd += (rfdT - s.rfd) * (1 - exp(-dt / 300))
	s.rfdDeficit = cp:deficitAt(rx, ry)
	-- the RFD gust front wraps round the low meso: occlusion, then a new circulation forms
	s.occl += dt * (s.rfd / 10) * s.rot / 1300
	s.lowAngle = -2.0 - 1.4 * s.occl
	if s.occl >= 1 then
		s.occl = 0
		s.cycle += 1
		s.vlow *= 0.35
		s.lowAngle = -2.0
	end

	-- wall cloud: inflow partly drawn from rain-cooled, moistened forward-flank outflow lowers
	-- the cloud base under the updraft (LCL of the mixed air), only where the updraft rotates
	local dF, mF = cp:deficitAt(fx * 0.5 + lx * 0.5, fy * 0.5 + ly * 0.5)
	local tS, tdS = env:surfaceAt(ix, iy)
	local mix = 0.45 * ramp(dF, 0.3, 3)
	local tM = tS - mix * dF
	local tdM = math.min(tM, tdS + mix * dF * 0.35 * mF)
	local lclMix = 125 * (tM - tdM)
	s.lowering = math.clamp(s.base - lclMix, 0, 0.6 * s.base) * s.rot
	s.wallBase = s.base - s.lowering

	-- anvil: spreads downstream at the anvil-level storm-relative wind
	local au, av = s.upperU - s.u, s.upperV - s.v
	local am = sqrt(au * au + av * av)
	if am > 0.5 then
		s.anvilU, s.anvilV = au / am, av / am
	end
	if s.W > 8 then
		s.anvilLen = math.min(160000, s.anvilLen + am * dt * 0.8)
	else
		s.anvilLen = math.max(0, s.anvilLen - 3 * dt)
	end

	-- precipitation production: condensate through the base x efficiency
	local rb = 0.6 * ru
	local massFlux = 1.05 * 0.25 * s.W * math.pi * rb * rb -- kg/s of air
	local eff = math.clamp(0.2 + 0.01 * s.pw + 0.25 * s.rhMid - 0.008 * math.max(0, am - 15), 0.12, 0.8)
	s.efficiency = eff
	s.precipRate = massFlux * s.qBase * 0.85 * eff
	s.condensate = massFlux * s.qBase * 0.85
	-- largest hail the updraft can carry through the growth zone (-10..-30 C, ~ freezing + 3 km)
	local fH = wprofAt(s, s.freezing + 3000)
	s.hailMax = math.clamp(0.7 * ((s.W * fH) / 14) ^ 2, 0, 15) * ramp(s.W, 15, 30)

	-- lightning: Deierling & Petersen (2008): f = 6.75e-11 V(w > 5 m/s) - 13.9 flashes/min
	local vol = 0
	if s.W > 5 then
		local rr = s.Ru * sqrt(math.log(s.W / 5))
		local depth = 0
		for k = 1, NZ do
			local z = (k - 1) * DZ
			if z > s.freezing + 800 and s.W * s.wprof[k] > 5 then
				depth += DZ
			end
		end
		vol = math.pi * rr * rr * depth
	end
	s.lightning = math.clamp(6.75e-11 * vol - 13.9, 0, 140)

	-- tornado genesis potential: near-ground stretching of the low-level circulation
	if not s.tornado then
		local rlow = 0.3 * ru
		local zeta = 2 * math.abs(s.vlow) / rlow
		local gamma = (zeta * stretch) / (0.02 * 0.02)
		local warmRfd = math.clamp(1 - (s.rfdDeficit - 1.5) / 3.5, 0, 1)
		local rfdHelps = 0.4 + 0.6 * ramp(s.rfd, 1, 6)
		local drive = gamma * warmRfd * rfdHelps * fLcl
		local wobble = 0.35 * Noise.value1(s.age / 240, s.seed + 5)
		s.genesisDrive = drive
		s.G = math.max(0, s.G + (drive + wobble - 0.8) * dt / 300)
	end

	-- weakening and death
	if s.W < 3 and s.age > 900 then
		s.weakFor += dt
	else
		s.weakFor = 0
	end
	if s.weakFor > 600 then
		s.dead = true
	end
	if s.pin then
		Storm.applyPin(s, dt)
	end
	Storm.prepare(s)
end

-- A lab storm (visual tests): its key fields are held at the pinned values so the scene is
-- repeatable; its rain, outflow, cold pool and tornado still come from the physics. pin: { W, Ru,
-- vmid, vlow, base, lowering, u, v, rearShare, vlowLater, laterAt }
function Storm.applyPin(s: Storm, dt: number)
	local p = s.pin
	p.t = (p.t or 0) + dt
	s.dead = false
	s.W = p.W or s.W
	s.Ru = p.Ru or s.Ru
	s.vmid = p.vmid or s.vmid
	local vlow = p.vlow or s.vlow
	if p.vlowLater and p.t >= (p.laterAt or 0) then
		vlow = p.vlowLater
	end
	s.vlow = vlow
	s.rot = ramp(s.vmid, 7, 17)
	if p.base then
		s.base = p.base
	end
	if p.lowering then
		s.lowering = p.lowering
	end
	s.wallBase = s.base - (s.lowering or 0)
	if p.u then
		s.u, s.v = p.u, p.v or 0
	end
	s.occl = p.occl or 0
	s.G = 0
	s.weakFor = 0
	if p.rfdDeficit then
		s.rfdDeficit = p.rfdDeficit
	end
end

-- Release this step's precipitation into the field (and anvil ice at the top).
function Storm.emitPrecip(s: Storm, dt: number, world: any)
	local precip = world.precip
	local rng = s.rng
	if not rng then
		rng = Noise.rng(s.seed)
		s.rng = rng
	end
	local m0 = precip:parcelMass()
	-- Precipitation grows inside the updraft but falls out at its edge: mostly on the downshear
	-- side (carried by the storm-relative wind at that height: the forward flank), some wrapped
	-- round the rear by the rotation (the hook). spread < 0: anywhere in the core (anvil ice).
	local function place(z: number, spread: number): (number, number)
		local _, tx, ty = wprofAt(s, z)
		local ru = updraftRadiusAt(s, z)
		if spread < 0 then
			local rr = ru * -spread * sqrt(-math.log(math.max(1e-6, rng:next())))
			local a = rng:next() * 2 * math.pi
			return s.x + tx + rr * cos(a), s.y + ty + rr * sin(a)
		end
		local eu, ev = s.u, s.v
		if s.prof then
			eu, ev = Thermo.windAt(s.prof, z)
		end
		local ru_, rv_ = eu - s.u, ev - s.v
		local downshear = atan2(rv_, ru_)
		if rng:next() < (if s.pin and s.pin.rearShare then s.pin.rearShare else 0.25 * s.rot) then
			-- the hook: precipitation swept round the low-level mesocyclone by its rotation, a
			-- crescent from its rear round its far side (rain wrapping a tornado comes from here)
			local lx, ly = s.cLowX or s.x, s.cLowY or s.y
			local hx, hy = heading(s)
			local back = atan2(-hy, -hx)
			local sgn = if s.leftMover then -1 else 1
			local a = back + sgn * rng:range(-1.6, 2.4)
			local rr = s.Ru * rng:range(0.18, 0.6)
			return lx + rr * cos(a), ly + rr * sin(a)
		end
		local a = downshear + rng:normal() * 0.9
		local rr = ru * spread * rng:range(1.25, 1.8)
		return s.x + tx + rr * cos(a), s.y + ty + rr * sin(a)
	end
	local rate = s.precipRate
	if s.dead then
		-- the decaying cell's ice keeps snowing out (trailing stratiform region)
		rate = (s.lastPrecip or 0) * exp(-s.deadFor / 1500)
	else
		s.lastPrecip = rate
	end
	local budget = rate * dt + (s.precipDebt or 0)
	local n = math.floor(budget / m0)
	s.precipDebt = budget - n * m0
	for _ = 1, math.min(n, 60) do
		local z
		if s.dead then
			z = rng:range(4500, 7500)
		else
			-- release height weighted by the updraft's strength (rejection sampling)
			-- most precipitation mass falls out of the middle levels (warm rain below the freezing
			-- level, graupel and hail above it)
			z = s.base + 500
			for _ = 1, 4 do
				local cand = rng:range(math.max(s.base + 400, 2500), math.max(s.base + 800, math.min(0.65 * s.el, 8000)))
				if rng:next() < wprofAt(s, cand) then
					z = cand
					break
				end
			end
		end
		local x, y = place(z, if s.dead then -2.2 else 1)
		local kind, size = 1, 0
		if z > s.freezing then
			kind = 2
			local ph = math.clamp((s.W - 12) / 35, 0, 0.6)
			if not s.dead and rng:next() < ph and s.hailMax > 0.6 then
				size = math.max(0.5, s.hailMax * rng:next() ^ 2)
			else
				size = rng:range(0.15, 0.4) -- graupel/snow aggregates: melt to rain
			end
		end
		precip:emit(x, y, z, m0, kind, size)
	end
	-- anvil ice: part of the condensate that did not precipitate, detrained near the EL
	if not s.dead and s.W > 8 then
		local ice = (s.condensate or 0) * (1 - (s.efficiency or 0.4)) * 0.12 * dt + (s.iceDebt or 0)
		local ni = math.floor(ice / m0)
		s.iceDebt = ice - ni * m0
		for _ = 1, math.min(ni, 20) do
			local z = rng:range(s.el - 1500, s.el)
			local x, y = place(z, -0.9)
			precip:emit(x, y, z, m0, 3, 0)
		end
	end
end

-- Split: a non-split storm growing in strong deep shear divides; the left part leaves with
-- the opposite rotation and a share of the updraft.
function Storm.maybeSplit(s: Storm, world: any): Storm?
	if s.split or s.dead or s.leftMover then
		return nil
	end
	if s.age < 900 or s.age > 3000 or s.W < 18 or s.shear06 < 18 then
		return nil
	end
	s.split = true
	local hx, hy = heading(s)
	local lx, ly = -hy, hx
	local child = Storm.new({
		x = s.x + lx * 2.5 * s.Ru, y = s.y + ly * 2.5 * s.Ru,
		u = s.u + s.leftU * 0.3, v = s.v + s.leftV * 0.3,
		W = s.W * 0.7, Ru = s.Ru * 0.8,
		vmid = -0.2 * s.vmid,
		leftMover = true, split = true,
		seed = s.seed + 13,
		age = s.age,
	})
	child.cape, child.cin = s.cape, s.cin
	return child
end

-- a compact snapshot for clients (replicated ~2 Hz): everything rendering and radar need
function Storm.snapshot(s: Storm): { [string]: any }
	local lx, ly = Storm.lowMesoAt(s)
	local fx, fy = Storm.ffdAt(s)
	local rx, ry = Storm.rfdAt(s)
	local snap = {
		id = s.id, kind = s.kind, x = s.x, y = s.y, u = s.u, v = s.v, age = s.age, seed = s.seed,
		W = s.W, Ru = s.Ru, base = s.base, el = s.el, top = s.top, freezing = s.freezing,
		vmid = s.vmid, vlow = s.vlow, rot = s.rot, occl = s.occl, cycle = s.cycle, lowAngle = s.lowAngle,
		leftMover = s.leftMover, dead = s.dead, deadFor = s.deadFor,
		lowX = lx, lowY = ly, ffdX = fx, ffdY = fy, rfdX = rx, rfdY = ry,
		ffd = s.ffd, rfd = s.rfd, rfdDeficit = s.rfdDeficit, lowering = s.lowering, wallBase = s.wallBase,
		anvilLen = s.anvilLen, anvilU = s.anvilU, anvilV = s.anvilV,
		precipRate = s.precipRate, hailMax = s.hailMax, lightning = s.lightning,
		G = s.G, tornado = s.tornado, cape = s.cape, cin = s.cin, srh01 = s.srh01, srh03 = s.srh03,
		shear06 = s.shear06, lcl = s.lcl, rkw = s.rkw, loading = s.loading, efficiency = s.efficiency,
		surfaceBased = s.surfaceBased, systemId = s.systemId,
		upperU = s.upperU, upperV = s.upperV, profVersion = s.profVersion,
	}
	return snap
end

-- Build a storm-like object from a snapshot (clients use it for Storm.windAt / updraftAt)
function Storm.fromSnapshot(snap: { [string]: any }): Storm
	return snap :: any
end

-- A storm from the engine's storm object (scripts/export-lab-scenario.mjs)
function Storm.fromEngine(e: any): Storm
	local feed = e.feed
	local s = Storm.new({
		engineId = e.id,
		x = e.pos[1], y = e.pos[2],
		u = e.motion[1], v = e.motion[2],
		W = math.clamp(e.updraftMs * 0.8, 5, 60),
		Ru = if feed and feed.updraft then math.clamp(feed.updraft.radiusKm * 1000 * 0.45, 1500, 7000) else 4000,
		vmid = 20 * math.clamp(e.meso, 0, 1.2),
		vlow = 18 * math.clamp(e.lowRotation, 0, 1.2),
		age = e.ageMin * 60,
		leftMover = e.leftMover,
		split = true,
		anvilLen = if feed and feed.anvil then feed.anvil.lengthKm * 1000 else 30000,
		seed = tonumber(string.sub(e.id, 2)) or 1,
	})
	s.rot = ramp(s.vmid, 7, 17)
	return s
end

return Storm
