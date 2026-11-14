--!strict
-- Reads the generated world map (ServerStorage.WorldData, written by
-- scripts/export-world-roblox.mjs; server only). Map coordinates are miles east and south of the
-- map's north-west corner; the place is centred on the origin, so a stud position (x, z) is at
-- map miles (x / STUDS_PER_MILE + MAP_MILES / 2, z / STUDS_PER_MILE + MAP_MILES / 2).
-- Tiles are decoded when first needed and kept while in use (each actor holds its own copy):
-- at most KEEP_TILES a Lua VM, the least recently ensured dropped when another loads. Loading one
-- requires (a copy of) its module, which is not allowed in a parallel phase: call WorldMap.ensure
-- in serial for the area about to be read first.
--
-- The road graph (WorldData.Graph, js/worldmap/streets.js): every road on the map as straight
-- edges between nodes, and the town blocks between them (js/worldmap/blocks.js), in tiles of
-- their own (Meta.graph), loaded and kept the same way. Roblox lays its roads from these alone.

local ServerStorage = game:GetService("ServerStorage")
local EncodingService = game:GetService("EncodingService")

local Config = require(game:GetService("ReplicatedStorage").Shared.World.Config)

local Data = ServerStorage:WaitForChild("WorldData", 10)
	or error("[WeatherWorld] ServerStorage.WorldData is missing: run `node scripts/export-world-roblox.mjs`, then reconnect Rojo")
local Meta = require(Data:WaitForChild("Meta")) :: any
local TileModules = Data:WaitForChild("Tiles")
local GraphMeta = Meta.graph
	or error("[WeatherWorld] the world map has no road graph (Meta.graph): re-run `node scripts/export-world-roblox.mjs`, then reconnect Rojo")
local GraphModules = Data:WaitForChild("Graph")

local WorldMap = {}
WorldMap.meta = Meta

-- The scale the map was generated for (js/worldmap/scale.js, written by the export; older exports
-- lack it): the generator sizes roads, lots, buildings and airfields in studs at that scale, so a
-- map made for another drifts against everything built here.
if Meta.studsPerMile ~= nil and Meta.studsPerMile ~= Config.STUDS_PER_MILE then
	-- (each actor loading the map says it too: hard to miss in the output)
	warn(`[WeatherWorld] SCALE MISMATCH: the world map (ServerStorage.WorldData) was exported at {Meta.studsPerMile} studs a mile, but Config.STUDS_PER_MILE is {Config.STUDS_PER_MILE}. Set js/worldmap/scale.js and roblox/Shared/World/Config.luau to the same value and re-run node scripts/export-world-roblox.mjs.`)
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

-- A record string of the export: base64 of zstd-compressed bytes.
local function unpack(text: string): buffer
	if text == "" then
		return buffer.create(0)
	end
	return EncodingService:DecompressBuffer(EncodingService:Base64Decode(buffer.fromstring(text)), Enum.CompressionAlgorithm.Zstd)
end

local tiles: { [number]: Tile } = {}
-- Tiles kept decoded a VM (a chunk's reads reach at most 4 of the 50-mile tiles; a few more
-- spare for players far apart), and when each was last loaded or ensured.
local KEEP_TILES = 8
local tileCount = 0
local useClock = 0
local lastUse: { [number]: number } = {}

-- Drops the least recently used tiles down to room for one more (serial: only when loading),
-- never one marked by the current ensure().
local function evict()
	while tileCount >= KEEP_TILES do
		local oldest, oldestUse = nil, useClock
		for key, use in lastUse do
			if use < oldestUse then
				oldest, oldestUse = key, use
			end
		end
		if oldest == nil then
			return
		end
		tiles[oldest] = nil
		lastUse[oldest] = nil
		tileCount -= 1
	end
end

function WorldMap.tile(ti: number, tj: number): Tile
	ti = math.clamp(ti, 0, TILES - 1)
	tj = math.clamp(tj, 0, TILES - 1)
	local key = tj * TILES + ti
	local tile = tiles[key]
	if not tile then
		local module = TileModules:FindFirstChild(`T{ti}_{tj}`)
		assert(module, `world tile T{ti}_{tj} is missing`)
		-- A copy of the module is required, so the module's own (cached) result does not keep the
		-- base64 text alive beside the decoded buffer, and a dropped tile can load again.
		-- Outside the area loaded with ensure() in a parallel phase: an empty tile, not cached.
		local ok, source = pcall(function()
			local copy: any = module:Clone()
			return require(copy) :: any
		end)
		if not ok then
			warn(`[WeatherWorld] map tile T{ti}_{tj} read outside the prepared area`)
			return { data = buffer.create(S * S * 5 + CORNERS * CORNERS), rivers = {}, roads = {}, crossings = {}, sites = nil, ti = ti, tj = tj }
		end
		evict()
		tile = { data = unpack(source.data), rivers = source.rivers, roads = source.roads, crossings = source.crossings or {}, sites = source.sites, ti = ti, tj = tj }
		tiles[key] = tile
		tileCount += 1
		lastUse[key] = useClock
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

