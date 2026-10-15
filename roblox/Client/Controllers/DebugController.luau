--!strict
-- The debug panel, opened and closed with F2: teleport (to a town, a map point or the tornado),
-- move or put back the recorded tornado, the chase car, walk speed, heal and time of day. Built
-- with imgui-luau (Packages.ImGui). Each button runs one of DebugService's ConVars, the same
-- commands you can type in chat, so the server checks every use (CHEAT: Developers, or anyone
-- once sv_cheats is on). The panel itself is only built for Developers (everyone in Studio).

local CollectionService = game:GetService("CollectionService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local UserInputService = game:GetService("UserInputService")

local Shared = ReplicatedStorage.Shared
local Config = require(Shared.World.Config)
local ConVar = require(Shared.ConVar)
local Debug = require(Shared.Debug)

local DebugController = {}

local MAP = Config.MAP_MILES
local SLIDER_SEND_SECONDS = 0.25 -- a dragged slider sends its value at most this often

local player = Players.LocalPlayer

local Panel = {
	open = true,
	town = 0, -- 0-based index into Towns, as ImGui.Combo uses
	x = MAP / 2,
	y = MAP / 2,
	walk = 16,
	time = 14,
	status = "F2 closes this panel; every button is also a chat command",
}

local Towns: { Debug.Town } = {}
local TownLabels: { string } = {}

-- Runs a ConVar as if typed in chat; the reply lands in Panel.status (and in chat).
local function run(command: string)
	ConVar.Execute(command, true)
end

local lastSent: { [string]: number } = {}
local function runThrottled(key: string, command: string)
	local now = os.clock()
	if now - (lastSent[key] or 0) >= SLIDER_SEND_SECONDS then
		lastSent[key] = now
		run(command)
	end
end

local function fmt(value: number): string
	return string.format("%.2f", value)
end

-- Where the local player stands, in map miles (nil until the character is in).
local function mapPoint(): (number?, number?)
	local character = player.Character
	local root = if character then character:FindFirstChild("HumanoidRootPart") :: BasePart? else nil
	if not root then
		return nil, nil
	end
	return root.Position.X / Config.STUDS_PER_MILE + MAP / 2, root.Position.Z / Config.STUDS_PER_MILE + MAP / 2
end

local function isDeveloper(): boolean
	return RunService:IsStudio() or player:HasTag("Developer")
end

local function draw(ImGui: any)
	local px, py = mapPoint()

	ImGui.Begin("WeatherWorld debug")
	if px and py then
		ImGui.Text(`You are at {math.round(px)}, {math.round(py)} mi (map miles from the NW corner)`)
	end
	ImGui.Separator()

	ImGui.Text("Teleport  (/tp x y, /tp town)")
	if #TownLabels > 0 then
		Panel.town = ImGui.Combo("town", Panel.town, TownLabels)
		ImGui.SameLine()
		if ImGui.Button("Go to town") then
			local town = Towns[Panel.town + 1]
			if town then
				run(`tp {fmt(town.x)} {fmt(town.y)}`)
			end
		end
	end
	Panel.x = ImGui.SliderFloat("x (mi)", Panel.x, 0, MAP)
	Panel.y = ImGui.SliderFloat("y (mi)", Panel.y, 0, MAP)
	if ImGui.Button("Go to point") then
		run(`tp {fmt(Panel.x)} {fmt(Panel.y)}`)
	end

	ImGui.Separator()
	ImGui.Text("Tornado, the recorded one  (/tornado x y, /tornado reset, /totornado)")
	if ImGui.Button("Move it to me") and px and py then
		run(`tornado {fmt(px)} {fmt(py)}`)
	end
	ImGui.SameLine()
	if ImGui.Button("Move it to point") then
		run(`tornado {fmt(Panel.x)} {fmt(Panel.y)}`)
	end
	ImGui.SameLine()
	if ImGui.Button("Put it back") then
		run("tornado reset")
	end
	if ImGui.Button("Go to it") then
		run("totornado")
	end

	ImGui.Separator()
	ImGui.Text("Car  (/car, /removecar): W/S drive, A/D steer, Space hand brake, R right it, V in/out")
	if ImGui.Button("Spawn car here") then
		run("car")
	end
	ImGui.SameLine()
	if ImGui.Button("Delete car") then
		run("removecar")
	end

	ImGui.Separator()
	ImGui.Text("You  (/walkspeed n, /heal)")
	local walk = ImGui.SliderFloat("walk speed", Panel.walk, 4, 100)
	if walk ~= Panel.walk then
		Panel.walk = walk
		runThrottled("walk", `walkspeed {fmt(walk)}`)
	end
	ImGui.SameLine()
	if ImGui.Button("Heal") then
		run("heal")
	end

	ImGui.Separator()
	ImGui.Text("World  (sv_time h)")
	local hours = ImGui.SliderFloat("time of day (h)", Panel.time, 0, 24)
	if hours ~= Panel.time then
		Panel.time = hours
		runThrottled("time", `sv_time {fmt(hours)}`)
	end

	ImGui.Separator()
	ImGui.TextDisabled(Panel.status)
	ImGui.End()
end

local function build()
	-- Required here, not at the top, so players who never get the panel never load ImGui.
	local G = require(ReplicatedStorage:WaitForChild("Packages"):WaitForChild("ImGui")) :: any
	local ImGui, ImGui_ImplRoblox = G.ImGui, G.ImGui_ImplRoblox

	ImGui.CreateContext()
	ImGui.GetIO().Fonts:AddFontDefault()
	ImGui_ImplRoblox.Init(nil, 1.0)

	Debug.Towns:Client():On(function(towns: { Debug.Town })
		table.clear(Towns)
		table.clear(TownLabels)
		for _, town in towns do
			table.insert(Towns, town)
			table.insert(TownLabels, `{town.name} ({town.kind})`)
		end
	end)
	Debug.AskTowns:Client():Fire()

	ConVar.SuccessFeed:Connect(function(_name: string, message: string)
		Panel.status = message
	end)
	ConVar.ErrorFeed:Connect(function(_name: string, message: string)
		Panel.status = `failed: {message}`
	end)

	UserInputService.InputBegan:Connect(function(input: InputObject, processed: boolean)
		if not processed and input.KeyCode == Enum.KeyCode.F2 then
			Panel.open = not Panel.open
		end
	end)

	RunService.Stepped:Connect(function()
		ImGui_ImplRoblox.NewFrame()
		ImGui.NewFrame()
		if Panel.open then
			draw(ImGui)
		end
		ImGui.EndFrame()
		ImGui.Render()
		ImGui_ImplRoblox.RenderDrawData(ImGui.GetDrawData())
	end)

	print("[DebugController] F2 opens the debug panel")
end

function DebugController.Start()
	if isDeveloper() then
		build()
		return
	end
	-- Live servers tag Developers (Admins.toml) as they join; the tag may arrive after this.
	local connection: RBXScriptConnection
	connection = CollectionService:GetInstanceAddedSignal("Developer"):Connect(function(instance: Instance)
		if instance == player then
			connection:Disconnect()
			build()
		end
	end)
end

return DebugController
