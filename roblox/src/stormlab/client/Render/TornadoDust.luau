--!nonstrict
--!native
-- Dust and the debris cloud (guide sections 3 and 4): soft dust puffs raised from the ground
-- wherever the simulated surface wind beats the pickup threshold, then carried by that same wind
-- (ClientWorld.windAt: vortex, inflow, RFD and gust-front outflow), with turbulent lift.
--   pickup   U(2 m) > U* = 8 m/s x (1 + 2.5 wetness) (wet ground from the rain field holds its
--            dust), rate ~ (U / U* - 1) x loose soil; under a tornado it is fierce near the core,
--            under a strong low-level circulation or an RFD / gust-front surge it is a thin
--            ground whirl or a dust front; inside rain it is nothing
--   motion   a puff's velocity relaxes to the air's (dust follows the air closely), plus a
--            turbulent lift ~0.25 |U| that keeps the column fed, minus a slow settling
--   look     one flat colour per tornado (no draw-order flicker), from the ground (soil brown)
--            darkening with lofted wreckage; puffs grow and thin as they rise and spread
-- So the debris cloud's width, height and density come out of the wind field, and a funnel that
-- doesn't reach the ground still shows its circulation in the dust.
-- Units: metres; a puff's z is its height above the local ground (C.groundAt), drawn through
-- C.toWorldGround; billboard sizes cross to studs (docs/stormlab/SCALE-RULES.md). A tornado's dust
-- is drawn with the tornado, about its ground point at its scale (LabConfig.scaleAbout /
-- toWorldAbout); dust from outflow and dust fronts about its own place.
local Workspace = game:GetService("Workspace")

local TornadoDust = {}

local MAX_PUFFS = 280
-- The air the puffs ride: the storm's own (environment, cold pool, storm winds - smooth over
-- hundreds of metres) from a 100 m grid kept for BG_S, plus each tornado's vortex exactly at the
-- puff. Every near puff ran the full World.windAt each frame (~200 calls a frame, 2026-11-07)
local BG_CELL, BG_S = 100, 0.2
local bgCache: { [number]: { number } } = {}
local bgAt, bgWorld = -1, nil
local function bgBand(z: number): (number, number)
	if z < 30 then return 0, 10 end
	if z < 100 then return 1, 60 end
	if z < 300 then return 2, 200 end
	local b = math.floor(z / 500)
	return 3 + b, 500 * b + 250
