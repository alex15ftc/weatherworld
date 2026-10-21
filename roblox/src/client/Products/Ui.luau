--!strict
-- Plain building blocks for the product screens' side panels (functional first; the look can
-- be redone later in one place).

local TextService = game:GetService("TextService")

local Ui = {}

Ui.TEXT = Color3.fromRGB(226, 232, 240)
Ui.MUTED = Color3.fromRGB(148, 160, 178)
Ui.PANEL = Color3.fromRGB(28, 34, 44)
Ui.ACCENT = Color3.fromRGB(37, 99, 235)

function Ui.rgb(c: { number }): Color3
	return Color3.fromRGB(c[1], c[2], c[3])
end

-- A column that lays its children out top to bottom, in creation order, and scrolls.
function Ui.column(parent: Instance): ScrollingFrame
	local frame = Instance.new("ScrollingFrame")
	frame.Size = UDim2.fromScale(1, 1)
	frame.BackgroundTransparency = 1
	frame.BorderSizePixel = 0
	frame.ScrollBarThickness = 6
	frame.CanvasSize = UDim2.new()
	frame.AutomaticCanvasSize = Enum.AutomaticSize.Y
	frame.ScrollingDirection = Enum.ScrollingDirection.Y
	local layout = Instance.new("UIListLayout")
	layout.SortOrder = Enum.SortOrder.LayoutOrder
	layout.Padding = UDim.new(0, 8)
	layout.Parent = frame
	local pad = Instance.new("UIPadding")
	pad.PaddingLeft, pad.PaddingRight, pad.PaddingTop, pad.PaddingBottom = UDim.new(0, 4), UDim.new(0, 12), UDim.new(0, 4), UDim.new(0, 12)
	pad.Parent = frame
	frame.Parent = parent
	return frame
end

local order = 0
local function nextOrder(): number
	order += 1
	return order
end

-- Wrapped text that grows to fit.
export type TextProps = { size: number?, bold: boolean?, colour: Color3?, mono: boolean? }
function Ui.text(parent: Instance, text: string, props: TextProps?): TextLabel
	local p: TextProps = props or {}
	local label = Instance.new("TextLabel")
	label.LayoutOrder = nextOrder()
	label.BackgroundTransparency = 1
	label.Size = UDim2.new(1, 0, 0, 0)
	label.AutomaticSize = Enum.AutomaticSize.Y
	label.TextWrapped = true
	label.TextXAlignment = Enum.TextXAlignment.Left
	label.TextYAlignment = Enum.TextYAlignment.Top
	label.Font = if p.mono then Enum.Font.Code elseif p.bold then Enum.Font.GothamBold else Enum.Font.Gotham
	label.TextSize = p.size or 14
	label.TextColor3 = p.colour or Ui.TEXT
	label.Text = text
	label.Parent = parent
	return label
end

-- Long wrapped text (a product's text). Its height is measured and set, rather than left to
-- AutomaticSize, which comes out short for long wrapped text in a column and lets what follows
-- overlap it.
function Ui.longText(parent: Instance, text: string, props: TextProps?): TextLabel
	local label = Ui.text(parent, text, props)
	label.AutomaticSize = Enum.AutomaticSize.None
	local function fit()
		local width = label.AbsoluteSize.X
		if width <= 0 then
			return
		end
		local bounds = TextService:GetTextSize(label.Text, label.TextSize, label.Font, Vector2.new(width, 1e6))
		label.Size = UDim2.new(1, 0, 0, bounds.Y + 6)
	end
	label:GetPropertyChangedSignal("AbsoluteSize"):Connect(fit)
	label:GetPropertyChangedSignal("Text"):Connect(fit)
	task.defer(fit)
	return label
end

-- A row of buttons that wrap; pressed(key) is called on a click.
function Ui.buttons(parent: Instance, height: number): Frame
	local row = Instance.new("Frame")
	row.LayoutOrder = nextOrder()
	row.BackgroundTransparency = 1
	row.Size = UDim2.new(1, 0, 0, 0)
	row.AutomaticSize = Enum.AutomaticSize.Y
	local grid = Instance.new("UIGridLayout")
	grid.CellSize = UDim2.new(0.5, -4, 0, height)
	grid.CellPadding = UDim2.fromOffset(6, 6)
	grid.SortOrder = Enum.SortOrder.LayoutOrder
	grid.Parent = row
	row.Parent = parent
	return row
end

function Ui.button(parent: Instance, text: string, onClick: () -> ()): TextButton
	local button = Instance.new("TextButton")
	button.LayoutOrder = nextOrder()
	button.BackgroundColor3 = Ui.PANEL
	button.AutoButtonColor = true
	button.Font = Enum.Font.GothamBold
	button.TextSize = 14
	button.TextColor3 = Ui.TEXT
	button.Text = text
	button:SetAttribute("TestId", text) -- for automated play tests (romcp activate)
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, 6)
	corner.Parent = button
	button.Activated:Connect(onClick)
	button.Parent = parent
	return button
