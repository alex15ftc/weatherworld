--!strict
--!native
-- Client-side chassis for a car rigged by VehicleService (see Shared/VehicleConfig).
--
-- One rigid body (the "PhysicsBody" part) is simulated by Roblox. Per frame this:
--   1. spherecasts each wheel down its strut axis (radius = tire radius) to find
--      compression, contact point, normal and surface material
--   2. computes spring + bump/rebound damper + progressive bump stop +
--      anti-roll bar force per corner, which is also the tire's vertical load
--   3. turns the steering input into a road-wheel angle (Handling.steer: grip-
--      aware lock, caster in a slide) and resolves the Ackermann angle of each
--      front wheel; stability control picks a wheel to brake (Handling.stability)
--   4. hands each wheel its contact-patch velocity / load / friction to the
--      Drivetrain, which runs at the engine rate
--   5. after the drivetrain substeps, applies averaged tire forces at the
--      roll-centre height, suspension forces along the strut, aero and a
--      gravity correction, as one VectorForce + one Torque
--
-- Units: everything internal is SI. The model is built at MetersPerStud and the
-- body's Roblox mass is treated as Config.Mass kg, so N are converted with
--   F_roblox = F_newton * (AssemblyMass / Config.Mass) / MetersPerStud
-- The world's gravity is corrected for this car only, so it falls at 9.81 m/s^2
-- without changing workspace.Gravity for characters.
--
-- Collision Summaries (BasePart:BindToCollisionSummaries) are used for:
--   * Body: impact events (closing speed -> damage, camera shake, sparks) and
--     underbody scraping
--   * Wheel colliders (frictionless spheres inside each tire that stop wheels
--     clipping walls): a curb/wall strike kicks the steering, and a hard one
--     bends the toe of that wheel, as a real tie-rod would
-- Summaries come from the local simulation of the network owner, which is the
-- driving client, so no networking is involved.

local Workspace = game:GetService("Workspace")
local Players = game:GetService("Players")

local Drivetrain = require(script.Parent.Drivetrain)
local Tire = require(script.Parent.Tire)
local Handling = require(script.Parent.Handling)
local SkidMarks = require(script.Parent.SkidMarks)

local abs = math.abs
local max = math.max
local min = math.min
local clamp = math.clamp
local atan = math.atan
local tan = math.tan

local G = 9.81

-- Surface grip relative to dry asphalt (peak mu of a street tire).
local SURFACE_MU: { [Enum.Material]: number } = {
	[Enum.Material.Asphalt] = 1.0,
	[Enum.Material.Concrete] = 0.95,
	[Enum.Material.Pavement] = 0.95,
	[Enum.Material.Plastic] = 0.9,
	[Enum.Material.SmoothPlastic] = 0.9,
	[Enum.Material.Basalt] = 0.9,
	[Enum.Material.Brick] = 0.85,
	[Enum.Material.Cobblestone] = 0.75,
	[Enum.Material.Rock] = 0.8,
	[Enum.Material.Slate] = 0.8,
	[Enum.Material.Wood] = 0.7,
	[Enum.Material.WoodPlanks] = 0.7,
	[Enum.Material.Metal] = 0.6,
	[Enum.Material.DiamondPlate] = 0.65,
	[Enum.Material.CorrodedMetal] = 0.65,
	[Enum.Material.Marble] = 0.6,
	[Enum.Material.Granite] = 0.75,
	[Enum.Material.Ground] = 0.65,
	[Enum.Material.Grass] = 0.55,
	[Enum.Material.LeafyGrass] = 0.5,
	[Enum.Material.Mud] = 0.4,
	[Enum.Material.Sand] = 0.5,
	[Enum.Material.Sandstone] = 0.7,
	[Enum.Material.Salt] = 0.6,
	[Enum.Material.Snow] = 0.3,
	[Enum.Material.Glacier] = 0.15,
	[Enum.Material.Ice] = 0.1,
	[Enum.Material.Glass] = 0.5,
}

export type Corner = {
	wheel: Drivetrain.Wheel,
	axle: any,
	mountLocal: Vector3, -- studs, chassis space, top of travel
	compression: number, -- m
	compressionVel: number, -- m/s
	steer: number, -- rad, + = left
	toeDamage: number, -- rad, + = toe toward the left
	contact: Vector3?, -- world, studs
	ground: BasePart?,
	normal: Vector3,
	material: Enum.Material,
	springForce: number, -- N along the strut
	spin: number, -- visual wheel angle
	motor: Motor6D?, -- WheelMotor_XX, animated through Transform
	rideLocal: Vector3, -- studs, hub at static ride height in body space
	collider: BasePart?,
	lastStrike: number,
}

