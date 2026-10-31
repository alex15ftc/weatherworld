--!nonstrict
--!native
-- Convective systems (guide section 12): squall lines, bow echoes and their circulations are
-- modelled as the system, not as a row of storms. The leading edge L(s, t) is the cold pool's
-- gust front (ColdPool.contours), resampled every 5 km into segments that keep their own state
-- from one analysis to the next (matched by position):
--   c        cold-pool (density current) speed from the deficit behind the segment
--   du       line-normal 0-3 km shear; r = c / du is the cold-pool / shear balance (RKW):
--            r ~ 1 upright, deep lifting; r >> 1 the outflow races ahead (the line tilts back)
--   active   updraft strength along the segment (the cells riding it)
--   rij      rear-inflow jet: builds as the system matures and a precipitation shield fills in
--            behind; where the cold pool dominates it descends and surges the outflow, pushing
--            that part of the line ahead: a bow
--   bow      the segment's lead over the chord of its neighbours (m)
-- Mesovortices form on balanced, bowing segments with enough line-normal shear and low-level
-- helicity (a separate tornado pathway from supercells); bookend vortices at the ends of strongly
-- surging lines (cyclonic at the left end facing the motion).
local function dep(name: string): any
	if script then
		return require((script :: any).Parent:FindFirstChild(name))
	end
	return (require :: any)("./" .. name)
end
local ColdPool = dep("ColdPool")
local Noise = dep("Noise")

local Systems = {}

local sqrt, exp = math.sqrt, math.exp
local SPACING = 5000
local LEVEL = 1.5 -- K: the gust front contour

local function ramp(x: number, a: number, b: number): number
	return math.clamp((x - a) / (b - a), 0, 1)
end

export type Segment = { [string]: any }
export type System = { [string]: any }

local nextSystem, nextVortex = 0, 0

-- Resample a polyline at a fixed spacing; returns points with unit tangents.
local function resample(line: { { number } }, spacing: number): { { number } }
	local out = {}
	local carry = 0
	for i = 1, #line - 1 do
		local a, b = line[i], line[i + 1]
		local dx, dy = b[1] - a[1], b[2] - a[2]
		local len = sqrt(dx * dx + dy * dy)
		if len > 1e-6 then
			local s = carry
			while s <= len do
				table.insert(out, { a[1] + dx * s / len, a[2] + dy * s / len, dx / len, dy / len })
				s += spacing
			end
			carry = s - len
		end
	end
	return out
end

local function polylineLength(line: { { number } }): number
	local L = 0
	for i = 1, #line - 1 do
		L += sqrt((line[i + 1][1] - line[i][1]) ^ 2 + (line[i + 1][2] - line[i][2]) ^ 2)
	end
	return L
end

function Systems.new(): { [string]: any }
	return { systems = {}, vortices = {}, fronts = {}, t = 0 }
end

local function maxRij(sys: System): number
	local m = 0
	for _, seg in sys.segments do
		m = math.max(m, seg.rij)
	end
	return m
end

