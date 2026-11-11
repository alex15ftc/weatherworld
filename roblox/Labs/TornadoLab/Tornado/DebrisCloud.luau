--!strict
-- The debris / dust cloud at the contact, derived from its physical causes
-- (docs/tornado-physics/DEBRIS-CLOUD.md). Nothing here picks a "type": the look comes from
--   the vortex       intensity (EF -> peak wind V), core radius rc, swirl ratio S, forward speed
--                    (State + Vortex + WindField, the same field the rest of the tornado uses)
--   the ground       Config.ground: loose material, moisture, share of fine dust, colour, water
-- and the familiar kinds emerge from them: a dust whirl under a lifted funnel, a low collar /
-- skirt, a dark debris ball, a dust-sheathed column on dry plains, bright spikes at the suction
-- vortices of a multiple-vortex tornado, a landspout's dust column, a waterspout's spray ring, or
-- next to nothing over wet grass.
--
-- Drawn as wispy smoke sprites (BillboardGuis: drawn at any distance, unlike particles), in three
-- populations:
--   skirt   coarse debris: picked up where the ground wind beats the threshold (weighted by the
--           wind cubed, so the right of the track and the suction vortices pick up most), thrown
--           out and up, then falling back; dark, low, wider than the core
--   dust    fine dust: rides the updraught up a cone (a central column at low swirl, a hollow
--           annulus at higher swirl) to its height, thinning out
--   spikes  jets of dust at the wind field's own suction vortices, rising above the skirt;
--           smothered by heavy dust loading
--
--   local cloud = DebrisCloud.new(workspace)
--   RenderStepped: cloud:setLive(state); cloud:update(dt, time)
--   DebrisCloud.derive(state) -> the derived numbers (also shown in the lab)
local Workspace = game:GetService("Workspace")

local Config = require(script.Parent.Config)
local State = require(script.Parent.State)
local Vortex = require(script.Parent.Vortex)
local WindField = require(script.Parent.WindField)

local DebrisCloud = {}
DebrisCloud.__index = DebrisCloud

local G = 9.81 -- m/s² (studs are metres here: Config.STUDS_PER_METRE = 1)

type Sprite = {
	pop: string, -- "skirt" | "dust" | "spike"
	anchor: Part,
	gui: BillboardGui,
	img: ImageLabel,
	img2: ImageLabel,
	frame: number,
	seed: number,
	age: number,
	life: number,
	r: number, -- studs from the contact
	phi: number,
	z: number, -- studs up
	vr: number,
	vz: number,
	r0: number,
	size: number,
	opacity: number,
	spin: number,
	k: number, -- spike: which suction vortex; its height share
	alive: boolean,
}

export type Derived = {
	V: number, -- peak wind, m/s
	rc: number, -- core radius, studs
	S: number, -- swirl ratio
	supply: number, -- 0-1: how much loose material the wind can loft here
	R: number, -- skirt radius, studs
	Hc: number, -- skirt height, studs
	Hd: number, -- fine dust height, studs
	cone: number, -- half-angle, radians
	inner: number, -- hollow centre radius, studs
	column: number, -- 0-1: central column (low swirl) vs annulus
	loading: number, -- 0-1: dust loading (smothers suction vortices)
	threshold: number, -- m/s: wind that lofts dust here
	colour: Color3,
}

export type DebrisCloud = typeof(setmetatable(
	{} :: {
		folder: Folder,
		sprites: { Sprite },
		state: State.State?,
		rng: Random,
		level: number, -- the matured supply (lags the derived supply)
		levelFor: any, -- the state the level was set for (a new tornado starts matured)
		describeClock: number,
		_parts: { BasePart },
		_cframes: { CFrame },
	},
	DebrisCloud
))

local function smoothstep(a: number, b: number, x: number): number
	local t = math.clamp((x - a) / (b - a), 0, 1)
	return t * t * (3 - 2 * t)
end

local function log10(x: number): number
	return math.log10(math.max(x, 1e-6))
end

