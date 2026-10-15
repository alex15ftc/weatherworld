--!strict
-- Remotes for the chase car (VehicleService, VehicleController). Replies come back as chat
-- lines (Shared/System).

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Network = require(ReplicatedStorage.Shared.Network)

local Net = {}

-- What a player asks of their own car:
--   "spawn"  a new car on the ground ahead of them, with them in the driver's seat
--   "enter"  back into the driver's seat of their car, if they are near it
--   "exit"   out of the car, once it has nearly stopped (it stays parked where it is)
--   "remove" their car taken away
export type Action = "spawn" | "enter" | "exit" | "remove"

local ACTIONS = { spawn = true, enter = true, exit = true, remove = true }

Net.Car = Network.Event("Vehicles_Car", function(action: unknown): Action
	assert(type(action) == "string" and ACTIONS[action], "bad car action")
	return action :: Action
end)

return Net
