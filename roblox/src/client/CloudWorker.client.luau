--!strict
-- A worker thread for the storm clouds drawn as a volume (client/CloudVolume): renders bands of
-- the picture in parallel (Parallel Luau). This script is a disabled template; CloudVolume clones
-- it into Actors and enables the clones. Each says "ready" once it listens, then for each band it
-- is sent renders it in parallel and hands the bytes back.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local actor = script:GetActor()
if not actor then
	return
end

local CloudVolumeMath = require(ReplicatedStorage.Shared.Weather.CloudVolumeMath)
local done = actor:WaitForChild("Done") :: BindableEvent

actor:BindToMessageParallel("Render", function(job: any, r0: number, r1: number)
	local bytes = CloudVolumeMath.renderBand(job, r0, r1)
	task.synchronize()
	done:Fire("band", job.id, job.key, r0, r1, bytes)
end)

done:Fire("ready")
