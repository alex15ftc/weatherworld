--!strict
-- The condensation funnel as one camera-facing ribbon mesh (Ribbon.luau), placed every frame
-- along the funnel's bent axis.
--
-- Why not Beams: Roblox turns each Beam to the camera as a whole, so beams meeting at a bend
-- leave gaps or (overlapped) steps, and a Beam can't show a live texture. The ribbon turns to the
-- camera at every vertex and carries:
--   shape, edge, shading   Ribbon.place (soft edge, sun shading, the band inside the edge)
--   fades                  into the cloud base at the top, in from a lifted bottom; on the
--                          ground the foot goes on below it (the ground hides the bottom edge)
--   streaks                an EditableImage of faint streaks wound round the column, turning at
--                          the air's speed and twisting with height: the rotation cue
--
--   local ribbon = RibbonFunnel.new(workspace); ribbon:apply()   -- apply yields
--   ribbon:setLive(state); RenderStepped: ribbon:update(dt, time)
local Workspace = game:GetService("Workspace")

local Config = require(script.Parent.Config)
local Ribbon = require(script.Parent.Ribbon)
local State = require(script.Parent.State)
local Vortex = require(script.Parent.Vortex)
local StormBase = require(script.Parent.StormBase)
local Lighting = game:GetService("Lighting")

local RibbonFunnel = {}
RibbonFunnel.__index = RibbonFunnel

export type RibbonFunnel = typeof(setmetatable(
	{} :: {
		folder: Folder,
		ribbon: Ribbon.Ribbon?,
		core: Ribbon.Ribbon?, -- an opaque inner core: blocks what's behind (the HDR sun glared through the soft ribbon)
		state: State.State?,
		building: boolean,
		pixels: buffer?,
		streakTable: { number },
		spin: number,
		rise: number, -- studs the condensation has climbed (the texture's upward scroll)
		bakedFor: string?, -- the baked texture on the ribbon now
		drawn: string, -- the settings the texture was drawn with
		uvs: { Vector2 },
		alphaMul: { number },
		drawClock: number,
	},
	RibbonFunnel
))

function RibbonFunnel.new(parent: Instance?): RibbonFunnel
	local folder = Instance.new("Folder")
	folder.Name = "RibbonFunnel"
	folder.Parent = parent or Workspace
	return setmetatable({
		folder = folder, ribbon = nil, core = nil, state = nil, building = false,
		pixels = nil, streakTable = {}, spin = 0, rise = 0, drawClock = 0, drawn = "", uvs = {}, alphaMul = {},
	}, RibbonFunnel)
end

function RibbonFunnel.setLive(self: RibbonFunnel, state: State.State)
	self.state = state
end
RibbonFunnel.setState = RibbonFunnel.setLive

local function clear(self: RibbonFunnel)
	if self.ribbon then
		self.ribbon:destroy()
	end
	if self.core then
		self.core:destroy()
	end
	self.ribbon = nil
	self.core = nil
	self.bakedFor = nil
	self.pixels = nil
end

-- Streak brightness round the column: a table over azimuth, closed on itself.
local function streakTable(waves: number, seed: number): { number }
	local rng = Random.new(seed)
	local list = {}
	local total = 0
	for _ = 1, waves do
		local f = rng:NextInteger(2, 14) -- broad bands only: fine streaks read as stripes
		local amp = 1 / math.sqrt(f)
		total += amp
		table.insert(list, { f, rng:NextNumber(0, 2 * math.pi), amp })
	end
	local N = 1024
	local tab = table.create(N, 0)
	for k = 1, N do
		local phi = (k - 1) / N * 2 * math.pi
		local sum = 0
		for _, w in list do
			sum += w[3] * math.sin(w[1] * phi + w[2])
		end
		tab[k] = sum / total
	end
	return tab
end

-- (Re)build for the current settings. Yields.
function RibbonFunnel.apply(self: RibbonFunnel)
	clear(self)
	local R = Config.ribbonFunnel
	if not R.enabled or self.building then
		return
	end
	self.building = true
	local tex = if R.streaks > 0 then R.textureSize else nil
	self.ribbon = Ribbon.build(self.folder, R.levels, R.columns, R.bounds, "Funnel", tex)
	-- The soft ribbon must be drawn see-through (its feathered edge), so even its middle lets ~2%
	-- through, and the HDR sun behind it glared through. A narrower copy drawn fully opaque sits
	-- just behind its front surface and blocks it; the soft ribbon still draws the edge and texture.
	if R.core > 0 then
		local cols = {}
		for k = 0, 10 do
			table.insert(cols, (-1 + 2 * k / 10) * 0.95) -- short of +-1: the edge ramp ends at 1
		end
		self.core = Ribbon.build(self.folder, R.levels, cols, R.bounds, "FunnelCore", nil)
		if self.core then
			self.core:makeOpaque()
		end
	end
	self.building = false
	if self.ribbon and tex then
		self.pixels = buffer.create(tex.X * tex.Y * 4)
		self.streakTable = streakTable(R.streakWaves, R.streakSeed)
		self.drawn = "" -- draw it on the next update
	end
end

local function smoothstep(a: number, b: number, x: number): number
	local t = math.clamp((x - a) / (b - a), 0, 1)
	return t * t * (3 - 2 * t)
end

-- The cloud's colour. "scene": cloud lit by the scene (the part takes the scene's light, so storm
-- light would tint it), darker where the funnel is wide (optically thick). Waits on the lab's
-- looks carrying their tint in the lighting (A+ plan 5.4): today their tint is in the painted
-- particle colours, so "look" (the funnel colours) keeps the ribbon matching its cloud base.
-- Either way, ground-coloured dust lofted into the lower part, more the stronger the tornado.
local function cloudColour(state: State.State, t: number, r: number): Color3
	local R, F = Config.ribbonFunnel, Config.funnel
	local c: Color3
	if R.colour == "scene" then
		local thick = 1 - R.thickDark * (1 - math.exp(-r / R.thickScale))
		c = Color3.new(R.albedo.R * thick, R.albedo.G * thick, R.albedo.B * thick)
	else
		c = F.colorBottom:Lerp(F.colorTop, t ^ F.colorGamma)
	end
	-- a lifted funnel's underside is in its own shadow
	local bottom = state.bottom or 0
	if bottom > 0.02 then
		local f = math.clamp((t - bottom) / math.max(Config.motion.tipLength, 0.01), 0, 1)
		local k = 1 - R.tipDark * (1 - f) * math.clamp(bottom / 0.1, 0, 1)
		c = Color3.new(c.R * k, c.G * k, c.B * k)
	end
	local dust = (Config.debris.groundDust or Config.groundDust.soil) :: Color3
	local dusty = math.clamp((state.ef - R.dustFromEf) / 3, 0, 1)
	local low = (1 - math.clamp(t / R.dustHeight, 0, 1)) ^ 2
	return c:Lerp(dust, R.dustTake * dusty * low)
