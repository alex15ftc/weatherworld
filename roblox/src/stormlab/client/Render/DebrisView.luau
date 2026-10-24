--!nonstrict
--!native
-- Flying debris you can see (guide section 4), all driven by the replicated wind field:
--   structural  pieces the server released from failed buildings (Event "debris"): flown here
--               with the same physics (Sim/Debris) through the same wind, dropped when the
--               server says they came to rest (Event "rest": its rubble part replaces them)
--   local fine  leaves, grass, paper, shingles and boards lifted near a tornado wherever the
--               wind at 2 m beats that class's own pickup speed (from its drag area and mass),
--               each flying, tumbling and falling out on its own trajectory - no carousel
-- Near pieces are real parts moved with BulkMoveTo; far ones aren't drawn (they would be
-- sub-pixel).
local Workspace = game:GetService("Workspace")

local DebrisView = {}

local MAX_LOCAL = 160
local MAX_SERVER = 240
local RANGE = 2500

function DebrisView.new(ctx: any): any
	local Debris = ctx.Sim.Debris
	local C = ctx.Config
	local folder = Instance.new("Folder")
	folder.Name = "Debris"
	folder.Parent = ctx.root
	local self = { pieces = {}, byId = {}, pool = {} }

	local function partFor(className: string): BasePart
		local list = self.pool[className]
		local p = list and table.remove(list)
		if p then
			p.Parent = folder
			return p
		end
		local c = Debris.CLASSES[className]
		p = Instance.new("Part")
		p.Anchored, p.CanCollide, p.CanQuery, p.CanTouch = true, false, false, false
		p.CastShadow = c.group ~= "fine"
		p.Size = Vector3.new(c.size[1], math.max(0.02, c.size[2]), c.size[3])
		p.Color = Color3.fromRGB(c.color[1], c.color[2], c.color[3])
		p.Material = Enum.Material[c.material] or Enum.Material.Wood
		p.Parent = folder
		return p
	end

	local function release(p: any, className: string)
		p.part.Parent = nil
		self.pool[className] = self.pool[className] or {}
		table.insert(self.pool[className], p.part)
	end

	local function add(piece: any, isLocal: boolean, id: any?)
		piece.part = partFor(piece.class.name)
		piece.isLocal = isLocal
		piece.id = id
		table.insert(self.pieces, piece)
		if id then
			self.byId[id] = piece
		end
	end

	ctx.signals.event:Connect(function(e)
		if e.kind == "debris" then
			for _, d in e.pieces do
				local count = 0
				for _, p in self.pieces do
					if not p.isLocal then
						count += 1
					end
				end
				if count < MAX_SERVER then
					add(Debris.new(d.class, d.x, d.y, d.z, d.u, d.v, d.w, d.seed), false, d.id)
				end
			end
		elseif e.kind == "rest" then
			local p = self.byId[e.id]
			if p then
				p.done = true
			end
		elseif e.kind == "town" or e.kind == "scenario" then
			for _, p in self.pieces do
				p.done = true
			end
		end
	end)

	-- the fine classes a tornado lifts from open ground and yards
	local LOCAL = { "leaf", "grass", "paper", "shingle", "board", "branch" }
	local slide = {}
	for _, n in LOCAL do
		slide[n] = Debris.slideSpeed(Debris.CLASSES[n])
	end

	local parts, cfs = {}, {}
	function self:update(dt: number)
		local show = ctx.state.show.debris
		local simDt = if ctx.state.paused then 0 else math.min(dt * ctx.state.timeScale, 0.25)
		local cw = ctx.cw
		local camX, camY = ctx:simCamera()
		local function wind(x: number, y: number, z: number): (number, number, number)
			return cw:windAt(x, y, z)
		end
		-- local pickups
		local nLocal = 0
		for _, p in self.pieces do
			if p.isLocal then
				nLocal += 1
			end
		end
		if show and simDt > 0 then
			for _, t in cw.tornadoes do
				if not t.ended and (t.x - camX) ^ 2 + (t.y - camY) ^ 2 < RANGE * RANGE then
					for _ = 1, 4 do
						if nLocal >= MAX_LOCAL then
							break
						end
						local a = math.random() * 2 * math.pi
						local rr = t.rc * (0.4 + 2.5 * math.random())
						local x, y = t.x + rr * math.cos(a), t.y + rr * math.sin(a)
						local u, v, w = cw:windAt(x, y, 2)
						local U = math.sqrt(u * u + v * v)
						local cls = LOCAL[math.random(1, #LOCAL)]
						-- loose objects lift once the wind beats ~1.4x the speed that slides them
						if U > 1.4 * slide[cls] and math.random() < simDt * 3 then
							add(Debris.new(cls, x, y, 0.3, u * 0.2, v * 0.2, 1, math.random(1, 1e6)), true)
							nLocal += 1
						end
					end
				end
			end
		end
		-- fly everything
		table.clear(parts)
		table.clear(cfs)
		local keep = {}
		for _, p in self.pieces do
			local far = (p.x - camX) ^ 2 + (p.y - camY) ^ 2 > (RANGE * 1.6) ^ 2
			if p.done or (p.isLocal and (p.age > 90 or (p.resting and p.restFor > 6) or far)) or not show then
				release(p, p.class.name)
				if p.id then
					self.byId[p.id] = nil
				end
			else
				-- a resting piece only checks the wind every 4th frame (with the time it waited) and
				-- isn't moved: most of the debris near a tornado lies still most of the time
				local wasResting = p.resting
				local stepDt = simDt
				if wasResting and simDt > 0 then
					p.waitDt = (p.waitDt or 0) + simDt
					p.skip = ((p.skip or 0) + 1) % 4
					stepDt = if p.skip == 0 then p.waitDt else 0
					if stepDt > 0 then
						p.waitDt = 0
					end
				end
				if stepDt > 0 then
					-- (two substeps when the time scale is high)
					local n = if stepDt > 0.12 then 2 else 1
					for _ = 1, n do
						Debris.step(p, stepDt / n, wind)
					end
				end
				if not (wasResting and p.resting and p.placed) then
					p.placed = p.resting
					table.insert(parts, p.part)
					table.insert(cfs, CFrame.new(C.toWorld(p.x, p.y, p.z)) * CFrame.fromEulerAnglesYXZ(p.pitch, p.yaw, p.roll))
				end
				table.insert(keep, p)
			end
		end
		self.pieces = keep
		if #parts > 0 then
			Workspace:BulkMoveTo(parts, cfs, Enum.BulkMoveMode.FireCFrameChanged)
		end
		ctx.root:SetAttribute("DebrisPieces", #keep)
	end

	function self:destroy()
		folder:Destroy()
	end

	return self
end

return DebrisView