end

function Ui.setOn(button: TextButton, on: boolean)
	button.BackgroundColor3 = if on then Ui.ACCENT else Ui.PANEL
end

-- A legend line: a colour swatch (or none), the name and, to the right, what it means.
function Ui.legendRow(parent: Instance, swatch: Color3?, name: string, meaning: string): Frame
	local row = Instance.new("Frame")
	row.LayoutOrder = nextOrder()
	row.BackgroundTransparency = 1
	row.Size = UDim2.new(1, 0, 0, 18)
	if swatch then
		local box = Instance.new("Frame")
		box.Size = UDim2.fromOffset(22, 13)
		box.Position = UDim2.fromOffset(0, 2)
		box.BackgroundColor3 = swatch
		box.BorderSizePixel = 0
		box.Parent = row
	end
	local left = Instance.new("TextLabel")
	left.BackgroundTransparency = 1
	left.Position = UDim2.fromOffset(if swatch then 30 else 0, 0)
	left.Size = UDim2.new(0.45, 0, 1, 0)
	left.Font = Enum.Font.GothamBold
	left.TextSize = 13
	left.TextColor3 = Ui.TEXT
	left.TextXAlignment = Enum.TextXAlignment.Left
	left.Text = name
	left.Parent = row
	local right = left:Clone()
	right.Position = UDim2.new(0.45, 0, 0, 0)
	right.Size = UDim2.new(0.55, 0, 1, 0)
	right.Font = Enum.Font.Gotham
	right.TextColor3 = Ui.MUTED
	right.TextXAlignment = Enum.TextXAlignment.Right
	right.TextTruncate = Enum.TextTruncate.AtEnd
	right.Text = meaning
	right.Parent = row
	row.Parent = parent
	return row
end

-- A full-width list entry: a colour mark, the text, and onClick on a press.
function Ui.listButton(parent: Instance, text: string, mark: Color3?, onClick: () -> ()): TextButton
	local button = Instance.new("TextButton")
	button.LayoutOrder = nextOrder()
	button.BackgroundColor3 = Ui.PANEL
	button.AutoButtonColor = true
	button.Size = UDim2.new(1, 0, 0, 26)
	button.Font = Enum.Font.Gotham
	button.TextSize = 13
	button.TextColor3 = Ui.TEXT
	button.TextXAlignment = Enum.TextXAlignment.Left
	button.TextTruncate = Enum.TextTruncate.AtEnd
	button.Text = text
	button:SetAttribute("TestId", text)
	local pad = Instance.new("UIPadding")
	pad.PaddingLeft = UDim.new(0, if mark then 20 else 8)
	pad.PaddingRight = UDim.new(0, 6)
	pad.Parent = button
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, 5)
	corner.Parent = button
	if mark then
		local box = Instance.new("Frame")
		box.Size = UDim2.fromOffset(8, 14)
		box.Position = UDim2.new(0, -14, 0.5, -7)
		box.BackgroundColor3 = mark
		box.BorderSizePixel = 0
		box.Parent = button
	end
	button.Activated:Connect(onClick)
	button.Parent = parent
	return button
end

-- Removes what a panel section holds (for redrawing it).
function Ui.clear(parent: Instance)
	for _, child in parent:GetChildren() do
		if child:IsA("GuiObject") then
			child:Destroy()
		end
	end
end

-- A sub-column whose height follows its contents (to group rows that are redrawn together).
function Ui.section(parent: Instance): Frame
	local frame = Instance.new("Frame")
	frame.LayoutOrder = nextOrder()
	frame.BackgroundTransparency = 1
	frame.Size = UDim2.new(1, 0, 0, 0)
	frame.AutomaticSize = Enum.AutomaticSize.Y
	local layout = Instance.new("UIListLayout")
	layout.SortOrder = Enum.SortOrder.LayoutOrder
	layout.Padding = UDim.new(0, 4)
	layout.Parent = frame
	frame.Parent = parent
	return frame
end

-- "06Z" from an hour of the world's clock.
function Ui.clock(hour: number): string
	return string.format("%02dZ", math.round(hour) % 24)
end

return Ui
