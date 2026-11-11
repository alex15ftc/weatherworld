--!strict
-- Rain under the parent storm, the lab's way: tall camera-facing parts with a rain-shaft texture
-- sliding down, stacked so the curtain fades out in steps toward the cloud base. No EditableMesh
-- budget needed. Placed in the storm's frame (Config.stormBase: heading, wall cloud,
-- rain core), so they sit where a supercell's rain falls (docs/storm-reference, real/11_parent_*):
--   core   a cluster of grey veils round the rain core, ahead and left of the storm's motion:
--          densest in the middle, thinner and paler at its edge
--   wrap   a few thin curtains curving round the wall cloud's rear and right (the rear-flank
--          downdraught's rain, which can wrap the tornado)
-- Each curtain hangs from the cloud base to the ground, faces the camera, and its texture scrolls
-- down (the rain falling).
--
--   local rain = RainCurtains.new(workspace); rain:setState(state)
--   RenderStepped: rain:setLive(state); rain:update(dt, time)
local Workspace = game:GetService("Workspace")

local Config = require(script.Parent.Config)
local State = require(script.Parent.State)

local RainCurtains = {}
RainCurtains.__index = RainCurtains

type Curtain = {
	pieces: { { part: Part, texture: Texture } }, -- bottom to top
	offset: Vector2, -- from the tornado's top, studs (x, z)
	width: number,
	opacity: number,
	tall: number, -- the height the pieces were sized for
}

export type RainCurtains = typeof(setmetatable(
	{} :: {
		folder: Folder,
		curtains: { Curtain },
		state: State.State?,
		signature: string,
		fall: number, -- studs the rain image has slid down
		_parts: { BasePart },
		_cframes: { CFrame },
	},
	RainCurtains
))

function RainCurtains.new(parent: Instance?): RainCurtains
	local folder = Instance.new("Folder")
	folder.Name = "RainCurtains"
	folder.Parent = parent or Workspace
	return setmetatable({
		folder = folder,
		curtains = {},
		state = nil,
		signature = "",
		fall = 0,
		_parts = {},
		_cframes = {},
	}, RainCurtains)
end

local function clear(self: RainCurtains)
	for _, c in self.curtains do
		for _, piece in c.pieces do
			piece.part:Destroy()
		end
	end
	table.clear(self.curtains)
	table.clear(self._parts)
	table.clear(self._cframes)
	self.signature = ""
end

-- A curtain: a stack of camera-facing parts (turned about the vertical), each with the rain-shaft
-- texture sliding down. The upper pieces are fainter and fainter, so the curtain fades out up into
-- the base in steps instead of ending in one hard edge (a part's Texture can't fade along its
-- height; textured Beams and SurfaceGui gradients this far out didn't draw properly in Studio
-- 0.744). The streaks run vertically, so the pieces join without a visible seam.
local function newCurtain(self: RainCurtains, offset: Vector2, width: number, opacity: number, colour: Color3)
	local R = Config.rainCurtains
	local pieces = {}
	for i = 1, #R.steps do
		local p = Instance.new("Part")
		p.Name = "Rain" .. i
		p.Anchored, p.CanCollide, p.CanQuery, p.CanTouch = true, false, false, false
		p.CastShadow = false
		p.Transparency = 1
		p.Size = Vector3.new(math.min(width, 2048), 1, 0.2) -- height set in update
		local t = Instance.new("Texture")
		t.Face = Enum.NormalId.Front
		t.Texture = R.texture
		t.Color3 = colour
		t.StudsPerTileU = width
		t.StudsPerTileV = width * R.tileAspect
		t.Parent = p
		p.Parent = self.folder
		table.insert(pieces, { part = p, texture = t })
		table.insert(self._parts, p)
		table.insert(self._cframes, CFrame.identity)
	end
	table.insert(self.curtains, { pieces = pieces, offset = offset, width = width, opacity = opacity, tall = 0 })
end

