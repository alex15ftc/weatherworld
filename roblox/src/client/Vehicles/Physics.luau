--!strict
-- Raycast-wheel car physics, run by the driver's client (which owns the car). Ported from Rally
-- With Your Friends (RacePlace/Client/Modules/VehiclePhysics), at this world's size
-- (shared/Vehicles/Config); the car drives as the rally car does on its stock tune.
--
-- Each wheel is a ray from its suspension mount. The spring/damper holds the body up; the tyre
-- turns slip into grip, capped by a friction circle so braking, power and cornering compete for
-- the same grip, which is what lets the car slide and drift on gravel. Forces are applied as
-- impulses once per frame, while Roblox integrates at 240 Hz in between; the suspension is
-- softened at long frames so those once-per-frame kicks cannot overshoot (suspensionFactor).
--
-- The world keeps Roblox's default gravity for characters; the car cancels the difference so it
-- feels Config.CAR_GRAVITY.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage.Shared.Vehicles.Config)
local Input = require(script.Parent.Input)

type Controls = Input.Controls
type WheelSpec = Config.WheelSpec

local CAR = Config.Car
local G = Config.CAR_GRAVITY
local S = Config.SCALE

local Physics = {}
Physics.__index = Physics

export type WheelState = {
	Spec: WheelSpec,
	Contact: boolean,
	Compression: number,
	Travel: number, -- wheel centre offset from its rest position (+ = up)
	Spin: number, -- accumulated roll angle
	SpinRate: number,
	Slip: number, -- 0..1, how far past the grip limit the tyre is
	Material: Enum.Material?,
	Load: number,
}

export type Sim = typeof(setmetatable({} :: {
	Car: Model,
	Chassis: BasePart,
	Wheels: { WheelState },
	Steer: number, -- road-wheel angle, rad, + = right
	Throttle: number,
	Brake: number,
	Gear: number,
	RPM: number,
	LimiterCut: boolean,
	ClutchHeld: boolean,
	ShiftTimer: number,
	LastStep: number, -- length of the previous step, for the gravity sag below
	Speed: number,
	ForwardSpeed: number,
	Airborne: boolean,
	Params: RaycastParams,
	ParamsAge: number,
}, Physics))

Physics.STATIC_COMPRESSION = G / (2 * math.pi * CAR.SpringHz) ^ 2
local STATIC_COMPRESSION = Physics.STATIC_COMPRESSION

-- Longest frame the car is advanced by. Gravity and contact act over the real frame, so the
-- car's own forces must too, or it sags onto the bump stops.
local MAX_STEP = 1 / 5
-- Frame length the suspension is tuned at; anything shorter is left as is.
local TUNED_STEP = 1 / 60
-- Tyre forces act this far above the contact patch, which tames body roll.
local CONTACT_LIFT = 0.6 * S

-- How much of a corner's quarter of the mass resists a tyre's sideways push. The push acts a
-- little above the contact patch, so it also rolls the chassis box (the only massive part) and,
-- front against rear, yaws it.
local LATERAL_SHARE = (function()
	local size = CAR.ChassisSize
	local base = 0
	for _, spec in CAR.Wheels do
		base = math.max(base, math.abs(spec.Position.Z))
	end
	local arm = CAR.ChassisOffset.Y - CONTACT_LIFT
	local roll = 12 * arm ^ 2 / (size.X ^ 2 + size.Y ^ 2)
	local yaw = 12 * base ^ 2 / (size.X ^ 2 + size.Z ^ 2)
	return 1 / (1 + roll + yaw)
end)()

-- A spring/damper kicked once per frame overshoots when the frame outlasts about 2/ω; the bump
-- stop puts that near 20 fps, which bounced and flipped cars at low frame rates. Dividing the
-- force by the implicit-Euler factor keeps every frame length stable. It is normalised to
-- TUNED_STEP so this softening never touches 60 fps and faster.
local function suspensionFactor(k: number, c: number, m: number, dt: number): number
	local function implicit(h: number): number
		return 1 + (c * h + k * h * h) / m
	end
	return math.max(1, implicit(dt) / implicit(TUNED_STEP))
