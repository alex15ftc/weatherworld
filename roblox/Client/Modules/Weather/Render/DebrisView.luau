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
-- Units: metres. A piece's z is its height above the DATUM (Sim/Debris: the ground under it is
-- C.groundAt, passed to Debris.step as groundZ; the wind is sampled at the height above that
-- ground); the server's pieces arrive the same way. Positions and part sizes cross to studs
-- through Config (docs/stormlab/SCALE-RULES.md). A piece is drawn with its tornado: about the
-- nearest live tornado's ground point at that tornado's scale (LabConfig.scaleAbout /
-- toWorldAbout), or about itself when there is none.
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
	-- (running counts of the pieces in self.pieces: no recount per event or frame)
	local nServer, nLocalAll = 0, 0

	-- (the scale each part's size was set at: a part is resized when its piece's scale moves > 2%)
	local partK: { [BasePart]: number } = {}
	local function sizeAt(p: BasePart, className: string, k: number)
		local k0 = partK[p]
		if k0 and math.abs(k - k0) <= 0.02 * k0 then
			return
		end
		partK[p] = k
		local c = Debris.CLASSES[className]
		p.Size = Vector3.new(c.size[1] * k, math.max(0.02, c.size[2]) * k, c.size[3] * k)
	end
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
		sizeAt(p, className, C.studs(1))
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
		if isLocal then
			nLocalAll += 1
		else
			nServer += 1
		end
		if id then
			self.byId[id] = piece
		end
	end

	ctx.signals.event:Connect(function(e)
		if e.kind == "debris" then
			for _, d in e.pieces do
				if nServer < MAX_SERVER then
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
	local spare = {} -- (the other half of the double-buffered piece list)
	-- (the wind field's heights are above the ground; one closure for the module, reading the
	-- current ClientWorld)
	local cw = ctx.cw
	local function wind(x: number, y: number, z: number): (number, number, number)
		return cw:windAt(x, y, math.max(0, z - C.groundAt(x, y)))
	end
	local statAt, statN = -math.huge, -1
	local torC = {}
	function self:update(dt: number)
		local show = ctx.state.show.debris
		local simDt = math.min(ctx:visualDt(dt), 0.25) -- (flying debris: local motion)
		cw = ctx.cw
		local camX, camY = ctx:simCamera()
		-- local pickups
		local nLocal = nLocalAll
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
							add(Debris.new(cls, x, y, C.groundAt(x, y) + 0.3, u * 0.2, v * 0.2, 1, math.random(1, 1e6)), true)
							nLocal += 1
						end
					end
				end
			end
		end
		-- the live tornadoes' ground points and scales (pieces are drawn about the nearest)
		local nT = 0
		for _, t in cw.tornadoes do
			if not t.ended then
				nT += 1
				local tc = torC[nT]
				if not tc then
					tc = {}
					torC[nT] = tc
				end
				-- about the smoothed centre the funnel is drawn at (Tornado/StateAdapter), not the
				-- raw ~15 Hz snapshot: the drawing scales about this point, so each snapshot step
				-- moved every piece several times that step on screen (2026-10-28)
				local e = ctx.tornadoAdapter and ctx.tornadoAdapter.entries[t.id]
				local x, y = if e then e.x else t.x, if e then e.y else t.y
				tc.x, tc.y, tc.k = x, y, C.scaleAbout(x, y)
			end
		end
		-- fly everything
		table.clear(parts)
		table.clear(cfs)
		local keep = spare
		table.clear(keep)
		for _, p in self.pieces do
			local far = (p.x - camX) ^ 2 + (p.y - camY) ^ 2 > (RANGE * 1.6) ^ 2
			if p.done or (p.isLocal and (p.age > 90 or (p.resting and p.restFor > 6) or far)) or not show then
				release(p, p.class.name)
				if p.isLocal then
					nLocalAll -= 1
				else
					nServer -= 1
				end
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
				-- a flying piece far from the camera steps every other frame with twice the time (a
				-- few pixels on screen; it halves the wind evaluations)
				if not wasResting and stepDt > 0 and (p.x - camX) ^ 2 + (p.y - camY) ^ 2 > 800 * 800 then
					p.waitDt = (p.waitDt or 0) + stepDt
					p.odd = not p.odd
					stepDt = if p.odd then 0 else p.waitDt
					if stepDt > 0 then
						p.waitDt = 0
					end
				end
				if stepDt > 0 then
					-- (two substeps when the time scale is high)
					local n = if stepDt > 0.12 then 2 else 1
					for _ = 1, n do
						Debris.step(p, stepDt / n, wind, C.groundAt(p.x, p.y))
					end
				end
				if not (wasResting and p.resting and p.placed) then
					p.placed = p.resting
					table.insert(parts, p.part)
					-- (about the nearest live tornado, else about itself)
					local ccx, ccy, k = p.x, p.y, nil
					local best = math.huge
					for ti = 1, nT do
						local tc = torC[ti]
						local d2 = (tc.x - p.x) ^ 2 + (tc.y - p.y) ^ 2
						if d2 < best then
							best, ccx, ccy, k = d2, tc.x, tc.y, tc.k
						end
					end
					k = k or C.scaleAbout(ccx, ccy)
					sizeAt(p.part, p.class.name, k)
					table.insert(cfs, CFrame.new(C.toWorldAbout(p.x, p.y, p.z, ccx, ccy, k)) * CFrame.fromEulerAnglesYXZ(p.pitch, p.yaw, p.roll))
				end
				table.insert(keep, p)
			end
		end
		spare = self.pieces
		self.pieces = keep
		if #parts > 0 then
			Workspace:BulkMoveTo(parts, cfs, Enum.BulkMoveMode.FireCFrameChanged)
		end
		-- (debug count: twice a second, and only when it changed)
		local nowS = os.clock()
		if #keep ~= statN and nowS - statAt > 0.5 then
			statAt, statN = nowS, #keep
			ctx.root:SetAttribute("DebrisPieces", #keep)
		end
	end

	function self:destroy()
		folder:Destroy()
	end

	return self
end

return DebrisView
