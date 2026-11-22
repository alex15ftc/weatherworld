--!strict
-- Looking round the generated world: terrain colours for the Plains, a light haze so the edge of
-- the loaded ground fades out, and each character placed where it comes back, held there until the
-- ground under it has loaded:
--   * on joining, the spot the player was at when they left (PlayerData Spawn, saved every few
--     seconds while they are alive);
--   * after dying, or with no spot saved, their home city (HomeCity: chosen on the first join in
--     SpawnPickerController, through SpawnNet);
--   * with no home city yet, the start point (the edge of the mid-size city, or the Workspace
--     attribute StartMiles = "x,y" in map miles from the NW corner), where the picker is shown.
-- Not used while a streaming test runs.

local Players = game:GetService("Players")
local Lighting = game:GetService("Lighting")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerStorage = game:GetService("ServerStorage")

local Shared = ReplicatedStorage.Shared
local Config = require(Shared.World.Config)
local LandSurface = require(Shared.World.LandSurface)
local Trove = require(Shared.Trove)
local DebugNet = require(Shared.Net.DebugNet)
local SpawnNet = require(Shared.Net.SpawnNet)
local PlayerData = require(Shared.PlayerData)
local HomeCity = require(ServerStorage.Modules.HomeCity)
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

-- Puts a character on the ground at (x, z) studs, held in the air until the ground has loaded,
-- facing yaw (radians about the vertical). With y (where the root was), on the floor under that
-- height, so a player who left indoors comes back indoors rather than on the roof; otherwise, or
-- when nothing is under it any more, on the top surface.
local function placeAt(character: Model, x: number, z: number, y: number?, yaw: number?)
	local root = character:WaitForChild("HumanoidRootPart") :: BasePart
	root.Anchored = true
	local facing = CFrame.Angles(0, yaw or 0, 0)
	character:PivotTo(CFrame.new(x, ChunkGen.groundStudsAt(x, z) + 60 * Config.WORLD_SCALE, z) * facing)
	local position = Vector3.new(x, 0, z)
	while ChunkService.missingWithin(position, 600 * Config.WORLD_SCALE) > 0 do
		task.wait(0.2)
	end
	local params = RaycastParams.new()
	params.FilterDescendantsInstances = { character }
	local floor: number?, lift = nil, 5 * Config.WORLD_SCALE
	if y then
		local under = workspace:Raycast(Vector3.new(x, y, z), Vector3.new(0, -12 * Config.WORLD_SCALE, 0), params)
		if under then
			floor, lift = under.Position.Y, 3 * Config.WORLD_SCALE
		end
	end
	if not floor then
		local hit = workspace:Raycast(Vector3.new(x, Config.RAY_TOP_STUDS, z), Vector3.new(0, -2 * Config.RAY_TOP_STUDS, 0), params)
		floor = if hit then hit.Position.Y else ChunkGen.groundStudsAt(x, z)
	end
	character:PivotTo(CFrame.new(x, (floor :: number) + lift, z) * facing)
	root.Anchored = false
end

-- The player's saved data once it has loaded (PlayerData loads it on joining), or nil after a
-- while (Studio without API access still loads session-only data).
local DATA_WAIT = 30
local function dataOf(player: Player): PlayerData.Class?
	local data = PlayerData.Get(player.UserId)
	local deadline = os.clock() + DATA_WAIT
	while not data.IsLoaded and player.Parent and os.clock() < deadline do
		task.wait(0.1)
	end
	return if data.IsLoaded then data else nil
end

local EDGE = Config.MAP_STUDS / 2 - 600 * Config.WORLD_SCALE

-- The start point on its nearest road (found once), facing along it.
local startSpot: { number }? = nil
local function startOnRoad(): (number, number, number)
	if not startSpot then
		local x, z = startPoint()
		local rx, rz, yaw = HomeCity.roadSpotNear(x, z)
		startSpot = if rx and rz and yaw then { rx, rz, yaw } else { x, z, 0 }
	end
	local s = startSpot :: { number }
	return s[1], s[2], s[3]
end

-- Where a player comes back after dying: on a road at their home city, or at the start point
-- until they have one; the way to face is along the road.
local function homeSpot(player: Player): (number, number, number)
	local data = PlayerData.Read(player.UserId)
	local city = if data then data.Spawn.City else ""
	local x, z, yaw = HomeCity.spawnStuds(city)
	if x and z and yaw then
		return x, z, yaw
	end
	return startOnRoad()
end

-- (a yaw for CFrame.Angles(0, yaw, 0) from a look direction)
local function yawOf(look: Vector3): number
	return math.atan2(-look.X, -look.Z)
end

local joined: { [Player]: boolean } = {} -- placed once this session: later characters are respawns
local placing: { [Player]: boolean } = {} -- being placed: its position is not saved meanwhile

