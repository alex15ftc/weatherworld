--!native
--!optimize 2
-- A small 3-D cloud model: the equations, not closures.
--
--   du/dt = -u.grad u - (1/rho0) dp'/dx + diffusion + surface drag              (same for v)
--   dw/dt = -u.grad w - (1/rho0) dp'/dz + B + diffusion,  B = g (th'/th0 + 0.61 qv' - qc - qr - qh - qsn)
--   dp'/dt = -cs^2 div(rho0 u)                     (quasi-compressible; cs reduced, acoustic substeps)
--   dth/dt, dqv/dt, dqc/dt, dqr/dt, dqh/dt = -u.grad + diffusion + microphysics (Kessler warm rain
--   plus a hail/graupel category)
--
-- Rotation, the dynamic pressure that makes storms split and turn right, the downdrafts, the cold
-- pool and the gust front are not modelled separately: they come out of these equations.
--
-- Numerics (Wicker & Skamarock 2002; Klemp & Wilhelmson 1978): Arakawa C grid, stretched in the
-- vertical (thin levels at the ground for the surface layer), 3rd-order upwind advection, RK3 large
-- steps with acoustic substeps - horizontally explicit forward-backward with Skamarock-Klemp
-- divergence damping, vertically implicit (w and p' solved together per column, so the thin
-- levels don't limit the step). Ground: log-law drag on the lowest level (base-state
-- substitution, Roberts et al. 2016); rigid lid with a Rayleigh sponge; open (zero-gradient) sides.
-- Kessler (1969) microphysics with Klemp & Wilhelmson (1978) coefficients, saturation adjustment
-- after each step. Winds are kept relative to a moving frame (umove, vmove), and the grid can shift
-- by whole cells to follow the main storm.
local CloudModel = {}
CloudModel.__index = CloudModel

local G, CP, RD, RV, LV, P00 = 9.81, 1004.0, 287.04, 461.5, 2.5e6, 1e5
-- hail/graupel (Lin, Farley & Orville 1983; hail parameters): exponential sizes with intercept
-- n0h (cfg; 4e4 m^-4 is Lin's graupel-like hail, 4e2 large hail: fewer, bigger stones, the
-- supercell value of Snook & Xue 2008 / Dawson et al. 2010; default 4e4 since snow was added,
-- 2026-11-04: with all cold-cloud ice as large hail, 4e2 gave 400-1300 mm/h at the ground, 85-90%
-- hail; with snow and 4e4, 70-330 mm/h and 0-20% hail), density RHOH, drag 0.6; latent heat of fusion LF; air conductivity KA, vapour
-- diffusivity DV, kinematic viscosity NU, Schmidt number 0.6
local LF, RHOH, KA, DV, NU = 3.34e5, 900, 2.43e-2, 2.26e-5, 1.5e-5
local N0R = 8e6 -- rain intercept (Marshall-Palmer, the Kessler assumption)
-- snow (Lin et al. 1983): intercept (m^-4), density (kg/m3), fall speed V = SC D^SD (m/s, D in m);
-- the Gamma functions of its fall-speed, riming and melting integrals; ice nucleation and
-- glaciation of cold cloud (Bergeron, then homogeneous freezing at HOMO_C)
local N0S, RHOS, SC, SD = 3e6, 100, 11.72, 0.41
local G4SD, G3SD, G5SD2 = 10.276, 3.013, 1.551 -- Gamma(4 + d), Gamma(3 + d), Gamma((5 + d) / 2)
local LS = 2.834e6 -- sublimation (J/kg)
local HOMO_C = -40
local GLAC_S = 300 -- cloud water glaciating to snow at HOMO_C takes this long (s); slower when warmer
local KAPPA = RD / CP
local exp, sqrt, max, min, cos, pi = math.exp, math.sqrt, math.max, math.min, math.cos, math.pi

