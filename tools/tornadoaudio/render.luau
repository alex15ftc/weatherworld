-- Renders the tornado sound offline (roblox/Client/Modules/TornadoAudio) to 16-bit 48 kHz WAVs.
--   lune run tools/tornadoaudio/render.luau [out dir]          (default tools/tornadoaudio/out)
-- Writes:
--   passby_wedge.wav   a wide, debris-laden tornado passing 40 m off, from 3 km and back (90 s)
--   rope_close.wav     a narrow rope 120 m off, then lifting (debris gone, spinning down) (30 s)
--   far_rumble.wav     a strong tornado 6 km off: only the rumble carries (20 s)
--   loop_noise.wav, loop_brown.wav, loop_debris.wav
--                      the seamless loops the live game's asset voice plays (Voices.Loops,
--                      TornadoAudio/Assets): upload them as audio assets and record the ids there.
-- The out dir holds generated audio: keep it out of git (.gitignore).
local fs = require("@lune/fs")
local process = require("@lune/process")
local Acoustics = require("../../roblox/Client/Modules/TornadoAudio/Acoustics")
local Synth = require("../../roblox/Client/Modules/TornadoAudio/Synth")

local RATE = Synth.RATE
local outDir = process.args[1] or "tools/tornadoaudio/out"
if not fs.isDir(outDir) then
	fs.writeDir(outDir)
end

local function writeWav(path: string, samples: buffer, n: number)
	local data = buffer.create(44 + n * 2)
	buffer.writestring(data, 0, "RIFF")
	buffer.writeu32(data, 4, 36 + n * 2)
	buffer.writestring(data, 8, "WAVEfmt ")
	buffer.writeu32(data, 16, 16)
	buffer.writeu16(data, 20, 1) -- PCM
	buffer.writeu16(data, 22, 1) -- mono
	buffer.writeu32(data, 24, RATE)
	buffer.writeu32(data, 28, RATE * 2)
	buffer.writeu16(data, 32, 2)
	buffer.writeu16(data, 34, 16)
	buffer.writestring(data, 36, "data")
	buffer.writeu32(data, 40, n * 2)
	for i = 0, n - 1 do
		local x = math.clamp(buffer.readf32(samples, i * 4), -1, 1)
		buffer.writei16(data, 44 + i * 2, math.round(x * 32767))
	end
	fs.writeFile(path, buffer.tostring(data))
	print(string.format("%s  %.1f s", path, n / RATE))
end

-- A source moving through time: fn(t) -> (source, distance m)
local function scene(name: string, seconds: number, fn: (number) -> (any, number))
	local s = Synth.new(11)
	local n = math.floor(seconds * RATE)
	local out = buffer.create(n * 4)
	local block = 1024
	local first = true
	for i = 0, n - 1, block do
		local src, d = fn(i / RATE)
		Synth.setParams(s, Acoustics.params(src, d) :: any, first)
		first = false
		Synth.render(s, out, math.min(block, n - i), i * 4)
	end
	writeWav(`{outDir}/{name}.wav`, out, n)
end

scene("passby_wedge", 90, function(t)
	-- 3 km -> 40 m at 45 s -> 3 km, along a line 40 m off
	local along = (t - 45) * 66
	return { vc = 85, rc = 420, debrisLoft = 0.9, subCount = 4, sOrbit = 0.25 }, math.sqrt(along * along + 40 * 40)
end)

scene("rope_close", 30, function(t)
	-- lifting from 15 s: the debris goes and the core spins down
	local k = math.clamp((t - 15) / 12, 0, 1)
	return { vc = 60 * (1 - 0.8 * k), rc = 22 + 10 * k, debrisLoft = 0.4 * (1 - k), subCount = 0, sOrbit = 0 }, 120
end)

scene("far_rumble", 20, function()
	return { vc = 90, rc = 600, debrisLoft = 1, subCount = 5, sOrbit = 0.2 }, 6000
end)

-- Loops: L seconds plus a crossfade tail folded onto the head, so the end runs into the start.
local LOOP, FADE = 12, 1
local function loop(name: string, gen: (number) -> number)
	local n, f = LOOP * RATE, FADE * RATE
	local raw = table.create(n + f, 0)
	for i = 1, n + f do
		raw[i] = gen(i)
	end
	local out = buffer.create(n * 4)
	local peak = 0
	for i = 1, n do
		local x = raw[i]
		if i <= f then
			-- equal-power crossfade with the tail
			local a = (i - 1) / f
			x = x * math.sin(a * math.pi / 2) + raw[n + i] * math.cos(a * math.pi / 2)
		end
		raw[i] = x
		peak = math.max(peak, math.abs(x))
	end
	local norm = 0.89 / math.max(peak, 1e-9) -- (-1 dBFS)
	for i = 1, n do
		buffer.writef32(out, (i - 1) * 4, raw[i] * norm)
	end
	writeWav(`{outDir}/{name}.wav`, out, n)
end

local rng = 12345
local function white(): number
	rng = bit32.bxor(rng, bit32.lshift(rng, 13))
	rng = bit32.bxor(rng, bit32.rshift(rng, 17))
	rng = bit32.bxor(rng, bit32.lshift(rng, 5))
	return rng / 2147483648 - 1
end
loop("loop_noise", function()
	return white()
end)
local b = 0
loop("loop_brown", function()
	b = (b + 0.02 * white()) / 1.02
	return b
end)

-- debris: the synth's debris layer alone, open air, at a reference rate
do
	local s = Synth.new(5)
	Synth.setParams(s, {
		gain = 1, rumbleLevel = 0, roarLevel = 0, hissLevel = 0, debrisLevel = 1, debrisRate = 400,
		churnDepth = 0, subDepth = 0, airHz = 16000, gustHz = 0.5,
	}, true)
	local total = (LOOP + FADE) * RATE
	local buf = buffer.create(total * 4)
	Synth.render(s, buf, total)
	local i = 0
	loop("loop_debris", function()
		i += 1
		return buffer.readf32(buf, (i - 1) * 4)
	end)
end
