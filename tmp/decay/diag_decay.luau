-- The supercell lifecycle scene's storm through its life and decay (Round 38: cloud memory,
-- outflow-dominant feedback): W, Ru, CAPE, the gust front's RKW, the live and remembered cloud's
-- width at 3, 6 and 9 km, the anvil and the stratiform rain.
--   luau --codegen tools/stormlab/diag_decay.luau -a [scene id] [seconds] [keyed|-] [storm seed]
-- keyed: put back the pre-Round-38 keyed decay (W 25 -> 10 -> 4 by 9000 s) to watch the remembered
-- cloud erode under a collapsing updraft (the Supercell scenario's air never ends a freed storm)
local Json = require("./src/shared/Sim/Json")
local World = require("./src/shared/Sim/World")
local Storm = require("./src/shared/Sim/Storm")
local VisualTests = require("./src/shared/VisualTests")
local data = Json.decode(require("./src/data/Supercell"))
local args = { ... }
local id = args[1] or "life_supercell"
local T = tonumber(args[2]) or 10800
local world = World.new(data)
world.genesis, world.initiation = false, false
local scene = VisualTests.byId(id)
if args[3] == "keyed" then
	scene = table.clone(scene)
	scene.storm = table.clone(scene.storm)
	local keys = {}
	for _, k in scene.storm.keys do
		if not k.free then
			table.insert(keys, k)
		end
	end
	table.insert(keys, { t = 7500, W = 25, Ru = 3000, vmid = 12, vlow = 6, lowering = 100, occl = 0.7, rfdDeficit = 3, rearShare = 0.4 })
	table.insert(keys, { t = 8400, W = 10, Ru = 2200, vmid = 4, vlow = 2, lowering = 0 })
	table.insert(keys, { t = 9000, W = 4, Ru = 1800, vmid = 1, vlow = 1 })
	scene.storm.keys = keys
end
local t0 = os.clock()
world:labScene(scene, VisualTests.SITE)
local s
for _, c in world.storms do
	if c.lab and c.id == "LAB" .. tostring(tonumber(args[4]) or scene.storm.seed) then
		s = c
	end
end
print(string.format("built %s in %.1fs", id, os.clock() - t0))
local function widths(z)
	local live = Storm.liveCloudR(s, z)
	local mem = Storm.memCloudR(s, z)
	return 2 * live / 1000, 2 * mem / 1000
end
local t, nextP = 0, 0
while t <= T do
	if t >= nextP then
		nextP += 300
		local gk = 0
		for _, k in s.gustK or {} do
			gk = math.max(gk, k)
		end
		local l3, m3 = widths(3000)
		local l6, m6 = widths(6000)
		local l9, m9 = widths(9000)
		print(string.format("%5.0f %-5s W %4.1f Ru %4.0f cape %4.0f rkw %.2f gustK %.2f gRkw %.2f | km live/mem 3:%4.1f/%4.1f 6:%4.1f/%4.1f 9:%4.1f/%4.1f vis %.2f | anvil %3.0f km gap %4.1f root %3.1f | rain %5.0f strat %4.0f t/s | tor %s wait %.0f free %.2f",
			t, tostring(s.dead), s.W, s.Ru, s.cape or 0, s.rkw or 0, gk, s.gustRkw or 0, l3, m3, l6, m6, l9, m9, s.cmVis or 0,
			(s.anvilLen or 0) / 1000, (s.anvilGap or 0) / 1000, 2 * (s.anvilRootR or 0) / 1000, (s.precipRate or 0) / 1000, (s.stratRate or 0) / 1000, tostring(s.tornado), s.pin and s.pin.waited or 0, s.pin and s.pin.freeU or 0))
	end
	world:step(10)
	t += 10
	if not table.find(world.storms, s) then
		print("storm removed at", t)
		break
	end
end
print(string.format("done in %.1fs", os.clock() - t0))
