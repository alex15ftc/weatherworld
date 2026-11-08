--!strict
-- The game's storms drawn from the engine's own frames (docs/research/ENGINE-PHYSICS-PLAN.md
-- Phase 1): each storm LiveStorms holds is drawn as the cloud lab draws it - the cloud body as lit
-- billboard puffs (Shared.CloudModel.PuffView) and its tornado as puffs round the frame's vortex
-- (Shared.CloudModel.TornadoView), both from the same frame, so the funnel and the wall cloud are
-- one pressure field. FrameView is used only for its anchor (where the storm is between frames,
-- moving at its motion and easing out each new frame's jump); none of its debug boxes are drawn.
-- Across at the map's scale, up and a tornado's widths at the sky scale for the storm's distance
-- from the camera (Config.skyScaleAt), as client/LiveStorms' debug view and the cloud lab.
-- On when workspace attribute StormVisuals = "engine" (and LiveStorms = true, which brings the
-- frames); WeatherClient then leaves out the lab sim's cloud and tornado renderers (rain,
-- lightning and the sky's light stay the lab sim's until the frame draws them).
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local Config = require(ReplicatedStorage.Shared.World.Config)
local CloudModel = ReplicatedStorage.Shared:WaitForChild("CloudModel")
local FrameView = require(CloudModel:WaitForChild("FrameView")) :: any
local PuffView = require(CloudModel:WaitForChild("PuffView")) :: any
local MeshView = require(CloudModel:WaitForChild("MeshView")) :: any
local TornadoView = require(CloudModel:WaitForChild("TornadoView")) :: any
local RainView = require(CloudModel:WaitForChild("RainView")) :: any
local DeckView = require(CloudModel:WaitForChild("DeckView")) :: any
local WallCloudView = require(CloudModel:WaitForChild("WallCloudView")) :: any
local ClientFrame = require(CloudModel:WaitForChild("ClientFrame")) :: any

local EngineStorms = {}

-- The cloud body: stacked cloud meshes (MeshView, 2026-11-07, the user's ask) unless workspace
-- StormBody = "puff" (the billboards, PuffView), or the mesh fails to load. Both draw the same pieces.
local function bodyView(): any
	if workspace:GetAttribute("StormBody") ~= "puff" and MeshView.ready() then return MeshView end
	return PuffView
end
-- The cloud above the storm's base is drawn at TOWER studs up per stud across (PuffView.vertical), so
-- a near storm keeps its proportions under the map's squashed distances (true would be 1; workspace
-- StormTowerScale overrides). The base, wall cloud, rain and tornado keep the true sky scale.
local TOWER = 1.5
local function tower(): number
	local t = workspace:GetAttribute("StormTowerScale")
	return if type(t) == "number" then t else TOWER
end
local NEAR_MESHES = 20 -- (user 2026-11-07: under ~20 a storm, the wall cloud and tornado the main feature; 350 until then) -- (the mesh body's most for one storm: fewer, larger pieces read as the reference's big billows; Studio 2026-11-07)
-- All storms' cloud meshes come out of one budget (MeshParts are what costs: up to 6 storms had
-- 250-350 each, ~2,000, user 2026-11-07), shared by how much of the view each storm takes - its
-- size over its distance, squared (a storm is about MESH_NEAR_M across up close) - so the nearest
-- storm gets most and a far one the few large pieces it needs (MeshView draws fewer, larger pieces
-- from the same cloud: PuffView.layout). workspace StormMeshTotal overrides.
local MESH_TOTAL, MESH_MIN, MESH_NEAR_M = 60, 6, 6000
local NEAR_PUFFS, FAR_PUFFS = 1000, 250 -- the cloud body's puff budget, a storm near and far (600 / 200 until 2026-11-07, when the puffs went where the structure is)
local TORNADO_PUFFS = 340 -- (TornadoView: body, flow structure, subvortices and dust, 2026-11-07)
local WALL_PUFFS = 160 -- (WallCloudView: the nest's lowering round the mesocyclone)
-- (the tornado and wall cloud drawn by the lab sim's renderers instead only with workspace
-- StormNearLab = true: client/WeatherClient, the same rule)
local function nearLab(): boolean
	return workspace:GetAttribute("StormNearLab") == true
end
-- The storm's body, wall cloud, base and scud are the lab's cards (StormCards, WallStream,
-- BaseDeck, Scud) fed from the shared engine numbers (client/FrameWorld) unless workspace
-- StormBody is "puff" or "mesh" (2026-11-07, the user chose the cards): this then draws only the
-- painted tornado's debug overlay (TornadoView, TornadoDebug / J: the engine vortex's winds) and
-- keeps the frames' rain for the rest (no curtains drawn); the funnel is the lab's TornadoCards,
-- fed the frame's tornado (client/FrameWorld).
function EngineStorms.cards(): boolean
	local b = workspace:GetAttribute("StormBody")
	return b ~= "puff" and b ~= "mesh"
