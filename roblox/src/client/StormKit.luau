--!strict
-- Storms put together from the cloud kit (shared/Weather/CloudKit): copies of a dozen reusable
-- pieces, placed, sized, tinted and faded from each storm's fields. Every storm in view is drawn
-- this way (the pieces are shared meshes, so there is no per-storm mesh budget).
--
-- What goes where (all from the feed):
--   tower    body pieces stacked from the base (updraft.baseM) up toward the anvil, a cap on top;
--            as wide as the updraught; leaning downwind; a young (towering) tower has a big cap
--            and little anvil, a collapsing one (decay) slims and frays
--   anvil    sections spreading downwind (anvil.bearingDeg, lengthKm, widthKm) at anvil.topM;
--            mammatus panels under it (anvil.mammatus)
--   base     slabs under the updraught (base.radiusKm), a wall cloud where the feed has one
--   shelf    segments along the gust front: in a row along a line, round an arc ahead of a cell
--   line     a line storm (line.share): towers in a row along the line's axis (halfLengthKm),
--            base and shelf the whole length, bowing forward (line.bow)
--   orphan   an anvil left after the storm died (life.fade): the anvil only, thinning out
--
-- Drawn as a scaled copy along the view (like CloudShell): a point P shows at
-- cam + (P - cam) * scale, which looks the same from the camera, so pieces kilometres across fit
-- in parts (at most 2048 studs a side). One scale for every storm keeps them in order in depth.
--
--   StormKit.draw(s, ctx)       -- each frame, each storm in view
--   StormKit.sweep(alive)       -- after: storms not drawn this frame give their parts back
local Workspace = game:GetService("Workspace")
local Lighting = game:GetService("Lighting")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("World"):WaitForChild("Config"))
local CloudKit = require(Shared:WaitForChild("Weather"):WaitForChild("CloudKit"))
local SkyLight = require(script.Parent.SkyLight)
local VaporRelight = require(script.Parent.VaporRelight)
local StormWisps = require(script.Parent.StormWisps)

local StormKit = {}

local K = Config.STORM_KIT
local TAU = math.pi * 2

export type Context = {
	at: (number, number, number) -> Vector3,
	heading: (number) -> Vector3,
	km: number,
	sky: number,
	camPos: Vector3,
	clock: number,
	parent: Instance,
}

-- One piece of a storm: its kind's piece, the unit box (bottom middle, facing) relative to the
-- storm's middle, its size, colour and transparency.
type Piece = { name: string, cf: CFrame, size: Vector3, colour: Color3, transparency: number, spin: number? }

type Set = {
	folder: Folder,
	parts: { [number]: MeshPart },
	names: { [number]: string },
	born: { [number]: number }, -- when the slot's part appeared (it grows in)
	sprites: { [number]: Vapor }, -- slots drawn as baked vapor instead of a mesh
	seenAt: number, -- when the storm was first drawn
	pieces: { Piece },
	from: Vector3, -- where the storm's middle was when the pieces were laid out
	shapedAt: number,
}
local sets: { [string]: Set } = {}

local function smooth01(x: number): number
	x = math.clamp(x, 0, 1)
	return x * x * (3 - 2 * x)
end

