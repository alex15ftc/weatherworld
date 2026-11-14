--!strict
--!native
-- Compact engine model that produces the signals engine-sim's
-- PistonEngineSimulator::writeToSynthesizer() reads:
--   chamber->m_exhaustRunnerAndPrimary.pressure()        (Pa, absolute)
--   chamber->m_exhaustRunnerAndPrimary.dynamicPressure() (Pa)
--
-- engine-sim gets these from a full rigid-body crank/piston solver and a
-- multi-volume gas simulation. This model is much smaller, a lumped
-- "filling and emptying" model, but it follows the same physics:
--   * slider-crank cylinder volume, polytropic compression and expansion
--   * Wiebe heat release from the spark, rev limiter spark cut, misfire spread
--   * orifice flow through intake valve, exhaust valve, runner outlet and throttle
--   * crank torque from cylinder pressure, friction, starter, external load
--   * optional Roots supercharger: positive-displacement rotors between the
--     throttle body and the plenum, clearance leakage, a bypass valve that
--     opens at light load, the drive torque it takes from the crank, and the
--     rotor-pocket discharge pulses that make supercharger whine
--   * optional spark timing curve with boost retard
--
-- It is NOT a port of engine-sim's physics. Swap it for your own model by
-- feeding EngineAudioSimulator any object with the same `step` / getters.

local Presets = require(script.Parent.Presets)
local RotaryEngineModel = require(script.Parent.RotaryEngineModel)
local FuelMap = require(script.Parent.FuelMap)

local ATM = 101325.0
local R_AIR = 287.0
local T_INTAKE = 300.0
local T_EXHAUST = 1000.0
local GAMMA = 1.3
local GAMMA_AIR = 1.4
local CD = 0.7

local PI = math.pi
local TAU = 2 * PI
local DEG = PI / 180
local sqrt = math.sqrt
local sin = math.sin
local cos = math.cos
local exp = math.exp
local min = math.min
local max = math.max
local log = math.log
local clamp = math.clamp

-- idle air control (see the throttle body in step)
local IAC_SPEED_FILTER = 0.03 -- s
local IAC_RATE_FILTER = 0.05 -- s
local IAC_LEAD = 0.15 -- s
-- proportional share of IdleAirGain, and the integral's time. IdleAirGain is
-- set for stall recovery and can be tens of times the air an idle needs, so
-- both are kept low enough to settle on every LT4 cam.
local IAC_P = 0.1
local IAC_INTEGRAL = 5.0 -- s
local IAC_CRANK = 0.08 -- integral preload while cranking, share of the limit
local IAC_HOLD_ABOVE = 0.25 -- the integral holds above IdleRpm * (1 + this)...
local IAC_HOLD_TIME = 1.5 -- s, ...for this long

export type CylinderState = {
    def: Presets.CylinderDef,
    phase: number, -- radians offset in 720 cycle
    pc: number, -- cylinder pressure (abs)
    vc: number, -- cylinder volume
    pr: number, -- exhaust runner + primary pressure (abs)
    vr: number, -- runner volume
    runnerVelocity: number,
    burnRatio: number, -- pressure multiplier for the current combustion event
    burnProgress: number, -- 0..1 Wiebe fraction applied so far
    firingCount: number, -- combustion attempts, for the firing display
    firingStrength: number, -- strength of the last burn (zero for a cut)
    sparkArmed: boolean,
    fresh: number, -- unburned fraction of the cylinder charge (its air, so its O2)
    runnerFresh: number,
    -- GasModel only: fuel, as a fraction of the charge in stoichiometric units
    -- (fuel == fresh is a stoichiometric mixture). The burned share (CO2,
    -- H2O, N2) of a volume is 1 - fresh.
    fuel: number,
    runnerFuel: number,
    bankCrowding: number, -- 1 when the previous cylinder on this bank fired 90 degrees earlier
    blowdownMean: number, -- smoothed pressure rise at the exhaust port
    idleBlowdown: number,
    -- unburned fuel / air left in the cylinder by its last spark event (pV),
    -- carried into the runner with the exhaust flow
    slugFuel: number,
    slugAir: number,
    exhaust: FuelMap.Exhaust, -- the runner's unburned mixture and afterfire
}

local EngineModel = {}
EngineModel.__index = EngineModel

export type EngineModel = typeof(setmetatable({} :: {
    preset: Presets.EnginePreset,
    cylinders: { CylinderState },
    theta: number, -- crank angle (rad), 0..4pi
    omega: number, -- rad/s
    plenumPressure: number,
    throttle: number,
    ignition: boolean,
    starter: boolean,
    load: number, -- external load torque N m (dyno / vehicle)
    revLimitTimer: number,
    pistonArea: number,
    crankRadius: number,
    clearanceVolume: number,
    rng: Random,
    lastTorque: number,
    inertia: number, -- crank + flywheel (+ supercharger rotors, reflected)
    -- supercharger state (inletPressure stays at ATM without one)
    inletPressure: number,
    blowerAngle: number,
    blowerTorque: number,
    whine: number, -- discharge pulse signal for the synthesizer's aux channel
    induction: number, -- induction pulses at the intake mouth (AC part of the throttle-body airflow)
    inductionMean: number, -- slow average of that airflow the pulses are measured against
    throttleFlow: number, -- this step's air flow in through the throttle body, m^3/s at ATM
    chargeTemperature: number, -- K, air entering the cylinders
    intakePhase: number, -- degrees of intake cam retard (phaser)
    iacRpm: number, -- crank speed seen by the idle air control (firing ripple filtered out)
    iacRate: number, -- its rate of change, rpm/s
    iacOpening: number, -- the idle air control's integral (settled) opening
    iacHeld: number, -- s the integral has been held (speed well above idle)
    camIndex: number, -- zero selects the preset's original cam
    superchargerAirflow: number, -- rotor displacement relative to the preset
    inletFresh: number,
    plenumFresh: number,
    -- GasModel only: combustion events since the engine was made
    fires: number,
    misfires: number,
    -- fuel table, ignition cut and afterfire (FuelMap.forPreset, shared per preset)
    fuelMap: FuelMap.FuelMap,
    sparkCutTimer: number, -- s left of an ignition cut (flat shift / held cut)
    fuelPercent: number, -- fuel delivered this step, % of stoichiometric
    afterfires: number, -- exhaust ignitions since the engine was made
    afterfireLog: FuelMap.AfterfireLog, -- each of them, for the flames
}, EngineModel))

