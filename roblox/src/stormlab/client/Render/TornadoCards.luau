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

local ND = 26 -- heights (26 x 7 + 18 condensation tags = 200 billboards: the budget for a tornado)
local RING = 6 -- ring cards per height (+ a centre card)
local MAXT = 2 -- tornadoes drawn (nearest)
local BETA = 0.075 -- cloud extinction (1/m), as the mesh
local BETA_SUN = 0.02 -- effective extinction for sunlight inside (multiple scattering lets light in)
local exp, sqrt, cos, sin, max, min, clamp = math.exp, math.sqrt, math.cos, math.sin, math.max, math.min, math.clamp

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
				local rot = (h * 47 + k * 113) % 360
				img.Rotation = rot
				img.Parent = bb
				bb.Parent = anchor
				row[k] = { att = att, bb = bb, img = img, rot = rot, rot0 = rot, tr = 1, tex = C.TEXTURES.softFlat }
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
	local function setCol(c: any, col: Color3)
		local last = c.col
		if not last or math.abs(col.R - last.R) > 0.002 or math.abs(col.G - last.G) > 0.002 or math.abs(col.B - last.B) > 0.002 then
			c.col = col
			c.img.ImageColor3 = col
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
		for _, row in set.cards do
			for _, c in row do
				c.bb.Enabled = v
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
		local k = C.scaleAbout(ex, ey)
		-- (m: from the camera to the column's middle, true distance)
		local camX, camY, camZ = C.fromWorld(camPos)
		local d = sqrt((ex - camX) ^ 2 + (ey - camY) ^ 2 + (altitude(top * 0.5, g0, H) - camZ) ^ 2)
		if not onScreen(cam, ex, ey, top, 8 * rcBase, g0, H, k) then
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
		local wrapT = math.exp(-0.33 * (e.wrap or 0) ^ 0.66 * 0.3)
		local rainK = math.clamp((1 - trans * wrapT) * 0.85, 0, 0.8)
		local tNow = ctx:visualTime() -- (the funnel's surface rising: local motion)
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
		local softLobe = C.LOBES and C.LOBES.soft and C.LOBES.soft.side
		local n = 0
		for h = 1, ND, step do
			local u = ((h - 0.5) / ND) ^ 1.15 -- (a little denser low down)
			local z = u * top
			-- the gap to the next height: where the column is narrower than that, cards are drawn
			-- taller than wide so the stack stays continuous (a streaky rope, not a string of dots)
			local dz = (((h + 0.5) / ND) ^ 1.15 - u) * top * step
			local rcz = Vortex.rcAt(p, min(z, H))
			local rc = if z >= H * 0.995 then 3 * rcz else min(Vortex.condensationRadius(e, min(z, H * 0.995)), 3 * rcz)
			local ax, ay = Vortex.axisAt(e, min(z, H))
			local cx, cy = e.x + ax, e.y + ay
			local gz = C.groundAt(cx, cy) -- (the ground under this height's axis point)
			-- the ring turns with the flow at its radius
			local Rn = max(rc, 1) * 0.45 / max(5, rcz)
			local omega = min(e.vc / max(20, rcz) * Vortex.profile(max(Rn, 0.05)) / max(Rn, 0.05), 2.5)
			set.spin[h] = (set.spin[h] + omega * ctx:visualDt(dt) * step) % (2 * math.pi)
			local row = set.cards[h]
			-- (inside the cloud base the funnel is lost in the cloud: gone by the base)
			local fadeTop = 1 - smooth(H * 0.82, H * 1.0, z)
			-- where it flares into the lowering the funnel spreads sideways (cards wider than tall),
			-- so it meets the cloud as a broad skirt, not a round bulb
			local flat = 1 - 0.55 * smooth(H * 0.55, H * 1.0, z)
			local dens = (1 - exp(-2 * BETA * rc)) * fadeTop * life * (0.6 + 0.4 * trans)
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
					size = 1.35 * rc
				end
				-- rising motion on the funnel's surface: a ring card slides up through its layer at
				-- ~0.15 vc (condensation features carried up the funnel) and loops with a fade; the
				-- centre card holds the funnel's density
				local zr, env = z, 1
				if k > 0 then
					local q = (tNow * riseW / max(dz, 4) * 0.6 + card.rot / 360) % 1
					zr = z + (q - 0.5) * 1.6 * dz
					env = 0.35 + 0.65 * math.sin(math.pi * q) ^ 0.7
				end
				setPos(card, C.toWorldAbout(cx + ox, cy + oy, altitude(zr, gz, H), ex, ey, k))
				if k > 0 and card.a then
					setTr(card, 1 - clamp(card.a * env / 0.8, 0, 0.85))
				end
				if refresh then
					local w = max(size, 2)
					setSize(card, w * k, max(w * flat, 1.4 * dz) * k)
					local a = clamp(dens * (if k == 0 then 0.9 else 0.6), 0, if k == 0 then 0.92 else 0.8)
					card.a = a
					if k == 0 then
						setTr(card, 1 - a)
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
					local alb = 0.74
					local s = sun * 0.9
					-- (light colours as the storm cards: deep in the storm's shadow the diffuse light
					-- is blue-slate, sunlight is cream)
					local deep = (1 - clamp(L.sun / 0.6, 0, 1)) * (1 - L0.night)
					local r = alb * (sky * (0.93 - 0.2 * deep) + s * 1.04) + 0.85 * L.flash
					local g = alb * (sky * (0.99 - 0.04 * deep) + s * (1 - 0.18 * warm)) + 0.88 * L.flash
					local b = alb * (sky * (1.1 + 0.04 * deep) + s * (0.9 - 0.36 * warm)) + L.flash
					local col = Color3.new(min(r, 1), min(g, 1), min(b, 1)):Lerp(rainCol, rainK)
					-- toward the cloud base: the lowering's light, and its soft lobe texture
					local kb = smooth(H * 0.4, H * 0.95, z)
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
					-- (a tall tip card would tilt as a whole if its image turned: only a slight wobble)
					local tall = 1.4 * dz > w * 1.2
					setRot(card, if tall
						then 8 * sin(card.rot + set.spin[h])
						else (card.rot + math.deg(set.spin[h]) * 0.5) % 360)
				end
				n += 1
			end
		end
		-- sub-vortices (multi-vortex): each a thin column of cards orbiting with it, visible where its
		-- own deficit plus the parent's at its orbit can condense the air (as the mesh's tubes)
		set.subs = set.subs or {}
		set.liveSubs = set.liveSubs or {}
		local live = set.liveSubs
		table.clear(live)
		if (p.subCount or 0) > 0.3 then
			local NSV = 16
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
				local rcz = Vortex.rcAt(p, z)
				local need = 1.15 * 9.81 * max(1, H - z)
				for _, sv in list do
					local id = sv[4] or 1
					local key = hs * 10 + id
					local card = set.subs[key]
					if not card then
						card = newCardAt(H)
						set.subs[key] = card
					end
					live[key] = true
					local w = sv[3]
					local vs = 0.45 * e.vc * w
					local dp = 1.15 * vs * vs * Vortex.CENTRAL_DEFICIT + 1.15 * e.vc * e.vc * Vortex.deficitIntegral(0.95)
					local Cs = clamp((dp / need - 0.85) / 0.35, 0, 1) * smooth(0, 0.25, w)
					local rt = 0.12 * rcz * 1.35 * (0.7 + 0.5 * w)
					local sx, sy = e.x + ax + sv[1], e.y + ay + sv[2]
					setPos(card, C.toWorldAbout(sx, sy, altitude(z, C.groundAt(sx, sy), H), ex, ey, k))
					if refresh then
						local sw = max(2.4 * rt, 2)
						setSize(card, sw * k, max(sw, 1.5 * dzs) * k)
						setTr(card, 1 - clamp(Cs * 0.85 * life * (0.6 + 0.4 * trans), 0, 0.85))
						setCol(card, SceneLight.shade(Ls, 0.74, 0.4):Lerp(rainCol, rainK))
						setRot(card, 8 * sin(card.rot + hs))
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
			local t = ctx:visualTime() -- (condensation tags spiralling in: local motion)
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
				local phi = (t / P + ph0) % 1
				local env = math.min(1, phi / 0.2) * math.min(1, (1 - phi) / 0.25)
				local r = Rb * (3.5 - 2.6 * phi)
				local th = ph0 * 2 * math.pi + spin * t + 1.5 * phi
				local z = H * (0.55 + 0.43 * phi ^ 1.5)
				local qx, qy = e.x + ax + math.cos(th) * r, e.y + ay + math.sin(th) * r
				setPos(card, C.toWorldAbout(qx, qy, altitude(z, C.groundAt(qx, qy), H), ex, ey, k))
				local sz = max(Rb * (1.1 - 0.5 * phi), 6)
				setSize(card, sz * k, sz * 0.55 * k)
				setTr(card, 1 - clamp(0.6 * env * life * (0.6 + 0.4 * trans), 0, 0.8))
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
			ctx.root:SetAttribute("TornadoCards", string.format("%d tornadoes · %d cards · %.2f ms", math.min(MAXT, #list), n, (os.clock() - t0) * 1000))
		end
	end

	function self:destroy()
		folder:Destroy()
	end
	return self
end

return TornadoCards
