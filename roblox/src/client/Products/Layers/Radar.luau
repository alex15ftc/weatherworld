--!strict
-- The radar (server/GameProducts.js): one radar's tilt of a product (radar.site.<ID>.<product>.<T>:
-- reflectivity, velocity, storm-relative velocity, correlation coefficient, differential
-- reflectivity, spectrum width; tilts as radar.sites lists them), or every radar together on the
-- network's grid (radar.mosaic.<kind>: composite, base, echo tops, VIL, hail size). The radars are
-- buttons in the side panel, and their labels on the map can be clicked too. The bytes, their
-- colours and the beam heights are the weather server's (js/radar/RadarFormat.js); this only
-- draws them, reads a value back under the cursor, and plays the scans the server holds as a loop.
-- A radar product is made when first asked for and kept current while it is on show. Over one
-- radar's scan, the rotation its volume scan shows (radar.rotation.<ID>): TVS and mesocyclone marks.
-- Over it, across the whole map, the last half hour's lightning ("lightning", js/storms/Lightning.js):
-- ground strikes as crosses (ringed when positive), flashes in the cloud as dots if asked for,
-- coloured by age as the weather server says.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local EncodingService = game:GetService("EncodingService")

local Palettes = require(ReplicatedStorage.Shared.Weather.Palettes)
local Products = script.Parent.Parent
local MapCanvas = require(Products.MapCanvas)
local ProductClient = require(Products.ProductClient)
local Ui = require(Products.Ui)
local Geo = require(Products.Geo)
local Layer = require(Products.Layer)

local Radar = {}
Radar.__index = Radar

local KEEPALIVE_SECONDS = 30 -- the game server keeps a radar product current while someone asks
local RADAR_ALPHA = 0.92
local RING = { 150, 160, 175 }
local SITE_BORDER, SITE_CHOSEN = { 120, 130, 145 }, { 255, 255, 255 }
local PICK_PIXELS = 14 -- a click this close to a radar's label picks it
local STRIKE_PICK_PIXELS = 8
local CROSS_PIXELS, CROSS_WIDTH, OUTLINE_WIDTH = 4.5, 1.6, 3.4
local CLOUD_DOT_PIXELS = 1.2
local STRIKE_OUTLINE = { 20, 20, 24 }
local NEARBY_MILES, NEARBY_MINUTES = 10, 15 -- a strike's details count the ground strikes this near and this recent
local LOOP_STEP_SECONDS, LOOP_HOLD_SECONDS = 0.45, 1.5 -- each frame of a loop, and the newest held longer
local KT_PER_MS = 1.943844
local MILES_PER_KM = 1 / 1.609344
-- Zoomed in so far that one of a scan's usual gates would span this many pixels, the radar asks for
-- the scan with the finer gates of a close look (radar.sites fineGateKm: 250 m).
local FINE_PIXELS = 2
local TAU = 2 * math.pi
-- Rotation found in the chosen radar's volume scan (radar.rotation.<ID>, js/radar/RotationDetection.js):
-- a mesocyclone as a yellow circle its own size (at least MESO_MIN_PIXELS), a TVS as a red
-- triangle point down (an elevated one, ETVS, pink), as the WSR-88D's displays mark them.
local MESO_COLOUR, TVS_COLOUR, ETVS_COLOUR = { 255, 230, 60 }, { 255, 40, 40 }, { 255, 140, 200 }
local MESO_MIN_PIXELS, TVS_PIXELS, ROTATION_PICK_PIXELS = 7, 8, 10
local MARK_OUTLINE = { 20, 20, 24 }

type Strikes = { key: string, x: { number }, y: { number }, age: { number }, kind: { number } }
type Frame = { id: string, validHourUtc: number, product: any, bytes: buffer }

-- The bytes of a radar product, unpacked once a scan (by id and scan time).
local decoded: { [string]: { key: string, bytes: buffer } } = {}
local function bytesOf(product: any): buffer?
	local key = tostring(product.validHourUtc)
	local held = decoded[product.id]
	if held and held.key == key then
		return held.bytes
	end
	local ok, bytes = pcall(function()
		return EncodingService:DecompressBuffer(EncodingService:Base64Decode(buffer.fromstring(product.data)), Enum.CompressionAlgorithm.Zstd)
	end)
	if not ok then
		warn(`[Radar] {product.id}: could not unpack ({bytes})`)
		return nil
	end
	decoded[product.id] = { key = key, bytes = bytes }
	return bytes
