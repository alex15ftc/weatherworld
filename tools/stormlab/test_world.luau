-- Offline run of the whole lab atmosphere from an engine scenario.
--   luau tools/stormlab/test_world.luau -a Supercell 90
local Json = require("../../roblox/src/stormlab/shared/Sim/Json")
local World = require("../../roblox/src/stormlab/shared/Sim/World")
local Vortex = require("../../roblox/src/stormlab/shared/Sim/Vortex")
local args = { ... }
local name = args[1] or "Supercell"
local minutes = tonumber(args[2]) or 60
local scen = name == "SquallLine" and require("../../roblox/src/stormlab/data/SquallLine") or require("../../roblox/src/stormlab/data/Supercell")
local data = Json.decode(scen)
local t0 = os.clock()
local world = World.new(data)
print(string.format("world built in %.2f s; %d storms", os.clock() - t0, #world.storms))
t0 = os.clock()
world:spinUp(600)
print(string.format("spin-up 10 min in %.2f s; parcels %d", os.clock() - t0, world.precip.n))
local focusId
for _, s in world.storms do if s.engineId == data.meta.focusStorm then focusId = s.id end end
local engineTrack = {}
for _, p in data.track do engineTrack[p.min] = p end
local wall = os.clock()
for m = 1, minutes do
	if m % 15 == 0 then for _, sys in world.systems.systems do local cs, ds, rs, rij, bow, tend, n = 0, 0, 0, 0, 0, 0, 0; for _, seg in sys.segments do n += 1; cs += seg.c; ds += seg.du; rs += seg.r; rij = math.max(rij, seg.rij); bow = math.max(bow, seg.bow); tend = math.max(tend, seg.mvTendency or 0) end; print(string.format("    system %s %s len %.0f km age %.0f min: c %.1f du %.1f r %.2f rij %.1f bow %.0f mvTend %.2f", sys.id, sys.mode, sys.length / 1000, sys.age / 60, cs / n, ds / n, rs / n, rij, bow, tend)) end end
	local c0 = os.clock()
	for _ = 1, 60 do world:step(1) end
	local cost = os.clock() - c0
	if m % 5 == 0 then
		local f
		for _, s in world.storms do if s.id == focusId then f = s end end
		local live, maxW = 0, 0
		for _, s in world.storms do if not s.dead then live += 1; maxW = math.max(maxW, s.W) end end
		local maxDbz = -99
		for _, d in world.precip.dbz do if d > maxDbz then maxDbz = d end end
		local cpMax = world.coldPool.D:max()
		local tors = {}
		for _, t in world.tornadoes do
			table.insert(tors, string.format("%s %s vc%.0f rc%.0f S%.2f EF%d fun%.0f", t.id, t.stage, t.vc, t.rc, t.swirl, t.ef, t.funnelGround or 0))
		end
		local e = engineTrack[m] or engineTrack[m - 1] or engineTrack[m + 1]
		local st = world.precip.stats
		print(string.format("t+%3dmin  cost %.2fs/min  live %d maxW %.0f  parcels %d  maxDbz %.0f  coldPool %.1fK  systems %d vort %d  evap%% %.0f",
			m, cost, live, maxW, world.precip.n, maxDbz, cpMax, #world.systems.systems, #world.systems.vortices, 100 * st.evaporated / math.max(1, st.emitted)))
		if f then -- (focus storm)
			print(string.format("    ddDef %.1f  rain max %.0f mm/h", world.env:field("ddDeficit", f.x, f.y), world.precip.rainRate:max()))
			print(string.format("    focus %s W%.0f Ru%.0f vmid%.1f vlow%.1f rot%.2f G%.2f drive%.2f occl%.2f cyc%d rfd%.1f rfdDef%.1f low%.0f cape%.0f cin%.0f srh1 %.0f lcl%.0f hail%.1f flash%.0f dead%s",
				f.id, f.W, f.Ru, f.vmid, f.vlow, f.rot, f.G, f.genesisDrive or 0, f.occl, f.cycle, f.rfd, f.rfdDeficit or 0, f.lowering, f.cape, f.cin, f.srh01, f.lcl, f.hailMax, f.lightning, tostring(f.dead)))
		end
		if e then print(string.format("    engine: int %.2f meso %.2f low %.2f %s", e.intensity, e.meso, e.lowRotation, e.tornado and ("TOR " .. e.tornado.mph .. " mph") or "")) end
		if #tors > 0 then print("    " .. table.concat(tors, " | ")) end
	end
end
print(string.format("total %.1f s for %d sim min", os.clock() - wall, minutes))
for _, sys in world.systems.systems do
	local cs, ds, rs, rij, bow, tend, n = 0, 0, 0, 0, 0, 0, 0
	for _, seg in sys.segments do
		n += 1; cs += seg.c; ds += seg.du; rs += seg.r
		rij = math.max(rij, seg.rij); bow = math.max(bow, seg.bow); tend = math.max(tend, seg.mvTendency or 0)
	end
	print(string.format("system %s %s len %.0f km age %.0f min: c %.1f du %.1f r %.2f  max rij %.1f bow %.0f m mvTend %.2f",
		sys.id, sys.mode, sys.length / 1000, sys.age / 60, cs / n, ds / n, rs / n, rij, bow, tend))
end
