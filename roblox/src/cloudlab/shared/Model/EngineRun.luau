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
--   lift         15 min of updraft nudging at the start (initiation, Naylor & Gilmore 2012), then
--                for as long as the engine's storm lives an upward push (steerPush: up to PUSH_MAX,
--                set each minute from the model's peak updraft against the engine's updraftMs) on
--                the storm's inflow side (liftSpot: under the model's updraft, walked upwind out
--                of its cold pool - where the engine's storm is fed; with no updraft, from the
--                cold pool's middle to its warm edge); once the engine ends it the push stops and
--                the model storm decays by itself
--   cold pool    the cold air's deficit scaled toward the engine's coldPoolK (10 min)
--   hail         the hail size distribution's intercept moved so the model's biggest stone at the
--                ground matches the engine's hail size (steerHail, 10 min)
--   tornado      while the engine has a tornado down, the 62.5 m nest and an upward push under
--                its strongest 0-1 km spin, set from the gap to the engine's wind (steerTornado):
--                stretching what the storm has
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
	lift: (number | string)?, -- "push" (the default) or the old pull's target at full intensity (m/s)
	pushR: number?, -- the push's radius (m, PUSH_R)
	liftR: number?, -- lift radius (m, 10 km: the standard size)
	torLift: (number | string)?, -- "push" (the default; steerTornado) or the old pull's lift (m/s; 0 = off)
	fine: boolean?, -- the 62.5 m nest while the engine has a tornado down (true)
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
EngineRun.COLD_K = 1 -- ground air this much below the environment is the cold pool (K, as the model's own)
EngineRun.LIFT_SPEED = 2000 -- most the lift moves in a minute (m)
-- the lift's nudging time (s). The pressure field answers each nudge and takes most of it back: at
-- 30 s an 8 m/s target held only ~3 m/s, a broad weak rise the low-level shear swept through
-- without a storm (2026-11-04); at 5 s (the start lift's) the target is reached
EngineRun.LIFT_TAU = 5
EngineRun.ENV_TAU = 15 * 60
EngineRun.COLD_TAU = 10 * 60
-- the lift as a push (opts.lift "push", the default): an upward acceleration in a ball PUSH_R
-- across at 0-3 km, at most PUSH_MAX (m/s^2 at its middle; 0.03 is the buoyancy of about 1 K),
-- set once a model minute from the gap between the model's peak updraft near the storm and the
-- engine's updraftMs: PUSH_TAU is how long a whole gap takes to swing it from none to PUSH_MAX.
-- Tuned on seed 2's first storms (tools/cloudlab/synccheck.mjs, as js/cloudmodel/EngineRun.js)
EngineRun.PUSH_MAX = 0.35 -- (0.2 before the convergence lift: js/cloudmodel/EngineRun.js says why)
-- with the engine's maintenance lift in the record (record.maintenance) the push only trims, up to
-- PUSH_MAX_M2 (as js/cloudmodel/EngineRun.js, which says why)
EngineRun.PUSH_MAX_M2 = 0.25
EngineRun.PUSH_TAU = 8 * 60
EngineRun.PUSH_R = 8000
-- hail (steerHail): once a model minute the model's biggest stone at the ground (the size that
-- about one stone in HAIL_T seconds on a square metre reaches, from its own size distribution and
-- fall speed) is set against the engine's hail size by moving the distribution's intercept: a
-- whole factor-of-e gap in HAIL_TAU. Within N0H_MIN-N0H_MAX (m^-4; 0.4-4.5 inch stones at 0.2-4
-- g/kg); hail held aloft but melting before the ground counts as stones too small
EngineRun.HAIL_T = 600
EngineRun.HAIL_TAU = 10 * 60
EngineRun.HAIL_QMIN = 1e-5
EngineRun.N0H_MIN, EngineRun.N0H_MAX = 1e2, 4e5
-- the tornado (steerTornado), while the engine has one down: a 62.5 m nest (FINE, 2 km across)
-- starts in the 250 m nest on its strongest 50 m spin and follows it; an upward push (a ball TOR_R
-- across at 0-2 TOR_Z, at most TOR_PUSH_MAX m/s^2 at its middle) sits under the finest nest's
-- strongest 50 m spin, stretching it, set once a model minute from the gap between that nest's
-- peak ground wind and the engine's tornado wind (TOR_PUSH_TAU). Tuned as js/cloudmodel/EngineRun.js
EngineRun.FINE = { nx = 32, ratio = 4, steps = 4, vortex = 0.03 }
EngineRun.TOR_R = 1000
EngineRun.TOR_Z = 400
EngineRun.TOR_PUSH_MAX = 2
EngineRun.TOR_PUSH_TAU = 2 * 60
-- the push answers the gust TOR_LEAD model minutes ahead (now plus its last minute's change x
-- TOR_LEAD): a vortex keeps spinning up for minutes after the push that made it, so steering by the
-- gust now overshot and rang (2026-11-05; as js/cloudmodel/EngineRun.js)
EngineRun.TOR_LEAD = 2
-- the engine's tornado wind is an EF-scale peak (3 s) gust; the model's is its strongest cell mean
-- at the lowest level: the push compares the engine's with TOR_GUST x the model's
EngineRun.TOR_GUST = 1.4
-- the tornado is the finest nest's strongest spin averaged from the ground to TOR_COLUMN (m): a
-- column joining the ground to the storm, not a ground swirl alone
EngineRun.TOR_COLUMN = 1000
-- Large-scale rising air (liftRows): the engine's surface convergence at the inflow point lifts the
-- inflow air before the model gets it, as js/cloudmodel/EngineRun.js (its notes say why)
EngineRun.LIFT_S = 3600
EngineRun.LIFT_H = 1500
EngineRun.LIFT_TOP = 6000

-- The sounding rows (p hPa, t, td C, u, v m/s) lifted by the convergence conv (1e-5 /s): each
-- level (but the ground) gets the potential temperature and mixing ratio of the air w(z) LIFT_S
-- below it (above, for divergence), its mixing ratio at most saturation there. conv 0 or nil: the
-- rows as they are.
function EngineRun.liftRows(rows: { { number } }?, conv: number?): { { number } }?
	if not rows or not conv or conv == 0 then
		return rows
	end
	local Rd, Cp, g, eps = 287.04, 1005.7, 9.81, 0.622
	local kap = Rd / Cp
	local function es(t: number): number
		return 6.112 * math.exp(17.67 * t / (t + 243.5))
	end
	local function mix(p: number, t: number): number
		return eps * es(t) / (p - es(t))
	end
	local n = #rows
	local zs, th, q = { 0 }, {}, {}
	for k = 2, n do
		zs[k] = zs[k - 1] + Rd * (0.5 * (rows[k][2] + rows[k - 1][2]) + 273.15) / g * math.log(rows[k - 1][1] / rows[k][1])
	end
	for k = 1, n do
		th[k] = (rows[k][2] + 273.15) * math.pow(1000 / rows[k][1], kap)
		q[k] = mix(rows[k][1], rows[k][3])
	end
	local function at(arr: { number }, z: number): number
		if z <= 0 then
			return arr[1]
		end
		for k = 2, n do
			if zs[k] >= z then
				return arr[k - 1] + (z - zs[k - 1]) / (zs[k] - zs[k - 1]) * (arr[k] - arr[k - 1])
			end
		end
		return arr[n]
	end
	local c, H, Z1 = conv * 1e-5, EngineRun.LIFT_H, EngineRun.LIFT_TOP
	local out = { rows[1] }
	for k = 2, n do
		local z, p = zs[k], rows[k][1]
		local w = if z <= H then c * z elseif z < Z1 then c * H * (Z1 - z) / (Z1 - H) else 0
		local from = z - w * EngineRun.LIFT_S
		local thn = at(th, from)
		local t = thn * math.pow(p / 1000, kap) - 273.15
		local qn = math.min(at(q, from), mix(p, t))
		local e = qn * p / (eps + qn)
		local lg = math.log(e / 6.112)
		out[k] = { p, t, math.min(t, 243.5 * lg / (17.67 - lg)), rows[k][4], rows[k][5] }
	end
	return out
end

-- A nest's strongest spin averaged from the ground to TOR_COLUMN: i, j, zeta (i 0: none).
function EngineRun.columnSpin(top: any): (number, number, number)
	local kt = math.max(1, top:levelAt(EngineRun.TOR_COLUMN))
	local best, bi, bj = 0, 0, 0
	for j = 2, top.ny - 1 do
		for i = 2, top.nx - 1 do
			local s = 0
			for k = 1, kt do
				s += top:zeta(i, j, k)
			end
			s /= kt
			if s > best then
				best, bi, bj = s, i, j
			end
		end
	end
	return bi, bj, best
end

function EngineRun.new(record: any, opts: Options?)
	local o = opts or {}
	local self: any = setmetatable({}, EngineRun)
	-- lift: "push" (the default) or a number: the old pull, w eased up to that many m/s times the
	-- engine's intensity in the ball within LIFT_TAU (kept to compare against)
	self.lift, self.liftR, self.torLift = o.lift or "push", o.liftR or 10000, o.torLift or "push"
	self.useFine, self.fine, self.torPush, self.torSpot, self.torWind = o.fine ~= false, nil, 0, nil, 0
	self.pushMax = if record.maintenance ~= nil then EngineRun.PUSH_MAX_M2 else EngineRun.PUSH_MAX
	self.push, self.wNow, self.pushR = 0.5 * self.pushMax, 0, o.pushR or EngineRun.PUSH_R
	self.useNest, self.useEnv, self.useCold = o.nest ~= false, o.env ~= false, o.cold ~= false
	local snd = Sounding.fromProfile(EngineRun.liftRows(o.startRows or record.inflow, (record.convergence or 0) + (record.maintenance or 0)) :: any)
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
		local th, qv, u, v = CloudModel.profiles(m, Sounding.fromProfile(EngineRun.liftRows(record.inflow, (record.convergence or 0) + (record.maintenance or 0)) :: any))
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
	-- with no updraft (between pulses, or a collapsed storm) the walk starts from the middle of the
	-- cold pool, weighted by how cold it is: the gust front's warm side is where a new cell starts
	local x, y = (bi - 0.5) * dx, (bj - 0.5) * dx
	local t0 = m.th0[1]
	if bi == 0 then
		local sw, sx, sy = 0, 0, 0
		for j = 1, ny do
			for i = 1, nx do
				local d = t0 - th[(i + 2) + (j + 1) * SX + 2 * SXY]
				if d > EngineRun.COLD_K then
					sw += d
					sx += d * (i - 0.5) * dx
					sy += d * (j - 0.5) * dx
				end
			end
		end
		if sw == 0 then
			return nil, nil
		end
		x, y = sx / sw, sy / sw
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
		return x, y
	end
	local ex, ey = -su / sr, -sv / sr -- upwind
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

-- The push's strength: the model's peak updraft (any height, within 16 km of the box's storm
-- point, where liftSpot looks) against the engine's; a weaker model storm is pushed harder.
function EngineRun.steerPush(self: any, target: number)
	local m = self.model
	local nx, ny, nz, SX, SXY, w = m.nx, m.ny, m.nz, m.SX, m.SXY, m.w
	local ti, tj = nx // 2, math.floor(0.45 * ny)
	local wmax = 0
	for k = 1, nz do
		for j = math.max(1, tj - 16), math.min(ny, tj + 16) do
			for i = math.max(1, ti - 16), math.min(nx, ti + 16) do
				local v = w[(i + 2) + (j + 1) * SX + (k + 1) * SXY]
				if v > wmax then
					wmax = v
				end
			end
		end
	end
	self.wNow = wmax
	if not (target > 0) then
		self.push = 0
		return
	end
	local gap = math.clamp((target - wmax) / target, -1, 1)
	self.push = math.clamp(self.push + self.pushMax * gap * 60 / EngineRun.PUSH_TAU, 0, self.pushMax)
end

-- The model's biggest stone at the ground (m), where it has the most ground hail; 0 with hail
-- only aloft; nil with none. N(D) = n0 e^(-lam D) falling at c sqrt(D): the stones larger than D
-- reaching a square metre in HAIL_T are (n0 / lam) e^(-lam D) c sqrt(D) HAIL_T; D where that is 1.
function EngineRun.hailSize(self: any): number?
	local m = self.model
	local nx, ny, nz, SX, SXY, qh = m.nx, m.ny, m.nz, m.SX, m.SXY, m.qh
	local q, aloft = 0, 0
	for j = 1, ny do
		for i = 1, nx do
			local col = (i + 2) + (j + 1) * SX
			q = math.max(q, qh[col + 2 * SXY])
			for k = 2, nz do
				aloft = math.max(aloft, qh[col + (k + 1) * SXY])
			end
		end
	end
	if q < EngineRun.HAIL_QMIN then
		return if aloft >= 10 * EngineRun.HAIL_QMIN then 0 else nil
	end
	local n0, r = m.n0h, m.rho0[1]
	local lam, c = (math.pi * 900 * n0 / (r * q)) ^ 0.25, math.sqrt(4 * 9.81 * 900 / (1.8 * r))
	local D = 10 / lam
	for _ = 1, 20 do
		D = math.max(1e-4, (math.log(n0 * c * EngineRun.HAIL_T / lam) + 0.5 * math.log(D)) / lam)
	end
	return D
end

-- The hail intercept steered toward the engine's hail size (both models: the nest's too).
function EngineRun.steerHail(self: any, inches: number)
	local m = self.model
	local D = self:hailSize()
	self.hailNow = D
	if D == nil or not (inches > 0) then
		return
	end
	local f = if D > 0 then math.clamp(math.log(inches * 0.0254 / D), -1, 1) else 1
	-- the biggest stone goes as n0^(-1/4): a factor e in size is a factor e^4 in n0
	local n0 = math.clamp(m.n0h * math.exp(-4 * f * 60 / EngineRun.HAIL_TAU), EngineRun.N0H_MIN, EngineRun.N0H_MAX)
	m.n0h = n0
	if self.nest then
		self.nest.n0h = n0
	end
