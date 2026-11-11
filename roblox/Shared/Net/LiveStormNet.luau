--!strict
-- The cloud model's storms, live (LiveStormsService -> LiveStormsController).
--   Frame  server -> client  ("frame", id, xKm, yKm, frame buffer (Zstd), near, ue, ve, look)
--                            ("gone", id) | ("flash", list)
--   Ready  client -> server  the client's listener is set: frames may be sent to it now (a frame
--                            sent before is dropped by the client, and would not be sent again
--                            until the storm's next frame)

local Shared = script.Parent.Parent
local Network = require(Shared.Network)

return table.freeze({
	Frame = Network.Event("LiveStorms.Frame", Network.FromServer),
	Ready = Network.Event("LiveStorms.Ready", function()
		return
	end),
})
