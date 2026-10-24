--!strict
-- Draws the storms the weather feed sends (server/WeatherFeed; shared/Weather/StormTrack). Every
-- size, place and strength comes from the storm's description (js/storms/StormAppearance.js);
-- nothing here reads a storm's or a tornado's type name. Drawn on this client only, from parts
-- (no uploaded meshes yet): ellipsoid blobs (a Block with a sphere SpecialMesh, which can be drawn
-- beyond the 2048-stud part limit) and cylinders.
--
-- Scale (World/Config): positions at STUDS_PER_MILE; clouds upward at SKY_STUDS_PER_METRE (the
-- same as across, so a storm keeps its shape); a tornado's widths at TORNADO_STUDS_PER_METRE.
--
-- Per storm: the updraught tower (banded where it rotates, an overshooting dome on a strong
-- one), the base, the anvil (mammatus under a mature one), the wall cloud with scud turning round
-- it and its tail cloud, inflow bands, the shelf cloud on the gust front (tiers, running out
-- ahead where the outflow leads), the rain and hail cores, and rain wrapping round the rotation.
-- Per tornado: the condensation funnel (its radius at each height, leaning and twisting as it
-- decays, lowering from the cloud as it touches down), the uncondensed vortex below it, the
-- smaller vortices of a multiple-vortex tornado, and the debris cloud and debris.
-- Also lightning and rain where the camera is; the light, haze and sun are SkyLight's.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local Config = require(ReplicatedStorage.Shared.World.Config)
local StormTrack = require(ReplicatedStorage.Shared.Weather.StormTrack)
local SkyLight = require(script.Parent.SkyLight)
local TornadoArt = require(script.Parent.TornadoArt)
local CloudVolume = require(script.Parent.CloudVolume)
local StormMesh = require(script.Parent.StormMesh)
local StormKit = require(script.Parent.StormKit)
local watching = false -- (the WatchTornado look-dev camera has the camera)
local Precip = require(ReplicatedStorage.Shared.Weather.Precip)

local StormView = {}

local KM = Config.STUDS_PER_MILE / Config.KM_PER_MILE -- studs a km, across
local SKY = Config.SKY_STUDS_PER_METRE -- studs a metre, up (clouds)
local TOR = Config.TORNADO_STUDS_PER_METRE -- studs a metre, across a tornado
local HALF = Config.MAP_MILES / 2 * Config.STUDS_PER_MILE
-- stud offsets of the map's north-west corner (the map's centre at 0, unless the lab moves it)
local HALF_X = if Config.VIEW_ORIGIN_KM then Config.VIEW_ORIGIN_KM.x * KM else HALF
local HALF_Z = if Config.VIEW_ORIGIN_KM then Config.VIEW_ORIGIN_KM.y * KM else HALF
local VIEW = Config.STORM_VIEW_MILES * Config.STUDS_PER_MILE
local MAX_PART = 2048
local TAU = math.pi * 2

local COLOUR = {
	towerTop = Color3.fromRGB(226, 226, 230),
	tower = Color3.fromRGB(178, 181, 189),
	band = Color3.fromRGB(132, 136, 146),
	base = Color3.fromRGB(62, 65, 74),
	anvil = Color3.fromRGB(214, 216, 222),
	wall = Color3.fromRGB(52, 55, 62),
	scud = Color3.fromRGB(96, 100, 108),
	inflow = Color3.fromRGB(196, 198, 204),
	shelf = Color3.fromRGB(78, 86, 98),
	rain = Color3.fromRGB(92, 102, 116),
	hail = Color3.fromRGB(118, 150, 140),
	funnel = Color3.fromRGB(128, 128, 132),
	funnelWrapped = Color3.fromRGB(70, 72, 78),
	dust = Color3.fromRGB(122, 100, 76),
	debris = Color3.fromRGB(70, 62, 54),
	bolt = Color3.fromRGB(220, 226, 255),
}

-- Map position (km east and south of the NW corner) to studs.
local function at(xKm: number, yKm: number, y: number): Vector3
	return Vector3.new(xKm * KM - HALF_X, y, yKm * KM - HALF_Z)
end
-- A bearing (degrees clockwise from north) as a flat unit vector.
local function heading(deg: number): Vector3
	local r = math.rad(deg)
	return Vector3.new(math.sin(r), 0, -math.cos(r))
end
local function hash(text: string): number
	local h = 2166136261
	for i = 1, #text do
		h = bit32.bxor(h, string.byte(text, i))
		h = (h * 16777619) % 4294967296
	end
	return h / 4294967296
end

-- Parts -------------------------------------------------------------------------------------

type Pool = { model: Model, parts: { [string]: BasePart }, used: { [string]: boolean }, cloudKeys: { [string]: boolean }?, nextAt: number?, look: Vector3? }

local root = Instance.new("Folder")
root.Name = "StormView"

local function newPool(name: string): Pool
	local model = Instance.new("Model")
	model.Name = name
	model.Parent = root
	return { model = model, parts = {}, used = {} }
end

local function basePart(pool: Pool, key: string, cylinder: boolean): BasePart
	local part = pool.parts[key]
	if not part then
		local p = Instance.new("Part")
		p.Anchored, p.CanCollide, p.CanQuery, p.CanTouch, p.CastShadow = true, false, false, false, false
		p.Material = Enum.Material.SmoothPlastic
		p.TopSurface, p.BottomSurface = Enum.SurfaceType.Smooth, Enum.SurfaceType.Smooth
		if cylinder then
			p.Shape = Enum.PartType.Cylinder
		else
			local mesh = Instance.new("SpecialMesh")
			mesh.MeshType = Enum.MeshType.Sphere
			mesh.Parent = p
		end
		p.Name = key
		p.Parent = pool.model
		pool.parts[key] = p
		part = p
	end
	pool.used[key] = true
	return part :: BasePart
end

-- An ellipsoid of the given full size (x across, y up, z along) at cf.
local function blob(pool: Pool, key: string, cf: CFrame, size: Vector3, colour: Color3, transparency: number)
	local part = basePart(pool, key, false)
	local ps = Vector3.new(math.clamp(size.X, 0.2, MAX_PART), math.clamp(size.Y, 0.2, MAX_PART), math.clamp(size.Z, 0.2, MAX_PART))
	if part.Size ~= ps then
		part.Size = ps
	end
	local mesh = part:FindFirstChildOfClass("SpecialMesh") :: SpecialMesh
	mesh.Scale = Vector3.new(math.max(size.X, 0.2) / ps.X, math.max(size.Y, 0.2) / ps.Y, math.max(size.Z, 0.2) / ps.Z)
	part.CFrame = cf
	part.Color = colour
	part.Transparency = transparency
end

-- A cylinder of radius r from p0 to p1.
local function rod(pool: Pool, key: string, p0: Vector3, p1: Vector3, r: number, colour: Color3, transparency: number)
	local part = basePart(pool, key, true)
	local length = (p1 - p0).Magnitude
	if length < 0.05 then
		part.Transparency = 1
		return
	end
	local size = Vector3.new(math.min(length, MAX_PART), math.clamp(2 * r, 0.2, MAX_PART), math.clamp(2 * r, 0.2, MAX_PART))
	if part.Size ~= size then
		part.Size = size
	end
	part.CFrame = CFrame.lookAt((p0 + p1) / 2, p1) * CFrame.Angles(0, math.pi / 2, 0)
	part.Color = colour
	part.Transparency = transparency
end