export type ImpactEvent = {
	Time: number,
	Speed: number, -- m/s closing
	Point: Vector3,
	Normal: Vector3,
	Part: BasePart,
	Kind: "Body" | "Wheel" | "Scrape" | "BottomOut",
	Corner: string?,
}

local Chassis = {}
Chassis.__index = Chassis

export type Chassis = typeof(setmetatable({} :: {
	config: any,
	model: Model,
	body: BasePart,
	corners: { Corner },
	byName: { [string]: Corner },
	drivetrain: Drivetrain.Drivetrain,
	force: VectorForce,
	torque: Torque,
	castParams: RaycastParams,
	nextFilterRefresh: number,
	mps: number,
	steerInput: number, -- inside-wheel angle as a fraction of full lock
	steerAngle: number, -- rad, inside-wheel angle, + = left
	steerState: Handling.SteerState,
	steerKick: number, -- rad, decays
	sideslip: number, -- rad at the rear axle, + = moving to the left of the heading
	grip: number, -- m/s^2 the front tires can corner at (filtered mu * g)
	yawInertia: number, -- kg m^2, estimate for stability control
	esc: boolean, -- stability control enabled
	escActive: boolean, -- braking a wheel this frame
	escThrottle: number, -- 0..1 engine torque request allowed by stability control
	escHold: number, -- s, stability control stands down (handbrake)
	wheelbase: number, -- m, measured from the model
	frontTrack: number, -- m
	speed: number, -- m/s, forward
	damage: number,
	impacts: { ImpactEvent },
	onImpact: BindableEvent,
	connections: { RBXScriptConnection },
	sparks: Attachment,
	sparkEmitter: ParticleEmitter,
	skids: SkidMarks.SkidMarks,
	_tireForces: { Vector3 },
	_tirePoints: { Vector3 },
	_suspForces: { Vector3 },
}, Chassis))

local function cornerOrder(): { { name: string, front: boolean, side: number } }
	return {
		{ name = "FL", front = true, side = -1 },
		{ name = "FR", front = true, side = 1 },
		{ name = "RL", front = false, side = -1 },
		{ name = "RR", front = false, side = 1 },
	}
end

