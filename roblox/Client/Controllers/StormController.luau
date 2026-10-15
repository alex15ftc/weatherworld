--!strict
-- Draws the storms the weather feed sends (WeatherService; Shared/Weather/StormTrack). Every
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
-- Per tornado: the condensation funnel, soft-edged and wrapped in turning smoke (its radius at
-- each height, leaning and twisting as it decays, lowering from the cloud as it touches down),
-- the uncondensed vortex below it, the smaller vortices of a multiple-vortex tornado, the
-- debris dome and dust skirt at the ground, and shards of debris thrown round it.
-- Also lightning, the light dimming under a storm, and rain where the camera is.

local ContentProvider = game:GetService("ContentProvider")
local Lighting = game:GetService("Lighting")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local Config = require(ReplicatedStorage.Shared.World.Config)
local StormTrack = require(ReplicatedStorage.Shared.Weather.StormTrack)
local Net = require(ReplicatedStorage.Shared.Weather.Net)
local Textures = require(ReplicatedStorage.Shared.Weather.Textures)

local StormController = {}

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
root.Name = "StormController"

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

-- Billboards: an image that always faces the camera, sized in studs, seen at any distance
-- (particles are not). Images are uploaded art (Shared/Weather/Textures); one is used only once
-- Roblox serves it (uploads are moderated first), and until then the parts above stand in.
local ready: { [string]: boolean } = {}

local function isReady(image: string): boolean
	return image ~= "" and ready[image] == true
end

-- An image, or one cell of a sheet, at position, size studs across and up.
local function billboard(pool: Pool, key: string, position: Vector3, size: Vector2, image: string, cell: Vector2, cellSize: Vector2, colour: Color3, transparency: number)
	local part = pool.parts[key]
	local gui: BillboardGui
	local label: ImageLabel
	if not part then
		local p = Instance.new("Part")
		p.Anchored, p.CanCollide, p.CanQuery, p.CanTouch, p.CastShadow = true, false, false, false, false
		p.Transparency = 1
		p.Size = Vector3.one
		p.Name = key
		gui = Instance.new("BillboardGui")
		gui.MaxDistance = math.huge
		gui.LightInfluence = 0.6
		gui.Adornee = p
		label = Instance.new("ImageLabel")
		label.BackgroundTransparency = 1
		label.Size = UDim2.fromScale(1, 1)
		label.Parent = gui
		gui.Parent = p
		p.Parent = pool.model
		pool.parts[key] = p
		part = p
	else
		gui = part:FindFirstChildOfClass("BillboardGui") :: BillboardGui
		label = gui:FindFirstChildOfClass("ImageLabel") :: ImageLabel
	end
	pool.used[key] = true
	local b = part :: BasePart
	b.CFrame = CFrame.new(position)
	gui.Size = UDim2.new(size.X, 0, size.Y, 0)
	gui.Enabled = transparency < 0.99
	label.Image = image
	label.ImageRectOffset = cell
	label.ImageRectSize = cellSize
	label.ImageColor3 = colour
	label.ImageTransparency = transparency
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
			local gui = part:FindFirstChildOfClass("BillboardGui")
			if gui then
				gui.Enabled = false
			end
		end
	end
	table.clear(pool.used)
end

local function fade(t: number, alpha: number): number
	return 1 - (1 - t) * math.clamp(alpha, 0, 1)
end

-- A storm's clouds --------------------------------------------------------------------------
--
-- Every cloud piece is a cluster of overlapping puffs rather than one smooth shape: random
-- sizes and places (fixed per storm, so nothing flickers), the outer ones more see-through, so
-- the edges are ragged and soft and no tiers line up. They swell and shrink a little, slowly,
-- so the cloud boils.

-- A fixed random number (0..1) for a seed and an index.
local function rand(seed: number, n: number): number
	return (math.sin(seed * 12.9898 + n * 78.233) * 43758.5453) % 1
end

