--!strict
-- Interstate crossings planned by the map generator (js/worldmap/crossings.js): an interchange
-- or an overpass where a road passes over an interstate. Shared by the server (which builds them)
-- and the client's map (which draws them), so both lay the ramps the same way.
--
-- A diamond interchange (with a US highway): the highway passes over the interstate on a bridge;
-- on each side of the interstate an off-ramp leaves before the crossing and an on-ramp joins after
-- it, each a single-lane road curving from the interstate's outer shoulder to the highway where it
-- has come back down to the ground beyond the bridge (signals there).
-- A system interchange (two interstates): one passes over the other; in each of the four quadrants
-- a connector ramp curves from one interstate's shoulder to the other's, both well clear of the
-- bridge, merging at each end.

local Interchanges = {}

export type Record = {
	interchange: boolean,
	road: number, -- the road passing over: 1 interstate, 2 expressway, 3 highway, 4 paved, 5 gravel
	x: number, z: number, -- studs
	ux: number, uz: number, -- the interstate's direction
	vx: number, vz: number, -- the crossing road's direction
	exit: number,
	uEnd: number, -- where the interstate ends here: the way it goes on (+1/-1 along u), else 0
	vEnd: number, -- the same for the crossing road (along v)
}

export type Ramp = { points: { Vector2 }, side: number, after: boolean, merges: boolean }

-- All in studs at character scale (they keep their size whatever STUDS_PER_MILE);
-- js/worldmap/interchanges.js has the same in map miles (studs / STUDS_PER_MILE, scale.js).
Interchanges.INTERSTATE_HALF = 51 -- RoadNet's interstate cross-section (pavement)
Interchanges.RAMP_ALONG = 400 -- where a ramp leaves or joins the interstate, from the crossing
Interchanges.TERMINAL_EXTRA = 300 -- the ramp meets the crossing road this far beyond the interstate's edge
Interchanges.SYSTEM_ALONG = 460 -- a system connector meets each interstate this far from the crossing

-- Records from a tile's flat list (9 numbers each), placed in studs by studsAt.
function Interchanges.fromList(list: { number }, studsAt: (number, number) -> (number, number)): { Record }
	local out = {}
	for i = 1, #list, 11 do
		local x, z = studsAt(list[i + 2], list[i + 3])
		table.insert(out, {
			interchange = list[i] == 1, road = list[i + 1], x = x, z = z,
			ux = list[i + 4], uz = list[i + 5], vx = list[i + 6], vz = list[i + 7], exit = list[i + 8],
			uEnd = list[i + 9], vEnd = list[i + 10],
		})
	end
	return out
end

-- Sine of the angle between the interstate and the crossing road.
function Interchanges.sin(r: Record): number
	return math.max(0.25, math.abs(r.ux * r.vz - r.uz * r.vx))
end

-- The four ramps of an interchange, as polylines in studs (x, z), from the interstate's shoulder
-- to the crossing road.
local function bezier(points: { Vector2 }, a: Vector2, c: Vector2, b: Vector2, steps: number)
	for i = 0, steps do
		local t = i / steps
		table.insert(points, a * (1 - t) ^ 2 + c * 2 * (1 - t) * t + b * t * t)
	end
end

-- Half-widths of the road kinds a record names (RoadNet's cross-sections).
local HALF = { [1] = 51, [2] = 39, [3] = 18, [4] = 13, [5] = 10 }

-- A T: one road ends at the crossing. Returns the ending road's direction away from the junction,
-- the through road's direction and half-width, and how far from the crossing the ending road
-- stops and splits into its ramps.
function Interchanges.tee(r: Record): (Vector2?, Vector2, number, number)
	local u, v = Vector2.new(r.ux, r.uz), Vector2.new(r.vx, r.vz)
	local sin = Interchanges.sin(r)
	if r.vEnd ~= 0 then
		return v * r.vEnd, u, HALF[1], HALF[1] / sin + 140
	elseif r.uEnd ~= 0 then
		local throughHalf = HALF[r.road] or 18
		return u * r.uEnd, v, throughHalf, throughHalf / sin + 140
	end
	return nil, u, 0, 0
end

function Interchanges.ramps(r: Record): { Ramp }
	if not r.interchange then
		return {}
	end
	local out = {}
	local sin = Interchanges.sin(r)
	local half = Interchanges.INTERSTATE_HALF
	local stem, through, throughHalf, split = Interchanges.tee(r)
	if stem then
		-- A T: the ending road splits into two ramps, merging onto the through road either way.
		local p = Vector2.new(r.x, r.z)
		local wt = Vector2.new(-through.Y, through.X)
		local side = if stem:Dot(wt) >= 0 then 1 else -1
		local s = p + stem * split
		for _, sa in { -1, 1 } do
			local e = p + through * sa * Interchanges.SYSTEM_ALONG + wt * side * (throughHalf - 8)
			local corner = p + through * sa * 90 + stem * (split * 0.55)
			local points = {}
			bezier(points, s, corner, e, 12)
			table.insert(out, { points = points, side = side, after = sa > 0, merges = true })
		end
		return out
	end
	if r.road == 1 then
		-- System interchange: a connector in each quadrant between the two interstates.
		local p = Vector2.new(r.x, r.z)
		local u, v = Vector2.new(r.ux, r.uz), Vector2.new(r.vx, r.vz)
		local wu, wv = Vector2.new(-r.uz, r.ux), Vector2.new(-r.vz, r.vx)
		for _, sa in { -1, 1 } do
			for _, sb in { -1, 1 } do
				local sideU = if (v * sb):Dot(wu) >= 0 then 1 else -1
				local sideV = if (u * sa):Dot(wv) >= 0 then 1 else -1
				local a = p + u * sa * Interchanges.SYSTEM_ALONG + wu * sideU * (half - 8)
				local b = p + v * sb * Interchanges.SYSTEM_ALONG + wv * sideV * (half - 8)
				local corner = p + u * sa * (half / sin + 120) + v * sb * (half / sin + 120)
				local points = {}
				bezier(points, a, corner, b, 12)
				table.insert(out, { points = points, side = sideU, after = sa > 0, merges = true })
			end
		end
		return out
	end
	local wx, wz = -r.uz, r.ux -- right of the interstate's direction
	local terminal = Interchanges.INTERSTATE_HALF / sin + Interchanges.TERMINAL_EXTRA
	for _, side in { -1, 1 } do
		-- Along the crossing road toward this side of the interstate.
		local toward = if (r.vx * wx + r.vz * wz) * side >= 0 then 1 else -1
		local tx, tz = r.x + r.vx * toward * terminal, r.z + r.vz * toward * terminal
		for _, a in { -1, 1 } do
			local along = a * Interchanges.RAMP_ALONG
			local ex = r.x + r.ux * along + wx * side * (Interchanges.INTERSTATE_HALF - 8)
			local ez = r.z + r.uz * along + wz * side * (Interchanges.INTERSTATE_HALF - 8)
			local cx = r.x + r.ux * along * 0.3 + wx * side * (Interchanges.INTERSTATE_HALF + 40)
			local cz = r.z + r.uz * along * 0.3 + wz * side * (Interchanges.INTERSTATE_HALF + 40)
			local points = {}
			for i = 0, 10 do
				local t = i / 10
				local x = (1 - t) ^ 2 * ex + 2 * (1 - t) * t * cx + t * t * tx
				local z = (1 - t) ^ 2 * ez + 2 * (1 - t) * t * cz + t * t * tz
				table.insert(points, Vector2.new(x, z))
			end
			table.insert(out, { points = points, side = side, after = a > 0, merges = false })
		end
	end
	return out
end

return Interchanges
