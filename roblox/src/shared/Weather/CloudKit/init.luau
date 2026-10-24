--!strict
-- The cloud kit: a small set of reusable cloud pieces (tower caps and bodies, anvil sections,
-- bases, shelf segments, wall clouds, mammatus), made in Blender (tools/blender/cloud_kit.py, or
-- by hand: docs/storm-visuals/KIT.md) and stored as data in Pieces/. Each piece is built into a
-- mesh once; every storm is put together from copies of them (client/StormKit), placed, sized,
-- tinted and faded from the storm's fields.
--
-- A piece fills a unit box: x and z from -0.5 to 0.5 (z: its front), y from 0 (bottom) to 1.
--
--   CloudKit.ready(name)            -- true once the piece is built (building starts on first ask)
--   CloudKit.copy(name)             -- a new part of that piece (nil until ready)
--   CloudKit.place(part, name, cf, size)  -- the unit box at cf (its bottom middle), size studs
--   CloudKit.names(kind)            -- the piece names of a kind
local AssetService = game:GetService("AssetService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local CloudKit = {}

local UNIT = 100 -- studs a unit in the built mesh (parts are resized anyway)

type Template = { part: MeshPart, mid: Vector3, ext: Vector3 }
local templates: { [string]: Template | false } = {} -- false: building or failed

local Index: { [string]: { string } } = (function()
	local m = script:FindFirstChild("Index")
	if m and m:IsA("ModuleScript") then
		return (require(m) :: any)
	end
	return {}
end)()
CloudKit.index = Index

function CloudKit.names(kind: string): { string }
	return Index[kind] or {}
end

-- The uploaded pieces (tools/blender/cloud_kit_glb.py, uploaded as one Model asset): the server
-- loads it (CloudKit.serverLoad) into ReplicatedStorage.CloudKitMeshes. Uploaded meshes don't use
-- the EditableMesh memory budget (shared with the tornado, the sky and the map, it ran out);
-- pieces not found there are built at runtime instead.
local MESH_FOLDER = "CloudKitMeshes"

function CloudKit.serverLoad(assetId: number)
	if not RunService:IsServer() or ReplicatedStorage:FindFirstChild(MESH_FOLDER) then
		return
	end
	task.spawn(function()
		local ok, model = pcall(function()
			return game:GetService("InsertService"):LoadAsset(assetId)
		end)
		if not ok or not model then
			warn("[CloudKit] could not load the kit's meshes (asset " .. assetId .. "): " .. tostring(model) .. "; building them at runtime")
			return
		end
		local folder = Instance.new("Folder")
		folder.Name = MESH_FOLDER
		for _, d in (model :: Instance):GetDescendants() do
			if d:IsA("MeshPart") and not folder:FindFirstChild(d.Name) then
				local part = d:Clone()
				part.Anchored, part.CanCollide, part.CanQuery, part.CanTouch = true, false, false, false
				part.CastShadow = false
				-- (a box for physics: hundreds of these move every frame; where the engine lets
				-- a script set it)
				pcall(function()
					(part :: any).CollisionFidelity = Enum.CollisionFidelity.Box
				end)
				part.Parent = folder
			end
		end
		folder.Parent = ReplicatedStorage
		local first = folder:GetChildren()[1]
		local sa = first and first:FindFirstChildOfClass("SurfaceAppearance")
		print(string.format("[CloudKit] %d uploaded pieces loaded (%s)", #folder:GetChildren(),
			if sa then "with a SurfaceAppearance: the haze glow works" else "no SurfaceAppearance: no haze glow"))
	end)
end

-- A piece's uploaded mesh, if the server loaded the kit (waiting a little for it at first).
local waitedForUploads = false
local function uploaded(name: string): MeshPart?
	local folder = ReplicatedStorage:FindFirstChild(MESH_FOLDER)
	if not folder and not waitedForUploads then
		waitedForUploads = true
		folder = ReplicatedStorage:WaitForChild(MESH_FOLDER, 10)
	end
	local part = folder and folder:FindFirstChild(name)
	return if part and part:IsA("MeshPart") then part else nil
end

local function build(name: string): Template?
	local folder = script:FindFirstChild("Pieces")
	local mod = folder and folder:FindFirstChild(name)
	if not (mod and mod:IsA("ModuleScript")) then
		warn("[CloudKit] no piece " .. name)
		return nil
	end
	local d = require(mod) :: any
	local n = d.vertices
	-- the piece's own extent (it should fill the unit box; this keeps placing right if not)
	local lo, hi = Vector3.one * math.huge, -Vector3.one * math.huge
	for i = 1, n do
		local v = Vector3.new(d.p[3 * i - 2], d.p[3 * i - 1], d.p[3 * i])
		lo, hi = lo:Min(v), hi:Max(v)
	end
	local mid, ext = (lo + hi) / 2, hi - lo
	local up = uploaded(name)
	if up then
		local part = up:Clone()
		part.Material = Enum.Material.SmoothPlastic
		part.MaterialVariant = "CloudMatte" -- (fully rough: clouds have no shine; MaterialService.CloudMatte)
		part.Color = Color3.new(1, 1, 1)
		return { part = part, mid = mid, ext = ext }
	end
	local em = AssetService:CreateEditableMesh()
	if not em then
		error("no mesh (the EditableMesh memory budget is used up)")
	end
	local vids, nids, cids = table.create(n), table.create(n), table.create(n)
	for i = 1, n do
		local v = Vector3.new(d.p[3 * i - 2], d.p[3 * i - 1], d.p[3 * i]) - mid
		vids[i] = em:AddVertex(v * UNIT)
		nids[i] = em:AddNormal(Vector3.new(d.n[3 * i - 2], d.n[3 * i - 1], d.n[3 * i]))
		local ao = d.ao[i]
		cids[i] = em:AddColor(Color3.new(ao, ao, ao), 1)
	end
	for f = 1, #d.t // 3 do
		local a, b, c = d.t[3 * f - 2], d.t[3 * f - 1], d.t[3 * f]
		local face = em:AddTriangle(vids[a], vids[b], vids[c])
		em:SetFaceNormals(face, { nids[a], nids[b], nids[c] })
		em:SetFaceColors(face, { cids[a], cids[b], cids[c] })
	end
	local part = AssetService:CreateMeshPartAsync(Content.fromObject(em))
	part.Name = name
	part.Anchored, part.CanCollide, part.CanQuery, part.CanTouch = true, false, false, false
	part.CastShadow = false
	part.Material = Enum.Material.SmoothPlastic
	part.MaterialVariant = "CloudMatte" -- (fully rough: clouds have no shine; MaterialService.CloudMatte)
	part.Color = Color3.new(1, 1, 1)
	return { part = part, mid = mid, ext = ext }
end

function CloudKit.ready(name: string): boolean
	local t = templates[name]
	if t then
		return true
	end
	if t == nil then
		templates[name] = false
		task.spawn(function()
			local ok, result = pcall(build, name)
			if ok and result then
				templates[name] = result
			elseif not ok then
				warn("[CloudKit] building " .. name .. ": " .. tostring(result))
				task.wait(5)
				templates[name] = nil -- (tried again when next asked)
			end
		end)
	end
	return false
end

function CloudKit.copy(name: string): MeshPart?
	local t = templates[name]
	if not t then
		CloudKit.ready(name)
		return nil
	end
	return t.part:Clone()
end

-- Where the part goes for the unit box at cf (cf at the box's bottom middle, its look vector the
-- piece's front) sized `size` studs: its CFrame and Size.
function CloudKit.fit(name: string, cf: CFrame, size: Vector3): (CFrame?, Vector3?)
	local t = templates[name]
	if not t then
		return nil, nil
	end
	-- the part is turned half round so the piece's +z (its front) faces cf's look (a CFrame's -z):
	-- unit (x, y, z) lies at (-x, y, -z) in cf's own space
	local m = t.mid
	local centre = cf * Vector3.new(-m.X * size.X, m.Y * size.Y, -m.Z * size.Z)
	local rot = cf.Rotation * CFrame.Angles(0, math.pi, 0)
	return CFrame.new(centre) * rot, Vector3.new(t.ext.X * size.X, t.ext.Y * size.Y, t.ext.Z * size.Z)
end

-- Points on a piece's surface for detail puffs: up to `count` of its most open vertices (AO
-- above `minAo`: outer lobes, not creases), spread over the piece; unit-box position and normal.
-- (from the piece's data; cached)
local sampleCache: { [string]: { { p: Vector3, n: Vector3 } } } = {}
function CloudKit.samples(name: string, count: number, minAo: number): { { p: Vector3, n: Vector3 } }
	local key = name .. "/" .. count .. "/" .. minAo
	local cached = sampleCache[key]
	if cached then
		return cached
	end
	local out = {}
	local folder = script:FindFirstChild("Pieces")
	local mod = folder and folder:FindFirstChild(name)
	if mod and mod:IsA("ModuleScript") then
		local d = require(mod) :: any
		local n = d.vertices
		local stride = math.max(1, math.floor(n / (count * 3)))
		for i = 1, n, stride do
			if d.ao[i] >= minAo then
				table.insert(out, {
					p = Vector3.new(d.p[3 * i - 2], d.p[3 * i - 1], d.p[3 * i]),
					n = Vector3.new(d.n[3 * i - 2], d.n[3 * i - 1], d.n[3 * i]),
				})
			end
		end
		-- thin to `count`, evenly
		if #out > count then
			local thin = {}
			for j = 1, count do
				thin[j] = out[math.floor((j - 1) * #out / count) + 1]
			end
			out = thin
		end
	end
	sampleCache[key] = out
	return out
end

-- Where a unit-box point of a placed piece lies (cf, size as for CloudKit.fit), and its normal.
function CloudKit.surface(name: string, cf: CFrame, size: Vector3, p: Vector3, n: Vector3): (Vector3?, Vector3?)
	local t = templates[name]
	if not t then
		return nil, nil
	end
	-- (the same turn as fit: unit (x, y, z) lies at (-x, y, -z) in cf's own space)
	local local_ = Vector3.new(-p.X * size.X, p.Y * size.Y, -p.Z * size.Z)
	local normal = Vector3.new(-n.X / size.X, n.Y / size.Y, -n.Z / size.Z)
	return cf * local_, cf:VectorToWorldSpace(normal).Unit
end

function CloudKit.place(part: BasePart, name: string, cf: CFrame, size: Vector3)
	local c, s = CloudKit.fit(name, cf, size)
	if c and s then
		part.Size = s
		part.CFrame = c
	end
end

return CloudKit
