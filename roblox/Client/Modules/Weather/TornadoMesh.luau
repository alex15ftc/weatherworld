--!strict
-- The close-up tornado: a skinned funnel (ReplicatedStorage.Assets.TornadoFunnel, loaded by
-- TornadoAssetService) shaped every frame from the storm the server relays.
--
-- Roblox bones cannot scale, so the mesh has rings of spoke bones (scripts/blender/
-- build_funnel_rig.py): each ring's spokes are pushed out to the funnel's radius at that
-- height, stood on its leaning, snaking axis, and turned round it for the spin. The mesh keeps
-- its imported size (its bones are placed in the part's space), so the part is stood on the
-- ground and the bones reach up the whole funnel from there.
--
-- Two copies make a funnel: the core, and the skin a little outside it where the edge breaks up.
-- Each wears frames of the funnel's edge boil (the model's Boil/<shell> SurfaceAppearances,
-- tools/funnel-model.luau): scripts cannot change a SurfaceAppearance's image, so the frame
-- shown is whichever one is parented to the part, swapped on as the clock runs.

local ContentProvider = game:GetService("ContentProvider")

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local TornadoMesh = {}

-- What a tornado's funnel looks like this frame.
export type Pose = {
	foot: Vector3, -- where its axis meets the ground
	axis: (f: number) -> Vector3, -- its axis at a share of its height (0 ground, 1 cloud base)
	radius: (f: number) -> number, -- its radius there, studs
	lowest: number, -- the share of the height its funnel reaches down to
	spin: (f: number) -> number, -- how far it has turned there, radians
	clock: number, -- seconds; the boil runs on it
	colour: Color3,
	transparency: number,
}

-- The shells: how far out each sits (a share of the funnel's radius; the textures were baked
-- there too, scripts/blender/bake_funnel_boil.py) and how see-through it is beyond the pose's.
local SHELLS = {
	{ name = "core", radius = 0.9, transparency = 0 },
	{ name = "skin", radius = 1.03, transparency = 0.1 },
}
-- The boil plays this many seconds of the baked funnel's clock a second.
local BOIL_SPEED = 0.6

type Spoke = { bone: Bone, frame: CFrame, angle: number }
type Shell = { part: MeshPart, rings: { { Spoke } }, radius: number, transparency: number, frames: { SurfaceAppearance }, shown: SurfaceAppearance? }
type Funnel = { shells: { Shell }, drawn: boolean }

local funnels: { [string]: Funnel } = {}
local template: MeshPart? = nil
local problem: string? = nil
local boilSeconds = 4
local preloaded = false

local function findTemplate(): MeshPart?
	if template then
		return template
	end
	local assets = ReplicatedStorage:FindFirstChild("Assets")
	local found = assets and assets:FindFirstChild("TornadoFunnel")
	if found and found:IsA("MeshPart") then
		template = found
		local boil = found:FindFirstChild("Boil")
		if boil then
			boilSeconds = (boil:GetAttribute("Seconds") :: number?) or boilSeconds
			if not preloaded then
				preloaded = true
				-- Every frame loaded before it is needed, so swapping one on does not flash.
				task.spawn(ContentProvider.PreloadAsync, ContentProvider, boil:GetDescendants())
			end
		end
	end
	return template
end

-- A copy of the funnel mesh for one shell, with its spokes by ring (R<ring>_S<spoke>) and where
-- each sits in the part's space and round its ring before it is moved, and its boil frames.
local function newShell(source: MeshPart, spec: { name: string, radius: number, transparency: number }): Shell?
	local part = source:Clone()
	local root = part:FindFirstChild("Root")
	if not (root and root:IsA("Bone")) then
		problem = "TornadoFunnel has no Root bone"
		part:Destroy()
		return nil
	end
	local rings: { { Spoke } } = {}
	for _, child in root:GetChildren() do
		local ring, spoke = string.match(child.Name, "^R(%d+)_S(%d+)$")
		if ring and spoke and child:IsA("Bone") then
			local r = (tonumber(ring) :: number) + 1
			rings[r] = rings[r] or {}
			local frame = root.CFrame * child.CFrame
			table.insert(rings[r], { bone = child, frame = frame, angle = math.atan2(frame.Position.Z, frame.Position.X) })
		end
	end
	if #rings < 2 then
		problem = "TornadoFunnel has no ring bones"
		part:Destroy()
		return nil
	end
	local frames: { SurfaceAppearance } = {}
	local boil = part:FindFirstChild("Boil")
	local folder = boil and boil:FindFirstChild(spec.name)
	if folder then
		for _, child in folder:GetChildren() do
			if child:IsA("SurfaceAppearance") then
				table.insert(frames, child)
			end
		end
		table.sort(frames, function(a, b)
			return a.Name < b.Name
		end)
	end
	part.Parent = workspace
	return { part = part, rings = rings, radius = spec.radius, transparency = spec.transparency, frames = frames }
