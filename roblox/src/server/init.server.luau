--!strict
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage.Shared.World.Config)
local ChunkManager = require(script.ChunkManager)
local TestDrive = require(script.TestDrive)
local Explore = require(script.Explore)
local StormHost = require(script.StormHost)
local ProductFeed = require(script.ProductFeed)

print(`[WeatherWorld] server up: {Config.MAP_STUDS} studs across, {Config.STUDS_PER_MILE} studs/mile`)

ChunkManager.start(script:WaitForChild("ChunkWorker") :: Actor)
TestDrive.start()
-- the storms: the storm lab's atmosphere run here for this place, kept in step with the weather
-- engine, published as storm frames v2 (server/StormHost, docs/stormlab/SYNC-PLAN.md)
StormHost.start()
ProductFeed.start()
Explore.start()