-- The road graph.
local G_TILE_MI = GraphMeta.tileMiles :: number
local G_TILES = GraphMeta.tiles :: number
local G_UNIT = GraphMeta.unit :: number
local EDGE_BYTES, BLOCK_BYTES = 11, 12
-- A graph tile's records, and its centre in the graph's units (records hold offsets from it).
export type GraphTile = { edges: buffer, blocks: buffer, ox: number, oz: number }
-- A road edge in studs: its kind (Meta.graph.kinds) and, for the node at each end, how the road
-- ends there (0 no end, 1 cul-de-sac, 2 dead end, 3 barrier), its control (0 none, 1 stop,
-- 2 signal) and how many roads meet there.
export type Edge = { kind: string, ax: number, az: number, bx: number, bz: number, endA: number, endB: number, controlA: number, controlB: number, degreeA: number, degreeB: number }
-- A town block in studs between road centre lines (or open land), and the road kind on its
-- north (z0), south, west (x0) and east sides (nil where there is none).
export type Block = { x0: number, z0: number, x1: number, z1: number, north: string?, south: string?, west: string?, east: string? }

local graphTiles: { [number]: GraphTile } = {}
local KEEP_GRAPH = 16
local graphCount = 0
local graphUse: { [number]: number } = {}

local function joined(parts: { buffer }): buffer
	local total = 0
	for _, b in parts do
		total += buffer.len(b)
	end
	local out, at = buffer.create(total), 0
	for _, b in parts do
		buffer.copy(out, at, b)
		at += buffer.len(b)
	end
	return out
end

local function graphTile(gi: number, gj: number): GraphTile
	local key = gj * G_TILES + gi
	local tile = graphTiles[key]
	if not tile then
		local ox = math.round(((gi + 0.5) * G_TILE_MI - HALF) * MILE / G_UNIT)
		local oz = math.round(((gj + 0.5) * G_TILE_MI - HALF) * MILE / G_UNIT)
		local edges, blocks = {}, {}
		-- (Copies are required, as for the map tiles; not allowed in a parallel phase.)
		local ok = pcall(function()
			for k = 1, GraphMeta.parts[key + 1] do
				local module = GraphModules:FindFirstChild(`G{gi}_{gj}_{k}`)
				assert(module, `road graph tile G{gi}_{gj}_{k} is missing`)
				local source = require(module:Clone()) :: any
				table.insert(edges, unpack(source.edges))
				table.insert(blocks, unpack(source.blocks))
			end
		end)
		if not ok then
			warn(`[WeatherWorld] road graph tile G{gi}_{gj} read outside the prepared area`)
			return { edges = buffer.create(0), blocks = buffer.create(0), ox = ox, oz = oz }
		end
		while graphCount >= KEEP_GRAPH do
			local oldest, oldestUse = nil, useClock
			for k, use in graphUse do
				if use < oldestUse then
					oldest, oldestUse = k, use
				end
			end
			if oldest == nil then
				break
			end
			graphTiles[oldest] = nil
			graphUse[oldest] = nil
			graphCount -= 1
		end
		tile = { edges = joined(edges), blocks = joined(blocks), ox = ox, oz = oz }
		graphTiles[key] = tile
		graphCount += 1
		graphUse[key] = useClock
	end
	return tile
end

-- The graph tiles a box (studs) touches.
local function graphTilesFor(x0: number, z0: number, x1: number, z1: number, mark: boolean?): { GraphTile }
	local mx0, my0 = WorldMap.milesAt(x0, z0)
	local mx1, my1 = WorldMap.milesAt(x1, z1)
	local list = {}
	for gj = math.clamp(math.floor(my0 / G_TILE_MI), 0, G_TILES - 1), math.clamp(math.floor(my1 / G_TILE_MI), 0, G_TILES - 1) do
		for gi = math.clamp(math.floor(mx0 / G_TILE_MI), 0, G_TILES - 1), math.clamp(math.floor(mx1 / G_TILE_MI), 0, G_TILES - 1) do
			if mark and graphTiles[gj * G_TILES + gi] then
				graphUse[gj * G_TILES + gi] = useClock
			end
			table.insert(list, graphTile(gi, gj))
		end
	end
	return list
