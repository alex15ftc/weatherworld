--!nonstrict
--!native
-- Storm clouds (docs/stormlab/ARCHITECTURE.md, guide sections 11, 12, 14): every storm in
-- ctx.cw.storms and every squall-line system in ctx.cw.systemsSnap, built from copies of the
-- uploaded cloud kit (ReplicatedStorage.Shared.Weather.CloudKit) and laid out from the fields
-- only (CloudParts/StormPlan, CloudParts/ShelfPlan), plus rain shafts from the precipitation
-- field (CloudParts/Shafts).
--
-- How it runs:
--   plan     each storm / system is re-planned at most every PLAN_EVERY s, a few per frame
--            (time-sliced, within PLAN_MS); pieces are relative to the storm's position, so
--            between plans the whole storm glides with s.u, s.v from its snapshot time
--   split    a piece too big for one part at the scale it is drawn (2048 studs) is split into
--            2 x 2 overlapping copies, recursively, near the camera only (a quadtree)
--   far draw beyond LIMITS.farDraw a piece is drawn scaled toward the camera (same direction and
--            angular size); haze by the TRUE distance is blended into its colour
--   pool     parts are pooled per kit piece name and re-used by name across plans; moved with
--            one workspace:BulkMoveTo per frame; Size / Color are set only when they change
-- Debug attributes on ctx.root: CloudParts, CloudShafts, CloudMs (update ms, smoothed),
-- CloudPlanMs.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Workspace = game:GetService("Workspace")

local Parts = script.Parent:WaitForChild("CloudParts")
local Util = require(Parts:WaitForChild("Util"))
local StormPlan = require(Parts:WaitForChild("StormPlan"))
local ShelfPlan = require(Parts:WaitForChild("ShelfPlan"))
local Shafts = require(Parts:WaitForChild("Shafts"))

local M = {}

local PLAN_EVERY = 1.5 -- s between re-plans of one storm
local PLAN_RETRY = 0.5 -- s, when some pieces weren't ready yet
local PLAN_MS = 1.2 -- planning budget per frame (ms)
local MAX_RANGE = 150000 -- m: storms farther than this are not drawn
local SPLIT_CAP = 90 -- extra pieces per storm from splitting (nearest first: the base overhead)
local PARK = CFrame.new(0, -200000, 0)
local NIGHT_GLOW = 0.07 -- a night cloud's self-lit brightness (skyglow), as a share of its daytime colour

local function findCloudKit(): any
	local shared = ReplicatedStorage:FindFirstChild("Shared")
	local weather = shared and shared:FindFirstChild("Weather")
	local mod = weather and weather:FindFirstChild("CloudKit")
	if mod and mod:IsA("ModuleScript") then
		local ok, ck = pcall(require, mod)
		if ok then
			return ck
		end
		warn("[Clouds] CloudKit failed to load: " .. tostring(ck))
	end
	return nil
end

