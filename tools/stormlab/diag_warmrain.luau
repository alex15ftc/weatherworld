-- Warm rain in the lab sim (2026-11-18, Storm.WARM_RAIN): each supercell scene with and without it. Prints the
-- strongest live storm's inflow vapour, warm cloud depth and warm-rain share, and where its surface rain falls
-- against the low mesocyclone: the share of the rain rate within 5 km of it and the rain-weighted mean distance.
--   luau --codegen tools/stormlab/diag_warmrain.luau
local Json = require("../../roblox/Shared/StormLab/Sim/Json")
local World = require("../../roblox/Shared/StormLab/Sim/World")
local Storm = require("../../roblox/Shared/StormLab/Sim/Storm")

local scenes = {
	Supercell = require("../../roblox/Shared/StormLab/Data/Supercell"),
	SupercellB = require("../../roblox/Shared/StormLab/Data/SupercellB"),
	SupercellLife = require("../../roblox/Shared/StormLab/Data/SupercellLife"),
	Wedge9 = require("../../roblox/Shared/StormLab/Data/Wedge9"),
}

local function run(name, share)
	Storm.WARM_RAIN.share = share
	local world = World.new(Json.decode(scenes[name]))
	world:spinUp(900)
	for _ = 1, 600 do
		world:step(1)
	end
	local s
	for _, c in world.storms do
		if not c.dead and (not s or c.W > s.W) then
			s = c
		end
	end
	if not s then
		return print(name, "no live storm")
	end
	local lx, ly = Storm.lowMesoAt(s)
	local g = world.precip.rainRate
	local total, near, dist = 0, 0, 0
	for j = 1, g.ny do
		for i = 1, g.nx do
			local r = g.v[i + (j - 1) * g.nx]
			if r > 1 then
				local d = math.sqrt((g.x0 + (i - 0.5) * g.dx - lx) ^ 2 + (g.y0 + (j - 0.5) * g.dx - ly) ^ 2) / 1000
				total += r
				dist += r * d
				if d <= 5 then
					near += r
				end
			end
		end
	end
	print(
		string.format(
			"%-13s share %.1f | vapour %.1f g/m3, warm depth %.0f m, warm rain %.2f | rain within 5 km of the low meso %.1f%%, mean distance %.1f km, max %.0f mm/h",
			name,
			share,
			s.inflowVapour or 0,
			(s.freezing or 0) - s.base,
			Storm.warmRainOf(s),
			100 * near / math.max(total, 1e-9),
			dist / math.max(total, 1e-9),
			g:max()
		)
	)
end

for _, name in { "Supercell", "SupercellB", "SupercellLife", "Wedge9" } do
	run(name, 0)
	run(name, 0.5)
end
