--!strict
-- Dear ImGui (4dbug/imgui-luau) debug menu. Settings come from Shared.ImGuiSettings.
-- F4 toggles the whole menu on/off.

local ReplicatedFirst = game:GetService("ReplicatedFirst")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local UserInputService = game:GetService("UserInputService")

local G = require(ReplicatedStorage:WaitForChild("Packages"):WaitForChild("ImGui")) :: any
local ImGuiSettings = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("ImGuiSettings"))
local TireCompounds = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("TireCompounds"))
local VehicleConfigs = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("VehicleConfigs"))
local VehicleNet = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Net"):WaitForChild("VehicleNet"))

local Modules = ReplicatedFirst:WaitForChild("Modules")
local EngineSim = require(Modules:WaitForChild("EngineSim"))
local Blower = require(Modules.EngineSim.Blower)
local EngineState = require(Modules:WaitForChild("EngineAudioState"))

local ImGui = G.ImGui
local Backend = G.ImGui_ImplRoblox

local TOGGLE_KEY = Enum.KeyCode.F4
local THEMES = { "Dark", "Light", "Classic" }

local ImGuiController = {}

-- the car to ask CarService for (VehicleNet.Choose), as names for the combo
local carNames: { string } = {}
for _, key in VehicleConfigs.Order do
    table.insert(carNames, VehicleConfigs.DisplayName[key] or key)
end
local carIndex = 0 -- (0-based, as Combo is)

local visible = false
local show = {
    EngineSim = true,
    Settings = true,
    StyleEditor = false,
    Demo = false,
    Metrics = false,
}

local function themeIndex(): number
    return (table.find(THEMES, ImGuiSettings.Theme.Base) or 1) - 1 -- Combo is 0-based
end

local function drawSettingsWindow()
    local style = ImGuiSettings.Style
    local open = ImGui.Begin("ImGui Settings", show.Settings)
    show.Settings = open

    ImGui.TextDisabled("F4 toggles this menu")
    ImGui.Separator()

    -- Theme
    local idx, changedTheme = ImGui.Combo("Theme", themeIndex(), THEMES)
    local scale, changedScale = ImGui.SliderFloat("UI Scale", ImGuiSettings.Theme.Scale, 0.5, 2.5, "%.2f")
    local fontScale, changedFont = ImGui.SliderFloat("Text Scale", style.FontScaleMain, 0.5, 2.5, "%.2f")
    local alpha, changedAlpha = ImGui.SliderFloat("Opacity", style.Alpha, 0.2, 1.0, "%.2f")
    local rounding, changedRounding = ImGui.SliderFloat("Rounding", style.WindowRounding, 0.0, 12.0, "%.0f")

    if changedTheme then
        ImGuiSettings.Theme.Base = THEMES[idx + 1]
    end
    if changedScale then
        ImGuiSettings.Theme.Scale = scale
    end
    if changedFont then
        style.FontScaleMain = fontScale
    end
    if changedAlpha then
        style.Alpha = alpha
    end
    if changedRounding then
        style.WindowRounding = rounding
        style.ChildRounding = rounding
        style.PopupRounding = rounding
        style.FrameRounding = rounding * 0.5
        style.GrabRounding = rounding * 0.5
        style.TabRounding = rounding * 0.5
    end
    if changedTheme or changedScale or changedFont or changedAlpha or changedRounding then
        ImGuiSettings.ApplyStyle(G)
    end

    ImGui.Separator()
    local _
    _, show.EngineSim = ImGui.Checkbox("Engine Sim", show.EngineSim)
    _, show.StyleEditor = ImGui.Checkbox("Style Editor (every setting, live)", show.StyleEditor)
    _, show.Demo = ImGui.Checkbox("Demo Window", show.Demo)
    _, show.Metrics = ImGui.Checkbox("Metrics / Debugger", show.Metrics)

    if ImGui.CollapsingHeader("Renderer") then
        local stats = Backend.GetStats()
        ImGui.Text("%.1f FPS", ImGui.GetIO().Framerate)
        ImGui.Text("Tiles: %d   EditableImages: %d", stats.Tiles or 0, stats.EditableImages or 0)
        ImGui.Text("Image memory: %.1f / %.1f MB", (stats.EditableImageBytes or 0) / 1048576, (stats.EditableImageCap or 0) / 1048576)
    end

    ImGui.End()
end

---------------------------------------------------------------------------
-- Engine Sim window
---------------------------------------------------------------------------

