--!strict
-- The satellite (server/GameProducts.js satellite.<kind>, js/satellite/Satellite.js): the whole
-- map as a geostationary satellite sees it, clean IR (cloud-top temperature, the enhanced colours
-- forecasters read storm tops on) or visible (sunlight off the clouds: dark at night), on the
-- weather server's 2 km grid. The bytes and colours are the server's (Palettes.SATELLITE); this
-- shows them under the radar (as a grid the GPU scales, MapCanvas.Grid), reads a value back under the cursor, and plays the images the server
-- holds as a loop. Made when first asked for and kept current while on show.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local EncodingService = game:GetService("EncodingService")

local Palettes = require(ReplicatedStorage.Shared.Weather.Palettes)
local Products = script.Parent.Parent
local MapCanvas = require(Products.MapCanvas)
local ProductClient = require(Products.ProductClient)
local Ui = require(Products.Ui)
local Geo = require(Products.Geo)
local Layer = require(Products.Layer)

local Satellite = {}
Satellite.__index = Satellite

local KEEPALIVE_SECONDS = 30
local ALPHA = 0.94
local KINDS = { "ir", "visible" }
local LOOP_STEP_SECONDS, LOOP_HOLD_SECONDS = 0.45, 1.5

type Frame = { id: string, validHourUtc: number, product: any, bytes: buffer }

local function unpackBytes(product: any): buffer?
	local ok, bytes = pcall(function()
		return EncodingService:DecompressBuffer(EncodingService:Base64Decode(buffer.fromstring(product.data)), Enum.CompressionAlgorithm.Zstd)
	end)
	if not ok then
		warn(`[Satellite] {product.id}: could not unpack ({bytes})`)
		return nil
	end
	return bytes
end

