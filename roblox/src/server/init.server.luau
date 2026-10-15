--!strict
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage.Shared.World.Config)
local ChunkManager = require(script.ChunkManager)
local TestDrive = require(script.TestDrive)
local Explore = require(script.Explore)

print(`[WeatherWorld] server up: {Config.MAP_STUDS} studs across, {Config.STUDS_PER_MILE} studs/mile`)

ChunkManager.start(script:WaitForChild("ChunkWorker") :: Actor)
TestDrive.start()
Explore.start()
