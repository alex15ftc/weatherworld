--!strict
-- What the wind does to things: objects picked up and carried, people knocked down and thrown,
-- buildings and trees failing part by part. Plain numbers in metres, kilograms and seconds
-- (no Roblox types), so the server and the offline tests share it; callers scale by
-- studsPerMetre. Sources and the reasoning: docs/tornado-physics/README.md.
--
--   forces      drag F = 1/2 rho Cd A |v_rel| v_rel, lift 1/2 rho CL A |v_rel|^2 across the flow;
--               an object class is its ballistic coefficient Cd A / m and lift CL A / m
--               (Tachikawa number K = rho U^2 A / (2 m g) decides what flies).
--   pickup      each object gets its own threshold (class value, log-normal scatter); above it a
--               hazard rate rising with the force (U^2 / Uth^2 - 1) releases it; updraught helps.
--   flight      exact quadratic-drag relaxation (stable at any tick), lift, gravity, a speed cap;
--               plates tumble about their long axis, rods end over end.
--   damage      impact energy 1/2 m v^2 against perforation energies and the 79 J injury mark;
--               structures fail by the EF scale's degrees of damage, each part its own speed.
local WindPhysics = {}

WindPhysics.RHO = 1.15 -- kg/m^3: a warm, humid Plains afternoon
WindPhysics.G = 9.81

export type Class = {
	name: string,
	mass: number, -- kg
	area: number, -- m^2, reference area
	cd: number, -- drag coefficient held still (broadside)
	cdTumble: number, -- averaged while tumbling in flight
	cl: number, -- lift coefficient (plates fly, compact things barely)
	slide: number?, -- m/s: starts sliding or tipping (3-s gust)
	release: number, -- m/s: comes free / lifts off where it stands (attached or resting)
	looseRelease: number, -- m/s: once already loose on the ground
	roll: number?, -- m/s: rolls over (vehicles, mobile homes)
	shape: string, -- "plate" | "rod" | "compact" | "body"
	length: number, -- m, for tumbling
}

-- Per-class parameters (3-s gusts, m/s). Calibrated against: Haan et al. 2017 (vehicles slide
-- at EF1, loft at EF4), Fujita (1090 kg car slides at 39 m/s), FEMA P-361 / NRC RG 1.76 missile
-- speeds (~0.4 of the design tornado), EF-scale DI 3/27/28, Penwarden 1973 (people).
local CLASSES: { [string]: Class } = {
	player = { name = "player", mass = 75, area = 0.75, cd = 1.1, cdTumble = 0.8, cl = 0.15,
		slide = 25, release = 40, looseRelease = 40, shape = "body", length = 1.8 },
	car = { name = "car", mass = 1400, area = 4.0, cd = 0.9, cdTumble = 0.9, cl = 0.5,
		slide = 45, release = 80, looseRelease = 80, roll = 60, shape = "compact", length = 4.6 },
	pickup = { name = "pickup", mass = 2300, area = 5.0, cd = 1.0, cdTumble = 1.0, cl = 0.5,
		slide = 50, release = 85, looseRelease = 85, roll = 65, shape = "compact", length = 5.5 },
	mobileHome = { name = "mobileHome", mass = 18000, area = 80, cd = 1.2, cdTumble = 1.2, cl = 0.4,
		slide = 39, release = 57, looseRelease = 57, roll = 44, shape = "compact", length = 20 },
	shingle = { name = "shingle", mass = 1.3, area = 0.34, cd = 1.2, cdTumble = 0.8, cl = 0.5,
		release = 35, looseRelease = 12, shape = "plate", length = 0.9 },
	plywood = { name = "plywood", mass = 18, area = 2.97, cd = 1.2, cdTumble = 0.8, cl = 0.5,
		release = 45, looseRelease = 18, shape = "plate", length = 2.44 },
	board = { name = "board", mass = 4.5, area = 0.22, cd = 1.2, cdTumble = 0.7, cl = 0.15,
		slide = 20, release = 30, looseRelease = 30, shape = "rod", length = 2.4 },
	branch = { name = "branch", mass = 5, area = 1.5, cd = 0.6, cdTumble = 0.6, cl = 0.2,
		release = 33, looseRelease = 15, shape = "rod", length = 2 },
	smallTree = { name = "smallTree", mass = 150, area = 8, cd = 0.5, cdTumble = 0.5, cl = 0.1,
		slide = 41, release = 65, looseRelease = 65, shape = "rod", length = 5 },
	fence = { name = "fence", mass = 25, area = 4.46, cd = 1.2, cdTumble = 0.8, cl = 0.4,
		release = 30, looseRelease = 18, shape = "plate", length = 2.44 },
	trashCan = { name = "trashCan", mass = 15, area = 0.75, cd = 1.0, cdTumble = 1.0, cl = 0.2,
		slide = 12, release = 28, looseRelease = 28, shape = "compact", length = 1.1 },
}

