--!strict
--!native
-- Storm volumes built from EditableMesh and EditableImage: rain and hail shafts, rain wrapping
-- the rotation, mammatus, scud, the bands round a turning tower.
--
-- Each kind has a few lumpy shapes made once as EditableMeshes (a cloud: a sphere pushed in and
-- out by noise; rain: a column streaked up and down; a band: a ring), turned into MeshParts. A
-- volume is three of them nested (shells at 100, 80 and 60 per cent), the inner more opaque, so
-- its edge is soft from every side and it can be flown into (they are double-sided).
--
-- Each shell's texture is an EditableImage lit once: from each point on the shell a ray toward
-- the sun through the same 3D density gives how much light reaches it (Beer-Lambert), and the
-- density there gives its alpha, so noise eats holes in the outer shells. The texture is grey;
-- each volume tints it (SurfaceAppearance.Color) and sets its transparency, so all volumes of a
-- kind share a handful of meshes and images and nothing is redrawn frame to frame.
--
-- Built in the background at start (ready() is false until then, and StormController draws
-- spheres); where EditableMesh or EditableImage cannot be made, it stays false.

local AssetService = game:GetService("AssetService")

local Volumes = {}

export type Kind = "cloud" | "rain" | "band"

local VARIANTS = 3
local SHELLS = { 1, 0.8, 0.6 } -- shell sizes
local SHELL_OPACITY = { 0.35, 0.55, 0.85 } -- each shell's share of the volume's opacity
-- How deep inside the shape each shell's texture samples the density (a shell's own surface
-- is where the cloud has thinned away): toward the centre, or a band's tube.
local SAMPLE_DEPTH: { [string]: { number } } = { cloud = { 0.62, 0.5, 0.4 }, rain = { 0.85, 0.7, 0.55 }, band = { 0.6, 0.45, 0.3 } }
local U, V = 32, 16 -- mesh grid round and up
local TEX_W, TEX_H = 128, 64
local SUN = Vector3.new(-0.35, 0.85, -0.4).Unit -- light in a shape's own space (volumes stand upright)
local NOISE = 32

-- Noise ---------------------------------------------------------------------------------------

local lattice = buffer.create(NOISE * NOISE * NOISE * 4)
do
	local rng = Random.new(1789)
	for i = 0, NOISE * NOISE * NOISE - 1 do
		buffer.writef32(lattice, i * 4, rng:NextNumber())
	end
end

local function at(x: number, y: number, z: number): number
	return buffer.readf32(lattice, (((z % NOISE) * NOISE + (y % NOISE)) * NOISE + (x % NOISE)) * 4)
end

local function noise(x: number, y: number, z: number): number
	local ix, iy, iz = math.floor(x), math.floor(y), math.floor(z)
	local fx, fy, fz = x - ix, y - iy, z - iz
	fx, fy, fz = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy), fz * fz * (3 - 2 * fz)
	local c000, c100 = at(ix, iy, iz), at(ix + 1, iy, iz)
	local c010, c110 = at(ix, iy + 1, iz), at(ix + 1, iy + 1, iz)
	local c001, c101 = at(ix, iy, iz + 1), at(ix + 1, iy, iz + 1)
	local c011, c111 = at(ix, iy + 1, iz + 1), at(ix + 1, iy + 1, iz + 1)
	local x00, x10 = c000 + (c100 - c000) * fx, c010 + (c110 - c010) * fx
	local x01, x11 = c001 + (c101 - c001) * fx, c011 + (c111 - c011) * fx
	local y0, y1 = x00 + (x10 - x00) * fy, x01 + (x11 - x01) * fy
	return y0 + (y1 - y0) * fz
end

-- Density (0..1) at a point in a shape's unit space; seed picks the variant.
local function density(kind: Kind, x: number, y: number, z: number, seed: number): number
	if kind == "band" then
		local radial = math.sqrt(x * x + z * z)
		local d = 1 - ((radial - 0.78) / 0.22) ^ 2 - (y / 0.5) ^ 2
		if d <= 0 then
			return 0
		end
		return math.max(0, d * (0.4 + 0.8 * noise(x * 6 + seed, y * 3, z * 6)) - 0.15)
	end
	local r2 = x * x + y * y + z * z
	if r2 >= 1 then
		return 0
	end
	local shape = 1 - r2
	if kind == "rain" then
		local n = 0.65 * noise(x * 5 + seed, y * 0.8, z * 5) + 0.35 * noise(x * 11, y * 1.6 + seed, z * 11)
		return math.max(0, shape * (0.35 + 0.9 * n) - 0.2)
	end
	local n = 0.55 * noise(x * 3.1 + seed, y * 3.1, z * 3.1) + 0.3 * noise(x * 6.3, y * 6.3 + seed, z * 6.3)
		+ 0.15 * noise(x * 12.7, y * 12.7, z * 12.7 + seed)
	return math.max(0, shape - (1 - n) * 0.8)
end

-- Shapes --------------------------------------------------------------------------------------

