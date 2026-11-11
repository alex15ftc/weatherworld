--!strict
-- A camera-facing ribbon mesh along a path (EditableMesh): the building block of the funnel
-- (RibbonFunnel) and the sub-vortices (SubVortexView). It turns to the camera at every vertex, so
-- a bent path has no joints, and everything the eye reads is set per vertex each frame:
--   shape     levels along the path x columns across (-1..1), each level as wide as its radius,
--             bulged towards the camera (a half-pipe, so it sits in depth)
--   edge      vertex alpha: opaque middle, a soft ramp at the edge
--   shading   each column is a line down a round column of cloud: its normal against the real
--             sun (wrap lighting), a darker band just inside the edge, a bright rim and a darker
--             middle when backlit
-- The part's own lighting is kept flat (all normals up), so the shading comes from here.
--
--   local r = Ribbon.build(folder, levels, columns, bounds, name)   -- yields; nil if unavailable
--   r:place(origin, points, radii, colours, alphas, look)            -- every frame
local AssetService = game:GetService("AssetService")
local Lighting = game:GetService("Lighting")
local Workspace = game:GetService("Workspace")

local Ribbon = {}
Ribbon.__index = Ribbon

export type Look = {
	edge: number, -- alpha ramp, share of the full width at each side
	dark: number, -- darker band just inside the edge
	wrap: number,
	ambient: number,
	sunShare: number,
	rim: number,
	backDark: number,
	tint: number,
	bulge: number, -- the middle sits this far towards the camera, x the radius
}

export type Ribbon = typeof(setmetatable(
	{} :: {
		key: string, -- its shape, for the pool
		hiddenId: number, -- the bounds sliver's colour (alpha 0)
		mesh: EditableMesh,
		part: MeshPart,
		vids: { number },
		cids: { number },
		uvids: { number }, -- one per vertex, same order as vids (level by level)
		levels: number,
		columns: { number },
		image: EditableImage?,
		positions: { Vector3 },
		colours: { Color3 },
		alphas: { number },
	},
	Ribbon
))

-- Build a ribbon of `levels` rows and the given columns. textureSize: an EditableImage on the
-- part (u across, v along the path), or nil for none. Yields; returns nil (with a warning) if
-- EditableMeshes aren't available.
-- Released ribbons, by shape, for reuse. EditableMesh memory is tightly budgeted on clients and
-- destroyed meshes don't always give theirs back (Studio sessions run out after many rebuilds),
-- so a ribbon is never destroyed: destroy() parks it here and build() takes it back.
local pool: { [string]: { Ribbon } } = {}
local function poolKey(levels: number, columns: { number }, bounds: number, textureSize: Vector2?): string
	return string.format("%d|%s|%g|%s", levels, table.concat(columns, ","), bounds, if textureSize then tostring(textureSize) else "-")
end

