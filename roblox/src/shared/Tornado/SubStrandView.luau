--!strict
-- Sub-vortex strands (client only): where the condensation funnel hasn't reached the ground (a
-- lowered or lifting funnel), the vortices underneath show as thin dark strands of dust and
-- cloud curling from the ground up into the funnel's base: chains of small soft puffs, spaced so
-- they read as dotted lines (references ref5_subs1.png, ref6_subs.png, ref2_image2.png). Real
-- multiple-vortex touchdowns look like this: 2-4 narrow vortices orbiting under the parent.
--
-- Each strand is a chain of small puffs (one emitter per node, locked to it, so each puff stays a
-- dot) along a path from the ground to the funnel's bottom: orbiting the axis, converging on the
-- funnel's tip as it rises, curling (a twist and a slow wiggle). Strands are born and fade out
-- over a few seconds each and orbit at the air's angular speed.
--
--   local strands = SubStrandView.new(workspace)
--   strands:setLive(state); RenderStepped: strands:update(dt, time)
local Workspace = game:GetService("Workspace")

local Config = require(script.Parent.Config)
local State = require(script.Parent.State)
local Vortex = require(script.Parent.Vortex)

local SubStrandView = {}
SubStrandView.__index = SubStrandView

type Strand = {
	parts: { BasePart },
	emitters: { ParticleEmitter },
	angle: number,
	rate: number,
	orbit: number, -- x the funnel's radius at its bottom
	age: number,
	life: number,
	seed: number,
}

export type SubStrandView = typeof(setmetatable(
	{} :: {
		folder: Folder,
		strands: { Strand },
		state: State.State?,
		rng: Random,
		frozen: boolean,
		_parts: { BasePart },
		_cframes: { CFrame },
		applied: string?,
	},
	SubStrandView
))

function SubStrandView.new(parent: Instance?): SubStrandView
	local folder = Instance.new("Folder")
	folder.Name = "SubStrands"
	folder.Parent = parent or Workspace
	return setmetatable({
		folder = folder, strands = {}, state = nil, rng = Random.new(11), frozen = false,
		_parts = {}, _cframes = {}, applied = nil,
	}, SubStrandView)
end

function SubStrandView.setLive(self: SubStrandView, state: State.State)
	self.state = state
end
SubStrandView.setState = SubStrandView.setLive

function SubStrandView.setFrozen(self: SubStrandView, frozen: boolean)
	self.frozen = frozen
	for _, s in self.strands do
		for _, e in s.emitters do
			e.TimeScale = if frozen then 0 else 1
		end
	end
end

local function smooth01(x: number): number
	x = math.clamp(x, 0, 1)
	return x * x * (3 - 2 * x)
end

local function newStrand(self: SubStrandView): Strand
	local S = Config.subStrands
	local strand: Strand = { parts = {}, emitters = {}, angle = 0, rate = 1, orbit = 0.5, age = 0, life = 8, seed = 0 }
	for i = 1, S.nodes do
		local part = Instance.new("Part")
		part.Name = "StrandNode" .. i
		part.Anchored, part.CanCollide, part.CanQuery, part.CanTouch = true, false, false, false
		part.Transparency = 1
		part.Size = Vector3.one
		local e = Instance.new("ParticleEmitter")
		e.LockedToPart = true -- each puff stays a dot on its node
		e.Speed = NumberRange.new(0)
		e.Rotation = NumberRange.new(-180, 180)
		e.RotSpeed = NumberRange.new(-30, 30)
		e.LightInfluence = 1
		e.Parent = part
		part.Parent = self.folder
		strand.parts[i] = part
		strand.emitters[i] = e
	end
	return strand
end

local function respawn(self: SubStrandView, s: Strand, fresh: boolean)
	local S = Config.subStrands
	local rng = self.rng
	s.angle = rng:NextNumber(0, 2 * math.pi)
	s.rate = rng:NextNumber(S.rate[1], S.rate[2])
	s.orbit = rng:NextNumber(S.orbit[1], S.orbit[2])
	s.life = rng:NextNumber(S.life[1], S.life[2])
	s.age = if fresh then rng:NextNumber(0, s.life) else 0
	s.seed = rng:NextNumber(0, 1000)
end

function SubStrandView.clear(self: SubStrandView)
	for _, s in self.strands do
		for _, p in s.parts do
			p:Destroy()
		end
	end
	table.clear(self.strands)
	self.applied = nil
end

-- How many strands: from the swirl ratio (one vortex at low swirl; more as the vortex breaks down
-- into several, as in lab and Doppler-observed multiple-vortex tornadoes); none when the funnel
-- reaches the ground.
local function wanted(state: State.State): number
	local S = Config.subStrands
	if not S.enabled or (state.bottom or 0) < S.minBottom then
		return 0
	end
	return math.clamp(math.floor(1 + S.perSwirl * Vortex.swirl(state)), 1, S.max)
