--!strict
-- The condensation funnel drawn with Beams (prototype, A+ plan Phase 0 diagnosis).
--
-- Why: Ref1's funnel edges are long, straight, soft ramps with a darker band just inside and
-- faint lengthwise streaks; a chain of round particles can't make an edge that straight. A
-- camera-facing Beam ribbon with a cross-section texture (tools/smoke/funnel_profile.py) can:
-- the texture is how a soft round column of cloud looks side-on, so turned to face the camera it
-- reads as the column from every side. A stack of beams along the bent axis, each as wide as the
-- funnel at its two ends, follows any shape; an outer, fainter veil softens the edge.
--
-- Beams have no particle draw-distance limit and cost a handful of instances. Their weak spot is
-- looking straight up or down the axis (a ribbon seen edge-on), so the puff funnel stays for
-- the inside and the views from below.
--
--   local beams = BeamFunnel.new(workspace)
--   beams:setLive(state); RenderStepped: beams:update(dt, time)
local Lighting = game:GetService("Lighting")
local Workspace = game:GetService("Workspace")

local Config = require(script.Parent.Config)
local State = require(script.Parent.State)
local Vortex = require(script.Parent.Vortex)
local FunnelImpostor = require(script.Parent.FunnelImpostor)

local BeamFunnel = {}
BeamFunnel.__index = BeamFunnel

type Layer = { beams: { Beam }, widthScale: number, opacity: number }

export type BeamFunnel = typeof(setmetatable(
	{} :: {
		folder: Folder,
		anchor: BasePart,
		attachments: { Attachment },
		layers: { Layer },
		state: State.State?,
		built: number,
		impostor: FunnelImpostor.FunnelImpostor?,
		impostorTried: boolean,
		spin: number,
		drawClock: number,
	},
	BeamFunnel
))

function BeamFunnel.new(parent: Instance?): BeamFunnel
	local folder = Instance.new("Folder")
	folder.Name = "BeamFunnel"
	folder.Parent = parent or Workspace
	local anchor = Instance.new("Part")
	anchor.Name = "Axis"
	anchor.Anchored, anchor.CanCollide, anchor.CanQuery, anchor.CanTouch = true, false, false, false
	anchor.Transparency = 1
	anchor.Size = Vector3.one
	anchor.CFrame = CFrame.identity
	anchor.Parent = folder
	return setmetatable({
		folder = folder, anchor = anchor, attachments = {}, layers = {}, state = nil, built = 0,
		impostor = nil, impostorTried = false, spin = 0, drawClock = 0,
	}, BeamFunnel)
end

function BeamFunnel.setLive(self: BeamFunnel, state: State.State)
	self.state = state
end
BeamFunnel.setState = BeamFunnel.setLive

local function clear(self: BeamFunnel)
	for _, layer in self.layers do
		for _, b in layer.beams do
			b:Destroy()
		end
	end
	for _, a in self.attachments do
		a:Destroy()
	end
	table.clear(self.layers)
	table.clear(self.attachments)
	self.built = 0
end

-- (Re)build the beams for the current settings.
function BeamFunnel.apply(self: BeamFunnel)
	clear(self)
	local B = Config.beamFunnel
	if not B.enabled then
		return
	end
	-- the live texture (EditableImage), if available; else the static cross-section
	if B.live and not self.impostorTried then
		self.impostorTried = true
		self.impostor = FunnelImpostor.new(B.impostor)
	end
	local n = B.segments
	-- two attachments per beam (start, end), extended past the joints so neighbours overlap:
	-- Roblox turns each beam to the camera as a whole, so beams meeting at an angle leave
	-- wedge-shaped gaps unless they overlap
	for i = 1, 2 * n do
		local a = Instance.new("Attachment")
		a.Name = "A" .. i
		a.Parent = self.anchor
		self.attachments[i] = a
	end
	for _, spec in B.layers do
		local layer: Layer = { beams = {}, widthScale = spec.width, opacity = spec.opacity }
		for i = 1, n do
			local b = Instance.new("Beam")
			b.Name = spec.name .. i
			b.Attachment0 = self.attachments[2 * i - 1]
			b.Attachment1 = self.attachments[2 * i]
			b.FaceCamera = true
			if B.live and self.impostor then
				b.TextureContent = self.impostor.content
			else
				b.Texture = Config.textures[B.texture] or B.texture
			end
			b.TextureMode = Enum.TextureMode.Stretch
			b.TextureLength = 1
			b.TextureSpeed = spec.scroll or 0
			b.Segments = 10
			b.LightInfluence = B.lightInfluence
			b.Brightness = B.brightness
			b.ZOffset = spec.zOffset or 0
			b.Parent = self.anchor
			layer.beams[i] = b
		end
		table.insert(self.layers, layer)
	end
	self.built = n
