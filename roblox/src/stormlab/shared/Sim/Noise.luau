--!nonstrict
--!native
-- Deterministic noise and random numbers for the storm lab. Every client and the server get the
-- same values from the same seed, so shared visual effects (funnel wobble, sub-vortex orbits,
-- lightning paths) match everywhere without replicating them.
--
--   Noise.hash(i, j, k, seed)        -> 0..1, integer lattice hash
--   Noise.value1(x, seed)            -> -1..1, smooth 1-D value noise
--   Noise.value3(x, y, z, seed)      -> -1..1, smooth 3-D value noise
--   Noise.fbm1(x, seed, octaves)     -> -1..1 (roughly), fractal sum
--   Noise.fbm3(x, y, z, seed, oct)   -> -1..1 (roughly)
--   Noise.rng(seed)                  -> a small stateful generator: r:next() 0..1, r:range(a, b), r:normal()
local Noise = {}

local floor = math.floor

-- exact (a * b) mod 2^32 for 32-bit unsigned a, b (doubles hold 53 bits, so split into halves)
local function mul32(a: number, b: number): number
	local alo, ahi = bit32.band(a, 0xffff), bit32.rshift(a, 16)
	local blo, bhi = bit32.band(b, 0xffff), bit32.rshift(b, 16)
	local cross = bit32.band(ahi * blo + alo * bhi, 0xffff)
	return bit32.band(alo * blo + cross * 65536, 0xffffffff)
end

-- 32-bit integer mix (the "lowbias32" hash)
local function mix(h: number): number
	h = bit32.bxor(h, bit32.rshift(h, 16))
	h = mul32(h, 0x7feb352d)
	h = bit32.bxor(h, bit32.rshift(h, 15))
	h = mul32(h, 0x846ca68b)
	h = bit32.bxor(h, bit32.rshift(h, 16))
	return h
end

-- integer coordinates may be negative: wrap them into 0..2^32-1 first
local function u32(n: number): number
	return n % 4294967296
end

function Noise.hashInt(i: number, j: number, k: number, seed: number): number
	local h = mul32(u32(seed), 0x27d4eb2d)
	h = mix(bit32.bxor(h, mul32(u32(i), 0x165667b1)))
	h = mix(bit32.bxor(h, mul32(u32(j), 0x1b873593)))
	h = mix(bit32.bxor(h, mul32(u32(k), 0x2c1b3c6d)))
	return h
end

function Noise.hash(i: number, j: number, k: number, seed: number): number
	return Noise.hashInt(i, j, k, seed) / 4294967296
end

local function fade(t: number): number
	return t * t * t * (t * (t * 6 - 15) + 10)
end

function Noise.value1(x: number, seed: number): number
	local i = floor(x)
	local f = fade(x - i)
	local a = Noise.hash(i, 0, 0, seed)
	local b = Noise.hash(i + 1, 0, 0, seed)
	return (a + (b - a) * f) * 2 - 1
end

function Noise.value3(x: number, y: number, z: number, seed: number): number
	local i, j, k = floor(x), floor(y), floor(z)
	local fx, fy, fz = fade(x - i), fade(y - j), fade(z - k)
	local h = Noise.hash
	local c000, c100 = h(i, j, k, seed), h(i + 1, j, k, seed)
	local c010, c110 = h(i, j + 1, k, seed), h(i + 1, j + 1, k, seed)
	local c001, c101 = h(i, j, k + 1, seed), h(i + 1, j, k + 1, seed)
	local c011, c111 = h(i, j + 1, k + 1, seed), h(i + 1, j + 1, k + 1, seed)
	local x00 = c000 + (c100 - c000) * fx
	local x10 = c010 + (c110 - c010) * fx
	local x01 = c001 + (c101 - c001) * fx
	local x11 = c011 + (c111 - c011) * fx
	local y0 = x00 + (x10 - x00) * fy
	local y1 = x01 + (x11 - x01) * fy
	return (y0 + (y1 - y0) * fz) * 2 - 1
end

function Noise.fbm1(x: number, seed: number, octaves: number?): number
	local sum, amp, norm, f = 0, 1, 0, 1
	for o = 1, octaves or 3 do
		sum += Noise.value1(x * f, seed + o * 101) * amp
		norm += amp
		amp *= 0.5
		f *= 2.03
	end
	return sum / norm
end

function Noise.fbm3(x: number, y: number, z: number, seed: number, octaves: number?): number
	local sum, amp, norm, f = 0, 1, 0, 1
	for o = 1, octaves or 3 do
		sum += Noise.value3(x * f, y * f, z * f, seed + o * 131) * amp
		norm += amp
		amp *= 0.5
		f *= 2.01
	end
	return sum / norm
end

export type Rng = {
	state: number,
	next: (Rng) -> number,
	range: (Rng, number, number) -> number,
	normal: (Rng) -> number,
	int: (Rng, number, number) -> number,
}

local RngMethods = {}
RngMethods.__index = RngMethods

function RngMethods.next(self: Rng): number
	self.state = (self.state + 1) % 4294967296
	return Noise.hash(self.state, 7, 13, 0x5bd1e995)
end

function RngMethods.range(self: Rng, a: number, b: number): number
	return a + (b - a) * self:next()
end

function RngMethods.int(self: Rng, a: number, b: number): number
	return math.min(b, a + floor(self:next() * (b - a + 1)))
end

function RngMethods.normal(self: Rng): number
	local u1 = math.max(1e-9, self:next())
	local u2 = self:next()
	return math.sqrt(-2 * math.log(u1)) * math.cos(2 * math.pi * u2)
end

function Noise.rng(seed: number): Rng
	return (setmetatable({ state = Noise.hashInt(floor(seed), 3, 5, 11) }, RngMethods) :: any) :: Rng
end

return Noise
