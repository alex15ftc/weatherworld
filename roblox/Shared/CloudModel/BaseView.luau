--!strict
-- Visuals prototype 2 (docs/research/PLAN.md stage 2): the storm's cloud base as a mesh sheet
-- (EditableMesh), so the storm has a flat, darker underside from below - camera-facing puffs
-- (PuffView.luau) can't draw one. Everything comes from the client frame (ClientFrame.luau):
--   shape    a vertex at each cloudy column's lowest cloud base (base1, where top1 > base1); three
--            neighbouring columns make a triangle when their bases are within JOIN_M of each other
--            (a bigger step is another cloud layer, not the same base). The sheet faces down (it is
--            seen from below; the puffs cover it from above)
--   shade    the base is lit from below and around only: SHADE, darkened by the rain falling out of
--            it (RAIN_DARK_MMH halves it) and by how thick the cloud above it is (THICK_M halves it)
--   edges    a column with a clear neighbour is see-through (EDGE_ALPHA), so the sheet fades out
--            where the cloud does instead of ending in a hard line
-- No heights or shades are painted: each vertex is a column's base, its shade its own rain and
-- depth.
-- Roblox limits: a mesh is at most 2048 studs across on each axis, so the sheet is cut into tiles
-- across and bands up (near the camera the sky is at game scale, a few studs a metre: each band
-- as tall as a triangle's JOIN_M step leaves room for); and the client holds only a few editable
-- meshes, so MAX_MESHES at most, the groups nearest the camera first: the sheet is the near band's
-- base (PLAN.md stage 2: under ~2.7 km; further out the puffs show the base). LiveView draws near
-- storms only.
--   local b = BaseView.new(folder)
--   b:draw(frame, hScale, vScale, camX, camZ) -> HUD text   (on each new frame; the camera in
--                                                studs from the frame's anchor)
--   b:place(ax, groundY, az)                     (each render step: the anchor from FrameView)
--   b:clear()                                    (drops the sheet and its meshes)
local AssetService = game:GetService("AssetService")
local ClientFrame = require(script.Parent:WaitForChild("ClientFrame")) :: any

local BaseView = {}
BaseView.__index = BaseView

local SHADE = Color3.new(0.36, 0.38, 0.42)
local RAIN_DARK_MMH = 40
local THICK_M = 10000
local ALPHA, EDGE_ALPHA = 0.92, 0
local JOIN_M = 300
local TILE_STUDS, MESH_STUDS = 1900, 2000
local MAX_MESHES = 6
local NEIGHBOURS = { { 1, 0 }, { -1, 0 }, { 0, 1 }, { 0, -1 } }

function BaseView.new(folder: Folder)
	local self = setmetatable({}, BaseView) :: any
	self.folder = folder
	self.parts = {} :: { MeshPart }
	self.meshes = {} :: { EditableMesh } -- (each part's mesh: it lives as long as the part, and must be destroyed with it)
	self.centres = {} :: { Vector3 }
	return self
end

function BaseView:draw(f: any, H: number, V: number, camX: number, camZ: number): string
	local t0 = os.clock()
	local nx, ny, dx = f.nx, f.ny, f.dx
	-- each column: base (m), cloudy, rain, depth
	local base, cloudy, rain, depth = {}, {}, {}, {}
	for j = 1, ny do
		for i = 1, nx do
			local k = (j - 1) * nx + i
			local zb = ClientFrame.cloudM(ClientFrame.byte(f, "base1", i, j))
			local zt = ClientFrame.cloudM(ClientFrame.byte(f, "top1", i, j))
			cloudy[k] = zt > zb
			base[k], depth[k] = zb, zt - zb
			rain[k] = ClientFrame.rateMmh(ClientFrame.byte(f, "rain", i, j))
		end
	end
	-- the triangles (column numbers, wound to face down), each in its group: tile across, band up
	local step = math.max(1, math.floor(TILE_STUDS / (dx * H)))
	local band = math.max(100, MESH_STUDS - JOIN_M * V)
	local groups: { [string]: { { number } } } = {}
	local near: { [string]: number } = {} -- (each group's nearest triangle to the camera, studs)
	local order: { string } = {}
	local function tri(a: number, b: number, c: number, ti: number, tj: number)
		if not (cloudy[a] and cloudy[b] and cloudy[c]) then return end
		local lo, hi = math.min(base[a], base[b], base[c]), math.max(base[a], base[b], base[c])
		if hi - lo > JOIN_M then return end
		local key = ("%d,%d,%d"):format(ti, tj, math.floor(lo * V / band))
		local g = groups[key]
		if not g then
			g = {}
			groups[key] = g
			table.insert(order, key)
		end
		table.insert(g, { a, c, b })
		local i, j = (a - 1) % nx + 1, (a - 1) // nx + 1
		local d = math.sqrt((((i - 0.5) * dx - f.anchorX) * H - camX) ^ 2 + (-((j - 0.5) * dx - f.anchorY) * H - camZ) ^ 2)
		if d < (near[key] or math.huge) then near[key] = d end
	end
	for j = 1, ny - 1 do
		local tj = (j - 1) // step
		for i = 1, nx - 1 do
			local ti = (i - 1) // step
			local a, b = (j - 1) * nx + i, (j - 1) * nx + i + 1
			local c, d = j * nx + i, j * nx + i + 1
			if cloudy[a] and cloudy[b] and cloudy[c] and cloudy[d] then
				tri(a, b, d, ti, tj)
				tri(a, d, c, ti, tj)
			else
				-- three of four: one triangle (only one of these has three cloudy corners)
				tri(a, b, d, ti, tj)
				tri(a, d, c, ti, tj)
				tri(a, b, c, ti, tj)
				tri(b, d, c, ti, tj)
			end
		end
	end
	-- the groups nearest the camera first, MAX_MESHES at most
	table.sort(order, function(x, y) return near[x] < near[y] end)
	self:clear()
	local count, faces, dropped = 0, 0, 0
	local note: string? = nil
	for n, key in order do
		local g = groups[key]
		local mesh = if n <= MAX_MESHES and not note then AssetService:CreateEditableMesh() :: EditableMesh? else nil
		if not mesh then
			-- (nil when the client's budget for editable meshes is used up)
			if n <= MAX_MESHES and not note then note = "out of mesh memory" end
			dropped += #g
			continue
		end
		local vid: { [number]: number } = {}
		local colourOf: { [number]: number } = {} -- (each vertex's colour id, for its faces)
		local function vert(k: number): number
			if vid[k] then return vid[k] end
			local i, j = (k - 1) % nx + 1, (k - 1) // nx + 1
			local edge = false
			for _, d in NEIGHBOURS do
				local ii, jj = i + d[1], j + d[2]
				if ii < 1 or jj < 1 or ii > nx or jj > ny or not cloudy[(jj - 1) * nx + ii] then edge = true end
			end
			local v = mesh:AddVertex(Vector3.new(((i - 0.5) * dx - f.anchorX) * H, base[k] * V, -((j - 0.5) * dx - f.anchorY) * H))
			local dark = 1 / (1 + rain[k] / RAIN_DARK_MMH) / (1 + depth[k] / THICK_M)
			colourOf[v] = mesh:AddColor(Color3.new(SHADE.R * dark, SHADE.G * dark, SHADE.B * dark), if edge then EDGE_ALPHA else ALPHA)
			vid[k] = v
			count += 1
			return v
		end
		for _, t in g do
			local p, q, r = vert(t[1]), vert(t[2]), vert(t[3])
			local fid = mesh:AddTriangle(p, q, r)
			mesh:SetFaceColors(fid, { colourOf[p], colourOf[q], colourOf[r] })
		end
		faces += #g
		local centre = mesh:GetCenter()
		local ok, part = pcall(function()
			return AssetService:CreateMeshPartAsync(Content.fromObject(mesh))
		end)
		if ok and part then
			local mp = part :: MeshPart
			mp.Name = "BaseSheet"
			mp.Anchored, mp.CanCollide, mp.CanQuery, mp.CanTouch, mp.CastShadow = true, false, false, false, false
			mp.Material = Enum.Material.SmoothPlastic
			mp.Parent = self.folder
			table.insert(self.parts, mp)
			table.insert(self.meshes, mesh)
			table.insert(self.centres, centre)
		else
			mesh:Destroy()
			note = tostring(part)
		end
	end
	if faces == 0 then return "base sheet: no cloud" .. (if note then "  (" .. note .. ")" else "") end
	return ("base sheet: %d columns, %d triangles in %d meshes (%d groups, %d triangles left out)  built in %.1f ms%s"):format(
		count, faces, #self.parts, #order, dropped, (os.clock() - t0) * 1000, if note then "  (" .. note .. ")" else "")
end

function BaseView:place(ax: number, groundY: number, az: number)
	for n, p in self.parts do p.CFrame = CFrame.new(ax, groundY, az) + self.centres[n] end
end

function BaseView:clear()
	for _, p in self.parts do p:Destroy() end
	for _, m in self.meshes do m:Destroy() end
	table.clear(self.parts)
	table.clear(self.meshes)
	table.clear(self.centres)
end

function BaseView:destroy()
	self:clear()
end

return BaseView
