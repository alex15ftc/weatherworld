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

-- "21:35Z" from an hour of the world's clock.
function Geo.clock(hour: number): string
	local minutes = math.round(hour * 60) % (24 * 60)
	return string.format("%02d:%02dZ", minutes // 60, minutes % 60)
end

return Geo
