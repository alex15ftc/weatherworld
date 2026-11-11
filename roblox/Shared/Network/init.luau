--!strict

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Packages = ReplicatedStorage:WaitForChild("Packages")

local Network = require(Packages.network)
local Request = require(script.Request)

export type Class<T...> = Network.Class<T...>
export type Request = Request.Class

-- A validator for events the server sends: what comes from the server is trusted as it is.
-- (Never use it for events a client fires: validate those.)
local function fromServer(...: unknown): ...any
	return ...
end

return table.freeze({
	Event = Network.Event,
	ReliableEvent = Network.ReliableEvent,
	UnreliableEvent = Network.UnreliableEvent,
	Request = Request.new,
	FromServer = fromServer :: any, -- (any: the events it validates carry several message shapes)
})