-- `count` puffs filling an ellipsoid of `size` (x across, y up, z along) at `frame`. The
-- middle ones are as clear as `transparency`, the outer ones clearer; the lower ones darker,
-- toward `under`.
local function puffs(pool: Pool, key: string, kind: string, frame: CFrame, size: Vector3, count: number, colour: Color3, under: Color3, transparency: number, clock: number, seed: number)
	local sheet = (Textures.clouds :: any)[kind]
	local textured = sheet ~= nil and isReady(sheet.image)
	local grid = if sheet then sheet.grid else 1
	local cellPx = 1024 / grid
	for i = 1, count do
		local n = i * 5
		local a = TAU * rand(seed, n)
		local out = math.sqrt(rand(seed, n + 1)) * 0.62
		local y = (rand(seed, n + 2) - 0.5) * 0.55
		local offset = Vector3.new(math.cos(a) * out * size.X / 2, y * size.Y / 2, math.sin(a) * out * size.Z / 2)
		local share = 0.42 + 0.5 * rand(seed, n + 3)
		local boil = 1 + 0.05 * math.sin(clock * 0.12 + seed * 40 + i * 1.7)
		local clear = 1 - (1 - transparency) * (1 - 0.5 * out / 0.62)
		local shade = colour:Lerp(under, math.clamp(0.25 - y * 0.6, 0, 0.45))
		if textured then
			-- A puff from the sheet, as wide as the cluster's puff and a little taller (the art
			-- is round), softer than a part needs to be.
			local pick = math.floor(rand(seed, n + 4) * grid * grid)
			local cell = Vector2.new(pick % grid, math.floor(pick / grid)) * cellPx
			local across = math.max(size.X, size.Z) * share * boil
			local up = math.max(size.Y * share * boil * 1.6, across * 0.55)
			billboard(pool, `{key}#{i}`, (frame * CFrame.new(offset)).Position, Vector2.new(across, up), sheet.image, cell, Vector2.new(cellPx, cellPx), shade, 1 - (1 - clear) * 0.95)
		else
			blob(pool, `{key}#{i}`, frame * CFrame.new(offset), size * share * boil, shade, clear)
		end
	end
