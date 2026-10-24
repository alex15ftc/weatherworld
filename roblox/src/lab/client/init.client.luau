-- Tornado lab (client): one particle tornado on a flat field under an overcast sky, a camera
-- rig and a debug panel for every Config / LabConfig value.
--
--   H: hide / show the panel (for screenshots)     P: freeze the smoke (still frame)
--   1-9 or [ ]: the tornado looks (Presets.luau)      M: funnel renderer, puff chain <-> rings
--   camera keys: see CameraRig.luau (C free camera); L lifecycle demo, T travel, O orbit the camera,
--   J wind arrows, G test objects in the wind (WindLab.luau),
--   B funnel body: puffs -> beams -> ribbon -> ribbon + puff detail (BeamFunnel.luau, RibbonFunnel.luau)
--   U / Y next / previous capture shot (Shots.luau; reference framings, then the every-angle sweep),
--   K particle range probes,
--   N storm mode: the engine's storm replay through the game's storm renderer (StormStage.luau;
--     , . step frames, / speed)
--   H hide, P freeze, M renderer
local Lighting = game:GetService("Lighting")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local UserInputService = game:GetService("UserInputService")
local Workspace = game:GetService("Workspace")

local TornadoFolder = ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Tornado")
local Config = require(TornadoFolder:WaitForChild("Config"))
local State = require(TornadoFolder:WaitForChild("State"))
local Shape = require(TornadoFolder:WaitForChild("Shape"))
local Vortex = require(TornadoFolder:WaitForChild("Vortex"))
local FunnelView = require(TornadoFolder:WaitForChild("FunnelView"))
local PuffView = require(TornadoFolder:WaitForChild("PuffView"))
local CloudBase = require(TornadoFolder:WaitForChild("CloudBase"))
local StormBase = require(TornadoFolder:WaitForChild("StormBase"))
local RainCurtains = require(TornadoFolder:WaitForChild("RainCurtains"))
local WispSprites = require(TornadoFolder:WaitForChild("WispSprites"))
local DebrisCloud = require(TornadoFolder:WaitForChild("DebrisCloud"))
local SubVortexView = require(TornadoFolder:WaitForChild("SubVortexView"))
local ScourView = require(TornadoFolder:WaitForChild("ScourView"))
local BeamFunnel = require(TornadoFolder:WaitForChild("BeamFunnel"))
local RibbonFunnel = require(TornadoFolder:WaitForChild("RibbonFunnel"))
local DustView = require(TornadoFolder:WaitForChild("DustView"))
local SubStrandView = require(TornadoFolder:WaitForChild("SubStrandView"))

local LabConfig = require(script:WaitForChild("LabConfig"))
local CameraRig = require(script:WaitForChild("CameraRig"))
local DebugPanel = require(script:WaitForChild("DebugPanel"))
local Probes = require(script:WaitForChild("Probes"))
local WindLab = require(script:WaitForChild("WindLab"))
local Shots = require(script:WaitForChild("Shots"))
local Presets = require(script:WaitForChild("Presets"))
local StormStage = require(script:WaitForChild("StormStage"))

-- the starting settings, which every look is applied on top of
local baseConfig = Presets.deepCopy(Config)
local baseLab = Presets.deepCopy(LabConfig)

local player = Players.LocalPlayer

---------------------------------------------------------------- the tornado

local function labState(): State.State
	local T = LabConfig.tornado
	local profile = {
		width = T.width,
		ef = T.ef,
		shape = { rope = T.rope, cone = T.cone, stovepipe = T.stovepipe, wedge = T.wedge, horn = T.horn },
	}
	local s = State.fromProfile(profile, Vector3.zero, T.cloudBase, T.seed)
	s.wobble = T.wobble
	s.kink = T.kink or 0
	s.pulse = T.pulse or 0
	s.bottom = T.bottom or 0
	s.topOffset = Vector3.new(T.leanX, 0, T.leanZ)
	s.bendLow = Vector3.new(T.lowX, 0, T.lowZ)
	s.bendHigh = Vector3.new(T.highX, 0, T.highZ)
	-- the vortex's physics inputs (Vortex / WindField read these): swirl ratio and forward motion
	if (T.swirl or 0) > 0 then
		(s :: any).swirl = T.swirl
	end
	local h = math.rad(Config.stormBase.heading)
	s.velocity = Vector3.new(math.cos(h), 0, -math.sin(h)) * (T.speed or 0) * Config.STUDS_PER_METRE
	return s
end

local state = labState()
local view = FunnelView.new(Workspace)
local puffs = PuffView.new(Workspace)
local cloudBase = CloudBase.new(Workspace)
local stormBase = StormBase.new(Workspace) -- the parent storm's base (mesh tiles), built the lab's way
local rain = RainCurtains.new(Workspace) -- rain under the storm (core + wrap), placed in the storm base's frame
local debrisCloud = DebrisCloud.new(Workspace) -- the dust / debris cloud, derived from the vortex and the ground
local wisps = WispSprites.new(Workspace) -- the Severity wisps: fibrous sprites fraying the funnel and the wall cloud, at any distance
local subs = SubVortexView.new(Workspace)
local scour = ScourView.new(Workspace)
local windLab = WindLab.new(Workspace)
local beams = BeamFunnel.new(Workspace)
local ribbon = RibbonFunnel.new(Workspace)
local dust = DustView.new(Workspace)
local strands = SubStrandView.new(Workspace)
view:setState(state)
puffs:setState(state)
cloudBase:setState(state)
stormBase:setState(state)
rain:setState(state)
subs:setState(state)
scour:setState(state)
-- the lifecycle demo (key L) and camera orbit (key O); see below