local function emitter(pool: Pool, key: string): (BasePart, ParticleEmitter)
	local part = basePart(pool, key, true)
	part.Transparency = 1
	local e = part:FindFirstChildOfClass("ParticleEmitter")
	if not e then
		local made = Instance.new("ParticleEmitter")
		made.Texture = "rbxasset://textures/particles/smoke_main.dds"
		made.Shape = Enum.ParticleEmitterShape.Cylinder
		made.ShapeInOut = Enum.ParticleEmitterShapeInOut.Outward
		made.ShapeStyle = Enum.ParticleEmitterShapeStyle.Volume
		made.LightEmission = 0
		made.LightInfluence = 1
		made.Rotation = NumberRange.new(0, 360)
		made.RotSpeed = NumberRange.new(-120, 120)
		made.Parent = part
		e = made
	end
	return part, e :: ParticleEmitter
end

-- Hides what was not drawn this frame.
local function finish(pool: Pool)
	for key, part in pool.parts do
		if not pool.used[key] then
			if part.Transparency < 1 then
				part.Transparency = 1
			end
			local e = part:FindFirstChildOfClass("ParticleEmitter")
			if e then
				e.Enabled = false
			end
			local b = part:FindFirstChildOfClass("Beam")
			if b and b.Enabled then
				b.Enabled = false
			end
		end
	end
	table.clear(pool.used)
end

local function fade(t: number, alpha: number): number
	return 1 - (1 - t) * math.clamp(alpha, 0, 1)
end

-- Puffs and curtains (Config.CLOUD_ART) -----------------------------------------------------
--
-- A cloud is drawn as soft puffs, each a Beam whose two ends lie along the camera's right (turned
-- a little) with its width up the screen: a camera-facing card of any size. They sit at fixed
-- places in the cloud's volume (from its key), drift a little, turn slowly and fade in and out, so
-- the cloud keeps changing and has soft, see-through edges instead of a surface. A curtain is a
-- Beam hung from the base to the ground, its streaked texture falling down it.

local CLOUD = Config.CLOUD_ART
local PUFFED = CLOUD.puffs[1] ~= ""
local camRight, camUp, camPos = Vector3.xAxis, Vector3.yAxis, Vector3.zero
local lastT: { [Instance]: number } = {}
local lastC: { [Instance]: Color3 } = {}
local seeds: { [string]: { number } } = {}

local function beamPart(pool: Pool, key: string, texture: string): (BasePart, Beam, Attachment, Attachment)
	local part = pool.parts[key]
	if not part then
		local p = Instance.new("Part")
		p.Anchored, p.CanCollide, p.CanQuery, p.CanTouch, p.CastShadow = true, false, false, false, false
		p.Transparency = 1
		p.Size = Vector3.one
		local a0 = Instance.new("Attachment")
		a0.Name = "A0"
		a0.Parent = p
		local a1 = Instance.new("Attachment")
		a1.Name = "A1"
		a1.Parent = p
		local b = Instance.new("Beam")
		b.Attachment0, b.Attachment1 = a0, a1
		b.FaceCamera = true
		b.Segments = 1
		b.LightInfluence = 1
		b.LightEmission = 0
		b.Texture = texture
		b.TextureMode = Enum.TextureMode.Stretch
		b.TextureLength = 1
		b.Parent = p
		p.Name = key
		p.Parent = pool.model
		pool.parts[key] = p
		part = p
	end
	pool.used[key] = true
	local p = part :: BasePart
	local b = p:FindFirstChildOfClass("Beam") :: Beam
	if not b.Enabled then
		b.Enabled = true
	end
	return p, b, p:FindFirstChild("A0") :: Attachment, p:FindFirstChild("A1") :: Attachment
end

local function beamLook(part: BasePart, b: Beam, colour: Color3, t: number, top: number?)
	local key = math.floor(t * 50 + 0.5) + (if top then 1000 * math.floor(top * 50 + 0.5) else 0)
	if lastT[part] ~= key then
		lastT[part] = key
		b.Transparency = if top
			then NumberSequence.new({ NumberSequenceKeypoint.new(0, top), NumberSequenceKeypoint.new(0.3, t), NumberSequenceKeypoint.new(1, t) })
			else NumberSequence.new(t)
	end
	if lastC[part] ~= colour then
		lastC[part] = colour
		b.Color = ColorSequence.new(colour)
	end
end

-- One puff: w across, h up the screen, centred at p; seed 0-1 picks its texture, turn and phase.
local function puff(pool: Pool, key: string, p: Vector3, w: number, h: number, colour: Color3, transparency: number, seed: number, clock: number)
	local part, b, a0, a1 = beamPart(pool, key, CLOUD.puffs[1 + math.floor(seed * 4) % 4])
	-- Turning slowly in the view (less for a flat puff, which keeps lying flat).
	local flat = math.clamp(w / h - 1, 0, 1)
	local ang = (seed - 0.5) * (1 - 0.8 * flat) * 2 + clock * 0.012 * (seed - 0.5) * (1 - flat)
	local r = camRight * math.cos(ang) + camUp * math.sin(ang)
	part.CFrame = CFrame.new(p)
	a0.Position = -r * (w / 2)
	a1.Position = r * (w / 2)
	if b.Width0 ~= h then
		b.Width0, b.Width1 = h, h
	end
	-- Fading in and out (the cloud churning), and away close to the camera (a card round the
	-- camera is a screen full of quad).
	local churn = 0.35 * (0.5 + 0.5 * math.sin(clock * 0.06 + seed * 40))
	local d = (p - camPos).Magnitude
	local near = math.clamp((d - 0.4 * w) / (0.8 * w), 0, 1)
	beamLook(part, b, colour, 1 - (1 - transparency) * (1 - churn) * near)
end

-- A cloud volume (an ellipsoid of the given full size at cf) as puffs; plain shape without the art.
local function cloud(pool: Pool, key: string, cf: CFrame, size: Vector3, colour: Color3, transparency: number, clock: number)
	if not PUFFED then
		blob(pool, key, cf, size, colour, transparency)
		return
	end
	local sx, sy, sz = size.X, size.Y, size.Z
	local minD, maxD = math.min(sx, sy, sz), math.max(sx, sy, sz)
	local w = math.clamp(math.max(minD, math.sqrt(sx * sz / 40)), 60, math.min(3000, maxD))
	local h = math.clamp(math.min(w, sy * 1.15), 40, 3000)
	local n = math.clamp(math.ceil(1.6 * sx * sy * sz / (w * w * h)), 3, 48)
	local list = seeds[key]
	if not list or #list < n * 3 then
		list = {}
		for i = 1, 48 * 3 do
			list[i] = hash(key .. "~" .. i)
		end
		seeds[key] = list
	end
	local half = Vector3.new(math.max(0, sx / 2 - w * 0.3), math.max(0, sy / 2 - h * 0.3), math.max(0, sz / 2 - w * 0.3))
	for i = 1, n do
		local s1, s2, s3 = list[3 * i - 2], list[3 * i - 1], list[3 * i]
		-- A point in the ball, drifting a little.
		local th, ph, rr = TAU * s1, math.acos(2 * s2 - 1), s3 ^ (1 / 3)
		local u = Vector3.new(math.sin(ph) * math.cos(th), math.cos(ph), math.sin(ph) * math.sin(th)) * rr
		local drift = Vector3.new(math.noise(s1 * 17, clock * 0.02), math.noise(s2 * 17, clock * 0.02), math.noise(s3 * 17, clock * 0.02)) * 0.12
		puff(pool, key .. "~" .. i, cf * ((u + drift) * half), w * (0.8 + 0.4 * s1), h * (0.8 + 0.4 * s2), colour, transparency, s1, clock)
	end
end

