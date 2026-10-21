--!strict
-- The weather screen, opened and closed with M (docs/ROBLOX-UI-PLAN.md): the world map with the
-- products the weather server issues as layers over it, each turned on or off with its button
-- in the side panel: the convective outlook, one radar, the watches, the mesoscale discussions
-- and the warnings. A click on the map opens the details of what is there (a warning first,
-- then a watch, a discussion, the outlook); a click on a radar's label picks that radar.
-- Scroll or +/− to zoom, drag to pan, C to centre on yourself.

local Players = game:GetService("Players")
local UserInputService = game:GetService("UserInputService")
local RunService = game:GetService("RunService")

local MapCanvas = require(script.MapCanvas)
local ProductClient = require(script.ProductClient)
local Ui = require(script.Ui)
local Layer = require(script.Layer)
local Outlook = require(script.Layers.Outlook)
local Radar = require(script.Layers.Radar)
local Areas = require(script.Layers.Areas)

local Products = {}

local SIDE_WIDTH = 400

local player = Players.LocalPlayer
local gui: ScreenGui? = nil
local layers: { Layer.Layer } = {}
local drawOrder: { Layer.Layer } = {} -- bottom to top
local hitOrder: { Layer.Layer } = {} -- what a click finds first
local detail: Layer.Detail? = nil
local detailBox: Frame
local legendBox: Frame
local layerButtons: { [string]: TextButton } = {}
local headings: { [string]: TextLabel } = {}

local function isOn(key: string): boolean
	for _, layer in layers do
		if layer.key == key then
			return layer.enabled
		end
	end
	return false
end

local function compose(): MapCanvas.Overlay?
	local any = false
	for _, layer in layers do
		any = any or layer.enabled
	end
	if not any then
		return nil -- the plain world map
	end
	return {
		muted = true,
		draw = function(draw: MapCanvas.Draw)
			for _, layer in drawOrder do
				if layer.enabled then
					layer:draw(draw)
				end
			end
		end,
		-- The top layers' labels first: they win the room.
		labels = function(labels: MapCanvas.Labels)
			for k = #drawOrder, 1, -1 do
				local layer = drawOrder[k]
				if layer.enabled then
					layer:labels(labels)
				end
			end
		end,
	}
end

local function renderLegend()
	Ui.clear(legendBox)
	for _, layer in layers do
		if layer.enabled then
			layer:legend(legendBox)
		end
	end
end

local function redraw()
	MapCanvas.setOverlay(compose())
	renderLegend()
end

local function renderDetail()
	Ui.clear(detailBox)
	local open = detail
	detailBox.Visible = open ~= nil
	if not open then
		return
	end
	local title = Ui.text(detailBox, open.title, { size = 17, bold = true })
	if open.colour then
		title.TextColor3 = Ui.rgb(open.colour)
	end
	if open.subtitle then
		Ui.text(detailBox, open.subtitle, { size = 12, colour = Ui.MUTED })
	end
	local row = Ui.buttons(detailBox, 26)
	Ui.button(row, "Close", function()
		detail = nil
		renderDetail()
		redraw()
	end)
	Ui.longText(detailBox, open.body, { size = 13, mono = true })
end

local context: Layer.Context = {
	redraw = function()
		redraw()
	end,
	showDetail = function(d: Layer.Detail)
		detail = d
		renderDetail()
		redraw()
	end,
	selected = function(layerKey: string): string
		local open = detail
		return if open and open.layer == layerKey then open.item else ""
	end,
	isOn = isOn,
}

local function setEnabled(layer: Layer.Layer, on: boolean)
	layer:setEnabled(on)
	layer.options.Visible = on
	headings[layer.key].Visible = on
	Ui.setOn(layerButtons[layer.key], on)
	local open = detail
	if not on and open and open.layer == layer.key then
		detail = nil
		renderDetail()
	end
	redraw()
end

