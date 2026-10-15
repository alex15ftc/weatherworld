--!strict
-- Chase cars: one per player, in Workspace.Cars. A player asks for theirs with V (client/Vehicles)
-- or from the debug panel; anyone can ride along in the passenger seat by its prompt.
--
-- Who drives decides everything else. While the owner sits in the driver's seat their client
-- owns the car and runs its physics (client/Vehicles/Physics); the moment the seat is empty the
-- car is parked: anchored where it stopped, because without a driver nothing holds it up on its
-- suspension.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local ChunkGen = require(ReplicatedStorage.Shared.World.ChunkGen)
local Config = require(ReplicatedStorage.Shared.Vehicles.Config)
local Net = require(ReplicatedStorage.Shared.Vehicles.Net)
local CarFactory = require(script.CarFactory)

local CAR = Config.Car

local Vehicles = {}

local PAINTS = {
	Color3.fromRGB(196, 40, 36),
	Color3.fromRGB(232, 232, 228),
	Color3.fromRGB(24, 74, 160),
	Color3.fromRGB(236, 170, 30),
	Color3.fromRGB(32, 112, 64),
	Color3.fromRGB(40, 40, 44),
}
local AHEAD = 16 -- studs in front of the player a new car appears

local cars: { [Player]: Model } = {}
local lastSpawn: { [Player]: number } = {}
local folder: Folder

local function notice(player: Player, text: string)
	Net.Notice:Server():Fire(player, text)
end

local function characterParts(player: Player): (Humanoid?, BasePart?)
	local character = player.Character
	if not character then
		return nil, nil
	end
	return character:FindFirstChildOfClass("Humanoid"), character:FindFirstChild("HumanoidRootPart") :: BasePart?
end

local function seatOf(car: Model, name: string): Seat
	return car:FindFirstChild(name) :: Seat
end

-- Ground height under (x, z), from above `top`: loaded terrain and scenery if there is any,
-- otherwise the generator's height.
local function groundAt(x: number, z: number, top: number): number
	local params = RaycastParams.new()
	local ignore: { Instance } = { folder }
	for _, player in Players:GetPlayers() do
		if player.Character then
			table.insert(ignore, player.Character)
		end
	end
	params.FilterDescendantsInstances = ignore
	params.RespectCanCollide = true
	local hit = workspace:Raycast(Vector3.new(x, top + 60, z), Vector3.new(0, -400, 0), params)
	return if hit then hit.Position.Y else ChunkGen.groundStudsAt(x, z)
end

local function park(car: Model)
	local chassis = car.PrimaryPart
	if chassis and not chassis.Anchored then
		chassis.AssemblyLinearVelocity = Vector3.zero
		chassis.AssemblyAngularVelocity = Vector3.zero
		chassis.Anchored = true
	end
end

-- The owner is in the driver's seat: their client takes the car.
local function release(car: Model, owner: Player)
	local chassis = car.PrimaryPart
	if not chassis then
		return
	end
	chassis.Anchored = false
	chassis:SetNetworkOwner(owner)
end

function Vehicles.remove(player: Player)
	local car = cars[player]
	if car then
		cars[player] = nil
		car:Destroy()
	end
end

function Vehicles.carOf(player: Player): Model?
	return cars[player]
end

local function enter(player: Player): string?
	local car = cars[player]
	local humanoid, root = characterParts(player)
	if not car or not car.PrimaryPart then
		return "you have no car: press V for one"
	elseif not humanoid or not root or humanoid.Health <= 0 then
		return "no character to put in the car"
	end
	if (root.Position - car.PrimaryPart.Position).Magnitude > Config.ENTER_DISTANCE then
		return "your car is too far away (V again for a new one here)"
	end
	local seat = seatOf(car, "DriverSeat")
	if seat.Occupant and seat.Occupant ~= humanoid then
		return "someone is in your driver's seat"
	end
	seat:Sit(humanoid)
	return nil
end