function Ribbon.build(parent: Instance, levels: number, columns: { number }, bounds: number, name: string, textureSize: Vector2?): Ribbon?
	local key = poolKey(levels, columns, bounds, textureSize)
	local parked = pool[key]
	if parked and #parked > 0 then
		local r = table.remove(parked) :: Ribbon
		r.part.Name = name
		r.part.Parent = parent
		return r
	end
	local result: Ribbon? = nil
	local ok, err = pcall(function()
		local em = AssetService:CreateEditableMesh()
		-- fixed bounds: two far corners in a sliver face, so the part's size never changes
		-- (Roblox caps a mesh at 2048 studs a side)
		local L = bounds
		local b1 = em:AddVertex(Vector3.new(-L, -L, -L))
		local b2 = em:AddVertex(Vector3.new(L, L, L))
		local b3 = em:AddVertex(Vector3.new(L, L, L - 0.01))
		em:AddTriangle(b1, b2, b3)
		local nC = #columns
		local vids = {}
		for _ = 1, levels do
			for _ = 1, nC do
				table.insert(vids, em:AddVertex(Vector3.zero))
			end
		end
		local up = em:AddNormal(Vector3.yAxis)
		local function v(i: number, j: number): number
			return vids[(i - 1) * nC + j]
		end
		for i = 1, levels - 1 do
			for j = 1, nC - 1 do
				local a, b, c, d = v(i, j), v(i + 1, j), v(i + 1, j + 1), v(i, j + 1)
				-- both windings: whichever faces the camera draws, the other is culled
				for _, tri in { { a, b, c }, { a, c, d }, { a, c, b }, { a, d, c } } do
					local f = em:AddTriangle(tri[1], tri[2], tri[3])
					em:SetFaceNormals(f, { up, up, up })
				end
			end
		end
		-- UVs: u across, v along (0 at the last level, 1 at the first); one per vertex, kept so a
		-- user can move the texture every frame (setUVs) instead of redrawing it
		local uvids = {}
		for i = 1, levels do
			for j = 1, nC do
				local vid = v(i, j)
				local uv = em:AddUV(Vector2.new((columns[j] + 1) / 2, 1 - (i - 1) / (levels - 1)))
				table.insert(uvids, uv)
				for _, f in em:GetVertexFaces(vid) do
					em:SetVertexFaceUV(vid, f, uv)
				end
			end
		end
		-- one colour per vertex, shared by its faces (smooth)
		local cids = {}
		for k, vid in vids do
			local c = em:AddColor(Color3.new(1, 1, 1), 1)
			cids[k] = c
			for _, f in em:GetVertexFaces(vid) do
				em:SetVertexFaceColor(vid, f, c)
			end
		end
		local hidden = em:AddColor(Color3.new(1, 1, 1), 0) -- (an opaque user sets this to 1: Ribbon.makeOpaque)
		for _, vid in { b1, b2, b3 } do
			for _, f in em:GetVertexFaces(vid) do
				em:SetVertexFaceColor(vid, f, hidden)
			end
		end
		local part = AssetService:CreateMeshPartAsync(Content.fromObject(em))
		part.Name = name
		part.Anchored, part.CanCollide, part.CanQuery, part.CanTouch = true, false, false, false
		part.CastShadow = false
		part.Material = Enum.Material.SmoothPlastic
		-- fully rough (MaterialService.CloudMatte): the normals all point up, so a shiny surface
		-- mirrored a low sun as a bright streak down the funnel
		part.MaterialVariant = "CloudMatte"
		part.Color = Color3.new(1, 1, 1)
		part.Transparency = 0.02 -- >0: drawn in the transparent (alpha-blended) pass
		local image: EditableImage? = nil
		if textureSize then
			image = AssetService:CreateEditableImage({ Size = textureSize })
			part.TextureContent = Content.fromObject(image :: EditableImage)
		end
		part.Parent = parent
		local n = levels * nC
		result = setmetatable({
			key = key,
			hiddenId = hidden,
			mesh = em,
			part = part,
			vids = vids,
			cids = cids,
			uvids = uvids,
			levels = levels,
			columns = columns,
			image = image,
			positions = table.create(n),
			colours = table.create(n),
			alphas = table.create(n, 0),
		}, Ribbon)
	end)
	if not ok then
		warn("[Ribbon] couldn't build " .. name .. ": " .. tostring(err))
		return nil
	end
	return result
end

local function smoothstep(a: number, b: number, x: number): number
	local t = math.clamp((x - a) / (b - a), 0, 1)
	return t * t * (3 - 2 * t)
end

