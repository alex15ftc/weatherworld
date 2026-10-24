--!nonstrict
-- Shared helpers for the storm-cloud renderer (Render/Clouds.luau): ramps, deterministic picks,
-- the far-draw rule and distance haze, sun light. Pure apart from reading Lighting.
local Lighting = game:GetService("Lighting")

local Util = {}

function Util.ramp(x: number, a: number, b: number): number
	if b == a then
		return if x >= b then 1 else 0
	end
	return math.clamp((x - a) / (b - a), 0, 1)
end

function Util.smooth(x: number): number
	x = math.clamp(x, 0, 1)
	return x * x * (3 - 2 * x)
end

-- a deterministic 0..1 value for (seed, slot, salt)
local Noise
function Util.init(Sim: any)
	Noise = Sim.Noise
end

function Util.hash(seed: number, slot: number, salt: number): number
	return Noise.hash(slot, salt, 977, math.floor(seed) % 2147483647)
end

-- a variant name of a kit kind, stable for (seed, slot)
function Util.pick(CloudKit: any, kind: string, seed: number, slot: number): string?
	local names = CloudKit.names(kind)
	local n = #names
	if n == 0 then
		return nil
	end
	return names[math.min(n, 1 + math.floor(Util.hash(seed, slot, 31) * n))]
end

-- Far draw (docs/stormlab/ARCHITECTURE.md): a point at true distance d > D is drawn at
-- cam + (P - cam) * D / d with its size scaled the same, so it keeps its direction and angular
-- size inside the range Roblox draws parts. A piece still too big for a part (2048 studs) is
-- drawn nearer again (same angular size), but never nearer than NEAR_MIN: pulled in further it
-- would sit in front of things really in front of it (a 14 km storm base pulled in to fit hid a
-- tornado 1.6 km away). What still doesn't fit keeps its place with its footprint capped
-- (Util.capSize); Clouds splits near pieces so that is rare.
Util.MAX_PART = 2040
Util.NEAR_MIN = 2500
function Util.farK(d: number, D: number, biggest: number?): number
	local k = if d > D then D / d else 1
	if biggest and biggest * k > Util.MAX_PART and d > Util.NEAR_MIN then
		k = math.max(Util.MAX_PART / biggest, math.min(k, Util.NEAR_MIN / d))
	end
	return k
end
function Util.capSize(v: Vector3): Vector3
	local M = Util.MAX_PART
	if v.X <= M and v.Y <= M and v.Z <= M then
		return v
	end
	return Vector3.new(math.min(v.X, M), math.min(v.Y, M), math.min(v.Z, M))
end

-- Sun and haze, refreshed about once a second by Clouds (Util.light is read by every planner).
Util.light = {
	sunSim = { 0.3, 0.3, 0.9 }, -- sun direction in the sim frame (x east, y north, z up)
	sunUp = 1, -- 0 below the horizon .. 1 well up
	sunColour = Color3.new(1, 1, 1),
	skyColour = Color3.new(0.78, 0.83, 0.9),
	haze = Color3.new(0.74, 0.79, 0.86),
	visibility = 70000, -- m: haze e-folding distance
	day = 1,
	night = 0,
}

function Util.refreshLight()
	local L = Util.light
	local sun = Lighting:GetSunDirection()
	L.sunSim = { sun.X, -sun.Z, sun.Y }
	L.sunUp = Util.smooth((sun.Y + 0.02) / 0.12)
	-- low sun: warmer light (longer path through the air)
	local warm = Util.smooth(1 - sun.Y / 0.4) * L.sunUp
	L.sunColour = Color3.new(1, 1 - 0.2 * warm, 1 - 0.42 * warm)
	L.day = 0.12 + 0.88 * Util.smooth((sun.Y + 0.1) / 0.35)
	-- night: 0 with the sun up .. 1 once it is ~10 degrees down (pieces go self-lit and dark)
	L.night = Util.smooth((0.05 - sun.Y) / 0.22)
	local atm = Lighting:FindFirstChildOfClass("Atmosphere")
	local base = if atm then atm.Color else Color3.new(0.74, 0.79, 0.86)
	-- (warm haze toward a low sun is left to the sky; the haze is dimmed with daylight)
	local d = L.day
	L.haze = Color3.new(base.R * d, base.G * d, base.B * d)
	L.skyColour = Color3.new(0.78 * d, 0.83 * d, 0.9 * d)
	local vis = Lighting:GetAttribute("VisibilityKm")
	L.visibility = if type(vis) == "number" and vis > 1 then vis * 1000 else 70000
end

-- the haze share at true distance d (quantised so colours change rarely)
function Util.hazeF(d: number): number
	local f = 0.88 * (1 - math.exp(-d / Util.light.visibility))
	return math.floor(f * 40 + 0.5) / 40
end

-- a cloud's colour from its albedo and how much direct sun reaches it (0..1)
function Util.cloudColour(albedo: number, sunLit: number): Color3
	local L = Util.light
	local direct = sunLit * L.sunUp
	local amb = 0.3 -- (the engine adds its own ambient: a lot baked in here made undersides white)
	local s, k = L.sunColour, L.skyColour
	local r = albedo * (amb * k.R / 0.78 * 0.92 + (1 - amb) * direct * s.R)
	local g = albedo * (amb * k.G / 0.83 * 0.92 + (1 - amb) * direct * s.G)
	local b = albedo * (amb * k.B / 0.9 * 0.95 + (1 - amb) * direct * s.B)
	return Color3.new(math.min(r, 1), math.min(g, 1), math.min(b, 1))
end

-- a colour rounded to 1/64 steps (so per-frame recolouring sets the property rarely)
function Util.quant(c: Color3): Color3
	return Color3.new(math.floor(c.R * 64 + 0.5) / 64, math.floor(c.G * 64 + 0.5) / 64, math.floor(c.B * 64 + 0.5) / 64)
end

function Util.mix(a: Color3, b: Color3, f: number): Color3
	return Color3.new(a.R + (b.R - a.R) * f, a.G + (b.G - a.G) * f, a.B + (b.B - a.B) * f)
end

return Util
