--!strict
-- The tornadoes' sound (Modules/TornadoAudio). Each frame it takes the tornadoes as they are drawn
-- (WeatherController's context: the StateAdapter entries, smoothed from the engine's frames or
-- the lab), finds how far the camera is from each one's axis in the frame that tornado is drawn
-- in (LabConfig.fromWorldAbout: the distance the player sees), and gives the loudest
-- MAX_VOICES of them a voice: Acoustics turns the vortex's fields and that distance into the
-- layers, the voice plays them from an emitter toward the tornado.
--   Studio        the synth itself (AudioStreamWriter, Studio-only)
--   live servers  the asset loops (TornadoAudio/Assets), silent until those are uploaded
-- Volume: the player's TornadoVolume setting. Attributes on SoundService.TornadoAudio.<voice>
-- (Distance, Level, Gain, AirHz, Peak) show what each voice is playing.

local ReplicatedFirst = game:GetService("ReplicatedFirst")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local SoundService = game:GetService("SoundService")
local Workspace = game:GetService("Workspace")

local Modules = ReplicatedFirst:WaitForChild("Modules")
local TornadoAudio = Modules:WaitForChild("TornadoAudio")
local Acoustics = require(TornadoAudio:WaitForChild("Acoustics"))
local Voices = require(TornadoAudio:WaitForChild("Voices"))
local Settings = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Settings"))
local Profiler = require(ReplicatedStorage.Shared.Profiler)

local TornadoAudioController = {}

local MAX_VOICES = 2
local EMIT_STUDS = 40 -- (the emitter sits this far toward the tornado: direction only)
local LINGER = 3 -- s a voice keeps after its tornado is gone or quieter than the others (fades)
local AUDIBLE = 1e-3 -- (a level under this needs no voice)

type Slot = { voice: Voices.Voice, id: any, idle: number, params: Acoustics.Params }

local slots: { [any]: Slot } = {}
local mode: "stream" | "loops" | "none" = "none"
local folder: Folder? = nil
local volume = 0.8
local errors = 0
local Weather: any = nil

local function distanceTo(C: any, e: any, cam: Vector3): (number, Vector3)
	local cx, cy, cz = C.fromWorldAbout(cam, e.x, e.y)
	local dx, dy = cx - e.x, cy - e.y
	local up = math.max(cz, 0)
	local foot = C.toWorldAbout(e.x, e.y, 0, e.x, e.y)
	return math.sqrt(dx * dx + dy * dy + up * up), foot
end

local function newVoice(id: any): Voices.Voice?
	local name = "Tornado_" .. tostring(id)
	local seed = (tonumber(id) or #name * 7919) % 1e6 + 1
	if mode == "stream" then
		return Voices.stream(name, folder :: Folder, seed)
	elseif mode == "loops" then
		return Voices.loops(name, folder :: Folder, seed)
	end
	return nil
end

local function step(dt: number)
	Weather = Weather or require(script.Parent.WeatherController) :: any
	local ctx = Weather.context()
	local cam = Workspace.CurrentCamera
	if not ctx or not ctx.tornadoAdapter or not cam then
		return
	end
	local C = ctx.Config
	local camPos = cam.CFrame.Position

	-- every drawn tornado's sound here, loudest first
	local heard = {}
	for id, e in ctx.tornadoAdapter.entries do
		if (e.fade or 0) > 0.01 and e.x then
			local d, foot = distanceTo(C, e, camPos)
			local pr = e.params or {}
			local p = Acoustics.params({
				vc = e.vc or 0, rc = e.rc or 30, debrisLoft = e.debrisLoft, fade = e.fade,
				subCount = pr.subCount, sOrbit = pr.sOrbit,
			}, d)
			if p.level > AUDIBLE then
				table.insert(heard, { id = id, p = p, foot = foot })
			end
		end
	end
	table.sort(heard, function(a, b)
		return a.p.level > b.p.level
	end)

	local kept = {}
	for i = 1, math.min(#heard, MAX_VOICES) do
		local h = heard[i]
		kept[h.id] = true
		local slot = slots[h.id]
		local fresh = false
		if not slot then
			local v = newVoice(h.id)
			if not v then
				return
			end
			slot = { voice = v, id = h.id, idle = 0, params = h.p }
			slots[h.id] = slot
			fresh = true
		end
		slot.idle = 0
		slot.params = h.p
		local p = table.clone(h.p)
		p.gain *= volume
		slot.voice:set(p, fresh, dt)
		local dir = h.foot - camPos
		local mag = dir.Magnitude
		slot.voice.attachment.WorldPosition = camPos + (if mag > 1e-3 then dir / mag * math.min(mag, EMIT_STUDS) else Vector3.zero)
		local f = slot.voice.folder
		f:SetAttribute("Distance", math.floor(p.distance))
		f:SetAttribute("Level", p.level)
		f:SetAttribute("Gain", p.gain)
		f:SetAttribute("AirHz", math.floor(p.airHz))
		f:SetAttribute("Peak", slot.voice.peak)
	end

	-- voices no longer wanted fade out, then go
	for id, slot in slots do
		if not kept[id] then
			slot.idle += dt
			local p = table.clone(slot.params)
			p.gain = 0
			slot.voice:set(p, false, dt)
			if slot.idle > LINGER then
				slot.voice:destroy()
				slots[id] = nil
			end
		end
	end
	for _, slot in slots do
		slot.voice:pump()
	end
end

function TornadoAudioController.Start()
	if RunService:IsStudio() and Voices.streamAvailable() then
		mode = "stream"
	elseif Voices.loopsAvailable() then
		mode = "loops"
	else
		warn("[TornadoAudio] no tornado sound here: AudioStreamWriter is Studio-only and the loop assets (Modules/TornadoAudio/Assets) are not uploaded yet")
		return
	end
	local f = Instance.new("Folder")
	f.Name = "TornadoAudio"
	f:SetAttribute("Mode", mode)
	f.Parent = SoundService
	folder = f

	volume = Settings.GetNumber("TornadoVolume") / 100
	Settings.GetNumberChangedSignal("TornadoVolume"):Connect(function(value: number)
		volume = value / 100
	end)

	RunService.Heartbeat:Connect(function(dt)
		Profiler.Begin("TornadoAudio")
		local ok, err = pcall(step :: any, dt)
		Profiler.End()
		if not ok then
			errors += 1
			if errors <= 5 then
				warn("[TornadoAudio] " .. tostring(err))
			end
		end
	end)
end

return TornadoAudioController
