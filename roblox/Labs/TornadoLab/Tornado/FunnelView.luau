--!strict
-- The particle tornado (client only). Rings of smoke: up the funnel's centreline (Config.layers)
-- and, at the top, out across a flared cloud base (Config.base / Config.baseLayers). Each ring
-- is an invisible spinning part per smoke layer holding a ParticleEmitter whose particles are
-- LockedToPart, so the smoke turns with the vortex. Narrow rings turn faster.
--
--   local view = FunnelView.new(workspace)
--   view:setState(state)          -- a State.State; rebuilds or reapplies as needed
--   RunService.RenderStepped: view:update(dt, sharedTime)
--   view:apply()                  -- after editing Config live
local Lighting = game:GetService("Lighting")
local Workspace = game:GetService("Workspace")

local Config = require(script.Parent.Config)
local Vortex = require(script.Parent.Vortex)
local State = require(script.Parent.State)

local FunnelView = {}
FunnelView.__index = FunnelView

-- Where one ring goes and how it looks (from Config + state; recomputed on apply).
type Slot = {
	kind: string, -- "funnel" | "base" (camera-facing rings) | "deck" (one flat disc of smoke) | "foot" (upright particles standing on the ground)
	t: number, -- height share on the funnel the ring hangs from
	gap: number, -- vertical thickness of the ring, studs
	radius: number, -- studs (layers sit at a share of this)
	inner: number, -- deck only: radius of its hole, studs
	y: number, -- studs above the funnel's centre at t
	color: Color3,
	fade: number, -- 0-1 opacity multiplier
	spin: number, -- x the funnel's spin
}

type Ring = {
	slot: Slot,
	parts: { BasePart },
	emitters: { ParticleEmitter },
	angles: { number },
	rates: { number }, -- radians/s per layer
	lift: { number }, -- studs: each layer's own height offset
}

export type FunnelView = typeof(setmetatable(
	{} :: {
		folder: Folder,
		rings: { Ring },
		state: State.State?,
		paused: boolean,
		frozen: boolean,
		signature: string,
		stats: { rings: number, emitters: number, particles: number },
		_groundClock: number?,
		_parts: { BasePart },
		_cframes: { CFrame },
	},
	FunnelView
))

function FunnelView.new(parent: Instance?): FunnelView
	local folder = Instance.new("Folder")
	folder.Name = "ParticleTornado"
	folder.Parent = parent or Workspace
	return setmetatable({
		folder = folder,
		rings = {},
		state = nil,
		paused = false,
		frozen = false,
		signature = "",
		stats = { rings = 0, emitters = 0, particles = 0 },
		_parts = {},
		_cframes = {},
	}, FunnelView)
end

local function smooth01(x: number): number
	x = math.clamp(x, 0, 1)
	return x * x * (3 - 2 * x)
end

local function layersFor(kind: string): { any }
	if kind == "base" then
		return Config.baseLayers
	elseif kind == "deck" then
		return Config.deckLayers
	elseif kind == "foot" then
		return Config.footLayers
	elseif kind == "shade" then
		return Config.shadeLayers
	elseif kind == "debris" then
		return Config.debrisLayers
	end
	return Config.layers
end

