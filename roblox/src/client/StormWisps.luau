--!strict
-- Scud and wisps (05_scud_fractus, 04_wall_cloud, 07_whales_mouth in docs/storm-reference/real):
-- baked volumetric shreds (tools/blender/cloud_wisp_bake.py) drawn as camera-facing images under a
-- storm, the soft, torn detail the solid base mesh can't have.
--   fringe   ragged strips hanging from the base's rim (a ring round a cell's base; the leading
--            edge of a line), hiding its hard edge
--   scud     torn fragments under the base, most round the wall cloud and on the inflow side,
--            forming low, rising into the base and drifting toward the wall cloud as they go,
--            fading in and out (each on its own cycle)
-- Each sheet has two cells stacked: "diffuse" (overcast light, the main look) above, "back" (the
-- sun behind it: silver edges) below, blended by where the sun is. Images are tinted from the
-- storm's own shade (dark under the base) and the time of day.
--
--   StormWisps.draw(s, ctx, place)   -- each frame, each storm near enough (place: the kit's
--                                      drawing rule: world point, size -> drawn point, scale)
--   StormWisps.sweep(alive)
local Lighting = game:GetService("Lighting")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("World"):WaitForChild("Config"))

local StormWisps = {}

local K = Config.STORM_KIT
local W = K.wisp
local TAU = math.pi * 2

type Sprite = { part: Part, diffuse: ImageLabel, back: ImageLabel, image: string }
type Set = { folder: Folder, sprites: { Sprite }, used: number }
local sets: { [string]: Set } = {}

local function smooth01(x: number): number
	x = math.clamp(x, 0, 1)
	return x * x * (3 - 2 * x)
end

local function hash(id: string, slot: number, salt: number): number
	local h = 2166136261
	for i = 1, #id do
		h = bit32.bxor(h, string.byte(id, i))
		h = (h * 16777619) % 4294967296
	end
	h = bit32.bxor(h, slot * 7919 + salt * 104729)
	h = (h * 16777619) % 4294967296
	h = bit32.bxor(h, bit32.rshift(h, 13))
	h = (h * 1274126177) % 4294967296
	return (h % 1000003) / 1000003
end

local function newSprite(folder: Folder, image: string, cell: Vector2): Sprite
	local part = Instance.new("Part")
	part.Anchored, part.CanCollide, part.CanQuery, part.CanTouch, part.CastShadow = true, false, false, false, false
	part.Transparency = 1
	part.Name = "wisp"
	local gui = Instance.new("SurfaceGui")
	gui.Face = Enum.NormalId.Front
	gui.SizingMode = Enum.SurfaceGuiSizingMode.FixedSize
	gui.CanvasSize = cell
	gui.LightInfluence = 0
	gui.Brightness = W.brightness
	gui.Parent = part
	local function layer(row: number, z: number): ImageLabel
		local l = Instance.new("ImageLabel")
		l.Size = UDim2.fromScale(1, 1)
		l.BackgroundTransparency = 1
		l.Image = image
		l.ImageRectSize = cell
		l.ImageRectOffset = Vector2.new(0, row * cell.Y)
		l.ZIndex = z
		l.Parent = gui
		return l
	end
	local sprite = { part = part, diffuse = layer(0, 1), back = layer(1, 2), image = image }
	part.Parent = folder
	return sprite
end

