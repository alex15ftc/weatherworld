--!strict
-- The chase car on this client (VehicleService makes and seats them; replies come as chat).
--
-- V: out of the car if you are in one; otherwise back into yours if it is near, or a new one
-- ahead of you. R: put the car back on its wheels. While in the driver's seat this client runs
-- the car's physics every frame; jumping is off while seated, so Space is the hand brake.

local Players = game:GetService("Players")
local ReplicatedFirst = game:GetService("ReplicatedFirst")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local UserInputService = game:GetService("UserInputService")

local Config = require(ReplicatedStorage.Shared.Vehicles.Config)
local Net = require(ReplicatedStorage.Shared.Vehicles.Net)
local Modules = ReplicatedFirst:WaitForChild("Modules"):WaitForChild("Vehicles")
local Physics = require(Modules:WaitForChild("Physics"))
local Input = require(Modules:WaitForChild("Input"))
local Effects = require(Modules:WaitForChild("Effects"))
local Session = require(Modules:WaitForChild("Session"))

local VehicleController = {}

local player = Players.LocalPlayer
local sim: Physics.Sim? = nil
local lastRecover = 0

-- Terrain chunks stream in after the car does, so the car could drop through ground that has
-- not arrived yet: hold it still until there is something solid under it (or a timeout).
local LOAD_MIN, LOAD_MAX = 0.2, 6
local loadStartedAt: number? = nil

local function cars(): Instance?
	return workspace:FindFirstChild("Cars")
end

local function ownCar(): Model?
	local folder = cars()
	if not folder then
		return nil
	end
	for _, car in folder:GetChildren() do
		if car:IsA("Model") and car:GetAttribute("OwnerId") == player.UserId then
			return car
		end
	end
	return nil
end

local function hasGround(chassis: BasePart): boolean
	local params = RaycastParams.new()
	local ignore: { Instance } = {}
	local folder = cars()
	if folder then
		table.insert(ignore, folder)
	end
	for _, other in Players:GetPlayers() do
		if other.Character then
			table.insert(ignore, other.Character)
		end
	end
	params.FilterDescendantsInstances = ignore
	return workspace:Raycast(chassis.Position + Vector3.new(0, 3, 0), Vector3.new(0, -40, 0), params) ~= nil
end

-- True while the car should stay frozen.
local function holdForGround(current: Physics.Sim): boolean
	local startedAt = loadStartedAt
	if not startedAt then
		return false
	end
	local waited = os.clock() - startedAt
	if waited < LOAD_MIN or (waited < LOAD_MAX and not hasGround(current.Chassis)) then
		current.Chassis.Anchored = true
		return true
	end
	loadStartedAt = nil
	current.Chassis.Anchored = false
	return false
end

local function recover()
	local current = sim
	if not current or os.clock() - lastRecover < 1.5 then
		return
	end
	lastRecover = os.clock()
	local chassis = current.Chassis
	local look = chassis.CFrame.LookVector
	local flat = Vector3.new(look.X, 0, look.Z)
	flat = if flat.Magnitude > 0.05 then flat.Unit else Vector3.zAxis
	local origin = current.Car:GetPivot().Position
	current.Car:PivotTo(CFrame.lookAlong(origin + Vector3.new(0, 2 * Config.SCALE + 1, 0), flat))
	chassis.AssemblyLinearVelocity = Vector3.zero
	chassis.AssemblyAngularVelocity = Vector3.zero
end

local function onSeat(humanoid: Humanoid)
	local seat = humanoid.SeatPart
	local folder = cars()
	local car = if seat and folder and seat.Parent and seat.Parent.Parent == folder then seat.Parent :: Model else nil

	-- In any car seat, Space is not a jump (it is the driver's hand brake).
	humanoid:SetStateEnabled(Enum.HumanoidStateType.Jumping, car == nil)

	if car and seat and seat.Name == "DriverSeat" then
		if not sim or sim.Car ~= car then
			sim = Physics.new(car)
			Session.Sim = sim
			loadStartedAt = os.clock()
		end
	else
		sim = nil
		Session.Sim = nil
		loadStartedAt = nil
	end
end

local function onCharacter(character: Model)
	sim = nil
	Session.Sim = nil
	local humanoid = character:WaitForChild("Humanoid") :: Humanoid
	humanoid:GetPropertyChangedSignal("SeatPart"):Connect(function()
		onSeat(humanoid)
	end)
	onSeat(humanoid)
end

local function use()
	local character = player.Character
	local humanoid = character and character:FindFirstChildOfClass("Humanoid")
	local root = character and character:FindFirstChild("HumanoidRootPart") :: BasePart?
	if not humanoid or not root then
		return
	end
	local seat = humanoid.SeatPart
	local folder = cars()
	if seat and folder and seat:IsDescendantOf(folder) then
		Net.Car:Client():Fire("exit")
		return
	end
	local car = ownCar()
	local chassis = car and car.PrimaryPart
	if chassis and (chassis.Position - root.Position).Magnitude <= Config.ENTER_DISTANCE then
		Net.Car:Client():Fire("enter")
	else
		Net.Car:Client():Fire("spawn")
	end
end

function VehicleController.Start()
	Effects.start(function()
		return Session.Sim
	end)

	player.CharacterAdded:Connect(onCharacter)
	if player.Character then
		task.spawn(onCharacter, player.Character)
	end

	UserInputService.InputBegan:Connect(function(input: InputObject, processed: boolean)
		if processed then
			return
		end
		if input.KeyCode == Enum.KeyCode.V or input.KeyCode == Enum.KeyCode.ButtonY then
			use()
		elseif input.KeyCode == Enum.KeyCode.R or input.KeyCode == Enum.KeyCode.ButtonX then
			recover()
		end
	end)

	RunService.PreSimulation:Connect(function(dt: number)
		local current = sim
		if not current or not current.Car.Parent then
			return
		end
		if holdForGround(current) then
			return
		end
		current:step(dt, Input.read())
	end)
end

return VehicleController
