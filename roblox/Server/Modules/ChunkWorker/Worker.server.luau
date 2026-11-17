--!strict
-- Template worker (disabled; ChunkService clones and enables it). Builds a chunk's voxels in a
-- parallel phase, then writes them to Terrain and places its props in serial (spread over frames),
-- and reports timings and the props model.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage.Shared.World.Config)
local ChunkGen = require(game:GetService("ServerStorage").World.ChunkGen)

local actor = script:GetActor() :: Actor
local terrain = workspace.Terrain
local done = (actor.Parent :: Instance):WaitForChild("ChunkDone") :: BindableEvent
local planned = (actor.Parent :: Instance):WaitForChild("ChunkPlanned") :: BindableEvent
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
	local writeMs = (os.clock() - t1) * 1000
	-- The props over the next frames (the workers share PLACE_BUDGET_MS a frame), the model
	-- parented last: the terrain is in before anything stands on it.
	local model, placeMs = ChunkGen.place(chunk.props, propsRoot, ChunkGen.name(cx, cz), Config.PLACE_BUDGET_MS / math.max(1, Config.WORKERS))
	done:Fire(actor, cx, cz, chunk.yMin, chunk.yMax, buildMs, writeMs + placeMs, model)
end)

-- A chunk's buildings only (ChunkService.plan, for the damage survey's unseen ground): built in
-- a parallel phase and thrown away but for its buildings' records.
actor:BindToMessage("Plan", function(cx: number, cz: number)
	ChunkGen.prepare(cx, cz)
	task.desynchronize()
	local list = ChunkGen.structures(ChunkGen.build(cx, cz).props)
	task.synchronize()
	local out = {}
	for _, s in list do
		table.insert(out, { n = s.n, di = s.di, frame = s.frame, size = s.size })
	end
	planned:Fire(actor, out)
end)

actor:SetAttribute("Ready", true)