end

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
	local levels = 7
	local perLevel = if towers > 1 then 3 else 6
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
			puffs(pool, `t{k}_{i}`, "puff", CFrame.new(c), Vector3.new(r * 2.2, height / levels * 2.8, r * 2.2), perLevel, colour, COLOUR.band, fade(0.04, alpha), clock, seed + k * 7.1 + i * 1.3)
			-- Bands round a rotating tower (striations), turning slowly.
			if k == 1 and f < 0.5 and up.striation > 0.15 then
				blob(pool, `band{i}`, CFrame.new(c) * CFrame.Angles(0, clock * 0.05 * up.rotation, 0), Vector3.new(r * 2.15, height / levels * 0.35, r * 2.05), COLOUR.band, fade(1 - 0.5 * up.striation, alpha))
			end
		end
		-- An overshooting dome over the strongest updraught.
		if k == 1 and up.overshootM > 50 then
			local dome = up.overshootM * SKY
			puffs(pool, "overshoot", "puff", CFrame.new(foot + Vector3.new(0, height, 0) + downwind * 0.25 * height), Vector3.new(R * 1.1, dome * 2.4, R * 1.1), 3, COLOUR.towerTop, COLOUR.tower, fade(0.05, alpha), clock, seed + 3.3)
		end
	end

	-- The base: dark, broad as the storm's rain-free base, along a line as long as the line;
	-- flat underneath in the middle, torn at the edges.
	local baseRadius = s.base.radiusKm * KM
	local baseLength = if towers > 1 then 2 * s.line.halfLengthKm * KM + baseRadius else 2 * baseRadius
	local baseThick = 120 * SKY + 0.04 * baseRadius
	local baseFrame = CFrame.lookAt(centre, centre + axis)
	local textured = isReady(Textures.clouds.puff.image)
	if not textured then
		blob(pool, "base", baseFrame, Vector3.new(1.5 * baseRadius, baseThick, baseLength * 0.75), COLOUR.base, fade(0.15, alpha))
	end
	puffs(pool, "baseRag", "scud", baseFrame, Vector3.new(2.3 * baseRadius, baseThick * 1.6, baseLength * 1.15), 9, COLOUR.base, COLOUR.wall, fade(0.35, alpha), clock, seed + 5.7)

	-- The anvil spreading downwind from the top, and mammatus under a mature one.
	local anvilTop = ground + s.anvil.topM * SKY
	local length, width = s.anvil.lengthKm * KM, s.anvil.widthKm * KM
	local anvilCentre = Vector3.new(centre.X, anvilTop, centre.Z) + downwind * (length * 0.45)
	local anvilFrame = CFrame.lookAt(anvilCentre, anvilCentre + downwind)
	if not textured then
		blob(pool, "anvil", anvilFrame, Vector3.new(width * 0.7, 1100 * SKY, length * 0.75), COLOUR.anvil, fade(0.1, alpha))
	end
	puffs(pool, "anvilRag", "wisp", anvilFrame, Vector3.new(width * 1.1, 1700 * SKY, length * 1.1), 9, COLOUR.anvil, COLOUR.tower, fade(0.3, alpha), clock, seed + 9.1)
	puffs(pool, "anvilRoot", "puff", CFrame.new(Vector3.new(centre.X, anvilTop, centre.Z)), Vector3.new(R * 3, 2000 * SKY, R * 3), 4, COLOUR.anvil, COLOUR.tower, fade(0.05, alpha), clock, seed + 2.9)
	if s.anvil.mammatus > 0.2 then
		for i = 1, 6 do
			local p = anvilFrame * CFrame.new((rand(seed, 600 + i) - 0.5) * width * 0.5, -700 * SKY, -(0.1 + 0.5 * rand(seed, 700 + i)) * length * 0.5)
			blob(pool, `mamma{i}`, p, Vector3.new(width * 0.12, 500 * SKY, width * 0.12), COLOUR.anvil:Lerp(COLOUR.base, 0.25), fade(1 - s.anvil.mammatus, alpha))
		end
	end

	-- The wall cloud, scud turning round it, and its tail cloud.
	local wall = s.wallCloud
	if wall.strength > 0.03 then
		local wr = wall.radiusKm * KM
		local lower = math.max(30, wall.loweringM * SKY)
		local wc = at(wall.xKm, wall.yKm, baseY - lower / 2)
		local wallClear = 1 - math.clamp(wall.strength * 2.2, 0, 1)
		puffs(pool, "wall", "scud", CFrame.new(wc) * CFrame.Angles(0, clock * 0.04 * (0.2 + wall.rotation), 0), Vector3.new(2.4 * wr, lower * 1.3, 2.4 * wr), 6, COLOUR.wall, COLOUR.wall, fade(wallClear + 0.1 * (1 - wallClear), alpha), clock, seed + 4.4)
		local spin = clock * (0.15 + 0.6 * wall.rotation)
		for i = 0, 5 do
			local a = spin + TAU * i / 6
			local p = wc + Vector3.new(math.cos(a), -0.3, math.sin(a)) * Vector3.new(wr, lower, wr)
			blob(pool, `scud{i}`, CFrame.new(p), Vector3.new(wr * 0.45, lower * 0.5, wr * 0.3), COLOUR.scud, fade(1 - 0.8 * wall.strength, alpha))
		end
		if wall.tail > 0.05 then
			local d = heading(wall.tailBearingDeg)
			local len = (2 + 5 * wall.tail) * KM
			local p = wc + d * (wr + len / 2) + Vector3.new(0, lower * 0.1, 0)
			puffs(pool, "tail", "scud", CFrame.lookAt(p, p + d), Vector3.new(0.9 * KM, lower * 0.8, len), 5, COLOUR.scud, COLOUR.wall, fade(1 - 0.8 * wall.tail, alpha), clock, seed + 6.2)
		end
	end

	-- Inflow bands, lying along the inflow toward the updraught: strings of faint beads.
	local bands = s.inflowBands
	for i = 1, bands.count do
		local d = heading(bands.fromDeg + (i - (bands.count + 1) / 2) * 14)
		local len = bands.lengthKm * KM
		local start = centre + d * R - Vector3.new(0, (baseY - ground) * 0.2, 0)
		local clear = fade(math.max(0.45, 1 - 0.6 * bands.strength), alpha)
		for j = 1, 6 do
			local p = start + d * (len * (j - 0.5) / 6) + Vector3.new(0, (rand(seed, i * 40 + j) - 0.5) * 60 * SKY, 0)
			local bead = 0.7 + 0.6 * rand(seed, i * 40 + j + 20)
			if isReady(Textures.clouds.wisp.image) then
				local cell = Vector2.new(j % 4, math.floor(j / 4) % 4) * 256
				billboard(pool, `inflow{i}_{j}`, p, Vector2.new(len / 4, 160 * SKY * bead), Textures.clouds.wisp.image, cell, Vector2.new(256, 256), COLOUR.inflow, clear)
			else
				blob(pool, `inflow{i}_{j}`, CFrame.lookAt(p, p + d), Vector3.new(0.6 * KM * bead, 110 * SKY * bead, len / 4.5), COLOUR.inflow, clear)
			end
		end
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
				puffs(pool, `shelf{i}_{k}`, "scud", CFrame.lookAt(q, q + d), Vector3.new(segLength * 1.6, (160 * SKY * shelf.strength + 40) * 1.4, 1.6 * KM), 2, COLOUR.shelf, COLOUR.wall, fade(1 - shelf.strength, alpha), clock, seed + i * 3.7 + k)
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
--
-- Drawn soft rather than solid: each piece of the funnel is a dense inner core inside a faint
-- outer shell (a feathered edge that still holds its shape from miles off), wrapped in a sheath
-- of smoke turning with the wind. The bottom of the funnel melts into the debris cloud and the
-- top into a collar under the cloud base. At the ground, a dark dome of debris and dust turns
-- round the base, a lighter skirt of dust rolls out along the ground, and near the camera
-- shards of debris (boards, sheet metal, siding) spiral up and are flung out.

