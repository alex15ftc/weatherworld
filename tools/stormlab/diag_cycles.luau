-- The lab's own storms' occlusion cycles and tornadoes over a run (phase 2 of
-- docs/stormlab/PHYSICAL-VOLUME-PLAN.md): per rotating storm each 2 min, the occlusion (occl, cycle,
-- the low meso's angle) and the physical measures it should come from - the cold pool's deficit
-- under the low meso and how much of that air the circulation can lift - and every tornado's start
-- and end. Ends with a summary (cycles, tornadoes, lives, cut-offs).
--   luau --codegen tools/stormlab/diag_cycles.luau -a [minutes] [quiet|-] [clock | front [mesoK]]
-- (the gust front is the default since 2026-11-03; clock: the old occlusion clock)
local Json = require("../../roblox/src/stormlab/shared/Sim/Json")
local World = require("../../roblox/src/stormlab/shared/Sim/World")
local Storm = require("../../roblox/src/stormlab/shared/Sim/Storm")
local args = { ... }
local minutes = tonumber(args[1]) or 120
local quiet = args[2] == "quiet"
if args[3] == "clock" then
	Storm.GUST_FRONT = false -- (the old occlusion clock)
elseif args[3] == "front" then
	Storm.GUST_FRONT = true -- (the gust-front occlusion, Sim/GustFront)
	if args[4] then
		Storm.GF_MESO_K = tonumber(args[4]) -- (the meso spin share the cold air feels)
	end
end
local data = Json.decode(require("../../roblox/src/stormlab/data/Supercell"))
local world = World.new(data)
world:spinUp(600)
local cp = world.coldPool
local seen, tors = {}, {}
local cycles = {}
local function liftAt(s, x, y)
	local d = cp:deficitAt(x, y)
	local hF = cp.depthOf(d)
	local NB = 0.5 * 9.81 * d / 300 * hF
	local wb = (if s.dead then 0 else s.W) * (s.fBase or 0.25)
	local lift = s.vlow * s.vlow + 0.5 * wb * wb
	return d, lift / (lift + NB + 1)
end
for m = 1, minutes do
	for _ = 1, 60 do
		world:step(1)
	end
	for _, t in world.tornadoes do
		local k = tostring(t)
		if not seen[k] then
			seen[k] = { born = m, parent = t.parentId, peak = 0 }
			table.insert(tors, seen[k])
			print(string.format("  m %3d  TORNADO start  storm %s", m, tostring(t.parentId)))
		end
		local r = seen[k]
		r.peak = math.max(r.peak, t.vc or 0)
		if t.ended and not r.died then
			r.died = m
			print(string.format("  m %3d  TORNADO end    storm %s life %d min peak vc %.0f  (parent occl %.2f)", m, tostring(t.parentId), m - r.born, r.peak, r.occlAtEnd or -1))
		end
		if not t.ended then
			for _, s in world.storms do
				if tostring(s.id) == tostring(t.parentId) then
					r.occlAtEnd = s.occl
				end
			end
		end
	end
	for _, s in world.storms do
		if not s.dead and (s.rot or 0) > 0.3 then
			cycles[s.id] = math.max(cycles[s.id] or 0, s.cycle or 0)
			if m % 2 == 0 and not quiet then
				local lx, ly = Storm.lowMesoAt(s)
				local d, lf = liftAt(s, lx, ly)
				print(string.format("m %3d %s W %4.1f rot %.2f vlow %4.1f rfd %4.1f | occl %.2f cyc %d ang %.2f | meso deficit %.2f K liftable %.2f | genesis %.2f", m, tostring(s.id), s.W, s.rot, s.vlow, s.rfd or 0, s.occl, s.cycle or 0, s.lowAngle, d, lf, s.genesisDrive or 0))
			end
		end
	end
end
local nc, nt, life, ended = 0, #tors, 0, 0
for _, c in cycles do nc += c end
for _, r in tors do if r.died then ended += 1; life += r.died - r.born end end
print(string.format("SUMMARY %d min: %d rotating storms, %d occlusion cycles, %d tornadoes (%d ended, mean life %.1f min)", minutes, (function() local n = 0; for _ in cycles do n += 1 end; return n end)(), nc, nt, ended, if ended > 0 then life / ended else 0))
