--!strict
-- The "puff chain" funnel (client only): round soft puffs carried up the funnel's (bent)
-- centreline. Read from the reference clips (an in-development Roblox game): forming ropes there
-- are visibly chains of round puffs, and mature funnels are piles of big overlapping round masses
-- in one flat colour; the lumps are what make them read as cloud.
--
-- Motion: the puffs ride carriers that climb the axis at Config.puffs.riseSpeed (a conveyor), so
-- the funnel visibly streams upward and follows its bends. As a carrier climbs, its puffs are
-- resized and recoloured to the funnel there (an emitter's Size and Color apply to its live
-- particles too); near the top it fades into the cloud, then restarts at the ground, cleared and
-- refilled, and fades back in. Carriers also orbit the axis slowly (spin).
--
-- Draws only the funnel body; FunnelView still draws the cloud base, deck, foot and debris
-- (Config.render.mode = "puffs" tells it to skip its own funnel rings).
--
--   local view = PuffView.new(workspace)
--   view:setState(state)          -- rebuilds or reapplies as needed
--   RunService.RenderStepped: view:update(dt, sharedTime)
--   view:apply()                  -- after editing Config live
local Workspace = game:GetService("Workspace")

local Config = require(script.Parent.Config)
local FarSprite = require(script.Parent.FarSprite)
local State = require(script.Parent.State)
local Vortex = require(script.Parent.Vortex)

local PuffView = {}
PuffView.__index = PuffView

type Carrier = {
	u0: number, -- starting place along the axis (share of its length)
	lastU: number,
	alpha: number, -- 0-1: fades in when added, out when retired (no carrier pops)
	target: number, -- 1 live, 0 retiring
	farGui: BillboardGui?, -- the far stand-in (FarSprite)
	farImg: ImageLabel?,
	parts: { BasePart },
	emitters: { ParticleEmitter },
	keys: { number }, -- size each emitter was last given (resize only on real change)
	lift: { number },
	angle: number,
}

type Path = { ts: { number }, ss: { number }, length: number }

export type PuffView = typeof(setmetatable(
	{} :: {
		folder: Folder,
		carriers: { Carrier },
		state: State.State?,
		path: Path?,
		gap: number,
		phase: number, -- how far the conveyor has moved (share of the axis length)
		live: boolean, -- the state changes every frame (setLive): carriers are added/retired gradually
		time: number,
		paused: boolean,
		frozen: boolean,
		signature: string,
		stats: { nodes: number, emitters: number, particles: number },
		_parts: { BasePart },
		_cframes: { CFrame },
	},
	PuffView
))

local SAMPLES = 160

function PuffView.new(parent: Instance?): PuffView
	local folder = Instance.new("Folder")
	folder.Name = "PuffTornado"
	folder.Parent = parent or Workspace
	return setmetatable({
		folder = folder,
		carriers = {},
		state = nil,
		path = nil,
		gap = 1,
		phase = 0,
		live = false,
		time = 0,
		paused = false,
		frozen = false,
		signature = "",
		stats = { nodes = 0, emitters = 0, particles = 0 },
		_parts = {},
		_cframes = {},
	}, PuffView)
end

local function enabled(): boolean
	return Config.render.mode == "puffs" and Config.puffs.enabled
end

-- Arc length along the centreline, sampled: t <-> studs along the axis.
local function buildPath(state: State.State, time: number): Path
	local ts, ss = { 0 }, { 0 }
	local prev = State.centreAt(state, 0, time)
	local total = 0
	for i = 1, SAMPLES do
		local t = i / SAMPLES
		local p = State.centreAt(state, t, time)
		total += (p - prev).Magnitude
		prev = p
		ts[i + 1] = t
		ss[i + 1] = total
	end
	return { ts = ts, ss = ss, length = math.max(total, 1) }
end

