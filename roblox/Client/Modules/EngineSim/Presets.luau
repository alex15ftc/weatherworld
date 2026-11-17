--!strict
-- Engine definitions. Audio-related values (exhaust lengths, audio_volume,
-- primary lengths, sound_attenuation, firing order, hf_gain/noise/jitter,
-- simulation_frequency, impulse responses) are copied from engine-sim's
-- assets/engines scripts. Geometry and valve timing feed the simplified
-- engine model in EngineModel.luau.

local Blower = require(script.Parent.Blower)

local INCH = 0.0254
local CM = 0.01
local MM = 0.001
local CC = 1e-6
local LB_FT = 1.35582

export type CylinderDef = {
    Bank: number,
    FiringAngle: number, -- crank degrees within the 720-degree cycle
    ExhaustSystem: number, -- 1-based exhaust system index
    PrimaryLength: number, -- m (header primary)
    SoundAttenuation: number,
    -- optional, set by the machine shop (Machining/EngineBuild): this
    -- cylinder's port flow against the preset's valve areas, and the share of
    -- its burn the rings and gasket hold in (default 1 each)
    IntakeFlow: number?,
    ExhaustFlow: number?,
    Seal: number?,
}

export type ExhaustSystemDef = {
    Length: number, -- m
    AudioVolume: number,
    ImpulseResponse: string,
}

export type CamProfile = {
    Name: string,
    Specs: string,
    IntakeOpen: number,
    IntakeClose: number,
    ExhaustOpen: number,
    ExhaustClose: number,
    IntakeLiftScale: number,
    ExhaustLiftScale: number,
    Redline: number?, -- simulated limit with the supporting valvetrain for this cam
    IdleThrottle: number?,
    IdleAirGain: number?,
    IdleDilution: { number }?, -- fresh-charge range over which light-load burns become stable
    -- replaces the preset's GasModel while this cam is fitted (the preset
    -- must have one), so a big cam's idle can misfire where stock does not
    GasModel: GasModelDef?,
}

