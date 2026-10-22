--!strict
-- The tornado's art (Config.TORNADO_ART; images made by tools/blender): StormView says where and
-- how big, this says how it looks. Nothing here reads a tornado's type; everything comes from the
-- funnel's profile and the light.
--
--   Funnel     two tubes (EditableMesh): a core and a wispy outer shell, bent each frame to the
--              funnel's radius at each height, its lean and twist; they turn at a rate from the
--              tornado's wind (the cloud texture turns with them) and the texture creeps upward
--              (air rising in the vortex).
--   Debris     the dust puff flipbook (one-shot, a particle's life) on the debris emitter.
--   Sprite     beyond spriteBeyondStuds, a sprite of a rendered tornado, the shape nearest the
--              funnel's width / height, stretched to its size; two layers, lit and backlit.
--   Light      the angle between the sun and the line of sight (0 the sun behind the viewer, 1
--              behind the tornado) and how much direct sun there is. Sunlit, a funnel is white.
--              Backlit, a thin one glows (light passes through and scatters forward) and a thick
--              one is dark with the light behind it; with no direct sun (an overcast, under the
--              storm) it is a flat grey against the sky. It colours the mesh and blends the
--              sprite's layers (rendered with the same physics: tools/blender/tornado_sprite.py).
-- Without the art (ids empty) or without EditableMesh (Game Settings > Security > Allow Mesh /
-- Image APIs), StormView draws the funnel from parts as before.

local AssetService = game:GetService("AssetService")
local Lighting = game:GetService("Lighting")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage.Shared.World.Config)

local TornadoArt = {}

local ART = Config.TORNADO_ART
local TAU = math.pi * 2
local MAX_PART = 2048

local RINGS, SEGS = 24, 32
-- Per shell: radius (share of the funnel's), turn rate (share of the funnel's), rise (texture
-- heights a second), transparency, texture repeats round and up.
local SHELLS = {
	{ texture = ART.funnelCore, radius = 1.0, spin = 1.0, rise = 0.06, transparency = 0.04, uRepeat = 2, vRepeat = 3 },
	{ texture = ART.funnelWisp, radius = 1.22, spin = 0.6, rise = 0.04, transparency = 0.3, uRepeat = 1, vRepeat = 2 },
}

-- Colours of a funnel's cloud: sunlit (the sun behind the viewer); backlit, thin (glowing) and
-- thick (dark); in shadow (no direct sun); wrapped in rain.
local LIT = Color3.fromRGB(232, 232, 236)
local GLOW = Color3.fromRGB(240, 242, 246)
local DARK = Color3.fromRGB(58, 60, 66)
local SHADE = Color3.fromRGB(118, 121, 128)
local WRAPPED = Color3.fromRGB(44, 47, 54)
-- Funnel radius (m) over which a backlit funnel goes from glowing to dark.
local THIN_M, THICK_M = 25, 150

local function smoothstep(a: number, b: number, x: number): number
	local t = math.clamp((x - a) / (b - a), 0, 1)
	return t * t * (3 - 2 * t)
end

-- Where the sun is for a tornado at `foot` seen from the camera: 0 behind the viewer, 1 behind
-- the tornado (0.5 with the sun down).
function TornadoArt.sunAngle(foot: Vector3, cameraPos: Vector3): number
	local sun = Lighting:GetSunDirection()
	local look = foot - cameraPos
	if look.Magnitude < 1 or sun.Y < -0.05 then
		return 0.5
	end
	return smoothstep(-0.25, 0.7, sun:Dot(look.Unit))
end

-- How far toward the sprite's backlit layer to go: the sun's angle where there is direct sun;
-- with none, the backlit layer's flatter look stands in for the shade (0.6).
function TornadoArt.backlight(angle: number, direct: number): number
	local d = math.clamp(direct, 0, 1)
	return 0.6 * (1 - d) + angle * d
end

