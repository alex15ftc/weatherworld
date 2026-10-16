--!strict
-- The close-up tornado: a skinned funnel (ReplicatedStorage.Assets.TornadoFunnel, loaded by
-- TornadoAssetService) shaped every frame from the storm the server relays.
--
-- Roblox bones cannot scale, so the mesh has rings of spoke bones (scripts/blender/
-- build_funnel_rig.py): each ring's spokes are pushed out to the funnel's radius at that
-- height, stood on its leaning, snaking axis, and turned round it for the spin. The mesh keeps
-- its imported size (its bones are placed in the part's space), so the part is stood on the
-- ground and the bones reach up the whole funnel from there.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local TornadoMesh = {}

-- What a tornado's funnel looks like this frame.
export type Pose = {
	foot: Vector3, -- where its axis meets the ground
	axis: (f: number) -> Vector3, -- its axis at a share of its height (0 ground, 1 cloud base)
	radius: (f: number) -> number, -- its radius there, studs
	lowest: number, -- the share of the height its funnel reaches down to
	spin: (f: number) -> number, -- how far it has turned there, radians
	colour: Color3,
	transparency: number,
}

type Spoke = { bone: Bone, frame: CFrame, angle: number }
type Funnel = { part: MeshPart, rings: { { Spoke } }, drawn: boolean }

local funnels: { [string]: Funnel } = {}
local template: MeshPart? = nil
local problem: string? = nil

local function findTemplate(): MeshPart?
	if template then
		return template
	end
	local assets = ReplicatedStorage:FindFirstChild("Assets")
	local found = assets and assets:FindFirstChild("TornadoFunnel")
	if found and found:IsA("MeshPart") then
		template = found
	end
	return template
end

-- A copy of the funnel, with its spokes by ring (R<ring>_S<spoke>) and where each sits in the
-- part's space and round its ring before it is moved.
local function newFunnel(): Funnel?
	local source = findTemplate()
	if not source then
		return nil
	end
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
	part.Parent = workspace
	return { part = part, rings = rings, drawn = false }
end

-- Draws tornado `id` as the mesh; false where it cannot (the model has not loaded).
function TornadoMesh.draw(id: string, pose: Pose): boolean
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
	local part = funnel.part
	-- The part stands on the ground with its bottom (the bind pose's ground ring) at the foot.
	part.CFrame = CFrame.new(pose.foot + Vector3.new(0, part.Size.Y / 2, 0))
	part.Color = pose.colour
	part.Transparency = pose.transparency
	local n = #funnel.rings
	for r, spokes in funnel.rings do
		-- The rings spread over what is shown: from the lowest point up to the cloud base.
		local f = pose.lowest + (1 - pose.lowest) * (r - 1) / (n - 1)
		local centre = part.CFrame:PointToObjectSpace(pose.axis(f))
		local radius = pose.radius(f)
		local turn = pose.spin(f)
		for _, spoke in spokes do
			local a = spoke.angle + turn
			local target = centre + Vector3.new(math.cos(a) * radius, 0, math.sin(a) * radius)
			spoke.bone.Transform = CFrame.new(spoke.frame:PointToObjectSpace(target))
		end
	end
	return true
end

-- After a frame's draws: removes the funnels not drawn this frame.
function TornadoMesh.sweep()
	for id, funnel in funnels do
		if not funnel.drawn then
			funnel.part:Destroy()
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
	return `funnel mesh: ready, {count} drawn`
end

return TornadoMesh
