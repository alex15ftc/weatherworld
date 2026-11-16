--!strict
-- Plays a car's sounds from where they come from on the car.
--
-- VehicleService puts an Attachment at each sound source of the model (from
-- VehicleConfig.Sound), tagged with a SoundSource attribute. This hangs an
-- AudioEmitter on each one and wires in the matching stream:
--
--   engine-sim exhaust stream --> ExhaustBus --> Exhaust spread (1/n) --> emitter at each exhaust outlet
--   engine-sim intake stream  --> IntakeBus  --> Intake spread (1/n)  --> emitter at the intake
--   TireAudio (one per wheel) --> Tire_XX writer --> Tire_XX fader      --> emitter on that wheel's hub
--
-- The buses belong to EngineAudioController (State.Audio). While this car has
-- an exhaust emitter, the 2D "bench" path to the speakers is muted, so the
-- engine is heard only from the car, through the camera's AudioListener.
-- Several outlets play the same exhaust stream, each at 1/n, so a quad-tip
-- car is as loud as a single-tip one from a distance but still sounds wider
-- and comes from each side up close.

local Workspace = game:GetService("Workspace")
local SoundService = game:GetService("SoundService")

local TireAudio = require(script.Parent.TireAudio)

local CarAudio = {}
CarAudio.__index = CarAudio

export type Buses = {
	Exhaust: AudioFader,
	Intake: AudioFader,
	Bench: AudioFader, -- 2D path to the speakers, used when no car is playing the engine
}

-- Distance falloff in metres: full volume inside 2 m, with a gentler
-- rolloff so cars carry farther, fading to silence at 480 m.
local FALLOFF_M = { { 0, 1 }, { 2, 1 }, { 4, 0.75 }, { 8, 0.4 }, { 16, 0.2 }, { 32, 0.1 }, { 64, 0.05 }, { 128, 0.025 }, { 256, 0.0125 }, { 384, 0.0083 }, { 480, 0 } }
-- Exhausts are louder behind the car than in front of it
local EXHAUST_ANGLES = { [0] = 1, [60] = 0.9, [120] = 0.7, [180] = 0.55 }

type Source = "Exhaust" | "Intake" | "Tire"

type TireChannel = {
	wheel: string,
	writer: AudioStreamWriter,
	fader: AudioFader,
	synth: TireAudio.TireAudio,
}

export type CarAudio = typeof(setmetatable({} :: {
	model: Model,
	chassis: any,
	buses: Buses,
	folder: Folder,
	metersPerStud: number,
	spread: { [string]: AudioFader }, -- "Exhaust" / "Intake" -> 1/n fader
	counts: { [string]: number },
	emitters: { [Attachment]: AudioEmitter },
	tires: { [string]: TireChannel },
	connections: { RBXScriptConnection },
	tireVolume: number,
}, CarAudio))

local function wire(source: Instance, target: Instance, parent: Instance): Wire
	local w = Instance.new("Wire")
	w.SourceInstance = source
	w.TargetInstance = target
	w.Parent = parent
	return w
end

-- The camera's listener hears the emitters. Roblox makes one by default
-- (SoundService.DefaultListenerLocation); make our own if it is turned off.
local function ensureListener()
	local camera = Workspace.CurrentCamera
	if not camera or camera:FindFirstChildWhichIsA("AudioListener") then
		return
	end
	if SoundService.DefaultListenerLocation ~= Enum.ListenerLocation.None then
		return
	end
	local listener = Instance.new("AudioListener")
	listener.Name = "CarAudioListener"
	listener.Parent = camera
	local out = Instance.new("AudioDeviceOutput")
	out.Parent = listener
	wire(listener, out, listener)
end

function CarAudio.new(model: Model, chassis: any, buses: Buses, metersPerStud: number): CarAudio
	local folder = Instance.new("Folder")
	folder.Name = "CarAudio_" .. model.Name

	local spread: { [string]: AudioFader } = {}
	for _, source in { "Exhaust", "Intake" } do
		local f = Instance.new("AudioFader")
		f.Name = source .. "Spread"
		f.Volume = 0
		f.Parent = folder
		wire((buses :: any)[source], f, f)
		spread[source] = f
	end
	folder.Parent = SoundService

	local self = setmetatable({
		model = model,
		chassis = chassis,
		buses = buses,
		folder = folder,
		metersPerStud = metersPerStud,
		spread = spread,
		counts = { Exhaust = 0, Intake = 0 },
		emitters = {},
		tires = {},
		connections = {},
		tireVolume = 1,
	}, CarAudio)

	ensureListener()
	for _, d in model:GetDescendants() do
		if d:IsA("Attachment") then
			self:_add(d)
		end
	end
	-- attachments that replicate (or stream in) later
	table.insert(self.connections, model.DescendantAdded:Connect(function(d)
		if d:IsA("Attachment") then
			self:_add(d)
		end
	end))
	table.insert(self.connections, model.DescendantRemoving:Connect(function(d)
		if d:IsA("Attachment") then
			self:_remove(d)
		end
	end))
	return self
