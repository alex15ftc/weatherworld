-- Wall cloud lowering over a lab run (Storm.update's wet-bulb mixing): per rotating storm, the
-- cloud base, the lowering and the wall cloud's base above the ground, every 5 sim minutes.
--   luau --codegen tools/stormlab/diag_wallcloud.luau
local Json = require("../../roblox/src/stormlab/shared/Sim/Json")
local World = require("../../roblox/src/stormlab/shared/Sim/World")
local name = "Supercell"
local data = Json.decode(require("../../roblox/src/stormlab/data/" .. name))
local world = World.new(data)
world:spinUp(600)
for step = 1, 8 do
	for _ = 1, 60 do
		world:step(5)
	end
	local line = {}
	for _, s in world.storms do
		if not s.dead and (s.rot or 0) > 0.25 then
			table.insert(line, string.format("%s rot %.2f base %4.0f lowering %4.0f wall %4.0f m vlow %4.1f", tostring(s.id), s.rot, s.base, s.lowering, s.wallBase, s.vlow))
		end
	end
	print(string.format("t=%3d min  %s", math.floor(world.time / 60), table.concat(line, " | ")))
end
