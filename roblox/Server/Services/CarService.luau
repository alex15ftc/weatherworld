--!strict
-- Every player has a car: when Explore puts a character on the ground (spawn, respawn, a debug
-- teleport), a car of their own is set down in front of them, facing the way they face; they start on foot and get in at its
-- seat (user 2026-11-08: not put in the driver's seat on spawn). One car a player; the old one
-- goes when a new one is made or the player leaves.
--
-- The cars are the engine-sim cars from EngineSimRoblox (user 2026-11-14): VehicleService rigs
-- the ServerStorage.Vehicles templates and the owner's client simulates them (engine, drivetrain,
-- tires: Client/Modules/EngineSim and Vehicle). Everyone gets the pickup (a 1996 Chevy C1500);
-- the F4 menu swaps it for the Crown Victoria (VehicleNet.Choose), which is set down in front of them
-- in its place and kept for their next spawn.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local VehicleConfigs = require(ReplicatedStorage.Shared.VehicleConfigs)
local VehicleNet = require(ReplicatedStorage.Shared.Net.VehicleNet)
local VehicleService = require(script.Parent.VehicleService)
local WorldConfig = require(ReplicatedStorage.Shared.World.Config)

local CarService = {}

local DEFAULT_CAR = "Pickup"
-- (studs from the character to the car's middle: clear of its body, at the world's scale)
-- (studs from the character to the car's middle: half a car and a step)
local CAR_AHEAD = 17 * WorldConfig.WORLD_SCALE
local CHOOSE_COOLDOWN = 2 -- s between car swaps

local cars: { [Player]: Model } = {}
local chosen: { [Player]: string } = {}
local lastChoose: { [Player]: number } = {}

function CarService.Init()
	Players.PlayerRemoving:Connect(function(player: Player)
		CarService.remove(player)
		chosen[player] = nil
		lastChoose[player] = nil
	end)
end

function CarService.Start()
	VehicleNet.Choose:Server():On(function(player: Player, key: string)
		local now = os.clock()
		if now - (lastChoose[player] or -math.huge) < CHOOSE_COOLDOWN then
			return
		end
		if not VehicleConfigs.ByKey[key] or not VehicleService.has(key) then
			return
		end
		lastChoose[player] = now
		chosen[player] = key
		local character = player.Character
		local humanoid = character and character:FindFirstChildOfClass("Humanoid")
		if character and humanoid and humanoid.Health > 0 then
			-- (out of the old one first, or the character goes with it)
			humanoid.Sit = false
			CarService.give(player, character)
		end
	end)
end

function CarService.remove(player: Player)
	local car = cars[player]
	cars[player] = nil
	if car then
		car:Destroy()
	end
end

-- A new car on the ground in front of the character, facing the way they face (its middle
-- CAR_AHEAD studs ahead): on a road spawn, in their lane, pointing down the road.
function CarService.give(player: Player, character: Model)
	if character.Parent == nil then
		return
	end
	local key = chosen[player] or DEFAULT_CAR
	if not VehicleService.has(key) then
		return
	end
	CarService.remove(player)
	local root = character:FindFirstChild("HumanoidRootPart") :: BasePart?
	local humanoid = character:FindFirstChildOfClass("Humanoid")
	if not root or not humanoid then
		return
	end
	local look = root.CFrame.LookVector
	local flat = Vector3.new(look.X, 0, look.Z)
	flat = if flat.Magnitude > 1e-3 then flat.Unit else Vector3.zAxis
	local p = root.Position + flat * CAR_AHEAD
	local params = RaycastParams.new()
	params.FilterDescendantsInstances = { character }
	local hit = workspace:Raycast(p + Vector3.new(0, 40, 0), Vector3.new(0, -200, 0), params)
	local groundY = if hit then hit.Position.Y else p.Y - 3 * WorldConfig.WORLD_SCALE
	local at = CFrame.lookAlong(Vector3.new(p.X, groundY + VehicleService.pivotHeight(key) + 0.5 * WorldConfig.WORLD_SCALE, p.Z), flat, Vector3.yAxis)
	local car = VehicleService.spawn(key, at)
	if not car then
		return
	end
	car.Name = "Car_" .. player.UserId
	-- (kept streamed in for its driver wherever they go: their client simulates it)
	car.ModelStreamingMode = Enum.ModelStreamingMode.PersistentPerPlayer
	car:AddPersistentPlayer(player)
	cars[player] = car
end

return CarService
