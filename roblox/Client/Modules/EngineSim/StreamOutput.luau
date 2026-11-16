--!strict
--!native
-- Moves synthesizer output (int16 @ 44.1 kHz, the rate engine-sim renders at)
-- into Roblox AudioStreamWriters (Float32 @ 48 kHz).
--
-- engine-sim's impulse responses and every filter cutoff assume 44.1 kHz, so
-- the synthesizer keeps running at 44.1 kHz and only its output is resampled
-- (4-point cubic Hermite). The synthesizer's 19.8 kHz anti-aliasing filter
-- already removes the content that would image above 22.05 kHz.
--
-- Matches EngineSimApplication's audio pump: write only as much as the device
-- has room for, read that much from the synthesizer, pad nothing.
--
-- Two ways to use it:
--   StreamOutput.new(writer)                  one writer: exhaust + intake mixed
--   StreamOutput.new({ exhaust, intake })     the synthesizer's two streams, each
--                                             into its own writer (so each can
--                                             play from its own AudioEmitter)
-- Every writer is written the same number of frames, so the streams stay in
-- sample lockstep.

local Synthesizer = require(script.Parent.Synthesizer)

local StreamOutput = {}
StreamOutput.__index = StreamOutput

local INPUT_RATE = 44100
local INV_INT16 = 1 / 32768
-- The engine stays within full scale (the synthesizer clamps it to int16);
-- exhaust afterfire bangs are mixed in after that and may go past it, up to
-- this, for the audio graph and its volume and distance to work on.
local HEADROOM = 8

export type WriteMode = "buffer" | "table"

-- Hermite history per channel: xm1 = sample before the interval, x0..x1 =
-- interval, x2 = next
type Channel = {
    writer: AudioStreamWriter,
    -- buffers per Write call: one per channel of the writer's layout (the
    -- mono signal is duplicated into each)
    layoutChannels: number,
    -- reused Write buffers, by frame count
    pool: { [number]: buffer },
    poolSize: number,
    xm1: number,
    x0: number,
    x1: number,
    x2: number,
    scratch: { number },
}

export type StreamOutput = typeof(setmetatable({} :: {
    channels: { Channel },
    split: boolean, -- false: one writer playing the mix
    outputRate: number,
    step: number,
    frac: number,
    primed: boolean,
    mode: WriteMode?,
    underruns: number,
    lastWritten: number,
    -- the writer's queue size in frames: the most Space() has reported (an
    -- empty writer reports all of it)
    capacity: number,
    -- pumps that found every writer empty after it had been written: the
    -- device ran dry since the last pump
    deviceUnderruns: number,
    written: boolean,
}, StreamOutput))

-- Write takes one buffer per channel of the writer's Layout. The signal is
-- mono, so Mono takes it as is and Stereo gets it twice; anything else is
-- refused here rather than as a confusing error from Write.
local function layoutChannelCount(writer: AudioStreamWriter): number
    local ok, layout = pcall(function()
        return (writer :: any).Layout
    end)
    if not ok or layout == nil or layout == Enum.AudioChannelLayout.Mono then
        return 1
    elseif layout == Enum.AudioChannelLayout.Stereo then
        return 2
    end
    error(`StreamOutput needs a Mono or Stereo AudioStreamWriter, got Layout {layout}`)
end

local POOL_LIMIT = 8

-- A Float32 buffer of `frames` samples, reused across pumps (Write copies it).
-- Frame counts settle on a few values, so the pool stays small.
local function poolBuffer(ch: Channel, frames: number): buffer
    local buf = ch.pool[frames]
    if buf then
        return buf
    end
    if ch.poolSize >= POOL_LIMIT then
        table.clear(ch.pool)
        ch.poolSize = 0
    end
    buf = buffer.create(frames * 4)
    ch.pool[frames] = buf
    ch.poolSize += 1
    return buf
end

function StreamOutput.new(writers: AudioStreamWriter | { AudioStreamWriter }): StreamOutput
    -- a single writer (an Instance, or anything with Space/Write) vs a list
    local single = typeof(writers) == "Instance" or (writers :: any).Space ~= nil
    local list: { AudioStreamWriter } = if single then { writers :: any } else writers :: any
    assert(#list == 1 or #list == 2, "StreamOutput takes one writer (mix) or two (exhaust, intake)")

    local outputRate = 48000
    local ok, rate = pcall(function()
        return list[1].SampleRate
    end)
    if ok and type(rate) == "number" and rate > 0 then
        outputRate = rate
    end

    local channels: { Channel } = {}
    for i, w in list do
        channels[i] = {
            writer = w,
            layoutChannels = layoutChannelCount(w),
            pool = {},
            poolSize = 0,
            xm1 = 0,
            x0 = 0,
            x1 = 0,
            x2 = 0,
            scratch = {},
        }
    end

    return setmetatable({
        channels = channels,
        split = #list == 2,
        outputRate = outputRate,
        step = INPUT_RATE / outputRate,
        frac = 0,
        primed = false,
        mode = nil,
        underruns = 0,
        lastWritten = 0,
        capacity = 0,
        deviceUnderruns = 0,
        written = false,
    }, StreamOutput)
end

-- Free space of the fullest writer, folded into the capacity estimate.
local function writerSpace(self: StreamOutput): number
    local channels = self.channels
    local s = channels[1].writer:Space()
    local b = channels[2]
    if b then
        s = math.min(s, b.writer:Space())
    end
    if s > self.capacity then
        self.capacity = s
    end
    return s
end

-- Seconds of audio queued in the writers, not yet played: the latency this
-- stage adds. 0 until the capacity is known.
function StreamOutput.getQueuedSeconds(self: StreamOutput): number
    local s = writerSpace(self)
    return math.max(self.capacity - s, 0) / self.outputRate
end

local function hermite(xm1: number, x0: number, x1: number, x2: number, t: number): number
    local c0 = x0
    local c1 = 0.5 * (x1 - xm1)
    local c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2
    local c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1)
    return ((c3 * t + c2) * t + c1) * t + c0
