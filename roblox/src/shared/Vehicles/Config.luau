--!strict
-- Tuning for the chase car: the raycast-wheel rally chassis from Rally With Your Friends
-- (RacePlace/Shared/Rally/Config), at this world's size.
--
-- The rally car was tuned at 0.225 m a stud. Objects here are true size at about 0.3 m a stud
-- (12-stud lanes, 8-stud doors), so every length, speed and acceleration below is the rally
-- value times SCALE; angles, spring frequency and damping ratios carry over unchanged. Only
-- the engine is stronger than a straight scale: flat out on the flat it reaches about
-- 185 studs/s, above the 170 studs/s highway chase speed (World/Config TEST_SPEED_STUDS).
--
-- The car's origin sits on the ground midway between the axles, and forward is -Z.

local Config = {}

Config.SCALE = 0.225 / 0.3
local S = Config.SCALE

-- Engine power on top of the straight scale. Top speed is (PowerAccel / DragCoefficient)^(1/3),
-- so power x1.6 lifts it from 160 to about 187 studs/s.
local POWER = 1.6
local TOP_SPEED_GAIN = POWER ^ (1 / 3)

-- Gravity the car feels: real gravity at 0.3 m a stud. The world keeps Roblox's default for
-- characters; the car cancels the difference itself.
Config.CAR_GRAVITY = 45 * S

Config.METERS_PER_STUD = 0.3
Config.STUDS_TO_MPH = Config.METERS_PER_STUD * 3.6 * 0.621371

-- How close you must be to your car to get in (studs), and how slow it must be going to get out.
Config.ENTER_DISTANCE = 40
Config.EXIT_SPEED = 12
-- Seconds between car requests from one player.
Config.SPAWN_COOLDOWN = 2

