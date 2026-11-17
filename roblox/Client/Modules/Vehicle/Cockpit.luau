--!strict
-- Turns the cockpit pieces VehicleService rigged (Cockpit_SteeringWheel,
-- Cockpit_Tach, Cockpit_Fan Motor6Ds on PhysicsBody) from the chassis state.
-- Every pivot turns about its own local Z axis, the A-Chassis convention; +Z
-- points back at the driver, so a positive angle is anticlockwise as the
-- driver sees it.

local Cockpit = {}
Cockpit.__index = Cockpit

export type Settings = {
	SteeringRatio: number,
	TachMaxRpm: number,
	TachSweep: number,
	TachZero: number,
	FanRps: { number },
}

export type Cockpit = typeof(setmetatable(
	{} :: {
		settings: Settings,
		steering: Motor6D?,
		tach: Motor6D?,
		fan: Motor6D?,
		fanAngle: number,
		tachAngle: number,
	},
	Cockpit
))

function Cockpit.new(body: BasePart, settings: Settings?): Cockpit?
	if not settings then
		return nil
	end
	local function motor(name: string): Motor6D?
		local m = body:FindFirstChild("Cockpit_" .. name)
		return if m and m:IsA("Motor6D") then m else nil
	end
	local self = setmetatable({
		settings = settings,
		steering = motor("SteeringWheel"),
		tach = motor("Tach"),
		fan = motor("Fan"),
		fanAngle = 0,
		tachAngle = 0,
	}, Cockpit)
	if not (self.steering or self.tach or self.fan) then
		return nil
	end
	return self
end

-- steer: front-wheel angle in rad (+ = left); rpm: engine; throttle: 0..1
function Cockpit.render(self: Cockpit, dt: number, steer: number, rpm: number, throttle: number)
	local s = self.settings
	if self.steering then
		-- turning left winds the wheel anticlockwise
		self.steering.Transform = CFrame.Angles(0, 0, steer * s.SteeringRatio)
	end
	if self.tach then
		-- the needle sweeps clockwise; a little damping, like a real gauge
		local target = s.TachZero - math.clamp(rpm / s.TachMaxRpm, 0, 1.05) * s.TachSweep
		self.tachAngle += (target - self.tachAngle) * math.min(1, dt * 25)
		self.tach.Transform = CFrame.Angles(0, 0, self.tachAngle)
	end
	if self.fan then
		local rps = s.FanRps[1] + (s.FanRps[2] - s.FanRps[1]) * math.clamp(throttle, 0, 1)
		if rpm < 200 then
			rps = 0
		end
		self.fanAngle = (self.fanAngle + rps * 2 * math.pi * dt) % (2 * math.pi)
		self.fan.Transform = CFrame.Angles(0, 0, self.fanAngle)
	end
end

function Cockpit.destroy(self: Cockpit)
	for _, m in { self.steering, self.tach, self.fan } do
		if m then
			m.Transform = CFrame.identity
		end
	end
end

return Cockpit
