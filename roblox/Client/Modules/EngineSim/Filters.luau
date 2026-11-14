--!strict
--!native
-- Ports of the small engine-sim filters used by the synthesizer:
--   ButterworthLowPassFilter  (include/butterworth_low_pass_filter.h)
--   LowPassFilter             (include/low_pass_filter.h, src/low_pass_filter.cpp)
--   DerivativeFilter          (src/derivative_filter.cpp)
--   JitterFilter              (include/jitter_filter.h, src/jitter_filter.cpp)
--   LevelingFilter            (src/leveling_filter.cpp)
--   DelayFilter               (include/delay_filter.h)
--
-- Each `f` / `fast_f` matches the C++ arithmetic step for step. Luau numbers are
-- doubles, so results differ from the float templates only by rounding.

local PI = math.pi
local floor = math.floor
local ceil = math.ceil
local abs = math.abs

local Filters = {}

----------------------------------------------------------------------------
-- ButterworthLowPassFilter (4th order, bilinear transform)
----------------------------------------------------------------------------

local Butterworth = {}
Butterworth.__index = Butterworth

export type Butterworth = typeof(setmetatable({} :: {
    -- x1 = newest previous input, x4 = oldest (x_prev[0..3] in C++)
    x1: number, x2: number, x3: number, x4: number,
    y1: number, y2: number, y3: number, y4: number,
    a0: number, a1: number, a2: number, a3: number, a4: number,
    f4: number,
}, Butterworth))

function Butterworth.new(): Butterworth
    return setmetatable({
        x1 = 0, x2 = 0, x3 = 0, x4 = 0,
        y1 = 0, y2 = 0, y3 = 0, y4 = 0,
        a0 = 1, a1 = 0, a2 = 0, a3 = 0, a4 = 0,
        f4 = 0,
    }, Butterworth)
end

function Butterworth.setCutoffFrequency(self: Butterworth, f_c: number, sampleRate: number)
    local f = math.tan(PI * f_c / sampleRate)
    local f_2 = f * f
    local f_3 = f_2 * f
    local f_4 = f_2 * f_2
    local m = -2.0 * math.cos(5.0 * PI / 8.0)
    local n = -2.0 * math.cos(7.0 * PI / 8.0)

    local a0 = 1.0 + (m + n) * f + (2.0 + n * m) * f_2 + (m + n) * f_3 + f_4
    self.a0 = a0
    self.a1 = (-4.0 - 2.0 * (n + m) * f + 2.0 * (m + n) * f_3 + 4.0 * f_4) / a0
    self.a2 = (6.0 - 2.0 * (2.0 + m * n) * f_2 + 6.0 * f_4) / a0
    self.a3 = (-4.0 + 2.0 * (m + n) * f - 2.0 * (m + n) * f_3 + 4.0 * f_4) / a0
    self.a4 = (1.0 - (n + m) * f + (2.0 + m * n) * f_2 - (m + n) * f_3 + f_4) / a0
    self.f4 = f_4
end

function Butterworth.fast_f(self: Butterworth, sample: number): number
    local x1, x2, x3, x4 = self.x1, self.x2, self.x3, self.x4
    local y1, y2, y3, y4 = self.y1, self.y2, self.y3, self.y4

    local n = self.f4 / self.a0 * (sample + 4 * x1 + 6 * x2 + 4 * x3 + x4)
    local d = -self.a1 * y1 - self.a2 * y2 - self.a3 * y3 - self.a4 * y4
    local y = n + d

    self.x4, self.x3, self.x2, self.x1 = x3, x2, x1, sample
    self.y4, self.y3, self.y2, self.y1 = y3, y2, y1, y

    return y
end

Filters.Butterworth = Butterworth

----------------------------------------------------------------------------
-- LowPassFilter (1st order RC)
----------------------------------------------------------------------------

local LowPass = {}
LowPass.__index = LowPass

export type LowPass = typeof(setmetatable({} :: {
    dt: number,
    y: number,
    rc: number,
}, LowPass))

function LowPass.new(): LowPass
    return setmetatable({ y = 0, rc = 0, dt = 1 / 44100.0 }, LowPass)
