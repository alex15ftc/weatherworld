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
-- Also lightning, the light dimming under a storm, and rain where the camera is.

local Lighting = game:GetService("Lighting")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local Config = require(ReplicatedStorage.Shared.World.Config)
local StormTrack = require(ReplicatedStorage.Shared.Weather.StormTrack)

local StormView = {}

local KM = Config.STUDS_PER_MILE / Config.KM_PER_MILE -- studs a km, across
local SKY = Config.SKY_STUDS_PER_METRE -- studs a metre, up (clouds)
local TOR = Config.TORNADO_STUDS_PER_METRE -- studs a metre, across a tornado
local HALF = Config.MAP_MILES / 2 * Config.STUDS_PER_MILE
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
	return Vector3.new(xKm * KM - HALF, y, yKm * KM - HALF)
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

type Pool = { model: Model, parts: { [string]: BasePart }, used: { [string]: boolean } }

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
		end
	end
	table.clear(pool.used)
end

local function fade(t: number, alpha: number): number
	return 1 - (1 - t) * math.clamp(alpha, 0, 1)
end

-- A storm's clouds --------------------------------------------------------------------------

local function drawClouds(pool: Pool, s: any, clock: number)
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
	for k = 1, towers do
		local along = if towers > 1 then ((k - 0.5) / towers - 0.5) * 2 * s.line.halfLengthKm * KM else 0
		local scale = if towers > 1 then 0.75 + 0.25 * math.sin(k * 2.3 + seed * 9) else 1
		local foot = centre + axis * along
		local height = (topY - baseY) * scale
		for i = 0, levels - 1 do
			local f = i / (levels - 1)
			local r = R * scale * (0.95 - 0.35 * f * f)
			-- Leaning a little downwind with height, the way the wind aloft takes it.
			local c = foot + Vector3.new(0, f * height, 0) + downwind * (f * f * 0.25 * height)
			local colour = COLOUR.tower:Lerp(COLOUR.towerTop, f)
			for j = 0, 2 do
				local a = TAU * (j / 3 + seed + i * 0.37)
				local off = Vector3.new(math.cos(a), 0, math.sin(a)) * r * 0.38
				blob(pool, `t{k}_{i}_{j}`, CFrame.new(c + off), Vector3.new(r * 1.35, height / levels * 1.9, r * 1.35), colour, fade(0, alpha))
			end
			-- Bands round a rotating tower (striations), turning slowly.
			if k == 1 and f < 0.5 and up.striation > 0.15 then
				blob(pool, `band{i}`, CFrame.new(c) * CFrame.Angles(0, clock * 0.05 * up.rotation, 0), Vector3.new(r * 2.15, height / levels * 0.35, r * 2.05), COLOUR.band, fade(1 - 0.7 * up.striation, alpha))
			end
		end
		-- An overshooting dome over the strongest updraught.
		if k == 1 and up.overshootM > 50 then
			local dome = up.overshootM * SKY
			blob(pool, "overshoot", CFrame.new(foot + Vector3.new(0, height, 0) + downwind * 0.25 * height), Vector3.new(R * 0.9, dome * 2, R * 0.9), COLOUR.towerTop, fade(0, alpha))
		end
	end

	-- The base: dark and flat, broad as the storm's rain-free base, along a line as long as the line.
	local baseRadius = s.base.radiusKm * KM
	local baseLength = if towers > 1 then 2 * s.line.halfLengthKm * KM + baseRadius else 2 * baseRadius
	blob(pool, "base", CFrame.lookAt(centre, centre + axis) * CFrame.new(0, 0, 0), Vector3.new(2 * baseRadius, 120 * SKY + 0.04 * baseRadius, baseLength), COLOUR.base, fade(0, alpha))

	-- The anvil spreading downwind from the top, and mammatus under a mature one.
	local anvilTop = ground + s.anvil.topM * SKY
	local length, width = s.anvil.lengthKm * KM, s.anvil.widthKm * KM
	local anvilCentre = Vector3.new(centre.X, anvilTop, centre.Z) + downwind * (length * 0.45)
	local anvilFrame = CFrame.lookAt(anvilCentre, anvilCentre + downwind)
	blob(pool, "anvil", anvilFrame, Vector3.new(width, 1400 * SKY, length), COLOUR.anvil, fade(0.02, alpha))
	blob(pool, "anvilRoot", CFrame.new(Vector3.new(centre.X, anvilTop, centre.Z)), Vector3.new(R * 2.6, 1800 * SKY, R * 2.6), COLOUR.anvil, fade(0, alpha))
	if s.anvil.mammatus > 0.2 then
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
		rod(pool, "wall", wc + Vector3.new(0, lower / 2, 0), wc - Vector3.new(0, lower / 2, 0), wr, COLOUR.wall, fade(1 - math.clamp(wall.strength * 2.2, 0, 1), alpha))
		local spin = clock * (0.15 + 0.6 * wall.rotation)
		for i = 0, 5 do
			local a = spin + TAU * i / 6
			local p = wc + Vector3.new(math.cos(a), -0.3, math.sin(a)) * Vector3.new(wr, lower, wr)
			blob(pool, `scud{i}`, CFrame.new(p), Vector3.new(wr * 0.45, lower * 0.5, wr * 0.3), COLOUR.scud, fade(1 - wall.strength, alpha))
		end
		if wall.tail > 0.05 then
			local d = heading(wall.tailBearingDeg)
			local len = (2 + 5 * wall.tail) * KM
			local p = wc + d * (wr + len / 2) + Vector3.new(0, lower * 0.1, 0)
			blob(pool, "tail", CFrame.lookAt(p, p + d), Vector3.new(0.7 * KM, lower * 0.6, len), COLOUR.scud, fade(1 - wall.tail, alpha))
		end
	end

	-- Inflow bands, lying along the inflow, from where it comes toward the updraught.
	local bands = s.inflowBands
	for i = 1, bands.count do
		local d = heading(bands.fromDeg + (i - (bands.count + 1) / 2) * 14)
		local len = bands.lengthKm * KM
		local p = centre + d * (R + len / 2) - Vector3.new(0, (baseY - ground) * 0.2, 0)
		blob(pool, `inflow{i}`, CFrame.lookAt(p, p + d), Vector3.new(0.5 * KM, 90 * SKY, len), COLOUR.inflow, fade(1 - 0.8 * bands.strength, alpha))
	end

	-- The shelf cloud along the gust front: a row along a line, an arc ahead of a cell.
	local shelf = s.shelf
	if shelf.strength > 0.05 then
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
				blob(pool, `shelf{i}_{k}`, CFrame.lookAt(q, q + d), Vector3.new(segLength * 1.4, 160 * SKY * shelf.strength + 40, 1.4 * KM), COLOUR.shelf, fade(1 - shelf.strength, alpha))
			end
		end
	end

	-- Rain and hail, from the base to the ground; rain wrapping round the rotation.
	local rain = s.rain
	if rain.intensity > 0.03 then
		local p = at(rain.xKm, rain.yKm, ground)
		blob(pool, "rain", CFrame.lookAt(p, p + heading(rain.bearingDeg)), Vector3.new(rain.acrossKm * KM, 2 * (baseY - ground), rain.alongKm * KM), COLOUR.rain, fade(0.9 - 0.55 * rain.intensity, alpha))
	end
	if s.hail.radiusKm > 0.2 then
		local p = at(s.hail.xKm, s.hail.yKm, ground)
		blob(pool, "hail", CFrame.new(p), Vector3.new(2 * s.hail.radiusKm * KM, 1.9 * (baseY - ground), 2 * s.hail.radiusKm * KM), COLOUR.hail, fade(0.92 - 0.3 * math.clamp(s.hail.sizeInches / 2.5, 0, 1), alpha))
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
			blob(pool, `wrap{i}`, CFrame.new(p), Vector3.new(1.6 * KM, 1.9 * (baseY - ground), 1.6 * KM), COLOUR.rain, fade(1 - 0.75 * rain.wrap, alpha))
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
	local colour = COLOUR.funnel:Lerp(COLOUR.funnelWrapped, wrapped)
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
	for i = 0, SEGMENTS - 1 do
		local f0, f1 = i / SEGMENTS, (i + 1) / SEGMENTS
		local fm = (f0 + f1) / 2
		local r = radiusAt(t, fm)
		if f1 > lowest and r > 0 and fm >= condensed then
			local transparency = (if fm < 0.35 then hollow else 0) + 0.06
			rod(pool, `funnel{i}`, axis(math.max(f0, lowest)), axis(f1), math.max(2, r), colour, fade(transparency, touch ^ 0.5))
		end
	end
	-- The uncondensed vortex below the funnel: a faint whirl of dust and air.
	if condensed > 0.02 and touch > 0.3 then
		rod(pool, "vortex", axis(0), axis(condensed), math.max(3, t.coreRadiusM * TOR), COLOUR.dust, fade(0.88, touch))
	end
	-- Smaller vortices turning round the core.
	if t.vortices > 1 then
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
	demit.Color = ColorSequence.new(COLOUR.dust:Lerp(COLOUR.debris, 1 - debris.dust))
	demit.Size = NumberSequence.new({ NumberSequenceKeypoint.new(0, math.clamp(dr * 0.25, 6, 60)), NumberSequenceKeypoint.new(1, math.clamp(dr * 0.6, 12, 100)) })
	demit.Transparency = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0.35), NumberSequenceKeypoint.new(1, 1) })
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