end

-- Every road edge with a part inside a box (studs), each once.
function WorldMap.roadEdges(x0: number, z0: number, x1: number, z1: number): { Edge }
	local kinds = GraphMeta.kinds
	local list: { Edge } = {}
	local seen: { [string]: boolean } = {}
	for _, tile in graphTilesFor(x0, z0, x1, z1) do
		local data, ox, oz = tile.edges, tile.ox, tile.oz
		for o = 0, buffer.len(data) - EDGE_BYTES, EDGE_BYTES do
			local ax, az = (buffer.readi16(data, o + 3) + ox) * G_UNIT, (buffer.readi16(data, o + 5) + oz) * G_UNIT
			local bx, bz = (buffer.readi16(data, o + 7) + ox) * G_UNIT, (buffer.readi16(data, o + 9) + oz) * G_UNIT
			if math.max(ax, bx) >= x0 and math.min(ax, bx) <= x1 and math.max(az, bz) >= z0 and math.min(az, bz) <= z1 then
				local kind = buffer.readu8(data, o)
				local key = `{kind},{ax},{az},{bx},{bz}`
				if not seen[key] then
					seen[key] = true
					local fa, fb = buffer.readu8(data, o + 1), buffer.readu8(data, o + 2)
					table.insert(list, {
						kind = kinds[kind + 1], ax = ax, az = az, bx = bx, bz = bz,
						endA = fa % 4, endB = fb % 4, controlA = (fa // 4) % 4, controlB = (fb // 4) % 4, degreeA = fa // 16, degreeB = fb // 16,
					})
				end
			end
		end
	end
	return list
end

-- Every town block touching a box (studs), each once.
function WorldMap.blocks(x0: number, z0: number, x1: number, z1: number): { Block }
	local kinds = GraphMeta.kinds
	local list: { Block } = {}
	local seen: { [string]: boolean } = {}
	for _, tile in graphTilesFor(x0, z0, x1, z1) do
		local data, ox, oz = tile.blocks, tile.ox, tile.oz
		for o = 0, buffer.len(data) - BLOCK_BYTES, BLOCK_BYTES do
			local bx0, bz0 = (buffer.readi16(data, o) + ox) * G_UNIT, (buffer.readi16(data, o + 2) + oz) * G_UNIT
			local bx1, bz1 = (buffer.readi16(data, o + 4) + ox) * G_UNIT, (buffer.readi16(data, o + 6) + oz) * G_UNIT
			if bx1 >= x0 and bx0 <= x1 and bz1 >= z0 and bz0 <= z1 then
				local key = `{bx0},{bz0},{bx1},{bz1}`
				if not seen[key] then
					seen[key] = true
					local function side(at: number): string?
						local v = buffer.readu8(data, o + at)
						return if v > 0 then kinds[v] else nil
					end
					table.insert(list, { x0 = bx0, z0 = bz0, x1 = bx1, z1 = bz1, north = side(8), south = side(9), west = side(10), east = side(11) })
				end
			end
		end
	end
	return list
end

-- Loads every tile within a mile and a half of a box (miles), so reads there can run in parallel
-- (and marks them used: they are the last a VM drops).
function WorldMap.ensure(mx0: number, my0: number, mx1: number, my1: number)
	useClock += 1
	mx0, my0, mx1, my1 = mx0 - 1.5, my0 - 1.5, mx1 + 1.5, my1 + 1.5
	-- Mark the tiles already loaded first, so loading the others cannot drop them.
	for tj = math.clamp(math.floor(my0 / TILE_MI), 0, TILES - 1), math.clamp(math.floor(my1 / TILE_MI), 0, TILES - 1) do
		for ti = math.clamp(math.floor(mx0 / TILE_MI), 0, TILES - 1), math.clamp(math.floor(mx1 / TILE_MI), 0, TILES - 1) do
			local key = tj * TILES + ti
			if tiles[key] then
				lastUse[key] = useClock
			end
		end
	end
	WorldMap.tilesFor(mx0, my0, mx1, my1)
	local x0, z0 = WorldMap.studsAt(mx0, my0)
	local x1, z1 = WorldMap.studsAt(mx1, my1)
	graphTilesFor(x0, z0, x1, z1, true)
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
