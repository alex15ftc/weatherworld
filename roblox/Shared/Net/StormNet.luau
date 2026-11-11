--!strict
-- The storm frames' network (docs/stormlab/FRAME-V2.md), shared by the game (StormHostService ->
-- Modules/Weather/Net) and the storm lab (StormLabService -> StormLabController). Every frame goes
-- out through the server's StormPublisher; clients say "ready" with the Command event once their
-- listeners are set, and only then get broadcasts (Network events that arrive before a listener is
-- set are dropped, so the handshake matters).
--
--   server -> client  State (World.snapshot ~2 Hz, settings), Profiles, Tornado (unreliable,
--                     one tornado a message: the payload limit is ~900 bytes), ColdPool, Precip,
--                     PrecipLite, Flash, Event
--   client -> server  Command { cmd = ..., ... }
--   requests          Hello () -> { scenario, time, settings, source, frameVersion, data?, ... }
--                     Ground () -> the coarse ground grid (the game only)

local Shared = script.Parent.Parent
local Network = require(Shared.Network)

local fromServer = Network.FromServer

local StormNet = {}

-- (the event names are short: the unreliable Tornado message carries its name in its payload)
local Events = table.freeze({
	state = Network.Event("Storm.State", fromServer),
	profiles = Network.Event("Storm.Profiles", fromServer),
	tornado = Network.UnreliableEvent("Storm.Tornado", fromServer),
	coldPool = Network.Event("Storm.ColdPool", fromServer),
	precip = Network.Event("Storm.Precip", fromServer),
	precipLite = Network.Event("Storm.PrecipLite", fromServer),
	flash = Network.Event("Storm.Flash", fromServer),
	event = Network.Event("Storm.Event", fromServer),
	command = Network.Event("Storm.Command", function(cmd: unknown): { [string]: any }
		assert(type(cmd) == "table" and type((cmd :: any).cmd) == "string", "a command is { cmd = string, ... }")
		return cmd :: any
	end),
})
StormNet.Events = Events

StormNet.Hello = Network.Request("Storm.Hello", function()
	return
end)

StormNet.Ground = Network.Request("Storm.Ground", function()
	return
end)

-- The server's sending side of every frame kind, for StormPublisher (kind -> Network server).
function StormNet.servers(): { [string]: any }
	local out: { [string]: any } = {}
	for kind, event in Events :: { [string]: any } do
		if kind ~= "command" then
			out[kind] = event:Server()
		end
	end
	return out
end

return table.freeze(StormNet)
