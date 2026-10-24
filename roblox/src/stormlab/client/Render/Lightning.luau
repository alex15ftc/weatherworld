--!nonstrict
-- Lightning, its light and its thunder (guide section 15). The flashes themselves come from the
-- simulation (shared/Sim/Lightning.step, rates from each storm's updraft volume, Poisson in time,
-- placed in the storm's charge regions; delivered here through ctx.signals.flash), so they
-- cluster where storms are active and are irregular in time. This module only draws them.
--
--   Channel   Lightning.channel(f): the same seeded branching channel on every client. Drawn
--             with pooled Neon blocks along its segments, each at least ~1 pixel wide at its
--             distance (main channel wider than branches), fading with distance (haze).
--   Timing    CG: 2-4 return strokes (from the flash seed; more for strong currents), each a
--             bright pulse with faint continuing current between, 0.2-0.45 s in all. +CG: one
--             long stroke with long continuing current. IC: the channel stays mostly hidden in
--             cloud: a few dim flickers of the channel and a diffuse glow inside the cloud.
--   Light     a scene flash (a ColorCorrectionEffect of our own, "StormLabLightning",
--             Brightness pulse) scaled by the current and 1 / (1 + (d / 5 km)^2), stronger in
--             darkness; IC flashes give a softer, cloud-diffused pulse. For strikes within 3 km,
--             a pooled PointLight near the camera on the side of the strike lights the
--             surroundings from the right direction (PointLight range is at most 60 studs, so
--             a light at the channel itself would light nothing that's seen).
--   Thunder   heard from the nearest point of the channel at distance / 343 m/s of simulation
--             time after the flash, rumbling for (farthest - nearest) / 343 s; volume falls with
--             distance (inaudible beyond ~25 km), duller and slower when far.
--             LabConfig.SOUNDS.thunderNear / thunderFar; empty ids stay silent but keep the
--             timing, and ctx.root gets the attributes LastThunderIn (real seconds until the
--             thunder of the latest flash), LastThunderDistance (m) and ThunderPending.
--   Far       every channel vertex farther than LabConfig.LIMITS.farDraw is pulled along its
--             line of sight to that distance (widths scaled alike): the same angular shape and
--             size, within Roblox's part draw range. Shared vertices stay shared, so the
--             channel stays connected.
--
-- Cost: everything pooled in new() (600 segment parts, 6 glows, 2 lights, 6 sounds); a flash
-- moves its parts once with BulkMoveTo; per frame only the transparency of live bolts changes
-- (quantized, so not every frame). At most 6 bolts at once.
local Lighting = game:GetService("Lighting")
local Util = require(script.Parent:WaitForChild("FxParts"):WaitForChild("Util"))

local LightningFx = {}

local MAX_BOLTS = 6
local SEG_POOL = 600
local SEG_PER_BOLT = 140
local PARK = CFrame.new(0, -1e5, 0)
local BOLT_COLOUR = Color3.fromRGB(226, 222, 255)
local GLOW_COLOUR = Color3.fromRGB(196, 190, 236)
local PIXEL = 0.0011 -- ~one pixel (rad) at 1080p and a 70 degree field of view

function LightningFx.new(ctx)
	local self = {}
	local Sim = ctx.Sim
	local Lightning = Sim.Lightning
	local Noise = Sim.Noise
	local Config = ctx.Config
	local SOUND_SPEED = Lightning.SOUND_SPEED or 343
	local FAR = (Config.LIMITS and Config.LIMITS.farDraw) or 4500
	local SOUNDS = Config.SOUNDS or {}

	local folder = Instance.new("Folder")
	folder.Name = "Lightning"
	folder.Parent = ctx.root

	-- pools
	local freeSegs: { BasePart } = {}
	for i = 1, SEG_POOL do
		local p = Util.part({ Material = Enum.Material.Neon, Color = BOLT_COLOUR, Transparency = 1, Size = Vector3.new(1, 1, 1), Name = "Seg" })
		p.CFrame = PARK
		p.Parent = folder
		freeSegs[i] = p
	end
	local freeGlows: { BasePart } = {}
	for i = 1, MAX_BOLTS do
		local g = Util.part({ Material = Enum.Material.Neon, Color = GLOW_COLOUR, Transparency = 1, Shape = Enum.PartType.Ball, Size = Vector3.new(10, 10, 10), Name = "Glow" })
		g.CFrame = PARK
		g.Parent = folder
		freeGlows[i] = g
	end
	local freeLights: { { part: BasePart, light: PointLight } } = {}
	for i = 1, 2 do
		local holder = Util.part({ Transparency = 1, Size = Vector3.new(0.2, 0.2, 0.2), Name = "FlashLight" })
		local light = Instance.new("PointLight")
		light.Range = 60
		light.Brightness = 0
		light.Color = BOLT_COLOUR
		light.Shadows = false
		light.Enabled = false
		light.Parent = holder
		holder.CFrame = PARK
		holder.Parent = folder
		freeLights[i] = { part = holder, light = light }
	end
	local sounds: { { sound: Sound, eq: EqualizerSoundEffect } } = {}
	local haveSound = (SOUNDS.thunderNear or "") ~= "" or (SOUNDS.thunderFar or "") ~= ""
	if haveSound then
		for i = 1, 6 do
			local s = Instance.new("Sound")
			s.Name = "Thunder"
			s.Volume = 0
			local eq = Instance.new("EqualizerSoundEffect")
			eq.LowGain, eq.MidGain, eq.HighGain = 2, 0, 0
			eq.Parent = s
			s.Parent = folder -- (not under a part: heard everywhere; the distance is in the volume)
			sounds[i] = { sound = s, eq = eq }
		end
	end
	local soundNext = 1
	local flashFx = Util.colorEffect("StormLabLightning")
	flashFx.Brightness = 0
	flashFx.Contrast = 0
	flashFx.Saturation = 0

	local pending = {} -- flashes waiting for their time
	local bolts = {} -- live bolts
	local thunders = {} -- thunder waiting to be heard

	-- the stroke timeline (real seconds) of a flash: a list of { t0, t1, peak, tail }
	local function timeline(f): ({ { number } }, number)
		local rng = Noise.rng((f.seed or 1) + 17)
		local out = {}
		local t = 0
		if f.kind == "cg" then
			local n = 2 + math.floor(rng:next() * 2.999) + (if (f.current or 0) > 40 and rng:next() < 0.5 then 1 else 0)
			n = math.min(n, 4)
			for k = 1, n do
				local on = 0.03 + rng:next() * 0.04
				local peak = if k == 1 then 1 else 0.6 + 0.4 * rng:next()
				local tail = if k == n then 0.2 + 0.3 * rng:next() else 0.12
				table.insert(out, { t, t + on, peak, tail })
				t += on + (if k < n then 0.03 + rng:next() * 0.07 else 0.08)
			end
		elseif f.kind == "+cg" then
			table.insert(out, { 0, 0.09, 1, 0.65 })
			t = 0.09 + 0.18 + rng:next() * 0.12
		else
			local n = 2 + math.floor(rng:next() * 4)
			for _ = 1, n do
				local on = 0.025 + rng:next() * 0.04
				table.insert(out, { t, t + on, 0.35 + 0.5 * rng:next(), 0.15 })
				t += on + 0.02 + rng:next() * 0.07
			end
		end
		return out, math.min(t + 0.06, 0.6)
	end

	-- the light level of a timeline at time t (0..1)
	local function levelAt(tl: { { number } }, t: number): number
		local lvl = 0
		for i, s in tl do
			if t >= s[1] and t < s[2] then
				lvl = math.max(lvl, s[3])
			elseif t >= s[2] then
				local nextStart = if tl[i + 1] then tl[i + 1][1] else math.huge
				if t < nextStart then
					-- the continuing current after a stroke, fading
					lvl = math.max(lvl, s[3] * s[4] * math.exp(-(t - s[2]) / 0.06))
				end
			end
		end
		return lvl
	end

	local function release(b)
		for _, p in b.parts do
			p.Transparency = 1
			p.CFrame = PARK
			table.insert(freeSegs, p)
		end
		if b.glow then
			b.glow.Transparency = 1
			b.glow.CFrame = PARK
			table.insert(freeGlows, b.glow)
		end
		if b.light then
			b.light.light.Enabled = false
			b.light.part.CFrame = PARK
			table.insert(freeLights, b.light)
		end
	end

	local function startBolt(f)
		if #bolts >= MAX_BOLTS or #freeSegs < 10 then
			return
		end
		-- its light, as a field other renderers (funnel, clouds, dust) sample locally
		if ctx.flashField then
			ctx.Tornado.FlashField.add(ctx.flashField, f, os.clock())
		end
		local camPos = ctx.camera.CFrame.Position
		local cx, cy, cz = ctx:simCamera()
		-- distance to the flash's middle sets the channel's detail
		local mx, my, mz = (f.x0 + f.x1) / 2, (f.y0 + f.y1) / 2, (f.z0 + f.z1) / 2
		local dMid = math.sqrt((mx - cx) ^ 2 + (my - cy) ^ 2 + (mz - cz) ^ 2)
		local detail = if dMid < 10000 then 6 elseif dMid < 30000 then 5 else 4
		if f.kind == "ic" then
			detail = math.min(detail, 5)
		end
		local segs = Lightning.channel(f, detail)
		local cap = math.min(SEG_PER_BOLT, #freeSegs)
		if #segs > cap then
			table.sort(segs, function(a, b)
				return a[7] > b[7]
			end)
		end

		-- thunder distances from the whole channel
		local dMin, dMax = math.huge, 0
		local nearX, nearY, nearZ = f.x1, f.y1, f.z1
		local function project(x: number, y: number, z: number): (Vector3, number, number)
			local P = Config.toWorld(x, y, z)
			local off = P - camPos
			local d = off.Magnitude
			if d > FAR then
				return camPos + off * (FAR / d), d, FAR / d
			end
			return P, d, 1
		end
		local parts, cfs = {}, {}
		local widths = {}
		for i, s in segs do
			local x0, y0, z0, x1, y1, z1, w = s[1], s[2], s[3], s[4], s[5], s[6], s[7]
			local a, da = project(x0, y0, z0)
			local b, db = project(x1, y1, z1)
			if da < dMin then
				dMin, nearX, nearY, nearZ = da, x0, y0, z0
			end
			if db < dMin then
				dMin, nearX, nearY, nearZ = db, x1, y1, z1
			end
			dMax = math.max(dMax, da, db)
			if i <= cap then
				local dm = (da + db) / 2
				local scale = if dm > FAR then FAR / dm else 1
				local wTrue = math.max(w * 1.2, dm * PIXEL * (0.5 + 0.7 * w))
				local len = (b - a).Magnitude
				if len > 0.01 then
					local p = table.remove(freeSegs) :: BasePart
					p.Size = Vector3.new(math.min(2048, wTrue * scale), math.min(2048, wTrue * scale), math.min(2048, len))
					table.insert(parts, p)
					table.insert(cfs, CFrame.lookAt((a + b) / 2, b))
					-- haze: far channels fade (the Atmosphere only sees their draw distance)
					table.insert(widths, (if w >= 0.99 then 1 else 0.75) * (1 - 0.65 * Util.ramp(dm, 8000, 60000)))
				end
			end
		end
		if #parts > 0 then
			workspace:BulkMoveTo(parts, cfs, Enum.BulkMoveMode.FireCFrameChanged)
		end
		local tl, life = timeline(f)
		local cur = math.clamp((f.current or 25) / 25, 0.6, 2.5) ^ 0.5
		local isIc = f.kind == "ic"
		local b = {
			parts = parts, vis = widths, tl = tl, life = life, start = os.clock(),
			ic = isIc, shown = -1,
			flash = (if isIc then 0.16 else 0.32 * cur) / (1 + (dMin / 5000) ^ 2),
		}
		-- the glow inside the cloud (IC: the channel's middle; CG: its top, where it leaves the cloud)
		local gx, gy, gz = if isIc then mx else f.x0, if isIc then my else f.y0, if isIc then mz else f.z0
		local gp, gd, gs = project(gx, gy, gz)
		local gSize = (if isIc then 3500 else 2200)
		if gd > gSize * 0.8 and #freeGlows > 0 then
			local g = table.remove(freeGlows) :: BasePart
			local size = math.min(2048, gSize * gs)
			g.Size = Vector3.new(size, size * 0.6, size)
			g.CFrame = CFrame.new(gp)
			b.glow = g
			b.glowVis = (if isIc then 0.32 else 0.18) * (1 - 0.7 * Util.ramp(gd, 10000, 60000))
		end
		-- the light near the camera for close strikes
		if not isIc and dMin < 3000 and #freeLights > 0 then
			local L = table.remove(freeLights)
			local np = Config.toWorld(nearX, nearY, nearZ)
			local dir = np - camPos
			dir = if dir.Magnitude > 1e-3 then dir.Unit else Vector3.new(0, 1, 0)
			L.part.CFrame = CFrame.new(camPos + dir * 40 + Vector3.new(0, 25, 0))
			L.light.Brightness = 0
			L.light.Enabled = true
			b.light = L
			b.lightK = 10 * (1 - Util.ramp(dMin, 300, 3000))
		end
		table.insert(bolts, b)

		-- thunder
		if dMin < 25000 then
			local delay = dMin / SOUND_SPEED
			table.insert(thunders, { at = (f.t or ctx:simTime()) + delay, dur = math.max(0.5, (dMax - dMin) / SOUND_SPEED), dist = dMin, cg = not isIc })
			if #thunders > 24 then
				table.remove(thunders, 1)
			end
			ctx.root:SetAttribute("LastThunderIn", delay / math.max(0.01, ctx.state.timeScale or 1))
			ctx.root:SetAttribute("LastThunderDistance", math.floor(dMin + 0.5))
			ctx.root:SetAttribute("ThunderPending", #thunders)
		end
	end

	local function hear(th)
		ctx.root:SetAttribute("ThunderPending", #thunders)
		if not haveSound then
			return
		end
		local d = th.dist
		local id = if d < 3000 and (SOUNDS.thunderNear or "") ~= "" then SOUNDS.thunderNear else SOUNDS.thunderFar
		if id == nil or id == "" then
			id = SOUNDS.thunderNear
		end
		if id == nil or id == "" then
			return
		end
		local slot = sounds[soundNext]
		soundNext = soundNext % #sounds + 1
		local s = slot.sound
		s:Stop()
		s.SoundId = id
		s.Volume = math.clamp((1500 / (d + 1500)) ^ 0.7, 0.04, 1) * (1 - Util.ramp(d, 15000, 25000)) * (if th.cg then 1 else 0.7)
		-- far thunder is a low, long rumble: slower playback, no crack
		s.PlaybackSpeed = 1 - 0.3 * Util.ramp(d, 2000, 15000) - 0.1 * Util.ramp(th.dur, 5, 30)
		slot.eq.HighGain = -30 * Util.ramp(d, 1000, 10000)
		slot.eq.MidGain = -8 * Util.ramp(d, 3000, 15000)
		s:Play()
	end

	local conn = ctx.signals.flash:Connect(function(f)
		if type(f) ~= "table" then
			return
		end
		local list = if f[1] then f else { f }
		for _, one in list do
			if one.x0 and one.x1 then
				table.insert(pending, one)
			end
		end
		while #pending > 32 do
			table.remove(pending, 1)
		end
	end)

	local wasOn = true
	function self:update(dt: number)
		local on = ctx.state.show.lightning ~= false
		if not on then
			if wasOn then
				wasOn = false
				for _, b in bolts do
					release(b)
				end
				table.clear(bolts)
				table.clear(pending)
				table.clear(thunders)
				flashFx.Brightness = 0
				ctx.root:SetAttribute("ThunderPending", 0)
			end
			return
		end
		wasOn = true
		local now = ctx:simTime()
		local scale = math.max(0.05, ctx.state.timeScale or 1)

		-- flashes whose time has come (stale ones dropped; ones far "ahead" of a lagging client
		-- clock shown now)
		local i = 1
		while i <= #pending do
			local f = pending[i]
			local t = f.t or now
			if t <= now or (t - now) / scale > 2 then
				table.remove(pending, i)
				if (now - t) / scale < 2 then
					startBolt(f)
				end
			else
				i += 1
			end
		end

		-- live bolts
		local clock = os.clock()
		local flash = 0
		local j = 1
		while j <= #bolts do
			local b = bolts[j]
			local age = clock - b.start
			if age > b.life then
				release(b)
				table.remove(bolts, j)
			else
				local lvl = levelAt(b.tl, age)
				local q = math.floor(lvl * 12 + 0.5)
				if q ~= b.shown then
					b.shown = q
					local l = q / 12
					local k = if b.ic then 0.35 else 1
					for n, p in b.parts do
						p.Transparency = 1 - math.clamp(l * k * b.vis[n], 0, 1)
					end
					if b.glow then
						b.glow.Transparency = 1 - l * b.glowVis
					end
				end
				if b.light then
					b.light.light.Brightness = b.lightK * lvl
				end
				flash += b.flash * lvl
				j += 1
			end
		end
		-- the scene response is local: only the light reaching the camera's surroundings, small
		-- and capped (the flash field adds overlapping flashes softly) - never a daylight pulse.
		-- Clouds, funnel and dust take their own local flash light from the field.
		local camFlash = 0
		if ctx.flashField then
			local cx, cy, cz = ctx:simCamera()
			camFlash = ctx.Tornado.FlashField.camera(ctx.flashField, cx, cy, cz)
		end
		flashFx.Brightness = math.clamp(0.12 * camFlash, 0, 0.15)
		local _ = flash

		-- thunder
		local k = 1
		while k <= #thunders do
			local th = thunders[k]
			if now >= th.at then
				table.remove(thunders, k)
				hear(th)
			else
				k += 1
			end
		end
	end

	function self:destroy()
		conn.Disconnect()
		for _, b in bolts do
			release(b)
		end
		flashFx:Destroy()
		folder:Destroy()
		for _, name in { "LastThunderIn", "LastThunderDistance", "ThunderPending" } do
			ctx.root:SetAttribute(name, nil)
		end
	end

	return self
end

return LightningFx
