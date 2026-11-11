--!strict
-- Settings for the tornado lab only (lighting, camera, the test tornado). Edited live by the
-- debug panel; "Print config" writes the current values to the Output window.
local LabConfig = {}

-- A row of labelled test emitters in front of the camera (Probes.luau): which particle settings draw.
LabConfig.probes = false

-- The tornado being looked at (turned into a State each time it changes).
LabConfig.tornado = {
	width = 280, -- funnel diameter at the ground, studs
	ef = 2,
	cloudBase = 520,
	wobble = 8, -- studs of slow noise sway mid-funnel
	kink = 14, -- studs: helical kinks travelling up the funnel (Config.motion)
	pulse = 0.035, -- share: width bulges travelling up + slow breathing (strong ones look like eggs)
	bottom = 0, -- 0-1: where the condensation funnel ends (0 = on the ground)
	leanX = 0, -- where the top sits relative to the ground point, studs
	leanZ = 0,
	lowX = 0, -- extra sideways bend of the axis a third of the way up, studs
	lowZ = 0,
	highX = 0, -- and two thirds of the way up (S-bends, elephant trunks, rope-outs)
	highZ = 0,
	rope = 0, -- shape preset weights
	cone = 1,
	stovepipe = 0,
	wedge = 0,
	horn = 0, -- the real-photo cone (Shape.PRESETS.horn)
	swirl = 0, -- swirl ratio (0 = typical for the rating): ~0.2 one-celled column, ~0.5 two-celled ring, >1 suction vortices
	speed = 0, -- m/s forward along the storm's heading (the right of the track gets the stronger ground wind)
	seed = 1,
}

-- The lifecycle demo (key L): the current look forms (the funnel lowers out of the cloud), grows,
-- ropes out and lifts, on a loop of `period` seconds. Key O orbits the camera at orbitSpeed deg/s.
LabConfig.lifecycle = {
	period = 150,
	orbitSpeed = 12,
	travelSpeed = 30, -- studs/s the storm moves with T
}