end

-- Pops one synthesizer frame as floats: (channel 1, channel 2). For a single
-- mixed writer channel 1 is the mix.
local function pop(self: StreamOutput, synth: Synthesizer.Synthesizer): (number?, number)
    if self.split then
        local e, i = synth:popAudioFrame()
        if e == nil then
            return nil, 0
        end
        return e * INV_INT16, i * INV_INT16
    end
    local s = synth:popAudioSample()
    if s == nil then
        return nil, 0
    end
    return s * INV_INT16, 0
end

-- Writes scratch[1..frames] to the writer. The docs describe the argument as
-- an array of per-channel Luau buffers of Float32 samples; a plain number
-- array is tried as a fallback.
local function submit(self: StreamOutput, ch: Channel, frames: number): number
    local scratch = ch.scratch
    local writer = ch.writer

    if self.mode ~= "table" then
        local buf = poolBuffer(ch, frames)
        for i = 0, frames - 1 do
            buffer.writef32(buf, i * 4, scratch[i + 1])
        end
        local ok, written = pcall(writer.Write, writer, if ch.layoutChannels == 2 then { buf, buf } else { buf })
        if ok then
            self.mode = "buffer"
            return if type(written) == "number" then written else frames
        elseif self.mode == "buffer" then
            error(written)
        end
        self.mode = "table"
        warn("[EngineSim] AudioStreamWriter:Write rejected a buffer, retrying with a number array:", written)
    end

    local samples = table.create(frames, 0)
    table.move(scratch, 1, frames, 1, samples)
    local written = writer:Write(if ch.layoutChannels == 2 then { samples :: any, samples :: any } else { samples :: any })
    return if type(written) == "number" then written else frames
end

-- Pull as many samples as every writer has room for. Returns frames written.
function StreamOutput.pump(self: StreamOutput, synth: Synthesizer.Synthesizer): number
    local channels = self.channels
    local a = channels[1]
    local b = channels[2] -- nil for a single mixed writer

    local space = writerSpace(self)
    if space <= 0 then
        return 0
    end
    if self.written and space >= self.capacity then
        self.deviceUnderruns += 1
    end

    if not self.primed then
        -- Need four samples of history before interpolating.
        if synth:getBufferedAudioSamples() < 4 then
            return 0
        end
        local h1: { number } = {}
        local h2: { number } = {}
        for k = 1, 4 do
            local s1, s2 = pop(self, synth)
            h1[k], h2[k] = s1 :: number, s2
        end
        a.xm1, a.x0, a.x1, a.x2 = h1[1], h1[2], h1[3], h1[4]
        if b then
            b.xm1, b.x0, b.x1, b.x2 = h2[1], h2[2], h2[3], h2[4]
        end
        self.frac = 0
        self.primed = true
    end

    local step = self.step
    local t = self.frac
    local frames = 0
    local starved = false
    local aScratch = a.scratch
    local am1, a0, a1, a2 = a.xm1, a.x0, a.x1, a.x2
    local bScratch = if b then b.scratch else aScratch
    local bm1, b0, b1, b2 = 0, 0, 0, 0
    if b then
        bm1, b0, b1, b2 = b.xm1, b.x0, b.x1, b.x2
    end

    while frames < space do
        while t >= 1 do
            local s1, s2 = pop(self, synth)
            if s1 == nil then
                starved = true
                break
            end
            am1, a0, a1, a2 = a0, a1, a2, s1
            bm1, b0, b1, b2 = b0, b1, b2, s2
            t -= 1
        end
        if starved then
            break
        end

        frames += 1
        -- Cubic interpolation can overshoot even when its input is clamped.
        -- Bound it by full scale, or by the interval's own samples when an
        -- afterfire bang takes them past it (up to HEADROOM).
        local bound = math.min(HEADROOM, math.max(1, math.abs(a0), math.abs(a1)))
        aScratch[frames] = math.clamp(hermite(am1, a0, a1, a2, t), -bound, bound)
        if b then
            bScratch[frames] = math.clamp(hermite(bm1, b0, b1, b2, t), -1, 1)
        end

        t += step
    end

    a.xm1, a.x0, a.x1, a.x2 = am1, a0, a1, a2
    if b then
        b.xm1, b.x0, b.x1, b.x2 = bm1, b0, b1, b2
    end
    self.frac = t

    if starved then
        self.underruns += 1
    end

    if frames == 0 then
        self.lastWritten = 0
        return 0
    end

    local written = submit(self, a, frames)
    if b then
        submit(self, b, frames)
    end
    self.lastWritten = written
    self.written = true
    return written
end

return StreamOutput
