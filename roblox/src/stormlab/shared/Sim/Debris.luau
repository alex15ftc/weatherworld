--!nonstrict
--!native
-- Debris that obeys the simulated wind (guide section 4). No orbit points, no lerping: every
-- piece samples the local wind and feels aerodynamic drag on its RELATIVE velocity,
--   F_d = 1/2 rho Cd A |V - v| (V - v),
-- plus lift for plates (autorotating boards and sheets), gravity, ground contact (bounce,
-- sliding friction, coming to rest) and tumbling that follows the relative wind. Inertia means a
-- board keeps going round a bend, a car is slow to move and is lofted only after it has picked
-- up speed. Pure: the server runs the pieces that matter (damage, impacts) and clients run the
-- same steps for what they draw.
--   Debris.CLASSES[name]       physical profile (mass kg, area m2, Cd, Cl, length m, tumble)
--   Debris.new(class, x, y, z, u, v, w, seed)
--   Debris.step(piece, dt, wind)   wind(x, y, z) -> u, v, w
local Debris = {}

local RHO = 1.15
local G = 9.81
local sqrt, abs, cos, sin = math.sqrt, math.abs, math.cos, math.sin

export type Class = {
	name: string,
	group: string, -- "fine" | "structural" | "heavy"
	mass: number,
	area: number,
	cd: number,
	cl: number, -- lift coefficient for plates (0 for compact objects)
	length: number, -- characteristic length (tumbling rate)
	tumble: number, -- angular speed per (relative speed / length)
	restitution: number,
	friction: number,
	size: { number }, -- drawn size (studs = m)
	color: { number },
	material: string,
}

-- Physical profiles (docs/tornado-physics/README.md section 3: masses and areas from FEMA P-361,
-- NRC RG 1.76, Haan et al. 2017, Fujita; drag of flat plates ~1.2, rods ~1.0, cars ~0.4-0.6).
Debris.CLASSES = {
	leaf = { name = "leaf", group = "fine", mass = 0.002, area = 0.004, cd = 1.6, cl = 0.6, length = 0.07, tumble = 1.2, restitution = 0.1, friction = 0.9, size = { 0.12, 0.02, 0.08 }, color = { 74, 92, 46 }, material = "Grass" },
	grass = { name = "grass", group = "fine", mass = 0.01, area = 0.01, cd = 1.4, cl = 0.3, length = 0.2, tumble = 0.9, restitution = 0.1, friction = 0.9, size = { 0.3, 0.03, 0.05 }, color = { 120, 118, 70 }, material = "Grass" },
	paper = { name = "paper", group = "fine", mass = 0.005, area = 0.06, cd = 1.8, cl = 0.8, length = 0.25, tumble = 1.4, restitution = 0.1, friction = 0.8, size = { 0.28, 0.01, 0.21 }, color = { 230, 228, 220 }, material = "SmoothPlastic" },
	shingle = { name = "shingle", group = "structural", mass = 1.3, area = 0.34, cd = 1.2, cl = 0.6, length = 0.9, tumble = 0.8, restitution = 0.25, friction = 0.6, size = { 0.9, 0.02, 0.33 }, color = { 66, 62, 60 }, material = "Slate" },
	plywood = { name = "plywood", group = "structural", mass = 18, area = 2.97, cd = 1.2, cl = 0.7, length = 2.4, tumble = 0.8, restitution = 0.25, friction = 0.55, size = { 2.4, 0.02, 1.2 }, color = { 176, 140, 96 }, material = "Wood" },
	board = { name = "board", group = "structural", mass = 4.5, area = 0.22, cd = 1.0, cl = 0.15, length = 3.6, tumble = 0.3, restitution = 0.3, friction = 0.5, size = { 3.6, 0.09, 0.04 }, color = { 190, 160, 118 }, material = "Wood" },
	sheetMetal = { name = "sheetMetal", group = "structural", mass = 12, area = 2.0, cd = 1.2, cl = 0.8, length = 2.4, tumble = 0.9, restitution = 0.35, friction = 0.4, size = { 2.4, 0.01, 0.9 }, color = { 160, 166, 170 }, material = "CorrodedMetal" },
	branch = { name = "branch", group = "structural", mass = 5, area = 1.5, cd = 1.1, cl = 0.1, length = 2, tumble = 0.4, restitution = 0.2, friction = 0.7, size = { 2, 0.12, 0.12 }, color = { 72, 58, 44 }, material = "Wood" },
	brick = { name = "brick", group = "structural", mass = 2.5, area = 0.02, cd = 1.0, cl = 0, length = 0.2, tumble = 0.4, restitution = 0.2, friction = 0.7, size = { 0.2, 0.06, 0.1 }, color = { 150, 74, 56 }, material = "Brick" },
	trashCan = { name = "trashCan", group = "structural", mass = 15, area = 0.75, cd = 0.9, cl = 0, length = 1, tumble = 0.3, restitution = 0.3, friction = 0.5, size = { 0.7, 1, 0.7 }, color = { 60, 80, 70 }, material = "Plastic" },
	car = { name = "car", group = "heavy", mass = 1400, area = 4.0, cd = 0.5, cl = 0.35, length = 4.5, tumble = 0.12, restitution = 0.15, friction = 0.7, size = { 4.5, 1.45, 1.8 }, color = { 140, 30, 30 }, material = "Metal" },
	pickup = { name = "pickup", group = "heavy", mass = 2300, area = 5.0, cd = 0.55, cl = 0.3, length = 5.5, tumble = 0.1, restitution = 0.15, friction = 0.7, size = { 5.5, 1.85, 2 }, color = { 40, 60, 110 }, material = "Metal" },
	beam = { name = "beam", group = "heavy", mass = 120, area = 1.2, cd = 1.0, cl = 0.1, length = 6, tumble = 0.15, restitution = 0.2, friction = 0.6, size = { 6, 0.3, 0.2 }, color = { 120, 96, 70 }, material = "Wood" },
}

