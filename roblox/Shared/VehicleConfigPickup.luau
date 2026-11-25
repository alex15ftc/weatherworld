--!strict
-- 1996 Chevrolet C1500 (GMT400), regular cab, short bed, 2WD, 5.7 V8: the pickup players drive
-- (the "Pickup" model, a 1998 Silverado 1500 body, the same truck). Same layout and units as
-- VehicleConfig (the Camaro ZL1); see that file for what each field means and the tuning rules.
--
-- Published / typical: ~1,860 kg curb (+80 kg driver), 2.985 m (117.5") wheelbase,
-- 4.93 x 1.95 x 1.80 m, ~57/43 front/rear empty, short/long-arm independent front on coils, solid
-- rear axle on leaf springs, P235/75R15 tires, front discs / rear drums with 4-wheel ABS, no
-- traction or stability control, 4L60-E 4-speed automatic, 3.42 open rear.
--
-- The model's 12.54-stud wheelbase is the real 2.985 m at 0.238 m/stud; its 6.7-stud track is
-- the real 1.63 m at the same scale (a regular cab short bed). Its tires measure 3.26 studs tall
-- (0.39 m radius, a little over a stock P235/75R15's 0.37 m).
--
-- Engine: the "VortecL31" preset (the L31 5.7 Vortec 350: 255 hp, 330 lb ft, fuel cut ~5,000).

local Base = require(script.Parent.VehicleConfig)

-- corner sprung mass ~500 kg front / ~350 kg rear (an empty bed): soft at the nose (~1.3 Hz),
-- stiff payload leaves at the back (~1.9 Hz), so the empty truck sits with a little rake
local Config: Base.VehicleConfig = {
	MetersPerStud = 2.985 / 12.54,
	Mass = 1860 + 80,
	FrontWeight = 0.57,
	CgHeight = 0.70,
	Wheelbase = 2.985,

	BodyWidth = 1.95,
	BodyLength = 4.93,
	GroundClearance = 0.20,
	BeltlineHeight = 1.10,
	RoofHeight = 1.80,

	Front = {
		Steered = true,
		Driven = false,
		SpringRate = 33400,
		BumpDamping = 2050,
		ReboundDamping = 3700,
		AntiRollRate = 20000,
		BumpStopRate = 7.0e6,
		BumpStopStart = 0.22,
		RollCenterHeight = 0.10,
		BrakeTorque = 2100,
		HandbrakeTorque = 0,
		StaticToe = 0,
	},
	Rear = {
		Steered = false,
		Driven = true,
		SpringRate = 49900,
		BumpDamping = 2100,
		ReboundDamping = 3750,
		-- no rear bar; the leaf pack's own twist
		AntiRollRate = 3000,
		BumpStopRate = 7.0e6,
		BumpStopStart = 0.22,
		-- leaf-sprung solid axle: a high roll centre
		RollCenterHeight = 0.45,
		BrakeTorque = 1100,
		HandbrakeTorque = 1500,
		StaticToe = 0,
	},

	-- P235/75R15 all-season
	Tire = {
		Radius = 0.385,
		Width = 0.235,
		Inertia = 2.0,
		LongB = 11,
		LongC = 1.50,
		LongE = -0.2,
		LatB = 9.5,
		LatC = 1.40,
		LatE = -0.3,
		Mu = 0.85,
		NominalLoad = 5500,
		LoadSensitivity = 0.12,
		RollingResistance = 0.015,
	},

	SuspensionTravel = 0.28,
	RideCompression = 0.15,

	-- recirculating ball: slow and a long way lock to lock
	Steering = {
		MaxWheelAngle = math.rad(37),
		Ackermann = 0.85,
		Rate = math.rad(100),
		SlipLimit = 1.15,
		CounterSteer = 0.85,
		TimeToLock = 0.35,
		ReturnTime = 0.2,
	},

	Drivetrain = {
		EnginePreset = "VortecL31",
		-- 4L60-E 4-speed automatic
		Gears = { 3.06, 1.63, 1.00, 0.70 },
		Reverse = 2.29,
		FinalDrive = 3.42,
		Efficiency = 0.86,
		ClutchMaxTorque = 800,
		ShiftTime = 0.35,
		Differential = {
			Type = "Open",
			Preload = 0,
			PowerLock = 0,
			CoastLock = 0,
		},
		AutoClutchEngageRpm = 1100,
		AutoUpshiftRpm = 4800,
		AutoDownshiftRpm = 1800,
		-- the 4L60-E's 298 mm converter: ~1,900 rpm stall on the L31 (its ~435 N m there),
		-- ~2:1 at stall; the converter clutch applies in 3rd and 4th from ~38 mph on a light foot
		TorqueConverter = {
			K = 91,
			OverrunK = 120,
			StallTorqueRatio = 2.0,
			CouplingPoint = 0.87,
			LockupGear = 3,
			LockupSpeed = 17,
			LockupThrottle = 0.5,
		},
		-- a K1500's NP241 part-time case (2.72:1 low), so the truck can go 4x4 as the owner asked
		-- (the C1500 itself is 2WD)
		TransferCase = {
			LowRatio = 2.72,
			MaxShiftSpeed = 25,
			MaxLowShiftSpeed = 1.5,
		},
	},

	Aero = {
		DragArea = 0.45 * 2.9,
		LiftArea = 0.10,
		AirDensity = 1.225,
	},

	Assists = {
		ABS = true,
		ABSSlip = 0.14,
		TCS = false,
		TCSSlip = 0.12,
		ESC = false,
		ESCSlip = math.rad(5),
	},

	Impacts = {
		WheelStrikeSpeed = 2.5,
		BendSpeed = 7.0,
		BendPerMps = math.rad(0.12),
		BodyImpactSpeed = 2.0,
	},

	-- The steering wheel turns on Misc/Wheel/W.
	Cockpit = {
		SteeringRatio = 16,
		TachMaxRpm = 6000,
		TachSweep = math.rad(240),
		TachZero = 0,
		FanRps = { 0, 0 },
	},

	-- The model has no engine or exhaust parts, so both are placed from the centre of mass
	-- (1.70 m ahead of the rear axle, 0.70 m up).
	Sound = {
		-- one turned-down tip on the passenger side, behind the rear axle under the bed
		Exhaust = {
			{ Offset = Vector3.new(0.75, -0.35, -2.60) },
		},
		-- the throttle body on top of the engine, over the front axle
		Intake = {
			{ Offset = Vector3.new(0, 0.45, 1.20) },
		},
	},
}

return Config