-- Fourier series of one rotor-pocket discharge pulse, exp(-phase / tau) over
-- the pocket period: 2 |c_k| cos(2 pi k phase + arg c_k),
-- c_k = (1 - e^(-1/tau)) / (1/tau + i 2 pi k).
local WHINE_TAU = 0.2
-- Induction pulses: high-pass corner (Hz) and soft-clip level (m^3/s)
local INDUCTION_CUTOFF = 40
local INDUCTION_CLIP = 0.25
local WHINE_HARMONICS: { { number } } = {}
for k = 1, 6 do
    local re = 1 / WHINE_TAU
    local im = TAU * k
    local mag = 2 * (1 - exp(-1 / WHINE_TAU)) / sqrt(re * re + im * im)
    WHINE_HARMONICS[k] = { mag, -math.atan2(im, re) }
end

local function gaussian(rng: Random): number
    local u1 = max(rng:NextNumber(), 1e-12)
    local u2 = rng:NextNumber()
    return sqrt(-2 * log(u1)) * cos(TAU * u2)
end

-- Smooth valve lift 0..1 for a local cycle angle in degrees.
local function valveLift(a: number, open: number, close: number): number
    local dur = (close - open) % 720
    local d = (a - open) % 720
    if d >= dur then
        return 0
    end
    return 0.5 - 0.5 * cos(TAU * d / dur)
end

-- The lumped flow solver transports pressure-volume. Use the same quantity
-- to mix the fresh charge carried by incoming gas into the receiving volume.
local function mixFresh(fresh: number, pv: number, incomingFresh: number, incomingPv: number): number
    return fresh + (incomingFresh - fresh) * (incomingPv / (pv + incomingPv))
end

-- Moves gas between two volumes through an orifice. Returns transferred PV
-- (positive = a -> b). invVb = 0 makes b an infinite reservoir (atmosphere).
local function orifice(
    pa: number,
    invVa: number,
    pb: number,
    invVb: number,
    area: number,
    rtA: number,
    rtB: number,
    dt: number
): number
    if area <= 0 then
        return 0
    end
    local dp = pa - pb
    if dp == 0 then
        return 0
    end

    local pUp, rt = pa, rtA
    if dp < 0 then
        pUp, rt = pb, rtB
        dp = -dp
    end

    local v = sqrt(2 * dp * rt / pUp)
    local choke = sqrt(1.4 * rt)
    if v > choke then
        v = choke
    end

    local dn = CD * area * v * pUp * dt
    local eq = dp / (invVa + invVb)
    if dn > eq then
        dn = eq
    end

    return if pa > pb then dn else -dn
end

function EngineModel.new(preset: Presets.EnginePreset): EngineModel
    if preset.Rotary then
        return (RotaryEngineModel.new(preset) :: any) :: EngineModel
    end
    local bore = preset.Bore :: number
    local area = PI * 0.25 * bore * bore
    local displacement = area * (preset.Stroke :: number)
    local clearance = displacement / (preset.CompressionRatio - 1)

    local self = setmetatable({
        preset = preset,
        cylinders = {},
        theta = 0,
        omega = 0,
        plenumPressure = ATM,
        throttle = 0,
        ignition = true,
        starter = false,
        load = 0,
        revLimitTimer = 0,
        pistonArea = area,
        crankRadius = (preset.Stroke :: number) * 0.5,
        clearanceVolume = clearance,
        rng = Random.new(),
        lastTorque = 0,
        inertia = preset.Inertia
            + (if preset.Supercharger
                then preset.Supercharger.RotorInertia * preset.Supercharger.DriveRatio ^ 2
                else 0),
        inletPressure = ATM,
        blowerAngle = 0,
        blowerTorque = 0,
        whine = 0,
        induction = 0,
        inductionMean = 0,
        throttleFlow = 0,
        chargeTemperature = T_INTAKE,
        intakePhase = 0,
        iacRpm = 0,
        iacRate = 0,
        iacOpening = 0,
        iacHeld = 0,
        camIndex = preset.DefaultCamIndex or 0,
        superchargerAirflow = 1,
        inletFresh = 1,
        plenumFresh = 1,
        fires = 0,
        misfires = 0,
        fuelMap = FuelMap.forPreset(preset),
        sparkCutTimer = 0,
        fuelPercent = 100,
        afterfires = 0,
        afterfireLog = FuelMap.newLog(),
    }, EngineModel)

    for i, def in preset.Cylinders do
        local gap = 720
        if preset.CamOptions then
            for _, other in preset.Cylinders do
                if other ~= def and other.ExhaustSystem == def.ExhaustSystem then
                    gap = min(gap, (def.FiringAngle - other.FiringAngle) % 720)
                end
            end
        end
        local cyl: CylinderState = {
            def = def,
            phase = (def.FiringAngle - 360) * DEG,
            pc = ATM,
            vc = clearance,
            pr = ATM,
            vr = preset.RunnerVolume + def.PrimaryLength * preset.RunnerArea,
            runnerVelocity = 0,
            burnRatio = 1,
            burnProgress = 1,
            firingCount = 0,
            firingStrength = 0,
            sparkArmed = true,
            fresh = 1,
            runnerFresh = 0,
            fuel = 1,
            runnerFuel = 0,
            bankCrowding = clamp((180 - gap) / 90, 0, 1),
            blowdownMean = 0,
            idleBlowdown = 0,
            slugFuel = 0,
            slugAir = 0,
            exhaust = FuelMap.newExhaust(ATM * displacement, def.ExhaustSystem),
        }
        self.cylinders[i] = cyl
        cyl.vc = self:_volume(self:_localAngle(cyl))
    end

    return self
