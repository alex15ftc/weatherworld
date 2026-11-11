--!nonstrict
-- A generic live-tuning panel: hand it a table and it makes a control for every value in it
-- (numbers: slider + box, booleans: toggle, Color3: R G B sliders, strings: text box), nested
-- tables as sub-headings. Edits write straight into the table and call onChange(path).
local UserInputService = game:GetService("UserInputService")

local DebugPanel = {}
DebugPanel.__index = DebugPanel

type RangeFn = (path: string, key: string, value: number) -> (number, number, number)

local ROW = 22
local FONT = Enum.Font.Gotham
local TEXT = Color3.fromRGB(225, 228, 235)
local DIM = Color3.fromRGB(150, 155, 165)

local function decimals(step: number): number
	if step >= 1 then
		return 0
	end
	return math.clamp(math.ceil(-math.log10(step) - 1e-9), 0, 4)
end

local function fmt(v: number, step: number): string
	return string.format("%." .. decimals(step) .. "f", v)
end

local function sortedKeys(t: { [any]: any }): { any }
	local keys = {}
	for k in t do
		table.insert(keys, k)
	end
	table.sort(keys, function(a, b)
		local ta, tb = typeof(a), typeof(b)
		if ta ~= tb then
			return ta == "number"
		end
		return a < b
	end)
	return keys
end

function DebugPanel.new(parent: Instance)
	local gui = Instance.new("ScreenGui")
	gui.Name = "TornadoLabPanel"
	gui.ResetOnSpawn = false
	gui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
	gui.Parent = parent

	local frame = Instance.new("Frame")
	frame.AnchorPoint = Vector2.new(1, 0)
	frame.Position = UDim2.new(1, -8, 0, 8)
	frame.Size = UDim2.new(0, 340, 1, -16)
	frame.BackgroundColor3 = Color3.fromRGB(18, 20, 24)
	frame.BackgroundTransparency = 0.15
	frame.BorderSizePixel = 0
	frame.Parent = gui
	local constraint = Instance.new("UISizeConstraint")
	constraint.MaxSize = Vector2.new(340, math.huge)
	constraint.Parent = frame

	local stats = Instance.new("TextLabel")
	stats.BackgroundTransparency = 1
	stats.Position = UDim2.new(0, 8, 0, 4)
	stats.Size = UDim2.new(1, -16, 0, 50)
	stats.Font = FONT
	stats.TextSize = 12
	stats.TextColor3 = DIM
	stats.TextXAlignment = Enum.TextXAlignment.Left
	stats.TextYAlignment = Enum.TextYAlignment.Top
	stats.TextWrapped = true
	stats.Text = ""
	stats.Parent = frame

	local scroll = Instance.new("ScrollingFrame")
	scroll.Position = UDim2.new(0, 4, 0, 56)
	scroll.Size = UDim2.new(1, -8, 1, -60)
	scroll.BackgroundTransparency = 1
	scroll.BorderSizePixel = 0
	scroll.CanvasSize = UDim2.new()
	scroll.AutomaticCanvasSize = Enum.AutomaticSize.Y
	scroll.ScrollBarThickness = 6
	scroll.Parent = frame
	local list = Instance.new("UIListLayout")
	list.SortOrder = Enum.SortOrder.LayoutOrder
	list.Padding = UDim.new(0, 2)
	list.Parent = scroll

	local self = setmetatable({
		gui = gui,
		scroll = scroll,
		statsLabel = stats,
		order = 0,
		refreshers = {} :: { () -> () },
		drag = nil :: ((x: number) -> ())?,
	}, DebugPanel)

	UserInputService.InputChanged:Connect(function(input)
		local drag = self.drag
		if drag and (input.UserInputType == Enum.UserInputType.MouseMovement or input.UserInputType == Enum.UserInputType.Touch) then
			drag(input.Position.X)
		end
	end)
	UserInputService.InputEnded:Connect(function(input)
		if input.UserInputType == Enum.UserInputType.MouseButton1 or input.UserInputType == Enum.UserInputType.Touch then
			self.drag = nil
			scroll.ScrollingEnabled = true
		end
	end)
	return self
end

function DebugPanel:_next(): number
	self.order += 1
	return self.order
end

function DebugPanel:setStats(text: string)
	self.statsLabel.Text = text
end

function DebugPanel:refresh()
	for _, f in self.refreshers do
		f()
	end
end

