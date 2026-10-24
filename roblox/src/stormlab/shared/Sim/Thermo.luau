--!nonstrict
--!native
-- Sounding thermodynamics and kinematics for the storm lab (guide section 10: the environmental
-- state). A profile is a set of levels from the ground up:
--   { z = { m above ground }, p = { hPa }, t = { deg C }, td = { deg C }, u = { m/s }, v = { m/s } }
-- u is toward the east, v toward the north.
--
--   Thermo.analyse(profile) -> Analysis (CAPE, CIN, LCL, LFC, EL, shear, SRH, Bunkers motion, PW...)
--   Thermo.at(profile, field, z) -> the field interpolated at height z
--   Thermo.parcel(profile, kind) -> the lifted parcel ("sb" surface, "ml" 0-1 km mixed, "mu" most unstable)
-- Formulas: Bolton (1980) vapour pressure and LCL, pseudo-adiabatic ascent in height steps,
-- virtual-temperature buoyancy, Bunkers et al. (2000) storm motion, Davies-Jones SRH.
local Thermo = {}

local G = 9.81
local RD = 287.04
local CP = 1005.7
local LV = 2.501e6
local EPS = 0.622
local K0 = 273.15

Thermo.G, Thermo.RD, Thermo.CP, Thermo.LV = G, RD, CP, LV

export type Profile = {
	z: { number },
	p: { number },
	t: { number },
	td: { number },
	u: { number },
	v: { number },
}

export type Parcel = {
	kind: string,
	startZ: number,
	cape: number, -- J/kg
	cin: number, -- J/kg, <= 0
	lclZ: number, -- m above ground
	lfcZ: number?, -- nil: never free
	elZ: number?,
	maxBuoyancy: number, -- K of virtual temperature excess at its peak
	-- the parcel's virtual temperature excess (K) every STEP metres from the ground: the updraft's
	-- buoyancy profile (storm cells take their vertical structure from this)
	buoyancy: { number },
}

export type Analysis = {
	sb: Parcel,
	ml: Parcel,
	mu: Parcel,
	shear01: number, -- m/s, bulk shear magnitude 0-1 km
	shear06: number,
	shear01u: number, shear01v: number,
	shear06u: number, shear06v: number,
	meanU: number, meanV: number, -- 0-6 km mean wind
	rightU: number, rightV: number, -- Bunkers right-moving supercell motion
	leftU: number, leftV: number,
	srh01: number, -- m2/s2 for the right mover
	srh03: number,
	pw: number, -- mm
	freezingZ: number, -- m above ground of the 0 C level
	wetBulbZeroZ: number,
	lapse03: number, -- C/km
	lapse75: number, -- 700-500 hPa C/km
	thetaE: number, -- K, surface
	surfaceT: number, surfaceTd: number,
	-- composite indices for display only (nothing in the lab is triggered by them)
	scp: number,
	stp: number,
	ddDeficit: number, -- K: how much colder than the surface air a saturated downdraft arrives
}

Thermo.STEP = 100 -- m, the ascent step and the buoyancy profile spacing
Thermo.TOP = 16000

function Thermo.es(tC: number): number -- hPa
	return 6.112 * math.exp(17.67 * tC / (tC + 243.5))
end

function Thermo.mixingRatio(tdC: number, p: number): number -- kg/kg
	local e = Thermo.es(tdC)
	return EPS * e / math.max(1, p - e)
end

function Thermo.dewpointFromMixing(w: number, p: number): number
	local e = w * p / (EPS + w)
	local l = math.log(math.max(1e-6, e) / 6.112)
	return 243.5 * l / (17.67 - l)
end

function Thermo.virtualK(tC: number, w: number): number
	return (tC + K0) * (1 + 0.61 * w)
end

function Thermo.theta(tC: number, p: number): number
	return (tC + K0) * (1000 / p) ^ 0.2857
end

