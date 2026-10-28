-- The precipitation field's budget over time (why a storm's echo fades): parcel count, mass
-- emitted / landed / evaporated, the strongest storm's precipitation rate, and the field's
-- strongest reflectivity, every 5 sim minutes.
--   luau --codegen tools/stormlab/diag_precip_budget.luau
local Json = require("../../roblox/src/stormlab/shared/Sim/Json")
local World = require("../../roblox/src/stormlab/shared/Sim/World")
local data = Json.decode(require("../../roblox/src/stormlab/data/Supercell"))
local world = World.new(data)
world:spinUp(600)
local p = world.precip
local function report(tmin: number)
	local best
	for _, s in world.storms do
		if not s.dead and (not best or s.W > best.W) then
			best = s
		end
	end
	local maxd = -99
	for _, d in p.dbz do
		maxd = math.max(maxd, d)
	end
	local maxf = -99
	for _, d in p.fineDbz or {} do
		maxf = math.max(maxf, d)
	end
	local st = p.stats
	print(string.format("t=%3d min  parcels %5d/%d  mass/parcel %.0f  emitted %d landed %d evap %d melted %d | storm %s W %.0f precipRate %.0f kg/s | max dBZ %.0f (fine %.0f)",
		tmin, p.n, p.max, p:parcelMass(), st.emitted or 0, st.landed or 0, st.evaporated or 0, st.melted or 0,
		best and tostring(best.id) or "-", best and best.W or 0, best and best.precipRate or 0, maxd, maxf))
end
report(0)
for k = 1, 8 do
	for _ = 1, 60 do
		world:step(5)
	end
	report(k * 5)
end