end

-- The strikes of a lightning product, oldest first (decoded once a version).
local strikesHeld: Strikes? = nil
local function strikesOf(product: any): Strikes?
	if not product or product.kind ~= "lightning" then
		return nil
	end
	local key = tostring(product.nowHourUtc) .. ":" .. tostring(product.count)
	local held = strikesHeld
	if held and held.key == key then
		return held
	end
	local out: Strikes = { key = key, x = {}, y = {}, age = {}, kind = {} }
	if product.count > 0 and product.data ~= "" then
		local ok, bytes = pcall(function()
			return EncodingService:DecompressBuffer(EncodingService:Base64Decode(buffer.fromstring(product.data)), Enum.CompressionAlgorithm.Zstd)
		end)
		if not ok then
			warn(`[Radar] lightning: could not unpack ({bytes})`)
			return nil
		end
		local size = product.strikeBytes
		for k = 0, math.min(product.count, buffer.len(bytes) // size) - 1 do
			local o = k * size
			table.insert(out.x, buffer.readu16(bytes, o) / 100)
			table.insert(out.y, buffer.readu16(bytes, o + 2) / 100)
			table.insert(out.age, buffer.readu8(bytes, o + 4) / 4)
			table.insert(out.kind, buffer.readu8(bytes, o + 5))
		end
	end
	strikesHeld = out
	return out
end

local function ageColour(ages: { any }, minutes: number): { number }?
	for _, band in ages do
		if minutes <= band.toMinutes then
			return band.colour
		end
	end
	return nil
end

local KIND_NAMES = { [0] = "In the cloud", [1] = "Cloud to ground, negative", [2] = "Cloud to ground, positive" }

local function byteOf(spec: any, value: number): number
	return math.clamp(1 + math.round((value - spec.min) / spec.step), if spec.doppler then 2 else 1, 255)
end

-- A button row of `columns` buttons across (Ui.buttons makes two).
local function row(parent: Instance, height: number, columns: number): Frame
	local r = Ui.buttons(parent, height)
	local grid = r:FindFirstChildOfClass("UIGridLayout")
	if grid then
		grid.CellSize = UDim2.new(1 / columns, -6, 0, height)
	end
	return r
end

-- A byte as its value with units, as radar viewers read it out ("RF": range folded).
local function valueText(spec: any, byte: number): string?
	if byte == 0 then
		return nil
	end
	if spec.doppler and byte == 1 then
		return `{spec.short} RF`
	end
	local value = spec.min + (byte - 1) * spec.step
	local text = `{spec.short} {string.format(`%.{spec.decimals}f`, value)} {spec.units}`
	if spec.units == "m/s" and spec.short ~= "SW" then
		text ..= string.format(" (%d kt)", math.round(value * KT_PER_MS))
	end
	return text
end

function Radar.new(ctx: Layer.Context, optionsParent: Instance)
	local self = setmetatable({
		key = "radar",
		name = "Radar",
		enabled = false,
		options = Ui.section(optionsParent),
		ctx = ctx,
		network = false, -- every radar together, rather than one
		product = "reflectivity",
		tiltIndex = 0,
		mosaicKind = "composite",
		siteId = nil :: string?,
		sites = nil :: any,
		shown = nil :: any,
		loaded = false,
		keepaliveToken = 0,
		lightning = nil :: any,
		showGround = true,
		showCloud = false,
		showRotation = true,
		rotation = nil :: any,
		looping = false,
		loopToken = 0,
		frames = {} :: { Frame },
		frameAt = 0, -- the loop frame on show (0: the newest scan, not looping)
		fine = false, -- the scan with the finer gates (zoomed in)
	}, Radar)
	return self
end

function Radar.productId(self: any): string?
	if self.network then
		return `radar.mosaic.{self.mosaicKind}`
	end
	return if self.siteId then `radar.site.{self.siteId}.{self.product}.{self.tiltIndex}{if self.fine then ".fine" else ""}` else nil
end

-- Whether the view is zoomed in far enough for the finer gates; on a change the scan is asked for again.
function Radar.checkFine(self: any)
	local sites = self.sites
	local want = false
	if sites and sites.fineGateKm and sites.gateKm and not self.network then
		want = sites.gateKm * MILES_PER_KM / MapCanvas.milesPerPixel() >= FINE_PIXELS
	end
	if want ~= self.fine then
		self.fine = want
		task.defer(self.changed, self)
	end
end

-- The chosen radar's rotation detections (none for the network, or with the markers off).
function Radar.rotationId(self: any): string?
	return if self.siteId and not self.network and self.showRotation then `radar.rotation.{self.siteId}` else nil
end

function Radar.wants(self: any, id: string): boolean
	return id == "radar.sites" or id == "lightning" or id == self:productId() or id == self:rotationId()
end

function Radar.site(self: any): any
	for _, site in (self.sites and self.sites.sites) or {} do
		if site.id == self.siteId then
			return site
		end
	end
	return nil
end

-- What is drawn now: a loop frame while looping, else the newest scan.
function Radar.current(self: any): (any, buffer?)
	local frame = if self.looping then self.frames[self.frameAt] else nil
	if frame then
		return frame.product, frame.bytes
	end
	local shown = self.shown
	if shown and (shown.kind == "radar-polar" or shown.kind == "radar-grid") then
		return shown, bytesOf(shown)
	end
	return nil, nil
end

-- Something else is to be shown (radar, product, tilt or mode): the loop starts again.
function Radar.changed(self: any)
	self.shown = nil
	self.frames = {}
	self.frameAt = 0
	self.loopToken += 1
	task.spawn(self.refresh, self)
	if self.looping then
		self:startLoop()
	end
end

function Radar.choose(self: any, siteId: string)
	self.siteId = siteId
	self.network = false
	self:changed()
end

-- What the options panel's buttons depend on: it is rebuilt only when this changes, and its
-- lines about the lightning and rotation are rewritten in place (updateInfo).
function Radar.optionsKey(self: any): string
	return `{tostring(self.sites)}|{self.siteId}|{self.network}|{self.product}|{self.tiltIndex}|{self.mosaicKind}|{self.showGround}|{self.showCloud}|{self.showRotation}|{self.looping}|{self.loaded}`
end

function Radar.updateInfo(self: any)
	local lightningLine, rotationLine = self.lightningLine :: TextLabel?, self.rotationLine :: TextLabel?
	if lightningLine and lightningLine.Parent then
		local l = self.lightning
		lightningLine.Text = if l and l.nowHourUtc then `Lightning to {Geo.clock(l.nowHourUtc)}: {l.ground} to the ground, {l.count - l.ground} in the cloud, last {l.keepMinutes} min.` else ""
		lightningLine.Visible = lightningLine.Text ~= ""
	end
	if rotationLine and rotationLine.Parent then
		local r = self.rotation
		rotationLine.Text = if r and not self.network then `{self.siteId} rotation at {Geo.clock(r.validHourUtc)}: {#r.tvs} TVS, {#r.meso} meso (tilts {r.tilts[1]}-{r.tilts[#r.tilts]}°; TVS within {math.round(r.tdaRangeMiles)} mi).` else ""
		rotationLine.Visible = rotationLine.Text ~= ""
	end
end

function Radar.renderOptions(self: any)
	self.shownOptions = self:optionsKey()
	Ui.clear(self.options)
	if self.loaded and not self.sites then
		Ui.text(self.options, "The weather server sends no radar. Restart it, and scripts/game-feed-proxy.mjs, on the current code.", { size = 13, colour = Color3.fromRGB(250, 170, 90) })
		return
	end
	local sites = self.sites
	local strikes = Ui.buttons(self.options, 26)
	Ui.setOn(Ui.button(strikes, "Lightning", function()
		self.showGround = not self.showGround
		self:renderOptions()
		self.ctx.redraw()
	end), self.showGround)
	Ui.setOn(Ui.button(strikes, "Cloud flashes", function()
		self.showCloud = not self.showCloud
		self:renderOptions()
		self.ctx.redraw()
	end), self.showCloud)
	self.lightningLine = Ui.text(self.options, "", { size = 12, colour = Ui.MUTED })
	local marks = Ui.buttons(self.options, 26)
	Ui.setOn(Ui.button(marks, "Rotation (TVS, meso)", function()
		self.showRotation = not self.showRotation
		self.rotation = nil
		task.spawn(self.refresh, self)
	end), self.showRotation)
	self.rotationLine = Ui.text(self.options, "", { size = 12, colour = Ui.MUTED })
	self:updateInfo()

	local modes = Ui.buttons(self.options, 26)
	Ui.setOn(Ui.button(modes, "Single radar", function()
		if self.network then
			self.network = false
			self:changed()
		end
	end), not self.network)
	Ui.setOn(Ui.button(modes, "Network", function()
		if not self.network then
			self.network = true
			self:changed()
		end
	end), self.network)

	if self.network then
		local kinds = row(self.options, 26, 3)
		for _, m in (sites and sites.mosaics) or {} do
			local button = Ui.button(kinds, m.label, function()
				self.mosaicKind = m.kind
				self:changed()
			end)
			button.TextSize = 12
			button.TextTruncate = Enum.TextTruncate.AtEnd
			Ui.setOn(button, m.kind == self.mosaicKind)
		end
	else
		local products = row(self.options, 26, 3)
		for _, key in (sites and sites.siteProducts) or { "reflectivity", "velocity", "stormRelativeVelocity" } do
			local spec = Palettes.RADAR[key]
			Ui.setOn(Ui.button(products, if spec then spec.short else key, function()
				self.product = key
				self:changed()
			end), key == self.product)
		end
		local tilts = row(self.options, 24, 5)
		for k, tilt in (sites and sites.tilts) or {} do
			local button = Ui.button(tilts, `{tilt}°`, function()
				self.tiltIndex = k - 1
				self:changed()
			end)
			button.TextSize = 12
			Ui.setOn(button, k - 1 == self.tiltIndex)
		end
	end

	local loop = Ui.buttons(self.options, 26)
	Ui.setOn(Ui.button(loop, if self.looping then "Stop loop" else "Loop", function()
		self.looping = not self.looping
		self.frameAt = 0
		if self.looping then
			self:startLoop()
		else
			self.loopToken += 1
			MapCanvas.redrawRaster()
		end
		self:renderOptions()
	end), self.looping)

	self.status = Ui.text(self.options, "", { size = 13, bold = true })
	self:updateStatus()

	if not self.network then
		local stations = Ui.buttons(self.options, 26)
		for _, site in (sites and sites.sites) or {} do
			local button = Ui.button(stations, `{site.id} {site.name}`, function()
				self:choose(site.id)
			end)
			button.TextSize = 12
			button.TextTruncate = Enum.TextTruncate.AtEnd
			Ui.setOn(button, site.id == self.siteId)
		end
		Ui.text(self.options, "Or click a radar's label on the map. Point at the radar image to read a value.", { size = 12, colour = Ui.MUTED })
	end
end

-- The line saying what is on show (changed in place as a loop plays).
function Radar.updateStatus(self: any)
	local label = self.status :: TextLabel?
	if not label or not label.Parent then
		return
	end
	local product = self:current()
	if product then
		local spec = Palettes.RADAR[product.product]
		local what = if product.kind == "radar-grid"
			then `Network · {product.label}`
			else `{product.site} {product.siteName} · {if spec then spec.short else product.product} {product.tiltDeg}°`
		local frame = if self.looping and self.frameAt > 0 then ` · frame {self.frameAt}/{#self.frames}` else ""
		label.Text = `{what} · scan {Geo.clock(product.validHourUtc)}{frame}`
	else
		label.Text = if self.network or self.siteId then "Waiting for the scan…" else "Pick a radar."
	end
end

function Radar.refresh(self: any)
	self.sites = ProductClient.get("radar.sites")
	self.lightning = ProductClient.get("lightning")
	self.loaded = true
	if self.sites and not self.siteId then
		-- The radar nearest you to start with.
		local mx, my = MapCanvas.playerMiles()
		local best, bestD = nil, math.huge
		for _, site in self.sites.sites do
			local d = (site.xMiles - (mx or 250)) ^ 2 + (site.yMiles - (my or 250)) ^ 2
			if d < bestD then
				best, bestD = site.id, d
			end
		end
		self.siteId = best
	end
	local id = self:productId()
	self.shown = if id then ProductClient.get(id) else nil
	local rotationId = self:rotationId()
	local rotation = if rotationId then ProductClient.get(rotationId) else nil
	self.rotation = if rotation and rotation.kind == "radar-rotation" and rotation.site == self.siteId then rotation else nil
	if self.shownOptions ~= self:optionsKey() then
		self:renderOptions()
	else
		self:updateInfo()
		self:updateStatus()
	end
	self.ctx.redraw()
end

-- The loop: the scans the server holds for what is on show (the newest product's `loop`),
-- fetched one by one the first time, then shown in turn, the newest held a little longer.
function Radar.startLoop(self: any)
	self.loopToken += 1
	local token = self.loopToken
	task.spawn(function()
		local have: { [string]: Frame } = {}
		while self.looping and self.enabled and self.loopToken == token do
			local shown = self.shown
			local list = if shown and shown.loop then shown.loop else {}
			local frames: { Frame } = {}
			for _, entry in list do
				local frame = have[entry.id]
				if not frame then
					local product = if shown and math.abs(entry.validHourUtc - shown.validHourUtc) < 1e-6 then shown else ProductClient.get(entry.id)
					if self.loopToken ~= token then
						return
					end
					local bytes = if product and product.data then bytesOf(product) else nil
					if product and bytes then
						frame = { id = entry.id, validHourUtc = entry.validHourUtc, product = product, bytes = bytes }
						have[entry.id] = frame
					end
				end
				if frame then
					table.insert(frames, frame)
				end
			end
			-- Frames no longer held by the server are let go here too.
			local keep: { [string]: Frame } = {}
			for _, frame in frames do
				keep[frame.id] = frame
			end
			have = keep
			self.frames = frames
			if #frames == 0 then
				task.wait(1)
			else
				for k = 1, #frames do
					if not (self.looping and self.enabled and self.loopToken == token) then
						return
					end
					self.frameAt = k
					MapCanvas.redrawRaster()
					self:updateStatus()
					task.wait(if k == #frames then LOOP_HOLD_SECONDS else LOOP_STEP_SECONDS)
				end
			end
		end
	end)
end

function Radar.setEnabled(self: any, on: boolean)
	self.enabled = on
	self.keepaliveToken += 1
	if not on then
		self.loopToken += 1
		return
	end
	task.spawn(self.refresh, self)
	if self.looping then
		self:startLoop()
	end
	-- Keep the radar's product coming while it is on show.
	local token = self.keepaliveToken
	task.spawn(function()
		while self.enabled and self.keepaliveToken == token do
			task.wait(KEEPALIVE_SECONDS)
			local id, rotationId = self:productId(), self:rotationId()
			if self.enabled and self.keepaliveToken == token and id then
				ProductClient.touch(id)
			end
			if self.enabled and self.keepaliveToken == token and rotationId then
				ProductClient.touch(rotationId)
			end
		end
	end)
end

-- The scan itself: one image of the view (MapCanvas draws it at up to 1024 pixels).
-- A mosaic small enough to be one image (EditableImage: at most 1024 a side) is shown as a grid
-- the GPU scales (grids); a larger one is drawn into the raster image.
local function gridFits(product: any): boolean
	return product.width <= 1024 and product.height <= 1024
end

function Radar.grids(self: any): { MapCanvas.Grid }
	local product, bytes = self:current()
	local spec = if product then Palettes.RADAR[product.product] else nil
	if not product or not bytes or not spec or product.kind ~= "radar-grid" or not gridFits(product) then
		return {}
	end
	return { { key = `{product.id}@{product.validHourUtc}`, bytes = bytes, width = product.width, height = product.height, cellMiles = product.cellMiles, lut = spec.lut, alpha = RADAR_ALPHA } }
end

-- The scan, and over it the lightning and rotation marks: they change with every storm tick,
-- as the scan does, so they are drawn with it rather than into the map's product tiles (which
-- would all be drawn again each time).
function Radar.drawRaster(self: any, draw: MapCanvas.Draw)
	local product, bytes = self:current()
	local spec = if product then Palettes.RADAR[product.product] else nil
	if product and bytes and spec then
		if product.kind == "radar-polar" then
			draw.polar(bytes, product.radials, product.gates, product.gateGroundMiles, product.xMiles, product.yMiles, spec.lut, RADAR_ALPHA)
		elseif product.kind == "radar-grid" and not gridFits(product) then
			draw.grid(bytes, product.width, product.height, product.cellMiles, spec.lut, RADAR_ALPHA)
		end
	end
	self:drawLightning(draw)
	self:drawRotation(draw)
end

-- What the shapes (the range ring) depend on.
function Radar.shapeKey(self: any): string
	return `{tostring(self.sites)}|{self.siteId}|{self.network}`
end

-- What the legend depends on.
function Radar.legendKey(self: any): string
	local l = self.lightning
	local product = self:current()
	local lightning = if l and (self.showGround or self.showCloud) then tostring(#(l.ages or {})) else "-"
	return if product then `{lightning}|{product.kind}|{product.product}|{product.label}|{product.scans}|{product.fromHourUtc}` else lightning
end

-- What drawRaster draws now: the scan's id and time (a loop's frames each once a view).
function Radar.rasterKey(self: any): string?
	self:checkFine()
	local product, bytes = self:current()
	local marks = `{if self.showGround or self.showCloud then tostring(self.lightning) else "-"}|{self.showGround}|{self.showCloud}|{tostring(self.rotation)}|{self.ctx.selected(self.key)}`
	if not product or not bytes then
		return `none|{marks}`
	end
	return `{product.id}@{product.validHourUtc}|{marks}`
end

-- The value under the cursor, with where it is from the radar and how high the beam is there.
function Radar.hover(self: any, mx: number, my: number): string?
	local product, bytes = self:current()
	if not product or not bytes then
		return nil
	end
	local spec = Palettes.RADAR[product.product]
	if not spec then
		return nil
	end
	if product.kind == "radar-grid" then
		local i, j = math.floor(mx / product.cellMiles), math.floor(my / product.cellMiles)
		if i < 0 or j < 0 or i >= product.width or j >= product.height then
			return nil
		end
		return valueText(spec, buffer.readu8(bytes, j * product.width + i))
	end
	local dx, dy = mx - product.xMiles, my - product.yMiles
	local miles = math.sqrt(dx * dx + dy * dy)
	local gate = math.floor(miles / product.gateGroundMiles)
	if gate >= product.gates then
		return nil
	end
	local az = math.atan2(dx, -dy)
	if az < 0 then
		az += TAU
	end
	local radial = math.floor(az * product.radials / TAU) % product.radials
	local text = valueText(spec, buffer.readu8(bytes, radial * product.gates + gate)) or `{spec.short} no echo`
	local beam = if product.beamKft then product.beamKft[gate + 1] else nil
	return `{text} · {string.format("%.0f", miles)} mi {string.format("%03d", math.round(math.deg(az)) % 360)}° from {product.site}`
		.. (if beam then string.format(", beam %.1f kft", beam) else "")
end

-- The chosen radar's reach, drawn sharp with the other shapes.
function Radar.draw(self: any, draw: MapCanvas.Draw)
	local site = self:site()
	if site and self.sites and not self.network then
		local ring = {}
		for k = 0, 89 do
			local a = k / 90 * 2 * math.pi
			table.insert(ring, site.xMiles + self.sites.rangeMiles * math.sin(a))
			table.insert(ring, site.yMiles - self.sites.rangeMiles * math.cos(a))
		end
		draw.stroke({ ring }, 1.2, RING)
	end
end

local function circle(x: number, y: number, radius: number): { number }
	local ring = {}
	for j = 0, 31 do
		local a = j / 32 * TAU
		table.insert(ring, x + radius * math.cos(a))
		table.insert(ring, y + radius * math.sin(a))
	end
	return ring
end

-- The mesocyclones under the TVSs.
function Radar.drawRotation(self: any, draw: MapCanvas.Draw)
	local r = self.rotation
	if not r or self.network then
		return
	end
	local mpp = MapCanvas.milesPerPixel()
	for _, m in r.meso do
		local ring = circle(m.xMiles, m.yMiles, math.max(m.diameterMiles / 2, MESO_MIN_PIXELS * mpp))
		draw.stroke({ ring }, 4, MARK_OUTLINE)
		draw.stroke({ ring }, 2.2, MESO_COLOUR)
	end
	local s = TVS_PIXELS * mpp
	for _, t in r.tvs do
		-- (point down, on the detection; map y runs south)
		local tri = { t.xMiles - s, t.yMiles - 1.6 * s, t.xMiles + s, t.yMiles - 1.6 * s, t.xMiles, t.yMiles + 0.2 * s }
		draw.fill({ tri }, if t.kind == "TVS" then TVS_COLOUR else ETVS_COLOUR, 1)
		draw.stroke({ tri }, 1.4, MARK_OUTLINE)
	end
end

-- Which of Smith et al. (2015)'s mean tornado Vrot a rotational velocity (kt) is nearest at or below.
local EF_ORDER = { "EF0", "EF1", "EF2", "EF3", "EF4+" }
local function vrotBand(table_: { [string]: number }, kt: number): string
	local band = `below the EF0 mean ({table_.EF0} kt)`
	for _, ef in EF_ORDER do
		if table_[ef] and kt >= table_[ef] then
			band = `at or above the {ef} mean ({table_[ef]} kt)`
		end
	end
	return band
end

function Radar.hitRotation(self: any, mx: number, my: number, milesPerPixel: number): Layer.Detail?
	local r = self.rotation
	if not r or self.network then
		return nil
	end
	local reach = ROTATION_PICK_PIXELS * milesPerPixel
	for k, t in r.tvs do
		if (t.xMiles - mx) ^ 2 + (t.yMiles - my) ^ 2 <= reach * reach then
			local lines = {
				`Gate-to-gate shear {t.lowDvKt} kt on the {t.tiltDeg}° tilt, {t.maxDvKt} kt at most.`,
				`From {t.baseKft} to {t.topKft} kft above the radar.`,
				if t.kind == "TVS" then "Tornado Detection Algorithm: a tornadic vortex signature, deep and strong down to the lowest tilt." else "Elevated: strong aloft, but its base is above the lowest tilt and 600 m.",
			}
			return { title = if t.kind == "TVS" then "Tornadic vortex signature" else "Elevated TVS", subtitle = `{r.site} radar, {Geo.clock(r.validHourUtc)}`, body = table.concat(lines, "\n"), colour = if t.kind == "TVS" then TVS_COLOUR else ETVS_COLOUR, layer = self.key, item = `tvs:{k}` }
		end
	end
	for k, m in r.meso do
		local radius = math.max(m.diameterMiles / 2, MESO_MIN_PIXELS * milesPerPixel) + reach / 2
		if (m.xMiles - mx) ^ 2 + (m.yMiles - my) ^ 2 <= radius * radius then
			local lines = {
				`Rotational velocity {m.lowVrotKt} kt on the {m.tiltDeg}° tilt ({vrotBand(r.vrotByEf, m.lowVrotKt)} of tornadoes, Smith et al. 2015), {m.maxVrotKt} kt at most.`,
				string.format("%.1f miles across; from %s to %s kft above the radar.", m.diameterMiles, tostring(m.baseKft), tostring(m.topKft)),
				"Far from the radar its beam is wide and high: rotation reads weaker there.",
			}
			return { title = "Mesocyclone", subtitle = `{r.site} radar, {Geo.clock(r.validHourUtc)}`, body = table.concat(lines, "\n"), colour = MESO_COLOUR, layer = self.key, item = `meso:{k}` }
		end
	end
	return nil
end

-- Oldest first, so the newest strikes lie on top.
function Radar.drawLightning(self: any, draw: MapCanvas.Draw)
	local l = self.lightning
	local strikes = if self.showGround or self.showCloud then strikesOf(l) else nil
	if not strikes then
		return
	end
	local mpp = MapCanvas.milesPerPixel()
	local arm = CROSS_PIXELS * mpp
	for k = 1, #strikes.x do
		local kind = strikes.kind[k]
		local colour = ageColour(l.ages, strikes.age[k])
		if colour then
			local x, y = strikes.x[k], strikes.y[k]
			if kind == 0 then
				if self.showCloud then
					draw.dot(x, y, CLOUD_DOT_PIXELS, colour)
				end
			elseif self.showGround then
				draw.line(x - arm, y, x + arm, y, OUTLINE_WIDTH, STRIKE_OUTLINE)
				draw.line(x, y - arm, x, y + arm, OUTLINE_WIDTH, STRIKE_OUTLINE)
				draw.line(x - arm, y, x + arm, y, CROSS_WIDTH, colour)
				draw.line(x, y - arm, x, y + arm, CROSS_WIDTH, colour)
				if kind == 2 then
					local ring = {}
					for j = 0, 15 do
						local a = j / 16 * 2 * math.pi
						table.insert(ring, x + 1.25 * arm * math.cos(a))
						table.insert(ring, y + 1.25 * arm * math.sin(a))
					end
					draw.stroke({ ring }, 1.2, colour)
				end
			end
		end
	end
end

-- The strike nearest a map point within reach, if any: its details, and how many ground
-- strikes there have been near it lately.
function Radar.hitLightning(self: any, mx: number, my: number, milesPerPixel: number): Layer.Detail?
	local l = self.lightning
	local strikes = if self.showGround or self.showCloud then strikesOf(l) else nil
	if not strikes then
		return nil
	end
	local reach = STRIKE_PICK_PIXELS * milesPerPixel
	local best, bestD = nil, reach * reach
	for k = #strikes.x, 1, -1 do
		local kind = strikes.kind[k]
		if (kind == 0 and self.showCloud) or (kind ~= 0 and self.showGround) then
			local d = (strikes.x[k] - mx) ^ 2 + (strikes.y[k] - my) ^ 2
			if d < bestD then
				best, bestD = k, d
			end
		end
	end
	if not best then
		return nil
	end
	local nearby = 0
	for k = 1, #strikes.x do
		if strikes.kind[k] ~= 0 and strikes.age[k] <= NEARBY_MINUTES and (strikes.x[k] - strikes.x[best]) ^ 2 + (strikes.y[k] - strikes.y[best]) ^ 2 <= NEARBY_MILES ^ 2 then
			nearby += 1
		end
	end
	local age = strikes.age[best]
	local lines = {
		`{KIND_NAMES[strikes.kind[best]] or "Lightning"}.`,
		`{Geo.clock(l.nowHourUtc - age / 60)}, {math.round(age)} min before the latest data ({Geo.clock(l.nowHourUtc)}).`,
		`{nearby} ground strikes within {NEARBY_MILES} miles in the last {NEARBY_MINUTES} minutes.`,
	}
	return { title = "Lightning", subtitle = "Lightning detection", body = table.concat(lines, "\n"), colour = ageColour(l.ages, age), layer = self.key, item = `strike:{best}` }
end

function Radar.labels(self: any, labels: MapCanvas.Labels)
	for _, site in (self.sites and self.sites.sites) or {} do
		labels.at(site.id, site.xMiles, site.yMiles, if site.id == self.siteId and not self.network then SITE_CHOSEN else SITE_BORDER)
	end
end

function Radar.hit(self: any, mx: number, my: number, milesPerPixel: number): Layer.Detail?
	local reach = PICK_PIXELS * milesPerPixel
	for _, site in (self.sites and self.sites.sites) or {} do
		if (site.xMiles - mx) ^ 2 + (site.yMiles - my) ^ 2 <= reach * reach then
			if site.id ~= self.siteId or self.network then
				self:choose(site.id)
			end
			local shown = self.shown
			local lines = { `Tilts {self.sites.tilts and self.sites.tilts[1] or self.sites.tiltDeg}° up; the lowest reaches about {math.round(self.sites.rangeMiles)} miles.` }
			if shown and shown.site == site.id and shown.stormMotion then
				local u, v = shown.stormMotion.u, shown.stormMotion.v
				table.insert(lines, string.format("Storm motion (taken out of SRV): from %03d° at %d kt.", math.round((math.deg(math.atan2(-u, -v)) + 360) % 360), math.round(math.sqrt(u * u + v * v) * KT_PER_MS)))
			end
			return { title = `{site.id} {site.name} radar`, subtitle = "Doppler radar", body = table.concat(lines, "\n"), colour = SITE_CHOSEN, layer = self.key, item = site.id }
		end
	end
	return self:hitRotation(mx, my, milesPerPixel) or self:hitLightning(mx, my, milesPerPixel)
end

function Radar.legend(self: any, parent: Instance)
	local l = self.lightning
	if l and (self.showGround or self.showCloud) then
		Ui.text(parent, "Lightning (minutes ago)", { size = 12, bold = true, colour = Ui.MUTED })
		local from = 0
		for _, band in l.ages do
			Ui.legendRow(parent, Color3.fromRGB(band.colour[1], band.colour[2], band.colour[3]), `{from}-{band.toMinutes}`, "")
			from = band.toMinutes
		end
		Ui.text(parent, "+ ground strike, ringed when positive; dot: in the cloud.", { size = 12, colour = Ui.MUTED })
	end
	local product = self:current()
	local spec = if product then Palettes.RADAR[product.product] else nil
	if not spec then
		return
	end
	Ui.text(parent, `{if product.kind == "radar-grid" then product.label else spec.label} ({spec.units})`, { size = 12, bold = true, colour = Ui.MUTED })
	if product.scans and product.fromHourUtc then
		Ui.text(parent, `Greatest of {product.scans} scans, {Geo.clock(product.fromHourUtc)}-{Geo.clock(product.validHourUtc)} (kept from when first asked for).`, { size = 12, colour = Ui.MUTED })
	end
	for _, value in spec.legend do
		local k = byteOf(spec, value) * 4
		Ui.legendRow(parent, Color3.fromRGB(spec.lut[k + 1], spec.lut[k + 2], spec.lut[k + 3]), `{value} {spec.units}`, "")
	end
	if spec.doppler then
		Ui.legendRow(parent, Color3.fromRGB(119, 0, 125), "Range folded", "motion unknown")
		if spec.short ~= "SW" then
			Ui.text(parent, "Green: towards the radar. Red: away from it.", { size = 12, colour = Ui.MUTED })
		end
	end
end

return Radar
