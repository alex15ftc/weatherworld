--!nonstrict
-- The scene's light from the simulation (guide section 15: storm-dependent lighting without
-- making every storm unnaturally dark). Nothing is keyed on a storm's type; the clouds are
-- simple shapes from each storm snapshot (the same quantities Render/Clouds draws from):
--
--   tower    a column 1.5 Ru wide from `base` to `top` over (x, y)
--   base     the cloud base, a disc ~2.2 Ru round the updraft at `base`
--   core     the precipitation core under the forward-flank downdraft (ffdX, ffdY), ~1.8 Ru,
--            thicker with more precipitation (precipRate) and a deeper cloud (top - base)
--   anvil    a fan at `el` - 1 km along (anvilU, anvilV) for anvilLen, (2 Ru + 0.35 along) wide
--            each side, thick near the tower and thinning downstream
--   (dead storms fade: towers within ~10 min, anvils over ~30 min)
--
--   Sun      Lighting.ClockTime from cw.clockUtc (interpolated between snapshots with the sim
--            clock) + meta.sun.utcOffsetHours. Roblox's sun keeps an equinox path, so (as the
--            main game's SkyLight measured) GeographicLatitude is set from meta.sun.latDeg to the
--            latitude whose equinox noon sun stands as high as this day's, and the local solar
--            day (sunriseLocal..sunsetLocal) is mapped onto Roblox's measured day, so the sun is
--            up exactly when the scenario says.
--   Direct   the optical depth along the ray from the camera toward the sun through each shape
--            (heights above the camera only): how much direct sun reaches the camera.
--   Diffuse  the optical depth straight overhead (with soft edges, so a storm next to the camera
--            already takes some sky) plus the rain falling at the camera; never below a diffuse
--            floor (light still comes in from round the storm; photos from under bases).
--   Light    Brightness follows the direct sun; Ambient / OutdoorAmbient dim and turn to a flat
--            overcast fill; ColorShift_Top cools; the eye adapts part-way (ExposureCompensation
--            rises a little in the dark), shadows soften. A faint green tint under a deep,
--            heavily precipitating core lit by a low sun (subtle, as photographed).
--   Haze     Lighting.Atmosphere: Sky is its ONLY writer. Colour / Decay move toward a storm
--            grey when overcast (rain grey in rain, brown in dust), Haze up, Glare down. Density
--            = the clear air (50 km visibility) plus the extinction Render/NearPrecip publishes
--            as the ctx.root attribute PrecipExtinction (1/stud; PrecipDust its dust share),
--            added in extinction and turned into a density with the measured Atmosphere curve.
--            (Extinctions here are per STUD, what the Atmosphere works in: a per-metre
--            extinction k is k / SCALE per stud.)
--
-- Published on ctx.root for other renderers: SkyDirect (0..1, direct sun reaching the camera)
-- and SkyDiffuse (DIFFUSE_FLOOR..1, sky light), both eased.
--
-- show.sky off: every Lighting / Atmosphere property goes back to what it was when the lab
-- started, except that Atmosphere.Density still carries NearPrecip's rain / dust extinction (so
-- the rain toggle keeps working on its own). Targets are computed at 10 Hz and eased (~1.2 s).
local Lighting = game:GetService("Lighting")
local Util = require(script.Parent:WaitForChild("FxParts"):WaitForChild("Util"))

local Sky = {}

local CLEAR_VISIBILITY = 50000 -- m
-- the least sky light under the deepest cloud, as a share of the open sky's: a thick
-- cumulonimbus lets ~2-10% through (0.35 was the old flat floor - photos taken from round a storm,
-- not under it - and kept the ground under a base lit like a dull overcast day, 2026-11-02)
local DIFFUSE_FLOOR = 0.12
local OVERCAST_FILL = Color3.fromRGB(150, 153, 160)
local SHADE_TINT = Color3.fromRGB(216, 226, 252)
local COOL_TOP = Color3.fromRGB(150, 160, 182)
local GREEN_TINT = Color3.fromRGB(198, 238, 210)
local HAZE_COLOUR = Color3.fromRGB(198, 208, 222)
local STORM_GREY = Color3.fromRGB(120, 126, 136)
local RAIN_COLOUR = Color3.fromRGB(128, 136, 148)
local DUST_COLOUR = Color3.fromRGB(176, 150, 116)