WindPhysics.CLASSES = CLASSES

-- Where someone is, and how much of the debris and wind reaches them (NWS fatality studies;
-- May 1999 Oklahoma basements; ICC 500).
WindPhysics.SHELTER = {
	open = 1,
	vehicle = 0.6, -- until the vehicle slides or rolls
	mobileHome = 0.7, -- until it fails (DOD 5-9)
	houseExterior = 0.4,
	interiorRoom = 0.15, -- until the house reaches DOD 8
	basement = 0.02,
	shelter = 0, -- ICC 500 / FEMA P-361
}

-- People on foot (m/s, 3-s gust): what happens, and the walking speed share.
WindPhysics.PLAYER_STATES = {
	{ name = "calm", above = 0, walk = 1 },
	{ name = "strained", above = 11, walk = 0.85 }, -- walking difficult (Penwarden)
	{ name = "stagger", above = 18, walk = 0.5 },
	{ name = "knockdown", above = 25, walk = 0 }, -- ragdoll 1-3 s, pushed by drag
	{ name = "dragged", above = 30, walk = 0 }, -- slides along the ground (mu ~ 0.6)
	{ name = "lofted", above = 40, walk = 0 }, -- K ~ 1: flight (still a hazard roll, below)
}

-- EF-scale degrees of damage: { what, expected, lower, upper } in m/s (McDonald & Mehta 2006).
WindPhysics.DAMAGE = {
	-- DI 2: one- and two-family residence
	house = {
		{ "visible damage", 29, 24, 36 },
		{ "roof cover <20%, gutters, siding", 35, 28, 43 },
		{ "windows and doors broken", 43, 35, 51 },
		{ "roof deck uplifted, garage door collapsed", 43, 36, 52 },
		{ "shifted off foundation", 54, 46, 63 },
		{ "roof structure removed, walls standing", 55, 46, 64 },
		{ "exterior walls collapsed", 59, 51, 68 },
		{ "most walls collapsed but interior rooms", 68, 57, 80 },
		{ "all walls collapsed", 76, 63, 89 },
		{ "slab swept clean", 89, 74, 98 },
	},
	-- DI 3: single-wide mobile home (published ranges for DODs 3, 5, 9; the others interpolated)
	mobileHome = {
		{ "visible damage", 27, 23, 32 },
		{ "shingles or metal roof partly uplifted", 33, 28, 38 },
		{ "slid off blocks", 39, 32, 46 },
		{ "roof uplifted", 40, 34, 47 },
		{ "rolled on side, intact", 44, 38, 51 },
		{ "roof and walls destroyed", 47, 40, 54 },
		{ "rolled or vaulted, roof and walls apart", 49, 42, 57 },
		{ "undercarriage separated", 53, 45, 61 },
		{ "complete destruction", 57, 49, 66 },
	},
	-- DI 27: hardwood trees (expected speeds published; ranges +-~15% assumed). DI 28 softwood
	-- is ~5% lower for uprooting and snapping. Virot et al. 2016: trunks break near 42 m/s.
	tree = {
		{ "small limbs broken", 27, 22, 32 },
		{ "large branches broken", 33, 27, 40 },
		{ "uprooted", 41, 34, 48 },
		{ "trunk snapped", 49, 42, 56 },
		{ "debarked", 64, 55, 73 },
	},
}

-- Perforation energy (J) of building parts struck by debris (Texas Tech / FEMA P-361 tests).
WindPhysics.PERFORATE = {
	window = 20,
	impactGlass = 900,
	woodWall = 800,
	brickVeneer = 3000,
	shelter = 7000,
}

local function sqr(x: number): number
	return x * x
end

-- Standard normal from a 0-1 source (Box-Muller).
local function normal(rand: () -> number): number
	local u = math.max(rand(), 1e-9)
	return math.sqrt(-2 * math.log(u)) * math.cos(2 * math.pi * rand())