-- A curtain of rain or hail: its foot on the ground, up to topY, width across; faded into the
-- cloud at the top, and away close to the camera (the rain at the camera is drawn as rain).
local function curtain(pool: Pool, key: string, foot: Vector3, topY: number, width: number, colour: Color3, transparency: number)
	if CLOUD.rain == "" then
		return
	end
	-- (the soft shaft texture: from kilometres away rain is a grey column, not streaks)
	local texture = if CLOUD.rainShaft and CLOUD.rainShaft ~= "" then CLOUD.rainShaft else CLOUD.rain
	local part, b, a0, a1 = beamPart(pool, key, texture)
	if b.TextureMode ~= Enum.TextureMode.Wrap then
		b.TextureMode = Enum.TextureMode.Wrap
		b.TextureSpeed = 0.1
	end
	b.TextureLength = width * 4
	part.CFrame = CFrame.new(foot)
	a0.Position = Vector3.new(0, topY - foot.Y, 0)
	a1.Position = Vector3.zero
	b.Width0, b.Width1 = width * 0.85, width
	local d = (Vector3.new(foot.X, camPos.Y, foot.Z) - camPos).Magnitude
	local near = math.clamp((d - 0.3 * width) / (0.7 * width), 0, 1)
	local t = 1 - (1 - transparency) * near
	beamLook(part, b, colour, t, 1 - (1 - t) * 0.3)
end

-- A storm's clouds --------------------------------------------------------------------------

-- volumetric: the tower, base, anvil and wall cloud are drawn by CloudVolume instead.
local function drawClouds(pool: Pool, s: any, clock: number, volumetric: boolean, meshed: boolean, kitted: boolean?)
	local alpha = s.alpha or 1
	local ground = s.groundStuds or 0
	local up = s.updraft
	local baseY = ground + up.baseM * SKY
	local topY = ground + up.topM * SKY
	local R = up.radiusKm * KM
	local centre = at(up.xKm, up.yKm, baseY)
	local seed = hash(s.id)
	local downwind = heading(s.anvil.bearingDeg)

	-- The towers: one over the updraught; along a line, a row of them along its axis.
	local lineShare = s.line.share
	local towers = if lineShare > 0.3 then math.clamp(math.floor(2 * s.line.halfLengthKm / 12), 2, 8) else 1
	local axis = heading(s.line.axisBearingDeg)
	local levels = 6
	-- meshed: the tower, base, anvil and wall cloud are shells (StormMesh); kitted: they are cloud
	-- kit pieces (StormKit), and so is the shelf
	local ownMeshed = meshed -- (StormMesh draws its scud and rain shafts)
	meshed = meshed or kitted == true
	for k = 1, if volumetric or meshed then 0 else towers do
		local along = if towers > 1 then ((k - 0.5) / towers - 0.5) * 2 * s.line.halfLengthKm * KM else 0
		local scale = if towers > 1 then 0.75 + 0.25 * math.sin(k * 2.3 + seed * 9) else 1
		local foot = centre + axis * along
		local height = (topY - baseY) * scale
		for i = 0, levels - 1 do
			local f = i / (levels - 1)
			local r = R * scale * (0.95 - 0.35 * f * f)
			-- Leaning a little downwind with height, the way the wind aloft takes it. Stacked up from
			-- the base: each level's blob reaches half its height below its centre, so the lowest sits
			-- on the base (centred on it, it hung kilometres below the base, down to the ground).
			local half = height / levels * 0.95
			local c = foot + Vector3.new(0, half + f * (height - 2 * half), 0) + downwind * (f * f * 0.25 * height)
			local colour = COLOUR.tower:Lerp(COLOUR.towerTop, f)
			for j = 0, 2 do
				local a = TAU * (j / 3 + seed + i * 0.37)
				local off = Vector3.new(math.cos(a), 0, math.sin(a)) * r * 0.38
				cloud(pool, `t{k}_{i}_{j}`, CFrame.new(c + off), Vector3.new(r * 1.35, height / levels * 1.9, r * 1.35), colour, fade(0, alpha), clock)
			end
			-- Bands round a rotating tower (striations), turning slowly.
			if k == 1 and f < 0.5 and up.striation > 0.15 then
				cloud(pool, `band{i}`, CFrame.new(c) * CFrame.Angles(0, clock * 0.05 * up.rotation, 0), Vector3.new(r * 2.15, height / levels * 0.35, r * 2.05), COLOUR.band, fade(1 - 0.7 * up.striation, alpha), clock)
			end
		end
		-- An overshooting dome over the strongest updraught.
		if k == 1 and up.overshootM > 50 then
			local dome = up.overshootM * SKY
			cloud(pool, "overshoot", CFrame.new(foot + Vector3.new(0, height, 0) + downwind * 0.25 * height), Vector3.new(R * 0.9, dome * 2, R * 0.9), COLOUR.towerTop, fade(0, alpha), clock)
		end
	end

	-- The base: dark and flat, broad as the storm's rain-free base, along a line as long as the line.
	local baseRadius = s.base.radiusKm * KM
	local baseLength = if towers > 1 then 2 * s.line.halfLengthKm * KM + baseRadius else 2 * baseRadius
	if not volumetric and not meshed then
		blob(pool, "base", CFrame.lookAt(centre, centre + axis) * CFrame.new(0, 0, 0), Vector3.new(2 * baseRadius, 120 * SKY + 0.04 * baseRadius, baseLength), COLOUR.base, fade(0, alpha))
	end

	-- The anvil spreading downwind from the top, and mammatus under a mature one.
	local anvilTop = ground + s.anvil.topM * SKY
	local length, width = s.anvil.lengthKm * KM, s.anvil.widthKm * KM
	local anvilCentre = Vector3.new(centre.X, anvilTop, centre.Z) + downwind * (length * 0.45)
	local anvilFrame = CFrame.lookAt(anvilCentre, anvilCentre + downwind)
	if not volumetric and not meshed then
		blob(pool, "anvil", anvilFrame, Vector3.new(width, 1400 * SKY, length), COLOUR.anvil, fade(0.02, alpha))
		blob(pool, "anvilRoot", CFrame.new(Vector3.new(centre.X, anvilTop, centre.Z)), Vector3.new(R * 2.6, 1800 * SKY, R * 2.6), COLOUR.anvil, fade(0, alpha))
	end
	if not volumetric and not meshed and s.anvil.mammatus > 0.2 then
		for i = 1, 6 do
			local p = anvilFrame * CFrame.new((hash(s.id .. i) - 0.5) * width * 0.5, -700 * SKY, -(0.1 + 0.5 * hash(s.id .. "m" .. i)) * length * 0.5)
			blob(pool, `mamma{i}`, p, Vector3.new(width * 0.12, 500 * SKY, width * 0.12), COLOUR.anvil:Lerp(COLOUR.base, 0.25), fade(1 - s.anvil.mammatus, alpha))
		end
	end

	-- The wall cloud, scud turning round it, and its tail cloud.
	local wall = s.wallCloud
	if wall.strength > 0.03 then
		local wr = wall.radiusKm * KM
		local lower = math.max(30, wall.loweringM * SKY)
		local wc = at(wall.xKm, wall.yKm, baseY - lower / 2)
		-- A lowering of the base, not a wall: narrowing and thinning toward its bottom, where the
		-- funnel comes out of it (drawn whole, a low wall cloud hid everything under it).
		local solid = math.clamp(wall.strength * 2.2, 0, 1)
		local top = wc + Vector3.new(0, lower / 2, 0)
		for k = 0, if volumetric or meshed then -1 else 3 do
			local a, b = k / 4, (k + 1) / 4
			local r = wr * (1 - 0.45 * (a + b) / 2)
			local thin = 0.5 * (a + b) / 2
			if PUFFED then
				cloud(pool, `wall{k}`, CFrame.new(top - Vector3.new(0, (a + b) / 2 * lower, 0)), Vector3.new(2 * r, lower / 4 * 1.6, 2 * r), COLOUR.wall, fade(1 - solid * (1 - thin), alpha), clock)
			else
				rod(pool, `wall{k}`, top - Vector3.new(0, a * lower, 0), top - Vector3.new(0, b * lower, 0), r, COLOUR.wall, fade(1 - solid * (1 - thin), alpha))
			end
		end
		local spin = clock * (0.15 + 0.6 * wall.rotation)
		-- (StormMesh's hybrid draws the scud of the storms it draws)
		local ownScud = ownMeshed and Config.STORM_MESH.style == "hybrid"
		for i = 0, if Config.SHOW_CLOUD_DETAIL and not ownScud then 5 else -1 do
			local a = spin + TAU * i / 6
			local p = wc + Vector3.new(math.cos(a), -0.3, math.sin(a)) * Vector3.new(wr, lower, wr)
			cloud(pool, `scud{i}`, CFrame.new(p), Vector3.new(wr * 0.45, lower * 0.5, wr * 0.3), COLOUR.scud, fade(1 - wall.strength, alpha), clock)
		end
		if Config.SHOW_CLOUD_DETAIL and wall.tail > 0.05 then
			local d = heading(wall.tailBearingDeg)
			local len = (2 + 5 * wall.tail) * KM
			local p = wc + d * (wr + len / 2) + Vector3.new(0, lower * 0.1, 0)
			cloud(pool, "tail", CFrame.lookAt(p, p + d), Vector3.new(0.7 * KM, lower * 0.6, len), COLOUR.scud, fade(1 - wall.tail, alpha), clock)
		end
	end

	-- Inflow bands, lying along the inflow, from where it comes toward the updraught.
	local bands = s.inflowBands
	for i = 1, if Config.SHOW_CLOUD_DETAIL and not (meshed and (kitted or Config.STORM_MESH.style == "hybrid")) then bands.count else 0 do
		local d = heading(bands.fromDeg + (i - (bands.count + 1) / 2) * 14)
		local len = bands.lengthKm * KM
		local p = centre + d * (R + len / 2) - Vector3.new(0, (baseY - ground) * 0.2, 0)
		cloud(pool, `inflow{i}`, CFrame.lookAt(p, p + d), Vector3.new(0.5 * KM, 90 * SKY, len), COLOUR.inflow, fade(1 - 0.8 * bands.strength, alpha), clock)
	end

	-- The shelf cloud along the gust front: a row along a line, an arc ahead of a cell.
	local shelf = s.shelf
	if Config.SHOW_CLOUD_DETAIL and shelf.strength > 0.05 and not meshed then
		local facing = heading(shelf.facingDeg)
		local lead = (s.gustFront.radiusKm * 0.6 + s.gustFront.leadKm + 2 * shelf.detached) * KM
		local tiers = math.max(1, shelf.tiers)
		local segments = 9
		local shelfY = ground + shelf.heightM * SKY - shelf.detached * 150 * SKY
		for i = 1, segments do
			local f = (i - 0.5) / segments - 0.5
			local p, d
			if shelf.halfArcDeg <= 0 then
				p = centre + facing * lead + axis * (f * 2 * math.max(s.line.halfLengthKm, 8) * KM)
				d = facing
			else
				d = heading(shelf.facingDeg + f * 2 * shelf.halfArcDeg)
				p = centre + d * (R + lead)
			end
			local segLength = if shelf.halfArcDeg <= 0 then 2 * math.max(s.line.halfLengthKm, 8) * KM / segments else (R + lead) * math.rad(2 * shelf.halfArcDeg) / segments
			for k = 1, tiers do
				local tierDrop = (k - 1) * 0.22 * (baseY - ground)
				local q = Vector3.new(p.X, shelfY - tierDrop, p.Z) + d * ((k - 1) * 0.6 * KM)
				cloud(pool, `shelf{i}_{k}`, CFrame.lookAt(q, q + d), Vector3.new(segLength * 1.4, 160 * SKY * shelf.strength + 40, 1.4 * KM), COLOUR.shelf, fade(1 - shelf.strength, alpha), clock)
			end
		end
	end

	-- Rain and hail as streaked curtains from the base to the ground, along the rain's length (each
	-- as wide as the rain there); rain wrapping round the rotation. Seeing in the rain is
	-- SkyLight's haze.
	local rain = s.rain
	-- (the storms StormMesh draws have its rain shafts instead)
	if not Config.SHOW_PRECIPITATION or (ownMeshed and Config.STORM_MESH.style == "hybrid") then
		return
	end
	if rain.intensity > 0.03 then
		local along = heading(rain.bearingDeg)
		local across = Vector3.new(-along.Z, 0, along.X)
		local count = math.clamp(math.round(rain.alongKm / 2.5), 2, 10)
		for i = 1, count do
			local f = (i - 0.5) / count - 0.5
			local jitter = (hash(s.id .. "r" .. i) - 0.5) * rain.acrossKm * KM * 0.4
			local p = at(rain.xKm, rain.yKm, ground) + along * (f * rain.alongKm * KM) + across * jitter
			local wide = rain.acrossKm * KM * (0.5 + 0.6 * math.sqrt(math.max(0, 1 - (2 * f) ^ 2)))
			curtain(pool, `rain{i}`, p, baseY, wide, COLOUR.rain, fade(1 - (0.4 + 0.5 * rain.intensity), alpha))
		end
	end
	if s.hail.radiusKm > 0.2 then
		local hailT = fade(1 - (0.3 + 0.4 * math.clamp(s.hail.sizeInches / 2.5, 0, 1)), alpha)
		for i = 1, 2 do
			local o = (i - 1.5) * s.hail.radiusKm * KM * 0.8
			curtain(pool, `hail{i}`, at(s.hail.xKm, s.hail.yKm, ground) + Vector3.new(o, 0, -o * 0.5), baseY, 1.6 * s.hail.radiusKm * KM, COLOUR.hail, hailT)
		end
	end
	if rain.wrap > 0.1 and wall.strength > 0.03 then
		local wc = at(wall.xKm, wall.yKm, ground)
		local wr = (wall.radiusKm + 1.5) * KM
		local arc = 0.4 + 1.2 * rain.wrap -- radians each side of the rear
		local back = -heading(s.shelf.facingDeg)
		local base = math.atan2(back.Z, back.X)
		for i = 0, 5 do
			local a = base + (i / 5 - 0.5) * 2 * arc
			local p = wc + Vector3.new(math.cos(a), 0, math.sin(a)) * wr
			curtain(pool, `wrap{i}`, p, baseY, 1.6 * KM, COLOUR.rain, fade(1 - (0.3 + 0.5 * rain.wrap), alpha))
		end
	end
