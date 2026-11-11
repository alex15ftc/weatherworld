--!strict
-- A storm's cloud body as stacked cloud meshes (2026-11-07; the user's reference: devforum "How can
-- I make a supercell thunderstorm", which builds one from Roblox's stock cloud mesh 1095708 at
-- different sizes, shaded top to bottom). The pieces are PuffView's (PuffView.layout): one leaf's
-- cloud run at one height each, placed, sized and lit from the engine frame - nothing here decides
-- where cloud is. Only how each piece is drawn differs from the billboards:
--   shape    the stock cloud mesh, its box the piece's size (MESH_GROW of the puff's: a mesh fills
--            its box), wider than tall and overlapping, turned about the vertical by its seeded yaw
--   light    Roblox's own lighting shades each lump (sunlit tops, darker undersides, which a
--            billboard can't); the Color carries what Roblox can't do, the light through the storm
--            (PuffView.light: the cloud between the piece and the sun, the cloud above it, rain
--            under the base), so a deep core and its base go dark as the puffs do
--   cover    a leaf's share of cloud sets its pieces' size (a see-through mesh shows its outline), with
--            at most MAX_CLEAR see-through; a full leaf is opaque
--   distance parts aren't drawn past about 7,000 studs and are capped at 2,048 a side, and storms
--            stand 10-60 km off at up to 15,000 studs tall. So each piece is drawn as its copy scaled
--            about the camera (the camera's view of a copy scaled about it is the same picture),
--            pulled in to at most PULL_MAX studs and to the size cap; ordering along a sight line is
--            kept (the pull is monotonic in distance)
--   haze     PuffView.haze for the piece's true distance, in its Color; Roblox's Atmosphere hazes
--            parts too (it skips billboards), at the copy's distance, so where it is thick the copies
--            are pulled nearer (its light kept above T_MIN).
-- Same use as PuffView:
--   local m = MeshView.new(folder, { max = 600, seed = storm id })
--   m:draw(frame, hScale, vScale) / m:place(ax, groundY, az) / m:recolour(camPos) / m:flash(flashAt)
-- MeshView.ready() (yields, up to 15 s the first time) says whether the mesh loaded; without it the
-- caller keeps the billboards.
local AssetService = game:GetService("AssetService")
local Lighting = game:GetService("Lighting")
local PuffView = require(script.Parent:WaitForChild("PuffView")) :: any

local MeshView = {}
MeshView.__index = MeshView

local MESH = "rbxassetid://1095708" -- Roblox's stock cloud mesh
-- A piece's box against its cell (the leaf's width, and its share of the run's height): wider than tall
-- (the mesh is 1.3 x 0.7 x 0.85 itself) and overlapping its neighbours so the leaves' grid doesn't show;
-- the puff's seeded size variation and its cover's shrink (PuffView COVER_SIZE) ride on top.
local WIDE, TALL = 1.5, 1.35
local PUFF_GROW = 1.8 -- (PuffView's: an item's wS is cellW x this x its cover and seeded factors)
-- Cover: a see-through mesh shows its outline (ghosts, Studio 2026-11-07), so a thin or fading leaf
-- has smaller pieces (by its share's cube root: the cloud's volume goes with its cover) and at most
-- MAX_CLEAR see-through.
-- Below FAINT_SHARE a piece is thin cloud the mesh can't draw solid (it came out as dark beads in a
-- core's thin column, 2026-11-07): it fades toward FAINT_CLEAR see-through as its share goes to 0.
local MAX_CLEAR = 0.3
local MIN_SHRINK = 0.25
local FAINT_SHARE, FAINT_CLEAR = 0.35, 0.9
-- Near a cloud base the cloud is layered: the base is a level surface (the condensation level) and
-- the lumps grow with height above it (rising thermals widen as they go). So a piece FLAT_M or less
-- above its run's base is flatter and wider - at the base FLAT_MIN of its height and 1 + BASE_WIDE
-- its width, easing to its full lumps by FLAT_M up. Stacked, the flattened pieces read as the plates
-- of a base and its shelves (the user's reference, 2026-11-07), with the lumpy tower above.
local FLAT_M, FLAT_MIN, BASE_WIDE = 1500, 0.4, 0.4
-- The light's curve (Color = light ^ GAMMA x gain): Roblox shades the side away from the sun again on
-- top of the frame's light through the storm, which took the core's base to black (2026-11-07);
-- workspace StormMeshGamma overrides.
local GAMMA = 0.7
-- The light round a cloud: Roblox lights a shaded face with Lighting.OutdoorAmbient only (0.27 against
-- the sun's brightness 3 in the game: about 10:1, black undersides), where a real cloud's shaded side
-- takes the sky's and the cloud's own scattered light (a few to one). One Highlight over the storm's
-- meshes lays FILL of their mean colour over every face, which lifts the shaded sides and keeps each
-- piece's own light and its lumps' shading in the rest. workspace StormMeshFill overrides.
local FILL = 0.55
-- Live tuning (EngineStorms' debug keys): size (x WIDE and TALL) and fill (x FILL).
MeshView.tune = { size = 1, fill = 1 }
local PULL_MAX = 6000 -- studs: no copy is farther than this (parts stop drawing near 7,000)
local SIZE_MAX = 2048 -- studs a side, Roblox's part cap
local T_MIN = 0.35 -- the Atmosphere's transmission at a copy's distance is kept above this
local FOG_A, FOG_POWER = 0.188, 4.15 -- Roblox Atmosphere extinction per stud = A x Density^P (measured; stormlab Render/FxParts/Util)
-- The copies are placed again only once the camera or the anchor has moved far enough to shift one by
-- half a pixel (MeshView:place). A copy scaled k about the camera, its piece d away, moves (1 - k) of a
-- camera move at d k from it; every copy moves all of an anchor move at its true distance. Driving, a
-- near storm's whole body moved every frame (0.25 studs, 2026-11-07).
local CLUSTER_MAX = 40 -- (MeshView:draw: a budget up to this draws lumps, PuffView.clusters)
local LUMP_FILL = 1.25
local MOVE_EPS = 0.25 -- studs: at least this
local GAIN = 0.85 -- the Color against PuffView's light, since Roblox's sun lights the mesh on top (workspace StormMeshGain overrides)

-- the template (loaded once; nil until then, false if it failed)
local template: MeshPart? | false = nil
task.spawn(function()
	local ok, part = pcall(function()
		return AssetService:CreateMeshPartAsync(Content.fromUri(MESH), {
			CollisionFidelity = Enum.CollisionFidelity.Box,
			RenderFidelity = Enum.RenderFidelity.Precise, -- (copies sit thousands of studs off: no lower LOD)
		})
	end)
	if ok and part then
		part.Name = "CloudMesh"
		part.Anchored, part.CanCollide, part.CanQuery, part.CanTouch = true, false, false, false
		part.CastShadow = false
		part.Material = Enum.Material.SmoothPlastic
		part.Reflectance = 0
		part.TopSurface, part.BottomSurface = Enum.SurfaceType.Smooth, Enum.SurfaceType.Smooth
		template = part
	else
		warn("[MeshView] the cloud mesh didn't load (" .. tostring(part) .. "); storms stay billboards")
		template = false
	end
end)

-- The cloud kit's pieces (tools/blender/cloud_kit.py, uploaded 2026-10-23 as Model 111990332715428:
-- smooth per-vertex normals, so a piece kilometres across shades as one soft form, where the stock
-- mesh's flat facets showed as slabs). The lump mode (PuffView.clusters) draws each lump with the
-- piece whose proportions are its own - see kindOf.
local KIT = {
	base = { "rbxassetid://103726421491467", "rbxassetid://114972974329196" },
	anvil = { "rbxassetid://100580347596213", "rbxassetid://77478821231480" },
	body = { "rbxassetid://110450272479009", "rbxassetid://100182814303637" },
	cap = { "rbxassetid://112051641143711", "rbxassetid://115897418614352", "rbxassetid://100656634082618" },
}
local kitParts: { [string]: { MeshPart } } = {}
task.spawn(function()
	for kind, ids in KIT do
		local got = {}
		for _, id in ids do
			local ok, part = pcall(function()
				return AssetService:CreateMeshPartAsync(Content.fromUri(id), {
					CollisionFidelity = Enum.CollisionFidelity.Box,
					RenderFidelity = Enum.RenderFidelity.Precise,
				})
			end)
			if ok and part then
				part.Name = "Cloud_" .. kind
				part.Anchored, part.CanCollide, part.CanQuery, part.CanTouch = true, false, false, false
				part.CastShadow = false
				part.Material = Enum.Material.SmoothPlastic
				part.Reflectance = 0
				table.insert(got, part)
			end
		end
		if #got > 0 then kitParts[kind] = got end
	end
end)
-- A lump's piece, from its own proportions: its height against its width (the kit's slabs are a
-- quarter as tall as wide, its tower pieces a little taller than wide - FLAT_F between), whether a
-- slab's air is rooted near the ground (base) or spread out aloft (anvil), and whether a tower lump
-- has more cloud above it (body) or is the top of its column (cap).
local FLAT_F = 0.5
local function kindOf(it: any, items: { any }): string
	local wide = math.sqrt(it.size.X * it.size.Z)
	if it.size.Y < FLAT_F * wide then
		return if it.rooted > 0.5 then "base" else "anvil"
	end
	local top = it.off.Y + 0.5 * it.size.Y
	for _, o in items do
		if o ~= it and o.off.Y > it.off.Y and (o.off.Y - 0.5 * o.size.Y) < top + 0.25 * it.size.Y then
			local dx, dz = o.off.X - it.off.X, o.off.Z - it.off.Z
			if dx * dx + dz * dz < (0.5 * wide) ^ 2 then return "body" end
		end
	end
	return "cap"
end

function MeshView.ready(): boolean
	local t0 = os.clock()
	while template == nil and os.clock() - t0 < 15 do task.wait(0.1) end
	return template ~= nil and template ~= false
end

-- The Atmosphere now: its extinction per stud and colour (none: 0 and the fog colour).
local function atmosphere(): number
	local a = Lighting:FindFirstChildOfClass("Atmosphere")
	if not a then return 0 end
	return FOG_A * a.Density ^ FOG_POWER
end

-- How far (studs) a copy of something d studs from the camera is drawn: true up to half the reach,
-- then easing to the reach (monotonic, so nothing swaps order along a sight line).
local function pulled(d: number, reach: number): number
	local h = 0.5 * reach
	if d <= h then return d end
	return h + h * (1 - math.exp(-(d - h) / h))
end

function MeshView.new(folder: Folder, opts: { max: number?, seed: string?, tower: number? })
	local self = setmetatable({}, MeshView) :: any
	self.folder = folder
	self.max = opts.max or 600
	local seed = 0
	for i = 1, #(opts.seed or "") do seed = (seed * 31 + string.byte(opts.seed :: string, i)) % 1000003 end
	self.seed = seed
	self.tower = opts.tower -- (PuffView.vertical: the cloud above the base at this scale)
	local anchor = Instance.new("Part") -- (where the storm is; the pieces are placed about it)
	anchor.Name = "MeshAnchor"
	anchor.Anchored, anchor.CanCollide, anchor.CanQuery, anchor.CanTouch = true, false, false, false
	anchor.Transparency, anchor.Size = 1, Vector3.one
	anchor.Parent = folder
	self.anchor = anchor
	local model = Instance.new("Model") -- (the meshes, under one Highlight)
	model.Name = "CloudMeshes"
	model.Parent = folder
	self.model = model
	local hl = Instance.new("Highlight")
	hl.DepthMode = Enum.HighlightDepthMode.Occluded
	hl.OutlineTransparency = 1
	hl.FillTransparency = 1 - FILL
	hl.Adornee = model
	hl.Parent = model
	self.highlight = hl
	self.parts = {} :: { MeshPart }
	self.kinds = {} :: { [number]: MeshPart } -- (lump mode: the kit piece each part is a copy of)
	self.pieces = {} :: { any }
	self.shown = 0
	self.epsA, self.epsC = MOVE_EPS, MOVE_EPS -- (MeshView:place)
	return self
end

local function part(self: any, k: number): MeshPart
	local p = self.parts[k]
	if not p then
		p = (template :: MeshPart):Clone()
		p.Parent = self.model
		self.parts[k] = p
	end
	return p
end

function MeshView:draw(f: any, H: number, V: number): string
	local t0 = os.clock()
	if not template then return "meshes: no mesh" end
	-- (2026-11-07, the user: under ~20 meshes a storm, placed to look convincing. Up to CLUSTER_MAX the
	-- body is PuffView.clusters' lumps - each turned along its own spread and sized by it - and above it
	-- the even leaves)
	local clustered = self.max <= CLUSTER_MAX
	local items, sizes
	if clustered then
		items, sizes = PuffView.clusters(self, f, H, V, self.max), {}
	else
		items, sizes = PuffView.layout(self, f, H, V)
	end
	self.lit = {}
	self.H = H
	local k = 0
	local sz = MeshView.tune.size
	for _, it in items do
		k += 1
		local p
		if clustered then
			local kind = kindOf(it, items)
			local set = kitParts[kind]
			local want = if set then set[1 + (self.seed + k * 7) % #set] else template :: MeshPart
			p = self.parts[k]
			if not p or self.kinds[k] ~= want then
				if p then p:Destroy() end
				p = want:Clone()
				self.parts[k], self.kinds[k] = p, want
			end
			-- (the stock mesh fills about LUMP_FILL of its box: sized so the lump's spread is covered)
			p.Transparency = 0
			self.lit[k] = it.lit
			self.pieces[k] = { off = it.off, size = it.size * (LUMP_FILL * sz), rot = CFrame.Angles(0, it.yaw * 2 * math.pi, 0), k = 0, d = 0 }
		else
			p = self.parts[k]
			if p and self.kinds[k] ~= nil then
				p:Destroy()
				p = nil
				self.parts[k], self.kinds[k] = nil, nil
			end
			p = part(self, k)
			local vary = it.wS / (it.cellW * PUFF_GROW) -- (cover and seeded size, as the puff's)
			local shrink = math.max(MIN_SHRINK, (it.share / PuffView.A_MAX) ^ (1 / 3))
			local up = math.clamp((it.lit.hM - it.runBase) / FLAT_M, 0, 1)
			up = up * up * (3 - 2 * up)
			local flat, wide = FLAT_MIN + (1 - FLAT_MIN) * up, 1 + BASE_WIDE * (1 - up)
			local w, h = it.cellW * WIDE * vary * shrink * sz * wide, it.cellH * TALL * vary * shrink * sz * flat
			local faint = math.clamp(1 - it.share / FAINT_SHARE, 0, 1)
			p.Transparency = math.max(math.clamp(1 - it.share / PuffView.A_MAX, 0, MAX_CLEAR), FAINT_CLEAR * faint)
			self.lit[k] = it.lit
			self.pieces[k] = { off = it.off, size = Vector3.new(w, h, w), rot = CFrame.Angles(0, it.yaw * 2 * math.pi, 0), k = 0, d = 0 }
		end
		p.Parent = self.model
	end
	for x = k + 1, self.shown do self.parts[x].Parent = nil end
	self.shown = k
	self.placedAt, self.camAt, self.lvlAt = nil, nil, nil
	self:place(self.anchor.Position.X, self.anchor.Position.Y, self.anchor.Position.Z)
	local cam = workspace.CurrentCamera
	self:recolour(if cam then cam.CFrame.Position else nil)
	local mix = {}
	if clustered then table.insert(mix, "lumps") end
	for _, s in PuffView.SPLIT do if sizes[s] then table.insert(mix, ("%dx%d"):format(sizes[s], s)) end end
	return ("meshes %d of %d (%s)  built in %.1f ms"):format(k, self.max, table.concat(mix, " "), (os.clock() - t0) * 1000)
end

-- Each render step: the storm's anchor, and every piece's copy for where the camera is now (only once
-- the camera or the anchor has moved MOVE_EPS).
function MeshView:place(ax: number, groundY: number, az: number)
	local a = Vector3.new(ax, groundY, az)
	self.anchor.CFrame = CFrame.new(a)
	local cam = workspace.CurrentCamera
	if not cam or self.shown == 0 then return end
	local c = cam.CFrame.Position
	if self.placedAt and (self.placedAt - a).Magnitude < self.epsA and self.camPlaced and (self.camPlaced - c).Magnitude < self.epsC then return end
	self.placedAt, self.camPlaced = a, c
	local halfPx = 0.5 * math.rad(cam.FieldOfView) / math.max(1, cam.ViewportSize.Y)
	local nearA, nearC = math.huge, math.huge
	local ext = atmosphere()
	local reach = if ext > 0 then math.min(PULL_MAX, -math.log(T_MIN) / ext) else PULL_MAX
	local parts, cfs = table.create(self.shown), table.create(self.shown)
	for k = 1, self.shown do
		local pc = self.pieces[k]
		local P = a + pc.off
		local rel = P - c
		local d = rel.Magnitude
		local s = if d > 1 then pulled(d, reach) / d else 1
		local big = math.max(pc.size.X, pc.size.Y)
		if big * s > SIZE_MAX then s = SIZE_MAX / big end
		local p = self.parts[k]
		-- (resize only when the scale has moved: setting Size is the costly part)
		if math.abs(s - pc.k) > 0.002 * pc.k or pc.k == 0 then
			pc.k = s
			p.Size = pc.size * s
		end
		pc.d = d * s
		nearA = math.min(nearA, d)
		if pc.k < 0.999 then nearC = math.min(nearC, d * pc.k / (1 - pc.k)) end
		parts[k] = p
		cfs[k] = CFrame.new(c + rel * pc.k) * pc.rot
	end
	workspace:BulkMoveTo(parts, cfs, Enum.BulkMoveMode.FireCFrameChanged)
	self.epsA, self.epsC = math.max(MOVE_EPS, halfPx * nearA), math.max(MOVE_EPS, halfPx * nearC)
end

-- A piece's Color: PuffView's light (flash added), hazed for its true distance. Roblox's Atmosphere
-- adds a little more over the copy's distance (kept short by the pull's reach). (Setting the Color so
-- that the Atmosphere brought it back to PuffView.haze's exactly took pieces darker than the haze
-- alone to black - the Atmosphere hazes parts less than its measured extinction says: Studio
-- 2026-11-07.)
local function shade(self: any, k: number, L: any)
	local want = PuffView.haze(PuffView.flashed(PuffView.light(L.path, L.above, L.wet), L.flash or 0), L.dist, L.tau, L.rainCol)
	local gain, gam = workspace:GetAttribute("StormMeshGain"), workspace:GetAttribute("StormMeshGamma")
	local g = if type(gain) == "number" then gain else GAIN
	local e = if type(gam) == "number" then gam else GAMMA
	local function ch(x: number): number
		return math.clamp(x, 0, 1) ^ e * g
	end
	local c = Color3.new(ch(want.R), ch(want.G), ch(want.B))
	self.parts[k].Color = c
	return c
end

-- The Highlight's fill: the pieces' mean colour, at FILL (or workspace StormMeshFill).
local function fill(self: any, r: number, g: number, b: number, n: number)
	if n == 0 then return end
	local f = workspace:GetAttribute("StormMeshFill")
	self.highlight.FillTransparency = 1 - math.clamp((if type(f) == "number" then f else FILL) * MeshView.tune.fill, 0, 1)
	self.highlight.FillColor = Color3.new(r / n, g / n, b / n)
end

-- As PuffView:recolour (the haze for the camera, once it has moved PuffView.RECOLOUR_M or the sky's
-- light has changed).
function MeshView:recolour(camPos: Vector3?)
	if not self.lit or not self.H then return end
	local moved, dimmed = PuffView.stale(self, camPos)
	if not moved and not dimmed then return end
	if moved then self.camAt = camPos end
	local r, g, b, n = 0, 0, 0, 0
	for k, L in self.lit do
		if moved then
			local P = self.anchor.Position + L.off
			L.dist = if camPos then ((P - camPos) * Vector3.new(1, 0, 1)).Magnitude / self.H else 0
			L.tau, L.rainCol = PuffView.rainOn(camPos, P, L.hM)
		end
		local c = shade(self, k, L)
		r += c.R; g += c.G; b += c.B; n += 1
	end
	fill(self, r, g, b, n)
end

-- As PuffView:flash.
function MeshView:flash(flashAt: (number, number, number, number, number) -> number): (number, number)
	if not self.lit then return 0, 0 end
	local most, n = 0, 0
	local a = self.anchor.Position
	for k, L in self.lit do
		local fl = flashAt(a.X + L.off.X, a.Z + L.off.Z, L.hM, L.hx, L.hz)
		if fl > 0.01 or L.flash then
			L.flash = if fl > 0.01 then fl else nil
			shade(self, k, L)
		end
		if fl > 0.01 then n += 1 end
		if fl > most then most = fl end
	end
	return most, n
end

function MeshView:destroy()
	self.anchor:Destroy()
	self.model:Destroy()
end

return MeshView
