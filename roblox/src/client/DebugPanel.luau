--!strict
-- The Studio debug panel, opened and closed with F2: teleport (to a town, a map point or the
-- tornado), move or put back the recorded tornado, the chase car (client/Vehicles), walk speed,
-- heal, and time of day. Built with imgui-luau (the Wally package, Packages.ImGui). The commands
-- go to server/DebugTools, which only runs in Studio; client/init only starts this in Studio, so
-- the panel is never loaded elsewhere.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local UserInputService = game:GetService("UserInputService")

local Config = require(ReplicatedStorage.Shared.World.Config)
local G = require(ReplicatedStorage.Packages.ImGui)

local ImGui = G.ImGui
local ImGui_ImplRoblox = G.ImGui_ImplRoblox

local DebugPanel = {}

local MAP = Config.MAP_MILES

local Panel = {
	open = true,
	town = 0, -- 0-based index into Towns, as ImGui.Combo uses
	x = MAP / 2,
	y = MAP / 2,
	walk = 16,
	time = 14,
	status = "F2 closes this panel",
}

local Towns: { { label: string, x: number, y: number } } = {}
local TownLabels: { string } = {}

local folder = ReplicatedStorage:WaitForChild("Debug")
local commandEvent = folder:WaitForChild("Command") :: RemoteEvent
local statusEvent = folder:WaitForChild("Status") :: RemoteEvent
local settlementsFunction = folder:WaitForChild("Settlements") :: RemoteFunction

local function send(command: { [string]: any })
	commandEvent:FireServer(command)
end

-- Where the local player stands, in map miles (nil until the character is in).
local function mapPoint(): (number?, number?)
	local character = Players.LocalPlayer.Character
	local root = if character then character:FindFirstChild("HumanoidRootPart") :: BasePart? else nil
	if not root then
		return nil, nil
	end
	return root.Position.X / Config.STUDS_PER_MILE + MAP / 2, root.Position.Z / Config.STUDS_PER_MILE + MAP / 2
end

local function draw()
	local px, py = mapPoint()

	ImGui.Begin("WeatherWorld debug")
	if px and py then
		ImGui.Text(`You are at {math.round(px)}, {math.round(py)} mi (map miles from the NW corner)`)
	end
	ImGui.Separator()

	ImGui.Text("Teleport")
	if #TownLabels > 0 then
		Panel.town = ImGui.Combo("town", Panel.town, TownLabels)
		ImGui.SameLine()
		if ImGui.Button("Go to town") then
			local town = Towns[Panel.town + 1]
			if town then
				send({ kind = "teleport", x = town.x, y = town.y })
			end
		end
	end
	Panel.x = ImGui.SliderFloat("x (mi)", Panel.x, 0, MAP)
	Panel.y = ImGui.SliderFloat("y (mi)", Panel.y, 0, MAP)
	if ImGui.Button("Go to point") then
		send({ kind = "teleport", x = Panel.x, y = Panel.y })
	end

	ImGui.Separator()
	ImGui.Text("Tornado (the recorded 199 mph one)")
	if ImGui.Button("Move it to me") then
		if px and py then
			send({ kind = "tornado", x = px, y = py })
		end
	end
	ImGui.SameLine()
	if ImGui.Button("Move it to point") then
		send({ kind = "tornado", x = Panel.x, y = Panel.y })
	end
	ImGui.SameLine()
	if ImGui.Button("Put it back") then
		send({ kind = "clear" })
	end
	if ImGui.Button("Go to it") then
		send({ kind = "toTornado" })
	end

	ImGui.Separator()
	ImGui.Text("Car: W/S drive, A/D steer, Space hand brake, R right it, V in/out")
	if ImGui.Button("Spawn car here") then
		send({ kind = "car" })
	end
	ImGui.SameLine()
	if ImGui.Button("Delete car") then
		send({ kind = "deleteCar" })
	end

	ImGui.Separator()
	ImGui.Text("You")
	local walk = ImGui.SliderFloat("walk speed", Panel.walk, 4, 100)
	if walk ~= Panel.walk then
		Panel.walk = walk
		send({ kind = "walkSpeed", value = walk })
	end
	ImGui.SameLine()
	if ImGui.Button("Heal") then
		send({ kind = "heal" })
	end

	ImGui.Separator()
	ImGui.Text("World")
	local hours = ImGui.SliderFloat("time of day (h)", Panel.time, 0, 24)
	if hours ~= Panel.time then
		Panel.time = hours
		send({ kind = "time", hours = hours })
	end

	ImGui.Separator()
	ImGui.TextDisabled(Panel.status)
	ImGui.End()
end

function DebugPanel.start()
	ImGui.CreateContext()
	local IO = ImGui.GetIO()
	IO.Fonts:AddFontDefault()
	ImGui_ImplRoblox.Init(nil, 1.0)

	task.spawn(function()
		for _, settlement in settlementsFunction:InvokeServer() do
			table.insert(Towns, { label = settlement.name, x = settlement.x, y = settlement.y })
			table.insert(TownLabels, `{settlement.name} ({settlement.kind})`)
		end
	end)

	statusEvent.OnClientEvent:Connect(function(text: string)
		Panel.status = text
	end)

	UserInputService.InputBegan:Connect(function(input: InputObject, processed: boolean)
		if processed or input.KeyCode ~= Enum.KeyCode.F2 then
			return
		end
		Panel.open = not Panel.open
	end)

	RunService.Stepped:Connect(function()
		ImGui_ImplRoblox.NewFrame()
		ImGui.NewFrame()
		if Panel.open then
			draw()
		end
		ImGui.EndFrame()
		ImGui.Render()
		ImGui_ImplRoblox.RenderDrawData(ImGui.GetDrawData())
	end)

	print("[DebugPanel] F2 opens the debug panel")
end

return DebugPanel
