--!nonstrict
--!native
-- From the replicated tornado state (Tornado.snapshot, ~15 Hz) to a smooth visual state per
-- tornado (visual plan section 3). Nothing here changes the simulation; it only reads it.
--   motion     position extrapolated with the tornado's own translation between snapshots;
--              a new snapshot's correction is eased in over ~0.4 s (no jumps)
--   fields     vc, rc, swirl, cloud base, axis shape, decay, organisation eased (~0.3 s)
--   time       the vortex's phase clock and sub-vortex orbit continue smoothly on the visual
--              clock (Context:visualDt: the sim clock in the lab, real speed in the game)
--   scale R    the visible envelope's width scale: the condensation radius where it is
--              condensed, the core radius (x1.15) where it is not (a nearly invisible tornado
--              still has a shape for wisps and rain to cling to)
--   profile    family weights (ProfileLibrary.weights) eased over ~12 s of SIM time
--   obscure    rain between the camera and the vortex (extinction 0.33 R^0.66 per km from the
--              precipitation field, integrated along the sight line) and rain round it (wrap)
--   stale      no snapshot for 3 s: hold, then fade out over 2 s and drop
local StateAdapter = {}

local exp, sqrt = math.exp, math.sqrt

function StateAdapter.new(ctx: any): any
	local self = { ctx = ctx, entries = {}, lastSnap = os.clock(), slow = 0 }
	ctx.signals.tornado:Connect(function()
		self.lastSnap = os.clock()
		self.snapSim = ctx:simTime()
	end)
	return setmetatable(self, { __index = StateAdapter })
end

local FIELDS = { "vc", "rc", "swirl", "cloudBase", "topX", "topY", "bendX", "bendY", "wave", "decay", "O", "envU", "envV", "inflow", "debrisLoft", "debrisTop", "coreWet", "coreZb" }

local function obscuration(ctx: any, x: number, y: number): (number, number)
	local cw = ctx.cw
	local vol = cw.vol
	if not vol or not vol.nxv then
		return 1, 0
	end
	local Precip = ctx.Sim.Precip
	local cx, cy = ctx:simCamera()
	local d = sqrt((x - cx) ^ 2 + (y - cy) ^ 2)
	local n = math.clamp(math.floor(d / 700), 3, 16)
	local tau = 0
	local C = ctx.Config
	local step = C.sightPath(d / n) / 1000 -- (km of drawn sight line a sample)
	local dbg = {}
	for i = 1, n do
		local f = (i - 0.5) / n
		local r = Precip.surface(vol, cx + (x - cx) * f, cy + (y - cy) * f) or 0
		tau += C.rainExtinction(r) * step
		table.insert(dbg, string.format("%.0f", r))
	end
	-- (debug: the rain along the sight line, camera first, mm/h)
	ctx.root:SetAttribute("SightRain", string.format("%.0f m: ", d) .. table.concat(dbg, " "))
	-- rain wrapped round the vortex: the heaviest rain within ~1.5 km on the camera's side of it
	-- (rain behind or beside the funnel isn't in the way; counting it - the forward-flank core is
	-- usually that close - greyed every tornado toward rain grey and took its edges, 2026-10-29)
	local wrap = 0
	local ux, uy = cx - x, cy - y
	local ul = math.max(1, sqrt(ux * ux + uy * uy))
	ux, uy = ux / ul, uy / ul
	for a = 0, 7 do
		local ca, sa = math.cos(a * 0.785), math.sin(a * 0.785)
		local facing = math.clamp((ca * ux + sa * uy - 0.2) / 0.5, 0, 1)
		if facing > 0 then
			for _, rr in { 400, 900, 1500 } do
				local r = Precip.surface(vol, x + rr * ca, y + rr * sa) or 0
				wrap = math.max(wrap, r * facing)
			end
		end
	end
	return exp(-tau), wrap
end

