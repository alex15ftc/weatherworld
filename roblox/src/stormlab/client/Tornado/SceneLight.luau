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

-- How much of a storm's cloud base covers (px, py): 0 .. 1, soft-edged as a disc (2026-10-30).
-- The base's footprint follows the storm's own fields instead of a disc round the updraft: it runs
-- forward over the rain core (the forward-flank downdraft, ffd) and ends a short way behind the
-- low-level mesocyclone on the rear side, where the rear-flank downdraft (rfd, its strength in m/s)
-- clears a slot. A low sun from the rear then reaches the wall cloud through that slot, as in
-- photos of sunlit supercells; the symmetric 2.5 Ru disc kept every lowering in black shadow.
-- k scales the footprint (the overhead cover is a little wider than the sun test's).
function SceneLight.baseCover(s: any, px: number, py: number, k: number?): number
	local ru = s.Ru or 3000
	local sc = k or 1
	local fx, fy = (s.ffdX or s.x) - s.x, (s.ffdY or s.y) - s.y
	local fl = sqrt(fx * fx + fy * fy)
	if fl < 0.3 * ru then
		-- (no forward flank to go by: the anvil's direction, else round)
		if s.anvilU then
			fx, fy, fl = s.anvilU, s.anvilV or 0, 1
		else
			local dx, dy = px - s.x, py - s.y
			return math.clamp((1.25 - sqrt(dx * dx + dy * dy) / (2.2 * ru * sc)) / 0.5, 0, 1)
		end
	end
	local ux, uy = fx / fl, fy / fl
	local dx, dy = px - s.x, py - s.y
	local a = dx * ux + dy * uy
	local c = -dx * uy + dy * ux
	-- forward: past the rain core; rear: just past the low-level mesocyclone (the wall cloud hangs
	-- from the base there); sides as the old disc
	local fwd = math.max(2.2 * ru, (if fl > 0.3 * ru then fl else 0) + 1.6 * ru)
	local lx, ly = (s.lowX or s.x) - s.x, (s.lowY or s.y) - s.y
	local behind = math.max(0, -(lx * ux + ly * uy))
	local rear = math.max(0.7 * ru, behind + 0.45 * ru)
	local along = a / ((if a > 0 then fwd else rear) * sc)
	local dn = sqrt(along * along + (c / (2.0 * ru * sc)) ^ 2)
	local cover = math.clamp((1.25 - dn) / 0.5, 0, 1)
	-- the rear-flank downdraft's clear slot (dry descending air: no cloud), by its strength
	if s.rfdX and (s.rfd or 0) > 0 then
		local rx, ry = px - s.rfdX, py - s.rfdY
		local slot = math.clamp((1.25 - sqrt(rx * rx + ry * ry) / (0.6 * ru)) / 0.5, 0, 1)
		cover *= 1 - 0.85 * slot * smooth(4, 14, s.rfd)
	end
	return cover
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
		-- (the base runs forward past the rain core: up to ~5 Ru from the updraft)
		local size = 5 * ru + (if len > 2000 and s.anvilU then 1.35 * len + 2 * ru else 0)
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
				-- (the base level: the storm's own footprint, long forward, short at the rear with
				-- the RFD's clear slot - SceneLight.baseCover; the tower above: a disc)
				if h < base + 600 then
					tau += 2.5 * fadeT * SceneLight.baseCover(s, px, py)
				else
					tau += 2.5 * fadeT * math.clamp((1.25 - d / (1.5 * ru)) / 0.5, 0, 1)
				end
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

-- Where the sky light comes from at (x, y, z), 2026-10-30. Under a storm the direct sun is mostly
-- blocked and what light there is comes in sideways from the open sky beyond the base's edge (the
-- bright horizon, a clear slot behind the rear-flank downdraft), while the side facing the storm's
-- body stays dark. This marches the same storm shapes as the sun test along 16 low headings (4 and
-- 15 degrees up) and returns the mean light's heading (dx, dy: unit, sim axes) and how one-sided it
-- is (aniso: 0 the same all round .. 1 from one side only). A surface facing n (horizontal) takes
-- the sky light x (1 + k aniso (n . d)): the storm's own shape sets the contrast, nothing painted.
function SceneLight.skyDir(ctx: any, x: number, y: number, z: number): (number, number, number)
	local cw = ctx.cw
	if not cw or not cw.storms then
		return 1, 0, 0
	end
	local vx, vy, tot = 0, 0, 0
	local vol = cw.vol
	local C = ctx.Config
	local Precip = ctx.Sim and ctx.Sim.Precip
	for i = 0, 15 do
		local a = i * math.pi / 8
		local ca, sa = math.cos(a), math.sin(a)
		-- the rain the low sky light crosses on its way in (it runs under the base, through the
		-- rain shafts, the first ~8 km): the rain core's side is dark, the clear rear side bright -
		-- the main one-sided light under a supercell. (The storm shapes alone are discs round each
		-- storm: under one the light came in evenly all round, aniso ~0.04)
		local rainT = 1
		if vol and vol.nxv and Precip and C and C.rainExtinction then
			local tau, prev = 0, 0
			for _, dk in { 0.5, 1, 2, 3, 4.5, 6, 8 } do
				local r = Precip.surface(vol, x + ca * dk * 1000, y + sa * dk * 1000) or 0
				tau += C.rainExtinction(r) * (dk - prev)
				prev = dk
			end
			rainT = exp(-tau)
		end
		for _, el in { 0.07, 0.26 } do
			local ce = sqrt(1 - el * el)
			-- (sunThrough reads a Roblox direction: x east, -z north, y up)
			local t = sunThrough(cw, x, y, z, Vector3.new(ca * ce, el, -sa * ce)) * rainT
			vx += t * ca
			vy += t * sa
			tot += t
		end
	end
	if tot < 1e-4 then
		return 1, 0, 0
	end
	local m = sqrt(vx * vx + vy * vy)
	-- (with almost no open sky the heading is noise: the contrast fades with the open share)
	local aniso = math.clamp(m / tot, 0, 1) * smooth(0, 0.1, tot / 32)
	if m < 1e-6 then
		return 1, 0, 0
	end
	return vx / m, vy / m, aniso
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
