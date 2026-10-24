local Json = require("../../roblox/src/stormlab/shared/Sim/Json")
local World = require("../../roblox/src/stormlab/shared/Sim/World")
local data = Json.decode(require("../../roblox/src/stormlab/data/Supercell"))
local world = World.new(data)
world:spinUp(900)
local P = world.precip
local st0 = table.clone(P.stats)
for _ = 1, 600 do world:step(1) end
local st = P.stats
local prod = 0
for _, s in world.storms do if not s.dead then prod += s.precipRate; print(s.id, string.format("W %.0f Ru %.0f rate %.2e kg/s eff %.2f qBase %.4f", s.W, s.Ru, s.precipRate, s.efficiency or 0, s.qBase)) end end
print(string.format("production %.2e kg/s; emitted %.2e landed %.2e evap %.2e melted %.2e kg/s over 300 s",
	prod, (st.emitted - st0.emitted) / 600, (st.landed - st0.landed) / 600, (st.evaporated - st0.evaporated) / 600, (st.melted - st0.melted) / 600))
print(string.format("lofted to anvil %.2e  lost (domain/tiny) %.2e kg/s", ((st.lofted or 0) - (st0.lofted or 0)) / 600, ((st.lost or 0) - (st0.lost or 0)) / 600))
local hist, kinds, mass = {}, { 0, 0, 0 }, 0
for i = 1, #P.px do if P.alive[i] then
	local b = math.floor(P.pz[i] / 2000); hist[b] = (hist[b] or 0) + 1; kinds[P.pk[i]] += 1; mass += P.pm[i]
end end
for b = 0, 8 do print(string.format("z %2d-%2d km: %d", b * 2, b * 2 + 2, hist[b] or 0)) end
print("rain/hail/ice", kinds[1], kinds[2], kinds[3], string.format("airborne mass %.2e kg, parcel mass %.2e", mass, P:parcelMass()))
local rr = P.rainRate.v
local area = 0
for _, r in rr do if r > 5 then area += 1 end end
print("km2 with > 5 mm/h:", area, "max", P.rainRate:max())
