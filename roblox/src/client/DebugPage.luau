--!strict
-- The storm debug page, opened and closed with E (not while flying, where E is up): every storm
-- the feed has, strongest first (a tornado's first), with how far and which way it is from you.
--   Teleport: puts you on the ground beside it (server/Explore waits for the ground to load):
--     to the right of its track (the inflow side of a storm moving north-east), a few km off.
--   Follow:   a cinematic camera that stays with it, looking at the tornado, else the wall cloud
--     or the updraught's base. Orbit circles it slowly; Chase holds the teleport's angle as it
--     moves. Scroll to move in or out; Stop (or Backspace) drops you to the ground under the camera.
-- While following, your character rides along hidden at the camera, so the ground and the storms
-- load where you are looking.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local UserInputService = game:GetService("UserInputService")

local Config = require(ReplicatedStorage.Shared.World.Config)
local StormView = require(script.Parent.WeatherClient) -- (the storm list: client/Weather)
local Ui = require(script.Parent.Products.Ui)

local DebugPage = {}

local KM = Config.STUDS_PER_MILE / Config.KM_PER_MILE
local SKY = Config.SKY_STUDS_PER_METRE -- (near)
local HALF = Config.MAP_MILES / 2 * Config.STUDS_PER_MILE
local EDGE = HALF - 600
local WIDTH = 380
local ROW = 76

local player = Players.LocalPlayer
local gui: ScreenGui? = nil
local listBox: Frame
local statusLabel: TextLabel
local modeButtons: { [string]: TextButton } = {}
local rows: { [string]: { frame: Frame, label: TextLabel } } = {}

type Follow = { id: string, mode: string, zoom: number, angle: number, pos: Vector3?, look: Vector3? }
local follow: Follow? = nil
local lastMode = "Orbit"
local message = ""

local function at(xKm: number, yKm: number, y: number): Vector3
	return Vector3.new(xKm * KM - HALF, y, yKm * KM - HALF)
end

-- The ground's height at (x, z): the loaded terrain there, else `fallback` (the storm's ground).
-- (The heightfield's data is server-only, so the client cannot compute it.)
local groundParams = RaycastParams.new()
groundParams.FilterType = Enum.RaycastFilterType.Include
groundParams.FilterDescendantsInstances = { workspace.Terrain }
local function ground(x: number, z: number, fallback: number): number
	local hit = workspace:Raycast(Vector3.new(x, Config.RAY_TOP_STUDS, z), Vector3.new(0, -2 * Config.RAY_TOP_STUDS, 0), groundParams)
	return if hit then hit.Position.Y else fallback
end

local function compass(dx: number, dz: number): string
	local deg = (math.deg(math.atan2(dx, -dz)) + 360) % 360
	local names = { "N", "NE", "E", "SE", "S", "SW", "W", "NW" }
	return names[math.floor((deg + 22.5) / 45) % 8 + 1]
end

local function findStorm(id: string): any
	for _, s in StormView.storms() do
		if s.id == id then
			return s
		end
	end
	return nil
end

local function myPosition(): Vector3
	local camera = workspace.CurrentCamera
	local character = player.Character
	local root = if character then character:FindFirstChild("HumanoidRootPart") :: BasePart? else nil
	if follow and camera then
		return camera.CFrame.Position
	end
	return if root then root.Position elseif camera then camera.CFrame.Position else Vector3.zero
end

-- What to look at on a storm: the point, how far off to watch it from (studs), and the flat
-- direction from the storm to the watching spot (to the right of its track, a little behind).
local function framing(s: any): (Vector3, number, Vector3)
	local t = s.tornado
	local look, distance
	if t then
		local g = t.groundStuds or s.groundStuds or 0
		distance = math.clamp(t.baseM * SKY * 1.8, 1200, 6000)
		-- (heights at the scale the storm is drawn at from there: Config.skyScaleAt)
		look = at(t.xKm, t.yKm, g + t.baseM * Config.skyScaleAt(distance) * 0.4)
	else
		local g = s.groundStuds or 0
		local w = s.wallCloud
		local p = if w and w.strength > 0.03 then w else s.updraft
		-- Near enough that the base and tower fill the view (across is compressed, up is not).
		distance = math.clamp(s.updraft.radiusKm * KM + s.updraft.baseM * SKY, 2500, 9000)
		look = at(p.xKm, p.yKm, g + s.updraft.baseM * Config.skyScaleAt(distance) * 0.7)
	end
	local motion = Vector3.new(s.eastKph or 0, 0, -(s.northKph or 0))
	local side
	if motion.Magnitude < 1 then
		side = Vector3.new(1, 0, 1).Unit -- south-east
	else
		local h = motion.Unit
		local right = Vector3.new(-h.Z, 0, h.X)
		local a = math.rad(25)
		side = (right * math.cos(a) - h * math.sin(a)).Unit
	end
	return look, distance, side
end

local function clampToMap(p: Vector3): Vector3
	return Vector3.new(math.clamp(p.X, -EDGE, EDGE), p.Y, math.clamp(p.Z, -EDGE, EDGE))
end

local function teleportRemote(): RemoteEvent?
	local folder = ReplicatedStorage:FindFirstChild("Debug")
	return if folder then folder:FindFirstChild("Teleport") :: RemoteEvent? else nil
end

local function requestTeleport(x: number, z: number): boolean
	local remote = teleportRemote()
	if not remote then
		message = "No teleport here (the server has no Debug remote)."
		return false
	end
	remote:FireServer(x, z)
	return true
end

-- Following ---------------------------------------------------------------------------------

local function setHidden(hidden: boolean)
	local character = player.Character
	if not character then
		return
	end
	for _, d in character:GetDescendants() do
		if d:IsA("BasePart") or d:IsA("Decal") then
			(d :: any).LocalTransparencyModifier = if hidden then 1 else 0
		end
	end
	local humanoid = character:FindFirstChildOfClass("Humanoid")
	if humanoid then
		humanoid.PlatformStand = hidden
	end
end

local function stopFollow(drop: boolean)
	local was = follow
	if not was then
		return
	end
	follow = nil
	setHidden(false)
	local camera = workspace.CurrentCamera
	if camera then
		camera.CameraType = Enum.CameraType.Custom
	end
	if drop and was.pos then
		requestTeleport(was.pos.X, was.pos.Z)
	end
end

local function startFollow(id: string)
	local s = findStorm(id)
	if not s then
		return
	end
	local _, _, side = framing(s)
	follow = { id = id, mode = lastMode, zoom = 1, angle = math.atan2(side.Z, side.X) }
	message = ""
	setHidden(true)
end

local function stepFollow(dt: number)
	local f = follow
	local camera = workspace.CurrentCamera
	if not f or not camera then
		return
	end
	local s = findStorm(f.id)
	if not s then
		message = "The storm you were following has gone."
		stopFollow(true)
		return
	end
	local look, distance, side = framing(s)
	distance *= f.zoom
	local dir
	if f.mode == "Orbit" then
		f.angle += dt * 0.05
		dir = Vector3.new(math.cos(f.angle), 0, math.sin(f.angle))
	else
		dir = side
		f.angle = math.atan2(side.Z, side.X)
	end
	local flat = clampToMap(Vector3.new(look.X, 0, look.Z) + dir * distance)
	local height = math.clamp(0.01 * distance, 15, 60) -- about eye level, as a chaser sees it
	local stormGround = s.groundStuds or 0
	local want = Vector3.new(flat.X, ground(flat.X, flat.Z, stormGround) + height, flat.Z)
	-- Eased toward where it should be: smooth as the storm turns and the target changes.
	local k = 1 - math.exp(-2.5 * dt)
	local pos = if f.pos then (f.pos :: Vector3):Lerp(want, k) else want
	local lookAt = if f.look then (f.look :: Vector3):Lerp(look, k) else look
	pos = Vector3.new(pos.X, math.max(pos.Y, ground(pos.X, pos.Z, stormGround) + 10), pos.Z)
	f.pos, f.look = pos, lookAt
	camera.CameraType = Enum.CameraType.Scriptable
	camera.CFrame = CFrame.lookAt(pos, lookAt)
	-- The character rides along under the camera, so the world loads round it.
	local character = player.Character
	local root = if character then character:FindFirstChild("HumanoidRootPart") :: BasePart? else nil
	if root and not root.Anchored then
		root.CFrame = CFrame.new(pos - Vector3.new(0, 4, 0))
		root.AssemblyLinearVelocity = Vector3.zero
	end
end

-- The page ----------------------------------------------------------------------------------

local function describe(s: any, from: Vector3): string
	local centre = at(s.xKm, s.yKm, 0)
	local dx, dz = centre.X - from.X, centre.Z - from.Z
	local miles = math.sqrt(dx * dx + dz * dz) / Config.STUDS_PER_MILE
	local speedMph = math.sqrt((s.eastKph or 0) ^ 2 + (s.northKph or 0) ^ 2) / Config.KM_PER_MILE
	local moving = if speedMph < 2 then "nearly still" else `moving {compass(s.eastKph, -s.northKph)} {math.round(speedMph)} mph`
	local kind = s.mode or "storm"
	if s.supercellType then
		kind ..= ` ({s.supercellType})`
	end
	local lines = { `<b>{kind}</b>` }
	if s.tornado then
		local t = s.tornado
		local ef = if t.ef ~= nil then `EF{t.ef}` else "tornado"
		table.insert(lines, `<font color="#ff6b6b"><b>TORNADO</b> {ef}, {t.windMph} mph, {t.widthYards} yd, {t.shape or ""}</font>`)
	elseif s.funnelAloft then
		table.insert(lines, `<font color="#f5c26b">funnel aloft</font>`)
	end
	table.insert(lines, `{string.format("%.0f", miles)} mi {compass(dx, dz)} of you · {moving} · intensity {string.format("%.2f", s.intensity or 0)}`)
	return table.concat(lines, "\n")
end

local function rank(s: any): number
	if s.tornado then
		return 10 + (s.tornado.windMph or 0) / 100
	end
	return (s.intensity or 0) + (if s.funnelAloft then 1 else 0)
end

local function teleportTo(id: string)
	local s = findStorm(id)
	if not s then
		return
	end
	stopFollow(false)
	local look, distance, side = framing(s)
	local spot = clampToMap(Vector3.new(look.X, 0, look.Z) + side * distance)
	if requestTeleport(spot.X, spot.Z) then
		message = `Teleporting beside {s.mode or "the storm"} ...`
	end
end

local function newRow(id: string): { frame: Frame, label: TextLabel }
	local frame = Instance.new("Frame")
	frame.Name = id
	frame.BackgroundColor3 = Ui.PANEL
	frame.BorderSizePixel = 0
	frame.Size = UDim2.new(1, 0, 0, ROW)
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, 6)
	corner.Parent = frame
	local label = Instance.new("TextLabel")
	label.BackgroundTransparency = 1
	label.Position = UDim2.fromOffset(8, 4)
	label.Size = UDim2.new(1, -96, 1, -8)
	label.Font = Enum.Font.Gotham
	label.TextSize = 13
	label.TextColor3 = Ui.TEXT
	label.TextXAlignment = Enum.TextXAlignment.Left
	label.TextYAlignment = Enum.TextYAlignment.Top
	label.TextWrapped = true
	label.RichText = true
	label.Parent = frame
	local function button(text: string, y: number, onClick: () -> ())
		local b = Instance.new("TextButton")
		b.Name = text
		b.Size = UDim2.fromOffset(80, 28)
		b.Position = UDim2.new(1, -86, 0, y)
		b.BackgroundColor3 = Ui.ACCENT
		b.AutoButtonColor = true
		b.Font = Enum.Font.GothamBold
		b.TextSize = 13
		b.TextColor3 = Ui.TEXT
		b.Text = text
		b:SetAttribute("TestId", `{text} {id}`)
		local c = Instance.new("UICorner")
		c.CornerRadius = UDim.new(0, 5)
		c.Parent = b
		b.Activated:Connect(onClick)
		b.Parent = frame
	end
	button("Teleport", 6, function()
		teleportTo(id)
	end)
	button("Follow", 40, function()
		startFollow(id)
	end)
	frame.Parent = listBox
	return { frame = frame, label = label }
