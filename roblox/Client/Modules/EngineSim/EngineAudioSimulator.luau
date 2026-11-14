--!strict
--!native
-- Port of the audio side of engine-sim's Simulator / PistonEngineSimulator:
--   Simulator::startFrame        (step count + synthesizer latency control)
--   Simulator::simulateStep      (filtered engine speed)
--   PistonEngineSimulator::writeToSynthesizer
--   PistonEngineSimulator::placeAndInitialize (per-cylinder exhaust delay lines)
--   Simulator::initializeSynthesizer / endFrame
--   EngineSimApplication::loadEngine (audio parameters + impulse responses)
--
-- The audio is simulated faster or slower than real time to keep the physics
-- clock locked to the audio device clock. engine-sim holds the synthesizer's
-- input latency at 0.1 s, which it needs because its audio runs on its own
-- thread; that is still the rule without an output attached. With one
-- (self.output, a StreamOutput) the whole queue between the simulation and
-- the speaker is held instead, at a few tens of ms: here simulation, render
-- and the writer all run in the same frame. Under the old rule the 10 %
-- overspeed it applied below 0.1 s of input filled the writer, then the
-- render high-water mark, then the input ring: ~220 ms end to end.

local Synthesizer = require(script.Parent.Synthesizer)
local Filters = require(script.Parent.Filters)
local EngineModel = require(script.Parent.EngineModel)
local ImpulseResponses = require(script.Parent.ImpulseResponses)
local Presets = require(script.Parent.Presets)
local Blower = require(script.Parent.Blower)

local ATM = 101325.0
local SPEED_OF_SOUND = 343.0
-- in the exhaust runner (gamma 1.4, 1000 K, as EngineModel)
local EXHAUST_SPEED_OF_SOUND = math.sqrt(1.4 * 287 * 1000)
local EXHAUST_RT = 287 * 1000
-- Scales the intake-side sources (Pa) into the synthesizer's signal range,
-- relative to the exhaust channels: the supercharger's discharge pulses and
-- the induction pulses at the throttle body.
local WHINE_GAIN = 0.35
local INDUCTION_GAIN = 1.4e6
-- Overall level of the intake stream (whine + induction). The intake emitter
-- sits much closer to the camera than the exhaust outlets, so it is kept well
-- under the exhaust: induction ~25 dB and whine ~32 dB below it at full throttle.
local INTAKE_LEVEL = 0.35

-- Loudness. The raw exhaust signal of the lumped engine model follows rpm far
-- more than load (closed throttle at 3,500 rpm is ~60 dB over idle and only
-- ~13 dB under full throttle), so a leveler alone either plays everything
-- above idle at full scale or nothing at idle. Instead the leveler normalises
-- the signal completely (the simulation supplies the timbre) and its target
-- level is set from the engine's state, in dB below full scale:
--   LOUD_BASE at zero rpm and closed throttle, + LOUD_RPM at the redline,
--   + LOUD_LOAD from closed throttle (30 kPa manifold pressure) to atmospheric.
-- A V8 idles ~23 dB under full throttle at the redline and drops ~14 dB when
-- the throttle shuts.
local LOUD_BASE = -26
local LOUD_RPM = 12
local LOUD_LOAD = 14
local LOAD_MAP_MIN = 30000
local LOUD_FADE_RPM = 300 -- fades to silence below this as the engine stops
local LOUDNESS_PRESSURE_TIME = 0.08 -- s
local LEVELER_MAX_GAIN = 3000

