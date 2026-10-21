--!strict
-- The Day 1, 2 or 3 convective outlook (product "outlook.dayN", server/GameProducts.js): the
-- categorical map, or one hazard's chance contours with its intensity groups hatched over them,
-- as the web outlook page draws it. A click inside an area opens what the outlook says there,
-- with the forecast discussion.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Palettes = require(ReplicatedStorage.Shared.Weather.Palettes)
local Products = script.Parent.Parent
local MapCanvas = require(Products.MapCanvas)
local ProductClient = require(Products.ProductClient)
local Ui = require(Products.Ui)
local Geo = require(Products.Geo)
local Layer = require(Products.Layer)

local Outlook = {}
Outlook.__index = Outlook

local HAZARD_NAMES = { category = "Categorical", tornado = "Tornado", wind = "Wind", hail = "Hail", severe = "Severe" }
local HAZARD_WORDS = {
	tornado = "a tornado",
	wind = "damaging wind (58 mph or more)",
	hail = "large hail (1 inch or more)",
	severe = "severe weather",
}
local GROUP_HATCH = { [1] = "dashLeft", [2] = "right", [3] = "cross" }
local GROUP_WORDS = { [1] = "broken hatching", [2] = "hatching", [3] = "cross-hatching" }
local INK = { 8, 8, 8 }
local SELECTED = { 255, 255, 255 }

local function darker(c: { number }, share: number): { number }
	return { c[1] * share, c[2] * share, c[3] * share }
end

type Area = { rings: { { number } }, colour: { number }, label: string, key: string }

function Outlook.new(ctx: Layer.Context, optionsParent: Instance)
	local self = setmetatable({
		key = "outlook",
		name = "Outlook",
		enabled = true,
		options = Ui.section(optionsParent),
		ctx = ctx,
		day = 1,
		hazard = "category",
		product = nil :: any,
	}, Outlook)
	return self
end

function Outlook.wants(self: any, id: string): boolean
	return id == `outlook.day{self.day}`
end

-- The areas of the map shown, lowest first, and the intensity groups (hazard maps).
function Outlook.areas(self: any): ({ Area }, { any })
	local product = self.product
	local areas: { Area } = {}
	if not product or product.status ~= "issued" then
		return areas, {}
	end
	if self.hazard == "category" then
		for _, entry in product.category do
			local colour = Palettes.CATEGORY[entry.key]
			if colour then
				table.insert(areas, { rings = entry.rings, colour = colour, label = Palettes.CATEGORY_SHORT[entry.key] or entry.key, key = entry.key })
			end
		end
		return areas, {}
	end
	local hazard = product.hazards[self.hazard]
	if not hazard then
		return areas, {}
	end
	local colours = Palettes.CHANCE[self.hazard] or {}
	for _, entry in hazard.levels do
		table.insert(areas, { rings = entry.rings, colour = colours[entry.level] or { 200, 200, 200 }, label = `{entry.level}%`, key = tostring(entry.level) })
	end
	return areas, hazard.groups
end

function Outlook.renderOptions(self: any)
	Ui.clear(self.options)
	local product = self.product
	local days = Ui.buttons(self.options, 28)
	for day = 1, 3 do
		Ui.setOn(Ui.button(days, `Day {day}`, function()
			self.day = day
			task.spawn(self.refresh, self)
		end), day == self.day)
	end
	local offered = { "category" }
	if product and product.status == "issued" then
		for _, hazard in product.hazardOrder do
			table.insert(offered, hazard)
		end
	end
	if not table.find(offered, self.hazard) then
		self.hazard = "category"
	end
	local hazards = Ui.buttons(self.options, 28)
	for _, key in offered do
		Ui.setOn(Ui.button(hazards, HAZARD_NAMES[key] or key, function()
			self.hazard = key
			self:renderOptions()
			self.ctx.redraw()
		end), key == self.hazard)
	end
	if not product then
		Ui.text(self.options, "Loading the outlook…", { size = 13, colour = Ui.MUTED })
	elseif product.status ~= "issued" then
		Ui.text(self.options, if product.status == "running" then `The Day {self.day} outlook is being prepared…` elseif product.status == "off" then "Outlooks are turned off on the weather server." else "Waiting for the first outlook…", { size = 13, colour = Ui.MUTED })
	else
		local headline = Ui.text(self.options, `Day {self.day}: {product.headline}`, { size = 16, bold = true })
		local top = Palettes.CATEGORY[product.highest]
		if top then
			headline.TextColor3 = Ui.rgb(top)
		end
		Ui.text(self.options, `Issued {Geo.clock(product.issuedHourUtc)} · valid {Geo.clock(product.validFromHourUtc)} to {Geo.clock(product.validToHourUtc)}. Click an area for the details.`, { size = 12, colour = Ui.MUTED })
	end
