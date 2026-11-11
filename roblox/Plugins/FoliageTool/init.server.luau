--!nonstrict
-- Foliage tool (Studio plugin): set up and tune the skinned trees' wind (Shared/Foliage,
-- Client/Controllers/FoliageController) without code.
--   Setup      install ReplicatedStorage.FoliageSettings; tag the selection as trees (FoliageTree,
--              with its Kind); validate the selected rigs against their generated data.
--   Wind       the wind's source (the weather engine, or manual), the manual wind's strength and
--              direction, turbulence and gusts; the Calm / Breezy / Storm presets and your own
--              (saved under FoliageSettings.Presets).
--   Profiles   per kind (or Default): bend, sway speed, gusts, flutter, and the soft bend limits.
--   Runtime    distances (sway, fade, mesh, impostor, LOD), the frame budget and batch (with a
--              suggested starting batch), adaptive batching, frustum culling.
--   Preview    sways every tagged tree in the edit viewport with the manual wind.
--   Metrics    while playing: the client's FoliageMetrics (trees by mode, animated, bone updates,
--              loop time, batch, falling parts).
-- Build: rojo build foliagetool.project.json --plugin FoliageTool.rbxm (from roblox/).
local CollectionService = game:GetService("CollectionService")
local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local Selection = game:GetService("Selection")
local ChangeHistoryService = game:GetService("ChangeHistoryService")

local TAG = "FoliageTree"

local function foliage(): Instance?
	local shared = ReplicatedStorage:FindFirstChild("Shared")
	return shared and shared:FindFirstChild("Foliage")
end

local function mod(name: string): any
	local f = foliage()
	local m = f and f:FindFirstChild(name)
	if not m then
		return nil
	end
	local ok, res = pcall(require, m)
	return if ok then res else nil
end

local toolbar = plugin:CreateToolbar("Foliage")
local button = toolbar:CreateButton("Foliage", "Wind, profiles, rigs and metrics for the skinned trees", "rbxassetid://4458901886")
local widget = plugin:CreateDockWidgetPluginGui("FoliageTool", DockWidgetPluginGuiInfo.new(Enum.InitialDockState.Right, false, false, 320, 640, 260, 320))
widget.Title = "Foliage"
button.Click:Connect(function()
	widget.Enabled = not widget.Enabled
end)

----------------------------------------------------------------------------------------------
-- UI helpers

local theme = settings().Studio.Theme
local function col(c: Enum.StudioStyleGuideColor): Color3
	return theme:GetColor(c)
end

local scroll = Instance.new("ScrollingFrame")
scroll.Size = UDim2.fromScale(1, 1)
scroll.BackgroundColor3 = col(Enum.StudioStyleGuideColor.MainBackground)
scroll.BorderSizePixel = 0
scroll.AutomaticCanvasSize = Enum.AutomaticSize.Y
scroll.CanvasSize = UDim2.new()
scroll.ScrollBarThickness = 6
scroll.Parent = widget
local layout = Instance.new("UIListLayout")
layout.Padding = UDim.new(0, 4)
layout.SortOrder = Enum.SortOrder.LayoutOrder
layout.Parent = scroll
local pad = Instance.new("UIPadding")
pad.PaddingLeft, pad.PaddingRight, pad.PaddingTop = UDim.new(0, 8), UDim.new(0, 12), UDim.new(0, 8)
pad.Parent = scroll

local order = 0
local function nextOrder(): number
	order += 1
	return order
end

local function label(text: string, bold: boolean?, height: number?): TextLabel
	local l = Instance.new("TextLabel")
	l.Size = UDim2.new(1, 0, 0, height or 18)
	l.BackgroundTransparency = 1
	l.Text = text
	l.TextXAlignment = Enum.TextXAlignment.Left
	l.TextYAlignment = Enum.TextYAlignment.Top
	l.TextWrapped = true
	l.Font = if bold then Enum.Font.SourceSansBold else Enum.Font.SourceSans
	l.TextSize = if bold then 16 else 14
	l.TextColor3 = col(Enum.StudioStyleGuideColor.MainText)
	l.LayoutOrder = nextOrder()
	l.Parent = scroll
	return l
end

