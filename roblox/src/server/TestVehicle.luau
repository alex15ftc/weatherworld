--!strict
-- Physics test car: an unanchored chassis on four motor-driven ball wheels, server-owned, with the
-- player's character seated so the camera rides along. At each distance in Config.TEST_VEHICLE_X it
-- drives straight along +X on flat ground (Workspace attribute TestFlatGround) and measures how
-- much the car shakes at steady speed. On flat ground any bounce or wobble is precision noise.

local RunService = game:GetService("RunService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage.Shared.World.Config)
local Heightfield = require(ReplicatedStorage.Shared.World.Heightfield)
local ChunkManager = require(script.Parent.ChunkManager)

local TestVehicle = {}

local WHEEL_RADIUS = 2
local CHASSIS_SIZE = Vector3.new(14, 1.5, 8)
local WHEEL_OFFSETS = { Vector3.new(5, 0, 6), Vector3.new(5, 0, -6), Vector3.new(-5, 0, 6), Vector3.new(-5, 0, -6) }
local ACCEL_SECONDS = 6
local MEASURE_SECONDS = 10
-- Hinge attachment whose primary (X) axis points along the car's Z axis, so wheels roll along X.
local AXLE = CFrame.fromMatrix(Vector3.zero, Vector3.zAxis, Vector3.yAxis)

type Car = { model: Model, chassis: BasePart, seat: Seat, motors: { HingeConstraint } }

local function buildCar(position: Vector3): Car
	local model = Instance.new("Model")
	model.Name = "TestCar"

	local chassis = Instance.new("Part")
	chassis.Name = "Chassis"
	chassis.Size = CHASSIS_SIZE
	chassis.CFrame = CFrame.new(position)
	chassis.Anchored = true
	chassis.Color = Color3.fromRGB(200, 60, 50)
	chassis.CustomPhysicalProperties = PhysicalProperties.new(2, 0.3, 0)
	chassis.Parent = model
	model.PrimaryPart = chassis

	local seat = Instance.new("Seat")
	seat.Size = Vector3.new(2, 1, 2)
	seat.CFrame = chassis.CFrame * CFrame.new(0, CHASSIS_SIZE.Y / 2 + 0.5, 0)
	seat.Anchored = true
	seat.Parent = model
	local seatWeld = Instance.new("WeldConstraint")
	seatWeld.Part0, seatWeld.Part1 = chassis, seat
	seatWeld.Parent = seat

	local motors = {}
	for i, offset in WHEEL_OFFSETS do
		local wheel = Instance.new("Part")
		wheel.Name = `Wheel{i}`
		wheel.Shape = Enum.PartType.Ball
		wheel.Size = Vector3.one * WHEEL_RADIUS * 2
		wheel.CFrame = chassis.CFrame * CFrame.new(offset)
		wheel.Anchored = true
		wheel.Color = Color3.fromRGB(30, 30, 30)
		wheel.CustomPhysicalProperties = PhysicalProperties.new(1, 2, 0, 100, 1)
		wheel.Parent = model

		local a0 = Instance.new("Attachment")
		a0.CFrame = CFrame.new(offset) * AXLE
		a0.Parent = chassis
		local a1 = Instance.new("Attachment")
		a1.CFrame = AXLE
		a1.Parent = wheel
		local hinge = Instance.new("HingeConstraint")
		hinge.Attachment0, hinge.Attachment1 = a0, a1
		hinge.ActuatorType = Enum.ActuatorType.Motor
		hinge.MotorMaxTorque = 1e6
		hinge.MotorMaxAcceleration = math.huge
		hinge.AngularVelocity = 0
		hinge.Parent = chassis
		table.insert(motors, hinge)

		local noCollide = Instance.new("NoCollisionConstraint")
		noCollide.Part0, noCollide.Part1 = chassis, wheel
		noCollide.Parent = wheel
	end

	model.Parent = workspace
	return { model = model, chassis = chassis, seat = seat, motors = motors }
end

local function setMotors(car: Car, angularVelocity: number)
	for _, motor in car.motors do
		motor.AngularVelocity = angularVelocity
	end
end

local function stdDev(values: { number }): number
	local sum = 0
	for _, v in values do
		sum += v
	end
	local mean = sum / #values
	local sq = 0
	for _, v in values do
		sq += (v - mean) ^ 2
	end
	return math.sqrt(sq / #values)
end

local function driveAt(character: Model, root: BasePart, humanoid: Humanoid, x: number, speed: number): string
	local z = 0
	local ground = Heightfield.studsAt(x, z)
	root.Anchored = true
	character:PivotTo(CFrame.new(x, ground + 12, z))
	while ChunkManager.missingWithin(root.Position, 768) > 0 do
		task.wait(0.1)
	end

	local car = buildCar(Vector3.new(x, ground + WHEEL_RADIUS + 0.25, z))
	root.Anchored = false
	car.seat:Sit(humanoid)
	task.wait(0.5)
	for _, p in car.model:GetDescendants() do
		if p:IsA("BasePart") then
			p.Anchored = false
		end
	end
	car.chassis:SetNetworkOwner(nil)

	-- Ramp the wheels up to speed; flip the spin if the car starts rolling backwards.
	local target = speed / WHEEL_RADIUS
	local sign = -1
	local started = os.clock()
	local checked = false
	while os.clock() - started < ACCEL_SECONDS do
		local t = os.clock() - started
		if not checked and t > 1 then
			checked = true
			if car.chassis.AssemblyLinearVelocity.X < 0 then
				sign = -sign
			end
		end
		setMotors(car, sign * target * math.min(1, t / ACCEL_SECONDS))
		RunService.Heartbeat:Wait()
	end
	setMotors(car, sign * target)

	-- Steady speed: sample height, tilt and speed every frame.
	local heights, tilts, speeds, steps = {}, {}, {}, {}
	local lastY: number? = nil
	local startZ = car.chassis.Position.Z
	started = os.clock()
	while os.clock() - started < MEASURE_SECONDS do
		local cf = car.chassis.CFrame
		table.insert(heights, cf.Position.Y)
		table.insert(tilts, math.deg(math.acos(math.clamp(cf.UpVector.Y, -1, 1))))
		table.insert(speeds, car.chassis.AssemblyLinearVelocity.Magnitude)
		if lastY then
			table.insert(steps, math.abs(cf.Position.Y - lastY))
		end
		lastY = cf.Position.Y
		RunService.Heartbeat:Wait()
	end

	local meanSpeed = 0
	for _, s in speeds do
		meanSpeed += s
	end
	meanSpeed /= #speeds
	local meanStep = 0
	for _, s in steps do
		meanStep += s
	end
	meanStep /= math.max(#steps, 1)

	local row = string.format(
		"x=%d: speed %.0f studs/s (sd %.2f) | height sd %.4f, mean frame step %.4f studs | tilt sd %.3f deg | sideways %.1f studs",
		x, meanSpeed, stdDev(speeds), stdDev(heights), meanStep, stdDev(tilts), car.chassis.Position.Z - startZ
	)
	print(`[TestVehicle] {row}`)

	humanoid.Sit = false
	car.model:Destroy()
	return row
end

function TestVehicle.run(character: Model, root: BasePart)
	local humanoid = character:WaitForChild("Humanoid") :: Humanoid
	local speed = workspace:GetAttribute("TestSpeed")
	local cruise = if typeof(speed) == "number" then speed else Config.TEST_SPEED_STUDS
	print(`[TestVehicle] flat ground: {workspace:GetAttribute("TestFlatGround") == true}, target {cruise} studs/s`)
	local rows = {}
	for _, x in Config.TEST_VEHICLE_X do
		table.insert(rows, driveAt(character, root, humanoid, x, cruise))
	end
	print(`[TestVehicle] SUMMARY {table.concat(rows, " || ")}`)
	character:SetAttribute("TestDriveDone", true)
end

return TestVehicle
