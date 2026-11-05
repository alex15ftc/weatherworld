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
local sqrt, exp, random = math.sqrt, math.exp, math.random
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
			soil = soil:Lerp(Color3.fromRGB(70, 70, 70), math.clamp((t.debrisLoft - 0.3) * 1.2, 0, 0.7))
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
		if U <= th then
			return 0, u, v, w
		end
		return math.clamp(U / th - 1, 0, 3), u, v, w
	end

	function self:update(dt: number)
		self.frame += 1
		local show = ctx.state.show.dust
		local cw = ctx.cw
		local simDt = ctx:visualDt(dt) -- (dust is local motion: real speed in the game)
		local camX, camY, camZ = ctx:simCamera()
		if show and simDt > 0 then
			-- pickup around each tornado (more tries where the wind is strongest)
			for _, t in cw.tornadoes do
				if not t.ended then
					local d = sqrt((t.x - camX) ^ 2 + (t.y - camY) ^ 2)
					if d < 9000 then
						local col = dustColour(t)
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
						if e0 and e0.params then
							local rg = Vortex.condensationRadius(e0, 0.05 * Hb)
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
							local x, y = t.x + rr * math.cos(a), t.y + rr * math.sin(a)
							local s, u, v, w = pickup(x, y)
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
			tors[t.id] = tc
		end
		for i, p in self.puffs do
			if p.alive then
				p.age += simDt
				if p.age > p.life or not show then
					kill(p)
				else
					if i % 4 == quarter and simDt > 0 then
						local u, v, w = cw:windAt(p.x, p.y, math.max(1, p.z))
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
						local k = 1 - exp(-simDt * 4 * 2 / 1.5)
						p.u += (u - p.u) * k
						p.v += (v - p.v) * k
						-- turbulent lift keeps raising dust near the ground; settling slowly
						local lift = 0.25 * U * (random() - 0.35) * exp(-p.z / 250)
						p.w += (w + lift - 0.3 - p.w) * k
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
								gain = 0.85 + 0.95 * front -- (darker, 2026-10-31: the references' debris ball is a dark mass)
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