end

function LowPass.setCutoffFrequency(self: LowPass, f: number)
    self.rc = 1.0 / (f * 2.0 * PI)
end

function LowPass.fast_f(self: LowPass, sample: number): number
    local alpha = self.dt / (self.rc + self.dt)
    local y = alpha * sample + (1 - alpha) * self.y
    self.y = y
    return y
end

Filters.LowPass = LowPass

----------------------------------------------------------------------------
-- DerivativeFilter
----------------------------------------------------------------------------

local Derivative = {}
Derivative.__index = Derivative

export type Derivative = typeof(setmetatable({} :: {
    dt: number,
    previous: number,
}, Derivative))

function Derivative.new(): Derivative
    return setmetatable({ previous = 0, dt = 0 }, Derivative)
end

function Derivative.f(self: Derivative, sample: number): number
    local temp = self.previous
    self.previous = sample
    return (sample - temp) / self.dt
end

Filters.Derivative = Derivative

----------------------------------------------------------------------------
-- JitterFilter: reads the input history at a randomly wandering fractional
-- delay (0..maxJitter-1 samples), driven by low-passed uniform noise.
----------------------------------------------------------------------------

local Jitter = {}
Jitter.__index = Jitter

export type Jitter = typeof(setmetatable({} :: {
    noiseFilter: Butterworth,
    jitterScale: number,
    maxJitter: number,
    offset: number,
    history: { number },
    rng: Random,
}, Jitter))

function Jitter.new(): Jitter
    return setmetatable({
        noiseFilter = Butterworth.new(),
        jitterScale = 0.0,
        maxJitter = 0,
        offset = 0,
        history = {},
        rng = Random.new(),
    }, Jitter)
end

function Jitter.initialize(self: Jitter, maxJitter: number, cutoffFrequency: number, audioFrequency: number)
    self.maxJitter = maxJitter
    self.history = table.create(maxJitter, 0)
    self.offset = 0
    self.noiseFilter:setCutoffFrequency(cutoffFrequency, audioFrequency)
end

function Jitter.setJitterScale(self: Jitter, jitterScale: number)
    self.jitterScale = jitterScale
end

local function clamp(x: number, x0: number, x1: number): number
    if x <= x0 then
        return x0
    elseif x >= x1 then
        return x1
    end
    return x
end

function Jitter.fast_f(self: Jitter, sample: number, jitterScale: number?): number
    local maxJitter = self.maxJitter
    local history = self.history

    history[self.offset + 1] = sample
    local offset = self.offset + 1
    if offset >= maxJitter then
        offset = 0
    end
    self.offset = offset

    -- std::uniform_real_distribution<float>(0, maxJitter - 1)
    local u = self.rng:NextNumber() * (maxJitter - 1)
    local s = self.noiseFilter:fast_f(u * self.jitterScale * (jitterScale or 1.0))
    local s_i_0 = clamp(floor(s), 0.0, maxJitter - 1)
    local s_i_1 = clamp(ceil(s), 0.0, maxJitter - 1)

    local s_frac = s - s_i_0

    local i_0 = s_i_0 + offset
    local i_1 = s_i_1 + offset

    local v0 = history[(if i_0 >= maxJitter then i_0 - maxJitter else i_0) + 1]
    local v1 = history[(if i_1 >= maxJitter then i_1 - maxJitter else i_1) + 1]

    return v1 * s_frac + v0 * (1 - s_frac)
end

Filters.Jitter = Jitter

----------------------------------------------------------------------------
-- LevelingFilter: peak-tracking automatic gain control
--
-- Not engine-sim's arithmetic any more. Two changes, both needed because the
-- lumped engine model's signal spans ~90 dB where engine-sim's spans far less:
--   * the peak decays over ~150 ms instead of ~23 ms, and only once pulses
--     stop reaching near it (HOLD_TIME). The short decay let the gain recover
--     between firing pulses (and between the bursts of a rotary idle), which
--     pumps the level inside every cycle; a plain 150 ms decay still swung
--     it about 1.5x within 0.1 s at idle.
--   * the gain drops at once when the peak rises (engine-sim eases it over
--     ~20 samples, so every pulse that grew arrived before the gain did and
--     clipped). It still eases back up.
-- p_target may change every frame (the simulator sets it from engine load);
-- it is eased over ~25 ms so the steps are not heard.
----------------------------------------------------------------------------