-- The numbers that shape the cloud, from the vortex and the ground (see DEBRIS-CLOUD.md).
function DebrisCloud.derive(state: State.State): Derived
	local D = Config.debrisCloud
	local gr = Config.ground
	local V = Vortex.peakSpeed(state.ef)
	local rc = Vortex.coreRadius(state)
	local S = Vortex.swirl(state)
	local m = math.clamp(gr.moisture, 0, 1)
	local water = math.clamp(gr.water, 0, 1)
	local threshold = D.threshold * (1 + 1.5 * m)
	-- how much the wind can loft: loose material, kept down by moisture, above the threshold
	local land = gr.loose * (1 - 0.7 * m) * math.clamp((V * V - threshold * threshold) / (D.fullWind * D.fullWind), 0, 1)
	local spray = math.clamp((V - D.sprayFrom) / 30, 0, 1)
	local supply = land * (1 - water) + spray * water
	local fines = gr.fines * (1 - water) + D.sprayFines * water
	local Aa = V * V / (rc * G)
	local R = rc * math.clamp(D.radius[1] + D.radius[2] * log10(Aa) + D.radius[3] * math.min(S, 2), 1, D.maxRadius)
	local Hc = rc * math.clamp(D.skirt[1] - D.skirt[2] * log10(Aa), 0.3, 1.5)
	local Hd = math.min(state.cloudBase * D.dustCap, D.dustHeight * rc * (V / 50) ^ 0.6) * fines * (1 - 0.6 * m)
	local cone = math.rad(D.coneAngle[1] + D.coneAngle[2] * math.min(S, 2) + D.coneAngle[3] * log10(Aa))
	local annulus = smoothstep(D.twoCell[1], D.twoCell[2], S)
	local loading = math.clamp(gr.loose * fines * (V / 60) ^ 2 * (1 - m), 0, 1)
	local soil = gr.color:Lerp(Color3.new(gr.color.R * 0.6, gr.color.G * 0.6, gr.color.B * 0.6), m) -- wet soil is darker
	local colour = soil:Lerp(D.sprayColor, water)
	return {
		V = V, rc = rc, S = S, supply = supply, R = R, Hc = Hc, Hd = Hd, cone = cone,
		inner = rc * D.hollow * annulus, column = 1 - annulus, loading = loading,
		threshold = threshold, colour = colour,
	}
end

