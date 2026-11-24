--!strict
--!native
-- The tornado's sound, sample by sample (48 kHz mono Float32, AudioStreamWriter's format), from
-- Acoustics.params. Pure Luau (no game services), deterministic for a seed: the game plays it
-- through an AudioStreamWriter (Voices.Stream); tools/tornadoaudio renders it to WAV and bakes
-- the loops the live game's asset voice plays (Voices.Loops).
--
--   rumble   white noise through a band at the rumble frequency and one at 2.2x it, softly
--            saturated (the harmonics carry the "freight train" to small speakers)
--   roar     noise through a band at the mid Strouhal tone, its centre surging with the gusts
--   hiss     noise through a band at the high Strouhal tone, with a fast-attack, slow-decay
--            gust envelope (the rushing "waterfall")
--   churn    the wind layers swell as the core turns and as each sub-vortex passes
--   debris   Poisson impacts: thuds (low-passed bursts), cracks (band-passed bursts) and now and
--            then a metal ring (a decaying tone); each burst's size and length drawn at random
--   air      two cascaded low-passes at the air's corner (24 dB/octave), then the gain and a
--            soft limiter (tanh)
-- Parameters glide (~0.15 s) toward the last setParams, updated every 64 samples.

local Synth = {}

Synth.RATE = 48000
local BLOCK = 64
local GRAINS = 32

local sin, exp, log, tan, sqrt, tanh = math.sin, math.exp, math.log, math.tan, math.sqrt, math.tanh
local PI, TAU = math.pi, 2 * math.pi
local bxor, lshift, rshift = bit32.bxor, bit32.lshift, bit32.rshift

-- Simper's state-variable filter (trapezoidal: stable under fast modulation)
type SVF = { ic1: number, ic2: number, a1: number, a2: number, a3: number, k: number }

local function svf(): SVF
	return { ic1 = 0, ic2 = 0, a1 = 1, a2 = 0, a3 = 0, k = 1 }
end

local function tune(f: SVF, hz: number, q: number)
	local g = tan(PI * math.clamp(hz, 10, Synth.RATE * 0.45) / Synth.RATE)
	local k = 1 / q
	f.k = k
	f.a1 = 1 / (1 + g * (g + k))
	f.a2 = g * f.a1
	f.a3 = g * f.a2
end

-- (returns low-pass, normalised band-pass: unity gain at the centre)
local function step(f: SVF, v0: number): (number, number)
	local ic1, ic2 = f.ic1, f.ic2
	local v3 = v0 - ic2
	local v1 = f.a1 * ic1 + f.a2 * v3
	local v2 = ic2 + f.a2 * ic1 + f.a3 * v3
	f.ic1 = 2 * v1 - ic1
	f.ic2 = 2 * v2 - ic2
	return v2, f.k * v1
end

-- The RMS of unit-variance white noise through a normalised band (centre hz, quality q).
local function bandRms(hz: number, q: number): number
	return sqrt(PI * hz / (q * Synth.RATE))
end

type Grain = { amp: number, decay: number, crack: number, ring: number, ph: number, dph: number }

export type Synth = {
	seed: number,
	rng: number,
	target: { [string]: number },
	cur: { [string]: number },
	-- filters
	r1: SVF,
	r2: SVF,
	mid: SVF,
	hi: SVF,
	thud: SVF,
	crack: SVF,
	air1: SVF,
	air2: SVF,
	-- normalisation of each band (1 / its RMS)
	nR1: number,
	nR2: number,
	nMid: number,
	nHi: number,
	nCrack: number,
	-- modulators
	ph1: number,
	ph2: number,
	gA: number,
	gB: number,
	gT: number,
	gFast: number,
	gFastT: number,
	hissEnv: number,
	untilGrain: number,
	grains: { Grain },
	volume: number,
	peak: number,
}

local KEYS = {
	"gain", "rumbleLevel", "rumbleHz", "roarLevel", "roarHz", "hissLevel", "hissHz", "debrisLevel",
	"debrisRate", "churnHz", "churnDepth", "subHz", "subDepth", "gustHz", "airHz",
}

