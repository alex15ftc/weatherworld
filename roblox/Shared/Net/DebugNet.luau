--!strict
-- The debug page's requests (DebugPageController -> ExploreService). Only players tagged
-- "Developer" may use them (everyone in Studio; the place's owner and Settings/Backend/Admins.toml
-- in live servers): checked on the server.
--   Teleport  client -> server (x, z) studs

local Shared = script.Parent.Parent
local Network = require(Shared.Network)

local function finite(n: unknown): boolean
	return type(n) == "number" and n == n and math.abs(n) < math.huge
end

return table.freeze({
	Teleport = Network.Event("Debug.Teleport", function(x: unknown, z: unknown): (number, number)
		assert(finite(x) and finite(z), "bad position")
		return x :: number, z :: number
	end),
})
