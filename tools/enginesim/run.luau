-- lune run Tools/test/run.luau [preset] [out.wav] [seconds] [cam option: 0=stock]
-- 1) checks FFT convolution against engine-sim's direct convolution
-- (5th argument "cut": ignition cuts and decel crackle, see below)
-- 2) runs a start -> idle -> full throttle -> lift-off drive cycle through the
--    whole pipeline with a fake 48 kHz AudioStreamWriter and writes a WAV.
local fs = require("@lune/fs")
local process = require("@lune/process")
local H = require("./harness")

local ROOT = "Client/Modules/EngineSim"
local EngineSim = H.require(ROOT)

---------------------------------------------------------------------------
-- 1. Convolution equivalence
---------------------------------------------------------------------------
do
    local Conv = EngineSim.ConvolutionFilter
    local N = 3001
    local a, b = Conv.new(), Conv.new()
    a:initialize(N)
    b:initialize(N)
    local ha, hb = a:getImpulseResponse(), b:getImpulseResponse()
    for i = 1, N do
        local v = (math.random() * 2 - 1) * math.exp(-i / 500)
        ha[i] = v
        hb[i] = v
    end
    a:prepare("direct")
    b:prepare("fft", 256)
    local B = b:getLatency()
    local direct = {}
    local maxErr, maxRef = 0, 0
    local count = 8000
    local wets = {}
    for n = 1, count do
        local x = math.random() * 2 - 1
        direct[n] = a:f(x)
        wets[n] = b:f(x)
    end
    for n = B + 1, count do
        local e = math.abs(wets[n] - direct[n - B])
        maxErr = math.max(maxErr, e)
        maxRef = math.max(maxRef, math.abs(direct[n - B]))
    end
    print(string.format("[conv] FFT vs direct: max abs err %.3e (signal peak %.3f), latency %d samples", maxErr, maxRef, B))
    assert(maxErr < 1e-9 * math.max(1, maxRef) * 1000, "FFT convolution mismatch")
end

---------------------------------------------------------------------------
-- 2. Full pipeline
---------------------------------------------------------------------------
local presetName = process.args[1] or "GM_LS"
local outPath = process.args[2] or "engine_test.wav"
local preset = EngineSim.Presets[presetName]
assert(preset, "unknown preset " .. presetName)

local sim = EngineSim.EngineAudioSimulator.new(preset)
local engine = sim.engine
if process.args[4] then
    local cam = assert(tonumber(process.args[4]), "cam option must be a number")
    assert(cam == 0 or (preset.CamOptions and preset.CamOptions[cam]), "unknown cam option")
    if preset.CamOptions then
        engine.camIndex = cam
    end
end

-- Fake AudioStreamWriter: device consumes 48000 frames/s, window of 4096
local written = {}
local Writer = { SampleRate = 48000, _fill = 0, _window = 4096 }
function Writer:Space()
    return self._window - self._fill
end
function Writer:Write(bufs)
    local b = bufs[1]
    local frames = buffer.len(b) // 4
    frames = math.min(frames, self:Space())
    for i = 0, frames - 1 do
        written[#written + 1] = buffer.readf32(b, i * 4)
    end
    self._fill += frames
    return frames
end
function Writer:consume(frames)
    local take = math.min(frames, self._fill)
    self._fill -= take
    return frames - take -- underrun frames
end

local out = EngineSim.StreamOutput.new(Writer :: any)

-- 5th argument "cut": three 120 ms ignition cuts (fuel on) during the full
-- throttle pull, held near 5500 rpm, then the decel crackle tune on lift-off
local cutDemo = process.args[5] == "cut"
local nextCut = 5.0
if cutDemo then
    local map = EngineSim.FuelMap.forPreset(preset)
    local redline = engine:getRedline()
    local tune = EngineSim.FuelMap.Tunes[3]
    EngineSim.FuelMap.fill(map, function(r, l) return tune.Fn(r, l, redline) end)
end

local FPS = 60
local dt = 1 / FPS
local duration = tonumber(process.args[3]) or 12
local frames = math.floor(duration * FPS)
local deviceUnderrun = 0
local t0 = os.clock()
local deviceAccum = 0

for f = 1, frames do
    local t = f * dt
    engine.starter = t < 1.2
    engine.ignition = true
    if t < 4 then
        engine.throttle = 0
    elseif t < 7.5 then
        engine.throttle = 1
    elseif t < 9 then
        engine.throttle = 0
    elseif t < 10.5 then
        engine.throttle = 0.35
    else
        engine.throttle = 0
    end

    if cutDemo then
        local hold = math.min(5500, engine:getRedline() * 0.8)
        engine.load = if engine.throttle > 0.5 then math.max(0, (engine:getRpm() - hold) * 2) else 0
        if t >= nextCut and nextCut < 7.4 then
            engine:cutSpark(0.12)
            nextCut += 0.8
        end
    end
    sim:update(dt)
    out:pump(sim.synthesizer)

    deviceAccum += 48000 * dt
    local consume = math.floor(deviceAccum)
    deviceAccum -= consume
    if f > 10 then
        deviceUnderrun += Writer:consume(consume)
    end

    if f % 30 == 0 then
        print(string.format(
            "t=%5.2fs rpm=%6.0f thr=%.2f map=%5.1fkPa steps=%4d latency=%.3fs synthBuf=%4d gain=%.4f",
            t, engine:getRpm(), engine.throttle, engine:getManifoldPressure() / 1000,
            sim.lastStepsSimulated, sim:getSynthesizerInputLatency(),
            sim.synthesizer:getBufferedAudioSamples(), sim.synthesizer:getLevelerGain()))
    end
end

local elapsed = os.clock() - t0
print(string.format("[perf] simulated %.1fs of audio in %.2fs CPU (%.1f%% of real time)", duration, elapsed, 100 * elapsed / duration))
print(string.format("[out] %d frames written, device underrun frames %d, starved pumps %d", #written, deviceUnderrun, out.underruns))

local peak, nan = 0, 0
for _, v in written do
    if v ~= v then nan += 1 else peak = math.max(peak, math.abs(v)) end
end
print(string.format("[out] peak %.3f, NaN %d, afterfires %d", peak, nan, engine.afterfires))
-- afterfire bangs can go past full scale: the WAV is scaled down to fit them
-- (so the engine plays quieter in it than it does in game)
local norm = if peak > 1 then 1 / peak else 1
print(string.format("[out] loudest bang %.2f x full scale; WAV scaled by %.3f", sim.synthesizer.bangPeak / 32768, norm))

-- WAV (16-bit mono 48 kHz)
local n = #written
local wav = buffer.create(44 + n * 2)
buffer.writestring(wav, 0, "RIFF")
buffer.writeu32(wav, 4, 36 + n * 2)
buffer.writestring(wav, 8, "WAVEfmt ")
buffer.writeu32(wav, 16, 16)
buffer.writeu16(wav, 20, 1)
buffer.writeu16(wav, 22, 1)
buffer.writeu32(wav, 24, 48000)
buffer.writeu32(wav, 28, 96000)
buffer.writeu16(wav, 32, 2)
buffer.writeu16(wav, 34, 16)
buffer.writestring(wav, 36, "data")
buffer.writeu32(wav, 40, n * 2)
for i = 1, n do
    local v = math.clamp(written[i] * norm, -1, 32767 / 32768)
    buffer.writei16(wav, 44 + (i - 1) * 2, math.clamp(math.floor(v * 32768 + 0.5), -32768, 32767))
end
fs.writeFile(outPath, buffer.tostring(wav))
print("[out] wrote " .. outPath)