end
local RAIN_PUFFS = 600 -- (the rain and hail curtains, as puffs: 2026-11-07, in place of 160 curtains of world-fixed tiles)

local H = Config.STUDS_PER_MILE / (Config.KM_PER_MILE * 1000) -- studs per metre across

type View = { anchor: any, puffs: any, tornado: any, wall: any, rain: any, deck: any, folder: Folder, groundY: number, frame: any }
local views: { [string]: View } = {}

-- Lightning's light (set by WeatherClient from the lab's flash field, which the engine's flashes
-- feed): flashAt(x, z, hM) the light at a place (studs across, metres up), flashLive() whether
-- any flash is lighting now.
EngineStorms.flashAt = nil :: ((number, number, number, number?, number?) -> number)?
EngineStorms.flashLive = nil :: (() -> boolean)?
-- (the nearest lab tornado drawn, for the debug camera: client/WeatherClient sets it in engine mode)
EngineStorms.labTornadoAt = nil :: (() -> Vector3?)?
local wasFlashing = false
local flashSeen = { steps = 0, most = 0, puffs = 0, at = os.clock() } -- (debug: the flash light the cloud took)

-- map km (y south) -> studs (x, z)
local function studsAt(xKm: number, yKm: number): (number, number)
	local half = Config.MAP_MILES / 2
	return (xKm / Config.KM_PER_MILE - half) * Config.STUDS_PER_MILE, (yKm / Config.KM_PER_MILE - half) * Config.STUDS_PER_MILE
end

local function meshBudget(storms: { [string]: any }, id: string): number
	local t = workspace:GetAttribute("StormMeshTotal")
	local total = if type(t) == "number" then t else MESH_TOTAL
	local cam = workspace.CurrentCamera
	if not cam then return NEAR_MESHES end
	local c = cam.CFrame.Position
	local mine, sum = 0, 0
	for sid, st in storms do
		local x, z = studsAt(st.xKm, st.yKm)
		local dM = math.sqrt((c.X - x) ^ 2 + (c.Z - z) ^ 2) / H
		local w = 1 / (MESH_NEAR_M * MESH_NEAR_M + dM * dM)
		sum += w
		if sid == id then mine = w end
	end
	if sum <= 0 then return NEAR_MESHES end
	return math.clamp(math.floor(total * mine / sum), MESH_MIN, NEAR_MESHES)
end

-- The terrain's surface (studs) at (x, z): a ray onto the terrain only (not trees, buildings, cars
-- or people), cached on a 16-stud grid for 3 s; nil where the terrain isn't loaded there (it is
-- built and streamed only round the players).
local rayParams = RaycastParams.new()
rayParams.FilterType = Enum.RaycastFilterType.Include
rayParams.FilterDescendantsInstances = { workspace.Terrain }
local rayCache: { [number]: number | false }, rayCacheAt = {}, 0
local function terrainAt(x: number, z: number): number?
	local now = os.clock()
	if now - rayCacheAt > 3 then
		table.clear(rayCache)
		rayCacheAt = now
	end
	local key = math.floor(x / 16) * 65536 + math.floor(z / 16)
	local v = rayCache[key]
	if v == nil then
		local hit = workspace:Raycast(Vector3.new(x, Config.RAY_TOP_STUDS, z), Vector3.new(0, -Config.RAY_TOP_STUDS - 200, 0), rayParams)
		v = if hit then hit.Position.Y else false
		rayCache[key] = v
	end
	return if v then v else nil
