--!strict
-- The map every product screen draws on (it was the world map, client/MapView), drawn from the
-- map's data (ReplicatedStorage Shared.MapData.MapVector, MapBase.luau): land cover with
-- hill-shading, the section-line roads once zoomed in, rivers and main roads as lines, and
-- labels for cities, towns (more of them the closer in), rivers and highways. Every player is
-- marked. Scroll to zoom about the cursor, drag to pan, C to centre on yourself.
--
-- The map is made of tiles, as a web map is: TILE pixels square, at zoom levels LEVEL_STEP
-- apart, each drawn once at full resolution and kept while there is room (MAX_TILE_PIXELS), so
-- panning only draws the tiles coming into view. Between levels the tiles on show are scaled
-- by the GPU, and the next level's tiles are drawn a few a frame (FRAME_BUDGET), nearest the
-- middle first, replacing them as they come.
--
-- A product screen sets an overlay: it may mute the base map so its own colours read (a dark
-- veil over the map, not a redraw), draws shapes into its own clear tiles over the map (fill,
-- hatch, stroke; rings are flat lists of map miles, x1, y1, x2, y2..., filled by the even-odd
-- rule), may draw raster products (radar) into one image of the whole view at up to MAX_RES
-- pixels, and places labels before the map's own.

local Players = game:GetService("Players")
local UserInputService = game:GetService("UserInputService")
local AssetService = game:GetService("AssetService")
local EncodingService = game:GetService("EncodingService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage.Shared.World.Config)
local Interchanges = require(ReplicatedStorage.Shared.World.Interchanges)
local Raster = require(script.Parent.Raster)
local MapBase = require(script.Parent.MapBase)

local MapCanvas = {}

export type Colour = Raster.Colour
export type Rings = Raster.Rings
-- fill, hatch, stroke, dot, polar... (Raster.luau).
export type Draw = Raster.Raster
export type Labels = {
	-- A boxed label on one of the rings' points: in view, as near the middle as it can be, clear
	-- of the labels already placed. False if there was no room.
	onRing: (text: string, rings: Rings, border: Colour) -> boolean,
	-- A boxed label centred on a map point, if it is in view and clear of the others.
	at: (text: string, mx: number, my: number, border: Colour) -> boolean,
}
-- A byte grid laid over the map as an image the GPU scales (the satellite, a radar mosaic):
-- width x height cells of cellMiles from the map's north-west corner, coloured by a 256-entry
-- RGBA table (lut[byte * 4 + 1 .. 4]; byte 0 clear). key names its bytes (a product's id and
-- time): its colours are worked out once a key. smooth: blended between cells, else blocky.
export type Grid = {
	key: string,
	bytes: buffer,
	width: number,
	height: number,
	cellMiles: number,
	lut: { number },
	alpha: number,
	smooth: boolean?,
}
export type Overlay = {
	muted: boolean?,
	-- Byte grids (at most MAX_RES cells a side), bottom first, under the raster image: drawn
	-- once each and only moved and scaled with the view.
	grids: (() -> { Grid })?,
	-- Shapes, drawn into the product tiles (sharp at every zoom), over the raster products.
	draw: ((Draw) -> ())?,
	-- Shapes drawn under the raster products (the outlook's fill, so radar shows over it).
	drawUnder: ((Draw) -> ())?,
	-- Raster products (radar), drawn into one image of the view.
	drawRaster: ((Draw) -> ())?,
	labels: ((Labels) -> ())?,
	-- Names what drawRaster would draw now (a radar scan's id and time): images drawn are kept
	-- under it while the view stays put, so a radar loop's frames are drawn once a view.
	rasterKey: (() -> string?)?,
	-- Marks over the raster products (lightning, rotation), drawn into their own image of the view
	-- and kept under marksKey, so a radar loop's frames are not drawn again when they change.
	drawMarks: ((Draw) -> ())?,
	marksKey: (() -> string?)?,
	-- What is at the map point under the cursor (a radar gate's value), shown in the readout.
	hover: ((mx: number, my: number) -> string?)?,
}

local player = Players.LocalPlayer
local MILE = Config.STUDS_PER_MILE
local HALF = Config.MAP_MILES / 2
local MAX_RES = 1024 -- the raster products' image (an EditableImage is at most 1024 square)
local MIN_MPP = 0.01 -- miles per pixel when fully zoomed in (6 studs a pixel at 600 studs a mile)
local TILE = 256 -- screen pixels (GUI units) a side; drawn at TILE * density image pixels
local LEVEL_STEP = math.sqrt(2) -- so a tile is shown between 0.84 and 1.19 of its drawn size
-- image pixels of tiles kept per layer while the map is open (about 11 MB; three layers). All of
-- it is let go when the map closes (setVisible): EditableImage memory is a small per-device budget
-- the game shares, and keeping ~90 MB of tiles after closing ran it out (2026-10-28)
local MAX_TILE_PIXELS = 44 * 256 * 256
local FRAME_BUDGET = 0.010 -- seconds of tile drawing a frame (at least one tile)
local SETTLE_SECONDS = 0.25 -- the radar image is drawn again once the view has been still this long
-- The whole map as one image under the tiles (BACKDROP pixels square), drawn once a few rows a
-- frame and kept: a zoom shows it, scaled, wherever the new level's tiles are not drawn yet.
local BACKDROP = 1024
local BACKDROP_ROWS = 32
-- A muted map keeps this share of its colour, the rest going to MUTE_TO.
local MUTE_KEEP, MUTE_TO = 0.38, { 22, 26, 32 }

local COVER_COLOURS: { [string]: { number } } = {
	water = { 70, 120, 190 }, cropland = { 196, 178, 112 }, irrigated = { 118, 160, 70 }, grassland = { 168, 172, 112 },
	sandhillGrass = { 190, 180, 128 }, forest = { 62, 102, 58 }, riparian = { 86, 124, 70 }, breaks = { 160, 132, 104 },
	redRange = { 176, 120, 88 }, tallgrass = { 130, 150, 90 }, urban = { 128, 124, 130 }, suburban = { 176, 170, 164 },
}

-- Map data ----------------------------------------------------------------------------------

local data: any = nil
local base: MapBase.Data

local function unpack(text: string): buffer
	local raw = EncodingService:Base64Decode(buffer.fromstring(text))
	return EncodingService:DecompressBuffer(raw, Enum.CompressionAlgorithm.Zstd)
end

-- Interchange ramps as polylines in map miles (from the same geometry the world is built with).
local rampLines: { { number } } = {}

local function loadData()
	data = require(ReplicatedStorage.Shared:WaitForChild("MapData"):WaitForChild("MapVector")) :: any
	for _, c in data.crossings or {} do
		if c.type == "interchange" then
			local rec = {
				interchange = true, road = 0, x = (c.x - HALF) * MILE, z = (c.y - HALF) * MILE,
				ux = c.ux, uz = c.uy, vx = c.vx, vz = c.vy, exit = c.exit, uEnd = c.uEnd or 0, vEnd = c.vEnd or 0,
			}
			for _, ramp in Interchanges.ramps(rec :: any) do
				local line = {}
				for _, p in ramp.points do
					table.insert(line, p.X / MILE + HALF)
					table.insert(line, p.Y / MILE + HALF)
				end
				table.insert(rampLines, line)
			end
		end
	end
	local coverRGB: { [number]: { number } } = {}
	local coverKeys: { [number]: string } = {}
	for i, key in data.cover do
		coverRGB[i - 1] = COVER_COLOURS[key] or { 255, 0, 255 }
		coverKeys[i - 1] = key
	end
	base = {
		miles = data.miles, cells = data.cells, cellMiles = data.miles / data.cells,
		land = unpack(data.land), sections = unpack(data.sections), sectionSize = data.sectionSize,
		coverKeys = coverKeys, coverRGB = coverRGB, rivers = data.rivers, roads = data.roads, rampLines = rampLines, studsPerMile = MILE,
	}
end

-- View --------------------------------------------------------------------------------------

local viewport: Frame
local baseLayer: Frame -- the map's tiles
local veil: Frame -- mutes the map under a product
local rasterImage: ImageLabel -- the raster products (radar)
local marksImage: ImageLabel -- the marks over them (lightning, rotation): a child of rasterImage
local underLayer: Frame -- the product's tiles under the raster products
local overLayer: Frame -- the product's tiles over them
local labelLayer: Frame
local gridLayer: Frame -- the byte grids (satellite, radar mosaics), under the raster image
local readout: TextLabel? = nil
local hoverAt: Vector2? = nil -- the map point (miles) under the cursor
local markers: { [Player]: Marker } = {}
local labels: { TextLabel } = {}
local overlay: Overlay? = nil
local visible = false
-- Where to mark players whose characters are not streamed in, and whether to name them (a layer
-- sets it while it is on: the Chasers layer).
export type MarkerSource = {
	position: (Player) -> (number?, number?, number?), -- map miles and heading (degrees from north)
	names: boolean,
}
local markerSource: MarkerSource? = nil

local centreX, centreY = HALF, HALF -- map miles at the middle of the view
local mpp = math.huge -- map miles per screen pixel (the whole map to start with)
local viewChanged = true
local labelsDue = true
local rasterDue = false
local clickHandler: ((mx: number, my: number) -> ())? = nil
local lastChange = 0
local lastLabels = 0
-- While a layer's tiles are drawn, the zoom they are drawn at (MapCanvas.milesPerPixel).
local drawingMpp: number? = nil

local function viewSize(): Vector2
	return viewport.AbsoluteSize
end

local function fullMpp(): number
	local size = viewSize()
	return data.miles / math.max(1, math.min(size.X, size.Y))
end

local function clampView()
	mpp = math.clamp(mpp, MIN_MPP, fullMpp())
	local size = viewSize()
	local hx, hy = size.X * mpp / 2, size.Y * mpp / 2
	centreX = if hx * 2 >= data.miles then data.miles / 2 else math.clamp(centreX, hx, data.miles - hx)
	centreY = if hy * 2 >= data.miles then data.miles / 2 else math.clamp(centreY, hy, data.miles - hy)
end

-- Screen pixel (within the viewport) of a map point.
local function toScreen(mx: number, my: number): (number, number)
	local size = viewSize()
	return (mx - centreX) / mpp + size.X / 2, (my - centreY) / mpp + size.Y / 2
end

-- Tiles --------------------------------------------------------------------------------------

type Tile = {
	k: number, -- zoom level
	i: number, -- column and row in that level
	j: number,
	image: ImageLabel,
	editable: any?,
	version: number, -- what it shows (-1: nothing yet)
	seen: number, -- when it was last in view
}
type Layer = { tiles: { [string]: Tile }, count: number, parent: Frame }
type Want = { i: number, j: number, d: number }

local baseTiles: Layer
local underTiles: Layer
local overTiles: Layer
local overlayVersion = 0
local level = 0
-- Image pixels to a screen pixel. Roblox does not say a screen's display scaling, but its GUI
-- units are physical pixels divided by it, so a view 989.33 units wide on a 150% screen gives
-- it away. A screen whose sizes come out whole at 1 is drawn at 1 (Workspace attribute
-- MapPixelDensity sets it).
local density = 1
local tilePx = TILE
local maxTiles = 110
local scratch = buffer.create(TILE * TILE * 4)

local function pixelDensity(): number
	local forced = workspace:GetAttribute("MapPixelDensity")
	if type(forced) == "number" and forced >= 1 and forced <= 4 then
		return forced
	end
	local camera = workspace.CurrentCamera
	if not camera then
		return 1
	end
	local size = camera.ViewportSize
	for _, s in { 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 3 } do
		local w, h = size.X * s, size.Y * s
		if math.abs(w - math.round(w)) < 0.02 and math.abs(h - math.round(h)) < 0.02 then
			return s
		end
	end
	return 1
end
local wanted: { Want } = {} -- the current level's tiles in view, nearest the middle first
local wantedKeys: { [string]: boolean } = {}

local function levelMpp(k: number): number
	return MIN_MPP * LEVEL_STEP ^ k
end

local function levelOf(m: number): number
	return math.max(0, math.round(math.log(m / MIN_MPP) / math.log(LEVEL_STEP)))
end

local function keyOf(k: number, i: number, j: number): string
	return `{k}/{i}/{j}`
end

local function newLayer(parent: Frame): Layer
	return { tiles = {}, count = 0, parent = parent }
end

local function dropTile(layer: Layer, key: string)
	local tile = layer.tiles[key]
	if not tile then
		return
	end
	if tile.editable then
		tile.editable:Destroy()
	end
	tile.image:Destroy()
	layer.tiles[key] = nil
	layer.count -= 1
end

-- Lets go of the tiles longest out of view while there are more than maxTiles (or `extra`
-- more than the room left, when an image could not be made). Tiles in view are kept.
local function evict(layer: Layer, extra: number?)
	local over = layer.count - maxTiles + (extra or 0)
	if over <= 0 then
		return
	end
	local old = {}
	for key, tile in layer.tiles do
		if not tile.image.Visible and not wantedKeys[key] then
			table.insert(old, { key = key, seen = tile.seen })
		end
	end
	table.sort(old, function(a, b)
		return a.seen < b.seen
	end)
	for n = 1, math.min(over, #old) do
		dropTile(layer, old[n].key)
	end
end

local function tileOf(layer: Layer, k: number, i: number, j: number): Tile
	local key = keyOf(k, i, j)
	local tile = layer.tiles[key]
	if tile then
		return tile
	end
	local image = Instance.new("ImageLabel")
	image.BackgroundTransparency = 1
	image.Visible = false
	image.Parent = layer.parent
	local made: Tile = { k = k, i = i, j = j, image = image, editable = nil, version = -1, seen = os.clock() }
	layer.tiles[key] = made
	layer.count += 1
	return made
end

local function newImage(): any
	local ok, made = pcall(function()
		return (AssetService :: any):CreateEditableImage({ Size = Vector2.new(tilePx, tilePx) })
	end)
	return if ok then made else nil
end

-- Writes the scratch buffer into a tile's image (made when first needed). False if no image
-- could be made (the device's image memory is full even after letting old tiles go).
local function show(layer: Layer, tile: Tile): boolean
	if not tile.editable then
		local made = newImage()
		if not made then
			evict(layer, 8)
			made = newImage()
			if not made then
				return false
			end
		end
		tile.editable = made
		tile.image.ImageContent = Content.fromObject(made)
	end
	tile.editable:WritePixelsBuffer(Vector2.zero, Vector2.new(tilePx, tilePx), scratch)
	return true
end

local function drawBaseTile(tile: Tile)
	local t = levelMpp(tile.k)
	MapBase.draw(base, scratch, tilePx, tilePx, tile.i * TILE * t, tile.j * TILE * t, t / density, density)
	if show(baseTiles, tile) then
		tile.version = 0
	end
end

-- One product tile of a layer (under or over the raster products), drawn by the overlay's
-- function for it.
local function drawShapeTile(layer: Layer, tile: Tile, drawFn: ((Draw) -> ())?)
	local t = levelMpp(tile.k)
	local left, top = tile.i * TILE * t, tile.j * TILE * t
	buffer.fill(scratch, 0, 0)
	local raster = Raster.new(scratch, tilePx, tilePx, function(mx: number, my: number)
		return (mx - left) / t, (my - top) / t
	end, density, tile.i * tilePx, tile.j * tilePx, Config.MAP_MILES)
	if drawFn then
		drawingMpp = t
		local ok, problem = pcall(drawFn, raster)
		drawingMpp = nil
		if not ok then
			warn(`[MapCanvas] product drawing failed: {problem}`)
		end
	end
	if raster.drawn() then
		if not show(layer, tile) then
			return
		end
	elseif tile.editable then
		-- Nothing here: no image kept for it.
		tile.editable:Destroy()
		tile.editable = nil
		tile.image.ImageContent = Content.none
	end
	tile.version = overlayVersion
end

-- The current level's tiles in view, nearest the middle first.
local function findWanted()
	table.clear(wanted)
	table.clear(wantedKeys)
	local size = viewport.AbsoluteSize
	local span = TILE * levelMpp(level)
	local last = math.ceil(data.miles / span) - 1
	local i0 = math.max(0, math.floor((centreX - size.X * mpp / 2) / span))
	local i1 = math.min(last, math.floor((centreX + size.X * mpp / 2) / span))
	local j0 = math.max(0, math.floor((centreY - size.Y * mpp / 2) / span))
	local j1 = math.min(last, math.floor((centreY + size.Y * mpp / 2) / span))
	for j = j0, j1 do
		for i = i0, i1 do
			wantedKeys[keyOf(level, i, j)] = true
			table.insert(wanted, { i = i, j = j, d = ((i + 0.5) * span - centreX) ^ 2 + ((j + 0.5) * span - centreY) ^ 2 })
		end
	end
	table.sort(wanted, function(a, b)
		return a.d < b.d
	end)
end

-- Puts every kept tile where the view has it. The current level's finished tiles go on top; a
-- tile of another level is shown under them only while the current level still has gaps. (A
-- product tile with nothing drawn has no image and is never shown.)
local function placeTiles()
	local size = viewport.AbsoluteSize
	local now = os.clock()
	for _, layer in { baseTiles, underTiles, overTiles } do
		local complete = true
		for _, w in wanted do
			local tile = layer.tiles[keyOf(level, w.i, w.j)]
			if not tile or tile.version < 0 then
				complete = false
				break
			end
		end
		for _, tile in layer.tiles do
			local t = levelMpp(tile.k)
			local x0 = math.floor((tile.i * TILE * t - centreX) / mpp + size.X / 2)
			local x1 = math.floor(((tile.i + 1) * TILE * t - centreX) / mpp + size.X / 2)
			local y0 = math.floor((tile.j * TILE * t - centreY) / mpp + size.Y / 2)
			local y1 = math.floor(((tile.j + 1) * TILE * t - centreY) / mpp + size.Y / 2)
			local inView = x1 > 0 and y1 > 0 and x0 < size.X and y0 < size.Y
			local current = tile.k == level
			local on = inView and tile.version >= 0 and tile.editable ~= nil and (current or not complete)
			-- Another level's product tile stands in only if it shows the product as it is now
			-- (not a layer just turned off).
			if layer ~= baseTiles and (not overlay or (not current and tile.version ~= overlayVersion)) then
				on = false
			end
			if layer == underTiles and not (overlay and overlay.drawUnder) then
				on = false
			end
			tile.image.Visible = on
			if inView and current then
				tile.seen = now
			end
			if on then
				tile.seen = now
				tile.image.Position = UDim2.fromOffset(x0, y0)
				tile.image.Size = UDim2.fromOffset(x1 - x0, y1 - y0)
				tile.image.ZIndex = if current then 2 else 1
			end
		end
	end
end

-- Follows the screen's pixel density: when it changes (the window moved to another screen),
-- every tile is drawn again at the new one.
local function applyDensity()
	local d = pixelDensity()
	if d == density and tilePx == math.round(TILE * d) then
		return
	end
	for _, layer in { baseTiles, underTiles, overTiles } do
		for key in layer.tiles do
			dropTile(layer, key)
		end
	end
	density = d
	tilePx = math.round(TILE * d)
	maxTiles = math.max(24, math.floor(MAX_TILE_PIXELS / (tilePx * tilePx))) -- (a screen of tiles plus a ring)
	scratch = buffer.create(tilePx * tilePx * 4)
end

-- Draws tiles for up to FRAME_BUDGET (at least one), nearest the middle first, each place's
-- map and product together. True if any was drawn.
local function drawTiles(): boolean
	local deadline = os.clock() + FRAME_BUDGET
	local any = false
	for _, w in wanted do
		local tile = tileOf(baseTiles, level, w.i, w.j)
		if tile.version < 0 then
			drawBaseTile(tile)
			any = true
		end
		local current = overlay
		if current then
			if current.drawUnder then
				local under = tileOf(underTiles, level, w.i, w.j)
				if under.version ~= overlayVersion then
					drawShapeTile(underTiles, under, current.drawUnder)
					any = true
				end
			end
			local over = tileOf(overTiles, level, w.i, w.j)
			if over.version ~= overlayVersion then
				drawShapeTile(overTiles, over, current.draw)
				any = true
			end
		end
		if any and os.clock() > deadline then
			break
		end
	end
	if any then
		evict(baseTiles)
		evict(underTiles)
		evict(overTiles)
	end
	return any
end

-- The raster products' image: the whole view at up to MAX_RES pixels, as the map was drawn
-- before tiles. It is drawn for one view, and moved and scaled with the map until the view
-- settles and it is drawn again.
local rasterEditable: any = nil

-- A few drawn images kept by key, the least recently used let go first when full.
type Lru<T> = { items: { [string]: { value: T, used: number } }, count: number, cap: number, clock: number }
local function newLru<T>(cap: number): Lru<T>
	return { items = {}, count = 0, cap = cap, clock = 0 }
end
local function lruGet<T>(lru: Lru<T>, key: string): T?
	local item = lru.items[key]
	if not item then
		return nil
	end
	lru.clock += 1
	item.used = lru.clock
	return item.value
end
local function lruPut<T>(lru: Lru<T>, key: string, value: T)
	lru.clock += 1
	if lru.items[key] then
		lru.items[key] = { value = value, used = lru.clock }
		return
	end
	while lru.count >= lru.cap do
		local oldest, oldestUsed = nil, math.huge
		for k, item in lru.items do
			if item.used < oldestUsed then
				oldest, oldestUsed = k, item.used
			end
		end
		if not oldest then
			break
		end
		lru.items[oldest] = nil
		lru.count -= 1
	end
	lru.items[key] = { value = value, used = lru.clock }
	lru.count += 1
end
local function lruClear<T>(lru: Lru<T>)
	table.clear(lru.items)
	lru.count = 0
end

-- Raster images already drawn for this view, by the overlay's rasterKey (a radar loop's frames):
-- plain buffers, not EditableImages, so they cost no image budget; let go when the view moves
-- or the map closes. (A loop is radarLoopFrames scans, 10, plus the newest.)
local RASTER_CACHE_IMAGES = 12
type Drawn = { pixels: buffer, drawn: boolean }
local rasterCache: { view: string?, images: Lru<Drawn> } = { view = nil, images = newLru(RASTER_CACHE_IMAGES) }
-- The marks drawn for this view (lightning, rotation), by the overlay's marksKey.
local marksHeld: { key: string, pixels: buffer, drawn: boolean }? = nil
local marksEditable: any = nil
local marksWritten: buffer? = nil -- the marks buffer last written into marksEditable
local rasterSize = Vector2.zero
local rasterView = { left = 0, top = 0, right = 0, bottom = 0 }

local function placeRaster()
	if not rasterImage.Visible then
		return
	end
	local size = viewport.AbsoluteSize
	local x0 = (rasterView.left - centreX) / mpp + size.X / 2
	local y0 = (rasterView.top - centreY) / mpp + size.Y / 2
	rasterImage.Position = UDim2.fromOffset(x0, y0)
	rasterImage.Size = UDim2.fromOffset((rasterView.right - rasterView.left) / mpp, (rasterView.bottom - rasterView.top) / mpp)
end

local function drawRaster()
	rasterDue = false
	local current = overlay
	if not current or not (current.drawRaster or current.drawMarks) then
		rasterImage.Visible = false
		return
	end
	local size = viewport.AbsoluteSize
	local scale = math.min(1, MAX_RES / math.max(size.X, size.Y, 1))
	local pw, ph = math.max(1, math.floor(size.X * scale)), math.max(1, math.floor(size.Y * scale))
	local cx, cy, m = centreX, centreY, mpp
	local viewKey = string.format("%.9g %.9g %.9g %d %d", cx, cy, m, pw, ph)
	if rasterCache.view ~= viewKey then
		rasterCache.view = viewKey
		lruClear(rasterCache.images)
		marksHeld = nil
	end
	local function paint(drawFn: (Draw) -> (), what: string): Drawn
		local pixels = buffer.create(pw * ph * 4)
		local raster = Raster.new(pixels, pw, ph, function(mx: number, my: number)
			return (mx - cx) / m + size.X / 2, (my - cy) / m + size.Y / 2
		end, scale, 0, 0, Config.MAP_MILES)
		local ok, problem = pcall(drawFn, raster)
		if not ok then
			warn(`[MapCanvas] {what} drawing failed: {problem}`)
		end
		return { pixels = pixels, drawn = raster.drawn() }
	end
	local scan: Drawn? = nil
	if current.drawRaster then
		local key = if current.rasterKey then (current.rasterKey :: () -> string?)() else nil
		scan = if key then lruGet(rasterCache.images, key) else nil
		if not scan then
			local made = paint(current.drawRaster :: (Draw) -> (), "raster product")
			scan = made
			if key then
				lruPut(rasterCache.images, key, made)
			end
		end
	end
	local marks: Drawn? = nil
	if current.drawMarks then
		local key = if current.marksKey then (current.marksKey :: () -> string?)() else nil
		local held = marksHeld
		if key and held and held.key == key then
			marks = held
		else
			local made = paint(current.drawMarks :: (Draw) -> (), "marks")
			marks = made
			marksHeld = if key then { key = key, pixels = made.pixels, drawn = made.drawn } else nil
		end
	end
	local scanDrawn = scan ~= nil and scan.drawn
	local marksDrawn = marks ~= nil and marks.drawn
	if not scanDrawn and not marksDrawn then
		rasterImage.Visible = false
		return
	end
	if not rasterEditable or rasterSize ~= Vector2.new(pw, ph) then
		if rasterEditable then
			rasterEditable:Destroy()
		end
		if marksEditable then
			marksEditable:Destroy()
			marksEditable = nil
			marksImage.ImageContent = Content.none
		end
		rasterEditable = (AssetService :: any):CreateEditableImage({ Size = Vector2.new(pw, ph) })
		rasterSize = Vector2.new(pw, ph)
		rasterImage.ImageContent = Content.fromObject(rasterEditable)
	end
	if scan and scanDrawn then
		rasterEditable:WritePixelsBuffer(Vector2.zero, Vector2.new(pw, ph), scan.pixels)
		rasterImage.ImageTransparency = 0
	else
		rasterImage.ImageTransparency = 1 -- only the marks show
	end
	if marks and marksDrawn then
		if not marksEditable then
			local ok, made = pcall(function()
				return (AssetService :: any):CreateEditableImage({ Size = Vector2.new(pw, ph) })
			end)
			marksEditable = if ok then made else nil
			marksWritten = nil
			marksImage.ImageContent = if marksEditable then Content.fromObject(marksEditable) else Content.none
		end
		if marksEditable and marksWritten ~= marks.pixels then
			marksEditable:WritePixelsBuffer(Vector2.zero, Vector2.new(pw, ph), marks.pixels)
			marksWritten = marks.pixels
		end
		marksImage.Visible = marksEditable ~= nil
	else
		marksImage.Visible = false
	end
	rasterView = { left = cx - size.X / 2 * m, top = cy - size.Y / 2 * m, right = cx + size.X / 2 * m, bottom = cy + size.Y / 2 * m }
	rasterImage.Visible = true
	placeRaster()
end

-- Backdrop ------------------------------------------------------------------------------------

local backdropImage: ImageLabel
local backdropPixels: buffer? = nil -- kept while the game runs (plain memory, not image memory)
local backdropEditable: any = nil -- let go when the map closes
local backdropRows = 0 -- rows drawn so far
local backdropShown = 0 -- rows written into the image

local function placeBackdrop()
	local x0, y0 = toScreen(0, 0)
	backdropImage.Position = UDim2.fromOffset(x0, y0)
	backdropImage.Size = UDim2.fromOffset(data.miles / mpp, data.miles / mpp)
end

-- Draws the next rows (and puts what is drawn into the image); true if it did anything.
local function stepBackdrop(): boolean
	if not backdropEditable then
		local ok, made = pcall(function()
			return (AssetService :: any):CreateEditableImage({ Size = Vector2.new(BACKDROP, BACKDROP) })
		end)
		if not ok or not made then
			return false
		end
		backdropEditable = made
		backdropImage.ImageContent = Content.fromObject(made)
		backdropShown = 0
	end
	local pixels = backdropPixels
	if not pixels then
		pixels = buffer.create(BACKDROP * BACKDROP * 4)
		backdropPixels = pixels
	end
	local did = false
	if backdropRows < BACKDROP then
		local rows = math.min(BACKDROP_ROWS, BACKDROP - backdropRows)
		local step = data.miles / BACKDROP
		local strip = buffer.create(BACKDROP * rows * 4)
		MapBase.draw(base, strip, BACKDROP, rows, 0, backdropRows * step, step, 1)
		buffer.copy(pixels :: buffer, backdropRows * BACKDROP * 4, strip)
		backdropRows += rows
		did = true
	end
	if backdropShown < backdropRows then
		local from = backdropShown
		local rows = backdropRows - from
		local part = buffer.create(BACKDROP * rows * 4)
		buffer.copy(part, 0, pixels :: buffer, from * BACKDROP * 4, BACKDROP * rows * 4)
		backdropEditable:WritePixelsBuffer(Vector2.new(0, from), Vector2.new(BACKDROP, rows), part)
		backdropShown = backdropRows
		did = true
	end
	return did
end

-- Grids ---------------------------------------------------------------------------------------

type GridSlot = { image: ImageLabel, editable: any?, size: Vector2, key: string?, miles: Vector2 }
local gridSlots: { GridSlot } = {}
local gridsDue = false
-- Each grid's pixels by key (a loop's frames come round again), the least recently shown let go
-- first: room for a radar mosaic's loop and the satellite's together (2 x radarLoopFrames, 10,
-- and the newest of each), so playing both does not colour every frame again. Let go when the
-- map closes.
local GRID_CACHE = 24
local gridCache: Lru<buffer> = newLru(GRID_CACHE)
-- Each colour table packed as 256 little-endian RGBA words.
local packed: { [{ number }]: { number } } = setmetatable({}, { __mode = "k" }) :: any

local function packedOf(lut: { number }): { number }
	local held = packed[lut]
	if held then
		return held
	end
	local words = table.create(256, 0)
	for byte = 1, 255 do
		local k = byte * 4
		words[byte + 1] = bit32.bor(lut[k + 1], bit32.lshift(lut[k + 2], 8), bit32.lshift(lut[k + 3], 16), bit32.lshift(lut[k + 4], 24))
	end
	packed[lut] = words
	return words
end

local function pixelsOf(g: Grid): buffer
	local held = lruGet(gridCache, g.key)
	if held then
		return held
	end
	local n = g.width * g.height
	local pixels = buffer.create(n * 4)
	Raster.colourGrid(g.bytes, n, packedOf(g.lut), pixels) -- (native code)
	lruPut(gridCache, g.key, pixels)
	return pixels
end

local function placeGrids()
	local x0, y0 = toScreen(0, 0)
	for _, slot in gridSlots do
		if slot.image.Visible then
			slot.image.Position = UDim2.fromOffset(x0, y0)
			slot.image.Size = UDim2.fromOffset(slot.miles.X / mpp, slot.miles.Y / mpp)
		end
	end
end

-- Puts the overlay's grids on show, making each grid's image only when its key is new.
local function updateGrids()
	gridsDue = false
	local current = overlay
	local list: { Grid } = {}
	if current and current.grids then
		local ok, got = pcall(current.grids :: () -> { Grid })
		if ok then
			list = got
		else
			warn(`[MapCanvas] grids failed: {got}`)
		end
	end
	for n, g in list do
		local slot = gridSlots[n]
		if not slot then
			local image = Instance.new("ImageLabel")
			image.BackgroundTransparency = 1
			image.Parent = gridLayer
			slot = { image = image, editable = nil, size = Vector2.zero, key = nil, miles = Vector2.zero }
			gridSlots[n] = slot
		end
		local s = slot :: GridSlot
		local size = Vector2.new(g.width, g.height)
		if s.key ~= g.key or not s.editable then
			if not s.editable or s.size ~= size then
				if s.editable then
					s.editable:Destroy()
				end
				local ok, made = pcall(function()
					return (AssetService :: any):CreateEditableImage({ Size = size })
				end)
				s.editable = if ok then made else nil
				s.size = size
				s.image.ImageContent = if s.editable then Content.fromObject(s.editable) else Content.none
			end
			if s.editable then
				s.editable:WritePixelsBuffer(Vector2.zero, size, pixelsOf(g))
			end
			s.key = g.key
		end
		s.image.ImageTransparency = 1 - g.alpha
		s.image.ResampleMode = if g.smooth then Enum.ResamplerMode.Default else Enum.ResamplerMode.Pixelated
		s.image.ZIndex = n
		s.image.Visible = s.editable ~= nil
		s.miles = Vector2.new(g.width * g.cellMiles, g.height * g.cellMiles)
	end
	for n = #list + 1, #gridSlots do
		gridSlots[n].image.Visible = false
	end
	placeGrids()
end

-- Labels --------------------------------------------------------------------------------------

type LabelStyle = { border: Colour? }

local function placeLabels()
	for _, l in labels do
		l.Visible = false
	end
	local used = 0
	local taken: { { number } } = {}
	local size = viewSize()
	local function free(x: number, y: number, w: number, h: number): boolean
		if x < 0 or y < 0 or x + w > size.X or y + h > size.Y then
			return false
		end
		for _, r in taken do
			if x < r[1] + r[3] and x + w > r[1] and y < r[2] + r[4] and y + h > r[2] then
				return false
			end
		end
		return true
	end
	local function take(): TextLabel
		used += 1
		local l = labels[used]
		if not l then
			l = Instance.new("TextLabel")
			l.TextStrokeTransparency = 0.3
			l.ZIndex = 8
			local stroke = Instance.new("UIStroke")
			stroke.ApplyStrokeMode = Enum.ApplyStrokeMode.Border
			stroke.Thickness = 1
			stroke.Parent = l
			l.Parent = labelLayer
			labels[used] = l
		end
		l.Visible = true
		return l
	end
	local function label(text: string, x: number, y: number, textSize: number, colour: Color3, bold: boolean, rotation: number?): boolean
		local w, h = #text * textSize * 0.55 + 6, textSize + 4
		local lx, ly = x + 5, y - h / 2
		if rotation then
			lx, ly = x - w / 2, y - h / 2
		end
		if not free(lx, ly, w, h) then
			return false
		end
		table.insert(taken, { lx, ly, w, h })
		local l = take()
		l.BackgroundTransparency = 1
		l.TextStrokeTransparency = 0.3
		;(l:FindFirstChildOfClass("UIStroke") :: UIStroke).Enabled = false
		l.Text = text
		l.TextSize = textSize
		l.Font = if bold then Enum.Font.GothamBold else Enum.Font.Gotham
		l.TextColor3 = colour
		l.Size = UDim2.fromOffset(w, h)
		l.Position = UDim2.fromOffset(lx, ly)
		l.Rotation = rotation or 0
		l.TextXAlignment = if rotation then Enum.TextXAlignment.Center else Enum.TextXAlignment.Left
		return true
	end
	-- A boxed product label centred on a point.
	local function box(text: string, x: number, y: number, border: Colour): boolean
		local w, h = #text * 7 + 10, 16
		local lx, ly = x - w / 2, y - h / 2
		if not free(lx, ly, w, h) then
			return false
		end
		table.insert(taken, { lx - 20, ly - 12, w + 40, h + 24 }) -- keep product labels apart
		local l = take()
		l.BackgroundTransparency = 0.08
		l.BackgroundColor3 = Color3.fromRGB(11, 17, 25)
		l.TextStrokeTransparency = 1
		local stroke = l:FindFirstChildOfClass("UIStroke") :: UIStroke
		stroke.Enabled = true
		stroke.Color = Color3.fromRGB(border[1], border[2], border[3])
		l.Text = text
		l.TextSize = 12
		l.Font = Enum.Font.GothamBold
		l.TextColor3 = Color3.fromRGB(241, 245, 249)
		l.Size = UDim2.fromOffset(w, h)
		l.Position = UDim2.fromOffset(lx, ly)
		l.Rotation = 0
		l.TextXAlignment = Enum.TextXAlignment.Center
		return true
	end
	-- The product's labels first: they matter more than place names.
	if overlay and overlay.labels then
		overlay.labels({
			at = function(text: string, mx: number, my: number, border: Colour): boolean
				local x, y = toScreen(mx, my)
				return box(text, x, y, border)
			end,
			onRing = function(text: string, rings: Rings, border: Colour): boolean
				local points: { { number } } = {}
				for _, ring in rings do
					for i = 1, #ring - 1, 2 do
						local mx, my = ring[i], ring[i + 1]
						local x, y = toScreen(mx, my)
						-- Not on the map's edge, where a ring runs only to close up.
						local onEdge = math.min(mx, my) <= 0.011 or math.max(mx, my) >= Config.MAP_MILES - 0.011
						if not onEdge and x > 30 and y > 20 and x < size.X - 30 and y < size.Y - 20 then
							table.insert(points, { x, y, (x - size.X / 2) ^ 2 + (y - size.Y / 2) ^ 2 })
						end
					end
				end
				table.sort(points, function(a, b)
					return a[3] < b[3]
				end)
				for k = 1, math.min(#points, 60) do
					if box(text, points[k][1], points[k][2], border) then
						return true
					end
				end
				return false
			end,
		})
	end
	-- Places by importance; smaller ones only as the view closes in.
	local towns = {}
	for _, s in data.settlements do
		local x, y = toScreen(s.x, s.y)
		if x > -50 and y > -20 and x < size.X + 50 and y < size.Y + 20 then
			local rank = if s.kind == "metro" then 0 elseif s.kind == "city" then 1 elseif s.kind == "smallCity" then 2 else 3
			local show = rank <= 1 or (rank == 2 and mpp < 1.4) or (rank == 3 and ((s.population > 2500 and mpp < 0.45) or (s.population > 800 and mpp < 0.2) or mpp < 0.08))
			if show then
				table.insert(towns, { s = s, x = x, y = y, rank = rank })
			end
		end
	end
	table.sort(towns, function(a, b)
		return if a.rank ~= b.rank then a.rank < b.rank else a.s.population > b.s.population
	end)
	for _, t in towns do
		local size_ = ({ 18, 16, 14, 12 })[t.rank + 1]
		if label(t.s.name, t.x, t.y, size_, Color3.fromRGB(255, 238, 180), t.rank < 3) then
			-- A dot for the place itself.
			table.insert(taken, { t.x - 3, t.y - 3, 6, 6 })
		end
	end
	-- Rivers: the name along the river near the middle of its visible stretch.
	if mpp < 0.8 then
		for _, river in data.rivers do
			if river.name ~= "" then
				local pts = river.points
				local best, bestD = nil, math.huge
				for i = 1, #pts - 3, 2 do
					local x, y = toScreen((pts[i] + pts[i + 2]) / 2, (pts[i + 1] + pts[i + 3]) / 2)
					local d = (x - size.X / 2) ^ 2 + (y - size.Y / 2) ^ 2
					if x > 40 and y > 20 and x < size.X - 40 and y < size.Y - 20 and d < bestD then
						best, bestD = i, d
					end
				end
				if best then
					local ax, ay = toScreen(pts[best], pts[best + 1])
					local bx, by = toScreen(pts[best + 2], pts[best + 3])
					local angle = math.deg(math.atan2(by - ay, bx - ax))
					if angle > 90 then
						angle -= 180
					elseif angle < -90 then
						angle += 180
					end
					label(river.name, (ax + bx) / 2, (ay + by) / 2 - 8, 12, Color3.fromRGB(190, 220, 255), false, angle)
				end
			end
		end
	end
	-- Exit numbers at interchanges.
	if mpp < 0.35 then
		for _, c in data.crossings or {} do
			if c.type == "interchange" then
				local x, y = toScreen(c.x, c.y)
				label(`Exit {c.exit}`, x + 4, y + 10, 11, Color3.fromRGB(150, 230, 160), true)
			end
		end
	end
	-- Interstate and expressway names on their lines.
	for _, road in data.roads do
		if road.kind ~= "highway" and road.name ~= "" then
			local pts = road.points
			for i = 1, #pts - 1, 2 do
				local x, y = toScreen(pts[i], pts[i + 1])
				if x > 20 and y > 20 and x < size.X - 60 and y < size.Y - 20 and label(road.name, x, y, 11, if road.kind == "interstate" then Color3.fromRGB(255, 200, 200) else Color3.fromRGB(255, 220, 180), true) then
					break
				end
			end
		end
	end
end

-- Markers and readout ------------------------------------------------------------------------

-- A player's mark: a dot pointing the way they face (dot, rotated), and their display name
-- beside it while a layer asks for names (name, kept upright). Made once a player, then moved.
type Marker = { holder: Frame, dot: Frame, name: TextLabel }

local function marker(p: Player): Marker
	local m = markers[p]
	if m then
		return m
	end
	local mine = p == player
	local holder = Instance.new("Frame")
	holder.Name = "Marker"
	holder.AnchorPoint = Vector2.new(0.5, 0.5)
	holder.Size = UDim2.fromOffset(14, 14)
	holder.BackgroundTransparency = 1
	holder.ZIndex = if mine then 11 else 10 -- your own on top
	local dot = Instance.new("Frame")
	dot.Size = UDim2.fromScale(1, 1)
	dot.BackgroundColor3 = if mine then Color3.fromRGB(230, 50, 50) else Color3.fromRGB(60, 140, 255)
	dot.ZIndex = 2
	local c = Instance.new("UICorner")
	c.CornerRadius = UDim.new(1, 0)
	c.Parent = dot
	local s = Instance.new("UIStroke")
	s.Color = if mine then Color3.fromRGB(255, 226, 120) else Color3.new(1, 1, 1)
	s.Thickness = if mine then 3 else 2
	s.Parent = dot
	local pointer = Instance.new("Frame")
	pointer.AnchorPoint = Vector2.new(0.5, 1)
	pointer.Position = UDim2.fromScale(0.5, 0.5)
	pointer.Size = UDim2.fromOffset(3, 16)
	pointer.BackgroundColor3 = Color3.new(1, 1, 1)
	pointer.BorderSizePixel = 0
	pointer.ZIndex = 1
	pointer.Parent = dot
	dot.Parent = holder
	local name = Instance.new("TextLabel")
	name.AnchorPoint = Vector2.new(0, 0.5)
	name.Position = UDim2.new(1, 8, 0.5, 0)
	name.Size = UDim2.fromOffset(0, 16)
	name.AutomaticSize = Enum.AutomaticSize.X
	name.BackgroundTransparency = 1
	name.Font = if mine then Enum.Font.GothamBold else Enum.Font.GothamMedium
	name.TextSize = 13
	name.TextColor3 = if mine then Color3.fromRGB(255, 226, 120) else Color3.fromRGB(236, 240, 245)
	name.TextStrokeTransparency = 0.25
	name.TextXAlignment = Enum.TextXAlignment.Left
	name.ZIndex = 3
	name.Visible = false
	name.Parent = holder
	holder.Parent = labelLayer
	local made: Marker = { holder = holder, dot = dot, name = name }
	markers[p] = made
	return made
end

local function myMiles(): (number?, number?)
	local character = player.Character
	local root = if character then character:FindFirstChild("HumanoidRootPart") :: BasePart? else nil
	if not root then
		return nil, nil
	end
	return root.Position.X / MILE + HALF, root.Position.Z / MILE + HALF
end

local function updateMarkers()
	local source = markerSource
	local size = viewSize()
	for _, p in Players:GetPlayers() do
		local character = p.Character
		local root = if character then character:FindFirstChild("HumanoidRootPart") :: BasePart? else nil
		-- Where the character is here, else (one not streamed in) where the source says.
		local mx: number?, my: number?, heading: number? = nil, nil, nil
		if root then
			local look = root.CFrame.LookVector
			mx, my, heading = root.Position.X / MILE + HALF, root.Position.Z / MILE + HALF, math.deg(math.atan2(look.X, -look.Z))
		elseif source then
			mx, my, heading = source.position(p)
		end
		local m = markers[p]
		if mx and my then
			m = marker(p)
			local x, y = toScreen(mx, my)
			m.holder.Position = UDim2.fromOffset(x, y)
			m.holder.Visible = x >= 0 and y >= 0 and x <= size.X and y <= size.Y
			m.dot.Rotation = heading or 0
			local named = source ~= nil and source.names
			m.name.Visible = named
			if named and m.name.Text ~= p.DisplayName then
				m.name.Text = p.DisplayName
			end
		elseif m then
			m.holder.Visible = false
		end
	end
	for p, m in markers do
		if not p.Parent then
			m.holder:Destroy()
			markers[p] = nil
		end
	end
	local mx, my = myMiles()
	local out = readout
	if out and mx and my then
		local best, distance = nil, math.huge
		for _, s in data.settlements do
			local d = math.sqrt((s.x - mx) ^ 2 + (s.y - my) ^ 2)
			if d < distance then
				best, distance = s, d
			end
		end
		local hovered = overlay and overlay.hover and hoverAt and (overlay.hover :: any)(hoverAt.X, hoverAt.Y)
		out.Text = (if hovered then hovered .. "  ·  " else "")
			.. string.format("You: %.1f mi east, %.1f mi south  ·  region %d, %d", mx, my, mx // Config.REGION_MILES, my // Config.REGION_MILES)
			.. (if best then string.format("  ·  %s %.1f mi", best.name, distance) else "")
			.. string.format("  ·  %s", if mpp < 0.1 then string.format("%.0f studs/px", mpp * MILE) else string.format("%.2f mi/px", mpp))
	end
end

local function changed()
	viewChanged = true
	labelsDue = true
	rasterDue = true
	lastChange = os.clock()
end

-- Public --------------------------------------------------------------------------------------

local function layerFrame(name: string, z: number): Frame
	local frame = Instance.new("Frame")
	frame.Name = name
	frame.Size = UDim2.fromScale(1, 1)
	frame.BackgroundTransparency = 1
	frame.ZIndex = z
	frame.Parent = viewport
	return frame
end

-- Builds the map inside a frame (it fills it). readoutLabel, if given, shows where you are.
-- Bottom to top: the map's tiles, the veil that mutes them, the product's tiles that go under
-- the raster products (the outlook), the raster products (radar), the product's other tiles,
-- then labels and player markers.
function MapCanvas.mount(parent: Frame, readoutLabel: TextLabel?)
	loadData()
	readout = readoutLabel
	viewport = Instance.new("Frame")
	viewport.Name = "MapCanvas"
	viewport.Size = UDim2.fromScale(1, 1)
	viewport.BackgroundColor3 = Color3.fromRGB(12, 14, 18)
	viewport.ClipsDescendants = true
	viewport.Active = true
	viewport.Parent = parent

	baseLayer = layerFrame("Map", 1)
	backdropImage = Instance.new("ImageLabel")
	backdropImage.Name = "Backdrop"
	backdropImage.BackgroundTransparency = 1
	backdropImage.ZIndex = 0 -- under every tile
	backdropImage.Parent = baseLayer
	veil = layerFrame("Veil", 2)
	underLayer = layerFrame("ProductUnder", 3)
	veil.BackgroundColor3 = Color3.fromRGB(MUTE_TO[1], MUTE_TO[2], MUTE_TO[3])
	veil.BackgroundTransparency = MUTE_KEEP
	veil.BorderSizePixel = 0
	veil.Visible = false
	rasterImage = Instance.new("ImageLabel")
	rasterImage.Name = "Raster"
	rasterImage.BackgroundTransparency = 1
	rasterImage.ZIndex = 5
	rasterImage.Visible = false
	rasterImage.Parent = viewport
	-- (a child, so it moves and scales with the raster image and lies over it)
	marksImage = Instance.new("ImageLabel")
	marksImage.Name = "Marks"
	marksImage.BackgroundTransparency = 1
	marksImage.Size = UDim2.fromScale(1, 1)
	marksImage.Visible = false
	marksImage.Parent = rasterImage
	overLayer = layerFrame("Product", 6)
	gridLayer = layerFrame("Grids", 4)
	labelLayer = layerFrame("Labels", 8)
	baseTiles = newLayer(baseLayer)
	underTiles = newLayer(underLayer)
	overTiles = newLayer(overLayer)

	viewport:GetPropertyChangedSignal("AbsoluteSize"):Connect(changed)

	-- Scroll to zoom about the cursor; drag the map itself to pan. A press that hardly moves is a
	-- click, handed to the click handler as a map point.
	local dragging: Vector3? = nil
	local pressedAt: Vector3? = nil
	viewport.InputBegan:Connect(function(input: InputObject)
		if input.UserInputType == Enum.UserInputType.MouseButton1 then
			dragging = input.Position
			pressedAt = input.Position
		end
	end)
	UserInputService.InputEnded:Connect(function(input: InputObject)
		if input.UserInputType == Enum.UserInputType.MouseButton1 then
			local from = pressedAt
			dragging, pressedAt = nil, nil
			local handler = clickHandler
			if visible and from and handler and (input.Position - from).Magnitude < 5 then
				local size = viewSize()
				local at = Vector2.new(input.Position.X, input.Position.Y) - viewport.AbsolutePosition
				handler(centreX + (at.X - size.X / 2) * mpp, centreY + (at.Y - size.Y / 2) * mpp)
			end
		end
	end)
	viewport.InputChanged:Connect(function(input: InputObject)
		if visible and input.UserInputType == Enum.UserInputType.MouseWheel then
			local mouse = UserInputService:GetMouseLocation() - viewport.AbsolutePosition
			local size = viewSize()
			-- Keep the map point under the cursor where it is.
			local px, py = centreX + (mouse.X - size.X / 2) * mpp, centreY + (mouse.Y - size.Y / 2) * mpp
			mpp *= if input.Position.Z > 0 then 0.8 else 1.25
			mpp = math.clamp(mpp, MIN_MPP, fullMpp())
			centreX, centreY = px - (mouse.X - size.X / 2) * mpp, py - (mouse.Y - size.Y / 2) * mpp
			clampView()
			changed()
		end
	end)
	UserInputService.InputChanged:Connect(function(input: InputObject)
		if visible and not dragging and input.UserInputType == Enum.UserInputType.MouseMovement then
			local size = viewSize()
			local at = Vector2.new(input.Position.X, input.Position.Y) - viewport.AbsolutePosition
			hoverAt = if at.X >= 0 and at.Y >= 0 and at.X <= size.X and at.Y <= size.Y
				then Vector2.new(centreX + (at.X - size.X / 2) * mpp, centreY + (at.Y - size.Y / 2) * mpp)
				else nil
		end
		if visible and dragging and input.UserInputType == Enum.UserInputType.MouseMovement then
			centreX -= (input.Position.X - dragging.X) * mpp
			centreY -= (input.Position.Y - dragging.Y) * mpp
			dragging = input.Position
			clampView()
			changed()
		end
	end)
end

-- What is drawn over the map (nil: the plain world map). The product's tiles are drawn again,
-- a few a frame, and the old ones shown until then; the map itself is not drawn again.
-- quick: kept for the callers that only change a raster product (it is drawn at once).
function MapCanvas.setOverlay(value: Overlay?, _quick: boolean?)
	overlay = value
	overlayVersion += 1
	gridsDue = true
	veil.Visible = value ~= nil and value.muted == true
	rasterDue = true
	labelsDue = true
	lastChange = 0 -- the raster image is drawn without waiting for the view to settle
end

-- Draw the product again (its data changed).
function MapCanvas.redraw()
	MapCanvas.setOverlay(overlay)
end

-- Draw only the raster image again, at once (a radar loop's next frame); the shapes stay.
function MapCanvas.redrawRaster()
	gridsDue = true
	rasterDue = true
	lastChange = 0
end

-- Draw the raster image and the labels again, at once; the product tiles stay (a layer's
-- refresh that changed only its raster image or its labels).
function MapCanvas.refresh()
	gridsDue = true
	rasterDue = true
	labelsDue = true
	lastChange = 0
end

-- Called with the map point (miles) of a click on the map; nil to stop.
function MapCanvas.onClick(handler: ((mx: number, my: number) -> ())?)
	clickHandler = handler
end

-- Map miles per screen pixel at the current zoom; while a product's tiles are drawn, the zoom
-- they are drawn at (within 19% of the view's).
function MapCanvas.milesPerPixel(): number
	return drawingMpp or mpp
end

-- The map point (miles) of a player's character, if it has one.
function MapCanvas.playerMiles(): (number?, number?)
	return myMiles()
end

function MapCanvas.setVisible(on: boolean)
	visible = on
	if on then
		changed()
	elseif baseTiles then
		-- closed: give every tile's image memory back (they are redrawn when it opens again)
		for _, layer in { baseTiles, underTiles, overTiles } do
			local keys = {}
			for key in layer.tiles do
				table.insert(keys, key)
			end
			for _, key in keys do
				dropTile(layer, key)
			end
		end
		for _, slot in gridSlots do
			if slot.editable then
				slot.editable:Destroy()
				slot.editable = nil
				slot.key = nil
				slot.image.ImageContent = Content.none
				slot.image.Visible = false
			end
		end
		gridsDue = true
		if backdropEditable then
			backdropEditable:Destroy()
			backdropEditable = nil
			backdropImage.ImageContent = Content.none
		end
		if rasterEditable then
			rasterEditable:Destroy()
			rasterEditable = nil
			rasterSize = Vector2.zero
			rasterImage.Visible = false
		end
		if marksEditable then
			marksEditable:Destroy()
			marksEditable = nil
			marksImage.ImageContent = Content.none
			marksImage.Visible = false
		end
		marksWritten = nil
		-- and the plain-memory images drawn for the view (a loop's frames, the grids' colours)
		rasterCache.view = nil
		lruClear(rasterCache.images)
		marksHeld = nil
		lruClear(gridCache)
		rasterDue = true
	end
end

-- Where to mark players whose characters are not streamed in, and whether to name every
-- player's mark; nil: only characters streamed in, unnamed.
function MapCanvas.setMarkerSource(source: MarkerSource?)
	markerSource = source
end

-- Centres the view on a map point (miles).
function MapCanvas.centreOn(mx: number, my: number)
	centreX, centreY = mx, my
	changed()
end

-- Shows a box of the map (map miles) with room around it: a chosen warning or watch. Never closer than
-- leastMiles across, so a small warning still shows the towns around it.
function MapCanvas.frame(x0: number, y0: number, x1: number, y1: number, leastMiles: number?)
	local size = viewSize()
	local across = math.max(leastMiles or 60, (x1 - x0) * 1.9, (y1 - y0) * 1.9)
	centreX, centreY = (x0 + x1) / 2, (y0 + y1) / 2
	mpp = across / math.max(1, math.min(size.X, size.Y))
	clampView()
	changed()
end

function MapCanvas.centreOnMe()
	local mx, my = myMiles()
	if mx and my then
		centreX, centreY = mx, my
	end
	changed()
end

function MapCanvas.zoom(factor: number)
	mpp *= factor
	clampView()
	changed()
end

-- Call every frame while the screen is open: places the tiles for the view, draws a few more,
-- places the labels (at most every 70 ms while the view moves) and draws the raster products
-- again once the view has settled.
function MapCanvas.step()
	if not visible then
		return
	end
	local now = os.clock()
	local moved = viewChanged
	if viewChanged then
		viewChanged = false
		applyDensity()
		clampView()
		level = levelOf(mpp)
		findWanted()
	end
	-- (the backdrop's rows first while it is not all shown: they are what fills a gap at once)
	local drewBackdrop = (backdropRows < BACKDROP or backdropShown < backdropRows or not backdropEditable) and stepBackdrop()
	local drew = drawTiles()
	if moved or drew or labelsDue or drewBackdrop then
		placeTiles()
		placeRaster()
		placeBackdrop()
		placeGrids()
	end
	if gridsDue then
		updateGrids()
	end
	if labelsDue and now - lastLabels > 0.07 then
		labelsDue = false
		lastLabels = now
		placeLabels()
	end
	if rasterDue and now - lastChange > SETTLE_SECONDS then
		drawRaster()
	end
	updateMarkers()
end

return MapCanvas