function M.new(ctx: any)
	Util.init(ctx.Sim)
	local self = {}
	local Storm = ctx.Sim.Storm
	local Config = ctx.Config
	local D = Config.LIMITS.farDraw

	local folder = Instance.new("Folder")
	folder.Name = "Clouds"
	folder.Parent = ctx.root

	local CloudKit = nil
	local warmed = false
	local pool: { [string]: { BasePart } } = {}
	local groups: { [string]: any } = {}
	local shafts = Shafts.new(ctx)
	shafts.t0 = ctx:simTime()
	local connections = {}
	local lightAt, statAt = -math.huge, -math.huge
	local avgMs, avgPlanMs = 0, 0
	local hidden = false

	-- pool -----------------------------------------------------------------------------------
	local function take(name: string): BasePart?
		local list = pool[name]
		if list and #list > 0 then
			local p = table.remove(list)
			p.Parent = folder
			return p
		end
		local p = CloudKit.copy(name)
		if p then
			p.Anchored, p.CanCollide, p.CanQuery, p.CanTouch = true, false, false, false
			p.CastShadow = false
			p.CFrame = PARK
			p.Parent = folder
		end
		return p
	end
	local function give(name: string, p: BasePart)
		p.Parent = nil
		local list = pool[name]
		if not list then
			list = {}
			pool[name] = list
		end
		table.insert(list, p)
	end
	local function releaseGroup(g: any)
		for _, sl in g.slots do
			give(sl.name, sl.part)
		end
		g.slots = {}
	end

	-- splitting ---------------------------------------------------------------------------
	-- the distance from the camera to the nearest point of a piece's box (world)
	local function nearDist(cf: CFrame, size: Vector3, cam: Vector3): number
		local l = cf:PointToObjectSpace(cam)
		local hx, hz = size.X * 0.5, size.Z * 0.5
		local dx = math.max(math.abs(l.X) - hx, 0)
		local dz = math.max(math.abs(l.Z) - hz, 0)
		local dy = if l.Y < 0 then -l.Y elseif l.Y > size.Y then l.Y - size.Y else 0
		return math.sqrt(dx * dx + dy * dy + dz * dz)
	end
	local function expand(pieces: { any }, origin: Vector3, cam: Vector3, seed: number): { any }
		local out = {}
		local total = 0
		local function push(pc: any, depth: number)
			local size = pc.size
			local wcf = CFrame.new(origin) * pc.cf
			local dn = math.max(nearDist(wcf, size, cam), 1)
			local k = if dn > D then D / dn else 1
			local splitX = pc.split ~= nil and size.X * k > 1950
			local splitZ = pc.split == "xz" and size.Z * k > 1950
			local nX, nZ = if splitX then 2 else 1, if splitZ then 2 else 1
			if depth >= 6 or not (splitX or splitZ) or total + nX * nZ - 1 > SPLIT_CAP then
				table.insert(out, pc)
				return
			end
			total += nX * nZ - 1
			local i = 0
			for a = 1, nX do
				for b = 1, nZ do
					i += 1
					local ox = if nX == 2 then (a - 1.5) * 0.5 * size.X else 0
					local oz = if nZ == 2 then (b - 1.5) * 0.5 * size.Z else 0
					local h = Util.hash(seed, depth * 16 + i, 77)
					local sub = table.clone(pc)
					local cf = pc.cf * CFrame.new(ox, 0, oz)
					if pc.split == "xz" then
						cf = cf * CFrame.Angles(0, (h - 0.5) * 1.2, 0)
					end
					sub.cf = cf
					sub.size = Vector3.new(size.X / nX * (if nX == 2 then 1.22 else 1), size.Y * (0.92 + 0.12 * h), size.Z / nZ * (if nZ == 2 then 1.22 else 1))
					push(sub, depth + 1)
				end
			end
		end
		-- nearest first: the split budget goes to what is near the camera (the base overhead), not to
		-- the towers and anvil far above that fit a part at their far-draw scale anyway
		local order = table.clone(pieces)
		local near = {}
		for _, pc in order do
			near[pc] = nearDist(CFrame.new(origin) * pc.cf, pc.size, cam)
		end
		table.sort(order, function(a, b)
			return near[a] < near[b]
		end)
		for _, pc in order do
			push(pc, 0)
		end
		return out
	end

	-- committing a plan: fit pieces, re-use parts by name ------------------------------------------
	local function commit(g: any, pieces: { any }, origin: Vector3, cam: Vector3)
		pieces = expand(pieces, origin, cam, g.seed)
		local spare: { [string]: { any } } = {}
		for _, sl in g.slots do
			local l = spare[sl.name]
			if not l then
				l = {}
				spare[sl.name] = l
			end
			table.insert(l, sl)
		end
		local slots = {}
		local incomplete = false
		for _, pc in pieces do
			local lcf, lsize = CloudKit.fit(pc.name, pc.cf, pc.size)
			if not lcf then
				CloudKit.ready(pc.name)
				incomplete = true
				continue
			end
			local sl = nil
			local l = spare[pc.name]
			if l and #l > 0 then
				sl = table.remove(l)
			else
				local part = take(pc.name)
				if not part then
					incomplete = true
					continue
				end
				sl = { part = part, name = pc.name, lastSize = Vector3.zero, lastCol = nil, lastD = -1, sa = part:FindFirstChildOfClass("SurfaceAppearance") }
			end
			sl.cf, sl.size, sl.colour = lcf, lsize, pc.colour
			sl.lastFrame = nil -- (re-placed: move it next draw)
			sl.pc = pc
			sl.spin, sl.phase = pc.spin, pc.phase or 0
			sl.lastD = -1 -- (recolour: the plan's light may have changed)
			table.insert(slots, sl)
		end
		for name, l in spare do
			for _, sl in l do
				give(name, sl.part)
			end
		end
		g.slots = slots
		g.incomplete = incomplete
	end

	-- planning --------------------------------------------------------------------------------
	local function stormDetail(d: number, nInRange: number): number
		local far = math.clamp(1 - (d - 30000) / 120000, 0.3, 1)
		local share = math.clamp(8 / math.max(nInRange, 1), 0.35, 1)
		return far * share
	end

	local function planStorm(g: any, s: any, cam: Vector3, camX: number, camY: number, nInRange: number)
		local d = math.sqrt((s.x - camX) ^ 2 + (s.y - camY) ^ 2)
		-- (billboard cloud style: Render/StormCards draws the whole storm; no kit pieces here)
		local pieces = if (ctx.state.cloudStyle or "cards") == "cards" then {} else StormPlan.plan(s, Storm, CloudKit, stormDetail(d, nInRange))
		local origin = Config.toWorld(s.x, s.y, 0)
		g.seed = s.seed or 1
		commit(g, pieces, origin, cam)
	end

	local function planSystem(g: any, sys: any, cam: Vector3, camX: number, camY: number)
		local pieces, vx, vy = ShelfPlan.plan(sys, ctx.cw.storms, CloudKit, camX, camY, 1)
		if (ctx.state.cloudStyle or "cards") == "cards" then
			pieces = {} -- (billboard style: Render/StormCards draws the shelf clouds as cards)
		end
		g.ox, g.oy, g.vx, g.vy, g.t0 = 0, 0, vx, vy, ctx.cw.time
		g.seed = 4241
		commit(g, pieces, Vector3.zero, cam)
	end

	-- drawing ---------------------------------------------------------------------------------
	local moveParts, moveFrames = {}, {}
	local flashNow = false
	local cappedN, cappedWhat = 0, {}
	local function drawGroup(g: any, origin: Vector3, cam: Vector3, simT: number, haze: Color3): number
		local n = 0
		for _, sl in g.slots do
			local wcf, wsize
			if sl.spin and sl.spin ~= 0 then
				local cf = CFrame.new(origin) * sl.pc.cf * CFrame.Angles(0, sl.spin * simT + sl.phase, 0)
				wcf, wsize = CloudKit.fit(sl.name, cf, sl.pc.size)
				if not wcf then
					continue
				end
			else
				wcf, wsize = sl.cf + origin, sl.size
			end
			local P = wcf.Position
			local rel = P - cam
			local d = rel.Magnitude
			local k = Util.farK(d, D, math.max(wsize.X, wsize.Y, wsize.Z))
			local kept = wsize * k
			local size = Util.capSize(kept)
			if size ~= kept then
				cappedN += 1
				cappedWhat[sl.name] = math.max(cappedWhat[sl.name] or 0, math.floor(math.max(kept.X, kept.Z)))
			end
			local ls = sl.lastSize
			if math.abs(size.X - ls.X) > 0.003 * size.X or math.abs(size.Y - ls.Y) > 0.003 * size.Y or math.abs(size.Z - ls.Z) > 0.003 * size.Z then
				sl.part.Size = size
				sl.lastSize = size
			end
			-- night: self-lit and dark (the engine's light would leave them lit by its ambient), so a
			-- lightning flash can light the pieces near it and nothing else
			local isNight = Util.light.night > 0.5
			if sl.night ~= isNight then
				sl.night = isNight
				sl.part.Material = if isNight then Enum.Material.Neon else Enum.Material.SmoothPlastic
				sl.lastD = -1
			end
			local flashL = 0
			if flashNow then
				local tx, ty, tz = Config.fromWorld(P)
				flashL = ctx.Tornado.FlashField.at(ctx.flashField, tx, ty, tz)
			end
			if flashL > 0.01 or sl.flashLit then
				sl.flashLit = flashL > 0.01
				local base = Util.mix(sl.colour, haze, Util.hazeF(d))
				local nk = if isNight then NIGHT_GLOW else 1
				local f = flashL * (if isNight then 0.75 else 0.35)
				sl.part.Color = Color3.new(math.min(1, base.R * nk + f * 0.92), math.min(1, base.G * nk + f * 0.95), math.min(1, base.B * nk + f))
				sl.lastD = -1
			-- (recoloured only when the true distance has changed by over 1%)
			elseif math.abs(d - sl.lastD) > 0.01 * d then
				sl.lastD = d
				local col = Util.quant(Util.mix(sl.colour, haze, Util.hazeF(d)))
				if isNight then
					col = Util.quant(Color3.new(col.R * NIGHT_GLOW, col.G * NIGHT_GLOW, col.B * NIGHT_GLOW * 1.1))
				end
				if col ~= sl.lastCol then
					sl.part.Color = col
					if sl.sa then
						-- (with a SurfaceAppearance, its Color is the tint; dropped if this engine lacks it)
						local sa: any = sl.sa
						if not pcall(function()
							sa.Color = col
						end) then
							sl.sa = nil
						end
					end
					sl.lastCol = col
				end
			end
			n += 1
			-- moved only when its drawn place changed (a still camera leaves most pieces still)
			local frame = wcf.Rotation + (cam + rel * k)
			local last = sl.lastFrame
			if not last or (last.Position - frame.Position).Magnitude > 0.02 or (sl.spin and sl.spin ~= 0) then
				sl.lastFrame = frame
				table.insert(moveParts, sl.part)
				table.insert(moveFrames, frame)
			end
		end
		return n
	end

	local function hideAll()
		for _, g in groups do
			releaseGroup(g)
		end
		groups = {}
		shafts:hide()
	end

	table.insert(connections, ctx.signals.precip:Connect(function()
		shafts.dirty = true
		shafts.t0 = ctx:simTime()
	end))
	table.insert(connections, ctx.signals.scenario:Connect(function()
		hideAll()
		shafts.dirty = true
	end))

	function self:update(_dt: number)
		local t0 = os.clock()
		local show = ctx.state.show
		if show.clouds == false then
			if not hidden then
				hideAll()
				hidden = true
			end
			return
		end
		hidden = false
		if not CloudKit then
			CloudKit = findCloudKit()
			if not CloudKit then
				return
			end
		end
		if not warmed then
			warmed = true
			for _, names in CloudKit.index do
				for _, name in names do
					CloudKit.ready(name)
				end
			end
		end
		if t0 - lightAt > 1 then
			lightAt = t0
			Util.refreshLight()
		end
		local cw = ctx.cw
		local cam = ctx.camera.CFrame.Position
		local camX, camY = cam.X, -cam.Z
		local simT = ctx:simTime()
		local dtSnap = math.clamp(simT - (cw.time or simT), -5, 60)

		-- which groups exist: storms in range, systems with segments
		local live = {}
		local nInRange = 0
		for _, s in cw.storms do
			local d2 = (s.x - camX) ^ 2 + (s.y - camY) ^ 2
			if d2 < MAX_RANGE * MAX_RANGE then
				nInRange += 1
				live["s:" .. tostring(s.id)] = s
			end
		end
		local systems = (cw.systemsSnap and cw.systemsSnap.systems) or {}
		for _, sys in systems do
			if sys.segments and #sys.segments > 0 then
				live["y:" .. tostring(sys.id)] = sys
			end
		end
		for key, g in groups do
			if not live[key] then
				releaseGroup(g)
				groups[key] = nil
			end
		end
		-- plan: new groups first, then the stalest, within the budget
		local queue = {}
		for key, obj in live do
			local g = groups[key]
			if not g then
				g = { key = key, slots = {}, plannedAt = -math.huge, incomplete = false, seed = 1, isStorm = string.sub(key, 1, 2) == "s:" }
				groups[key] = g
			end
			g.obj = obj
			local wait = if g.incomplete then PLAN_RETRY else PLAN_EVERY
			if t0 - g.plannedAt >= wait then
				table.insert(queue, g)
			end
		end
		table.sort(queue, function(a, b)
			return a.plannedAt < b.plannedAt
		end)
		local tp = os.clock()
		for i, g in queue do
			if i > 1 and (os.clock() - tp) * 1000 > PLAN_MS then
				break
			end
			g.plannedAt = t0
			if g.isStorm then
				planStorm(g, g.obj, cam, camX, camY, nInRange)
			else
				planSystem(g, g.obj, cam, camX, camY)
			end
		end
		local planMs = (os.clock() - tp) * 1000

		-- draw
		table.clear(moveParts)
		table.clear(moveFrames)
		flashNow = ctx.flashField ~= nil and #ctx.flashField.flashes > 0
		local haze = Util.light.haze
		local n = 0
		for _, g in groups do
			local origin
			if g.isStorm then
				local s = g.obj
				-- (the billboard storms' smoothed track when there is one: the pieces move with them)
				local tr = ctx.stormTrack and ctx.stormTrack[tostring(s.id)]
				origin = if tr
					then Config.toWorld(tr.x, tr.y, 0)
					else Config.toWorld(s.x + (s.u or 0) * dtSnap, s.y + (s.v or 0) * dtSnap, 0)
			else
				local dt = math.clamp(simT - (g.t0 or simT), -5, 60)
				origin = Config.toWorld(g.vx * dt, g.vy * dt, 0)
			end
			n += drawGroup(g, origin, cam, simT, haze)
		end
		if #moveParts > 0 then
			Workspace:BulkMoveTo(moveParts, moveFrames, Enum.BulkMoveMode.FireCFrameChanged)
		end
		local nShafts = 0
		if show.rain ~= false then
			nShafts = shafts:draw(cam, simT, D)
		elseif shafts.count > 0 then
			shafts:hide()
		end

		local ms = (os.clock() - t0) * 1000
		avgMs += (ms - avgMs) * 0.1
		avgPlanMs += (planMs - avgPlanMs) * 0.1
		if t0 - statAt > 0.5 then
			statAt = t0
			ctx.root:SetAttribute("CloudParts", n)
			local what = {}
			for name, w in cappedWhat do
				table.insert(what, name .. ":" .. w)
			end
			ctx.root:SetAttribute("CloudCapped", cappedN .. " " .. table.concat(what, " "))
			cappedN, cappedWhat = 0, {}
			ctx.root:SetAttribute("CloudShafts", nShafts)
			ctx.root:SetAttribute("CloudMs", math.floor(avgMs * 100 + 0.5) / 100)
			ctx.root:SetAttribute("CloudPlanMs", math.floor(avgPlanMs * 100 + 0.5) / 100)
		end
	end

	function self:destroy()
		for _, c in connections do
			c.Disconnect()
		end
		for _, g in groups do
			for _, sl in g.slots do
				sl.part:Destroy()
			end
		end
		groups = {}
		for _, list in pool do
			for _, p in list do
				p:Destroy()
			end
		end
		pool = {}
		shafts:destroy()
		folder:Destroy()
	end

	return self
end

return M