-- The funnel's colour: the sun's angle, the direct sun's share, rain wrapping round it (0-1) and
-- its radius (m, how thick it is to light from behind).
function TornadoArt.colour(angle: number, direct: number, rainWrap: number, radiusM: number): Color3
	local backlit = GLOW:Lerp(DARK, smoothstep(THIN_M, THICK_M, radiusM))
	local sunlit = LIT:Lerp(backlit, angle)
	return SHADE:Lerp(sunlit, math.clamp(direct, 0, 1)):Lerp(WRAPPED, math.clamp(rainWrap, 0, 1) * 0.8)
end

-- Funnel meshes ----------------------------------------------------------------------------

type Shell = {
	spec: any,
	mesh: any,
	part: MeshPart?,
	verts: { number },
	uvs: { number },
	uvBase: { Vector2 },
	failed: boolean,
}
type Funnel = { shells: { Shell }, used: boolean, lastUpdate: number }

local funnels: { [string]: Funnel } = {}
local meshWarned = false

local function newShell(spec: any, parent: Instance): Shell
	local shell: Shell = { spec = spec, mesh = nil, part = nil, verts = {}, uvs = {}, uvBase = {}, failed = false }
	local ok, em = pcall(function()
		return AssetService:CreateEditableMesh({})
	end)
	if not ok or not em then
		shell.failed = true
		if not meshWarned then
			meshWarned = true
			warn(`[TornadoArt] no EditableMesh ({em}): funnels drawn from parts. Turn on Allow Mesh / Image APIs (Game Settings > Security).`)
		end
		return shell
	end
	shell.mesh = em
	-- A unit tube, y from -1 to 1, radius 1; the seam column doubled so u runs 0 to 1.
	for i = 0, RINGS - 1 do
		local y = -1 + 2 * i / (RINGS - 1)
		for j = 0, SEGS do
			local a = TAU * j / SEGS
			table.insert(shell.verts, em:AddVertex(Vector3.new(math.cos(a), y, math.sin(a))))
			local base = Vector2.new(spec.uRepeat * j / SEGS, spec.vRepeat * (1 - i / (RINGS - 1)))
			table.insert(shell.uvBase, base)
			table.insert(shell.uvs, em:AddUV(base))
		end
	end
	local function at(i: number, j: number): number
		return i * (SEGS + 1) + j + 1
	end
	for i = 0, RINGS - 2 do
		for j = 0, SEGS - 1 do
			local a, b, c, d = at(i, j), at(i, j + 1), at(i + 1, j), at(i + 1, j + 1)
			-- Wound to face outward.
			local f1 = em:AddTriangle(shell.verts[a], shell.verts[c], shell.verts[b])
			em:SetFaceUVs(f1, { shell.uvs[a], shell.uvs[c], shell.uvs[b] })
			local f2 = em:AddTriangle(shell.verts[b], shell.verts[c], shell.verts[d])
			em:SetFaceUVs(f2, { shell.uvs[b], shell.uvs[c], shell.uvs[d] })
		end
	end
	task.spawn(function()
		local made, part = pcall(function()
			return AssetService:CreateMeshPartAsync(Content.fromObject(em))
		end)
		if not made or not part then
			shell.failed = true
			warn(`[TornadoArt] funnel mesh part not made: {part}`)
			return
		end
		local p = part :: MeshPart
		p.Anchored, p.CanCollide, p.CanQuery, p.CanTouch, p.CastShadow = true, false, false, false, false
		p.Material = Enum.Material.SmoothPlastic
		p.Transparency = 1
		if spec.texture ~= "" then
			p.TextureID = spec.texture
		end
		p.Name = "funnelShell"
		p.Parent = parent
		shell.part = p
	end)
	return shell
end

