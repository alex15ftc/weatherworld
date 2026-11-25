--!strict
-- How a building looks after each degree of damage (2026-11-17, BuildingDamageService). A
-- building is a model "B<n>" of its chunk (ChunkGen.place) whose parts carry a Role (wall, roof,
-- glass, door, trim, chimney, porch, porchRoof, shed: Props/Buildings). Each component of its
-- damage indicator (Shared/StormLab/Sim/Damage.DI) that fails changes the parts of its group, as
-- the EF scale describes the degree, and leaves its debris on the ground downwind:
--   trim       trim and porch posts gone (siding and gutters)
--   roofCover  the roof's covering gone: the decking shows (tan boards)
--   windows    glass and doors gone (the envelope breached)
--   roofDeck   porch and garage roofs, chimney and shed gone
--   anchors    the building shifted off its foundation, downwind, a little turned
--   roofFrame  the roof gone
--   extWalls   the walls down to under half their height (nothing left above them)
--   intWalls   the walls down to a fifth
--   allWalls   only stubs of wall left
--   slab       swept clean: a bare slab
-- and for the shops, offices, schools and canopies (their own degrees):
--   doors      doors and the glass at ground level gone
--   canopy     awnings, canopies and covered walkways gone (thin trim)
--   facade     facade, parapet, bands and cladding gone (all trim)
--   penthouse  what stands on the roof gone (roof parts much smaller than the roof)
--   curtain    windows gone, the curtain wall's glass broken (dark)
--   panels     curtain wall panels hanging loose (see-through in places)
--   gutted     the curtain wall mostly gone (mostly see-through), trim gone
--   tallWall   the tallest wall (a gym's, an auditorium's) down to under half
--   deform     the frame bent: the whole building leaning a little downwind
--   bend       a canopy's columns bent downwind
--   drop       a canopy down on the ground
-- The debris of a degree (its class and count from the table) lies downwind of the building, the
-- farther the stronger the degree, each piece placed by the building's seed, the degree and the
-- piece's number and the wind direction recorded with the damage: the same pieces in the same
-- places on every server. Pieces are anchored and do not collide.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local TweenService = game:GetService("TweenService")

local Config = require(ReplicatedStorage.Shared.World.Config)
local Damage = require(ReplicatedStorage.Shared.StormLab.Sim.Damage) :: any

local StructureDamage = {}

local M = Enum.Material
local rgb = Color3.fromRGB
local K = Config.STUDS_PER_METRE
local DECK = rgb(176, 146, 104)
local MAX_PIECES = 6 -- of one degree (a house swept clean leaves about 50)
local FLIGHT_S = 1.6 -- a piece's flight to where it lies, when the damage happens in view

