--!nonstrict
-- Distant rain shafts and precipitation curtains, drawn from the precipitation FIELD (cw.vol, the
-- replicated 1 km surface rain / hail columns), not from the cloud: the clear inflow region and the
-- RFD slot stay clear wherever the field has no rain.
--   binning   every rainy column (> 0.5 mm/h) goes into a 4 km cell (2 km within 14 km of the
--             camera, the field's 1 km columns within 4 km of a tornado); a cell with rain becomes one shaft at the rain-weighted centroid of its
--             columns, as wide as the rainy share of the cell
--   opacity   from the cell's mean rain rate (log), less with distance haze
--   colour    rain grey, whiter with hail (cm), brighter when the sun is behind the shaft
--             (forward scattering), hazed by true distance
--   height    ground to the nearest storm's cloud base
--   motion    each shaft moves with its nearest storm from the time the field arrived
-- Billboards (like the storm cards): a curtain (LabConfig.TEXTURES.rainShaft) that fades in from
-- its top and frays near the ground (UIGradient), capped by a lumpy dark card of the rain cloud it
-- falls from - forward-flank rain far from the base falls from a ragged deck, not from clear sky.
-- Each shaft is drawn whole about its own column (x, y) at that column's scale (LabConfig.scaleAbout:
-- its height, width and cap at k). Pooled; positions moved every frame (each shaft drifts with its storm). Only changes that show
-- (half a pixel, 1/500 in colour or opacity) are written, and a shaft off screen keeps only its
-- position roughly current.
-- Beams (LabConfig.RAIN_BEAMS, 2026-11-10): the curtain is drawn as perShaft camera-facing Beams
-- instead of its billboard, spread through the shaft's depth (fixed in the world, so orbiting shows
-- parallax, not one flat card), hung from the cloud base upwind to the rain's own column on the
-- ground (the drops drift with the storm-relative wind as they fall), their texture scrolling down
-- at the fall speed. Hail adds hailPerShaft narrower, paler ribbons in the core, as opaque as the
-- hail's share of the rain; the rain ribbons thin where hail takes over. A Beam never turns edge-on
-- (FaceCamera) and keeps its texture's aspect along its length (Wrap), so nothing stretches. The rain
-- cloud cap stays a card.
-- Near only (2026-11-10): Beams are parts, drawn only within LIMITS.partRange, and pulled in from
-- farther they sorted in front of every storm card beyond them (a grey wall over the tornado). So a
-- shaft takes Beams only where its true place is in range (bS: 1 inside 3/4 of the range, 0 past
-- it), the card the rest; the card still fades out as you drive in (near), the Beams stay until
-- you are at the shaft's edge (nearB) - a curtain you drive up to and into - and inside it the
-- rain is the Atmosphere fog (Render/NearPrecip).
local Workspace = game:GetService("Workspace")

local Util = require(script.Parent:WaitForChild("Util"))

local Shafts = {}
Shafts.__index = Shafts

-- (workspace attribute RainBeams=false: the billboard curtains; read at most twice a second;
-- Scroll Lock flips it on this client, in Studio only)
local beamLive, beamAt, beamKey = true, -1, false
local function beamsOn(ctx: any): any
	local RB = ctx.Config.RAIN_BEAMS
	if not RB or RB.enabled == false then
		return nil
	end
	if not beamKey and game:GetService("RunService"):IsStudio() then
		beamKey = true
		game:GetService("UserInputService").InputBegan:Connect(function(input, processed)
			if not processed and input.KeyCode == Enum.KeyCode.ScrollLock then
				local on = Workspace:GetAttribute("RainBeams") ~= false
				Workspace:SetAttribute("RainBeams", not on)
				beamAt = -1
				print("[Shafts] rain beams", if on then "off" else "on")
			end
		end)
	end
	local t = os.clock()
	if t - beamAt > 0.5 then
		beamAt = t
		beamLive = Workspace:GetAttribute("RainBeams") ~= false
	end
	return if beamLive then RB else nil
end

local function ribbon(anchor: BasePart, image: string): any
	local a0, a1 = Instance.new("Attachment"), Instance.new("Attachment")
	a0.Parent, a1.Parent = anchor, anchor
	local b = Instance.new("Beam")
	b.Attachment0, b.Attachment1 = a0, a1
	b.FaceCamera = true
	b.LightInfluence = 0
	b.LightEmission = 0
	b.Brightness = 1
	-- (straight, but the fade along the length - profile - is sampled at the segment vertices only:
	-- with one segment it was read at the two ends, both fully clear, and no ribbon drew, 2026-11-10)
	b.Segments = 12
	b.Texture = image
	b.TextureMode = Enum.TextureMode.Wrap
	b.Transparency = NumberSequence.new(1)
	b.Enabled = false
	b.Parent = anchor
	return { a0 = a0, a1 = a1, b = b }
end