end

-- The ground under a storm: the terrain there, or where that isn't loaded the terrain under the
-- camera (the nearest loaded ground; the place's zero is the map's lowest point, so falling back
-- to 0 sank a storm by its ground's whole height - hundreds to thousands of studs).
local function groundAt(x: number, z: number): number
	local y = terrainAt(x, z)
	if y then return y end
	local cam = workspace.CurrentCamera
	if cam then y = terrainAt(cam.CFrame.Position.X, cam.CFrame.Position.Z) end
	return y or 0
end

-- The rain's optical depth on the sight line from a to b (world studs; bM b's height, m above the
-- ground): a march through the frames' rain, counting it where the line is below the cloud base it
-- falls from, at rainExtinction (1/km at R mm/h: the lab's LabConfig.rainExtinction, which
-- WeatherClient sets, so the Atmosphere at the camera and this agree). For PuffView's haze.
EngineStorms.rainExtinction = nil :: ((number) -> number)?
local RAIN_STEP_M = 800
-- The cloud over a world point as one layer: its lowest base (m; nil where clear) and its depth (m).
local function overhead(x: number, z: number): (number?, number)
	local b1, t1, b2, t2 = EngineStorms.cloudAt(x, z)
	if not b1 then return nil, 0 end
	local base, depth = nil, 0
	if t1 > b1 then base, depth = b1, t1 - b1 end
	if t2 > b2 then
		base = if base then math.min(base, b2) else b2
		depth += t2 - b2
	end
	return base, depth
end
-- How far (m) the camera is from the edge of the cloud over it, its nearest way out to open sky
-- (0 under clear sky, nil none within EDGE_REACH_M); kept while the camera stays within 200 studs.
local EDGE_REACH_M, EDGE_STEP_M = 40000, 1000
local camEdge: { at: Vector3?, m: number? } = { at = nil, m = nil }
local function edgeFromCamera(a: Vector3): number?
	if camEdge.at and (camEdge.at - a).Magnitude < 200 then return camEdge.m end
	local best: number? = nil
	if overhead(a.X, a.Z) == nil then
		best = 0
	else
		for q = 0, 7 do
			local ang = q * math.pi / 4
			for d = EDGE_STEP_M, EDGE_REACH_M, EDGE_STEP_M do
				if best and d >= best then break end
				if overhead(a.X + math.cos(ang) * d * H, a.Z + math.sin(ang) * d * H) == nil then
					best = d
					break
				end
			end
		end
	end
	camEdge.at, camEdge.m = a, best
	return best
end
function EngineStorms.rainTau(a: Vector3, b: Vector3, bM: number): (number, Color3?)
	local ext = EngineStorms.rainExtinction
	if not ext then return 0, nil end
	local ground = 0
	for _, v in views do ground = v.groundY break end
	local aM = math.max(0, a.Y - ground) / Config.STUDS_PER_METRE_VERTICAL
	local dx, dz = b.X - a.X, b.Z - a.Z
	local dM = math.sqrt(dx * dx + dz * dz) / H
	local n = math.clamp(math.floor(dM / RAIN_STEP_M), 2, 12)
	local tau = 0
	-- the rain's light (PuffView.rainLight), weighted by what of it the camera sees: each bit's way
	-- out to open sky is back toward the camera - to the last clear point on the way, or past the
	-- camera to the edge of the cloud it is under
	local behind = edgeFromCamera(a)
	local clearAt: number? = if behind then -behind else nil
	local tauSide = 0
	local r0, g0, b0, wSum = 0, 0, 0, 0
	for i = 1, n do
		local f = (i - 0.5) / n
		local x, z = a.X + dx * f, a.Z + dz * f
		local base, depth = overhead(x, z)
		if not base then
			clearAt, tauSide = f * dM, 0
		end
		local r = EngineStorms.precipAt(Vector3.new(x, 0, z))
		if r > 0.05 then
			local h = aM + (bM - aM) * f
			local top = if base and base > 0 then base else 1500
			if h < top then
				local dtau = ext(r) * dM / n / 1000
				local col = PuffView.rainLight(depth, r, top - h, if clearAt then f * dM - clearAt else nil, tauSide)
				local w = dtau * math.exp(-tau)
				r0 += col.R * w; g0 += col.G * w; b0 += col.B * w; wSum += w
				tau += dtau
				tauSide += dtau
			end
		end
	end
	return tau, if wSum > 0 then Color3.new(r0 / wSum, g0 / wSum, b0 / wSum) else nil