end

local function refresh()
	if not gui or not (gui :: ScreenGui).Enabled then
		return
	end
	local storms = table.clone(StormView.storms())
	table.sort(storms, function(a, b)
		return rank(a) > rank(b)
	end)
	local from = myPosition()
	local seen: { [string]: boolean } = {}
	for i, s in storms do
		seen[s.id] = true
		local row = rows[s.id] or newRow(s.id)
		rows[s.id] = row
		row.frame.LayoutOrder = i
		row.label.Text = describe(s, from)
		local following = follow ~= nil and (follow :: Follow).id == s.id
		row.frame.BackgroundColor3 = if following then Color3.fromRGB(40, 58, 92) else Ui.PANEL
	end
	for id, row in rows do
		if not seen[id] then
			row.frame:Destroy()
			rows[id] = nil
		end
	end
	local f = follow
	local status = if f then `Following {(findStorm(f.id) or {}).mode or f.id} · {f.mode} · zoom {string.format("%.1f", 1 / f.zoom)}x` else `{#storms} storm{if #storms == 1 then "" else "s"} on the map`
	statusLabel.Text = if message ~= "" then `{status}\n{message}` else status
	for name, b in modeButtons do
		Ui.setOn(b, (if f then f.mode else lastMode) == name)
	end
end

