--!nonstrict
-- The tornado visual test runner and debug views (visual plan section 10). F4 shows it.
--   scenes    the deterministic scenes in shared/VisualTests: the server builds the pinned lab
--             storm and its tornado; here the visual clock, flashes and camera shot are applied
--   debug     main geometry only, condensation field, centreline + profile points, sub-vortex
--             ids and trajectories, ground-effect radius, LOD readout, physics/visual separation,
--             lightning events (ctx.state.debug, read by Render/TornadoVisuals)
--   settings  moonlight, quality (secondary layers first), flash injection (near IC, distant CG,
--             burst), clear scene / overrides
--   counters  client frame time, tornado visual ms and LOD counts, dust puffs, debris pieces,
--             cloud parts, active flashes, instance count under the lab's visuals
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local UserInputService = game:GetService("UserInputService")

local VisualTestsUI = {}

local BG = Color3.fromRGB(18, 22, 28)
local FG = Color3.fromRGB(226, 230, 236)
local DIM = Color3.fromRGB(150, 158, 170)
local ACCENT = Color3.fromRGB(255, 176, 90)

local function make(className: string, props: { [string]: any }, parent: Instance?): any
	local i = Instance.new(className)
	for k, v in props do
		(i :: any)[k] = v
	end
	if parent then
		i.Parent = parent
	end
	return i
end