local rainPart: Part? = nil
local rainEmitter: ParticleEmitter? = nil
local function cameraRain(rate: number, cameraPos: Vector3)
	if not rainPart then
		local p = Instance.new("Part")
		p.Anchored, p.CanCollide, p.CanQuery, p.CanTouch, p.Transparency = true, false, false, false, 1
		p.Size = Vector3.new(160, 1, 160)
		local e = Instance.new("ParticleEmitter")
		e.Texture = "rbxasset://textures/particles/sparkles_main.dds"
		e.Color = ColorSequence.new(Color3.fromRGB(200, 210, 225))
		e.Size = NumberSequence.new(0.12)
		e.Transparency = NumberSequence.new(0.35)
		e.Lifetime = NumberRange.new(1, 1.4)
		e.Speed = NumberRange.new(90, 110)
		e.EmissionDirection = Enum.NormalId.Bottom
		e.LightInfluence = 1
		pcall(function()
			(e :: any).Squash = NumberSequence.new(-3)
		end)
		e.Parent = p
		p.Parent = root
		rainPart, rainEmitter = p, e
	end
	(rainPart :: Part).CFrame = CFrame.new(cameraPos + Vector3.new(0, 70, 0))
	local e = rainEmitter :: ParticleEmitter
	e.Rate = rate
	e.Enabled = rate > 1
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

