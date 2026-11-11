--!strict
-- Wind profiles: how trees look in the wind (not what breaks them: Foliage/Mechanics). A profile
-- scales the sway for looks; a tree takes its profile from its "WindProfile" attribute, else its
-- kind's, else "Default". Presets set a manual wind for previews and labs (Studio plugin; the
-- game's wind is the weather engine's unless Settings.source is "manual").
--
-- Everything here can be changed live: the plugin writes ReplicatedStorage.FoliageSettings
-- (a Configuration: its attributes are the settings below, and one child Configuration a profile
-- with the same fields as attributes; saved presets live under its "Presets" folder). The client
-- runtime (FoliageController) reads it, falling back to these defaults.
local Profiles = {}

export type Profile = {
	bend: number, -- x the physical bend
	speed: number, -- x each bone's natural frequency
	gust: number, -- x the turbulence's gusts
	turbulence: number, -- the wind's turbulence intensity (rough land, convective air: 0.2-0.35)
	flutter: number, -- the leaves' shiver
	bendLimit: { number }, -- degrees, soft: trunk, limb, twig (tiers 0, 1, 2)
}

Profiles.DEFAULT = { bend = 1, speed = 1, gust = 1, turbulence = 0.25, flutter = 1, bendLimit = { 6, 18, 30 } } :: Profile

-- (kind defaults: the cedar's dense, springy crown sways less and shivers less)
Profiles.KINDS = {
	cedar = { bend = 0.9, speed = 1.1, gust = 1, turbulence = 0.25, flutter = 0.5, bendLimit = { 5, 14, 22 } },
} :: { [string]: Profile }

-- Manual wind presets: the wind (m/s at 10 m), its direction (degrees, the way it blows toward:
-- 0 north, 90 east), and the profile multipliers.
export type Preset = { wind: number, direction: number, turbulence: number, gust: number }
Profiles.PRESETS = {
	Calm = { wind = 2.5, direction = 90, turbulence = 0.15, gust = 0.6 },
	Breezy = { wind = 8, direction = 90, turbulence = 0.25, gust = 1 },
	Storm = { wind = 24, direction = 90, turbulence = 0.32, gust = 1.3 },
} :: { [string]: Preset }

-- Runtime settings (FoliageSettings attributes; the defaults).
Profiles.SETTINGS = {
	source = "weather", -- "weather" (the engine's wind) or "manual" (the attributes below)
	manualWind = 8,
	manualDirection = 90,
	animDistance = 450, -- studs: trees farther hold still (faded out before)
	fadeDistance = 120, -- studs over which the sway fades to nothing toward animDistance
	meshDistance = 900, -- studs: beyond, a tree is its impostor (billboard)
	impostorDistance = 2000, -- studs: beyond, nothing (chunks load to Config.LOAD_RADIUS_STUDS, 2048)
	lodLimbs = 220, -- studs: beyond, only the trunk and limbs sway (tiers 0-1)
	lodTrunk = 340, -- studs: beyond, only the trunk
	budgetMs = 0.8, -- ms a frame the sway may take (the batch grows and shrinks to fit)
	batch = 24, -- trees a frame to start from (adaptive batching changes it)
	adaptive = true,
	frustum = true, -- trees out of the camera's view are not animated
	frustumMargin = 25, -- studs: a tree this close to the view's edge still counts as in it
	cell = 96, -- studs: the spatial hash's cell (wind sampled once a cell)
}

-- A profile from a Configuration's attributes, over a base.
function Profiles.read(cfg: Instance?, base: Profile): Profile
	if not cfg then
		return base
	end
	local p = table.clone(base)
	for _, key in { "bend", "speed", "gust", "turbulence", "flutter" } do
		local v = cfg:GetAttribute(key)
		if type(v) == "number" then
			(p :: any)[key] = v
		end
	end
	local limits = table.clone(base.bendLimit)
	for t, key in { "limitTrunk", "limitLimb", "limitTwig" } do
		local v = cfg:GetAttribute(key)
		if type(v) == "number" then
			limits[t] = v
		end
	end
	p.bendLimit = limits
	return p
end

return Profiles
