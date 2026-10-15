--!strict
-- Wheels, dust and engine note for every car in Workspace.Cars, on every client (from Rally With
-- Your Friends' RacePlace/Client/Controllers/CarFxController, without the cockpit).
--
-- For the car you drive these come straight from its physics. Other cars only replicate their
-- body, so their wheels are worked out from it: suspension by raycasting as the physics does,
-- spin from speed, steering from how fast the car is turning, revs from speed through the gears.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local Config = require(ReplicatedStorage.Shared.Vehicles.Config)
local Physics = require(script.Parent.Physics)

type Sim = Physics.Sim

local CAR = Config.Car
local S = Config.SCALE
local STATIC_COMPRESSION = Physics.STATIC_COMPRESSION

local Effects = {}

type WheelFx = {
	Motor: Motor6D?,
	Emitter: ParticleEmitter?,
	Spec: Config.WheelSpec,
	Travel: number,
	Spin: number,
}

type CarFx = {
	Car: Model,
	Chassis: BasePart,
	Engine: Sound?,
	Wheels: { WheelFx },
	Steer: number,
	RPM: number,
	LimiterCut: boolean,
	Gear: number,
}

local tracked: { [Model]: CarFx } = {}
local params = RaycastParams.new()
params.FilterType = Enum.RaycastFilterType.Exclude
params.RespectCanCollide = true
params.IgnoreWater = true

local function track(car: Model)
	local chassis = car.PrimaryPart or car:WaitForChild("Chassis", 10)
	if not (chassis and chassis:IsA("BasePart")) or not car.Parent then
		return
	end

	local wheelsFolder = car:WaitForChild("Wheels", 10)
	local wheels: { WheelFx } = {}
	for _, spec in CAR.Wheels do
		local hub = wheelsFolder and wheelsFolder:WaitForChild(spec.Name, 5)
		local motor = hub and hub:FindFirstChild("Suspension")
		local attachment = chassis:FindFirstChild(`Dust{spec.Name}`)
		local emitter = attachment and attachment:FindFirstChild("Dust")
		table.insert(wheels, {
			Motor = if motor and motor:IsA("Motor6D") then motor else nil,
			Emitter = if emitter and emitter:IsA("ParticleEmitter") then emitter else nil,
			Spec = spec,
			Travel = -STATIC_COMPRESSION,
			Spin = 0,
		})
	end

	local engine = chassis:FindFirstChild("Engine")
	if engine and engine:IsA("Sound") and Config.ENGINE_SOUND ~= "" then
		engine.SoundId = Config.ENGINE_SOUND
		engine.Volume = 0
		engine.Looped = true
		engine:Play()
	end

	tracked[car] = {
		Car = car,
		Chassis = chassis,
		Engine = if engine and engine:IsA("Sound") then engine else nil,
		Wheels = wheels,
		Steer = 0,
		RPM = CAR.IdleRPM,
		LimiterCut = false,
		Gear = 1,
	}
end

-- Engine revs for a car seen from outside, from its speed through the gears.
local function inferRPM(fx: CarFx, forwardSpeed: number, dt: number)
	local tops = CAR.GearTopSpeeds
	local speed = math.abs(forwardSpeed)
	if fx.Gear < #tops and speed > tops[fx.Gear] * 0.96 then
		fx.Gear += 1
	elseif fx.Gear > 1 and speed < tops[fx.Gear - 1] * 0.62 then
		fx.Gear -= 1
	end
	local low = if fx.Gear > 1 then tops[fx.Gear - 1] * 0.5 else 0
	local ratio = math.clamp((speed - low) / (tops[fx.Gear] - low), 0, 1)
	local target = CAR.IdleRPM + (CAR.RedlineRPM - CAR.IdleRPM) * ratio
	fx.RPM, fx.LimiterCut = Config.stepRPM(fx.RPM, target, CAR.RedlineRPM, fx.LimiterCut, speed > 3 * S, dt)
end

local function update(fx: CarFx, sim: Sim?, dt: number)
	local chassis = fx.Chassis
	local cf = chassis.CFrame
	local velocity = chassis.AssemblyLinearVelocity
	local speed = velocity.Magnitude
	local forwardSpeed = velocity:Dot(cf.LookVector)
	local own = sim ~= nil and sim.Car == fx.Car
	local throttle: number

	if own and sim then
		fx.Steer = sim.Steer
		fx.RPM = sim.RPM
		fx.LimiterCut = sim.LimiterCut
		fx.Gear = sim.Gear
		throttle = sim.Throttle
	elseif chassis.Anchored then
		-- Parked: engine off, wheels still.
		fx.RPM = 0
		throttle = 0
	else
		-- Steering from yaw rate: tan(steer) = wheelbase * yawRate / speed.
		local yawRate = chassis.AssemblyAngularVelocity:Dot(cf.UpVector)
		local target = if math.abs(forwardSpeed) > 3 * S
			then math.clamp(math.atan(CAR.Wheelbase * -yawRate / forwardSpeed), -CAR.MaxSteer, CAR.MaxSteer)
			else fx.Steer * 0.95
		fx.Steer += (target - fx.Steer) * math.min(1, dt * 10)
		if fx.RPM <= 0 then
			fx.RPM = CAR.IdleRPM
		end
		inferRPM(fx, forwardSpeed, dt)
		throttle = math.clamp(fx.RPM / CAR.RedlineRPM, 0.2, 1)
	end

	local reach = CAR.RestLength + CAR.WheelRadius
	for i, wheel in fx.Wheels do
		local spec = wheel.Spec
		local contact = false
		local material: Enum.Material? = nil
		local slip = 0

		if own and sim then
			local state = sim.Wheels[i]
			wheel.Travel = state.Travel
			wheel.Spin = state.Spin
			contact = state.Contact
			material = state.Material
			slip = state.Slip
		else
			local mount = cf:PointToWorldSpace(Physics.mountOffset(spec))
			local result = workspace:Raycast(mount, -cf.UpVector * reach, params)
			local target = if result then (reach - result.Distance) - STATIC_COMPRESSION else -STATIC_COMPRESSION
			wheel.Travel += (target - wheel.Travel) * math.min(1, dt * 20)
			wheel.Spin += forwardSpeed / CAR.WheelRadius * dt
			contact = result ~= nil
			material = if result then result.Material else nil
			slip = math.clamp(math.abs(velocity:Dot(cf.RightVector)) / (25 * S), 0, 1)
		end

		local motor = wheel.Motor
		if motor then
			local steer = if spec.Front then fx.Steer else 0
			-- Forward roll is a negative turn about the axle (+X).
			motor.Transform = CFrame.new(0, wheel.Travel, 0) * CFrame.Angles(0, -steer, 0) * CFrame.Angles(-wheel.Spin, 0, 0)
		end

		local emitter = wheel.Emitter
		if emitter then
			local dustiness = if contact and material then Config.Dustiness[material] or 0 else 0
			local axle = if spec.Front then 0.55 else 1
			emitter.Rate = if speed > 6 * S then dustiness * axle * (speed / S * 0.35 + slip * 45) else 0
		end
	end

	local engine = fx.Engine
	if engine then
		if fx.RPM <= 0 then
			engine.Volume = 0
		else
			engine.PlaybackSpeed = math.clamp(fx.RPM / Config.ENGINE_SOUND_RPM, 0.3, 2.2)
			engine.Volume = (0.25 + 0.35 * throttle) * (if fx.LimiterCut then 0.35 else 1)
		end
	end
end

-- `driving` gives the physics of the car the local player drives, if any.
function Effects.start(driving: () -> Sim?)
	local cars = workspace:WaitForChild("Cars")
	params.FilterDescendantsInstances = { cars }

	cars.ChildAdded:Connect(function(car)
		if car:IsA("Model") then
			track(car)
		end
	end)
	cars.ChildRemoved:Connect(function(car)
		tracked[car :: Model] = nil
	end)
	for _, car in cars:GetChildren() do
		if car:IsA("Model") then
			task.spawn(track, car)
		end
	end

	RunService:BindToRenderStep("CarEffects", Enum.RenderPriority.First.Value + 1, function(dt: number)
		local sim = driving()
		for car, fx in tracked do
			if car.Parent and fx.Chassis.Parent then
				update(fx, sim, dt)
			else
				tracked[car] = nil
			end
		end
	end)
end

return Effects
