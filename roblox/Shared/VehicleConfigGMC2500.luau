--!strict
-- 2020 GMC Sierra 2500HD, crew cab, standard bed, 4x4, L5P Duramax (the "GMC2500" model). Same
-- layout and units as VehicleConfig (the Camaro ZL1); see that file for what each field means and
-- the tuning rules.
--
-- Published / typical: ~3,450 kg curb (+80 kg driver), 4.036 m (158.9") wheelbase,
-- 6.35 x 2.07 x 2.02 m, ~60/40 front/rear, independent torsion-bar front, solid rear axle on leaf
-- springs, LT275/65R18 tires, four-wheel discs with ABS, StabiliTrak, Allison 10L1000 10-speed
-- automatic, 3.42 rear, a two-speed transfer case (2.64:1 low).
--
-- The model's 17.21-stud wheelbase is the real 4.036 m at 0.2345 m/stud (its 26.3-stud length is
-- then the real 6.2 m and its 7.3-stud track 1.71 m). Its tires measure 3.49 studs tall (0.41 m
-- radius, an LT275/65R18).
--
-- Engine: the "DuramaxL5P" preset (445 hp, 910 lb ft), from the engine-sim script DMAX V8 (L5P).mr.

local Base = require(script.Parent.VehicleConfig)

-- corner sprung mass ~970 kg front / ~600 kg rear: ~1.3 Hz front, ~1.8 Hz rear (the empty bed)
local Config: Base.VehicleConfig = {
	MetersPerStud = 4.036 / 17.21,
	Mass = 3450 + 80,
	FrontWeight = 0.60,
	CgHeight = 0.85,
	Wheelbase = 4.036,

	BodyWidth = 2.07,
	BodyLength = 6.35,
	GroundClearance = 0.24,
	BeltlineHeight = 1.25,
	RoofHeight = 2.02,

	-- the front is driven through the transfer case (Drivetrain.TransferCase)
	Front = {
		Steered = true,
		Driven = false,
		SpringRate = 64700,
		BumpDamping = 4000,
		ReboundDamping = 7100,
		AntiRollRate = 30000,
		BumpStopRate = 9.0e6,
		BumpStopStart = 0.24,
		RollCenterHeight = 0.12,
		BrakeTorque = 3600,
		HandbrakeTorque = 0,
		StaticToe = 0,
	},
	Rear = {
		Steered = false,
		Driven = true,
		SpringRate = 76200,
		BumpDamping = 3400,
		ReboundDamping = 6000,
		AntiRollRate = 5000,
		BumpStopRate = 9.0e6,
		BumpStopStart = 0.24,
		RollCenterHeight = 0.50,
		BrakeTorque = 2600,
		HandbrakeTorque = 2500,
		StaticToe = 0,
	},

	-- LT275/65R18 all-terrain
	Tire = {
		Radius = 0.408,
		Width = 0.275,
		Inertia = 3.5,
		LongB = 10,
		LongC = 1.50,
		LongE = -0.2,
		LatB = 9,
		LatC = 1.40,
		LatE = -0.3,
		Mu = 0.85,
		NominalLoad = 8000,
		LoadSensitivity = 0.12,
		RollingResistance = 0.016,
	},

	SuspensionTravel = 0.30,
	RideCompression = 0.147,

	Steering = {
		MaxWheelAngle = math.rad(35),
		Ackermann = 0.85,
		Rate = math.rad(100),
		SlipLimit = 1.15,
		CounterSteer = 0.85,
		TimeToLock = 0.35,
		ReturnTime = 0.2,
	},

	Drivetrain = {
		EnginePreset = "DuramaxL5P",
		-- Allison 10L1000 10-speed automatic
		Gears = { 4.54, 2.87, 2.06, 1.72, 1.48, 1.26, 1.00, 0.85, 0.69, 0.63 },
		Reverse = 4.55,
		FinalDrive = 3.42,
		Efficiency = 0.85,
		ClutchMaxTorque = 2500,
		ShiftTime = 0.35,
		Differential = {
			Type = "Open",
			Preload = 0,
			PowerLock = 0,
			CoastLock = 0,
		},
		AutoClutchEngageRpm = 700,
		AutoUpshiftRpm = 3200, -- (under the 3,450 limit)
		AutoDownshiftRpm = 1300,
		-- a tight diesel converter: ~1,700 rpm stall on the L5P (its ~1,200 N m there), ~1.8:1;
		-- the Allison locks it up from 2nd
		TorqueConverter = {
			K = 49,
			OverrunK = 65,
			StallTorqueRatio = 1.8,
			CouplingPoint = 0.87,
			LockupGear = 2,
			LockupSpeed = 9,
			LockupThrottle = 0.7,
		},
		-- BorgWarner two-speed, part time: 2H, 4H (front and rear driveshafts locked) and 4L
		TransferCase = {
			LowRatio = 2.64,
			MaxShiftSpeed = 25,
			MaxLowShiftSpeed = 1.5,
		},
	},

	Aero = {
		DragArea = 0.50 * 3.6,
		LiftArea = 0.10,
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

	Cockpit = {
		SteeringRatio = 16,
		TachMaxRpm = 5000,
		TachSweep = math.rad(240),
		TachZero = 0,
		FanRps = { 0, 0 },
	},

	-- The model has no engine or exhaust parts, so both are placed from the centre of mass
	-- (2.42 m ahead of the rear axle, 0.85 m up).
	Sound = {
		-- one tip on the passenger side, behind the rear axle
		Exhaust = {
			{ Offset = Vector3.new(0.85, -0.45, -3.40) },
		},
		-- the turbo inlet on top of the engine, over the front axle
		Intake = {
			{ Offset = Vector3.new(0, 0.55, 1.50) },
		},
	},
}

return Config