-- Pipe model (preset.ExhaustPipe). Each header primary stays a plain delay;
-- each exhaust system behind its collector is a waveguide (Filters.Waveguide)
-- whose open end reflects low frequencies and lets high ones out. What goes to
-- the synthesizer is the volume velocity leaving the tailpipe, and beside it
-- a flow-noise envelope from the gas flowing out, which the synthesizer turns
-- into flow noise (Synthesizer, "outlet radiation").
--
-- An unflanged pipe end's reflection is down to about 0.6 where the
-- wavelength equals the circumference (ka = 1); a one-pole low-pass has that
-- magnitude at 1.33 x its corner.
local END_REFLECTION_KA = 0.75
local DEFAULT_END_REFLECTION = 0.9
local DEFAULT_HEAD_REFLECTION = 0.5
local DEFAULT_OUTLET_RADIUS = 1.6 -- x the primary's radius
-- Flow noise. Turbulence radiates a pressure that goes with rho U^2 M^2 (the
-- fourth power of the flow speed), so the envelope is the outflow's dynamic
-- pressure q times its Mach number squared, with the speed held to the speed
-- of sound (see writeToSynthesizer). With q alone the hiss came within 6 dB
-- of the exhaust note at a light-load idle, where the pulses are weak but gas
-- still flows. At 4 the noise is 24 to 41 dB under the pulses at full
-- throttle, depending on the engine (the old air noise: 28 to 46 dB), and
-- inaudible at idle.
local FLOW_NOISE_GAIN = 4

-- Longest frame simulated in one go. engine-sim clamps its frame time the same
-- way (to 1/30 s); without it a hitch (a loading stall, the window dragged)
-- asks for seconds of 10 kHz steps in one frame, which stalls the next frame
-- too and overruns the one-second input ring.
local MAX_FRAME_DT = 0.1
-- engine-sim's output high-water mark: one render pass stops at this many
-- buffered samples. Its audio thread gets a pass per 1/30 s frame at worst;
-- here a pass happens once per frame at any frame rate, so the mark grows
-- with the frame time (see update).
local RENDER_HIGH_WATER = 2000