function Chassis.new(model: Model, config: any): Chassis
	local body = model:FindFirstChild("PhysicsBody") :: BasePart
	assert(body and body:IsA("BasePart"), "car model needs a PhysicsBody part (rigged by VehicleService)")
	local mps = config.MetersPerStud

	local corners: { Corner } = {}
	local byName: { [string]: Corner } = {}
	local wheels: { Drivetrain.Wheel } = {}
	for _, spec in cornerOrder() do
		local axle = if spec.front then config.Front else config.Rear
		local motor = body:FindFirstChild("WheelMotor_" .. spec.name) :: Motor6D
		assert(motor and motor:IsA("Motor6D"), `missing WheelMotor_{spec.name}`)
		local rideLocal = motor.C0.Position
		local wheel: Drivetrain.Wheel = {
			Name = spec.name,
			Side = spec.side,
			Front = spec.front,
			Driven = axle.Driven,
			Steered = axle.Steered,
			Radius = config.Tire.Radius,
			Inertia = config.Tire.Inertia,
			omega = 0,
			grounded = false,
			vx = 0,
			vy = 0,
			fz = 0,
			mu = 1,
			brakeTorque = 0,
			handbrakeTorque = 0,
			tcsBrake = 0,
			escBrake = 0,
			fx = 0,
			fy = 0,
			kappa = 0,
			alpha = 0,
			absActive = false,
			_fxSum = 0,
			_fySum = 0,
		}
		table.insert(wheels, wheel)
		local corner: Corner = {
			wheel = wheel,
			axle = axle,
			-- strut top = hub at full bump
			mountLocal = rideLocal + Vector3.new(0, (config.SuspensionTravel - config.RideCompression) / mps, 0),
			rideLocal = rideLocal,
			compression = config.RideCompression,
			compressionVel = 0,
			steer = 0,
			toeDamage = 0,
			contact = nil,
			ground = nil,
			normal = Vector3.yAxis,
			material = Enum.Material.Plastic,
			springForce = 0,
			spin = 0,
			motor = motor,
			collider = model:FindFirstChild("Collider_" .. spec.name) :: BasePart?,
			lastStrike = 0,
		}
		table.insert(corners, corner)
		byName[spec.name] = corner
	end

	local attachment = body:FindFirstChild("ChassisForceAttachment") :: Attachment?
	if not attachment then
		local a = Instance.new("Attachment")
		a.Name = "ChassisForceAttachment"
		a.Parent = body
		attachment = a
	end

	local force = Instance.new("VectorForce")
	force.Name = "ChassisForce"
	force.ApplyAtCenterOfMass = true
	force.RelativeTo = Enum.ActuatorRelativeTo.World
	force.Attachment0 = attachment
	force.Force = Vector3.zero
	force.Parent = body

	local torque = Instance.new("Torque")
	torque.Name = "ChassisTorque"
	torque.RelativeTo = Enum.ActuatorRelativeTo.World
	torque.Attachment0 = attachment
	torque.Torque = Vector3.zero
	torque.Parent = body

	local params = RaycastParams.new()
	params.FilterType = Enum.RaycastFilterType.Exclude
	params.IgnoreWater = true
	-- Road markings, stop lines and crosswalks are thin CanCollide=false
	-- overlays; the wheels should only ever land on solid geometry.
	params.RespectCanCollide = true

	local sparks = Instance.new("Attachment")
	sparks.Name = "ImpactSparks"
	local emitter = Instance.new("ParticleEmitter")
	emitter.Enabled = false
	emitter.Texture = "rbxasset://textures/particles/sparkles_main.dds"
	emitter.Color = ColorSequence.new(Color3.fromRGB(255, 200, 90), Color3.fromRGB(255, 90, 20))
	emitter.LightEmission = 1
	emitter.Size = NumberSequence.new(0.15, 0)
	emitter.Lifetime = NumberRange.new(0.15, 0.45)
	emitter.Speed = NumberRange.new(12, 30)
	emitter.SpreadAngle = Vector2.new(60, 60)
	emitter.Acceleration = Vector3.new(0, -Workspace.Gravity * 0.5, 0)
	emitter.Drag = 3
	emitter.Parent = sparks
	sparks.Parent = Workspace.Terrain

	local self = setmetatable({
		config = config,
		model = model,
		body = body,
		corners = corners,
		byName = byName,
		drivetrain = Drivetrain.new(config, wheels),
		force = force,
		torque = torque,
		castParams = params,
		nextFilterRefresh = 0,
		mps = mps,
		steerInput = 0,
		steerAngle = 0,
		steerState = Handling.newSteerState(),
		steerKick = 0,
		sideslip = 0,
		grip = config.Tire.Mu * G,
		yawInertia = 0,
		esc = config.Assists.ESC ~= false,
		escActive = false,
		escThrottle = 1,
		escHold = 0,
		wheelbase = (byName.RL.rideLocal.Z - byName.FL.rideLocal.Z) * mps,
		frontTrack = (byName.FR.rideLocal.X - byName.FL.rideLocal.X) * mps,
		speed = 0,
		damage = 0,
		impacts = {},
		onImpact = Instance.new("BindableEvent"),
		connections = {},
		sparks = sparks,
		sparkEmitter = emitter,
		skids = SkidMarks.new(config.Tire.Width, mps),
		_tireForces = table.create(4, Vector3.zero),
		_tirePoints = table.create(4, Vector3.zero),
		_suspForces = table.create(4, Vector3.zero),
	}, Chassis)

	-- radius of gyration^2 ~ (CG to front axle) * (CG to rear axle)
	self.yawInertia = config.Mass * self.wheelbase ^ 2 * config.FrontWeight * (1 - config.FrontWeight)

	self:_bindCollisionSummaries()
	return self
end

---------------------------------------------------------------------------
-- Collision Summaries
---------------------------------------------------------------------------

function Chassis._emitSparks(self: Chassis, point: Vector3, normal: Vector3, count: number)
	self.sparks.WorldCFrame = CFrame.lookAlong(point, normal)
	self.sparkEmitter.EmissionDirection = Enum.NormalId.Front
	self.sparkEmitter:Emit(count)
end

function Chassis._record(self: Chassis, event: ImpactEvent)
	table.insert(self.impacts, event)
	if #self.impacts > 16 then
		table.remove(self.impacts, 1)
	end
	self.onImpact:Fire(event)
end

