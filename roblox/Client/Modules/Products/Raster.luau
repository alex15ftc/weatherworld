--!strict
--!native
-- Drawing into an RGBA pixel buffer (a map tile, or the radar's image): lines, and areas given
-- as rings of map miles (flat lists x1, y1, x2, y2...) filled by the even-odd rule, hatched or
-- outlined. The buffer may start clear (a product tile over the map): colours are laid over
-- what is there with their alpha, so a tile shows the map through wherever nothing is drawn.
-- Pure Luau with no Roblox services, so it can be tried outside Studio (luau.exe).

local Raster = {}

export type Colour = { number }
export type Rings = { { number } }
export type Raster = {
	-- A line between map points, width in screen pixels.
	line: (ax: number, ay: number, bx: number, by: number, width: number, c: Colour) -> (),
	-- A round mark on a map point, radius in screen pixels.
	dot: (x: number, y: number, radius: number, c: Colour) -> (),
	polyline: (points: { number }, width: number, c: Colour) -> (),
	-- Fill the area of the rings with a colour, blended over what is there (alpha 0-1).
	fill: (rings: Rings, colour: Colour, alpha: number) -> (),
	-- Several areas filled in turn, bottom first: as fill one after another, but in one sweep.
	fills: (list: { { rings: Rings, colour: Colour, alpha: number } }) -> (),
	-- Hatch the area: "dashLeft" broken lines falling to the lower left, "right" solid lines
	-- falling to the lower right, "cross" both solid.
	hatch: (rings: Rings, kind: string, colour: Colour) -> (),
	-- Outline each ring, width in screen pixels. Sides lying along the map's edge (an area traced
	-- off the map closes along it) are left out, so the outline ends at the edge.
	stroke: (rings: Rings, width: number, colour: Colour) -> (),
	-- A byte grid from the map's north-west corner (width x height cells of cellMiles), coloured
	-- by a 256-entry RGBA table (lut[byte * 4 + 1 .. 4]); byte 0 and clear colours are left alone.
	grid: (bytes: buffer, width: number, height: number, cellMiles: number, lut: { number }, alpha: number) -> (),
	-- One radar's tilt: radials clockwise from north (radial-major, gates outward), centred on
	-- (cx, cy) map miles, a gate every gateMiles of ground; coloured as grid.
	polar: (bytes: buffer, radials: number, gates: number, gateMiles: number, cx: number, cy: number, lut: { number }, alpha: number) -> (),
	-- Whether anything has been drawn.
	drawn: () -> boolean,
}

-- Hatch lines in screen pixels, so they keep their spacing at every zoom.
local SPACING, WIDTH, DASH, GAP = 11, 1.4, 9, 6
-- Each ring's (or polyline's) extent in map miles { x0, y0, x1, y1 }, worked out once: product
-- rings are kept as they came, and every tile they are drawn into asks.
local extents: { [{ number }]: { number } } = setmetatable({}, { __mode = "k" }) :: any
local function extentOf(points: { number }): { number }
	local held = extents[points]
	if held then
		return held
	end
	local x0, y0, x1, y1 = math.huge, math.huge, -math.huge, -math.huge
	for i = 1, #points - 1, 2 do
		local x, y = points[i], points[i + 1]
		if x < x0 then
			x0 = x
		end
		if x > x1 then
			x1 = x
		end
		if y < y0 then
			y0 = y
		end
		if y > y1 then
			y1 = y
		end
	end
	local e = { x0, y0, x1, y1 }
	extents[points] = e
	return e
end
-- The gate under each pixel of the radars drawn polar, for the images they were drawn in (an
-- image of the view is drawn in bands, each its own Raster, so a view is several): let go all
-- at once when more than POLAR_CACHE are held.
local POLAR_CACHE = 64
local polarCache: { [string]: buffer } = {}
local polarCount = 0