end

-- The tornado, once a model minute: with the engine's tornado down, the fine nest starts on the
-- 250 m nest's strongest 50 m spin, and the push is placed under the finest nest's strongest 50 m
-- spin (box metres) and set from the gap between that nest's peak ground wind and the engine's
-- tornado wind. With none down the push is off and the model's vortex is left to itself.
function EngineRun.steerTornado(self: any, tornado: any?)
	local m = self.model
	if not tornado or not self.nest then
		self.torPush, self.torSpot = 0, nil
		return
	end
	-- (a 62.5 m nest the lab started itself is taken as this one)
	self.fine = self.fine or self.nest.child
	if self.useFine and not self.fine then
		local d = Nest.diag(self.nest)
		local F = EngineRun.FINE
		local span = F.nx // F.ratio
		local i0 = math.clamp(d.i - span // 2, 3, self.nest.nx - span - 2)
		local j0 = math.clamp(d.j - span // 2, 3, self.nest.ny - span - 2)
		self.fine = Nest.new(self.nest, { nx = F.nx, ny = F.nx, ratio = F.ratio, steps = F.steps, i0 = i0, j0 = j0, vortex = F.vortex })
	end
	local top = self.fine or self.nest
	local d = Nest.diag(top)
	local prevWind = self.torWind
	self.torWind = EngineRun.TOR_GUST * d.vmax
	local ci, cj = EngineRun.columnSpin(top)
	if ci == 0 then
		self.torSpot = nil -- (no spin at all to stretch)
		return
	end
	-- the spot in the box: the nests' corners (X0, Y0 in their parents) and the cell's middle
	local x, y = (ci - 0.5) * top.dx, (cj - 0.5) * top.dx
	local n = top
	while n.parent do
		x += n.X0
		y += n.Y0
		n = n.parent
	end
	self.torSpot = { x, y, m.ox, m.oy }
	local target = (tornado.mph or 0) * 0.44704
	if not (target > 0) then
		self.torPush = 0
		return
	end
	local ahead = self.torWind + (if prevWind > 0 then (self.torWind - prevWind) * EngineRun.TOR_LEAD else 0)
	local gap = math.clamp((target - ahead) / target, -1, 1)
	self.torPush = math.clamp(self.torPush + EngineRun.TOR_PUSH_MAX * gap * 60 / EngineRun.TOR_PUSH_TAU, 0, EngineRun.TOR_PUSH_MAX)
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
		-- (the engine's cold pool: its deficit and, E2, its depth: js/storms/ColdPool.js)
		if self.useCold and rec.coldPoolDepthM ~= nil then
			m.cpTop = rec.coldPoolDepthM
		end
		if self.useCold and alive then
			self.coldMean = m:coldPoolRate(rec.coldPoolK or 0, EngineRun.COLD_TAU)
		else
			m.cpRate = 0
		end
		if alive and t >= EngineRun.START then
			self:steerPush(rec.updraftMs or 0)
			if rec.hailIn ~= nil then
				self:steerHail(rec.hailIn)
			end
		end
		if self.torLift == "push" then
			self:steerTornado(if alive then rec.tornado else nil)
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
		if not alive then
			m.drive = nil
		elseif self.lift == "push" then
			m.drive = { x = self.lx, y = self.ly, inBox = true, r = self.pushR, z = 1500, rz = 1500, w = self.push, push = true, tau = EngineRun.LIFT_TAU, t1 = math.huge, ramp = 0 }
		else
			m.drive = { x = self.lx, y = self.ly, inBox = true, r = self.liftR, z = 1500, rz = 1500, w = self.lift * (rec.intensity or 0), tau = EngineRun.LIFT_TAU, t1 = math.huge, ramp = 0 }
		end
		if self.torLift == "push" then
			local sp = self.torSpot
			if sp then
				-- (the box shifts with the storm: the spot moves back by the shift)
				sp[1] -= (m.ox - sp[3]) * m.dx
				sp[2] -= (m.oy - sp[4]) * m.dx
				sp[3], sp[4] = m.ox, m.oy
			end
			m.drive2 = if alive and sp and self.torPush > 0
				then { x = sp[1], y = sp[2], inBox = true, r = EngineRun.TOR_R, z = EngineRun.TOR_Z, rz = EngineRun.TOR_Z, w = self.torPush, push = true, tau = EngineRun.LIFT_TAU, t1 = math.huge, ramp = 0 }
				else nil
		elseif (self.torLift :: number) > 0 and alive and rec.tornado then
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
	-- (the convergence: the exported cell nearest the storm then - the export has no inflow point's)
	local function convAt(pos: { number }?): number
		local bd, cv = math.huge, 0
		if pos then
			for _, c in data.cells do
				local d = (c.pos[1] - pos[1]) ^ 2 + (c.pos[2] - pos[2]) ^ 2
				if d < bd then
					bd, cv = d, c.convergence or 0
				end
			end
		end
		return cv
	end
	local lift0 = opts and (opts :: any).lift0
	local function record(p: any): any
		return { motion = p.motion, intensity = p.intensity, coldPoolK = p.coldPoolK, tornado = p.tornado, active = p.active, inflow = p.inflow, convergence = if lift0 then 0 else convAt(p.pos), updraftMs = storm.updraftMs, hailIn = p.hailIn or storm.hailIn }
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
