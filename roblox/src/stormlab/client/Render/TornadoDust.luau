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
local MARGIN = 0.1 -- rad beyond the view's half-diagonal before a puff counts as off screen
local CULL_REFRESH = 8 -- an off-screen puff's position is still moved every 8th frame (staggered)

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
		img.Parent = bb
		bb.Parent = anchor
		local p = { att = att, bb = bb, img = img, alive = false, x = 0, y = 0, z = 0, u = 0, v = 0, w = 0, age = 0, life = 1, size = 4, grow = 1, dens = 1 }
		table.insert(self.puffs, p)
		table.insert(self.free, p)
	end

	-- (tx, ty: the tornado a puff was picked up by - drawn as dirt, grainy, once the dirt sheet
	-- is uploaded; nil: soft dust from outflow and dust fronts)
	local texDirt = if (C.TEXTURES.dirtGrainFlat or "") ~= "" then C.TEXTURES.dirtGrainFlat else nil
	local function spawn(x: number, y: number, z: number, u: number, v: number, w: number, strength: number, colour: Color3, size: number, tx: number?, ty: number?, tid: any?)
		local p = table.remove(self.free)
		if not p then
			return
		end
		p.alive = true
		p.x, p.y, p.z = x, y, z
		p.u, p.v, p.w = u, v, w
		p.age = 0
		p.life = 8 + 14 * random()
		p.size = size
		p.grow = size * (0.25 + 0.35 * random())
		p.dens = math.clamp(strength, 0.05, 1)
		p.img.ImageColor3 = colour
		p.col = colour
		p.wp = nil -- (its first position is always written)
		p.base = colour
		p.tx, p.ty, p.tid = tx, ty, tid
		if tx and texDirt then
			p.img.Image = texDirt
			p.img.ImageRectSize = Vector2.new(256, 256)
			local fr = math.floor(random() * 16)
			p.img.ImageRectOffset = Vector2.new((fr % 4) * 256, (fr // 4) * 256)
		else
			p.img.Image = C.TEXTURES.softFlat
			p.img.ImageRectSize = Vector2.zero
		end
		p.img.Rotation = random() * 360
		p.bb.Enabled = true
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
		local soil = Color3.fromRGB(128, 112, 92)
		if t and (t.debrisLoft or 0) > 0.3 then
			soil = soil:Lerp(Color3.fromRGB(86, 84, 82), math.clamp((t.debrisLoft - 0.3) * 1.2, 0, 0.7))
		end
		return soil
	end

	local Precip = ctx.Sim.Precip
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
						for _ = 1, tries do
							local a = random() * 2 * math.pi
							local rr = t.rc * (0.3 + 3.2 * random() ^ 1.6)
							local x, y = t.x + rr * math.cos(a), t.y + rr * math.sin(a)
							local s, u, v, w = pickup(x, y)
							if s > 0 and random() < math.min(1, s * 0.9 * simDt * 6) then
								local size = math.clamp(0.35 * t.rc, 8, 70) * (0.6 + 0.6 * random())
								spawn(x, y, 1 + 3 * random(), u * 0.5, v * 0.5, w + 2, s * (0.4 + 0.6 * (t.debrisLoft or 0.3) + 0.3), col, size, t.x, t.y, t.id)
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
					if s > 0 and random() < math.min(1, s * simDt * 1.5) then
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
						-- horizontal vortex tubes round violent tornadoes (Render/DebrisCloud): a
						-- Rankine swirl round each tube's axis (an arc at r0, height zc). The inflow
						-- jet is fastest lowest, so under the tube the air moves in and over it out:
						-- dust rises on the side toward the tornado
						local hvf = ctx.hvField
						if hvf and #hvf > 0 then
							for _, hv in hvf do
								local rx, ry = p.x - hv.x, p.y - hv.y
								local rp = sqrt(rx * rx + ry * ry)
								if rp > 1 then
									local dth = (math.atan2(ry, rx) - hv.th + math.pi) % (2 * math.pi) - math.pi
									if math.abs(dth) < hv.half then
										local dr, dz = rp - hv.r0, math.max(1, p.z) - hv.zc
										local d = sqrt(dr * dr + dz * dz)
										if d < 5 * hv.a and d > 0.5 then
											local V = hv.vh * (if d < hv.a then d / hv.a else hv.a / d)
											-- (and it tapers toward the tube's ends)
											V *= 1 - (math.abs(dth) / hv.half) ^ 4
											local vr, vz = V * dz / d, -V * dr / d
											u += rx / rp * vr
											v += ry / rp * vr
											w += vz
										end
									end
								end
							end
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
					local a = math.clamp(p.age / 1.2, 0, 1) * math.clamp((p.life - p.age) / 3, 0, 1)
					-- denser low down; thinner as the puff spreads
					local opacity = p.dens * a * (0.55 * p.size / s + 0.15)
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
					local wp = C.toWorldAbout(p.x, p.y, p.z + C.groundAt(p.x, p.y), ccx, ccy, k)
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
							if math.abs(ss - (p.ss or -1)) > thr then
								p.ss = ss
								p.bb.Size = UDim2.fromScale(ss, ss)
							end
							local tr = 1 - math.clamp(opacity, 0, 0.55)
							if math.abs(tr - (p.tr or 2)) > 0.002 then
								p.tr = tr
								p.img.ImageTransparency = tr
							end
						end
						-- (its light changes slowest of all: every 8th frame)
						if (i + self.frame) % 8 == 0 or p.age < 0.5 or back then
							local lf = if (p.x - fxL) ^ 2 + (p.y - fyL) ^ 2 < (p.x - camX) ^ 2 + (p.y - camY) ^ 2 then lightF else lightC
							local b = p.base or Color3.new(0.5, 0.45, 0.4)
							local cr, cg, cb = math.min(1, b.R * lf.R * 2.4), math.min(1, b.G * lf.G * 2.4), math.min(1, b.B * lf.B * 2.4) -- (dust scatters sky light: lighter than the cloud it sits under)
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
