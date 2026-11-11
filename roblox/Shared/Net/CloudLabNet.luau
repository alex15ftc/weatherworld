--!strict
-- The cloud lab's network (Labs/CloudLab). Every message is server -> client except the Ready ones.
--   Snapshot / NestSnapshot / FineSnapshot  the lab's snapshots (CloudLabService)
--   LiveFrame      a live engine frame (LiveFeedService)
--   Ready          client -> server (what: "snapshot" | "live"): that view's listener is set, so the
--                  server may send to it (what is sent before is dropped by the client)
--   NetTestFrames  the bandwidth test's frames (NetTestService); NetTestReady: the client listens

local Shared = script.Parent.Parent
local Network = require(Shared.Network)

local fromServer = Network.FromServer

return table.freeze({
	Snapshot = Network.Event("CloudLab.Snapshot", fromServer),
	NestSnapshot = Network.Event("CloudLab.NestSnapshot", fromServer),
	FineSnapshot = Network.Event("CloudLab.FineSnapshot", fromServer),
	LiveFrame = Network.Event("CloudLab.LiveFrame", fromServer),
	Ready = Network.Event("CloudLab.Ready", function(what: unknown): string
		assert(what == "snapshot" or what == "live", "bad view")
		return what :: string
	end),
	NetTestFrames = Network.Event("CloudLab.NetTestFrames", fromServer),
	NetTestReady = Network.Event("CloudLab.NetTestReady", function()
		return
	end),
})