local function row(): Frame
	local f = Instance.new("Frame")
	f.Size = UDim2.new(1, 0, 0, 24)
	f.BackgroundTransparency = 1
	f.LayoutOrder = nextOrder()
	local l = Instance.new("UIListLayout")
	l.FillDirection = Enum.FillDirection.Horizontal
	l.Padding = UDim.new(0, 4)
	l.Parent = f
	f.Parent = scroll
	return f
end

local function btn(parent: Instance, text: string, width: number, onClick: () -> ()): TextButton
	local b = Instance.new("TextButton")
	b.Size = UDim2.new(0, width, 1, 0)
	b.Text = text
	b.Font = Enum.Font.SourceSans
	b.TextSize = 14
	b.AutoButtonColor = true
	b.BackgroundColor3 = col(Enum.StudioStyleGuideColor.Button)
	b.TextColor3 = col(Enum.StudioStyleGuideColor.ButtonText)
	b.BorderColor3 = col(Enum.StudioStyleGuideColor.ButtonBorder)
	b.Parent = parent
	b.MouseButton1Click:Connect(onClick)
	return b
end

-- a numbered field bound to an attribute of a Configuration (got by getCfg when edited)
local fields = {}
local function field(text: string, getCfg: () -> Instance?, attr: string, default: number | boolean | string)
	local r = row()
	local l = Instance.new("TextLabel")
	l.Size = UDim2.new(0.55, 0, 1, 0)
	l.BackgroundTransparency = 1
	l.Text = text
	l.TextXAlignment = Enum.TextXAlignment.Left
	l.Font = Enum.Font.SourceSans
	l.TextSize = 14
	l.TextColor3 = col(Enum.StudioStyleGuideColor.MainText)
	l.Parent = r
	local refresh
	if type(default) == "boolean" then
		local b
		b = btn(r, "", 90, function()
			local cfg = getCfg()
			if not cfg then
				return
			end
			local v = cfg:GetAttribute(attr)
			if v == nil then
				v = default
			end
			ChangeHistoryService:SetWaypoint("Foliage " .. attr)
			cfg:SetAttribute(attr, not v)
			refresh()
		end)
		refresh = function()
			local cfg = getCfg()
			local v = cfg and cfg:GetAttribute(attr)
			if v == nil then
				v = default
			end
			b.Text = if v then "on" else "off"
		end
	else
		local box = Instance.new("TextBox")
		box.Size = UDim2.new(0.4, 0, 1, 0)
		box.ClearTextOnFocus = false
		box.Font = Enum.Font.Code
		box.TextSize = 14
		box.BackgroundColor3 = col(Enum.StudioStyleGuideColor.InputFieldBackground)
		box.TextColor3 = col(Enum.StudioStyleGuideColor.MainText)
		box.BorderColor3 = col(Enum.StudioStyleGuideColor.InputFieldBorder)
		box.Parent = r
		refresh = function()
			local cfg = getCfg()
			local v = cfg and cfg:GetAttribute(attr)
			box.Text = tostring(if v == nil then default else v)
		end
		box.FocusLost:Connect(function()
			local cfg = getCfg()
			if not cfg then
				refresh()
				return
			end
			local v: any = box.Text
			if type(default) == "number" then
				v = tonumber(box.Text)
				if not v then
					refresh()
					return
				end
			end
			ChangeHistoryService:SetWaypoint("Foliage " .. attr)
			cfg:SetAttribute(attr, v)
			refresh()
		end)
	end
	table.insert(fields, refresh)
	refresh()
end

local function refreshAll()
	for _, f in fields do
		f()
	end
end

----------------------------------------------------------------------------------------------
-- Settings

local function settingsCfg(create: boolean?): Configuration?
	local cfg = ReplicatedStorage:FindFirstChild("FoliageSettings")
	if not cfg and create then
		cfg = Instance.new("Configuration")
		cfg.Name = "FoliageSettings"
		cfg.Parent = ReplicatedStorage
	end
	return cfg
end

local profileName = "Default"
local function profileCfg(): Instance?
	local cfg = settingsCfg()
	if not cfg then
		return nil
	end
	local p = cfg:FindFirstChild(profileName)
	if not p then
		p = Instance.new("Configuration")
		p.Name = profileName
		p.Parent = cfg
	end
	return p
end

local Profiles = mod("Profiles")

label("Foliage", true, 22)
label("Skinned, wind-driven trees: settings live on ReplicatedStorage.FoliageSettings.", false, 32)

