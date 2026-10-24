--!nonstrict
--!native
-- The precipitation field P(x, y, z, t) (guide section 11C), as Lagrangian hydrometeor parcels.
-- Storm updrafts release parcels of rain, graupel/hail or anvil ice where their condensate turns
-- to precipitation (Storm.luau decides how much, where and what kind). Each parcel is then
--   carried by the three-dimensional air motion (environment + storm circulations + cold pool),
--   falls at its own terminal speed (rain ~7 m/s, hail 14 sqrt(D cm) m/s, ice ~1 m/s),
--   evaporates below cloud base in unsaturated air (the water mass cools the cold pool),
--   melts below the freezing level (hail shrinks; small hail becomes rain; melting cools too),
--   sublimates slowly in the anvil, and lands (surface rain rate and hail size grids).
-- The parcels are binned onto a 1 km volume each update, giving reflectivity (Z from rain mass,
-- hail mass x size^3, ice mass), a hail share per voxel, and surface rain rate - the same
-- field drives radar, rain shafts, visibility and the cold pool, so a hook echo or a forward-
-- flank core exists only where the flow actually put the precipitation.
local function dep(name: string): any
	if script then
		return require((script :: any).Parent:FindFirstChild(name))
	end
	return (require :: any)("./" .. name)
end
local Thermo = dep("Thermo")
local Grid = dep("Grid")

local Precip = {}
Precip.__index = Precip

Precip.RAIN, Precip.HAIL, Precip.ICE = 1, 2, 3
local VOX = 1000 -- voxel size (m), horizontal and vertical
local NZV = 16 -- 0..16 km
Precip.VOX, Precip.NZV = VOX, NZV

export type Precip = typeof(setmetatable({} :: {
	env: any,
	coldPool: any,
	max: number,
	n: number,
	px: { number }, py: { number }, pz: { number }, pm: { number }, pk: { number }, pd: { number },
	free: { number },
	alive: { boolean },
	nxv: number, x0: number,
	vRain: { [number]: number }, vHail: { [number]: number }, vHailZ: { [number]: number }, vIce: { [number]: number },
	dbz: { [number]: number }, hailShare: { [number]: number },
	columns: { [number]: boolean },
	rainRate: any, hailSize: any, rainAcc: any,
	stats: { [string]: number },
	evapAcc: { [number]: number }, meltAcc: { [number]: number }, rhAcc: { [number]: number },
}, Precip))

function Precip.new(env: any, coldPool: any, maxParcels: number?): Precip
	local self = setmetatable({}, Precip) :: any
	self.env, self.coldPool = env, coldPool
	self.max = maxParcels or 12000
	self.n = 0
	self.px, self.py, self.pz, self.pm, self.pk, self.pd = {}, {}, {}, {}, {}, {}
	self.alive = {}
	self.free = {}
	self.nxv = math.ceil(2 * env.extent / VOX)
	self.x0 = -self.nxv * VOX / 2
	self.vRain, self.vHail, self.vHailZ, self.vIce = {}, {}, {}, {}
	self.dbz, self.hailShare, self.columns = {}, {}, {}
	-- surface: 1 km grids of rain rate (mm/h), largest hail (cm), and the accumulation behind them
	self.rainRate = Grid.new(self.nxv, self.nxv, VOX, self.x0, self.x0, 0)
	self.hailSize = Grid.new(self.nxv, self.nxv, VOX, self.x0, self.x0, 0)
	self.rainAcc = Grid.new(self.nxv, self.nxv, VOX, self.x0, self.x0, 0)
	self.evapAcc, self.meltAcc, self.rhAcc = {}, {}, {}
	self.stats = { emitted = 0, landed = 0, evaporated = 0, melted = 0, count = 0 }
	return self :: Precip
end

-- the mass a new parcel should carry, so the parcel count stays within budget
function Precip.parcelMass(self: Precip): number
	local fill = self.n / self.max
	return 1.5e5 * (1 + 6 * math.max(0, fill - 0.5) ^ 2)
end

