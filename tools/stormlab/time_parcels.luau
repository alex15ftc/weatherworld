-- How much the precipitation parcel count costs the server: spin-up + 20 sim minutes of the
-- supercell scenario with a given parcel mass (kg).
--   luau --codegen tools/stormlab/time_parcels.luau -a <mass>
local Json = require("../../roblox/src/stormlab/shared/Sim/Json")
local Precip = require("../../roblox/src/stormlab/shared/Sim/Precip")
local World = require("../../roblox/src/stormlab/shared/Sim/World")
local mass = tonumber((...) or "") or 3e4
Precip.parcelMass = function(self)
	local fill = self.n / self.max
	return mass * (1 + 6 * math.max(0, fill - 0.5) ^ 2)
end
local data = Json.decode(require("../../roblox/src/stormlab/data/Supercell"))
local t0 = os.clock()
local world = World.new(data)
world:spinUp(600)
local t1 = os.clock()
for _ = 1, 240 do
	world:step(5)
end
local t2 = os.clock()
print(string.format("mass %.0f: parcels %d; spin-up %.1f s; 240 steps of 5 s: %.1f s (%.1f ms per sim second)",
	mass, world.precip.n, t1 - t0, t2 - t1, (t2 - t1) / 1200 * 1000))