end

-- Condensation noise: a table that tiles round the column (NA, azimuth) and up it (NV), made of
-- random waves with whole-number frequencies, larger waves stronger (a soft, cloudy field).
local NA, NV = 128, 256
local noiseTable: { number }? = nil
local function condensationNoise(): { number }
	if noiseTable then
		return noiseTable
	end
	local rng = Random.new(97)
	local waves = {}
	for _ = 1, 28 do
		local fa = rng:NextInteger(1, 12)
		local fv = rng:NextInteger(1, 24)
		local amp = 1 / (fa * fa + 0.25 * fv * fv) ^ 0.6
		table.insert(waves, { fa * 2 * math.pi / NA, fv * 2 * math.pi / NV, rng:NextNumber(0, 2 * math.pi), amp })
	end
	local tab = table.create(NA * NV, 0)
	local lo, hi = math.huge, -math.huge
	for v = 0, NV - 1 do
		for a = 0, NA - 1 do
			local sum = 0
			for _, w in waves do
				sum += w[4] * math.cos(w[1] * a + w[2] * v + w[3])
			end
			tab[v * NA + a + 1] = sum
			lo, hi = math.min(lo, sum), math.max(hi, sum)
		end
	end
	for k, x in tab do
		tab[k] = (x - lo) / (hi - lo) * 2 - 1 -- -1..1
	end
	noiseTable = tab
	return tab
end

