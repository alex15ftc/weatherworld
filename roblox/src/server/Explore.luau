--!strict
-- Looking round the generated world: terrain colours for the Plains, a light haze so the edge of
-- the loaded ground fades out, and each character placed at the start point (the edge of the
-- mid-size city, or the Workspace attribute StartMiles = "x,y" in map miles from the NW corner),
-- held there until the ground under it has loaded. Not used while a streaming test runs.

local Players = game:GetService("Players")
local Lighting = game:GetService("Lighting")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local Config = require(ReplicatedStorage.Shared.World.Config)
local ChunkGen = require(ReplicatedStorage.Shared.World.ChunkGen)
local WorldMap = require(ReplicatedStorage.Shared.World.WorldMap)
local LandSurface = require(ReplicatedStorage.Shared.World.LandSurface)
local ChunkManager = require(script.Parent.ChunkManager)
local PlayerCars = require(script.Parent.PlayerCars)

local Explore = {}

local M = Enum.Material
-- The terrain's colours, shared with the map (LandSurface).
local COLOURS: { [Enum.Material]: Color3 } = {}
for name, c in LandSurface.COLOURS do
	COLOURS[(M :: any)[name]] = Color3.fromRGB(c[1], c[2], c[3])
end

local function startPoint(): (number, number)
	local text = workspace:GetAttribute("StartMiles")
	if typeof(text) == "string" then
		local x, y = string.match(text, "^%s*([%d%.%-]+)%s*,%s*([%d%.%-]+)%s*$")
		if x and y then
			return WorldMap.studsAt(tonumber(x) :: number, tonumber(y) :: number)
		end
	end
	return WorldMap.studsAt(WorldMap.meta.start.x, WorldMap.meta.start.y)
end

-- Puts a character on the ground at (x, z) studs, held in the air until the ground has loaded.
local function placeAt(character: Model, x: number, z: number)
	local root = character:WaitForChild("HumanoidRootPart") :: BasePart
	root.Anchored = true
	character:PivotTo(CFrame.new(x, ChunkGen.groundStudsAt(x, z) + 60, z))
	local position = Vector3.new(x, 0, z)
	while ChunkManager.missingWithin(position, 600) > 0 do
		task.wait(0.2)
	end
	local params = RaycastParams.new()
	params.FilterDescendantsInstances = { character }
	local hit = workspace:Raycast(Vector3.new(x, Config.RAY_TOP_STUDS, z), Vector3.new(0, -2 * Config.RAY_TOP_STUDS, 0), params)
	local y = if hit then hit.Position.Y else ChunkGen.groundStudsAt(x, z)
	character:PivotTo(CFrame.new(x, y + 5, z))
	root.Anchored = false
end

local function place(character: Model)
	local x, z = startPoint()
	placeAt(character, x, z)
	local player = Players:GetPlayerFromCharacter(character)
	if player then
		PlayerCars.give(player, character)
	end
end

-- The debug page's teleport (client/DebugPage): only in Studio or for the place's owner.
local function mayDebug(player: Player): boolean
	if RunService:IsStudio() or player.UserId == game.CreatorId then
		return true
	end
	if game.CreatorType == Enum.CreatorType.Group then
		local ok, rank = pcall(player.GetRankInGroup, player, game.CreatorId)
		return ok and rank >= 254
	end
	return false
end

local function debugRemotes()
	local folder = Instance.new("Folder")
	folder.Name = "Debug"
	local teleport = Instance.new("RemoteEvent")
	teleport.Name = "Teleport"
	teleport.Parent = folder
	folder.Parent = ReplicatedStorage
	local busy: { [Player]: boolean } = {}
	local edge = Config.MAP_STUDS / 2 - 600
	teleport.OnServerEvent:Connect(function(player: Player, x: any, z: any)
		if typeof(x) ~= "number" or typeof(z) ~= "number" or x ~= x or z ~= z or busy[player] or not mayDebug(player) then
			return
		end
		local character = player.Character
		if not character then
			return
		end
		busy[player] = true
		-- (the car can't be dragged along by its driver: a new one is made where they land)
		PlayerCars.remove(player)
		pcall(placeAt, character, math.clamp(x, -edge, edge), math.clamp(z, -edge, edge))
		pcall(PlayerCars.give, player, character)
		busy[player] = nil
	end)
	Players.PlayerRemoving:Connect(function(player: Player)
		busy[player] = nil
	end)
end

function Explore.start()
	if workspace:GetAttribute("TestDrive") == true then
		return
	end
	for material, colour in COLOURS do
		workspace.Terrain:SetMaterialColor(material, colour)
	end
	workspace.Terrain.WaterColor = Color3.fromRGB(62, 92, 96)
	if not Lighting:FindFirstChildOfClass("Atmosphere") then
		local atmosphere = Instance.new("Atmosphere")
		atmosphere.Density = 0.32
		atmosphere.Haze = 1.2
		atmosphere.Color = Color3.fromRGB(200, 210, 222)
		atmosphere.Decay = Color3.fromRGB(150, 160, 175)
		atmosphere.Parent = Lighting
	end
	local function added(player: Player)
		player.CharacterAdded:Connect(place)
		if player.Character then
			task.spawn(place, player.Character)
		end
	end
	debugRemotes()
	Players.PlayerAdded:Connect(added)
	for _, player in Players:GetPlayers() do
		added(player)
	end
	local sx, sz = startPoint()
	print(`[WeatherWorld] start at {WorldMap.meta.start.name} ({math.round(sx)}, {math.round(sz)} studs); fly with F, Shift for speed, Q/E down/up`)
end

return Explore
