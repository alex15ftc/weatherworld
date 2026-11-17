--!strict
--!native
-- Procedural tire noise for one wheel, rendered at 48 kHz into its own
-- AudioStreamWriter (CarAudio plays it from an AudioEmitter on that wheel's hub).
--
-- Driven by the same contact state as the tire forces and the skid marks:
--   roar    tread / road noise. Band-passed noise whose centre rises with road
--           speed and whose level goes ~ speed^1.5 (about +9 dB per doubling,
--           as measured tire/road noise does), a little louder under load.
--   squeal  stick-slip of the tread on a hard surface past the peak of the
--           tire curve (combined slip s > ~0.9): a tone with harmonics,
--           jittered and chattering, plus a narrow band of noise around it.
--           Its pitch follows the tire's speed (the faster the tread moves
--           over the road, the higher the stick-slip rate): ~0.5 kHz near
--           standstill, ~0.9 kHz at 30 m/s, ~1.3 kHz at 60 m/s. Louder and a
--           little higher still as the tire slides further past the peak.
--   scrub   broadband hiss of the patch sliding near the limit (understeer
--           scrub, wheelspin on the way up to a full squeal).
--   crunch  on loose surfaces (grass, dirt, sand, gravel, snow) there is no
--           squeal: instead sparse grit impacts that thicken with speed and a
--           low rumble, louder when sliding.
-- Levels ramp linearly across each block so changes never click.

local TireAudio = {}
TireAudio.__index = TireAudio

local SAMPLE_RATE = 48000
local TAU = 2 * math.pi
local sin = math.sin
local random = math.random
local min = math.min
local max = math.max
local clamp = math.clamp
local exp = math.exp

local MAX_BLOCK = 4096

-- Squeal pitch vs tire speed (m/s): baseHz * (MIN + SLOPE * speed), the
-- speed capped at MAX_SPEED
local SQUEAL_PITCH_MIN = 0.6
local SQUEAL_PITCH_SLOPE = 0.5 / 30
local SQUEAL_PITCH_MAX_SPEED = 75

export type Surface = "Hard" | "Rough" | "Loose" | "Ice"

local SURFACES: { [Enum.Material]: Surface } = {
	[Enum.Material.Cobblestone] = "Rough",
	[Enum.Material.Brick] = "Rough",
	[Enum.Material.Rock] = "Rough",
	[Enum.Material.Slate] = "Rough",
	[Enum.Material.Basalt] = "Rough",
	[Enum.Material.Granite] = "Rough",
	[Enum.Material.DiamondPlate] = "Rough",
	[Enum.Material.WoodPlanks] = "Rough",
	[Enum.Material.Grass] = "Loose",
	[Enum.Material.LeafyGrass] = "Loose",
	[Enum.Material.Ground] = "Loose",
	[Enum.Material.Mud] = "Loose",
	[Enum.Material.Sand] = "Loose",
	[Enum.Material.Salt] = "Loose",
	[Enum.Material.Snow] = "Loose",
	[Enum.Material.Sandstone] = "Loose",
	[Enum.Material.Pebble] = "Loose",
	[Enum.Material.Ice] = "Ice",
	[Enum.Material.Glacier] = "Ice",
}

function TireAudio.surfaceOf(material: Enum.Material): Surface
	return SURFACES[material] or "Hard"
end

-- What the tire is doing this frame.
export type Contact = {
	grounded: boolean,
	speed: number, -- m/s, road speed of the contact patch along the wheel
	slip: number, -- combined slip, 1 = at the peak of the tire curve
	slide: number, -- m/s the patch is sliding over the ground
	wheelSpeed: number?, -- m/s, tread surface speed (|omega| * radius); default |speed|
	load: number, -- vertical load / nominal load
	surface: Surface,
}

-- Chamberlin state-variable filter (band-pass and low-pass outputs)
type Svf = { low: number, band: number }

local function svfCoef(fc: number): number
	return 2 * sin(math.pi * min(fc, SAMPLE_RATE * 0.16) / SAMPLE_RATE)
end

export type TireAudio = typeof(setmetatable({} :: {
	writer: AudioStreamWriter,
	scratch: buffer,
	-- per-block targets and the values the last block ended on
	roar: number,
	squeal: number,
	scrub: number,
	crunch: number,
	roarFc: number,
	squealHz: number,
	grit: number, -- grit impacts per second
	-- oscillator / filter state
	phase: number,
	baseHz: number, -- this tire's squeal pitch (tires differ slightly)
	jitter: number,
	chatter: number,
	roarSvf: Svf,
	squealSvf: Svf,
	scrubSvf: Svf,
	rumble: number,
	gritEnv: number,
	gritSvf: Svf,
}, TireAudio))

