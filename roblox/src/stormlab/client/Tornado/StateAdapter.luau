--!nonstrict
--!native
-- From the replicated tornado state (Tornado.snapshot, ~15 Hz) to a smooth visual state per
-- tornado (visual plan section 3). Nothing here changes the simulation; it only reads it.
--   motion     position extrapolated with the tornado's own translation between snapshots;
--              a new snapshot's correction is eased in over ~0.4 s (no jumps)
--   fields     vc, rc, swirl, cloud base, axis shape, decay, organisation eased (~0.3 s)
--   time       the vortex's phase clock continues smoothly (the funnel turns at sim speed)
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

local FIELDS = { "vc", "rc", "swirl", "cloudBase", "topX", "topY", "bendX", "bendY", "wave", "decay", "O", "envU", "envV", "inflow", "debrisLoft", "debrisTop" }

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
	for i = 1, n do
		local f = (i - 0.5) / n
		local r = Precip.surface(vol, cx + (x - cx) * f, cy + (y - cy) * f) or 0
		tau += 0.33 * r ^ 0.66 * (d / n) / 1000
	end
	-- rain wrapped round the vortex: the heaviest rain within ~1.5 km
	local wrap = 0
	for a = 0, 7 do
		for _, rr in { 400, 900, 1500 } do
			local r = Precip.surface(vol, x + rr * math.cos(a * 0.785), y + rr * math.sin(a * 0.785)) or 0
			wrap = math.max(wrap, r)
		end
	end
	return exp(-tau), wrap
end

function StateAdapter.update(self: any, dt: number)
	local ctx = self.ctx
	local Vortex = ctx.Sim.Vortex
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
			local since = math.max(0, simNow - (self.snapSim or simNow))
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
			e.snap = t
			e.age += dt
			-- position: the extrapolated snapshot, with any correction eased away
			local px, py = tx, ty
			if e.ut0 ~= nil then
				px, py = e.x + e.ut0 * simDt, e.y + e.vt0 * simDt
			end
			e.ox += tx - px
			e.oy += ty - py
			local k = 1 - exp(-dt / 0.4)
			local cxr, cyr = e.ox * k, e.oy * k
			e.ox -= cxr
			e.oy -= cyr
			e.x, e.y = px + cxr, py + cyr
			e.ut0, e.vt0 = t.ut, t.vt
			e.ut, e.vt = t.ut, t.vt
			-- fields
			local kf = 1 - exp(-dt / 0.3)
			for _, f in FIELDS do
				local target = t[f] or 0
				e[f] = (e[f] or target) + (target - (e[f] or target)) * kf
			end
			e.time = (e.time + simDt) % 8192
			if math.abs(((t.time + since) % 8192) - e.time) > 2 then
				e.time = (t.time + since) % 8192
			end
			e.stage, e.ef, e.peakWind, e.hold = t.stage, t.ef, t.peakWind, t.hold
			-- life: organising in, dissipating out, stale updates fade
			local lifeTarget = math.clamp(0.25 + 0.75 * (t.O or 1), 0, 1)
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
