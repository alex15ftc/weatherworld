--!nonstrict
-- The skinned trees (2026-11-11). Every tree the chunk generator stood up comes with its chunk
-- (Workspace.WorldProps.<chunk> "Trees", Shared/Foliage/Records); this client draws each one as
--   mesh      within meshDistance: a clone of its generated tree (ReplicatedStorage.
--             FoliageTemplates.<name>: a skinned MeshPart and its Bones, put there by
--             FoliageService), turned and scaled, with a trunk collider; its bones swayed by the
--             wind (Shared/Foliage/Sway) while within animDistance and in view;
--   impostor  beyond, to impostorDistance: a billboard of the tree (one of its 8 rendered views,
--             the one facing the camera), turned to face the camera;
--   pieces    once anything on it broke (the chunk's "TreeDamage", written by FoliageService):
--             one MeshPart a rig bone ("Piece_<bone>": the faces that bone moved, cut from the
--             same mesh), the standing ones still swaying rigidly, the broken part falling to the
--             rest Mechanics.rest gives every machine alike. The swap happens at the tree's
--             current pose, so the first frame of the pieces is the last of the skinned tree.
-- Hand-placed trees tagged FoliageTree (CollectionService; a Model holding the skinned MeshPart
-- "Tree", attribute Kind = a generated tree's name) sway the same way.
--
-- The work a frame stays within budgetMs: trees are kept in a spatial hash (cell studs a side;
-- the wind is sampled once a cell), classified a slice at a time, and animated round-robin in
-- batches whose size follows the time each batch took (adaptive). A tree that stops animating
-- has its bones set back once and is left alone (dormant) until it is near again.
-- Settings live on ReplicatedStorage.FoliageSettings (Shared/Foliage/Profiles; the plugin edits
-- them); metrics go to the LocalPlayer's "FoliageMetrics" attribute (JSON) once a second.
local CollectionService = game:GetService("CollectionService")
local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local Shared = ReplicatedStorage.Shared
local Config = require(Shared.World.Config)
local Profiler = require(Shared.Profiler)
local Foliage = Shared.Foliage
local Rig = require(Foliage.Rig)
local Sway = require(Foliage.Sway)
local Mechanics = require(Foliage.Mechanics)
local Records = require(Foliage.Records)
local Profiles = require(Foliage.Profiles)
local Assets = require(Foliage.Assets)

local FoliageController = {}

local K = Config.STUDS_PER_METRE -- studs a metre (the trees are true size)
local TAG = "FoliageTree"
local VIEWS = 8

local Weather = nil
local camera = workspace.CurrentCamera
local root = Instance.new("Folder")
root.Name = "Foliage"

-- settings (FoliageSettings attributes over the defaults)
local S = table.clone(Profiles.SETTINGS)
local settingsCfg: Configuration? = nil
local profileCache: { [string]: any } = {}

local function readSettings()
	settingsCfg = ReplicatedStorage:FindFirstChild("FoliageSettings") :: Configuration?
	for k, v in Profiles.SETTINGS do
		local a = settingsCfg and settingsCfg:GetAttribute(k)
		S[k] = if a ~= nil and type(a) == type(v) then a else v
	end
	profileCache = {}
end

local function profileFor(kind: string): any
	local p = profileCache[kind]
	if p then
		return p
	end
	local base = Profiles.KINDS[kind] or Profiles.DEFAULT
	local cfg = settingsCfg and (settingsCfg:FindFirstChild(kind) or settingsCfg:FindFirstChild("Default"))
	p = Profiles.read(cfg, base)
	profileCache[kind] = p
	return p
end

----------------------------------------------------------------------------------------------
-- Templates

type Template = {
	name: string,
	rig: any,
	rigModel: Model, -- the skinned MeshPart "Tree" and the RootPart holding the Bones
	footPivot: CFrame, -- the rig model's pivot from the tree's foot frame
	restTree: { CFrame }, -- each rig bone's rest frame from the foot frame (scale 1)
	relTree: { CFrame }, -- from its rig parent's (the root bone's: from the foot frame)
	restRot: { CFrame }, -- rotation only
	pieces: { [number]: MeshPart },
	pieceOff: { [number]: CFrame }, -- each piece from its bone's frame
	trunkR: number, trunkH: number, -- studs
}

local templates: { [string]: Template | false } = {}

local function template(name: string): Template?
	local t = templates[name]
	if t ~= nil then
		return t or nil
	end
	local folder = ReplicatedStorage:FindFirstChild("FoliageTemplates")
	local entry = folder and folder:FindFirstChild(name)
	local rigModel = entry and entry:FindFirstChild("Rig")
	local model = entry and entry:FindFirstChild("Pieces")
	if not (rigModel and model and rigModel:FindFirstChild("Tree")) then
		return nil -- (not there yet: try again later)
	end
	local rig = Rig.get(name)
	local bones = {}
	for i = 1, rig.n do
		local b = rigModel:FindFirstChild(rig.names[i], true)
		if not (b and b:IsA("Bone")) then
			warn(`[Foliage] {name}: bone {rig.names[i]} missing from the template`)
			templates[name] = false
			return nil
		end
		bones[i] = b
	end
	local foot = CFrame.new(bones[1].WorldPosition)
	local tp: Template = {
		name = name, rig = rig, rigModel = rigModel, footPivot = foot:ToObjectSpace(rigModel:GetPivot()), restTree = {}, relTree = {}, restRot = {},
		pieces = {}, pieceOff = {}, trunkR = rig.r0[1] * K, trunkH = (rig.ty[1] + (rig.ty[2] or rig.ty[1])) * 0.5 * K,
	}
	for i = 1, rig.n do
		local w = foot:ToObjectSpace(bones[i].WorldCFrame)
		tp.restTree[i] = w
		tp.restRot[i] = w.Rotation
		local p = rig.parent[i]
		tp.relTree[i] = if p > 0 then tp.restTree[p]:ToObjectSpace(w) else w
		local piece = model:FindFirstChild("Piece_" .. rig.names[i])
		if piece and piece:IsA("MeshPart") then
			tp.pieces[i] = piece
			tp.pieceOff[i] = bones[i].WorldCFrame:ToObjectSpace(piece.CFrame)
		end
	end
	templates[name] = tp
	return tp
end

local function scaled(cf: CFrame, s: number): CFrame
	return CFrame.new(cf.Position * s) * cf.Rotation
end

----------------------------------------------------------------------------------------------
-- Trees

type Tree = {
	key: string,
	name: string,
	kind: string,
	rig: any,
	frame: CFrame, -- the foot, turned by yaw
	yaw: number,
	scale: number,
	pos: Vector3, -- the crown's middle (for distance and view tests)
	radius: number,
	seed: number,
	mx: number, mz: number, -- metres (gust field)
	cell: any,
	mode: string, -- "none" | "impostor" | "mesh" | "pieces" | "tagged"
	want: string,
	dist: number,
	inView: boolean,
	mesh: Model?,
	bones: { Bone }?,
	collider: BasePart?,
	impostor: BasePart?,
	decals: { Decal }?,
	view: number,
	faceYaw: number,
	damage: { Records.Damage },
	alive: { boolean }?,
	parts: { [number]: BasePart }?,
	falling: { any }?,
	posed: boolean, -- bones moved off rest (set back when it stops)
	omega: any, -- the last pose (Sway.Out)
	active: boolean,
}

local trees: { [string]: Tree } = {}
local all: { Tree } = {}
local cells: { [number]: { trees: { Tree }, U: number, dx: number, dz: number, at: number, x: number, z: number } } = {}
local metrics = { trees = 0, mesh = 0, impostor = 0, pieces = 0, animated = 0, bonesUpdated = 0, loopMs = 0, loopMaxMs = 0, batch = 0, falling = 0 }

local function cellOf(x: number, z: number): any
	local cs = S.cell
	local i, j = math.floor(x / cs), math.floor(z / cs)
	local k = (i + 32768) * 65536 + (j + 32768)
	local c = cells[k]
	if not c then
		c = { trees = {}, U = 0, dx = 1, dz = 0, at = -1e9, x = (i + 0.5) * cs, z = (j + 0.5) * cs }
		cells[k] = c
	end
	return c
end

local function toLocal(dx: number, dz: number, yaw: number): (number, number)
	local c, s = math.cos(yaw), math.sin(yaw)
	return dx * c - dz * s, dx * s + dz * c
end

local function aliveFor(rig: any, damage: { Records.Damage }): { boolean }?
	if #damage == 0 then
		return nil
	end
	local st = { alive = table.create(rig.n, true), down = false }
	for _, d in damage do
		Mechanics.drop(rig, st :: any, if d.bone == 0 then 1 else d.bone)
	end
	return st.alive
end

local function destroyVisuals(t: Tree)
	for _, inst in { t.mesh, t.collider, t.impostor } do
		if inst then
			inst:Destroy()
		end
	end
	if t.parts then
		for _, p in t.parts do
			p:Destroy()
		end
	end
	t.mesh, t.bones, t.collider, t.impostor, t.decals, t.parts, t.falling = nil, nil, nil, nil, nil, nil, nil
	t.posed = false
	if t.mode ~= "tagged" then
		t.mode = "none"
	end
end

local function addTree(key: string, rec: Records.Tree, damage: { Records.Damage })
	local rig = Rig.get(rec.name)
	local frame = CFrame.new(rec.x, rec.y, rec.z) * CFrame.Angles(0, rec.yaw, 0)
	local h = rig.heightM * K * rec.scale
	local t: Tree = {
		key = key, name = rec.name, kind = rig.kind, rig = rig, frame = frame, yaw = rec.yaw, scale = rec.scale,
		pos = Vector3.new(rec.x, rec.y + h * 0.55, rec.z), radius = h * 0.6, seed = #all + 17,
		mx = rec.x / K, mz = rec.z / K, cell = nil, mode = "none", want = "none", dist = math.huge, inView = true,
		view = -1, faceYaw = 1e9, damage = damage, alive = aliveFor(rig, damage), posed = false, omega = Sway.newOut(rig.n), active = false,
	}
	-- (the seed from the place, so every client sways a tree alike)
	t.seed = (math.floor(rec.x * 7.31) * 73856093 + math.floor(rec.z * 3.17) * 19349663) % 2147483647
	t.cell = cellOf(rec.x, rec.z)
	table.insert(t.cell.trees, t)
	trees[key] = t
	table.insert(all, t)
	return t
end

local function removeTree(t: Tree)
	destroyVisuals(t)
	trees[t.key] = nil
	local i = table.find(all, t)
	if i then
		all[i] = all[#all]
		all[#all] = nil
	end
	local list = t.cell.trees
	local j = table.find(list, t)
	if j then
		list[j] = list[#list]
		list[#list] = nil
	end
end

----------------------------------------------------------------------------------------------
-- Building the visuals

local function makeMesh(t: Tree, tp: Template): boolean
	local m = tp.rigModel:Clone()
	m.Name = t.key
	if t.scale ~= 1 then
		m:ScaleTo(m:GetScale() * t.scale)
	end
	m:PivotTo(t.frame * scaled(tp.footPivot, t.scale))
	local bones = {}
	for i = 1, t.rig.n do
		bones[i] = m:FindFirstChild(t.rig.names[i], true) :: Bone
	end
	-- the trunk: a cylinder the height of its first two bones (the crown does not collide)
	local col = Instance.new("Part")
	col.Shape = Enum.PartType.Cylinder
	col.Size = Vector3.new(tp.trunkH * t.scale, tp.trunkR * 2 * t.scale, tp.trunkR * 2 * t.scale)
	col.CFrame = t.frame * CFrame.new(0, tp.trunkH * t.scale / 2, 0) * CFrame.Angles(0, 0, math.pi / 2)
	col.Anchored = true
	col.Transparency = 1
	col.CastShadow = false
	col.CanTouch = false
	col.Parent = m
	m.Parent = root
	t.mesh, t.bones, t.collider = m, bones, col
	t.mode = "mesh"
	t.posed = false
	return true
end

local function makeImpostor(t: Tree): boolean
	local ids = Assets.trees[t.name]
	local imp = t.rig.impostor
	if not (ids and imp and ids.impostor and #ids.impostor >= VIEWS) then
		return false
	end
	local w, h = imp.widthM * K * t.scale, imp.heightM * K * t.scale
	local p = Instance.new("Part")
	p.Name = t.key
	p.Size = Vector3.new(w, h, 0.05)
	p.Anchored = true
	p.CanCollide = false
	p.CanQuery = false
	p.CanTouch = false
	p.CastShadow = false
	p.Transparency = 1
	local decals = {}
	for _, face in { Enum.NormalId.Front, Enum.NormalId.Back } do
		local d = Instance.new("Decal")
		d.Face = face
		d.Parent = p
		table.insert(decals, d)
	end
	p:SetAttribute("CentreY", h / 2 - imp.baseM * K * t.scale)
	p.CFrame = t.frame * CFrame.new(0, h / 2 - imp.baseM * K * t.scale, 0)
	p.Parent = root
	t.impostor, t.decals, t.view, t.faceYaw = p, decals, -1, 1e9
	t.mode = "impostor"
	return true
end

-- every bone's world frame now (forward kinematics from the last pose)
local function boneFrames(t: Tree, tp: Template, omega: any?): { CFrame }
	local out = {}
	local s = t.scale
	for i = 1, t.rig.n do
		local p = t.rig.parent[i]
		local T = CFrame.identity
		if omega then
			local w = Vector3.new(omega.x[i], omega.y[i], omega.z[i])
			local a = w.Magnitude
			if a > 1e-7 then
				T = CFrame.fromAxisAngle(tp.restRot[i]:VectorToObjectSpace(w / a), a)
			end
		end
		local parentW = if p > 0 then out[p] else t.frame
		out[i] = parentW * scaled(tp.relTree[i], s) * T
	end
	return out
end

-- a fall's turn and shift (tree-local studs) after tt s
local function fallFrame(t: Tree, r: any, tt: number): CFrame
	local a, sf = Mechanics.fallAt(r, tt)
	local k = K * t.scale
	local P = Vector3.new(r.px, r.py, r.pz) * k
	local O = Vector3.new(r.ox, r.oy, r.oz) * k * sf
	return CFrame.new(P + O) * CFrame.fromAxisAngle(Vector3.new(r.ax, r.ay, r.az), a) * CFrame.new(-P)
end

local flat = function(_x: number, _z: number): number
	return 0
end

-- the tree as its pieces: standing ones where the pose has them, broken parts falling or down
local function makePieces(t: Tree, tp: Template, fromPose: boolean)
	local frames = boneFrames(t, tp, if fromPose and t.posed then t.omega else nil)
	local parts = {}
	local m = t.mesh or Instance.new("Model")
	m.Name = t.key
	for i, src in tp.pieces do
		local p = src:Clone()
		p.Anchored = true
		p.CanTouch = false
		local trunk = t.rig.tier[i] == 0
		p.CanCollide = trunk
		p.CanQuery = trunk
		if t.scale ~= 1 then
			p.Size *= t.scale
		end
		p.CFrame = frames[i] * scaled(tp.pieceOff[i], t.scale)
		p.Parent = m
		parts[i] = p
	end
	-- the broken parts: each break moves what it took (and was still standing then)
	local now = workspace:GetServerTimeNow()
	local standing = table.create(t.rig.n, true)
	local falling = {}
	local sorted = table.clone(t.damage)
	table.sort(sorted, function(a, b)
		return a.at < b.at
	end)
	for _, d in sorted do
		local lx, lz = toLocal(d.dirX, d.dirZ, t.yaw)
		local r = Mechanics.rest(t.rig, d.bone, lx, lz, d.gust, flat)
		local group = {}
		for _, i in Mechanics.partBones(t.rig, d.bone) do
			if standing[i] and parts[i] then
				table.insert(group, { part = parts[i], start = t.frame:ToObjectSpace(parts[i].CFrame) })
			end
			standing[i] = false
		end
		local tt = now - d.at
		local f = { rest = r, at = d.at, group = group, done = tt >= r.fallS }
		for _, g in group do
			g.part.CFrame = t.frame * fallFrame(t, r, tt) * g.start
		end
		if not f.done then
			table.insert(falling, f)
		end
	end
	if t.collider then
		t.collider:Destroy()
		t.collider = nil
	end
	for _, c in m:GetChildren() do
		if not (c:IsA("BasePart") and string.match(c.Name, "^Piece_")) then
			c:Destroy() -- (the skinned tree and its rig)
		end
	end
	m.Parent = root
	t.mesh, t.bones, t.parts, t.falling = m, nil, parts, falling
	t.mode = "pieces"
end

local function setMode(t: Tree, want: string): boolean
	if t.mode == want or t.mode == "tagged" then
		return true
	end
	local tp = template(t.name)
	if want == "mesh" or want == "pieces" then
		if not tp then
			return false
		end
		destroyVisuals(t)
		if #t.damage > 0 then
			makePieces(t, tp, false)
		else
			makeMesh(t, tp)
		end
		return true
	elseif want == "impostor" then
		destroyVisuals(t)
		return makeImpostor(t)
	end
	destroyVisuals(t)
	return true
end

----------------------------------------------------------------------------------------------
-- Chunks

local chunkConns: { [Instance]: { RBXScriptConnection } } = {}
local chunkTrees: { [Instance]: { Tree } } = {}

local function readDamage(model: Instance): { [number]: { Records.Damage } }
	local by = {}
	local s = model:GetAttribute("TreeDamage")
	if type(s) == "string" then
		for _, d in Records.decodeDamage(s) do
			by[d.tree] = by[d.tree] or {}
			table.insert(by[d.tree], d)
		end
	end
	return by
end

local function damageChanged(model: Instance)
	local list = chunkTrees[model]
	if not list then
		return
	end
	local by = readDamage(model)
	for i, t in list do
		local d = by[i] or {}
		if #d ~= #t.damage then
			t.damage = d
			t.alive = aliveFor(t.rig, d)
			if t.mode == "mesh" or t.mode == "pieces" then
				local tp = template(t.name)
				if tp then
					-- (from the pose it shows now: a seamless swap)
					local keep = t.mesh
					if t.mode == "pieces" and t.parts then
						for _, p in t.parts do
							p:Destroy()
						end
						t.parts = nil
					end
					t.mesh = keep
					makePieces(t, tp, true)
				end
			end
		end
	end
end

local function addChunk(model: Instance)
	if chunkTrees[model] or not model:IsA("Model") then
		return
	end
	local text = model:GetAttribute("Trees")
	if type(text) ~= "string" then
		return
	end
	local by = readDamage(model)
	local list = {}
	for i, rec in Records.decodeTrees(text) do
		local ok, t = pcall(addTree, model.Name .. "#" .. i, rec, by[i] or {})
		if ok then
			list[i] = t
		end
	end
	chunkTrees[model] = list
	chunkConns[model] = { model:GetAttributeChangedSignal("TreeDamage"):Connect(function()
		damageChanged(model)
	end) }
end

local function removeChunk(model: Instance)
	local list = chunkTrees[model]
	if list then
		for _, t in list do
			removeTree(t)
		end
	end
	chunkTrees[model] = nil
	for _, c in chunkConns[model] or {} do
		c:Disconnect()
	end
	chunkConns[model] = nil
end

-- hand-placed trees
local function addTagged(inst: Instance)
	local name = inst:GetAttribute("Kind")
	local tree = inst:FindFirstChild("Tree", true)
	if type(name) ~= "string" or not (tree and tree:IsA("MeshPart")) then
		return
	end
	local ok, rig = pcall(Rig.get, name)
	if not ok then
		warn(`[Foliage] {inst:GetFullName()}: no generated tree {name}`)
		return
	end
	local bones = {}
	for i = 1, rig.n do
		local b = inst:FindFirstChild(rig.names[i], true)
		if not b then
			warn(`[Foliage] {inst:GetFullName()}: bone {rig.names[i]} missing`)
			return
		end
		bones[i] = b
	end
	local foot = bones[1].WorldPosition
	local look = tree.CFrame.LookVector
	local yaw = math.atan2(-look.X, -look.Z)
	local t = addTree("tag:" .. inst:GetDebugId(), { x = foot.X, y = foot.Y, z = foot.Z, name = name, scale = 1, yaw = yaw }, {})
	t.mode = "tagged"
	t.bones = bones
	t.mesh = nil
	t.tagged = inst
end

local function removeTagged(inst: Instance)
	local t = trees["tag:" .. inst:GetDebugId()]
	if t then
		t.mode = "none"
		t.bones = nil
		removeTree(t)
	end
end

----------------------------------------------------------------------------------------------
-- The loop

local classifyAt = 1
local impostorAt = 1
local activeList: { Tree } = {}
local animCursor = 1
local batch = Profiles.SETTINGS.batch
local lastActive = 0
local lastSettings = 0
local lastMetrics = 0

local function windFor(c: any, now: number): (number, number, number)
	if S.source == "manual" then
		local a = math.rad(S.manualDirection)
		-- (direction: the way it blows toward, 0 north = -Z, 90 east = +X)
		return S.manualWind, math.sin(a), -math.cos(a)
	end
	if now - c.at > 0.5 then
		c.at = now
		if Weather then
			c.U, c.dx, c.dz = Weather.windAtStuds(c.x, c.z)
		end
	end
	return c.U, c.dx, c.dz
end

local function inView(t: Tree, camCF: CFrame, tanHalf: number): boolean
	if not S.frustum then
		return true
	end
	local d = t.pos - camCF.Position
	local dist = d.Magnitude
	if dist < t.radius + S.frustumMargin then
		return true
	end
	local along = d:Dot(camCF.LookVector)
	if along <= -t.radius then
		return false
	end
	-- inside the view cone widened by the tree's size and the margin
	local half = math.atan(tanHalf) + math.atan((t.radius + S.frustumMargin) / dist)
	return along / dist >= math.cos(math.min(half, math.pi))
end

local function classify(budget: number)
	local camPos = camera.CFrame.Position
	local n = #all
	if n == 0 then
		return
	end
	local changes = 0
	for _ = 1, math.min(budget, n) do
		if classifyAt > n then
			classifyAt = 1
		end
		local t = all[classifyAt]
		classifyAt += 1
		local d = (t.pos - camPos).Magnitude
		t.dist = d
		if t.mode == "tagged" then
			continue
		end
		local want = if d < S.meshDistance then "mesh" elseif d < S.impostorDistance then "impostor" else "none"
		if want == "impostor" and not (Assets.trees[t.name] and Assets.trees[t.name].impostor) then
			want = "none"
		end
		local cur = if t.mode == "pieces" then "mesh" else t.mode
		if want ~= cur and changes < 8 then
			changes += 1
			setMode(t, want)
		end
	end
end

local function faceImpostors(budget: number)
	local camPos = camera.CFrame.Position
	local parts, cfs = {}, {}
	local n = #all
	for _ = 1, math.min(budget, n) do
		if impostorAt > n then
			impostorAt = 1
		end
		local t = all[impostorAt]
		impostorAt += 1
		local p = t.impostor
		if not p then
			continue
		end
		local v = camPos - t.frame.Position
		local face = math.atan2(v.X, v.Z)
		if math.abs(((face - t.faceYaw + math.pi) % (2 * math.pi)) - math.pi) > math.rad(4) then
			t.faceYaw = face
			local centre = t.frame.Position + Vector3.new(0, p:GetAttribute("CentreY") or 0, 0)
			table.insert(parts, p)
			-- (Front, -Z, toward the camera)
			table.insert(cfs, CFrame.new(centre) * CFrame.Angles(0, face + math.pi, 0))
			-- the view nearest the camera's side of the tree (view k seen from the tree's
			-- -z side turned k/8 of a turn: tools/blender/foliage_trees.py)
			local lx, lz = toLocal(v.X, v.Z, t.yaw)
			-- (view k is seen from tree-local (-sin a, 0, -cos a), a = k/8 of a turn)
			local k = math.floor(math.atan2(-lx, -lz) / (2 * math.pi) * VIEWS + 0.5) % VIEWS
			if k ~= t.view then
				t.view = k
				local id = Assets.trees[t.name].impostor[k + 1]
				for _, d in t.decals :: { Decal } do
					d.Texture = "rbxassetid://" .. id
				end
			end
		end
	end
	if #parts > 0 then
		workspace:BulkMoveTo(parts, cfs, Enum.BulkMoveMode.FireCFrameChanged)
	end
end

local function rebuildActive()
	local camCF = camera.CFrame
	local vfov = math.rad(camera.FieldOfView) / 2
	local vp = camera.ViewportSize
	local tanHalf = math.tan(vfov) * math.max(1, vp.X / math.max(vp.Y, 1))
	local list = {}
	for _, t in all do
		local animatable = (t.mode == "mesh" or t.mode == "pieces" or t.mode == "tagged") and t.dist < S.animDistance
		t.inView = animatable and inView(t, camCF, tanHalf)
		local on = animatable and t.inView
		if on then
			table.insert(list, t)
		elseif t.active then
			t.active = false
			-- dormant: back to rest once
			if t.posed and t.bones then
				for _, b in t.bones do
					b.Transform = CFrame.identity
				end
			end
			t.posed = false
		end
		t.active = on
	end
	activeList = list
	if animCursor > #list then
		animCursor = 1
	end
end

local function animate(t: Tree, now: number)
	local tp = template(t.name)
	if not tp then
		return 0
	end
	local U, dx, dz = windFor(t.cell, now)
	local lx, lz = toLocal(dx, dz, t.yaw)
	local lod = if t.dist < S.lodLimbs then 2 elseif t.dist < S.lodTrunk then 1 else 0
	local fade = math.clamp((S.animDistance - t.dist) / math.max(S.fadeDistance, 1), 0, 1)
	local out = Sway.pose(t.rig, U, lx, lz, now, t.mx, t.mz, t.seed, t.alive, lod, profileFor(t.kind), t.omega)
	if fade < 1 then
		for i = 1, t.rig.n do
			out.x[i] *= fade
			out.y[i] *= fade
			out.z[i] *= fade
		end
	end
	local count = 0
	if t.bones then
		for i, b in t.bones do
			local w = Vector3.new(out.x[i], out.y[i], out.z[i])
			local a = w.Magnitude
			b.Transform = if a > 1e-7 then CFrame.fromAxisAngle(tp.restRot[i]:VectorToObjectSpace(w / a), a) else CFrame.identity
			count += 1
		end
		t.posed = true
	elseif t.parts then
		-- the standing pieces, rigidly
		local frames = boneFrames(t, tp, out)
		local parts, cfs = {}, {}
		for i, p in t.parts do
			if not t.alive or t.alive[i] then
				table.insert(parts, p)
				table.insert(cfs, frames[i] * scaled(tp.pieceOff[i], t.scale))
			end
		end
		if #parts > 0 then
			workspace:BulkMoveTo(parts, cfs, Enum.BulkMoveMode.FireCFrameChanged)
		end
		count = #parts
		t.posed = true
	end
	return count
end

local function stepFalls(now: number)
	local nFalling = 0
	for _, t in all do
		local list = t.falling
		if not list or #list == 0 then
			continue
		end
		local parts, cfs = {}, {}
		for k = #list, 1, -1 do
			local f = list[k]
			local tt = now - f.at
			local F = t.frame * fallFrame(t, f.rest, tt)
			for _, g in f.group do
				table.insert(parts, g.part)
				table.insert(cfs, F * g.start)
			end
			if tt >= f.rest.fallS then
				table.remove(list, k)
			end
		end
		nFalling += #list
		if #parts > 0 then
			workspace:BulkMoveTo(parts, cfs, Enum.BulkMoveMode.FireCFrameChanged)
		end
	end
	metrics.falling = nFalling
end

local function step()
	local t0 = os.clock()
	local now = workspace:GetServerTimeNow()
	if now - lastSettings > 0.5 then
		lastSettings = now
		readSettings()
	end
	Profiler.Begin("Foliage")
	classify(400)
	faceImpostors(600)
	if now - lastActive > 0.25 then
		lastActive = now
		rebuildActive()
	end
	stepFalls(now)
	-- the sway: a batch of trees, round-robin, within the budget
	local n = #activeList
	local done, bones = 0, 0
	local budget = S.budgetMs / 1000
	local limit = if S.adaptive then batch else S.batch
	local tA = os.clock()
	while done < math.min(limit, n) do
		if animCursor > n then
			animCursor = 1
		end
		local t = activeList[animCursor]
		animCursor += 1
		bones += animate(t, now)
		done += 1
		if os.clock() - tA > budget * 1.5 then
			break
		end
	end
	local spent = os.clock() - tA
	if S.adaptive and done > 0 then
		-- grow while under budget, shrink when over (each tree's share as measured)
		local per = spent / done
		local fit = math.floor(budget / math.max(per, 1e-6))
		batch = math.clamp(math.floor(batch + 0.25 * (fit - batch) + 0.5), 2, math.max(2, n))
	end
	Profiler.End()
	local ms = (os.clock() - t0) * 1000
	metrics.loopMs = metrics.loopMs * 0.95 + ms * 0.05
	metrics.loopMaxMs = math.max(metrics.loopMaxMs * 0.999, ms)
	metrics.bonesUpdated = metrics.bonesUpdated * 0.9 + bones * 0.1
	metrics.batch = batch
	metrics.animated = n
	if now - lastMetrics > 1 then
		lastMetrics = now
		local m, imp, pc = 0, 0, 0
		for _, t in all do
			if t.mode == "mesh" or t.mode == "tagged" then
				m += 1
			elseif t.mode == "impostor" then
				imp += 1
			elseif t.mode == "pieces" then
				pc += 1
			end
		end
		metrics.trees, metrics.mesh, metrics.impostor, metrics.pieces = #all, m, imp, pc
		local lp = Players.LocalPlayer
		if lp then
			lp:SetAttribute("FoliageMetrics", HttpService:JSONEncode(metrics))
		end
	end
end

function FoliageController.metrics()
	return metrics
end

function FoliageController.Init()
	readSettings()
end

function FoliageController.Start()
	local ok, w = pcall(require, script.Parent.WeatherController)
	Weather = if ok then w else nil
	root.Parent = workspace
	local props = workspace:WaitForChild("WorldProps", 30)
	if props then
		for _, m in props:GetChildren() do
			addChunk(m)
		end
		props.ChildAdded:Connect(function(m)
			-- (its attribute may come a moment after it)
			if m:GetAttribute("Trees") == nil then
				task.delay(0.5, addChunk, m)
			else
				addChunk(m)
			end
		end)
		props.ChildRemoved:Connect(removeChunk)
	end
	for _, inst in CollectionService:GetTagged(TAG) do
		addTagged(inst)
	end
	CollectionService:GetInstanceAddedSignal(TAG):Connect(addTagged)
	CollectionService:GetInstanceRemovedSignal(TAG):Connect(removeTagged)
	RunService.Heartbeat:Connect(function()
		local okStep, err = pcall(step)
		if not okStep then
			warn("[Foliage] " .. tostring(err))
		end
	end)
end

return FoliageController
