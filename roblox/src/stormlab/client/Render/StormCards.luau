--!nonstrict
--!native
-- Storm clouds as billboard cards (the default cloud style; F4 "clouds: kit" switches back to the
-- cloud-kit meshes of Render/Clouds). Each storm's tower, billows, top, anvil, base, scud, wall
-- cloud and tail cloud are soft camera-facing cards laid out from its fields (CloudParts/CardPlan).
--
--   track    a storm's drawn position glides with its velocity and eases (~2 s) toward each new
--            snapshot, so snapshot steps never show as jumps
--   anchor   one invisible part per storm (and one for its wall cloud, turned at the low-level
--            rotation); cards hang from attachments at storm-local offsets, so motion is one
--            BulkMoveTo for every storm
--   plan     a storm is re-planned every PLAN_EVERY s; each card has a stable key (CardPlan), so a
--            re-plan updates the same card in place (it drifts with the storm's evolution), new
--            cards fade in and dropped ones fade out (FADE s). Plans are written ~200 cards a frame
--   light    self-lit (LightInfluence 0): albedo x (sky light x the sky it sees + direct sun x what
--            reaches its sunward surface through the storm) + distance haze; lightning recolours
--            the cards of storms near a flash (~15 Hz, colours only)
--   detail   fewer cards with distance and with many storms (CardPlan detail); none beyond MAX_RANGE
-- Debug attribute on ctx.root: StormCards ("storms · cards · ms").
local Workspace = game:GetService("Workspace")

local Parts = script.Parent:WaitForChild("CloudParts")
local Util = require(Parts:WaitForChild("Util"))
local CardPlan = require(Parts:WaitForChild("CardPlan"))
local ShelfPlan = require(Parts:WaitForChild("ShelfPlan"))

local StormCards = {}

local PLAN_EVERY = 3
local MAX_RANGE = 150000
local FRAME = 256 -- px a frame of a 4 x 4 sheet (1024 px)
local FADE = 1.2 -- s for a card to fade in or out
local BUDGET = 200 -- card writes a frame for pending plans

local function smooth(a: number, b: number, x: number): number
	local t = math.clamp((x - a) / (b - a), 0, 1)
	return t * t * (3 - 2 * t)
end

function StormCards.new(ctx: any): any
	Util.init(ctx.Sim)
	local C = ctx.Config
	CardPlan.available.striationFlat = (C.TEXTURES.striationFlat or "") ~= ""
	CardPlan.available.fractusFlat = (C.TEXTURES.fractusFlat or "") ~= ""
	local Storm = ctx.Sim.Storm
	local self = {}
	local folder = Instance.new("Folder")
	folder.Name = "StormCards"
	folder.Parent = ctx.root
	local groups = {}
	local anchors, frames = {}, {}
	-- the cloud kit only names the shelf plan's pieces (the cards use their boxes)
	local CloudKit = nil
	local function cloudKit(): any
		if CloudKit then
			return CloudKit
		end
		local shared = game:GetService("ReplicatedStorage"):FindFirstChild("Shared")
		local weather = shared and shared:FindFirstChild("Weather")
		local mod = weather and weather:FindFirstChild("CloudKit")
		if mod then
			local ok, ck = pcall(require, mod)
			if ok then
				CloudKit = ck
			end
		end
		return CloudKit
	end
	local ORIGIN = { x = 0, y = 0 }
	local statAt = 0

	local function newAnchor(name: string): BasePart
		local p = Instance.new("Part")
		p.Name = name
		p.Anchored, p.CanCollide, p.CanQuery, p.CanTouch = true, false, false, false
		p.Transparency = 1
		p.Size = Vector3.one
		p.Parent = folder
		return p
	end

	-- a set of keyed cards on one anchor
	local function newLayer(anchor: BasePart): any
		return { anchor = anchor, byKey = {}, free = {}, fades = {}, anim = {}, count = 0 }
	end
	local function acquire(layer: any): any
		local inst = table.remove(layer.free)
		if inst then
			return inst
		end
		local att = Instance.new("Attachment")
		att.Parent = layer.anchor
		local bb = Instance.new("BillboardGui")
		bb.Adornee = att
		bb.LightInfluence = 0
		bb.Size = UDim2.fromScale(100, 100)
		bb.Enabled = false
		bb.ResetOnSpawn = false
		local img = Instance.new("ImageLabel")
		img.BackgroundTransparency = 1
		img.Size = UDim2.fromScale(1, 1)
		img.ImageTransparency = 1
		-- shading inside the card: lit on the side toward the sun, shadowed on the far side
		local grad = Instance.new("UIGradient")
		grad.Parent = img
		img.Parent = bb
		bb.Parent = layer.anchor
		return { att = att, bb = bb, img = img, grad = grad, a = 0, target = 0 }
	end
	local function release(layer: any, inst: any)
		inst.bb.Enabled = false
		inst.img.ImageTransparency = 1
		layer.byKey[inst.key] = nil
		layer.fades[inst] = nil
		layer.anim[inst] = nil
		layer.count -= 1
		inst.key, inst.card = nil, nil
		table.insert(layer.free, inst)
	end
	local function clearLayer(layer: any)
		for _, inst in layer.byKey do
			inst.bb.Enabled = false
			inst.img.ImageTransparency = 1
			inst.key, inst.card = nil, nil
			table.insert(layer.free, inst)
		end
		layer.byKey, layer.fades, layer.anim, layer.count = {}, {}, {}, 0
	end

	local function newGroup(id: string): any
		return {
			main = newLayer(newAnchor("Storm_" .. id)),
			wallL = newLayer(newAnchor("Wall_" .. id)),
			plan = {}, wall = nil, plannedAt = -math.huge, jobs = {},
		}
	end
	local function hideGroup(g: any)
		clearLayer(g.main)
		clearLayer(g.wallL)
		g.jobs = {}
	end

	-- the scene's light for clouds (as Tornado/SceneLight, but the sun unshadowed: the card's own
	-- `lit` carries the storm's shadow)
	local fogLightAt, fogLight = -math.huge, 0.5
	local function light(): any
		local sun = game:GetService("Lighting"):GetSunDirection()
		local elev = sun.Y
		local night = smooth(0.05, -0.17, elev)
		local moon = ctx.state.moonlight or 0
		local daySky = 0.32 + 0.38 * smooth(0, 0.5, elev)
		local sky = daySky * (1 - night) + (0.035 + 0.12 * moon) * night
		local direct = if elev > 0 then smooth(0, 0.15, elev) else 0
		local warm = smooth(0.4, 0.05, elev) * (1 - night)
		-- (the sun in the sim frame: x east, y north, z up)
		-- rain fog: the light the rain scatters toward the eye is the light where the rain is, so
		-- under a storm it is the dim light under the storm (its shadow and overcast sky at the
		-- camera, from the scene light field), a little blue. Sampled 4 times a second.
		local now = os.clock()
		if now - fogLightAt > 0.25 then
			fogLightAt = now
			local cam = Workspace.CurrentCamera.CFrame.Position
			local Ls = ctx.Tornado.SceneLight.sample(ctx, cam.X, -cam.Z, math.max(cam.Y, 2))
			fogLight = 0.75 * Ls.sky + 0.12 * Ls.sun
		end
		local fg = fogLight
		local fog = Color3.new(fg * 0.93, fg * 0.98, fg * 1.06)
		ctx.rainFogColour = fog
		return { sky = sky, direct = direct, warm = warm, night = night, sx = sun.X, sy = -sun.Z, sz = sun.Y, fog = fog }
	end
	-- vx, vy, vz: the unit view direction from the camera to the card (sim frame)
	-- shift: the part of the card's surface tilted toward (+) or away from (-) the sun
	local function colour(card: any, L: any, flash: number, hazeF: number, vx: number, vy: number, vz: number, shift: number): Color3
		local sky = L.sky * card.sky * (1 + 0.12 * shift)
		local s = L.direct * card.lit * 0.9
		local nx = card.nx
		if not nx then
			s *= math.clamp(0.65 + 0.45 * shift, 0.2, 1.1)
		end
		if nx then
			local ny, nz = card.ny, card.nz
			local rim = 1 - math.abs(nx * vx + ny * vy + nz * vz) -- (the card's own edge-on-ness)
			-- what the camera sees of a lump is the side facing it: the card's normal leans toward
			-- the camera (seen from below through a gap, a tower shows its shadowed underside)
			nx, ny, nz = nx - 0.7 * vx, ny - 0.7 * vy, nz - 0.7 * vz
			local nm = math.sqrt(nx * nx + ny * ny + nz * nz)
			if nm > 1e-3 then
				nx, ny, nz = nx / nm, ny / nm, nz / nm
			end
			-- the surface's own orientation to the sun (wrapped Lambert: clouds scatter light
			-- round their edges), on top of the storm's shadow already in `lit`
			local facing = math.clamp(nx * L.sx + ny * L.sy + nz * L.sz + shift, -1, 1)
			s *= 0.3 + 0.7 * math.max(0, 0.25 + 0.75 * facing)
			-- an up-facing surface sees the whole sky, a down-facing one mostly the ground
			sky *= 0.9 + 0.1 * nz
			-- forward scatter: an edge seen toward the sun glows (the silver lining)
			local fwd = math.max(0, vx * L.sx + vy * L.sy + vz * L.sz) ^ 4
			if fwd > 0.01 then
				s += L.direct * card.lit * 0.9 * fwd * rim * rim
			end
		end
		local alb = card.albedo
		-- Colour of the light. Diffuse light that has crossed a lot of cloud (the storm's own
		-- shadow: low `lit`) has been scattered many times through big drops, which absorb a
		-- little red: deep cloud goes blue-slate to teal. The sun's light is cream (warmer as
		-- the sun gets low).
		local deep = (1 - math.min(card.lit, 1)) * (1 - L.night)
		local sr, sg, sb = 0.93 - 0.2 * deep, 0.99 - 0.04 * deep, 1.1 + 0.04 * deep
		local cr, cg, cb = 1.04, 1.0 - 0.18 * L.warm, 0.9 - 0.36 * L.warm
		local r = alb * (sky * sr + s * cr) + 0.85 * flash
		local g = alb * (sky * sg + s * cg) + 0.88 * flash
		local b = alb * (sky * sb + s * cb) + flash
		local c = Color3.new(math.min(r, 1), math.min(g, 1), math.min(b, 1))
		if hazeF > 0.01 then
			c = Util.mix(c, Util.light.haze, hazeF * (1 - L.night))
		end
		return c
	end
	local fogNow = 0 -- (the group being written: its rain fog along the ground, 0..1)
	local baseNow = 1000 -- (and its cloud base, m)
	local distNow = 1e4 -- (and the camera's distance from it, m)
	-- a card's shading: the colours of its sunward and shadowed sides, as a gradient
	-- A card's colour is its sunward side (ImageColor3); its shading is a gradient of ratios
	-- (shadow / lit) multiplied over it. Ratios change only when a card is written or fogged, so a
	-- lightning flash rewrites one colour per card. Gradients are shared (quantized ratios).
	local seqCache: { [number]: ColorSequence } = {}
	local function ratioSeq(lit: Color3, mid: Color3, dark: Color3): ColorSequence
		local function q(a: number, b: number): number
			return math.clamp(math.floor(a / math.max(b, 0.02) * 20 + 0.5), 0, 20)
		end
		local mr, mg, mb = q(mid.R, lit.R), q(mid.G, lit.G), q(mid.B, lit.B)
		local dr, dg, db = q(dark.R, lit.R), q(dark.G, lit.G), q(dark.B, lit.B)
		local key = ((((mr * 21 + mg) * 21 + mb) * 21 + dr) * 21 + dg) * 21 + db
		local seq = seqCache[key]
		if not seq then
			local w = Color3.new(1, 1, 1)
			seq = ColorSequence.new({
				ColorSequenceKeypoint.new(0, w),
				ColorSequenceKeypoint.new(0.45, w),
				ColorSequenceKeypoint.new(0.75, Color3.new(mr / 20, mg / 20, mb / 20)),
				ColorSequenceKeypoint.new(1, Color3.new(dr / 20, dg / 20, db / 20)),
			})
			seqCache[key] = seq
		end
		return seq
	end
	-- write a card's colour (and, when `full`, its shading)
	local function shadeCard(inst: any, c: any, wx: number, wy: number, camPos: Vector3, L: any, flashes: boolean, full: boolean)
		local ff = ctx.flashField
		local flash = if flashes and ff then ctx.Tornado.FlashField.at(ff, wx, wy, c.z) else 0
		local rel = Vector3.new(wx, c.z, -wy) - camPos
		local d = math.max(rel.Magnitude, 1)
		local vx, vy, vz, hf = rel.X / d, -rel.Z / d, rel.Y / d, Util.hazeF(d)
		-- a lobe is bright across most of its sunward face and dark only in the crease on the far
		-- side: lit over the first half, the card's own light in the middle, shadow at the edge
		local lit = colour(c, L, flash, hf, vx, vy, vz, 0.3)
		-- rain fog: rain lies below the cloud base, so a line of sight from near the ground to a
		-- card at height z spends only base / z of its length in it
		local f = 0
		if fogNow > 0.01 then
			-- (and the rain it crosses grows with its distance: the storm's fog is for its centre)
			local tau = -math.log(1 - math.min(fogNow, 0.97)) * math.min(1, baseNow / math.max(c.z, 1)) * math.min(1, d / distNow)
			f = 1 - math.exp(-tau)
			lit = Util.mix(lit, L.fog, f)
		end
		inst.img.ImageColor3 = lit
		if full then
			local mid = colour(c, L, 0, hf, vx, vy, vz, 0)
			local dark = colour(c, L, 0, hf, vx, vy, vz, -0.4)
			if f > 0 then
				mid = Util.mix(mid, L.fog, f)
				dark = Util.mix(dark, L.fog, f)
			end
			inst.grad.Color = ratioSeq(lit, mid, dark)
		end
	end
	-- the gradient's direction on screen: from the sun's side to the far side. The sun's
	-- direction is projected onto the camera's screen (one angle for every card), less each
	-- card image's own rotation (the gradient turns with the image)
	local gradAngle = 0
	local aimQueue = {}
	local flashQueue = {}
	local function sunScreenAngle(L: any): number
		local cf = Workspace.CurrentCamera.CFrame
		local sun = Vector3.new(L.sx, L.sz, -L.sy)
		local sx, sy = sun:Dot(cf.RightVector), sun:Dot(cf.UpVector)
		if sx * sx + sy * sy < 1e-4 then
			return 90 -- (sun straight ahead or behind: light from the top)
		end
		-- screen y points down; the gradient runs away from the sun
		return math.deg(math.atan2(sy, -sx))
	end
	-- Rain between the camera and a point: the transmission of a march through the surface rain
	-- field (extinction 0.33 R^0.66 per km, as NearPrecip and the funnel's obscuration). Roblox's
	-- Atmosphere does not fog billboards, so the cards are fogged here.
	local function rainFog(x: number, y: number, camX: number, camY: number): number
		local vol = ctx.cw.vol
		if not vol or not vol.nxv then
			return 0
		end
		local Precip = ctx.Sim.Precip
		local d = math.sqrt((x - camX) ^ 2 + (y - camY) ^ 2)
		local n = math.clamp(math.floor(d / 800), 3, 16)
		local tau = 0
		for i = 1, n do
			local f = (i - 0.5) / n
			local r = Precip.surface(vol, camX + (x - camX) * f, camY + (y - camY) * f) or 0
			if r > 0.05 then
				tau += 0.33 * r ^ 0.66 * (d / n) / 1000
			end
		end
		return math.clamp(1 - math.exp(-tau), 0, 0.97)
	end

	-- write one planned card into its layer: the same key keeps its card (it moves a little), a
	-- new key fades in
	local function put(layer: any, c: any, ox: number, oy: number, s: any, camPos: Vector3, L: any, flashes: boolean, stamp: number): boolean
		local inst = layer.byKey[c.key]
		local isNew = inst == nil
		if not inst then
			inst = acquire(layer)
			inst.key = c.key
			inst.a = 0
			layer.byKey[c.key] = inst
			layer.count += 1
			inst.bb.Enabled = true
			inst.img.ImageTransparency = 1
		end
		inst.card = c
		inst.stamp = stamp
		layer.anim[inst] = if c.mv then true else nil
		inst.att.Position = Vector3.new(c.x, c.z, -c.y)
		inst.bb.Size = UDim2.fromScale(math.max(c.w, 5), math.max(c.h, 5))
		local img = inst.img
		local tex = C.TEXTURES[c.tex] or C.TEXTURES.softFlat
		if img.Image ~= tex then
			img.Image = tex
		end
		if c.frame >= 0 then
			img.ImageRectSize = Vector2.new(FRAME, FRAME)
			img.ImageRectOffset = Vector2.new((c.frame % 4) * FRAME, math.floor(c.frame / 4) * FRAME)
		else
			img.ImageRectSize = Vector2.zero
		end
		img.Rotation = if c.h < c.w * 0.8 then 0 else c.rot
		-- (a kept card refreshes its colour; its shading is redone only when new or now and then)
		inst.shadeN = ((inst.shadeN or 0) + 1) % 6
		shadeCard(inst, c, s.x + ox + c.x, s.y + oy + c.y, camPos, L, flashes, isNew or inst.shadeN == 0)
		inst.grad.Rotation = gradAngle - img.Rotation
		inst.target = c.a
		if math.abs(inst.a - c.a) > 0.005 then
			layer.fades[inst] = true
		else
			img.ImageTransparency = 1 - c.a
		end
		return isNew
	end

	-- one pending job (a card list for a layer) for up to `budget` cards; when it finishes, cards
	-- the new plan no longer has fade out
	local function runJob(job: any, s: any, camPos: Vector3, L: any, flashes: boolean, budget: number): number
		local list = job.cards
		local n = #list
		local i1 = math.min(n, job.i + budget - 1)
		for i = job.i, i1 do
			if put(job.layer, list[i], job.ox, job.oy, s, camPos, L, flashes, job.stamp) then
				job.new = (job.new or 0) + 1
			end
		end
		budget -= math.max(0, i1 - job.i + 1)
		job.i = i1 + 1
		if job.i > n then
			job.done = true
			local dropped = 0
			for _, inst in job.layer.byKey do
				if inst.stamp ~= job.stamp and inst.target > 0 then
					inst.target = 0
					job.layer.fades[inst] = true
					dropped += 1
				end
			end
			-- (debug: how stable re-plans are - cards kept in place / new / dropped)
			if n > 0 then
				ctx.root:SetAttribute("StormCardsPlan", string.format("kept %d · new %d · dropped %d", n - (job.new or 0), job.new or 0, dropped))
			end
		end
		return budget
	end

	local function stepFades(layer: any, dt: number)
		local k = dt / FADE
		for inst in layer.fades do
			local t = inst.target
			if inst.a < t then
				inst.a = math.min(t, inst.a + k)
			else
				inst.a = math.max(t, inst.a - k)
			end
			inst.img.ImageTransparency = 1 - inst.a
			if inst.a == t then
				layer.fades[inst] = nil
				if t <= 0 then
					release(layer, inst)
				end
			end
		end
	end

	-- one animated card's place and opacity this frame (storm-local, sim time t)
	local function animate(inst: any, t: number, gain: number)
		local c = inst.card
		local m = c and c.mv
		if not m then
			return
		end
		if m.k == "spin" then
			-- turning about the updraft (a whole ring: no fade, no loop). It turns ~0.5 deg/s, so
			-- each card moves ~5 times a second (staggered), not every frame
			local now = os.clock()
			if now < (inst.spinAt or 0) then
				return
			end
			inst.spinAt = now + 0.18 + 0.04 * c.ph
			local th = m.omega * t
			local cs, sn = math.cos(th), math.sin(th)
			local dx, dy = c.x - m.tx, c.y - m.ty
			inst.att.Position = Vector3.new(m.tx + dx * cs - dy * sn, c.z, -(m.ty + dx * sn + dy * cs))
			inst.img.ImageTransparency = 1 - inst.a * gain
			return
		end
		local phi = (t / m.P + c.ph) % 1
		-- fade in and out at the cycle's ends (no card pops on its loop)
		local env = math.min(1, phi / 0.15) * math.min(1, (1 - phi) / 0.2)
		local x, y, z = c.x, c.y, c.z
		if m.k == "in" then
			-- pulled toward the target, swirling cyclonically about it, lifted toward the base
			local dx, dy = x - m.tx, y - m.ty
			local k = 1 - m.pull * phi
			local th = m.swirl * phi
			local cs, sn = math.cos(th), math.sin(th)
			x = m.tx + (dx * cs - dy * sn) * k
			y = m.ty + (dx * sn + dy * cs) * k
			z += m.rise * phi * phi -- (accelerating up as it nears the updraft)
		else
			z += m.rise * phi
			local g = 1 + m.grow * phi
			inst.bb.Size = UDim2.fromScale(math.max(c.w * g, 5), math.max(c.h * g, 5))
		end
		inst.att.Position = Vector3.new(x, z, -y)
		inst.img.ImageTransparency = 1 - inst.a * env * gain
	end

	local function recolourLayer(layer: any, ox: number, oy: number, s: any, camPos: Vector3, L: any, flashes: boolean, full: boolean)
		for _, inst in layer.byKey do
			local c = inst.card
			if c then
				shadeCard(inst, c, s.x + ox + c.x, s.y + oy + c.y, camPos, L, flashes, full)
			end
		end
	end

	local flashActive = false
	local flashAt = 0
	local stamp = 0
	function self:update(dt: number)
		local t0 = os.clock()
		local style = ctx.state.cloudStyle or "cards"
		local on = style == "cards" and ctx.state.show.clouds ~= false
		if not on then
			for _, g in groups do
				hideGroup(g)
				g.plannedAt = -math.huge
			end
			return
		end
		Util.refreshLight()
		local cw = ctx.cw
		local camPos = Workspace.CurrentCamera.CFrame.Position
		local camX, camY = camPos.X, -camPos.Z
		local simT = ctx:simTime()
		local simDt = if ctx.state.paused then 0 else dt * (ctx.state.timeScale or 1)
		local dtSnap = math.clamp(simT - (cw.time or simT), -5, 60)
		local L = light()
		-- the shading's direction follows the camera (only when it has turned noticeably)
		local tAim = os.clock()
		do
			-- (when the camera has turned more than 5 degrees, every card's gradient is turned -
			-- spread over frames, 250 cards a frame, so a chase camera that keeps turning costs
			-- little)
			local ang = sunScreenAngle(L)
			local diff = (ang - gradAngle + 180) % 360 - 180
			if math.abs(diff) > 5 and #aimQueue == 0 then
				gradAngle = ang
				for _, g in groups do
					for _, layer in { g.main, g.wallL } do
						for _, inst in layer.byKey do
							table.insert(aimQueue, inst)
						end
					end
				end
			end
			local nA = math.min(#aimQueue, 250)
			for _ = 1, nA do
				local inst = table.remove(aimQueue)
				inst.grad.Rotation = gradAngle - inst.img.Rotation
			end
		end
		local aimMs = (os.clock() - tAim) * 1000
		local flashes = ctx.flashField ~= nil and #ctx.flashField.flashes > 0
		-- storms in range
		local live, inRange = {}, 0
		for _, s in cw.storms do
			local d2 = (s.x - camX) ^ 2 + (s.y - camY) ^ 2
			if d2 < MAX_RANGE * MAX_RANGE then
				live[tostring(s.id)] = s
				inRange += 1
			end
		end
		-- squall-line systems: shelf clouds along their leading edges
		local systems = (cw.systemsSnap and cw.systemsSnap.systems) or {}
		for _, sys in systems do
			if sys.segments and #sys.segments > 0 then
				live["y:" .. tostring(sys.id)] = sys
			end
		end
		for id, g in groups do
			if not live[id] then
				hideGroup(g)
				g.main.anchor:Destroy()
				g.wallL.anchor:Destroy()
				groups[id] = nil
			end
		end
		-- re-plan the stalest storm (one a frame)
		local stalest, oldest = nil, math.huge
		for id, s in live do
			local g = groups[id]
			if not g then
				g = newGroup(id)
				groups[id] = g
			end
			g.isSystem = string.sub(id, 1, 2) == "y:"
			g.storm = if g.isSystem then ORIGIN else s
			g.obj = s
			if g.plannedAt < oldest then
				stalest, oldest = id, g.plannedAt
			end
		end
		local tPlan0 = os.clock()
		if stalest and t0 - oldest >= PLAN_EVERY then
			local g = groups[stalest]
			local s = g.storm
			local plan, wall
			if g.isSystem then
				local ck = cloudKit()
				local pieces, vx, vy = {}, 0, 0
				if ck then
					pieces, vx, vy = ShelfPlan.plan(g.obj, cw.storms, ck, camX, camY, 1)
				end
				plan = CardPlan.fromPieces(pieces, 4241, 1)
				g.vx, g.vy, g.t0 = vx, vy, cw.time or simT
			else
				local d = math.sqrt((s.x - camX) ^ 2 + (s.y - camY) ^ 2)
				local detail = math.clamp(1 - (d - 15000) / 120000, 0.3, 1) * math.clamp(8 / math.max(inRange, 1), 0.4, 1)
				local cp0 = os.clock()
				plan, _, wall = CardPlan.plan(s, Storm, detail, camX - s.x, camY - s.y)
				-- (debug: what a re-plan costs - one storm every PLAN_EVERY / storms seconds)
				ctx.root:SetAttribute("StormCardsPlanMs", math.floor((os.clock() - cp0) * 10000 + 0.5) / 10)
			end
			g.plan, g.wall = plan, wall
			g.plannedAt = t0
			stamp += 1
			g.jobs = {
				{ layer = g.main, cards = plan, i = 1, ox = 0, oy = 0, stamp = stamp },
				{ layer = g.wallL, cards = if wall then wall.cards else {}, i = 1, ox = if wall then wall.x else 0, oy = if wall then wall.y else 0, stamp = stamp },
			}
		elseif flashes or flashActive or #flashQueue > 0 then
			tPlan0 = os.clock() -- (a flash recolour, not a plan)
			-- lightning: colours only, for storms near a flash (and once more when it ends). A pass
			-- over their cards is queued and written 300 cards a frame (each card ~14 times a
			-- second at 60 fps, as fast as the flash changes), not all at once.
			if #flashQueue == 0 then
				flashAt = t0
				for _, g in groups do
					local s = g.storm
					local near = false
					if flashes then
						for _, f in ctx.flashField.flashes do
							if ((f.x or s.x) - s.x) ^ 2 + ((f.y or s.y) - s.y) ^ 2 < 30000 ^ 2 then
								near = true
								break
							end
						end
					end
					if near or g.flashLit then
						g.flashLit = near
						for _, inst in g.main.byKey do
							table.insert(flashQueue, { inst, g, false })
						end
						if g.wall then
							for _, inst in g.wallL.byKey do
								table.insert(flashQueue, { inst, g, true })
							end
						end
					end
				end
			end
			local nF = math.min(#flashQueue, 300)
			for _ = 1, nF do
				local item = table.remove(flashQueue)
				local inst, g, isWall = item[1], item[2], item[3]
				local c = inst.card
				if c and g.storm then
					local s = g.storm
					fogNow = g.fog or 0
					baseNow = s.base or 1000
					distNow = math.max(g.dCam or 1e4, 500)
					local ox, oy = 0, 0
					if isWall and g.wall then
						ox, oy = g.wall.x, g.wall.y
					end
					-- (only cards the flash lights - or stopped lighting - are recoloured)
					local wx, wy = s.x + ox + c.x, s.y + oy + c.y
					local ff = ctx.flashField
					local fl = if flashes and ff then ctx.Tornado.FlashField.at(ff, wx, wy, c.z) else 0
					if math.abs(fl - (inst.flash or 0)) > 0.02 then
						inst.flash = fl
						shadeCard(inst, c, wx, wy, camPos, L, flashes, false)
					end
				end
			end
		end
		flashActive = flashes
		-- pending plans, a budget of card writes a frame
		local tJobs = os.clock()
		local tPre = tJobs - t0
		local tPlanMs = (tJobs - tPlan0) * 1000
		-- (a running mean of the whole update, to see averages not one frame)
		self.meanMs = (self.meanMs or 0) * 0.98
		local budget = BUDGET
		for _, g in groups do
			for _, job in g.jobs do
				if budget <= 0 then
					break
				end
				if not job.done then
					fogNow = g.fog or 0
					baseNow = (g.storm and g.storm.base) or 1000
					distNow = math.max(g.dCam or 1e4, 500)
					budget = runJob(job, g.storm, camPos, L, flashes, budget)
				end
			end
		end
		local tFog, tAnim, tFade = 0, 0, 0
		tJobs = os.clock() - tJobs
		-- fades, smoothed tracks, and every anchor moved at once
		table.clear(anchors)
		table.clear(frames)
		local n = 0
		local ease = 1 - math.exp(-dt / 2)
		local fogTick = t0 - (self.fogAt or 0) > 0.25
		if fogTick then
			self.fogAt = t0
		end
		for _, g in groups do
			local c0 = os.clock()
			stepFades(g.main, dt)
			stepFades(g.wallL, dt)
			tFade += os.clock() - c0
			c0 = os.clock()
			local s = g.storm
			local dCam = math.sqrt(((g.px or s.x) - camX) ^ 2 + ((g.py or s.y) - camY) ^ 2)
			g.dCam = dCam
			-- rain between the camera and the storm: fog its cards (recoloured when it changes)
			if fogTick and not g.isSystem then
				g.fog = rainFog(g.px or s.x, g.py or s.y, camX, camY)
				local fogMoved = math.abs(g.fog - (g.fogApplied or 0)) > 0.04
				if fogMoved or (g.fog > 0.05 and math.abs(fogLight - (g.fogLightApplied or 0)) > 0.03) then
					g.fogApplied = g.fog
					g.fogLightApplied = fogLight
					fogNow = g.fog
					baseNow = s.base or 1000
					distNow = math.max(dCam, 500)
					-- (a change of the fog's colour alone rewrites colours, not the shading)
					recolourLayer(g.main, 0, 0, s, camPos, L, false, fogMoved)
					local w = g.wall
					if w then
						recolourLayer(g.wallL, w.x, w.y, s, camPos, L, false, fogMoved)
					end
				end
			end
			tFog += os.clock() - c0
			c0 = os.clock()
			-- motion: scud drawn in and lifted, billows boiling (near storms only)
			if dCam < 40000 then
				local gain = 1
				for inst in g.main.anim do
					animate(inst, simT, gain)
				end
				for inst in g.wallL.anim do
					animate(inst, simT, gain)
				end
			end
			tAnim += os.clock() - c0
			local tx, ty = s.x + (s.u or 0) * dtSnap, s.y + (s.v or 0) * dtSnap
			if g.isSystem then
				-- (a shelf plan is absolute at its time; the line drifts at vx, vy since)
				local ddt = math.clamp(simT - (g.t0 or simT), -5, 120)
				tx, ty = (g.vx or 0) * ddt, (g.vy or 0) * ddt
				g.px, g.py = tx, ty
			elseif not g.px or (tx - g.px) ^ 2 + (ty - g.py) ^ 2 > 3000 ^ 2 then
				g.px, g.py = tx, ty
			else
				g.px += (s.u or 0) * simDt
				g.py += (s.v or 0) * simDt
				g.px += (tx - g.px) * ease
				g.py += (ty - g.py) * ease
			end
			table.insert(anchors, g.main.anchor)
			table.insert(frames, CFrame.new(C.toWorld(g.px, g.py, 0)))
			local w = g.wall
			if w then
				-- turning cyclonically (counter-clockwise seen from above) at the low-level rotation
				table.insert(anchors, g.wallL.anchor)
				table.insert(frames, CFrame.new(C.toWorld(g.px + w.x, g.py + w.y, 0)) * CFrame.Angles(0, (w.spin or 0) * simT % (2 * math.pi), 0))
			end
			n += g.main.count + g.wallL.count
		end
		if #anchors > 0 then
			Workspace:BulkMoveTo(anchors, frames, Enum.BulkMoveMode.FireCFrameChanged)
		end
		-- (other renderers - the kit's mammatus, shelf clouds - can follow the same smoothed tracks)
		ctx.stormTrack = ctx.stormTrack or {}
		for id, g in groups do
			if not g.isSystem then
				ctx.stormTrack[id] = { x = g.px, y = g.py }
			end
		end
		self.meanMs += 0.02 * (os.clock() - t0) * 1000
		if t0 - statAt > 0.5 then
			statAt = t0
			local k = 0
			for _ in groups do
				k += 1
			end
			ctx.root:SetAttribute("StormCards", string.format("%d storms · %d cards · %.2f ms", k, n, (os.clock() - t0) * 1000))
			-- (debug: where the time goes this frame)
			ctx.root:SetAttribute("StormCardsParts", string.format("mean %.2f · before %.2f (aim %.2f, plan/flash %.2f) · jobs %.2f · fades %.2f · fog %.2f · motion %.2f ms", self.meanMs, tPre * 1000, aimMs, tPlanMs, tJobs * 1000, tFade * 1000, tFog * 1000, tAnim * 1000))
		end
	end

	function self:destroy()
		folder:Destroy()
	end
	return self
end

return StormCards
