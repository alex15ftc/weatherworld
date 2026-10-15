--!strict
-- Trees of the Plains, built from a few parts each: a tapering trunk, limbs, and a crown of
-- overlapping ellipsoids in varied greens.
--   cottonwood  big, broad and pale-barked, along rivers and creeks;
--   hardwood    elm, hackberry, oak and hickory: round crowns, the woods of the east;
--   cedar       eastern red cedar: narrow, dark and upright, in windbreaks and on rough
--               pasture, where it spreads;
--   yard        smaller planted shade trees in towns.

local Builder = require(script.Parent.Builder)

local Trees = {}

local M = Enum.Material
local hash = Builder.hash

local BARK = { Color3.fromRGB(92, 74, 58), Color3.fromRGB(78, 66, 56), Color3.fromRGB(104, 90, 76) }
local PALE_BARK = Color3.fromRGB(150, 140, 124)

local function leaf(r: number, base: Color3, spread: number): Color3
	local h, s, v = base:ToHSV()
	return Color3.fromHSV((h + (r - 0.5) * 0.04) % 1, math.clamp(s + (r - 0.5) * spread, 0, 1), math.clamp(v + ((r * 7.31) % 1 - 0.5) * spread, 0, 1))
end

-- A broad-crowned tree standing at (x, y, z); size scales it (1 is a 26-stud tree).
local function broadleaf(props: Builder.Props, x: number, y: number, z: number, size: number, r: number, bark: Color3, green: Color3, lobes: number)
	local height = 26 * size
	local trunkTop = y + height * 0.45
	local girth = 1.4 + 1.6 * size
	Builder.rod(props, Vector3.new(x, y - 1, z), Vector3.new(x, trunkTop, z), girth, bark, M.Wood)
	local crownY = y + height * 0.68
	local radius = 9 * size
	for i = 1, lobes do
		local a = (i / lobes + r) * 2 * math.pi
		local out = if i == 1 then 0 else radius * (0.45 + 0.25 * ((r * 13.7 * i) % 1))
		local cx, cz = x + math.cos(a) * out, z + math.sin(a) * out
		local lift = if i == 1 then radius * 0.25 else -radius * 0.1 + radius * 0.3 * ((r * 5.3 * i) % 1)
		local w = radius * (if i == 1 then 1.5 else 1.05 + 0.3 * ((r * 3.7 * i) % 1))
		-- A limb out to each outer lobe.
		if i > 1 and i <= 3 then
			Builder.rod(props, Vector3.new(x, trunkTop - 2 * size, z), Vector3.new(cx, crownY + lift - w * 0.3, cz), girth * 0.45, bark, M.Wood, false)
		end
		Builder.ellipsoid(props, CFrame.new(cx, crownY + lift, cz) * CFrame.Angles(0, a, 0), Vector3.new(w, w * 0.78, w * 0.92), leaf((r * 17.1 * i) % 1, green, 0.12))
	end
end

-- An upright conifer: short trunk, a tall narrow crown of two ellipsoids.
local function cedar(props: Builder.Props, x: number, y: number, z: number, size: number, r: number)
	local height = 18 * size
	local green = leaf(r, Color3.fromRGB(46, 72, 46), 0.08)
	Builder.rod(props, Vector3.new(x, y - 1, z), Vector3.new(x, y + height * 0.25, z), 1.2 * size, BARK[2], M.Wood)
	local w = 6.5 * size
	Builder.ellipsoid(props, CFrame.new(x, y + height * 0.45, z), Vector3.new(w, height * 0.62, w), green)
	Builder.ellipsoid(props, CFrame.new(x + (r - 0.5), y + height * 0.78, z), Vector3.new(w * 0.62, height * 0.42, w * 0.62), leaf((r * 3.3) % 1, green, 0.06))
end

export type Kind = "cottonwood" | "hardwood" | "cedar" | "yard"

function Trees.add(props: Builder.Props, kind: Kind, x: number, y: number, z: number, r: number)
	if kind == "cedar" then
		cedar(props, x, y, z, 0.8 + 0.5 * r, (r * 9.7) % 1)
	elseif kind == "cottonwood" then
		broadleaf(props, x, y, z, 1.2 + 0.6 * r, (r * 9.7) % 1, PALE_BARK, Color3.fromRGB(96, 128, 58), 5)
	elseif kind == "yard" then
		broadleaf(props, x, y, z, 0.55 + 0.3 * r, (r * 9.7) % 1, BARK[1], Color3.fromRGB(70, 112, 50), 3)
	else
		broadleaf(props, x, y, z, 0.8 + 0.45 * r, (r * 9.7) % 1, BARK[1 + math.floor(r * 3) % 3], Color3.fromRGB(64, 100, 48), 4)
	end
end

-- Chance of a tree on each 16-stud patch, by cover, before the grove noise (which runs from
-- open ground to dense groves) multiplies it.
Trees.DENSITY = {
	forest = 0.32, riparian = 0.22, breaks = 0.03, redRange = 0.018, tallgrass = 0.006,
	grassland = 0.006, sandhillGrass = 0.003, cropland = 0.0015, irrigated = 0, suburban = 0.01, urban = 0,
}

-- Which tree grows there, from a number s that varies smoothly across the land (so species
-- come in stands) and a random one r.
function Trees.species(coverKey: string, regionKey: string, s: number, r: number): Kind
	local mix = 0.7 * s + 0.3 * r
	if coverKey == "riparian" then
		return if mix < 0.5 then "cottonwood" elseif mix < 0.85 then "hardwood" else "cedar"
	elseif coverKey == "forest" then
		local cedars = if regionKey == "ozarkEdge" then 0.12 else 0.3
		return if mix < cedars then "cedar" else "hardwood"
	elseif coverKey == "suburban" then
		return if mix < 0.8 then "yard" else "hardwood"
	elseif coverKey == "grassland" or coverKey == "cropland" then
		return if mix < 0.5 then "cedar" elseif mix < 0.8 then "hardwood" else "cottonwood"
	end
	return if mix < 0.85 then "cedar" else "hardwood"
end

-- A windbreak: a row of trees from (x0, z0) along (dx, dz) (unit), count trees apart by gap,
-- cedars with a few broadleaf trees.
function Trees.row(props: Builder.Props, ground: (number, number) -> number, x0: number, z0: number, dx: number, dz: number, count: number, gap: number, seed: number)
	for i = 0, count - 1 do
		local x, z = x0 + dx * gap * i, z0 + dz * gap * i
		local r = hash(seed, i, 71)
		Trees.add(props, if r < 0.75 then "cedar" else "hardwood", x, ground(x, z), z, hash(seed, i, 72))
	end
end

return Trees
