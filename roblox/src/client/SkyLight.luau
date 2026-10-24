--!strict
-- The light where the camera is, from the weather: nothing here is set by a storm's or a sky's
-- type, only by what the feed's fields hold (shared/Weather/StormTrack: the frame's sky, from
-- js/world/SkyAppearance.js, and the storms, from js/storms/StormAppearance.js).
--
--   The sun      where the engine has it: the frame's hour at the map's local solar time, its
--                sunrise and sunset put where Roblox's sun rises and sets, and the latitude set
--                so the noon sun stands as high as a day that long has it (Roblox's sun keeps an
--                equinox path; its rise and set are measured once, not assumed).
--   Seeing       how far one sees (km), from the haze moist air holds (the relative humidity),
--                dust a strong wind lifts off dry soil, and rain and hail falling where the camera
--                is; their extinctions add, and the result sets the Atmosphere.
--   Light        the direct sun: what the cloud layers let through, and what any storm's tower,
--                base, anvil and rain let through on the line from the camera to the sun (the same
--                shapes StormView draws). The sky's light: what is overhead lets through. These set
--                the sun's brightness, the ambient light, shadow softness, the eye's adaptation,
--                colour (sun-lit or the cool, flat light under cloud) and sun rays.
--   Cloud        Roblox's cloud layer over the camera, as the low and middle layers have it.
--   Lightning    a strike lights the scene for a moment, more the closer and the darker it is.
--
-- LOOK holds how Roblox's lighting answers these: rendering settings, not weather.

local Lighting = game:GetService("Lighting")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage.Shared.World.Config)

local SkyLight = {}

local KM = Config.STUDS_PER_MILE / Config.KM_PER_MILE -- studs a km, across
local SKY = Config.SKY_STUDS_PER_METRE -- studs a metre, up
local HALF = Config.MAP_MILES / 2 * Config.STUDS_PER_MILE
local HALF_X = if Config.VIEW_ORIGIN_KM then Config.VIEW_ORIGIN_KM.x * KM else HALF -- (see Config.VIEW_ORIGIN_KM)
local HALF_Z = if Config.VIEW_ORIGIN_KM then Config.VIEW_ORIGIN_KM.y * KM else HALF

