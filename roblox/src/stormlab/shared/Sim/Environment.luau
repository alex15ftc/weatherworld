--!nonstrict
--!native
-- The lab's environmental atmosphere (guide section 10), built from the weather engine's own
-- soundings (scripts/export-lab-scenario.mjs) and evolved locally:
--   * every engine cell's sounding is resampled to a fixed height grid (0..16 km every 250 m,
--     heights rebuilt hydrostatically from pressure and virtual temperature);
--   * columns anywhere are bilinear blends of the four nearest engine columns, so CAPE, shear and
--     moisture vary across the domain exactly as the engine had them (nothing painted);
--   * surface temperature and dewpoint live on a 4 km grid and are advected by the surface wind
--     (drylines and fronts move), heated by the sun and cooled under storm anvils (shade);
--   * the cold pool (ColdPool) is folded into the low levels wherever it has spread;
--   * parcel analyses (Thermo.analyse) are refreshed a few cells per step on an 8 km grid and
--     sampled bilinearly (CAPE, CIN, LCL, SRH, shear, Bunkers motion...).
local function dep(name: string): any
	if script then
		return require((script :: any).Parent:FindFirstChild(name))
	end
	return (require :: any)("./" .. name)
end
local Thermo = dep("Thermo")
local Grid = dep("Grid")

local Environment = {}
Environment.__index = Environment

local DZ = 250
local NZ = 65 -- 0..16000 m
Environment.DZ, Environment.NZ = DZ, NZ

local ZG = table.create(NZ, 0)
for k = 1, NZ do
	ZG[k] = (k - 1) * DZ
end
Environment.Z = ZG

export type Column = { t: { number }, td: { number }, u: { number }, v: { number }, lnp: { number } }

local ANALYSIS_FIELDS = {
	"sbcape", "sbcin", "mlcape", "mlcin", "mucape", "lcl", "lfc", "el",
	"srh01", "srh03", "shear01", "shear06", "rightU", "rightV", "meanU", "meanV",
	"pw", "freezing", "wbz", "lapse75", "lapse03", "stp", "scp", "thetaE", "ddDeficit",
	"dd5", "dd20", "dd60",
}
Environment.ANALYSIS_FIELDS = ANALYSIS_FIELDS

-- engine sounding rows {p, t, td, u, v} (surface first) -> a column on ZG
local function columnFromRows(rows: { { number } }): Column
	local n = #rows
	local zr = table.create(n, 0)
	for r = 2, n do
		local a, b = rows[r - 1], rows[r]
		local tv = 0.5 * (Thermo.virtualK(a[2], Thermo.mixingRatio(a[3], a[1])) + Thermo.virtualK(b[2], Thermo.mixingRatio(b[3], b[1])))
		zr[r] = zr[r - 1] + Thermo.RD * tv / Thermo.G * math.log(a[1] / b[1])
	end
	local col: Column = { t = table.create(NZ), td = table.create(NZ), u = table.create(NZ), v = table.create(NZ), lnp = table.create(NZ) }
	local r = 1
	for k = 1, NZ do
		local z = ZG[k]
		while r < n - 1 and zr[r + 1] < z do
			r += 1
		end
		local a, b = rows[r], rows[r + 1]
		local f = math.clamp((z - zr[r]) / math.max(1, zr[r + 1] - zr[r]), 0, 1.5)
		local lnp = math.log(a[1]) + (math.log(b[1]) - math.log(a[1])) * f
		col.lnp[k] = lnp
		col.t[k] = a[2] + (b[2] - a[2]) * f
		col.td[k] = math.min(col.t[k], a[3] + (b[3] - a[3]) * f)
		col.u[k] = a[4] + (b[4] - a[4]) * f
		col.v[k] = a[5] + (b[5] - a[5]) * f
	end
	return col
end

local function blend(cols: { Column }, w: { number }): Column
	local out: Column = { t = table.create(NZ), td = table.create(NZ), u = table.create(NZ), v = table.create(NZ), lnp = table.create(NZ) }
	for k = 1, NZ do
		local t, td, u, v, lnp = 0, 0, 0, 0, 0
		for c = 1, #cols do
			local col, wc = cols[c], w[c]
			t += col.t[k] * wc
			td += col.td[k] * wc
			u += col.u[k] * wc
			v += col.v[k] * wc
			lnp += col.lnp[k] * wc
		end
		out.t[k], out.td[k], out.u[k], out.v[k], out.lnp[k] = t, td, u, v, lnp
	end
	return out
end

local function toProfile(col: Column): any
	local p = table.create(NZ)
	for k = 1, NZ do
		p[k] = math.exp(col.lnp[k])
	end
	return { z = ZG, p = p, t = col.t, td = col.td, u = col.u, v = col.v }