-- A collapsible section; returns its body frame.
function DebugPanel:section(title: string, open: boolean?, parent: Instance?): Frame
	local holder = parent or self.scroll
	local header = Instance.new("TextButton")
	header.LayoutOrder = self:_next()
	header.Size = UDim2.new(1, -8, 0, ROW + 2)
	header.BackgroundColor3 = Color3.fromRGB(40, 44, 52)
	header.BorderSizePixel = 0
	header.Font = Enum.Font.GothamBold
	header.TextSize = 13
	header.TextColor3 = TEXT
	header.TextXAlignment = Enum.TextXAlignment.Left
	header.AutoButtonColor = true
	header.Parent = holder
	local pad = Instance.new("UIPadding")
	pad.PaddingLeft = UDim.new(0, 6)
	pad.Parent = header

	local body = Instance.new("Frame")
	body.LayoutOrder = self:_next()
	body.Size = UDim2.new(1, -8, 0, 0)
	body.AutomaticSize = Enum.AutomaticSize.Y
	body.BackgroundTransparency = 1
	body.Visible = open == true
	body.Parent = holder
	local layout = Instance.new("UIListLayout")
	layout.SortOrder = Enum.SortOrder.LayoutOrder
	layout.Padding = UDim.new(0, 1)
	layout.Parent = body
	local bpad = Instance.new("UIPadding")
	bpad.PaddingLeft = UDim.new(0, 6)
	bpad.Parent = body

	local function label()
		header.Text = (if body.Visible then "▾  " else "▸  ") .. title
	end
	label()
	header.Activated:Connect(function()
		body.Visible = not body.Visible
		label()
	end)
	return body
end

function DebugPanel:buttons(parent: Instance, items: { { text: string, fn: () -> () } })
	local row = Instance.new("Frame")
	row.LayoutOrder = self:_next()
	row.Size = UDim2.new(1, -8, 0, ROW + 4)
	row.BackgroundTransparency = 1
	row.Parent = parent
	local layout = Instance.new("UIListLayout")
	layout.FillDirection = Enum.FillDirection.Horizontal
	layout.Padding = UDim.new(0, 4)
	layout.Parent = row
	local w = 1 / #items
	for _, item in items do
		local b = Instance.new("TextButton")
		b.Size = UDim2.new(w, -4, 1, 0)
		b.BackgroundColor3 = Color3.fromRGB(58, 64, 76)
		b.BorderSizePixel = 0
		b.Font = FONT
		b.TextSize = 12
		b.TextColor3 = TEXT
		b.Text = item.text
		b.TextScaled = false
		b.TextTruncate = Enum.TextTruncate.AtEnd
		b.Parent = row
		b.Activated:Connect(item.fn)
	end
	return row
end

local function rowFrame(self: any, parent: Instance, name: string): (Frame, TextLabel)
	local row = Instance.new("Frame")
	row.LayoutOrder = self:_next()
	row.Size = UDim2.new(1, 0, 0, ROW)
	row.BackgroundTransparency = 1
	row.Parent = parent
	local lab = Instance.new("TextLabel")
	lab.BackgroundTransparency = 1
	lab.Size = UDim2.new(0.42, -4, 1, 0)
	lab.Font = FONT
	lab.TextSize = 12
	lab.TextColor3 = TEXT
	lab.TextXAlignment = Enum.TextXAlignment.Left
	lab.TextTruncate = Enum.TextTruncate.AtEnd
	lab.Text = name
	lab.Parent = row
	return row, lab
end

local function textBox(row: Frame, x: number, w: number): TextBox
	local box = Instance.new("TextBox")
	box.Position = UDim2.new(x, 0, 0, 2)
	box.Size = UDim2.new(w, -2, 1, -4)
	box.BackgroundColor3 = Color3.fromRGB(32, 35, 42)
	box.BorderSizePixel = 0
	box.Font = Enum.Font.Code
	box.TextSize = 12
	box.TextColor3 = TEXT
	box.ClearTextOnFocus = false
	box.Parent = row
	return box
end

-- A number slider bound to get/set.
function DebugPanel:slider(parent: Instance, name: string, lo: number, hi: number, step: number, get: () -> number, set: (number) -> ())
	local row = rowFrame(self, parent, name)
	local bar = Instance.new("Frame")
	bar.AnchorPoint = Vector2.new(0, 0.5)
	bar.Position = UDim2.new(0.42, 0, 0.5, 0)
	bar.Size = UDim2.new(0.38, -6, 0, 6)
	bar.BackgroundColor3 = Color3.fromRGB(45, 49, 58)
	bar.BorderSizePixel = 0
	bar.Parent = row
	local fill = Instance.new("Frame")
	fill.BackgroundColor3 = Color3.fromRGB(110, 160, 230)
	fill.BorderSizePixel = 0
	fill.Parent = bar
	local hit = Instance.new("TextButton")
	hit.BackgroundTransparency = 1
	hit.Text = ""
	hit.Position = UDim2.new(0.42, 0, 0, 0)
	hit.Size = UDim2.new(0.38, -6, 1, 0)
	hit.Parent = row
	local box = textBox(row, 0.8, 0.2)

	local function show()
		local v = get()
		fill.Size = UDim2.new(math.clamp((v - lo) / (hi - lo), 0, 1), 0, 1, 0)
		if not box:IsFocused() then
			box.Text = fmt(v, step)
		end
	end
	local function fromX(x: number)
		local f = math.clamp((x - bar.AbsolutePosition.X) / math.max(bar.AbsoluteSize.X, 1), 0, 1)
		local v = lo + f * (hi - lo)
		v = math.floor(v / step + 0.5) * step
		set(v)
		show()
	end
	hit.InputBegan:Connect(function(input)
		if input.UserInputType == Enum.UserInputType.MouseButton1 or input.UserInputType == Enum.UserInputType.Touch then
			self.drag = fromX
			self.scroll.ScrollingEnabled = false
			fromX(input.Position.X)
		end
	end)
	box.FocusLost:Connect(function()
		local v = tonumber(box.Text)
		if v then
			set(v)
		end
		show()
	end)
	show()
	table.insert(self.refreshers, show)
