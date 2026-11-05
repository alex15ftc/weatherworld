--!strict
-- One engine storm shown by the cloud model. The engine decides the storm (where, when, how
-- strong, its cold pool, its tornado, its end); the model is steered toward it and fills in the
-- physics: the updraft, anvil, rain and hail shafts, outflow, wall cloud and low-level rotation.
--
--   local run = EngineRun.new(record, opts)   record: the engine's storm as /api/game/v1/lab/storms
--                                             serves it with ?inflow=1 (js/game/LabWindow.js
--                                             labStorms): motion, intensity, updraftMs, coldPoolK,
--                                             tornado, inflow (sounding rows). opts.startRows: the
--                                             sounding the storm started in (its own cell, from the
--                                             lab window): the engine began it where that air was
--                                             ready, and the inflow can still be capped (2026-11-04:
--                                             CIN -70 against -26 held the start back 45 min)
--   run:update(record)                        each new engine record for the storm (nil: the engine
--                                             has ended it)
--   run:step()                                one model step (dt = run.model.dt seconds)
--   run.model, run.nest                       the 1 km box and its 250 m nest (nil until started)
--
-- Steering, each from an engine field:
--   environment  the base state eases (15 min) toward each new inflow sounding: the air ahead of
--                the storm as the engine's afternoon heats and the storm moves into new air
--   motion       the box's frame moves at the engine storm's motion; the box also follows the
--                model's own storm (CloudModel.followStorm)
--   lift         updraft nudging (Naylor & Gilmore 2012), LIFT x intensity: 15 min at the start
--                (initiation), then for as long as the engine's storm lives, on the storm's inflow
--                side (liftSpot: under the model's updraft, walked upwind out of its cold pool -
--                where the engine's storm is fed); once the engine ends it the lift stops and the
--                model storm decays by itself
--   cold pool    the cold air's deficit scaled toward the engine's coldPoolK (10 min)
--   tornado      while the engine has a tornado down, a low lift (TOR_LIFT x min(1, mph/100))
--                under the model's strongest 1 km rotation: stretching what the storm has
-- (in Roblox the sibling modules; on the command line the files beside this one)
local function dep(name: string): any
	if script then
		return require((script :: any).Parent:FindFirstChild(name))
	end
	return (require :: any)("./" .. name)
end
local CloudModel = dep("CloudModel")
local Sounding = dep("Sounding")
local Nest = dep("Nest")
local NestRemote = dep("NestRemote")

local EngineRun = {}
EngineRun.__index = EngineRun

export type Options = {
	nx: number?, -- 1 km box cells each way (64)
	lift: number?, -- lift target at full engine intensity (m/s, 8)
	liftR: number?, -- lift radius (m, 10 km: the standard size)
	torLift: number?, -- tornado-time low lift (m/s, 6; 0 = off)
	nest: boolean?, -- a 250 m nest on the storm after NEST_START (true)
	env: boolean?, -- follow the engine's inflow soundings (true)
	startRows: { { number } }?, -- the starting sounding (default: the record's inflow)
	n0h: number?, -- hail intercept (m^-4; CloudModel's default when nil)
	autoToIce: boolean?, -- cold cloud drops straight to graupel (CloudModel.autoToIce)
	liftAt: string?, -- "inflow" (default): the lift follows the storm's inflow side; "box": fixed
	cold: boolean?, -- steer the cold pool (true)
}
EngineRun.NEST_START = 30 * 60
EngineRun.START = 15 * 60 -- the initiation lift (s)
EngineRun.UPDRAFT_Z = 3000 -- where the storm's updraft is looked for (m)
EngineRun.UPDRAFT_W = 3 -- least 3x3 mean updraft there that counts as the storm (m/s)
EngineRun.WARM_K = -0.5 -- ground air at least this warm (theta', K) is outside the cold pool
EngineRun.INTO_WARM = 1500 -- how far past the cold pool's edge the lift sits (m)
EngineRun.LIFT_SPEED = 2000 -- most the lift moves in a minute (m)
-- the lift's nudging time (s). The pressure field answers each nudge and takes most of it back: at
-- 30 s an 8 m/s target held only ~3 m/s, a broad weak rise the low-level shear swept through
-- without a storm (2026-11-04); at 5 s (the start lift's) the target is reached
EngineRun.LIFT_TAU = 5
EngineRun.ENV_TAU = 15 * 60
EngineRun.COLD_TAU = 10 * 60

function EngineRun.new(record: any, opts: Options?)
	local o = opts or {}
	local self: any = setmetatable({}, EngineRun)
	self.lift, self.liftR, self.torLift = o.lift or 8, o.liftR or 10000, o.torLift or 6
	self.useNest, self.useEnv, self.useCold = o.nest ~= false, o.env ~= false, o.cold ~= false
	local snd = Sounding.fromProfile(o.startRows or record.inflow)
	local nx = o.nx or 64
	local m = CloudModel.new({
		nx = nx, ny = nx, dx = 1000, dzmin = 100, dzmax = 700, stretch = 1.12, ztop = 16000, dt = 6,
		cs = 150, K = 75, umove = record.motion[1], vmove = record.motion[2], z0 = 0.1, follow = false,
		n0h = o.n0h, autoToIce = o.autoToIce,
	}, snd)
	self.model = m
	self.L = nx * m.dx
	self.k1 = m:levelAt(1000)
	self.k3 = m:levelAt(EngineRun.UPDRAFT_Z)
	self.liftAt = o.liftAt or "inflow"
	self.lx, self.ly = 0.5 * self.L, 0.45 * self.L -- the lift's place in the box (m)
	self.lox, self.loy = 0, 0 -- the box's shifts when it was last placed
	self.record = record
	self.ended = false
	-- (what a nest process needs to build a mirror of this box: the same start)
	self.initRecord, self.initOpts = record, o
	if o.startRows then
		EngineRun.update(self, record) -- (the base state then eases from the start air to the inflow)
	end
	self.coldMean = 0
	self.nextMin = 60
	self.nextSpot = EngineRun.START
	-- initiation: lifting at the storm's position (box centre), easing off over its last 5 min
	m.drive = { x = 0.5 * self.L, y = 0.5 * self.L, ox = 0, oy = 0, r = math.max(5000, self.liftR), z = 1500, rz = 1500, w = math.min(10, record.updraftMs or 10), tau = 5, t1 = 15 * 60, ramp = 5 * 60 }
	return self
end

function EngineRun.update(self: any, record: any?)
	if not record then
		self.ended = true
		return
	end
	self.record = record
	local m = self.model
	if record.motion then
		m:setMotion(record.motion[1], record.motion[2])
	end
	if self.useEnv and record.inflow then
		local th, qv, u, v = CloudModel.profiles(m, Sounding.fromProfile(record.inflow))
		-- (held until the start lift is over: the storm begins in the air it started in, 2026-11-04 -
		-- easing to a capped inflow from the first minute held the start back 45 min)
		self.pendingEnv = { th = th, qv = qv, u = u, v = v, psfc = record.inflow[1][1] * 100, tau = EngineRun.ENV_TAU }
	end
end

-- Where the storm is fed: under the model's updraft (the strongest 3x3 mean w at UPDRAFT_Z within
-- 16 cells of the box's follow target), walked upwind against the 0-1 km storm-relative wind until
-- the ground air is out of the cold pool (theta' above WARM_K), then INTO_WARM further. Box metres;
-- nil when there is no updraft (the lift stays where it was).
function EngineRun.liftSpot(self: any): (number?, number?)
	local m = self.model
	local nx, ny, dx, SX, SXY, w, th = m.nx, m.ny, m.dx, m.SX, m.SXY, m.w, m.th
	local k = self.k3
	local ti, tj = nx // 2, math.floor(0.45 * ny)
	local best, bi, bj = EngineRun.UPDRAFT_W, 0, 0
	for j = math.max(3, tj - 16), math.min(ny - 2, tj + 16) do
		for i = math.max(3, ti - 16), math.min(nx - 2, ti + 16) do
			local sum = 0
			for dj = -1, 1 do
				for di = -1, 1 do
					sum += w[(i + di + 2) + (j + dj + 1) * SX + (k + 1) * SXY]
				end
			end
			if sum / 9 > best then
				best, bi, bj = sum / 9, i, j
			end
		end
	end
	if bi == 0 then
		return nil, nil
	end
	-- the storm-relative inflow (the box's winds are already relative to the frame, which moves with
	-- the storm): its 0-1 km mean in the environment
	local su, sv, n = 0, 0, 0
	for kk = 1, m.nz do
		if m.zc[kk] > 1000 then
			break
		end
		su += m.u0[kk] - m.umove
		sv += m.v0[kk] - m.vmove
		n += 1
	end
	su, sv = su / n, sv / n
	local sr = math.sqrt(su * su + sv * sv)
	if sr < 0.5 then
		return (bi - 0.5) * dx, (bj - 0.5) * dx
	end
	local ex, ey = -su / sr, -sv / sr -- upwind
	local x, y = (bi - 0.5) * dx, (bj - 0.5) * dx
	local t0 = m.th0[1]
	for _ = 1, 40 do
		local ci = math.clamp(math.floor(x / dx) + 1, 1, nx)
		local cj = math.clamp(math.floor(y / dx) + 1, 1, ny)
		if th[(ci + 2) + (cj + 1) * SX + 2 * SXY] - t0 > EngineRun.WARM_K then
			return x + ex * EngineRun.INTO_WARM, y + ey * EngineRun.INTO_WARM
		end
		x += ex * 500
		y += ey * 500
	end
	return x, y
end

-- the model's strongest 1 km rotation within r cells of (ci, cj)
local function mesoNear(m: any, k1: number, ci: number, cj: number, r: number): (number, number, number)
	local best, bi, bj = 0, ci, cj
	for j = math.max(2, cj - r), math.min(m.ny - 1, cj + r) do
		for i = math.max(2, ci - r), math.min(m.nx - 1, ci + r) do
			local z = m:zeta(i, j, k1)
			if z > best then
				best, bi, bj = z, i, j
			end
		end
	end
	return best, bi, bj
end

function EngineRun.step(self: any)
	local m, rec = self.model, self.record
	local t = m.time
	local alive = not self.ended and rec.active ~= false
	if self.pendingEnv and t >= EngineRun.START then
		m.env, self.pendingEnv = self.pendingEnv, nil
	end
	if t >= self.nextMin then
		self.nextMin += 60
		if self.useCold and alive then
			self.coldMean = m:coldPoolRate(rec.coldPoolK or 0, EngineRun.COLD_TAU)
		else
			m.cpRate = 0
		end
	end
	if t >= 15 * 60 then
		if self.liftAt == "inflow" then
			-- (the box shifts with the storm: the spot moves back by the shift)
			self.lx -= (m.ox - self.lox) * m.dx
			self.ly -= (m.oy - self.loy) * m.dx
			self.lox, self.loy = m.ox, m.oy
			if t >= self.nextSpot then
				self.nextSpot = t + 60
				local x, y = self:liftSpot()
				if x then
					local ddx, ddy = x - self.lx, y - self.ly
					local d = math.sqrt(ddx * ddx + ddy * ddy)
					local f = if d > EngineRun.LIFT_SPEED then EngineRun.LIFT_SPEED / d else 1
					self.lx, self.ly = self.lx + f * ddx, self.ly + f * ddy
				end
			end
		end
		m.drive = if alive then { x = self.lx, y = self.ly, inBox = true, r = self.liftR, z = 1500, rz = 1500, w = self.lift * (rec.intensity or 0), tau = EngineRun.LIFT_TAU, t1 = math.huge, ramp = 0 } else nil
		if self.torLift > 0 and alive and rec.tornado then
			local zm, bi, bj = mesoNear(m, self.k1, m.nx // 2, math.floor(0.45 * m.ny), 12)
			if zm > 0.005 then
				m.drive2 = { x = (bi - 0.5) * m.dx, y = (bj - 0.5) * m.dx, inBox = true, r = 2500, z = 700, rz = 700, w = self.torLift * math.min(1, (rec.tornado.mph or 0) / 100), tau = EngineRun.LIFT_TAU, t1 = t + 60, ramp = 0 }
			end
		end
	end
	if self.nestLink then
		EngineRun.stepWithNestProcess(self, t)
		return
	end
	if self.useNest and not self.nest and t >= EngineRun.NEST_START then
		local i0, j0 = Nest.place(m, 48, 4)
		self.nest = Nest.new(m, { nx = 48, ny = 48, ratio = 4, steps = 2, i0 = i0, j0 = j0 })
	end
	Nest.step(m, self.nest)
end

-- The same step with the nest on its own process (NestRemote; run.nestLink is its transport:
-- link:create(meta, region), link:send(meta, old, new), link:reply() -> reply, correction, frame).
-- The box steps while the nest does the box's previous step; the nest's feedback arrives one box
-- step late. run.nestInfo holds the nest's latest position and diagnostics,
-- run.nestFrame its frame section.
function EngineRun.stepWithNestProcess(self: any, t: number)
	local m, link = self.model, self.nestLink
	local R = self.remote
	if self.useNest and not R and t >= EngineRun.NEST_START then
		local i0, j0 = Nest.place(m, 48, 4)
		local meta, region, rect = NestRemote.createMessage(m, i0, j0)
		link:create(meta, region)
		R = { i0 = i0, j0 = j0, rect = rect, waiting = false }
		self.remote = R
	end
	local ox, oy = m.ox, m.oy
	m:followStorm()
	local di, dj = m.ox - ox, m.oy - oy
	local old: buffer? = nil
	if R then
		local rect = NestRemote.region(m, R.i0, R.j0, m.stormI, m.stormJ)
		if di ~= 0 or dj ~= 0 or not NestRemote.sameRect(rect, R.rect) then
			old = NestRemote.packRegion(m, rect)
		end
		R.rect = rect
	end
	m:step()
	if R then
		if R.waiting then
			local reply, averages, frame = link:reply()
			if averages then
				NestRemote.applyCorrection(m, reply, averages, di, dj)
			end
			R.i0, R.j0 = reply.i0, reply.j0
			self.nestInfo, self.nestFrame = reply, frame
		end
		link:send(NestRemote.stepMeta(m, di, dj), old, NestRemote.packRegion(m, R.rect))
		R.waiting = true
	end
end

-- An exported engine scenario (scripts/export-lab-scenario.mjs; decoded JSON) replayed as the
-- game would get it: the focus storm's track every 5 minutes as engine records (motion,
-- intensity, cold pool, tornado, the newest inflow sounding), its own cell's sounding to start in.
-- run:replayStep() feeds the record due on the model clock, then steps; past the track's end (or
-- once the engine marks the storm inactive) the run is told the storm has ended.
function EngineRun.fromScenario(data: any, opts: Options?)
	local focus = data.meta.focusStorm
	local storm = data.storms[1]
	for _, s in data.storms do
		if s.id == focus then
			storm = s
		end
	end
	local best, startRows = math.huge, nil
	for _, c in data.cells do
		local d = (c.pos[1] - storm.pos[1]) ^ 2 + (c.pos[2] - storm.pos[2]) ^ 2
		if d < best then
			best, startRows = d, c.sounding
		end
	end
	local function record(p: any): any
		return { motion = p.motion, intensity = p.intensity, coldPoolK = p.coldPoolK, tornado = p.tornado, active = p.active, inflow = p.inflow, updraftMs = storm.updraftMs }
	end
	local o: any = table.clone((opts or {}) :: any)
	o.startRows = o.startRows or startRows
	local self = EngineRun.new(record(data.track[1]), o)
	self.scenario = { data = data, storm = storm, record = record, nextRec = 5 * 60 }
	return self
end

function EngineRun.replayStep(self: any)
	local sc = self.scenario
	if self.model.time >= sc.nextRec then
		local p = sc.data.track[math.floor(sc.nextRec / 300) + 1]
		sc.nextRec += 5 * 60
		self:update(if p and p.active ~= false then sc.record(p) else nil)
	end
	self:step()
end

-- the engine's track point at the model's time (for comparing)
function EngineRun.trackNow(self: any): any
	local tr = self.scenario.data.track
	return tr[math.min(#tr, math.floor(self.model.time / 300) + 1)]
end

return EngineRun
