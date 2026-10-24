--!nonstrict
--!native
-- Rain and hail round the camera, and how far one sees (guide section 15: rain from the
-- precipitation field with detailed streaks near players; hail impacts; visibility reduced by
-- rain, hail and dust). Nothing is keyed on a storm's type: everything comes from the fields at
-- the camera's simulation position.
--
--   Rain      Precip.surface(cw.vol, x, y): the surface rain rate (mm/h), bilinear between the
--             1 km cells, faded out as the camera climbs above ~1.5 km (looking down on the
--             storm, not standing in it). Drawn as curtains of the near-rain streak tile on
--             camera-facing parts in three rings (9, 24, 60 m); opacity and how many curtains
--             show grow with the rate. The streaks lean with the air relative to the camera:
--             cw:windAt(camera, ~10 m) (the full simulated wind, cold-pool outflow and tornado
--             included) minus the camera's own motion, against the drops' fall speed
--             (5 m/s in drizzle to 9 m/s in heavy rain, larger drops).
--   Splashes  a ParticleEmitter on the ground under the camera (only within 150 m of it).
--   Hail      where the surface hail size exceeds ~0.5 cm: white stones falling at their
--             terminal speed (~9 sqrt(d cm) m/s) along the same relative wind, drawn a few times
--             life size so they read, bouncing off the ground with a short impact sparkle.
--   Seeing    extinction (1/km) adds: rain 0.33 R^0.66 (R mm/h: ~12 km in 1 mm/h, ~1 km in
--             50 mm/h, ~500 m in 100 mm/h), hail ~0.8 per cm while it falls, tornado debris
--             (each cw.tornadoes[i]: debrisLoft, within ~3 rc + 150 m, below debrisTop) and
--             outflow dust (wind over 14 m/s on dry ground, none where it rains).
--
-- Atmosphere ownership: Render/Sky is the ONLY writer of Lighting.Atmosphere. This module
-- publishes, on ctx.root, the attributes
--   PrecipExtinction  (1/stud, smoothed)  extinction to add to the clear air
--   PrecipDust        (0..1)  the share of it that is dust (Sky tints toward brown)
--   PrecipDensity     (0..1)  the same as an Atmosphere density (for reading / debugging)
--   PrecipRain (mm/h), PrecipHail (cm)    what the camera stands in (debugging)
-- and Sky folds PrecipExtinction into Atmosphere.Density.
--
-- Cost: ~24 textured parts moved with one BulkMoveTo and 4 emitters' properties per frame; the
-- field and the wind are sampled at 10 Hz, the ground ray at 4 Hz; nothing is created after new().
local Util = require(script.Parent:WaitForChild("FxParts"):WaitForChild("Util"))

local NearPrecip = {}

