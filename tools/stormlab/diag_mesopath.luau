-- Along the arc the low meso would travel as it occludes (angle from the storm's heading, at 0.6 Ru),
-- the cold pool's deficit, how liftable that air is, and the storm-relative low-level wind there
-- (tangential: + carries the meso the way occlusion takes it). Phase 2 probe.
--   luau --codegen tools/stormlab/diag_mesopath.luau -a [minute]
local Json = require("../../roblox/src/stormlab/shared/Sim/Json")
local World = require("../../roblox/src/stormlab/shared/Sim/World")
local Storm = require("../../roblox/src/stormlab/shared/Sim/Storm")
local args = { ... }
local at = tonumber(args[1]) or 30
local world = World.new(Json.decode(require("../../roblox/src/stormlab/data/Supercell")))
world:spinUp(600)
for _ = 1, at * 60 do world:step(1) end
local cp = world.coldPool
for _, s in world.storms do
	if not s.dead and (s.rot or 0) > 0.5 then
		local hx, hy = s.u, s.v
		local m = math.sqrt(hx * hx + hy * hy)
		hx, hy = hx / m, hy / m
		print(string.format("storm %s occl %.2f ang %.2f Ru %.0f vlow %.1f rfd %.1f", tostring(s.id), s.occl, s.lowAngle, s.Ru, s.vlow, s.rfd))
		for _, rr in { 0.4, 0.6, 0.9 } do
			for a = 3.2, 0.3, -0.3 do
				local ca, sa = math.cos(a), math.sin(a)
				local ox, oy = hx * ca - hy * sa, hx * sa + hy * ca
				local r = rr * s.Ru
				local x, y = s.x + ox * r, s.y + oy * r
				local d = cp:deficitAt(x, y)
				local hF = cp.depthOf(d)
				local NB = 0.5 * 9.81 * d / 300 * hF
				local wb = s.W * (s.fBase or 0.25)
				local lift = s.vlow * s.vlow + 0.5 * wb * wb
				local u, v, w = world:windAt(x, y, 300, true)
				u -= s.u
				v -= s.v
				-- (tangential: decreasing angle = clockwise for a right mover, the occlusion way)
				local tx, ty = oy, -ox
				local cu, cv = cp:windAt(x, y, 150)
				print(string.format("  r %.1f Ru ang %.1f: deficit %.2f K liftable %.2f | SR wind tang %5.1f rad %5.1f w %5.1f | pool wind tang %5.1f", rr, a, d, lift / (lift + NB + 1), u * tx + v * ty, u * ox + v * oy, w, cu * tx + cv * ty))
			end
		end
	end
end
