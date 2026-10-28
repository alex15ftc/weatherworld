--!strict
-- Reads the generated world map (ServerStorage.WorldData, written by
-- scripts/export-world-roblox.mjs; server only). Map coordinates are miles east and south of the
-- map's north-west corner; the place is centred on the origin, so a stud position (x, z) is at
-- map miles (x / STUDS_PER_MILE + MAP_MILES / 2, z / STUDS_PER_MILE + MAP_MILES / 2).
-- Tiles are decoded when first needed and kept (each actor holds its own copy). Loading one
-- requires its module, which is not allowed in a parallel phase: call WorldMap.ensure in serial
-- for the area about to be read first.

local ServerStorage = game:GetService("ServerStorage")

local Config = require(script.Parent.Config)
local Base64 = require(script.Parent.Base64)

local Data = ServerStorage:WaitForChild("WorldData", 10)
	or error("[WeatherWorld] ServerStorage.WorldData is missing: run `node scripts/export-world-roblox.mjs`, then reconnect Rojo")
local Meta = require(Data:WaitForChild("Meta")) :: any
local TileModules = Data:WaitForChild("Tiles")

local WorldMap = {}
WorldMap.meta = Meta

-- The scale the map was generated for (js/worldmap/scale.js, written by the export; older exports
-- lack it): the generator sizes roads, lots, buildings and airfields in studs at that scale, so a
-- map made for another drifts against everything built here.
if Meta.studsPerMile ~= nil and Meta.studsPerMile ~= Config.STUDS_PER_MILE then
	-- (each actor loading the map says it too: hard to miss in the output)
	warn(`[WeatherWorld] SCALE MISMATCH: the world map (ServerStorage.WorldData) was exported at {Meta.studsPerMile} studs a mile, but Config.STUDS_PER_MILE is {Config.STUDS_PER_MILE}. Set js/worldmap/scale.js and roblox/src/shared/World/Config.luau to the same value and re-run node scripts/export-world-roblox.mjs.`)
end

local CELL = Meta.cellMiles :: number
local TILE_MI = Meta.tileMiles :: number
local TILES = Meta.tiles :: number
local BORDER = Meta.border :: number
local S = Meta.tileCells :: number
local CORNERS = Meta.corners :: number
local TILE_CELLS = TILE_MI / CELL
local HALF = Config.MAP_MILES / 2
local MILE = Config.STUDS_PER_MILE
local BASE_M = Meta.baseM :: number

local COVER_OFF, REGION_OFF, LAKE_OFF, SECTION_OFF = S * S * 2, S * S * 3, S * S * 4, S * S * 5

WorldMap.cover = {} :: { [string]: number }
for i, key in Meta.cover do
	WorldMap.cover[key] = i - 1
end
WorldMap.regions = {} :: { [string]: number }
for i, key in Meta.regions do
	WorldMap.regions[key] = i - 1
end
local lakeSurface: { [number]: number } = {}
for _, lake in Meta.lakes do
	lakeSurface[lake.id] = lake.surfaceM
end

export type Tile = { data: buffer, rivers: { number }, roads: { number }, crossings: { number }, sites: any, ti: number, tj: number }

local decode = Base64.decode

local tiles: { [number]: Tile } = {}

function WorldMap.tile(ti: number, tj: number): Tile
	ti = math.clamp(ti, 0, TILES - 1)
	tj = math.clamp(tj, 0, TILES - 1)
	local key = tj * TILES + ti
	local tile = tiles[key]
	if not tile then
		local module = TileModules:FindFirstChild(`T{ti}_{tj}`)
		assert(module, `world tile T{ti}_{tj} is missing`)
		-- Outside the area loaded with ensure() in a parallel phase: an empty tile, not cached.
		local ok, source = pcall(require, module)
		if not ok then
			warn(`[WeatherWorld] map tile T{ti}_{tj} read outside the prepared area`)
			return { data = buffer.create(S * S * 5 + CORNERS * CORNERS), rivers = {}, roads = {}, crossings = {}, sites = nil, ti = ti, tj = tj }
		end
		tile = { data = decode(source.data), rivers = source.rivers, roads = source.roads, crossings = source.crossings or {}, sites = source.sites, ti = ti, tj = tj }
		tiles[key] = tile
	end
	return tile
end

-- Map miles at a stud position.
function WorldMap.milesAt(x: number, z: number): (number, number)
	return x / MILE + HALF, z / MILE + HALF
end

function WorldMap.studsAt(mx: number, my: number): (number, number)
	return (mx - HALF) * MILE, (my - HALF) * MILE
end