local function tAt(path: Path, s: number): number
	local ss, ts = path.ss, path.ts
	if s <= 0 then
		return 0
	end
	if s >= path.length then
		return 1
	end
	local lo, hi = 1, #ss
	while hi - lo > 1 do
		local mid = (lo + hi) // 2
		if ss[mid] <= s then
			lo = mid
		else
			hi = mid
		end
	end
	local f = (s - ss[lo]) / math.max(ss[hi] - ss[lo], 1e-6)
	return ts[lo] + (ts[hi] - ts[lo]) * f
end

-- How many carriers and how far apart: spaced by the narrowest part of the funnel (so the thin
-- foot is still continuous), widened to keep to maxNodes, fitted to the axis's length exactly so
-- the conveyor loops evenly.
local function layout(state: State.State, path: Path): (number, number)
	local P = Config.puffs
	local rMin = math.huge
	for i = 0, 20 do
		rMin = math.min(rMin, State.radiusAt(state, i / 20))
	end
	local gap = math.clamp(P.spacing * rMin, P.minSpacing, P.maxSpacing)
	local n = math.max(2, math.ceil(path.length / gap))
	n = math.min(n, P.maxNodes)
	return n, path.length / n
end

local function newPart(): Part
	local p = Instance.new("Part")
	p.Anchored = true
	p.CanCollide = false
	p.CanQuery = false
	p.CanTouch = false
	p.CastShadow = false
	p.Transparency = 1
	p.Size = Vector3.one
	p.Locked = true
	return p
end

local function newEmitter(): ParticleEmitter
	local e = Instance.new("ParticleEmitter")
	e.Shape = Enum.ParticleEmitterShape.Cylinder
	e.ShapeStyle = Enum.ParticleEmitterShapeStyle.Volume
	e.EmissionDirection = Enum.NormalId.Top
	e.SpreadAngle = Vector2.new(360, 360)
	e.Acceleration = Vector3.zero
	e.Drag = 1
	e.LockedToPart = true
	e.Orientation = Enum.ParticleOrientation.FacingCamera
	e.FlipbookMode = Enum.ParticleFlipbookMode.Loop
	e.FlipbookStartRandom = true
	e.FlipbookBlendFrames = true
	e.LightEmission = 0
	return e
end

function PuffView.clear(self: PuffView)
	for _, c in self.carriers do
		for _, p in c.parts do
			p:Destroy()
		end
	end
	table.clear(self.carriers)
	table.clear(self._parts)
	table.clear(self._cframes)
	self.signature = ""
	self.stats.nodes, self.stats.emitters, self.stats.particles = 0, 0, 0
end

local serial = 0
local function newCarrier(self: PuffView, u0: number, alpha: number): Carrier
	serial += 1
	local c: Carrier = {
		u0 = u0,
		lastU = u0,
		alpha = alpha,
		target = 1,
		parts = {},
		emitters = {},
		keys = {},
		lift = {},
		angle = (serial * 2.399) % (2 * math.pi),
	}
	for l, layer in Config.puffLayers do
		local part = newPart()
		part.Name = string.format("Puff%04d_%s", serial, layer.name)
		local e = newEmitter()
		e.Parent = part
		part.Parent = self.folder
		c.parts[l] = part
		c.emitters[l] = e
		c.keys[l] = -1
		c.lift[l] = 0
	end
	if c.parts[1] then
		c.farGui, c.farImg = FarSprite.new(c.parts[1])
	end
	table.insert(self.carriers, c)
	return c
end

local function liveCarriers(self: PuffView): { Carrier }
	local out = {}
	for _, c in self.carriers do
		if c.target > 0 then
			table.insert(out, c)
		end
	end
	table.sort(out, function(a, b)
		return a.u0 < b.u0
	end)
	return out
end

-- One more carrier, fading in at the middle of the widest gap along the conveyor.
local function addCarrier(self: PuffView)
	local live = liveCarriers(self)
	local best, at = -1, 0
	for i, c in live do
		local nextU = if i < #live then live[i + 1].u0 else live[1].u0 + 1
		if nextU - c.u0 > best then
			best, at = nextU - c.u0, (c.u0 + (nextU - c.u0) * 0.5) % 1
		end
	end
	newCarrier(self, at, 0)
