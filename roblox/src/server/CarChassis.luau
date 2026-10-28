-- The car template's Chassis module with its speed fixed (PlayerCars puts this in the template's
-- Scripts as "Chassis" and renames the original "ChassisBase"). The original sets the wheel motors'
-- spin to the car's target speed in studs/s as if it were rad/s, so the car tops out at MaxSpeed x
-- the wheel radius (1.5x on this car). Here every motor target is turned from studs/s at the tyre
-- into rad/s, so MaxSpeed (mph) is the top speed.
local Chassis = require(script.Parent:WaitForChild("ChassisBase"))

local suspension = Chassis.root:FindFirstChild("SuspensionFL")
local radius = if suspension and suspension:FindFirstChild("Wheel") then suspension.Wheel.Size.Y / 2 else 1

local setBase = Chassis.SetMotorVelocity
Chassis.SetMotorVelocity = function(vel)
	setBase(vel / radius)
end

return Chassis