function Precip.emit(self: Precip, x: number, y: number, z: number, mass: number, kind: number, size: number)
	if self.n >= self.max then
		return
	end
	local i = table.remove(self.free)
	if not i then
		i = #self.px + 1
	end
	self.px[i], self.py[i], self.pz[i], self.pm[i], self.pk[i], self.pd[i] = x, y, z, mass, kind, size
	self.alive[i] = true
	self.n += 1
	self.stats.emitted += mass
end

local function kill(self: Precip, i: number)
	self.alive[i] = false
	self.n -= 1
	table.insert(self.free, i)
end

local function fallSpeed(kind: number, size: number, z: number): number
	local thin = 1 + z / 20000 -- thinner air aloft
	if kind == 1 then
		return 8 * thin
	elseif kind == 2 then
		if size < 0.5 then
			return (4 + 8 * size) * thin -- graupel (2-5 mm: ~5-7 m/s)
		end
		return 14 * math.sqrt(size) * thin
	end
	return 0.8
end
Precip.fallSpeed = fallSpeed

-- relative humidity of the environment at z (0..1), from the nearest analysis column
local function rhAt(env: any, x: number, y: number, z: number): (number, number)
	local i, j = env.ag:cellOf(x, y)
	i, j = math.clamp(i, 1, env.ag.nx), math.clamp(j, 1, env.ag.ny)
	local col = env.agCols[env.ag:index(i, j)]
	local kz = math.clamp(z / env.DZ + 1, 1, env.NZ - 0.001)
	local k = math.floor(kz)
	local f = kz - k
	local t = col.t[k] + (col.t[k + 1] - col.t[k]) * f
	local td = col.td[k] + (col.td[k + 1] - col.td[k]) * f
	return Thermo.es(td) / Thermo.es(t), t
end

