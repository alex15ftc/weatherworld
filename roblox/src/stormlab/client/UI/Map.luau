--!nonstrict
--!native
-- The storm lab's overview map of the whole scenario window (~240 km square): one analysed or
-- simulated field as a raster, with the simulation's objects drawn on top.
--   Base layers (the < > buttons): surface temperature and dewpoint (the advected surface grids),
--   SBCAPE, MLCIN, SRH 0-1 km, 0-6 km shear, STP (the 8 km parcel analyses, filled gradually
--   after start), the cold-pool deficit, surface rain rate and composite reflectivity (the
--   replicated precipitation volume). The raster (one 256x256 EditableImage, or 64x64 Frames)
--   is rebuilt in time-sliced rows (~1.5 ms/frame) every 3 s and whenever the view changes.
--   Objects: storms (size by updraft, magenta ring when rot > 0.5, 30-minute motion vector, id),
--   tornadoes (red triangles, with the tracks this client has seen), gust fronts (cold-pool
--   contours), line systems (leading-edge segments coloured by rear-inflow jet), mesovortices
--   and bookends, analysed boundaries (NWS-like colours: cold blue, warm red, stationary
--   red/blue, dryline brown, outflow dashed), the camera and its view direction, the radar site.
-- Controls: M toggles. Click a storm or tornado to follow it; Shift+click moves the radar site
-- (ctx.state.radarSite). Mouse wheel zooms about the cursor, drag pans, "Reset" shows it all.
local UserInputService = game:GetService("UserInputService")

local Widgets = require(script.Parent:WaitForChild("RadarParts"):WaitForChild("Widgets"))

local M = {}

local N, FALLBACK_N = 256, 64
local REFRESH_S = 3
local RASTER_BUDGET = 0.0015
local OVERLAY_HZ = 4
local MAX_LINES = 1200
local floor, sqrt = math.floor, math.sqrt

local BG = Widgets.pack(16, 18, 24)
local BG_OUT = Widgets.pack(6, 7, 10)

local function P(p: any): (number, number)
	return p.x or p[1], p.y or p[2]
end

local function fmtKm(m: number): string
	return string.format("%.1f", m / 1000)
end

