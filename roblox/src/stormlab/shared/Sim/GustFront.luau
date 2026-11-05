--!strict
-- The rear-flank downdraft's gust front, per storm (docs/stormlab/PHYSICAL-VOLUME-PLAN.md phase 2,
-- STATUS Rounds 43-44, 2026-11-03): the boundary that wraps the low-level mesocyclone and occludes
-- it. The ColdPool grid (2 km) is too coarse for it - the meso is 1-2 km across - so each storm
-- carries its own front, a closed loop of points round the RFD's cold air:
--
--   * each point moves with the cold air's own momentum - the RFD's air came down through the
--     lowest 1.5 km and arrives with about that layer's mean wind - plus the storm's low-level
--     winds there (the forward flank's outflow, the meso's spin as the shallow cold air feels it:
--     Storm.GF_MESO_K of it), plus its own advance c along the outward normal;
--   * c is the RFD outflow's: its downdraft's mass, w pi Rd^2, spreading through a cylinder of the
--     pool's depth, u = w Rd^2 / (2 r h) (continuity), or the cold air's density-current speed
--     (ColdPool.speedOf), whichever is more;
--   * the RFD's source (Storm.step) is where its drivers are: the hook's rain falling and the
--     mid-level flow forced down on the updraft's upwind side, clear of the meso's core;
--   * the triple point is where the front stops facing the forward flank's cold air and starts
--     facing warm inflow - where the next meso forms.
--
-- The meso, while warm inflow reaches it, moves with the storm: it is the circulation the updraft
-- keeps making on its rear edge, not a material vortex (tracked as one in the sim's kinematic
-- winds, it was blown off at ~12 m/s). Once the front has overrun it, its lower part sits in cold,
-- stable air that can't rise and is pushed along with the outflow. The occlusion is how far into
-- that cold air it sits, against its diameter, or how far it has been left from the updraft;
-- Storm.step cycles at 1: a new meso at the triple point. Nothing here is a clock: a weak downdraft
-- against strong inflow never overruns its meso (a steady supercell), a strong one wraps it in
-- 10-20 min.
local function dep(name: string): any
	if script then
		return require((script :: any).Parent:FindFirstChild(name))
	end
	return (require :: any)("./" .. name)
end
local ColdPool = dep("ColdPool")

local GustFront = {}

local SP = 250 -- m: the loop's point spacing
local NMAX = 240 -- points at most (the spacing grows past that)
local Z = 150 -- m: the height whose wind carries the front (the outflow's depth ~0.5 km)
local MESO_DEPTH = 1500 -- m: the low-level meso's depth (CloudField's lowering reaches as far)
local PROBE = 400 -- m: how far out past the front its outside air is read
local FFD_EDGE = 1.5 -- K: the forward flank's cold air (its gust front: Systems' contour level)
local REACH = 2.5 -- Ru: the front is followed this far from the storm; past it its air is the
-- general cold pool's (ColdPool's grid), so points are held there
local sqrt, exp, max, min, clamp, abs = math.sqrt, math.exp, math.max, math.min, math.clamp, math.abs

-- the RFD downdraft's radius (as Storm.windAt's) and the outflow's depth
function GustFront.rfdRadius(s: any): number
	return 0.35 * (s.Ru or 3000)
end
local function rfdRadius(s: any): number
	return 0.35 * (s.Ru or 3000)
end