local HARD_MATERIALS: { [Enum.Material]: boolean } = {
	[Enum.Material.Concrete] = true,
	[Enum.Material.Asphalt] = true,
	[Enum.Material.Pavement] = true,
	[Enum.Material.Metal] = true,
	[Enum.Material.DiamondPlate] = true,
	[Enum.Material.Brick] = true,
	[Enum.Material.Cobblestone] = true,
	[Enum.Material.Rock] = true,
	[Enum.Material.Slate] = true,
	[Enum.Material.Basalt] = true,
	[Enum.Material.Granite] = true,
	[Enum.Material.SmoothPlastic] = true,
	[Enum.Material.Plastic] = true,
}

function Chassis._bindCollisionSummaries(self: Chassis)
	local config = self.config
	local mps = self.mps
	local model = self.model
	local impacts = config.Impacts

	local function isSelf(part: BasePart): boolean
		return part:IsDescendantOf(model)
	end

	-- The body and cabin: impacts and scraping
	local function onBodySummaries(summaries: { any })
		for _, s in summaries do
			local other = s.Part1 :: BasePart
			if not other or isSelf(other) then
				continue
			end
			local n = s.Normal :: Vector3
			local rel = s.RelativeVelocity :: Vector3
			local closing = abs(rel:Dot(n)) * mps
			local tangential = (rel - n * rel:Dot(n)).Magnitude * mps
			local now = s.Time :: number
			if closing >= impacts.BodyImpactSpeed then
				-- Kinetic energy per kg along the normal: a 2 m/s nudge is
				-- trivial, a 15 m/s wall hit is not.
				self.damage += 0.5 * closing * closing / 100
				self:_record({
					Time = now,
					Speed = closing,
					Point = s.Point,
					Normal = n,
					Part = other,
					Kind = "Body",
				})
				if closing > 5 and HARD_MATERIALS[other.Material] then
					self:_emitSparks(s.Point, -n, math.floor(closing * 3))
				end
			elseif tangential > 3 and HARD_MATERIALS[other.Material] then
				-- Sliding contact (bottoming on a crest, grinding a wall)
				if math.random() < 0.5 then
					self:_emitSparks(s.Point, -n, 2)
				end
				if n:Dot(self.body.CFrame.UpVector) < -0.6 then
					self:_record({
						Time = now,
						Speed = tangential,
						Point = s.Point,
						Normal = n,
						Part = other,
						Kind = "Scrape",
					})
				end
			end
	end
	end
	for _, name in { "PhysicsBody", "PhysicsCabin" } do
		local p = model:FindFirstChild(name)
		if p and p:IsA("BasePart") then
			local ok, conn = pcall(p.BindToCollisionSummaries, p, onBodySummaries)
			if ok then
				table.insert(self.connections, conn)
			else
				warn(`[Chassis] Collision summaries unavailable on {name}:`, conn)
			end
		end
	end

	-- Wheel colliders: curb strikes and wall hits
	for _, corner in self.corners do
		local collider = corner.collider
		if not collider then
			continue
		end
		local okW, connW = pcall(function()
			return collider:BindToCollisionSummaries(function(summaries: { any })
				for _, s in summaries do
					local other = s.Part1 :: BasePart
					if not other or isSelf(other) then
						continue
					end
					local n = s.Normal :: Vector3 -- from the collider towards the obstacle
					local rel = s.RelativeVelocity :: Vector3
					local closing = abs(rel:Dot(n)) * mps
					local cf = self.body.CFrame
					local up = n:Dot(cf.UpVector)

					if up < -0.7 then
						-- Obstacle below the collider: the tire is fully squashed
						-- and the rim is about to hit. Treat as bottoming out.
						if closing > 1 then
							self:_record({
								Time = s.Time,
								Speed = closing,
								Point = s.Point,
								Normal = n,
								Part = other,
								Kind = "BottomOut",
								Corner = corner.wheel.Name,
							})
						end
						continue
					end

					if closing < impacts.WheelStrikeSpeed or s.Time - corner.lastStrike < 0.15 then
						continue
					end
					corner.lastStrike = s.Time

					-- Push on the tire, in body space: lateral component turns the
					-- wheel about its kingpin. Obstacle on the right pushes the
					-- wheel (and the rack) to the left.
					local push = -n
					local lateral = push:Dot(cf.RightVector)
					local dir = if lateral > 0 then -1 else 1

					if corner.wheel.Steered then
						self.steerKick += dir * math.rad(1.5) * min(closing, 15) * abs(lateral)
					end
					if closing > impacts.BendSpeed then
						local bend = (closing - impacts.BendSpeed) * impacts.BendPerMps * abs(lateral)
						corner.toeDamage = clamp(corner.toeDamage + dir * bend, -math.rad(8), math.rad(8))
						self.damage += closing
					end
					self:_record({
						Time = s.Time,
						Speed = closing,
						Point = s.Point,
						Normal = n,
						Part = other,
						Kind = "Wheel",
						Corner = corner.wheel.Name,
					})
					if closing > 6 and HARD_MATERIALS[other.Material] then
						self:_emitSparks(s.Point, -n, math.floor(closing * 2))
					end
				end
			end)
		end)
		if okW then
			table.insert(self.connections, connW)
		end
	end
