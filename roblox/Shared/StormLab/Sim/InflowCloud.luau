--!nonstrict
-- Where a storm's inflow cloud can be: the tail cloud (cauda) and the beaver tail (flumen) as the
-- paths their air takes into the storm (docs/stormlab/research/INFLOW-AND-RFD.md).
--
-- Both are air on its way in, so each is a streamline of the storm-relative wind (World.windAt
-- less the storm's motion), traced BACKWARD from where the air enters: the wall cloud's rim for
-- the tail, the updraft's edge at the cloud base for the beaver tail. Cloud is drawn only where
-- that air is condensed:
--   tail         rain-cooled, moistened forward-flank air (Environment.surfaceAt carries the cold
--                pool) whose own condensation level lies under the storm's base. The tail sits at
--                that level, clamped between the wall cloud's base and the main base.
--   beaver tail  the same forward-flank air a little higher, just under the base: inflow whose
--                condensation level the cold pool has lowered below the band's height. (Lifted
--                air was tried first. Past ~4 km from the updraft the air at that height sinks
--                gently, the updraft's compensating ring, so it found only the updraft's own
--                inflow ring, 2026-11-03.)
-- A path stops where its air came out of heavy rain (the precipitation core) or out of sinking
-- air (the downdrafts, the clear slot). Upstream of either it is not inflow, so no inflow cloud can
-- cross the core or the rear flank. The bearing is chosen by the air, not by a rule: of the
-- inbound streamlines round the rim, the one with the longest condensed run attached to the
-- storm wins.
--
-- `world` is a World or a ClientWorld: windAt(x, y, z, true), env:surfaceAt, and the
-- precipitation volume (world.vol on a client, world.precip on the server).
local function dep(name: string): any
	if script then
		return require((script :: any).Parent:FindFirstChild(name))
	end
	return (require :: any)("./" .. name)
end
local Precip = dep("Precip")
local Storm = dep("Storm")

local InflowCloud = {}

InflowCloud.RAIN_MAX = 4 -- mm/h: past this the air is in the rain shafts, not the inflow
-- (for still air. Air being lifted carries more and is still inflow: the rain it may carry grows
-- with its updraft, RAIN_MAX * (1 + w / LIFT_W). The game's rain comes from the cloud model's
-- shared frames, which put 10-50 mm/h all round a mature meso at the wall cloud's rim, inflow side
-- included, so with a still-air limit alone no tail ever formed in the game, user 2026-11-09)
InflowCloud.LIFT_W = 0.5 -- m/s
local function rainLimit(w: number): number
	return InflowCloud.RAIN_MAX * (1 + math.max(w, 0) / InflowCloud.LIFT_W)
end
InflowCloud.rainLimit = rainLimit
InflowCloud.SINK = -0.75 -- m/s: air sinking faster than this is downdraft air
InflowCloud.BEARINGS = 12
local sqrt, cos, sin, max, clamp = math.sqrt, math.cos, math.sin, math.max, math.clamp

local function rainOf(world: any): (number, number) -> number
	local vol = world.vol or world.precip
	if not vol or not vol.nxv then
		return function()
			return 0
		end
	end
	return function(x, y)
		return (Precip.surface(vol, x, y)) or 0
	end
end

-- condensation level (m) of the near-surface air at (x, y), cold pool included
local function lclAt(world: any, x: number, y: number): number
	local t, td = world.env:surfaceAt(x, y)
	return 125 * max(t - td, 0)
end
InflowCloud.lclAt = lclAt

