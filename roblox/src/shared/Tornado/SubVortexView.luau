--!strict
-- Sub-vortices (client only): dark spinning blobs inside a wide funnel. In the wedge references
-- (clip_3JXLF0nN0n, clip_iOvAj0as2Z) darker blue-black masses sweep round inside the lighter body
-- and come and go every few seconds; real multiple-vortex tornadoes have 2-6, orbiting at about the
-- parent's peak wind, most lasting seconds (docs/tornado-reference/NOTES.md, motion research).
--
-- Each sub-vortex is a short chain of dark puffs up the lower funnel, orbiting at a share of the
-- funnel's radius a little faster than the funnel turns, fading in and out over its life. They
-- are drawn in front of the funnel (ZOffset), so they never swap draw order with its puffs (no
-- flicker); to stay believable they fade out as they swing round to the far side, so they appear
-- to sweep across the near face and vanish round the limb. How many depends on the funnel's width
-- (narrow funnels have none). Seeded from the tornado's seed and the shared clock, so every client
-- sees the same ones.
--
--   local subs = SubVortexView.new(workspace)
--   subs:setState(state) / subs:setLive(state); RenderStepped: subs:update(dt, time)
local Workspace = game:GetService("Workspace")

local Config = require(script.Parent.Config)
local FarSprite = require(script.Parent.FarSprite)
local Ribbon = require(script.Parent.Ribbon)
local State = require(script.Parent.State)
local Vortex = require(script.Parent.Vortex)

local SubVortexView = {}
SubVortexView.__index = SubVortexView

type Vortex = {
	ribbon: Ribbon.Ribbon?, -- drawn as a thin ribbon (with the ribbon funnel) instead of puffs
	building: boolean?,
	parts: { BasePart },
	emitters: { ParticleEmitter },
	angle: number,
	rate: number, -- x the funnel's spin
	share: number, -- orbit radius, x the funnel's radius
	top: number, -- highest node, share of the height
	age: number,
	life: number,
}

export type SubVortexView = typeof(setmetatable(
	{} :: {
		folder: Folder,
		vortices: { Vortex },
		state: State.State?,
		rng: Random,
		frozen: boolean,
		paused: boolean,
		_parts: { BasePart },
		_cframes: { CFrame },
	},
	SubVortexView
))

function SubVortexView.new(parent: Instance?): SubVortexView
	local folder = Instance.new("Folder")
	folder.Name = "SubVortices"
	folder.Parent = parent or Workspace
	return setmetatable({
		folder = folder,
		vortices = {},
		state = nil,
		rng = Random.new(1),
		frozen = false,
		paused = false,
		_parts = {},
		_cframes = {},
	}, SubVortexView)
end

local function smooth01(x: number): number
	x = math.clamp(x, 0, 1)
	return x * x * (3 - 2 * x)
end

local function enabled(): boolean
	return Config.render.mode == "puffs" and Config.subVortex.enabled
end

-- How many sub-vortices a funnel this wide has.
local function wanted(state: State.State): number
	local S = Config.subVortex
	local n = (state.width - S.minWidth) / math.max(S.widthPer, 1)
	return math.clamp(math.floor(n + 0.5), 0, S.max)
end

local function newPart(): Part
	local p = Instance.new("Part")
	p.Anchored = true
	p.CanCollide = false
	p.CanQuery = false
	p.CanTouch = false
	p.CastShadow = false
	p.Transparency = 1
	p.Shape = Enum.PartType.Ball
	p.Size = Vector3.one
	p.Locked = true
	return p
end

local function newEmitter(): ParticleEmitter
	local e = Instance.new("ParticleEmitter")
	e.Shape = Enum.ParticleEmitterShape.Sphere
	e.ShapeStyle = Enum.ParticleEmitterShapeStyle.Volume
	e.SpreadAngle = Vector2.new(360, 360)
	e.Speed = NumberRange.new(0)
	e.Drag = 1
	e.LockedToPart = true
	e.FlipbookMode = Enum.ParticleFlipbookMode.Loop
	e.FlipbookStartRandom = true
	e.FlipbookBlendFrames = true
	e.LightEmission = 0
	return e
end

local function spawnVortex(self: SubVortexView, v: Vortex?, fresh: boolean): Vortex
	local S = Config.subVortex
	local rng = self.rng
	local out: Vortex = v or { parts = {}, emitters = {}, angle = 0, rate = 1, share = 0.7, top = 0.5, age = 0, life = 10 }
	out.angle = rng:NextNumber(0, 2 * math.pi)
	out.rate = rng:NextNumber(S.rate[1], S.rate[2])
	out.share = rng:NextNumber(S.orbit[1], S.orbit[2])
	out.top = rng:NextNumber(S.top[1], S.top[2])
	out.life = rng:NextNumber(S.life[1], S.life[2])
	-- staggered at the start, so they don't all fade in together
	out.age = if fresh then rng:NextNumber(0, out.life) else 0
	if #out.parts == 0 then
		for i = 1, math.max(math.floor(S.nodes), 1) do
			local part = newPart()
			part.Name = "SubVortexNode" .. i
			local e = newEmitter()
			e.Parent = part
			part.Parent = self.folder
			out.parts[i] = part
			out.emitters[i] = e
		end
	end
	for _, e in out.emitters do
		e:Clear()
	end
	return out
