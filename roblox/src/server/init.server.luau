--!strict
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage.Shared.World.Config)
local ChunkManager = require(script.ChunkManager)
local TestDrive = require(script.TestDrive)
local Explore = require(script.Explore)
local WeatherFeed = require(script.WeatherFeed)
local ProductFeed = require(script.ProductFeed)

print(`[WeatherWorld] server up: {Config.MAP_STUDS} studs across, {Config.STUDS_PER_MILE} studs/mile`)

ChunkManager.start(script:WaitForChild("ChunkWorker") :: Actor)
TestDrive.start()
-- Before Explore places anyone: a storm replay may set the start point.
WeatherFeed.start()
-- the cloud kit's uploaded meshes, for every client's storms (shared/Weather/CloudKit)
do
	local RS = game:GetService("ReplicatedStorage")
	local KitConfig = require(RS:WaitForChild("Shared"):WaitForChild("World"):WaitForChild("Config"))
	require(RS.Shared:WaitForChild("Weather"):WaitForChild("CloudKit")).serverLoad(KitConfig.STORM_KIT.meshAsset)
end
ProductFeed.start()
Explore.start()