-- Re-analyse the gust fronts and update every segment's state. dt: time since the last call.
function Systems.analyse(S: { [string]: any }, world: any, dt: number)
	local cp, env = world.coldPool, world.env
	S.t += dt
	local lines = cp:contours(LEVEL)
	if world.pause then
		world:pause()
	end
	-- previous segments, for matching state
	local prev = {}
	for _, sys in S.systems do
		for _, seg in sys.segments do
			table.insert(prev, seg)
		end
	end
	local systems = {}
	local fronts = {}
	for _, line in lines do
		local L = polylineLength(line)
		if L >= 30000 then
			local pts = resample(line, SPACING)
			local segs = {}
			for _, p in pts do
				local x, y, tx, ty = p[1], p[2], p[3], p[4]
				-- cold side on the left of the walking direction -> outward (warm side) on the right
				local nx, ny = ty, -tx
				-- the pool behind drives the front: its strongest deficit 4-16 km back
				local dBehind = 0
				for _, back in { 4000, 8000, 12000, 16000 } do
					dBehind = math.max(dBehind, cp.D:sample(x - nx * back, y - ny * back))
				end
				local c = ColdPool.speedOf(dBehind)
				local u0, v0 = env:windAt(x + nx * 8000, y + ny * 8000, 0)
				local u3, v3 = env:windAt(x + nx * 8000, y + ny * 8000, 3000)
				local u1, v1 = env:windAt(x + nx * 8000, y + ny * 8000, 1000)
				local du = (u3 - u0) * nx + (v3 - v0) * ny
				local ulow = 0.5 * ((u0 + u1) * nx + (v0 + v1) * ny)
				local seg: Segment = {
					x = x, y = y, nx = nx, ny = ny, tx = tx, ty = ty,
					deficit = dBehind, c = c, du = du, r = c / math.max(2, du),
					uLow = ulow,
					speed = math.max(0, c + 0.5 * ulow),
					rij = 0, age = 0, bow = 0, active = 0,
				}
				-- inherit state from the nearest previous segment
				local best, bd = nil, (8000) ^ 2
				for _, q in prev do
					local d = (q.x - x) ^ 2 + (q.y - y) ^ 2
					if d < bd then
						best, bd = q, d
					end
				end
				if best then
					seg.rij = best.rij
					seg.age = best.age + dt
					seg.id = best.id
				end
				seg.id = seg.id or (S.t * 1000 + #segs)
				table.insert(segs, seg)
			end
			-- convective activity along the front: cells within 15 km behind / 8 km ahead
			local total = 0
			for _, seg in segs do
				local a = 0
				for _, st in world.storms do
					if not st.dead and st.W > 4 then
						local dx, dy = st.x - seg.x, st.y - seg.y
						local along = dx * seg.tx + dy * seg.ty
						local across = dx * seg.nx + dy * seg.ny
						if math.abs(along) < 0.75 * SPACING + st.Ru and across > -15000 and across < 8000 then
							a += st.W
						end
					end
				end
				seg.active = a
				seg.precipBehind = world.precip.rainRate:sample(seg.x - seg.nx * 15000, seg.y - seg.ny * 15000)
				total += a
			end
			local front = { points = segs, length = L, convective = total }
			table.insert(fronts, front)
			-- The contour runs right round the cold pool; the system is only its LEADING edge:
			-- runs of segments with convection riding them (or advancing fast into unstable air),
			-- allowing single-segment gaps.
			for _, seg in segs do
				local cape = env:field("mlcape", seg.x + seg.nx * 10000, seg.y + seg.ny * 10000)
				seg.leading = seg.active > 0 or (seg.speed > 8 and cape > 500)
			end
			local runs, cur = {}, {}
			for i, seg in segs do
				local gap = not seg.leading and segs[i - 1] and segs[i - 1].leading and segs[i + 1] and segs[i + 1].leading
				if seg.leading or gap then
					table.insert(cur, seg)
				else
					if #cur > 0 then
						table.insert(runs, cur)
					end
					cur = {}
				end
			end
			if #cur > 0 then
				table.insert(runs, cur)
			end
			for _, run in runs do
				local runLen = (#run - 1) * SPACING
				local act = 0
				for _, seg in run do
					act += seg.active
				end
				-- bowing: a segment's lead over the chord of its neighbours 4 segments away,
				-- relative to the run's typical curvature (a bulge, not the pool's roundness)
				local leads = {}
				for i, seg in run do
					local a, b = run[math.max(1, i - 4)], run[math.min(#run, i + 4)]
					local lead = 0
					if a ~= b then
						local mx, my = (a.x + b.x) / 2, (a.y + b.y) / 2
						lead = (seg.x - mx) * seg.nx + (seg.y - my) * seg.ny
					end
					seg.lead = lead
					table.insert(leads, lead)
				end
				table.sort(leads)
				local median = leads[math.max(1, #leads // 2)] or 0
				for _, seg in run do
					seg.bow = seg.lead - median
				end
				if runLen >= 40000 and act > 100 then
					local sys: System = { segments = run, length = runLen, convective = act }
				-- keep the identity of the earlier system most of its segments lie on (within
				-- 12 km: the front moves well under that between analyses)
				local bestOld, bestShare = nil, 0.3
				for _, old in S.systems do
					if not old.claimed then
						local shared = 0
						for _, seg in run do
							for _, os in old.segments do
								if (os.x - seg.x) ^ 2 + (os.y - seg.y) ^ 2 < 12000 ^ 2 then
									shared += 1
									break
								end
							end
						end
						local share = shared / #run
						if share > bestShare then
							bestOld, bestShare = old, share
						end
					end
				end
				if bestOld then
					bestOld.claimed = true
					sys.id = bestOld.id
					sys.age = bestOld.age + dt
				end
				if not sys.id then
					nextSystem += 1
					sys.id = string.format("L%02d", nextSystem)
					sys.age = 0
				end
				table.insert(systems, sys)
				end
			end
		end
	end
	for _, old in S.systems do
		old.claimed = nil
	end
	S.systems = systems
	S.fronts = fronts

	-- segment dynamics: rear inflow jet, its descent (surges), the cells riding the front
	for _, sys in systems do
		local maturity = ramp(sys.age, 600, 3600)
		local maxBow = 0
		for _, seg in sys.segments do
			local shield = ramp(seg.precipBehind or 0, 1, 12)
			local target = 0.75 * seg.c * maturity * shield * ramp(seg.active, 20, 80)
			seg.rij += (target - seg.rij) * (1 - exp(-dt / 900))
			-- a cold-pool-dominant segment brings the jet down to the ground behind the front
			local descend = ramp(seg.r, 0.9, 1.8)
			if seg.rij > 3 and descend > 0 then
				local bx, by = seg.x - seg.nx * 5000, seg.y - seg.ny * 5000
				cp:addSurge(bx, by, 7000, seg.nx * seg.rij * descend, seg.ny * seg.rij * descend, 0.08 * dt / 30)
			end
			maxBow = math.max(maxBow, seg.bow)
		end
		sys.bow = maxBow
		local segs = sys.segments
		sys.mode = if maxBow > 5000 and maxRij(sys) > 6 then "bow echo" elseif sys.length > 120000 then "squall line" else "line segment"
		-- bookend vortices: where a strongly surging line ends
		local function endRij(i0: number, i1: number): number
			local m = 0
			for i = i0, i1 do
				if segs[i] then
					m = math.max(m, segs[i].rij)
				end
			end
			return m
		end
		sys.bookendLeft = if #segs > 4 then endRij(1, 4) else 0
		sys.bookendRight = if #segs > 4 then endRij(#segs - 3, #segs) else 0
	end

	-- cells caught by a front ride with it
	for _, st in world.storms do
		st.lineU, st.lineV, st.lineShare, st.systemId = nil, nil, nil, nil
		if not st.dead then
			local bestSeg, bestD, bestSys = nil, math.huge, nil
			for _, sys in systems do
				for _, seg in sys.segments do
					local dx, dy = st.x - seg.x, st.y - seg.y
					local d = dx * dx + dy * dy
					if d < bestD then
						bestSeg, bestD, bestSys = seg, d, sys
					end
				end
			end
			if bestSeg and bestD < 15000 ^ 2 then
				local across = (st.x - bestSeg.x) * bestSeg.nx + (st.y - bestSeg.y) * bestSeg.ny
				if across > -15000 and across < 6000 then
					-- ground-relative front motion = density current + half the low-level wind
					local eu, ev = env:windAt(bestSeg.x, bestSeg.y, 500)
					local along = eu * bestSeg.tx + ev * bestSeg.ty
					st.lineU = bestSeg.nx * bestSeg.speed + bestSeg.tx * along * 0.7
					st.lineV = bestSeg.ny * bestSeg.speed + bestSeg.ty * along * 0.7
					st.lineShare = 0.75 * (1 - st.rot * 0.7) -- rotating cells keep more of their own motion
					st.systemId = bestSys.id
				end
			end
		end
	end

	Systems.updateVortices(S, world, dt)
end

-- Mesovortices along the systems' segments, and bookend vortices at their ends.
function Systems.updateVortices(S: { [string]: any }, world: any, dt: number)
	local env, cp = world.env, world.coldPool
	local rng = S.rng
	if not rng then
		rng = Noise.rng(424242)
		S.rng = rng
	end
	-- genesis
	for _, sys in S.systems do
		for i, seg in sys.segments do
			local srh = env:field("srh01", seg.x + seg.nx * 10000, seg.y + seg.ny * 10000)
			local balanced = 1 - math.clamp(math.abs(seg.r - 1.1) / 0.7, 0, 1)
			local shear = ramp(seg.du, 10, 22)
			local surge = math.max(ramp(seg.rij, 5, 18), ramp(seg.bow, 2000, 8000))
			local tendency = balanced * shear * ramp(srh, 60, 250) * (0.3 + 0.7 * surge)
			seg.mvTendency = tendency
			if tendency > 0.15 then
				-- one at a time per stretch of line
				local near = false
				for _, v in S.vortices do
					if not v.dead and (v.x - seg.x) ^ 2 + (v.y - seg.y) ^ 2 < 18000 ^ 2 then
						near = true
						break
					end
				end
				if not near and rng:next() < tendency * dt / 900 then
					nextVortex += 1
					table.insert(S.vortices, {
						id = string.format("M%02d", nextVortex), kind = "mesovortex", systemId = sys.id,
						x = seg.x - seg.nx * 2500, y = seg.y - seg.ny * 2500,
						u = seg.nx * seg.speed, v = seg.ny * seg.speed,
						vlow = 2, rlow = rng:range(2000, 4000), age = 0, seed = nextVortex * 131,
						segId = seg.id, cyclonic = true, G = 0,
					})
				end
			end
			local _ = i
		end
		-- bookends (cyclonic at the left end facing the motion, anticyclonic at the right)
		local segs = sys.segments
		for side = 1, 2 do
			local strength = if side == 1 then sys.bookendLeft else sys.bookendRight
			local seg = if side == 1 then segs[1] else segs[#segs]
			local key = sys.id .. (if side == 1 then "L" else "R")
			local existing = nil
			for _, v in S.vortices do
				if v.bookend == key and not v.dead then
					existing = v
				end
			end
			if seg and strength > 9 and not existing then
				nextVortex += 1
				table.insert(S.vortices, {
					id = string.format("B%02d", nextVortex), kind = "bookend", bookend = key, systemId = sys.id,
					x = seg.x - seg.nx * 15000, y = seg.y - seg.ny * 15000, u = 0, v = 0,
					vlow = 0, rlow = 15000, age = 0, seed = nextVortex * 151, cyclonic = side == 1, G = 0,
				})
			end
		end
	end
	-- evolution: each vortex rides the nearest segment of its system and spins up or down
	for _, v in S.vortices do
		if not v.dead then
			v.age += dt
			local seg, bd = nil, math.huge
			for _, sys in S.systems do
				if sys.id == v.systemId then
					for _, s in sys.segments do
						local d = (s.x - v.x) ^ 2 + (s.y - v.y) ^ 2
						if d < bd then
							seg, bd = s, d
						end
					end
				end
			end
			local target = 0
			if seg and bd < 25000 ^ 2 then
				local srh = env:field("srh01", seg.x + seg.nx * 10000, seg.y + seg.ny * 10000)
				if v.kind == "bookend" then
					target = 0.5 * seg.rij
					local back = 15000
					local tx, ty = seg.x - seg.nx * back, seg.y - seg.ny * back
					v.u += ((tx - v.x) / 300 + seg.nx * seg.speed * 0.6 - v.u) * (1 - exp(-dt / 300))
					v.v += ((ty - v.y) / 300 + seg.ny * seg.speed * 0.6 - v.v) * (1 - exp(-dt / 300))
				else
					target = 0.9 * sqrt(math.max(0, srh)) * ramp(seg.du, 8, 22) * (0.5 + 0.5 * math.max(ramp(seg.rij, 5, 18), ramp(seg.bow, 2000, 8000)))
					-- stay just behind the leading edge
					local tx, ty = seg.x - seg.nx * 2500, seg.y - seg.ny * 2500
					v.u += ((tx - v.x) / 200 + seg.nx * seg.speed - v.u) * (1 - exp(-dt / 120))
					v.v += ((ty - v.y) / 200 + seg.ny * seg.speed - v.v) * (1 - exp(-dt / 120))
				end
				-- lifting at the gust front stretches it; the outflow under it decides whether it can
				v.wLow = 0.9 * seg.c + 0.25 * seg.active / math.max(1, 1)
				v.cloudBase = math.max(300, env:field("lcl", seg.x + seg.nx * 6000, seg.y + seg.ny * 6000) * 0.85)
			else
				target = 0
			end
			v.vlow += (target - v.vlow) * (1 - exp(-dt / (if target > v.vlow then 600 else 400)))
			v.x += v.u * dt
			v.y += v.v * dt
			v.rfdDeficit = cp:deficitAt(v.x, v.y)
			-- genesis potential for a QLCS tornado (shallow, fast-organising)
			if v.kind == "mesovortex" and not v.tornado then
				local zeta = 2 * v.vlow / v.rlow
				local stretch = (v.wLow or 5) / 1000
				local warm = math.clamp(1 - (v.rfdDeficit - 2) / 4, 0, 1)
				local drive = (zeta * stretch) / (0.012 * 0.006) * warm
				v.genesisDrive = drive
				v.G = math.max(0, v.G + (drive + 0.3 * Noise.value1(v.age / 200, v.seed) - 0.9) * dt / 240)
			end
			if v.age > 600 and v.vlow < 2 then
				v.dead = true
			end
		end
	end
	-- forget dead vortices
	local keep = {}
	for _, v in S.vortices do
		if not v.dead or v.tornado then
			table.insert(keep, v)
		end
	end
	S.vortices = keep
end

-- A vortex's own wind (modified Rankine near the ground, fading by ~3 km): u, v perturbation
function Systems.vortexWind(v: any, x: number, y: number, z: number): (number, number)
	if v.dead or math.abs(v.vlow) < 0.3 then
		return 0, 0
	end
	local dx, dy = x - v.x, y - v.y
	local r = sqrt(dx * dx + dy * dy)
	local R = v.rlow
	if r < 1 or r > 8 * R then
		return 0, 0
	end
	local q = r / R
	local vt = (if q <= 1 then v.vlow * q else v.vlow * q ^ -0.6) * math.min(1, (z + 2) / 30) * exp(-z / 2500) * exp(-(q / 6) ^ 2)
	local sign = if v.cyclonic then 1 else -1
	return -vt * dy / r * sign, vt * dx / r * sign
end

-- compact view for clients
function Systems.snapshot(S: { [string]: any }): { [string]: any }
	local out = { systems = {}, vortices = {}, fronts = {} }
	for _, sys in S.systems do
		local segs = {}
		for _, seg in sys.segments do
			table.insert(segs, { seg.x, seg.y, seg.nx, seg.ny, seg.c, seg.du, seg.rij, seg.bow, seg.active, seg.deficit })
		end
		table.insert(out.systems, { id = sys.id, mode = sys.mode, length = sys.length, age = sys.age, bow = sys.bow, segments = segs })
	end
	for _, f in S.fronts do
		local pts = {}
		for _, seg in f.points do
			table.insert(pts, { seg.x, seg.y, seg.nx, seg.ny, seg.c, seg.deficit })
		end
		table.insert(out.fronts, pts)
	end
	for _, v in S.vortices do
		table.insert(out.vortices, { id = v.id, kind = v.kind, x = v.x, y = v.y, vlow = v.vlow, rlow = v.rlow, cyclonic = v.cyclonic, dead = v.dead, G = v.G })
	end
	return out
end

return Systems