end
Environment.toProfile = toProfile

export type Environment = typeof(setmetatable({} :: {
	data: any,
	meta: any,
	cellM: number,
	half: number,
	extent: number,
	engineCols: { { Column } }, -- [ci][cj], cj counts north
	surfT: any, surfTd: any, surfT0: any, surfTd0: any, surfU: any, surfV: any, shade: any,
	ag: any, -- analysis grid template (8 km)
	agCols: { Column },
	fields: { [string]: any },
	agCursor: number,
	analysed: number,
	coldPool: any?,
	clockUtc: number,
}, Environment))

function Environment.new(data: any, opts: { surfaceDx: number?, analysisDx: number? }?): Environment
	local o = opts or {}
	local meta = data.meta
	local cellM = meta.cellKm * 1000
	local half = meta.half
	local extent = (half + 0.5) * cellM
	local self = setmetatable({}, Environment) :: any
	self.data, self.meta, self.cellM, self.half, self.extent = data, meta, cellM, half, extent
	self.clockUtc = meta.simHourUtc

	-- engine columns, indexed [i + half + 1][j + half + 1] (j north)
	local cols = {}
	local surfaces = {}
	for _, c in data.cells do
		local ci, cj = c.i + half + 1, c.j + half + 1
		cols[ci] = cols[ci] or {}
		cols[ci][cj] = columnFromRows(c.sounding)
		surfaces[ci] = surfaces[ci] or {}
		surfaces[ci][cj] = c
	end
	self.engineCols = cols
	self.engineSurface = surfaces

	-- surface grid
	local sdx = o.surfaceDx or 4000
	local sn = math.ceil(2 * extent / sdx)
	local x0 = -sn * sdx / 2
	local function sg(v: number?)
		return Grid.new(sn, sn, sdx, x0, x0, v or 0)
	end
	self.surfT, self.surfTd, self.surfT0, self.surfTd0 = sg(), sg(), sg(), sg()
	self.surfU, self.surfV, self.shade = sg(), sg(), sg()
	for j = 1, sn do
		for i = 1, sn do
			local x, y = self.surfT:centre(i, j)
			local t, td, u, v = self:engineSurfaceAt(x, y)
			local k = self.surfT:index(i, j)
			self.surfT.v[k], self.surfTd.v[k], self.surfT0.v[k], self.surfTd0.v[k] = t, td, t, td
			self.surfU.v[k], self.surfV.v[k] = u, v
		end
	end

	-- analysis grid: a base column per cell and one Grid per analysed field
	local adx = o.analysisDx or 8000
	local an = math.ceil(2 * extent / adx)
	local ax0 = -an * adx / 2
	self.ag = Grid.new(an, an, adx, ax0, ax0, 0)
	self.agCols = {}
	self.fields = {}
	for _, f in ANALYSIS_FIELDS do
		self.fields[f] = Grid.new(an, an, adx, ax0, ax0, 0)
	end
	for j = 1, an do
		for i = 1, an do
			local x, y = self.ag:centre(i, j)
			self.agCols[self.ag:index(i, j)] = self:engineColumnAt(x, y)
		end
	end
	self.agCursor = 0
	self.analysed = 0
	return self :: Environment
end