local LOOK = {
	-- Roblox's Atmosphere (undocumented; measured in Studio 2026-10-22 with black towers 1-32k
	-- studs away, Offset 0.25): an object x studs away shows exp(-k x) of its contrast, with
	-- k = fogA * Density ^ fogPower per stud (fits Density 0.1-0.3 within ~10%; Haze changes the
	-- sky's colour, not k). The visibility distance is where 2% shows: 3.912 / k.
	fogA = 0.188,
	fogPower = 4.15,
	densityRange = { 0.05, 0.9 },
	-- Haze in moist air: clear air shows dryVisibilityKm, falling as (1 - RH) ^ hazeExponent as
	-- the haze particles take up water (Hänel's growth); near saturation no worse than observed
	-- mist and fog give (Gultepe et al. 2009: 40.1 - 5.19e-10 RH% ^ 5.44 km, 0.7 km at 100%).
	dryVisibilityKm = 120,
	hazeExponent = 0.8,
	-- Dust: lifted where the wind passes dustWindKt over soil drier than dustSoil; at dustWindKt +
	-- 15 kt over bone-dry soil one sees dustVisibilityKm.
	dustWindKt = 20,
	dustSoil = 0.3,
	dustVisibilityKm = 8,
	-- Rain: at intensity 1 one sees rainVisibilityKm / 2.2; hail counts as half as much again.
	rainVisibilityKm = 2.5,
	-- How much of the direct sun each cloud layer stops where it covers the sky.
	cloudOpacity = { low = 0.85, mid = 0.6, high = 0.25 },
	-- How much of the sky's light each layer takes away, overcast.
	cloudShade = { low = 0.5, mid = 0.3, high = 0.08 },
	-- How much of the sun a storm's parts stop, and of the sky's light when overhead.
	stormOpacity = { tower = 0.97, base = 0.9, anvil = 0.55, anvilRoot = 0.85, rain = 0.7 },
	stormShade = { base = 0.8, anvil = 0.45, rain = 0.5 },
	-- The eye adapts: this share of a change in light shows (log2 of exposure). (2026-10-23: 0.4
	-- -> 0.1, measured against storm-base photos: under a base the scene read 4x too dark against
	-- an adapted eye or camera; docs/storm-visuals/PLAN.md section 6)
	adapt = 0.1,
	-- The sky's light never falls below this share of an open sky's: under a storm's base, in its
	-- rain, light still comes in from round the storm (the shading of each part multiplied
	-- otherwise left 2% and a scene too dark to see).
	diffuseFloor = 0.4, -- (2026-10-23: 0.15 -> 0.4, against photos from under a base's edge)
	-- The sky's fill light with the sun blocked. Roblox's outdoor ambient is the fill beside a
	-- bright sun; with the sun gone the sky's light is all the light, so the fill rises toward
	-- this as the direct sun falls (then dims as the storm covers the sky).
	overcastFill = Color3.fromRGB(150, 152, 158),
	-- Colour of light under cloud (the sky's blue, no sun), and haze colours.
	shadeTint = Color3.fromRGB(214, 226, 255),
	hazeColour = Color3.fromRGB(200, 210, 222),
	dustColour = Color3.fromRGB(196, 168, 128),
	rainColour = Color3.fromRGB(128, 138, 152),
	-- Seconds for the light to settle to a change (fields are smooth; storm edges less so).
	settle = 1.2,
	flashSeconds = 0.09,
	flashReachStuds = 8000,
}

-- Map position (studs) to km east and south of the NW corner.
local function km(p: Vector3): (number, number)
	return (p.X + HALF_X) / KM, (p.Z + HALF_Z) / KM
end

-- How far inside an ellipse (half-lengths along and across a bearing, centred at x, y) a place
-- is: 1 well inside, 0 outside, soft across the edge.
local function within(xKm: number, yKm: number, alongKm: number, acrossKm: number, bearingDeg: number, px: number, py: number): number
	local r = math.rad(bearingDeg)
	local dx, dy = px - xKm, -(py - yKm)
	local along = dx * math.sin(r) + dy * math.cos(r)
	local across = dx * math.cos(r) - dy * math.sin(r)
	local d = math.sqrt((along / math.max(0.1, alongKm)) ^ 2 + (across / math.max(0.1, acrossKm)) ^ 2)
	return math.clamp((1.15 - d) / 0.3, 0, 1)
end

local function anvilCentre(s: any): (number, number)
	local b = math.rad(s.anvil.bearingDeg)
	return s.updraft.xKm + math.sin(b) * s.anvil.lengthKm * 0.45, s.updraft.yKm - math.cos(b) * s.anvil.lengthKm * 0.45
end

-- The share of the sun one storm lets through on the line from the camera along sunDir.
local function stormTransmission(s: any, cameraPos: Vector3, sunDir: Vector3): number
	local alpha = s.alpha or 1
	local ground = s.groundStuds or 0
	local up = s.updraft
	local baseY, topY = ground + up.baseM * SKY, ground + up.topM * SKY
	local o = LOOK.stormOpacity
	local t = 1
	local function through(y: number, op: number, test: (number, number) -> number)
		if y <= cameraPos.Y then
			return
		end
		local p = cameraPos + sunDir * ((y - cameraPos.Y) / sunDir.Y)
		local px, py = km(p)
		t *= 1 - op * alpha * test(px, py)
	end
	through((baseY + topY) / 2, o.tower, function(px, py)
		return within(up.xKm, up.yKm, up.radiusKm, up.radiusKm, 0, px, py)
	end)
	through(baseY, o.base, function(px, py)
		return within(up.xKm, up.yKm, s.base.radiusKm, s.base.radiusKm, 0, px, py)
	end)
	local anvilY = ground + s.anvil.topM * SKY - 700 * SKY
	local ax, ay = anvilCentre(s)
	through(anvilY, o.anvil, function(px, py)
		return within(ax, ay, s.anvil.lengthKm / 2, s.anvil.widthKm / 2, s.anvil.bearingDeg, px, py)
	end)
	through(anvilY, o.anvilRoot, function(px, py)
		return within(up.xKm, up.yKm, up.radiusKm * 1.3, up.radiusKm * 1.3, 0, px, py)
	end)
	local rain = s.rain
	if rain.intensity > 0.03 then
		through((ground + baseY) / 2, o.rain * rain.intensity, function(px, py)
			return within(rain.xKm, rain.yKm, rain.alongKm / 2, rain.acrossKm / 2, rain.bearingDeg, px, py)
		end)
	end
	return t
end

-- Relative humidity (0-1) from temperature and dewpoint (F), Magnus's formula.
local function humidity(tF: number, tdF: number): number
	local t, td = (tF - 32) * 5 / 9, (tdF - 32) * 5 / 9
	local function es(c: number): number
		return math.exp(17.62 * c / (243.12 + c))
	end
	return math.clamp(es(td) / es(t), 0, 1)
end

-- Roblox's sunrise and sunset (ClockTime) at the latitude now set, found by stepping the clock.
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

-- The engine's local solar hour as Roblox's clock: day onto Roblox's day, night onto its night.
local function robloxClock(solar: number, sunrise: number, sunset: number, rise: number, set: number): number
	if solar >= sunrise and solar <= sunset then
		return rise + (solar - sunrise) / (sunset - sunrise) * (set - rise)
	end
	local into = (solar - sunset) % 24
	return (set + into / (24 - (sunset - sunrise)) * (24 - (set - rise))) % 24
end

-- The latitude for Roblox's equinox sun that gives the noon height of a day `hours` long at latDeg.
local function equinoxLatitude(latDeg: number, hours: number): number
	local h0 = math.rad(hours / 2 * 15)
	local declination = math.atan(-math.cos(h0) / math.tan(math.rad(latDeg)))
	return latDeg - math.deg(declination)
end

local function scale(c: Color3, k: number): Color3
	return Color3.new(math.clamp(c.R * k, 0, 1), math.clamp(c.G * k, 0, 1), math.clamp(c.B * k, 0, 1))
end

local function child(parent: Instance, class: string): any
	local found = parent:FindFirstChildOfClass(class)
	if not found then
		found = Instance.new(class)
		found.Parent = parent
	end
	return found
end

local state: any = nil
local warned = false

local function setup()
	local atmosphere = child(Lighting, "Atmosphere") :: Atmosphere
	state = {
		brightness = Lighting.Brightness,
		exposure = Lighting.ExposureCompensation,
		outdoor = Lighting.OutdoorAmbient,
		ambient = Lighting.Ambient,
		offset = atmosphere.Offset,
		atmosphere = atmosphere,
		colour = child(Lighting, "ColorCorrectionEffect") :: ColorCorrectionEffect,
		rays = child(Lighting, "SunRaysEffect") :: SunRaysEffect,
		clouds = child(workspace.Terrain, "Clouds") :: Clouds,
		latitude = nil :: number?,
		rise = 6,
		set = 18,
		flash = 0,
		-- Settled values (each eased toward its target).
		direct = 1,
		diffuse = 1,
		visibilityKm = 40,
		dust = 0,
		wet = 0,
		low = 0,
		mid = 0,
		humid = 0.5,
		ready = false,
	}
end

-- The share of direct sun reaching the camera now (0-1; 1 before the first frame).
function SkyLight.direct(): number
	return if state then state.direct else 1
end

-- How far one sees at the camera now (km; from the humidity, dust and rain), for the storm
-- clouds' own haze (StormMesh): nil before the first frame.
function SkyLight.visibilityKm(): number?
	return if state then state.visibilityKm else nil
end

-- A lightning strike this far (studs) from the camera.
function SkyLight.flash(distanceStuds: number)
	if state then
		state.flash = math.max(state.flash, 1 / (1 + (distanceStuds / LOOK.flashReachStuds) ^ 2))
	end
end

-- Each frame: the storms as sampled (with alpha), the simulated hour (UTC, nil without frames),
-- the sky at the camera (StormTrack.skyAt, nil when the feed carries none).
function SkyLight.update(storms: { any }, hourUtc: number?, sky: any, cameraPos: Vector3, dt: number)
	if not state then
		setup()
	end
	if hourUtc == nil then
		return
	end
	local st = state

	-- The sun.
	if sky and sky.sun then
		local sun = sky.sun
		local latitude = equinoxLatitude(sun.latDeg, sun.sunsetLocal - sun.sunriseLocal)
		if st.latitude ~= latitude then
			Lighting.GeographicLatitude = latitude
			st.latitude = latitude
			st.rise, st.set = robloxDay()
		end
		local solar = (hourUtc + sun.utcOffsetHours) % 24
		Lighting.ClockTime = robloxClock(solar, sun.sunriseLocal, sun.sunsetLocal, st.rise, st.set)
	elseif not warned then
		warned = true
		warn("[SkyLight] the feed carries no sky (an old replay? re-run scripts/export-storm-replay.mjs): sun and haze left as they are")
	end
	local sunDir = Lighting:GetSunDirection()

	-- The direct sun and the sky's light.
	local direct, diffuse = 1, 1
	if sky then
		local o, sh = LOOK.cloudOpacity, LOOK.cloudShade
		direct *= (1 - o.low * sky.low) * (1 - o.mid * sky.mid) * (1 - o.high * sky.high)
		diffuse *= (1 - sh.low * sky.low) * (1 - sh.mid * sky.mid) * (1 - sh.high * sky.high)
	end
	local px, py = km(cameraPos)
	local wet, hail = 0, 0
	local shade = LOOK.stormShade
	for _, s in storms do
		local alpha = s.alpha or 1
		if sunDir.Y > 0.01 then
			direct *= stormTransmission(s, cameraPos, sunDir)
		end
		local ax, ay = anvilCentre(s)
		diffuse *= 1 - shade.anvil * alpha * within(ax, ay, s.anvil.lengthKm / 2, s.anvil.widthKm / 2, s.anvil.bearingDeg, px, py)
		diffuse *= 1 - shade.base * alpha * within(s.updraft.xKm, s.updraft.yKm, s.base.radiusKm, s.base.radiusKm, 0, px, py)
		local r = s.rain
		local inRain = alpha * within(r.xKm, r.yKm, r.alongKm / 2, r.acrossKm / 2, r.bearingDeg, px, py)
		diffuse *= 1 - (shade.rain + 0.35 * r.intensity) * inRain
		wet = math.max(wet, r.intensity * inRain)
		if s.hail.radiusKm > 0.2 then
			hail = math.max(hail, alpha * within(s.hail.xKm, s.hail.yKm, s.hail.radiusKm, s.hail.radiusKm, 0, px, py))
		end
	end

	-- How far one sees: extinctions (3.912 / visibility) add.
	local ext, dust, humid = 0, 0, st.humid
	if sky then
		humid = humidity(sky.tF, sky.tdF)
		local hanel = LOOK.dryVisibilityKm * (1 - humid) ^ LOOK.hazeExponent
		local gultepe = 40.1 - 5.19e-10 * (100 * humid) ^ 5.44
		ext += 3.912 / math.max(0.5, hanel, gultepe)
		local lift = math.max(0, sky.windKt - LOOK.dustWindKt) / 15
		local dry = math.clamp(1 - sky.soil / LOOK.dustSoil, 0, 1)
		dust = 3.912 / LOOK.dustVisibilityKm * lift * lift * dry * (1 - wet)
		ext += dust
	end
	local rainExt = 3.912 / LOOK.rainVisibilityKm * (0.2 * math.min(1, wet * 5) + 2 * wet + hail * wet * 1.5)
	if not Config.SHOW_PRECIPITATION then
		rainExt = 0
	end
	ext += rainExt

	-- Ease toward the targets.
	local k = 1 - math.exp(-dt / LOOK.settle)
	local function ease(name: string, target: number)
		st[name] = if st.ready then st[name] + (target - st[name]) * k else target
	end
	ease("direct", direct)
	ease("diffuse", math.max(LOOK.diffuseFloor, diffuse))
	ease("visibilityKm", 3.912 / ext)
	ease("dust", if ext > 0 then dust / ext else 0)
	ease("wet", if ext > 0 then rainExt / ext else 0)
	ease("humid", humid)
	if sky then
		ease("low", sky.low)
		ease("mid", sky.mid)
	end
	st.ready = true
	st.flash *= math.exp(-dt / LOOK.flashSeconds)

	-- Light.
	local S, D = st.direct, st.diffuse
	local light = 0.65 * S + 0.35 * D
	Lighting.Brightness = st.brightness * (0.04 + 0.96 * S)
	Lighting.OutdoorAmbient = scale(st.outdoor:Lerp(LOOK.overcastFill, 1 - S), 0.45 + 0.55 * D + 2 * st.flash)
	Lighting.Ambient = scale(st.ambient, 0.5 + 0.5 * D + 2 * st.flash)
	Lighting.ExposureCompensation = st.exposure + LOOK.adapt * math.log(0.12 + 0.88 * light, 2) + 1.6 * st.flash
	Lighting.ShadowSoftness = 0.15 + 0.85 * (1 - S)
	local cc = st.colour
	cc.Saturation = -0.4 * (1 - light)
	cc.Contrast = 0.05 * S - 0.2 * (1 - S)
	cc.TintColor = Color3.new(1, 1, 1):Lerp(LOOK.shadeTint, 0.6 * (1 - S) * math.clamp(sunDir.Y * 4, 0, 1))
	st.rays.Intensity = 0.12 * S
	st.rays.Spread = 0.6

	-- Haze (left as it is when the feed carries no sky).
	if not sky then
		return
	end
	local a = st.atmosphere
	local extinction = 3.912 / (st.visibilityKm * KM)
	a.Density = math.clamp((extinction / LOOK.fogA) ^ (1 / LOOK.fogPower), LOOK.densityRange[1], LOOK.densityRange[2])
	local tint = LOOK.hazeColour:Lerp(LOOK.dustColour, st.dust):Lerp(LOOK.rainColour, st.wet)
	a.Color = scale(tint, 0.45 + 0.55 * D)
	a.Decay = scale(tint:Lerp(LOOK.rainColour, 0.5), 0.35 + 0.45 * D)
	local overcast = 1 - D
	-- (2026-10-23: clear-air part 0.5 + 3 RH^4 -> 0.15 + 1.2 RH^4, against storm photos: the sky
	-- round a storm in sunshine is a deep blue, which a haze of ~2.5 washed out)
	a.Haze = math.clamp(0.15 + 1.2 * st.humid ^ 4 + 5 * overcast + 4 * st.wet, 0, 10)
	a.Glare = math.clamp(0.6 * S * (1 - overcast), 0, 10)
	a.Offset = st.offset

	-- Roblox's cloud layer over the camera.
	local clouds = st.clouds
	clouds.Cover = math.clamp(1 - (1 - st.low) * (1 - 0.85 * st.mid), 0, 1)
	clouds.Density = math.clamp(0.25 + 0.6 * st.low, 0, 1)
	clouds.Color = scale(Color3.new(1, 1, 1), 0.5 + 0.5 * S)
end

return SkyLight