-- Bolton's equivalent potential temperature (K)
function Thermo.thetaE(tC: number, tdC: number, p: number): number
	local w = Thermo.mixingRatio(tdC, p)
	local tk = tC + K0
	local tl = 1 / (1 / (tdC + K0 - 56) + math.log(tk / (tdC + K0)) / 800) + 56
	local th = tk * (1000 / p) ^ (0.2854 * (1 - 0.28 * w))
	return th * math.exp((3376 / tl - 2.54) * w * (1 + 0.81 * w))
end

-- index of the level at or below z, and the interpolation weight to the next
local function bracket(zs: { number }, z: number): (number, number)
	local n = #zs
	if z <= zs[1] then
		return 1, 0
	end
	if z >= zs[n] then
		return n - 1, 1
	end
	local lo, hi = 1, n
	while hi - lo > 1 do
		local mid = (lo + hi) // 2
		if zs[mid] <= z then
			lo = mid
		else
			hi = mid
		end
	end
	return lo, (z - zs[lo]) / (zs[lo + 1] - zs[lo])
end

function Thermo.at(profile: Profile, field: string, z: number): number
	local arr = (profile :: any)[field] :: { number }
	local i, f = bracket(profile.z, z)
	if field == "p" then -- pressure: interpolate its log
		return math.exp(math.log(arr[i]) * (1 - f) + math.log(arr[i + 1]) * f)
	end
	return arr[i] * (1 - f) + arr[i + 1] * f
end

function Thermo.windAt(profile: Profile, z: number): (number, number)
	return Thermo.at(profile, "u", z), Thermo.at(profile, "v", z)
end