local SEGMENTS = 18
local SHARDS = 48
local DETAIL_STUDS = 6000 -- smoke and shards within this distance of the camera
local SHARD_STUDS = 3500
local MAX_PUFF = 100 -- largest smoke particle drawn (studs)

local SHARD_COLOURS = {
	Color3.fromRGB(58, 48, 40), -- splintered wood, dark
	Color3.fromRGB(122, 94, 66), -- lumber
	Color3.fromRGB(150, 150, 154), -- sheet metal
	Color3.fromRGB(150, 44, 36), -- barn red
	Color3.fromRGB(214, 210, 200), -- siding
	Color3.fromRGB(40, 40, 42), -- shingles
}

-- A plain block, for debris shards.
local function block(pool: Pool, key: string, cf: CFrame, size: Vector3, colour: Color3, transparency: number)
	local part = pool.parts[key]
	if not part then
		local p = Instance.new("Part")
		p.Anchored, p.CanCollide, p.CanQuery, p.CanTouch, p.CastShadow = true, false, false, false, false
		p.Material = Enum.Material.SmoothPlastic
		p.Name = key
		p.Parent = pool.model
		pool.parts[key] = p
		part = p
	end
	pool.used[key] = true
	local b = part :: BasePart
	if b.Size ~= size then
		b.Size = size
	end
	b.CFrame = cf
	b.Color = colour
	b.Transparency = transparency
end

-- Emitter settings are written only when they change by more than a little (rebuilding the
-- sequences every frame for every emitter costs more than drawing them).
local settled: { [ParticleEmitter]: { [string]: number } } = setmetatable({}, { __mode = "k" }) :: any

local function changed(e: ParticleEmitter, field: string, value: number, tolerance: number): boolean
	local seen = settled[e]
	if not seen then
		seen = {}
		settled[e] = seen
	end
	local last = seen[field]
	if last and math.abs(value - last) <= tolerance * math.max(1, math.abs(last)) then
		return false
	end
	seen[field] = value
	return true
end

