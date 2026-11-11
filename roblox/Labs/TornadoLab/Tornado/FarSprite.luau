--!strict
-- Stand-ins for distant smoke. Roblox stops drawing particles a few hundred studs from the
-- camera (measured ~750 studs at graphics quality 8; less at lower quality), so a funnel or cloud
-- base farther away than that simply vanishes. Past Config.far.start each puff carrier and base
-- cell cross-fades from its particles to one camera-facing soft sprite (a BillboardGui, drawn at
-- any distance), sized and coloured like the smoke it replaces.
--
--   local gui, img = FarSprite.new(part)      -- follows the part
--   local w = FarSprite.weight(cameraPos, pos) -- 0 = particles only ... 1 = sprite only
--   FarSprite.show(gui, img, width, height, color, opacity)
local Config = require(script.Parent.Config)

local FarSprite = {}

local serial = 0

-- `seed` picks the sprite's frame of the sheet and its turn, so stacked sprites don't line up
-- (identical round sprites stacked up a funnel band into concentric rings).
function FarSprite.new(adornee: BasePart, seed: number?): (BillboardGui, ImageLabel)
	serial += 1
	local n = seed or serial
	local gui = Instance.new("BillboardGui")
	gui.Name = "Far"
	gui.Adornee = adornee
	gui.AlwaysOnTop = false
	gui.MaxDistance = math.huge
	gui.ClipsDescendants = false
	gui.Enabled = false
	gui.LightInfluence = Config.puffs.lightInfluence
	gui.Brightness = Config.puffs.brightness
	gui.Size = UDim2.fromScale(1, 1)
	local img = Instance.new("ImageLabel")
	img.Name = "Puff"
	img.BackgroundTransparency = 1
	img.BorderSizePixel = 0
	img.Size = UDim2.fromScale(1, 1)
	local tex = Config.far.texture
	img.Image = Config.textures[tex] or tex
	if Config.SHEETS[tex] then
		-- one 256 px frame of the 4x4 sheet (1024 px)
		local frame = (n * 7) % 16
		img.ImageRectSize = Vector2.new(256, 256)
		img.ImageRectOffset = Vector2.new(frame % 4 * 256, frame // 4 * 256)
	end
	img.Rotation = (n * 137.5) % 360
	img.Parent = gui
	gui.Parent = adornee
	return gui, img
end

-- How far into the hand-over a point at `pos` is, seen from `cameraPos`.
function FarSprite.weight(cameraPos: Vector3, pos: Vector3): number
	local K = Config.far
	if not K.enabled then
		return 0
	end
	local x = math.clamp(((cameraPos - pos).Magnitude - K.start) / math.max(K.band, 1), 0, 1)
	return x * x * (3 - 2 * x)
end

function FarSprite.show(gui: BillboardGui, img: ImageLabel, width: number, height: number, color: Color3, opacity: number)
	if opacity <= 0.003 then
		gui.Enabled = false
		return
	end
	gui.Enabled = true
	gui.Size = UDim2.fromScale(width, height)
	img.ImageColor3 = color
	img.ImageTransparency = 1 - math.clamp(opacity, 0, 1)
end

return FarSprite
