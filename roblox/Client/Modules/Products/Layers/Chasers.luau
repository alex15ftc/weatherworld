--!strict
-- The chaser network: every player in this server marked on the map with their display name
-- (yours red, ringed gold), wherever they are (ChaserNetService sends the places of those whose
-- characters are not streamed in), and a trail of where each has been over about the last world
-- day, fading and thinning with age. The trails are drawn as marks (their own image of the view,
-- drawn again only when a trail gets a point); the dots are the map's player markers, moved
-- every frame. The side panel lists the chasers, nearest first; a click on one centres the map on
-- them, a click on a dot opens where they are.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage.Shared.World.Config)

local Products = script.Parent.Parent
local MapCanvas = require(Products.MapCanvas)
local ChaserClient = require(Products.ChaserClient)
local Ui = require(Products.Ui)
local Layer = require(Products.Layer)

local Chasers = {}
Chasers.__index = Chasers

local MINE, OTHERS = { 230, 50, 50 }, { 60, 140, 255 }
local FADED = { 30, 34, 42 } -- what an old trail fades to (about the muted map's colour)
local FADE = 0.8 -- the oldest point's share of the way to FADED
local NEW_WIDTH, OLD_WIDTH = 2.6, 1 -- screen pixels
local PICK_PIXELS = 10

local player = Players.LocalPlayer
local MILE = Config.STUDS_PER_MILE
local HALF = Config.MAP_MILES / 2

function Chasers.new(ctx: Layer.Context, optionsParent: Instance)
	local self = setmetatable({
		key = "chasers",
		name = "Chasers",
		enabled = false,
		options = Ui.section(optionsParent),
		ctx = ctx,
	}, Chasers)
	ChaserClient.onChanged(function()
		if self.enabled and ctx.isOpen() then
			self:renderOptions()
			ctx.redraw()
		end
	end)
	local function roster()
		if self.enabled and ctx.isOpen() then
			self:renderOptions()
		end
	end
	Players.PlayerAdded:Connect(roster)
	Players.PlayerRemoving:Connect(function()
		task.defer(roster) -- (once the player is out of the list)
	end)
	return self
end

-- A player's map point: their character's if it is streamed in (as the map marks it), else where
-- the server last said.
local function whereIs(p: Player): (number?, number?)
	local character = p.Character
	local root = if character then character:FindFirstChild("HumanoidRootPart") :: BasePart? else nil
	if root then
		return root.Position.X / MILE + HALF, root.Position.Z / MILE + HALF
	end
	local x, y = ChaserClient.position(p)
	return x, y
end

function Chasers.wants(_self: any, _id: string): boolean
	return false -- (not a weather product: ChaserClient says when it changes)
end

function Chasers.refresh(_self: any) end

function Chasers.setEnabled(self: any, on: boolean)
	self.enabled = on
	MapCanvas.setMarkerSource(if on then { position = ChaserClient.position, names = true } else nil)
	if on then
		self:renderOptions()
	end
end

function Chasers.renderOptions(self: any)
	Ui.clear(self.options)
	local mx, my = MapCanvas.playerMiles()
	local list = {}
	for _, p in Players:GetPlayers() do
		local x, y = whereIs(p)
		local d = if x and y and mx and my then math.sqrt((x - mx) ^ 2 + (y - my) ^ 2) else math.huge
		table.insert(list, { p = p, x = x, y = y, d = if p == player then -1 else d })
	end
	table.sort(list, function(a, b)
		return a.d < b.d
	end)
	Ui.text(self.options, `{#list} chaser{if #list == 1 then "" else "s"} in this server`, { size = 12, colour = Ui.MUTED })
	for _, entry in list do
		local p: Player = entry.p
		local text = if p == player
			then `{p.DisplayName} (you)`
			elseif entry.d < math.huge then string.format("%s · %.1f mi", p.DisplayName, entry.d)
			else `{p.DisplayName} · locating…`
		Ui.listButton(self.options, text, Ui.rgb(if p == player then MINE else OTHERS), function()
			local x, y = whereIs(p)
			if x and y then
				MapCanvas.centreOn(x, y)
			end
		end)
	end
end

-- No product tiles.
function Chasers.draw(_self: any, _draw: MapCanvas.Draw) end

function Chasers.shapeKey(_self: any): string
	return ""
end

-- The trails, oldest first, each stretch's segments fading and thinning with the age of their
-- newer end; yours over the others'.
function Chasers.drawMarks(_self: any, draw: MapCanvas.Draw)
	local now = ChaserClient.now()
	local keep = ChaserClient.keepSeconds()
	local order = Players:GetPlayers()
	table.sort(order, function(a, b)
		return a ~= player and b == player
	end)
	for _, p in order do
		local colour = if p == player then MINE else OTHERS
		local trail = ChaserClient.trail(p)
		for k = 2, #trail do
			local a, b = trail[k - 1], trail[k]
			if not b.newStretch then
				local age = math.clamp((now - b.t) / keep, 0, 1)
				local f = age * FADE
				local c = {
					colour[1] + (FADED[1] - colour[1]) * f,
					colour[2] + (FADED[2] - colour[2]) * f,
					colour[3] + (FADED[3] - colour[3]) * f,
				}
				draw.line(a.x, a.y, b.x, b.y, NEW_WIDTH + (OLD_WIDTH - NEW_WIDTH) * age, c)
			end
		end
	end
end

-- Drawn again when a trail changes (ChaserClient's version), and every few minutes as they fade.
function Chasers.marksKey(_self: any): string?
	return `{ChaserClient.version()}|{math.floor(ChaserClient.now() / 300)}`
end

function Chasers.labels(_self: any, _labels: MapCanvas.Labels) end

function Chasers.hit(self: any, mx: number, my: number, milesPerPixel: number): Layer.Detail?
	local reach = PICK_PIXELS * milesPerPixel
	local best, bestD = nil, reach
	for _, p in Players:GetPlayers() do
		local x, y = whereIs(p)
		if x and y then
			local d = math.sqrt((x - mx) ^ 2 + (y - my) ^ 2)
			if d < bestD then
				best, bestD = p, d
			end
		end
	end
	if not best then
		return nil
	end
	local p: Player = best
	local x, y = whereIs(p)
	local lines = { string.format("At %.1f mi east, %.1f mi south.", x or 0, y or 0) }
	local myX, myY = MapCanvas.playerMiles()
	if p ~= player and x and y and myX and myY then
		table.insert(lines, string.format("%.1f mi from you.", math.sqrt((x - myX) ^ 2 + (y - myY) ^ 2)))
	end
	local trail = ChaserClient.trail(p)
	if #trail > 1 then
		local miles = 0
		for k = 2, #trail do
			if not trail[k].newStretch then
				miles += math.sqrt((trail[k].x - trail[k - 1].x) ^ 2 + (trail[k].y - trail[k - 1].y) ^ 2)
			end
		end
		local minutes = (trail[#trail].t - trail[1].t) / 60
		table.insert(lines, string.format("Trail: %.1f mi over the last %.0f minutes.", miles, minutes))
	end
	return {
		title = if p == player then `{p.DisplayName} (you)` else p.DisplayName,
		subtitle = "Chaser in this server",
		body = table.concat(lines, "\n"),
		colour = if p == player then MINE else OTHERS,
		layer = self.key,
		item = tostring(p.UserId),
	}
end

function Chasers.legendKey(_self: any): string
	return ""
end

function Chasers.legend(_self: any, parent: Instance)
	Ui.legendRow(parent, Ui.rgb(MINE), "You", "your trail in red")
	Ui.legendRow(parent, Ui.rgb(OTHERS), "Other chasers", "in this server")
	Ui.legendRow(parent, Ui.rgb(FADED), "Trail", "the last world day, fading with age")
end

return Chasers