function StormView.start()
	local weather = ReplicatedStorage:WaitForChild("Weather")
	local track = StormTrack.new()
	local framesEvent = weather:WaitForChild("Frames") :: RemoteEvent
	framesEvent.OnClientEvent:Connect(function(packet: any)
		track:add(packet.frames, packet.reset, packet.epoch)
	end)
	task.spawn(function()
		local packet = (weather:WaitForChild("Sync") :: RemoteFunction):InvokeServer()
		track:add(packet.frames, true, packet.epoch)
	end)
	root.Parent = workspace

	local pools: { [string]: Pool } = {}
	local bolts: { { parts: { BasePart }, untilClock: number } } = {}
	local baseExposure = Lighting.ExposureCompensation
	local clock = 0
	RunService.RenderStepped:Connect(function(dt: number)
		clock += dt
		local camera = workspace.CurrentCamera
		if not camera then
			return
		end
		local cameraPos = camera.CFrame.Position
		local nowMs = workspace:GetServerTimeNow() * 1000 + ((weather:GetAttribute("ClockOffsetMs") :: number?) or 0)
		local storms = track:sample(nowMs)
		local px, py = (cameraPos.X + HALF) / KM, (cameraPos.Z + HALF) / KM
		local alive: { [string]: boolean } = {}
		local cover, rainRate = 0, 0
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
			drawClouds(pool, s, clock)
			if s.tornado then
				drawTornado(pool, s, clock, cameraPos)
			elseif s.funnelAloft then
				drawFunnelAloft(pool, s)
			end
			finish(pool)
			-- Under the anvil or the base the light falls; in the rain it rains.
			local anvilCentreX = s.updraft.xKm + math.sin(math.rad(s.anvil.bearingDeg)) * s.anvil.lengthKm * 0.45
			local anvilCentreY = s.updraft.yKm - math.cos(math.rad(s.anvil.bearingDeg)) * s.anvil.lengthKm * 0.45
			if inside(anvilCentreX, anvilCentreY, s.anvil.lengthKm / 2, s.anvil.widthKm / 2, s.anvil.bearingDeg, px, py) < 1 then
				cover = math.max(cover, 0.35 * (s.alpha or 1))
			end
			if inside(s.updraft.xKm, s.updraft.yKm, s.base.radiusKm, s.base.radiusKm, 0, px, py) < 1 then
				cover = math.max(cover, 0.7 * (s.alpha or 1))
			end
			local r = s.rain
			if inside(r.xKm, r.yKm, r.alongKm / 2, r.acrossKm / 2, r.bearingDeg, px, py) < 1 then
				cover = math.max(cover, 0.6 + 0.3 * r.intensity)
				rainRate = math.max(rainRate, 400 * r.intensity * (s.alpha or 1))
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
			end
		end
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
		Lighting.ExposureCompensation = baseExposure - 1.4 * cover
		cameraRain(rainRate, cameraPos)
	end)
end

return StormView
