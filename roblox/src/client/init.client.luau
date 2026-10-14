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
