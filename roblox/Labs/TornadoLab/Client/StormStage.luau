--!strict
-- Storm mode (key N): the whole storm in the lab. The engine's storm replay
-- (ReplicatedStorage.StormReplay, from scripts/export-storm-replay.mjs) plays through the game's
-- own storm renderer (GameClient.StormView, with its SkyLight), with the replay's tornado
-- touchdown at the lab's origin, so the same cameras, shots and metrics work on storms.
--
--   N        storm mode on / off (off: the lab tornado and its lighting come back)
--   , .      a frame back / forward (frames are 25 s apart at 1x)
--   /        speed: paused, 1x, 10x, 40x
--   ; '      the time of day an hour earlier / later (the replay's clock shifted: light only)
--   I        storm clouds as puffs (particles) or shells (meshes): Config.STORM_MESH.style
--   =        hide one layer at a time (none, old renderer, shells, cloud puffs, rain shafts,
--            camera rain): to find which layer makes what
--   chaser camera: centred on the replay's tornado storm (its updraft, or its tornado once down)
local HttpService = game:GetService("HttpService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Workspace = game:GetService("Workspace")

local StormStage = {}

local SPEEDS = { 0, 1, 10, 40 }

type Stage = {
	on: boolean,
	frames: { any },
	meta: any,
	at: number, -- the replay clock (ms, on the frames' atMs)
	speed: number, -- index into SPEEDS
	track: any,
	view: any,
	window: number, -- the first frame handed to the track
	ground: { { part: BasePart, home: Vector3 } },
	groundAt: Vector3,
	focus: Vector3,
	km: number,
	origin: { x: number, y: number },
}

local stage: Stage? = nil

-- The replays (key 0 steps through them): the tornado day, and a squall-line day.
local REPLAYS = { "StormReplay", "StormReplayLine" }
local replayIndex = 1

-- Reads a replay's frames; positions moved so its focus sits at the lab's origin (the origin is
-- fixed by the first replay: the world config reads it once).
local function readFrames(name: string, origin: { x: number, y: number }?): ({ any }?, any)
	local replay = ReplicatedStorage:FindFirstChild(name)
	if not replay then
		warn("[StormStage] no ReplicatedStorage." .. name)
		return nil, nil
	end
	local meta = require(replay:WaitForChild("Meta") :: ModuleScript) :: any
	local frames = {}
	for i = 1, meta.frames do
		local module = replay:WaitForChild(string.format("F%03d", i)) :: ModuleScript
		frames[i] = HttpService:JSONDecode(require(module) :: any)
	end
	if origin then
		local dx, dy = meta.focusMiles.x * 1.609344 - origin.x, meta.focusMiles.y * 1.609344 - origin.y
		local function shift(t: any)
			for k, v in t do
				if k == "xKm" and type(v) == "number" then
					t[k] = v - dx
				elseif k == "yKm" and type(v) == "number" then
					t[k] = v - dy
				elseif type(v) == "table" then
					shift(v)
				end
			end
		end
		for _, f in frames do
			shift(f.storms)
		end
	end
	return frames, meta
end

function StormStage.nextReplay()
	local s = stage
	if not s or not s.on then
		return
	end
	replayIndex = replayIndex % #REPLAYS + 1
	local frames, meta = readFrames(REPLAYS[replayIndex], s.origin)
	if not frames then
		return
	end
	s.frames, s.meta = frames, meta
	s.at = frames[math.max(1, meta.tornado.touchdownFrame - 3)].atMs
	s.window = -1
	print(string.format("[StormStage] replay %s (seed %s, %d frames, focus storm %s)", REPLAYS[replayIndex], tostring(meta.seed), meta.frames, meta.tornado.stormId))
end

local function load(): Stage?
	local replay = ReplicatedStorage:FindFirstChild("StormReplay")
	if not replay then
		warn("[StormStage] no ReplicatedStorage.StormReplay (map src/worlddata/StormReplay in tornadolab.project.json)")
		return nil
	end
	local meta = require(replay:WaitForChild("Meta") :: ModuleScript) :: any
	local frames = {}
	for i = 1, meta.frames do
		local module = replay:WaitForChild(string.format("F%03d", i)) :: ModuleScript
		frames[i] = HttpService:JSONDecode(require(module) :: any)
	end
	-- The touchdown at stud (0, 0): set before the world config loads (it reads it then).
	ReplicatedStorage:SetAttribute("ViewOriginMiles", Vector2.new(meta.focusMiles.x, meta.focusMiles.y))
	local WorldConfig = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("World"):WaitForChild("Config")) :: any
	local origin = WorldConfig.VIEW_ORIGIN_KM
	local StormTrack = require(ReplicatedStorage.Shared.Weather.StormTrack) :: any
	local StormView = require(ReplicatedStorage:WaitForChild("GameClient"):WaitForChild("StormView")) :: any
	local ground = {}
	local labGround = Workspace:FindFirstChild("LabGround")
	if labGround then
		for _, p in labGround:GetChildren() do
			if p:IsA("BasePart") then
				table.insert(ground, { part = p, home = p.Position })
			end
		end
	end
	local s: Stage = {
		on = false,
		frames = frames,
		meta = meta,
		at = frames[math.max(1, meta.tornado.touchdownFrame - 3)].atMs,
		speed = 2,
		track = StormTrack.new(),
		view = StormView,
		window = -1,
		ground = ground,
		groundAt = Vector3.zero,
		focus = Vector3.zero,
		km = WorldConfig.STUDS_PER_MILE / WorldConfig.KM_PER_MILE,
		origin = origin,
	}
	StormView.start({
		track = s.track,
		nowMs = function()
			return s.at
		end,
	})
	StormView.setRunning(false)
	print(string.format("[StormStage] replay of seed %s: %d frames, %s mph tornado (storm %s) at frame %d",
		tostring(meta.seed), meta.frames, tostring(meta.tornado.peakMph), meta.tornado.stormId, meta.tornado.touchdownFrame))
	return s
end

local function frameIndex(s: Stage): number
	local i = 1
	for k, f in s.frames do
		if f.atMs <= s.at then
			i = k
		end
	end
	return i
end

-- The track holds a few frames round the replay clock (it keeps 16); a jump hands it a new set.
local function feed(s: Stage)
	local i = frameIndex(s)
	local first = math.max(1, i - 2)
	if first ~= s.window then
		s.window = first
		local give = {}
		for k = first, math.min(#s.frames, first + 10) do
			table.insert(give, s.frames[k])
		end
		s.track:add(give, true, 1)
	end
end

function StormStage.isOn(): boolean
	return stage ~= nil and (stage :: Stage).on
end

function StormStage.toggle(): boolean
	if not stage then
		stage = load()
	end
	local s = stage
	if not s then
		return false
	end
	s.on = not s.on
	s.view.setRunning(s.on)
	if not s.on then
		for _, g in s.ground do
			g.part.Position = g.home
		end
		s.groundAt = Vector3.zero
	end
	print("[StormStage] storm mode: " .. tostring(s.on))
	return s.on
end

function StormStage.step(frames: number)
	local s = stage
	if not s or not s.on then
		return
	end
	local i = math.clamp(frameIndex(s) + frames, 1, #s.frames)
	s.at = s.frames[i].atMs
	print(string.format("[StormStage] frame %d/%d", i, #s.frames))
end

-- Shows one frame, paused (the shot list).
function StormStage.setFrame(i: number)
	local s = stage
	if not s or not s.on then
		return
	end
	s.at = s.frames[math.clamp(i, 1, #s.frames)].atMs
	s.speed = 1
end

-- Shifts the replay's time of day (every frame's simHourUtc), to see a storm in other light.
local hourShift = 0
function StormStage.shiftHour(hours: number)
	local s = stage
	if not s or not s.on then
		return
	end
	hourShift += hours
	for _, f in s.frames do
		f.simHourUtc += hours
	end
	print(string.format("[StormStage] time of day %+d h (frame hour %.1f UTC)", hours, s.frames[1].simHourUtc))
end

-- The time of day this many hours from the replay's own.
function StormStage.setHourShift(hours: number)
	StormStage.shiftHour(hours - hourShift)
end

-- Local clock time (hours) at the shown frame: the shift that gives it.
function StormStage.setLocalHour(hour: number)
	local s = stage
	if not s or not s.on then
		return
	end
	local f = s.frames[frameIndex(s)]
	local offset = (f.sky and f.sky.sun and f.sky.sun.utcOffsetHours) or -6
	local unshifted = f.simHourUtc - hourShift + offset -- the replay's own local hour here
	StormStage.setHourShift((hour - unshifted + 12) % 24 - 12)
end

function StormStage.toggleStyle()
	local s = stage
	if not s or not s.on then
		return
	end
	local M = (require(ReplicatedStorage.Shared.World.Config) :: any).STORM_MESH
	M.style = if M.style == "puffs" then "shells" else "puffs"
	print("[StormStage] storm clouds: " .. M.style)
end

-- Layers of the storm renderer, by the names of their folders under workspace.StormView.
local LAYERS = {
	{ name = "none", match = function(_: Instance) return false end },
	{ name = "old renderer", match = function(c: Instance) return c:IsA("Model") end },
	{ name = "shells", match = function(c: Instance) return string.sub(c.Name, 1, 9) == "StormMesh" end },
	{ name = "cloud puffs", match = function(c: Instance) return string.sub(c.Name, 1, 10) == "StormPuffs" end },
	{ name = "rain shafts", match = function(c: Instance) return string.sub(c.Name, 1, 5) == "Rain_" end },
	{ name = "camera rain", match = function(c: Instance) return c.Name == "CameraRain" end },
	{ name = "cloud kit", match = function(c: Instance) return string.sub(c.Name, 1, 9) == "StormKit_" end },
}
local hiddenLayer = 1
function StormStage.cycleHidden()
	-- show again what the last one hid (parts and beams; the renderer turns emitters back on)
	local root = Workspace:FindFirstChild("StormView")
	if root then
		local all = root:GetDescendants()
		if Workspace.CurrentCamera then
			for _, d in Workspace.CurrentCamera:GetDescendants() do
				table.insert(all, d)
			end
		end
		for _, d in all do
			if d:IsA("BasePart") then
				d.LocalTransparencyModifier = 0
			elseif d:IsA("Beam") then
				d.Enabled = true
			elseif d:IsA("ParticleEmitter") and LAYERS[hiddenLayer].name == "cloud puffs" then
				d.Enabled = true
			end
		end
	end
	hiddenLayer = hiddenLayer % #LAYERS + 1
	print("[StormStage] hidden layer: " .. LAYERS[hiddenLayer].name)
end
-- Keeps the chosen layer hidden (every frame: the renderer turns things back on as it goes).
local function hideLayer()
	local root = Workspace:FindFirstChild("StormView")
	if not root or hiddenLayer == 1 then
		return
	end
	local match = LAYERS[hiddenLayer].match
	local children = root:GetChildren()
	-- (the cloud kit's parts are under the camera)
	if Workspace.CurrentCamera then
		for _, c in Workspace.CurrentCamera:GetChildren() do
			table.insert(children, c)
		end
	end
	for _, c in children do
		if match(c) then
			for _, d in c:GetDescendants() do
				if d:IsA("ParticleEmitter") then
					if d.Enabled then
						d.Enabled = false
						d:Clear()
					end
				elseif d:IsA("Beam") then
					d.Enabled = false
				elseif d:IsA("BasePart") then
					d.LocalTransparencyModifier = 1
				end
			end
		end
	end
end

function StormStage.cycleSpeed()
	local s = stage
	if not s or not s.on then
		return
	end
	s.speed = s.speed % #SPEEDS + 1
	print(string.format("[StormStage] speed %dx", SPEEDS[s.speed]))
end

-- The camera yaw (CameraRig: eye at centre + (sin yaw, cos yaw) x distance) that puts the camera
-- ahead of the focus storm's gust front, looking back at its shelf; nil if not known.
function StormStage.shelfYaw(): number?
	local s = stage
	if not s then
		return nil
	end
	for _, st in s.view.storms() do
		if st.id == s.meta.tornado.stormId and st.shelf then
			return (180 - st.shelf.facingDeg + 180) % 360 - 180
		end
	end
	return nil
end

-- Where the chaser camera centres: the tornado storm's tornado, or its updraft.
function StormStage.focus(): Vector3
	local s = stage
	return if s then s.focus else Vector3.zero
end

function StormStage.describe(): string
	local s = stage
	if not s or not s.on then
		return ""
	end
	local i = frameIndex(s)
	local storm = nil
	for _, st in s.view.storms() do
		if st.id == s.meta.tornado.stormId then
			storm = st
		end
	end
	local text = string.format("STORM MODE · frame %d/%d · %dx · %d storms · hidden: %s", i, #s.frames, SPEEDS[s.speed], #s.view.storms(), LAYERS[hiddenLayer].name)
	local SM = (require(ReplicatedStorage:WaitForChild("GameClient"):WaitForChild("StormMesh")) :: any).stats
	text ..= string.format("\nstorm cost: %.1f ms/frame (shading %.1f) · reshape %.0f ms · %d vertices · %d puffs",
		SM.frameMs, SM.shadeMs, SM.reshapeMs, SM.vertices, SM.puffs)
	text ..= string.format(" · rain %.2f, %d shafts", SM.rainIntensity, SM.shafts)
	text ..= string.format(" · at camera %.0f dBZ, hail %.1f in", s.view.stats.dbzHere or 0, s.view.stats.hailHere or 0)
	local KS = (require(ReplicatedStorage:WaitForChild("GameClient"):WaitForChild("StormKit")) :: any).stats
	text ..= string.format("\ncloud kit: %d storms, %d pieces, layout %.1f ms, draw %.2f ms/storm, %d too big (drawn nearer, e.g. %s)", KS.storms, KS.pieces, KS.layoutMs, KS.drawMs, KS.nearer or 0, KS.nearerName or "")
	local VR = (require(ReplicatedStorage:WaitForChild("GameClient"):WaitForChild("VaporRelight")) :: any).stats
	text ..= string.format(" | relit: %d images, %d redraws/s, last redraw %.1f ms %s", VR.images, VR.drawsPerSecond, VR.lastDrawMs, VR.packCheck or "")
	local SV = s.view.stats
	text ..= string.format("\nrenderer %.1f ms/frame (old renderer %.1f, sky light %.1f)", SV.totalMs, SV.oldMs or 0, SV.skyMs)
	-- the light SkyLight set (for matching the reference photos' exposure)
	local L = game:GetService("Lighting")
	local atm = L:FindFirstChildOfClass("Atmosphere")
	local cc = L:FindFirstChildOfClass("ColorCorrectionEffect")
	text ..= string.format("\nlight: clock %.2f · brightness %.2f · exposure %+.2f · outdoor %d,%d,%d · atmosphere %.2f haze %.1f · grade b%.2f c%.2f s%.2f",
		L.ClockTime, L.Brightness, L.ExposureCompensation,
		L.OutdoorAmbient.R * 255, L.OutdoorAmbient.G * 255, L.OutdoorAmbient.B * 255,
		if atm then atm.Density else 0, if atm then atm.Haze else 0,
		if cc then cc.Brightness else 0, if cc then cc.Contrast else 0, if cc then cc.Saturation else 0)
	if storm then
		text ..= string.format("\n%s %s · updraft %.0f m/s, base %.0f m, top %.0f m · wall cloud %.2f · clear slot %.2f · rain %.2f · hail %.1f in%s",
			storm.id, storm.supercellType or storm.mode, storm.updraft.speedMs, storm.updraft.baseM, storm.updraft.topM,
			storm.wallCloud.strength, storm.rearFlank.clearSlot, storm.rain.intensity, storm.hail.sizeInches,
			if storm.tornado then string.format(" · tornado %.0f mph", storm.tornado.windMph or storm.tornado.peakMph or 0) else "")
	end
	return text
end

function StormStage.update(dt: number)
	local s = stage
	if not s or not s.on then
		return
	end
	local last = s.frames[#s.frames].atMs
	s.at = math.min(s.at + dt * 1000 * SPEEDS[s.speed], last)
	hideLayer()
	feed(s)
	-- the camera's centre: the tornado storm as last drawn
	for _, st in s.view.storms() do
		if st.id == s.meta.tornado.stormId then
			local p = if st.tornado then st.tornado else st.updraft
			s.focus = Vector3.new((p.xKm - s.origin.x) * s.km, 0, (p.yKm - s.origin.y) * s.km)
		end
	end
	-- the field follows the camera (in whole tiles), so there is always ground under the storm
	local cam = Workspace.CurrentCamera
	if cam then
		local c = cam.CFrame.Position
		local snap = Vector3.new(math.floor(c.X / 2048 + 0.5) * 2048, 0, math.floor(c.Z / 2048 + 0.5) * 2048)
		if snap ~= s.groundAt then
			s.groundAt = snap
			for _, g in s.ground do
				g.part.Position = g.home + snap
			end
		end
	end
end

return StormStage
