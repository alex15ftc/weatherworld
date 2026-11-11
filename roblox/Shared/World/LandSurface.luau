--!strict
-- What the ground of open land shows, by its land cover, at a point: the crop of each quarter
-- section, centre pivots on irrigated land, sand blowouts in the sandhills, red soil in the Red
-- Hills, bare ground in the breaks. The world builds its terrain from it (ChunkGen, as a
-- material) and the map draws it (MapBase, as a colour), so the map shows the ground as it is.
-- Pure Luau with no Roblox services.

local Config = require(script and script.Parent.Config or "./Config")

local LandSurface = {}

local SEED_Z = Config.SEED * 29.7 + 0.5

-- Uniform 0 to 1 from integers (the same everywhere for the same inputs).
function LandSurface.hash(a: number, b: number, salt: number): number
	local h = (math.floor(a) * 73856093 + math.floor(b) * 19349663 + salt * 83492791) % 2147483647
	h = (h * 48271) % 2147483647
	h = (h * 48271) % 2147483647
	return h / 2147483647
end
local hash = LandSurface.hash

-- Each surface's terrain material (by Enum.Material name).
LandSurface.MATERIAL = {
	wheat = "Sandstone", -- wheat and stubble
	worked = "Ground", -- worked ground
	crop = "LeafyGrass", -- corn, soybeans
	pasture = "Grass",
	pivotCrop = "LeafyGrass",
	pivotStubble = "Sandstone",
	pivotCorner = "Grass", -- the corners a pivot does not reach
	forest = "LeafyGrass",
	riparian = "LeafyGrass",
	blowout = "Sand",
	sandhillGrass = "Grass",
	redSoil = "Salt", -- red soil (Salt recoloured)
	redGrass = "Grass",
	breaksGround = "Ground",
	breaksGrass = "Grass",
	tallgrass = "LeafyGrass",
	urban = "Pavement", -- where it is paved; grass elsewhere (ChunkGen knows the streets)
	grass = "Grass",
}

-- The terrain's colours, by Enum.Material name (Explore sets them on Workspace.Terrain).
LandSurface.COLOURS = {
	Grass = { 116, 134, 70 }, -- prairie and pasture
	LeafyGrass = { 78, 112, 48 }, -- crops in leaf, woods floor, tallgrass
	Ground = { 112, 88, 62 }, -- worked fields, breaks
	Sandstone = { 196, 170, 108 }, -- wheat and stubble
	Sand = { 214, 196, 150 }, -- sandhill blowouts
	Salt = { 168, 102, 74 }, -- red soil of the Red Hills
	Mud = { 118, 96, 70 }, -- dirt roads, river and lake beds
	Limestone = { 176, 168, 152 }, -- gravel roads
	Asphalt = { 58, 58, 62 },
	Pavement = { 150, 148, 144 },
	Rock = { 124, 112, 96 },
}

local function farmed(irrigated: boolean, mx: number, my: number): string
	local qx, qy = math.floor(mx * 2), math.floor(my * 2) -- quarter sections
	if irrigated then
		local cx, cy = (qx + 0.5) / 2, (qy + 0.5) / 2
		if (mx - cx) ^ 2 + (my - cy) ^ 2 < 0.235 ^ 2 then
			return if hash(qx, qy, 3) < 0.7 then "pivotCrop" else "pivotStubble"
		end
		return "pivotCorner"
	end
	local crop = hash(qx, qy, 1)
	if crop < 0.35 then
		return "wheat"
	elseif crop < 0.6 then
		return "worked"
	elseif crop < 0.86 then
		return "crop"
	end
	return "pasture"
end

local BY_COVER: { [string]: (mx: number, my: number) -> string } = {
	cropland = function(mx, my)
		return farmed(false, mx, my)
	end,
	irrigated = function(mx, my)
		return farmed(true, mx, my)
	end,
	forest = function()
		return "forest"
	end,
	riparian = function()
		return "riparian"
	end,
	sandhillGrass = function(mx, my)
		return if math.noise(mx * 9, my * 9, SEED_Z) > 0.42 then "blowout" else "sandhillGrass"
	end,
	redRange = function(mx, my)
		return if math.noise(mx * 6, my * 6, SEED_Z + 2) > 0.2 then "redSoil" else "redGrass"
	end,
	breaks = function(mx, my)
		return if math.noise(mx * 8, my * 8, SEED_Z + 4) > 0 then "breaksGround" else "breaksGrass"
	end,
	tallgrass = function()
		return "tallgrass"
	end,
	urban = function()
		return "urban"
	end,
}
local function grass(): string
	return "grass"
end

-- The surface of open land of a cover (its key, as WorldMap.meta.cover names it) at a point
-- (map miles).
function LandSurface.at(cover: string, mx: number, my: number): string
	return (BY_COVER[cover] or grass)(mx, my)
end

-- The same, as a function of the point for one cover (for drawing many points of it).
function LandSurface.forCover(cover: string): (mx: number, my: number) -> string
	return BY_COVER[cover] or grass
end

return LandSurface
