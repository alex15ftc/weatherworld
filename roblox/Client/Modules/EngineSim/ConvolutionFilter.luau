--!strict
--!native
-- Port of engine-sim src/convolution_filter.cpp.
--
-- engine-sim convolves every output sample directly against an impulse
-- response of up to 10000 taps: y[n] = sum_i h[i] * x[n - i]. That is ~441M
-- multiply-adds per second per exhaust channel, which Luau cannot do in real
-- time. This module computes the same sum with uniformly partitioned
-- overlap-save FFT convolution, which is mathematically identical.
--
-- The one difference: the FFT path works on blocks of `blockSize` samples, so
-- its output is the exact engine-sim output delayed by `blockSize` samples
-- (128 samples = 2.9 ms by default; 256 costs ~7 % less CPU). `f` also returns the dry input delayed by
-- the same amount so the synthesizer's wet/dry mix stays aligned.
--
-- `mode = "direct"` runs the original time-domain loop with zero latency for
-- testing or very short responses.

local ConvolutionFilter = {}
ConvolutionFilter.__index = ConvolutionFilter

local cos = math.cos
local sin = math.sin
local PI = math.pi

export type ConvolutionFilter = typeof(setmetatable({} :: {
    sampleCount: number,
    impulseResponse: { number },
    direct: boolean,

    -- direct mode (faithful shift register)
    shiftRegister: { number },
    shiftOffset: number,

    -- FFT mode
    blockSize: number,
    fftSize: number,
    partitions: number,
    bins: number,
    pos: number,
    inCur: { number },
    inPrev: { number },
    outBlock: { number },
    -- partition spectra of h, flattened [p * bins + k]
    hRe: { number },
    hIm: { number },
    -- frequency-domain delay line of input spectra (ring of `partitions`)
    xRe: { number },
    xIm: { number },
    xHead: number,
    -- scratch
    re: { number },
    im: { number },
    accRe: { number },
    accIm: { number },
    cosT: { number },
    sinT: { number },
    rev: { number },
    log2n: number,
}, ConvolutionFilter))

