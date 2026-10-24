--!nonstrict
-- The lab's control panel (left side) and 3-D labels.
--   controls  scenario, pause, time scale, force a tornado under the most rotating storm, move
--             the test town into the tornado's path, reset it, genesis / initiation on-off
--   layers    funnel, dust, debris, clouds, rain, lightning, sky, radar (R), map (M), wind (J),
--             labels; H hides the panel
--   readouts  the focus storm's fields, the tornado's state and rating, the inflow environment,
--             what the weather engine itself did at the same time (the scenario's track), the
--             server's cost, recent events (genesis, mergers, damage)
local Players = game:GetService("Players")
local UserInputService = game:GetService("UserInputService")

local Panel = {}

local BG = Color3.fromRGB(18, 22, 28)
local FG = Color3.fromRGB(226, 230, 236)
local DIM = Color3.fromRGB(150, 158, 170)
local ACCENT = Color3.fromRGB(96, 170, 255)

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

function Panel.new(ctx: any): any
	local C = ctx.Config
	local self = { log = {}, labels = {} }
	local root = make("Frame", {
		Name = "Panel", Position = UDim2.fromOffset(10, 64), Size = UDim2.new(0, 290, 1, -74), -- (below the Roblox menu buttons)
		BackgroundColor3 = BG, BackgroundTransparency = 0.18, BorderSizePixel = 0,
	}, ctx.ui)
	make("UICorner", { CornerRadius = UDim.new(0, 8) }, root)
	local scroll = make("ScrollingFrame", {
		Size = UDim2.new(1, -8, 1, -8), Position = UDim2.fromOffset(4, 4), BackgroundTransparency = 1,
		BorderSizePixel = 0, ScrollBarThickness = 4, CanvasSize = UDim2.new(), AutomaticCanvasSize = Enum.AutomaticSize.Y,
	}, root)
	make("UIListLayout", { Padding = UDim.new(0, 4), SortOrder = Enum.SortOrder.LayoutOrder }, scroll)
	make("UIPadding", { PaddingLeft = UDim.new(0, 6), PaddingRight = UDim.new(0, 6), PaddingTop = UDim.new(0, 4) }, scroll)
	local order = 0
	local function nextOrder(): number
		order += 1
		return order
	end
	local function label(text: string, size: number?, colour: Color3?, bold: boolean?): TextLabel
		return make("TextLabel", {
			LayoutOrder = nextOrder(), Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y,
			BackgroundTransparency = 1, Text = text, TextColor3 = colour or FG, TextSize = size or 13,
			Font = if bold then Enum.Font.GothamBold else Enum.Font.Gotham, TextXAlignment = Enum.TextXAlignment.Left,
			TextWrapped = true, RichText = true,
		}, scroll)
	end
	local function row(): Frame
		local f = make("Frame", { LayoutOrder = nextOrder(), Size = UDim2.new(1, 0, 0, 24), BackgroundTransparency = 1 }, scroll)
		make("UIListLayout", { FillDirection = Enum.FillDirection.Horizontal, Padding = UDim.new(0, 4) }, f)
		return f
	end
	local function button(parent: Instance, text: string, width: number, onClick: () -> ()): TextButton
		local b = make("TextButton", {
			Size = UDim2.new(0, width, 1, 0), BackgroundColor3 = Color3.fromRGB(40, 48, 60), BorderSizePixel = 0,
			Text = text, TextColor3 = FG, TextSize = 12, Font = Enum.Font.GothamMedium, AutoButtonColor = true,
		}, parent)
		make("UICorner", { CornerRadius = UDim.new(0, 4) }, b)
		b.MouseButton1Click:Connect(onClick)
		return b
	end

	label("STORM LAB", 16, ACCENT, true)
	local header = label("", 12, DIM)

	label("Controls", 13, ACCENT, true)
	local r1 = row()
	local pauseB = button(r1, "Pause", 56, function()
		ctx:command({ cmd = "pause" })
	end)
	for _, s in { 1, 5, 15, 60 } do
		button(r1, s .. "x", 44, function()
			ctx:command({ cmd = "timeScale", value = s })
		end)
	end
	local r2 = row()
	for _, name in C.SCENARIOS do
		button(r2, name, 128, function()
			ctx:command({ cmd = "scenario", name = name })
		end)
	end
	local r3 = row()
	button(r3, "Force tornado", 96, function()
		ctx:command({ cmd = "forceTornado" })
	end)
	button(r3, "Town ahead", 84, function()
		ctx:command({ cmd = "townHere" })
	end)
	button(r3, "Reset town", 80, function()
		ctx:command({ cmd = "resetTown" })
	end)
	local r4 = row()
	local genB = button(r4, "Genesis: on", 132, function()
		ctx:command({ cmd = "genesis" })
	end)
	local iniB = button(r4, "Initiation: on", 132, function()
		ctx:command({ cmd = "initiation" })
	end)

	label("Layers", 13, ACCENT, true)
	local layerButtons = {}
	local layerRows = { { "funnel", "dust", "debris" }, { "clouds", "rain", "lightning" }, { "sky", "radar", "map" }, { "wind", "labels" } }
	for _, names in layerRows do
		local r = row()
		for _, n in names do
			layerButtons[n] = button(r, n, 88, function()
				ctx.state.show[n] = not ctx.state.show[n]
			end)
		end
	end
	local camLabel = label("", 12, DIM)

	label("Focus", 13, ACCENT, true)
	local focusText = label("", 12)
	label("Tornado", 13, ACCENT, true)
	local tornadoText = label("", 12)
	label("Inflow environment", 13, ACCENT, true)
	local envText = label("", 12)
	label("Weather engine at this time", 13, ACCENT, true)
	local engineText = label("", 12, DIM)
	label("Events", 13, ACCENT, true)
	local eventText = label("", 11, DIM)
	label("Keys: Tab next focus · C camera mode · right-drag look · wheel zoom · WASD/E/Q fly (free) · R radar · M map · J wind arrows, [ ] height, K scale · H hide panel", 11, DIM)

	UserInputService.InputBegan:Connect(function(input, processed)
		if processed or UserInputService:GetFocusedTextBox() then
			return
		end
		if input.KeyCode == Enum.KeyCode.H then
			root.Visible = not root.Visible
		end
	end)

	local function addLog(text: string)
		table.insert(self.log, 1, text)
		while #self.log > 9 do
			table.remove(self.log)
		end
		eventText.Text = table.concat(self.log, "\n")
	end
	local function clock(simHourUtc: number): string
		local meta = ctx.scenarioData and ctx.scenarioData.meta
		local off = if meta and meta.sun then meta.sun.utcOffsetHours else -6
		local h = (simHourUtc + off) % 24
		return string.format("%02d:%02d local", math.floor(h), math.floor((h % 1) * 60))
	end
	ctx.signals.event:Connect(function(e)
		local t = ctx:simTime()
		local stamp = string.format("[%d:%02d] ", math.floor(t / 60), math.floor(t % 60))
		if e.kind == "tornado" then
			addLog(stamp .. "<b>tornado " .. tostring(e.id) .. "</b> from " .. tostring(e.parent))
		elseif e.kind == "initiation" then
			addLog(stamp .. "new cell " .. tostring(e.id))
		elseif e.kind == "merge" then
			addLog(stamp .. tostring(e.from) .. " merged into " .. tostring(e.into))
		elseif e.kind == "damage" then
			local worst = nil
			for _, r in e.reports do
				if not worst or r.degree > worst.degree then
					worst = r
				end
			end
			if worst then
				addLog(stamp .. string.format("%s: %s (%.0f mph)", worst.id, worst.text, worst.wind * 2.237))
			end
		elseif e.kind == "town" then
			addLog(stamp .. string.format("town at %.1f, %.1f km", e.x / 1000, e.y / 1000))
		elseif e.kind == "scenario" then
			addLog(stamp .. "scenario " .. tostring(e.scenario))
		end
	end)

	-- 3-D labels over storms and tornadoes (scaled toward the camera when far)
	local labelAnchor = make("Part", { Name = "LabelAnchor", Anchored = true, CanCollide = false, CanQuery = false, CanTouch = false, Transparency = 1, Size = Vector3.one }, ctx.root)
	local function labelFor(key: string): any
		local l = self.labels[key]
		if l then
			return l
		end
		local att = make("Attachment", {}, labelAnchor)
		local bb = make("BillboardGui", { Adornee = att, Size = UDim2.fromOffset(160, 34), AlwaysOnTop = true, LightInfluence = 0, MaxDistance = 1e9 }, labelAnchor)
		local tl = make("TextLabel", { Size = UDim2.fromScale(1, 1), BackgroundTransparency = 1, TextColor3 = FG, TextStrokeTransparency = 0.4, TextSize = 13, Font = Enum.Font.GothamMedium }, bb)
		l = { att = att, bb = bb, tl = tl, seen = true }
		self.labels[key] = l
		return l
	end

	local acc = 0
	function self:update(dt: number)
		acc += dt
		-- labels every frame (positions), text 4 Hz
		local cw = ctx.cw
		local camPos = ctx.camera.CFrame.Position
		for _, l in self.labels do
			l.seen = false
		end
		if ctx.state.show.labels then
			local function place(key: string, x: number, y: number, z: number, text: string?, colour: Color3?)
				local l = labelFor(key)
				l.seen = true
				local w = C.toWorld(x, y, z)
				local d = (w - camPos).Magnitude
				if d > C.LIMITS.farDraw then
					w = camPos + (w - camPos) * (C.LIMITS.farDraw / d)
				end
				l.att.WorldPosition = w
				if text then
					l.tl.Text = text
				end
				if colour then
					l.tl.TextColor3 = colour
				end
				l.bb.Enabled = true
			end
			for _, s in cw.storms do
				if not s.dead and s.W > 6 then
					place("S" .. s.id, s.x, s.y, s.base, if acc > 0.25 then string.format("%s  W%.0f%s", s.id, s.W, if s.rot > 0.5 then "  ↻" .. math.floor(s.vlow) else "") else nil)
				end
			end
			for _, t in cw.tornadoes do
				if not t.ended then
					place("T" .. t.id, t.x, t.y, t.cloudBase * 1.05, if acc > 0.25 then string.format("%s  EF%d  %s", t.id, math.max(0, t.ef), t.stage) else nil, Color3.fromRGB(255, 120, 110))
				end
			end
		end
		for key, l in self.labels do
			if not l.seen then
				l.bb.Enabled = false
			end
		end
		if acc < 0.25 then
			return
		end
		acc = 0
		local st = ctx.state
		local sv = ctx.serverSettings or {}
		header.Text = string.format("%s · %s · sim %d:%02d · %sx%s", ctx.scenario or "?", clock(cw.clockUtc or 0), math.floor(ctx:simTime() / 60), math.floor(ctx:simTime() % 60), tostring(st.timeScale), if st.paused then " (paused)" else "")
		pauseB.Text = if st.paused then "Resume" else "Pause"
		genB.Text = "Genesis: " .. (if sv.genesis == false then "off" else "on")
		iniB.Text = "Initiation: " .. (if sv.initiation == false then "off" else "on")
		for n, b in layerButtons do
			b.BackgroundColor3 = if st.show[n] then Color3.fromRGB(40, 92, 150) else Color3.fromRGB(40, 48, 60)
		end
		camLabel.Text = string.format("camera: %s · server %s ms/frame · %s parcels · dust %s · debris %s",
			st.cameraMode or "?", tostring(workspace:GetAttribute("StormLabFrameMs") or "?"), tostring(workspace:GetAttribute("StormLabParcels") or "?"),
			tostring(ctx.root:GetAttribute("DustPuffs") or 0), tostring(ctx.root:GetAttribute("DebrisPieces") or 0))
		-- focus storm (or the parent of the focus tornado)
		local fx, fy, kind, id = ctx:focus()
		local storm = nil
		for _, s in cw.storms do
			if (kind == "storm" and s.id == id) or (kind == "tornado" and s.tornado == id) then
				storm = s
			end
		end
		if storm then
			local s = storm
			focusText.Text = string.format(
				"<b>%s</b>%s  age %d min · moving %.0f m/s to %03d°\nupdraft %.0f m/s, radius %.1f km · base %.0f m · top %.1f km\nmeso mid %.0f / low %.0f m/s · rot %.2f · occlusion %.2f (cycle %d)\nRFD %.1f m/s (%.1f K) · FFD %.1f m/s · wall cloud −%.0f m\nrain %.0f t/s (eff %.2f) · hail %.1f cm · %.0f flashes/min\ngenesis potential %.2f · %s",
				s.id, if s.leftMover then " (left mover)" else "", math.floor(s.age / 60), math.sqrt(s.u ^ 2 + s.v ^ 2),
				math.floor((90 - math.deg(math.atan2(s.v, s.u))) % 360), s.W, s.Ru / 1000, s.base, s.top / 1000,
				s.vmid, s.vlow, s.rot, s.occl, s.cycle, s.rfd, s.rfdDeficit or 0, s.ffd, s.lowering or 0,
				(s.precipRate or 0) / 1000, s.efficiency or 0, s.hailMax or 0, s.lightning or 0, s.G or 0,
				if s.systemId then "in line " .. s.systemId else (if s.surfaceBased then "surface-based" else "elevated"))
			envText.Text = string.format("CAPE %d J/kg · CIN %d · LCL %d m\nSRH 0-1 %d · 0-3 %d m²/s² · shear 0-6 %.0f m/s\ncold pool / shear ratio %.2f · loading %.1f g/m³",
				math.floor(s.cape or 0), math.floor(s.cin or 0), math.floor(s.lcl or 0), math.floor(s.srh01 or 0), math.floor(s.srh03 or 0), s.shear06 or 0, s.rkw or 0, s.loading or 0)
		else
			focusText.Text = if kind == "none" then "no storms" else tostring(id)
			local ok, a = pcall(function()
				return cw.env:analysisAt(fx, fy)
			end)
			envText.Text = if ok then string.format("CAPE %d · CIN %d · LCL %d m · SRH01 %d · S06 %.0f m/s", a.sbcape, a.sbcin, a.lcl, a.srh01, a.shear06) else ""
		end
		local tt = nil
		for _, t in cw.tornadoes do
			if (kind == "tornado" and t.id == id) or (storm and storm.tornado == t.id) then
				tt = t
			end
		end
		if tt then
			tornadoText.Text = string.format(
				"<b>%s</b> %s · age %d:%02d\nvc %.0f m/s · core radius %.0f m · swirl %.2f\npeak 10 m wind %.0f m/s (%.0f mph) → <b>EF%d</b> (peak EF%d)\nmoving %.0f m/s · cloud base %.0f m · funnel at ground %s\ndebris lofted %.2f to %.0f m · path %.1f km",
				tt.id, tt.stage, math.floor(tt.age / 60), math.floor(tt.age % 60), tt.vc, tt.rc, tt.swirl, tt.peakWind or 0, (tt.peakWind or 0) * 2.237,
				math.max(0, tt.ef or -1), math.max(0, tt.peakEf or -1), math.sqrt(tt.ut ^ 2 + tt.vt ^ 2), tt.cloudBase,
				if (tt.funnelGround or 0) > 0.5 then string.format("%.0f m", tt.funnelGround) else "no (dust whirl)", tt.debrisLoft or 0, tt.debrisTop or 0, (tt.pathLength or 0) / 1000)
		else
			tornadoText.Text = "none"
		end
		-- the engine's own track at this minute
		local data = ctx.scenarioData
		if data and data.track then
			local m = math.floor(ctx:simTime() / 60)
			local best = nil
			for _, p in data.track do
				if p.min <= m then
					best = p
				end
			end
			if best then
				engineText.Text = string.format("t+%d min: focus storm intensity %.2f · meso %.2f · low rotation %.2f%s",
					best.min, best.intensity, best.meso, best.lowRotation, if best.tornado then string.format(" · <b>tornado %d mph</b>", best.tornado.mph) else "")
			end
		end
	end

	local _ = Players
	return self
end

return Panel