-- The tile holding global cell (gi, gj) and the cell's index within that tile's rasters.
local function cell(gi: number, gj: number): (Tile, number)
	local ti, tj = math.clamp(gi // TILE_CELLS, 0, TILES - 1), math.clamp(gj // TILE_CELLS, 0, TILES - 1)
	local tile = WorldMap.tile(ti, tj)
	local li = math.clamp(gi - ti * TILE_CELLS + BORDER, 0, S - 1)
	local lj = math.clamp(gj - tj * TILE_CELLS + BORDER, 0, S - 1)
	return tile, lj * S + li
end

local function elevCell(data: buffer, o: number): number
	return buffer.readu16(data, o * 2) / 10 + BASE_M
end

local function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number
	return p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)))
end

-- Ground height (m) of the large-scale map at a point, smooth between cells (Catmull-Rom).
function WorldMap.elevationM(mx: number, my: number): number
	local gx, gy = mx / CELL - 0.5, my / CELL - 0.5
	local i0, j0 = math.floor(gx), math.floor(gy)
	local fx, fy = gx - i0, gy - j0
	local tile, o = cell(i0, j0)
	local data = tile.data
	-- The 4 x 4 cells round the point, all inside this tile's border.
	local rows = table.create(4, 0)
	for b = -1, 2 do
		local row = o + b * S
		rows[b + 2] = catmull(elevCell(data, row - 1), elevCell(data, row), elevCell(data, row + 1), elevCell(data, row + 2), fx)
	end
	return catmull(rows[1], rows[2], rows[3], rows[4], fy)
end

-- Land cover, cover region and lake id of the cell at a point.
function WorldMap.cellAt(mx: number, my: number): (number, number, number)
	local tile, o = cell(math.floor(mx / CELL), math.floor(my / CELL))
	return buffer.readu8(tile.data, COVER_OFF + o), buffer.readu8(tile.data, REGION_OFF + o), buffer.readu8(tile.data, LAKE_OFF + o)
end

-- How much of the neighbourhood is lake (0 to 1, bilinear between cell centres) and the lake there.
function WorldMap.lakeAt(mx: number, my: number): (number, number?)
	local gx, gy = mx / CELL - 0.5, my / CELL - 0.5
	local i0, j0 = math.floor(gx), math.floor(gy)
	local fx, fy = gx - i0, gy - j0
	local tile, o = cell(i0, j0)
	local data, id = tile.data, 0
	local function at(offset: number): number
		local v = buffer.readu8(data, LAKE_OFF + o + offset)
		if v > 0 then
			id = v
		end
		return if v > 0 then 1 else 0
	end
	local a, b, c, d = at(0), at(1), at(S), at(S + 1)
	local share = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy
	return share, if id > 0 then lakeSurface[id] else nil
end

-- Section road classes at a corner of the mile grid: the road east of it and the road south.
function WorldMap.sectionAt(I: number, J: number): (number, number)
	if I < 0 or J < 0 or I > Config.MAP_MILES or J > Config.MAP_MILES then
		return 0, 0
	end
	local ti, tj = math.clamp(I // TILE_MI, 0, TILES - 1), math.clamp(J // TILE_MI, 0, TILES - 1)
	local tile = WorldMap.tile(ti, tj)
	local v = buffer.readu8(tile.data, SECTION_OFF + (J - tj * TILE_MI) * CORNERS + (I - ti * TILE_MI))
	return v % 4, (v // 4) % 4
end

-- The tiles a box (in miles) touches.
function WorldMap.tilesFor(mx0: number, my0: number, mx1: number, my1: number): { Tile }
	local list = {}
	for tj = math.clamp(math.floor(my0 / TILE_MI), 0, TILES - 1), math.clamp(math.floor(my1 / TILE_MI), 0, TILES - 1) do
		for ti = math.clamp(math.floor(mx0 / TILE_MI), 0, TILES - 1), math.clamp(math.floor(mx1 / TILE_MI), 0, TILES - 1) do
			table.insert(list, WorldMap.tile(ti, tj))
		end
	end
	return list
end

-- Loads every tile within a mile and a half of a box (miles), so reads there can run in parallel.
function WorldMap.ensure(mx0: number, my0: number, mx1: number, my1: number)
	WorldMap.tilesFor(mx0 - 1.5, my0 - 1.5, mx1 + 1.5, my1 + 1.5)
end

-- The nearest settlement to a point (miles) and its distance.
function WorldMap.nearestSettlement(mx: number, my: number): (any, number)
	local best, distance = nil, math.huge
	for _, s in Meta.settlements do
		local d = math.sqrt((s.x - mx) ^ 2 + (s.y - my) ^ 2)
		if d < distance then
			best, distance = s, d
		end
	end
	return best, distance
end

return WorldMap