-- bilinear weights over the engine cells at lab point (x, y)
function Environment.engineWeights(self: Environment, x: number, y: number): ({ number }, { number }, { number })
	local half = self.half
	local gx = math.clamp(x / self.cellM + half + 1, 1, 2 * half + 1)
	local gy = math.clamp(y / self.cellM + half + 1, 1, 2 * half + 1)
	local i, j = math.min(2 * half, math.floor(gx)), math.min(2 * half, math.floor(gy))
	local fx, fy = gx - i, gy - j
	return { i, i + 1, i, i + 1 }, { j, j, j + 1, j + 1 }, { (1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy }
end

function Environment.engineColumnAt(self: Environment, x: number, y: number): Column
	local is, js, w = self:engineWeights(x, y)
	local cs = {}
	for c = 1, 4 do
		cs[c] = self.engineCols[is[c]][js[c]]
	end
	return blend(cs, w)
end

function Environment.engineSurfaceAt(self: Environment, x: number, y: number): (number, number, number, number)
	local is, js, w = self:engineWeights(x, y)
	local t, td, u, v = 0, 0, 0, 0
	for c = 1, 4 do
		local s = self.engineSurface[is[c]][js[c]]
		t += s.tC * w[c]
		td += s.tdC * w[c]
		u += s.u * w[c]
		v += s.v * w[c]
	end
	return t, td, u, v
end

-- The environmental (storm-free) wind at height z (m above ground): blended engine columns.
-- Fast: four columns, two levels.
function Environment.windAt(self: Environment, x: number, y: number, z: number): (number, number)
	local ag = self.ag
	local gx = math.clamp((x - ag.x0) / ag.dx + 0.5, 1, ag.nx)
	local gy = math.clamp((y - ag.y0) / ag.dx + 0.5, 1, ag.ny)
	local i, j = math.min(ag.nx - 1, math.floor(gx)), math.min(ag.ny - 1, math.floor(gy))
	local fx, fy = gx - i, gy - j
	local kz = math.clamp(z / DZ + 1, 1, NZ - 0.001)
	local k = math.floor(kz)
	local fz = kz - k
	local cols = self.agCols
	local nx = ag.nx
	local k1 = k + 1
	-- (each column's wind at z, interpolated between its two levels; written out inline: no
	-- closure per call)
	local base = i + (j - 1) * nx
	local c1, c2, c3, c4 = cols[base], cols[base + 1], cols[base + nx], cols[base + nx + 1]
	local cu1, cv1 = c1.u, c1.v
	local u1, v1 = cu1[k] + (cu1[k1] - cu1[k]) * fz, cv1[k] + (cv1[k1] - cv1[k]) * fz
	local cu2, cv2 = c2.u, c2.v
	local u2, v2 = cu2[k] + (cu2[k1] - cu2[k]) * fz, cv2[k] + (cv2[k1] - cv2[k]) * fz
	local cu3, cv3 = c3.u, c3.v
	local u3, v3 = cu3[k] + (cu3[k1] - cu3[k]) * fz, cv3[k] + (cv3[k1] - cv3[k]) * fz
	local cu4, cv4 = c4.u, c4.v
	local u4, v4 = cu4[k] + (cu4[k1] - cu4[k]) * fz, cv4[k] + (cv4[k1] - cv4[k]) * fz
	local w1, w2, w3, w4 = (1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy
	return u1 * w1 + u2 * w2 + u3 * w3 + u4 * w4, v1 * w1 + v2 * w2 + v3 * w3 + v4 * w4
end

-- environmental temperature (C) at height z
function Environment.temperatureAt(self: Environment, x: number, y: number, z: number): number
	local i, j = self.ag:cellOf(x, y)
	i, j = math.clamp(i, 1, self.ag.nx), math.clamp(j, 1, self.ag.ny)
	local col = self.agCols[self.ag:index(i, j)]
	local kz = math.clamp(z / DZ + 1, 1, NZ - 0.001)
	local k = math.floor(kz)
	return col.t[k] + (col.t[k + 1] - col.t[k]) * (kz - k)
end

-- Surface temperature / dewpoint now (C), including the cold pool if one has spread here.
function Environment.surfaceAt(self: Environment, x: number, y: number): (number, number)
	local t, td = self.surfT:sample(x, y), self.surfTd:sample(x, y)
	local cp = self.coldPool
	if cp then
		local dT, moist = cp:deficitAt(x, y)
		if dT > 0 then
			t -= dT
			-- rain-cooled air is moistened by evaporation toward saturation (wet-bulb cooling)
			td = math.min(t, td + moist * dT * 0.35)
		end
	end
	return t, math.min(t, td)
end

-- The full profile at (x, y): the blended engine column with the surface changes (advection,
-- heating, cold pool) mixed into its boundary layer.
function Environment.profileAt(self: Environment, x: number, y: number): any
	local i, j = self.ag:cellOf(x, y)
	i, j = math.clamp(i, 1, self.ag.nx), math.clamp(j, 1, self.ag.ny)
	local col = self:engineColumnAt(x, y)
	local prof = toProfile(col)
	local tNow, tdNow = self.surfT:sample(x, y), self.surfTd:sample(x, y)
	local dT = tNow - self.surfT0:sample(x, y)
	local dTd = tdNow - self.surfTd0:sample(x, y)
	if math.abs(dT) > 0.05 or math.abs(dTd) > 0.05 then
		prof = Thermo.withSurface(prof, prof.t[1] + dT, prof.td[1] + dTd, prof.u[1], prof.v[1], 1200)
	end
	local cp = self.coldPool
	if cp then
		local def, moist, depth = cp:deficitAt(x, y)
		if def > 0.2 then
			local t = prof.t[1] - def
			local td = math.min(t, prof.td[1] + moist * def * 0.35)
			prof = Thermo.withSurface(prof, t, td, prof.u[1], prof.v[1], math.max(300, depth * 1.4))
		end
	end
	return prof
end

function Environment.analysisAt(self: Environment, x: number, y: number): { [string]: number }
	local out = {}
	for _, f in ANALYSIS_FIELDS do
		out[f] = self.fields[f]:sample(x, y)
	end
	return out
end

function Environment.field(self: Environment, name: string, x: number, y: number): number
	return self.fields[name]:sample(x, y)
end

local function writeAnalysis(self: Environment, k: number, a: any)
	local F = self.fields
	F.sbcape.v[k] = a.sb.cape
	F.sbcin.v[k] = a.sb.cin
	F.mlcape.v[k] = a.ml.cape
	F.mlcin.v[k] = a.ml.cin
	F.mucape.v[k] = a.mu.cape
	F.lcl.v[k] = a.ml.lclZ
	F.lfc.v[k] = a.ml.lfcZ or 6000
	F.el.v[k] = a.mu.elZ or 0
	F.srh01.v[k] = a.srh01
	F.srh03.v[k] = a.srh03
	F.shear01.v[k] = a.shear01
	F.shear06.v[k] = a.shear06
	F.rightU.v[k] = a.rightU
	F.rightV.v[k] = a.rightV
	F.meanU.v[k] = a.meanU
	F.meanV.v[k] = a.meanV
	F.pw.v[k] = a.pw
	F.freezing.v[k] = a.freezingZ
	F.wbz.v[k] = a.wetBulbZeroZ
	F.lapse75.v[k] = a.lapse75
	F.lapse03.v[k] = a.lapse03
	F.stp.v[k] = a.stp
	F.scp.v[k] = a.scp
	F.thetaE.v[k] = a.thetaE
	F.ddDeficit.v[k] = a.ddDeficit
	F.dd5.v[k], F.dd20.v[k], F.dd60.v[k] = a.dd5 or 0, a.dd20 or 0, a.dd60 or 0
end

-- Analyse `count` analysis cells (round robin); all of them when count is nil.
function Environment.analyse(self: Environment, count: number?)
	local total = self.ag.nx * self.ag.ny
	local n = count or total
	for _ = 1, n do
		self.agCursor = self.agCursor % total + 1
		local k = self.agCursor
		local i = (k - 1) % self.ag.nx + 1
		local j = (k - 1) // self.ag.nx + 1
		local x, y = self.ag:centre(i, j)
		writeAnalysis(self, k, Thermo.analyse(self:profileAt(x, y)))
		self.analysed += 1
	end
end

-- Diurnal surface temperature tendency (K/s) at local solar hour h, with shade 0..1.
-- A 6 K amplitude sine peaking at 15:30 local; shade takes away the sunlit part of the heating.
function Environment.heatingRate(self: Environment, shade: number): number
	local sun = self.meta.sun
	local offset = if sun then sun.utcOffsetHours else -6
	local rise = if sun then sun.sunriseLocal else 6
	local set = if sun then sun.sunsetLocal else 20
	local h = (self.clockUtc + offset) % 24
	local amp = 6
	local rate = amp * (2 * math.pi / 24) * math.cos(2 * math.pi * (h - 15.5) / 24) -- K/h
	local day = if h > rise and h < set then math.sin(math.pi * (h - rise) / (set - rise)) else 0
	-- under thick anvil the sun's contribution (~1.8 K/h at noon) is cut off
	rate -= 1.8 * day * shade
	return rate / 3600
end

-- Advance the surface by dt seconds.
function Environment.step(self: Environment, dt: number)
	self.clockUtc += dt / 3600
	Grid.advect(self.surfT, self.surfU, self.surfV, dt)
	Grid.advect(self.surfTd, self.surfU, self.surfV, dt)
	-- the base fields move too, so dT is change by heating/cooling, not by the dryline passing
	Grid.advect(self.surfT0, self.surfU, self.surfV, dt)
	Grid.advect(self.surfTd0, self.surfU, self.surfV, dt)
	local T, Td, S = self.surfT.v, self.surfTd.v, self.shade.v
	for k = 1, #T do
		T[k] += self:heatingRate(S[k]) * dt
		if Td[k] > T[k] then
			Td[k] = T[k]
		end
	end
end

-- A short text summary of the analysis at a point (debug panel).
function Environment.describe(self: Environment, x: number, y: number): string
	local a = self:analysisAt(x, y)
	return string.format("SBCAPE %d  MLCIN %d  LCL %dm  SRH01 %d  SRH03 %d  S06 %.0fm/s  PW %.0fmm  STP %.1f",
		a.sbcape, a.mlcin, a.lcl, a.srh01, a.srh03, a.shear06, a.pw, a.stp)
end

return Environment
