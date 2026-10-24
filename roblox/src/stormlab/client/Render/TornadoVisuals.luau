--!nonstrict
--!native
-- Tornado visuals (docs/stormlab/TORNADO-VISUALS.md; the visual implementation plan, phases A-F).
-- One controller per tornado, created and cleaned up as tornadoes come and go (registry), each
-- drawn from the smoothed replicated state (Tornado/StateAdapter). Physics is never touched:
-- the wind field, damage and debris don't know or care what is visible.
--
--   shells      core + veil: one ring mesh each (Tornado/TubeMesh), shape from blended profile
--               families (Tornado/ProfileLibrary) x the visual scale R, centreline = the vortex's
--               physical axis + a profile-dependent coherent wander; radius deformed at three
--               coherent scales turning at the flow's angular speed and rising with the updraft
--   condensed   alpha is a FIELD: C(h) = condensation radius / envelope radius from the pressure
--               deficit (Vortex.condensationRadius), broken up round the circumference where
--               partially condensed (coherent noise + the moist inflow side), so a vortex can be
--               fully, partly or barely visible while its winds are unchanged
--   rain        rain between camera and vortex (StateAdapter.trans) fades its contrast into rain
--               grey (mostly a colour blend; opacity only drops a little, so the sky behind
--               never shows through a condensed funnel); heavy rain round it (wrap) turns the veil into a rain curtain at a wider
--               radius: obscured spatially, never a dark solid tube
--   multivortex each physical sub-vortex (Vortex.subvortices, stable ids) is a thin tube in one
--               shared mesh, visible where its own deficit plus the parent's at its orbit can
--               condense air: independently visible, forming and fading with the physics
--   collar      soft cloud masses round the funnel top where it meets the lowering (no seam);
--               turning slower than the funnel
--   wisps       a few condensation fragments shed where the funnel is partly condensed (near only)
--   light       self-lit (Neon / LightInfluence 0) with the scene's light computed here
--               (Tornado/SceneLight: sun through the storms' cloud, sky light, night, the local
--               lightning field): at night it is nearly invisible until a flash lights it
--   LOD         0 close (< 1.5 km): everything; 1 chase (< 6 km): shells, tubes, collar, every
--               other frame; 2 distant: a sprite silhouette (and any tornado beyond the mesh
--               budget); 3 far (> 45 km) or hidden: nothing. Heavy obscuration drops a level.
--   debug       ctx.state.debug: geometryOnly, condensation, centerline, subvortices, groundRadius,
--               lod, physics, flashes (UI/VisualTests toggles them)
local Lighting = game:GetService("Lighting")
local Workspace = game:GetService("Workspace")

local TV = {}

local NR, NS = 40, 40
local SR, SS, NSUB = 14, 8, 6
local MAX_MESH_SETS = 2
local LOD0, LOD1, LOD2 = 1500, 6000, 45000
local RHO, G = 1.15, 9.81

local sqrt, sin, cos, exp, atan2, abs, max, min, clamp = math.sqrt, math.sin, math.cos, math.exp, math.atan2, math.abs, math.max, math.min, math.clamp
local TAU = 2 * math.pi

local function smooth(a: number, b: number, x: number): number
	local t = clamp((x - a) / (b - a), 0, 1)
	return t * t * (3 - 2 * t)
end

local function mixC(a: Color3, b: Color3, f: number): Color3
	return Color3.new(a.R + (b.R - a.R) * f, a.G + (b.G - a.G) * f, a.B + (b.B - a.B) * f)
end

local function heat(v: number): Color3
	-- debug: 0 blue -> 0.5 green -> 1 red
	v = clamp(v, 0, 1)
	return Color3.new(smooth(0.4, 0.9, v), 1 - abs(v - 0.5) * 1.6, smooth(0.6, 0.1, v))
end

