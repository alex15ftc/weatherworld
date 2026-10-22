--!strict
-- The storm reports of one day (server/GameProducts.js "reports.day.<N>"), as the Storm
-- Prediction Center maps them: a red dot for a tornado, green for hail, blue for wind; the
-- significant ones (hail of 2 inches or more, wind of 75 mph or more) ringed. The day is picked
-- in the side panel (ReportDays, shared with the damage layer); a click on a report opens its text.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Palettes = require(ReplicatedStorage.Shared.Weather.Palettes)
local Products = script.Parent.Parent
local MapCanvas = require(Products.MapCanvas)
local Ui = require(Products.Ui)
local Layer = require(Products.Layer)
local ReportDays = require(script.Parent.ReportDays)

local Reports = {}
Reports.__index = Reports

local TYPES = { "wind", "hail", "tornado" } -- drawn in this order: tornadoes on top
local NAMES = { tornado = "Tornado", hail = "Hail", wind = "Wind" }
local DARK, WHITE = { 11, 17, 25 }, { 255, 255, 255 }
local PICK_PIXELS = 8
local LIST_MAX = 40 -- the side panel lists this many, the latest first

local function keyOf(r: any): string
	return `{r.type}|{r.hourUtc}|{r.x}|{r.y}`
end

function Reports.new(ctx: Layer.Context, optionsParent: Instance)
	local self = setmetatable({
		key = "reports",
		name = "Reports",
		enabled = false,
		options = Ui.section(optionsParent),
		ctx = ctx,
		shown = { tornado = true, hail = true, wind = true } :: { [string]: boolean },
	}, Reports)
	ReportDays.onChanged(function()
		if self.enabled then
			self:renderOptions()
			ctx.redraw()
		end
	end)
	return self
end

function Reports.items(_self: any): { any }
	local product = ReportDays.product()
	return (product and product.reports) or {}
end

function Reports.wants(_self: any, id: string): boolean
	return ReportDays.wants(id)
end

function Reports.detail(self: any, r: any): Layer.Detail
	local body = r.text
	if r.tornadoId then
		body ..= "\n\nIts damage survey is on the Damage layer once the tornado has lifted."
	end
	return { title = r.title, subtitle = r.location, body = body, colour = Palettes.REPORT[r.type], layer = self.key, item = keyOf(r) }
end

function Reports.renderOptions(self: any)
	Ui.clear(self.options)
	ReportDays.picker(self.options)
	local items = self:items()
	local counts = { tornado = 0, hail = 0, wind = 0 }
	for _, r in items do
		counts[r.type] += 1
	end
	local row = Ui.buttons(self.options, 26)
	for _, kind in { "tornado", "hail", "wind" } do
		local button = Ui.button(row, `{NAMES[kind]} {counts[kind]}`, function()
			self.shown[kind] = not self.shown[kind]
			self:renderOptions()
			self.ctx.redraw()
		end)
		Ui.setOn(button, self.shown[kind])
	end
	if #items == 0 then
		Ui.text(self.options, if ReportDays.product() then "No reports this day." else "Loading…", { size = 12, colour = Ui.MUTED })
		return
	end
	local listed = 0
	for k = #items, 1, -1 do
		local r = items[k]
		if self.shown[r.type] then
			Ui.listButton(self.options, `{r.title} · {r.location}`, Ui.rgb(Palettes.REPORT[r.type]), function()
				self.ctx.showDetail(self:detail(r))
			end)
			listed += 1
			if listed >= LIST_MAX then
				Ui.text(self.options, "Older reports: click them on the map.", { size = 12, colour = Ui.MUTED })
				break
			end
		end
	end
end

function Reports.refresh(self: any)
	ReportDays.refresh()
end

function Reports.setEnabled(self: any, on: boolean)
	self.enabled = on
	if on then
		self:renderOptions()
		task.spawn(self.refresh, self)
	end
end

function Reports.draw(self: any, draw: MapCanvas.Draw)
	local chosen = self.ctx.selected(self.key)
	local items = self:items()
	for _, kind in TYPES do
		if self.shown[kind] then
			local colour = Palettes.REPORT[kind]
			for _, r in items do
				if r.type == kind then
					if keyOf(r) == chosen then
						draw.dot(r.x, r.y, 7, WHITE)
					end
					if r.significant then
						draw.dot(r.x, r.y, 5.5, colour)
						draw.dot(r.x, r.y, 3, DARK)
					else
						draw.dot(r.x, r.y, 4.5, DARK)
						draw.dot(r.x, r.y, 3.5, colour)
					end
				end
			end
		end
	end
end

function Reports.labels(_self: any, _labels: MapCanvas.Labels) end

function Reports.hit(self: any, mx: number, my: number, milesPerPixel: number): Layer.Detail?
	local reach = PICK_PIXELS * milesPerPixel
	local best, bestD = nil, reach
	for _, r in self:items() do
		if self.shown[r.type] then
			local d = math.sqrt((r.x - mx) ^ 2 + (r.y - my) ^ 2)
			-- A tornado report wins a tie: it is drawn on top.
			if d < bestD or (d == bestD and r.type == "tornado") then
				best, bestD = r, d
			end
		end
	end
	return if best then self:detail(best) else nil
end

function Reports.legend(_self: any, parent: Instance)
	for _, kind in { "tornado", "hail", "wind" } do
		Ui.legendRow(parent, Ui.rgb(Palettes.REPORT[kind]), NAMES[kind], if kind == "hail" then "ringed: 2 in or more" elseif kind == "wind" then "ringed: 75 mph or more" else "where first seen")
	end
end

return Reports