function Thermo.zAtPressure(profile: Profile, p: number): number
	local ps = profile.p
	for i = 1, #ps - 1 do
		if ps[i] >= p and ps[i + 1] < p then
			local f = (math.log(ps[i]) - math.log(p)) / (math.log(ps[i]) - math.log(ps[i + 1]))
			return profile.z[i] + f * (profile.z[i + 1] - profile.z[i])
		end
	end
	return profile.z[#profile.z]
end

-- pseudo-adiabatic lapse rate (K/m) of saturated air at tC, p
local function moistLapse(tC: number, p: number): number
	local tk = tC + K0
	local w = Thermo.mixingRatio(tC, p)
	return G * (1 + LV * w / (RD * tk)) / (CP + LV * LV * w * EPS / (RD * tk * tk))
end

-- Lift a parcel from height z0 with temperature t0 and dewpoint td0 (C). Returns its analysis.
function Thermo.lift(profile: Profile, kind: string, z0: number, t0: number, td0: number): Parcel
	local STEP = Thermo.STEP
	local p0 = Thermo.at(profile, "p", z0)
	local w = Thermo.mixingRatio(td0, p0)
	-- LCL (Bolton): parcel temperature at saturation, then the height by the dry adiabat
	local tk, tdk = t0 + K0, td0 + K0
	local tl = 1 / (1 / (tdk - 56) + math.log(tk / tdk) / 800) + 56
	local lclZ = z0 + math.max(0, (tk - tl) / (G / CP))
	local buoy = {}
	local cape, cin = 0, 0
	local lfc: number?, el: number? = nil, nil
	local maxB = -math.huge
	local tp = t0
	local z = 0
	local idx = 0
	local wasPos = false
	local cinBelow = 0 -- negative area accumulated since the last positive layer
	while z <= Thermo.TOP do
		idx += 1
		local p = Thermo.at(profile, "p", z)
		local te = Thermo.at(profile, "t", z)
		local tde = Thermo.at(profile, "td", z)
		local we = Thermo.mixingRatio(tde, p)
		local b = 0
		if z >= z0 then
			if z <= lclZ then
				tp = t0 - (G / CP) * (z - z0)
			end
			local wp = if z <= lclZ then w else Thermo.mixingRatio(tp, p)
			local tvp = Thermo.virtualK(tp, wp)
			local tve = Thermo.virtualK(te, we)
			b = tvp - tve
			local a = G * b / tve * STEP
			if b > 0 then
				if not wasPos then
					-- a new positive layer: what was negative below it was inhibition
					cin += cinBelow
					cinBelow = 0
					if lfc == nil and z >= lclZ - STEP then
						lfc = z
					end
				end
				if lfc ~= nil then
					cape += a
					el = z
				end
				wasPos = true
			else
				if lfc == nil then
					cinBelow += a
				end
				wasPos = false
			end
			maxB = math.max(maxB, b)
			if z > lclZ then
				tp -= moistLapse(tp, p) * STEP
			elseif z + STEP > lclZ then
				-- crossing the LCL inside this step: dry to it, moist after
				local dry = lclZ - z
				local tAtLcl = t0 - (G / CP) * (lclZ - z0)
				tp = tAtLcl - moistLapse(tAtLcl, p) * (STEP - dry)
			end
		end
		buoy[idx] = b
		z += STEP
	end
	if lfc == nil then
		cin += cinBelow
	end
	return {
		kind = kind,
		startZ = z0,
		cape = cape,
		cin = math.min(0, cin),
		lclZ = lclZ,
		lfcZ = lfc,
		elZ = el,
		maxBuoyancy = maxB,
		buoyancy = buoy,
	}
end

function Thermo.parcel(profile: Profile, kind: string): Parcel
	if kind == "sb" then
		return Thermo.lift(profile, "sb", 0, profile.t[1], profile.td[1])
	elseif kind == "ml" then
		-- mean potential temperature and mixing ratio of the lowest 1000 m
		local n, th, w = 0, 0, 0
		for z = 0, 1000, 100 do
			local p = Thermo.at(profile, "p", z)
			th += Thermo.theta(Thermo.at(profile, "t", z), p)
			w += Thermo.mixingRatio(Thermo.at(profile, "td", z), p)
			n += 1
		end
		th /= n
		w /= n
		local p0 = profile.p[1]
		local t0 = th * (p0 / 1000) ^ 0.2857 - K0
		local td0 = math.min(t0, Thermo.dewpointFromMixing(w, p0))
		return Thermo.lift(profile, "ml", 0, t0, td0)
	else
		-- most unstable: the highest theta-e in the lowest 3 km
		local bestZ, best = 0, -math.huge
		for z = 0, 3000, 250 do
			local p = Thermo.at(profile, "p", z)
			local te = Thermo.thetaE(Thermo.at(profile, "t", z), Thermo.at(profile, "td", z), p)
			if te > best then
				best, bestZ = te, z
			end
		end
		local par = Thermo.lift(profile, "mu", bestZ, Thermo.at(profile, "t", bestZ), Thermo.at(profile, "td", bestZ))
		return par
	end
end

local function meanWind(profile: Profile, z0: number, z1: number): (number, number)
	local su, sv, n = 0, 0, 0
	local z = z0
	while z <= z1 + 1e-6 do
		local u, v = Thermo.windAt(profile, z)
		su += u
		sv += v
		n += 1
		z += 250
	end
	return su / n, sv / n
end
Thermo.meanWind = meanWind

-- storm-relative helicity (m2/s2) from the ground to zTop for a storm moving (cu, cv)
function Thermo.srh(profile: Profile, zTop: number, cu: number, cv: number): number
	local sum = 0
	local z = 0
	local u0, v0 = Thermo.windAt(profile, 0)
	while z < zTop do
		local z1 = math.min(zTop, z + 100)
		local u1, v1 = Thermo.windAt(profile, z1)
		sum += (u1 - cu) * (v0 - cv) - (u0 - cu) * (v1 - cv)
		u0, v0, z = u1, v1, z1
	end
	return sum
end

-- Bunkers internal-dynamics storm motion: mean 0-6 km wind plus 7.5 m/s perpendicular to the shear
function Thermo.bunkers(profile: Profile): (number, number, number, number, number, number)
	local mu, mv = meanWind(profile, 0, 6000)
	local lu, lv = meanWind(profile, 0, 500)
	local hu, hv = meanWind(profile, 5500, 6000)
	local su, sv = hu - lu, hv - lv
	local mag = math.max(1e-6, math.sqrt(su * su + sv * sv))
	local D = 7.5
	-- right of the shear vector: (sv, -su)
	local ru, rv = mu + D * sv / mag, mv - D * su / mag
	local leu, lev = mu - D * sv / mag, mv + D * su / mag
	return ru, rv, leu, lev, mu, mv
end

function Thermo.precipitableWater(profile: Profile): number
	local pw = 0
	for i = 1, #profile.z - 1 do
		local q0 = Thermo.mixingRatio(profile.td[i], profile.p[i])
		local q1 = Thermo.mixingRatio(profile.td[i + 1], profile.p[i + 1])
		pw += 0.5 * (q0 + q1) * (profile.p[i] - profile.p[i + 1]) * 100 / G
	end
	return pw -- kg/m2 = mm
end

local function levelOf(profile: Profile, value: number, field: string): number
	local zs = profile.z
	local arr = (profile :: any)[field] :: { number }
	for i = 1, #zs - 1 do
		if (arr[i] - value) * (arr[i + 1] - value) <= 0 and arr[i] ~= arr[i + 1] then
			return zs[i] + (value - arr[i]) / (arr[i + 1] - arr[i]) * (zs[i + 1] - zs[i])
		end
	end
	return if arr[1] < value then 0 else zs[#zs]
end

local function wetBulb(tC: number, tdC: number): number
	-- Stull's one-third rule is too rough; iterate the psychrometric balance instead
	local tw = (tC + tdC) / 2
	for _ = 1, 8 do
		local e = Thermo.es(tdC)
		local f = Thermo.es(tw) - 0.00066 * 1000 * (tC - tw) * (1 + 0.00115 * tw) - e
		tw -= f / (Thermo.es(tw) * 17.67 * 243.5 / ((tw + 243.5) ^ 2) + 0.66)
	end
	return tw
end

function Thermo.analyse(profile: Profile): Analysis
	local sb = Thermo.parcel(profile, "sb")
	local ml = Thermo.parcel(profile, "ml")
	local mu = Thermo.parcel(profile, "mu")
	local u0, v0 = Thermo.windAt(profile, 0)
	local u1, v1 = Thermo.windAt(profile, 1000)
	local u6, v6 = Thermo.windAt(profile, 6000)
	local ru, rv, lu, lv, mwu, mwv = Thermo.bunkers(profile)
	local srh1 = Thermo.srh(profile, 1000, ru, rv)
	local srh3 = Thermo.srh(profile, 3000, ru, rv)
	local shear6 = math.sqrt((u6 - u0) ^ 2 + (v6 - v0) ^ 2)
	-- wet-bulb zero: where the wet-bulb temperature profile crosses 0 C
	local wbz = 0
	do
		local prev = wetBulb(profile.t[1], profile.td[1])
		for z = 100, 8000, 100 do
			local tw = wetBulb(Thermo.at(profile, "t", z), Thermo.at(profile, "td", z))
			if prev > 0 and tw <= 0 then
				wbz = z - 100 + 100 * prev / (prev - tw)
				break
			end
			prev = tw
		end
	end
	local z7 = Thermo.zAtPressure(profile, 700)
	local z5 = Thermo.zAtPressure(profile, 500)
	local t7, t5 = Thermo.at(profile, "t", z7), Thermo.at(profile, "t", z5)
	local t3 = Thermo.at(profile, "t", 3000)
	-- downdraft parcel: from the lowest theta-e level 1.5-5 km up, at its wet-bulb temperature,
	-- descending saturated (pseudo-adiabatically) to the ground: how cold rain-driven
	-- downdraft air arrives (the DCAPE parcel); ddDeficit = surface T minus that
	local ddDeficit = 0
	do
		local srcZ, minTe = 3000, math.huge
		for z = 1500, 5000, 250 do
			local p = Thermo.at(profile, "p", z)
			local te = Thermo.thetaE(Thermo.at(profile, "t", z), Thermo.at(profile, "td", z), p)
			if te < minTe then
				minTe, srcZ = te, z
			end
		end
		local tp = wetBulb(Thermo.at(profile, "t", srcZ), Thermo.at(profile, "td", srcZ))
		local z = srcZ
		while z > 0 do
			local p = Thermo.at(profile, "p", z)
			tp += moistLapse(tp, p) * 100
			z -= 100
		end
		ddDeficit = math.max(0, profile.t[1] - tp)
	end
	-- display composites (Thompson et al. 2003/2004 forms)
	local scp = (mu.cape / 1000) * (srh3 / 50) * math.clamp((shear6 - 10) / 10, 0, 1.5)
	local lclTerm = math.clamp((2000 - ml.lclZ) / 1000, 0, 1)
	local cinTerm = math.clamp((200 + ml.cin) / 150, 0, 1)
	local stp = (ml.cape / 1500) * lclTerm * (srh1 / 150) * math.clamp(shear6 / 20, 0, 1.5) * cinTerm
	if shear6 < 12.5 then
		stp = 0
	end
	return {
		sb = sb,
		ml = ml,
		mu = mu,
		shear01 = math.sqrt((u1 - u0) ^ 2 + (v1 - v0) ^ 2),
		shear06 = shear6,
		shear01u = u1 - u0, shear01v = v1 - v0,
		shear06u = u6 - u0, shear06v = v6 - v0,
		meanU = mwu, meanV = mwv,
		rightU = ru, rightV = rv,
		leftU = lu, leftV = lv,
		srh01 = srh1,
		srh03 = srh3,
		pw = Thermo.precipitableWater(profile),
		freezingZ = levelOf(profile, 0, "t"),
		wetBulbZeroZ = wbz,
		lapse03 = (profile.t[1] - t3) / 3,
		lapse75 = (t7 - t5) / math.max(0.1, (z5 - z7) / 1000),
		thetaE = Thermo.thetaE(profile.t[1], profile.td[1], profile.p[1]),
		surfaceT = profile.t[1],
		surfaceTd = profile.td[1],
		scp = math.max(0, scp),
		stp = math.max(0, stp),
		ddDeficit = ddDeficit,
	}
end

-- Build a profile from a handful of levels by hydrostatic integration (used when the engine
-- sends heights and temperatures but not pressure). levels: { {z, t, td, u, v} ... }, p0 hPa.
function Thermo.build(levels: { { number } }, p0: number): Profile
	local prof: Profile = { z = {}, p = {}, t = {}, td = {}, u = {}, v = {} }
	local p = p0
	for i, l in levels do
		if i > 1 then
			local prev = levels[i - 1]
			local tv = 0.5 * (Thermo.virtualK(prev[2], Thermo.mixingRatio(prev[3], p)) + Thermo.virtualK(l[2], Thermo.mixingRatio(l[3], p)))
			p = p * math.exp(-G * (l[1] - prev[1]) / (RD * tv))
		end
		table.insert(prof.z, l[1])
		table.insert(prof.p, p)
		table.insert(prof.t, l[2])
		table.insert(prof.td, math.min(l[2], l[3]))
		table.insert(prof.u, l[4])
		table.insert(prof.v, l[5])
	end
	return prof
end

-- A copy of a profile with its lowest layers changed to a new surface temperature, dewpoint and
-- wind, blended into the original over `depth` metres (a mixed boundary layer). Used for the
-- environment's horizontal variation and for cold-pool air.
function Thermo.withSurface(profile: Profile, tS: number, tdS: number, uS: number, vS: number, depth: number): Profile
	local out: Profile = { z = profile.z, p = profile.p, t = table.clone(profile.t), td = table.clone(profile.td), u = table.clone(profile.u), v = table.clone(profile.v) }
	local dT, dTd = tS - profile.t[1], tdS - profile.td[1]
	local dU, dV = uS - profile.u[1], vS - profile.v[1]
	for i, z in profile.z do
		if z >= depth then
			break
		end
		local f = 1 - z / depth
		f = f * f * (3 - 2 * f)
		out.t[i] += dT * f
		out.td[i] = math.min(out.t[i], out.td[i] + dTd * f)
		out.u[i] += dU * f
		out.v[i] += dV * f
	end
	return out
end

return Thermo