end

-- Local cycle angle in degrees, 0..720, 0 = TDC at the start of intake.
function EngineModel._localAngle(self: EngineModel, cyl: CylinderState): number
    return ((self.theta - cyl.phase) % (4 * PI)) / DEG
end

function EngineModel._volume(self: EngineModel, aDeg: number): number
    local phi = aDeg * DEG
    local r = self.crankRadius
    local l = self.preset.RodLength :: number
    local s = sin(phi)
    local x = r * cos(phi) + sqrt(l * l - r * r * s * s)
    return self.clearanceVolume + self.pistonArea * (l + r - x)
end

function EngineModel._dVdTheta(self: EngineModel, aDeg: number): number
    local phi = aDeg * DEG
    local r = self.crankRadius
    local l = self.preset.RodLength :: number
    local s = sin(phi)
    local c = cos(phi)
    local root = sqrt(l * l - r * r * s * s)
    local dx = -r * s - (r * r * s * c) / root
    return -self.pistonArea * dx
end

function EngineModel.getRpm(self: EngineModel): number
    return self.omega * 60 / TAU
end

function EngineModel.getSpeed(self: EngineModel): number
    return self.omega
end

function EngineModel.getCylinderCount(self: EngineModel): number
    return #self.cylinders
end

function EngineModel.getExhaustSystemCount(self: EngineModel): number
    return #self.preset.ExhaustSystems
end

function EngineModel.getManifoldPressure(self: EngineModel): number
    return self.plenumPressure
end

function EngineModel.getTorque(self: EngineModel): number
    return self.lastTorque
end

-- Plenum (manifold) pressure above atmospheric, Pa. Negative = vacuum.
function EngineModel.getRedline(self: EngineModel): number
    local cams = self.preset.CamOptions
    local cam = if cams then cams[self.camIndex] else nil
    return (if cam then cam.Redline else nil) or self.preset.Redline
end

function EngineModel.getBoost(self: EngineModel): number
    return self.plenumPressure - ATM
end

function EngineModel.getWhine(self: EngineModel): number
    return self.whine
end

function EngineModel.getInduction(self: EngineModel): number
    return self.induction
end

function EngineModel.hasSupercharger(self: EngineModel): boolean
    return self.preset.Supercharger ~= nil
end

-- Cut the spark for `duration` seconds (flat shift, or a held cut). Fuel keeps
-- flowing at the fuel map's CutFuel, so the charges light in the exhaust.
function EngineModel.cutSpark(self: EngineModel, duration: number)
    self.sparkCutTimer = max(self.sparkCutTimer, duration)
end

-- Afterfire pressure in cylinder i's runner (Pa above the runner's own)
function EngineModel.getAfterfirePressure(self: EngineModel, i: number): number
    return self.cylinders[i].exhaust.pressure
end

function EngineModel.isSparkCut(self: EngineModel): boolean
    return self.sparkCutTimer > 0 or self.revLimitTimer > 0
end

