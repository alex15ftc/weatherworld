--!nonstrict
-- The storms the lab's card renderers draw (StormCards, WallStream, Scud, BaseDeck), built on this
-- client from what every server is sent alike (2026-11-07, the user: storms must look the same
-- across servers). Until now they drew each server's own lab sim (StormHostService), which runs on
-- from when that server started, with its own cold pool and outflow: the same engine storm looked
-- different on every server.
--
-- Each storm comes from the engine's numbers for it (the storm-frames bundle's look record,
-- LiveStormsController: position, motion, updraught, size, rotation, occlusion, age, anvil) through
-- the lab's own rules (Sim/Storm.fromEngine, then Storm.step following the engine): warmed up
-- from nothing for WARM_S of sim time in a world holding only the environment (no cold pool, no
-- other storms, nothing from before), so the same numbers give the same storm on every client.
-- Its updraught's shape, cloud, anvil, wall cloud, rear-flank downdraught and occlusion all come
-- out of that; the rain is the frames' (EngineStorms.precipAt, as cw.vol). It is warmed up once,
-- when it first comes (a few steps a frame so it never stalls a frame), and from then on it runs:
-- stepped on with the sim clock and given each new look as the engine's word (Storm.setEngine,
-- Tornado.setEngine), which its own steps ease in - so it evolves from one engine moment to the
-- next instead of being rebuilt at each (2026-11-08: rebuilt per look, it changed shape every
-- 37.5 s). Two clients that came at different times differ only by what that easing (~60 s) has
-- not yet drawn together.
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
local STEP_BUDGET = 0.002 -- real s of warm-up steps a frame before it yields (the same steps, spread by time)
local PLAN_S = 3 -- (real s: how often an evolving storm's cards are re-planned)
local PUBLISH_S = 0.5 -- cw.storms is re-published this often (real s), as the server's snapshots
local CLOCK = 8 -- game seconds a real second (LiveStormsService CLOCK: ue, ve are m a real second)
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
	ctx.frameFed = true -- (Modules/Weather/Net: the server's own storms, tornadoes, cold pool and rain are not taken)

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

	-- ...and as 1 km surface columns round the camera (Sim/Precip's VOX), for the rain curtains
	-- (Render/RainShafts bins vol.rain by column; every other reader takes surfaceAt). The column
	-- numbers span a 1000 km square about the sim origin; only those within RAIN_KM of the camera
	-- with rain are kept, refilled every RAIN_S from the frames.
	local VOXM, HALF_COLS, RAIN_KM, RAIN_S = 1000, 500, 30, 10
	-- (and out to the storms' draw range every 2nd column, each sample filling its 2 x 2 block:
	-- Render/CloudParts/Shafts bins columns past 14 km into 4 km cells anyway. Within RAIN_KM alone
	-- a storm seen from 40 km had no rain curtain under it at all, regrade 10)
	local WorldConfig = require(game:GetService("ReplicatedStorage").Shared.World.Config) :: any
	local FAR_KM = math.floor((WorldConfig.STORM_VIEW_MILES or 60) * 1.609344)
	local nxv = 2 * HALF_COLS
	cw.vol.nxv, cw.vol.x0 = nxv, -HALF_COLS * VOXM
	cw.vol.rain, cw.vol.hail = {}, {}
	task.spawn(function()
		while true do
			local cam = workspace.CurrentCamera
			if cam then
				local cx, cy = ctx.Config.fromWorld(cam.CFrame.Position)
				local x0 = cw.vol.x0
				local i0, j0 = math.floor((cx - x0) / VOXM), math.floor((cy - x0) / VOXM)
				local rain, hail = {}, {}
				local n = 0
				for dj = -RAIN_KM, RAIN_KM do
					for di = -RAIN_KM, RAIN_KM do
						local i, j = i0 + di, j0 + dj
						if di * di + dj * dj <= RAIN_KM * RAIN_KM and i >= 0 and j >= 0 and i < nxv and j < nxv then
							local r, h = EngineStorms.precipAt(ctx.Config.toWorld(x0 + (i + 0.5) * VOXM, x0 + (j + 0.5) * VOXM, 0))
							if r > 0.5 then
								rain[i + j * nxv] = r
								hail[i + j * nxv] = h * HAIL_CM
							end
							n += 1
							if n % 500 == 0 then
								task.wait()
							end
						end
					end
				end
				-- the far ring, coarse (NoFarRain: off, for A/B)
				local i2, j2 = i0 - i0 % 2, j0 - j0 % 2
				local farKm = if workspace:GetAttribute("NoFarRain") == true then 0 else FAR_KM
				for dj = -farKm, farKm, 2 do
					for di = -farKm, farKm, 2 do
						local d2 = di * di + dj * dj
						local i, j = i2 + di, j2 + dj
						if d2 > RAIN_KM * RAIN_KM and d2 <= farKm * farKm and i >= 0 and j >= 0 and i < nxv - 1 and j < nxv - 1 then
							local r, h = EngineStorms.precipAt(ctx.Config.toWorld(x0 + (i + 1) * VOXM, x0 + (j + 1) * VOXM, 0))
							if r > 0.5 then
								for q = 0, 3 do
									local k = (i + q % 2) + (j + q // 2) * nxv
									if not rain[k] then
										rain[k] = r
										hail[k] = h * HAIL_CM
									end
								end
							end
							n += 1
							if n % 500 == 0 then
								task.wait()
							end
						end
					end
				end
				cw.vol.rain, cw.vol.hail = rain, hail
			end
			task.wait(RAIN_S)
		end
	end)

	-- a private world for the warm-ups: the environment only
	local function warmWorld(): any
		return setmetatable({
			env = cw.env, coldPool = ColdPool.new(cw.env), storms = {}, tornadoes = {}, boundaries = {},
			systems = { vortices = {}, systems = {}, fronts = {} }, systemsSnap = { systems = {}, vortices = {}, fronts = {} },
			wetness = { sample = function() return 0 end }, events = {}, landspouts = {},
			-- (no boundary convergence on a client: Storm's lift through an inflow's CIN reads it, and
			-- without it a storm over capped air failed to build - "index nil with 'sample'", 2026-11-08)
			conv = { sample = function() return 0 end },
			time = 0, clockUtc = cw.clockUtc, isClient = true,
			-- (the rain its downdraughts feel: the frames', as the cards see it; Storm.step samples it)
			precip = { rainRate = { sample = function(_, x: number, y: number): number
				return (cw.vol.surfaceAt(x, y))
			end } },
		}, { __index = World })
	end

	-- id -> { key (the look it was built from), snap, at (ctx:simTime() it is valid at), u, v }
	local built: { [string]: any } = {}
	-- A new window (it moved with the players; WeatherController swaps cw.env, then fires scenario): each
	-- built storm's private world kept the old window's soundings while its place moved into the new
	-- frame, so it read the air 35-70 km away and its cloud took that shape and light - the whole
	-- storm dull and dark from far, 2026-11-09. Its world takes the new air, read again at once.
	ctx.signals.scenario:Connect(function()
		-- The frame moved with it (WeatherController's ctx.frameShift, lab m old -> new): each built storm
		-- and tornado is carried over, its last engine fix too, so it stays on its map spot. Left in the
		-- old frame, Storm.setEngine took the whole shift as a jump and eased it out over ~40 s: the
		-- storm drawn 35-70 km from its own rain and light, a dark slab with hard edges, regrade 9.
		local sh = ctx.frameShift
		ctx.frameShift = nil
		if sh then
			local sx, sy = sh.x, sh.y
			local function carry(o: any)
				if not o then return end
				for _, pq in POS do
					local px, py = o[pq[1]], o[pq[2]]
					if px and py then
						o[pq[1]], o[pq[2]] = px + sx, py + sy
					end
				end
			end
			for _, b in built do
				carry(b.s)
				carry(b.snap)
				if b.s and b.s.eng then carry(b.s.eng) end
				local t = b.t
				if t then
					carry(t)
					if t.eng then carry(t.eng) end
					if t.eng and t.eng.cx and t.eng.cy then
						t.eng.cx, t.eng.cy = t.eng.cx + sx, t.eng.cy + sy
					end
				end
				if b.tor then carry(b.tor) end
			end
		end
		for _, b in built do
			local w = b.w
			if w and w.env ~= cw.env then
				w.env = cw.env
				w.coldPool = ColdPool.new(cw.env)
				w.clockUtc = cw.clockUtc
				if b.s then
					b.s.envAge = math.huge
				end
			end
		end
	end)
	local buildSeq = 0
	local queue: { string } = {}
	local queued: { [string]: boolean } = {}
	local applyLook: (any, string, any, number, number, number, number, any?) -> ()
	local stepLive: (string, any, number) -> ()

	-- (what the warm-up is built from, without the storm's place: a look that has only moved is
	-- not built again, its snapshot is moved - the server moves every storm at each send, so with
	-- the place in the key every frame rebuilt, ~60-250 ms of steps a storm, 2026-11-07)
	local function lookKey(look: any, tor: any?): string
		local k = ("%.2f,%.3f,%.3f,%.3f,%.1f,%.2f,%.1f,%.1f,%.0f,%.0f"):format(look.updraftMs, look.meso, look.lowRotation, look.occlusion, look.ageMin, look.radiusKm, look.anvilKm, look.tornadoMph, look.baseM or 0, look.loweringM or 0)
		if tor then
			k ..= ("|%.0f,%.0f,%.0f,%.0f"):format((tor.R or 0) / 10, (tor.swirl or 0) / 2, (tor.base or 0) / 50, (tor.coreZb or 0) / 50)
		end
		return k
	end

	local function want(id: string)
		if not queued[id] then
			queued[id] = true
			table.insert(queue, id)
		end
	end

	-- A built storm's engine word for a new look (the warm-up's, without its head start): its
	-- storm's numbers, and its tornado's - started if the engine's has touched down since, let go
	-- (Tornado.setEngine nil: it lifts as its own physics has it) once the engine's has ended.
	local function startTornado(b: any, id: string): any
		-- (the private world never runs World.step, which lets go of a storm's ended tornado: let go
		-- of it here, or a storm whose tornado had lifted could never put down another)
		if b.s.tornado and not (b.t and not b.t.ended) then
			b.s.tornado = nil
			table.clear(b.w.tornadoes)
		end
		local t = b.w:forceTornado(b.s)
		if workspace:GetAttribute("EngineStormsDebugCam") == true then
			print(("[FrameWorld] %s tornado %s under the running storm"):format(id, if t then "started" else "could not start"))
		end
		if t then
			t.id = "T" .. id
			t.seed = (b.s.seed * 31 + 977) % 100000
			local rng = Noise.rng(t.seed)
			t.quality = math.clamp(math.exp(0.32 * rng:normal()), 0.55, 1.8)
			t.bendPhase = rng:range(0, 6.28)
		end
		return t
	end
	applyLook = function(b: any, id: string, look: any, x: number, y: number, u: number, v: number, tor: any?)
		local e = {
			id = id, pos = { x, y }, motion = { u, v },
			updraftMs = look.updraftMs, meso = look.meso, lowRotation = look.lowRotation, occlusion = look.occlusion,
			ageMin = look.ageMin, leftMover = look.leftMover,
			feed = { updraft = { radiusKm = math.max(look.radiusKm, 0.1) }, anvil = { lengthKm = look.anvilKm } },
			tornado = if look.tornadoMph > 0 then { mph = look.tornadoMph } else nil,
		}
		-- (the engine's tornado gone while this client's still spins down: the storm's low-level
		-- circulation is what that vortex still needs under it - its own wind - not dropped at once,
		-- which collapsed the wall cloud in seconds round a still-condensed funnel, 2026-11-09)
		if not e.tornado and b.t and not b.t.ended and (b.t.vc or 0) > 9 then
			e.tornado = { mph = b.t.vc / 0.44704 }
		end
		e.baseM = if (look.baseM or 0) > 0 then look.baseM else nil
		e.loweringM = look.loweringM
		if e.baseM and tor and tor.base then
			e.loweringM = math.max(0, e.baseM - tor.base)
		end
		local w = b.w
		Storm.setEngine(b.s, e, x, y, w.time)
		b.u, b.v = u, v
		local t = b.t
		if tor then
			local fresh = false
			if not t or t.ended then
				t = startTornado(b, id)
				b.t = t
				fresh = true
			end
			if t then
				local lx, ly = Storm.lowMesoAt(b.s)
				Tornado.setEngine(t, { mph = tor.mph, yards = tor.yards, orbit = 0, R = tor.R, swirl = tor.swirl, base = tor.base, coreZb = tor.coreZb, leanX = tor.leanX, leanY = tor.leanY }, tor.x, tor.y, u, v, w.time, lx, ly)
				if fresh then
					-- (touched down while the storm runs: it spins up to the engine's word by its own
					-- eases - core 20-60 s, base 60 s - so the funnel grows down instead of popping in
					-- whole; only its lean starts where the engine's is)
					t.topX, t.topY = tor.leanX or t.topX, tor.leanY or t.topY
				end
			end
		elseif t and not t.ended then
			Tornado.setEngine(t, nil, 0, 0, u, v, w.time)
		end
	end
	-- A built storm run on to sim time `now` (the publish loop, and before each new look): its
	-- storm and tornado stepped together as in the warm-up, then its snapshots taken afresh.
	stepLive = function(id: string, b: any, now: number)
		local w, s, t = b.w, b.s, b.t
		-- (a long stall - a paused or hidden client - is not caught up step by step: at most 2 min)
		local dt = math.min(now - b.simNow, 120)
		b.simNow = now
		if dt <= 0 then
			return
		end
		while dt > 1e-6 do
			local h = math.min(dt, TOR_DT)
			dt -= h
			w.time += h
			w.stormClock = w.time
			Storm.step(s, h, w)
			if t then
				local parent = w:parentOf(t)
				local sub = math.max(1, math.ceil(h / 0.5))
				for _ = 1, sub do Tornado.step(t, h / sub, parent, w) end
			end
		end
		-- (a lifted tornado is let go once it has faded: the adapter fades it out)
		if t and t.ended and (t.endedFor or 0) > 60 then
			b.t, t = nil, nil
		end
		local tSnap = nil
		if t then
			t.params = Vortex.params(t)
			tSnap = Tornado.snapshot(t)
			tSnap.parentId = id
		end
		local snap = Storm.snapshot(s)
		snap.id = id
		-- (the cards re-plan as it changes, every PLAN_S: the same seeds, so they move with it;
		-- re-planned only on a new build, an evolving storm was drawn as it was when built)
		-- (its own build id: one storm's bump no longer changes every other storm's)
		if os.clock() - b.planAt >= PLAN_S then
			b.planAt = os.clock()
			buildSeq += 1
			b.buildId = buildSeq
		end
		snap.buildId = b.buildId
		snap.wprof, snap.tiltX, snap.tiltY = s.wprof, s.tiltX, s.tiltY
		b.snap, b.tor, b.at = snap, tSnap, now
		if t and workspace:GetAttribute("EngineStormsDebugCam") == true and os.clock() - (b.logAt or 0) > 10 then
			b.logAt = os.clock()
			print(("[FrameWorld] %s live tornado: vc %.0f rc %.0f decay %.2f wave %.0f base %.0f stage %s engine %s lean %.0f push %.0f,%.0f"):format(id, t.vc, t.rc, t.decay or 0, t.wave or 0, t.cloudBase, tostring(t.stage), if t.eng then tostring(t.eng.on) else "none",
				math.sqrt(t.topX * t.topX + t.topY * t.topY), if t.eng then t.eng.dx or 0 else 0, if t.eng then t.eng.dy or 0 else 0))
		end
		TornadoViewM.cards[id] = if tSnap then { vc = tSnap.vc, rc = tSnap.rc, base = tSnap.cloudBase, wallBase = snap.wallBase, stormBase = snap.base } else nil
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
				R = vx and vx.R or nil, swirl = vx and vx.V or nil, base = if vx and vx.Bt > 0 then vx.Bt else nil,
				coreZb = if vx and vx.Bc > 0 then vx.Bc else nil }
			-- its lean: where the engine's funnel meets the cloud base, from its ground point (the
			-- frame's levels, m east and north - the overlay's "lean at base"), in lab metres
			if vx and vx.Bt > 0 then
				local dx, dy = VA.leanAt(vx.levels, vx.Bt)
				local bx, by = sim(ls.xKm + ls.ue * age / 1000 + (ft.x - f.anchorX + dx) / 1000, ls.yKm - ls.ve * age / 1000 - (ft.y - f.anchorY + dy) / 1000)
				tor.leanX, tor.leanY = bx - tx, by - ty
			end
		end
		-- (no tornado in the look, none drawn: the frame's vortex record can outlive the engine's
		-- tornado by a frame; the replay's /life/lift sends this to watch the rope-out)
		if look.tornadoMph <= 0 then
			tor = nil
		end
		local key = lookKey(look, tor)
		local b = built[id]
		if b and b.w then
			-- (already built: its storm runs on - the publish loop steps it - and only takes the
			-- engine's new word, eased in by Storm.followEngine and Tornado.step. Rebuilt from a fresh
			-- warm-up for every new look, the whole storm and funnel changed shape at each engine
			-- moment - every 37.5 s at the 8x clock, a jump of 11-18 grey levels against ~3
			-- between, lifecycle check 2026-11-08)
			stepLive(id, b, at)
			b.key = key
			applyLook(b, id, look, x, y, u, v, tor)
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
		local slice = os.clock()
		for _ = 1, steps do
			w.time += WARM_DT
			w.stormClock = w.time
			Storm.step(s, WARM_DT, w)
			if os.clock() - slice >= STEP_BUDGET then
				task.wait()
				slice = os.clock()
			end
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
				Tornado.setEngine(t, { mph = tor.mph, yards = tor.yards, orbit = 0, R = tor.R, swirl = tor.swirl, base = tor.base, coreZb = tor.coreZb, leanX = tor.leanX, leanY = tor.leanY }, tor.x - u * tWarm, tor.y - v * tWarm, u, v, w.time, lx, ly)
				-- (it is already down in the engine: started at its size, wind and base, not spun up)
				t.rc = tor.R or t.rc
				t.vc = tor.swirl or t.vc
				t.cloudBase = tor.base or t.cloudBase
				t.topX, t.topY = tor.leanX or t.topX, tor.leanY or t.topY
			end
		end
		local nT = math.floor(tWarm / TOR_DT)
		slice = os.clock()
		for _ = 1, nT do
			w.time += TOR_DT
			w.stormClock = w.time
			Storm.step(s, TOR_DT, w)
			if t then
				local parent = w:parentOf(t)
				local sub = math.max(1, math.ceil(TOR_DT / 0.5))
				for _ = 1, sub do Tornado.step(t, TOR_DT / sub, parent, w) end
			end
			if os.clock() - slice >= STEP_BUDGET then
				task.wait()
				slice = os.clock()
			end
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
		built[id] = { key = key, snap = snap, at = at, u = u, v = v, tor = tSnap,
			w = w, s = s, t = t, simNow = at, planAt = os.clock(), buildId = buildSeq }
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
				if b.w then
					local ok, err = pcall(stepLive, id, b, now)
					if not ok then warn("[FrameWorld] " .. id .. " step: " .. tostring(err)) end
				end
				if b.tor then
					-- (stamped when it was there: Tornado/StateAdapter carries it on at its motion)
					local tt = table.clone(b.tor)
					tt.simAt = b.at
					tt.u, tt.v = b.u, b.v -- (its translation, m a sim second: TornadoDust's trapped debris rides it)
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
