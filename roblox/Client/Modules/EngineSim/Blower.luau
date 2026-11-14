--!strict
--!native
-- Centrifugal supercharger sound (a ProCharger-style head unit): a sound-only
-- layer that can sit on top of any engine. It does not add boost or take
-- torque; the engine model is untouched. It drives a separate charge pipe from
-- engine speed, throttle and airflow, and plays into the synthesizer's intake stream,
-- so it comes from the car's intake emitter.
--
-- Five sources, each with its own level in the BlowerDef:
--   Whistle   the impeller tone. Belt driven, so its pitch follows engine rpm
--             exactly; part pure tone, part narrow-band air noise at the same
--             pitch (Breath) so it reads as a whistle, not a test tone.
--   Gear      the step-up gearbox whine, a rougher lower tone under the whistle
--   Whoosh    broadband air rush through the compressor and pipework; gets
--             louder and brighter with airflow
--   Suck      the inlet hiss at the filter: high, thin noise that comes in
--             with airflow (the "sucking" on throttle)
--   Relief   hiss from the outlet valve (external or through a return hose)
--   Surge    pulses from reverse flow through the compressor at low demand
--
-- Two halves, because the synthesizer renders ~0.1 s behind the simulation:
--   step    runs once per simulation step and turns the engine's state into
--           five controls (speed, inlet flow, boost, relief flow, reverse flow). They travel
--           through the synthesizer's input rings next to the exhaust samples,
--           so the blower stays in sync with the engine sound.
--   render  runs once per 44.1 kHz output sample from those controls. The
--           voice is made at the audio rate, not the simulation rate, because
--           the whistle and the hiss live above the simulation's Nyquist.
--
-- The output is not scaled by the synthesizer's leveler (that normalises the
-- exhaust); its level is absolute, set by Volume.

local ATM = 101325.0
local CHARGE_VOLUME = 0.012 -- m^3, charge piping and intercooler
local TAU = 2 * math.pi
local sin = math.sin
local sqrt = math.sqrt
local min = math.min
local max = math.max
local tan = math.tan

-- int16 units at Volume = 1 with every source at 1 and full amplitude
local LEVEL = 5200
-- filter coefficients are refreshed every this many output samples (~0.7 ms)
local COEFF_INTERVAL = 32

local Blower = {}
Blower.__index = Blower

-- Number of control values step() writes per simulation step
Blower.CONTROLS = 5
export type ValveMode = "Atmospheric" | "Recirculating" | "No valve (surge)"
local valveModes: { ValveMode } = { "Atmospheric", "Recirculating", "No valve (surge)" }
Blower.ValveModes = table.freeze(valveModes)
Blower.TierNames = table.freeze({ "Tier 1", "Tier 2", "Tier 3", "Tier 4 - Big Dog" })

export type BlowerDef = {
    Enabled: boolean,
    Tier: number?,
    Volume: number, -- overall level of the layer
    -- impeller whistle
    Whistle: number, -- level
    WhistlePitch: number, -- Hz at the redline (falls in proportion to rpm)
    WhistleBreath: number, -- 0 = pure tone .. 1 = all air noise
    -- gearbox whine
    Gear: number,
    GearPitch: number, -- Hz at the redline
    -- air rush
    Whoosh: number,
    WhooshTone: number, -- brightness: scales the whoosh's centre frequency
    -- inlet hiss
    Suck: number,
    SuckTone: number,
    -- simplified compressor map and outlet hardware
    ShutoffBoost: number, -- Pa above atmosphere at redline and zero forward flow
    FreeFlow: number, -- m^3/s at atmosphere, redline and zero pressure rise
    ValveMode: ValveMode,
    ValveFlow: number, -- m^3/s of relief flow at 1 bar differential, fully open
    BlowOff: number,
    BlowOffTime: number?, -- acoustic decay to 5% after relief flow stops (seconds)
    Surge: number,
    Flutter: number?, -- texture within a modeled surge pulse
    FlutterRate: number?, -- Hz
    -- how much of the impeller and gear tones remain off boost
    IdleAmount: number,
}

