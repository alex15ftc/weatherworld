--!nonstrict
-- One storm's cloud pieces, laid out from its fields only (never its mode label):
--   tower    bodies stacked from the base up the TILTED updraft (Storm.wprofAt); width where the
--            updraft w exceeds ~1.5 m/s: Ru(z) * sqrt(ln(W f(z) / 1.5)); billows (cauliflower
--            lobes) grow in number and crispness with W; a young cell's top has only risen
--            age * 0.4 W; a dead cell's tower slims and goes (deadFor) while the anvil stays
--   dome     an overshooting top above el, sized from top - el
--   anvil    sections downstream along (anvilU, anvilV) for anvilLen at about el, widening with
--            distance, thinning downstream, the billowed front edge facing upwind
--   mammatus under the anvil where precipitation production, age and anvil length are large
--   base     the rain-free base at s.base round the updraft (~2.2 Ru(base))
--   wall     a lowering under (lowX, lowY) down to wallBase when lowering and rot are
--            significant, turning at vlow / (0.3 Ru); a tail cloud toward the forward flank
-- Colours: albedo x direct sun reaching the piece's sun-facing side, from a march through the
-- storm's own cloud (tower column + anvil slab) toward the sun: the anvil shades what is under
-- it, the tower shades its far side and its base.
-- Pieces are in the Roblox frame relative to the storm's (x, y) at ground level:
--   { kind, name, cf (unit box bottom-middle), size, colour, split = "xz" | "x" | nil, spin, phase }
local Util = require(script.Parent:WaitForChild("Util"))

local StormPlan = {}

local ramp, hash = Util.ramp, Util.hash
local sqrt, log, exp, cos, sin, max, min, clamp = math.sqrt, math.log, math.exp, math.cos, math.sin, math.max, math.min, math.clamp
local TAU = 2 * math.pi

local function v3(x: number, y: number, z: number): Vector3
	return Vector3.new(x, z, -y) -- (LabConfig.toWorld)
end

