--!strict
-- A tornado's voice in the Roblox audio graph: plays Acoustics.params from an AudioEmitter.
--
--   Stream   the synth itself (Synth) through an AudioStreamWriter -> Fader -> Emitter. The
--            writer is Studio-only (Roblox docs), so this is the voice in Studio.
--   Loops    the live game's: looped noise assets (Assets) through AudioFilters whose centres and
--            faders follow the same parameters each frame, the churn and gusts applied at the
--            frame rate (they are 0.03-3 Hz), then the air's low-pass -> Fader -> Emitter.
--
-- The emitter's own distance falloff is flat: the level and the air's filtering come from
-- Acoustics (the tornado's true distance in the frame it is drawn in); the emitter only gives the
-- direction (TornadoAudioController places it toward the tornado).

local Acoustics = require(script.Parent.Acoustics)
local Assets = require(script.Parent.Assets)
local Synth = require(script.Parent.Synth)

local Voices = {}

export type Voice = {
	kind: "stream" | "loops",
	folder: Folder,
	emitter: AudioEmitter,
	attachment: Attachment,
	out: AudioFader,
	set: (self: Voice, p: Acoustics.Params, snap: boolean, dt: number) -> (),
	pump: (self: Voice) -> (),
	destroy: (self: Voice) -> (),
	-- (for the debug attributes)
	peak: number,
	underruns: number,
}

local function wire(source: Instance, target: Instance, parent: Instance): Wire
	local w = Instance.new("Wire")
	w.SourceInstance = source
	w.TargetInstance = target
	w.Parent = parent
	return w
end

local function shell(name: string, parent: Instance): (Folder, AudioFader, AudioEmitter, Attachment)
	local folder = Instance.new("Folder")
	folder.Name = name
	local out = Instance.new("AudioFader")
	out.Name = "Out"
	out.Parent = folder
	local attachment = Instance.new("Attachment")
	attachment.Name = name
	attachment.Parent = workspace.Terrain
	local emitter = Instance.new("AudioEmitter")
	emitter.Name = "Emitter"
	emitter:SetDistanceAttenuation({ [0] = 1, [1e6] = 1 })
	emitter.Parent = attachment
	wire(out, emitter, emitter)
	folder.Parent = parent
	return folder, out, emitter, attachment
end

---------------------------------------------------------------------------
-- Stream: the synth (Studio)
---------------------------------------------------------------------------

-- Whether this server can play the synth: AudioStreamWriter exists and is enabled.
function Voices.streamAvailable(): boolean
	local ok, w = pcall(Instance.new, "AudioStreamWriter")
	if not ok then
		return false
	end
	local usable = pcall(function()
		return (w :: AudioStreamWriter):Space()
	end)
	w:Destroy()
	return usable
end

function Voices.stream(name: string, parent: Instance, seed: number): Voice
	local folder, out, emitter, attachment = shell(name, parent)
	local writer = select(2, pcall(Instance.new, "AudioStreamWriter")) :: AudioStreamWriter -- (streamAvailable checked it)
	writer.Name = "Synth"
	pcall(function()
		writer.Layout = Enum.AudioChannelLayout.Mono
	end)
	pcall(function()
		writer.WindowSize = Enum.AudioWindowSize.Medium
	end)
	writer.Parent = folder
	wire(writer, out, out)

	local synth = Synth.new(seed)
	local pool: { [number]: buffer } = {}
	local poolSize = 0
	local useTable = false
	local self = {
		kind = "stream",
		folder = folder,
		emitter = emitter,
		attachment = attachment,
		out = out,
		peak = 0,
		underruns = 0,
	} :: any

	function self.set(_: Voice, p: Acoustics.Params, snap: boolean, _dt: number)
		Synth.setParams(synth, p :: any, snap)
	end

	function self.pump(v: Voice)
		local space = writer:Space()
		if space <= 0 then
			return
		end
		local buf = pool[space]
		if not buf then
			if poolSize >= 8 then
				table.clear(pool)
				poolSize = 0
			end
			buf = buffer.create(space * 4)
			pool[space] = buf
			poolSize += 1
		end
		v.peak = Synth.render(synth, buf, space)
		-- (the docs give Write "an array of per-channel buffers"; a number array is the fallback,
		-- as EngineSim/StreamOutput found)
		if not useTable then
			local ok = pcall(writer.Write, writer, { buf })
			if ok then
				return
			end
			useTable = true
			warn("[TornadoAudio] AudioStreamWriter:Write refused a buffer; writing number arrays")
		end
		local samples = table.create(space, 0)
		for i = 0, space - 1 do
			samples[i + 1] = buffer.readf32(buf, i * 4)
		end
		writer:Write({ samples :: any })
	end

	function self.destroy(_: Voice)
		folder:Destroy()
		attachment:Destroy()
	end

	return self :: Voice
end

---------------------------------------------------------------------------
-- Loops: noise assets through filters (live servers)
---------------------------------------------------------------------------

function Voices.loopsAvailable(): boolean
	return Assets.Noise ~= nil and Assets.Brown ~= nil and Assets.Debris ~= nil
end

local function player(id: string, parent: Instance, offset: number): AudioPlayer
	local p = Instance.new("AudioPlayer")
	p.Asset = id
	p.Looping = true
	p.Parent = parent
	-- (each voice starts its loops at its own place, so two tornadoes don't play the same noise)
	pcall(function()
		p.TimePosition = offset
	end)
	p:Play()
	return p
end

local function filter(kind: Enum.AudioFilterType, name: string, parent: Instance): AudioFilter
	local f = Instance.new("AudioFilter")
	f.Name = name
	f.FilterType = kind
	f.Parent = parent
	return f
end

local function fader(name: string, parent: Instance): AudioFader
	local f = Instance.new("AudioFader")
	f.Name = name
	f.Volume = 0
	f.Parent = parent
	return f
end

-- (the loops are normalised to -1 dBFS: white noise ~0.51 RMS; a band of it keeps
-- sqrt(pi f / (q 48 kHz)) of that: the faders put it back, as Synth does)
local function bandGain(hz: number, q: number): number
	return 1 / (0.51 * math.sqrt(math.pi * hz / (q * 48000)))
end

function Voices.loops(name: string, parent: Instance, seed: number): Voice
	local folder, out, emitter, attachment = shell(name, parent)
	local rng = Random.new(seed)
	local noise = player(Assets.Noise :: string, folder, rng:NextNumber(0, 12))
	local brown = player(Assets.Brown :: string, folder, rng:NextNumber(0, 12))
	local debris = player(Assets.Debris :: string, folder, rng:NextNumber(0, 12))

	local mix = fader("Mix", folder)
	local air1 = filter(Enum.AudioFilterType.Lowpass24dB, "Air", folder)
	wire(mix, air1, air1)
	wire(air1, out, out)

	local rumbleF = filter(Enum.AudioFilterType.Bandpass, "Rumble", folder)
	local roarF = filter(Enum.AudioFilterType.Bandpass, "Roar", folder)
	local hissF = filter(Enum.AudioFilterType.Bandpass, "Hiss", folder)
	local rumbleV, roarV, hissV, debrisV = fader("RumbleLevel", folder), fader("RoarLevel", folder), fader("HissLevel", folder), fader("DebrisLevel", folder)
	wire(brown, rumbleF, rumbleF)
	wire(noise, roarF, roarF)
	wire(noise, hissF, hissF)
	wire(rumbleF, rumbleV, rumbleV)
	wire(roarF, roarV, roarV)
	wire(hissF, hissV, hissV)
	wire(debris, debrisV, debrisV)
	for _, v in { rumbleV, roarV, hissV, debrisV } do
		wire(v, mix, mix)
	end

	local t, ph1, ph2 = rng:NextNumber(0, 100), 0, 0
	local hissEnv = 0
	local self = {
		kind = "loops",
		folder = folder,
		emitter = emitter,
		attachment = attachment,
		out = out,
		peak = 0,
		underruns = 0,
	} :: any

	function self.set(_: Voice, p: Acoustics.Params, _snap: boolean, dt: number)
		t += dt * p.gustHz
		local g = math.clamp(math.noise(t, seed % 97) * 2, -1, 1)
		local surge = math.max(math.noise(t * 4, seed % 89 + 0.5) * 2 + 0.3, 0)
		hissEnv += (surge - hissEnv) * (1 - math.exp(-dt / (if surge > hissEnv then 0.05 else 0.6)))
		ph1 = (ph1 + p.churnHz * dt) % 1
		ph2 = (ph2 + p.subHz * dt) % 1
		local churn = (1 - p.churnDepth * (0.5 + 0.5 * math.sin(2 * math.pi * ph1)))
			* (1 - p.subDepth * (0.5 + 0.5 * math.sin(2 * math.pi * ph2)))

		rumbleF.Frequency = math.clamp(p.rumbleHz * 1.6, 20, 22000) -- (between the synth's two bands)
		rumbleF.Q = 0.9
		local roarHz = p.roarHz * (1 + 0.35 * g)
		roarF.Frequency = math.clamp(roarHz, 20, 22000)
		roarF.Q = 0.9
		local hissHz = p.hissHz * (1 + 0.25 * g)
		hissF.Frequency = math.clamp(hissHz, 20, 22000)
		hissF.Q = 0.7
		air1.Frequency = math.clamp(p.airHz, 20, 22000)

		-- (brown noise is mostly below 100 Hz already: its loop needs little lift)
		rumbleV.Volume = math.clamp(p.rumbleLevel * 0.3 * 2.5, 0, 3)
		roarV.Volume = math.clamp(p.roarLevel * 0.22 * (0.8 + 0.3 * g) * bandGain(roarHz, 0.9), 0, 3)
		hissV.Volume = math.clamp(p.hissLevel * 0.12 * (0.45 + 1.1 * hissEnv) * bandGain(hissHz, 0.7), 0, 3)
		debrisV.Volume = math.clamp(p.debrisLevel * 0.6 * math.sqrt(p.debrisRate / Acoustics.DEBRIS_RATE), 0, 3)
		mix.Volume = math.clamp(p.gain * churn, 0, 3)
	end

	function self.pump(_: Voice) end

	function self.destroy(_: Voice)
		folder:Destroy()
		attachment:Destroy()
	end

	return self :: Voice
end

return Voices
