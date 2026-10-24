--!strict
-- Wisps at any distance: the Severity look (docs/tornado-reference/NOTES.md "Wisps").
--
-- Severity's clouds fray into wisps everywhere: big, faint, slowly changing smoke sprites whose
-- textures carry fibrous strands (tools/smoke/wisp_flipbook.py). Particles can't carry them at
-- chasing distances (Roblox stops drawing particles ~800 studs from the camera), so these are
-- camera-facing BillboardGui sprites: they draw at any distance and are still hidden behind
-- nearer geometry. Each sprite lives a few seconds: it fades in, turns slowly, steps through the
-- flipbook, drifts, fades out and starts again somewhere else.
--
--   funnel   tall strand sprites on a shell at the funnel's edge, riding up it as it turns and
--            drifting out: the silhouette frays. Ones behind the funnel fade (they'd show through).
--   wall     wispy puffs hanging from the wall cloud's underside and rim (StormBase), turning with it
--   edge     wispy puffs hanging along the base's outer edge, where it frays against the bright sky
--   dust     the debris cloud: dark wispy puffs swirling round the funnel's foot, rising and spreading
--            (refs: a dense dark cloud hugging the contact, wider than the funnel, frayed edges)
--   scud     ragged wisps scattered under the whole base, drifting in toward the wall cloud
--
--   local w = WispSprites.new(workspace); RenderStepped: w:setLive(state); w:update(dt, time)
local Workspace = game:GetService("Workspace")

local Config = require(script.Parent.Config)
local State = require(script.Parent.State)
local Vortex = require(script.Parent.Vortex)
local StormBase = require(script.Parent.StormBase)

local WispSprites = {}
WispSprites.__index = WispSprites

type Sprite = {
	kind: string, -- "funnel" | "wall" | "edge" | "dust" | "scud"
	anchor: Part,
	gui: BillboardGui,
	img: ImageLabel, -- this flipbook frame ...
	img2: ImageLabel, -- ... and the next, cross-faded (an image can't blend frames itself: frame
	-- switches popped, a visible step)
	age: number,
	life: number,
	frame: number,
	-- funnel: height share, angle round the axis, how far out (x radius)
	t: number,
	phi: number,
	out: number,
	-- wall: offset from the wall cloud's middle (x, z), hang below its underside (studs)
	pos: Vector2,
	hang: number,
	size: number,
	spin: number, -- degrees/s
	opacity: number,
	seed: number,
	colour: Color3, -- edge: the base's colour above it
}

export type WispSprites = typeof(setmetatable(
	{} :: {
		folder: Folder,
		sprites: { Sprite },
		state: State.State?,
		rng: Random,
		wallSpin: number,
		_parts: { BasePart },
		_cframes: { CFrame },
	},
	WispSprites
))

function WispSprites.new(parent: Instance?): WispSprites
	local folder = Instance.new("Folder")
	folder.Name = "WispSprites"
	folder.Parent = parent or Workspace
	return setmetatable({
		folder = folder,
		sprites = {},
		state = nil,
		rng = Random.new(31),
		wallSpin = 0,
		_parts = {},
		_cframes = {},
	}, WispSprites)
end

function WispSprites.setLive(self: WispSprites, state: State.State)
	self.state = state
end
WispSprites.setState = WispSprites.setLive

local function newSprite(self: WispSprites, kind: string, texture: string): Sprite
	local anchor = Instance.new("Part")
	anchor.Name = "Wisp"
	anchor.Anchored, anchor.CanCollide, anchor.CanQuery, anchor.CanTouch = true, false, false, false
	anchor.CastShadow = false
	anchor.Transparency = 1
	anchor.Size = Vector3.one
	local gui = Instance.new("BillboardGui")
	gui.Adornee = anchor
	gui.AlwaysOnTop = false -- hidden behind nearer things, like real cloud
	gui.MaxDistance = math.huge
	gui.ClipsDescendants = false
	gui.LightInfluence = Config.wisps.lightInfluence
	gui.Brightness = 1
	gui.Size = UDim2.fromScale(1, 1)
	local img = Instance.new("ImageLabel")
	img.BackgroundTransparency = 1
	img.BorderSizePixel = 0
	img.Size = UDim2.fromScale(1, 1)
	img.Image = Config.textures[texture] or texture
	img.ImageRectSize = Vector2.new(256, 256) -- one frame of the 4x4 sheet
	img.ImageTransparency = 1
	img.Parent = gui
	local img2 = img:Clone()
	img2.ZIndex = 2
	img2.Parent = gui
	gui.Parent = anchor
	anchor.Parent = self.folder
	local s: Sprite = {
		kind = kind, anchor = anchor, gui = gui, img = img, img2 = img2, age = 0, life = 1, frame = -1,
		t = 0, phi = 0, out = 1, pos = Vector2.zero, hang = 0, size = 1, spin = 0, opacity = 0, seed = 0,
		colour = Color3.new(1, 1, 1),
	}
	table.insert(self.sprites, s)
	table.insert(self._parts, anchor)
	table.insert(self._cframes, CFrame.identity)
	return s
end

-- Start a sprite over at a new place (age 0), or partway through its life when the set first fills.
local function respawn(self: WispSprites, s: Sprite, partway: boolean)
	local rng = self.rng
	if s.kind == "funnel" then
		local F = Config.wisps.funnel
		s.life = rng:NextNumber(F.life[1], F.life[2])
		s.t = rng:NextNumber(F.from, F.to)
		s.phi = rng:NextNumber(0, 2 * math.pi)
		s.out = rng:NextNumber(F.offset[1], F.offset[2])
		s.size = rng:NextNumber(F.size[1], F.size[2])
		s.opacity = F.opacity * rng:NextNumber(0.6, 1.2)
	elseif s.kind == "edge" then
		local E = Config.wisps.edge
		local S = Config.stormBase
		local H = if self.state then math.max(self.state.cloudBase, 1) else 700
		s.life = rng:NextNumber(E.life[1], E.life[2])
		-- find the base's edge this way (where its alpha crosses one half), then step inside it
		local a = rng:NextNumber(0, 2 * math.pi)
		local dir = Vector2.new(math.cos(a), math.sin(a))
		local lo, hi = S.radius * 0.3, S.radius * 2.5
		for _ = 1, 10 do
			local mid = (lo + hi) * 0.5
			local p = dir * mid
			local _, _, alpha = StormBase.field(p.X, p.Y, H, 0)
			if alpha > 0.5 then
				lo = mid
			else
				hi = mid
			end
		end
		local d = lo - rng:NextNumber(E.inside[1], E.inside[2])
		s.pos = dir * d
		local _, c = StormBase.field(s.pos.X, s.pos.Y, H, 0)
		s.colour = c
		s.hang = rng:NextNumber(E.hang[1], E.hang[2])
		s.size = rng:NextNumber(E.size[1], E.size[2])
		s.opacity = E.opacity * rng:NextNumber(0.6, 1.2)
	elseif s.kind == "dust" then
		local D = Config.wisps.dust
		local state = self.state
		local r0 = if state then State.radiusAt(state, 0, 0) else 30
		local Rd = math.max(r0 * D.radius, D.minRadius)
		s.life = rng:NextNumber(D.life[1], D.life[2])
		s.phi = rng:NextNumber(0, 2 * math.pi)
		local f = D.inner + (1 - D.inner) * math.sqrt(rng:NextNumber(0, 1))
		s.out = Rd * f -- studs from the contact
		s.t = rng:NextNumber(0, D.startHeight) * Rd -- studs up
		s.size = Rd * rng:NextNumber(D.size[1], D.size[2])
		s.opacity = D.opacity * rng:NextNumber(0.7, 1.15) * (1.25 - 0.5 * f) -- densest near the funnel
		s.pos = Vector2.new(f, Rd) -- (share out, the cloud's radius) for the colour
	elseif s.kind == "deck" then
		-- a lump of the base's underside (impostor cloud: a rendered volumetric puff), anywhere under
		-- solid base; its height and colour from the storm field (lower and darker at the wall cloud)
		local D = Config.wisps.deck
		local S = Config.stormBase
		local H = if self.state then math.max(self.state.cloudBase, 1) else 700
		s.life = rng:NextNumber(D.life[1], D.life[2])
		local alpha = 0
		for _ = 1, 10 do
			local a = rng:NextNumber(0, 2 * math.pi)
			local d = S.radius * D.reach * math.sqrt(rng:NextNumber(0, 1))
			s.pos = Vector2.new(math.cos(a), math.sin(a)) * d
			local _, _, al = StormBase.field(s.pos.X, s.pos.Y, H, 0)
			alpha = al
			if al > D.minCover then
				break
			end
		end
		local dy, c = StormBase.field(s.pos.X, s.pos.Y, H, 0)
		s.t = dy
		s.colour = c
		s.hang = rng:NextNumber(D.hang[1], D.hang[2])
		s.size = rng:NextNumber(D.size[1], D.size[2])
		s.opacity = D.opacity * rng:NextNumber(0.75, 1.1) * math.clamp(alpha, 0, 1)
	elseif s.kind == "scud" then
		local C = Config.wisps.scud
		local H = if self.state then math.max(self.state.cloudBase, 1) else 700
		s.life = rng:NextNumber(C.life[1], C.life[2])
		for _ = 1, 8 do -- somewhere under solid base
			local a = rng:NextNumber(0, 2 * math.pi)
			local d = rng:NextNumber(C.distance[1], C.distance[2])
			s.pos = Vector2.new(math.cos(a), math.sin(a)) * d
			local _, _, alpha = StormBase.field(s.pos.X, s.pos.Y, H, 0)
			if alpha > 0.7 then
				break
			end
		end
		local _, c = StormBase.field(s.pos.X, s.pos.Y, H, 0)
		s.colour = c
		s.hang = rng:NextNumber(C.hang[1], C.hang[2])
		s.size = rng:NextNumber(C.size[1], C.size[2])
		s.opacity = C.opacity * rng:NextNumber(0.6, 1.2)
	else
		local W = Config.wisps.wall
		s.life = rng:NextNumber(W.life[1], W.life[2])
		local a = rng:NextNumber(0, 2 * math.pi)
		local d = math.sqrt(rng:NextNumber(W.reach[1] ^ 2, W.reach[2] ^ 2))
		s.pos = Vector2.new(math.cos(a), math.sin(a)) * d -- x the wall cloud's radius
		s.hang = rng:NextNumber(W.hang[1], W.hang[2])
		s.size = rng:NextNumber(W.size[1], W.size[2])
		s.opacity = W.opacity * rng:NextNumber(0.6, 1.2)
	end
	local still = s.kind == "deck" -- the base's puffs are rendered the right way up: no turning
	s.spin = if still then 0 else rng:NextNumber(-1, 1) * Config.wisps.spin
	s.seed = rng:NextInteger(0, 15)
	s.age = if partway then rng:NextNumber(0, s.life) else 0
	s.img.Rotation = if still then 0 else rng:NextNumber(-25, 25)
	s.img2.Rotation = s.img.Rotation
end

local function fade(s: Sprite): number
	local K = Config.wisps
	local x = s.age / s.life
	return math.clamp(x / K.fadeIn, 0, 1) * math.clamp((1 - x) / K.fadeOut, 0, 1)
end

-- Make the set match the settings (counts per kind).
local function ensure(self: WispSprites)
	local K = Config.wisps
	local want = {
		funnel = if K.enabled and K.funnel.enabled then K.funnel.count else 0,
		wall = if K.enabled and K.wall.enabled and Config.stormBase.enabled then K.wall.count else 0,
		edge = if K.enabled and K.edge.enabled and Config.stormBase.enabled then K.edge.count else 0,
		scud = if K.enabled and K.scud.enabled and Config.stormBase.enabled then K.scud.count else 0,
		dust = if K.enabled and K.dust.enabled then K.dust.count else 0,
		deck = if K.enabled and K.deck.enabled and Config.stormBase.enabled then K.deck.count else 0,
	}
	local have = { funnel = 0, wall = 0, edge = 0, scud = 0, dust = 0, deck = 0 }
	for _, s in self.sprites do
		have[s.kind] += 1
	end
	for kind, n in want do
		local texture = (K :: any)[kind].texture
		for _ = have[kind] + 1, n do
			respawn(self, newSprite(self, kind, texture), true)
		end
	end
	-- drop extras
	for i = #self.sprites, 1, -1 do
		local s = self.sprites[i]
		if have[s.kind] > want[s.kind] then
			have[s.kind] -= 1
			s.anchor:Destroy()
			table.remove(self.sprites, i)
			table.remove(self._parts, i)
			table.remove(self._cframes, i)
		end
	end
end

local function shaded(c: Color3, k: number): Color3
	return Color3.new(math.clamp(c.R * k, 0, 1), math.clamp(c.G * k, 0, 1), math.clamp(c.B * k, 0, 1))
end

function WispSprites.update(self: WispSprites, dt: number, time: number)
	local state = self.state
	if not state then
		return
	end
	ensure(self)
	if #self.sprites == 0 then
		return
	end
	local K = Config.wisps
	local camera = Workspace.CurrentCamera
	local eye = if camera then camera.CFrame.Position else Vector3.zero
	local H = math.max(state.cloudBase, 1)
	local F = Config.funnel
	-- the funnel's turn and the cloud's climb
	local rMid = math.max(State.radiusAt(state, 0.5, time), 1)
	local spin = Vortex.spinRate(state, rMid) * K.funnel.spinShare
	local climb = K.funnel.rise / H -- height share a second
	-- the wall cloud (StormBase's frame)
	local S = Config.stormBase
	local h = math.rad(S.heading)
	local fwd = Vector2.new(math.cos(h), -math.sin(h))
	local left = Vector2.new(fwd.Y, -fwd.X)
	local wc = fwd * S.wallCloud.ahead + left * S.wallCloud.left
	local top = State.centreAt(state, 1, time)
	local groundY = State.centreAt(state, 0, time).Y
	local wallOrigin = Vector3.new(top.X + wc.X, groundY + H * (1 - S.wallCloud.drop), top.Z + wc.Y)
	self.wallSpin += S.wallCloud.spinRate * dt
	local cw, sw = math.cos(self.wallSpin), math.sin(self.wallSpin)

	for k, s in self.sprites do
		s.age += dt
		if s.age >= s.life then
			respawn(self, s, false)
		end
		local pos: Vector3
		local w: number, hgt: number
		local colour: Color3
		local a = fade(s) * s.opacity
		if s.kind == "funnel" then
			local FK = K.funnel
			s.t += climb * dt
			s.phi += spin * dt
			s.out += FK.drift * dt
			if s.t > FK.to + 0.05 then
				s.age = s.life -- gone into the cloud: start again next frame
			end
			local t = math.clamp(s.t, 0, 1)
			local r = State.radiusAt(state, t, time)
			local c = State.centreAt(state, t, time)
			local radial = Vector3.new(math.cos(s.phi), 0, math.sin(s.phi))
			pos = c + radial * r * s.out
			w = 2 * r * s.size
			hgt = w * FK.aspect
			-- behind the funnel (from the camera) they would show through it: fade those
			local toCam = Vector3.new(eye.X - c.X, 0, eye.Z - c.Z)
			local facing = if toCam.Magnitude > 1 then radial:Dot(toCam.Unit) else 1
			-- (fully gone once round the back: the funnel sorts behind its foot, so they would draw over it)
			a *= math.clamp((facing + 0.15) / 0.35, 0, 1)
			-- and on its face (straight toward the camera) they pile up into a pale glow: keep them to the
			-- silhouette, where they fray the outline
			local side = math.sqrt(math.max(1 - facing * facing, 0))
			a *= math.clamp((side - 0.35) / 0.4, 0, 1)
			-- and near the cloud and the ground
			a *= math.clamp((FK.to - t) / 0.08, 0, 1) * math.clamp((t - FK.from) / 0.05, 0, 1)
			colour = shaded(F.colorBottom:Lerp(F.colorTop, t ^ F.colorGamma), FK.shade)
		elseif s.kind == "dust" then
			local DK = K.dust
			local contact = State.centreAt(state, 0, time)
			s.phi += Vortex.spinRate(state, math.max(s.out, 1)) * DK.swirl * dt
			s.out += DK.spread * dt
			s.t += DK.rise * dt
			w = s.size * (1 + DK.grow * s.age / s.life)
			hgt = w * DK.aspect
			pos = contact + Vector3.new(math.cos(s.phi) * s.out, s.t + hgt * 0.3, math.sin(s.phi) * s.out)
			-- darker in the middle; the look's debris colour (ground-tinted by FunnelView)
			local dustColour = (Config.debris.groundDust or Config.debris.color) :: Color3
			colour = shaded(dustColour, DK.shade * (0.85 + 0.3 * s.pos.X))
			-- gone with a lifted funnel (no contact)
			a *= 1 - math.clamp(((state.bottom or 0) - 0.4) / 0.4, 0, 1)
		elseif s.kind == "scud" then
			local CK = K.scud
			-- drawn in toward the wall cloud by the inflow, turning a little round it
			local toWall = wc - s.pos
			if toWall.Magnitude > 1 then
				local u = toWall.Unit
				s.pos += (u * CK.inflow + Vector2.new(-u.Y, u.X) * CK.inflow * 0.5) * dt
			end
			local base = Vector3.new(top.X, groundY + H, top.Z)
			w = s.size
			hgt = w * CK.aspect
			pos = base + Vector3.new(s.pos.X, -s.hang - hgt * 0.5 - CK.clear, s.pos.Y)
			colour = shaded(s.colour, CK.shade)
		elseif s.kind == "deck" then
			local DK = K.deck
			-- wholly below the base's underside there (a sprite cutting through the mesh shows a straight cut)
			local base = Vector3.new(top.X, groundY + H, top.Z)
			w = s.size
			hgt = w * DK.aspect
			-- hugging the underside: only the puff's lower part hangs below it (the rendered puff
			-- fills about the middle half of its cell, so a quarter of the height down puts its belly
			-- just under the base)
			pos = base + Vector3.new(s.pos.X, s.t - s.hang - hgt * DK.sink - DK.clear, s.pos.Y)
			colour = shaded(s.colour, DK.gain)
			local m = math.max(colour.R, colour.G, colour.B)
			if m > DK.maxBright then
				colour = shaded(colour, DK.maxBright / m)
			end
		elseif s.kind == "edge" then
			local EK = K.edge
			local base = Vector3.new(top.X, groundY + H, top.Z)
			pos = base + Vector3.new(s.pos.X, -s.hang - s.age * EK.sink - s.size * EK.aspect * 0.5 - EK.clear, s.pos.Y)
			w = s.size
			hgt = w * EK.aspect
			colour = shaded(s.colour, EK.shade)
		else
			local WK = K.wall
			local R = S.wallCloud.radius
			local p = Vector2.new(s.pos.X * cw - s.pos.Y * sw, s.pos.X * sw + s.pos.Y * cw) * R
			-- wholly below the underside: a sprite cutting into the wall cloud shows a straight edge there
			pos = wallOrigin + Vector3.new(p.X, -s.hang - s.age * WK.sink - s.size * WK.aspect * 0.5 - WK.clear, p.Y)
			w = s.size
			hgt = w * WK.aspect
			colour = shaded(S.wallCloud.color, WK.shade)
		end
		self._cframes[k] = CFrame.new(pos)
		s.gui.Size = UDim2.fromScale(w, hgt)
		-- the flipbook, slowly, each frame cross-faded into the next (smooth at any frame rate)
		local kindCfg = (K :: any)[s.kind]
		local fps = kindCfg.flipFps or K.flipFps
		-- oneShot (a simulation flipbook: burst, billow, thin): the 16 frames play once over the life
		local pos01 = if kindCfg.oneShot then math.min(s.age / s.life, 0.999) * 15 else s.seed + s.age * fps
		local frame = if kindCfg.oneShot then math.floor(pos01) else math.floor(pos01) % 16
		local f = pos01 - math.floor(pos01)
		f = f * f * (3 - 2 * f)
		if frame ~= s.frame then
			s.frame = frame
			local nxt = (frame + 1) % 16
			s.img.ImageRectOffset = Vector2.new(frame % 4 * 256, frame // 4 * 256)
			s.img2.ImageRectOffset = Vector2.new(nxt % 4 * 256, nxt // 4 * 256)
		end
		a = math.clamp(a, 0, 1)
		local turn = s.img.Rotation + s.spin * dt
		for _, img in { s.img, s.img2 } do
			img.ImageColor3 = colour
			img.Rotation = turn
		end
		s.img.ImageTransparency = 1 - a * (1 - f)
		s.img2.ImageTransparency = 1 - a * f
	end
	Workspace:BulkMoveTo(self._parts, self._cframes, Enum.BulkMoveMode.FireCFrameChanged)
end

function WispSprites.destroy(self: WispSprites)
	self.folder:Destroy()
end

return WispSprites
