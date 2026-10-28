--!strict
-- Every player drives: when Explore puts a character on the ground (spawn, respawn, a debug
-- teleport), a car of their own is set down there and they are put in its driver's seat. One car
-- a player; the old one goes when a new one is made or the player leaves.
--
-- The car is the place's ServerStorage.CarTemplate (Roblox's endorsed car template; its scripts
-- unsandboxed 2026-10-28). A Workspace.Car instead is copied there at start. Its top speed is its MaxSpeed attribute in mph
-- (CAR_MAX_MPH). Its Chassis module is wrapped by server/CarChassis so that MaxSpeed is the top
-- speed: on its own it sets the wheels' spin to MaxSpeed in studs/s as rad/s (1.5x too fast on
-- this car's 1.5-stud wheels).

local Players = game:GetService("Players")
local ServerStorage = game:GetService("ServerStorage")

local PlayerCars = {}

local CAR_MAX_MPH = 100

local template: Model? = nil
local pivotAboveBottom = 0 -- studs from the car's lowest point up to its pivot
local cars: { [Player]: Model } = {}

-- Takes the template out of the world. Call first thing on the server, before players arrive.
function PlayerCars.start()
	local stored = ServerStorage:FindFirstChild("CarTemplate")
	local live = workspace:FindFirstChild("Car")
	if stored and stored:IsA("Model") then
		template = stored
		if live then
			live:Destroy()
		end
	elseif live and live:IsA("Model") then
		local copy = live:Clone()
		live:Destroy()
		copy.Name = "CarTemplate"
		copy.Parent = ServerStorage
		template = copy
	else
		warn("[PlayerCars] no Workspace.Car to copy: players spawn on foot")
		return
	end
	local t = template :: Model
	t:SetAttribute("MaxSpeed", CAR_MAX_MPH)
	-- (the speed fix: server/CarChassis wraps the template's own Chassis module)
	local scripts = t:FindFirstChild("Scripts")
	local base = scripts and scripts:FindFirstChild("Chassis")
	if scripts and base and not scripts:FindFirstChild("ChassisBase") then
		base.Name = "ChassisBase"
		local fix = script.Parent.CarChassis:Clone()
		fix.Name = "Chassis"
		-- (the car's scripts may run sandboxed; a sandboxed script can only require a module
		-- sandboxed the same way)
		local fixAny: any, baseAny: any = fix, base
		pcall(function()
			fixAny.Capabilities = baseAny.Capabilities
			fixAny.Sandboxed = baseAny.Sandboxed
		end)
		fix.Parent = scripts
	end
	local box, size = t:GetBoundingBox()
	pivotAboveBottom = t:GetPivot().Position.Y - (box.Position.Y - size.Y / 2)
	Players.PlayerRemoving:Connect(function(player: Player)
		PlayerCars.remove(player)
	end)
end

function PlayerCars.remove(player: Player)
	local car = cars[player]
	cars[player] = nil
	if car then
		car:Destroy()
	end
end

-- A new car on the ground where the character stands, with the character in the driver's seat.
function PlayerCars.give(player: Player, character: Model)
	local t = template
	if not t or character.Parent == nil then
		return
	end
	PlayerCars.remove(player)
	local root = character:FindFirstChild("HumanoidRootPart") :: BasePart?
	local humanoid = character:FindFirstChildOfClass("Humanoid")
	if not root or not humanoid then
		return
	end
	local p = root.Position
	local params = RaycastParams.new()
	params.FilterDescendantsInstances = { character }
	local hit = workspace:Raycast(p + Vector3.new(0, 40, 0), Vector3.new(0, -200, 0), params)
	local groundY = if hit then hit.Position.Y else p.Y - 3
	local car = t:Clone()
	car.Name = "Car_" .. player.UserId
	car:PivotTo(CFrame.new(p.X, groundY + pivotAboveBottom + 0.5, p.Z) * t:GetPivot().Rotation)
	-- (kept streamed in for its driver wherever they go: its client scripts need all of it)
	car.ModelStreamingMode = Enum.ModelStreamingMode.PersistentPerPlayer
	car.Parent = workspace
	car:AddPersistentPlayer(player)
	cars[player] = car
	local seat = car:FindFirstChild("Chassis") and (car :: any).Chassis:FindFirstChildOfClass("VehicleSeat")
	task.wait(0.3) -- (the car settles and reaches the client first)
	if seat and cars[player] == car and humanoid.Health > 0 and character.Parent then
		seat:Sit(humanoid)
	end
end

return PlayerCars
