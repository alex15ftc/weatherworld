--!strict
-- Flying, for looking round the world: F toggles it; the camera points the way, W/A/S/D move,
-- Q/E go down and up, Shift goes fast. The speeds are the player's settings FlySpeed and
-- FlyBoostSpeed (Shared/Settings/Frontend/Flight.toml).

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local UserInputService = game:GetService("UserInputService")

local Shared = ReplicatedStorage.Shared
local Config = require(Shared.World.Config)
local Settings = require(Shared.Settings)

local FlightController = {}

local player = assert(Players.LocalPlayer)
local flying = false
-- (the speed settings, kept current from their change signals rather than read every frame)
local speed, boostSpeed = 150, 900

function FlightController.isFlying(): boolean
	return flying
end

local function humanoidOf(): Humanoid?
	local character = player.Character
	return if character then character:FindFirstChildOfClass("Humanoid") else nil
end

local function toggle()
	flying = not flying
	local humanoid = humanoidOf()
	if humanoid and flying and humanoid.SeatPart then
		-- (out of the car first: flying the driver would drag the car's body off its wheels)
		humanoid.Sit = false
	end
	if humanoid then
		humanoid.PlatformStand = flying
	end
end

local function held(key: Enum.KeyCode): number
	return if UserInputService:IsKeyDown(key) then 1 else 0
end

local function fly()
	if not flying then
		return
	end
	local character = player.Character
	local root = if character then character:FindFirstChild("HumanoidRootPart") :: BasePart? else nil
	local camera = workspace.CurrentCamera
	if not root or not camera then
		return
	end
	local look, right = camera.CFrame.LookVector, camera.CFrame.RightVector
	local move = Vector3.zero
	move += look * (held(Enum.KeyCode.W) - held(Enum.KeyCode.S))
	move += right * (held(Enum.KeyCode.D) - held(Enum.KeyCode.A))
	move += Vector3.yAxis * (held(Enum.KeyCode.E) - held(Enum.KeyCode.Q))
	local now = if UserInputService:IsKeyDown(Enum.KeyCode.LeftShift) then boostSpeed else speed
	root.AssemblyLinearVelocity = if move.Magnitude > 0 then move.Unit * now else Vector3.zero
	local flat = Vector3.new(look.X, 0, look.Z)
	if flat.Magnitude > 0.05 then
		root.CFrame = CFrame.lookAlong(root.Position, flat)
	end
end

function FlightController.Start()
	speed = Settings.GetNumber("FlySpeed")
	boostSpeed = Settings.GetNumber("FlyBoostSpeed")
	Settings.GetNumberChangedSignal("FlySpeed"):Connect(function(value: number)
		speed = value
	end)
	Settings.GetNumberChangedSignal("FlyBoostSpeed"):Connect(function(value: number)
		boostSpeed = value
	end)
	print(`[WeatherWorld] client up: chunk {Config.CHUNK_STUDS} studs, load radius {Config.LOAD_RADIUS_STUDS}`)

	UserInputService.InputBegan:Connect(function(input: InputObject, processed: boolean)
		if not processed and input.KeyCode == Enum.KeyCode.F then
			toggle()
		end
	end)
	-- (a new character stands: it starts on foot)
	player.CharacterAdded:Connect(function()
		flying = false
	end)
	RunService.RenderStepped:Connect(fly)
end

return FlightController