-- Piecewise-linear lookup in a { {x, y}, ... } table, clamped at both ends.
local function lookup(curve: { { number } }, x: number): number
    if x <= curve[1][1] then
        return curve[1][2]
    end
    for i = 2, #curve do
        local b = curve[i]
        if x <= b[1] then
            local a = curve[i - 1]
            return a[2] + (b[2] - a[2]) * (x - a[1]) / (b[1] - a[1])
        end
    end
    return curve[#curve][2]
end

local function sparkAdvance(preset: Presets.EnginePreset, rpm: number): number
    local curve = preset.TimingCurve
    if not curve then
        return preset.SparkAdvance
    end
    return lookup(curve, rpm)
end

-- Runner (exhaust runner + primary) absolute pressure for cylinder i.
function EngineModel.getRunnerPressure(self: EngineModel, i: number): number
    return self.cylinders[i].pr
end

-- GasSystem::dynamicPressure(dx, dy): compressible stagnation pressure rise
-- p * ((1 + (k-1)/2 * M^2)^(k/(k-1)) - 1) for flow along (dx, dy), 0 when the
-- flow points the other way. The runner here is 1D, so dir = +1 / -1.
function EngineModel.getRunnerDynamicPressure(self: EngineModel, i: number, dir: number): number
    local cyl = self.cylinders[i]
    local v = cyl.runnerVelocity * dir
    if v <= 0 then
        return 0
    end
    local k = 1.4 -- 5 degrees of freedom
    local p = cyl.pr
    local density = p / (R_AIR * T_EXHAUST)
    local c2 = p * k / density
    local x = 1 + ((k - 1) / 2) * (v * v / c2)
    return p * (x ^ (k / (k - 1)) - 1)
end

function EngineModel.step(self: EngineModel, dt: number)
    local preset = self.preset
    local cams = preset.CamOptions
    local cam = if cams then cams[self.camIndex] else nil
    -- Keep the charge history warm on stock so a live cam swap starts with
    -- the gas already in the engine. Stock combustion keeps its calibration.
    -- a cam may bring its own combustion limits (only with a preset GasModel)
    local gas = if preset.GasModel and cam and cam.GasModel then cam.GasModel else preset.GasModel
    local useFresh = cam ~= nil or preset.TrackFreshCharge == true or gas ~= nil
    local trackFresh = cams ~= nil or useFresh
    local rng = self.rng
    local rpm = self.omega * 60 / TAU

    -- Rev limiter (spark cut)
    if rpm > self:getRedline() then
        self.revLimitTimer = preset.RevLimiterDuration
    elseif self.revLimitTimer > 0 then
        self.revLimitTimer -= dt
    end
    local shiftCut = self.sparkCutTimer > 0
    if shiftCut then
        self.sparkCutTimer -= dt
    end
    local limiterCut = self.revLimitTimer > 0
    local sparkAllowed = self.ignition and not limiterCut and not shiftCut

    -- Advance the crank
    local oldTheta = self.theta
    self.theta = (self.theta + self.omega * dt) % (4 * PI)
    local wrapped = self.omega * dt

    -- Throttle body: atmosphere -> plenum, with a small idle air control.
    -- A PI controller on speed with the firing ripple filtered out: the
    -- integral settles on the opening that holds IdleRpm, the proportional
    -- part looks IAC_LEAD seconds ahead along the speed's trend. Acting on
    -- the speed deficit alone hunted: the plenum takes a while to fill and
    -- the crank a while to answer, which kept the LT4 swinging ~1 Hz between
    -- about 600 and 900 rpm (300 and 1500 on the mild cams).
    local previousIacRpm = self.iacRpm
    self.iacRpm += (rpm - previousIacRpm) * min(1, dt / IAC_SPEED_FILTER)
    self.iacRate += ((self.iacRpm - previousIacRpm) / dt - self.iacRate) * min(1, dt / IAC_RATE_FILTER)
    local idleBoost = 0
    if self.ignition and rpm > 200 then
        local gain = (if cam then cam.IdleAirGain else nil) or preset.IdleAirGain or 0.08
        local limit = gain * 0.5
        local error = (preset.IdleRpm - self.iacRpm) / preset.IdleRpm
        if self.starter then
            -- crank air: start near where the integral settles (6..12% of
            -- the limit on every preset), not from closed
            self.iacOpening = max(self.iacOpening, IAC_CRANK * limit)
        end
        -- held for a while when speed is well above idle (the start flare,
        -- a blip), so it is not unwound to closed by the time the speed comes
        -- back; an engine that idles there on its base opening unwinds it
        local near = error > -IAC_HOLD_ABOVE
        self.iacHeld = if near then 0 else self.iacHeld + dt
        if near or self.iacHeld >= IAC_HOLD_TIME then
            self.iacOpening = clamp(self.iacOpening + gain * error * dt / IAC_INTEGRAL, 0, limit)
        end
        local proportional = IAC_P * gain * (error - IAC_LEAD * self.iacRate / preset.IdleRpm)
        idleBoost = clamp(self.iacOpening + proportional, 0, limit)
    else
        self.iacOpening = 0
    end
    local t = min(1, max(0, self.throttle))
    -- Fuel: off with the key, CutFuel through a spark cut (a limiter without
    -- LimiterDump cuts the fuel as well), otherwise the table.
    local map = self.fuelMap
    local fuelPercent = if not self.ignition then 0
        elseif shiftCut then map.CutFuel
        elseif limiterCut then (if map.LimiterDump then map.CutFuel else 0)
        else FuelMap.lookup(map, rpm, t)
    self.fuelPercent = fuelPercent
    local phiFuel = fuelPercent / 100
    -- air that reverts at the tailpipe at low exhaust flow, for rich overrun
    local secondaryAir = FuelMap.secondaryAir(t)
    local massScale = 1 / preset.CompressionRatio ^ (GAMMA - 1)
    local baseIdle =(if cam then cam.IdleThrottle else nil) or preset.IdleThrottle
    local plate = baseIdle + idleBoost + (1 - baseIdle) * t ^ preset.ThrottleGamma
    local throttleArea = preset.ThrottleArea * min(1, plate)
    local invPlenum = 1 / preset.PlenumVolume

    local rtIn = R_AIR * T_INTAKE
    local rtEx = R_AIR * T_EXHAUST

    local sc = preset.Supercharger
    local blowerTorque = 0
    if sc then
        -- atmosphere -> throttle body -> blower inlet
        local invIn = 1 / sc.InletVolume
        local q = orifice(ATM, 0, self.inletPressure, invIn, throttleArea, rtIn, rtIn, dt)
        if trackFresh and q > 0 then
            self.inletFresh = mixFresh(self.inletFresh, self.inletPressure * sc.InletVolume, 1, q)
        end
        self.inletPressure += q * invIn
        self.throttleFlow = q / (ATM * dt)

        -- Roots rotors: a fixed volume per revolution, carried from the inlet
        -- to the plenum at inlet pressure (positive displacement)
        local wb = self.omega * sc.DriveRatio
        local displacement = sc.Displacement * self.superchargerAirflow
        local swept = displacement * wb / TAU * dt
        local pv = self.inletPressure * swept
        local maxPv = (self.inletPressure - 1000) * sc.InletVolume
        if pv > maxPv then
            pv = max(maxPv, 0)
        end
        if trackFresh and pv > 0 then
            self.plenumFresh = mixFresh(self.plenumFresh, self.plenumPressure * preset.PlenumVolume, self.inletFresh, pv)
        end
        self.inletPressure -= pv * invIn
        self.plenumPressure += pv * invPlenum

        -- rotor clearance leak + bypass valve, plenum -> inlet. The bypass is
        -- held open by manifold vacuum at part throttle and shuts under load.
        local bc = sc.BypassClose
        local closing = min(1, max(0, (t - bc[1]) / (bc[2] - bc[1])))
        local bypass = 1 - closing * closing * (3 - 2 * closing)
        local back = orifice(self.plenumPressure, invPlenum, self.inletPressure, invIn,
            sc.LeakArea + sc.BypassArea * bypass, rtIn, rtIn, dt)
        if trackFresh then
            if back > 0 then
                self.inletFresh = mixFresh(self.inletFresh, self.inletPressure * sc.InletVolume, self.plenumFresh, back)
            elseif back < 0 then
                self.plenumFresh = mixFresh(self.plenumFresh, self.plenumPressure * preset.PlenumVolume, self.inletFresh, -back)
            end
        end
        self.plenumPressure -= back * invPlenum
        self.inletPressure += back * invIn
        if self.inletPressure < 1000 then
            self.inletPressure = 1000
        end

        -- Drive torque: a Roots blower compresses by backflow into each pocket
        -- as it opens to the outlet (isochoric), so the work per revolution is
        -- dp * displacement, taken from the crank through the pulley ratio.
        local dp = self.plenumPressure - self.inletPressure
        blowerTorque = dp * displacement * sc.DriveRatio / TAU
        blowerTorque = if blowerTorque > 0
            then blowerTorque / sc.MechanicalEfficiency
            else blowerTorque * sc.MechanicalEfficiency

        -- Whine: each of the 2 x lobes pockets per rotor revolution opens to
        -- the outlet with a backflow pulse driven by dp. The twisted rotors
        -- spread it out (exponential decay over ~1/5 of the pocket), and rotor
        -- tip flow adds a dynamic-pressure term at zero boost.
        -- The pulse train is band-limited (its Fourier series, harmonics below
        -- Nyquist only) so it does not alias at the simulation rate.
        self.blowerAngle = (self.blowerAngle + wb * dt) % TAU
        local pockets = 2 * sc.Lobes
        local phase = (self.blowerAngle * pockets / TAU) % 1
        local f0 = wb * pockets / TAU
        local nyquist = 0.45 / dt
        local pulse = 0
        for k = 1, #WHINE_HARMONICS do
            if k * f0 >= nyquist then
                break
            end
            local h = WHINE_HARMONICS[k]
            pulse += h[1] * cos(TAU * k * phase + h[2])
        end
        -- Each pocket's backflow is a pulsating volume source. Its radiated
        -- pressure goes with the rate of change of volume velocity:
        -- rho * V_pocket * (dp / p) * f^2, i.e. dp * f^2 (rho / p = 1 / RT).
        -- Normalised to rotor speed at redline, so the whine is full strength
        -- near redline and falls away by ~35 dB at idle, as on the real car.
        local rho = self.inletPressure / rtIn
        local tip = wb * 0.05 -- rotor tip radius ~50 mm
        local fRel = wb / (preset.Redline * TAU / 60 * sc.DriveRatio)
        local amp = (max(dp, 0) + 0.5 * rho * tip * tip) * fRel * fRel
        self.whine = amp * pulse * sc.WhineVolume * self.superchargerAirflow

        -- Charge temperature: Roots discharge heating, then the intercooler,
        -- whose effectiveness falls as the flow through it rises.
        local pr = max(1, self.plenumPressure / self.inletPressure)
        local t2 = T_INTAKE * (1 + (pr ^ ((GAMMA_AIR - 1) / GAMMA_AIR) - 1) / sc.AdiabaticEfficiency)
        local flow = min(1, wb * 60 / TAU / sc.MaxRotorRpm * self.superchargerAirflow)
        local ic = sc.IntercoolerEffectiveness
        local eff = ic[1] + (ic[2] - ic[1]) * flow
        local target = t2 - (t2 - T_INTAKE) * eff
        self.chargeTemperature += (target - self.chargeTemperature) * min(1, dt * 4)
    else
        local dn = orifice(ATM, 0, self.plenumPressure, invPlenum, throttleArea, rtIn, rtIn, dt)
        if trackFresh and dn > 0 then
            self.plenumFresh = mixFresh(self.plenumFresh, self.plenumPressure * preset.PlenumVolume, 1, dn)
        end
        self.plenumPressure += dn * invPlenum
        self.throttleFlow = dn / (ATM * dt)
    end
    self.blowerTorque = blowerTorque

    -- A leaking plenum (a seam that was not welded round, a port opened past
    -- its gasket): unmetered air in under vacuum, charge out under boost.
    local leakArea = preset.PlenumLeakArea
    if leakArea then
        local q = orifice(ATM, 0, self.plenumPressure, invPlenum, leakArea, rtIn, rtIn, dt)
        if trackFresh and q > 0 then
            self.plenumFresh = mixFresh(self.plenumFresh, self.plenumPressure * preset.PlenumVolume, 1, q)
        end
        self.plenumPressure += q * invPlenum
    end

    local torque = 0
    local boostBar = max(0, self.plenumPressure - ATM) / 1e5
    local advance = sparkAdvance(preset, rpm) - (if sc then sc.BoostRetard * boostBar else 0)
    local sparkStart = 360 - advance

    -- Intake cam phaser (rate-limited like an oil-pressure phaser)
    local retardMax = if cam then nil else preset.IntakeCamRetard
    if retardMax then
        local want = retardMax * min(1, max(0, (self.plenumPressure - ATM + 20000) / 40000))
        self.intakePhase += clamp(want - self.intakePhase, -150 * dt, 150 * dt)
    else
        self.intakePhase = 0
    end
    local intakeOpen = (if cam then cam.IntakeOpen else preset.IntakeOpen :: number) + self.intakePhase
    local intakeClose = (if cam then cam.IntakeClose else preset.IntakeClose :: number) + self.intakePhase
    local exhaustOpen = if cam then cam.ExhaustOpen else preset.ExhaustOpen :: number
    local exhaustClose = if cam then cam.ExhaustClose else preset.ExhaustClose :: number
    local intakeScale = if cam then cam.IntakeLiftScale else 1
    local exhaustScale = if cam then cam.ExhaustLiftScale else 1
    local dilution = if cam then cam.IdleDilution else nil
    local lope = if dilution and not self.starter
        then clamp((0.14 - t) / 0.14, 0, 1) * clamp((1800 - rpm) / 900, 0, 1)
        else 0
    -- constant-volume burn: pressure rise ~ fuel energy / (m cv T) ~ 1 / T_charge
    local charge = T_INTAKE / self.chargeTemperature
    if preset.CombustionGain and not useFresh then
        -- Residual-gas dilution: exhaust left in the clearance volume (~ p_exh /
        -- (p_intake * CR) of the charge) carries no fuel, which is what makes
        -- light-load combustion weak and gives closed-throttle engine braking.
        local residual = ATM / (max(self.plenumPressure, 5000) * preset.CompressionRatio)
        charge *= max(0.1, 1 - residual)
    end
    if preset.ChargeCurve or preset.BoostChargeCurve then
        local baseCharge = if preset.ChargeCurve then lookup(preset.ChargeCurve, rpm) else 1
        local addedCharge = if preset.BoostChargeCurve then lookup(preset.BoostChargeCurve, rpm) * t * t else 0
        charge *= baseCharge + addedCharge
    end
    if not cam and preset.BaseCamChargeCurve then
        charge *= lookup(preset.BaseCamChargeCurve, rpm)
    end
    local burn = preset.BurnDuration
    local outletArea = preset.RunnerArea * 0.9

    -- GasModel: fuel is metered into the air that enters each cylinder
    -- (carburettor or port injection), at the commanded equivalence ratio.
    local phiCommand = 1
    local limitLo, limitHi, limitFull, partialBurn = 0, 0, 0, 1
    if gas then
        if gas.Mixture then
            phiCommand = lookup(gas.Mixture, self.plenumPressure)
        end
        phiCommand *= phiFuel
        limitLo, limitHi = gas.DilutionLimit[1], gas.DilutionLimit[2]
        limitFull = gas.FullBurn or (limitHi + 0.15)
        partialBurn = gas.PartialBurn or 0.6
    end

    for _, cyl in self.cylinders do
        local aOld = ((oldTheta - cyl.phase) % (4 * PI)) / DEG
        local a = self:_localAngle(cyl)

        -- Polytropic compression / expansion
        local vNew = self:_volume(a)
        cyl.pc *= (cyl.vc / vNew) ^ GAMMA
        cyl.vc = vNew

        -- Spark: a new combustion event when we cross the spark angle
        local crossed = (aOld < sparkStart and a >= sparkStart)
            or (wrapped > 0 and aOld > a and (a >= sparkStart or aOld < sparkStart))
        if crossed then
            -- the trapped charge as pV at intake conditions (pc vc is compressed)
            local mass = cyl.pc * cyl.vc * massScale
            if sparkAllowed then
                -- Fresh-charge fraction falls as residual exhaust dilutes it.
                local spread = 1 + 0.06 * gaussian(rng)
                local fresh = if useFresh then cyl.fresh else 1
                local burned = 1
                if gas then
                    -- Whether the charge lights depends on how much burned gas
                    -- is trapped with it and on its air-fuel ratio. A misfire
                    -- burns only a little of the mixture; the rest leaves
                    -- through the exhaust valve, and what reverts in the next
                    -- overlap is mixture instead of burned gas, so the cycle
                    -- after a misfire is cleaner and lights hard. Near the
                    -- limit a charge that does light does not burn completely.
                    local air = cyl.fresh
                    local phi = cyl.fuel / max(air, 1e-6)
                    local x = clamp((air - limitLo) / (limitHi - limitLo), 0, 1)
                    local lean = clamp((phi - 0.55) / 0.25, 0, 1)
                    local rich = clamp((1.9 - phi) / 0.4, 0, 1)
                    local chance = x * x * (3 - 2 * x)
                        * lean * lean * (3 - 2 * lean)
                        * rich * rich * (3 - 2 * rich)
                    local share
                    if rng:NextNumber() > chance then
                        share = 0.25 * rng:NextNumber()
                        self.misfires += 1
                    else
                        local y = clamp((air - limitLo) / (limitFull - limitLo), 0, 1)
                        share = partialBurn + (1 - partialBurn) * y * y * (3 - 2 * y)
                        self.fires += 1
                    end
                    if dilution and lope > 0 then
                        -- the cam's own idle lope (see below) stays in charge
                        -- of how weak a lit idle burn is
                        local effective = air - 0.035 * cyl.bankCrowding
                        local z = clamp((effective - dilution[1]) / (dilution[2] - dilution[1]), 0, 1)
                        share *= 1 - lope * 0.8 * (1 - z * z * (3 - 2 * z))
                    end
                    -- air and fuel react in stoichiometric proportion: a lean
                    -- charge leaves air, a rich one leaves fuel
                    local reacted = min(air, cyl.fuel) * share
                    cyl.fresh = air - reacted
                    cyl.fuel -= reacted
                    fresh = reacted
                    -- the share of the fuel left over that the fuel table
                    -- added goes out to light in the exhaust (the model's own
                    -- misfires stay as they were calibrated)
                    cyl.slugFuel = if phiFuel > 1 then cyl.fuel * mass * (1 - 1 / phiFuel) else 0
                    cyl.slugAir = 0
                elseif dilution and lope > 0 then
                    -- Residual exhaust weakens the flame at idle. A partial
                    -- burn leaves fresh mixture that can fire on a later cycle.
                    -- Close-spaced firings see more residual backpressure
                    -- from the shared collector than isolated firings.
                    local effectiveFresh = fresh - 0.035 * cyl.bankCrowding
                    local x = clamp((effectiveFresh - dilution[1]) / (dilution[2] - dilution[1]), 0, 1)
                    burned -= lope * 0.8 * (1 - x * x * (3 - 2 * x))
                end
                -- The fuel table (GasModel engines meter it at the intake
                -- instead): a mixture outside the flammable band misfires, a
                -- rich or lean one burns weaker, and whatever fuel or air the
                -- burn does not use leaves with the exhaust.
                local power = 1
                if not gas then
                    local tableBurned = 1
                    if phiFuel ~= 1 then
                        if rng:NextNumber() < FuelMap.misfireChance(phiFuel) then
                            tableBurned = 0.2 * rng:NextNumber()
                            self.misfires += 1
                        end
                        power = FuelMap.power(phiFuel)
                    end
                    cyl.slugFuel, cyl.slugAir = FuelMap.leftover(fresh * mass, burned, phiFuel, tableBurned)
                    burned *= tableBurned
                end
                cyl.burnRatio = max(1, 1 + (preset.CombustionGain or 2.9) * spread * charge * fresh * burned * power
                    * (cyl.def.Seal or 1))
                cyl.exhaust.strength = mass * fresh * (if gas then 1 else burned) / cyl.exhaust.ref
                if trackFresh and not gas then
                    cyl.fresh *= 1 - burned
                end
            else
                cyl.burnRatio = 1
                -- spark cut: the whole charge and the fuel injected into it
                -- go out unburned
                local air = (if useFresh then cyl.fresh else 1) * mass
                cyl.slugAir = air
                cyl.slugFuel = air * phiFuel
                cyl.exhaust.strength = 0
            end
            cyl.firingCount += 1
            cyl.firingStrength = clamp((cyl.burnRatio - 1) * 2, 0, 1)
            cyl.burnProgress = 0
        end

        -- Wiebe heat release applied as a pressure multiplier
        if cyl.burnProgress < 1 then
            local d = (a - sparkStart) % 720
            local x = if d < burn then 1 - exp(-5 * (d / burn) ^ 3) else 1
            if x > cyl.burnProgress then
                cyl.pc *= cyl.burnRatio ^ (x - cyl.burnProgress)
                cyl.burnProgress = if d < burn then x else 1
            end
        end

        local invVc = 1 / cyl.vc
        local invVr = 1 / cyl.vr

        -- Intake valve: plenum <-> cylinder
        local liftIn = min(1, valveLift(a, intakeOpen, intakeClose) * intakeScale)
        if liftIn > 0 then
            local q = orifice(self.plenumPressure, invPlenum, cyl.pc, invVc, (preset.IntakeValveArea :: number) * liftIn * (cyl.def.IntakeFlow or 1), rtIn, rtEx, dt)
            if trackFresh then
                if q > 0 then
                    if gas then
                        cyl.fuel = mixFresh(cyl.fuel, cyl.pc * cyl.vc, phiCommand * self.plenumFresh, q)
                    end
                    cyl.fresh = mixFresh(cyl.fresh, cyl.pc * cyl.vc, self.plenumFresh, q)
                elseif q < 0 then
                    self.plenumFresh = mixFresh(self.plenumFresh, self.plenumPressure * preset.PlenumVolume, cyl.fresh, -q)
                end
            end
            self.plenumPressure -= q * invPlenum
            cyl.pc += q * invVc
        end

        -- Exhaust valve: cylinder <-> runner
        local liftEx = min(1, valveLift(a, exhaustOpen, exhaustClose) * exhaustScale)
        local qEx = 0
        if liftEx > 0 then
            qEx = orifice(cyl.pc, invVc, cyl.pr, invVr, (preset.ExhaustValveArea :: number) * liftEx * (cyl.def.ExhaustFlow or 1), rtEx, rtEx, dt)
            if qEx > 0 and cyl.slugFuel > 0 then
                -- the unburned share leaves with the gas
                local share = min(1, qEx / (cyl.pc * cyl.vc))
                local ex = cyl.exhaust
                ex.fuel += cyl.slugFuel * share
                ex.air += cyl.slugAir * share
                cyl.slugFuel *= 1 - share
                cyl.slugAir *= 1 - share
            end
            if trackFresh then
                if qEx > 0 then
                    if gas then
                        cyl.runnerFuel = mixFresh(cyl.runnerFuel, cyl.pr * cyl.vr, cyl.fuel, qEx)
                    end
                    cyl.runnerFresh = mixFresh(cyl.runnerFresh, cyl.pr * cyl.vr, cyl.fresh, qEx)
                elseif qEx < 0 then
                    if gas then
                        cyl.fuel = mixFresh(cyl.fuel, cyl.pc * cyl.vc, cyl.runnerFuel, -qEx)
                    end
                    cyl.fresh = mixFresh(cyl.fresh, cyl.pc * cyl.vc, cyl.runnerFresh, -qEx)
                end
            end
            cyl.pc -= qEx * invVc
            cyl.pr += qEx * invVr
        end

        if dilution then
            -- Capture the leading edge of the exhaust blowdown. The lumped
            -- runner pressure mostly carries the slower tail of this pulse.
            local opening = (a - exhaustOpen) % 720
            local attackWindow = clamp((65 - opening) / 35, 0, 1)
            local pressure = attackWindow * max(0, qEx) * invVr * (0.002 / dt)
            cyl.blowdownMean += (pressure - cyl.blowdownMean) * min(1, dt / 0.005)
            cyl.idleBlowdown = lope * (1 - 0.75 * cyl.bankCrowding) * (pressure - 0.8 * cyl.blowdownMean)
        elseif trackFresh then
            cyl.blowdownMean = 0
            cyl.idleBlowdown = 0
        end

        -- Runner -> collector / atmosphere
        local qOut = orifice(cyl.pr, invVr, ATM, 0, outletArea, rtEx, rtEx, dt)
        if trackFresh and qOut < 0 then
            -- what comes back from the collector is the other cylinders' exhaust
            if gas then
                cyl.runnerFuel = mixFresh(cyl.runnerFuel, cyl.pr * cyl.vr, 0, -qOut)
            end
            cyl.runnerFresh = mixFresh(cyl.runnerFresh, cyl.pr * cyl.vr, 0, -qOut)
        end
        -- the afterfire's pressure is kept apart (exhaust.pressure), see FuelMap
        if FuelMap.exhaustStep(cyl.exhaust, map, rng, dt,
            if qOut > 0 then qOut / (cyl.pr * cyl.vr) else 0, secondaryAir, cyl.pr * cyl.vr * (T_INTAKE / T_EXHAUST), invVr) then
            self.afterfires += 1
            FuelMap.logAfterfire(self.afterfireLog, cyl.exhaust)
        end
        cyl.pr -= qOut * invVr

        -- Mean gas velocity through the runner (volumetric flow / area)
        local vol = 0.5 * (qEx + qOut) / (max(cyl.pr, 1) * dt)
        cyl.runnerVelocity = vol / preset.RunnerArea

        if cyl.pc < 1000 then
            cyl.pc = 1000
        end

        torque += (cyl.pc - ATM) * self:_dVdTheta(a)
    end

    if self.plenumPressure < 1000 then
        self.plenumPressure = 1000
    end

    -- Induction noise: the intake mouth is a monopole source driven by the
    -- pulsing airflow through the throttle body. Its AC part (the flow against
    -- its own ~40 Hz average) is the intake-side source, so it is quiet at a
    -- closed-throttle idle and roars at full throttle, like a real intake.
    -- Soft-clipped so a throttle snap gives a short "whoomph", not a click.
    local flow = self.throttleFlow
    local mean = self.inductionMean
    mean += (flow - mean) * min(1, dt * TAU * INDUCTION_CUTOFF)
    self.inductionMean = mean
    self.induction = INDUCTION_CLIP * math.tanh((flow - mean) / INDUCTION_CLIP)

    -- Friction, starter, load
    local omega = self.omega
    local friction = preset.FrictionTorque + preset.FrictionViscous * omega
    if omega <= 0 then
        friction = 0
    end
    torque -= friction
    torque -= self.load
    torque -= blowerTorque

    if self.starter and rpm < preset.StarterSpeed then
        torque += preset.StarterTorque
    end

    self.lastTorque = torque
    omega += torque / self.inertia * dt
    if omega < 0 then
        omega = 0
    end
    self.omega = omega
end

return EngineModel