local function build(): ScreenGui
	local screen = Instance.new("ScreenGui")
	screen.Name = "StormDebug"
	screen.ResetOnSpawn = false
	screen.DisplayOrder = 20
	screen.Enabled = false
	local panel = Instance.new("Frame")
	panel.AnchorPoint = Vector2.new(1, 0)
	panel.Position = UDim2.new(1, -12, 0, 12)
	panel.Size = UDim2.new(0, WIDTH, 1, -24)
	panel.BackgroundColor3 = Color3.fromRGB(16, 20, 28)
	panel.BackgroundTransparency = 0.08
	panel.BorderSizePixel = 0
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, 8)
	corner.Parent = panel
	local pad = Instance.new("UIPadding")
	pad.PaddingLeft, pad.PaddingRight, pad.PaddingTop, pad.PaddingBottom = UDim.new(0, 10), UDim.new(0, 4), UDim.new(0, 10), UDim.new(0, 6)
	pad.Parent = panel
	panel.Parent = screen

	local column = Ui.column(panel)
	Ui.text(column, "Storm debug", { size = 18, bold = true })
	Ui.text(column, "E closes · Teleport puts you beside a storm · Follow is a cinematic camera (scroll to zoom, Backspace stops)", { size = 12, colour = Ui.MUTED })
	statusLabel = Ui.text(column, "", { size = 13 })
	local controls = Ui.buttons(column, 28)
	controls.Name = "Controls"
	local grid = controls:FindFirstChildOfClass("UIGridLayout") :: UIGridLayout
	grid.CellSize = UDim2.new(1 / 3, -5, 0, 28)
	for _, name in { "Orbit", "Chase" } do
		modeButtons[name] = Ui.button(controls, name, function()
			lastMode = name
			if follow then
				(follow :: Follow).mode = name
			end
			refresh()
		end)
	end
	Ui.button(controls, "Stop", function()
		stopFollow(true)
		refresh()
	end)
	listBox = Ui.section(column)
	listBox.Name = "Storms"
	local layout = listBox:FindFirstChildOfClass("UIListLayout") :: UIListLayout
	layout.Padding = UDim.new(0, 6)
	screen.Parent = player:WaitForChild("PlayerGui")
	return screen