-- All the rings: up the funnel (spaced by the local radius so the narrow foot gets more, never
-- further apart than the largest particle can bridge, widened to keep to maxRings), then out
-- across the cloud base.
local function layout(state: State.State): { Slot }
	local F = Config.funnel
	local H = math.max(state.cloudBase, 1)
	local function walk(scale: number): { Slot }
		local list = {}
		local t = 0
		while t < 1 and #list < 400 do
			local r = State.radiusAt(state, t)
			local gap = math.min(F.ringSpacing * r, F.sizeMax / math.max(F.overlap, 0.1))
			gap = math.max(gap * scale, F.minSpacing)
			local fade = 1
			if F.groundFade > 0 then
				fade *= smooth01((t + 0.5 * gap / H) / F.groundFade)
			end
			if F.topFade > 0 then
				fade *= smooth01((1 - t) / F.topFade)
			end
			table.insert(list, {
				kind = "funnel",
				t = t,
				gap = gap,
				radius = r,
				inner = 0,
				y = 0,
				color = F.colorBottom:Lerp(F.colorTop, t ^ F.colorGamma),
				fade = fade,
				spin = 1,
			})
			-- step along the axis's length, not its height: a bent funnel (rope-out, elephant
			-- trunk) has long sideways stretches that would otherwise be left with gaps
			local here = State.centreAt(state, t, 0)
			local ahead = State.centreAt(state, math.min(t + 0.01, 1), 0)
			local span = math.max(math.min(t + 0.01, 1) - t, 1e-4)
			local studsPerT = math.max((ahead - here).Magnitude / span, H)
			t += gap / studsPerT
		end
		return list
	end
	local scale = 1
	local list = walk(scale)
	for _ = 1, 12 do
		if #list <= F.maxRings then
			break
		end
		scale *= #list / F.maxRings * 1.03
		list = walk(scale)
	end
	if Config.render.mode == "puffs" then
		list = {} -- PuffView draws the funnel body (and the shade band goes with the rings)
	end

	local B = Config.base
	local newBase = Config.render.mode == "puffs" and Config.cloudBase.enabled -- CloudBase draws it
	if B.enabled and B.rings > 0 and not newBase then
		local rTop = State.radiusAt(state, 1)
		local rOut = math.min(math.max(rTop * B.radius, B.minRadius or 0), B.maxRadius)
		if rOut > rTop then
			-- enough rings that the base's big particles meet across it
			local n = math.clamp(math.ceil((rOut - rTop) / (F.sizeMax * 0.2)), math.floor(B.rings), 16)
			for k = 1, n do
				local f = (k - 0.5) / n
				table.insert(list, {
					kind = "base",
					t = 1,
					gap = F.sizeMax * 0.2,
					radius = rTop + (rOut - rTop) * f,
					inner = 0,
					y = H * (B.rise * f - B.sag * (1 - f)),
					color = B.color:Lerp(B.edgeColor, f),
					fade = 1,
					spin = B.spin,
				})
			end
		end
	end

	-- the shade: a darker band down the funnel's shadow side (away from the sun, as the camera
	-- sees it), always drawn in front (ZOffset) so it never swaps order with the smoke behind it
	local Sh = Config.shade
	if Sh.enabled and #Config.shadeLayers > 0 then
		local funnelSlots = {}
		for _, s in list do
			if s.kind == "funnel" then
				table.insert(funnelSlots, s)
			end
		end
		for i = 1, #funnelSlots, math.max(1, math.floor(Sh.every)) do
			local s = funnelSlots[i]
			local c = s.color
			table.insert(list, {
				kind = "shade",
				t = s.t,
				gap = s.gap,
				radius = s.radius,
				inner = 0,
				y = 0,
				color = Color3.new(c.R * Sh.darken, c.G * Sh.darken, c.B * Sh.darken),
				fade = s.fade,
				spin = 0,
			})
		end
	end

	-- the debris cloud: dark dust round the contact (nearly every reference has one)
	local D = Config.debris
	if D.enabled and #Config.debrisLayers > 0 then
		table.insert(list, {
			kind = "debris",
			t = 0,
			gap = D.height,
			radius = State.radiusAt(state, 0) * D.radius,
			inner = 0,
			y = 0,
			color = D.color,
			fade = 1,
			spin = D.spin,
		})
	end

	-- the foot: upright particles with a flat bottom edge standing just above the ground, giving
	-- the funnel a firm contact without any particle cutting into the ground (cuts shimmer)
	if Config.foot.enabled and #Config.footLayers > 0 and (Config.render.mode ~= "puffs" or Config.foot.withPuffs) then
		table.insert(list, {
			kind = "foot",
			t = 0,
			gap = 1,
			radius = State.radiusAt(state, 0),
			inner = 0,
			y = 0,
			color = F.colorBottom,
			fade = 1,
			spin = 0,
		})
	end

	-- the cloud base's underside: flat sheets of smoke over a disc
	if Config.deck.enabled and #Config.deckLayers > 0 and not newBase then
		local rTop = State.radiusAt(state, 1)
		local rOut = math.min(math.max(rTop * B.radius, B.minRadius or 0), B.maxRadius)
		table.insert(list, {
			kind = "deck",
			t = 1,
			gap = 10,
			radius = math.max(rOut, rTop + 1),
			inner = rTop * Config.deck.hole,
			y = H * Config.deck.y,
			color = B.color,
			fade = 1,
			spin = B.spin,
		})
	end
	return list