-- One backward streamline at height z from (x, y): storm-relative wind, steps of dt, at most
-- T seconds and L metres. Returns the points from the seed outward, each { x, y, w, rain, sr },
-- and why it stopped ("rain", "sink", "calm", "len").
local function backTrace(world: any, s: any, x: number, y: number, z: number, dt: number, T: number, L: number, rain: (number, number) -> number)
	local su, sv = s.u or 0, s.v or 0
	local pts = {}
	local px, py, run = x, y, 0
	local why = "len"
	for _ = 1, math.ceil(T / dt) do
		local u, v, w = world:windAt(px, py, z, true)
		u -= su
		v -= sv
		local sp = sqrt(u * u + v * v)
		local r = rain(px, py)
		table.insert(pts, { px, py, w, r, sp })
		if r > rainLimit(w) then
			why = "rain"
			break
		end
		if w < InflowCloud.SINK then
			why = "sink"
			break
		end
		if sp < 0.5 then
			why = "calm"
			break
		end
		-- (midpoint step: a streamline curving round the meso stays on its circle)
		local mx, my = px - 0.5 * u * dt, py - 0.5 * v * dt
		local u2, v2 = world:windAt(mx, my, z, true)
		u2 -= su
		v2 -= sv
		px -= u2 * dt
		py -= v2 * dt
		run += sqrt(u2 * u2 + v2 * v2) * dt
		if run > L then
			break
		end
	end
	return pts, why
end
InflowCloud.backTrace = backTrace