local TAU = 2 * math.pi
local VOX = 1000 -- the precipitation volume's cell (Precip.luau)
local RINGS = {
	{ radius = 9, count = 6, height = 36, tileW = 6, tileH = 26, weight = 1 },
	{ radius = 24, count = 8, height = 84, tileW = 14, tileH = 60, weight = 0.85 },
	{ radius = 60, count = 10, height = 190, tileW = 32, tileH = 130, weight = 0.7 },
}
local MAX_SHEET_OPACITY = 0.06 -- (rain reads as lost visibility - Atmosphere + the cards' rain fog - not as drawn streaks; the sheets are only a faint hint of motion)
local RAIN_COLOUR = Color3.fromRGB(172, 178, 188)
local HAIL_COLOUR = Color3.fromRGB(236, 240, 246)
local SPLASH_RANGE = 150 -- studs above the ground; splashes and bounces only below this
local HAIL_SKY = 45 -- the hail emitter's height over the camera
local SPARKLE = "rbxasset://textures/particles/sparkles_main.dds" -- engine content, not an upload

function NearPrecip.new(ctx)
	local self = {}
	local cw = ctx.cw
	local Precip = ctx.Sim.Precip
	local T = ctx.Config.TEXTURES
	local streakTex = T.nearRain or T.rainShaft
	local hailTex = T.hailstone or T.mediumFlat or T.softFlat
	local splashTex = T.softFlat

	local folder = Instance.new("Folder")
	folder.Name = "NearPrecip"
	folder.Parent = ctx.root

	-- the curtains
	local sheets = {}
	local sheetParts: { BasePart } = {}
	local sheetCFrames: { CFrame } = {}
	for r, ring in RINGS do
		local width = TAU * ring.radius / ring.count * 1.5 -- (overlapping: the tile fades at its sides)
		for i = 1, ring.count do
			local part = Util.part({ Transparency = 1, Size = Vector3.new(width, ring.height, 0.05), Name = "Rain" .. r .. "_" .. i })
			local tex = Instance.new("Texture")
			tex.Face = Enum.NormalId.Front
			tex.Texture = streakTex
			tex.StudsPerTileU = ring.tileW
			tex.StudsPerTileV = ring.tileH
			tex.Color3 = RAIN_COLOUR
			tex.Transparency = 1
			tex.OffsetStudsU = (i * 0.618 % 1) * ring.tileW
			tex.Parent = part
			part.CFrame = CFrame.new(0, -1e5, 0)
			part.Parent = folder
			-- golden-angle order: the first k sheets of a ring are always spread round it
			table.insert(sheets, {
				part = part, tex = tex, ring = ring, order = i,
				angle = ((i - 1) * 2.39996 + r * 0.7) % TAU,
				scroll = math.random() * ring.tileH, shown = -1,
			})
		end
	end

	-- ground effects: splashes, hail bounces and sparkles on a flat part under the camera
	local groundPart = Util.part({ Transparency = 1, Size = Vector3.new(120, 0.2, 120), Name = "PrecipGround" })
	local function emitter(parent: Instance, texture: string): ParticleEmitter
		local e = Instance.new("ParticleEmitter")
		e.Texture = texture
		e.Rate = 0
		e.Enabled = false
		e.LightInfluence = 1
		e.Rotation = NumberRange.new(-180, 180)
		e.Parent = parent
		return e
	end
	local splash = emitter(groundPart, splashTex)
	splash.EmissionDirection = Enum.NormalId.Top
	splash.Speed = NumberRange.new(0)
	splash.Lifetime = NumberRange.new(0.1, 0.2)
	splash.Size = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0.2), NumberSequenceKeypoint.new(1, 0.6) })
	splash.Transparency = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0.5), NumberSequenceKeypoint.new(1, 1) })
	splash.Color = ColorSequence.new(HAIL_COLOUR) -- (one colour with the hail: overlapping layers of different colours flicker)
	splash.Orientation = Enum.ParticleOrientation.FacingCameraWorldUp
	splash.Squash = NumberSequence.new(-0.4)

	local bounce = emitter(groundPart, hailTex)
	bounce.EmissionDirection = Enum.NormalId.Top
	bounce.Speed = NumberRange.new(3, 8)
	bounce.SpreadAngle = Vector2.new(60, 60)
	bounce.Acceleration = Vector3.new(0, -30, 0)
	bounce.Drag = 1
	bounce.Lifetime = NumberRange.new(0.3, 0.6)
	bounce.RotSpeed = NumberRange.new(-400, 400)
	bounce.Color = ColorSequence.new(HAIL_COLOUR)

	local sparkle = emitter(groundPart, SPARKLE)
	sparkle.EmissionDirection = Enum.NormalId.Top
	sparkle.Speed = NumberRange.new(0.5, 2)
	sparkle.Lifetime = NumberRange.new(0.05, 0.12)
	sparkle.LightEmission = 1
	sparkle.LightInfluence = 0
	sparkle.Color = ColorSequence.new(HAIL_COLOUR)
	sparkle.Transparency = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0.3), NumberSequenceKeypoint.new(1, 1) })
	groundPart.CFrame = CFrame.new(0, -1e5, 0)
	groundPart.Parent = folder

	local skyPart = Util.part({ Transparency = 1, Size = Vector3.new(90, 0.2, 90), Name = "HailSky" })
	local hail = emitter(skyPart, hailTex)
	hail.EmissionDirection = Enum.NormalId.Bottom
	hail.RotSpeed = NumberRange.new(-250, 250)
	hail.Color = ColorSequence.new(HAIL_COLOUR)
	hail.Acceleration = Vector3.zero
	skyPart.CFrame = CFrame.new(0, -1e5, 0)
	skyPart.Parent = folder

	-- smoothed state
	local st = {
		rain = 0, hail = 0, ext = 0, dust = 0, -- smoothed
		tRain = 0, tHail = 0, tExt = 0, tDust = 0, -- targets (10 Hz)
		wu = 0, wv = 0, -- air relative to the camera (sim, m/s), smoothed
		au = 0, av = 0, -- wind (sim) last sampled
		vx = 0, vy = 0, -- camera velocity (sim, m/s), smoothed
		groundY = 0,
		sampleAt = -1, rayAt = -1, clock = 0,
		lastPos = nil :: Vector3?,
		hailOn = false, splashOn = false,
		published = -1,
	}

	-- surface rain and hail, bilinear between the cell centres
	local function surface(x: number, y: number): (number, number)
		local vol = cw.vol
		if not vol or not vol.nxv then
			return 0, 0
		end
		local gx = (x - vol.x0) / VOX - 0.5
		local gy = (y - vol.x0) / VOX - 0.5
		local ix, iy = math.floor(gx), math.floor(gy)
		local fx, fy = gx - ix, gy - iy
		local r, h = 0, 0
		for a = 0, 1 do
			for b = 0, 1 do
				local w = (if a == 1 then fx else 1 - fx) * (if b == 1 then fy else 1 - fy)
				if w > 0 then
					local rr, hh = Precip.surface(vol, vol.x0 + (ix + a + 0.5) * VOX, vol.x0 + (iy + b + 0.5) * VOX)
					r += (rr or 0) * w
					h = math.max(h, (hh or 0) * math.min(1, w * 2.5)) -- (hail: no smearing of the stones' size)
				end
			end
		end
		return r, h
	end

	-- the 10 Hz sample: rain, hail, wind and extinction at the camera
	local function sample(cx: number, cy: number, cz: number, aboveGround: number)
		local show = ctx.state.show.rain ~= false
		local rain, hailCm = 0, 0
		if show then
			rain, hailCm = surface(cx, cy)
		end
		-- high above the base one looks down on the storm instead of standing in its rain
		local aloft = 1 - Util.ramp(cz, 1500, 2500)
		rain *= aloft
		hailCm = if aloft > 0.3 then hailCm else 0

		-- the wind ~10 m above the ground under the camera (or at the camera, up to 300 m)
		local wz = math.clamp(aboveGround, 10, 300)
		local u, v = 0, 0
		if cw.windAt and cw.env then
			local ok, a, b = pcall(cw.windAt, cw, cx, cy, wz)
			if ok and a == a and b == b then
				u, v = a, b
			end
		end
		st.au, st.av = u, v

		-- extinction (1/km)
		local ext, dust = 0, 0
		if rain > 0.05 then
			ext += 0.33 * rain ^ 0.66
		end
		if hailCm > 0.3 then
			ext += 0.8 * hailCm * math.min(1, rain / 10 + 0.3)
		end
		if show then
			for _, t in cw.tornadoes do
				if not t.ended and (t.debrisLoft or 0) > 0.01 then
					local dx, dy = cx - t.x, cy - t.y
					local rd = 3 * (t.rc or 50) + 150
					local d2 = (dx * dx + dy * dy) / (rd * rd)
					if d2 < 9 then
						local top = math.max(100, t.debrisTop or 300)
						dust += 18 * t.debrisLoft * math.exp(-d2) * (1 - Util.ramp(cz, top * 0.7, top * 1.3))
					end
				end
			end
			-- outflow dust: strong surface wind over ground that isn't wet
			local speed = math.sqrt(u * u + v * v)
			local lift = Util.ramp(speed, 14, 30)
			dust += 1.2 * lift * lift * (1 - Util.ramp(rain, 0.5, 5)) * (1 - Util.ramp(aboveGround, 150, 400))
		end
		ext += dust
		st.tRain, st.tHail = rain, hailCm
		st.tExt = ext
		st.tDust = if ext > 0 then dust / ext else 0
	end

	function self:update(dt: number)
		dt = math.clamp(dt, 0, 0.25)
		st.clock += dt
		local camPos = ctx.camera.CFrame.Position
		local cx, cy, cz = ctx:simCamera()

		-- the camera's own motion (teleports ignored)
		if st.lastPos and dt > 0 then
			local d = (camPos - st.lastPos) / dt
			if d.Magnitude < 200 then
				local k = Util.ease(dt, 0.3)
				st.vx += (d.X - st.vx) * k
				st.vy += (-d.Z - st.vy) * k
			end
		end
		st.lastPos = camPos

		if st.clock - st.rayAt > 0.25 then
			st.rayAt = st.clock
			st.groundY = Util.groundY(ctx.root, camPos)
		end
		local above = math.max(0, camPos.Y - st.groundY)
		if st.clock - st.sampleAt > 0.1 then
			st.sampleAt = st.clock
			sample(cx, cy, cz, above)
		end

		-- ease (rain arrives over a second or two, not in 1 km steps)
		local k = Util.ease(dt, 1.5)
		st.rain += (st.tRain - st.rain) * k
		st.hail += (st.tHail - st.hail) * Util.ease(dt, 1.0)
		st.ext += (st.tExt - st.ext) * Util.ease(dt, 2.0)
		st.dust += (st.tDust - st.dust) * k
		local kw = Util.ease(dt, 0.5)
		st.wu += ((st.au - st.vx) - st.wu) * kw
		st.wv += ((st.av - st.vy) - st.wv) * kw

		-- publish for Render/Sky (only when it changes noticeably)
		local kStud = st.ext / 1000
		local key = math.floor(st.ext * 200 + 0.5) + math.floor(st.dust * 20 + 0.5) * 1e6
		if key ~= st.published then
			st.published = key
			ctx.root:SetAttribute("PrecipExtinction", kStud)
			ctx.root:SetAttribute("PrecipDust", st.dust)
			ctx.root:SetAttribute("PrecipDensity", math.clamp(Util.densityForExtinction(kStud), 0, 1))
			ctx.root:SetAttribute("PrecipRain", math.floor(st.rain * 10 + 0.5) / 10)
			ctx.root:SetAttribute("PrecipHail", math.floor(st.hail * 10 + 0.5) / 10)
		end

		-- the curtains
		local R = st.rain
		local heavy = math.clamp(math.log(1 + R) / math.log(101), 0, 1)
		local fall = 5 + 4 * heavy
		local relW = ctx.Config.dirWorld(st.wu, st.wv)
		local density = 0.35 + 0.65 * heavy
		local n = 0
		for _, sh in sheets do
			local ring = sh.ring
			local w = math.clamp(density * ring.count - (sh.order - 1), 0, 1)
			local a = MAX_SHEET_OPACITY * heavy ^ 0.8 * ring.weight * w
			if R < 0.05 then
				a = 0
			end
			local shown = math.floor(a * 200 + 0.5)
			if shown ~= sh.shown then
				sh.shown = shown
				sh.tex.Transparency = 1 - shown / 200
			end
			if shown > 0 then
				local p = camPos + Vector3.new(math.cos(sh.angle) * ring.radius, ring.height / 2 - 8, math.sin(sh.angle) * ring.radius)
				local toCam = Vector3.new(camPos.X - p.X, 0, camPos.Z - p.Z)
				local cf = CFrame.lookAt(p, p + toCam)
				-- lean the streaks with the air across the line of sight
				local across = relW:Dot(cf.RightVector)
				local roll = math.clamp(math.atan2(across, fall), -1.05, 1.05)
				cf *= CFrame.Angles(0, 0, roll)
				local speed = math.sqrt(fall * fall + across * across)
				sh.scroll = (sh.scroll - speed * dt) % ring.tileH
				sh.tex.OffsetStudsV = sh.scroll -- (decreasing: the streaks move down the face)
				n += 1
				sheetParts[n] = sh.part
				sheetCFrames[n] = cf
			end
		end
		for i = n + 1, #sheetParts do
			sheetParts[i] = nil
			sheetCFrames[i] = nil
		end
		if n > 0 then
			workspace:BulkMoveTo(sheetParts, sheetCFrames, Enum.BulkMoveMode.FireCFrameChanged)
		end

		-- splashes and hail
		local nearGround = above < SPLASH_RANGE
		local groundPos = Vector3.new(camPos.X, st.groundY + 0.15, camPos.Z)
		local splashRate = if nearGround and R > 0.3 then 900 * heavy ^ 1.5 else 0
		local hailK = Util.ramp(st.hail, 0.4, 0.7)
		local hailOn = hailK > 0
		if nearGround or st.splashOn then
			groundPart.CFrame = CFrame.new(groundPos)
		end
		splash.Rate = splashRate
		local splashOn = splashRate > 1
		if splashOn ~= st.splashOn then
			st.splashOn = splashOn
			splash.Enabled = splashOn
		end

		if hailOn then
			local cm = st.hail
			local vt = 9 * math.sqrt(cm) -- terminal speed (m/s)
			local dir = Vector3.new(relW.X, -vt, relW.Z)
			local dirU = dir.Unit
			local size = math.clamp(cm * 0.04, 0.06, 0.5) -- a few times life size, so a stone reads
			local rate = (150 + 300 * Util.ramp(cm, 0.5, 4)) * hailK -- (a real core drops several stones per m² per second: as many as the particle budget allows)
			-- the stones start upwind so they arrive round the camera
			local fallTime = (HAIL_SKY + math.min(above, 120)) / vt
			local start = camPos + Vector3.new(0, HAIL_SKY, 0) - Vector3.new(relW.X, 0, relW.Z) * (HAIL_SKY / vt)
			-- the emitter part's bottom face points along the fall
			local look = if math.abs(dirU.Y) < 0.99 then Vector3.new(0, 0, 1) else Vector3.new(1, 0, 0)
			local up = -dirU
			local right = look:Cross(up).Unit
			local back = right:Cross(up).Unit
			skyPart.CFrame = CFrame.fromMatrix(start, right, up, back)
			hail.Speed = NumberRange.new(vt * 0.9, vt * 1.1)
			hail.Lifetime = NumberRange.new(fallTime * 0.95, fallTime * 1.05)
			hail.Size = NumberSequence.new(size)
			hail.Rate = rate
			bounce.Size = NumberSequence.new(size * 0.9)
			bounce.Speed = NumberRange.new(0.2 * vt, 0.45 * vt)
			bounce.Rate = if nearGround then rate * 0.8 else 0
			sparkle.Size = NumberSequence.new(size * 1.6)
			sparkle.Rate = if nearGround then rate * 0.35 else 0
		end
		if hailOn ~= st.hailOn then
			st.hailOn = hailOn
			hail.Enabled = hailOn
			bounce.Enabled = hailOn
			sparkle.Enabled = hailOn
			if not hailOn then
				skyPart.CFrame = CFrame.new(0, -1e5, 0)
			end
		end
	end

	function self:destroy()
		for _, name in { "PrecipExtinction", "PrecipDust", "PrecipDensity", "PrecipRain", "PrecipHail" } do
			ctx.root:SetAttribute(name, nil)
		end
		folder:Destroy()
	end

	return self
end

return NearPrecip
