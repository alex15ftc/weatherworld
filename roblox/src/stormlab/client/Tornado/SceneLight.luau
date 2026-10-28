--!nonstrict
-- The light falling on a point of the scene, for self-lit visuals (the tornado's shells, collar,
-- wisps, dust): they are drawn light-free (Neon / LightInfluence 0) so a lightning flash can light
-- them locally at night without brightening the whole world; their colour is computed here.
--   SceneLight.sample(ctx, x, y, z) -> { sun = direct sun share 0..1 (blocked by the storms'
--     cloud), sunDir = Vector3, sky = sky light 0..1 (overcast, night), flash = local lightning
--     light, night = 0 day .. 1 dark night }
-- Sky light follows Render/Sky's published SkyDiffuse (camera overcast) and the sun's height;
-- night keeps a faint skyglow (moonlight is a setting); the sun ray test is against simple
-- shapes of each storm (tower, base, anvil), the same ones Render/Sky uses.
local Lighting = game:GetService("Lighting")

local SceneLight = {}

local exp, sqrt = math.exp, math.sqrt

local function smooth(a: number, b: number, x: number): number
	local t = math.clamp((x - a) / (b - a), 0, 1)
	return t * t * (3 - 2 * t)
end

-- how much of the sun's direct light reaches (x, y, z) through the storms' cloud
local function sunThrough(cw: any, x: number, y: number, z: number, sun: Vector3): number
	local sx, sy, sz = sun.X, -sun.Z, sun.Y
	if sz <= 0.01 then
		return 0
	end
	local tau = 0
	-- (the ray's horizontal reach per metre of height: a storm farther from (x, y) than the reach
	-- up to its highest test level plus its own size adds nothing, so it is skipped - the result
	-- is the same to the bit, the work is not O(all storms) for a point far from most of them)
	local reachK = sqrt(sx * sx + sy * sy) / sz
	for _, s in cw.storms do
		local ru = s.Ru or 3000
		local base = s.base or 1200
		local top = s.top or 10000
		local h1, h2, h3 = base + 200, 0.5 * (base + top), (s.el or top) - 800
		local hMax = math.max(h1, h2, h3)
		if hMax <= z then
			continue
		end
		local len = s.anvilLen or 0
		local size = 3.125 * ru + (if len > 2000 and s.anvilU then 1.35 * len + 2 * ru else 0)
		local reach = (hMax - z) * reachK + size + 1
		local ddx, ddy = x - s.x, y - s.y
		if ddx * ddx + ddy * ddy > reach * reach then
			continue
		end
		local fadeT = if s.dead then exp(-(s.deadFor or 0) / 600) else 1
		local fadeA = if s.dead then exp(-(s.deadFor or 0) / 1800) else 1
		for hi = 1, 3 do
			local h = if hi == 1 then h1 elseif hi == 2 then h2 else h3
			if h > z then
				local k = (h - z) / sz
				local px, py = x + sx * k, y + sy * k
				local dx, dy = px - s.x, py - s.y
				local d = sqrt(dx * dx + dy * dy)
				local rr = if h < base + 600 then 2.5 * ru else 1.5 * ru
				tau += 2.5 * fadeT * math.clamp((1.25 - d / rr) / 0.5, 0, 1)
				if h > (s.el or top) - 2000 and len > 2000 and s.anvilU then
					local along = dx * s.anvilU + dy * s.anvilV
					local across = math.abs(-dx * s.anvilV + dy * s.anvilU)
					local hw = 2 * ru + 0.35 * math.max(0, along)
					if along > -2 * ru and along < len and across < hw then
						tau += 2 * fadeA * (1 - 0.6 * math.clamp(along / len, 0, 1))
					end
				end
			end
		end
	end
	return exp(-tau)
end

-- (the sun's direction and Render/Sky's SkyDiffuse attribute change slowly: read once a frame,
-- not per sample - many samples are taken a frame)
local cacheAt, cacheRoot, cacheSun, cacheOvercast = -math.huge, nil, Vector3.yAxis, 1
local CACHE_S = 1 / 120

-- (the returned table is the caller's: several callers keep it and change its flash)
function SceneLight.sample(ctx: any, x: number, y: number, z: number): any
	local now = os.clock()
	if now - cacheAt > CACHE_S or cacheRoot ~= ctx.root then
		cacheAt, cacheRoot = now, ctx.root
		cacheSun = Lighting:GetSunDirection()
		local skyDiffuse = ctx.root:GetAttribute("SkyDiffuse")
		cacheOvercast = if type(skyDiffuse) == "number" then skyDiffuse else 1
	end
	local sun = cacheSun
	local elev = sun.Y
	-- night: 0 with the sun up, 1 once it is ~10 degrees below the horizon
	local night = smooth(0.05, -0.17, elev)
	local overcast = cacheOvercast
	local moon = ctx.state.moonlight or 0
	local skyglow = 0.035 + 0.12 * moon
	local daySky = (0.32 + 0.38 * smooth(0, 0.5, elev)) * overcast
	local sky = daySky * (1 - night) + skyglow * night
	local direct = if elev > 0 then sunThrough(ctx.cw, x, y, z, sun) * smooth(0, 0.15, elev) else 0
	local flash = 0
	if ctx.flashField then
		flash = ctx.Tornado.FlashField.at(ctx.flashField, x, y, z)
	end
	return { sun = direct, sunDir = sun, sky = sky, flash = flash, night = night }
end

-- a grey cloud colour under that light: albedo x (sky + sun x facing) + flash (bluish white)
function SceneLight.shade(L: any, albedo: number, facing: number): Color3
	local warm = smooth(0.4, 0.05, L.sunDir.Y) * (1 - L.night)
	local s = L.sun * math.max(0, facing) * 0.9
	local r = albedo * (L.sky * 0.97 + s * 1.0) + 0.85 * L.flash
	local g = albedo * (L.sky * 1.0 + s * (1 - 0.18 * warm)) + 0.88 * L.flash
	local b = albedo * (L.sky * 1.08 + s * (1 - 0.4 * warm)) + 1.0 * L.flash
	return Color3.new(math.min(r, 1), math.min(g, 1), math.min(b, 1))
end

return SceneLight