-- Bilinear look-up, wrapping both ways (a, v in table cells).
local function sampleNoise(tab: { number }, a: number, v: number): number
	a %= NA
	v %= NV
	local a0, v0 = math.floor(a), math.floor(v)
	local fa, fv = a - a0, v - v0
	local a1, v1 = (a0 + 1) % NA, (v0 + 1) % NV
	local r0, r1 = v0 * NA + 1, v1 * NA + 1
	local x0 = tab[r0 + a0] + (tab[r0 + a1] - tab[r0 + a0]) * fa
	local x1 = tab[r1 + a0] + (tab[r1 + a1] - tab[r1 + a0]) * fa
	return x0 + (x1 - x0) * fv
end

-- Draw the condensation texture ONCE: a tile that wraps round the column (u = angle round the
-- axis, 0..2 pi) and up it (v = one vertical noise period). Brightness: broad helical bands
-- (streaks) and soft lumps (patches). The funnel then moves it every frame through the mesh's UVs
-- (update): it turns with the air (spin), winds with height (twist) and climbs (rise), so the
-- condensed air streams up the funnel in a helix at the full frame rate (redrawing the image
-- could only keep up ~20 times a second, which stepped).
local function drawCondensation(self: RibbonFunnel, image: EditableImage, pixels: buffer)
	local R = Config.ribbonFunnel
	local W, H = R.textureSize.X, R.textureSize.Y
	local tab = self.streakTable
	local N = #tab
	local noise = condensationNoise()
	for y = 0, H - 1 do
		local v = (y + 0.5) / H * NV
		for x = 0, W - 1 do
			local f = (x + 0.5) / W
			local streak = tab[math.floor(f * N) + 1] or 0
			local lump = sampleNoise(noise, f * NA, v)
			local k = 1 + R.streaks * streak + R.patches * lump
			local val = math.clamp(math.floor(R.textureLevel * k + 0.5), 0, 255)
			buffer.writeu32(pixels, (y * W + x) * 4, bit32.bor(val, bit32.lshift(val, 8), bit32.lshift(val, 16), 0xFF000000))
		end
	end
	image:WritePixelsBuffer(Vector2.zero, Vector2.new(W, H), pixels)
	self.drawn = string.format("%g/%g/%g/%d", R.streaks, R.patches, R.textureLevel, R.streakSeed)
end

