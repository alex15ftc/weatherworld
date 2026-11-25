--!strict
-- Small geometry for the product layers: rings are flat lists of map miles (x1, y1, x2, y2...).

local Geo = {}

-- Whether a point is inside the rings, by the even-odd rule (a ring inside another is a hole).
function Geo.inside(rings: { { number } }, x: number, y: number): boolean
	local inside = false
	for _, ring in rings do
		local n = #ring
		local j = n - 1
		for i = 1, n - 1, 2 do
			local xi, yi, xj, yj = ring[i], ring[i + 1], ring[j], ring[j + 1]
			if (yi > y) ~= (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi then
				inside = not inside
			end
			j = i
		end
	end
	return inside
end

-- The middle of the rings' points (for a label).
function Geo.middle(rings: { { number } }): (number, number)
	local sx, sy, n = 0, 0, 0
	for _, ring in rings do
		for i = 1, #ring - 1, 2 do
			sx += ring[i]
			sy += ring[i + 1]
			n += 1
		end
	end
	if n == 0 then
		return 0, 0
	end
	return sx / n, sy / n
end

-- The box around the rings' points (west, north, east, south, in map miles), or nil when there are none.
function Geo.bounds(rings: { { number } }): { number }?
	local x0, y0, x1, y1 = math.huge, math.huge, -math.huge, -math.huge
	for _, ring in rings do
		for i = 1, #ring - 1, 2 do
			x0, x1 = math.min(x0, ring[i]), math.max(x1, ring[i])
			y0, y1 = math.min(y0, ring[i + 1]), math.max(y1, ring[i + 1])
		end
	end
	if x0 > x1 then
		return nil
	end
	return { x0, y0, x1, y1 }
end

-- How far a point is from a line (a flat list of points), in map miles.
function Geo.lineDistance(points: { number }, x: number, y: number): number
	local best = math.huge
	if #points == 2 then
		return math.sqrt((points[1] - x) ^ 2 + (points[2] - y) ^ 2)
	end
	for i = 3, #points, 2 do
		local ax, ay, bx, by = points[i - 2], points[i - 1], points[i], points[i + 1]
		local dx, dy = bx - ax, by - ay
		local length2 = dx * dx + dy * dy
		local t = if length2 > 0 then math.clamp(((x - ax) * dx + (y - ay) * dy) / length2, 0, 1) else 0
		best = math.min(best, math.sqrt((ax + t * dx - x) ^ 2 + (ay + t * dy - y) ^ 2))
	end
	return best
end

-- "21:35Z" from an hour of the world's clock.
function Geo.clock(hour: number): string
	local minutes = math.round(hour * 60) % (24 * 60)
	return string.format("%02d:%02dZ", minutes // 60, minutes % 60)
end

return Geo
