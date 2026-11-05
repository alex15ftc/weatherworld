-- 2026-11-03: tornado cycling through occlusion (detach), Supercell world
local Json = require("./src/shared/Sim/Json")
local World = require("./src/shared/Sim/World")
local data = Json.decode(require("./src/data/Supercell"))
local world = World.new(data)
world:spinUp(600)
local minutes = tonumber(({...})[1]) or 150
for m = 1, minutes do
	for _ = 1, 60 do world:step(1) end
	for _, t in world.tornadoes do
		if not t.ended or t.endedFor < 61 then
			local o = t.occParent
			print(string.format("m%3d %s %-8s %-9s vc%5.1f rc%4.0f dec%.2f base%4.0f cut%s%s", m, t.id, t.parentKind or "?", t.stage, t.vc, t.rc, t.decay, t.cloudBase,
				t.cut and string.format("(vl%.1f wl%.1f)", t.cut.vlow, t.cut.wLow) or "-",
				o and string.format(" occ vl%.1f wl%.1f occl%.2f cb%.0f base%.0f", o.vlow, o.wLow, o.occl, o.cloudBase or -1, o.base or -1) or ""))
		end
	end
	for _, s in world.storms do
		if s.detached ~= nil or (s.occl or 0) > 0.55 then print(string.format("m%3d storm %s occl%.2f cycle%d vlow%.1f low%.0f", m, s.id, s.occl, s.cycle or 0, s.vlow, s.lowering or 0)) end
	end
end
