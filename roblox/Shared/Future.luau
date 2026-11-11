--!strict

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Packages = ReplicatedStorage:WaitForChild("Packages")

local Future = require(Packages.Future)

export type Future<T...> = Future.Future<T...>
export type Class<T...> = Future.Future<T...>

return Future
