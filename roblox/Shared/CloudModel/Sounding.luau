--!strict
-- Base-state soundings for the cloud model. Each returns, for height z (m): potential temperature
-- (K), relative humidity (0..1) and the environmental wind (m/s, ground-relative).
--
-- WK82: Weisman & Klemp (1982) analytic sounding, the standard supercell test case:
--   theta = theta0 + (theta_tr - theta0) (z / z_tr)^1.25 below the tropopause (z_tr 12 km,
--   theta0 300 K, theta_tr 343 K), isothermal (T_tr 213 K) above; RH = 1 - 0.75 (z / z_tr)^1.25,
--   0.25 above; mixing ratio capped at qv0 (14 g/kg) - the well-mixed moist boundary layer.
-- Wind: the quarter-circle hodograph of the CM1 supercell test (radius 7 m/s turning through 2 km,
--   then straight to Us at 6 km), the shear that favours the right-moving storm. hodoR / hodoD set
--   the low-level curve's radius (m/s) and depth (m): a tighter, stronger low-level curve is the
--   tornadic environment (large 0-1 km storm-relative helicity), e.g. 10-12 m/s over 1 km.
local Sounding = {}

export type Sounding = {
	theta: (z: number) -> number,
	rh: (z: number) -> number,
	wind: (z: number) -> (number, number),
	qvMax: number,
	psfc: number,
}

function Sounding.wk82(opts: { qv0: number?, us: number?, theta0: number?, hodoR: number?, hodoD: number? }?): Sounding
	local o = opts or {}
	local th0 = o.theta0 or 300
	local thtr, ztr, Ttr = 343, 12000, 213
	local us = o.us or 31
	local R, D = o.hodoR or 7, o.hodoD or 2000
	return {
		theta = function(z)
			if z <= ztr then
				return th0 + (thtr - th0) * (z / ztr) ^ 1.25
			end
			return thtr * math.exp(9.81 * (z - ztr) / (1004 * Ttr))
		end,
		rh = function(z)
			if z <= ztr then
				return 1 - 0.75 * (z / ztr) ^ 1.25
			end
			return 0.25
		end,
		wind = function(z)
			if z <= D then
				local a = 0.5 * math.pi * z / D
				return R - R * math.cos(a), R * math.sin(a)
			elseif z <= 6000 then
				return R + (us - R) * (z - D) / (6000 - D), R
			end
			return us, R
		end,
		qvMax = o.qv0 or 0.014,
		psfc = 100000,
	}
end

-- Right-moving supercell motion from the wind profile (Bunkers et al. 2000, the internal dynamics
-- method): the 0-6 km mean wind plus 7.5 m/s to the right of the 0-6 km shear (0-0.5 km mean to
-- 5.5-6 km mean). A starting frame for the model; its storm following corrects the rest.
function Sounding.bunkers(snd: Sounding): (number, number)
	local function mean(z1: number, z2: number): (number, number)
		local su, sv, n = 0, 0, 0
		for z = z1, z2, 50 do
			local u, v = snd.wind(z)
			su += u
			sv += v
			n += 1
		end
		return su / n, sv / n
	end
	local mu, mv = mean(0, 6000)
	local lu, lv = mean(0, 500)
	local hu, hv = mean(5500, 6000)
	local sx, sy = hu - lu, hv - lv
	local s = math.sqrt(sx * sx + sy * sy)
	if s < 1e-6 then
		return mu, mv
	end
	return mu + 7.5 * sy / s, mv - 7.5 * sx / s
end

-- An engine sounding (js/game/LabWindow.js rows, surface first: { p hPa, T C, Td C, u, v m/s
-- ground-relative }) as the model's base state. Heights above the ground from the hypsometric
-- equation (virtual temperature); theta and relative humidity per row, linear in height between
-- rows; above the top row theta keeps its top lapse and the humidity and wind stay.
function Sounding.fromProfile(rows: { { number } }): Sounding
	local RD, G, KAPPA, EPS = 287.04, 9.81, 287.04 / 1004, 0.622
	local function es(tc: number): number -- saturation vapour pressure (hPa), Bolton 1980
		return 6.112 * math.exp(17.67 * tc / (tc + 243.5))
	end
	local zs, ths, rhs, us, vs = {}, {}, {}, {}, {}
	local z = 0
	for n, r in rows do
		local p, t, td = r[1], r[2], r[3]
		if n > 1 then
			local q = rows[n - 1]
			local function tv(row: { number }): number
				local e = es(row[3])
				local w = EPS * e / (row[1] - e)
				return (row[2] + 273.15) * (1 + 0.61 * w)
			end
			z += RD * 0.5 * (tv(q) + tv(r)) / G * math.log(q[1] / p)
		end
		zs[n] = z
		ths[n] = (t + 273.15) * (1000 / p) ^ KAPPA
		rhs[n] = math.clamp(es(td) / es(t), 0.01, 1)
		us[n], vs[n] = r[4], r[5]
	end
	local nr = #rows
	local function at(arr: { number }, zz: number, extrapolate: boolean): number
		if zz <= zs[1] then
			return arr[1]
		end
		for n = 2, nr do
			if zz <= zs[n] then
				local a = (zz - zs[n - 1]) / (zs[n] - zs[n - 1])
				return arr[n - 1] + a * (arr[n] - arr[n - 1])
			end
		end
		if extrapolate then
			local g = (arr[nr] - arr[nr - 1]) / (zs[nr] - zs[nr - 1])
			return arr[nr] + g * (zz - zs[nr])
		end
		return arr[nr]
	end
	return {
		theta = function(zz)
			return at(ths, zz, true)
		end,
		rh = function(zz)
			return at(rhs, zz, false)
		end,
		wind = function(zz)
			return at(us, zz, false), at(vs, zz, false)
		end,
		qvMax = 1, -- (no cap: the profile's own moisture)
		psfc = rows[1][1] * 100,
		ztop = zs[nr],
	}
end

return Sounding