end

local function signatureOf(slots: { Slot }): string
	local counts = { funnel = 0, base = 0, deck = 0, foot = 0, shade = 0, debris = 0 }
	for _, s in slots do
		counts[s.kind] += 1
	end
	return string.format(
		"%d/%d/%d/%d/%d/%d/%d/%d/%d/%d/%d/%d",
		counts.funnel,
		counts.base,
		counts.deck,
		counts.foot,
		counts.shade,
		counts.debris,
		#Config.layers,
		#Config.baseLayers,
		#Config.deckLayers,
		#Config.footLayers,
		#Config.shadeLayers,
		#Config.debrisLayers
	)
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
	e.ShapeStyle = Enum.ParticleEmitterShapeStyle.Surface
	e.ShapeInOut = Enum.ParticleEmitterShapeInOut.Outward
	e.Speed = NumberRange.new(0)
	e.Acceleration = Vector3.zero
	e.Drag = 0
	e.LockedToPart = true
	e.Orientation = Enum.ParticleOrientation.FacingCamera
	e.FlipbookMode = Enum.ParticleFlipbookMode.Loop
	e.FlipbookStartRandom = true
	e.FlipbookBlendFrames = true
	e.LightEmission = 0
	return e
end

function FunnelView.clear(self: FunnelView)
	for _, ring in self.rings do
		for _, p in ring.parts do
			p:Destroy()
		end
	end
	table.clear(self.rings)
	table.clear(self._parts)
	table.clear(self._cframes)
end

function FunnelView.rebuild(self: FunnelView, slots: { Slot }?)
	self:clear()
	local state = self.state
	if not state then
		return
	end
	local list = slots or layout(state)
	self.signature = signatureOf(list)
	for i, slot in list do
		local ring: Ring = { slot = slot, parts = {}, emitters = {}, angles = {}, rates = {}, lift = {} }
		for l, layer in layersFor(slot.kind) do
			local part = newPart()
			local prefix = if slot.kind == "base"
				then "Base"
				elseif slot.kind == "deck" then "Deck"
				elseif slot.kind == "foot" then "Foot"
				elseif slot.kind == "shade" then "Shade"
				elseif slot.kind == "debris" then "Debris"
				else "Ring"
			part.Name = string.format("%s%02d_%s", prefix, i, layer.name)
			local e = newEmitter()
			e.Parent = part
			part.Parent = self.folder
			ring.parts[l] = part
			ring.emitters[l] = e
			ring.angles[l] = (i * 2.399 + l * 1.1) % (2 * math.pi) -- golden-angle starts: no aligned seams
			ring.rates[l] = 0
			ring.lift[l] = 0
			table.insert(self._parts, part)
			table.insert(self._cframes, CFrame.identity)
		end
		table.insert(self.rings, ring)
	end
	self:apply()
end

local function mulColor(c: Color3, tint: Color3?, k: number): Color3
	local t = tint or Color3.new(1, 1, 1)
	return Color3.new(math.clamp(c.R * t.R * k, 0, 1), math.clamp(c.G * t.G * k, 0, 1), math.clamp(c.B * t.B * k, 0, 1))
end

