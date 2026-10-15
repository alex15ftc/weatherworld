--!strict
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local Config = require(ReplicatedStorage.Shared.World.Config)

print(`[WeatherWorld] client up: chunk {Config.CHUNK_STUDS} studs, load radius {Config.LOAD_RADIUS_STUDS}`)

-- During the chunk-streaming test, report the client's frame rate every 5 seconds.
if workspace:GetAttribute("TestDrive") == true then
	local frames, worst, started = 0, 0, os.clock()
	RunService.RenderStepped:Connect(function(dt: number)
		frames += 1
		worst = math.max(worst, dt)
		local elapsed = os.clock() - started
		if elapsed >= 5 then
			print(`[TestDrive] client {string.format("%.1f", frames / elapsed)} fps, worst frame {string.format("%.1f", worst * 1000)} ms`)
			frames, worst, started = 0, 0, os.clock()
		end
	end)
end

-- Flying, for looking round the world: F toggles it; the camera points the way, W/A/S/D move,
-- Q/E go down and up, Shift goes fast.
do
	local Players = game:GetService("Players")
	local UserInputService = game:GetService("UserInputService")
	local player = Players.LocalPlayer
	local SPEED, FAST = 150, 900
	local flying = false

	UserInputService.InputBegan:Connect(function(input: InputObject, processed: boolean)
		if processed or input.KeyCode ~= Enum.KeyCode.F then
			return
		end
		flying = not flying
		local character = player.Character
		local humanoid = if character then character:FindFirstChildOfClass("Humanoid") else nil
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
		local look, right = camera.CFrame.LookVector, camera.CFrame.RightVector
		local move = Vector3.zero
		local held = function(key: Enum.KeyCode): number
			return if UserInputService:IsKeyDown(key) then 1 else 0
		end
		move += look * (held(Enum.KeyCode.W) - held(Enum.KeyCode.S))
		move += right * (held(Enum.KeyCode.D) - held(Enum.KeyCode.A))
		move += Vector3.yAxis * (held(Enum.KeyCode.E) - held(Enum.KeyCode.Q))
		local speed = if UserInputService:IsKeyDown(Enum.KeyCode.LeftShift) then FAST else SPEED
		root.AssemblyLinearVelocity = if move.Magnitude > 0 then move.Unit * speed else Vector3.zero
		local flat = Vector3.new(look.X, 0, look.Z)
		if flat.Magnitude > 0.05 then
			root.CFrame = CFrame.lookAlong(root.Position, flat)
		end
	end)
end

require(script:WaitForChild("MapView")).start()
require(script:WaitForChild("StormView")).start()