-- A steady pseudo-random number 0..1 for a storm and a slot (the same every layout, so pieces
-- don't jump about when the storm is laid out again).
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

local function pick(id: string, kind: string, slot: number): string?
	local names = CloudKit.names(kind)
	if #names == 0 then
		return nil
	end
	return names[1 + math.floor(hash(id, slot, 11) * #names) % #names]
end

local function lifeOf(s: any): (number, number, number)
	local L = s.life
	if not L then
		return 0, 0, 0
	end
	return math.clamp(L.towering or 0, 0, 1), math.clamp(L.decay or 0, 0, 1), math.clamp(L.fade or 0, 0, 1)
end

-- Grey of a kind (its albedo), shaded where the anvil is over it from the sun.
local function tint(albedo: number, shade: number): Color3
	local g = albedo * shade
	return Color3.new(g, g, g * 1.02)
end

-- The layout ------------------------------------------------------------------------------------

local function layout(s: any, ctx: Context): { Piece }
	local out: { Piece } = {}
	local id = s.id
	local slot = 0
	local function add(kind: string, cf: CFrame, size: Vector3, albedo: number, transparency: number, shade: number?)
		slot += 1
		local name = pick(id, kind, slot)
		if not name then
			return
		end
		table.insert(out, { name = name, cf = cf, size = size, colour = tint(albedo, shade or 1), transparency = transparency })
	end
	local up, A = s.updraft, s.anvil
	local km, sky = ctx.km, ctx.sky
	local towering, decay, fade = lifeOf(s)
	local fadeT = math.clamp(fade, 0, 1)
	local R = math.max(up.radiusKm, 0.5) * km
	local baseY = up.baseM * sky -- (relative to the ground at the storm)
	local anvilTop = A.topM * sky
	local anvilThick = K.anvil.thicknessM * sky * (1 - 0.6 * fadeT)
	local downwind = ctx.heading(A.bearingDeg)
	local function facing(dir: Vector3, pos: Vector3, yaw: number?): CFrame
		local cf = CFrame.lookAt(pos, pos + dir)
		return if yaw then cf * CFrame.Angles(0, yaw, 0) else cf
	end
	-- is a point (relative) under the anvil? (the anvil shades it from the sun)
	local sun = Lighting:GetSunDirection()
	local anvilLen = A.lengthKm * km * K.anvil.lengthShare
	local anvilHalfW = 0.5 * math.max(A.widthKm * km, 2 * R)
	local function shade(p: Vector3): number
		if sun.Y < 0.05 then
			return 1
		end
		local q = p + sun * ((anvilTop - anvilThick - p.Y) / sun.Y) -- where the ray to the sun meets the anvil's bottom
		local x = q:Dot(downwind)
		local side = math.abs(q:Dot(Vector3.new(-downwind.Z, 0, downwind.X)))
		if x < -R or x > anvilLen or p.Y > anvilTop - anvilThick then
			return 1
		end
		local inside = 1 - smooth01((side - 0.8 * anvilHalfW) / (0.4 * anvilHalfW))
		return 1 - K.light.anvilShadow * inside * (1 - 0.6 * smooth01(x / anvilLen))
	end

	-- the line, if it is one: its axis and half length (as much as its linear share says)
	local line = s.line
	local share = if line then math.clamp((line.share - K.line.fromShare) / (1 - K.line.fromShare), 0, 1) else 0
	local half = if line then line.halfLengthKm * km * share else 0
	local isLine = half > 2 * R
	local axis = if line then ctx.heading(line.axisBearingDeg) else Vector3.xAxis
	local across = Vector3.new(-axis.Z, 0, axis.X)
	local motion = Vector3.new(s.eastKph or 0, 0, -(s.northKph or 0))
	if motion.Magnitude > 1 and across:Dot(motion) < 0 then
		across = -across -- (across: the way the line moves)
	end
	local bow = if line then math.clamp(line.bow or 0, 0, 1) * K.line.bowShare else 0
	-- a point u (-1..1) along the line, pushed forward by its bow
	local function onLine(u: number): Vector3
		return axis * (u * half) + across * (bow * half * (1 - u * u))
	end

	-- Towers: one for a cell, a row along a line (heights varied a little, the tallest where the
	-- updraught is strongest: the middle)
	local towers: { { pos: Vector3, r: number, top: number } } = {}
	if fadeT <= 0 then
		local top = math.min(up.topM, A.topM + (up.overshootM or 0)) * sky
		if isLine then
			local n = math.max(2, math.floor(2 * half / (K.line.cellSpacingKm * km)))
			for i = 1, n do
				local u = (i - 0.5) / n * 2 - 1
				local j = hash(id, i, 3)
				local r = R * (K.line.towerWidth + 0.4 * j) * (1 - 0.25 * math.abs(u))
				table.insert(towers, { pos = onLine(u + (hash(id, i, 4) - 0.5) / n) - across * (0.3 * R), r = r, top = baseY + (top - baseY) * (0.75 + 0.25 * j) * (1 - 0.2 * u * u) })
			end
		else
			table.insert(towers, { pos = Vector3.zero, r = R, top = top })
		end
	end
	local slim = 1 - K.life.decaySlim * decay
	local fray = K.life.decayFray * decay
	for ti, tw in towers do
		local r = tw.r * slim
		local H = math.max(tw.top - baseY, 200)
		-- a young tower: a big cap on a short body; a mature one: a tall body under a smaller cap
		local capShare = K.tower.capShare + (K.tower.youngCapShare - K.tower.capShare) * towering
		local capH = H * capShare
		local bodyH = H - capH
		-- (body pieces about as tall as they are wide: squashed flat, they stack like plates)
		local segs = math.max(1, math.ceil(bodyH / (K.tower.segmentAspect * 2 * r)))
		local segH = bodyH / segs
		local lean = downwind * (K.tower.lean * H)
		for k = 1, segs do
			local f = (k - 1) / segs
			-- (from the base up: overlapping the next piece above, never hanging below the base)
			local p = tw.pos + lean * f + Vector3.new(0, baseY + (k - 1) * segH, 0)
			local w = 2 * r * (1 - K.tower.taper * f) * (0.92 + 0.16 * hash(id, ti * 50 + k, 5))
			add("tower_body", facing(downwind, p, hash(id, ti * 50 + k, 6) * TAU), Vector3.new(w, segH * 1.3, w), K.albedo.tower, fray, 1) -- (the tower: Roblox's light shades it by the sun's direction)
		end
		local p = tw.pos + lean + Vector3.new(0, baseY + bodyH - capH * 0.25, 0)
		local w = 2 * r * (1 - K.tower.taper) * K.tower.capWidth * (1 + 0.3 * towering)
		add("tower_cap", facing(downwind, p, hash(id, ti, 7) * TAU), Vector3.new(w, capH * 1.25, w * 0.9), K.albedo.tower, fray, 1)
		-- cauliflower on cauliflower: smaller domes clustered round the top and bulging out of the
		-- column's sides (each a cap piece), so the tower is many overlapping lobes, not a few
		-- big smooth shapes (real towers: 01_classic_supercell_b, 13_towering_cumulus_*)
		local C = K.tower.cluster
		local nTop = math.floor(C.top * (1 + 0.5 * towering) + 0.5)
		for k = 1, nTop do
			local h1, h2, h3 = hash(id, ti * 70 + k, 50), hash(id, ti * 70 + k, 51), hash(id, ti * 70 + k, 52)
			local a = TAU * h1
			local sz = w * (C.topSize[1] + (C.topSize[2] - C.topSize[1]) * h2)
			local off = Vector3.new(math.cos(a), 0, math.sin(a)) * (w * 0.5 * C.topSpread * (0.4 + 0.6 * h3))
			local y = baseY + bodyH - capH * 0.1 + capH * (0.15 + 0.6 * hash(id, ti * 70 + k, 53))
			local pk = tw.pos + lean + off + Vector3.new(0, y - sz * 0.45, 0)
			add("tower_cap", facing(downwind, pk, h1 * TAU * 3), Vector3.new(sz, sz * 0.85, sz), K.albedo.tower, fray, 1)
		end
		for k = 1, segs do
			for j = 1, C.side do
				local h1, h2 = hash(id, ti * 90 + k * 7 + j, 54), hash(id, ti * 90 + k * 7 + j, 55)
				local f = (k - 0.5) / segs
				local rr = r * (1 - K.tower.taper * f)
				local a = TAU * h1
				local sz = 2 * rr * (C.sideSize[1] + (C.sideSize[2] - C.sideSize[1]) * h2)
				local off = Vector3.new(math.cos(a), 0, math.sin(a)) * (rr * C.sideOut)
				local pk = tw.pos + lean * f + off + Vector3.new(0, baseY + (k - 0.5 + (h2 - 0.5) * 0.6) * segH - sz * 0.4, 0)
				add("tower_cap", facing(downwind, pk, h2 * TAU * 5), Vector3.new(sz, sz * 0.8, sz), K.albedo.tower, fray, 1)
			end
		end
	end

	-- Anvil: sections downwind of the tower(s), from where they reach it
	local grown = 0.12 + 0.88 * smooth01((1 - towering) / 0.8)
	local anvilT = math.clamp(fadeT * 1.1, 0, 0.95)
	if anvilLen * grown > R then
		local sec = K.anvil.sectionKm * km
		local L = math.max(anvilLen * grown, 2 * R)
		local rows = math.max(1, math.ceil(L / (sec * 0.7)))
		-- across: the line's length, or the anvil's width for a cell
		local spanAcross = if isLine then 2 * half else 2 * anvilHalfW * grown
		local crossAxis = if isLine then axis else Vector3.new(-downwind.Z, 0, downwind.X)
		for i = 1, rows do
			local x = (i - 0.5) / rows * L - R * 0.5
			local f = math.clamp(x / L, 0, 1)
			-- (narrow at the tower, spreading downwind, for a cell)
			local width = if isLine then spanAcross else math.max(2 * R, spanAcross * (K.anvil.rootWidth + (1 - K.anvil.rootWidth) * math.sqrt(f)))
			local cols = math.max(1, math.ceil(width / (sec * 0.75)))
			for j = 1, cols do
				local c = ((j - 0.5) / cols - 0.5) * width
				local slotSeed = i * 97 + j
				local thick = anvilThick * (1 - K.anvil.thinning * f) * (0.85 + 0.3 * hash(id, slotSeed, 8))
				local p = downwind * x + crossAxis * c + Vector3.new(0, anvilTop - thick, 0)
				local size = Vector3.new(sec * (1.1 + 0.3 * hash(id, slotSeed, 9)), thick, sec * (1.0 + 0.3 * hash(id, slotSeed, 10)))
				add("anvil", facing(downwind, p, (hash(id, slotSeed, 12) - 0.5) * 0.6), size, K.albedo.anvil, math.max(anvilT, K.anvil.edgeFade * f), 1)
			end
		end
		-- mammatus under the anvil
		local mam = A.mammatus or 0
		if mam > K.mammatus.from and fadeT < 0.8 then
			local n = math.max(1, math.floor(mam * K.mammatus.panels))
			for i = 1, n do
				local x = (0.35 + 0.55 * hash(id, i, 13)) * L
				local c = (hash(id, i, 14) - 0.5) * spanAcross * 0.6
				local depth = K.mammatus.depthM * sky * mam
				local p = downwind * x + crossAxis * c + Vector3.new(0, anvilTop - anvilThick - depth, 0)
				add("mammatus", facing(downwind, p, hash(id, i, 15) * TAU), Vector3.new(sec * 0.8, depth * 1.2, sec * 0.8), K.albedo.mammatus, anvilT, 1)
			end
		end
	end
	if fadeT > 0 then
		return out -- an orphan anvil: nothing under it any more
	end

	-- Base: slabs under the updraught (the whole line for a line)
	local Rb = math.max(s.base.radiusKm * km, R)
	local baseThick = K.base.thicknessM * sky
	if isLine then
		local n = math.max(1, math.ceil(2 * half / (K.base.sectionKm * km * 0.7)))
		for i = 1, n do
			local u = (i - 0.5) / n * 2 - 1
			local p = onLine(u) - across * (0.2 * Rb) + Vector3.new(0, baseY - baseThick * K.base.hang, 0)
			add("base", facing(across, p, (hash(id, i, 16) - 0.5) * 0.4), Vector3.new(K.base.sectionKm * km * 1.3, baseThick, 2 * Rb), K.albedo.base, fray, shade(p))
		end
	else
		-- (one slab, or a 2 x 2 group of overlapping ones when it would be too big for a part)
		local n = if 2 * Rb > K.base.sectionKm * km * 1.3 then 2 else 1
		for i = 1, n do
			for j = 1, n do
				local off = if n == 1 then Vector3.zero else Vector3.new((i - 1.5) * Rb, 0, (j - 1.5) * Rb) * 0.9
				local p = off + Vector3.new(0, baseY - baseThick * K.base.hang, 0)
				local w = 2 * Rb / n * (if n == 1 then 1 else 1.35)
				add("base", facing(downwind, p, hash(id, i * 3 + j, 17) * TAU), Vector3.new(w, baseThick, w), K.albedo.base, fray, shade(p))
			end
		end
	end
	-- the wall cloud
	local wall = s.wallCloud
	if wall and (wall.strength or 0) > K.wall.from then
		local wc = ctx.at(wall.xKm, wall.yKm, 0) - ctx.at(up.xKm, up.yKm, 0)
		local lower = math.max(wall.loweringM or 0, K.wall.minM) * sky * smooth01(wall.strength / 0.3)
		local w = 2 * math.max(wall.radiusKm, 0.4) * km
		local p = Vector3.new(wc.X, baseY - lower, wc.Z)
		add("wall_cloud", facing(downwind, p, hash(id, 1, 18) * TAU), Vector3.new(w, lower + baseThick, w), K.albedo.wall, 0, shade(p))
		-- (turning slowly, as the feed's rotation says)
		out[#out].spin = (wall.rotation or 0) * K.wall.spin
	end

	-- Shelf: segments along the gust front
	local sh, gf = s.shelf, s.gustFront
	local strength = math.clamp((sh.strength or 0) / K.shelf.fullStrength, 0, 1)
	if (sh.strength or 0) > K.shelf.minStrength then
		-- the shelf rides the leading edge, out ahead of it as far as the outflow has surged
		-- (detached), at most maxLeadKm
		local lead = R + (sh.detached or 0) * math.min((gf.leadKm or 0) * km, K.shelf.maxLeadKm * km)
		local depth = K.shelf.depthKm * km * (0.6 + 0.4 * strength)
		local noseY = math.max(sh.heightM or 600, 200) * sky * K.shelf.noseShare
		local topY = baseY + K.shelf.riseM * sky * strength
		local segLen = K.shelf.segmentKm * km
		local function segment(i: number, pos: Vector3, fwd: Vector3, len: number)
			local p = pos + fwd * lead - fwd * depth * 0.5 + Vector3.new(0, noseY * 0.6, 0)
			local size = Vector3.new(len * (1.25 + 0.2 * hash(id, i, 19)), topY - noseY * 0.6, depth * (0.9 + 0.2 * hash(id, i, 20)))
			add("shelf", facing(fwd, p, (hash(id, i, 21) - 0.5) * 0.12), size, K.albedo.shelf, 0, shade(p))
		end
		if isLine or (sh.halfArcDeg or 0) <= 0 then
			local len = if isLine then 2 * half else math.max(2 * R, 8 * km)
			local n = math.max(1, math.ceil(len / segLen))
			for i = 1, n do
				local u = (i - 0.5) / n * 2 - 1
				local fdir = ctx.heading(sh.facingDeg)
				local pos = if isLine then onLine(u * len / (2 * half)) else Vector3.new(-fdir.Z, 0, fdir.X) * (u * len / 2)
				-- (facing out from the line: square to it, turned with the bow)
				local slope = if isLine then -2 * bow * u else 0
				local fwd = (across + axis * slope).Unit
				segment(i, pos, if isLine then fwd else fdir, len / n)
			end
		else
			local arc = math.rad(math.max(sh.halfArcDeg, 10))
			local centreDir = ctx.heading(sh.facingDeg)
			local a0 = math.atan2(centreDir.Z, centreDir.X)
			local arcLen = 2 * arc * (R + lead)
			local n = math.max(1, math.ceil(arcLen / segLen))
			for i = 1, n do
				local a = a0 + ((i - 0.5) / n * 2 - 1) * arc
				local fwd = Vector3.new(math.cos(a), 0, math.sin(a))
				segment(i, Vector3.zero, fwd, arcLen / n)
			end
		end
	end
	return out
end

-- Vapor ------------------------------------------------------------------------------------------
-- The puffy pieces (tower caps and bodies, anvils, mammatus) as baked volumetric renders
-- (tools/blender/cloud_vapor_bake.py): a camera-facing image filling the piece's box, one sheet a
-- piece of four lights (2 x 2 cells: lit with the sun behind the viewer, side with it to the
-- left, back with it behind the cloud, high with it overhead), blended by where the sun is. The
-- image covers the box plus a margin (STORM_KIT.vapor.margin of the box each side).
export type Vapor = { part: Part, layers: { [string]: ImageLabel }, name: string, sheet: string, relit: boolean }
local CELLS = { lit = Vector2.new(0, 0), side = Vector2.new(1, 0), back = Vector2.new(0, 1), high = Vector2.new(1, 1) }

local function newVapor(parent: Instance, name: string, image: string): Vapor
	local V = K.vapor
	local part = Instance.new("Part")
	part.Anchored, part.CanCollide, part.CanQuery, part.CanTouch, part.CastShadow = true, false, false, false, false
	part.Transparency = 1
	part.Name = "vapor_" .. name
	local gui = Instance.new("SurfaceGui")
	gui.Face = Enum.NormalId.Front
	gui.SizingMode = Enum.SurfaceGuiSizingMode.FixedSize
	gui.CanvasSize = Vector2.new(V.cell, V.cell)
	gui.LightInfluence = 0 -- (lit by the bake; tinted for the time of day)
	gui.Brightness = V.brightness
	gui.Parent = part
	local layers = {}
	for i, key in { "back", "side", "high", "lit" } do
		local l = Instance.new("ImageLabel")
		l.Size = UDim2.fromScale(1, 1)
		l.BackgroundTransparency = 1
		l.Image = image
		l.ImageRectSize = Vector2.new(V.cell, V.cell)
		l.ImageRectOffset = CELLS[key] * V.cell
		l.ImageTransparency = 1
		l.ZIndex = i
		l.Parent = gui
		layers[key] = l
	end
	part.Parent = parent
	return { part = part, layers = layers, name = name, sheet = image, relit = false }
end

-- How much of each light a piece seen along `view` (camera to piece, unit) gets, the sun toward
-- `sun`; and whether the side light comes from the right (the image mirrored).
local function lightMix(view: Vector3, sun: Vector3): ({ [string]: number }, boolean)
	local flatView = Vector3.new(view.X, 0, view.Z)
	flatView = if flatView.Magnitude > 1e-3 then flatView.Unit else Vector3.zAxis
	local flatSun = Vector3.new(sun.X, 0, sun.Z)
	local c = if flatSun.Magnitude > 1e-3 then flatSun.Unit:Dot(-flatView) else 0 -- 1: sun behind the viewer
	local right = flatView:Cross(flatSun).Y < 0
	local high = smooth01((sun.Y - K.vapor.highFrom) / (K.vapor.highTo - K.vapor.highFrom))
	local lit, back = math.max(c, 0), math.max(-c, 0)
	local side = 1 - math.abs(c)
	return { lit = lit * (1 - high), side = side * (1 - high), back = back * (1 - high), high = high }, right
end

-- The image stands upright facing the camera through the box's middle, as big as the box looks
-- from the camera (its corners projected onto that plane: a flat anvil or base seen from below
-- covers its whole footprint, not just its thickness), plus the bake's margin.
local function drawVapor(v: Vapor, box: CFrame, size: Vector3, cam: Vector3, k: number, colour: Color3, sun: Vector3, tint: Color3, maxTall: number?, relit: Content?)
	local V = K.vapor
	local centre = box * Vector3.new(0, size.Y / 2, 0)
	local flat = Vector3.new(centre.X - cam.X, 0, centre.Z - cam.Z)
	local fwd = if flat.Magnitude > 1 then flat.Unit else Vector3.zAxis
	local right = Vector3.yAxis:Cross(fwd).Unit
	local depth = (centre - cam):Dot(fwd)
	local minR, maxR, minU, maxU = math.huge, -math.huge, math.huge, -math.huge
	for _, cx in { -0.5, 0.5 } do
		for _, cy in { 0, 1 } do
			for _, cz in { -0.5, 0.5 } do
				local c = box * Vector3.new(cx * size.X, cy * size.Y, cz * size.Z)
				local along = (c - cam):Dot(fwd)
				if along > 1 then
					local q = cam + (c - cam) * (depth / along) - centre
					local r, u = q:Dot(right), q.Y
					minR, maxR = math.min(minR, r), math.max(maxR, r)
					minU, maxU = math.min(minU, u), math.max(maxU, u)
				end
			end
		end
	end
	if minR > maxR then
		return -- (the box is behind the camera)
	end
	-- (a near box seen from right beside it projects huge: no wider than V.maxStretch x its size)
	local w = math.min(maxR - minR, V.maxStretch * math.max(size.X, size.Z)) * (1 + 2 * V.margin)
	local h = math.min(maxU - minU, V.maxStretch * math.max(size.Y, size.X)) * (1 + 2 * V.margin)
	local midU = (minU + maxU) / 2
	if maxTall then
		-- (a dark base or shelf stays a band: seen from below, its footprint spread over the
		-- image made a dark curtain to the horizon; kept to its top part, as the mesh would)
		local cap = maxTall * size.Y * (1 + 2 * V.margin)
		if h > cap then
			midU = maxU - cap / 2
			h = cap
		end
	end
	local mid = centre + right * ((minR + maxR) / 2) + Vector3.new(0, midU, 0)
	local drawn = cam + (mid - cam) * k
	local sz = Vector3.new(math.min(w * k, 2040), math.min(h * k, 2040), 0.2)
	if v.part.Size ~= sz then
		v.part.Size = sz
	end
	v.part.CFrame = CFrame.lookAt(drawn, drawn - fwd)
	local g0 = (colour.R + colour.G + colour.B) / 3
	if relit then
		-- relit live (VaporRelight): one image, lit for this sun already
		local lit = v.layers.lit
		if not v.relit then
			v.relit = true
			for key, l in v.layers do
				l.ImageTransparency = if key == "lit" then 0 else 1
			end
			lit.ImageRectSize = Vector2.zero
			lit.ImageRectOffset = Vector2.zero
			lit.ZIndex = 3
		end
		lit.ImageContent = relit
		local c = Color3.new(g0, g0, g0)
		if lit.ImageColor3 ~= c then
			lit.ImageColor3 = c
		end
		return
	elseif v.relit then
		-- back to the baked sheet
		v.relit = false
		local lit = v.layers.lit
		lit.Image = v.sheet
		lit.ImageRectSize = Vector2.new(V.cell, V.cell)
		lit.ImageRectOffset = CELLS.lit * V.cell
	end
	local view = centre - cam
	local mix, right = lightMix(if view.Magnitude > 1 then view.Unit else Vector3.zAxis, sun)
	-- the two strongest lights: the stronger underneath, solid; the other over it as much as it
	-- counts (stacked images aren't a true blend, but close where both are thick)
	local order = { "lit", "side", "back", "high" }
	table.sort(order, function(a, b)
		return mix[a] > mix[b]
	end)
	local first, second = order[1], order[2]
	local share = mix[second] / math.max(mix[first] + mix[second], 1e-3)
	local g = (colour.R + colour.G + colour.B) / 3
	local c3 = Color3.new(math.min(1, tint.R * g), math.min(1, tint.G * g), math.min(1, tint.B * g))
	for key, l in v.layers do
		local t = if key == first then 0 elseif key == second then 1 - share else 1
		t = math.floor(t * 20 + 0.5) / 20
		if l.ImageTransparency ~= t then
			l.ImageTransparency = t
		end
		local z = if key == first then 1 elseif key == second then 2 else 0
		if l.ZIndex ~= z then
			l.ZIndex = z
		end
		if l.ImageColor3 ~= c3 then
			l.ImageColor3 = c3
		end
	end
	-- (the side light mirrored when the sun is on the right: a negative rect flips the image)
	local side = v.layers.side
	local wantSize = Vector2.new(if right then -V.cell else V.cell, V.cell)
	if side.ImageRectSize ~= wantSize then
		side.ImageRectSize = wantSize
		side.ImageRectOffset = CELLS.side * V.cell + Vector2.new(if right then V.cell else 0, 0)
	end
end

-- The bake's light against today's: dimmer with less daylight, warmer as the sun lowers.
local function vaporTint(sun: Vector3): Color3
	local elev = math.clamp(sun.Y, -0.2, 1)
	local day = 0.12 + 0.88 * smooth01((elev + 0.08) / 0.3)
	local low = 1 - smooth01(elev / 0.5)
	local e = K.vapor.exposure * day
	return Color3.new(e, e * (1 - 0.12 * low), e * (1 - 0.3 * low))
end

-- Drawing ----------------------------------------------------------------------------------------

local function newSet(id: string, parent: Instance): Set
	local folder = Instance.new("Folder")
	folder.Name = "StormKit_" .. id
	-- (under the camera: drawn, but outside the physics world, which hundreds of moving parts
	-- otherwise cost)
	folder.Parent = if K.underCamera then Workspace.CurrentCamera else parent
	return { folder = folder, parts = {}, names = {}, born = {}, sprites = {}, seenAt = -1, pieces = {}, from = Vector3.zero, shapedAt = -math.huge }
end

StormKit.stats = { storms = 0, pieces = 0, layoutMs = 0, drawMs = 0, nearer = 0, nearerName = "" }
local framePieces = 0
local wispAlive: { [string]: boolean } = {}
local frameNearer = 0

function StormKit.draw(s: any, ctx: Context)
	if not K.enabled then
		return
	end
	local t0 = os.clock()
	local set = sets[s.id]
	if not set then
		set = newSet(s.id, ctx.parent)
		set.seenAt = ctx.clock
		sets[s.id] = set
	end
	local ground = s.groundStuds or 0
	local here = ctx.at(s.updraft.xKm, s.updraft.yKm, ground)
	if ctx.clock - set.shapedAt >= K.layoutSeconds then
		local tl = os.clock()
		set.pieces = layout(s, ctx)
		set.from = here
		set.shapedAt = ctx.clock
		StormKit.stats.layoutMs += ((os.clock() - tl) * 1000 - StormKit.stats.layoutMs) * 0.2
	end
	-- the pieces, moved with the storm since it was laid out, drawn scaled along the view
	-- (Workspace attributes KitScale / KitFarScale override the two scales, for testing)
	local scale = Workspace:GetAttribute("KitScale") or K.scale
	local farScale = Workspace:GetAttribute("KitFarScale") or K.farScale
	local cam = ctx.camPos
	-- haze by the real distance (the copies are near the camera, so Roblox's own haze barely
	-- touches them): a far piece fades into the sky behind it
	local vis = (SkyLight.visibilityKm() or K.haze.visibilityKm) * ctx.km
	local atmosphere = Lighting:FindFirstChildOfClass("Atmosphere")
	local hazeColour = if atmosphere then atmosphere.Color else K.haze.colour
	local partsToMove, frames = {}, {}
	local sun = Lighting:GetSunDirection()
	local tint = vaporTint(sun)
	-- the live relight's sun and sky light (the bake's tint, split into its two lights)
	local RL = K.vapor.relight
	-- (direct sun only while the sun is up: it fades out as it reaches the horizon; after that the
	-- sky alone lights the cloud)
	local sunUp = smooth01((sun.Y + 0.01) / 0.08)
	local relitSun = Color3.new(tint.R * RL.sun * sunUp, tint.G * RL.sun * sunUp, tint.B * RL.sun * sunUp)
	local day = (tint.R + tint.G + tint.B) / 3
	local relitSky = Color3.new(RL.skyColour.R * RL.sky * day, RL.skyColour.G * RL.sky * day, RL.skyColour.B * RL.sky * day)
	for i, pc in set.pieces do
		local part = set.parts[i]
		local sheet = K.vapor.enabled and K.vapor.sheets[pc.name]
		local useVapor = sheet ~= nil and sheet ~= ""
		local useMesh = not useVapor
		-- (a base, shelf or anvil seen from under it is the mesh: a camera-facing image can't be a
		-- ceiling; vapor from outside its footprint, both near the edge)
		local kind = string.match(pc.name, "^(.-)_%d+$") or pc.name
		if useVapor and K.vapor.outsideOnly[kind] then
			local l = (CFrame.new(here) * pc.cf):PointToObjectSpace(cam)
			local q = math.max(math.abs(l.X) / math.max(pc.size.X / 2, 1), math.abs(l.Z) / math.max(pc.size.Z / 2, 1))
			useMesh = q < 1 + K.vapor.edgeShare
			useVapor = q > 1 - K.vapor.edgeShare
		end
		if useVapor then
			if not useMesh and part then
				part:Destroy()
				set.parts[i] = nil :: any
				set.names[i] = nil :: any
				part = nil
			end
			local v = set.sprites[i]
			if v and v.name ~= pc.name then
				v.part:Destroy()
				v = nil
			end
			if not v then
				v = newVapor(set.folder, pc.name, sheet)
				set.sprites[i] = v
				set.born[i] = if set.seenAt == ctx.clock then -math.huge else ctx.clock
			end
			local grow = smooth01((ctx.clock - (set.born[i] or -math.huge)) / K.growSeconds)
			local pcf = if pc.spin then pc.cf * CFrame.Angles(0, pc.spin * ctx.clock, 0) else pc.cf
			local size = pc.size * math.max(grow, 0.02)
			local box = CFrame.new(here) * pcf
			local centre = box * Vector3.new(0, size.Y / 2, 0)
			local dReal = (centre - cam).Magnitude
			local want = scale + (farScale - scale) * smooth01((dReal - K.farFromKm * ctx.km) / (K.farOverKm * ctx.km))
			local big = math.max(size.X, size.Y, size.Z) * (1 + 2 * K.vapor.margin)
			-- (the bake has the kind's own lightness in it: only the shade on top of it, e.g. under
			-- the anvil, tints the image)
			local albedo = K.albedo[if string.sub(kind, 1, 5) == "tower" then "tower" else kind] or 1
			local c = pc.colour
			local shadeC = Color3.new(math.min(1, c.R / albedo), math.min(1, c.G / albedo), math.min(1, c.B / albedo))
			-- relit live for a near storm's pieces that have a light basis
			local relit: Content? = nil
			local RL = K.vapor.relight
			if RL.enabled and dReal < RL.maxKm * ctx.km and VaporRelight.available(pc.name) then
				local flat = Vector3.new(centre.X - cam.X, 0, centre.Z - cam.Z)
				local fwd = if flat.Magnitude > 1 then flat.Unit else Vector3.zAxis
				local imageRight = fwd:Cross(Vector3.yAxis).Unit
				local sunLocal = Vector3.new(sun:Dot(imageRight), sun.Y, -sun:Dot(fwd))
				relit = VaporRelight.want(s.id .. "/" .. pc.name, pc.name, sunLocal, relitSun, relitSky, ctx.clock)
			end
			drawVapor(v :: Vapor, box, size, cam, math.min(want, 2040 / big), shadeC, sun, tint, K.vapor.maxTall[kind], relit)
			framePieces += 1
			if not useMesh then
				continue
			end
		elseif set.sprites[i] then
			set.sprites[i].part:Destroy()
			set.sprites[i] = nil :: any
		end
		if set.names[i] ~= pc.name then
			if part then
				part:Destroy()
				set.parts[i] = nil :: any
			end
			local copy = CloudKit.copy(pc.name)
			if copy then
				copy.Parent = set.folder
				set.parts[i] = copy
				set.names[i] = pc.name
				-- (a storm seen for the first time is there at once; a piece added later grows in)
				set.born[i] = if set.seenAt == ctx.clock then -math.huge else ctx.clock
				part = copy
			else
				set.names[i] = nil :: any
				continue
			end
		end
		if not part then
			continue
		end
		local grow = smooth01((ctx.clock - (set.born[i] or -math.huge)) / K.growSeconds)
		local pcf = if pc.spin then pc.cf * CFrame.Angles(0, pc.spin * ctx.clock, 0) else pc.cf
		local cf, size = CloudKit.fit(pc.name, CFrame.new(here) * pcf, pc.size * math.max(grow, 0.02))
		if not (cf and size) then
			continue
		end
		-- (a piece too big for a part at this scale is drawn nearer: along its view rays it looks
		-- the same, it only sorts a little differently in depth)
		-- the scale grows with the real distance: near pieces small and near (big pieces drawn far
		-- out overhead cost 4x the frame time), far ones further out, where Roblox's own haze
		-- reaches them (d x scale(d) only grows with d, so pieces keep their order in depth)
		local dReal = (cf.Position - cam).Magnitude
		local want = scale + (farScale - scale) * smooth01((dReal - K.farFromKm * ctx.km) / (K.farOverKm * ctx.km))
		local k = math.min(want, 2040 / math.max(size.X, size.Y, size.Z))
		if k < want then
			frameNearer += 1
			StormKit.stats.nearerName = pc.name
		end
		local drawn = cam + (cf.Position - cam) * k
		local sz = size * k
		if part.Size ~= sz then
			part.Size = sz
		end
		-- haze by the real distance (f: the share of the haze's light): the piece's own light
		-- dimmed by (1 - f), the haze's added as an emissive glow (SurfaceAppearance: the glow
		-- is added to the lighting, then x the colour, so it is divided by the colour here). The
		-- piece stays solid (transparency showed the lobes behind lobes, glassy).
		local d = (cf.Position - cam).Magnitude
		local f = math.floor(K.haze.most * (1 - math.exp(-d / vis)) * 40 + 0.5) / 40
		local colour = pc.colour
		if K.haze.mode == "emissive" then
			colour = Color3.new(colour.R * (1 - f), colour.G * (1 - f), colour.B * (1 - f))
			local sa: any = part:FindFirstChildOfClass("SurfaceAppearance")
			if not sa then
				sa = Instance.new("SurfaceAppearance")
				sa.Parent = part
			end
			local a = math.max((colour.R + colour.G + colour.B) / 3, 0.03)
			local strength = f * K.haze.strength / a
			if sa.EmissiveStrength ~= strength then
				sa.EmissiveStrength = strength
				sa.EmissiveTint = hazeColour
			end
			if sa.Color ~= colour then
				sa.Color = colour -- (with a SurfaceAppearance, its tint is the colour)
			end
		end
		if part.Color ~= colour then
			part.Color = colour
		end
		local tq = if K.haze.mode == "transparency" then math.floor((1 - (1 - pc.transparency) * (1 - f)) * 50 + 0.5) / 50 else pc.transparency
		if part.Transparency ~= tq then
			part.Transparency = tq
		end
		table.insert(partsToMove, part)
		table.insert(frames, cf.Rotation + drawn)
	end
	-- (pieces no longer in the layout)
	for i, v in set.sprites do
		if i > #set.pieces then
			v.part:Destroy()
			set.sprites[i] = nil :: any
		end
	end
	for i = #set.pieces + 1, #set.parts do
		local part = set.parts[i]
		if part then
			part:Destroy()
		end
		set.parts[i] = nil :: any
		set.names[i] = nil :: any
	end
	if #partsToMove > 0 then
		Workspace:BulkMoveTo(partsToMove, frames, Enum.BulkMoveMode.FireCFrameChanged)
	end
	-- scud and wisps under a near storm's base (StormWisps), drawn by the same rule as the pieces
	if (here - cam).Magnitude < K.wisp.maxKm * ctx.km then
		StormWisps.draw(s, ctx, function(world: Vector3, big: number): (Vector3, number)
			local d = (world - cam).Magnitude
			local want = scale + (farScale - scale) * smooth01((d - K.farFromKm * ctx.km) / (K.farOverKm * ctx.km))
			local k = math.min(want, 2040 / math.max(big, 1))
			return cam + (world - cam) * k, k
		end, tint)
		wispAlive[s.id] = true
	end
	framePieces += #partsToMove
	StormKit.stats.drawMs += ((os.clock() - t0) * 1000 - StormKit.stats.drawMs) * 0.1
end

-- Detail puffs on the storm's pieces (StormMesh draws them, for the nearest storm): points on
-- each piece's open surface (CloudKit.samples), world position and normal where the storm is now,
-- the puff's size (studs) and the piece's albedo and transparency. The puffs soften the pieces'
-- hard silhouettes and add fine cauliflower over the big lobes.
export type PuffPoint = { world: Vector3, normal: Vector3, size: number, albedo: number, transparency: number }
function StormKit.puffPoints(s: any, ctx: Context): { PuffPoint }
	local out: { PuffPoint } = {}
	local set = sets[s.id]
	if not set or not K.detail or not K.detailOn then
		return out
	end
	local here = ctx.at(s.updraft.xKm, s.updraft.yKm, s.groundStuds or 0)
	for _, pc in set.pieces do
		local kind = string.match(pc.name, "^(.-)_%d+$") or pc.name
		local spec = K.detail[kind]
		if spec and CloudKit.ready(pc.name) then
			local cf = CFrame.new(here) * pc.cf
			local maxSize = spec.maxKm * ctx.km
			local size = math.min(maxSize, spec.share * math.min(pc.size.X, pc.size.Z))
			local albedo = (pc.colour.R + pc.colour.G + pc.colour.B) / 3
			for _, smp in CloudKit.samples(pc.name, spec.count, spec.minAo) do
				local world, normal = CloudKit.surface(pc.name, cf, pc.size, smp.p, smp.n)
				if world and normal and (spec.below == nil or normal.Y < spec.below) then
					table.insert(out, { world = world, normal = normal, size = size, albedo = albedo, transparency = pc.transparency })
				end
			end
		end
	end
	return out
end

function StormKit.sweep(alive: { [string]: boolean })
	VaporRelight.step(os.clock())
	StormWisps.sweep(wispAlive)
	wispAlive = {}
	local n = 0
	for id, set in sets do
		if not alive[id] then
			set.folder:Destroy()
			sets[id] = nil
		else
			n += 1
		end
	end
	StormKit.stats.storms = n
	StormKit.stats.pieces = framePieces
	StormKit.stats.nearer = frameNearer
	framePieces, frameNearer = 0, 0
end

return StormKit