end

-- A tornado ---------------------------------------------------------------------------------

local SEGMENTS = 18

-- The funnel's radius (studs) at a share of the height to the base, from the profile.
local function radiusAt(t: any, f: number): number
	local radii = t.funnelRadiusM
	local n = #radii
	local x = math.clamp(f, 0, 1) * (n - 1) + 1
	local i = math.clamp(math.floor(x), 1, n - 1)
	local a, b = radii[i], radii[i + 1]
	if a <= 0 or b <= 0 then
		return if (x - i) < 0.5 then a * TOR else b * TOR
	end
	return (a + (b - a) * (x - i)) * TOR
end

local SPRITE_BEYOND = Config.TORNADO_ART.spriteBeyondStuds

local function drawTornado(pool: Pool, s: any, clock: number, cameraPos: Vector3)
	local t = s.tornado
	local touch = math.clamp(t.touch or 1, 0, 1)
	local ground = t.groundStuds or s.groundStuds or 0
	local foot = at(t.xKm, t.yKm, ground)
	-- Near the camera, stand it on the ground actually loaded here.
	if (foot - cameraPos).Magnitude < 4000 then
		local hit = workspace:Raycast(foot + Vector3.new(0, 2000, 0), Vector3.new(0, -4000, 0))
		if hit and hit.Instance:IsA("Terrain") then
			foot = Vector3.new(foot.X, hit.Position.Y, foot.Z)
		end
	end
	local height = t.baseM * SKY
	local top = Vector3.new(t.tiltEastM, 0, -t.tiltNorthM) / 1000 * KM
	local wrapped = math.clamp(t.rainWrap or 0, 0, 1)
	-- White with the sun behind the viewer; with it behind, glowing if thin, dark if thick; grey
	-- with no direct sun (TornadoArt).
	local angle, direct = TornadoArt.sunAngle(foot, cameraPos), SkyLight.direct()
	local back = TornadoArt.backlight(angle, direct)
	local colour = TornadoArt.colour(angle, direct, wrapped, radiusAt(t, 0.5) / TOR)
	local seed = hash(t.id)
	-- The funnel's axis at a share of the height: leaning toward its top, twisting as it decays.
	local function axis(f: number): Vector3
		local wiggle = t.contortion * math.sin(f * math.pi * 2.5 + clock * 0.35 + seed * 10) * 0.12 * height * math.sin(f * math.pi)
		local side = Vector3.new(top.Z, 0, -top.X).Unit
		if side ~= side then
			side = Vector3.xAxis
		end
		return foot + top * f + Vector3.new(0, f * height, 0) + side * wiggle
	end
	-- What is shown: lowering from the cloud while it touches down (or lifting as it ends).
	local lowest = 1 - touch
	local condensed = math.clamp(t.condensedM / math.max(1, t.baseM), 0, 1)
	local hollow = math.clamp(0.25 * t.twoCell + (if t.vortices > 1 then 0.25 else 0), 0, 0.6)
	-- Far off, a sprite of a rendered tornado; nearer, the funnel as meshes; parts if neither art
	-- is there. The visible surface turns at a share of the wind over the core (slowed to read).
	local distance = (foot - cameraPos).Magnitude
	local ratio = 2 * radiusAt(t, 0.5 * (1 + math.max(lowest, condensed))) / math.max(1, height * (1 - math.max(lowest, condensed)))
	local spin = math.clamp(0.25 * t.windMph * 0.447 / math.max(20, t.coreRadiusM), 0.3, 2.5)
	-- Where the funnel flares into the wall cloud it is drawn no further: the profile widens to
	-- the wall cloud's width there, and drawn as funnel that is a lid hiding everything under it
	-- (the wall cloud covers the join).
	local bottom = math.max(lowest, condensed)
	local flareLimit = 2.5 * math.max(radiusAt(t, 0.5 * (1 + bottom)), t.coreRadiusM * TOR)
	local top = 1
	for k = SEGMENTS, 1, -1 do
		if radiusAt(t, k / SEGMENTS) <= flareLimit then
			top = k / SEGMENTS
			break
		end
	end
	-- The baked volume tornado first (any distance); then the sprite far off; then the meshes.
	local bakedDrawn = TornadoArt.drawBaked(t.id, pool.model, foot, height, ratio, back, touch, wrapped, cameraPos, clock, spin)
	local drawn = bakedDrawn
		or distance > SPRITE_BEYOND and TornadoArt.drawSprite(t.id, pool.model, axis(math.max(lowest, condensed)), height * (1 - math.max(lowest, condensed)), ratio, back, touch, wrapped, cameraPos, clock)
	if not drawn then
		drawn = TornadoArt.drawFunnel(t.id, pool.model, axis, function(f)
			return math.max(2, radiusAt(t, f))
		end, bottom, math.max(top, bottom + 0.05), clock, spin, colour, 1 - touch ^ 0.5 + hollow * 0.5, distance < 3000, cameraPos)
	end
	for i = 0, if drawn then -1 else SEGMENTS - 1 do
		local f0, f1 = i / SEGMENTS, (i + 1) / SEGMENTS
		local fm = (f0 + f1) / 2
		local r = radiusAt(t, fm)
		if f1 > lowest and r > 0 and fm >= condensed and f0 < top then
			local transparency = (if fm < 0.35 then hollow else 0) + 0.06
			rod(pool, `funnel{i}`, axis(math.max(f0, lowest)), axis(f1), math.max(2, r), colour, fade(transparency, touch ^ 0.5))
		end
	end
	-- The uncondensed vortex below the funnel: a faint whirl of dust and air.
	if not bakedDrawn and condensed > 0.02 and touch > 0.3 then
		rod(pool, "vortex", axis(0), axis(condensed), math.max(3, t.coreRadiusM * TOR), COLOUR.dust, fade(0.88, touch))
	end
	-- Smaller vortices turning round the core.
	if not bakedDrawn and t.vortices > 1 then
		local orbit = math.max(6, t.coreRadiusM * TOR * 0.85)
		local spin = clock * math.clamp(0.5 * t.windMph * 0.447 / math.max(10, t.coreRadiusM), 0.4, 3)
		local subR = math.max(3, t.subvortexRadiusM * TOR)
		local reach = math.clamp(0.45 + 0.3 * condensed, 0.3, 0.75)
		for k = 1, t.vortices do
			local a = spin + TAU * k / t.vortices
			local off = Vector3.new(math.cos(a), 0, math.sin(a)) * orbit
			for j = 0, 3 do
				local f0, f1 = reach * j / 4, reach * (j + 1) / 4
				rod(pool, `sub{k}_{j}`, axis(f0) + off, axis(f1) + off * (1 - f1 / reach * 0.5), subR * (1 + j * 0.6), colour, fade(0.15, touch))
			end
		end
	end
	-- The debris cloud and debris thrown round the base.
	local debris = t.debris
	local dr = math.max(8, debris.radiusM * TOR)
	local dh = math.max(10, debris.heightM * TOR)
	local dpart, demit = emitter(pool, "debrisCloud")
	dpart.Size = Vector3.new(math.min(dh, MAX_PART), math.min(2 * dr, MAX_PART), math.min(2 * dr, MAX_PART))
	dpart.CFrame = CFrame.new(foot + Vector3.new(0, dh / 2, 0)) * CFrame.Angles(0, 0, math.pi / 2)
	demit.Enabled = touch > 0.5 and debris.strength > 0.02
	-- Dust lit like the funnel: pale with the sun behind the viewer, dark against it.
	local dustColour = COLOUR.dust:Lerp(COLOUR.debris, 1 - debris.dust)
	demit.Color = ColorSequence.new(dustColour:Lerp(Color3.new(0.2, 0.19, 0.18), back * 0.6))
	if TornadoArt.styleDebris(demit) then
		-- The puff grows within its frames: a steady size, fading only at the end of its life.
		demit.Size = NumberSequence.new(math.clamp(dr * 0.7, 12, 160))
		demit.Transparency = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0.1), NumberSequenceKeypoint.new(0.8, 0.2), NumberSequenceKeypoint.new(1, 1) })
	else
		demit.Size = NumberSequence.new({ NumberSequenceKeypoint.new(0, math.clamp(dr * 0.25, 6, 60)), NumberSequenceKeypoint.new(1, math.clamp(dr * 0.6, 12, 100)) })
		demit.Transparency = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0.35), NumberSequenceKeypoint.new(1, 1) })
	end
	demit.Lifetime = NumberRange.new(2, 4)
	demit.Rate = 25 + 80 * debris.strength
	demit.Speed = NumberRange.new(10, 30 + 80 * debris.strength)
	demit.Acceleration = Vector3.new(0, 6 + 20 * debris.strength, 0)
	local whirl = clock * math.clamp(t.windMph * 0.447 / math.max(15, t.coreRadiusM), 0.5, 4)
	for i = 1, 14 do
		local life = (clock * 0.4 + hash(t.id .. i)) % 1
		local a = whirl * (0.6 + 0.4 * hash(t.id .. "s" .. i)) + TAU * i / 14
		local r = dr * (0.4 + 0.6 * hash(t.id .. "r" .. i))
		local p = foot + Vector3.new(math.cos(a) * r, life * dh * 2, math.sin(a) * r)
		blob(pool, `chunk{i}`, CFrame.new(p) * CFrame.Angles(a, a * 1.3, 0), Vector3.new(3, 1.2, 4) * (1 + 3 * hash(t.id .. "z" .. i)), COLOUR.debris, if touch > 0.5 and debris.strength > 0.05 then 0 else 1)
	end
