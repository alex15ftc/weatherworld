--!strict
-- One radar's lowest tilt (server/GameProducts.js "radar.site.<ID>.<product>"): reflectivity,
-- velocity or storm-relative velocity. The radars are buttons in the side panel, and their
-- labels on the map can be clicked too. The bytes and their colours are the weather server's
-- (js/radar/RadarFormat.js); this only draws them. A radar's scan is made when first asked for
-- and kept current while it is on show.

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

local PRODUCTS = { { key = "reflectivity", name = "REF" }, { key = "velocity", name = "VEL" }, { key = "stormRelativeVelocity", name = "SRV" } }
local KEEPALIVE_SECONDS = 30 -- the game server keeps a radar's scan current while someone asks
local RADAR_ALPHA = 0.92
local RING = { 150, 160, 175 }
local SITE_BORDER, SITE_CHOSEN = { 120, 130, 145 }, { 255, 255, 255 }
local PICK_PIXELS = 14 -- a click this close to a radar's label picks it

local decoded: { [string]: { version: string, bytes: buffer } } = {}

local function bytesOf(product: any): buffer?
	local key = product.id .. "@" .. tostring(product.validHourUtc)
	local held = decoded[product.id]
	if held and held.version == key then
		return held.bytes
	end
	local ok, bytes = pcall(function()
		return EncodingService:DecompressBuffer(EncodingService:Base64Decode(buffer.fromstring(product.data)), Enum.CompressionAlgorithm.Zstd)
	end)
	if not ok then
		warn(`[Radar] {product.id}: could not unpack ({bytes})`)
		return nil
	end
	decoded[product.id] = { version = key, bytes = bytes }
	return bytes
end

local function byteOf(spec: any, value: number): number
	return math.clamp(1 + math.round((value - spec.min) / spec.step), if spec.doppler then 2 else 1, 255)
end

function Radar.new(ctx: Layer.Context, optionsParent: Instance)
	local self = setmetatable({
		key = "radar",
		name = "Radar",
		enabled = false,
		options = Ui.section(optionsParent),
		ctx = ctx,
		product = "reflectivity",
		siteId = nil :: string?,
		sites = nil :: any,
		shown = nil :: any,
		loaded = false,
		keepaliveToken = 0,
	}, Radar)
	return self
end

function Radar.productId(self: any): string?
	return if self.siteId then `radar.site.{self.siteId}.{self.product}` else nil
end

function Radar.wants(self: any, id: string): boolean
	return id == "radar.sites" or id == self:productId()
end

function Radar.site(self: any): any
	for _, site in (self.sites and self.sites.sites) or {} do
		if site.id == self.siteId then
			return site
		end
	end
	return nil
end

function Radar.choose(self: any, siteId: string)
	self.siteId = siteId
	self.shown = nil
	task.spawn(self.refresh, self)
end

function Radar.renderOptions(self: any)
	Ui.clear(self.options)
	if self.loaded and not self.sites then
		Ui.text(self.options, "The weather server sends no radar. Restart it, and scripts/game-feed-proxy.mjs, on the current code.", { size = 13, colour = Color3.fromRGB(250, 170, 90) })
		return
	end
	local products = Ui.buttons(self.options, 28)
	for _, entry in PRODUCTS do
		Ui.setOn(Ui.button(products, entry.name, function()
			self.product = entry.key
			self.shown = nil
			task.spawn(self.refresh, self)
		end), entry.key == self.product)
	end
	local shown = self.shown
	if shown then
		local spec = Palettes.RADAR[shown.product]
		Ui.text(self.options, `{shown.site} {shown.siteName} · {if spec then spec.short else shown.product} {shown.tiltDeg}° · scan {Geo.clock(shown.validHourUtc)}`, { size = 13, bold = true })
	elseif self.siteId then
		Ui.text(self.options, `Waiting for {self.siteId}…`, { size = 13, colour = Ui.MUTED })
	else
		Ui.text(self.options, "Pick a radar.", { size = 13, colour = Ui.MUTED })
	end
	local stations = Ui.buttons(self.options, 26)
	for _, site in (self.sites and self.sites.sites) or {} do
		local button = Ui.button(stations, `{site.id} {site.name}`, function()
			self:choose(site.id)
		end)
		button.TextSize = 12
		button.TextTruncate = Enum.TextTruncate.AtEnd
		Ui.setOn(button, site.id == self.siteId)
	end
	Ui.text(self.options, "Or click a radar's label on the map.", { size = 12, colour = Ui.MUTED })