-- Engine note (the rally car's sample, recorded at ENGINE_SOUND_RPM). It only plays if the audio
-- asset is shared with this experience; set it to "" for a silent car.
Config.ENGINE_SOUND = "rbxassetid://90180882559925"
Config.ENGINE_SOUND_RPM = 4000

export type WheelSpec = {
	Name: string,
	Position: Vector3, -- wheel centre at rest, relative to the car's origin
	Front: boolean,
	Left: boolean,
}

local TRACK = 3.145 * S
local HALF_BASE = 5.788 * S
local WHEEL_Y = 1.4525 * S

-- PowerAccel, MaxDriveAccel, BrakeAccel, AntiRoll, DampingRatio, LateralFalloff and SteerRate
-- are the rally car before fitted parts (its Config.Car), which is how it drives here.
Config.Car = table.freeze({
	WheelRadius = WHEEL_Y,

	Wheels = table.freeze({
		table.freeze({ Name = "FL", Position = Vector3.new(-TRACK, WHEEL_Y, -HALF_BASE), Front = true, Left = true }),
		table.freeze({ Name = "FR", Position = Vector3.new(TRACK, WHEEL_Y, -HALF_BASE), Front = true, Left = false }),
		table.freeze({ Name = "RL", Position = Vector3.new(-TRACK, WHEEL_Y, HALF_BASE), Front = false, Left = true }),
		table.freeze({ Name = "RR", Position = Vector3.new(TRACK, WHEEL_Y, HALF_BASE), Front = false, Left = false }),
	} :: { WheelSpec }),

	Wheelbase = HALF_BASE * 2,

	-- Collision hulls, relative to the car origin.
	ChassisSize = Vector3.new(6.6, 2.25, 16.4) * S,
	ChassisOffset = Vector3.new(0, 2.08, -0.15) * S,
	RoofSize = Vector3.new(5.4, 2.6, 8) * S,
	RoofOffset = Vector3.new(0, 4.6, 1.0) * S,
	-- The rally chassis's density, raised so the scaled-down box keeps the rally car's mass and
	-- a seated character weighs the same against it.
	ChassisDensity = 0.8 / S ^ 3,

	-- Seats. Left-hand drive; the passenger sits on the right.
	DriverSeat = Vector3.new(-1.37, 1.95, 0.72) * S,
	PassengerSeat = Vector3.new(1.37, 1.95, 0.72) * S,

	-- Suspension (frequency-based, so it does not care about mass units)
	RestLength = 1.15 * S, -- mount to wheel centre at full droop
	MaxCompression = 0.92 * S,
	SpringHz = 1.7,
	DampingRatio = 0.55,
	BumpStopStiffness = 12, -- multiplier on the spring past MaxCompression
	AntiRoll = 0.45, -- fraction of spring rate shared across an axle

	-- Tyres
	TireGrip = 1.15,
	LateralPeakSlip = math.rad(9),
	LateralFalloff = 0.78, -- grip left once fully sliding
	LowSpeedStabilize = 4 * S, -- below this speed, kill sideways creep directly
	RollingResistance = 0.35 * S,

	-- Engine and drivetrain (accelerations, studs/s²)
	MaxDriveAccel = 30 * S,
	PowerAccel = 2000 * S * S * POWER, -- power / mass: accel = min(MaxDriveAccel, PowerAccel / speed)
	DragCoefficient = 0.000205 / S,
	Downforce = 0.0004 / S,
	FrontDriveShare = 0.4,
	ReverseAccel = 14 * S,
	MaxReverseSpeed = 32 * S,
	BrakeAccel = 60 * S,
	FrontBrakeShare = 0.62,
	EngineBrake = 2.5 * S,

	-- Handbrake
	HandbrakeRearGrip = 0.38,
	HandbrakeLock = 0.85,

	-- Steering
	MaxSteer = math.rad(33),
	HighSpeedSteer = math.rad(10), -- assisted lock at HighSpeed
	HighSpeed = 190 * S * TOP_SPEED_GAIN,
	SteerRate = 4.2, -- rad/s when turning in (keyboard / buttons)
	SteerReturnRate = 6.5,
	CounterSteerAssist = 0.55, -- keyboard and gamepad only

	-- Air
	AirAngularDamping = 1.6,
	AirYawDamping = 0.4,

	-- Gearbox (only drives the sound; power delivery is continuous)
	GearTopSpeeds = table.freeze({
		42 * S * TOP_SPEED_GAIN,
		72 * S * TOP_SPEED_GAIN,
		104 * S * TOP_SPEED_GAIN,
		140 * S * TOP_SPEED_GAIN,
		178 * S * TOP_SPEED_GAIN,
		225 * S * TOP_SPEED_GAIN,
	}),
	IdleRPM = 1100,
	RedlineRPM = 7600,
	LaunchRPM = 6000, -- handbrake limiter
	LimiterDropRPM = 450,
	LimiterFallRate = 6000, -- RPM/s while fuel is cut
	LimiterRiseRate = 8000, -- RPM/s as fuel returns
	ShiftTime = 0.12,
})

-- Grip of each terrain material, multiplied with TireGrip, for this map's surfaces
-- (server/Explore colours them).
Config.SurfaceGrip = table.freeze({
	[Enum.Material.Asphalt] = 1.25,
	[Enum.Material.Pavement] = 1.2,
	[Enum.Material.Concrete] = 1.2,
	[Enum.Material.Limestone] = 0.95, -- gravel roads
	[Enum.Material.Mud] = 0.88, -- dirt roads, river and lake beds
	[Enum.Material.Ground] = 0.85, -- worked fields
	[Enum.Material.Rock] = 0.95,
	[Enum.Material.Sandstone] = 0.8, -- wheat and stubble
	[Enum.Material.Salt] = 0.8, -- red soil of the Red Hills
	[Enum.Material.Grass] = 0.72, -- prairie and pasture
	[Enum.Material.LeafyGrass] = 0.68, -- crops in leaf, tallgrass
	[Enum.Material.Sand] = 0.6, -- sandhill blowouts
} :: { [Enum.Material]: number })

Config.DefaultSurfaceGrip = 1.0

-- How much dust each surface throws up behind a wheel.
Config.Dustiness = table.freeze({
	[Enum.Material.Limestone] = 1,
	[Enum.Material.Mud] = 0.8,
	[Enum.Material.Ground] = 1,
	[Enum.Material.Sand] = 1.2,
	[Enum.Material.Salt] = 0.9,
	[Enum.Material.Sandstone] = 0.5,
	[Enum.Material.Grass] = 0.25,
	[Enum.Material.LeafyGrass] = 0.25,
	[Enum.Material.Rock] = 0.15,
} :: { [Enum.Material]: number })

-- One fuel-cut cycle of the rev limiter, shared by the physics and the engine note of cars seen
-- from outside. Hysteresis lets RPM fall before fuel returns, rather than sticking at the cap.
function Config.stepRPM(rpm: number, target: number, limit: number, cut: boolean, powered: boolean, dt: number): (number, boolean)
	local car = Config.Car
	dt = math.clamp(dt, 0, 1 / 20)
	target = math.clamp(target, car.IdleRPM, limit)
	if not powered or target < limit then
		return math.min(limit, rpm + (target - rpm) * math.min(1, dt * 12)), false
	end

	local floorRPM = limit - car.LimiterDropRPM
	if cut and rpm > floorRPM then
		rpm = math.max(floorRPM, math.min(rpm, limit) - car.LimiterFallRate * dt)
		return rpm, rpm > floorRPM
	end

	if rpm < floorRPM then
		rpm += (target - rpm) * math.min(1, dt * 12)
	else
		rpm += car.LimiterRiseRate * dt
	end
	rpm = math.min(rpm, limit)
	return rpm, rpm >= limit
end

return table.freeze(Config)
