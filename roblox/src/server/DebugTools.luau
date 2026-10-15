--!strict
-- Test controls for the debug panel (client/DebugPanel, opened with F2): teleport, go to and move
-- the recorded tornado, the chase car (server/Vehicles), time of day, walk speed and health.
-- Studio only: outside Studio nothing is set up, so no player can use them.
--
-- Map points are miles east and south of the map's north-west corner (as WorldMap uses them).

local Lighting = game:GetService("Lighting")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local Config = require(ReplicatedStorage.Shared.World.Config)
local WorldMap = require(ReplicatedStorage.Shared.World.WorldMap)
local Explore = require(script.Parent.Explore)
local Vehicles = require(script.Parent.Vehicles)
local WeatherFeed = require(script.Parent.WeatherFeed)

local DebugTools = {}

local function inMap(x: unknown, y: unknown): boolean
	return type(x) == "number" and type(y) == "number" and x >= 0 and y >= 0 and x <= Config.MAP_MILES and y <= Config.MAP_MILES
end

local function round(value: number): string
	return tostring(math.round(value))
end

local function characterParts(player: Player): (Model?, Humanoid?, BasePart?)
	local character = player.Character
	if not character then
		return nil, nil, nil
	end
	local humanoid = character:FindFirstChildOfClass("Humanoid")
	local root = character:FindFirstChild("HumanoidRootPart") :: BasePart?
	return character, humanoid, root
end

function DebugTools.start()
	if not RunService:IsStudio() then
		return
	end

	local folder = Instance.new("Folder")
	folder.Name = "Debug"
	local settlementsFunction = Instance.new("RemoteFunction")
	settlementsFunction.Name = "Settlements"
	settlementsFunction.Parent = folder
	local commandEvent = Instance.new("RemoteEvent")
	commandEvent.Name = "Command"
	commandEvent.Parent = folder
	local statusEvent = Instance.new("RemoteEvent")
	statusEvent.Name = "Status"
	statusEvent.Parent = folder
	folder.Parent = ReplicatedStorage

	local function status(player: Player, text: string)
		statusEvent:FireClient(player, text)
	end

	settlementsFunction.OnServerInvoke = function(_player: Player)
		local list = {}
		for _, settlement in WorldMap.meta.settlements do
			table.insert(list, { name = settlement.name, kind = settlement.kind, x = settlement.x, y = settlement.y })
		end
		return list
	end

	local function teleport(player: Player, x: number, y: number)
		local character = player.Character
		if not character then
			return
		end
		status(player, `teleporting to {round(x)}, {round(y)} mi...`)
		local sx, sz = WorldMap.studsAt(x, y)
		Explore.moveTo(character, sx, sz)
		status(player, `at {round(x)}, {round(y)} mi`)
	end

	commandEvent.OnServerEvent:Connect(function(player: Player, command: any)
		if type(command) ~= "table" then
			return
		end
		local kind = command.kind
		if kind == "teleport" then
			if not inMap(command.x, command.y) then
				status(player, "that point is off the map")
				return
			end
			teleport(player, command.x, command.y)
		elseif kind == "toTornado" then
			local x, y = WeatherFeed.tornadoMiles()
			if not x or not y then
				status(player, "no tornado: the storm replay is not running")
			elseif not inMap(x, y) then
				status(player, "the tornado is off the map")
			else
				teleport(player, x, y)
			end
		elseif kind == "tornado" then
			if not inMap(command.x, command.y) then
				status(player, "that point is off the map")
				return
			end
			local ok, message = WeatherFeed.moveReplay(command.x, command.y)
			status(player, if ok then `tornado moved to {round(command.x)}, {round(command.y)} mi` else message)
		elseif kind == "clear" then
			local ok, message = WeatherFeed.moveReplay()
			status(player, if ok then "tornado back where the recording had it" else message)
		elseif kind == "car" then
			status(player, Vehicles.spawn(player))
		elseif kind == "deleteCar" then
			Vehicles.remove(player)
			status(player, "car removed")
		elseif kind == "walkSpeed" then
			local _, humanoid = characterParts(player)
			if humanoid and type(command.value) == "number" then
				humanoid.WalkSpeed = math.clamp(command.value, 0, 200)
			end
		elseif kind == "heal" then
			local _, humanoid = characterParts(player)
			if humanoid then
				humanoid.Health = humanoid.MaxHealth
				status(player, "healed")
			end
		elseif kind == "time" then
			if type(command.hours) == "number" then
				Lighting.ClockTime = math.clamp(command.hours, 0, 24)
			end
		end
	end)

	print("[DebugTools] Studio test controls are on (F2 in the client)")
end

return DebugTools