-- Draws a tornado's funnel as meshes. axis(f) and radius(f) give the funnel's centre (studs) and
-- radius (studs) at a share f of the height to the cloud base; it is drawn from f = lo to hi.
-- spinRate in radians a second; transparency 0-1 over the shells' own; `near` asks for an update
-- every frame (otherwise ~15 a second). Returns false when meshes are not available yet (or at
-- all): draw it some other way this frame.
function TornadoArt.drawFunnel(key: string, parent: Instance, axis: (number) -> Vector3, radius: (number) -> number, lo: number, hi: number, clock: number, spinRate: number, colour: Color3, transparency: number, near: boolean): boolean
	local funnel = funnels[key]
	if not funnel then
		funnel = { shells = {}, used = true, lastUpdate = -math.huge }
		for _, spec in SHELLS do
			table.insert(funnel.shells, newShell(spec, parent))
		end
		funnels[key] = funnel
	end
	funnel.used = true
	for _, shell in funnel.shells do
		if shell.failed or not shell.part then
			return false
		end
	end
	if not near and clock - funnel.lastUpdate < 1 / 15 then
		return true
	end
	funnel.lastUpdate = clock
	for _, shell in funnel.shells do
		local spec = shell.spec
		local part = shell.part :: MeshPart
		local turn = clock * spinRate * spec.spin
		-- The rings in world space, and their bounds.
		local points = table.create(RINGS * (SEGS + 1))
		local lo3, hi3 = Vector3.one * math.huge, -Vector3.one * math.huge
		for i = 0, RINGS - 1 do
			local f = lo + (hi - lo) * i / (RINGS - 1)
			local c = axis(f)
			local r = math.max(1, radius(f) * spec.radius)
			for j = 0, SEGS do
				local a = TAU * j / SEGS + turn
				local p = c + Vector3.new(math.cos(a) * r, 0, math.sin(a) * r)
				table.insert(points, p)
				lo3, hi3 = lo3:Min(p), hi3:Max(p)
			end
		end
		-- Vertices in the part's space, scaled to fill -1..1 (the part's size scales them back).
		local centre = (lo3 + hi3) / 2
		local half = ((hi3 - lo3) / 2):Max(Vector3.one)
		local size = (half * 2):Min(Vector3.one * MAX_PART)
		for k, p in points do
			shell.mesh:SetPosition(shell.verts[k], (p - centre) / half)
		end
		-- The texture creeping upward.
		local rise = (clock * spec.rise) % 1
		for k, uv in shell.uvs do
			local base = shell.uvBase[k]
			shell.mesh:SetUV(uv, Vector2.new(base.X, base.Y + rise))
		end
		if part.Size ~= size then
			part.Size = size
		end
		part.CFrame = CFrame.new(centre)
		part.Color = colour
		part.Transparency = 1 - (1 - spec.transparency) * (1 - math.clamp(transparency, 0, 1))
	end
	return true
end

-- Hides funnels not drawn this frame, and lets go of tornadoes gone for good.
function TornadoArt.sweep(alive: { [string]: boolean })
	for key, funnel in funnels do
		if not funnel.used then
			for _, shell in funnel.shells do
				if shell.part then
					shell.part.Transparency = 1
				end
			end
			if not alive[key] then
				for _, shell in funnel.shells do
					if shell.part then
						shell.part:Destroy()
					end
					if shell.mesh then
						shell.mesh:Destroy()
					end
				end
				funnels[key] = nil
			end
		end
		funnel.used = false
	end
end

-- Debris ----------------------------------------------------------------------------------

-- The dust puff on a debris emitter (once, when the art is there).
function TornadoArt.styleDebris(e: ParticleEmitter): boolean
	if ART.dustPuff == "" then
		return false
	end
	if e.Texture ~= ART.dustPuff then
		e.Texture = ART.dustPuff
		e.FlipbookLayout = Enum.ParticleFlipbookLayout.Grid8x8
		e.FlipbookMode = Enum.ParticleFlipbookMode.OneShot
		e.Rotation = NumberRange.new(-15, 15)
		e.RotSpeed = NumberRange.new(-8, 8)
	end
	return true
end

-- Sprites ---------------------------------------------------------------------------------

