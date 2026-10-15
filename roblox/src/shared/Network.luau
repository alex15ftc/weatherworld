--!strict
-- Typed, validated remotes (maximumadhd/network, as in the Roblox boilerplate). Declare an event
-- once in a shared module with a validator; the validator runs on whatever the other side sends,
-- so treat everything from a client as untrusted.
--
--   local Ping = Network.Event("Ping", function(n: unknown): number
--       assert(type(n) == "number")
--       return n
--   end)
--   Ping:Server():On(function(player, n) ... end) -- server
--   Ping:Client():Fire(1) -- client

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Packages = ReplicatedStorage:WaitForChild("Packages")

local Network = require(Packages.network)

export type Class<T...> = Network.Class<T...>

return Network
