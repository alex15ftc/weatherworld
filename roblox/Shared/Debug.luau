--!strict
-- Remotes for the debug panel (DebugController <-> DebugService). The commands themselves are
-- ConVars (DebugService); this is only the town list, which lives in the server-only map.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Network = require(ReplicatedStorage.Shared.Network)

local Debug = {}

export type Town = { name: string, kind: string, x: number, y: number }

-- Client -> server: send me the towns (answered only for Developers).
Debug.AskTowns = Network.Event("Debug_AskTowns", function(): ()
	return
end)

-- Server -> client: the towns, in map miles.
Debug.Towns = Network.Event("Debug_Towns", function(towns: unknown): { Town }
	assert(type(towns) == "table", "bad towns")
	for _, town in towns :: { any } do
		assert(type(town) == "table" and type(town.name) == "string" and type(town.x) == "number" and type(town.y) == "number", "bad town")
	end
	return towns :: { Town }
end)

return Debug
