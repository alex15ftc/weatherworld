--!strict

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Packages = ReplicatedStorage:WaitForChild("Packages")

local Signal = require(Packages.Signal)

export type Connection = Signal.Connection
export type Signal<T...> = Signal.Signal<T...>
export type Typed<T...> = Signal.Signal<T...>
export type Generic = Signal.Signal<...any>

return Signal