end

function EngineStorms.enabled(): boolean
	return workspace:GetAttribute("StormVisuals") == "engine" and workspace:GetAttribute("LiveStorms") == true
end

-- The rain (mm/h) and hail share at a world position (studs), from the storms' frames: for the
-- rain round the camera (NearPrecip, through ctx.precipAt). The wettest storm there wins.
function EngineStorms.precipAt(pos: Vector3): (number, number)
	local now = os.clock()
	local best, share = 0, 0
	for _, v in views do
		local f = v.frame
		if f then
			local ax, az = v.anchor:anchorAt(now)
			local r, h = v.rain:rainAt((pos.X - ax) / H + f.anchorX, -(pos.Z - az) / H + f.anchorY)
			if r > best then best, share = r, h end
		end
	end
	return best, share
end

-- The cloud over a world position (studs): the two cloud layers' base and top (m above the
-- ground; 0 where none), from the storms' frames - for the sky's light (Render/Sky, through
-- ctx.cloudAt). nil where no storm's frame covers it.
function EngineStorms.cloudAt(x: number, z: number): (number?, number, number, number)
	local now = os.clock()
	for _, v in views do
		local f = v.frame
		if f then
			local ax, az = v.anchor:anchorAt(now)
			local i = math.floor(((x - ax) / H + f.anchorX) / f.dx) + 1
			local j = math.floor((-(z - az) / H + f.anchorY) / f.dx) + 1
			if i >= 1 and j >= 1 and i <= f.nx and j <= f.ny then
				return ClientFrame.cloudM(ClientFrame.byte(f, "base1", i, j)), ClientFrame.cloudM(ClientFrame.byte(f, "top1", i, j)),
					ClientFrame.cloudM(ClientFrame.byte(f, "base2", i, j)), ClientFrame.cloudM(ClientFrame.byte(f, "top2", i, j))
			end
		end
	end
	return nil, 0, 0, 0
end