export type Config = {
	nx: number, ny: number,
	dx: number,
	-- vertical grid: either uniform (nz, dz) or stretched (dzmin at the ground growing by `stretch`
	-- per level up to dzmax, to ztop)
	nz: number?, dz: number?,
	dzmin: number?, dzmax: number?, stretch: number?, ztop: number?,
	dt: number?, -- large step (s)
	cs: number?, -- acoustic speed (m/s)
	K: number?, -- eddy diffusivity (m2/s)
	umove: number?, vmove: number?,
	zdamp: number?, -- sponge base (m)
	z0: number?, -- ground roughness length (m); 0 = free slip
	follow: boolean?, -- shift the grid to keep the main rotating updraft centred
	zf: { number }?, -- explicit face heights (a nest shares its parent's levels)
}
-- (model.yieldFn, optional: called between chunks of a step, so a game can spread one step over
-- several frames - nothing else may touch the fields until step() returns)

local function satMix(p: number, T: number): number
	-- saturation mixing ratio over water (Teten), p in Pa
	return 380.2 / p * exp(17.27 * (T - 273.15) / (T - 35.86))
end
CloudModel.satMix = satMix

local function faceHeights(cfg: Config): { number }
	if cfg.zf then
		return table.clone(cfg.zf)
	end
	local zf = { [1] = 0 }
	if cfg.dzmin then
		local dz, top = cfg.dzmin, cfg.ztop or 16000
		local k = 1
		while zf[k] < top - 1 do
			zf[k + 1] = zf[k] + dz
			k += 1
			dz = min(cfg.dzmax or 700, dz * (cfg.stretch or 1.12))
		end
	else
		for k = 1, cfg.nz :: number do
			zf[k + 1] = k * (cfg.dz :: number)
		end
	end
	return zf
end

function CloudModel.new(cfg: Config, snd: any)
	local m: any = setmetatable({}, CloudModel)
	local zf = faceHeights(cfg)
	local nx, ny, nz = cfg.nx, cfg.ny, #zf - 1
	m.nx, m.ny, m.nz = nx, ny, nz
	m.dx = cfg.dx
	m.dt = cfg.dt or 6
	m.cs = cfg.cs or 150
	m.K = cfg.K or 75
	-- horizontal mixing (m^2/s); a finer grid resolves more of the eddies, so a nest takes less
	m.Kh = cfg.Kh or m.K
	m.umove, m.vmove = cfg.umove or 0, cfg.vmove or 0
	m.ztop = zf[nz + 1]
	m.zdamp = cfg.zdamp or (m.ztop - 4000)
	m.time = 0
	local SX, SY = nx + 4, ny + 4
	local SXY = SX * SY
	m.SX, m.SXY = SX, SXY
	local N = SXY * (nz + 5)
	m.N = N
	local function arr()
		return table.create(N, 0)
	end
	-- prognostic (current), saved state at the step start (S), slow tendencies (R)
	for _, f in { "u", "v", "w", "p", "th", "qv", "qc", "qr", "qh", "qsn" } do
		m[f] = arr()
		m[f .. "S"] = arr()
		m["R" .. f] = arr()
	end
	m.B = arr()
	m.pOld = arr()
	m.rainSfc = table.create(SXY, 0) -- surface rain + hail rate (mm/h) by column (index (j + 1) SX + i + 2)
	m.hailSfc = table.create(SXY, 0) -- of which hail (mm/h liquid equivalent)
	m.hail = cfg.hail ~= false -- the ice category (false: Kessler warm rain only)
	m.n0h = cfg.n0h or 4e4
	-- cloud collecting into drops below 0 C: true sends them straight to graupel (the old shortcut);
	-- false keeps them rain, which then freezes by the Bigg rate (Lin et al. 1983)
	m.autoToIce = cfg.autoToIce == true

	-- vertical metrics: cells k = 1..nz between faces zf[k], zf[k + 1]; dzc cell depth, dzw the
	-- distance between the centres either side of face k
	local zc, dzc, dzw = {}, {}, {}
	m.zf = zf
	for k = 1, nz do
		zc[k] = 0.5 * (zf[k] + zf[k + 1])
		dzc[k] = zf[k + 1] - zf[k]
	end
	for k = 2, nz do
		dzw[k] = zc[k] - zc[k - 1]
	end
	dzc[0], dzc[-1] = dzc[1], dzc[1]
	dzc[nz + 1], dzc[nz + 2], dzc[nz + 3] = dzc[nz], dzc[nz], dzc[nz]
	dzw[1], dzw[0], dzw[-1] = dzc[1], dzc[1], dzc[1]
	dzw[nz + 1], dzw[nz + 2], dzw[nz + 3] = dzc[nz], dzc[nz], dzc[nz]
	zc[0], zc[-1] = -zc[1], -zc[1] - dzc[1]
	zc[nz + 1], zc[nz + 2], zc[nz + 3] = zc[nz] + dzc[nz], zc[nz] + 2 * dzc[nz], zc[nz] + 3 * dzc[nz]
	m.zc, m.dzc, m.dzw = zc, dzc, dzw

	-- surface drag coefficient from the log law at the lowest level's centre: Cd = (k / ln(z1/z0))^2
	local z0 = if cfg.z0 == nil then 0.1 else cfg.z0
	m.z0 = z0
	m.snd = snd
	m.cd = if z0 > 0 then (0.4 / math.log(zc[1] / z0)) ^ 2 else 0
	m.follow = cfg.follow ~= false
	m.ox, m.oy = 0, 0 -- grid shifts (cells) so far

	-- base state: hydrostatic, from the sounding
	m.psfc = snd.psfc
	m.th0, m.qv0, m.u0, m.v0 = CloudModel.profiles(m, snd)
	m.pi0, m.p0, m.rho0, m.rhow = {}, {}, {}, {}
	CloudModel.hydrostatic(m)
	local th0, qv0, u0, v0 = m.th0, m.qv0, m.u0, m.v0

	-- initial fields: the environment, in the moving frame
	for k = -1, nz + 3 do
		local kk = math.clamp(k, 1, nz)
		for j = -1, ny + 2 do
			for i = -1, nx + 2 do
				local n = m:idx(i, j, k)
				m.u[n] = u0[kk] - m.umove
				m.v[n] = v0[kk] - m.vmove
				m.th[n] = th0[kk]
				m.qv[n] = qv0[kk]
			end
		end
	end
	m:fill()
	return m
end

-- A sounding's theta, water vapour and wind at the cell centres (1..nz), the vapour from its
-- relative humidity at the hydrostatic pressure (iterated with the virtual temperature)
function CloudModel.profiles(self: any, snd: any): ({ number }, { number }, { number }, { number })
	local nz, zc = self.nz, self.zc
	local th0, qv0, u0, v0 = {}, {}, {}, {}
	local piS = (snd.psfc / P00) ^ KAPPA
	for _ = 1, 3 do
		local piPrev, zPrev, thvPrev = piS, 0, nil
		for k = 1, nz do
			local z = zc[k]
			local th = snd.theta(z)
			local thv = th * (1 + 0.61 * (qv0[k] or 0))
			local tv0 = thvPrev or snd.theta(0) * (1 + 0.61 * (qv0[1] or 0))
			local pik = piPrev - G / CP * (z - zPrev) / (0.5 * (thv + tv0))
			th0[k] = th
			local pk = P00 * pik ^ (1 / KAPPA)
			qv0[k] = min(snd.qvMax, snd.rh(z) * satMix(pk, th * pik))
			piPrev, zPrev, thvPrev = pik, z, thv
		end
	end
	for k = 1, nz do
		u0[k], v0[k] = snd.wind(zc[k])
	end
	return th0, qv0, u0, v0
end

-- The rest of the base state from th0, qv0 (and u0, v0) and the surface pressure, filled in place:
-- hydrostatic Exner pressure, pressure, density (cell centres and w faces), ghost levels, and the
-- base state's own vertical diffusion at each level (with the same zero-gradient ghosts the fields
-- get), taken back out of the tendencies: diffusion acts on the storm's perturbations only. On the
-- full fields it carried heat down the stable profile into the lowest level (+1.2 K over an hour)
-- and diffused the low-level shear away (~700 m in 2 h), 2026-11-04
function CloudModel.hydrostatic(self: any)
	local nz, zc, zf, dzc, dzw = self.nz, self.zc, self.zf, self.dzc, self.dzw
	local th0, qv0, pi0, p0, rho0, rhow, u0, v0 = self.th0, self.qv0, self.pi0, self.p0, self.rho0, self.rhow, self.u0, self.v0
	local piPrev, zPrev = (self.psfc / P00) ^ KAPPA, 0
	local thvPrev = th0[1] * (1 + 0.61 * qv0[1])
	for k = 1, nz do
		local thv = th0[k] * (1 + 0.61 * qv0[k])
		local pik = piPrev - G / CP * (zc[k] - zPrev) / (0.5 * (thv + thvPrev))
		pi0[k] = pik
		local pk = P00 * pik ^ (1 / KAPPA)
		p0[k] = pk
		rho0[k] = pk / (RD * th0[k] * pik * (1 + 0.61 * qv0[k]))
		piPrev, zPrev, thvPrev = pik, zc[k], thv
	end
	for _, t in { th0, qv0, pi0, p0, rho0, u0, v0 } do
		t[0], t[-1] = t[1], t[1]
		t[nz + 1], t[nz + 2], t[nz + 3] = t[nz], t[nz], t[nz]
	end
	for k = 2, nz do
		local f = (zf[k] - zc[k - 1]) / dzw[k]
		rhow[k] = rho0[k - 1] + (rho0[k] - rho0[k - 1]) * f
	end
	rhow[1] = rho0[1] + (rho0[1] - rho0[2]) * (zc[1] / dzw[2])
	rhow[nz + 1] = rho0[nz] - (rho0[nz - 1] - rho0[nz]) * (0.5 * dzc[nz] / dzw[nz])
	local K = self.K
	local function baseLap(t: { number }): { number }
		local out = {}
		for k = 1, nz do
			local up = if k < nz then (t[k + 1] - t[k]) / dzw[k + 1] else 0
			local dn = if k > 1 then (t[k] - t[k - 1]) / dzw[k] else 0
			out[k] = K * (up - dn) / dzc[k]
		end
		return out
	end
	self.lapTh, self.lapQv, self.lapU, self.lapV = baseLap(th0), baseLap(qv0), baseLap(u0), baseLap(v0)
end

-- A changing environment (the engine's air along the storm's track, through the afternoon): the
-- base state eases toward self.env = { th, qv, u, v (1..nz, from CloudModel.profiles), tau (s),
-- psfc }, and every point of each level takes the same change, so the storm's own perturbations
-- ride on the new air unchanged. Nests take their parent's env (Nest.advance).
function CloudModel.relaxEnvironment(self: any, dt: number)
	local e = self.env
	local a = math.min(1, dt / e.tau)
	local nz, SXY = self.nz, self.SXY
	local th0, qv0, u0, v0 = self.th0, self.qv0, self.u0, self.v0
	local u, v, th, qv = self.u, self.v, self.th, self.qv
	for k = 1, nz do
		local dth, dq = a * (e.th[k] - th0[k]), a * (e.qv[k] - qv0[k])
		local du, dv = a * (e.u[k] - u0[k]), a * (e.v[k] - v0[k])
		th0[k] += dth
		qv0[k] += dq
		u0[k] += du
		v0[k] += dv
		local n0 = (k + 1) * SXY + 1
		for n = n0, n0 + SXY - 1 do
			th[n] += dth
			qv[n] = math.max(0, qv[n] + dq)
			u[n] += du
			v[n] += dv
		end
	end
	if e.psfc then
		self.psfc += a * (e.psfc - self.psfc)
	end
	CloudModel.hydrostatic(self)
