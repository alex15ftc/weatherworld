--!strict
-- The world map, opened and closed with M. The part of the map in view is drawn afresh, at the
-- screen's own resolution, whenever it is zoomed or panned, from the map's data
-- (ReplicatedStorage Shared.MapData.MapVector): land cover with hill-shading, the section-line
-- roads once zoomed in, rivers and main roads as lines, and labels for cities, towns (more of them
-- the closer in), rivers and highways. Every player is marked. Scroll to zoom about the cursor,
-- drag to pan, C to centre on yourself.

local Players = game:GetService("Players")
local UserInputService = game:GetService("UserInputService")
local RunService = game:GetService("RunService")
local AssetService = game:GetService("AssetService")
local EncodingService = game:GetService("EncodingService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage.Shared.World.Config)
local Interchanges = require(ReplicatedStorage.Shared.World.Interchanges)

local MapView = {}

local player = Players.LocalPlayer
local MILE = Config.STUDS_PER_MILE
local HALF = Config.MAP_MILES / 2
local MAX_RES = 1024
local MIN_MPP = 0.01 -- miles per pixel when fully zoomed in (10 studs a pixel)

local COVER_COLOURS: { [string]: { number } } = {
	water = { 70, 120, 190 }, cropland = { 196, 178, 112 }, irrigated = { 118, 160, 70 }, grassland = { 168, 172, 112 },
	sandhillGrass = { 190, 180, 128 }, forest = { 62, 102, 58 }, riparian = { 86, 124, 70 }, breaks = { 160, 132, 104 },
	redRange = { 176, 120, 88 }, tallgrass = { 130, 150, 90 }, urban = { 128, 124, 130 }, suburban = { 176, 170, 164 },
}
local ROAD_STYLE = {
	interstate = { colour = { 205, 40, 50 }, width = 2.4 },
	expressway = { colour = { 235, 120, 40 }, width = 2 },
	highway = { colour = { 250, 196, 60 }, width = 1.5 },
}
local RIVER = { 58, 104, 170 }
local SECTION_COLOURS = { [1] = { 150, 120, 88 }, [2] = { 214, 204, 178 }, [3] = { 244, 244, 240 } }

-- Map data ----------------------------------------------------------------------------------

local data: any = nil
local land: buffer
local cells, cellMiles = 0, 0.5
local coverRGB: { { number } } = {}
local sections: buffer
local sectionSize = 0

local function unpack(text: string): buffer
	local raw = EncodingService:Base64Decode(buffer.fromstring(text))
	return EncodingService:DecompressBuffer(raw, Enum.CompressionAlgorithm.Zstd)
end

-- Interchange ramps as polylines in map miles (from the same geometry the world is built with).
local rampLines: { { number } } = {}

local function loadData()
	data = require(ReplicatedStorage.Shared:WaitForChild("MapData"):WaitForChild("MapVector")) :: any
	for _, c in data.crossings or {} do
		if c.type == "interchange" then
			local rec = {
				interchange = true, road = 0, x = (c.x - HALF) * MILE, z = (c.y - HALF) * MILE,
				ux = c.ux, uz = c.uy, vx = c.vx, vz = c.vy, exit = c.exit, uEnd = c.uEnd or 0, vEnd = c.vEnd or 0,
			}
			for _, ramp in Interchanges.ramps(rec :: any) do
				local line = {}
				for _, p in ramp.points do
					table.insert(line, p.X / MILE + HALF)
					table.insert(line, p.Y / MILE + HALF)
				end
				table.insert(rampLines, line)
			end
		end
	end
	land = unpack(data.land)
	sections = unpack(data.sections)
	cells = data.cells
	cellMiles = data.miles / cells
	sectionSize = data.sectionSize
	for i, key in data.cover do
		coverRGB[i - 1] = COVER_COLOURS[key] or { 255, 0, 255 }
	end
end

-- View --------------------------------------------------------------------------------------

local gui: ScreenGui? = nil
local viewport: Frame
local image: ImageLabel
local labelLayer: Frame
local readout: TextLabel
local editable: any = nil
local editableSize = Vector2.zero
local markers: { [Player]: Frame } = {}
local labels: { TextLabel } = {}

local centreX, centreY = HALF, HALF -- map miles at the middle of the view
local mpp = 1 -- map miles per screen pixel
local dirty, quickPending = true, false
local lastChange = 0

local function viewSize(): Vector2
	return viewport.AbsoluteSize
end

local function fullMpp(): number
	local size = viewSize()
	return data.miles / math.max(1, math.min(size.X, size.Y))
end

local function clampView()
	mpp = math.clamp(mpp, MIN_MPP, fullMpp())
	local size = viewSize()
	local hx, hy = size.X * mpp / 2, size.Y * mpp / 2
	centreX = if hx * 2 >= data.miles then data.miles / 2 else math.clamp(centreX, hx, data.miles - hx)
	centreY = if hy * 2 >= data.miles then data.miles / 2 else math.clamp(centreY, hy, data.miles - hy)
end

-- Screen pixel (within the viewport) of a map point.
local function toScreen(mx: number, my: number): (number, number)
	local size = viewSize()
	return (mx - centreX) / mpp + size.X / 2, (my - centreY) / mpp + size.Y / 2
end

-- Rasterising ---------------------------------------------------------------------------------

local pixels: buffer
local pw, ph = 0, 0

local function stamp(x: number, y: number, r: number, c: { number })
	local x0, x1 = math.max(0, math.floor(x - r)), math.min(pw - 1, math.floor(x + r))
	local y0, y1 = math.max(0, math.floor(y - r)), math.min(ph - 1, math.floor(y + r))
	for py = y0, y1 do
		local row = py * pw
		for px = x0, x1 do
			local o = (row + px) * 4
			buffer.writeu8(pixels, o, c[1])
			buffer.writeu8(pixels, o + 1, c[2])
			buffer.writeu8(pixels, o + 2, c[3])
		end
	end
end

-- A line between map points, width in pixels, in image pixels (scale: image pixels per screen pixel).
local function line(ax: number, ay: number, bx: number, by: number, width: number, c: { number }, scale: number)
	local sx0, sy0 = toScreen(ax, ay)
	local sx1, sy1 = toScreen(bx, by)
	sx0, sy0, sx1, sy1 = sx0 * scale, sy0 * scale, sx1 * scale, sy1 * scale
	if math.max(sx0, sx1) < -4 or math.min(sx0, sx1) > pw + 4 or math.max(sy0, sy1) < -4 or math.min(sy0, sy1) > ph + 4 then
		return
	end
	local length = math.sqrt((sx1 - sx0) ^ 2 + (sy1 - sy0) ^ 2)
	local steps = math.max(1, math.ceil(length / 0.8))
	local r = math.max(0, width * scale / 2 - 0.5)
	for i = 0, steps do
		local t = i / steps
		stamp(sx0 + (sx1 - sx0) * t, sy0 + (sy1 - sy0) * t, r, c)
	end
end

local function polyline(points: { number }, width: number, c: { number }, scale: number)
	for i = 3, #points, 2 do
		line(points[i - 2], points[i - 1], points[i], points[i + 1], width, c, scale)
	end
end

local function render(scale: number)
	local size = viewSize()
	pw, ph = math.max(1, math.floor(size.X * scale)), math.max(1, math.floor(size.Y * scale))
	pixels = buffer.create(pw * ph * 4)
	local step = mpp / scale
	local left, top = centreX - size.X * mpp / 2, centreY - size.Y * mpp / 2
	local n = cells
	-- Land: cover colour times hill-shade, blended between cells once zoomed in past them.
	local NN = n * n
	local function cellColour(i: number, j: number): (number, number, number)
		i, j = math.clamp(i, 0, n - 1), math.clamp(j, 0, n - 1)
		local k = j * n + i
		local c = coverRGB[buffer.readu8(land, k)]
		local f = buffer.readu8(land, NN + k) / 200
		return c[1] * f, c[2] * f, c[3] * f
	end
	local smooth = step < cellMiles * 0.7
	for py = 0, ph - 1 do
		local my = top + (py + 0.5) * step
		local row = py * pw
		if my < 0 or my >= data.miles then
			for px = 0, pw - 1 do
				buffer.writeu32(pixels, (row + px) * 4, 0xFF1E1A18)
			end
		elseif smooth then
			local gy = my / cellMiles - 0.5
			local j0 = math.floor(gy)
			local fy = gy - j0
			for px = 0, pw - 1 do
				local mx = left + (px + 0.5) * step
				local o = (row + px) * 4
				if mx < 0 or mx >= data.miles then
					buffer.writeu32(pixels, o, 0xFF1E1A18)
				else
					local gx = mx / cellMiles - 0.5
					local i0 = math.floor(gx)
					local fx = gx - i0
					local r1, g1, b1 = cellColour(i0, j0)
					local r2, g2, b2 = cellColour(i0 + 1, j0)
					local r3, g3, b3 = cellColour(i0, j0 + 1)
					local r4, g4, b4 = cellColour(i0 + 1, j0 + 1)
					local w1, w2, w3, w4 = (1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy
					buffer.writeu8(pixels, o, math.min(255, r1 * w1 + r2 * w2 + r3 * w3 + r4 * w4))
					buffer.writeu8(pixels, o + 1, math.min(255, g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4))
					buffer.writeu8(pixels, o + 2, math.min(255, b1 * w1 + b2 * w2 + b3 * w3 + b4 * w4))
					buffer.writeu8(pixels, o + 3, 255)
				end
			end
		else
			local j = math.floor(my / cellMiles)
			for px = 0, pw - 1 do
				local mx = left + (px + 0.5) * step
				local o = (row + px) * 4
				if mx < 0 or mx >= data.miles then
					buffer.writeu32(pixels, o, 0xFF1E1A18)
				else
					local r, g, bl = cellColour(math.floor(mx / cellMiles), j)
					buffer.writeu8(pixels, o, math.min(255, r))
					buffer.writeu8(pixels, o + 1, math.min(255, g))
					buffer.writeu8(pixels, o + 2, math.min(255, bl))
					buffer.writeu8(pixels, o + 3, 255)
				end
			end
		end
	end
	-- Section-line roads once zoomed in (paved from 12 pixels a mile, all from 40).
	if mpp < 1 / 12 then
		local minClass = if mpp < 1 / 40 then 1 else 3
		local I0, I1 = math.max(0, math.floor(left)), math.min(sectionSize - 1, math.ceil(left + size.X * mpp))
		local J0, J1 = math.max(0, math.floor(top)), math.min(sectionSize - 1, math.ceil(top + size.Y * mpp))
		for J = J0, J1 do
			for I = I0, I1 do
				local v = buffer.readu8(sections, J * sectionSize + I)
				local east, south = v % 4, (v // 4) % 4
				if east >= minClass then
					line(I, J, I + 1, J, if east == 3 then 1.5 else 1, SECTION_COLOURS[east], scale)
				end
				if south >= minClass then
					line(I, J, I, J + 1, if south == 3 then 1.5 else 1, SECTION_COLOURS[south], scale)
				end
			end
		end
	end
	-- Rivers (wider ones wider), then the main roads.
	for _, river in data.rivers do
		local studs = math.clamp(river.width * 0.18, 12, 220)
		polyline(river.points, math.max(1, studs / MILE / mpp), RIVER, scale)
	end
	-- Interchange ramps once zoomed in.
	if mpp < 0.15 then
		for _, line in rampLines do
			polyline(line, math.max(1, 22 / MILE / mpp), { 235, 150, 90 }, scale)
		end
	end
	for _, kind in { "highway", "expressway", "interstate" } do
		local style = ROAD_STYLE[kind]
		local width = style.width * math.clamp(0.25 / mpp, 1, 3)
		for _, road in data.roads do
			if road.kind == kind then
				polyline(road.points, width, style.colour, scale)
			end
		end
	end
	if not editable or editableSize ~= Vector2.new(pw, ph) then
		if editable then
			editable:Destroy()
		end
		editable = (AssetService :: any):CreateEditableImage({ Size = Vector2.new(pw, ph) })
		editableSize = Vector2.new(pw, ph)
		image.ImageContent = Content.fromObject(editable)
	end
	editable:WritePixelsBuffer(Vector2.zero, Vector2.new(pw, ph), pixels)
end

-- Labels --------------------------------------------------------------------------------------

local function placeLabels()
	for _, l in labels do
		l.Visible = false
	end
	local used = 0
	local taken: { { number } } = {}
	local size = viewSize()
	local function free(x: number, y: number, w: number, h: number): boolean
		if x < 0 or y < 0 or x + w > size.X or y + h > size.Y then
			return false
		end
		for _, r in taken do
			if x < r[1] + r[3] and x + w > r[1] and y < r[2] + r[4] and y + h > r[2] then
				return false
			end
		end
		return true
	end
	local function label(text: string, x: number, y: number, textSize: number, colour: Color3, bold: boolean, rotation: number?): boolean
		local w, h = #text * textSize * 0.55 + 6, textSize + 4
		local lx, ly = x + 5, y - h / 2
		if rotation then
			lx, ly = x - w / 2, y - h / 2
		end
		if not free(lx, ly, w, h) then
			return false
		end
		table.insert(taken, { lx, ly, w, h })
		used += 1
		local l = labels[used]
		if not l then
			local made = Instance.new("TextLabel")
			made.BackgroundTransparency = 1
			made.TextStrokeTransparency = 0.3
			made.TextXAlignment = Enum.TextXAlignment.Left
			made.ZIndex = 3
			made.Parent = labelLayer
			labels[used] = made
			l = made
		end
		l.Visible = true
		l.Text = text
		l.TextSize = textSize
		l.Font = if bold then Enum.Font.GothamBold else Enum.Font.Gotham
		l.TextColor3 = colour
		l.Size = UDim2.fromOffset(w, h)
		l.Position = UDim2.fromOffset(lx, ly)
		l.Rotation = rotation or 0
		l.TextXAlignment = if rotation then Enum.TextXAlignment.Center else Enum.TextXAlignment.Left
		return true
	end
	-- Places by importance; smaller ones only as the view closes in.
	local towns = {}
	for _, s in data.settlements do
		local x, y = toScreen(s.x, s.y)
		if x > -50 and y > -20 and x < size.X + 50 and y < size.Y + 20 then
			local rank = if s.kind == "metro" then 0 elseif s.kind == "city" then 1 elseif s.kind == "smallCity" then 2 else 3
			local show = rank <= 1 or (rank == 2 and mpp < 1.4) or (rank == 3 and ((s.population > 2500 and mpp < 0.45) or (s.population > 800 and mpp < 0.2) or mpp < 0.08))
			if show then
				table.insert(towns, { s = s, x = x, y = y, rank = rank })
			end
		end
	end
	table.sort(towns, function(a, b)
		return if a.rank ~= b.rank then a.rank < b.rank else a.s.population > b.s.population
	end)
	for _, t in towns do
		local size_ = ({ 18, 16, 14, 12 })[t.rank + 1]
		if label(t.s.name, t.x, t.y, size_, Color3.fromRGB(255, 238, 180), t.rank < 3) then
			-- A dot for the place itself.
			table.insert(taken, { t.x - 3, t.y - 3, 6, 6 })
		end
	end
	-- Rivers: the name along the river near the middle of its visible stretch.
	if mpp < 0.8 then
		for _, river in data.rivers do
			if river.name ~= "" then
				local pts = river.points
				local best, bestD = nil, math.huge
				for i = 1, #pts - 3, 2 do
					local x, y = toScreen((pts[i] + pts[i + 2]) / 2, (pts[i + 1] + pts[i + 3]) / 2)
					local d = (x - size.X / 2) ^ 2 + (y - size.Y / 2) ^ 2
					if x > 40 and y > 20 and x < size.X - 40 and y < size.Y - 20 and d < bestD then
						best, bestD = i, d
					end
				end
				if best then
					local ax, ay = toScreen(pts[best], pts[best + 1])
					local bx, by = toScreen(pts[best + 2], pts[best + 3])
					local angle = math.deg(math.atan2(by - ay, bx - ax))
					if angle > 90 then
						angle -= 180
					elseif angle < -90 then
						angle += 180
					end
					label(river.name, (ax + bx) / 2, (ay + by) / 2 - 8, 12, Color3.fromRGB(190, 220, 255), false, angle)
				end
			end
		end
	end
	-- Exit numbers at interchanges.
	if mpp < 0.35 then
		for _, c in data.crossings or {} do
			if c.type == "interchange" then
				local x, y = toScreen(c.x, c.y)
				label(`Exit {c.exit}`, x + 4, y + 10, 11, Color3.fromRGB(150, 230, 160), true)
			end
		end
	end
	-- Interstate and expressway names on their lines.
	for _, road in data.roads do
		if road.kind ~= "highway" and road.name ~= "" then
			local pts = road.points
			for i = 1, #pts - 1, 2 do
				local x, y = toScreen(pts[i], pts[i + 1])
				if x > 20 and y > 20 and x < size.X - 60 and y < size.Y - 20 and label(road.name, x, y, 11, if road.kind == "interstate" then Color3.fromRGB(255, 200, 200) else Color3.fromRGB(255, 220, 180), true) then
					break
				end
			end
		end
	end
end

-- Markers and readout ------------------------------------------------------------------------

local function marker(p: Player): Frame
	local existing = markers[p]
	if existing then
		return existing
	end
	local m = Instance.new("Frame")
	m.AnchorPoint = Vector2.new(0.5, 0.5)
	m.Size = UDim2.fromOffset(14, 14)
	m.BackgroundColor3 = if p == player then Color3.fromRGB(230, 50, 50) else Color3.fromRGB(60, 140, 255)
	m.ZIndex = 5
	local c = Instance.new("UICorner")
	c.CornerRadius = UDim.new(1, 0)
	c.Parent = m
	local s = Instance.new("UIStroke")
	s.Color = Color3.new(1, 1, 1)
	s.Thickness = 2
	s.Parent = m
	local pointer = Instance.new("Frame")
	pointer.AnchorPoint = Vector2.new(0.5, 1)
	pointer.Position = UDim2.fromScale(0.5, 0.5)
	pointer.Size = UDim2.fromOffset(3, 16)
	pointer.BackgroundColor3 = Color3.new(1, 1, 1)
	pointer.BorderSizePixel = 0
	pointer.ZIndex = 4
	pointer.Parent = m
	m.Parent = labelLayer
	markers[p] = m
	return m
end

local function myMiles(): (number?, number?)
	local character = player.Character
	local root = if character then character:FindFirstChild("HumanoidRootPart") :: BasePart? else nil
	if not root then
		return nil, nil
	end
	return root.Position.X / MILE + HALF, root.Position.Z / MILE + HALF
end

local function updateMarkers()
	for _, p in Players:GetPlayers() do
		local character = p.Character
		local root = if character then character:FindFirstChild("HumanoidRootPart") :: BasePart? else nil
		if root then
			local m = marker(p)
			local x, y = toScreen(root.Position.X / MILE + HALF, root.Position.Z / MILE + HALF)
			m.Position = UDim2.fromOffset(x, y)
			m.Visible = x >= 0 and y >= 0 and x <= viewSize().X and y <= viewSize().Y
			local look = root.CFrame.LookVector
			m.Rotation = math.deg(math.atan2(look.X, -look.Z))
		end
	end
	for p, m in markers do
		if not p.Parent then
			m:Destroy()
			markers[p] = nil
		end
	end
	local mx, my = myMiles()
	if mx and my then
		local best, distance = nil, math.huge
		for _, s in data.settlements do
			local d = math.sqrt((s.x - mx) ^ 2 + (s.y - my) ^ 2)
			if d < distance then
				best, distance = s, d
			end
		end
		readout.Text = string.format("You: %.1f mi east, %.1f mi south  ·  region %d, %d", mx, my, mx // Config.REGION_MILES, my // Config.REGION_MILES)
			.. (if best then string.format("  ·  %s %.1f mi", best.name, distance) else "")
			.. string.format("  ·  %s", if mpp < 0.1 then string.format("%.0f studs/px", mpp * MILE) else string.format("%.2f mi/px", mpp))
	end
end

local function changed()
	dirty = true
	quickPending = true
	lastChange = os.clock()
end

-- Building the screen -------------------------------------------------------------------------

local function build(): ScreenGui
	loadData()
	local screen = Instance.new("ScreenGui")
	screen.Name = "WorldMap"
	screen.ResetOnSpawn = false
	screen.IgnoreGuiInset = true
	screen.DisplayOrder = 10
	screen.Enabled = false

	local shade = Instance.new("Frame")
	shade.Size = UDim2.fromScale(1, 1)
	shade.BackgroundColor3 = Color3.new(0, 0, 0)
	shade.BackgroundTransparency = 0.45
	shade.Parent = screen

	local panel = Instance.new("Frame")
	panel.AnchorPoint = Vector2.new(0.5, 0.5)
	panel.Position = UDim2.fromScale(0.5, 0.5)
	panel.Size = UDim2.fromScale(0.92, 0.92)
	panel.BackgroundColor3 = Color3.fromRGB(20, 24, 30)
	panel.Parent = screen
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, 12)
	corner.Parent = panel

	local title = Instance.new("TextLabel")
	title.BackgroundTransparency = 1
	title.Position = UDim2.new(0, 16, 0, 8)
	title.Size = UDim2.new(1, -32, 0, 28)
	title.Font = Enum.Font.GothamBold
	title.TextSize = 20
	title.TextXAlignment = Enum.TextXAlignment.Left
	title.TextColor3 = Color3.fromRGB(236, 240, 245)
	title.Text = "World map"
	title.Parent = panel
	local hint = title:Clone()
	hint.Font = Enum.Font.Gotham
	hint.TextSize = 14
	hint.TextXAlignment = Enum.TextXAlignment.Right
	hint.TextColor3 = Color3.fromRGB(150, 160, 175)
	hint.Text = "M close  ·  scroll or +/− zoom  ·  drag pan  ·  C centre on you"
	hint.Parent = panel

	viewport = Instance.new("Frame")
	viewport.Position = UDim2.new(0, 12, 0, 44)
	viewport.Size = UDim2.new(1, -24, 1, -84)
	viewport.BackgroundColor3 = Color3.fromRGB(12, 14, 18)
	viewport.ClipsDescendants = true
	viewport.Active = true
	viewport.Parent = panel

	image = Instance.new("ImageLabel")
	image.Size = UDim2.fromScale(1, 1)
	image.BackgroundTransparency = 1
	image.Parent = viewport

	labelLayer = Instance.new("Frame")
	labelLayer.Size = UDim2.fromScale(1, 1)
	labelLayer.BackgroundTransparency = 1
	labelLayer.Parent = viewport

	readout = Instance.new("TextLabel")
	readout.BackgroundTransparency = 1
	readout.Position = UDim2.new(0, 16, 1, -36)
	readout.Size = UDim2.new(1, -32, 0, 28)
	readout.Font = Enum.Font.Gotham
	readout.TextSize = 15
	readout.TextXAlignment = Enum.TextXAlignment.Left
	readout.TextColor3 = Color3.fromRGB(220, 226, 235)
	readout.Parent = panel

	viewport:GetPropertyChangedSignal("AbsoluteSize"):Connect(changed)
	screen.Parent = player:WaitForChild("PlayerGui")
	return screen
end

local function centreOnMe()
	local mx, my = myMiles()
	if mx and my then
		centreX, centreY = mx, my
	end
	changed()
end

function MapView.toggle()
	local first = gui == nil
	if not gui then
		gui = build()
	end
	local screen = gui :: ScreenGui
	screen.Enabled = not screen.Enabled
	if screen.Enabled then
		if first then
			mpp = math.huge -- the whole map to start with
			centreOnMe()
		end
		changed()
	end
end

function MapView.start()
	UserInputService.InputBegan:Connect(function(input: InputObject, processed: boolean)
		if processed then
			return
		end
		if input.KeyCode == Enum.KeyCode.M then
			MapView.toggle()
		elseif input.KeyCode == Enum.KeyCode.C and gui and gui.Enabled then
			centreOnMe()
		elseif (input.KeyCode == Enum.KeyCode.Equals or input.KeyCode == Enum.KeyCode.Minus) and gui and gui.Enabled then
			mpp *= if input.KeyCode == Enum.KeyCode.Equals then 0.5 else 2
			clampView()
			changed()
		end
	end)

	local dragging: Vector3? = nil
	UserInputService.InputChanged:Connect(function(input: InputObject)
		local screen = gui
		if not screen or not screen.Enabled then
			return
		end
		if input.UserInputType == Enum.UserInputType.MouseWheel then
			local mouse = UserInputService:GetMouseLocation() - viewport.AbsolutePosition
			local size = viewSize()
			-- Keep the map point under the cursor where it is.
			local px, py = centreX + (mouse.X - size.X / 2) * mpp, centreY + (mouse.Y - size.Y / 2) * mpp
			mpp *= if input.Position.Z > 0 then 0.8 else 1.25
			mpp = math.clamp(mpp, MIN_MPP, fullMpp())
			centreX, centreY = px - (mouse.X - size.X / 2) * mpp, py - (mouse.Y - size.Y / 2) * mpp
			clampView()
			changed()
		elseif input.UserInputType == Enum.UserInputType.MouseMovement and dragging then
			centreX -= (input.Position.X - dragging.X) * mpp
			centreY -= (input.Position.Y - dragging.Y) * mpp
			dragging = input.Position
			clampView()
			changed()
		end
	end)
	UserInputService.InputBegan:Connect(function(input: InputObject)
		local screen = gui
		if screen and screen.Enabled and input.UserInputType == Enum.UserInputType.MouseButton1 then
			dragging = input.Position
		end
	end)
	UserInputService.InputEnded:Connect(function(input: InputObject)
		if input.UserInputType == Enum.UserInputType.MouseButton1 then
			dragging = nil
		end
	end)

	-- While the view moves, redraw at half resolution (at most every 70 ms); once it has been
	-- still for a quarter second, at full resolution.
	local lastQuick = 0
	RunService.RenderStepped:Connect(function()
		local screen = gui
		if not screen or not screen.Enabled then
			return
		end
		local now = os.clock()
		if dirty then
			clampView()
			local size = viewSize()
			local full = math.min(1, MAX_RES / math.max(size.X, size.Y))
			if now - lastChange > 0.25 then
				render(full)
				placeLabels()
				dirty, quickPending = false, false
			elseif quickPending and now - lastQuick > 0.07 then
				render(full * 0.4)
				placeLabels()
				quickPending = false
				lastQuick = now
			end
		end
		updateMarkers()
	end)
end

return MapView
