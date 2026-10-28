--!strict
-- What stands on the land round a chunk, from the map's tiles (scripts/export-world-roblox.mjs
-- `sites`, from js/worldmap/landUse.js, facilities.js and airfields.js), in studs:
--   areas      the land use of the places: downtown, mall, shopping (by tier), corridor (highway
--              strips), travel (truck stop centres), industrial and park; everything else in a
--              place is houses;
--   gas        gas stations and truck stops, schools: lots facing a road (centre, the way to the
--              road, size along and back from it);
--   campuses   colleges and universities, airfields (airports, the air base, NWS offices),
--   turbines, substations, windmills, wells and tanks.
-- Also the superblocks: the areas town streets do not run through (campuses, airfields, malls and
-- community centres, industrial parks, larger parks, middle and high school lots). Server only.

local Config = require(script.Parent.Config)
local WorldMap = require(script.Parent.WorldMap)

local Sites = {}

export type Poly = { Vector2 }
export type Area = { id: number, kind: string, tier: string?, town: string, poly: Poly, box: { number }, block: boolean? }
export type Lot = { id: number, kind: string, name: string?, x: number, z: number, fx: number, fz: number, w: number, d: number }
export type Set = {
	areas: { Area },
	gas: { Lot },
	schools: { Lot },
	campuses: { any },
	airfields: { any },
	turbines: { Vector2 },
	substations: { Poly },
	windmills: { Vector2 },
	wells: { { x: number, z: number, gas: boolean } },
	tanks: { Vector2 },
	blocks: { { poly: Poly, box: { number } } },
}

local MILE = Config.STUDS_PER_MILE

