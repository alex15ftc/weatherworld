--!strict
-- During the chunk-streaming test (Workspace attribute TestDrive; TestDriveService), reports this
-- client's frame rate every 5 seconds.

local RunService = game:GetService("RunService")

local TestDriveController = {}

function TestDriveController.Start()
	if workspace:GetAttribute("TestDrive") ~= true then
		return
	end
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

return TestDriveController
