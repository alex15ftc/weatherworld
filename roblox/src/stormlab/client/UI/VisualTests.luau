--!nonstrict
-- The tornado visual test runner, settings and frame recording (visual plan section 10). F4 shows it.
--   scenes    the deterministic scenes in shared/VisualTests: the server builds the pinned lab
--             storm and its tornado; here the visual clock, flashes and camera shot are applied
--   settings  moonlight, quality (secondary layers first), flash injection (near IC, distant CG,
--             burst), clear scene / overrides
--   counters  client frame time, tornado and storm cards, dust puffs, debris pieces, rain
--             shafts, active flashes, instance count under the lab's visuals
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
	local self: any = { schedule = nil, frameMs = 16, visible = false, current = nil, rainWrap = false, night = false, close = false }
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
	text("keys: 1-9, 0, - (or the keypad; keypad . / * + the genesis scenes) run scenes", 10, DIM)
	local status = text("pick a scene", 11, DIM)

	-- scenes
	-- the scene's toggles (kept from scene to scene): rain wrapped round the tornado (the server
	-- rebuilds the scene: the wrap is its rain), and night (the visual clock only)
	self.rainWrap, self.night = false, false
	-- tornado: nil = as the scene has it, true = add one under its storm, false = none
	self.tornado = nil
	local function runScene(scene: any)
		status.Text = "building " .. scene.label .. (if self.rainWrap then ", rain-wrapped" else "") .. " on the server…"
		ctx:command({ cmd = "testScene", id = scene.id, rainWrap = self.rainWrap, tornado = self.tornado })
		self.pending = scene
	end
	-- the visual clock: the night hour, else the current scene's daytime hour (none: the sim's)
	-- the scene's camera shot; "close" films it from 600 m (motion, striations, the funnel's
	-- texture) instead of the scene's own 1-3.5 km
	local function applyCamera()
		local cl = self.current and self.current.client or {}
		local cam = if cl.camera then table.clone(cl.camera) else nil
		if cam and self.close then
			cam.dist, cam.dollyTo, cam.dollyTime = 600, nil, nil
		end
		ctx.state.cameraPreset = cam
	end
	local function applyClock()
		local cl = self.current and self.current.client or {}
		ctx.state.clockOverride = if self.night then Scenes.NIGHT_HOUR else cl.localHour
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
		self.current = nil
		applyClock()
		ctx.state.cameraPreset = nil
		ctx.state.focusKind, ctx.state.focusId = "tornado", nil
		self.schedule = nil
		status.Text = "cleared"
	end)

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
		self.night = not self.night
		applyClock()
	end)
	local rw = row()
	local closeB = button(rw, "camera: scene", 150, function()
		self.close = not self.close
		applyCamera()
	end)
	-- add a tornado to a scene without one (or take it away): the server rebuilds the scene
	-- with the same storm (key L)
	local function toggleTornado()
		local has = if self.tornado ~= nil then self.tornado else not (self.current and self.current.noTornado)
		self.tornado = not has
		if self.current then
			runScene(self.current)
		end
	end
	self.toggleTornado = toggleTornado
	local torB = button(rw, "tornado: scene", 130, toggleTornado)
	local wrapB = button(rw, "rain-wrap: off", 150, function()
		self.rainWrap = not self.rainWrap
		-- rebuild the scene on screen with (or without) the wrap
		if self.current then
			runScene(self.current)
		end
	end)
	-- record the storm frames the server sends (Sim/Frames; ServerStorage.StormLabRecordings),
	-- to replay them later with LabConfig.SOURCE.mode = "replay"
	local recording = false
	local rr = row()
	local recB = button(rr, "record: off", 150, function()
		ctx:command({ cmd = "record", on = not recording })
	end)
	-- replay the last recording through the relay (the main game's path), or back to the sim
	local srcB = button(rr, "replay last", 100, function()
		ctx:command({ cmd = "source", mode = if ctx.source == "replay" then "sim" else "replay" })
	end)
	ctx.signals.event:Connect(function(e)
		if e.kind == "recording" then
			recording = e.on
		end
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

	-- where hail falls: the camera into the biggest surface hail (the replicated field), looking
	-- at the nearest storm; hail shows only inside its swath
	text("Camera", 12, ACCENT, true)
	local rh = row()
	local hailB
	hailB = button(rh, "go to hail core", 150, function()
		local vol = ctx.cw.vol
		if not vol or not vol.hail then
			hailB.Text = "no field yet"
			return
		end
		local nx, x0 = vol.nxv, vol.x0
		local vox = -2 * x0 / nx
		local best, bc = 0, nil
		for col, h in vol.hail do
			if h > best then
				best, bc = h, col
			end
		end
		if not bc or best < 0.5 then
			hailB.Text = "no hail on the ground"
			return
		end
		local x, y = x0 + (bc % nx + 0.5) * vox, x0 + (bc // nx + 0.5) * vox
		local near, nd = nil, math.huge
		for _, st in ctx.cw.storms do
			local d = (st.x - x) ^ 2 + (st.y - y) ^ 2
			if d < nd then
				near, nd = st, d
			end
		end
		ctx.state.cameraGoto = { x = x, y = y, z = 2, lookX = near and near.x or x + 1, lookY = near and near.y or y, pitch = 12 }
		hailB.Text = string.format("hail %.1f cm (go again)", best)
	end)
	-- the test town and its hills (LabConfig.groundCentre): the camera 1.5 km off, raised a little,
	-- looking at the town
	button(rh, "go to town", 110, function()
		local c = ctx.Config.groundCentre
		if c then
			ctx.state.cameraGoto = { x = c.x - 1500, y = c.y - 1500, z = 60, lookX = c.x, lookY = c.y, pitch = 0 }
		end
	end)

	-- performance sweep: the frame time with everything on, then with each layer switched off in
	-- turn (render cost included, which the script counters miss); printed to Output
	local sweeping = false
	local rp = row()
	button(rp, "perf sweep (~1 min)", 170, function()
		if sweeping then
			return
		end
		sweeping = true
		task.spawn(function()
			local show = ctx.state.show
			local function measure(): (number, number)
				task.wait(1.5) -- (settle: layers rebuild or fade)
				local ts = {}
				local t0 = os.clock()
				while os.clock() - t0 < 4 do
					table.insert(ts, RunService.RenderStepped:Wait() * 1000)
				end
				table.sort(ts)
				local sum = 0
				for _, v in ts do
					sum += v
				end
				return sum / #ts, ts[math.max(1, math.floor(#ts * 0.9))]
			end
			local W = game:GetService("Workspace")
			print(string.format("[PerfSweep] server step %s ms (same process in Studio Play), terrain building: %s",
				tostring(W:GetAttribute("StormLabFrameMs")), tostring(W:GetAttribute("TerrainBuilding"))))
			local base, p90 = measure()
			print(string.format("[PerfSweep] all on: %.1f ms (%.0f fps), p90 %.1f ms, instances %d | %s", base, 1000 / base, p90,
				#ctx.root:GetDescendants(), tostring(ctx.root:GetAttribute("ClientModuleMs"))))
			local saved = {}
			for k, v in show do
				saved[k] = v
			end
			for _, layer in { "clouds", "rain", "funnel", "dust", "debris", "sky", "lightning", "labels" } do
				if saved[layer] then
					show[layer] = false
					local m, q = measure()
					print(string.format("[PerfSweep] %-9s off: %.1f ms (p90 %.1f) -> saves %.1f ms", layer, m, q, base - m))
					show[layer] = true
				end
			end
			for k in saved do
				show[k] = false
			end
			local m0 = measure()
			print(string.format("[PerfSweep] all off: %.1f ms -> the layers cost %.1f ms together", m0, base - m0))
			for k, v in saved do
				show[k] = v
			end
			local again = measure()
			print(string.format("[PerfSweep] all on again: %.1f ms (drift %.1f ms)", again, again - base))
			sweeping = false
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
		self.current = scene
		applyClock()
		-- (a storm-structure scene has no tornado: look at its storm)
		if e.tornado then
			ctx.state.focusKind, ctx.state.focusId = "tornado", e.tornado
		else
			ctx.state.focusKind, ctx.state.focusId = "storm", "LAB" .. tostring(scene.storm.seed)
		end
		applyCamera()
		self.schedule = if cl.flashes then { list = cl.flashes, every = cl.flashEvery, start = os.clock(), done = {} } else nil
		status.Text = string.format("<b>%s</b>%s · tornado %s · local %s h", scene.label, if e.rainWrap then ", rain-wrapped" else "", tostring(e.tornado), tostring(ctx.state.clockOverride or "sim"))
	end)

	UserInputService.InputBegan:Connect(function(input, processed)
		if processed or UserInputService:GetFocusedTextBox() then
			return
		end
		if input.KeyCode == Enum.KeyCode.F4 then
			root.Visible = not root.Visible
			return
		end
		if input.KeyCode == Enum.KeyCode.F6 then
			-- (F6: the night setting, as its button - for scripted checks)
			self.night = not self.night
			applyClock()
			print("[visual tests] night " .. tostring(self.night))
			return
		end
		if input.KeyCode == Enum.KeyCode.L and self.current then
			self.toggleTornado()
			return
		end
		-- with the panel open: 1-9, 0, minus run the scenes in order
		if not root.Visible then
			return
		end
		local digits = { Enum.KeyCode.One, Enum.KeyCode.Two, Enum.KeyCode.Three, Enum.KeyCode.Four, Enum.KeyCode.Five,
			Enum.KeyCode.Six, Enum.KeyCode.Seven, Enum.KeyCode.Eight, Enum.KeyCode.Nine, Enum.KeyCode.Zero, Enum.KeyCode.Minus }
		local pad = { Enum.KeyCode.KeypadOne, Enum.KeyCode.KeypadTwo, Enum.KeyCode.KeypadThree, Enum.KeyCode.KeypadFour, Enum.KeyCode.KeypadFive,
			Enum.KeyCode.KeypadSix, Enum.KeyCode.KeypadSeven, Enum.KeyCode.KeypadEight, Enum.KeyCode.KeypadNine, Enum.KeyCode.KeypadZero, Enum.KeyCode.KeypadMinus,
			Enum.KeyCode.KeypadPeriod, Enum.KeyCode.KeypadDivide, Enum.KeyCode.KeypadMultiply, Enum.KeyCode.KeypadPlus, Enum.KeyCode.KeypadEnter, Enum.KeyCode.KeypadEquals }
		local n = table.find(digits, input.KeyCode) or table.find(pad, input.KeyCode)
		if input.KeyCode == Enum.KeyCode.G then
			local sc = Scenes.byId("stovepipe_sun")
			if sc then
				runScene(sc)
			end
			return
		end
		if input.KeyCode == Enum.KeyCode.K then
			local sc = Scenes.byId("tube")
			if sc then
				runScene(sc)
			end
			return
		end
		if n and Scenes.SCENES[n] then
			runScene(Scenes.SCENES[n])
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
		moonB.Text = "moon: " .. (if (ctx.state.moonlight or 0) > 0 then "on" else "off")
		qualB.Text = "quality: " .. (if (ctx.state.quality or 1) >= 1 then "full" else "low")
		nightB.Text = "night: " .. (if self.night then "on" else "off")
		closeB.Text = "camera: " .. (if self.close then "close (600 m)" else "scene")
		wrapB.Text = "rain-wrap: " .. (if self.rainWrap then "on" else "off")
		torB.Text = "tornado (L): " .. (if self.tornado == nil then "scene" elseif self.tornado then "on" else "off")
		recB.Text = "record: " .. (if recording then "on" else "off") .. " · " .. tostring(ctx.source or "sim")
		srcB.Text = if ctx.source == "replay" then "back to sim" else "replay last"
		local nInst = #ctx.root:GetDescendants()
		counters.Text = string.format(
			"client %.1f ms/frame (%.0f fps)\ntornado: %s\nstorms: %s · shafts %s\ndust %s · debris %s · flashes %d\nvisual instances %d\nrain at camera %s mm/h · camera %s",
			self.frameMs, 1000 / math.max(1, self.frameMs), tostring(ctx.root:GetAttribute("TornadoCards") or "-"),
			tostring(ctx.root:GetAttribute("StormCards") or "-"), tostring(ctx.root:GetAttribute("CloudShafts") or 0),
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