end

-- The frame's motion changes (the engine storm turns or speeds up): the winds in the box are
-- ground-relative minus the frame's motion, so they shift by the change; nests follow.
function CloudModel.setMotion(self: any, um: number, vm: number)
	local du, dv = um - self.umove, vm - self.vmove
	if du ~= 0 or dv ~= 0 then
		local u, v = self.u, self.v
		for n = 1, self.N do
			u[n] -= du
			v[n] -= dv
		end
		self.umove, self.vmove = um, vm
	end
	if self.child then
		CloudModel.setMotion(self.child, um, vm)
	end
end

-- The cold pool's strength steered toward a target (the engine's cold pool deficit, K): the
-- root model measures the mean temperature deficit of its cold-pool air (lowest level, colder
-- than COLD_K) and sets a rate that scales the cold air's deficit (below COLD_TOP) toward the
-- target over tau seconds; nests take the same rate (Nest.advance). Its shape, edges and gust
-- front stay the model's own. Returns the measured mean deficit (K).
CloudModel.COLD_K, CloudModel.COLD_TOP = 1, 1500
function CloudModel.coldPoolRate(self: any, targetK: number, tau: number): number
	local th, th0, SX, SXY = self.th, self.th0, self.SX, self.SXY
	local sum, n = 0, 0
	for j = 1, self.ny do
		for i = 1, self.nx do
			local d = th0[1] - th[(i + 2) + (j + 1) * SX + 2 * SXY]
			if d > CloudModel.COLD_K then
				sum += d
				n += 1
			end
		end
	end
	if n < 4 then
		self.cpRate = 0
		return 0
	end
	local mean = sum / n
	local f = math.clamp(targetK / mean, 0.25, 2)
	self.cpRate = (f - 1) / tau
	return mean
end

function CloudModel.applyColdPool(self: any, dt: number)
	local s = 1 + self.cpRate * dt
	local th, th0, SX, SXY, zc = self.th, self.th0, self.SX, self.SXY, self.zc
	for k = 1, self.nz do
		if zc[k] > CloudModel.COLD_TOP then
			break
		end
		local t0 = th0[k]
		for j = 1, self.ny do
			local n0 = 2 + (j + 1) * SX + (k + 1) * SXY
			for i = 1, self.nx do
				local n = n0 + i
				local d = th[n] - t0
				if d < 0 then
					th[n] = t0 + s * d
				end
			end
		end
	end
end

function CloudModel.idx(self: any, i: number, j: number, k: number): number
	return (i + 2) + (j + 1) * self.SX + (k + 1) * self.SXY
end

-- the cell level whose centre is nearest height z
function CloudModel.levelAt(self: any, z: number): number
	local best, bk = math.huge, 1
	for k = 1, self.nz do
		local d = math.abs(self.zc[k] - z)
		if d < best then
			best, bk = d, k
		end
	end
	return bk
end

-- A warm bubble: dth (K) at (xc, yc, zc0), radii rh, rz (m), cos^2 profile.
function CloudModel.bubble(self: any, xc: number, yc: number, zc0: number, rh: number, rz: number, dth: number)
	for k = 1, self.nz do
		for j = 1, self.ny do
			for i = 1, self.nx do
				local x, y, z = (i - 0.5) * self.dx, (j - 0.5) * self.dx, self.zc[k]
				local r = sqrt(((x - xc) / rh) ^ 2 + ((y - yc) / rh) ^ 2 + ((z - zc0) / rz) ^ 2)
				if r < 1 then
					local n = self:idx(i, j, k)
					self.th[n] += dth * cos(0.5 * pi * r) ^ 2
				end
			end
		end
	end
	self:fill()
end

-- Boundary (ghost) values. Sides: zero gradient (open); u's and v's edge faces copy their
-- neighbours. Ground and lid: w = 0 on them, mirrored below and above; the rest zero gradient.
local function fillLateral(f: { number }, nx: number, ny: number, nz: number, SX: number, SXY: number, kind: number)
	-- kind 0 cell, 1 u-face, 2 v-face
	for k = -1, nz + 3 do
		local kb = (k + 1) * SXY
		for j = -1, ny + 2 do
			local b = kb + (j + 1) * SX
			if kind == 1 then
				f[b + 3] = f[b + 4] -- face 1 = face 2
				f[b + nx + 3] = f[b + nx + 2] -- face nx+1 = face nx
				f[b + 2], f[b + 1] = f[b + 3], f[b + 3]
				f[b + nx + 4] = f[b + nx + 3]
			else
				f[b + 2], f[b + 1] = f[b + 3], f[b + 3]
				f[b + nx + 3], f[b + nx + 4] = f[b + nx + 2], f[b + nx + 2]
			end
		end
		local r1, r0, rm = kb + 2 * SX, kb + SX, kb
		local rn, rn1, rn2 = kb + (ny + 1) * SX, kb + (ny + 2) * SX, kb + (ny + 3) * SX
		if kind == 2 then
			local r2 = kb + 3 * SX
			for i = 1, SX do
				f[r1 + i] = f[r2 + i]
				f[rn1 + i] = f[rn + i]
			end
		end
		for i = 1, SX do
			f[r0 + i] = f[r1 + i]
			f[rm + i] = f[r1 + i]
			if kind == 2 then
				f[rn2 + i] = f[rn1 + i]
			else
				f[rn1 + i] = f[rn + i]
				f[rn2 + i] = f[rn + i]
			end
		end
	end
end

local function fillVertical(f: { number }, nz: number, SXY: number, isW: boolean)
	local z1, z0, zm = 2 * SXY, SXY, 0
	local zn, zn1, zn2, zn3 = (nz + 1) * SXY, (nz + 2) * SXY, (nz + 3) * SXY, (nz + 4) * SXY
	if isW then
		local f1, f2, f3 = 2 * SXY, 3 * SXY, 4 * SXY
		local fn, fn1, fnm1 = (nz + 1) * SXY, (nz + 2) * SXY, nz * SXY
		for i = 1, SXY do
			f[f1 + i] = 0
			f[z0 + i] = -f[f2 + i]
			f[zm + i] = -f[f3 + i]
			f[fn1 + i] = 0
			f[zn2 + i] = -f[fn + i]
			f[zn3 + i] = -f[fnm1 + i]
		end
	else
		for i = 1, SXY do
			local a = f[z1 + i]
			f[z0 + i] = a
			f[zm + i] = a
			local b = f[zn + i]
			f[zn1 + i] = b
			f[zn2 + i] = b
			f[zn3 + i] = b
		end
	end
end

-- Side boundaries of one field: zero gradient, then (a nest) the parent's values (self.bc).
-- kind 0 cell, 1 u-face, 2 v-face, 3 w-face
function CloudModel.lateral(self: any, name: string, kind: number)
	local f = self[name]
	fillLateral(f, self.nx, self.ny, self.nz, self.SX, self.SXY, if kind == 3 then 0 else kind)
	local bc = self.bc
	if bc then
		bc(self, name, f, kind)
	end