end

local function newFunnel(): Funnel?
	local source = findTemplate()
	if not source then
		return nil
	end
	local shells: { Shell } = {}
	for _, spec in SHELLS do
		local shell = newShell(source, spec)
		if not shell then
			for _, made in shells do
				made.part:Destroy()
			end
			return nil
		end
		table.insert(shells, shell)
	end
	return { shells = shells, drawn = false }
end

local function pose(shell: Shell, p: Pose)
	local part = shell.part
	-- The part stands on the ground with its bottom (the bind pose's ground ring) at the foot.
	part.CFrame = CFrame.new(p.foot + Vector3.new(0, part.Size.Y / 2, 0))
	part.Color = p.colour
	part.Transparency = 1 - (1 - p.transparency) * (1 - shell.transparency)
	local n = #shell.rings
	for r, spokes in shell.rings do
		-- The rings spread over what is shown: from the lowest point up to the cloud base.
		local f = p.lowest + (1 - p.lowest) * (r - 1) / (n - 1)
		local centre = part.CFrame:PointToObjectSpace(p.axis(f))
		local radius = p.radius(f) * shell.radius
		local turn = p.spin(f)
		for _, spoke in spokes do
			local a = spoke.angle + turn
			local target = centre + Vector3.new(math.cos(a) * radius, 0, math.sin(a) * radius)
			spoke.bone.Transform = CFrame.new(spoke.frame:PointToObjectSpace(target))
		end
	end
	-- The boil: the frame for the clock, swapped on in place of the last.
	local count = #shell.frames
	if count > 0 then
		local k = math.floor((p.clock * BOIL_SPEED / boilSeconds) % 1 * count) + 1
		local frame = shell.frames[k]
		if frame ~= shell.shown then
			if shell.shown then
				shell.shown.Parent = (part :: any).Boil
			end
			frame.Parent = part
			shell.shown = frame
		end
	end
end

-- Draws tornado `id` as the mesh; false where it cannot (the model has not loaded).
function TornadoMesh.draw(id: string, p: Pose): boolean
	local funnel = funnels[id]
	if not funnel then
		local made = newFunnel()
		if not made then
			return false
		end
		funnel = made
		funnels[id] = funnel
	end
	funnel.drawn = true
	for _, shell in funnel.shells do
		pose(shell, p)
	end
	return true
end

-- After a frame's draws: removes the funnels not drawn this frame.
function TornadoMesh.sweep()
	for id, funnel in funnels do
		if not funnel.drawn then
			for _, shell in funnel.shells do
				shell.part:Destroy()
			end
			funnels[id] = nil
		else
			funnel.drawn = false
		end
	end
end

-- "funnel mesh: 1 drawn" and the like (debug panel).
function TornadoMesh.status(): string
	if problem then
		return `funnel mesh: {problem}`
	end
	if not findTemplate() then
		return "funnel mesh: not loaded (TornadoAssetService)"
	end
	local count = 0
	for _ in funnels do
		count += 1
	end
	local boil = (template :: MeshPart):FindFirstChild("Boil")
	local frames = if boil then `{(boil:GetAttribute("Frames") :: number?) or 0} boil frames` else "no boil frames"
	return `funnel mesh: ready ({frames}), {count} drawn`
end

return TornadoMesh
