--!strict
-- The parent storm's base, built the tornado lab's way (meshes and textures placed round the
-- tornado, not the old storm-scale shells): one field (StormBase.field), in the storm's own frame,
-- shapes and colours the underside of the storm.
--
-- What the field makes (docs/tornado-reference/real/01_cone_a, 11_parent_*, docs/storm-reference):
--   the base     a dark underside at the cloud base, lighter toward its edge (lit from the clear
--                sky beyond), darker over the rain core ahead-left of the storm's motion
--   the edge     ragged and rounded, ending a few degrees above the horizon: the bright slot
--   wall cloud   a lowered, slowly turning block round the tornado's top, with curved striations;
--                the funnel disappears up into it
--   clear slot   a bright, thin band round the wall cloud's rear (the rear-flank downdraught)
--   lumps        broad and fine lumps in shade
--
-- Built inside Roblox's client EditableMesh budget (only a handful of meshes fit, measured
-- 2026-10-23; phones have less): TWO meshes in all.
--   middle tile  its own mesh (heights + vertex colours): the wall cloud, recoloured as it turns.
--                Opaque, so it hides the funnel above the wall cloud's underside.
--   outer tiles  one flat quad mesh shared by every outer MeshPart, each with its own small
--                EditableImage (the field's colour and edge alpha, bilinear-filtered)
-- Nothing is destroyed (destroyed Editable* memory isn't always given back): rebuilds rewrite in
-- place and spare tiles are parked. Tiles are 2048 studs (the part size limit), placed every
-- frame round the tornado's top.
--
--   local base = StormBase.new(workspace); base:setState(state)   -- builds in the background
--   RenderStepped: base:setLive(state); base:update(dt, time)
local AssetService = game:GetService("AssetService")
local Workspace = game:GetService("Workspace")

local Config = require(script.Parent.Config)
local State = require(script.Parent.State)

local StormBase = {}
StormBase.__index = StormBase

local TILE = 2048 -- a tile's width (the part size limit)
local STEP = 2042 -- tiles are this far apart: neighbours overlap a little, so no hairline of sky shows between them

type Outer = { part: MeshPart, image: EditableImage, gx: number, gz: number }
type Middle = {
	part: MeshPart,
	mesh: EditableMesh,
	n: number,
	vids: { number },
	cids: { number },
	xz: { Vector2 },
	wallIds: { number },
	wallXZ: { Vector2 },
}

export type StormBase = typeof(setmetatable(
	{} :: {
		folder: Folder,
		middle: Middle?,
		outer: { [string]: Outer }, -- built tiles by grid cell (kept for reuse, never destroyed)
		shown: { BasePart },
		offsets: { Vector3 },
		state: State.State?,
		building: boolean,
		signature: string,
		spin: number,
		clock: number,
		_cframes: { CFrame },
	},
	StormBase
))

function StormBase.new(parent: Instance?): StormBase
	local folder = Instance.new("Folder")
	folder.Name = "StormBase"
	folder.Parent = parent or Workspace
	return setmetatable({
		folder = folder,
		middle = nil,
		outer = {},
		shown = {},
		offsets = {},
		state = nil,
		building = false,
		signature = "",
		spin = 0,
		clock = 0,
		_cframes = {},
	}, StormBase)
end

local function smoothstep(a: number, b: number, x: number): number
	local t = math.clamp((x - a) / (b - a), 0, 1)
	return t * t * (3 - 2 * t)
end

-- The storm's frame: fwd = the way it moves (heading, degrees anticlockwise from +X seen from
-- above; 90 = -Z), left = 90 degrees left of that.
local function frame(): (Vector2, Vector2)
	local h = math.rad(Config.stormBase.heading)
	local fwd = Vector2.new(math.cos(h), -math.sin(h))
	local left = Vector2.new(fwd.Y, -fwd.X)
	return fwd, left
end

-- The field at (x, z) studs from the tornado's top. H: cloud base height. spin: the wall cloud's
-- turn (radians). Returns: height offset (studs, + up), colour, alpha, and the wall-cloud weight.
function StormBase.field(x: number, z: number, H: number, spin: number): (number, Color3, number, number)
	local S = Config.stormBase
	local W = S.wallCloud
	local fwd, left = frame()
	local p = Vector2.new(x, z)
	local seed = S.seed

	-- the wall cloud: a lowered plateau round the tornado (which sits near its rear-right edge)
	local wc = fwd * W.ahead + left * W.left
	local dw = (p - wc).Magnitude
	-- a ragged rim: broad bulges plus finer scallops round it
	local wa = math.atan2(p.Y - wc.Y, p.X - wc.X)
	local wallR = W.radius * (1 + 0.12 * math.noise(wa * 1.3, seed, 0.5) + W.ragged * math.noise(wa * 6, seed + 7.3, 0.5))
	local wallT = 1 - smoothstep(wallR * W.plateau, wallR, dw)
	-- kept inside the middle tile (the only one with heights; the others are flat and shared)
	wallT *= 1 - smoothstep(TILE * 0.43, TILE * 0.49, math.max(math.abs(x), math.abs(z)))

	-- the edge: rounder than the tiles, longer toward the rain core, ragged
	local pc = wc + fwd * S.precipAhead + left * S.precipLeft
	local toPrecip = (pc - wc).Unit
	local dir = if p.Magnitude > 1 then p.Unit else fwd
	local towardPrecip = math.max(dir:Dot(toPrecip), 0)
	local edgeR = S.radius * (1 + S.stretch * towardPrecip * towardPrecip)
	edgeR *= 1 + S.ragged * math.noise(x / S.raggedScale, z / S.raggedScale, seed + 3.7)
	-- never past the tiles: the fade must finish inside them, or the base ends at the tile grid's
	-- square border (seen from below, its corners drew as long straight V lines across the sky)
	edgeR = math.min(edgeR, S.extent * 0.92)
	local d = p.Magnitude
	local alpha = 1 - smoothstep(edgeR - S.edgeSoft, edgeR, d)
	-- thin patches over the outer part: the sky glows through in places, so the base reads as
	-- layers of cloud rather than a solid plate
	local thinN = math.noise(x / S.thinScale, z / S.thinScale, seed + 41.7)
	alpha *= 1 - S.thin * smoothstep(S.thinFrom, 0.85, d / edgeR) * math.clamp(thinN * 1.6 + 0.4, 0, 1)

	-- height (middle tile only): the wall cloud hanging below the base, lumpy
	local lump = math.noise(x / S.lumpScale, z / S.lumpScale, seed + 11.3)
	local dy = (S.lumpHeight * lump - W.drop * H) * wallT

	-- colour: darker in the middle and under the rain, lighter toward the edge
	local c = S.color:Lerp(S.edgeColor, smoothstep(edgeR - S.lightBand, edgeR, d))
	local dp = (p - pc).Magnitude
	c = c:Lerp(S.coreColor, S.coreShade * math.exp(-(dp / S.precipRadius) ^ 2))

	-- the clear slot: a bright thin band round the wall cloud's rear and right
	local rel = p - wc
	local ang = math.atan2(rel:Dot(left), rel:Dot(fwd)) -- 0 ahead, +pi/2 left, -pi/2 right
	local behind = smoothstep(S.slot.from, S.slot.to, math.abs(ang)) * (if ang < 0 then 1 else S.slot.leftShare)
	local ring = math.exp(-((dw - W.radius * S.slot.at) / (W.radius * S.slot.width)) ^ 2)
	c = c:Lerp(S.slot.color, S.slot.strength * behind * ring)

	-- the wall cloud: its own shade, with curved striations that turn with it
	if wallT > 0.001 then
		local a = math.atan2(p.Y - wc.Y, p.X - wc.X)
		local bands = math.sin(W.bands * a + spin + W.twist * math.log(math.max(dw, 20) / W.radius))
		local rim = smoothstep(W.plateau * 0.6, 1, dw / wallR)
		local shade = 1 + W.striation * bands * (0.4 + 0.6 * rim)
		local wcol = W.color
		c = c:Lerp(Color3.new(math.clamp(wcol.R * shade, 0, 1), math.clamp(wcol.G * shade, 0, 1), math.clamp(wcol.B * shade, 0, 1)), wallT)
	end

	-- lumps in shade too (thicker cloud darker), broad and fine
	local fine = math.noise(x / (S.lumpScale * 0.33), z / (S.lumpScale * 0.33), seed + 23.9)
	local finer = math.noise(x / (S.lumpScale * 0.12), z / (S.lumpScale * 0.12), seed + 57.1)
	local k = 1 + S.lumpShade * lump + S.lumpShade * 0.5 * fine + S.lumpShade * 0.35 * finer
	c = Color3.new(math.clamp(c.R * k, 0, 1), math.clamp(c.G * k, 0, 1), math.clamp(c.B * k, 0, 1))
	return dy, c, alpha, wallT
end

local function partFrom(mesh: EditableMesh, name: string): MeshPart
	local part = AssetService:CreateMeshPartAsync(Content.fromObject(mesh))
	part.Name = name
	part.Anchored, part.CanCollide, part.CanQuery, part.CanTouch = true, false, false, false
	-- casts its shadow: under the storm the sun is blocked (without it the sun lit everything below
	-- the base and every upward surface mirrored it as a glare round the sun when looking toward it)
	part.CastShadow = Config.stormBase.castShadow
	part.Material = Enum.Material.SmoothPlastic
	part.MaterialVariant = "CloudMatte" -- fully rough: no mirrored sun on the flat underside
	part.Color = Color3.new(1, 1, 1)
	return part
end

-- A grid mesh of n x n quads over one tile, flat, white, UVs 0..1 (u along +x, v along +z),
-- normals up (the colours carry the shading), both windings. Bounds are fixed by a hair-thin
-- needle from corner to corner so the part is centred on the tile whatever the heights.
-- uvInset: UVs run from inset to 1 - inset (half a texel: the edge texels' centres on the tile's
-- edges, so filtering never wraps round to the far side of the image, which drew a thin seam).
local function gridMesh(n: number, boundsHeight: number, uvInset: number?): (EditableMesh, { number }, { number }, { Vector2 })
	local em = AssetService:CreateEditableMesh()
	assert(em, "no EditableMesh (client memory budget)")
	local L = TILE * 0.5
	local b1 = em:AddVertex(Vector3.new(-L, -boundsHeight, -L))
	local b2 = em:AddVertex(Vector3.new(L, boundsHeight, L))
	local b3 = em:AddVertex(Vector3.new(L, boundsHeight, L - 0.01))
	em:AddTriangle(b1, b2, b3)
	local vids, xz = {}, {}
	for j = 0, n do
		for i = 0, n do
			local x, z = (i / n - 0.5) * TILE, (j / n - 0.5) * TILE
			table.insert(vids, em:AddVertex(Vector3.new(x, 0, z)))
			table.insert(xz, Vector2.new(x, z))
		end
	end
	local up = em:AddNormal(Vector3.yAxis)
	local function v(i: number, j: number): number
		return vids[j * (n + 1) + i + 1]
	end
	for j = 0, n - 1 do
		for i = 0, n - 1 do
			local a, b, c, d = v(i, j), v(i + 1, j), v(i + 1, j + 1), v(i, j + 1)
			for _, tri in { { a, b, c }, { a, c, d }, { a, c, b }, { a, d, c } } do
				local f = em:AddTriangle(tri[1], tri[2], tri[3])
				em:SetFaceNormals(f, { up, up, up })
			end
		end
	end
	local cids = {}
	for k, vid in vids do
		local inset = uvInset or 0
		local uv = em:AddUV(Vector2.new(inset + (xz[k].X / TILE + 0.5) * (1 - 2 * inset), inset + (xz[k].Y / TILE + 0.5) * (1 - 2 * inset)))
		local cid = em:AddColor(Color3.new(1, 1, 1), 1)
		cids[k] = cid
		for _, f in em:GetVertexFaces(vid) do
			em:SetVertexFaceUV(vid, f, uv)
			em:SetVertexFaceColor(vid, f, cid)
		end
	end
	local white = em:AddColor(Color3.new(1, 1, 1), 1)
	for _, vid in { b1, b2, b3 } do
		for _, f in em:GetVertexFaces(vid) do
			em:SetVertexFaceColor(vid, f, white)
		end
	end
	return em, vids, cids, xz
end

-- The one flat mesh every outer tile shares (made once per session).
local sharedFlat: EditableMesh? = nil
local function flatMesh(): EditableMesh
	if not sharedFlat then
		sharedFlat = (gridMesh(1, 1, 0.5 / math.max(math.floor(Config.stormBase.texels), 4)))
	end
	return sharedFlat :: EditableMesh
end

-- Baked cloud detail (tools/blender/storm_volume_bake.py, a real volume render of a storm base's
-- underside, normalised to mean S.detailMean): the field decides shape, colour and edge; the bake
-- adds real cloud structure. Its pixels are read once (for the outer tiles' images); the middle
-- tile uses it as its texture directly.
local detail: { buf: buffer, w: number, h: number }? = nil
local detailFor: string? = nil
local function loadDetail()
	local S = Config.stormBase
	if S.detailTexture == "" or detailFor == S.detailTexture then
		return
	end
	detailFor = S.detailTexture
	detail = nil
	local ok, img = pcall(function()
		return AssetService:CreateEditableImageAsync(Content.fromUri(S.detailTexture))
	end)
	if not ok or not img then
		warn("[StormBase] detail texture didn't load: " .. tostring(img))
		return
	end
	local size = img.Size
	detail = { buf = img:ReadPixelsBuffer(Vector2.zero, size), w = size.X, h = size.Y }
	img:Destroy()
end

-- The detail at tile coordinates (u, v, wrapping), as a brightness factor about 1.
local function detailAt(u: number, v: number): number
	local d = detail
	if not d then
		return 1
	end
	local S = Config.stormBase
	local x = (u % 1) * d.w - 0.5
	local y = (v % 1) * d.h - 0.5
	local x0, y0 = math.floor(x), math.floor(y)
	local fx, fy = x - x0, y - y0
	local function at(i: number, j: number): number
		return buffer.readu8(d.buf, ((j % d.h) * d.w + (i % d.w)) * 4) / 255
	end
	local a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx
	local b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx
	local l = a + (b - a) * fy
	return 1 + S.detail * (l / S.detailMean - 1)
end

-- The middle tile: heights and vertex colours from the field (the wall cloud lives here).
local function fillMiddle(self: StormBase, H: number)
	local S = Config.stormBase
	local n = math.max(math.floor(S.segments), 2)
	local m = self.middle
	if not m or m.n ~= n then
		if m then
			m.part.Parent = nil -- a different grid: park the old one (destroying leaks budget)
		end
		local em, vids, cids, xz = gridMesh(n, S.boundsHeight)
		m = { part = partFrom(em, "BaseMiddle"), mesh = em, n = n, vids = vids, cids = cids, xz = xz, wallIds = {}, wallXZ = {} }
		self.middle = m
	end
	local mid = m :: Middle
	local positions, colours = table.create(#mid.xz), table.create(#mid.xz)
	local wallIds, wallXZ = {}, {}
	for k, p in mid.xz do
		local dy, c, _, w = StormBase.field(p.X, p.Y, H, self.spin)
		-- the mesh is only a dark backing: its relief is shallow (sheer mesh walls read as a block);
		-- the impostor puffs (WispSprites deck) hang to the field's full depth and make the shape
		positions[k] = Vector3.new(p.X, dy * S.meshRelief, p.Y)
		-- the baked detail sampled exactly as on the outer tiles (one look across the seam)
		local kd = detailAt(p.X / TILE + 0.5, p.Y / TILE + 0.5)
		colours[k] = Color3.new(math.clamp(c.R * kd, 0, 1), math.clamp(c.G * kd, 0, 1), math.clamp(c.B * kd, 0, 1))
		if w > 0.001 then
			table.insert(wallIds, mid.cids[k])
			table.insert(wallXZ, p)
		end
	end
	mid.mesh:BatchSetValues(mid.vids, positions)
	mid.mesh:BatchSetValues(mid.cids, colours)
	mid.wallIds, mid.wallXZ = wallIds, wallXZ
	mid.part.Transparency = 0 -- opaque: hides the funnel above the wall cloud
	mid.part.TextureContent = Content.none
	mid.part.Parent = self.folder
	table.insert(self.shown, mid.part)
	table.insert(self.offsets, Vector3.zero)
end

-- An outer tile: the shared flat mesh with its own texture. Returns false if it's all past the edge.
local function fillOuter(self: StormBase, gx: number, gz: number, H: number): boolean
	local S = Config.stormBase
	local N = math.max(math.floor(S.texels), 4)
	local cx, cz = gx * STEP, gz * STEP
	local pixels = buffer.create(N * N * 4)
	local anyShown, anyFaded = false, false
	for py = 0, N - 1 do
		local z = cz + (py / (N - 1) - 0.5) * TILE -- edge texels sit on the tile's edges (see gridMesh)
		for px = 0, N - 1 do
			local x = cx + (px / (N - 1) - 0.5) * TILE
			local _, c, a = StormBase.field(x, z, H, self.spin)
			local k = detailAt(x / TILE + 0.5, z / TILE + 0.5)
			c = Color3.new(c.R * k, c.G * k, c.B * k)
			anyShown = anyShown or a > 0.003
			anyFaded = anyFaded or a < 0.997
			local r = math.floor(math.clamp(c.R, 0, 1) * 255 + 0.5)
			local g = math.floor(math.clamp(c.G, 0, 1) * 255 + 0.5)
			local b = math.floor(math.clamp(c.B, 0, 1) * 255 + 0.5)
			local al = math.floor(math.clamp(a, 0, 1) * 255 + 0.5)
			buffer.writeu32(pixels, (py * N + px) * 4, bit32.bor(r, bit32.lshift(g, 8), bit32.lshift(b, 16), bit32.lshift(al, 24)))
		end
	end
	local key = gx .. "," .. gz
	local t = self.outer[key]
	if not anyShown then
		if t then
			t.part.Parent = nil
		end
		return false
	end
	if not t or t.image.Size.X ~= N then
		if t then
			t.part.Parent = nil
		end
		local image = AssetService:CreateEditableImage({ Size = Vector2.new(N, N) })
		assert(image, "no EditableImage (client memory budget)")
		local part = partFrom(flatMesh(), string.format("Base_%d_%d", gx, gz))
		part.TextureContent = Content.fromObject(image)

		t = { part = part, image = image, gx = gx, gz = gz }
		self.outer[key] = t
	end
	local o = t :: Outer
	o.image:WritePixelsBuffer(Vector2.zero, Vector2.new(N, N), pixels)
	-- tiles with an edge blend (the texture's alpha makes it ragged); the rest are opaque, so they
	-- hide what's above them (rain curtain tops)
	-- every outer tile in the same (see-through) pass: opaque and see-through tiles are lit a little
	-- differently, which drew their shared straight borders as lines across the sky
	o.part.Transparency = 0.02
	o.part.Parent = self.folder
	table.insert(self.shown, o.part)
	-- alternate tiles half a stud higher: the overlaps don't fight for depth
	table.insert(self.offsets, Vector3.new(gx * STEP, if (gx + gz) % 2 == 0 then 0 else 0.5, gz * STEP))
	return true
end

local function hideAll(self: StormBase)
	if self.middle then
		self.middle.part.Parent = nil
	end
	for _, o in self.outer do
		o.part.Parent = nil
	end
	table.clear(self.shown)
	table.clear(self.offsets)
	table.clear(self._cframes)
	self.signature = ""
end

-- (Re)build for the current settings and tornado. Yields (parts are made asynchronously).
function StormBase.apply(self: StormBase)
	local S = Config.stormBase
	if not S.enabled or not self.state then
		hideAll(self)
		return
	end
	if self.building then
		return -- the running build checks the settings again when it finishes
	end
	local function signature(st: State.State): string
		return table.concat({
			S.heading, S.radius, S.stretch, S.seed, S.segments, S.texels, st.cloudBase, S.wallCloud.drop,
			S.wallCloud.radius, S.color.R, S.edgeColor.R, S.coreColor.R, S.wallCloud.color.R, S.slot.strength,
			S.precipAhead, S.precipLeft, S.extent, S.edgeSoft, S.ragged, S.lumpShade,
			S.detailTexture, S.detail, S.meshRelief, S.thin,
		}, "/")
	end
	self.building = true
	loadDetail()
	local ok, err = pcall(function()
		while S.enabled and self.state and signature(self.state :: State.State) ~= self.signature do
			local st = self.state :: State.State
			local sig = signature(st)
			hideAll(self)
			local H = math.max(st.cloudBase, 1)
			-- a flat base (meshRelief 0: impostor puffs make the shape) needs no special middle tile:
			-- every tile is the same textured quad, so none of them looks different from its neighbours
			local flat = S.meshRelief <= 0
			if flat then
				if self.middle then
					self.middle.part.Parent = nil
				end
			else
				fillMiddle(self, H)
			end
			local reach = math.ceil(S.extent / STEP - 0.5)
			for gz = -reach, reach do
				for gx = -reach, reach do
					if flat or gx ~= 0 or gz ~= 0 then
						fillOuter(self, gx, gz, H)
					end
				end
				task.wait() -- spread the texture work over a few frames
			end
			for _ = #self._cframes + 1, #self.shown do
				table.insert(self._cframes, CFrame.identity)
			end
			self.signature = sig
			print(string.format("[StormBase] %d tiles (1 middle + %d outer)", #self.shown, #self.shown - 1))
		end
	end)
	if not ok then
		warn("[StormBase] build failed: " .. tostring(err))
		self.signature = "failed"
	end
	if not S.enabled then
		hideAll(self)
	end
	self.building = false
end

-- A new tornado or settings: rebuilds in the background if anything that shapes the base changed.
function StormBase.setState(self: StormBase, state: State.State)
	self.state = state
	task.defer(self.apply, self) -- after the caller has finished changing settings
end

function StormBase.setLive(self: StormBase, state: State.State)
	self.state = state
end

function StormBase.update(self: StormBase, dt: number, time: number)
	local state = self.state
	if not state or #self.shown == 0 or self.building then
		return
	end
	local S = Config.stormBase
	local H = math.max(state.cloudBase, 1)
	-- hang the sheet level at the cloud base over the tornado's top
	local top = State.centreAt(state, 1, time)
	local groundY = State.centreAt(state, 0, time).Y
	local origin = Vector3.new(top.X, groundY + H, top.Z)
	for k, off in self.offsets do
		self._cframes[k] = CFrame.new(origin + off)
	end
	Workspace:BulkMoveTo(self.shown, self._cframes, Enum.BulkMoveMode.FireCFrameChanged)
	-- the wall cloud turns (slowly: minutes a turn), recoloured a few times a second
	self.spin += S.wallCloud.spinRate * dt
	self.clock += dt
	local m = self.middle
	if not m or #m.wallIds == 0 or self.clock < 1 / S.wallCloud.redrawRate then
		return
	end
	self.clock = 0
	local colours = table.create(#m.wallIds)
	for k, p in m.wallXZ do
		local _, c = StormBase.field(p.X, p.Y, H, self.spin)
		colours[k] = c
	end
	m.mesh:BatchSetValues(m.wallIds, colours)
end

function StormBase.destroy(self: StormBase)
	hideAll(self)
	self.folder:Destroy()
end

return StormBase