function EngineStorms.start(LiveStorms: any)
	if not EngineStorms.enabled() then return end
	if workspace:GetAttribute("EngineStormsDebugCam") == true then print("[EngineStorms] on") end
	PuffView.rainTau = EngineStorms.rainTau
	local root = Instance.new("Folder")
	root.Name = "EngineStorms"
	root.Parent = workspace

	local function update(id: string)
		local s = LiveStorms.storms[id]
		local v = views[id]
		if not s then
			if v then
				v.puffs:destroy()
				v.tornado:destroy()
				v.wall:destroy()
				v.rain:destroy()
				v.deck:destroy()
				v.folder:Destroy()
				views[id] = nil
			end
			return
		end
		local ok, err = pcall(function()
			if not v then
				local folder = Instance.new("Folder")
				folder.Name = id
				folder.Parent = root
				local cards = EngineStorms.cards()
				v = {
					cards = cards,
					anchor = FrameView.new(folder, { hScale = H, vScale = Config.SKY_STUDS_PER_METRE }),
					puffs = bodyView().new(folder, { max = NEAR_PUFFS, seed = id, tower = tower() }),
					tornado = TornadoView.new(folder, { max = TORNADO_PUFFS, seed = id }),
					wall = WallCloudView.new(folder, { max = WALL_PUFFS, seed = id }),
					rain = RainView.new(folder, { max = RAIN_PUFFS, seed = id }),
					deck = DeckView.new(folder), -- (the base overhead, soft flat discs round the camera)
					folder = folder, groundY = 0,
				}
				if cards then
					(v :: any).rain.dataOnly = true;
					(v :: any).tornado.debugOnly = true
				end
				views[id] = v
			end
			local view = v :: View
			local cards = (view :: any).cards == true
			local x, z = studsAt(s.xKm, s.yKm)
			local cam = workspace.CurrentCamera
			local dist = if cam then math.sqrt((cam.CFrame.Position.X - x) ^ 2 + (cam.CFrame.Position.Z - z) ^ 2) else 0
			local V = Config.skyScaleAt(dist)
			view.anchor:setAnchor(x, z, s.ue * H, -s.ve * H)
			view.groundY = groundAt(x, z)
			view.puffs.max = if getmetatable(view.puffs) == MeshView then meshBudget(LiveStorms.storms, id) elseif not s.near then FAR_PUFFS else NEAR_PUFFS
			local pt = if cards then "body: cards" else view.puffs:draw(s.frame, H, V)
			-- (the rain and the base deck at the cloud body's heights: PuffView.heightMap)
			local hm = if view.puffs.Y then { Y = view.puffs.Y, Z = view.puffs.Z } else nil
			view.rain.heights, view.deck.heights = hm, hm
			local lab = nearLab()
			local tt = if lab then "" else view.tornado:draw(s.frame, H, V)
			local wt = if lab or cards then "" else view.wall:draw(s.frame, H, V)
			local ax, az = view.anchor:anchorAt(os.clock())
			view.rain:place(ax, view.groundY, az) -- (the curtains' distances from the camera need it placed)
			local rt = view.rain:draw(s.frame, H, V, if cam then cam.CFrame.Position else nil)
			if not cards then
				view.deck:place(ax, view.groundY, az)
				view.deck:draw(s.frame, H, V)
			end
			view.frame = s.frame
			if workspace:GetAttribute("EngineStormsDebugCam") == true then
				print(("[EngineStorms] %s %.1f km from the camera, %.2f studs/m up | %s | %s | %s"):format(id, dist / H / 1000, V, pt, rt, if tt == "" then "no tornado" else tt) .. (if wt == "" then "" else " | " .. wt))
			end
		end)
		if not ok then warn("[EngineStorms] " .. tostring(err)) end
	end
	LiveStorms.changed:Connect(update)
	-- (storms whose frame came before this started: a frame can arrive the moment LiveStorms connects)
	for id in LiveStorms.storms do update(id) end

	RunService.RenderStepped:Connect(function()
		local now = os.clock()
		local cam = workspace.CurrentCamera
		-- (lightning: each step a flash is live, and once after it, to put the colours back)
		local flashAt, live = EngineStorms.flashAt, EngineStorms.flashLive
		local flashing = live ~= nil and live()
		local relight = flashAt ~= nil and (flashing or wasFlashing)
		wasFlashing = flashing
		if workspace:GetAttribute("EngineStormsDebugCam") == true and now - flashSeen.at > 10 then
			print(("[EngineStorms] flash light on the cloud in %.0f s: %d steps lit, brightest %.2f, up to %d puffs (sky light %.2f)"):format(now - flashSeen.at, flashSeen.steps, flashSeen.most, flashSeen.puffs, PuffView.skyLevel()))
			flashSeen.steps, flashSeen.most, flashSeen.puffs, flashSeen.at = 0, 0, 0, now
		end
		local lab = nearLab()
		for _, v in views do
			local ax, az = v.anchor:anchorAt(now)
			local cards = (v :: any).cards == true
			if not lab then
				v.tornado:place(ax, v.groundY, az, terrainAt) -- (stands on the ground under itself, not the anchor's)
			end
			if cards then
				if relight and not lab then v.tornado:flash(flashAt :: any) end
				continue
			end
			v.puffs:place(ax, v.groundY, az)
			if not lab then
				v.wall:place(ax, v.groundY, az)
			end
			v.rain:place(ax, v.groundY, az, terrainAt) -- (each curtain on the ground under it)
			v.deck:place(ax, v.groundY, az)
			if cam then -- (the haze and scatter for the camera: redone only once it has moved PuffView.RECOLOUR_M)
				v.puffs:recolour(cam.CFrame.Position)
				if (v.puffs :: any).view then (v.puffs :: any):view(cam.CFrame.Position) end -- (each puff's outline and opacity from the sight line: PuffView:view)
				v.rain:recolour(cam.CFrame.Position)
				v.deck:recolour(cam.CFrame.Position)
			end
			if relight then
				local most, n = v.puffs:flash(flashAt :: any)
				v.deck:flash(flashAt :: any)
				if not lab then
					v.tornado:flash(flashAt :: any)
					v.wall:flash(flashAt :: any)
				end
				flashSeen.steps += 1
				flashSeen.most = math.max(flashSeen.most, most)
				flashSeen.puffs = math.max(flashSeen.puffs, n)
			end
		end
	end)

	-- (debug, workspace EngineStormsDebugCam = true; every key below with LeftAlt held - the lab's
	-- renderers, on in engine mode, use most single keys: T switches TornadoCards' style, B NearVfx)
	-- T frames the nearest storm's tornado - or its
	-- anchor with none - from a low angle, half way up to its base; Left/Right orbit, Up/Down zoom,
	-- Q/E lower and raise the eye; T again gives the camera back. As the cloud lab's LiveView.
	if workspace:GetAttribute("EngineStormsDebugCam") ~= true then return end
	local UserInputService = game:GetService("UserInputService")
	local on, yaw, dist, rise = false, 0, 6000, 0.15
	local function target(): Vector3?
		local cam = workspace.CurrentCamera
		local best, bestD = nil, math.huge
		-- (the lab's tornado, drawn by its renderers when they are on: client/WeatherClient)
		local lab = EngineStorms.labTornadoAt and EngineStorms.labTornadoAt()
		if lab then return lab end
		for _, v in views do
			local ax, az = v.anchor:anchorAt(os.clock())
			local p = Vector3.new(ax, v.groundY + 6000, az)
			local tv = v.tornado
			if tv.shape then
				local s = tv:eased(os.clock())
				p = Vector3.new(ax + s.gx, tv.anchor.Position.Y + 0.5 * math.max(s.Bt, 200) * s.V, az + s.gy)
			end
			local d = if cam then (cam.CFrame.Position - p).Magnitude else 0
			if d < bestD then best, bestD = p, d end
		end
		return best
	end
	-- G cycles which layer is hidden (to find what draws something): each is its views' instances by
	-- name, hidden through the image's Visible (which the views never set)
	local HIDE = {
		{ name = "nothing hidden" },
		{ name = "deck hidden", parts = { Deck = true } },
		{ name = "rain hidden", guis = { Rain = true } },
		{ name = "cloud puffs hidden", guis = { Puff = true } },
		{ name = "tornado hidden", guis = { TornadoPuff = true } },
		{ name = "wall cloud hidden", guis = { WallPuff = true } },
		{ name = "only tornado and wall cloud", parts = { Deck = true }, guis = { Rain = true, Puff = true } },
		{ name = "only cloud puffs", parts = { Deck = true }, guis = { Rain = true, TornadoPuff = true } },
	}
	local hideAt = 1
	local function applyHide()
		local m = HIDE[hideAt]
		for _, d in root:GetDescendants() do
			if d:IsA("ImageLabel") then
				local gui = d.Parent
				local owner = gui and gui.Parent
				local hidden = (m.guis ~= nil and gui ~= nil and gui:IsA("BillboardGui") and m.guis[gui.Name] == true)
					or (m.parts ~= nil and owner ~= nil and owner:IsA("BasePart") and m.parts[owner.Name] == true)
				d.Visible = not hidden
			elseif d:IsA("MeshPart") and d.Name == "CloudMesh" then -- (the mesh body hides with the puffs)
				d.LocalTransparencyModifier = if m.guis ~= nil and m.guis.Puff == true then 1 else 0
			end
		end
	end
	task.spawn(function()
		while true do
			task.wait(0.5)
			if hideAt > 1 then applyHide() end -- (new instances, as frames come and the camera moves)
		end
	end)
	UserInputService.InputBegan:Connect(function(input, processed)
		if processed then return end
		if not UserInputService:IsKeyDown(Enum.KeyCode.LeftAlt) then return end
		if input.KeyCode == Enum.KeyCode.G then
			hideAt = hideAt % #HIDE + 1
			applyHide()
			print("[EngineStorms] layers: " .. HIDE[hideAt].name)
			return
		end
		if input.KeyCode == Enum.KeyCode.B then -- (B: the cloud body as meshes or billboards, to compare)
			workspace:SetAttribute("StormBody", if workspace:GetAttribute("StormBody") == "puff" then "mesh" else "puff")
			for id, v in views do
				v.puffs:destroy()
				v.puffs = bodyView().new(v.folder, { max = NEAR_PUFFS, seed = id, tower = tower() })
				update(id)
			end
			print("[EngineStorms] body: " .. tostring(workspace:GetAttribute("StormBody")))
			return
		end
		-- (mesh body tuning, live: N the budget, K and L the size, [ and ] the fill)
		local kc = input.KeyCode
		if kc == Enum.KeyCode.N or kc == Enum.KeyCode.K or kc == Enum.KeyCode.L or kc == Enum.KeyCode.LeftBracket or kc == Enum.KeyCode.RightBracket then
			local t = MeshView.tune
			if kc == Enum.KeyCode.N then
				local steps = { 600, 350, 200, 120 }
				local at = table.find(steps, NEAR_MESHES) or 1
				NEAR_MESHES = steps[at % #steps + 1]
			elseif kc == Enum.KeyCode.K then t.size /= 1.15
			elseif kc == Enum.KeyCode.L then t.size *= 1.15
			elseif kc == Enum.KeyCode.LeftBracket then t.fill = math.max(0, t.fill - 0.2)
			else t.fill += 0.2 end
			for id in views do update(id) end
			print(("[EngineStorms] mesh tune: budget %d, size x%.2f, fill x%.1f"):format(NEAR_MESHES, t.size, t.fill))
			return
		end
		if input.KeyCode ~= Enum.KeyCode.T then return end
		on = not on
		workspace.CurrentCamera.CameraType = if on then Enum.CameraType.Scriptable else Enum.CameraType.Custom
	end)
	RunService.RenderStepped:Connect(function(dt)
		if not on then return end
		local at = target()
		if not at then return end
		if UserInputService:IsKeyDown(Enum.KeyCode.Left) then yaw -= 0.8 * dt end
		if UserInputService:IsKeyDown(Enum.KeyCode.Right) then yaw += 0.8 * dt end
		if UserInputService:IsKeyDown(Enum.KeyCode.Up) then dist = math.max(100, dist / (1.5 ^ dt)) end
		if UserInputService:IsKeyDown(Enum.KeyCode.Down) then dist = math.min(60000, dist * (1.5 ^ dt)) end
		if UserInputService:IsKeyDown(Enum.KeyCode.Q) then rise -= 0.4 * dt end
		if UserInputService:IsKeyDown(Enum.KeyCode.E) then rise += 0.4 * dt end
		rise = math.clamp(rise, (20 - at.Y) / dist, 1)
		workspace.CurrentCamera.CFrame = CFrame.lookAt(at + Vector3.new(math.sin(yaw) * dist, rise * dist, math.cos(yaw) * dist), at)
	end)
end

return EngineStorms
