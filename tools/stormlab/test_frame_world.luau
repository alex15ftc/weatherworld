-- A storm built only from the engine's record (client/FrameWorld, 2026-11-07): warmed up from
-- nothing in a world holding only the environment, every client builds the same storm.
--   luau tools/stormlab/test_frame_world.luau
local Json = require("../../roblox/Shared/StormLab/Sim/Json")
local World = require("../../roblox/Shared/StormLab/Sim/World")
local Storm = require("../../roblox/Shared/StormLab/Sim/Storm")
local data = Json.decode(require("../../roblox/Shared/StormLab/Data/Supercell"))
local e = data.polls[math.floor(#data.polls / 2)].storms[1]
for _, es in data.polls[math.floor(#data.polls / 2)].storms do
	if es.id == data.meta.focusStorm then e = es end
end
print("engine storm", e.id, "W", e.updraftMs, "meso", e.meso, "low", e.lowRotation, "occl", e.occlusion)
local Environment = require("../../roblox/Shared/StormLab/Sim/Environment")
local ColdPool = require("../../roblox/Shared/StormLab/Sim/ColdPool")
-- the same private world as client/FrameWorld's warm-ups: the environment only, the rain a stub
local env = Environment.new(data)
local function privateWorld(): any
	return setmetatable({
		env = env, coldPool = ColdPool.new(env), storms = {}, tornadoes = {}, boundaries = {},
		systems = { vortices = {}, systems = {}, fronts = {} }, systemsSnap = { systems = {}, vortices = {}, fronts = {} },
		wetness = { sample = function() return 0 end }, events = {}, landspouts = {},
			time = 0, clockUtc = data.meta.simHourUtc, isClient = true,
		precip = { rainRate = { sample = function(_, _x: number, _y: number): number return 20 end } },
	}, { __index = World })
end
local function warm(steps: number, dt: number)
	local w = privateWorld()
	w.storms = {}
	local s = Storm.fromEngine(e, true)
	Storm.setEngine(s, e, e.pos[1], e.pos[2], 0)
	w.time = 0
	local t0 = os.clock()
	for _ = 1, steps do
		w.time += dt
		w.stormClock = w.time
		Storm.step(s, dt, w)
	end
	return s, os.clock() - t0
end
for _, cfg in { { 60, 20 }, { 120, 10 }, { 240, 5 } } do
	local s, t = warm(cfg[1], cfg[2])
	local snap = Storm.snapshot(s)
	print(("%3d steps x %2d s: %.1f ms | W %.1f Ru %.0f base %.0f el %.0f top %.0f lowering %.0f wallBase %s rfd %.1f ffd %.1f occl %.2f rot %.2f eff %s anvil %.0f gustR1 %s cmR1 %s"):format(
		cfg[1], cfg[2], t * 1000, snap.W, snap.Ru, snap.base, snap.el, snap.top, snap.lowering or -1, tostring(snap.wallBase), snap.rfd, snap.ffd, snap.occl, snap.rot,
		tostring(snap.efficiency), snap.anvilLen, tostring(snap.gustR and snap.gustR[1]), tostring(snap.cmR and snap.cmR[3])))
end


-- the tornado (client/FrameWorld): started under the warmed storm, following the engine's
-- (where it is, how strong and wide), warmed TOR_S more
local Tornado = require("../../roblox/Shared/StormLab/Sim/Tornado")
local Vortex = require("../../roblox/Shared/StormLab/Sim/Vortex")
for _, cfg in { { 180, 2 }, { 240, 4 }, { 300, 5 } } do
	local TOR_S, DT = cfg[1], cfg[2]
	local w = privateWorld()
	w.events = {}
	e.baseM, e.loweringM = 1200, 1200 - 449
	local s = Storm.fromEngine(e, true)
	Storm.setEngine(s, e, e.pos[1], e.pos[2], 0)
	table.insert(w.storms, s)
	for _ = 1, 60 do w.time += 20; w.stormClock = w.time; Storm.step(s, 20, w) end
	local t0 = os.clock()
	local t = w:forceTornado(s)
	local lx, ly = Storm.lowMesoAt(s)
	Tornado.setEngine(t, { mph = 185, yards = 700, orbit = 0, R = 113, swirl = 65, base = 449 }, lx, ly, s.u, s.v, w.time, lx, ly)
	for _ = 1, math.floor(TOR_S / DT) do
		w.time += DT; w.stormClock = w.time
		Storm.step(s, DT, w)
		local parent = w:parentOf(t)
		local sub = math.max(1, math.ceil(DT / 0.5))
		for _ = 1, sub do Tornado.step(t, DT / sub, parent, w) end
		t.params = Vortex.params(t)
	end
	local snap = Tornado.snapshot(t)
	print(("storm base %.0f wallBase %.0f lowering %.0f"):format(s.base, s.wallBase, s.lowering))
	print(("tornado %d s x %d s: %.0f ms | vc %.0f rc %.0f swirl %.2f base %.0f stage %s O %.2f decay %.2f ef %s"):format(TOR_S, DT, (os.clock() - t0) * 1000, snap.vc, snap.rc, snap.swirl, snap.cloudBase, tostring(snap.stage), snap.O, snap.decay, tostring(snap.ef)))
end