local ramp = Util.ramp
local TOWER_LEVELS = { 0.2, 0.5, 0.8 } -- where the sun ray is tested against a tower (share of its depth)

-- Sky cover (2026-10-31, docs/stormlab/SHOTS.md): how much of the visible sky dome the storms'
-- cloud fills, from rays over the dome (8 bearings x 5 elevations + the zenith, each weighted by
-- the share of the view it stands for). It greys the whole sky (Atmosphere haze) and drives the
-- Terrain Clouds layer, so the sky round a storm is the storm's overcast, not a clear blue dome.
-- Key \ turns it off (A/B).
local SKY_ELEV = { 5, 14, 28, 48, 72 }
local SKY_DIRS = {}
do
	for i, e in SKY_ELEV do
		local lo = if i == 1 then 0 else (SKY_ELEV[i - 1] + e) / 2
		local hi = if i == #SKY_ELEV then 84 else (SKY_ELEV[i + 1] + e) / 2
		local w = (math.sin(math.rad(hi)) - math.sin(math.rad(lo))) / 8 -- (solid angle share per bearing)
		for a = 0, 7 do
			local az = a * math.pi / 4
			local ce = math.cos(math.rad(e))
			table.insert(SKY_DIRS, { math.cos(az) * ce, math.sin(az) * ce, math.sin(math.rad(e)), w })
		end
	end
	table.insert(SKY_DIRS, { 0, 0, 1, 1 - math.sin(math.rad(84)) })
end
local SKY_REACH = 90000 -- m: cloud farther than this along the ground is lost in the haze anyway
local CLOUD_DECK = Color3.fromRGB(132, 138, 148) -- the overcast deck in full daylight

-- 1 well inside a disc of radius r, 0 outside, soft across the edge (0.75 r .. 1.25 r)
local function disc(dx: number, dy: number, r: number): number
	local d = math.sqrt(dx * dx + dy * dy)
	return math.clamp((1.25 - d / math.max(1, r)) / 0.5, 0, 1)
end

-- how far inside a storm's anvil fan a point is (0..1) and its share along the anvil
local function anvilIn(s, px: number, py: number): (number, number)
	local len = s.anvilLen or 0
	local au, av = s.anvilU, s.anvilV
	if len < 2000 or not au or not av then
		return 0, 0
	end
	local ru = s.Ru or 3000
	local dx, dy = px - s.x, py - s.y
	local along = dx * au + dy * av
	local across = math.abs(-dx * av + dy * au)
	local alongIn = math.clamp((along + 2.5 * ru) / ru, 0, 1) * math.clamp((len - along) / (0.15 * len + 1000), 0, 1)
	if alongIn <= 0 then
		return 0, 0
	end
	local hw = 2 * ru + 0.35 * math.max(0, along)
	local acrossIn = math.clamp((1.2 - across / hw) / 0.4, 0, 1)
	return alongIn * acrossIn, math.clamp(along / len, 0, 1)
end

-- Roblox's sunrise and sunset (ClockTime) at the latitude now set, found by stepping the clock
local function robloxDay(): (number, number)
	local saved = Lighting.ClockTime
	local rise, set = 6, 18
	local last = nil
	for i = 0, 480 do
		local h = i * 0.05
		Lighting.ClockTime = h
		local y = Lighting:GetSunDirection().Y
		if last ~= nil then
			if last <= 0 and y > 0 then
				rise = h
			elseif last > 0 and y <= 0 then
				set = h
			end
		end
		last = y
	end
	Lighting.ClockTime = saved
	return rise, set
end

-- local solar hour onto Roblox's clock: the scenario's day onto Roblox's day, night onto night
local function robloxClock(solar: number, sunrise: number, sunset: number, rise: number, set: number): number
	if sunset <= sunrise then
		return solar
	end
	if solar >= sunrise and solar <= sunset then
		return rise + (solar - sunrise) / (sunset - sunrise) * (set - rise)
	end
	local into = (solar - sunset) % 24
	return (set + into / (24 - (sunset - sunrise)) * (24 - (set - rise))) % 24
