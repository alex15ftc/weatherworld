--!strict
-- The parent storm's cloud base (client only): one continuous ceiling the funnel grows out of.
-- In every reference the funnel flares into a wide, dark, lumpy base that runs off the frame;
-- without it the funnel reads as a lone column.
--
-- Built from cells on a jittered hex grid round the funnel's top. Each cell holds one still
-- emitter per layer (Config.cloudBaseLayers): a flattened sheet, darker lumps hanging below it
-- and faint torn shreds lower still. Cells near the funnel hang lower (the collar), so the funnel
-- widens into the base with no seam; cells near the rim fade out. Nothing spins (still particles
-- can differ a little in colour without flickering). Colours come from Config.base (the looks set
-- them): color near the funnel, edgeColor at the rim, the underside darker by underShade.
--
-- Particles thin out past ~1000 studs from the camera, and most of a ceiling seen from the ground
-- is farther than that, so the cells only cover the area near the funnel; the far ceiling is a
-- few huge horizontal layers with a seamless cloud texture on their undersides (textures don't
-- thin with distance, and the atmosphere's haze fades them like real cloud).
--
--   local base = CloudBase.new(workspace)
--   base:setState(state); RenderStepped: base:update(dt, time); base:apply() after Config edits
local Workspace = game:GetService("Workspace")

local Config = require(script.Parent.Config)
local FarSprite = require(script.Parent.FarSprite)
local State = require(script.Parent.State)

local CloudBase = {}
CloudBase.__index = CloudBase

type Cell = {
	offset: Vector3, -- from the funnel's top centre
	d: number, -- distance from the axis, studs
	parts: { BasePart },
	emitters: { ParticleEmitter },
	color: Color3, -- the sheet's colour (for the far sprite)
	edge: number, -- rim fade
	farGui: BillboardGui?,
	farImg: ImageLabel?,
}

export type CloudBase = typeof(setmetatable(
	{} :: {
		folder: Folder,
		cells: { Cell },
		ceiling: { BasePart },
		state: State.State?,
		frozen: boolean,
		signature: string,
		stats: { cells: number, emitters: number, particles: number },
		_parts: { BasePart },
		_cframes: { CFrame },
	},
	CloudBase
))

function CloudBase.new(parent: Instance?): CloudBase
	local folder = Instance.new("Folder")
	folder.Name = "CloudBase"
	folder.Parent = parent or Workspace
	return setmetatable({
		folder = folder,
		cells = {},
		ceiling = {},
		state = nil,
		frozen = false,
		signature = "",
		stats = { cells = 0, emitters = 0, particles = 0 },
		_parts = {},
		_cframes = {},
	}, CloudBase)
end

local function enabled(): boolean
	return Config.render.mode == "puffs" and Config.cloudBase.enabled
end

local function smooth01(x: number): number
	x = math.clamp(x, 0, 1)
	return x * x * (3 - 2 * x)
end

local function tinted(c: Color3, k: number): Color3
	return Color3.new(math.clamp(c.R * k, 0, 1), math.clamp(c.G * k, 0, 1), math.clamp(c.B * k, 0, 1))
end

-- The base's radius and cell spacing for this tornado.
local function extent(state: State.State): (number, number, number)
	local C = Config.cloudBase
	local rTop = State.radiusAt(state, 1)
	local R = math.clamp(rTop * C.radius, C.minRadius, C.maxRadius)
	return rTop, R, math.max(C.spacing, 20)
end

-- Cell positions (relative to the funnel's top), deterministic so rebuilds don't reshuffle.
local function layout(state: State.State): { { offset: Vector3, d: number } }
	local C = Config.cloudBase
	local H = math.max(state.cloudBase, 1)
	local rTop, R, s = extent(state)
	local rng = Random.new(C.seed)
	local out = {}
	local rows = math.ceil(R / (s * 0.866))
	for j = -rows, rows do
		local z0 = j * s * 0.866
		local cols = math.ceil(R / s) + 1
		for i = -cols, cols do
			local x = i * s + (if j % 2 == 0 then 0 else s * 0.5)
			local jx, jz = rng:NextNumber(-0.3, 0.3) * s, rng:NextNumber(-0.3, 0.3) * s
			local jy = rng:NextNumber(-0.5, 0.5) * C.thickness * C.lumpiness
			local px, pz = x + jx, z0 + jz
			local d = math.sqrt(px * px + pz * pz)
			if d <= R then
				-- the collar: near the funnel the base hangs lower, so the funnel widens into it
				local w = math.max(rTop * C.collar, 1)
				local drop = C.sag * H * math.exp(-(d / w) ^ 2)
				-- and the outer part rises a little (the base is lowest under the updraft)
				local rise = C.rise * H * smooth01((d - w) / math.max(R - w, 1))
				table.insert(out, { offset = Vector3.new(px, C.thickness * 0.5 - drop + rise + jy, pz), d = d })
			end
		end
	end
	return out
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
	e.Shape = Enum.ParticleEmitterShape.Box
	e.ShapeStyle = Enum.ParticleEmitterShapeStyle.Volume
	e.EmissionDirection = Enum.NormalId.Top
	e.Speed = NumberRange.new(0)
	e.Acceleration = Vector3.zero
	e.LockedToPart = true
	e.FlipbookMode = Enum.ParticleFlipbookMode.Loop
	e.FlipbookStartRandom = true
	e.FlipbookBlendFrames = true
	e.LightEmission = 0
	return e
end

-- The far ceiling: Config.cloudBase.ceiling.layers huge parts, each showing only a texture on its
-- underside (the part itself is invisible), stacked a little apart with different tilings.
local function buildCeiling(self: CloudBase)
	local K = Config.cloudBase.ceiling
	local want = if K.enabled then math.max(math.floor(K.layers), 0) else 0
	while #self.ceiling > want do
		(table.remove(self.ceiling) :: BasePart):Destroy()
	end
	while #self.ceiling < want do
		local p = newPart()
		p.Name = "Ceiling" .. (#self.ceiling + 1)
		local tex = Instance.new("Texture")
		tex.Name = "Underside"
		tex.Face = Enum.NormalId.Bottom
		tex.Parent = p
		p.Parent = self.folder
		table.insert(self.ceiling, p)
	end
end

local function styleCeiling(self: CloudBase)
	local K, B, C = Config.cloudBase.ceiling, Config.base, Config.cloudBase
	local n = #self.ceiling
	for i, p in self.ceiling do
		local f = if n > 1 then (i - 1) / (n - 1) else 0 -- 0 = top layer, 1 = lowest
		p.Size = Vector3.new(math.min(K.size, 2048), 1, math.min(K.size, 2048))
		local tex = p:FindFirstChild("Underside") :: Texture
		tex.Texture = Config.textures[K.texture] or K.texture
		local tile = K.tile * (1 + 0.37 * (i - 1))
		if K.snapTile then
			-- a whole number of repeats per part: every tile shows the same pattern, so no seams
			local span = math.min(K.size, 2048)
			tile = span / math.max(math.floor(span / tile + 0.5), 1)
		end
		tex.StudsPerTileU = tile
		tex.StudsPerTileV = if K.snapTile then tile else tile * 0.8
		tex.OffsetStudsU = (i - 1) * 311
		tex.OffsetStudsV = (i - 1) * 173
		local opacity = math.clamp(K.opacity * (1 - K.thinning * f), 0, 1)
		tex.Transparency = 1 - opacity
		tex.Color3 = tinted(B.edgeColor:Lerp(tinted(B.edgeColor, C.underShade), f), K.shade)
		-- the top layer can be a solid backing, so the sky never shows through the texture's gaps
		local backed = typeof(K.backing) == "Color3" and i == 1
		p.Transparency = if backed then 0 else 1
		p.Material = Enum.Material.SmoothPlastic
		p.Color = if backed then K.backing else B.edgeColor
	end
end

function CloudBase.clear(self: CloudBase)
	for _, p in self.ceiling do
		p:Destroy()
	end
	table.clear(self.ceiling)
	for _, c in self.cells do
		for _, p in c.parts do
			p:Destroy()
		end
	end
	table.clear(self.cells)
	table.clear(self._parts)
	table.clear(self._cframes)
	self.signature = ""
	self.stats.cells, self.stats.emitters, self.stats.particles = 0, 0, 0
end

function CloudBase.rebuild(self: CloudBase)
	self:clear()
	local state = self.state
	if not state or not enabled() then
		return
	end
	local list = layout(state)
	buildCeiling(self)
	self.signature = string.format("%d/%d", #list, #Config.cloudBaseLayers)
	for i, cell in list do
		local c: Cell = { offset = cell.offset, d = cell.d, parts = {}, emitters = {}, color = Config.base.color, edge = 1 }
		for l, layer in Config.cloudBaseLayers do
			local part = newPart()
			part.Name = string.format("Base%03d_%s", i, layer.name)
			local e = newEmitter()
			e.Parent = part
			part.Parent = self.folder
			c.parts[l] = part
			c.emitters[l] = e
			table.insert(self._parts, part)
			table.insert(self._cframes, CFrame.identity)
		end
		if c.parts[1] then
			c.farGui, c.farImg = FarSprite.new(c.parts[1])
		end
		table.insert(self.cells, c)
	end
	self:apply(true)
end

function CloudBase.apply(self: CloudBase, fill: boolean?)
	local state = self.state
	if not state then
		return
	end
	if not enabled() then
		if #self.cells > 0 then
			self:clear()
		end
		return
	end
	local list = layout(state)
	if string.format("%d/%d", #list, #Config.cloudBaseLayers) ~= self.signature then
		self:rebuild()
		return
	end
	local C, B, P = Config.cloudBase, Config.base, Config.puffs
	local _, R, s = extent(state)
	local k = Config.funnel.sizeScale
	local particles, emitters = 0, 0
	for i, c in self.cells do
		c.offset, c.d = list[i].offset, list[i].d
		local f = c.d / math.max(R, 1)
		local edge = 1 - smooth01((f - (1 - C.edgeFade)) / math.max(C.edgeFade, 1e-3))
		local top = B.color:Lerp(B.edgeColor, smooth01(f))
		c.color, c.edge = top, edge
		for l, layer in Config.cloudBaseLayers do
			local e, part = c.emitters[l], c.parts[l]
			local size = math.min(s * layer.size, Config.funnel.sizeMax)
			part.Size = Vector3.new(s * layer.spread, math.max(C.thickness * layer.height, 1), s * layer.spread)
			local life = math.max(layer.lifetime, 0.1)
			local opacity = if layer.enabled == false then 0 else math.clamp(layer.opacity * edge, 0, 1)
			local fi = math.clamp(layer.fadeIn, 0.01, 0.48)
			local fo = math.clamp(layer.fadeOut, 0.01, 0.48)
			local color = if layer.under then tinted(top, C.underShade) else top
			e.Texture = Config.textures[layer.texture] or layer.texture
			e.FlipbookLayout = if Config.SHEETS[layer.texture] then Enum.ParticleFlipbookLayout.Grid4x4 else Enum.ParticleFlipbookLayout.None
			local fps = math.clamp(layer.flipFps, 0, 30)
			e.FlipbookFramerate = NumberRange.new(fps * 0.8, math.min(fps * 1.2, 30))
			e.Rate = if opacity > 0.002 then layer.count / life else 0
			e.Lifetime = NumberRange.new(life * 0.8, life * 1.2)
			local env = size * 0.15
			e.Size = NumberSequence.new({
				NumberSequenceKeypoint.new(0, size * k, env * k),
				NumberSequenceKeypoint.new(1, math.min(size * layer.grow, Config.funnel.sizeMax) * k, env * k),
			})
			e.Squash = NumberSequence.new(layer.squash)
			e.Transparency = NumberSequence.new({
				NumberSequenceKeypoint.new(0, 1),
				NumberSequenceKeypoint.new(fi, 1 - opacity),
				NumberSequenceKeypoint.new(1 - fo, 1 - opacity),
				NumberSequenceKeypoint.new(1, 1),
			})
			e.Color = ColorSequence.new(tinted(color, layer.shade))
			e.Rotation = NumberRange.new(-layer.rotation, layer.rotation)
			e.RotSpeed = NumberRange.new(-layer.rotSpeed, layer.rotSpeed)
			e.Orientation = if layer.upright then Enum.ParticleOrientation.FacingCameraWorldUp else Enum.ParticleOrientation.FacingCamera
			e.Speed = NumberRange.new(0, layer.drift or 0)
			e.EmissionDirection = Enum.NormalId.Bottom
			e.SpreadAngle = Vector2.new(30, 30)
			e.LightInfluence = P.lightInfluence
			e.Brightness = P.brightness
			e.ZOffset = layer.zOffset
			e.TimeScale = if self.frozen then 0 else 1
			if fill and e.Rate > 0 then
				e:Emit(math.max(1, math.floor(layer.count * 0.7 + 0.5)))
			end
			if e.Rate > 0 then
				particles += layer.count
				emitters += 1
			end
		end
	end
	buildCeiling(self)
	styleCeiling(self)
	self.stats.cells = #self.cells
	self.stats.emitters = emitters
	self.stats.particles = particles
end

-- A state that changes every frame: positions follow in update(); call apply() now and then.
function CloudBase.setLive(self: CloudBase, state: State.State)
	self.state = state
end

function CloudBase.setState(self: CloudBase, state: State.State)
	self.state = state
	self:apply()
end

function CloudBase.setFrozen(self: CloudBase, frozen: boolean)
	self.frozen = frozen
	for _, c in self.cells do
		for _, e in c.emitters do
			e.TimeScale = if frozen then 0 else 1
		end
	end
end

function CloudBase.update(self: CloudBase, _dt: number, time: number)
	local state = self.state
	if not state or #self.cells == 0 then
		return
	end
	local H = math.max(state.cloudBase, 1)
	local top = State.centreAt(state, 1, time)
	-- the base is level: hang it at the cloud base height above the ground point's level
	local origin = Vector3.new(top.X, top.Y - (top.Y - (State.centreAt(state, 0, time).Y + H)), top.Z)
	local K = Config.far
	local camera = Workspace.CurrentCamera
	local eye = if camera then camera.CFrame.Position else Vector3.zero
	local s = math.max(Config.cloudBase.spacing, 20)
	local sheet = Config.cloudBaseLayers[1]
	local k = 0
	for _, c in self.cells do
		-- far away the particles aren't drawn: hand over to the cell's sprite
		local far = FarSprite.weight(eye, origin + c.offset)
		for _, e in c.emitters do
			e.LocalTransparencyModifier = far
		end
		if c.farGui and c.farImg then
			local w = K.baseSize * s
			local opacity = if sheet and sheet.enabled ~= false then K.baseOpacity * c.edge else 0
			FarSprite.show(c.farGui, c.farImg, w, w * K.baseSquash, c.color, opacity * far)
		end
		for l, part in c.parts do
			local layer = Config.cloudBaseLayers[l]
			k += 1
			self._parts[k] = part
			self._cframes[k] = CFrame.new(origin + c.offset + Vector3.new(0, Config.cloudBase.thickness * layer.y, 0))
		end
	end
	local K = Config.cloudBase.ceiling
	-- tiles of up to 2048 studs (the part size limit) round the funnel's top, layer by layer
	local span = math.min(K.size, 2048)
	local reach = math.max(math.floor(K.extent / span + 0.5), 0)
	-- Roblox stops drawing parts some thousands of studs away (sooner at low graphics quality), so
	-- a flat ceiling ends in a hard line in the sky; instead its outer part droops down to the
	-- horizon (droopStart -> droopEnd studs out), where the edge is hidden by the ground and haze
	local ground = origin.Y - H
	-- the tile grid can be turned (gridYaw, degrees) so a camera looks at a side, never a corner
	local turn = CFrame.Angles(0, math.rad(K.gridYaw or 0), 0)
	local function placed(y0: number, gx: number, gz: number): CFrame
		local r = turn:VectorToWorldSpace(Vector3.new(gx, 0, gz))
		local x, z = r.X, r.Z
		local d = math.sqrt(x * x + z * z)
		local function heightAt(r: number): number
			local f = smooth01((r - K.droopStart) / math.max(K.droopEnd - K.droopStart, 1))
			return y0 + (ground - y0) * f
		end
		local y = heightAt(d)
		if d < 1 then
			return CFrame.new(origin.X + x, y, origin.Z + z) * turn
		end
		local slope = (heightAt(d + 50) - heightAt(d - 50)) / 100
		local radial = Vector3.new(x / d, 0, z / d)
		local axis = Vector3.yAxis:Cross(radial)
		return CFrame.new(origin.X + x, y, origin.Z + z) * CFrame.fromAxisAngle(axis, math.atan(slope)) * turn
	end
	for i, p in self.ceiling do
		local y = origin.Y + K.height - (i - 1) * K.gap
		local cf = placed(y, 0, 0)
		k += 1
		self._parts[k] = p
		self._cframes[k] = cf
		-- the extra tiles (clones made on demand) sit round the first; the layers under the top one
		-- can stop sooner (detailReach), so the far edge is one line, not a stack of them
		local idx = 0
		local layerReach = if i > 1 and type(K.detailExtent) == "number" then math.min(reach, math.floor(K.detailExtent / span + 0.5)) else reach
		for gx = -reach, reach do
			for gz = -reach, reach do
				local corner = K.roundCorners and math.abs(gx) == reach and math.abs(gz) == reach and reach > 1
				if (gx ~= 0 or gz ~= 0) and not corner and math.abs(gx) <= layerReach and math.abs(gz) <= layerReach then
					idx += 1
					local name = "Tile" .. idx
					local tile = p:FindFirstChild(name) :: BasePart?
					if not tile then
						local c = p:Clone()
						for _, child in c:GetChildren() do
							if child:IsA("BasePart") then
								child:Destroy()
							end
						end
						c.Name = name
						c.Parent = p
						tile = c
					end
					local t = tile :: BasePart
					local tex = t:FindFirstChild("Underside") :: Texture
					local src = p:FindFirstChild("Underside") :: Texture
					tex.Texture, tex.Transparency, tex.Color3 = src.Texture, src.Transparency, src.Color3
					t.Transparency, t.Color, t.Material = p.Transparency, p.Color, p.Material
					tex.StudsPerTileU, tex.StudsPerTileV = src.StudsPerTileU, src.StudsPerTileV
					-- continue the pattern across tiles
					tex.OffsetStudsU = src.OffsetStudsU + gx * span
					tex.OffsetStudsV = src.OffsetStudsV + gz * span
					k += 1
					self._parts[k] = t
					self._cframes[k] = placed(y, gx * span, gz * span)
				end
			end
		end
	end
	Workspace:BulkMoveTo(self._parts, self._cframes, Enum.BulkMoveMode.FireCFrameChanged)
end

function CloudBase.destroy(self: CloudBase)
	self:clear()
	self.folder:Destroy()
end

return CloudBase
