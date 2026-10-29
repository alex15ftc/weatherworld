--!nonstrict
--!native
-- Storm clouds as billboard cards (the lab draws everything as billboards; rain shafts are
-- Render/RainShafts). Each storm's tower, billows, top, anvil, base, scud, wall cloud and tail
-- cloud are soft camera-facing cards laid out from its fields (CloudParts/CardPlan).
--
--   track    a storm's drawn position glides with its velocity and eases (~2 s) toward each new
--            snapshot, so snapshot steps never show as jumps
--   anchor   one invisible part per storm (and one for its wall cloud, turned at the low-level
--            rotation); cards hang from attachments at storm-local offsets, so motion is one
--            BulkMoveTo for every storm
--   plan     a storm is re-planned every PLAN_EVERY s (longer far away: PLAN_FAR s beyond
--            PLAN_FAR_M); each card has a stable key (CardPlan), so a
--            re-plan updates the same card in place (it drifts with the storm's evolution), new
--            cards fade in and dropped ones fade out (FADE s). Plans are written ~200 cards a frame
--   light    self-lit (LightInfluence 0): albedo x (sky light x the sky it sees + direct sun x what
--            reaches its sunward surface through the storm) + distance haze; lightning recolours
--            the cards of storms near a flash (~15 Hz, colours only)
--   detail   fewer cards with distance and with many storms (CardPlan detail); none beyond MAX_RANGE
--   lobes    cumuliform cards (CardPlan tex lumpyFlat, or c.lobe) draw soft lit lobe sheets
--            (tools/blender/lobe_bake.py + lobe_post.py, docs/stormlab/CONDENSATION-DETAIL.md):
--            smooth billows with the light baked in from the frame's top at low contrast, ONE image
--            per card (two stacked alpha-blended labels darken every rim over the card behind),
--            tinted and gradient-shaded like any card, turned so its top faces the sun on screen.
--            The sheet is the bake for the sun's angle to the view: front (sun behind the viewer),
--            side or back (behind the cloud). Family by on-screen size: soft below LOBE_SOFT_PX,
--            the 512 px near sheets above LOBE_NEAR_PX
--   scale    each storm is drawn whole at one scale about its centre (LabConfig.scaleAbout: in the
--            lab SCALE, in the game true near the camera and less far away): its anchor at its map
--            position, every card's offset, height and size at the layer's scale k (the wall
--            layer about the wall's centre). A layer is rewritten (RESCALE_BUDGET cards a frame)
--            when its scale moves by more than 2%. A squall line's shelf keeps its cards at their
--            map positions across (it spans the map), heights and sizes at the line's scale.
--   cost     only changes that show are written (half a pixel, 1/500 in colour or opacity); a
--            storm off screen (a sphere round its cards against the view) skips its motion, fade
--            and fog writes, and its anchors move only every 8th frame; fog recolours are queued
--            and written RECOLOUR_BUDGET cards a frame
-- Debug attribute on ctx.root: StormCards ("storms · cards · ms").
local Workspace = game:GetService("Workspace")

local Parts = script.Parent:WaitForChild("CloudParts")
local Util = require(Parts:WaitForChild("Util"))
local CardPlan = require(Parts:WaitForChild("CardPlan"))
local ShelfPlan = require(Parts:WaitForChild("ShelfPlan"))

local StormCards = {}

local PLAN_EVERY = 3 -- s, a storm within PLAN_NEAR_M
local PLAN_FAR = 20 -- s, a storm beyond PLAN_FAR_M (in between: linear)
local PLAN_NEAR_M, PLAN_FAR_M = 10000, 40000
local RECOLOUR_BUDGET = 300 -- fog recolours a frame
local RESCALE_BUDGET = 400 -- card rewrites a frame after a layer's scale moved
local RESCALE_STEP = 0.02 -- a layer is redrawn at a new scale once it has moved by this share
local MARGIN = 0.1 -- rad beyond the view's half-diagonal before a storm counts as off screen
local CULL_REFRESH = 8 -- an off-screen storm's anchors still move every 8th frame
local MAX_RANGE = 150000
local FRAME = 256 -- px a frame of a 4 x 4 sheet (1024 px)
local FADE = 1.2 -- s for a card to fade in or out
local BUDGET = 200 -- card writes a frame for pending plans
local NEAR_BUDGET = 400 -- cards a frame checked for the near-camera fade
local LOBE_SOFT_PX = 40 -- a lobe card smaller than this on screen draws the soft family
local LOBE_NEAR_PX = 320 -- and bigger than this the near (2 x 2, 512 px) sheets

local function smooth(a: number, b: number, x: number): number
	local t = math.clamp((x - a) / (b - a), 0, 1)
	return t * t * (3 - 2 * t)
end

function StormCards.new(ctx: any): any
	Util.init(ctx.Sim)
	local C = ctx.Config
	CardPlan.available.striationFlat = (C.TEXTURES.striationFlat or "") ~= ""
	CardPlan.available.fractusFlat = (C.TEXTURES.fractusFlat or "") ~= ""
	CardPlan.dynamicScud = (C.SCUD or {}).enabled ~= false
	-- lit lobe sheets (LabConfig.LOBES[family] = { front, side, back }; a family is used only when
	-- all three are set)
	local LOBES = {}
	for fam, set in (C.LOBES or {}) do
		if (set.side or "") ~= "" and (set.front or "") ~= "" and (set.back or "") ~= "" then
			LOBES[fam] = set
		end
	end
	local MIRROR = C.LOBE_MIRROR ~= false
	local Storm = ctx.Sim.Storm
	local self = {}
	local folder = Instance.new("Folder")
	folder.Name = "StormCards"
	folder.Parent = ctx.root
	local groups = {}
	local nearQueue = {} -- (the near-camera fade's pending cards)
	local anchors, frames = {}, {}
	-- ShelfPlan names its pieces by kind (the cards use only their boxes): a fixed list of names, so
	-- the shelf plan needs no cloud kit
	local SHELF_NAMES = { shelf = { "shelf_1", "shelf_2" }, base = { "base_1", "base_2" } }
	local KitNames = {
		names = function(kind: string): { string }
			return SHELF_NAMES[kind] or {}
		end,
	}
	local function cloudKit(): any
		return KitNames
	end
	local ORIGIN = { x = 0, y = 0 }
	local statAt = 0

	local function newAnchor(name: string): BasePart
		local p = Instance.new("Part")
		p.Name = name
		p.Anchored, p.CanCollide, p.CanQuery, p.CanTouch = true, false, false, false
		p.Transparency = 1
		p.Size = Vector3.one
		p.Parent = folder
		return p
	end

	-- a set of keyed cards on one anchor
	-- k: the layer's scale (studs a metre: its cards' offsets, heights and sizes); mapH: offsets
	-- across at the map's own scale (a squall line's shelf)
	local function newLayer(anchor: BasePart): any
		return { anchor = anchor, byKey = {}, free = {}, fades = {}, anim = {}, count = 0, k = C.studs(1), mapH = false }
	end
	-- a card's place on its layer's anchor (studs)
	local function cardPos(layer: any, x: number, y: number, z: number): Vector3
		if layer.mapH then
			return C.toLocal(x, y, 0) + Vector3.new(0, z * layer.k, 0)
		end
		return C.localAbout(x, y, z, layer.k)
	end
	local function acquire(layer: any): any
		local inst = table.remove(layer.free)
		if inst then
			return inst
		end
		local att = Instance.new("Attachment")
		att.Parent = layer.anchor
		local bb = Instance.new("BillboardGui")
		bb.Adornee = att
		bb.LightInfluence = 0
		bb.Size = UDim2.fromScale(100, 100)
		bb.Enabled = false
		bb.ResetOnSpawn = false
		local img = Instance.new("ImageLabel")
		img.BackgroundTransparency = 1
		img.Size = UDim2.fromScale(1, 1)
		img.ImageTransparency = 1
		-- shading inside the card: lit on the side toward the sun, shadowed on the far side
		local grad = Instance.new("UIGradient")
		grad.Parent = img
		img.Parent = bb
		bb.Parent = layer.anchor
		return { att = att, bb = bb, img = img, grad = grad, a = 0, target = 0, tr = 1, irot = 0, grot = 0 }
	end
	-- Instance writes only when the value changed (caches on the inst; every write of these
	-- properties goes through here, so the caches are what the instances show)
	local function setAlpha(inst: any, a: number)
		local tr = 1 - a * (inst.near or 1)
		local last = inst.tr
		if math.abs(tr - last) > 0.002 or ((tr >= 1 or tr <= 0) and tr ~= last) then
			inst.tr = tr
			inst.img.ImageTransparency = tr
		end
	end
	local function setPos(inst: any, v: Vector3)
		if inst.pos ~= v then
			inst.pos = v
			inst.att.Position = v
		end
	end
	local function setSize(inst: any, w: number, h: number)
		if inst.sw ~= w or inst.sh ~= h then
			inst.sw, inst.sh = w, h
			inst.bb.Size = UDim2.fromScale(w, h)
		end
	end
	local function setRot(inst: any, r: number)
		if inst.irot ~= r then
			inst.irot = r
			inst.img.Rotation = r
		end
	end
	local function setGradRot(inst: any, r: number)
		if inst.grot ~= r then
			inst.grot = r
			inst.grad.Rotation = r
		end
	end
	local function setImage(inst: any, tex: string)
		if inst.tex ~= tex then
			inst.tex = tex
			inst.img.Image = tex
		end
	end
	local function setRect(inst: any, size: Vector2, off: Vector2?)
		if inst.rs ~= size then
			inst.rs = size
			inst.img.ImageRectSize = size
		end
		if off and inst.ro ~= off then
			inst.ro = off
			inst.img.ImageRectOffset = off
		end
	end
	local function setCol(inst: any, col: Color3)
		local last = inst.col
		if not last or math.abs(col.R - last.R) > 0.002 or math.abs(col.G - last.G) > 0.002 or math.abs(col.B - last.B) > 0.002 then
			inst.col = col
			inst.img.ImageColor3 = col
		end
	end
	local function release(layer: any, inst: any)
		inst.bb.Enabled = false
		setAlpha(inst, 0)
		layer.byKey[inst.key] = nil
		layer.fades[inst] = nil
		layer.anim[inst] = nil
		layer.count -= 1
		inst.key, inst.card = nil, nil
		table.insert(layer.free, inst)
	end
	local function clearLayer(layer: any)
		for _, inst in layer.byKey do
			inst.bb.Enabled = false
			setAlpha(inst, 0)
			inst.key, inst.card = nil, nil
			table.insert(layer.free, inst)
		end
		layer.byKey, layer.fades, layer.anim, layer.count = {}, {}, {}, 0
	end

	local groupSeq = 0 -- (staggers the off-screen anchor refreshes)
	local function newGroup(id: string): any
		groupSeq += 1
		return {
			main = newLayer(newAnchor("Storm_" .. id)),
			wallL = newLayer(newAnchor("Wall_" .. id)),
			plan = {}, wall = nil, plannedAt = -math.huge, jobs = {},
			vis = true, n = groupSeq,
		}
	end
	local function hideGroup(g: any)
		clearLayer(g.main)
		clearLayer(g.wallL)
		g.jobs = {}
		g.mainCF, g.wallCF = nil, nil
	end
	-- a sphere round a group's cards, relative to its anchor (m): for the view test. Animated cards
	-- are counted where their motion can take them.
	local function bound(g: any)
		local x0, y0, z0, x1, y1, z1 = math.huge, math.huge, math.huge, -math.huge, -math.huge, -math.huge
		local function add(c: any, ox: number, oy: number, extra: number)
			local m = c.mv
			local r = 0.5 * math.max(c.w, c.h) * (if m and m.grow then 1 + math.max(0, m.grow) else 1) + extra
			local zr = if m and m.rise then math.max(0, m.rise) else 0
			local x, y = c.x + ox, c.y + oy
			if m and m.tx then
				-- (turning or drawn in about its target: anywhere within its distance of it)
				local tx, ty = m.tx + ox, m.ty + oy
				local rr = math.sqrt((x - tx) ^ 2 + (y - ty) ^ 2)
				x0, x1 = math.min(x0, tx - rr - r), math.max(x1, tx + rr + r)
				y0, y1 = math.min(y0, ty - rr - r), math.max(y1, ty + rr + r)
			else
				x0, x1 = math.min(x0, x - r), math.max(x1, x + r)
				y0, y1 = math.min(y0, y - r), math.max(y1, y + r)
			end
			z0, z1 = math.min(z0, c.z - r), math.max(z1, c.z + r + zr)
		end
		for _, c in g.plan do
			add(c, 0, 0, 0)
		end
		local w = g.wall
		g.wallRad = 0
		if w then
			-- (the wall layer turns about its anchor at (w.x, w.y): a card anywhere on its circle)
			for _, c in w.cards do
				local rr = math.sqrt(c.x * c.x + c.y * c.y) + 0.5 * math.max(c.w, c.h)
				g.wallRad = math.max(g.wallRad, rr)
				add(c, w.x, w.y, math.sqrt(c.x * c.x + c.y * c.y))
			end
		end
		if x0 > x1 then
			g.bx, g.by, g.bz, g.brad = 0, 0, 0, nil
			return
		end
		g.bx, g.by, g.bz = 0.5 * (x0 + x1), 0.5 * (y0 + y1), 0.5 * (z0 + z1)
		g.brad = 0.5 * math.sqrt((x1 - x0) ^ 2 + (y1 - y0) ^ 2 + (z1 - z0) ^ 2)
	end

	-- the scene's light for clouds (as Tornado/SceneLight, but the sun unshadowed: the card's own
	-- `lit` carries the storm's shadow)
	local fogLightAt, fogLight = -math.huge, 0.5
	local Lnow = {} -- (light()'s result: one table, rewritten each frame)
	local function light(): any
		local sun = game:GetService("Lighting"):GetSunDirection()
		local elev = sun.Y
		local night = smooth(0.05, -0.17, elev)
		local moon = ctx.state.moonlight or 0
		local daySky = 0.32 + 0.38 * smooth(0, 0.5, elev)
		local sky = daySky * (1 - night) + (0.035 + 0.12 * moon) * night
		local direct = if elev > 0 then smooth(0, 0.15, elev) else 0
		local warm = smooth(0.4, 0.05, elev) * (1 - night)
		-- (the sun in the sim frame: x east, y north, z up)
		-- rain fog: the light the rain scatters toward the eye is the light where the rain is, so
		-- under a storm it is the dim light under the storm (its shadow and overcast sky at the
		-- camera, from the scene light field), a little blue. Sampled 4 times a second.
		local now = os.clock()
		if now - fogLightAt > 0.25 then
			fogLightAt = now
			local cx, cy, cz = C.fromWorld(Workspace.CurrentCamera.CFrame.Position)
			local Ls = ctx.Tornado.SceneLight.sample(ctx, cx, cy, math.max(cz, C.groundAt(cx, cy) + 2))
			fogLight = 0.75 * Ls.sky + 0.12 * Ls.sun
		end
		local fg = fogLight
		local fog = Color3.new(fg * 0.93, fg * 0.98, fg * 1.06)
		ctx.rainFogColour = fog
		local Lt = Lnow
		Lt.sky, Lt.direct, Lt.warm, Lt.night = sky, direct, warm, night
		Lt.sx, Lt.sy, Lt.sz, Lt.fog = sun.X, -sun.Z, sun.Y, fog
		return Lt
	end
	-- vx, vy, vz: the unit view direction from the camera to the card (sim frame)
	-- shift: the part of the card's surface tilted toward (+) or away from (-) the sun
	local function colour(card: any, L: any, flash: number, hazeF: number, vx: number, vy: number, vz: number, shift: number): Color3
		local sky = L.sky * card.sky * (1 + 0.12 * shift)
		local s = L.direct * card.lit * 0.9
		local nx = card.nx
		if not nx then
			s *= math.clamp(0.65 + 0.45 * shift, 0.2, 1.1)
		end
		if nx then
			local ny, nz = card.ny, card.nz
			local rim = 1 - math.abs(nx * vx + ny * vy + nz * vz) -- (the card's own edge-on-ness)
			-- what the camera sees of a lump is the side facing it: the card's normal leans toward
			-- the camera (seen from below through a gap, a tower shows its shadowed underside)
			nx, ny, nz = nx - 0.7 * vx, ny - 0.7 * vy, nz - 0.7 * vz
			local nm = math.sqrt(nx * nx + ny * ny + nz * nz)
			if nm > 1e-3 then
				nx, ny, nz = nx / nm, ny / nm, nz / nm
			end
			-- the surface's own orientation to the sun (wrapped Lambert: clouds scatter light
			-- round their edges), on top of the storm's shadow already in `lit`
			local facing = math.clamp(nx * L.sx + ny * L.sy + nz * L.sz + shift, -1, 1)
			s *= 0.3 + 0.7 * math.max(0, 0.25 + 0.75 * facing)
			-- an up-facing surface sees the whole sky, a down-facing one mostly the ground
			sky *= 0.9 + 0.1 * nz
			-- forward scatter: an edge seen toward the sun glows (the silver lining)
			local fwd = math.max(0, vx * L.sx + vy * L.sy + vz * L.sz) ^ 4
			if fwd > 0.01 then
				s += L.direct * card.lit * 0.9 * fwd * rim * rim
			end
		end
		local alb = card.albedo
		-- Colour of the light. Diffuse light that has crossed a lot of cloud (the storm's own
		-- shadow: low `lit`) has been scattered many times through big drops, which absorb a
		-- little red: deep cloud goes blue-slate to teal. The sun's light is cream (warmer as
		-- the sun gets low).
		local deep = (1 - math.min(card.lit, 1)) * (1 - L.night)
		local sr, sg, sb = 0.93 - 0.2 * deep, 0.99 - 0.04 * deep, 1.1 + 0.04 * deep
		local cr, cg, cb = 1.04, 1.0 - 0.18 * L.warm, 0.9 - 0.36 * L.warm
		local r = alb * (sky * sr + s * cr) + 0.85 * flash
		local g = alb * (sky * sg + s * cg) + 0.88 * flash
		local b = alb * (sky * sb + s * cb) + flash
		local c = Color3.new(math.min(r, 1), math.min(g, 1), math.min(b, 1))
		if hazeF > 0.01 then
			c = Util.mix(c, Util.light.haze, hazeF * (1 - L.night))
		end
		return c
	end
	local camXNow, camYNow = 0, 0 -- (the camera this frame, m)
	local fogNow = 0 -- (the group being written: its rain fog along the ground, 0..1)
	local baseNow = 1000 -- (and its cloud base, m)
	local distNow = 1e4 -- (and the camera's distance from it, m)
	-- a card's shading: the colours of its sunward and shadowed sides, as a gradient
	-- A card's colour is its sunward side (ImageColor3); its shading is a gradient of ratios
	-- (shadow / lit) multiplied over it. Ratios change only when a card is written or fogged, so a
	-- lightning flash rewrites one colour per card. Gradients are shared (quantized ratios).
	local seqCache: { [number]: ColorSequence } = {}
	local function ratioSeq(lit: Color3, mid: Color3, dark: Color3): ColorSequence
		local function q(a: number, b: number): number
			return math.clamp(math.floor(a / math.max(b, 0.02) * 20 + 0.5), 0, 20)
		end
		local mr, mg, mb = q(mid.R, lit.R), q(mid.G, lit.G), q(mid.B, lit.B)
		local dr, dg, db = q(dark.R, lit.R), q(dark.G, lit.G), q(dark.B, lit.B)
		local key = ((((mr * 21 + mg) * 21 + mb) * 21 + dr) * 21 + dg) * 21 + db
		local seq = seqCache[key]
		if not seq then
			local w = Color3.new(1, 1, 1)
			seq = ColorSequence.new({
				ColorSequenceKeypoint.new(0, w),
				ColorSequenceKeypoint.new(0.45, w),
				ColorSequenceKeypoint.new(0.75, Color3.new(mr / 20, mg / 20, mb / 20)),
				ColorSequenceKeypoint.new(1, Color3.new(dr / 20, dg / 20, db / 20)),
			})
			seqCache[key] = seq
		end
		return seq
	end
	-- write a card's colour (and, when `full`, its shading). camPos (here and below): the camera in
	-- the sim frame, metres (x east, y north, z up), not a Roblox position
	local function shadeCard(inst: any, c: any, wx: number, wy: number, camPos: Vector3, L: any, flashes: boolean, full: boolean)
		local ff = ctx.flashField
		local flash = if flashes and ff then ctx.Tornado.FlashField.at(ff, wx, wy, c.z) else 0
		local rel = Vector3.new(wx, wy, c.z) - camPos
		local d = math.max(rel.Magnitude, 1)
		local vx, vy, vz, hf = rel.X / d, rel.Y / d, rel.Z / d, Util.hazeF(d)
		-- a lobe is bright across most of its sunward face and dark only in the crease on the far
		-- side: lit over the first half, the card's own light in the middle, shadow at the edge
		local lit = colour(c, L, flash, hf, vx, vy, vz, 0.3)
		-- rain fog: rain lies below the cloud base, so a line of sight from near the ground to a
		-- card at height z spends only base / z of its length in it
		local f = 0
		if fogNow > 0.01 then
			-- (and the rain it crosses grows with its distance: the storm's fog is for its centre)
			local tau = -math.log(1 - math.min(fogNow, 0.97)) * math.min(1, baseNow / math.max(c.z, 1)) * math.min(1, d / distNow)
			f = 1 - math.exp(-tau)
			lit = Util.mix(lit, L.fog, f)
		end
		setCol(inst, lit)
		if full then
			local mid = colour(c, L, 0, hf, vx, vy, vz, 0)
			local dark = colour(c, L, 0, hf, vx, vy, vz, -0.4)
			if f > 0 then
				mid = Util.mix(mid, L.fog, f)
				dark = Util.mix(dark, L.fog, f)
			end
			local seq = ratioSeq(lit, mid, dark)
			if inst.seq ~= seq then
				inst.seq = seq
				inst.grad.Color = seq
			end
		end
	end
	-- the gradient's direction on screen: from the sun's side to the far side. The sun's
	-- direction is projected onto the camera's screen (one angle for every card), less each
	-- card image's own rotation (the gradient turns with the image)
	local gradAngle = 0
	local aimQueue = {}
	local function sunScreenAngle(L: any): number
		local cf = Workspace.CurrentCamera.CFrame
		local sun = Vector3.new(L.sx, L.sz, -L.sy)
		local sx, sy = sun:Dot(cf.RightVector), sun:Dot(cf.UpVector)
		if sx * sx + sy * sy < 1e-4 then
			return 90 -- (sun straight ahead or behind: light from the top)
		end
		-- screen y points down; the gradient runs away from the sun
		return math.deg(math.atan2(sy, -sx))
	end
	-- Rain between the camera and a point: the transmission of a march through the surface rain
	-- field (extinction 0.33 R^0.66 per km, as NearPrecip and the funnel's obscuration). Roblox's
	-- Atmosphere does not fog billboards, so the cards are fogged here.
	local function rainFog(x: number, y: number, camX: number, camY: number): number
		local vol = ctx.cw.vol
		if not vol or not vol.nxv then
			return 0
		end
		local Precip = ctx.Sim.Precip
		local d = math.sqrt((x - camX) ^ 2 + (y - camY) ^ 2)
		local n = math.clamp(math.floor(d / 800), 3, 16)
		local tau = 0
		local step = C.sightPath(d / n) / 1000 -- (km of drawn sight line a sample)
		for i = 1, n do
			local f = (i - 0.5) / n
			local r = Precip.surface(vol, camX + (x - camX) * f, camY + (y - camY) * f) or 0
			tau += C.rainExtinction(r) * step
		end
		return math.clamp(1 - math.exp(-tau), 0, 0.97)
	end

	-- a card's lobe family (nil: it keeps its own texture). Cumuliform cards (lumpyFlat) are tower
	-- lobes, or hanging `under` lobes when they face down; CardPlan can name one (c.lobe). Small on
	-- screen they draw the soft family, big the near sheets.
	local fpxNow = 1000 -- (pixels per unit size at unit distance: this frame's camera)
	local pxKNow = 0.0005 -- (half a pixel per metre of distance: this frame's camera)
	local camSNow = Vector3.zero -- (the camera this frame, studs)
	-- (wx, wy: the card's map position; cx, cy: its layer's centre; the on-screen size is the drawn
	-- size over the drawn distance, both at the layer's scale)
	local function lobeFamily(c: any, layer: any, cx: number, cy: number, camPos: Vector3): string?
		local fam = c.lobe
		if not fam and c.tex == "lumpyFlat" then
			fam = if (c.nz or 0) < -0.3 then "under" else "tower"
		end
		if not fam or not LOBES[fam] then
			return nil
		end
		local at = C.toWorld(cx, cy, 0) + cardPos(layer, c.x, c.y, c.z)
		local px = math.max(c.w, c.h) * layer.k * fpxNow / math.max((at - camSNow).Magnitude, layer.k)
		if px < LOBE_SOFT_PX and fam ~= "soft" and LOBES.soft then
			return "soft"
		end
		if px > LOBE_NEAR_PX and LOBES[fam .. "_near"] then
			return fam .. "_near"
		end
		return fam
	end

	-- write one planned card into its layer: the same key keeps its card (it moves a little), a
	-- new key fades in
	local function put(layer: any, c: any, ox: number, oy: number, s: any, camPos: Vector3, L: any, flashes: boolean, stamp: number): boolean
		local inst = layer.byKey[c.key]
		local isNew = inst == nil
		if not inst then
			inst = acquire(layer)
			inst.key = c.key
			inst.a = 0
			layer.byKey[c.key] = inst
			layer.count += 1
			inst.bb.Enabled = true
			inst.near, inst.nearOff = 1, false
			inst.fam = nil
			setAlpha(inst, 0)
		end
		inst.card = c
		inst.stamp = stamp
		layer.anim[inst] = if c.mv then true else nil
		local k = layer.k
		setPos(inst, cardPos(layer, c.x, c.y, c.z))
		setSize(inst, math.max(c.w, 5) * k, math.max(c.h, 5) * k)
		-- lobe family: by the card's kind and its size on screen
		local wx, wy = s.x + ox + c.x, s.y + oy + c.y
		local fam = lobeFamily(c, layer, s.x + ox, s.y + oy, camPos)
		inst.fam = fam
		local square = c.h >= c.w * 0.8
		if fam then
			-- the bake for the sun's angle to the view (with a margin, so a card does not flip
			-- between two sheets)
			local rel = Vector3.new(wx, wy, c.z) - camPos
			local d = math.max(rel.Magnitude, 1)
			local vs = (rel.X * L.sx + rel.Y * L.sy + rel.Z * L.sz) / d
			local pass = inst.pass or "side"
			if vs < -0.4 then
				pass = "front"
			elseif vs > 0.4 then
				pass = "back"
			elseif vs > -0.25 and vs < 0.25 then
				pass = "side"
			end
			inst.pass = pass
			setImage(inst, LOBES[fam][pass])
			-- the frame (the near sheets are 2 x 2 of the main sheet's first four lobes), mirrored
			-- for half the cards (the light still comes from the top)
			local near = string.sub(fam, -5) == "_near"
			local fs = if near then 512 else FRAME
			local per = if near then 2 else 4
			local fr = if near then c.frame % 4 else c.frame
			local fx, fy = (fr % per) * fs, math.floor(fr / per) * fs
			local mirror = MIRROR and (c.ph or 0) > 0.5
			local size = Vector2.new(if mirror then -fs else fs, fs)
			local off = Vector2.new(if mirror then fx + fs else fx, fy)
			setRect(inst, size, off)
			-- the frame's top faces the sun on screen (squashed cards stay level: the light is
			-- from above anyway)
			setRot(inst, if square then gradAngle - 90 else 0)
		else
			setImage(inst, C.TEXTURES[c.tex] or C.TEXTURES.softFlat)
			if c.frame >= 0 then
				setRect(inst, Vector2.new(FRAME, FRAME), Vector2.new((c.frame % 4) * FRAME, math.floor(c.frame / 4) * FRAME))
			else
				setRect(inst, Vector2.zero, nil)
			end
			setRot(inst, if square then c.rot else 0)
		end
		-- (a kept card refreshes its colour; its shading is redone only when new or now and then)
		inst.shadeN = ((inst.shadeN or 0) + 1) % 6
		shadeCard(inst, c, s.x + ox + c.x, s.y + oy + c.y, camPos, L, flashes, isNew or inst.shadeN == 0)
		setGradRot(inst, gradAngle - inst.irot)
		inst.target = c.a
		if math.abs(inst.a - c.a) > 0.005 then
			layer.fades[inst] = true
		else
			setAlpha(inst, c.a)
		end
		return isNew
	end

	-- one pending job (a card list for a layer) for up to `budget` cards; when it finishes, cards
	-- the new plan no longer has fade out
	local function runJob(job: any, s: any, camPos: Vector3, L: any, flashes: boolean, budget: number): number
		local list = job.cards
		local n = #list
		local i1 = math.min(n, job.i + budget - 1)
		for i = job.i, i1 do
			if put(job.layer, list[i], job.ox, job.oy, s, camPos, L, flashes, job.stamp) then
				job.new = (job.new or 0) + 1
			end
		end
		budget -= math.max(0, i1 - job.i + 1)
		job.i = i1 + 1
		if job.i > n then
			job.done = true
			local dropped = 0
			for _, inst in job.layer.byKey do
				if inst.stamp ~= job.stamp and inst.target > 0 then
					inst.target = 0
					job.layer.fades[inst] = true
					dropped += 1
				end
			end
			-- (debug: how stable re-plans are - cards kept in place / new / dropped)
			if n > 0 then
				ctx.root:SetAttribute("StormCardsPlan", string.format("kept %d · new %d · dropped %d", n - (job.new or 0), job.new or 0, dropped))
			end
		end
		return budget
	end

	-- vis: the group is on screen (off screen only a finished fade is written); animOn: its moving
	-- cards are animated this frame (animate writes their opacity, so it is not written twice)
	local function stepFades(layer: any, dt: number, vis: boolean, animOn: boolean)
		local k = dt / FADE
		for inst in layer.fades do
			local t = inst.target
			if inst.a < t then
				inst.a = math.min(t, inst.a + k)
			else
				inst.a = math.max(t, inst.a - k)
			end
			local m = animOn and layer.anim[inst] and inst.card and inst.card.mv
			if (vis and not (m and m.k ~= "spin")) or inst.a == t then
				setAlpha(inst, inst.a)
			end
			if inst.a == t then
				layer.fades[inst] = nil
				if t <= 0 then
					release(layer, inst)
				end
			end
		end
	end

	-- one animated card's place and opacity this frame (storm-local, sim time t); thr: studs a card
	-- must move before its position is written (half a pixel at its storm's nearest part)
	local animThr = 0
	local function movePos(inst: any, v: Vector3)
		local last = inst.pos
		if last == nil or (v - last).Magnitude > animThr then
			inst.pos = v
			inst.att.Position = v
		end
	end
	local function animate(inst: any, t: number, gain: number, layer: any)
		local c = inst.card
		local m = c and c.mv
		if not m then
			return
		end
		if m.k == "spin" then
			-- turning about the updraft (a whole ring: no fade, no loop). It turns ~0.5 deg/s, so
			-- each card moves ~5 times a second (staggered), not every frame
			local now = os.clock()
			if now < (inst.spinAt or 0) then
				return
			end
			inst.spinAt = now + 0.18 + 0.04 * c.ph
			local th = m.omega * t
			local cs, sn = math.cos(th), math.sin(th)
			local dx, dy = c.x - m.tx, c.y - m.ty
			movePos(inst, cardPos(layer, m.tx + dx * cs - dy * sn, m.ty + dx * sn + dy * cs, c.z))
			setAlpha(inst, inst.a * gain)
			return
		end
		local phi = (t / m.P + c.ph) % 1
		-- fade in and out at the cycle's ends (no card pops on its loop)
		local env = math.min(1, phi / 0.15) * math.min(1, (1 - phi) / 0.2)
		local x, y, z = c.x, c.y, c.z
		if m.k == "in" then
			-- pulled toward the target, swirling cyclonically about it, lifted toward the base
			local dx, dy = x - m.tx, y - m.ty
			local k = 1 - m.pull * phi
			local th = m.swirl * phi
			local cs, sn = math.cos(th), math.sin(th)
			x = m.tx + (dx * cs - dy * sn) * k
			y = m.ty + (dx * sn + dy * cs) * k
			z += m.rise * phi * phi -- (accelerating up as it nears the updraft)
		else
			z += m.rise * phi
			local g = 1 + m.grow * phi
			local w, h = math.max(c.w * g, 5) * layer.k, math.max(c.h * g, 5) * layer.k
			if inst.sw == nil or math.abs(w - inst.sw) > animThr or math.abs(h - inst.sh) > animThr then
				setSize(inst, w, h)
			end
		end
		movePos(inst, cardPos(layer, x, y, z))
		setAlpha(inst, inst.a * env * gain)
	end

	-- fog recolours: queued (parallel arrays: inst, group, wall layer?, full shading?) and written
	-- RECOLOUR_BUDGET cards a frame, with the group's fog at the time they are written
	local rqInst, rqG, rqWall, rqFull = {}, {}, {}, {}
	local rqN = 0
	local function recolourLayer(g: any, layer: any, isWall: boolean, full: boolean)
		for _, inst in layer.byKey do
			if inst.card then
				rqN += 1
				rqInst[rqN], rqG[rqN], rqWall[rqN], rqFull[rqN] = inst, g, isWall, full
			end
		end
	end
	-- a layer whose scale moved: its cards redrawn at the new one, RESCALE_BUDGET a frame
	local rsInst, rsLayer = {}, {}
	local rsN = 0
	local function setScale(layer: any, k: number)
		local k0 = layer.k
		if math.abs(k - k0) <= RESCALE_STEP * k0 then
			return
		end
		layer.k = k
		for _, inst in layer.byKey do
			rsN += 1
			rsInst[rsN], rsLayer[rsN] = inst, layer
		end
	end
	local function runRescales()
		local n = math.min(rsN, RESCALE_BUDGET)
		for _ = 1, n do
			local inst, layer = rsInst[rsN], rsLayer[rsN]
			rsInst[rsN], rsLayer[rsN] = nil, nil
			rsN -= 1
			local c = inst.card
			if c and not layer.gone and layer.byKey[inst.key] == inst then
				local k = layer.k
				-- (a moving card is placed by animate; its size here, its place too until then)
				inst.pos = nil
				setPos(inst, cardPos(layer, c.x, c.y, c.z))
				setSize(inst, math.max(c.w, 5) * k, math.max(c.h, 5) * k)
			end
		end
	end
	local function runRecolours(camPos: Vector3, L: any)
		local n = math.min(rqN, RECOLOUR_BUDGET)
		for _ = 1, n do
			local inst, g, isWall, full = rqInst[rqN], rqG[rqN], rqWall[rqN], rqFull[rqN]
			rqInst[rqN], rqG[rqN] = nil, nil
			rqN -= 1
			local c = inst.card
			local s = g.storm
			if c and s and not g.gone then
				local ox, oy = 0, 0
				if isWall then
					local w = g.wall
					if not w then
						continue
					end
					ox, oy = w.x, w.y
				end
				fogNow = g.fog or 0
				baseNow = s.base or 1000
				distNow = math.max(g.dCam or 1e4, 500)
				shadeCard(inst, c, s.x + ox + c.x, s.y + oy + c.y, camPos, L, false, full)
			end
		end
	end

	local flashActive = false
	local flashAt = 0
	local stamp = 0
	local live = {} -- (storms and systems in range this frame: reused)
	local EMPTY = {}
	-- flash recolours queued (parallel arrays: inst, group, wall layer?)
	local fqInst, fqG, fqWall = {}, {}, {}
	local fqN = 0
	-- the view this frame (sim frame: the camera's look direction, the view cone's half-angle)
	local lookS, halfDiag = Vector3.zAxis, 1
	local frameN = 0
	local function planEvery(g: any): number
		if g.isSystem then
			return PLAN_EVERY
		end
		local s = g.storm
		local d = g.dCam or math.sqrt((s.x - camXNow) ^ 2 + (s.y - camYNow) ^ 2)
		local k = math.clamp((d - PLAN_NEAR_M) / (PLAN_FAR_M - PLAN_NEAR_M), 0, 1)
		return PLAN_EVERY + (PLAN_FAR - PLAN_EVERY) * k
	end
	-- A group's sphere of cards in studs (round its anchor at px, py, drawn at its layers' scales):
	-- the centre and radius, and its distance from the camera. The radius covers the layers'
	-- scales and the map's (the wall's offset is across at the map scale).
	local function groupSphere(g: any): (Vector3?, number, number)
		local rad = g.brad
		if not rad or not g.px then
			return nil, 0, 0
		end
		local km, kw, kh = g.main.k, g.wallL.k, C.frame.kh
		local kmax, kmin = math.max(km, kw, kh), math.min(km, kw, kh)
		local centre = C.toWorld(g.px, g.py, 0) + cardPos(g.main, g.bx, g.by, g.bz)
		local radS = rad * (2 * kmax - kmin)
		return centre, radS, (centre - camSNow).Magnitude
	end
	-- is it in the view? (studs: angles are unit-free)
	local function groupVisible(centre: Vector3?, radS: number, dS: number): boolean
		if not centre or dS <= radS then
			return true
		end
		local cosA = math.clamp((centre - camSNow):Dot(lookS) / dS, -1, 1)
		return math.acos(cosA) < halfDiag + math.asin(math.min(1, radS / dS))
	end
	function self:update(dt: number)
		local t0 = os.clock()
		local on = ctx.state.show.clouds ~= false
		if not on then
			for _, g in groups do
				hideGroup(g)
				g.plannedAt = -math.huge
			end
			return
		end
		Util.refreshLight()
		local cw = ctx.cw
		-- (the camera in the sim frame, metres)
		local camera = Workspace.CurrentCamera
		local camCF = camera.CFrame
		local camPos = Vector3.new(C.fromWorld(camCF.Position))
		local camX, camY = camPos.X, camPos.Y
		camXNow, camYNow = camX, camY
		frameN += 1
		do
			-- (the view: angles and pixel sizes are unit-free; the look direction in the sim frame)
			lookS = camCF.LookVector
			camSNow = camCF.Position
			local vp = camera.ViewportSize
			local tanV = math.tan(math.rad(camera.FieldOfView) / 2)
			halfDiag = math.atan(tanV * math.sqrt(1 + (vp.X / math.max(vp.Y, 1)) ^ 2)) + MARGIN
			fpxNow = 0.5 * vp.Y / tanV
			pxKNow = 0.5 / fpxNow -- (half a pixel per unit of distance)
		end
		local simT = ctx:simTime()
		local vT = ctx:visualTime() -- (local motion: boiling, inflow)
		local vDt = ctx:visualDt(dt) -- (the wall cloud's turn, integrated)
		local simDt = if ctx.state.paused then 0 else dt * (ctx.state.timeScale or 1)
		local dtSnap = math.clamp(simT - (cw.time or simT), -5, 60)
		local L = light()
		-- the shading's direction follows the camera (only when it has turned noticeably)
		local tAim = os.clock()
		do
			-- (when the camera has turned more than 5 degrees, every card's gradient is turned -
			-- spread over frames, 250 cards a frame, so a chase camera that keeps turning costs
			-- little)
			local ang = sunScreenAngle(L)
			local diff = (ang - gradAngle + 180) % 360 - 180
			if math.abs(diff) > 5 and #aimQueue == 0 then
				gradAngle = ang
				for _, g in groups do
					for _, inst in g.main.byKey do
						table.insert(aimQueue, inst)
					end
					for _, inst in g.wallL.byKey do
						table.insert(aimQueue, inst)
					end
				end
			end
			local nA = math.min(#aimQueue, 250)
			for _ = 1, nA do
				local inst = table.remove(aimQueue)
				local c = inst.card
				if inst.fam and c and c.h >= c.w * 0.8 then
					setRot(inst, gradAngle - 90)
				end
				setGradRot(inst, gradAngle - inst.irot)
			end
		end
		local aimMs = (os.clock() - tAim) * 1000
		local flashes = ctx.flashField ~= nil and #ctx.flashField.flashes > 0
		-- storms in range
		table.clear(live)
		local inRange = 0
		for _, s in cw.storms do
			local d2 = (s.x - camX) ^ 2 + (s.y - camY) ^ 2
			if d2 < MAX_RANGE * MAX_RANGE then
				live[tostring(s.id)] = s
				inRange += 1
			end
		end
		-- squall-line systems: shelf clouds along their leading edges
		local systems = (cw.systemsSnap and cw.systemsSnap.systems) or EMPTY
		for _, sys in systems do
			if sys.segments and #sys.segments > 0 then
				live["y:" .. tostring(sys.id)] = sys
			end
		end
		for id, g in groups do
			if not live[id] then
				hideGroup(g)
				g.gone = true -- (queued recolours and rescales of its cards are dropped)
				g.main.gone, g.wallL.gone = true, true
				g.main.anchor:Destroy()
				g.wallL.anchor:Destroy()
				groups[id] = nil
				if ctx.stormTrack then
					ctx.stormTrack[id] = nil
				end
			end
		end
		-- re-plan the most overdue storm (one a frame; far storms are re-planned less often)
		local stalest, overdue = nil, -math.huge
		for id, s in live do
			local g = groups[id]
			if not g then
				g = newGroup(id)
				groups[id] = g
			end
			g.isSystem = string.sub(id, 1, 2) == "y:"
			g.storm = if g.isSystem then ORIGIN else s
			g.obj = s
			-- its scale about its centre (a shelf: about the middle of its cards), and the wall
			-- layer's about the wall's centre
			local px, py = g.px or s.x, g.py or s.y
			if g.isSystem then
				g.main.mapH = true
				px, py = (g.px or 0) + (g.bx or 0), (g.py or 0) + (g.by or 0)
			end
			setScale(g.main, C.scaleAbout(px, py))
			local w = g.wall
			if w then
				setScale(g.wallL, C.scaleAbout((g.px or s.x) + w.x, (g.py or s.y) + w.y))
			end
			local od = (t0 - g.plannedAt) - planEvery(g)
			if od > overdue then
				stalest, overdue = id, od
			end
		end
		local tPlan0 = os.clock()
		if stalest and overdue >= 0 then
			local g = groups[stalest]
			local s = g.storm
			local plan, wall
			if g.isSystem then
				local ck = cloudKit()
				local pieces, vx, vy = {}, 0, 0
				if ck then
					pieces, vx, vy = ShelfPlan.plan(g.obj, cw.storms, ck, camX, camY, 1)
				end
				plan = CardPlan.fromPieces(pieces, 4241, 1)
				g.vx, g.vy, g.t0 = vx, vy, cw.time or simT
			else
				local d = math.sqrt((s.x - camX) ^ 2 + (s.y - camY) ^ 2)
				-- (fewer cards with distance and with many storms in range: the whole sky's card
				-- count, not each storm's, is what the frame pays for)
				local detail = math.clamp(1 - (d - 15000) / 90000, 0.25, 1) * math.clamp(5 / math.max(inRange, 1), 0.3, 1)
				local cp0 = os.clock()
				plan, _, wall = CardPlan.plan(s, Storm, detail, camX - s.x, camY - s.y)
				-- (debug: what a re-plan costs - one storm every PLAN_EVERY / storms seconds)
				ctx.root:SetAttribute("StormCardsPlanMs", math.floor((os.clock() - cp0) * 10000 + 0.5) / 10)
			end
			g.plan, g.wall = plan, wall
			g.plannedAt = t0
			bound(g)
			stamp += 1
			g.jobs = {
				{ layer = g.main, cards = plan, i = 1, ox = 0, oy = 0, stamp = stamp },
				{ layer = g.wallL, cards = if wall then wall.cards else {}, i = 1, ox = if wall then wall.x else 0, oy = if wall then wall.y else 0, stamp = stamp },
			}
		elseif flashes or flashActive or fqN > 0 then
			tPlan0 = os.clock() -- (a flash recolour, not a plan)
			-- lightning: colours only, for storms near a flash (and once more when it ends). A pass
			-- over their cards is queued and written 300 cards a frame (each card ~14 times a
			-- second at 60 fps, as fast as the flash changes), not all at once.
			if fqN == 0 then
				flashAt = t0
				for _, g in groups do
					local s = g.storm
					local near = false
					if flashes then
						for _, f in ctx.flashField.flashes do
							if ((f.x or s.x) - s.x) ^ 2 + ((f.y or s.y) - s.y) ^ 2 < 30000 ^ 2 then
								near = true
								break
							end
						end
					end
					if near or g.flashLit then
						g.flashLit = near
						for _, inst in g.main.byKey do
							fqN += 1
							fqInst[fqN], fqG[fqN], fqWall[fqN] = inst, g, false
						end
						if g.wall then
							for _, inst in g.wallL.byKey do
								fqN += 1
								fqInst[fqN], fqG[fqN], fqWall[fqN] = inst, g, true
							end
						end
					end
				end
			end
			local nF = math.min(fqN, 300)
			for _ = 1, nF do
				local inst, g, isWall = fqInst[fqN], fqG[fqN], fqWall[fqN]
				fqInst[fqN], fqG[fqN] = nil, nil
				fqN -= 1
				local c = inst.card
				if c and g.storm then
					local s = g.storm
					fogNow = g.fog or 0
					baseNow = s.base or 1000
					distNow = math.max(g.dCam or 1e4, 500)
					local ox, oy = 0, 0
					if isWall and g.wall then
						ox, oy = g.wall.x, g.wall.y
					end
					-- (only cards the flash lights - or stopped lighting - are recoloured)
					local wx, wy = s.x + ox + c.x, s.y + oy + c.y
					local ff = ctx.flashField
					local fl = if flashes and ff then ctx.Tornado.FlashField.at(ff, wx, wy, c.z) else 0
					if math.abs(fl - (inst.flash or 0)) > 0.02 then
						inst.flash = fl
						shadeCard(inst, c, wx, wy, camPos, L, flashes, false)
					end
				end
			end
		end
		flashActive = flashes
		-- pending plans, a budget of card writes a frame
		local tJobs = os.clock()
		local tPre = tJobs - t0
		local tPlanMs = (tJobs - tPlan0) * 1000
		-- (a running mean of the whole update, to see averages not one frame)
		self.meanMs = (self.meanMs or 0) * 0.98
		local budget = BUDGET
		-- (storms on screen first, then those off it with what is left)
		for pass = 1, 2 do
			for _, g in groups do
				if (pass == 1) == (g.vis ~= false) then
					for _, job in g.jobs do
						if budget <= 0 then
							break
						end
						if not job.done then
							fogNow = g.fog or 0
							baseNow = (g.storm and g.storm.base) or 1000
							distNow = math.max(g.dCam or 1e4, 500)
							budget = runJob(job, g.storm, camPos, L, flashes, budget)
						end
					end
				end
			end
		end
		runRecolours(camPos, L)
		runRescales()
		local tFog, tAnim, tFade = 0, 0, 0
		tJobs = os.clock() - tJobs
		-- fades, smoothed tracks, and every anchor moved at once
		table.clear(anchors)
		table.clear(frames)
		local n = 0
		local ease = 1 - math.exp(-dt / 2)
		local fogTick = t0 - (self.fogAt or 0) > 0.25
		if fogTick then
			self.fogAt = t0
		end
		for _, g in groups do
			local c0 = os.clock()
			local s = g.storm
			local dCam = math.sqrt(((g.px or s.x) - camX) ^ 2 + ((g.py or s.y) - camY) ^ 2)
			g.dCam = dCam
			-- on screen? (off screen: no motion, fade or fog writes; its anchors move now and then)
			local sc, radS, dS = groupSphere(g)
			local vis = groupVisible(sc, radS, dS)
			-- (half a pixel at the storm's nearest part, studs)
			local thrS = pxKNow * math.max(50 * g.main.k, dS - radS)
			local back = vis and not g.vis -- (back on screen: its fog is checked now)
			g.vis = vis
			-- the wall cloud's turn at the low-level rotation, integrated every frame (as spin x
			-- the clock it jumped by up to whole turns whenever the storm's vlow changed: every
			-- engine nudge)
			if g.wall then
				g.wallPhase = ((g.wallPhase or 0) + (g.wall.spin or 0) * vDt) % (2 * math.pi)
			end
			local animOn = vis and dCam < 40000
			stepFades(g.main, dt, vis, animOn)
			stepFades(g.wallL, dt, vis, animOn)
			tFade += os.clock() - c0
			c0 = os.clock()
			-- rain between the camera and the storm: fog its cards (recoloured when it changes)
			if (fogTick or back) and vis and not g.isSystem then
				g.fog = rainFog(g.px or s.x, g.py or s.y, camX, camY)
				local fogMoved = math.abs(g.fog - (g.fogApplied or 0)) > 0.04
				if fogMoved or (g.fog > 0.05 and math.abs(fogLight - (g.fogLightApplied or 0)) > 0.03) then
					g.fogApplied = g.fog
					g.fogLightApplied = fogLight
					fogNow = g.fog
					baseNow = s.base or 1000
					distNow = math.max(dCam, 500)
					-- (a change of the fog's colour alone rewrites colours, not the shading)
					recolourLayer(g, g.main, false, fogMoved)
					if g.wall then
						recolourLayer(g, g.wallL, true, fogMoved)
					end
				end
			end
			tFog += os.clock() - c0
			c0 = os.clock()
			-- motion: scud drawn in and lifted, billows boiling (near storms only)
			if animOn then
				local gain = 1
				animThr = thrS
				for inst in g.main.anim do
					animate(inst, vT, gain, g.main)
				end
				for inst in g.wallL.anim do
					animate(inst, vT, gain, g.wallL)
				end
			end
			tAnim += os.clock() - c0
			local tx, ty = s.x + (s.u or 0) * dtSnap, s.y + (s.v or 0) * dtSnap
			if g.isSystem then
				-- (a shelf plan is absolute at its time; the line drifts at vx, vy since)
				local ddt = math.clamp(simT - (g.t0 or simT), -5, 120)
				tx, ty = (g.vx or 0) * ddt, (g.vy or 0) * ddt
				g.px, g.py = tx, ty
			elseif not g.px or (tx - g.px) ^ 2 + (ty - g.py) ^ 2 > 3000 ^ 2 then
				g.px, g.py = tx, ty
			else
				g.px += (s.u or 0) * simDt
				g.py += (s.v or 0) * simDt
				g.px += (tx - g.px) * ease
				g.py += (ty - g.py) * ease
			end
			-- the anchors: moved when the move shows (half a pixel at the storm's nearest part; a
			-- turn of the wall layer at its outermost card), off screen only every 8th frame
			local refresh = vis or (frameN + (g.n or 0)) % CULL_REFRESH == 0
			if refresh then
				local p = C.toWorld(g.px, g.py, 0)
				local last = g.mainCF
				if last == nil or (p - last).Magnitude > thrS then
					g.mainCF = p
					table.insert(anchors, g.main.anchor)
					table.insert(frames, CFrame.new(p))
				end
				local w = g.wall
				if w then
					-- turning cyclonically (counter-clockwise seen from above) at the low-level rotation
					local wp = C.toWorld(g.px + w.x, g.py + w.y, 0)
					local ang = g.wallPhase or 0
					local lastW = g.wallCF
					local rS = math.max((g.wallRad or 0) * g.wallL.k, 1)
					if lastW == nil or (wp - lastW).Magnitude > thrS or math.abs(ang - (g.wallAng or 0)) * rS > thrS then
						g.wallCF, g.wallAng = wp, ang
						table.insert(anchors, g.wallL.anchor)
						table.insert(frames, CFrame.new(wp) * CFrame.Angles(0, ang, 0))
					end
				end
			end
			n += g.main.count + g.wallL.count
		end
		-- Near the camera: a card the camera is inside or close to (within about its own size)
		-- fades out and stops drawing. Inside a cloud, dozens of screen-sized translucent cards
		-- stacked on each other were the frame's fill-rate cost (2026-10-28: ~3,000 billboards with
		-- many over the whole screen); the cards further off still draw the cloud round you.
		-- Staggered: NEAR_BUDGET cards a frame, over the groups whose cards reach the camera.
		do
			local camS = Workspace.CurrentCamera.CFrame.Position
			if #nearQueue == 0 then
				for _, g in groups do
					local sc, radS, dS = groupSphere(g)
					local close = dS < radS * 1.1
					if close or g.nearWas then
						g.nearWas = close
						for _, layer in { g.main, g.wallL } do
							for _, inst in layer.byKey do
								table.insert(nearQueue, { inst, layer, close })
							end
						end
					end
				end
			end
			for _ = 1, math.min(#nearQueue, NEAR_BUDGET) do
				local item = table.remove(nearQueue)
				local inst, layer, close = item[1], item[2], item[3]
				if inst.key then
					local f = 1
					if close and inst.pos and inst.sw then
						local p = layer.anchor.CFrame:PointToWorldSpace(inst.pos)
						local size = math.max(inst.sw, inst.sh)
						local d = (p - camS).Magnitude
						f = smooth(0.3 * size, 0.85 * size, d)
					end
					if math.abs(f - (inst.near or 1)) > 0.03 or (f == 1 and inst.near ~= 1) then
						inst.near = f
						setAlpha(inst, inst.a)
					end
					local off = f < 0.01
					if off ~= (inst.nearOff or false) then
						inst.nearOff = off
						inst.bb.Enabled = not off
					end
				end
			end
		end
		if #anchors > 0 then
			Workspace:BulkMoveTo(anchors, frames, Enum.BulkMoveMode.FireCFrameChanged)
		end
		-- the lowering's light for the tornado (Render/TornadoCards): a funnel's upper part is the
		-- same cloud as the wall cloud it hangs from, so it takes the colour these cards were shaded
		-- with (their light, haze and rain fog), measured from the wall cloud's underside cards
		if fogTick then
			ctx.stormBase = ctx.stormBase or {}
			for id, g in groups do
				local w = g.wall
				if w and not g.isSystem then
					local r, gg, b, k = 0, 0, 0, 0
					for _, inst in g.wallL.byKey do
						local c = inst.card
						if c and (c.nz or 0) < -0.2 and inst.a > 0.3 then
							local col = inst.col or inst.img.ImageColor3
							r += col.R
							gg += col.G
							b += col.B
							k += 1
						end
					end
					if k > 0 then
						ctx.stormBase[id] = {
							col = Color3.new(r / k, gg / k, b / k),
							x = g.px + w.x, y = g.py + w.y, z = (g.storm.wallBase or g.storm.base or 1000),
						}
					end
				else
					ctx.stormBase[id] = nil
				end
			end
		end
		ctx.stormTrack = ctx.stormTrack or {}
		for id, g in groups do
			if not g.isSystem then
				local tr = ctx.stormTrack[id]
				if not tr then
					tr = {}
					ctx.stormTrack[id] = tr
				end
				tr.x, tr.y = g.px, g.py
			end
		end
		self.meanMs += 0.02 * (os.clock() - t0) * 1000
		if t0 - statAt > 0.5 then
			statAt = t0
			local k = 0
			for _ in groups do
				k += 1
			end
			ctx.root:SetAttribute("StormCards", string.format("%d storms · %d cards · %.2f ms", k, n, (os.clock() - t0) * 1000))
			-- (debug: where the time goes this frame)
			ctx.root:SetAttribute("StormCardsParts", string.format("mean %.2f · before %.2f (aim %.2f, plan/flash %.2f) · jobs %.2f · fades %.2f · fog %.2f · motion %.2f ms", self.meanMs, tPre * 1000, aimMs, tPlanMs, tJobs * 1000, tFade * 1000, tFog * 1000, tAnim * 1000))
		end
	end

	function self:destroy()
		folder:Destroy()
	end
	return self
end

return StormCards
