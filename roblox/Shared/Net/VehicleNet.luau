--!strict
-- The engine-sim cars (VehicleService, CarService; Client VehicleController and
-- RemoteVehicleAudioController).
--   Audio       client -> server, unreliable, ~10 Hz: the driver's engine controls for the car
--               they own (model, preset name, rpm, throttle, ignition, starter, impulse response)
--   AudioRelay  server -> every client: the same, for the other clients to rebuild that engine
--   Choose      client -> server: the car the player wants (a VehicleConfigs key), set down
--               beside them in place of the one they have

local Shared = script.Parent.Parent
local Network = require(Shared.Network)

local MAX_PRESET = 40
local MAX_IMPULSE = 80
local MAX_KEY = 40

local function finite(x: unknown, lo: number, hi: number): number
	assert(type(x) == "number" and x == x and x >= lo and x <= hi, "bad number")
	return x
end

return table.freeze({
	Audio = Network.UnreliableEvent(
		"Vehicle.Audio",
		function(
			model: unknown,
			preset: unknown,
			rpm: unknown,
			throttle: unknown,
			ignition: unknown,
			starter: unknown,
			impulse: unknown
		): (Model, string, number, number, boolean, boolean, string)
			assert(typeof(model) == "Instance" and model:IsA("Model"), "bad model")
			assert(type(preset) == "string" and #preset <= MAX_PRESET, "bad preset")
			assert(type(impulse) == "string" and #impulse <= MAX_IMPULSE, "bad impulse response")
			assert(type(ignition) == "boolean" and type(starter) == "boolean", "bad switches")
			return model, preset, finite(rpm, 0, 20000), finite(throttle, 0, 1), ignition, starter, impulse
		end
	),
	AudioRelay = Network.UnreliableEvent("Vehicle.AudioRelay", Network.FromServer),
	Choose = Network.Event("Vehicle.Choose", function(key: unknown): string
		assert(type(key) == "string" and #key <= MAX_KEY, "bad car")
		return key
	end),
})