local function place(player: Player, character: Model)
	placing[player] = true
	local x: number, z: number, y: number?, yaw: number? = 0, 0, nil, nil
	local data = dataOf(player)
	local spawn = if data then data.CurrentData.Spawn else nil
	if not joined[player] and spawn and spawn.Saved then
		-- (a spot saved at another world scale, in that scale's studs: the same place on the map)
		local k = if spawn.Scale > 0 then Config.WORLD_SCALE / spawn.Scale else 1
		x, z, y, yaw = math.clamp(spawn.X * k, -EDGE, EDGE), math.clamp(spawn.Z * k, -EDGE, EDGE), spawn.Y * k, spawn.Yaw
	else
		x, z, yaw = homeSpot(player)
	end
	joined[player] = true
	-- (a death clears the saved spot, so a player who leaves while dead comes back home)
	local humanoid = character:WaitForChild("Humanoid", 10) :: Humanoid?
	if humanoid then
		humanoid.Died:Once(function()
			if data and data:IsActive() then
				data:Patch(function(edit)
					edit.Spawn.Saved = false
				end)
			end
		end)
	end
	local ok, err = pcall(placeAt, character, x, z, y, yaw)
	placing[player] = nil
	if not ok then
		warn("[Explore] placing", player.Name, "failed:", err)
	end
	CarService.give(player, character)
end

-- Every few seconds, the spot each living player is at, so they rejoin there (written to the
-- player's data; PlayerData saves it with the rest, and when they leave).
local SAVE_EVERY = 5
local function rememberSpots()
	while true do
		task.wait(SAVE_EVERY)
		for _, player in Players:GetPlayers() do
			if placing[player] or not joined[player] then
				continue
			end
			local data = PlayerData.Get(player.UserId)
			local character = player.Character
			local root = character and character:FindFirstChild("HumanoidRootPart") :: BasePart?
			local humanoid = character and character:FindFirstChildOfClass("Humanoid")
			if not (data.IsLoaded and root and humanoid) or humanoid.Health <= 0 or root.Anchored then
				continue
			end
			local p, yaw = root.Position, yawOf(root.CFrame.LookVector)
			local spawn = data.CurrentData.Spawn
			if spawn.Saved and spawn.Scale == Config.WORLD_SCALE and (p - Vector3.new(spawn.X, spawn.Y, spawn.Z)).Magnitude < Config.WORLD_SCALE * 2 and math.abs(yaw - spawn.Yaw) < 0.2 then
				continue
			end
			data:Patch(function(edit)
				edit.Spawn.Saved = true
				edit.Spawn.X = math.round(p.X * 100) / 100
				edit.Spawn.Y = math.round(p.Y * 100) / 100
				edit.Spawn.Z = math.round(p.Z * 100) / 100
				edit.Spawn.Yaw = math.round(yaw * 1000) / 1000
				edit.Spawn.Scale = Config.WORLD_SCALE
			end)
		end
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

-- The home city: the picker asks whether the player has one (and for the list), and sends their
-- choice, which is taken once (the first join) and moves them there.
local function listenForHomeCity()
	SpawnNet.State:Server():OnInvoke(function(player: Player)
		local data = dataOf(player)
		-- (no data: no picker, as a choice could not be kept)
		return {
			city = if data then data.CurrentData.Spawn.City else nil,
			cities = HomeCity.list(),
		}
	end)
	SpawnNet.Choose:Server():OnInvoke(function(player: Player, name: string): boolean
		if busy[player] or not HomeCity.has(name) then
			return false
		end
		local data = dataOf(player)
		if not data or data.CurrentData.Spawn.City ~= "" then
			return false
		end
		busy[player] = true
		data:Patch(function(edit)
			edit.Spawn.City = name
			edit.Spawn.Saved = false
		end)
		-- (after the first placement, so the two don't fight over the character)
		while placing[player] and player.Parent do
			task.wait(0.2)
		end
		local character = player.Character
		local humanoid = character and character:FindFirstChildOfClass("Humanoid")
		if character and humanoid and humanoid.Health > 0 then
			placing[player] = true
			-- (out of the car first, or the character goes with it)
			humanoid.Sit = false
			task.wait()
			CarService.remove(player)
			local x, z, yaw = HomeCity.spawnStuds(name)
			local ok, err = pcall(placeAt, character, x :: number, z :: number, nil, yaw)
			if not ok then
				warn("[Explore] moving", player.Name, "home failed:", err)
			end
			placing[player] = nil
			pcall(CarService.give, player, character)
		end
		busy[player] = nil
		return true
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
		-- (0.32 at half size: the same haze over the same ground, so its extinction a stud grows
		-- as the world shrinks; Roblox's extinction a stud is about 0.188 x Density^4.15, measured)
		atmosphere.Density = math.clamp((0.32 ^ 4.15 * 0.5 / Config.WORLD_SCALE) ^ (1 / 4.15), 0, 0.9)
		atmosphere.Haze = 1.2
		atmosphere.Color = Color3.fromRGB(200, 210, 222)
		atmosphere.Decay = Color3.fromRGB(150, 160, 175)
		atmosphere.Parent = Lighting
	end
	listenForTeleports()
	listenForHomeCity()
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
			place(player, character)
		end)
		if player.Character then
			task.spawn(size, player, player.Character)
			task.spawn(place, player, player.Character)
		end
	end
	Players.PlayerAdded:Connect(added)
	Players.PlayerRemoving:Connect(function(player: Player)
		busy[player] = nil
		framed[player] = nil
		joined[player] = nil
		placing[player] = nil
		local trove = troves[player]
		troves[player] = nil
		if trove then
			trove:Destroy()
		end
	end)
	for _, player in Players:GetPlayers() do
		added(player)
	end
	task.spawn(rememberSpots)
	local sx, sz = startPoint()
	print(`[WeatherWorld] start at {WorldMap.meta.start.name} ({math.round(sx)}, {math.round(sz)} studs); fly with F, Shift for speed, Q/E down/up`)
end

return ExploreService
