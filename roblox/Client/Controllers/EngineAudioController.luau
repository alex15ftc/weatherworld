--!strict
-- Runs engine-sim's synthesizer on the client and plays it through the
-- Roblox audio graph. The synthesizer renders two streams, the exhaust and the
-- intake, so each can play from its own place on the car:
--
--   Exhaust writer --> ExhaustBus --+--> Bench --> AudioDeviceOutput   (2D, no car)
--   Intake writer  --> IntakeBus  --+
--         |    \----> (CarAudio) emitters at the car's exhaust outlets / intake
--         \--------> AudioStreamReader
--
-- The buses are shared through State.Audio; CarAudio wires them to the car's
-- emitters and mutes Bench while the car plays the engine.
--
-- Controls (same keys as engine-sim):
--   Q / W / E / R  hold for 1% / 10% / 20% / 100% throttle
--   Space + wheel  fine throttle (hold Space to keep the current setting)
--   S              starter (hold)          A   ignition on/off
--   Z / X / C / V / B + mouse wheel: volume / convolution / high freq. gain /
--                  low freq. noise / high freq. noise
--   P              next engine preset
--   I              next impulse response (all 58 from engine-sim's library)
--   L              ignition cut (hold): fuel keeps flowing, so it pops and
--                  bangs in the exhaust (F4 -> Fuel Map & Ignition Cut)
--
-- AudioStreamWriter/AudioStreamReader are currently Studio-only on Roblox.

local ContextActionService = game:GetService("ContextActionService")
local RunService = game:GetService("RunService")
local SoundService = game:GetService("SoundService")
local UserInputService = game:GetService("UserInputService")
local ReplicatedFirst = game:GetService("ReplicatedFirst")

local Modules = ReplicatedFirst:WaitForChild("Modules")
local EngineSim = require(Modules:WaitForChild("EngineSim"))
local State = require(Modules:WaitForChild("EngineAudioState"))

local EngineAudioController = {}

---------------------------------------------------------------------------
-- Configuration
---------------------------------------------------------------------------

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local VehicleConfigs = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("VehicleConfigs"))

-- The car's engine is the default; P cycles through the rest.
local DEFAULT_PRESET = VehicleConfigs.ByKey[VehicleConfigs.Default].Drivetrain.EnginePreset
local PRESET_ORDER = {
    "LT4", "CosworthGMA", "GM_LS", "Inline4", "Mazda13B", "TrueDorito", "Porsche935K3", "CammedSBC350",
    "Coyote", "Ford46", "MazdaBP", "Inline6", "HemiHellcat", "VortecL31", "DuramaxL5P",
}

local AUTO_START = true -- crank and start the engine on spawn
local CAPTURE_KEYS = true -- sink engine keys so W/A/S don't also walk

---------------------------------------------------------------------------

type Graph = {
    Folder: Folder,
    Exhaust: AudioStreamWriter,
    Intake: AudioStreamWriter,
    Reader: AudioStreamReader?,
    ExhaustBus: AudioFader,
    IntakeBus: AudioFader,
    Bench: AudioFader,
}

local graph: Graph? = nil
local output: EngineSim.StreamOutput? = nil
local presetIndex = 1
local targetSpeedSetting = 0.0
local speedSetting = 0.0
local readerBuffer = buffer.create(8192 * 4)
local wheelDelta = 0
local autoStartUntil = 0

local function clamp01(x: number): number
    return math.clamp(x, 0, 1)
end

local function message(text: string)
    State.LastMessage = text
end

local function wire(source: Instance, target: Instance, parent: Instance): Wire
    local w = Instance.new("Wire")
    w.SourceInstance = source
    w.TargetInstance = target
    w.Parent = parent
    return w
end

local function newWriter(name: string, parent: Instance): AudioStreamWriter?
    local ok, writer = pcall(Instance.new, "AudioStreamWriter")
    if not ok then
        State.Status = "AudioStreamWriter unavailable (Studio-only API)"
        warn("[EngineSim] Could not create AudioStreamWriter:", writer)
        return nil
    end
    local w = writer :: AudioStreamWriter
    w.Name = name
    pcall(function()
        w.Layout = Enum.AudioChannelLayout.Mono
    end)
    pcall(function()
        w.WindowSize = Enum.AudioWindowSize.Medium
    end)
    w.Parent = parent
    return w
end

local function newFader(name: string, parent: Instance): AudioFader
    local f = Instance.new("AudioFader")
    f.Name = name
    f.Parent = parent
    return f