export type Piece = {
	class: Class,
	x: number, y: number, z: number,
	u: number, v: number, w: number,
	-- orientation as an axis-angle accumulator (yaw, pitch, roll) and angular speeds
	yaw: number, pitch: number, roll: number,
	wy: number, wp: number, wr: number,
	phase: number,
	resting: boolean,
	restFor: number,
	age: number,
	seed: number,
	kD: number,
	maxSpeed: number,
	impact: number, -- largest kinetic energy (J) carried so far
}

function Debris.new(className: string, x: number, y: number, z: number, u: number?, v: number?, w: number?, seed: number?): Piece
	local c = Debris.CLASSES[className] or Debris.CLASSES.board
	local s = seed or 1
	return {
		class = c,
		x = x, y = y, z = z,
		u = u or 0, v = v or 0, w = w or 0,
		yaw = (s % 628) / 100, pitch = 0, roll = 0,
		wy = 0, wp = 0, wr = 0,
		phase = (s % 1000) / 159,
		resting = false,
		restFor = 0,
		age = 0,
		seed = s,
		kD = 0.5 * RHO * c.cd * c.area / c.mass,
		maxSpeed = 0,
		impact = 0,
	}
end

-- Advance one piece dt seconds through the wind. groundZ: ground height under it (default 0).
function Debris.step(p: Piece, dt: number, wind: (number, number, number) -> (number, number, number), groundZ: number?)
	local c = p.class
	local gz = groundZ or 0
	p.age += dt
	local wu, wv, ww = wind(p.x, p.y, p.z)
	-- relative wind and the exact quadratic-drag relaxation (stable at any step)
	local ru, rv, rw = wu - p.u, wv - p.v, ww - p.w
	local rs = sqrt(ru * ru + rv * rv + rw * rw)
	if p.resting then
		-- a resting piece is picked up again when the wind can lift or slide it
		local q = 0.5 * RHO * rs * rs * c.area
		if q > c.mass * G * c.friction * 0.9 then
			p.resting = false
		else
			p.restFor += dt
			return
		end
	end
	local f = 1 / (1 + p.kD * rs * dt)
	local nru, nrv, nrw = ru * f, rv * f, rw * f
	p.u, p.v, p.w = wu - nru, wv - nrv, ww - nrw
	-- lift across the flow for plates: its direction turns with the tumbling (autorotation),
	-- mostly up when the plate is flat-on to the wind
	if c.cl > 0 and rs > 1 then
		local lift = 0.5 * RHO * c.cl * c.area * rs * rs / c.mass * dt
		p.phase += dt * c.tumble * rs / c.length
		local up = 0.5 + 0.5 * cos(p.phase)
		p.w += lift * up * 0.8
		-- a sideways share perpendicular to the horizontal relative wind
		local hs = sqrt(ru * ru + rv * rv)
		if hs > 0.1 then
			local side = 0.4 * sin(p.phase * 0.7)
			p.u += lift * side * (-rv / hs)
			p.v += lift * side * (ru / hs)
		end
	end
	p.w -= G * dt
	-- never faster than the wind allows plus a margin (drag sets terminal speed anyway)
	local sp = sqrt(p.u * p.u + p.v * p.v + p.w * p.w)
	local cap = sqrt(wu * wu + wv * wv + ww * ww) + 15
	if sp > cap then
		local k = cap / sp
		p.u, p.v, p.w = p.u * k, p.v * k, p.w * k
		sp = cap
	end
	p.maxSpeed = math.max(p.maxSpeed, sp)
	p.impact = math.max(p.impact, 0.5 * c.mass * sp * sp)
	p.x += p.u * dt
	p.y += p.v * dt
	p.z += p.w * dt
	-- tumbling follows the relative wind
	local target = c.tumble * rs / c.length
	p.wr += (target - p.wr) * math.min(1, dt * 2)
	p.wp += (target * 0.6 - p.wp) * math.min(1, dt * 1.5)
	p.wy += (target * 0.3 - p.wy) * math.min(1, dt)
	p.roll += p.wr * dt
	p.pitch += p.wp * dt
	p.yaw += p.wy * dt
	-- ground
	local bottom = gz + c.size[2] * 0.5
	if p.z <= bottom then
		p.z = bottom
		if p.w < 0 then
			p.w = -p.w * c.restitution
			if p.w < 1 then
				p.w = 0
			end
		end
		-- sliding friction against the ground (kinetic): mu g, never reversing
		local hs = sqrt(p.u * p.u + p.v * p.v)
		if hs > 0 then
			local dec = math.min(hs, c.friction * G * dt)
			p.u -= p.u / hs * dec
			p.v -= p.v / hs * dec
		end
		p.wr *= 0.8
		p.wp *= 0.8
		hs = sqrt(p.u * p.u + p.v * p.v)
		if hs < 0.4 and abs(p.w) < 0.2 then
			-- settled: lying flat
			p.u, p.v, p.w = 0, 0, 0
			p.pitch, p.roll = 0, 0
			p.resting = true
			p.restFor = 0
		end
	end
end

-- Wind speed needed to start moving a resting object (sliding): q A = mu m g
function Debris.slideSpeed(c: Class): number
	return sqrt(c.friction * c.mass * G / (0.5 * RHO * c.area))
end

-- Tachikawa number K = rho U^2 A / (2 m g): lofting needs Cl K >~ 1
function Debris.tachikawa(c: Class, speed: number): number
	return RHO * speed * speed * c.area / (2 * c.mass * G)
end

return Debris