local Leveling = {}
Leveling.__index = Leveling

-- The peak is held while pulses keep reaching within HOLD_REARM of it, and
-- decays only once they stop for HOLD_TIME. A plain decay lets the gain rise
-- in the gap after every firing pulse (and further after a weak or missed
-- one), which pumps the level from cycle to cycle.
local HOLD_TIME = 0.12 -- s
local HOLD_REARM = 0.5 -- -6 dB

export type Leveling = typeof(setmetatable({} :: {
    peak: number,
    attenuation: number,
    target: number, -- eased p_target
    release: number, -- peak decay per sample
    holdSamples: number, -- how long a pulse near the peak holds it
    hold: number, -- samples of hold left
    p_target: number,
    p_minLevel: number,
    p_maxLevel: number,
}, Leveling))

function Leveling.new(): Leveling
    return setmetatable({
        peak = 30000.0,
        attenuation = 1.0,
        target = 30000.0,
        release = math.exp(-1 / (0.15 * 44100)),
        holdSamples = math.floor(HOLD_TIME * 44100),
        hold = 0,
        p_target = 30000.0,
        p_minLevel = 0.0,
        p_maxLevel = 1.0,
    }, Leveling)
end

-- the hold and the 0.15 s peak decay are the same at any sample rate
function Leveling.setSampleRate(self: Leveling, sampleRate: number)
    self.release = math.exp(-1 / (0.15 * sampleRate))
    self.holdSamples = math.floor(HOLD_TIME * sampleRate)
end

function Leveling.f(self: Leveling, sample: number): number
    local peak = self.peak
    local a = abs(sample)
    if a > peak then
        peak = a
        self.hold = self.holdSamples
    elseif a > HOLD_REARM * peak then
        -- a pulse nearly as strong: the level is still there
        self.hold = self.holdSamples
    elseif self.hold > 0 then
        self.hold -= 1
    else
        peak *= self.release
    end
    self.peak = peak

    if peak == 0 then
        return 0
    end

    local target = self.target + (self.p_target - self.target) * 0.001
    self.target = target

    local attenuation = target / peak
    if attenuation < self.p_minLevel then
        attenuation = self.p_minLevel
    elseif attenuation > self.p_maxLevel then
        attenuation = self.p_maxLevel
    end

    if attenuation < self.attenuation then
        self.attenuation = attenuation
    else
        self.attenuation = 0.9 * self.attenuation + 0.1 * attenuation
    end

    return sample * self.attenuation
end

function Leveling.getAttenuation(self: Leveling): number
    return self.attenuation
end

Filters.Leveling = Leveling