local presetKeys: { string } = {}
for key in EngineState.Presets do
    table.insert(presetKeys, key)
end
table.sort(presetKeys)

local irNames: { string } = EngineSim.ImpulseResponses.List()
local throttleOverride = false
local throttleValue = 0.0
local rpmHistory = table.create(120, 0)
local SCOPE_SAMPLES = 2048
local SCOPE_POINTS = 256
local scopePoints = table.create(SCOPE_POINTS, 0)

-- Slider bound to one synthesizer audio parameter; returns true if it changed.
local function apSlider(ap: any, label: string, key: string, min: number, max: number, fmt: string, log: boolean?): boolean
    local v, changed = ImGui.SliderFloat(label, ap[key], min, max, fmt, if log then G.ImGuiSliderFlags.Logarithmic else 0)
    if changed then
        ap[key] = v
    end
    return changed
end

local function drawEngineSimWindow()
    show.EngineSim = ImGui.Begin("Engine Sim", show.EngineSim)

    local sim = EngineState.Simulator
    if not sim then
        ImGui.TextDisabled("No simulator running (%s)", EngineState.Status)
        ImGui.End()
        return
    end
    local engine = sim.engine
    local synth = sim.synthesizer

    -- Readouts
    local rpm = engine:getRpm()
    local preset = sim.preset
    table.remove(rpmHistory, 1)
    table.insert(rpmHistory, rpm)
    local flags = {}
    if engine.ignition then table.insert(flags, "IGN ON") else table.insert(flags, "ign off") end
    if engine.starter then table.insert(flags, "STARTER") end
    if engine.revLimitTimer > 0 then table.insert(flags, "REV LIMIT") end
    ImGui.Text("%5.0f RPM   throttle %3.0f%%   %s", rpm, EngineState.SpeedSetting * 100, table.concat(flags, "  "))
    local torque = engine:getTorque()
    local kw = torque * engine:getSpeed() / 1000
    ImGui.Text("MAP %5.1f kPa (%+.1f kPa)   torque %6.1f N m", engine:getManifoldPressure() / 1000, engine:getBoost() / 1000, torque)
    ImGui.Text("power %6.1f kW (%5.0f hp)   redline %d   idle %d", kw, kw * 1.341, engine:getRedline(), preset.IdleRpm)
    ImGui.PlotLines("##rpm", rpmHistory, nil, #rpmHistory, 0, "RPM", 0, nil, G.ImVec2(0, 50))

    -- Oscilloscope: the waveform the audio graph received, newest 2048 samples
    -- (~43 ms at 48 kHz), thinned to the loudest sample of each group
    ImGui.SeparatorText("Oscilloscope")
    if EngineState.ReaderFrames > 0 then
        local data, size = EngineState.Scope, EngineState.ScopeSize
        local start = EngineState.ScopeHead - SCOPE_SAMPLES
        local per = SCOPE_SAMPLES // SCOPE_POINTS
        for p = 1, SCOPE_POINTS do
            local best = 0
            for k = 0, per - 1 do
                local v = data[(start + (p - 1) * per + k) % size + 1]
                if math.abs(v) > math.abs(best) then
                    best = v
                end
            end
            scopePoints[p] = math.clamp(best, -1, 1)
        end
        ImGui.PlotLines("##scope", scopePoints, nil, SCOPE_POINTS, 0, "", -1, 1, G.ImVec2(0, 90))
    else
        ImGui.TextDisabled("no audio reader (AudioStreamReader is Studio-only)")
    end

    -- Audio / synthesizer
    ImGui.SeparatorText("Audio")
    ImGui.Text("level %.1f dB   leveler gain %.4f", 20 * math.log10(math.max(synth.loudness, 1e-6)), synth:getLevelerGain())
    ImGui.TextDisabled("latency %.0f ms   steps/frame %d @ %d Hz   buffered %d",
        (if sim.output then sim.queuedLatency + synth:getConvolutionLatency() / synth.audioSampleRate
            else sim:getSynthesizerInputLatency()) * 1000, sim.lastStepsSimulated, sim.simulationFrequency, synth:getBufferedAudioSamples())
    ImGui.TextDisabled("%s   %d cylinders/rotors, %d exhaust   frames out %d",
        EngineState.Status, engine:getCylinderCount(), engine:getExhaustSystemCount(), EngineState.WriterFrames)

    -- Drivetrain (only while driving a car)
    local chassis = EngineState.Chassis
    local dt = if chassis then chassis.drivetrain else nil
    if dt then
        ImGui.SeparatorText("Drivetrain")
        local gear = if dt.gear < 0 then "R" elseif dt.gear == 0 then "N" else tostring(dt.gear)
        ImGui.Text("gear %s   %s   %.0f km/h   clutch %3.0f%%", gear, dt.mode, math.abs(chassis.speed) * 3.6, dt.clutch * 100)
        ImGui.TextDisabled("wheel torque %.0f N m   clutch %.0f N m   TCS %s (%.0f%%)   ABS %s",
            dt.wheelTorque, dt.clutchTorque, if dt.tcs then "on" else "off", dt.tcsFactor * 100, if dt.abs then "on" else "off")
    end

    if EngineState.LastMessage ~= "" then
        ImGui.TextDisabled("%s", EngineState.LastMessage)
    end

    -- Engine / impulse response
    ImGui.SeparatorText("Engine")
    local presetIdx = 0
    for i, key in presetKeys do
        if EngineState.Presets[key].Name == EngineState.PresetName then
            presetIdx = i - 1
        end
    end
    local newPreset, presetChanged = ImGui.Combo("Preset", presetIdx, presetKeys)
    if presetChanged and EngineState.LoadPreset then
        EngineState.LoadPreset(presetKeys[newPreset + 1])
    end

    local cams = preset.CamOptions
    if cams then
        local names = { "Stock" }
        for _, cam in cams do
            table.insert(names, cam.Name)
        end
        local camIndex, camChanged = ImGui.Combo("Camshaft", engine.camIndex, names)
        if camChanged then
            engine.camIndex = camIndex
        end
        local cam = cams[engine.camIndex]
        if cam then
            ImGui.TextDisabled("%s   %d rpm limit", cam.Specs, engine:getRedline())
        end
    end
    local roots = preset.Supercharger
    if roots then
        engine.superchargerAirflow = ImGui.SliderFloat("Roots Supercharger Airflow", engine.superchargerAirflow, 0.75, 1.75, "%.2fx")
        ImGui.TextDisabled("%.2f L/rev   inlet airflow %.0f L/s",
            roots.Displacement * engine.superchargerAirflow * 1000, engine.inductionMean * 1000)
    end

    local irIdx = (table.find(irNames, EngineState.ImpulseResponse) or 1) - 1
    local newIr, irChanged = ImGui.Combo("Impulse Response", irIdx, irNames)
    if irChanged and EngineState.SetImpulseResponse then
        EngineState.SetImpulseResponse(irNames[newIr + 1])
    end

    -- Car: a new one beside you in place of the one you have (CarService)
    ImGui.SeparatorText("Car")
    local newCar, carChanged = ImGui.Combo("Car", carIndex, carNames)
    if carChanged then
        carIndex = newCar
        VehicleNet.Choose:Client():Fire(VehicleConfigs.Order[newCar + 1])
    end

    -- Transfer case (a car with one): 2H, 4H, 4L
    local driving = EngineState.Chassis
    local dtr = driving and driving.drivetrain
    if dtr and dtr.transferCase then
        local modes = { "2H", "4H", "4L" }
        local idx = (table.find(modes, dtr.transfer) or 1) - 1
        local newMode, modeChanged = ImGui.Combo("Transfer case", idx, modes)
        if modeChanged then
            local ok, reason = dtr:setTransfer(modes[newMode + 1])
            if not ok then
                EngineState.LastMessage = reason or "Can't shift the transfer case"
            end
        end
    end

    -- Tires (fitted to the car you drive; the choice carries over between cars)
    ImGui.SeparatorText("Tires")
    local tireIdx = (table.find(TireCompounds.Order, EngineState.TireCompound) or 1) - 1
    local newTire, tireChanged = ImGui.Combo("Compound", tireIdx, TireCompounds.Order)
    if tireChanged then
        local name = TireCompounds.Order[newTire + 1]
        if EngineState.SetTireCompound then
            EngineState.SetTireCompound(name)
        else
            EngineState.TireCompound = name
        end
    end
    local compound = TireCompounds.ByName[EngineState.TireCompound]
    ImGui.TextDisabled("%s", if compound
        then string.format("peak grip %.2f g (car's stock tire otherwise)", compound.Mu)
        else "the car's own tire")

    -- Controls (bench mode only; in a car the vehicle drives the engine)
    ImGui.SeparatorText("Controls")
    local bench = EngineState.BenchMode
    if not bench then
        ImGui.TextDisabled("In a vehicle: throttle/starter come from driving")
    end
    ImGui.BeginDisabled(not bench)
    local _, ign = ImGui.Checkbox("Ignition", engine.ignition)
    if ign ~= engine.ignition then
        engine.ignition = ign
    end
    ImGui.SameLine()
    ImGui.Button("Hold to Crank")
    EngineState.StarterHeld = bench and ImGui.IsItemActive()

    _, throttleOverride = ImGui.Checkbox("Throttle override", throttleOverride)
    ImGui.SameLine()
    ImGui.BeginDisabled(not throttleOverride)
    throttleValue = ImGui.SliderFloat("##throttle", throttleValue, 0.0, 1.0, "%.3f")
    ImGui.EndDisabled()
    EngineState.ThrottleOverride = if throttleOverride and bench then throttleValue else nil
    ImGui.EndDisabled()

    -- Volumes
    ImGui.SeparatorText("Output")
    EngineState.Volume = ImGui.SliderFloat("Engine Volume", EngineState.Volume, 0.0, 3.0, "%.2f")
    EngineState.TireVolume = ImGui.SliderFloat("Tire Volume", EngineState.TireVolume, 0.0, 0.3, "%.3f")
    EngineState.IntakeVolume = ImGui.SliderFloat("Intake Volume", EngineState.IntakeVolume, 0.0, 3.0, "%.2f")

    if ImGui.CollapsingHeader("Centrifugal Supercharger") then
        local def = sim.blower.def
        _, def.Enabled = ImGui.Checkbox("Enable centrifugal sound", def.Enabled)
        local tier, tierChanged = ImGui.Combo("Blower Tier", (def.Tier or 1) - 1, Blower.TierNames)
        if tierChanged then
            sim.blower:setTier(tier + 1)
            def = sim.blower.def
        end
        ImGui.TextDisabled("Audio model charge pressure: %.1f kPa boost   reference: %d RPM", sim.blower:getBoost() / 1000, preset.Redline)
        local modes = Blower.ValveModes
        local modeIndex = (table.find(modes, def.ValveMode) or 1) - 1
        local selected, changed = ImGui.Combo("Relief Valve", modeIndex, modes)
        if changed then
            def.ValveMode = modes[selected + 1]
        end
        local head, headChanged = ImGui.SliderFloat("Shutoff Boost at Reference RPM", def.ShutoffBoost / 1000, 30, 250, "%.0f kPa")
        if headChanged then
            def.ShutoffBoost = head * 1000
        end
        apSlider(def, "Free Flow at Reference RPM", "FreeFlow", 0.15, 1.5, "%.2f m3/s")
        apSlider(def, "Valve Flow Capacity", "ValveFlow", 0.05, 3, "%.2f m3/s")
        apSlider(def, "Blower Volume", "Volume", 0, 3, "%.2f")
        apSlider(def, "Whistle", "Whistle", 0, 2, "%.2f")
        apSlider(def, "Whistle Pitch at Reference RPM", "WhistlePitch", 200, 12000, "%.0f Hz")
        apSlider(def, "Whistle Breath", "WhistleBreath", 0, 1, "%.2f")
        apSlider(def, "Gear Whine", "Gear", 0, 2, "%.2f")
        apSlider(def, "Gear Pitch at Reference RPM", "GearPitch", 100, 8000, "%.0f Hz")
        apSlider(def, "Whoosh", "Whoosh", 0, 2, "%.2f")
        apSlider(def, "Whoosh Tone", "WhooshTone", 0.25, 2, "%.2f")
        apSlider(def, "Inlet Hiss", "Suck", 0, 2, "%.2f")
        apSlider(def, "Inlet Hiss Tone", "SuckTone", 0.25, 2, "%.2f")
        apSlider(def, "Valve Sound", "BlowOff", 0, 2, "%.2f")
        def.BlowOffTime = ImGui.SliderFloat("Blow-off Decay", def.BlowOffTime or 0, 0, 1, "%.2f s")
        apSlider(def, "Surge Sound", "Surge", 0, 2, "%.2f")
        def.Flutter = ImGui.SliderFloat("Surge Flutter", def.Flutter or 0, 0, 1, "%.2f")
        def.FlutterRate = ImGui.SliderFloat("Surge Flutter Rate", def.FlutterRate or 27, 1, 80, "%.0f Hz")
        apSlider(def, "Off-boost Amount", "IdleAmount", 0, 1, "%.2f")
    end

    -- Synthesizer mixer (same as Z/X/C/V/B + wheel)
    if ImGui.CollapsingHeader("Synthesizer Mixer", G.ImGuiTreeNodeFlags.DefaultOpen) then
        local ap = synth:getAudioParameters()
        local changed = false
        changed = apSlider(ap, "Volume", "volume", 0, 1, "%.3f") or changed
        changed = apSlider(ap, "Convolution", "convolution", 0, 1, "%.3f") or changed
        changed = apSlider(ap, "High Freq. Gain", "dF_F_mix", 0.00001, 1, "%.5f", true) or changed
        changed = apSlider(ap, "Low Freq. Noise", "airNoise", 0, 1, "%.3f") or changed
        changed = apSlider(ap, "Low Freq. Noise Cutoff", "airNoiseFrequencyCutoff", 50, 20000, "%.0f Hz", true) or changed
        changed = apSlider(ap, "High Freq. Noise", "inputSampleNoise", 0, 1, "%.3f") or changed
        changed = apSlider(ap, "Leveler Target", "levelerTarget", 1000, 60000, "%.0f", true) or changed
        local levelChanged = apSlider(ap, "Leveler Max Gain", "levelerMaxGain", 0.01, 10000, "%.2f", true)
        levelChanged = apSlider(ap, "Leveler Min Gain", "levelerMinGain", 0.000001, 1, "%.6f", true) or levelChanged
        if changed or levelChanged then
            synth:setAudioParameters(ap)
        end
        if levelChanged then
            -- leveler limits are only read at init; push them to the filter directly
            synth.levelingFilter.p_maxLevel = ap.levelerMaxGain
            synth.levelingFilter.p_minLevel = ap.levelerMinGain
        end
        if ImGui.Button("Reset to preset defaults") and EngineState.LoadPreset then
            for _, key in presetKeys do
                if EngineState.Presets[key].Name == EngineState.PresetName then
                    EngineState.LoadPreset(key)
                    break
                end
            end
        end
    end

    ImGui.End()
end

-- windows that show with the menu closed too (e.g. the exhaust garage)
local function drawOverlays()
    for name, draw in EngineState.ImGuiOverlay do
        local ok, err = pcall(draw :: any, ImGui, G)
        if not ok then
            warn(`[ImGui] overlay {name}: {err}`)
            EngineState.ImGuiOverlay[name] = nil
        end
    end
end

local function drawFrame()
    if not visible then
        EngineState.StarterHeld = false
        EngineState.ThrottleOverride = nil
        drawOverlays()
        return
    end
    drawOverlays()

    if show.EngineSim then
        drawEngineSimWindow()
    end
    if show.Settings then
        drawSettingsWindow()
    end
    if show.StyleEditor then
        show.StyleEditor = ImGui.Begin("Style Editor", show.StyleEditor)
        ImGui.ShowStyleEditor()
        ImGui.End()
    end
    if show.Demo then
        show.Demo = ImGui.ShowDemoWindow(show.Demo)
    end
    if show.Metrics then
        show.Metrics = ImGui.ShowMetricsWindow(show.Metrics)
    end
    -- windows other controllers add (e.g. Replay)
    for name, draw in EngineState.ImGuiPanels do
        local ok, err = pcall(draw :: any, ImGui, G)
        if not ok then
            warn(`[ImGui] panel {name}: {err}`)
            EngineState.ImGuiPanels[name] = nil
        end
    end
end

function ImGuiController.Start(_self: typeof(ImGuiController))
    ImGui.CreateContext()
    ImGuiSettings.ApplyIO(G)
    ImGuiSettings.ApplyFonts(G)
    Backend.Init(nil, ImGuiSettings.Backend.RenderScale)
    ImGuiSettings.ApplyBackend(G)
    ImGuiSettings.ApplyStyle(G)

    UserInputService.InputBegan:Connect(function(input: InputObject)
        if input.KeyCode == TOGGLE_KEY then
            visible = not visible
            if visible then
                show.EngineSim = true -- reopen if it was closed with the X
            end
        end
    end)

    -- Keep running frames while hidden so the last drawn UI gets cleared.
    RunService.PreSimulation:Connect(function()
        Backend.NewFrame()
        ImGui.NewFrame()
        drawFrame()
        ImGui.Render()
        Backend.RenderDrawData(ImGui.GetDrawData())
    end)
end

return ImGuiController
