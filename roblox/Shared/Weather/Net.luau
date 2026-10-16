--!strict
-- Remotes for the storm frames (WeatherService -> StormController).

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Network = require(ReplicatedStorage.Shared.Network)

local Net = {}

-- Frames as the weather server sends them (Shared/Weather/StormTrack reads them); reset means
-- they replace what the client holds, epoch marks a new recording or feed.
export type Packet = { frames: { any }, reset: boolean, epoch: number? }

-- Server -> client: new frames (to everyone), or all held frames (to a client that asked).
Net.Frames = Network.Event("Weather_Frames", function(packet: unknown): Packet
	assert(type(packet) == "table", "bad packet")
	local p = packet :: any
	assert(type(p.frames) == "table" and type(p.reset) == "boolean", "bad packet")
	assert(p.epoch == nil or type(p.epoch) == "number", "bad epoch")
	return p :: Packet
end)

-- Client -> server: send me what you hold (a client that has just joined).
Net.AskFrames = Network.Event("Weather_AskFrames", function(): ()
	return
end)

return Net
