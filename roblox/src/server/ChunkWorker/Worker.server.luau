--!strict
-- Template worker (disabled; ChunkManager clones and enables it). Builds a chunk's voxels in a
-- parallel phase, then writes them to Terrain and places its props in serial, and reports timings.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local ChunkGen = require(ReplicatedStorage.Shared.World.ChunkGen)

local actor = script:GetActor() :: Actor
local terrain = workspace.Terrain
local done = (actor.Parent :: Instance):WaitForChild("ChunkDone") :: BindableEvent
local propsRoot = workspace:WaitForChild("WorldProps")

actor:BindToMessage("Build", function(cx: number, cz: number)
	ChunkGen.prepare(cx, cz) -- loads map tiles: serial only
	task.desynchronize()
	local t0 = os.clock()
	local chunk = ChunkGen.build(cx, cz)
	local buildMs = (os.clock() - t0) * 1000
	task.synchronize()
	local t1 = os.clock()
	terrain:WriteVoxels(chunk.region, ChunkGen.VOXEL, chunk.materials, chunk.occupancy)
	ChunkGen.place(chunk.props, propsRoot, ChunkGen.key(cx, cz))
	done:Fire(actor, cx, cz, chunk.yMin, chunk.yMax, buildMs, (os.clock() - t1) * 1000)
end)

actor:SetAttribute("Ready", true)