end

---------------------------------------------------------------------------
-- Per-frame simulation
---------------------------------------------------------------------------

export type Controls = {
	steer: number, -- -1..1, + = left
	analog: boolean?, -- steer comes from a stick rather than keys
	brake: number, -- 0..1
	handbrake: number, -- 0..1
}

function Chassis._refreshFilter(self: Chassis)
	local list: { Instance } = { self.model }
	for _, player in Players:GetPlayers() do
		if player.Character then
			table.insert(list, player.Character)
		end
	end
	self.castParams.FilterDescendantsInstances = list
end

-- Steering: Handling.steer (grip-aware lock, caster in a slide), Ackermann
-- split, toe, kick from wheel strikes.
function Chassis._steer(self: Chassis, dt: number, controls: Controls)
	local cfg = self.config.Steering
	local mps = self.mps
	local body = self.body
	local cf = body.CFrame
	local fl, fr, rl, rr = self.byName.FL, self.byName.FR, self.byName.RL, self.byName.RR

	-- Direction of travel at each axle, relative to the heading
	local function travel(a: Corner, b: Corner): number
		local v = body:GetVelocityAtPosition(cf:PointToWorldSpace((a.rideLocal + b.rideLocal) * 0.5)) * mps
		return math.atan2(-v:Dot(cf.RightVector), max(abs(v:Dot(cf.LookVector)), 3))
	end
	local grounded = fl.wheel.grounded or fr.wheel.grounded or rl.wheel.grounded or rr.wheel.grounded
	local front = if grounded then travel(fl, fr) else 0
	self.sideslip = if grounded then travel(rl, rr) else 0

	-- What the front tires can corner at, from last frame's surface and load
	local mu, n = 0, 0
	for _, c in { fl, fr } do
		if c.wheel.grounded then
			mu += c.wheel.mu
			n += 1
		end
	end
	if n > 0 then
		self.grip += (mu / n * G - self.grip) * (1 - math.exp(-dt / 0.15))
	end

	local angle = Handling.steer(
		self.steerState,
		cfg,
		dt,
		controls.steer,
		controls.analog == true,
		self.speed,
		self.sideslip,
		front,
		self.grip,
		self.drivetrain.latCurve.peak,
		self.wheelbase
	)
	self.steerAngle = angle
	self.steerInput = angle / cfg.MaxWheelAngle

	-- steering kick relaxes back through the rack
	self.steerKick *= math.exp(-dt * 8)

	local inner = abs(angle)
	local sign = if angle >= 0 then 1 else -1
	local L = self.wheelbase
	local outer = inner
	if inner > 1e-4 then
		-- Turn centre on the rear axle line; each front wheel points at it
		local T = self.frontTrack
		local R = L / tan(inner) + T * 0.5 -- to the car's centreline
		local ideal = atan(L / (R + T * 0.5))
		outer = inner + (ideal - inner) * cfg.Ackermann
	end

	for _, c in self.corners do
		-- toe-in points both wheels inward: the left wheel yaws right (negative)
		local toe = c.axle.StaticToe * c.wheel.Side
		local angle = toe + c.toeDamage
		if c.wheel.Steered then
			-- left turn (sign > 0): the left wheel is the inside one
			local isInner = (sign > 0 and c.wheel.Side < 0) or (sign < 0 and c.wheel.Side > 0)
			angle += sign * (if isInner then inner else outer) + self.steerKick
		end
		c.steer = angle
	end
end

