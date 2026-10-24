--!nonstrict
-- Tube meshes for the tornado visuals: one EditableMesh holding `tubes` tubes of `rings` x
-- (`segs` + 1 seam) vertices, outward-facing triangles only (counter-clockwise seen from outside:
-- Roblox's front face), flat normals (the colour carries all the lighting: the part is Neon, so
-- light from lightning can be local), per-vertex colour + alpha and UVs written in batches every
-- frame. Fixed bounds (a hidden sliver spanning +-BOUNDS) keep the part's size constant, so a
-- vertex at local p is drawn at part.Position + p * (part.Size / size).
-- Meshes are pooled and never destroyed (the client's EditableMesh memory budget is tiny and
-- destroyed meshes don't reliably give theirs back): TubeMesh.get / TubeMesh.park.
local AssetService = game:GetService("AssetService")

local TubeMesh = {}

TubeMesh.BOUNDS = 1020 -- (Roblox caps a mesh at 2048 a side)

local pool: { [string]: { any } } = {}

local function build(tubes: number, rings: number, segs: number, texture: EditableImage?): any
	local em = AssetService:CreateEditableMesh()
	local L = TubeMesh.BOUNDS
	local b1 = em:AddVertex(Vector3.new(-L, -L, -L))
	local b2 = em:AddVertex(Vector3.new(L, L, L))
	local b3 = em:AddVertex(Vector3.new(L, L, L - 0.01))
	em:AddTriangle(b1, b2, b3)
	local nc = segs + 1
	local up = em:AddNormal(Vector3.yAxis)
	local vids, cids, uvids = {}, {}, {}
	for tube = 1, tubes do
		local base = #vids
		for _ = 1, rings * nc do
			table.insert(vids, em:AddVertex(Vector3.zero))
		end
		local function v(i: number, j: number): number
			return vids[base + (i - 1) * nc + j]
		end
		for i = 1, rings - 1 do
			for j = 1, segs do
				local a, b, c, d = v(i, j), v(i, j + 1), v(i + 1, j + 1), v(i + 1, j)
				local f1 = em:AddTriangle(a, b, d)
				local f2 = em:AddTriangle(b, c, d)
				em:SetFaceNormals(f1, { up, up, up })
				em:SetFaceNormals(f2, { up, up, up })
			end
		end
		for i = 1, rings do
			for j = 1, nc do
				local vid = v(i, j)
				local uv = em:AddUV(Vector2.new((j - 1) / segs, (i - 1) / (rings - 1)))
				local c = em:AddColor(Color3.new(1, 1, 1), 0)
				table.insert(uvids, uv)
				table.insert(cids, c)
				for _, f in em:GetVertexFaces(vid) do
					em:SetVertexFaceUV(vid, f, uv)
					em:SetVertexFaceColor(vid, f, c)
				end
			end
		end
		local _ = tube
	end
	local hidden = em:AddColor(Color3.new(1, 1, 1), 0)
	for _, vid in { b1, b2, b3 } do
		for _, f in em:GetVertexFaces(vid) do
			em:SetVertexFaceColor(vid, f, hidden)
		end
	end
	local part = AssetService:CreateMeshPartAsync(Content.fromObject(em))
	part.Anchored, part.CanCollide, part.CanQuery, part.CanTouch = true, false, false, false
	part.CastShadow = false
	part.Material = Enum.Material.Neon -- self-lit: the colour is the light (Tornado/SceneLight)
	part.Color = Color3.new(1, 1, 1)
	part.Transparency = 0.02 -- the alpha-blended pass (soft edges)
	if texture then
		part.TextureContent = Content.fromObject(texture)
	end
	local n = #vids
	return {
		mesh = em, part = part, vids = vids, cids = cids, uvids = uvids,
		tubes = tubes, rings = rings, segs = segs, nc = nc, per = rings * nc,
		size = part.Size,
		pos = table.create(n, Vector3.zero), col = table.create(n, Color3.new(1, 1, 1)),
		alpha = table.create(n, 0), uv = table.create(n, Vector2.zero),
		batchUV = true,
	}
end

-- a mesh of this shape from the pool, or a new one (nil if EditableMeshes are unavailable)
function TubeMesh.get(parent: Instance, name: string, tubes: number, rings: number, segs: number, texture: EditableImage?): any?
	local key = string.format("%d|%d|%d|%s", tubes, rings, segs, if texture then "t" else "-")
	local list = pool[key]
	local m = list and table.remove(list)
	if not m then
		local ok, res = pcall(build, tubes, rings, segs, texture)
		if not ok then
			warn("[StormLab] tornado mesh unavailable: " .. tostring(res))
			return nil
		end
		m = res
		m.key = key
	end
	m.part.Name = name
	m.part.Parent = parent
	return m
end

function TubeMesh.park(m: any)
	m.part.Parent = nil
	pool[m.key] = pool[m.key] or {}
	table.insert(pool[m.key], m)
end

-- push this frame's positions (mesh-local), colours, alphas and UVs
function TubeMesh.write(m: any)
	m.mesh:BatchSetValues(m.vids, m.pos)
	m.mesh:BatchSetValues(m.cids, m.col)
	m.mesh:BatchSetValues(m.cids, m.alpha)
	if m.batchUV then
		local ok = pcall(m.mesh.BatchSetValues, m.mesh, m.uvids, m.uv)
		if not ok then
			m.batchUV = false
		end
	end
	if not m.batchUV then
		for k, id in m.uvids do
			m.mesh:SetUV(id, m.uv[k])
		end
	end
end

-- hide every vertex (alpha 0) without moving the part
function TubeMesh.clear(m: any)
	for k = 1, #m.alpha do
		m.alpha[k] = 0
	end
	m.mesh:BatchSetValues(m.cids, m.alpha)
end

-- a procedural streak texture (tileable round and up): vertical striations and soft patches
local texture: EditableImage? = nil
function TubeMesh.texture(Noise: any): EditableImage?
	if texture then
		return texture
	end
	local ok, img = pcall(function()
		return AssetService:CreateEditableImage({ Size = Vector2.new(128, 128) })
	end)
	if not ok or not img then
		return nil
	end
	local W, H = 128, 128
	local buf = buffer.create(W * H * 4)
	for y = 0, H - 1 do
		for x = 0, W - 1 do
			local a, b = x / W * 2 * math.pi, y / H * 2 * math.pi
			local px, py = math.cos(a) * 1.3, math.sin(a) * 1.3
			local streak = Noise.fbm3(px * 3, py * 3, b * 0.6, 17, 3)
			local patch = Noise.fbm3(px, py, b * 0.9 + 3, 29, 3)
			local v = 0.8 + 0.14 * streak + 0.1 * patch
			local g = math.clamp(math.floor(v * 255), 0, 255)
			local o = (y * W + x) * 4
			buffer.writeu8(buf, o, g)
			buffer.writeu8(buf, o + 1, g)
			buffer.writeu8(buf, o + 2, g)
			buffer.writeu8(buf, o + 3, 255)
		end
	end
	img:WritePixelsBuffer(Vector2.zero, Vector2.new(W, H), buf)
	texture = img
	return img
end

return TubeMesh
