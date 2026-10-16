--!strict
-- Builds a chase car (the Rally With Your Friends chassis; RacePlace/Server/Modules/CarFactory).
--
-- Physics is a single invisible chassis box plus a massless roof box. Everything visual is
-- massless and does not collide. The tyres are raycasts, simulated by the driver's client
-- (Client/Modules/Vehicles/Physics); each wheel hub hangs off the chassis by a Motor6D named
-- "Suspension" that clients move (Client/Modules/Vehicles/Effects).
--
-- Art: a Model at ReplicatedStorage.Assets.Cars.ChaseCar, laid out as the rally car's art
-- (pivot on the ground midway between the axles, facing -Z; a Body model; optionally a Wheel
-- model of one right-hand wheel, pivot at the hub) at the rally's 0.225 m a stud. It is scaled
-- down to this world (Config.SCALE).
--
-- Stand-in: without that art, a mesh named "body car" (any spacing or case: BodyCar, Body Car)
-- made in Studio is used as the body. It is looked for in ReplicatedStorage.Assets, then at the
-- top of Workspace, ServerStorage and ReplicatedStorage, and fitted to the car: its long side
-- along the car, scaled to the car's length, sat at the body's ride height. Attributes on it
-- adjust the fit: Yaw (degrees, e.g. 180 if it faces backwards), Length (studs), Lift (studs).
-- It should be upright (Y up). The plain wheels stay. Without any of these the car gets a plain
-- body made of parts.

