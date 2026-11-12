--!strict
-- The chaser network: where every player in this server is, and where each has been over about
-- the last world day (ChaserNetService -> Client/Modules/Products/ChaserClient, the map's Chasers
-- layer). Map points are hundredths of a map mile (u16, from the map's north-west corner), times
-- whole seconds of the server clock (workspace:GetServerTimeNow()), all little-endian.
--   Update  server -> client
--     ("full", buffer)  every player's trail, sent once the client is ready:
--                       f64 now, u16 players, then per player
--                       f64 userId, u16 points, points oldest first of
--                       (u16 x, u16 y, u32 time, u8 flags)
--     ("tick", buffer)  where each player is now, every LIVE_SECONDS (a player whose character
--                       has no root part is left out):
--                       f64 now, u16 players, then per player
--                       f64 userId, u16 x, u16 y, u16 heading (degrees clockwise from north),
--                       u8 flags
--     flags: bit 0 (1) this point is also the trail's newest point; bit 1 (2) the trail breaks
--     before it (a teleport, or the character was gone for a while)
--   Ready   client -> server  the client's listener is set: the full trails may be sent now

local Shared = script.Parent.Parent
local Network = require(Shared.Network)

return table.freeze({
	Update = Network.Event("Chasers.Update", Network.FromServer),
	Ready = Network.Event("Chasers.Ready", function()
		return
	end),
	-- (the shared layout, so both sides read and write it the same way)
	TRAIL_POINT_BYTES = 9,
	TICK_PLAYER_BYTES = 15,
	FLAG_TRAIL = 1,
	FLAG_BREAK = 2,
	UNITS_PER_MILE = 100,
})
