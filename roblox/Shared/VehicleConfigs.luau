--!strict
-- Every car's config, and which model uses which: the pickup (players' cars, CarService), the
-- Crown Vic and the GMC 2500. The models are ServerStorage.Vehicles (roblox/assets/vehicles).
--
-- The config files describe the models as they were built (full size); the place's world is at
-- Config.WORLD_SCALE (half size), and VehicleService scales each model to it, so the configs
-- here carry MetersPerStud at that scale.
--
-- A model picks its config from its "VehicleConfig" attribute (a key below),
-- or else from its name. VehicleService writes the attribute when it rigs the
-- model, so the client always reads the same config the server rigged with.

local VehicleConfig = require(script.Parent.VehicleConfig)
local Pickup = require(script.Parent.VehicleConfigPickup)
local CrownVic = require(script.Parent.VehicleConfigCrownVic)
local GMC2500 = require(script.Parent.VehicleConfigGMC2500)
local WorldConfig = require(script.Parent.World.Config)

export type VehicleConfig = VehicleConfig.VehicleConfig
export type SoundEmitterSpec = VehicleConfig.SoundEmitterSpec

local VehicleConfigs = {}

VehicleConfigs.Default = "Pickup"

-- A config at the world's scale: a model shrunk by WORLD_SCALE has that many more metres a stud.
local function atWorldScale(config: VehicleConfig): VehicleConfig
	local scaled = table.clone(config)
	scaled.MetersPerStud = config.MetersPerStud / WorldConfig.WORLD_SCALE
	return scaled
end

VehicleConfigs.ByKey = {
	Pickup = atWorldScale(Pickup),
	CrownVic = atWorldScale(CrownVic),
	GMC2500 = atWorldScale(GMC2500),
} :: { [string]: VehicleConfig }

-- what the seat's prompt and the F4 menu call each car
VehicleConfigs.DisplayName = {
	Pickup = "Chevy C1500",
	CrownVic = "Crown Victoria",
	GMC2500 = "GMC Sierra 2500HD",
} :: { [string]: string }

-- the order the F4 menu lists them in
VehicleConfigs.Order = { "Pickup", "CrownVic", "GMC2500" }

-- lowercase substrings of the model name -> key
local NAME_MATCH = {
	{ "pickup", "Pickup" },
	{ "silverado", "Pickup" },
	{ "c1500", "Pickup" },
	{ "crownvic", "CrownVic" },
	{ "crown vic", "CrownVic" },
	{ "crown victoria", "CrownVic" },
	{ "gmc", "GMC2500" },
	{ "sierra", "GMC2500" },
	{ "2500", "GMC2500" },
}

function VehicleConfigs.keyForModel(model: Model): string
	local attr = model:GetAttribute("VehicleConfig")
	if type(attr) == "string" and VehicleConfigs.ByKey[attr] then
		return attr
	end
	local name = string.lower(model.Name)
	for _, m in NAME_MATCH do
		if string.find(name, m[1], 1, true) then
			return m[2]
		end
	end
	return VehicleConfigs.Default
end

function VehicleConfigs.forModel(model: Model): (VehicleConfig, string)
	local key = VehicleConfigs.keyForModel(model)
	return VehicleConfigs.ByKey[key], key
end

return VehicleConfigs