function TireAudio.new(writer: AudioStreamWriter, seed: number): TireAudio
	return setmetatable({
		writer = writer,
		scratch = buffer.create(MAX_BLOCK * 4),
		roar = 0,
		squeal = 0,
		scrub = 0,
		crunch = 0,
		roarFc = 300,
		squealHz = 500,
		grit = 0,
		phase = 0,
		baseHz = 760 + 90 * ((seed * 0.618034) % 1),
		jitter = 0,
		chatter = 0,
		roarSvf = { low = 0, band = 0 },
		squealSvf = { low = 0, band = 0 },
		scrubSvf = { low = 0, band = 0 },
		rumble = 0,
		gritEnv = 0,
		gritSvf = { low = 0, band = 0 },
	}, TireAudio)
end

local function smoothstep(e0: number, e1: number, x: number): number
	local t = clamp((x - e0) / (e1 - e0), 0, 1)
	return t * t * (3 - 2 * t)
end

-- Levels the next block ramps to, from the contact state.
local function targets(self: TireAudio, c: Contact): (number, number, number, number, number, number, number)
	if not c.grounded then
		return 0, 0, 0, 0, self.roarFc, self.squealHz, 0
	end
	local v = math.abs(c.speed)
	local load = clamp(c.load, 0, 2.5)
	local loadGain = 0.65 + 0.35 * math.sqrt(load)
	local slipping = smoothstep(0.9, 1.7, c.slip) * clamp(c.slide / 2.5, 0, 1)
	local nearLimit = smoothstep(0.55, 1.0, c.slip) * clamp(c.slide / 4, 0, 1)

	local roar = 0.22 * min((v / 30) ^ 1.5, 2.2) * loadGain
	local roarFc = 220 + 22 * v
	local squeal, scrub, crunch, grit = 0, 0, 0, 0
	-- tire speed: the tread's own speed, or the sliding speed when that is
	-- higher (a locked wheel still squeals at the speed it slides)
	local tireSpeed = max(c.wheelSpeed or v, c.slide)
	local squealHz = self.baseHz
		* (SQUEAL_PITCH_MIN + SQUEAL_PITCH_SLOPE * min(tireSpeed, SQUEAL_PITCH_MAX_SPEED))
		* (1 + 0.08 * clamp(c.slip - 1, 0, 1.5))

	local s = c.surface
	if s == "Hard" or s == "Rough" then
		squeal = 0.5 * slipping * loadGain
		scrub = 0.2 * nearLimit * loadGain
		if s == "Rough" then
			roar *= 1.6
			roarFc *= 0.75
			squeal *= 0.6 -- broken surface: less of a clean tone
			scrub *= 1.5
		end
	elseif s == "Loose" then
		roar *= 0.6
		crunch = 0.10 * min(v / 15, 1.5) + 0.25 * nearLimit
		grit = 25 + 18 * v + 300 * nearLimit
		scrub = 0.10 * nearLimit
	else -- Ice: little to hear but a faint hiss when sliding
		roar *= 0.4
		scrub = 0.04 * nearLimit
	end
	return roar, squeal, scrub, crunch, roarFc, squealHz, grit
end

