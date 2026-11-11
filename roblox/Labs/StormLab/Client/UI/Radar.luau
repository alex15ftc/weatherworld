--!nonstrict
--!native
-- The storm lab's Doppler radar display (guide section 16). Every gate is sampled from the same
-- simulation that draws the storm (Sim/Radar.gate: the precipitation volume, the full wind
-- field incl. cold pool / storms / vortices / tornadoes, clear-air fine lines, tornado debris),
-- so a hook, a couplet or a bowing segment on this screen is the storm state itself.
--
-- How it draws: one radar site, one tilt at a time, swept radial by radial like a rotating
-- antenna. Gates are stored in polar form (per radial: dBZ, radial velocity, CC, spectrum
-- width) and each sampled gate is painted straight into its pixel footprint of one 512x512
-- EditableImage (every pixel centre belongs to exactly one polar cell, so nothing overlaps).
-- The previous scan stays on screen until the sweep overwrites it. Switching product only
-- repaints from the stored gates (no resampling); moving/zooming the view repaints the stored
-- gates into the new view, then the sweep carries on. Only gates inside the visible square are
-- sampled. Budget: ~1.6 ms of gates per frame (a gate costs ~40 us), none while hidden.
-- Gate spacing follows the zoom: 250 m x 0.5 deg (30 km view), 500 m x 0.5 deg (60 km),
-- 1 km x 1 deg (120 km).
--
-- Controls: R toggles the panel (while open: V next product, N site near focus, Z next zoom). Products REF / VEL / SRV / CC / SW; tilt up/down (0.5-6.4 deg);
-- view 30 / 60 / 120 km; centre on the focus or the site; "Site near focus" moves the radar
-- ~25 km south-west of what the lab follows (the map's Shift+click sets ctx.state.radarSite);
-- Alias toggles a 32 m/s Nyquist velocity; Marks toggles storm / tornado markers. Hover the
-- image for the gate value, beam height, range / azimuth and position.
local UserInputService = game:GetService("UserInputService")

local Widgets = require(script.Parent:WaitForChild("RadarParts"):WaitForChild("Widgets"))

local M = {}

local TILTS = { 0.5, 0.9, 1.3, 1.8, 2.4, 3.1, 4.0, 5.1, 6.4 }
local ZOOMS = {
	{ half = 30000, dr = 250, da = 0.5, ring = 10000, label = "30" },
	{ half = 60000, dr = 500, da = 0.5, ring = 20000, label = "60" },
	{ half = 120000, dr = 1000, da = 1.0, ring = 25000, label = "120" },
}
local PRODUCTS = { "REF", "VEL", "SRV", "CC", "SW" }
-- (FALLBACK_N: the Frames grid used only if CreateEditableImage fails - at most 32 x 32 = 1 024
-- Frames; 96 x 96 was 9 216 Frames, far too many for a game client)
local N, FALLBACK_N = 512, 32
local MAX_RANGE = 150000
-- (25 km: the lowest beam is ~400 m wide there - a mesocyclone is resolved and a tornado shows
-- as gate-to-gate shear; at 62 km the beam was ~1 km wide and smeared both)
local SITE_DIST = 25000
local NYQUIST = 32
local GATE_BUDGET = 0.0016 -- s of sampling per frame
local REPAINT_BUDGET = 0.004
local ROTATION_S = 8 -- fastest full rotation (s): empty sectors sweep at this rate
local VEL_SCALE = 35

local sin, cos, rad, atan2, sqrt, floor = math.sin, math.cos, math.rad, math.atan2, math.sqrt, math.floor
local TWO_PI = 2 * math.pi

local BG = Widgets.pack(10, 12, 16)
local BG_OUT = Widgets.pack(4, 5, 7)

local SW_RAMP = Widgets.ramp({
	{ 0, 0.15, 0.15, 0.2 }, { 2, 0.2, 0.3, 0.7 }, { 4, 0.1, 0.65, 0.85 }, { 6, 0.2, 0.8, 0.3 },
	{ 8, 0.95, 0.9, 0.2 }, { 10, 1.0, 0.5, 0.1 }, { 12, 0.9, 0.1, 0.1 }, { 15, 1.0, 0.6, 0.9 },
})

local function fmtKm(m: number): string
	return string.format("%.1f", m / 1000)
end

local function clockText(t: number): string
	t = math.max(0, t)
	return string.format("%d:%02d:%02d", t // 3600, (t // 60) % 60, floor(t % 60))
end

-- slab ray / box intersection for t in [0, tmax]
local function rayBox(sx: number, sy: number, ex: number, ey: number, x0: number, x1: number, y0: number, y1: number, tmax: number): (number?, number?)
	local t0, t1 = 0, tmax
	if math.abs(ex) < 1e-9 then
		if sx < x0 or sx > x1 then
			return nil, nil
		end
	else
		local a, b = (x0 - sx) / ex, (x1 - sx) / ex
		if a > b then
			a, b = b, a
		end
		t0, t1 = math.max(t0, a), math.min(t1, b)
	end
	if math.abs(ey) < 1e-9 then
		if sy < y0 or sy > y1 then
			return nil, nil
		end
	else
		local a, b = (y0 - sy) / ey, (y1 - sy) / ey
		if a > b then
			a, b = b, a
		end
		t0, t1 = math.max(t0, a), math.min(t1, b)
	end
	if t1 <= t0 then
		return nil, nil
	end
	return t0, t1
end

function M.new(ctx)
	local self = {}
	local R = ctx.Sim.Radar
	local st = ctx.state
	local conns = {}

	---------------------------------------------------------------- UI
	local panel, uiScale = Widgets.panel(ctx.ui, "LabRadar", Widgets.RADAR_W, Widgets.RADAR_H)
	panel.ZIndex = 5
	local title = Widgets.label(panel, "Doppler radar", 12, 4, 300, 22, 15, nil, true)
	local closeBtn = Widgets.button(panel, "x", Widgets.RADAR_W - 30, 5, 22, 20, function()
		st.show.radar = false
	end)
	closeBtn.BackgroundTransparency = 0.5

	local product = "REF"
	local tiltIdx = 1
	local zoomIdx = 2
	local centreMode = "focus" -- "focus" | "site"
	local marksOn = true
	local aliasOn = false

	local productBtns = {}
	local zoomBtns = {}
	local requestRepaint -- forward
	local rebuildLegend -- forward
	local setZoom -- forward
	local placeSiteNearFocus -- forward

	local function selectProduct(p: string)
		if product ~= p then
			product = p
			for q, b in productBtns do
				Widgets.setActive(b, q == p)
			end
			rebuildLegend()
			requestRepaint()
		end
	end
	for i, p in PRODUCTS do
		productBtns[p] = Widgets.button(panel, p, 10 + (i - 1) * 50, 32, 46, 22, function()
			selectProduct(p)
		end)
	end
	Widgets.setActive(productBtns[product], true)
	local aliasBtn, marksBtn
	aliasBtn = Widgets.button(panel, "Alias", 266, 32, 54, 22, function()
		aliasOn = not aliasOn
		Widgets.setActive(aliasBtn, aliasOn)
	end)
	marksBtn = Widgets.button(panel, "Marks", 324, 32, 56, 22, function()
		marksOn = not marksOn
		Widgets.setActive(marksBtn, marksOn)
	end)
	Widgets.setActive(marksBtn, marksOn)
	Widgets.button(panel, "Site near focus", 384, 32, 106, 22, function()
		placeSiteNearFocus()
	end)

	local tiltLabel
	Widgets.button(panel, "-", 10, 60, 24, 22, function()
		tiltIdx = math.max(1, tiltIdx - 1)
	end)
	tiltLabel = Widgets.label(panel, "0.5", 36, 60, 56, 22, 13, Enum.TextXAlignment.Center, true)
	Widgets.button(panel, "+", 94, 60, 24, 22, function()
		tiltIdx = math.min(#TILTS, tiltIdx + 1)
	end)
	local vl = Widgets.label(panel, "view", 128, 60, 34, 22, 12)
	vl.TextColor3 = Widgets.DIM
	for i, z in ZOOMS do
		zoomBtns[i] = Widgets.button(panel, z.label .. " km", 162 + (i - 1) * 62, 60, 58, 22, function()
			setZoom(i)
		end)
	end
	Widgets.setActive(zoomBtns[zoomIdx], true)
	local centreBtn
	centreBtn = Widgets.button(panel, "Centre: focus", 354, 60, 136, 22, function()
		centreMode = if centreMode == "focus" then "site" else "focus"
		centreBtn.Text = "Centre: " .. centreMode
	end)

	local IMG = 480
	local holder = Instance.new("Frame")
	holder.Name = "Scope"
	holder.Position = UDim2.fromOffset(10, 88)
	holder.Size = UDim2.fromOffset(IMG, IMG)
	holder.BackgroundColor3 = Color3.fromRGB(4, 5, 7)
	holder.BorderSizePixel = 0
	holder.ClipsDescendants = true
	holder.Active = true
	holder.Parent = panel
	local canvas = Widgets.canvas(holder, N, FALLBACK_N, BG, Enum.ResamplerMode.Default)
	local n = canvas.n
	local pix = canvas.pix

	local overlay = Instance.new("Frame")
	overlay.Name = "Overlay"
	overlay.BackgroundTransparency = 1
	overlay.Size = UDim2.fromScale(1, 1)
	overlay.ZIndex = 3
	overlay.Parent = holder

	local function makeRing(parent: Instance): GuiObject
		local f = Instance.new("Frame")
		f.BackgroundTransparency = 1
		f.AnchorPoint = Vector2.new(0.5, 0.5)
		f.ZIndex = 3
		Widgets.corner(f).CornerRadius = UDim.new(0.5, 0)
		local s = Instance.new("UIStroke")
		s.Color = Color3.fromRGB(170, 180, 195)
		s.Transparency = 0.6
		s.Thickness = 1
		s.Parent = f
		f.Parent = parent
		return f
	end
	local function makeText(parent: Instance): GuiObject
		local l = Instance.new("TextLabel")
		l.BackgroundTransparency = 1
		l.AnchorPoint = Vector2.new(0.5, 0.5)
		l.Size = UDim2.fromOffset(60, 14)
		l.Font = Widgets.FONT_BOLD
		l.TextSize = 11
		l.TextColor3 = Color3.fromRGB(200, 208, 220)
		l.TextStrokeTransparency = 0.4
		l.ZIndex = 4
		l.Parent = parent
		return l
	end
	local function makeMark(parent: Instance): GuiObject
		local f = Instance.new("Frame")
		f.BackgroundTransparency = 1
		f.AnchorPoint = Vector2.new(0.5, 0.5)
		f.Size = UDim2.fromOffset(12, 12)
		f.ZIndex = 4
		Widgets.corner(f).CornerRadius = UDim.new(0.5, 0)
		local s = Instance.new("UIStroke")
		s.Color = Color3.new(1, 1, 1)
		s.Thickness = 1.5
		s.Parent = f
		f.Parent = parent
		return f
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
		l.TextStrokeTransparency = 0.2
		l.ZIndex = 5
		l.Parent = parent
		return l
	end
	local ringPool = Widgets.pool(overlay, makeRing)
	local ringText = Widgets.pool(overlay, makeText)
	local markPool = Widgets.pool(overlay, makeMark)
	local markText = Widgets.pool(overlay, makeText)
	local triPool = Widgets.pool(overlay, makeTri)

	local sweepLine = Instance.new("Frame")
	sweepLine.BorderSizePixel = 0
	sweepLine.BackgroundColor3 = Color3.fromRGB(120, 255, 160)
	sweepLine.BackgroundTransparency = 0.25
	sweepLine.ZIndex = 4
	sweepLine.Visible = false
	sweepLine.Parent = overlay
	local siteMark = Instance.new("Frame")
	siteMark.AnchorPoint = Vector2.new(0.5, 0.5)
	siteMark.Size = UDim2.fromOffset(7, 7)
	siteMark.BackgroundColor3 = Color3.fromRGB(80, 230, 255)
	siteMark.BorderSizePixel = 0
	siteMark.ZIndex = 5
	siteMark.Visible = false
	siteMark.Parent = overlay

	local north = Widgets.label(holder, "N\n\u{2191}", IMG - 26, 6, 20, 30, 13, Enum.TextXAlignment.Center, true)
	north.ZIndex = 6
	north.TextStrokeTransparency = 0.3
	north.TextWrapped = true
	local status = Widgets.label(holder, "", 6, 4, IMG - 40, 16, 12, nil, true)
	status.ZIndex = 6
	status.TextStrokeTransparency = 0.3
	local status2 = Widgets.label(holder, "", 6, 20, IMG - 40, 14, 11)
	status2.ZIndex = 6
	status2.TextStrokeTransparency = 0.3
	status2.TextColor3 = Widgets.DIM
	local readBar = Instance.new("Frame")
	readBar.BackgroundColor3 = Color3.new(0, 0, 0)
	readBar.BackgroundTransparency = 0.35
	readBar.BorderSizePixel = 0
	readBar.Position = UDim2.new(0, 0, 1, -34)
	readBar.Size = UDim2.new(1, 0, 0, 34)
	readBar.ZIndex = 6
	readBar.Visible = false
	readBar.Parent = holder
	local read1 = Widgets.label(readBar, "", 6, 1, IMG - 12, 16, 13, nil, true)
	read1.ZIndex = 7
	local read2 = Widgets.label(readBar, "", 6, 17, IMG - 12, 15, 12)
	read2.ZIndex = 7
	read2.TextColor3 = Widgets.DIM

	local legendHolder = nil
	rebuildLegend = function()
		local fn, vmin, vmax, ticks, fmt, unit
		if product == "REF" then
			fn, vmin, vmax, ticks, unit = R.refColour, -10, 75, { 0, 20, 40, 60, 75 }, "dBZ"
			fmt = function(v)
				return tostring(v)
			end
		elseif product == "VEL" or product == "SRV" then
			fn = function(v)
				return R.velColour(v, VEL_SCALE)
			end
			vmin, vmax, ticks, unit = -VEL_SCALE, VEL_SCALE, { -30, -15, 0, 15, 30 }, "m/s"
			fmt = function(v)
				return tostring(v)
			end
		elseif product == "CC" then
			fn, vmin, vmax, ticks, unit = R.ccColour, 0.2, 1.0, { 0.2, 0.4, 0.6, 0.8, 0.95 }, "CC"
			fmt = function(v)
				return string.format("%.2f", v)
			end
		else
			fn, vmin, vmax, ticks, unit = SW_RAMP, 0, 15, { 0, 4, 8, 12 }, "m/s"
			fmt = function(v)
				return tostring(v)
			end
		end
		legendHolder = Widgets.legend(panel, 10, Widgets.RADAR_H - 34, IMG, 12, fn, vmin, vmax, ticks, fmt, unit, legendHolder)
	end
	rebuildLegend()

	---------------------------------------------------------------- state
	local site = nil -- Radar.site
	local siteKey = nil -- the ctx.state.radarSite table this site came from
	local store, prev = nil, nil -- polar gate stores (current scan, the one it replaces)
	local sweep = { ai = 1, rad = nil, g = 0 }
	local repaint = nil -- { stores, si, ai }
	local view = { cx = 0, cy = 0, half = 0, set = false }
	local x0v, y1v, mpp = 0, 0, 1 -- view left, top, metres per pixel
	local startClock = os.clock()
	local smU, smV = 0, 0 -- focus storm motion (SRV)
	local markAt = 0
	local fX, fY, fKind, fId = 0, 0, "none", nil

	local rctx = { vol = nil, tornadoes = {}, coldPool = nil, freezing = 4000 }
	rctx.wind = function(x: number, y: number, z: number)
		return ctx.cw:windAt(x, y, z)
	end

	local function newStore(s): any
		local z = ZOOMS[zoomIdx]
		return { site = s, dr = z.dr, da = z.da, NA = math.floor(360 / z.da + 0.5), radials = {}, scan = 0, started = ctx:simTime() }
	end

	-- keep the sweep's angle continuous when the store (gate spacing) changes
	local function sweepAngle(): number
		if store then
			return (sweep.ai - 1) * store.da
		end
		return 0
	end
	local function resetSweep(angle: number)
		sweep.rad = nil
		if store then
			sweep.ai = math.clamp(math.floor(angle / store.da) + 1, 1, store.NA)
		end
	end

	-- paint one polar cell (radial ai, gate g of store S) with packed colour col
	local function paintCell(S, ai: number, g: number, col: number)
		local s = S.site
		local da, dr = S.da, S.dr
		local a0, a1 = rad((ai - 1) * da), rad(ai * da)
		local r0, r1 = (g - 1) * dr, g * dr
		local am = (a0 + a1) * 0.5
		local sa0, ca0, sa1, ca1, sam, cam = sin(a0), cos(a0), sin(a1), cos(a1), sin(am), cos(am)
		local minx = math.min(sa0 * r0, sa1 * r0, sa0 * r1, sa1 * r1, sam * r1)
		local maxx = math.max(sa0 * r0, sa1 * r0, sa0 * r1, sa1 * r1, sam * r1)
		local miny = math.min(ca0 * r0, ca1 * r0, ca0 * r1, ca1 * r1, cam * r1)
		local maxy = math.max(ca0 * r0, ca1 * r0, ca0 * r1, ca1 * r1, cam * r1)
		local px0 = math.max(0, floor((s.x + minx - x0v) / mpp - 0.5))
		local px1 = math.min(n - 1, floor((s.x + maxx - x0v) / mpp + 0.5))
		local py0 = math.max(0, floor((y1v - (s.y + maxy)) / mpp - 0.5))
		local py1 = math.min(n - 1, floor((y1v - (s.y + miny)) / mpp + 0.5))
		if px0 > px1 or py0 > py1 then
			return
		end
		local r0s, r1s = r0 * r0, r1 * r1
		local bx = x0v - s.x
		for py = py0, py1 do
			local y = y1v - (py + 0.5) * mpp - s.y
			local base = py * n
			local hit = false
			for px = px0, px1 do
				local x = bx + (px + 0.5) * mpp
				local r2 = x * x + y * y
				if r2 >= r0s and r2 < r1s then
					local az = atan2(x, y)
					if az < 0 then
						az += TWO_PI
					end
					if az >= a0 and az < a1 then
						buffer.writeu32(pix, (base + px) * 4, col)
						hit = true
					end
				end
			end
			if hit then
				canvas:markRow(py)
			end
		end
	end

	local function fold(v: number, vn: number): number
		return (v + vn) % (2 * vn) - vn
	end

	local function gateValue(rd, k: number): number?
		local dbz = rd.dbz[k]
		if not dbz or dbz <= -900 then
			return nil
		end
		if product == "REF" then
			return dbz
		elseif product == "VEL" then
			return rd.vr[k]
		elseif product == "SRV" then
			local v = rd.vr[k] - (smU * rd.ex + smV * rd.ey) * rd.ce
			if rd.nyq > 0 then
				v = fold(v, rd.nyq)
			end
			return v
		elseif product == "CC" then
			return rd.cc[k]
		end
		return rd.sw[k]
	end

	local function gateColour(rd, k: number): number
		local v = gateValue(rd, k)
		if not v then
			return BG
		end
		local r, g, b
		if product == "REF" then
			r, g, b = R.refColour(v)
		elseif product == "VEL" or product == "SRV" then
			r, g, b = R.velColour(v, VEL_SCALE)
		elseif product == "CC" then
			r, g, b = R.ccColour(v)
		else
			r, g, b = SW_RAMP(v)
		end
		return Widgets.pack01(r, g, b)
	end

	requestRepaint = function()
		canvas:clear()
		-- outside the maximum range: darker
		local s = if store then store.site else site
		local far = 0
		if s then
			local fx = math.abs(s.x - view.cx) + view.half
			local fy = math.abs(s.y - view.cy) + view.half
			far = fx * fx + fy * fy
		end
		if s and far > MAX_RANGE * MAX_RANGE then
			local lim = MAX_RANGE * MAX_RANGE
			for py = 0, n - 1 do
				local y = y1v - (py + 0.5) * mpp - s.y
				local base = py * n
				for px = 0, n - 1 do
					local x = x0v + (px + 0.5) * mpp - s.x
					if x * x + y * y > lim then
						buffer.writeu32(pix, (base + px) * 4, BG_OUT)
					end
				end
			end
		end
		local list = {}
		if prev then
			table.insert(list, prev)
		end
		if store then
			table.insert(list, store)
		end
		repaint = { stores = list, si = 1, ai = 1 }
	end

	local function repaintStep(budgetEnd: number)
		local job = repaint
		while os.clock() < budgetEnd do
			local S = job.stores[job.si]
			if not S then
				repaint = nil
				canvas:markAll()
				return
			end
			local rd = S.radials[job.ai]
			if rd then
				for k = 1, rd.gB - rd.g0 + 1 do
					local c = gateColour(rd, k)
					if c ~= BG or S == store then
						paintCell(S, job.ai, rd.g0 + k - 1, c)
					end
				end
			end
			job.ai += 1
			if job.ai > S.NA then
				job.si += 1
				job.ai = 1
			end
		end
	end

	local function setView(cx: number, cy: number, half: number)
		view.cx, view.cy, view.half, view.set = cx, cy, half, true
		mpp = 2 * half / n
		x0v = cx - half
		y1v = cy + half
		requestRepaint()
	end

	local function resite(x: number, y: number)
		local angle = sweepAngle()
		site = R.site(x, y, { nyquist = 0, maxRange = MAX_RANGE, beamwidth = 0.95 })
		prev = store
		store = newStore(site)
		resetSweep(angle)
		if view.set and centreMode == "site" then
			setView(x, y, ZOOMS[zoomIdx].half)
		elseif view.set then
			requestRepaint()
		end
	end

	placeSiteNearFocus = function()
		local fx, fy = ctx:focus()
		local b = rad(225)
		local t = { x = fx + sin(b) * SITE_DIST, y = fy + cos(b) * SITE_DIST }
		st.radarSite = t
		siteKey = t
		resite(t.x, t.y)
	end

	setZoom = function(i: number)
		if i == zoomIdx then
			return
		end
		local angle = sweepAngle()
		zoomIdx = i
		for k, b in zoomBtns do
			Widgets.setActive(b, k == i)
		end
		if site then
			prev = store
			store = newStore(site)
			resetSweep(angle)
		end
		view.set = false -- the next frame sets the view and repaints
	end

	-- sample and paint gates until the budget or the rotation limit is used up
	local function sweepStep(budgetEnd: number, maxDeg: number)
		local S = store
		local adv = 0
		local h = view.half + 2 * mpp
		local bx0, bx1, by0, by1 = view.cx - h, view.cx + h, view.cy - h, view.cy + h
		local s = S.site
		while os.clock() < budgetEnd do
			local rd = sweep.rad
			if not rd then
				if adv >= maxDeg then
					break
				end
				local ai = sweep.ai
				local az = (ai - 0.5) * S.da
				local ar = rad(az)
				local ex, ey = sin(ar), cos(ar)
				local t0, t1 = rayBox(s.x, s.y, ex, ey, bx0, bx1, by0, by1, MAX_RANGE)
				if t0 and t1 then
					local gA = math.max(1, floor(t0 / S.dr) + 1)
					local gB = math.min(floor(MAX_RANGE / S.dr), floor(t1 / S.dr) + 1)
					if gB >= gA then
						local cnt = gB - gA + 1
						local e = TILTS[tiltIdx]
						rd = {
							g0 = gA, gB = gB, ex = ex, ey = ey, az = az, elev = e, ce = cos(rad(e)), t = ctx:simTime(),
							nyq = s.nyquist,
							dbz = table.create(cnt, -999), vr = table.create(cnt, 0), cc = table.create(cnt, 0), sw = table.create(cnt, 0),
						}
						S.radials[ai] = rd
						sweep.rad = rd
						sweep.g = gA
					end
				end
				if not sweep.rad then
					adv += S.da
					sweep.ai += 1
					if sweep.ai > S.NA then
						sweep.ai = 1
						S.scan += 1
						S.started = ctx:simTime()
						prev = nil
					end
				end
			else
				local g = sweep.g
				local ground = (g - 0.5) * S.dr
				local dbz, vr, cc, sw = R.gate(s, rctx, rd.az, ground / rd.ce, rd.elev, S.scan)
				local k = g - rd.g0 + 1
				if dbz then
					rd.dbz[k], rd.vr[k], rd.cc[k], rd.sw[k] = dbz, vr, cc, sw
				end
				paintCell(S, sweep.ai, g, gateColour(rd, k))
				g += 1
				if g > rd.gB then
					sweep.rad = nil
					adv += S.da
					sweep.ai += 1
					if sweep.ai > S.NA then
						sweep.ai = 1
						S.scan += 1
						S.started = ctx:simTime()
						prev = nil
					end
				else
					sweep.g = g
				end
			end
		end
	end

	-- sim (x, y) -> overlay scale coordinates
	local function toScale(x: number, y: number): (number, number)
		return (x - x0v) / (2 * view.half), (y1v - y) / (2 * view.half)
	end

	local function drawOverlays()
		ringPool:begin()
		ringText:begin()
		markPool:begin()
		markText:begin()
		triPool:begin()
		if site and view.set then
			local z = ZOOMS[zoomIdx]
			local sx, sy = toScale(site.x, site.y)
			siteMark.Visible = sx > -0.02 and sx < 1.02 and sy > -0.02 and sy < 1.02
			siteMark.Position = UDim2.fromScale(sx, sy)
			-- rings that cross the view
			local dx = math.max(0, math.abs(site.x - view.cx) - view.half)
			local dy = math.max(0, math.abs(site.y - view.cy) - view.half)
			local dmin = sqrt(dx * dx + dy * dy)
			local fx = math.abs(site.x - view.cx) + view.half
			local fy = math.abs(site.y - view.cy) + view.half
			local dmax = sqrt(fx * fx + fy * fy)
			local r = z.ring
			local count = 0
			while r <= MAX_RANGE and count < 24 do
				if r >= dmin and r <= dmax then
					local f = ringPool:take()
					local d = r / view.half -- diameter in scale units: 2r / (2 half)
					f.Position = UDim2.fromScale(sx, sy)
					f.Size = UDim2.fromScale(d, d)
					-- label where the ring is inside the view: try north, east, south, west
					for _, a in { 0, 90, 180, 270, 45, 135, 225, 315 } do
						local lx, ly = toScale(site.x + sin(rad(a)) * r, site.y + cos(rad(a)) * r)
						if lx > 0.04 and lx < 0.96 and ly > 0.08 and ly < 0.92 then
							local l = ringText:take()
							l.Text = string.format("%d km", r // 1000)
							l.Position = UDim2.fromScale(lx, ly)
							l.TextColor3 = Color3.fromRGB(170, 180, 195)
							break
						end
					end
				end
				r += z.ring
				count += 1
			end
		else
			siteMark.Visible = false
		end
		if marksOn and view.set then
			local cw = ctx.cw
			for _, s in cw.storms do
				if not s.dead then
					local mx, my = toScale(s.x, s.y)
					if mx > 0 and mx < 1 and my > 0 and my < 1 then
						local f = markPool:take()
						local sz = math.clamp(6 + (s.W or 0) / 6, 7, 16)
						f.Size = UDim2.fromOffset(sz, sz)
						f.Position = UDim2.fromScale(mx, my)
						local stroke = f:FindFirstChildOfClass("UIStroke")
						if stroke then
							stroke.Color = if (s.rot or 0) > 0.5 then Color3.fromRGB(255, 120, 255) else Color3.new(1, 1, 1)
						end
						local l = markText:take()
						l.Text = tostring(s.id)
						l.Position = UDim2.new(mx, 0, my, -sz * 0.5 - 7)
						l.TextColor3 = Color3.new(1, 1, 1)
					end
				end
			end
			for _, t in cw.tornadoes do
				if not t.ended then
					local mx, my = toScale(t.x, t.y)
					if mx > 0 and mx < 1 and my > 0 and my < 1 then
						local l = triPool:take()
						l.Position = UDim2.fromScale(mx, my)
					end
				end
			end
		end
		ringPool:finish()
		ringText:finish()
		markPool:finish()
		markText:finish()
		triPool:finish()
	end

	local function drawSweepLine()
		if not (site and store and view.set) then
			sweepLine.Visible = false
			return
		end
		local az = rad((sweep.ai - 0.5) * store.da)
		local ex, ey = sin(az), cos(az)
		local h = view.half
		local t0, t1 = rayBox(site.x, site.y, ex, ey, view.cx - h, view.cx + h, view.cy - h, view.cy + h, MAX_RANGE)
		if not (t0 and t1) then
			sweepLine.Visible = false
			return
		end
		local ax, ay = toScale(site.x + ex * t0, site.y + ey * t0)
		local bx, by = toScale(site.x + ex * t1, site.y + ey * t1)
		Widgets.placeLine(sweepLine, ax, ay, bx, by, 2)
		sweepLine.Visible = true
	end

	-- the stored gate under a sim point (current scan first)
	local function gateAt(x: number, y: number)
		for _, S in { store, prev } do
			if S then
				local dx, dy = x - S.site.x, y - S.site.y
				local r = sqrt(dx * dx + dy * dy)
				local az = math.deg(atan2(dx, dy)) % 360
				local ai = floor(az / S.da) + 1
				local g = floor(r / S.dr) + 1
				local rd = S.radials[ai]
				if rd and g >= rd.g0 and g <= rd.gB then
					return rd, g - rd.g0 + 1, S
				end
			end
		end
		return nil
	end

	local function updateReadout()
		local mouse = UserInputService:GetMouseLocation()
		local p, sz = holder.AbsolutePosition, holder.AbsoluteSize
		local u, v = (mouse.X - p.X) / sz.X, (mouse.Y - p.Y) / sz.Y
		if not (site and view.set) or u < 0 or u > 1 or v < 0 or v > 1 then
			readBar.Visible = false
			return
		end
		readBar.Visible = true
		local x = x0v + u * 2 * view.half
		local y = y1v - v * 2 * view.half
		local dx, dy = x - site.x, y - site.y
		local ground = sqrt(dx * dx + dy * dy)
		local az = math.deg(atan2(dx, dy)) % 360
		local rd, k = gateAt(x, y)
		local e = if rd then rd.elev else TILTS[tiltIdx]
		local beam = R.beamHeight(ground / cos(rad(e)), e) + site.height
		local valText = "no echo"
		if rd and k then
			local val = gateValue(rd, k)
			if val then
				if product == "REF" then
					valText = string.format("%.1f dBZ", val)
				elseif product == "VEL" or product == "SRV" then
					valText = string.format("%+.1f m/s %s (%+.0f kt)", val, if val < 0 then "inbound" else "outbound", val * 1.944)
				elseif product == "CC" then
					valText = string.format("CC %.3f", val)
				else
					valText = string.format("SW %.1f m/s", val)
				end
			end
		elseif ground > MAX_RANGE then
			valText = "beyond range"
		else
			valText = "not scanned"
		end
		read1.Text = string.format("%s  %s", product, valText)
		read2.Text = string.format("%s km @ %03d\u{00B0}   beam %d m AGL (%.1f\u{00B0})   x %s  y %s km", fmtKm(ground), floor(az + 0.5) % 360, floor(beam), e, fmtKm(x), fmtKm(y))
	end

	-- the focus storm's motion (SRV) and freezing level
	local function focusStorm()
		local cw = ctx.cw
		local sid = nil
		if fKind == "storm" then
			sid = fId
		elseif fKind == "tornado" then
			for _, t in cw.tornadoes do
				if t.id == fId then
					sid = t.parentId
					if not sid then
						smU, smV = t.ut or 0, t.vt or 0
					end
					break
				end
			end
		end
		if sid then
			for _, s in cw.storms do
				if s.id == sid then
					return s
				end
			end
		end
		-- nearest live storm to the focus point
		local best, bd = nil, math.huge
		for _, s in cw.storms do
			if not s.dead then
				local d = (s.x - fX) ^ 2 + (s.y - fY) ^ 2
				if d < bd then
					best, bd = s, d
				end
			end
		end
		return best
	end

	local function applyLayout()
		local s, right = Widgets.layout(true, st.show.map == true)
		uiScale.Scale = s
		panel.Position = UDim2.new(1, -right, 0, Widgets.GAP)
	end

	---------------------------------------------------------------- input / signals
	table.insert(conns, UserInputService.InputBegan:Connect(function(input, gp)
		if gp or UserInputService:GetFocusedTextBox() then
			return
		end
		if input.KeyCode == Enum.KeyCode.R then
			st.show.radar = not st.show.radar
		elseif st.show.radar == true then
			-- (while it is open) V: next product, N: site near the focus, Z: next zoom
			if input.KeyCode == Enum.KeyCode.V then
				local i = table.find(PRODUCTS, product) or 1
				selectProduct(PRODUCTS[i % #PRODUCTS + 1])
			elseif input.KeyCode == Enum.KeyCode.N then
				placeSiteNearFocus()
			elseif input.KeyCode == Enum.KeyCode.Z then
				setZoom(zoomIdx % #ZOOMS + 1)
			end
		end
	end))
	table.insert(conns, ctx.signals.scenario:Connect(function()
		store, prev, site, siteKey, repaint = nil, nil, nil, nil, nil
		st.radarSite = nil
		view.set = false
		startClock = os.clock()
		canvas:clear()
	end))

	---------------------------------------------------------------- frame
	function self:update(dt: number)
		local show = st.show.radar == true
		panel.Visible = show
		local cw = ctx.cw
		fX, fY, fKind, fId = ctx:focus()

		-- the site: from ctx.state.radarSite (the map, or our button), else chosen once near the
		-- focus (also while hidden, so the map can show it; no sampling happens while hidden)
		local want = st.radarSite
		if want and type(want) == "table" and want.x and want.y then
			if want ~= siteKey or not site or want.x ~= site.x or want.y ~= site.y then
				siteKey = want
				resite(want.x, want.y)
			end
		elseif not site then
			if fKind ~= "none" or os.clock() - startClock > 8 then
				placeSiteNearFocus()
			end
		end
		if not show then
			return
		end
		applyLayout()
		if not site then
			status.Text = "Waiting for the storm state..."
			return
		end
		site.nyquist = if aliasOn then NYQUIST else 0

		-- the view: centred on the focus (re-centred once it drifts) or on the site
		local z = ZOOMS[zoomIdx]
		local cx, cy = fX, fY
		if centreMode == "site" then
			cx, cy = site.x, site.y
		end
		if not view.set or view.half ~= z.half then
			setView(cx, cy, z.half)
		else
			local drift = math.max(math.abs(cx - view.cx), math.abs(cy - view.cy))
			if drift > (if centreMode == "site" then 1 else 0.15 * z.half) then
				setView(cx, cy, z.half)
			end
		end

		local fs = focusStorm()
		if fs then
			smU, smV = fs.u or 0, fs.v or 0
		end
		rctx.vol = cw.volFull or cw.vol -- (the full volume when one has come)
		rctx.tornadoes = cw.tornadoes
		rctx.coldPool = cw.coldPool
		local fz = if fs then fs.freezing else nil
		if not fz or fz <= 0 then
			local fg = cw.env and cw.env.fields and cw.env.fields.freezing
			fz = if fg then fg:sample(fX, fY) else 0
		end
		rctx.freezing = if fz and fz > 500 then fz else 4000

		local t0 = os.clock()
		if repaint then
			repaintStep(t0 + REPAINT_BUDGET)
			if not repaint then
				canvas:flush()
			end
		elseif store and cw.vol then
			sweepStep(t0 + GATE_BUDGET, math.max(0.5, dt * 360 / ROTATION_S))
			canvas:flush(os.clock() + 0.001)
		end

		drawSweepLine()
		if os.clock() - markAt > 0.2 then
			markAt = os.clock()
			drawOverlays()
		end
		updateReadout()
		local S = store
		tiltLabel.Text = string.format("%.1f\u{00B0}", TILTS[tiltIdx])
		if S then
			local fdx, fdy = fX - site.x, fY - site.y
			status.Text = string.format("%s  %.1f\u{00B0}  scan %d  started %s%s", product, TILTS[tiltIdx], S.scan + 1, clockText(S.started), if aliasOn then string.format("  Nyquist %d m/s", NYQUIST) else "")
			status2.Text = string.format("site x %s y %s km   focus %s km @ %03d\u{00B0}%s   az %03d\u{00B0}", fmtKm(site.x), fmtKm(site.y), fmtKm(sqrt(fdx * fdx + fdy * fdy)), floor(math.deg(atan2(fdx, fdy)) % 360 + 0.5) % 360, if product == "SRV" then string.format("   motion %.0f/%.0f m/s", smU, smV) else "", floor((sweep.ai - 0.5) * S.da) % 360)
		end
		title.Text = if canvas.ok then "Doppler radar" else "Doppler radar (coarse)"
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