-- xorshift32: a uniform in [0, 1)
local function rand(s: Synth): number
	local x = s.rng
	x = bxor(x, lshift(x, 13))
	x = bxor(x, rshift(x, 17))
	x = bxor(x, lshift(x, 5))
	s.rng = x
	return x / 4294967296
end

local WHITE = sqrt(3) -- (uniform in [-1, 1) has variance 1/3: scale to unit variance)
local function white(s: Synth): number
	return (rand(s) * 2 - 1) * WHITE
end

function Synth.new(seed: number?): Synth
	local s: Synth = {
		seed = seed or 1,
		rng = (math.floor(seed or 1) % 4294967295) + 1,
		target = {},
		cur = {},
		r1 = svf(), r2 = svf(), mid = svf(), hi = svf(), thud = svf(), crack = svf(), air1 = svf(), air2 = svf(),
		nR1 = 1, nR2 = 1, nMid = 1, nHi = 1, nCrack = 1,
		ph1 = 0, ph2 = 0, gA = 0, gB = 0, gT = 0, gFast = 0, gFastT = 0, hissEnv = 0,
		untilGrain = 0,
		grains = table.create(GRAINS),
		volume = 1,
		peak = 0,
	} :: any
	for i = 1, GRAINS do
		s.grains[i] = { amp = 0, decay = 0, crack = 0, ring = 0, ph = 0, dph = 0 }
	end
	for _, k in KEYS do
		s.target[k] = 0
		s.cur[k] = 0
	end
	s.target.airHz, s.cur.airHz = 15000, 15000
	s.target.rumbleHz, s.cur.rumbleHz = 30, 30
	s.target.roarHz, s.cur.roarHz = 240, 240
	s.target.hissHz, s.cur.hissHz = 1500, 1500
	tune(s.thud, 260, 0.7)
	tune(s.crack, 2400, 0.9)
	s.nCrack = 1 / bandRms(2400, 0.9)
	s.gB = rand(s) * 2 - 1
	return s
end

-- Glide toward these parameters (Acoustics.Params). `snap` jumps to them (a new voice).
function Synth.setParams(s: Synth, p: { [string]: any }, snap: boolean?)
	for _, k in KEYS do
		local v = p[k]
		if type(v) == "number" and v == v then
			s.target[k] = v
			if snap then
				s.cur[k] = v
			end
		end
	end
end

local function spawnGrain(s: Synth)
	for _, g in s.grains do
		if g.amp < 1e-4 then
			-- sizes: log-uniform over ~30 dB; lengths 3-60 ms; a third are cracks, ~1 in 7 rings
			g.amp = exp(-3.4 * rand(s))
			local len = 0.003 * exp(3 * rand(s))
			g.decay = exp(-1 / (len * Synth.RATE))
			g.crack = if rand(s) < 0.35 then 1 else 0
			if rand(s) < 0.14 then
				g.ring = 0.6
				g.decay = exp(-1 / ((0.05 + 0.25 * rand(s)) * Synth.RATE))
				g.ph = 0
				g.dph = TAU * 300 * exp(1.9 * rand(s)) / Synth.RATE
				g.crack = 0
			else
				g.ring = 0
			end
			return
		end
	end
end

-- Moves the current parameters toward the targets and retunes the filters (every BLOCK samples).
local function control(s: Synth)
	local cur, tgt = s.cur, s.target
	local k = 1 - exp(-BLOCK / (0.15 * Synth.RATE))
	for _, key in KEYS do
		cur[key] += (tgt[key] - cur[key]) * k
	end
	-- the gusts: smooth value noise on the gust rate; it moves the band centres
	local g = s.gA + (s.gB - s.gA) * (0.5 - 0.5 * math.cos(PI * s.gT))
	local rHz = cur.rumbleHz
	tune(s.r1, rHz, 1.2)
	tune(s.r2, rHz * 2.2, 1.6)
	s.nR1 = 1 / bandRms(rHz, 1.2)
	s.nR2 = 1 / bandRms(rHz * 2.2, 1.6)
	local mHz = cur.roarHz * (1 + 0.35 * g)
	tune(s.mid, mHz, 0.9)
	s.nMid = 1 / bandRms(mHz, 0.9)
	local hHz = cur.hissHz * (1 + 0.25 * g)
	tune(s.hi, hHz, 0.7)
	s.nHi = 1 / bandRms(hHz, 0.7)
	tune(s.air1, cur.airHz, 0.707)
	tune(s.air2, cur.airHz, 0.707)
	return g