end

function SubVortexView.clear(self: SubVortexView)
	for _, v in self.vortices do
		for _, p in v.parts do
			p:Destroy()
		end
		if v.ribbon then
			v.ribbon:destroy()
		end
	end
	table.clear(self.vortices)
end

-- With the ribbon funnel, each sub-vortex is a thin ribbon too (no round puffs).
local function ribbonMode(): boolean
	return Config.ribbonFunnel.enabled and Config.subVortex.ribbon.enabled
end

local function ensureRibbon(self: SubVortexView, v: Vortex)
	if v.ribbon or v.building then
		return
	end
	v.building = true
	task.spawn(function()
		local R = Config.subVortex.ribbon
		local built = Ribbon.build(self.folder, R.levels, R.columns, Config.ribbonFunnel.bounds, "SubVortex", nil)
		v.building = false
		-- gone meanwhile (cleared, or ribbon mode switched off)?
		if not table.find(self.vortices, v) or not ribbonMode() then
			if built then
				built:destroy()
			end
			return
		end
		v.ribbon = built
	end)
end

-- Look and count (everything but per-frame placement).
function SubVortexView.apply(self: SubVortexView)
	local state = self.state
	if not state or not enabled() then
		self:clear()
		return
	end
	local S = Config.subVortex
	local n = wanted(state)
	while #self.vortices > n do
		local v = table.remove(self.vortices) :: Vortex
		for _, p in v.parts do
			p:Destroy()
		end
		if v.ribbon then
			v.ribbon:destroy()
		end
	end
	while #self.vortices < n do
		table.insert(self.vortices, spawnVortex(self, nil, true))
	end
	local F, P = Config.funnel, Config.puffs
	local k = F.sizeScale
	local color = F.colorBottom:Lerp(F.colorTop, 0.3)
	color = Color3.new(color.R * S.shade, color.G * S.shade, color.B * S.shade):Lerp(S.tint, S.tintShare)
	local r0 = State.radiusAt(state, 0)
	local size = math.min(r0 * S.size * 2, F.sizeMax)
	local life = math.max(S.puffLife, 0.1)
	for _, v in self.vortices do
		for _, e in v.emitters do
			e.Texture = Config.textures[S.texture] or S.texture
			e.FlipbookLayout = if Config.SHEETS[S.texture] then Enum.ParticleFlipbookLayout.Grid4x4 else Enum.ParticleFlipbookLayout.None
			e.FlipbookFramerate = NumberRange.new(2, 3)
			e.Rate = S.count / life
			e.Lifetime = NumberRange.new(life * 0.8, life * 1.2)
			e.Size = NumberSequence.new({
				NumberSequenceKeypoint.new(0, size * k * 0.8, size * k * 0.15),
				NumberSequenceKeypoint.new(1, size * k * 1.1, size * k * 0.15),
			})
			e.Transparency = NumberSequence.new({
				NumberSequenceKeypoint.new(0, 1),
				NumberSequenceKeypoint.new(0.3, 1 - S.opacity),
				NumberSequenceKeypoint.new(0.6, 1 - S.opacity),
				NumberSequenceKeypoint.new(1, 1),
			})
			e.Color = ColorSequence.new(color)
			e.Rotation = NumberRange.new(-180, 180)
			e.RotSpeed = NumberRange.new(-20, 20)
			e.LightInfluence = P.lightInfluence
			e.Brightness = P.brightness
			e.TimeScale = if self.frozen then 0 else 1
			e.Enabled = not ribbonMode()
			if ribbonMode() then
				e:Clear()
			end
		end
		if ribbonMode() then
			ensureRibbon(self, v)
		elseif v.ribbon then
			v.ribbon:destroy()
			v.ribbon = nil
		end
		for _, p in v.parts do
			p.Size = Vector3.one * math.max(size * 0.3, 1)
		end
	end
end

function SubVortexView.setState(self: SubVortexView, state: State.State)
	if not self.state or self.state.seed ~= state.seed then
		self.rng = Random.new(state.seed * 7919 + 17)
	end
	self.state = state
	self:apply()
end

function SubVortexView.setLive(self: SubVortexView, state: State.State)
	self.state = state
end

function SubVortexView.setFrozen(self: SubVortexView, frozen: boolean)
	self.frozen = frozen
	for _, v in self.vortices do
		for _, e in v.emitters do
			e.TimeScale = if frozen then 0 else 1
		end
	end
end

