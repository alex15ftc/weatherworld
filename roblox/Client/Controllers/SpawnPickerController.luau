--!strict
-- The home city, chosen on a player's first join: a list of the map's cities over the game, shown
-- when the server says the player has none yet (SpawnNet.State). Choosing one makes it home for
-- good (ExploreService: they are moved there, and come back there after dying) and closes the
-- list. Rejoining later puts them where they left (ExploreService), with no list.

local Players = game:GetService("Players")
local ReplicatedFirst = game:GetService("ReplicatedFirst")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local SpawnNet = require(ReplicatedStorage.Shared.Net.SpawnNet)
local Ui = require(ReplicatedFirst:WaitForChild("Modules"):WaitForChild("Products"):WaitForChild("Ui"))

local SpawnPickerController = {}

local player = Players.LocalPlayer :: Player

local KIND_TEXT: { [string]: string } = { metro = "Metro", city = "City", smallCity = "Small city" }

type CityInfo = { name: string, kind: string, population: number }

local function thousands(n: number): string
	local text = tostring(math.floor(n + 0.5))
	local out = text:reverse():gsub("(%d%d%d)", "%1,"):reverse()
	return (out:gsub("^,", ""))
end

local function show(cities: { CityInfo })
	local screen = Instance.new("ScreenGui")
	screen.Name = "HomeCityPicker"
	screen.ResetOnSpawn = false
	screen.IgnoreGuiInset = true
	screen.DisplayOrder = 30
	screen.ZIndexBehavior = Enum.ZIndexBehavior.Sibling

	-- (a modal button under it all: the mouse is free while the list is up)
	local backdrop = Instance.new("TextButton")
	backdrop.Size = UDim2.fromScale(1, 1)
	backdrop.BackgroundColor3 = Ui.PAGE
	backdrop.BackgroundTransparency = 0.45
	backdrop.BorderSizePixel = 0
	backdrop.AutoButtonColor = false
	backdrop.Text = ""
	backdrop.Modal = true
	backdrop.Parent = screen

	local panel = Instance.new("Frame")
	panel.AnchorPoint = Vector2.new(0.5, 0.5)
	panel.Position = UDim2.fromScale(0.5, 0.5)
	panel.Size = UDim2.new(0, 440, 0.8, 0)
	panel.BackgroundColor3 = Ui.PANEL
	panel.BorderSizePixel = 0
	local limit = Instance.new("UISizeConstraint")
	limit.MaxSize = Vector2.new(440, 620)
	limit.Parent = panel
	local corner = Instance.new("UICorner")
	corner.CornerRadius = Ui.CORNER
	corner.Parent = panel
	local edge = Instance.new("UIStroke")
	edge.Color = Ui.LINE
	edge.Parent = panel
	local pad = Instance.new("UIPadding")
	pad.PaddingLeft, pad.PaddingRight = UDim.new(0, 14), UDim.new(0, 6)
	pad.PaddingTop, pad.PaddingBottom = UDim.new(0, 14), UDim.new(0, 10)
	pad.Parent = panel
	panel.Parent = screen

	local column = Ui.column(panel)
	Ui.text(column, "Choose your home city", { size = 20, bold = true })
	Ui.text(column, "You start here, and come back here whenever you die. When you leave the game, you rejoin where you left off.", { colour = Ui.MUTED })
	local status = Ui.text(column, "", { colour = Ui.GOLD })
	status.Visible = false
	Ui.rule(column)

	local buttons: { TextButton } = {}
	local choosing = false
	local function choose(city: CityInfo)
		if choosing then
			return
		end
		choosing = true
		for _, b in buttons do
			b.AutoButtonColor = false
			b.TextTransparency = 0.5
		end
		status.Text = `Heading to {city.name}...`
		status.Visible = true
		SpawnNet.Choose:Client():Invoke(city.name):andThen(function(ok: boolean)
			if ok then
				screen:Destroy()
				return
			end
			status.Text = "That didn't work. Try again."
			choosing = false
			for _, b in buttons do
				b.AutoButtonColor = true
				b.TextTransparency = 0
			end
		end, function(err)
			warn("[HomeCity] choosing failed:", err)
			status.Text = "That didn't work. Try again."
			choosing = false
			for _, b in buttons do
				b.AutoButtonColor = true
				b.TextTransparency = 0
			end
		end)
	end
	for _, city in cities do
		local kind = KIND_TEXT[city.kind] or city.kind
		local button = Ui.listButton(column, `{city.name}   ·   {kind}, pop. {thousands(city.population)}`, nil, function()
			choose(city)
		end)
		button.Size = UDim2.new(1, 0, 0, 36)
		button.TextSize = 15
		table.insert(buttons, button)
	end

	screen.Parent = player:WaitForChild("PlayerGui")
end

function SpawnPickerController.Start()
	task.spawn(function()
		local ok, state = SpawnNet.State:Client():Invoke():await()
		if not ok or type(state) ~= "table" then
			warn("[HomeCity] could not ask for the home city:", state)
			return
		end
		-- (city: "" means none chosen yet; nil means the server could not load the player's data)
		if state.city == "" and type(state.cities) == "table" and #state.cities > 0 then
			show(state.cities)
		end
	end)
end

return SpawnPickerController
