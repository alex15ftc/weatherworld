--!strict
-- What the local player is driving right now, for whatever shows it (Effects, the CarHud
-- widget). VehicleController sets it.

local Physics = require(script.Parent.Physics)

local Session = {
	Sim = nil :: Physics.Sim?, -- the car's running physics while the local player drives it
}

return Session