function StateAdapter.update(self: any, dt: number)
	local ctx = self.ctx
	local Vortex = ctx.Sim.Vortex
	local SubVortices = ctx.Sim.SubVortices
	local Profiles = ctx.Tornado.ProfileLibrary
	local simNow = ctx:simTime()
	local simDt = if ctx.state.paused then 0 else dt * (ctx.state.timeScale or 1)
	local stale = os.clock() - self.lastSnap
	self.slow += dt
	local slowTick = self.slow >= 0.1
	if slowTick then
		self.slow = 0
	end
	local seen = {}
	for _, t in ctx.cw.tornadoes do
		if not t.ended then
			seen[t.id] = true
			local e = self.entries[t.id]
			-- (sim time since this snapshot was taken: its own server stamp, Net; else since it came)
			local since = math.max(0, simNow - (t.simAt or self.snapSim or simNow))
			local tx, ty = t.x + t.ut * since, t.y + t.vt * since
			if not e then
				e = { id = t.id, seed = t.seed, x = tx, y = ty, ox = 0, oy = 0, time = t.time, fade = 0, age = 0 }
				for _, k in FIELDS do
					e[k] = t[k] or 0
				end
				e.R = math.max(10, 1.15 * (t.rc or 30))
				e.weights = Profiles.weights(t, e.R)
				self.entries[t.id] = e
			end
			local fresh = e.snap ~= t
			e.snap = t
			e.age += dt
			-- position: the extrapolated snapshot, with any correction eased away. The target's
			-- jump this frame beyond its own motion (a new snapshot, a late or early one) becomes
			-- an offset that decays over ~0.4 s. (2026-10-28: this used to add the whole remaining
			-- gap to the offset every frame, an integrator that rang: the drawn speed swung
			-- 0.5-2x the true speed at ~2-3 Hz with snapshots arriving 60-120 ms late.)
			local px, py = tx, ty
			if e.tx ~= nil then
				px, py = e.tx + e.ut0 * simDt, e.ty + e.vt0 * simDt
			end
			e.ox += px - tx
			e.oy += py - ty
			local k = exp(-dt / 0.4)
			e.ox *= k
			e.oy *= k
			e.x, e.y = tx + e.ox, ty + e.oy
			e.tx, e.ty = tx, ty
			e.ut0, e.vt0 = t.ut, t.vt
			e.ut, e.vt = t.ut, t.vt
			-- fields
			local kf = 1 - exp(-dt / 0.3)
			for _, f in FIELDS do
				local target = t[f] or 0
				e[f] = (e[f] or target) + (target - (e[f] or target)) * kf
			end
			-- the vortex's own clock (sub-vortex lives, rope waves, gusts) and the sub-vortices'
			-- orbit angle run on the visual clock: local motion, at real speed in the game (the
			-- funnel's ring spin in Render/TornadoCards is real speed too); in the lab the visual
			-- clock is the sim clock and stays locked to the server's. The orbit is integrated
			-- (Vortex.params: a rate x time product jumped whenever vc or rc changed)
			local vDt = ctx:visualDt(dt)
			e.time = (e.time + vDt) % 8192
			if ctx.state.visualScale == nil and math.abs(((t.time + since) % 8192) - e.time) > 2 then
				e.time = (t.time + since) % 8192
			end
			local sOrbit = if e.params then e.params.sOrbit else 0
			e.orbit = (e.orbit or t.orbit or 0) + sOrbit * vDt
			if ctx.state.visualScale == nil and t.orbit and math.abs(t.orbit + sOrbit * since - e.orbit) > 0.3 then
				e.orbit = t.orbit + sOrbit * since -- (the lab: the server's sub-vortices, as its debris sees them)
			end
			-- the sub-vortices (Sim/SubVortices): stepped here on the visual clock between snapshots;
			-- in the lab nudged toward the server's at each new one (its debris and winds see those);
			-- in the game (a faster sim clock) only taken from it at first, their place is local motion
			if e.sv == nil then
				e.sv = SubVortices.new()
				SubVortices.adopt(e.sv, t.svp, 1)
			elseif fresh and ctx.state.visualScale == nil then
				SubVortices.adopt(e.sv, t.svp, 0.35)
			end
			SubVortices.step(e, vDt)
			e.stage, e.ef, e.peakWind, e.hold = t.stage, t.ef, t.peakWind, t.hold
			-- life: stale updates fade, and a new entry comes in over ~1 s. (Not organisation any
			-- more, 2026-11-03: 0.25 + 0.75 O drew every forming tornado as a see-through ghost on top
			-- of what O already does in the sim - it scales the core wind, so a young vortex condenses
			-- a narrow funnel, and its debris)
			local lifeTarget = 1
			if stale > 3 then
				lifeTarget = 0
			end
			e.fade += (lifeTarget - e.fade) * (1 - exp(-dt / (if stale > 3 then 2 else 0.8)))
			-- the vortex parameters for this frame (sub-vortices, axis, condensation)
			e.params = Vortex.params(e)
			if slowTick then
				-- visual scale: the envelope's width over the middle heights
				local H = math.max(100, e.cloudBase)
				local sum, n = 0, 0
				local condMax = 0
				for _, hf in { 0.15, 0.3, 0.45, 0.6, 0.75 } do
					local z = H * hf
					local rcond = Vortex.condensationRadius(e, z)
					condMax = math.max(condMax, rcond)
					local rcz = Vortex.rcAt(e.params, z)
					sum += math.max(math.min(rcond, 3 * rcz), 1.15 * rcz)
					n += 1
				end
				local Rt = sum / n
				e.R = e.R + (Rt - e.R) * 0.25
				-- profile weights, eased over sim time
				local wt = Profiles.weights(e, e.R)
				local kw = 1 - exp(-math.max(simDt, 0.02) * 10 / 12)
				for name, w in wt do
					e.weights[name] = (e.weights[name] or 0) + (w - (e.weights[name] or 0)) * kw
				end
				e.condensed = condMax > 1
			end
			if not e.obsAt or os.clock() - e.obsAt > 0.25 then
				e.obsAt = os.clock()
				local T, wrap = obscuration(ctx, e.x, e.y)
				e.transT = T
				e.wrapT = wrap
			end
			local ko = 1 - exp(-dt / 0.6)
			e.trans = (e.trans or e.transT) + (e.transT - (e.trans or e.transT)) * ko
			e.wrap = (e.wrap or e.wrapT) + (e.wrapT - (e.wrap or e.wrapT)) * ko
		elseif self.entries[t.id] and (t.endedFor or 0) < 1e8 then
			-- Ended (2026-11-03). The sim ends a tornado once its core wind is under ~9 m/s; it stays
			-- in the list ~120 s. Its funnel has mostly lifted by then, but the last of its spin and
			-- its lofted dust don't stop at once: the core spins down and the dust settles on the
			-- sim clock, and the entry goes only when nothing of it shows. (It used to fade over
			-- 0.7 s of real time with its dust and debris: the last whirl popped out at 1x.)
			-- (endedFor 1e9: a lab scene change ended it - cleared at once, below)
			local e = self.entries[t.id]
			seen[t.id] = true
			e.snap = t
			e.age += dt
			local vDt = ctx:visualDt(dt)
			local kv = exp(-simDt / 25)
			local kd = exp(-simDt / 40)
			-- (its motion slows with its spin: it drifts on with the low-level wind)
			e.ox *= exp(-dt / 0.4)
			e.oy *= exp(-dt / 0.4)
			e.ut0, e.vt0 = (e.ut0 or 0) * kv, (e.vt0 or 0) * kv
			e.tx, e.ty = (e.tx or e.x) + e.ut0 * simDt, (e.ty or e.y) + e.vt0 * simDt
			e.x, e.y = e.tx + e.ox, e.ty + e.oy
			e.ut, e.vt = e.ut0, e.vt0
			e.vc = (e.vc or 0) * kv
			e.peakWind = (e.peakWind or 0) * kv
			e.debrisLoft = (e.debrisLoft or 0) * kd
			e.time = (e.time + vDt) % 8192
			e.stage = "ended"
			SubVortices.step(e, vDt)
			e.params = Vortex.params(e)
			-- gone once spun down and settled
			-- (a whirl of ~4 m/s still turns dust over; the sim ends it at ~9)
			local left = math.max((e.vc or 0) / 4, (e.debrisLoft or 0) / 0.03)
			local lifeTarget = if left > 1 and stale <= 3 then 1 else 0
			e.fade += (lifeTarget - e.fade) * (1 - exp(-dt / 2))
			if lifeTarget == 0 and e.fade < 0.01 then
				self.entries[t.id] = nil
			end
		end
	end
	-- tornadoes that ended or left: fade, then drop
	for id, e in self.entries do
		if not seen[id] then
			e.gone = (e.gone or 0) + dt
			e.fade = e.fade * exp(-dt / 0.7)
			if e.gone > 3 then
				self.entries[id] = nil
			end
		else
			e.gone = nil
		end
	end
end

return StateAdapter
