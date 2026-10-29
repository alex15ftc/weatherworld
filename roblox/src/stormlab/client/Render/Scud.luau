--!nonstrict
--!native
-- Dynamic scud: wisps of cloud that condense in lifted, nearly saturated air at the underside of
-- a storm's base and drift with the air (World.windAt without the tornado's own vortex: the same
-- air motion debris, dust and rain follow). Nothing here is scripted motion; every rule reads a
-- field. It is part of the cloud, not loose debris:
--   forms      where the air is rising (w > 0) under the base and near saturation: rain-cooled
--              outflow (surface rain from the precipitation volume) or the inflow converging
--              under the lowering (most of it round the lowering). It is born at the underside
--              and hangs from it; deeper pieces only in saturated air: the depth below the base
--              it can condense at = SCUD.depth0 + SCUD.depthRain x saturation
--   moves      with the wind averaged over a few seconds (turbulent condensate patches don't jerk
--              from one wind sample to the next)
--   condenses  over tens of seconds while it rises within that depth; evaporates when it sinks or
--              drops below it; merges into the base on reaching it
--   looks      a soft wisp drawn out along its drift, level with the base (a slight eased tilt
--              with the drift, never spinning), half transparent, coloured as the lowering it
--              hangs from (ctx.stormBase, from StormCards), greyed by rain toward the camera
-- Drawn with its storm: about the storm's centre at its scale (LabConfig.scaleAbout / toWorldAbout).
-- Debug attribute on ctx.root: Scud ("fragments · ms").
local Workspace = game:GetService("Workspace")

local Scud = {}

local FRAME = 256
local MARGIN = 0.1 -- rad beyond the view's half-diagonal before a wisp counts as off screen
local CULL_REFRESH = 8 -- an off-screen wisp's position is still moved every 8th frame (staggered)
local exp, sqrt, max, min, clamp, random = math.exp, math.sqrt, math.max, math.min, math.clamp, math.random

local function smooth(a: number, b: number, x: number): number
	local t = clamp((x - a) / (b - a), 0, 1)
	return t * t * (3 - 2 * t)
end