-- A short description of what the numbers add up to (for the lab's output; not used to draw).
function DebrisCloud.describe(d: Derived): string
	return string.format(
		"[DebrisCloud] V %.0f m/s, rc %.0f, S %.2f, supply %.2f, loading %.2f | skirt R %.0f (%.1f rc) H %.0f | dust H %.0f, cone %.0f deg, %s",
		d.V, d.rc, d.S, d.supply, d.loading, d.R, d.R / d.rc, d.Hc, d.Hd, math.deg(d.cone),
		if d.column > 0.66 then "central column" elseif d.column > 0.33 then "column-to-ring" else "hollow ring"
	)
end

function DebrisCloud.new(parent: Instance?): DebrisCloud
	local folder = Instance.new("Folder")
	folder.Name = "DebrisCloud"
	folder.Parent = parent or Workspace
	return setmetatable({
		folder = folder,
		sprites = {},
		state = nil,
		rng = Random.new(17),
		level = 0,
		levelFor = nil,
		describeClock = 999,
		_parts = {},
		_cframes = {},
	}, DebrisCloud)
end

function DebrisCloud.setLive(self: DebrisCloud, state: State.State)
	self.state = state
end
DebrisCloud.setState = DebrisCloud.setLive

local function newSprite(self: DebrisCloud, pop: string, texture: string): Sprite
	local anchor = Instance.new("Part")
	anchor.Name = "Debris"
	anchor.Anchored, anchor.CanCollide, anchor.CanQuery, anchor.CanTouch = true, false, false, false
	anchor.CastShadow = false
	anchor.Transparency = 1
	anchor.Size = Vector3.one
	local gui = Instance.new("BillboardGui")
	gui.Adornee = anchor
	gui.AlwaysOnTop = false
	gui.MaxDistance = math.huge
	gui.LightInfluence = Config.debrisCloud.lightInfluence
	gui.Brightness = 1
	gui.Size = UDim2.fromScale(1, 1)
	local img = Instance.new("ImageLabel")
	img.BackgroundTransparency = 1
	img.BorderSizePixel = 0
	img.Size = UDim2.fromScale(1, 1)
	img.Image = Config.textures[texture] or texture
	img.ImageRectSize = Vector2.new(256, 256)
	img.ImageTransparency = 1
	img.Parent = gui
	local img2 = img:Clone()
	img2.ZIndex = 2
	img2.Parent = gui
	gui.Parent = anchor
	anchor.Parent = self.folder
	local s: Sprite = {
		pop = pop, anchor = anchor, gui = gui, img = img, img2 = img2, frame = -1, seed = 0,
		age = 0, life = 1, r = 0, phi = 0, z = 0, vr = 0, vz = 0, r0 = 0, size = 1, opacity = 0, spin = 0,
		k = 1, alive = false,
	}
	table.insert(self.sprites, s)
	table.insert(self._parts, anchor)
	table.insert(self._cframes, CFrame.identity)
	return s
end

local function ensure(self: DebrisCloud)
	local D = Config.debrisCloud
	local want = {
		skirt = if D.enabled then D.skirtCount else 0,
		dust = if D.enabled then D.dustCount else 0,
		spike = if D.enabled then D.spikeCount else 0,
	}
	local have = { skirt = 0, dust = 0, spike = 0 }
	for _, s in self.sprites do
		have[s.pop] += 1
	end
	for pop, n in want do
		for _ = have[pop] + 1, n do
			newSprite(self, pop, (D :: any)[pop .. "Texture"])
		end
	end
	for i = #self.sprites, 1, -1 do
		local s = self.sprites[i]
		if have[s.pop] > want[s.pop] then
			have[s.pop] -= 1
			s.anchor:Destroy()
			table.remove(self.sprites, i)
			table.remove(self._parts, i)
			table.remove(self._cframes, i)
		end
	end
end

-- Pick a spot round the contact where the ground wind lofts material (rejection sampling on the
-- field: the wind cubed above the threshold). Returns the radius and angle, or nil.
local function pickup(self: DebrisCloud, p: any, state: State.State, d: Derived, foot: Vector3, rMin: number, rMax: number, time: number): (number?, number?)
	local spm = Config.STUDS_PER_METRE
	local rng = self.rng
	for _ = 1, 6 do
		local phi = rng:NextNumber(0, 2 * math.pi)
		local r = math.sqrt(rng:NextNumber((rMin / math.max(rMax, 1)) ^ 2, 1)) * rMax
		local pos = foot + Vector3.new(math.cos(phi) * r, 3 * spm, math.sin(phi) * r)
		local w = Vortex.sample(p, state, pos, time)
		local speed = Vector3.new(w.X, 0, w.Z).Magnitude / spm
		if speed > d.threshold then
			local weight = math.clamp((speed / math.max(d.V, 1)) ^ 3, 0, 1)
			if rng:NextNumber() < weight * 1.5 then
				return r, phi
			end
		end
	end
	return nil, nil
end

local function respawn(self: DebrisCloud, s: Sprite, p: any, state: State.State, d: Derived, foot: Vector3, time: number, partway: boolean)
	local D = Config.debrisCloud
	local rng = self.rng
	s.alive = false
	s.seed = rng:NextInteger(0, 15)
	s.spin = rng:NextNumber(-1, 1) * D.spriteSpin
	s.img.Rotation = rng:NextNumber(-30, 30)
	s.img2.Rotation = s.img.Rotation
	if s.pop == "skirt" then
		-- picked up where the wind is strongest (round the core), then thrown out to the skirt
		local r, phi = pickup(self, p, state, d, foot, d.inner * 0.6, math.min(d.R * 0.9, d.rc * D.pickupReach), time)
		if not r or not phi then
			return
		end
		s.r, s.r0, s.phi = r, r, phi
		s.z = 0
		-- thrown out (centrifuged) and up to about the skirt's height, then falling back
		s.vr = D.eject * d.V * rng:NextNumber(0.4, 1)
		s.vz = math.sqrt(2 * D.fall * d.Hc * rng:NextNumber(0.4, 1))
		s.life = 2 * s.vz / D.fall + rng:NextNumber(0.5, 1.5)
		s.size = d.R * rng:NextNumber(D.skirtSize[1], D.skirtSize[2])
		s.opacity = D.skirtOpacity * rng:NextNumber(0.7, 1.15)
	elseif s.pop == "dust" then
		-- a central column at low swirl, the annulus round the hollow centre at higher swirl
		local rMax = d.inner + (d.rc - d.inner) * 0.9 + d.rc * 0.3
		local rMin = d.inner
		local r, phi = pickup(self, p, state, d, foot, rMin, math.max(rMax, rMin + 1), time)
		if not r or not phi then
			return
		end
		s.r, s.r0, s.phi = r * (1 - 0.7 * d.column), r * (1 - 0.7 * d.column), phi
		s.z = 0
		s.vz = d.V * (D.rise + D.jet * d.column) * rng:NextNumber(0.7, 1.2)
		s.life = math.max(d.Hd, 20) / math.max(s.vz, 1) * rng:NextNumber(0.9, 1.3)
		s.size = d.rc * rng:NextNumber(D.dustSize[1], D.dustSize[2])
		s.opacity = D.dustOpacity * rng:NextNumber(0.7, 1.15)
	else
		s.z = 0
		s.life = rng:NextNumber(1.5, 3)
		s.size = d.rc * rng:NextNumber(D.spikeSize[1], D.spikeSize[2])
		s.opacity = D.spikeOpacity * rng:NextNumber(0.8, 1.1)
		s.vz = d.V * D.spikeRise * rng:NextNumber(0.7, 1.1)
	end
	s.age = if partway then rng:NextNumber(0, s.life * 0.8) else 0
	s.alive = true
end

-- How far above its particle a sprite's middle sits, x its height: on the ground the sprite is
-- centred low (its lower half sunk below the ground, which hides it: the cloud starts at the
-- contact with a flat bottom); once it has risen its own height it is centred normally.
local function lift(z: number, h: number): number
	local k = smoothstep(0, math.max(h, 1), z)
	return Config.debrisCloud.groundLift + (0.3 - Config.debrisCloud.groundLift) * k
end

local function shade(c: Color3, k: number): Color3
	return Color3.new(math.clamp(c.R * k, 0, 1), math.clamp(c.G * k, 0, 1), math.clamp(c.B * k, 0, 1))
end

function DebrisCloud.update(self: DebrisCloud, dt: number, time: number)
	local state = self.state
	if not state then
		return
	end
	ensure(self)
	if #self.sprites == 0 then
		return
	end
	local D = Config.debrisCloud
	local d = DebrisCloud.derive(state)
	-- the cloud matures over a couple of minutes (and lingers after the wind drops); a new tornado
	-- (a look, a reset) starts already matured
	if self.levelFor ~= state.seed then
		self.levelFor = state.seed
		self.level = d.supply
	end
	self.level += (d.supply - self.level) * (1 - math.exp(-dt / D.mature))
	local level = self.level
	self.describeClock += dt
	if self.describeClock > D.describeEvery and D.describeEvery > 0 then
		self.describeClock = 0
		print(DebrisCloud.describe(d))
	end
	local p = Vortex.cachedParams(state)
	local footC = State.centreAt(state, 0, time)
	local foot = Vector3.new(footC.X, state.position.Y, footC.Z)
	local nSub = math.max(math.ceil(p.subCount), 0)
	local spikeShare = p.subShare * (1 - d.loading)
	local tries = 0
	for k, s in self.sprites do
		s.age += dt
		if not s.alive or s.age >= s.life then
			if tries < D.respawnsPerFrame then
				tries += 1
				respawn(self, s, p, state, d, foot, time, false)
				if s.pop == "spike" then
					s.k = self.rng:NextInteger(1, math.max(nSub, 1))
				end
			else
				s.alive = false
			end
		end
		local alpha = 0
		local pos = foot
		local w, h = s.size, s.size
		local colour = d.colour
		if s.alive then
			local x = s.age / s.life
			-- in fast (seconds: a share of the life let dust rise unseen and appear in mid-air), out slowly
			local fadeInOut = smoothstep(0, D.fadeInTime, s.age) * (1 - smoothstep(1 - D.fadeOut, 1, x))
			-- swirl round the contact at a share of the field's own tangential wind there
			local vt = WindField.tangential(p, math.max(s.r, 1), math.max(s.z, 1), time)
			s.phi += D.swirl * vt / math.max(s.r, 1) * dt
			if s.pop == "skirt" then
				-- outward throw dying away; ballistic up and back down
				s.vr *= math.exp(-dt / D.ejectTime)
				s.r += s.vr * dt
				s.vz -= D.fall * dt
				s.z = math.max(s.z + s.vz * dt, 0)
				w = s.size * (1 + D.grow * x)
				h = w * D.skirtAspect
				alpha = s.opacity * level * fadeInOut
				colour = shade(d.colour, D.skirtShade)
				pos = foot + Vector3.new(math.cos(s.phi) * s.r, s.z + h * lift(s.z, h), math.sin(s.phi) * s.r)
			elseif s.pop == "dust" then
				-- rising up the cone (wider with height), thinning toward its top
				s.z += s.vz * dt
				s.r = s.r0 + s.z * math.tan(d.cone)
				local top = math.max(d.Hd, 1)
				-- densest where it is picked up (the ground), thinning as it rises and spreads; small and
				-- compact at the ground, growing with height
				local hz = math.clamp(s.z / top, 0, 1)
				w = s.size * (D.dustBase + D.grow * hz)
				h = w * D.dustAspect
				alpha = s.opacity * level * fadeInOut * (1 - hz) ^ D.dustThin
				colour = shade(d.colour, D.dustShade)
				pos = foot + Vector3.new(math.cos(s.phi) * s.r, s.z + h * lift(s.z, h), math.sin(s.phi) * s.r)
				if s.z > top then
					s.alive = false
				end
			else
				-- at the field's suction vortex k (it moves along its own looping path)
				local sx, sz, strength = 0, 0, 0
				if nSub > 0 then
					sx, sz, strength = WindField.subVortex(p, math.min(s.k, nSub), time)
				end
				s.z += s.vz * dt
				w = s.size
				h = w * D.spikeAspect
				alpha = s.opacity * level * fadeInOut * strength * spikeShare
				colour = shade(d.colour, D.spikeShade)
				pos = foot + Vector3.new(sx, s.z + h * lift(s.z, h), sz)
			end
		end
		self._cframes[k] = CFrame.new(pos)
		s.gui.Size = UDim2.fromScale(w, h)
		-- the flipbook, slowly, each frame cross-faded into the next
		-- oneShot (a simulation flipbook): the frames play once over the sprite's life
		local fpos = if D.oneShot then math.min(s.age / math.max(s.life, 0.01), 0.999) * 15 else s.seed + s.age * D.flipFps
		local frame = if D.oneShot then math.floor(fpos) else math.floor(fpos) % 16
		local f = fpos - math.floor(fpos)
		f = f * f * (3 - 2 * f)
		if frame ~= s.frame then
			s.frame = frame
			local nxt = (frame + 1) % 16
			s.img.ImageRectOffset = Vector2.new(frame % 4 * 256, frame // 4 * 256)
			s.img2.ImageRectOffset = Vector2.new(nxt % 4 * 256, nxt // 4 * 256)
		end
		local a = math.clamp(alpha, 0, 1)
		local turn = s.img.Rotation + s.spin * dt
		s.img.Rotation, s.img2.Rotation = turn, turn
		s.img.ImageColor3, s.img2.ImageColor3 = colour, colour
		s.img.ImageTransparency = 1 - a * (1 - f)
		s.img2.ImageTransparency = 1 - a * f
	end
	Workspace:BulkMoveTo(self._parts, self._cframes, Enum.BulkMoveMode.FireCFrameChanged)
end

function DebrisCloud.destroy(self: DebrisCloud)
	self.folder:Destroy()
end

return DebrisCloud
