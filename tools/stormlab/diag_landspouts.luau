-- Landspouts (2026-11-03): run a scenario's world with initiation and genesis on and report the
-- boundaries, misocyclones (Sim/Landspouts) and the tornadoes by parent kind.
--   luau --codegen tools/stormlab/diag_landspouts.luau -a [scenario] [seconds]
local Json = require("../../roblox/Shared/StormLab/Sim/Json")
local World = require("../../roblox/Shared/StormLab/Sim/World")
local args = { ... }
local name = args[1] or "Supercell"
local T = tonumber(args[2]) or 10800
local data = Json.decode(require("../../roblox/Shared/StormLab/Data/" .. name))
local world = World.new(data)
world.genesis, world.initiation = true, true
local t, nextP = 0, 0
local seen = {}
while t <= T do
	if t >= nextP then
		nextP += 600
		local nb, nm, gMax, dMax, wMax, vMax = 0, 0, 0, 0, 0, 0
		local kinds = {}
		for _, b in world.boundaries do
			nb += 1
			kinds[b.type] = (kinds[b.type] or 0) + 1
		end
		for _, m in world.landspouts.list do
			if not m.dead then
				nm += 1
				gMax = math.max(gMax, m.G or 0)
				dMax = math.max(dMax, m.genesisDrive or 0)
				wMax = math.max(wMax, m.wLow or 0)
				vMax = math.max(vMax, m.vlow or 0)
			end
		end
		local ks = {}
		for k, n in kinds do
			table.insert(ks, k .. " " .. n)
		end
		print(string.format("%5.0f storms %d bounds %d (%s) miso %d G %.2f drive %.2f wLow %.1f vlow %.1f maxShear %.1f cand %d spawned %d tornadoes %d",
			t, #world.storms, nb, table.concat(ks, ", "), nm, gMax, dMax, wMax, vMax, world.landspouts.maxShear or 0, world.landspouts.candidates or 0, world.landspouts.spawned or 0, #world.tornadoes))
		world.landspouts.maxShear = 0
	end
	world:step(10)
	t += 10
	for _, tt in world.tornadoes do
		if not seen[tt.id] then
			seen[tt.id] = true
			print(string.format("  tornado %s parent %s (%s) at %.0f s rc %.0f vc %.0f base %.0f", tt.id, tostring(tt.parentId), tostring(tt.parentKind), t, tt.rc, tt.vc, tt.cloudBase))
		end
		if tt.ended and not seen[tt.id .. "e"] then
			seen[tt.id .. "e"] = true
			print(string.format("  tornado %s ended at %.0f s, peak EF%d, path %.1f km, parent kind %s", tt.id, t, tt.peakEf or -1, (tt.pathLength or 0) / 1000, tostring(tt.parentKind)))
		end
	end
end
