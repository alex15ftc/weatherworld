-- Where the air under a storm's base came from (back-trajectories through World.windAt at 150 m)
-- and how far its condensation level sits under the base: the wall cloud's air map
-- (docs/stormlab/PHYSICAL-VOLUME-PLAN.md). Prints an ASCII map round the low meso.
--   luau --codegen tools/stormlab/diag_airmap.luau -a <sceneId>
local Json = require("../../roblox/Shared/StormLab/Sim/Json")
local World = require("../../roblox/Shared/StormLab/Sim/World")
local Storm = require("../../roblox/Shared/StormLab/Sim/Storm")
local VisualTests = require("../../roblox/Shared/StormLab/VisualTests")
local args = { ... }
local sceneId = args[1] or "wedge_rain"
local world = World.new(Json.decode(require("../../roblox/Shared/StormLab/Data/Supercell")))
local scene
for _, sc in VisualTests.SCENES do if sc.id == sceneId then scene = sc end end
local t = world:labScene(scene, VisualTests.SITE)
local s
for _, st in world.storms do if t and tostring(st.id) == tostring(t.parentId) then s = st end end
s = s or world.storms[1]
Storm.prepare(s)
local env, cp = world.env, world.coldPool
local ix, iy = s.x + 0.0, s.y
local tI, tdI = env:surfaceAt(s.x - 8000 * (s.srU or 1) / 10, s.y - 8000 * (s.srV or 1) / 10)
print(string.format("storm base %.0f lowering %.0f wallBase %.0f vlow %.1f Ru %.0f; inflow spread %.1f K", s.base, s.lowering, s.wallBase, s.vlow, s.Ru, tI - tdI))
-- 3-D back-trajectory from (x, y, z): 20 s steps up to 20 min, until it reaches the surface layer
-- (30 m). Returns the air's condensation-level lowering (m, vs the inflow), pool deficit at its
-- origin, origin offset, w here, whether it came up from the surface.
local function airLower(x, y, z0)
	z0 = z0 or (s.base - 150)
	local _, _, w0 = world:windAt(x, y, z0, true)
	local px, py, pz = x, y, z0
	local fromSfc = false
	for _ = 1, 60 do
		local u, v, w = world:windAt(px, py, pz, true)
		px -= u * 20
		py -= v * 20
		pz -= w * 20
		if pz <= 30 then
			fromSfc = true
			break
		end
	end
	if not fromSfc then
		return 0, 0, px - x, py - y, w0, false
	end
	local tS, tdS = env:surfaceAt(px, py)
	local d = cp:deficitAt(px, py)
	local spread = math.max(tS - tdS, 0)
	local tw = tS - spread / 3
	local p = math.clamp(d / math.max(tS - tw, 0.3), 0, 1)
	local tO = tS - d
	local tdO = math.min(tO, tdS + p * (tw - tdS))
	return 125 * ((tI - tdI) - (tO - tdO)), d, px - x, py - y, w0, true
end
local mx, my = s.cLowX, s.cLowY
print(string.format("low meso at %.0f, %.0f (rel storm %.0f, %.0f)", mx, my, mx - s.x, my - s.y))
local N, step = 25, 400
local chars = " .:-=+*#%@"
for j = N, -N, -2 do
	local row = {}
	for i = -N, N do
		local L, d, _, _, w0, sfc = airLower(mx + i * step, my + j * step)
		local ch
		if not sfc then
			ch = if w0 < -0.5 then "v" else " "
		else
			ch = if L <= 30 then "o" else tostring(math.clamp(math.floor(L / 100), 0, 9))
		end
		row[#row + 1] = if i == 0 and j == 0 then "O" else ch
	end
	print(table.concat(row))
end
for _, r in { 0, 500, 1000, 2000, 3000, 5000 } do
	local L, d, ox, oy, w0, sfc = airLower(mx + r, my)
	print(string.format("r %5d E: w %5.1f sfc %s lower %4.0f m  pool %.2f K  origin %.1f, %.1f km", r, w0, tostring(sfc), L, d, ox / 1000, oy / 1000))
end