end

-- One carrier fewer: the one in the tightest spot fades out.
local function retireCarrier(self: PuffView)
	local live = liveCarriers(self)
	if #live <= 2 then
		return
	end
	local best, pick = math.huge, nil
	for i, c in live do
		local prevU = if i > 1 then live[i - 1].u0 else live[#live].u0 - 1
		local nextU = if i < #live then live[i + 1].u0 else live[1].u0 + 1
		if nextU - prevU < best then
			best, pick = nextU - prevU, c
		end
	end
	if pick then
		pick.target = 0
	end
end

function PuffView.rebuild(self: PuffView)
	self:clear()
	local state = self.state
	if not state or not enabled() then
		return
	end
	local path = buildPath(state, self.time)
	local n, gap = layout(state, path)
	self.path, self.gap = path, gap
	self.signature = string.format("%d/%d", n, #Config.puffLayers)
	for i = 1, n do
		newCarrier(self, (i - 1) / n, 1)
	end
	self:apply()
end

local function tinted(c: Color3, k: number): Color3
	return Color3.new(math.clamp(c.R * k, 0, 1), math.clamp(c.G * k, 0, 1), math.clamp(c.B * k, 0, 1))
end

-- Size, spread, count, colour and ground lift of one layer at height share t.
local function shapeAt(state: State.State, layer: any, t: number, time: number)
	local F, P = Config.funnel, Config.puffs
	local H = math.max(state.cloudBase, 1)
	local r = State.radiusAt(state, t, time)
	-- A round puff reaches as far down as it is wide: shrink it until it fits the funnel's width
	-- at the bottom of its reach (or wide puffs near a cone's top hang over the narrow part below:
	-- a ball, not a cone), and spread the puffs sideways to fill the width instead.
	-- near the ground the puffs shrink (and spread to fill the width): big round puffs at the foot
	-- give it a bulging egg-shaped end; a real contact runs straight-sided into the ground
	local footX = math.clamp(t * H / math.max(P.footHeight * r * 2, 1), 0, 1)
	local sizeShare = layer.size * (P.footSize + (1 - P.footSize) * footX * footX * (3 - 2 * footX))
	local rho = r * sizeShare
	for _ = 1, 4 do
		rho = math.min(rho, State.radiusAt(state, math.max(t - rho * 0.8 / H, 0), time) * sizeShare)
	end
	-- shell layers release on a ring so the puffs' outer edges land on the funnel's edge (a wide
	-- funnel's silhouette must always be populated); others fill a disc round the axis
	local R = if layer.shell then math.max(r - rho * 0.7, r * layer.offset, 0.25) else math.max(r * layer.offset, r - rho * 0.9, 0.25)
	local size = math.clamp(2 * rho, 0.5, F.sizeMax)
	local grown = math.min(size * layer.grow, F.sizeMax)
	local count = math.max(layer.count, 1)
	if layer.shell then
		count = math.max(count, math.ceil((layer.cover or 1.5) * 2 * math.pi * R / math.max(2 * rho, 1)))
	end
	count = math.min(count, P.maxPerPoint)
	-- keep each puff's dense middle off the ground (a puff the ground cuts shimmers along the cut)
	local bottom = t * H - math.max(size, grown) * 0.5 * P.groundReach
	local lift = math.max(F.groundClear - bottom, 0)
	local color = F.colorBottom:Lerp(F.colorTop, t ^ F.colorGamma)
	-- darker low down (dust drawn in), and with debris taking on the dust's colour: gentle and over
	-- the whole height, so neighbouring puffs barely differ in shade (a short, strong gradient
	-- shows its edge as an egg-shaped dark foot)
	do
		local x = math.clamp(t / math.max(P.dustHeight, 1e-3), 0, 1)
		local low = 1 - x * x * (3 - 2 * x)
		color = tinted(color, P.lowShade + (1 - P.lowShade) * (1 - low))
		local Dd = Config.debris
		if Dd.enabled and P.dustTake > 0 then
			local dust = if Dd.groundDust then Dd.color:Lerp(Dd.groundDust :: Color3, Dd.groundShare) else Dd.color
			color = color:Lerp(dust, P.dustTake * low)
		end
	end
	-- dust drawn into the funnel darkens it near the ground (and matching the debris colour there
	-- keeps dust and funnel puffs from flashing as they swap draw order)
	local D = Config.debris
	if D.enabled and P.dustTint > 0 then
		local x = math.clamp(t / math.max(P.dustHeight, 1e-3), 0, 1)
		color = color:Lerp(D.color, P.dustTint * (1 - x * x * (3 - 2 * x)))
	end
	return r, R, size, grown, count, lift, color
end

-- Push the per-height properties of one carrier's layer (only when its size really changed).
local function fitLayer(self: PuffView, c: Carrier, l: number, t: number, force: boolean)
	local state = self.state :: State.State
	local layer = Config.puffLayers[l]
	local r, R, size, grown, count, lift, color = shapeAt(state, layer, t, self.time)
	c.lift[l] = lift
	if not force and c.keys[l] > 0 and math.abs(size - c.keys[l]) / c.keys[l] < 0.015 then
		return
	end
	c.keys[l] = size
	if layer.zFront then
		-- always drawn in front of the rest of the funnel (no draw-order swaps, so it can be darker):
		-- a thin shell seen through is densest at the silhouette, so the edges darken (limb darkening)
		c.emitters[l].ZOffset = r * layer.zFront
	end
	local e, part = c.emitters[l], c.parts[l]
	local k = Config.funnel.sizeScale
	local env = size * math.clamp(layer.sizeJitter, 0, 0.9)
	if layer.silhouette then
		-- an edge layer: a small emitter kept at the funnel's silhouette (placed in update)
		part.Size = Vector3.new(math.max(size * 0.15, 0.5), math.min(math.max(self.gap, 0.5), 2048), math.max(size * 0.15, 0.5))
	else
		part.Size = Vector3.new(math.min(2 * R, 2048), math.min(math.max(self.gap, 0.5), 2048), math.min(2 * R, 2048))
	end
	e.Size = NumberSequence.new({
		NumberSequenceKeypoint.new(0, size * k, env * k),
		NumberSequenceKeypoint.new(1, grown * k, env * k),
	})
	local life = math.max(layer.lifetime, 0.1)
	local on = layer.enabled ~= false and layer.opacity > 0.002
	if layer.dust then
		-- the darker lower funnel: puffs over the lower funnel in a darker shade of it (dust drawn
		-- in, toward the debris colour when there is debris), always drawn in front (zFront) and
		-- fading out with height; the funnel's own puffs stay one colour (puffs of different shades
		-- overlapping would show their round edges as they swap draw order)
		local D, P = Config.debris, Config.puffs
		local x = math.clamp(t / math.max(P.dustHeight, 1e-3), 0, 1)
		local w = 1 - x * x * (3 - 2 * x)
		local opacity = math.clamp(layer.opacity * w, 0, 1)
		local fi = math.clamp(layer.fadeIn, 0.01, 0.48)
		local fo = math.clamp(layer.fadeOut, 0.01, 0.48)
		e.Transparency = NumberSequence.new({
			NumberSequenceKeypoint.new(0, 1),
			NumberSequenceKeypoint.new(fi, 1 - opacity),
			NumberSequenceKeypoint.new(1 - fo, 1 - opacity),
			NumberSequenceKeypoint.new(1, 1),
		})
		color = tinted(color, P.lowShade)
		if D.enabled then
			color = color:Lerp(D.color, P.dustMix)
		end
		on = on and w > 0.01
	end
	if layer.lowFade then
		-- faded out near the ground (where its puffs are shrunk small: they read as bubbles)
		local x = math.clamp(t / math.max(layer.lowFade, 1e-3), 0, 1)
		local opacity = math.clamp(layer.opacity * x * x * (3 - 2 * x), 0, 1)
		local fi = math.clamp(layer.fadeIn, 0.01, 0.48)
		local fo = math.clamp(layer.fadeOut, 0.01, 0.48)
		e.Transparency = NumberSequence.new({
			NumberSequenceKeypoint.new(0, 1),
			NumberSequenceKeypoint.new(fi, 1 - opacity),
			NumberSequenceKeypoint.new(1 - fo, 1 - opacity),
			NumberSequenceKeypoint.new(1, 1),
		})
		on = on and x > 0.01
	end
	e.Color = ColorSequence.new(tinted(color, layer.shade))
	e.Rate = if on then count / life else 0
	e.Speed = NumberRange.new(if layer.free then layer.drift * R * 0.4 else 0, layer.drift * R)
end

-- Everything that doesn't change with height.
function PuffView.apply(self: PuffView)
	local state = self.state
	if not state then
		return
	end
	if not enabled() then
		if #self.carriers > 0 then
			self:clear()
		end
		return
	end
	local path = buildPath(state, self.time)
	local n = layout(state, path)
	-- keep the carriers through modest changes (a tornado widening or stretching live): a rebuild
	-- drops every puff at once
	local have = #liveCarriers(self)
	local sameLayers = string.match(self.signature, "/(%d+)$") == tostring(#Config.puffLayers)
	if not sameLayers or have == 0 or (not self.live and math.abs(n - have) / have > 0.35) then
		self:rebuild()
		return
	end
	-- a live tornado gains or loses carriers a few at a time, each fading in or out
	local diff = n - have
	for _ = 1, math.min(math.abs(diff), Config.puffs.maxCarrierChange) do
		if diff > 0 then
			addCarrier(self)
		else
			retireCarrier(self)
		end
	end
	have = #liveCarriers(self)
	self.path, self.gap = path, path.length / math.max(have, 1)
	local P = Config.puffs
	local particles, emitters = 0, 0
	for i, c in self.carriers do
		for l, layer in Config.puffLayers do
			local e = c.emitters[l]
			local life = math.max(layer.lifetime, 0.1)
			local opacity = if layer.enabled == false then 0 else math.clamp(layer.opacity, 0, 1)
			local fi = math.clamp(layer.fadeIn, 0.01, 0.48)
			local fo = math.clamp(layer.fadeOut, 0.01, 0.48)
			e.Texture = Config.textures[layer.texture] or layer.texture
			e.FlipbookLayout = if Config.SHEETS[layer.texture] then Enum.ParticleFlipbookLayout.Grid4x4 else Enum.ParticleFlipbookLayout.None
			local fps = math.clamp(layer.flipFps, 0, 30)
			e.FlipbookFramerate = NumberRange.new(fps * 0.8, math.min(fps * 1.2, 30))
			e.Lifetime = NumberRange.new(life * 0.8, life * 1.2)
			e.Transparency = NumberSequence.new({
				NumberSequenceKeypoint.new(0, 1),
				NumberSequenceKeypoint.new(fi, 1 - opacity),
				NumberSequenceKeypoint.new(1 - fo, 1 - opacity),
				NumberSequenceKeypoint.new(1, 1),
			})
			local tilt = layer.rotation or 180
			e.Rotation = NumberRange.new(-tilt, tilt)
			e.Orientation = if layer.upright then Enum.ParticleOrientation.FacingCameraWorldUp else Enum.ParticleOrientation.FacingCamera
			e.RotSpeed = NumberRange.new(-layer.rotSpeed, layer.rotSpeed)
			e.ShapeStyle = if layer.shell then Enum.ParticleEmitterShapeStyle.Surface else Enum.ParticleEmitterShapeStyle.Volume
			-- squash < 0: taller and narrower (stacked up a funnel's side, tall puffs draw a smooth
			-- edge where round ones draw scallops)
			e.Squash = NumberSequence.new(math.clamp(layer.squash or 0, -3, 3))
			-- free layers (the shed wisps) are left behind in the air as their carrier climbs and turns,
			-- thrown outward off the edge and lifting a little: bits of the funnel peeling away
			e.LockedToPart = not layer.free
			e.ShapeInOut = Enum.ParticleEmitterShapeInOut.Outward
			local spread = layer.spread or 360
			e.SpreadAngle = Vector2.new(spread, spread)
			e.Acceleration = Vector3.new(0, layer.buoyancy or 0, 0)
			e.Drag = layer.drag or 1
			e.LightInfluence = P.lightInfluence
			e.Brightness = P.brightness
			e.ZOffset = layer.zOffset
			e.TimeScale = if self.frozen then 0 else 1
			local s = ((c.u0 + self.phase) % 1) * path.length
			fitLayer(self, c, l, tAt(path, s), true)
			if e.Rate > 0 then
				particles += e.Rate * life
				emitters += 1
			end
		end
	end
	self.stats.nodes = #self.carriers
	self.stats.emitters = emitters
	self.stats.particles = math.floor(particles + 0.5)
end

function PuffView.setState(self: PuffView, state: State.State)
	self.state = state
	self.live = false
	self:apply()
end

-- A new state for a tornado that changes every frame (an interpolated server state): positions,
-- sizes and the axis follow in update(); call apply() now and then for the rest.
function PuffView.setLive(self: PuffView, state: State.State)
	self.state = state
	self.live = true
end

function PuffView.setFrozen(self: PuffView, frozen: boolean)
	self.frozen = frozen
	for _, c in self.carriers do
		for _, e in c.emitters do
			e.TimeScale = if frozen then 0 else 1
		end
	end
end

local function smooth01(x: number): number
	x = math.clamp(x, 0, 1)
	return x * x * (3 - 2 * x)
end

function PuffView.update(self: PuffView, dt: number, time: number)
	local state = self.state
	if not state or not self.path or #self.carriers == 0 then
		return
	end
	self.time = time
	-- the axis moves and stretches every frame (kinks, wobble, a live state): re-measure it
	local path = buildPath(state, time)
	self.path, self.gap = path, path.length / math.max(#liveCarriers(self), 1)
	table.clear(self._parts)
	table.clear(self._cframes)
	local fadeRate = dt / math.max(Config.puffs.carrierFade, 0.05)
	local P = Config.puffs
	local moving = not (self.paused or self.frozen)
	local L = path.length
	if moving then
		self.phase = (self.phase + P.riseSpeed * dt / L) % 1
	end
	local bottom = state.bottom or 0
	local F, K = Config.funnel, Config.far
	local camera = Workspace.CurrentCamera
	local eye = if camera then camera.CFrame.Position else Vector3.zero
	-- the camera's sideways direction (level): edge layers sit at the silhouette across it
	local camRight = if camera then camera.CFrame.RightVector else Vector3.xAxis
	camRight = Vector3.new(camRight.X, 0, camRight.Z)
	camRight = if camRight.Magnitude > 1e-3 then camRight.Unit else Vector3.xAxis
	local fadeIn = math.max(P.bottomFade * L, 1e-3)
	local fadeOut = math.max(P.topFadeLength * L, 1e-3)
	local k = 0
	for _, c in self.carriers do
		local u = (c.u0 + self.phase) % 1
		local wrapped = moving and u < c.lastU - 0.5
		c.lastU = u
		local s = u * L
		local t = tAt(path, s)
		local r = State.radiusAt(state, t, time)
		if moving then
			c.angle = (c.angle + Vortex.spinRate(state, r) * dt) % (2 * math.pi)
		end
		-- fade in leaving the ground, out going into the cloud
		c.alpha = math.clamp(c.alpha + (if c.target > c.alpha then fadeRate else -fadeRate), 0, 1)
		local visible = smooth01(s / fadeIn) * smooth01((L - s) / fadeOut) * smooth01(c.alpha)
		if bottom > 0 then
			-- below the condensation funnel's tip: nothing (the debris carries the ground contact);
			-- eased in as the tip leaves the ground, so a touchdown is smooth
			local cut = smooth01((t - bottom) / 0.05)
			visible *= 1 + (cut - 1) * smooth01(bottom / 0.05)
		end
		local centre = State.centreAt(state, t, time)
		-- far away the particles aren't drawn: hand over to the carrier's sprite
		local far = FarSprite.weight(eye, centre)
		if c.farGui and c.farImg then
			local d = K.funnelSize * r
			local overlap = math.max(d / math.max(self.gap, 1), 1)
			local each = 1 - (1 - K.funnelOpacity) ^ (1 / overlap)
			local color = F.colorBottom:Lerp(F.colorTop, t ^ F.colorGamma)
			-- with the ribbon as the body, the stand-ins (like the body puffs) only show where the
			-- ribbon hands over: otherwise they drew a pale glow over its face
			local standIn = if Config.ribbonFunnel.enabled then (Config.ribbonFunnel.hidden or 0) else 1
			FarSprite.show(c.farGui, c.farImg, d, d, color, each * visible * far * standIn)
		end
		-- layers drawn in front are pushed toward the camera; never by more than half the way
		-- (close to or under the funnel a full push lands behind the camera: popping, clipping)
		local half = (eye - centre).Magnitude * 0.5
		for l, part in c.parts do
			local e = c.emitters[l]
			fitLayer(self, c, l, t, wrapped)
			local zFront = Config.puffLayers[l].zFront
			if zFront then
				e.ZOffset = math.min(r * zFront, half)
			end
			local shown = visible * (1 - far)
			-- with the ribbon funnel the body layer only stands in where the ribbon can't (from
			-- under or inside the funnel, along its axis: RibbonFunnel sets ribbonFunnel.hidden)
			if Config.ribbonFunnel.enabled and Config.puffLayers[l].name == "body" then
				shown *= Config.ribbonFunnel.hidden or 0
			end
			e.LocalTransparencyModifier = 1 - shown
			if wrapped then
				-- back at the ground: drop the old puffs (already faded out at the top) and refill
				e:Clear()
				local layer = Config.puffLayers[l]
				local n = math.floor(e.Rate * math.max(layer.lifetime, 0.1) * P.refill + 0.5)
				if n > 0 then
					e:Emit(n)
				end
			end
			k += 1
			self._parts[k] = part
			local layer = Config.puffLayers[l]
			if layer.silhouette then
				-- at the left or right silhouette as the camera sees it, the puffs' outer edges on
				-- the funnel's edge: overlapped up the side they draw one defined line, and none land
				-- on the funnel's face (where their round edges would show)
				local rho = (c.keys[l] or 0) * 0.5
				local out = math.max(r * (layer.reach or 1) - rho * layer.inset, 0)
				self._cframes[k] = CFrame.new(centre + camRight * (out * layer.silhouette) + Vector3.new(0, c.lift[l], 0))
			else
				self._cframes[k] = CFrame.new(centre + Vector3.new(0, c.lift[l], 0)) * CFrame.Angles(0, c.angle, 0)
			end
		end
	end
	Workspace:BulkMoveTo(self._parts, self._cframes, Enum.BulkMoveMode.FireCFrameChanged)
	-- drop carriers that have finished fading out
	for i = #self.carriers, 1, -1 do
		local c = self.carriers[i]
		if c.target == 0 and c.alpha <= 0 then
			for _, part in c.parts do
				part:Destroy()
			end
			table.remove(self.carriers, i)
		end
	end
	self.stats.nodes = #self.carriers
end

function PuffView.destroy(self: PuffView)
	self:clear()
	self.folder:Destroy()
end

return PuffView