local function newFftTables(n: number)
    local log2n = 0
    while (2 ^ log2n) < n do
        log2n += 1
    end
    local rev = table.create(n, 0)
    for i = 0, n - 1 do
        local r = 0
        local x = i
        for _ = 1, log2n do
            r = r * 2 + (x % 2)
            x = x // 2
        end
        rev[i + 1] = r
    end
    local cosT = table.create(n // 2, 0)
    local sinT = table.create(n // 2, 0)
    for k = 0, n // 2 - 1 do
        cosT[k + 1] = cos(-2 * PI * k / n)
        sinT[k + 1] = sin(-2 * PI * k / n)
    end
    return log2n, rev, cosT, sinT
end

-- In-place iterative radix-2 forward FFT on (re, im), 1-based arrays of size n.
local function fft(re: { number }, im: { number }, n: number, rev: { number }, cosT: { number }, sinT: { number })
    for i = 1, n do
        local j = rev[i] + 1
        if j > i then
            re[i], re[j] = re[j], re[i]
            im[i], im[j] = im[j], im[i]
        end
    end

    local size = 2
    while size <= n do
        local half = size // 2
        local step = n // size
        for start = 0, n - 1, size do
            local t = 0
            for k = start, start + half - 1 do
                local wr = cosT[t + 1]
                local wi = sinT[t + 1]
                local a = k + 1
                local b = k + half + 1
                local br = re[b]
                local bi = im[b]
                local tr = wr * br - wi * bi
                local ti = wr * bi + wi * br
                local ar = re[a]
                local ai = im[a]
                re[b] = ar - tr
                im[b] = ai - ti
                re[a] = ar + tr
                im[a] = ai + ti
                t += step
            end
        end
        size *= 2
    end
end

function ConvolutionFilter.new(): ConvolutionFilter
    return setmetatable({
        sampleCount = 0,
        impulseResponse = {},
        direct = true,
        shiftRegister = {},
        shiftOffset = 0,
        blockSize = 0,
        fftSize = 0,
        partitions = 0,
        bins = 0,
        pos = 0,
        inCur = {},
        inPrev = {},
        outBlock = {},
        hRe = {},
        hIm = {},
        xRe = {},
        xIm = {},
        xHead = 0,
        re = {},
        im = {},
        accRe = {},
        accIm = {},
        cosT = {},
        sinT = {},
        rev = {},
        log2n = 0,
    }, ConvolutionFilter)
end

-- ConvolutionFilter::initialize(samples): allocates a zeroed response.
function ConvolutionFilter.initialize(self: ConvolutionFilter, samples: number)
    self.sampleCount = samples
    self.shiftOffset = 0
    self.shiftRegister = table.create(samples, 0)
    self.impulseResponse = table.create(samples, 0)
    self.direct = true
end

-- Must be called after the impulse response has been filled in.
-- mode: "fft" (default) or "direct".
function ConvolutionFilter.prepare(self: ConvolutionFilter, mode: string?, blockSize: number?)
    local N = self.sampleCount
    if mode == "direct" or N == 0 then
        self.direct = true
        return
    end

    local B = blockSize or 128
    -- the radix-2 FFT needs fftSize = 2 * B to be a power of two
    assert(B > 0 and B % 1 == 0 and bit32.band(B, B - 1) == 0,
        `convolutionBlockSize must be a power of 2 (got {B})`)
    local M = 2 * B
    local P = math.max(1, math.ceil(N / B))
    local bins = B + 1

    self.direct = false
    self.blockSize = B
    self.fftSize = M
    self.partitions = P
    self.bins = bins
    self.pos = 0
    self.inCur = table.create(B, 0)
    self.inPrev = table.create(B, 0)
    self.outBlock = table.create(B, 0)
    self.re = table.create(M, 0)
    self.im = table.create(M, 0)
    self.accRe = table.create(bins, 0)
    self.accIm = table.create(bins, 0)
    self.xRe = table.create(P * bins, 0)
    self.xIm = table.create(P * bins, 0)
    self.xHead = 0

    local log2n, rev, cosT, sinT = newFftTables(M)
    self.log2n, self.rev, self.cosT, self.sinT = log2n, rev, cosT, sinT

    local hRe = table.create(P * bins, 0)
    local hIm = table.create(P * bins, 0)
    local re, im = self.re, self.im
    local h = self.impulseResponse
    for p = 0, P - 1 do
        for i = 1, M do
            re[i] = 0
            im[i] = 0
        end
        for i = 0, B - 1 do
            local idx = p * B + i
            if idx < N then
                re[i + 1] = h[idx + 1]
            end
        end
        fft(re, im, M, rev, cosT, sinT)
        for k = 0, B do
            hRe[p * bins + k + 1] = re[k + 1]
            hIm[p * bins + k + 1] = im[k + 1]
        end
    end
    self.hRe = hRe
    self.hIm = hIm
end

function ConvolutionFilter.getSampleCount(self: ConvolutionFilter): number
    return self.sampleCount
end

function ConvolutionFilter.getImpulseResponse(self: ConvolutionFilter): { number }
    return self.impulseResponse
end

-- Original engine-sim algorithm (O(N) per sample).
local function directF(self: ConvolutionFilter, sample: number): number
    local N = self.sampleCount
    local reg = self.shiftRegister
    local h = self.impulseResponse
    local off = self.shiftOffset

    reg[off + 1] = sample

    local result = 0
    for i = 0, N - off - 1 do
        result += h[i + 1] * reg[i + off + 1]
    end
    local base = N - off
    for i = base, N - 1 do
        result += h[i + 1] * reg[i - base + 1]
    end

    self.shiftOffset = (off - 1 + N) % N
    return result
end

local function processBlock(self: ConvolutionFilter)
    local B = self.blockSize
    local M = self.fftSize
    local P = self.partitions
    local bins = self.bins
    local re, im = self.re, self.im
    local inPrev, inCur = self.inPrev, self.inCur

    -- Spectrum of [previous block | current block]
    for i = 1, B do
        re[i] = inPrev[i]
        im[i] = 0
        re[B + i] = inCur[i]
        im[B + i] = 0
    end
    fft(re, im, M, self.rev, self.cosT, self.sinT)

    -- Push into the frequency-domain delay line
    local head = self.xHead - 1
    if head < 0 then
        head = P - 1
    end
    self.xHead = head
    local xRe, xIm = self.xRe, self.xIm
    local base = head * bins
    for k = 1, bins do
        xRe[base + k] = re[k]
        xIm[base + k] = im[k]
    end

    -- Accumulate sum_p X[k - p] * H[p]
    local accRe, accIm = self.accRe, self.accIm
    local hRe, hIm = self.hRe, self.hIm
    for k = 1, bins do
        accRe[k] = 0
        accIm[k] = 0
    end
    for p = 0, P - 1 do
        local slot = head + p
        if slot >= P then
            slot -= P
        end
        local xb = slot * bins
        local hb = p * bins
        for k = 1, bins do
            local ar = xRe[xb + k]
            local ai = xIm[xb + k]
            local br = hRe[hb + k]
            local bi = hIm[hb + k]
            accRe[k] += ar * br - ai * bi
            accIm[k] += ar * bi + ai * br
        end
    end

    -- Inverse FFT via conj(FFT(conj(X))) / M, rebuilding the Hermitian half
    re[1] = accRe[1]
    im[1] = -accIm[1]
    for k = 1, B - 1 do
        re[k + 1] = accRe[k + 1]
        im[k + 1] = -accIm[k + 1]
        re[M - k + 1] = accRe[k + 1]
        im[M - k + 1] = accIm[k + 1]
    end
    re[B + 1] = accRe[B + 1]
    im[B + 1] = -accIm[B + 1]
    fft(re, im, M, self.rev, self.cosT, self.sinT)

    -- Overlap-save: keep the last B outputs
    local out = self.outBlock
    local inv = 1 / M
    for i = 1, B do
        out[i] = re[B + i] * inv
    end

    -- current block becomes previous
    self.inPrev, self.inCur = inCur, inPrev
end

-- Returns (wet, dryAlignedWithWet).
function ConvolutionFilter.f(self: ConvolutionFilter, sample: number): (number, number)
    if self.direct then
        if self.sampleCount == 0 then
            return 0, sample
        end
        return directF(self, sample), sample
    end

    local pos = self.pos + 1
    local wet = self.outBlock[pos]
    local dry = self.inPrev[pos]
    self.inCur[pos] = sample

    if pos >= self.blockSize then
        processBlock(self)
        pos = 0
    end
    self.pos = pos

    return wet, dry
end

-- Latency (in samples) this filter adds relative to engine-sim.
function ConvolutionFilter.getLatency(self: ConvolutionFilter): number
    return if self.direct then 0 else self.blockSize
end

return ConvolutionFilter