-- Key K: particle range probes. A row of red puffs straight ahead at 400 ... 2400 studs, each
-- scaled to look the same size, labelled with its distance (the label is a BillboardGui, which
-- draws at any distance). A label without a red puff = particles aren't drawn that far at the
-- current graphics quality.
local rangeProbes: Folder? = nil
local function toggleRangeProbes()
	if rangeProbes then
		rangeProbes:Destroy()
		rangeProbes = nil
		return
	end
	local folder = Instance.new("Folder")
	folder.Name = "RangeProbes"
	folder.Parent = Workspace
	rangeProbes = folder
	local DISTANCES = { 400, 600, 700, 800, 900, 1000, 1200, 1500, 2000, 2400 }
	for i, d in DISTANCES do
		local p = Instance.new("Part")
		p.Name = "Probe" .. d
		p.Anchored, p.CanCollide, p.CanQuery, p.CanTouch, p.Transparency = true, false, false, false, 1
		p.Size = Vector3.one
		local e = Instance.new("ParticleEmitter")
		e.Texture = "rbxasset://textures/particles/sparkles_main.dds"
		e.Color = ColorSequence.new(Color3.new(1, 0.1, 0.1))
		e.LightEmission = 1
		e.Size = NumberSequence.new(28 * d / 600)
		e.Lifetime = NumberRange.new(4)
		e.Rate = 5
		e.Speed = NumberRange.new(0)
		e.LockedToPart = true
		e.Parent = p
		local gui = Instance.new("BillboardGui")
		gui.AlwaysOnTop = true
		gui.MaxDistance = math.huge
		gui.Size = UDim2.fromOffset(80, 24)
		gui.StudsOffsetWorldSpace = Vector3.new(0, -60 * d / 600, 0)
		local label = Instance.new("TextLabel")
		label.BackgroundTransparency = 1
		label.Size = UDim2.fromScale(1, 1)
		label.Text = tostring(d)
		label.TextColor3 = Color3.new(1, 1, 1)
		label.TextStrokeTransparency = 0
		label.TextScaled = true
		label.Parent = gui
		gui.Parent = p
		p.Parent = folder
		local x = (i - (#DISTANCES + 1) / 2) * 110
		RunService.RenderStepped:Connect(function()
			if p.Parent then
				local cam = Workspace.CurrentCamera
				p.CFrame = cam.CFrame * CFrame.new(x * d / 600, -120 * d / 600, -d)
			end
		end)
	end
	print("[TornadoLab] range probes on: a label with no red puff above it = particles not drawn that far")
end
local lifecycle = { on = false, start = 0, orbit = false, lastApply = 0, travel = false, offset = Vector3.zero }

---------------------------------------------------------------- the sky and the ground

local function ensure(parent: Instance, className: string, name: string): any
	local found = parent:FindFirstChild(name)
	if found and found.ClassName == className then
		return found
	end
	local inst = Instance.new(className)
	inst.Name = name
	inst.Parent = parent
	return inst
end

local function applyLighting()
	local L = LabConfig.lighting
	Lighting.ClockTime = L.clockTime
	Lighting.Brightness = L.brightness
	Lighting.ExposureCompensation = L.exposure
	Lighting.Ambient = L.ambient
	Lighting.OutdoorAmbient = L.outdoorAmbient
	Lighting.EnvironmentDiffuseScale = L.diffuseScale
	Lighting.EnvironmentSpecularScale = L.specularScale
	Lighting.ShadowSoftness = L.shadowSoftness
	Lighting.GeographicLatitude = L.geographicLatitude
	Lighting.GlobalShadows = true

	local A = LabConfig.atmosphere
	local atmosphere = ensure(Lighting, "Atmosphere", "LabAtmosphere")
	atmosphere.Density = A.density
	atmosphere.Offset = A.offset
	atmosphere.Haze = A.haze
	atmosphere.Glare = A.glare
	atmosphere.Color = A.color
	atmosphere.Decay = A.decay

	local C = LabConfig.clouds
	local clouds = ensure(Workspace.Terrain, "Clouds", "LabClouds")
	clouds.Enabled = C.enabled
	clouds.Cover = C.cover
	clouds.Density = C.density
	clouds.Color = C.color

	local CC = LabConfig.colorCorrection
	local cc = ensure(Lighting, "ColorCorrectionEffect", "LabGrade")
	cc.Saturation = CC.saturation
	cc.Contrast = CC.contrast
	cc.Brightness = CC.brightness
	cc.TintColor = CC.tint
end

local deck: Model? = nil
local function buildDeck()
	if deck then
		deck:Destroy()
		deck = nil
	end
	local D = LabConfig.cloudDeck
	if not D.enabled then
		return
	end
	local model = Instance.new("Model")
	model.Name = "LabCloudDeck"
	local n = math.floor(D.radius)
	local y = state.position.Y + state.cloudBase + D.thickness * 0.5
	for i = -n, n do
		for j = -n, n do
			local p = Instance.new("Part")
			p.Anchored = true
			p.CanCollide = false
			p.CanQuery = false
			p.CanTouch = false
			p.Locked = true
			p.Material = Enum.Material.SmoothPlastic
			p.Color = D.color
			p.Size = Vector3.new(2048, D.thickness, 2048)
			p.Position = Vector3.new(i * 2048, y, j * 2048)
			p.Parent = model
		end
	end
	model.Parent = Workspace
	deck = model
end

local function paintGround()
	local ground = Workspace:FindFirstChild("LabGround")
	if ground then
		for _, p in ground:GetChildren() do
			if p:IsA("BasePart") then
				p.Color = LabConfig.ground.color
			end
		end
	end
end

applyLighting()
buildDeck()
task.spawn(function()
	Workspace:WaitForChild("LabGround", 30)
	paintGround()
end)

---------------------------------------------------------------- camera

local cameraRig = CameraRig.start(LabConfig.camera, function()
	if StormStage.isOn() then
		return StormStage.focus()
	end
	-- the storm, not the foot: a rope-out's foot is shoved out from under it
	return state.position + state.topOffset - labState().topOffset
end)

if LabConfig.probes then
	Probes.start(LabConfig.camera)
end

---------------------------------------------------------------- panel

local panel = DebugPanel.new(player:WaitForChild("PlayerGui"))

local function setTornado()
	state = labState()
	state.position += lifecycle.offset
	view:setState(state)
	puffs:setState(state)
	cloudBase:setState(state)
	stormBase:setState(state)
	rain:setState(state)
	subs:setState(state)
	scour:setState(state)
end

local function rangeFrom(tables: { any })
	return function(path: string, key: string, value: number)
		for _, ranges in tables do
			local r = ranges[path]
			if r then
				return r[1], r[2], r[3] or 0.01
			end
		end
		if
			string.match(path, "^layers%.")
			or string.match(path, "^baseLayers%.")
			or string.match(path, "^deckLayers%.")
			or string.match(path, "^footLayers%.")
			or string.match(path, "^shadeLayers%.")
			or string.match(path, "^debrisLayers%.")
			or string.match(path, "^puffLayers%.")
			or string.match(path, "^cloudBaseLayers%.")
		then
			local r = Config.RANGES["layer." .. key]
			if r then
				return r[1], r[2], r[3] or 0.01
			end
		end
		return DebugPanel.guessRange(value)
	end
end
local range = rangeFrom({ LabConfig.RANGES, Config.RANGES })

-- Config tables in Luau form, for pasting back into Config.luau / LabConfig.luau.
local function serialise(v: any, indent: string): string
	local kind = typeof(v)
	if kind == "number" then
		return (string.format("%.4g", v))
	elseif kind == "string" then
		return string.format("%q", v)
	elseif kind == "boolean" then
		return tostring(v)
	elseif kind == "Color3" then
		return string.format("Color3.fromRGB(%d, %d, %d)", math.floor(v.R * 255 + 0.5), math.floor(v.G * 255 + 0.5), math.floor(v.B * 255 + 0.5))
	elseif kind == "table" then
		local keys = {}
		for k in v do
			table.insert(keys, k)
		end
		table.sort(keys, function(a, b)
			if typeof(a) ~= typeof(b) then
				return typeof(a) == "number"
			end
			return a < b
		end)
		local inner = indent .. "\t"
		local parts = {}
		for _, k in keys do
			local key = if typeof(k) == "number" then "" else (tostring(k) .. " = ")
			table.insert(parts, inner .. key .. serialise(v[k], inner) .. ",")
		end
		return "{\n" .. table.concat(parts, "\n") .. "\n" .. indent .. "}"
	end
	return "nil --[[" .. kind .. "]]"
end

local function printConfig()
	local out = { "-- Tornado lab config, " .. os.date("%Y-%m-%d %H:%M") }
	for _, k in { "render", "motion", "far", "subVortex", "subStrands", "scour", "dustTracers", "puffs", "puffLayers", "cloudBase", "cloudBaseLayers", "funnel", "layers", "debris", "debrisLayers", "shade", "shadeLayers", "foot", "footLayers", "base", "baseLayers", "deck", "deckLayers", "wind", "textures" } do
		table.insert(out, "Config." .. k .. " = " .. serialise(Config[k], ""))
	end
	for _, k in { "tornado", "lighting", "atmosphere", "clouds", "colorCorrection", "cloudDeck", "ground", "camera" } do
		table.insert(out, "LabConfig." .. k .. " = " .. serialise(LabConfig[k], ""))
	end
	print(table.concat(out, "\n"))
end

local function setFrozen(on: boolean)
	view:setFrozen(on)
	puffs:setFrozen(on)
	cloudBase:setFrozen(on)
	subs:setFrozen(on)
	dust:setFrozen(on)
	strands:setFrozen(on)
end

local top = panel:section("Lab", true)
panel:buttons(top, {
	{ text = "Freeze (P)", fn = function()
		setFrozen(not view.frozen)
	end },
	{ text = "Spin on/off", fn = function()
		view.paused = not view.paused
		puffs.paused = view.paused
		subs.paused = view.paused
	end },
	{ text = "Hide (H)", fn = function()
		panel.gui.Enabled = false
	end },
	{ text = "Print config", fn = printConfig },
})
-- Looks: one per kind of tornado in docs/tornado-reference (Presets.luau)
local applyFunnelModeHook: (() -> ())? = nil -- set below: a look keeps the funnel mode
local function showLook(look)
	Presets.applyLook(look, Config, LabConfig, baseConfig, baseLab)
	setTornado()
	buildDeck()
	applyLighting()
	if look.faceSun then
		-- put the camera on the far side from the sun, so the tornado stands against the bright sky
		local sun = Lighting:GetSunDirection()
		if Vector2.new(sun.X, sun.Z).Magnitude > 1e-3 then
			-- sunOffset: degrees the camera swings round so the sun sits to one side (Elie: off to the left)
			LabConfig.camera.yaw = math.deg(math.atan2(-sun.X, -sun.Z)) + (look.sunOffset or 0)
		end
	end
	-- the storm ceiling's square of tiles faces the camera (no corner in view)
	Config.cloudBase.ceiling.gridYaw = LabConfig.camera.yaw
	-- the storm's base: turn the storm so its rain core sits behind the tornado, to the right
	do
		local SB = Config.stormBase
		local yaw = math.rad(LabConfig.camera.yaw)
		local view = Vector2.new(-math.sin(yaw), -math.cos(yaw)) -- camera to tornado, (x, z)
		local right = Vector2.new(-view.Y, view.X)
		local want = view + right * 0.6
		local precipHeading = math.deg(math.atan2(-want.Y, want.X))
		SB.heading = precipHeading - math.deg(math.atan2(SB.precipLeft, SB.precipAhead))
	end
	view:apply()
	puffs:apply()
	cloudBase:apply()
	stormBase:setState(state)
	rain:setState(state)
	subs:apply()
	if applyFunnelModeHook then
		applyFunnelModeHook()
	end
	panel:refresh()
	print("[TornadoLab] look: " .. look.name .. " (" .. (look.ref or "") .. ")")
end
local lookRow = {}
for i, look in Presets.LOOKS do
	table.insert(lookRow, { text = look.name, fn = function()
		showLook(look)
	end })
	if #lookRow == 4 or i == #Presets.LOOKS then
		panel:buttons(top, lookRow)
		lookRow = {}
	end
end
local skyRow = {}
for _, sky in LabConfig.SKIES do
	table.insert(skyRow, { text = "Sky: " .. sky.name, fn = function()
		Presets.applySky(LabConfig, sky.name)
		applyLighting()
		panel:refresh()
	end })
end
panel:buttons(top, skyRow)
-- debris-cloud conditions: set the ground and vortex inputs (the look is derived: DebrisCloud)
local debrisRow = {}
for i, preset in LabConfig.DEBRIS_PRESETS do
	table.insert(debrisRow, { text = "Debris: " .. preset.name, fn = function()
		if preset.ground then
			Presets.assignInto(Config.ground, preset.ground)
		end
		if preset.tornado then
			Presets.assignInto(LabConfig.tornado, preset.tornado)
			setTornado()
		end
		panel:refresh()
		print("[TornadoLab] debris conditions: " .. preset.name)
	end })
	if #debrisRow == 4 or i == #LabConfig.DEBRIS_PRESETS then
		panel:buttons(top, debrisRow)
		debrisRow = {}
	end
end
local cameraButtons = {}
for _, preset in LabConfig.CAMERA_PRESETS do
	table.insert(cameraButtons, {
		text = preset.name,
		fn = function()
			for k, v in preset do
				if k ~= "name" then
					LabConfig.camera[k] = v
				end
			end
			panel:refresh()
		end,
	})
end
panel:buttons(top, cameraButtons)

panel:bind(panel:section("Tornado", true), LabConfig.tornado, "tornado", range, function(path)
	setTornado()
	if path == "tornado.cloudBase" then
		buildDeck()
	end
end)
local function funnelChanged()
	view:apply()
	puffs:apply()
	cloudBase:apply()
	stormBase:setState(state)
	rain:setState(state)
	subs:apply()
end
panel:bind(panel:section("Funnel"), Config.funnel, "funnel", range, funnelChanged)
panel:bind(panel:section("Layers"), Config.layers, "layers", range, funnelChanged)
panel:bind(panel:section("Renderer"), Config.render, "render", range, funnelChanged)
panel:bind(panel:section("Motion (kinks, pulses)"), Config.motion, "motion", range, function() end)
panel:bind(panel:section("Far stand-ins (sprites past the particle range)"), Config.far, "far", range, function() end)
panel:bind(panel:section("Puff chain"), Config.puffs, "puffs", range, funnelChanged)
panel:bind(panel:section("Puff layers"), Config.puffLayers, "puffLayers", range, funnelChanged)
panel:bind(panel:section("Sub-vortices"), Config.subVortex, "subVortex", range, funnelChanged)
panel:bind(panel:section("Beam funnel (B)"), Config.beamFunnel, "beamFunnel", range, function()
	beams:apply()
end)
panel:bind(panel:section("Ribbon funnel (B)"), Config.ribbonFunnel, "ribbonFunnel", range, function() end)
-- The debris cloud: what the ground offers and the coefficients its look is derived from
-- (docs/tornado-physics/DEBRIS-CLOUD.md); the vortex inputs (EF, width, swirl, speed) are in Tornado
panel:bind(panel:section("Ground (what the wind can loft)", true), Config.ground, "ground", range, function() end)
panel:bind(panel:section("Debris cloud (derived)"), Config.debrisCloud, "debrisCloud", range, function() end)
panel:bind(panel:section("Dust (wind-driven)"), Config.dustTracers, "dustTracers", range, function()
	dust:apply()
end)
panel:bind(panel:section("Sub-vortex strands"), Config.subStrands, "subStrands", range, function() end)
panel:bind(panel:section("Parent cloud base"), Config.cloudBase, "cloudBase", range, funnelChanged)
panel:bind(panel:section("Parent cloud base layers"), Config.cloudBaseLayers, "cloudBaseLayers", range, funnelChanged)
panel:bind(panel:section("Debris cloud"), Config.debris, "debris", range, funnelChanged)
panel:bind(panel:section("Scour track"), Config.scour, "scour", range, function() end)
panel:bind(panel:section("Debris layers"), Config.debrisLayers, "debrisLayers", range, funnelChanged)
panel:bind(panel:section("Shade (shadow side)"), Config.shade, "shade", range, funnelChanged)
panel:bind(panel:section("Shade layers"), Config.shadeLayers, "shadeLayers", range, funnelChanged)
panel:bind(panel:section("Foot (ground contact)"), Config.foot, "foot", range, funnelChanged)
panel:bind(panel:section("Foot layers"), Config.footLayers, "footLayers", range, funnelChanged)
panel:bind(panel:section("Cloud base"), Config.base, "base", range, funnelChanged)
panel:bind(panel:section("Cloud base layers"), Config.baseLayers, "baseLayers", range, funnelChanged)
panel:bind(panel:section("Cloud deck (flat)"), Config.deck, "deck", range, funnelChanged)
panel:bind(panel:section("Cloud deck layers"), Config.deckLayers, "deckLayers", range, funnelChanged)
panel:bind(panel:section("Textures"), Config.textures, "textures", range, funnelChanged)
panel:bind(panel:section("Wind"), Config.wind, "wind", range, function() end)
panel:bind(panel:section("Profiles"), Config.profiles, "profiles", range, function() end)
panel:bind(panel:section("Camera"), LabConfig.camera, "camera", range, function() end)
panel:bind(panel:section("Lifecycle demo (L) / orbit (O)"), LabConfig.lifecycle, "lifecycle", range, function() end)
panel:bind(panel:section("Lighting"), LabConfig.lighting, "lighting", range, applyLighting)
panel:bind(panel:section("Atmosphere"), LabConfig.atmosphere, "atmosphere", range, applyLighting)
panel:bind(panel:section("Clouds"), LabConfig.clouds, "clouds", range, applyLighting)
panel:bind(panel:section("Colour grade"), LabConfig.colorCorrection, "colorCorrection", range, applyLighting)
panel:bind(panel:section("Cloud deck (stand-in)"), LabConfig.cloudDeck, "cloudDeck", range, buildDeck)
panel:bind(panel:section("Ground"), LabConfig.ground, "ground", range, paintGround)

-- the number keys are the looks, not the tool backpack
pcall(function()
	game:GetService("StarterGui"):SetCoreGuiEnabled(Enum.CoreGuiType.Backpack, false)
end)
local lookIndex = 1
local funnelMode = "ribbon" -- B: puffs -> beams -> ribbon -> ribbon+detail
local function applyFunnelMode()
	local mode = funnelMode
	-- with the ribbon the puffs stay on: their body layer stands in under and inside the funnel
	-- (the ribbon hands over), their surface detail only for rough looks
	-- the round-puff funnel is gone with the ribbon (2026-10-23, the user: puffs look unrealistic);
	-- only the old "puffs" mode (B) still draws it
	Config.puffs.enabled = mode == "puffs"
	Config.beamFunnel.enabled = mode == "beams"
	Config.ribbonFunnel.enabled = mode == "ribbon" or mode == "ribbon+detail"
	-- with the ribbon as the body, the puffs keep only their surface detail
	local ribbonMode = mode == "ribbon" or mode == "ribbon+detail"
	local detail = mode == "ribbon+detail" and Config.ribbonFunnel.detail
	for _, layer in Config.puffLayers do
		if layer.baseEnabled == nil then
			layer.baseEnabled = layer.enabled
		end
		if not ribbonMode or layer.name == "body" then
			layer.enabled = layer.baseEnabled
		elseif layer.name == "edgeL" or layer.name == "edgeR" then
			layer.enabled = false
		else
			layer.enabled = (detail or layer.always == true) and layer.baseEnabled -- (wisps: always)
		end
	end
	-- wind-driven dust replaces the drawn debris cloud layer
	for _, layer in Config.debrisLayers do
		if layer.name == "cloud" then
			if layer.baseEnabled == nil then
				layer.baseEnabled = layer.enabled
			end
			layer.enabled = if Config.dustTracers.enabled then false else layer.baseEnabled
		end
	end
	dust:apply()
	view:apply()
	beams:apply()
	puffs:apply()
	subs:apply()
	task.spawn(function()
		ribbon:apply()
	end)
	print("[TornadoLab] funnel: " .. mode)
end
applyFunnelModeHook = applyFunnelMode
applyFunnelMode()

-- The capture shot list (Shots.luau): U next, Y back.
local shotList = Shots.all(Presets.LOOKS)
local shotIndex = 0
local currentLook = ""
local stormShotIndex = 0
local function stepShot(step: number)
	if StormStage.isOn() then
		stormShotIndex = (stormShotIndex - 1 + step) % #Shots.STORM + 1
		local shot = Shots.STORM[stormShotIndex]
		lifecycle.orbit = false
		cameraRig.chaser()
		for k, v in shot.camera do
			LabConfig.camera[k] = v
		end
		StormStage.setFrame(shot.frame)
		if shot.yawFrom == "shelf" then
			task.delay(0.5, function()
				local yaw = StormStage.shelfYaw()
				if yaw then
					LabConfig.camera.yaw = yaw
				end
			end)
		end
		if shot.localHour then
			StormStage.setLocalHour(shot.localHour)
		else
			StormStage.setHourShift(shot.hourShift or 0)
		end
		panel.gui.Enabled = false
		print(string.format("[Shot] %d/%d %s", stormShotIndex, #Shots.STORM, shot.name))
		return
	end
	shotIndex = (shotIndex - 1 + step) % #shotList + 1
	local shot = shotList[shotIndex]
	lifecycle.on, lifecycle.travel, lifecycle.orbit = false, false, false
	lifecycle.offset = Vector3.zero
	if shot.look ~= currentLook then
		for i, look in Presets.LOOKS do
			if look.name == shot.look then
				lookIndex = i
				showLook(look)
			end
		end
		currentLook = shot.look
	end
	cameraRig.chaser()
	for k, v in shot.camera do
		LabConfig.camera[k] = v
	end
	panel.gui.Enabled = false
	panel:refresh()
	print(string.format("[Shot] %d/%d %s%s", shotIndex, #shotList, shot.name, if shot.ref then " (ref " .. shot.ref .. ")" else ""))
end
-- Storm mode (key N): the lab tornado, its deck and lighting step aside for the storm replay,
-- whose SkyLight lights the scene; the chaser camera stands well back.
local STORM_CAMERA = { distance = 12500, eyeHeight = 6, lookHeight = 3000, fov = 60, yaw = 45 }
local hiddenForStorm: { Instance } = {}
local cameraBeforeStorm: { [string]: number } = {}
local STORM_MODE_SHELVED = true
local function toggleStormMode()
	local on = StormStage.toggle()
	if on then
		local keep = { LabGround = true, Terrain = true, Camera = true, StormView = true }
		for _, child in Workspace:GetChildren() do
			if not keep[child.Name] and (child:IsA("Folder") or child:IsA("Model") or child:IsA("BasePart")) then
				table.insert(hiddenForStorm, child)
				child.Parent = nil
			end
		end
		for k, v in STORM_CAMERA do
			cameraBeforeStorm[k] = LabConfig.camera[k]
			LabConfig.camera[k] = v
		end
	else
		for _, child in hiddenForStorm do
			child.Parent = Workspace
		end
		table.clear(hiddenForStorm)
		for k, v in cameraBeforeStorm do
			LabConfig.camera[k] = v
		end
		applyLighting()
	end
	panel:refresh()
end

local DIGITS = { One = 1, Two = 2, Three = 3, Four = 4, Five = 5, Six = 6, Seven = 7, Eight = 8, Nine = 9 }
UserInputService.InputBegan:Connect(function(input, processed)
	-- looks: 1-9, or [ and ] to step through them (works even if something else claimed the key)
	local n = DIGITS[input.KeyCode.Name]
	if input.KeyCode == Enum.KeyCode.LeftBracket or input.KeyCode == Enum.KeyCode.RightBracket then
		local step = if input.KeyCode == Enum.KeyCode.RightBracket then 1 else -1
		n = (lookIndex - 1 + step) % #Presets.LOOKS + 1
	end
	if n and Presets.LOOKS[n] and not UserInputService:GetFocusedTextBox() then
		lookIndex = n
		showLook(Presets.LOOKS[n])
		return
	end
	if processed then
		return
	end
	if input.KeyCode == Enum.KeyCode.H then
		panel.gui.Enabled = not panel.gui.Enabled
	elseif input.KeyCode == Enum.KeyCode.P then
		setFrozen(not view.frozen)
	elseif input.KeyCode == Enum.KeyCode.M then
		-- switch the funnel renderer: puff chain <-> rings
		Config.render.mode = if Config.render.mode == "puffs" then "rings" else "puffs"
		view:apply()
		puffs:apply()
		cloudBase:apply()
		stormBase:setState(state)
		rain:setState(state)
		subs:apply()
		panel:refresh()
		print("[TornadoLab] renderer: " .. Config.render.mode)
	elseif input.KeyCode == Enum.KeyCode.L then
		lifecycle.on = not lifecycle.on
		lifecycle.start = os.clock()
		if not lifecycle.on then
			setTornado()
		end
		print("[TornadoLab] lifecycle: " .. tostring(lifecycle.on))
	elseif input.KeyCode == Enum.KeyCode.K then
		toggleRangeProbes()
	elseif input.KeyCode == Enum.KeyCode.T then
		lifecycle.travel = not lifecycle.travel
		if not lifecycle.travel and not lifecycle.on then
			-- stays where it got to
			state = labState()
			state.position += lifecycle.offset
			view:setState(state)
			puffs:setState(state)
			cloudBase:setState(state)
			stormBase:setState(state)
			rain:setState(state)
			subs:setState(state)
			scour:setState(state)
		end
		print("[TornadoLab] travel: " .. tostring(lifecycle.travel))
	elseif input.KeyCode == Enum.KeyCode.O then
		lifecycle.orbit = not lifecycle.orbit
		print("[TornadoLab] orbit: " .. tostring(lifecycle.orbit))
	elseif input.KeyCode == Enum.KeyCode.U or input.KeyCode == Enum.KeyCode.Y then
		stepShot(if input.KeyCode == Enum.KeyCode.U then 1 else -1)
	elseif input.KeyCode == Enum.KeyCode.B then
		-- the funnel's body: puffs -> beams -> ribbon (the cloud base, dust and the rest stay)
		funnelMode = if funnelMode == "puffs" then "beams" elseif funnelMode == "beams" then "ribbon" elseif funnelMode == "ribbon" then "ribbon+detail" else "puffs"
		applyFunnelMode()
	elseif input.KeyCode == Enum.KeyCode.J then
		windLab:toggleField()
	elseif input.KeyCode == Enum.KeyCode.G then
		windLab:toggleObjects(state)
	elseif input.KeyCode == Enum.KeyCode.N then
		-- shelved 2026-10-23: the old storm (replay through the game's StormView shells) is replaced by
		-- the storm built round the lab tornado (StormBase ...). Set STORM_MODE_SHELVED false to bring it back.
		if STORM_MODE_SHELVED then
			print("[TornadoLab] old storm mode is shelved (the storm is now built round the tornado: StormBase)")
		else
			toggleStormMode()
		end
	elseif input.KeyCode == Enum.KeyCode.Comma or input.KeyCode == Enum.KeyCode.Period then
		StormStage.step(if input.KeyCode == Enum.KeyCode.Period then 1 else -1)
	elseif input.KeyCode == Enum.KeyCode.Slash then
		StormStage.cycleSpeed()
	elseif input.KeyCode == Enum.KeyCode.I then
		StormStage.toggleStyle()
	elseif input.KeyCode == Enum.KeyCode.Zero then
		StormStage.nextReplay()
	elseif input.KeyCode == Enum.KeyCode.Equals then
		StormStage.cycleHidden()
	elseif input.KeyCode == Enum.KeyCode.Semicolon or input.KeyCode == Enum.KeyCode.Quote then
		StormStage.shiftHour(if input.KeyCode == Enum.KeyCode.Quote then 1 else -1)

	end
end)

---------------------------------------------------------------- texture check

-- A texture asked for in the first minutes after upload fails ("being generated") and Studio
-- remembers the failure for the whole session, even across playtests: the layer then simply
-- doesn't draw. Report any failures in the panel (fix: restart Studio once they're processed).
local failedTextures = {}
task.spawn(function()
	local ContentProvider = game:GetService("ContentProvider")
	local names = {}
	local ids = {}
	-- only the textures some layer uses
	local used = {}
	for _, list in { Config.layers, Config.baseLayers, Config.deckLayers, Config.footLayers, Config.shadeLayers } do
		for _, layer in list do
			used[layer.texture] = true
		end
	end
	for name in used do
		local id = Config.textures[name]
		if id and string.sub(id, 1, 13) == "rbxassetid://" then
			names[id] = name
			table.insert(ids, id)
		end
	end
	ContentProvider:PreloadAsync(ids, function(contentId, status)
		if status ~= Enum.AssetFetchStatus.Success then
			table.insert(failedTextures, names[contentId] or contentId)
			warn(string.format("[TornadoLab] texture %s (%s) failed to load: %s", names[contentId] or "?", contentId, tostring(status)))
		end
	end)
end)

---------------------------------------------------------------- frame loop

local fps, frames, clock = 0, 0, 0
local perfTick = 0
---------------------------------------------------------------- lifecycle demo and orbit
-- The current look as a life: forming (the funnel lowers out of the cloud, thin), mature (it
-- widens to the look), rope-out (it narrows, stretches and snakes) and lifting (the tip rises
-- back into the cloud). The state changes every frame, as an interpolated server state would.
local function smoothstep(x: number): number
	x = math.clamp(x, 0, 1)
	return x * x * (3 - 2 * x)
end
-- The life as keyframes; every value is eased between neighbouring keys, so nothing snaps (and
-- the loop's last key equals its first). Per key: p (share of the period), width (x the look's),
-- rope (blend toward the rope shape), bottom (condensation tip height), push (the foot shoved
-- out from under the storm, x the funnel height; the top stays put), bend (x the look's bends),
-- kink (0 = the look's, 1 = a rope's 10% of the height), wobble (studs added).
local LIFE = {
	{ p = 0.00, width = 0.40, rope = 0.5, bottom = 1.00, push = 0.0, bend = 1.0, kink = 0.3, wobble = 0 },
	{ p = 0.04, width = 0.40, rope = 0.5, bottom = 0.90, push = 0.0, bend = 1.0, kink = 0.3, wobble = 0 },
	{ p = 0.16, width = 0.45, rope = 0.5, bottom = 0.00, push = 0.0, bend = 1.0, kink = 0.2, wobble = 0 },
	{ p = 0.32, width = 1.00, rope = 0.0, bottom = 0.00, push = 0.0, bend = 1.0, kink = 0.0, wobble = 0 },
	{ p = 0.58, width = 1.00, rope = 0.0, bottom = 0.00, push = 0.1, bend = 1.0, kink = 0.0, wobble = 0 },
	{ p = 0.86, width = 0.22, rope = 1.0, bottom = 0.00, push = 1.0, bend = 2.0, kink = 1.0, wobble = 20 },
	{ p = 0.93, width = 0.20, rope = 1.0, bottom = 0.90, push = 1.1, bend = 2.2, kink = 1.0, wobble = 20 },
	{ p = 0.96, width = 0.20, rope = 1.0, bottom = 1.00, push = 1.1, bend = 2.2, kink = 1.0, wobble = 20 },
	-- hidden from here: the foot slides back under the storm while nothing is drawn
	{ p = 1.00, width = 0.40, rope = 0.5, bottom = 1.00, push = 0.0, bend = 1.0, kink = 0.3, wobble = 0 },
}
local PUSH_DIR = Vector3.new(-0.95, 0, -0.3).Unit -- the way the outflow shoves the foot

local function lifeState(now: number): State.State
	local base = labState()
	local s = labState()
	local H = base.cloudBase
	local p = ((now - lifecycle.start) / LabConfig.lifecycle.period) % 1
	local a, b = LIFE[1], LIFE[#LIFE]
	for i = 1, #LIFE - 1 do
		if p >= LIFE[i].p and p <= LIFE[i + 1].p then
			a, b = LIFE[i], LIFE[i + 1]
			break
		end
	end
	local x = smoothstep((p - a.p) / math.max(b.p - a.p, 1e-6))
	local function mix(key: string): number
		return a[key] + (b[key] - a[key]) * x
	end
	s.width = base.width * mix("width")
	s.shape = Shape.blend(base.shape, { rope = 1 }, mix("rope"))
	s.bottom = mix("bottom")
	-- the dynamic pipe: the vortex (and its condensation) builds down from the base in surges,
	-- reaching lower, pulling back a little, reaching again; none once it's down or gone
	local b = s.bottom
	if b > 0.01 and b < 0.99 then
		s.bottom = math.clamp(b + 0.1 * 4 * b * (1 - b) * math.noise(now * 0.35, 3.1), 0, 1)
	end
	-- the outflow shoves the foot out from under the storm; the top (and the cloud base) stays
	local shove = PUSH_DIR * H * mix("push")
	s.position = base.position + shove
	s.topOffset = base.topOffset - shove
	s.bendLow = base.bendLow * mix("bend")
	s.bendHigh = base.bendHigh * mix("bend")
	s.kink = base.kink + (H * 0.1 - base.kink) * mix("kink")
	s.wobble = base.wobble + mix("wobble")
	return s
end

RunService.RenderStepped:Connect(function(dt)
	if StormStage.isOn() then
		StormStage.update(dt)
		if lifecycle.orbit then
			local cam = LabConfig.camera
			cam.yaw = (cam.yaw + LabConfig.lifecycle.orbitSpeed * dt + 180) % 360 - 180
		end
		frames += 1
		clock += dt
		if clock >= 0.5 then
			fps = frames / clock
			frames, clock = 0, 0
			panel:setStats(string.format("%d fps · ", math.floor(fps + 0.5)) .. StormStage.describe())
			perfTick += 1
			if perfTick % 10 == 0 then
				print(string.format("[Perf] %d fps · %s", math.floor(fps + 0.5), (string.gsub(StormStage.describe(), "\n", " | "))))
			end
		end
		return
	end
	if lifecycle.orbit then
		local cam = LabConfig.camera
		cam.yaw = (cam.yaw + LabConfig.lifecycle.orbitSpeed * dt + 180) % 360 - 180
	end
	if lifecycle.travel then
		local dir = Vector3.new(1, 0, 0.35).Unit
		lifecycle.offset += dir * LabConfig.lifecycle.travelSpeed * dt
	end
	if lifecycle.on or lifecycle.travel then
		local now = os.clock()
		state = if lifecycle.on then lifeState(now) else labState()
		state.position += lifecycle.offset
		puffs:setLive(state)
		cloudBase:setLive(state)
		stormBase:setLive(state)
		rain:setLive(state)
		subs:setLive(state)
		scour:setLive(state)
		view:setLive(state)
		if now - lifecycle.lastApply > 0.5 then
			-- the rest (carrier count, debris width) twice a second, as a server update might
			lifecycle.lastApply = now
			puffs:apply()
			view:apply()
		end
	end
	view:update(dt, Workspace:GetServerTimeNow())
	puffs:update(dt, Workspace:GetServerTimeNow())
	cloudBase:update(dt, Workspace:GetServerTimeNow())
	stormBase:update(dt, Workspace:GetServerTimeNow())
	rain:update(dt, Workspace:GetServerTimeNow())
	wisps:setLive(state)
	wisps:update(dt, Workspace:GetServerTimeNow())
	debrisCloud:setLive(state)
	debrisCloud:update(dt, Workspace:GetServerTimeNow())
	subs:update(dt, Workspace:GetServerTimeNow())
	scour:update(dt)
	windLab:update(state, dt, Workspace:GetServerTimeNow())
	beams:setLive(state)
	beams:update(dt, Workspace:GetServerTimeNow())
	ribbon:setLive(state)
	ribbon:update(dt, Workspace:GetServerTimeNow())
	dust:setLive(state)
	dust:update(dt, Workspace:GetServerTimeNow())
	strands:setLive(state)
	strands:update(dt, Workspace:GetServerTimeNow())
	frames += 1
	clock += dt
	if clock >= 0.5 then
		fps = frames / clock
		frames, clock = 0, 0
		local st = view.stats
		panel:setStats(string.format(
			"%s · rings %d · puff points %d · particles ~%d · %d fps\npeak wind %.0f studs/s (EF%.1f)%s%s%s\n%s",
			Config.render.mode, st.rings, puffs.stats.nodes, st.particles + puffs.stats.particles + cloudBase.stats.particles, math.floor(fps + 0.5),
			Vortex.peakSpeed(state.ef), state.ef,
			if view.frozen then " · FROZEN" else "",
			if view.paused then " · spin off" else "",
			if #failedTextures > 0
				then "\nTEXTURES NOT LOADED: " .. table.concat(failedTextures, ", ") .. " (restart Studio)"
				else "",
			windLab:describe(state, Workspace:GetServerTimeNow())
		))
	end
end)
