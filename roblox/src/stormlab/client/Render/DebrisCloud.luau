--!nonstrict
-- The tornado's debris cloud and its horizontal vortices, as billboards.
-- (docs/stormlab/RESEARCH-WALLCLOUD-HV.md)
--
-- (The dirt at the foot is Render/TornadoDust's swirling puffs; this module draws the
-- horizontal vortices only.)
--
-- Horizontal vortices (Oliveira et al. 2019; Houser et al. 2016): on violent tornadoes (peak
-- >= 61 m/s, EF3+) near-surface vortex tubes form by friction, line up just outside the core
-- (1-3 rc) in an arc from south to east, orbit counter-clockwise with the outer flow, and rise
-- at the tornado's edge. They are not drawn: this module keeps their motion and publishes them
-- as wind (ctx.hvField), and Render/TornadoDust rolls its dust round them.
local Workspace = game:GetService("Workspace")

local DebrisCloud = {}

local MAXT = 2 -- tornadoes drawn
local RANGE = 9000 -- m
local FRAME = 256
local G = 9.81
local TAU = 2 * math.pi
local sqrt, cos, sin, max, min, clamp = math.sqrt, math.cos, math.sin, math.max, math.min, math.clamp

local function hash(a: number, b: number): number
	local x = math.sin(a * 127.1 + b * 311.7) * 43758.5453
	return x - math.floor(x)
end