-- Place and shade it. origin: where the part sits (transparent parts are sorted by their
-- position: put a ribbon that should draw in front nearer the camera). points, radii: one per
-- level. colours: the cloud's colour per level. alphas: opacity per level (fades). alphaMul:
-- optional, one per vertex (level by level), multiplied in (a ragged edge).
function Ribbon.place(self: Ribbon, origin: Vector3, points: { Vector3 }, radii: { number }, colours: { Color3 }, alphas: { number }, look: Look, alphaMul: { number }?)
	local nL, cols = self.levels, self.columns
	local nC = #cols
	local cam = Workspace.CurrentCamera.CFrame.Position
	local sun = Lighting:GetSunDirection()
	local positions, cs, as = self.positions, self.colours, self.alphas
	local e = look.edge * 2
	for i = 1, nL do
		local c = points[i]
		local tangent = points[math.min(i + 1, nL)] - points[math.max(i - 1, 1)]
		tangent = if tangent.Magnitude > 1e-4 then tangent.Unit else Vector3.yAxis
		local toCam = cam - c
		toCam = if toCam.Magnitude > 1e-3 then toCam.Unit else Vector3.zAxis
		-- across: square to the path and to the view (per level, so no joints)
		local side = tangent:Cross(toCam)
		side = if side.Magnitude > 1e-4 then side.Unit else Vector3.xAxis
		local front = side:Cross(tangent).Unit
		if front:Dot(toCam) < 0 then
			front = -front
		end
		local r = radii[i]
		local lx, lz = sun:Dot(side), sun:Dot(front)
		local horiz = math.sqrt(lx * lx + lz * lz)
		local backlit = math.max(-lz, 0)
		local base = colours[i]
		local alpha = alphas[i]
		for j = 1, nC do
			local x = cols[j]
			local d = math.abs(x)
			local nz = math.sqrt(math.max(1 - x * x, 0))
			local k = (i - 1) * nC + j
			positions[k] = c + side * (x * r) + front * (nz * r * look.bulge) - origin
			local ndl = x * lx + nz * lz
			local lit = math.max((ndl + look.wrap * horiz) / (1 + look.wrap), 0) + 0.25 * math.max(sun.Y, 0)
			local light = look.ambient + look.sunShare * lit
			light += look.rim * backlit * (1 - nz) ^ 3
			light *= 1 - look.backDark * backlit * nz
			local band = math.exp(-((d - (1 - 1.6 * e)) / (1.3 * e)) ^ 2)
			light *= 1 - look.dark * band
			local m = math.clamp(light * look.tint, 0, 1)
			cs[k] = Color3.new(base.R * m, base.G * m, base.B * m)
			as[k] = alpha * (1 - smoothstep(1 - e, 1, d)) * (if alphaMul then alphaMul[k] else 1)
		end
	end
	self.mesh:BatchSetValues(self.vids, positions)
	self.mesh:BatchSetValues(self.cids, cs)
	self.mesh:BatchSetValues(self.cids, as)
	self.part.CFrame = CFrame.new(origin)
end

-- Move the texture: one UV per vertex, level by level (same order as the vertices). Cheap enough
-- for every frame, so a texture that slides (turns, climbs) moves at the full frame rate.
local batchUVs = true -- BatchSetValues on UV ids; falls back to SetUV one by one if refused
function Ribbon.setUVs(self: Ribbon, uvs: { Vector2 })
	if batchUVs then
		local ok, err = pcall(self.mesh.BatchSetValues, self.mesh, self.uvids, uvs)
		if ok then
			return
		end
		batchUVs = false
		warn("[Ribbon] BatchSetValues on UVs refused (" .. tostring(err) .. "): using SetUV")
	end
	for k, id in self.uvids do
		self.mesh:SetUV(id, uvs[k])
	end
end

-- Draw it in the opaque pass: the part fully solid and the bounds sliver's alpha 1 (any vertex
-- alpha below 1 puts a mesh in the transparent pass). Its vertex alphas must then all stay 1.
function Ribbon.makeOpaque(self: Ribbon)
	self.part.Transparency = 0
	self.mesh:SetColorAlpha(self.hiddenId, 1)
end

-- Take it out of the world and park it for the next build of the same shape (see pool).
function Ribbon.destroy(self: Ribbon)
	self.part.Parent = nil
	local list = pool[self.key]
	if not list then
		list = {}
		pool[self.key] = list
	end
	table.insert(list, self)
end

return Ribbon
