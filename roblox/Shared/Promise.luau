--!strict

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Packages = ReplicatedStorage:WaitForChild("Packages")

local Promise = require(Packages["promise-typed"])

export type Class = Promise.Class
export type Status = Promise.Status

return Promise