end

function Outlook.refresh(self: any)
	self.product = ProductClient.get(`outlook.day{self.day}`)
	self:renderOptions()
	self.ctx.redraw()
end

function Outlook.setEnabled(self: any, on: boolean)
	self.enabled = on
	if on then
		task.spawn(self.refresh, self)
	end
end

function Outlook.draw(self: any, draw: MapCanvas.Draw)
	local areas, groups = self:areas()
	-- Fainter under the radar, so the echoes read.
	local alpha = if self.ctx.isOn("radar") then 0.45 else 0.78
	for _, area in areas do
		draw.fill(area.rings, area.colour, alpha)
		draw.stroke(area.rings, 1.6, darker(area.colour, 0.45))
	end
	-- Each intensity group is hatched only where the next group up does not cover it.
	for k, entry in groups do
		local rings = table.clone(entry.rings)
		local above = groups[k + 1]
		if above then
			table.move(above.rings, 1, #above.rings, #rings + 1, rings)
		end
		draw.hatch(rings, GROUP_HATCH[entry.group] or "cross", INK)
	end
	for _, entry in groups do
		draw.stroke(entry.rings, 2, INK)
	end
	local chosen = self.ctx.selected(self.key)
	for _, area in areas do
		if area.key == chosen then
			draw.stroke(area.rings, 3, SELECTED)
		end
	end
end

function Outlook.labels(self: any, labels: MapCanvas.Labels)
	local areas = self:areas()
	for _, area in areas do
		labels.onRing(area.label, area.rings, area.colour)
	end
end

function Outlook.hit(self: any, mx: number, my: number, _milesPerPixel: number): Layer.Detail?
	local product = self.product
	if not product or product.status ~= "issued" then
		return nil
	end
	local areas, groups = self:areas()
	-- The highest area there (they nest).
	for k = #areas, 1, -1 do
		local area = areas[k]
		if Geo.inside(area.rings, mx, my) then
			local what
			if self.hazard == "category" then
				what = product.labels[area.key] or area.label
			else
				local group = 0
				for _, entry in groups do
					if Geo.inside(entry.rings, mx, my) then
						group = math.max(group, entry.group)
					end
				end
				local meaning = if group > 0 then ` · CIG{group}: {product.hazards[self.hazard].cigMeaning[group + 1] or ""}` else ""
				what = `{area.label} chance of {HAZARD_WORDS[self.hazard] or self.hazard} within {product.radiusMiles} miles{meaning}`
			end
			return {
				title = `Day {self.day} outlook: {what}`,
				subtitle = `Issued {Geo.clock(product.issuedHourUtc)} · valid {Geo.clock(product.validFromHourUtc)} to {Geo.clock(product.validToHourUtc)}`,
				body = product.discussion or "",
				colour = area.colour,
				layer = self.key,
				item = area.key,
			}
		end
	end
	return nil
end

function Outlook.legend(self: any, parent: Instance)
	local product = self.product
	if not product or product.status ~= "issued" then
		return
	end
	Ui.text(parent, `Outlook ({HAZARD_NAMES[self.hazard]})`, { size = 12, bold = true, colour = Ui.MUTED })
	if self.hazard == "category" then
		local k = 0
		for _, name in product.categories do
			local colour = Palettes.CATEGORY[name]
			if colour then
				Ui.legendRow(parent, Ui.rgb(colour), if name == "TSTM" then "TSTM" else `{k} - {Palettes.CATEGORY_SHORT[name] or name}`, product.labels[name] or "")
				k += 1
			end
		end
	else
		local hazard = product.hazards[self.hazard]
		local colours = Palettes.CHANCE[self.hazard] or {}
		for _, level in hazard.contourLevels do
			local colour = colours[level]
			Ui.legendRow(parent, if colour then Ui.rgb(colour) else nil, `{level}%`, "")
		end
		for group = 1, hazard.maxCig do
			Ui.legendRow(parent, nil, `CIG{group} ({GROUP_WORDS[group] or "hatching"})`, hazard.cigMeaning[group + 1] or "")
		end
	end
end

return Outlook
