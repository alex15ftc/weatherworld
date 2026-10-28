--!nonstrict
-- The lab's test town (guide section 5): houses, mobile homes, farm buildings, trees and power
-- poles, each built from parts tagged by the EF damage component they belong to
-- (Damage.DI tables). The server loads every structure with the simulated wind (a 3-s mean at
-- mid-height; roof parts add the updraft), lets Damage decide which components fail, and shows the
-- staged result: failed parts disappear, buildings shift or roll, trees fall or snap, and each
-- failed component releases its debris (ServerDebris) into the same wind.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Workspace = game:GetService("Workspace")

local lab = ReplicatedStorage:WaitForChild("StormLab")
local Sim = lab:WaitForChild("Sim")
local LabConfig = require(lab:WaitForChild("LabConfig"))
local Damage = require(Sim:WaitForChild("Damage"))
local Noise = require(Sim:WaitForChild("Noise"))

local Town = {}
Town.__index = Town

-- The town is laid out in METRES: builders compose CFrames in "metre space" (Roblox axes, 1 unit =
-- 1 m; mspace below) and part / wedge scale sizes and positions to studs (LabConfig.SCALE).
local K = LabConfig.SCALE

-- a metre position in Roblox axes, unscaled (metre space: the builders' frame)
local function mspace(x: number, y: number, z: number): Vector3
	return LabConfig.toWorld(x, y, z) / K
end

-- a metre-space CFrame as a stud CFrame (same rotation, position scaled)
local function toStuds(cf: CFrame): CFrame
	return cf.Rotation + cf.Position * K
end

local function part(parent: Instance, size: Vector3, cf: CFrame, colour: Color3, material: Enum.Material, group: string?): BasePart
	local p = Instance.new("Part")
	p.Anchored = true
	p.Size = size * K
	p.CFrame = toStuds(cf)
	p.Color = colour
	p.Material = material
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	p.CastShadow = true
	if group then
		p:SetAttribute("Group", group)
	end
	p.Parent = parent
	return p
end

local function wedge(parent: Instance, size: Vector3, cf: CFrame, colour: Color3, material: Enum.Material, group: string?): BasePart
	local p = Instance.new("WedgePart")
	p.Anchored = true
	p.Size = size * K
	p.CFrame = toStuds(cf)
	p.Color = colour
	p.Material = material
	if group then
		p:SetAttribute("Group", group)
	end
	p.Parent = parent
	return p
end

local function rgb(r, g, b)
	return Color3.fromRGB(r, g, b)
end

-- A house: slab, eight exterior wall panels, interior walls, windows, a garage door, trim,
-- roof sheathing and covering (two slopes), roof framing.
local function buildHouse(model: Model, origin: CFrame, rng: any)
	local W, D, H = 12, 10, 3
	local wallC = ({ rgb(222, 214, 196), rgb(196, 204, 210), rgb(214, 196, 170), rgb(170, 186, 168) })[rng:int(1, 4)]
	local roofC = ({ rgb(70, 66, 64), rgb(96, 70, 60), rgb(60, 70, 84) })[rng:int(1, 3)]
	part(model, Vector3.new(W + 0.6, 0.3, D + 0.6), origin * CFrame.new(0, 0.15, 0), rgb(160, 158, 152), Enum.Material.Concrete, "slab")
	-- exterior walls in halves: which collapse when is the DOD order
	local t = 0.25
	local panels = {
		{ Vector3.new(W / 2, H, t), CFrame.new(-W / 4, 0.3 + H / 2, D / 2), "extWalls" },
		{ Vector3.new(W / 2, H, t), CFrame.new(W / 4, 0.3 + H / 2, D / 2), "extWalls" },
		{ Vector3.new(W / 2, H, t), CFrame.new(-W / 4, 0.3 + H / 2, -D / 2), "extWalls" },
		{ Vector3.new(W / 2, H, t), CFrame.new(W / 4, 0.3 + H / 2, -D / 2), "intWalls" },
		{ Vector3.new(t, H, D / 2), CFrame.new(W / 2, 0.3 + H / 2, -D / 4), "extWalls" },
		{ Vector3.new(t, H, D / 2), CFrame.new(W / 2, 0.3 + H / 2, D / 4), "extWalls" },
		{ Vector3.new(t, H, D / 2), CFrame.new(-W / 2, 0.3 + H / 2, -D / 4), "intWalls" },
		{ Vector3.new(t, H, D / 2), CFrame.new(-W / 2, 0.3 + H / 2, D / 4), "allWalls" },
	}
	for _, pnl in panels do
		part(model, pnl[1], origin * pnl[2], wallC, Enum.Material.WoodPlanks, pnl[3])
	end
	-- interior walls (the small interior room survives longest)
	part(model, Vector3.new(t, H, D * 0.6), origin * CFrame.new(0.5, 0.3 + H / 2, 0), rgb(232, 226, 214), Enum.Material.SmoothPlastic, "allWalls")
	part(model, Vector3.new(W * 0.4, H, t), origin * CFrame.new(-2.5, 0.3 + H / 2, -1), rgb(232, 226, 214), Enum.Material.SmoothPlastic, "intWalls")
	-- windows and the garage door
	for _, wpos in { CFrame.new(-3, 0.3 + 1.6, D / 2 + 0.14), CFrame.new(3, 0.3 + 1.6, D / 2 + 0.14), CFrame.new(-3, 0.3 + 1.6, -D / 2 - 0.14), CFrame.new(W / 2 + 0.14, 0.3 + 1.6, 2) } do
		local g = part(model, Vector3.new(1.4, 1.2, 0.05), origin * wpos, rgb(120, 150, 170), Enum.Material.Glass, "windows")
		g.Transparency = 0.3
		if wpos.Position.X > W / 2 - 0.1 then
			g.Size = Vector3.new(0.05, 1.2, 1.4) * K
		end
	end
	part(model, Vector3.new(0.08, 2.2, 2.6), origin * CFrame.new(-W / 2 - 0.15, 0.3 + 1.1, -2.5), rgb(236, 236, 230), Enum.Material.Metal, "roofDeck")
	-- roof: framing (wedges), sheathing and covering slightly above it
	local rise = 2.2
	local half = D / 2 + 0.4
	for side = -1, 1, 2 do
		local cf = origin * CFrame.new(0, 0.3 + H + rise / 2, side * half / 2) * CFrame.Angles(0, if side < 0 then math.pi else 0, 0)
		wedge(model, Vector3.new(W + 0.8, rise, half), cf, rgb(150, 120, 90), Enum.Material.Wood, "roofFrame")
		-- sheathing / covering: thin slabs along the slope
		local slope = math.atan2(rise, half)
		local len = math.sqrt(rise * rise + half * half)
		local sc = origin * CFrame.new(0, 0.3 + H + rise / 2 + 0.06, side * half / 2) * CFrame.Angles(side * slope, 0, 0)
		part(model, Vector3.new(W + 0.9, 0.06, len), sc, rgb(176, 150, 112), Enum.Material.Wood, "roofDeck")
		part(model, Vector3.new(W + 1.0, 0.06, len + 0.05), sc * CFrame.new(0, 0.07, 0), roofC, Enum.Material.Slate, "roofCover")
	end
	-- trim: gutters and a chimney
	part(model, Vector3.new(W + 1.0, 0.15, 0.15), origin * CFrame.new(0, 0.3 + H, D / 2 + 0.45), rgb(240, 240, 236), Enum.Material.Metal, "trim")
	part(model, Vector3.new(W + 1.0, 0.15, 0.15), origin * CFrame.new(0, 0.3 + H, -D / 2 - 0.45), rgb(240, 240, 236), Enum.Material.Metal, "trim")
	part(model, Vector3.new(0.9, 2.2, 0.9), origin * CFrame.new(W / 3, 0.3 + H + 1.6, 1.2), rgb(140, 70, 54), Enum.Material.Brick, "roofDeck")
	return 0.3 + H + rise
end

local function buildMobileHome(model: Model, origin: CFrame, rng: any)
	local L, Wd, H = 20, 4.3, 3
	local c = ({ rgb(226, 226, 214), rgb(200, 214, 220), rgb(232, 222, 200) })[rng:int(1, 3)]
	part(model, Vector3.new(L, 0.6, Wd), origin * CFrame.new(0, 0.6, 0), rgb(90, 90, 90), Enum.Material.Metal, "allWalls")
	part(model, Vector3.new(L, H, 0.15), origin * CFrame.new(0, 0.9 + H / 2, Wd / 2), c, Enum.Material.CorrodedMetal, "extWalls")
	part(model, Vector3.new(L, H, 0.15), origin * CFrame.new(0, 0.9 + H / 2, -Wd / 2), c, Enum.Material.CorrodedMetal, "extWalls")
	part(model, Vector3.new(0.15, H, Wd), origin * CFrame.new(L / 2, 0.9 + H / 2, 0), c, Enum.Material.CorrodedMetal, "extWalls")
	part(model, Vector3.new(0.15, H, Wd), origin * CFrame.new(-L / 2, 0.9 + H / 2, 0), c, Enum.Material.CorrodedMetal, "allWalls")
	part(model, Vector3.new(L + 0.3, 0.2, Wd + 0.3), origin * CFrame.new(0, 0.9 + H + 0.1, 0), rgb(200, 200, 196), Enum.Material.Metal, "roofFrame")
	part(model, Vector3.new(L + 0.4, 0.05, Wd + 0.4), origin * CFrame.new(0, 0.9 + H + 0.23, 0), rgb(214, 214, 210), Enum.Material.Metal, "roofCover")
	part(model, Vector3.new(L, 0.8, 0.05), origin * CFrame.new(0, 0.4, Wd / 2 + 0.05), rgb(180, 176, 166), Enum.Material.Metal, "trim")
	return 0.9 + H
end

local function buildBarn(model: Model, origin: CFrame, rng: any)
	local L, Wd, H = 24, 14, 5
	local c = ({ rgb(140, 40, 32), rgb(160, 160, 156), rgb(120, 110, 96) })[rng:int(1, 3)]
	part(model, Vector3.new(L, 0.2, Wd), origin * CFrame.new(0, 0.1, 0), rgb(110, 100, 88), Enum.Material.Ground, "slab")
	part(model, Vector3.new(L, H, 0.2), origin * CFrame.new(0, H / 2, Wd / 2), c, Enum.Material.CorrodedMetal, "extWalls")
	part(model, Vector3.new(L, H, 0.2), origin * CFrame.new(0, H / 2, -Wd / 2), c, Enum.Material.CorrodedMetal, "allWalls")
	part(model, Vector3.new(0.2, H, Wd), origin * CFrame.new(L / 2, H / 2, 0), c, Enum.Material.CorrodedMetal, "extWalls")
	part(model, Vector3.new(0.2, H * 0.8, Wd * 0.5), origin * CFrame.new(-L / 2, H * 0.4, 0), rgb(90, 70, 50), Enum.Material.WoodPlanks, "windows")
	part(model, Vector3.new(0.2, H, Wd), origin * CFrame.new(-L / 2 - 0.05, H / 2, 0), c, Enum.Material.CorrodedMetal, "allWalls")
	for side = -1, 1, 2 do
		local rise, half = 3, Wd / 2 + 0.3
		local slope = math.atan2(rise, half)
		local len = math.sqrt(rise * rise + half * half)
		local sc = origin * CFrame.new(0, H + rise / 2, side * half / 2) * CFrame.Angles(side * slope, 0, 0)
		part(model, Vector3.new(L + 0.6, 0.25, len), sc, rgb(120, 110, 100), Enum.Material.Wood, "roofFrame")
		part(model, Vector3.new(L + 0.7, 0.05, len + 0.05), sc * CFrame.new(0, 0.15, 0), rgb(176, 180, 184), Enum.Material.CorrodedMetal, "roofCover")
	end
	return H + 3
end

local function buildTree(model: Model, origin: CFrame, rng: any)
	local h = rng:range(9, 16)
	local trunkH = h * 0.45
	local tr = rng:range(0.25, 0.4)
	local trunk = part(model, Vector3.new(trunkH, tr * 2, tr * 2), origin * CFrame.new(0, trunkH / 2, 0) * CFrame.Angles(0, 0, math.pi / 2), rgb(76, 60, 44), Enum.Material.Wood, "stem")
	trunk.Shape = Enum.PartType.Cylinder
	local upper = part(model, Vector3.new(h * 0.3, tr * 1.4, tr * 1.4), origin * CFrame.new(0, trunkH + h * 0.15, 0) * CFrame.Angles(0, 0, math.pi / 2), rgb(76, 60, 44), Enum.Material.Wood, "trunk")
	upper.Shape = Enum.PartType.Cylinder
	local green = rgb(math.floor(56 * rng:range(0.85, 1.1)), math.floor(82 * rng:range(0.85, 1.1)), math.floor(40 * rng:range(0.85, 1.1)))
	local crowns = { { "limbs", 0.55 }, { "branches", 0.75 }, { "debark", 0.9 } }
	for i, c in crowns do
		local r = h * 0.28 * (1.15 - i * 0.12)
		local off = Vector3.new(rng:range(-0.8, 0.8), 0, rng:range(-0.8, 0.8))
		local s = part(model, Vector3.new(r * 2, r * 1.6, r * 2), origin * CFrame.new(off + Vector3.new(0, h * c[2], 0)), green, Enum.Material.Grass, c[1])
		s.Shape = Enum.PartType.Ball
		s.Size = Vector3.one * r * 2 * K
	end
	return h
end

local function buildPole(model: Model, origin: CFrame, _rng: any)
	local p = part(model, Vector3.new(12, 0.35, 0.35), origin * CFrame.new(0, 6, 0) * CFrame.Angles(0, 0, math.pi / 2), rgb(84, 66, 48), Enum.Material.Wood, "lean")
	p.Shape = Enum.PartType.Cylinder
	part(model, Vector3.new(2.6, 0.15, 0.15), origin * CFrame.new(0, 11.2, 0), rgb(84, 66, 48), Enum.Material.Wood, "wires")
	part(model, Vector3.new(0.3, 5.8, 0.3), origin * CFrame.new(0, 9, 0), rgb(84, 66, 48), Enum.Material.Wood, "snap")
	return 12
end

local BUILDERS = { house = buildHouse, mobileHome = buildMobileHome, barn = buildBarn, tree = buildTree, pole = buildPole }

-- Which parts a failed degree hides (by the group tags above), and special moves.
local HIDE = {
	trim = { "trim" }, roofCover = { "roofCover" }, windows = { "windows" }, roofDeck = { "roofDeck" },
	roofFrame = { "roofFrame", "roofDeck", "roofCover" }, extWalls = { "extWalls", "windows" },
	intWalls = { "intWalls" }, allWalls = { "allWalls", "intWalls", "extWalls" }, slab = { "slab" },
	limbs = { "limbs" }, branches = { "branches" }, debark = { "debark", "limbs", "branches" },
	trunk = { "trunk", "debark", "limbs", "branches" }, wires = { "wires" }, snap = { "snap", "wires" },
}

-- A new town centred on (cx, cy) in simulation metres, with the main street along `bearing`
-- (radians, from east toward north).
function Town.new(cx: number, cy: number, bearing: number?, seed: number?): any
	local self = setmetatable({}, Town)
	self.cx, self.cy = cx, cy
	self.seed = seed or 7
	self.structures = {}
	self.model = Instance.new("Model")
	self.model.Name = "StormLabTown"
	local rng = Noise.rng(self.seed)
	local b = bearing or 0
	local cb, sb = math.cos(b), math.sin(b)
	local function at(dx: number, dy: number): (number, number)
		return cx + dx * cb - dy * sb, cy + dx * sb + dy * cb
	end
	local yaw = -b -- Roblox yaw for a sim bearing
	-- the town sits on the ground (the relief keeps a flat pad round the town centre)
	local gz = LabConfig.groundAt(cx, cy)
	self.gz = gz
	-- the ground plate under the town and roads (physics ground for vehicles)
	local ground = Instance.new("Model")
	ground.Name = "TownGround"
	ground.Parent = self.model
	local gsize = 1800
	local gc = part(ground, Vector3.new(gsize, 2, gsize), CFrame.new(mspace(cx, cy, gz - 1)) * CFrame.Angles(0, yaw, 0), rgb(106, 128, 76), Enum.Material.Grass)
	gc.CustomPhysicalProperties = PhysicalProperties.new(2, 0.8, 0.1, 1, 1)
	gc.CastShadow = false
	for _, road in { { 0, 0, 1600, 9 }, { 0, 0, 9, 1600 }, { -300, 0, 9, 900 }, { 300, 0, 9, 900 } } do
		local rx, ry = at(road[1], road[2])
		local r = part(ground, Vector3.new(road[3], 0.1, road[4]), CFrame.new(mspace(rx, ry, gz + 0.05)) * CFrame.Angles(0, yaw, 0), rgb(78, 76, 74), Enum.Material.Asphalt)
		r.CastShadow = false
		r.CustomPhysicalProperties = PhysicalProperties.new(2, 0.8, 0.1, 1, 1)
	end
	local function add(di: string, dx: number, dy: number, rot: number, quality: number?)
		local x, y = at(dx, dy)
		local m = Instance.new("Model")
		m.Name = string.format("%s_%d", di, #self.structures + 1)
		local sgz = LabConfig.groundAt(x, y)
		local origin = CFrame.new(mspace(x, y, sgz)) * CFrame.Angles(0, yaw + rot, 0) -- (metre space)
		local h = BUILDERS[di](m, origin, rng)
		m.WorldPivot = toStuds(origin) -- (shifts, rolls and falls turn about the base)
		m.Parent = self.model
		local s = Damage.newStructure(m.Name, di, x, y, h, self.seed * 1000 + #self.structures, quality)
		s.model = m
		s.origin = toStuds(origin) -- (studs)
		s.gz = sgz -- ground height under it (m above the datum)
		s.wind3 = 0
		s.roof3 = 0
		s.groups = {}
		for _, p in m:GetDescendants() do
			if p:IsA("BasePart") then
				local g = p:GetAttribute("Group")
				if g then
					s.groups[g] = s.groups[g] or {}
					table.insert(s.groups[g], p)
				end
			end
		end
		table.insert(self.structures, s)
		return s
	end
	-- houses on both sides of the main street and two side streets
	for i = -6, 6 do
		if i ~= 0 then
			add("house", i * 45, 22, 0, rng:range(0.9, 1.15))
			add("house", i * 45, -22, math.pi, rng:range(0.9, 1.15))
		end
	end
	for j = -4, 4 do
		if j ~= 0 then
			add("house", -300 + 22, j * 40, -math.pi / 2, rng:range(0.85, 1.1))
			add("house", 300 - 22, j * 40, math.pi / 2, rng:range(0.85, 1.1))
		end
	end
	-- a mobile home park
	for k = 0, 7 do
		add("mobileHome", 420 + (k % 4) * 28, 120 + (k // 4) * 40, 0, rng:range(0.85, 1.05))
	end
	-- farm buildings out on the edge
	add("barn", -520, -180, 0.3)
	add("barn", -560, -110, 0.1)
	add("barn", 560, -240, -0.2)
	-- trees: along the streets and a shelterbelt
	for i = -12, 12 do
		add("tree", i * 24 + rng:range(-4, 4), 60 + rng:range(-3, 3), 0)
		add("tree", i * 24 + rng:range(-4, 4), -60 + rng:range(-3, 3), 0)
	end
	for k = -30, 30 do
		add("tree", k * 12, -400 + rng:range(-3, 3), 0)
	end
	-- power poles along the main road
	for i = -13, 13 do
		add("pole", i * 60, 8, 0)
	end
	self.model.Parent = Workspace
	return self
end

function Town.destroy(self: any)
	self.model:Destroy()
end

-- hide a component's parts (and the groups that go with its failure)
local function fail(s: any, group: string, dirX: number, dirY: number)
	for _, g in HIDE[group] or {} do
		for _, p in s.groups[g] or {} do
			p.Transparency = 1
			p.CanCollide = false
			p.CanQuery = false
			p.CastShadow = false
		end
	end
	local push = LabConfig.dirWorld(dirX, dirY)
	if push.Magnitude > 0 then
		push = push.Unit
	end
	-- moves: whole buildings shift / roll, trees fall, poles lean
	if group == "anchors" then
		s.model:PivotTo(s.model:GetPivot() + push * LabConfig.studs(1.5))
	elseif group == "roll" then
		s.model:PivotTo(s.model:GetPivot() * CFrame.Angles(math.rad(80), 0, 0) + push * LabConfig.studs(8))
	elseif group == "uproot" then
		local axis = Vector3.yAxis:Cross(push)
		if axis.Magnitude > 0 then
			local pivot = s.model:GetPivot()
			s.model:PivotTo(CFrame.fromAxisAngle(axis.Unit, math.rad(84)) * (pivot - pivot.Position) + pivot.Position)
		end
	elseif group == "lean" then
		local axis = Vector3.yAxis:Cross(push)
		if axis.Magnitude > 0 then
			local pivot = s.model:GetPivot()
			s.model:PivotTo(CFrame.fromAxisAngle(axis.Unit, math.rad(18)) * (pivot - pivot.Position) + pivot.Position)
		end
	end
end

-- Load every structure near a tornado or a strong outflow with the simulated wind. dt: sim
-- seconds. Returns the debris to release: { { class, x, y, z, u, v, w } } (metres; z above the
-- datum, i.e. the ground under the structure plus the release height). The wind is sampled at
-- heights above the local ground (the sim's near-surface wind knows no hills).
function Town.update(self: any, world: any, dt: number): ({ any }, { any })
	local releases = {}
	local reports = {}
	-- skip quiet towns: something strong must be within reach
	local near = false
	for _, t in world.tornadoes do
		if not t.ended and (t.x - self.cx) ^ 2 + (t.y - self.cy) ^ 2 < 3000 ^ 2 then
			near = true
		end
	end
	if not near then
		self.quiet = (self.quiet or 0) + dt
		if self.quiet < 1 then
			return releases, reports
		end
		self.quiet = 0
		dt = 1
	end
	local k3 = 1 - math.exp(-dt / 3)
	for _, s in self.structures do
		if s.stage < #Damage.DI[s.di] then
			local zMid = math.max(2, s.height * 0.5)
			local u, v = world:windAt(s.x, s.y, zMid)
			local ru, rv, rw = world:windAt(s.x, s.y, s.roofZ)
			local speed = math.sqrt(u * u + v * v)
			-- roofs feel the updraft too: U_eff^2 = u_h^2 + 3 w |w|
			local roof = math.sqrt(math.max(0, ru * ru + rv * rv + 3 * rw * math.abs(rw)))
			s.wind3 += (speed - s.wind3) * k3
			s.roof3 += (roof - s.roof3) * k3
			-- gusts above the 3-s mean count partly
			local gust = math.max(s.wind3, 0.8 * speed)
			local failed = Damage.apply(s, dt, gust, math.max(s.roof3, 0.8 * roof))
			for _, f in failed do
				fail(s, f.group, u, v)
				table.insert(reports, { id = s.id, di = s.di, degree = f.degree, text = f.text, wind = gust, x = s.x, y = s.y })
				if f.debris and f.count > 0 then
					for n = 1, f.count do
						local a = (n / f.count) * 2 * math.pi
						table.insert(releases, {
							f.debris,
							s.x + math.cos(a) * 3, s.y + math.sin(a) * 3, (s.gz or 0) + math.max(1, s.roofZ * (0.4 + 0.6 * ((n % 3) / 2))),
							u * 0.4, v * 0.4, 2,
						})
					end
				end
			end
		end
	end
	return releases, reports
end

-- How much loose material a tornado could raise here (World.groundFn): the town adds wreckage.
function Town.groundAt(self: any, x: number, y: number): number
	local d2 = (x - self.cx) ^ 2 + (y - self.cy) ^ 2
	if d2 < 700 ^ 2 then
		return LabConfig.SOIL.town
	end
	return LabConfig.SOIL.farmland
end

return Town
