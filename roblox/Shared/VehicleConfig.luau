--!strict
-- Vehicle definition, in SI units (m, kg, N, N m, rad/s) unless a name says studs.
--
-- Baseline: 6th-gen Chevrolet Camaro ZL1 (the "Chevy Camaro ZL1" model in
-- Workspace). Published / typical figures:
--   curb mass ~1760 kg, ~52/48 front/rear, wheelbase 2.81 m
--   285/30R20 front, 305/30R20 rear (radius ~0.34 m), Brembo 6-pot front brakes
--   TR6060 6-speed manual, 3.73 final drive, limited-slip rear diff
--   ~1.1 g on its 200-treadwear tires
-- The hub positions, wheelbase and track come from the model itself; the
-- model is built at 0.25 m per stud (its 11.2-stud wheelbase is 2.80 m).
--
-- Engine: the "LT4" preset, built from the engine-sim LT4 script plus a
-- simulated Eaton R1740 Roots supercharger. On the model's dyno it makes ~830
-- N m flat from 2,000-6,000 rpm and ~700 hp at 6,000 (published: 881 N m,
-- 650 hp @ 6,400), with 5-10 psi of boost.
--
-- Tuning rules used here:
--   * spring rates give ~1.75 Hz ride frequency with ~80 mm static sag
--   * dampers sit near 30% (bump) / 55% (rebound) of critical
--   * the tire curve peaks at ~10% slip ratio and ~8 degrees slip angle and
--     keeps ~70-85% of peak grip when fully sliding
--   * brakes can lock the wheels; the ~65/35 bias locks the fronts first
--
-- Both the server (to rig the model) and the client (to simulate it) read this.

export type AxleConfig = {
	Steered: boolean,
	Driven: boolean,
	SpringRate: number, -- N/m, at the wheel
	BumpDamping: number, -- N s/m
	ReboundDamping: number, -- N s/m
	AntiRollRate: number, -- N/m of left-right travel difference, at the wheel
	BumpStopRate: number, -- N/m^2, progressive (force = k * x^2 past the stop)
	BumpStopStart: number, -- m of compression where the stop starts
	RollCenterHeight: number, -- m above the contact patch where tire forces act
	BrakeTorque: number, -- N m per wheel at full pedal
	HandbrakeTorque: number, -- N m per wheel
	StaticToe: number, -- rad, + = toe-in
}

export type TireConfig = {
	Radius: number,
	Width: number, -- m (tread width, for tire marks)
	Inertia: number, -- kg m^2, wheel + tire + rotor + share of the halfshaft
	-- Pacejka "Magic Formula" coefficients (B stiffness, C shape, E curvature)
	LongB: number,
	LongC: number,
	LongE: number,
	LatB: number,
	LatC: number,
	LatE: number,
	Mu: number, -- peak friction on dry asphalt at the nominal load
	NominalLoad: number, -- N
	LoadSensitivity: number, -- friction lost per unit of (Fz / NominalLoad - 1)
	RollingResistance: number, -- coefficient
}

-- One place on the car that a sound plays from.
export type SoundEmitterSpec = {
	-- A part in the car model, as a path of names ("Body/Exhaust/Backfire1";
	-- the last names are enough, matched from the bottom up). Leave it out to
	-- measure from the car's centre of mass.
	Part: string?,
	-- m in the car's frame: X right, Y up, Z forward, from that part (or the CG)
	Offset: Vector3?,
}

-- Where the car's sounds come from. VehicleService puts an Attachment at each
-- spot (tagged with a SoundSource attribute) and the client plays the matching
-- stream there through an AudioEmitter:
--   Exhaust  the exhaust stream (every exhaust system, after the convolution
--            with the exhaust impulse response), split evenly over the outlets
--   Intake   the intake stream: induction pulses at the throttle body, plus the
--            supercharger whine on a supercharged engine
--   Tires    each wheel's tire noise (rolling roar, squeal, scrub) always plays
--            from its own wheel hub, so it needs no entry
export type SoundConfig = {
	Exhaust: { SoundEmitterSpec },
	Intake: { SoundEmitterSpec },
}