end

export type Body = {
	class: Class,
	threshold: number, -- m/s: this object's own release speed
	loose: boolean, -- already freed (lying loose, or flying)
	flying: boolean,
	kd: number, -- 1/m: drag factor, 1/2 rho Cd A / m (tumbling)
	kl: number, -- 1/m: lift factor, 1/2 rho CL A / m
}

-- A new object of a class. rand: 0-1 source (math.random or a seeded Random's NextNumber).
-- attached = fixed down (shingles nailed on, a tree rooted); loose = lying free.
function WindPhysics.newBody(className: string, attached: boolean, rand: (() -> number)?): Body
	local c = CLASSES[className]
	assert(c, "unknown wind class " .. className)
	local r: () -> number = rand or function()
		return math.random()
	end
	local base = if attached then c.release else c.looseRelease
	return {
		class = c,
		threshold = base * math.exp(0.15 * normal(r)), -- log-normal scatter, sigma 0.15
		loose = not attached,
		flying = false,
		kd = 0.5 * WindPhysics.RHO * c.cdTumble * c.area / c.mass,
		kl = 0.5 * WindPhysics.RHO * c.cl * c.area / c.mass,
	}
end

-- The Tachikawa number: aerodynamic force over weight at wind speed U (m/s).
function WindPhysics.tachikawa(c: Class, U: number): number
	return WindPhysics.RHO * U * U * c.area / (2 * c.mass * WindPhysics.G)
end

-- The wind speed (m/s) that counts for picking up: horizontal wind plus a large weight on
-- updraught (a 15 m/s updraught under an object is worth a lot), U_eff^2 = |w_h|^2 + 3 w_z|w_z|.
function WindPhysics.effectiveSpeed(wx: number, wy: number, wz: number): number
	local h2 = wx * wx + wz * wz
	return math.sqrt(math.max(h2 + 3 * math.max(wy, 0) * math.abs(wy), 0))
end

-- Chance (0-1) the object is picked up during dt: hazard rate 1.5 (U^2 / Uth^2 - 1) per second.
-- Use the instantaneous wind for loose things, a 3-s mean for attached parts.
function WindPhysics.pickupChance(body: Body, speed: number, dt: number): number
	local excess = sqr(speed / body.threshold) - 1
	if excess <= 0 then
		return 0
	end
	return 1 - math.exp(-1.5 * excess * dt)
end

-- One flight step. Position and velocity in metres and m/s; wind (wx, wy, wz) m/s at the object.
-- Drag uses the exact solution of dv_rel/dt = -kd |v_rel| v_rel over dt, so even a shingle at
-- 10 Hz can't overshoot. Lift acts across the relative wind, tilted up. Returns the new velocity.
function WindPhysics.step(
	body: Body,
	vx: number, vy: number, vz: number,
	wx: number, wy: number, wz: number,
	dt: number
): (number, number, number)
	local rx, ry, rz = wx - vx, wy - vy, wz - vz
	local speed = math.sqrt(rx * rx + ry * ry + rz * rz)
	-- drag: v_rel <- v_rel / (1 + kd |v_rel| dt)
	local keep = 1 / (1 + body.kd * speed * dt)
	local nrx, nry, nrz = rx * keep, ry * keep, rz * keep
	vx, vy, vz = wx - nrx, wy - nry, wz - nrz
	-- lift: |a| = kl |v_rel|^2, along the part of "up" square to the relative wind
	if speed > 1e-3 and body.kl > 0 then
		local ux, uy, uz = rx / speed, ry / speed, rz / speed
		local nx, ny, nz = -uy * ux, 1 - uy * uy, -uy * uz
		local nl = math.sqrt(nx * nx + ny * ny + nz * nz)
		if nl > 1e-3 then
			local mean = speed * keep -- the relative wind over the step, roughly
			local a = body.kl * mean * mean * dt / nl
			vx += nx * a
			vy += ny * a
			vz += nz * a
		end
	end
	vy -= WindPhysics.G * dt
	-- nothing outruns the wind by much (sanity cap)
	local cap = math.sqrt(wx * wx + wy * wy + wz * wz) + 15
	local v = math.sqrt(vx * vx + vy * vy + vz * vz)
	if v > cap then
		local s = cap / v
		vx, vy, vz = vx * s, vy * s, vz * s
	end
	return vx, vy, vz
end

-- Spin while flying (radians/s about the object's own axis): plates autorotate about their long
-- axis (tip-speed ratio ~0.4), rods go end over end, compact things turn slowly.
function WindPhysics.tumbleRate(body: Body, relativeSpeed: number): number
	local c = body.class
	local k = if c.shape == "plate" then 0.8 elseif c.shape == "rod" then 0.3 elseif c.shape == "body" then 0.25 else 0.1
	return math.min(k * relativeSpeed / math.max(c.length, 0.1), 25)
end

-- Landing: bounce (restitution) and ground friction. Returns the velocity after touching the
-- ground, and whether it has come to rest (it then lies loose, easier to pick up again).
function WindPhysics.land(body: Body, vx: number, vy: number, vz: number, dt: number): (number, number, number, boolean)
	local rigid = body.class.shape == "compact" or body.class.shape == "rod"
	local e = if rigid then 0.35 else 0.2
	if vy < 0 then
		vy = -vy * e
	end
	local h = math.sqrt(vx * vx + vz * vz)
	if h > 0 then
		local slow = math.max(h - 0.5 * WindPhysics.G * dt * 4, 0) / h -- mu ~ 0.5 while skidding
		vx, vz = vx * slow, vz * slow
	end
	local resting = math.sqrt(vx * vx + vy * vy + vz * vz) < 2
	if resting then
		body.flying = false
		body.loose = true
		body.threshold = body.class.looseRelease * body.threshold / math.max(body.class.release, 1e-3)
		return 0, 0, 0, true
	end
	return vx, vy, vz, false
end

-- What the wind is doing to a person on foot at a 3-s gust (m/s): the state's name and the share
-- of walking speed they keep.
function WindPhysics.playerState(speed: number): (string, number)
	local name, walk = "calm", 1
	for _, s in WindPhysics.PLAYER_STATES do
		if speed >= s.above then
			name, walk = s.name, s.walk
		end
	end
	return name, walk
end

-- Damage (0-100 health) from a hit by an object of mass m at a relative normal speed v (m/s),
-- reduced by shelter. 20 J starts to hurt, ~600 J (a shingle at 30 m/s) is lethal; anything over
-- 300 kg faster than 5 m/s kills outright unless sheltered.
function WindPhysics.impactDamage(mass: number, speed: number, shelter: number?): number
	local s = shelter or 1
	local energy = 0.5 * mass * speed * speed
	if mass > 300 and speed > 5 and s >= 1 then
		return 100
	end
	return 100 * math.clamp((energy - 20) / (600 - 20), 0, 1) * s
end

-- Does a hit perforate a building part? (energy in J against WindPhysics.PERFORATE)
function WindPhysics.perforates(mass: number, speed: number, part: string): boolean
	return 0.5 * mass * speed * speed > (WindPhysics.PERFORATE[part] or math.huge)
end

-- A building part's own failure speed (m/s) for a degree of damage: drawn once, normal about the
-- expected speed with sigma = (upper - lower) / 4. modifier: hip roof 1.05, straps 1.2, breached
-- envelope 0.87 for roof parts (internal pressure: sqrt((1 + 0.18) / (1 + 0.55))).
function WindPhysics.failureSpeed(table_: { { any } }, dod: number, rand: (() -> number)?, modifier: number?): number
	local row = table_[dod]
	assert(row, "no degree of damage " .. tostring(dod))
	local r: () -> number = rand or function()
		return math.random()
	end
	local expected, lower, upper = row[2] :: number, row[3] :: number, row[4] :: number
	local v = expected + normal(r) * (upper - lower) / 4
	return math.clamp(v, lower, upper) * (modifier or 1)
end

-- The speed that counts for a roof part: upward wind under a roof adds to the uplift.
function WindPhysics.roofSpeed(wx: number, wy: number, wz: number): number
	local h = math.sqrt(wx * wx + wz * wz)
	return h * math.min(1.3, 1 + 0.5 * math.max(wy, 0) / math.max(h, 1e-3))
end

-- Running 3-s mean of a speed (exponential, time constant 3 s): structures and attached parts
-- respond to gusts lasting a few seconds, not to single noise peaks.
function WindPhysics.gust3s(previous: number, speed: number, dt: number): number
	return previous + (speed - previous) * (1 - math.exp(-dt / 3))
end

return WindPhysics