-- the ribbons' fade along their length (0 = the cloud base, 1 = the ground): in from the base over
-- its first 20 % (at 8 % the ribbon's top read as a hard line across the base from close by,
-- 2026-11-10), full almost to the ground, a little thinner at the foot (a wrapped texture has no
-- ends). (Feathered from 70 % to nothing, the lower third - the part seen against the bright sky
-- under the base, from the horizon up - was gone and the shafts did not show at all, 2026-11-10)
local function profile(a: number): NumberSequence
	return NumberSequence.new({
		NumberSequenceKeypoint.new(0, 1),
		NumberSequenceKeypoint.new(0.1, 1 - 0.4 * a),
		NumberSequenceKeypoint.new(0.2, 1 - a),
		NumberSequenceKeypoint.new(0.92, 1 - a),
		NumberSequenceKeypoint.new(1, 1 - 0.6 * a),
	})
end

-- one layer's opacity so that n overlapping layers of the texture (~0.85 opaque in its middle) add
-- up to the shaft's opacity a
local function layerA(a: number, n: number): number
	if a <= 0 then
		return 0
	end
	return math.clamp((1 - (1 - math.min(a, 0.98)) ^ (1 / math.max(0.7 * n, 1))) / 0.85, 0, 1)
end

local RIB_W = 0.35 -- a rain ribbon's width over the shaft's

local function setRibbons(set: any, on: boolean)
	for _, r in set or {} do
		if r.b.Enabled ~= on then
			r.b.Enabled = on
		end
	end
end

local MAX_SHAFTS = 90 -- (nearest first; each shaft is two billboards)
local NEAR_FINE = 14000
local PARK = CFrame.new(0, -200000, 0)
local MARGIN = 0.1 -- rad beyond the view's half-diagonal before a shaft counts as off screen
local CULL_REFRESH = 8 -- an off-screen shaft's position is still moved every 8th frame (staggered)

function Shafts.new(ctx: any)
	local self = setmetatable({
		ctx = ctx,
		folder = Instance.new("Folder"),
		parts = {}, -- pooled { part, tex, lastSize, lastCol, lastT }
		list = {}, -- planned shafts
		t0 = 0,
		binnedAt = -math.huge,
		binCam = Vector3.zero,
		dirty = true,
		count = 0,
	}, Shafts)
	self.folder.Name = "RainShafts"
	self.folder.Parent = ctx.root
	return self
end

local function card(anchor: BasePart, image: string): (Attachment, BillboardGui, ImageLabel)
	local att = Instance.new("Attachment")
	att.Parent = anchor
	local bb = Instance.new("BillboardGui")
	bb.Adornee = att
	bb.LightInfluence = 0
	bb.Size = UDim2.fromScale(100, 100)
	bb.Enabled = false
	bb.ResetOnSpawn = false
	-- (a turned curtain must not be cut by its box: clipped, its sides were ruler-straight slabs,
	-- 2026-11-08; the box is sized to the turned image, which keeps its own size, centred)
	bb.ClipsDescendants = false
	local img = Instance.new("ImageLabel")
	img.BackgroundTransparency = 1
	img.AnchorPoint = Vector2.new(0.5, 0.5)
	img.Position = UDim2.fromScale(0.5, 0.5)
	img.Size = UDim2.fromScale(1, 1)
	img.Image = image
	img.ImageTransparency = 1
	img.Parent = bb
	bb.Parent = anchor
	return att, bb, img
end

local function newShaft(self: any): any
	if not self.anchor then
		local a = Instance.new("Part")
		a.Name = "ShaftAnchor"
		a.Anchored, a.CanCollide, a.CanQuery, a.CanTouch = true, false, false, false
		a.Transparency = 1
		a.Size = Vector3.one
		a.CFrame = CFrame.new()
		a.Parent = self.folder
		self.anchor = a
	end
	local T = self.ctx.Config.TEXTURES
	-- the curtain: one soft puff of the 4 x 4 sheet stretched into a column (soft all round, no
	-- streaks: a curtain of rain reads as a grey veil, not as drops), solid from just below the
	-- cloud, thinning toward the ground
	-- (the purpose-made curtain sheet, tools/smoke/storm_sheets.py, once uploaded: fibres, soft
	-- sides and top, a feathered foot - it needs no gradient)
	local curtain = T.curtainFlat ~= nil and T.curtainFlat ~= ""
	local att, bb, img = card(self.anchor, if curtain then T.curtainFlat else T.softSheetFlat)
	img.ImageRectSize = Vector2.new(256, 256)
	if not curtain then
		local g = Instance.new("UIGradient")
		g.Rotation = 90
		g.Transparency = NumberSequence.new({
			NumberSequenceKeypoint.new(0, 0.6),
			NumberSequenceKeypoint.new(0.2, 0),
			NumberSequenceKeypoint.new(0.75, 0),
			NumberSequenceKeypoint.new(1, 0.3),
		})
		g.Parent = img
	end
	local catt, cbb, cimg = card(self.anchor, T.lumpyFlat)
	cimg.ImageRectSize = Vector2.new(256, 256)
	return { att = att, bb = bb, img = img, catt = catt, cbb = cbb, cimg = cimg, on = false }
end