function Scud.new(ctx: any): any
	local C = ctx.Config
	local S = C.SCUD or {}
	local MAX = S.max or 140 -- fragments in all
	local RANGE = S.range or 30000 -- m: storms nearer than this get scud
	local SPAWN = S.spawnTries or 30 -- candidate points a sim second per storm
	local DEPTH0 = S.depth0 or 120 -- m below the base a parcel condenses in unsaturated inflow
	local DEPTHRAIN = S.depthRain or 450 -- more, in saturated rain-cooled air
	local SIZE = S.size or { 90, 320 } -- m, a new fragment
	local Precip = ctx.Sim.Precip
	local SceneLight = ctx.Tornado.SceneLight
	-- wisps (streaky, soft-edged) rather than torn lumps: scud reads as frayed cloud
	local tex = C.TEXTURES.wispFlat or C.TEXTURES.shredFlat
	local self = {}

	local anchor = Instance.new("Part")
	anchor.Name = "ScudAnchor"
	anchor.Anchored, anchor.CanCollide, anchor.CanQuery, anchor.CanTouch = true, false, false, false
	anchor.Transparency = 1
	anchor.Size = Vector3.one
	anchor.CFrame = CFrame.new()
	anchor.Parent = ctx.root

	local pool, live = {}, {}
	local function acquire(): any
		local f = table.remove(pool)
		if f then
			f.bb.Enabled = true
			return f
		end
		local att = Instance.new("Attachment")
		att.Parent = anchor
		local bb = Instance.new("BillboardGui")
		bb.Adornee = att
		bb.LightInfluence = 0
		bb.ResetOnSpawn = false
		bb.Size = UDim2.fromScale(100, 50)
		local img = Instance.new("ImageLabel")
		img.BackgroundTransparency = 1
		img.Size = UDim2.fromScale(1, 1)
		img.Image = tex
		img.ImageRectSize = Vector2.new(FRAME, FRAME)
		img.ImageTransparency = 1
		img.Parent = bb
		bb.Parent = anchor
		return { att = att, bb = bb, img = img, tr = 1 }
	end
	local function release(f: any)
		f.bb.Enabled = false
		f.img.ImageTransparency = 1
		f.tr = 1
		f.wp = nil -- (a reused wisp writes everything on its first frame)
		table.insert(pool, f)
	end

	-- near saturation at a point: rain-cooled air (surface rain, mm/h) is close to saturated
	local function saturation(x: number, y: number): number
		local vol = ctx.cw.vol
		if not vol or not vol.nxv then
			return 0
		end
		local r = Precip.surface(vol, x, y) or 0
		return smooth(0.2, 6, r)
	end

	-- the rain between the camera and a point (0..0.95), as the storm cards' fog
	local function rainFog(x: number, y: number, camX: number, camY: number): number
		local vol = ctx.cw.vol
		if not vol or not vol.nxv then
			return 0
		end
		local d = sqrt((x - camX) ^ 2 + (y - camY) ^ 2)
		local tau = 0
		local step = C.sightPath(d / 4) / 1000 -- (km of drawn sight line a sample)
		for i = 1, 4 do
			local f = (i - 0.5) / 4
			local r = Precip.surface(vol, camX + (x - camX) * f, camY + (y - camY) * f) or 0
			tau += C.rainExtinction(r) * step
		end
		return clamp(1 - exp(-tau), 0, 0.95)
	end

	local acc = {} -- spawn accumulators per storm
	local stormList = {}
	local centres = {} -- storm id -> { x, y, k }: this frame's centre and scale of each storm
	local lightCache = {}
	local statAt, n = 0, 0
	local tick = 0

	function self:update(dt: number)
		local t0 = os.clock()
		tick += 1
		local cw = ctx.cw
		local on = ctx.state.show.clouds ~= false and cw.windAt ~= nil
		if not on then
			for i = #live, 1, -1 do
				release(live[i])
				live[i] = nil
			end
			return
		end
		local simDt = ctx:visualDt(dt) -- (scud is local motion: real speed in the game)
		local cam = Workspace.CurrentCamera
		local camX, camY = C.fromWorld(cam.CFrame.Position) -- (metres)
		local right, up = cam.CFrame.RightVector, cam.CFrame.UpVector

		-- spawn: candidate points under each near storm's base, kept where the air can condense
		local storms = stormList
		table.clear(storms)
		for _, s in cw.storms do
			if not s.dead then
				local d2 = (s.x - camX) ^ 2 + (s.y - camY) ^ 2
				if d2 < RANGE * RANGE and (s.W or 0) > 3 then
					table.insert(storms, s)
				end
			end
		end
		for _, s in storms do
			local id = tostring(s.id)
			acc[id] = (acc[id] or 0) + SPAWN * simDt
			local base = s.base or 1000
			local lx, ly = s.lowX or s.x, s.lowY or s.y
			local R = max(1500, 1.4 * (s.Ru or 3000))
			while acc[id] >= 1 and #live < MAX do
				acc[id] -= 1
				-- (most of it round the lowering, where the inflow converges into the updraft)
				local a = random() * 2 * math.pi
				local r = R * random() ^ 1.6
				local x, y = lx + math.cos(a) * r, ly + math.sin(a) * r
				local sat = saturation(x, y)
				local depth = DEPTH0 + DEPTHRAIN * sat
				-- it condenses at the cloud's underside first and hangs from it: born near the
				-- base, the deeper pieces only where the air is close to saturation
				local z = base - depth * random() ^ 2
				-- (z: above the datum, as the base; never within 40 m of the local ground)
				if z > C.groundAt(x, y) + 40 then
					-- (the air's motion without the tornado's own vortex: scud rides the inflow
					-- and the storm's circulation, not the funnel's winds)
					local u, v, w = cw:windAt(x, y, z, true)
					-- condensation needs lift: the faster the air rises here, the likelier
					if w > 0.2 and random() < clamp(w / 3, 0, 1) * (0.35 + 0.65 * max(sat, exp(-r / R * 2))) then
						local f = acquire()
						f.x, f.y, f.z = x, y, z
						f.u, f.v, f.w = u, v, w
						f.su, f.sv, f.sw = u, v, w -- (its drift: the wind averaged over seconds)
						f.a, f.age = 0, 0
						f.rot = 0
						f.size = SIZE[1] + (SIZE[2] - SIZE[1]) * random() ^ 2
						f.storm, f.base, f.depth = id, base, depth
						f.cx, f.cy, f.sk = s.x, s.y, nil -- (its storm's centre: kept current below)
						f.k = random(1, 1000)
						local fr = random(0, 15)
						f.img.ImageRectOffset = Vector2.new((fr % 4) * FRAME, (fr // 4) * FRAME)
						f.fog = rainFog(x, y, camX, camY)
						table.insert(live, f)
					end
				end
			end
			if acc[id] > 5 then
				acc[id] = 5
			end
		end

		-- the light at each storm's lowering (cached 4 times a second)
		local now = os.clock()
		for _, s in storms do
			local id = tostring(s.id)
			local lc = lightCache[id]
			if not lc or now - lc.at > 0.25 then
				local L = SceneLight.sample(ctx, s.lowX or s.x, s.lowY or s.y, (s.base or 1000) * 0.8)
				if not lc then
					lc = {}
					lightCache[id] = lc
				end
				lc.at, lc.col = now, SceneLight.shade(L, 0.72, 0.15)
			end
		end
		local fogCol = ctx.rainFogColour or Color3.new(0.5, 0.52, 0.56)

		-- each storm's centre and scale now (its scud is drawn about it)
		for _, s in cw.storms do
			local id = tostring(s.id)
			local c = centres[id]
			if not c then
				c = {}
				centres[id] = c
			end
			c.x, c.y, c.k, c.at = s.x, s.y, C.scaleAbout(s.x, s.y), tick
		end
		for id, c in centres do
			if c.at ~= tick then
				centres[id] = nil
			end
		end
		-- the view, for skipping the writes of wisps off screen and changes too small to see (half
		-- a pixel; angles and pixel sizes are unit-free, so this works in studs)
		local camS, look = cam.CFrame.Position, cam.CFrame.LookVector
		local vp = cam.ViewportSize
		local tanV = math.tan(math.rad(cam.FieldOfView) / 2)
		local halfDiag = math.atan(tanV * sqrt(1 + (vp.X / max(vp.Y, 1)) ^ 2)) + MARGIN
		local pxK = 0.5 * 2 * tanV / max(vp.Y, 1) -- (half a pixel per stud of distance)
		local pxR = 1 / (2 * tanV / max(vp.Y, 1)) -- (pixels per stud at a stud's distance)
		-- move, condense / evaporate, draw
		n = 0
		for i = #live, 1, -1 do
			local f = live[i]
			-- the wind, resampled ~5 times a second (staggered)
			if (tick + f.k) % 12 == 0 then
				f.u, f.v, f.w = cw:windAt(f.x, f.y, f.z, true)
				f.fog = rainFog(f.x, f.y, camX, camY)
			end
			-- a fragment is a patch of condensate in turbulent air: it drifts with the wind averaged
			-- over a few seconds (no jerks from one wind sample to the next)
			local kv = 1 - exp(-simDt / 6)
			f.su += (f.u - f.su) * kv
			f.sv += (f.v - f.sv) * kv
			f.sw += (f.w - f.sw) * kv
			f.x += f.su * simDt
			f.y += f.sv * simDt
			f.z += f.sw * simDt
			-- (carried over a hill it stays a few metres above the ground there)
			f.z = max(f.z, C.groundAt(f.x, f.y) + 10)
			f.age += simDt
			-- condensation: rising within its depth below the base, it thickens; sinking or below
			-- the depth, it evaporates; at the base it merges into the cloud
			local zc = f.base - f.depth
			local target = if f.sw > -0.3 then smooth(zc, zc + 0.6 * f.depth, f.z) else 0
			if f.z >= f.base - 20 then
				target = 0
			end
			-- (condensing and evaporating take tens of seconds: it grows out of the cloud and
			-- frays away, it does not pop)
			local rate = if target > f.a then 1 / 25 else 1 / 15
			f.a += (target - f.a) * min(1, simDt * rate)
			local far = (f.x - camX) ^ 2 + (f.y - camY) ^ 2 > (RANGE * 1.2) ^ 2
			if (f.age > 8 and f.a < 0.02) or f.age > 900 or far then
				release(f)
				table.remove(live, i)
				continue
			end
			n += 1
			-- a wisp drawn out along its drift (stretched by the wind shear it sits in), level with
			-- the base: only a slight tilt following the drift as seen on screen, eased (a stretched
			-- wisp reads the same turned half a circle, so the tilt never flips)
			local wx, wy = f.su, f.sv
			local sp = sqrt(wx * wx + wy * wy)
			local wv = C.dirWorld(wx, wy) -- (a direction: no scaling)
			local sx, sy = wv:Dot(right), wv:Dot(up)
			local onScreen = sqrt(sx * sx + sy * sy)
			local along = clamp(onScreen / max(sp, 0.1), 0, 1) -- (how side-on we see the drift)
			local stretch = 1.6 + clamp(sp / 8, 0, 1.8) * along
			local size = f.size * (0.7 + 0.5 * f.a) * (1 + min(f.age / 300, 0.8))
			local tilt = 0
			if onScreen > 0.5 then
				tilt = -math.deg(math.atan2(sy, sx))
				tilt = (tilt + 90) % 180 - 90 -- (-90..90)
				tilt = clamp(tilt, -18, 18)
			end
			f.rot += (tilt - f.rot) * (1 - exp(-dt / 2))
			-- (about its storm's centre at the storm's scale)
			local sc = centres[f.storm]
			if sc then
				f.cx, f.cy, f.sk = sc.x, sc.y, sc.k
			elseif not f.sk then
				f.sk = C.scaleAbout(f.cx, f.cy)
			end
			local k = f.sk
			local wp = C.toWorldAbout(f.x, f.y, f.z, f.cx, f.cy, k)
			local sw, sh = size * stretch * k, size * 0.32 * k
			-- on screen? (a cone round the view, widened by the wisp's own angular size)
			local rel = wp - camS
			local dist = rel.Magnitude
			local vis = dist <= sw
			if not vis then
				local ang = math.acos(clamp(rel:Dot(look) / dist, -1, 1))
				vis = ang < halfDiag + math.asin(min(1, 0.6 * sw / dist))
			end
			local thr = pxK * dist -- (studs: half a pixel there)
			-- (only changes that show are written; a wisp off screen keeps only its position
			-- roughly current, every 8th frame)
			if f.wp == nil or vis or (tick + f.k) % CULL_REFRESH == 0 then
				local last = f.wp
				if last == nil or (wp - last).Magnitude > thr then
					f.wp = wp
					f.att.WorldPosition = wp
				end
			end
			if vis or f.sw0 == nil then
				if f.sw0 == nil or math.abs(sw - f.sw0) > thr or math.abs(sh - f.sh0) > thr then
					f.sw0, f.sh0 = sw, sh
					f.bb.Size = UDim2.fromScale(sw, sh)
				end
				-- (a turn shows as the card's tip moving: half a pixel at its half-length)
				local rotThr = math.deg(0.5 / max(1, 0.5 * sw / max(dist, 1) * pxR))
				if f.rot0 == nil or math.abs(f.rot - f.rot0) > rotThr then
					f.rot0 = f.rot
					f.img.Rotation = f.rot
				end
				-- part of the cloud: lit as the lowering it hangs from (the colour its cards were
				-- shaded with) more than by the light at the fragment
				local base = ctx.stormBase and ctx.stormBase[f.storm]
				local col = lightCache[f.storm] and lightCache[f.storm].col or Color3.new(0.45, 0.48, 0.53)
				if base then
					col = col:Lerp(base.col, 0.85)
				end
				col = col:Lerp(fogCol, f.fog)
				local pc = f.col0
				if not pc or math.abs(col.R - pc.R) > 0.002 or math.abs(col.G - pc.G) > 0.002 or math.abs(col.B - pc.B) > 0.002 then
					f.col0 = col
					f.img.ImageColor3 = col
				end
				local tr = 1 - clamp(f.a * 0.6, 0, 0.6)
				if math.abs(tr - (f.tr or 2)) > 0.002 then
					f.tr = tr
					f.img.ImageTransparency = tr
				end
			end
		end

		if t0 - statAt > 0.5 then
			statAt = t0
			ctx.root:SetAttribute("Scud", string.format("%d fragments · %.2f ms", n, (os.clock() - t0) * 1000))
		end
	end

	function self:destroy()
		anchor:Destroy()
	end

	return self
end

return Scud
