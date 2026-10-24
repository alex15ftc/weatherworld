-- Tornado lab: a flat field and no character (the camera is the lab's own rig). Lighting and
-- the cloud deck are set by the client so the debug panel can change them live.
local Players = game:GetService("Players")
local Workspace = game:GetService("Workspace")

Players.CharacterAutoLoads = false
-- the cloud kit's uploaded meshes, for the old storm mode's storms (shared/Weather/CloudKit).
-- Shelved 2026-10-23 with that storm mode (the storm is now built round the lab tornado, StormBase)
local OLD_STORM_MODE = false
if OLD_STORM_MODE then
	local RS = game:GetService("ReplicatedStorage")
	local KitConfig = require(RS:WaitForChild("Shared"):WaitForChild("World"):WaitForChild("Config"))
	require(RS.Shared:WaitForChild("Weather"):WaitForChild("CloudKit")).serverLoad(KitConfig.STORM_KIT.meshAsset)
end

local TILE = 2048
local RADIUS = 2 -- tiles each way from the middle: a 5 x 5 field, ~10k studs across

local ground = Instance.new("Model")
ground.Name = "LabGround"
for i = -RADIUS, RADIUS do
	for j = -RADIUS, RADIUS do
		local p = Instance.new("Part")
		p.Name = string.format("Ground_%d_%d", i, j)
		p.Anchored = true
		p.Locked = true
		p.Size = Vector3.new(TILE, 16, TILE)
		p.Position = Vector3.new(i * TILE, -8, j * TILE)
		p.Material = Enum.Material.Grass
		p.Color = Color3.fromRGB(104, 132, 72)
		p.TopSurface = Enum.SurfaceType.Smooth
		p.BottomSurface = Enum.SurfaceType.Smooth
		p.Parent = ground
	end
end
ground.Parent = Workspace

-- Scale cues like the real photos (docs/tornado-reference/real/01_cone_a, 03_stovepipe_a): Plains
-- shelterbelts and pole-lined roads. Tree rows form a square ROW_OUT studs round the tornado, past
-- the camera's usual distance, so from any bearing a row sits on the horizon behind the funnel
-- and none stands between the camera and the contact. Sizes in studs = metres.
do
	local ROW_OUT = 1100
	local ROW_HALF = 2200 -- each row runs this far either side
	local TREE_GAP = 10
	local rng = Random.new(42)
	local scenery = Instance.new("Model")
	scenery.Name = "LabScenery"

	local function part(size: Vector3, cf: CFrame, color: Color3, material: Enum.Material): Part
		local p = Instance.new("Part")
		p.Anchored = true
		p.CanCollide = false
		p.CanQuery = false
		p.CanTouch = false
		p.CastShadow = false
		p.Locked = true
		p.Size = size
		p.CFrame = cf
		p.Color = color
		p.Material = material
		p.TopSurface = Enum.SurfaceType.Smooth
		p.BottomSurface = Enum.SurfaceType.Smooth
		p.Parent = scenery
		return p
	end

	-- a poplar/elm crown: a stretched sphere standing on the ground
	local function tree(x: number, z: number)
		local h = rng:NextNumber(14, 26)
		local w = h * rng:NextNumber(0.35, 0.6)
		local shade = rng:NextNumber(0.8, 1.1)
		local crown = part(Vector3.new(w, h, w), CFrame.new(x, h * 0.5 + 2, z),
			Color3.fromRGB(math.floor(38 * shade), math.floor(52 * shade), math.floor(30 * shade)), Enum.Material.Grass)
		local mesh = Instance.new("SpecialMesh")
		mesh.MeshType = Enum.MeshType.Sphere
		mesh.Parent = crown
		part(Vector3.new(1.2, 4, 1.2), CFrame.new(x, 2, z), Color3.fromRGB(52, 44, 36), Enum.Material.Wood)
	end

	for side = -1, 1, 2 do
		for _, alongX in { true, false } do
			local s = -ROW_HALF
			while s <= ROW_HALF do
				local off = side * ROW_OUT + rng:NextNumber(-3, 3)
				if alongX then
					tree(s, off)
				else
					tree(off, s)
				end
				s += TREE_GAP * rng:NextNumber(0.7, 1.3)
			end
		end
	end

	-- gravel roads with wooden power poles (12 m, 60 m apart) along x = ROAD and z = ROAD
	local ROAD = 260
	local gravel = Color3.fromRGB(122, 100, 82)
	part(Vector3.new(8, 0.2, ROW_HALF * 2), CFrame.new(ROAD, 0.1, 0), gravel, Enum.Material.Ground)
	part(Vector3.new(ROW_HALF * 2, 0.2, 8), CFrame.new(0, 0.1, ROAD), gravel, Enum.Material.Ground)
	local poleColour = Color3.fromRGB(70, 58, 46)
	for s = -ROW_HALF, ROW_HALF, 60 do
		for _, at in { Vector3.new(ROAD + 9, 0, s), Vector3.new(s, 0, ROAD + 9) } do
			part(Vector3.new(0.5, 12, 0.5), CFrame.new(at + Vector3.new(0, 6, 0)), poleColour, Enum.Material.Wood)
			-- the cross-arm runs across the road
			local arm = if at.X == ROAD + 9 then Vector3.new(2.6, 0.3, 0.3) else Vector3.new(0.3, 0.3, 2.6)
			part(arm, CFrame.new(at + Vector3.new(0, 11.2, 0)), poleColour, Enum.Material.Wood)
		end
	end
	scenery.Parent = Workspace
end