-- debris classes: size (m: length, thickness, width), colour (nil: the building's own) and material
local PIECES: { [string]: { size: Vector3, colour: Color3?, from: string?, material: Enum.Material } } = {
	shingle = { size = Vector3.new(1.0, 0.08, 0.6), from = "roof", material = M.Slate },
	paper = { size = Vector3.new(0.6, 0.05, 0.4), colour = rgb(226, 222, 210), material = M.SmoothPlastic },
	plywood = { size = Vector3.new(2.4, 0.12, 1.2), colour = DECK, material = M.WoodPlanks },
	board = { size = Vector3.new(3.0, 0.15, 0.3), from = "wall", material = M.WoodPlanks },
	beam = { size = Vector3.new(4.5, 0.3, 0.3), colour = rgb(120, 92, 64), material = M.Wood },
	sheetMetal = { size = Vector3.new(2.5, 0.05, 1.0), colour = rgb(170, 174, 178), material = M.CorrodedMetal },
	glass = { size = Vector3.new(0.8, 0.03, 0.6), colour = rgb(150, 190, 210), material = M.Glass },
	block = { size = Vector3.new(0.6, 0.4, 0.4), from = "wall", material = M.Brick },
}

-- the parts of a building with one of the roles
local function partsOf(model: Model, ...: string): { BasePart }
	local want = {}
	for _, r in { ... } do
		want[r] = true
	end
	local out = {}
	for _, d in model:GetChildren() do
		if d:IsA("BasePart") and want[d:GetAttribute("Role") :: string] then
			table.insert(out, d)
		end
	end
	return out
end

local function remove(model: Model, ...: string)
	for _, p in partsOf(model, ...) do
		p:Destroy()
	end
end

-- the walls cut down to a share of their first height, standing on their base
local function cutWalls(model: Model, share: number)
	for _, p in partsOf(model, "wall") do
		local h0 = (p:GetAttribute("H0") :: number?) or p.Size.Y
		p:SetAttribute("H0", h0)
		local h = math.min(p.Size.Y, h0 * share)
		if h < p.Size.Y then
			local drop = (p.Size.Y - h) / 2
			p.Size = Vector3.new(p.Size.X, h, p.Size.Z)
			p.CFrame = p.CFrame * CFrame.new(0, -drop, 0)
		end
	end
end

-- the building's colours, kept on its model before its parts go (for its debris)
local function remember(model: Model)
	if model:GetAttribute("WallColour") then
		return
	end
	local wall, roof = partsOf(model, "wall")[1], partsOf(model, "roof")[1]
	model:SetAttribute("WallColour", if wall then wall.Color else rgb(200, 196, 186))
	model:SetAttribute("RoofColour", if roof then roof.Color else rgb(80, 80, 86))
end

-- the wind's direction from a byte (0 = north, clockwise; world X east, Z south)
function StructureDamage.dirOf(byte: number): (number, number)
	local a = byte / 256 * 2 * math.pi
	return math.sin(a), -math.cos(a)
end

function StructureDamage.byteOf(dx: number, dz: number): number
	return math.floor((math.atan2(dx, -dz) / (2 * math.pi)) % 1 * 256 + 0.5) % 256
end

-- the building's base: its frame on the ground
local function frameOf(model: Model): CFrame
	return (model:GetAttribute("Frame") :: CFrame?) or model:GetPivot()
end

-- every part of the building turned by turn about its base point (the frame) toward dx, dz
local function lean(model: Model, roles: { string }?, degrees: number, dx: number, dz: number)
	local frame = frameOf(model)
	-- (about the horizontal axis across the wind: the top goes downwind)
	local axis = Vector3.new(-dz, 0, dx)
	local turn = CFrame.new(frame.Position) * CFrame.fromAxisAngle(axis, -math.rad(degrees)) * CFrame.new(-frame.Position)
	for _, p in (if roles then partsOf(model, table.unpack(roles)) else model:GetChildren()) do
		if p:IsA("BasePart") and p:GetAttribute("Role") then
			p.CFrame = turn * p.CFrame
		end
	end
end

local function glassLow(model: Model): { BasePart }
	local base = frameOf(model).Y
	local out = {}
	for _, p in partsOf(model, "glass", "door") do
		if p.CFrame.Position.Y - p.Size.Y / 2 < base + 3 * K then
			table.insert(out, p)
		end
	end
	return out
end

local LOOKS: { [string]: (Model, number, number) -> () } = {
	trim = function(model)
		remove(model, "trim")
	end,
	roofCover = function(model)
		for _, p in partsOf(model, "roof", "porchRoof") do
			p.Color = p.Color:Lerp(DECK, 0.75)
			p.Material = M.WoodPlanks
		end
	end,
	windows = function(model)
		remove(model, "glass", "door")
	end,
	roofDeck = function(model)
		remove(model, "porchRoof", "chimney", "shed")
	end,
	anchors = function(model, dx, dz)
		-- (shifted about a tenth of its width and turned a few degrees, about its middle)
		local size = (model:GetAttribute("Size") :: Vector3?) or Vector3.new(10, 5, 10)
		local frame = (model:GetAttribute("Frame") :: CFrame?) or model:GetPivot()
		local move = CFrame.new(dx * size.X * 0.1, 0, dz * size.X * 0.1)
		local turn = frame * CFrame.Angles(0, math.rad(4), 0) * frame:Inverse()
		for _, p in model:GetChildren() do
			if p:IsA("BasePart") and p:GetAttribute("Role") then
				p.CFrame = move * turn * p.CFrame
			end
		end
	end,
	roofFrame = function(model)
		remove(model, "roof", "porchRoof", "chimney")
	end,
	extWalls = function(model)
		remove(model, "roof", "porchRoof", "chimney", "glass", "door", "trim", "porch", "shed")
		cutWalls(model, 0.45)
	end,
	intWalls = function(model)
		remove(model, "roof", "porchRoof", "chimney", "glass", "door", "trim", "porch", "shed")
		cutWalls(model, 0.2)
	end,
	allWalls = function(model)
		remove(model, "roof", "porchRoof", "chimney", "glass", "door", "trim", "porch", "shed")
		cutWalls(model, 0.06)
	end,
	doors = function(model)
		remove(model, "door")
		for _, p in glassLow(model) do
			p:Destroy()
		end
	end,
	canopy = function(model)
		remove(model, "porchRoof")
		for _, p in partsOf(model, "trim") do
			if p.Size.Y < 0.7 then
				p:Destroy()
			end
		end
	end,
	facade = function(model)
		remove(model, "trim", "chimney")
	end,
	penthouse = function(model)
		-- (what stands on the roof: roof parts much smaller across than the roof itself, which
		-- stays for its own degree)
		local roof = partsOf(model, "roof")
		local biggest = 0
		for _, p in roof do
			biggest = math.max(biggest, p.Size.X * p.Size.Z)
		end
		for _, p in roof do
			if p.Size.X * p.Size.Z < 0.5 * biggest then
				p:Destroy()
			end
		end
	end,
	curtain = function(model)
		remove(model, "glass", "door")
		for _, p in partsOf(model, "curtain") do
			p.Color = p.Color:Lerp(rgb(30, 34, 38), 0.6)
			p.Reflectance = 0
		end
	end,
	panels = function(model)
		remove(model, "glass")
		for _, p in partsOf(model, "curtain") do
			p.Color = p.Color:Lerp(rgb(40, 44, 48), 0.7)
			p.Reflectance = 0
			p.Transparency = math.max(p.Transparency, 0.35)
		end
	end,
	gutted = function(model)
		remove(model, "glass", "trim")
		for _, p in partsOf(model, "curtain") do
			p.Color = rgb(36, 38, 40)
			p.Reflectance = 0
			p.Transparency = math.max(p.Transparency, 0.7)
		end
	end,
	tallWall = function(model)
		local tallest = nil :: BasePart?
		for _, p in partsOf(model, "wall") do
			if not tallest or p.Size.Y > tallest.Size.Y then
				tallest = p
			end
		end
		if tallest then
			local h0 = (tallest:GetAttribute("H0") :: number?) or tallest.Size.Y
			tallest:SetAttribute("H0", h0)
			local h = math.min(tallest.Size.Y, h0 * 0.45)
			local drop = (tallest.Size.Y - h) / 2
			tallest.Size = Vector3.new(tallest.Size.X, h, tallest.Size.Z)
			tallest.CFrame = tallest.CFrame * CFrame.new(0, -drop, 0)
		end
	end,
	deform = function(model, dx, dz)
		remove(model, "glass", "trim")
		lean(model, nil, 2.5, dx, dz)
	end,
	bend = function(model, dx, dz)
		lean(model, nil, 9, dx, dz)
	end,
	drop = function(model, dx, dz)
		-- (the canopy down on its collapsed columns, tipped downwind)
		local base = frameOf(model).Y
		remove(model, "wall")
		for _, p in partsOf(model, "roof", "trim") do
			local fall = p.CFrame.Position.Y - p.Size.Y / 2 - base - 1.2 * K
			p.CFrame = CFrame.new(dx * fall * 0.3, -math.max(0, fall), dz * fall * 0.3) * p.CFrame
		end
		lean(model, { "roof", "trim" }, 12, dx, dz)
	end,
	slab = function(model)
		for _, p in model:GetChildren() do
			if p:IsA("BasePart") and p:GetAttribute("Role") then
				p:Destroy()
			end
		end
		local size = (model:GetAttribute("Size") :: Vector3?) or Vector3.new(10, 5, 10)
		local frame = (model:GetAttribute("Frame") :: CFrame?) or model:GetPivot()
		local slab = Instance.new("Part")
		slab.Anchored, slab.CanCollide, slab.CanTouch = true, true, false
		slab.Size = Vector3.new(size.X * 0.8, 0.3 * K, size.Z)
		slab.CFrame = frame * CFrame.new(0, 0.1 * K, 0)
		slab.Color, slab.Material = rgb(176, 172, 164), M.Concrete
		slab.TopSurface, slab.BottomSurface = Enum.SurfaceType.Smooth, Enum.SurfaceType.Smooth
		slab:SetAttribute("Role", "slab")
		slab.Parent = model
	end,
}

-- One failed degree of a building's indicator: its look, and its debris (wind toward dx, dz;
-- seed: the building's). ground(x, z): the ground's height (studs). With fly, the pieces fly
-- from the building to where they lie (the damage happening now, in view).
function StructureDamage.apply(model: Model, di: string, degree: number, dx: number, dz: number, seed: number, ground: (number, number) -> number, fly: boolean?)
	local row = Damage.DI[di] and Damage.DI[di][degree]
	if not row then
		return
	end
	remember(model)
	local look = LOOKS[row[8]]
	if look then
		look(model, dx, dz)
	end
	local class, count = row[6], row[7]
	local spec = class and PIECES[class]
	if not spec or count <= 0 then
		return
	end
	local frame = (model:GetAttribute("Frame") :: CFrame?) or model:GetPivot()
	local size = (model:GetAttribute("Size") :: Vector3?) or Vector3.new(10, 5, 10)
	local rubble = model:FindFirstChild("Rubble") or Instance.new("Folder")
	rubble.Name = "Rubble"
	rubble.Parent = model
	local colour = spec.colour or (model:GetAttribute(if spec.from == "roof" then "RoofColour" else "WallColour") :: Color3?) or DECK
	local rng = Random.new((seed * 31 + degree * 7919) % 2147483647)
	-- (across the wind: the right hand of it)
	local sx, sz = -dz, dx
	local reach = size.X * (0.8 + 0.25 * degree)
	for _ = 1, math.min(count, MAX_PIECES) do
		local along = reach * (0.3 + rng:NextNumber())
		local across = (rng:NextNumber() - 0.5) * (size.X + along * 0.6)
		local x = frame.X + dx * along + sx * across
		local z = frame.Z + dz * along + sz * across
		local s = spec.size * K * (0.7 + 0.6 * rng:NextNumber())
		local p = Instance.new("Part")
		p.Anchored, p.CanCollide, p.CanTouch, p.CanQuery, p.CastShadow = true, false, false, false, false
		p.Size = Vector3.new(s.X, math.max(0.05, s.Y), s.Z)
		p.Color = colour:Lerp(rgb(90, 80, 70), 0.25 * rng:NextNumber())
		p.Material = spec.material
		p.TopSurface, p.BottomSurface = Enum.SurfaceType.Smooth, Enum.SurfaceType.Smooth
		local rest = CFrame.new(x, ground(x, z) + s.Y / 2, z)
			* CFrame.Angles(math.rad(rng:NextNumber() * 16 - 8), rng:NextNumber() * 2 * math.pi, math.rad(rng:NextNumber() * 16 - 8))
		if fly then
			p.CFrame = CFrame.new(frame.X, frame.Y + size.Y * (0.5 + 0.5 * rng:NextNumber()), frame.Z) * rest.Rotation
			p.Parent = rubble
			TweenService:Create(p, TweenInfo.new(FLIGHT_S * (0.6 + 0.8 * rng:NextNumber()), Enum.EasingStyle.Quad, Enum.EasingDirection.Out), { CFrame = rest }):Play()
		else
			p.CFrame = rest
			p.Parent = rubble
		end
	end
end

return StructureDamage