-- The newest image of each kind, unpacked once an image (a loop's frames hold their own bytes):
-- one entry a kind, so it never grows.
local decoded: { [string]: { id: string, key: string, bytes: buffer } } = {}
local function bytesOf(product: any): buffer?
	local key = tostring(product.validHourUtc)
	local slot = tostring(product.product)
	local held = decoded[slot]
	if held and held.id == product.id and held.key == key then
		return held.bytes
	end
	local bytes = unpackBytes(product)
	if not bytes then
		return nil
	end
	decoded[slot] = { id = product.id, key = key, bytes = bytes }
	return bytes
end

-- A byte as what it reads (IR: degrees C; visible: reflectance in %), nil for no data.
local function valueOf(spec: any, byte: number): number?
	if byte == 0 then
		return nil
	end
	if spec.sqrt then
		return 100 * ((byte - 1) / 254) ^ 2
	end
	return spec.min + (byte - 1) * spec.step
end
local function byteOf(spec: any, value: number): number
	if spec.sqrt then
		return math.clamp(1 + math.round(254 * math.sqrt(math.clamp(value / 100, 0, 1))), 1, 255)
	end
	return math.clamp(1 + math.round((value - spec.min) / spec.step), 1, 255)
end

function Satellite.new(ctx: Layer.Context, optionsParent: Instance)
	local self = setmetatable({
		key = "satellite",
		name = "Satellite",
		enabled = false,
		options = Ui.section(optionsParent),
		ctx = ctx,
		kind = "ir",
		shown = nil :: any,
		loaded = false,
		keepaliveToken = 0,
		looping = false,
		loopToken = 0,
		frames = {} :: { Frame },
		frameAt = 0,
		status = nil :: TextLabel?,
	}, Satellite)
	return self
end

function Satellite.productId(self: any): string
	return `satellite.{self.kind}`
end

function Satellite.wants(self: any, id: string): boolean
	return id == self:productId()
end

function Satellite.current(self: any): (any, buffer?)
	local frame = if self.looping then self.frames[self.frameAt] else nil
	if frame then
		return frame.product, frame.bytes
	end
	local shown = self.shown
	if shown and shown.kind == "satellite-grid" then
		return shown, bytesOf(shown)
	end
	return nil, nil
end

function Satellite.changed(self: any)
	self.shown = nil
	self.frames = {}
	self.frameAt = 0
	self.loopToken += 1
	task.spawn(self.refresh, self)
	if self.looping then
		self:startLoop()
	end
end

function Satellite.renderOptions(self: any)
	Ui.clear(self.options)
	if self.loaded and not self.shown then
		Ui.text(self.options, "Waiting for the satellite. If it never comes, restart the weather server and scripts/game-feed-proxy.mjs on the current code.", { size = 12, colour = Ui.MUTED })
	end
	local kinds = Ui.buttons(self.options, 26)
	for _, kind in KINDS do
		local spec = Palettes.SATELLITE[kind]
		Ui.setOn(Ui.button(kinds, if spec then spec.label else kind, function()
			if self.kind ~= kind then
				self.kind = kind
				self:changed()
			end
		end), kind == self.kind)
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
	Ui.text(self.options, "Point at the image to read a value. Turn the radar on too to see it over the clouds.", { size = 12, colour = Ui.MUTED })
end

function Satellite.updateStatus(self: any)
	local label = self.status :: TextLabel?
	if not label or not label.Parent then
		return
	end
	local product = self:current()
	if product then
		local frame = if self.looping and self.frameAt > 0 then ` · frame {self.frameAt}/{#self.frames}` else ""
		local sun = product.sun
		local sunText = if sun then (if sun.elevationDeg > 0 then ` · sun {math.round(sun.elevationDeg)}° up` else " · night") else ""
		label.Text = `{product.label} · {Geo.clock(product.validHourUtc)}{sunText}{frame}`
	else
		label.Text = "Waiting for the image…"
	end
end

function Satellite.refresh(self: any)
	self.shown = ProductClient.get(self:productId())
	self.loaded = true
	self:renderOptions()
	self.ctx.redraw()
end

-- The loop: the images the server holds (the newest product's `loop`), fetched once each.
function Satellite.startLoop(self: any)
	self.loopToken += 1
	local token = self.loopToken
	task.spawn(function()
		local have: { [string]: Frame } = {}
		while self.looping and self.enabled and self.ctx.isOpen() and self.loopToken == token do
			local shown = self.shown
			local list = if shown and shown.loop then shown.loop else {}
			local frames: { Frame } = {}
			for _, entry in list do
				local frame = have[entry.id]
				if not frame then
					local newest = shown and math.abs(entry.validHourUtc - shown.validHourUtc) < 1e-6
					local product = if newest then shown else ProductClient.get(entry.id)
					if self.loopToken ~= token then
						return
					end
					local bytes = if product and product.data then (if newest then bytesOf(product) else unpackBytes(product)) else nil
					if product and bytes then
						frame = { id = entry.id, validHourUtc = entry.validHourUtc, product = product, bytes = bytes }
						have[entry.id] = frame
					end
				end
				if frame then
					table.insert(frames, frame)
				end
			end
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
					if not (self.looping and self.enabled and self.ctx.isOpen() and self.loopToken == token) then
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

function Satellite.setEnabled(self: any, on: boolean)
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
	-- (stopped while the screen is closed; started again when it opens)
	local token = self.keepaliveToken
	task.spawn(function()
		while self.enabled and self.ctx.isOpen() and self.keepaliveToken == token do
			task.wait(KEEPALIVE_SECONDS)
			if self.enabled and self.ctx.isOpen() and self.keepaliveToken == token then
				ProductClient.touch(self:productId())
			end
		end
	end)
end

function Satellite.draw(_self: any, _draw: MapCanvas.Draw) end

-- It draws no shapes: a new image never needs the map's product tiles drawn again.
function Satellite.shapeKey(_self: any): string
	return ""
end

function Satellite.legendKey(self: any): string
	local product = self:current()
	return if product then tostring(product.product) else ""
end

-- The image as one grid the GPU scales (smoothed between its 2 km pixels): it is coloured once
-- an image, and a pan or zoom only moves it.
function Satellite.grids(self: any): { MapCanvas.Grid }
	local product, bytes = self:current()
	local spec = if product then Palettes.SATELLITE[product.product] else nil
	if not product or not bytes or not spec then
		return {}
	end
	return { { key = `{product.id}@{product.validHourUtc}`, bytes = bytes, width = product.width, height = product.height, cellMiles = product.cellMiles, lut = spec.lut, alpha = ALPHA, smooth = true } }
end

function Satellite.hover(self: any, mx: number, my: number): string?
	local product, bytes = self:current()
	local spec = if product then Palettes.SATELLITE[product.product] else nil
	if not product or not bytes or not spec then
		return nil
	end
	local i, j = math.floor(mx / product.cellMiles), math.floor(my / product.cellMiles)
	if i < 0 or j < 0 or i >= product.width or j >= product.height then
		return nil
	end
	local value = valueOf(spec, buffer.readu8(bytes, j * product.width + i))
	if not value then
		return nil
	end
	return `{spec.short} {string.format(`%.{spec.decimals}f`, value)} {spec.units}`
end

function Satellite.labels(_self: any, _labels: MapCanvas.Labels) end

function Satellite.hit(_self: any, _mx: number, _my: number, _milesPerPixel: number): Layer.Detail?
	return nil
end

function Satellite.legend(self: any, parent: Instance)
	local product = self:current()
	local spec = if product then Palettes.SATELLITE[product.product] else nil
	if not spec then
		return
	end
	Ui.text(parent, `{spec.label} ({spec.units})`, { size = 12, bold = true, colour = Ui.MUTED })
	for _, value in spec.legend do
		local k = byteOf(spec, value) * 4
		Ui.legendRow(parent, Color3.fromRGB(spec.lut[k + 1], spec.lut[k + 2], spec.lut[k + 3]), `{value} {spec.units}`, "")
	end
	if spec.sqrt then
		Ui.text(parent, "Sunlight reflected, square-root stretched. Dark at night; low sun casts storm-top shadows.", { size = 12, colour = Ui.MUTED })
	else
		Ui.text(parent, "Cloud-top temperature: the colder, the higher. The coldest spots over storms are overshooting tops.", { size = 12, colour = Ui.MUTED })
	end
end

return Satellite