function VisualTestsUI.new(ctx: any): any
	local Scenes = require(ReplicatedStorage:WaitForChild("StormLab"):WaitForChild("VisualTests"))
	local self = { schedule = nil, frameMs = 16, visible = false }
	local root = make("Frame", {
		Name = "VisualTests", AnchorPoint = Vector2.new(1, 1), Position = UDim2.new(1, -10, 1, -10), Size = UDim2.fromOffset(330, 560),
		BackgroundColor3 = BG, BackgroundTransparency = 0.15, BorderSizePixel = 0, Visible = false,
	}, ctx.ui)
	make("UICorner", { CornerRadius = UDim.new(0, 8) }, root)
	local scroll = make("ScrollingFrame", {
		Size = UDim2.new(1, -8, 1, -8), Position = UDim2.fromOffset(4, 4), BackgroundTransparency = 1, BorderSizePixel = 0,
		ScrollBarThickness = 4, CanvasSize = UDim2.new(), AutomaticCanvasSize = Enum.AutomaticSize.Y,
	}, root)
	make("UIListLayout", { Padding = UDim.new(0, 4), SortOrder = Enum.SortOrder.LayoutOrder }, scroll)
	make("UIPadding", { PaddingLeft = UDim.new(0, 6), PaddingRight = UDim.new(0, 6), PaddingTop = UDim.new(0, 4) }, scroll)
	local order = 0
	local function nxt(): number
		order += 1
		return order
	end
	local function text(t: string, size: number?, colour: Color3?, bold: boolean?): TextLabel
		return make("TextLabel", {
			LayoutOrder = nxt(), Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, BackgroundTransparency = 1,
			Text = t, TextColor3 = colour or FG, TextSize = size or 12, Font = if bold then Enum.Font.GothamBold else Enum.Font.Gotham,
			TextXAlignment = Enum.TextXAlignment.Left, TextWrapped = true, RichText = true,
		}, scroll)
	end
	local function row(): Frame
		local f = make("Frame", { LayoutOrder = nxt(), Size = UDim2.new(1, 0, 0, 24), BackgroundTransparency = 1 }, scroll)
		make("UIListLayout", { FillDirection = Enum.FillDirection.Horizontal, Padding = UDim.new(0, 4) }, f)
		return f
	end
	local function button(parent: Instance, t: string, w: number, fn: () -> ()): TextButton
		local b = make("TextButton", {
			Size = UDim2.new(0, w, 1, 0), BackgroundColor3 = Color3.fromRGB(40, 48, 60), BorderSizePixel = 0,
			Text = t, TextColor3 = FG, TextSize = 11, Font = Enum.Font.GothamMedium, AutoButtonColor = true, TextWrapped = true,
		}, parent)
		make("UICorner", { CornerRadius = UDim.new(0, 4) }, b)
		b.MouseButton1Click:Connect(fn)
		return b
	end

	text("TORNADO VISUAL TESTS  (F4)", 14, ACCENT, true)
	text("keys: 1-9, 0, - (or the keypad) run scenes · Shift+1-8 debug views", 10, DIM)
	local status = text("pick a scene", 11, DIM)

	-- scenes
	local function runScene(scene: any)
		status.Text = "building " .. scene.label .. " on the server…"
		ctx:command({ cmd = "testScene", id = scene.id })
		self.pending = scene
	end
	text("Scenes", 12, ACCENT, true)
	local r
	for n, scene in Scenes.SCENES do
		if n % 2 == 1 then
			r = row()
		end
		button(r, scene.label, 150, function()
			runScene(scene)
		end)
	end
	local rc = row()
	button(rc, "Clear scene + overrides", 200, function()
		ctx:command({ cmd = "clearScene" })
		ctx.state.clockOverride = nil
		ctx.state.cameraPreset = nil
		ctx.state.focusKind, ctx.state.focusId = "tornado", nil
		self.schedule = nil
		status.Text = "cleared"
	end)

	-- debug views
	text("Debug views", 12, ACCENT, true)
	local dbgButtons = {}
	local DBG = {
		{ "geometryOnly", "geometry" }, { "condensation", "condensation" }, { "centerline", "centreline" },
		{ "subvortices", "sub-vortices" }, { "groundRadius", "ground radius" }, { "lod", "LOD" },
		{ "physics", "physics check" }, { "flashes", "flashes" },
	}
	for n, d in DBG do
		if n % 3 == 1 then
			r = row()
		end
		dbgButtons[d[1]] = button(r, d[2], 100, function()
			ctx.state.debug[d[1]] = not ctx.state.debug[d[1]]
		end)
	end

	-- settings
	text("Settings", 12, ACCENT, true)
	local rs = row()
	local moonB = button(rs, "moon: off", 100, function()
		ctx.state.moonlight = if (ctx.state.moonlight or 0) > 0 then 0 else 1
	end)
	local qualB = button(rs, "quality: full", 100, function()
		ctx.state.quality = if (ctx.state.quality or 1) >= 1 then 0.5 else 1
	end)
	local nightB = button(rs, "night: off", 100, function()
		ctx.state.clockOverride = if ctx.state.clockOverride then nil else 22.5
	end)

	-- flash injection (visual only: the same flash path the server's lightning takes)
	local function inject(kind: string, distance: number, bearing: number, height: number, current: number)
		local fx, fy = ctx:focus()
		local a = math.rad(90 - bearing)
		local x, y = fx + math.cos(a) * distance, fy + math.sin(a) * distance
		local seed = math.random(1, 1e8)
		local f
		if kind == "ic" then
			local b = a + math.rad(70)
			f = { kind = "ic", x0 = x - math.cos(b) * 2500, y0 = y - math.sin(b) * 2500, z0 = height, x1 = x + math.cos(b) * 2500, y1 = y + math.sin(b) * 2500, z1 = height + 400, seed = seed, current = 0 }
		else
			f = { kind = kind, x0 = x + 500, y0 = y + 300, z0 = height, x1 = x, y1 = y, z1 = 0, seed = seed, current = current }
		end
		f.t = ctx:simTime()
		ctx.signals.flash:Fire(f)
	end
	text("Lightning", 12, ACCENT, true)
	local rl = row()
	button(rl, "near IC", 100, function()
		inject("ic", 2500, 30, 6000, 0)
	end)
	button(rl, "near CG", 100, function()
		inject("cg", 1800, 80, 5500, 30)
	end)
	button(rl, "far CG", 100, function()
		inject("cg", 14000, 70, 6000, 30)
	end)
	local rl2 = row()
	button(rl2, "burst (4)", 100, function()
		task.spawn(function()
			for _, d in { { "ic", 3000, 10, 6500, 0 }, { "cg", 1800, 80, 5500, 25 }, { "ic", 4000, -30, 7000, 0 }, { "cg", 2600, 120, 6000, 40 } } do
				inject(d[1], d[2], d[3], d[4], d[5])
				task.wait(0.3 + math.random() * 0.3)
			end
		end)
	end)

	text("Counters", 12, ACCENT, true)
	local counters = text("", 11, DIM)

	-- the server built the scene: apply its client side
	ctx.signals.event:Connect(function(e)
		if e.kind ~= "labScene" then
			return
		end
		local scene = Scenes.byId(e.id)
		if not scene then
			return
		end
		local cl = scene.client or {}
		ctx.state.clockOverride = cl.localHour
		ctx.state.focusKind, ctx.state.focusId = "tornado", e.tornado
		ctx.state.cameraPreset = if cl.camera then table.clone(cl.camera) else nil
		self.schedule = if cl.flashes then { list = cl.flashes, every = cl.flashEvery, start = os.clock(), done = {} } else nil
		status.Text = string.format("<b>%s</b> · tornado %s · local %s h", scene.label, tostring(e.tornado), tostring(cl.localHour or "sim"))
	end)

	UserInputService.InputBegan:Connect(function(input, processed)
		if processed or UserInputService:GetFocusedTextBox() then
			return
		end
		if input.KeyCode == Enum.KeyCode.F4 then
			root.Visible = not root.Visible
			return
		end
		-- with the panel open: 1-9, 0, minus run the scenes in order; Shift + 1-8 toggle the
		-- debug views (keyboard: the same shots whatever the window layout)
		if not root.Visible then
			return
		end
		local digits = { Enum.KeyCode.One, Enum.KeyCode.Two, Enum.KeyCode.Three, Enum.KeyCode.Four, Enum.KeyCode.Five,
			Enum.KeyCode.Six, Enum.KeyCode.Seven, Enum.KeyCode.Eight, Enum.KeyCode.Nine, Enum.KeyCode.Zero, Enum.KeyCode.Minus }
		local pad = { Enum.KeyCode.KeypadOne, Enum.KeyCode.KeypadTwo, Enum.KeyCode.KeypadThree, Enum.KeyCode.KeypadFour, Enum.KeyCode.KeypadFive,
			Enum.KeyCode.KeypadSix, Enum.KeyCode.KeypadSeven, Enum.KeyCode.KeypadEight, Enum.KeyCode.KeypadNine, Enum.KeyCode.KeypadZero, Enum.KeyCode.KeypadMinus }
		local n = table.find(digits, input.KeyCode) or table.find(pad, input.KeyCode)
		if n then
			if UserInputService:IsKeyDown(Enum.KeyCode.LeftShift) then
				local d = DBG[n]
				if d then
					ctx.state.debug[d[1]] = not ctx.state.debug[d[1]]
				end
			elseif Scenes.SCENES[n] then
				runScene(Scenes.SCENES[n])
			end
		end
	end)

	local acc = 0
	function self:update(dt: number)
		self.frameMs = self.frameMs * 0.95 + dt * 1000 * 0.05
		-- scheduled flashes (relative to the focus tornado)
		local sch = self.schedule
		if sch then
			local t = os.clock() - sch.start
			local cycle = if sch.every then math.floor(t / sch.every) else 0
			local local_t = if sch.every then t - cycle * sch.every else t
			for n, f in sch.list do
				local key = cycle * 100 + n
				if local_t >= f.at and not sch.done[key] then
					sch.done[key] = true
					inject(f.kind, f.distance, f.bearing, f.height, f.current or 0)
				end
			end
		end
		acc += dt
		if acc < 0.25 or not root.Visible then
			return
		end
		acc = 0
		for key, b in dbgButtons do
			b.BackgroundColor3 = if ctx.state.debug[key] then Color3.fromRGB(150, 92, 40) else Color3.fromRGB(40, 48, 60)
		end
		moonB.Text = "moon: " .. (if (ctx.state.moonlight or 0) > 0 then "on" else "off")
		qualB.Text = "quality: " .. (if (ctx.state.quality or 1) >= 1 then "full" else "low")
		nightB.Text = "night: " .. (if ctx.state.clockOverride then string.format("%.1f h", ctx.state.clockOverride) else "off")
		local nInst = #ctx.root:GetDescendants()
		counters.Text = string.format(
			"client %.1f ms/frame (%.0f fps)\ntornado: %s\ncloud parts %s (%s ms) · shafts %s\ndust %s · debris %s · flashes %d\nvisual instances %d\nrain at camera %s mm/h · camera %s",
			self.frameMs, 1000 / math.max(1, self.frameMs), tostring(ctx.root:GetAttribute("TornadoVisuals") or "-"),
			tostring(ctx.root:GetAttribute("CloudParts") or 0), tostring(ctx.root:GetAttribute("CloudMs") or 0), tostring(ctx.root:GetAttribute("CloudShafts") or 0),
			tostring(ctx.root:GetAttribute("DustPuffs") or 0), tostring(ctx.root:GetAttribute("DebrisPieces") or 0),
			if ctx.flashField then #ctx.flashField.flashes else 0, nInst,
			tostring(ctx.root:GetAttribute("PrecipRain") or "-"), (function()
				local x, y, z = ctx:simCamera()
				return string.format("%.1f, %.1f km, %.0f m", x / 1000, y / 1000, z)
			end)())
	end

	local _ = RunService
	return self
end

return VisualTestsUI
