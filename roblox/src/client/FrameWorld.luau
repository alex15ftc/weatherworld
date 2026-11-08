--!nonstrict
-- The storms the lab's card renderers draw (StormCards, WallStream, Scud, BaseDeck), built on this
-- client from what every server is sent alike (2026-11-07, the user: storms must look the same
-- across servers). Until now they drew each server's own lab sim (server/StormHost), which runs on
-- from when that server started, with its own cold pool and outflow: the same engine storm looked
-- different on every server.
--
-- Each storm comes from the engine's numbers for it (the storm-frames bundle's look record,
-- client/LiveStorms: position, motion, updraught, size, rotation, occlusion, age, anvil) through
-- the lab's own rules (Sim/Storm.fromEngine, then Storm.step following the engine): warmed up
-- from nothing for WARM_S of sim time in a world holding only the environment (no cold pool, no
-- other storms, nothing from before), so the same numbers give the same storm on every client.
-- Its updraught's shape, cloud, anvil, wall cloud, rear-flank downdraught and occlusion all come
-- out of that; the rain is the frames' (EngineStorms.precipAt, as cw.vol). It is rebuilt when a new look comes (each frame from the server,
-- ~7.5 s), a few steps a frame so it never stalls a frame, and between builds it moves on at its
-- motion (StormCards extrapolates from cw.time like any snapshot).
-- Its tornado (2026-11-07, the user: the lab's card tornado, fed the shared numbers): while the
-- frame has one, the lab's Tornado is started under the storm for the last TOR_S of the warm-up,
-- following the engine's - where the frame puts it, as strong and wide as the engine says
-- (Tornado.setEngine) - and its snapshot is published as the server's were (cw.tornadoes, the
-- tornado signal), so TornadoCards and TornadoDust draw it: the same on every server, standing
-- where the engine's tornado is (in the lab sim it stood ~2.5 km off).
--   FrameWorld.attach(ctx, LiveStorms, EngineStorms, sim)   sim(xKm, yKm) -> lab metres
local FrameWorld = {}

local WARM_S = 1200 -- sim seconds a storm is warmed up over (offline: 60 steps ~60 ms a storm)
local WARM_DT = 20
local STEPS_A_FRAME = 6
local PUBLISH_S = 0.5 -- cw.storms is re-published this often (real s), as the server's snapshots
local CLOCK = 8 -- game seconds a real second (server/LiveStorms CLOCK: ue, ve are m a real second)
local TOR_S = 180 -- the tornado's warm-up (offline: 90 steps ~140 ms; its eases are 20-90 s)
local TOR_DT = 2
local HAIL_CM = 3 -- a frame's hail share as the lab's hail size (cm), for the cards' hail tint

-- (positions in a snapshot, moved on together)
local POS = { { "x", "y" }, { "lowX", "lowY" }, { "ffdX", "ffdY" }, { "rfdX", "rfdY" } }

