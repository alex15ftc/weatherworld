--!strict
--!native
-- Wankel (rotary) version of EngineModel: same lumped "filling and
-- emptying" model, same public interface, so EngineAudioSimulator and the
-- drivetrain can't tell the difference.
--
-- Each rotor has three chambers (one per flank) that share the rotor's
-- peripheral intake port, peripheral exhaust port and exhaust runner. Angles:
--   * shaft angle: eccentric shaft, one face's 4-stroke cycle = 1080 degrees.
--   * face angle a: 0..1080 for one chamber, 0 = TDC at the end of
--     compression (spark side, minor axis), 270 = BDC, 540 = TDC at the end
--     of exhaust, 810 = BDC at the end of intake.
--   * port position: degrees around the housing as engine-sim's
--     wankel_peripheral_port gives it, 0 = spark-side minor axis, decreasing
--     in the direction the rotor turns (so the exhaust port comes before the
--     intake port, both near 180).
-- The rotor turns at 1/3 shaft speed; an apex passes a housing position
-- 3 shaft degrees per housing degree. The chamber volume of a Wankel is
-- exactly sinusoidal in shaft angle: V = Vmin + Vd / 2 (1 - cos(2a / 3)),
-- Vd = 3 sqrt(3) e R B.

local Presets = require(script.Parent.Presets)
local FuelMap = require(script.Parent.FuelMap)

local ATM = 101325.0
local R_AIR = 287.0
local T_INTAKE = 300.0
local T_EXHAUST = 1000.0
local GAMMA = 1.3
local CD = 0.7

local PI = math.pi
local TAU = 2 * PI
local DEG = PI / 180
local CYCLE = 6 * PI -- 1080 degrees
local sqrt = math.sqrt
local cos = math.cos
local sin = math.sin
local exp = math.exp
local min = math.min
local max = math.max
local log = math.log
local clamp = math.clamp

local INDUCTION_CUTOFF = 40
local INDUCTION_CLIP = 0.25

type Chamber = {
    offset: number, -- shaft degrees: face k reaches TDC 360 k after face 0
    pc: number,
    vc: number,
    fresh: number, -- mass fraction of unburned mixture
    burnRatio: number,
    burnProgress: number,
    -- unburned fuel / air its last spark event left (pV), carried into the
    -- runner by the exhaust port flow
    slugFuel: number,
    slugAir: number,
}

type Rotor = {
    def: Presets.CylinderDef,
    phase: number, -- shaft radians at which face 0 is at TDC
    chambers: { Chamber },
    firingCount: number,
    firingStrength: number,
    pr: number, -- exhaust runner + primary pressure (abs)
    vr: number,
    fresh: number, -- unburned mixture in the runner (misfired charges pass through it)
    runnerVelocity: number,
    exhaust: FuelMap.Exhaust, -- the runner's unburned mixture and afterfire
}

local RotaryEngineModel = {}
RotaryEngineModel.__index = RotaryEngineModel

