--!strict
-- Builds the terrain voxels for one chunk. Pure computation, so it can run in a parallel phase;
-- the caller writes the result with Terrain:WriteVoxels.

local Config = require(script.Parent.Config)
local Heightfield = require(script.Parent.Heightfield)

local ChunkGen = {}

local SIZE = Config.CHUNK_STUDS
local VOXEL = Config.VOXEL_STUDS
local N = SIZE // VOXEL
local GRASS_DEPTH = 2 * VOXEL

ChunkGen.VOXEL = VOXEL

export type Chunk = {
	region: Region3,
	materials: { { { Enum.Material } } },
	occupancy: { { { number } } },
	yMin: number,
	yMax: number,
}

function ChunkGen.key(cx: number, cz: number): string
	return `{cx},{cz}`
end

function ChunkGen.build(cx: number, cz: number): Chunk
	local x0, z0 = cx * SIZE, cz * SIZE
	local heights = table.create(N * N, 0)
	local lo, hi = math.huge, -math.huge
	for ix = 1, N do
		for iz = 1, N do
			local h = Heightfield.studsAt(x0 + (ix - 0.5) * VOXEL, z0 + (iz - 0.5) * VOXEL)
			heights[(ix - 1) * N + iz] = h
			lo = math.min(lo, h)
			hi = math.max(hi, h)
		end
	end

	local yMin = math.floor((lo - Config.FILL_DEPTH_STUDS) / VOXEL) * VOXEL
	local yMax = math.ceil(hi / VOXEL) * VOXEL + VOXEL
	local ny = (yMax - yMin) // VOXEL

	local air, grass, ground = Enum.Material.Air, Enum.Material.Grass, Enum.Material.Ground
	local materials, occupancy = table.create(N), table.create(N)
	for ix = 1, N do
		local mx, ox = table.create(ny), table.create(ny)
		for iy = 1, ny do
			mx[iy] = table.create(N)
			ox[iy] = table.create(N)
		end
		for iz = 1, N do
			local h = heights[(ix - 1) * N + iz]
			for iy = 1, ny do
				local depth = h - (yMin + (iy - 1) * VOXEL) -- surface height above this voxel's bottom
				local occ = math.clamp(depth / VOXEL, 0, 1)
				ox[iy][iz] = occ
				mx[iy][iz] = if occ <= 0 then air elseif depth <= GRASS_DEPTH then grass else ground
			end
		end
		materials[ix] = mx
		occupancy[ix] = ox
	end

	return {
		region = Region3.new(Vector3.new(x0, yMin, z0), Vector3.new(x0 + SIZE, yMax, z0 + SIZE)),
		materials = materials,
		occupancy = occupancy,
		yMin = yMin,
		yMax = yMax,
	}
end

return ChunkGen