export type VehicleConfig = {
	MetersPerStud: number,
	Mass: number,
	FrontWeight: number, -- static fraction of weight on the front axle
	CgHeight: number, -- m above ground at ride height
	-- Reference geometry (the rig measures the real values from the model;
	-- these are used by the offline tests)
	Wheelbase: number,
	-- Physics collision volumes (invisible), in m
	BodyWidth: number,
	BodyLength: number,
	GroundClearance: number,
	BeltlineHeight: number,
	RoofHeight: number,
	Front: AxleConfig,
	Rear: AxleConfig,
	Tire: TireConfig,
	SuspensionTravel: number, -- m, full droop to full bump
	RideCompression: number, -- m, compression at static ride height
	Steering: {
		MaxWheelAngle: number, -- rad, inside wheel at full lock
		Ackermann: number, -- 0 = parallel, 1 = true Ackermann
		Rate: number, -- rad/s of wheel angle (rack speed)
		-- Input shaping for keys and sticks (Client/Modules/Vehicle/Handling):
		SlipLimit: number, -- front slip angle on offer, as a multiple of the tire's peak slip angle
		CounterSteer: number, -- 0..1, how far the wheels caster into a slide on their own
		TimeToLock: number, -- s for a held key to reach the lock on offer
		ReturnTime: number, -- s to unwind it
	},
	Drivetrain: {
		EnginePreset: string,
		Gears: { number }, -- forward ratios
		Reverse: number,
		FinalDrive: number,
		Efficiency: number,
		ClutchMaxTorque: number, -- N m
		ShiftTime: number, -- s with the clutch open during a shift
		Differential: {
			Type: "Open" | "LSD" | "Locked",
			Preload: number, -- N m
			PowerLock: number, -- fraction of input torque that can lock (on power)
			CoastLock: number, -- (on overrun)
		},
		AutoClutchEngageRpm: number, -- above idle, rpm at which the launch clutch is fully in
		AutoUpshiftRpm: number,
		AutoDownshiftRpm: number,
		-- A torque converter for Automatic (Client/Modules/Vehicle/Drivetrain); leave it out for an
		-- automatic clutch. Sequential and Manual always use the clutch.
		TorqueConverter: {
			K: number, -- capacity factor, rpm / sqrt(N m): the pump absorbs (rpm / K)^2 N m
			OverrunK: number, -- the same with the wheels driving (larger = a weaker coupling)
			StallTorqueRatio: number, -- turbine / pump torque with the turbine held still
			CouplingPoint: number, -- turbine / pump speed where the multiplication ends
			LockupGear: number, -- lowest gear the lockup clutch closes in
			LockupSpeed: number, -- m/s of road speed above which it may close
			LockupThrottle: number, -- 0..1, it opens above this pedal
		}?,
		-- A part-time transfer case: 2H drives the Driven axle, 4H and 4L the other one too (its
		-- driveshaft locked to the Driven axle's). Leave it out for a car with one driven axle.
		TransferCase: {
			LowRatio: number, -- 4L's reduction
			MaxShiftSpeed: number, -- m/s, fastest 2H <-> 4H change
			MaxLowShiftSpeed: number, -- m/s, fastest change into or out of 4L
		}?,
	},
	Aero: {
		DragArea: number, -- Cd * A, m^2
		LiftArea: number, -- Cl * A, m^2 (negative = downforce)
		AirDensity: number,
	},
	Assists: {
		ABS: boolean,
		ABSSlip: number, -- slip ratio where ABS releases
		TCS: boolean,
		TCSSlip: number, -- driven-wheel slip ratio where traction control cuts torque
		ESC: boolean, -- stability control (T switches it off together with TCS)
		ESCSlip: number, -- rad of sideslip past the tire's peak slip angle before it steps in
	},
	-- Collision summary reactions
	Impacts: {
		WheelStrikeSpeed: number, -- m/s closing speed for a steering kick
		BendSpeed: number, -- m/s closing speed above which toe is bent
		BendPerMps: number, -- rad of toe per m/s above BendSpeed
		BodyImpactSpeed: number, -- m/s for a body impact event
	},
	-- optional cockpit animation for A-Chassis "Misc" parts (steering wheel W,
	-- tach needle M, fan M), all turning about their pivot's local Z axis
	Cockpit: {
		SteeringRatio: number,
		TachMaxRpm: number,
		TachSweep: number, -- rad of needle travel from 0 to TachMaxRpm
		TachZero: number, -- rad offset of the needle at 0 rpm
		FanRps: { number }, -- {idle, full throttle} revolutions per second
	}?,
	Sound: SoundConfig,
}

local Config: VehicleConfig = {
	MetersPerStud = 0.25,
	Mass = 1760,
	FrontWeight = 0.52,
	CgHeight = 0.48,
	Wheelbase = 2.81,

	BodyWidth = 1.88,
	BodyLength = 4.70,
	GroundClearance = 0.12,
	BeltlineHeight = 0.88,
	RoofHeight = 1.32,

	-- corner sprung mass ~458 kg front / ~422 kg rear
	Front = {
		Steered = true,
		Driven = false,
		SpringRate = 55000,
		BumpDamping = 3000,
		ReboundDamping = 5500,
		AntiRollRate = 30000,
		BumpStopRate = 8.0e6,
		BumpStopStart = 0.15,
		RollCenterHeight = 0.06,
		BrakeTorque = 3000,
		HandbrakeTorque = 0,
		StaticToe = 0,
	},
	Rear = {
		Steered = false,
		Driven = true,
		SpringRate = 50000,
		BumpDamping = 2750,
		ReboundDamping = 5050,
		AntiRollRate = 15000,
		BumpStopRate = 8.0e6,
		BumpStopStart = 0.15,
		RollCenterHeight = 0.10,
		BrakeTorque = 1600,
		HandbrakeTorque = 2000,
		StaticToe = math.rad(0.15),
	},

	-- 285/30R20 (the model's tire mesh measures 0.339 m)
	Tire = {
		Radius = 0.339,
		Width = 0.285,
		Inertia = 1.5,
		LongB = 14,
		LongC = 1.50,
		LongE = -0.2,
		LatB = 14,
		LatC = 1.40,
		LatE = -0.3,
		Mu = 1.15,
		NominalLoad = 4500,
		LoadSensitivity = 0.10,
		RollingResistance = 0.012,
	},

	SuspensionTravel = 0.19,
	RideCompression = 0.082,

	Steering = {
		MaxWheelAngle = math.rad(35),
		Ackermann = 0.85,
		Rate = math.rad(140),
		SlipLimit = 1.15,
		CounterSteer = 0.9,
		TimeToLock = 0.25,
		ReturnTime = 0.16,
	},

	Drivetrain = {
		EnginePreset = "LT4",
		Gears = { 2.66, 1.78, 1.30, 1.00, 0.74, 0.50 },
		Reverse = 2.90,
		FinalDrive = 3.73,
		Efficiency = 0.92,
		ClutchMaxTorque = 900,
		ShiftTime = 0.18,
		Differential = {
			Type = "LSD",
			Preload = 80,
			PowerLock = 0.35,
			CoastLock = 0.15,
		},
		AutoClutchEngageRpm = 1400,
		AutoUpshiftRpm = 6200,
		AutoDownshiftRpm = 2200,
	},

	Aero = {
		DragArea = 0.35 * 2.2,
		LiftArea = -0.12,
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

	-- The model has no gauges or fan to turn, only the steering wheel (Misc/Wheel/W).
	-- ZL1 rack: about 15:1.
	Cockpit = {
		SteeringRatio = 15,
		TachMaxRpm = 8000,
		TachSweep = math.rad(240),
		TachZero = 0,
		FanRps = { 0, 0 },
	},

	Sound = {
		-- quad tips, two each side of the rear diffuser (the model's Backfire parts)
		Exhaust = {
			{ Part = "Body/Exhaust/Backfire1" },
			{ Part = "Body/Exhaust/Backfire3" },
			{ Part = "Body/Exhaust/Backfire4" },
			{ Part = "Body/Exhaust/Backfire2" },
		},
		-- the Eaton blower and its throttle body sit on top of the LT4, at the
		-- front of the engine (the model's engine mesh covers the whole bay)
		Intake = {
			{ Part = "Body/Model/Engine", Offset = Vector3.new(0, 0.3, 0.6) },
		},
	},
}

return Config