export type RotaryEngineModel = typeof(setmetatable({} :: {
    preset: Presets.EnginePreset,
    rotary: Presets.RotaryDef,
    cylinders: { Rotor }, -- one per rotor (named like EngineModel's)
    theta: number, -- shaft angle (rad), 0..6 pi
    omega: number,
    plenumPressure: number,
    plenumFresh: number, -- exhaust that reverts through the intake port dilutes the plenum
    throttle: number,
    ignition: boolean,
    starter: boolean,
    load: number,
    revLimitTimer: number,
    vMin: number,
    vSwing: number, -- Vd / 2
    rng: Random,
    lastTorque: number,
    inertia: number,
    blowerTorque: number,
    whine: number,
    induction: number,
    inductionMean: number,
    throttleFlow: number,
    -- fuel table, ignition cut and afterfire (see EngineModel)
    fuelMap: FuelMap.FuelMap,
    sparkCutTimer: number,
    fuelPercent: number,
    afterfires: number,
    afterfireLog: FuelMap.AfterfireLog,
    misfires: number,
}, RotaryEngineModel))

local function gaussian(rng: Random): number
    local u1 = max(rng:NextNumber(), 1e-12)
    local u2 = rng:NextNumber()
    return sqrt(-2 * log(u1)) * cos(TAU * u2)
end

-- Same orifice as EngineModel (positive = a -> b; invVb = 0 is atmosphere).
local function orifice(pa: number, invVa: number, pb: number, invVb: number, area: number, rtA: number, rtB: number, dt: number): number
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

-- Fresh fraction of volume b after pv (PV units, ~ mass at one temperature)
-- of gas with fresh fraction fa arrives in it
local function mix(fb: number, pvB: number, fa: number, pv: number): number
    local total = pvB + pv
    if total <= 0 then
        return fb
    end
    return (fb * pvB + fa * pv) / total
end

-- Length of [a0, a1] that overlaps [b0, b1] (degrees, b inside 0..360),
-- with a allowed to wrap around the housing.
local function overlap(a0: number, a1: number, b0: number, b1: number): number
    local total = 0
    for k = -1, 1 do
        local lo = max(a0 + 360 * k, b0)
        local hi = min(a1 + 360 * k, b1)
        if hi > lo then
            total += hi - lo
        end
    end
    return total
end

-- Fraction of a peripheral port (housing degrees, engine-sim convention)
-- that is open to the chamber at face angle a. The chamber lies between its
-- trailing apex and its leading apex, 120 housing degrees apart; at TDC it
-- is centred on the spark-side minor axis.
local function portOpen(a: number, portStart: number, portEnd: number): number
    -- housing travel of the leading apex from the minor axis, in the
    -- direction of rotation
    local lead = 60 + a / 3
    -- port in the same travel coordinate (engine-sim angles decrease along it)
    local p0 = (360 - portEnd) % 360
    local p1 = p0 + (portEnd - portStart)
    local width = p1 - p0
    if width <= 0 then
        return 0
    end
    local l = lead % 360
    return overlap(l - 120, l, p0, p1) / width
end

function RotaryEngineModel.new(preset: Presets.EnginePreset): RotaryEngineModel
    local rotary = preset.Rotary :: Presets.RotaryDef
    local swept = 3 * sqrt(3) * rotary.Eccentricity * rotary.Radius * rotary.Depth
    local cr = preset.CompressionRatio :: number
    local vMin = swept / (cr - 1)

    local self = setmetatable({
        preset = preset,
        rotary = rotary,
        cylinders = {},
        theta = 0,
        omega = 0,
        plenumPressure = ATM,
        plenumFresh = 1,
        throttle = 0,
        ignition = true,
        starter = false,
        load = 0,
        revLimitTimer = 0,
        vMin = vMin,
        vSwing = swept / 2,
        rng = Random.new(),
        lastTorque = 0,
        inertia = preset.Inertia,
        blowerTorque = 0,
        whine = 0,
        induction = 0,
        inductionMean = 0,
        throttleFlow = 0,
        fuelMap = FuelMap.forPreset(preset),
        sparkCutTimer = 0,
        fuelPercent = 100,
        afterfires = 0,
        afterfireLog = FuelMap.newLog(),
        misfires = 0,
    }, RotaryEngineModel)

    for i, def in preset.Cylinders do
        local rotor: Rotor = {
            def = def,
            phase = def.FiringAngle * DEG,
            chambers = {},
            firingCount = 0,
            firingStrength = 0,
            pr = ATM,
            vr = preset.RunnerVolume + def.PrimaryLength * preset.RunnerArea,
            fresh = 0,
            runnerVelocity = 0,
            exhaust = FuelMap.newExhaust(ATM * swept, def.ExhaustSystem),
        }
        for k = 0, 2 do
            rotor.chambers[k + 1] = {
                offset = 360 * k,
                pc = ATM,
                vc = vMin,
                fresh = 1,
                burnRatio = 1,
                burnProgress = 1,
                slugFuel = 0,
                slugAir = 0,
            }
        end
        self.cylinders[i] = rotor
        for _, ch in rotor.chambers do
            ch.vc = self:_volume(self:_faceAngle(rotor, ch, self.theta))
        end
    end

    return self
end

function RotaryEngineModel._faceAngle(self: RotaryEngineModel, rotor: Rotor, ch: Chamber, theta: number): number
    return ((theta - rotor.phase) / DEG - ch.offset) % 1080
end

function RotaryEngineModel._volume(self: RotaryEngineModel, a: number): number
    return self.vMin + self.vSwing * (1 - cos(a * DEG * 2 / 3))
end

-- dV / d(shaft angle), per radian
function RotaryEngineModel._dVdTheta(self: RotaryEngineModel, a: number): number
    return self.vSwing * (2 / 3) * sin(a * DEG * 2 / 3)
end

function RotaryEngineModel.getRpm(self: RotaryEngineModel): number
    return self.omega * 60 / TAU
end

function RotaryEngineModel.getSpeed(self: RotaryEngineModel): number
    return self.omega
end

function RotaryEngineModel.getCylinderCount(self: RotaryEngineModel): number
    return #self.cylinders
end

function RotaryEngineModel.getExhaustSystemCount(self: RotaryEngineModel): number
    return #self.preset.ExhaustSystems
end

function RotaryEngineModel.getManifoldPressure(self: RotaryEngineModel): number
    return self.plenumPressure
end

function RotaryEngineModel.getTorque(self: RotaryEngineModel): number
    return self.lastTorque
end

function RotaryEngineModel.getRedline(self: RotaryEngineModel): number
    return self.preset.Redline
end

function RotaryEngineModel.getBoost(self: RotaryEngineModel): number
    return self.plenumPressure - ATM
end

function RotaryEngineModel.getWhine(self: RotaryEngineModel): number
    return 0
end

function RotaryEngineModel.getInduction(self: RotaryEngineModel): number
    return self.induction
end

function RotaryEngineModel.hasSupercharger(self: RotaryEngineModel): boolean
    return false
end

function RotaryEngineModel.cutSpark(self: RotaryEngineModel, duration: number)
    self.sparkCutTimer = max(self.sparkCutTimer, duration)
end

function RotaryEngineModel.getAfterfirePressure(self: RotaryEngineModel, i: number): number
    return self.cylinders[i].exhaust.pressure
end

function RotaryEngineModel.isSparkCut(self: RotaryEngineModel): boolean
    return self.sparkCutTimer > 0 or self.revLimitTimer > 0
end

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

function RotaryEngineModel.getRunnerPressure(self: RotaryEngineModel, i: number): number
    return self.cylinders[i].pr
end

function RotaryEngineModel.getRunnerDynamicPressure(self: RotaryEngineModel, i: number, dir: number): number
    local rotor = self.cylinders[i]
    local v = rotor.runnerVelocity * dir
    if v <= 0 then
        return 0
    end
    local k = 1.4
    local p = rotor.pr
    local density = p / (R_AIR * T_EXHAUST)
    local c2 = p * k / density
    local x = 1 + ((k - 1) / 2) * (v * v / c2)
    return p * (x ^ (k / (k - 1)) - 1)
end

function RotaryEngineModel.step(self: RotaryEngineModel, dt: number)
    local preset = self.preset
    local rotary = self.rotary
    local rng = self.rng
    local rpm = self.omega * 60 / TAU

    -- Rev limiter (spark cut)
    if rpm > preset.Redline then
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

    local oldTheta = self.theta
    self.theta = (self.theta + self.omega * dt) % CYCLE
    local moved = self.omega * dt > 0

    -- Throttle body: atmosphere -> plenum, with a small idle air control
    local idleBoost = 0
    if self.ignition and rpm > 200 and rpm < preset.IdleRpm then
        local k = rotary.IdleControlGain or 0.08
        idleBoost = min(k / 2, (preset.IdleRpm - rpm) / preset.IdleRpm * k)
    end
    local t = min(1, max(0, self.throttle))
    local map = self.fuelMap
    local fuelPercent = if not self.ignition then 0
        elseif shiftCut then map.CutFuel
        elseif limiterCut then (if map.LimiterDump then map.CutFuel else 0)
        else FuelMap.lookup(map, rpm, t)
    self.fuelPercent = fuelPercent
    local phiFuel = fuelPercent / 100
    local secondaryAir = FuelMap.secondaryAir(t)
    local massScale = 1 / preset.CompressionRatio ^ (GAMMA - 1)
    local plate = preset.IdleThrottle + idleBoost + (1 - preset.IdleThrottle) * t ^ preset.ThrottleGamma
    local throttleArea = preset.ThrottleArea * min(1, plate)
    local invPlenum = 1 / preset.PlenumVolume
    local rtIn = R_AIR * T_INTAKE
    local rtEx = R_AIR * T_EXHAUST

    local dn = orifice(ATM, 0, self.plenumPressure, invPlenum, throttleArea, rtIn, rtIn, dt)
    if dn > 0 then
        self.plenumFresh = mix(self.plenumFresh, self.plenumPressure * preset.PlenumVolume, 1, dn)
    end
    self.plenumPressure += dn * invPlenum
    self.throttleFlow = dn / (ATM * dt)

    local advance = if preset.TimingCurve then lookup(preset.TimingCurve, rpm) else preset.SparkAdvance
    local sparkStart = 1080 - advance

    -- Residual gas is tracked per chamber (fresh), so unlike EngineModel
    -- there is no residual estimate here; the charge curve stands in for
    -- the wave tuning the lumped model doesn't simulate.
    local charge = 1
    if preset.ChargeCurve then
        charge *= lookup(preset.ChargeCurve, rpm)
    end
    local gain = preset.CombustionGain or 2.9
    local burn = preset.BurnDuration
    local outletArea = rotary.OutletArea
    local inStart, inEnd = rotary.IntakePort[1], rotary.IntakePort[2]
    local exStart, exEnd = rotary.ExhaustPort[1], rotary.ExhaustPort[2]
    local inArea, exArea = rotary.IntakePortArea, rotary.ExhaustPortArea
    local leak = rotary.ApexLeakArea

    local torque = 0
    for _, rotor in self.cylinders do
        local invVr = 1 / rotor.vr
        local qExTotal = 0
        local chambers = rotor.chambers
        for _, ch in chambers do
            local aOld = self:_faceAngle(rotor, ch, oldTheta)
            local a = self:_faceAngle(rotor, ch, self.theta)

            local vNew = self:_volume(a)
            ch.pc *= (ch.vc / vNew) ^ GAMMA
            ch.vc = vNew

            local crossed = (aOld < sparkStart and a >= sparkStart)
                or (moved and aOld > a and (a >= sparkStart or aOld < sparkStart))
            if crossed then
                -- Dilution limit: a charge thinned by reverted exhaust may not
                -- light. A misfire burns only a little of its mixture; the rest
                -- stays unburned, leaves through the exhaust port and comes back
                -- in the overlap, so the charges after a misfire are richer and
                -- light hard. That fire / miss / fire rhythm is the idle "brap"
                -- of a peripheral-port rotary.
                local mass = ch.pc * ch.vc * massScale
                if sparkAllowed then
                    local burned = 1
                    local dl = rotary.DilutionLimit
                    if dl then
                        local x = clamp((ch.fresh - dl[1]) / (dl[2] - dl[1]), 0, 1)
                        local chance = x * x * (3 - 2 * x)
                        if rng:NextNumber() > chance then
                            burned = 0.25 * rng:NextNumber()
                        end
                    end
                    -- fuel table: outside the flammable band it misfires, rich
                    -- or lean it burns weaker, and the leftover goes out the port
                    local power = 1
                    local tableBurned = 1
                    if phiFuel ~= 1 then
                        if rng:NextNumber() < FuelMap.misfireChance(phiFuel) then
                            tableBurned = 0.2 * rng:NextNumber()
                            self.misfires += 1
                        end
                        power = FuelMap.power(phiFuel)
                    end
                    ch.slugFuel, ch.slugAir = FuelMap.leftover(ch.fresh * mass, burned, phiFuel, tableBurned)
                    burned *= tableBurned
                    local spread = 1 + 0.06 * gaussian(rng)
                    ch.burnRatio = max(1, 1 + gain * spread * charge * ch.fresh * burned * power)
                    rotor.exhaust.strength = ch.fresh * mass * burned / rotor.exhaust.ref
                    ch.fresh *= 1 - burned
                else
                    ch.burnRatio = 1
                    local air = ch.fresh * mass
                    ch.slugAir = air
                    ch.slugFuel = air * phiFuel
                    rotor.exhaust.strength = 0
                end
                rotor.firingCount += 1
                rotor.firingStrength = clamp((ch.burnRatio - 1) * 2, 0, 1)
                ch.burnProgress = 0
            end

            if ch.burnProgress < 1 then
                local d = (a - sparkStart) % 1080
                local x = if d < burn then 1 - exp(-5 * (d / burn) ^ 3) else 1
                if x > ch.burnProgress then
                    ch.pc *= ch.burnRatio ^ (x - ch.burnProgress)
                    ch.burnProgress = if d < burn then x else 1
                end
            end

            local invVc = 1 / ch.vc

            local fIn = portOpen(a, inStart, inEnd)
            if fIn > 0 then
                -- same stand-in for the intake charge's momentum
                local area = inArea * fIn
                if ch.pc > self.plenumPressure then
                    area *= rotary.IntakeBackflow
                end
                local q = orifice(self.plenumPressure, invPlenum, ch.pc, invVc, area, rtIn, rtEx, dt)
                if q > 0 then
                    ch.fresh = mix(ch.fresh, ch.pc * ch.vc, self.plenumFresh, q)
                else
                    self.plenumFresh = mix(self.plenumFresh, self.plenumPressure * preset.PlenumVolume, ch.fresh, -q)
                end
                self.plenumPressure -= q * invPlenum
                ch.pc += q * invVc
            end

            local fEx = portOpen(a, exStart, exEnd)
            if fEx > 0 then
                -- The lumped runner has no gas momentum, so blowdown from the
                -- chamber behind (the port is shared while an apex crosses it)
                -- would flood the chamber in overlap. A real exhaust's outgoing
                -- flow holds most of that back; ExhaustBackflow is the share of
                -- the port that reverse flow sees.
                local area = exArea * fEx
                if rotor.pr > ch.pc then
                    area *= rotary.ExhaustBackflow
                end
                local q = orifice(ch.pc, invVc, rotor.pr, invVr, area, rtEx, rtEx, dt)
                if q > 0 and ch.slugFuel > 0 then
                    local share = min(1, q / (ch.pc * ch.vc))
                    local ex = rotor.exhaust
                    ex.fuel += ch.slugFuel * share
                    ex.air += ch.slugAir * share
                    ch.slugFuel *= 1 - share
                    ch.slugAir *= 1 - share
                end
                if q > 0 then
                    rotor.fresh = mix(rotor.fresh, rotor.pr * rotor.vr, ch.fresh, q)
                elseif q < 0 then
                    -- what reverts from the runner is whatever the last chambers
                    -- left there: burned gas after a fire, mixture after a misfire
                    ch.fresh = mix(ch.fresh, ch.pc * ch.vc, rotor.fresh, -q)
                end
                ch.pc -= q * invVc
                rotor.pr += q * invVr
                qExTotal += q
            end
        end

        -- Apex seal leakage: each chamber leaks past its leading apex into
        -- the next one (chamber k+1 trails chamber k by one flank)
        if leak > 0 then
            for k = 1, 3 do
                local c1 = chambers[k]
                local c2 = chambers[k % 3 + 1]
                local inv1, inv2 = 1 / c1.vc, 1 / c2.vc
                local q = orifice(c1.pc, inv1, c2.pc, inv2, leak, rtEx, rtEx, dt)
                if q > 0 then
                    c2.fresh = mix(c2.fresh, c2.pc * c2.vc, c1.fresh, q)
                else
                    c1.fresh = mix(c1.fresh, c1.pc * c1.vc, c2.fresh, -q)
                end
                c1.pc -= q * inv1
                c2.pc += q * inv2
            end
        end

        for _, ch in chambers do
            if ch.pc < 1000 then
                ch.pc = 1000
            end
            local a = self:_faceAngle(rotor, ch, self.theta)
            torque += (ch.pc - ATM) * self:_dVdTheta(a)
        end

        local qOut = orifice(rotor.pr, invVr, ATM, 0, outletArea, rtEx, rtEx, dt)
        if qOut < 0 then
            -- air drawn back in from the collector carries no fuel
            rotor.fresh = mix(rotor.fresh, rotor.pr * rotor.vr, 0, -qOut)
        end
        -- the afterfire's pressure is kept apart (exhaust.pressure), see FuelMap
        if FuelMap.exhaustStep(rotor.exhaust, map, rng, dt,
            if qOut > 0 then qOut / (rotor.pr * rotor.vr) else 0, secondaryAir, rotor.pr * rotor.vr * (T_INTAKE / T_EXHAUST), invVr) then
            self.afterfires += 1
            FuelMap.logAfterfire(self.afterfireLog, rotor.exhaust)
        end
        rotor.pr -= qOut * invVr
        local vol = 0.5 * (qExTotal + qOut) / (max(rotor.pr, 1) * dt)
        rotor.runnerVelocity = vol / preset.RunnerArea
    end

    if self.plenumPressure < 1000 then
        self.plenumPressure = 1000
    end

    local flow = self.throttleFlow
    local mean = self.inductionMean
    mean += (flow - mean) * min(1, dt * TAU * INDUCTION_CUTOFF)
    self.inductionMean = mean
    self.induction = INDUCTION_CLIP * math.tanh((flow - mean) / INDUCTION_CLIP)

    local omega = self.omega
    local friction = preset.FrictionTorque + preset.FrictionViscous * omega
    if omega <= 0 then
        friction = 0
    end
    torque -= friction
    torque -= self.load

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

return RotaryEngineModel
