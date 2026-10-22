--!strict
-- The day the storm reports and damage layers show, one for both: the days the weather server
-- holds ("reports.days") and the days the place has kept ("reports.archive",
-- server/ReportArchive.luau), newest first, and the chosen day's product ("reports.day.<N>",
-- server/GameProducts.js). Until a day is picked it follows the current day.

local Products = script.Parent.Parent
local ProductClient = require(Products.ProductClient)
local Ui = require(Products.Ui)

local ReportDays = {}

export type Day = { day: number, startHourUtc: number, tornadoes: number, reports: { tornado: number, hail: number, wind: number }, kept: boolean }

local days: { Day } = {}
local currentDay: number? = nil
local chosen: number? = nil -- nil: the current day
local product: any = nil
local listeners: { () -> () } = {}
local refreshing, again = false, false

local function shownDay(): number?
	return chosen or currentDay or (days[1] and days[1].day)
end

local function tell()
	for _, listener in listeners do
		task.spawn(listener)
	end
end

-- Called whenever the days or the chosen day's product change.
function ReportDays.onChanged(listener: () -> ())
	table.insert(listeners, listener)
end

function ReportDays.wants(id: string): boolean
	local day = shownDay()
	return id == "reports.days" or id == "reports.archive" or (day ~= nil and id == `reports.day.{day}`)
end

-- The chosen day's product (nil while it loads, or when there are no days).
function ReportDays.product(): any
	return product
end

function ReportDays.current(): Day?
	local day = shownDay()
	for _, d in days do
		if d.day == day then
			return d
		end
	end
	return nil
end

function ReportDays.isToday(): boolean
	local day = shownDay()
	return day ~= nil and day == currentDay
end

-- Fetches the lists and the chosen day (yields). Calls made while one runs are folded into one more.
function ReportDays.refresh()
	if refreshing then
		again = true
		return
	end
	refreshing = true
	repeat
		again = false
		local live = ProductClient.get("reports.days")
		local kept = ProductClient.get("reports.archive")
		local byDay: { [number]: Day } = {}
		if kept and (not live or kept.world == live.world) then
			for _, d in kept.days or {} do
				byDay[d.day] = { day = d.day, startHourUtc = d.startHourUtc, tornadoes = d.tornadoes, reports = d.reports, kept = true }
			end
		end
		for _, d in (live and live.days) or {} do
			local was = byDay[d.day]
			byDay[d.day] = { day = d.day, startHourUtc = d.startHourUtc, tornadoes = d.tornadoes, reports = d.reports, kept = was ~= nil }
		end
		local list = {}
		for _, d in byDay do
			table.insert(list, d)
		end
		table.sort(list, function(a, b)
			return a.day > b.day
		end)
		days = list
		currentDay = live and live.currentDay
		local day = shownDay()
		product = if day then ProductClient.get(`reports.day.{day}`) else nil
	until not again
	refreshing = false
	tell()
end

-- Steps to an older (+1) or newer (-1) day.
function ReportDays.step(older: number)
	local day = shownDay()
	for k, d in days do
		if d.day == day then
			local pick = days[k + older]
			if pick then
				chosen = if pick.day == currentDay then nil else pick.day
				product = nil
				tell()
				task.spawn(ReportDays.refresh)
			end
			return
		end
	end
end

-- "Day 12 (today) · 3 tornadoes · 4 hail · 20 wind"
function ReportDays.label(): string
	local d = ReportDays.current()
	if not d then
		return if #days == 0 then "No report days yet" else "Loading…"
	end
	local r = d.reports
	return `Day {d.day}{if d.day == currentDay then " (today)" else ""} · {r.tornado} tor · {r.hail} hail · {r.wind} wind`
end

-- The day picker: older and newer, and which day is shown (12Z to 12Z).
function ReportDays.picker(parent: Instance)
	local row = Ui.buttons(parent, 26)
	Ui.button(row, "◀ Older", function()
		ReportDays.step(1)
	end)
	Ui.button(row, "Newer ▶", function()
		ReportDays.step(-1)
	end)
	Ui.text(parent, ReportDays.label(), { size = 13, bold = true })
	local d = ReportDays.current()
	if d then
		Ui.text(parent, `{Ui.clock(d.startHourUtc)} to {Ui.clock(d.startHourUtc + 24)}{if d.kept then " · kept" else ""}`, { size = 12, colour = Ui.MUTED })
	end
end

return ReportDays
