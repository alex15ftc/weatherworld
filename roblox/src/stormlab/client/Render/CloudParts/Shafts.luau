--!nonstrict
-- Distant rain shafts and precipitation curtains, drawn from the precipitation FIELD (cw.vol, the
-- replicated 1 km surface rain / hail columns), not from the cloud: the clear inflow region and the
-- RFD slot stay clear wherever the field has no rain.
--   binning   every rainy column (> 0.5 mm/h) goes into a 4 km cell (2 km within 14 km of the
--             camera); a cell with rain becomes one shaft at the rain-weighted centroid of its
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
local Workspace = game:GetService("Workspace")

local Util = require(script.Parent:WaitForChild("Util"))

local Shafts = {}
Shafts.__index = Shafts

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
	local img = Instance.new("ImageLabel")
	img.BackgroundTransparency = 1
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
	-- fine 2 km bins
	local FINE = 2000
	local bins = {}
	for col, rr in vol.rain do
		if rr > 0.5 then
			local cx, cy = col % nx, col // nx
			local x, y = x0 + (cx + 0.5) * VOX, x0 + (cy + 0.5) * VOX
			local bx, by = math.floor(x / FINE), math.floor(y / FINE)
			local key = bx * 100000 + by
			local b = bins[key]
			if not b then
				b = { bx = bx, by = by, n = 0, rain = 0, hail = 0, sx = 0, sy = 0 }
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
		local ccx, ccy = (b.bx // 2) * 2 * FINE + FINE, (b.by // 2) * 2 * FINE + FINE
		local d = math.sqrt((ccx - cx0) ^ 2 + (ccy - cy0) ^ 2)
		if d < NEAR_FINE then
			b.cell = FINE
			table.insert(cells, b)
		else
			local key = (b.bx // 2) * 100000 + (b.by // 2)
			local c = coarse[key]
			if not c then
				c = { n = 0, rain = 0, hail = 0, sx = 0, sy = 0, cell = 2 * FINE }
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
				local share = 1
				local SL = ctx.Tornado and ctx.Tornado.SceneLight
				if SL then
					local ok, Ls = pcall(SL.sample, ctx, x, y, base * 0.5)
					if ok and Ls then
						share = math.clamp((0.75 * Ls.sky + 0.5 * Ls.sun) / 1.03, 0, 1)
					end
				end
				table.insert(out, {
					su = su, sv = sv, light = 0.45 + 0.55 * share,
					x = x, y = y,
					vx = if bs and best < 40000 * 40000 then bs.u else 0,
					vy = if bs and best < 40000 * 40000 then bs.v else 0,
					w = c.cell * (0.7 + 0.5 * math.sqrt(frac)) * 1.15,
					h = base + 150,
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
		if p.on then
			p.on = false
			p.bb.Enabled, p.cbb.Enabled = false, false
		end
	end
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
			for i = 1, n do
				local f = 0.85 * (i - 0.5) / n
				local r = Precip.surface(vol, cx + (x - cx) * f, cy + (y - cy) * f) or 0
				if r > 0.05 then
					tau += 0.33 * r ^ 0.66 * (0.85 * d / n) / 1000
				end
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
	for _, sh in self.list do
		local x, y = sh.x + sh.vx * dt, sh.y + sh.vy * dt
		-- the curtain spans the local ground (gz) to the cloud base (sh.h, above the datum)
		local gz = C.groundAt(x, y)
		local hh = math.max(sh.h - gz, 50)
		local P = Vector3.new(x, y, gz + hh * 0.5) -- (sim frame, metres)
		local dh = math.sqrt((x - cx) ^ 2 + (y - cy) ^ 2)
		-- fading as you drive in (fully drawn from ~3 km out, gone at its edge): inside, the
		-- rain is the Atmosphere fog from its extinction (Render/NearPrecip), not a curtain
		local near = Util.ramp(dh, 0.6 * sh.w + 300, 0.6 * sh.w + 3000)
		if near < 0.02 then
			continue
		end
		local d = (P - camM).Magnitude
		n += 1
		local p = self.parts[n]
		if not p then
			p = newShaft(self)
			self.parts[n] = p
			local fr = (n * 7) % 16
			p.cimg.ImageRectOffset = Vector2.new((fr % 4) * 256, (fr // 4) * 256)
			local fc = (n * 5 + 3) % 16
			p.img.ImageRectOffset = Vector2.new((fc % 4) * 256, (fc // 4) * 256)
		end
		-- on screen? (a cone round the view, widened by the curtain's own angular size: the curtain
		-- and its cap in one sphere round the curtain's middle)
		local k = C.scaleAbout(x, y)
		local wp = C.toWorldAbout(x, y, gz + hh * 0.5, x, y, k)
		local capH = math.clamp(sh.w * 0.2, 300, 900)
		local cwp = C.toWorldAbout(x, y, sh.h + 0.2 * capH, x, y, k)
		local radS = (0.5 * math.sqrt((sh.w * 1.25) ^ 2 + (hh * 1.3) ^ 2) + 0.5 * capH + 0.2 * capH) * k
		local rel = wp - cam
		local distS = rel.Magnitude
		local vis = distS <= radS
		if not vis then
			local ang = math.acos(math.clamp(rel:Dot(look) / distS, -1, 1))
			vis = ang < halfDiag + math.asin(math.min(1, radS / distS))
		end
		local thr = pxK * math.max(distS - radS, 1) -- (studs: half a pixel at its nearest part)
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
			end
			if not p.on then
				p.on = true
				p.bb.Enabled, p.cbb.Enabled = true, true
			end
			continue
		end
		p.sh = sh
		-- colour: rain under a storm is in its shadow: a dark blue-grey, silvery when the sun is
		-- behind it, whiter with hail; hazed by true distance
		local view = (P - camM).Unit
		local fwd = math.max(0, view:Dot(sunV)) ^ 3 * L.sunUp
		-- (hail scatters much more light: a hail shaft is a pale, whitish curtain)
		local g = (0.4 + 0.35 * fwd + 0.45 * sh.hail) * (sh.light or 1)
		local col = Color3.new(math.min(1, g * 0.97), math.min(1, g), math.min(1, g * 1.04))
		col = Color3.new(col.R * (0.35 + 0.65 * L.day), col.G * (0.35 + 0.65 * L.day), col.B * (0.35 + 0.65 * L.day))
		local f = Util.hazeF(d)
		col = Util.quant(Util.mix(col, L.haze, f))
		-- (haze is in the colour already; it only thins the curtain a little)
		local a = sh.a * (1 - 0.4 * f) * near
		-- rain between the camera and the shaft fogs it (billboards ignore the Atmosphere)
		-- (toward the storm cards' rain-fog colour: the light under the storm, Render/StormCards)
		local fog = sh.fog or 0
		if fog > 0.01 then
			col = Util.mix(col, self.ctx.rainFogColour or L.haze, fog)
		end
		-- (the puff fills ~3/4 of its frame: the card is drawn larger so the column reaches the
		-- ground and the cloud)
		if not p.wp or (wp - p.wp).Magnitude > thr then
			p.wp = wp
			p.att.WorldPosition = wp
		end
		local bw, bh = sh.w * 1.25 * k, hh * 1.3 * k
		if not p.bw or math.abs(bw - p.bw) > thr or math.abs(bh - p.bh) > thr then
			p.bw, p.bh = bw, bh
			p.bb.Size = UDim2.fromScale(bw, bh)
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
		if not p.rot or math.abs(rot - p.rot) > rotThr then
			p.rot = rot
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
		local ctr = 1 - math.clamp(a * 1.15, 0, 0.9)
		if not p.ctr or math.abs(ctr - p.ctr) > 0.002 then
			p.ctr = ctr
			p.cimg.ImageTransparency = ctr
		end
		if not p.on then
			p.on = true
			p.bb.Enabled, p.cbb.Enabled = true, true
		end
	end
	-- hide the unused ones
	for j = n + 1, #self.parts do
		local p = self.parts[j]
		if p.on then
			p.on = false
			p.bb.Enabled, p.cbb.Enabled = false, false
		end
	end
	self.count = n
	return n
end

function Shafts:destroy()
	self.folder:Destroy()
end

return Shafts
