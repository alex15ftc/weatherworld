--!nonstrict
-- Funnel comparison prototype (F4 panel: "compare", or C with the panel open).
--
-- A = Render/TornadoVisuals: the procedural mesh (ring tube, per-vertex condensation alpha).
-- B = this: a noise-textured LAYERED funnel - camera-facing ribbons (Beams) stacked up the axis,
--     three layers of uploaded noise textures scrolling up at different speeds, widths from the
--     condensed radius at each height, opacity from the cloud optical depth.
-- Both read the same smoothed state (ctx.tornadoAdapter), the same physics
-- (Vortex.condensationRadius, axisAt, ProfileLibrary envelope) and the same light
-- (Tornado/SceneLight), so only the rendering technique differs.
--
-- C = particle condensation: soft puffs (ParticleEmitters) filling the condensed tube at each
--     height, locked to invisible parts that turn at the vortex's angular speed (vc / r), so the
--     puffs orbit with the flow; rate and opacity from the optical depth. Roblox stops drawing
--     particles ~800 studs out, so C is drawn scaled toward the camera (same direction and
--     angular size) when further than that.
--
-- Modes (ctx.state.compare):
--   "A | B | C"  B and C drawn as copies either side of the real tornado (A), offset square to
--                the view (same distance, same light): B to the right, C to the left
--   "B only"     B at the real tornado, A hidden (with the real dust and debris)
--   "C only"     C at the real tornado, A hidden
-- A prototype for judging the look, not a finished renderer: no LOD, one tornado.
local Workspace = game:GetService("Workspace")

local FunnelCompare = {}

local NSEG = 18 -- heights (NSEG - 1 ribbons per layer)
local BETA = 0.075 -- cloud extinction (1/m), as A
local LAYERS = {
	-- texture, width x the condensed diameter, opacity scale, texture speed (up), tile length x width
	-- (the main game's tileable funnel streak textures; the lab's 4x4 cloud sheets read as beads)
	{ tex = "funnelCore", wk = 1.0, ak = 1.0, speed = 0.12, tile = 2.0 }, -- the body
	{ tex = "funnelWisp", wk = 1.25, ak = 0.55, speed = 0.3, tile = 1.5 }, -- fibrous, faster
	{ tex = "softFlat", wk = 1.7, ak = 0.3, speed = 0.06, tile = 3.0 }, -- soft outer haze
}

local function smooth(a: number, b: number, x: number): number
	local t = math.clamp((x - a) / (b - a), 0, 1)
	return t * t * (3 - 2 * t)
end