function Vehicles.spawn(player: Player): string
	local humanoid, root = characterParts(player)
	if not humanoid or not root or humanoid.Health <= 0 then
		return "no character to put in a car"
	end
	local now = os.clock()
	if now - (lastSpawn[player] or -math.huge) < Config.SPAWN_COOLDOWN then
		return "wait a moment before asking for another car"
	end
	lastSpawn[player] = now
	Vehicles.remove(player)

	local flat = Vector3.new(root.CFrame.LookVector.X, 0, root.CFrame.LookVector.Z)
	local look = if flat.Magnitude > 0.01 then flat.Unit else Vector3.xAxis
	local spot = root.Position + look * AHEAD
	local ground = groundAt(spot.X, spot.Z, root.Position.Y)

	local car = CarFactory.build(PAINTS[player.UserId % #PAINTS + 1])
	car.Name = `{player.Name}'s car`
	car:SetAttribute("OwnerId", player.UserId)
	car:PivotTo(CFrame.lookAlong(Vector3.new(spot.X, ground + 0.5, spot.Z), look))
	local chassis = car.PrimaryPart :: BasePart
	chassis.Anchored = true

	local driverSeat = seatOf(car, "DriverSeat")
	driverSeat:GetPropertyChangedSignal("Occupant"):Connect(function()
		local occupant = driverSeat.Occupant
		if occupant and occupant.Parent == player.Character then
			release(car, player)
		else
			park(car)
		end
	end)

	-- Anyone near the car can ride along; the owner gets back behind the wheel.
	local prompt = Instance.new("ProximityPrompt")
	prompt.ActionText = "Get in"
	prompt.ObjectText = car.Name
	prompt.MaxActivationDistance = 12
	prompt.RequiresLineOfSight = false
	prompt.Parent = chassis
	prompt.Triggered:Connect(function(who: Player)
		local whoHumanoid = characterParts(who)
		if not whoHumanoid or whoHumanoid.SeatPart then
			return
		end
		if who == player then
			local problem = enter(player)
			if problem then
				notice(player, problem)
			end
			return
		end
		local passengerSeat = seatOf(car, "PassengerSeat")
		if passengerSeat.Occupant then
			notice(who, "the passenger seat is taken")
		else
			passengerSeat:Sit(whoHumanoid)
		end
	end)

	car.Parent = folder
	cars[player] = car
	driverSeat:Sit(humanoid)
	return "car ready: W/S drive, A/D steer, Space hand brake, R put it back on its wheels, V get out"
end

-- Out of the car beside the driver's door; it parks where it is.
function Vehicles.exit(player: Player): string?
	local humanoid = characterParts(player)
	local seat = humanoid and humanoid.SeatPart
	if not humanoid or not seat or not seat.Parent or seat.Parent.Parent ~= folder then
		return nil
	end
	local car = seat.Parent :: Model
	local chassis = car.PrimaryPart :: BasePart
	if chassis.AssemblyLinearVelocity.Magnitude > Config.EXIT_SPEED then
		return "slow down to get out"
	end
	local weld = seat:FindFirstChild("SeatWeld")
	if weld then
		weld:Destroy()
	end
	humanoid.Sit = false
	local side = if seat.Name == "DriverSeat" then -1 else 1
	local character = humanoid.Parent :: Model
	local door = chassis.CFrame * CFrame.new(side * (CAR.ChassisSize.X / 2 + 2.5), 1, 0)
	character:PivotTo(CFrame.lookAlong(door.Position, chassis.CFrame.LookVector))
	return nil
end

function Vehicles.start()
	folder = Instance.new("Folder")
	folder.Name = "Cars"
	folder.Parent = workspace

	Net.Car:Server():On(function(player: Player, action: Net.Action)
		local message: string?
		if action == "spawn" then
			message = Vehicles.spawn(player)
		elseif action == "enter" then
			message = enter(player)
		elseif action == "exit" then
			message = Vehicles.exit(player)
		elseif action == "remove" then
			Vehicles.remove(player)
		end
		if message then
			notice(player, message)
		end
	end)

	Players.PlayerRemoving:Connect(function(player: Player)
		Vehicles.remove(player)
		lastSpawn[player] = nil
	end)
end

return Vehicles