type Sprite = { part: Part, lit: ImageLabel, back: ImageLabel, used: boolean }
local sprites: { [string]: Sprite } = {}
local SHEET = ART.spriteSheet

local function spriteFor(ratio: number): any?
	local best, bestGap = nil, math.huge
	for _, s in ART.sprites do
		if s.lit ~= "" and s.back ~= "" then
			local gap = math.abs(math.log(ratio / s.ratio))
			if gap < bestGap then
				best, bestGap = s, gap
			end
		end
	end
	return best
end

local function newSprite(parent: Instance): Sprite
	local part = Instance.new("Part")
	part.Anchored, part.CanCollide, part.CanQuery, part.CanTouch, part.CastShadow = true, false, false, false, false
	part.Transparency = 1
	part.Name = "tornadoSprite"
	local gui = Instance.new("SurfaceGui")
	gui.Face = Enum.NormalId.Front
	gui.SizingMode = Enum.SurfaceGuiSizingMode.FixedSize
	gui.CanvasSize = Vector2.new(SHEET.width, SHEET.height)
	gui.LightInfluence = 1
	gui.Parent = part
	local function layer(z: number): ImageLabel
		local l = Instance.new("ImageLabel")
		l.Size = UDim2.fromScale(1, 1)
		l.BackgroundTransparency = 1
		l.ImageRectSize = Vector2.new(SHEET.width, SHEET.height)
		l.ZIndex = z
		l.Parent = gui
		return l
	end
	local sprite = { part = part, back = layer(1), lit = layer(2), used = true }
	part.Parent = parent
	return sprite
end

-- Draws the distant tornado as a sprite: its foot on the ground, `height` studs to the cloud base,
-- the funnel's width / height, how backlit it looks, how far it is down (touch). Returns false
-- when there is no sprite art (draw the mesh instead).
function TornadoArt.drawSprite(key: string, parent: Instance, foot: Vector3, height: number, ratio: number, back: number, touch: number, rainWrap: number, cameraPos: Vector3, clock: number): boolean
	local art = spriteFor(math.max(0.01, ratio))
	if not art then
		return false
	end
	local sprite = sprites[key]
	if not sprite then
		sprite = newSprite(parent)
		sprites[key] = sprite
	end
	sprite.used = true
	-- The rendered shape stretched to this funnel's width.
	local stretch = math.clamp(ratio / art.ratio, 0.6, 1.6)
	local w = math.min(MAX_PART, height * SHEET.width / SHEET.height * stretch)
	local h = math.min(MAX_PART, height)
	local centre = foot + Vector3.new(0, h / 2, 0)
	sprite.part.Size = Vector3.new(w, h, 0.2)
	sprite.part.CFrame = CFrame.lookAt(centre, Vector3.new(cameraPos.X, centre.Y, cameraPos.Z))
	local frame = math.floor(clock * SHEET.fps) % (SHEET.columns * SHEET.rows)
	local offset = Vector2.new((frame % SHEET.columns) * SHEET.width, math.floor(frame / SHEET.columns) * SHEET.height)
	local wrapDim = 1 - 0.55 * math.clamp(rainWrap, 0, 1)
	for _, l in { sprite.lit, sprite.back } do
		l.ImageRectOffset = offset
		l.ImageColor3 = Color3.new(wrapDim, wrapDim, wrapDim)
	end
	sprite.lit.Image = art.lit
	sprite.back.Image = art.back
	-- The backlit layer underneath, the sunlit one over it as far as the light is from behind.
	local shown = math.clamp(touch, 0, 1)
	sprite.back.ImageTransparency = 1 - shown
	sprite.lit.ImageTransparency = 1 - shown * (1 - math.clamp(back, 0, 1))
	return true
end

function TornadoArt.sweepSprites()
	for key, sprite in sprites do
		if not sprite.used then
			sprite.part:Destroy()
			sprites[key] = nil
		else
			sprite.used = false
		end
	end
end

return TornadoArt