function FrameWorld.attach(ctx: any, LiveStorms: any, EngineStorms: any, sim: (number, number) -> (number, number))
	local cw = ctx.cw
	local Sim = ctx.Sim
	local Storm, World, ColdPool = Sim.Storm, Sim.World, Sim.ColdPool
	local Tornado, Vortex, Noise = Sim.Tornado, Sim.Vortex, Sim.Noise
	local ClientWorld = Sim.ClientWorld
	-- (the engine vortex as the frames give it - the TornadoDebug overlay's numbers)
	local CM = game:GetService("ReplicatedStorage").Shared:WaitForChild("CloudModel")
	local VA = require(CM:WaitForChild("VisualAtmosphere")) :: any
	local TornadoViewM = require(CM:WaitForChild("TornadoView")) :: any
	ctx.frameFed = true -- (stormlab/client/Net: the server's own storms, tornadoes, cold pool and rain are not taken)

	-- the rain: the frames' (Precip.surface reads surfaceAt; nxv and x0 keep the "no volume" tests happy)
	cw.vol = {
		nxv = 1, x0 = -1e9,
		surfaceAt = function(x: number, y: number): (number, number)
			local r, h = EngineStorms.precipAt(ctx.Config.toWorld(x, y, 0))
			return r, h * HAIL_CM
		end,
	}
	cw.coldPool = ColdPool.new(cw.env)
	cw.tornadoes = {}

	-- a private world for the warm-ups: the environment only
	local function warmWorld(): any
		return setmetatable({
			env = cw.env, coldPool = ColdPool.new(cw.env), storms = {}, tornadoes = {}, boundaries = {},
			systems = { vortices = {}, systems = {}, fronts = {} }, systemsSnap = { systems = {}, vortices = {}, fronts = {} },
			wetness = { sample = function() return 0 end }, events = {}, landspouts = {},
			time = 0, clockUtc = cw.clockUtc, isClient = true,
			-- (the rain its downdraughts feel: the frames', as the cards see it; Storm.step samples it)
			precip = { rainRate = { sample = function(_, x: number, y: number): number
				return (cw.vol.surfaceAt(x, y))
			end } },
		}, { __index = World })
	end

	-- id -> { key (the look it was built from), snap, at (ctx:simTime() it is valid at), u, v }
	local built: { [string]: any } = {}
	local buildSeq = 0
	local queue: { string } = {}
	local queued: { [string]: boolean } = {}

	-- (what the warm-up is built from, without the storm's place: a look that has only moved is
	-- not built again, its snapshot is moved - the server moves every storm at each send, so with
	-- the place in the key every frame rebuilt, ~60-250 ms of steps a storm, 2026-11-07)
	local function lookKey(look: any, tor: any?): string
		local k = ("%.2f,%.3f,%.3f,%.3f,%.1f,%.2f,%.1f,%.1f,%.0f,%.0f"):format(look.updraftMs, look.meso, look.lowRotation, look.occlusion, look.ageMin, look.radiusKm, look.anvilKm, look.tornadoMph, look.baseM or 0, look.loweringM or 0)
		if tor then
			k ..= ("|%.0f,%.0f,%.0f"):format((tor.R or 0) / 10, (tor.swirl or 0) / 2, (tor.base or 0) / 50)
		end
		return k
	end

	local function want(id: string)
		if not queued[id] then
			queued[id] = true
			table.insert(queue, id)
		end
	end

	-- one storm, built from its look (yields between batches of steps)
	local function build(id: string)
		local ls = LiveStorms.storms[id]
		if not ls or not ls.look then
			built[id] = nil
			return
		end
		local look = ls.look
		local age = os.clock() - ls.at -- (the look came this long ago: moved on to now)
		local xKm, yKm = look.xKm + ls.ue * age / 1000, look.yKm - ls.ve * age / 1000
		local x, y = sim(xKm, yKm)
		local at = ctx:simTime() -- (when it is there)
		local u, v = ls.ue / CLOCK, ls.ve / CLOCK -- (m a sim second)
		local e = {
			id = id,
			pos = { x - u * WARM_S, y - v * WARM_S }, -- (where it was WARM_S ago: it ends the warm-up here)
			motion = { u, v },
			updraftMs = look.updraftMs, meso = look.meso, lowRotation = look.lowRotation, occlusion = look.occlusion,
			ageMin = math.max(0, look.ageMin - WARM_S / 60), leftMover = look.leftMover,
			feed = { updraft = { radiusKm = math.max(look.radiusKm, 0.1) }, anvil = { lengthKm = look.anvilKm } },
			tornado = if look.tornadoMph > 0 then { mph = look.tornadoMph } else nil,
		}
		-- the frame's tornado, where the engine has it (box metres from the frame's anchor, which is
		-- at the bundle's position: as EngineStorms places TornadoView)
		local ft = ls.frame and ls.frame.tornado
		local tor = nil
		if ft and (ft.mph or 0) > 0 then
			local f = ls.frame
			local tx, ty = sim(ls.xKm + ls.ue * age / 1000 + (ft.x - f.anchorX) / 1000, ls.yKm - ls.ve * age / 1000 - (ft.y - f.anchorY) / 1000)
			-- its core radius, swirl and cloud base as the frames have them (VisualAtmosphere.vortexFrom,
			-- the debug overlay's: the swirl is the engine's rating less the tornado's own motion)
			local vx = VA.vortexFrom(f)
			tor = { x = tx, y = ty, mph = ft.mph, yards = math.max(ft.yards or 0, 20),
				R = vx and vx.R or nil, swirl = vx and vx.V or nil, base = if vx and vx.Bt > 0 then vx.Bt else nil }
			-- its lean: where the engine's funnel meets the cloud base, from its ground point (the
			-- frame's levels, m east and north - the overlay's "lean at base"), in lab metres
			if vx and vx.Bt > 0 then
				local dx, dy = VA.leanAt(vx.levels, vx.Bt)
				local bx, by = sim(ls.xKm + ls.ue * age / 1000 + (ft.x - f.anchorX + dx) / 1000, ls.yKm - ls.ve * age / 1000 - (ft.y - f.anchorY + dy) / 1000)
				tor.leanX, tor.leanY = bx - tx, by - ty
			end
		end
		local key = lookKey(look, tor)
		local b = built[id]
		if b and b.key == key then
			-- only moved: the snapshot carried on to now, then put where the engine has it
			local dt = at - b.at
			local dx, dy = x - (b.snap.x + b.u * dt), y - (b.snap.y + b.v * dt)
			for _, pq in POS do
				local px, py = b.snap[pq[1]], b.snap[pq[2]]
				if px and py then
					b.snap[pq[1]], b.snap[pq[2]] = px + b.u * dt + dx, py + b.v * dt + dy
				end
			end
			if b.tor and tor then
				b.tor.x, b.tor.y = tor.x, tor.y
			end
			b.at, b.u, b.v = at, u, v
			return
		end
		-- the engine's cloud base and wall cloud; with a tornado the wall cloud is lowered to the
		-- base over it, so the storm's wall cloud and the funnel's top are the same height
		e.baseM = if (look.baseM or 0) > 0 then look.baseM else nil
		e.loweringM = look.loweringM
		if e.baseM and tor and tor.base then
			e.loweringM = math.max(0, e.baseM - tor.base)
		end
		local w = warmWorld()
		local s = Storm.fromEngine(e, true)
		s.id = id
		local digits = string.match(id, "%d+")
		s.seed = if digits then tonumber(digits) or 1 else 1
		table.insert(w.storms, s)
		local tWarm = if tor then TOR_S else 0
		local steps = math.floor((WARM_S - tWarm) / WARM_DT)
		for k = 1, steps do
			w.time += WARM_DT
			w.stormClock = w.time
			Storm.step(s, WARM_DT, w)
			if k % STEPS_A_FRAME == 0 then task.wait() end
		end
		local t = nil
		if tor then
			t = w:forceTornado(s)
			if t then
				-- (its own draws from the storm alone: Tornado.new seeds from a counter of every
				-- tornado this client has made)
				t.id = "T" .. id
				t.seed = (s.seed * 31 + 977) % 100000
				local rng = Noise.rng(t.seed)
				t.quality = math.clamp(math.exp(0.32 * rng:normal()), 0.55, 1.8)
				t.bendPhase = rng:range(0, 6.28)
				-- (where it will be at the warm-up's end is the frame's place: started that far back)
				local lx, ly = Storm.lowMesoAt(s)
				Tornado.setEngine(t, { mph = tor.mph, yards = tor.yards, orbit = 0, R = tor.R, swirl = tor.swirl, base = tor.base, leanX = tor.leanX, leanY = tor.leanY }, tor.x - u * tWarm, tor.y - v * tWarm, u, v, w.time, lx, ly)
				-- (it is already down in the engine: started at its size, wind and base, not spun up)
				t.rc = tor.R or t.rc
				t.vc = tor.swirl or t.vc
				t.cloudBase = tor.base or t.cloudBase
				t.topX, t.topY = tor.leanX or t.topX, tor.leanY or t.topY
			end
		end
		local nT = math.floor(tWarm / TOR_DT)
		for k = 1, nT do
			w.time += TOR_DT
			w.stormClock = w.time
			Storm.step(s, TOR_DT, w)
			if t then
				local parent = w:parentOf(t)
				local sub = math.max(1, math.ceil(TOR_DT / 0.5))
				for _ = 1, sub do Tornado.step(t, TOR_DT / sub, parent, w) end
			end
			if k % 3 == 0 then task.wait() end
		end
		local tSnap = nil
		if t and not t.ended then
			t.params = Vortex.params(t)
			tSnap = Tornado.snapshot(t)
			tSnap.parentId = id
		end
		local snap = Storm.snapshot(s)
		snap.id = id
		buildSeq += 1
		snap.buildId = buildSeq -- (Render/StormCards: re-plans a storm only when this changes)
		snap.wprof, snap.tiltX, snap.tiltY = s.wprof, s.tiltX, s.tiltY
		built[id] = { key = key, snap = snap, at = at, u = u, v = v, tor = tSnap }
		-- (the TornadoDebug overlay shows the card tornado beside the engine's)
		TornadoViewM.cards[id] = if tSnap then { vc = tSnap.vc, rc = tSnap.rc, base = tSnap.cloudBase, wallBase = snap.wallBase, stormBase = snap.base } else nil
		if workspace:GetAttribute("EngineStormsDebugCam") == true then
			local lw = ctx.Config.toWorld(snap.lowX or snap.x, snap.lowY or snap.y, 0)
			print(("[FrameWorld] %s built: low meso at studs %.0f, %.0f | W %.1f Ru %.0f base %.0f el %.0f top %.0f lowering %.0f rot %.2f occl %.2f anvil %.0f km | motion %.1f, %.1f m/s"):format(
				id, lw.X, lw.Z, snap.W, snap.Ru, snap.base, snap.el, snap.top, snap.lowering or 0, snap.rot or 0, snap.occl or 0, (snap.anvilLen or 0) / 1000, u, v))
			if tSnap then
				local tw = ctx.Config.toWorld(tSnap.x, tSnap.y, 0)
				print(("[FrameWorld] %s tornado: at studs %.0f, %.0f | vc %.0f m/s rc %.0f m swirl %.2f base %.0f stage %s | engine: swirl %.0f m/s R %.0f m base %.0f m"):format(id, tw.X, tw.Z, tSnap.vc, tSnap.rc, tSnap.swirl, tSnap.cloudBase, tostring(tSnap.stage), tor.swirl or 0, tor.R or 0, tor.base or 0))
			end
		end
	end

	task.spawn(function()
		while true do
			local id = table.remove(queue, 1)
			if id then
				queued[id] = nil
				local ok, err = pcall(build, id)
				if not ok then warn("[FrameWorld] " .. id .. ": " .. tostring(err)) end
			else
				task.wait(0.1)
			end
		end
	end)

	LiveStorms.changed:Connect(function(id: string)
		if LiveStorms.storms[id] then
			want(id)
		else
			built[id] = nil
			TornadoViewM.cards[id] = nil
		end
	end)
	for id in LiveStorms.storms do want(id) end

	-- the published storms: each snapshot moved on to now
	local lastPub = 0
	game:GetService("RunService").Heartbeat:Connect(function()
		local c = os.clock()
		if c - lastPub < PUBLISH_S then return end
		lastPub = c
		local now = ctx:simTime()
		local storms, tors = {}, {}
		for id, b in built do
			if LiveStorms.storms[id] then
				if b.tor then
					-- (stamped when it was there: Tornado/StateAdapter carries it on at its motion)
					local tt = table.clone(b.tor)
					tt.simAt = b.at
					table.insert(tors, tt)
				end
				local s = table.clone(b.snap)
				local dt = now - b.at
				for _, pq in POS do
					local px, py = s[pq[1]], s[pq[2]]
					if px and py then
						s[pq[1]], s[pq[2]] = px + b.u * dt, py + b.v * dt
					end
				end
				Storm.prepare(s)
				table.insert(storms, s)
			else
				built[id] = nil
			end
		end
		cw.time = now
		cw.storms = storms
		World.rebuildBuckets(cw)
		ClientWorld.applyTornadoes(cw, tors)
		ctx.signals.tornado:Fire(tors)
	end)
end

return FrameWorld
