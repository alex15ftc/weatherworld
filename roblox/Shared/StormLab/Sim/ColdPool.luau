--!nonstrict
--!native
-- The surface cold pool (guide section 12B): a field of temperature deficit D (K) on a 2 km grid.
--   * grows where falling rain and hail evaporate and melt (Precip reports the water mass:
--     dD = L m / (cp rho A h));
--   * spreads as a density current: its edge advances at c = Fr sqrt(g' h), g' = g D / theta,
--     h the pool depth (grows with D), Fr ~ 0.75; it is also carried by the environment's
--     low-level wind and pushed by momentum surges (rear-inflow jets, downbursts);
--   * thins as it spreads (dilution by the spreading velocity's divergence), and recovers by
--     surface heating and mixing (faster in the day);
--   * its edge contours are the gust fronts (ColdPool.contours).
-- M (0..1) is how moist the cold air is (evaporatively cooled air nearly saturated): it lowers
-- the LCL of air the storms take in from it (wall clouds, shelf clouds, scud).
-- R (0..1) is how much of the cold air came down in the rear-flank downdraft (cooled by the
-- rear-flank precipitation, Precip origin 1) rather than the forward flank's: it tells the two
-- outflows' gust fronts apart - the occlusion, the triple point (2026-10-30).
local function dep(name: string): any
	if script then
		return require((script :: any).Parent:FindFirstChild(name))
	end
	return (require :: any)("./" .. name)
end
local Grid = dep("Grid")
local Thermo = dep("Thermo")

local ColdPool = {}
ColdPool.__index = ColdPool

local G, THETA, CP, RHO = 9.81, 300, 1005, 1.1
local LV, LF = 2.5e6, 3.34e5
local FR = 0.75

-- depth of the cold pool (m) from its deficit: ~0.5 km at 1 K, ~2 km at 9 K
local function depthOf(d: number): number
	return math.clamp(350 + 190 * d, 0, 3000)
end
ColdPool.depthOf = depthOf

-- The depth the pool's wind profile spans (m) for a deficit d, and its slope dh/dd: depthOf with a
-- floor at 1 K, the floor rounded off (softplus over ~0.25 K). With a sharp max(d, 1) the depth's
-- slope jumped from 0 to 190 m/K on the 1 K line, and the vertical wind with it - a sheet of
-- sudden ascent, 0.001 -> 0.32 m/s in 2 m (test_wind_physics' 0.54 W/Ru divergence, 2026-11-04)
local SOFT = 4
function ColdPool.windDepth(d: number): (number, number)
	local a = SOFT * (d - 1)
	local de, sig
	if a > 30 then
		de, sig = d, 1
	else
		local e = math.exp(a)
		de, sig = 1 + math.log(1 + e) / SOFT, e / (1 + e)
	end
	local h = 350 + 190 * de
	if h >= 3000 then
		return 3000, 0
	end
	return h, 190 * sig
end

function ColdPool.speedOf(d: number): number
	if d <= 0 then
		return 0
	end
	return FR * math.sqrt(G * d / THETA * depthOf(d))
end

export type ColdPool = typeof(setmetatable({} :: {
	D: any, M: any, R: any, SU: any, SV: any, VU: any, VV: any, EDGE: any,
	dx: number,
	env: any,
}, ColdPool))

function ColdPool.new(env: any, dx: number?): ColdPool
	local d = dx or ColdPool.DX or 2000
	local n = math.ceil(2 * env.extent / d)
	local x0 = -n * d / 2
	local function g(v: number?)
		return Grid.new(n, n, d, x0, x0, v or 0)
	end
	local self = setmetatable({ D = g(), M = g(0.7), R = g(), SU = g(), SV = g(), VU = g(), VV = g(), WU = g(), WV = g(), EDGE = g(), dx = d, env = env }, ColdPool)
	return self :: ColdPool
end

-- Seed the pool from the engine's own cold-pool field (K) at the start.
function ColdPool.seedFromEngine(self: ColdPool, cells: { any }, cellM: number)
	for j = 1, self.D.ny do
		for i = 1, self.D.nx do
			local x, y = self.D:centre(i, j)
			-- nearest engine cell (its cold pool is a 16 km average: keep it smooth)
			local best, bd = 0, math.huge
			for _, c in cells do
				local dd = (c.pos[1] - x) ^ 2 + (c.pos[2] - y) ^ 2
				if dd < bd then
					bd, best = dd, c.coldPoolK
				end
			end
			self.D:set(i, j, best)
		end
	end
end

-- Water mass (kg) evaporated (or hail melted) into the column at (x, y). rh: the relative
-- humidity of the air it evaporated into (moistness of the cooled air).
function ColdPool.addCooling(self: ColdPool, x: number, y: number, evapKg: number, meltKg: number, rh: number, rear: number?)
	local i, j = self.D:cellOf(x, y)
	if i < 1 or j < 1 or i > self.D.nx or j > self.D.ny then
		return
	end
	local k = self.D:index(i, j)
	local d = self.D.v[k]
	local h = math.max(600, depthOf(d))
	local energy = LV * evapKg + LF * meltKg
	local dD = energy / (CP * RHO * self.dx * self.dx * h)
	self.D.v[k] = d + dD
	-- the cooled air ends near saturation; mix its moistness in by the share of new cooling
	local share = dD / math.max(0.1, d + dD)
	self.M.v[k] += (math.clamp(0.55 + 0.45 * rh, 0, 1) - self.M.v[k]) * share
	-- (and where the new cold air came down)
	self.R.v[k] += (math.clamp(rear or 0, 0, 1) - self.R.v[k]) * share
end

-- Rain-driven downdrafts: where rain reaches the ground, saturated downdraft air arrives with the
-- environment's downdraft deficit (Thermo ddDeficit: the wet-bulb parcel from the lowest theta-e
-- level). The pool there is replaced by that air at the downdraft's mass flux: w_dd ~ 1.2 m/s
-- (from 5 mm/h) + 0.12 m/s per mm/h (cap 10 m/s); light rain can't keep a downdraft saturated, so
-- it arrives warmer.
function ColdPool.downdrafts(self: ColdPool, rainRate: any, ddField: any, dt: number, yieldFn: (() -> ())?, rainRateR: any?, ddArrival: any?)
	local D, M, R = self.D, self.M, self.R
	for j = 1, D.ny do
		if yieldFn and j % 5 == 0 then
			yieldFn()
		end
		for i = 1, D.nx do
			local x, y = D:centre(i, j)
			local r = rainRate:sample(x, y)
			if r > 0.5 then
				local k = D:index(i, j)
				-- (a precipitation-driven downdraft is ~1-3 m/s from evaporation and melting through
				-- the whole column above, not only in proportion to the rain reaching the ground:
				-- tied to surface rain alone, the forward flank's pool took ~20 min to form while
				-- the storm moved on ~20 km, and there was no forward-flank gust front)
				local wdd = Thermo.rainDowndraftSpeed(r)
				local target
				if ddArrival then
					-- (the real downdraft's arrival deficit at this rain rate, Thermo.downdraftArrival:
					-- interpolated in log rain rate between 5, 20 and 60 mm/h)
					local a5, a20, a60 = ddArrival.dd5:sample(x, y), ddArrival.dd20:sample(x, y), ddArrival.dd60:sample(x, y)
					local lr = math.log(math.clamp(r, 0.5, 120))
					if lr < math.log(5) then
						target = a5 * math.clamp(r / 5, 0, 1)
					elseif lr < math.log(20) then
						target = a5 + (a20 - a5) * (lr - math.log(5)) / math.log(4)
					else
						target = a20 + (a60 - a20) * math.clamp((lr - math.log(20)) / math.log(3), 0, 1.3)
					end
				else
					target = ddField:sample(x, y) * math.clamp(r / 30, 0.25, 1)
				end
				local d = D.v[k]
				if target > d then
					local h = math.max(500, depthOf(d))
					local f = 1 - math.exp(-wdd / h * dt)
					D.v[k] = d + (target - d) * f
					M.v[k] += (0.9 - M.v[k]) * f
					if rainRateR then
						-- (the downdraft air takes the origin of the rain driving it)
						local rear = math.clamp(rainRateR:sample(x, y) / r, 0, 1)
						R.v[k] += (rear - R.v[k]) * f * math.clamp((target - d) / math.max(0.3, target), 0, 1)
					end
				end
			end
		end
	end
end

-- A downdraft reaching the ground at (x, y) over radius r (Gaussian): its air replaces the pool's
-- at the downdraft's mass flux w (m/s), warmer or colder - a dynamically forced rear-flank
-- downdraft is often warmer than the rain-cooled forward-flank air it pushes aside. target: its
-- arrival deficit (K); rear: its origin (1 rear flank); moist: its moistness (2026-10-30)
function ColdPool.addDowndraft(self: ColdPool, x: number, y: number, r: number, target: number, w: number, dt: number, rear: number, moist: number)
	local D, M, R = self.D, self.M, self.R
	local i0, j0 = D:cellOf(x - 2 * r, y - 2 * r)
	local i1, j1 = D:cellOf(x + 2 * r, y + 2 * r)
	for j = math.max(1, j0), math.min(D.ny, j1) do
		for i = math.max(1, i0), math.min(D.nx, i1) do
			local cx, cy = D:centre(i, j)
			local gs = math.exp(-((cx - x) ^ 2 + (cy - y) ^ 2) / (r * r))
			if gs > 0.02 then
				local k = D:index(i, j)
				local h = math.max(500, depthOf(math.max(D.v[k], target)))
				local f = (1 - math.exp(-w / h * dt)) * gs
				D.v[k] += (target - D.v[k]) * f
				R.v[k] += (rear - R.v[k]) * f
				M.v[k] += (moist - M.v[k]) * f
			end
		end
	end
end

-- A momentum surge (m/s) at (x, y) over radius r: rear-inflow jets reaching the ground,
-- downburst outflows. Adds toward (u, v), never beyond it.
function ColdPool.addSurge(self: ColdPool, x: number, y: number, r: number, u: number, v: number, rate: number)
	local i0, j0 = self.D:cellOf(x - r, y - r)
	local i1, j1 = self.D:cellOf(x + r, y + r)
	for j = math.max(1, j0), math.min(self.D.ny, j1) do
		for i = math.max(1, i0), math.min(self.D.nx, i1) do
			local cx, cy = self.D:centre(i, j)
			local f = math.exp(-((cx - x) ^ 2 + (cy - y) ^ 2) / (r * r)) * rate
			if f > 0.001 then
				local k = self.D:index(i, j)
				self.SU.v[k] += (u - self.SU.v[k]) * math.min(1, f)
				self.SV.v[k] += (v - self.SV.v[k]) * math.min(1, f)
			end
		end
	end
end

-- deficit (K), moistness (0..1) and depth (m) at (x, y)
function ColdPool.deficitAt(self: ColdPool, x: number, y: number): (number, number, number)
	local d = self.D:sample(x, y)
	if d <= 0.05 then
		return 0, 0, 0
	end
	return d, self.M:sample(x, y), depthOf(d)
end

-- The cold pool's wind profile (Pof: the share of the spreading speed at height z; Qof: its
-- integral from the ground) for a pool h deep: outflow in the pool, (1 - s^2)(1 - e^(-z/25 m)) -
-- strongest a little above the ground, gone at its top - and above it, over h..3h, the ambient air
-- flowing back over it, -k (s - 1)(3 - s) with k set so the two carry the same air: the column's
-- net sideways flux is zero, so the air the outflow spreads is replaced from above, not from nowhere.
local ZA = 25
local function qLow(z: number, h: number): number
	local e = math.exp(-z / ZA)
	local h2 = h * h
	return z - z * z * z / (3 * h2) - (ZA * (1 - e) - ZA * ZA * ZA / h2 * (2 - e * (z * z / (ZA * ZA) + 2 * z / ZA + 2)))
end
local function Pof(z: number, h: number): number
	local s = z / h
	if s <= 1 then
		return (1 - s * s) * (1 - math.exp(-z / ZA))
	elseif s < 3 then
		local k = 3 * qLow(h, h) / (4 * h)
		return -k * (s - 1) * (3 - s)
	end
	return 0
end
local function Qof(z: number, h: number): number
	local s = z / h
	if s <= 1 then
		return qLow(z, h)
	elseif s < 3 then
		local qh = qLow(h, h)
		local k = 3 * qh / (4 * h)
		return qh - k * h * (-s * s * s / 3 + 2 * s * s - 3 * s + 4 / 3)
	end
	return 0
end
-- (both scaled so the outflow averages 1 over the pool's depth: the pool's air as a whole moves
-- with the pool, its lowest few hundred metres ~1.5 times as fast - the current's air behind the
-- head outruns the front, Simpson & Britter 1979 - and its top slower)
local function meanOf(h: number): number
	return qLow(h, h) / h
end
local function PofN(z: number, h: number): number
	return Pof(z, h) / meanOf(h)
end
local function QofN(z: number, h: number): number
	return Qof(z, h) / meanOf(h)
end
-- d(QofN)/dh at fixed z, exactly (windAt: the vertical motion where the pool's depth changes. A
-- numeric difference straddled the return flow's top and broke continuity there, 2026-11-03)
local function dqLowDh(z: number, h: number): number
	local e = math.exp(-z / ZA)
	local h3 = h * h * h
	return 2 * z * z * z / (3 * h3) - 2 * ZA * ZA * ZA / h3 * (2 - e * (z * z / (ZA * ZA) + 2 * z / ZA + 2))
end
local function dQofNdh(z: number, h: number): number
	local s = z / h
	if s >= 3 then
		return 0
	end
	local qh = qLow(h, h)
	local dqh = dqLowDh(h, h) -- (the z-slope of qLow is 0 at z = h)
	local Q, dQ
	if s <= 1 then
		Q, dQ = qLow(z, h), dqLowDh(z, h)
	else
		local G = -s * s * s / 3 + 2 * s * s - 3 * s + 4 / 3
		local dG = -(s - 1) * (s - 3)
		Q = qh * (1 - 0.75 * G)
		dQ = dqh * (1 - 0.75 * G) + qh * 0.75 * dG * s / h
	end
	local m = qh / h
	local dm = (dqh * h - qh) / (h * h)
	return dQ / m - Q * dm / (m * m)
end
ColdPool.depthMeanHeights = { 0.1, 0.3, 0.5, 0.7, 0.9 }

-- The cold pool's own wind perturbation (relative to the environment) at (x, y, z): the spreading
-- outflow inside the pool (the grid's WU, WV: the pool's own motion) with its return flow above,
-- and the vertical motion continuity makes of them, w = -div(V Q(z; h)) - rising where the
-- outflow piles up behind the gust front's head, sinking where it spreads apart. (2026-11-03: it
-- was the outflow alone plus a lift drawn at the head, so air spread out of nowhere and rose
-- from nowhere: docs/stormlab/PHYSICS-AUDIT-2026-11-03.md.)
function ColdPool.windAt(self: ColdPool, x: number, y: number, z: number): (number, number, number)
	local vu, vux, vuy = self.WU:sampleGrad(x, y)
	local vv, vvx, vvy = self.WV:sampleGrad(x, y)
	if math.abs(vu) + math.abs(vv) + 2000 * (math.abs(vux) + math.abs(vuy) + math.abs(vvx) + math.abs(vvy)) < 1e-3 then
		return 0, 0, 0
	end
	local d, ddx, ddy = self.D:sampleGrad(x, y)
	local h, dh = ColdPool.windDepth(d)
	if z >= 3 * h or z < 0 then
		return 0, 0, 0
	end
	local P = PofN(z, h)
	local Q = QofN(z, h)
	local w = -(vux + vvy) * Q
	if dh ~= 0 then
		local dQ = dQofNdh(z, h) * dh -- (dQ/dd)
		w -= (vu * ddx + vv * ddy) * dQ
	end
	return vu * P, vv * P, w
end

-- Advance dt seconds. lowWind(x, y) -> u, v: the environment's mean 0-1 km wind, and (optionally)
-- the storms' own there (their inflow and spin: the pool spreads in that air too). depthWind(x, y, h)
-- -> u, v: the environment's and storms' wind averaged over 0..h (the pool's wind is set against it).
function ColdPool.step(self: ColdPool, dt: number, lowWind: (number, number) -> (number, number, number?, number?), recovery: number, yieldFn: (() -> ())?, depthWind: ((number, number, number) -> (number, number))?)
	local D, VU, VV, EDGE = self.D, self.VU, self.VV, self.EDGE
	local nx, ny = D.nx, D.ny
	local dx = self.dx
	local env = self.env
	-- spreading velocity (AU, AV: ground-relative, for moving the pool)
	local AU = Grid.new(nx, ny, dx, D.x0, D.y0)
	local AV = Grid.new(nx, ny, dx, D.x0, D.y0)
	for j = 1, ny do
		if yieldFn and j % 12 == 0 then
			yieldFn()
		end
		for i = 1, nx do
			local k = i + (j - 1) * nx
			local x, y = D:centre(i, j)
			local gx = (D:get(i + 1, j) - D:get(i - 1, j)) / (2 * dx)
			local gy = (D:get(i, j + 1) - D:get(i, j - 1)) / (2 * dx)
			local gm = math.sqrt(gx * gx + gy * gy)
			local eu, ev, stu, stv = lowWind(x, y)
			stu, stv = stu or 0, stv or 0
			local su, sv = self.SU.v[k], self.SV.v[k]
			local ek = ColdPool.ENV_K or 0.5
			local u, v, e = ek * (eu + stu), ek * (ev + stv), 0
			if gm > 1e-7 then
				local nxv, nyv = -gx / gm, -gy / gm -- outward
				-- the deficit of the pool behind this point drives the front
				local dIn = D:sample(x - nxv * 4000, y - nyv * 4000)
				local dHere = D.v[k]
				local c = ColdPool.speedOf(math.max(dIn, dHere))
				e = math.clamp(gm * 4000 / math.max(0.5, dIn), 0, 1)
				-- the head runs at c; inside, the pool slumps only slowly
				local spread = c * (0.08 + 0.92 * e)
				if dIn < 0.3 and dHere < 0.3 then
					spread = 0
					e = 0
				end
				u += spread * nxv
				v += spread * nyv
			end
			u += su
			v += sv
			-- what the cold pool does to the surface wind (relative to the environment)
			VU.v[k], VV.v[k] = u - (eu + stu) * (if D.v[k] > 0.3 then ek else 0), v - (ev + stv) * (if D.v[k] > 0.3 then ek else 0)
			EDGE.v[k] = e
			-- (advection uses the full ground-relative spreading velocity)
			self.SU.v[k] = su * math.exp(-dt / 900)
			self.SV.v[k] = sv * math.exp(-dt / 900)
			AU.v[k], AV.v[k] = u, v
			-- the pool's wind (windAt): its cold air moves with the pool, so on top of the
			-- environment's and the storms' low-level wind (World.windAt adds both) it is the pool's
			-- own motion less those - in the cold air only (faded in over 0.1-0.5 K, and at its head,
			-- where the cold air is still thin on the grid but already running at the front's speed),
			-- none outside
			local ph = math.clamp((D.v[k] - 0.1) / 0.4, 0, 1)
			ph = math.max(ph * ph * (3 - 2 * ph), e)
			if ph > 0 then
				-- (against the air World.windAt adds: by default the 0-1 km wind the pool moves in,
				-- so its air moves with the pool on that wind's terms. ColdPool.DEPTH_MEAN: against
				-- that air averaged over the pool's own depth instead - the pool's air then matches
				-- its motion at every depth (test_wind_physics' head check: 0.98-1.01 against
				-- 0.62-1.23), but the rain's last kilometre drifts differently and the squall line's
				-- tornadoes doubled (37 -> 80 in 2 h, cells and line vortices both), 2026-11-03)
				local bu, bv = eu + stu, ev + stv
				if depthWind and ColdPool.DEPTH_MEAN then
					bu, bv = depthWind(x, y, (ColdPool.windDepth(D.v[k])))
				end
				self.WU.v[k], self.WV.v[k] = ph * (u - bu), ph * (v - bv)
			else
				self.WU.v[k], self.WV.v[k] = 0, 0
			end
		end
	end
	self.AU, self.AV = AU, AV -- (test_wind_physics: the pool's motion against its wind)
	-- move the pool (and its moistness) with the spreading velocity
	if yieldFn then
		yieldFn()
	end
	-- (ColdPool.CUBIC: sharper bounded-cubic resampling. Tried 2026-10-30 for a sharper gust
	-- front: little change, so off - the pool's breadth is where the rain lays the cooling down)
	local cubic = ColdPool.CUBIC == true
	Grid.advect(D, AU, AV, dt, nil, cubic)
	Grid.advect(self.M, AU, AV, dt, nil, cubic)
	Grid.advect(self.R, AU, AV, dt, nil, cubic)
	if yieldFn then
		yieldFn()
	end
	-- dilution by spreading, recovery, a touch of smoothing
	local mixK = math.min(0.2, (ColdPool.MIX_K or 8000) * dt / (dx * dx))
	local out = table.create(nx * ny, 0)
	for j = 1, ny do
		for i = 1, nx do
			local k = i + (j - 1) * nx
			local div = (AU:get(i + 1, j) - AU:get(i - 1, j) + AV:get(i, j + 1) - AV:get(i, j - 1)) / (2 * dx)
			local d = D.v[k]
			local lap = D:get(i + 1, j) + D:get(i - 1, j) + D:get(i, j + 1) + D:get(i, j - 1) - 4 * d
			d += mixK * lap
			-- spreading thins the pool (its depth, and with it the deficit we carry)
			d *= math.exp(-0.25 * math.max(0, div) * dt)
			d -= d * dt / recovery
			out[k] = math.max(0, d)
		end
	end
	D.v = out
	local _ = env
end

-- Marching squares: polylines (lists of {x, y}) where D crosses `level`, each oriented so the cold
-- side is on the left (walking along it).
function ColdPool.contours(self: ColdPool, level: number): { { { number } } }
	-- contour a smoothed copy (two 3x3 box passes, ~4 km): the gust front, not every lump of
	-- the downdraft-fed pool
	local D = self.D:copy()
	local nx, ny = D.nx, D.ny
	-- separable 3-point box passes, direct indexing (clamped at the edges)
	for _ = 1, 2 do
		local v = D.v
		local tmp = table.create(nx * ny, 0)
		for j = 0, ny - 1 do
			local o = j * nx
			for i = 1, nx do
				local a = v[o + math.max(1, i - 1)]
				local b = v[o + i]
				local c = v[o + math.min(nx, i + 1)]
				tmp[o + i] = (a + b + c) / 3
			end
		end
		local out = table.create(nx * ny, 0)
		for j = 1, ny do
			local jm, jp = math.max(1, j - 1), math.min(ny, j + 1)
			for i = 1, nx do
				out[i + (j - 1) * nx] = (tmp[i + (jm - 1) * nx] + tmp[i + (j - 1) * nx] + tmp[i + (jp - 1) * nx]) / 3
			end
		end
		D.v = out
	end
	local segs: { { number } } = {}
	local function lerp(xa: number, ya: number, va: number, xb: number, yb: number, vb: number): (number, number)
		local f = (level - va) / (vb - va)
		return xa + (xb - xa) * f, ya + (yb - ya) * f
	end
	for j = 1, ny - 1 do
		for i = 1, nx - 1 do
			local x0, y0 = D:centre(i, j)
			local x1, y1 = x0 + D.dx, y0 + D.dx
			local a, b, c, d = D:get(i, j), D:get(i + 1, j), D:get(i + 1, j + 1), D:get(i, j + 1)
			local idx = (if a > level then 1 else 0) + (if b > level then 2 else 0) + (if c > level then 4 else 0) + (if d > level then 8 else 0)
			if idx ~= 0 and idx ~= 15 then
				-- edge points: bottom (a-b), right (b-c), top (d-c), left (a-d)
				local pts = {}
				if (a > level) ~= (b > level) then
					local px, py = lerp(x0, y0, a, x1, y0, b)
					pts.B = { px, py }
				end
				if (b > level) ~= (c > level) then
					local px, py = lerp(x1, y0, b, x1, y1, c)
					pts.R = { px, py }
				end
				if (d > level) ~= (c > level) then
					local px, py = lerp(x0, y1, d, x1, y1, c)
					pts.T = { px, py }
				end
				if (a > level) ~= (d > level) then
					local px, py = lerp(x0, y0, a, x0, y1, d)
					pts.L = { px, py }
				end
				local list = {}
				for _, key in { "B", "R", "T", "L" } do
					if pts[key] then
						table.insert(list, pts[key])
					end
				end
				for s = 1, #list - 1, 2 do
					local p, q = list[s], list[s + 1]
					-- orient: cold (above level) on the left of p -> q
					local mx, my = (p[1] + q[1]) / 2, (p[2] + q[2]) / 2
					local tx, ty = q[1] - p[1], q[2] - p[2]
					local lx, ly = mx - ty * 0.25, my + tx * 0.25
					if D:sample(lx, ly) < level then
						p, q = q, p
					end
					table.insert(segs, { p[1], p[2], q[1], q[2] })
				end
			end
		end
	end
	-- join segments end to start
	local function key(x: number, y: number): string
		return string.format("%d,%d", math.floor(x / 10 + 0.5), math.floor(y / 10 + 0.5))
	end
	local starts: { [string]: { number } } = {}
	for idx, s in segs do
		starts[key(s[1], s[2])] = (starts[key(s[1], s[2])] or {}) :: any
		table.insert(starts[key(s[1], s[2])], idx)
	end
	local used = {}
	local lines = {}
	for idx, s in segs do
		if not used[idx] then
			used[idx] = true
			local line = { { s[1], s[2] }, { s[3], s[4] } }
			local cur = s
			while true do
				local nextList = starts[key(cur[3], cur[4])]
				local found = nil
				if nextList then
					for _, n in nextList do
						if not used[n] then
							found = n
							break
						end
					end
				end
				if not found then
					break
				end
				used[found] = true
				cur = segs[found]
				table.insert(line, { cur[3], cur[4] })
			end
			table.insert(lines, line)
		end
	end
	-- join pieces whose start meets another's end (marching order splits lines)
	local merged = true
	while merged do
		merged = false
		for a = 1, #lines do
			local la = lines[a]
			if la then
				local ea = la[#la]
				for b = 1, #lines do
					local lb = lines[b]
					if b ~= a and lb then
						local sb = lb[1]
						if (ea[1] - sb[1]) ^ 2 + (ea[2] - sb[2]) ^ 2 < 1 then
							for q = 2, #lb do
								table.insert(la, lb[q])
							end
							lines[b] = nil :: any
							merged = true
						end
					end
				end
			end
		end
		local compact = {}
		for _, l in lines do
			if l then
				table.insert(compact, l)
			end
		end
		lines = compact
	end
	return lines
end

return ColdPool
