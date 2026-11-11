--!strict

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Packages = ReplicatedStorage:WaitForChild("Packages")

local Trove = require(Packages.Trove)

export type Trove = Trove.Trove
export type Class = Trove.Trove
export type Trackable = Trove.Trackable

return Trove