-- A point of a shape's surface at grid (i round, j up), unit-sized: a lumpy sphere, a streaked
-- column, or a ring.
local function surfacePoint(kind: Kind, i: number, j: number, seed: number): Vector3
	local a = i / U * math.pi * 2
	if kind == "band" then
		-- A ring (torus): round the axis (a) and round the tube (b).
		local b = j / V * math.pi * 2
		local tube = 0.22 * (0.85 + 0.3 * noise(math.cos(a) * 4 + seed, math.sin(b) * 2, math.sin(a) * 4))
		local radial = 0.78 + tube * math.cos(b)
		return Vector3.new(math.cos(a) * radial, tube * math.sin(b) / 0.22 * 0.5, math.sin(a) * radial)
	end
	local polar = j / V * math.pi
	local dir = Vector3.new(math.sin(polar) * math.cos(a), math.cos(polar), math.sin(polar) * math.sin(a))
	local bump
	if kind == "rain" then
		-- Columns of rain: in and out round the shaft, little up and down.
		bump = 0.82 + 0.3 * noise(dir.X * 5 + seed, dir.Y * 0.7, dir.Z * 5)
	else
		bump = 0.72 + 0.35 * noise(dir.X * 2.4 + seed, dir.Y * 2.4, dir.Z * 2.4) + 0.12 * noise(dir.X * 6, dir.Y * 6 + seed, dir.Z * 6)
	end
	return dir * bump
end

-- The shape's EditableMesh: a grid (U x V, the seam column repeated so the texture wraps), with
-- UVs matching the texture's layout.
local function buildMesh(kind: Kind, seed: number): EditableMesh
	-- Roblox returns nothing where EditableMesh is not allowed (the experience's Security
	-- setting for mesh and image APIs) or the device's budget for them is used up.
	local made: EditableMesh? = (AssetService :: any):CreateEditableMesh()
	if not made then
		made = AssetService:CreateEditableMesh({ FixedSize = false })
	end
	if not made then
		error(
			"CreateEditableMesh returned nothing: turn on Game Settings > Security > Allow Mesh / Image APIs (and publish), or the device's EditableMesh budget is used up",
			0
		)
	end
	local mesh = made :: EditableMesh
	local ids: { [number]: { [number]: number } } = {}
	local uvs: { [number]: { [number]: number } } = {}
	for j = 0, V do
		ids[j] = {}
		uvs[j] = {}
		for i = 0, U do
			ids[j][i] = mesh:AddVertex(surfacePoint(kind, i % U, j, seed))
			uvs[j][i] = mesh:AddUV(Vector2.new(i / U, j / V))
		end
	end
	for j = 0, V - 1 do
		for i = 0, U - 1 do
			local a, b, c, d = ids[j][i], ids[j][i + 1], ids[j + 1][i], ids[j + 1][i + 1]
			local f1 = mesh:AddTriangle(a, c, b)
			mesh:SetFaceUVs(f1, { uvs[j][i], uvs[j + 1][i], uvs[j][i + 1] })
			local f2 = mesh:AddTriangle(b, c, d)
			mesh:SetFaceUVs(f2, { uvs[j][i + 1], uvs[j + 1][i], uvs[j + 1][i + 1] })
		end
	end
	return mesh
end

-- The texture for one shell of a shape: grey light, and alpha from the density under it.
local function buildImage(kind: Kind, seed: number, shell: number): EditableImage
	local image = AssetService:CreateEditableImage({ Size = Vector2.new(TEX_W, TEX_H) })
	local pixels = buffer.create(TEX_W * TEX_H * 4)
	local depth = SAMPLE_DEPTH[kind][shell]
	for y = 0, TEX_H - 1 do
		if y % 8 == 7 then
			task.wait() -- spread the work over frames
		end
		for x = 0, TEX_W - 1 do
			-- The point of the shell under this texel, taken inside the shape (a band: inside its
			-- tube), where its cloud is.
			local p = surfacePoint(kind, x / TEX_W * U, (y + 0.5) / TEX_H * V, seed)
			local inside
			if kind == "band" then
				local flat = Vector3.new(p.X, 0, p.Z)
				local centre = if flat.Magnitude > 1e-3 then flat.Unit * 0.78 else Vector3.zero
				inside = centre + (p - centre) * depth
			else
				inside = p * depth
			end
			local d = density(kind, inside.X, inside.Y, inside.Z, seed)
			-- Light reaching it through the cloud toward the sun.
			local toSun = 0
			for s = 1, 4 do
				local q = inside + SUN * (0.12 * s)
				toSun += density(kind, q.X, q.Y, q.Z, seed)
			end
			local sunlit = math.exp(-toSun * 1.4)
			local under = 0.85 + 0.15 * inside.Y -- a little darker underneath
			local light = math.clamp((0.5 + 0.55 * sunlit) * under + 0.25 * sunlit * sunlit, 0, 1)
			-- Outer shells: mostly holes where the density is thin; inner: nearly whole.
			local alpha = math.clamp(d * (1.6 + shell) + (shell - 1) * 0.25, 0, 1)
			local o = (y * TEX_W + x) * 4
			local v = math.floor(light * 255)
			buffer.writeu8(pixels, o, v)
			buffer.writeu8(pixels, o + 1, v)
			buffer.writeu8(pixels, o + 2, math.min(255, v + 4))
			buffer.writeu8(pixels, o + 3, math.floor(alpha * 255))
		end
	end
	image:WritePixelsBuffer(Vector2.zero, Vector2.new(TEX_W, TEX_H), pixels)
	return image