-- the ribbons' anchor: in a folder directly under Workspace (not ctx.root, under the camera:
-- Beams there did not draw, 2026-11-10, while the billboards beside them did)
function Shafts:beamAnchor(): BasePart
	if not self.banchor then
		local f = Instance.new("Folder")
		f.Name = "RainBeams"
		f.Parent = Workspace
		local a = Instance.new("Part")
		a.Name = "BeamAnchor"
		a.Anchored, a.CanCollide, a.CanQuery, a.CanTouch = true, false, false, false
		a.Transparency = 1
		a.Size = Vector3.one
		a.CFrame = CFrame.new()
		a.Parent = f
		self.bfolder, self.banchor = f, a
	end
	return self.banchor
end

-- the shaft's ribbons: placed (top upwind at the cloud base, foot on the rain's column), sized and,
-- when look is given, coloured and faded. thr: the studs a move must exceed to be written
function Shafts:ribbons(p: any, sh: any, RB: any, x: number, y: number, gz: number, acx: number, acy: number, k: number, thr: number, look: any?)
	local C = self.ctx.Config
	local T = RB
	if not p.rb then
		p.rb, p.hb = {}, {}
		for _ = 1, T.perShaft do
			table.insert(p.rb, ribbon(self:beamAnchor(), T.rain))
		end
		for _ = 1, T.hailPerShaft do
			table.insert(p.hb, ribbon(self:beamAnchor(), T.hail))
		end
	end
	local hh = math.max(sh.h - gz, 50)
	-- the drift: the storm-relative wind over the fall time (hail falls faster: less drift), so the
	-- shaft leans downwind from its base; at most ~35 degrees
	local fall = 7 + 8 * sh.hail
	local tf = hh / fall
	local dx, dy = (sh.su or 0) * tf, (sh.sv or 0) * tf
	local dl = math.sqrt(dx * dx + dy * dy)
	local maxD = 0.7 * hh
	if dl > maxD then
		dx, dy = dx * maxD / dl, dy * maxD / dl
	end
	-- (Beams are parts: Roblox draws them only within LIMITS.partRange of the camera, and the
	-- Atmosphere hazes them as it does the terrain - a shaft 13k studs out drew nothing, 2026-11-10.
	-- So, as the bolts and mesh bodies, a far shaft is drawn as a copy pulled toward the camera: every
	-- point at cam + (P - cam) * pk, widths and texture lengths by pk too - the same angular size,
	-- direction and fall - with its farthest point at LIMITS.farDraw; its true-distance haze is in its
	-- colour already)
	-- (no longer pulled: draw() gives a shaft Beams only within the part range, at its true place)
	local pk = 1
	local function pulled(P: Vector3): Vector3
		return P
	end
	local function place(set: any, ring: number, widthK: number, phase: number)
		local n = #set
		for i, r in set do
			-- (fixed in the world round the column: alternate layers nearer and farther out)
			local th = phase + 2 * math.pi * (i - 1) / n
			local rr = ring * sh.w * (if i % 2 == 0 then 0.45 else 1)
			local ox, oy = rr * math.cos(th), rr * math.sin(th)
			local top = pulled(C.toWorldAbout(x - dx + ox, y - dy + oy, sh.h, acx, acy, k))
			local foot = pulled(C.toWorldAbout(x + ox, y + oy, gz, acx, acy, k))
			if not r.top or (top - r.top).Magnitude > thr then
				r.top = top
				r.a0.WorldPosition = top
			end
			if not r.foot or (foot - r.foot).Magnitude > thr then
				r.foot = foot
				r.a1.WorldPosition = foot
			end
			local wS = sh.w * widthK * k * pk
			if not r.w or math.abs(wS - r.w) > thr then
				r.w = wS
				r.b.Width0, r.b.Width1 = wS, 1.1 * wS
				-- (one texture repeat 4 widths long: the texture is 4:1, so its fibres keep their shape)
				r.b.TextureLength = 4 * wS
			end
			-- the fall: fall m/s down the ribbon, in texture lengths a second
			local lenS = (foot - top).Magnitude
			local perM = lenS / math.max(math.sqrt(hh * hh + dx * dx + dy * dy), 1)
			local spd = fall * perM / math.max(r.b.TextureLength, 1e-3)
			if not r.spd or math.abs(spd - r.spd) > 0.02 * r.spd + 1e-4 then
				r.spd = spd
				r.b.TextureSpeed = spd
			end
		end
	end
	local phase = (sh.fr or 0) * 0.39
	-- (narrow ribbons spread through the shaft: at 0.7 of its width each, four ~2700-stud ribbons
	-- seen from close by were stacked see-through slabs with hard edges, 2026-11-10 judge round)
	place(p.rb, 0.3, RIB_W, phase)
	place(p.hb, 0.12, 0.5 * RIB_W, phase + 1.1)
	if look then
		-- rain ribbons thin where hail takes over the core; hail ribbons as opaque as hail's share
		local ra = layerA(look.a * (1 - 0.5 * sh.hail), #p.rb)
		local ha = layerA(look.a * sh.hail, math.max(#p.hb, 1))
		local function paint(set: any, col: Color3, a: number)
			local q = math.floor(a * 250 + 0.5) / 250
			for _, r in set do
				if r.col ~= col then
					r.col = col
					r.b.Color = ColorSequence.new(col)
				end
				if r.q ~= q then
					r.q = q
					r.b.Transparency = profile(q)
				end
			end
		end
		paint(p.rb, look.col, ra)
		paint(p.hb, look.hcol, ha)
	end
end

-- a shaft's drawables on or off: the cap and curtain cards, and its ribbons when beamOn
local function show(p: any, on: boolean, beamOn: boolean)
	p.on = on
	p.beamOn = on and beamOn
	p.bb.Enabled = on
	p.cbb.Enabled = on
	setRibbons(p.rb, on and beamOn)
	setRibbons(p.hb, on and beamOn)
end

-- re-bin the field into shafts (on new precipitation, or when the camera has moved far)
function Shafts:rebin()
	local ctx = self.ctx
	local cw = ctx.cw
	local vol = cw.vol
	self.list = {}
	self.dirty = false
	self.binnedAt = os.clock()
	local cx0, cy0 = ctx.Config.fromWorld(ctx.camera.CFrame.Position)
	self.binCam = Vector3.new(cx0, cy0, 0)
	if not vol or not vol.rain or not vol.nxv then
		return
	end
	local nx, x0 = vol.nxv, vol.x0
	local VOX = -2 * x0 / nx
	-- fine 2 km bins; round a tornado the field's own 1 km columns (review 10-29: a 2 km bin
	-- smeared the forward-flank and hook rain into a ~2.8 km curtain standing across the funnel,
	-- which hid a wedge's sides even with almost no rain wrapped round it)
	local FINE = 2000
	local NEAR_TOR = 4000
	local tors = {}
	for _, t in cw.tornadoes or {} do
		if not t.ended then
			table.insert(tors, t)
		end
	end
	local bins = {}
	for col, rr in vol.rain do
		if rr > 0.5 then
			local cx, cy = col % nx, col // nx
			local x, y = x0 + (cx + 0.5) * VOX, x0 + (cy + 0.5) * VOX
			local nearTor = false
			for _, t in tors do
				if (x - t.x) ^ 2 + (y - t.y) ^ 2 < NEAR_TOR * NEAR_TOR then
					nearTor = true
					break
				end
			end
			local bx, by, key
			if nearTor then
				bx, by = cx, cy
				key = -1 - col
			else
				bx, by = math.floor(x / FINE), math.floor(y / FINE)
				key = bx * 100000 + by
			end
			local b = bins[key]
			if not b then
				b = { bx = bx, by = by, n = 0, rain = 0, hail = 0, sx = 0, sy = 0, vox = nearTor }
				bins[key] = b
			end
			local hl = vol.hail[col] or 0
			b.n += 1
			b.rain += rr
			b.hail += hl
			b.sx += x * rr
			b.sy += y * rr
		end
	end
	-- merge 2 x 2 fine bins into 4 km cells away from the camera
	local cells = {}
	local coarse = {}
	for _, b in bins do
		if b.vox then
			b.cell = VOX
			table.insert(cells, b)
			continue
		end
		local ccx, ccy = (b.bx // 2) * 2 * FINE + FINE, (b.by // 2) * 2 * FINE + FINE
		local d = math.sqrt((ccx - cx0) ^ 2 + (ccy - cy0) ^ 2)
		if d < NEAR_FINE then
			b.cell = FINE
			table.insert(cells, b)
		else
			local key = (b.bx // 2) * 100000 + (b.by // 2)
			local c = coarse[key]
			if not c then
				c = { n = 0, rain = 0, hail = 0, sx = 0, sy = 0, cell = 2 * FINE, bx = b.bx // 2, by = b.by // 2 }
				coarse[key] = c
				table.insert(cells, c)
			end
			c.n += b.n
			c.rain += b.rain
			c.hail += b.hail
			c.sx += b.sx
			c.sy += b.sy
		end
	end
	local storms = cw.storms
	local out = {}
	for _, c in cells do
		local cols = (c.cell / VOX) ^ 2
		local frac = math.clamp(c.n / cols, 0, 1)
		local rain = c.rain / c.n
		if c.n >= 1 and rain > 0.8 then
			local x, y = c.sx / c.rain, c.sy / c.rain
			local d = math.sqrt((x - cx0) ^ 2 + (y - cy0) ^ 2)
			if d < 150000 then
				-- the nearest storm: its motion and cloud base
				local best, bs = math.huge, nil
				for _, s in storms do
					local ex, ey = s.x - x, s.y - y
					local d2 = ex * ex + ey * ey
					if d2 < best then
						best, bs = d2, s
					end
				end
				local base = if bs and best < 40000 * 40000 then bs.base or 1200 else 1300
				-- opacity: the optical depth of a chord through the rain (extinction 0.33 R^0.66 per
				-- km, as Tornado/StateAdapter's obscuration) across the rainy share of the cell; a
				-- heavy core a few km across is an opaque curtain, light rain a veil
				local chordKm = c.cell * (0.4 + 0.6 * math.sqrt(frac)) / 1000
				local a = math.clamp(1 - math.exp(-0.33 * rain ^ 0.66 * chordKm), 0, 0.92)
				-- the shaft's slant: drops released from a cloud that moves with the storm drift with
				-- the wind relative to the storm as they fall (sampled halfway down)
				local svx = if bs and best < 40000 * 40000 then bs.u or 0 else 0
				local svy = if bs and best < 40000 * 40000 then bs.v or 0 else 0
				local su, sv = 0, 0
				local cw = ctx.cw
				if cw.windAt and cw.env then
					local ok, wu, wv = pcall(cw.windAt, cw, x, y, base * 0.5)
					if ok and wu == wu and wv == wv then
						su, sv = wu - svx, wv - svy
					end
				end
				-- its light: the scene light halfway down (the storm's shadow and the overcast sky),
				-- as a share of open-sky daylight. Rain in the storm's shadow is lit only by the sky
				-- round it, so it is darker than a sunlit shaft, but less so than the base (light
				-- reaches it from the sides)
				local share, sunS = 1, 1
				local SL = ctx.Tornado and ctx.Tornado.SceneLight
				if SL then
					local ok, Ls = pcall(SL.sample, ctx, x, y, base * 0.5)
					if ok and Ls then
						share = math.clamp((0.75 * Ls.sky + 0.5 * Ls.sun) / 1.03, 0, 1)
						sunS = math.clamp(Ls.sun / 0.6, 0, 1)
					end
				end
				table.insert(out, {
					su = su, sv = sv, light = 0.45 + 0.55 * share, sun = sunS,
					x = x, y = y,
					sid = if bs and best < 40000 * 40000 then bs.id else nil, -- (its storm: drawn about its anchor)
					-- (its texture frames, from its own cell: by the drawing order, a shaft skipped or
					-- come back shifted every later one onto another's frames - the curtains swapped
					-- and jumped as the camera moved, 2026-11-07)
					-- (its cell: the card that draws it keeps to it - Shafts:draw)
					key = (if c.vox then "v" else tostring(c.cell)) .. ":" .. tostring(c.bx or 0) .. "," .. tostring(c.by or 0),
					fr = ((c.bx or 0) * 7 + (c.by or 0) * 13 + c.cell // 1000) % 16,
					fc = ((c.bx or 0) * 5 + (c.by or 0) * 11 + 3) % 16,
					vx = if bs and best < 40000 * 40000 then bs.u else 0,
					vy = if bs and best < 40000 * 40000 then bs.v else 0,
					-- (a tornado's own 1 km columns overlap their neighbours only a little: at 1.38 km a
					-- column beside the funnel spilled across its edge, 2026-10-29)
					w = if c.vox then 1.1 * c.cell else c.cell * (0.7 + 0.5 * math.sqrt(frac)) * 1.15,
					h = base + 150,
					vox = c.vox,
					a = a,
					hail = math.clamp((c.hail / c.n) / 2.5, 0, 1),
					prio = a / math.max(d, 3000),
				})
			end
		end
	end
	if #out > MAX_SHAFTS then
		table.sort(out, function(p, q)
			return p.prio > q.prio
		end)
		for i = #out, MAX_SHAFTS + 1, -1 do
			out[i] = nil
		end
	end
	self.list = out
end

function Shafts:hide()
	for _, p in self.parts do
		if p.on or p.rb then
			show(p, false, false)
		end
	end
	-- (every card free again: shown afresh, faded in, when drawn next)
	self.byKey = {}
	self.free = table.clone(self.parts)
	self.count = 0
end

-- draw every shaft this frame; returns the number drawn. cam: the camera's Roblox position
-- (studs); everything below is in sim metres. D (LabConfig.LIMITS.farDraw) is not used: shafts are
-- billboards, which Roblox draws at any distance (no far-draw pull-in needed)
function Shafts:draw(cam: Vector3, simT: number, _D: number): number
	local ctx = self.ctx
	local C = ctx.Config
	local cx, cy, cz = C.fromWorld(cam)
	local camM = Vector3.new(cx, cy, cz) -- (sim frame, metres)
	-- (the mode changed: every shaft drawn afresh in the other)
	local RB = beamsOn(ctx)
	if (RB ~= nil) ~= (self.beamMode == true) then
		self:hide()
		self.beamMode = RB ~= nil
	end
	local beams = RB ~= nil
	if self.dirty or (Vector3.new(cx, cy, 0) - self.binCam).Magnitude > 4000 or os.clock() - self.binnedAt > 20 then
		self:rebin()
	end
	local L = Util.light
	local sunV = Vector3.new(L.sunSim[1], L.sunSim[2], L.sunSim[3]) -- (sim frame)
	local dt = math.clamp(simT - self.t0, -5, 120)
	-- the rain in FRONT of each shaft (to 85% of the way: not the shaft's own rain), ~3 Hz
	local vol = ctx.cw.vol
	if vol and vol.nxv and os.clock() - (self.fogAt or 0) > 0.3 then
		self.fogAt = os.clock()
		local Precip = ctx.Sim.Precip
		for _, sh in self.list do
			local x, y = sh.x + sh.vx * dt, sh.y + sh.vy * dt
			local d = math.sqrt((x - cx) ^ 2 + (y - cy) ^ 2)
			local n = math.clamp(math.floor(d / 1500), 2, 10)
			local tau = 0
			local step = C.sightPath(0.85 * d / n) / 1000 -- (km of drawn sight line a sample)
			for i = 1, n do
				local f = 0.85 * (i - 0.5) / n
				local r = Precip.surface(vol, cx + (x - cx) * f, cy + (y - cy) * f) or 0
				tau += C.rainExtinction(r) * step
			end
			sh.fog = math.clamp(1 - math.exp(-tau), 0, 0.97)
		end
	end
	-- the view (angles and pixel sizes are unit-free: worked in studs)
	local camera = Workspace.CurrentCamera
	local look = camera.CFrame.LookVector
	local vp = camera.ViewportSize
	local tanV = math.tan(math.rad(camera.FieldOfView) / 2)
	local halfDiag = math.atan(tanV * math.sqrt(1 + (vp.X / math.max(vp.Y, 1)) ^ 2)) + MARGIN
	local pxK = 0.5 * 2 * tanV / math.max(vp.Y, 1) -- (half a pixel per stud of distance)
	self.tick = (self.tick or 0) + 1
	local n = 0
	self.byKey = self.byKey or {}
	self.free = self.free or {}
	local byKey = self.byKey
	local nowC = os.clock()
	local kFade = 1 - math.exp(-math.clamp(nowC - (self.drawAt or nowC), 0, 0.5) / 1.0)
	self.drawAt = nowC
	for _, sh in self.list do
		local x, y = sh.x + sh.vx * dt, sh.y + sh.vy * dt
		-- the curtain spans the local ground (gz) to the cloud base (sh.h, above the datum)
		local gz = C.groundAt(x, y)
		local hh = math.max(sh.h - gz, 50)
		local P = Vector3.new(x, y, gz + hh * 0.5) -- (sim frame, metres)
		local dh = math.sqrt((x - cx) ^ 2 + (y - cy) ^ 2)
		-- fading as you drive in (fully drawn from ~3 km out, gone at its edge): inside, the
		-- rain is the Atmosphere fog from its extinction (Render/NearPrecip), not a curtain. (Fully
		-- drawn from 1 km out instead, the near curtains laid over a tornado the rain its own sight
		-- already dims for (TornadoCards' rainK) and hid it from a few km, 2026-11-08; the sky
		-- that showed between them is Render/Sky's Offset now)
		local near = Util.ramp(dh, 0.6 * sh.w + 300, 0.6 * sh.w + 3000)
		-- (the Beams: drawn until you are at the shaft's edge)
		local nearB = if beams then Util.ramp(dh, 0.5 * sh.w, 0.5 * sh.w + 600) else 0
		if near < 0.02 and nearB < 0.02 then
			continue
		end
		local d = (P - camM).Magnitude
		n += 1
		-- (each shaft keeps its own card, by its cell: by drawing order, one shaft dropped or added
		-- moved every later card onto another shaft in one frame - curtains popping, 2026-11-08)
		local p = byKey[sh.key]
		if not p then
			p = table.remove(self.free)
			if not p then
				p = newShaft(self)
				table.insert(self.parts, p)
			end
			byKey[sh.key] = p
			p.aS, p.bS, p.sh, p.wp, p.cwp = 0, 0, nil, nil, nil
			p.cimg.ImageRectOffset = Vector2.new((sh.fr % 4) * 256, (sh.fr // 4) * 256)
			p.img.ImageRectOffset = Vector2.new((sh.fc % 4) * 256, (sh.fc // 4) * 256)
		end
		p.seen = self.tick
		-- on screen? (a cone round the view, widened by the curtain's own angular size: the curtain
		-- and its cap in one sphere round the curtain's middle)
		-- (the game: about its storm's anchor at the storm's scale, LabConfig.stormAnchor, so the curtain
		-- stays under the base it falls from; the lab: about its own column)
		local acx, acy = C.stormAnchor(sh.sid, x, y)
		local k = C.scaleAbout(acx, acy)
		-- (its foot on the true ground: the ground at full scale whatever the storm is drawn at -
		-- LabConfig.groundScale, 1 in the lab)
		gz *= C.groundScale(acx, acy, k)
		hh = math.max(sh.h - gz, 50)
		local wp = C.toWorldAbout(x, y, gz + hh * 0.5, acx, acy, k)
		local capH = math.clamp(sh.w * 0.2, 300, 900)
		-- (the card's width over the rain's: the curtain sheet's column is ~0.56 of its frame wide
		-- at half opacity, so at 1.25 a partly rainy cell drew ~0.7 of its rain's width and
		-- neighbouring curtains left gaps - their soft tops read as a row of beads under the base
		-- from afar, 2026-10-31. A tornado's own 1 km columns stay narrow: wider, one spilled
		-- across the funnel, 2026-10-29)
		local wK = if sh.vox then 1.25 else 1.6
		local cwp = C.toWorldAbout(x, y, sh.h + 0.2 * capH, acx, acy, k)
		local radS = (0.5 * math.sqrt((sh.w * wK) ^ 2 + (hh * 1.3) ^ 2) + 0.5 * capH + 0.2 * capH) * k
		local rel = wp - cam
		local distS = rel.Magnitude
		local vis = distS <= radS
		if not vis then
			local ang = math.acos(math.clamp(rel:Dot(look) / distS, -1, 1))
			vis = ang < halfDiag + math.asin(math.min(1, radS / distS))
		end
		local thr = pxK * math.max(distS - radS, 1) -- (studs: half a pixel at its nearest part)
		-- the Beams' share: 1 while the shaft's middle is well inside the part range, 0 past it (by its
		-- middle: a near shaft drawn at the storm's scale is ~4500 studs across, never wholly in range)
		local bLim = C.LIMITS.partRange - 500
		local bS = if beams then 1 - Util.ramp(distS, 0.75 * bLim, bLim) else 0
		-- and gone while a ribbon would look wide (over ~1/3 of its distance across): from close by a
		-- ribbon is a flat sheet with edges, so there the card curtain and the rain fog carry the rain
		bS *= 1 - Util.ramp(sh.w * RIB_W * k / math.max(distS, 1), 0.3, 0.6)
		local wantBeam = (p.bS or 0) > 0.005 or bS * nearB > 0.005
		if not vis and p.sh == sh and p.wp then
			-- off screen, still drawing the same shaft: only its position, now and then
			if (self.tick + n) % CULL_REFRESH == 0 then
				if (wp - p.wp).Magnitude > thr then
					p.wp = wp
					p.att.WorldPosition = wp
				end
				if (cwp - p.cwp).Magnitude > thr then
					p.cwp = cwp
					p.catt.WorldPosition = cwp
				end
				if wantBeam and p.rb then
					self:ribbons(p, sh, RB, x, y, gz, acx, acy, k, thr)
				end
			end
			if not p.on or p.beamOn ~= wantBeam then
				show(p, true, wantBeam)
			end
			continue
		end
		if p.sh ~= sh then
			p.cimg.ImageRectOffset = Vector2.new((sh.fr % 4) * 256, (sh.fr // 4) * 256)
			p.img.ImageRectOffset = Vector2.new((sh.fc % 4) * 256, (sh.fc // 4) * 256)
		end
		p.sh = sh
		-- colour: rain under a storm is in its shadow: a dark blue-grey, silvery when the sun is
		-- behind it, whiter with hail; hazed by true distance
		local view = (P - camM).Unit
		local fwd = math.max(0, view:Dot(sunV)) ^ 2 * L.sunUp
		-- (hail scatters much more light: a hail shaft is a pale, whitish curtain)
		-- rain the sun reaches, seen with the sun behind it, scatters that sunlight forward: the
		-- brightest thing in the scene, behind dark scud (the backlit-curtain look). The boost is
		-- the sun reaching the rain (sh.sun), not the shadowed sky light that dims the rest
		-- (2026-10-29: it was 0.35 fwd^3 x the shadowed light, so backlit rain stayed grey)
		-- (the shadowed rain is a cool grey; the light it scatters forward is sunlight, so the sun's
		-- colour: tinted the cool grey too, backlit rain under the base drew as cyan-white pools
		-- beside the funnel, judge round 2026-11-10)
		local g = (0.4 + 0.45 * sh.hail) * (sh.light or 1)
		local gs = 0.75 * fwd * (sh.sun or 1)
		local sc = L.sunColour
		local col = Color3.new(math.min(1, g * 0.97 + gs * sc.R), math.min(1, g + gs * sc.G), math.min(1, g * 1.04 + gs * sc.B))
		col = Color3.new(col.R * (0.35 + 0.65 * L.day), col.G * (0.35 + 0.65 * L.day), col.B * (0.35 + 0.65 * L.day))
		local f = Util.hazeF(d)
		col = Util.quant(Util.mix(col, L.haze, f))
		-- (haze is in the colour already; it only thins the curtain a little)
		-- (eased: a curtain comes and goes over ~1 s as the rain field changes, never at once)
		local aT = sh.a * (1 - 0.4 * f)
		p.aS = (p.aS or 0) + (aT * near * (1 - bS) - (p.aS or 0)) * kFade
		p.bS = (p.bS or 0) + (aT * nearB * bS - (p.bS or 0)) * kFade
		local a = p.aS
		-- rain between the camera and the shaft fogs it (billboards ignore the Atmosphere)
		-- (toward the storm cards' rain-fog colour: the light under the storm, Render/StormCards)
		local fog = sh.fog or 0
		if fog > 0.01 then
			col = Util.mix(col, self.ctx.rainFogColour or L.haze, fog)
		end
		-- (the puff fills ~3/4 of its frame: the card is drawn larger so the column reaches the
		-- ground and the cloud)
		local bw, bh = sh.w * wK * k, hh * 1.3 * k
		if wantBeam then
			-- (the same light, hail-white: a hail shaft scatters much more light)
			local gH = 0.85 * (sh.light or 1)
			local dk = 0.35 + 0.65 * L.day
			local hcol = Color3.new(
				math.min(1, gH * 0.97 + gs * sc.R) * dk,
				math.min(1, gH + gs * sc.G) * dk,
				math.min(1, gH * 1.04 + gs * sc.B) * dk
			)
			hcol = Util.mix(hcol, L.haze, f)
			if fog > 0.01 then
				hcol = Util.mix(hcol, self.ctx.rainFogColour or L.haze, fog)
			end
			self:ribbons(p, sh, RB, x, y, gz, acx, acy, k, thr, { a = p.bS, col = col, hcol = Util.quant(hcol) })
		end
		if not p.wp or (wp - p.wp).Magnitude > thr then
			p.wp = wp
			p.att.WorldPosition = wp
		end
		-- slant: the wind across the line of sight against the fall speed (hail falls faster).
		-- Screen right for a view along (dx, dy) is (dy, -dx); the foot goes downwind, so the
		-- image turns the other way (Rotation is clockwise)
		local dx, dy = x - cx, y - cy
		local dl = math.max(math.sqrt(dx * dx + dy * dy), 1)
		local across = ((sh.su or 0) * dy - (sh.sv or 0) * dx) / dl
		local fall = 7 + 8 * sh.hail
		local rot = -math.deg(math.clamp(math.atan2(across, fall), -0.6, 0.6))
		-- (a turn shows as the curtain's foot moving: half a pixel at its half-height)
		local rotThr = math.deg(thr / math.max(0.5 * bh, 1))
		local resize = not p.bw or math.abs(bw - p.bw) > thr or math.abs(bh - p.bh) > thr
		if resize or not p.rot or math.abs(rot - p.rot) > rotThr then
			p.bw, p.bh, p.rot = bw, bh, rot
			-- the box round the turned curtain; the image its own size inside it
			local cr, sr = math.abs(math.cos(math.rad(rot))), math.abs(math.sin(math.rad(rot)))
			local BW, BH = bw * cr + bh * sr, bw * sr + bh * cr
			p.bb.Size = UDim2.fromScale(BW, BH)
			p.img.Size = UDim2.fromScale(bw / math.max(BW, 1e-6), bh / math.max(BH, 1e-6))
			p.img.Rotation = rot
		end
		if p.col ~= col then
			p.col = col
			p.img.ImageColor3 = col
		end
		local tr = 1 - a
		if not p.tr or math.abs(tr - p.tr) > 0.002 then
			p.tr = tr
			p.img.ImageTransparency = tr
		end
		-- the rain cloud it falls from: dark, lumpy, a little wider than the curtain
		local gc = (0.36 + 0.15 * fwd) * (0.35 + 0.65 * L.day)
		local ccol = Util.quant(Util.mix(Color3.new(gc, gc * 1.02, gc * 1.06), L.haze, f))
		-- (a thin deck at the cloud base: its lumps hang just below the base, the rest is above)
		if not p.cwp or (cwp - p.cwp).Magnitude > thr then
			p.cwp = cwp
			p.catt.WorldPosition = cwp
		end
		local cbh = capH * k
		if not p.cbw or math.abs(bw - p.cbw) > thr or math.abs(cbh - p.cbh) > thr then
			p.cbw, p.cbh = bw, cbh
			p.cbb.Size = UDim2.fromScale(bw, cbh)
		end
		if p.ccol ~= ccol then
			p.ccol = ccol
			p.cimg.ImageColor3 = ccol
		end
		local ctr = 1 - math.clamp(math.max(a, p.bS) * 1.15, 0, 0.9)
		if not p.ctr or math.abs(ctr - p.ctr) > 0.002 then
			p.ctr = ctr
			p.cimg.ImageTransparency = ctr
		end
		if not p.on or p.beamOn ~= wantBeam then
			show(p, true, wantBeam)
		end
	end
	-- shafts gone this frame: faded out, then their cards freed
	for key, p in byKey do
		if p.seen ~= self.tick then
			p.aS = (p.aS or 0) * (1 - kFade)
			p.bS = (p.bS or 0) * (1 - kFade)
			if p.aS < 0.01 and p.bS < 0.01 then
				if p.on or p.rb then
					show(p, false, false)
				end
				byKey[key] = nil
				table.insert(self.free, p)
			else
				local tr = 1 - p.aS
				p.tr = tr
				p.img.ImageTransparency = tr
				if p.beamOn and p.rb and p.sh then
					local hl = p.sh.hail or 0
					for _, r in p.rb do
						r.q = nil
						r.b.Transparency = profile(layerA(p.bS * (1 - 0.5 * hl), #p.rb))
					end
					for _, r in p.hb do
						r.q = nil
						r.b.Transparency = profile(layerA(p.bS * hl, #p.hb))
					end
				end
				local ctr = 1 - math.clamp(math.max(p.aS, p.bS) * 1.15, 0, 0.9)
				p.ctr = ctr
				p.cimg.ImageTransparency = ctr
			end
		end
	end
	self.count = n
	return n
end

function Shafts:destroy()
	self.folder:Destroy()
	if self.bfolder then
		self.bfolder:Destroy()
	end
end

return Shafts