end

local function isFlying(): boolean
	local character = player.Character
	local humanoid = if character then character:FindFirstChildOfClass("Humanoid") else nil
	return humanoid ~= nil and humanoid.PlatformStand and follow == nil
end

function DebugPage.toggle()
	if not gui then
		gui = build()
	end
	local screen = gui :: ScreenGui
	screen.Enabled = not screen.Enabled
	message = ""
	refresh()
end

function DebugPage.start()
	UserInputService.InputBegan:Connect(function(input: InputObject, processed: boolean)
		if processed then
			return
		end
		if input.KeyCode == Enum.KeyCode.E and not isFlying() then
			DebugPage.toggle()
		elseif input.KeyCode == Enum.KeyCode.Backspace and follow then
			stopFollow(true)
			refresh()
		end
	end)
	UserInputService.InputChanged:Connect(function(input: InputObject, processed: boolean)
		local f = follow
		if f and not processed and input.UserInputType == Enum.UserInputType.MouseWheel then
			f.zoom = math.clamp(f.zoom * (0.88 ^ input.Position.Z), 0.25, 4)
		end
	end)
	-- A respawn ends following (the new character is not hidden or carried).
	player.CharacterAdded:Connect(function()
		if follow then
			follow = nil
			local camera = workspace.CurrentCamera
			if camera then
				camera.CameraType = Enum.CameraType.Custom
			end
		end
	end)
	RunService:BindToRenderStep("StormDebugFollow", Enum.RenderPriority.Camera.Value + 1, stepFollow)
	task.spawn(function()
		while true do
			refresh()
			task.wait(1)
		end
	end)
end

return DebugPage