end

local KINDS = { u = 1, v = 2, w = 3, p = 0, th = 0, qv = 0, qc = 0, qr = 0, qh = 0, qsn = 0 }
CloudModel.KINDS = KINDS

function CloudModel.fill(self: any)
	local nz, SXY = self.nz, self.SXY
	for name, kind in KINDS do
		self:lateral(name, kind)
	end
	fillVertical(self.u, nz, SXY, false)
	fillVertical(self.v, nz, SXY, false)
	fillVertical(self.w, nz, SXY, true)
	for _, f in { self.p, self.th, self.qv, self.qc, self.qr, self.qh, self.qsn } do
		fillVertical(f, nz, SXY, false)
	end
end

-- 3rd-order upwind in index space: a * dphi/ds at n (stride s), c = 1 / (6 h)
local function up3(f: { number }, n: number, s: number, a: number, c: number): number
	if a >= 0 then
		return a * c * (2 * f[n + s] + 3 * f[n] - 6 * f[n - s] + f[n - 2 * s])
	end
	return a * c * (-f[n + 2 * s] + 6 * f[n + s] - 3 * f[n] - 2 * f[n - s])
end

-- K lap: horizontal (kh = K / dx^2) plus vertical on the stretched grid: the flux difference
-- (f[k+1] - f[k]) / up - (f[k] - f[k-1]) / dn, over the level's own depth (K / depth = kv)
local function lap(f: { number }, n: number, sy: number, sz: number, kh: number, kv: number, up: number, dn: number): number
	local c = f[n]
	return (f[n + 1] + f[n - 1] + f[n + sy] + f[n - sy] - 4 * c) * kh + ((f[n + sz] - c) / up - (c - f[n - sz]) / dn) * kv
end

-- Where a field is non-zero: for each grid row (all SX cells of one j and k, ghosts included),
-- the first and last cell that isn't exactly 0 (lo > hi when the row is all zero). Cloud water,
-- rain, hail and snow are exactly 0 in most of the box, and their slow tendency there is exactly 0
-- too, so slow() only works them out where the stencil can reach something.
local function rowSpans(f: { number }, SX: number, nrows: number, lo: { number }, hi: { number })
	for r = 0, nrows - 1 do
		local b = r * SX
		local a, z = SX + 1, 0
		for i = 1, SX do
			if f[b + i] ~= 0 then
				a = i
				break
			end
		end
		if a <= SX then
			for i = SX, a, -1 do
				if f[b + i] ~= 0 then
					z = i
					break
				end
			end
		end
		lo[r], hi[r] = a, z
	end
end

-- Advection and diffusion of one cloud or precipitation field along one row (cells i1..i2),
-- the same sums as the full loop
local function scalarRow(f: { number }, R: { number }, u: { number }, v: { number }, w: { number }, n0: number, i1: number, i2: number, cx: number, czc: number, kh: number, kvc: number, upC: number, dnC: number, sy: number, sz: number)
	for i = i1, i2 do
		local n = n0 + i
		local U = 0.5 * (u[n] + u[n + 1])
		local V = 0.5 * (v[n] + v[n + sy])
		local W = 0.5 * (w[n] + w[n + sz])
		R[n] = -(up3(f, n, 1, U, cx) + up3(f, n, sy, V, cx) + up3(f, n, sz, W, czc)) + lap(f, n, sy, sz, kh, kvc, upC, dnC)
	end
end