-- Push Config + state into every emitter. Rebuilds when the ring or layer counts changed.
function FunnelView.apply(self: FunnelView)
	local state = self.state
	if not state then
		return
	end
	local slots = layout(state)
	if signatureOf(slots) ~= self.signature then
		self:rebuild(slots) -- calls apply again
		return
	end
	local F = Config.funnel
	local particles, emitters = 0, 0
	for i, ring in self.rings do
		local slot = slots[i]
		ring.slot = slot
		for l, layer in layersFor(slot.kind) do
			local part, e = ring.parts[l], ring.emitters[l]
			local R = math.max(slot.radius * layer.radius, 0.25)
			local size, count
			if slot.kind == "deck" then
				-- flat quads lying across a disc (VelocityPerpendicular to a slow upward drift)
				size = math.clamp(F.sizeMax * layer.size, 0.2, F.sizeMax)
				local inner = math.min(slot.inner, R * 0.95)
				count = math.clamp(layer.density * math.pi * (R * R - inner * inner) / (size * size), F.minPerEmitter, math.max(Config.deck.maxParticles, F.minPerEmitter))
				e.Shape = Enum.ParticleEmitterShape.Disc
				e.ShapeStyle = Enum.ParticleEmitterShapeStyle.Volume
				e.ShapePartial = inner / R
				e.EmissionDirection = Enum.NormalId.Top
				e.Speed = NumberRange.new(math.max(Config.deck.drift, 0.2))
				e.Orientation = Enum.ParticleOrientation.VelocityPerpendicular
			elseif slot.kind == "foot" then
				size = math.clamp(slot.radius * layer.size, 0.2, F.sizeMax)
				count = math.clamp(layer.density * 2 * math.pi * R / size, F.minPerEmitter, math.max(F.maxPerEmitter, F.minPerEmitter))
				e.Orientation = Enum.ParticleOrientation.FacingCameraWorldUp -- upright, so the flat bottom stays level
			else
				if slot.kind == "base" then
					size = math.clamp(F.sizeMax * layer.size, 0.2, F.sizeMax)
				else
					size = math.clamp(math.max(slot.radius * layer.size, slot.gap * F.overlap), 0.2, F.sizeMax)
				end
				count = math.clamp(layer.density * 2 * math.pi * R / size, F.minPerEmitter, math.max(F.maxPerEmitter, F.minPerEmitter))
				e.Orientation = if layer.upright
					then Enum.ParticleOrientation.FacingCameraWorldUp
					else Enum.ParticleOrientation.FacingCamera
			end
			part.Size = Vector3.new(math.min(2 * R, 2048), math.min(slot.gap, 2048), math.min(2 * R, 2048))
			local life = math.max(layer.lifetime, 0.1)
			local opacity = if layer.enabled == false then 0 else math.clamp(layer.opacity * slot.fade, 0, 1)
			local fi = math.clamp(layer.fadeIn, 0.01, 0.48)
			local fo = math.clamp(layer.fadeOut, 0.01, 0.48)

			local texName = if F.useBuiltinTexture then "builtin" else layer.texture
			e.Texture = Config.textures[texName] or texName
			e.FlipbookLayout = if Config.SHEETS[texName] then Enum.ParticleFlipbookLayout.Grid4x4 else Enum.ParticleFlipbookLayout.None
			e.Rate = if opacity > 0.002 then count / life else 0
			e.Lifetime = NumberRange.new(life * 0.8, life * 1.2)
			-- sizes here are studs across; Roblox draws a particle about twice its Size across
			local k = F.sizeScale
			e.Size = NumberSequence.new({
				NumberSequenceKeypoint.new(0, size * k),
				NumberSequenceKeypoint.new(1, math.min(size * layer.grow, F.sizeMax) * k),
			})
			e.Transparency = NumberSequence.new({
				NumberSequenceKeypoint.new(0, 1),
				NumberSequenceKeypoint.new(fi, 1 - opacity),
				NumberSequenceKeypoint.new(1 - fo, 1 - opacity),
				NumberSequenceKeypoint.new(1, 1),
			})
			e.Squash = NumberSequence.new(math.clamp(layer.squash, -3, 3))
			local baseColor = slot.color
			if slot.kind == "debris" and Config.debris.groundDust then
				baseColor = slot.color:Lerp(Config.debris.groundDust :: Color3, Config.debris.groundShare)
			end
			e.Color = ColorSequence.new(mulColor(baseColor, layer.tint, layer.shade))
			e.Rotation = NumberRange.new(-layer.rotation, layer.rotation)
			e.RotSpeed = NumberRange.new(-layer.rotSpeed, layer.rotSpeed)
			local fps = math.clamp(layer.flipFps, 0, 30)
			e.FlipbookFramerate = NumberRange.new(fps * 0.8, math.min(fps * 1.2, 30))
			e.LightInfluence = F.lightInfluence
			e.Brightness = F.brightness
			-- the debris is drawn in front of the funnel: dark dust rising through the white funnel's
			-- foot would otherwise swap draw order with its puffs and show their round edges
			e.ZOffset = if slot.kind == "shade"
				then slot.radius * Config.shade.zOffset
				elseif slot.kind == "debris" then slot.radius * (Config.debris.zFront or 0) + layer.zOffset
				else layer.zOffset
			e.TimeScale = if self.frozen then 0 else 1

			-- one rate per ring, from the funnel's radius there: every layer of a ring turns together
			-- (a rate per layer from its own small radius whipped the near-axis core round a tiny
			-- circle, which read as jitter)
			ring.rates[l] = (if Config.render.mode == "puffs" then Vortex.spinRate(state, slot.radius) else math.min(F.spinSpeed / math.max(slot.radius, 1), F.maxSpinRate))
				* slot.spin
				* (layer.spin or 1)
			local lift = slot.y + (layer.y or 0)
			if slot.kind == "foot" then
				lift += size * 0.5 + Config.foot.lift -- the bottom edge just above the ground
			elseif slot.kind == "funnel" or slot.kind == "shade" or slot.kind == "debris" then
				-- Keep each particle's dense middle above the ground: the ground cuts particles with a
				-- hard line that moves as they orbit, spawn and fade (flicker at the contact). Only the
				-- faint outer groundSink share of a particle may sit below it.
				local reach = size * math.max(layer.grow, 1) * (layer.tall or 0.5)
				local bottom = slot.t * state.cloudBase + lift - slot.gap * 0.5 - reach
				local floor = F.groundClear - F.groundSink * size
				if bottom < floor then
					lift += floor - bottom
				end
			end
			if slot.kind == "debris" then
				-- thrown up from the ground: born small just above it, billowing up and out, growing
				local start = size * (layer.startSize or 1)
				e.LockedToPart = layer.locked ~= false -- carried round with the spinning ring: the dust swirls
				e.EmissionDirection = Enum.NormalId.Top
				e.Speed = NumberRange.new((layer.rise or 0) * 0.5, layer.rise or 0)
				e.SpreadAngle = Vector2.new(layer.spread or 0, layer.spread or 0)
				e.Drag = layer.drag or 0
				e.Size = NumberSequence.new({
					NumberSequenceKeypoint.new(0, start * k),
					NumberSequenceKeypoint.new(1, math.min(size * layer.grow, F.sizeMax) * k),
				})
				lift = slot.y + (layer.y or 0) + start * 0.5 + F.groundClear
			end
			ring.lift[l] = lift
			if e.Rate > 0 then
				particles += count
				emitters += 1
			end
		end
	end
	self.stats.rings = #self.rings
	self.stats.emitters = emitters
	self.stats.particles = math.floor(particles + 0.5)