-- A smoke emitter on the part `key`: puffs of `size` studs that grow by `grow`, fading in then
-- out over their life. Turning with the part (LockedToPart), so spinning the part swirls them.
local function smoke(pool: Pool, key: string, cf: CFrame, partSize: Vector3, size: number, grow: number, colour: Color3, opacity: number, rate: number, life: number, surface: boolean): ParticleEmitter
	local part, e = emitter(pool, key)
	part.Size = Vector3.new(math.clamp(partSize.X, 0.2, MAX_PART), math.clamp(partSize.Y, 0.2, MAX_PART), math.clamp(partSize.Z, 0.2, MAX_PART))
	part.CFrame = cf
	if not e:GetAttribute("Tornado") then
		e:SetAttribute("Tornado", true)
		e.LockedToPart = true
		e.Drag = 1.5
		e.Speed = NumberRange.new(1, 4)
		e.RotSpeed = NumberRange.new(-25, 25)
		e.ShapeStyle = if surface then Enum.ParticleEmitterShapeStyle.Surface else Enum.ParticleEmitterShapeStyle.Volume
	end
	size = math.clamp(size, 4, MAX_PUFF)
	if changed(e, "size", size, 0.1) or changed(e, "grow", grow, 0.05) then
		e.Size = NumberSequence.new({
			NumberSequenceKeypoint.new(0, size * 0.7),
			NumberSequenceKeypoint.new(1, math.min(size * grow, MAX_PUFF * 1.5)),
		})
	end
	if changed(e, "opacity", opacity, 0.05) then
		local clear = 1 - math.clamp(opacity, 0, 1)
		e.Transparency = NumberSequence.new({
			NumberSequenceKeypoint.new(0, 1),
			NumberSequenceKeypoint.new(0.2, clear),
			NumberSequenceKeypoint.new(0.7, clear + (1 - clear) * 0.3),
			NumberSequenceKeypoint.new(1, 1),
		})
	end
	local c = math.floor(colour.R * 255) * 65536 + math.floor(colour.G * 255) * 256 + math.floor(colour.B * 255)
	if changed(e, "colour", c, 0) then
		e.Color = ColorSequence.new(colour)
	end
	if changed(e, "life", life, 0.1) then
		e.Lifetime = NumberRange.new(life * 0.7, life)
	end
	e.Rate = rate
	e.Enabled = rate > 0
	return e
end

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

-- A soft cylinder: a dense core inside a faint shell, so the edge feathers.
local function softRod(pool: Pool, key: string, p0: Vector3, p1: Vector3, r: number, core: Color3, shell: Color3, transparency: number)
	rod(pool, `{key}c`, p0, p1, r * 0.62, core, transparency)
	rod(pool, `{key}s`, p0, p1, r, shell, 1 - (1 - transparency) * 0.38)
end

-- Spin about a rod's own axis (rod parts lie along X), for swirling locked smoke.
local function rodFrame(p0: Vector3, p1: Vector3, spin: number): CFrame
	return CFrame.lookAt((p0 + p1) / 2, p1) * CFrame.Angles(0, math.pi / 2, 0) * CFrame.Angles(spin, 0, 0)
end