-- Slow tendencies (advection, diffusion, buoyancy, sponge, drag) of the current state.
function CloudModel.slow(self: any)
	local nx, ny, nz, SX, SXY = self.nx, self.ny, self.nz, self.SX, self.SXY
	local u, v, w, th, qv, qc, qr, qh, qsn = self.u, self.v, self.w, self.th, self.qv, self.qc, self.qr, self.qh, self.qsn
	local Ru, Rv, Rw, Rth, Rqv, Rqc, Rqr, Rqh, Rqsn, B = self.Ru, self.Rv, self.Rw, self.Rth, self.Rqv, self.Rqc, self.Rqr, self.Rqh, self.Rqsn, self.B
	local th0, qv0, u0, v0, zc, zf, dzc, dzw = self.th0, self.qv0, self.u0, self.v0, self.zc, self.zf, self.dzc, self.dzw
	local cx = 1 / (6 * self.dx)
	local K = self.K
	local kh = self.Kh / (self.dx * self.dx)
	local sy, sz = SX, SXY
	local zd, ztop = self.zdamp, self.ztop
	local um, vm = self.umove, self.vmove
	local u0g, v0g = u0[1], v0[1]
	local s0 = sqrt(u0g * u0g + v0g * v0g)
	local SY = SXY // SX
	local nrows = self.N // SX
	local hyd = self.hydSpans
	if not hyd then
		hyd = {}
		for f = 1, 4 do
			hyd[f] = { lo = table.create(nrows, 0), hi = table.create(nrows, 0) }
		end
		self.hydSpans = hyd
	end
	local HF, HR = { qc, qr, qh, qsn }, { Rqc, Rqr, Rqh, Rqsn }
	for f = 1, 4 do
		rowSpans(HF[f], SX, nrows, hyd[f].lo, hyd[f].hi)
	end
	for k = 1, nz do
		local t0, q0 = th0[k], qv0[k]
		for j = 1, ny do
			local n = 2 + (j + 1) * SX + (k + 1) * SXY
			for i = 1, nx do
				local c = n + i
				B[c] = G * ((th[c] - t0) / t0 + 0.61 * (qv[c] - q0) - qc[c] - qr[c] - qh[c] - qsn[c])
			end
		end
	end
	for k = 1, nz do
		local z = zc[k]
		local damp = if z > zd then (1 - cos(0.5 * pi * (z - zd) / (ztop - zd))) / 300 else 0
		local dampW = if zf[k] > zd then (1 - cos(0.5 * pi * (zf[k] - zd) / (ztop - zd))) / 300 else 0
		local ue, ve = u0[k] - um, v0[k] - vm
		-- vertical metrics: cell fields (index-space advection 1/(6 dzc), diffusion over dzc between
		-- the centre spacings) and w at face k (1/(6 dzw), over dzw between the cell depths)
		local czc, czw = 1 / (6 * dzc[k]), 1 / (6 * dzw[k])
		local kvc, kvw = K / dzc[k], K / dzw[k]
		local upC, dnC = dzw[k + 1], dzw[k]
		local upW, dnW = dzc[k], dzc[k - 1]
		-- surface drag on the lowest level, base-state substitution (Roberts et al. 2016): the
		-- environment's own drag is taken out, so friction acts on what the storm adds and the base
		-- state stays steady (it has no pressure gradient or Coriolis force to balance drag)
		local cd = if k == 1 then self.cd / dzc[1] else 0
		local bTh, bQv, bU, bV = self.lapTh[k], self.lapQv[k], self.lapU[k], self.lapV[k]
		local yf = self.yieldFn
		if yf then
			yf()
		end
		for j = 1, ny do
			local n0 = 2 + (j + 1) * SX + (k + 1) * SXY
			for i = 1, nx do
				local n = n0 + i
				local U = 0.5 * (u[n] + u[n + 1])
				local V = 0.5 * (v[n] + v[n + sy])
				local W = 0.5 * (w[n] + w[n + sz])
				Rth[n] = -(up3(th, n, 1, U, cx) + up3(th, n, sy, V, cx) + up3(th, n, sz, W, czc)) + lap(th, n, sy, sz, kh, kvc, upC, dnC) - bTh - damp * (th[n] - th0[k])
				Rqv[n] = -(up3(qv, n, 1, U, cx) + up3(qv, n, sy, V, cx) + up3(qv, n, sz, W, czc)) + lap(qv, n, sy, sz, kh, kvc, upC, dnC) - bQv
				-- u at the west face of cell i
				do
					local Vu = 0.25 * (v[n] + v[n - 1] + v[n + sy] + v[n - 1 + sy])
					local Wu = 0.25 * (w[n] + w[n - 1] + w[n + sz] + w[n - 1 + sz])
					local a = u[n]
					local r = -(up3(u, n, 1, a, cx) + up3(u, n, sy, Vu, cx) + up3(u, n, sz, Wu, czc)) + lap(u, n, sy, sz, kh, kvc, upC, dnC) - bU - damp * (a - ue)
					if cd > 0 then
						local ug, vg = a + um, Vu + vm
						r -= cd * (sqrt(ug * ug + vg * vg) * ug - s0 * u0g)
					end
					Ru[n] = r
				end
				-- v at the south face
				do
					local Uv = 0.25 * (u[n] + u[n + 1] + u[n - sy] + u[n + 1 - sy])
					local Wv = 0.25 * (w[n] + w[n - sy] + w[n + sz] + w[n - sy + sz])
					local a = v[n]
					local r = -(up3(v, n, 1, Uv, cx) + up3(v, n, sy, a, cx) + up3(v, n, sz, Wv, czc)) + lap(v, n, sy, sz, kh, kvc, upC, dnC) - bV - damp * (a - ve)
					if cd > 0 then
						local ug, vg = Uv + um, a + vm
						r -= cd * (sqrt(ug * ug + vg * vg) * vg - s0 * v0g)
					end
					Rv[n] = r
				end
				-- w at the bottom face (k >= 2)
				if k >= 2 then
					local Uw = 0.25 * (u[n] + u[n + 1] + u[n - sz] + u[n + 1 - sz])
					local Vw = 0.25 * (v[n] + v[n + sy] + v[n - sz] + v[n + sy - sz])
					local a = w[n]
					Rw[n] = -(up3(w, n, 1, Uw, cx) + up3(w, n, sy, Vw, cx) + up3(w, n, sz, a, czw)) + lap(w, n, sy, sz, kh, kvw, upW, dnW) + 0.5 * (B[n] + B[n - sz]) - dampW * a
				else
					Rw[n] = 0
				end
			end
		end
		-- cloud and precipitation: only where the stencil (2 cells each way along each axis)
		-- reaches a non-zero value; exactly 0 elsewhere
		for f = 1, 4 do
			local lo, hi, F, R = hyd[f].lo, hyd[f].hi, HF[f], HR[f]
			for j = 1, ny do
				local r = (j + 1) + (k + 1) * SY
				local a, z = lo[r] - 2, hi[r] + 2
				for d = 1, 2 do
					local r1, r2, r3, r4 = r - d, r + d, r - d * SY, r + d * SY
					if lo[r1] < a then a = lo[r1] end
					if hi[r1] > z then z = hi[r1] end
					if lo[r2] < a then a = lo[r2] end
					if hi[r2] > z then z = hi[r2] end
					if lo[r3] < a then a = lo[r3] end
					if hi[r3] > z then z = hi[r3] end
					if lo[r4] < a then a = lo[r4] end
					if hi[r4] > z then z = hi[r4] end
				end
				-- row cells a..z (1..SX) are interior i = a-2..z-2
				local i1, i2 = math.max(1, a - 2), math.min(nx, z - 2)
				local n0 = 2 + (j + 1) * SX + (k + 1) * SXY
				if i1 > i2 then
					for i = 1, nx do
						R[n0 + i] = 0
					end
				else
					for i = 1, i1 - 1 do
						R[n0 + i] = 0
					end
					for i = i2 + 1, nx do
						R[n0 + i] = 0
					end
					scalarRow(F, R, u, v, w, n0, i1, i2, cx, czc, kh, kvc, upC, dnC, sy, sz)
				end
			end
		end
	end
end

local function copy(dst: { number }, src: { number }, N: number)
	table.move(src, 1, N, 1, dst)
end