end

local function buildGraph(): Graph?
    local folder = Instance.new("Folder")
    folder.Name = "EngineSimAudio"

    local exhaust = newWriter("Exhaust", folder)
    local intake = newWriter("Intake", folder)
    if not exhaust or not intake then
        folder:Destroy()
        return nil
    end

    local exhaustBus = newFader("ExhaustBus", folder)
    local intakeBus = newFader("IntakeBus", folder)
    wire(exhaust, exhaustBus, exhaustBus)
    wire(intake, intakeBus, intakeBus)

    -- 2D path, used while no car is playing the engine (CarAudio mutes it)
    local bench = newFader("Bench", folder)
    wire(exhaustBus, bench, bench)
    wire(intakeBus, bench, bench)
    local deviceOut = Instance.new("AudioDeviceOutput")
    deviceOut.Name = "Speakers"
    deviceOut.Parent = folder
    wire(bench, deviceOut, deviceOut)

    local reader: AudioStreamReader? = nil
    local okReader, r = pcall(Instance.new, "AudioStreamReader")
    if okReader then
        local rd = r :: AudioStreamReader
        rd.Name = "Oscilloscope"
        pcall(function()
            rd.Layout = Enum.AudioChannelLayout.Mono
        end)
        rd.Parent = folder
        -- both streams: the reader input mixes its wires
        wire(exhaust, rd, rd)
        wire(intake, rd, rd)
        reader = rd
    end

    folder.Parent = SoundService

    -- A writer can be created yet refuse to work ("AudioStreamWriter is not enabled"):
    -- then there is no audio, and the engine must step on its own (VehicleController's
    -- no-audio path) instead of erroring inside sim:update every frame.
    local usable, why = pcall(function()
        return exhaust:Space()
    end)
    if not usable then
        State.Status = "AudioStreamWriter not enabled; engine runs without sound"
        warn("[EngineSim] AudioStreamWriter unusable, running without engine audio:", why)
        folder:Destroy()
        return nil
    end

    State.Audio = { Exhaust = exhaustBus, Intake = intakeBus, Bench = bench }

    return {
        Folder = folder,
        Exhaust = exhaust,
        Intake = intake,
        Reader = reader,
        ExhaustBus = exhaustBus,
        IntakeBus = intakeBus,
        Bench = bench,
    }
end

-- keepRunning: carry the crank speed and ignition over (a part swap, not a new engine)
local function loadPreset(name: string, keepRunning: boolean?)
    local preset = EngineSim.Presets[name]
    assert(preset, `Unknown preset {name}`)
    if State.EngineTransform then
        local ok, result = pcall(State.EngineTransform, name, preset)
        if ok then
            preset = result
        else
            warn(`[EngineSim] engine transform failed for {name}: {result}`)
        end
    end
    if State.PresetTransform then
        local ok, result = pcall(State.PresetTransform, name, preset)
        if ok then
            preset = result
        else
            warn(`[EngineSim] preset transform failed for {name}: {result}`)
        end
    end

    local old = State.Simulator
    local sim = EngineSim.EngineAudioSimulator.new(preset)
    if keepRunning and old then
        sim.engine.omega = old.engine.omega
        sim.engine.ignition = old.engine.ignition
        sim.engine.throttle = old.engine.throttle
        -- a vehicle hooks its drivetrain onto the new crank itself (VehicleController)
    end
    State.Simulator = sim
    State.PresetName = preset.Name
    State.PresetKey = name
    if keepRunning then
        if graph then
            output = EngineSim.StreamOutput.new({ graph.Exhaust, graph.Intake })
            sim.output = output
        end
        State.ImpulseResponse = preset.ExhaustSystems[1].ImpulseResponse
        return
    end
    speedSetting = 0
    targetSpeedSetting = 0

    if graph then
        output = EngineSim.StreamOutput.new({ graph.Exhaust, graph.Intake })
        -- the step count holds the whole queue to the speaker (startFrame)
        sim.output = output
    end

    if AUTO_START and State.BenchMode then
        sim.engine.ignition = true
        autoStartUntil = os.clock() + 1.5
    end

    -- The preset's own impulse response (engine-sim script value)
    State.ImpulseResponse = preset.ExhaustSystems[1].ImpulseResponse
    message(`Loaded {preset.Name}`)
end

