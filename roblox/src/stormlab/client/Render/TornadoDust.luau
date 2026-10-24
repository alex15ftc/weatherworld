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
local Workspace = game:GetService("Workspace")

local TornadoDust = {}

local MAX_PUFFS = 280
local sqrt, exp, random = math.sqrt, math.exp, math.random

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

	local function spawn(x: number, y: number, z: number, u: number, v: number, w: number, strength: number, colour: Color3, size: number)
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
		p.base = colour
		p.img.Rotation = random() * 360
		p.bb.Enabled = true
	end

	local function kill(p: any)
		p.alive = false
		p.bb.Enabled = false
		p.img.ImageTransparency = 1
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
		local simDt = if ctx.state.paused then 0 else dt * ctx.state.timeScale
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
								spawn(x, y, 1 + 3 * random(), u * 0.5, v * 0.5, w + 2, s * (0.4 + 0.6 * (t.debrisLoft or 0.3) + 0.3), col, size)
							end
						end
					end
				end
			end
			-- outflow surges, ground circulations, dust fronts: near the camera and the focus
			local fx, fy = ctx:focus()
			for _, centre in { { camX, camY, 1500 }, { fx, fy, 2500 } } do
				for _ = 1, 3 do
					local a = random() * 2 * math.pi
					local rr = centre[3] * sqrt(random())
					local x, y = centre[1] + rr * math.cos(a), centre[2] + rr * math.sin(a)
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
		local lightF = SceneLight.shade(SceneLight.sample(ctx, fxL, fyL, 60), 1, 0.4)
		local lightC = SceneLight.shade(SceneLight.sample(ctx, camX, camY, 60), 1, 0.4)
	-- motion: half the puffs sample the wind each frame, the rest coast on their velocity
		local half = self.frame % 2
		local wcount = 0
		for i, p in self.puffs do
			if p.alive then
				p.age += simDt
				if p.age > p.life or not show then
					kill(p)
				else
					if i % 2 == half and simDt > 0 then
						local u, v, w = cw:windAt(p.x, p.y, math.max(1, p.z))
						wcount += 1
						local U = sqrt(u * u + v * v)
						local k = 1 - exp(-simDt * 2 / 1.5)
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
					p.att.WorldPosition = Vector3.new(p.x, p.z, -p.y)
					-- size, fade and light change slowly: half the puffs each frame (fewer instance writes)
					if i % 2 ~= half or p.age < 1.5 then
						p.bb.Size = UDim2.fromScale(s, s)
						p.img.ImageTransparency = 1 - math.clamp(opacity, 0, 0.55)
						local lf = if (p.x - fxL) ^ 2 + (p.y - fyL) ^ 2 < (p.x - camX) ^ 2 + (p.y - camY) ^ 2 then lightF else lightC
						local b = p.base or Color3.new(0.5, 0.45, 0.4)
						p.img.ImageColor3 = Color3.new(math.min(1, b.R * lf.R * 2.4), math.min(1, b.G * lf.G * 2.4), math.min(1, b.B * lf.B * 2.4)) -- (dust scatters sky light: lighter than the cloud it sits under)
					end
				end
			end
		end
		ctx.root:SetAttribute("DustPuffs", MAX_PUFFS - #self.free)
		local _ = camZ
		local __ = wcount
	end

	function self:destroy()
		anchor:Destroy()
	end

	local _ = Workspace
	return self
end

return TornadoDust
