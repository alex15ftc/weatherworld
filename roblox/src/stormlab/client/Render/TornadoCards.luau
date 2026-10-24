--!nonstrict
--!native
-- The tornado funnel as a billboard volume (the default funnel style; F4 "funnel" toggles the mesh
-- in Render/TornadoVisuals). Chosen by side-by-side comparison (Render/FunnelCompare, option D):
-- soft camera-facing cards stacked up the axis read like a volume of cloud, with no hard outline.
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
local Workspace = game:GetService("Workspace")

local TornadoCards = {}

local ND = 32 -- heights
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
		return { att = att, bb = bb, img = img, rot = (salt * 37) % 360 }
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
				row[k] = { att = att, bb = bb, img = img, rot = rot }
			end
			set.cards[h] = row
		end
		return set
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
				c.bb.Enabled = false
			end
		end
		if not v and set.tags then
			for _, c in set.tags do
				c.bb.Enabled = false
			end
		end
	end

	-- is any part of the column (base, middle, top, a radius either side) on screen?
	local function onScreen(cam: Camera, x: number, y: number, top: number, w: number): boolean
		for _, z in { 0, top * 0.5, top } do
			local p = C.toWorld(x, y, z)
			local v, vis = cam:WorldToViewportPoint(p)
			if vis then
				return true
			end
			if v.Z > 0 then
				-- just off the edge but wide enough to reach in
				local vp = cam.ViewportSize
				local d = (p - cam.CFrame.Position).Magnitude
				local px = w / max(1, d) * vp.Y / (2 * math.tan(math.rad(cam.FieldOfView) / 2))
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
		local d = (C.toWorld(e.x, e.y, top * 0.5) - camPos).Magnitude
		if not onScreen(cam, e.x, e.y, top, 8 * rcBase) then
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
			set.L0 = SceneLight.sample(ctx, e.x, e.y, H * 0.5)
		end
		local L0 = set.L0
		if ctx.flashField then
			L0.flash = ctx.Tornado.FlashField.at(ctx.flashField, e.x, e.y, H * 0.5)
		end
		local sunV = L0.sunDir
		local sxs, sys_ = sunV.X, -sunV.Z
		local sl = sqrt(sxs * sxs + sys_ * sys_)
		local cosEl = sl
		if sl > 1e-3 then
			sxs, sys_ = sxs / sl, sys_ / sl
		end
		local sinEl = max(0.05, sunV.Y)
		local rainK = (1 - trans) * 0.85
		local tNow = ctx:simTime()
		local riseW = 0.15 * e.vc
		-- rain between camera and funnel greys it toward the same rain-fog grey the storm cards
		-- use (Render/StormCards: the sky's light diffused in rain), so funnel and storm agree
		local fg = 0.75 * L0.sky + 0.12 * L0.sun
		local rainCol = Color3.new(math.min(1, fg * 0.95), math.min(1, fg * 0.98), math.min(1, fg * 1.04))
		local warm = smooth(0.4, 0.05, sunV.Y) * (1 - L0.night)
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
			-- the ring turns with the flow at its radius
			local Rn = max(rc, 1) * 0.45 / max(5, rcz)
			local omega = min(e.vc / max(20, rcz) * Vortex.profile(max(Rn, 0.05)) / max(Rn, 0.05), 2.5)
			set.spin[h] = (set.spin[h] + omega * simDt * step) % (2 * math.pi)
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
					lr = { at = nowL, L = SceneLight.sample(ctx, cx, cy, z) }
					set.Lrow[h] = lr
				end
				L = lr.L
				-- (lightning is brief: its light is read fresh)
				if ctx.flashField then
					L.flash = ctx.Tornado.FlashField.at(ctx.flashField, cx, cy, z)
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
				card.att.WorldPosition = C.toWorld(cx + ox, cy + oy, zr)
				if k > 0 and card.a then
					card.img.ImageTransparency = 1 - clamp(card.a * env / 0.8, 0, 0.85)
				end
				if refresh then
					local w = max(size, 2)
					card.bb.Size = UDim2.fromScale(w, max(w * flat, 1.4 * dz))
					local a = clamp(dens * (if k == 0 then 0.9 else 0.6), 0, if k == 0 then 0.92 else 0.8)
					card.a = a
					if k == 0 then
						card.img.ImageTransparency = 1 - a
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
					local col = Color3.new(min(r, 1), min(g, 1), min(b, 1))
					card.img.ImageColor3 = col:Lerp(rainCol, rainK)
					-- (a tall tip card would tilt as a whole if its image turned: only a slight wobble)
					local tall = 1.4 * dz > w * 1.2
					card.img.Rotation = if tall
						then 8 * sin(card.rot + set.spin[h])
						else (card.rot + math.deg(set.spin[h]) * 0.5) % 360
				end
				n += 1
			end
		end
		-- sub-vortices (multi-vortex): each a thin column of cards orbiting with it, visible where its
		-- own deficit plus the parent's at its orbit can condense the air (as the mesh's tubes)
		set.subs = set.subs or {}
		local live = {}
		if (p.subCount or 0) > 0.3 then
			local NSV = 16
			local dzs = H * 0.92 / NSV
			local Ls = SceneLight.sample(ctx, e.x, e.y, H * 0.3)
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
					card.att.WorldPosition = C.toWorld(e.x + ax + sv[1], e.y + ay + sv[2], z)
					if refresh then
						local sw = max(2.4 * rt, 2)
						card.bb.Size = UDim2.fromScale(sw, max(sw, 1.5 * dzs))
						card.img.ImageTransparency = 1 - clamp(Cs * 0.85 * life * (0.6 + 0.4 * trans), 0, 0.85)
						card.img.ImageColor3 = SceneLight.shade(Ls, 0.74, 0.4):Lerp(rainCol, rainK)
						card.img.Rotation = 8 * sin(card.rot + hs)
					end
					card.bb.Enabled = true
				end
			end
		end
		for key, card in set.subs do
			if not live[key] then
				card.bb.Enabled = false
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
			local t = (ctx:simTime())
			local ax, ay = Vortex.axisAt(e, H * 0.8)
			-- (light cached 4 times a second, as the funnel's)
			if not set.Lt or nowL - (set.LtAt or 0) > 0.25 then
				set.LtAt = nowL
				set.Lt = SceneLight.sample(ctx, e.x, e.y, H * 0.8)
			end
			local Lt = set.Lt
			local colT = SceneLight.shade(Lt, 0.7, 0.3):Lerp(rainCol, rainK)
			local tagTex = if (C.TEXTURES.fractusFlat or "") ~= "" then C.TEXTURES.fractusFlat else C.TEXTURES.shredFlat
			for i = 1, NT do
				local card = set.tags[i]
				if not card then
					card = newCardAt(900 + i)
					card.img.Image = tagTex
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
				card.att.WorldPosition = C.toWorld(e.x + ax + math.cos(th) * r, e.y + ay + math.sin(th) * r, z)
				local sz = max(Rb * (1.1 - 0.5 * phi), 6)
				card.bb.Size = UDim2.fromScale(sz, sz * 0.55)
				card.img.ImageTransparency = 1 - clamp(0.6 * env * life * (0.6 + 0.4 * trans), 0, 0.8)
				card.img.ImageColor3 = colT
				card.bb.Enabled = true
			end
		else
			for _, card in set.tags do
				card.bb.Enabled = false
			end
		end
		-- heights skipped this LOD: hidden
		if step > 1 and refresh then
			for h = 2, ND, step do
				for k = 0, RING do
					set.cards[h][k].img.ImageTransparency = 1
				end
			end
		end
		return n
	end

	function self:update(dt: number)
		local t0 = os.clock()
		local adapter = ctx.tornadoAdapter
		local style = ctx.state.funnelStyle or "cards"
		local active = adapter and ctx.state.show.funnel ~= false and style == "cards" and (ctx.state.compare or "off") == "off"
		-- the nearest tornadoes get the sets
		local cam = Workspace.CurrentCamera
		local camPos = cam.CFrame.Position
		local list = {}
		if active then
			for _, e in adapter.entries do
				if e.params and (e.fade or 1) > 0.01 then
					local d = (C.toWorld(e.x, e.y, 0) - camPos).Magnitude
					if d < 60000 then
						table.insert(list, { e = e, d = d })
					end
				end
			end
			table.sort(list, function(a, b)
				return a.d < b.d
			end)
		end
		local used = {}
		local wanted = {}
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
		ctx.root:SetAttribute("TornadoCards", string.format("%d tornadoes · %d cards · %.2f ms", math.min(MAXT, #list), n, (os.clock() - t0) * 1000))
	end

	function self:destroy()
		folder:Destroy()
	end
	return self
end

return TornadoCards
