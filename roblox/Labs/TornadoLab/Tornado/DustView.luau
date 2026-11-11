--!strict
-- Dust that rides the wind (client only): the debris cloud's shape comes from the wind field,
-- not from drawn layers. A few dozen invisible tracers are picked up near the ground wherever
-- the wind can loft dust, carried by the wind (Vortex.sample: the inflow along the ground, the
-- swirl, the updraught in the corner), lagging the air a little so heavier grit is flung out
-- (the skirt / bell / fan shapes of the reference clips 10-32, 11-04 and ref4), and settling.
-- Each tracer leaves a short trail of soft dust puffs (particles that stay where they are
-- emitted), so the swirl shows as curling bands. Colour: the ground under the contact
-- (Config.debris.groundDust, sampled by FunnelView).
--
--   local dust = DustView.new(workspace)
--   dust:setLive(state); RenderStepped: dust:update(dt, time)
local Workspace = game:GetService("Workspace")

local Config = require(script.Parent.Config)
local State = require(script.Parent.State)
local Vortex = require(script.Parent.Vortex)

local DustView = {}
DustView.__index = DustView

type Tracer = {
	part: BasePart,
	emitter: ParticleEmitter,
	pos: Vector3,
	vel: Vector3,
	age: number,
	life: number,
	lag: number, -- seconds: how slowly it takes up the wind (bigger = heavier grit)
	gust: number, -- studs/s: its turbulent vertical velocity (eddies loft the dust)
	alive: boolean,
}

export type DustView = typeof(setmetatable(
	{} :: {
		folder: Folder,
		tracers: { Tracer },
		state: State.State?,
		rng: Random,
		frozen: boolean,
		_parts: { BasePart },
		_cframes: { CFrame },
		colour: Color3?,
		debugClock: number,
	},
	DustView
))

function DustView.new(parent: Instance?): DustView
	local folder = Instance.new("Folder")
	folder.Name = "Dust"
	folder.Parent = parent or Workspace
	return setmetatable({
		folder = folder, tracers = {}, state = nil, rng = Random.new(3),
		frozen = false, _parts = {}, _cframes = {}, colour = nil, debugClock = 0,
	}, DustView)
end

function DustView.setLive(self: DustView, state: State.State)
	self.state = state
end
DustView.setState = DustView.setLive

function DustView.setFrozen(self: DustView, frozen: boolean)
	self.frozen = frozen
	for _, t in self.tracers do
		t.emitter.TimeScale = if frozen then 0 else 1
	end
end

local function newTracer(self: DustView): Tracer
	local D = Config.dustTracers
	local part = Instance.new("Part")
	part.Name = "DustTracer"
	part.Anchored, part.CanCollide, part.CanQuery, part.CanTouch = true, false, false, false
	part.Transparency = 1
	part.Size = Vector3.one
	local e = Instance.new("ParticleEmitter")
	e.Texture = Config.textures[D.texture] or D.texture
	e.FlipbookLayout = if Config.SHEETS[D.texture] then Enum.ParticleFlipbookLayout.Grid4x4 else Enum.ParticleFlipbookLayout.None
	-- looped and blended from a random start (Random mode jumps between frames: visible pops)
	e.FlipbookMode = Enum.ParticleFlipbookMode.Loop
	e.FlipbookStartRandom = true
	e.FlipbookBlendFrames = true
	e.FlipbookFramerate = NumberRange.new(1, 2)
	e.Speed = NumberRange.new(0)
	e.VelocityInheritance = 0
	e.LockedToPart = false -- puffs stay where emitted: a trail along the tracer's path
	e.Rotation = NumberRange.new(-180, 180)
	e.RotSpeed = NumberRange.new(-25, 25)
	e.LightInfluence = 1
	e.Enabled = false
	e.Parent = part
	part.Parent = self.folder
	return { part = part, emitter = e, pos = Vector3.zero, vel = Vector3.zero, age = 0, life = 1, lag = 0.5, gust = 0, alive = false }
end

function DustView.clear(self: DustView)
	for _, t in self.tracers do
		t.part:Destroy()
	end
	table.clear(self.tracers)
end

-- Look settings onto the emitters.
function DustView.apply(self: DustView)
	local D = Config.dustTracers
	if not D.enabled then
		self:clear()
		return
	end
	while #self.tracers < D.count do
		table.insert(self.tracers, newTracer(self))
	end
	while #self.tracers > D.count do
		(table.remove(self.tracers) :: Tracer).part:Destroy()
	end
	self.colour = nil -- re-applied in update
end

-- Try to pick a tracer up somewhere the wind can loft dust. Returns false if this try missed.
local function respawn(self: DustView, t: Tracer, p: any, state: State.State, time: number): boolean
	local D = Config.dustTracers
	local spm = Config.STUDS_PER_METRE
	local rng = self.rng
	local rc = p.rc
	local a = rng:NextNumber(0, 2 * math.pi)
	local r = rc * rng:NextNumber(D.pickup[1], D.pickup[2])
	-- round the funnel's actual foot (a rope's foot swings well away from the ground point)
	local foot = State.centreAt(state, 0, time)
	local ground = Vector3.new(foot.X, state.position.Y, foot.Z)
	local pos = ground + Vector3.new(math.cos(a) * r, rng:NextNumber(D.pickupHeight[1], D.pickupHeight[2]) * spm, math.sin(a) * r)
	local w = Vortex.sample(p, state, pos, time)
	local speed = Vector3.new(w.X, 0, w.Z).Magnitude / spm
	if speed < D.threshold then
		return false
	end
	t.pos = pos
	t.vel = w * 0.5
	t.age = 0
	t.life = rng:NextNumber(D.life[1], D.life[2])
	t.lag = rng:NextNumber(D.lag[1], D.lag[2])
	t.gust = 0
	t.alive = true
	return true