function DebrisCloud.new(ctx: any): any
	local C = ctx.Config
	local Vortex = ctx.Sim.Vortex
	local SceneLight = ctx.Tornado.SceneLight
	local T = C.TEXTURES
	-- (grainy dirt: tools/smoke/storm_sheets.py dirtgrain; falls back to the soft sheet)
	local texDirt = if (T.dirtGrainFlat or "") ~= "" then T.dirtGrainFlat else T.softSheetFlat
	local self = {}
	local folder = Instance.new("Folder")
	folder.Name = "DebrisCloud"
	folder.Parent = ctx.root
	local anchor = Instance.new("Part")
	anchor.Name = "DebrisAnchor"
	anchor.Anchored, anchor.CanCollide, anchor.CanQuery, anchor.CanTouch = true, false, false, false
	anchor.Transparency = 1
	anchor.Size = Vector3.one
	anchor.CFrame = CFrame.new()
	anchor.Parent = folder

	local pool = {}
	local function card(i: number): any
		local c = pool[i]
		if c then
			return c
		end
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
		img.ImageTransparency = 1
		img.ImageRectSize = Vector2.new(FRAME, FRAME)
		img.Parent = bb
		bb.Parent = anchor
		c = { att = att, bb = bb, img = img, on = false, tex = "", frame = -1 }
		pool[i] = c
		return c
	end
	local function setTex(c: any, tex: string, frame: number)
		if c.tex ~= tex then
			c.tex = tex
			c.img.Image = tex
		end
		if c.frame ~= frame then
			c.frame = frame
			c.img.ImageRectOffset = Vector2.new((frame % 4) * FRAME, (frame // 4) * FRAME)
		end
	end

	-- per tornado: dirt bursts and horizontal vortices
	local sets = {}
	local function setFor(e: any): any
		local s = sets[e.id]
		if not s then
			s = { bursts = {}, hvs = {}, nextHV = 0, owed = 0, lightAt = -math.huge, colour = Color3.new(0.4, 0.35, 0.3) }
			sets[e.id] = s
		end
		s.seen = true
		return s
	end

	-- the tangential wind at radius r, height z (vortex only, m/s)
	local function vAt(e: any, r: number, z: number): number
		local u, v = Vortex.sample(e.params, e.x + r, e.y, z)
		return sqrt(u * u + v * v)
	end

	-- screen angle (ImageLabel.Rotation, clockwise degrees) of a sim-frame direction
	local right, up = Vector3.xAxis, Vector3.yAxis
	local function screenRot(dx: number, dy: number, dz: number): number
		local w = Vector3.new(dx, dz, -dy)
		return -math.deg(math.atan2(w:Dot(up), w:Dot(right)))
	end

	local used = 0
	local field = {} -- (this frame's horizontal vortex tubes, for Render/TornadoDust)
	local function put(x: number, y: number, z: number, w: number, h: number, a: number, rot: number, tex: string, frame: number, col: Color3)
		used += 1
		local c = card(used)
		setTex(c, tex, frame)
		c.att.WorldPosition = Vector3.new(x, z, -y)
		-- (size, colour and opacity only when they change enough to see: fewer writes)
		if math.abs(w - (c.w or 0)) > 0.03 * w or math.abs(h - (c.h or 0)) > 0.03 * h then
			c.w, c.h = w, h
			c.bb.Size = UDim2.fromScale(max(w, 2), max(h, 2))
		end
		if math.abs(rot - (c.rot or 1e9)) > 1.5 then
			c.rot = rot
			c.img.Rotation = rot
		end
		if c.col ~= col then
			c.col = col
			c.img.ImageColor3 = col
		end
		local tr = 1 - clamp(a, 0, 0.95)
		if math.abs(tr - (c.tr or 2)) > 0.015 then
			c.tr = tr
			c.img.ImageTransparency = tr
		end
		if not c.on then
			c.on = true
			c.bb.Enabled = true
		end
	end

	local function drawTornado(e: any, s: any, simDt: number, camPos: Vector3, nearK: number)
		local fade = e.fade or 1
		local loft = (e.debrisLoft or 0) * fade
		local pk = max(e.peakWind or 0, e.vc or 0)
		local rc = max(e.rc or 30, 8)
		-- soil and light (the light marches the sun through the storm: 4 times a second)
		local now = os.clock()
		if now - s.lightAt > 0.25 then
			s.lightAt = now
			local lc = SceneLight.shade(SceneLight.sample(ctx, e.x, e.y, 40), 1, 0.4)
			-- loose soil, darkened once wreckage is in it (loft > 0.3 needs structures or deep soil)
			local soil = Color3.fromRGB(132, 108, 84):Lerp(Color3.fromRGB(78, 74, 70), clamp((loft - 0.3) * 1.3, 0, 0.75))
			s.colour = Color3.new(min(1, soil.R * lc.R * 2.2), min(1, soil.G * lc.G * 2.2), min(1, soil.B * lc.B * 2.2))
			s.light = lc
		end
		local col = s.colour

		-- horizontal vortices: violent tornadoes only
		if pk >= 61 and (e.O or 1) > 0.5 and fade > 0.3 then
			local want = clamp(1 + math.floor((pk - 61) / 15), 1, 3)
			local tNow = ctx:simTime()
			if #s.hvs < want and tNow >= s.nextHV then
				local hh = hash(#s.hvs + 1, tNow)
				local len = clamp(rc * (1 + 2 * hh), 50, 500)
				table.insert(s.hvs, {
					-- in the arc from south to east (counter-clockwise from -90 to 0 degrees)
					th = -math.pi / 2 + hash(tNow, 7) * math.pi / 2,
					r0 = rc * (1.3 + 1.5 * hash(tNow, 9)),
					z0 = 10 + 50 * hash(tNow, 11),
					len = len,
					age = 0,
					-- larger ones last longer (tens of seconds to a few minutes)
					life = 20 + 100 * (len / 500),
					frame = math.floor(hash(tNow, 13) * 16),
				})
				s.nextHV = tNow + 4 + 10 * hh
			end
			for j = #s.hvs, 1, -1 do
				local hv = s.hvs[j]
				hv.age += simDt
				if hv.age > hv.life then
					table.remove(s.hvs, j)
				else
					local v = min(vAt(e, hv.r0, 20), 120)
					hv.th += v / hv.r0 * simDt
					local life = hv.age / hv.life
					local env = min(1, life / 0.15) * min(1, (1 - life) / 0.25)
					-- the tube is published as wind (ctx.hvField): Render/TornadoDust adds its swirl
					-- to the dust it carries, so it shows as dirt rolling over round it, not as a
					-- drawn shape. Its swirl: stretched by the tornado's flow to ~half the outer-flow
					-- speed; its core radius a fraction of its length; it rises at the tornado's
					-- edge as it ages (up to ~200 m)
					table.insert(field, {
						x = e.x, y = e.y, th = hv.th, r0 = hv.r0,
						zc = hv.z0 + 100 * life ^ 0.7,
						half = 0.5 * hv.len / hv.r0,
						a = clamp(0.15 * hv.len, 15, 60),
						vh = 0.5 * v * env,
					})
				end
			end
		else
			table.clear(s.hvs)
		end
	end

	function self:update(dt: number)
		local adapter = ctx.tornadoAdapter
		local show = ctx.state.show.dust ~= false
		used = 0
		field = {}
		ctx.hvField = field
		if adapter and show then
			local cam = Workspace.CurrentCamera
			local camPos = cam.CFrame.Position
			right, up = cam.CFrame.RightVector, cam.CFrame.UpVector
			local simDt = if ctx.state.paused then 0 else dt * (ctx.state.timeScale or 1)
			local list = {}
			for _, e in adapter.entries do
				if e.params and (e.fade or 1) > 0.01 and ((e.debrisLoft or 0) > 0.02 or (e.peakWind or 0) >= 61) then
					local d = (Vector3.new(e.x, 0, -e.y) - camPos).Magnitude
					if d < RANGE then
						table.insert(list, { e = e, d = d })
					end
				end
			end
			table.sort(list, function(a, b)
				return a.d < b.d
			end)
			for _, s in sets do
				s.seen = false
			end
			for i = 1, min(MAXT, #list) do
				local e, d = list[i].e, list[i].d
				-- far: half the dirt (it is a few pixels of texture)
				drawTornado(e, setFor(e), simDt, camPos, if d > 3500 then 0.5 else 1)
			end
			for id, s in sets do
				if not s.seen then
					sets[id] = nil
				end
			end
		end
		for i = used + 1, #pool do
			local c = pool[i]
			if c.on then
				c.on = false
				c.bb.Enabled = false
			end
		end
		ctx.root:SetAttribute("DebrisCloudCards", used)
	end

	function self:destroy()
		folder:Destroy()
	end
	return self
end

return DebrisCloud