end

function Radar.refresh(self: any)
	self.sites = ProductClient.get("radar.sites")
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
	self:renderOptions()
	self.ctx.redraw()
end

function Radar.setEnabled(self: any, on: boolean)
	self.enabled = on
	self.keepaliveToken += 1
	if not on then
		return
	end
	task.spawn(self.refresh, self)
	-- Keep the radar's scan coming while it is on show.
	local token = self.keepaliveToken
	task.spawn(function()
		while self.enabled and self.keepaliveToken == token do
			task.wait(KEEPALIVE_SECONDS)
			local id = self:productId()
			if self.enabled and self.keepaliveToken == token and id then
				ProductClient.touch(id)
			end
		end
	end)
end

function Radar.draw(self: any, draw: MapCanvas.Draw)
	local shown = self.shown
	if shown and shown.kind == "radar-polar" then
		local bytes = bytesOf(shown)
		local spec = Palettes.RADAR[shown.product]
		if bytes and spec then
			draw.polar(bytes, shown.radials, shown.gates, shown.gateGroundMiles, shown.xMiles, shown.yMiles, spec.lut, RADAR_ALPHA)
		end
	end
	-- The chosen radar's reach.
	local site = self:site()
	if site and self.sites then
		local ring = {}
		for k = 0, 89 do
			local a = k / 90 * 2 * math.pi
			table.insert(ring, site.xMiles + self.sites.rangeMiles * math.sin(a))
			table.insert(ring, site.yMiles - self.sites.rangeMiles * math.cos(a))
		end
		draw.stroke({ ring }, 1.2, RING)
	end
end

function Radar.labels(self: any, labels: MapCanvas.Labels)
	for _, site in (self.sites and self.sites.sites) or {} do
		labels.at(site.id, site.xMiles, site.yMiles, if site.id == self.siteId then SITE_CHOSEN else SITE_BORDER)
	end
end

function Radar.hit(self: any, mx: number, my: number, milesPerPixel: number): Layer.Detail?
	local reach = PICK_PIXELS * milesPerPixel
	for _, site in (self.sites and self.sites.sites) or {} do
		if (site.xMiles - mx) ^ 2 + (site.yMiles - my) ^ 2 <= reach * reach then
			if site.id ~= self.siteId then
				self:choose(site.id)
			end
			local shown = self.shown
			local lines = { `Lowest tilt ({self.sites.tiltDeg}°), reaching about {math.round(self.sites.rangeMiles)} miles.` }
			if shown and shown.site == site.id and shown.stormMotion then
				local u, v = shown.stormMotion.u, shown.stormMotion.v
				table.insert(lines, string.format("Storm motion (taken out of SRV): from %03d° at %d kt.", math.round((math.deg(math.atan2(-u, -v)) + 360) % 360), math.round(math.sqrt(u * u + v * v) * 1.944)))
			end
			return { title = `{site.id} {site.name} radar`, subtitle = "Doppler radar", body = table.concat(lines, "\n"), colour = SITE_CHOSEN, layer = self.key, item = site.id }
		end
	end
	return nil
end

function Radar.legend(self: any, parent: Instance)
	local shown = self.shown
	local spec = if shown then Palettes.RADAR[shown.product] else nil
	if not spec then
		return
	end
	Ui.text(parent, `{spec.label} ({spec.units})`, { size = 12, bold = true, colour = Ui.MUTED })
	for _, value in spec.legend do
		local k = byteOf(spec, value) * 4
		Ui.legendRow(parent, Color3.fromRGB(spec.lut[k + 1], spec.lut[k + 2], spec.lut[k + 3]), `{value} {spec.units}`, "")
	end
	if spec.doppler then
		Ui.legendRow(parent, Color3.fromRGB(119, 0, 125), "Range folded", "motion unknown")
		Ui.text(parent, "Green: towards the radar. Red: away from it.", { size = 12, colour = Ui.MUTED })
	end
end

return Radar
