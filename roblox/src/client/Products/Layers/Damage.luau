--!strict
-- The damage surveys of one day, after the National Weather Service's Damage Assessment Toolkit
-- (server/GameProducts.js): each lifted tornado's track in its rating's colour, as wide as its
-- path once zoomed in far enough; a click on a track (or in the list) opens its survey
-- ("survey.<id>"), drawn as the EF contours of its swath and, close in, its damage points, each
-- of which opens what was hit and the wind it took. The day is the one the reports layer shows
-- (ReportDays). A tornado still on the ground is surveyed once it lifts.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Palettes = require(ReplicatedStorage.Shared.Weather.Palettes)
local Products = script.Parent.Parent
local MapCanvas = require(Products.MapCanvas)
local ProductClient = require(Products.ProductClient)
local Ui = require(Products.Ui)
local Geo = require(Products.Geo)
local Layer = require(Products.Layer)
local ReportDays = require(script.Parent.ReportDays)

local Damage = {}
Damage.__index = Damage

local WHITE, DARK = { 255, 255, 255 }, { 11, 17, 25 }
local PICK_PIXELS = 7
local POINTS_MILES_PER_PIXEL = 0.06 -- damage points are drawn (and clicked) closer in than this
local CONTOUR_ALPHA = 0.35
local YARDS_PER_MILE = 1760

local function colourOf(ef: number): { number }
	return if ef >= 0 then Palettes.EF[ef + 1] else Palettes.EFU
end

function Damage.new(ctx: Layer.Context, optionsParent: Instance)
	local self = setmetatable({
		key = "damage",
		name = "Damage",
		enabled = false,
		options = Ui.section(optionsParent),
		ctx = ctx,
		surveys = {} :: { [string]: any }, -- tornado id -> survey product
		loading = {} :: { [string]: boolean },
		indicators = nil :: any,
	}, Damage)
	ReportDays.onChanged(function()
		if self.enabled then
			self:renderOptions()
			ctx.redraw()
		end
	end)
	return self
end

function Damage.items(_self: any): { any }
	local product = ReportDays.product()
	return (product and product.tornadoes) or {}
end

function Damage.wants(_self: any, id: string): boolean
	return ReportDays.wants(id)
end

-- The tornado whose survey is open ("" when none): a point's item is "<tornado id>#<point>".
function Damage.chosen(self: any): string
	local item = self.ctx.selected(self.key)
	return string.match(item, "^([^#]*)") or ""
end

function Damage.tornadoDetail(self: any, t: any): Layer.Detail
	local survey = self.surveys[t.id]
	return {
		title = t.title,
		subtitle = `{Geo.clock(t.startHourUtc)} · {t.startPlace or ""}`,
		body = if survey then survey.text else "Loading the survey…",
		colour = colourOf(t.ef),
		layer = self.key,
		item = t.id,
	}
end

-- Opens a tornado's survey: its summary now, its shapes when they have come.
function Damage.open(self: any, t: any)
	self.ctx.showDetail(self:tornadoDetail(t))
	if self.surveys[t.id] or self.loading[t.id] then
		return
	end
	self.loading[t.id] = true
	task.spawn(function()
		local survey = ProductClient.get(`survey.{t.id}`)
		self.loading[t.id] = nil
		if not survey then
			return
		end
		self.surveys[t.id] = survey
		if self:chosen() == t.id then
			self.ctx.showDetail(self:tornadoDetail(t))
		end
	end)
end

function Damage.pointDetail(self: any, t: any, k: number, p: { any }): Layer.Detail
	local x, y, di, dod, mph, ef, hour = p[1], p[2], p[3], p[4], p[5], p[6], p[7]
	local indicator = self.indicators and self.indicators.indicators[di]
	local degree = indicator and indicator.dods[dod]
	local lines = {
		if indicator then `{indicator.name} (DI {indicator.number}, {di})` else di,
		"",
		if degree then `Damage:          DOD {dod}: {degree[1]}` else `Damage:          DOD {dod}`,
	}
	if degree then
		table.insert(lines, `Expected wind:   {degree[2]} mph (bounds {degree[3]}-{degree[4]})`)
	end
	table.insert(lines, `Estimated wind:  {mph} mph`)
	table.insert(lines, `Rating:          EF{ef}`)
	table.insert(lines, `Time:            {Geo.clock(hour)}`)
	table.insert(lines, string.format("Location:        %.2f mi E, %.2f mi S", x, y))
	table.insert(lines, "")
	table.insert(lines, `Part of the survey of the {t.title}.`)
	return { title = `EF{ef} damage point`, subtitle = t.title, body = table.concat(lines, "\n"), colour = colourOf(ef), layer = self.key, item = `{t.id}#{k}` }
end