function Chassis.prepare(self: Chassis, dt: number, controls: Controls)
	local now = os.clock()
	if now > self.nextFilterRefresh then
		self.nextFilterRefresh = now + 1
		self:_refreshFilter()
	end

	local config = self.config
	local mps = self.mps
	local body = self.body
	local cf = body.CFrame
	local up = cf.UpVector
	local travel = config.SuspensionTravel
	local tireCfg = config.Tire
	local radiusStuds = tireCfg.Radius / mps
	local margin = 0.25 -- m above the strut top where the cast starts

	self.speed = body.AssemblyLinearVelocity:Dot(cf.LookVector) * mps
	self:_steer(dt, controls)

	-- 1) Cast each wheel
	for _, c in self.corners do
		local mount = cf:PointToWorldSpace(c.mountLocal)
		local origin = mount + up * (margin / mps)
		local castLen = (margin + travel) / mps
		local result = Workspace:Spherecast(origin, radiusStuds, -up * castLen, self.castParams)
		local w = c.wheel
		if result then
			local hubDrop = result.Distance * mps - margin -- m below the strut top
			local x = travel - hubDrop -- compression; > travel means past the bump stop
			c.compressionVel = (x - c.compression) / max(dt, 1e-3)
			c.compression = x
			c.contact = result.Position
			c.normal = result.Normal
			c.material = result.Material
			w.grounded = true

			-- Prefer the measured strut velocity from body/ground motion over
			-- the frame difference (smoother, handles moving platforms).
			local ground = result.Instance
			c.ground = if ground:IsA("BasePart") and not ground:IsA("Terrain") then ground else nil
			local vBody = body:GetVelocityAtPosition(result.Position)
			local vGround = if c.ground then c.ground:GetVelocityAtPosition(result.Position) else Vector3.zero
			c.compressionVel = -(vBody - vGround):Dot(up) * mps
		else
			c.compression = 0
			c.compressionVel = 0
			c.contact = nil
			c.ground = nil
			w.grounded = false
		end
	end

	-- 2) Springs, dampers, bump stops, anti-roll bars
	for i = 1, 4, 2 do
		local left, right = self.corners[i], self.corners[i + 1]
		local axle = left.axle
		local arb = axle.AntiRollRate * (left.compression - right.compression)
		for _, c in { left, right } do
			if not c.contact then
				c.springForce = 0
				c.wheel.fz = 0
				continue
			end
			local x = c.compression
			local v = c.compressionVel
			local f = axle.SpringRate * x
			f += (if v > 0 then axle.BumpDamping else axle.ReboundDamping) * v
			if x > axle.BumpStopStart then
				local over = x - axle.BumpStopStart
				f += axle.BumpStopRate * over * over + axle.BumpDamping * 2 * max(v, 0)
			end
			f += if c == left then arb else -arb
			f = max(f, 0) -- the tire cannot pull the car down
			c.springForce = f
			local load = f * max(c.normal:Dot(up), 0)
			c.wheel.fz = load
		end
	end

	-- 3) Contact-patch kinematics for the drivetrain
	for _, c in self.corners do
		local w = c.wheel
		local axle = c.axle
		w.brakeTorque = controls.brake * axle.BrakeTorque
		w.handbrakeTorque = controls.handbrake * axle.HandbrakeTorque
		w.escBrake = 0
		local contact = c.contact
		if not contact then
			w.vx, w.vy, w.mu = 0, 0, 1
			continue
		end
		local n = c.normal
		local heading = (cf * CFrame.Angles(0, c.steer, 0)).LookVector
		local fwd = heading - n * heading:Dot(n)
		if fwd.Magnitude < 1e-3 then
			w.grounded = false
			continue
		end
		fwd = fwd.Unit
		local left = n:Cross(fwd)
		local v = body:GetVelocityAtPosition(contact)
		local ground = c.ground
		if ground then
			v -= ground:GetVelocityAtPosition(contact)
		end
		w.vx = v:Dot(fwd) * mps
		w.vy = v:Dot(left) * mps
		w.mu = Tire.mu(self.config.Tire, max(w.fz, 1), SURFACE_MU[c.material] or 0.8)
	end

	self:_stability(dt, controls)
	self.drivetrain:beginFrame()
end

