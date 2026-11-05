-- The L6 landspout scene offline: the cell, its misocyclone and any tornado every minute.
--   luau --codegen tools/stormlab/diag_landspout_scene.luau -a [seconds]
local Json = require("./src/shared/Sim/Json")
local World = require("./src/shared/Sim/World")
local VisualTests = require("./src/shared/VisualTests")
local data = Json.decode(require("./src/data/Supercell"))
local args = { ... }
local T = tonumber(args[1]) or 2700
local world = World.new(data)
world.genesis, world.initiation = true, false
world:labScene(VisualTests.byId("life_landspout"), VisualTests.SITE)
local s
for _, c in world.storms do
	if c.lab and not c.dead then
		s = c
	end
end
local t = 0
while t <= T do
	if t % 60 == 0 then
		local m
		for _, q in world.landspouts.list do
			if q.lab and not q.dead then
				m = q
			end
		end
		local tor
		for _, tt in world.tornadoes do
			if tt.lab and tt.parentKind == "misocyclone" and not tt.ended then
				tor = tt
			end
		end
		print(string.format("%5d cell W %4.1f base %4.0f rain %5.0f | miso %s rlow %4.0f vlow %4.1f wLow %4.1f def %.1f drive %.2f G %.2f | tor %s",
			t, s.W, s.base or 0, (s.precipRate or 0) / 1000, m and m.id or "-", m and m.rlow or 0, m and m.vlow or 0, m and m.wLow or 0, m and m.rfdDeficit or 0, m and m.genesisDrive or 0, m and m.G or 0,
			if tor then string.format("%s vc %.0f rc %.0f S %.2f funnel@ground %.0f base %.0f core %.0f decay %.2f EF%d", tor.id, tor.vc, tor.rc, tor.swirl, tor.funnelGround or -1, tor.cloudBase, tor.coreZb or 0, tor.decay, tor.ef or -1) else "-"))
	end
	world:step(10)
	t += 10
end
