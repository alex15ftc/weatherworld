--!strict
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage.Shared.World.Config)
local ChunkManager = require(script.ChunkManager)
local TestDrive = require(script.TestDrive)
local Explore = require(script.Explore)
local WeatherFeed = require(script.WeatherFeed)

print(`[WeatherWorld] server up: {Config.MAP_STUDS} studs across, {Config.STUDS_PER_MILE} studs/mile`)

ChunkManager.start(script:WaitForChild("ChunkWorker") :: Actor)
TestDrive.start()
-- Before Explore places anyone: a storm replay may set the start point.
WeatherFeed.start()
Explore.start()