-- Output latency control (with self.output). The queue is measured at the
-- start of the frame, its low point: everything this frame renders lands on
-- top before the writer next drains. It is held at OUTPUT_LATENCY_BASE plus
-- half a frame (frame times jitter more at low frame rates), plus whatever
-- margin the device has proven it needs: each time it runs dry after the
-- queue first settled, the target grows by OUTPUT_MARGIN_STEP.
local OUTPUT_LATENCY_BASE = 0.02
local OUTPUT_LATENCY_FRAMES = 0.5
local OUTPUT_MARGIN_STEP = 0.005
local OUTPUT_MARGIN_MAX = 0.1
-- Proportional rate control: speed error per second of queue error, and the
-- most the simulation runs off real time (engine-sim's own +/-10 %).
local OUTPUT_GAIN = 4
local OUTPUT_MAX_CORRECTION = 0.1
-- frames longer than this are hitches: the device running dry through one is
-- expected and says nothing about the margin it needs
local OUTPUT_HITCH_DT = 0.05

local EngineAudioSimulator = {}
EngineAudioSimulator.__index = EngineAudioSimulator

export type Options = {
    convolutionMode: string?,
    convolutionBlockSize: number?,
    targetLatency: number?,
    -- base output latency (s) with an output attached; default OUTPUT_LATENCY_BASE
    outputLatency: number?,
}

-- What the simulator needs of its output stage (a StreamOutput)
export type Output = {
    getQueuedSeconds: (any) -> number,
    deviceUnderruns: number,
}

export type EngineAudioSimulator = typeof(setmetatable({} :: {
    engine: EngineModel.EngineModel,
    preset: Presets.EnginePreset,
    synthesizer: Synthesizer.Synthesizer,
    -- centrifugal supercharger sound layer; blower.def is live-editable
    blower: Blower.Blower,
    delayFilters: { Filters.Delay },
    exhaustLengths: { number },
    -- pipe model, one per exhaust system (empty without preset.ExhaustPipe)
    waveguides: { Filters.Waveguide },
    noiseDelays: { Filters.Delay },
    noiseStaging: { number },
    flowNoise: number,
    -- exhaust afterfire (FuelMap): the bangs' own delay lines and pipes, so
    -- they travel the car's exhaust like the pulses but skip the leveler
    bangDelays: { Filters.Delay },
    bangWaveguides: { Filters.Waveguide },
    bangBase: number, -- staging slot before the first bang channel
    stagingBuffer: { number },
    simulationFrequency: number,
    simulationSpeed: number,
    targetSynthesizerLatency: number,
    filteredEngineSpeed: number,
    -- manifold pressure for getLoudness, eased so pulses do not move the level
    loudnessPressure: number,
    steps: number,
    lastStepsSimulated: number,
    -- the stage that plays the rendered audio; when set, the step count holds
    -- the whole queue to it (see startFrame) instead of the input latency
    output: Output?,
    outputLatency: number,
    outputMargin: number,
    outputSettled: boolean,
    outputUnderruns: number,
    -- seconds queued from the simulation to the speaker, as of startFrame
    queuedLatency: number,
    stepCarry: number,
    -- Called after every engine step with the timestep. A vehicle drivetrain
    -- hooks in here so it loads the same crank the synthesizer listens to.
    stepHook: ((number) -> ())?,
}, EngineAudioSimulator))

function EngineAudioSimulator.new(preset: Presets.EnginePreset, options: Options?): EngineAudioSimulator
    local opts: Options = options or {}
    local engine = EngineModel.new(preset)

    local self = setmetatable({
        engine = engine,
        preset = preset,
        synthesizer = Synthesizer.new(),
        -- a copy of the preset's definition, so edits do not change the preset
        blower = Blower.new(if preset.Blower then table.clone(preset.Blower) else nil, 44100),
        delayFilters = {},
        exhaustLengths = {},
        waveguides = {},
        noiseDelays = {},
        noiseStaging = {},
        flowNoise = 0,
        bangDelays = {},
        bangWaveguides = {},
        bangBase = #preset.ExhaustSystems * (if preset.ExhaustPipe then 2 else 1) + 1 + Blower.CONTROLS,
        -- one slot per exhaust system, plus the aux (intake) slot and the
        -- blower's control values, plus with the pipe model one flow-noise
        -- envelope per exhaust system, then one afterfire channel per exhaust
        -- system
        stagingBuffer = table.create(
            #preset.ExhaustSystems * (if preset.ExhaustPipe then 3 else 2) + 1 + Blower.CONTROLS, 0),
        simulationFrequency = preset.SimulationFrequency,
        simulationSpeed = 1.0,
        targetSynthesizerLatency = opts.targetLatency or 0.1,
        filteredEngineSpeed = 0.0,
        loudnessPressure = ATM,
        steps = 0,
        lastStepsSimulated = 0,
        output = nil,
        outputLatency = opts.outputLatency or OUTPUT_LATENCY_BASE,
        outputMargin = 0,
        outputSettled = false,
        outputUnderruns = 0,
        queuedLatency = 0,
        stepCarry = 0,
        stepHook = nil,
    }, EngineAudioSimulator)

    -- placeAndInitialize(): one delay line per cylinder, length = time for
    -- sound to travel the header primary + exhaust system. Note engine-sim
    -- hard-codes 10000 Hz here regardless of the simulation frequency.
    local pipe = preset.ExhaustPipe
    for i, cyl in preset.Cylinders do
        local exhaust = preset.ExhaustSystems[cyl.ExhaustSystem]
        local exhaustLength = cyl.PrimaryLength + exhaust.Length
        self.exhaustLengths[i] = exhaustLength
        self.delayFilters[i] = if pipe
            then Filters.Delay.new(cyl.PrimaryLength / SPEED_OF_SOUND, preset.SimulationFrequency)
            else Filters.Delay.new(exhaustLength / SPEED_OF_SOUND, 10000.0)
        self.bangDelays[i] = if pipe
            then Filters.Delay.new(cyl.PrimaryLength / SPEED_OF_SOUND, preset.SimulationFrequency)
            else Filters.Delay.new(exhaustLength / SPEED_OF_SOUND, 10000.0)
    end

    if pipe then
        local rate = preset.SimulationFrequency
        local radius = pipe.OutletRadius
            or DEFAULT_OUTLET_RADIUS * math.sqrt(preset.RunnerArea / math.pi)
        local cutoff = math.min(END_REFLECTION_KA * SPEED_OF_SOUND / (2 * math.pi * radius), 0.45 * rate)
        for k, exhaust in preset.ExhaustSystems do
            self.waveguides[k] = Filters.Waveguide.new(
                exhaust.Length / SPEED_OF_SOUND,
                rate,
                cutoff,
                pipe.EndReflection or DEFAULT_END_REFLECTION,
                pipe.HeadReflection or DEFAULT_HEAD_REFLECTION
            )
            self.bangWaveguides[k] = Filters.Waveguide.new(
                exhaust.Length / SPEED_OF_SOUND,
                rate,
                cutoff,
                pipe.EndReflection or DEFAULT_END_REFLECTION,
                pipe.HeadReflection or DEFAULT_HEAD_REFLECTION
            )
            -- the noise leaves with the pulse that carries it: the mean
            -- primary, then the pipe
            local primary, count = 0, 0
            for _, cyl in preset.Cylinders do
                if cyl.ExhaustSystem == k then
                    primary += cyl.PrimaryLength
                    count += 1
                end
            end
            self.noiseDelays[k] = Filters.Delay.new(
                (exhaust.Length + primary / math.max(count, 1)) / SPEED_OF_SOUND, rate)
            self.noiseStaging[k] = 0
        end
        self.flowNoise = FLOW_NOISE_GAIN * (pipe.FlowNoise or 1)
    end

    -- initializeSynthesizer()
    local synth = self.synthesizer
    synth:initialize({
        audioBufferSize = 44100,
        audioSampleRate = 44100,
        inputBufferSize = 44100,
        inputChannelCount = #preset.ExhaustSystems,
        inputSampleRate = preset.SimulationFrequency,
        initialAudioParameters = Synthesizer.defaultAudioParameters(),
        convolutionMode = opts.convolutionMode,
        convolutionBlockSize = opts.convolutionBlockSize,
        auxChannel = true,
        auxGain = WHINE_GAIN * INTAKE_LEVEL,
        blower = self.blower,
        outletRadiation = pipe ~= nil,
        afterfire = true,
    })

    -- EngineSimApplication::loadEngine()
    local ap = synth:getAudioParameters()
    ap.inputSampleNoise = preset.Jitter
    ap.airNoise = preset.Noise
    ap.dF_F_mix = preset.HfGain
    ap.levelerMaxGain = LEVELER_MAX_GAIN
    synth.levelingFilter.p_maxLevel = LEVELER_MAX_GAIN
    synth:setAudioParameters(ap)

    for i, exhaust in preset.ExhaustSystems do
        local samples, volume = ImpulseResponses.Load(exhaust.ImpulseResponse)
        synth:initializeImpulseResponse(samples, #samples, volume, i)
    end

    return self
end

function EngineAudioSimulator.getTimestep(self: EngineAudioSimulator): number
    return 1.0 / self.simulationFrequency
end

function EngineAudioSimulator.getSynthesizerInputLatency(self: EngineAudioSimulator): number
    return self.synthesizer:getLatency()
end

-- Seconds of simulated audio not yet played: input not yet rendered, rendered
-- audio not yet pumped, and (with an output) what the writer holds.
function EngineAudioSimulator.getOutputLatency(self: EngineAudioSimulator): number
    local synth = self.synthesizer
    local rate = synth.audioSampleRate
    local input = 0
    if synth.inputChannelCount > 0 then
        input = math.max(synth.inputChannels[1].data:size() - synth.inputSamplesRead, 0)
    end
    local queued = (input + synth.audioBuffer:size()) / rate
    local output = self.output
    if output then
        queued += output:getQueuedSeconds()
    end
    return queued
end

-- startFrame with an output: hold the queue to the speaker at the target.
function EngineAudioSimulator._startFrameOutput(self: EngineAudioSimulator, dt: number, output: Output)
    local queued = self:getOutputLatency()
    self.queuedLatency = queued

    local target = self.outputLatency + OUTPUT_LATENCY_FRAMES * dt + self.outputMargin
    local underruns = output.deviceUnderruns
    if underruns ~= self.outputUnderruns then
        if self.outputSettled and dt <= OUTPUT_HITCH_DT then
            self.outputMargin = math.min(self.outputMargin + OUTPUT_MARGIN_STEP, OUTPUT_MARGIN_MAX)
        end
        self.outputUnderruns = underruns
    end
    if queued >= target then
        self.outputSettled = true
    end

    local correction = math.clamp((target - queued) * OUTPUT_GAIN, -OUTPUT_MAX_CORRECTION, OUTPUT_MAX_CORRECTION)
    -- fractional steps carry over, so the rate is exact at any frame rate
    local exact = dt * self.simulationSpeed * (1 + correction) / self:getTimestep() + self.stepCarry
    local steps = math.max(math.floor(exact), 0)
    self.stepCarry = exact - steps
    self.steps = steps
end

-- Simulator::startFrame
function EngineAudioSimulator.startFrame(self: EngineAudioSimulator, dt: number)
    local synth = self.synthesizer
    synth:setInputSampleRate(self.simulationFrequency * self.simulationSpeed)

    local output = self.output
    if output then
        self:_startFrameOutput(dt, output)
        return
    end

    local timestep = self:getTimestep()
    local steps = math.floor((dt * self.simulationSpeed) / timestep + 0.5)

    local targetLatency = self.targetSynthesizerLatency
    local latency = synth:getLatency()
    if latency < targetLatency then
        steps = math.floor((steps + 1) * 1.1)
    elseif latency > targetLatency then
        -- static_cast<int> truncates toward zero
        local v = (steps - 1) * 0.9
        steps = if v < 0 then math.ceil(v) else math.floor(v)
        if steps < 0 then
            steps = 0
        end
    end

    self.steps = steps
end

-- PistonEngineSimulator::writeToSynthesizer
function EngineAudioSimulator.writeToSynthesizer(self: EngineAudioSimulator)
    local engine = self.engine
    local preset = self.preset
    local staging = self.stagingBuffer

    for i = 1, #staging do
        staging[i] = 0
    end

    local attenuation = math.min(math.abs(self.filteredEngineSpeed), 40.0) / 40.0
    local attenuation_3 = attenuation * attenuation * attenuation

    local waveguides = self.waveguides
    local piped = #waveguides > 0
    local noiseStaging = self.noiseStaging
    for k = 1, #noiseStaging do
        noiseStaging[k] = 0
    end

    local cylinderCount = #preset.Cylinders
    for i = 1, cylinderCount do
        local cyl = preset.Cylinders[i]
        local exhaust = preset.ExhaustSystems[cyl.ExhaustSystem]
        local exhaustLength = self.exhaustLengths[i]
        local idleBlowdown = if preset.CamOptions then engine.cylinders[i].idleBlowdown else 0

        local outflow = engine:getRunnerDynamicPressure(i, 1.0)
        local exhaustFlow = attenuation_3 * 1600 * (
            1.0 * (engine:getRunnerPressure(i) - ATM)
            + 0.1 * outflow
            + 0.1 * engine:getRunnerDynamicPressure(i, -1.0)
            + 2.8 * idleBlowdown
        )

        local delayedExhaustPulse = self.delayFilters[i]:fast_f(exhaustFlow)

        local scale = cyl.SoundAttenuation * (exhaust.AudioVolume / cylinderCount)
            * (1 / (exhaustLength * exhaustLength))
        staging[cyl.ExhaustSystem] += scale * delayedExhaustPulse
        -- afterfire, scaled like the pulses (its level is set in the synthesizer)
        local bang = self.bangDelays[i]:fast_f(attenuation_3 * 1600 * engine:getAfterfirePressure(i))
        staging[self.bangBase + cyl.ExhaustSystem] += scale * bang
        if piped then
            -- Turbulence: q M^2 = 0.5 rho v^4 / c^2, with the gas speed held
            -- to the speed of sound. Real flow chokes there; the lumped
            -- runner's mean-flow estimate does not, and on a short, narrow
            -- runner (the 9A2's) it reached twice that.
            local state = engine.cylinders[i]
            local v = state.runnerVelocity
            if v > 0 then
                local m = math.min(v / EXHAUST_SPEED_OF_SOUND, 1)
                local q = 0.5 * (state.pr / EXHAUST_RT) * (m * EXHAUST_SPEED_OF_SOUND) ^ 2
                noiseStaging[cyl.ExhaustSystem] += scale * attenuation_3 * 1600 * q * m * m
            end
        end
    end

    if piped then
        local envelopeBase = #preset.ExhaustSystems + 1 + Blower.CONTROLS
        local flowNoise = self.flowNoise
        for k = 1, #waveguides do
            staging[k] = waveguides[k]:fast_f(staging[k])
            staging[envelopeBase + k] = flowNoise * self.noiseDelays[k]:fast_f(noiseStaging[k])
            staging[self.bangBase + k] = self.bangWaveguides[k]:fast_f(staging[self.bangBase + k])
        end
    end
    self.synthesizer.afterfireGain = engine.fuelMap.BangVolume

    -- intake-side sources (the intake stream), attenuated with engine speed
    -- like the exhaust
    local induction = engine:getInduction() * INDUCTION_GAIN / WHINE_GAIN * (preset.InductionVolume or 1)
    staging[#preset.ExhaustSystems + 1] = attenuation_3 * (engine:getWhine() + induction)

    -- the synthesizer ignores the blower's slots while it is disabled
    if self.blower.def.Enabled then
        self.blower:step(
            engine:getRpm(),
            preset.Redline,
            engine.throttleFlow,
            engine.throttle,
            self:getTimestep(),
            staging,
            #preset.ExhaustSystems + 1
        )
    end

    self.synthesizer:writeInput(staging)
end

-- Simulator::updateFilteredEngineSpeed (kept verbatim, including the fact
-- that alpha weights the *old* value, so this barely filters at all).
function EngineAudioSimulator.updateFilteredEngineSpeed(self: EngineAudioSimulator, dt: number)
    local alpha = dt / (100 + dt)
    self.filteredEngineSpeed = alpha * self.filteredEngineSpeed + (1 - alpha) * self.engine:getRpm()
end

-- Scale (0..1) on the leveler target for the engine's current speed and load
-- (see LOUD_BASE).
function EngineAudioSimulator.getLoudness(self: EngineAudioSimulator): number
    local engine = self.engine
    local rpm = engine:getRpm()
    local speed = math.clamp(rpm / engine:getRedline(), 0, 1)
    local load = math.clamp((self.loudnessPressure - LOAD_MAP_MIN) / (ATM - LOAD_MAP_MIN), 0, 1)
    local db = LOUD_BASE + LOUD_RPM * speed + LOUD_LOAD * load
    return 10 ^ (math.min(db, 0) / 20) * math.clamp(rpm / LOUD_FADE_RPM, 0, 1)
end

-- One frame: simulate, hand the block to the synthesizer, render.
-- Returns the number of audio samples rendered this frame.
function EngineAudioSimulator.update(self: EngineAudioSimulator, dt: number): number
    dt = math.clamp(dt, 0, MAX_FRAME_DT)
    self:startFrame(dt)

    local timestep = self:getTimestep()
    local engine = self.engine
    local hook = self.stepHook
    for _ = 1, self.steps do
        engine:step(timestep)
        if hook then
            hook(timestep)
        end
        self:updateFilteredEngineSpeed(timestep)
        self:writeToSynthesizer()
    end
    self.lastStepsSimulated = self.steps
    -- sampled once a frame, the raw pressure carries the intake pulses
    -- (aliased to the frame rate) into the level
    self.loudnessPressure += (engine:getManifoldPressure() - self.loudnessPressure)
        * math.min(1, dt / LOUDNESS_PRESSURE_TIME)
    self.synthesizer.loudness = self:getLoudness()

    -- Simulator::endFrame -> Synthesizer::endInputBlock, which wakes the
    -- audio thread for one renderAudio() pass.
    --
    -- The pass must be able to render a whole frame of audio. 2000 samples
    -- cover 45 ms; below ~22 fps that starved the device every frame while
    -- unrendered input piled up (0.86 s of latency at 15 fps). 1.5 frames
    -- leaves room to catch up after a slow frame.
    local synth = self.synthesizer
    synth:endInputBlock()
    return synth:renderAudio(math.max(RENDER_HIGH_WATER, math.ceil(dt * synth.audioSampleRate * 1.5)))
end

return EngineAudioSimulator