export type EnginePreset = {
    Name: string,
    -- synthesizer
    SimulationFrequency: number,
    HfGain: number,
    Noise: number,
    Jitter: number,
    -- geometry (piston engines; a rotary sets Rotary instead)
    Bore: number?,
    Stroke: number?,
    RodLength: number?,
    CompressionRatio: number,
    -- valve events, degrees in the 720 cycle (0 = TDC at start of intake stroke)
    IntakeOpen: number?,
    IntakeClose: number?,
    ExhaustOpen: number?,
    ExhaustClose: number?,
    IntakeValveArea: number?, -- m^2 at full lift
    ExhaustValveArea: number?,
    CamOptions: { CamProfile }?, -- fixed-timing alternatives to the base cam
    DefaultCamIndex: number?, -- index into CamOptions, zero selects the base cam
    -- Wankel engine: Cylinders are its rotors (FiringAngle = shaft degrees at
    -- which the rotor's first face is at TDC) and RotaryEngineModel runs it
    Rotary: RotaryDef?,
    RunnerVolume: number, -- m^3 (exhaust runner, primary added per cylinder)
    RunnerArea: number, -- m^2
    PlenumVolume: number,
    -- optional: m^2 of leak between the plenum and the atmosphere (a vacuum
    -- leak off boost, a boost leak on it)
    PlenumLeakArea: number?,
    ThrottleArea: number, -- m^2 wide open
    IdleThrottle: number, -- 0..1 idle bypass fraction
    -- optional: idle air control gain (throttle fraction per unit of rpm
    -- deficit below IdleRpm, default 0.08); lower stops the idle hunting
    IdleAirGain: number?,
    ThrottleGamma: number,
    SparkAdvance: number, -- degrees BTDC
    BurnDuration: number, -- degrees
    Inertia: number, -- kg m^2
    FrictionTorque: number, -- N m static
    FrictionViscous: number, -- N m per rad/s
    StarterTorque: number,
    StarterSpeed: number, -- rpm
    IdleRpm: number,
    Redline: number,
    RevLimiterDuration: number, -- s
    Cylinders: { CylinderDef },
    ExhaustSystems: { ExhaustSystemDef },
    -- optional: peak combustion pressure rise multiplier (default 2.9). Calibrates
    -- the lumped model's torque per unit of trapped charge to a real engine.
    CombustionGain: number?,
    -- optional: charge multiplier vs rpm, { {rpm, factor}, ... }. Stands in for
    -- the intake/exhaust wave tuning the lumped model doesn't simulate.
    ChargeCurve: { { number } }?,
    BoostChargeCurve: { { number } }?, -- added charge at full throttle vs rpm
    -- optional: charge multiplier vs rpm for the base cam only (not CamOptions)
    BaseCamChargeCurve: { { number } }?,
    TrackFreshCharge: boolean?, -- account for exhaust reversion with long valve overlap
    -- optional: per-volume air / fuel / burned-gas tracking with misfire and
    -- partial burn (piston engines; implies TrackFreshCharge)
    GasModel: GasModelDef?,
    -- optional: exhaust pipes as waveguides with a frequency-dependent open
    -- end, outlet radiation and flow noise (see EngineAudioSimulator)
    ExhaustPipe: ExhaustPipeDef?,
    -- optional: intake cam phaser, degrees of retard applied as boost rises
    IntakeCamRetard: number?,
    -- optional: spark advance vs rpm, { {rpm, degrees BTDC}, ... } (overrides SparkAdvance)
    TimingCurve: { { number } }?,
    -- optional: positive-displacement (Roots) supercharger
    Supercharger: SuperchargerDef?,
    -- optional: level of the induction (intake) pulses in the intake stream,
    -- relative to the default (1). The intake stream plays from the car's
    -- intake emitter (VehicleConfig.Sound.Intake).
    InductionVolume: number?,
    -- optional: centrifugal supercharger sound layer (sound only, see
    -- Blower.luau for the fields). Works on any engine.
    Blower: Blower.BlowerDef?,
}

export type GasModelDef = {
    -- air fraction of the trapped charge {never lights, always lights}; in
    -- between, a charge lights with a smooth rising chance
    DilutionLimit: { number },
    -- air fraction from which a charge that lights burns completely
    -- (default: the upper dilution limit + 0.15)
    FullBurn: number?,
    PartialBurn: number?, -- share burned by a charge that only just lights (default 0.6)
    -- commanded equivalence ratio (1 = stoichiometric, above = rich) against
    -- manifold pressure, { {Pa, phi}, ... } (default 1 everywhere)
    Mixture: { { number } }?,
}

export type ExhaustPipeDef = {
    -- m, tailpipe radius: sets where the open end stops reflecting
    -- (default 1.6 x the primary's radius)
    OutletRadius: number?,
    EndReflection: number?, -- low-frequency reflection at the open end, 0..1 (default 0.9)
    HeadReflection: number?, -- reflection at the engine end, 0..1 (default 0.5)
    FlowNoise: number?, -- level of the outflow noise (default 1)
}

export type RotaryDef = {
    Eccentricity: number, -- m (crank throw)
    Radius: number, -- m (rotor centre to apex, R)
    Depth: number, -- m (rotor width, B)
    -- peripheral ports, housing degrees in engine-sim's convention {start, end}
    IntakePort: { number },
    ExhaustPort: { number },
    IntakePortArea: number, -- m^2 fully uncovered
    ExhaustPortArea: number,
    ApexLeakArea: number, -- m^2 per apex seal
    -- fraction of the exhaust port open to reverse flow (stands in for the
    -- exhaust gas momentum the lumped runner doesn't have)
    ExhaustBackflow: number,
    IntakeBackflow: number, -- same, for flow from a chamber back into the plenum
    OutletArea: number, -- m^2, runner -> collector
    -- optional: fresh-charge fraction {misfires always, lights always}; in
    -- between, a charge lights with a smooth rising chance
    DilutionLimit: { number }?,
    -- optional: idle air control gain (throttle-area fraction per unit of rpm
    -- deficit, default 0.08 as EngineModel); lower stops a big throttle hunting
    IdleControlGain: number?,
}

export type SuperchargerDef = {
    Displacement: number, -- m^3 of air moved per rotor revolution
    DriveRatio: number, -- rotor rpm / crank rpm (pulley ratio)
    Lobes: number, -- lobes per rotor (2 rotors)
    InletVolume: number, -- m^3 between throttle body and rotors
    LeakArea: number, -- m^2 equivalent rotor clearance leak (outlet -> inlet)
    BypassArea: number, -- m^2 bypass valve, open at light load
    BypassClose: { number }, -- throttle range over which the bypass closes {start, end}
    MechanicalEfficiency: number,
    AdiabaticEfficiency: number, -- compression efficiency (discharge heating)
    IntercoolerEffectiveness: { number }, -- {at zero flow, at full rotor speed}
    MaxRotorRpm: number, -- for the intercooler flow fraction
    RotorInertia: number, -- kg m^2 of both rotors (reflected to the crank by ratio^2)
    BoostRetard: number, -- degrees of spark retard per bar of boost (knock control)
    WhineVolume: number,
}

local Presets: { [string]: EnginePreset } = {}

-- Gas model for an engine with a mild cam. The air fraction of the trapped
-- charge (by pressure-volume, which is what the burn's pressure rise goes
-- with) is about 0.45 to 0.65 at idle in the lumped model and 0.9 at full
-- throttle, so with these limits it never misses at idle or under load and
-- misses more and more on a closed throttle at speed, where the fraction
-- falls under 0.25.
--
-- With a gas model the trapped air fraction scales every burn, so each preset
-- that uses one is calibrated with it: its ChargeCurve holds the full-throttle
-- torque it had before (within about 2%) and its IdleThrottle the idle speed.
-- Part-throttle torque is lower than before and engine braking stronger,
-- because the old model burned a closed-throttle charge as if it were all air.
local STOCK_GAS: GasModelDef = {
    DilutionLimit = { 0.10, 0.35 },
    FullBurn = 0.55,
}

-- Flow-bench CFM at 28 inH2O -> valve area for EngineModel (Cd = 0.7)
local function FLOW_28(cfm: number): number
    local dp = 28 * 249.089
    local v = math.sqrt(2 * dp / 1.204)
    return cfm * 0.000471947 / v / 0.7
end

-- Find the seat events of the raised cosine used by EngineModel, given
-- duration at a specified checking lift (in the same units as peak lift).
local function camEvents(center: number, duration: number, lift: number, checkingLift: number): (number, number)
    local edge = math.asin(math.sqrt(checkingLift / lift)) / math.pi
    local seatDuration = duration / (1 - 2 * edge)
    return center - seatDuration / 2, center + seatDuration / 2
end

-- assets/engines/atg-video-2/07_gm_ls.mr
do
    local spacing = 2 * INCH
    local function cyl(bank: number, firingIndex: number, primary: number): CylinderDef
        return {
            Bank = bank,
            FiringAngle = firingIndex * 90,
            ExhaustSystem = bank,
            PrimaryLength = primary,
            SoundAttenuation = 1.0,
        }
    end

    Presets.GM_LS = {
        Name = "GM LS V8",
        SimulationFrequency = 10000,
        HfGain = 0.01,
        Noise = 1.0,
        Jitter = 0.6,

        Bore = 3.78 * INCH,
        Stroke = 3.622 * INCH,
        RodLength = 160 * MM,
        CompressionRatio = 10.5,

        IntakeOpen = 700,
        IntakeClose = 225,
        ExhaustOpen = 490,
        ExhaustClose = 735,
        IntakeValveArea = math.pi * 2.0 * INCH * 0.5 * INCH,
        ExhaustValveArea = math.pi * 1.55 * INCH * 0.5 * INCH,
        RunnerVolume = 50 * CC,
        RunnerArea = 1.75 * INCH * 1.75 * INCH,
        PlenumVolume = 1.325e-3,
        ThrottleArea = math.pi * (0.045) ^ 2,
        IdleThrottle = 0.00585,
        GasModel = STOCK_GAS,
        ExhaustPipe = {},
        ChargeCurve = {
            { 1000, 1.076 }, { 2000, 1.066 }, { 3000, 1.060 }, { 4000, 1.070 },
            { 5000, 1.085 }, { 6000, 1.105 },
        },
        ThrottleGamma = 2.0,
        SparkAdvance = 28,
        BurnDuration = 45,
        Inertia = 0.45,
        FrictionTorque = 40,
        FrictionViscous = 0.07,
        StarterTorque = 200 * LB_FT,
        StarterSpeed = 200,
        IdleRpm = 750,
        Redline = 6500,
        RevLimiterDuration = 0.08,

        -- wires: 1 @0, 8 @90, 7 @180, 2 @270, 6 @360, 5 @450, 4 @540, 3 @630
        Cylinders = {
            cyl(1, 0, 3 * spacing + 2 * CM), -- 1
            cyl(2, 3, 3 * spacing + 1 * CM), -- 2
            cyl(1, 7, 2 * spacing + 1 * CM), -- 3
            cyl(2, 6, 2 * spacing + 5 * CM), -- 4
            cyl(1, 5, 1 * spacing + 3 * CM), -- 5
            cyl(2, 4, 1 * spacing + 7 * CM), -- 6
            cyl(1, 2, 0 * spacing + 5 * CM), -- 7
            cyl(2, 1, 0), -- 8
        },
        ExhaustSystems = {
            { Length = 100 * INCH, AudioVolume = 4.0, ImpulseResponse = "default_0" },
            { Length = 172 * INCH, AudioVolume = 4.0, ImpulseResponse = "default_0" },
        },
    }
end

-- A plain inline-4 with one exhaust system, for comparison.
do
    local cyls: { CylinderDef } = {}
    local firing = { 0, 540, 180, 360 } -- 1-3-4-2
    for i = 1, 4 do
        cyls[i] = {
            Bank = 1,
            FiringAngle = firing[i],
            ExhaustSystem = 1,
            PrimaryLength = 18 * INCH,
            SoundAttenuation = 1.0,
        }
    end

    Presets.Inline4 = {
        Name = "Inline 4",
        -- a small 4-cylinder's exhaust is quiet next to its intake; keep the
        -- induction ~12 dB under it at full throttle like the V8s
        InductionVolume = 0.25,
        SimulationFrequency = 10000,
        HfGain = 0.01,
        Noise = 1.0,
        Jitter = 0.5,

        Bore = 86 * MM,
        Stroke = 86 * MM,
        RodLength = 143 * MM,
        CompressionRatio = 10.0,

        IntakeOpen = 705,
        IntakeClose = 220,
        ExhaustOpen = 500,
        ExhaustClose = 730,
        IntakeValveArea = math.pi * 34 * MM * 10 * MM,
        ExhaustValveArea = math.pi * 29 * MM * 10 * MM,
        RunnerVolume = 40 * CC,
        RunnerArea = 1.5 * INCH * 1.5 * INCH,
        PlenumVolume = 2.0e-3,
        ThrottleArea = math.pi * (0.03) ^ 2,
        IdleThrottle = 0.00476,
        GasModel = STOCK_GAS,
        ExhaustPipe = {},
        ChargeCurve = {
            { 1000, 1.069 }, { 2000, 1.070 }, { 3000, 1.055 }, { 4000, 1.097 },
            { 5000, 1.157 }, { 6000, 1.197 }, { 7000, 1.322 },
        },
        ThrottleGamma = 2.0,
        SparkAdvance = 25,
        BurnDuration = 45,
        Inertia = 0.18,
        FrictionTorque = 16,
        FrictionViscous = 0.03,
        StarterTorque = 160,
        StarterSpeed = 250,
        IdleRpm = 850,
        Redline = 7000,
        RevLimiterDuration = 0.06,

        Cylinders = cyls,
        ExhaustSystems = {
            { Length = 120 * INCH, AudioVolume = 1.0, ImpulseResponse = "default_0" },
        },
    }
end


-- Chevrolet LT4 (C7 Corvette Z06 / Camaro ZL1), from the engine-sim script
-- "Chevrolet Corvette C7 (GM LT4) V8 2014" (chevrolet_lt4.mr): bore, stroke,
-- rod, compression, valve sizes and lift, cam events, header
-- primary lengths, exhaust lengths, timing curve and audio settings are that
-- script's. The engine-sim script is naturally aspirated; the supercharger is
-- added here from the production engine (Eaton TVS R1740, 1.74 L/rev,
-- 4-lobe twisted rotors, intercooled, ~0.65 bar peak boost).
do
    local function cam(name: string, intake: number, exhaust: number, liftIn: number, liftEx: number,
        lsa: number, icl: number, redline: number): CamProfile
        -- Duration is checked at the tappet. Lift in the spec is at the valve.
        local checkingLift = 0.050 * 1.7
        local ivo, ivc = camEvents(icl, intake, liftIn, checkingLift)
        local evo, evc = camEvents(720 - (2 * lsa - icl), exhaust, liftEx, checkingLift)
        return {
            Name = name,
            Specs = string.format('%d / %d deg @ .050"   %.3f / %.3f" lift   %g LSA   %g ICL',
                intake, exhaust, liftIn, liftEx, lsa, icl),
            IntakeOpen = ivo,
            IntakeClose = ivc,
            ExhaustOpen = evo,
            ExhaustClose = evc,
            -- Use GM's nominal valve lifts as the reference for reaching
            -- the existing head-flow limit, without extrapolating peak CFM.
            IntakeLiftScale = liftIn / 0.492,
            ExhaustLiftScale = liftEx / 0.551,
            Redline = redline,
        }
    end

    local streetCam = cam("Street (220 / 232)", 220, 232, 0.600, 0.590, 116, 113, 6800)
    local sportCam = cam("Sport (228 / 240)", 228, 240, 0.625, 0.605, 114, 111.5, 7000)
    streetCam.IdleThrottle = 0.0007
    sportCam.IdleThrottle = 0.0007
    local aggressiveCam = cam("Aggressive (235 / 248)", 235, 248, 0.649, 0.615, 111, 109.5, 7200)
    -- Let speed dip into idle-air correction so the crank and belt-driven
    -- blower rise and fall together. The base opening keeps it above stall.
    aggressiveCam.IdleThrottle = 0.0055
    aggressiveCam.IdleAirGain = 0.045
    aggressiveCam.IdleDilution = { 0.10, 0.21 }

    -- LS grind specs adapted to the sim's LT4, plus a fictional solid roller.
    local bigBottleCam = cam("Big Bottle (237 / 255)", 237, 255, 0.637, 0.620, 115, 109.5, 7400)
    local bigGunCam = cam("Big Gun 4 (251 / 255)", 251, 255, 0.625, 0.605, 117, 109.5, 7600)
    local solidRollerCam = cam("Race Solid Roller (262 / 269)", 262, 269, 0.660, 0.640, 112, 110, 8000)
    bigBottleCam.IdleThrottle = 0.0055
    bigBottleCam.IdleAirGain = 0.045
    bigGunCam.IdleThrottle = 0.0065
    bigGunCam.IdleAirGain = 0.045
    solidRollerCam.IdleThrottle = 0.010
    solidRollerCam.IdleAirGain = 0.055
    for _, raceCam in { bigBottleCam, bigGunCam, solidRollerCam } do
        raceCam.IdleDilution = { 0.10, 0.21 }
    end
    -- The big cams' idle charge sits on the misfire limit: about one idle
    -- firing in 15 to 25 misses (the next one, cleaner, lights hard), none do
    -- from 5% throttle up. Each 0.01 higher on these limits roughly doubles
    -- the misses, and from ~0.12 on the lower one the idle stalls.
    for _, bigCam in { aggressiveCam, bigBottleCam, bigGunCam } do
        bigCam.GasModel = { DilutionLimit = { 0.11, 0.23 }, FullBurn = 0.35 }
    end
    solidRollerCam.GasModel = { DilutionLimit = { 0.105, 0.22 }, FullBurn = 0.34 }

    local bore = 103.25 * MM
    local spacing = 1.1
    local function pl(factor: number): number
        return factor * bore * spacing
    end
    local rot = 90
    -- Production LT4 firing order: 1-8-7-2-6-5-4-3, odd/even cylinder banks.
    local function cyl(bank: number, firingIndex: number, primary: number): CylinderDef
        return {
            Bank = bank,
            FiringAngle = firingIndex * rot,
            ExhaustSystem = bank,
            PrimaryLength = primary,
            SoundAttenuation = 1.0,
        }
    end

    -- IVO 24 BTDC, IVC 72 ABDC, EVO 79 BBDC, EVC 31 ATDC (0 = TDC, start of intake)
    Presets.LT4 = {
        Name = "Chevrolet LT4 (supercharged)",
        SimulationFrequency = 12000,
        HfGain = 0.003,
        Noise = 0.1,
        Jitter = 0.9,

        Bore = bore,
        Stroke = 92.0 * MM,
        RodLength = 154.8892 * MM,
        CompressionRatio = 10.0,

        IntakeOpen = 720 - 24,
        IntakeClose = 180 + 72,
        ExhaustOpen = 540 - 79,
        ExhaustClose = 720 + 31,
        -- From the script's flow-bench tables at max lift (267.4 / 150.3 CFM at
        -- 28 inH2O), as effective area / the model's 0.7 discharge coefficient
        IntakeValveArea = FLOW_28(267.4),
        ExhaustValveArea = FLOW_28(150.3),
        CamOptions = {
            streetCam,
            sportCam,
            aggressiveCam,
            bigBottleCam,
            bigGunCam,
            solidRollerCam,
        },
        DefaultCamIndex = 3,
        RunnerVolume = 112.355 * CC,
        RunnerArea = 12.867 * CM * CM,
        PlenumVolume = 5.4e-3,
        ThrottleArea = math.pi * (0.0435) ^ 2, -- 87 mm throttle body
        -- base cam only: every cam option sets its own
        IdleThrottle = 0.00467,
        ExhaustPipe = {},
        -- The cam options were calibrated with the fresh charge tracked and
        -- idle on an air fraction near 0.18, so the limits sit under that:
        -- only a closed throttle at speed misses. The big cams bring their
        -- own limits, which do miss at idle. The base cam was not, so it gets its own
        -- charge curve and idle throttle to keep its torque and idle speed.
        GasModel = {
            DilutionLimit = { 0.02, 0.07 },
            FullBurn = 0.10,
        },
        BaseCamChargeCurve = {
            { 1000, 0.965 }, { 1500, 0.949 }, { 2000, 0.989 }, { 2500, 0.963 }, { 3000, 0.983 },
            { 3500, 0.922 }, { 4000, 0.972 }, { 4500, 1.015 }, { 5000, 1.029 }, { 5500, 1.067 },
            { 6000, 1.171 }, { 6500, 1.214 },
        },
        ThrottleGamma = 1.5,
        SparkAdvance = 25,
        BurnDuration = 45,
        -- crank (18 kg disk, r = stroke/2) + flywheel (6 kg disk, r = 3.5 x stroke) + 1 kg misc
        Inertia = 0.5 * 18 * 0.046 ^ 2 + 0.5 * 6 * 0.322 ^ 2 + 0.5 * 1 * 0.01 ^ 2,
        -- includes accessory drive (the LT4's pumps and alternator)
        FrictionTorque = 60,
        FrictionViscous = 0.075,
        StarterTorque = 200,
        StarterSpeed = 400,
        IdleRpm = 700,
        Redline = 6600,
        RevLimiterDuration = 0.09,

        Cylinders = {
            cyl(1, 0, pl(1.9)), -- 1 (wire1)
            cyl(2, 3, pl(1.6)), -- 2 (wire2)
            cyl(1, 7, pl(1.7)), -- 3 (wire3)
            cyl(2, 6, pl(2.1)), -- 4 (wire4)
            cyl(1, 5, pl(2.1)), -- 5 (wire5)
            cyl(2, 4, pl(1.7)), -- 6 (wire6)
            cyl(1, 2, pl(1.6)), -- 7 (wire7)
            cyl(2, 1, pl(1.9)), -- 8 (wire8)
        },
        ExhaustSystems = {
            { Length = 258 * CM, AudioVolume = 5.0, ImpulseResponse = "default_0" },
            { Length = 250 * CM, AudioVolume = 5.0, ImpulseResponse = "default_0" },
        },

        -- Calibrates the lumped combustion to the published LT4 torque
        -- (881 N m @ 3,600 rpm, 485 kW @ 6,400 rpm)
        CombustionGain = 5.2,
        -- GM's phaser retards the intake cam under boost to cut the 55 degree
        -- overlap (and blow-through) of the base cam timing
        IntakeCamRetard = 15,

        TimingCurve = {
            { 0, 10 }, { 1000, 15 }, { 2000, 20 }, { 3000, 25 },
            { 4000, 30 }, { 5000, 33 }, { 6000, 36 }, { 7000, 38 },
        },

        Supercharger = {
            Displacement = 1.74e-3,
            -- set so peak boost matches the published ~9.4 psi; keeps the
            -- rotors under the R1740's 20,000 rpm at the 6,600 rpm redline
            DriveRatio = 2.75,
            Lobes = 4,
            InletVolume = 2.5e-3,
            LeakArea = 3.0e-5,
            BypassArea = 2.4e-3,
            BypassClose = { 0.25, 0.75 },
            MechanicalEfficiency = 0.85,
            AdiabaticEfficiency = 0.65,
            IntercoolerEffectiveness = { 0.9, 0.6 },
            MaxRotorRpm = 20000,
            RotorInertia = 0.004,
            BoostRetard = 12,
            WhineVolume = 25.0,
        },

        -- ProCharger-style centrifugal blower sound stacked on top (sound
        -- only; set Enabled = false or delete to go back to the stock LT4)
        Blower = Blower.defaults(),
    }
end

-- Cosworth GMA 3.9 L V12 (Gordon Murray Automotive T.50), from the engine-sim
-- script T50_Cosworth_GMA_V12.mr by dacxl: bore, stroke, rod, cam lobes,
-- flow-bench tables, firing order, header primaries, exhaust, timing curve,
-- crank inertia, rev limit and audio settings are that script's.
--   * cam: harmonic lobes, intake 230 deg @ 0.050" / 17 mm lift centred 70
--     ATDC, exhaust 200 deg @ 0.050" / 11 mm centred 120 BTDC, 0.5 deg advance.
--     EngineModel uses a raised-cosine lift, so the events below are the
--     raised cosine that crosses 0.050" at the same crank angles.
--   * the script's 40 cc chamber gives ~9.5:1; the production engine is 11:1,
--     which is used here (the combustion gain is calibrated to the published
--     output either way).
--   * sound_attenuation 3000 / 2900 is normalised to 1.0 / 0.967 (only the
--     ratio matters after the synthesizer's leveler).
-- Published: 663 PS (488 kW) @ 11,500 rpm, 467 N m @ 9,000 rpm, 12,100 rpm
-- redline, revs at 28,400 rpm/s.
do
    local function cyl(bank: number, firingIndex: number, attenuation: number): CylinderDef
        return {
            Bank = bank,
            FiringAngle = firingIndex * 60,
            ExhaustSystem = bank,
            PrimaryLength = 400 * MM,
            SoundAttenuation = attenuation / 3000,
        }
    end

    local advance = 0.5
    -- The intake is retarded 40 deg from the script (70 -> 110 ATDC). With the
    -- script's 95 deg lobe separation the intake is half open at TDC, and the
    -- lumped model counts the exhaust that reverts into the plenum as fresh
    -- charge, so the engine made power with the throttle shut and would not idle.
    local INTAKE_RETARD = 40
    local ivo, ivc = camEvents(70 + INTAKE_RETARD - advance, 230, 17 * MM, 0.05 * INCH)
    local evo, evc = camEvents(720 - 120 - advance, 200, 11 * MM, 0.05 * INCH)

    Presets.CosworthGMA = {
        Name = "Cosworth GMA V12 (T.50)",
        -- the roof ram-air intake sits right behind the driver's head and is a
        -- big part of the T.50's sound: ~9 dB under the exhaust at full throttle
        InductionVolume = 1.4,
        SimulationFrequency = 12000,
        -- engine-sim engine() defaults (the script doesn't set them)
        HfGain = 0.01,
        Noise = 1.0,
        Jitter = 0.5,

        Bore = 81.5 * MM,
        Stroke = 63.8 * MM,
        RodLength = 117 * MM,
        CompressionRatio = 11.0,

        IntakeOpen = ivo % 720,
        IntakeClose = ivc,
        ExhaustOpen = evo,
        ExhaustClose = evc,
        -- flow-bench tables at 12 mm (345 / 215 CFM @ 28 inH2O)
        IntakeValveArea = FLOW_28(345),
        ExhaustValveArea = FLOW_28(215),
        RunnerVolume = 200 * CC,
        RunnerArea = 2 * 12.4087 * CM * CM,
        PlenumVolume = 0.75e-3,
        -- twelve individual throttle bodies; equivalent single orifice
        ThrottleArea = 0.0085,
        IdleThrottle = 0.0036,
        GasModel = STOCK_GAS,
        ExhaustPipe = {},
        ThrottleGamma = 1.8,
        SparkAdvance = 35,
        BurnDuration = 45,
        -- the script's crank moment of inertia (flywheel is nearly nil)
        Inertia = 0.123,
        FrictionTorque = 40,
        FrictionViscous = 0.022,
        StarterTorque = 200,
        StarterSpeed = 600,
        IdleRpm = 1000,
        Redline = 12100,
        RevLimiterDuration = 0.045,

        -- distributor (x 60 deg): 1 @0, 7 @1, 5 @2, 11 @3, 4 @4, 10 @5,
        -- 6 @6, 12 @7, 2 @8, 8 @9, 3 @10, 9 @11. Bank b0 = 1-6 -> exhaust0,
        -- bank b1 = 7-12 -> exhaust2.
        Cylinders = {
            cyl(1, 0, 3000), -- 1
            cyl(1, 8, 2900), -- 2
            cyl(1, 10, 2900), -- 3
            cyl(1, 4, 2900), -- 4
            cyl(1, 2, 3000), -- 5
            cyl(1, 6, 3000), -- 6
            cyl(2, 1, 3000), -- 7
            cyl(2, 9, 2900), -- 8
            cyl(2, 11, 2900), -- 9
            cyl(2, 5, 2900), -- 10
            cyl(2, 3, 3000), -- 11
            cyl(2, 7, 3000), -- 12
        },
        ExhaustSystems = {
            { Length = 300 * CM, AudioVolume = 10.0, ImpulseResponse = "default_0" },
            { Length = 300 * CM, AudioVolume = 10.0, ImpulseResponse = "default_0" },
        },

        -- Calibrates the lumped combustion to the published output; the charge
        -- curve gives the GMA's rising torque (71% of peak at 2,500 rpm, 467 N m
        -- @ 9,000, 488 kW @ 11,500) that comes from its tuned intake/exhaust.
        CombustionGain = 5.6,
        ChargeCurve = {
            { 1000, 0.692 }, { 2000, 0.698 }, { 3000, 0.727 }, { 4000, 0.768 }, { 5000, 0.822 },
            { 6000, 0.895 }, { 7000, 0.937 }, { 8000, 1.002 }, { 9000, 1.049 }, { 10000, 1.079 },
            { 11000, 1.048 }, { 12000, 0.993 },
        },

        TimingCurve = {
            { 0, 0 }, { 1000, 15 }, { 2000, 15 }, { 3000, 20 }, { 4000, 25 },
            { 5000, 30 }, { 6000, 35 }, { 12000, 35 },
        },
    }
end

-- Porsche 4.0 L flat-six (992 911 GT3 RS), from the engine-sim script "Porsche 911 GT3 RS.mr"
-- by skibidly67: bore, stroke, rod, chamber, cam lobes, flow-bench tables, runner volumes,
-- plenum, firing order, primaries, sound attenuation, exhaust, impulse response, timing curve,
-- crank and flywheel inertia, starter, throttle gamma and rev limiter are that script's.
--   * cam: harmonic lobes, intake 250 deg @ 0.050" / 12.5 mm centred 112 ATDC, exhaust
--     242 deg @ 0.050" / 11.1 mm centred 110 BTDC; EngineModel uses a raised cosine, so the
--     events below are the raised cosine that crosses 0.050" at the same crank angles.
--   * the 54.14 cc chamber over the 666.6 cc swept volume is 13.3:1, the production figure.
--   * wires: 1 @0, 4 @120, 5 @240, 2 @360, 3 @480, 6 @600. Bank b0 (wires 1, 3, 5) ->
--     exhaust0, bank b1 (wires 2, 4, 6) -> exhaust1.
--   * the script's intake is one k_carb(800) throttle; kept as the car's six 42 mm bodies.
--   * the intake event runs 40 deg later than the script's (as the Cosworth's does), or the
--     engine idles at 1,700 rpm; the combustion gain makes up the power.
-- Published: 386 kW (525 PS) @ 8,500 rpm, 465 N m @ 6,300 rpm.
do
    local function cyl(bank: number, firingIndex: number, primary: number, attenuation: number): CylinderDef
        return {
            Bank = bank,
            FiringAngle = firingIndex * 120,
            ExhaustSystem = bank,
            PrimaryLength = primary,
            SoundAttenuation = attenuation,
        }
    end

    -- The lumped model counts exhaust reverted into the plenum during overlap as fresh charge
    -- (see the Cosworth preset), so the intake event runs this much later than the script's.
    local INTAKE_RETARD = 40
    local ivo, ivc = camEvents(112 + INTAKE_RETARD, 250, 12.5 * MM, 0.05 * INCH)
    local evo, evc = camEvents(720 - 110, 242, 11.1 * MM, 0.05 * INCH)
    local spacing = 0.5 * INCH

    Presets.Porsche9A2 = {
        Name = "Porsche 4.0 flat-six (911 GT3 RS)",
        InductionVolume = 1.2,
        SimulationFrequency = 12000,
        -- engine-sim engine() defaults (the script doesn't set them)
        HfGain = 0.01,
        Noise = 1.0,
        Jitter = 0.5,

        Bore = 102 * MM,
        Stroke = 81.58 * MM,
        RodLength = 130 * MM,
        CompressionRatio = 13.3,

        IntakeOpen = ivo % 720,
        IntakeClose = ivc,
        ExhaustOpen = evo,
        ExhaustClose = evc,
        -- flow-bench tables at 0.450" (281 / 246 CFM @ 28 inH2O)
        IntakeValveArea = FLOW_28(281),
        ExhaustValveArea = FLOW_28(246),
        RunnerVolume = 50 * CC,
        RunnerArea = 1.237 * INCH * 1.237 * INCH,
        PlenumVolume = 4.2e-3,
        -- six 42 mm individual throttle bodies; equivalent single orifice
        ThrottleArea = 6 * math.pi * 0.021 ^ 2,
        IdleThrottle = 0.0033,
        GasModel = STOCK_GAS,
        ExhaustPipe = {},
        ThrottleGamma = 2.0,
        SparkAdvance = 32,
        BurnDuration = 45,
        -- crank (40 lb disk, r = stroke) + flywheel (20 lb, r = 5") + 10 kg misc at 1 cm
        Inertia = 0.5 * 18.14 * 0.08158 ^ 2 + 0.5 * 9.07 * (5 * INCH) ^ 2 + 0.5 * 10 * 0.01 ^ 2,
        FrictionTorque = 42,
        FrictionViscous = 0.024,
        StarterTorque = 100 * LB_FT,
        StarterSpeed = 500,
        IdleRpm = 950,
        Redline = 9000,
        RevLimiterDuration = 0.1,

        Cylinders = {
            cyl(1, 0, 2 * spacing, 0.8), -- b0 wire1
            cyl(1, 4, 1 * spacing, 0.9), -- b0 wire3
            cyl(1, 2, 0, 1.0), -- b0 wire5
            cyl(2, 3, 2 * spacing, 0.6), -- b1 wire2
            cyl(2, 1, 1 * spacing, 0.3), -- b1 wire4
            cyl(2, 5, 0, 1.1), -- b1 wire6
        },
        ExhaustSystems = {
            { Length = 31.5 * INCH, AudioVolume = 3.0, ImpulseResponse = "mild_exhaust_0_reverb" },
            { Length = 31.5 * INCH, AudioVolume = 4.0, ImpulseResponse = "mild_exhaust_0_reverb" },
        },

        -- Calibrates the lumped combustion to the published output (see the dyno tool).
        CombustionGain = 7.0,
        ChargeCurve = {
            { 1000, 0.790 }, { 2000, 0.777 }, { 3000, 0.816 }, { 4000, 0.879 }, { 5000, 0.940 },
            { 6000, 0.979 }, { 7000, 0.993 }, { 8000, 0.977 }, { 9000, 0.924 },
        },

        TimingCurve = {
            { 0, 10 }, { 1000, 16 }, { 2000, 22 }, { 3000, 25 }, { 4000, 27 },
            { 5000, 30 }, { 6000, 32 }, { 7000, 33 }, { 8000, 35 }, { 9000, 35 },
        },
    }
end

-- engine-sim's k_carb(cfm): carburettor flow rating at 1.5 inHg -> orifice
-- area for the lumped model (Cd = 0.7)
local function K_CARB(cfm: number): number
    local dp = 1.5 * 3386.39
    local v = math.sqrt(2 * dp / 1.204)
    return cfm * 0.000471947 / v / 0.7
end

-- porsche_935_k3.mr: GearheadLydia's M64 base, 935 K3 rebuild by _dan.
-- The script emulates turbo response through airflow and timing. The charge
-- curve reproduces its power build above 5200 rpm in the lumped model.
do
    local bore, stroke = 95 * MM, 74.4 * MM
    local pistonArea = math.pi * (bore / 2) ^ 2
    local clearance = (81.5 - 1) * CC + pistonArea * 4.5 * MM
    local runnerArea = math.pi * (0.7 * INCH) ^ 2
    local ivo, ivc = camEvents(111 - 2, 240, 13.2 * MM, 0.05 * INCH)
    local evo, evc = camEvents(720 - 111 - 2, 245, 12.8 * MM, 0.05 * INCH)
    local function cyl(bank: number, firingIndex: number, spacing: number, attenuation: number): CylinderDef
        return {
            Bank = bank,
            FiringAngle = firingIndex * 120,
            ExhaustSystem = 1,
            PrimaryLength = 20 * INCH + spacing * 118 * MM,
            SoundAttenuation = attenuation,
        }
    end

    Presets.Porsche935K3 = {
        Name = "Kremer Porsche 935 K3",
        SimulationFrequency = 11800,
        HfGain = 0.02,
        Noise = 1,
        Jitter = 0.9,
        Bore = bore,
        Stroke = stroke,
        RodLength = 145 * MM,
        CompressionRatio = 1 + pistonArea * stroke / clearance,
        IntakeOpen = ivo % 720,
        IntakeClose = ivc,
        ExhaustOpen = evo,
        ExhaustClose = evc,
        IntakeValveArea = FLOW_28(335 * 0.8),
        ExhaustValveArea = FLOW_28((260 + (280 - 260) * (12.8 / 1.1 - 11)) * 0.8),
        RunnerVolume = runnerArea * 4 * INCH,
        RunnerArea = runnerArea,
        PlenumVolume = 1.5e-3,
        ThrottleArea = K_CARB(2600),
        IdleThrottle = 0.0012,
        ExhaustPipe = {},
        -- Calibrated with the fresh charge tracked already (TrackFreshCharge
        -- below); it idles on an air fraction of 0.155, so the limits sit
        -- under that and only a closed throttle at speed misses.
        GasModel = {
            DilutionLimit = { 0.04, 0.12 },
            FullBurn = 0.15,
        },
        ThrottleGamma = 1,
        SparkAdvance = 5,
        BurnDuration = 45,
        Inertia = 0.5 * (85 * 0.45359237 * (stroke / 2) ^ 2
            + 18 * 0.45359237 * (6 * INCH) ^ 2 + 15 * 0.08 ^ 2),
        FrictionTorque = 5 * LB_FT,
        FrictionViscous = 0.024,
        StarterTorque = 40 * LB_FT,
        StarterSpeed = 500,
        IdleRpm = 1000,
        Redline = 8320,
        RevLimiterDuration = 0.019,
        Cylinders = {
            cyl(1, 0, 0.3, 1.0), -- wire 1
            cyl(1, 2, 0.5, 0.9), -- wire 2
            cyl(1, 4, 1.1, 0.8), -- wire 3
            cyl(2, 3, 0, 0.5), -- wire 4
            cyl(2, 5, 0.2, 0.45), -- wire 5
            cyl(2, 1, 0.8, 0.4), -- wire 6
        },
        ExhaustSystems = {
            { Length = 300 * MM, AudioVolume = 0.001, ImpulseResponse = "default_0" },
        },
        TrackFreshCharge = true,
        CombustionGain = 5.0,
        ChargeCurve = { { 0, 0.75 } },
        BoostChargeCurve = {
            { 0, 0 }, { 5000, 0 }, { 5200, 0.08 }, { 6000, 0.65 },
            { 7000, 1.60 }, { 8100, 4.3 }, { 8320, 4.3 },
        },
        TimingCurve = {
            { 0, 5 }, { 1000, 9 }, { 2000, 10 }, { 3000, 13 }, { 4000, 22 },
            { 5000, 28 }, { 6000, 39 }, { 7000, 47 }, { 8000, 55 }, { 9000, 62 },
        },
    }
end

-- Cammed small-block Chevy 350 (V8), from the engine-sim script
-- cammed_sbc_350.mr: bore, stroke (1.74" throw), rod, 67 cc chamber, harmonic
-- cam lobes (218 deg @ 0.050", 0.450" lift, 106 LSA), flow-bench tables, runner
-- and plenum volumes, k_carb(850) intake, header primaries, exhaust lengths,
-- audio volume, timing curve, crank inertia, starter, friction, rev limit and
-- simulation frequency are that script's.
--   * cam: EngineModel uses a raised cosine, so the events below are the
--     raised cosine that crosses 0.050" at the same crank angles.
--   * wires: 1 @0, 8 @90, 7 @180, 2 @270 ... as the script's distributor
--     (x 90 deg). Bank b0 (wires 1, 4, 6, 7) -> exhaust0 (75"), bank b1
--     (wires 8, 3, 5, 2) -> exhaust1 (100").
--   * idle throttle is the script's plate position (0.98792 -> 1.2% open).
do
    local bore, stroke = 4.00 * INCH, 2 * 1.74 * INCH
    local pistonArea = math.pi * (bore / 2) ^ 2
    -- The lumped model counts exhaust reverted into the plenum during overlap as
    -- fresh charge (see the Cosworth preset), so the intake event runs later than
    -- the script's or the engine idles at ~3,400 rpm.
    local INTAKE_RETARD = 40
    local ivo, ivc = camEvents(106 + INTAKE_RETARD, 218, 0.450 * INCH, 0.05 * INCH)
    local evo, evc = camEvents(720 - 106, 218, 0.450 * INCH, 0.05 * INCH)
    local function cyl(bank: number, wire: number): CylinderDef
        return {
            Bank = bank,
            FiringAngle = (wire - 1) * 90,
            ExhaustSystem = bank,
            PrimaryLength = 39.6 * INCH,
            SoundAttenuation = 1.0,
        }
    end

    Presets.CammedSBC350 = {
        Name = "Cammed Chevy SBC 350 V8",
        SimulationFrequency = 7100,
        -- engine-sim engine() defaults (the script doesn't set them)
        HfGain = 0.01,
        Noise = 1.0,
        Jitter = 0.5,

        Bore = bore,
        Stroke = stroke,
        RodLength = 5.70 * INCH,
        CompressionRatio = 1 + pistonArea * stroke / (67 * CC),

        IntakeOpen = ivo % 720,
        IntakeClose = ivc,
        ExhaustOpen = evo,
        ExhaustClose = evc,
        -- flow-bench tables at 0.450" lift (223.5 / 155.25 CFM @ 28 inH2O)
        IntakeValveArea = FLOW_28(223.5),
        ExhaustValveArea = FLOW_28(155.25),
        RunnerVolume = 65 * CC,
        RunnerArea = 11.09 * CM * CM,
        PlenumVolume = 0.72e-3,
        ThrottleArea = K_CARB(850),
        IdleThrottle = 0.0008,
        -- Calibrates the lumped combustion to a ~330 hp cammed 350.
        CombustionGain = 4.4,
        ThrottleGamma = 2.0,
        SparkAdvance = 30,
        BurnDuration = 45,
        Inertia = 0.22986844776863666 * 2,
        FrictionTorque = 10 * LB_FT,
        FrictionViscous = 0.03,
        StarterTorque = 400 * LB_FT,
        StarterSpeed = 200,
        IdleRpm = 900,
        Redline = 6000,
        RevLimiterDuration = 0.08,

        Cylinders = {
            cyl(1, 1), -- b0 wire1
            cyl(1, 4), -- b0 wire4
            cyl(1, 6), -- b0 wire6
            cyl(1, 7), -- b0 wire7
            cyl(2, 8), -- b1 wire8
            cyl(2, 3), -- b1 wire3
            cyl(2, 5), -- b1 wire5
            cyl(2, 2), -- b1 wire2
        },
        ExhaustSystems = {
            { Length = 75 * INCH, AudioVolume = 5.0, ImpulseResponse = "default_0" },
            { Length = 100 * INCH, AudioVolume = 5.0, ImpulseResponse = "default_0" },
        },

        TimingCurve = {
            { 0, 10 }, { 1000, 17 }, { 2000, 24 }, { 3000, 31 },
            { 4000, 38 }, { 5000, 43 }, { 6000, 45 },
        },

        -- The overlap leaves the idle charge about half exhaust (air fraction
        -- 0.25 to 0.75 from cycle to cycle). With these limits roughly one
        -- idle firing in ten misses at a steady idle (they were 0.10..0.35
        -- while the idle air control hunted, and its dips did the missing), none do from a light cruise up, and most
        -- do on a closed throttle at speed. A carburettor's mixture: rich at
        -- idle and at full throttle, stoichiometric in between.
        GasModel = {
            DilutionLimit = { 0.38, 0.65 },
            FullBurn = 0.85,
            Mixture = { { 25e3, 1.10 }, { 45e3, 1.0 }, { 85e3, 1.0 }, { 98e3, 1.12 } },
        },
        ExhaustPipe = {},
    }
end

-- Stock 1996 Chevy C/K 1500 small block: the L31 5.7 Vortec 350 (V8). Published: 255 hp @
-- 4,600 rpm, 330 lb ft (447 N m) @ 2,800, 9.4:1, fuel cut ~5,000 rpm. The block, rods, firing
-- order and bank-to-exhaust layout are the cammed 350's above; what differs is the L31's:
--   * hydraulic roller cam, 0.414"/0.428" lift, 112 LSA, ICL ~108 (the same INTAKE_RETARD
--     stand-in for reverted exhaust as the cammed 350). The real cam is ~185/190 deg @ 0.050";
--     at that the lumped model loses its top end (330 N m at 4,500 rpm), so the events are
--     210/215 deg, which gives the published curve's shape.
--   * Vortec heads at that lift (~215 / 150 CFM @ 28 inH2O), 9.4:1
--   * central sequential injection under a twin-bore throttle body (~600 CFM)
--   * cast manifolds into a Y-pipe and one muffler: the "mild_exhaust_0" response
--   * a stock spark curve and fuel cut
do
    local bore, stroke = 4.00 * INCH, 2 * 1.74 * INCH
    local INTAKE_RETARD = 40
    local ICL, LSA = 108, 112
    local ivo, ivc = camEvents(ICL + INTAKE_RETARD, 210, 0.414 * INCH, 0.05 * INCH)
    local evo, evc = camEvents(720 - (2 * LSA - ICL), 215, 0.428 * INCH, 0.05 * INCH)
    local function cyl(bank: number, wire: number): CylinderDef
        return {
            Bank = bank,
            FiringAngle = (wire - 1) * 90,
            ExhaustSystem = bank,
            PrimaryLength = 30 * INCH,
            SoundAttenuation = 1.0,
        }
    end

    Presets.VortecL31 = {
        Name = "Chevy L31 Vortec 350 V8",
        SimulationFrequency = 7100,
        HfGain = 0.01,
        Noise = 1.0,
        Jitter = 0.5,

        Bore = bore,
        Stroke = stroke,
        RodLength = 5.70 * INCH,
        CompressionRatio = 9.4,

        IntakeOpen = ivo % 720,
        IntakeClose = ivc,
        ExhaustOpen = evo,
        ExhaustClose = evc,
        IntakeValveArea = FLOW_28(215),
        ExhaustValveArea = FLOW_28(150),
        RunnerVolume = 65 * CC,
        RunnerArea = 11.09 * CM * CM,
        PlenumVolume = 0.72e-3,
        ThrottleArea = K_CARB(600),
        IdleThrottle = 0.0008,
        -- Calibrates the lumped combustion to the published curve (tools/enginesim/dyno.luau:
        -- ~450 N m from 2,500-3,000 rpm, ~250 hp at 4,500).
        CombustionGain = 4.5,
        ThrottleGamma = 2.0,
        SparkAdvance = 30,
        BurnDuration = 45,
        Inertia = 0.22986844776863666 * 2,
        FrictionTorque = 10 * LB_FT,
        FrictionViscous = 0.03,
        StarterTorque = 400 * LB_FT,
        StarterSpeed = 200,
        IdleRpm = 650,
        Redline = 5000,
        RevLimiterDuration = 0.08,

        Cylinders = {
            cyl(1, 1),
            cyl(1, 4),
            cyl(1, 6),
            cyl(1, 7),
            cyl(2, 8),
            cyl(2, 3),
            cyl(2, 5),
            cyl(2, 2),
        },
        ExhaustSystems = {
            { Length = 110 * INCH, AudioVolume = 4.0, ImpulseResponse = "mild_exhaust_0" },
            { Length = 130 * INCH, AudioVolume = 4.0, ImpulseResponse = "mild_exhaust_0" },
        },

        TimingCurve = {
            { 0, 8 }, { 1000, 14 }, { 2000, 22 }, { 3000, 28 },
            { 4000, 32 }, { 5000, 34 }, { 6000, 34 },
        },

        -- a mild cam: far less exhaust left in the idle charge than the cammed 350's, and an
        -- injected (stoichiometric, rich only at full load) mixture
        GasModel = {
            DilutionLimit = { 0.45, 0.75 },
            FullBurn = 0.85,
            Mixture = { { 25e3, 1.0 }, { 85e3, 1.0 }, { 98e3, 1.08 } },
        },
        ExhaustPipe = {},
    }
end

-- 2020 GMC Sierra 2500HD's L5P Duramax 6.6 turbo-diesel V8, from the engine-sim script
-- "DMAX V8 (L5P).mr" (pilot01; LTSP6.2 by Archangel Motors): bore 103, stroke 99, rod 1.67 x
-- stroke, 16:1, the harmonic cam (intake 10 deg ATDC to 35 ABDC, exhaust 37 BBDC to 7 BTDC,
-- 15.4 mm lift), two 0.414 x bore valves a port (its flow-bench peaks), a plenum of one
-- displacement, two exhaust systems (smooth_32 at 1.5 and minimal_muffling_01 at 0.1) with its
-- primary lengths, the firing order 1-2-7-8-4-5-6-3, its timing curve, starter and the 3,450 rpm
-- limit with its 0.24 s cut are the script's. Published: 445 hp (332 kW) @ 2,800 rpm, 910 lb ft
-- (1,234 N m) @ 1,600.
--   * the script runs the engine naturally aspirated on engine-sim's diesel fuel with the plate
--     held open; the lumped model is throttled (the pedal stands in for the injection quantity)
--     and the turbocharger is its BoostChargeCurve: the charge the VGT adds as it spools, calibrated
--     on tools/enginesim/dyno.luau to the published curve.
--   * simulation 10 kHz (the script's 15 kHz is more than the game can spend on one engine).
do
    local bore, stroke = 103 * MM, 99 * MM
    local valve = bore / 2.414
    -- engine-sim curtain area -> the script's peak flows (cfm @ 28 inH2O)
    local function peakFlow(d: number): number
        return math.pi * (d * 0.98 / MM) ^ 2 / 400 * 2 * 0.155 * 146
    end
    local ivo, ivc = camEvents(112.5, 205, 15.4 * MM, 0.05 * INCH)
    local evo, evc = camEvents(720 - 112, 210, 15.4 * MM, 0.05 * INCH)
    local primaries = { 6, 3, 8, 6, 5, 1, 4, 1 }
    local function cyl(bank: number, wireAngle: number, exhaust: number, index: number): CylinderDef
        return {
            Bank = bank,
            FiringAngle = wireAngle,
            ExhaustSystem = exhaust,
            PrimaryLength = primaries[index] * bore * 1.05 / (0.80 * 1.45),
            SoundAttenuation = 1.0,
        }
    end

    Presets.DuramaxL5P = {
        Name = "Duramax 6.6 L5P V8",
        SimulationFrequency = 10000,
        HfGain = 1.0,
        Noise = 0.17,
        Jitter = 0.20,

        Bore = bore,
        Stroke = stroke,
        RodLength = 1.67 * stroke,
        CompressionRatio = 16,

        IntakeOpen = ivo % 720,
        IntakeClose = ivc,
        ExhaustOpen = evo,
        ExhaustClose = evc,
        IntakeValveArea = FLOW_28(peakFlow(valve)),
        ExhaustValveArea = FLOW_28(peakFlow(valve * 0.89375)),
        RunnerVolume = 0.25 * math.pi * (bore / 2) ^ 2 * stroke,
        RunnerArea = 15 * CM * CM,
        PlenumVolume = 8 * math.pi * (bore / 2) ^ 2 * stroke,
        ThrottleArea = K_CARB(1500),
        IdleThrottle = 0.0012,
        GasModel = STOCK_GAS,
        ExhaustPipe = {},
        ThrottleGamma = 1.0,
        SparkAdvance = 10,
        BurnDuration = 50,
        -- Calibrates the lumped combustion and the turbo to the published curve.
        CombustionGain = 3.0,
        ChargeCurve = { { 0, 1 } },
        -- the charge the turbo adds at full load: building from idle, full by 1,500 rpm, then the VGT
        -- opening up as the flow rises (the published curve over the engine's own breathing)
        BoostChargeCurve = {
            { 0, 0 }, { 600, 0.1 }, { 800, 0.4 }, { 1000, 0.87 }, { 1500, 1.62 }, { 1600, 1.62 },
            { 2000, 1.40 }, { 2500, 1.12 }, { 2800, 1.00 }, { 3000, 0.90 }, { 3450, 0.59 },
        },
        -- a long-stroke diesel's heavy crank and flywheel
        Inertia = 0.9,
        FrictionTorque = 25 * LB_FT,
        FrictionViscous = 0.06,
        StarterTorque = 191,
        StarterSpeed = 250,
        IdleRpm = 680,
        Redline = 3450,
        RevLimiterDuration = 0.24,

        -- bank 1 (wires 1, 3, 5, 7), bank 2 (wires 2, 4, 6, 8); the wires fire at the script's
        -- angles, and each bank alternates between the two exhaust systems as the script does
        Cylinders = {
            cyl(1, 0, 1, 1), -- wire 1
            cyl(1, 630, 2, 2), -- wire 3
            cyl(1, 450, 1, 3), -- wire 5
            cyl(1, 180, 2, 4), -- wire 7
            cyl(2, 90, 1, 5), -- wire 2
            cyl(2, 360, 2, 6), -- wire 4
            cyl(2, 540, 1, 7), -- wire 6
            cyl(2, 270, 2, 8), -- wire 8
        },
        ExhaustSystems = {
            { Length = 6133 * MM, AudioVolume = 1.5, ImpulseResponse = "smooth_32" },
            { Length = 6133 * MM, AudioVolume = 0.1, ImpulseResponse = "minimal_muffling_01" },
        },

        TimingCurve = {
            { 0, 0 }, { 500, 2.5 }, { 1000, 5 }, { 1500, 10 }, { 2000, 15 }, { 2500, 20 }, { 3000, 22.5 },
        },
    }
end

-- Wankel rotor: angular inertia about the eccentric shaft. The rotor spins at
-- 1/3 shaft speed about its own centre and its mass orbits at the eccentricity.
local function rotorInertia(mass: number, radius: number, eccentricity: number): number
    return 0.5 * mass * radius * radius / 9 + mass * eccentricity * eccentricity
end

-- Mazda 13B two-rotor, from the engine-sim script 13b.mr: eccentricity,
-- rotor radius and width, rotor mass, peripheral port timing and flow,
-- primaries, sound attenuation, carb, throttle gamma, timing curve, exhaust,
-- impulse response, starter, friction, crank inertia, rev limit and
-- synthesizer settings are that script's. 2 x 654 cc (3 sqrt(3) e R B).
-- Run by RotaryEngineModel. Where it differs from the script:
--   * the script's 8 cc rotor recess leaves the compression to engine-sim's
--     housing geometry; the 13B's 9.4:1 is used here.
--   * exhaust runner 20 cm^2 / 100 cc (the script's 6 cm^2 chokes the lumped
--     runner and drives its velocity supersonic, which swamps the audio).
--   * Exhaust/IntakeBackflow stand in for the gas momentum the lumped model
--     lacks; without them the ~190 deg of peripheral-port overlap floods the
--     chambers with exhaust and the engine won't idle. Apex seal leak is off:
--     even a small one kills compression at cranking speed.
--   * idle air 0.6% (the script's plate stalls this model), combustion gain
--     4.5 (~215 N m, ~240 hp at 9,500 rpm on the dyno tool) and audio volume
--     0.25: the rotary's exhaust pulses are far stronger than a piston
--     engine's, so at 5.5 the leveler pinned idle as loud as full throttle.
--     Idle air control targets 1,300 rpm (it sits ~950-1,450), and the
--     dilution limit makes the charges that reverted exhaust has thinned
--     misfire in runs: the choppy peripheral-port "brap".
--   * the script's 1080-degree distributor fires wire1 at 0/360/720 (rotor 0)
--     and wire2 at 180/540/900 (rotor 1): one face every 180 shaft degrees.
do
    local e = 1.5 * CM
    local rotorMass = 4.327
    local RUNNER_AREA = 20 * CM * CM
    local radius = 10.5 * CM

    Presets.Mazda13B = {
        Name = "Mazda 13B two-rotor",
        SimulationFrequency = 20000,
        HfGain = 0.1,
        Noise = 1.0,
        Jitter = 1.0,

        CompressionRatio = 9.4,
        Rotary = {
            Eccentricity = e,
            Radius = radius,
            Depth = 8 * CM,
            IntakePort = { 120, 140 },
            ExhaustPort = { 195, 218 },
            IntakePortArea = K_CARB(300),
            ExhaustPortArea = K_CARB(300),
            ApexLeakArea = 0,
            ExhaustBackflow = 0.1,
            IntakeBackflow = 0.01,
            OutletArea = 0.9 * RUNNER_AREA,
            -- charges under 20% fresh don't light, over 35% always do. A
            -- misfire's mixture comes back around in the overlap, so the idle
            -- fires in bursts of ~6 with ~6 misses between (~3 per second):
            -- the "brap" (Tools/test/rotary_idle.luau prints the pattern)
            DilutionLimit = { 0.2, 0.35 },
            IdleControlGain = 0.03,
        },

        RunnerVolume = 100 * CC,
        RunnerArea = RUNNER_AREA,
        PlenumVolume = 1.0e-3,
        ThrottleArea = K_CARB(400),
        IdleThrottle = 0.006,
        ExhaustPipe = {},
        ThrottleGamma = 1.5,
        SparkAdvance = 20,
        BurnDuration = 80,
        CombustionGain = 4.5,
        Inertia = 0.22986844776863666 * 0.5 + 2 * rotorInertia(rotorMass, radius, e),
        FrictionTorque = 15 * LB_FT,
        FrictionViscous = 0.02,
        StarterTorque = 80 * LB_FT,
        StarterSpeed = 280,
        IdleRpm = 1300,
        Redline = 10000,
        RevLimiterDuration = 0.05,

        Cylinders = {
            { Bank = 1, FiringAngle = 0, ExhaustSystem = 1, PrimaryLength = 12 * INCH, SoundAttenuation = 1.2 },
            { Bank = 1, FiringAngle = 180, ExhaustSystem = 1, PrimaryLength = 6 * INCH, SoundAttenuation = 1.0 },
        },
        ExhaustSystems = {
            { Length = (180 + 72) * INCH, AudioVolume = 0.25, ImpulseResponse = "minimal_muffling_02" },
        },

        TimingCurve = {
            { 0, 10 }, { 1000, 10 }, { 2000, 15 }, { 3000, 20 }, { 4000, 30 }, { 5000, 40 },
            { 6000, 50 }, { 7000, 55 }, { 8000, 60 }, { 9000, 65 }, { 10000, 70 },
        },
    }
end

-- "true dorito": four-rotor Wankel, from the engine-sim script true dorito.mr.
-- 4 x 727 cc. Same sourcing and the same departures as the 13B above
-- (runner, backflow, apex leak, idle air 0.4% instead of the script's 1%,
-- which idles at ~1,750 rpm, combustion gain 4.5: ~510 N m and ~490 hp at
-- 9,500 rpm; audio volume 1.5). The 38 cc rotor recesses give it a lower
-- compression ratio than the 13B. The script's 10,000 lb ft starter is kept.
-- Distributor (x 90 shaft degrees): rotor 0 @0, rotor 2 @1, rotor 1 @2,
-- rotor 3 @3, all into one exhaust; rev limit 9,500.
do
    local e = 2 * CM
    local rotorMass = 5.0
    local RUNNER_AREA = 20 * CM * CM
    local radius = 10 * CM
    local function rotor(firing: number, primary: number, attenuation: number): CylinderDef
        return {
            Bank = 1,
            FiringAngle = firing * 90,
            ExhaustSystem = 1,
            PrimaryLength = primary,
            SoundAttenuation = attenuation,
        }
    end

    Presets.TrueDorito = {
        Name = "True Dorito four-rotor",
        SimulationFrequency = 10000,
        HfGain = 0.01,
        Noise = 1.0,
        Jitter = 0.5,

        CompressionRatio = 8.5,
        Rotary = {
            Eccentricity = e,
            Radius = radius,
            Depth = 7 * CM,
            IntakePort = { 130, 150 },
            ExhaustPort = { 220, 240 },
            IntakePortArea = K_CARB(300),
            ExhaustPortArea = K_CARB(300),
            ApexLeakArea = 0,
            ExhaustBackflow = 0.1,
            IntakeBackflow = 0.03,
            OutletArea = 0.9 * RUNNER_AREA,
            -- as the 13B: the idle fires in bursts instead of surging evenly
            DilutionLimit = { 0.1, 0.25 },
            IdleControlGain = 0.03,
        },

        RunnerVolume = 100 * CC,
        RunnerArea = RUNNER_AREA,
        PlenumVolume = 2.0e-3,
        ThrottleArea = K_CARB(600),
        IdleThrottle = 0.004,
        ExhaustPipe = {},
        ThrottleGamma = 4.0,
        SparkAdvance = 30,
        BurnDuration = 80,
        CombustionGain = 4.5,
        Inertia = 0.22986844776863666 * 0.5 + 4 * rotorInertia(rotorMass, radius, e),
        FrictionTorque = 15 * LB_FT,
        FrictionViscous = 0.02,
        StarterTorque = 10000 * LB_FT,
        StarterSpeed = 1000,
        IdleRpm = 1300,
        Redline = 9500,
        RevLimiterDuration = 0.05,

        Cylinders = {
            rotor(0, 3 * INCH, 1.0), -- rotor0, wire1
            rotor(2, 1 * INCH, 0.9), -- rotor1, wire2
            rotor(1, 5 * INCH, 0.6), -- rotor2, wire3
            rotor(3, 10 * INCH, 1.0), -- rotor3, wire4
        },
        ExhaustSystems = {
            { Length = (180 + 72) * INCH, AudioVolume = 1.5, ImpulseResponse = "minimal_muffling_02" },
        },

        TimingCurve = {
            { 0, 20 }, { 1000, 20 }, { 2000, 30 }, { 3000, 50 }, { 4000, 50 },
        },
    }
end

-- Ford 5.0 "Coyote" V8 (2024 Mustang GT), from the engine-sim script coyote_gen_3.mr: bore,
-- stroke, rod, cam lobes, flow-bench tables, runners, plenum, intake and exhaust flow, firing
-- order, sound attenuation, exhaust, impulse response, timing curve, crank inertia, starter,
-- throttle gamma, rev limit and synthesizer settings are that script's.
--   * cam: the script's camshaft builder places the intake lobes on exhaust_lobe_center, so
--     both run at 112 deg (its intake_lobe_center of 90 is never used); kept as it runs.
--   * the script's 300 cc chamber is a placeholder (~3:1); the Coyote's 12:1 is used here.
--   * firing (wires x 90 deg): 0 @0, 3 @1, 4 @2, 7 @3, 1 @4, 2 @5, 5 @6, 6 @7. Bank b0
--     (wires 0-3) -> exhaust0, bank b1 (wires 4-7) -> exhaust1.
--   * friction: the script's 1 lb ft leaves nothing to slow the engine; 45 N m is a 5.0 V8's,
--     and the starter is raised to 250 N m to turn it.
-- Published (2024 Mustang GT): 480 hp (358 kW) @ 7,150 rpm, 415 lb ft (563 N m) @ 4,900 rpm.
do
    local bore, stroke = 92.96 * MM, 92.7 * MM
    local ivo, ivc = camEvents(112, 234, 0.821 * INCH, 0.05 * INCH)
    local evo, evc = camEvents(720 - 112, 235, 0.851 * INCH, 0.05 * INCH)
    local function cyl(bank: number, firingIndex: number, attenuation: number): CylinderDef
        return {
            Bank = bank,
            FiringAngle = firingIndex * 90,
            ExhaustSystem = bank,
            PrimaryLength = 20 * INCH,
            SoundAttenuation = attenuation,
        }
    end

    Presets.Coyote = {
        Name = "Ford 5.0 Coyote V8",
        SimulationFrequency = 10000,
        HfGain = 0.01,
        Noise = 1.0,
        Jitter = 0.1,

        Bore = bore,
        Stroke = stroke,
        RodLength = 120 * MM,
        CompressionRatio = 12.0,

        IntakeOpen = ivo % 720,
        IntakeClose = ivc,
        ExhaustOpen = evo,
        ExhaustClose = evc,
        -- flow-bench tables at 0.450" (281 / 246 CFM @ 28 inH2O)
        IntakeValveArea = FLOW_28(281),
        ExhaustValveArea = FLOW_28(246),
        RunnerVolume = 50 * CC,
        RunnerArea = 1.75 * INCH * 1.75 * INCH,
        PlenumVolume = 5.0e-3,
        ThrottleArea = K_CARB(3000),
        IdleThrottle = 0.0008,
        IdleAirGain = 0.005,
        GasModel = STOCK_GAS,
        ExhaustPipe = {},
        ThrottleGamma = 2.0,
        SparkAdvance = 40,
        BurnDuration = 45,
        -- the script's crank and flywheel (0.09 kg m^2) rev 44,000 rpm/s and hunt at idle;
        -- this is a production Coyote's crank, flywheel and clutch
        Inertia = 0.20,
        FrictionTorque = 45,
        FrictionViscous = 0.05,
        -- the script's 70 lb ft can't turn 12:1 against that friction
        StarterTorque = 250,
        StarterSpeed = 500,
        IdleRpm = 700,
        Redline = 8100,
        RevLimiterDuration = 0.1,

        Cylinders = {
            cyl(1, 0, 0.798), -- b0 wire0
            cyl(1, 4, 0.823), -- b0 wire1
            cyl(1, 5, 0.993), -- b0 wire2
            cyl(1, 1, 0.902), -- b0 wire3
            cyl(2, 2, 0.639), -- b1 wire4
            cyl(2, 6, 0.942), -- b1 wire5
            cyl(2, 7, 0.548), -- b1 wire6
            cyl(2, 3, 0.967), -- b1 wire7
        },
        ExhaustSystems = {
            { Length = 20 * INCH, AudioVolume = 4.0, ImpulseResponse = "minimal_muffling_01" },
            { Length = 20 * INCH, AudioVolume = 4.0, ImpulseResponse = "minimal_muffling_01" },
        },

        -- Calibrates the lumped combustion to the published 480 hp @ 7,150 and 563 N m @ 4,900 (Tools/test/dyno.luau).
        CombustionGain = 5.0,
        ChargeCurve = {
            { 1000, 0.815 }, { 2000, 0.884 }, { 3000, 0.937 }, { 4000, 0.989 }, { 5000, 1.019 },
            { 6000, 1.017 }, { 7000, 0.976 }, { 8000, 0.902 },
        },
        TimingCurve = {
            { 0, 18 }, { 1000, 40 }, { 9000, 40 },
        },
    }
end

-- Ford 4.6 2V "Modular" V8 (Crown Victoria), from the engine-sim script fordv8.mr: bore,
-- stroke, rod, cam lobes, lobe separation, carburettor, exhaust, firing order, timing curve,
-- crank inertia, friction and starter are that script's; the rev limit is 5,600.
--   * the script uses engine-sim's Edelbrock 6055 head and Performer RPM intake from its
--     library; their tables aren't in the script, so the valve areas are the 4.6 2V's
--     (44.5 / 34 mm valves at 0.5" lift as curtain area) and the plenum ~3 L.
--   * compression is the production 9.4:1 (the chamber comes from the library head).
--   * firing (wires x 90 deg): 1-8-4-3-6-5-7-2. Bank b0 (odd) -> exhaust0 (100"), b1 (even)
--     -> exhaust1 (130").
-- Published (2011 Crown Victoria P71): 250 hp (186 kW) @ 4,900 rpm, 297 lb ft (403 N m) @ 4,000.
do
    local ivo, ivc = camEvents(113, 192, 0.504 * INCH, 0.05 * INCH)
    local evo, evc = camEvents(720 - 113, 184, 0.531 * INCH, 0.05 * INCH)
    local function cyl(bank: number, wire: number): CylinderDef
        local firing = ({ 0, 7, 3, 2, 5, 4, 6, 1 })[wire]
        return {
            Bank = bank,
            FiringAngle = firing * 90,
            ExhaustSystem = bank,
            PrimaryLength = 15 * INCH,
            SoundAttenuation = 1.0,
        }
    end

    Presets.Ford46 = {
        Name = "Ford 4.6 Modular V8",
        SimulationFrequency = 10000,
        -- engine-sim engine() defaults (the script doesn't set them)
        HfGain = 0.01,
        Noise = 1.0,
        Jitter = 0.5,

        Bore = 3.55 * INCH,
        Stroke = 90.2 * MM,
        RodLength = 5.933 * INCH,
        CompressionRatio = 9.4,

        IntakeOpen = ivo % 720,
        IntakeClose = ivc,
        ExhaustOpen = evo,
        ExhaustClose = evc,
        IntakeValveArea = math.pi * 44.5 * MM * 0.5 * INCH * 0.8,
        ExhaustValveArea = math.pi * 34 * MM * 0.5 * INCH * 0.8,
        RunnerVolume = 50 * CC,
        RunnerArea = 1.5 * INCH * 1.75 * INCH,
        PlenumVolume = 3.0e-3,
        ThrottleArea = K_CARB(550),
        IdleThrottle = 0.002,
        GasModel = STOCK_GAS,
        ExhaustPipe = {},
        ThrottleGamma = 2.0,
        SparkAdvance = 30,
        BurnDuration = 45,
        Inertia = 0.22986844776863666 * 2,
        FrictionTorque = 10 * LB_FT,
        FrictionViscous = 0.04,
        StarterTorque = 300 * LB_FT,
        StarterSpeed = 200,
        IdleRpm = 650,
        -- the Crown Vic's limiter (the script's 8,000 is far past a stock 2V 4.6)
        Redline = 5600,
        RevLimiterDuration = 0.1,

        Cylinders = {
            cyl(1, 1), -- b0 wire1
            cyl(1, 3), -- b0 wire3
            cyl(1, 5), -- b0 wire5
            cyl(1, 7), -- b0 wire7
            cyl(2, 2), -- b1 wire2
            cyl(2, 4), -- b1 wire4
            cyl(2, 6), -- b1 wire6
            cyl(2, 8), -- b1 wire8
        },
        ExhaustSystems = {
            { Length = 100 * INCH, AudioVolume = 4.0, ImpulseResponse = "default_0" },
            { Length = 130 * INCH, AudioVolume = 4.0, ImpulseResponse = "default_0" },
        },

        -- Calibrates the lumped combustion to the published 250 hp @ 4,900 and 403 N m @ 4,000.
        CombustionGain = 4.0,
        ChargeCurve = {
            { 1000, 0.826 }, { 2000, 0.913 }, { 3000, 1.078 }, { 4000, 1.238 }, { 4500, 1.318 },
            { 5000, 1.340 }, { 5500, 1.370 }, { 6000, 1.397 }, { 7000, 1.506 }, { 8000, 1.457 },
        },
        TimingCurve = {
            { 0, 12 }, { 1000, 12 }, { 2000, 20 }, { 3000, 40 }, { 4000, 45 },
            { 5000, 50 }, { 6000, 55 }, { 7000, 60 },
        },
    }
end

-- Mazda 1.8 BP inline-4 (NA Miata), from the engine-sim script NA_Miata.mr: bore, stroke,
-- rod, cam lobes and lobe separation, plenum, intake and exhaust flow, firing order, timing
-- curve, crank inertia, starter and rev limit are that script's.
--   * the script uses engine-sim's generic_small_engine_head; its tables aren't in the
--     script, so the valve areas are the BP's (2 x 33 / 2 x 28 mm valves at the lobe's 8.58 mm,
--     as curtain area, x the script's 0.9 flow attenuation).
--   * the script's deck, piston and 52 cc chamber come to ~7.5:1; the BP's 9.0:1 is used here.
--   * firing (wires x 180 deg): 1-2-4-3 as the script's distributor.
--   * friction: the script's 1 lb ft is raised to an inline-4's 15 N m.
-- Published (1994 Miata 1.8): 128 hp (95 kW) @ 6,500 rpm, 110 lb ft (149 N m) @ 5,000 rpm.
do
    local ivo, ivc = camEvents(110, 210, 8.58 * MM, 0.05 * INCH)
    local evo, evc = camEvents(720 - 110, 215, 8.58 * MM, 0.05 * INCH)
    local firing = { 0, 180, 540, 360 }
    local cyls: { CylinderDef } = {}
    for i = 1, 4 do
        cyls[i] = {
            Bank = 1,
            FiringAngle = firing[i],
            ExhaustSystem = 1,
            PrimaryLength = 10 * INCH,
            SoundAttenuation = 1.0,
        }
    end

    Presets.MazdaBP = {
        Name = "Mazda 1.8 BP inline-4 (NA Miata)",
        InductionVolume = 0.25,
        SimulationFrequency = 10000,
        -- engine-sim engine() defaults (the script doesn't set them)
        HfGain = 0.01,
        Noise = 1.0,
        Jitter = 0.5,

        Bore = 83 * MM,
        Stroke = 85 * MM,
        RodLength = 132.95 * MM,
        CompressionRatio = 9.0,

        IntakeOpen = ivo % 720,
        IntakeClose = ivc,
        ExhaustOpen = evo,
        ExhaustClose = evc,
        IntakeValveArea = 2 * math.pi * 33 * MM * 8.58 * MM * 0.9,
        ExhaustValveArea = 2 * math.pi * 28 * MM * 8.58 * MM * 0.9,
        RunnerVolume = 40 * CC,
        RunnerArea = 1.5 * INCH * 1.5 * INCH,
        PlenumVolume = 2.0e-3,
        ThrottleArea = K_CARB(500),
        IdleThrottle = 0.004,
        GasModel = STOCK_GAS,
        ExhaustPipe = {},
        ThrottleGamma = 2.0,
        SparkAdvance = 25,
        BurnDuration = 45,
        Inertia = 0.22986844776863666 * 0.8,
        FrictionTorque = 15,
        FrictionViscous = 0.025,
        StarterTorque = 70 * LB_FT,
        StarterSpeed = 300,
        IdleRpm = 850,
        Redline = 7000,
        RevLimiterDuration = 0.095,

        Cylinders = cyls,
        ExhaustSystems = {
            { Length = 100 * INCH, AudioVolume = 1.0, ImpulseResponse = "default_0" },
        },

        -- Calibrates the lumped combustion to the published 128 hp @ 6,500 and 149 N m @ 5,000.
        CombustionGain = 4.0,
        ChargeCurve = {
            { 1000, 0.920 }, { 2000, 0.939 }, { 3000, 0.960 }, { 4000, 1.016 }, { 5000, 1.074 },
            { 5500, 1.076 }, { 6000, 1.087 }, { 6500, 1.061 }, { 7000, 1.050 },
        },
        TimingCurve = {
            { 0, 12 }, { 1000, 12 }, { 2000, 20 }, { 3000, 26 }, { 4000, 30 },
            { 5000, 34 }, { 6000, 38 }, { 7000, 38 },
        },
    }
end

-- Inline-6 (Toyota Chaser JZX100), from the engine-sim script i6.mr: bore, stroke, rod,
-- lobe separation, plenum, intake and exhaust flow, firing order, exhaust (cylinders alternate
-- between two systems), timing curve, crank inertia, friction, starter and rev limit are that
-- script's. The script is naturally aspirated and so is this.
--   * cam: the script uses engine-sim's Comp Cams Magnum 11-450-8 lobe, which isn't in the
--     script; taken as 224 deg @ 0.050" and 0.50" lift.
--   * head: generic_small_engine_head; the valve areas are a 2JZ's (2 x 34.5 / 2 x 29 mm
--     valves at 10 mm lift, as curtain area).
--   * the script's 240 mm deck sits the piston 20 mm down the bore (~4:1); 10:1 is used here.
--   * firing (wires x 120 deg): 1-5-3-6-2-4. Cylinders 1, 3, 5 -> exhaust0; 2, 4, 6 -> exhaust1.
do
    local stroke = 86.4 * MM
    local ivo, ivc = camEvents(110, 224, 0.50 * INCH, 0.05 * INCH)
    local evo, evc = camEvents(720 - 110, 224, 0.50 * INCH, 0.05 * INCH)
    local firing = { 0, 4, 2, 5, 1, 3 }
    local cyls: { CylinderDef } = {}
    for i = 1, 6 do
        cyls[i] = {
            Bank = 1,
            FiringAngle = firing[i] * 120,
            ExhaustSystem = if i % 2 == 1 then 1 else 2,
            PrimaryLength = 15 * INCH,
            SoundAttenuation = 1.0,
        }
    end

    Presets.Inline6 = {
        Name = "Inline 6 (JZX100)",
        InductionVolume = 0.4,
        SimulationFrequency = 10000,
        -- engine-sim engine() defaults (the script doesn't set them)
        HfGain = 0.01,
        Noise = 1.0,
        Jitter = 0.5,

        Bore = 86.4 * MM,
        Stroke = stroke,
        RodLength = (220 - 0.5 * 86.4 - 32.8) * MM,
        CompressionRatio = 10.0,

        IntakeOpen = ivo % 720,
        IntakeClose = ivc,
        ExhaustOpen = evo,
        ExhaustClose = evc,
        IntakeValveArea = 2 * math.pi * 34.5 * MM * 10 * MM,
        ExhaustValveArea = 2 * math.pi * 29 * MM * 10 * MM,
        RunnerVolume = 45 * CC,
        RunnerArea = 1.5 * INCH * 1.5 * INCH,
        PlenumVolume = 5.0e-3,
        ThrottleArea = K_CARB(500),
        IdleThrottle = 0.004,
        GasModel = STOCK_GAS,
        ExhaustPipe = {},
        ThrottleGamma = 1.0,
        SparkAdvance = 30,
        BurnDuration = 45,
        Inertia = 0.22986844776863666 * 0.9,
        FrictionTorque = 10 * LB_FT,
        FrictionViscous = 0.035,
        StarterTorque = 320 * LB_FT,
        StarterSpeed = 250,
        IdleRpm = 750,
        Redline = 9200,
        RevLimiterDuration = 0.1,

        Cylinders = cyls,
        ExhaustSystems = {
            { Length = 120 * INCH, AudioVolume = 1.0, ImpulseResponse = "default_0" },
            { Length = 120 * INCH, AudioVolume = 0.8, ImpulseResponse = "default_0" },
        },

        -- Calibrates the lumped combustion to the a naturally aspirated 3.0 I6: ~295 N m @ 5,000, ~205 kW @ 9,000.
        CombustionGain = 4.4,
        ChargeCurve = {
            { 1000, 0.999 }, { 3000, 0.993 }, { 4000, 1.019 }, { 5000, 1.045 }, { 6000, 1.089 },
            { 7000, 1.131 }, { 8000, 1.094 }, { 9000, 1.048 },
        },
        TimingCurve = {
            { 0, 10 }, { 1000, 15 }, { 2000, 20 }, { 3000, 25 }, { 4000, 30 },
            { 5000, 35 }, { 6000, 40 }, { 7000, 45 },
        },
    }
end

-- Chrysler 6.2 Hemi "Hellcat" V8 (Dodge Charger SRT Hellcat), from the engine-sim script
-- Chrysler_Hemi_6.2_Hellcat.mr by Havok1199 (after GearheadLydia's 6.1 SRT8): bore, stroke,
-- rod, cam lobes, lobe separation and advance, flow-bench tables (x 0.8), runners, plenum,
-- throttle, the single shared exhaust with its staggered primaries, firing order, timing
-- curve, crank inertia, friction, starter, rev limit and synthesizer settings are that
-- script's.
--   * the script is naturally aspirated; the supercharger is added here from the production
--     engine (IHI 2.38 L/rev twin-screw, intercooled, ~11.6 psi peak). The lumped model's
--     blower is a Roots, so this is its closest match.
--   * the script's deck puts the piston crown 0.06" above the deck; the Hellcat's 9.5:1 is used.
--   * firing (wires x 90 deg): 1-8-4-3-6-5-7-2. Both banks into one exhaust.
-- Published (2022 Charger SRT Hellcat): 717 hp (535 kW) @ 6,000 rpm, 650 lb ft (881 N m) @ 4,800.
do
    local bore, stroke = 4.09 * INCH, 3.578 * INCH
    local advance = 0.5
    local ivo, ivc = camEvents(117.25 - advance, 215, 0.561 * INCH, 0.05 * INCH)
    local evo, evc = camEvents(720 - 117.25 - advance, 223, 0.551 * INCH, 0.05 * INCH)
    local boreSpacing = 4.460 * INCH
    local stagger = 1 * INCH
    local function cyl(bank: number, wire: number, pipe: number): CylinderDef
        local firing = ({ 0, 7, 3, 2, 5, 4, 6, 1 })[wire]
        return {
            Bank = bank,
            FiringAngle = firing * 90,
            ExhaustSystem = 1,
            PrimaryLength = 50 * INCH + pipe * boreSpacing + (if bank == 1 then stagger else 0),
            SoundAttenuation = 1.0,
        }
    end
    local exhaustRunnerArea = math.pi * (0.7 * INCH) ^ 2

    Presets.HemiHellcat = {
        Name = "Chrysler 6.2 Hemi Hellcat (supercharged)",
        SimulationFrequency = 7000,
        HfGain = 0.03,
        Noise = 1.0,
        Jitter = 0.5,

        Bore = bore,
        Stroke = stroke,
        RodLength = 6.242 * INCH,
        CompressionRatio = 9.5,

        IntakeOpen = ivo % 720,
        IntakeClose = ivc,
        ExhaustOpen = evo,
        ExhaustClose = evc,
        -- flow-bench tables at 0.600" x 0.8 (251 / 182 CFM @ 28 inH2O)
        IntakeValveArea = FLOW_28(314 * 0.8),
        ExhaustValveArea = FLOW_28(228 * 0.8),
        RunnerVolume = exhaustRunnerArea * 4 * INCH,
        RunnerArea = exhaustRunnerArea,
        PlenumVolume = 1.0e-3,
        ThrottleArea = K_CARB(1400),
        IdleThrottle = 0.002,
        GasModel = STOCK_GAS,
        ExhaustPipe = {},
        ThrottleGamma = 1.0,
        SparkAdvance = 30,
        BurnDuration = 45,
        -- crank (57 lb disk, r = stroke / 2) + flywheel (57 lb, r = 6") + 20 kg misc at 8 cm
        Inertia = 0.5 * 57 * 0.45359237 * (stroke / 2) ^ 2
            + 0.5 * 57 * 0.45359237 * (6 * INCH) ^ 2 + 0.5 * 20 * 0.08 ^ 2,
        FrictionTorque = 55,
        FrictionViscous = 0.07,
        StarterTorque = 150 * LB_FT,
        StarterSpeed = 1200,
        IdleRpm = 700,
        Redline = 6200,
        RevLimiterDuration = 0.09,

        Cylinders = {
            cyl(1, 1, 1.6), -- b0 wire1
            cyl(1, 3, 1.2), -- b0 wire3
            cyl(1, 5, 0.8), -- b0 wire5
            cyl(1, 7, 0.0), -- b0 wire7
            cyl(2, 2, 1.6), -- b1 wire2
            cyl(2, 4, 1.2), -- b1 wire4
            cyl(2, 6, 0.8), -- b1 wire6
            cyl(2, 8, 0.0), -- b1 wire8
        },
        ExhaustSystems = {
            { Length = 2800 * MM, AudioVolume = 5.0, ImpulseResponse = "mild_exhaust_0" },
        },

        -- Calibrates the lumped combustion to the published 881 N m from ~4,500 rpm and ~535 kW @ 6,000.
        CombustionGain = 5.0,
        ChargeCurve = {
            { 1000, 0.708 }, { 2000, 0.858 }, { 3000, 0.938 }, { 4000, 0.991 }, { 4500, 1.010 },
            { 5000, 1.048 }, { 5500, 1.086 }, { 6000, 1.065 },
        },
        TimingCurve = {
            { 0, 35 }, { 1000, 40 }, { 7000, 40 },
        },

        Supercharger = {
            Displacement = 2.38e-3,
            DriveRatio = 2.36,
            Lobes = 4,
            InletVolume = 2.5e-3,
            LeakArea = 3.0e-5,
            BypassArea = 2.4e-3,
            BypassClose = { 0.25, 0.75 },
            MechanicalEfficiency = 0.85,
            AdiabaticEfficiency = 0.70,
            IntercoolerEffectiveness = { 0.9, 0.6 },
            MaxRotorRpm = 15000,
            RotorInertia = 0.005,
            BoostRetard = 12,
            WhineVolume = 25.0,
        },
    }
end

return Presets