end

-- A state that changes every frame: positions follow in update(); call apply() now and then.
function FunnelView.setLive(self: FunnelView, state: State.State)
	self.state = state
end

function FunnelView.setState(self: FunnelView, state: State.State)
	self.state = state
	self:apply()
end

-- Freeze the smoke (and the spin) for still-frame comparisons.
function FunnelView.setFrozen(self: FunnelView, frozen: boolean)
	self.frozen = frozen
	for _, ring in self.rings do
		for _, e in ring.emitters do
			e.TimeScale = if frozen then 0 else 1
		end
	end
end

-- Spin and place the rings. time = shared clock (seconds), for the seeded wobble.
-- The dust colour for the ground material under the contact.
local function groundDustAt(pos: Vector3, ignore: { Instance }): Color3?
	local params = RaycastParams.new()
	params.FilterType = Enum.RaycastFilterType.Exclude
	params.FilterDescendantsInstances = ignore
	local hit = Workspace:Raycast(pos + Vector3.new(0, 300, 0), Vector3.new(0, -600, 0), params)
	if not hit then
		return nil
	end
	local G, m = Config.groundDust, hit.Material
	local M = Enum.Material
	if m == M.Sand or m == M.Sandstone then
		return G.sand
	elseif m == M.Snow or m == M.Glacier or m == M.Ice then
		return G.snow
	elseif m == M.Concrete or m == M.Asphalt or m == M.Pavement or m == M.Brick or m == M.Cobblestone or m == M.Slate or m == M.Rock or m == M.Basalt then
		return G.rubble
	elseif m == M.Plastic or m == M.SmoothPlastic then
		-- unmarked parts (the lab's field): go by colour, green = grass
		local c = if hit.Instance:IsA("BasePart") then (hit.Instance :: BasePart).Color else Color3.new(0.5, 0.5, 0.5)
		if c.G > c.R and c.G > c.B then
			return G.soil
		end
		return G.rubble
	end
	return G.soil -- grass, leafy grass, ground, mud and the rest
end

function FunnelView.update(self: FunnelView, dt: number, time: number)
	local state = self.state
	if not state then
		return
	end
	-- the dust colour follows the ground under the contact (sampled about once a second)
	self._groundClock = (self._groundClock or 0) - dt
	if Config.debris.enabled and self._groundClock <= 0 then
		self._groundClock = 1
		local dust = groundDustAt(state.position, { self.folder })
		local old = Config.debris.groundDust
		if dust and (not old or (old :: Color3):ToHex() ~= dust:ToHex()) then
			Config.debris.groundDust = dust
			self:apply()
		end
	end
	local spin = not (self.paused or self.frozen)
	-- the shadow side, as the camera sees it: away from the sun across the view
	local camera = Workspace.CurrentCamera
	local right = camera and Vector3.new(camera.CFrame.RightVector.X, 0, camera.CFrame.RightVector.Z) or Vector3.xAxis
	right = if right.Magnitude > 1e-3 then right.Unit else Vector3.xAxis
	local shadowSide = if Lighting:GetSunDirection():Dot(right) > 0 then -right else right
	local k = 0
	for _, ring in self.rings do
		local slot = ring.slot
		local centre = State.centreAt(state, slot.t, time)
		local tilt = if slot.kind == "funnel"
			then CFrame.fromRotationBetweenVectors(Vector3.yAxis, State.axisAt(state, slot.t, time))
			else CFrame.identity
		if slot.kind == "shade" then
			centre += shadowSide * slot.radius * Config.shade.offset
		end
		if slot.kind == "debris" then
			-- drawn in front of the funnel, but never pushed more than half way to the camera
			local cam = Workspace.CurrentCamera
			local half = if cam then (cam.CFrame.Position - centre).Magnitude * 0.5 else math.huge
			for l, e in ring.emitters do
				local layer = Config.debrisLayers[l]
				e.ZOffset = math.min(slot.radius * (Config.debris.zFront or 0), half) + (if layer then layer.zOffset else 0)
			end
			-- the dust whirl goes as the funnel lifts back into the cloud (and comes before it
			-- touches down): faded by how high the condensation funnel's tip is
			local x = math.clamp(((state.bottom or 0) - 0.55) / 0.4, 0, 1)
			local fade = x * x * (3 - 2 * x)
			for _, e in ring.emitters do
				e.LocalTransparencyModifier = fade
			end
		end
		for l, part in ring.parts do
			if spin then
				ring.angles[l] = (ring.angles[l] + ring.rates[l] * dt) % (2 * math.pi)
			end
			k += 1
			self._parts[k] = part
			self._cframes[k] = CFrame.new(centre + Vector3.new(0, ring.lift[l], 0)) * tilt * CFrame.Angles(0, ring.angles[l], 0)
		end
	end
	Workspace:BulkMoveTo(self._parts, self._cframes, Enum.BulkMoveMode.FireCFrameChanged)
end

function FunnelView.destroy(self: FunnelView)
	self:clear()
	self.folder:Destroy()
end

return FunnelView
