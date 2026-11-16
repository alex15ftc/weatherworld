--!strict
-- Reconstruct other drivers' engines locally: stream writers themselves do not
-- replicate. The server relays only the owning driver's engine controls (VehicleNet.Audio ->
-- VehicleNet.AudioRelay).
local Players = game:GetService("Players")
local ReplicatedFirst = game:GetService("ReplicatedFirst")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local SoundService = game:GetService("SoundService")
local Workspace = game:GetService("Workspace")

local modules = ReplicatedFirst:WaitForChild("Modules")
local State = require(modules:WaitForChild("EngineAudioState"))
local EngineSim = require(modules:WaitForChild("EngineSim"))
local CarAudio = require(modules:WaitForChild("Vehicle"):WaitForChild("CarAudio"))
local VehicleConfigs = require(ReplicatedStorage.Shared.VehicleConfigs)
local VehicleNet = require(ReplicatedStorage.Shared.Net.VehicleNet)
local player = Players.LocalPlayer
local voices: { [Model]: any } = {}
local Controller = {}

local function destroy(model: Model)
    local voice = voices[model]
    if voice then
        voice.carAudio:destroy()
        voice.folder:Destroy()
        voices[model] = nil
        State.RemoteSimulators[model] = nil
    end
end

local function create(model: Model, presetName: string): any?
    local preset = nil
    for _, candidate in EngineSim.Presets do
        if candidate.Name == presetName then preset = candidate; break end
    end
    if not preset then return nil end
    local gain = 1
    local ok, exhaust = pcall(Instance.new, "AudioStreamWriter")
    if not ok then return nil end
    local okIntake, intake = pcall(Instance.new, "AudioStreamWriter")
    if not okIntake then exhaust:Destroy(); return nil end
    local folder = Instance.new("Folder")
    folder.Name = "RemoteVehicleAudio"
    exhaust.Parent = folder
    intake.Parent = folder
    local exhaustBus = Instance.new("AudioFader")
    local intakeBus = Instance.new("AudioFader")
    local bench = Instance.new("AudioFader") -- CarAudio requires a bench fader; it has no output here.
    exhaustBus.Parent, intakeBus.Parent, bench.Parent = folder, folder, folder
    for _, pair in { { exhaust, exhaustBus }, { intake, intakeBus } } do
        local wire = Instance.new("Wire")
        wire.SourceInstance, wire.TargetInstance, wire.Parent = pair[1], pair[2], pair[2]
    end
    folder.Parent = SoundService
    local sim = EngineSim.EngineAudioSimulator.new(preset)
    local voice = {
        folder = folder, sim = sim, preset = presetName, impulse = "", gain = gain,
        output = EngineSim.StreamOutput.new({ exhaust, intake }),
        carAudio = CarAudio.new(model, nil, { Exhaust = exhaustBus, Intake = intakeBus, Bench = bench }, VehicleConfigs.forModel(model).MetersPerStud),
        exhaustBus = exhaustBus, intakeBus = intakeBus,
        rpm = 0, throttle = 0, ignition = false, starter = false, received = os.clock(),
    }
    -- Lock the crank to the replicated speed every simulation step. The rest of
    -- the engine still computes its airflow and combustion for the synthesizer.
    sim.stepHook = function(_dt: number)
        sim.engine.omega = voice.rpm * (2 * math.pi / 60)
    end
    sim.output = voice.output -- hold the queue to the speaker, not 0.1 s of input
    voices[model] = voice
    State.RemoteSimulators[model] = sim
    return voice
end

function Controller.Start()
    local audio = VehicleNet.Audio:Client()
    VehicleNet.AudioRelay:Client():On(function(model, preset, rpm, throttle, ignition, starter, impulse)
        if typeof(model) ~= "Instance" or not model:IsA("Model") or not model:IsDescendantOf(Workspace)
            or model:GetAttribute("OwnerUserId") == player.UserId then return end
        local voice = voices[model]
        if voice and voice.preset ~= preset then
            destroy(model); voice = nil
        end
        if not voice then voice = create(model, preset) end
        if not voice then return end
        voice.rpm, voice.throttle, voice.ignition, voice.starter = rpm, throttle, ignition, starter
        voice.received = os.clock()
        if voice.impulse ~= impulse then
            local ok, samples, volume = pcall(EngineSim.ImpulseResponses.Load, impulse)
            if ok then
                for i = 1, #voice.sim.preset.ExhaustSystems do
                    voice.sim.synthesizer:initializeImpulseResponse(samples, #samples, volume, i)
                end
            end
            voice.impulse = impulse
        end
    end)
    local elapsed = 0
    RunService.Heartbeat:Connect(function(dt)
        elapsed += dt
        if elapsed >= 0.1 then
            elapsed = 0
            local sim = State.Simulator
            local model: Model? = nil
            local vehicles = Workspace:FindFirstChild("Vehicles")
            if vehicles then
                for _, candidate in vehicles:GetChildren() do
                    if candidate:IsA("Model") and candidate:GetAttribute("OwnerUserId") == player.UserId then
                        model = candidate
                        break
                    end
                end
            end
            if model and sim and model:GetAttribute("OwnerUserId") == player.UserId then
                audio:Fire(model, State.PresetName, math.clamp(sim.engine:getRpm(), 0, 20000),
                    math.clamp(sim.engine.throttle, 0, 1), sim.engine.ignition, sim.engine.starter, State.ImpulseResponse)
            end
        end
        for model, voice in voices do
            if not model:IsDescendantOf(Workspace) or model:GetAttribute("OwnerUserId") == player.UserId
                or model:GetAttribute("OwnerUserId") == nil or os.clock() - voice.received > 2 then
                destroy(model)
            else
                local engine = voice.sim.engine
                engine.throttle, engine.ignition, engine.starter = voice.throttle, voice.ignition, voice.starter
                engine.omega = voice.rpm * (2 * math.pi / 60)
                voice.exhaustBus.Volume = State.Volume * voice.gain
                voice.intakeBus.Volume = State.Volume * State.IntakeVolume
                voice.sim:update(dt)
                voice.output:pump(voice.sim.synthesizer)
            end
        end
    end)
end

return Controller
