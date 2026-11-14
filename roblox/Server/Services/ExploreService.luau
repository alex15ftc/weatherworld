--!strict
-- Looking round the generated world: terrain colours for the Plains, a light haze so the edge of
-- the loaded ground fades out, and each character placed at the start point (the edge of the
-- mid-size city, or the Workspace attribute StartMiles = "x,y" in map miles from the NW corner),
-- held there until the ground under it has loaded. Not used while a streaming test runs.

local Players = game:GetService("Players")
local Lighting = game:GetService("Lighting")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerStorage = game:GetService("ServerStorage")

local Shared = ReplicatedStorage.Shared
local Config = require(Shared.World.Config)
local LandSurface = require(Shared.World.LandSurface)
local Trove = require(Shared.Trove)
local DebugNet = require(Shared.Net.DebugNet)
local ChunkGen = require(ServerStorage.World.ChunkGen)
local WorldMap = require(ServerStorage.World.WorldMap)
local ChunkService = require(script.Parent.ChunkService)
local CarService = require(script.Parent.CarService)

local ExploreService = {}

-- each player's connections, cleaned up when they leave
local troves: { [Player]: typeof(Trove.new()) } = {}

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
			return WorldMap.worldStudsAt(tonumber(x) :: number, tonumber(y) :: number)
		end
	end
	return WorldMap.worldStudsAt(WorldMap.meta.start.x, WorldMap.meta.start.y)
end

-- Characters at the world's scale (Config.WORLD_SCALE: half size), walking and jumping to match
-- (16 studs a second and the 7.2-stud jump of the full-size place, scaled). The body is scaled
-- once its appearance has loaded, so its accessories are scaled with it.
local WALK_SPEED, JUMP_HEIGHT = 16, 7.2
-- The camera to match: Roblox starts it 12.5 studs behind a full-size character and lets it come
-- no nearer than half a stud. A player's camera starts at the same distance against the smaller
-- body (set once, when they first appear: the zoom is theirs after that) and may come as near.
-- How far out it may go is left as the place has it.
local CAMERA_START, CAMERA_NEAREST = 12.5, 0.5
local framed: { [Player]: boolean } = {}
local function frame(player: Player)
	if framed[player] then
		return
	end
	framed[player] = true
	local farthest = player.CameraMaxZoomDistance
	-- (the zoom is held at the start distance for a moment, then freed: there is no property for
	-- the distance itself)
	player.CameraMinZoomDistance = CAMERA_START * Config.WORLD_SCALE
	player.CameraMaxZoomDistance = CAMERA_START * Config.WORLD_SCALE
	task.wait(1)
	if player.Parent then
		player.CameraMinZoomDistance = CAMERA_NEAREST * Config.WORLD_SCALE
		player.CameraMaxZoomDistance = farthest
	end
end
local function size(player: Player, character: Model)
	if not player:HasAppearanceLoaded() then
		player.CharacterAppearanceLoaded:Wait()
	end
	if character.Parent and math.abs(character:GetScale() - Config.WORLD_SCALE) > 1e-3 then
		character:ScaleTo(Config.WORLD_SCALE)
	end
	local humanoid = character:FindFirstChildOfClass("Humanoid")
	if humanoid then
		humanoid.WalkSpeed = WALK_SPEED * Config.WORLD_SCALE
		humanoid.UseJumpPower = false
		humanoid.JumpHeight = JUMP_HEIGHT * Config.WORLD_SCALE
	end
	frame(player)
end