function SubVortexView.update(self: SubVortexView, dt: number, time: number)
	local state = self.state
	if not state or #self.vortices == 0 then
		return
	end
	local S, P = Config.subVortex, Config.puffs
	local moving = not (self.paused or self.frozen)
	local camera = Workspace.CurrentCamera
	local eye = if camera then camera.CFrame.Position else Vector3.zero
	local bottom = state.bottom or 0
	local fade = math.max(S.fade, 0.05)
	table.clear(self._parts)
	table.clear(self._cframes)
	local k = 0
	for i, v in self.vortices do
		if moving then
			v.age += dt
			if v.age >= v.life then
				self.vortices[i] = spawnVortex(self, v, false)
			end
		end
		local envelope = smooth01(v.age / fade) * smooth01((v.life - v.age) / fade)
		local ribbon = v.ribbon
		if ribbon and ribbonMode() then
			-- a thin ribbon curling up the lower funnel, drawn in front of the funnel's ribbon
			local RS = S.ribbon
			local nL = RS.levels
			local pts, radii, colours, alphas = table.create(nL), table.create(nL, 0), table.create(nL), table.create(nL, 0)
			local F = Config.funnel
			local base = F.colorBottom:Lerp(F.colorTop, 0.3)
			base = Color3.new(base.R * S.shade, base.G * S.shade, base.B * S.shade):Lerp(S.tint, S.tintShare)
			local r0 = State.radiusAt(state, 0, time)
			local ground = State.centreAt(state, 0, time)
			local toEye0 = Vector3.new(eye.X - ground.X, 0, eye.Z - ground.Z)
			toEye0 = if toEye0.Magnitude > 1e-3 then toEye0.Unit else Vector3.zAxis
			if moving then
				v.angle = (v.angle + Vortex.spinRate(state, r0) * v.rate * dt) % (2 * math.pi)
			end
			for j = 1, nL do
				local s = (j - 1) / (nL - 1)
				local t = s * v.top
				local r = State.radiusAt(state, t, time)
				local centre = State.centreAt(state, t, time)
				local a = v.angle - t * S.twist
				local radial = Vector3.new(math.cos(a), 0, math.sin(a))
				local pos = centre + radial * r * v.share
				local toEye = Vector3.new(eye.X - centre.X, 0, eye.Z - centre.Z)
				local facing = if toEye.Magnitude > 1e-3 then radial:Dot(toEye.Unit) else 1
				local near = smooth01((facing + S.limb) / (2 * S.limb))
				-- just in front of the funnel's surface on the near side
				pts[j] = pos + toEye0 * (r * RS.front)
				if j == 1 and bottom <= 0.001 then
					pts[j] -= Vector3.new(0, RS.width * r0, 0)
				end
				radii[j] = r0 * RS.width * (1 - RS.taper * s)
				colours[j] = base
				local top = 1 - smooth01((s - 0.6) / 0.4)
				local lift = if bottom > 0 then 1 + (smooth01((t - bottom) / 0.05) - 1) * smooth01(bottom / 0.05) else 1
				alphas[j] = RS.opacity * envelope * near * top * lift * (1 - FarSprite.weight(eye, pos))
			end
			-- the part sits nearer the camera than the funnel's, so it sorts in front
			ribbon:place(ground + toEye0 * (r0 * (1 + RS.front)), pts, radii, colours, alphas, RS.look)
			continue
		end
		local n = #v.parts
		for j, part in v.parts do
			local t = (j - 0.5) / n * v.top
			local r = State.radiusAt(state, t, time)
			local centre = State.centreAt(state, t, time)
			if moving and j == 1 then
				local spin = Vortex.spinRate(state, r)
				v.angle = (v.angle + spin * v.rate * dt) % (2 * math.pi)
			end
			-- a slight twist up the chain, so it reads as a curling column, not a stack
			local a = v.angle - t * S.twist
			local radial = Vector3.new(math.cos(a), 0, math.sin(a))
			local pos = centre + radial * r * v.share
			-- in front of the funnel: drawn over it (no draw-order swaps) ...
			local zFront = math.min(r * S.zFront, (eye - pos).Magnitude * 0.5)
			-- ... and so fading out on the far side, where it would be hidden
			local toEye = eye - centre
			toEye = Vector3.new(toEye.X, 0, toEye.Z)
			local facing = if toEye.Magnitude > 1e-3 then radial:Dot(toEye.Unit) else 1
			local near = smooth01((facing + S.limb) / (2 * S.limb))
			local visible = envelope * near * (1 - FarSprite.weight(eye, pos))
			if bottom > 0 then
				visible *= 1 + (smooth01((t - bottom) / 0.05) - 1) * smooth01(bottom / 0.05)
			end
			local e = v.emitters[j]
			e.ZOffset = zFront
			e.LocalTransparencyModifier = 1 - visible
			k += 1
			self._parts[k] = part
			self._cframes[k] = CFrame.new(pos)
		end
	end
	Workspace:BulkMoveTo(self._parts, self._cframes, Enum.BulkMoveMode.FireCFrameChanged)
end

function SubVortexView.destroy(self: SubVortexView)
	self:clear()
	self.folder:Destroy()
end

return SubVortexView
