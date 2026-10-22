--!strict
-- One radar's lowest tilt (server/GameProducts.js "radar.site.<ID>.<product>"): reflectivity,
-- velocity or storm-relative velocity. The radars are buttons in the side panel, and their
-- labels on the map can be clicked too. The bytes and their colours are the weather server's
-- (js/radar/RadarFormat.js); this only draws them. A radar's scan is made when first asked for
-- and kept current while it is on show.
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

local PRODUCTS = { { key = "reflectivity", name = "REF" }, { key = "velocity", name = "VEL" }, { key = "stormRelativeVelocity", name = "SRV" } }
local KEEPALIVE_SECONDS = 30 -- the game server keeps a radar's scan current while someone asks
local RADAR_ALPHA = 0.92
local RING = { 150, 160, 175 }
local SITE_BORDER, SITE_CHOSEN = { 120, 130, 145 }, { 255, 255, 255 }
local PICK_PIXELS = 14 -- a click this close to a radar's label picks it
local STRIKE_PICK_PIXELS = 8
local CROSS_PIXELS, CROSS_WIDTH, OUTLINE_WIDTH = 4.5, 1.6, 3.4
local CLOUD_DOT_PIXELS = 1.2
local STRIKE_OUTLINE = { 20, 20, 24 }
local NEARBY_MILES, NEARBY_MINUTES = 10, 15 -- a strike's details count the ground strikes this near and this recent

type Strikes = { key: string, x: { number }, y: { number }, age: { number }, kind: { number } }

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
		lightning = nil :: any,
		showGround = true,
		showCloud = false,
	}, Radar)
	return self
end

function Radar.productId(self: any): string?
	return if self.siteId then `radar.site.{self.siteId}.{self.product}` else nil
end

function Radar.wants(self: any, id: string): boolean
	return id == "radar.sites" or id == "lightning" or id == self:productId()
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
	local l = self.lightning
	if l and l.nowHourUtc then
		Ui.text(self.options, `Lightning to {Geo.clock(l.nowHourUtc)}: {l.ground} to the ground, {l.count - l.ground} in the cloud, last {l.keepMinutes} min.`, { size = 12, colour = Ui.MUTED })
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

-- The scan itself: one image of the view (MapCanvas draws it at up to 1024 pixels).
function Radar.drawRaster(self: any, draw: MapCanvas.Draw)
	local shown = self.shown
	if shown and shown.kind == "radar-polar" then
		local bytes = bytesOf(shown)
		local spec = Palettes.RADAR[shown.product]
		if bytes and spec then
			draw.polar(bytes, shown.radials, shown.gates, shown.gateGroundMiles, shown.xMiles, shown.yMiles, spec.lut, RADAR_ALPHA)
		end
	end
end

-- The chosen radar's reach, drawn sharp with the other shapes.
function Radar.draw(self: any, draw: MapCanvas.Draw)
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
	self:drawLightning(draw)
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
	return self:hitLightning(mx, my, milesPerPixel)
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