-- Puts a character on the ground at (x, z) studs, held in the air until the ground has loaded.
local function placeAt(character: Model, x: number, z: number)
	local root = character:WaitForChild("HumanoidRootPart") :: BasePart
	root.Anchored = true
	character:PivotTo(CFrame.new(x, ChunkGen.groundStudsAt(x, z) + 60 * Config.WORLD_SCALE, z))
	local position = Vector3.new(x, 0, z)
	while ChunkService.missingWithin(position, 600 * Config.WORLD_SCALE) > 0 do
		task.wait(0.2)
	end
	local params = RaycastParams.new()
	params.FilterDescendantsInstances = { character }
	local hit = workspace:Raycast(Vector3.new(x, Config.RAY_TOP_STUDS, z), Vector3.new(0, -2 * Config.RAY_TOP_STUDS, 0), params)
	local y = if hit then hit.Position.Y else ChunkGen.groundStudsAt(x, z)
	character:PivotTo(CFrame.new(x, y + 5 * Config.WORLD_SCALE, z))
	root.Anchored = false
end

local function place(character: Model)
	local x, z = startPoint()
	placeAt(character, x, z)
	local player = Players:GetPlayerFromCharacter(character)
	if player then
		CarService.give(player, character)
	end
end

-- The debug page's teleport (DebugPageController): developers only - the "Developer" tag (ConVar:
-- everyone in Studio, and Settings/Backend/Admins.toml), the place's owner, or a group's rank 254+.
local function mayDebug(player: Player): boolean
	if player:HasTag("Developer") then
		return true
	end
	if game.CreatorType == Enum.CreatorType.User and player.UserId == game.CreatorId then
		return true
	end
	if game.CreatorType == Enum.CreatorType.Group then
		local ok, rank = pcall(player.GetRankInGroup, player, game.CreatorId)
		return ok and rank >= 254
	end
	return false
end

local busy: { [Player]: boolean } = {}
local function listenForTeleports()
	local edge = Config.MAP_STUDS / 2 - 600 * Config.WORLD_SCALE
	-- (x and z are finite numbers: DebugNet's validator)
	DebugNet.Teleport:Server():On(function(player: Player, x: number, z: number)
		if busy[player] or not mayDebug(player) then
			return
		end
		local character = player.Character
		if not character then
			return
		end
		busy[player] = true
		-- (the car can't be dragged along by its driver: a new one is made where they land)
		CarService.remove(player)
		pcall(placeAt, character, math.clamp(x, -edge, edge), math.clamp(z, -edge, edge))
		pcall(CarService.give, player, character)
		busy[player] = nil
	end)
end

function ExploreService.Init()
	if workspace:GetAttribute("TestDrive") == true then
		return
	end
	for material, colour in COLOURS do
		workspace.Terrain:SetMaterialColor(material, colour)
	end
	-- Gravity at the world's scale (9.81 m/s2 in studs; the place file may hold the old value).
	workspace.Gravity = Config.GRAVITY
	workspace.Terrain.WaterColor = Color3.fromRGB(62, 92, 96)
	if not Lighting:FindFirstChildOfClass("Atmosphere") then
		local atmosphere = Instance.new("Atmosphere")
		atmosphere.Density = 0.32
		atmosphere.Haze = 1.2
		atmosphere.Color = Color3.fromRGB(200, 210, 222)
		atmosphere.Decay = Color3.fromRGB(150, 160, 175)
		atmosphere.Parent = Lighting
	end
	listenForTeleports()
end

function ExploreService.Start()
	if workspace:GetAttribute("TestDrive") == true then
		return
	end
	local function added(player: Player)
		local trove = Trove.new()
		troves[player] = trove
		trove:Connect(player.CharacterAdded, function(character: Model)
			task.spawn(size, player, character)
			place(character)
		end)
		if player.Character then
			task.spawn(size, player, player.Character)
			task.spawn(place, player.Character)
		end
	end
	Players.PlayerAdded:Connect(added)
	Players.PlayerRemoving:Connect(function(player: Player)
		busy[player] = nil
		framed[player] = nil
		local trove = troves[player]
		troves[player] = nil
		if trove then
			trove:Destroy()
		end
	end)
	for _, player in Players:GetPlayers() do
		added(player)
	end
	local sx, sz = startPoint()
	print(`[WeatherWorld] start at {WorldMap.meta.start.name} ({math.round(sx)}, {math.round(sz)} studs); fly with F, Shift for speed, Q/E down/up`)
end

return ExploreService