-- (Re)build when the storm's layout changes.
function RainCurtains.apply(self: RainCurtains)
	local R, S = Config.rainCurtains, Config.stormBase
	local state = self.state
	if not R.enabled or not state then
		clear(self)
		return
	end
	local sig = table.concat({ S.heading, S.precipAhead, S.precipLeft, S.wallCloud.ahead, S.wallCloud.left, S.wallCloud.radius,
		R.count, R.coreRadius, R.wrapCount, R.seed, R.opacity[1], R.opacity[2], R.color.R, state.cloudBase }, "/")
	if sig == self.signature then
		return
	end
	clear(self)
	local h = math.rad(S.heading)
	local fwd = Vector2.new(math.cos(h), -math.sin(h))
	local left = Vector2.new(fwd.Y, -fwd.X)
	local wc = fwd * S.wallCloud.ahead + left * S.wallCloud.left
	local core = wc + fwd * S.precipAhead + left * S.precipLeft
	local rng = Random.new(R.seed)
	-- the core: scattered round its middle, denser and darker toward it
	for _ = 1, R.count do
		local a = rng:NextNumber(0, 2 * math.pi)
		local d = R.coreRadius * math.sqrt(rng:NextNumber(0, 1))
		local f = d / R.coreRadius
		local opacity = R.opacity[2] + (R.opacity[1] - R.opacity[2]) * f
		local colour = R.color:Lerp(R.edgeColor, f)
		newCurtain(self, core + Vector2.new(math.cos(a), math.sin(a)) * d, rng:NextNumber(R.width[1], R.width[2]), opacity, colour)
	end
	-- the wrap: thin veils on an arc round the wall cloud's rear and right
	for k = 1, R.wrapCount do
		local s = (k - 0.5) / R.wrapCount
		local ang = math.rad(R.wrapFrom + (R.wrapTo - R.wrapFrom) * s) -- off the storm's motion, + to the left
		local dir = fwd * math.cos(ang) + left * math.sin(ang)
		local at = wc + dir * S.wallCloud.radius * R.wrapAt * rng:NextNumber(0.85, 1.15)
		newCurtain(self, at, rng:NextNumber(R.width[1], R.width[2]) * 0.6, R.wrapOpacity, R.edgeColor)
	end
	self.signature = sig
end

function RainCurtains.setState(self: RainCurtains, state: State.State)
	self.state = state
	task.defer(self.apply, self)
end

function RainCurtains.setLive(self: RainCurtains, state: State.State)
	self.state = state
end

function RainCurtains.update(self: RainCurtains, dt: number, time: number)
	local state = self.state
	if not state or #self.curtains == 0 then
		return
	end
	local R = Config.rainCurtains
	local camera = Workspace.CurrentCamera
	local eye = if camera then camera.CFrame.Position else Vector3.zero
	local top = State.centreAt(state, 1, time)
	local groundY = State.centreAt(state, 0, time).Y
	local H = math.max(state.cloudBase, 1)
	-- from a little under the ground up to just under the cloud base, fading out in steps
	local tall = H * R.reach + 20
	self.fall += R.fallSpeed * dt
	local k = 0
	for _, c in self.curtains do
		local x, z = top.X + c.offset.X, top.Z + c.offset.Y
		local face = Vector3.new(eye.X, 0, eye.Z)
		local here = Vector3.new(x, 0, z)
		local turn = if (face - here).Magnitude > 1 then CFrame.lookAt(here, face).Rotation else CFrame.identity
		-- close up a curtain reads as a flat sheet, not rain: fade it out (near rain is the camera's own)
		local dist = (face - here).Magnitude
		local near = math.clamp((dist - R.nearFade[1]) / (R.nearFade[2] - R.nearFade[1]), 0, 1)
		local resize = math.abs(c.tall - tall) > 1
		c.tall = tall
		local lo = 0
		for i, piece in c.pieces do
			local step = R.steps[i]
			local hi = step[1] -- this piece runs up to this share of the curtain's height
			local h0, h1 = lo * tall, hi * tall
			k += 1
			self._cframes[k] = CFrame.new(x, groundY - 20 + (h0 + h1) * 0.5, z) * turn
			if resize then
				piece.part.Size = Vector3.new(piece.part.Size.X, math.max(h1 - h0, 1), 0.2)
			end
			piece.texture.Transparency = 1 - c.opacity * step[2] * near
			-- falling: OffsetStudsV goes down; offset by the piece's height so the streaks line up
			piece.texture.OffsetStudsV = -((self.fall + h1) % piece.texture.StudsPerTileV)
			lo = hi
		end
	end
	Workspace:BulkMoveTo(self._parts, self._cframes, Enum.BulkMoveMode.FireCFrameChanged)
end

function RainCurtains.destroy(self: RainCurtains)
	clear(self)
	self.folder:Destroy()
end

return RainCurtains