-- the longest run of condensed points attached to the seed (gaps of up to `gap` points allowed:
-- the tail's ragged breaks), as a count of points
local function attachedRun(cond: { boolean }, gap: number): number
	local last, miss = 0, 0
	for i, c in cond do
		if c then
			last, miss = i, 0
		else
			miss += 1
			if miss > gap or last == 0 and i > gap then
				break
			end
		end
	end
	return last
end

-- Tail cloud path round the low mesocyclone at (lx, ly): the wall cloud's rim radius R, its base
-- zb and the storm's base. Returns nil (no condensed inflow) or a list of { dx, dy, z }
-- relative to (lx, ly), ordered as the air moves (from the far tip in to the wall cloud), the
-- condensed run's length outside the rim (m), how many of the points lie outside the rim (the
-- rest join the wall cloud), and the air's travel time along the whole path (s).
function InflowCloud.tail(world: any, s: any, lx: number, ly: number, R: number, zb: number, base: number): ({ { number } }?, number, number, number)
	local rain = rainOf(world)
	local D = max(base - zb, 30)
	local zt = zb + 0.5 * D
	local su, sv = s.u or 0, s.v or 0
	local best, bestN, bestLen = nil, 0, 0
	local K = InflowCloud.BEARINGS
	-- (why a tail is missing: read by the renderers' debug prints)
	local dg = { inb = 0, pts = 0, lclOk = 0, rainOk = 0, sinkOk = 0, minLcl = math.huge, base = base, vin = 0, minRain = math.huge, rains = {} }
	InflowCloud.lastDiag = dg
	for k = 0, K - 1 do
		local a = k / K * 2 * math.pi
		local ex, ey = cos(a), sin(a)
		local x0, y0 = lx + ex * R, ly + ey * R
		local u, v = world:windAt(x0, y0, zt, true)
		dg.vin = math.min(dg.vin, (u - su) * ex + (v - sv) * ey)
		-- (inbound air only: it must be on its way into the wall cloud)
		if (u - su) * ex + (v - sv) * ey < -0.5 then
			dg.inb += 1
			local pts = backTrace(world, s, x0, y0, zt, 12, 900, 6000, rain)
			local cond = {}
			for i, p in pts do
				local lcl = lclAt(world, p[1], p[2])
				p[6] = lcl
				cond[i] = lcl < base - 40 and p[4] <= rainLimit(p[3]) and p[3] >= InflowCloud.SINK
				dg.pts += 1
				dg.minLcl = math.min(dg.minLcl, lcl)
				if lcl < base - 40 then dg.lclOk += 1 end
				if p[4] <= rainLimit(p[3]) then dg.rainOk += 1 end
				dg.minRain = math.min(dg.minRain, p[4])
				if i == 1 then table.insert(dg.rains, string.format("%d:%.0f/%.1f", k, p[4], p[3])) end
				if p[3] >= InflowCloud.SINK then dg.sinkOk += 1 end
			end
			local n = attachedRun(cond, 2)
			if n >= 2 then
				local len = 0
				for i = 2, n do
					len += sqrt((pts[i][1] - pts[i - 1][1]) ^ 2 + (pts[i][2] - pts[i - 1][2]) ^ 2)
				end
				if len > bestLen then
					best, bestN, bestLen = pts, n, len
				end
			end
		end
	end
	if InflowCloud.lastDiag then
		InflowCloud.lastDiag.len, InflowCloud.lastDiag.outN = bestLen, bestN
	end
	if not best or bestLen < 500 then
		return nil, 0, 0, 0
	end
	local out = {}
	-- from the tip in to the rim: at the air's own condensation level, under the base
	for i = bestN, 1, -1 do
		local p = best[i]
		table.insert(out, { p[1] - lx, p[2] - ly, clamp(p[6], zb + 0.25 * D, base - 40) })
	end
	-- and on in through the rim, rising into the base: the same air carried forward
	local px, py = best[1][1], best[1][2]
	local travel = 12 * (bestN - 1)
	for _ = 1, 40 do
		travel += 6
		local u, v = world:windAt(px, py, zt, true)
		u -= su
		v -= sv
		px += u * 6
		py += v * 6
		local r = sqrt((px - lx) ^ 2 + (py - ly) ^ 2)
		local z0 = out[#out][3]
		table.insert(out, { px - lx, py - ly, z0 + (base - 40 - z0) * clamp(1 - (r - 0.45 * R) / (0.55 * R), 0, 1) })
		if r < 0.45 * R then
			break
		end
	end
	return out, bestLen, bestN, travel
end

-- Beaver tail path from the updraft's edge at the cloud base. Returns nil or a list of
-- { dx, dy, z } relative to the storm's centre (s.x, s.y), ordered from the updraft outward.
function InflowCloud.band(world: any, s: any, base: number): { { number } }?
	local rain = rainOf(world)
	local _, ux, uy = Storm.wprofAt(s, base)
	local cx, cy = s.x + ux, s.y + uy
	local r0 = Storm.updraftRadiusAt(s, base)
	local zt = base - 60
	local su, sv = s.u or 0, s.v or 0
	local best, bestN, bestLen = nil, 0, 0
	local K = InflowCloud.BEARINGS
	for k = 0, K - 1 do
		local a = k / K * 2 * math.pi
		local ex, ey = cos(a), sin(a)
		local x0, y0 = cx + ex * r0, cy + ey * r0
		local u, v = world:windAt(x0, y0, zt, true)
		if (u - su) * ex + (v - sv) * ey < -0.5 then
			local pts = backTrace(world, s, x0, y0, zt, 30, 1500, 16000, rain)
			local cond = {}
			for i, p in pts do
				cond[i] = lclAt(world, p[1], p[2]) < zt and p[4] <= rainLimit(p[3]) and p[3] >= InflowCloud.SINK
			end
			local n = attachedRun(cond, 2)
			if n >= 2 then
				local len = 0
				for i = 2, n do
					len += sqrt((pts[i][1] - pts[i - 1][1]) ^ 2 + (pts[i][2] - pts[i - 1][2]) ^ 2)
				end
				if len > bestLen then
					best, bestN, bestLen = pts, n, len
				end
			end
		end
	end
	if not best or bestLen < 1500 then
		return nil
	end
	local out = {}
	for i = 1, bestN do
		local p = best[i]
		table.insert(out, { p[1] - s.x, p[2] - s.y, zt })
	end
	return out
end

-- distance along a path's points (for spacing cards along it)
function InflowCloud.length(path: { { number } }): number
	local L = 0
	for i = 2, #path do
		local a, b = path[i - 1], path[i]
		L += sqrt((b[1] - a[1]) ^ 2 + (b[2] - a[2]) ^ 2)
	end
	return L
end

-- the point a share f (0..1) of the way along a path, and the path's direction there
function InflowCloud.along(path: { { number } }, f: number): (number, number, number, number, number)
	local L = InflowCloud.length(path)
	local want, acc = clamp(f, 0, 1) * L, 0
	for i = 2, #path do
		local a, b = path[i - 1], path[i]
		local dl = sqrt((b[1] - a[1]) ^ 2 + (b[2] - a[2]) ^ 2)
		if acc + dl >= want or i == #path then
			local t = if dl > 0 then clamp((want - acc) / dl, 0, 1) else 0
			local d = max(dl, 1e-3)
			return a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t, (b[1] - a[1]) / d, (b[2] - a[2]) / d
		end
		acc += dl
	end
	local p = path[1]
	return p[1], p[2], p[3], 1, 0
end

return InflowCloud
