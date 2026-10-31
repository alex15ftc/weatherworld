--!nonstrict
--!native
-- The tornado funnel as a billboard volume (the lab's only funnel; chosen 2026-10-25 over a mesh,
-- ribbons and particles): soft camera-facing cards stacked up the axis read like a volume of cloud,
-- with no hard outline. The tornado state is ctx.tornadoAdapter (client/init updates it).
--
--   shape     per height: a centre card and a ring of cards turning with the flow at that
--             radius. Card size = the condensed radius (Vortex.condensationRadius) up to 3 core
--             radii, NOT capped by the profile envelope: the pressure fall needed to condense
--             vanishes toward the cloud base, so the funnel flares into the lowering by itself
--   density   each card carries part of the cloud's optical depth (1 - exp(-2 beta r)), so the
--             stack is opaque in the middle and soft at every edge
--   light     sun through the storm (Tornado/SceneLight) attenuated by the funnel itself: a card
--             is lit by what is left of the sun after the chord of cloud between it and the
--             sunward surface (the "dot product" shading, done as attenuation), sky light less
--             deep inside; local lightning flashes; rain between camera and funnel greys it
--   LOD       nothing is updated while the funnel is off screen; far away, fewer heights and
--             slow properties less often. Positions are set directly every update (no tweens)
-- Physics is never touched: everything is read from the smoothed state (Tornado/StateAdapter).
-- Units: metres throughout; positions and billboard sizes cross to studs through Config
-- (docs/stormlab/SCALE-RULES.md). Heights z are above the ground (the vortex's frame); the
-- drawn altitude blends from the local ground (z = 0) to the cloud base (z = H, above the datum).
local Workspace = game:GetService("Workspace")

local TornadoCards = {}

local ND = 26 -- heights (26 x 7 + 18 condensation tags: the "rings" style; the gas default uses 500 a tornado)
local RING = 6 -- ring cards per height (+ a centre card)
local MAXT = 2 -- tornadoes drawn (nearest)
-- the layered body (style "volume", 2026-10-30): NBODY overlapping crisp-sided slices up the axis
-- (the continuous silhouette, opacity from the condensation density with a floor where condensed),
-- NENV soft puffs on a co-rotating noise field (rolling, semi-transparent envelope) and NWISP thin
-- wisps lying along the flow (fine-scale rotation). 40 + 120 + 40 = 200, + 18 condensation tags.
-- (Replaced 336 scattered faint puffs: no projected overlap, read as fragmented smoke even close up.)
local NBODY, NENV, NWISP = 40, 120, 40
-- the gas body: soft cloud puffs only; GAS_K scales the per-puff opacity share (random overlap
-- leaves gaps a strict share would show). Budget raised to 500 a tornado (user, 2026-10-30):
-- 150 body puffs + 52 tatters (NGAS includes the tatters), 160 surface lumps on a co-rotating
-- noise field (rolling turbulence on the near face), 120 striations along the flow, + 18 tags.
-- 2026-10-30 (murk review): body 250 -> 150 (fewer, denser layers average less of each puff's
-- structure away), the 100 freed to the detail layers: lumps 110 -> 160, striations 70 -> 120.
local NGAS, NTAT, GAS_K = 150, 52, 1.8
-- the outline (2026-10-31): NEDGE ribbons, half down each side of the silhouette (the gas body's
-- 202 cards: 98 fill + 52 tatters + 52 ribbons)
local NEDGE = 52
local NLUMP, NSTRI = 160, 120
-- the smoke body (style "smoke", 2026-10-31, from the reference games): fibrous smoke sprites
-- (wispyFlat), faint and many deep, riding the flow up and round the funnel - the texture is in
-- each sprite's frayed alpha, nothing is cut or laid out by a formula each frame; their frayed
-- fringes are the outline. No inner core (user).
-- (380 + 18 tags = 398 of the 500. 2026-10-31: the 100 edge strands at the silhouette went - on
-- the shadow side they drew a dark band like a separate tube, user; 60 of them went to the body)
local NSMB = 380
-- ascending condensation filaments (2026-10-31, user's research): soft streaks on the funnel's
-- surface, each riding its own helix - turning at the swirl and climbing at the vortex's own
-- updraft there (Vortex.updraftAt), so they wind flat near the ground and on a wide funnel's
-- edge and steep up a narrow one. 380 + 80 + 18 tags = 478 of the 500.
local NFIL = 80
local SM_OPMAX = 0.45 -- (a body sprite's most opacity: the soft haze puff, ~8 stacked over each point of the
-- funnel. Higher, a rope's few layers each showed - rings stacked up it)
-- (the body cards' shade across their width: sample points of the gradient, and their colours)
local GT = { 0, 0.2, 0.35, 0.5, 0.65, 0.8, 1 }
local GN = #GT
-- the outline cut (2026-10-30): its ramp half-width and wobble, in funnel radii
local EDGE_FADE, EDGE_WOB = 0.035, 0.06 -- (wobble 0.1 -> 0.06, 2026-10-31: with short cards the outline follows it exactly)
local EDGE_SEP = 0.25 -- (the outline's least brightness gap to what is behind it, a share of the brighter)
local gcol: { Color3 } = table.create(GN, Color3.new())
local NZ = 24 -- heights in the stream's lookup table (radius, axis, ground, density, spin, light)
local BETA = 0.075 -- cloud extinction (1/m), as the mesh
local BETA_SUN = 0.02 -- effective extinction for sunlight inside (multiple scattering lets light in)
local exp, sqrt, cos, sin, max, min, clamp = math.exp, math.sqrt, math.cos, math.sin, math.max, math.min, math.clamp

-- a body piece's density up its height (v: card heights from its middle). kind 1: the crisp slice,
-- sliceFlat's bell exp(-(v/0.09)^2) inside |v| < 0.3; kind 2: the tube piece, the middle |v| < 0.2
-- of that bell; kind 3: the round puff, softFlat's measured column (flat top, gone by 0.44)
local SOFT_V = { 0, 0.06, 0.12, 0.19, 0.25, 0.31, 0.37, 0.44 }
local SOFT_A = { 0.937, 0.933, 0.906, 0.836, 0.67, 0.425, 0.147, 0 }
local function bellAt(kind: number, v: number, crop: number): number
	v = math.abs(v)
	if kind == 1 then
		return if v > 0.3 then 0 else exp(-(v / 0.09) ^ 2)
	elseif kind == 2 then
		return if v > 0.5 then 0 else exp(-(2 * crop * v / 0.09) ^ 2)
	elseif kind == 4 then
		return if v > 0.47 then 0 else 1 -- (capsuleFlat along its middle)
	end
	for i = 2, #SOFT_V do
		if v < SOFT_V[i] then
			local f = (v - SOFT_V[i - 1]) / (SOFT_V[i] - SOFT_V[i - 1])
			return SOFT_A[i - 1] + (SOFT_A[i] - SOFT_A[i - 1]) * f
		end
	end
	return 0
end
-- the opacity each piece needs so a stack of them, one every gap, lets through `target` midway
-- between two (its thinnest point). hcG: the piece's height in gaps as seen. (Shared as
-- (1 - A)^(1/n) - ignoring how the soft ends overlap - the stack let through ~2.5x too much:
-- a see-through funnel and rope, user 2026-10-30)
local function stackAlpha(kind: number, hcG: number, target: number, crop: number?): number
	local lo, hi = 0, 1
	for _ = 1, 12 do
		local a = 0.5 * (lo + hi)
		local T = 1
		for k = -8, 7 do
			T *= 1 - a * bellAt(kind, (k + 0.5) / hcG, crop or 0.2)
		end
		if T > target then
			lo = a
		else
			hi = a
		end
	end
	return hi
end

local function smooth(a: number, b: number, x: number): number
	local t = clamp((x - a) / (b - a), 0, 1)
	return t * t * (3 - 2 * t)
end

function TornadoCards.new(ctx: any): any
	local C = ctx.Config
	local Vortex = ctx.Sim.Vortex
	local SceneLight = ctx.Tornado.SceneLight
	local self = {}
	local folder = Instance.new("Folder")
	folder.Name = "TornadoCards"
	-- T switches the funnel body: the spiral stream or the ring stack (for comparing)
	game:GetService("UserInputService").InputBegan:Connect(function(input, processed)
		if not processed and input.KeyCode == Enum.KeyCode.T then
			local UIS = game:GetService("UserInputService")
			if UIS:IsKeyDown(Enum.KeyCode.LeftShift) or UIS:IsKeyDown(Enum.KeyCode.RightShift) then
				-- Shift+T: the gas body's detail layers (surface lumps, striations) on/off, for A/B
				ctx.state.tornadoDetail = ctx.state.tornadoDetail == false
				print("[tornado] detail layers " .. (if ctx.state.tornadoDetail == false then "off" else "on"))
				return
			end
			local cur = ctx.state.tornadoStyle or C.TORNADO_STYLE or "volume"
			ctx.state.tornadoStyle = if cur == "smoke" then "gas" elseif cur == "gas" then "volume" elseif cur == "volume" then "rings" else "smoke"
			print("[tornado] style " .. ctx.state.tornadoStyle)
		end
	end)
	folder.Parent = ctx.root
	local anchor = Instance.new("Part")
	anchor.Name = "CardAnchor"
	anchor.Anchored, anchor.CanCollide, anchor.CanQuery, anchor.CanTouch = true, false, false, false
	anchor.Transparency = 1
	anchor.Size = Vector3.one
	anchor.CFrame = CFrame.new()
	anchor.Parent = folder

	-- a set of cards for one tornado (built on first use, then reused)
	local sets = {}
	-- one loose card (the sub-vortex columns)
	local function newCardAt(salt: number): any
		local att = Instance.new("Attachment")
		att.Parent = anchor
		local bb = Instance.new("BillboardGui")
		bb.Adornee = att
		bb.LightInfluence = 0
		bb.Size = UDim2.fromScale(10, 10)
		bb.Enabled = false
		bb.ResetOnSpawn = false
		local img = Instance.new("ImageLabel")
		img.BackgroundTransparency = 1
		img.Size = UDim2.fromScale(1, 1)
		img.Image = C.TEXTURES.softFlat
		img.ImageTransparency = 1
		img.Parent = bb
		bb.Parent = anchor
		return { att = att, bb = bb, img = img, rot = (salt * 37) % 360, on = false, tr = 1, tex = C.TEXTURES.softFlat }
	end

	local function newSet(): any
		local set = { cards = {}, spin = table.create(ND, 0), on = false, id = nil, tick = 0 }
		for h = 1, ND do
			local row = {}
			for k = 0, RING do
				local att = Instance.new("Attachment")
				att.Parent = anchor
				local bb = Instance.new("BillboardGui")
				bb.Adornee = att
				bb.LightInfluence = 0 -- (lit by SceneLight: the colour is the light)
				bb.Size = UDim2.fromScale(10, 10)
				bb.Enabled = false
				bb.ResetOnSpawn = false
				local img = Instance.new("ImageLabel")
				img.BackgroundTransparency = 1
				img.Size = UDim2.fromScale(1, 1)
				img.Image = C.TEXTURES.softFlat
				img.ImageTransparency = 1
				img.AnchorPoint = Vector2.new(0.5, 0.5)
				img.Position = UDim2.fromScale(0.5, 0.5)
				local rot = (h * 47 + k * 113) % 360
				img.Rotation = rot
				img.Parent = bb
				-- the centre card also holds the funnel's crisp core: a horizontal slice of a column
				-- (crisp sides, soft top and bottom), so the slices up the axis merge into one column
				-- with a defined edge. A second label in the same billboard (no extra billboards).
				local core = nil
				if k == 0 then
					core = Instance.new("ImageLabel")
					core.BackgroundTransparency = 1
					core.AnchorPoint = Vector2.new(0.5, 0.5)
					core.Position = UDim2.fromScale(0.5, 0.5)
					core.Size = UDim2.fromScale(1, 1)
					core.Image = C.TEXTURES.sliceFlat or ""
					core.ImageTransparency = 1
					core.ZIndex = 2
					core.Parent = bb
				end
				bb.Parent = anchor
				row[k] = { att = att, bb = bb, img = img, core = core, ctr = 1, rot = rot, rot0 = rot, tr = 1, tex = C.TEXTURES.softFlat }
			end
			set.cards[h] = row
		end
		return set
	end
	-- Instance writes only for changes that show: half a pixel in place or size (at the card's
	-- distance), 1/500 in colour or opacity. camS, pxK: this frame's camera (studs) and half a
	-- pixel per stud of distance.
	local camS, pxK = Vector3.zero, 0
	local function setOn(c: any, v: boolean)
		if c.on ~= v then
			c.on = v
			c.bb.Enabled = v
		end
	end
	local function setPos(c: any, wp: Vector3)
		local last = c.wp
		if last == nil or (wp - last).Magnitude > pxK * (wp - camS).Magnitude then
			c.wp = wp
			c.att.WorldPosition = wp
		end
	end
	local function setTr(c: any, tr: number)
		local last = c.tr
		if last == nil or math.abs(tr - last) > 0.002 or (tr >= 1 and last ~= tr) then
			c.tr = tr
			c.img.ImageTransparency = tr
		end
	end
	local function setSize(c: any, wS: number, hS: number)
		local thr = pxK * ((c.wp or camS) - camS).Magnitude
		if c.sw == nil or math.abs(wS - c.sw) > thr or math.abs(hS - c.sh) > thr then
			c.sw, c.sh = wS, hS
			c.bb.Size = UDim2.fromScale(wS, hS)
		end
	end
	-- the labels' shares of the card (the soft puff and the core slice need different shapes)
	local function setShares(c: any, iw: number, ih: number, cw: number, ch: number)
		if c.iw == nil or math.abs(iw - c.iw) > 0.01 or math.abs(ih - c.ih) > 0.01 then
			c.iw, c.ih = iw, ih
			c.img.Size = UDim2.fromScale(iw, ih)
		end
		if c.core and (c.cw == nil or math.abs(cw - c.cw) > 0.01 or math.abs(ch - c.ch) > 0.01) then
			c.cw, c.ch = cw, ch
			c.core.Size = UDim2.fromScale(cw, ch)
		end
	end
	local function setCoreTr(c: any, tr: number)
		if c.core and (math.abs(tr - c.ctr) > 0.002 or (tr >= 1 and c.ctr ~= tr)) then
			c.ctr = tr
			c.core.ImageTransparency = tr
		end
	end
	local function setCol(c: any, col: Color3)
		local last = c.col
		if not last or math.abs(col.R - last.R) > 0.002 or math.abs(col.G - last.G) > 0.002 or math.abs(col.B - last.B) > 0.002 then
			c.col = col
			c.img.ImageColor3 = col
			if c.core then
				c.core.ImageColor3 = col
			end
		end
	end
	-- A gas puff's texture, frame f (0..3): one of the four 1024 px detailed puffs (gas_puff2.py,
	-- 2026-10-30), else a frame of the old 2x2 sheet, else the soft puff
	local PUFF2 = { C.TEXTURES.gasPuff2A, C.TEXTURES.gasPuff2B, C.TEXTURES.gasPuff2C, C.TEXTURES.gasPuff2D }
	local function setPuffTex(c: any, f: number)
		local t2 = PUFF2[f + 1]
		if t2 and t2 ~= "" then
			c.img.Image = t2
			c.tex = t2
			c.img.ImageRectSize = Vector2.zero
		elseif (C.TEXTURES.gasPuffSheet or "") ~= "" then
			c.img.Image = C.TEXTURES.gasPuffSheet
			c.tex = C.TEXTURES.gasPuffSheet
			c.img.ImageRectSize = Vector2.new(512, 512)
			c.img.ImageRectOffset = Vector2.new((f % 2) * 512, (f // 2) * 512)
		else
			c.img.Image = C.TEXTURES.softFlat
			c.tex = C.TEXTURES.softFlat
		end
	end
	-- A card's shade across its width (gas body, 2026-10-30): a UIGradient of ratios to the card's
	-- colour (ImageColor3 = the brightest), sampled at GT across the card into gcol by the caller;
	-- rot: the gradient's direction on screen less the image's own turn. Sequences are shared
	-- (ratios quantised to 1/32), and written only when they change.
	local gradSeqs: { [string]: ColorSequence } = {}
	-- the outline cut (gas body, 2026-10-30): the transparency across the card - clear outside the
	-- funnel's edges at tL and tR (card units, 0 = left), opaque between, ramps of half-width hw.
	-- Shared sequences, positions quantised to 1/128
	-- (hwR: the right ramp's own half-width, else hw - the outline ribbons fade softly inside and
	-- cut sharply outside, 2026-10-31)
	local cutSeqs: { [string]: NumberSequence } = {}
	local cutT, cutV = table.create(8, 0), table.create(8, 0)
	local function cutSeq(tL: number, tR: number, hw: number, hwR: number?): NumberSequence
		local qL, qR, qW = math.floor(tL * 128 + 0.5), math.floor(tR * 128 + 0.5), math.max(1, math.floor(hw * 128 + 0.5))
		local qW2 = math.max(1, math.floor((hwR or hw) * 128 + 0.5))
		qL, qR = clamp(qL, -512, 768), clamp(qR, -512, 768)
		qW, qW2 = math.min(qW, 2047), math.min(qW2, 2047)
		local key = qL .. "," .. qR .. "," .. qW .. "," .. qW2
		local seq = cutSeqs[key]
		if seq then
			return seq
		end
		local L, R, W, W2 = qL / 128, qR / 128, qW / 128, qW2 / 128
		local function trAt(t: number): number
			local inL = clamp((t - (L - W)) / (2 * W), 0, 1)
			local inR = clamp(((R + W2) - t) / (2 * W2), 0, 1)
			return 1 - math.min(inL, inR)
		end
		local cand = { 0, L - W, L + W, R - W2, R + W2, 1 }
		local n = 0
		local last = -1
		for _, t in cand do
			if t >= 0 and t <= 1 and t > last + 1e-3 then
				n += 1
				cutT[n], last = t, t
			end
		end
		if cutT[n] < 1 then
			if 1 - cutT[n] < 1e-3 then
				cutT[n] = 1
			else
				n += 1
				cutT[n] = 1
			end
		end
		cutT[1] = 0
		local kps = table.create(n)
		for k = 1, n do
			kps[k] = NumberSequenceKeypoint.new(cutT[k], trAt(cutT[k]))
		end
		seq = NumberSequence.new(kps)
		cutSeqs[key] = seq
		return seq
	end
	-- (pos: the keypoints' places across the card, with gcol[1..#pos] - the outline ribbons put theirs
	-- at the same funnel x on both sides, so where the two overlap their shades match exactly; they
	-- also take finer colour steps, 1/64. Else GT, 1/32)
	local function setGrad(c: any, mr: number, mg: number, mb: number, rot: number, tL: number?, tR: number?, hw: number?, hwR: number?, pos: { number }?)
		local g = c.grad
		if not g then
			g = Instance.new("UIGradient")
			g.Parent = c.img
			c.grad = g
		end
		if tL and tR and hw then
			local seq = cutSeq(tL, tR, hw, hwR)
			if c.cut ~= seq then
				c.cut = seq
				g.Transparency = seq
			end
		end
		local nK = if pos then #pos else GN
		local Q = if pos then 64 else 32
		local parts = table.create(nK * 4)
		for k = 1, nK do
			local col = gcol[k]
			parts[4 * k - 3] = math.floor(Q * col.R / max(mr, 1e-3) + 0.5)
			parts[4 * k - 2] = math.floor(Q * col.G / max(mg, 1e-3) + 0.5)
			parts[4 * k - 1] = math.floor(Q * col.B / max(mb, 1e-3) + 0.5)
			parts[4 * k] = if pos then math.floor(pos[k] * 256 + 0.5) else k
		end
		local key = Q .. ":" .. table.concat(parts, ",")
		if c.gkey ~= key then
			c.gkey = key
			local seq = gradSeqs[key]
			if not seq then
				local kps = table.create(nK)
				for k = 1, nK do
					local t = if pos then parts[4 * k] / 256 else GT[k]
					if k == 1 then
						t = 0
					elseif k == nK then
						t = 1
					end
					kps[k] = ColorSequenceKeypoint.new(t, Color3.new(
						min(parts[4 * k - 3], Q) / Q, min(parts[4 * k - 2], Q) / Q, min(parts[4 * k - 1], Q) / Q))
				end
				seq = ColorSequence.new(kps)
				gradSeqs[key] = seq
			end
			g.Color = seq
		end
		rot = rot % 360
		if c.grot == nil or math.abs(((rot - c.grot + 180) % 360) - 180) > 1 then
			c.grot = rot
			g.Rotation = rot
		end
	end
	-- (a turn shows as the card's edge moving: half a pixel at its half-size)
	local function setRot(c: any, rot: number)
		local half = 0.5 * math.max(c.sw or 1, c.sh or 1)
		local thr = math.deg(pxK * ((c.wp or camS) - camS).Magnitude / math.max(half, 1e-3))
		if c.rot0 == nil or math.abs(rot - c.rot0) > thr then
			c.rot0 = rot
			c.img.Rotation = rot
		end
	end
	local function show(set: any, v: boolean)
		if set.on == v then
			return
		end
		set.on = v
		-- (one funnel body at a time: the rings, or the spiral stream)
		local sp = set.style == "volume"
		local gas = set.style == "gas"
		local smk = set.style == "smoke"
		for _, row in set.cards do
			for _, c in row do
				c.bb.Enabled = v and not sp and not gas and not smk
			end
		end
		if set.sm then
			for _, c in set.sm.cards do
				c.on = v and smk
				c.bb.Enabled = c.on
			end
		end
		if set.sp then
			for _, c in set.sp.cards do
				c.on = v and sp
				c.bb.Enabled = c.on
			end
		end
		if set.gs then
			for _, c in set.gs.cards do
				c.on = v and gas
				c.bb.Enabled = c.on
			end
		end
		if not v and set.subs then
			for _, c in set.subs do
				setOn(c, false)
			end
		end
		if not v and set.tags then
			for _, c in set.tags do
				setOn(c, false)
			end
		end
	end

	-- the drawn altitude (m above the datum) of height z above the ground: the funnel's foot on the
	-- ground there (g), its top at the cloud base H
	local function altitude(z: number, g: number, H: number): number
		return z + g * max(0, 1 - z / H)
	end

	-- is any part of the column (base, middle, top, a radius either side) on screen?
	-- (k: the tornado's scale about its ground point (x, y): it is drawn whole at k)
	local function onScreen(cam: Camera, x: number, y: number, top: number, w: number, g: number, H: number, k: number): boolean
		for zi = 0, 2 do
			local z = if zi == 0 then 0 elseif zi == 1 then top * 0.5 else top
			local p = C.toWorldAbout(x, y, altitude(z, g, H), x, y, k)
			local v, vis = cam:WorldToViewportPoint(p)
			if vis then
				return true
			end
			if v.Z > 0 then
				-- just off the edge but wide enough to reach in (the drawn width over the drawn
				-- distance: both in studs, at k)
				local vp = cam.ViewportSize
				local dS = (p - cam.CFrame.Position).Magnitude
				local px = w * k / max(k, dS) * vp.Y / (2 * math.tan(math.rad(cam.FieldOfView) / 2))
				if v.X > -px and v.X < vp.X + px and v.Y > -px and v.Y < vp.Y + px then
					return true
				end
			end
		end
		return false
	end

	local function draw(set: any, e: any, dt: number, cam: Camera, camPos: Vector3)
		local H = max(100, e.cloudBase)
		local top = H * 1.07 + 30
		local p = e.params
		local rcBase = Vortex.rcAt(p, H)
		local g0 = C.groundAt(e.x, e.y)
		-- the whole tornado is drawn at one scale about its ground point (LabConfig.scaleAbout)
		local ex, ey = e.x, e.y
		local ks = C.scaleAbout(ex, ey) -- (studs a metre; not `k`: the ring loop below uses k)
		-- (m: from the camera to the column's middle, true distance)
		local camX, camY, camZ = C.fromWorld(camPos)
		local d = sqrt((ex - camX) ^ 2 + (ey - camY) ^ 2 + (altitude(top * 0.5, g0, H) - camZ) ^ 2)
		if not onScreen(cam, ex, ey, top, 8 * rcBase, g0, H, ks) then
			return 0 -- (the engine culls them; we skip the work)
		end
		-- far: every other height, slow properties less often
		local step = if d > 12000 then 2 else 1
		set.tick += 1
		local slowEvery = if d > 4000 then 6 else 4
		local refresh = set.tick % slowEvery == 0 or set.fresh
		set.fresh = false
		local simDt = if ctx.state.paused then 0 else dt * (ctx.state.timeScale or 1)
		local trans = e.trans or 1
		local life = e.fade or 1
		-- (each light sample marches the sun through the storm: cached, refreshed 4 times a second)
		local nowL = os.clock()
		if not set.L0 or nowL - (set.L0At or 0) > 0.25 then
			set.L0At = nowL
			set.L0 = SceneLight.sample(ctx, e.x, e.y, altitude(H * 0.5, g0, H))
		end
		local L0 = set.L0
		-- where the sky light comes from round the funnel (SceneLight.skyDir; twice a second): the side
		-- facing open sky is lit, the side facing the storm dark. Without it the funnel under a storm
		-- was one even dark grey - murky, its turn unreadable (review, 2026-10-30)
		if not set.skyAt or nowL - set.skyAt > 0.5 then
			set.skyAt = nowL
			set.sdx, set.sdy, set.sdA = SceneLight.skyDir(ctx, e.x, e.y, altitude(H * 0.4, g0, H))
		end
		local sdx, sdy, sdA = set.sdx, set.sdy, set.sdA
		local SKY_K = 0.85 -- (the sky light's swing across the funnel at aniso 1: x 0.15 .. x 1.85)
		if ctx.flashField then
			L0.flash = ctx.Tornado.FlashField.at(ctx.flashField, e.x, e.y, altitude(H * 0.5, g0, H))
		end
		local sunV = L0.sunDir
		local sxs, sys_ = sunV.X, -sunV.Z
		local sl = sqrt(sxs * sxs + sys_ * sys_)
		local cosEl = sl
		if sl > 1e-3 then
			sxs, sys_ = sxs / sl, sys_ / sl
		end
		local sinEl = max(0.05, sunV.Y)
		-- rain wrapped round the vortex (the heaviest rain within ~1.5 km, e.wrap): the 1 km rain
		-- grid the sight-line march samples misses a hook of rain close round the funnel, so
		-- ~0.3 km of it is counted in front (same extinction law, 0.33 R^0.66 per km); capped so
		-- a rain-wrapped funnel stays a faint darker mass in the rain, as it usually reads
		-- (the storm is drawn at true scale about its centre, so this 0.3 km is not squashed)
		local wrapT = math.exp(-C.rainExtinction(e.wrap or 0) * 0.3)
		local rainK = math.clamp((1 - trans * wrapT) * 0.85, 0, 0.8)
		set.rainK, set.trans, set.wrap = rainK, trans, e.wrap or 0 -- (shown in the F4 counters)
		local vDt = ctx:visualDt(dt) -- (the funnel's spin and its surface rising: local motion)
		set.rise = set.rise or {}
		local riseW = 0.15 * e.vc
		-- rain between camera and funnel greys it toward the same rain-fog grey the storm cards
		-- use (Render/StormCards: the sky's light diffused in rain), so funnel and storm agree
		local fg = 0.75 * L0.sky + 0.12 * L0.sun
		local rainCol = Color3.new(math.min(1, fg * 0.95), math.min(1, fg * 0.98), math.min(1, fg * 1.04))
		local warm = smooth(0.4, 0.05, sunV.Y) * (1 - L0.night)
		-- the lowering it hangs from (StormCards publishes the colour its wall cloud was shaded
		-- with): toward the cloud base the funnel is the same cloud, so it takes that light
		local base = nil
		local sb = ctx.stormBase
		if sb then
			local pid = e.snap and e.snap.parentId
			base = if pid ~= nil then sb[tostring(pid)] else nil
			if not base then
				local best = 6000 ^ 2
				for _, b in sb do
					local d2 = (b.x - e.x) ^ 2 + (b.y - e.y) ^ 2
					if d2 < best then
						best, base = d2, b
					end
				end
			end
		end
		-- multi-vortex: the core goes two-celled (a downdraft down the middle dries and warms it),
		-- so the parent funnel thins to a translucent shell and loses its crisp edge, and the
		-- sub-vortices show through it (docs/tornado-reference/NOTES.md: separate darker, bluer blobs)
		local thin = smooth(0.3, 2.5, p.subCount or 0) * clamp((p.twoCell or 0) / 1.2, 0, 1)
		local wallR = if base and base.r and base.r > 0 then base.r else 1500
		-- how far below the cloud base the funnel merges into the lowering scales with its shape: a
		-- tall narrow funnel over its top ~half, a squat wedge (height ~ its width) only over its
		-- top ~15%. With fixed shares a 350 m-tall, 1.2 km-wide wedge merged over most of its
		-- height and read as a soft mound with no sides (2026-10-29). zAt(f): the height that was H f
		local squat = clamp((H / max(1, 2 * rcBase)) / 3, 0.3, 1)
		local function zAt(f: number): number
			return H * (1 - (1 - f) * squat)
		end
		local softLobe = C.LOBES and C.LOBES.soft and C.LOBES.soft.side
		set.thin, set.thinMax = thin, 0
		-- The background behind the funnel's edges (2026-10-30, outline step 2): the sight line
		-- from the camera past an edge point either rises into the parent storm's base (where
		-- SceneLight.baseCover says the base reaches: dark, its lowering's colour) or runs on to
		-- the horizon (the haze the sky renderer sets: Lighting.Atmosphere), or down to the ground.
		-- Luminance 0..1.
		local rv = cam.CFrame.RightVector
		local acx, acy = rv.X, -rv.Z
		local acl = sqrt(acx * acx + acy * acy)
		if acl > 1e-3 then
			acx, acy = acx / acl, acy / acl
		else
			acx, acy = 1, 0
		end
		local function lum(c: Color3): number
			return 0.3 * c.R + 0.59 * c.G + 0.11 * c.B
		end
		if not set.pst or nowL - (set.pstAt or 0) > 1 then
			set.pstAt = nowL
			set.pst = nil
			local cw = ctx.cw
			local pid = e.snap and e.snap.parentId
			if cw and cw.storms then
				local best = 8000 ^ 2
				for _, s in cw.storms do
					if pid ~= nil and tostring(s.id) == tostring(pid) then
						set.pst = s
						break
					end
					local d2 = (s.x - e.x) ^ 2 + (s.y - e.y) ^ 2
					if d2 < best then
						best, set.pst = d2, s
					end
				end
			end
			local atmo = game:GetService("Lighting"):FindFirstChildOfClass("Atmosphere")
			set.skyLum = if atmo then clamp(lum(atmo.Color) * 1.15, 0.05, 1) else 0.6
		end
		local pst = set.pst
		local skyLum = set.skyLum
		local baseLum = if base then lum(base.col) else 0.45 * skyLum
		local function bgBehind(px: number, py: number, pz: number): number
			local dx, dy, dz = px - camX, py - camY, pz - camZ
			-- (the air on the way to what is behind - rain and clear haze - replaces it with the
			-- veil's own light; e.wrap, the rain round the vortex, stands for the rain beyond it)
			local kExt = (C.rainExtinction(e.wrap or 0) + 0.04) / 1000
			if dz <= 0 then
				-- the ground, where the sight line meets it (far off for a sight line that only just
				-- dips: there it is the haze, not dark ground - with dark ground assumed a wedge's
				-- lower rim was lit up into the bright rain haze behind it, 2026-10-31)
				local gz0 = C.groundAt(px, py)
				local k = (pz - gz0) / max(-dz, 1e-3)
				local reach = k * sqrt(dx * dx + dy * dy + dz * dz)
				local tr = exp(-kExt * reach)
				return skyLum + (0.6 * baseLum - skyLum) * tr
			end
			if not pst then
				return skyLum
			end
			local hb = pst.base or H
			if pz >= hb then
				return baseLum
			end
			local k = (hb - camZ) / dz
			local reach = k * sqrt(dx * dx + dy * dy)
			local cover = SceneLight.baseCover(pst, camX + dx * k, camY + dy * k) * (1 - smooth(40000, 90000, reach))
			-- (and the base is seen only through the air on the way: rain - the wrapped rain round
			-- the vortex, e.wrap, standing for the rain under the base beyond it - and the clear
			-- haze replace it with the veil's own light. Without it a wedge in rain had the dark
			-- base "behind" it and its rim was lit up into the bright rain haze actually there,
			-- 2026-10-31)
			local tr = exp(-kExt * reach)
			return skyLum + (baseLum - skyLum) * cover * tr
		end
		-- (a colour kept EDGE_SEP apart in brightness from bg, by weight wE: darker against a
		-- brighter background, lighter against a darker one)
		local function sepFrom(col: Color3, bg: number, wE: number): Color3
			local el = max(lum(col), 1e-3)
			local dir = clamp((el - bg) / max(0.08 * bg, 0.01), -1, 1)
			local fac = if dir < 0
				then 1 + (max(0.55, min(1, bg * (1 - EDGE_SEP) / el)) - 1) * -dir
				else 1 + (min(1.6, max(1, bg / ((1 - EDGE_SEP) * el))) - 1) * dir
			fac = 1 + (fac - 1) * wE
			return Color3.new(min(1, col.R * fac), min(1, col.G * fac), min(1, col.B * fac))
		end
		local n = 0
		-- the funnel's body: the spiral stream (default) or the ring stack below
		local style = ctx.state.tornadoStyle or C.TORNADO_STYLE or "volume"
		local spiral = style == "volume" or style == "gas" or style == "smoke"
		if style == "smoke" and not set.sm then
			-- each sprite keeps one frame of its 4x4 sheet for life (no image swaps)
			-- (the smooth puff, 2026-10-31: the Severity funnels are smooth soft blobs with gently lumpy
			-- rims, no grain. The fibrous wispyFlat sheet had ~10x the fine texture - coarse smoke, a
			-- rope like a snake, user)
			-- (then the haze puff: the smooth puff's dense disc and darker rim drew each stretched
			-- puff's end as an arc - a rope in rings)
			local tex = if (C.TEXTURES.hazePuffFlat or "") ~= "" then C.TEXTURES.hazePuffFlat else C.TEXTURES.smoothPuffFlat
			local sheet = tex == C.TEXTURES.wispyFlat
			local cards, seed, seed2, phase, th = {}, {}, {}, {}, {}
			for i = 1, NSMB do
				local c = newCardAt(i + 2000)
				c.img.AnchorPoint = Vector2.new(0.5, 0.5)
				c.img.Position = UDim2.fromScale(0.5, 0.5)
				c.img.Image = tex
				c.tex = tex
				if sheet then
					local f = (i * 7) % 16
					c.img.ImageRectSize = Vector2.new(256, 256)
					c.img.ImageRectOffset = Vector2.new((f % 4) * 256, (f // 4) * 256)
				end
				cards[i] = c
				local sd = (sin(i * 127.1 + 78.233) * 43758.5453) % 1
				seed[i] = sd
				seed2[i] = (sin(i * 269.5 + 183.3) * 43758.5453) % 1
				-- stratified start along the funnel, golden-angle start round it
				phase[i] = ((i - 0.5 + 0.8 * (sd - 0.5)) / NSMB) % 1
				th[i] = (i * 2.399963229728653 + 0.6 * sd) % (2 * math.pi)
			end
			-- the filaments (after the body in the same list, so a style change hides them too)
			local ftex = if (C.TEXTURES.streakSoft or "") ~= "" then C.TEXTURES.streakSoft else tex
			local fs, fth, fage, flife = {}, {}, {}, {}
			for j = 1, NFIL do
				local c = newCardAt(j + 3000)
				c.img.AnchorPoint = Vector2.new(0.5, 0.5)
				c.img.Position = UDim2.fromScale(0.5, 0.5)
				c.img.Image = ftex
				c.tex = ftex
				cards[NSMB + j] = c
				seed[NSMB + j] = (sin(j * 311.7 + 41.9) * 43758.5453) % 1
				fs[j], fth[j] = math.random() * 0.85, math.random() * 2 * math.pi
				flife[j] = 3 + 4 * math.random()
				fage[j] = math.random() * flife[j] -- (staggered, so they don't all start together)
			end
			set.sm = { cards = cards, seed = seed, seed2 = seed2, phase = phase, th = th, rise = 0, cur = {},
				texH = tex, texS = if (C.TEXTURES.smoothPuffFlat or "") ~= "" then C.TEXTURES.smoothPuffFlat else tex,
				fs = fs, fth = fth, fage = fage, flife = flife }
		end
		if style == "gas" and not set.gs then
			-- the gas body (2026-10-30): soft cloud puffs only - no crisp slices or capsules (they read
			-- as solid objects, user). Each puff keeps one frame of the 2x2 gas sheet for life.
			local cards, seed, seed2, u, th = {}, {}, {}, {}, {}
			for i = 1, NGAS do
				local c = newCardAt(i)
				c.img.AnchorPoint = Vector2.new(0.5, 0.5)
				c.img.Position = UDim2.fromScale(0.5, 0.5)
				setPuffTex(c, (i * 7) % 4)
				cards[i] = c
				seed[i] = (sin(i * 127.1 + 78.233) * 43758.5453) % 1
				seed2[i] = (sin(i * 269.5 + 183.3) * 43758.5453) % 1
				-- (an R2 low-discrepancy pair: even cover up the funnel and across it, no rows)
				u[i] = (0.5 + i * 0.7548776662) % 1
				th[i] = (i * 2.399963229728653) % (2 * math.pi)
				c.baseRot = 360 * seed2[i]
			end
			-- detail layers: surface lumps (gas puffs) then striations (wisp sheet), each with a
			-- stratified start along the funnel (phase) and a golden-angle start round it
			local wispTex = C.TEXTURES.wispSheetFlat or ""
			local phase = {}
			for j = 1, NLUMP + NSTRI do
				local i = NGAS + j
				local c = newCardAt(i)
				local stri = j > NLUMP and wispTex ~= ""
				c.img.AnchorPoint = Vector2.new(0.5, 0.5)
				c.img.Position = UDim2.fromScale(0.5, 0.5)
				if stri then
					c.img.Image = wispTex
					c.tex = wispTex
					local f = (i * 3) % 4
					c.img.ImageRectSize = Vector2.new(512, 512)
					c.img.ImageRectOffset = Vector2.new((f % 2) * 512, (f // 2) * 512)
				else
					setPuffTex(c, (i * 3) % 4)
				end
				cards[i] = c
				local sd = (sin(i * 127.1 + 78.233) * 43758.5453) % 1
				seed[i] = sd
				seed2[i] = (sin(i * 269.5 + 183.3) * 43758.5453) % 1
				local n = if j <= NLUMP then NLUMP else NSTRI
				local k = if j <= NLUMP then j else j - NLUMP
				phase[i] = ((k - 0.5 + 0.8 * (sd - 0.5)) / n) % 1
				th[i] = (i * 2.399963229728653 + 0.6 * sd) % (2 * math.pi)
				c.baseRot = 360 * seed2[i]
			end
			-- the outline ribbons (2026-10-31): flat across (the gradient cuts the edge), faded ends
			local ribbonTex = if (C.TEXTURES.funnelRibbon or "") ~= "" then C.TEXTURES.funnelRibbon else C.TEXTURES.softFlat
			for k = 1, NEDGE do
				local i = NGAS + NLUMP + NSTRI + k
				local c = newCardAt(i)
				c.img.AnchorPoint = Vector2.new(0.5, 0.5)
				c.img.Position = UDim2.fromScale(0.5, 0.5)
				c.img.Image = ribbonTex
				c.tex = ribbonTex
				cards[i] = c
			end
			set.gs = { cards = cards, seed = seed, seed2 = seed2, u = u, th = th, phase = phase, rise = 0, riseW = 0 }
		end
		if spiral and not set.sp then
			-- (built on first use: each sprite keeps its texture frame for life - no image swaps)
			-- (stream: the smooth puff - the mottled puff sheet drew a blotchy column; centre: the
			-- crisp-sided slice, so the funnel keeps defined sides)
			local slice = if (C.TEXTURES.sliceFlat or "") ~= "" then C.TEXTURES.sliceFlat else C.TEXTURES.softFlat
			local wispTex = C.TEXTURES.wispSheetFlat or ""
			local cards = {}
			for i = 1, NBODY + NENV + NWISP do
				local c = newCardAt(i)
				local isWisp = i > NBODY + NENV and wispTex ~= ""
				local tex = if i <= NBODY then slice elseif isWisp then wispTex else C.TEXTURES.softFlat
				c.img.Image = tex
				c.tex = tex
				c.img.AnchorPoint = Vector2.new(0.5, 0.5)
				c.img.Position = UDim2.fromScale(0.5, 0.5)
				if isWisp then
					-- (one frame of the 2x2 wisp sheet for life; streaks along its x)
					local f = i % 4
					c.img.ImageRectSize = Vector2.new(512, 512)
					c.img.ImageRectOffset = Vector2.new((f % 2) * 512, (f // 2) * 512)
					c.wisp = true
				end
				cards[i] = c
			end
			-- envelope puffs and wisps: a stratified start height (phase), angle (golden angle) and
			-- radius share each. Their (angle, phase) is carried by the flow, so it is also the
			-- coordinate the turbulence noise is read at: neighbours share their lumps.
			local th, rf, phase, seed = {}, {}, {}, {}
			local golden = 2.399963229728653
			for i = 1, NENV + NWISP do
				local sd = (sin(i * 127.1 + 78.233) * 43758.5453) % 1
				seed[i] = sd
				th[i] = (i * golden + 0.6 * sd) % (2 * math.pi)
				if i <= NENV then
					phase[i] = ((i - 0.5 + 0.8 * (sd - 0.5)) / NENV) % 1
					rf[i] = 0.45 + 0.2 * sd -- (with their size they reach ~rc: inside the body's crisp edge. Out to ~1.25 rc they feathered it, 2026-10-30)
				else
					phase[i] = ((i - NENV - 0.5 + 0.8 * (sd - 0.5)) / NWISP) % 1
					rf[i] = 0.9 + 0.08 * sd -- (on the surface, not outside it: outside they stuck out past the edge)
				end
			end
			set.sp = { cards = cards, th = th, rf = rf, phase = phase, seed = seed, rise = 0, riseW = 0, tab = {} }
		end
		if set.style ~= style then
			-- (switch bodies: show() redoes every card's Enabled)
			set.style = style
			set.on = nil
			show(set, true)
			set.fresh = true
		end
		if spiral then
			-- The layered body: (1) slices up the axis give one continuous silhouette, (2) envelope
			-- puffs on the surface turn and rise with the flow, lit by facing the sun (a lit side and a
			-- shadow side; the turn shows as lumps crossing between them), (3) wisps along the flow.
			-- All read the same lookup table up the funnel.
			local sp = set.sp
			local tab = sp.tab
			-- the lookup table up the funnel (the same rules as the rings: condensed radius, the cap
			-- that lets it flare into the lowering, density, the turn at its radius)
			for i = 0, NZ do
				local z = (i / NZ) ^ 1.15 * top
				local zc = min(z, H)
				local rcz = Vortex.rcAt(p, zc)
				local cap = rcz * 3 + min(5 * rcz, max(0, 0.5 * wallR - rcz * 3)) * smooth(zAt(0.6), H, z)
				local rc = if z >= H * 0.995 then cap else min(Vortex.condensationRadius(e, min(z, H * 0.995)), cap)
				local ax, ay = Vortex.axisAt(e, zc)
				local row = tab[i]
				if not row then
					row = {}
					tab[i] = row
				end
				row.z, row.rc, row.rcz, row.ax, row.ay = z, rc, rcz, ax, ay
				row.gz = C.groundAt(e.x + ax, e.y + ay)
				local fadeTop = 1 - smooth(H * 0.9, H * 1.02, z)
				local flare = smooth(zAt(0.55), H, z)
				local thinH = thin * clamp(0.7 * rcz / max(rc, 1), 0, 1)
				row.flare, row.fadeTop, row.thinH = flare, fadeTop, thinH
				-- how condensed: the body needs a good share of the core radius (a marginal tip or rope
				-- end fades), the envelope shows from less (fragments past the solid body's end)
				-- (by the condensed radius itself: a narrow tip is still condensed cloud, opaque
				-- across ~2 rc of it. Scaled by the core radius, a cone's 25 m tip faded out and the
				-- funnel looked short of the ground, 2026-10-30)
				-- (a rope's few-metre tip is cloud too: from 6 m the rope stopped in mid-air)
				row.cond = smooth(0.3, 2, rc)
				row.condE = smooth(0.2, 1.5, rc)
				local Rn = max(rc, 1) * 0.5 / max(5, rcz)
				row.omega = min(e.vc / max(20, rcz) * Vortex.profile(max(Rn, 0.05)) / max(Rn, 0.05), 2.5)
				-- the steady updraft at the condensed surface (the filaments climb at it)
				row.wUp = max(0, Vortex.updraftAt(p, 0.9 * max(rc, 1), zc))
				if not row.L or (refresh and nowL - (row.Lat or 0) > 0.5) then
					row.L = SceneLight.sample(ctx, e.x + ax, e.y + ay, altitude(z, row.gz, H))
					row.Lat = nowL
				end
				if ctx.flashField then
					row.L.flash = ctx.Tornado.FlashField.at(ctx.flashField, e.x + ax, e.y + ay, altitude(z, row.gz, H))
				end
				-- what is seen past each edge (the outline's contrast, below)
				local za = altitude(z, row.gz, H)
				row.bgL = bgBehind(e.x + ax - rc * acx, e.y + ay - rc * acy, za)
				row.bgR = bgBehind(e.x + ax + rc * acx, e.y + ay + rc * acy, za)
			end
			-- (the axis's length per metre of height there: a leaning rope is longer than it is tall)
			for i = 0, NZ do
				local a, b = tab[max(i - 1, 0)], tab[min(i + 1, NZ)]
				local dzr = max(b.z - a.z, 1)
				tab[i].stretch = sqrt((b.ax - a.ax) ^ 2 + (b.ay - a.ay) ^ 2 + dzr * dzr) / dzr
			end
			local function at(z: number): (any, any, number)
				local u = (clamp(z / top, 0, 1) ^ (1 / 1.15)) * NZ
				local i = min(math.floor(u), NZ - 1)
				return tab[i], tab[i + 1], u - i
			end
			-- the rise: the envelope climbs ~0.15 vc (features carried up the funnel's surface), the
			-- wisps faster (they are the fine, quick motion); the body slices stay put (the silhouette)
			sp.rise = (sp.rise + riseW / max(top, 50) * vDt) % 1
			sp.riseW = (sp.riseW + 1.6 * riseW / max(top, 50) * vDt) % 1
			local cf = cam.CFrame
			local camR, camU = cf.RightVector, cf.UpVector
			local dirt0 = clamp(e.debrisLoft or 0, 0, 1)
			local dTop = max(e.debrisTop or 0, 1)
			local function colour(L: any, sunAmt: number, skyAmt: number, z: number): Color3
				-- (as the rings: lofted debris darkens it low down; slate in deep shadow, cream sun;
				-- rain greys it; toward the base it takes the lowering's light)
				local dirt = dirt0 * (1 - smooth(0.4 * dTop, dTop, z)) * (1 - 0.4 * clamp(z / dTop, 0, 1))
				local alb = 0.74 * (1 - 0.5 * dirt)
				local deep = (1 - clamp(L.sun / 0.6, 0, 1)) * (1 - L0.night)
				local fl = L.flash or 0
				local r = alb * (skyAmt * (0.93 - 0.2 * deep) + sunAmt * 1.04) + 0.85 * fl
				local g = alb * (skyAmt * (0.99 - 0.04 * deep) + sunAmt * (1 - 0.18 * warm)) + 0.88 * fl
				local b = alb * (skyAmt * (1.1 + 0.04 * deep) + sunAmt * (0.9 - 0.36 * warm)) + fl
				local col = Color3.new(min(r, 1), min(g, 1), min(b, 1)):Lerp(rainCol, rainK)
				if base then
					-- (0.9 -> 0.5, 2026-10-30: the upper funnel took the lowering's flat colour and
					-- vanished into it; it keeps its own light and shade now, meeting the base in tone)
					col = col:Lerp(base.col, 0.5 * smooth(zAt(0.4), zAt(0.95), z))
				end
				return col
			end
			-- (the table interpolated at height z)
			local function rowAt(z: number): (number, number, number, number, any, any, number)
				local r0, r1, f = at(z)
				return r0.rc + (r1.rc - r0.rc) * f, r0.ax + (r1.ax - r0.ax) * f, r0.ay + (r1.ay - r0.ay) * f,
					r0.gz + (r1.gz - r0.gz) * f, r0, r1, f
			end
			local kSight = life * (0.6 + 0.4 * trans)

			-- 1. the dense body: crisp-sided slices of a column (sliceFlat: sides 0.86 of the frame,
			-- gaussian top and bottom) at fixed heights up the axis, each ~7 gaps tall, so every point
			-- of the funnel is covered by several. Their opacities share out one target opacity A(z):
			-- the optical depth across the condensed diameter, with a floor wherever the air is well
			-- condensed (a condensed funnel is opaque; the soft look belongs to the envelope), fading
			-- where condensation is marginal, into the lowering, and in a two-celled shell.
			-- slices spread evenly along the funnel's length, not its height: where a rope runs
			-- sideways a bend got only a few slices, far apart, and the long straight pieces needed to
			-- bridge them stuck out past the curve - jagged corners, user 2026-10-30. (Upright, the
			-- length is the height: a stovepipe is unchanged.)
			local NA = 48
			local arcZ, arcS = sp.arcZ or {}, sp.arcS or {}
			sp.arcZ, sp.arcS = arcZ, arcS
			do
				local px, py = Vortex.axisAt(e, 0)
				arcZ[1], arcS[1] = 0, 0
				for k = 1, NA do
					local zk = top * k / NA
					local qx, qy = Vortex.axisAt(e, min(zk, H))
					arcZ[k + 1] = zk
					arcS[k + 1] = arcS[k] + sqrt((qx - px) ^ 2 + (qy - py) ^ 2 + (top / NA) ^ 2)
					px, py = qx, qy
				end
			end
			local function zOfArc(fr: number): number
				local sT = clamp(fr, 0, 1) * arcS[NA + 1]
				local lo, hi = 1, NA + 1
				while hi - lo > 1 do
					local mid = (lo + hi) // 2
					if arcS[mid] <= sT then
						lo = mid
					else
						hi = mid
					end
				end
				return arcZ[lo] + (arcZ[hi] - arcZ[lo]) * (sT - arcS[lo]) / max(arcS[hi] - arcS[lo], 1e-6)
			end
			if style == "volume" then
			for j = 1, NBODY do
				local c = sp.cards[j]
				local u = ((j - 0.5) / NBODY) ^ 1.15
				local z = zOfArc(u)
				local dz = max(zOfArc(((j + 0.5) / NBODY) ^ 1.15) - z, 0.05 * top / NBODY)
				local rc, ax, ay, gz, r0, r1, f = rowAt(z)
				local cond = r0.cond + (r1.cond - r0.cond) * f
				local flare = r0.flare + (r1.flare - r0.flare) * f
				local thinH = r0.thinH + (r1.thinH - r0.thinH) * f
				local fadeTop = r0.fadeTop + (r1.fadeTop - r0.fadeTop) * f
				-- (gone toward the lowering, as the rings' crisp core: there the envelope carries it)
				-- (a two-celled core is dry only inside ~0.7 core radii: the sight line through the
				-- middle still crosses 2 x the condensed ring round it. Thinned by a flat x(1 - 0.85
				-- thin), a wedge's ~160 m of ring drew at 0.5 opacity - a faint smudge, 2026-10-30)
				local rcz = r0.rcz + (r1.rcz - r0.rcz) * f
				local ring = rc - thin * min(0.7 * rcz, rc)
				-- (rain in front greys its colour, rainK: cutting the opacity for it too counted the
				-- rain twice and a rain-wrapped rope drew pale and see-through, 2026-10-30)
				local A = max(1 - exp(-2 * BETA * rc), 0.995) * cond -- (floor 0.95: a condensed rope was see-through, user 2026-10-30) * fadeTop * life * (1 - smooth(zAt(0.55), zAt(0.92), z))
					* (1 - exp(-2 * BETA * ring)) / max(1 - exp(-2 * BETA * rc), 1e-3)
				-- (rain between greys its colour - colour(); it barely thins a condensed funnel's opacity)
				A = clamp(A, 0, 0.997) -- (0.985 still showed bright sky through a condensed funnel, user 2026-10-30)
				if A < 0.01 or rc < 1 then
					setTr(c, 1)
				else
					-- the span: 16 gaps on a straight funnel, so each point of the edge is a blend of
					-- many slices and follows the taper smoothly (as the rings' core); halved (down to 2
					-- gaps) while the axis strays more than a third of the radius from the chord, so on
					-- a wavy rope the slices follow the bends. (Stopped at 8 gaps, a rope's slices were
					-- straight sticks across its waves and drew as a row of blocks, 2026-10-30)
					-- (2.5-gap tube pieces everywhere, tried for sharper edges 2026-10-30, drew bands
					-- across every condensed funnel: reverted at the user's request)
					local span = 16 * dz
					local zl, zh, lx, ly, hx, hy = 0, 0, 0, 0, 0, 0
					-- (a piece may sag off the curve by 0.2 core radii, down to 1-gap pieces; 0.33
					-- stopping at 2 gaps let corners poke out of a bending rope, 2026-10-30)
					for it = 1, 5 do
						zl, zh = max(0, z - 0.5 * span), min(H, z + 0.5 * span)
						lx, ly = Vortex.axisAt(e, zl)
						hx, hy = Vortex.axisAt(e, zh)
						local q = (z - zl) / max(zh - zl, 1e-3)
						local dev = sqrt((lx + (hx - lx) * q - ax) ^ 2 + (ly + (hy - ly) * q - ay) ^ 2)
						if dev < max(0.2 * rc, 2) or it == 5 then
							break
						end
						span *= 0.5
					end
					setPos(c, C.toWorldAbout(e.x + ax, e.y + ay, altitude(z, gz, H), ex, ey, ks))
					-- turned and sized by the chord of axis it covers, as the camera sees it
					local c3 = C.toWorldAbout(e.x + hx, e.y + hy, altitude(zh, gz, H), ex, ey, ks)
						- C.toWorldAbout(e.x + lx, e.y + ly, altitude(zl, gz, H), ex, ey, ks)
					local cr, cu = c3:Dot(camR), c3:Dot(camU)
					local lean = math.deg(math.atan2(cr, cu))
					if lean > 90 then
						lean -= 180
					elseif lean < -90 then
						lean += 180
					end
					local wc = 2 * rc / 0.86
					local chS = sqrt(cr * cr + cu * cu) / max(ks, 1e-6)
					local proj = clamp(chS / max(c3.Magnitude / max(ks, 1e-6), 1e-3), 0.15, 1)
					-- the gap to the next piece along the funnel as seen: the chord's on-screen length per
					-- metre of height. (Taken as dz x proj, it ignored the axis leaning over: where a rope
					-- runs sideways the next piece is several dz away, and the pieces were sized and
					-- faded for a gap far smaller than it is - light bands across a bending rope, user
					-- 2026-10-30)
					local gapS = max(chS * dz / max(zh - zl, 1e-3), 0.15 * dz)
					-- The slice texture's density is a bell (tools/smoke/smoke_flipbook.py --slice:
					-- exp(-(v/0.09)^2), |v| < 0.3 of the frame): many long slices' soft bells blend into
					-- one smooth column with crisp sides. A short slice (a bend in a rope) can't overlap
					-- enough of its neighbours for the bells to meet, so there the slice is a soft round
					-- puff instead (no crisp sides: a bending rope reads soft). mBar: the mean density
					-- over the frame. (Cropping the slice to its flat middle drew hard-edged tiles along
					-- a rope, 2026-10-30)
					local spanG = (zh - zl) / max(dz, 1)
					-- (and where the funnel widens fast over the slice - the flare into the lowering:
					-- a crisp-sided slice there is a step, and stacked they drew hard-edged tiles)
					-- Judged over the part of the slice that shows: its bell, exp(-(v/0.09)^2) of the
					-- frame, is down to 1/e at +-0.09 of the span. (Judged over the whole 16-gap span, nearly every
					-- slice of a cone or stovepipe counted as "widening fast" and was drawn as a soft
					-- round puff - the soft funnel edge, 2026-10-30)
					local hb = max(0.5 * dz, 0.09 * (zh - zl))
					local rLo, rHi = rowAt(max(0, z - hb)), rowAt(min(H, z + hb))
					-- Seen end-on (from beneath, looking up the funnel) a slice is a thin bar, and the
					-- stacked bars drew stripes (user 2026-10-30): there the cross-section shows as what
					-- it is, a disc - a round soft puff, as tall as it is wide
					local endOn = 1 - smooth(0.45, 0.8, proj) -- (from 0.3-0.6, faint lines stayed at ~60 deg up)
					local puff = math.abs(rHi - rLo) > 0.35 * max(rc, 1) or endOn > 0.5
					local soft = spanG < 6 and not puff
					-- (there a tube piece: the same slice cropped to the middle of its bell, |v| < 0.12
					-- of the frame, laid along the axis - crisp walls along the tube, soft ends that
					-- blend with the next, as the sub-vortex tubes. Round soft puffs there drew a
					-- caterpillar, 2026-10-30. Mean density over the crop: 0.0798 tanh(1.2025 cw /
					-- 0.09) / cw = 0.61)
					-- tube pieces: where the rope is opaque, a capsule - crisp sides, round ends - so
					-- pieces meeting at an angle on a bend join inside the tube (round joins); square
					-- ends showed their corners outside a bending rope, user 2026-10-30. Where it fades,
					-- the middle |v| < 0.2 of the slice's bell (down to 0.7% at the cut; cut at 0.12 -
					-- 17% - each piece ended in a hard level edge: bands one slice apart), whose soft
					-- ends blend where the stack is see-through
					local capsule = soft and (C.TEXTURES.capsuleFlat or "") ~= ""
						and (A >= 0.97 or (c.crop == -1 and A > 0.95)) -- (solid pieces stacked see-through double up where they overlap: stripes at A 0.95)
					local crop = if not soft then 0 elseif capsule then -1 else 0.2
					local want = if puff then C.TEXTURES.softFlat
						elseif capsule then C.TEXTURES.capsuleFlat
						else (C.TEXTURES.sliceFlat or C.TEXTURES.softFlat)
					if c.tex ~= want then
						c.tex = want
						c.img.Image = want
					end
					if c.crop ~= crop then
						c.crop = crop
						c.tube = soft
						if soft and not capsule then
							c.img.ImageRectOffset = Vector2.new(0, 512 * (0.5 - crop))
							c.img.ImageRectSize = Vector2.new(512, 1024 * crop)
						else
							c.img.ImageRectOffset = Vector2.zero
							c.img.ImageRectSize = Vector2.zero
						end
					end
					-- (tube pieces: counted by the coverage where two pieces meet, ~0.45 - their
					-- mean, 0.61, left the joins see-through: a translucent rope, 2026-10-30)
					local mBar = if puff then 0.35 elseif soft then 0.4 else 0.16
					if puff then
						wc *= 1.2 -- (the puff's soft edge sits inside its frame)
					end
					local hc = max(chS, 2 * gapS, 1.4 * dz)
					if not puff and not soft then
						-- (each slice's visible bell, +-0.09 of its height, at least ~1.6 slice gaps as
						-- seen, so neighbours always blend. Shortened spans - near the ground, at the
						-- top, halved on a bend - made the bells thinner than the gaps between them:
						-- fine stripes across the funnel from some angles, 2026-10-30. At 13 gaps
						-- only ~2 slices covered a point and the sky leaked through unevenly - ~2 grey
						-- levels of banding against a bright sky, low in the funnel seen from ~35 deg
						-- up; at 18 the leak is even)
						hc = max(hc, 18 * gapS)
					end
					-- (every piece's bell at least ~1.2 slice gaps as seen, whatever its kind:
					-- shorter ones left a ripple one slice apart - bands low in the funnel seen
					-- from ~35 deg up, 2026-10-30)
					if puff then
						hc = max(hc, endOn * wc, 5 * gapS)
					end
					if soft then
						-- (7 gaps: at 5.5 a rope still showed a faint band per piece, user 2026-10-30)
						-- (no longer than the curve allows: the span that passed the bend test, its
						-- dense middle ~0.6 of the piece; else the ends poke out of a bending rope)
						hc = max(hc, min(7 * gapS, 1.8 * chS))
						if capsule then
							-- (round ends don't poke out of a bend, so a capsule can be long; its
							-- straight middle, ~half its height, must reach past the next one or the
							-- silhouette is a row of beads, 2026-10-30)
							hc = max(hc, 3.2 * gapS)
						end
					end
					-- slices overlapping a point: each covers ~mBar hc of the axis as seen, neighbours
					-- dz apart along it (foreshortened as the chord is). (Counted as half its span, each
					-- was ~3x too faint: a translucent body, 2026-10-30)
					local nOv = max(1, mBar * hc / max(gapS, 1))
					local kind = if puff then 3 elseif capsule then 4 elseif soft then 2 else 1
					setTr(c, 1 - stackAlpha(kind, hc / max(gapS, 1e-3), 1 - A, crop))
					if j == 8 or j == 20 then
						-- (debug, shown in the F4 counters: the body at two heights)
						set.bodyDbg = set.bodyDbg or {}
						set.bodyDbg[j] = string.format("z%.0f rc%.0f A%.2f cond%.2f thin%.2f n%.1f hc%.0f wc%.0f", z, rc, A, cond, thinH, nOv, hc, wc)
					end
					-- (turned, the slice needs a box that holds it)
					local sA, cA = math.abs(math.sin(math.rad(lean))), math.abs(math.cos(math.rad(lean)))
					local bw, bh = wc * cA + hc * sA, wc * sA + hc * cA
					setSize(c, bw * ks, bh * ks)
					setShares(c, wc / bw, hc / bh, 0, 0)
					setRot(c, lean)
					-- its light: what reaches the column's middle (sunlight mostly spent crossing the
					-- funnel, as the rings' centre card), less sky inside; the envelope adds the lit side
					-- (half-lit 0.42 drew a pale column with the shadowed puffs as dark spots, 2026-10-30)
					local L = if f < 0.5 then r0.L else r1.L
					local path = rc / max(cosEl, 0.2)
					setCol(c, colour(L, L.sun * 0.5 * exp(-BETA_SUN * path), L.sky * 0.72, z))
				end
				n += 1
			end

			-- 2. the turbulent envelope: soft puffs riding the surface (0.74-0.96 of the condensed
			-- radius), turning at the flow's speed there and rising. Their lumps come from one noise
			-- field read at the flow's own coordinates (the angle each puff has been carried to, and
			-- its height label), so neighbouring puffs bulge, brighten and thicken together and the
			-- bulges travel round as structures - organised turbulence, not a drawn spiral.
			-- Semi-transparent: over the body they add relief and the sunlit side; past its end (a
			-- marginal tip) they are the ragged fragments.
			for i = 1, NENV do
				local c = sp.cards[NBODY + i]
				local s = (sp.phase[i] + sp.rise) % 1
				local z = s ^ 1.15 * top
				local rc, ax, ay, gz, r0, r1, f = rowAt(z)
				local condE = r0.condE + (r1.condE - r0.condE) * f
				local flare = r0.flare + (r1.flare - r0.flare) * f
				local thinH = r0.thinH + (r1.thinH - r0.thinH) * f
				local fadeTop = r0.fadeTop + (r1.fadeTop - r0.fadeTop) * f
				local omega = r0.omega + (r1.omega - r0.omega) * f
				local rcz = r0.rcz + (r1.rcz - r0.rcz) * f
				local theta = (sp.th[i] + omega * vDt) % (2 * math.pi)
				sp.th[i] = theta
				local cs, sn = cos(theta), sin(theta)
				-- (lumps ~1.2 core radii tall, ~5 round the funnel; evolving slowly)
				local lam = max(25, 1.2 * rcz)
				local rho = clamp(rc / lam, 0.6, 3)
				local bump = clamp(2.2 * math.noise(cs * rho + 3.1, sn * rho - 1.7, sp.phase[i] * top / lam + nowL * 0.03), -1, 1)
				local rr = rc * (sp.rf[i] + 0.12 * bump)
				local Pe = C.toWorldAbout(e.x + ax + cs * rr, e.y + ay + sn * rr, altitude(z, gz, H), ex, ey, ks)
				setPos(c, Pe)
				-- facing the camera: 1 on the near face, 0 on the sides. Puffs on the sides lie
				-- across the silhouette and blur the body's crisp edge (a wedge's sides went soft
				-- against the lowering, 2026-10-30): there they fade, leaving the edge to the body
				local outW = C.toWorldAbout(e.x + ax + cs * (rr + 1), e.y + ay + sn * (rr + 1), altitude(z, gz, H), ex, ey, ks) - Pe
				local face = clamp((outW.Unit:Dot((camPos - Pe).Unit) - 0.15) / 0.5, 0, 1)
				local w = max(3, rc * (0.5 + 0.1 * bump + 0.08 * sp.seed[i])) -- (big, so they blend: smaller drew spots; bigger feathered the sides)
				-- (at least ~2.2 envelope gaps tall: on a rope the puffs join up the column)
				local hs = max(w * 0.9, 2.2 * top / NENV)
				setSize(c, w * ks, min(hs, 3 * w) * ks)
				local dens = (1 - exp(-2 * BETA * rc)) * condE * fadeTop * kSight * (1 - 0.35 * flare) * (1 - 0.7 * thinH)
				local env = smooth(0, 0.04, s) * (1 - smooth(0.93, 1, s))
				local op = dens * (0.4 + 0.14 * bump) * env * (0.25 + 0.75 * face)
				setTr(c, 1 - clamp(op, 0, 0.7))
				-- lit by facing the sun; bulges catch more light
				local facing = cs * sxs + sn * sys_
				local ndl = facing * cosEl + 0.35 * sinEl
				local L = if f < 0.5 then r0.L else r1.L
				local sunAmt = L.sun * (0.1 + 0.6 * clamp(ndl, 0, 1)) * (0.88 + 0.12 * bump)
				local skyAmt = L.sky * (0.74 + 0.05 * bump)
				setCol(c, colour(L, sunAmt, skyAmt, z))
				setRot(c, (c.rot or 0) + 12 * bump)
				n += 1
			end

			-- 3. surface wisps: thin streaks just outside the surface, lying along the flow as the
			-- camera sees it (the turn plus the rise), each appearing and fading as it climbs; only
			-- where the funnel is well condensed and below the flare. Sparse and faint: the fine
			-- motion that shows the spin.
			for i = 1, NWISP do
				local c = sp.cards[NBODY + NENV + i]
				local k = NENV + i
				local s = (sp.phase[k] + sp.riseW) % 1
				local z = s ^ 1.15 * top
				local rc, ax, ay, gz, r0, r1, f = rowAt(z)
				local cond = r0.cond + (r1.cond - r0.cond) * f
				local flare = r0.flare + (r1.flare - r0.flare) * f
				local thinH = r0.thinH + (r1.thinH - r0.thinH) * f
				local fadeTop = r0.fadeTop + (r1.fadeTop - r0.fadeTop) * f
				local omega = r0.omega + (r1.omega - r0.omega) * f
				local theta = (sp.th[k] + omega * vDt) % (2 * math.pi)
				sp.th[k] = theta
				local cs, sn = cos(theta), sin(theta)
				local rr = rc * sp.rf[k]
				local alt = altitude(z, gz, H)
				local x0, y0 = e.x + ax + cs * rr, e.y + ay + sn * rr
				local Pw = C.toWorldAbout(x0, y0, alt, ex, ey, ks)
				setPos(c, Pw)
				local fade = math.sin(math.pi * ((s * 4 + sp.seed[k]) % 1)) ^ 1.5
				local dens = (1 - exp(-2 * BETA * rc)) * cond * fadeTop * kSight * (1 - flare) * (1 - 0.8 * thinH)
				local op = 0.34 * dens * fade
				if op < 0.01 then
					setTr(c, 1)
				else
					-- the flow here: the turn (omega rr, counter-clockwise) and the rise (1.6 x 0.15 vc)
					local vt = max(omega * rr, 0.1)
					local st = 0.05 * max(rr, 1)
					local Pt = C.toWorldAbout(x0 - sn * st, y0 + cs * st, alt + st * 1.6 * riseW / vt, ex, ey, ks)
					local d3 = Pt - Pw
					local sx, sy = d3:Dot(camR), d3:Dot(camU)
					local ang = math.atan2(sy, sx)
					-- (as long as its flow shows on screen, and drawn only on the side facing the
					-- camera: at the funnel's edge the flow points at the camera, its on-screen
					-- direction swings through 90 deg as it passes, and full-length wisps there
					-- pinwheeled off the side, 2026-10-30)
					local onS = sqrt(sx * sx + sy * sy) / max(d3.Magnitude, 1e-4)
					local toCam = (camPos - Pw).Unit
					local outV = C.toWorldAbout(x0 + cs, y0 + sn, alt, ex, ey, ks) - Pw
					-- (only on the middle of the near face, and no longer than the distance to the
					-- silhouette: nearer the edge they streaked off the side, 2026-10-30)
					local fd = outV.Unit:Dot(toCam)
					local front = clamp((fd - 0.55) / 0.3, 0, 1)
					local len = min(0.9 * rc + 15, 1.2 * rc * max(fd, 0))
					local thick = 0.3 * len
					setSize(c, max(thick * 1.2, len * (0.25 + 0.75 * onS)) * ks, thick * ks)
					setRot(c, -math.deg(ang))
					setTr(c, 1 - clamp(op * front * onS, 0, 0.35))
					local facing = cs * sxs + sn * sys_
					local ndl = facing * cosEl + 0.35 * sinEl
					local L = if f < 0.5 then r0.L else r1.L
					setCol(c, colour(L, L.sun * (0.2 + 0.7 * clamp(ndl, 0, 1)), L.sky * 0.9, z))
				end
				n += 1
			end
			end -- (not gas)
			if style == "gas" then
				-- The gas body: NGAS soft puffs spread evenly over the funnel's length (by arc length,
				-- so a sideways rope gets as many as an upright one) and across it (an R2 sequence),
				-- all rising together with the surface flow and each turning at the flow's speed at
				-- its height. No fixed layers, rows or crisp sides anywhere: nothing to band. The
				-- body puffs sit inside 0.55 rc and are ~1.6 rc wide, so their soft edges meet at
				-- ~rc - a defined but gaseous outline; NTAT fainter, smaller tatters at the surface
				-- break it up as the references' fuzzy edges.
				local gs = set.gs
				gs.rise = (gs.rise + riseW / max(arcS[NA + 1], 50) * vDt) % 1
				local arcL = arcS[NA + 1]
				local NB = NGAS - NTAT
				-- The column's light across the silhouette (2026-10-30; shared by the fill and the outline
				-- ribbons since 2026-10-31, so overlapping cards agree): frameAt gives the horizontal frame
				-- at axis point P0 (across the axis on screen, toward the camera) and the backlight; shadeX
				-- the colour at x (-1 left edge .. 1 right edge) - the surface normal of a cylinder seen
				-- from the camera against the sun, the directional sky light and, backlit, the bright rim
				-- of forward-scattered sun; the outer rim (|x| > 0.62) kept at least EDGE_SEP apart in
				-- brightness from what is behind that edge (off where the funnel flares into the lowering)
				local function frameAt(acrossW: Vector3, P0: Vector3): (number, number, number, number, number)
					local ahx, ahy = acrossW.X, -acrossW.Z
					local al = sqrt(ahx * ahx + ahy * ahy)
					local tcW = camPos - P0
					local tcx, tcy = tcW.X, -tcW.Z
					if al > 1e-3 then
						ahx, ahy = ahx / al, ahy / al
						local dp = tcx * ahx + tcy * ahy
						tcx, tcy = tcx - dp * ahx, tcy - dp * ahy
					else
						ahx, ahy = 1, 0
					end
					local tl = sqrt(tcx * tcx + tcy * tcy)
					if tl > 1e-3 then
						tcx, tcy = tcx / tl, tcy / tl
					else
						tcx, tcy = -ahy, ahx
					end
					local back = if tcW.Magnitude > 1e-3 then max(0, -(tcW.Unit:Dot(sunV))) ^ 3 else 0
					return ahx, ahy, tcx, tcy, back
				end
				local function shadeX(L: any, x: number, ahx: number, ahy: number, tcx: number, tcy: number, back: number,
					z: number, flare: number, bgL: number, bgR: number): Color3
					local ny = sqrt(max(0, 1 - x * x))
					local nx_, ny_ = x * ahx + ny * tcx, x * ahy + ny * tcy
					local ndl = (nx_ * sxs + ny_ * sys_) * cosEl + 0.35 * sinEl
					local x4 = x * x * x * x
					local sunAmt = L.sun * ((0.12 + 0.62 * clamp(ndl, 0, 1)) + 0.7 * back * x4)
					local skyAmt = L.sky * 0.72 * (1 + SKY_K * sdA * (nx_ * sdx + ny_ * sdy)) * (0.86 + 0.14 * ny)
					local col = colour(L, sunAmt, skyAmt, z)
					local wE = smooth(0.62, 1, math.abs(x)) * (1 - flare)
					if wE > 0.01 then
						col = sepFrom(col, if x < 0 then bgL else bgR, wE)
					end
					return col
				end
				-- the outline's wobble (EDGE_WOB, a noise field drifting with the turn): x of the left and
				-- right edges at height z
				local function edgesAt(z: number, rcz: number): (number, number)
					local zq = z / max(0.8 * rcz, 5)
					local eL = -(1 + EDGE_WOB * (math.noise(zq, 1.7, nowL * 0.2 + 0.3) + 0.5 * math.noise(2.7 * zq, 9.1, nowL * 0.35)))
					local eR = 1 + EDGE_WOB * (math.noise(zq, 5.3, nowL * 0.2 + 7.1) + 0.5 * math.noise(2.7 * zq, 3.9, nowL * 0.35 + 4.4))
					return eL, eR
				end
				-- the funnel's opacity across its middle at height z (the target the cards share)
				local function opacityAt(rc: number, rcz: number, cond: number, fadeTop: number): number
					local ring = rc - thin * min(0.7 * rcz, rc)
					local A = max(1 - exp(-2 * BETA * rc), 0.995) * cond * fadeTop * life
						* (1 - exp(-2 * BETA * ring)) / max(1 - exp(-2 * BETA * rc), 1e-3)
					-- (two-celled, 2026-10-31: the core dries out, but the parent's own swirl still carries a
					-- translucent envelope of scud and lifted dust round its sub-vortices)
					A = max(A, 0.3 * thin * cond * fadeTop * life)
					return clamp(A, 0, 0.997)
				end
				for i = 1, NGAS do
					local c = gs.cards[i]
					local tat = i > NB
					local sd, sd2 = gs.seed[i], gs.seed2[i]
					local s = ((i * 0.6180339887) % 1 + gs.rise) % 1
					local z = zOfArc(s)
					local rc, ax, ay, gz, r0, r1, f = rowAt(z)
					local cond = r0.cond + (r1.cond - r0.cond) * f
					local fadeTop = r0.fadeTop + (r1.fadeTop - r0.fadeTop) * f
					local thinH = r0.thinH + (r1.thinH - r0.thinH) * f
					local omega = r0.omega + (r1.omega - r0.omega) * f
					local rcz = r0.rcz + (r1.rcz - r0.rcz) * f
					local theta = (gs.th[i] + omega * vDt) % (2 * math.pi)
					gs.th[i] = theta
					local cs, sn = cos(theta), sin(theta)
					-- (body puffs inside 0.42 rc, ~2.1 rc wide: their soft edges meet at ~rc. At 0.55 rc / 1.6 rc
					-- each puff showed as its own bump on the outline - cauliflower, 2026-10-30)
					local q = if tat then 0.85 + 0.2 * gs.u[i] else 0.42 * sqrt(gs.u[i])
					local rr = rc * q
					local alt = altitude(z, gz, H)
					local Pe = C.toWorldAbout(e.x + ax + cs * rr, e.y + ay + sn * rr, alt, ex, ey, ks)
					setPos(c, Pe)
					-- (2026-10-30, outline: body puffs 2.8 rc wide - still dense where they reach the
					-- edge, which each card's transparency now cuts (EDGE_* below); at 2.1 rc the sum
					-- faded from 0.6 to 1.1 rc, no outline. Flatter (0.62-0.78 of the width), so a
					-- card's straight cut spans less of a cone's taper)
					local w = max(3, rc * (if tat then 0.5 + 0.3 * sd else 2.8 + 0.3 * sd))
					-- (fill, 2026-10-31: tall and faint, inside the outline ribbons - they no longer draw the
					-- edge, so their straight sides never show. Short cards had to be near opaque each, and
					-- every one showed as a stripe)
					local hgt = if tat then w * (0.85 + 0.3 * sd2) else rc * (1.2 + 0.4 * sd2)
					-- the opacity: the funnel's target A, shared among the puffs that cover a point.
					-- Puffs per silhouette area: NB along the length, the silhouette 2 rc wide and the
					-- length foreshortened as seen (proj)
					local A = opacityAt(rc, rcz, cond, fadeTop)
					local env = smooth(0, 0.03, s) * (1 - smooth(0.96, 1, s))
					if A * env < 0.005 then
						setTr(c, 1)
					else
						local zl2, zh2 = max(0, z - 0.02 * top), min(H, z + 0.02 * top)
						local la, lb = Vortex.axisAt(e, zl2)
						local ha, hb = Vortex.axisAt(e, zh2)
						local d3 = C.toWorldAbout(e.x + ha, e.y + hb, altitude(zh2, gz, H), ex, ey, ks)
							- C.toWorldAbout(e.x + la, e.y + lb, altitude(zl2, gz, H), ex, ey, ks)
						local projL = clamp(sqrt(d3:Dot(camR) ^ 2 + d3:Dot(camU) ^ 2) / max(d3.Magnitude, 1e-3), 0.05, 1)
						if not tat then
							-- (2026-10-31, rope) along the axis each card is at least ~2.4 puff spacings long, so a
							-- thin tip stays one strand (the flatter cards left a string of beads), and no longer
							-- than the bend allows: its straight edge cut follows the axis's tangent at its centre,
							-- off the curved silhouette by (h/2)^2 / 2R at its ends - kept within ~0.1 rc. On a
							-- tight bend long cards stuck out as steps
							local ma, mb = Vortex.axisAt(e, z)
							local Pm = C.toWorldAbout(e.x + ma, e.y + mb, altitude(z, gz, H), ex, ey, ks)
							local Pl = C.toWorldAbout(e.x + la, e.y + lb, altitude(zl2, gz, H), ex, ey, ks)
							local Ph = d3 + Pl
							local u1x, u1y = (Pm - Pl):Dot(camR), (Pm - Pl):Dot(camU)
							local u2x, u2y = (Ph - Pm):Dot(camR), (Ph - Pm):Dot(camU)
							local l1, l2 = sqrt(u1x * u1x + u1y * u1y), sqrt(u2x * u2x + u2y * u2y)
							local hMax = math.huge
							if l1 > 1e-3 and l2 > 1e-3 then
								local turn = math.abs(math.atan2(u1x * u2y - u1y * u2x, u1x * u2x + u1y * u2y))
								local kap = turn / max(0.5 * (l1 + l2) / ks, 1e-3) -- (per metre, as seen)
								if kap > 1e-6 then
									hMax = 2 * sqrt(2 * 0.1 * rc / kap)
								end
							end
							hgt = max(min(hgt, hMax), 2.4 * arcL / NB)
						end
						setSize(c, w * ks, hgt * ks)
						local share = 2 * rc * (arcL / NB) * projL
						local nEff = max(1, 0.28 * w * hgt / max(share, 1e-3))
						-- (tatters fade where the funnel flares into the lowering: over the darker cloud there
						-- they showed as separate light dots, 2026-10-30)
						local flare = r0.flare + (r1.flare - r0.flare) * f
						-- (the ribbons' share: they carry the funnel's opacity and outline, and fade out where
						-- the funnel is seen end-on - there the fill takes it all back, cut at the edge)
						local wR = smooth(0.2, 0.45, projL)
						local a = if tat then 0.18 * A * env * (1 - flare)
							else ((1 - wR) * min(0.95, 1 - (1 - A) ^ (GAS_K / nEff))
								+ wR * min(0.35, 1 - (1 - 0.6 * A) ^ (GAS_K / nEff))) * env
						-- (the outer body's 35% noise thinning is gone, 2026-10-30: it smeared the outline.
						-- The edge's raggedness is now the cut's own wobble, EDGE_WOB)
						setTr(c, 1 - a)
						-- The shade across the funnel as seen, as a gradient on each card (2026-10-30).
						-- Every body puff spans the whole funnel, so shading each by its own centre's
						-- angle mixed lit and shadowed puffs everywhere into one flat grey (the murk).
						-- Each card now carries the column's own light profile across its width: the
						-- surface normal at each point across the silhouette (a cylinder seen from the
						-- camera) against the sun, the directional sky light and, backlit, the bright rim
						-- of forward-scattered sun. Overlapping cards agree, so the terminator shows.
						local L = if f < 0.5 then r0.L else r1.L
						local axS, ayS = d3:Dot(camR), d3:Dot(camU)
						local aL = sqrt(axS * axS + ayS * ayS)
						if aL < 1e-4 then
							axS, ayS, aL = 0, 1, 1
						end
						axS, ayS = axS / aL, ayS / aL
						local acrossW = camR * ayS - camU * axS -- (across the axis on screen, toward screen right)
						local P0 = C.toWorldAbout(e.x + ax, e.y + ay, alt, ex, ey, ks)
						local oc = (Pe - P0):Dot(acrossW) / max(rc * ks, 1e-3)
						local wr = w / max(rc, 1e-3)
						local ahx, ahy, tcx, tcy, back = frameAt(acrossW, P0)
						local bgL, bgR = r0.bgL + (r1.bgL - r0.bgL) * f, r0.bgR + (r1.bgR - r0.bgR) * f
						local mr, mg, mb = 0, 0, 0
						for k = 1, GN do
							local col = shadeX(L, clamp(oc + (GT[k] - 0.5) * wr, -1, 1), ahx, ahy, tcx, tcy, back, z, flare, bgL, bgR)
							gcol[k] = col
							mr, mg, mb = max(mr, col.R), max(mg, col.G), max(mb, col.B)
						end
						setCol(c, Color3.new(mr, mg, mb))
						-- The outline (2026-10-30): each card's transparency is cut at the funnel's edge
						-- as seen, x = +-1 across the axis, over EDGE_FADE of the radius - a real
						-- condensation funnel's edge is sharp (the optical depth across it is ~13: it goes
						-- from opaque to clear within ~2% of the radius), and the puffs' summed soft
						-- falloffs spread it over half the radius. The cut wobbles along the funnel and in
						-- time (EDGE_WOB, a noise field drifting with the turn): ragged, not a tube. The
						-- image turns with the axis (0 or 180 degrees off it), so the gradient runs exactly
						-- across the card and its positions map to the funnel's x.
						local acrossDeg = math.deg(math.atan2(axS, ayS))
						setRot(c, acrossDeg + (if sd2 > 0.5 then 180 else 0))
						local eL, eR = edgesAt(z, rcz)
						local hwE = EDGE_FADE + 0.35 * (1 - A) + 0.6 * flare
						if not tat then
							-- (fill: cut softly at 0.75 of the edge, under the ribbons)
							local k75 = 1 - 0.25 * wR
							eL, eR, hwE = eL * k75, eR * k75, hwE + (0.2 - hwE) * wR
						end
						setGrad(c, mr, mg, mb, acrossDeg - (c.rot0 or 0),
							0.5 + (eL - oc) / wr, 0.5 + (eR - oc) / wr, hwE / wr) -- (soft where the funnel is thin - an edge is only as sharp as the cloud is optically thick - and where it widens into the lowering, the same cloud as the base)
					end
					n += 1
				end
				-- The outline (2026-10-31): two chains of ribbons, one down each side of the silhouette.
				-- Each is tilted to its own side's slope on screen (a cone's two sides lean apart), so the
				-- edge follows the taper and the bends; the fill no longer reaches it. A ribbon is flat
				-- across - the gradient cuts the edge sharply outside and fades softly inside, well past
				-- the axis, under the other side's ribbon - and fades over its outer thirds along the
				-- funnel; ribbons spaced a third of their length apart cover every point near evenly
				-- (about 1-(1-a)^2 everywhere), so no seam shows. They sit at the axis's depth and share
				-- the fill's light profile. (Funnel-wide cards that each cut the edge banded at every
				-- height tried: tall ones stepped on a taper or bend, short ones had to be near opaque
				-- each and every one showed as a stripe, its end a tooth on the edge.)
				-- Spacing: even in a cost that adds the turn of the axis on screen and the change of
				-- radius to the length, so bends and flares get more, shorter ribbons (2026-10-31: evenly
				-- spaced, a rope's bends were drawn by long straight pieces - corners)
				local NS = NEDGE // 2
				local eBase = NGAS + NLUMP + NSTRI
				local function axisPt(sq: number): (Vector3, number, number, any, any, number)
					local z = zOfArc(sq)
					local rc, ax, ay, gz, r0, r1, f = rowAt(z)
					return C.toWorldAbout(e.x + ax, e.y + ay, altitude(z, gz, H), ex, ey, ks), z, rc, r0, r1, f
				end
				local KS = 33
				local cumC, sxs_, sys2, rcs = gs.cumC, gs.sxs_, gs.sys2, gs.rcs
				if not cumC then
					cumC, sxs_, sys2, rcs = table.create(KS, 0), table.create(KS, 0), table.create(KS, 0), table.create(KS, 1)
					gs.cumC, gs.sxs_, gs.sys2, gs.rcs = cumC, sxs_, sys2, rcs
				end
				for j = 1, KS do
					local P, _, rcj = axisPt((j - 1) / (KS - 1))
					sxs_[j], sys2[j], rcs[j] = P:Dot(camR), P:Dot(camU), max(rcj, 1)
				end
				local function turnAt(j: number): number
					if j <= 1 or j >= KS then
						return 0
					end
					local ux1, uy1 = sxs_[j] - sxs_[j - 1], sys2[j] - sys2[j - 1]
					local ux2, uy2 = sxs_[j + 1] - sxs_[j], sys2[j + 1] - sys2[j]
					if ux1 * ux1 + uy1 * uy1 < 1e-6 or ux2 * ux2 + uy2 * uy2 < 1e-6 then
						return 0
					end
					return math.abs(math.atan2(ux1 * uy2 - uy1 * ux2, ux1 * ux2 + uy1 * uy2))
				end
				cumC[1] = 0
				for j = 1, KS - 1 do
					cumC[j + 1] = cumC[j] + 1 / (KS - 1) + 1.5 * 0.5 * (turnAt(j) + turnAt(j + 1))
						+ 1.5 * math.abs(math.log(rcs[j + 1] / rcs[j]))
				end
				local gap = cumC[KS] / (NS - 3)
				-- the length fraction at cost cc, and its rate (extended straight past the ends)
				local function sOfCost(cc: number): (number, number)
					local j = 1
					while j < KS - 1 and cumC[j + 1] < cc do
						j += 1
					end
					local dc = max(cumC[j + 1] - cumC[j], 1e-6)
					local rate = (1 / (KS - 1)) / dc
					return (j - 1) / (KS - 1) + (cc - cumC[j]) * rate, rate
				end
				local Xs = { -0.6, -0.3, 0, 0.3, 0.6, 0.8, 0.92 }
				local pos, cols = table.create(12, 0), table.create(12, 0)
				for side = -1, 1, 2 do
					for k = 1, NS do
						local c = gs.cards[eBase + (if side < 0 then 0 else NS) + k]
						-- centres from one spacing below the foot to one above the top
						local sC, rate = sOfCost((k - 2) * gap)
						local dS = gap * rate
						local sM = clamp(sC, 0, 1)
						local sA, sB = max(0, sM - 0.5 * dS), min(1, sM + 0.5 * dS)
						if sB - sA < 1e-4 then
							sA, sB = max(0, sM - 0.02), min(1, sM + 0.02)
						end
						local PA, zA, rcA, a0, a1, fA = axisPt(sA)
						local PB, zB, rcB, b0, b1, fB = axisPt(sB)
						local PM, zM, rcM, r0, r1, f = axisPt(sM)
						-- the widest the funnel gets along the ribbon's whole length
						local _, _, rcLo = axisPt(clamp(sC - 1.5 * dS, 0, 1))
						local _, _, rcHi = axisPt(clamp(sC + 1.5 * dS, 0, 1))
						local kW = clamp(max(rcLo, rcHi, rcA, rcB, rcM) / max(rcM, 1e-3), 1, 1.6)
						-- the axis on screen here, and across it (toward screen right)
						local dW = PB - PA
						local axS, ayS = dW:Dot(camR), dW:Dot(camU)
						local aL = sqrt(axS * axS + ayS * ayS)
						local projL = clamp(aL / max(dW.Magnitude, 1e-3), 0, 1)
						if aL < 1e-4 then
							axS, ayS, aL = 0, 1, 1
						end
						axS, ayS = axS / aL, ayS / aL
						local acrossW = camR * ayS - camU * axS
						-- the edge (its wobble included) at both ends and the middle; xe: its distance
						-- from the axis in radii
						local function edgePt(P: Vector3, z: number, rc: number, q0: any, q1: any, qf: number): (Vector3, number)
							local eL, eR = edgesAt(z, q0.rcz + (q1.rcz - q0.rcz) * qf)
							local xe = if side < 0 then -eL else eR
							return P + acrossW * (side * rc * ks * xe), xe
						end
						local EA = edgePt(PA, zA, rcA, a0, a1, fA)
						local EB = edgePt(PB, zB, rcB, b0, b1, fB)
						local EM, xeM = edgePt(PM, zM, rcM, r0, r1, f)
						local Ew = (EB - EA) / max(sB - sA, 1e-6) -- (the edge per unit of length fraction)
						local ux, uy = Ew:Dot(camR), Ew:Dot(camU)
						local uL = sqrt(ux * ux + uy * uy)
						local dxN, dyN = axS, ayS
						if uL > 1e-4 then
							dxN, dyN = ux / uL, uy / uL
						end
						-- Across the ribbon, outward from the axis in radii (rcM): from xI inside to 0.25 past
						-- the edge. The ribbon is a rectangle along the edge, so where the funnel widens
						-- along it its inner side moves out with the edge: it is made wide enough (kW, the
						-- widest radius it spans) to stay opaque 0.3 radii past the axis everywhere -
						-- shorter, a tapered funnel's two sides left a sawtooth gap down the middle (the
						-- zipper)
						local wOp = (xeM + 0.3) * kW
						local xI, xO = xeM - wOp - 0.25 * kW, xeM + 0.25
						local span = xO - xI
						local outW = (camR * dyN - camU * dxN) * side
						setPos(c, EM + Ew * (sC - sM) - outW * ((xeM - 0.5 * (xI + xO)) * rcM * ks))
						setSize(c, span * rcM * ks, max(3 * dS * uL, 0.5))
						local cond = r0.cond + (r1.cond - r0.cond) * f
						local fadeTop = r0.fadeTop + (r1.fadeTop - r0.fadeTop) * f
						local rcz = r0.rcz + (r1.rcz - r0.rcz) * f
						local flare = r0.flare + (r1.flare - r0.flare) * f
						local A = opacityAt(rcM, rcz, cond, fadeTop)
						-- (the ribbons give way to the fill where the funnel is seen end-on, and above the top)
						local Ar = A * smooth(0.2, 0.45, projL) * (1 - smooth(0.97, 1 + dS, sC))
						if Ar < 0.005 then
							setTr(c, 1)
						else
							-- (two ribbons cover each point: each 1 - sqrt(1 - Ar), together Ar)
							setTr(c, sqrt(1 - Ar))
							local L = if f < 0.5 then r0.L else r1.L
							local ahx, ahy, tcx, tcy, back = frameAt(acrossW, PM)
							local bgL, bgR = r0.bgL + (r1.bgL - r0.bgL) * f, r0.bgR + (r1.bgR - r0.bgR) * f
							-- the shade's keypoints: the card's ends, the same funnel x on both sides (Xs,
							-- outward), the edge
							local n = 1
							pos[1], cols[1] = 0, xI
							for _, X in Xs do
								if X > xI + 0.02 and X < xeM - 0.04 then
									n += 1
									pos[n], cols[n] = (X - xI) / span, X
								end
							end
							n += 1
							pos[n], cols[n] = (xeM - xI) / span, xeM
							n += 1
							pos[n], cols[n] = 1, xO
							for q = n + 1, #pos do
								pos[q] = nil
							end
							local mr, mg, mb = 0, 0, 0
							for q = 1, n do
								local col = shadeX(L, clamp(side * cols[q], -1, 1), ahx, ahy, tcx, tcy, back, zM, flare, bgL, bgR)
								gcol[q] = col
								mr, mg, mb = max(mr, col.R), max(mg, col.G), max(mb, col.B)
							end
							setCol(c, Color3.new(mr, mg, mb))
							-- the image's up along the edge, its right outward (the gradient runs outward)
							local rot = math.deg(math.atan2(dxN, dyN)) + (if side < 0 then 180 else 0)
							setRot(c, rot)
							setGrad(c, mr, mg, mb, rot - (c.rot0 or 0),
								(xeM - wOp - 0.1 * kW - xI) / span, (xeM - xI) / span, 0.1 * kW / span,
								(EDGE_FADE + 0.35 * (1 - A) + 0.6 * flare) / span, pos)
						end
					end
				end
				-- Detail layers (the 500 budget, 2026-10-30). Both read the same rows as the body and
				-- show only on the near face, so the outline stays the body's soft edge:
				-- (a) surface lumps: smaller soft puffs just under the surface, carried round by the
				-- flow and bulging together on one noise field read at the flow's own coordinates
				-- (angle carried, place along the funnel), so lumps roll round as structures and the
				-- sun picks out their relief - the turbulent texture the even body lacks;
				-- (b) striations: faint streaks lying along the flow (the turn plus the rise),
				-- appearing and fading as they climb - the fine motion that shows the spin.
				gs.riseW = (gs.riseW + 1.6 * riseW / max(arcL, 50) * vDt) % 1
				local detail = d < 9000 and ctx.state.tornadoDetail ~= false -- (farther, each is a few pixels: hidden)
				for j = 1, NLUMP + NSTRI do
					local i = NGAS + j
					local c = gs.cards[i]
					local stri = j > NLUMP
					local sd = gs.seed[i]
					local s = (gs.phase[i] + (if stri then gs.riseW else gs.rise)) % 1
					local z = zOfArc(s)
					local rc, ax, ay, gz, r0, r1, f = rowAt(z)
					local cond = r0.cond + (r1.cond - r0.cond) * f
					local fadeTop = r0.fadeTop + (r1.fadeTop - r0.fadeTop) * f
					local thinH = r0.thinH + (r1.thinH - r0.thinH) * f
					local omega = r0.omega + (r1.omega - r0.omega) * f
					local rcz = r0.rcz + (r1.rcz - r0.rcz) * f
					local flare = r0.flare + (r1.flare - r0.flare) * f
					local theta = (gs.th[i] + omega * vDt) % (2 * math.pi)
					gs.th[i] = theta
					local cs, sn = cos(theta), sin(theta)
					local ring = rc - thin * min(0.7 * rcz, rc)
					local A = clamp(max(1 - exp(-2 * BETA * rc), 0.995) * cond * fadeTop * life
						* (1 - exp(-2 * BETA * ring)) / max(1 - exp(-2 * BETA * rc), 1e-3), 0, 1)
					local env = smooth(0, 0.04, s) * (1 - smooth(0.93, 1, s))
					local L = if f < 0.5 then r0.L else r1.L
					local facing = cs * sxs + sn * sys_
					local ndl = facing * cosEl + 0.35 * sinEl
					local alt = altitude(z, gz, H)
					if not detail or A * env < 0.02 or rc < 2 then
						setTr(c, 1)
					elseif not stri then
						-- (lumps ~1.2 core radii tall, ~5 round the funnel; evolving slowly)
						local lam = max(25, 1.2 * rcz)
						local rho = clamp(rc / lam, 0.6, 3)
						local bump = clamp(2.2 * math.noise(cs * rho + 3.1, sn * rho - 1.7, s * arcL / lam + nowL * 0.03), -1, 1)
						local rr = rc * (0.7 + 0.1 * bump)
						local Pe = C.toWorldAbout(e.x + ax + cs * rr, e.y + ay + sn * rr, alt, ex, ey, ks)
						setPos(c, Pe)
						-- (faded toward the sides: lumps there would stick out of the outline -
						-- the cauliflower edge, 2026-10-30)
						local outW = C.toWorldAbout(e.x + ax + cs * (rr + 1), e.y + ay + sn * (rr + 1), alt, ex, ey, ks) - Pe
						local face = clamp((outW.Unit:Dot((camPos - Pe).Unit) - 0.25) / 0.5, 0, 1)
						local w = max(3, rc * (0.45 + 0.08 * bump + 0.06 * sd)) -- (half a radius, 2026-10-31: at ~1 rc a lump spanned a narrowing funnel's whole width and showed as a dark plate past its outline)
						local hs = min(max(w * 0.85, 2.5 * arcL / NLUMP), 3 * w)
						setSize(c, w * ks, hs * ks)
						setRot(c, c.baseRot + 15 * bump)
						local op = A * 0.15 * (1 + 0.3 * math.abs(bump)) * env * face * (1 - flare) * (1 - 0.6 * thinH) -- (flare: gone where the funnel widens into the lowering - at 0.3 left there they drew a pale crown on the cone, 2026-10-30)
						setTr(c, 1 - clamp(op, 0, 0.2))
						-- (relief about the body's own shade: bulges catch more sun, hollows less. Lit
						-- brighter than the body on average, they drew pale round blotches, 2026-10-30)
						-- (more range than the body: these carry the larger turning structures - darker
						-- masses and lit turbulent regions, review 2026-10-30)
						local sunAmt = L.sun * (0.12 + 0.62 * clamp(ndl, 0, 1)) * (0.92 + 0.12 * bump) -- (bulges no brighter than the body: pale blobs, 2026-10-30)
						local skyAmt = L.sky * 0.72 * (0.95 + 0.07 * bump) * (1 + SKY_K * sdA * (cs * sdx + sn * sdy))
						setCol(c, colour(L, sunAmt, skyAmt, z))
					else
						local rr = rc * (0.88 + 0.08 * sd)
						local x0, y0 = e.x + ax + cs * rr, e.y + ay + sn * rr
						local Pw = C.toWorldAbout(x0, y0, alt, ex, ey, ks)
						setPos(c, Pw)
						local fade = math.sin(math.pi * ((s * 4 + sd) % 1)) ^ 1.5
						local op = 0.38 * A * fade * env * (1 - flare) * (1 - 0.8 * thinH)
						if op < 0.01 then
							setTr(c, 1)
						else
							-- the flow's direction as seen (counter-clockwise turn, 1.6 x the surface rise);
							-- only on the middle of the near face, and no longer than the distance to the
							-- silhouette (at the edge the flow points at the camera and streaks pinwheel)
							local vt = max(omega * rr, 0.1)
							local st = 0.05 * max(rr, 1)
							local Pt = C.toWorldAbout(x0 - sn * st, y0 + cs * st, alt + st * 1.6 * riseW / vt, ex, ey, ks)
							local d3 = Pt - Pw
							local sx, sy = d3:Dot(camR), d3:Dot(camU)
							local onS = sqrt(sx * sx + sy * sy) / max(d3.Magnitude, 1e-4)
							local outV = C.toWorldAbout(x0 + cs, y0 + sn, alt, ex, ey, ks) - Pw
							local fd = outV.Unit:Dot((camPos - Pw).Unit)
							local front = clamp((fd - 0.55) / 0.3, 0, 1)
							-- (2026-10-31: thinner for their length and longer - at 0.3 thick, lit paler than the
							-- body, they stacked up the face as separate pale dashes, a loosened roll of stamps,
							-- seen from above most of all. Now fine grooves and ridges in the body's own shade)
							local len = min(1.2 * rc + 15, 1.5 * rc * max(fd, 0))
							local thick = 0.16 * len
							setSize(c, max(thick * 1.2, len * (0.25 + 0.75 * onS)) * ks, thick * ks)
							setRot(c, -math.deg(math.atan2(sy, sx)))
							setTr(c, 1 - clamp(op * front * onS, 0, 0.22))
							-- (the body's light at this point - its sun and directional sky terms - times a relief:
							-- half are ridges catching a little more light, half grooves a little less)
							local relief = if sd < 0.5 then 0.86 else 1.12
							setCol(c, colour(L, L.sun * (0.12 + 0.62 * clamp(ndl, 0, 1)) * relief,
								L.sky * 0.72 * (1 + SKY_K * sdA * (cs * sdx + sn * sdy)) * relief, z))
						end
					end
					n += 1
				end
			end
			if style == "smoke" then
				-- The smoke body (see NSMB): body sprites at a stratified place along the funnel's
				-- length, carried up it with the surface flow and round it at the flow's turn at their
				-- height, within ~0.55 rc of the axis and ~1.4 rc wide, so their frayed fringes make the
				-- outline. Each takes one flat colour:
				-- the column's light where it sits on screen, varied by its own place round the axis, so
				-- the turning masses read as lighter and darker smoke (one colour for all flattened the
				-- texture away).
				local sm = set.sm
				local arcL = arcS[NA + 1]
				-- (the body climbs at the column's mean updraft at its surface - the field's, not a
				-- fixed share of the swirl; each puff can't climb at its own height's rate without
				-- bunching where it is slow, so it is one rate for all)
				local wSum, wN = 0, 0
				for i = 0, NZ do
					local r = tab[i]
					if r.cond > 0.05 then
						wSum += r.wUp
						wN += 1
					end
				end
				local wBody = if wN > 0 then wSum / wN else riseW
				sm.rise = (sm.rise + wBody / max(arcL, 50) * vDt) % 1
				-- per row: the axis on screen (along, unit) and the horizontal frame across it
				local fr = sm.fr or {}
				sm.fr = fr
				for i = 0, NZ do
					local a, b = tab[max(i - 1, 0)], tab[min(i + 1, NZ)]
					local PA = C.toWorldAbout(e.x + a.ax, e.y + a.ay, altitude(a.z, a.gz, H), ex, ey, ks)
					local PB = C.toWorldAbout(e.x + b.ax, e.y + b.ay, altitude(b.z, b.gz, H), ex, ey, ks)
					local dW = PB - PA
					local ux, uy = dW:Dot(camR), dW:Dot(camU)
					local uL = sqrt(ux * ux + uy * uy)
					local q = fr[i] or {}
					fr[i] = q
					q.proj = clamp(uL / max(dW.Magnitude, 1e-3), 0, 1)
					if uL < 1e-4 then
						ux, uy, uL = 0, 1, 1
					end
					ux, uy = ux / uL, uy / uL
					q.ux, q.uy = ux, uy
					local acrossW = camR * uy - camU * ux
					local ahx, ahy = acrossW.X, -acrossW.Z
					local al = sqrt(ahx * ahx + ahy * ahy)
					local P0 = (PA + PB) * 0.5
					local tcW = camPos - P0
					local tcx, tcy = tcW.X, -tcW.Z
					if al > 1e-3 then
						ahx, ahy = ahx / al, ahy / al
						local dp = tcx * ahx + tcy * ahy
						tcx, tcy = tcx - dp * ahx, tcy - dp * ahy
					else
						ahx, ahy = 1, 0
					end
					local tl = sqrt(tcx * tcx + tcy * tcy)
					if tl > 1e-3 then
						tcx, tcy = tcx / tl, tcy / tl
					else
						tcx, tcy = -ahy, ahx
					end
					q.acrossW, q.ahx, q.ahy, q.tcx, q.tcy = acrossW, ahx, ahy, tcx, tcy
					q.back = if tcW.Magnitude > 1e-3 then max(0, -(tcW.Unit:Dot(sunV))) ^ 3 else 0
				end
				-- the light at x across the silhouette (-1 .. 1), its normal turned toward (vx, vy) by vk
				local function shadeAt(L: any, q: any, x: number, vx: number, vy: number, vk: number, z: number): Color3
					local ny = sqrt(max(0, 1 - x * x))
					local nx_, ny_ = x * q.ahx + ny * q.tcx, x * q.ahy + ny * q.tcy
					nx_, ny_ = nx_ + vk * (vx - nx_), ny_ + vk * (vy - ny_)
					local ndl = (nx_ * sxs + ny_ * sys_) * cosEl + 0.35 * sinEl
					local x4 = x * x * x * x
					local sunAmt = L.sun * ((0.12 + 0.62 * clamp(ndl, 0, 1)) + 0.7 * q.back * x4)
					local skyAmt = L.sky * 0.72 * (1 + SKY_K * sdA * (nx_ * sdx + ny_ * sdy)) * (0.86 + 0.14 * ny)
					return colour(L, sunAmt, skyAmt, z)
				end
				for i = 1, NSMB do
					local c = sm.cards[i]
					local sd, sd2 = sm.seed[i], sm.seed2[i]
					-- the place along the funnel: from a little under the ground (where each one starts
					-- its climb, unseen) to just past the top (where it fades into the lowering)
					local su = (sm.phase[i] + sm.rise) % 1
					local sq = -0.05 + 1.1 * su
					local z = zOfArc(clamp(sq, 0, 1))
					local rc, ax, ay, gz, r0, r1, f = rowAt(z)
					-- (the frame row nearest z)
					local q = sm.fr[clamp(math.floor((clamp(z / top, 0, 1) ^ (1 / 1.15)) * NZ + 0.5), 0, NZ)]
					local cond = r0.cond + (r1.cond - r0.cond) * f
					local fadeTop = r0.fadeTop + (r1.fadeTop - r0.fadeTop) * f
					local rcz = r0.rcz + (r1.rcz - r0.rcz) * f
					local flare = r0.flare + (r1.flare - r0.flare) * f
					local omega = r0.omega + (r1.omega - r0.omega) * f
					local ring = rc - thin * min(0.7 * rcz, rc)
					local A = max(1 - exp(-2 * BETA * rc), 0.995) * cond * fadeTop * life
						* (1 - exp(-2 * BETA * ring)) / max(1 - exp(-2 * BETA * rc), 1e-3)
					A = clamp(max(A, 0.3 * thin * cond * fadeTop * life), 0, 0.997)
					local env = 1 - smooth(1, 1.05, sq)
					local alt = altitude(z, gz, H) + min(sq, 0) * arcL -- (under the ground before its climb)
					local L = if f < 0.5 then r0.L else r1.L
					local theta = (sm.th[i] + omega * vDt) % (2 * math.pi)
					sm.th[i] = theta
					local cs, sn = cos(theta), sin(theta)
					if A * env < 0.01 or rc < 1 then
						setTr(c, 1)
					else
						-- (how rope-like the funnel is here: its radius against its length. A thick funnel
						-- is drawn with the smooth puff - a defined soft outline, the lit and shadow sides;
						-- a rope with the haze puff, near one tone - the smooth puff's rim drew a rope in
						-- rings. Each sprite changes over at its own point, so a funnel thinning into a
						-- rope changes over gradually. 2026-10-31: haze everywhere made the cone and
						-- stovepipe cloudy, user)
						local ropeK = 1 - smooth(0.04, 0.1, rc / max(arcL, 1))
						local haze = ropeK > 0.15 + 0.7 * sd2
						local want = if haze then sm.texH else sm.texS
						if sm.cur[i] ~= want then
							sm.cur[i] = want
							c.img.Image = want
						end
						-- body: within 0.2 rc of the axis (a shell in a two-celled core). Each smooth puff
						-- 2.7-3 rc wide, its rim (~0.3 of the frame out) at the edge; each haze puff
						-- 3.4-3.8 rc wide, its alpha ~0.17 at rc, so the stacked layers fade out round the
						-- edge. (2026-10-31: within 0.45 rc and 2-2.4 rc wide, the
						-- side puffs' fringes reached ~1.3 rc - a broad haze with no outline, user)
						local rf = 0.2 * sqrt(sd2)
						rf += (0.7 + 0.25 * sd2 - rf) * thin
						local rr = rf * rc
						setPos(c, C.toWorldAbout(e.x + ax + cs * rr, e.y + ay + sn * rr, alt, ex, ey, ks))
						local w = max(3, rc * (if haze then 3.4 + 0.4 * sd else 2.7 + 0.3 * sd))
						-- (long enough that each point of the funnel's length has ~8 over it; a rope is many
						-- radii long, so its sprites stretch along it, at most 3 x as long as wide so the
						-- smooth puff's ends stay round. 2026-10-31: with ~3 over each point, each near the
						-- opacity cap, every puff's rim showed - a rope in rings like a caterpillar)
						local hs = if haze then min(max(0.9 * w, 8 * arcL / NSMB), 3 * w) else min(max(0.9 * w, 3 * arcL / NSMB), 4 * w)
						setSize(c, w * ks, hs * ks)
						-- (how many overlap a point: never more than all of them - a wedge is shorter than
						-- its sprites. K 6: the haze puff's alpha averages ~0.15 of its card, so each card
						-- takes ~6 x the plain share; the fibrous sheet, ~0.1, took 10)
						local nEff = max(1, NSMB * min(hs, arcL) / max(arcL, 1))
						-- (K 3.5 and cap 0.6 for the smooth puff, ~0.3 of its card covered)
						local op = if haze then min(SM_OPMAX, 1 - (1 - A) ^ (6 / nEff)) else min(0.6, 1 - (1 - A) ^ (3.5 / nEff))
						op *= env * (1 - 0.6 * flare)
						setTr(c, 1 - op)
						-- up along the axis on screen, each sprite turned a little its own way, drifting -
						-- less the more it is stretched (2026-10-31: a 4:1 rope sprite tilted 25 deg stuck
						-- out sideways, a knobbly outline; now ~3 deg at 4:1)
						local tw = (hs / w) ^ -1.5
						local rot = math.deg(math.atan2(q.ux, q.uy)) + ((sd - 0.5) * 50 + 8 * sin(nowL * 0.15 + 6.28 * sd2)) * tw
						setRot(c, rot)
						-- (near one tone, as the Severity funnels: its side of the axis on screen shifts it a
						-- little toward the lit or the shadow side, and a puff off to the side is ~8% darker -
						-- their darker band inside the edge. 2026-10-31: the full lit/shadow swing and a
						-- per-puff tint drew each smooth puff's rim as a tone step - arcs up the funnel, and
						-- light/dark blotches down a rope)
						-- (a smooth puff on a thick funnel: the full lit/shadow side and its own place round
						-- the axis, +-7% - the turning masses, as they looked before the haze, user)
						local xs = clamp(rf * (cs * q.ahx + sn * q.ahy) / 0.2, -1, 1)
						local col, var
						if haze then
							col = shadeAt(L, q, 0.3 * xs, 0, 0, 0, z)
							var = 1 - 0.08 * math.abs(xs)
						else
							local thick = smooth(8, 30, rc)
							col = shadeAt(L, q, 0.85 * xs, cs, sn, 0.3 * thick, z)
							var = 1 + (0.14 * sd - 0.07) * thick
						end
						setCol(c, Color3.new(min(1, col.R * var), min(1, col.G * var), min(1, col.B * var)))
					end
					n += 1
				end
				-- the ascending filaments: each rides its own helix on the surface for a few seconds -
				-- turning at the swirl, climbing at the updraft where it is - then starts again elsewhere.
				-- Soft streaks along the flow in the body's own shade (+-6%), faint, on the near face
				-- only (fading before the outline: edge strands drew a dark stripe there), fewer on a
				-- rope (the Severity ropes are smooth). Shift+T hides them (the detail toggle).
				local detail = d < 9000 and ctx.state.tornadoDetail ~= false
				for j = 1, NFIL do
					local c = sm.cards[NSMB + j]
					local sd = sm.seed[NSMB + j]
					local age = sm.fage[j] + vDt
					if age >= sm.flife[j] or sm.fs[j] > 0.97 then
						age = 0
						sm.fs[j] = math.random() * 0.85
						sm.fth[j] = math.random() * 2 * math.pi
						sm.flife[j] = 3 + 4 * math.random()
					end
					sm.fage[j] = age
					local s = sm.fs[j]
					local z = zOfArc(s)
					local rc, ax, ay, gz, r0, r1, f = rowAt(z)
					local wUp = r0.wUp + (r1.wUp - r0.wUp) * f
					local omega = r0.omega + (r1.omega - r0.omega) * f
					sm.fs[j] = s + wUp * vDt / max(arcL, 50)
					local theta = (sm.fth[j] + omega * vDt) % (2 * math.pi)
					sm.fth[j] = theta
					local cond = r0.cond + (r1.cond - r0.cond) * f
					local fadeTop = r0.fadeTop + (r1.fadeTop - r0.fadeTop) * f
					local rcz = r0.rcz + (r1.rcz - r0.rcz) * f
					local flare = r0.flare + (r1.flare - r0.flare) * f
					local ring = rc - thin * min(0.7 * rcz, rc)
					local A = clamp(max(1 - exp(-2 * BETA * rc), 0.995) * cond * fadeTop * life
						* (1 - exp(-2 * BETA * ring)) / max(1 - exp(-2 * BETA * rc), 1e-3), 0, 1)
					local u = age / sm.flife[j]
					local lf = smooth(0, 0.2, u) * (1 - smooth(0.6, 1, u))
					local env = smooth(0, 0.03, s) * (1 - smooth(0.85, 0.97, s)) * (1 - flare)
					local ropeK = 1 - smooth(0.04, 0.1, rc / max(arcL, 1))
					local k0 = A * lf * env * (1 - 0.75 * ropeK)
					if not detail or k0 < 0.01 or rc < 2 then
						setTr(c, 1)
					else
						local cs, sn = cos(theta), sin(theta)
						local rr = rc * 0.92
						local x0, y0 = e.x + ax + cs * rr, e.y + ay + sn * rr
						local alt = altitude(z, gz, H)
						local Pw = C.toWorldAbout(x0, y0, alt, ex, ey, ks)
						setPos(c, Pw)
						-- the flow's direction here (counter-clockwise turn + the updraft), as seen
						local vt = max(omega * rr, 0.1)
						local st = 0.05 * max(rr, 1)
						local Pt = C.toWorldAbout(x0 - sn * st, y0 + cs * st, alt + st * wUp / vt, ex, ey, ks)
						local d3 = Pt - Pw
						local sx, sy = d3:Dot(camR), d3:Dot(camU)
						local onS = sqrt(sx * sx + sy * sy) / max(d3.Magnitude, 1e-4)
						local outV = C.toWorldAbout(x0 + cs, y0 + sn, alt, ex, ey, ks) - Pw
						local fd = outV.Unit:Dot((camPos - Pw).Unit)
						local front = clamp((fd - 0.15) / 0.45, 0, 1)
						-- long ribbons, not dashes (short separate streaks read as a roll of stamps)
						local len = (1.3 + 0.5 * sd) * rc + 10
						local wid = 0.22 * len
						setSize(c, max(wid * 1.2, len * (0.3 + 0.7 * onS)) * ks, wid * ks)
						setRot(c, -math.deg(math.atan2(sy, sx)))
						setTr(c, 1 - clamp(0.2 * k0 * front, 0, 0.2))
						local q = sm.fr[clamp(math.floor((clamp(z / top, 0, 1) ^ (1 / 1.15)) * NZ + 0.5), 0, NZ)]
						local L = if f < 0.5 then r0.L else r1.L
						local xs = clamp(cs * q.ahx + sn * q.ahy, -1, 1)
						local col = shadeAt(L, q, 0.85 * xs, cs, sn, 0.3 * smooth(8, 30, rc), z)
						local var = if sd < 0.5 then 0.94 else 1.06
						setCol(c, Color3.new(min(1, col.R * var), min(1, col.G * var), min(1, col.B * var)))
					end
					n += 1
				end
			end
		end

		local prevRc, prevZ = nil, 0 -- (the height below: how fast the funnel narrows downward)
		for h = 1, (if spiral then 0 else ND), step do
			local u = ((h - 0.5) / ND) ^ 1.15 -- (a little denser low down)
			local z = u * top
			-- the gap to the next height: where the column is narrower than that, cards are drawn
			-- taller than wide so the stack stays continuous (a streaky rope, not a string of dots)
			local dz = (((h + 0.5) / ND) ^ 1.15 - u) * top * step
			local rcz = Vortex.rcAt(p, min(z, H))
			-- (the cap on the drawn radius widens toward the cloud base: there the condensed radius
			-- runs away - the pressure fall needed to condense vanishes - and the funnel spreads into
			-- the lowering. A fixed 3 core radii cap made a round bulb under the base.)
			-- (the extra spread is kept within half the lowering it hangs from: a wedge's 5 core radii
			-- were ~1 km more each side, wider than the wall cloud, and drew one dark wall - real
			-- funnels stay narrow next to their lowering, docs/storm-reference/real/06_*)
			local cap = rcz * 3 + min(5 * rcz, max(0, 0.5 * wallR - rcz * 3)) * smooth(zAt(0.6), H, z)
			local rc = if z >= H * 0.995 then cap else min(Vortex.condensationRadius(e, min(z, H * 0.995)), cap)
			-- a card may hang only as far as the funnel stays at least half this wide: the taper
			-- (radius gained a metre of height) from the height below. Without it a 2 km wide slice
			-- of the flare was drawn ~1 km tall and hung to the ground: a wide funnel aloft over a
			-- narrow or uncondensed one below drew as one opaque dome (2026-10-29)
			local taper = if prevRc then max(0, (rc - prevRc) / max(z - prevZ, 1)) else 0
			local hangMax = rc / max(taper, 1e-3)
			prevRc, prevZ = rc, z
			local ax, ay = Vortex.axisAt(e, min(z, H))
			local cx, cy = e.x + ax, e.y + ay
			-- the stretch of axis this height stands for, along the curve: a tilted, snaking rope
			-- is longer than its height, so cards sized by dz left gaps and it read as a string
			-- of beads (2026-10-29)
			-- (over the span centred on z, the one the card covers and its lean is taken over)
			local zSB = min(z + 0.5 * dz, H)
			local zSA = max(0, zSB - dz)
			local axS, ayS = Vortex.axisAt(e, zSA)
			local ax2, ay2 = Vortex.axisAt(e, zSB)
			local segL = sqrt((ax2 - axS) ^ 2 + (ay2 - ayS) ^ 2 + (zSB - zSA) ^ 2)
			local gz = C.groundAt(cx, cy) -- (the ground under this height's axis point)
			-- the ring turns with the flow at its radius
			local Rn = max(rc, 1) * 0.45 / max(5, rcz)
			local omega = min(e.vc / max(20, rcz) * Vortex.profile(max(Rn, 0.05)) / max(Rn, 0.05), 2.5)
			-- (each height drawn this frame turns by this frame's time whatever the LOD step: with
			-- x step the far LOD, d > 12 km, spun twice as fast)
			set.spin[h] = (set.spin[h] + omega * vDt) % (2 * math.pi)
			-- the surface's rise, integrated (a rate x clock product jumped whenever vc changed)
			set.rise[h] = ((set.rise[h] or 0) + riseW / max(dz, 4) * 0.6 * vDt) % 1
			local row = set.cards[h]
			-- (inside the cloud base the funnel is lost in the cloud: it reaches the base, so it
			-- hangs from it, and is gone just above)
			local fadeTop = 1 - smooth(H * 0.9, H * 1.02, z)
			-- where it flares into the lowering the funnel spreads sideways (cards much wider than
			-- tall), so it meets the cloud as a broad skirt, not a round bulb; and it thins there,
			-- toward the lowering's own cover, so it merges into the cloud rather than standing
			-- in front of it as a darker mass
			local flare = smooth(zAt(0.55), H * 1.0, z)
			local flat = 1 - 0.8 * flare
			-- (the two-celled core is dry only inside ~0.7 core radii: a funnel condensed far past
			-- that - a wedge - is a thick shell, still opaque, and a shell keeps crisp sides (the
			-- sight line grazing its edge runs through the most cloud). With the whole funnel
			-- thinned, an EF4 wedge drew as a soft see-through mound with no sides, 2026-10-29)
			local thinH = thin * clamp(0.7 * rcz / max(rc, 1), 0, 1)
			set.thinMax = max(set.thinMax or 0, thinH)
			local dens = (1 - exp(-2 * BETA * rc)) * fadeTop * life * (0.6 + 0.4 * trans) * (1 - 0.5 * flare)
			-- 2. how defined the edge is: crisp where the funnel is well condensed (its condensed
			-- radius a good share of the core radius), ragged and soft where condensation is
			-- marginal (the tip, a rope), soft again where it becomes the lowering's cloud
			-- (every funnel is drawn by the same rules whatever its stage: a rope is what a cone
			-- becomes as its storm cuts it off - Sim/Tornado - not a separately drawn shape. Rope-only
			-- rules here, 2026-10-29, also changed the cone's narrow foot and were removed)
			local def = smooth(0.2, 0.5, rc / max(rcz, 1)) * (1 - smooth(zAt(0.5), zAt(0.85), z)) * (1 - thinH)
			local L = nil
			if refresh then
				set.Lrow = set.Lrow or {}
				local lr = set.Lrow[h]
				if not lr or nowL - lr.at > 0.5 then
					lr = { at = nowL, L = SceneLight.sample(ctx, cx, cy, altitude(z, gz, H)) }
					set.Lrow[h] = lr
				end
				L = lr.L
				-- (lightning is brief: its light is read fresh)
				if ctx.flashField then
					L.flash = ctx.Tornado.FlashField.at(ctx.flashField, cx, cy, altitude(z, gz, H))
				end
			end
			for k = 0, RING do
				local card = row[k]
				local ox, oy, size
				if k == 0 then
					ox, oy, size = 0, 0, 2.1 * rc
				else
					local a = set.spin[h] + (k - 1) / RING * 2 * math.pi + h * 0.7
					ox, oy = cos(a) * 0.45 * rc, sin(a) * 0.45 * rc
					-- (where the edge is crisp the ring puffs stay inside it: 0.45 + 0.68 = 1.13 rc
					-- spilled a soft halo past the crisp core, and a wedge had no sides)
					size = rc * (1.35 - 0.45 * def) -- (0.45 + 0.45 = 0.9 rc: inside the crisp edge; past it they scalloped it, 2026-10-29)
				end
				-- rising motion on the funnel's surface: a ring card slides up through its layer at
				-- ~0.15 vc (condensation features carried up the funnel) and loops with a fade; the
				-- centre card holds the funnel's density
				local zr, env = z, 1
				if k > 0 then
					local q = (set.rise[h] + card.rot / 360) % 1
					zr = z + (q - 0.5) * 1.6 * dz
					env = 0.7 + 0.3 * math.sin(math.pi * q) ^ 0.7 -- (a deep fade drew moving ribs, 2026-10-29)
				end
				setPos(card, C.toWorldAbout(cx + ox, cy + oy, altitude(zr, gz, H), ex, ey, ks))
				if k > 0 and card.a then
					setTr(card, 1 - clamp(card.a * env / 0.8, 0, 0.85))
				end
				if refresh then
					local w = max(size, 2)
					local hsFree = max(w * flat, 1.4 * segL)
					local hs = max(min(w * flat, hangMax), 3 * segL)
					-- (at least 3 layer gaps tall, its opacity cut to match - kOv < 1: cut to ~1.4 gaps by the
					-- taper, the soft cards' tops and bottoms showed as ribs down a forming funnel, 2026-10-29)
					-- (a card cut short overlaps fewer of its neighbours: it carries the cloud the
					-- taller card spread over that span, so the optical depth on a sight line is kept
					-- - cut without this, the wedge went faint and lost its sides)
					local kOv = clamp(hsFree / max(hs, 1), 0.25, 4)
					-- the axis here as the camera sees it: its on-screen direction (the lean) and the
					-- share of its length that shows. A billboard always faces the camera, so a piece
					-- of axis pointing toward or away from it was drawn at full length, turned to a
					-- near-random angle: a long dark stick out of the rope (2026-10-29). Taken over a
					-- full span below the cloud base (a span clamped at the base had almost no height
					-- near the top and turned the slices there sideways into shards round the top)
					local zB = min(z + 0.5 * dz, H)
					local zA = max(0, zB - max(dz, 10))
					local axA, ayA = Vortex.axisAt(e, zA)
					local axB, ayB = Vortex.axisAt(e, zB)
					local d3 = C.toWorldAbout(e.x + axB, e.y + ayB, altitude(zB, gz, H), ex, ey, ks)
						- C.toWorldAbout(e.x + axA, e.y + ayA, altitude(zA, gz, H), ex, ey, ks)
					local cf = cam.CFrame
					local dr, du = d3:Dot(cf.RightVector), d3:Dot(cf.UpVector)
					-- (any angle: a rope-out lies near flat. Capped at 75 deg its flat stretches drew as a
					-- row of crooked bars, 2026-10-29. The slice reads the same turned 180 deg: folded)
					local lean = math.deg(math.atan2(dr, du))
					if lean > 90 then
						lean -= 180
					elseif lean < -90 then
						lean += 180
					end
					local proj = clamp(sqrt(dr * dr + du * du) / max(d3.Magnitude, 1e-3), 0.15, 1)
					local hsTall = 1.4 * segL
					local tall = hsTall > w * 1.2
					if tall then
						hs = max(hs * proj, w * 1.2)
					end
					if k == 0 and card.core then
						-- the core slice: its crisp sides at the condensed radius (the slice texture
						-- is 0.86 of its frame wide), 16 layer gaps tall so each point of the edge is a
						-- blend of several faint slices: the edge follows the taper smoothly instead of
						-- stepping at each layer (8 gaps and near-opaque slices drew steps, 2026-10-29)
						-- (only as long as the axis is straight there: on a snaking rope a 16-gap slice turned
						-- with the lean became a long straight stick, and the sticks crossed, 2026-10-29. The
						-- span halves until the axis strays less than a third of the radius from straight)
						local span = 16 * dz
						local zl, zh = 0, 0
						local lx, ly, hx, hy = 0, 0, 0, 0
						for _ = 1, 2 do -- (at least 4 gaps: 2-gap slices on a bend drew bands across it)
							zl, zh = max(0, z - 0.5 * span), min(H, z + 0.5 * span)
							lx, ly = Vortex.axisAt(e, zl)
							hx, hy = Vortex.axisAt(e, zh)
							local f = (z - zl) / max(zh - zl, 1)
							local dev = sqrt((lx + (hx - lx) * f - ax) ^ 2 + (ly + (hy - ly) * f - ay) ^ 2)
							if dev < max(0.33 * rc, 2) then
								break
							end
							span *= 0.5
						end
						-- (the slice is a straight piece of the chord over that span: turned and sized
						-- by that chord as the camera sees it. Turned by the local lean - 10 m of a
						-- rope with travelling waves on it - neighbouring slices fanned out by up to
						-- 40 deg and their overlaps drew as bars across the rope, 2026-10-29)
						local c3 = C.toWorldAbout(e.x + hx, e.y + hy, altitude(zh, gz, H), ex, ey, ks)
							- C.toWorldAbout(e.x + lx, e.y + ly, altitude(zl, gz, H), ex, ey, ks)
						local cr, cu = c3:Dot(cf.RightVector), c3:Dot(cf.UpVector)
						local leanC = math.deg(math.atan2(cr, cu))
						if leanC > 90 then
							leanC -= 180
						elseif leanC < -90 then
							leanC += 180
						end
						card.leanC = leanC
						-- (how many slices overlap a point of this one: its own span in layer gaps)
						card.coreN = max((zh - zl) / max(dz, 1), 1)
						local wc = 2 * rc / 0.86
						local hc = max(sqrt(cr * cr + cu * cu) / max(ks, 1e-6), 1.4 * segL * proj, wc)
						-- (turned with the lean the slice reaches sideways: the box holds it)
						local slC = math.abs(math.sin(math.rad(leanC)))
						local bw, bh = max(w, wc + slC * hc), max(hs, hc)
						setSize(card, bw * ks, bh * ks)
						setShares(card, w / bw, hs / bh, wc / bw, hc / bh)
					else
						setSize(card, w * ks, hs * ks)
					end
					-- (where the edge is crisp the soft puffs step back: their tails would blur it)
					local a = clamp(dens * (if k == 0 then 0.9 * (1 - 0.6 * def) else 0.6 * (1 - 0.35 * def)), 0, if k == 0 then 0.92 else 0.8)
					-- a two-celled core is a hollow shell: dry sinking air in the middle (the centre
					-- card nearly gone), a thin wall round it. About 15 cards overlap on a sight line,
					-- so each keeps only ~10%: with 30% each they summed to an opaque dome that hid the
					-- sub-vortices (18 drawn at 0.8 opacity, none seen, 2026-10-29)
					a *= if k == 0 then 1 - 0.95 * thinH else 1 - 0.9 * thinH
					if math.abs(kOv - 1) > 0.01 then
						a = min(1 - (1 - a) ^ kOv, if k == 0 then 0.92 else 0.8)
					end
					card.a = a
					if k == 0 then
						setTr(card, 1 - a)
						-- (the stack of slices over a point sums to one opacity whatever the slices' span:
						-- each was 0.5 at most, tuned for 16 overlapping, so where a bend halved the
						-- span to 4-8 gaps the funnel paled there - bands across the stovepipe and
						-- rope, 2026-10-29. Now each carries its share of the 16-slice total)
						local a16 = clamp(dens * 0.5 * def, 0, 0.5)
						setCoreTr(card, (1 - a16) ^ (16 / (card.coreN or 16)))
					end
					-- sunlight left after the chord of funnel between the card and the sunward
					-- surface (horizontal chord, longer when the sun is low; capped by the way up
					-- out through the lowering when it is high)
					local along = ox * sxs + oy * sys_
					local perp2 = ox * ox + oy * oy - along * along
					local chord = max(0, sqrt(max(0, rc * rc - perp2)) - along)
					local path = min(chord / max(cosEl, 0.2), max(0, H - z) / sinEl + chord)
					local sun = L.sun * exp(-BETA_SUN * path)
					-- sky light: less deep inside (the centre card sees least sky)
					local sky = L.sky * (if k == 0 then 0.72 else 0.82 + 0.18 * clamp(-along / max(rc, 1) + 0.5, 0, 1))
					-- lofted soil and debris mixed into the condensation absorb light: the funnel's
					-- albedo falls with the debris load (Sim/Tornado debrisLoft, 0-1), most near the
					-- ground, gone toward debrisTop. A clean wedge in the storm's shadow drew
					-- mid-grey, the lowering's own shade, and lost its sides against it (2026-10-29;
					-- the references: "huge dark wedge against a pale sky")
					local dTop = max(e.debrisTop or 0, 1)
					local dirt = clamp(e.debrisLoft or 0, 0, 1) * (1 - smooth(0.4 * dTop, dTop, z)) * (1 - 0.4 * clamp(z / dTop, 0, 1))
					local alb = 0.74 * (1 - 0.5 * dirt)
					local s = sun * 0.9
					-- (light colours as the storm cards: deep in the storm's shadow the diffuse light
					-- is blue-slate, sunlight is cream)
					local deep = (1 - clamp(L.sun / 0.6, 0, 1)) * (1 - L0.night)
					local r = alb * (sky * (0.93 - 0.2 * deep) + s * 1.04) + 0.85 * L.flash
					local g = alb * (sky * (0.99 - 0.04 * deep) + s * (1 - 0.18 * warm)) + 0.88 * L.flash
					local b = alb * (sky * (1.1 + 0.04 * deep) + s * (0.9 - 0.36 * warm)) + L.flash
					local col = Color3.new(min(r, 1), min(g, 1), min(b, 1)):Lerp(rainCol, rainK)
					-- toward the cloud base: the lowering's light, and its soft lobe texture
					local kb = smooth(zAt(0.4), zAt(0.95), z)
					if base then
						col = col:Lerp(base.col, 0.9 * kb)
					end
					setCol(card, col)
					local useLobe = softLobe and softLobe ~= "" and kb > 0.35
					if useLobe and card.tex ~= softLobe then
						card.tex = softLobe
						card.img.Image = softLobe
						local fr = math.floor(card.rot / 360 * 16) % 16
						card.img.ImageRectSize = Vector2.new(256, 256)
						card.img.ImageRectOffset = Vector2.new((fr % 4) * 256, (fr // 4) * 256)
					elseif not useLobe and card.tex ~= C.TEXTURES.softFlat then
						card.tex = C.TEXTURES.softFlat
						card.img.Image = C.TEXTURES.softFlat
						card.img.ImageRectSize = Vector2.zero
					end
					if card.core and math.abs((card.leanC or 0) - (card.lean or 0)) > 0.5 then
						card.lean = card.leanC or 0
						card.core.Rotation = card.lean
					end
					-- a flattened card (the flare into the lowering, a card cut short by the taper) stays
					-- near level: turned to any angle a flat ellipse is a spike, and the flare drew as a
					-- starburst where the funnel meets the wall cloud (2026-10-29). Only round cards spin.
					local flatCard = hs < 0.8 * w
					setRot(card, if tall
						then lean + 4 * sin(card.rot + set.spin[h])
						elseif flatCard then 5 * sin(card.rot + set.spin[h])
						else (card.rot + math.deg(set.spin[h]) * 0.5) % 360)
				end
				n += 1
			end
		end
		-- sub-vortices (multi-vortex): each a thin column of cards orbiting with it, visible where its
		-- own deficit plus the parent's at its orbit can condense the air (as the mesh's tubes)
		set.subs = set.subs or {}
		set.liveSubs = set.liveSubs or {}
		if refresh then
			set.subOpShow = if (set.subN or 0) > 0 then string.format("%d subs op %.2f", set.subN, set.subOp / set.subN) else "0 subs"
			set.subOp, set.subN = 0, 0
		end
		local live = set.liveSubs
		table.clear(live)
		if (p.subCount or 0) > 0.3 then
			-- (heights spaced ~1.5 tube widths apart, so each card is longer than wide and the tube
			-- reads as one: 6-16 heights)
			-- (2026-10-30: closer, 8-24 heights - each piece a short stretch, so the tube follows
			-- its helix; at 6 long straight pieces it drew as slanted planks)
			local NSV = clamp(math.floor(0.92 * H / max(20, 0.1 * p.rc)), 8, 24)
			local dzs = H * 0.92 / NSV
			-- (light cached 4 times a second, as the funnel's)
			if not set.Ls or nowL - (set.LsAt or 0) > 0.25 then
				set.LsAt = nowL
				set.Ls = SceneLight.sample(ctx, e.x, e.y, altitude(H * 0.3, g0, H))
			end
			local Ls = set.Ls
			for hs = 1, NSV do
				local z = (hs - 0.5) * dzs
				local list = Vortex.subvortices(p, z)
				local ax, ay = Vortex.axisAt(e, min(z, H))
				local ax2, ay2 = Vortex.axisAt(e, min(z + dzs, H))
				local rcz = Vortex.rcAt(p, z)
				local need = 1.15 * 9.81 * max(1, H - z)
				-- (each tube climbs the helix: one core radius of height per radian, Vortex.subvortices;
				-- and its own wind fades with height as the wind field's does: exp(-z / hs))
				local dth = dzs / max(30, p.rc)
				local cth, sth = math.cos(dth), math.sin(dth)
				local fz = exp(-z / Vortex.subDepth(p))
				for _, sv in list do
					local id = sv[4] or 1
					local key = hs * 10 + id
					local card = set.subs[key]
					if not card then
						card = newCardAt(H)
						-- (a tube of soft puffs, 2026-10-30: the crisp-sided slice stretched over
						-- long straight stretches drew hard-edged slanted planks, like glass. Short
						-- overlapping puffs follow the helix and read as a vapour tube, as the rope)
						card.img.AnchorPoint = Vector2.new(0.5, 0.5)
						card.img.Position = UDim2.fromScale(0.5, 0.5)
						setPuffTex(card, (hs + id) % 4)
						set.subs[key] = card
					end
					live[key] = true
					local w = sv[3]
					local vs = 0.45 * e.vc * w * fz
					local dp = 1.15 * vs * vs * Vortex.CENTRAL_DEFICIT + 1.15 * e.vc * e.vc * Vortex.deficitIntegral(0.95)
					local Cs = clamp((dp / need - 0.85) / 0.35, 0, 1) * smooth(0, 0.25, w)
					-- below the condensation a sub-vortex shows by the dust its ground wind lifts (the
					-- parent's swirl plus its own, against the dust module's 8 m/s pickup), carried up
					-- its core by its own updraft and thinning as it rises: as high as that updraft
					-- reaches, exp(-z / Vortex.subDepth) in Vortex.sample. (Cut off at a fixed 0.35 H
					-- it stopped in mid-air under a multi-vortex's bowl; lifted for "updraft x 40 s" a
					-- cone's one weak sub-vortex drew as a rope orbiting it, 2026-10-30)
					local vs0 = 0.45 * e.vc * w
					local Ug = 0.6 * e.vc + vs0
					local lift = Vortex.subDepth(p)
					-- (seen against the dust skirt the parent's own swirl lifts: pickup goes as
					-- (speed/V)^3, as TornadoDust's, so the column holds (Ug / Ugp)^3 times the
					-- skirt's dust - what makes it stand out)
					local Ugp = max(0.6 * e.vc, 8)
					local Cd = clamp(Ug / 8 - 1, 0, 1) * clamp(((Ug / Ugp) ^ 3 - 1) / 2, 0, 1) * exp(-(z / lift) ^ 2) * smooth(0, 0.25, w)
					-- (seen only where it stands out from the haze round it: columns end ragged ~0.2-0.35
					-- of the way to the cloud base under the bowl, as the photos. A plain exp(-z/d) still
					-- drew them faintly up into the bowl, 2026-10-30)
					Cd = max(0, Cd - 0.12) / 0.88
					local dustShare = if Cd > Cs then 1 - Cs / max(Cd, 1e-3) else 0
					Cs = max(Cs, Cd)
					-- the tube's condensed width: about its own core (0.12 rc) each side - Mulhall's
					-- had half their shear inside 50 m (docs/tornado-physics/DEBRIS-CLOUD.md). At
					-- 0.4 rc wide they overlapped into a column of round blobs (2026-10-29)
					local rt = 0.12 * rcz * (0.7 + 0.5 * w)
					local sx, sy = e.x + ax + sv[1], e.y + ay + sv[2]
					local gzs = C.groundAt(sx, sy)
					local P1 = C.toWorldAbout(sx, sy, altitude(z, gzs, H), ex, ey, ks)
					setPos(card, P1)
					if refresh then
						-- (the puff's dense part is ~0.6 of its frame: the card is 1/0.6 the tube)
						local sw = max(2 * rt, 2) / 0.6
						-- the next stretch of its helix: the card spans it, lying along it on screen
						local nx, ny = sv[1] * cth - sv[2] * sth, sv[1] * sth + sv[2] * cth
						local P2 = C.toWorldAbout(e.x + ax2 + nx, e.y + ay2 + ny, altitude(min(z + dzs, H), gzs, H), ex, ey, ks)
						local d3 = P2 - P1
						local cf = cam.CFrame
						local seg = d3.Magnitude / ks
						-- (long enough to overlap the next piece by about half its length)
						local sh = max(sw, 2.2 * seg / 0.6)
						setSize(card, sw * ks, sh * ks)
						-- (a point of the tube is covered by ~sh*0.6/seg pieces: they share its opacity)
						local nCov = max(1, 0.6 * sh / max(seg, 1))
						local target = clamp(1.5 * Cs * life * (0.6 + 0.4 * trans), 0, 0.92) -- (x1.5: soft tubes at the bare share were barely seen in the dusty bowl, 2026-10-30)
						local op = 1 - (1 - target) ^ (1 / nCov)
						setTr(card, 1 - op)
						set.subOp = (set.subOp or 0) + op
						set.subN = (set.subN or 0) + 1
						-- (darker and bluer than the parent: dense, shadowed, seen through it)
						local sc = SceneLight.shade(Ls, 0.74, 0.4)
						-- (dust tubes soil-grey, as the dust module's: lit by the same light)
						local cCol = Color3.new(sc.R * 0.42, sc.G * 0.46, sc.B * 0.56)
						local dCol = Color3.new(sc.R * 0.5, sc.G * 0.44, sc.B * 0.37)
						-- (each tube is all edge: kept apart in brightness from what is behind it, as the
						-- funnel's rim - dark tubes on the dark, sunless bowl were invisible, 2026-10-31)
						setCol(card, sepFrom(cCol:Lerp(dCol, dustShare):Lerp(rainCol, rainK), bgBehind(sx, sy, altitude(z, gzs, H)), 1))
						setRot(card, math.deg(math.atan2(d3:Dot(cf.RightVector), d3:Dot(cf.UpVector))))
					end
					setOn(card, true)
				end
			end
		end
		for key, card in set.subs do
			if not live[key] then
				setOn(card, false)
			end
		end
		-- condensation tags: ragged fragments in the inflow under the cloud base, drawn into the
		-- vortex and lifted into the funnel's top. Each loops (fade in far out, fade out at the
		-- funnel): spiral in at the inflow (~0.35 vc), round at the tangential wind there
		-- (~0.4 vc at two funnel radii), rising from ~0.55 H to the base. Near tornadoes only.
		set.tags = set.tags or {}
		local NT = 18
		local showTags = d < 6000 and life > 0.05
		if showTags then
			local Rb = min(Vortex.condensationRadius(e, H * 0.9), 3 * rcBase)
			Rb = max(Rb, 0.6 * rcBase)
			local vin = max(4, 0.35 * e.vc)
			local P = clamp(2.6 * Rb / vin, 20, 240)
			local spin = 0.4 * e.vc / max(20, 2 * Rb)
			-- (condensation tags spiralling in: local motion. The loop phase and the turn are
			-- integrated: as rate x clock products they jumped whenever vc or Rb changed - more the
			-- longer the client had run - and ran backwards about half the time)
			local tDt = ctx:visualDt(dt)
			set.tagLoop = ((set.tagLoop or 0) + tDt / P) % 1
			set.tagTurn = ((set.tagTurn or 0) + spin * tDt) % (2 * math.pi)
			local ax, ay = Vortex.axisAt(e, H * 0.8)
			-- (light cached 4 times a second, as the funnel's)
			if not set.Lt or nowL - (set.LtAt or 0) > 0.25 then
				set.LtAt = nowL
				set.Lt = SceneLight.sample(ctx, e.x, e.y, altitude(H * 0.8, g0, H))
			end
			local Lt = set.Lt
			local colT = SceneLight.shade(Lt, 0.7, 0.3):Lerp(rainCol, rainK)
			if base then
				colT = colT:Lerp(base.col, 0.75) -- (fragments of the lowering's cloud)
			end
			local tagTex = if (C.TEXTURES.fractusFlat or "") ~= "" then C.TEXTURES.fractusFlat else C.TEXTURES.shredFlat
			for i = 1, NT do
				local card = set.tags[i]
				if not card then
					card = newCardAt(900 + i)
					card.img.Image = tagTex
					card.tex = tagTex
					card.img.ImageRectSize = Vector2.new(256, 256)
					local fr = (i * 5) % 16
					card.img.ImageRectOffset = Vector2.new((fr % 4) * 256, (fr // 4) * 256)
					set.tags[i] = card
				end
				local ph0 = (i * 0.618) % 1
				local phi = (set.tagLoop + ph0) % 1
				local env = math.min(1, phi / 0.2) * math.min(1, (1 - phi) / 0.25)
				local r = Rb * (3.5 - 2.6 * phi)
				local th = ph0 * 2 * math.pi + set.tagTurn + 1.5 * phi
				local z = H * (0.55 + 0.43 * phi ^ 1.5)
				local qx, qy = e.x + ax + math.cos(th) * r, e.y + ay + math.sin(th) * r
				setPos(card, C.toWorldAbout(qx, qy, altitude(z, C.groundAt(qx, qy), H), ex, ey, ks))
				-- (scud-sized: tens of metres, ~100 m at most. Scaled by the whole funnel radius a
				-- wedge's 18 tags were ~640 m each and veiled its sides, 2026-10-29)
				local sz = max(min(0.3 * Rb, 90) * (1.1 - 0.5 * phi), 15)
				setSize(card, sz * ks, sz * 0.45 * ks)
				setTr(card, 1 - clamp(0.3 * env * life * (0.6 + 0.4 * trans), 0, 0.4)) -- (faint wisps: at 0.6 they were dark specks round a forming funnel, 2026-10-29)
				setCol(card, colT)
				setOn(card, true)
			end
		else
			for _, card in set.tags do
				setOn(card, false)
			end
		end
		-- heights skipped this LOD: hidden
		if step > 1 and refresh then
			for h = 2, ND, step do
				for k = 0, RING do
					setTr(set.cards[h][k], 1)
					setCoreTr(set.cards[h][k], 1)
				end
			end
		end
		return n
	end

	-- (per-frame lists, reused: no allocation a frame)
	local list, entryPool, used, wanted = {}, {}, {}, {}
	local function byDist(a: any, b: any): boolean
		return a.d < b.d
	end
	local statAt = -math.huge
	function self:update(dt: number)
		local t0 = os.clock()
		local adapter = ctx.tornadoAdapter
		local active = adapter and ctx.state.show.funnel ~= false
		-- the nearest tornadoes get the sets
		local cam = Workspace.CurrentCamera
		local camPos = cam.CFrame.Position
		camS = camPos
		pxK = 0.5 * 2 * math.tan(math.rad(cam.FieldOfView) / 2) / math.max(cam.ViewportSize.Y, 1)
		table.clear(list)
		if active then
			local mx, my, mz = C.fromWorld(camPos)
			for _, e in adapter.entries do
				if e.params and (e.fade or 1) > 0.01 then
					-- (m: from the camera to the tornado's foot on the ground, true distance)
					local d = sqrt((e.x - mx) ^ 2 + (e.y - my) ^ 2 + (C.groundAt(e.x, e.y) - mz) ^ 2)
					if d < 60000 then
						local k = #list + 1
						local it = entryPool[k]
						if not it then
							it = {}
							entryPool[k] = it
						end
						it.e, it.d = e, d
						list[k] = it
					end
				end
			end
			table.sort(list, byDist)
		end
		table.clear(used)
		table.clear(wanted)
		for i = 1, math.min(MAXT, #list) do
			wanted[list[i].e.id] = true
		end
		local n = 0
		for i = 1, math.min(MAXT, #list) do
			local e = list[i].e
			-- keep a tornado on the set it had (its spin carries on)
			local set
			for _, s in sets do
				if s.id == e.id and not used[s] then
					set = s
				end
			end
			if not set then
				for _, s in sets do
					if not used[s] and not (s.id and wanted[s.id]) then
						set = s
						break
					end
				end
			end
			if not set then
				set = newSet()
				table.insert(sets, set)
			end
			if set.id ~= e.id then
				set.id = e.id
				set.fresh = true
				table.clear(set.spin)
				for h = 1, ND do
					set.spin[h] = 0
				end
			end
			used[set] = true
			show(set, true)
			n += draw(set, e, dt, cam, camPos)
		end
		for _, s in sets do
			if not used[s] then
				show(s, false)
				s.id = nil
			end
		end
		-- (debug: twice a second)
		if t0 - statAt > 0.5 then
			statAt = t0
			local rk = ""
			for _, s in sets do
				if s.id and s.rainK then
					rk = string.format(" · rain grey %.2f (sight %.2f, wrap %.0f mm/h) · shell %.2f→%.2f · sky side %.2f sun %.2f", s.rainK, s.trans or 1, s.wrap or 0, s.thin or 0, s.thinMax or 0, s.sdA or 0, (s.L0 and s.L0.sun) or 0) .. " · " .. (s.subOpShow or "") .. (if s.bodyDbg then " · body " .. (s.bodyDbg[8] or "-") .. " | " .. (s.bodyDbg[20] or "-") else "")
					break
				end
			end
			ctx.root:SetAttribute("TornadoCards", string.format("%s · %d tornadoes · %d cards · %.2f ms", ctx.state.tornadoStyle or C.TORNADO_STYLE or "volume", math.min(MAXT, #list), n, (os.clock() - t0) * 1000) .. rk)
		end
	end

	function self:destroy()
		folder:Destroy()
	end
	return self
end

return TornadoCards
