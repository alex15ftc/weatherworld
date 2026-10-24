--!nonstrict
-- Particle render probes: a row of small labelled emitters in front of the lab camera, each
-- changing one thing from a plain working emitter, so a single screenshot shows which setting
-- stops particles from drawing. On while LabConfig.probes is true.
local Workspace = game:GetService("Workspace")

local Config = require(game:GetService("ReplicatedStorage"):WaitForChild("Shared"):WaitForChild("Tornado"):WaitForChild("Config"))

local Probes = {}

local BUILTIN = "rbxasset://textures/particles/smoke_main.dds"

local CASES = {
	{ label = "A plain (builtin, 20)" },
	{ label = "B soft texture", texture = Config.textures.soft },
	{ label = "C softSheet 4x4", texture = Config.textures.softSheet, sheet = true },
	{ label = "D size 100", size = 100 },
	{ label = "E size 250", size = 250, y = 330 },
	{ label = "F locked + spun", locked = true, spin = true },
	{ label = "G cylinder ring", cylinder = true },
	{ label = "H LightInfluence 1", light = 1 },
	{ label = "I locked + BulkMoveTo", locked = true, bulk = true },
	{ label = "J 1000 away, 60", size = 60, ahead = 1000 },
	{ label = "K 1700 away, 100", size = 100, ahead = 1700, x = -500 },
	{ label = "L 1700 away cyl ring", size = 100, ahead = 1700, x = -900, cylinder = true, big = true },
	-- size cap check: a crisp white disc (88% of its frame) of Size 500, 500 studs ahead; drawn at
	-- 2x Size it nearly fills the frame width, smaller means Roblox caps the size
	{ label = "Z Size 500 firm disc", texture = Config.textures.firmFlat, size = 500, ahead = 500, x = 0, y = 200 },
}

function Probes.start(camera: any)
	local folder = Instance.new("Folder")
	folder.Name = "LabProbes"
	folder.Parent = Workspace
	local spun, bulk = {}, {}
	-- a row across the view, ~350 studs in front of the default camera (which sits at z = distance)
	local z = camera.distance - 350
	for i, case in CASES do
		local x = case.x or ((i - (#CASES + 1) / 2) * 60 - 120)
		local part = Instance.new("Part")
		part.Name = "Probe_" .. string.sub(case.label, 1, 1)
		part.Anchored = true
		part.CanCollide = false
		part.CanQuery = false
		part.Transparency = 1
		part.Size = if case.big then Vector3.new(350, 60, 350) elseif case.cylinder then Vector3.new(50, 10, 50) else Vector3.new(4, 4, 4)
		local pz = if case.ahead then camera.distance - case.ahead else z
		part.CFrame = CFrame.new(x, case.y or (if case.ahead then 200 else 60), pz)
		local e = Instance.new("ParticleEmitter")
		e.Texture = case.texture or BUILTIN
		if case.sheet then
			e.FlipbookLayout = Enum.ParticleFlipbookLayout.Grid4x4
			e.FlipbookMode = Enum.ParticleFlipbookMode.Loop
		end
		e.Size = NumberSequence.new(case.size or 20)
		if case.label:sub(1, 1) == "Z" then
			e.Rate = 2
			e.Speed = NumberRange.new(0)
			e.SpreadAngle = Vector2.zero
			e.Color = ColorSequence.new(Color3.new(1, 0.3, 0.3))
			e.Transparency = NumberSequence.new(0.5)
		end
		e.Rate = 20
		e.Lifetime = NumberRange.new(2, 3)
		e.Speed = NumberRange.new(if case.cylinder then 0 else 4)
		e.SpreadAngle = Vector2.new(30, 30)
		e.LightInfluence = case.light or 0
		e.Color = ColorSequence.new(Color3.fromRGB(230, 230, 235))
		e.Transparency = NumberSequence.new(0.1)
		e.LockedToPart = case.locked == true
		if case.cylinder then
			e.Shape = Enum.ParticleEmitterShape.Cylinder
			e.ShapeStyle = Enum.ParticleEmitterShapeStyle.Surface
		end
		e.Parent = part
		local tag = Instance.new("BillboardGui")
		tag.Size = UDim2.fromOffset(110, 20)
		tag.StudsOffsetWorldSpace = Vector3.new(0, -40, 0)
		tag.AlwaysOnTop = true
		local text = Instance.new("TextLabel")
		text.Size = UDim2.fromScale(1, 1)
		text.BackgroundTransparency = 0.3
		text.BackgroundColor3 = Color3.new(0, 0, 0)
		text.TextColor3 = Color3.new(1, 1, 1)
		text.TextScaled = true
		text.Text = case.label
		text.Parent = tag
		tag.Parent = part
		part.Parent = folder
		if case.spin then
			table.insert(spun, part)
		end
		if case.bulk then
			table.insert(bulk, part)
		end
	end
	local angle = 0
	game:GetService("RunService").RenderStepped:Connect(function(dt)
		angle += dt
		for _, p in spun do
			p.CFrame = CFrame.new(p.Position) * CFrame.Angles(0, angle, 0)
		end
		local cfs = {}
		for i, p in bulk do
			cfs[i] = CFrame.new(p.Position) * CFrame.Angles(0, angle, 0)
		end
		Workspace:BulkMoveTo(bulk, cfs, Enum.BulkMoveMode.FireCFrameChanged)
	end)
	return folder
end

return Probes