function RibbonFunnel.update(self: RibbonFunnel, dt: number, time: number)
	local R = Config.ribbonFunnel
	local state = self.state
	local ribbon = self.ribbon
	if not R.enabled then
		if ribbon then
			clear(self)
		end
		return
	end
	if not state or not ribbon then
		return
	end
	local F = Config.funnel
	local nL = R.levels
	local bottom = math.clamp(state.bottom or 0, 0, 0.98)
	-- Where the funnel meets the parent storm: the storm base's own underside over the funnel's top
	-- (the wall cloud hangs well below the cloud base). The ribbon fades out just under it, so it
	-- dissolves into the wall cloud instead of being sliced by its mesh (a hard flat rim).
	local H = math.max(state.cloudBase, 1)
	local meet = R.top
	if Config.stormBase.enabled then
		local dy = StormBase.field(0, 0, H, 0)
		meet = math.min(R.top, (H + dy) / H + R.meetAbove)
	end
	local pts, radii = table.create(nL), table.create(nL, 0)
	local colours, alphas = table.create(nL), table.create(nL, 0)
	for i = 1, nL do
		local s = (i - 1) / (nL - 1)
		local t = bottom + (meet - bottom) * (s ^ R.spacingPower)
		pts[i] = State.centreAt(state, t, time)
		-- the shape's flare happens where the funnel meets the cloud (the wall cloud's underside),
		-- not at the full cloud-base height it never reaches
		radii[i] = State.radiusAt(state, math.min(t / math.max(meet, 0.05), 1), time)
		colours[i] = cloudColour(state, t, radii[i])
		alphas[i] = R.opacity
			* (1 - smoothstep(meet - R.topFade * meet, meet, t))
			* (if bottom > 0.001 then smoothstep(bottom, bottom + R.footFade, t) else 1)
	end
	-- Scene light (colour "scene"): sunlight only where a ray toward the sun gets out under the storm
	-- base or through a thin part of it (the clear slot, the edge); under solid cloud, only the dim
	-- light under the storm. From the storm field (StormBase), not painted.
	if R.colour == "scene" and Config.stormBase.enabled then
		local sun = Lighting:GetSunDirection()
		local top = State.centreAt(state, 1, time)
		for i = 1, nL do
			local p = pts[i]
			local direct = 0
			if sun.Y > 0.01 then
				local up = (state.position.Y + H) - p.Y
				local hit = p + sun * (math.max(up, 0) / sun.Y)
				local _, _, cover = StormBase.field(hit.X - top.X, hit.Z - top.Z, H, 0)
				direct = 1 - math.clamp(cover, 0, 1)
				-- only the side facing the sun is lit: from behind (the sun beyond the funnel) the side
				-- we see is in the funnel's own shadow (its bright edge is Ribbon.place's rim term)
				local cam = Workspace.CurrentCamera.CFrame.Position
				local toCam = Vector3.new(cam.X - p.X, 0, cam.Z - p.Z)
				local sunH = Vector3.new(sun.X, 0, sun.Z)
				if toCam.Magnitude > 1 and sunH.Magnitude > 1e-3 then
					local facing = (toCam.Unit:Dot(sunH.Unit) + 1) * 0.5 -- 1 sun behind the camera, 0 sun behind the funnel
					direct *= facing ^ R.sunFacing
				end
			end
			local light = R.underLight + R.sunLight * direct
			local c = colours[i]
			colours[i] = Color3.new(math.clamp(c.R * light, 0, 1), math.clamp(c.G * light, 0, 1), math.clamp(c.B * light, 0, 1))
		end
	end
	-- where the funnel flares fast into the cloud base, fade too (the base's own cloud takes
	-- over): stops the ribbon's wide top edge showing as a lip against the base
	for i = 2, nL do
		local grow = (radii[i] - radii[i - 1]) / math.max((pts[i] - pts[i - 1]).Magnitude, 1)
		alphas[i] *= 1 - smoothstep(R.flareFade, R.flareFade * 2.5, grow)
	end
	-- Hand over to the puff funnel where a camera-facing ribbon can't work: from under or inside
	-- the funnel, or looking up or down its axis, a ribbon turns edge-on and reads as a sheet.
	-- 0 = ribbon fully shown; 1 = hidden, the puffs' body layer drawn instead (PuffView reads it).
	local cam = Workspace.CurrentCamera.CFrame.Position
	local mid = math.floor(nL / 2)
	local axisDir = pts[math.min(mid + 1, nL)] - pts[math.max(mid - 1, 1)]
	axisDir = if axisDir.Magnitude > 1e-3 then axisDir.Unit else Vector3.yAxis
	local toCam = cam - pts[mid]
	local align = if toCam.Magnitude > 1e-3 then math.abs(axisDir:Dot(toCam.Unit)) else 1
	local hAt = math.clamp((cam.Y - state.position.Y) / math.max(state.cloudBase, 1), 0, 1)
	local axisAtCam = State.centreAt(state, hAt, time)
	local d = Vector3.new(cam.X - axisAtCam.X, 0, cam.Z - axisAtCam.Z).Magnitude
	local rAtCam = State.radiusAt(state, hAt, time)
	local hidden = math.max(
		smoothstep(R.handoverAlign[1], R.handoverAlign[2], align),
		1 - smoothstep(R.handoverNear[1] * rAtCam, R.handoverNear[2] * rAtCam, d)
	)
	if not R.handover then
		hidden = 0
	end
	R.hidden = hidden
	for i = 1, nL do
		alphas[i] *= 1 - hidden
	end
	-- on the ground, the foot goes on below it
	if bottom <= 0.001 then
		pts[1] -= Vector3.new(0, R.sink * radii[1], 0)
	end
	-- the texture's motion (every frame) and the ragged edge (per vertex, at the silhouette)
	local nC = #R.columns
	local midR = math.max(radii[math.floor(nL / 2)], 1)
	self.spin = (self.spin + Vortex.spinRate(state, midR) * R.spinShare * dt) % (2 * math.pi)
	self.rise += R.riseSpeed * dt
	local rMid = math.max(State.radiusAt(state, 0.5 * (bottom + R.top), 0), 4)
	-- baked: a rendered volumetric column (Config.ribbonFunnel.baked) mapped across the visible width
	-- (u) and up the funnel (v, one texture period = 2 texture widths), scrolled upward
	local baked = R.baked ~= ""
	local vPeriod = if baked then 2 * rMid / R.bakedSpan else 2 * math.pi * rMid * R.patchAspect
	if self.rise > vPeriod * 64 then
		self.rise -= vPeriod * 64 -- whole periods: the tile repeats, nothing moves
	end
	local uvs, alphaMul = self.uvs, self.alphaMul
	local noise = condensationNoise()
	local twoPi = 2 * math.pi
	local fringeFrom = 1 - R.fringe - R.fringeSoft
	for i = 1, nL do
		local s = (i - 1) / (nL - 1)
		local t = bottom + (R.top - bottom) * (s ^ R.spacingPower)
		local v = (t * state.cloudBase - self.rise) / vPeriod
		local twist = R.twist * (1 - s)
		for j = 1, nC do
			local x = R.columns[j]
			local k = (i - 1) * nC + j
			local u = if baked then 0.5 + x * R.bakedSpan else (math.asin(math.clamp(x, -1, 1)) + self.spin + twist) / twoPi
			uvs[k] = Vector2.new(u, v)
			local ax = math.abs(x)
			if not baked and R.fringe > 0 and ax > fringeFrom then
				-- tufts at the silhouette: finer noise, offset so it doesn't follow the lumps
				local n2 = sampleNoise(noise, (u % 1) * NA * 2 + 41, (v % 1) * NV * 2 + 113)
				local edgeAt = 1 - R.fringe * (0.5 + 0.5 * n2)
				local cut = math.clamp((ax - (edgeAt - R.fringeSoft)) / R.fringeSoft, 0, 1)
				alphaMul[k] = 1 - cut * cut * (3 - 2 * cut)
			else
				alphaMul[k] = 1
			end
		end
	end
	-- see-through things are drawn far to near by their part's position: set the ribbon's part a
	-- little behind the funnel (away from the camera) so dust and wisps in front of its foot draw
	-- over it, not under (the geometry doesn't move: vertices are placed relative to this)
	local away = Vector3.new(state.position.X - cam.X, 0, state.position.Z - cam.Z)
	local origin = state.position
	if away.Magnitude > 1 then
		origin += away.Unit * math.max(radii[1], 1) * R.sortBack
	end
	ribbon:place(origin, pts, radii, colours, alphas, R :: any, alphaMul)
	-- the opaque core: narrower, bulged less (behind the soft front), and only where the ribbon is
	-- solid (an opaque mesh can't fade: elsewhere its levels collapse to the axis)
	local core = self.core
	if core then
		local cr, ones = table.create(nL, 0), table.create(nL, 1)
		for i = 1, nL do
			cr[i] = if alphas[i] >= R.coreFrom then radii[i] * R.core else 0
		end
		local look = table.clone(R :: any)
		look.bulge = R.bulge * R.coreBulge
		look.edge = 0.01 -- (alpha ramp over 0.98-1: past the core's outermost column, so all stay 1)
		core:place(origin, pts, cr, colours, ones, look)
	end
	local image, pixels = ribbon.image, self.pixels
	if baked then
		if self.bakedFor ~= R.baked then
			self.bakedFor = R.baked
			ribbon.part.TextureContent = Content.fromUri(R.baked)
		end
		ribbon:setUVs(uvs)
	elseif image and pixels then
		if self.bakedFor then
			self.bakedFor = nil
			ribbon.part.TextureContent = Content.fromObject(image)
		end
		ribbon:setUVs(uvs)
		local R2 = Config.ribbonFunnel
		if self.drawn ~= string.format("%g/%g/%g/%d", R2.streaks, R2.patches, R2.textureLevel, R2.streakSeed) then
			drawCondensation(self, image, pixels) -- settings changed (the panel, a look)
		end
	end
end

function RibbonFunnel.destroy(self: RibbonFunnel)
	clear(self)
	self.folder:Destroy()
end

return RibbonFunnel