end

local function smooth01(x: number): number
	x = math.clamp(x, 0, 1)
	return x * x * (3 - 2 * x)
end

function DustView.update(self: DustView, dt: number, time: number)
	local D = Config.dustTracers
	local state = self.state
	if not D.enabled or not state or #self.tracers == 0 then
		return
	end
	local spm = Config.STUDS_PER_METRE
	local p = Vortex.cachedParams(state)
	local touching = (state.bottom or 0) < 0.5
	local strength = math.clamp((state.ef - D.fromEf) / 1.5, 0, 1)
	-- the ground's dust, seen through the funnel's own haze
	local soil = (Config.debris.groundDust or Config.groundDust.soil) :: Color3
	local colour = soil:Lerp(Config.funnel.colorBottom, D.haze)
	if self.colour ~= colour then
		self.colour = colour
		for _, t in self.tracers do
			t.emitter.Color = ColorSequence.new(colour)
		end
	end
	local size = math.clamp(p.rc * D.size, D.minSize, D.maxSize)
	local ceiling = state.cloudBase * D.top
	local frozen = self.frozen
	local tries = 0
	table.clear(self._parts)
	table.clear(self._cframes)
	for i, t in self.tracers do
		if not frozen then
			if not t.alive then
				-- a few pick-up tries a frame, so dust appears where (and as fast as) the wind allows
				if touching and strength > 0 and tries < D.triesPerFrame then
					tries += 1
					respawn(self, t, p, state, time)
				end
			else
				t.age += dt
				local w = Vortex.sample(p, state, t.pos, time)
				-- eddies loft it: a random vertical gust, a share of the local wind, changing over
				-- a couple of seconds (dust is lifted by turbulence, not by the mean updraught alone)
				local sigma = D.loft * Vector3.new(w.X, 0, w.Z).Magnitude
				t.gust += -t.gust * dt / D.gustTime + sigma * math.sqrt(2 * dt / D.gustTime) * self.rng:NextNumber(-1.732, 1.732)
				w += Vector3.new(0, t.gust, 0)
				-- takes up the wind over its lag time (heavier grit lags, so it's flung out on bends),
				-- and settles
				local k = 1 - math.exp(-dt / t.lag)
				t.vel += (w - t.vel) * k
				t.vel -= Vector3.new(0, D.settle * spm * dt, 0)
				t.pos += t.vel * dt
				if t.pos.Y < state.position.Y then
					t.pos = Vector3.new(t.pos.X, state.position.Y, t.pos.Z)
					t.vel = Vector3.new(t.vel.X * 0.5, 0, t.vel.Z * 0.5)
				end
				if t.age >= t.life or t.pos.Y - state.position.Y > ceiling then
					t.alive = false
				end
			end
		end
		local e = t.emitter
		if t.alive then
			-- fades in after pick-up and out with age and height
			local h = (t.pos.Y - state.position.Y) / math.max(ceiling, 1)
			local vis = strength * smooth01(t.age / 0.6) * smooth01((t.life - t.age) / 1.5) * (1 - smooth01((h - 0.6) / 0.4))
			e.Enabled = vis > 0.02 and not frozen
			e.Rate = D.rate
			e.Lifetime = NumberRange.new(D.puffLife * 0.8, D.puffLife * 1.2)
			local s = size * (1 + 1.5 * math.clamp(h, 0, 1)) -- spreads as it rises
			e.Size = NumberSequence.new({
				NumberSequenceKeypoint.new(0, s * 0.6, s * 0.15),
				NumberSequenceKeypoint.new(1, s * 1.3, s * 0.2),
			})
			local alpha = D.opacity * vis
			e.Transparency = NumberSequence.new({
				NumberSequenceKeypoint.new(0, 1),
				NumberSequenceKeypoint.new(0.25, 1 - alpha),
				NumberSequenceKeypoint.new(0.6, 1 - alpha * 0.8),
				NumberSequenceKeypoint.new(1, 1),
			})
		else
			e.Enabled = false
		end
		table.insert(self._parts, t.part)
		table.insert(self._cframes, CFrame.new(t.pos))
		local _ = i
	end
	Workspace:BulkMoveTo(self._parts, self._cframes, Enum.BulkMoveMode.FireCFrameChanged)
	if D.debug then
		self.debugClock += dt
		if self.debugClock > 3 then
			self.debugClock = 0
			local n, hs, rs, sp = 0, 0, 0, 0
			for _, t in self.tracers do
				if t.alive then
					n += 1
					hs += t.pos.Y - state.position.Y
					rs += Vector3.new(t.pos.X - state.position.X, 0, t.pos.Z - state.position.Z).Magnitude / p.rc
					sp += t.vel.Magnitude
				end
			end
			print(string.format("[Dust] alive %d/%d, mean height %.0f, mean r %.2f rc, mean speed %.0f, rc %.0f, size %.0f, strength %.2f",
				n, #self.tracers, hs / math.max(n, 1), rs / math.max(n, 1), sp / math.max(n, 1), p.rc, size, strength))
		end
	end
end

function DustView.destroy(self: DustView)
	self:clear()
	self.folder:Destroy()
end

return DustView
