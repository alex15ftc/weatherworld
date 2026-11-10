--!strict
-- Every player has a car: when Explore puts a character on the ground (spawn, respawn, a debug
-- teleport), a car of their own is set down beside them; they start on foot and get in at its
-- seat (user 2026-11-08: not put in the driver's seat on spawn). One car a player; the old one
-- goes when a new one is made or the player leaves.
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
local CAR_SIDE = 14 -- (studs from the character to the car's middle: clear of the ~8-stud-wide body)

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

-- A new car on the ground beside the character, facing the way they face (CAR_SIDE studs to their right).
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
	local right = root.CFrame.RightVector
	local p = root.Position + Vector3.new(right.X, 0, right.Z).Unit * CAR_SIDE
	local params = RaycastParams.new()
	params.FilterDescendantsInstances = { character }
	local hit = workspace:Raycast(p + Vector3.new(0, 40, 0), Vector3.new(0, -200, 0), params)
	local groundY = if hit then hit.Position.Y else p.Y - 3
	local car = t:Clone()
	car.Name = "Car_" .. player.UserId
	local look = root.CFrame.LookVector
	local yaw = math.atan2(-look.X, -look.Z)
	car:PivotTo(CFrame.new(p.X, groundY + pivotAboveBottom + 0.5, p.Z) * CFrame.Angles(0, yaw, 0) * t:GetPivot().Rotation)
	-- (kept streamed in for its driver wherever they go: its client scripts need all of it)
	car.ModelStreamingMode = Enum.ModelStreamingMode.PersistentPerPlayer
	car.Parent = workspace
	car:AddPersistentPlayer(player)
	cars[player] = car
end

return PlayerCars
