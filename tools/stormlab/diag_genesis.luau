-- Tornado genesis terms per storm (Storm.step's genesis block), every 15 min, both lab days:
-- gamma (stretching x spin), warm RFD, RFD help, LCL factor, drive (needs > 0.8 to build G), G.
local Json = require("../../roblox/src/stormlab/shared/Sim/Json")
local World = require("../../roblox/src/stormlab/shared/Sim/World")
for _, name in { "Supercell", "SquallLine" } do
	local world = World.new(Json.decode(require("../../roblox/src/stormlab/data/" .. name)))
	world:spinUp(600)
	local tors = 0
	local known = {}
	for step = 1, 1440 do
		world:step(5)
		for _, t in world.tornadoes do
			if not known[t.id] then known[t.id] = true; tors += 1 end
		end
		if step % 180 == 0 then
			print(string.format("%s t=%d min, %d tornadoes so far", name, step * 5 // 60, tors))
			local list = {}
			for _, s in world.storms do
				if not s.dead and s.W > 20 then table.insert(list, s) end
			end
			table.sort(list, function(a, b) return (a.genesisDrive or 0) > (b.genesisDrive or 0) end)
			for i = 1, math.min(5, #list) do
				local s = list[i]
				local ru = s.Ru
				local rlow = 0.3 * ru
				local fW = 0
				print(string.format("  %s W %2.0f vmid %4.1f vlow %4.1f rot %.2f | rfd %.1f rfdDef %.1f K lcl %4.0f | drive %.2f G %.2f %s",
					s.id, s.W, s.vmid, s.vlow, s.rot, s.rfd, s.rfdDeficit, s.lcl, s.genesisDrive or -1, s.G or 0, s.tornado and "TOR" or ""))
			end
		end
	end
end
