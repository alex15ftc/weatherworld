--!nonstrict
-- Debris from failed structures (guide section 4 and the server/client split of section 8). The
-- server flies each piece through the simulated wind (Sim/Debris, 10 Hz) for the record and for
-- where it lands, and tells clients only that it was released (class, position, velocity, seed):
-- each client flies the same piece through the same replicated wind field to draw it. When a
-- piece comes to rest the server leaves an anchored piece of rubble there (replicated once) and
-- tells clients to drop their copy. Pieces are capped; the oldest are settled where they are.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Workspace = game:GetService("Workspace")

local lab = ReplicatedStorage:WaitForChild("StormLab")
local LabConfig = require(lab:WaitForChild("LabConfig"))
local Debris = require(lab:WaitForChild("Sim"):WaitForChild("Debris"))

local ServerDebris = {}
ServerDebris.__index = ServerDebris

local MAX_FLYING = 220
local MAX_RUBBLE = 1500
local STEP = 0.1

function ServerDebris.new(sendEvent: (any) -> ()): any
	local folder = Instance.new("Folder")
	folder.Name = "StormLabRubble"
	folder.Parent = Workspace
	return setmetatable({ flying = {}, rubble = {}, folder = folder, send = sendEvent, nextId = 0, acc = 0, landed = 0 }, ServerDebris)
end

function ServerDebris.release(self: any, list: { any }, simTime: number)
	if #list == 0 then
		return
	end
	local out = {}
	for _, r in list do
		self.nextId += 1
		local id = self.nextId
		local p = Debris.new(r[1], r[2], r[3], r[4], r[5], r[6], r[7], id * 7919)
		p.id = id
		table.insert(self.flying, p)
		table.insert(out, { id = id, class = r[1], x = r[2], y = r[3], z = r[4], u = r[5], v = r[6], w = r[7], seed = id * 7919 })
	end
	-- too many in the air: settle the oldest where they are
	while #self.flying > MAX_FLYING do
		local p = table.remove(self.flying, 1)
		self:settle(p)
	end
	self.send({ kind = "debris", time = simTime, pieces = out })
end

function ServerDebris.settle(self: any, p: any)
	local c = p.class
	local part = Instance.new("Part")
	part.Anchored = true
	part.CanCollide = false
	part.CanQuery = false
	part.CanTouch = false
	part.Size = Vector3.new(c.size[1], math.max(0.02, c.size[2]), c.size[3])
	part.Color = Color3.fromRGB(c.color[1], c.color[2], c.color[3])
	part.Material = Enum.Material[c.material] or Enum.Material.Wood
	part.CFrame = CFrame.new(LabConfig.toWorld(p.x, p.y, math.max(0.02, p.z))) * CFrame.Angles(0, p.yaw, 0)
	part.Parent = self.folder
	table.insert(self.rubble, part)
	while #self.rubble > MAX_RUBBLE do
		local old = table.remove(self.rubble, 1)
		if old then
			old:Destroy()
		end
	end
	self.landed += 1
	self.send({ kind = "rest", id = p.id, x = p.x, y = p.y, z = p.z, yaw = p.yaw })
end

-- Fly every piece dt sim seconds (in 0.1 s steps) through the world's wind.
function ServerDebris.update(self: any, world: any, dt: number)
	self.acc += dt
	local steps = math.min(20, math.floor(self.acc / STEP))
	if steps <= 0 then
		return
	end
	self.acc -= steps * STEP
	local function wind(x: number, y: number, z: number): (number, number, number)
		return world:windAt(x, y, z)
	end
	local keep = {}
	for _, p in self.flying do
		for _ = 1, steps do
			Debris.step(p, STEP, wind)
			if p.resting and p.restFor > 1.5 then
				break
			end
		end
		if p.resting and p.restFor > 1.5 or p.age > 240 then
			self:settle(p)
		else
			table.insert(keep, p)
		end
	end
	self.flying = keep
end

function ServerDebris.clear(self: any)
	self.folder:ClearAllChildren()
	self.flying = {}
	self.rubble = {}
end

return ServerDebris
