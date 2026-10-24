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
local function dep(name: string): any
	if script then
		return require((script :: any).Parent:FindFirstChild(name))
	end
	return (require :: any)("./" .. name)
end
local Grid = dep("Grid")

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

function ColdPool.speedOf(d: number): number
	if d <= 0 then
		return 0
	end
	return FR * math.sqrt(G * d / THETA * depthOf(d))
end

export type ColdPool = typeof(setmetatable({} :: {
	D: any, M: any, SU: any, SV: any, VU: any, VV: any, EDGE: any,
	dx: number,
	env: any,
}, ColdPool))

function ColdPool.new(env: any, dx: number?): ColdPool
	local d = dx or 2000
	local n = math.ceil(2 * env.extent / d)
	local x0 = -n * d / 2
	local function g(v: number?)
		return Grid.new(n, n, d, x0, x0, v or 0)
	end
	local self = setmetatable({ D = g(), M = g(0.7), SU = g(), SV = g(), VU = g(), VV = g(), EDGE = g(), dx = d, env = env }, ColdPool)
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
function ColdPool.addCooling(self: ColdPool, x: number, y: number, evapKg: number, meltKg: number, rh: number)
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
end

-- Rain-driven downdrafts: where rain reaches the ground, saturated downdraft air arrives with the
-- environment's downdraft deficit (Thermo ddDeficit: the wet-bulb parcel from the lowest theta-e
-- level). The pool there is replaced by that air at the downdraft's mass flux: w_dd ~ 0.12 m/s
-- per mm/h (cap 10 m/s); light rain can't keep a downdraft saturated, so it arrives warmer.
function ColdPool.downdrafts(self: ColdPool, rainRate: any, ddField: any, dt: number, yieldFn: (() -> ())?)
	local D, M = self.D, self.M
	for j = 1, D.ny do
		if yieldFn and j % 5 == 0 then
			yieldFn()
		end
		for i = 1, D.nx do
			local x, y = D:centre(i, j)
			local r = rainRate:sample(x, y)
			if r > 0.5 then
				local k = D:index(i, j)
				local wdd = math.min(10, 0.12 * r)
				local target = ddField:sample(x, y) * math.clamp(r / 30, 0.25, 1)
				local d = D.v[k]
				if target > d then
					local h = math.max(500, depthOf(d))
					local f = 1 - math.exp(-wdd / h * dt)
					D.v[k] = d + (target - d) * f
					M.v[k] += (0.9 - M.v[k]) * f
				end
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

-- The cold pool's own wind perturbation (relative to the environment) at (x, y, z):
-- the spreading outflow inside the pool, rising air over its head.
function ColdPool.windAt(self: ColdPool, x: number, y: number, z: number): (number, number, number)
	local d = self.D:sample(x, y)
	local edge = self.EDGE:sample(x, y)
	if d < 0.1 and edge < 0.02 then
		return 0, 0, 0
	end
	local h = depthOf(math.max(d, 1))
	local vu, vv = self.VU:sample(x, y), self.VV:sample(x, y)
	local u, v, w = 0, 0, 0
	if z < h then
		-- outflow strongest a little above the ground, gone at the top of the pool
		local s = z / h
		local prof = math.min(1, (z + 5) / 60) * (1 - s * s)
		u, v = vu * prof, vv * prof
	end
	-- lifting over the head of the gust front: strongest around the pool depth
	if edge > 0.02 then
		local c = math.sqrt(vu * vu + vv * vv)
		local zz = z / math.max(200, h)
		w = 0.8 * c * edge * zz * math.exp(1 - zz)
	end
	return u, v, w
end

-- Advance dt seconds. lowWind(x, y) -> u, v: the environment's mean 0-1 km wind.
function ColdPool.step(self: ColdPool, dt: number, lowWind: (number, number) -> (number, number), recovery: number, yieldFn: (() -> ())?)
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
			local eu, ev = lowWind(x, y)
			local su, sv = self.SU.v[k], self.SV.v[k]
			local u, v, e = 0.5 * eu, 0.5 * ev, 0
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
			VU.v[k], VV.v[k] = u - eu * (if D.v[k] > 0.3 then 0.5 else 0), v - ev * (if D.v[k] > 0.3 then 0.5 else 0)
			EDGE.v[k] = e
			-- (advection uses the full ground-relative spreading velocity)
			self.SU.v[k] = su * math.exp(-dt / 900)
			self.SV.v[k] = sv * math.exp(-dt / 900)
			AU.v[k], AV.v[k] = u, v
		end
	end
	-- move the pool (and its moistness) with the spreading velocity
	if yieldFn then
		yieldFn()
	end
	Grid.advect(D, AU, AV, dt)
	Grid.advect(self.M, AU, AV, dt)
	if yieldFn then
		yieldFn()
	end
	-- dilution by spreading, recovery, a touch of smoothing
	local out = table.create(nx * ny, 0)
	for j = 1, ny do
		for i = 1, nx do
			local k = i + (j - 1) * nx
			local div = (AU:get(i + 1, j) - AU:get(i - 1, j) + AV:get(i, j + 1) - AV:get(i, j - 1)) / (2 * dx)
			local d = D.v[k]
			local lap = D:get(i + 1, j) + D:get(i - 1, j) + D:get(i, j + 1) + D:get(i, j - 1) - 4 * d
			d += 0.04 * lap
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
