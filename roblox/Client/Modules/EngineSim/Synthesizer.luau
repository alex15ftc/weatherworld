--!strict
--!native
-- Port of engine-sim src/synthesizer.cpp.
--
-- Signal path per exhaust channel, per 44.1 kHz audio sample:
--   writeInput   : simulator-rate samples -> linear upsample -> 1900 Hz Butterworth -> input ring
--   renderAudio  : jitter (random fractional delay)
--                  f   = x - DC(x)           (10 Hz one-pole high-pass)
--                  f'  = dx/dt
--                  r   = 2 kHz low-passed white noise ("air noise")
--                  v   = f' * dF_F_mix + f * (airNoise * r + 1 - airNoise) * (1 - dF_F_mix)
--                  v   = conv * IR(v) + (1 - conv) * v
--   sum channels -> 19.8 kHz Butterworth -> leveling AGC -> * volume -> int16
--
-- Roblox addition (not in engine-sim): an optional aux channel for the intake
-- side (induction pulses and supercharger whine). It shares the input ring's
-- timing, so it stays in sync with the engine, but it skips the 1900 Hz input
-- filter, jitter, air noise and the exhaust convolution.
--
-- Roblox addition: two output streams. The exhaust (all exhaust channels after
-- convolution) and the intake (aux) are rendered into separate buffers so each
-- can play from its own place on the car. One leveler gain, computed from
-- their sum, scales both, so their balance is the same as the mixed output
-- and exhaust + intake equals what the single-stream synthesizer produced.
--
-- Roblox addition: outlet radiation (Parameters.outletRadiation). The exhaust
-- channels then carry the volume velocity u leaving each tailpipe (the
-- simulator's pipe model supplies it) and the channel's signal becomes what an
-- open pipe end radiates:
--                  v   = u' * dF_F_mix + n * envelope * airNoise * (1 - dF_F_mix)
-- A pipe end is a monopole, so the pressure it radiates goes with du/dt; that
-- is the derivative above, now the whole pulse and not a share of it. The
-- noise n is the turbulence of the gas leaving: white noise band-limited
-- from FLOW_NOISE_LOW to airNoiseFrequencyCutoff (Filters.FlowNoise), scaled
-- by an envelope the simulator writes beside each channel (it rises with the
-- fourth power of the outflow's speed), in place of white noise multiplied
-- by the pressure signal.
--
-- engine-sim runs renderAudio on its own thread and hands blocks over with a
-- mutex and condition variable. Roblox Luau is single threaded here, so the
-- simulator calls endInputBlock() then renderAudio() once per frame, which is
-- the same hand-off order the condition variable enforces in the original.

local RingBuffer = require(script.Parent.RingBuffer)
local Filters = require(script.Parent.Filters)
local ConvolutionFilter = require(script.Parent.ConvolutionFilter)
local Blower = require(script.Parent.Blower)

local Synthesizer = {}
Synthesizer.__index = Synthesizer

local INT16_MAX = 32767
-- afterfire path: how long it rings after the last bang (impulse responses
-- are cut at 10000 samples, plus the FFT blocks)
local BANG_RING_SAMPLES = 10000 + 4096
local BANG_HEADROOM = 8 * 32768
local BANG_RELEASE = math.exp(-1 / (1.5 * 44100))
-- into the limiter: enough that a full-charge bang reaches the ceiling on
-- every preset (the quietest, the 935 K3, makes ~0.6x full scale undriven)
local BANG_DRIVE = 12
local INT16_MIN = -32768
local FLT_MIN = 1.17549435e-38
local abs = math.abs
-- lower edge of the outlet flow noise (Hz), see the header
local FLOW_NOISE_LOW = 250

export type AudioParameters = {
    volume: number,
    convolution: number,
    dF_F_mix: number,
    inputSampleNoise: number,
    inputSampleNoiseFrequencyCutoff: number,
    airNoise: number,
    airNoiseFrequencyCutoff: number,
    levelerTarget: number,
    levelerMaxGain: number,
    levelerMinGain: number,
}

export type Parameters = {
    inputChannelCount: number,
    inputBufferSize: number,
    audioBufferSize: number,
    inputSampleRate: number,
    audioSampleRate: number,
    initialAudioParameters: AudioParameters?,
    -- Roblox-only: "fft" (default) or "direct" convolution, and FFT block size.
    convolutionMode: string?,
    convolutionBlockSize: number?,
    -- Roblox-only: one extra input value per writeInput (data[inputChannelCount + 1])
    auxChannel: boolean?,
    auxGain: number?,
    -- Roblox-only: centrifugal supercharger voice. writeInput then takes its
    -- Blower.CONTROLS control values after the aux value.
    blower: Blower.Blower?,
    -- Roblox-only: outlet radiation (see the header). writeInput then takes
    -- one flow-noise envelope per exhaust channel after the blower controls.
    outletRadiation: boolean?,
    -- Roblox-only: exhaust afterfire. writeInput then takes one afterfire
    -- channel per exhaust channel after the envelopes; each is convolved with
    -- its exhaust's impulse response and mixed in after the leveler.
    afterfire: boolean?,
}

type InputChannel = {
    data: RingBuffer.RingBuffer,
    transferBuffer: { number },
    lastInputSample: number,
}

type ImpulseSource = { source: { number }, count: number, volume: number }

type ConvolutionGroup = {
    conv: ConvolutionFilter.ConvolutionFilter,
    src: ImpulseSource?,
    input: number,
    -- the afterfire path's copy of the same impulse response
    bangConv: ConvolutionFilter.ConvolutionFilter?,
    bangInput: number,
}

type BangFilters = {
    antialiasing: Filters.Butterworth,
    dc: Filters.LowPass,
    derivative: Filters.Derivative,
}

type ProcessingFilters = {
    convolution: ConvolutionFilter.ConvolutionFilter,
    derivative: Filters.Derivative,
    jitterFilter: Filters.Jitter,
    airNoiseLowPass: Filters.Butterworth,
    inputDcFilter: Filters.LowPass,
    antialiasing: Filters.Butterworth,
    flowNoise: Filters.FlowNoise,
}

function Synthesizer.defaultAudioParameters(): AudioParameters
    return {
        volume = 1.0,
        convolution = 1.0,
        dF_F_mix = 0.01,
        inputSampleNoise = 0.5,
        inputSampleNoiseFrequencyCutoff = 10000.0,
        airNoise = 1.0,
        airNoiseFrequencyCutoff = 2000.0,
        levelerTarget = 30000.0,
        levelerMaxGain = 1.9,
        levelerMinGain = 0.00001,
    }
end

function Synthesizer.defaultParameters(): Parameters
    return {
        inputChannelCount = 1,
        inputBufferSize = 1024,
        audioBufferSize = 44100,
        inputSampleRate = 10000,
        audioSampleRate = 44100,
        initialAudioParameters = Synthesizer.defaultAudioParameters(),
    }
end

export type Synthesizer = typeof(setmetatable({} :: {
    antialiasing: Filters.Butterworth,
    levelingFilter: Filters.Leveling,
    inputChannels: { InputChannel },
    filters: { ProcessingFilters },
    audioParameters: AudioParameters,
    inputChannelCount: number,
    inputBufferSize: number,
    inputSamplesRead: number,
    latency: number,
    inputWriteOffset: number,
    lastInputSampleOffset: number,
    audioBuffer: RingBuffer.RingBuffer,
    audioBufferSize: number,
    inputSampleRate: number,
    audioSampleRate: number,
    processed: boolean,
    convolutionMode: string?,
    convolutionBlockSize: number?,
    impulseSources: { [number]: ImpulseSource },
    convGroups: { ConvolutionGroup },
    convGroupOf: { number },
    rng: Random,
    aux: InputChannel?,
    auxAntialiasing: Filters.Butterworth,
    auxDc: Filters.LowPass,
    auxGain: number,
    -- intake stream, written in lockstep with audioBuffer (the exhaust stream)
    auxAudioBuffer: RingBuffer.RingBuffer,
    -- afterfire stream, in lockstep too: added to the exhaust stream after the
    -- engine's int16 clamp, with BANG_HEADROOM of room
    bangAudioBuffer: RingBuffer.RingBuffer,
    lastBang: number,
    auxOutAntialiasing: Filters.Butterworth,
    lastIntake: number,
    -- centrifugal supercharger voice and its control rings (in lockstep with
    -- the input rings, so it stays in sync with the exhaust)
    blower: Blower.Blower?,
    controls: { InputChannel },
    -- the blower's def.Enabled as seen by the last writeInput. While it is
    -- false the control rings are neither written, read nor allocated.
    blowerActive: boolean,
    -- outlet radiation: one flow-noise envelope ring per exhaust channel
    -- (empty when it is off)
    envelopes: { InputChannel },
    -- airNoiseFrequencyCutoff the noise filters were last tuned to
    noiseCutoff: number,
    -- Roblox addition: 0..1 scale on the leveler target, set every frame by
    -- the simulator from engine speed and load (the leveler eases it)
    loudness: number,
    -- exhaust afterfire channels (empty when off), their filters, and the
    -- loudest they may get, x engine full scale (FuelMap.BangVolume, set
    -- every frame).
    -- bangHold counts the samples until the path has rung out and can stop.
    bangs: { InputChannel },
    bangFilters: { BangFilters },
    afterfireGain: number,
    bangHold: number,
    bangAntialiasing: Filters.Butterworth,
    bangPeak: number, -- the loudest afterfire output so far, int16 units (for tests)
    bangLimit: number, -- the afterfire limiter's gain
}, Synthesizer))

function Synthesizer.new(): Synthesizer
    return setmetatable({
        antialiasing = Filters.Butterworth.new(),
        levelingFilter = Filters.Leveling.new(),
        inputChannels = {},
        filters = {},
        audioParameters = Synthesizer.defaultAudioParameters(),
        inputChannelCount = 0,
        inputBufferSize = 0,
        inputSamplesRead = 0,
        latency = 0,
        inputWriteOffset = 0.0,
        lastInputSampleOffset = 0.0,
        audioBuffer = RingBuffer.new(1),
        audioBufferSize = 0,
        inputSampleRate = 0.0,
        audioSampleRate = 0.0,
        processed = true,
        convolutionMode = nil,
        convolutionBlockSize = nil,
        impulseSources = {},
        convGroups = {},
        convGroupOf = {},
        rng = Random.new(),
        aux = nil,
        auxAntialiasing = Filters.Butterworth.new(),
        auxDc = Filters.LowPass.new(),
        auxGain = 1,
        auxAudioBuffer = RingBuffer.new(1),
        bangAudioBuffer = RingBuffer.new(1),
        lastBang = 0,
        auxOutAntialiasing = Filters.Butterworth.new(),
        bangs = {},
        bangFilters = {},
        afterfireGain = 0,
        bangHold = 0,
        bangAntialiasing = Filters.Butterworth.new(),
        bangPeak = 0,
        bangLimit = 1,
        lastIntake = 0,
        blower = nil,
        controls = {},
        blowerActive = false,
        envelopes = {},
        noiseCutoff = -1,
        loudness = 1,
    }, Synthesizer)
end

function Synthesizer.initialize(self: Synthesizer, p: Parameters)
    local ap = table.clone(p.initialAudioParameters or Synthesizer.defaultAudioParameters())

    self.inputChannelCount = p.inputChannelCount
    self.inputBufferSize = p.inputBufferSize
    self.audioBufferSize = p.audioBufferSize
    self.inputSampleRate = p.inputSampleRate
    self.audioSampleRate = p.audioSampleRate
    self.audioParameters = ap
    self.convolutionMode = p.convolutionMode
    self.convolutionBlockSize = p.convolutionBlockSize

    self.inputSamplesRead = 0
    self.inputWriteOffset = 0
    self.lastInputSampleOffset = 0
    self.processed = true

    self.audioBuffer = RingBuffer.new(p.audioBufferSize)
    self.auxAudioBuffer = RingBuffer.new(p.audioBufferSize)
    self.bangAudioBuffer = RingBuffer.new(p.audioBufferSize)
    self.inputChannels = {}
    self.filters = {}

    for i = 1, p.inputChannelCount do
        self.inputChannels[i] = {
            data = RingBuffer.new(p.inputBufferSize),
            transferBuffer = table.create(p.inputBufferSize, 0),
            lastInputSample = 0.0,
        }

        local f: ProcessingFilters = {
            convolution = ConvolutionFilter.new(),
            derivative = Filters.Derivative.new(),
            jitterFilter = Filters.Jitter.new(),
            airNoiseLowPass = Filters.Butterworth.new(),
            inputDcFilter = Filters.LowPass.new(),
            antialiasing = Filters.Butterworth.new(),
            flowNoise = Filters.FlowNoise.new(),
        }

        f.airNoiseLowPass:setCutoffFrequency(ap.airNoiseFrequencyCutoff, self.audioSampleRate)
        f.derivative.dt = 1 / self.audioSampleRate
        f.inputDcFilter:setCutoffFrequency(10.0)
        f.inputDcFilter.dt = 1 / self.audioSampleRate
        f.jitterFilter:initialize(10, ap.inputSampleNoiseFrequencyCutoff, self.audioSampleRate)
        f.antialiasing:setCutoffFrequency(1900.0, self.audioSampleRate)

        self.filters[i] = f
    end

    if p.auxChannel then
        self.aux = {
            data = RingBuffer.new(p.inputBufferSize),
            transferBuffer = table.create(p.inputBufferSize, 0),
            lastInputSample = 0.0,
        }
        -- anti-imaging for the linear upsampler, kept below the input Nyquist
        self.auxAntialiasing:setCutoffFrequency(math.min(5000, p.inputSampleRate * 0.42), self.audioSampleRate)
        self.auxDc:setCutoffFrequency(20.0)
        self.auxDc.dt = 1 / self.audioSampleRate
        self.auxGain = p.auxGain or 1
    else
        self.aux = nil
    end

    -- the control rings are allocated the first time the blower is enabled
    -- (_activateBlower), so a disabled blower costs nothing
    self.blower = p.blower
    self.controls = {}
    self.blowerActive = false

    self.envelopes = {}
    if p.outletRadiation then
        for i = 1, p.inputChannelCount do
            self.envelopes[i] = {
                data = RingBuffer.new(p.inputBufferSize),
                transferBuffer = table.create(p.inputBufferSize, 0),
                lastInputSample = 0.0,
            }
        end
    end

    self.bangs = {}
    self.bangFilters = {}
    if p.afterfire then
        for i = 1, p.inputChannelCount do
            self.bangs[i] = {
                data = RingBuffer.new(p.inputBufferSize),
                transferBuffer = table.create(p.inputBufferSize, 0),
                lastInputSample = 0.0,
            }
            local bf: BangFilters = {
                antialiasing = Filters.Butterworth.new(),
                dc = Filters.LowPass.new(),
                derivative = Filters.Derivative.new(),
            }
            -- wider than the exhaust's 1900 Hz, so a bang keeps its crack
            bf.antialiasing:setCutoffFrequency(math.min(5000, p.inputSampleRate * 0.42), self.audioSampleRate)
            bf.dc:setCutoffFrequency(15.0)
            bf.dc.dt = 1 / self.audioSampleRate
            bf.derivative.dt = 1 / self.audioSampleRate
            self.bangFilters[i] = bf
        end
    end
    self.bangHold = 0
    self.bangAntialiasing:setCutoffFrequency(self.audioSampleRate * 0.45, self.audioSampleRate)

    self.noiseCutoff = ap.airNoiseFrequencyCutoff
    self.impulseSources = {}
    self:_rebuildConvolutionGroups()

    self.levelingFilter:setSampleRate(self.audioSampleRate)
    self.levelingFilter.p_target = ap.levelerTarget
    self.levelingFilter.p_maxLevel = ap.levelerMaxGain
    self.levelingFilter.p_minLevel = ap.levelerMinGain
    self.antialiasing:setCutoffFrequency(self.audioSampleRate * 0.45, self.audioSampleRate)
    self.auxOutAntialiasing:setCutoffFrequency(self.audioSampleRate * 0.45, self.audioSampleRate)

    -- engine-sim fills the audio buffer with `audioBufferSize` zeros, which
    -- wraps the write index back onto the start: the buffer begins empty.
    for _ = 1, self.audioBufferSize do
        self.audioBuffer:write(0)
        self.auxAudioBuffer:write(0)
        self.bangAudioBuffer:write(0)
    end
end

-- impulseResponse: int16 sample values (1-based array). index is 1-based.
function Synthesizer.initializeImpulseResponse(
    self: Synthesizer,
    impulseResponse: { number },
    samples: number,
    volume: number,
    index: number
)
    local clippedLength = 0
    for i = 0, samples - 1 do
        if abs(impulseResponse[i + 1]) > 100 then
            clippedLength = i + 1
        end
    end

    local sampleCount = math.min(10000, clippedLength)
    self.impulseSources[index] = { source = impulseResponse, count = sampleCount, volume = volume }
    self:_rebuildConvolutionGroups()
end

-- Convolution is linear, so channels that use the same impulse response can
-- be summed first and convolved once: sum_i IR(v_i) == IR(sum_i v_i). This is
-- an optimisation only; the output is the same as one filter per channel.
function Synthesizer._rebuildConvolutionGroups(self: Synthesizer)
    local groups: { ConvolutionGroup } = {}
    local groupOf: { number } = {}

    for i = 1, self.inputChannelCount do
        local src = self.impulseSources[i]
        local found = 0
        if src then
            for g, group in groups do
                local other = group.src
                if other and other.source == src.source and other.count == src.count and other.volume == src.volume then
                    found = g
                    break
                end
            end
        end

        if found == 0 then
            local conv = ConvolutionFilter.new()
            local count = if src then src.count else 0
            conv:initialize(count)
            if src then
                local h = conv:getImpulseResponse()
                for k = 1, count do
                    h[k] = src.volume * src.source[k] / INT16_MAX
                end
            end
            conv:prepare(self.convolutionMode, self.convolutionBlockSize)
            local bangConv: ConvolutionFilter.ConvolutionFilter? = nil
            if #self.bangs > 0 then
                local bc = ConvolutionFilter.new()
                bc:initialize(count)
                local h, hb = conv:getImpulseResponse(), bc:getImpulseResponse()
                for k = 1, count do
                    hb[k] = h[k]
                end
                bc:prepare(self.convolutionMode, self.convolutionBlockSize)
                bangConv = bc
            end
            table.insert(groups, { conv = conv, src = src, input = 0, bangConv = bangConv, bangInput = 0 })
            found = #groups
        end

        groupOf[i] = found
        self.filters[i].convolution = groups[found].conv
    end

    self.convGroups = groups
    self.convGroupOf = groupOf
end

-- Roblox-only helper: extra output latency added by FFT convolution (samples).
function Synthesizer.getConvolutionLatency(self: Synthesizer): number
    local f = self.filters[1]
    return if f then f.convolution:getLatency() else 0
end

-- readAudioOutput: pops up to `samples` int16 values of the mixed output into target[1..].
-- Returns the number of real samples (the rest is zero-filled).
function Synthesizer.readAudioOutput(self: Synthesizer, samples: number, target: { number }): number
    local n = math.min(samples, self.audioBuffer:size())
    for i = 1, n do
        target[i] = self:popAudioSample() :: number
    end
    for i = n + 1, samples do
        target[i] = 0
    end
    return n
end

-- Pops a single sample of the mixed output (exhaust + intake, as engine-sim's
-- single stream), or nil when the output buffer is empty.
function Synthesizer.popAudioSample(self: Synthesizer): number?
    local buf = self.audioBuffer
    if buf:size() == 0 then
        return nil
    end
    local v = buf:pop() + self.auxAudioBuffer:pop()
    v = if v > INT16_MAX then INT16_MAX elseif v < INT16_MIN then INT16_MIN else v
    -- afterfire bangs go on top, past int16 full scale (StreamOutput's HEADROOM)
    return v + self.bangAudioBuffer:pop()
end

-- Pops one frame of the split output: (exhaust, intake), int16 each, or nil
-- when the output buffer is empty.
function Synthesizer.popAudioFrame(self: Synthesizer): (number?, number)
    local buf = self.audioBuffer
    if buf:size() == 0 then
        return nil, 0
    end
    return buf:pop() + self.bangAudioBuffer:pop(), self.auxAudioBuffer:pop()
end

function Synthesizer.getBufferedAudioSamples(self: Synthesizer): number
    return self.audioBuffer:size()
end

function Synthesizer.inputDistance(self: Synthesizer, s1: number, s0: number): number
    if s1 < s0 then
        return self.inputBufferSize - s0 + s1
    end
    return s1 - s0
end

-- Brings the blower's control rings into lockstep with the input rings when
-- the blower is switched on: same start and write index, and the pending span
-- filled with the first control values so nothing stale is read.
function Synthesizer._activateBlower(self: Synthesizer, data: { number })
    local reference = self.inputChannels[1].data
    local start, writeIndex = reference:start(), reference:writeIndex()
    local pending = reference:size()
    local base = self.inputChannelCount + 1
    for k = 1, Blower.CONTROLS do
        local channel = self.controls[k]
        if not channel then
            channel = {
                data = RingBuffer.new(self.inputBufferSize),
                transferBuffer = table.create(self.inputBufferSize, 0),
                lastInputSample = 0.0,
            }
            self.controls[k] = channel
        end
        local value = data[base + k] or 0
        local ring = channel.data
        ring:reset(start)
        for _ = 1, pending do
            ring:write(value)
        end
        assert(ring:writeIndex() == writeIndex, "ring write index")
        channel.lastInputSample = value
    end
end

-- writeInput(data): one simulator timestep, one value per exhaust channel.
function Synthesizer.writeInput(self: Synthesizer, data: { number })
    local inputBufferSize = self.inputBufferSize
    local writeOffset = self.inputWriteOffset + self.audioSampleRate / self.inputSampleRate
    if writeOffset >= inputBufferSize then
        writeOffset -= inputBufferSize
    end
    self.inputWriteOffset = writeOffset

    local lastOffset = self.lastInputSampleOffset

    local blower = self.blower
    local blowerActive = blower ~= nil and blower.def.Enabled
    if blowerActive and not self.blowerActive and self.inputChannelCount > 0 then
        self:_activateBlower(data)
    end
    self.blowerActive = blowerActive

    for i = 1, self.inputChannelCount do
        local channel = self.inputChannels[i]
        local buffer = channel.data
        local antialiasing = self.filters[i].antialiasing
        local lastInputSample = channel.lastInputSample
        local value = data[i]

        local baseIndex = buffer:writeIndex()
        local distance = self:inputDistance(writeOffset, lastOffset)
        local s = self:inputDistance(baseIndex, lastOffset)

        while s <= distance do
            if s >= inputBufferSize then
                s -= inputBufferSize
            end

            local f = s / distance
            local sample = lastInputSample * (1 - f) + value * f

            buffer:write(antialiasing:fast_f(sample))
            s += 1.0
        end

        channel.lastInputSample = value
    end

    local aux = self.aux
    if aux then
        local buffer = aux.data
        local aa = self.auxAntialiasing
        local last = aux.lastInputSample
        local value = data[self.inputChannelCount + 1] or 0
        local distance = self:inputDistance(writeOffset, lastOffset)
        local s = self:inputDistance(buffer:writeIndex(), lastOffset)
        while s <= distance do
            if s >= inputBufferSize then
                s -= inputBufferSize
            end
            local f = s / distance
            buffer:write(aa:fast_f(last * (1 - f) + value * f))
            s += 1.0
        end
        aux.lastInputSample = value
    end

    -- blower controls: slow values, linear ramp only
    local controls = self.controls
    for k = 1, if blowerActive then #controls else 0 do
        local channel = controls[k]
        local buffer = channel.data
        local last = channel.lastInputSample
        local value = data[self.inputChannelCount + 1 + k] or 0
        local distance = self:inputDistance(writeOffset, lastOffset)
        local s = self:inputDistance(buffer:writeIndex(), lastOffset)
        while s <= distance do
            if s >= inputBufferSize then
                s -= inputBufferSize
            end
            local f = s / distance
            buffer:write(last * (1 - f) + value * f)
            s += 1.0
        end
        channel.lastInputSample = value
    end

    -- flow-noise envelopes: slow values, linear ramp only
    local envelopes = self.envelopes
    -- the blower's slots are in data whether or not it is enabled
    local envelopeBase = self.inputChannelCount + 1 + (if blower then Blower.CONTROLS else 0)
    for k = 1, #envelopes do
        local channel = envelopes[k]
        local buffer = channel.data
        local last = channel.lastInputSample
        local value = data[envelopeBase + k] or 0
        local distance = self:inputDistance(writeOffset, lastOffset)
        local s = self:inputDistance(buffer:writeIndex(), lastOffset)
        while s <= distance do
            if s >= inputBufferSize then
                s -= inputBufferSize
            end
            local f = s / distance
            buffer:write(last * (1 - f) + value * f)
            s += 1.0
        end
        channel.lastInputSample = value
    end

    -- afterfire channels, after the envelopes
    local bangs = self.bangs
    local bangBase = envelopeBase + #envelopes
    for k = 1, #bangs do
        local channel = bangs[k]
        local buffer = channel.data
        local aa = self.bangFilters[k].antialiasing
        local last = channel.lastInputSample
        local value = data[bangBase + k] or 0
        local distance = self:inputDistance(writeOffset, lastOffset)
        local s = self:inputDistance(buffer:writeIndex(), lastOffset)
        while s <= distance do
            if s >= inputBufferSize then
                s -= inputBufferSize
            end
            local f = s / distance
            buffer:write(aa:fast_f(last * (1 - f) + value * f))
            s += 1.0
        end
        channel.lastInputSample = value
    end

    self.lastInputSampleOffset = writeOffset
end

function Synthesizer.endInputBlock(self: Synthesizer)
    for i = 1, self.inputChannelCount do
        self.inputChannels[i].data:removeBeginning(self.inputSamplesRead)
    end
    if self.aux then
        self.aux.data:removeBeginning(self.inputSamplesRead)
    end
    if self.blowerActive then
        for _, channel in self.controls do
            channel.data:removeBeginning(self.inputSamplesRead)
        end
    end
    for _, channel in self.envelopes do
        channel.data:removeBeginning(self.inputSamplesRead)
    end
    for _, channel in self.bangs do
        channel.data:removeBeginning(self.inputSamplesRead)
    end

    if self.inputChannelCount ~= 0 then
        self.latency = self.inputChannels[1].data:size()
    end

    self.inputSamplesRead = 0
    self.processed = false
end

-- One pass of the audio rendering thread (Synthesizer::renderAudio()).
-- maxBuffered is the 2000-sample output high-water mark from engine-sim.
function Synthesizer.renderAudio(self: Synthesizer, maxBuffered: number?): number
    if self.inputChannelCount == 0 or self.processed then
        return 0
    end

    local limit = maxBuffered or 2000
    local inputAvailable = self.inputChannels[1].data:size()
    if not (inputAvailable > 0 and self.audioBuffer:size() < limit) then
        return 0
    end

    local n = math.min(math.max(0, limit - self.audioBuffer:size()), inputAvailable)

    for i = 1, self.inputChannelCount do
        local channel = self.inputChannels[i]
        channel.data:readInto(n, channel.transferBuffer)
    end
    local aux = self.aux
    if aux then
        -- the aux ring is written in lockstep, but guard against a short read
        local avail = math.min(n, aux.data:size())
        aux.data:readInto(avail, aux.transferBuffer)
        for i = avail + 1, n do
            aux.transferBuffer[i] = 0
        end
    end
    for _, channel in if self.blowerActive then self.controls else {} do
        local avail = math.min(n, channel.data:size())
        channel.data:readInto(avail, channel.transferBuffer)
        for i = avail + 1, n do
            channel.transferBuffer[i] = 0
        end
    end
    for _, channel in self.envelopes do
        local avail = math.min(n, channel.data:size())
        channel.data:readInto(avail, channel.transferBuffer)
        for i = avail + 1, n do
            channel.transferBuffer[i] = 0
        end
    end
    -- The afterfire path runs only while there is a bang in it and until it
    -- has rung out: once it has seen more silence than its impulse response
    -- and FFT blocks hold, its filters hold only zeros and skipping it is the
    -- same as running it on silence.
    for _, channel in self.bangs do
        local avail = math.min(n, channel.data:size())
        channel.data:readInto(avail, channel.transferBuffer)
        local tb = channel.transferBuffer
        for i = avail + 1, n do
            tb[i] = 0
        end
        for i = 1, n do
            if tb[i] ~= 0 then
                self.bangHold = BANG_RING_SAMPLES + n
                break
            end
        end
    end

    self.inputSamplesRead = n
    self.processed = true

    -- retune the noise filters only when the cutoff changes (math.tan/cos/exp
    -- per channel otherwise)
    local ap = self.audioParameters
    local cutoff = ap.airNoiseFrequencyCutoff
    local retune = cutoff ~= self.noiseCutoff
    self.noiseCutoff = cutoff
    for i = 1, self.inputChannelCount do
        local f = self.filters[i]
        if retune then
            f.airNoiseLowPass:setCutoffFrequency(cutoff, self.audioSampleRate)
            f.flowNoise:setBand(FLOW_NOISE_LOW, math.max(cutoff, 2 * FLOW_NOISE_LOW), self.audioSampleRate)
        end
        f.jitterFilter:setJitterScale(ap.inputSampleNoise)
    end

    local out = self.audioBuffer
    local auxOut = self.auxAudioBuffer
    local bangOut = self.bangAudioBuffer
    for i = 1, n do
        out:write(self:renderSample(i))
        auxOut:write(self.lastIntake)
        bangOut:write(self.lastBang)
    end
    if self.bangHold > 0 then
        self.bangHold = math.max(0, self.bangHold - n)
    end

    return n
end

-- Clamped to the int16 range but not rounded to it (engine-sim rounds, its
-- device is 16 bit). The output here goes to a float stream, and rounding
-- erased the intake stream whenever the leveler gain was low.
local function toInt16(v: number): number
    local r = v
    if r ~= r then
        return 0
    elseif r > INT16_MAX then
        return INT16_MAX
    elseif r < INT16_MIN then
        return INT16_MIN
    end
    return r
end

-- Synthesizer::renderAudio(int inputSample). Returns the exhaust sample; the
-- intake sample of the same frame is left in self.lastIntake and the
-- afterfire sample in self.lastBang.
function Synthesizer.renderSample(self: Synthesizer, inputSample: number): number
    local ap = self.audioParameters
    local airNoise = ap.airNoise
    local dF_F_mix = ap.dF_F_mix
    local convAmount = ap.convolution
    local rng = self.rng
    local filters = self.filters

    -- engine-sim bug kept on purpose: `m_filters->airNoiseLowPass` always
    -- refers to channel 0's filter, so every channel advances the same noise
    -- filter once per sample.
    local sharedAirNoise = filters[1].airNoiseLowPass

    local groups = self.convGroups
    local groupOf = self.convGroupOf
    local envelopes = self.envelopes
    local radiation = #envelopes > 0

    for g = 1, #groups do
        groups[g].input = 0
    end
    local lastNoise = 1

    for i = 1, self.inputChannelCount do
        local f_i = filters[i]

        local jitteredSample = f_i.jitterFilter:fast_f(self.inputChannels[i].transferBuffer[inputSample])

        local f_in = jitteredSample
        local f_dc = f_i.inputDcFilter:fast_f(f_in)
        local f = f_in - f_dc
        local f_p = f_i.derivative:f(f_in)

        local noise = 2.0 * rng:NextNumber() - 1.0
        local v_in
        if radiation then
            local envelope = envelopes[i].transferBuffer[inputSample]
            v_in = f_p * dF_F_mix + f_i.flowNoise:fast_f(noise) * envelope * airNoise * (1 - dF_F_mix)
        else
            local r = sharedAirNoise:fast_f(noise)
            local r_mixed = airNoise * r + (1 - airNoise)
            lastNoise = r_mixed
            v_in = f_p * dF_F_mix + f * r_mixed * (1 - dF_F_mix)
        end
        if v_in ~= 0 and abs(v_in) < FLT_MIN then
            v_in = 0
        end

        local group = groups[groupOf[i]]
        group.input += v_in
    end

    -- signal = sum_i conv * IR_i(v_in_i) + (1 - conv) * v_in_i
    local signal = 0
    for g = 1, #groups do
        local group = groups[g]
        local wet, dry = group.conv:f(group.input)
        signal += convAmount * wet + (1 - convAmount) * dry
    end

    local intake = 0
    local aux = self.aux
    if aux then
        local x = aux.transferBuffer[inputSample]
        intake = self.auxOutAntialiasing:fast_f((x - self.auxDc:fast_f(x)) * self.auxGain)
    end

    signal = self.antialiasing:fast_f(signal)

    -- The leveler tracks the combined signal; both streams take its gain.
    self.levelingFilter.p_target = ap.levelerTarget * self.loudness
    self.levelingFilter:f(signal + intake)
    local gain = self.levelingFilter.attenuation * ap.volume

    -- The blower voice has its own absolute level (not the leveler's gain)
    local blown = 0
    local blower = self.blower
    if blower and self.blowerActive then
        local c = self.controls
        blown = blower:render(
            c[1].transferBuffer[inputSample],
            c[2].transferBuffer[inputSample],
            c[3].transferBuffer[inputSample],
            c[4].transferBuffer[inputSample],
            c[5].transferBuffer[inputSample]
        ) * ap.volume
    end

    self.lastIntake = toInt16(intake * gain + blown)
    local exhaust = toInt16(signal * gain)
    self.lastBang = 0

    -- Afterfire: through the exhaust's impulse response like the pulses, at
    -- the leveler's gain (so it keeps its level against the engine) times its
    -- own volume, but not seen by the leveler, so a bang is not turned down to
    -- the engine's level. It may go past int16 full scale (the output stage
    -- leaves headroom for it).
    if self.bangHold > 0 then
        for g = 1, #groups do
            groups[g].bangInput = 0
        end
        local bangs = self.bangs
        local bangFilters = self.bangFilters
        for i = 1, #bangs do
            local bf = bangFilters[i]
            local x = bangs[i].transferBuffer[inputSample]
            -- radiated the way this exhaust radiates its pulses: the rate of
            -- change of the pressure (and, without the outlet model, the
            -- pressure itself with the same air noise), so its level against
            -- the engine is the one the engine model gives it
            local f_p = bf.derivative:f(x)
            local v = f_p * dF_F_mix
            if not radiation then
                v += (x - bf.dc:fast_f(x)) * lastNoise * (1 - dF_F_mix)
            end
            local group = groups[groupOf[i]]
            group.bangInput += v
        end
        local bang = 0
        for g = 1, #groups do
            local group = groups[g]
            local bc = group.bangConv
            if bc then
                local wet, dry = bc:f(group.bangInput)
                bang += convAmount * wet + (1 - convAmount) * dry
            end
        end
        bang = self.bangAntialiasing:fast_f(bang) * gain * BANG_DRIVE
        if bang ~= bang then
            bang = 0
        end
        -- peak limiter: the loudest bangs land on afterfireGain x full scale
        -- whatever the engine (instant attack, BANG_RELEASE recovery)
        local ceiling = self.afterfireGain * 32768
        local lim = 1 - (1 - self.bangLimit) * BANG_RELEASE
        local raw = abs(bang) * lim
        if raw > ceiling then
            lim = if ceiling > 0 then ceiling / abs(bang) else 0
        end
        self.bangLimit = lim
        bang *= lim
        bang = math.clamp(bang, -BANG_HEADROOM, BANG_HEADROOM)
        local a = abs(bang)
        if a > self.bangPeak then
            self.bangPeak = a
        end
        self.lastBang = bang
    end
    return exhaust
end

function Synthesizer.getLatency(self: Synthesizer): number
    return self.latency / self.audioSampleRate
end

function Synthesizer.setInputSampleRate(self: Synthesizer, sampleRate: number)
    if sampleRate ~= self.inputSampleRate then
        self.inputSampleRate = sampleRate
    end
end

function Synthesizer.getInputSampleRate(self: Synthesizer): number
    return self.inputSampleRate
end

function Synthesizer.getLevelerGain(self: Synthesizer): number
    return self.levelingFilter:getAttenuation()
end

function Synthesizer.getAudioParameters(self: Synthesizer): AudioParameters
    return table.clone(self.audioParameters)
end

function Synthesizer.setAudioParameters(self: Synthesizer, params: AudioParameters)
    self.audioParameters = table.clone(params)
end

return Synthesizer