-- Setup
label("Setup", true)
do
	local r = row()
	btn(r, "Install settings", 110, function()
		ChangeHistoryService:SetWaypoint("Foliage install")
		local cfg = settingsCfg(true) :: Configuration
		if Profiles then
			for k, v in Profiles.SETTINGS do
				if cfg:GetAttribute(k) == nil then
					cfg:SetAttribute(k, v)
				end
			end
		end
		if not cfg:FindFirstChild("Presets") then
			local f = Instance.new("Folder")
			f.Name = "Presets"
			f.Parent = cfg
		end
		refreshAll()
	end)
	btn(r, "Tag selection", 100, function()
		ChangeHistoryService:SetWaypoint("Foliage tag")
		for _, inst in Selection:Get() do
			if inst:IsA("Model") then
				CollectionService:AddTag(inst, TAG)
				if inst:GetAttribute("Kind") == nil then
					inst:SetAttribute("Kind", inst.Name)
				end
			end
		end
	end)
end
local report = label("", false, 18)
report.AutomaticSize = Enum.AutomaticSize.Y
do
	local r = row()
	btn(r, "Validate selected rigs", 150, function()
		local Rig = mod("Rig")
		local lines = {}
		for _, inst in Selection:Get() do
			local kind = inst:GetAttribute("Kind") or inst.Name
			local tree = inst:FindFirstChild("Tree", true)
			if not (tree and tree:IsA("MeshPart")) then
				table.insert(lines, `{inst.Name}: no skinned MeshPart "Tree"`)
				continue
			end
			local ok, rig = pcall(function()
				return Rig.get(kind)
			end)
			if not ok then
				table.insert(lines, `{inst.Name}: no generated tree "{kind}" (set the Kind attribute)`)
				continue
			end
			local missing, pieces = {}, 0
			for i = 1, rig.n do
				if not inst:FindFirstChild(rig.names[i], true) then
					table.insert(missing, rig.names[i])
				end
				if inst:FindFirstChild("Piece_" .. rig.names[i], true) then
					pieces += 1
				end
			end
			local msg = `{inst.Name} ({kind}): {rig.n} bones, {#missing} missing, {pieces} pieces`
			if #missing > 0 then
				msg ..= " - missing " .. table.concat(missing, ", ", 1, math.min(#missing, 6))
			else
				-- the rig's axes against the data's: the second trunk bone's place from the foot
				local b1, b2 = inst:FindFirstChild(rig.names[1], true), inst:FindFirstChild(rig.names[2], true)
				if b1 and b2 and rig.parent[2] == 1 then
					local K = 1 / 0.28
					local got = CFrame.new(b1.WorldPosition):PointToObjectSpace(b2.WorldPosition) / K
					local want = Vector3.new(rig.hx[2], rig.hy[2], rig.hz[2])
					local off = (got - want).Magnitude
					msg ..= string.format(", axes %s (%.2f m off)", if off < 0.05 * rig.length[1] + 0.05 then "match" else "DIFFER", off)
				end
			end
			table.insert(lines, msg)
		end
		report.Text = if #lines == 0 then "Select tree models first." else table.concat(lines, "\n")
	end)
end

-- Wind
label("Wind", true)
field("Source (weather/manual)", function() return settingsCfg(true) end, "source", "weather")
field("Wind (m/s at 10 m)", function() return settingsCfg(true) end, "manualWind", 8)
field("Toward (deg, 0 = north)", function() return settingsCfg(true) end, "manualDirection", 90)
do
	local r = row()
	if Profiles then
		for name, p in Profiles.PRESETS do
			btn(r, name, 70, function()
				ChangeHistoryService:SetWaypoint("Foliage preset")
				local cfg = settingsCfg(true) :: Configuration
				cfg:SetAttribute("manualWind", p.wind)
				cfg:SetAttribute("manualDirection", p.direction)
				local pc = profileCfg()
				if pc then
					pc:SetAttribute("turbulence", p.turbulence)
					pc:SetAttribute("gust", p.gust)
				end
				refreshAll()
			end)
		end
	end
end
local presetName = ""
do
	local r = row()
	local box = Instance.new("TextBox")
	box.Size = UDim2.new(0, 140, 1, 0)
	box.PlaceholderText = "preset name"
	box.Text = ""
	box.Font = Enum.Font.SourceSans
	box.TextSize = 14
	box.BackgroundColor3 = col(Enum.StudioStyleGuideColor.InputFieldBackground)
	box.TextColor3 = col(Enum.StudioStyleGuideColor.MainText)
	box.Parent = r
	box.FocusLost:Connect(function()
		presetName = box.Text
	end)
	btn(r, "Save", 50, function()
		local cfg = settingsCfg(true) :: Configuration
		if presetName == "" then
			return
		end
		ChangeHistoryService:SetWaypoint("Foliage save preset")
		local folder = cfg:FindFirstChild("Presets") or Instance.new("Folder")
		folder.Name = "Presets"
		folder.Parent = cfg
		local p = folder:FindFirstChild(presetName) or Instance.new("Configuration")
		p.Name = presetName
		p:SetAttribute("wind", cfg:GetAttribute("manualWind") or 8)
		p:SetAttribute("direction", cfg:GetAttribute("manualDirection") or 90)
		local pc = profileCfg()
		for _, k in { "bend", "speed", "gust", "turbulence", "flutter", "limitTrunk", "limitLimb", "limitTwig" } do
			p:SetAttribute(k, pc and pc:GetAttribute(k))
		end
		p.Parent = folder
	end)
	btn(r, "Load", 50, function()
		local cfg = settingsCfg()
		local p = cfg and cfg:FindFirstChild("Presets") and cfg.Presets:FindFirstChild(presetName)
		if not p then
			return
		end
		ChangeHistoryService:SetWaypoint("Foliage load preset")
		cfg:SetAttribute("manualWind", p:GetAttribute("wind"))
		cfg:SetAttribute("manualDirection", p:GetAttribute("direction"))
		local pc = profileCfg()
		if pc then
			for _, k in { "bend", "speed", "gust", "turbulence", "flutter", "limitTrunk", "limitLimb", "limitTwig" } do
				pc:SetAttribute(k, p:GetAttribute(k))
			end
		end
		refreshAll()
	end)
end

-- Profiles
label("Profile", true)
do
	local r = row()
	local names = { "Default", "hardwood", "cottonwood", "yard", "cedar" }
	local current = label("Editing: Default", false)
	for _, n in names do
		btn(r, n, 58, function()
			profileName = n
			current.Text = "Editing: " .. n
			refreshAll()
		end)
	end
end
local D = if Profiles then Profiles.DEFAULT else { bend = 1, speed = 1, gust = 1, turbulence = 0.25, flutter = 1, bendLimit = { 6, 18, 30 } }
field("Bend x", profileCfg, "bend", D.bend)
field("Sway speed x", profileCfg, "speed", D.speed)
field("Gusts x", profileCfg, "gust", D.gust)
field("Turbulence", profileCfg, "turbulence", D.turbulence)
field("Flutter x", profileCfg, "flutter", D.flutter)
field("Limit trunk (deg)", profileCfg, "limitTrunk", D.bendLimit[1])
field("Limit limbs (deg)", profileCfg, "limitLimb", D.bendLimit[2])
field("Limit twigs (deg)", profileCfg, "limitTwig", D.bendLimit[3])

-- Runtime
label("Runtime", true)
local SD = if Profiles then Profiles.SETTINGS else {}
for _, k in { "animDistance", "fadeDistance", "meshDistance", "impostorDistance", "lodLimbs", "lodTrunk", "cell", "budgetMs", "batch", "frustumMargin" } do
	field(k, function() return settingsCfg(true) end, k, SD[k] or 0)
end
field("adaptive batching", function() return settingsCfg(true) end, "adaptive", true)
field("frustum culling", function() return settingsCfg(true) end, "frustum", true)
do
	local r = row()
	local hint = label("", false)
	btn(r, "Suggest batch", 110, function()
		-- the budget over a tree's measured cost (from the last play's metrics), else ~25 us a tree
		local cfg = settingsCfg(true) :: Configuration
		local per = 0.025
		local lp = Players.LocalPlayer
		local m = lp and lp:GetAttribute("FoliageMetrics")
		if type(m) == "string" then
			local ok, t = pcall(HttpService.JSONDecode, HttpService, m)
			if ok and t.batch and t.batch > 0 and t.loopMs > 0 then
				per = t.loopMs / t.batch
			end
		end
		local budget = cfg:GetAttribute("budgetMs") or 0.8
		local n = math.clamp(math.floor(budget / per), 4, 200)
		ChangeHistoryService:SetWaypoint("Foliage batch")
		cfg:SetAttribute("batch", n)
		hint.Text = string.format("suggested batch %d (%.3f ms a tree)", n, per)
		refreshAll()
	end)
end

-- Preview
label("Preview", true)
local previewing = false
local previewConn: RBXScriptConnection? = nil
local previewTrees = {}
local function stopPreview()
	if previewConn then
		previewConn:Disconnect()
		previewConn = nil
	end
	for _, t in previewTrees do
		for _, b in t.bones do
			b.Transform = CFrame.identity
		end
	end
	previewTrees = {}
end
local function startPreview()
	local Rig, Sway = mod("Rig"), mod("Sway")
	if not (Rig and Sway and Profiles) then
		warn("[Foliage] Shared.Foliage not found: sync the place first")
		return
	end
	for _, inst in CollectionService:GetTagged(TAG) do
		local tree = inst:FindFirstChild("Tree", true)
		local ok, rig = pcall(Rig.get, inst:GetAttribute("Kind") or inst.Name)
		if ok and tree then
			local bones, rot = {}, {}
			local good = true
			for i = 1, rig.n do
				local b = inst:FindFirstChild(rig.names[i], true)
				if not b then
					good = false
					break
				end
				bones[i] = b
			end
			if good then
				local foot = CFrame.new(bones[1].WorldPosition)
				for i = 1, rig.n do
					rot[i] = foot:ToObjectSpace(bones[i].WorldCFrame).Rotation
				end
				local look = tree.CFrame.LookVector
				table.insert(previewTrees, { rig = rig, bones = bones, rot = rot, out = Sway.newOut(rig.n), yaw = math.atan2(-look.X, -look.Z), pos = bones[1].WorldPosition })
			end
		end
	end
	local t0 = os.clock()
	previewConn = RunService.Heartbeat:Connect(function()
		local cfg = settingsCfg()
		local U = cfg and cfg:GetAttribute("manualWind") or 8
		local dir = math.rad(cfg and cfg:GetAttribute("manualDirection") or 90)
		local dx, dz = math.sin(dir), -math.cos(dir)
		local t = os.clock() - t0
		for _, tr in previewTrees do
			local c, s = math.cos(tr.yaw), math.sin(tr.yaw)
			local lx, lz = dx * c - dz * s, dx * s + dz * c
			local p = Profiles.read(cfg and (cfg:FindFirstChild(tr.rig.kind) or cfg:FindFirstChild("Default")), Profiles.KINDS[tr.rig.kind] or Profiles.DEFAULT)
			local out = Sway.pose(tr.rig, U, lx, lz, t, tr.pos.X * 0.28, tr.pos.Z * 0.28, 1, nil, 2, p, tr.out)
			for i, b in tr.bones do
				local w = Vector3.new(out.x[i], out.y[i], out.z[i])
				local a = w.Magnitude
				b.Transform = if a > 1e-7 then CFrame.fromAxisAngle(tr.rot[i]:VectorToObjectSpace(w / a), a) else CFrame.identity
			end
		end
	end)
end
do
	local r = row()
	local b
	b = btn(r, "Preview wind: off", 140, function()
		previewing = not previewing
		b.Text = "Preview wind: " .. (if previewing then "on" else "off")
		if previewing then
			startPreview()
		else
			stopPreview()
		end
	end)
end

-- Metrics
label("Metrics (while playing)", true)
local metricsLabel = label("-", false, 120)
task.spawn(function()
	while true do
		task.wait(1)
		local lp = Players.LocalPlayer
		local m = lp and lp:GetAttribute("FoliageMetrics")
		if type(m) == "string" then
			local ok, t = pcall(HttpService.JSONDecode, HttpService, m)
			if ok then
				metricsLabel.Text = string.format(
					"trees %d: mesh %d, impostor %d, broken %d\nanimated %d, batch %d\nbone updates/frame %.0f\nwind loop %.2f ms (peak %.2f)\nfalling parts %d",
					t.trees or 0, t.mesh or 0, t.impostor or 0, t.pieces or 0, t.animated or 0, t.batch or 0, t.bonesUpdated or 0, t.loopMs or 0, t.loopMaxMs or 0, t.falling or 0)
			end
		end
	end
end)

plugin.Unloading:Connect(stopPreview)