-- Stability control: one brake makes the yaw moment Handling.stability asks
-- for. The outside front wheel pulls an oversteering car straight, the inside
-- rear tucks an understeering one in, and the engine is cut back while it
-- works. It stands down for the handbrake, which is the driver asking to slide.
function Chassis._stability(self: Chassis, dt: number, controls: Controls)
	self.escActive = false
	if controls.handbrake > 0 then
		self.escHold = 0.6
	else
		self.escHold = max(0, self.escHold - dt)
	end
	local allowed = 1
	if self.esc and self.escHold <= 0 then
		local yawRate = self.body.AssemblyAngularVelocity:Dot(self.body.CFrame.UpVector)
		local moment = Handling.stability(
			self.speed,
			yawRate,
			self.steerAngle,
			self.sideslip,
			self.grip,
			self.drivetrain.latCurve.peak,
			self.config.Assists.ESCSlip or math.rad(5),
			self.wheelbase,
			self.yawInertia
		)
		if moment ~= 0 then
			local name = (if moment * yawRate < 0 then "F" else "R") .. (if moment > 0 then "L" else "R")
			local w = self.byName[name].wheel
			if w.grounded then
				local force = min(abs(moment) / (self.frontTrack * 0.5), 0.9 * w.mu * w.fz)
				w.escBrake = force * w.Radius
			end
			self.escActive = true
			allowed = 1 - clamp(abs(moment) / (self.yawInertia * 3), 0, 0.7)
		end
	end
	-- cut quickly, hand the throttle back over about half a second
	local rate = if allowed < self.escThrottle then 8 else 2
	self.escThrottle += clamp(allowed - self.escThrottle, -rate * dt, rate * dt)
end

-- Applies the forces after the drivetrain has run its substeps for this frame.
function Chassis.apply(self: Chassis, dt: number)
	local config = self.config
	local mps = self.mps
	local body = self.body
	local cf = body.CFrame
	local up = cf.UpVector
	local mass = body.AssemblyMass
	local com = body.AssemblyCenterOfMass
	local toRoblox = mass / config.Mass / mps -- N -> Roblox force

	local total = Vector3.zero
	local torque = Vector3.zero
	local gravityTangentWorld = Vector3.new(0, -G, 0)

	for _, c in self.corners do
		local w = c.wheel
		local contact = c.contact
		if not contact or not w.grounded then
			continue
		end
		local n = c.normal
		local heading = (cf * CFrame.Angles(0, c.steer, 0)).LookVector
		local fwd = (heading - n * heading:Dot(n)).Unit
		local left = n:Cross(fwd)

		local tire = fwd * w.fx + left * w.fy -- N, in the ground plane

		-- Low-speed stabiliser. Roblox integrates our force for the whole frame,
		-- so a tire force that would reverse the contact velocity within one
		-- frame is clamped to what stops it. Below a crawl, the tire also holds
		-- the car against gravity along the slope (static friction).
		local cornerMass = w.fz / G
		if cornerMass > 0 then
			local vPatch = body:GetVelocityAtPosition(contact)
			local ground = c.ground
			if ground then
				vPatch -= ground:GetVelocityAtPosition(contact)
			end
			vPatch *= mps
			vPatch -= n * vPatch:Dot(n)
			local speed = vPatch.Magnitude
			local maxStop = 0.6 * cornerMass * speed / dt
			local along = if speed > 1e-4 then tire:Dot(vPatch / speed) else 0
			-- (only friction overshoot is clamped: a wheel whose surface turns against the patch's
			-- motion is driven, and its force may reverse that motion, as pulling away from a
			-- backward creep on a slope; clamped, the drive force went to nothing as the creep did)
			local driven = speed > 1e-4 and w.omega * w.Radius * fwd:Dot(vPatch / speed) < 0
			if along < -maxStop and not driven then
				tire += (vPatch / speed) * (-maxStop - along)
			end
			if speed < 0.5 then
				local gt = gravityTangentWorld - n * gravityTangentWorld:Dot(n)
				local hold = -(gt * cornerMass) - vPatch * (cornerMass * 0.6 / dt)
				local held = w.omega == 0 and w.brakeTorque + w.handbrakeTorque > 0
				if not held then
					-- a rolling wheel only resists sideways
					hold = left * hold:Dot(left) + fwd * tire:Dot(fwd)
				end
				local limit = w.mu * w.fz
				if hold.Magnitude > limit then
					hold = hold.Unit * limit
				end
				local blend = clamp((0.5 - speed) / 0.3, 0, 1)
				tire = tire:Lerp(hold, blend)
			end
		end

		local susp = up * c.springForce
		-- Tire forces act at the roll centre height above the contact patch,
		-- which sets how much of the cornering force rolls the body.
		local application = contact + up * (c.axle.RollCenterHeight / mps)

		local fTire = tire * toRoblox
		local fSusp = susp * toRoblox
		total += fTire + fSusp
		torque += (application - com):Cross(fTire) + (contact - com):Cross(fSusp)
	end

	-- Aerodynamic drag and lift at the centre of mass
	local vel = body.AssemblyLinearVelocity * mps
	local speed = vel.Magnitude
	if speed > 0.1 then
		local q = 0.5 * config.Aero.AirDensity * speed
		local drag = -vel * (q * config.Aero.DragArea)
		local lift = up * (q * speed * -config.Aero.LiftArea)
		total += (drag - lift) * toRoblox
	end

	-- Gravity correction: make this car fall at 9.81 m/s^2 in model scale
	local wantedGravity = G / mps
	total += Vector3.new(0, mass * (Workspace.Gravity - wantedGravity), 0)

	self.force.Force = total
	self.torque.Torque = torque
