--!nonstrict
--!native
-- A storm's cloud volume from its fields (the same rules as CloudParts/StormPlan, for the billboard
-- clouds in CloudParts/CardPlan): storm-local sim metres (x east, y north, z up) from (s.x, s.y).
--   cloudR(z)   the cloud's radius at height z: where the updraft still rises at ~1.5 m/s,
--               Ru(z) sqrt(ln(W f(z) / 1.5)), round the TILTED updraft centre (Storm.wprofAt)
--   anvil       downstream along (anvilU, anvilV) for anvilLen at about el, widening with distance
--               and thinning downstream (nil while the tower hasn't reached el)
--   inCloud     inside the tower column or the anvil slab
--   sunLit      direct sun reaching a point through the storm's own cloud (a march toward the sun)
local Util = require(script.Parent:WaitForChild("Util"))

local StormShape = {}

local ramp = Util.ramp
local sqrt, log, exp, max, min, clamp = math.sqrt, math.log, math.exp, math.max, math.min, math.clamp

function StormShape.build(s: any, Storm: any): any?
	if not s.wprof or not s.tiltX then
		return nil
	end
	local sh = {}
	local W = max(s.W or 0, 0)
	local base = s.base or 1200
	local el = max(s.el or (base + 6000), base + 600)
	local top = max(s.top or el, el)
	local age = s.age or 0
	local fade = if s.dead then ramp(s.deadFor or 0, 0, 1500) else 0
	local maturity = if s.dead then 1 else clamp(age * 0.4 * max(W, 3) / max(top - base, 500), 0.1, 1)
	local visTop = base + (top - base) * maturity
	local colTop = min(visTop, el)
	sh.W, sh.base, sh.el, sh.top, sh.fade, sh.maturity, sh.visTop, sh.colTop = W, base, el, top, fade, maturity, visTop, colTop

	function sh.cloudR(z: number): (number, number, number)
		local f, tx, ty = Storm.wprofAt(s, z)
		local ru = Storm.updraftRadiusAt(s, z)
		local Wz = max(W, 3) * max(f, 0.05)
		local r = ru * sqrt(max(0.12, log(max(1.05, Wz / 1.5))))
		r = clamp(r, 0.35 * ru, 2 * ru) * (1 - 0.45 * fade)
		return r, tx, ty
	end

	-- the column, every 500 m (for the inside test)
	local lv = {}
	do
		local z = base
		while z <= colTop do
			local r, tx, ty = sh.cloudR(z)
			table.insert(lv, { z = z, r = r, x = tx, y = ty })
			z += 500
		end
	end
	sh.levels = lv

	-- the anvil
	local anvilLen = max(s.anvilLen or 0, 0)
	local rootR, rootX, rootY = sh.cloudR(el - 500)
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
		sh.anvil = { rx = rootX, ry = rootY, dx = dx, dy = dy, len = anvilLen, rr = rootR * 1.05, top0 = el + 250, th0 = th0 }
	end
	function sh.anvilAt(along: number): (number, number, number)
		local A = sh.anvil
		local w = min(2 * A.rr + 0.55 * max(along, 0), 120000)
		local f = clamp(along / max(A.len, 1), 0, 1)
		local th = A.th0 * (1 - 0.55 * f)
		local tp = A.top0 - 0.006 * max(along, 0)
		return w, tp, th
	end

	function sh.inCloud(x: number, y: number, z: number): boolean
		local n = #lv
		if n > 0 and z >= base and z <= colTop then
			local k = clamp(math.floor((z - base) / 500) + 1, 1, n)
			local l = lv[k]
			local ddx, ddy = x - l.x, y - l.y
			if ddx * ddx + ddy * ddy < l.r * l.r then
				return true
			end
		end
		local A = sh.anvil
		if A then
			local rx, ry = x - A.rx, y - A.ry
			local along = rx * A.dx + ry * A.dy
			if along > -A.rr and along < A.len then
				local across = math.abs(-rx * A.dy + ry * A.dx)
				local w, tp, th = sh.anvilAt(along)
				if across < 0.5 * w and z < tp and z > tp - th then
					return true
				end
			end
		end
		return false
	end

	local maxZ = max(top, el + 400)
	function sh.sunLit(x: number, y: number, z: number): number
		local L = Util.light
		local sx, sy, sz = L.sunSim[1], L.sunSim[2], L.sunSim[3]
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
			if sh.inCloud(px, py, pz) then
				inside += step
			end
		end
		return exp(-inside / 1800)
	end
	return sh
end

return StormShape
