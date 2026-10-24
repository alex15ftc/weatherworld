-- Where the surface hail field is, in the supercell scenario (diagnostic for the hail visuals).
--   luau --codegen tools/stormlab/diag_hail.luau
local Json = require("../../roblox/src/stormlab/shared/Sim/Json")
local World = require("../../roblox/src/stormlab/shared/Sim/World")
local data = Json.decode(require("../../roblox/src/stormlab/data/Supercell"))
local world = World.new(data)
world:spinUp(600)
for step = 1, 4 do
	for _ = 1, 60 do world:step(5) end
	local p = world.precip
	local g = p.hailSize
	local maxH, nH, bx, by = 0, 0, 0, 0
	for k, h in g.v do
		if h > maxH then
			maxH = h
			local i, j = (k - 1) % g.nx, (k - 1) // g.nx
			bx, by = g.x0 + (i + 0.5) * g.dx, g.y0 + (j + 0.5) * g.dx
		end
		if h > 0.5 then nH += 1 end
	end
	local near, nd = nil, math.huge
	for _, s in world.storms do
		local d = math.sqrt((s.x - bx) ^ 2 + (s.y - by) ^ 2)
		if d < nd then near, nd = s, d end
	end
	print(string.format("t=%d min: surface hail max %.2f cm, 1-km cells >0.5 cm: %d; biggest %.1f km from storm %s (hailMax aloft %.1f cm)",
		10 + step * 5, maxH, nH, nd / 1000, near and tostring(near.id) or "-", near and near.hailMax or 0))
end