-- A new front: a loop round the RFD's source at the downdraft's radius; the meso at (mx, my).
-- src: the source's offset from the storm centre, fixed while this meso lasts.
function GustFront.new(s: any, mx: number, my: number, sx: number, sy: number): any
	-- (the front starts at the downdraft's own edge - its outflow has yet to spread)
	local r0 = rfdRadius(s)
	local n = clamp(math.ceil(2 * math.pi * r0 / SP), 12, NMAX)
	local a0 = math.atan2(my - sy, mx - sx)
	local pts = table.create(2 * n, 0)
	for i = 0, n - 1 do
		local a = a0 + 2 * math.pi * i / n
		pts[2 * i + 1] = sx + r0 * math.cos(a)
		pts[2 * i + 2] = sy + r0 * math.sin(a)
	end
	return {
		pts = pts,
		n = n,
		mx = mx,
		my = my,
		sox = sx - s.x,
		soy = sy - s.y,
		occl = 0,
		jx = mx,
		jy = my,
		age = 0,
	}
end

-- the outward normal at point i (the loop runs counter-clockwise: cold air on the left)
local function normalAt(pts: { number }, n: number, i: number): (number, number)
	local ia = (i - 2) % n
	local ib = i % n
	local ax, ay = pts[2 * ia + 1], pts[2 * ia + 2]
	local bx, by = pts[2 * ib + 1], pts[2 * ib + 2]
	local tx, ty = bx - ax, by - ay
	local m = sqrt(tx * tx + ty * ty)
	if m < 1e-6 then
		return 0, 0
	end
	-- (counter-clockwise: the outward normal is the tangent turned clockwise)
	return ty / m, -tx / m
end

-- the outflow's depth: the cold air's (ColdPool.depthOf) or, at least, the downdraft's own wall jet's
-- - continuity at its edge, pi Rd^2 w = 2 pi Rd h w, gives h = Rd / 2 (a nearly warm, dynamically
-- forced RFD is not shallow because its deficit is small)
local function outflowDepth(s: any): number
	local d = max(s.rfdArrival or 0, s.rfdDeficit or 0, 0)
	return max(ColdPool.depthOf(d), 0.5 * rfdRadius(s))
end

-- the front's own advance at (x, y): the RFD outflow's speed there
local function advance(s: any, f: any, x: number, y: number): number
	local sx, sy = s.x + f.sox, s.y + f.soy
	local r = max(sqrt((x - sx) ^ 2 + (y - sy) ^ 2), 1)
	local d = max(s.rfdArrival or 0, s.rfdDeficit or 0, 0)
	local h = outflowDepth(s)
	local Rd = rfdRadius(s)
	local w = max(s.rfd or 0, 0)
	local jet = w * Rd * Rd / (2 * max(r, Rd) * h)
	return max(jet, ColdPool.speedOf(d))
end

-- keep the loop evenly spaced (and counter-clockwise)
local function resample(f: any)
	local pts, n = f.pts, f.n
	-- perimeter
	local L = 0
	for i = 0, n - 1 do
		local j = (i + 1) % n
		L += sqrt((pts[2 * j + 1] - pts[2 * i + 1]) ^ 2 + (pts[2 * j + 2] - pts[2 * i + 2]) ^ 2)
	end
	local m = clamp(math.ceil(L / SP), 12, NMAX)
	local sp = L / m
	local out = table.create(2 * m, 0)
	local acc, k = 0, 0
	local i = 0
	local ax, ay = pts[1], pts[2]
	local want = 0
	while k < m and i < n do
		local j = (i + 1) % n
		local bx, by = pts[2 * j + 1], pts[2 * j + 2]
		local seg = sqrt((bx - ax) ^ 2 + (by - ay) ^ 2)
		if acc + seg >= want - 1e-9 and seg > 0 then
			local t = (want - acc) / seg
			out[2 * k + 1] = ax + (bx - ax) * t
			out[2 * k + 2] = ay + (by - ay) * t
			k += 1
			want += sp
		else
			acc += seg
			i += 1
			ax, ay = bx, by
		end
	end
	while k < m do
		out[2 * k + 1], out[2 * k + 2] = out[2 * k - 1], out[2 * k]
		k += 1
	end
	f.pts, f.n = out, m
	-- (signed area: keep counter-clockwise)
	local a = 0
	for q = 0, m - 1 do
		local r = (q + 1) % m
		a += out[2 * q + 1] * out[2 * r + 2] - out[2 * r + 1] * out[2 * q + 2]
	end
	if a < 0 then
		local rev = table.create(2 * m, 0)
		for q = 0, m - 1 do
			rev[2 * q + 1], rev[2 * q + 2] = out[2 * (m - 1 - q) + 1], out[2 * (m - 1 - q) + 2]
		end
		f.pts = rev
	end
end

-- the nearest point of the loop to (x, y): its position and arc coordinate (m from point 0)
local function project(f: any, x: number, y: number): (number, number, number)
	local pts, n = f.pts, f.n
	local best, bx, by, bs = math.huge, x, y, 0
	local acc = 0
	for i = 0, n - 1 do
		local j = (i + 1) % n
		local ax, ay = pts[2 * i + 1], pts[2 * i + 2]
		local cx, cy = pts[2 * j + 1], pts[2 * j + 2]
		local ex, ey = cx - ax, cy - ay
		local l2 = ex * ex + ey * ey
		local t = if l2 > 0 then clamp(((x - ax) * ex + (y - ay) * ey) / l2, 0, 1) else 0
		local px, py = ax + ex * t, ay + ey * t
		local d = (px - x) ^ 2 + (py - y) ^ 2
		if d < best then
			best, bx, by, bs = d, px, py, acc + t * sqrt(l2)
		end
		acc += sqrt(l2)
	end
	return bx, by, bs
end

-- Advance the front dt s. ctx:
--   wind(x, y, z): the air the front's cold side moves with (ground-relative, without the RFD's own
--     outflow - c stands for it);
--   ffdCold(x, y): the forward flank's cold air there (K: the cold pool's deficit not from the RFD).
-- Updates the front, f.jx/jy (the triple point, where a meso can form), f.mx/my (the meso) and
-- f.occl.
function GustFront.step(s: any, f: any, dt: number, ctx: any)
	f.age += dt
	f.mesoAge = (f.mesoAge or 0) + dt
	local windAt = ctx.wind
	local pts, n = f.pts, f.n
	local new = table.create(2 * n, 0)
	local su, sv = s.u or 0, s.v or 0
	local ux, uy = s.x, s.y
	local Ru = s.Ru or 3000
	local Rl = 0.3 * Ru
	local srcX, srcY = s.x + f.sox, s.y + f.soy
	local Rd = rfdRadius(s)
	-- the fallback occlusion point's weights: storm-relative inflow running into the front, near
	-- the updraft (before the forward flank has cold air of its own)
	local wsum, wx, wy = 0, 0, 0
	local nearD, nearX, nearY = math.huge, ux, uy
	for i = 1, n do
		local x, y = pts[2 * i - 1], pts[2 * i]
		local nx, ny = normalAt(pts, n, i)
		local u, v = windAt(x, y, Z)
		local c = advance(s, f, x, y)
		local x2, y2 = x + (u + c * nx) * dt, y + (v + c * ny) * dt
		-- (the downdraft keeps laying cold air down over its own radius: the front is never
		-- inside it - the loop moves on with the storm's RFD)
		do
			local qx, qy = x2 - srcX, y2 - srcY
			local qm = sqrt(qx * qx + qy * qy)
			if qm < Rd then
				if qm < 1 then
					qx, qy, qm = nx, ny, 1
				end
				x2, y2 = srcX + qx / qm * Rd, srcY + qy / qm * Rd
			end
		end
		local ox, oy = x2 - ux, y2 - uy
		local om = sqrt(ox * ox + oy * oy)
		if om > REACH * Ru then
			x2, y2 = ux + ox / om * REACH * Ru, uy + oy / om * REACH * Ru
		end
		new[2 * i - 1] = x2
		new[2 * i] = y2
		local q = -((u - su) * nx + (v - sv) * ny)
		local d2 = ((x - ux) ^ 2 + (y - uy) ^ 2) / (Ru * Ru)
		if d2 < nearD then
			nearD, nearX, nearY = d2, x, y
		end
		if q > 0 and d2 < 1.44 then
			local wgt = q * q * exp(-d2)
			wsum += wgt
			wx += wgt * x
			wy += wgt * y
		end
	end
	f.pts = new
	resample(f)
	pts, n = f.pts, f.n
	-- the triple point: where the RFD's front stops facing the forward flank's cold air and starts
	-- facing warm inflow - the end of the forward-flank gust front on the RFD's. The low-level
	-- meso forms and is fed there, where the forward flank's baroclinic horizontal vorticity is
	-- tilted and stretched by the updraft over it (Lemon & Doswell 1979; Markowski & Richardson
	-- 2010 ch. 8). Of the front's warm-to-cold junctions, the one nearest the updraft (the other
	-- end of the forward flank's contact is far behind it).
	local tpD, tpX, tpY = math.huge, 0, 0
	do
		local cold = table.create(n, false)
		for i = 1, n do
			local nx, ny = normalAt(pts, n, i)
			cold[i] = ctx.ffdCold(pts[2 * i - 1] + nx * PROBE, pts[2 * i] + ny * PROBE) > FFD_EDGE
		end
		for i = 1, n do
			local j = i % n + 1
			if cold[i] ~= cold[j] then
				-- (the warm point of the pair)
				local k = if cold[i] then j else i
				local x, y = pts[2 * k - 1], pts[2 * k]
				local d2 = ((x - ux) ^ 2 + (y - uy) ^ 2) / (Ru * Ru)
				if d2 < tpD then
					tpD, tpX, tpY = d2, x, y
				end
			end
		end
	end
	f.tp = tpD < 2.25 -- (a triple point within the updraft's reach, 1.5 Ru)
	if f.tp then
		f.jx, f.jy = tpX, tpY
	elseif wsum > 0 then
		local jx, jy = project(f, wx / wsum, wy / wsum)
		f.jx, f.jy = jx, jy
	else
		f.jx, f.jy = nearX, nearY
	end
	-- the meso. While warm inflow reaches it, it is not a material vortex drifting in the wind: it
	-- is the circulation the updraft keeps making where it tilts and stretches the inflow's and the
	-- boundary's horizontal vorticity, so it moves with the storm. (Tracked as a vortex in the air
	-- round it - carried by its depth's mean wind with the updraft's inflow, propagating up its
	-- stretching gradient - it was blown off the updraft's rear at ~12 m/s, 2026-11-03: the sim's
	-- kinematic updraft draws in ~4 m/s at the meso, where a real one stalls the inflow.) Overrun
	-- by the RFD's outflow, the cold, stable air under it can't rise: its lower part (the
	-- outflow's share of its depth) is no longer made there, and is pushed along with the outflow.
	local inside, depth = GustFront.inside(f, f.mx, f.my)
	if inside then
		local px, py = f.mx, f.my
		local sx, sy = s.x + f.sox, s.y + f.soy
		local rx, ry = px - sx, py - sy
		local rm = max(sqrt(rx * rx + ry * ry), 1)
		local c = advance(s, f, px, py)
		local u, v = windAt(px, py, Z)
		local kf = clamp(outflowDepth(s) / MESO_DEPTH, 0, 1)
		f.mx += (su + kf * (u - su + c * rx / rm)) * dt
		f.my += (sv + kf * (v - sv + c * ry / rm)) * dt
	else
		f.mx += su * dt
		f.my += sv * dt
		-- (and it is made where the updraft stretches the front's spin: where the RFD's gust front
		-- runs under the updraft's low-level core - the front's nearest point to it (Lemon & Doswell
		-- 1979; Markowski & Richardson 2010 ch. 8). It settles there over the circulation's ~5 min
		-- response, as the RFD's source does. Carried only with the storm, a new meso formed at the
		-- occlusion point 1.5 Ru out stayed there an hour - in colder air, barely stretched, its spin
		-- falling to a quarter of a steady storm's and never another tornado, 2026-11-03)
		local up = ctx.updraftLow
		if up then
			local tx, ty = project(f, up[1], up[2])
			local k = 1 - exp(-dt / 300)
			f.mx += (tx - f.mx) * k
			f.my += (ty - f.my) * k
		end
	end
	f.depth = if inside then depth else -depth
	-- the occlusion: how far into the outflow the meso sits, against its diameter (its whole
	-- circulation in cold air, cut off from the warm inflow) - or how far it has been left from the
	-- updraft (its inflow reaches ~1.5 Ru; by 2.25 Ru it is on its own), whichever is further
	local jdx, jdy = f.jx - f.mx, f.jy - f.my
	f.sep = sqrt(jdx * jdx + jdy * jdy)
	local dU = sqrt((f.mx - ux) ^ 2 + (f.my - uy) ^ 2) / Ru
	f.occl = max(if inside then clamp(depth / (2 * Rl), 0, 1) else 0, clamp((dU - 1.5) / 0.75, 0, 1))
	local L = 0
	for i = 0, n - 1 do
		local j = (i + 1) % n
		L += sqrt((pts[2 * j + 1] - pts[2 * i + 1]) ^ 2 + (pts[2 * j + 2] - pts[2 * i + 2]) ^ 2)
	end
	f.perim = L
end

-- whether (x, y) is inside the front (in the RFD's cold air), and its distance to the front
function GustFront.inside(f: any, x: number, y: number): (boolean, number)
	local pts, n = f.pts, f.n
	local inside = false
	local j = n - 1
	for i = 0, n - 1 do
		local xi, yi = pts[2 * i + 1], pts[2 * i + 2]
		local xj, yj = pts[2 * j + 1], pts[2 * j + 2]
		if (yi > y) ~= (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi then
			inside = not inside
		end
		j = i
	end
	local px, py = project(f, x, y)
	return inside, sqrt((px - x) ^ 2 + (py - y) ^ 2)
end

-- A new meso at the occlusion point (Storm.step's cycle): the front goes on
function GustFront.newMeso(f: any)
	f.mx, f.my = f.jx, f.jy
	f.occl, f.depth = 0, 0
	f.mesoAge = 0
end

-- the source of the RFD for this front (world)
function GustFront.source(s: any, f: any): (number, number)
	return s.x + f.sox, s.y + f.soy
end

GustFront.SP, GustFront.Z = SP, Z
return GustFront