-- Swap every exhaust system to the next impulse response in the library,
-- through the same Synthesizer::initializeImpulseResponse path engine-sim uses.
local function setImpulseResponse(name: string)
    local sim = State.Simulator
    if not sim then
        return
    end

    local samples, volume = EngineSim.ImpulseResponses.Load(name)
    for i = 1, #sim.preset.ExhaustSystems do
        sim.synthesizer:initializeImpulseResponse(samples, #samples, volume, i)
    end

    State.ImpulseResponse = name
    message(`Impulse response: {name}`)
end

local function nextImpulseResponse()
    local names = EngineSim.ImpulseResponses.List()
    local index = table.find(names, State.ImpulseResponse) or 0
    setImpulseResponse(names[index % #names + 1])
end

local ENGINE_KEYS = {
    Enum.KeyCode.Q, Enum.KeyCode.W, Enum.KeyCode.E, Enum.KeyCode.R,
    Enum.KeyCode.S, Enum.KeyCode.A,
    Enum.KeyCode.Space,
}

-- (WeatherWorld: no keys switch the engine preset or impulse response; the F4 menu does)
local PRESET_KEYS: { Enum.KeyCode } = {}
local IR_KEYS: { Enum.KeyCode } = {}

local function onAction(_name: string, inputState: Enum.UserInputState, input: InputObject): Enum.ContextActionResult
    if inputState ~= Enum.UserInputState.Begin then
        return if State.BenchMode then Enum.ContextActionResult.Sink else Enum.ContextActionResult.Pass
    end

    local sim = State.Simulator
    if not sim or State.InputCaptured then
        return Enum.ContextActionResult.Pass
    end

    -- Vehicle mode: only preset / impulse-response switching stays here, and
    -- every other key goes through to driving and walking.
    local isPreset = table.find(PRESET_KEYS, input.KeyCode) ~= nil
    local isIR = table.find(IR_KEYS, input.KeyCode) ~= nil
    if not State.BenchMode and not isPreset and not isIR then
        return Enum.ContextActionResult.Pass
    end

    if input.KeyCode == Enum.KeyCode.A then
        sim.engine.ignition = not sim.engine.ignition
        message(if sim.engine.ignition then "Ignition enabled" else "Ignition disabled")
    elseif isPreset then
        presetIndex = presetIndex % #PRESET_ORDER + 1
        loadPreset(PRESET_ORDER[presetIndex])
    elseif isIR then
        nextImpulseResponse()
    end

    return Enum.ContextActionResult.Sink
end

local function processInput(dt: number)
    local sim = State.Simulator
    if not sim then
        return
    end

    local focused = UserInputService:GetFocusedTextBox() ~= nil
    local function keyDown(k: Enum.KeyCode): boolean
        return not focused and UserInputService:IsKeyDown(k)
    end

    local delta = wheelDelta
    wheelDelta = 0

    -- Mixer (EngineSimApplication::processEngineInput, Z..B + mouse wheel)
    local fine = keyDown(Enum.KeyCode.Space)
    local ap = sim.synthesizer:getAudioParameters()
    local changed: string? = nil
    -- engine-sim scales wheel delta (120 per notch) by dt; ~2 notches/frame-ish
    local step = delta * 120 * dt
    if keyDown(Enum.KeyCode.Z) then
        ap.volume = clamp01(ap.volume + step * (if fine then 0.001 else 0.01))
        changed = string.format("[Z] - Set volume to %.4f", ap.volume)
    elseif keyDown(Enum.KeyCode.X) then
        ap.convolution = clamp01(ap.convolution + step * (if fine then 0.001 else 0.01))
        changed = string.format("[X] - Set convolution level to %.4f", ap.convolution)
    elseif keyDown(Enum.KeyCode.C) then
        ap.dF_F_mix = clamp01(ap.dF_F_mix + step * (if fine then 0.00001 else 0.001))
        changed = string.format("[C] - Set high freq. gain to %.5f", ap.dF_F_mix)
    elseif keyDown(Enum.KeyCode.V) then
        ap.airNoise = clamp01(ap.airNoise + step * (if fine then 0.001 else 0.01))
        changed = string.format("[V] - Set low freq. noise to %.4f", ap.airNoise)
    elseif keyDown(Enum.KeyCode.B) then
        ap.inputSampleNoise = clamp01(ap.inputSampleNoise + step * (if fine then 0.001 else 0.01))
        changed = string.format("[B] - Set high freq. noise to %.4f", ap.inputSampleNoise)
    end
    if changed and delta ~= 0 then
        sim.synthesizer:setAudioParameters(ap)
        message(changed)
    end

    -- Throttle (speed control)
    local prev = targetSpeedSetting
    targetSpeedSetting = if fine then targetSpeedSetting else 0.0
    if keyDown(Enum.KeyCode.Q) then
        targetSpeedSetting = 0.01
    elseif keyDown(Enum.KeyCode.W) then
        targetSpeedSetting = 0.1
    elseif keyDown(Enum.KeyCode.E) then
        targetSpeedSetting = 0.2
    elseif keyDown(Enum.KeyCode.R) then
        targetSpeedSetting = 1.0
    elseif fine and not changed then
        targetSpeedSetting = clamp01(targetSpeedSetting + delta * 120 * 0.0001)
    elseif State.ThrottleOverride then
        targetSpeedSetting = clamp01(State.ThrottleOverride)
    end
    if prev ~= targetSpeedSetting then
        message(string.format("Speed control set to %.4f", targetSpeedSetting))
    end

    speedSetting = targetSpeedSetting * 0.5 + 0.5 * speedSetting
    sim.engine.throttle = speedSetting
    State.SpeedSetting = speedSetting

    -- Starter
    local starter = keyDown(Enum.KeyCode.S) or os.clock() < autoStartUntil or State.StarterHeld
    if starter ~= sim.engine.starter then
        sim.engine.starter = starter
        message(if starter then "Starter motor enabled" else "Starter motor disabled")
    end

    -- Held ignition cut
    if keyDown(Enum.KeyCode.L) then
        sim.engine:cutSpark(0.05)
    end
end

local function drainReader()
    local g = graph
    if not g or not g.Reader then
        return
    end
    local reader = g.Reader :: AudioStreamReader

    local ok, frames = pcall(reader.Read, reader, { readerBuffer })
    if not ok or type(frames) ~= "number" or frames <= 0 then
        return
    end

    local scope, size = State.Scope, State.ScopeSize
    local head = State.ScopeHead
    for i = 0, frames - 1 do
        head += 1
        if head > size then
            head = 1
        end
        scope[head] = buffer.readf32(readerBuffer, i * 4)
    end
    State.ScopeHead = head
    State.ReaderFrames += frames
end

function EngineAudioController.Init()
    graph = buildGraph()
    -- the vehicle you get into switches to its own engine
    State.LoadPreset = function(name: string)
        presetIndex = table.find(PRESET_ORDER, name) or presetIndex
        loadPreset(name)
    end
    State.SetImpulseResponse = setImpulseResponse
    State.ReloadPreset = function()
        if State.PresetKey ~= "" then
            loadPreset(State.PresetKey, true)
        end
    end
    presetIndex = table.find(PRESET_ORDER, DEFAULT_PRESET) or 1
    loadPreset(PRESET_ORDER[presetIndex])
end

function EngineAudioController.Start()
    if CAPTURE_KEYS then
        ContextActionService:BindActionAtPriority(
            "EngineSimKeys",
            onAction,
            false,
            Enum.ContextActionPriority.High.Value + 100,
            table.unpack(ENGINE_KEYS)
        )
    else
        UserInputService.InputBegan:Connect(function(input, processed)
            if not processed and table.find(ENGINE_KEYS, input.KeyCode) then
                onAction("EngineSimKeys", Enum.UserInputState.Begin, input)
            end
        end)
    end

    UserInputService.InputChanged:Connect(function(input)
        if input.UserInputType == Enum.UserInputType.MouseWheel then
            wheelDelta += input.Position.Z
        end
    end)

    State.Running = graph ~= nil
    if graph then
        State.Status = "Running"
    end

    RunService.Heartbeat:Connect(function(dt)
        local sim = State.Simulator
        if not sim then
            return
        end

        if State.BenchMode then
            processInput(dt)
        end

        -- Simulator::startFrame .. endFrame, then one renderAudio() pass.
        -- A vehicle steps the simulator itself before physics (ExternalDriver).
        if not State.ExternalDriver then
            sim:update(dt)
        end

        -- EngineSimApplication::updateAudio: hand rendered audio to the device
        local out = output
        local g = graph
        if out and g then
            g.ExhaustBus.Volume = State.Volume * State.ExhaustGain
            g.IntakeBus.Volume = State.Volume * State.IntakeVolume
            State.WriterFrames += out:pump(sim.synthesizer)
            drainReader()
        else
            -- No audio device: drop rendered samples so the simulator keeps running
            local synth = sim.synthesizer
            while synth:popAudioSample() do
            end
        end

        State.Changed:Fire()
    end)
end

return EngineAudioController
