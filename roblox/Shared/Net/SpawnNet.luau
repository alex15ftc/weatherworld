--!strict
-- Choosing a home city (ExploreService <-> SpawnPickerController).
--   State   request () -> { city: string, cities: { { name, kind, population } } }
--           (city is "" until the player has chosen one; the client then shows the picker)
--   Choose  request (name) -> boolean (true: it is their home city now, and they are moved there)

local Shared = script.Parent.Parent
local Network = require(Shared.Network)

local MAX_NAME = 80

return table.freeze({
	State = Network.Request("Spawn.State", function()
		return
	end),
	Choose = Network.Request("Spawn.Choose", function(name: unknown): string
		assert(type(name) == "string" and #name > 0 and #name <= MAX_NAME, "bad city name")
		return name
	end),
})