-- Advance dt seconds. airWind(x, y, z) -> u, v, w (storm-scale air motion, no tornado).
-- cloudBaseAt(x, y) -> the cloud base over that point (m) (nil: the environment's LCL).
function Precip.step(self: Precip, dt: number, airWind: (number, number, number) -> (number, number, number), cloudBaseAt: ((number, number) -> number)?, yieldFn: (() -> ())?)
	local env = self.env
	local px, py, pz, pm, pk, pd, alive = self.px, self.py, self.pz, self.pm, self.pk, self.pd, self.alive
	local lclF, fzF = env.fields.lcl, env.fields.freezing
	local evapAcc, meltAcc, rhAcc = self.evapAcc, self.meltAcc, self.rhAcc
	local cpD = self.coldPool.D
	local rainAcc = self.rainAcc
	local hail = self.hailSize
	local nx = rainAcc.nx
	for i = 1, #px do
		if yieldFn and i % 600 == 0 then
			yieldFn()
		end
		if alive[i] then
			local x, y, z = px[i], py[i], pz[i]
			local kind, size, m = pk[i], pd[i], pm[i]
			local u, v, w = airWind(x, y, z)
			local vt = fallSpeed(kind, size, z)
			-- (one wind sample a step: a parcel moves well under a voxel per step)
			x += u * dt
			y += v * dt
			z += (w - vt) * dt
			if z > 15800 then
				z = 15800
				if kind ~= 3 and size < 1.5 then
					self.stats.lofted = (self.stats.lofted or 0) + m
					kind = 3 -- lofted to the tropopause: detrained into the anvil as ice
				end
			end
			local base = if cloudBaseAt then cloudBaseAt(x, y) else lclF:sample(x, y)
			local fl = fzF:sample(x, y)
			-- unsaturated air: below the cloud base, or in a downdraft (out of the updraft, below
			-- the freezing level) where dry mid-level air has been drawn in
			local inDowndraft = z >= base and z < fl and w < 1
			if (z < base or inDowndraft) and kind ~= 2 then
				-- evaporation (rain) / sublimation (ice) in unsaturated sub-cloud air
				local rh = rhAt(env, x, y, z)
				if inDowndraft then
					rh = 0.5 + 0.5 * rh -- partly moistened by the rain already falling through it
				end
				local rate = if kind == 1 then (1 - rh) / 520 else (1 - rh) / 260
				local dm = m * math.min(1, math.max(0, rate) * dt)
				m -= dm
				local ci, cj = cpD:cellOf(x, y)
				if ci >= 1 and cj >= 1 and ci <= cpD.nx and cj <= cpD.ny then
					local ck = ci + (cj - 1) * cpD.nx
					evapAcc[ck] = (evapAcc[ck] or 0) + dm
					rhAcc[ck] = (rhAcc[ck] or 0) + dm * rh
				end
				self.stats.evaporated += dm
			elseif kind == 3 then
				local rh = rhAt(env, x, y, z)
				m -= m * math.min(1, math.max(0, 1 - rh) / 2400 * dt)
			end
			if kind == 2 and z < fl then
				-- melting: the stones shrink (their meltwater joins the falling rain, so the parcel
				-- keeps its mass); small stones end up as rain
				local tC = (fl - z) * 0.0065
				local frac = math.min(1, 0.0006 * tC * dt / math.max(0.3, size))
				local dm = m * frac
				size = size * (1 - frac) ^ (1 / 3)
				local ci, cj = cpD:cellOf(x, y)
				if ci >= 1 and cj >= 1 and ci <= cpD.nx and cj <= cpD.ny then
					local ck = ci + (cj - 1) * cpD.nx
					meltAcc[ck] = (meltAcc[ck] or 0) + dm
				end
				self.stats.melted += dm
				-- soft graupel and snow aggregates melt to rain within a few hundred metres
				if size < 0.25 or (size < 0.5 and z < fl - 300) then
					kind = 1
				end
			end
			if z <= 0 then
				local gi, gj = rainAcc:cellOf(x, y)
				if gi >= 1 and gj >= 1 and gi <= nx and gj <= nx then
					local k = gi + (gj - 1) * nx
					rainAcc.v[k] += m
					if kind == 2 and size > hail.v[k] then
						hail.v[k] = size
					end
				end
				self.stats.landed += m
				kill(self, i)
			elseif m < 2000 or math.abs(x) > env.extent or math.abs(y) > env.extent then
				if kind ~= 3 then
					self.stats.lost = (self.stats.lost or 0) + m
				end
				kill(self, i)
			else
				px[i], py[i], pz[i], pm[i], pk[i], pd[i] = x, y, z, m, kind, size
			end
		end
	end
	-- hand the evaporated / melted water to the cold pool
	for ck, dm in evapAcc do
		local ci = (ck - 1) % cpD.nx + 1
		local cj = (ck - 1) // cpD.nx + 1
		local cx, cy = cpD:centre(ci, cj)
		local rh = (rhAcc[ck] or 0) / math.max(1e-6, dm)
		self.coldPool:addCooling(cx, cy, dm, meltAcc[ck] or 0, rh)
		meltAcc[ck] = nil
	end
	for ck, dm in meltAcc do
		local ci = (ck - 1) % cpD.nx + 1
		local cj = (ck - 1) // cpD.nx + 1
		local cx, cy = cpD:centre(ci, cj)
		self.coldPool:addCooling(cx, cy, 0, dm, 0.8)
	end
	table.clear(evapAcc)
	table.clear(meltAcc)
	table.clear(rhAcc)
	-- surface rate: the landed mass per second, smoothed over ~3 minutes; hail marks fade
	local rr = self.rainRate.v
	local area = VOX * VOX
	local keep = math.exp(-dt / 180)
	for k = 1, #rr do
		local flux = rainAcc.v[k] / (area * dt) -- kg/m2/s = mm/s
		rr[k] = rr[k] * keep + flux * 3600 * (1 - keep)
		rainAcc.v[k] = 0
		hail.v[k] *= math.exp(-dt / 600)
	end
	self.stats.count = self.n
end

-- Bin the parcels into the 1 km voxel volume and work out reflectivity (dBZ) per voxel.
function Precip.bin(self: Precip, yieldFn: (() -> ())?)
	local vR, vH, vHZ, vI = self.vRain, self.vHail, self.vHailZ, self.vIce
	table.clear(vR)
	table.clear(vH)
	table.clear(vHZ)
	table.clear(vI)
	local nx, x0 = self.nxv, self.x0
	local nxy = nx * nx
	for i = 1, #self.px do
		if yieldFn and i % 1500 == 0 then
			yieldFn()
		end
		if self.alive[i] then
			local gx = (self.px[i] - x0) / VOX - 0.5
			local gy = (self.py[i] - x0) / VOX - 0.5
			local gz = self.pz[i] / VOX - 0.5
			local ix, iy = math.floor(gx), math.floor(gy)
			local fx, fy = gx - ix, gy - iy
			local iz = math.floor(gz)
			local fz = gz - iz
			local m, kind, d = self.pm[i], self.pk[i], self.pd[i]
			local target = if kind == 1 then vR elseif kind == 2 then vH else vI
			local d3 = d * d * d
			for a = 0, 1 do
				local cx = ix + a
				if cx >= 0 and cx < nx then
					for b = 0, 1 do
						local cy = iy + b
						if cy >= 0 and cy < nx then
							local wxy = (if a == 1 then fx else 1 - fx) * (if b == 1 then fy else 1 - fy)
							for c = 0, 1 do
								local cz = iz + c
								if cz >= 0 and cz < NZV then
									local wz = if c == 0 then 1 - fz else fz
									local wgt = wxy * wz
									if wgt > 0 then
										local key = cx + cy * nx + cz * nxy
										target[key] = (target[key] or 0) + m * wgt
										if kind == 2 then
											vHZ[key] = (vHZ[key] or 0) + m * wgt * d3
										end
									end
								end
							end
						end
					end
				end
			end
		end
	end
	-- reflectivity
	local dbz, share, cols = self.dbz, self.hailShare, self.columns
	table.clear(dbz)
	table.clear(share)
	table.clear(cols)
	local vol = VOX * VOX * VOX
	local function add(key: number)
		if dbz[key] then
			return
		end
		local mr = (vR[key] or 0) / vol * 1000 -- g/m3
		local mh = (vH[key] or 0) / vol * 1000
		local mi = (vI[key] or 0) / vol * 1000
		local zr = if mr > 0 then 2.4e4 * mr ^ 1.82 else 0
		local zh = 1.25e5 * (vHZ[key] or 0) / vol * 1000
		if mh > 0 and zh < 3e3 * mh then
			zh = 3e3 * mh -- small graupel
		end
		local zi = if mi > 0 then 600 * mi ^ 1.3 else 0
		local z = zr + zh + zi
		if z > 1 then
			dbz[key] = 10 * math.log10(z)
			share[key] = (zh + 0.4 * zi) / z
			cols[key % nxy] = true
		end
	end
	local n = 0
	for _, src in { vR, vH, vI } do
		for key in src do
			add(key)
			n += 1
			if yieldFn and n % 3000 == 0 then
				yieldFn()
			end
		end
	end
end

-- reflectivity (dBZ, -999 none) and hail share at a point, from the binned volume (trilinear)
function Precip.sample(self: Precip, x: number, y: number, z: number): (number, number)
	local nx, x0 = self.nxv, self.x0
	local gx = (x - x0) / VOX - 0.5
	local gy = (y - x0) / VOX - 0.5
	local gz = z / VOX - 0.5
	local ix, iy, iz = math.floor(gx), math.floor(gy), math.floor(gz)
	local fx, fy, fz = gx - ix, gy - iy, gz - iz
	local zsum, hs, wsum = 0, 0, 0
	local nxy = nx * nx
	for a = 0, 1 do
		for b = 0, 1 do
			for c = 0, 1 do
				local cx, cy, cz = ix + a, iy + b, math.clamp(iz + c, 0, NZV - 1)
				if cx >= 0 and cy >= 0 and cx < nx and cy < nx then
					local w = (if a == 1 then fx else 1 - fx) * (if b == 1 then fy else 1 - fy) * (if c == 1 then fz else 1 - fz)
					local key = cx + cy * nx + cz * nxy
					local d = self.dbz[key]
					if d then
						local zl = 10 ^ (d / 10)
						zsum += zl * w
						hs += (self.hailShare[key] or 0) * zl * w
					end
					wsum += w
				end
			end
		end
	end
	if zsum <= 1 then
		return -999, 0
	end
	return 10 * math.log10(zsum / math.max(1e-6, wsum)), hs / zsum
end

-- The volume packed for replication: per column with echo, its cell indices and NZV bytes of
-- reflectivity (dBZ + 32, x2) then NZV bytes of hail share (x255), then surface rain (sqrt mm/h
-- x16) and hail size (mm) bytes.
function Precip.pack(self: Precip): buffer
	local nx = self.nxv
	local nxy = nx * nx
	local list = {}
	for col in self.columns do
		table.insert(list, col)
	end
	local per = 4 + 2 * NZV + 2
	local b = buffer.create(4 + #list * per)
	buffer.writeu32(b, 0, #list)
	local off = 4
	for _, col in list do
		local cx, cy = col % nx, col // nx
		buffer.writeu16(b, off, cx)
		buffer.writeu16(b, off + 2, cy)
		for z = 0, NZV - 1 do
			local d = self.dbz[col + z * nxy]
			buffer.writeu8(b, off + 4 + z, if d then math.clamp(math.floor((d + 32) * 2 + 0.5), 1, 255) else 0)
			buffer.writeu8(b, off + 4 + NZV + z, math.clamp(math.floor((self.hailShare[col + z * nxy] or 0) * 255 + 0.5), 0, 255))
		end
		local k = cx + 1 + cy * nx
		buffer.writeu8(b, off + 4 + 2 * NZV, math.clamp(math.floor(math.sqrt(self.rainRate.v[k] or 0) * 16 + 0.5), 0, 255))
		buffer.writeu8(b, off + 5 + 2 * NZV, math.clamp(math.floor((self.hailSize.v[k] or 0) * 10 + 0.5), 0, 255))
		off += per
	end
	return b
end

-- The client side: rebuild a sampling volume from a packed buffer.
function Precip.unpack(b: buffer, extent: number): any
	local nx = math.ceil(2 * extent / VOX)
	local x0 = -nx * VOX / 2
	local nxy = nx * nx
	local vol = { nxv = nx, x0 = x0, dbz = {}, hailShare = {}, rain = {}, hail = {}, columns = {} }
	local n = buffer.readu32(b, 0)
	local per = 4 + 2 * NZV + 2
	for c = 0, n - 1 do
		local off = 4 + c * per
		local cx, cy = buffer.readu16(b, off), buffer.readu16(b, off + 2)
		local col = cx + cy * nx
		vol.columns[col] = true
		for z = 0, NZV - 1 do
			local raw = buffer.readu8(b, off + 4 + z)
			if raw > 0 then
				vol.dbz[col + z * nxy] = raw / 2 - 32
				vol.hailShare[col + z * nxy] = buffer.readu8(b, off + 4 + NZV + z) / 255
			end
		end
		local rr = buffer.readu8(b, off + 4 + 2 * NZV) / 16
		vol.rain[col] = rr * rr
		vol.hail[col] = buffer.readu8(b, off + 5 + 2 * NZV) / 10
	end
	return setmetatable(vol, { __index = { sample = Precip.sample } })
end

-- surface rain rate (mm/h) and hail (cm) at a point from an unpacked volume (or the live field)
function Precip.surface(vol: any, x: number, y: number): (number, number)
	local nx, x0 = vol.nxv, vol.x0
	local cx = math.floor((x - x0) / VOX)
	local cy = math.floor((y - x0) / VOX)
	if cx < 0 or cy < 0 or cx >= nx or cy >= nx then
		return 0, 0
	end
	if vol.rain then
		return vol.rain[cx + cy * nx] or 0, vol.hail[cx + cy * nx] or 0
	end
	return vol.rainRate:sample(x, y), vol.hailSize:sample(x, y)
end

return Precip