end

-- Gives an emitter the car's distance falloff (and the exhaust's angle falloff).
-- Shared with the replay ghosts so a replayed car sounds like the real one.
function CarAudio.configureEmitter(e: AudioEmitter, source: string, metersPerStud: number)
	local curve: { [number]: number } = {}
	for _, p in FALLOFF_M do
		curve[p[1] / metersPerStud] = p[2]
	end
	e:SetDistanceAttenuation(curve)
	if source == "Exhaust" then
		e:SetAngleAttenuation(EXHAUST_ANGLES)
	end
end

function CarAudio._newEmitter(self: CarAudio, att: Attachment, source: Source): AudioEmitter
	local e = Instance.new("AudioEmitter")
	e.Name = source .. "Emitter"
	CarAudio.configureEmitter(e, source, self.metersPerStud)
	e.Parent = att
	self.emitters[att] = e
	return e
end

function CarAudio._refreshSpread(self: CarAudio)
	for source, fader in self.spread do
		local n = self.counts[source]
		fader.Volume = if n > 0 then 1 / n else 0
	end
	-- the engine plays in 2D until the car has somewhere to play it from
	self.buses.Bench.Volume = if self.counts.Exhaust > 0 then 0 else 1
end

function CarAudio._add(self: CarAudio, att: Attachment)
	if self.emitters[att] then
		return
	end
	local source = att:GetAttribute("SoundSource")
	if source == "Exhaust" or source == "Intake" then
		local e = self:_newEmitter(att, source :: Source)
		wire(self.spread[source :: string], e, e)
		self.counts[source :: string] += 1
		self:_refreshSpread()
	elseif source == "Tire" then
		local wheel = att:GetAttribute("Wheel")
		if type(wheel) ~= "string" or self.tires[wheel] then
			return
		end
		local ok, writer = pcall(Instance.new, "AudioStreamWriter")
		if not ok then
			return -- Studio-only API
		end
		local w = writer :: AudioStreamWriter
		w.Name = "Tire_" .. wheel
		pcall(function()
			w.Layout = Enum.AudioChannelLayout.Mono
		end)
		w.Parent = self.folder
		local fader = Instance.new("AudioFader")
		fader.Name = "Tire_" .. wheel
		fader.Parent = self.folder
		wire(w, fader, fader)
		local e = self:_newEmitter(att, "Tire")
		wire(fader, e, e)
		local seed = table.find({ "FL", "FR", "RL", "RR" }, wheel) or 1
		self.tires[wheel] = { wheel = wheel, writer = w, fader = fader, synth = TireAudio.new(w, seed) }
	end
end

function CarAudio._remove(self: CarAudio, att: Attachment)
	local e = self.emitters[att]
	if not e then
		return
	end
	self.emitters[att] = nil
	e:Destroy()
	local source = att:GetAttribute("SoundSource")
	if source == "Exhaust" or source == "Intake" then
		self.counts[source :: string] -= 1
		self:_refreshSpread()
	elseif source == "Tire" then
		local wheel = att:GetAttribute("Wheel")
		local t = if type(wheel) == "string" then self.tires[wheel] else nil
		if t then
			t.writer:Destroy()
			t.fader:Destroy()
			self.tires[t.wheel] = nil
		end
	end
end

-- Renders each tire's noise from the chassis' contact state. Call once per
-- frame after the chassis has stepped.
function CarAudio.update(self: CarAudio, volume: number)
	local chassis = self.chassis
	local nominal = chassis.config.Tire.NominalLoad
	for _, c in chassis.corners do
		local t = self.tires[c.wheel.Name]
		if not t then
			continue
		end
		local w = c.wheel
		local slip, slide = chassis:tireSlip(c)
		local grounded = c.contact ~= nil and w.grounded and w.fz > 0
		t.synth:render({
			grounded = grounded,
			speed = w.vx,
			slip = slip,
			slide = slide,
			wheelSpeed = math.abs(w.omega * w.Radius),
			load = if grounded then w.fz / nominal else 0,
			surface = TireAudio.surfaceOf(c.material),
		}, 1)
		t.fader.Volume = volume * self.tireVolume
	end
end

function CarAudio.destroy(self: CarAudio)
	for _, c in self.connections do
		c:Disconnect()
	end
	for _, e in self.emitters do
		e:Destroy()
	end
	table.clear(self.emitters)
	self.folder:Destroy()
	self.buses.Bench.Volume = 1
end

return CarAudio