-- One sprite this frame (in the set's next slot): `world` its middle, w x h studs, its sheet,
-- grey (0-1, the shade it takes), alpha (0-1, its share shown).
local function put(set: Set, kind: string, sheet: string, world: Vector3, w: number, h: number, grey: number, alpha: number, ctx: any, place: any, sun: Vector3, tint: Color3)
	if alpha <= 0.02 or sheet == "" then
		return
	end
	set.used += 1
	local cell = if kind == "fringe" then Vector2.new(512, 256) else Vector2.new(256, 256)
	local sprite = set.sprites[set.used]
	if not sprite or sprite.image ~= sheet then
		if sprite then
			sprite.part:Destroy()
		end
		sprite = newSprite(set.folder, sheet, cell)
		set.sprites[set.used] = sprite
	end
	local cam = ctx.camPos
	local drawn, k = place(world, math.max(w, h))
	sprite.part.Size = Vector3.new(w * k, h * k, 0.2)
	sprite.part.CFrame = CFrame.lookAt(drawn, Vector3.new(cam.X, drawn.Y, cam.Z))
	-- back light: the sun behind it, seen from the camera
	local view = Vector3.new(world.X - cam.X, 0, world.Z - cam.Z)
	local flatSun = Vector3.new(sun.X, 0, sun.Z)
	local back = 0
	if view.Magnitude > 1 and flatSun.Magnitude > 1e-3 and sun.Y > -0.05 then
		back = smooth01(view.Unit:Dot(flatSun.Unit)) * (1 - smooth01((sun.Y - 0.4) / 0.4))
	end
	local c = Color3.new(math.min(1, grey * tint.R), math.min(1, grey * tint.G), math.min(1, grey * tint.B))
	local t = math.floor((1 - alpha) * 20 + 0.5) / 20
	sprite.diffuse.ImageColor3 = c
	sprite.diffuse.ImageTransparency = t
	sprite.back.ImageColor3 = c
	sprite.back.ImageTransparency = 1 - (1 - t) * back * W.backShare
end

local function pick(list: { string }, id: string, slot: number): string
	if #list == 0 then
		return ""
	end
	return list[1 + math.floor(hash(id, slot, 31) * #list) % #list]
end

function StormWisps.draw(s: any, ctx: any, place: any, tint: Color3)
	if not W.enabled then
		return
	end
	local id = s.id
	local set = sets[id]
	if not set then
		local folder = Instance.new("Folder")
		folder.Name = "StormWisps_" .. id
		folder.Parent = ctx.parent
		set = { folder = folder, sprites = {}, used = 0 }
		sets[id] = set
	end
	set.used = 0
	local km, sky = ctx.km, ctx.sky
	local up = s.updraft
	local ground = s.groundStuds or 0
	local centre = ctx.at(up.xKm, up.yKm, ground)
	local baseY = ground + up.baseM * sky
	local bottom = baseY - K.base.thicknessM * sky * K.base.hang
	local Rb = math.max(s.base.radiusKm * km, math.max(up.radiusKm, 0.5) * km)
	local sun = Lighting:GetSunDirection()
	local fade = math.clamp(s.life and s.life.fade or 0, 0, 1)
	if fade > 0 then
		return -- (an orphan anvil: no base left)
	end
	local clock = ctx.clock

	-- Fringe round the base's rim (its solid top band tucked up inside the base) (a cell) or along a line's leading edge
	local F = W.fringe
	local line = s.line
	local share = if line then math.clamp((line.share - K.line.fromShare) / (1 - K.line.fromShare), 0, 1) else 0
	local half = if line then line.halfLengthKm * km * share else 0
	local heightF = F.heightM * sky
	if half > 2 * Rb then
		local axis = ctx.heading(line.axisBearingDeg)
		local across = Vector3.new(-axis.Z, 0, axis.X)
		local motion = Vector3.new(s.eastKph or 0, 0, -(s.northKph or 0))
		if motion.Magnitude > 1 and across:Dot(motion) < 0 then
			across = -across
		end
		local n = math.min(F.max, math.ceil(2 * half / (F.widthKm * km)))
		for i = 1, n do
			local u = (i - 0.5) / n * 2 - 1
			for side = -1, 1, 2 do
				local p = centre + axis * (u * half) + across * (side * 0.8 * Rb) + Vector3.new(0, bottom - ground - heightF * 0.2, 0)
				put(set, "fringe", pick(F.sheets, id, i * 2 + side), p, 2 * half / n * 1.35, heightF, W.baseGrey, F.alpha, ctx, place, sun, tint)
			end
		end
	else
		local n = math.min(F.max, math.max(8, math.ceil(TAU * Rb / (F.widthKm * km))))
		for i = 1, n do
			local a = TAU * (i - 0.5) / n + hash(id, i, 32) * 0.2
			local r = Rb * (0.85 + 0.1 * hash(id, i, 33))
			local p = centre + Vector3.new(math.cos(a) * r, bottom - ground - heightF * 0.2, math.sin(a) * r)
			put(set, "fringe", pick(F.sheets, id, i), p, TAU * Rb / n * 1.35, heightF * (0.8 + 0.4 * hash(id, i, 34)), W.baseGrey, F.alpha, ctx, place, sun, tint)
		end
	end

	-- Scud: round the wall cloud (more the stronger it is) and under the base on the inflow side
	local S = W.scud
	local wall = s.wallCloud
	local wallOn = wall and (wall.strength or 0) > 0.05
	local wc = if wallOn then ctx.at(wall.xKm, wall.yKm, ground) else centre
	local bands = s.inflowBands
	local inflow = if bands and (bands.strength or 0) > 0 then ctx.heading(bands.fromDeg) else Vector3.xAxis
	local amount = math.clamp(math.max(if wallOn then wall.strength * 1.4 else 0, (bands and bands.strength or 0), S.least), 0, 1)
	local count = math.floor(S.count * amount)
	local wr = if wallOn then math.max(wall.radiusKm, 0.5) * km else Rb * 0.3
	for i = 1, count do
		local h1, h2, h3 = hash(id, i, 40), hash(id, i, 41), hash(id, i, 42)
		local cycle = S.cycleSeconds * (0.7 + 0.6 * h3)
		local t = (clock / cycle + h1) % 1
		-- where it forms: a ring round the wall cloud, biased to the inflow side; drawn in as it rises
		local a = TAU * h2
		local dir = (Vector3.new(math.cos(a), 0, math.sin(a)) + inflow * S.inflowBias).Unit
		local r0 = wr * (S.from + (S.to - S.from) * hash(id, i, 43))
		local r = r0 * (1 - S.drawIn * t)
		local swirl = (wall and wall.rotation or 0) * S.swirl * t
		local cs, sn = math.cos(swirl), math.sin(swirl)
		local d2 = Vector3.new(dir.X * cs - dir.Z * sn, 0, dir.X * sn + dir.Z * cs)
		local depth = S.depthM * sky * (0.5 + 0.5 * hash(id, i, 44))
		local y = bottom - depth * (1 - t)
		local p = Vector3.new(wc.X, y, wc.Z) + d2 * r
		local size = S.sizeKm * km * (0.6 + 0.8 * hash(id, i, 45))
		local alpha = math.sin(math.pi * t) ^ 0.7 * S.alpha
		put(set, "scud", pick(S.sheets, id, i), p, size, size * (0.8 + 0.6 * hash(id, i, 46)), W.scudGrey, alpha, ctx, place, sun, tint)
	end

	-- (slots not used this frame)
	for i = set.used + 1, #set.sprites do
		set.sprites[i].part:Destroy()
		set.sprites[i] = nil :: any
	end
end

function StormWisps.sweep(alive: { [string]: boolean })
	for id, set in sets do
		if not alive[id] then
			set.folder:Destroy()
			sets[id] = nil
		end
	end
end

return StormWisps
