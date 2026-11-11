--!nonstrict
-- Tornado looks for the lab, one per kind of tornado in docs/tornado-reference. Each is applied
-- on top of the starting settings (so looks don't pile up): only what a look changes is listed.
--
--   tornado = LabConfig.tornado fields (size, shape weights, lean and bends)
--   config  = Config overrides; layer lists (layers, baseLayers, debrisLayers ...) by layer name
--   sky     = a LabConfig.SKIES name
--   camera  = LabConfig.camera fields
--
-- Shape weights not listed are set to 0 (so a look's shape is exactly what it says).
local Presets = {}

Presets.LOOKS = {
	{
		name = "Ref1 cone",
		ref = "ref1_image.png",
		sky = "Clear",
		tornado = { cone = 1, ef = 2 },
		config = { ribbonFunnel = { detail = false } }, -- Ref1's funnel is smooth: the ribbon alone
	},
	{
		-- matched to a real photo, not a game: Elie, Manitoba 2007 (real/01_cone_a). A narrow pale
		-- horn under a dark ceiling, backlit by a low sun in a clear slot, a wide low dark dust spray
		-- at the contact, shelterbelt trees and power poles for scale.
		name = "Real cone",
		ref = "real/01_cone_a.jpg",
		sky = "Storm",
		faceSun = true,
		sunOffset = 30, -- the low sun a little to the left of the funnel, not straight behind it (glare)
		tornado = { width = 60, cloudBase = 760, horn = 1, ef = 4, wobble = 6, kink = 8, leanX = 40, lowX = -10, highX = 25 },
		config = {
			-- lit by the scene: sunlit only where the storm base lets the sun through (RibbonFunnel)
			-- real volumetric renders (tools/blender/storm_volume_bake.py) instead of drawn noise
			ribbonFunnel = { detail = false, colour = "scene", baked = "rbxassetid://92818362330179" },
			funnel = { colorBottom = Color3.fromRGB(196, 200, 190), colorTop = Color3.fromRGB(104, 112, 116) },
			base = { color = Color3.fromRGB(92, 102, 104), edgeColor = Color3.fromRGB(66, 76, 80) },
			-- the dust is WispSprites.dust (a dark cloud hugging the foot); the particle debris and the round
			-- tracer puffs are off (they read as separate pale puffs drifting away). Colour: dark grey-brown earth
			debris = { enabled = false, radius = 3, color = Color3.fromRGB(74, 71, 64) },
			-- the parent storm's base (StormBase mesh tiles): wall cloud, clear slot, rain-core shade,
			-- a ragged edge ~5 km out with the bright slot under it. The old cells + ceiling are off.
			stormBase = { enabled = true, detailTexture = "rbxassetid://78378864123644", texels = 128, meshRelief = 0, thin = 0 }, -- solid backing: see-through tiles sort over the puffs
			wisps = { deck = { enabled = true } }, -- the base's underside as impostor cloud (rendered puffs)
			rainCurtains = { enabled = true },
			-- the particle cells round the funnel's top: no sheet or ceiling (StormBase is the deck), only
			-- wisps hanging from the wall cloud's underside and torn scud below it (the Severity look:
			-- big faint fibrous puffs, so the wall cloud's edge frays)
			cloudBase = { enabled = true, sag = 0.2, collar = 2.8, ceiling = { enabled = false } },
			cloudBaseLayers = {
				sheet = { enabled = false },
				lumps = { enabled = true, texture = "wispyFlat", size = 1.1, opacity = 0.35, y = -0.45, flipFps = 1.5 },
				scud = { texture = "wispyFlat", opacity = 0.28, size = 0.8, count = 3, y = -1.0 },
			},
			far = { baseOpacity = 0 }, -- the base cells' far sprites read as boxes against the ceiling
			dustTracers = { enabled = false },
		},
		camera = { distance = 720, lookHeight = 430, fov = 78 },
	},
	{
		name = "Forming",
		ref = "ref5_subs1.png / ref6_subs.png",
		sky = "Clear",
		tornado = { cone = 1, width = 300, cloudBase = 560, ef = 2, bottom = 0.45 },
		config = { ribbonFunnel = { detail = false } },
	},
	{
		name = "White cone",
		ref = "clip_2026-02-28_10-37-29 / 11-04-14",
		sky = "Overcast",
		tornado = { width = 200, cloudBase = 650, cone = 0.5, stovepipe = 0.5, leanX = 140, lowX = -40, highX = 60, ef = 2 },
		config = {
			ribbonFunnel = { detail = false },
			funnel = { colorBottom = Color3.fromRGB(214, 217, 222), colorTop = Color3.fromRGB(200, 204, 210) },
			base = { color = Color3.fromRGB(200, 204, 210), edgeColor = Color3.fromRGB(104, 114, 128) },
			debris = { enabled = true, radius = 1.7, color = Color3.fromRGB(104, 98, 90) },
		},
	},
	{
		name = "Dark wedge",
		ref = "clip_2026-02-28_10-44-44",
		sky = "Overcast",
		tornado = { width = 560, cloudBase = 500, wedge = 1, kink = 10, pulse = 0.05, ef = 4 },
		config = {
			funnel = { colorBottom = Color3.fromRGB(72, 73, 75), colorTop = Color3.fromRGB(64, 66, 68) },
			base = { color = Color3.fromRGB(64, 66, 68), edgeColor = Color3.fromRGB(58, 60, 64), radius = 1.6 },
			debris = { enabled = true, radius = 1.15, color = Color3.fromRGB(52, 52, 54) },
		},
		camera = { distance = 700, lookHeight = 240, fov = 85 },
	},
	{
		name = "Green wedge",
		ref = "clip_2026-02-28_10-58-06",
		sky = "Green",
		tornado = { width = 560, cloudBase = 500, wedge = 1, kink = 10, pulse = 0.05, ef = 4 },
		config = {
			funnel = { colorBottom = Color3.fromRGB(64, 84, 78), colorTop = Color3.fromRGB(58, 76, 70) },
			base = { color = Color3.fromRGB(58, 76, 70), edgeColor = Color3.fromRGB(50, 66, 62), radius = 1.6 },
			debris = { enabled = true, radius = 1.15, color = Color3.fromRGB(46, 56, 52) },
		},
		camera = { distance = 700, lookHeight = 240, fov = 85 },
	},
	{
		name = "Sepia cone",
		ref = "ref3_spoiler_image.png",
		sky = "Sepia",
		tornado = { width = 200, cloudBase = 520, cone = 1, leanX = -60, ef = 3 },
		config = {
			funnel = { colorBottom = Color3.fromRGB(80, 68, 56), colorTop = Color3.fromRGB(72, 62, 52) },
			base = { color = Color3.fromRGB(72, 62, 52), edgeColor = Color3.fromRGB(60, 50, 42) },
			debris = { enabled = true, radius = 1.6, color = Color3.fromRGB(60, 50, 40) },
		},
	},
	{
		name = "Trunk",
		ref = "clip_2026-03-30_15-42-21 / 15-46-26",
		sky = "Overcast",
		tornado = { width = 160, cloudBase = 600, cone = 0.6, stovepipe = 0.4, leanX = 420, lowX = 20, highX = 200, kink = 30, wobble = 12, ef = 2 },
		config = {
			-- the reference trunk is a smooth tube with a clean outline: fewer lumps
			puffLayers = { lumps = { opacity = 0.2 }, shed = { opacity = 0.12 } },
			funnel = { colorBottom = Color3.fromRGB(118, 121, 125), colorTop = Color3.fromRGB(112, 115, 120) },
			base = { color = Color3.fromRGB(112, 115, 120) },
			debris = { enabled = true, radius = 1.8, color = Color3.fromRGB(88, 92, 96) },
		},
	},
	{
		name = "Rope",
		ref = "clip_2026-03-30_15-38-19, ref2",
		sky = "Overcast",
		tornado = { width = 34, cloudBase = 650, rope = 1, leanX = 160, lowX = 70, highX = -50, kink = 55, wobble = 20, ef = 1 },
		config = {
			ribbonFunnel = { detail = false },
			funnel = { maxRings = 120, colorBottom = Color3.fromRGB(196, 200, 206), colorTop = Color3.fromRGB(186, 190, 196) },
			base = { color = Color3.fromRGB(186, 190, 196), edgeColor = Color3.fromRGB(100, 110, 124) },
			debris = { enabled = true, radius = 2.4, color = Color3.fromRGB(56, 58, 62) },
		},
		camera = { lookHeight = 320 },
	},
	{
		name = "Rope-out",
		ref = "ref4_ropeout.png",
		sky = "Overcast",
		tornado = { width = 40, cloudBase = 700, rope = 1, leanX = 520, lowX = -60, highX = 260, kink = 70, wobble = 25, ef = 1 },
		config = {
			ribbonFunnel = { detail = false },
			funnel = { maxRings = 140, colorBottom = Color3.fromRGB(200, 202, 206), colorTop = Color3.fromRGB(194, 197, 202) },
			base = { color = Color3.fromRGB(194, 197, 202), edgeColor = Color3.fromRGB(104, 114, 128) },
			debris = { enabled = true, radius = 2.6, color = Color3.fromRGB(52, 54, 58) },
		},
		camera = { lookHeight = 320 },
	},
}

local SHAPES = { "rope", "cone", "stovepipe", "wedge", "horn" }
local LAYER_LISTS = { layers = true, baseLayers = true, deckLayers = true, footLayers = true, shadeLayers = true, debrisLayers = true, puffLayers = true, cloudBaseLayers = true }

local function deepCopy(v)
	if type(v) ~= "table" then
		return v
	end
	local out = {}
	for k, x in v do
		out[k] = deepCopy(x)
	end
	return out
end
Presets.deepCopy = deepCopy

-- Copy src into dst in place (the panel holds on to these tables, so they must stay the same ones).
local function assignInto(dst, src)
	for k, v in src do
		if type(v) == "table" and type(dst[k]) == "table" then
			assignInto(dst[k], v)
		else
			dst[k] = v
		end
	end
end
Presets.assignInto = assignInto

-- Overrides into Config: layer lists are matched by layer name.
local function overrideConfig(Config, overrides)
	for key, value in overrides do
		if LAYER_LISTS[key] then
			for name, fields in value do
				for _, layer in Config[key] do
					if layer.name == name then
						assignInto(layer, fields)
					end
				end
			end
		elseif type(value) == "table" and type(Config[key]) == "table" then
			assignInto(Config[key], value)
		else
			Config[key] = value
		end
	end
end

-- Put a sky preset into LabConfig.
function Presets.applySky(LabConfig, name: string)
	for _, sky in LabConfig.SKIES do
		if sky.name == name then
			for _, group in { "lighting", "atmosphere", "clouds", "colorCorrection" } do
				if sky[group] then
					assignInto(LabConfig[group], sky[group])
				end
			end
			return true
		end
	end
	return false
end

-- Reset to the starting settings, then apply a look.
function Presets.applyLook(look, Config, LabConfig, baseConfig, baseLab)
	assignInto(Config, deepCopy(baseConfig))
	assignInto(LabConfig, deepCopy(baseLab))
	if look.tornado then
		for _, s in SHAPES do
			LabConfig.tornado[s] = 0
		end
		assignInto(LabConfig.tornado, look.tornado)
	end
	if look.config then
		overrideConfig(Config, look.config)
	end
	if look.sky then
		Presets.applySky(LabConfig, look.sky)
	end
	if look.camera then
		assignInto(LabConfig.camera, look.camera)
	end
end

return Presets