end

-- Mount point of a wheel in chassis space: above the wheel's rest position by the spring length
-- left over at rest.
function Physics.mountOffset(spec: WheelSpec): Vector3
	return spec.Position - CAR.ChassisOffset + Vector3.new(0, CAR.RestLength - STATIC_COMPRESSION, 0)
end
local mountOffset = Physics.mountOffset

local function surfaceGrip(material: Enum.Material?): number
	return if material then Config.SurfaceGrip[material] or Config.DefaultSurfaceGrip else Config.DefaultSurfaceGrip
end

function Physics.new(car: Model): Sim
	local chassis = assert(car.PrimaryPart, "car has no chassis")
	local wheels = {}
	for _, spec in CAR.Wheels do
		table.insert(wheels, {
			Spec = spec,
			Contact = false,
			Compression = 0,
			Travel = -STATIC_COMPRESSION,
			Spin = 0,
			SpinRate = 0,
			Slip = 0,
			Material = nil,
			Load = 0,
		} :: WheelState)
	end

	return setmetatable({
		Car = car,
		Chassis = chassis,
		Wheels = wheels,
		Steer = 0,
		Throttle = 0,
		Brake = 0,
		Gear = 1,
		RPM = CAR.IdleRPM,
		LimiterCut = false,
		ClutchHeld = false,
		ShiftTimer = 0,
		LastStep = 0,
		Speed = 0,
		ForwardSpeed = 0,
		Airborne = false,
		Params = RaycastParams.new(),
		ParamsAge = math.huge,
	}, Physics)
end

function Physics.refreshParams(self: Sim)
	-- Wheels see terrain and scenery, never cars or people.
	local ignore: { Instance } = {}
	local cars = workspace:FindFirstChild("Cars")
	if cars then
		table.insert(ignore, cars)
	end
	for _, player in Players:GetPlayers() do
		if player.Character then
			table.insert(ignore, player.Character)
		end
	end
	self.Params.FilterType = Enum.RaycastFilterType.Exclude
	self.Params.FilterDescendantsInstances = ignore
	self.Params.IgnoreWater = true
	-- Only what the car could actually touch is ground.
	self.Params.RespectCanCollide = true
	self.ParamsAge = 0
end

local function steerLimit(speed: number): number
	local t = math.clamp(speed / CAR.HighSpeed, 0, 1) ^ 0.8
	return CAR.MaxSteer + (CAR.HighSpeedSteer - CAR.MaxSteer) * t
end

local function approach(current: number, target: number, rate: number): number
	if current < target then
		return math.min(current + rate, target)
	else
		return math.max(current - rate, target)
	end
end