local function build(): ScreenGui
	local screen = Instance.new("ScreenGui")
	screen.Name = "WeatherScreens"
	screen.ResetOnSpawn = false
	-- Below Roblox's own buttons at the top.
	screen.IgnoreGuiInset = false
	screen.ScreenInsets = Enum.ScreenInsets.CoreUISafeInsets
	screen.DisplayOrder = 10
	screen.Enabled = false

	local panel = Instance.new("Frame")
	panel.AnchorPoint = Vector2.new(0.5, 0.5)
	panel.Position = UDim2.fromScale(0.5, 0.5)
	panel.Size = UDim2.new(1, -24, 1, -16)
	panel.BackgroundColor3 = Color3.fromRGB(20, 24, 30)
	panel.Parent = screen
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, 12)
	corner.Parent = panel

	local title = Instance.new("TextLabel")
	title.BackgroundTransparency = 1
	title.Position = UDim2.fromOffset(16, 8)
	title.Size = UDim2.new(0.4, 0, 0, 28)
	title.Font = Enum.Font.GothamBold
	title.TextSize = 20
	title.TextXAlignment = Enum.TextXAlignment.Left
	title.TextColor3 = Color3.fromRGB(236, 240, 245)
	title.Text = "Weather"
	title.Parent = panel
	local hint = title:Clone()
	hint.AnchorPoint = Vector2.new(1, 0)
	hint.Position = UDim2.new(1, -16, 0, 8)
	hint.Size = UDim2.new(0.6, -16, 0, 28)
	hint.Font = Enum.Font.Gotham
	hint.TextSize = 14
	hint.TextXAlignment = Enum.TextXAlignment.Right
	hint.TextColor3 = Color3.fromRGB(150, 160, 175)
	hint.Text = "M close  ·  click an area for details  ·  scroll or +/− zoom  ·  drag pan  ·  C centre on you"
	hint.Parent = panel

	local body = Instance.new("Frame")
	body.BackgroundTransparency = 1
	body.Position = UDim2.fromOffset(12, 44)
	body.Size = UDim2.new(1, -24, 1, -84)
	body.Parent = panel

	local mapHolder = Instance.new("Frame")
	mapHolder.BackgroundTransparency = 1
	mapHolder.Size = UDim2.new(1, -(SIDE_WIDTH + 12), 1, 0)
	mapHolder.Parent = body

	local side = Instance.new("Frame")
	side.BackgroundTransparency = 1
	side.AnchorPoint = Vector2.new(1, 0)
	side.Position = UDim2.fromScale(1, 0)
	side.Size = UDim2.new(0, SIDE_WIDTH, 1, 0)
	side.Parent = body
	local column = Ui.column(side)

	local readout = Instance.new("TextLabel")
	readout.BackgroundTransparency = 1
	readout.Position = UDim2.new(0, 16, 1, -36)
	readout.Size = UDim2.new(1, -32, 0, 28)
	readout.Font = Enum.Font.Gotham
	readout.TextSize = 15
	readout.TextXAlignment = Enum.TextXAlignment.Left
	readout.TextColor3 = Color3.fromRGB(220, 226, 235)
	readout.Parent = panel

	MapCanvas.mount(mapHolder, readout)

	-- The side panel, top to bottom: the layer buttons, the details of what was clicked, each
	-- layer's options while it is on, and the legends.
	Ui.text(column, "Layers", { size = 12, bold = true, colour = Ui.MUTED })
	local buttonRow = Ui.buttons(column, 30)
	detailBox = Ui.section(column)
	detailBox.Visible = false
	local function heading(text: string): TextLabel
		return Ui.text(column, text, { size = 12, bold = true, colour = Ui.MUTED })
	end
	local outlookHeading = heading("Outlook")
	local outlook = Outlook.new(context, column)
	local radarHeading = heading("Radar")
	local radar = Radar.new(context, column)
	local warningsHeading = heading("Warnings")
	local warnings = Areas.new(Areas.WARNINGS, context, column, true)
	local watchesHeading = heading("Watches")
	local watches = Areas.new(Areas.WATCHES, context, column, true)
	local discussionsHeading = heading("Mesoscale discussions")
	local discussions = Areas.new(Areas.DISCUSSIONS, context, column, true)
	legendBox = Ui.section(column)

	layers = { outlook :: any, radar :: any, watches :: any, discussions :: any, warnings :: any }
	headings = { outlook = outlookHeading, radar = radarHeading, warnings = warningsHeading, watches = watchesHeading, discussions = discussionsHeading }
	drawOrder = { outlook :: any, radar :: any, discussions :: any, watches :: any, warnings :: any }
	hitOrder = { radar :: any, warnings :: any, watches :: any, discussions :: any, outlook :: any }

	for _, layer in layers do
		layerButtons[layer.key] = Ui.button(buttonRow, layer.name, function()
			setEnabled(layer, not layer.enabled)
		end)
	end
	for _, layer in layers do
		setEnabled(layer, layer.enabled)
	end

	MapCanvas.onClick(function(mx: number, my: number)
		local mpp = MapCanvas.milesPerPixel()
		for _, layer in hitOrder do
			if layer.enabled then
				local found = layer:hit(mx, my, mpp)
				if found then
					context.showDetail(found)
					return
				end
			end
		end
	end)

	screen.Parent = player:WaitForChild("PlayerGui")
	return screen
end

function Products.toggle()
	local first = gui == nil
	if not gui then
		gui = build()
	end
	local screen = gui :: ScreenGui
	screen.Enabled = not screen.Enabled
	MapCanvas.setVisible(screen.Enabled)
	if screen.Enabled and first then
		MapCanvas.centreOnMe()
	end
end

function Products.start()
	UserInputService.InputBegan:Connect(function(input: InputObject, processed: boolean)
		if processed then
			return
		end
		local open = gui ~= nil and (gui :: ScreenGui).Enabled
		if input.KeyCode == Enum.KeyCode.M then
			Products.toggle()
		elseif input.KeyCode == Enum.KeyCode.C and open then
			MapCanvas.centreOnMe()
		elseif (input.KeyCode == Enum.KeyCode.Equals or input.KeyCode == Enum.KeyCode.Minus) and open then
			MapCanvas.zoom(if input.KeyCode == Enum.KeyCode.Equals then 0.5 else 2)
		end
	end)

	-- A newer version of a product a layer shows is drawn as soon as it is out.
	ProductClient.onChanged(function(id: string)
		for _, layer in layers do
			if layer.enabled and layer:wants(id) then
				task.spawn(layer.refresh, layer)
			end
		end
	end)

	RunService.RenderStepped:Connect(function()
		MapCanvas.step()
	end)
end

return Products