local PhysicsService = game:GetService("PhysicsService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerStorage = game:GetService("ServerStorage")

local Config = require(ReplicatedStorage.Shared.Vehicles.Config)

local CAR = Config.Car
local S = Config.SCALE

local CarFactory = {}

CarFactory.COLLISION_GROUP = "ChaseCar"
CarFactory.ART_NAME = "ChaseCar"
CarFactory.STANDIN_NAME = "bodycar" -- compared without spaces, underscores or case

local STANDIN_LENGTH = 16.6 * S -- nose to tail of the plain body, bumpers included
local STANDIN_BOTTOM = 0.75 -- studs above the ground: the plain body's underside

local registered = false

local function registerCollisionGroup()
	if registered then
		return
	end
	registered = true
	PhysicsService:RegisterCollisionGroup(CarFactory.COLLISION_GROUP)
end

local function decorate(part: BasePart)
	part.Anchored = false
	part.CanCollide = false
	part.CanQuery = false
	part.CanTouch = false
	part.Massless = true
end

local function weld(part0: BasePart, part1: BasePart)
	local w = Instance.new("WeldConstraint")
	w.Part0 = part0
	w.Part1 = part1
	w.Parent = part1
end

local function hull(name: string, size: Vector3, offset: Vector3): Part
	local part = Instance.new("Part")
	part.Name = name
	part.Size = size
	part.CFrame = CFrame.new(offset)
	part.Transparency = 1
	part.CanTouch = false
	part.CollisionGroup = CarFactory.COLLISION_GROUP
	part.TopSurface = Enum.SurfaceType.Smooth
	part.BottomSurface = Enum.SurfaceType.Smooth
	return part
end

-- A visual box in rally units (studs at 0.225 m), placed relative to the car origin.
local function panel(parent: Instance, name: string, size: Vector3, centre: Vector3, color: Color3, material: Enum.Material, transparency: number?): Part
	local part = Instance.new("Part")
	part.Name = name
	part.Size = size * S
	part.CFrame = CFrame.new(centre * S)
	part.Color = color
	part.Material = material
	part.Transparency = transparency or 0
	part.TopSurface = Enum.SurfaceType.Smooth
	part.BottomSurface = Enum.SurfaceType.Smooth
	part.Parent = parent
	return part
end

-- The body without art: a boxy hatchback. The cabin is taller than the rally car's, because a
-- seated character here is full Roblox size.
local function plainBody(paint: Color3): Model
	local body = Instance.new("Model")
	body.Name = "Body"
	local trim = Color3.fromRGB(32, 32, 36)
	local glass = Color3.fromRGB(40, 52, 62)
	local M = Enum.Material

	panel(body, "Lower", Vector3.new(6.4, 1.7, 16.0), Vector3.new(0, 2.0, -0.15), paint, M.SmoothPlastic)
	panel(body, "Bonnet", Vector3.new(6.0, 0.35, 4.6), Vector3.new(0, 3.0, -5.4), paint, M.SmoothPlastic)
	panel(body, "Cabin", Vector3.new(5.6, 3.3, 8.2), Vector3.new(0, 4.5, 1.1), glass, M.Glass, 0.45)
	panel(body, "Roof", Vector3.new(5.6, 0.3, 7.0), Vector3.new(0, 6.3, 1.4), paint, M.SmoothPlastic)
	for _, side in { -1, 1 } do
		panel(body, "Pillar", Vector3.new(0.3, 3.3, 0.5), Vector3.new(side * 2.7, 4.5, -2.85), paint, M.SmoothPlastic)
		panel(body, "Pillar", Vector3.new(0.3, 3.3, 0.6), Vector3.new(side * 2.7, 4.5, 4.9), paint, M.SmoothPlastic)
		panel(body, "Headlamp", Vector3.new(1.3, 0.55, 0.15), Vector3.new(side * 2.25, 2.35, -8.2), Color3.fromRGB(255, 244, 214), M.Neon)
		panel(body, "TailLamp", Vector3.new(1.1, 0.5, 0.15), Vector3.new(side * 2.4, 2.45, 7.9), Color3.fromRGB(190, 24, 20), M.Neon)
	end
	panel(body, "FrontBumper", Vector3.new(6.6, 0.75, 0.6), Vector3.new(0, 1.4, -8.3), trim, M.SmoothPlastic)
	panel(body, "RearBumper", Vector3.new(6.6, 0.75, 0.6), Vector3.new(0, 1.4, 8.0), trim, M.SmoothPlastic)
	panel(body, "Skid", Vector3.new(5.8, 0.25, 13.5), Vector3.new(0, 1.05, -0.15), trim, M.DiamondPlate)

	body.WorldPivot = CFrame.identity
	return body
end

-- One plain wheel, centred on the origin, rolling about X.
local function plainWheel(): Model
	local wheel = Instance.new("Model")
	wheel.Name = "Visual"
	local diameter = CAR.WheelRadius * 2

	local tyre = Instance.new("Part")
	tyre.Name = "Tyre"
	tyre.Shape = Enum.PartType.Cylinder
	tyre.Size = Vector3.new(1.1 * S, diameter, diameter)
	tyre.Color = Color3.fromRGB(26, 26, 28)
	tyre.Material = Enum.Material.SmoothPlastic
	tyre.Parent = wheel

	local rim = Instance.new("Part")
	rim.Name = "Rim"
	rim.Shape = Enum.PartType.Cylinder
	rim.Size = Vector3.new(1.16 * S, diameter * 0.55, diameter * 0.55)
	rim.Color = Color3.fromRGB(196, 198, 204)
	rim.Material = Enum.Material.Metal
	rim.Parent = wheel

	-- A spoke, so the wheel is seen to turn.
	local spoke = Instance.new("Part")
	spoke.Name = "Spoke"
	spoke.Size = Vector3.new(1.18 * S, diameter * 0.5, 0.18)
	spoke.Color = Color3.fromRGB(70, 72, 78)
	spoke.Material = Enum.Material.Metal
	spoke.Parent = wheel

	wheel.WorldPivot = CFrame.identity
	return wheel
end

local function dust(parent: Attachment)
	local emitter = Instance.new("ParticleEmitter")
	emitter.Name = "Dust"
	emitter.Texture = "rbxasset://textures/particles/smoke_main.dds"
	emitter.Color = ColorSequence.new(Color3.fromRGB(176, 158, 128))
	emitter.LightEmission = 0
	emitter.LightInfluence = 1
	emitter.Size = NumberSequence.new({
		NumberSequenceKeypoint.new(0, 1.6 * S),
		NumberSequenceKeypoint.new(1, 9 * S),
	})
	emitter.Transparency = NumberSequence.new({
		NumberSequenceKeypoint.new(0, 0.55),
		NumberSequenceKeypoint.new(0.4, 0.75),
		NumberSequenceKeypoint.new(1, 1),
	})
	emitter.Lifetime = NumberRange.new(1.6, 3)
	emitter.Speed = NumberRange.new(2 * S, 6 * S)
	emitter.SpreadAngle = Vector2.new(35, 35)
	emitter.Acceleration = Vector3.new(0, 1.5 * S, 0)
	emitter.Drag = 1.2
	emitter.RotSpeed = NumberRange.new(-40, 40)
	emitter.Rotation = NumberRange.new(0, 360)
	emitter.Rate = 0 -- clients drive this from wheel slip and speed
	emitter.Parent = parent
end

local function headlights(car: Model, chassis: BasePart)
	local front = -CAR.ChassisSize.Z / 2
	for _, side in { -1, 1 } do
		local lamp = Instance.new("Part")
		lamp.Name = "Headlight"
		lamp.Size = Vector3.new(0.6, 0.6, 0.6)
		lamp.Transparency = 1
		lamp.CFrame = chassis.CFrame * CFrame.new(side * CAR.ChassisSize.X * 0.34, -0.2, front)
		decorate(lamp)

		local beam = Instance.new("SpotLight")
		beam.Face = Enum.NormalId.Front
		beam.Angle = 62
		beam.Range = 140 * S
		beam.Brightness = 5
		beam.Color = Color3.fromRGB(255, 240, 205)
		beam.Shadows = false
		beam.Parent = lamp

		lamp.Parent = car
		weld(chassis, lamp)
	end
end

-- Copies art onto the car, scaled from rally units, welded to the chassis.
local function attachArt(car: Model, chassis: BasePart, source: Instance, origin: CFrame, name: string)
	local copy = source:Clone()
	copy.Name = name
	if copy:IsA("Model") and source:IsA("Model") then
		local relative = origin:ToObjectSpace(source:GetPivot())
		copy:PivotTo(relative.Rotation + relative.Position * S)
		copy:ScaleTo(copy:GetScale() * S)
	end
	for _, part in copy:GetDescendants() do
		if part:IsA("BasePart") then
			decorate(part)
			weld(chassis, part)
		end
	end
	copy.Parent = car
end

local function standinName(name: string): boolean
	return (name:lower():gsub("[%s_%-]", "")) == CarFactory.STANDIN_NAME
end

local function findIn(parent: Instance?, deep: boolean): Instance?
	if not parent then
		return nil
	end
	local candidates: { Instance } = if deep then parent:GetDescendants() else parent:GetChildren()
	for _, child in candidates do
		if (child:IsA("BasePart") or child:IsA("Model")) and standinName(child.Name) then
			return child
		end
	end
	return nil
end

local warned = false
local function findStandin(): Instance?
	local found = findIn(ReplicatedStorage:FindFirstChild("Assets"), true)
		or findIn(workspace, false)
		or findIn(ServerStorage, false)
		or findIn(ReplicatedStorage, false)
	if not found and not warned then
		warned = true
		warn(`[CarFactory] no "body car" mesh found (ReplicatedStorage.Assets, or the top of Workspace, ServerStorage or ReplicatedStorage); using the plain body`)
	end
	return found
end

local function number(instance: Instance, name: string): number?
	local value = instance:GetAttribute(name)
	return if type(value) == "number" then value else nil
end

-- The stand-in mesh as the car's body, at the world origin like the rest of the car.
local function standinBody(template: Instance): Model
	local body = Instance.new("Model")
	body.Name = "Body"
	local copy = template:Clone()
	if copy:IsA("BasePart") then
		copy.Parent = body
		-- Measure it in its own frame, so a part turned in Studio still fits.
		body.WorldPivot = copy.CFrame
	else
		local model = copy :: Model
		for _, child in model:GetChildren() do
			child.Parent = body
		end
		body.WorldPivot = model.WorldPivot
		model:Destroy()
	end
	for _, item in body:GetDescendants() do
		if item:IsA("Script") or item:IsA("LocalScript") then
			item:Destroy()
		end
	end

	-- Centre the pivot on its bounds, scale its long side to the car's length, then place it.
	local box, size = body:GetBoundingBox()
	body.WorldPivot = box
	local sideways = size.X > size.Z
	local length = if sideways then size.X else size.Z
	local target = number(template, "Length") or STANDIN_LENGTH
	if length > 0 then
		body:ScaleTo(body:GetScale() * target / length)
		size *= target / length
	end
	local yaw = math.rad((if sideways then 90 else 0) + (number(template, "Yaw") or 0))
	local lift = number(template, "Lift") or 0
	local centre = Vector3.new(0, STANDIN_BOTTOM + lift + size.Y / 2, CAR.ChassisOffset.Z)
	body:PivotTo(CFrame.new(centre) * CFrame.Angles(0, yaw, 0))
	return body
end

-- A car at the world origin (origin on the ground, facing -Z), unanchored; the caller places it.
function CarFactory.build(paint: Color3): Model
	registerCollisionGroup()

	local car = Instance.new("Model")
	car.Name = "ChaseCar"
	car.ModelStreamingMode = Enum.ModelStreamingMode.Persistent

	local chassis = hull("Chassis", CAR.ChassisSize, CAR.ChassisOffset)
	chassis.CustomPhysicalProperties = PhysicalProperties.new(CAR.ChassisDensity, 0.35, 0.05, 1, 1)
	-- Pivot on the ground between the axles, so PivotTo places the car on the road.
	chassis.PivotOffset = CFrame.new(-CAR.ChassisOffset)
	chassis.Parent = car
	car.PrimaryPart = chassis

	local roof = hull("Roof", CAR.RoofSize, CAR.RoofOffset)
	roof.Massless = true
	roof.CustomPhysicalProperties = PhysicalProperties.new(0.5, 0.3, 0.05, 1, 1)
	roof.Parent = car
	weld(chassis, roof)

	local assets = ReplicatedStorage:FindFirstChild("Assets")
	local cars = assets and assets:FindFirstChild("Cars")
	local template = cars and cars:FindFirstChild(CarFactory.ART_NAME)
	local art = if template and template:IsA("Model") and template:FindFirstChild("Body") then template else nil

	local standin = if art then nil else findStandin()

	if art then
		attachArt(car, chassis, art:FindFirstChild("Body") :: Instance, art:GetPivot(), "Body")
	else
		local body = if standin then standinBody(standin) else plainBody(paint)
		for _, part in body:GetDescendants() do
			if part:IsA("BasePart") then
				decorate(part)
				weld(chassis, part)
			end
		end
		body.Parent = car
	end

	-- Wheels: a hub per corner on its suspension joint, carrying the wheel art.
	local wheelArt = art and art:FindFirstChild("Wheel")
	local wheels = Instance.new("Folder")
	wheels.Name = "Wheels"
	wheels.Parent = car

	for _, spec in CAR.Wheels do
		local hub = Instance.new("Part")
		hub.Name = spec.Name
		hub.Size = Vector3.one * 0.4
		hub.Transparency = 1
		decorate(hub)
		hub.CFrame = CFrame.new(spec.Position)
		hub.Parent = wheels

		local motor = Instance.new("Motor6D")
		motor.Name = "Suspension"
		motor.Part0 = chassis
		motor.Part1 = hub
		motor.C0 = CFrame.new(spec.Position - CAR.ChassisOffset)
		motor.Parent = hub

		local visual: Model
		if wheelArt and wheelArt:IsA("Model") then
			visual = wheelArt:Clone()
			visual.Name = "Visual"
			visual:ScaleTo(visual:GetScale() * S)
		else
			visual = plainWheel()
		end
		local flip = if spec.Left then CFrame.Angles(0, math.pi, 0) else CFrame.identity
		visual:PivotTo(CFrame.new(spec.Position) * flip)
		for _, part in visual:GetDescendants() do
			if part:IsA("BasePart") then
				decorate(part)
				weld(hub, part)
			end
		end
		visual.Parent = hub
	end

	-- Seats. Not touchable, so nobody sits by bumping into the car; VehicleService seats people
	-- with Seat:Sit. Set a little lower than the rally car's, for full-size characters.
	local seats: { [string]: Vector3 } = {
		DriverSeat = CAR.DriverSeat - Vector3.new(0, 0.6 * S, 0),
		PassengerSeat = CAR.PassengerSeat - Vector3.new(0, 0.6 * S, 0),
	}
	for name, position in seats do
		local seat = Instance.new("Seat")
		seat.Name = name
		seat.Size = Vector3.new(1.6, 0.4, 1.6)
		seat.CFrame = CFrame.new(position)
		seat.Transparency = 1
		seat.CanTouch = false
		decorate(seat)
		seat.Parent = car
		weld(chassis, seat)
	end

	headlights(car, chassis)

	-- Dust kicked up by each wheel.
	for _, spec in CAR.Wheels do
		local attachment = Instance.new("Attachment")
		attachment.Name = `Dust{spec.Name}`
		attachment.Position = spec.Position - CAR.ChassisOffset - Vector3.new(0, CAR.WheelRadius * 0.8, -0.6 * S)
		attachment.Parent = chassis
		dust(attachment)
	end

	local engine = Instance.new("Sound")
	engine.Name = "Engine"
	engine.Looped = true
	engine.Volume = 0
	engine.RollOffMaxDistance = 600
	engine.Parent = chassis

	return car
end

return CarFactory
