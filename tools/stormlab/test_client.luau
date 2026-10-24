-- The client mirror evaluates the same wind as the server, and radar works from it.
local Json = require("../../roblox/src/stormlab/shared/Sim/Json")
local World = require("../../roblox/src/stormlab/shared/Sim/World")
local ClientWorld = require("../../roblox/src/stormlab/shared/Sim/ClientWorld")
local Radar = require("../../roblox/src/stormlab/shared/Sim/Radar")
local Debris = require("../../roblox/src/stormlab/shared/Sim/Debris")
local Damage = require("../../roblox/src/stormlab/shared/Sim/Damage")
local data = Json.decode(require("../../roblox/src/stormlab/data/Supercell"))
local world = World.new(data)
world:spinUp(600)
for _ = 1, 600 do world:step(1) end
local focus = world.storms[4]
world:forceTornado(focus)
for _ = 1, 120 do world:step(0.5) end
local cw = ClientWorld.new(data)
local seen = {}
ClientWorld.applyProfiles(cw, world:profileSnapshot(seen))
ClientWorld.applySnapshot(cw, world:snapshot())
ClientWorld.applyTornadoes(cw, world:tornadoSnapshot())
ClientWorld.applyColdPool(cw, world:packColdPool())
ClientWorld.applyPrecip(cw, world.precip:pack())
local maxErr = 0
for i = 1, 200 do
	local x, y, z = focus.x + (i % 20 - 10) * 1500, focus.y + (i // 20 - 5) * 1500, (i % 7) * 400 + 20
	local u1, v1, w1 = world:windAt(x, y, z, true)
	local u2, v2, w2 = cw:windAt(x, y, z, true)
	maxErr = math.max(maxErr, math.abs(u1 - u2), math.abs(v1 - v2), math.abs(w1 - w2))
end
print(string.format("client vs server wind (no tornado): max diff %.3f m/s (cold pool is packed to 0.25 m/s)", maxErr))
local t = world.tornadoes[1]
print(string.format("tornado %s: vc %.0f rc %.0f stage %s ef %d loft %.2f top %.0f", t.id, t.vc, t.rc, t.stage, t.ef, t.debrisLoft or 0, t.debrisTop or 0))
local u1 = world:windAt(t.x + t.rc, t.y, 20)
local u2 = cw:windAt(t.x + t.rc, t.y, 20)
print(string.format("near the tornado: server %.1f client %.1f", u1, u2))
-- radar: a site 60 km south-west, scan the storm
local site = Radar.site(focus.x - 42000, focus.y - 42000)
local ctx = { vol = cw.vol, wind = function(x, y, z) return cw:windAt(x, y, z) end, tornadoes = cw.tornadoes, coldPool = cw.coldPool, freezing = 3200 }
local t0 = os.clock()
local maxZ, vmin, vmax, ccmin = -99, 0, 0, 1
local n = 0
for az = 30, 60, 0.5 do
	for r = 40000, 80000, 500 do
		local z, vr, cc = Radar.gate(site, ctx, az, r, 0.5)
		n += 1
		if z then
			maxZ = math.max(maxZ, z)
			if z > 20 then vmin = math.min(vmin, vr); vmax = math.max(vmax, vr); ccmin = math.min(ccmin, cc) end
		end
	end
end
print(string.format("radar %d gates in %.0f ms: max %.0f dBZ, Vr %.0f..%.0f m/s, min CC %.2f", n, (os.clock() - t0) * 1000, maxZ, vmin, vmax, ccmin))
-- debris: a board released at the tornado
local p = Debris.new("board", t.x + t.rc * 1.2, t.y, 2, 0, 0, 0, 5)
local maxZp, dist = 0, 0
for _ = 1, 400 do
	Debris.step(p, 0.05, function(x, y, z) return world:windAt(x, y, z) end)
	maxZp = math.max(maxZp, p.z)
end
dist = math.sqrt((p.x - t.x) ^ 2 + (p.y - t.y) ^ 2)
print(string.format("board after 20 s: max height %.0f m, max speed %.0f m/s, %.0f m from the tornado, resting %s", maxZp, p.maxSpeed, dist, tostring(p.resting)))
-- damage: a house under 60 m/s for 5 s
local h = Damage.newStructure("H1", "house", 0, 0, 7, 3)
for _ = 1, 50 do Damage.apply(h, 0.1, 60, 64) end
local ef, mph = Damage.ratingOf(h)
print(string.format("house at 60 m/s: stage %d (%s) -> EF%d (%d mph)", h.stage, h.stageText, ef, mph))