end

local function smoothstep(a: number, b: number, x: number): number
	local t = math.clamp((x - a) / (b - a), 0, 1)
	return t * t * (3 - 2 * t)
end

function BeamFunnel.update(self: BeamFunnel, dt: number, time: number)
	local B = Config.beamFunnel
	local state = self.state
	if not B.enabled or not state then
		if self.built > 0 then
			clear(self)
		end
		return
	end
	if self.built ~= B.segments then
		self:apply()
	end
	local F = Config.funnel
	local n = B.segments
	local bottom = math.clamp(state.bottom or 0, 0, 0.98)
	-- heights spaced more closely near the ground, where the shape changes fastest
	local ts = table.create(n + 1, 0)
	local radii = table.create(n + 1, 0)
	for i = 0, n do
		local s = i / n
		local t = bottom + (B.top - bottom) * (s ^ B.spacingPower)
		ts[i + 1] = t
		radii[i + 1] = State.radiusAt(state, t, time)
	end
	local pts = table.create(n + 1)
	for i = 0, n do
		pts[i + 1] = State.centreAt(state, ts[i + 1], time)
	end
	local over = B.overlap
	local rOver = table.create(2 * n, 0) -- radius at each attachment (extended ends)
	local fades = table.create(2 * n, 0) -- share of each beam's length crossfading at its start, end
	for i = 1, n do
		local p0, p1 = pts[i], pts[i + 1]
		local d = p1 - p0
		local len = d.Magnitude
		local dir = if len > 1e-4 then d / len else Vector3.yAxis
		local side = if math.abs(dir.Y) < 0.99 then dir:Cross(Vector3.yAxis).Unit else Vector3.xAxis
		local up = side:Cross(dir)
		local e0 = if i > 1 then over * len else 0 -- the ground end and the top end stay put
		local e1 = if i < n then over * len else 0
		self.attachments[2 * i - 1].CFrame = CFrame.fromMatrix(p0 - dir * e0, dir, up)
		self.attachments[2 * i].CFrame = CFrame.fromMatrix(p1 + dir * e1, dir, up)
		local total = len + e0 + e1
		fades[2 * i - 1] = if total > 0 then 2 * e0 / total else 0
		fades[2 * i] = if total > 0 then 2 * e1 / total else 0
		local dr = radii[i + 1] - radii[i]
		rOver[2 * i - 1] = radii[i] - dr * (e0 / math.max(len, 1e-4))
		rOver[2 * i] = radii[i + 1] + dr * (e1 / math.max(len, 1e-4))
	end
	-- the live texture: light from the real sun and the camera's side, streaks turning with the air
	local imp = self.impostor
	if B.live and imp then
		local mid = math.floor(n / 2) + 1
		self.spin += Vortex.spinRate(state, math.max(radii[mid], 1)) * B.spinShare * dt
		self.drawClock += dt
		if self.drawClock >= 1 / B.drawRate then
			self.drawClock = 0
			local cam = Workspace.CurrentCamera.CFrame.Position
			local view = pts[mid] - cam
			view = if view.Magnitude > 1e-3 then view.Unit else Vector3.zAxis
			imp:draw(view, Lighting:GetSunDirection(), self.spin)
		end
	end
	for _, layer in self.layers do
		for i = 1, n do
			local b = layer.beams[i]
			local t0, t1 = ts[i], ts[i + 1]
			b.CurveSize0 = 0
			b.CurveSize1 = 0
			b.Width0 = 2 * rOver[2 * i - 1] * layer.widthScale
			b.Width1 = 2 * rOver[2 * i] * layer.widthScale
			local tint = B.tint
			b.Color = ColorSequence.new(
				F.colorBottom:Lerp(F.colorTop, t0 ^ F.colorGamma):Lerp(Color3.new(), 1 - tint),
				F.colorBottom:Lerp(F.colorTop, t1 ^ F.colorGamma):Lerp(Color3.new(), 1 - tint)
			)
			-- fades into the cloud base at the top and in from a lifted bottom
			local function alpha(t: number): number
				local top = 1 - smoothstep(B.top - B.topFade, B.top, t)
				local foot = if bottom > 0.001 then smoothstep(bottom, bottom + B.footFade, t) else 1
				return layer.opacity * top * foot
			end
			-- (crossfading the overlapping ends was tried: half-transparent overlaps show as stripes)
			b.Transparency = NumberSequence.new(1 - alpha(t0), 1 - alpha(t1))
		end
	end
end

function BeamFunnel.destroy(self: BeamFunnel)
	clear(self)
	self.folder:Destroy()
end

return BeamFunnel
