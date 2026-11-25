-- The tornado sound (roblox/Client/Modules/TornadoAudio): the acoustics follow the vortex's
-- fields the way they should, and the synth's output is bounded, deterministic, quieter and
-- duller with distance, and crackles only with debris.
--   lune run tools/tornadoaudio/test_tornado_audio.luau
local Acoustics = require("../../roblox/Client/Modules/TornadoAudio/Acoustics")
local Synth = require("../../roblox/Client/Modules/TornadoAudio/Synth")

local fails = 0
local function check(ok: boolean, what: string)
	if not ok then
		fails += 1
		print("FAIL " .. what)
	end
end

local rope = { vc = 55, rc = 25, debrisLoft = 0.3, subCount = 0, sOrbit = 0 }
local wedge = { vc = 85, rc = 450, debrisLoft = 0.9, subCount = 4, sOrbit = 0.25 }
local weak = { vc = 30, rc = 60, debrisLoft = 0, subCount = 0, sOrbit = 0 }

-- acoustics
do
	local pr, pw = Acoustics.params(rope, 300), Acoustics.params(wedge, 300)
	check(pw.rumbleHz < pr.rumbleHz, `a wedge rumbles deeper ({pw.rumbleHz} vs {pr.rumbleHz} Hz)`)
	check(pw.level > pr.level, "a strong wide tornado is louder at the same distance")
	check(Acoustics.params(weak, 300).level < pr.level, "a weak one is quieter")
	local last = math.huge
	local lastAir = math.huge
	for _, d in { 0, 50, 200, 1000, 3000, 10000 } do
		local p = Acoustics.params(wedge, d)
		check(p.gain <= last, `louder further off at {d} m`)
		check(p.airHz < lastAir, `air corner not falling at {d} m`)
		last, lastAir = p.gain, p.airHz
	end
	check(Acoustics.params(weak, 100).debrisRate == 0, "no debris without loft")
	check(pw.subDepth > pr.subDepth, "sub-vortices deepen the churn")
	local faster = { vc = 80, rc = 25, debrisLoft = 0.3 }
	check(Acoustics.params(faster, 300).hissHz > pr.hissHz, "faster wind, higher hiss")
	check(Acoustics.params(wedge, 0).gain == Acoustics.params(wedge, 0).gain, "finite at the axis")
	local faded = table.clone(wedge)
	faded.fade = 0
	check(Acoustics.params(faded, 100).gain == 0, "a faded entry is silent")
end

-- synth: n seconds of a source at a distance -> rms, peak, high-band share, the samples
local RATE = Synth.RATE
local function render(src: any, d: number, seconds: number, seed: number?): (number, number, number, buffer)
	local s = Synth.new(seed or 7)
	Synth.setParams(s, Acoustics.params(src, d) :: any, true)
	local n = math.floor(seconds * RATE)
	local buf = buffer.create(n * 4)
	Synth.render(s, buf, n)
	local sum, peak, hp, prev = 0, 0, 0, 0
	for i = math.floor(0.3 * RATE), n - 1 do -- (skip the filters' settling)
		local x = buffer.readf32(buf, i * 4)
		sum += x * x
		peak = math.max(peak, math.abs(x))
		local dx = x - prev -- (first difference: weights the highs)
		hp += dx * dx
		prev = x
	end
	local m = n - math.floor(0.3 * RATE)
	return math.sqrt(sum / m), peak, hp / math.max(sum, 1e-12), buf
end

do
	local rmsNear, peakNear, hfNear, a = render(wedge, 150, 2)
	local rmsFar, _, hfFar = render(wedge, 4000, 2)
	check(peakNear <= 1, "bounded")
	check(rmsNear > 0.05, `audible near a wedge (rms {rmsNear})`)
	check(rmsFar < rmsNear, "quieter far away")
	check(hfFar < hfNear * 0.5, `duller far away (high share {hfFar} vs {hfNear})`)
	local _, _, _, b = render(wedge, 150, 2)
	check(buffer.tostring(a) == buffer.tostring(b), "deterministic for a seed")
	for i = 0, buffer.len(a) / 4 - 1 do
		local x = buffer.readf32(a, i * 4)
		if x ~= x then
			check(false, "NaN in the output")
			break
		end
	end
	print(string.format("wedge 150 m rms %.3f peak %.3f | 4 km rms %.4f | high share %.3f -> %.4f", rmsNear, peakNear, rmsFar, hfNear, hfFar))

	-- debris adds the crackle: more high-frequency content close by
	local clean = table.clone(wedge)
	clean.debrisLoft = 0
	local _, _, hfClean = render(clean, 150, 2)
	print(string.format("debris high share %.3f, without %.3f", hfNear, hfClean))
	check(hfNear > hfClean, "debris adds crackle")

	-- cost: seconds of CPU for a second of sound
	local s = Synth.new(3)
	Synth.setParams(s, Acoustics.params(wedge, 100) :: any, true)
	local buf = buffer.create(RATE * 4)
	local t0 = os.clock()
	Synth.render(s, buf, RATE)
	local cost = os.clock() - t0
	print(string.format("cost %.1f ms per second of sound", cost * 1000))
end

if fails == 0 then
	print("tornado audio: all checks pass")
else
	print(`tornado audio: {fails} FAILED`)
	error("failures")
end