function TV.new(ctx: any): any
	local C = ctx.Config
	local T = ctx.Tornado
	local Vortex = ctx.Sim.Vortex
	local Noise = ctx.Sim.Noise
	local Profiles, SceneLight, TubeMesh = T.ProfileLibrary, T.SceneLight, T.TubeMesh
	local adapter = T.StateAdapter.new(ctx)
	local folder = Instance.new("Folder")
	folder.Name = "TornadoVisuals"
	folder.Parent = ctx.root
	local dbgFolder = Instance.new("Folder")
	dbgFolder.Name = "TornadoDebug"
	dbgFolder.Parent = ctx.root
	local spriteAnchor = Instance.new("Part")
	spriteAnchor.Name = "TornadoSprites"
	spriteAnchor.Anchored, spriteAnchor.CanCollide, spriteAnchor.CanQuery, spriteAnchor.CanTouch = true, false, false, false
	spriteAnchor.Transparency = 1
	spriteAnchor.Size = Vector3.one
	spriteAnchor.Parent = folder
	local texture = TubeMesh.texture(Noise)

	local self = { controllers = {}, meshSets = 0, frame = 0, stats = {} }

	-- sprites (collar, far silhouette, debug labels) ------------------------------------------
	local function sprite(image: string): any
		local att = Instance.new("Attachment")
		att.Parent = spriteAnchor
		local bb = Instance.new("BillboardGui")
		bb.Adornee = att
		bb.LightInfluence = 0
		bb.Size = UDim2.fromScale(10, 10)
		bb.Enabled = false
		bb.Parent = spriteAnchor
		local img = Instance.new("ImageLabel")
		img.BackgroundTransparency = 1
		img.Size = UDim2.fromScale(1, 1)
		img.Image = image
		img.ImageTransparency = 1
		img.Parent = bb
		return { att = att, bb = bb, img = img }
	end
	local function label(): any
		local att = Instance.new("Attachment")
		att.Parent = spriteAnchor
		local bb = Instance.new("BillboardGui")
		bb.Adornee = att
		bb.AlwaysOnTop = true
		bb.LightInfluence = 0
		bb.Size = UDim2.fromOffset(260, 46)
		bb.Enabled = false
		bb.Parent = spriteAnchor
		local tl = Instance.new("TextLabel")
		tl.BackgroundTransparency = 0.35
		tl.BackgroundColor3 = Color3.new(0, 0, 0)
		tl.TextColor3 = Color3.new(1, 1, 1)
		tl.TextSize = 12
		tl.Font = Enum.Font.Code
		tl.Size = UDim2.fromScale(1, 1)
		tl.TextWrapped = true
		tl.Parent = bb
		return { att = att, bb = bb, tl = tl }
	end

	-- debug parts --------------------------------------------------------------------------
	local dbgPool, dbgUsed = {}, {}
	local function dbgPart(colour: Color3, size: Vector3, cf: CFrame)
		local p = table.remove(dbgPool)
		if not p then
			p = Instance.new("Part")
			p.Anchored, p.CanCollide, p.CanQuery, p.CanTouch, p.CastShadow = true, false, false, false, false
			p.Material = Enum.Material.Neon
			p.Parent = dbgFolder
		end
		p.Color = colour
		p.Size = size
		p.CFrame = cf
		p.Transparency = 0.2
		table.insert(dbgUsed, p)
	end
	local function dbgFlush()
		for _, p in dbgUsed do
			p.Transparency = 1
			table.insert(dbgPool, p)
		end
		table.clear(dbgUsed)
	end

	-- a controller per tornado -------------------------------------------------------------
	local function newController(e: any): any
		local c = { id = e.id, lod = -1, sprites = {}, wisps = {}, far = {}, labels = {}, trail = {}, phase = math.random(0, 3) }
		for _ = 1, 12 do
			table.insert(c.sprites, sprite(C.TEXTURES.softFlat))
		end
		for _ = 1, 8 do
			table.insert(c.far, sprite(C.TEXTURES.softFlat))
		end
		c.labels.lod = label()
		c.labels.phys = label()
		c.subLabels = {}
		for _ = 1, NSUB do
			table.insert(c.subLabels, label())
		end
		-- wisps: a small invisible ring part per emitter (emits from its surface, turns with it)
		for _ = 1, 3 do
			local p = Instance.new("Part")
			p.Anchored, p.CanCollide, p.CanQuery, p.CanTouch, p.CastShadow = true, false, false, false, false
			p.Transparency = 1
			p.Shape = Enum.PartType.Cylinder
			p.Size = Vector3.new(2, 20, 20)
			p.Parent = folder
			local em = Instance.new("ParticleEmitter")
			em.Texture = C.TEXTURES.wispyFlat
			em.LightInfluence = 0
			em.LightEmission = 0
			em.Shape = Enum.ParticleEmitterShape.Cylinder
			em.ShapeStyle = Enum.ParticleEmitterShapeStyle.Surface
			em.ShapeInOut = Enum.ParticleEmitterShapeInOut.Outward
			em.Speed = NumberRange.new(1, 4)
			em.Lifetime = NumberRange.new(2, 3.5)
			em.Rate = 0
			em.LockedToPart = true
			em.Rotation = NumberRange.new(0, 360)
			em.RotSpeed = NumberRange.new(-15, 15)
			em.Transparency = NumberSequence.new({ NumberSequenceKeypoint.new(0, 1), NumberSequenceKeypoint.new(0.25, 0.55), NumberSequenceKeypoint.new(1, 1) })
			em.Parent = p
			table.insert(c.wisps, { part = p, em = em })
		end
		return c
	end

	local function releaseMeshes(c: any)
		if c.core then
			TubeMesh.park(c.core)
			TubeMesh.park(c.veil)
			if c.subs then
				TubeMesh.park(c.subs)
			end
			c.core, c.veil, c.subs = nil, nil, nil
			self.meshSets -= 1
		end
	end

	local function destroyController(c: any)
		releaseMeshes(c)
		for _, list in { c.sprites, c.far } do
			for _, s in list do
				s.att:Destroy()
				s.bb:Destroy()
			end
		end
		for _, l in c.labels do
			l.att:Destroy()
			l.bb:Destroy()
		end
		for _, l in c.subLabels do
			l.att:Destroy()
			l.bb:Destroy()
		end
		for _, w in c.wisps do
			w.part:Destroy()
		end
	end

	-- A mesh vertex colour. The shells are self-lit (Neon) day and night: their normals all point
	-- up, so a lit material (SmoothPlastic) mirrored the bright sky over the whole funnel and hid
	-- it; Neon has no reflection, and the light is the scene's (Tornado/SceneLight: the sun through
	-- the storm, sky light, night, a nearby flash). Neon shows a colour brighter than it is, so the
	-- computed light is compensated (a measured-by-eye curve).
	local function meshShade(L: any, albedo: number, facing: number): Color3
		local c = SceneLight.shade(L, albedo, facing)
		return Color3.new(c.R ^ 1.6 * 0.85, c.G ^ 1.6 * 0.85, c.B ^ 1.6 * 0.85)
	end

	-- per-frame scratch
	local ringZ, ringR, ringCX, ringCY, ringC, ringB, ringW, ringFade = {}, {}, {}, {}, {}, {}, {}, {}
	local ringRC = {}
	local colTh, colCos, colSin, colFres, colLit, colShadow, colFinal, colVeil, colMoist, colEdgeV, colLobe =
		{}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}
	local subCol, subFres, subCos, subSin = {}, {}, {}, {}
	-- cloud extinction (1/m): ~0.5 g/m^3 of 10 um droplets, 3 LWC / (2 rho_w r_eff); a condensed
	-- tube 10 m across is already mostly opaque
	local BETA = 0.075

	-- Draw one tornado's shells (and tubes). Returns stats.
	local function drawShells(c: any, e: any, L: any, camPos: Vector3, lod: number, dbg: any)
		local p = e.params
		local H = max(100, e.cloudBase)
		local top = H * 1.07 + 30
		local R = max(8, e.R)
		local wts = e.weights
		local bendK = Profiles.character(wts, "bend")
		local rough = Profiles.character(wts, "rough")
		local time = e.time
		-- the moist (inflow) side: where the storm-relative low-level air comes from
		local ru, rv = (e.envU or 0) - (e.ut or 0), (e.envV or 0) - (e.vt or 0)
		local moistA = atan2(-rv, -ru)
		local omega = e.vc / max(20, e.rc)
		-- rings
		for i = 1, NR do
			local u = (i - 1) / (NR - 1)
			-- denser low and at the top (where the eye reads shape)
			local h = u + 0.12 * sin(TAU * u) / TAU * -1
			local z = h * top
			ringZ[i] = z
			local hn = min(z / H, 1)
			local r0 = R * Profiles.radius(wts, hn)
			-- the condensed share of this height's envelope
			local rcond = Vortex.condensationRadius(e, min(z, H * 0.995))
			local Ci = clamp(rcond / max(1, r0), 0, 1)
			if z >= H * 0.95 then
				Ci = 1 -- inside the cloud base
				rcond = r0
			end
			ringC[i] = Ci
			-- the visible funnel is the condensed tube: its radius (capped by the profile envelope)
			ringRC[i] = min(rcond, r0)
			-- breakup where condensation is marginal (only the very core condenses: near the tip)
			local rcz = Vortex.rcAt(p, min(z, H))
			ringB[i] = 0.06 + 0.8 * (1 - clamp(rcond / max(1, 0.6 * rcz), 0, 1))
			-- centreline: the physical axis + a coherent, profile-dependent wander
			local ax, ay = Vortex.axisAt(e, min(z, H))
			local env = sin(math.pi * min(hn, 1))
			local wx = bendK * R * 0.9 * env * Noise.value1(hn * 1.6 + time / 37, e.seed + 51)
			local wy = bendK * R * 0.9 * env * Noise.value1(hn * 1.6 + time / 41, e.seed + 53)
			ringCX[i], ringCY[i] = e.x + ax + wx, e.y + ay + wy
			ringR[i] = r0
			-- angular speed of the flow at this radius (the surface pattern turns with it)
			local Rn = r0 / max(5, Vortex.rcAt(p, min(z, H)))
			ringW[i] = min(omega * Vortex.profile(max(Rn, 0.05)) / max(Rn, 0.05), 2.5)
			ringFade[i] = (1 - smooth(H * 0.96, top, z) * 0.85) * smooth(0, 0.02, u + 0.02)
		end
		-- far draw
		local midW = C.toWorld(e.x, e.y, top * 0.5)
		local toMid = midW - camPos
		local dW = toMid.Magnitude
		local k = if dW > C.LIMITS.farDraw then C.LIMITS.farDraw / dW else 1
		local originW = camPos + toMid * k
		local viewDir = toMid.Unit
		local sun = L.sunDir
		local backlit = max(0, viewDir:Dot(sun)) * (1 - L.night)
		local trans = e.trans or 1
		local wrapF = clamp(((e.wrap or 0) - 5) / 35, 0, 1)
		local life = e.fade
		local quality = ctx.state.quality or 1
		local rainCol = meshShade(L, 0.62, 0.25)
		local dustCol = Color3.new(0.5, 0.43, 0.35)
		local dustTop = max(30, (e.debrisTop or 0) * 0.35)
		local hazeCol = meshShade(L, 0.75, 0)
		local hazeF = 0.8 * (1 - exp(-dW / 50000)) - 0.8 * (1 - exp(-dW * k / 50000))
		local geomOnly, condViz = dbg.geometryOnly, dbg.condensation
		local subs = Vortex.subvortices(p, 20)
		local core, veil = c.core, c.veil
		local nc = NS + 1
		local seedPh = (e.seed % 97) * 0.37
		local condSum = 0
		-- per-column work (depends only on the azimuth), once per frame: direction, view angle,
		-- light, the sub-vortex lobes, and the rain + distance haze tint (a linear mix, so it can
		-- be applied before the per-ring dust where there is no dust)
		local rainK = (1 - trans) * 0.85
		local function finish(col: Color3): Color3
			col = mixC(col, rainCol, rainK)
			if hazeF > 0.01 then
				col = mixC(col, hazeCol, hazeF)
			end
			return col
		end
		local vdx, vdz = viewDir.X, viewDir.Z
		local sx, sz = sun.X, sun.Z
		local glowK = 0.45 * backlit * L.sun
		local hasSubs = #subs > 0
		local subA = {}
		if hasSubs then
			for q, sv in subs do
				subA[q] = atan2(sv[2], sv[1])
			end
		end
		for j = 1, nc do
			local th = (j - 1) / NS * TAU
			local nxv, nyv = cos(th), sin(th)
			local fres = 1 - abs(nxv * vdx - nyv * vdz)
			local facing = (nxv * sx - nyv * sz) * 0.85 + 0.15
			local col = meshShade(L, 0.78 - 0.12 * (1 - fres) * backlit, facing)
			local glow = glowK * fres * fres
			if glow > 0 then
				col = Color3.new(min(1, col.R + glow), min(1, col.G + glow * 0.97), min(1, col.B + glow * 0.92))
			end
			colTh[j], colCos[j], colSin[j], colFres[j] = th, nxv, nyv, fres
			colLit[j] = col
			colShadow[j] = meshShade(L, 0.5, facing)
			colFinal[j] = finish(col)
			colVeil[j] = mixC(colFinal[j], rainCol, wrapF)
			colMoist[j] = cos(th - moistA)
			colEdgeV[j] = 1 - smooth(0.4, 0.95, fres)
			local lobe = 0
			if hasSubs then
				for q, sv in subs do
					local d = abs(((th - subA[q] + math.pi) % TAU) - math.pi)
					lobe += sv[3] * exp(-(d / 0.35) ^ 2)
				end
			end
			colLobe[j] = lobe
		end
		local midX, midY, midZ = e.x, e.y, top * 0.5
		local coreA = life * (0.6 + 0.4 * trans)
		local uvTop = max(100, top)
		for i = 1, NR do
			local z, r0, Ci, Bi = ringZ[i], ringR[i], ringC[i], ringB[i]
			local hn = min(z / H, 1)
			local ph = ringW[i] * time
			local rise = time * (4 + 0.1 * e.vc)
			local zz = (z - rise) / max(30, 2.5 * r0)
			local cxr, cyr = ringCX[i], ringCY[i]
			local dust = (e.debrisLoft or 0) * (1 - smooth(0, dustTop, z))
			condSum += Ci
			-- per-ring constants
			local dusty = dust > 0.02
			local lobeK = if hasSubs and hn < 0.5 then 0.2 * (1 - hn / 0.5) else 0
			local rT = ringRC[i]
			local rTd = max(0.5, rT)
			local tauK = 2 * BETA * rT
			local fadeA = ringFade[i] * coreA
			local fadeV = ringFade[i] * life
			local rvK = r0 * (1.18 + 1.6 * wrapF)
			local aRainK = 0.55 * wrapF * (1 - smooth(H * 0.85, H, z))
			local veilK = 0.3 * quality * (0.6 + 0.4 * trans)
			local dz = z - midZ
			local uvC = hn * 3 - rise / uvTop
			local uvV = hn * 2 - rise * (1 + wrapF * 3) / uvTop
			local base = (i - 1) * nc
			local zzA, zzB, zzC, zzD = 0.7 * sin(zz * 0.5 + seedPh) + seedPh, 1.7 * zz + 1.3 * seedPh, -2.3 * zz + 2.1 * seedPh, 2.0 * zz - seedPh
			local zzE, zzF = 3.1 * zz + seedPh, -4.3 * zz
			for j = 1, nc do
				local a = colTh[j] - ph
				-- three coherent scales: broad bulges, uneven condensation, fine breakup
				local n1 = sin(a + zzA)
				local n2 = 0.6 * sin(2 * a + zzB) + 0.4 * sin(3 * a + zzC)
				local n3 = sin(5 * a + zzE) * sin(7 * a + zzF)
				local bump = max(0.25, 1 + rough * (0.6 * n1 + 0.3 * n2 + 0.1 * n3) + lobeK * colLobe[j])
				local nxv, nyv = colCos[j], colSin[j]
				local fres = colFres[j]
				-- condensation broken up where marginal: coherent noise + the moist side
				local Nc = 0.6 * n2 + 0.4 * sin(4 * a + zzD)
				local col, colV = colFinal[j], colVeil[j]
				if dusty then
					local c0 = mixC(colLit[j], colShadow[j], clamp(dust, 0, 0.8))
					c0 = mixC(c0, Color3.new(dustCol.R * c0.R * 2, dustCol.G * c0.G * 2, dustCol.B * c0.B * 2), clamp(dust, 0, 0.6))
					col = finish(c0)
					colV = mixC(col, rainCol, wrapF)
				end
				local idx = base + j
				-- core: the condensed tube, its opacity from the optical depth of the chord the eye
				-- looks through (2 r |n.v|: the silhouette thins), broken where condensation is marginal
				local rc_ = rTd * bump
				local tau = tauK * max(0.05, 1 - fres)
				local breakMask = clamp(1 + Bi * (0.9 * Nc + 0.3 * colMoist[j]) - 0.5 * Bi, 0, 1)
				local aCore = (1 - exp(-tau)) * breakMask * fadeA
				if geomOnly then
					aCore = 0.85 * ringFade[i]
					col = Color3.new(0.55, 0.55, 0.58)
				elseif condViz then
					aCore = 0.85 * ringFade[i]
					col = heat(Ci + Bi * (0.55 * Nc + 0.25 * colMoist[j]))
				end
				-- (mesh-local = world - funnel middle; the part's size carries the far-draw scale)
				core.pos[idx] = Vector3.new(cxr + nxv * rc_ - midX, dz, midY - cyr - nyv * rc_)
				core.col[idx] = col
				core.alpha[idx] = clamp(aCore, 0, 1)
				core.uv[idx] = Vector2.new((j - 1) / NS * 3 - ph / TAU, uvC)
				-- veil: looser and wider; becomes the rain curtain where rain wraps the vortex
				local Cv = Ci + Bi * (0.55 * Nc + 0.25 * colMoist[j])
				local rv_ = rvK * (1 + rough * 1.5 * (0.5 * n1 + 0.5 * n2))
				local aVeil = veilK * smooth(0.12, 0.5, Cv + 0.1) * (0.55 + 0.45 * Nc)
				local aRain = aRainK * (0.6 + 0.4 * n2)
				local aV = max(aVeil, aRain) * colEdgeV[j] * fadeV
				if geomOnly or condViz then
					aV = 0
				end
				veil.pos[idx] = Vector3.new(cxr + nxv * rv_ - midX, dz, midY - cyr - nyv * rv_)
				veil.col[idx] = colV
				veil.alpha[idx] = clamp(aV, 0, 1)
				veil.uv[idx] = Vector2.new((j - 1) / NS * 2 - ph * 0.6 / TAU, uvV)
			end
		end
		-- (debug readout: a few rings' condensed share and the core alpha on their first column)
		local rows = {}
		for _, i in { 1, 10, 20, 30, 40 } do
			table.insert(rows, string.format("z%.0f C%.2f a%.2f", ringZ[i], ringC[i], core.alpha[(i - 1) * nc + 1]))
		end
		c.dbgRows = table.concat(rows, " ")
		TubeMesh.write(core)
		TubeMesh.write(veil)
		local size = core.size * k
		core.part.Size, veil.part.Size = size, size
		core.part.CFrame, veil.part.CFrame = CFrame.new(originW), CFrame.new(originW)

		-- sub-vortex tubes
		local subsMesh = c.subs
		if subsMesh then
			local per = subsMesh.per
			local snc = SS + 1
			local active = {}
			for t = 1, NSUB do
				active[t] = false
			end
			local zTop = H * 0.92
			-- per-column light (azimuth only), once per frame
			local subTint = (1 - trans) * 0.85
			for js = 1, snc do
				local th = (js - 1) / SS * TAU
				local nxv, nyv = cos(th), sin(th)
				subCos[js], subSin[js] = nxv, nyv
				subFres[js] = 1 - abs(nxv * viewDir.X - nyv * viewDir.Z)
				subCol[js] = mixC(meshShade(L, 0.74, (nxv * sun.X - nyv * sun.Z) * 0.85 + 0.15), rainCol, subTint)
			end
			local subA = life * (0.6 + 0.4 * trans)
			for jr = 1, SR do
				local z = zTop * ((jr - 1) / (SR - 1)) ^ 1.2
				local list = Vortex.subvortices(p, z)
				local ax, ay = Vortex.axisAt(e, z)
				local rcz = Vortex.rcAt(p, z)
				local surf = 1 -- (pressure deficits reach the ground: see Vortex.deficit)
				local need = RHO * G * max(1, H - z)
				for _, sv in list do
					local id = sv[4] or 1
					if id >= 1 and id <= NSUB then
						active[id] = true
						local w = sv[3]
						-- the sub-vortex's own deficit plus the parent's at its orbit radius
						local vs = 0.45 * e.vc * w * surf
						local dp = RHO * vs * vs * Vortex.CENTRAL_DEFICIT + RHO * (e.vc * surf) ^ 2 * Vortex.deficitIntegral(0.95)
						local Cs = clamp((dp / need - 0.85) / 0.35, 0, 1) * smooth(0, 0.25, w)
						local rt = 0.12 * rcz * 1.35 * (0.7 + 0.5 * w)
						local cxs, cys = e.x + ax + sv[1], e.y + ay + sv[2]
						local base = (id - 1) * per + (jr - 1) * snc
						local dz = z - midZ
						for js = 1, snc do
							local nxv, nyv = subCos[js], subSin[js]
							local idx = base + js
							subsMesh.pos[idx] = Vector3.new(cxs + nxv * rt - midX, dz, midY - cys - nyv * rt)
							local fres = subFres[js]
							subsMesh.col[idx] = subCol[js]
							local a = Cs * (1 - smooth(0.5, 0.97, fres)) * subA
							if geomOnly or condViz then
								a = if condViz then 0.8 * Cs else 0
							end
							subsMesh.alpha[idx] = clamp(a, 0, 1)
							subsMesh.uv[idx] = Vector2.new((js - 1) / SS, z / max(100, H) * 2 - time * 0.4)
						end
					end
				end
			end
			-- tubes with no sub-vortex now: invisible
			for t = 1, NSUB do
				if not active[t] then
					local base = (t - 1) * per
					for q = 1, per do
						subsMesh.alpha[base + q] = 0
					end
				end
			end
			TubeMesh.write(subsMesh)
			subsMesh.part.Size = subsMesh.size * k
			subsMesh.part.CFrame = CFrame.new(originW)
		end
		return condSum / NR, k
	end

	-- the collar: soft cloud masses round the funnel top, merging it into the lowering
	local function drawCollar(c: any, e: any, L: any, camPos: Vector3, show: boolean)
		local H = max(100, e.cloudBase)
		local rTop = max(20, e.R * Profiles.radius(e.weights, 1))
		local ax, ay = Vortex.axisAt(e, H)
		local cx, cy = e.x + ax, e.y + ay
		local col = SceneLight.shade(L, 0.5, 0.15)
		local turn = (e.vc / max(20, e.rc)) * 0.06 * e.time
		for n, s in c.sprites do
			if not show then
				s.bb.Enabled = false
				continue
			end
			local h1 = Noise.hash(n, 1, 3, e.seed)
			local h2 = Noise.hash(n, 2, 3, e.seed)
			local a = (n / #c.sprites) * TAU + turn * (0.7 + 0.6 * h1)
			local rr = rTop * (0.6 + 1.1 * h2)
			local z = H * (0.96 + 0.06 * h1)
			local P = C.toWorld(cx + cos(a) * rr, cy + sin(a) * rr, z)
			local rel = P - camPos
			local d = rel.Magnitude
			local k = if d > C.LIMITS.farDraw then C.LIMITS.farDraw / d else 1
			s.att.WorldPosition = camPos + rel * k
			local size = rTop * (1.1 + 0.9 * h1) * k
			s.bb.Size = UDim2.fromScale(size * 1.6, size)
			s.img.ImageColor3 = mixC(col, SceneLight.shade(L, 0.62, 0.1), (1 - (e.trans or 1)) * 0.8)
			s.img.ImageTransparency = 1 - clamp(0.7 * e.fade, 0, 0.85)
			s.img.Rotation = h2 * 360
			s.bb.Enabled = true
		end
	end

	-- the far silhouette: sprites up the axis, as condensed as the field says
	local function drawFar(c: any, e: any, L: any, camPos: Vector3, show: boolean)
		local H = max(100, e.cloudBase)
		for n, s in c.far do
			if not show then
				s.bb.Enabled = false
				continue
			end
			local hn = (n - 0.5) / #c.far
			local z = hn * H
			local r0 = e.R * Profiles.radius(e.weights, hn)
			local rcond = Vortex.condensationRadius(e, min(z, H * 0.995))
			local Ci = clamp(rcond / max(1, r0), 0, 1)
			local ax, ay = Vortex.axisAt(e, z)
			local P = C.toWorld(e.x + ax, e.y + ay, z)
			local rel = P - camPos
			local d = rel.Magnitude
			local k = if d > C.LIMITS.farDraw then C.LIMITS.farDraw / d else 1
			s.att.WorldPosition = camPos + rel * k
			s.bb.Size = UDim2.fromScale(2.2 * r0 * k, H / #c.far * 1.9 * k)
			s.img.ImageColor3 = mixC(SceneLight.shade(L, 0.72, 0.4), SceneLight.shade(L, 0.62, 0.25), 1 - (e.trans or 1))
			s.img.ImageTransparency = 1 - clamp(0.8 * smooth(0.25, 0.7, Ci) * e.fade * (0.6 + 0.4 * (e.trans or 1)), 0, 0.9)
			s.bb.Enabled = true
		end
	end

	-- condensation fragments shed where the funnel is partly condensed (close range only)
	local function drawWisps(c: any, e: any, L: any, show: boolean, dt: number)
		if not show or #ringB < NR then
			for _, w in c.wisps do
				w.em.Rate = 0
			end
			return
		end
		local H = max(100, e.cloudBase)
		-- the heights with the most breakup
		local picks = {}
		for i = 2, NR - 2, 3 do
			table.insert(picks, { ringB[i] * ringFade[i], i })
		end
		table.sort(picks, function(a, b)
			return a[1] > b[1]
		end)
		local wispK = Profiles.character(e.weights, "wisps") * (ctx.state.quality or 1)
		for n, w in c.wisps do
			local pick = picks[n]
			if not show or not pick or pick[1] < 0.15 then
				w.em.Rate = 0
				continue
			end
			local i = pick[2]
			local r = ringR[i]
			w.part.Size = Vector3.new(4, 2 * r * 1.05, 2 * r * 1.05)
			w.spin = (w.spin or 0) + ringW[i] * dt * (if ctx.state.paused then 0 else ctx.state.timeScale)
			w.part.CFrame = CFrame.new(C.toWorld(ringCX[i], ringCY[i], ringZ[i])) * CFrame.Angles(0, w.spin, 0) * CFrame.Angles(0, 0, math.pi / 2)
			local col = SceneLight.shade(L, 0.76, 0.5)
			w.em.Color = ColorSequence.new(col)
			w.em.Size = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0.3 * r), NumberSequenceKeypoint.new(1, 0.7 * r) })
			w.em.Rate = clamp(pick[1] * 6 * wispK * e.fade * (e.trans or 1), 0, 6)
			local _ = H
		end
	end

	local function hideController(c: any)
		if c.core then
			TubeMesh.clear(c.core)
			TubeMesh.clear(c.veil)
			if c.subs then
				TubeMesh.clear(c.subs)
			end
		end
		for _, list in { c.sprites, c.far } do
			for _, s in list do
				s.bb.Enabled = false
			end
		end
		for _, w in c.wisps do
			w.em.Rate = 0
		end
		for _, l in c.labels do
			l.bb.Enabled = false
		end
		for _, l in c.subLabels do
			l.bb.Enabled = false
		end
	end

	function self:update(dt: number)
		self.frame += 1
		local t0 = os.clock()
		adapter:update(dt)
		-- (the mesh draws when the funnel style is "mesh", or as A in the comparison; the default style
		-- "cards" is Render/TornadoCards. Hidden in the comparison's B/C/D-only modes.)
		local meshStyle = (ctx.state.funnelStyle or "cards") == "mesh" or (ctx.state.compare or "off") ~= "off"
		local show = ctx.state.show.funnel ~= false and meshStyle and not ctx.state.hideFunnelA
		local dbg = ctx.state.debug or {}
		local camPos = ctx.camera.CFrame.Position
		local camX, camY, camZ = ctx:simCamera()
		dbgFlush()
		-- controllers follow the adapter's entries
		for id, e in adapter.entries do
			if not self.controllers[id] then
				self.controllers[id] = newController(e)
			end
		end
		for id, c in self.controllers do
			if not adapter.entries[id] then
				destroyController(c)
				self.controllers[id] = nil
			end
		end
		-- LOD: distance to the funnel's middle, worse when obscured; mesh sets to the nearest
		local order = {}
		for id, e in adapter.entries do
			local H = max(100, e.cloudBase)
			local d = sqrt((e.x - camX) ^ 2 + (e.y - camY) ^ 2 + (H * 0.5 - camZ) ^ 2)
			local lod = if d < LOD0 then 0 elseif d < LOD1 then 1 elseif d < LOD2 then 2 else 3
			-- (heavy rain drops a level only past 3 km: near a rain-wrapped funnel the veil is the look)
			if (e.trans or 1) < 0.25 and lod >= 1 and lod < 3 and d > 3000 then
				lod += 1
			end
			if not show then
				lod = 4
			end
			table.insert(order, { id = id, d = d, lod = lod })
		end
		table.sort(order, function(a, b)
			return a.d < b.d
		end)
		local counts = { 0, 0, 0, 0, 0 }
		local meshAllowed = MAX_MESH_SETS
		for _, o in order do
			local c, e = self.controllers[o.id], adapter.entries[o.id]
			local lod = o.lod
			if lod <= 1 then
				-- meshes are built in the background (building a mesh part yields: an update must
				-- never see a half-built set); until then the sprite silhouette stands in
				if not c.core and not c.building and not c.meshFailed and self.meshSets + (self.building or 0) < meshAllowed then
					c.building = true
					self.building = (self.building or 0) + 1
					task.spawn(function()
						local core = TubeMesh.get(folder, "FunnelCore", 1, NR, NS, texture)
						local veil = core and TubeMesh.get(folder, "FunnelVeil", 1, NR, NS, texture)
						local subs = veil and TubeMesh.get(folder, "SubVortices", NSUB, SR, SS, texture)
						if core and veil and self.controllers[c.id] == c then
							c.core, c.veil, c.subs = core, veil, subs
							self.meshSets += 1
						else
							for _, m in { core, veil, subs } do
								if m then
									TubeMesh.park(m)
								end
							end
							if not (core and veil) then
								c.meshFailed = true -- (stays on the sprite silhouette)
							end
						end
						c.building = false
						self.building -= 1
					end)
				end
				if not (c.core and c.veil) then
					lod = 2 -- (being built, over the mesh budget, or meshes unavailable)
				end
			end
			if lod >= 2 and c.core then
				TubeMesh.clear(c.core)
				TubeMesh.clear(c.veil)
				if c.subs then
					TubeMesh.clear(c.subs)
				end
				releaseMeshes(c)
			end
			c.lod = lod
			counts[lod + 1] += 1
			if lod >= 3 then
				hideController(c)
				continue
			end
			local L = SceneLight.sample(ctx, e.x, e.y, max(100, e.cloudBase) * 0.5)
			e.light = L
			local every = if lod == 0 then 1 elseif lod == 1 then 2 else 4
			if (self.frame + c.phase) % every == 0 then
				local condMean = 0
				if lod <= 1 then
					condMean = drawShells(c, e, L, camPos, lod, dbg)
					drawWisps(c, e, L, lod == 0 and not dbg.geometryOnly and not dbg.condensation, dt * every)
				else
					drawWisps(c, e, L, false, dt)
				end
				drawFar(c, e, L, camPos, lod == 2)
				drawCollar(c, e, L, camPos, not dbg.geometryOnly and not dbg.condensation)
				c.condMean = condMean
			end
			-- debug overlays
			local H = max(100, e.cloudBase)
			if dbg.centerline then
				for i = 1, NR, 2 do
					dbgPart(Color3.fromRGB(255, 220, 60), Vector3.new(3, 3, 3), CFrame.new(C.toWorld(ringCX[i], ringCY[i], ringZ[i])))
				end
				-- the dominant family's control points (radius markers)
				local best, bw = "cone", -1
				for name, w in e.weights do
					if w > bw then
						best, bw = name, w
					end
				end
				for _, pt in Profiles.PROFILES[best] do
					local z = pt[1] * H
					local ax, ay = Vortex.axisAt(e, z)
					dbgPart(Color3.fromRGB(255, 80, 200), Vector3.new(2 * e.R * pt[2], 1.5, 1.5), CFrame.new(C.toWorld(e.x + ax, e.y + ay, z)))
				end
			end
			if dbg.groundRadius then
				for a = 0, 35 do
					local ang = a / 36 * TAU
					for _, rr in { e.R * Profiles.radius(e.weights, 0), 3.5 * e.rc } do
						dbgPart(Color3.fromRGB(120, 200, 255), Vector3.new(2, 1, 2), CFrame.new(C.toWorld(e.x + cos(ang) * rr, e.y + sin(ang) * rr, 1)))
					end
				end
			end
			local subs = Vortex.subvortices(e.params, 5)
			for n, l in c.subLabels do
				local sv = subs[n]
				if dbg.subvortices and sv then
					local ax, ay = Vortex.axisAt(e, 5)
					local x, y = e.x + ax + sv[1], e.y + ay + sv[2]
					l.att.WorldPosition = C.toWorld(x, y, 25)
					l.tl.Text = string.format("sv%d  w %.2f", sv[4] or n, sv[3])
					l.bb.Size = UDim2.fromOffset(90, 22)
					l.bb.Enabled = true
					c.trail[sv[4] or n] = c.trail[sv[4] or n] or {}
					local tr = c.trail[sv[4] or n]
					table.insert(tr, { sv[1], sv[2] })
					if #tr > 60 then
						table.remove(tr, 1)
					end
					for _, q in tr do
						dbgPart(Color3.fromRGB(255, 140, 60), Vector3.new(2, 2, 2), CFrame.new(C.toWorld(e.x + ax + q[1], e.y + ay + q[2], 3)))
					end
				else
					l.bb.Enabled = false
				end
			end
			if dbg.lod then
				local l = c.labels.lod
				l.att.WorldPosition = C.toWorld(e.x, e.y, H * 1.15)
				l.tl.Text = string.format("%s LOD%d  d %.1f km\ncond %.2f  trans %.2f  wrap %.0f mm/h\nrope %.2f cone %.2f stove %.2f wedge %.2f",
					e.id, lod, o.d / 1000, c.condMean or 0, e.trans or 1, e.wrap or 0, e.weights.rope or 0, e.weights.cone or 0, e.weights.stovepipe or 0, e.weights.wedge or 0)
					.. string.format("\nR %.0f m  rc %.0f m  fade %.2f\n", e.R or 0, e.rc or 0, e.fade or -1) .. (c.dbgRows or "")
				l.bb.Size = UDim2.fromOffset(520, 110)
				l.bb.Enabled = true
			else
				c.labels.lod.bb.Enabled = false
			end
			if dbg.physics then
				-- the separation check: the physical wind at 10 m next to the core vs what is visible
				local u, v = ctx.cw:windAt(e.x + e.rc, e.y, 10)
				local l = c.labels.phys
				l.att.WorldPosition = C.toWorld(e.x, e.y, 15)
				l.tl.Text = string.format("wind 10 m: %.0f m/s (%s)\nvisible condensation: %.2f",
					sqrt(u * u + v * v), if (e.ef or -1) >= 0 then "EF" .. e.ef else "below EF0", c.condMean or 0)
				l.bb.Size = UDim2.fromOffset(240, 40)
				l.bb.Enabled = true
			else
				c.labels.phys.bb.Enabled = false
			end
		end
		-- lightning debug: where the flashes are and how far their light reaches
		if dbg.flashes and ctx.flashField then
			for _, fl in ctx.flashField.flashes do
				local P = C.toWorld(fl.x, fl.y, fl.z)
				local rel = P - camPos
				local d = rel.Magnitude
				local k = if d > C.LIMITS.farDraw then C.LIMITS.farDraw / d else 1
				local s = math.min(2000, fl.radius * 0.15 * k * (0.3 + (fl.now or 0)))
				dbgPart(Color3.fromRGB(200, 200, 255), Vector3.new(s, s, s), CFrame.new(camPos + rel * k))
			end
		end
		local ms = (os.clock() - t0) * 1000
		self.ms = (self.ms or ms) * 0.9 + ms * 0.1
		if self.frame % 15 == 0 then
			ctx.root:SetAttribute("TornadoVisuals", string.format("LOD0 %d · LOD1 %d · LOD2 %d · hidden %d · meshes %d · %.2f ms",
				counts[1], counts[2], counts[3], counts[4] + counts[5], self.meshSets, self.ms))
			ctx.root:SetAttribute("TornadoVisualMs", math.floor(self.ms * 100) / 100)
		end
		local _ = Lighting
		local __ = Workspace
	end

	function self:destroy()
		for _, c in self.controllers do
			destroyController(c)
		end
		folder:Destroy()
		dbgFolder:Destroy()
	end

	ctx.tornadoAdapter = adapter
	return self
end

return TV