-- A bright day under Roblox's default sky, like the references (docs/tornado-reference).
LabConfig.lighting = {
	clockTime = 14,
	brightness = 2.2,
	exposure = 0,
	ambient = Color3.fromRGB(90, 94, 102),
	outdoorAmbient = Color3.fromRGB(128, 132, 140),
	diffuseScale = 1,
	specularScale = 0.5,
	shadowSoftness = 0.3,
	geographicLatitude = 36,
}
LabConfig.atmosphere = {
	density = 0.32, -- Roblox's default atmosphere with more haze: ref1's sky is pale near the horizon
	offset = 0.25,
	haze = 2.2,
	glare = 0,
	color = Color3.fromRGB(199, 199, 199),
	decay = Color3.fromRGB(106, 112, 125),
}
LabConfig.clouds = {
	enabled = false,
	cover = 0.5,
	density = 0.5,
	color = Color3.fromRGB(220, 224, 230),
}
LabConfig.colorCorrection = {
	saturation = 0,
	contrast = 0,
	brightness = 0,
	tint = Color3.fromRGB(255, 255, 255),
}
-- A plain dark deck at the cloud base (off: the funnel's own flared base stands in for the storm
-- until Phase 2).
LabConfig.cloudDeck = {
	enabled = false,
	color = Color3.fromRGB(66, 69, 76),
	thickness = 60,
	radius = 3,  -- tiles of 2048 studs out from the tornado
}
LabConfig.ground = {
	color = Color3.fromRGB(104, 132, 72),
}
LabConfig.camera = {
	distance = 600, -- studs from the tornado (horizontal; particles fade out past ~1000, so
	-- everything, the cloud base's far side too, should stay within that of the camera)
	eyeHeight = 6, -- studs above the ground (a chaser's eye)
	lookHeight = 360, -- the point the camera aims at, studs up (ref1: ground near the bottom, base filling the top)
	yaw = 0, -- degrees round the tornado
	fov = 75,
}

LabConfig.RANGES = {
	["tornado.width"] = { 4, 2000, 1 },
	["tornado.ef"] = { 0, 5, 0.05 },
	["tornado.cloudBase"] = { 100, 2500, 10 },
	["tornado.wobble"] = { 0, 200, 1 },
	["tornado.leanX"] = { -1500, 1500, 5 },
	["tornado.leanZ"] = { -1500, 1500, 5 },
	["tornado.wobble"] = { 0, 200, 1 },
	["tornado.kink"] = { 0, 300, 1 },
	["tornado.pulse"] = { 0, 0.4, 0.005 },
	["tornado.bottom"] = { 0, 1, 0.01 },
	["lifecycle.period"] = { 20, 600, 5 },
	["lifecycle.orbitSpeed"] = { 0, 60, 1 },
	["lifecycle.travelSpeed"] = { 0, 200, 1 },
	["tornado.lowX"] = { -1000, 1000, 5 },
	["tornado.lowZ"] = { -1000, 1000, 5 },
	["tornado.highX"] = { -1000, 1000, 5 },
	["tornado.highZ"] = { -1000, 1000, 5 },
	["tornado.rope"] = { 0, 1, 0.01 },
	["tornado.cone"] = { 0, 1, 0.01 },
	["tornado.stovepipe"] = { 0, 1, 0.01 },
	["tornado.wedge"] = { 0, 1, 0.01 },
	["tornado.horn"] = { 0, 1, 0.01 },
	["tornado.swirl"] = { 0, 4, 0.01 },
	["tornado.speed"] = { 0, 40, 0.5 },
	["tornado.seed"] = { 1, 999, 1 },
	["lighting.clockTime"] = { 0, 24, 0.05 },
	["lighting.brightness"] = { 0, 6, 0.05 },
	["lighting.exposure"] = { -3, 3, 0.05 },
	["lighting.diffuseScale"] = { 0, 1, 0.01 },
	["lighting.specularScale"] = { 0, 1, 0.01 },
	["lighting.shadowSoftness"] = { 0, 1, 0.01 },
	["lighting.geographicLatitude"] = { -90, 90, 1 },
	["atmosphere.density"] = { 0, 1, 0.01 },
	["atmosphere.offset"] = { 0, 1, 0.01 },
	["atmosphere.haze"] = { 0, 10, 0.05 },
	["atmosphere.glare"] = { 0, 10, 0.05 },
	["clouds.cover"] = { 0, 1, 0.01 },
	["clouds.density"] = { 0, 1, 0.01 },
	["colorCorrection.saturation"] = { -1, 1, 0.01 },
	["colorCorrection.contrast"] = { -1, 1, 0.01 },
	["colorCorrection.brightness"] = { -1, 1, 0.01 },
	["cloudDeck.thickness"] = { 2, 400, 1 },
	["cloudDeck.radius"] = { 0, 4, 1 },
	["camera.distance"] = { 50, 6000, 5 },
	["camera.eyeHeight"] = { 1, 2000, 1 },
	["camera.lookHeight"] = { 0, 2500, 5 },
	["camera.yaw"] = { -180, 180, 1 },
	["camera.fov"] = { 10, 110, 1 },
}

-- Sky presets (the panel's buttons): the storm light the references are shot in.
LabConfig.SKIES = {
	{
		name = "Clear",
		lighting = { clockTime = 14, brightness = 2.2, ambient = Color3.fromRGB(90, 94, 102), outdoorAmbient = Color3.fromRGB(128, 132, 140) },
		atmosphere = { density = 0.32, offset = 0.25, haze = 2.2, color = Color3.fromRGB(199, 199, 199), decay = Color3.fromRGB(106, 112, 125) },
		clouds = { enabled = false },
		colorCorrection = { saturation = 0, contrast = 0, brightness = 0, tint = Color3.fromRGB(255, 255, 255) },
	},
	{
		name = "Overcast",
		lighting = { clockTime = 14, brightness = 1.4, ambient = Color3.fromRGB(110, 112, 118), outdoorAmbient = Color3.fromRGB(140, 142, 148) },
		atmosphere = { density = 0.3, offset = 0.1, haze = 2.5, color = Color3.fromRGB(222, 224, 228), decay = Color3.fromRGB(196, 200, 206) },
		clouds = { enabled = true, cover = 1, density = 1, color = Color3.fromRGB(214, 217, 222) },
		-- the clouds lit by a blue sky read lavender: take most of the colour out
		colorCorrection = { saturation = -0.6, contrast = 0.06, brightness = 0, tint = Color3.fromRGB(250, 250, 250) },
	},
	{
		name = "Green",
		lighting = { clockTime = 16, brightness = 1.2, ambient = Color3.fromRGB(80, 96, 90), outdoorAmbient = Color3.fromRGB(100, 120, 112) },
		atmosphere = { density = 0.45, offset = 0.05, haze = 3, color = Color3.fromRGB(120, 150, 142), decay = Color3.fromRGB(70, 92, 86) },
		clouds = { enabled = true, cover = 0.95, density = 0.85, color = Color3.fromRGB(90, 110, 104) },
		colorCorrection = { saturation = -0.1, contrast = 0.08, brightness = -0.05, tint = Color3.fromRGB(200, 235, 220) },
	},
	{
		name = "Sepia",
		lighting = { clockTime = 17.3, brightness = 1.3, ambient = Color3.fromRGB(100, 86, 70), outdoorAmbient = Color3.fromRGB(130, 110, 88) },
		atmosphere = { density = 0.45, offset = 0.05, haze = 3, color = Color3.fromRGB(190, 160, 120), decay = Color3.fromRGB(110, 86, 60) },
		clouds = { enabled = true, cover = 0.95, density = 0.85, color = Color3.fromRGB(120, 100, 80) },
		colorCorrection = { saturation = -0.15, contrast = 0.1, brightness = -0.05, tint = Color3.fromRGB(255, 230, 196) },
	},
}

-- Under a storm (docs/tornado-reference/real/01_cone_a, 11_parent_*): a dark low ceiling over
-- the whole sky (Roblox's cloud layer, darkened) and a bright clear slot along the horizon (low sun +
-- warm, bright haze). The low evening sun sits behind the tornado when a look sets faceSun.
table.insert(LabConfig.SKIES, {
	name = "Storm",
	lighting = { clockTime = 17.4, brightness = 2.4, ambient = Color3.fromRGB(70, 76, 80), outdoorAmbient = Color3.fromRGB(96, 104, 108) },
	atmosphere = { density = 0.36, offset = 0, haze = 2.4, glare = 0, color = Color3.fromRGB(236, 230, 206), decay = Color3.fromRGB(120, 132, 132) },
	clouds = { enabled = false, cover = 1, density = 1, color = Color3.fromRGB(46, 54, 58) }, -- the ceiling is CloudBase.ceiling (looks turn it on)
	colorCorrection = { saturation = -0.15, contrast = 0.12, brightness = 0, tint = Color3.fromRGB(245, 250, 248) },
})

-- Debris-cloud conditions (the panel's buttons): each only sets the physical inputs, the ground
-- (Config.ground) and the vortex (swirl ratio, forward speed); the cloud's look is derived from
-- them (DebrisCloud). Values from docs/tornado-physics/DEBRIS-CLOUD.md.
LabConfig.DEBRIS_PRESETS = {
	-- bare dry soil, fine dust: a tall tan dust sheath up the funnel
	{ name = "Dry plains", ground = { loose = 1, moisture = 0.05, fines = 0.85, water = 0, color = Color3.fromRGB(150, 122, 88) } },
	-- ploughed / dry farmland: a dark collar and some dust
	{ name = "Farmland", ground = { loose = 0.75, moisture = 0.2, fines = 0.55, water = 0, color = Color3.fromRGB(104, 86, 66) } },
	-- wet grass and crops after rain: little to loft, a faint low ring
	{ name = "Wet grass", ground = { loose = 0.3, moisture = 0.8, fines = 0.3, water = 0, color = Color3.fromRGB(80, 84, 64) } },
	-- a town: coarse dark debris (a debris ball when strong)
	{ name = "Town", ground = { loose = 0.65, moisture = 0.2, fines = 0.25, water = 0, color = Color3.fromRGB(88, 86, 82) } },
	-- over water: a white spray ring
	{ name = "Water", ground = { loose = 0, moisture = 0, fines = 0.25, water = 1, color = Color3.fromRGB(118, 100, 78) } },
	-- low swirl (one-celled): a central dust column (landspout-like)
	{ name = "Low swirl", tornado = { swirl = 0.2 } },
	-- two-celled: the dust opens into a hollow ring
	{ name = "Mid swirl", tornado = { swirl = 0.6 } },
	-- high swirl: suction vortices throw up dust spikes (fewer once dust loading smothers them)
	{ name = "High swirl", tornado = { swirl = 1.8 } },
}

-- Camera presets (the panel's buttons).
LabConfig.CAMERA_PRESETS = {
	{ name = "Like ref1", distance = 600, eyeHeight = 6, lookHeight = 360, fov = 75 },
	{ name = "Chaser", distance = 900, eyeHeight = 6, lookHeight = 300, fov = 55 },
	{ name = "Aerial", distance = 900, eyeHeight = 500, lookHeight = 250, fov = 55 },
}

return LabConfig