local ramp = Widgets.ramp
local LAYERS = {
	{
		name = "Surface temperature", unit = "\u{00B0}C", vmin = 10, vmax = 40, ticks = { 10, 20, 30, 40 },
		colour = ramp({ { 10, 0.2, 0.2, 0.6 }, { 16, 0.15, 0.5, 0.9 }, { 22, 0.2, 0.75, 0.55 }, { 27, 0.75, 0.85, 0.25 }, { 31, 0.95, 0.65, 0.15 }, { 35, 0.9, 0.25, 0.12 }, { 40, 0.75, 0.15, 0.55 } }),
		prep = function(cw)
			local g = cw.env and cw.env.surfT
			return g and function(x, y)
				return g:sample(x, y)
			end
		end,
		fmt = "%.1f",
	},
	{
		name = "Surface dewpoint", unit = "\u{00B0}C", vmin = 0, vmax = 26, ticks = { 0, 8, 16, 24 },
		colour = ramp({ { 0, 0.45, 0.32, 0.18 }, { 8, 0.7, 0.58, 0.35 }, { 13, 0.65, 0.75, 0.45 }, { 17, 0.25, 0.7, 0.3 }, { 20, 0.1, 0.5, 0.2 }, { 23, 0.1, 0.55, 0.55 }, { 26, 0.2, 0.4, 0.8 } }),
		prep = function(cw)
			local g = cw.env and cw.env.surfTd
			return g and function(x, y)
				return g:sample(x, y)
			end
		end,
		fmt = "%.1f",
	},
	{
		name = "SBCAPE", unit = "J/kg", vmin = 0, vmax = 5000, ticks = { 0, 1000, 2500, 4000 }, analysis = "sbcape",
		colour = ramp({ { 0, 0.1, 0.11, 0.14 }, { 250, 0.2, 0.25, 0.3 }, { 1000, 0.75, 0.7, 0.2 }, { 2000, 0.95, 0.55, 0.1 }, { 3000, 0.9, 0.2, 0.1 }, { 4000, 0.8, 0.1, 0.5 }, { 5000, 0.9, 0.6, 0.95 } }),
		fmt = "%.0f",
	},
	{
		name = "MLCIN", unit = "J/kg", vmin = -300, vmax = 0, ticks = { -300, -200, -100, -25 }, analysis = "mlcin",
		colour = ramp({ { -300, 0.45, 0.15, 0.6 }, { -150, 0.25, 0.3, 0.85 }, { -75, 0.3, 0.55, 0.9 }, { -25, 0.5, 0.75, 0.9 }, { -5, 0.25, 0.3, 0.35 }, { 0, 0.1, 0.11, 0.14 } }),
		fmt = "%.0f",
	},
	{
		name = "SRH 0-1 km", unit = "m\u{00B2}/s\u{00B2}", vmin = 0, vmax = 500, ticks = { 0, 100, 250, 400 }, analysis = "srh01",
		colour = ramp({ { 0, 0.1, 0.11, 0.14 }, { 50, 0.25, 0.27, 0.32 }, { 100, 0.3, 0.55, 0.75 }, { 200, 0.85, 0.8, 0.2 }, { 300, 0.95, 0.45, 0.1 }, { 400, 0.85, 0.1, 0.15 }, { 500, 0.8, 0.3, 0.9 } }),
		fmt = "%.0f",
	},
	{
		name = "0-6 km shear", unit = "m/s", vmin = 0, vmax = 40, ticks = { 0, 10, 20, 30, 40 }, analysis = "shear06",
		colour = ramp({ { 0, 0.1, 0.11, 0.14 }, { 10, 0.2, 0.3, 0.55 }, { 15, 0.2, 0.6, 0.7 }, { 20, 0.3, 0.75, 0.3 }, { 25, 0.9, 0.8, 0.2 }, { 32, 0.95, 0.4, 0.1 }, { 40, 0.8, 0.15, 0.5 } }),
		fmt = "%.1f",
	},
	{
		name = "STP", unit = "", vmin = 0, vmax = 8, ticks = { 0, 1, 3, 5, 8 }, analysis = "stp",
		colour = ramp({ { 0, 0.1, 0.11, 0.14 }, { 0.5, 0.25, 0.28, 0.33 }, { 1, 0.4, 0.6, 0.8 }, { 2, 0.9, 0.8, 0.2 }, { 4, 0.95, 0.35, 0.1 }, { 6, 0.85, 0.1, 0.4 }, { 8, 0.95, 0.6, 1.0 } }),
		fmt = "%.1f",
	},
	{
		name = "Cold pool deficit", unit = "K", vmin = 0, vmax = 10, ticks = { 0, 2, 5, 8 },
		colour = ramp({ { 0, 0.1, 0.11, 0.14 }, { 0.5, 0.2, 0.3, 0.4 }, { 2, 0.3, 0.55, 0.85 }, { 4, 0.25, 0.3, 0.9 }, { 6, 0.5, 0.2, 0.8 }, { 10, 0.9, 0.5, 0.95 } }),
		prep = function(cw)
			local g = cw.coldPool and cw.coldPool.D
			return g and function(x, y)
				return g:sample(x, y)
			end
		end,
		fmt = "%.1f",
	},
	{
		-- coloured on log10 of the rate
		name = "Surface rain rate", unit = "mm/h", vmin = -1, vmax = 2, ticks = { -1, 0, 1, 2 }, log = true,
		colour = ramp({ { -1, 0.1, 0.35, 0.2 }, { -0.3, 0.1, 0.6, 0.2 }, { 0.5, 0.2, 0.8, 0.2 }, { 1, 0.95, 0.9, 0.1 }, { 1.4, 1.0, 0.5, 0.0 }, { 1.7, 0.9, 0.05, 0.05 }, { 2, 0.95, 0.2, 0.95 } }),
		fmt = "%.1f",
	},
	{
		name = "Composite reflectivity", unit = "dBZ", vmin = -10, vmax = 75, ticks = { 0, 20, 40, 60 }, compref = true,
		fmt = "%.0f",
	},
}

