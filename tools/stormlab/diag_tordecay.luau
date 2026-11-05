-- A tornado under a storm that doesn't occlude (2026-11-03 Studio check: C001 never occluded and its
-- EF1 lived 39+ min). Runs the Supercell day with the gust front, forces a tornado under one storm
-- at a given minute and follows it: its age, strength, decay, lean, and where its contact sits
-- against the RFD gust front (depth: + inside the cold air, - on the warm side).
--   luau --codegen tools/stormlab/diag_tordecay.luau -a [storm id] [force at min] [minutes]
local Json = require("../../roblox/src/stormlab/shared/Sim/Json")
local World = require("../../roblox/src/stormlab/shared/Sim/World")
local GustFront = require("../../roblox/src/stormlab/shared/Sim/GustFront")
local args = { ... }
local sid = args[1] or "C001"
local at = tonumber(args[2]) or 10
local minutes = tonumber(args[3]) or 70
local world = World.new(Json.decode(require("../../roblox/src/stormlab/data/Supercell")))
world.genesis = false
local storm, tor
for m = 1, minutes do
	for _ = 1, 60 do
		world:step(1)
	end
	if m == at then
		for _, s in world.storms do
			if s.id == sid then
				storm = s
			end
		end
		tor = storm and world:forceTornado(storm)
		print("forced", tor and tor.id or "none", "under", sid)
	end
	if tor and m % 2 == 0 then
		local f = storm.gf
		local inside, d = false, 0
		if f then
			inside, d = GustFront.inside(f, tor.x, tor.y)
		end
		local lean = math.sqrt(tor.topX ^ 2 + tor.topY ^ 2)
		print(string.format("m %3d %s age %4.1f min vc %4.1f decay %.2f stage %-10s lean %5.0f m base %4.0f | front depth at contact %6.0f wrap %.2f cold %.2f | storm occl %.2f cyc %d vlow %4.1f rfdDef %.1f%s",
			m, tor.id, tor.age / 60, tor.vc, tor.decay, tostring(tor.stage), lean, tor.cloudBase,
			if inside then d else -d, tor.frontWrap or 0, tor.coldIn or 0, storm.occl, storm.cycle or 0, storm.vlow, storm.rfdDeficit or 0, if tor.ended then " ENDED" else ""))
		if tor.ended then
			break
		end
	end
end