end

-- Emitter looks (size, colour, rate) for the current funnel.
local function applyLook(self: SubStrandView, state: State.State)
	local S = Config.subStrands
	-- scaled by the funnel's width (its tip is too thin a measure)
	local r0 = state.width * 0.5
	local size = math.clamp(r0 * S.size, S.minSize, S.maxSize)
	local key = string.format("%.1f/%d", size, #self.strands)
	if self.applied == key then
		return
	end
	self.applied = key
	local F = Config.funnel
	local colour = F.colorBottom:Lerp(S.tint, S.tintShare)
	colour = Color3.new(colour.R * S.shade, colour.G * S.shade, colour.B * S.shade)
	for _, s in self.strands do
		for _, e in s.emitters do
			e.Texture = Config.textures[S.texture] or S.texture
			e.FlipbookLayout = if Config.SHEETS[S.texture] then Enum.ParticleFlipbookLayout.Grid4x4 else Enum.ParticleFlipbookLayout.None
			-- looped and blended from a random start (Random mode jumps between frames: visible pops)
			e.FlipbookMode = Enum.ParticleFlipbookMode.Loop
			e.FlipbookStartRandom = true
			e.FlipbookBlendFrames = true
			e.FlipbookFramerate = NumberRange.new(1, 2)
			e.Lifetime = NumberRange.new(S.puffLife * 0.8, S.puffLife * 1.2)
			e.Rate = S.puffs / S.puffLife
			e.Size = NumberSequence.new({
				NumberSequenceKeypoint.new(0, size * 0.8, size * 0.15),
				NumberSequenceKeypoint.new(1, size * 1.1, size * 0.15),
			})
			e.Color = ColorSequence.new(colour)
		end
	end
end

function SubStrandView.update(self: SubStrandView, dt: number, time: number)
	local S = Config.subStrands
	local state = self.state
	if not state then
		return
	end
	local n = wanted(state)
	while #self.strands > n do
		local s = table.remove(self.strands) :: Strand
		for _, p in s.parts do
			p:Destroy()
		end
		self.applied = nil
	end
	while #self.strands < n do
		local s = newStrand(self)
		respawn(self, s, true)
		table.insert(self.strands, s)
		self.applied = nil
	end
	if n == 0 then
		return
	end
	applyLook(self, state)
	local bottom = math.clamp(state.bottom or 0, 0, 1)
	-- fade in as the gap under the funnel opens
	local gap = smooth01((bottom - S.minBottom) / math.max(S.minBottom, 0.01))
	local rTip = state.width * 0.5 -- the strands spread about as wide as the funnel
	local spin = Vortex.spinRate(state, math.max(rTip, 1))
	local fade = math.max(S.fade, 0.05)
	local tm = time % 8192
	table.clear(self._parts)
	table.clear(self._cframes)
	for _, s in self.strands do
		if not self.frozen then
			s.age += dt
			if s.age >= s.life then
				respawn(self, s, false)
			end
			s.angle = (s.angle + spin * s.rate * dt) % (2 * math.pi)
		end
		local envelope = smooth01(s.age / fade) * smooth01((s.life - s.age) / fade) * gap
		local nodes = #s.parts
		for j, part in s.parts do
			local u = (j - 1) / math.max(nodes - 1, 1) -- 0 at the ground, 1 at the funnel's bottom
			local t = u * bottom * S.reach
			local centre = State.centreAt(state, t, time)
			-- orbiting, converging on the funnel's tip as it rises, curling and wiggling
			local a = s.angle + S.twist * u + S.wiggle * math.noise(s.seed, u * 2.5, tm * 0.3)
			local r = rTip * s.orbit * (1 - S.converge * u) + S.spread * rTip * (1 - u)
			local pos = centre + Vector3.new(math.cos(a), 0, math.sin(a)) * r
			self._parts[#self._parts + 1] = part
			self._cframes[#self._cframes + 1] = CFrame.new(pos)
			-- denser low down (dust) and where it joins the funnel; thin and faint between
			local alpha = S.opacity * envelope * (0.6 + 0.4 * (1 - u)) * (1 - smooth01((u - 0.9) / 0.1) * 0.6)
			local e = s.emitters[j]
			e.Enabled = alpha > 0.02 and not self.frozen
			e.Transparency = NumberSequence.new({
				NumberSequenceKeypoint.new(0, 1),
				NumberSequenceKeypoint.new(0.3, 1 - alpha),
				NumberSequenceKeypoint.new(0.7, 1 - alpha),
				NumberSequenceKeypoint.new(1, 1),
			})
		end
	end
	Workspace:BulkMoveTo(self._parts, self._cframes, Enum.BulkMoveMode.FireCFrameChanged)
end

function SubStrandView.destroy(self: SubStrandView)
	self:clear()
	self.folder:Destroy()
end

return SubStrandView