end

-- A funnel lowering from the wall cloud before a tornado.
local function drawFunnelAloft(pool: Pool, s: any)
	local f = s.funnelAloft
	local ground = s.groundStuds or 0
	local baseY = ground + (s.updraft.baseM - s.wallCloud.loweringM) * SKY
	local length = f.lengthShare * (s.updraft.baseM - s.wallCloud.loweringM) * SKY
	local p = at(f.xKm, f.yKm, baseY)
	for i = 0, 5 do
		local a, b = i / 6, (i + 1) / 6
		rod(pool, `aloft{i}`, p - Vector3.new(0, a * length, 0), p - Vector3.new(0, b * length, 0), f.radiusM * TOR * (1 - 0.8 * (a + b) / 2), COLOUR.funnel, fade(0.1, s.alpha or 1))
	end
end

-- Weather at the camera --------------------------------------------------------------------

-- Rain at the camera: rings of streaked rain sheets round it, thicker the heavier the rain; cheap,
-- and streaks rather than particles. rate: the old emitter's rate (400 x intensity).
-- Each sheet is a thin invisible part turned to face the camera, the near-rain texture on its
-- face (Texture: StudsPerTile sets the streaks' size), scrolled down at the drops' fall speed.
-- (Beams round the camera did not draw at all in Studio 0.744; textured parts do.)
local RAIN_RINGS = {
	{ radius = 16, count = 6, height = 60, tileW = 8, tileH = 32, fall = 22 },
	{ radius = 50, count = 6, height = 120, tileW = 20, tileH = 80, fall = 14 },
}
local sheets: { { part: BasePart, tex: Texture, ring: number, angle: number } } = {}
local sheetFolder: Folder? = nil
local sheetKey = -2
local rainScroll = 0
local function cameraRain(rate: number, cameraPos: Vector3, dt: number?)
	local heavy = math.clamp(rate / 400, 0, 1)
	if not sheetFolder then
		local folder = Instance.new("Folder")
		folder.Name = "CameraRain"
		folder.Parent = root
		sheetFolder = folder
		for r, ring in RAIN_RINGS do
			local width = 2 * math.pi * ring.radius / ring.count * 1.6 -- (overlapping: the texture fades at its sides)
			for i = 1, ring.count do
				local part = Instance.new("Part")
				part.Anchored, part.CanCollide, part.CanQuery, part.CanTouch = true, false, false, false
				part.CastShadow = false
				part.Transparency = 1
				part.Size = Vector3.new(width, ring.height, 0.05)
				local tex = Instance.new("Texture")
				tex.Face = Enum.NormalId.Front
				tex.Texture = if CLOUD.nearRain ~= "" then CLOUD.nearRain else CLOUD.rain
				tex.StudsPerTileU, tex.StudsPerTileV = ring.tileW, ring.tileH
				tex.Color3 = Color3.fromRGB(150, 156, 164) -- (grey: lit by the storm's dim light, not white)
				tex.Parent = part
				part.Parent = folder
				table.insert(sheets, { part = part, tex = tex, ring = r, angle = (i - 1) / ring.count * TAU + r * 0.4 })
			end
		end
	end
	-- (faint: rain is mostly seen as streaks catching the light and as murk in the distance, which
	-- SkyLight's haze already does; strong sheets read as a screen overlay)
	local a = math.clamp(0.05 + heavy * 0.22, 0, 0.27)
	local on = heavy > 0.02
	local key = if on then math.floor(a * 20 + 0.5) else -1
	local restyle = key ~= sheetKey
	sheetKey = key
	rainScroll += dt or 0
	for _, sh in sheets do
		local ring = RAIN_RINGS[sh.ring]
		if restyle then
			sh.tex.Transparency = if on then 1 - a else 1
		end
		if on then
			-- round the camera, its bottom a little under the eye, facing the camera
			local p = cameraPos + Vector3.new(math.cos(sh.angle) * ring.radius, ring.height / 2 - 8, math.sin(sh.angle) * ring.radius)
			local toCam = Vector3.new(cameraPos.X - p.X, 0, cameraPos.Z - p.Z)
			sh.part.CFrame = CFrame.lookAt(p, p + toCam)
			-- (a growing V offset moves the texture up the face: rain falls with a shrinking one)
			sh.tex.OffsetStudsV = (-rainScroll * ring.fall) % ring.tileH
		end
	end
end

-- Hail and splashes at the camera (particles of small sprites, not smoke): hail where the
-- camera is in a storm's hail (size from hail.sizeInches, drawn a few times life size so a stone
-- reads on screen), some bouncing off the ground; splashes on the ground round the camera, as many
-- as the rain rate says. The ground's height comes from a ray down, twice a second.
local ground: { part: BasePart?, sky: BasePart?, hail: ParticleEmitter?, bounce: ParticleEmitter?, splash: ParticleEmitter?, y: number, at: number } = { y = 0, at = -1 }
local function groundFx(rate: number, hailIn: number, hailShare: number, cameraPos: Vector3, clock: number)
	if not ground.part then
		local p = Instance.new("Part")
		p.Anchored, p.CanCollide, p.CanQuery, p.CanTouch, p.Transparency = true, false, false, false, 1
		p.Size = Vector3.new(90, 1, 90)
		local function emitter(texture: string): ParticleEmitter
			local e = Instance.new("ParticleEmitter")
			e.Texture = texture
			e.Rate = 0
			e.LightInfluence = 1
			e.Rotation = NumberRange.new(-180, 180)
			e.Parent = p
			return e
		end
		local sky = p:Clone() -- the hail falls from a part high over the camera
		local hail = emitter(CLOUD.hailstone)
		hail.Parent = sky
		hail.EmissionDirection = Enum.NormalId.Bottom
		hail.Lifetime = NumberRange.new(2.2, 2.6)
		hail.RotSpeed = NumberRange.new(-200, 200)
		local bounce = emitter(CLOUD.hailstone)
		bounce.EmissionDirection = Enum.NormalId.Top
		bounce.Speed = NumberRange.new(6, 14)
		bounce.SpreadAngle = Vector2.new(50, 50)
		bounce.Acceleration = Vector3.new(0, -60, 0)
		bounce.Lifetime = NumberRange.new(0.25, 0.5)
		bounce.RotSpeed = NumberRange.new(-400, 400)
		local splash = emitter(CLOUD.splash)
		splash.Speed = NumberRange.new(0)
		splash.Lifetime = NumberRange.new(0.12, 0.22)
		splash.Size = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0.3), NumberSequenceKeypoint.new(1, 0.7) })
		splash.Transparency = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0.55), NumberSequenceKeypoint.new(1, 1) })
		splash.Color = ColorSequence.new(Color3.fromRGB(205, 212, 222))
		splash.Orientation = Enum.ParticleOrientation.FacingCameraWorldUp
		p.Parent = root
		sky.Parent = root
		ground.sky = sky
		ground.part, ground.hail, ground.bounce, ground.splash = p, hail, bounce, splash
	end
	-- the ground under the camera
	if clock - ground.at > 0.5 then
		ground.at = clock
		local params = RaycastParams.new()
		params.FilterDescendantsInstances = { root }
		params.FilterType = Enum.RaycastFilterType.Exclude
		local hit = workspace:Raycast(cameraPos, Vector3.new(0, -2000, 0), params)
		ground.y = if hit then hit.Position.Y else cameraPos.Y - 6
	end
	local heavy = math.clamp(rate / 400, 0, 1)
	local hailing = hailIn > 0.05 and hailShare > 0.02
	-- stones: a few times life size (1 in = 2.5 cm), falling at their fall speed (~9 sqrt(d cm) m/s)
	local size = 0.06 + 0.09 * hailIn
	local fall = 9 * math.sqrt(math.max(hailIn, 0.1) * 2.54)
	local hail, bounce, splash = ground.hail :: ParticleEmitter, ground.bounce :: ParticleEmitter, ground.splash :: ParticleEmitter
	hail.Enabled = hailing
	bounce.Enabled = hailing
	if hailing then
		hail.Rate = 110 * hailShare * math.clamp(1.5 - hailIn * 0.4, 0.4, 1.2) -- (big hail is sparse)
		hail.Size = NumberSequence.new(size)
		hail.Speed = NumberRange.new(fall * 0.9, fall * 1.1)
		bounce.Rate = 30 * hailShare
		bounce.Size = NumberSequence.new(size)
	end
	splash.Enabled = heavy > 0.02
	splash.Rate = 300 * heavy
	-- the hail's part high over the camera; the splashes' (and bounces') on the ground
	ground.part.CFrame = CFrame.new(cameraPos.X, ground.y + 0.3, cameraPos.Z)
	local top = cameraPos.Y + 40
	;(ground.sky :: BasePart).CFrame = CFrame.new(cameraPos.X, top, cameraPos.Z)
	hail.Lifetime = NumberRange.new((top - ground.y) / fall)
end

-- Inside an ellipse of half-lengths (along, across) on a bearing, centred at (xKm, yKm)?
local function inside(xKm: number, yKm: number, alongKm: number, acrossKm: number, bearingDeg: number, px: number, py: number): number
	local d = heading(bearingDeg)
	local dx, dy = px - xKm, -(py - yKm)
	local along = dx * d.X + dy * -d.Z
	local across = dx * -d.Z - dy * d.X
	return (along / math.max(0.1, alongKm)) ^ 2 + (across / math.max(0.1, acrossKm)) ^ 2
end

-- Running ----------------------------------------------------------------------------------

-- The storms as last sampled (all of them, not only those in view), for the debug page.
local latest: { any } = {}
-- Timings (ms a frame, smoothed): the whole renderer, and SkyLight's share.
StormView.stats = { totalMs = 0, skyMs = 0, oldParts = 0 }
local renderStep: (number) -> ()
local lastMeshed: { [string]: boolean } = {}
function StormView.storms(): { any }
	return latest
end

-- On / off (the lab's storm mode): off, nothing is drawn or lit.
local running = true
function StormView.setRunning(on: boolean)
	running = on
	root.Parent = if on then workspace else nil
end

-- The frames come from the game server's Weather remotes, or (the lab) from `feed`: a track the
-- caller fills and the weather clock to show it at.
export type Feed = { track: StormTrack.Track, nowMs: () -> number }
function StormView.start(feed: Feed?)
	local weather: Instance? = nil
	local track: StormTrack.Track
	if feed then
		track = feed.track
	else
		local remotes = ReplicatedStorage:WaitForChild("Weather")
		weather = remotes
		track = StormTrack.new()
		local framesEvent = remotes:WaitForChild("Frames") :: RemoteEvent
		framesEvent.OnClientEvent:Connect(function(packet: any)
			track:add(packet.frames, packet.reset, packet.epoch)
		end)
		task.spawn(function()
			local packet = (remotes:WaitForChild("Sync") :: RemoteFunction):InvokeServer()
			track:add(packet.frames, true, packet.epoch)
		end)
	end
	root.Parent = workspace

	local pools: { [string]: Pool } = {}
	local bolts: { { parts: { BasePart }, untilClock: number } } = {}
	local clock = 0
	RunService.RenderStepped:Connect(function(dt: number)
		local t0 = os.clock()
		renderStep(dt)
		local st = StormView.stats
		st.totalMs += ((os.clock() - t0) * 1000 - st.totalMs) * 0.1
	end)
	function renderStep(dt: number)
		clock += dt
		local camera = workspace.CurrentCamera
		if not camera or not running then
			return
		end
		local cameraPos = camera.CFrame.Position
		camRight, camUp, camPos = camera.CFrame.RightVector, camera.CFrame.UpVector, cameraPos
		local nowMs = if feed
			then feed.nowMs()
			else workspace:GetServerTimeNow() * 1000 + (((weather :: Instance):GetAttribute("ClockOffsetMs") :: number?) or 0)
		local storms, hourUtc = track:sample(nowMs)
		latest = storms
		local px, py = (cameraPos.X + HALF_X) / KM, (cameraPos.Z + HALF_Z) / KM
		local alive: { [string]: boolean } = {}
		local oldMs = 0
		local rainRate = 0
		local hailShare, hailIn = 0, 0
		local rainHereDbz = 0
		-- The nearest storms (tornadic ones count as nearer) drawn as lit volumes (CloudVolume).
		local near = {}
		for _, s in storms do
			local c = at(s.xKm, s.yKm, cameraPos.Y)
			local d = (Vector3.new(c.X, 0, c.Z) - Vector3.new(cameraPos.X, 0, cameraPos.Z)).Magnitude * (if s.tornado then 0.5 else 1)
			if d < Config.VOLUME_CLOUDS.maxMiles * Config.STUDS_PER_MILE then
				table.insert(near, { s = s, d = d })
			end
		end
		table.sort(near, function(a, b)
			return a.d < b.d
		end)
		local volumeStorms = {}
		for i = 1, math.min(#near, Config.VOLUME_CLOUDS.storms) do
			volumeStorms[i] = near[i].s
		end
		local volumetric = CloudVolume.update(volumeStorms, root, camera, clock)
		-- the storms that matter most as shells (StormMesh): near, in view (a storm behind the
		-- camera counts as three times as far), tornadic ones counting as nearer
		local meshed: { [string]: boolean } = {}
		if Config.STORM_MESH.enabled then
			local look = camera.CFrame.LookVector
			local ranked = {}
			for _, s in storms do
				local c = at(s.xKm, s.yKm, cameraPos.Y)
				local flat = Vector3.new(c.X - cameraPos.X, 0, c.Z - cameraPos.Z)
				local d = flat.Magnitude
				local ahead = if d > 1 then flat.Unit:Dot(Vector3.new(look.X, 0, look.Z).Unit) else 1
				local score = d * (if ahead > 0.3 then 1 else 3) * (if s.tornado then 0.5 else 1)
				-- (hysteresis: a storm already drawn in detail keeps it until another is clearly
				-- nearer; swapping costs a full rebuild, a hitch, and a visible jump in detail)
				if lastMeshed[s.id] then
					score *= 0.6
				end
				if d < VIEW then
					table.insert(ranked, { id = s.id, score = score })
				end
			end
			table.sort(ranked, function(a, b)
				return a.score < b.score
			end)
			for i = 1, math.min(#ranked, Config.STORM_MESH.storms) do
				meshed[ranked[i].id] = true
			end
			lastMeshed = meshed
		end
		for _, s in storms do
			local centre = at(s.xKm, s.yKm, cameraPos.Y)
			local distance = (Vector3.new(centre.X, 0, centre.Z) - Vector3.new(cameraPos.X, 0, cameraPos.Z)).Magnitude
			if distance > VIEW then
				continue
			end
			alive[s.id] = true
			local pool = pools[s.id]
			if not pool then
				pool = newPool(s.id)
				pools[s.id] = pool
			end
			-- The clouds of a distant storm (its hundreds of puffs) are redrawn a few times a second,
			-- staggered, not every frame: 0.25 s of a storm's motion is a few metres, unseen from
			-- kilometres away (every frame, they cost ~70 ms a frame). Near storms every frame.
			local tOld = os.clock()
			local OLD = Config.STORM_OLD_CLOUDS
			-- (and at once when the view turns: the puffs are cards laid along the camera's right)
			local look = camera.CFrame.LookVector
			if distance < OLD.everyFrameMiles * Config.STUDS_PER_MILE or not pool.nextAt or clock >= pool.nextAt
				or not pool.look or pool.look:Dot(look) < 0.985 then
				pool.look = look
				drawClouds(pool, s, clock, volumetric[s.id] == true, meshed[s.id] == true, Config.STORM_KIT.enabled)
				pool.cloudKeys = table.clone(pool.used)
				pool.nextAt = clock + OLD.intervalSeconds * (0.75 + 0.5 * math.random())
			elseif pool.cloudKeys then
				for key in pool.cloudKeys do
					pool.used[key] = true
				end
			end
			oldMs += (os.clock() - tOld) * 1000
			if Config.STORM_KIT.enabled then
				StormKit.draw(s, { at = at, heading = heading, km = KM, sky = SKY, camPos = cameraPos, clock = clock, parent = root })
			end
			if meshed[s.id] then
				StormMesh.draw(s, { at = at, heading = heading, km = KM, sky = SKY, camPos = cameraPos, clock = clock, dt = dt, parent = root })
			end
			if s.tornado then
				drawTornado(pool, s, clock, cameraPos)
			elseif s.funnelAloft then
				drawFunnelAloft(pool, s)
			end
			finish(pool)
			-- In the rain it rains.
			local r = s.rain
			if s.precip then
				-- the radar's own rain and hail under the camera: rain rate from dBZ (Z = 300 R^1.4;
				-- 100 mm/h is a downpour, the rings' full rate), hail size from MESH
				local dbz, hailHere = Precip.at(s.precip, px, py)
				local mmh = Precip.rainRate(dbz)
				rainRate = math.max(rainRate, 400 * math.clamp(mmh / 100, 0, 1) ^ 0.6 * (s.alpha or 1))
				if hailHere > 0.05 and hailHere > hailIn then
					hailIn, hailShare = hailHere, math.clamp((dbz - 45) / 20, 0.15, 1) * (s.alpha or 1)
				end
				rainHereDbz = math.max(rainHereDbz, dbz)
			elseif inside(r.xKm, r.yKm, r.alongKm / 2, r.acrossKm / 2, r.bearingDeg, px, py) < 1 then
				rainRate = math.max(rainRate, 400 * r.intensity * (s.alpha or 1))
			end
			local h = s.hail
			if not s.precip and h.radiusKm > 0.1 and h.sizeInches > 0 then
				local d2 = ((px - h.xKm) ^ 2 + (py - h.yKm) ^ 2) / (h.radiusKm * h.radiusKm)
				if d2 < 1 then
					local share = (1 - d2) * (s.alpha or 1)
					if share > hailShare then
						hailShare, hailIn = share, h.sizeInches
					end
				end
			end
			-- Lightning, at the rate the storm gives, from the base to the ground near the rain.
			if math.random() < (s.lightningPerMin or 0) / 60 * dt * 0.25 and distance < VIEW * 0.6 then
				local ground = s.groundStuds or 0
				local strike = at(r.xKm, r.yKm, ground) + Vector3.new((math.random() - 0.5) * r.acrossKm * KM, 0, (math.random() - 0.5) * r.alongKm * KM)
				local from = strike + Vector3.new(0, s.updraft.baseM * SKY, 0)
				local parts = {}
				local last = from
				for i = 1, 7 do
					local f = i / 7
					local nextPoint = from:Lerp(strike, f) + if i < 7 then Vector3.new((math.random() - 0.5) * 300, 0, (math.random() - 0.5) * 300) else Vector3.zero
					local p = Instance.new("Part")
					p.Anchored, p.CanCollide, p.CanQuery, p.CanTouch, p.CastShadow = true, false, false, false, false
					p.Material = Enum.Material.Neon
					p.Color = COLOUR.bolt
					p.Size = Vector3.new(6, 6, (nextPoint - last).Magnitude)
					p.CFrame = CFrame.lookAt((last + nextPoint) / 2, nextPoint)
					p.Parent = root
					table.insert(parts, p)
					last = nextPoint
				end
				table.insert(bolts, { parts = parts, untilClock = clock + 0.18 })
				SkyLight.flash((strike - cameraPos).Magnitude)
			end
		end
		local aliveTornadoes: { [string]: boolean } = {}
		for _, s in storms do
			if s.tornado then
				aliveTornadoes[s.tornado.id] = true
			end
		end
		StormMesh.sweep(meshed)
		StormKit.sweep(alive)
		TornadoArt.sweep(aliveTornadoes)
		TornadoArt.sweepSprites()
		for id, pool in pools do
			if not alive[id] then
				pool.model:Destroy()
				pools[id] = nil
			end
		end
		for i = #bolts, 1, -1 do
			if clock >= bolts[i].untilClock then
				for _, p in bolts[i].parts do
					p:Destroy()
				end
				table.remove(bolts, i)
			end
		end
		StormView.stats.dbzHere, StormView.stats.hailHere, StormView.stats.rainRate = rainHereDbz, hailIn, rainRate
		StormView.stats.oldMs = (StormView.stats.oldMs or 0) + (oldMs - (StormView.stats.oldMs or 0)) * 0.1
		local tSky = os.clock()
		SkyLight.update(storms, hourUtc, track:skyAt(nowMs, px, py), cameraPos, dt)
		StormView.stats.skyMs += ((os.clock() - tSky) * 1000 - StormView.stats.skyMs) * 0.1
		-- For looking at the art: with the Workspace attribute WatchTornado set, the camera looks
		-- from where it is at the nearest tornado's funnel.
		if workspace:GetAttribute("WatchTornado") == true then
			local best, bestD = nil, math.huge
			for _, s in storms do
				if s.tornado then
					local t = s.tornado
					local p = at(t.xKm, t.yKm, (t.groundStuds or 0) + t.baseM * SKY * 0.45)
					local d = (p - cameraPos).Magnitude
					if d < bestD then
						best, bestD = p, d
					end
				end
			end
			if best then
				camera.CameraType = Enum.CameraType.Scriptable
				camera.CFrame = CFrame.lookAt(cameraPos, best)
				watching = true
			end
		end
		-- (back to following the character once the attribute is off or no tornado is left: left
		-- Scriptable, the camera froze facing away and the character seemed never to load)
		if watching and not (workspace:GetAttribute("WatchTornado") == true and camera.CameraType == Enum.CameraType.Scriptable and #storms > 0) then
			local anyTornado = false
			for _, s in storms do
				if s.tornado then
					anyTornado = true
					break
				end
			end
			if workspace:GetAttribute("WatchTornado") ~= true or not anyTornado then
				camera.CameraType = Enum.CameraType.Custom
				watching = false
			end
		end
		-- (Workspace attribute ForceRain = 0-1: rain at the camera whatever the storms, for looking at it)
		local forced = workspace:GetAttribute("ForceRain")
		local rate = if typeof(forced) == "number" then 400 * forced else rainRate
		cameraRain(rate, cameraPos, dt)
		-- (Workspace attribute ForceHail = inches: hail at the camera whatever the storms)
		local forcedHail = workspace:GetAttribute("ForceHail")
		if typeof(forcedHail) == "number" then
			hailIn, hailShare = forcedHail, 0.8
		end
		groundFx(rate, hailIn, hailShare, cameraPos, clock)
	end
end

return StormView
