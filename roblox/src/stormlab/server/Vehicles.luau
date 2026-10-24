--!nonstrict
-- Vehicles in the simulated wind (guide sections 4-5): ordinary Roblox physics bodies (the
-- server owns them) pushed by aerodynamic force from the RELATIVE wind, F = 1/2 rho Cd A |vr| vr,
-- per body axis (a car is ~2.5x more draggy side-on), plus lift over the roof. The force acts at
-- the centre of pressure, above the centre of mass, so sliding, tipping and rolling come out of
-- the physics: no thresholds, no scripted states. Workspace.Gravity is 9.81 (1 stud = 1 m);
-- masses are scaled into Roblox's density limit and forces by the same factor.
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local lab = ReplicatedStorage:WaitForChild("StormLab")
local LabConfig = require(lab:WaitForChild("LabConfig"))
local Debris = require(lab:WaitForChild("Sim"):WaitForChild("Debris"))

local Vehicles = {}
Vehicles.__index = Vehicles

local RHO = 1.15
local toWorld, fromWorld = LabConfig.toWorld, LabConfig.fromWorld

local COLOURS = { Color3.fromRGB(150, 28, 28), Color3.fromRGB(36, 58, 108), Color3.fromRGB(210, 210, 204), Color3.fromRGB(40, 40, 44), Color3.fromRGB(96, 110, 70) }

function Vehicles.new(parent: Instance): any
	local self = setmetatable({ list = {}, parent = parent }, Vehicles)
	return self
end

-- A car or pickup at (x, y) facing `heading` (radians from east toward north).
function Vehicles.add(self: any, className: string, x: number, y: number, heading: number, colourIndex: number?)
	local c = Debris.CLASSES[className]
	local body = Instance.new("Part")
	body.Name = className
	body.Size = Vector3.new(c.size[1], c.size[2], c.size[3])
	body.Color = COLOURS[(colourIndex or 1) % #COLOURS + 1]
	body.Material = Enum.Material.SmoothPlastic
	body.TopSurface = Enum.SurfaceType.Smooth
	body.BottomSurface = Enum.SurfaceType.Smooth
	body.CFrame = CFrame.new(toWorld(x, y, c.size[2] / 2 + 0.25)) * CFrame.Angles(0, -heading, 0)
	-- density chosen so the part's Roblox mass is (real mass x MASS_SCALE)
	body.CustomPhysicalProperties = PhysicalProperties.new(1, 0.7, 0.05, 1, 1)
	-- a cabin and wheels for the look (welded, massless)
	local cabin = Instance.new("Part")
	cabin.Size = Vector3.new(c.size[1] * 0.5, c.size[2] * 0.55, c.size[3] * 0.92)
	cabin.CFrame = body.CFrame * CFrame.new(-c.size[1] * 0.05, c.size[2] * 0.75, 0)
	cabin.Color = Color3.fromRGB(70, 90, 110)
	cabin.Material = Enum.Material.Glass
	cabin.Transparency = 0.25
	cabin.Massless = true
	cabin.Parent = body
	local weld = Instance.new("WeldConstraint")
	weld.Part0, weld.Part1 = body, cabin
	weld.Parent = body
	for _, wpos in { { 0.32, 0.5 }, { -0.32, 0.5 }, { 0.32, -0.5 }, { -0.32, -0.5 } } do
		local w = Instance.new("Part")
		w.Shape = Enum.PartType.Cylinder
		w.Size = Vector3.new(0.3, 0.7, 0.7)
		w.CFrame = body.CFrame * CFrame.new(wpos[1] * c.size[1], -c.size[2] / 2, wpos[2] * c.size[3]) * CFrame.Angles(0, math.pi / 2, 0)
		w.Color = Color3.fromRGB(24, 24, 24)
		w.Massless = true
		w.CanCollide = false
		w.Parent = body
		local wl = Instance.new("WeldConstraint")
		wl.Part0, wl.Part1 = body, w
		wl.Parent = body
	end
	-- the aerodynamic force acts at the centre of pressure, a little above the centre of mass
	local att = Instance.new("Attachment")
	att.Position = Vector3.new(0, c.size[2] * 0.2, 0)
	att.Parent = body
	local force = Instance.new("VectorForce")
	force.Attachment0 = att
	force.RelativeTo = Enum.ActuatorRelativeTo.World
	force.ApplyAtCenterOfMass = false
	force.Force = Vector3.zero
	force.Parent = body
	body.Parent = self.parent
	pcall(function()
		body:SetNetworkOwner(nil)
	end)
	local entry = { class = c, body = body, force = force, scale = body:GetMass() / c.mass, maxWind = 0, travelled = 0, start = body.Position, lofted = 0 }
	table.insert(self.list, entry)
	return entry
end

-- Apply the wind's force to every vehicle (each server frame).
function Vehicles.update(self: any, world: any)
	for _, e in self.list do
		local b = e.body
		if b.Parent then
			local x, y, z = fromWorld(b.Position)
			local wu, wv, ww = world:windAt(x, y, math.max(0.8, z))
			local vel = b.AssemblyLinearVelocity
			local vu, vv, vw = fromWorld(vel)
			-- relative wind in Roblox axes, then in the body's own axes
			local rel = toWorld(wu - vu, wv - vv, ww - vw)
			local cf = b.CFrame
			local lx, ly, lz = cf.RightVector:Dot(rel), cf.UpVector:Dot(rel), cf.LookVector:Dot(rel)
			local speed = rel.Magnitude
			local c = e.class
			-- areas: front (along the car's length: X), side (Z), top (Y)
			local aFront = c.size[2] * c.size[3]
			local aSide = c.size[1] * c.size[2]
			local aTop = c.size[1] * c.size[3]
			local q = 0.5 * RHO * speed
			local fx = q * 0.45 * aFront * lx
			local fz = q * 1.05 * aSide * lz
			local fy = q * 1.1 * aTop * ly
			-- lift from flow over the roof (Bernoulli suction): up, ~ horizontal relative speed^2
			local hs = math.sqrt(lx * lx + lz * lz)
			local lift = 0.5 * RHO * c.cl * aTop * hs * hs
			local fWorld = cf.RightVector * fx + cf.UpVector * fy + cf.LookVector * fz + Vector3.yAxis * lift
			e.force.Force = fWorld * e.scale
			local ws = math.sqrt(wu * wu + wv * wv)
			e.maxWind = math.max(e.maxWind, ws)
			e.travelled = (b.Position - e.start).Magnitude
			if z > c.size[2] + 1.5 then
				e.lofted = math.max(e.lofted, z)
			end
		end
	end
end

function Vehicles.clear(self: any)
	for _, e in self.list do
		e.body:Destroy()
	end
	self.list = {}
end

return Vehicles
