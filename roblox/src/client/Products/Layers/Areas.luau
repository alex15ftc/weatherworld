--!strict
-- A layer of issued areas, each with its own text: the watches and the mesoscale discussions
-- (product "mesoscale") and the warnings (product "warnings"), server/GameProducts.js. Each is
-- outlined in the colour the weather server's colour key gives it; the side panel lists those
-- in effect, and a click on one, there or on the map, opens its text.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Palettes = require(ReplicatedStorage.Shared.Weather.Palettes)
local Products = script.Parent.Parent
local MapCanvas = require(Products.MapCanvas)
local ProductClient = require(Products.ProductClient)
local Ui = require(Products.Ui)
local Geo = require(Products.Geo)
local Layer = require(Products.Layer)

local Areas = {}
Areas.__index = Areas

export type Kind = {
	key: string,
	name: string,
	productId: string,
	field: string, -- the list in the product
	palette: any, -- colour key -> { r, g, b } (Palettes.WATCH, DISCUSSION or WARNING)
	fillAlpha: number,
	strokeWidth: number,
	none: string, -- shown when there are none
	id: (item: any) -> string,
	title: (item: any) -> string,
	subtitle: (item: any) -> string,
	short: ((item: any) -> string)?, -- a label on the map
}

local SELECTED = { 255, 255, 255 }

local function untilText(item: any): string
	return `until {Geo.clock(item.validToHourUtc)}`
end

Areas.WATCHES = {
	key = "watches", name = "Watches", productId = "mesoscale", field = "watches", palette = Palettes.WATCH,
	fillAlpha = 0.14, strokeWidth = 3, none = "No watches in effect.",
	id = function(w: any): string
		return tostring(w.number)
	end,
	title = function(w: any): string
		return (if w.pds then "PDS " else "") .. w.title
	end,
	subtitle = function(w: any): string
		return `{untilText(w)} · {w.where}`
	end,
	short = function(w: any): string
		return `{if w.pds then "PDS " else ""}{if w.type == "tornado" then "TOR" else "SVR"} {w.number}`
	end,
} :: Kind

Areas.DISCUSSIONS = {
	key = "discussions", name = "Discussions", productId = "mesoscale", field = "discussions", palette = Palettes.DISCUSSION,
	fillAlpha = 0, strokeWidth = 2, none = "No mesoscale discussions in effect.",
	id = function(md: any): string
		return tostring(md.number)
	end,
	title = function(md: any): string
		return string.format("Mesoscale Discussion %04d", md.number)
	end,
	subtitle = function(md: any): string
		return `{md.concerning} · {untilText(md)}`
	end,
	short = function(md: any): string
		return string.format("MD %04d", md.number)
	end,
} :: Kind

Areas.WARNINGS = {
	key = "warnings", name = "Warnings", productId = "warnings", field = "warnings", palette = Palettes.WARNING,
	fillAlpha = 0.12, strokeWidth = 2.5, none = "No warnings in effect.",
	id = function(w: any): string
		return w.id
	end,
	title = function(w: any): string
		return w.title
	end,
	subtitle = function(w: any): string
		return `{w.label} · {untilText(w)} · {w.where}`
	end,
	short = nil,
} :: Kind

function Areas.new(kind: Kind, ctx: Layer.Context, optionsParent: Instance, enabled: boolean)
	local self = setmetatable({
		key = kind.key,
		name = kind.name,
		enabled = enabled,
		options = Ui.section(optionsParent),
		ctx = ctx,
		kind = kind,
		product = nil :: any,
	}, Areas)
	return self
end

function Areas.items(self: any): { any }
	return (self.product and self.product[self.kind.field]) or {}
end

function Areas.wants(self: any, id: string): boolean
	return id == self.kind.productId
end

function Areas.detail(self: any, item: any): Layer.Detail
	local kind = self.kind
	return { title = kind.title(item), subtitle = kind.subtitle(item), body = item.text or "", colour = kind.palette[item.colourKey], layer = self.key, item = kind.id(item) }
end

function Areas.renderOptions(self: any)
	Ui.clear(self.options)
	local product = self.product
	if product and product.status == "off" then
		Ui.text(self.options, `{self.name} are turned off on the weather server.`, { size = 12, colour = Ui.MUTED })
		return
	end
	local items = self:items()
	if #items == 0 then
		Ui.text(self.options, if product then self.kind.none else "Loading…", { size = 12, colour = Ui.MUTED })
		return
	end
	for _, item in items do
		local colour = self.kind.palette[item.colourKey]
		Ui.listButton(self.options, `{self.kind.title(item)} · {untilText(item)}`, if colour then Ui.rgb(colour) else nil, function()
			self.ctx.showDetail(self:detail(item))
		end)
	end
end

function Areas.refresh(self: any)
	self.product = ProductClient.get(self.kind.productId)
	self:renderOptions()
	self.ctx.redraw()
end

function Areas.setEnabled(self: any, on: boolean)
	self.enabled = on
	if on then
		task.spawn(self.refresh, self)
	end
end

function Areas.draw(self: any, draw: MapCanvas.Draw)
	local kind = self.kind
	local chosen = self.ctx.selected(self.key)
	-- The least urgent first, so the most urgent outline is on top (the list comes most urgent first).
	local items = self:items()
	for k = #items, 1, -1 do
		local item = items[k]
		local colour = kind.palette[item.colourKey] or { 200, 200, 200 }
		if kind.fillAlpha > 0 then
			draw.fill(item.rings, colour, kind.fillAlpha)
		end
		draw.stroke(item.rings, kind.strokeWidth, colour)
	end
	for _, item in items do
		if kind.id(item) == chosen then
			draw.stroke(item.rings, kind.strokeWidth + 1.5, SELECTED)
		end
	end
end

function Areas.labels(self: any, labels: MapCanvas.Labels)
	local short: ((any) -> string)? = self.kind.short
	if not short then
		return
	end
	for _, item in self:items() do
		local colour = self.kind.palette[item.colourKey] or { 200, 200, 200 }
		local x, y = Geo.middle(item.rings)
		if not labels.at(short(item), x, y, colour) then
			labels.onRing(short(item), item.rings, colour)
		end
	end
end

function Areas.hit(self: any, mx: number, my: number, _milesPerPixel: number): Layer.Detail?
	-- The most urgent there (the list comes most urgent first).
	for _, item in self:items() do
		if Geo.inside(item.rings, mx, my) then
			return self:detail(item)
		end
	end
	return nil
end

function Areas.legend(_self: any, _parent: Instance) end

return Areas