function M.new(ctx)
	local self = {}
	local st = ctx.state
	local Sim = ctx.Sim
	local conns = {}
	local VOX = (Sim.Precip and Sim.Precip.VOX) or 1000
	local NZV = (Sim.Precip and Sim.Precip.NZV) or 16

	for _, L in LAYERS do
		if L.compref then
			L.colour = Sim.Radar.refColour
		end
	end

	---------------------------------------------------------------- UI
	local panel, uiScale = Widgets.panel(ctx.ui, "LabMap", Widgets.MAP_W, Widgets.MAP_H)
	panel.ZIndex = 5
	Widgets.label(panel, "Map", 12, 4, 200, 22, 15, nil, true)
	local closeBtn = Widgets.button(panel, "x", Widgets.MAP_W - 30, 5, 22, 20, function()
		st.show.map = false
	end)
	closeBtn.BackgroundTransparency = 0.5

	local layerIdx = 10 -- composite reflectivity
	local objectsOn = true
	local IMG = 420
	local half, cx, cy = 0, 0, 0
	local viewDirty = true
	local rebuildLegend
	local layerName = Widgets.label(panel, "", 38, 32, 192, 22, 13, Enum.TextXAlignment.Center, true)
	local function setLayer(i: number)
		layerIdx = (i - 1) % #LAYERS + 1
		layerName.Text = LAYERS[layerIdx].name
		viewDirty = true
		rebuildLegend()
	end
	Widgets.button(panel, "<", 10, 32, 26, 22, function()
		setLayer(layerIdx - 1)
	end)
	Widgets.button(panel, ">", 232, 32, 26, 22, function()
		setLayer(layerIdx + 1)
	end)
	local objBtn
	objBtn = Widgets.button(panel, "Objects", 266, 32, 70, 22, function()
		objectsOn = not objectsOn
		Widgets.setActive(objBtn, objectsOn)
	end)
	Widgets.setActive(objBtn, objectsOn)
	Widgets.button(panel, "Reset", 340, 32, 90, 22, function()
		half = 0 -- the next frame shows the whole window
	end)

	local holder = Instance.new("Frame")
	holder.Name = "MapView"
	holder.Position = UDim2.fromOffset(10, 60)
	holder.Size = UDim2.fromOffset(IMG, IMG)
	holder.BackgroundColor3 = Color3.fromRGB(6, 7, 10)
	holder.BorderSizePixel = 0
	holder.ClipsDescendants = true
	holder.Active = true
	holder.Parent = panel
	local canvas = Widgets.canvas(holder, N, FALLBACK_N, BG, Enum.ResamplerMode.Default)
	local n = canvas.n
	local pix = canvas.pix
	local overlay = Instance.new("Frame")
	overlay.BackgroundTransparency = 1
	overlay.Size = UDim2.fromScale(1, 1)
	overlay.ZIndex = 3
	overlay.Parent = holder

	local function makeLine(parent: Instance): GuiObject
		local f = Instance.new("Frame")
		f.BorderSizePixel = 0
		f.ZIndex = 3
		f.Parent = parent
		return f
	end
	local function makeDot(parent: Instance): GuiObject
		local f = Instance.new("Frame")
		f.BorderSizePixel = 0
		f.AnchorPoint = Vector2.new(0.5, 0.5)
		f.ZIndex = 4
		Widgets.corner(f).CornerRadius = UDim.new(0.5, 0)
		local s = Instance.new("UIStroke")
		s.Color = Color3.new(0, 0, 0)
		s.Transparency = 0.4
		s.Thickness = 1
		s.Parent = f
		f.Parent = parent
		return f
	end
	local function makeRing(parent: Instance): GuiObject
		local f = Instance.new("Frame")
		f.BackgroundTransparency = 1
		f.AnchorPoint = Vector2.new(0.5, 0.5)
		f.ZIndex = 4
		Widgets.corner(f).CornerRadius = UDim.new(0.5, 0)
		local s = Instance.new("UIStroke")
		s.Thickness = 2
		s.Parent = f
		f.Parent = parent
		return f
	end
	local function makeText(parent: Instance): GuiObject
		local l = Instance.new("TextLabel")
		l.BackgroundTransparency = 1
		l.AnchorPoint = Vector2.new(0.5, 0.5)
		l.Size = UDim2.fromOffset(80, 14)
		l.Font = Widgets.FONT_BOLD
		l.TextSize = 11
		l.TextColor3 = Color3.new(1, 1, 1)
		l.TextStrokeTransparency = 0.3
		l.ZIndex = 5
		l.Parent = parent
		return l
	end
	local function makeTri(parent: Instance): GuiObject
		local l = Instance.new("TextLabel")
		l.BackgroundTransparency = 1
		l.AnchorPoint = Vector2.new(0.5, 0.5)
		l.Size = UDim2.fromOffset(16, 16)
		l.Font = Widgets.FONT_BOLD
		l.TextSize = 16
		l.Text = "\u{25B2}"
		l.TextColor3 = Color3.fromRGB(255, 40, 40)
		l.TextStrokeTransparency = 0.1
		l.ZIndex = 6
		l.Parent = parent
		return l
	end
	local lines = Widgets.pool(overlay, makeLine)
	local dots = Widgets.pool(overlay, makeDot)
	local rings = Widgets.pool(overlay, makeRing)
	local texts = Widgets.pool(overlay, makeText)
	local tris = Widgets.pool(overlay, makeTri)

	local siteMark = Instance.new("Frame")
	siteMark.AnchorPoint = Vector2.new(0.5, 0.5)
	siteMark.Size = UDim2.fromOffset(8, 8)
	siteMark.BackgroundColor3 = Color3.fromRGB(80, 230, 255)
	siteMark.BorderSizePixel = 0
	siteMark.ZIndex = 6
	siteMark.Visible = false
	siteMark.Parent = overlay
	local camDot = Instance.new("Frame")
	camDot.AnchorPoint = Vector2.new(0.5, 0.5)
	camDot.Size = UDim2.fromOffset(7, 7)
	camDot.BackgroundColor3 = Color3.new(1, 1, 1)
	camDot.BorderSizePixel = 0
	camDot.ZIndex = 7
	Widgets.corner(camDot).CornerRadius = UDim.new(0.5, 0)
	camDot.Parent = overlay
	local camLine = Instance.new("Frame")
	camLine.BorderSizePixel = 0
	camLine.BackgroundColor3 = Color3.new(1, 1, 1)
	camLine.ZIndex = 7
	camLine.Parent = overlay

	local north = Widgets.label(holder, "N\n\u{2191}", IMG - 26, 6, 20, 30, 13, Enum.TextXAlignment.Center, true)
	north.ZIndex = 8
	north.TextWrapped = true
	north.TextStrokeTransparency = 0.3
	local scaleText = Widgets.label(holder, "", 6, 4, 260, 16, 12, nil, true)
	scaleText.ZIndex = 8
	scaleText.TextStrokeTransparency = 0.3
	local readout = Widgets.label(panel, "", 10, Widgets.MAP_H - 24, Widgets.MAP_W - 20, 18, 12)
	readout.TextColor3 = Widgets.DIM

	local legendHolder = nil
	rebuildLegend = function()
		local L = LAYERS[layerIdx]
		local fmt = if L.log
			then function(v)
				local r = 10 ^ v
				return if r < 1 then string.format("%.1f", r) else string.format("%d", floor(r + 0.5))
			end
			else function(v)
				return tostring(v)
			end
		legendHolder = Widgets.legend(panel, 10, 484, IMG, 12, L.colour, L.vmin, L.vmax, L.ticks, fmt, L.unit, legendHolder)
	end
	setLayer(layerIdx)

	---------------------------------------------------------------- data
	local tracks = {} -- tornado id -> { pts = { {x, y} }, ended }
	local pass = nil -- { row, fn, L, cx, cy, half }
	local lastPass = -math.huge
	local needFlush = false
	local overlayAt = 0
	local overlayDirty = true

	local function extent(): number
		local e = ctx.cw.env and ctx.cw.env.extent
		return e or 120000
	end

	local function compRefFn(vol)
		if not vol or not vol.dbz or not vol.nxv then
			return function()
				return nil
			end
		end
		local nx, x0, dbzT, cols = vol.nxv, vol.x0, vol.dbz, vol.columns
		local nxy = nx * nx
		return function(x: number, y: number): number?
			local ix = floor((x - x0) / VOX)
			local iy = floor((y - x0) / VOX)
			if ix < 0 or iy < 0 or ix >= nx or iy >= nx then
				return nil
			end
			local col = ix + iy * nx
			if cols and not cols[col] then
				return nil
			end
			local best = -999
			for z = 0, NZV - 1 do
				local d = dbzT[col + z * nxy]
				if d and d > best then
					best = d
				end
			end
			return if best > -900 then best else nil
		end
	end

	-- value function of the current layer: (x, y) -> value (in colour units) or nil
	local function layerFn(L)
		local cw = ctx.cw
		if L.compref then
			return compRefFn(cw.vol)
		end
		if L.log then
			local vol = cw.vol
			local surf = Sim.Precip.surface
			return function(x: number, y: number): number?
				if not vol then
					return nil
				end
				local r = surf(vol, x, y)
				if r < 0.1 then
					return nil
				end
				return math.log10(r)
			end
		end
		if L.analysis then
			local g = cw.env and cw.env.fields and cw.env.fields[L.analysis]
			if not g then
				return function()
					return nil
				end
			end
			return function(x: number, y: number): number?
				return g:sample(x, y)
			end
		end
		local f = L.prep(cw)
		if not f then
			return function()
				return nil
			end
		end
		if L.name == "Cold pool deficit" then
			return function(x: number, y: number): number?
				local d = f(x, y)
				return if d > 0.2 then d else nil
			end
		end
		return f
	end

	local function analysisProgress(): number
		local env = ctx.cw.env
		if not env or not env.ag then
			return 1
		end
		return math.clamp((env.analysed or 0) / math.max(1, env.ag.nx * env.ag.ny), 0, 1)
	end

	local function startPass()
		local L = LAYERS[layerIdx]
		pass = { row = 0, fn = layerFn(L), L = L, cx = cx, cy = cy, half = half, E = extent() }
	end

	local function rasterStep(budgetEnd: number)
		local p = pass
		local fn, colour = p.fn, p.L.colour
		local mppx = 2 * p.half / n
		local x0, y1, E = p.cx - p.half, p.cy + p.half, p.E
		while p.row < n do
			local py = p.row
			local y = y1 - (py + 0.5) * mppx
			local base = py * n
			local outY = math.abs(y) > E
			for px = 0, n - 1 do
				local x = x0 + (px + 0.5) * mppx
				local col
				if outY or math.abs(x) > E then
					col = BG_OUT
				else
					local v = fn(x, y)
					if v then
						local r, g, b = colour(v)
						col = Widgets.pack01(r, g, b)
					else
						col = BG
					end
				end
				buffer.writeu32(pix, (base + px) * 4, col)
			end
			canvas:markRow(py)
			p.row += 1
			if os.clock() > budgetEnd then
				break
			end
		end
		if p.row >= n then
			pass = nil
			lastPass = os.clock()
			needFlush = true
		end
	end

	-- sim -> overlay scale coordinates
	local function toScale(x: number, y: number): (number, number)
		return (x - (cx - half)) / (2 * half), ((cy + half) - y) / (2 * half)
	end
	local function fromScale(u: number, v: number): (number, number)
		return cx - half + u * 2 * half, cy + half - v * 2 * half
	end

	local lineCount = 0
	local function seg(ax: number, ay: number, bx: number, by: number, colour: Color3, thick: number, transp: number?)
		if lineCount >= MAX_LINES then
			return
		end
		local x0, y0, x1, y1 = Widgets.clip(ax, ay, bx, by, 0, 1)
		if not x0 then
			return
		end
		lineCount += 1
		local f = lines:take()
		f.BackgroundColor3 = colour
		f.BackgroundTransparency = transp or 0
		Widgets.placeLine(f, x0, y0, x1 :: number, y1 :: number, thick)
	end

	-- a polyline of sim points; style: nil solid, "dash", or "alt" (alternating colour2)
	local function polyline(pts: { any }, colour: Color3, thick: number, style: string?, colour2: Color3?, step: number?)
		local k = step or 1
		local px, py = nil, nil
		local i = 1
		local np = #pts
		while i <= np do
			local x, y = P(pts[i])
			local sx, sy = toScale(x, y)
			if px then
				if style then
					-- split into pieces of ~1.6% of the view
					local dx, dy = sx - px, sy - py
					local len = sqrt(dx * dx + dy * dy)
					local pieces = math.max(1, floor(len / 0.016))
					for q = 0, pieces - 1 do
						if style == "alt" then
							seg(px + dx * q / pieces, py + dy * q / pieces, px + dx * (q + 1) / pieces, py + dy * (q + 1) / pieces, if q % 2 == 0 then colour else (colour2 or colour), thick)
						elseif q % 2 == 0 then
							seg(px + dx * q / pieces, py + dy * q / pieces, px + dx * (q + 0.6) / pieces, py + dy * (q + 0.6) / pieces, colour, thick)
						end
					end
				else
					seg(px, py, sx, sy, colour, thick)
				end
			end
			px, py = sx, sy
			if i < np and i + k > np then
				i = np
			else
				i += k
			end
		end
	end

	local BOUNDARY = {
		cold = { Color3.fromRGB(70, 130, 255) },
		warm = { Color3.fromRGB(255, 60, 60) },
		stationary = { Color3.fromRGB(255, 60, 60), "alt", Color3.fromRGB(70, 130, 255) },
		dryline = { Color3.fromRGB(205, 135, 60), "dash" },
		outflow = { Color3.fromRGB(190, 140, 255), "dash" },
	}
	local RIJ = ramp({ { 0, 0.95, 0.9, 0.3 }, { 8, 1.0, 0.6, 0.15 }, { 15, 0.95, 0.2, 0.2 }, { 22, 0.95, 0.35, 0.95 } })
	local WCOL = ramp({ { 0, 0.75, 0.75, 0.7 }, { 15, 1.0, 0.9, 0.3 }, { 30, 1.0, 0.55, 0.15 }, { 45, 0.95, 0.15, 0.15 } })

	local function inside(u: number, v: number): boolean
		return u > -0.01 and u < 1.01 and v > -0.01 and v < 1.01
	end

	local function drawOverlays()
		local cw = ctx.cw
		lines:begin()
		dots:begin()
		rings:begin()
		texts:begin()
		tris:begin()
		lineCount = 0
		if objectsOn then
			-- analysed boundaries
			for _, b in cw.boundaries or {} do
				local sty = BOUNDARY[b.type] or BOUNDARY.stationary
				if b.points and #b.points >= 2 then
					polyline(b.points, sty[1], 2, sty[2], sty[3])
				end
			end
			-- gust fronts (cold-pool contours)
			local snap = cw.systemsSnap or {}
			for _, f in snap.fronts or {} do
				if #f >= 2 then
					polyline(f, Color3.fromRGB(110, 200, 255), 1.5, nil, nil, 1)
				end
			end
			-- line systems: leading-edge segments coloured by the rear-inflow jet
			for _, sys in snap.systems or {} do
				local segs = sys.segments or {}
				for i = 1, #segs - 1 do
					local a, b = segs[i], segs[i + 1]
					local ax, ay = toScale(a[1], a[2])
					local bx, by = toScale(b[1], b[2])
					local r, g, bb = RIJ(a[7] or 0)
					seg(ax, ay, bx, by, Color3.new(r, g, bb), 3.5)
				end
				local mid = segs[math.max(1, (#segs + 1) // 2)]
				if mid then
					local u, v = toScale(mid[1], mid[2])
					if inside(u, v) then
						local l = texts:take()
						l.Text = string.format("%s %d km", sys.mode or "line", floor((sys.length or 0) / 1000 + 0.5))
						l.Size = UDim2.fromOffset(110, 14)
						l.TextColor3 = Color3.fromRGB(255, 220, 160)
						-- ahead of the line, along its normal
						l.Position = UDim2.new(u, (mid[3] or 0) * 18, v, -(mid[4] or 0) * 18)
					end
				end
			end
			-- mesovortices and bookends
			for _, mv in snap.vortices or {} do
				if not mv.dead then
					local u, v = toScale(mv.x, mv.y)
					if inside(u, v) then
						local f = rings:take()
						local sz = if mv.kind == "bookend" then 13 else 9
						f.Size = UDim2.fromOffset(sz, sz)
						f.Position = UDim2.fromScale(u, v)
						local s = f:FindFirstChildOfClass("UIStroke")
						if s then
							s.Color = if mv.cyclonic then Color3.fromRGB(255, 90, 90) else Color3.fromRGB(90, 150, 255)
							s.Thickness = 1.5
						end
						if mv.kind == "bookend" then
							local l = texts:take()
							l.Text = "BE"
							l.Size = UDim2.fromOffset(30, 12)
							l.TextColor3 = s and s.Color or Color3.new(1, 1, 1)
							l.Position = UDim2.new(u, 0, v, 12)
						end
					end
				end
			end
			-- storms
			for _, s in cw.storms or {} do
				local u, v = toScale(s.x, s.y)
				if inside(u, v) then
					if s.dead then
						local d = dots:take()
						d.Size = UDim2.fromOffset(4, 4)
						d.BackgroundColor3 = Color3.fromRGB(120, 120, 130)
						d.Position = UDim2.fromScale(u, v)
					else
						local W = s.W or 0
						local sz = math.clamp(5 + W / 4, 6, 18)
						-- motion over 30 min
						local mu, mv = toScale(s.x + (s.u or 0) * 1800, s.y + (s.v or 0) * 1800)
						seg(u, v, mu, mv, Color3.fromRGB(235, 235, 235), 1.5, 0.15)
						if (s.rot or 0) > 0.5 then
							local rg = rings:take()
							rg.Size = UDim2.fromOffset(sz + 8, sz + 8)
							rg.Position = UDim2.fromScale(u, v)
							local stroke = rg:FindFirstChildOfClass("UIStroke")
							if stroke then
								stroke.Color = Color3.fromRGB(255, 80, 255)
								stroke.Thickness = 2
							end
						end
						local d = dots:take()
						d.Size = UDim2.fromOffset(sz, sz)
						local r, g, b = WCOL(W)
						d.BackgroundColor3 = Color3.new(r, g, b)
						d.Position = UDim2.fromScale(u, v)
						local l = texts:take()
						l.Text = tostring(s.id)
						l.Size = UDim2.fromOffset(60, 12)
						l.TextColor3 = if st.focusKind == "storm" and st.focusId == s.id then Color3.fromRGB(120, 255, 160) else Color3.new(1, 1, 1)
						l.Position = UDim2.new(u, 0, v, -sz * 0.5 - 8)
					end
				end
			end
			-- tornado tracks and tornadoes
			for _, tr in tracks do
				if #tr.pts >= 2 then
					polyline(tr.pts, Color3.fromRGB(200, 30, 30), 2.5, nil, nil, math.max(1, #tr.pts // 120))
				end
			end
			for _, t in cw.tornadoes or {} do
				if not t.ended then
					local u, v = toScale(t.x, t.y)
					if inside(u, v) then
						local l = tris:take()
						l.Position = UDim2.fromScale(u, v)
					end
				end
			end
		end
		-- radar site
		local rs = st.radarSite
		if rs and rs.x and rs.y then
			local u, v = toScale(rs.x, rs.y)
			siteMark.Visible = inside(u, v)
			siteMark.Position = UDim2.fromScale(u, v)
		else
			siteMark.Visible = false
		end
		lines:finish()
		dots:finish()
		rings:finish()
		texts:finish()
		tris:finish()
	end

	local function drawCamera()
		local x, y = ctx:simCamera()
		local u, v = toScale(x, y)
		local vis = inside(u, v)
		camDot.Visible = vis
		camLine.Visible = vis
		if not vis then
			return
		end
		camDot.Position = UDim2.fromScale(u, v)
		local look = ctx.camera.CFrame.LookVector
		local lx, ly = look.X, -look.Z
		local m = sqrt(lx * lx + ly * ly)
		if m > 1e-4 then
			local L = 0.06
			Widgets.placeLine(camLine, u, v, u + lx / m * L, v - ly / m * L, 2)
		else
			camLine.Visible = false
		end
	end

	local function updateTracks()
		for _, t in ctx.cw.tornadoes or {} do
			if t.id ~= nil then
				local tr = tracks[t.id]
				if not tr then
					tr = { pts = {} }
					tracks[t.id] = tr
				end
				local last = tr.pts[#tr.pts]
				if not last or (last[1] - t.x) ^ 2 + (last[2] - t.y) ^ 2 > 150 * 150 then
					table.insert(tr.pts, { t.x, t.y })
					if #tr.pts > 800 then
						local thin = {}
						for i = 1, #tr.pts, 2 do
							table.insert(thin, tr.pts[i])
						end
						table.insert(thin, tr.pts[#tr.pts])
						tr.pts = thin
					end
				end
				tr.ended = t.ended
			end
		end
	end

	---------------------------------------------------------------- input
	local function mouseUV(): (number, number, boolean)
		local m = UserInputService:GetMouseLocation()
		local p, sz = holder.AbsolutePosition, holder.AbsoluteSize
		if sz.X <= 0 then
			return 0, 0, false
		end
		local u, v = (m.X - p.X) / sz.X, (m.Y - p.Y) / sz.Y
		return u, v, panel.Visible and u >= 0 and u <= 1 and v >= 0 and v <= 1
	end

	local function nearest(u: number, v: number)
		local cw = ctx.cw
		local szPx = holder.AbsoluteSize.X
		local best, bestKind, bd = nil, nil, math.huge
		for _, t in cw.tornadoes or {} do
			if not t.ended then
				local a, b = toScale(t.x, t.y)
				local d = sqrt((a - u) ^ 2 + (b - v) ^ 2) * szPx
				if d < 12 and d < bd then
					best, bestKind, bd = t, "tornado", d
				end
			end
		end
		if best then
			return best, bestKind
		end
		for _, s in cw.storms or {} do
			if not s.dead then
				local a, b = toScale(s.x, s.y)
				local d = sqrt((a - u) ^ 2 + (b - v) ^ 2) * szPx
				if d < 14 and d < bd then
					best, bestKind, bd = s, "storm", d
				end
			end
		end
		return best, bestKind
	end

	local drag = nil -- { u, v, cx, cy, moved }
	local function onClick(u: number, v: number)
		local x, y = fromScale(u, v)
		if UserInputService:IsKeyDown(Enum.KeyCode.LeftShift) or UserInputService:IsKeyDown(Enum.KeyCode.RightShift) then
			st.radarSite = { x = x, y = y }
			overlayDirty = true
			return
		end
		local obj, kind = nearest(u, v)
		if obj then
			st.focusKind = kind
			st.focusId = obj.id
			overlayDirty = true
		end
	end

	-- UserInputService rather than the frame's own events (the overlay's children sit on top);
	-- gameProcessed is ignored on purpose: the map frame is Active, so it is always "processed"
	table.insert(conns, UserInputService.InputBegan:Connect(function(input)
		if input.UserInputType == Enum.UserInputType.MouseButton1 then
			local u, v, ok = mouseUV()
			if ok then
				drag = { u = u, v = v, cx = cx, cy = cy, moved = false }
			end
		end
	end))
	table.insert(conns, UserInputService.InputChanged:Connect(function(input)
		if input.UserInputType == Enum.UserInputType.MouseWheel then
			local u, v, ok = mouseUV()
			if not ok then
				return
			end
			local E = extent()
			local x, y = fromScale(u, v)
			local f = if input.Position.Z > 0 then 0.8 else 1.25
			local nh = math.clamp(half * f, E / 8, E * 1.2)
			-- keep the point under the cursor fixed
			cx = x - (u - 0.5) * 2 * nh
			cy = y + (v - 0.5) * 2 * nh
			half = nh
			viewDirty = true
		end
	end))
	table.insert(conns, UserInputService.InputChanged:Connect(function(input)
		if drag and input.UserInputType == Enum.UserInputType.MouseMovement then
			local u, v = mouseUV()
			local du, dv = u - drag.u, v - drag.v
			if drag.moved or math.abs(du) + math.abs(dv) > 0.01 then
				drag.moved = true
				cx = drag.cx - du * 2 * half
				cy = drag.cy + dv * 2 * half
				viewDirty = true
			end
		end
	end))
	table.insert(conns, UserInputService.InputEnded:Connect(function(input)
		if drag and input.UserInputType == Enum.UserInputType.MouseButton1 then
			local d = drag
			drag = nil
			if not d.moved then
				onClick(d.u, d.v)
			end
		end
	end))
	table.insert(conns, UserInputService.InputBegan:Connect(function(input, gp)
		if gp or UserInputService:GetFocusedTextBox() then
			return
		end
		if input.KeyCode == Enum.KeyCode.M then
			st.show.map = not st.show.map
		end
	end))
	table.insert(conns, ctx.signals.scenario:Connect(function()
		tracks = {}
		half = 0
		pass = nil
		canvas:clear()
		needFlush = true
	end))

	local function updateReadout()
		local u, v, ok = mouseUV()
		if not ok then
			local prog = analysisProgress()
			readout.Text = if LAYERS[layerIdx].analysis and prog < 1 then string.format("Analysing the environment... %d%%", floor(prog * 100)) else "Click: follow  Shift+click: radar site  Wheel: zoom  Drag: pan"
			return
		end
		local x, y = fromScale(u, v)
		local L = LAYERS[layerIdx]
		local fn = (pass and pass.L == L and pass.fn) or layerFn(L)
		local val = fn(x, y)
		local vt
		if val == nil then
			vt = "--"
		elseif L.log then
			vt = string.format("%.1f %s", 10 ^ val, L.unit)
		else
			vt = string.format(L.fmt, val) .. " " .. L.unit
		end
		local obj, kind = nearest(u, v)
		local extra = ""
		if obj and kind == "storm" then
			extra = string.format("   storm %s  W %.0f m/s  rot %.2f  hail %.1f cm", tostring(obj.id), obj.W or 0, obj.rot or 0, obj.hailMax or 0)
		elseif obj then
			extra = string.format("   tornado %s  EF%s  %s", tostring(obj.id), tostring(obj.ef or "?"), tostring(obj.stage or ""))
		end
		readout.Text = string.format("%s %s   x %s y %s km%s", L.name, vt, fmtKm(x), fmtKm(y), extra)
	end

	---------------------------------------------------------------- frame
	function self:update(_dt: number)
		updateTracks() -- keep tracks even while hidden (cheap)
		local show = st.show.map == true
		panel.Visible = show
		if not show then
			return
		end
		local s, _, right = Widgets.layout(st.show.radar == true, true)
		uiScale.Scale = s
		panel.Position = UDim2.new(1, -right, 0, Widgets.GAP)

		local E = extent()
		if half <= 0 then
			half, cx, cy = E, 0, 0
			viewDirty = true
		end
		if viewDirty then
			viewDirty = false
			overlayDirty = true
			startPass()
		elseif not pass and os.clock() - lastPass > REFRESH_S then
			startPass()
		end
		if pass then
			-- each pass reaches the image when complete (never half old, half new)
			rasterStep(os.clock() + RASTER_BUDGET)
		end
		if needFlush then
			canvas:flush(os.clock() + 0.002)
			needFlush = false
			for _, d in canvas.dirty do
				if d then
					needFlush = true
					break
				end
			end
		end
		if overlayDirty or os.clock() - overlayAt > 1 / OVERLAY_HZ then
			overlayDirty = false
			overlayAt = os.clock()
			drawOverlays()
		end
		drawCamera()
		scaleText.Text = string.format("%s   %d km across", LAYERS[layerIdx].name, floor(2 * half / 1000 + 0.5))
		updateReadout()
	end

	function self:destroy()
		for _, c in conns do
			c:Disconnect()
		end
		canvas:destroy()
		panel:Destroy()
	end

	return self
end

return M
