--!strict
-- Flying, for looking round the world: F toggles it; the camera points the way, W/A/S/D move,
-- Q/E go down and up, Shift goes fast. Not from a car seat (get out first with V); sitting down
-- stops it, or it would hold the whole car still.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local UserInputService = game:GetService("UserInputService")

local Config = require(ReplicatedStorage.Shared.World.Config)

local FlyController = {}

local SPEED, FAST = 150, 900

local player = Players.LocalPlayer
local flying = false

local function held(key: Enum.KeyCode): number
	return if UserInputService:IsKeyDown(key) then 1 else 0
end

function FlyController.Start()
	print(`[WeatherWorld] client up: chunk {Config.CHUNK_STUDS} studs, load radius {Config.LOAD_RADIUS_STUDS}; fly with F`)

	UserInputService.InputBegan:Connect(function(input: InputObject, processed: boolean)
		if processed or input.KeyCode ~= Enum.KeyCode.F then
			return
		end
		local character = player.Character
		local humanoid = if character then character:FindFirstChildOfClass("Humanoid") else nil
		if humanoid and humanoid.SeatPart and not flying then
			return
		end
		flying = not flying
		if humanoid then
			humanoid.PlatformStand = flying
		end
	end)

	RunService.RenderStepped:Connect(function()
		if not flying then
			return
		end
		local character = player.Character
		local root = if character then character:FindFirstChild("HumanoidRootPart") :: BasePart? else nil
		local camera = workspace.CurrentCamera
		if not root or not camera then
			return
		end
		local humanoid = (character :: Model):FindFirstChildOfClass("Humanoid")
		if humanoid and humanoid.SeatPart then
			flying = false
			humanoid.PlatformStand = false
			return
		end
		local look, right = camera.CFrame.LookVector, camera.CFrame.RightVector
		local move = look * (held(Enum.KeyCode.W) - held(Enum.KeyCode.S))
			+ right * (held(Enum.KeyCode.D) - held(Enum.KeyCode.A))
			+ Vector3.yAxis * (held(Enum.KeyCode.E) - held(Enum.KeyCode.Q))
		local speed = if UserInputService:IsKeyDown(Enum.KeyCode.LeftShift) then FAST else SPEED
		root.AssemblyLinearVelocity = if move.Magnitude > 0 then move.Unit * speed else Vector3.zero
		local flat = Vector3.new(look.X, 0, look.Z)
		if flat.Magnitude > 0.05 then
			root.CFrame = CFrame.lookAlong(root.Position, flat)
		end
	end)
end

return FlyController
