--!strict
-- The weather screen, opened and closed with M (docs/ROBLOX-UI-PLAN.md): the world map with the
-- products the weather server issues as layers over it, each turned on or off with its button
-- in the side panel: the convective outlook, one radar, the watches, the mesoscale discussions
-- and the warnings; and the storm reports and damage surveys of a day. A click on the map opens
-- the details of what is there (a report or a damage survey first, then a warning, a watch, a
-- discussion, the outlook); a click on a radar's label picks that radar.
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
local Satellite = require(script.Layers.Satellite)
local Areas = require(script.Layers.Areas)
local Reports = require(script.Layers.Reports)
local Damage = require(script.Layers.Damage)

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
		-- The layers drawn before radar's (the outlook) go under the radar image; radar's own
		-- shapes and those after it go over it.
		drawUnder = function(draw: MapCanvas.Draw)
			for _, layer in drawOrder do
				if layer.drawRaster then
					break
				end
				if layer.enabled then
					layer:draw(draw)
				end
			end
		end,
		draw = function(draw: MapCanvas.Draw)
			local over = false
			for _, layer in drawOrder do
				over = over or layer.drawRaster ~= nil
				if over and layer.enabled then
					layer:draw(draw)
				end
			end
		end,
		-- Byte grids (satellite, radar mosaics), scaled by the GPU, bottom first.
		grids = function(): { MapCanvas.Grid }
			local out = {}
			for _, layer in drawOrder do
				if layer.enabled and layer.grids then
					for _, g in (layer.grids :: any)(layer) do
						table.insert(out, g)
					end
				end
			end
			return out
		end,
		-- Raster products (radar): one image between the two.
		drawRaster = function(draw: MapCanvas.Draw)
			for _, layer in drawOrder do
				if layer.enabled and layer.drawRaster then
					(layer.drawRaster :: any)(layer, draw)
				end
			end
		end,
		-- What the raster layers would draw now (nil if any of them cannot say).
		rasterKey = function(): string?
			local parts = {}
			for _, layer in drawOrder do
				if layer.enabled and layer.drawRaster then
					local key = if layer.rasterKey then (layer.rasterKey :: any)(layer) else nil
					if not key then
						return nil
					end
					table.insert(parts, key)
				end
			end
			return table.concat(parts, "|")
		end,
		-- Marks over the raster image (lightning, rotation), in their own image.
		drawMarks = function(draw: MapCanvas.Draw)
			for _, layer in drawOrder do
				if layer.enabled and layer.drawMarks then
					(layer.drawMarks :: any)(layer, draw)
				end
			end
		end,
		marksKey = function(): string?
			local parts = {}
			for _, layer in drawOrder do
				if layer.enabled and layer.drawMarks then
					local key = if layer.marksKey then (layer.marksKey :: any)(layer) else nil
					if not key then
						return nil
					end
					table.insert(parts, key)
				end
			end
			return table.concat(parts, "|")
		end,
		-- The top layer that says anything about the point under the cursor.
		hover = function(mx: number, my: number): string?
			for k = #drawOrder, 1, -1 do
				local layer = drawOrder[k]
				if layer.enabled and layer.hover then
					local line = (layer.hover :: any)(layer, mx, my)
					if line then
						return line
					end
				end
			end
			return nil
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

-- What the shapes (or legend) of the layers on show depend on: each layer's own key, or, for a
-- layer that cannot say, a new value every time (so it is always drawn again).
local unknown = 0
local function keyOf(method: string): string
	local parts = {}
	for _, layer in drawOrder do
		if layer.enabled then
			local fn = (layer :: any)[method]
			if fn then
				table.insert(parts, `{layer.key}={fn(layer)}`)
			else
				unknown += 1
				table.insert(parts, `{layer.key}#{unknown}`)
			end
		end
	end
	local open = detail
	table.insert(parts, if open then `detail={open.layer}/{open.item}` else "")
	return table.concat(parts, "|")
end

-- Draws what changed: the product tiles only when a layer's shapes changed (they are the
-- costly part: every tile in view, every layer), else just the raster image and labels; the
-- legend only when it would read differently.
local shownShapes: string? = nil
local shownLegend: string? = nil
local function redraw()
	local shapes = keyOf("shapeKey")
	if shapes ~= shownShapes then
		shownShapes = shapes
		MapCanvas.setOverlay(compose())
	else
		MapCanvas.refresh()
	end
	local legend = keyOf("legendKey")
	if legend ~= shownLegend then
		shownLegend = legend
		renderLegend()
	end
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
	isOpen = function(): boolean
		return gui ~= nil and (gui :: ScreenGui).Enabled
	end,
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
	-- Each frame orders its own children (the map canvas stacks its layers this way).
	screen.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
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
	local satelliteHeading = heading("Satellite")
	local satellite = Satellite.new(context, column)
	local radarHeading = heading("Radar")
	local radar = Radar.new(context, column)
	local warningsHeading = heading("Warnings")
	local warnings = Areas.new(Areas.WARNINGS, context, column, true)
	local watchesHeading = heading("Watches")
	local watches = Areas.new(Areas.WATCHES, context, column, true)
	local discussionsHeading = heading("Mesoscale discussions")
	local discussions = Areas.new(Areas.DISCUSSIONS, context, column, true)
	local reportsHeading = heading("Storm reports")
	local reports = Reports.new(context, column)
	local damageHeading = heading("Damage surveys")
	local damage = Damage.new(context, column)
	legendBox = Ui.section(column)

	layers = { outlook :: any, satellite :: any, radar :: any, watches :: any, discussions :: any, warnings :: any, reports :: any, damage :: any }
	headings = {
		outlook = outlookHeading, satellite = satelliteHeading, radar = radarHeading, warnings = warningsHeading, watches = watchesHeading, discussions = discussionsHeading,
		reports = reportsHeading, damage = damageHeading,
	}
	drawOrder = { outlook :: any, satellite :: any, radar :: any, discussions :: any, watches :: any, warnings :: any, damage :: any, reports :: any }
	hitOrder = { radar :: any, reports :: any, damage :: any, warnings :: any, watches :: any, discussions :: any, outlook :: any }

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
	elseif screen.Enabled then
		-- Closed, the layers fetched nothing and their loops and keepalives stopped
		-- (context.isOpen): each one on is brought up to date, and started again, once.
		for _, layer in layers do
			if layer.enabled then
				layer:setEnabled(true)
			end
		end
		redraw()
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

	-- A newer version of a product a layer shows is drawn as soon as it is out, while the screen
	-- is open (closed, it is fetched when it opens again: Products.toggle).
	ProductClient.onChanged(function(id: string)
		if not context.isOpen() then
			return
		end
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
