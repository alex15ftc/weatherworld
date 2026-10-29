--!strict
-- The world map itself, drawn into one piece of an image (a tile of the map screen,
-- MapCanvas.luau): land cover with hill-shading, the section-line roads once zoomed in,
-- rivers, interchange ramps and the main roads. Pure Luau with no Roblox services (the data
-- comes in already unpacked), so it can be tried outside Studio (luau.exe) and run in a
-- parallel worker.
--
-- Zoomed out, each half-mile cell is its cover's colour, blended between cells. Zoomed in
-- (NEAR miles a pixel, fading in from FADE), the map shows the ground as the world has it
-- (LandSurface): each cell's edges sharp, the crop of each quarter section, centre pivots, sand
-- blowouts, red soil, and lake shores as the world draws them; each surface's colour is scaled
-- so its cover keeps the colour it has zoomed out. The hill-shading stays smooth.

local Raster = require(script and script.Parent.Raster or "./Raster")
-- (Outside Studio, luau.exe: the files side by side.)
local LandSurface = require(if script then (game :: any):GetService("ReplicatedStorage").Shared.World.LandSurface else "./LandSurface")

local MapBase = {}

export type Data = {
	miles: number,
	cells: number,
	cellMiles: number,
	land: buffer, -- cover index per cell, then hill-shade (200 = flat) per cell
	sections: buffer, -- section-line road classes: east (bits 0-1) and south (bits 2-3)
	sectionSize: number,
	coverKeys: { [number]: string }, -- cover index -> its key (WorldMap.meta.cover)
	coverRGB: { [number]: { number } }, -- cover index -> colour
	rivers: { any }, -- { width, points }
	roads: { any }, -- { kind, points }
	rampLines: { { number } },
	studsPerMile: number,
	-- Worked out on first use: each cover's surfaces as the map colours them.
	surfaces: { [number]: { fn: (number, number) -> string, rgb: { [string]: { number } } } }?,
}

local OFF_MAP = 0xFF1E1A18 -- r 24, g 26, b 30, opaque
local NEAR, FADE = 0.08, 0.16 -- miles an image pixel: the ground in full from NEAR, none from FADE
-- How far a surface's colour stands off its cover's (1: as the terrain has it), so the fields
-- read as fields without drowning the products drawn over them.
local CONTRAST = 0.5
local ROAD_STYLE = {
	interstate = { colour = { 205, 40, 50 }, width = 2.4 },
	expressway = { colour = { 235, 120, 40 }, width = 2 },
	highway = { colour = { 250, 196, 60 }, width = 1.5 },
}
local RIVER = { 58, 104, 170 }
local RAMP = { 235, 150, 90 }
local SECTION_COLOURS = { [1] = { 170, 135, 95 }, [2] = { 226, 212, 176 }, [3] = { 250, 250, 246 } }
-- Full width in studs of the dirt, gravel and county roads (RoadNet.SPECS pavement x 2).
local SECTION_STUDS = { [1] = 13, [2] = 20, [3] = 26 }