function FunnelCompare.new(ctx: any): any
	local C = ctx.Config
	local Vortex = ctx.Sim.Vortex
	local self = { visible = false }
	local folder = Instance.new("Folder")
	folder.Name = "FunnelCompare"
	folder.Parent = ctx.root
	local host = Instance.new("Part")
	host.Name = "CompareAnchor"
	host.Anchored, host.CanCollide, host.CanQuery, host.CanTouch = true, false, false, false
	host.Transparency = 1
	host.Size = Vector3.one
	host.CFrame = CFrame.new()
	host.Parent = folder
	local atts = {}
	for i = 1, NSEG do
		local a = Instance.new("Attachment")
		a.Parent = host
		atts[i] = a
	end
	local beams = {} -- [layer][segment]
	for li, L in LAYERS do
		beams[li] = {}
		for s = 1, NSEG - 1 do
			local b = Instance.new("Beam")
			b.Attachment0, b.Attachment1 = atts[s], atts[s + 1]
			b.FaceCamera = true
			b.Segments = 1
			b.LightInfluence = 0 -- self-lit: the colour is the scene light (as A's Neon shells)
			b.LightEmission = 0
			b.Texture = C.TEXTURES[L.tex]
			b.TextureMode = Enum.TextureMode.Wrap
			b.TextureSpeed = L.speed
			b.ZOffset = li * 0.01 -- (the body in front of the haze)
			b.Enabled = false
			b.Parent = host
			beams[li][s] = b
		end
	end

	-- C: one spinning invisible part + emitter per height band
	local NC = 12
	local cParts, cEm = {}, {}
	for i = 1, NC do
		local p = Instance.new("Part")
		p.Name = "CondensationBand"
		p.Anchored, p.CanCollide, p.CanQuery, p.CanTouch, p.CastShadow = true, false, false, false, false
		p.Transparency = 1
		p.Size = Vector3.new(4, 4, 4)
		p.Parent = folder
		local em = Instance.new("ParticleEmitter")
		em.Texture = if i % 2 == 0 then C.TEXTURES.wispFlat else C.TEXTURES.softFlat
		em.Shape = Enum.ParticleEmitterShape.Cylinder
		em.ShapeStyle = Enum.ParticleEmitterShapeStyle.Volume
		em.LockedToPart = true -- (the band's spin carries the puffs round)
		em.LightInfluence = 0
		em.LightEmission = 0
		em.EmissionDirection = Enum.NormalId.Top
		em.Lifetime = NumberRange.new(1.6, 2.6)
		em.Rotation = NumberRange.new(0, 360)
		em.RotSpeed = NumberRange.new(-25, 25)
		em.Rate = 0
		em.Enabled = false
		em.Parent = p
		cParts[i], cEm[i] = p, em
	end
	local cSpin = table.create(NC, 0)
	local cAcc = 0

	-- D: a billboard volume - soft camera-facing cards stacked up the axis (a centre card and a
	-- ring turning with the flow at each height). Billboards draw at any distance.
	local ND, RING = 30, 5
	local dAnchor = Instance.new("Part")
	dAnchor.Name = "BillboardAnchor"
	dAnchor.Anchored, dAnchor.CanCollide, dAnchor.CanQuery, dAnchor.CanTouch = true, false, false, false
	dAnchor.Transparency = 1
	dAnchor.Size = Vector3.one
	dAnchor.CFrame = CFrame.new()
	dAnchor.Parent = folder
	local dCards = {} -- [height][card] = { att, bb, img }
	for h = 1, ND do
		dCards[h] = {}
		for k = 0, RING do
			local att = Instance.new("Attachment")
			att.Parent = dAnchor
			local bb = Instance.new("BillboardGui")
			bb.Adornee = att
			bb.LightInfluence = 0 -- (lit by SceneLight, like A's shells)
			bb.Size = UDim2.fromScale(10, 10)
			bb.Enabled = false
			bb.ResetOnSpawn = false
			local img = Instance.new("ImageLabel")
			img.BackgroundTransparency = 1
			img.Size = UDim2.fromScale(1, 1)
			img.Image = C.TEXTURES.softFlat
			img.ImageTransparency = 1
			img.Rotation = (h * 47 + k * 113) % 360
			img.Parent = bb
			bb.Parent = dAnchor
			dCards[h][k] = { att = att, bb = bb, img = img, rot = img.Rotation }
		end
	end
	local dSpin = table.create(ND, 0)
	local showD = false
	local function setD(v: boolean)
		if showD == v then
			return
		end
		showD = v
		for _, row in dCards do
			for _, c in row do
				c.bb.Enabled = v
			end
		end
	end

	local rZ, rR, rX, rY, rA, rCol = {}, {}, {}, {}, {}, {}
	local showB, showC = false, false
	local function setVisible(b: boolean, c: boolean)
		if showB ~= b then
			showB = b
			for _, layer in beams do
				for _, bm in layer do
					bm.Enabled = b
				end
			end
		end
		if showC ~= c then
			showC = c
			for i = 1, NC do
				cEm[i].Enabled = c
				if not c then
					cEm[i]:Clear()
				end
			end
		end
	end

	-- the funnel at height z (shared by B and C): condensed radius, axis offset, opacity, colour
	local function band(e: any, z: number, H: number, top: number, R: number, L: any, rainCol: Color3, Profiles: any)
		local hn = math.min(z / H, 1)
		local r0 = R * Profiles.radius(e.weights, hn)
		local rc = if z >= H * 0.95 then r0 else math.min(Vortex.condensationRadius(e, math.min(z, H * 0.995)), r0)
		local ax, ay = Vortex.axisAt(e, math.min(z, H))
		-- optical depth through the middle of the tube; fades into the cloud base above it
		local fadeTop = 1 - 0.85 * smooth(H * 0.96, top, z)
		local trans = e.trans or 1
		local a = (1 - math.exp(-2 * BETA * rc)) * fadeTop * (e.fade or 1) * (0.6 + 0.4 * trans)
		local col = ctx.Tornado.SceneLight.shade(L, 0.76, 0.35):Lerp(rainCol, (1 - trans) * 0.85)
		return rc, ax, ay, a, col
	end

	function self:update(dt: number)
		local mode = ctx.state.compare or "off"
		ctx.state.hideFunnelA = mode == "B only" or mode == "C only" or mode == "D only"
		local adapter = ctx.tornadoAdapter
		if mode == "off" or not adapter or not ctx.state.show.funnel then
			setVisible(false, false)
			setD(false)
			return
		end
		local t0 = os.clock()
		-- the tornado nearest the focus
		local fx, fy = ctx:focus()
		local e, best = nil, math.huge
		for _, en in adapter.entries do
			local d = (en.x - fx) ^ 2 + (en.y - fy) ^ 2
			if d < best and en.params then
				e, best = en, d
			end
		end
		if not e then
			setVisible(false, false)
			setD(false)
			return
		end
		local useB = mode == "A | B | C" or mode == "B only"
		local useC = mode == "A | B | C" or mode == "C only"
		local SceneLight = ctx.Tornado.SceneLight
		local Profiles = ctx.Tornado.ProfileLibrary
		local H = math.max(100, e.cloudBase)
		local top = H * 1.07 + 30
		local R = math.max(8, e.R)
		-- copies sit square to the view (same distance as the real one): B right, C left
		local cam = Workspace.CurrentCamera.CFrame
		local sx, sy = 0, 0
		if mode == "A | B | C" or mode == "A | D" then
			local lx, ly = cam.LookVector.X, -cam.LookVector.Z
			local l = math.sqrt(lx * lx + ly * ly)
			if l > 1e-3 then
				lx, ly = lx / l, ly / l
			else
				lx, ly = 0, 1
			end
			local sep = 3 * R + 250
			sx, sy = ly * sep, -lx * sep -- (to the camera's right)
		end
		local L = SceneLight.sample(ctx, e.x, e.y, H * 0.5)
		local rainCol = SceneLight.shade(L, 0.62, 0.25)

		-- B: layered ribbons
		if useB then
			for i = 1, NSEG do
				local z = (i - 1) / (NSEG - 1) * top
				local rc, ax, ay, a, col = band(e, z, H, top, R, L, rainCol, Profiles)
				rZ[i], rR[i], rA[i], rCol[i] = z, rc, a, col
				rX[i], rY[i] = e.x + ax + sx, e.y + ay + sy
				atts[i].WorldPosition = C.toWorld(rX[i], rY[i], z)
			end
			for li, Ly in LAYERS do
				local layer = beams[li]
				for s = 1, NSEG - 1 do
					local b = layer[s]
					local w0, w1 = 2 * rR[s] * Ly.wk, 2 * rR[s + 1] * Ly.wk
					local a0, a1 = rA[s] * Ly.ak, rA[s + 1] * Ly.ak
					b.Width0, b.Width1 = math.max(0.1, w0), math.max(0.1, w1)
					b.TextureLength = math.max(4, Ly.tile * 0.5 * (w0 + w1))
					b.Transparency = NumberSequence.new(1 - math.clamp(a0, 0, 1), 1 - math.clamp(a1, 0, 1))
					b.Color = ColorSequence.new(rCol[s], rCol[s + 1])
				end
			end
		end

		-- C: particle bands, turning with the flow; scaled toward the camera past ~700 studs
		if useC then
			local cx, cy = if mode == "A | B | C" then -sx else 0, if mode == "A | B | C" then -sy else 0
			local mid = C.toWorld(e.x + cx, e.y + cy, top * 0.5)
			local dMid = (mid - cam.Position).Magnitude
			local k = math.min(1, 700 / math.max(1, dMid))
			local simDt = if ctx.state.paused then 0 else dt * (ctx.state.timeScale or 1)
			cAcc += dt
			local refresh = cAcc > 0.1 -- (emitter properties at 10 Hz; positions every frame)
			if refresh then
				cAcc = 0
			end
			local segH = top / NC
			for i = 1, NC do
				local z = (i - 0.5) * segH
				local rc, ax, ay, a, col = band(e, z, H, top, R, L, rainCol, Profiles)
				-- angular speed of the condensed surface (cyclostrophic profile at that radius)
				local rcz = Vortex.rcAt(e.params, math.min(z, H))
				local Rn = math.max(rc, 1) / math.max(5, rcz)
				local omega = math.min(e.vc / math.max(20, rcz) * Vortex.profile(math.max(Rn, 0.05)) / math.max(Rn, 0.05), 2.5)
				cSpin[i] = (cSpin[i] + omega * simDt) % (2 * math.pi)
				local P = C.toWorld(e.x + ax + cx, e.y + ay + cy, z)
				local Pd = cam.Position + (P - cam.Position) * k
				local part = cParts[i]
				local w = math.max(0.5, 2 * rc * 0.9) * k
				part.Size = Vector3.new(w, segH * k, w)
				part.CFrame = CFrame.new(Pd) * CFrame.Angles(0, -cSpin[i], 0) -- (counter-clockwise seen from above)
				if refresh then
					local em = cEm[i]
					local puff = math.max(1, 0.7 * rc) * k
					em.Size = NumberSequence.new({
						NumberSequenceKeypoint.new(0, puff * 0.6),
						NumberSequenceKeypoint.new(1, puff * 1.3),
					})
					local tA = 1 - math.clamp(a * 0.55, 0, 0.9)
					em.Transparency = NumberSequence.new({
						NumberSequenceKeypoint.new(0, 1),
						NumberSequenceKeypoint.new(0.2, tA),
						NumberSequenceKeypoint.new(0.75, tA),
						NumberSequenceKeypoint.new(1, 1),
					})
					em.Color = ColorSequence.new(col)
					em.Speed = NumberRange.new(0.02 * rc * k, 0.08 * rc * k) -- (a slow rise: the updraft)
					-- enough puffs to fill the band where it is dense, none where nothing condenses
					em.Rate = if rc > 0.5 and a > 0.02 then math.clamp(6 + 30 * a, 0, 40) else 0
				end
			end
		end
		-- D: billboard volume. Card size from the condensed radius WITHOUT the profile cap, so the
		-- funnel flares into the lowering the way the physics says (the pressure fall needed to
		-- condense vanishes toward the cloud base); each card is a partial optical depth, so the
		-- stack is dense in the middle and soft at every edge.
		local useD = mode == "A | D" or mode == "D only"
		if useD then
			local simDt = if ctx.state.paused then 0 else dt * (ctx.state.timeScale or 1)
			local sun = L.sunDir
			local sxs, sys_ = sun.X, -sun.Z -- (sim frame)
			local sl = math.sqrt(sxs * sxs + sys_ * sys_)
			if sl > 1e-3 then
				sxs, sys_ = sxs / sl, sys_ / sl
			end
			for h = 1, ND do
				local u = (h - 0.5) / ND
				local z = u * top
				local zc = math.min(z, H * 0.995)
				local rcz = Vortex.rcAt(e.params, math.min(z, H))
				local rc = math.min(Vortex.condensationRadius(e, zc), 4 * rcz)
				if z >= H * 0.995 then
					rc = 4 * rcz -- (inside the base: the lowering's full width)
				end
				local ax, ay = Vortex.axisAt(e, math.min(z, H))
				local cx, cy = e.x + ax + sx, e.y + ay + sy
				local fadeTop = 1 - 0.9 * smooth(H * 0.98, top, z)
				local trans = e.trans or 1
				local dens = (1 - math.exp(-2 * BETA * rc)) * fadeTop * (e.fade or 1) * (0.6 + 0.4 * trans)
				-- the ring turns with the flow at its radius
				local Rn = math.max(rc, 1) * 0.45 / math.max(5, rcz)
				local omega = math.min(e.vc / math.max(20, rcz) * Vortex.profile(math.max(Rn, 0.05)) / math.max(Rn, 0.05), 2.5)
				dSpin[h] = (dSpin[h] + omega * simDt) % (2 * math.pi)
				local row = dCards[h]
				for k = 0, RING do
					local card = row[k]
					local px, py, size, facing
					if k == 0 then
						px, py, size, facing = cx, cy, 2.1 * rc, 0.3
					else
						local a = dSpin[h] + (k - 1) / RING * 2 * math.pi + h * 0.7
						local ca, sa = math.cos(a), math.sin(a)
						px, py = cx + ca * 0.45 * rc, cy + sa * 0.45 * rc
						size = 1.35 * rc
						facing = 0.3 + 0.5 * (ca * sxs + sa * sys_) -- (the sunward side lighter)
					end
					size = math.max(size, 2)
					card.att.WorldPosition = C.toWorld(px, py, z)
					card.bb.Size = UDim2.fromScale(size, size)
					-- partial density per card: the stack builds the opaque core
					local a = math.clamp(dens * (if k == 0 then 0.9 else 0.6), 0, if k == 0 then 0.92 else 0.8)
					card.img.ImageTransparency = 1 - a
					local col = SceneLight.shade(L, 0.74, facing):Lerp(rainCol, (1 - trans) * 0.85)
					card.img.ImageColor3 = col
					card.img.Rotation = (card.rot + math.deg(dSpin[h]) * 0.5) % 360
				end
			end
		end
		setD(useD)
		setVisible(useB, useC)
		ctx.root:SetAttribute("CompareMs", math.floor((os.clock() - t0) * 1e5 + 0.5) / 100)
	end

	function self:destroy()
		folder:Destroy()
	end
	return self
end

return FunnelCompare
