--!strict
-- Shared client state for the engine audio, vehicle and character controllers.

local EngineSim = require(script.Parent.EngineSim)

export type State = {
    Simulator: EngineSim.EngineAudioSimulator?,
    PresetName: string,
    ImpulseResponse: string,
    Running: boolean,
    Status: string,
    LastMessage: string,
    SpeedSetting: number,
    Volume: number,
    TireVolume: number,
    IntakeVolume: number,
    -- engine audio buses (set by EngineAudioController once the graph exists);
    -- CarAudio wires them to the car's exhaust / intake emitters
    Audio: {
        Exhaust: AudioFader,
        Intake: AudioFader,
        Bench: AudioFader,
    }?,
    -- Output waveform captured by the AudioStreamReader (ring buffer, floats)
    Scope: { number },
    ScopeSize: number,
    ScopeHead: number,
    ReaderFrames: number,
    WriterFrames: number,
    -- false once a vehicle owns the engine: the bench keys (Q/W/E/R, S, A) and
    -- auto-start are off, and the vehicle steps the simulator itself.
    BenchMode: boolean,
    ExternalDriver: boolean,
    -- set by EngineAudioController: swaps the simulator to a named preset
    LoadPreset: ((name: string) -> ())?,
    -- set by EngineAudioController: swaps every exhaust to a named impulse response
    SetImpulseResponse: ((name: string) -> ())?,
    -- debug menu (bench mode): fixed throttle instead of Q/W/E/R, and a held starter
    ThrottleOverride: number?,
    StarterHeld: boolean,
    Presets: { [string]: EngineSim.EnginePreset },
    -- tire compound fitted to the driven car (Shared/TireCompounds); kept
    -- across cars. SetTireCompound is set by VehicleController.
    TireCompound: string,
    SetTireCompound: ((name: string) -> ())?,
    Changed: BindableEvent,
    -- the driven car's chassis (has .speed, .drivetrain), set by VehicleController; nil on foot
    Chassis: any?,
    -- What the driver's hands and feet are doing, written by VehicleController every frame
    -- while driving, for the seated body (CharacterController): the steering wheel's turn in
    -- radians (+ = anticlockwise as the driver sees it) and the pedals 0..1.
    Driver: {
        WheelAngle: number,
        Throttle: number,
        Brake: number,
        Clutch: number,
    },
    -- the driven car's model and its CarAudio (VehicleController); the replay recorder
    -- tracks the car and taps its tire sounds
    CarModel: Model?,
    CarAudio: any?,
    -- other drivers' engines, rebuilt here (RemoteVehicleAudioController): car -> simulator.
    -- AfterfireController draws their flames.
    RemoteSimulators: { [Model]: EngineSim.EngineAudioSimulator },
    -- Replay editor (ReplayController): CameraOverride stops CharacterController drawing the
    -- camera; InputCaptured stops walking, driving and the engine keys from reading input.
    CameraOverride: boolean,
    InputCaptured: boolean,
    -- Extra windows for the F4 ImGui menu, drawn every frame it is open: name -> draw(ImGui, G).
    ImGuiPanels: { [string]: (ImGui: any, G: any) -> () },
    -- ImGui windows drawn every frame whether or not the F4 menu is open (the exhaust garage).
    ImGuiOverlay: { [string]: (ImGui: any, G: any) -> () },
    -- Exhaust garage (ExhaustGarageController). PresetTransform rewrites a preset as it
    -- loads (preset key, preset) -> preset, e.g. with a custom exhaust; ReloadPreset reloads
    -- the current preset through it without stopping the engine. ExhaustGain scales the
    -- exhaust stream after the synthesizer (a muffler's level; the leveler hides it otherwise).
    PresetTransform: ((key: string, preset: EngineSim.EnginePreset) -> EngineSim.EnginePreset)?,
    -- Machine shop (MachineShopController): rewrites a preset with the engine's machined
    -- parts as it loads, before PresetTransform puts the exhaust on it. ShopOpen is true
    -- while you are in the shop (the engine is on the stand, the car is parked).
    EngineTransform: ((key: string, preset: EngineSim.EnginePreset) -> EngineSim.EnginePreset)?,
    ShopOpen: boolean,
    -- Best timed runs by car key (RunTimerController): ZeroTo100 and Quarter in s,
    -- QuarterSpeed in km/h, Braking in m.
    BestRuns: { [string]: { [string]: number } },
    ReloadPreset: (() -> ())?,
    PresetKey: string,
    ExhaustGain: number,
    -- While the garage is open the parked car revs in neutral: GarageThrottle is its
    -- throttle and CrankEngine (VehicleController) starts it.
    GarageOpen: boolean,
    GarageThrottle: number,
    CrankEngine: (() -> ())?,
}

local SCOPE_SIZE = 4096

local State: State = {
    Simulator = nil,
    PresetName = "",
    ImpulseResponse = "",
    Running = false,
    Status = "Starting",
    LastMessage = "",
    SpeedSetting = 0,
    Volume = 1,
    TireVolume = 0.04,
    IntakeVolume = 1,
    Audio = nil,
    Scope = table.create(SCOPE_SIZE, 0),
    ScopeSize = SCOPE_SIZE,
    ScopeHead = 0,
    ReaderFrames = 0,
    WriterFrames = 0,
    BenchMode = true,
    ExternalDriver = false,
    LoadPreset = nil,
    SetImpulseResponse = nil,
    ThrottleOverride = nil,
    StarterHeld = false,
    Presets = EngineSim.Presets,
    TireCompound = "Stock",
    SetTireCompound = nil,
    Changed = Instance.new("BindableEvent"),
    Chassis = nil,
    Driver = { WheelAngle = 0, Throttle = 0, Brake = 0, Clutch = 0 },
    CarModel = nil,
    CarAudio = nil,
    RemoteSimulators = {},
    CameraOverride = false,
    InputCaptured = false,
    ImGuiPanels = {},
    ImGuiOverlay = {},
    PresetTransform = nil,
    EngineTransform = nil,
    ShopOpen = false,
    BestRuns = {},
    ReloadPreset = nil,
    PresetKey = "",
    ExhaustGain = 1,
    GarageOpen = false,
    GarageThrottle = 0,
    CrankEngine = nil,
}

return State