end
local function windNear(cw: any, Vortex: any, x: number, y: number, z: number): (number, number, number)
	local now = os.clock()
	if now - bgAt > BG_S or bgWorld ~= cw then
		table.clear(bgCache)
		bgAt, bgWorld = now, cw
	end
	local i, j = math.floor(x / BG_CELL), math.floor(y / BG_CELL)
	local kb, zc = bgBand(z)
	local key = ((i + 1e5) * 2e5 + (j + 1e5)) * 64 + kb
	local c = bgCache[key]
	if not c then
		local bu, bv, bw = cw:windAt((i + 0.5) * BG_CELL, (j + 0.5) * BG_CELL, zc, true)
		c = { bu, bv, bw }
		bgCache[key] = c
	end
	local bu, bv = c[1], c[2]
	local u, v, w = bu, bv, c[3]
	-- (trapped debris: a vortex is carried by the air round it, and in the stream past it - the
	-- ambient wind less its own motion - the fluid within its closed streamlines (the Rankine
	-- oval, where the swirl beats that stream) goes with it; only outside does the stream carry
	-- dust past. Taking the whole ambient wind, a 193 mph wedge's skirt sat ~50 m off its foot -
	-- displaced, user 2026-11-08. The blend runs on the swirl against the relative stream, so the
	-- oval's edge is soft)
	local kMax, ux, uy = 0, 0, 0
	for _, t in cw.tornadoes do
		if not t.ended and t.params then
			local dx, dy = x - t.x, y - t.y
			if dx * dx + dy * dy < (60 * t.rc + 1500) ^ 2 then
				local tu, tv, tw = Vortex.sample(t.params, x, y, z)
				u += tu
				v += tv
				w += tw
				-- (only where its own motion is known: client/FrameWorld publishes it)
				local rx, ry = bu - (t.u or 0), bv - (t.v or 0)
				local ur = math.sqrt(rx * rx + ry * ry)
				if t.u ~= nil and ur > 0.1 then
					local q = math.sqrt(tu * tu + tv * tv) / ur
					local k = math.clamp((q - 0.7) / 0.7, 0, 1)
					k = k * k * (3 - 2 * k)
					if k > kMax then
						kMax, ux, uy = k, rx, ry
					end
				end
			end
		end
	end
	return u - kMax * ux, v - kMax * uy, w
end
local DUST_TAU = 0.15 -- s: how fast a puff's velocity takes the air's (see the motion step)
local sqrt, exp = math.sqrt, math.exp
-- the dice: math.random, or in the game while a tornado's pickup runs, a generator seeded by the
-- tornado and a tick of the shared clock - every client lifts the same dust (same storm every
-- server, 2026-11-07)
local rng: Random? = nil
local function random(lo: number?, hi: number?): number
	local g = rng
	if not g then
		return if lo then math.random(lo, hi :: number) else math.random()
	end
	return if lo then g:NextInteger(lo, hi :: number) else g:NextNumber()
end
local PICKUP_HZ = 20 -- (the game's pickup ticks a second)
local function idSeed(id: any): number
	local h = 5381
	local str = tostring(id)
	for i = 1, #str do
		h = (h * 33 + string.byte(str, i)) % 2147483647
	end
	return h
end
local function smooth(a: number, b: number, x: number): number
	local t = math.clamp((x - a) / (b - a), 0, 1)
	return t * t * (3 - 2 * t)
end
local MARGIN = 0.1 -- rad beyond the view's half-diagonal before a puff counts as off screen
local CULL_REFRESH = 8 -- an off-screen puff's position is still moved every 8th frame (staggered)
-- the ground fade's transparency down a card (0 = top): opaque to t1 - w, clear from t1.
-- Shared sequences, t1 and the width w in 1/64ths (key, wkey); NO_KEY: no fade. The width is
-- FADE_W looking down, narrower toward a level view (2026-10-31: there the ground line is the
-- dust's real foot, and a fixed 0.22 of a big skirt puff lifted its foot off the ground)
local FADE_W = 0.22
local NO_KEY = 1e6
local NO_FADE = NumberSequence.new(0)
local fadeSeqs: { [number]: NumberSequence } = {}
local function fadeSeq(key: number, wkey: number): NumberSequence
	if key == NO_KEY then
		return NO_FADE
	end
	local ck = (key + 128) * 256 + wkey
	local seq = fadeSeqs[ck]
	if seq then
		return seq
	end
	local W = math.max(wkey, 1) / 64
	local t1 = key / 64
	local t0 = t1 - W
	local function tr(t: number): number
		return math.clamp((t - t0) / W, 0, 1)
	end
	local kps = { NumberSequenceKeypoint.new(0, tr(0)) }
	for _, t in { t0, t1 } do
		if t > 0.002 and t < 0.998 then
			table.insert(kps, NumberSequenceKeypoint.new(t, tr(t)))
		end
	end
	table.insert(kps, NumberSequenceKeypoint.new(1, tr(1)))
	seq = NumberSequence.new(kps)
	fadeSeqs[ck] = seq
	return seq
end

function TornadoDust.new(ctx: any): any
	local C = ctx.Config
	local self = { ctx = ctx, puffs = {}, free = {}, frame = 0 }
	local anchor = Instance.new("Part")
	anchor.Name = "DustAnchor"
	anchor.Anchored, anchor.CanCollide, anchor.CanQuery, anchor.CanTouch = true, false, false, false
	anchor.Transparency = 1
	anchor.Size = Vector3.one
	anchor.CFrame = CFrame.new()
	anchor.Parent = ctx.root
	for i = 1, MAX_PUFFS do
		local att = Instance.new("Attachment")
		att.Parent = anchor
		local bb = Instance.new("BillboardGui")
		bb.Adornee = att
		bb.LightInfluence = 0 -- (lit by Tornado/SceneLight: dark at night, lit locally by flashes)
		bb.Size = UDim2.fromScale(10, 10)
		bb.Enabled = false
		bb.ResetOnSpawn = false
		local img = Instance.new("ImageLabel")
		img.BackgroundTransparency = 1
		img.Size = UDim2.fromScale(1, 1)
		img.Image = C.TEXTURES.softFlat
		img.ImageTransparency = 1
		img.Rotation = random() * 360
		-- (the ground fade, below: transparency down the card as seen)
		local grad = Instance.new("UIGradient")
		grad.Parent = img
		img.Parent = bb
		bb.Parent = anchor
		local p = { att = att, bb = bb, img = img, grad = grad, alive = false, x = 0, y = 0, z = 0, u = 0, v = 0, w = 0, age = 0, life = 1, size = 4, grow = 1, dens = 1 }
		table.insert(self.puffs, p)
		table.insert(self.free, p)
	end

	-- (tx, ty: the tornado a puff was picked up by - drawn as dirt, grainy, once the dirt sheet
	-- is uploaded; nil: soft dust from outflow and dust fronts)
	-- tornado dust: streaky wisps (fibrous, layering into a sheet); the speckled dirt-grain sheet
	-- drew every puff as a separate ball (2026-10-29). Fallback: the dirt grains, then soft puffs
	local texDirt = if (C.TEXTURES.wispFlat or "") ~= "" then C.TEXTURES.wispFlat
		elseif (C.TEXTURES.dirtGrainFlat or "") ~= "" then C.TEXTURES.dirtGrainFlat
		else nil
	local function spawn(x: number, y: number, z: number, u: number, v: number, w: number, strength: number, colour: Color3, size: number, tx: number?, ty: number?, tid: any?): any
		local p = table.remove(self.free)
		if not p then
			return nil
		end
		p.alive = true
		p.x, p.y, p.z = x, y, z
		p.u, p.v, p.w = u, v, w
		p.age = 0
		p.since = 0
		p.tau = nil -- (fine dust's response time unless the skirt sets its material's)
		p.life = 8 + 14 * random()
		p.size = size
		-- (spreads at the turbulence's speed, a few m/s: grown by a share of its size every
		-- second, a 160 m puff swelled to ~1 km and the skirt hid the tornado, 2026-10-30)
		p.grow = 1.5 + 3 * random()
		p.dens = math.clamp(strength, 0.05, 1)
		p.img.ImageColor3 = colour
		p.col = colour
		p.wp = nil -- (its first position is always written)
		p.base = colour
		p.tx, p.ty, p.tid = tx, ty, tid
		-- (drifting dust: raised by the wind alone, no tornado - a shallow layer blown along the
		-- ground, not a ball)
		p.drift = tx == nil and tid == nil
		p.smooth = nil
		if tx and (C.TEXTURES.smoothPuffFlat or "") ~= "" and random() < 0.7 then
			-- (mostly smooth puffs, 2026-10-31: the Severity debris ball is a dark, soft, lumpy mass;
			-- all fibrous puffs read grainy, as the funnel did. The rest stay fibrous - a little
			-- frayed detail at its fringe)
			p.img.Image = C.TEXTURES.smoothPuffFlat
			p.img.ImageRectSize = Vector2.zero
			p.img.ImageRectOffset = Vector2.zero -- (a sheet frame's offset left on drew a cropped corner: a hard-edged box)
			p.smooth = true
		elseif tx and (C.TEXTURES.wispyFlat or "") ~= "" then
			-- (the debris cloud as the references draw it: fibrous puffs, frayed edges, 2026-10-31.
			-- One frame of the 4x4 sheet each)
			p.img.Image = C.TEXTURES.wispyFlat
			p.img.ImageRectSize = Vector2.new(256, 256)
			local fr = math.floor(random() * 16)
			p.img.ImageRectOffset = Vector2.new((fr % 4) * 256, (fr // 4) * 256)
		elseif tx and (C.TEXTURES.dustWisp2 or "") ~= "" then
			-- (2x2 frames of 512: broad smooth wisps, 2026-10-30)
			p.img.Image = C.TEXTURES.dustWisp2
			p.img.ImageRectSize = Vector2.new(512, 512)
			local fr = math.floor(random() * 4)
			p.img.ImageRectOffset = Vector2.new((fr % 2) * 512, (fr // 2) * 512)
		elseif p.drift and (C.TEXTURES.dustWisp2 or "") ~= "" then
			-- (blowing dust: the broad smooth wisps. The round soft puff, grown to ~100 m and cut at
			-- the ground line, sat on the ground as a pale dome, SC check 2026-11-01)
			p.img.Image = C.TEXTURES.dustWisp2
			p.img.ImageRectSize = Vector2.new(512, 512)
			local fr = math.floor(random() * 4)
			p.img.ImageRectOffset = Vector2.new((fr % 2) * 512, (fr // 2) * 512)
		elseif tx and texDirt then
			p.img.Image = texDirt
			p.img.ImageRectSize = Vector2.new(256, 256)
			local fr = math.floor(random() * 16)
			p.img.ImageRectOffset = Vector2.new((fr % 4) * 256, (fr // 4) * 256)
		else
			p.img.Image = C.TEXTURES.softFlat
			p.img.ImageRectSize = Vector2.zero
			p.img.ImageRectOffset = Vector2.zero
		end
		-- (near level, either way up: the ground fade below runs down the card as seen, so the card
		-- may tilt only a little. Spun anywhere, the streaky wisps also crossed in a jumble)
		local rot = (if random() < 0.5 then 0 else 180) + (random() - 0.5) * 24
		p.img.Rotation = rot
		p.grad.Rotation = 90 - rot
		p.gRot = nil
		p.grad.Transparency = NO_FADE
		p.gkey = nil
		p.zH = nil
		p.collar = nil
		p.capK = nil
		p.tube = nil
		p.tipZ = nil
		p.bb.Enabled = true
		return p
	end

	local function kill(p: any)
		p.alive = false
		p.bb.Enabled = false
		p.img.ImageTransparency = 1
		p.tr = 1
		table.insert(self.free, p)
	end

	-- the ground's dust colour where the tornado is (soil, darkened by wreckage)
	local function dustColour(t: any?): Color3
		-- (darker and greyer, 2026-10-31: the references' debris cloud is a dark grey-brown mass;
		-- 128, 112, 92 read as a pale tan disc)
		local soil = Color3.fromRGB(104, 94, 80)
		if t and (t.debrisLoft or 0) > 0.3 then
			-- (lofted debris greys it, but no darker than a mid grey-brown: toward 70 grey at up to 0.7
			-- it drew charcoal plumes like fire smoke, regrade 2026-11-07)
			soil = soil:Lerp(Color3.fromRGB(88, 84, 78), math.clamp((t.debrisLoft - 0.3) * 1.2, 0, 0.5))
		end
		return soil
	end

	local Precip = ctx.Sim.Precip
	local Vortex = ctx.Sim.Vortex
	local function wetness(x: number, y: number): number
		local rain = Precip.surface(ctx.cw.vol, x, y)
		return math.clamp(rain / 6, 0, 1)
	end

	-- try a pickup at (x, y): returns the strength (0 none)
	local function pickup(x: number, y: number): (number, number, number, number)
		local u, v, w = ctx.cw:windAt(x, y, 2)
		local U = sqrt(u * u + v * v)
		local th = 8 * (1 + 2.5 * wetness(x, y))
		-- debris: past ~25 m/s the wind tears up crops, soil clods and wreckage whether the ground is
		-- wet or not, so a strong tornado over rain-soaked ground still has a debris cloud
		-- (2026-11-07: a 185 mph tornado under the frames' heavy rain had its dust held to ~0.25
		-- strength by the wet threshold, 28 m/s, and its skirt drew nearly see-through)
		local debris = math.clamp((U - 25) / 20, 0, 2)
		if U <= th and debris <= 0 then
			return 0, u, v, w
		end
		return math.max(math.clamp(U / th - 1, 0, 3), debris), u, v, w
	end

	function self:update(dt: number)
		self.frame += 1
		self.dbgOn = Workspace:GetAttribute("EngineStormsDebugCam") == true
		local st = self.dbgStats
		if st and os.clock() - st.at > 5 and self.dbgOn then
			local alive = 0
			for _, p in self.puffs do if p.alive then alive += 1 end end
			print(("[TornadoDust] 5 s: %d tries, %.0f%% lift dust, ground wind %.1f m/s, wet %.2f, at %.2f rc | %d puffs alive"):format(st.n, 100 * st.hit / math.max(st.n, 1), st.U / math.max(st.n, 1), st.wet / math.max(st.n, 1), st.rr / math.max(st.n, 1), alive))
			self.dbgStats = nil
		end
		local show = ctx.state.show.dust
		local cw = ctx.cw
		local simDt = ctx:visualDt(dt) -- (dust is local motion: real speed in the game)
		local camX, camY, camZ = ctx:simCamera()
		if show and simDt > 0 then
			-- pickup around each tornado (more tries where the wind is strongest). In the game on
			-- PICKUP_HZ ticks of the shared clock, its dice seeded per tornado and tick; in the lab
			-- once a frame
			local function tornadoPickup(simDt: number, tick: number?)
				for _, t in cw.tornadoes do
					if tick then
						rng = Random.new((idSeed(t.id) * 7919 + tick * 104729) % 2147483647)
					end
					if not t.ended then
						-- (m: how far it looks - the drawn distance over the scale it is drawn at. The game
						-- draws a storm larger than the map: a tornado 10 km off on the map filled the
						-- follow camera's view and lifted no dust at all, "no debris collar", regrade 15.
						-- In the lab the same as the map distance)
						local ksT = C.scaleAbout(t.x, t.y)
						local Pt = C.toWorld(t.x, t.y, 0)
						local camP = workspace.CurrentCamera.CFrame.Position
						local d = Vector3.new(Pt.X - camP.X, 0, Pt.Z - camP.Z).Magnitude / math.max(ksT, 1e-6)
						if d < 9000 then
							-- (over rain-soaked ground what goes up is wet mud and wreckage, darker and greyer
							-- than dry soil: the dry-soil brown under heavy rain washed the near view brown,
							-- regrade 2026-11-10)
							local col = dustColour(t):Lerp(Color3.fromRGB(76, 75, 72), 0.6 * wetness(t.x, t.y))
							local tries = math.clamp(math.floor(6 + t.vc / 6), 4, 16)
							-- (the drawn funnel's foot: a rope's foot swings about its contact
							-- (Vortex.axisAt's waves) and the funnel is drawn about the smoothed position.
							-- Dust is lifted where the vortex's wind is, then placed about the foot as
							-- drawn - at the bare contact it sat off to one side of the rope's tip, 2026-10-31)
							local e0 = ctx.tornadoAdapter and ctx.tornadoAdapter.entries[t.id]
							local fox, foy = 0, 0
							if e0 and e0.params then
								local fx0, fy0 = Vortex.axisAt(e0, 0)
								fox, foy = (e0.x or t.x) + fx0 - t.x, (e0.y or t.y) + fy0 - t.y
							end
							-- The debris cloud's shape (2026-10-31, from radar and photo studies - Wakimoto et al.
							-- 2022, Dowell et al. 2005, NWS spotter guides): a ring, not a disc - the spin flings
							-- debris out of the core, so it is hollow with a dense rim - 2-6 funnel widths
							-- across, densest at the ground, and a bell: a wide low skirt pinching into a collar
							-- that hugs the lower funnel. Skirt puffs: big (0.8-1.4 core radii), low, over
							-- 1-2.5 rc; collar puffs: smaller, on the rim (0.9-1.3 rc), lifted up to ~1/4 of the
							-- cloud base by the rim's updraft. (It was a flat, pale scatter of small puffs out
							-- to 3.5 rc: speckle with no shape)
							local Hb = if e0 then math.max(100, e0.cloudBase or 1000) else 1000
							-- the collar hugs the funnel as drawn: its condensed radius low down, not the
							-- core's (2026-10-31: on a rope-out the core is far wider than the thin funnel, and
							-- the collar's few puffs floated round it as scattered specks)
							local rv = t.rc
							-- Not condensed near the ground (a high base, a weak or broad vortex): the
							-- debris annulus round the core (radar: debris just outside the visible funnel,
							-- at about the core radius - LaGrange 2009, Wakimoto et al. 2011) is lifted by
							-- the core's updraft into a see-through dust tube toward the funnel aloft, as
							-- high as the updraft carries it (the puffs ride Vortex.sample's wind). Without
							-- it the collar fell back to 0.15 rc and a dust skirt sat under empty air
							-- (lifecycle scene L3, 2026-10-31).
							-- (the tube's share of the puffs, 2026-11-03: by how far the funnel is from
							-- condensing at the ground, 1 uncondensed .. 0 condensed 3 m wide. A yes/no on
							-- "condensed at all" switched the spawn radius, collar share and rate at once, and
							-- a cone pulsing about that point flipped its dust between tube and skirt)
							local kT, tipZ, rvN = 0, Hb, rv
							local rgFoot = 0 -- (the condensed funnel's radius near the ground)
							if e0 and e0.params then
								local rg = Vortex.condensationRadius(e0, 0.05 * Hb)
								rgFoot = rg
								-- (a multi-vortex's too: the parent's debris annulus rises round its broad core
								-- as well as the sub-vortices' own columns - without it a mature tornado under a
								-- high base was a funnel aloft over clear air, SC check 2026-11-01)
								kT = 1 - smooth(0.5, 3, rg)
								if kT > 0 then
									-- (in 40 steps: in 10, ~200 m under a 2 km base, the column stopped short of the tip)
									for kz = 1, 40 do
										if Vortex.condensationRadius(e0, Hb * kz / 40) > 1 then
											tipZ = Hb * kz / 40
											break
										end
									end
								end
								rvN = math.clamp(rg, 0.15 * t.rc, t.rc)
							end
							for _ = 1, tries do
								local tube = kT > 0 and random() < kT
								local rv = if tube then 0.95 * t.rc else rvN
								-- the skirt's scale: halfway between the funnel's foot and the core. (2026-11-02:
								-- from the core alone a cone 46 m wide at the ground - core 120 m - stood in ~400 m
								-- of dust, huge from the scene cameras, user. Not condensed at the ground the dust
								-- is all there is to see of the vortex: the core's then)
								local rk = if tube then t.rc else 0.5 * (rv + t.rc)
								local a = random() * 2 * math.pi
								-- (2026-10-31, the references' debris ball: about as tall as it is wide round the
								-- foot. Was 20% collar over a skirt to 2.5 rc - a wide low dome, and on a rope a
								-- wide flat disc)
								-- (more of it in the whirl round the foot where the funnel is much thinner than
								-- the core - a rope-out's skirt alone drew a flat slab)
								local collar = random() < (if tube then 0.6 else 0.4 + 0.4 * (1 - rv / math.max(t.rc, 1)))
								-- (skirt within 0.7-1.3 rc: out to 1.8 rc it drew a wide dense dust field, user 2026-10-31)
								local rr = if collar then rv * (0.9 + 0.4 * random()) else rk * (0.7 + 0.6 * random() ^ 1.5)
								-- Round a funnel condensed to the ground (a cone or wedge whose foot is about a
								-- core wide) that skirt lay inside or behind the funnel and nothing showed
								-- (2026-11-07, engine-fed game tornado: a 185 mph wedge with no debris cloud).
								-- There the skirt is tried from the funnel's foot out to 3 core radii, denser
								-- near the foot; the pickup below keeps only where the ground wind lifts dust,
								-- so how far it reaches is the vortex's wind (Rankine, ~1/r outside the core)
								-- and the background wind it drifts in, not a set width.
								if not collar and not tube and rgFoot > 0.5 * t.rc then
									local r0 = 0.9 * rgFoot
									local r1 = math.max(r0 + 20, 3 * t.rc)
									rr = r0 + (r1 - r0) * random() ^ 1.6
									rk = math.max(rk, 0.5 * rr)
								end
								local x, y = t.x + rr * math.cos(a), t.y + rr * math.sin(a)
								local s, u, v, w = pickup(x, y)
								if self.dbgOn then -- (debug, EngineStormsDebugCam: what the pickups find)
									local st = self.dbgStats or { n = 0, hit = 0, U = 0, wet = 0, rr = 0, at = os.clock() }
									self.dbgStats = st
									st.n += 1
									if s > 0 then st.hit += 1 end
									st.U += sqrt(u * u + v * v)
									st.wet += wetness(x, y)
									st.rr += rr / math.max(t.rc, 1)
								end
								if s > 0 and random() < math.min(1, s * 0.3 * simDt * 6 * (if collar and tube then 2 else 1)) then -- (0.4: too dense, user 2026-10-31)
									local size, z0, w0
									-- Every puff starts at the ground and is carried up by the vortex's own
									-- updraft (ClientWorld windAt includes Vortex.sample): the tube and collar
									-- were placed up to 0.55 of the tube / 0.12 of the base above the ground
									-- at birth - dust appearing in midair, guessed (user 2026-11-02).
									local life = nil
									if collar and tube then
										-- (puffs about a core wide spread up the tube, toward the funnel's tip. At
										-- 0.35 rc, with frayed wisps, it drew a scatter of specks, 2026-10-31)
										-- (2 cores wide: at 0.9 the column drew as a trail of dark dots under a high
										-- funnel from a few km, SC check 2026-11-01)
										size = math.clamp(2.8 * t.rc, 30, 420) * (0.7 + 0.6 * random()) -- (2 rc: too few overlapped, 2026-11-02)
										z0 = 1 + 3 * random()
										w0 = w + 3 + 3 * random()
										-- (long enough to ride the updraft up the tube: its climb time at the
										-- updraft half way up, so the column fills from the ground up)
										local _, _, wm = ctx.cw:windAt(x, y, 0.5 * tipZ)
										life = math.clamp(0.8 * tipZ / math.max(wm, 3), 8, 45) * (0.7 + 0.6 * random())
									elseif collar then
										size = math.clamp(0.6 * rv, 4, 160) * (0.7 + 0.6 * random())
										z0 = 1 + 3 * random()
										w0 = w + 4 + 4 * random()
									else
										size = math.clamp(0.8 * rk, 6, 200) * (0.7 + 0.6 * random()) -- (1.1 rc: too widespread, user 2026-10-31) -- (floor 20 m: a rope's dust a wide disc)
										z0 = 1 + 3 * random()
										w0 = w + 2
									end
									local pp = spawn(x + fox, y + foy, z0, u * 0.5, v * 0.5, w0, s * (0.4 + 0.6 * (t.debrisLoft or 0.3) + 0.3), col, size, t.x, t.y, t.id)
									if pp then
										pp.zH = Hb
										if life then
											pp.life = life
										end
										pp.capK = 0.15 + 0.25 * random() -- (its own height cap: one shared cap drew a flat top)
										-- (spreads with its tornado's size: a thin one's whirl stays narrow)
										pp.grow *= 0.6 * math.clamp(rk / 60, 0.2, 1) -- (x0.6, 2026-10-31: spread too wide)
										if collar then
											-- (2026-10-31: the streaky wisp sheet lifted beside the funnel drew flat
											-- slabs across its lower part; now the fibrous puff, as the skirt)
											pp.collar = true
											pp.tube = tube or nil
											pp.tipZ = tipZ
											if tube then
												-- (the plain soft puff: the smooth lumpy one drew a stack of
												-- round bubbles with visible rims up the tube, 2026-10-31)
												pp.smooth = true
												pp.img.Image = C.TEXTURES.softFlat
												pp.img.ImageRectSize = Vector2.zero
												pp.img.ImageRectOffset = Vector2.zero
											end
										else
											-- (the skirt's material: past ~25 m/s the wind lifts soil clods, crop and
											-- wreckage as well as dust, falling at 5-20 m/s - a response time
											-- tau = v_t / g of 0.5-2 s against fine dust's ~0.15. Lagging the swirl
											-- they are flung out at ~tau V^2 / r against the inflow, so the debris
											-- sits in a ring just outside the core, low down (radar debris rings:
											-- Dowell et al. 2005). All riding the inflow as fine dust, the skirt was
											-- drawn into the condensed funnel and hidden there - 26 of 278 puffs
											-- showed round a 193 mph wedge, 2026-11-08)
											local dK = math.clamp((sqrt(u * u + v * v) - 25) / 20, 0, 1)
											pp.tau = DUST_TAU * 10 ^ (random() * dK)
											-- (skirt puffs exactly level: a tilted card's corner dips below the
											-- ground, and the fade allowed for it by lifting the whole card's foot)
											local r0 = if pp.img.Rotation > 90 then 180 else 0
											pp.img.Rotation = r0
											pp.grad.Rotation = 90 - r0
											pp.gRot = nil
										end
									end
								end
							end
							-- multi-vortex: each sub-vortex is a whirl of its own, a few tens of metres
							-- across, its wind well above the parent's (Vortex.subvortices), so it lifts its
							-- own narrow column. Picked up only over the parent's whole area, with puffs
							-- sized to the parent (up to 160 m), they merged into one broad cloud and a
							-- multi-vortex start showed no separate vortices (2026-10-29)
							local e = ctx.tornadoAdapter and ctx.tornadoAdapter.entries[t.id]
							local prm = e and e.params
							if prm and (prm.subCount or 0) > 0.3 then
								local ex, ey = e.x or t.x, e.y or t.y
								local rs = Vortex.SUB_R * t.rc
								for _, sv in Vortex.subvortices(prm, 3) do
									local x = ex + sv[1] + rs * (random() - 0.5)
									local y = ey + sv[2] + rs * (random() - 0.5)
									local s, u, v, w = pickup(x, y)
									if s > 0 and random() < math.min(1, s * sv[3] * simDt * 3) then
										local size = math.clamp(2 * rs, 8, 50) * (0.7 + 0.6 * random())
										-- (risen fast in the whirl's own updraft: a column, not a skirt)
										spawn(x, y, 1 + 3 * random(), u * 0.5, v * 0.5, w + 6 + 4 * random(), s * 0.6 * sv[3] + 0.2, col, size, t.x, t.y, t.id)
									end
								end
							end
						end
					end
				end
				-- outflow surges, ground circulations, dust fronts: near the camera and the focus
				rng = nil
			end
			if ctx.frameFed then
				local n = math.floor(Workspace:GetServerTimeNow() * PICKUP_HZ)
				local n0 = self.pickupTick or (n - 1)
				for k = math.max(n0 + 1, n - 5), n do
					tornadoPickup(1 / PICKUP_HZ, k)
				end
				self.pickupTick = n
			else
				tornadoPickup(simDt, nil)
			end
			local fx, fy = ctx:focus()
			for ci = 1, 2 do
				local ccx, ccy, cr = camX, camY, 1500
				if ci == 2 then
					ccx, ccy, cr = fx, fy, 2500
				end
				for _ = 1, 3 do
					local a = random() * 2 * math.pi
					local rr = cr * sqrt(random())
					local x, y = ccx + rr * math.cos(a), ccy + rr * math.sin(a)
					local s, u, v, w = pickup(x, y)
					-- (blowing dust leaves the last 30% of the pool to the tornadoes' debris: it filled it
					-- and a tornado's dust column thinned out, SC check 2026-11-01)
					if s > 0 and #self.free > 0.3 * MAX_PUFFS and random() < math.min(1, s * simDt * 1.5) then
						spawn(x, y, 1, u * 0.6, v * 0.6, w + 1, 0.35 * s, Color3.fromRGB(140, 124, 104), 12 + 18 * random())
					end
				end
			end
		end
		-- the light on the dust (one sample near the focus, one at the camera: puffs take the nearer)
		local SceneLight = ctx.Tornado.SceneLight
		local fxL, fyL = ctx:focus()
		-- (each sample marches the sun through the storm: refreshed 4 times a second)
		local nowL = os.clock()
		if not self.lightF or nowL - (self.lightAt or 0) > 0.25 then
			self.lightAt = nowL
			self.lightF = SceneLight.shade(SceneLight.sample(ctx, fxL, fyL, 60 + C.groundAt(fxL, fyL)), 1, 0.4)
			self.lightC = SceneLight.shade(SceneLight.sample(ctx, camX, camY, 60 + C.groundAt(camX, camY)), 1, 0.4)
		end
		local lightF, lightC = self.lightF, self.lightC
		-- (dust near the ground under the base is lit from the side by the open low sky past the
		-- base's edge - Render/Sky's horizon openness, ctx.skyHorizon - not only by the dark light
		-- straight under the cloud: there it drew as black smoke, regrade 2026-11-07. A light floor of
		-- 0.45 of daylight, scaled by how much of the low sky is open)
		local ho = ctx.skyHorizon or 0
		if ho > 0 then
			local fl = 0.45 * ho * (ctx.skyDay or 1)
			local function lift(c: Color3): Color3
				return Color3.new(math.max(c.R, fl), math.max(c.G, fl), math.max(c.B, fl))
			end
			lightF, lightC = lift(lightF), lift(lightC)
		end
	-- motion: a quarter of the puffs sample the wind each frame (they relax toward it over
		-- ~0.75 s, so a sample every 4 frames is plenty), the rest coast on their velocity
		local quarter = self.frame % 4
		local half = self.frame % 2
		local wcount = 0
		-- the view, for skipping the writes of puffs off screen and changes too small to see (half
		-- a pixel; angles and pixel sizes are unit-free, so this works in studs)
		local cam = Workspace.CurrentCamera
		local cf = cam.CFrame
		local camS, look = cf.Position, cf.LookVector
		local camUY = cf.UpVector.Y
		-- (the screen's horizontal, on the map: where a card's left and right edges stand)
		local crX, crY = cf.RightVector.X, -cf.RightVector.Z
		do
			local l = sqrt(crX * crX + crY * crY)
			if l > 1e-3 then
				crX, crY = crX / l, crY / l
			else
				crX, crY = 1, 0
			end
		end
		local sunDir = game:GetService("Lighting"):GetSunDirection()
		local vp = cam.ViewportSize
		local tanV = math.tan(math.rad(cam.FieldOfView) / 2)
		local halfDiag = math.atan(tanV * sqrt(1 + (vp.X / math.max(vp.Y, 1)) ^ 2)) + MARGIN
		local pxK = 0.5 * 2 * tanV / math.max(vp.Y, 1) -- (half a pixel per stud of distance)
		-- each tornado's ground point now and its scale (its dust is drawn about it)
		local tors = self.torCentres
		if not tors then
			tors = {}
			self.torCentres = tors
		end
		table.clear(tors)
		for _, t in cw.tornadoes do
			local tc = self.torPool and self.torPool[t.id]
			if not tc then
				self.torPool = self.torPool or {}
				tc = {}
				self.torPool[t.id] = tc
			end
			-- about the smoothed centre the funnel is drawn at (Tornado/StateAdapter), not the
			-- raw ~15 Hz snapshot: the dust is drawn scaled about this point, so each snapshot
			-- step threw the whole cloud ~3x that step on screen (2026-10-28)
			local e = ctx.tornadoAdapter and ctx.tornadoAdapter.entries[t.id]
			local x, y = if e then e.x else t.x, if e then e.y else t.y
			tc.x, tc.y, tc.k = x, y, C.scaleAbout(x, y)
			tc.e = if e and e.params then e else nil
			tc.rc = t.rc
			-- the drawn foot less the vortex's own centre (the puffs are placed about the drawn
			-- foot, as at spawn; their wind is the vortex's, so it is sampled that far back)
			if tc.e then
				local fx0, fy0 = Vortex.axisAt(e, 0)
				tc.fox, tc.foy = e.x + fx0 - t.x, e.y + fy0 - t.y
			else
				tc.fox, tc.foy = 0, 0
			end
			tors[t.id] = tc
		end
		-- (tornadoes gone: their entries let go - every field is set afresh each frame)
		if self.torPool then
			for id in self.torPool do
				if not tors[id] then
					self.torPool[id] = nil
				end
			end
		end
		for i, p in self.puffs do
			if p.alive then
				p.age += simDt
				if p.age > p.life or not show then
					kill(p)
				else
					-- (puffs near a tornado sample the air every frame, the rest every 4th. Fine dust
					-- follows the air within hundredths of a second; relaxing once every 4 frames over
					-- ~0.75 s, a puff's velocity lagged the vortex's turning and pointed off the circle,
					-- and coasting straight between samples did the same: round a 185 mph wedge they
					-- were flung out at ~30 m/s and the storm's winds drew them off in streaks, user
					-- 2026-11-07. Now it relaxes over DUST_TAU of the time since its last sample)
					local tcN = p.tid ~= nil and tors[p.tid]
					local near = false
					if tcN and tcN.e then
						local dxN, dyN = p.x - tcN.x, p.y - tcN.y
						local rN = 4 * math.max(30, tcN.rc or 0)
						near = dxN * dxN + dyN * dyN < rN * rN
					end
					p.since = (p.since or 0) + simDt
					if (near or i % 4 == quarter) and simDt > 0 then
						-- (in the vortex's frame: the puffs sit about the drawn foot, the wind about the
						-- sim's centre - sampled where they were, the skirt fed on the wind beside the
						-- vortex and drifted off to one side of the funnel, user 2026-11-07)
						local ox, oy = if tcN then tcN.fox or 0 else 0, if tcN then tcN.foy or 0 else 0
						local u, v, w = windNear(cw, ctx.Sim.Vortex, p.x - ox, p.y - oy, math.max(1, p.z))
						wcount += 1
						-- horizontal vortex tubes round violent tornadoes (Render/DebrisCloud): dust
						-- rolls over round them
						local hvw = ctx.hvWindAt
						if hvw and ctx.hvField and #ctx.hvField > 0 then
							local hu, hv_, hw = hvw(p.x, p.y, p.z)
							u += hu
							v += hv_
							w += hw
						end
						local U = sqrt(u * u + v * v)
						local tau = p.tau or DUST_TAU
						local k = 1 - exp(-p.since / tau)
						p.since = 0
						p.u += (u - p.u) * k
						p.v += (v - p.v) * k
						-- turbulent lift keeps raising dust near the ground; settling slowly
						-- (smooth noise along its path, not a fresh die each frame: the same on every client)
						local lift = 0.25 * U * (0.5 + 0.5 * math.noise(p.x * 0.02, p.y * 0.02, p.age * 0.7) - 0.35) * exp(-p.z / 250)
						p.w += (w + lift - 0.3 - 9.8 * (tau - DUST_TAU) - p.w) * k -- (settling: g tau, past the fine dust's 0.3 m/s)
					end
					p.x += p.u * simDt
					p.y += p.v * simDt
					p.z = math.max(0.5, p.z + p.w * simDt)
					local s = p.size + p.grow * p.age
					if p.zH and not p.collar and p.z > (p.capK or 0.3) * s then
						-- (the skirt hugs the ground and spreads; lifted on the rim's updraft its dense
						-- middle rose off the ground - a skirt in midair, 2026-10-31. The collar rises)
						p.z = (p.capK or 0.3) * s -- (0.12 flattened it into a smooth dome; up to 0.4 with the 1.4 stretch below, its foot still meets the ground)
						p.w = math.min(p.w, 0)
					end
					local a = math.clamp(p.age / 1.2, 0, 1) * math.clamp((p.life - p.age) / 3, 0, 1)
					-- denser low down; thinner as the puff spreads
					local opacity = p.dens * a * (0.55 * p.size / s + 0.15) * (if p.tid ~= nil then 0.7 else 1)
					if p.smooth then
						opacity *= 0.45 -- (the smooth puff covers ~2.5 x as much of its card as the fibrous one)
					end
					if p.zH then
						if p.tube then
							-- (a veil of dust thinning toward the funnel's tip: as the debris cloud's thinning
							-- below, measured against the tube's own height. With that rule's 0.08 of a 1.5 km
							-- base and a 0.45 veil it drew faint round ghosts, 2026-10-31)
							-- (x2: the tube's soft puffs also took the smooth puff's 0.45 above - ~0.1 a card, a
							-- near-invisible column under the funnel, SC check 2026-11-01)
							opacity *= 1.3 * (0.3 + 0.7 * exp(-p.z / (0.5 * (p.tipZ or p.zH))))
						else
							if p.collar then
								opacity *= 0.75 -- (0.5 with the round soft puff; the fibrous one is sparser)
							end
							-- (the debris cloud is densest at the ground and thins upward: dense enough
							-- low down to read as one mass - a dark silhouette - not a speckle)
							opacity *= 1.15 * (0.45 + 0.55 * exp(-p.z / (0.08 * p.zH))) -- (1.5: too dense, user 2026-10-31)
						end
					end
					-- (tornado dust low down spreads sideways: wider than tall, rounder as it rises)
					-- (blowing dust, raised by the wind alone, stays in a layer a few tens of metres deep and
					-- streams downwind: ~3 x wider than tall)
					-- (the tube's puffs taller than wide: round, a few of them up a 1-2 km column drew as
					-- separate grey balls over the ground; upright they overlap into one veil, SC check
					-- 2026-11-02)
					local asp = if p.tube then 0.75 -- (0.5: thin grey sticks)
						elseif p.tid ~= nil then 1 + 0.4 * exp(-p.z / (0.3 * p.size + 20))
						elseif p.drift then 3
						else 1 -- (0.8: a wide low dome)
					-- (about its tornado's ground point now, else where it was picked up, else itself)
					local tc = p.tid ~= nil and tors[p.tid]
					local ccx, ccy, k
					if tc then
						ccx, ccy, k = tc.x, tc.y, tc.k
					elseif p.tx then
						ccx, ccy = p.tx, p.ty
						k = C.scaleAbout(ccx, ccy)
					else
						ccx, ccy = p.x, p.y
						k = C.scaleAbout(ccx, ccy)
					end
					-- (the ground at full scale whatever the dust is drawn at: LabConfig.groundIn)
					local gz = C.groundIn(p.x, p.y, ccx, ccy, k)
					local wp = C.toWorldAbout(p.x, p.y, p.z + gz, ccx, ccy, k)
					local ss = s * k
					-- on screen? (a cone round the view, widened by the puff's own angular size)
					local rel = wp - camS
					local dist = rel.Magnitude
					local vis = dist <= ss
					if not vis then
						local ang = math.acos(math.clamp(rel:Dot(look) / dist, -1, 1))
						vis = ang < halfDiag + math.asin(math.min(1, 0.75 * ss / dist))
					end
					local thr = pxK * dist -- (studs: half a pixel there)
					local back = vis and p.culled -- (back on screen: everything is written now)
					p.culled = not vis
					if p.wp == nil or vis or (i + self.frame) % CULL_REFRESH == 0 then
						local last = p.wp
						if last == nil or (wp - last).Magnitude > thr then
							p.wp = wp
							p.att.WorldPosition = wp
						end
					end
					if vis then
						-- size, fade and light change slowly: half the puffs each frame (fewer instance writes)
						if i % 2 ~= half or p.age < 1.5 or back then
							if math.abs(ss - (p.ss or -1)) > thr or math.abs(asp - (p.asp or 1)) > 0.03 then
								p.ss, p.asp = ss, asp
								p.bb.Size = UDim2.fromScale(ss * asp, ss / sqrt(asp))
							end
							-- The ground fade (2026-10-31). A billboard is a flat card facing the camera:
							-- seen from above, the part of it that reaches below the ground is hidden by the
							-- ground along a straight line across the screen, at a different height for each
							-- card - the dust broke into strips with hard horizontal edges. The card now
							-- fades out above that line: the ground's line in the card's plane lies
							-- (height above ground) / camUp.Y below its centre.
							local hS = ss / sqrt(asp)
							local gW = C.toWorldAbout(p.x, p.y, gz, ccx, ccy, k)
							local yc = (wp.Y - gW.Y) / math.max(camUY, 0.05)
							-- On a slope the ground's line runs across the card at a tilt: the ground
							-- under the card's left and right edges (2026-11-02: level, the dust on a
							-- hillside was cut by the hill on its uphill side and faded out above the
							-- ground on its downhill side - floating, user). The fade follows that line.
							local hw = 0.5 * s * asp -- (m: the card's half width)
							local gL = C.groundIn(p.x - crX * hw, p.y - crY * hw, ccx, ccy, k)
							local gR = C.groundIn(p.x + crX * hw, p.y + crY * hw, ccx, ccy, k)
							local slope = (gR - gL) * k / math.max(camUY, 0.05) / math.max(2 * hw * k, 1e-3)
							local tilt = math.atan(slope) -- (radians: the line rising to the right)
							yc *= math.cos(tilt) -- (the centre's distance across the tilted line)
							-- (in card units from the top. The gradient runs down the screen across the tilted
							-- card's whole extent there - h |cos| + w |sin| - so the ground line is placed on that
							-- exactly; and the fade is centred on it, the dust about half opaque at the ground
							-- line and solid just above. 2026-10-31: a fixed "tilt" allowance lifted the fade off
							-- the ground and the fade ended at the line, so the dust thinned above the ground -
							-- the bright horizon showed through, a gap under the dust, user)
							local rr = math.rad(p.img.Rotation)
							-- (the fade's direction in the card: screen-down, turned to cross the ground's
							-- line square; UIGradient angles run clockwise)
							local phi = 0.5 * math.pi - rr - tilt
							local gRot = math.deg(phi)
							if math.abs(gRot - (p.gRot or 1e9)) > 0.5 then
								p.gRot = gRot
								p.grad.Rotation = gRot
							end
							local ext = hS * math.abs(math.sin(phi)) + ss * asp * math.abs(math.cos(phi))
							local fw = math.clamp(0.04 + 0.6 * (1 - camUY), 0.04, FADE_W)
							local t1 = 0.5 + yc / math.max(ext, 1e-3) + 0.5 * fw
							local key = if t1 >= 1 then NO_KEY else math.floor(math.max(t1, -1) * 64 + 0.5)
							local wkey = math.floor(fw * 64 + 0.5)
							local ck = if key == NO_KEY then NO_KEY else key * 256 + wkey
							if ck ~= p.gkey then
								p.gkey = ck
								p.grad.Transparency = fadeSeq(key, wkey)
							end
							-- dust inside the condensed funnel is hidden by it (the funnel is opaque cloud):
							-- drawn there it made pale grainy balls on the funnel's face (user + review,
							-- 2026-10-30). Faded over a quarter of the puff's size either side of the
							-- condensed radius at its height.
							local te = tc and tc.e
							if te then
								local H = math.max(100, te.cloudBase or 1000)
								local zq = math.min(p.z, 0.995 * H)
								local ax, ay = Vortex.axisAt(te, zq)
								local rq = sqrt((p.x - te.x - ax) ^ 2 + (p.y - te.y - ay) ^ 2)
								local rcd = Vortex.condensationRadius(te, zq)
								if rcd > 1 then
									local t = math.clamp((rq - (rcd - 0.25 * s)) / math.max(0.5 * s, 1), 0, 1)
									opacity *= t * t * (3 - 2 * t)
								end
							end
							local tr = 1 - math.clamp(opacity, 0, if p.zH then 0.8 else 0.55)
							if math.abs(tr - (p.tr or 2)) > 0.002 then
								p.tr = tr
								p.img.ImageTransparency = tr
							end
						end
						-- (its light changes slowest of all: every 8th frame)
						if (i + self.frame) % 8 == 0 or p.age < 0.5 or back then
							local lf = if (p.x - fxL) ^ 2 + (p.y - fyL) ^ 2 < (p.x - camX) ^ 2 + (p.y - camY) ^ 2 then lightF else lightC
							local b = p.base or Color3.new(0.5, 0.45, 0.4)
							-- (dust scatters sky light: lighter than the cloud it sits under. Tornado dust
							-- also by where the sun is: front-lit tan to pale, backlit a dark silhouette -
							-- it was always the front-lit x2.4, pale cream even against the light, 2026-10-31)
							local gain = 2.4
							if p.zH or p.drift then
								local toCam = camS - (p.wp or camS)
								local front = if toCam.Magnitude > 1 then 0.5 * (1 + toCam.Unit:Dot(sunDir)) else 0.5
								-- (darker, 2026-10-31: the references' debris ball is a dark mass; but from 0.85 it
								-- went black under the storm and read as fire smoke, regrade 2026-11-07: dust is
								-- lit by the sky it scatters, a grey-tan even backlit)
								gain = 1.25 + 0.75 * front
							end
							local cr, cg, cb = math.min(1, b.R * lf.R * gain), math.min(1, b.G * lf.G * gain), math.min(1, b.B * lf.B * gain)
							local pc = p.col
							if not pc or math.abs(cr - pc.R) > 0.002 or math.abs(cg - pc.G) > 0.002 or math.abs(cb - pc.B) > 0.002 then
								local col = Color3.new(cr, cg, cb)
								p.col = col
								p.img.ImageColor3 = col
							end
						end
					end
				end
			end
		end
		-- (debug count: only when it changes, at most twice a second)
		local nPuffs = MAX_PUFFS - #self.free
		local nowS = os.clock()
		if nPuffs ~= self.statN and nowS - (self.statAt or -math.huge) > 0.5 then
			self.statN, self.statAt = nPuffs, nowS
			ctx.root:SetAttribute("DustPuffs", nPuffs)
		end
		local _ = camZ
		local __ = wcount
	end

	function self:destroy()
		anchor:Destroy()
	end

	return self
end

return TornadoDust
