--!nonstrict
-- The ground around the camera: plain farmland tiles (client-only) that follow the camera, so
-- the lab has ground anywhere in its ~240 km domain. The town's own ground (server, physical)
-- sits a little higher where it exists. Fields vary a little in colour (seeded per tile) like
-- Plains section-line farmland.
-- The tiles lie at the datum (their top 0.3 m below it, under the terrain's base sheet): the server's Terrain
-- (LabConfig.GROUND.relief) covers them out to its radius. A tile is at most 2048 studs (a Part's
-- largest size: bigger tiles were clamped and left gaps between them, 2026-10-29). Tile sizes
-- are metres, crossed to studs through Config (docs/stormlab/SCALE-RULES.md).
local Workspace = game:GetService("Workspace")
local Lighting = game:GetService("Lighting")

local Ground = {}

function Ground.new(ctx: any): any
	local C = ctx.Config
	local G = C.GROUND
	local Noise = ctx.Sim.Noise
	local folder = Instance.new("Folder")
	folder.Name = "Ground"
	folder.Parent = ctx.root
	-- In the game (2026-11-07, the user: the lab's horizon, so the land doesn't just stop) the
	-- terrain is the ground: no tiles, the far rings only. The game's frame is at the map's scale
	-- across (LabConfig.frame kh, ~0.37 studs/m) and true up, so the rings are placed and sized in
	-- its studs: they fill in wherever the streamed terrain has run out, and nothing nearer is
	-- covered (a ring's cards hang below its own ground line).
	local F = C.frame
	local inGame = F ~= nil and F.kh ~= nil and F.ks ~= nil and F.kh < 0.99 * F.ks
	local function across(m: number): number
		return if inGame then m * F.kh else C.studs(m)
	end
	-- (a Part is at most 2048 studs a side; the tiles reach past the part draw range)
	local tile = math.min(G.tile, C.metres(2048))
	local radius = math.max(G.radius, math.ceil(C.studs(C.LIMITS.partRange) / C.studs(tile)) + 1)
	local n = if inGame then 0 else 2 * radius + 1
	local tiles = {}
	for _ = 1, n * n do
		local p = Instance.new("Part")
		p.Anchored, p.CanCollide, p.CanQuery, p.CanTouch = true, false, false, false
		p.CastShadow = false
		p.Size = Vector3.new(C.studs(tile), C.studs(2), C.studs(tile))
		p.Material = Enum.Material[G.material] or Enum.Material.Grass
		p.TopSurface = Enum.SurfaceType.Smooth
		p.Parent = folder
		table.insert(tiles, p)
	end
	local self = { lastI = nil, lastJ = nil }
	local parts, cfs = {}, {}
	local tileIJ = {}
	function self:update(_dt: number)
		if inGame then
			return
		end
		local cx, cy = ctx:simCamera()
		local ti, tj = math.floor(cx / tile + 0.5), math.floor(cy / tile + 0.5)
		local gc = C.groundCentre
		local R = G.relief
		if ti == self.lastI and tj == self.lastJ and gc == self.lastC and R == self.lastR then
			return
		end
		self.lastI, self.lastJ, self.lastC, self.lastR = ti, tj, gc, R
		-- tiles wholly inside the terrain's area sink 2 m under it: the terrain is the ground there,
		-- and its base sheet (on a 1.1 m voxel grid) can't sit reliably 0.2 m above a tile, so the
		-- tiles showed through round the town (2026-10-29)
		local inR = if (gc or (R and R.cx)) and R and R.amp > 0 then R.radius - 0.75 * tile else -1
		-- (the terrain's centre: the hills' own, else the town's)
		local tcx, tcy = if R and R.cx then R.cx else (gc and gc.x or 0), if R and R.cy then R.cy else (gc and gc.y or 0)
		table.clear(parts)
		table.clear(cfs)
		local k = 0
		for di = -radius, radius do
			for dj = -radius, radius do
				k += 1
				local p = tiles[k]
				local i, j = ti + di, tj + dj
				local h = Noise.hash(i, j, 1, 5)
				local base = G.colour
				local f = 0.85 + 0.25 * h
				local wheat = Noise.hash(i, j, 2, 5) > 0.7
				if wheat then
					p.Color = Color3.fromRGB(math.floor(150 * f), math.floor(136 * f), math.floor(86 * f))
				else
					p.Color = Color3.fromRGB(math.floor(base[1] * f), math.floor(base[2] * f), math.floor(base[3] * f))
				end
				table.insert(parts, p)
				tileIJ[k] = { i, j }
				local z = -1.3
				if inR > 0 then
					local fx = math.abs(i * tile - tcx) + 0.5 * tile
					local fy = math.abs(j * tile - tcy) + 0.5 * tile
					if fx * fx + fy * fy < inR * inR then
						z = -3.3
					end
				end
				table.insert(cfs, CFrame.new(C.toWorld(i * tile, j * tile, z)))
			end
		end
		Workspace:BulkMoveTo(parts, cfs, Enum.BulkMoveMode.FireCFrameChanged)
		if self.placeShade then
			self.placeShade()
		end
	end
	-- The far ground (2026-11-02). Parts are not drawn past ~7000 studs (~2 km), so past the tiles
	-- the view showed sky below the horizon - from any height the land stopped in a hard edge. Past
	-- them the ground is rings of upright billboards (drawn to ~28 km), each card's top edge on the
	-- ground line at the ring's distance and the card hanging down from there. That is safe for
	-- depth: anything nearer than the ring draws over it, and anything beyond stands above that
	-- line on screen (its foot is on farther ground), so a far storm or tornado is never covered.
	-- Rings from just past the tiles out to 15 km: each shows only the band between its own ground
	-- line and the next nearer ring's, so the haze grows ring by ring as over real land (one ring at
	-- 6 km jumped from the tiles' ~15% haze to its ~50% and stood up as a grey wall).
	-- Lit as the scene's self-lit visuals are (Tornado/SceneLight: the sun through the storms - a
	-- storm's shadow darkens the far ground under it - and the sky light); Roblox's own distance
	-- haze does the rest.
	local SceneLight = ctx.Tornado and ctx.Tornado.SceneLight
	local FAR = G.far or { rings = { 2400, 3200, 4300, 5800, 8000, 11000, 15000 }, cards = 96, sectors = 16, kA = 0.25, kS = 0.2 }
	if inGame then
		-- (metres of map: 1,500 to 18,000 studs, from about the streamed terrain's edge to as far
		-- as storms are drawn)
		FAR = table.clone(FAR)
		FAR.rings = { 4000, 5500, 7500, 10000, 13500, 18000, 24000, 32000, 42000, 50000 }
	end
	-- (in the game: how far the terrain is reliably drawn, studs - a ring's card reaches down to
	-- the ground line there)
	-- (a client can't read StreamingTargetRadius: Roblox's default, 1024)
	local okR, radiusS = pcall(function()
		return Workspace.StreamingTargetRadius
	end)
	local INNER = math.max(600, 0.8 * (if okR and type(radiusS) == "number" then radiusS else 1024))
	-- The field's colour as Roblox draws a tile at the camera (2026-11-02): the tiles are lit by
	-- Roblox (OutdoorAmbient, and the sun by Brightness - both set by Render/Sky from the camera's
	-- sky), the far cards are not (LightInfluence 0), so they take the same light in linear terms:
	-- albedo x (kA ambient + kS brightness x sun height), encoded back. (A fixed share of
	-- SceneLight's shade matched the tiles in sun only: under a storm, where the tiles are lit by
	-- the ambient alone, the far land drew ~1.8x brighter - a step at the tiles' edge.)
	-- The eye's adaptation (ExposureCompensation, raised under a storm) brightens the tiles, so it
	-- is in too. kA / kS fitted to the tile underfoot (where the shade veil is clear) at ground
	-- level: in sun ~58/255 green, under a low base ~29 (far land drew 1.9x the tiles in sun with
	-- kA 1, kS 0.5; a fit to raised views matched the veil's own colour, not the tiles).
	local function litGround(): (number, number, number)
		local amb = Lighting.OutdoorAmbient
		local sunK = (FAR.kS or 0.2) * Lighting.Brightness * math.max(0, Lighting:GetSunDirection().Y)
		local ex = 2 ^ Lighting.ExposureCompensation
		local kA = (FAR.kA or 0.25) * ex
		sunK *= ex
		local base = G.colour
		local function ch(a: number, l: number): number
			return math.clamp(((a / 255) ^ 2.2 * (kA * l ^ 2.2 + sunK)) ^ (1 / 2.2), 0, 1)
		end
		return ch(base[1], amb.R), ch(base[2], amb.G), ch(base[3], amb.B)
	end
	local anchor = Instance.new("Part")
	anchor.Anchored, anchor.CanCollide, anchor.CanQuery, anchor.CanTouch = true, false, false, false
	anchor.Transparency = 1
	anchor.Size = Vector3.one
	anchor.CFrame = CFrame.new()
	anchor.Parent = folder
	local rings = {}
	for ri, dR in FAR.rings do
		local ring = { d = dR, next = FAR.rings[ri + 1], cards = {} }
		for i = 1, FAR.cards do
			local att = Instance.new("Attachment")
			att.Parent = anchor
			local bb = Instance.new("BillboardGui")
			bb.Adornee = att
			bb.LightInfluence = 0
			bb.ResetOnSpawn = false
			bb.Enabled = false
			-- (hung below its attachment in screen space: the top edge passes through the ground
			-- point whatever way the card turns to face the camera. Offset along the camera's up
			-- vector, the km-tall cards' tops landed at different heights - steps, 2026-11-02)
			bb.SizeOffset = Vector2.new(0, -0.5)
			local fr = Instance.new("Frame")
			fr.BorderSizePixel = 0
			fr.Size = UDim2.fromScale(1, 1)
			fr.Parent = bb
			-- (a soft top: the rings step in haze one behind the other, each line feathered)
			local gr = Instance.new("UIGradient")
			gr.Rotation = 90
			gr.Transparency = NumberSequence.new({ NumberSequenceKeypoint.new(0, 1), NumberSequenceKeypoint.new(0.03, 0), NumberSequenceKeypoint.new(1, 0) })
			gr.Parent = fr
			bb.Parent = anchor
			ring.cards[i] = { att = att, bb = bb, fr = fr, gr = gr, a = (i - 0.5 + 0.5 * (ri - 1)) / FAR.cards * 2 * math.pi }
		end
		rings[ri] = ring
	end
	local colAt = -math.huge
	local farUpdate = function()
		local cam = Workspace.CurrentCamera
		if not cam then
			return
		end
		local on = ctx.state.show.ground ~= false
		local cx, cy, cz = ctx:simCamera()
		local cf = cam.CFrame
		local camP = cf.Position
		local hc = math.max(2, cz - C.groundAt(cx, cy)) -- (m above the ground)
		local gStuds = C.toWorld(cx, cy, C.groundAt(cx, cy)).Y -- (the ground under the camera, studs)
		local hcS = math.max(5, camP.Y - gStuds) -- (studs: the game's card heights)
		local recolour = os.clock() - colAt > 0.25
		if recolour then
			colAt = os.clock()
		end
		local base = G.colour
		local gr, gg, gb = base[1] / 255, base[2] / 255, base[3] / 255
		-- (the light and haze the rings are recoloured with: the same for every ring, looked up once)
		local fr0, fg0, fb0, atmo, refG
		local lit = false
		for _, ring in rings do
			local dR = ring.d
			-- (narrow cards: a card faces the screen, so its top is straight on screen while the
			-- ground line it stands for curves once the view tilts; at 32 a ring they drew as steps)
			-- (twice the spacing: each point under two cards of the ring alike. At 1.15x the
			-- feathered tops stacked only where neighbours overlapped, and the band showed vertical
			-- stripes a card wide, 2026-11-02)
			local wS = across(2 * dR * math.tan(math.pi / FAR.cards) * 2)
			-- the light by sector (sampled a few times a ring, not per card)
			if recolour or not ring.sec then
				ring.sec = ring.sec or {}
				-- (the camera's own light, as the tiles have it, scaled by the ground light there
				-- against the camera's: SceneLight.groundLight, local sky light as well as sun. The
				-- sky light of sample() is the camera's everywhere, so from under a base the sunny
				-- land past its edge came out as dark as the ground underfoot)
				if not lit then
					lit = true
					fr0, fg0, fb0 = litGround()
					atmo = Lighting:FindFirstChildOfClass("Atmosphere")
					refG = if SceneLight and SceneLight.groundLight then math.max(1e-3, SceneLight.groundLight(ctx, cx, cy, C.groundAt(cx, cy) + 2)) else nil
				end
				-- the haze Roblox puts on the land in front of the ring (Atmosphere: extinction
				-- 0.188 x Density^4.15 a stud, roblox-render-limits), which billboards don't get -
				-- unhazed, the rings stood as a dark wall over the fading terrain at the horizon,
				-- "the horizon is too high", user 2026-11-08
				local tr, hz = 1, nil
				if atmo then
					tr = math.exp(-0.188 * atmo.Density ^ 4.15 * across(dR))
					hz = atmo.Color
				end
				for k = 1, FAR.sectors do
					local a = (k - 0.5) / FAR.sectors * 2 * math.pi
					local sx, sy = cx + math.cos(a) * dR, cy + math.sin(a) * dR
					local r = 1
					if refG then
						r = math.min(2, (SceneLight.groundLight(ctx, sx, sy, C.groundAt(sx, sy) + 2) / refG) ^ (1 / 2.2))
					end
					local col = Color3.new(math.clamp(fr0 * r, 0, 1), math.clamp(fg0 * r, 0, 1), math.clamp(fb0 * r, 0, 1))
					ring.sec[k] = if hz then hz:Lerp(col, tr) else col
				end
			end
			-- (down from the ground line to below the tiles' edge seen from this height: ~1.5 km)
			local hM = hc * dR / 1000 + 100 -- (generous: the part below the tiles is hidden by them)
			local hS = C.studs(hM)
			local fe0 = hc * (1 - dR / (ring.next or 1.4 * dR)) / hM
			if inGame then
				-- (down to the ground line at INNER, with a margin)
				local dS = across(dR)
				hS = dS * (hcS / INNER + 0.03)
				fe0 = hcS * (1 - dR / (ring.next or 1.4 * dR)) / hS
			end
			-- (the top feathered across the whole band between this ring's ground line and the next
			-- farther ring's, so the hazier ring behind fades into this one: a 3% feather left each
			-- ring a flat band of its own haze, and from a raised camera the land stepped down in
			-- terraces, 2026-11-02. The gap on screen is hc (1/dR - 1/dN) radians, the card hM/dR)
			-- (the farthest ring as if one more stood 40% beyond: with a hard top its straight card
			-- edges sawed along the horizon against the sky)
			local fe = math.clamp(fe0, 0.03, 0.6)
			fe = math.floor(fe * 200 + 0.5) / 200
			local newFe = ring.fe ~= fe
			ring.fe = fe
			local seq = if newFe then NumberSequence.new({ NumberSequenceKeypoint.new(0, 1), NumberSequenceKeypoint.new(fe, 0), NumberSequenceKeypoint.new(1, 0) }) else nil
			for _, c in ring.cards do
				if seq then
					c.gr.Transparency = seq
				end
				local gx, gy = cx + math.cos(c.a) * dR, cy + math.sin(c.a) * dR
				local top = C.toWorld(gx, gy, C.groundAt(gx, gy))
				local drop = 0
				if inGame then
					-- (in the game the land's heights are at the near vertical scale over the map's
					-- squeezed distances, ~10x the true slope: a rise of 30 m 4 km off stood 3.4 deg over
					-- the eye, truly 0.4 - "the horizon is too high", user 2026-11-08; easing to the
					-- storms' far scale past 3000 studs left the near rings as high, user. Past the
					-- streamed terrain the land is seen at its true angle from the eye: its height over
					-- the eye (m) at the map's scale across, less the earth's curve (4/3 radius for
					-- refraction). Where the near terrain's own edge stands higher, it covers the ring)
					local rel = (top.Y - gStuds) / F.kv - dR * dR / (2 * 8.5e6) - hcS / F.kv
					local y = camP.Y + rel * F.kh
					-- (where the land falls away the card reaches down past the terrain's own,
					-- steeper edge: no sky between)
					drop = math.max(0, y - top.Y)
					top = Vector3.new(top.X, y, top.Z)
				end
				-- (only the half of the ring in front: cards behind the camera are skipped)
				local ray = top - camP
				local vis = on and ray:Dot(cf.LookVector) > -0.2 * ray.Magnitude
				if c.bb.Enabled ~= vis then
					c.bb.Enabled = vis
				end
				if vis then
					-- (the top edge on the ground line, its feathered 3% inside the card: feathered about
					-- the line, the soft top rose over the foot of a tornado just beyond the ring)
					if c.top ~= top then
						c.top = top
						c.att.WorldPosition = top
					end
					-- (wider off the view's centre: a facing card's screen width falls as cos of its angle
					-- off-centre while the spacing of the cards' centres grows as 1/cos², so past ~30° the
					-- cards parted and the farther, paler ring showed through in seams)
					local cosA = math.max(0.35, ray:Dot(cf.LookVector) / ray.Magnitude)
					local sw, sh = wS / (cosA * cosA), hS + drop
					if c.sw ~= sw or c.sh ~= sh then
						c.sw, c.sh = sw, sh
						c.bb.Size = UDim2.fromScale(sw, sh)
					end
					-- (blended between the two nearest sectors: snapped, the cards showed as blocks)
					local fs = ((c.a % (2 * math.pi)) / (2 * math.pi)) * FAR.sectors - 0.5
					local k0 = math.floor(fs)
					local col = ring.sec[k0 % FAR.sectors + 1]:Lerp(ring.sec[(k0 + 1) % FAR.sectors + 1], fs - k0)
					if c.col ~= col then
						c.col = col
						c.fr.BackgroundColor3 = col
					end
				end
			end
		end
	end
	-- The storm's shadow on the near ground (2026-11-02). The tiles are lit by Roblox's lighting,
	-- which is one light for the whole world - the camera's (Render/Sky) - so ground under a storm
	-- a few km off was as bright as the sunlit field underfoot, and from under the base the sunny
	-- land beyond its edge was as dark as the ground below you. A billboard cloud casts no shadow
	-- (and Roblox's shadow maps don't reach km). So the light the storms leave on the ground
	-- (SceneLight.groundLight: the sun through them, the sky light their bases leave) is put on the
	-- tiles as a soft texture: one small EditableImage over the whole tile field, each tile's
	-- SurfaceGui showing its own square of it (bilinear, so no blocks). Relative to the camera's
	-- own light: darker ground gets a black veil, brighter ground a veil of its own sunlit colour.
	-- Built a few rows a frame under a time budget; a new pass starts when one ends.
	local SHADE = G.shade or { px = 8, budget = 0.002, maxDark = 0.75, maxBright = 0.7 }
	local AssetService = game:GetService("AssetService")
	local P = SHADE.px
	local W = n * P
	local okEI, ei = true, nil -- (no tiles in the game: nothing to shade)
	if not inGame then
		okEI, ei = pcall(function()
			return AssetService:CreateEditableImage({ Size = Vector2.new(W, W) })
		end)
	end
	if okEI and ei and SceneLight and SceneLight.groundLight then
		local content = Content.fromObject(ei)
		local labels = {}
		for k, p in tiles do
			local sg = Instance.new("SurfaceGui")
			sg.Face = Enum.NormalId.Top
			sg.LightInfluence = 0
			sg.SizingMode = Enum.SurfaceGuiSizingMode.FixedSize
			sg.CanvasSize = Vector2.new(64, 64)
			pcall(function()
				sg.MaxDistance = 0 -- (no limit)
			end)
			sg.Adornee = p
			local im = Instance.new("ImageLabel")
			im.BackgroundTransparency = 1
			im.Size = UDim2.fromScale(1, 1)
			im.ImageContent = content
			im.ImageRectSize = Vector2.new(P, P)
			im.Visible = false
			im.Parent = sg
			sg.Parent = p
			labels[k] = im
		end
		local buf = buffer.create(W * W * 4)
		local pass = nil -- { ti, tj, row, ref, sunCol }
		local shown = nil -- the origin of the image last written
		local function placeShade()
			if not shown then
				return
			end
			local i0, j0 = shown[1] - radius, shown[2] + radius
			for k, im in labels do
				local ij = tileIJ[k]
				if ij then
					local ci, rj = ij[1] - i0, j0 - ij[2]
					local inside = ci >= 0 and ci < n and rj >= 0 and rj < n
					im.Visible = inside and ctx.state.show.ground ~= false
					if inside then
						-- (the top face's canvas: x along +X (east), y along +Z (south), so the
						-- image's rows run north to south)
						im.ImageRectOffset = Vector2.new(ci * P, rj * P)
					end
				end
			end
		end
		self.placeShade = placeShade
		local base = G.colour
		local function shadeStep()
			local t0 = os.clock()
			if not pass then
				local cx, cy = ctx:simCamera()
				local ref = math.max(1e-3, SceneLight.groundLight(ctx, cx, cy, C.groundAt(cx, cy) + 2))
				local lr, lg, lb = litGround()
				pass = { ti = self.lastI or 0, tj = self.lastJ or 0, row = 0, ref = ref, lit = { lr, lg, lb } }
			end
			local x0 = (pass.ti - radius - 0.5) * tile
			local y0 = (pass.tj + radius + 0.5) * tile
			local d = tile / P
			-- (the field's colour at the camera's own lighting, as the far rings take it)
			local lit = pass.lit
			while pass.row < W and os.clock() - t0 < SHADE.budget do
				local row = pass.row
				local y = y0 - (row + 0.5) * d
				for col = 0, W - 1 do
					local x = x0 + (col + 0.5) * d
					-- (the light ratio as displayed: colours are gamma-encoded, so a tenth of the light
					-- is ~0.35 of the value, not 0.1 - scaled linearly the shaded ground went black)
					local r = (SceneLight.groundLight(ctx, x, y, C.groundAt(x, y) + 2) / pass.ref) ^ (1 / 2.2)
					local o = (row * W + col) * 4
					if r < 1 then
						buffer.writeu8(buf, o, 0)
						buffer.writeu8(buf, o + 1, 0)
						buffer.writeu8(buf, o + 2, 0)
						buffer.writeu8(buf, o + 3, math.floor(255 * math.min(SHADE.maxDark, 1 - r)))
					else
						-- (brighter than the camera's: its own colour at that light, over the dim tile)
						local kk = math.min(r, 2)
						buffer.writeu8(buf, o, math.floor(255 * math.min(1, lit[1] * kk)))
						buffer.writeu8(buf, o + 1, math.floor(255 * math.min(1, lit[2] * kk)))
						buffer.writeu8(buf, o + 2, math.floor(255 * math.min(1, lit[3] * kk)))
						buffer.writeu8(buf, o + 3, math.floor(255 * math.min(SHADE.maxBright, 1 - 1 / r)))
					end
				end
				pass.row += 1
			end
			if pass.row >= W then
				ei:WritePixelsBuffer(Vector2.zero, Vector2.new(W, W), buf)
				shown = { pass.ti, pass.tj }
				placeShade()
				pass = nil
			end
		end
		self.shadeStep = shadeStep
	elseif not okEI then
		warn("[StormLab] Ground: no EditableImage for the storm shadow (" .. tostring(ei) .. ")")
	end
	local tileUpdate = self.update
	function self:update(dt: number)
		tileUpdate(self, dt)
		farUpdate()
		if self.shadeStep then
			self.shadeStep()
		end
	end
	function self:destroy()
		folder:Destroy()
	end
	return self
end

return Ground