-- Renders as many frames as the writer has room for. Returns frames written.
function TireAudio.render(self: TireAudio, contact: Contact, volume: number): number
	local writer = self.writer
	local frames = min(writer:Space(), MAX_BLOCK)
	if frames <= 0 then
		return 0
	end

	local roarT, squealT, scrubT, crunchT, fcT, hzT, gritT = targets(self, contact)
	roarT *= volume
	squealT *= volume
	scrubT *= volume
	crunchT *= volume

	local inv = 1 / frames
	local roar, dRoar = self.roar, (roarT - self.roar) * inv
	local squeal, dSqueal = self.squeal, (squealT - self.squeal) * inv
	local scrub, dScrub = self.scrub, (scrubT - self.scrub) * inv
	local crunch, dCrunch = self.crunch, (crunchT - self.crunch) * inv

	-- filter / oscillator settings are per block (they move slowly)
	local roarF = svfCoef(0.5 * (self.roarFc + fcT))
	local roarQ = 1.3 -- damping: broad band
	local squealHz = 0.5 * (self.squealHz + hzT)
	local squealF = svfCoef(squealHz)
	local squealQ = 0.08 -- narrow
	local scrubF = svfCoef(2600)
	local gritF = svfCoef(3200)
	local gritP = 0.5 * (self.grit + gritT) / SAMPLE_RATE
	local gritDecay = exp(-1 / (0.0025 * SAMPLE_RATE))
	local rumbleK = 1 - exp(-TAU * 90 / SAMPLE_RATE)
	local jitterK = 1 - exp(-TAU * 12 / SAMPLE_RATE)
	local chatterK = 1 - exp(-TAU * 30 / SAMPLE_RATE)

	local rs, ss, cs, gs = self.roarSvf, self.squealSvf, self.scrubSvf, self.gritSvf
	local rLow, rBand = rs.low, rs.band
	local sLow, sBand = ss.low, ss.band
	local cLow, cBand = cs.low, cs.band
	local gLow, gBand = gs.low, gs.band
	local rumble, gritEnv = self.rumble, self.gritEnv
	local phase, jitter, chatter = self.phase, self.jitter, self.chatter
	local dPhase = TAU * squealHz / SAMPLE_RATE

	local out = self.scratch
	local anyTone = squeal > 1e-5 or squealT > 1e-5
	local anyNoise = roar > 1e-5 or roarT > 1e-5 or scrub > 1e-5 or scrubT > 1e-5
	local anyCrunch = crunch > 1e-5 or crunchT > 1e-5

	for i = 0, frames - 1 do
		roar += dRoar
		squeal += dSqueal
		scrub += dScrub
		crunch += dCrunch
		local y = 0

		if anyNoise or anyCrunch then
			rumble += ((2 * random() - 1) - rumble) * rumbleK
		end

		if anyNoise then
			local n = 2 * random() - 1
			-- roar: band-passed noise + a low rumble
			rLow += roarF * rBand
			local rHigh = n - rLow - roarQ * rBand
			rBand += roarF * rHigh
			y += roar * (rBand + 1.5 * rumble)
			-- scrub: band of hiss around 2.6 kHz
			cLow += scrubF * cBand
			local cHigh = n - cLow - 1.0 * cBand
			cBand += scrubF * cHigh
			y += scrub * cBand
		end

		if anyTone then
			local n = 2 * random() - 1
			-- pitch jitter (+-3%) and stick-slip chatter (amplitude flutter)
			jitter += (n - jitter) * jitterK
			chatter += ((2 * random() - 1) - chatter) * chatterK
			phase += dPhase * (1 + 0.6 * jitter)
			if phase > TAU then
				phase -= TAU
			end
			local tone = sin(phase) + 0.45 * sin(2 * phase + 0.4) + 0.2 * sin(3 * phase + 1.1)
			-- narrow noise band around the tone
			sLow += squealF * sBand
			local sHigh = n - sLow - squealQ * sBand
			sBand += squealF * sHigh
			local am = clamp(0.75 + 3 * chatter, 0.2, 1.2)
			y += squeal * am * (0.6 * tone + 0.35 * sBand)
		end

		if anyCrunch then
			-- grit: random impacts with a ~2.5 ms decay, through a 3.2 kHz band
			if random() < gritP then
				gritEnv = 0.4 + 0.6 * random()
			end
			gritEnv *= gritDecay
			local n = (2 * random() - 1) * gritEnv
			gLow += gritF * gBand
			local gHigh = n - gLow - 0.8 * gBand
			gBand += gritF * gHigh
			y += crunch * (1.5 * gBand + 0.8 * rumble)
		end

		buffer.writef32(out, i * 4, y)
	end

	rs.low, rs.band = rLow, rBand
	ss.low, ss.band = sLow, sBand
	cs.low, cs.band = cLow, cBand
	gs.low, gs.band = gLow, gBand
	self.rumble, self.gritEnv = rumble, gritEnv
	self.phase, self.jitter, self.chatter = phase, jitter, chatter
	self.roar, self.squeal, self.scrub, self.crunch = roarT, squealT, scrubT, crunchT
	self.roarFc, self.squealHz, self.grit = fcT, hzT, gritT

	local b = out
	if frames < MAX_BLOCK then
		b = buffer.create(frames * 4)
		buffer.copy(b, 0, out, 0, frames * 4)
	end
	local ok, written = pcall(writer.Write, writer, { b })
	if not ok then
		warn("[TireAudio] AudioStreamWriter:Write failed:", written)
		return 0
	end
	return if type(written) == "number" then written else frames
end

return TireAudio