-- Advances the car one frame.
function Physics.step(self: Sim, dt: number, controls: Controls)
	dt = math.min(dt, MAX_STEP)

	local chassis = self.Chassis
	if chassis.Anchored then
		return
	end

	self.ParamsAge += dt
	if self.ParamsAge > 1 then
		self:refreshParams()
	end

	local cf = chassis.CFrame
	local up, look, right = cf.UpVector, cf.LookVector, cf.RightVector
	local mass = chassis.AssemblyMass
	-- The car is held up once per frame but falls all frame long, so the velocity read here
	-- trails the frame's average by half a frame of world gravity. At low frame rates that
	-- phantom fall reads as speed and the damper fights it, so every read adds it back.
	local sag = Vector3.yAxis * workspace.Gravity * self.LastStep * 0.5
	self.LastStep = dt
	local velocity = chassis.AssemblyLinearVelocity + sag
	local speed = velocity.Magnitude
	local forwardSpeed = velocity:Dot(look)
	local cornerMass = mass / 4

	self.Speed = speed
	self.ForwardSpeed = forwardSpeed

	-- Feel CAR_GRAVITY instead of the world's.
	chassis:ApplyImpulse(Vector3.yAxis * mass * (workspace.Gravity - G) * dt)

	local throttle = controls.Throttle
	local brake = controls.Brake
	local handbrake = controls.Handbrake
	self.ClutchHeld = handbrake
	self.Throttle = throttle
	self.Brake = brake

	----------------------------------------------------------------------------
	-- Steering
	----------------------------------------------------------------------------

	local target = controls.Steer
	if controls.Raw then
		-- Absolute input (a wheel): it sets the angle directly.
		self.Steer = target * CAR.MaxSteer
	else
		local lateral = velocity:Dot(right)
		if speed > 12 * S and not self.Airborne then
			-- Help keyboard and pad players catch slides.
			local slideAngle = math.atan2(lateral, math.abs(forwardSpeed))
			target += math.clamp(slideAngle / CAR.MaxSteer, -1, 1) * CAR.CounterSteerAssist
		end
		local limit = steerLimit(speed)
		local targetAngle = math.clamp(target, -1, 1) * limit
		local returning = math.abs(targetAngle) < math.abs(self.Steer) or math.sign(targetAngle) ~= math.sign(self.Steer)
		local rate = (if returning then CAR.SteerReturnRate else CAR.SteerRate) * dt
		self.Steer = approach(self.Steer, targetAngle, rate)
	end

	----------------------------------------------------------------------------
	-- Engine
	----------------------------------------------------------------------------

	self.ShiftTimer = math.max(0, self.ShiftTimer - dt)
	local tops = CAR.GearTopSpeeds
	local absSpeed = math.abs(forwardSpeed)

	if forwardSpeed > -2 * S then
		if self.Gear < #tops and absSpeed > tops[self.Gear] * 0.96 then
			self.Gear += 1
			self.ShiftTimer = CAR.ShiftTime
		elseif self.Gear > 1 and absSpeed < tops[self.Gear - 1] * 0.62 then
			self.Gear -= 1
			self.ShiftTimer = CAR.ShiftTime * 0.5
		end
	end

	local gearLow = if self.Gear > 1 then tops[self.Gear - 1] * 0.5 else 0
	local gearRatio = math.clamp((absSpeed - gearLow) / (tops[self.Gear] - gearLow), 0, 1)
	local rpmTarget = CAR.IdleRPM + (CAR.RedlineRPM - CAR.IdleRPM) * gearRatio

	local rpmLimit = if handbrake then CAR.LaunchRPM else CAR.RedlineRPM
	if handbrake then
		-- Pulling the handbrake disengages the clutch; road speed cannot drag the engine above
		-- the launch limiter or drive through the held brake.
		rpmTarget = CAR.IdleRPM + (rpmLimit - CAR.IdleRPM) * throttle
	elseif self.Airborne then
		rpmTarget = math.max(rpmTarget, CAR.IdleRPM + (rpmLimit - CAR.IdleRPM) * throttle)
	end

	self.RPM, self.LimiterCut = Config.stepRPM(self.RPM, rpmTarget, rpmLimit, self.LimiterCut, throttle > 0, dt)

	local driveAccel = 0
	if throttle > 0 and self.ShiftTimer <= 0 and not self.ClutchHeld and not self.LimiterCut then
		if forwardSpeed > -1 * S then
			driveAccel = throttle * math.min(CAR.MaxDriveAccel, CAR.PowerAccel / math.max(absSpeed, 1))
		end
	end

	-- The brake pedal reverses once stopped.
	local reverseAccel = 0
	if brake > 0 and throttle == 0 and forwardSpeed < 1.5 * S and not self.ClutchHeld then
		if forwardSpeed > -CAR.MaxReverseSpeed then
			reverseAccel = brake * CAR.ReverseAccel
		end
		brake = 0
	end

	----------------------------------------------------------------------------
	-- Wheels
	----------------------------------------------------------------------------

	local springK = cornerMass * (2 * math.pi * CAR.SpringHz) ^ 2
	local damperC = 2 * CAR.DampingRatio * cornerMass * (2 * math.pi * CAR.SpringHz)
	local reach = CAR.RestLength + CAR.WheelRadius
	local contacts = 0
	local lowSpeed = math.clamp(speed / CAR.LowSpeedStabilize, 0, 1)
	-- The anti-roll bar stiffens each corner in roll (both ends of the bar push).
	local cornerK = springK * (1 + 2 * CAR.AntiRoll)
	local softening = table.create(#self.Wheels, 1)

	for index, wheel in self.Wheels do
		local spec = wheel.Spec
		local mount = cf:PointToWorldSpace(mountOffset(spec))
		local result = workspace:Raycast(mount, -up * reach, self.Params)

		if not result then
			wheel.Contact = false
			wheel.Compression = 0
			wheel.Load = 0
			wheel.Slip = 0
			wheel.Material = nil
			wheel.Travel = -STATIC_COMPRESSION
			-- Driven wheels spin up in the air under throttle.
			local spinThrottle = if self.ClutchHeld or self.LimiterCut then 0 else throttle
			wheel.SpinRate += (spinThrottle * 60 - wheel.SpinRate) * math.min(1, dt * 2)
			wheel.Spin += wheel.SpinRate * dt
			continue
		end

		contacts += 1
		local compression = reach - result.Distance
		wheel.Contact = true
		wheel.Compression = compression
		wheel.Travel = compression - STATIC_COMPRESSION
		wheel.Material = result.Material

		-- Suspension: the part holding the car up at rest is steady and passes through; only the
		-- spring and damper motion around it is softened.
		local spring = springK * compression
		local stiffness = cornerK
		if compression > CAR.MaxCompression then
			spring += springK * CAR.BumpStopStiffness * (compression - CAR.MaxCompression)
			stiffness += springK * CAR.BumpStopStiffness
		end

		local damper = -damperC * (chassis:GetVelocityAtPosition(mount) + sag):Dot(up)
		local static = springK * STATIC_COMPRESSION
		local factor = suspensionFactor(stiffness, damperC, cornerMass, dt)
		softening[index] = factor
		local load = math.max(0, static + (spring + damper - static) / factor)
		wheel.Load = load

		-- Tyre frame on the ground
		local normal = result.Normal
		local steer = if spec.Front then self.Steer else 0
		local heading = look * math.cos(steer) + right * math.sin(steer)
		local tf = heading - normal * heading:Dot(normal)
		if tf.Magnitude < 1e-3 then
			continue
		end
		tf = tf.Unit
		local tr = tf:Cross(normal)
		local contact = result.Position
		local pointVelocity = chassis:GetVelocityAtPosition(contact) + sag
		local vLong = pointVelocity:Dot(tf)
		local vLat = pointVelocity:Dot(tr)

		-- Bump-stop spikes hold the body up but should not become grip.
		local grip = CAR.TireGrip * surfaceGrip(result.Material)
		local maxForce = grip * math.min(load, cornerMass * G * 2.5)
		local rearLocked = handbrake and not spec.Front

		-- Lateral: rises with slip angle to a peak, then falls away into a slide.
		local slipAngle = math.atan2(vLat, math.max(math.abs(vLong), 4 * S))
		local x = math.abs(slipAngle) / CAR.LateralPeakSlip
		local coefficient = if x <= 1 then x * (2 - x) else 1 + (CAR.LateralFalloff - 1) * math.clamp((x - 1) / 2, 0, 1)
		local lateral = -math.sign(slipAngle) * coefficient * maxForce
		if rearLocked then
			lateral *= CAR.HandbrakeRearGrip
		end

		-- At walking pace, slip angles are noise: just stop the sideways creep.
		local creep = math.clamp(-vLat * cornerMass / dt * 0.5, -maxForce, maxForce)
		lateral = creep + (lateral - creep) * lowSpeed

		-- Grip near zero slip is very stiff; kicked once per long frame it shoves the tyre past
		-- straight and back every frame (the low-fps shake). A frame's push may stop the tyre's
		-- sideways slide but never reverse it.
		local stopSlide = math.abs(vLat) * cornerMass * LATERAL_SHARE / dt
		lateral = math.clamp(lateral, -stopSlide, stopSlide)

		-- Longitudinal
		local share = if spec.Front then CAR.FrontDriveShare else 1 - CAR.FrontDriveShare
		local longitudinal = mass * (driveAccel - reverseAccel) * share * 0.5
		local brakeShare = if spec.Front then CAR.FrontBrakeShare else 1 - CAR.FrontBrakeShare
		local stopForce = math.abs(vLong) * cornerMass / dt -- never brake past standstill

		if brake > 0 then
			longitudinal -= math.sign(vLong) * math.min(mass * CAR.BrakeAccel * brake * brakeShare * 0.5, stopForce)
		end
		if throttle > 0 and forwardSpeed < -1 * S and not self.ClutchHeld then
			-- Throttle while rolling backwards brakes.
			longitudinal -= math.sign(vLong) * math.min(mass * CAR.BrakeAccel * throttle * brakeShare * 0.5, stopForce)
		end
		if throttle == 0 and reverseAccel == 0 then
			local engineBrake = if self.ClutchHeld then 0 else CAR.EngineBrake
			longitudinal -= math.sign(vLong) * math.min(cornerMass * (engineBrake + CAR.RollingResistance), stopForce)
		end
		if rearLocked then
			longitudinal = -math.sign(vLong) * math.min(maxForce * CAR.HandbrakeLock, stopForce)
		end

		-- Friction circle: power, braking and cornering share the grip.
		local total = math.sqrt(longitudinal * longitudinal + lateral * lateral)
		wheel.Slip = 0
		if total > maxForce and total > 0 then
			wheel.Slip = math.clamp((total - maxForce) / math.max(maxForce, 1), 0, 1)
			local scale = maxForce / total
			longitudinal *= scale
			lateral *= scale
		end
		wheel.Slip = math.max(wheel.Slip, math.clamp((x - 1) * 0.5, 0, 1))

		chassis:ApplyImpulseAtPosition(up * load * dt, mount)
		chassis:ApplyImpulseAtPosition((tf * longitudinal + tr * lateral) * dt, contact + up * CONTACT_LIFT)

		-- Wheel rotation for the visuals
		local rollRate = vLong / CAR.WheelRadius
		if rearLocked then
			rollRate = 0
		elseif driveAccel > 0 and wheel.Slip > 0.2 then
			rollRate += throttle * 25 * wheel.Slip
		end
		wheel.SpinRate = rollRate
		wheel.Spin += rollRate * dt
	end

	self.Airborne = contacts == 0

	----------------------------------------------------------------------------
	-- Anti-roll bars
	----------------------------------------------------------------------------

	local wheels = self.Wheels
	for axle = 0, 1 do
		local leftIndex, rightIndex = axle * 2 + 1, axle * 2 + 2
		local left, rightWheel = wheels[leftIndex], wheels[rightIndex]
		if left.Contact and rightWheel.Contact then
			-- Push up on the more-compressed side and down on the other.
			local factor = math.max(softening[leftIndex], softening[rightIndex])
			local force = (left.Compression - rightWheel.Compression) * springK * CAR.AntiRoll / factor
			chassis:ApplyImpulseAtPosition(up * force * dt, cf:PointToWorldSpace(mountOffset(left.Spec)))
			chassis:ApplyImpulseAtPosition(up * -force * dt, cf:PointToWorldSpace(mountOffset(rightWheel.Spec)))
		end
	end

	----------------------------------------------------------------------------
	-- Aero and air control
	----------------------------------------------------------------------------

	if speed > 0.1 then
		chassis:ApplyImpulse(-velocity * speed * CAR.DragCoefficient * mass * dt)
	end

	if contacts > 0 then
		chassis:ApplyImpulse(-up * forwardSpeed * forwardSpeed * CAR.Downforce * mass * dt)
	else
		-- Keep jumps tidy: damp tumbling, let the yaw carry.
		local localSpin = cf:VectorToObjectSpace(chassis.AssemblyAngularVelocity)
		local pitchRoll = math.exp(-CAR.AirAngularDamping * dt)
		local yaw = math.exp(-CAR.AirYawDamping * dt)
		chassis.AssemblyAngularVelocity =
			cf:VectorToWorldSpace(Vector3.new(localSpin.X * pitchRoll, localSpin.Y * yaw, localSpin.Z * pitchRoll))
	end
end

return Physics