function Damage.renderOptions(self: any)
	Ui.clear(self.options)
	ReportDays.picker(self.options)
	local product = ReportDays.product()
	local items = self:items()
	if not product then
		Ui.text(self.options, "Loading…", { size = 12, colour = Ui.MUTED })
		return
	end
	local best = -2
	for _, t in items do
		best = math.max(best, t.ef)
	end
	local status = if #items == 0 then "No tornadoes surveyed this day." else `{#items} tornado{if #items == 1 then "" else "es"} surveyed; strongest {if best >= 0 then `EF{best}` else "EFU"}`
	Ui.text(self.options, status, { size = 12, colour = Ui.MUTED })
	if (product.ongoing or 0) > 0 then
		Ui.text(self.options, `{product.ongoing} still on the ground: surveyed when {if product.ongoing == 1 then "it lifts" else "they lift"}.`, { size = 12, colour = Ui.MUTED })
	end
	for _, t in items do
		Ui.listButton(self.options, `{t.rating} · {Geo.clock(t.startHourUtc)} · {string.format("%.1f", t.lengthMi)} mi · {t.startPlace or ""}`, Ui.rgb(colourOf(t.ef)), function()
			self:open(t)
		end)
	end
end

function Damage.refresh(self: any)
	if not self.indicators then
		self.indicators = ProductClient.get("survey.indicators")
	end
	ReportDays.refresh()
end

function Damage.setEnabled(self: any, on: boolean)
	self.enabled = on
	if on then
		self:renderOptions()
		task.spawn(self.refresh, self)
	end
end

function Damage.draw(self: any, draw: MapCanvas.Draw)
	local mpp = MapCanvas.milesPerPixel()
	local chosen = self:chosen()
	local open: any = nil
	for _, t in self:items() do
		if t.id == chosen then
			open = t
		end
		local colour = colourOf(t.ef)
		-- As wide as its path when that shows; otherwise wider for a stronger tornado.
		local width = math.max(2 + math.max(t.ef, 0) * 0.8, t.maxWidthYards / YARDS_PER_MILE / mpp)
		if t.id == chosen then
			draw.polyline(t.track, width + 3, WHITE)
		end
		if #t.track == 2 then
			draw.dot(t.track[1], t.track[2], width / 2 + 1, colour) -- a touchdown too short to draw
		else
			draw.polyline(t.track, width, colour)
		end
	end
	local survey = open and self.surveys[open.id]
	if not survey then
		return
	end
	for _, contour in survey.contours do
		local colour = colourOf(contour.ef)
		draw.fill(contour.rings, colour, CONTOUR_ALPHA)
		draw.stroke(contour.rings, 1.2, colour)
	end
	draw.polyline(survey.track, 1.5, WHITE)
	if mpp < POINTS_MILES_PER_PIXEL then
		local item = self.ctx.selected(self.key)
		for k, p in survey.points do
			if item == `{open.id}#{k}` then
				draw.dot(p[1], p[2], 6, WHITE)
			end
			draw.dot(p[1], p[2], 3.5, DARK)
			draw.dot(p[1], p[2], 2.5, colourOf(p[6]))
		end
	end
end

function Damage.labels(self: any, labels: MapCanvas.Labels)
	for _, t in self:items() do
		if #t.track >= 2 then
			labels.at(t.rating, t.track[1], t.track[2], colourOf(t.ef))
		end
	end
end

function Damage.hit(self: any, mx: number, my: number, milesPerPixel: number): Layer.Detail?
	local reach = PICK_PIXELS * milesPerPixel
	-- A damage point of the open survey, close in.
	local chosen = self:chosen()
	if milesPerPixel < POINTS_MILES_PER_PIXEL then
		for _, t in self:items() do
			local survey = self.surveys[t.id]
			if t.id == chosen and survey then
				local best, bestD = nil, reach
				for k, p in survey.points do
					local d = math.sqrt((p[1] - mx) ^ 2 + (p[2] - my) ^ 2)
					if d < bestD then
						best, bestD = k, d
					end
				end
				if best then
					return self:pointDetail(t, best, survey.points[best])
				end
			end
		end
	end
	-- A track (the nearest within reach, or within its path).
	local best, bestD = nil, math.huge
	for _, t in self:items() do
		local d = Geo.lineDistance(t.track, mx, my)
		if d <= math.max(reach, t.maxWidthYards / YARDS_PER_MILE / 2) and d < bestD then
			best, bestD = t, d
		end
	end
	if best then
		-- Its survey is fetched; the details open now and fill in when it comes.
		task.defer(function()
			self:open(best)
		end)
		return self:tornadoDetail(best)
	end
	return nil
end

function Damage.legend(_self: any, parent: Instance)
	local meaning = { "65-85 mph", "86-110 mph", "111-135 mph", "136-165 mph", "166-200 mph", "over 200 mph" }
	for ef = 0, 5 do
		Ui.legendRow(parent, Ui.rgb(Palettes.EF[ef + 1]), `EF{ef}`, meaning[ef + 1])
	end
	Ui.legendRow(parent, Ui.rgb(Palettes.EFU), "EFU", "nothing rated was hit")
end

return Damage
