-- Funnel reach per free-running tornado (positioning plan 3.5): every 5 min, each tornado's
-- strength, core, cloud base (the parent's wall-cloud base) and how far the condensation funnel
-- reaches below it - the lowest height with a funnel, as a share of the base - next to the
-- cyclostrophic estimate L = I(0) vc^2 / g.
--   luau --codegen tools/stormlab/diag_funnel.luau   (scenario: first line below)
local name = "Supercell"
local QUIET = true
local Json = require("../../roblox/src/stormlab/shared/Sim/Json")
local World = require("../../roblox/src/stormlab/shared/Sim/World")
local Vortex = require("../../roblox/src/stormlab/shared/Sim/Vortex")
local Storm = require("../../roblox/src/stormlab/shared/Sim/Storm")
local MODE = "now"
if MODE == "angles" then Storm.PRECIP_RELEASE = "angles" end
local world = World.new(Json.decode(require("../../roblox/src/stormlab/data/" .. name)))
world:spinUp(600)
local reach, n, seen, nSeen = {}, {}, {}, 0
for step = 1, 24 do
	for _ = 1, 60 do
		world:step(5)
	end
	for _, t in world.tornadoes do
		if not seen[t] then seen[t] = true; nSeen += 1 end
		if not t.ended and t.vc and t.vc > 0 then
			local zb = t.cloudBase
			local low = zb
			for z = zb - 10, 0, -10 do
				if Vortex.condensationRadius(t, math.max(z, 5)) > 0 then
					low = z
				else
					break
				end
			end
			local L = Vortex.CENTRAL_DEFICIT * t.vc * t.vc / 9.81
			if not QUIET then print(string.format("t=%3d min %s %-8s EF%d vc %4.1f rc %3.0f base %4.0f funnel to %4.0f m (%3.0f%% down) L %4.0f | ground r %3.0f",
				step * 5, tostring(t.id), tostring(t.stage), t.ef or -1, t.vc, t.rc, zb, low, 100 * (zb - low) / zb, L, t.funnelGround or 0)) end
			local ef = math.max(0, t.ef or 0)
			reach[ef] = (reach[ef] or 0) + (zb - low) / zb
			n[ef] = (n[ef] or 0) + 1
		end
	end
end
print(string.format("%s [%s]: %d tornadoes in 2 h", name, MODE, nSeen))
for ef = 0, 5 do
	if n[ef] then
		print(string.format("  EF%d: %d samples, funnel reaches %.0f%% of the way down on average", ef, n[ef], 100 * reach[ef] / n[ef]))
	end
end