----------------------------------------------------------------------------
-- DelayFilter (used by the simulator on each cylinder's exhaust pulse)
----------------------------------------------------------------------------

local Delay = {}
Delay.__index = Delay

-- engine-sim writes each sample to a RingBuffer and pops one once more than
-- `latencySamples` are queued, which is a fixed delay: out[n] = in[n - L],
-- and zero for the first L samples. This is the same thing as one read and
-- one write on a circular array of L samples. It runs for every cylinder on
-- every simulation step, so it is worth keeping to that.
export type Delay = typeof(setmetatable({} :: {
    latencySamples: number,
    line: { number },
    index: number,
}, Delay))

function Delay.new(delay: number, audioFrequency: number): Delay
    -- std::round: halves away from zero; delay is always >= 0 here
    local samples = floor(delay * audioFrequency + 0.5)
    return setmetatable({
        latencySamples = samples,
        line = table.create(samples, 0),
        index = 1,
    }, Delay)
end

function Delay.fast_f(self: Delay, sample: number): number
    local n = self.latencySamples
    if n == 0 then
        return sample
    end
    local line = self.line
    local i = self.index
    local out = line[i]
    line[i] = sample
    self.index = if i >= n then 1 else i + 1
    return out
end

Filters.Delay = Delay

----------------------------------------------------------------------------
-- Waveguide (Roblox addition, not in engine-sim): one pipe as two delay
-- lines, a wave running from the engine end to the open end and one running
-- back.
--
--   engine end:  forward = source + headReflection * backward
--   open end:    backward = -endReflection * lowpass(forward)
--
-- An open pipe end reflects long waves almost completely (inverted) and lets
-- short ones out: the reflection falls away once the wavelength nears the
-- pipe's circumference. The one-pole low-pass in the reflection is that, and
-- its phase lag is the end correction. With a flat reflection instead every
-- resonance up to Nyquist rings equally, which is the sound of a tin can.
--
-- fast_f returns forward - backward at the open end, which is proportional
-- to the volume velocity leaving the pipe (in the source's units).
----------------------------------------------------------------------------

local Waveguide = {}
Waveguide.__index = Waveguide

export type Waveguide = typeof(setmetatable({} :: {
    samples: number, -- one-way travel time
    forward: { number },
    backward: { number },
    index: number,
    alpha: number, -- low-pass coefficient of the open-end reflection
    reflected: number, -- low-pass state
    endReflection: number,
    headReflection: number,
}, Waveguide))

-- delay: one-way travel time (s). cutoff: corner of the open-end reflection (Hz).
function Waveguide.new(
    delay: number,
    sampleRate: number,
    cutoff: number,
    endReflection: number,
    headReflection: number
): Waveguide
    local samples = math.max(1, floor(delay * sampleRate + 0.5))
    return setmetatable({
        samples = samples,
        forward = table.create(samples, 0),
        backward = table.create(samples, 0),
        index = 1,
        alpha = 1 - math.exp(-2 * PI * cutoff / sampleRate),
        reflected = 0,
        endReflection = endReflection,
        headReflection = headReflection,
    }, Waveguide)
end

function Waveguide.fast_f(self: Waveguide, source: number): number
    local forward, backward = self.forward, self.backward
    local i = self.index
    local atEnd = forward[i]
    local atHead = backward[i]

    local reflected = self.reflected + self.alpha * (atEnd - self.reflected)
    self.reflected = reflected
    reflected *= self.endReflection

    backward[i] = -reflected
    forward[i] = source + self.headReflection * atHead
    self.index = if i >= self.samples then 1 else i + 1

    return atEnd + reflected
end

Filters.Waveguide = Waveguide

----------------------------------------------------------------------------
-- Flow noise (Roblox addition): white noise band-limited to the range where
-- the turbulence of gas leaving a pipe radiates. A jet's noise peaks near a
-- Strouhal number of 0.2 (0.2 x speed / diameter, about 1 kHz for an
-- exhaust) and falls away steeply below it; it has little energy in the low
-- range where the exhaust impulse responses resonate, and noise there sounds
-- like a rumble or a blat, not a hiss. So: a one-pole high-pass, then the
-- 4th-order low-pass engine-sim's air noise uses.
----------------------------------------------------------------------------

local FlowNoise = {}
FlowNoise.__index = FlowNoise

export type FlowNoise = typeof(setmetatable({} :: {
    lowPass: Butterworth,
    highPassState: number,
    highPassAlpha: number,
}, FlowNoise))

function FlowNoise.new(): FlowNoise
    return setmetatable({
        lowPass = Butterworth.new(),
        highPassState = 0,
        highPassAlpha = 0,
    }, FlowNoise)
end

function FlowNoise.setBand(self: FlowNoise, low: number, high: number, sampleRate: number)
    self.highPassAlpha = 1 - math.exp(-2 * PI * low / sampleRate)
    self.lowPass:setCutoffFrequency(high, sampleRate)
end

function FlowNoise.fast_f(self: FlowNoise, white: number): number
    local x = self.lowPass:fast_f(white)
    local s = self.highPassState + self.highPassAlpha * (x - self.highPassState)
    self.highPassState = s
    return x - s
end

Filters.FlowNoise = FlowNoise

return Filters
