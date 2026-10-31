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
		lowAngle = 2.75, -- the low meso's bearing from the updraft centre, relative to motion (rad, CCW)
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
	if s.pin and s.pin.rhMid then
		s.rhMid = s.pin.rhMid -- (a lab scene's air mass: dry mid-levels, little water)
		s.pw = s.pin.pw or s.pw
	end
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
	-- (the speed the inflow arrives at the base with: drawn up below it, speed growing toward it)
	local fBase = math.max((wraw[math.floor(s.base / DZ) + 2] or 0.3) / peak, 0.25)
	s.fBase = fBase
	-- KNOWN ISSUE (2026-10-30): in the cloud the speed restarts from zero at the base (the profile
	-- falls ~0.22 -> 0.04 across it); by energy w^2 = w_base^2 + 2 int B dz it should keep the
	-- speed it arrived with. Fixing it doubled the squall line's tornadoes (17 -> 56 in 2 h) and
	-- made most EF5 - the tornadoes' supply (World.parentOf: wLow = W f(1000)) is calibrated on
	-- this profile - so it waits for the tornado refit (positioning plan item 5). Things that need
	-- the speed at the base use s.fBase, which is continuous.
	for k = 1, NZ do
		local z = (k - 1) * DZ
		local f = wraw[k] / peak
		if z < s.base then
			-- below the base the inflow is drawn up: speed grows toward the base
			f = fBase * (z / s.base) ^ 0.7
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
--   low meso: on the updraft's rear (upshear) edge, a little to its left, where the rear-flank
--             downdraft meets the edge of the forward-flank rain (the occlusion point; Lemon &
--             Doswell 1979, docs/stormlab/RESEARCH-SUPERCELL-LAYOUT.md): bearing lowAngle
--             (~160 deg from motion), 0.6 Ru out - the low-level updraft spreads to its
--             right-front, the rain core lies ahead / ahead-left of it
--   mid meso: over the tilted updraft at 5 km, a little to the rear-right
function Storm.lowMesoAt(s: Storm): (number, number)
	local hx, hy = heading(s)
	local ang = s.lowAngle * (if s.leftMover then -1 else 1)
	local ox, oy = rot2(hx, hy, ang)
	local r = 0.6 * s.Ru
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
	-- the forward-flank core: where Storm.emitPrecip lets the precipitation fall out - downshear
	-- of the updraft in the mid-level storm-relative wind (~5 km), a little to its left for a
	-- right mover, ~1.45 updraft radii out
	local eu, ev = s.upperU, s.upperV
	if s.prof then
		eu, ev = Thermo.windAt(s.prof, 5000)
	end
	local ru, rv = eu - s.u, ev - s.v
	local m = sqrt(ru * ru + rv * rv)
	if m > 1 then
		ru, rv = ru / m, rv / m
	else
		ru, rv = hx, hy
	end
	ru, rv = rot2(ru, rv, 0.3 * (if s.leftMover then -1 else 1))
	local _, tx, ty = wprofAt(s, 5000)
	local d = 1.45 * updraftRadiusAt(s, 5000)
	return s.x + tx + ru * d, s.y + ty + rv * d
end

function Storm.rfdAt(s: Storm): (number, number)
	local lx, ly = Storm.lowMesoAt(s)
	local hx, hy = heading(s)
	-- (directly behind the low meso, a little to its right: the clear slot on its rear side,
	-- wrapping S and E round it as it surges)
	local ang = (math.pi + 0.2) * (if s.leftMover then -1 else 1)
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

-- Rotational wind of a Rankine circulation at radius r, core R, peak V: solid body inside, a
-- potential vortex (1/r) outside. (Was alpha 0.6 with a tail to 8 R: the mesocyclone's winds
-- reached so far that rain falling for minutes was carried right round the storm, and the radar
-- showed a ring round the updraft instead of a forward-flank core and a hook:
-- docs/stormlab/structure/, 2026-10-26.)
local function rankine(V: number, r: number, R: number): number
	local q = r / R
	if q <= 1 then
		return V * q
	end
	return V / q
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

-- The rear-flank downdraft's outflow at the ground at (x, y) (m/s; Tornado.step: it pushes a
-- tornado's contact away from the meso aloft - the tilt that becomes a rope-out)
function Storm.rfdOutflow(s: Storm, x: number, y: number): (number, number)
	if (s.rfd or 0) <= 0.3 or not s.cRfdX then
		return 0, 0
	end
	-- (at 50 m, where the outflow peaks: a vortex is carried by the flow through its lowest few
	-- hundred metres, not by the surface-damped wind at 10 m - a quarter as strong)
	local u, v = downdraftWind(x, y, 50, s.cRfdX, s.cRfdY, s.rfd, 0.35 * s.Ru)
	return u, v
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
	-- the updraft as an obstacle to the upper-level flow: the storm-relative wind at anvil levels
	-- splits round the updraft core (flow round a cylinder: u - iv = conj(U) - U R^2 / z^2
	-- outside it; the air inside rises with the storm). Ice and precipitation released there are
	-- carried round both sides and downstream: the upper-level V-notch and the radar's "flying
	-- eagle" (Lemon 1998 on overshooting-top flow; docs/stormlab/structure/)
	if W > 0.5 and z > 0.5 * s.top and z < s.top + 500 then
		local _, tx, ty = wprofAt(s, z)
		local Rc = 1.2 * updraftRadiusAt(s, z)
		-- (the storm-relative wind at this height: the sounding's where the storm has one, else
		-- the anvil-level wind)
		local eu, ev = s.upperU or s.u, s.upperV or s.v
		if s.prof then
			eu, ev = Thermo.windAt(s.prof, z)
		end
		local Ux, Uy = eu - s.u, ev - s.v
		local dx, dy = x - (s.x + tx), y - (s.y + ty)
		local r2 = dx * dx + dy * dy
		local fz = ramp(z, 0.5 * s.top, 0.65 * s.top) * (1 - ramp(z, s.top - 300, s.top + 500))
		if fz > 0 then
			if r2 > Rc * Rc then
				-- A = U Rc^2 / zeta^2 (complex); the perturbation is u' = -Re A, v' = Im A
				local zr2 = dx * dx - dy * dy -- (zeta^2 = zr2 + i zi2)
				local zi2 = 2 * dx * dy
				local m = r2 * r2
				local ar = (Ux * zr2 + Uy * zi2) / m * Rc * Rc
				local ai = (Uy * zr2 - Ux * zi2) / m * Rc * Rc
				u += -ar * fz
				v += ai * fz
			else
				u -= Ux * fz
				v -= Uy * fz
			end
		end
	end
	-- dynamic lift under the low-level mesocyclone: its low pressure (~rho v^2 at the centre) pulls
	-- the air beneath it up - the strong low-level updraft of a supercell, on the inflow side of the
	-- low-level meso, 0.5-3 km up (Klemp & Rotunno 1983; Markowski & Richardson 2010 ch. 8)
	if W > 0.5 and z < 3500 and math.abs(s.vlow) > 3 and s.cLowX then
		local sr = sqrt((s.srU or 0) ^ 2 + (s.srV or 0) ^ 2)
		local ix, iy = 0, 0
		if sr > 1 then
			ix, iy = -(s.srU or 0) / sr, -(s.srV or 0) / sr -- (toward where the inflow comes from)
		end
		local Rl = 0.3 * s.Ru
		local cx, cy = s.cLowX + ix * 0.8 * Rl, s.cLowY + iy * 0.8 * Rl
		local dx, dy = x - cx, y - cy
		local q = (dx * dx + dy * dy) / (1.3 * Rl) ^ 2
		if q < 9 then
			local gz = sin(math.pi * math.clamp(z / 3500, 0, 1)) ^ 0.7
			w += 0.6 * math.min(math.abs(s.vlow), 0.5 * W) * gz * exp(-q)
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
		-- (the mesocyclone is a mid-level feature: gone by the anvil levels, where the flow splits
		-- evenly round the updraft instead of being turned one way)
		local aloft = 1 - ramp(z, 0.55 * s.top, 0.7 * s.top)
		local ground = math.min(1, (z + 2) / 30)
		local dx, dy = x - cx, y - cy
		local r = sqrt(dx * dx + dy * dy)
		if r > 1 and r < 6 * R then
			-- (the circulation is confined to the storm: a few core radii)
			local vt = rankine(Vr, r, R) * aloft * ground * exp(-(r / (3 * R)) ^ 2)
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
		if not world.holdStill then
			s.x += s.u * dt
			s.y += s.v * dt
		end
		Storm.prepare(s)
		return
	end
	if s.envAge > 30 then
		Storm.environment(s, world)
	end
	-- a storm the weather engine drives (the game: server/StormHost): its position, motion,
	-- updraft, size, rotation and occlusion are the engine's (Storm.followEngine); only what is
	-- drawn from them (rain, downdrafts, outflow, wall cloud, anvil, hail, lightning) is worked
	-- out here. own: the lab's own dynamics run (lab scenarios)
	local own = s.eng == nil
	if not own then
		Storm.followEngine(s, dt, world)
	end
	local env, cp = world.env, world.coldPool
	local ix, iy = inflowPoint(s, env)
	local ru = s.Ru
	-- the storm-relative low-level inflow (500 m): clients draw the inflow band along it
	do
		local eu, ev = env:windAt(s.x, s.y, 500)
		s.srU, s.srV = eu - s.u, ev - s.v
	end

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
	if own then
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
	end

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
	local fOcc = Storm.occlusionFactor(s.occl)
	local Vl = (Venv + Vbc + Vbnd) * fCold * fOcc * s.rot
	if own then
		s.vlow += (Vl - s.vlow) * (1 - exp(-dt / (if Vl > s.vlow then 360 else 240)))
	end

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
	-- (the rear-flank downdraft's own air into the cold pool, 2026-10-30: it only made wind
	-- before, so the pool had no rear-flank outflow, no rear-flank gust front and no triple point.
	-- Air from ~1.5 km - tornadic rear-flank air starts low, Markowski et al. 2002 - forced down
	-- at the RFD's speed, cooled only by the hook's rain evaporating into it)
	if s.rfd > 0.5 and s.prof and Storm.RFD_AIR ~= false then
		s.rfdAge = (s.rfdAge or math.huge) + dt
		if s.rfdAge >= 60 then
			s.rfdAge = 0
			s.rfdArrival = Thermo.downdraftArrival(s.prof, 1500, hookRain, s.rfd, true)
		end
		cp:addDowndraft(rx, ry, 0.35 * s.Ru, s.rfdArrival or 0, s.rfd, dt, 1, 0.6 + 0.3 * math.clamp(hookRain / 20, 0, 1))
	end
	s.rfdDeficit = cp:deficitAt(rx, ry)
	-- the RFD gust front wraps round the low meso: occlusion, then a new circulation forms
	-- (~45-60 min a cycle for a strong rear-flank downdraft: Burgess et al. 1982 / Adlerman &
	-- Droegemeier 2005, 40-90 min; docs/stormlab/RESEARCH-SUPERCELL-LIFECYCLE.md)
	-- (an engine storm's occlusion is the engine's: Storm.followEngine)
	if own then
		s.occl += dt * (s.rfd / 10) * s.rot / 2000
		-- (occluding, the old low meso drifts to the left-rear of the updraft, into the cold
		-- outflow; the next one forms back at the rear edge, right-front of the old)
		s.lowAngle = 2.75 - 1.0 * s.occl
		if s.occl >= 1 then
			s.occl = 0
			s.cycle += 1
			s.vlow *= 0.35
			s.lowAngle = 2.75
		end
	end

	-- wall cloud: the rotating updraft ingests some rain-cooled forward-flank outflow, and the
	-- mixture's condensation level is lower than the inflow's (Markowski & Richardson 2010 ch. 8;
	-- docs/stormlab/RESEARCH-WALLCLOUD-HV.md). The outflow air was cooled by evaporating rain
	-- along its wet-bulb line: cooled by the cold pool's deficit dF, its dew point rose in
	-- proportion, up to saturation at the wet-bulb temperature (Tw ~ T - (T - Td) / 3). The share
	-- ingested grows with the outflow's strength and the rotation drawing it in. So the lowering
	-- follows the environment's dew-point spread (its LCL) and the outflow: a moist, low-LCL day
	-- gives a wall cloud hanging close to the ground; a dry, high-LCL day a bigger lowering from a
	-- higher base, or none without outflow.
	-- (the outflow along the path from the forward flank to the low-level meso: its strongest)
	local dF = math.max(cp:deficitAt(fx * 0.5 + lx * 0.5, fy * 0.5 + ly * 0.5), cp:deficitAt(fx * 0.8 + lx * 0.2, fy * 0.8 + ly * 0.2), (cp:deficitAt(fx, fy)))
	local tS, tdS = env:surfaceAt(ix, iy)
	local spread = math.max(tS - tdS, 0)
	local tw = tS - spread / 3
	local p = math.clamp(dF / math.max(tS - tw, 0.3), 0, 1) -- (how far toward saturation)
	local tO = tS - dF
	local tdO = math.min(tO, tdS + p * (tw - tdS))
	-- (how much of it the updraft can take in: outflow air is negatively buoyant, and only what
	-- the low-level lift can raise through the cold pool's depth h joins the updraft. Its negative
	-- buoyancy over the pool, NB ~ 1/2 g (dF / theta) h, against the lift: the low meso's pressure
	-- deficit (~vlow^2 per unit mass, Rankine) and the updraft's own pull at the base (w_b^2 / 2).
	-- So a cold, deep outflow (6-7 K, NB ~170 J/kg) is mostly undercut and a weak one (1-3 K) taken
	-- in - "intermediate cold pools are best", and tornadic storms show deficits <~ 2-4 K near the
	-- meso (Markowski et al. 2002; docs/stormlab/research/SUPERCELL-STRUCTURE-RESEARCH.md). Before
	-- 2026-10-30 any outflow over 2.5 K was taken in at the full 0.6 share, the outflow being
	-- saturated, and the lowering came out ~0.6 x the base every time - 1 km below a 1.7 km base)
	local hF = cp.depthOf(dF)
	local NB = 0.5 * 9.81 * dF / 300 * hF
	local wb = (if s.dead then 0 else s.W) * (s.fBase or 0.25)
	local lift = s.vlow * s.vlow + 0.5 * wb * wb
	local liftable = lift / (lift + NB + 1)
	local mShare = 0.6 * ramp(dF, 0.2, 2.5) * liftable * math.clamp(s.rot, 0, 1)
	local tM = tS + mShare * (tO - tS)
	local tdM = math.min(tM, tdS + mShare * (tdO - tdS))
	local lclMix = 125 * (tM - tdM)
	-- plus, near the rotation centre, the low-level mesocyclone's pressure deficit: a Rankine
	-- vortex's central deficit rho v^2 lowers the condensation level by dp / (rho g) = v^2 / g
	-- (Atkins et al. 2013: extra lowering under a >10 hPa deficit; docs/stormlab/RESEARCH-WALLCLOUD-HV.md)
	local dynLower = s.vlow * s.vlow / 9.81
	-- (measured against the inflow's own condensation level, so the two use the same air)
	-- (the terms, for tools/stormlab/diag_wallcloud.luau)
	s.lowMix, s.lowDyn, s.lowDF, s.lowShare, s.lowNB, s.lowLift = 125 * spread - lclMix, dynLower, dF, mShare, NB, lift
	-- (0.85 x the base: only a safety limit so the wall cloud never reaches the ground - the
	-- physics sets it, 0.3-0.6 km on the Supercell scenario, 2026-10-30; the old 0.6 cap was
	-- what set it before)
	s.lowering = math.clamp(125 * spread - lclMix + dynLower, 0, 0.85 * s.base) * s.rot
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

	-- tornado genesis potential: near-ground stretching of the low-level circulation (an engine
	-- storm's tornadoes are the engine's)
	if own and not s.tornado then
		local rlow = 0.3 * ru
		local zeta = 2 * math.abs(s.vlow) / rlow
		local gamma = (zeta * stretch) / (0.02 * 0.02)
		local warmRfd = math.clamp(1 - (s.rfdDeficit - 1.5) / 3.5, 0, 1)
		local rfdHelps = 0.4 + 0.6 * ramp(s.rfd, 1, 6)
		local drive = gamma * warmRfd * rfdHelps * fLcl
		-- (Storm.GENESIS_EASE: the lab's boost, LabConfig.GENESIS_EASE - the lab's scenarios should
		-- make tornadoes to look at; the Supercell day's own drive tops out at ~0.7 of the 0.8 needed.
		-- It lifts weak drives up to 1.5 and leaves stronger ones alone, so days that already make
		-- tornadoes don't make far more)
		local ease = Storm.GENESIS_EASE or 1
		if ease > 1 then
			drive = math.max(drive, math.min(drive * ease, 1.5))
		end
		local wobble = 0.35 * Noise.value1(s.age / 240, s.seed + 5)
		s.genesisDrive = drive
		s.G = math.max(0, s.G + (drive + wobble - 0.8) * dt / 300)
	end

	-- weakening and death (an engine storm dies when the engine drops it: server/StormHost)
	if own and s.W < 3 and s.age > 900 then
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

-- Whether a low-level circulation that has organised (G >= 1) makes a tornado this occlusion cycle:
-- one chance a cycle, its odds rising with the circulation's strength. Most strong low-level
-- mesocyclones make no tornado (about a quarter of mesocyclones are tornadic, Trapp et al. 2005;
-- the odds climb with the low-level rotational velocity, Smith et al. 2015 / Thompson et al. 2017 -
-- the curve here is an approximate fit, the papers' tables could not be read). Before 2026-10-30
-- every circulation passing the organisation threshold made one: on the squall-line day all ~35
-- rotating cells did, 84 tornadoes in 2 h. OFF by default since the same day (the lab wants its
-- scenarios to make tornadoes; count realism doesn't matter there): Storm.GENESIS_ODDS = true turns
-- it on.
function Storm.genesisChance(s: Storm): number
	-- vlow (m/s, ~ the radar's rotational velocity): ~12% at 15 m/s, ~36% at 25, ~60% at 35
	return 0.6 * math.clamp((math.abs(s.vlow) - 10) / 25, 0, 1)
end
function Storm.genesisTry(s: Storm): boolean
	if Storm.GENESIS_ODDS ~= true then
		return true
	end
	if s.tryCycle ~= s.cycle then
		s.tryCycle = s.cycle
		-- (a fixed draw per storm and cycle: reproducible from the storm's seed)
		local h = math.sin((s.seed or 0) * 12.9898 + (s.cycle or 0) * 78.233) * 43758.5453
		s.tryOk = (h - math.floor(h)) < Storm.genesisChance(s)
	end
	return s.tryOk == true
end

-- The low-level circulation through an occlusion cycle (0-1), as a factor on what the environment
-- feeds it: the RFD wrapping in tightens it (strongest mid-occlusion); once occluded it is cut off
-- from warm inflow and weakens.
function Storm.occlusionFactor(occl: number): number
	return (1 + 0.5 * math.sin(math.pi * occl)) * (1 - 0.7 * ramp(occl, 0.8, 1))
end

-- A lab storm (visual tests): its key fields are held at the pinned values so the scene is
-- repeatable; its rain, outflow, cold pool and tornado still come from the physics. pin: { W, Ru,
-- vmid, vlow, base, lowering, u, v, rearShare, vlowLater, laterAt, occl, evolve }
-- evolve: vlow, occl and rfdDeficit are only where the storm starts; Storm.step runs them from
-- there (the RFD wrapping round, the low meso carried into the cold rear-left and cut off, the
-- air under it from the cold pool), so its tornado lives the life its storm gives it.
-- (World.labScene runs such a scene as the world, then pins what it reached for the hold.)
function Storm.applyPin(s: Storm, dt: number)
	local p = s.pin
	p.t = (p.t or 0) + dt
	s.dead = false
	s.W = p.W or s.W
	s.Ru = p.Ru or s.Ru
	s.vmid = p.vmid or s.vmid
	s.rot = ramp(s.vmid, 7, 17)
	if p.evolve then
		-- (only the start: the storm runs these)
		if not p.started then
			p.started = true
			s.vlow = p.vlow or s.vlow
			s.occl = p.occl or 0
			s.lowAngle = 2.75 - 1.0 * s.occl
			s.rfdDeficit = p.rfdDeficit or s.rfdDeficit
		end
		s.G = 0
		s.weakFor = 0
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
		return
	end
	local vlow = p.vlow or s.vlow
	if p.vlowLater and p.t >= (p.laterAt or 0) then
		vlow = p.vlowLater
	end
	s.vlow = vlow
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
	s.lowAngle = 2.75 - 1.0 * s.occl
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
	-- Where precipitation leaves the updraft (2026-10-30, from the fall-out physics,
	-- docs/stormlab/research/POSITIONING-PLAN.md 3.1). A particle grows inside the updraft and is
	-- carried across it by the storm-relative wind at its height; the updraft (Gaussian, w =
	-- W f(z) exp(-(r/ru)^2)) holds it up until it drifts out to the radius where w falls to its
	-- fall speed:  r* = ru sqrt(ln(W f / vt)).  Rain (8 m/s) leaves ~1.4 ru out, 4 cm hail
	-- (~35 m/s) ~0.6 ru - beside the updraft, the hail core; the 3-D advection after release then
	-- sorts sizes and carries the rain downstream. Which chord it crosses on is weighted by the
	-- updraft's mass flux (offset b ~ N(0, ru/sqrt 2)), so the exit points form a crescent on
	-- the downwind side; the low-level share, crossing in the low-level inflow from the
	-- right-front, leaves on the rear-left - where the low-level rotation wraps it into the
	-- hook. (Replaces painted release angles: downshear + 0.3 rad +- N(0.4) at 1.1-1.8 ru, a
	-- +-1.75 rad V-notch spread aloft, and a prescribed hook spiral.)
	-- spread < 0: anywhere in the core (the dead cell's ice).
	local function place(z: number, spread: number, vt: number, carry: boolean): (number, number)
		local f, tx, ty = wprofAt(s, z)
		local ru = updraftRadiusAt(s, z)
		local cx, cy = s.x + tx, s.y + ty
		if spread < 0 then
			local rr = ru * -spread * sqrt(-math.log(math.max(1e-6, rng:next())))
			local a = rng:next() * 2 * math.pi
			return cx + rr * cos(a), cy + rr * sin(a)
		end
		local eu, ev = s.u, s.v
		if s.prof then
			eu, ev = Thermo.windAt(s.prof, z)
		end
		local sru, srv = eu - s.u, ev - s.v
		local sp = sqrt(sru * sru + srv * srv)
		local ax, ay
		if sp > 1 then
			ax, ay = sru / sp, srv / sp
		else
			-- (no flow through it: it falls out on any side)
			local a = rng:next() * 2 * math.pi
			ax, ay = cos(a), sin(a)
		end
		local Wz = (if s.dead then 0 else s.W) * f
		local rStar
		if Wz > vt * 1.05 then
			rStar = ru * sqrt(math.log(Wz / vt))
		else
			-- (the updraft cannot hold it here: it falls out about where it formed)
			rStar = ru * 0.5 * sqrt(-math.log(math.max(1e-6, rng:next())))
		end
		-- nothing falls out inside the vault: the updraft core (the BWER on radar) is precipitation-
		-- free; stones that would leave it nearer the axis are carried up and out to its wall first.
		-- (Measured 2026-10-30: released from 0.6 ru, 4 cm hail fell onto the low-level updraft,
		-- its melting chilled the inflow - CAPE 0 at the inflow point - and the storm collapsed
		-- within 5 min; from the wall it held at W ~57 m/s with the hail core left-front)
		rStar = math.max(rStar, (Storm.PRECIP_RMIN or 1.1) * ru)
		local b = 0
		for _ = 1, 6 do
			b = ru * 0.7071 * rng:normal()
			if math.abs(b) < rStar then
				break
			end
		end
		b = math.clamp(b, -0.98 * rStar, 0.98 * rStar)
		local along = sqrt(rStar * rStar - b * b)
		local ex, ey = ax * along - ay * b, ay * along + ax * b
		if not carry then
			return cx + ex, cy + ey
		end
		-- while it crosses, the mesocyclone's rotation carries it round the updraft: the exit turns
		-- by (v_theta / r) x the time it takes to drift out, t = along / |V_sr|. (This is why the
		-- forward-flank core sits left-front of the updraft and the hail core on its left flank
		-- for a cyclonic storm - the old painted +0.3 rad stood in for it; without it half the
		-- rain fell into the right-front inflow and cooled it. Not for the low-level share: the
		-- low-level rotation already wraps it as it falls, and carried round as well it reached
		-- the inflow and stabilised it - CAPE 0 at the inflow point)
		local rm = math.max(0.7 * rStar, 300)
		local qx, qy = cx + ax * rm, cy + ay * rm
		local wu, wv = Storm.windAt(s, qx, qy, z)
		local vth = (-(qy - cy) * wu + (qx - cx) * wv) / rm
		local dth = math.clamp(vth / rm * along / math.max(sp, 3), -2.5, 2.5)
		local c, sn = cos(dth), sin(dth)
		return cx + ex * c - ey * sn, cy + ex * sn + ey * c
	end
	-- (the release before 2026-10-30, kept for A/B runs: Storm.PRECIP_RELEASE = "angles")
	local function placeAngles(z: number, spread: number): (number, number)
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
		local downshear = atan2(ev - s.v, eu - s.u)
		local sgnLeft = if s.leftMover then -1 else 1
		if spread == 2 then
			local lx, ly = s.cLowX or s.x, s.cLowY or s.y
			local hx, hy = heading(s)
			local back = atan2(-hy, -hx)
			local fx, fy = s.cFfdX, s.cFfdY
			if not fx then
				fx, fy = Storm.ffdAt(s)
			end
			local ex, ey = fx - hx * 0.55 * s.Ru, fy - hy * 0.55 * s.Ru
			local a0 = atan2(ey - ly, ex - lx)
			local r0 = math.clamp(sqrt((ex - lx) ^ 2 + (ey - ly) ^ 2), 0.6 * s.Ru, 1.6 * s.Ru)
			local aTip = back + sgnLeft * 1.05
			local sweep = ((aTip - a0) * sgnLeft) % (2 * math.pi)
			if sweep < 1.2 then
				sweep += 2 * math.pi
			end
			sweep = math.min(sweep, 4.2)
			local f = rng:next()
			local a = a0 + sgnLeft * sweep * f
			local rr = (r0 * (1 - f) + 0.4 * s.Ru * f) * rng:range(0.85, 1.15)
			return lx + rr * cos(a), ly + rr * sin(a)
		end
		if spread == 1 and z > 0.5 * s.top then
			local a = downshear + (rng:next() * 2 - 1) * 1.75
			local rr = 1.2 * ru * rng:range(1.0, 1.3)
			return s.x + tx + rr * cos(a), s.y + ty + rr * sin(a)
		end
		local a = downshear + sgnLeft * 0.3 + rng:normal() * 0.4
		local rr = ru * spread * rng:range(1.1, 1.8)
		return s.x + tx + rr * cos(a), s.y + ty + rr * sin(a)
	end
	local legacyRelease = Storm.PRECIP_RELEASE == "angles"
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
	for _ = 1, math.min(n, 150) do
		local z
		if s.dead then
			z = rng:range(4500, 7500)
		else
			-- release height weighted by the updraft's strength (rejection sampling)
			-- most precipitation mass falls out of the middle levels (warm rain below the freezing
			-- level, graupel and hail above it)
			z = s.base + 500
			for _ = 1, 4 do
				-- (up to ~0.8 of the equilibrium level: graupel and hail carried high by the updraft
				-- give the echo aloft - the overhang over the inflow, the BWER's cap)
				local cand = rng:range(math.max(s.base + 400, 2500), math.max(s.base + 800, math.min(0.8 * s.el, 11000)))
				if rng:next() < wprofAt(s, cand) then
					z = cand
					break
				end
			end
		end
		-- the hook's share: rain the rear-flank downdraft brings down fast, released low (from
		-- ~300 m to ~2 km above the base) so the low-level rotation wraps it before it spreads -
		-- released aloft with the rest it fell for minutes through the mid-level flow and the
		-- crescent smeared out (docs/stormlab/STATUS.md, radar)
		-- (0.15: on radar the hook is weaker than the main core - 40-50 vs 55-65 dBZ)
		-- (it leaves the updraft where the low-level storm-relative flow carries it out, and the low
		-- meso's own winds wrap it as it falls - since 2026-10-30 no prescribed hook spiral)
		local hook = not s.dead and rng:next() < (if s.pin and s.pin.rearShare then s.pin.rearShare else 0.15 * s.rot)
		if hook then
			z = rng:range(s.base + 300, math.max(s.base + 600, math.min(s.freezing - 200, s.base + 2000)))
		end
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
		local x, y
		if legacyRelease then
			x, y = placeAngles(z, if s.dead then -2.2 elseif hook then 2 else 1)
		else
			x, y = place(z, if s.dead then -2.2 else 1, precip.fallSpeed(kind, size, z), not hook and Storm.PRECIP_CARRY ~= false)
		end
		precip:emit(x, y, z, m0, kind, size, if hook then 1 else 0)
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
		srU = s.srU, srV = s.srV,
	}
	return snap
end

-- Build a storm-like object from a snapshot (clients use it for Storm.windAt / updraftAt)
function Storm.fromSnapshot(snap: { [string]: any }): Storm
	return snap :: any
end

-- A storm from the engine's storm object (scripts/export-lab-scenario.mjs, the game's lab window).
-- follow: the engine drives it from now on (Storm.setEngine; the game's engine mode and the lab's
-- engine mode: Sim/EngineFollow); otherwise the engine's state only starts it and the lab's own
-- dynamics (motion, rotation, occlusion cycles, genesis, decay) run it. (2026-10-29: it always
-- followed since 2026-10-28, which froze every lab scenario storm at its first engine state.)
function Storm.fromEngine(e: any, follow: boolean?): Storm
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
	if follow then
		Storm.setEngine(s, e, e.pos[1], e.pos[2], 0)
		s.engOX, s.engOY = 0, 0
	end
	return s
end

-- How long a jump between the engine's updates is eased away over (sim s; 60 = 5 s at the 12x clock)
local ENGINE_EASE = 60

-- The weather engine's latest word on a storm (server/StormHost, each poll; Storm.fromEngine):
-- where it is at lab time `at` (lab metres), its motion, updraft, size, rotation and occlusion.
-- Storm.step then follows it exactly (Storm.followEngine). Where the storm is drawn jumps by the
-- difference between this update and where the last one had carried it; that is eased away.
function Storm.setEngine(s: any, e: any, x: number, y: number, at: number)
	local old = s.eng
	if old then
		-- (drawn now minus the new update's position now)
		s.engOX = (s.engOX or 0) + (old.x + old.u * (at - old.at)) - x
		s.engOY = (s.engOY or 0) + (old.y + old.v * (at - old.at)) - y
	end
	local feed = e.feed
	-- the low-level circulation: the engine's index, or - while the engine has a tornado under the
	-- storm - what a tornado that strong needs under it (Tornado: supply > 6 m/s), so the wall
	-- cloud, RFD and hook look the part (the index alone, 0.02-0.25 under the engine's
	-- tornadoes, is only 0.4-4.5 m/s)
	local vlow = 18 * math.clamp(e.lowRotation, 0, 1.2)
	if e.tornado then
		vlow = math.max(vlow, 8 + 0.06 * (e.tornado.mph or 0))
	end
	s.eng = {
		x = x, y = y, at = at, u = e.motion[1], v = e.motion[2],
		W = math.clamp(e.updraftMs * 0.8, 5, 60),
		Ru = if feed and feed.updraft then math.clamp(feed.updraft.radiusKm * 1000 * 0.45, 1500, 7000) else s.Ru,
		vmid = 20 * math.clamp(e.meso, 0, 1.2),
		vlow = vlow,
		occl = math.clamp(e.occlusion or 0, 0, 0.999),
		-- the engine's tornado relative to its storm (same snapshot): the low-level circulation
		-- stands over it
		torDX = if e.tornado and e.tornado.pos then e.tornado.pos[1] - e.pos[1] else nil,
		torDY = if e.tornado and e.tornado.pos then e.tornado.pos[2] - e.pos[2] else nil,
	}
	s.leftMover = e.leftMover
end

-- Storm.step's engine part: the storm is where the engine's motion carries it from the last
-- update (held still while the engine's clock is paused: world.holdStill), its fields eased to
-- the engine's over ENGINE_EASE so an update never pops. Left movers spin the other way.
function Storm.followEngine(s: any, dt: number, world: any)
	local e = s.eng
	local k = 1 - exp(-dt / ENGINE_EASE)
	local keep = exp(-dt / ENGINE_EASE)
	if world.holdStill then
		-- held where it is drawn now (the next update eases it to the paused engine's position)
		e.x, e.y = s.x - (s.engOX or 0) - (s.engSX or 0), s.y - (s.engOY or 0) - (s.engSY or 0)
		e.at = world.time
	end
	s.engOX, s.engOY = (s.engOX or 0) * keep, (s.engOY or 0) * keep
	local age = world.time - e.at
	-- The engine's storm position IS its mesocyclone (2026-10-29: the storm grows from it - its
	-- wall cloud and tornado form there, and its updraft, downdrafts and rain are placed from it:
	-- js/storms/StormGeometry.js). So the lab's updraft centre s.x, s.y sits where its own low-level
	-- circulation (Storm.lowMesoAt, on the updraft's rear edge) lands on the engine's position.
	-- An occluding tornado drifts left-rear of it (up to 0.4 updraft radii) and may revolve round
	-- it (Tornado.setEngine); the storm stays on its mesocyclone and the funnel leans to it.
	local lx, ly = Storm.lowMesoAt(s)
	local shX, shY = -(lx - s.x), -(ly - s.y)
	if s.engSX == nil then
		-- (a new storm starts with its circulation on the engine's at once)
		s.engSX, s.engSY = shX, shY
	end
	-- (over ~4 sim min, 30 s at the 8x clock: a shift of a km or two is a slow glide, not a slide)
	local kS = 1 - exp(-dt / 240)
	s.engSX = s.engSX + (shX - s.engSX) * kS
	s.engSY = s.engSY + (shY - s.engSY) * kS
	s.x = e.x + e.u * age + s.engOX + s.engSX
	s.y = e.y + e.v * age + s.engOY + s.engSY
	s.u, s.v = e.u, e.v
	local sign = if s.leftMover then -1 else 1
	s.W += (e.W - s.W) * k
	s.Ru += (e.Ru - s.Ru) * k
	s.vmid += (sign * e.vmid - s.vmid) * k
	s.rot = ramp(math.abs(s.vmid), 7, 17)
	s.vlow += (sign * e.vlow - s.vlow) * k
	s.occl = e.occl
	s.lowAngle = 2.75 - 1.0 * s.occl
end

return Storm