end

-- the latitude for Roblox's equinox sun that gives the noon height of a day `hours` long at latDeg
local function equinoxLatitude(latDeg: number, hours: number): number
	if math.abs(latDeg) < 0.5 then
		return latDeg
	end
	local h0 = math.rad(math.clamp(hours, 1, 23) / 2 * 15)
	local declination = math.atan(-math.cos(h0) / math.tan(math.rad(latDeg)))
	return latDeg - math.deg(declination)
end

function Sky.new(ctx)
	local self = {}
	local cw = ctx.cw
	local Precip = ctx.Sim.Precip
	local atmosphere = Util.atmosphere()
	local grade = Util.colorEffect("StormLabSky")
	grade.Brightness, grade.Contrast, grade.Saturation = 0, 0, 0
	grade.TintColor = Color3.new(1, 1, 1)

	local def = {
		ClockTime = Lighting.ClockTime,
		GeographicLatitude = Lighting.GeographicLatitude,
		Brightness = Lighting.Brightness,
		Ambient = Lighting.Ambient,
		OutdoorAmbient = Lighting.OutdoorAmbient,
		ColorShift_Top = Lighting.ColorShift_Top,
		ExposureCompensation = Lighting.ExposureCompensation,
		ShadowSoftness = Lighting.ShadowSoftness,
		EnvironmentDiffuseScale = Lighting.EnvironmentDiffuseScale,
		EnvironmentSpecularScale = Lighting.EnvironmentSpecularScale,
		FogColor = Lighting.FogColor,
	}
	local defAtmo = {
		Density = atmosphere.Density,
		Offset = atmosphere.Offset,
		Color = atmosphere.Color,
		Decay = atmosphere.Decay,
		Glare = atmosphere.Glare,
		Haze = atmosphere.Haze,
	}
	local kDefault = Util.extinctionForDensity(defAtmo.Density)

	-- the Terrain Clouds layer (the overcast deck); made here if the place has none
	local terrain = workspace.Terrain
	local clouds = terrain:FindFirstChildOfClass("Clouds")
	local madeClouds = false
	if not clouds then
		clouds = Instance.new("Clouds")
		clouds.Enabled = false
		clouds.Parent = terrain
		madeClouds = true
	end
	local defClouds = { Enabled = clouds.Enabled, Cover = clouds.Cover, Density = clouds.Density, Color = clouds.Color }
	-- key \: the storm-owned sky on / off (A/B against the reference shots)
	ctx.state.skyOwn = if ctx.state.skyOwn == nil then true else ctx.state.skyOwn
	game:GetService("UserInputService").InputBegan:Connect(function(input, processed)
		if not processed and input.KeyCode == Enum.KeyCode.BackSlash then
			ctx.state.skyOwn = not ctx.state.skyOwn
			print("[sky] storm-owned sky " .. (if ctx.state.skyOwn then "on" else "off"))
		end
	end)
	local kClear = 3.912 / ctx.Config.studs(CLEAR_VISIBILITY) -- (1/stud)

	local st = {
		ready = false, at = -1, clock = 0,
		-- targets
		tS = 1, tD = 1, tOc = 0, tGreen = 0, tCover = 0,
		-- eased
		S = 1, D = 1, oc = 0, green = 0, wet = 0, dust = 0, kPrecip = 0, cover = 0,
		latitude = nil :: number?, rise = 6, set = 18,
		wasOn = true,
		published = -1,
	}

	local function setClock()
		if not cw.clockUtc then
			return
		end
		local hours = cw.clockUtc + (ctx:simTime() - (cw.time or 0)) / 3600
		local meta = ctx.scenarioData and ctx.scenarioData.meta
		local sun = meta and meta.sun
		if sun and sun.latDeg then
			local rise, set = sun.sunriseLocal or 6, sun.sunsetLocal or 18
			local lat = equinoxLatitude(sun.latDeg, set - rise)
			if st.latitude ~= lat then
				st.latitude = lat
				Lighting.GeographicLatitude = lat
				st.rise, st.set = robloxDay()
			end
			local solar = (hours + (sun.utcOffsetHours or 0)) % 24
			-- a visual test may set the local solar hour (night scenes); the simulation keeps its clock
			if type(ctx.state.clockOverride) == "number" then
				solar = ctx.state.clockOverride % 24
			end
			Lighting.ClockTime = robloxClock(solar, rise, set, st.rise, st.set)
		else
			Lighting.ClockTime = hours % 24
		end
	end

	-- the 10 Hz analysis: direct sun, sky light, overcast and the green tint
	local function analyse()
		local SL = ctx.Tornado.SceneLight -- (the storm base's footprint, shared with the scene light)
		local cx, cy, cz = ctx.Config.fromWorld(ctx.camera.CFrame.Position) -- (metres)
		local d = Lighting:GetSunDirection()
		local sx, sy, sz = d.X, -d.Z, d.Y
		local sunUp = sz > 0.01
		local tauS, tauD = 0, 0
		local greenCore = 0
		local function rayAt(h: number): (number, number)
			local k = (h - cz) / sz
			return cx + sx * k, cy + sy * k
		end
		for _, s in cw.storms do
			local ru = s.Ru or 3000
			local base = s.base or 1200
			local top = math.max(base + 500, s.top or s.el or 10000)
			local el = s.el or top
			local deep = ramp(top - base, 4000, 12000)
			local core = 1 - math.exp(-(s.precipRate or 0) / 6e5)
			local aTower = if s.dead then math.exp(-(s.deadFor or 0) / 600) else 1
			local aAnvil = if s.dead then math.exp(-(s.deadFor or 0) / 1800) else 1
			local fx, fy = s.ffdX or s.x, s.ffdY or s.y
			local rt = 1.5 * ru
			local ha = el - 1000
			-- quick reject: too far to cover the camera or its sun ray
			local reach = (s.anvilLen or 0) + 5 * ru + (if sunUp then math.min(80000, top / math.max(0.12, sz)) else 0)
			local dx0, dy0 = cx - s.x, cy - s.y
			if dx0 * dx0 + dy0 * dy0 < reach * reach then
				-- the sun ray
				if sunUp then
					for _, f in TOWER_LEVELS do
						local h = base + (top - base) * f
						if h > cz then
							local px, py = rayAt(h)
							tauS += 3 * aTower * disc(px - s.x, py - s.y, rt)
						end
					end
					if base > cz then
						local px, py = rayAt(base)
						tauS += 2.5 * aTower * SL.baseCover(s, px, py) -- (the storm's own footprint: SceneLight.baseCover, 2026-10-30)
						tauS += (1 + 3 * core) * aTower * disc(px - fx, py - fy, 1.8 * ru)
					end
					if base * 0.5 > cz then
						local px, py = rayAt(base * 0.5)
						tauS += 2.5 * core * aAnvil * disc(px - fx, py - fy, 1.8 * ru)
					end
					if ha > cz then
						local px, py = rayAt(ha)
						local inA, along = anvilIn(s, px, py)
						tauS += (0.8 + 2.2 * deep) * (1 - 0.7 * along) * inA * aAnvil
					end
				end
				-- overhead
				if top > cz then
					local tower = disc(dx0, dy0, rt * 1.2) * aTower
					tauD += 1.5 * tower
					if base > cz then
						tauD += (1.2 + deep) * SL.baseCover(s, cx, cy, 1.1) * aTower
						local inCore = disc(cx - fx, cy - fy, 2 * ru) * aTower
						tauD += 1.5 * core * (0.5 + deep) * inCore
						greenCore = math.max(greenCore, inCore * core * deep)
					end
				end
				if ha > cz then
					local inA, along = anvilIn(s, cx, cy)
					tauD += (0.5 + 0.6 * deep) * (1 - 0.6 * along) * inA * aAnvil
				end
			end
		end
		-- the rain falling at the camera
		local rain = 0
		local vol = cw.vol
		if vol and vol.nxv and cz < 2500 then
			rain = Precip.surface(vol, cx, cy) or 0
			tauD += 0.02 * rain ^ 0.8
			greenCore = math.max(greenCore, ramp(rain, 10, 60) * 0.6)
		end
		-- the sky cover: each dome ray, at the storms' base, mid-tower and anvil heights
		local cover, wSum = 0, 0
		local coverI, wI = 0, 0 -- (as light on the ground: each ray by its height, sin(elev))
		for _, r in SKY_DIRS do
			local rx, ry, rz = r[1], r[2], r[3]
			local hit = 0
			for _, s in cw.storms do
				local ru = s.Ru or 3000
				local base = s.base or 1200
				local top = math.max(base + 500, s.top or s.el or 10000)
				local ha = (s.el or top) - 1000
				local aT = if s.dead then math.exp(-(s.deadFor or 0) / 600) else 1
				local aA = if s.dead then math.exp(-(s.deadFor or 0) / 1800) else 1
				local function at(h: number): (number?, number?)
					if h <= cz then
						return nil, nil
					end
					local k = (h - cz) / rz
					if k * math.sqrt(rx * rx + ry * ry) > SKY_REACH then
						return nil, nil
					end
					return cx + rx * k, cy + ry * k
				end
				local px, py = at(base)
				if px then
					hit = math.max(hit, aT * SL.baseCover(s, px, py))
					-- the forward flank: cloud over the storm's rain (CardPlan draws it there, Round 17)
					local vol = cw.vol
					if vol and vol.nxv and hit < 1 then
						hit = math.max(hit, ramp(Precip.surface(vol, px, py) or 0, 0.5, 5))
					end
				end
				px, py = at(base + 0.5 * (top - base))
				if px then
					hit = math.max(hit, aT * disc(px - s.x, py - s.y, 1.5 * ru))
				end
				px, py = at(ha)
				if px then
					hit = math.max(hit, aA * (anvilIn(s, px, py)))
				end
				if hit >= 1 then
					break
				end
			end
			cover += r[4] * math.min(1, hit)
			wSum += r[4]
			coverI += r[4] * rz * math.min(1, hit)
			wI += r[4] * rz
		end
		st.tCover = if wSum > 0 then cover / wSum else 0

		local oc = 1 - math.exp(-0.55 * tauD)
		st.tS = if sunUp then math.exp(-tauS) else 1
		-- the sky light reaching the ground: the open part of the dome (weighted as it lights a level
		-- surface: the zenith most, the horizon least) plus what comes through the cloud over the
		-- rest (the overhead optical depth). Under a base only the bright low sky past its edge and a
		-- little through the cloud light the ground - a dark scene, brighter toward a clear slot or
		-- the base's edge; beside a storm the open dome keeps it light
		local openI = 1 - (if wI > 0 then coverI / wI else 0)
		local through = math.max(DIFFUSE_FLOOR, 1 - oc)
		st.tD = math.clamp(openI + (1 - openI) * through, DIFFUSE_FLOOR, 1)
		st.tOc = oc
		-- green: light from a low sun scattered through a deep, heavily precipitating core
		local elev = math.deg(math.asin(math.clamp(sz, -1, 1)))
		local lowSun = ramp(elev, -2, 3) * (1 - ramp(elev, 15, 35))
		st.tGreen = 0.4 * lowSun * greenCore * (1 - st.tS)
	end

	local function restore()
		for k, v in def do
			(Lighting :: any)[k] = v
		end
		for k, v in defAtmo do
			(atmosphere :: any)[k] = v
		end
		grade.TintColor = Color3.new(1, 1, 1)
		grade.Saturation, grade.Contrast = 0, 0
		for k, v in defClouds do
			(clouds :: any)[k] = v
		end
		st.cover = 0
		st.ready = false
		st.latitude = nil
		st.published = -1
		ctx.root:SetAttribute("SkyDirect", nil)
		ctx.root:SetAttribute("SkyDiffuse", nil)
	end

	function self:update(dt: number)
		dt = math.clamp(dt, 0, 0.25)
		st.clock += dt
		-- NearPrecip's extinction (always folded into the density)
		local kP = ctx.root:GetAttribute("PrecipExtinction")
		kP = if type(kP) == "number" and kP == kP then math.max(0, kP) else 0
		local dustShare = ctx.root:GetAttribute("PrecipDust")
		dustShare = if type(dustShare) == "number" then math.clamp(dustShare, 0, 1) else 0

		local on = ctx.state.show.sky ~= false
		if not on then
			if st.wasOn then
				st.wasOn = false
				restore()
			end
			atmosphere.Density = math.clamp(Util.densityForExtinction(kDefault + kP), 0, 0.9)
			return
		end
		st.wasOn = true

		setClock()
		if st.clock - st.at > 0.1 or not st.ready then
			st.at = st.clock
			analyse()
		end
		local k = if st.ready then Util.ease(dt, 1.2) else 1
		st.S += (st.tS - st.S) * k
		st.D += (st.tD - st.D) * k
		st.oc += (st.tOc - st.oc) * k
		st.green += (st.tGreen - st.green) * Util.ease(dt, 3)
		st.ready = true
		local S, D, oc = st.S, st.D, st.oc
		local light = 0.65 * S + 0.35 * D
		-- for other renderers (e.g. Clouds shading its pieces): the direct sun and sky light
		local q = math.floor(S * 50 + 0.5) * 100 + math.floor(D * 50 + 0.5)
		if q ~= st.published then
			st.published = q
			ctx.root:SetAttribute("SkyDirect", math.floor(S * 50 + 0.5) / 50)
			ctx.root:SetAttribute("SkyDiffuse", math.floor(D * 50 + 0.5) / 50)
		end

		-- night: the ambient fills fall to a faint skyglow (moonlight a setting), or a dark-night
		-- tornado would stay lit by Roblox's constant ambient
		local sunY0 = Lighting:GetSunDirection().Y
		local nightT = math.clamp((0.05 - sunY0) / 0.22, 0, 1)
		nightT = nightT * nightT * (3 - 2 * nightT)
		local nightFloor = 0.05 + 0.2 * (ctx.state.moonlight or 0)
		local dayK = 1 - nightT * (1 - nightFloor)
		Lighting.Brightness = def.Brightness * (0.05 + 0.95 * S) * (1 - nightT)
		-- (the fills follow the sky light down. At a 0.35 floor the ground under a base drew near
		-- black (~20/255) under a cloud base at ~80: the ground takes the same sky light the base's
		-- cards are shaded with, so with a field's albedo it shows at about half the base's value.
		-- The storm's shadow on ground away from the camera is Render/Ground's, 2026-11-02)
		Lighting.OutdoorAmbient = Util.scale(def.OutdoorAmbient:Lerp(OVERCAST_FILL, 1 - S), (0.7 + 0.3 * D) * dayK)
		Lighting.Ambient = Util.scale(def.Ambient, (0.35 + 0.65 * D) * dayK)
		Lighting.EnvironmentDiffuseScale = def.EnvironmentDiffuseScale * (0.35 + 0.65 * D) * dayK
		Lighting.EnvironmentSpecularScale = def.EnvironmentSpecularScale * (0.3 + 0.7 * S) * dayK
		Lighting.ColorShift_Top = def.ColorShift_Top:Lerp(COOL_TOP, 1 - S)
		-- the eye adapts part of the way to the darkness (never the whole way)
		-- (at most half a stop: up to 0.8 the adaptation gave back most of the darkness under a base)
		Lighting.ExposureCompensation = def.ExposureCompensation + math.clamp(-0.2 * math.log(math.max(0.05, light), 2), 0, 0.5) * (1 - 0.7 * nightT)
		Lighting.ShadowSoftness = def.ShadowSoftness + (1 - def.ShadowSoftness) * (1 - S)
		local sunY = Lighting:GetSunDirection().Y
		local daylight = math.clamp(sunY * 4, 0, 1)
		grade.TintColor = Color3.new(1, 1, 1):Lerp(SHADE_TINT, 0.5 * (1 - S) * daylight):Lerp(GREEN_TINT, st.green)
		grade.Saturation = -0.15 * (1 - light)
		grade.Contrast = -0.1 * (1 - S)

		-- the haze
		local kPkm = kP * ctx.Config.SCALE * 1000 -- (1/stud -> 1/km)
		local wetTarget = ramp(kPkm, 0.2, 3) * (1 - dustShare)
		local dustTarget = ramp(kPkm, 0.2, 3) * dustShare
		st.wet += (wetTarget - st.wet) * k
		st.dust += (dustTarget - st.dust) * k
		-- the storm-owned sky: the dome's cover greys and darkens the open sky too
		st.cover += ((if ctx.state.skyOwn then st.tCover else 0) - st.cover) * k
		local cv = st.cover
		local grey = math.max(oc, 0.85 * cv)
		local tint = HAZE_COLOUR:Lerp(STORM_GREY, grey):Lerp(RAIN_COLOUR, st.wet):Lerp(DUST_COLOUR, st.dust)
		-- (dayK: at night the haze is lit by the skyglow only. Roblox hazes the storm billboards
		-- too, so with a day-grey haze a night storm 10-20 km off drew light grey against a black
		-- sky whatever its cards' colour - pure-red cards showed pale pink, 2026-11-01)
		atmosphere.Color = Util.scale(tint, (0.45 + 0.55 * D) * (1 - 0.3 * cv) * dayK)
		atmosphere.Decay = Util.scale(tint:Lerp(STORM_GREY, 0.5), (0.35 + 0.45 * D) * (1 - 0.3 * cv) * dayK)
		-- Roblox's legacy distance fog still greys BillboardGuis under an Atmosphere: the place's
		-- fixed light-grey FogColor drew a night storm 10 km off at ~170/255 on a black sky (pure
		-- red cards showed (200,166,166) = 87% fog). A distant storm is mostly this fog, so its
		-- light must be the cards' sky light (StormCards light(): 0.32 + 0.38 smooth(0, 0.5, sun)
		-- by day, the skyglow at night), as a share of noon's. On dayK alone it held noon grey
		-- through dusk, then fell to black at sunset in ~0.05 of sun height (dusk sweep F8,
		-- 2026-11-01); now the storm dims with its own cards. Noon is unchanged
		local sunT = math.clamp(sunY0 / 0.5, 0, 1)
		local daySky = (0.32 + 0.38 * sunT * sunT * (3 - 2 * sunT)) / 0.70
		Lighting.FogColor = Util.scale(def.FogColor, daySky * (1 - nightT) + nightFloor * nightT)
		atmosphere.Haze = math.clamp(defAtmo.Haze + 4 * oc + 6 * cv + 3 * st.wet + 2 * st.dust, 0, 10)
		atmosphere.Glare = math.clamp(defAtmo.Glare * S * (1 - oc) * (1 - cv), 0, 10)
		-- the overcast deck (Terrain Clouds): fuller and darker with the cover and the light.
		-- Off by default (LabConfig.SKY_CLOUD_DECK): the layer is one even sheet over the whole
		-- sky, so it greyed the sunny side as much as the storm's, ended at the horizon in a
		-- stepped edge and drew dark masses and a ring under the base (2026-11-01 shots P2/P3).
		-- The storm's own cards (forward flank, anvil) cover the sky where it really is cloud
		if cv > 0.03 and ctx.Config.SKY_CLOUD_DECK == true then
			clouds.Enabled = true
			clouds.Cover = math.clamp(0.45 + 0.55 * cv, 0, 1)
			clouds.Density = math.clamp(0.25 + 0.6 * cv, 0, 1)
			clouds.Color = Util.scale(CLOUD_DECK, (0.35 + 0.65 * D) * dayK)
		elseif clouds.Enabled ~= defClouds.Enabled then
			clouds.Enabled = defClouds.Enabled
			clouds.Cover, clouds.Density, clouds.Color = defClouds.Cover, defClouds.Density, defClouds.Color
		end
		if st.clock - (st.coverLog or -10) > 5 then
			st.coverLog = st.clock
			ctx.root:SetAttribute("SkyCover", math.floor(cv * 100 + 0.5) / 100)
		end
		atmosphere.Offset = defAtmo.Offset
		atmosphere.Density = math.clamp(Util.densityForExtinction(kClear + kP), 0, 0.9)
	end

	function self:destroy()
		restore()
		grade:Destroy()
		if madeClouds then
			clouds:Destroy()
		end
	end

	return self
end

return Sky
