--!strict

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Packages = ReplicatedStorage:WaitForChild("Packages")

local Network = require(Packages.network)

export type Class<T...> = Network.Class<T...>

return Network
