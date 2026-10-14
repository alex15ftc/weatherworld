--!strict
-- Ground height for the chunk-streaming test: plain seeded noise (gentle swells plus patches
-- of hill country). Regions, rivers and the engine's west-to-east slope come later.

local Config = require(script.Parent.Config)

local Heightfield = {}

local SEED_Z = Config.SEED * 17.31 + 0.5 -- math.noise is zero on integer lattice points
local MILE = Config.STUDS_PER_MILE
local VERTICAL = Config.STUDS_PER_METRE_VERTICAL
-- Vehicle jitter test: dead-flat ground, so any bounce of a car at steady speed is precision noise.
local FLAT = workspace:GetAttribute("TestDrive") == true and workspace:GetAttribute("TestFlatGround") == true
local FLAT_METRES = 40

local function fbm(x: number, z: number, octaves: number, salt: number): number
	local sum, amp, freq, norm = 0, 1, 1, 0
	for octave = 1, octaves do
		sum += amp * math.noise(x * freq + octave * 31.7, z * freq - octave * 17.3, SEED_Z + salt + octave * 0.37)
		norm += amp
		amp *= 0.5
		freq *= 2
	end
	return sum / norm
end

-- Ground height in metres above the map's base, at a point given in studs.
function Heightfield.metresAt(x: number, z: number): number
	if FLAT then
		return FLAT_METRES
	end
	local mx, mz = x / MILE, z / MILE
	local rolling = 30 * fbm(mx / 2, mz / 2, 4, 0) -- swells a couple of miles across
	local hilly = math.clamp(fbm(mx / 25, mz / 25, 2, 100) * 4, 0, 1) -- where hill country is
	local hills = 160 * hilly * (fbm(mx * 1.5, mz * 1.5, 5, 200) + 0.5)
	return 40 + rolling + hills
end

function Heightfield.studsAt(x: number, z: number): number
	return Heightfield.metresAt(x, z) * VERTICAL
end

return Heightfield
