--!strict
-- Ford Crown Victoria (P71 Police Interceptor, 2011) (the "Crown Vic" model in Workspace).
-- Same layout and units as VehicleConfig (the Camaro ZL1); see that file for what each field
-- means and the tuning rules.
--
-- Published / typical: ~1,870 kg (+80 kg driver), 2.91 m wheelbase, 5.39 x 1.98 x 1.47 m,
-- ~55/45 front/rear, body-on-frame with a solid rear axle, P225/60R17 tires, 4R75E 4-speed
-- automatic, 3.27 final drive.
--
-- The model's 11.23-stud wheelbase is the real 2.91 m at 0.259 m/stud. Its tires measure
-- 2.83 studs tall (~0.37 m radius).
--
-- Engine: the "Ford46" preset (4.6 2V Modular V8), ported from the engine-sim script fordv8.mr.

local Base = require(script.Parent.VehicleConfig)

-- corner sprung mass ~491 kg front / ~384 kg rear; soft, ~1.3 Hz front, ~1.4 Hz rear
local Config: Base.VehicleConfig = {
	MetersPerStud = 2.91 / 11.23,
	Mass = 1870 + 80,
	FrontWeight = 0.55,
	CgHeight = 0.56,
	Wheelbase = 2.91,

	BodyWidth = 1.98,
	BodyLength = 5.39,
	GroundClearance = 0.15,
	BeltlineHeight = 0.95,
	RoofHeight = 1.47,

	Front = {
		Steered = true,
		Driven = false,
		SpringRate = 32750,
		BumpDamping = 2400,
		ReboundDamping = 4400,
		AntiRollRate = 15000,
		BumpStopRate = 7.0e6,
		BumpStopStart = 0.18,
		RollCenterHeight = 0.08,
		BrakeTorque = 2000,
		HandbrakeTorque = 0,
		StaticToe = 0,
	},
	Rear = {
		Steered = false,
		Driven = true,
		SpringRate = 29700,
		BumpDamping = 2000,
		ReboundDamping = 3700,
		AntiRollRate = 8000,
		BumpStopRate = 7.0e6,
		BumpStopStart = 0.18,
		-- Watt's-link solid axle
		RollCenterHeight = 0.30,
		BrakeTorque = 1100,
		HandbrakeTorque = 1500,
		StaticToe = 0,
	},

	-- P225/60R17 all-season
	Tire = {
		Radius = 0.36,
		Width = 0.225,
		Inertia = 1.4,
		LongB = 12,
		LongC = 1.50,
		LongE = -0.2,
		LatB = 11,
		LatC = 1.40,
		LatE = -0.3,
		Mu = 0.90,
		NominalLoad = 4800,
		LoadSensitivity = 0.12,
		RollingResistance = 0.013,
	},

	SuspensionTravel = 0.24,
	RideCompression = 0.147,

	Steering = {
		MaxWheelAngle = math.rad(38),
		Ackermann = 0.85,
		Rate = math.rad(120),
		SlipLimit = 1.15,
		CounterSteer = 0.9,
		TimeToLock = 0.3,
		ReturnTime = 0.18,
	},

	Drivetrain = {
		EnginePreset = "Ford46",
		-- 4R75E 4-speed automatic
		Gears = { 2.84, 1.55, 1.00, 0.70 },
		Reverse = 2.33,
		FinalDrive = 3.27,
		Efficiency = 0.88,
		ClutchMaxTorque = 800,
		ShiftTime = 0.3,
		Differential = {
			Type = "Open",
			Preload = 0,
			PowerLock = 0,
			CoastLock = 0,
		},
		AutoClutchEngageRpm = 1200,
		AutoUpshiftRpm = 5400, -- (just under the 5,600 rev limit, so the box shifts before the cut)
		AutoDownshiftRpm = 2000,
		-- the 4R75E's converter: ~2,100 rpm stall on the 4.6 (its ~375 N m there), ~1.9:1 at
		-- stall; lockup in 3rd and 4th from ~38 mph on a light foot
		TorqueConverter = {
			K = 108,
			OverrunK = 140,
			StallTorqueRatio = 1.9,
			CouplingPoint = 0.87,
			LockupGear = 3,
			LockupSpeed = 17,
			LockupThrottle = 0.5,
		},
	},

	Aero = {
		DragArea = 0.34 * 2.4,
		LiftArea = 0.05,
		AirDensity = 1.225,
	},

	Assists = {
		ABS = true,
		ABSSlip = 0.14,
		TCS = true,
		TCSSlip = 0.12,
		ESC = true,
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
		SteeringRatio = 17,
		TachMaxRpm = 6000,
		TachSweep = math.rad(240),
		TachZero = 0,
		FanRps = { 0, 0 },
	},

	Sound = {
		-- dual tips, one each side under the rear bumper (the model has no exhaust parts)
		Exhaust = {
			{ Offset = Vector3.new(-0.62, -0.26, -2.95) },
			{ Offset = Vector3.new(0.62, -0.26, -2.95) },
		},
		Intake = {
			{ Part = "Body/Model/Engine", Offset = Vector3.new(0, 0.2, 0) },
		},
	},
}

return Config