end

-- Wheel visuals, called every render frame: suspension travel, steering and
-- spin go into each hub's Motor6D.Transform (local only, like an animation).
function Chassis.render(self: Chassis, dt: number)
	local config = self.config
	local mps = self.mps
	local travel = config.SuspensionTravel
	local ride = config.RideCompression
	for _, c in self.corners do
		local motor = c.motor
		if not motor then
			continue
		end
		local x = clamp(c.compression, 0, travel + 0.04)
		if not c.contact then
			x = 0 -- full droop in the air
		end
		c.spin = (c.spin + c.wheel.omega * dt) % (2 * math.pi)
		-- joint frame is car-aligned: +X right, -Z forward. Rolling forward
		-- moves the top of the wheel towards -Z, a negative turn about +X.
		motor.Transform = CFrame.new(0, (x - ride) / mps, 0) * CFrame.Angles(0, c.steer, 0) * CFrame.Angles(-c.spin, 0, 0)
	end
end

-- Lays tire marks from each tire's combined slip (call after apply).
-- A corner's slip state: combined slip (1 = at the peak of the tire curve)
-- and how fast the contact patch slides over the ground (m/s). Zero when the
-- tire is off the ground. Skid marks and tire noise both read this.
function Chassis.tireSlip(self: Chassis, c: Corner): (number, number)
	local w = c.wheel
	if not (c.contact and w.grounded and w.fz > 0) then
		return 0, 0
	end
	local dt = self.drivetrain
	local sx, sy = w.kappa / dt.longCurve.peak, w.alpha / dt.latCurve.peak
	local sv = w.omega * w.Radius - w.vx
	return math.sqrt(sx * sx + sy * sy), math.sqrt(sv * sv + w.vy * w.vy)
end

function Chassis.updateMarks(self: Chassis)
	for _, c in self.corners do
		local slip, slide = self:tireSlip(c)
		self.skids:update(c.wheel.Name, c.contact, c.normal, slip, slide)
	end
end

-- Straighten and lift the car (e.g. after a roll-over). Repairs bent toe.
-- Fits a different tire (same size; see Shared/TireCompounds). The car's
-- shared config table is left alone: this chassis gets its own copy.
function Chassis.setTire(self: Chassis, tire: any)
	local config = table.clone(self.config)
	config.Tire = tire
	self.config = config
	local dt = self.drivetrain
	dt.config = config
	dt.longCurve, dt.latCurve = Tire.curves(tire)
end

function Chassis.reset(self: Chassis)
	local cf = self.body.CFrame
	local look = cf.LookVector
	local flat = Vector3.new(look.X, 0, look.Z)
	if flat.Magnitude < 1e-3 then
		flat = Vector3.zAxis
	end
	self.model:PivotTo(CFrame.lookAlong(cf.Position + Vector3.new(0, 6, 0), flat.Unit))
	self.body.AssemblyLinearVelocity = Vector3.zero
	self.body.AssemblyAngularVelocity = Vector3.zero
	for _, c in self.corners do
		c.toeDamage = 0
		c.wheel.omega = 0
	end
	self.steerState = Handling.newSteerState()
	self.escThrottle = 1
	self.damage = 0
end

function Chassis.destroy(self: Chassis)
	for _, conn in self.connections do
		conn:Disconnect()
	end
	table.clear(self.connections)
	self.force:Destroy()
	self.torque:Destroy()
	self.sparks:Destroy()
	self.onImpact:Destroy()
	self.skids:destroy()
	for _, c in self.corners do
		if c.motor then
			c.motor.Transform = CFrame.identity
		end
	end
end

return Chassis