local function poly(flat: { number }): Poly
	local out = table.create(#flat // 2)
	for i = 1, #flat, 2 do
		local x, z = WorldMap.studsAt(flat[i], flat[i + 1])
		table.insert(out, Vector2.new(x, z))
	end
	return out
end
Sites.poly = poly

local function boxOf(p: Poly): { number }
	local x0, z0, x1, z1 = math.huge, math.huge, -math.huge, -math.huge
	for _, v in p do
		x0, z0, x1, z1 = math.min(x0, v.X), math.min(z0, v.Y), math.max(x1, v.X), math.max(z1, v.Y)
	end
	return { x0, z0, x1, z1 }
end
Sites.boxOf = boxOf

-- Whether a point lies inside a convex polygon (either winding).
function Sites.inside(p: Poly, x: number, z: number): boolean
	local sign = 0
	local n = #p
	for i = 1, n do
		local a, b = p[i], p[i % n + 1]
		local c = (b.X - a.X) * (z - a.Y) - (b.Y - a.Y) * (x - a.X)
		if c ~= 0 then
			local s = if c > 0 then 1 else -1
			if sign == 0 then
				sign = s
			elseif s ~= sign then
				return false
			end
		end
	end
	return true
end

-- Distance from a point to a convex polygon's edge, negative inside.
function Sites.distance(p: Poly, x: number, z: number): number
	local best = math.huge
	local n = #p
	for i = 1, n do
		local a, b = p[i], p[i % n + 1]
		local dx, dz = b.X - a.X, b.Y - a.Y
		local len2 = dx * dx + dz * dz
		local t = if len2 > 0 then math.clamp(((x - a.X) * dx + (z - a.Y) * dz) / len2, 0, 1) else 0
		best = math.min(best, math.sqrt((a.X + dx * t - x) ^ 2 + (a.Y + dz * t - z) ^ 2))
	end
	return if Sites.inside(p, x, z) then -best else best
end

-- A rectangle given as four corners: its centre, the yaw that turns a part's X along the first
-- edge, and its size along the first edge and the second.
function Sites.rect(p: Poly): (number, number, number, number, number)
	local a, b, c = p[1], p[2], p[3]
	local cx, cz = 0, 0
	for _, v in p do
		cx += v.X / #p
		cz += v.Y / #p
	end
	local ex, ez = b.X - a.X, b.Y - a.Y
	return cx, cz, math.atan2(-ez, ex), math.sqrt(ex * ex + ez * ez), (c - b).Magnitude
end

-- A lot's frame on the ground at height y: the front (-z) faces the road.
function Sites.lotFrame(lot: Lot, y: number): CFrame
	return CFrame.lookAt(Vector3.new(lot.x, y, lot.z), Vector3.new(lot.x + lot.fx, y, lot.z + lot.fz))
end

local function points(list: { number }, step: number, add: (number, number, number) -> ())
	for i = 1, #list, step do
		add(list[i], list[i + 1], list[i + 2] or 0)
	end
end

-- Everything within pad studs of a box (studs). Call where WorldMap tiles may be loaded (serial,
-- or inside the area prepared with WorldMap.ensure).
function Sites.near(x0: number, z0: number, x1: number, z1: number, pad: number): Set
	local mx0, my0 = WorldMap.milesAt(x0 - pad, z0 - pad)
	local mx1, my1 = WorldMap.milesAt(x1 + pad, z1 + pad)
	local set: Set = { areas = {}, gas = {}, schools = {}, campuses = {}, airfields = {}, turbines = {}, substations = {}, windmills = {}, wells = {}, tanks = {}, blocks = {} }
	local seen: { [any]: boolean } = {}
	local function fresh(key: any): boolean
		if seen[key] then
			return false
		end
		seen[key] = true
		return true
	end
	local function within(b: { number }): boolean
		return b[3] >= x0 - pad and b[1] <= x1 + pad and b[4] >= z0 - pad and b[2] <= z1 + pad
	end
	local function pointIn(mx: number, my: number): boolean
		return mx >= mx0 and mx <= mx1 and my >= my0 and my <= my1
	end
	-- Whether a flat list of map miles comes within reach (miles) of the box: a quick test before
	-- anything is converted to studs.
	local function flatNear(flat: { number }, reach: number): boolean
		local lx, ly, hx, hy = math.huge, math.huge, -math.huge, -math.huge
		for i = 1, #flat, 2 do
			lx, ly, hx, hy = math.min(lx, flat[i]), math.min(ly, flat[i + 1]), math.max(hx, flat[i]), math.max(hy, flat[i + 1])
		end
		return hx >= mx0 - reach and lx <= mx1 + reach and hy >= my0 - reach and ly <= my1 + reach
	end
	local function lot(s: any, kind: string, name: string?): Lot
		local x, z = WorldMap.studsAt(s.x, s.y)
		return { id = s.id, kind = kind, name = name, x = x, z = z, fx = s.fx, fz = s.fy, w = s.w * MILE, d = s.d * MILE }
	end
	-- A lot's corners (studs).
	local function lotPoly(l: Lot): Poly
		local rx, rz = -l.fz, l.fx
		local out = {}
		for _, c in { { -1, -1 }, { 1, -1 }, { 1, 1 }, { -1, 1 } } do
			table.insert(out, Vector2.new(l.x + rx * c[1] * l.w / 2 + l.fx * c[2] * l.d / 2, l.z + rz * c[1] * l.w / 2 + l.fz * c[2] * l.d / 2))
		end
		return out
	end
	local function block(p: Poly)
		table.insert(set.blocks, { poly = p, box = boxOf(p) })
	end
	for _, tile in WorldMap.tilesFor(mx0, my0, mx1, my1) do
		local s = (tile :: any).sites
		if not s then
			continue
		end
		for _, a in s.areas do
			if fresh(a.id) and flatNear(a.p, 0) then
				local p = poly(a.p)
				local b = boxOf(p)
				if within(b) then
					local area: Area = { id = a.id, kind = a.k, tier = a.t, town = a.town, poly = p, box = b }
					table.insert(set.areas, area)
					local small = math.min(b[3] - b[1], b[4] - b[2])
					if a.k == "mall" or a.t == "community" or a.k == "travel" or (a.k == "industrial" and small > 150) or (a.k == "park" and small > 150) then
						area.block = true
						block(p)
					end
				end
			end
		end
		for _, g in s.gas do
			if fresh(g.id) and pointIn(g.x, g.y) then
				local l = lot(g, g.s)
				if within(boxOf(lotPoly(l))) then
					table.insert(set.gas, l)
				end
			end
		end
		for _, k in s.schools do
			if fresh(k.id) and flatNear({ k.x, k.y }, 0.2) then
				local l = lot(k, k.l, k.n)
				local p = lotPoly(l)
				if within(boxOf(p)) then
					table.insert(set.schools, l)
					if k.l ~= "elementary" then
						block(p)
					end
				end
			end
		end
		for _, c in s.campuses do
			if fresh(c.id) and flatNear(c.p, 0) then
				local area = poly(c.p)
				if within(boxOf(area)) then
					local list = function(polys: { { number } }): { Poly }
						local out = {}
						for _, f in polys do
							table.insert(out, poly(f))
						end
						return out
					end
					table.insert(set.campuses, {
						id = c.id, tier = c.t, name = c.n, area = area, quad = poly(c.q), buildings = list(c.b),
						parking = list(c.pk), stadium = if c.st then poly(c.st) else nil, fields = list(c.f),
					})
					block(area)
				end
			end
		end
		for _, a in s.airfields do
			if fresh(a.id) and flatNear(a.fence, 0.6) then
				local fence = poly(a.fence)
				local fb = boxOf(fence)
				local reach = 600 -- the ground blends to the field's level beyond the fence
				if within({ fb[1] - reach, fb[2] - reach, fb[3] + reach, fb[4] + reach }) then
					local runways = {}
					for _, r in a.runways do
						local ends = poly(r.a)
						-- Lengths come from the map (laid out at character scale by js/worldmap/airfields.js
						-- through scale.js, so they keep their studs whatever STUDS_PER_MILE); widths half
						-- the true feet in studs, since squashed with the map a 150 ft runway would be
						-- narrower than a highway at character scale.
						table.insert(runways, { a = ends[1], b = ends[2], half = r.w * 0.25 })
					end
					local lines = {}
					for _, t in a.taxiways do
						table.insert(lines, poly(t))
					end
					local polys = function(list: { any }, key: string?): { any }
						local out: { any } = {}
						for _, f in list do
							if key then
								table.insert(out, { kind = f.k, poly = poly(f.p) })
							else
								table.insert(out, poly(f))
							end
						end
						return out
					end
					local radar = nil
					if a.radar then
						local x, z = WorldMap.studsAt(a.radar.x, a.radar.y)
						radar = { x = x, z = z, compound = poly(a.radar.p) }
					end
					table.insert(set.airfields, {
						id = a.id, kind = a.k, code = a.code, name = a.n, levelM = a.e, fence = fence, box = fb,
						runways = runways, taxiways = lines, aprons = polys(a.aprons), buildings = polys(a.b, "k"),
						parking = polys(a.pk), radar = radar,
						nws = if a.nws then { building = poly(a.nws.b), parking = poly(a.nws.pk) } else nil,
					})
					block(fence)
				end
			end
		end
		local function addPoint(list: { Vector2 }, key: string)
			return function(mx: number, my: number)
				if pointIn(mx, my) and fresh(`{key}{mx},{my}`) then
					local x, z = WorldMap.studsAt(mx, my)
					table.insert(list, Vector2.new(x, z))
				end
			end
		end
		points(s.turbines, 2, addPoint(set.turbines, "t"))
		points(s.windmills, 2, addPoint(set.windmills, "m"))
		points(s.tanks, 2, addPoint(set.tanks, "k"))
		points(s.wells, 3, function(mx: number, my: number, kind: number)
			if pointIn(mx, my) and fresh(`w{mx},{my}`) then
				local x, z = WorldMap.studsAt(mx, my)
				table.insert(set.wells, { x = x, z = z, gas = kind == 1 })
			end
		end)
		for _, f in s.substations do
			local key = `s{f[1]},{f[2]}`
			if fresh(key) and flatNear(f, 0) then
				local p = poly(f)
				if within(boxOf(p)) then
					table.insert(set.substations, p)
				end
			end
		end
	end
	return set
end

-- The land-use area at a point (a strip along a highway only where no other area is), or nil.
function Sites.areaAt(set: Set, x: number, z: number): Area?
	local strip = nil
	for _, a in set.areas do
		local b = a.box
		if x >= b[1] and x <= b[3] and z >= b[2] and z <= b[4] and Sites.inside(a.poly, x, z) then
			if a.kind ~= "corridor" then
				return a
			end
			strip = a
		end
	end
	return strip
end

-- Whether a point lies in a superblock (pad studs round it included): town streets stop there.
function Sites.superblock(set: Set, x: number, z: number, pad: number?): boolean
	local margin = pad or 0
	for _, b in set.blocks do
		local box = b.box
		if x >= box[1] - margin and x <= box[3] + margin and z >= box[2] - margin and z <= box[4] + margin then
			if margin == 0 then
				if Sites.inside(b.poly, x, z) then
					return true
				end
			elseif Sites.distance(b.poly, x, z) < margin then
				return true
			end
		end
	end
	return false
end

return Sites