-- Tier 1 is the street head unit. Higher tiers interpolate the audio
-- settings toward Big Dog. They share the same compressor and valve model.
function Blower.defaults(tier: number?): BlowerDef
    local index = math.clamp(math.floor(tier or 1), 1, #Blower.TierNames)
    local blend = (index - 1) / (#Blower.TierNames - 1)
    local function scale(base: number, maxTier: number): number
        return math.lerp(base, maxTier, blend)
    end
    return {
        Enabled = true,
        Tier = index,
        Volume = scale(1.0, 1.20),
        Whistle = scale(0.55, 2.00),
        WhistlePitch = 5200,
        WhistleBreath = 0.45,
        Gear = scale(0.22, 0.71),
        GearPitch = 2300,
        Whoosh = scale(0.8, 1.59),
        WhooshTone = 1.0,
        Suck = scale(0.55, 1.15),
        SuckTone = scale(1.0, 1.17),
        ShutoffBoost = 145000,
        FreeFlow = 0.65,
        ValveMode = "Atmospheric",
        ValveFlow = 1.6,
        BlowOff = scale(1.0, 2.00),
        BlowOffTime = scale(0, 0.28),
        Surge = 1.0,
        Flutter = scale(0, 0.52),
        FlutterRate = scale(27, 22),
        IdleAmount = scale(0.30, 0.38),
    }
end

-- Zavalishin (TPT) state-variable filter, band-pass output with unity gain at
-- the centre frequency. Stable right up to Nyquist, unlike the Chamberlin form.
type Svf = { a1: number, a2: number, a3: number, k: number, ic1: number, ic2: number }

local function newSvf(): Svf
    return { a1 = 0, a2 = 0, a3 = 0, k = 1, ic1 = 0, ic2 = 0 }
end

local function tuneSvf(f: Svf, hz: number, q: number, sampleRate: number)
    local g = tan(math.pi * math.clamp(hz, 20, sampleRate * 0.45) / sampleRate)
    local k = 1 / q
    local a1 = 1 / (1 + g * (g + k))
    f.k = k
    f.a1 = a1
    f.a2 = g * a1
    f.a3 = g * g * a1
end

export type Blower = typeof(setmetatable({} :: {
    def: BlowerDef,
    sampleRate: number,
    -- control side (simulation rate)
    chargePressure: number,
    compressorFlow: number,
    engineDemand: number,
    valveOpening: number,
    reversing: boolean,
    -- voice side (audio rate)
    rng: Random,
    tick: number,
    whistlePhase: number,
    gearPhase: number,
    reliefEnvelope: number,
    reliefDecay: number,
    flutterPhase: number,
    wobble: number,
    whistleBand: Svf,
    whooshBand: Svf,
    suckBand: Svf,
    blowOffBand: Svf,
    surgeBand: Svf,
}, Blower))

-- def is used as given (not copied), so editing its fields changes the sound
-- at once. nil gives the defaults, switched off.
function Blower.new(def: BlowerDef?, sampleRate: number): Blower
    local d = def
    if not d then
        d = Blower.defaults()
        d.Enabled = false
    end
    return setmetatable({
        def = d,
        sampleRate = sampleRate,
        chargePressure = ATM,
        compressorFlow = 0,
        engineDemand = 0,
        valveOpening = 0,
        reversing = false,
        rng = Random.new(),
        tick = 0,
        whistlePhase = 0,
        gearPhase = 0,
        reliefEnvelope = 0,
        reliefDecay = 0,
        flutterPhase = 0,
        wobble = 0,
        whistleBand = newSvf(),
        whooshBand = newSvf(),
        suckBand = newSvf(),
        blowOffBand = newSvf(),
        surgeBand = newSvf(),
    }, Blower)
end

function Blower.setTier(self: Blower, tier: number)
    local previous = self.def
    local def = Blower.defaults(tier)
    def.Enabled = previous.Enabled
    def.ValveMode = previous.ValveMode
    def.ValveFlow = previous.ValveFlow
    def.ShutoffBoost = previous.ShutoffBoost
    def.FreeFlow = previous.FreeFlow
    self.def = def
end

-- Flow is expressed as equivalent volume at ambient pressure. Integrating
-- inflow minus outflow into a fixed volume gives absolute charge pressure
-- under an isothermal ideal-gas approximation.
function Blower.step(
    self: Blower,
    rpm: number,
    redline: number,
    throttleFlow: number,
    throttle: number,
    dt: number,
    out: { number },
    base: number
)
    local speed = math.clamp(rpm / redline, 0, 1.25)

    local def = self.def
    local boost = max(0, self.chargePressure - ATM)
    local head = def.ShutoffBoost * speed * speed
    local freeFlow = def.FreeFlow * speed
    local pressureFraction = boost / max(head, 1)

    -- Belt speed sets the speed line. Above its low-flow boundary, the
    -- compressor can unload by reversing until charge pressure drops again.
    if self.reversing then
        self.reversing = pressureFraction > 0.48 and boost > 3000
    else
        self.reversing = pressureFraction > 0.80 and boost > 6000
    end
    local targetFlow = if self.reversing then -0.35 * freeFlow
        else freeFlow * (1 - min(pressureFraction, 1))
    self.compressorFlow += (targetFlow - self.compressorFlow) * min(1, dt / 0.012)

    -- A low throttle command opens the bypass with a short actuator delay.
    -- Both valves relieve the pipe. The return hose adds flow resistance.
    local mode = def.ValveMode
    local targetOpening = if mode == "No valve (surge)" then 0 else math.clamp((0.45 - throttle) / 0.35, 0, 1)
    self.valveOpening += (targetOpening - self.valveOpening) * min(1, dt / 0.018)
    local relief = if mode == "No valve (surge)" then 0
        else def.ValveFlow * self.valveOpening * sqrt(boost / ATM)
    if mode == "Recirculating" then
        relief *= 0.82
    end

    self.engineDemand += (max(0, throttleFlow) - self.engineDemand) * min(1, dt / 0.008)
    -- Ambient air makes up any shortfall on this parallel, boost-only model.
    self.chargePressure = max(ATM,
        self.chargePressure + dt * ATM / CHARGE_VOLUME * (self.compressorFlow - self.engineDemand - relief))

    local inletFlow = self.compressorFlow - (if mode == "Recirculating" then relief else 0)
    out[base + 1] = speed
    out[base + 2] = math.clamp(inletFlow / 0.5, 0, 1.5)
    out[base + 3] = min(boost / ATM, 1)
    -- A belt-driven unit can keep flowing through an open valve after the
    -- burst. At low pressure the same airflow is much quieter.
    local reliefSound = min(relief / 0.45, 1.5) * min(boost / 40000, 1)
    out[base + 4] = if mode == "Recirculating" then -reliefSound else reliefSound
    out[base + 5] = min(max(-self.compressorFlow, 0) / 0.14, 1.5)
end

function Blower.getBoost(self: Blower): number
    return self.chargePressure - ATM
end

-- One output sample, in int16 units (like the synthesizer's streams).
function Blower.render(self: Blower, speed: number, flow: number, load: number, relief: number, surge: number): number
    local def = self.def
    if not def.Enabled or def.Volume <= 0 then
        self.reliefEnvelope = 0
        return 0
    end
    local sampleRate = self.sampleRate
    local tick = self.tick
    local decayTime = def.BlowOffTime or 0
    if tick == 0 then
        self.reliefDecay = if decayTime > 0 then math.exp(math.log(0.05) / (sampleRate * decayTime)) else 0
    end
    -- Keep the measured attack and add an optional acoustic tail. Opposite
    -- signs indicate different valve outlets and start a fresh envelope.
    local tail = self.reliefEnvelope * self.reliefDecay
    if decayTime > 0 and tail * relief >= 0 and math.abs(tail) > math.abs(relief) then
        relief = tail
    end
    self.reliefEnvelope = if math.abs(relief) > 1e-4 then relief else 0
    if speed <= 1e-4 and self.reliefEnvelope == 0 and surge <= 1e-4 then
        return 0
    end

    local whistleHz = def.WhistlePitch * speed
    if tick == 0 then
        tuneSvf(self.whistleBand, whistleHz, 18, sampleRate)
        tuneSvf(self.whooshBand, (250 + 2600 * flow) * def.WhooshTone, 0.7, sampleRate)
        tuneSvf(self.suckBand, (3000 + 6000 * flow) * def.SuckTone, 1.5, sampleRate)
        tuneSvf(self.blowOffBand, if relief >= 0 then 2300 + 2500 * relief else 550 - 650 * relief,
            0.85, sampleRate)
        tuneSvf(self.surgeBand, 350 + 700 * surge, 2.2, sampleRate)
    end
    self.tick = if tick + 1 >= COEFF_INTERVAL then 0 else tick + 1

    local rng = self.rng
    local white = 2 * rng:NextNumber() - 1

    -- slow random drift (~40 Hz), about unit rms: keeps the tones from sounding
    -- like oscillators
    local wobble = self.wobble + (white - self.wobble) * 0.0057
    self.wobble = wobble
    local drift = wobble * 30

    local idle = def.IdleAmount
    local loaded = idle + (1 - idle) * sqrt(load)
    local nyquist = sampleRate * 0.45
    local out = 0

    -- Whistle
    local whistle = def.Whistle
    if whistle > 0 then
        local hz = whistleHz * (1 + 0.003 * drift)
        local p = (self.whistlePhase + hz / sampleRate) % 1
        self.whistlePhase = p
        local tone = 0
        if hz < nyquist then
            tone = sin(TAU * p)
            if 2 * hz < nyquist then
                tone += 0.3 * sin(2 * TAU * p)
            end
        end
        local f = self.whistleBand
        local v3 = white - f.ic2
        local v1 = f.a1 * f.ic1 + f.a2 * v3
        local v2 = f.ic2 + f.a2 * f.ic1 + f.a3 * v3
        f.ic1 = 2 * v1 - f.ic1
        f.ic2 = 2 * v2 - f.ic2
        local air = v1 * f.k * 6

        local breath = def.WhistleBreath
        out += whistle * speed * sqrt(speed) * loaded * (tone * (1 - breath) + air * breath)
    end

    -- Gear whine
    local gear = def.Gear
    if gear > 0 then
        local hz = def.GearPitch * speed
        local p = (self.gearPhase + hz / sampleRate) % 1
        self.gearPhase = p
        local tone = sin(TAU * p)
        if 2 * hz < nyquist then
            tone += 0.45 * sin(2 * TAU * p)
        end
        if 3 * hz < nyquist then
            tone += 0.2 * sin(3 * TAU * p)
        end
        out += gear * speed * loaded * tone * (1 + 0.15 * drift)
    end

    -- Whoosh
    local whoosh = def.Whoosh
    if whoosh > 0 then
        local f = self.whooshBand
        local v3 = white - f.ic2
        local v1 = f.a1 * f.ic1 + f.a2 * v3
        local v2 = f.ic2 + f.a2 * f.ic1 + f.a3 * v3
        f.ic1 = 2 * v1 - f.ic1
        f.ic2 = 2 * v2 - f.ic2
        out += whoosh * flow * sqrt(flow) * v1 * f.k * 3
    end

    -- Suck
    local suck = def.Suck
    if suck > 0 then
        local f = self.suckBand
        local v3 = white - f.ic2
        local v1 = f.a1 * f.ic1 + f.a2 * v3
        local v2 = f.ic2 + f.a2 * f.ic1 + f.a3 * v3
        f.ic1 = 2 * v1 - f.ic1
        f.ic2 = 2 * v2 - f.ic2
        out += suck * flow * flow * v1 * f.k * 2.5
    end

    -- The open outlet is bright and exposed; the return hose muffles the hiss.
    if def.BlowOff > 0 and math.abs(relief) > 1e-4 then
        local f = self.blowOffBand
        local v3 = (2 * rng:NextNumber() - 1) - f.ic2
        local v1 = f.a1 * f.ic1 + f.a2 * v3
        local v2 = f.ic2 + f.a2 * f.ic1 + f.a3 * v3
        f.ic1 = 2 * v1 - f.ic1
        f.ic2 = 2 * v2 - f.ic2
        out += def.BlowOff * math.abs(relief) * (if relief > 0 then 2.2 else 0.85) * v1 * f.k
    end

    -- The pressure cycle supplies each pulse's timing through reverse flow.
    if def.Surge > 0 and surge > 1e-4 then
        local f = self.surgeBand
        local v3 = white - f.ic2
        local v1 = f.a1 * f.ic1 + f.a2 * v3
        local v2 = f.ic2 + f.a2 * f.ic1 + f.a3 * v3
        f.ic1 = 2 * v1 - f.ic1
        f.ic2 = 2 * v2 - f.ic2
        local flutter = def.Flutter or 0
        local texture = 1
        if flutter > 0 then
            local phase = (self.flutterPhase + (def.FlutterRate or 22) / sampleRate) % 1
            self.flutterPhase = phase
            texture -= flutter * (0.5 - 0.5 * math.cos(TAU * phase))
        end
        out += def.Surge * surge * v1 * f.k * 4 * texture
    else
        self.flutterPhase = 0
    end

    return out * def.Volume * LEVEL
end

return Blower