function StormPlan.plan(s: any, Storm: any, CloudKit: any, detail: number): { any }
	local out = {}
	if not s.wprof or not s.tiltX then
		return out
	end
	local seed = s.seed or 1
	local slot = 0
	local function add(kind: string, cf: CFrame, size: Vector3, colour: Color3, split: string?, pickName: string?)
		slot += 1
		local name = pickName or Util.pick(CloudKit, kind, seed, slot)
		if not name then
			return nil
		end
		local pc = { kind = kind, name = name, cf = cf, size = size, colour = colour, split = split }
		table.insert(out, pc)
		return pc
	end

	local W = max(s.W or 0, 0)
	local base = s.base or 1200
	local el = max(s.el or (base + 6000), base + 600)
	local top = max(s.top or el, el)
	local age = s.age or 0
	local fade = if s.dead then ramp(s.deadFor or 0, 0, 1500) else 0
	-- how far the rising tower has got (dead storms grew up long ago)
	local maturity = if s.dead then 1 else clamp(age * 0.4 * max(W, 3) / max(top - base, 500), 0.1, 1)
	local visTop = base + (top - base) * maturity
	local colTop = min(visTop, el)

	-- the cloud's radius at height z: where the updraft still rises at ~1.5 m/s
	local function cloudR(z: number): (number, number, number)
		local f, tx, ty = Storm.wprofAt(s, z)
		local ru = Storm.updraftRadiusAt(s, z)
		local Wz = max(W, 3) * max(f, 0.05)
		local r = ru * sqrt(max(0.12, log(max(1.05, Wz / 1.5))))
		r = clamp(r, 0.35 * ru, 2 * ru) * (1 - 0.45 * fade)
		return r, tx, ty
	end

	-- the shading geometry (storm-local sim metres)
	local lv = {}
	do
		local z = base
		while z <= colTop do
			local r, tx, ty = cloudR(z)
			table.insert(lv, { z = z, r = r, x = tx, y = ty })
			z += 500
		end
	end
	local L = Util.light
	local sx, sy, sz = L.sunSim[1], L.sunSim[2], L.sunSim[3]
	local hs = sqrt(sx * sx + sy * sy)
	local shx, shy = if hs > 1e-3 then sx / hs else 1, if hs > 1e-3 then sy / hs else 0
	local anvil = nil -- filled below: { rx, ry, dx, dy, len, rr, top0, th0 }
	local function anvilAt(along: number): (number, number, number)
		-- width, top, thickness of the anvil at `along` metres downstream of its root
		local A = anvil
		local w = min(2 * A.rr + 0.55 * max(along, 0), 120000)
		local f = clamp(along / max(A.len, 1), 0, 1)
		local th = A.th0 * (1 - 0.55 * f)
		local tp = A.top0 - 0.006 * max(along, 0)
		return w, tp, th
	end
	local function inCloud(x: number, y: number, z: number): boolean
		local n = #lv
		if n > 0 and z >= base and z <= colTop then
			local k = clamp(math.floor((z - base) / 500) + 1, 1, n)
			local l = lv[k]
			local dx, dy = x - l.x, y - l.y
			if dx * dx + dy * dy < l.r * l.r then
				return true
			end
		end
		local A = anvil
		if A then
			local rx, ry = x - A.rx, y - A.ry
			local along = rx * A.dx + ry * A.dy
			if along > -A.rr and along < A.len then
				local across = math.abs(-rx * A.dy + ry * A.dx)
				local w, tp, th = anvilAt(along)
				if across < 0.5 * w and z < tp and z > tp - th then
					return true
				end
			end
		end
		return false
	end
	local maxZ = max(top, el + 400)
	local function sunLit(x: number, y: number, z: number): number
		if L.sunUp <= 0.01 or sz <= 0.02 then
			return 0
		end
		local inside = 0
		local step = 700
		for i = 1, 20 do
			local px, py, pz = x + sx * step * i, y + sy * step * i, z + sz * step * i
			if pz > maxZ then
				break
			end
			if inCloud(px, py, pz) then
				inside += step
			end
		end
		return exp(-inside / 1800)
	end

	-- the anvil's geometry first (it shades the tower and the base)
	local anvilLen = max(s.anvilLen or 0, 0)
	local rootR, rootX, rootY = cloudR(el - 500)
	local dx, dy = s.anvilU or 1, s.anvilV or 0
	do
		local m = sqrt(dx * dx + dy * dy)
		if m < 0.1 then
			dx, dy = (s.upperU or 10) - (s.u or 0), (s.upperV or 0) - (s.v or 0)
			m = sqrt(dx * dx + dy * dy)
		end
		if m < 0.1 then
			dx, dy, m = 1, 0, 1
		end
		dx, dy = dx / m, dy / m
	end
	if anvilLen > 0.4 * rootR and visTop >= el - 800 then
		local th0 = clamp(0.2 * (el - base), 1100, 2000) * (1 - 0.5 * fade)
		anvil = { rx = rootX, ry = rootY, dx = dx, dy = dy, len = anvilLen, rr = rootR * 1.05, top0 = el + 250, th0 = th0 }
	end

	-- Tower ----------------------------------------------------------------------------------
	local crisp = ramp(W, 8, 35) * (1 - fade)
	if fade < 0.85 and #lv > 0 then
		local H = colTop - base
		local rMid = cloudR(base + 0.5 * H)
		local step = clamp(1.4 * rMid, 700, 1900)
		local n = clamp(math.ceil(H / step), 1, 8)
		step = H / n
		for k = 1, n do
			local z0 = base + (k - 1) * step - (if k == 1 then 120 else 0)
			local zc = z0 + 0.5 * step
			local r, tx, ty = cloudR(zc)
			local w = 2 * r * (0.95 + 0.12 * hash(seed, k, 1))
			local h = min(step * 1.35 + (if k == 1 then 120 else 0), 2000)
			local lit = sunLit(tx + shx * r * 1.02, ty + shy * r * 1.02, zc)
			-- (a dying tower turns softer and greyer)
			local albedo = 0.9 - 0.08 * fade + 0.04 * crisp
			local cf = CFrame.new(v3(tx, ty, z0)) * CFrame.Angles(0, hash(seed, k, 2) * TAU, 0)
			add("tower_body", cf, Vector3.new(w, h, w * (0.9 + 0.15 * hash(seed, k, 3))), Util.cloudColour(albedo, lit), "xz")
		end
		-- billows: cauliflower lobes bulging out of the column, more and crisper with W
		local nB = math.floor(detail * clamp(W / 4, 0, 10) * (1 - fade) + 0.5)
		for b = 1, nB do
			local h1, h2, h3 = hash(seed, 100 + b, 4), hash(seed, 100 + b, 5), hash(seed, 100 + b, 6)
			local z = base + H * (0.3 + 0.62 * h1)
			local r, tx, ty = cloudR(z)
			local a = h2 * TAU
			local ox, oy = cos(a), sin(a)
			local bs = 2 * r * (0.3 + 0.25 * h3) * (0.8 + 0.3 * crisp)
			local px, py = tx + ox * r * 0.72, ty + oy * r * 0.72
			local lit = sunLit(px + ox * bs * 0.5, py + oy * bs * 0.5, z)
			local cf = CFrame.new(v3(px, py, z - 0.3 * bs)) * CFrame.Angles(0, h1 * TAU * 3, 0)
			add("tower_cap", cf, Vector3.new(bs, bs * (0.5 + 0.2 * crisp), bs), Util.cloudColour(0.93, lit), "xz")
		end
		-- the top: a towering cumulus dome while rising, a cap tucked under the anvil when mature
		local rTop, tx, ty = cloudR(max(base, colTop - 400))
		local cw = 2 * rTop * (1.05 + 0.15 * crisp)
		local ch = cw * (0.45 + 0.2 * crisp) * (if anvil then 0.7 else 1)
		local litTop = sunLit(tx, ty, colTop + 0.4 * ch)
		local capName = Util.pick(CloudKit, "tower_cap", seed, 900)
		if capName == "tower_cap_3" then
			capName = "tower_cap_1" -- (3 is the overshooting dome)
		end
		add("tower_cap", CFrame.new(v3(tx, ty, colTop - 0.45 * ch)) * CFrame.Angles(0, hash(seed, 7, 7) * TAU, 0),
			Vector3.new(cw, ch, cw), Util.cloudColour(0.96, litTop), "xz", capName)
		-- a young cell: a second, smaller turret beside the top
		if not anvil and maturity < 0.98 and detail > 0.4 then
			local a = hash(seed, 8, 8) * TAU
			local tw = cw * 0.55
			add("tower_cap", CFrame.new(v3(tx + cos(a) * rTop * 0.6, ty + sin(a) * rTop * 0.6, colTop - 0.25 * ch - 0.3 * tw)),
				Vector3.new(tw, tw * 0.6, tw), Util.cloudColour(0.95, litTop), "xz")
		end
	end

	-- the overshooting top: a dome above the anvil, from top - el
	local over = top - el
	if fade == 0 and maturity >= 0.97 and over > 150 then
		local _, tx, ty = Storm.wprofAt(s, el)
		local ruE = Storm.updraftRadiusAt(s, el)
		local wO = clamp(1.4 * ruE, 1200, 9000) * (0.5 + 0.5 * ramp(over, 150, 1500)) * ramp(W, 5, 15)
		if wO > 300 then
			local zb = el - 0.2 * over
			local hO = (top - zb) / 0.95
			local lit = sunLit(tx, ty, top)
			add("tower_cap", CFrame.new(v3(tx, ty, zb)) * CFrame.Angles(0, hash(seed, 9, 9) * TAU, 0),
				Vector3.new(wO, hO, wO * 0.9), Util.cloudColour(0.98, lit), "xz",
				if table.find(CloudKit.names("tower_cap"), "tower_cap_3") then "tower_cap_3" else nil)
		end
	end

	-- Anvil ----------------------------------------------------------------------------------
	if anvil then
		local A = anvil
		local maxRows = math.floor(3 + 5 * detail + 0.5)
		local total = A.len + A.rr
		local sec = clamp(total / maxRows, 5000, 14000)
		local rows = clamp(math.ceil(total / sec), 1, maxRows)
		sec = total / rows
		local maxCols = 1 + math.floor(2.5 * detail + 0.5)
		local cxv, cyv = -dy, dx -- across the flow
		local look = Vector3.new(-dx, 0, dy) -- (front edge upwind: Roblox dir of (-dx, -dy))
		for i = 1, rows do
			local xc = -A.rr + (i - 0.5) * sec
			local w, tp, th = anvilAt(xc)
			local cols = clamp(math.ceil(w / (sec * 1.2)), 1, maxCols)
			local colW = w / cols
			for j = 1, cols do
				local h1, h2 = hash(seed, 200 + i * 7 + j, 10), hash(seed, 200 + i * 7 + j, 11)
				local c = ((j - 0.5) / cols - 0.5) * w
				local tk = th * (0.85 + 0.3 * h1)
				local px, py = A.rx + dx * xc + cxv * c, A.ry + dy * xc + cyv * c
				local lit = sunLit(px, py, tp + 60)
				local p = v3(px, py, tp - tk)
				local cf = CFrame.lookAt(p, p + look) * CFrame.Angles(0, (h2 - 0.5) * 0.5, 0)
				add("anvil", cf, Vector3.new(colW * (1.15 + 0.2 * h2), tk, sec * 1.25), Util.cloudColour(0.9, lit), "xz")
			end
		end
		-- mammatus: pouches under a mature, productive anvil
		local m = ramp(s.precipRate or 0, 1e5, 8e5) * ramp(s.age or 0, 1200, 3600) * ramp(A.len, 15000, 40000) * (1 - 0.6 * fade)
		if m > 0.2 then
			local nM = math.max(1, math.floor(m * 4 * detail + 0.5))
			for i = 1, nM do
				local h1, h2, h3 = hash(seed, 300 + i, 12), hash(seed, 300 + i, 13), hash(seed, 300 + i, 14)
				local along = A.len * (0.12 + 0.45 * h1)
				local w, tp, th = anvilAt(along)
				local c = (h2 - 0.5) * 0.5 * w
				local sz = clamp(0.3 * w, 3000, 9000)
				local depth = 300 + 500 * m
				local px, py = A.rx + dx * along + cxv * c, A.ry + dy * along + cyv * c
				local lit = sunLit(px, py, tp - th - depth)
				add("mammatus", CFrame.new(v3(px, py, tp - th - 0.85 * depth)) * CFrame.Angles(0, h3 * TAU, 0),
					Vector3.new(sz, depth, sz), Util.cloudColour(0.82, lit), "xz")
			end
		end
	end

	-- Base -----------------------------------------------------------------------------------
	if fade < 0.6 and maturity > 0.2 then
		local _, tx, ty = Storm.wprofAt(s, base)
		local Rb = clamp(2.2 * Storm.updraftRadiusAt(s, base), 1500, 15000) * (1 - 0.6 * fade) * (0.55 + 0.45 * ramp(W, 3, 15))
		local thick = 380 + 0.02 * Rb
		local albedo = 0.64 - 0.14 * ramp(top - base, 6000, 13000)
		local lit = sunLit(tx, ty, base - 80)
		add("base", CFrame.new(v3(tx, ty, base - 0.1 * thick)) * CFrame.Angles(0, hash(seed, 10, 15) * TAU, 0),
			Vector3.new(2 * Rb, thick, 2 * Rb * (0.85 + 0.2 * hash(seed, 10, 16))), Util.cloudColour(albedo, lit), "xz")
	end

	-- Wall cloud and tail cloud -------------------------------------------------------------
	local lowering = s.lowering or 0
	local rot = s.rot or 0
	if not s.dead and lowering > 30 and rot > 0.25 and s.lowX and s.wallBase then
		local q = ramp(lowering, 30, 400) * ramp(rot, 0.25, 0.6)
		local Ru = max(s.Ru or 1500, 300)
		local lx, ly = s.lowX - s.x, s.lowY - s.y
		local w = clamp(0.7 * Ru, 800, 2000) * (0.7 + 0.3 * q)
		local zb = max(s.wallBase, 60)
		local h = math.min((base - zb) + 260, 2000)
		local lit = sunLit(lx, ly, zb)
		local pc = add("wall_cloud", CFrame.new(v3(lx, ly, zb)), Vector3.new(w, h, w * 0.92), Util.cloudColour(0.46, lit), nil)
		if pc then
			pc.spin = (s.vlow or 0) / (0.3 * Ru)
			pc.phase = hash(seed, 11, 17) * TAU
		end
		-- tail cloud: a band of ragged cloud from the wall cloud toward the forward-flank rain
		if s.ffdX and q > 0.3 then
			local fx, fy = s.ffdX - s.lowX, s.ffdY - s.lowY
			local dl = sqrt(fx * fx + fy * fy)
			if dl > 800 then
				fx, fy = fx / dl, fy / dl
				local nT = if detail > 0.5 then 2 else 1
				local seg = min(0.4 * dl, 1500)
				for i = 1, nT do
					local along = 0.45 * w + (i - 0.5) * seg
					local px, py = lx + fx * along, ly + fy * along
					local hz = zb + (0.25 + 0.2 * i) * (base - zb)
					local p = v3(px, py, hz)
					local cf = CFrame.lookAt(p, p + Vector3.new(fx, 0, -fy))
					add("base", cf, Vector3.new(w * (0.45 - 0.08 * i), (base - hz) + 200, seg * 1.3), Util.cloudColour(0.5, lit), nil)
				end
			end
		end
	end
	return out
end

return StormPlan