end

function DebugPanel:toggle(parent: Instance, name: string, get: () -> boolean, set: (boolean) -> ())
	local row = rowFrame(self, parent, name)
	local b = Instance.new("TextButton")
	b.Position = UDim2.new(0.42, 0, 0, 2)
	b.Size = UDim2.new(0.25, 0, 1, -4)
	b.BorderSizePixel = 0
	b.Font = FONT
	b.TextSize = 12
	b.TextColor3 = TEXT
	b.Parent = row
	local function show()
		local on = get()
		b.Text = if on then "on" else "off"
		b.BackgroundColor3 = if on then Color3.fromRGB(60, 110, 70) else Color3.fromRGB(70, 50, 50)
	end
	b.Activated:Connect(function()
		set(not get())
		show()
	end)
	show()
	table.insert(self.refreshers, show)
end

function DebugPanel:text(parent: Instance, name: string, get: () -> string, set: (string) -> ())
	local row = rowFrame(self, parent, name)
	local box = textBox(row, 0.42, 0.58)
	box.TextXAlignment = Enum.TextXAlignment.Left
	box.TextTruncate = Enum.TextTruncate.AtEnd
	local function show()
		if not box:IsFocused() then
			box.Text = get()
		end
	end
	box.FocusLost:Connect(function()
		set(box.Text)
		show()
	end)
	show()
	table.insert(self.refreshers, show)
end

function DebugPanel:color(parent: Instance, name: string, get: () -> Color3, set: (Color3) -> ())
	local _, lab = rowFrame(self, parent, name)
	local swatch = Instance.new("Frame")
	swatch.AnchorPoint = Vector2.new(1, 0.5)
	swatch.Position = UDim2.new(1, -2, 0.5, 0)
	swatch.Size = UDim2.new(0, 14, 0, 14)
	swatch.BorderSizePixel = 0
	swatch.Parent = lab
	local function show()
		swatch.BackgroundColor3 = get()
	end
	table.insert(self.refreshers, show)
	show()
	for _, ch in { "R", "G", "B" } do
		self:slider(parent, "   " .. ch, 0, 255, 1, function()
			local c = get()
			return math.floor(((c :: any)[ch] :: number) * 255 + 0.5)
		end, function(v)
			local c = get()
			local r, g, b = c.R * 255, c.G * 255, c.B * 255
			if ch == "R" then
				r = v
			elseif ch == "G" then
				g = v
			else
				b = v
			end
			set(Color3.fromRGB(math.clamp(r, 0, 255), math.clamp(g, 0, 255), math.clamp(b, 0, 255)))
			show()
		end)
	end
end

-- Controls for every value in `tbl` (recursing into nested tables).
function DebugPanel:bind(parent: Instance, tbl: { [any]: any }, prefix: string, range: RangeFn, onChange: (path: string) -> ())
	for _, key in sortedKeys(tbl) do
		if key == "RANGES" or key == "CAMERA_PRESETS" then
			continue
		end
		local value = tbl[key]
		local path = if prefix == "" then tostring(key) else prefix .. "." .. tostring(key)
		local name = tostring(key)
		local kind = typeof(value)
		if kind == "number" then
			local lo, hi, step = range(path, name, value)
			self:slider(parent, name, lo, hi, step, function()
				return tbl[key]
			end, function(v)
				tbl[key] = v
				onChange(path)
			end)
		elseif kind == "boolean" then
			self:toggle(parent, name, function()
				return tbl[key]
			end, function(v)
				tbl[key] = v
				onChange(path)
			end)
		elseif kind == "Color3" then
			self:color(parent, name, function()
				return tbl[key]
			end, function(c)
				tbl[key] = c
				onChange(path)
			end)
		elseif kind == "string" then
			self:text(parent, name, function()
				return tbl[key]
			end, function(s)
				tbl[key] = s
				onChange(path)
			end)
		elseif kind == "table" then
			local title = if typeof(value.name) == "string" then value.name else name
			local body = self:section(title, false, parent)
			self:bind(body, value, path, range, onChange)
		end
	end
end

-- Default slider range for a value with no entry in a RANGES table.
function DebugPanel.guessRange(value: number): (number, number, number)
	if value == 0 then
		return 0, 1, 0.01
	end
	local mag = math.abs(value)
	local step = if value == math.floor(value) and mag >= 2 then 1 else 10 ^ math.floor(math.log10(mag) - 2)
	if value < 0 then
		return value * 3, -value * 3, step
	end
	return 0, value * 3, step
end

return DebugPanel