end

-- Templates: per kind, per variant, per shell, a MeshPart and its texture.
type Template = { part: MeshPart, texture: Content }
local templates: { [string]: { [number]: { Template } } } = {}
local state: "building" | "ready" | "failed" = "building"
local reason = ""
local tintable = false -- SurfaceAppearance (tint and alpha holes) works here

function Volumes.ready(): boolean
	return state == "ready"
end

function Volumes.status(): string
	if state == "building" then
		return "volumes: building meshes..."
	elseif state == "failed" then
		return `volumes: unavailable ({reason}); spheres`
	end
	return if tintable then "volumes: EditableMesh shells, tinted" else "volumes: EditableMesh shells (untinted: SurfaceAppearance unavailable)"
end

-- A volume: SHELLS nested parts in a Model, sharing a template's meshes and images.
export type Volume = { model: Model, kind: Kind, shells: { MeshPart }, looks: { SurfaceAppearance } }

function Volumes.new(kind: Kind, variant: number): Volume?
	local byVariant = templates[kind]
	local set = byVariant and byVariant[(variant - 1) % VARIANTS + 1]
	if not set then
		return nil
	end
	local model = Instance.new("Model")
	local shells: { MeshPart } = {}
	local looks: { SurfaceAppearance } = {}
	for index, template in set do
		local part = template.part:Clone()
		part.Name = `Shell{index}`
		if tintable then
			local look = Instance.new("SurfaceAppearance")
			look.AlphaMode = Enum.AlphaMode.Transparency
			look.ColorMapContent = template.texture
			look.Parent = part
			table.insert(looks, look)
		else
			part.TextureContent = template.texture
		end
		part.Parent = model
		table.insert(shells, part)
	end
	return { model = model, kind = kind, shells = shells, looks = looks }
end

-- Places a volume: a shape of full size `size` at cf, tinted, as opaque through its middle as
-- `opacity`. A part is at most 2048 studs a side: a taller one keeps its top (clouds hang down).
function Volumes.place(volume: Volume, cf: CFrame, size: Vector3, colour: Color3, opacity: number)
	local clamped = Vector3.new(math.min(size.X, 2048), math.min(size.Y, 2048), math.min(size.Z, 2048))
	local frame = cf
	if clamped.Y < size.Y then
		frame = cf * CFrame.new(0, (size.Y - clamped.Y) / 2, 0)
	end
	for index, part in volume.shells do
		-- Shells nest inward; a band's nest by growing thinner, not by shrinking its ring.
		local k = SHELLS[index]
		local s = if volume.kind == "band" then Vector3.new(clamped.X, clamped.Y * k, clamped.Z) else clamped * k
		if part.Size ~= s then
			part.Size = s
		end
		part.CFrame = frame
		part.Transparency = 1 - math.clamp(opacity * SHELL_OPACITY[index], 0, 1)
		part.Color = colour
	end
	for _, look in volume.looks do
		look.Color = colour
	end
end

-- Builds every template, yielding between them; call once, in its own thread.
function Volumes.build()
	local ok, err = pcall(function()
		-- Can SurfaceAppearance take an EditableImage here?
		local probe = AssetService:CreateEditableImage({ Size = Vector2.new(4, 4) })
		tintable = pcall(function()
			local look = Instance.new("SurfaceAppearance")
			look.ColorMapContent = Content.fromObject(probe)
			look.AlphaMode = Enum.AlphaMode.Transparency
			look.Color = Color3.new(1, 1, 1)
			look:Destroy()
		end)
		probe:Destroy()
		local kinds: { Kind } = { "cloud", "rain", "band" }
		for _, kind: Kind in kinds do
			local byVariant: { [number]: { Template } } = {}
			templates[kind] = byVariant
			for variant = 1, VARIANTS do
				local seed = variant * 7.31
				local set: { Template } = {}
				for shell = 1, #SHELLS do
					local shellSeed = seed + shell * 0.37
					local mesh = buildMesh(kind, shellSeed)
					local part = AssetService:CreateMeshPartAsync(Content.fromObject(mesh), { CollisionFidelity = Enum.CollisionFidelity.Box })
					part.Anchored, part.CanCollide, part.CanQuery, part.CanTouch, part.CastShadow = true, false, false, false, false
					part.DoubleSided = true
					part.Material = Enum.Material.SmoothPlastic
					local image = buildImage(kind, shellSeed, shell)
					table.insert(set, { part = part, texture = Content.fromObject(image) })
					task.wait()
				end
				byVariant[variant] = set
			end
		end
	end)
	if ok then
		state = "ready"
		print(`[Volumes] {Volumes.status()}`)
	else
		state = "failed"
		reason = tostring(err)
		warn(`[Volumes] could not build the storm volumes, so storms use sphere parts: {err}`)
	end
end

Volumes.VARIANTS = VARIANTS

return Volumes