-- The tornado as a billboard of the baked funnel (Shared/Weather/Textures): the sheet for the
-- side it is seen from, the frame for where it is in its life (lowering as it touches down, a
-- mature cone drifting slowly, roping out as it decays), scaled to the engine's height and
-- width and stood on its ground point. False when the art is not ready, so the parts draw it.
local function drawImpostor(pool: Pool, t: any, foot: Vector3, height: number, touch: number, wrapped: number, clock: number, seed: number, cameraPos: Vector3): boolean
	local tex = Textures.tornado
	local toCamera = cameraPos - foot
	local bearing = math.deg(math.atan2(toCamera.X, -toCamera.Z)) % 360
	local view = math.floor(bearing / (360 / #tex.views) + 0.5) % #tex.views + 1
	local sheet = tex.sheets[view]
	if not isReady(sheet) then
		return false
	end
	local decay = math.clamp(t.decay or 0, 0, 1)
	local stage
	if decay > 0.05 then
		stage = 36 + decay * 20 + (if touch < 1 then (1 - touch) * 7 else 0)
	elseif touch < 1 then
		stage = 1 + touch * 15
	else
		stage = 16 + 20 * (0.5 + 0.5 * math.sin(clock * 0.03 + seed * 10))
	end
	local frame = math.clamp(math.floor(stage), 0, tex.frames - 1)
	local cellPx = 1024 / tex.grid
	local cell = Vector2.new(frame % tex.grid, math.floor(frame / tex.grid)) * cellPx
	-- The baked funnel fills the frame from the ground to the collar in the cloud base; its
	-- middle is about a fifth of the frame across. Fit that to the engine's funnel.
	local h = height * 1.12
	local w = math.clamp(10 * radiusAt(t, 0.5), h * 0.45, h * 1.6)
	local tint = Color3.new(1, 1, 1):Lerp(Color3.fromRGB(105, 108, 116), wrapped)
	billboard(pool, "impostor", foot + Vector3.new(0, h / 2, 0), Vector2.new(w, h), sheet, cell, Vector2.new(cellPx, cellPx), tint, fade(0, math.min(1, touch * 3)))
	return true
end

local function drawTornado(pool: Pool, s: any, clock: number, cameraPos: Vector3)
	local t = s.tornado
	local touch = math.clamp(t.touch or 1, 0, 1)
	local ground = t.groundStuds or s.groundStuds or 0
	local foot = at(t.xKm, t.yKm, ground)
	local near = (foot - cameraPos).Magnitude
	-- Near the camera, stand it on the ground actually loaded here.
	if near < 4000 then
		local hit = workspace:Raycast(foot + Vector3.new(0, 2000, 0), Vector3.new(0, -4000, 0))
		if hit and hit.Instance:IsA("Terrain") then
			foot = Vector3.new(foot.X, hit.Position.Y, foot.Z)
		end
	end
	local detail = near < DETAIL_STUDS
	local height = t.baseM * SKY
	local top = Vector3.new(t.tiltEastM, 0, -t.tiltNorthM) / 1000 * KM
	local wrapped = math.clamp(t.rainWrap or 0, 0, 1)
	local core = COLOUR.funnel:Lerp(COLOUR.funnelWrapped, wrapped)
	local shell = core:Lerp(COLOUR.towerTop, 0.3 * (1 - wrapped))
	local seed = hash(t.id)
	-- How fast it turns (rad/s), from the wind at the core.
	local turn = math.clamp(t.windMph * 0.447 / math.max(15, t.coreRadiusM), 0.4, 4)
	-- The funnel's axis at a share of the height: leaning toward its top, twisting as it decays.
	local side = Vector3.new(top.Z, 0, -top.X).Unit
	if side ~= side then
		side = Vector3.xAxis
	end
	local function axis(f: number): Vector3
		local wiggle = t.contortion * math.sin(f * math.pi * 2.5 + clock * 0.35 + seed * 10) * 0.12 * height * math.sin(f * math.pi)
		return foot + top * f + Vector3.new(0, f * height, 0) + side * wiggle
	end

	local debris = t.debris
	local dr = math.max(8, debris.radiusM * TOR)
	local dh = math.max(10, debris.heightM * TOR)
	local debrisOn = touch > 0.5 and debris.strength > 0.02
	-- Up to this share of the height the funnel melts into the debris cloud.
	local melt = if debrisOn then math.clamp(dh * 0.9 / math.max(1, height), 0.04, 0.3) else 0.04

	-- The baked funnel where its art is ready; otherwise the funnel is built from parts below.
	local baked = drawImpostor(pool, t, foot, height, touch, wrapped, clock, seed, cameraPos)

	-- What is shown: lowering from the cloud while it touches down (or lifting as it ends).
	local lowest = 1 - touch
	local condensed = math.clamp(t.condensedM / math.max(1, t.baseM), 0, 1)
	local hollow = math.clamp(0.25 * t.twoCell + (if t.vortices > 1 then 0.25 else 0), 0, 0.6)
	for i = 0, SEGMENTS - 1 do
		local f0, f1 = i / SEGMENTS, (i + 1) / SEGMENTS
		local fm = (f0 + f1) / 2
		local r = radiusAt(t, fm)
		if f1 > lowest and r > 0 and fm >= condensed then
			local p0, p1 = axis(math.max(f0, lowest)), axis(f1)
			local base = 0.08 + (if fm < 0.35 then hollow else 0)
			-- Thinning toward the ground, so the bottom disappears into the debris.
			local thin = if fm < melt then 0.55 * (1 - fm / melt) else 0
			if not baked then
				softRod(pool, `funnel{i}`, p0, p1, math.max(2, r), core, shell, fade(base + thin, touch ^ 0.5))
			end
			if detail then
				local puff = math.max(6, r * 0.9)
				local length = (p1 - p0).Magnitude
				local rate = math.clamp(length * r / (puff * puff) * 6, 2, 40) * touch
				smoke(pool, `funnelSmoke{i}`, rodFrame(p0, p1, clock * turn * (1 - 0.5 * fm)), Vector3.new(length, 2 * r * 1.05, 2 * r * 1.05), puff, 1.6, shell, (if baked then 0.22 else 0.45) * (1 - thin), rate, 3, true)
			end
		end
	end
	-- The collar under the cloud base the funnel hangs from.
	local topR = radiusAt(t, 1)
	if topR > 0 and touch > 0.05 and not baked then
		local c = axis(1)
		blob(pool, "collar", CFrame.new(c - Vector3.new(0, topR * 0.4, 0)), Vector3.new(topR * 3.4, topR * 1.4, topR * 3.4), shell, fade(0.45, touch))
	end
	-- The uncondensed vortex below the funnel: a faint whirl of dust and air.
	if condensed > 0.02 and touch > 0.3 then
		rod(pool, "vortex", axis(0), axis(condensed), math.max(3, t.coreRadiusM * TOR), COLOUR.dust, fade(0.88, touch))
		if detail then
			local r = math.max(3, t.coreRadiusM * TOR)
			local p0, p1 = axis(0), axis(condensed)
			smoke(pool, "vortexSmoke", rodFrame(p0, p1, clock * turn), Vector3.new((p1 - p0).Magnitude, 2 * r, 2 * r), r * 0.8, 1.8, COLOUR.dust, 0.3, 10 * touch, 2.5, true)
		end
	end
	-- Smaller vortices turning round the core.
	if t.vortices > 1 and not baked then
		local orbit = math.max(6, t.coreRadiusM * TOR * 0.85)
		local spin = clock * math.clamp(0.5 * t.windMph * 0.447 / math.max(10, t.coreRadiusM), 0.4, 3)
		local subR = math.max(3, t.subvortexRadiusM * TOR)
		local reach = math.clamp(0.45 + 0.3 * condensed, 0.3, 0.75)
		for k = 1, t.vortices do
			local a = spin + TAU * k / t.vortices
			local off = Vector3.new(math.cos(a), 0, math.sin(a)) * orbit
			for j = 0, 3 do
				local f0, f1 = reach * j / 4, reach * (j + 1) / 4
				softRod(pool, `sub{k}_{j}`, axis(f0) + off, axis(f1) + off * (1 - f1 / reach * 0.5), subR * (1 + j * 0.6), core, shell, fade(0.2, touch))
			end
		end
	end

	-- The debris cloud: a dark dome turning round the base, and dust rolling out along the ground.
	local cloudColour = COLOUR.dust:Lerp(COLOUR.debris, 1 - debris.dust)
	local domeRate = if debrisOn and detail then (20 + 70 * debris.strength) else 0
	local dome = smoke(pool, "debrisDome", CFrame.new(foot + Vector3.new(0, dh * 0.4, 0)) * CFrame.Angles(0, clock * turn * 0.6, math.pi / 2), Vector3.new(dh * 0.8, 2 * dr, 2 * dr), dr * 0.45, 1.7, cloudColour, 0.55 + 0.3 * debris.strength, domeRate, 4.5, false)
	if changed(dome, "rise", debris.strength, 0.05) then
		dome.Acceleration = Vector3.new(0, 2 + 10 * debris.strength, 0)
		dome.Speed = NumberRange.new(2, 6 + 14 * debris.strength)
	end
	local skirt = smoke(pool, "dustSkirt", CFrame.new(foot + Vector3.new(0, 4, 0)) * CFrame.Angles(0, 0, math.pi / 2), Vector3.new(6, 2 * dr * 1.3, 2 * dr * 1.3), dr * 0.4, 2.2, COLOUR.dust, 0.35 * debris.dust + 0.15, if debrisOn and detail then 10 + 30 * debris.strength else 0, 3.5, true)
	if changed(skirt, "skirt", 1, 0) then
		skirt.LockedToPart = false
		skirt.Speed = NumberRange.new(12, 30)
		skirt.Drag = 0.8
		skirt.Acceleration = Vector3.new(0, 1.5, 0)
	end
	-- Far away, where the smoke is not drawn, a soft dome keeps the base dark.
	if debrisOn and not detail then
		local dust = Textures.clouds.dust
		if isReady(dust.image) then
			local cellPx = 1024 / dust.grid
			billboard(pool, "debrisFar", foot + Vector3.new(0, dh * 0.45, 0), Vector2.new(dr * 2.6, dh * 1.4), dust.image, Vector2.new(0, 0), Vector2.new(cellPx, cellPx), cloudColour, 0.15)
		else
			blob(pool, "debrisFar", CFrame.new(foot + Vector3.new(0, dh * 0.3, 0)), Vector3.new(dr * 2, dh * 1.1, dr * 2), cloudColour, 0.35)
		end
	end

	-- Shards of debris: up the spiral, widening as they rise, then flung out and falling.
	local shards = debrisOn and debris.strength > 0.05 and near < SHARD_STUDS
	local lofted = dh * (2 + 2 * debris.strength)
	-- A fixed random number per shard (0..1), from the tornado's seed.
	local function rnd(n: number): number
		return (math.sin(seed * 12.9898 + n * 78.233) * 43758.5453) % 1
	end
	for i = 1, if shards then SHARDS else 0 do
		local key = `shard{i}`
		local h1, h2, h3 = rnd(i), rnd(i + 0.37), rnd(i + 0.71)
		local life = (clock * (0.08 + 0.1 * h1) + h2) % 1
		local rise = life ^ 0.75
		local r = dr * (0.35 + 0.5 * h3) * (1 + 1.6 * life)
		local a = clock * turn * (1.3 - 0.6 * life) + TAU * h1 * 7
		local p = foot + Vector3.new(math.cos(a) * r, rise * lofted, math.sin(a) * r)
		if life > 0.8 then
			-- Thrown clear: out along the turn, dropping.
			local out = (life - 0.8) / 0.2
			p += Vector3.new(-math.sin(a), 0, math.cos(a)) * out * dr * 0.8 - Vector3.new(0, out * out * lofted * 0.5, 0)
		end
		local size = Vector3.new(0.4 + 3.6 * h2, 0.15 + 0.25 * h3, 0.4 + 2.6 * h1) * (0.6 + 0.8 * debris.strength)
		local tumble = CFrame.Angles(clock * (2 + 5 * h1), clock * (1 + 4 * h2), clock * 3 * h3)
		block(pool, key, CFrame.new(p) * tumble, size, SHARD_COLOURS[1 + math.floor(h3 * #SHARD_COLOURS) % #SHARD_COLOURS], 0)
	end
end

-- A funnel lowering from the wall cloud before a tornado.
local function drawFunnelAloft(pool: Pool, s: any)
	local f = s.funnelAloft
	local ground = s.groundStuds or 0
	local baseY = ground + (s.updraft.baseM - s.wallCloud.loweringM) * SKY
	local length = f.lengthShare * (s.updraft.baseM - s.wallCloud.loweringM) * SKY
	local p = at(f.xKm, f.yKm, baseY)
	local shell = COLOUR.funnel:Lerp(COLOUR.towerTop, 0.3)
	for i = 0, 5 do
		local a, b = i / 6, (i + 1) / 6
		-- Fading toward its tip, as it condenses from the cloud down.
		softRod(pool, `aloft{i}`, p - Vector3.new(0, a * length, 0), p - Vector3.new(0, b * length, 0), f.radiusM * TOR * (1 - 0.8 * (a + b) / 2), COLOUR.funnel, shell, fade(0.1 + 0.5 * a, s.alpha or 1))
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

function StormController.Start()
	local weather = ReplicatedStorage:WaitForChild("Weather")
	local track = StormTrack.new()
	Net.Frames:Client():On(function(packet: Net.Packet)
		track:add(packet.frames, packet.reset, packet.epoch)
	end)
	Net.AskFrames:Client():Fire()
	root.Parent = workspace

	-- Mark the storm art ready once Roblox serves it (a new upload waits for moderation, so
	-- keep asking now and then); until then the part-built storm shows.
	task.spawn(function()
		local images: { string } = {}
		for _, sheet in Textures.tornado.sheets do
			table.insert(images, sheet)
		end
		for _, kind in Textures.clouds :: { [string]: { image: string, grid: number } } do
			table.insert(images, kind.image)
		end
		while true do
			local waiting = {}
			for _, image in images do
				if image ~= "" and not ready[image] then
					table.insert(waiting, image)
				end
			end
			if #waiting == 0 then
				break
			end
			pcall(function()
				ContentProvider:PreloadAsync(waiting, function(id: string, status: Enum.AssetFetchStatus)
					if status == Enum.AssetFetchStatus.Success then
						ready[id] = true
					end
				end)
			end)
			task.wait(60)
		end
	end)

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
				local parts: { BasePart } = {}
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

return StormController
