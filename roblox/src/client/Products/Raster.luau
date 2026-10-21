--!strict
-- Drawing into an RGBA pixel buffer (the map's image): lines, and areas given as rings of map
-- miles (flat lists x1, y1, x2, y2...) filled by the even-odd rule, hatched or outlined. Pure
-- Luau with no Roblox services, so it can be tried outside Studio (luau.exe).

local Raster = {}

export type Colour = { number }
export type Rings = { { number } }
export type Raster = {
	-- A line between map points, width in screen pixels.
	line: (ax: number, ay: number, bx: number, by: number, width: number, c: Colour) -> (),
	polyline: (points: { number }, width: number, c: Colour) -> (),
	-- Fill the area of the rings with a colour, blended over what is there (alpha 0-1).
	fill: (rings: Rings, colour: Colour, alpha: number) -> (),
	-- Hatch the area: "dashLeft" broken lines falling to the lower left, "right" solid lines
	-- falling to the lower right, "cross" both solid.
	hatch: (rings: Rings, kind: string, colour: Colour) -> (),
	-- Outline each ring, width in screen pixels.
	stroke: (rings: Rings, width: number, colour: Colour) -> (),
	-- A byte grid from the map's north-west corner (width x height cells of cellMiles), coloured
	-- by a 256-entry RGBA table (lut[byte * 4 + 1 .. 4]); byte 0 and clear colours are left alone.
	grid: (bytes: buffer, width: number, height: number, cellMiles: number, lut: { number }, alpha: number) -> (),
	-- One radar's tilt: radials clockwise from north (radial-major, gates outward), centred on
	-- (cx, cy) map miles, a gate every gateMiles of ground; coloured as grid.
	polar: (bytes: buffer, radials: number, gates: number, gateMiles: number, cx: number, cy: number, lut: { number }, alpha: number) -> (),
}

-- Hatch lines in screen pixels, so they keep their spacing at every zoom.
local SPACING, WIDTH, DASH, GAP = 11, 1.4, 9, 6

-- pixels: pw x ph RGBA; toScreen: map miles to screen pixels; scale: image pixels per screen pixel.
function Raster.new(pixels: buffer, pw: number, ph: number, toScreen: (number, number) -> (number, number), scale: number): Raster
	local function stamp(x: number, y: number, r: number, c: Colour)
		local x0, x1 = math.max(0, math.floor(x - r)), math.min(pw - 1, math.floor(x + r))
		local y0, y1 = math.max(0, math.floor(y - r)), math.min(ph - 1, math.floor(y + r))
		for py = y0, y1 do
			local row = py * pw
			for px = x0, x1 do
				local o = (row + px) * 4
				buffer.writeu8(pixels, o, c[1])
				buffer.writeu8(pixels, o + 1, c[2])
				buffer.writeu8(pixels, o + 2, c[3])
			end
		end
	end

	local function line(ax: number, ay: number, bx: number, by: number, width: number, c: Colour)
		local sx0, sy0 = toScreen(ax, ay)
		local sx1, sy1 = toScreen(bx, by)
		sx0, sy0, sx1, sy1 = sx0 * scale, sy0 * scale, sx1 * scale, sy1 * scale
		if math.max(sx0, sx1) < -4 or math.min(sx0, sx1) > pw + 4 or math.max(sy0, sy1) < -4 or math.min(sy0, sy1) > ph + 4 then
			return
		end
		local length = math.sqrt((sx1 - sx0) ^ 2 + (sy1 - sy0) ^ 2)
		local steps = math.max(1, math.ceil(length / 0.8))
		local r = math.max(0, width * scale / 2 - 0.5)
		for i = 0, steps do
			local t = i / steps
			stamp(sx0 + (sx1 - sx0) * t, sy0 + (sy1 - sy0) * t, r, c)
		end
	end

	local function polyline(points: { number }, width: number, c: Colour)
		for i = 3, #points, 2 do
			line(points[i - 2], points[i - 1], points[i], points[i + 1], width, c)
		end
	end

	-- The image pixels inside rings (even-odd), as spans: each(py, x0, x1). An edge only visits
	-- the rows it crosses, so the cost goes with the outlines, not with the area.
	local function spans(rings: Rings, each: (py: number, x0: number, x1: number) -> ())
		local rows: { [number]: { number } } = {}
		for _, ring in rings do
			local n = #ring
			for i = 1, n - 1, 2 do
				local j = if i + 2 > n then 1 else i + 2
				local ax, ay = toScreen(ring[i], ring[i + 1])
				local bx, by = toScreen(ring[j], ring[j + 1])
				ax, ay, bx, by = ax * scale, ay * scale, bx * scale, by * scale
				if ay ~= by then
					-- Rows whose centre lies in [min y, max y).
					local r0 = math.max(0, math.ceil(math.min(ay, by) - 0.5))
					local r1 = math.min(ph - 1, math.ceil(math.max(ay, by) - 0.5) - 1)
					local slope = (bx - ax) / (by - ay)
					for py = r0, r1 do
						local row = rows[py]
						if not row then
							row = {}
							rows[py] = row
						end
						table.insert(row, ax + (py + 0.5 - ay) * slope)
					end
				end
			end
		end
		for py, xs in rows do
			table.sort(xs)
			for k = 1, #xs - 1, 2 do
				local x0 = math.max(0, math.ceil(xs[k] - 0.5))
				local x1 = math.min(pw - 1, math.ceil(xs[k + 1] - 0.5) - 1)
				if x1 >= x0 then
					each(py, x0, x1)
				end
			end
		end
	end

	local function fill(rings: Rings, c: Colour, alpha: number)
		local keep = 1 - alpha
		local r, g, b = c[1] * alpha, c[2] * alpha, c[3] * alpha
		spans(rings, function(py, x0, x1)
			local o = (py * pw + x0) * 4
			for _ = x0, x1 do
				buffer.writeu8(pixels, o, buffer.readu8(pixels, o) * keep + r)
				buffer.writeu8(pixels, o + 1, buffer.readu8(pixels, o + 1) * keep + g)
				buffer.writeu8(pixels, o + 2, buffer.readu8(pixels, o + 2) * keep + b)
				o += 4
			end
		end)
	end

	local function hatch(rings: Rings, kind: string, c: Colour)
		local inv = 1 / scale
		spans(rings, function(py, x0, x1)
			local sy = (py + 0.5) * inv
			local o = (py * pw + x0) * 4
			for px = x0, x1 do
				local sx = (px + 0.5) * inv
				local on
				if kind == "dashLeft" then
					on = (sx + sy) % SPACING < WIDTH and (sx - sy) % (DASH + GAP) < DASH
				elseif kind == "right" then
					on = (sx - sy) % SPACING < WIDTH
				else
					on = (sx - sy) % SPACING < WIDTH or (sx + sy) % SPACING < WIDTH
				end
				if on then
					buffer.writeu8(pixels, o, c[1])
					buffer.writeu8(pixels, o + 1, c[2])
					buffer.writeu8(pixels, o + 2, c[3])
				end
				o += 4
			end
		end)
	end

	local function stroke(rings: Rings, width: number, c: Colour)
		for _, ring in rings do
			polyline(ring, width, c)
			local n = #ring
			if n >= 4 then
				line(ring[n - 1], ring[n], ring[1], ring[2], width, c)
			end
		end
	end

	-- The view is a plain scale and shift of the map, so image pixel centres map back to miles as:
	-- miles = (pixel + 0.5) * milesPerPixel + offset.
	local ox, oy = toScreen(0, 0)
	local ex, ey = toScreen(1, 1)
	local mppx, mppy = 1 / ((ex - ox) * scale), 1 / ((ey - oy) * scale)
	local offX, offY = -ox / (ex - ox), -oy / (ey - oy)
	local function pixelRange(lo: number, hi: number, perPixel: number, offset: number, size: number): (number, number)
		-- The pixels whose centres fall in [lo, hi) miles.
		local a = math.max(0, math.ceil((lo - offset) / perPixel - 0.5))
		local b = math.min(size - 1, math.ceil((hi - offset) / perPixel - 0.5) - 1)
		return a, b
	end

	local function put(o: number, lut: { number }, byte: number, alpha: number)
		local k = byte * 4
		local a = lut[k + 4] / 255 * alpha
		if a <= 0 then
			return
		end
		local keep = 1 - a
		buffer.writeu8(pixels, o, buffer.readu8(pixels, o) * keep + lut[k + 1] * a)
		buffer.writeu8(pixels, o + 1, buffer.readu8(pixels, o + 1) * keep + lut[k + 2] * a)
		buffer.writeu8(pixels, o + 2, buffer.readu8(pixels, o + 2) * keep + lut[k + 3] * a)
	end

	local function grid(bytes: buffer, width: number, height: number, cellMiles: number, lut: { number }, alpha: number)
		local x0, x1 = pixelRange(0, width * cellMiles, mppx, offX, pw)
		local y0, y1 = pixelRange(0, height * cellMiles, mppy, offY, ph)
		local perCellX = mppx / cellMiles
		for py = y0, y1 do
			local j = math.floor(((py + 0.5) * mppy + offY) / cellMiles)
			if j >= 0 and j < height then
				local rowStart = j * width
				local o = (py * pw + x0) * 4
				local gx = ((x0 + 0.5) * mppx + offX) / cellMiles
				for _ = x0, x1 do
					local i = math.floor(gx)
					if i >= 0 and i < width then
						local byte = buffer.readu8(bytes, rowStart + i)
						if byte ~= 0 then
							put(o, lut, byte, alpha)
						end
					end
					gx += perCellX
					o += 4
				end
			end
		end
	end

	local TAU = 2 * math.pi
	local function polar(bytes: buffer, radials: number, gates: number, gateMiles: number, cx: number, cy: number, lut: { number }, alpha: number)
		local reach = gates * gateMiles
		local x0, x1 = pixelRange(cx - reach, cx + reach, mppx, offX, pw)
		local y0, y1 = pixelRange(cy - reach, cy + reach, mppy, offY, ph)
		local perRadial = radials / TAU
		for py = y0, y1 do
			local dy = (py + 0.5) * mppy + offY - cy
			local o = (py * pw + x0) * 4
			for px = x0, x1 do
				local dx = (px + 0.5) * mppx + offX - cx
				local gate = math.floor(math.sqrt(dx * dx + dy * dy) / gateMiles)
				if gate < gates then
					local az = math.atan2(dx, -dy)
					if az < 0 then
						az += TAU
					end
					local radial = math.floor(az * perRadial) % radials
					local byte = buffer.readu8(bytes, radial * gates + gate)
					if byte ~= 0 then
						put(o, lut, byte, alpha)
					end
				end
				o += 4
			end
		end
	end

	return { line = line, polyline = polyline, fill = fill, hatch = hatch, stroke = stroke, grid = grid, polar = polar }
end

return Raster
