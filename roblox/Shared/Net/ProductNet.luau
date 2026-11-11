--!strict
-- The weather products (ProductFeedService -> Modules/Products/ProductClient).
--   Get       request (id, haveVersion?) -> { version, text? } | nil  (text left out when the
--             player already has that version)
--   Manifest  request () -> { [id]: version }
--   Changed   server -> client { [id]: version | false } (false: gone)

local Shared = script.Parent.Parent
local Network = require(Shared.Network)

local MAX_ID = 80

return table.freeze({
	Get = Network.Request("Products.Get", function(id: unknown, haveVersion: unknown): (string, string?)
		assert(type(id) == "string" and #id <= MAX_ID, "bad product id")
		assert(haveVersion == nil or (type(haveVersion) == "string" and #haveVersion <= 128), "bad version")
		return id, haveVersion :: string?
	end),
	Manifest = Network.Request("Products.Manifest", function()
		return
	end),
	Changed = Network.Event("Products.Changed", Network.FromServer),
})
