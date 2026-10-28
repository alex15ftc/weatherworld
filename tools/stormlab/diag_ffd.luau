local Json = require("../../roblox/src/stormlab/shared/Sim/Json")
local World = require("../../roblox/src/stormlab/shared/Sim/World")
local Storm = require("../../roblox/src/stormlab/shared/Sim/Storm")
local data = Json.decode(require("../../roblox/src/stormlab/data/Supercell"))
local world = World.new(data)
world:spinUp(600)
for _ = 1, 360 do world:step(5) end
for _, s in world.storms do
	if not s.dead and s.rot > 0.5 then
		local fx, fy = Storm.ffdAt(s)
		local hx, hy = s.u / math.max(1, math.sqrt(s.u^2+s.v^2)), s.v / math.max(1, math.sqrt(s.u^2+s.v^2))
		local line = {}
		for _, k in { -6, -3, 0, 3, 6, 9 } do
			local x, y = fx + hx * k * 1000, fy + hy * k * 1000
			local d = world.coldPool:deficitAt(x, y)
			table.insert(line, string.format("%+dkm D%.1f r%.0f dd%.1f", k, d, world.precip.rainRate:sample(x, y), world.env.fields.ddDeficit:sample(x, y)))
		end
		print(s.id, table.concat(line, " | "))
		-- the heaviest surface rain within 15 km and the pool there
		local best, bx, by = 0, 0, 0
		for i = -15, 15 do for j = -15, 15 do
			local x, y = s.x + i * 1000, s.y + j * 1000
			local r = world.precip.rainRate:sample(x, y)
			if r > best then best, bx, by = r, x, y end
		end end
		print(string.format("   max rain %.0f mm/h at (%.1f, %.1f) km from storm, D there %.1f; ffd at (%.1f, %.1f)", best, (bx - s.x)/1000, (by - s.y)/1000, world.coldPool:deficitAt(bx, by), (fx - s.x)/1000, (fy - s.y)/1000))
	end
end
