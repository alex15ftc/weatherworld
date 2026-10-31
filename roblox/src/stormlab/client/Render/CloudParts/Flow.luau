--!nonstrict
--!native
-- Cloud pieces carried by the storm's own air (2026-10-29). A moving card (CardPlan c.mv: scud,
-- tail cloud, inflow filaments, rising billows) follows a trajectory traced through the same wind
-- field the server simulates (ctx.cw:windAt: environment + cold pool + every storm's updraft,
-- inflow, downdrafts, outflow and rotation), in the frame that carries its layer (the storm's
-- motion; the wall cloud's layer also turns, so its solid turn is taken out). Nothing is scripted:
-- where the air goes, the piece goes.
--
-- Condensation along the path, from the height change dz since the card's planned spot:
--   lifted   the parcel cools toward saturation: more cloud water (opacity x up to 1.25 below
--            the base, 1.1 inside the cloud: it is already saturated there)
--   sinking  it warms (dry adiabat, ~10 K/km) and its droplets evaporate: gone within ~120 m of
--            descent below the base, ~250 m inside the cloud (more water to evaporate)
--   merging  a piece below the base that rises into it joins the base deck: it fades out as it
--            crosses the base (scud drawn up into the wall cloud)
-- A trajectory is one loop of the card's cycle: it is born at its planned spot, carried for P
-- seconds (the time the air takes to carry it its travel: a share of the way to the updraft, or a
-- third of its size up), then fades and is born again. P is kept per card (so a re-trace does not
-- jump the card along its loop).
local Flow = {}

local N = 6 -- path segments (midpoint steps)
local MIN_SPEED = 0.3 -- m/s: slower air leaves the card where it is

local exp, sqrt, max, min, clamp = math.exp, math.sqrt, math.max, math.min, math.clamp

local function ramp(x: number, a: number, b: number): number
	return clamp((x - a) / (b - a), 0, 1)
end

-- the opacity factor of a parcel that started at z0 and is now at z (cloud base `base`)
local function condense(z0: number, z: number, base: number): number
	local dz = z - z0
	local sub = z0 < base - 30
	local f
	if dz >= 0 then
		f = min(if sub then 1.25 else 1.1, exp(dz / 500))
	else
		f = exp(dz / (if sub then 120 else 250))
	end
	if sub then
		f *= 1 - ramp(z, base - 20, base + 120)
	end
	return f
end

-- windAt(x, y, z) -> u, v, w (m/s, map frame). s: the storm (x, y, u, v, base); ox, oy: the
-- layer's centre from the storm's; spin, phase: the layer's turn (rad/s, counter-clockwise) and
-- its angle now (0, 0 for the main layer); t: the motion clock now; c: the card (x, y, z in its
-- layer, mv, ph); P: a period kept from before, or nil.
-- Returns { P, x = {...}, y, z, f } (N + 1 points, layer frame) or nil (the air barely moves).
-- (A turning layer: the air is looked up where the card is on the map at each moment of its
-- current loop - the layer's angle then - and its turn taken out of the motion.)
function Flow.trace(windAt: (number, number, number) -> (number, number, number), s: any, ox: number, oy: number,
	spin: number, phase: number, t: number, c: any, P: number?): any?
	local m = c.mv
	if not m then
		return nil
	end
	local cx, cy = s.x + ox, s.y + oy
	local su, sv = s.u or 0, s.v or 0
	local base = s.base or 1000
	local tauNow = 0 -- (time into the current loop; set once P is known)
	local function vel(x: number, y: number, z: number, tau: number): (number, number, number)
		if spin == 0 then
			local u, v, w = windAt(cx + x, cy + y, z)
			return u - su, v - sv, w
		end
		local a = phase + spin * (tau - tauNow)
		local cs, sn = math.cos(a), math.sin(a)
		local u, v, w = windAt(cx + x * cs - y * sn, cy + x * sn + y * cs, z)
		u -= su
		v -= sv
		-- (into the layer's frame, less its solid turn)
		return u * cs + v * sn + spin * y, -u * sn + v * cs - spin * x, w
	end
	local x, y, z = c.x, c.y, c.z
	local u0, v0, w0 = vel(x, y, z, 0)
	local sp = sqrt(u0 * u0 + v0 * v0 + w0 * w0)
	if sp < MIN_SPEED then
		return nil
	end
	-- how far one loop carries it
	local L
	if m.k == "in" and m.tx then
		L = max(m.pull * sqrt((x - m.tx) ^ 2 + (y - m.ty) ^ 2), 0.3 * max(c.w, c.h))
	else
		L = max(m.rise or 0, 0.35 * max(c.w, c.h))
	end
	P = P or clamp(L / sp, 30, 420)
	local Pn = P :: number
	tauNow = ((t / Pn + (c.ph or 0)) % 1) * Pn
	if spin ~= 0 then
		u0, v0, w0 = vel(x, y, z, 0)
	end
	local dt = Pn / N
	local px, py, pz, pf = { x }, { y }, { z }, { 1 }
	local travelled, stopped = 0, false
	local u, v, w = u0, v0, w0
	for i = 1, N do
		if not stopped then
			-- midpoint step
			local mx, my, mz = x + 0.5 * dt * u, y + 0.5 * dt * v, max(z + 0.5 * dt * w, 5)
			local mu, mv, mw = vel(mx, my, mz, (i - 0.5) * dt)
			local nx, ny, nz = x + dt * mu, y + dt * mv, max(z + dt * mw, 5)
			travelled += sqrt((nx - x) ^ 2 + (ny - y) ^ 2 + (nz - z) ^ 2)
			x, y, z = nx, ny, nz
			-- (a piece carried far past its travel - into the core of the updraft - stops there:
			-- it has joined the cloud it was drawn into; its loop fades it out)
			if travelled > 2.5 * L then
				stopped = true
			elseif i < N then
				u, v, w = vel(x, y, z, i * dt)
			end
		end
		px[i + 1], py[i + 1], pz[i + 1] = x, y, z
		pf[i + 1] = condense(c.z, z, base)
	end
	return { P = P, n = N, x = px, y = py, z = pz, f = pf }
end

-- the point at loop phase phi (0..1): x, y, z, opacity factor
function Flow.at(fl: any, phi: number): (number, number, number, number)
	local t = clamp(phi, 0, 1) * fl.n
	local i = min(math.floor(t), fl.n - 1)
	local a = t - i
	local x, y, z, f = fl.x, fl.y, fl.z, fl.f
	local j = i + 1
	return x[j] + (x[j + 1] - x[j]) * a, y[j] + (y[j + 1] - y[j]) * a, z[j] + (z[j + 1] - z[j]) * a, f[j] + (f[j + 1] - f[j]) * a
end

return Flow