-- Each cover's surfaces in map colours: the terrain's colour of each, times the cover's map
-- colour over the average terrain colour of the cover (sampled over its surfaces' patterns),
-- then drawn CONTRAST of the way from the cover's colour to that.
local function surfacesOf(d: Data)
	local out = {}
	for index, key in d.coverKeys do
		local fn = LandSurface.forCover(key)
		local seen: { [string]: boolean } = {}
		local sr, sg, sb, count = 0, 0, 0, 0
		for i = 0, 99 do
			for j = 0, 99 do
				local s = fn(37.13 + i * 0.37, 91.71 + j * 0.41)
				seen[s] = true
				local c = LandSurface.COLOURS[LandSurface.MATERIAL[s]]
				sr, sg, sb, count = sr + c[1], sg + c[2], sb + c[3], count + 1
			end
		end
		local map = d.coverRGB[index]
		local fr, fg, fb = map[1] / math.max(1, sr / count), map[2] / math.max(1, sg / count), map[3] / math.max(1, sb / count)
		local rgb: { [string]: { number } } = {}
		for s in seen do
			local c = LandSurface.COLOURS[LandSurface.MATERIAL[s]]
			rgb[s] = {
				math.clamp(map[1] + (c[1] * fr - map[1]) * CONTRAST, 0, 255),
				math.clamp(map[2] + (c[2] * fg - map[2]) * CONTRAST, 0, 255),
				math.clamp(map[3] + (c[3] * fb - map[3]) * CONTRAST, 0, 255),
			}
		end
		-- A surface the sample missed draws in the cover's own colour.
		setmetatable(rgb, { __index = function()
			return map
		end })
		out[index] = { fn = fn, rgb = rgb }
	end
	d.surfaces = out
	return out
end

-- Draws the map piece whose top-left pixel corner is at (left, top) map miles, step miles an
-- image pixel, pw x ph pixels, into pixels (RGBA, every pixel written opaque). density: image
-- pixels to a screen pixel (a high-DPI screen's scale), so lines keep their width on screen.
function MapBase.draw(d: Data, pixels: buffer, pw: number, ph: number, left: number, top: number, step: number, density: number?)
	local scale = density or 1
	local m = step * scale -- miles a screen pixel: what the detail and the line widths follow
	local raster = Raster.new(pixels, pw, ph, function(mx: number, my: number)
		return (mx - left) / m, (my - top) / m
	end, scale)
	local line, polyline = raster.line, raster.polyline
	local n, cellMiles, land, miles = d.cells, d.cellMiles, d.land, d.miles
	local NN = n * n
	local coverRGB = d.coverRGB
	local function clampCell(i: number, j: number): number
		if i < 0 then
			i = 0
		elseif i > n - 1 then
			i = n - 1
		end
		if j < 0 then
			j = 0
		elseif j > n - 1 then
			j = n - 1
		end
		return j * n + i
	end
	local function cellColour(i: number, j: number): (number, number, number)
		local k = clampCell(i, j)
		local c = coverRGB[buffer.readu8(land, k)]
		local f = buffer.readu8(land, NN + k) / 200
		return c[1] * f, c[2] * f, c[3] * f
	end
	local smooth = step < cellMiles * 0.7
	local near = if step <= NEAR then 1 elseif step >= FADE then 0 else (FADE - step) / (FADE - NEAR)
	local surfaces = if near > 0 then d.surfaces or surfacesOf(d) else nil
	local WATER, GRASS = -1, -1
	for index, key in d.coverKeys do
		if key == "water" then
			WATER = index
		elseif key == "grassland" then
			GRASS = index
		end
	end
	local waterRGB = coverRGB[WATER] or { 70, 120, 190 }
	for py = 0, ph - 1 do
		local my = top + (py + 0.5) * step
		local row = py * pw
		if my < 0 or my >= miles then
			for px = 0, pw - 1 do
				buffer.writeu32(pixels, (row + px) * 4, OFF_MAP)
			end
		elseif smooth then
			local gy = my / cellMiles - 0.5
			local j0 = math.floor(gy)
			local fy = gy - j0
			local cj = math.clamp(math.floor(my / cellMiles), 0, n - 1)
			-- The four cells about the last pixel, kept while the row stays within them.
			local lastI = -math.huge
			local r1, g1, b1, r2, g2, b2, r3, g3, b3, r4, g4, b4 = 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
			local s1, s2, s3, s4 = 1, 1, 1, 1 -- hill-shade
			local w1w, w2w, w3w, w4w = 0, 0, 0, 0 -- water (1) or not (0)
			for px = 0, pw - 1 do
				local mx = left + (px + 0.5) * step
				local o = (row + px) * 4
				if mx < 0 or mx >= miles then
					buffer.writeu32(pixels, o, OFF_MAP)
				else
					local gx = mx / cellMiles - 0.5
					local i0 = math.floor(gx)
					local fx = gx - i0
					if i0 ~= lastI then
						lastI = i0
						r1, g1, b1 = cellColour(i0, j0)
						r2, g2, b2 = cellColour(i0 + 1, j0)
						r3, g3, b3 = cellColour(i0, j0 + 1)
						r4, g4, b4 = cellColour(i0 + 1, j0 + 1)
						if surfaces then
							local k1, k2, k3, k4 = clampCell(i0, j0), clampCell(i0 + 1, j0), clampCell(i0, j0 + 1), clampCell(i0 + 1, j0 + 1)
							s1, s2, s3, s4 = buffer.readu8(land, NN + k1) / 200, buffer.readu8(land, NN + k2) / 200, buffer.readu8(land, NN + k3) / 200, buffer.readu8(land, NN + k4) / 200
							w1w = if buffer.readu8(land, k1) == WATER then 1 else 0
							w2w = if buffer.readu8(land, k2) == WATER then 1 else 0
							w3w = if buffer.readu8(land, k3) == WATER then 1 else 0
							w4w = if buffer.readu8(land, k4) == WATER then 1 else 0
						end
					end
					local w1, w2, w3, w4 = (1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy
					local r, g, b = 0, 0, 0
					if near < 1 then
						local far = 1 - near
						r = (r1 * w1 + r2 * w2 + r3 * w3 + r4 * w4) * far
						g = (g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) * far
						b = (b1 * w1 + b2 * w2 + b3 * w3 + b4 * w4) * far
					end
					if surfaces then
						-- The ground here: water where the lake reaches (as the world draws its
						-- shores, half way between cells), else the cell's surface at this point.
						local c
						if w1w * w1 + w2w * w2 + w3w * w3 + w4w * w4 >= 0.5 then
							c = waterRGB
						else
							local cover = buffer.readu8(land, cj * n + math.clamp(math.floor(mx / cellMiles), 0, n - 1))
							if cover == WATER then
								cover = GRASS
							end
							local surface = (surfaces :: any)[cover]
							c = if surface then surface.rgb[surface.fn(mx, my)] else coverRGB[cover]
						end
						local f = (s1 * w1 + s2 * w2 + s3 * w3 + s4 * w4) * near
						r += c[1] * f
						g += c[2] * f
						b += c[3] * f
					end
					buffer.writeu8(pixels, o, math.min(255, r))
					buffer.writeu8(pixels, o + 1, math.min(255, g))
					buffer.writeu8(pixels, o + 2, math.min(255, b))
					buffer.writeu8(pixels, o + 3, 255)
				end
			end
		else
			local j = math.floor(my / cellMiles)
			for px = 0, pw - 1 do
				local mx = left + (px + 0.5) * step
				local o = (row + px) * 4
				if mx < 0 or mx >= miles then
					buffer.writeu32(pixels, o, OFF_MAP)
				else
					local r, g, bl = cellColour(math.floor(mx / cellMiles), j)
					buffer.writeu8(pixels, o, math.min(255, r))
					buffer.writeu8(pixels, o + 1, math.min(255, g))
					buffer.writeu8(pixels, o + 2, math.min(255, bl))
					buffer.writeu8(pixels, o + 3, 255)
				end
			end
		end
	end
	local right, bottom = left + pw * step, top + ph * step
	-- Section-line roads once zoomed in (paved from 5 pixels a mile, gravel from 14, dirt from
	-- 40), as wide as the world's road once that is wider than the least width, so a player on a
	-- road is seen on it (2026-10-28: they were 1 pixel and read as fields).
	if m < 1 / 5 then
		local minClass = if m < 1 / 40 then 1 elseif m < 1 / 14 then 2 else 3
		local studsWide = SECTION_STUDS
		local function width(class: number): number
			return math.max(if class == 3 then 1.8 else 1.3, studsWide[class] / d.studsPerMile / m)
		end
		local size = d.sectionSize
		local I0, I1 = math.max(0, math.floor(left) - 1), math.min(size - 1, math.ceil(right))
		local J0, J1 = math.max(0, math.floor(top) - 1), math.min(size - 1, math.ceil(bottom))
		for J = J0, J1 do
			for I = I0, I1 do
				local v = buffer.readu8(d.sections, J * size + I)
				local east, south = v % 4, (v // 4) % 4
				if east >= minClass then
					line(I, J, I + 1, J, width(east), SECTION_COLOURS[east])
				end
				if south >= minClass then
					line(I, J, I, J + 1, width(south), SECTION_COLOURS[south])
				end
			end
		end
	end
	-- Rivers (wider ones wider), then the main roads; only those near this piece.
	local margin = 2 * m + 0.05
	local function near(points: { number }): boolean
		for i = 1, #points - 1, 2 do
			local x, y = points[i], points[i + 1]
			if x >= left - margin and x <= right + margin and y >= top - margin and y <= bottom + margin then
				return true
			end
		end
		-- A long segment can cross the piece with both ends outside it.
		for i = 3, #points - 1, 2 do
			local ax, ay, bx, by = points[i - 2], points[i - 1], points[i], points[i + 1]
			if math.max(ax, bx) >= left - margin and math.min(ax, bx) <= right + margin and math.max(ay, by) >= top - margin and math.min(ay, by) <= bottom + margin then
				return true
			end
		end
		return false
	end
	local mile = d.studsPerMile
	for _, r in d.rivers do
		if near(r.points) then
			local studs = math.clamp(r.width * 0.18, 12, 220)
			polyline(r.points, math.max(1, studs / mile / m), RIVER)
		end
	end
	if m < 0.15 then
		for _, l in d.rampLines do
			if near(l) then
				polyline(l, math.max(1, 22 / mile / m), RAMP)
			end
		end
	end
	for _, kind in { "highway", "expressway", "interstate" } do
		local style = ROAD_STYLE[kind]
		local width = style.width * math.clamp(0.25 / m, 1, 3)
		for _, road in d.roads do
			if road.kind == kind and near(road.points) then
				polyline(road.points, width, style.colour)
			end
		end
	end
end

return MapBase