-- What a byte of a colour table at an alpha lays on a clear pixel, as a little-endian word
-- (words[byte + 1]; -1: nothing), as over() lays it: kept for each table and alpha.
local lutCache: { [{ number }]: { [number]: { number } } } = setmetatable({}, { __mode = "k" }) :: any
local function lutWords(lut: { number }, alpha: number): { number }
	local byAlpha = lutCache[lut]
	if not byAlpha then
		byAlpha = {}
		lutCache[lut] = byAlpha
	end
	local held = byAlpha[alpha]
	if held then
		return held
	end
	local words = table.create(256, -1)
	for byte = 1, 255 do
		local k = byte * 4
		local a = lut[k + 4] / 255 * alpha
		if a > 0 then
			local r, g, b = math.floor(lut[k + 1]), math.floor(lut[k + 2]), math.floor(lut[k + 3])
			words[byte + 1] = r + g * 256 + b * 65536 + math.floor(a * 255 + 0.5) * 16777216
		end
	end
	byAlpha[alpha] = words
	return words
end

-- pixels: pw x ph RGBA; toScreen: map miles to screen pixels; scale: image pixels per screen
-- pixel; originX, originY: where this image's top-left pixel is in a larger picture made of
-- several (a tile's place in its zoom level), so hatching runs on unbroken across them.
-- mapMiles: the map's size (0 to mapMiles both ways), so outlines are left off its edge.
function Raster.new(pixels: buffer, pw: number, ph: number, toScreen: (number, number) -> (number, number), scale: number, originX: number?, originY: number?, mapMiles: number?): Raster
	local ox, oy = originX or 0, originY or 0
	local touched = false

	-- Lays a colour over a pixel with alpha a (0-1).
	local function over(o: number, r: number, g: number, b: number, a: number)
		local da = buffer.readu8(pixels, o + 3)
		if da == 255 then
			local keep = 1 - a
			buffer.writeu8(pixels, o, buffer.readu8(pixels, o) * keep + r * a)
			buffer.writeu8(pixels, o + 1, buffer.readu8(pixels, o + 1) * keep + g * a)
			buffer.writeu8(pixels, o + 2, buffer.readu8(pixels, o + 2) * keep + b * a)
		elseif da == 0 then
			buffer.writeu8(pixels, o, r)
			buffer.writeu8(pixels, o + 1, g)
			buffer.writeu8(pixels, o + 2, b)
			buffer.writeu8(pixels, o + 3, a * 255 + 0.5)
		else
			local below = da / 255 * (1 - a)
			local out = a + below
			buffer.writeu8(pixels, o, (r * a + buffer.readu8(pixels, o) * below) / out)
			buffer.writeu8(pixels, o + 1, (g * a + buffer.readu8(pixels, o + 1) * below) / out)
			buffer.writeu8(pixels, o + 2, (b * a + buffer.readu8(pixels, o + 2) * below) / out)
			buffer.writeu8(pixels, o + 3, out * 255 + 0.5)
		end
	end

	local function put(o: number, r: number, g: number, b: number)
		buffer.writeu8(pixels, o, r)
		buffer.writeu8(pixels, o + 1, g)
		buffer.writeu8(pixels, o + 2, b)
		buffer.writeu8(pixels, o + 3, 255)
	end

	-- A line between image points, its half-width hw image pixels: every pixel near it gets the
	-- share of it the line covers (by its distance from the line, so the ends and joins are
	-- round and the edges smooth). Visits only the pixels within reach of the line, a row at a time.
	local function capsule(x0: number, y0: number, x1: number, y1: number, hw: number, c: Colour)
		local reach = hw + 0.5
		local minY = math.max(0, math.floor(math.min(y0, y1) - reach))
		local maxY = math.min(ph - 1, math.ceil(math.max(y0, y1) + reach))
		local minX = math.max(0, math.floor(math.min(x0, x1) - reach))
		local maxX = math.min(pw - 1, math.ceil(math.max(x0, x1) + reach))
		if minX > maxX or minY > maxY then
			return
		end
		local dx, dy = x1 - x0, y1 - y0
		local length2 = dx * dx + dy * dy
		local inv = if length2 > 0 then 1 / length2 else 0
		-- Along each row the line is within reach for a stretch about its crossing point.
		local span = if math.abs(dy) > 1e-9 then reach * math.sqrt(length2) / math.abs(dy) + 1 else math.huge
		local r, g, b = c[1], c[2], c[3]
		for py = minY, maxY do
			local cy = py + 0.5
			local fromX, toX = minX, maxX
			if span < math.huge then
				local crossing = x0 + (cy - y0) * dx / dy
				fromX = math.max(minX, math.floor(crossing - span))
				toX = math.min(maxX, math.ceil(crossing + span))
			end
			local o = (py * pw + fromX) * 4
			for px = fromX, toX do
				local cx = px + 0.5
				local t = ((cx - x0) * dx + (cy - y0) * dy) * inv
				if t < 0 then
					t = 0
				elseif t > 1 then
					t = 1
				end
				local ex, ey = x0 + t * dx - cx, y0 + t * dy - cy
				local cover = reach - math.sqrt(ex * ex + ey * ey)
				if cover > 0 then
					touched = true
					if cover >= 1 then
						put(o, r, g, b)
					else
						over(o, r, g, b, cover)
					end
				end
				o += 4
			end
		end
	end

	local function line(ax: number, ay: number, bx: number, by: number, width: number, c: Colour)
		local sx0, sy0 = toScreen(ax, ay)
		local sx1, sy1 = toScreen(bx, by)
		sx0, sy0, sx1, sy1 = sx0 * scale, sy0 * scale, sx1 * scale, sy1 * scale
		local hw = math.max(0.5, width * scale / 2)
		local margin = hw + 2
		if math.max(sx0, sx1) < -margin or math.min(sx0, sx1) > pw + margin or math.max(sy0, sy1) < -margin or math.min(sy0, sy1) > ph + margin then
			return
		end
		capsule(sx0, sy0, sx1, sy1, hw, c)
	end

	-- A round mark centred on a map point, radius in screen pixels, its edge smoothed.
	local function dot(x: number, y: number, radius: number, c: Colour)
		local sx, sy = toScreen(x, y)
		sx, sy = sx * scale, sy * scale
		local r = radius * scale
		local x0, x1 = math.max(0, math.floor(sx - r - 1)), math.min(pw - 1, math.ceil(sx + r + 1))
		local y0, y1 = math.max(0, math.floor(sy - r - 1)), math.min(ph - 1, math.ceil(sy + r + 1))
		for py = y0, y1 do
			local dy = py + 0.5 - sy
			for px = x0, x1 do
				local dx = px + 0.5 - sx
				local cover = r + 0.5 - math.sqrt(dx * dx + dy * dy)
				if cover > 0 then
					touched = true
					local o = (py * pw + px) * 4
					if cover >= 1 then
						put(o, c[1], c[2], c[3])
					else
						over(o, c[1], c[2], c[3], cover)
					end
				end
			end
		end
	end

	-- The image in map miles (it is a plain scale and shift of the map), and whether points with
	-- an extent could reach it within pad screen pixels. (A ring wholly off the image changes no
	-- pixel of it, fill, hatch or outline: by the even-odd rule a ring off to one side crosses a
	-- row of it an even number of times to the left of every pixel, or none.)
	local sx0, sy0 = toScreen(0, 0)
	local sx1, sy1 = toScreen(1, 1)
	local milesX, milesY = 1 / ((sx1 - sx0) * scale), 1 / ((sy1 - sy0) * scale) -- per image pixel
	local leftMi, topMi = -sx0 * scale * milesX, -sy0 * scale * milesY
	local rightMi, bottomMi = leftMi + pw * milesX, topMi + ph * milesY
	local function reaches(points: { number }, pad: number): boolean
		local e = extentOf(points)
		local px, py = pad * scale * math.abs(milesX) + math.abs(milesX), pad * scale * math.abs(milesY) + math.abs(milesY)
		return e[3] >= math.min(leftMi, rightMi) - px and e[1] <= math.max(leftMi, rightMi) + px and e[4] >= math.min(topMi, bottomMi) - py and e[2] <= math.max(topMi, bottomMi) + py
	end

	local function polyline(points: { number }, width: number, c: Colour)
		if not reaches(points, width / 2 + 2) then
			return
		end
		for i = 3, #points, 2 do
			line(points[i - 2], points[i - 1], points[i], points[i + 1], width, c)
		end
	end

	-- How much of each pixel the rings cover (even-odd), kept only where it changes along a row:
	-- for each pixel row the rings touch, the pixels with an edge in them (xs, sorted), what of
	-- each is covered by spans ending in it (frac[x]) and how much the whole-pixel coverage steps
	-- by from it on (step[x]); between them it holds. Each pixel row is sampled on SUB lines,
	-- each crossing counted exactly across the row, so edges come out smooth. The cost goes with
	-- the outlines, not the area: an area's inside is handed out as runs (sweep).
	local SUB = 4
	local SHARE = 1 / SUB
	type Row = { xs: { number }, frac: { [number]: number }, step: { [number]: number } }
	local function rowsOf(rings: Rings): { [number]: Row }
		local lines: { [number]: { number } } = {}
		local count = ph * SUB
		for _, ring in rings do
			local n = if reaches(ring, 1) then #ring else 0
			for i = 1, n - 1, 2 do
				local j = if i + 2 > n then 1 else i + 2
				local ax, ay = toScreen(ring[i], ring[i + 1])
				local bx, by = toScreen(ring[j], ring[j + 1])
				-- x in image pixels, y in sample lines.
				ax, ay, bx, by = ax * scale, ay * scale * SUB, bx * scale, by * scale * SUB
				if ay ~= by then
					-- Sample lines whose centre lies in [min y, max y).
					local r0 = math.max(0, math.ceil(math.min(ay, by) - 0.5))
					local r1 = math.min(count - 1, math.ceil(math.max(ay, by) - 0.5) - 1)
					local slope = (bx - ax) / (by - ay)
					for k = r0, r1 do
						local line = lines[k]
						if not line then
							line = {}
							lines[k] = line
						end
						table.insert(line, ax + (k + 0.5 - ay) * slope)
					end
				end
			end
		end
		local pixelRows: { [number]: boolean } = {}
		for k in lines do
			pixelRows[k // SUB] = true
		end
		local out: { [number]: Row } = {}
		for py in pixelRows do
			local xsOut: { number } = {}
			local frac: { [number]: number } = {}
			local step: { [number]: number } = {}
			local function mark(x: number)
				if frac[x] == nil and step[x] == nil then
					table.insert(xsOut, x)
				end
			end
			for s = 0, SUB - 1 do
				local xs = lines[py * SUB + s]
				if xs then
					table.sort(xs)
					for k = 1, #xs - 1, 2 do
						local a, b = math.max(0, xs[k]), math.min(pw, xs[k + 1])
						if b > a then
							local fa, fb = math.floor(a), math.min(pw - 1, math.ceil(b) - 1)
							mark(fa)
							if fa == fb then
								frac[fa] = (frac[fa] or 0) + (b - a) * SHARE
							else
								frac[fa] = (frac[fa] or 0) + (fa + 1 - a) * SHARE
								if fb > fa + 1 then
									mark(fa + 1)
									step[fa + 1] = (step[fa + 1] or 0) + SHARE
									mark(fb)
									step[fb] = (step[fb] or 0) - SHARE
								end
								mark(fb)
								frac[fb] = (frac[fb] or 0) + (b - fb) * SHARE
							end
						end
					end
				end
			end
			if #xsOut > 0 then
				table.sort(xsOut)
				out[py] = { xs = xsOut, frac = frac, step = step }
			end
		end
		return out
	end

	-- A row's coverage as runs of pixels x0..x1 covered by a (only those with a > 0.001): each
	-- pixel with an edge in it on its own, and the stretches between them whole.
	local function sweep(row: Row, emit: (x0: number, x1: number, a: number) -> ())
		local frac, step = row.frac, row.step
		local inside = 0
		local prev = -1
		for _, x in row.xs do
			if x > prev + 1 and inside > 0.001 then
				emit(prev + 1, x - 1, inside)
			end
			inside += step[x] or 0
			local a = (frac[x] or 0) + inside
			if a > 0.001 then
				emit(x, x, a)
			end
			prev = x
		end
	end

	-- A whole pixel of colour c at alpha a laid over a clear one, as one little-endian word.
	local function solidWord(c: Colour, a: number): number
		local r, g, b = math.floor(c[1]), math.floor(c[2]), math.floor(c[3])
		return r + g * 256 + b * 65536 + math.floor(a * 255 + 0.5) * 16777216
	end

	-- Copies the pixel at o over the n - 1 after it (in doubling blocks, so a long run is a few
	-- copies rather than a write a pixel).
	local function spread(o: number, n: number)
		local done = 1
		while done < n do
			local more = math.min(done, n - done)
			buffer.copy(pixels, o + done * 4, pixels, o, more * 4)
			done += more
		end
	end

	local function fill(rings: Rings, c: Colour, alpha: number)
		local r, g, b = c[1], c[2], c[3]
		local solid = solidWord(c, alpha)
		-- Inside an area every whole pixel starts from one of a few colours (the clear image, the
		-- fills under it) and ends the same way from each: the last such pixel's result is kept and
		-- written again while the pixels under it match, so the inside costs a read and a write.
		local fromWord, toWord = -1, 0
		for py, row in rowsOf(rings) do
			local rowStart = py * pw
			sweep(row, function(x0: number, x1: number, a: number)
				touched = true
				local o = (rowStart + x0) * 4
				if a >= 1 then
					for _ = x0, x1 do
						local was = buffer.readu32(pixels, o)
						if was == fromWord then
							buffer.writeu32(pixels, o, toWord)
						elseif was < 16777216 then
							-- (a whole pixel over a clear one, as over() would lay it)
							buffer.writeu32(pixels, o, solid)
						else
							over(o, r, g, b, alpha)
							fromWord, toWord = was, buffer.readu32(pixels, o)
						end
						o += 4
					end
				else
					for _ = x0, x1 do
						over(o, r, g, b, alpha * a)
						o += 4
					end
				end
			end)
		end
	end

	-- Several areas filled in turn, as fill one after another (the outlook's nested areas), in one
	-- sweep over a clear image: between edges a row holds one colour, laid on its first pixel and
	-- copied along. Over an image already drawn on, they are filled one at a time.
	local function fills(list: { { rings: Rings, colour: Colour, alpha: number } })
		if touched then
			for _, f in list do
				fill(f.rings, f.colour, f.alpha)
			end
			return
		end
		local n = #list
		local rowsK: { { [number]: Row } } = {}
		local solids: { number } = table.create(n, 0)
		local allRows: { [number]: boolean } = {}
		for k, f in list do
			rowsK[k] = rowsOf(f.rings)
			solids[k] = solidWord(f.colour, f.alpha)
			for py in rowsK[k] do
				allRows[py] = true
			end
		end
		local inside: { number } = table.create(n, 0)
		local at: { number } = table.create(n, 0)
		-- Lays each area's share on the pixel at o (covers: each area's coverage of it), as fill would.
		local function lay(o: number, covers: { number }): boolean
			local any = false
			for k = 1, n do
				local a = covers[k]
				if a >= 1 then
					any = true
					if buffer.readu32(pixels, o) < 16777216 then
						buffer.writeu32(pixels, o, solids[k])
					else
						local c = list[k].colour
						over(o, c[1], c[2], c[3], list[k].alpha)
					end
				elseif a > 0.001 then
					any = true
					local c = list[k].colour
					over(o, c[1], c[2], c[3], list[k].alpha * a)
				end
			end
			return any
		end
		for py in allRows do
			local rows: { [number]: Row? } = {}
			local xs: { number } = {}
			local seen: { [number]: boolean } = {}
			for k = 1, n do
				local row = rowsK[k][py]
				rows[k] = row
				inside[k] = 0
				if row then
					for _, x in row.xs do
						if not seen[x] then
							seen[x] = true
							table.insert(xs, x)
						end
					end
				end
			end
			table.sort(xs)
			local rowStart = py * pw
			local prev = -1
			for _, x in xs do
				if x > prev + 1 then
					local o = (rowStart + prev + 1) * 4
					if lay(o, inside) then
						touched = true
						spread(o, x - prev - 1)
					end
				end
				for k = 1, n do
					local row = rows[k]
					if row then
						inside[k] += row.step[x] or 0
						at[k] = (row.frac[x] or 0) + inside[k]
					else
						at[k] = 0
					end
				end
				if lay((rowStart + x) * 4, at) then
					touched = true
				end
				prev = x
			end
		end
	end

	local function hatch(rings: Rings, kind: string, c: Colour)
		local inv = 1 / scale
		-- How many pixels after one whose stripe phase is q (q >= on, off the stripe) are surely
		-- off it too: the phase grows by inv a pixel and comes back on only at period. (Kept a
		-- hair short, so a pixel near the turn is tested as it is.)
		local function offFor(q: number, on: number, period: number): number
			if q < on then
				return 0
			end
			return math.max(0, math.floor((period - 1e-6 - q) / inv))
		end
		-- (a whole pixel of the stripe is the colour itself, whatever is under it)
		local solid = solidWord(c, 1)
		for py, row in rowsOf(rings) do
			local sy = (py + oy + 0.5) * inv
			local rowStart = py * pw
			sweep(row, function(x0: number, x1: number, a: number)
				local px = x0
				while px <= x1 do
					local skip = 0
					local sx = (px + ox + 0.5) * inv
					local on
					local down, up = (sx - sy) % SPACING, (sx + sy) % SPACING
					if kind == "dashLeft" then
						local dash = (sx - sy) % (DASH + GAP)
						on = up < WIDTH and dash < DASH
						skip = math.max(offFor(up, WIDTH, SPACING), offFor(dash, DASH, DASH + GAP))
					elseif kind == "right" then
						on = down < WIDTH
						skip = offFor(down, WIDTH, SPACING)
					else
						on = down < WIDTH or up < WIDTH
						skip = math.min(offFor(down, WIDTH, SPACING), offFor(up, WIDTH, SPACING))
					end
					if on then
						touched = true
						if a >= 1 then
							buffer.writeu32(pixels, (rowStart + px) * 4, solid)
						else
							over((rowStart + px) * 4, c[1], c[2], c[3], a)
						end
					end
					px += 1 + skip
				end
			end)
		end
	end

	-- Whether the side from (ax, ay) to (bx, by) runs along one edge of the map (rings are
	-- rounded to 0.01 mi).
	local EDGE = 0.011
	local function alongEdge(ax: number, ay: number, bx: number, by: number): boolean
		if not mapMiles then
			return false
		end
		local far = mapMiles - EDGE
		return (ax <= EDGE and bx <= EDGE) or (ax >= far and bx >= far) or (ay <= EDGE and by <= EDGE) or (ay >= far and by >= far)
	end

	local function stroke(rings: Rings, width: number, c: Colour)
		for _, ring in rings do
			local n = #ring
			if n >= 4 and reaches(ring, width / 2 + 2) then
				for i = 1, n - 1, 2 do
					local j = if i + 2 > n then 1 else i + 2
					local ax, ay, bx, by = ring[i], ring[i + 1], ring[j], ring[j + 1]
					if not alongEdge(ax, ay, bx, by) then
						line(ax, ay, bx, by, width, c)
					end
				end
			end
		end
	end

	-- The view is a plain scale and shift of the map, so image pixel centres map back to miles as:
	-- miles = (pixel + 0.5) * milesPerPixel + offset.
	local ox0, oy0 = toScreen(0, 0)
	local ex, ey = toScreen(1, 1)
	local mppx, mppy = 1 / ((ex - ox0) * scale), 1 / ((ey - oy0) * scale)
	local offX, offY = -ox0 / (ex - ox0), -oy0 / (ey - oy0)
	local function pixelRange(lo: number, hi: number, perPixel: number, offset: number, size: number): (number, number)
		-- The pixels whose centres fall in [lo, hi) miles.
		local a = math.max(0, math.ceil((lo - offset) / perPixel - 0.5))
		local b = math.min(size - 1, math.ceil((hi - offset) / perPixel - 0.5) - 1)
		return a, b
	end

	local function putLut(o: number, lut: { number }, byte: number, alpha: number)
		local k = byte * 4
		local a = lut[k + 4] / 255 * alpha
		if a <= 0 then
			return
		end
		touched = true
		over(o, lut[k + 1], lut[k + 2], lut[k + 3], a)
	end

	-- A byte's pixel over a clear one is the same every time: putLut's word for each byte (index
	-- byte + 1; -1 where it draws nothing), worked out once a colour table and alpha.
	local function putWord(o: number, words: { number }, lut: { number }, byte: number, alpha: number)
		local word = words[byte + 1]
		if word < 0 then
			return
		end
		touched = true
		if buffer.readu32(pixels, o) < 16777216 then
			buffer.writeu32(pixels, o, word)
		else
			putLut(o, lut, byte, alpha)
		end
	end

	local function grid(bytes: buffer, width: number, height: number, cellMiles: number, lut: { number }, alpha: number)
		local x0, x1 = pixelRange(0, width * cellMiles, mppx, offX, pw)
		local y0, y1 = pixelRange(0, height * cellMiles, mppy, offY, ph)
		local perCellX = mppx / cellMiles
		local words = lutWords(lut, alpha)
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
							putWord(o, words, lut, byte, alpha)
						end
					end
					gx += perCellX
					o += 4
				end
			end
		end
	end

	local TAU = 2 * math.pi
	-- Which gate each pixel shows depends only on the view and the radar, so it is worked out
	-- once (polarCache, kept between images) and a radar loop's frames are drawn by lookup.
	local function polar(bytes: buffer, radials: number, gates: number, gateMiles: number, cx: number, cy: number, lut: { number }, alpha: number)
		local reach = gates * gateMiles
		local x0, x1 = pixelRange(cx - reach, cx + reach, mppx, offX, pw)
		local y0, y1 = pixelRange(cy - reach, cy + reach, mppy, offY, ph)
		if x1 < x0 or y1 < y0 then
			return
		end
		local bw = x1 - x0 + 1
		local key = string.format("%d %d %d %d %d %d %.9g %.9g %.9g %.9g %.9g %.9g %.9g %d %d", pw, ph, x0, x1, y0, y1, mppx, mppy, offX, offY, cx, cy, gateMiles, radials, gates)
		local index = polarCache[key]
		if not index then
			local made = buffer.create(bw * (y1 - y0 + 1) * 4)
			local perRadial = radials / TAU
			local k = 0
			for py = y0, y1 do
				local dy = (py + 0.5) * mppy + offY - cy
				for px = x0, x1 do
					local dx = (px + 0.5) * mppx + offX - cx
					local gate = math.floor(math.sqrt(dx * dx + dy * dy) / gateMiles)
					local at = -1
					if gate < gates then
						local az = math.atan2(dx, -dy)
						if az < 0 then
							az += TAU
						end
						at = (math.floor(az * perRadial) % radials) * gates + gate
					end
					buffer.writei32(made, k, at)
					k += 4
				end
			end
			if polarCount >= POLAR_CACHE then
				table.clear(polarCache)
				polarCount = 0
			end
			polarCache[key] = made
			index = made
			polarCount += 1
		end
		local words = lutWords(lut, alpha)
		local gatesAt = index :: buffer
		local k = 0
		for py = y0, y1 do
			local o = (py * pw + x0) * 4
			for _ = x0, x1 do
				local at = buffer.readi32(gatesAt, k)
				if at >= 0 then
					local byte = buffer.readu8(bytes, at)
					if byte ~= 0 then
						putWord(o, words, lut, byte, alpha)
					end
				end
				k += 4
				o += 4
			end
		end
	end

	local function drawn(): boolean
		return touched
	end

	return { line = line, dot = dot, polyline = polyline, fill = fill, fills = fills, hatch = hatch, stroke = stroke, grid = grid, polar = polar, drawn = drawn }
end

-- A byte grid's n cells as RGBA pixels, one cell a pixel (MapCanvas's grids): each byte's packed
-- little-endian word (words[byte + 1]), byte 0 left as the pixels have it (clear when new).
function Raster.colourGrid(bytes: buffer, n: number, words: { number }, pixels: buffer)
	for k = 0, n - 1 do
		local byte = buffer.readu8(bytes, k)
		if byte ~= 0 then
			buffer.writeu32(pixels, k * 4, words[byte + 1])
		end
	end
end

return Raster
