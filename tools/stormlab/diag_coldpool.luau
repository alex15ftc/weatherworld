local Json = require("../../roblox/Shared/StormLab/Sim/Json")
local World = require("../../roblox/Shared/StormLab/Sim/World")
-- Cold-pool size and strength every 30 min on both lab days. Set MODE = "old" for the saturated
-- (pre-2026-10-30) downdrafts.
local MODE = "new"
if MODE == "old" then require("../../roblox/Shared/StormLab/Sim/ColdPool").SATURATED = true end
print("== " .. MODE)
for _, name in { "SquallLine", "Supercell" } do
	local world = World.new(Json.decode(require("../../roblox/Shared/StormLab/Data/" .. name)))
	world:spinUp(600)
	for k = 1, 4 do
		for _ = 1, 360 do world:step(5) end
		local cp = world.coldPool
		local mx, n1, n3 = 0, 0, 0
		for _, v in cp.D.v do mx = math.max(mx, v); if v > 1 then n1 += 1 end; if v > 3 then n3 += 1 end end
		local ns, sw, nl = 0, 0, 0
		for _, s in world.storms do if not s.dead then ns += 1; sw += s.W end end
		for _, l in (world.lines or {}) do nl += 1 end
		print(string.format("%-10s t=%3d min: cold pool max %.1f K, area >1 K %4.0f km2, >3 K %4.0f km2 | %d storms, mean W %.0f | lines %d",
			name, k * 30, mx, n1 * 4, n3 * 4, ns, sw / math.max(1, ns), nl))
	end
end