-- Acoustic substeps over dts from the saved state (uS..pS) with the slow tendencies held.
-- Horizontal: forward-backward, explicit. Vertical: w and p' implicit together per column
-- (backward), a tridiagonal solve - the thin ground levels don't limit the substep.
function CloudModel.fast(self: any, dts: number)
	local nx, ny, nz, SX, SXY = self.nx, self.ny, self.nz, self.SX, self.SXY
	local u, v, w, p, pOld = self.u, self.v, self.w, self.p, self.pOld
	local Ru, Rv, Rw = self.Ru, self.Rv, self.Rw
	local rho0, rhow, dzc, dzw = self.rho0, self.rhow, self.dzc, self.dzw
	local dx = self.dx
	local cs2 = self.cs * self.cs
	local ns = math.max(1, math.ceil(dts / (0.5 * dx / self.cs)))
	local tau = dts / ns
	local sy, sz = SX, SXY
	local beta = 0.1 -- divergence damping (Skamarock & Klemp 1992): p + beta (p - p_prev)
	copy(u, self.uS, self.N)
	copy(v, self.vS, self.N)
	copy(w, self.wS, self.N)
	copy(p, self.pS, self.N)
	copy(pOld, self.pS, self.N)
	local idx = 1 / dx
	local b = tau * cs2
	-- tridiagonal coefficients (the same every column), faces k = 2..nz:
	--   w_k - a_k b [rw_{k+1} w_{k+1}/dzc_k - rw_k w_k (1/dzc_k + 1/dzc_{k-1}) + rw_{k-1} w_{k-1}/dzc_{k-1}] = rhs
	local lo, di, hi = {}, {}, {}
	for k = 2, nz do
		local a = tau / (rhow[k] * dzw[k])
		lo[k] = if k > 2 then -a * b * rhow[k - 1] / dzc[k - 1] else 0
		hi[k] = if k < nz then -a * b * rhow[k + 1] / dzc[k] else 0
		di[k] = 1 + a * b * rhow[k] * (1 / dzc[k] + 1 / dzc[k - 1])
	end
	-- (the Thomas forward sweep's factors depend only on the coefficients: computed once)
	local cpf, den = table.create(nz + 1, 0), table.create(nz + 1, 0)
	for k = 2, nz do
		local d = di[k] - (if k > 2 then lo[k] * cpf[k - 1] else 0)
		den[k] = d
		cpf[k] = hi[k] / d
	end
	-- whole-grid work arrays: the column solve runs level by level across all columns (the same
	-- sums per column, in the same order, but along memory instead of a level's stride per step)
	local N = self.N
	local ps, dp, pd = self.fastPs, self.fastDp, self.fastPd
	if not ps then
		ps, dp, pd = table.create(N, 0), table.create(N, 0), table.create(N, 0)
		self.fastPs, self.fastDp, self.fastPd = ps, dp, pd
	end
	-- the damped pressure p + beta (p - p_prev); at the start p_prev = p, so it is p
	copy(pd, self.pS, N)
	local yf = self.yieldFn
	for _ = 1, ns do
		-- horizontal momentum, explicit
		for k = 1, nz do
			local cu = tau * idx / rho0[k]
			for j = 1, ny do
				local n0 = 2 + (j + 1) * SX + (k + 1) * SXY
				for i = 1, nx do
					local n = n0 + i
					local pn = pd[n]
					if i >= 2 then
						u[n] += tau * Ru[n] - cu * (pn - pd[n - 1])
					end
					if j >= 2 then
						v[n] += tau * Rv[n] - cu * (pn - pd[n - sy])
					end
				end
			end
		end
		self:lateral("u", 1)
		self:lateral("v", 2)
		-- per column: p* = p - b rho0 div_h(u), then w and p' together (Thomas sweeps by level)
		for k = 1, nz do
			if yf and k % 8 == 0 then
				yf()
			end
			local br = b * rho0[k]
			for j = 1, ny do
				local n0 = 2 + (j + 1) * SX + (k + 1) * SXY
				for i = 1, nx do
					local n = n0 + i
					pOld[n] = p[n]
					ps[n] = p[n] - br * ((u[n + 1] - u[n]) * idx + (v[n + sy] - v[n]) * idx)
				end
			end
		end
		for k = 2, nz do
			local a = tau / (rhow[k] * dzw[k])
			local lk, dk = lo[k], den[k]
			for j = 1, ny do
				local n0 = 2 + (j + 1) * SX + (k + 1) * SXY
				for i = 1, nx do
					local n = n0 + i
					local rhs = w[n] + tau * Rw[n] - a * (ps[n] - ps[n - sz])
					dp[n] = (rhs - (if k > 2 then lk * dp[n - sz] else 0)) / dk
				end
			end
		end
		for k = nz, 2, -1 do
			local ck = cpf[k]
			for j = 1, ny do
				local n0 = 2 + (j + 1) * SX + (k + 1) * SXY
				for i = 1, nx do
					local n = n0 + i
					w[n] = dp[n] - (if k < nz then ck * w[n + sz] else 0)
				end
			end
		end
		for k = 1, nz do
			local rb, rt, dzk = rhow[k], rhow[k + 1], dzc[k]
			for j = 1, ny do
				local n0 = 2 + (j + 1) * SX + (k + 1) * SXY
				for i = 1, nx do
					local n = n0 + i
					local wb = if k >= 2 then w[n] else 0
					local wt = if k < nz then w[n + sz] else 0
					local pn = ps[n] - b * (rt * wt - rb * wb) / dzk
					p[n] = pn
					pd[n] = pn + beta * (pn - pOld[n])
				end
			end
		end
		fillVertical(w, nz, SXY, true)
	end
end

local SCALARS = { "th", "qv", "qc", "qr", "qh", "qsn" }
local PROG = { "u", "v", "w", "p", "th", "qv", "qc", "qr", "qh", "qsn" }

-- One large step: RK3 (dt/3, dt/2, dt) with acoustic substeps, then microphysics.
function CloudModel.step(self: any)
	local dt, N = self.dt, self.N
	for _, f in PROG do
		copy(self[f .. "S"], self[f], N)
	end
	local nx, ny, nz, SX, SXY = self.nx, self.ny, self.nz, self.SX, self.SXY
	for _, frac in { 1 / 3, 1 / 2, 1 } do
		local dts = dt * frac
		self:slow()
		self:fast(dts)
		for _, f in SCALARS do
			local s, s0, R = self[f], self[f .. "S"], self["R" .. f]
			for k = 1, nz do
				for j = 1, ny do
					local n0 = 2 + (j + 1) * SX + (k + 1) * SXY
					for i = 1, nx do
						local n = n0 + i
						s[n] = s0[n] + dts * R[n]
					end
				end
			end
		end
		self:fill()
	end
	if self.env then
		self:relaxEnvironment(dt)
	end
	if self.cpRate and self.cpRate ~= 0 then
		self:applyColdPool(dt)
	end
	if self.drive then
		self.drive = self:applyDrive(self.drive, dt)
	end
	if self.drive2 then
		self.drive2 = self:applyDrive(self.drive2, dt)
	end
	self:micro(dt)
	self:fill()
	self.time += dt
	if self.follow then
		self:followStorm()
	end
end

-- Updraft nudging (Naylor & Gilmore 2012): inside an ellipsoid, w is pulled toward a target
-- (target x cos^2 of the scaled distance) wherever it is weaker - a storm started (and steered)
-- by lifting, the way the engine's own storms start on its convergence, not by a warm bubble that a
-- capped sounding smothers. self.drive = {
--   x, y      position, m from the box's south-west corner when the drive was set (it stays on
--             the ground as the grid shifts: the box's shifts ox, oy are taken off)
--   ox, oy    the grid's shifts when it was set
--   inBox     true: x, y stay in the box instead (the box follows the storm, so the lift stays
--             under it - the engine steering its storm through its life)
--   (x, y are in the outermost model's box; a nest takes its parents' drives and offsets them by
--   its own corner)
-- Returns the drive, or nil once it has ended. Two can run at once (self.drive, self.drive2).
--   r, z, rz  horizontal radius, centre height and vertical radius (m)
--   w         target updraft (m/s); tau nudging time (s)
--   t1, ramp  model time it ends (s) and the time it eases off over before that (s)
-- }
function CloudModel.applyDrive(self: any, d: any, dt: number): any
	if self.time >= d.t1 then
		return nil
	end
	-- (a nest: its corner in the outermost box, and the outermost box's shifts)
	local xo, yo, root = 0, 0, self
	while root.parent do
		xo += root.X0
		yo += root.Y0
		root = root.parent
	end
	local fade = if d.ramp > 0 then math.clamp((d.t1 - self.time) / d.ramp, 0, 1) else 1
	local a = fade * dt / d.tau
	local dx, SX, SXY, zf, w = self.dx, self.SX, self.SXY, self.zf, self.w
	local xc = (if d.inBox then d.x else d.x - (root.ox - (d.ox or 0)) * root.dx) - xo
	local yc = (if d.inBox then d.y else d.y - (root.oy - (d.oy or 0)) * root.dx) - yo
	local i0, i1 = math.max(1, math.floor((xc - d.r) / dx)), math.min(self.nx, math.ceil((xc + d.r) / dx) + 1)
	local j0, j1 = math.max(1, math.floor((yc - d.r) / dx)), math.min(self.ny, math.ceil((yc + d.r) / dx) + 1)
	for k = 2, self.nz do
		local sz = (zf[k] - d.z) / d.rz
		if sz * sz < 1 then
			for j = j0, j1 do
				local sy = ((j - 0.5) * dx - yc) / d.r
				for i = i0, i1 do
					local sx = ((i - 0.5) * dx - xc) / d.r
					local R = math.sqrt(sx * sx + sy * sy + sz * sz)
					if R < 1 then
						local target = d.w * math.cos(0.5 * math.pi * R) ^ 2
						local n = (i + 2) + (j + 1) * SX + (k + 1) * SXY
						if w[n] < target then
							w[n] += min(1, a) * (target - w[n])
						end
					end
				end
			end
		end
	end
	return d
end

-- Kessler warm rain (KW78 coefficients): autoconversion, accretion, rain evaporation, rain fall,
-- saturation adjustment. Plus hail/graupel (Lin et al. 1983 forms, hail parameters): below 0 C
-- cloud turns into graupel instead of rain, hail collects supercooled cloud and rain (riming,
-- freezing them: latent heat of fusion), rain freezes by itself (Bigg); above 0 C hail sheds the
-- cloud it collects as rain and melts (taking the heat back). Hail falls fast (mass-weighted
-- ~10-20 m/s) and evaporates little, so less of the storm's water cools the air under it - the
-- all-rain Kessler cold pool is known to be too cold. Latent heat goes into theta.
function CloudModel.micro(self: any, dt: number)
	local nx, ny, nz, SX, SXY = self.nx, self.ny, self.nz, self.SX, self.SXY
	local th, qv, qc, qr, qh, p = self.th, self.qv, self.qc, self.qr, self.qh, self.p
	local hail = self.hail
	local N0H = self.n0h
	local vh = table.create(nz + 1, 0)
	local vs = table.create(nz + 1, 0)
	local qsn = self.qsn
	local hailS = self.hailSfc
	local pi0, p0, rho0, dzc = self.pi0, self.p0, self.rho0, self.dzc
	local rhoS = rho0[1]
	local vt = table.create(nz + 1, 0)
	local rain = self.rainSfc
	local yf = self.yieldFn
	for j = 1, ny do
		if yf and j % 8 == 0 then
			yf()
		end
		for i = 1, nx do
			local col = 2 + (j + 1) * SX + i
			-- rain fall (upwind flux from above), subcycled for the thin levels
			local sub = 1
			for k = 1, nz do
				local n = col + (k + 1) * SXY
				local rq = max(0, qr[n])
				local v1 = if rq > 1e-9 then 36.34 * (rho0[k] * 1e-3 * rq) ^ 0.1364 * sqrt(rhoS / rho0[k]) else 0
				vt[k] = v1
				-- hail: mass-weighted Gamma(4.5)/6 sqrt(4 g rhoh / (3 Cd rho)) lambda^-1/2
				local hq = max(0, qh[n])
				local v2 = 0
				if hail and hq > 1e-9 then
					local lam = (pi * RHOH * N0H / (rho0[k] * hq)) ^ 0.25
					v2 = 1.938 * sqrt(4 * G * RHOH / (1.8 * rho0[k])) / sqrt(lam)
				end
				vh[k] = v2
				-- snow: mass-weighted SC Gamma(4 + d) / 6 lambda^-d, denser air slower (sqrt)
				local sq = max(0, qsn[n])
				local v3 = 0
				if hail and sq > 1e-9 then
					local lams = (pi * RHOS * N0S / (rho0[k] * sq)) ^ 0.25
					v3 = SC * G4SD / 6 * lams ^ -SD * sqrt(rhoS / rho0[k])
				end
				vs[k] = v3
				local cfl = max(v1, v2) * dt / dzc[k]
				if cfl > 0.8 then
					sub = max(sub, math.ceil(cfl / 0.8))
				end
			end
			local h = dt / sub
			for _ = 1, sub do
				local fluxAbove, fluxH, fluxS = 0, 0, 0
				for k = nz, 1, -1 do
					local n = col + (k + 1) * SXY
					local F = rho0[k] * vt[k] * max(0, qr[n])
					qr[n] += h * (fluxAbove - F) / (rho0[k] * dzc[k])
					fluxAbove = F
					if hail then
						local FH = rho0[k] * vh[k] * max(0, qh[n])
						qh[n] += h * (fluxH - FH) / (rho0[k] * dzc[k])
						fluxH = FH
						local FS = rho0[k] * vs[k] * max(0, qsn[n])
						qsn[n] += h * (fluxS - FS) / (rho0[k] * dzc[k])
						fluxS = FS
					end
				end
			end
			local cs = (j + 1) * SX + i + 2
			local hs = 3600 * rho0[1] * vh[1] * max(0, qh[col + 2 * SXY])
			hailS[cs] = hs
			rain[cs] = 3600 * rho0[1] * (vt[1] * max(0, qr[col + 2 * SXY]) + vs[1] * max(0, qsn[col + 2 * SXY])) + hs -- kg/m2/h = mm/h
			for k = 1, nz do
				local n = col + (k + 1) * SXY
				-- (the temperature from the full pressure, perturbation included: air in a vortex's
				-- low-pressure core expands and cools, which is what condenses a funnel cloud)
				local pk = p0[k] + p[n]
				local PI = (pk / P00) ^ KAPPA
				local T = th[n] * PI
				local qs = satMix(pk, T)
				local c, r, q, g = max(0, qc[n]), max(0, qr[n]), max(0, qv[n]), max(0, qh[n])
				local sn = max(0, qsn[n])
				local rho = rho0[k]
				local Tc = T - 273.15
				-- autoconversion (to graupel below 0 C) and accretion by rain
				local ar = max(0, 1e-3 * (c - 1e-3)) * dt
				local cr = 2.2 * c * r ^ 0.875 * dt
				local take = min(c, ar + cr)
				local toIce = if hail and Tc < 0 and self.autoToIce then min(ar, take) else 0
				c -= take
				r += take - toIce
				g += toIce
				local frozen = toIce
				if hail then
					-- snow (Lin et al. 1983 forms): cold cloud glaciating to it (faster the colder;
					-- all of it at HOMO_C), vapour depositing on it where the air is saturated
					-- over ice (or it sublimating where drier), cloud riming it, heavily rimed snow
					-- turning into graupel, and melting below the freezing level. Most of a
					-- storm's high cloud becomes slow snow carried out in the anvil, not hail.
					if Tc < 0 and c > 0 then
						local gl = if Tc <= HOMO_C then c else c * (1 - exp(-dt / GLAC_S * (Tc / HOMO_C) ^ 2))
						c -= gl
						sn += gl
						frozen += gl
					end
					if sn > 1e-9 or (Tc < 0 and c > 1e-6) then
						local lams = (pi * RHOS * N0S / (rho * max(sn, 1e-9))) ^ 0.25
						local csn = SC * sqrt(rhoS / rho) -- fall speed coefficient in this air
						local ventS = 0.78 * lams ^ -2 + 0.31 * 0.843 * G5SD2 * sqrt(csn / NU) * lams ^ -((5 + SD) / 2)
						if Tc < 0 then
							-- deposition / sublimation (over ice)
							local esi = 611.2 * exp(21.87 * Tc / (Tc + 265.5))
							local qsi = 0.622 * esi / (pk - esi)
							local Ap = LS * LS / (KA * RV * T * T)
							local Bp = 1 / (rho * qsi * DV)
							local dep = 2 * pi * (q / qsi - 1) * N0S / (rho * (Ap + Bp)) * ventS * dt
							if sn <= 1e-9 then
								dep = 0
							end
							if dep > 0 then
								dep = min(dep, max(0, q - qsi))
							else
								dep = max(dep, -sn)
							end
							q -= dep
							sn += dep
							th[n] += LS / (CP * PI) * dep
							T = th[n] * PI
							qs = satMix(pk, T)
							-- riming: snow collecting cloud water
							if sn > 1e-9 and c > 0 then
								local rim = min(c, 0.25 * pi * N0S * c * csn * G3SD * lams ^ -(3 + SD) * dt)
								c -= rim
								sn += rim
								frozen += rim
							end
							-- heavily rimed snow turning into graupel
							local gaut = max(0, 1e-3 * exp(0.09 * Tc) * (sn - 6e-4)) * dt
							gaut = min(gaut, sn)
							sn -= gaut
							g += gaut
						elseif sn > 1e-9 then
							-- melting
							local qs0 = satMix(pk, 273.15)
							local drive = KA * Tc - LV * DV * rho * (qs0 - q)
							if drive > 0 then
								local mlt = min(sn, 2 * pi * N0S / (rho * LF) * drive * ventS * dt)
								sn -= mlt
								r += mlt
								frozen -= mlt
							end
						end
					end
					if g > 1e-9 then
						local lam = (pi * RHOH * N0H / (rho * g)) ^ 0.25
						local A = sqrt(4 * G * RHOH / (1.8 * rho))
						-- collection of cloud (and rain, treated as still against the fast hail)
						local coll = min(1, 0.25 * pi * N0H * 3.323 * A * lam ^ -3.5 * dt)
						local gw = c * coll
						c -= gw
						if Tc < 0 then
							local gr = r * coll
							r -= gr
							g += gw + gr
							frozen += gw + gr
						else
							r += gw -- shed as rain
							-- melting: conduction from the warm air, less the cooling of
							-- evaporation into air drier than saturation at 0 C
							local qs0 = satMix(pk, 273.15)
							local drive = KA * Tc - LV * DV * rho * (qs0 - q)
							if drive > 0 then
								local vent = 0.78 * lam ^ -2 + 0.31 * 0.843 * 1.608 * sqrt(A / NU) * lam ^ -2.75
								local mlt = min(g, 2 * pi * N0H / (rho * LF) * drive * vent * dt)
								g -= mlt
								r += mlt
								frozen -= mlt
							end
						end
					end
					-- supercooled rain freezing by itself (Bigg)
					if Tc < 0 and r > 1e-9 then
						local lamr = (pi * 1000 * N0R / (rho * r)) ^ 0.25
						local fr = min(r, 20 * pi * pi * 100 * N0R * (1000 / rho) * (exp(0.66 * min(-Tc, 40)) - 1) * lamr ^ -7 * dt)
						r -= fr
						g += fr
						frozen += fr
					end
					if frozen ~= 0 then
						th[n] += LF / (CP * PI) * frozen
						T = th[n] * PI
						qs = satMix(pk, T)
					end
				end
				-- rain evaporation into subsaturated air (rho in g/cm3, p in mb)
				if r > 0 and q < qs then
					local rr = rho0[k] * 1e-3 * r
					local C = 1.6 + 124.9 * rr ^ 0.2046
					local er = dt * (1 - q / qs) * C * rr ^ 0.525 / (rho0[k] * 1e-3) / (5.4e5 + 2.55e6 / (pk / 100 * qs))
					er = min(er, r, max(0, qs - q))
					r -= er
					q += er
					th[n] -= LV / (CP * PI) * er
					T = th[n] * PI
					qs = satMix(pk, T)
				end
				-- saturation adjustment
				local d = (q - qs) / (1 + LV * LV * qs / (CP * RV * T * T))
				if d < 0 then
					d = max(d, -c)
				end
				q -= d
				c += d
				th[n] += LV / (CP * PI) * d
				qv[n], qc[n], qr[n], qh[n], qsn[n] = q, c, r, g, sn
			end
		end
	end
end

-- Move the grid one cell (di, dj = -1, 0, 1): the cell that was at (i + di, j + dj) is now (i, j);
-- the edge entering the box copies its neighbour (the open boundary's zero gradient).
function CloudModel.shift(self: any, di: number, dj: number)
	local nx, ny, nz = self.nx, self.ny, self.nz
	for _, name in PROG do
		local f = self[name]
		local i0, i1, ist = 1, nx + 1, 1
		if di < 0 then
			i0, i1, ist = nx + 1, 1, -1
		end
		local j0, j1, jst = 1, ny + 1, 1
		if dj < 0 then
			j0, j1, jst = ny + 1, 1, -1
		end
		for k = -1, nz + 3 do
			for j = j0, j1, jst do
				local jj = math.clamp(j + dj, 1, ny + 1)
				for i = i0, i1, ist do
					local ii = math.clamp(i + di, 1, nx + 1)
					f[self:idx(i, j, k)] = f[self:idx(ii, jj, k)]
				end
			end
		end
	end
	self.ox += di
	self.oy += dj
	self:fill()
end

-- 2-5 km updraft helicity (m2/s2) of column (i, j): the sum of w * zeta * dz where the air rises
-- (cyclonic rotating updrafts score high; the standard mesocyclone measure, Kain et al. 2008)
function CloudModel.uh(self: any, i: number, j: number): number
	local s = 0
	local zc, dzc = self.zc, self.dzc
	for k = 1, self.nz do
		local z = zc[k]
		if z >= 2000 and z <= 5000 then
			local n = self:idx(i, j, k)
			local w = 0.5 * (self.w[n] + self.w[n + self.SXY])
			if w > 0 then
				local zt = 0.25 * (self:zeta(i, j, k) + self:zeta(i + 1, j, k) + self:zeta(i, j + 1, k) + self:zeta(i + 1, j + 1, k))
				s += w * zt * dzc[k]
			end
		end
	end
	return s
end

-- The main storm: the highest 3x3-smoothed updraft helicity within 12 cells of the box's target
-- point (0.5, 0.45) - the storm being followed, not whichever cell spikes. One cell per step at most.
CloudModel.FOLLOW_Z, CloudModel.FOLLOW_W = 4000, 5 -- updraft following: height (m), least 3x3 mean w (m/s)
function CloudModel.followStorm(self: any)
	local nx, ny = self.nx, self.ny
	local ti, tj = math.floor(0.5 * nx), math.floor(0.45 * ny)
	local R = 12
	local raw = {}
	for j = math.max(2, tj - R - 1), math.min(ny - 1, tj + R + 1) do
		for i = math.max(2, ti - R - 1), math.min(nx - 1, ti + R + 1) do
			raw[i + j * 4096] = self:uh(i, j)
		end
	end
	local best, bi, bj = 50, 0, 0
	for j = math.max(3, tj - R), math.min(ny - 2, tj + R) do
		for i = math.max(3, ti - R), math.min(nx - 2, ti + R) do
			local s = 0
			for dj = -1, 1 do
				for d = -1, 1 do
					s += raw[(i + d) + (j + dj) * 4096] or 0
				end
			end
			s /= 9
			if s > best then
				best, bi, bj = s, i, j
			end
		end
	end
	self.uhMax = best
	if bi == 0 then
		-- no rotating updraft yet (a young or pulsing storm): follow the strongest updraft at
		-- FOLLOW_Z instead, so the box (and a lift kept at its follow target) stays with the storm
		local k = self:levelAt(CloudModel.FOLLOW_Z)
		local SX, SXY, w = self.SX, self.SXY, self.w
		local bestW = CloudModel.FOLLOW_W
		for j = math.max(3, tj - R), math.min(ny - 2, tj + R) do
			for i = math.max(3, ti - R), math.min(nx - 2, ti + R) do
				local s = 0
				for dj = -1, 1 do
					for d = -1, 1 do
						s += w[(i + d + 2) + (j + dj + 1) * SX + (k + 1) * SXY]
					end
				end
				s /= 9
				if s > bestW then
					bestW, bi, bj = s, i, j
				end
			end
		end
		if bi == 0 then
			return
		end
	end
	self.stormI, self.stormJ = bi, bj
	local di = if bi > ti + 1 then 1 elseif bi < ti - 1 then -1 else 0
	local dj = if bj > tj + 1 then 1 elseif bj < tj - 1 then -1 else 0
	if di ~= 0 or dj ~= 0 then
		self:shift(di, dj)
	end
end

-- Diagnostics -------------------------------------------------------------------------------

-- vertical vorticity (1/s) at the cell corner south-west of cell (i, j), level k
function CloudModel.zeta(self: any, i: number, j: number, k: number): number
	local n = self:idx(i, j, k)
	local u, v = self.u, self.v
	return (v[n] - v[n - 1]) / self.dx - (u[n] - u[n - self.SX]) / self.dx
end

return CloudModel