end

-- Renders `frames` samples into `buf` (Float32) from byte offset `offset` (default 0). Returns the
-- block's peak.
function Synth.render(s: Synth, buf: buffer, frames: number, offset: number?): number
	local base = offset or 0
	local cur = s.cur
	local grains = s.grains
	local peak = 0
	local g = 0
	local i = 0
	while i < frames do
		g = control(s)
		local n = math.min(BLOCK, frames - i)
		local fs = Synth.RATE
		-- per-block constants
		local gain = cur.gain * s.volume
		local rumbleL = cur.rumbleLevel * 0.3
		local roarL = cur.roarLevel * 0.22
		local hissL = cur.hissLevel * 0.12
		local debrisL = cur.debrisLevel * 1.2
		local rate = math.max(cur.debrisRate, 0)
		local dGust = math.max(cur.gustHz, 0.05) / fs
		local dFast = 4 * dGust
		local d1, d2 = cur.churnHz / fs, cur.subHz / fs
		local cd, sd = cur.churnDepth, cur.subDepth
		local nR1, nR2, nMid, nHi, nCrack = s.nR1, s.nR2, s.nMid, s.nHi, s.nCrack
		local atk, rel = 1 - exp(-1 / (0.05 * fs)), 1 - exp(-1 / (0.6 * fs))
		for _ = 1, n do
			-- modulators
			s.gT += dGust
			if s.gT >= 1 then
				s.gT -= 1
				s.gA = s.gB
				s.gB = rand(s) * 2 - 1
			end
			s.gFastT += dFast
			if s.gFastT >= 1 then
				s.gFastT -= 1
				s.gFast = rand(s)
			end
			local surge = math.max(s.gFast * (0.6 + 0.4 * g), 0)
			s.hissEnv += (surge - s.hissEnv) * (if surge > s.hissEnv then atk else rel)
			s.ph1 = (s.ph1 + d1) % 1
			s.ph2 = (s.ph2 + d2) % 1
			local churn = (1 - cd * (0.5 + 0.5 * sin(TAU * s.ph1))) * (1 - sd * (0.5 + 0.5 * sin(TAU * s.ph2)))

			-- wind layers
			local _, b1 = step(s.r1, white(s))
			local _, b2 = step(s.r2, white(s))
			local rumble = tanh(1.6 * (b1 * nR1 + 0.5 * b2 * nR2) * 0.5) * 2
			local _, bm = step(s.mid, white(s))
			local _, bh = step(s.hi, white(s))
			local wind = rumble * rumbleL + bm * nMid * roarL * (0.8 + 0.3 * g)
				+ bh * nHi * hissL * (0.45 + 1.1 * s.hissEnv)
			wind *= churn

			-- debris
			local thudE, crackE, ringS = 0, 0, 0
			if rate > 0 then
				s.untilGrain -= 1
				if s.untilGrain <= 0 then
					spawnGrain(s)
					s.untilGrain = -log(1 - rand(s)) * fs / rate
				end
				for _, gr in grains do
					local a = gr.amp
					if a >= 1e-4 then
						if gr.ring > 0 then
							gr.ph += gr.dph
							ringS += a * gr.ring * sin(gr.ph)
						elseif gr.crack > 0 then
							crackE += a
						else
							thudE += a
						end
						gr.amp = a * gr.decay
					end
				end
			elseif s.untilGrain <= 0 then
				s.untilGrain = fs * 0.05
			end
			local lpT = step(s.thud, white(s) * thudE)
			local _, bc = step(s.crack, white(s) * crackE)
			local debris = (lpT * 2.2 + bc * nCrack * 0.45 + ringS * 0.7) * debrisL

			-- the air, the level, the limiter
			local x = step(s.air1, wind + debris)
			x = step(s.air2, x)
			local y = tanh(x * gain)
			buffer.writef32(buf, base + i * 4, y)
			local ay = math.abs(y)
			if ay > peak then
				peak = ay
			end
			i += 1
		end
	end
	s.peak = peak
	return peak
end

return Synth
