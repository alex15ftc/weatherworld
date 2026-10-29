--!nonstrict
--!native
-- The storm lab's authoritative atmosphere (guide sections 10, 17): one shared simulation that
-- every product reads. The server owns it; clients get compact snapshots and evaluate the same
-- wind field from them (ClientWorld).
--
--   layer                    module        steps every
--   environment              Environment   surface 60 s, analysis a few cells per storm step
--   convective initiation    Initiation    60 s
--   storm dynamics           Storm         2 s (substeps)
--   precipitation            Precip        5 s, binned every 10 s
--   cold pool / gust fronts  ColdPool      20 s
--   systems (lines, bows)    Systems       30 s
--   tornadoes                Tornado       every call (substeps <= 0.5 s)
--   lightning                Lightning     1 s
--   boundaries               Boundaries    120 s
-- All times are simulation seconds; the caller scales real time.
local function dep(name: string): any
	if script then
		return require((script :: any).Parent:FindFirstChild(name))
	end
	return (require :: any)("./" .. name)
end
local Environment = dep("Environment")
local ColdPool = dep("ColdPool")
local Precip = dep("Precip")
local Storm = dep("Storm")
local Systems = dep("Systems")
local Tornado = dep("Tornado")
local Vortex = dep("Vortex")
local Initiation = dep("Initiation")
local Lightning = dep("Lightning")
local Boundaries = dep("Boundaries")
local Grid = dep("Grid")

local World = {}
World.__index = World

local sqrt, exp = math.sqrt, math.exp

export type World = typeof(setmetatable({} :: { [string]: any }, World))

function World.new(data: any, opts: { [string]: any }?): World
	local o = opts or {}
	local self = setmetatable({}, World) :: any
	self.data = data
	self.meta = data.meta
	self.seed = data.meta.seed or 1
	self.time = 0
	self.env = Environment.new(data)
	-- (analysed in chunks with a yield between them when the host passes one - the Roblox server:
	-- all cells at once can exceed the script timeout on a throttled machine)
	local yieldNow = o.yield
	if yieldNow then
		local total = self.env.ag.nx * self.env.ag.ny
		local done = 0
		while done < total do
			local n = math.min(64, total - done)
			self.env:analyse(n)
			done += n
			yieldNow()
		end
	else
		self.env:analyse()
	end
	self.coldPool = ColdPool.new(self.env)
	self.coldPool:seedFromEngine(data.cells, self.env.cellM)
	self.env.coldPool = self.coldPool
	self.precip = Precip.new(self.env, self.coldPool, o.maxParcels)
	self.systems = Systems.new()
	self.tornadoes = {}
	self.flashes = {}
	self.events = {}
	self.maxCells = o.maxCells or 30
	self.genesis = if o.genesis == nil then true else o.genesis
	self.initiation = if o.initiation == nil then true else o.initiation
	-- surface diagnostics on the environment's 4 km grid
	local g = self.env.surfT
	self.conv = Grid.new(g.nx, g.ny, g.dx, g.x0, g.y0, 0)
	self.wetness = Grid.new(g.nx, g.ny, g.dx, g.x0, g.y0, 0) -- mm of recent rain (dust)
	-- storms from the engine
	self.storms = {}
	for _, e in data.storms do
		-- (o.followEngine: the engine drives these storms - Sim/EngineFollow)
		local s = Storm.fromEngine(e, o.followEngine)
		Storm.environment(s, self)
		table.insert(self.storms, s)
	end
	-- the engine's boundaries to start with (detection takes over)
	self.boundaries = {}
	for _, b in data.boundaries or {} do
		local pts = {}
		for _, p in b.points do
			table.insert(pts, { p[1], p[2] })
		end
		table.insert(self.boundaries, { id = b.id, type = b.type, points = pts, contrast = b.contrast, age = 0, motion = 0, fromEngine = true })
	end
	World.rebuildBuckets(self)
	self.timers = { storm = 0, precip = 0, bin = 0, cold = 0, env = 0, surf = 0, systems = 0, init = 0, bounds = 0, light = 0 }
	self:updateSurface()
	return self :: World
end

-- The full air motion at (x, y, z) (m/s). opts: tornado (default true), storms (true)
function World.windAt(self: World, x: number, y: number, z: number, noTornado: boolean?): (number, number, number)
	local u, v = self.env:windAt(x, y, z)
	local w = 0
	local cu, cv, cw = self.coldPool:windAt(x, y, z)
	u += cu
	v += cv
	w += cw
	-- only the storms whose reach covers this bucket (rebuilt every storm step)
	local bucket = self.bucket
	local list = self.storms
	if bucket then
		local bi = math.floor((x + bucket.off) / bucket.size)
		local bj = math.floor((y + bucket.off) / bucket.size)
		list = bucket.cells[bi * 4096 + bj] or bucket.empty
	end
	for _, s in list do
		local su, sv, sw = Storm.windAt(s, x, y, z)
		u += su
		v += sv
		w += sw
	end
	for _, mv in self.systems.vortices do
		local vu, vv = Systems.vortexWind(mv, x, y, z)
		u += vu
		v += vv
	end
	if not noTornado then
		for _, t in self.tornadoes do
			if not t.ended and t.params then
				local dx, dy = x - t.x, y - t.y
				if dx * dx + dy * dy < (60 * t.rc + 1500) ^ 2 then
					local tu, tv, tw = Vortex.sample(t.params, x, y, z)
					u += tu
					v += tv
					w += tw
				end
			end
		end
	end
	return u, v, w
end

function World.convergenceAt(self: World, x: number, y: number): number
	return self.conv:sample(x, y)
end

-- Cloud base over a point: the lowest base of a storm whose cloud covers it, else the LCL.
-- (From a 4 km grid rebuilt every precipitation step.)
function World.cloudBaseAt(self: World, x: number, y: number): number
	local g = self.baseGrid
	if g then
		local i, j = g:cellOf(x, y)
		return g:get(i, j)
	end
	return self.env.fields.lcl:sample(x, y)
end

function World.rebuildCloudBase(self: World)
	local lcl = self.env.fields.lcl
	local g = self.baseGrid
	if not g then
		g = Grid.new(lcl.nx * 2, lcl.ny * 2, lcl.dx / 2, lcl.x0, lcl.y0, 0)
		self.baseGrid = g
	end
	for j = 1, g.ny do
		for i = 1, g.nx do
			local x, y = g:centre(i, j)
			g.v[i + (j - 1) * g.nx] = lcl:sample(x, y)
		end
	end
	for _, s in self.storms do
		if not s.dead then
			local r = 2.5 * s.Ru + (s.anvilLen or 0) * 0.3
			local i0, j0 = g:cellOf(s.x - r, s.y - r)
			local i1, j1 = g:cellOf(s.x + r, s.y + r)
			for j = math.max(1, j0), math.min(g.ny, j1) do
				for i = math.max(1, i0), math.min(g.nx, i1) do
					local x, y = g:centre(i, j)
					if (x - s.x) ^ 2 + (y - s.y) ^ 2 < r * r then
						local k = i + (j - 1) * g.nx
						if s.base < g.v[k] then
							g.v[k] = s.base
						end
					end
				end
			end
		end
	end
end

local function surfaceFlow(self: any, x: number, y: number): (number, number)
	-- (gust fronts lift through their own term in Initiation, not twice)
	return self.env:windAt(x, y, 10)
end

-- surface convergence (environment and cold pools), shade under anvils, wet ground
function World.updateSurface(self: World)
	local g = self.conv
	local h = g.dx
	for j = 1, g.ny do
		if j % 3 == 0 then
			self:pause()
		end
		for i = 1, g.nx do
			local x, y = g:centre(i, j)
			-- the environment's boundary-layer flow: not the storms' own inflow (that feeds the storm
			-- itself) nor cold-pool outflow (gust fronts have their own lift term in Initiation)
			local u1 = surfaceFlow(self, x + h, y)
			local u0 = surfaceFlow(self, x - h, y)
			local _, v1 = surfaceFlow(self, x, y + h)
			local _, v0 = surfaceFlow(self, x, y - h)
			g:set(i, j, -((u1 - u0) + (v1 - v0)) / (2 * h))
		end
	end
	-- anvil shade (0..1): under each storm's anvil, deepest near the updraft
	local shade = self.env.shade
	for j = 1, shade.ny do
		for i = 1, shade.nx do
			local x, y = shade:centre(i, j)
			local sh = 0
			for _, s in self.storms do
				local len = s.anvilLen or 0
				if len > 1000 or not s.dead then
					local dx, dy = x - s.x, y - s.y
					local along = dx * s.anvilU + dy * s.anvilV
					local across = -dx * s.anvilV + dy * s.anvilU
					local width = 2 * s.Ru + 0.35 * math.max(0, along)
					if along > -2 * s.Ru and along < len + s.Ru and math.abs(across) < width then
						local f = 0.9 * (1 - math.max(0, along) / (len + s.Ru) * 0.4)
						sh = math.max(sh, f * (if s.dead then exp(-s.deadFor / 3600) else 1))
					end
				end
			end
			shade:set(i, j, sh)
		end
	end
end

-- How far (s) the clock has run past a storm's or vortex's last step (they step in the slow part,
-- every few seconds or more; tornadoes every frame): its circulation is carried on by its motion
-- for that long, so a tornado following it moves smoothly, not in a step every slow step.
local function sinceStep(self: World, o: any): number
	return math.clamp(self.time - (o.validAt or self.time), 0, 60)
end

function World.parentOf(self: World, t: any): any?
	if t.parentKind == "cell" then
		for _, s in self.storms do
			if s.id == t.parentId then
				local lx, ly = Storm.lowMesoAt(s)
				-- (held still: no motion to carry it on by, and none for the tornado to follow)
				local held = (self :: any).holdStill
				local lead = if held then 0 else sinceStep(self, s)
				lx += s.u * lead
				ly += s.v * lead
				local fW = Storm.wprofAt(s, 1000)
				return {
					id = s.id, kind = "cell", seed = s.seed,
					x = lx, y = ly, u = if held then 0 else s.u, v = if held then 0 else s.v,
					vlow = s.vlow, rlow = 0.3 * s.Ru, wLow = s.W * fW + 0.5 * math.abs(s.vmid),
					rfdDeficit = s.rfdDeficit or 0, cloudBase = s.wallBase or s.base, occl = s.occl,
					dead = s.dead or s.vlow < 3,
				}
			end
		end
	else
		for _, v in self.systems.vortices do
			if v.id == t.parentId then
				local lead = sinceStep(self, v)
				return {
					id = v.id, kind = v.kind, seed = v.seed, x = v.x + (v.u or 0) * lead, y = v.y + (v.v or 0) * lead, u = v.u, v = v.v,
					vlow = v.vlow, rlow = v.rlow * 0.5, wLow = v.wLow or 8, rfdDeficit = v.rfdDeficit or 0,
					cloudBase = v.cloudBase or 700, occl = 0, dead = v.dead,
				}
			end
		end
	end
	return nil
end

local function startTornado(self: World, parentView: any, owner: any)
	local t = Tornado.new(parentView, self)
	t.parentKind = if parentView.kind == "cell" then "cell" else "vortex"
	table.insert(self.tornadoes, t)
	owner.tornado = t.id
	owner.G = 0
	table.insert(self.events, { kind = "tornado", id = t.id, parent = owner.id, time = self.time, x = t.x, y = t.y })
	return t
end

-- Force a tornado under a storm (lab button); otherwise tornadoes only come from genesis.
function World.forceTornado(self: World, storm: any): any?
	if storm.tornado then
		return nil
	end
	local pv
	for _, s in self.storms do
		if s == storm then
			pv = self:parentOf({ parentKind = "cell", parentId = s.id })
		end
	end
	if not pv then
		return nil
	end
	return startTornado(self, pv, storm)
end

local function stepTornadoes(self: World, dt: number)
	for _, t in self.tornadoes do
		local parent = self:parentOf(t)
		local sub = math.max(1, math.ceil(dt / 0.5))
		for _ = 1, sub do
			Tornado.step(t, dt / sub, parent, self)
		end
		if not t.ended then
			t.params = Vortex.params(t :: any)
		else
			t.params = nil
			-- release the parent so it can cycle and produce another
			for _, s in self.storms do
				if s.tornado == t.id then
					s.tornado = nil
				end
			end
			for _, v in self.systems.vortices do
				if v.tornado == t.id then
					v.tornado = nil
				end
			end
		end
	end
	-- forget tornadoes ended a while ago
	local keep = {}
	for _, t in self.tornadoes do
		if not t.ended or t.endedFor < 120 then
			table.insert(keep, t)
		end
	end
	self.tornadoes = keep
end

local function stepStorms(self: World, dt: number)
	local new = {}
	for si, s in self.storms do
		if si % 6 == 0 then
			self:pause()
		end
		Storm.step(s, dt, self)
		s.validAt = self.slowTime -- (the clock its new position is for: World.parentOf)
		s.ffdX, s.ffdY = s.cFfdX, s.cFfdY
		s.rfdX, s.rfdY = s.cRfdX, s.cRfdY
		local child = Storm.maybeSplit(s, self)
		if child then
			Storm.environment(child, self)
			table.insert(new, child)
		end
		-- tornadogenesis
		if self.genesis and not s.dead and not s.tornado and s.G >= 1 and s.rot > 0.25 then
			local pv = self:parentOf({ parentKind = "cell", parentId = s.id })
			if pv then
				startTornado(self, pv, s)
			end
		end
	end
	for _, c in new do
		table.insert(self.storms, c)
	end
	-- mergers: two updrafts closer than 0.6 (Ru1 + Ru2) become one (the stronger keeps its
	-- identity; a flanking tower feeding a supercell strengthens it)
	for a = 1, #self.storms do
		local A = self.storms[a]
		if not A.dead then
			for b = a + 1, #self.storms do
				local B = self.storms[b]
				if not B.dead and A.leftMover == B.leftMover then
					local d2 = (A.x - B.x) ^ 2 + (A.y - B.y) ^ 2
					local lim = 0.6 * (A.Ru + B.Ru)
					if d2 < lim * lim then
						local big, small = A, B
						if B.W * B.Ru > A.W * A.Ru then
							big, small = B, A
						end
						big.W = math.max(big.W, small.W) + 0.15 * math.min(big.W, small.W)
						big.Ru = math.min(8000, sqrt(big.Ru * big.Ru + 0.5 * small.Ru * small.Ru))
						big.anvilLen = math.max(big.anvilLen, small.anvilLen)
						small.dead = true
						small.mergedInto = big.id
						small.W = 0
						table.insert(self.events, { kind = "merge", into = big.id, from = small.id, time = self.time })
					end
				end
			end
		end
	end
	-- QLCS tornadogenesis
	for _, v in self.systems.vortices do
		if self.genesis and v.kind == "mesovortex" and not v.dead and not v.tornado and (v.G or 0) >= 1 then
			local pv = self:parentOf({ parentKind = "vortex", parentId = v.id })
			if pv then
				startTornado(self, pv, v)
			end
		end
	end
	-- forget storms long dead whose anvil and rain are gone
	local keep = {}
	for _, s in self.storms do
		if not s.dead or s.deadFor < 3600 or s.tornado then
			table.insert(keep, s)
		end
	end
	self.storms = keep
	-- a few analysis cells per step keep the environment current
	self.env:analyse(3)
	World.rebuildBuckets(self)
end

-- A coarse spatial index of the storms by the area their wind reaches (Storm.windAt's reach).
function World.rebuildBuckets(self: World)
	local size = 20000
	local off = self.env.extent + 200000
	local cells = {}
	for _, s in self.storms do
		local reach = 4.5 * s.Ru + 5000
		local i0, i1 = math.floor((s.x - reach + off) / size), math.floor((s.x + reach + off) / size)
		local j0, j1 = math.floor((s.y - reach + off) / size), math.floor((s.y + reach + off) / size)
		for i = i0, i1 do
			for j = j0, j1 do
				local key = i * 4096 + j
				local l = cells[key]
				if not l then
					l = {}
					cells[key] = l
				end
				table.insert(l, s)
			end
		end
	end
	self.bucket = { size = size, off = off, cells = cells, empty = {} }
end

local function precipLoading(self: World)
	for _, s in self.storms do
		if not s.dead then
			local m = 0
			for _, z in { 1500, 2500, 3500 } do
				local d = self.precip:sample(s.x, s.y, z)
				if d > 0 then
					m += (10 ^ (d / 10) / 2.4e4) ^ (1 / 1.82)
				end
			end
			s.loading = m / 3
		end
	end
end

-- Everything at once (offline tests, spin-up).
function World.step(self: World, dt: number)
	self:stepSlow(dt, self.time + dt)
	self:stepFast(dt)
end

-- The fast part, every server frame: tornadoes (smooth replication) and the clock.
function World.stepFast(self: World, dt: number)
	self.time += dt
	stepTornadoes(self, dt)
end

-- Let a long step hand control back (the server runs stepSlow in a coroutine with a time
-- budget per frame: World.yieldFn).
function World.pause(self: World)
	local y = self.yieldFn
	if y then
		y()
	end
end

-- The slow part: storms, precipitation, cold pool, systems, initiation, environment. dt: time
-- since the last call. May yield (World.pause) between and inside the heavy pieces.
function World.stepSlow(self: World, dt: number, validAt: number?)
	-- the clock this step brings the storms up to (the host steps the fast part first and runs
	-- this after, often over several frames: the clock at its start)
	self.slowTime = validAt or self.time
	local T = self.timers
	for k, v in T do
		T[k] = v + dt
	end
	if T.storm >= 2 then
		local d = T.storm
		T.storm = 0
		local sub = math.max(1, math.ceil(d / 4))
		for _ = 1, sub do
			stepStorms(self, d / sub)
		end
		self:pause()
	end
	if T.precip >= 5 then
		local d = T.precip
		T.precip = 0
		for _, s in self.storms do
			Storm.emitPrecip(s, d, self)
		end
		self:rebuildCloudBase()
		local sub = math.max(1, math.ceil(d / 8))
		local function air(x: number, y: number, z: number): (number, number, number)
			return self:windAt(x, y, z, true)
		end
		local function base(x: number, y: number): number
			return self:cloudBaseAt(x, y)
		end
		local yieldFn = function()
			self:pause()
		end
		for _ = 1, sub do
			self.precip:step(d / sub, air, base, yieldFn)
		end
		self:pause()
	end
	if T.bin >= 10 then
		T.bin = 0
		self.precip:bin(function()
			self:pause()
		end)
		-- the radar's finer field round the strong storms (at most four)
		local centres = {}
		for _, st in self.storms do
			if not st.dead and (st.W > 15 or (st.rot or 0) > 0.3) and #centres < 4 then
				table.insert(centres, { st.x, st.y })
			end
		end
		self.precip:binFine(centres, function()
			self:pause()
		end)
		precipLoading(self)
		self:pause()
		-- wet ground from recent rain (mm, drying over ~2 h)
		local wg = self.wetness
		for j = 1, wg.ny do
			for i = 1, wg.nx do
				local x, y = wg:centre(i, j)
				local k = wg:index(i, j)
				wg.v[k] = wg.v[k] * exp(-10 / 7200) + self.precip.rainRate:sample(x, y) * 10 / 3600
			end
		end
	end
	if T.cold >= 20 then
		local d = T.cold
		T.cold = 0
		local env = self.env
		local function low(x: number, y: number): (number, number)
			local u0, v0 = env:windAt(x, y, 10)
			local u1, v1 = env:windAt(x, y, 1000)
			return 0.5 * (u0 + u1), 0.5 * (v0 + v1)
		end
		local day = env:heatingRate(0) > 0
		self.coldPool:downdrafts(self.precip.rainRate, env.fields.ddDeficit, d, function()
			self:pause()
		end)
		self:pause()
		self.coldPool:step(d, low, if day then 5400 else 10800, function()
			self:pause()
		end)
		self:pause()
	end
	if T.env >= 60 then
		local d = T.env
		T.env = 0
		self.env:step(d)
	end
	if T.surf >= 30 then
		T.surf = 0
		self:updateSurface()
		self:pause()
	end
	if T.systems >= 30 then
		local d = T.systems
		T.systems = 0
		Systems.analyse(self.systems, self, d)
		for _, v in self.systems.vortices do
			v.validAt = self.slowTime -- (World.parentOf)
		end
		self:pause()
	end
	if T.init >= 60 then
		local d = T.init
		T.init = 0
		if self.initiation then
			for _, c in Initiation.run(self, d) do
				Storm.environment(c, self)
				table.insert(self.events, { kind = "initiation", id = c.id, time = self.time, x = c.x, y = c.y })
			end
		end
	end
	if T.bounds >= 120 then
		local d = T.bounds
		T.bounds = 0
		self.boundaries = Boundaries.analyse(self, self.boundaries, d)
		self:pause()
	end
	if T.light >= 1 then
		local d = T.light
		T.light = 0
		for _, f in Lightning.step(self, d) do
			table.insert(self.flashes, f)
		end
	end
end

-- Build a deterministic visual test scene (shared/VisualTests): a pinned lab storm at `site`,
-- a few minutes of its rain and outflow, then its tornado run for scene.run seconds and held.
-- Any earlier lab scene is retired first. Returns the tornado.
function World.labScene(self: World, scene: any, site: { x: number, y: number }): any?
	for _, s in self.storms do
		if s.lab then
			s.pin = nil
			s.dead = true
			s.deadFor = 1e9
			s.tornado = nil
		end
	end
	for _, t in self.tornadoes do
		if t.lab then
			t.ended = true
			t.endedFor = 1e9
		end
	end
	local p = table.clone(scene.storm)
	local s = Storm.new({ x = site.x, y = site.y, u = p.u, v = p.v, W = p.W, Ru = p.Ru, vmid = p.vmid, vlow = p.vlow, seed = p.seed, age = 3600 })
	s.id = "LAB" .. tostring(p.seed)
	s.lab = true
	s.pin = p
	Storm.environment(s, self)
	Storm.applyPin(s, 0)
	Storm.prepare(s)
	table.insert(self.storms, s)
	-- its rain shafts, cold pool and anvil, as a few minutes of the world
	local g, i = self.genesis, self.initiation
	self.genesis, self.initiation = false, false
	for i = 1, 120 do
		self:step(5)
		local y = (self :: any).yield
		if y and i % 4 == 0 then
			y()
		end
	end
	self.genesis, self.initiation = g, i
	p.t = 0
	local t = self:forceTornado(s)
	if not t then
		return nil
	end
	t.lab = true
	-- run its life up to the stage the scene wants, then hold it there
	-- fixed identity: the same scene always draws the same tornado
	t.seed = (p.seed or 1) * 7 + 11
	t.quality = 1
	local dt = 0.5
	for _ = 1, math.floor((scene.run or 60) / dt) do
		s.x += s.u * dt
		s.y += s.v * dt
		Storm.applyPin(s, dt)
		Storm.prepare(s)
		Tornado.step(t, dt, self:parentOf(t), self)
	end
	t.params = Vortex.params(t :: any)
	t.hold = scene.hold == true
	return t
end

-- Run forward without tornado genesis (fills the precipitation and cold pools of the engine's
-- storms before anyone watches).
function World.spinUp(self: World, seconds: number, chunk: number?)
	local g = self.genesis
	self.genesis = false
	local c = chunk or 5
	local t = 0
	local n = 0
	while t < seconds do
		self:step(c)
		t += c
		n += 1
		-- (a host that must not block for long - the Roblox server - sets world.yield)
		local y = (self :: any).yield
		if y and n % 4 == 0 then
			y()
		end
	end
	self.genesis = g
	self.time = 0
end

-- Ground at a point: what a tornado can raise (0..1 loose soil / dust), how wet it is.
function World.groundAt(self: World, x: number, y: number): (number, number)
	local wet = math.clamp(self.wetness:sample(x, y) / 8, 0, 1)
	local soil = self.groundFn and self.groundFn(x, y) or 0.7
	return soil * (1 - 0.7 * wet), wet
end

-- What clients receive ~2 Hz (tornadoes separately, faster)
function World.snapshot(self: World): { [string]: any }
	local storms = {}
	for _, s in self.storms do
		table.insert(storms, Storm.snapshot(s))
	end
	local bnd = {}
	for _, b in self.boundaries do
		table.insert(bnd, { id = b.id, type = b.type, points = b.points })
	end
	return {
		time = self.time,
		clockUtc = self.env.clockUtc,
		storms = storms,
		systems = Systems.snapshot(self.systems),
		boundaries = bnd,
		parcels = self.precip.n,
	}
end

-- Storms' vertical profiles (Storm.windAt needs them) for those whose profile changed since
-- `seen` (id -> version) was last updated; updates `seen`.
function World.profileSnapshot(self: World, seen: { [string]: number }): { any }
	local out = {}
	for _, s in self.storms do
		local v = s.profVersion or 0
		if seen[s.id] ~= v then
			seen[s.id] = v
			table.insert(out, { id = s.id, version = v, wprof = s.wprof, tiltX = s.tiltX, tiltY = s.tiltY })
		end
	end
	return out
end

function World.tornadoSnapshot(self: World): { any }
	local out = {}
	for _, t in self.tornadoes do
		table.insert(out, Tornado.snapshot(t))
	end
	return out
end

-- The cold pool packed for clients: deficit (0.1 K), outflow u, v (0.25 m/s), edge (0..255)
function World.packColdPool(self: World): buffer
	local cp = self.coldPool
	local n = #cp.D.v
	local b = buffer.create(n * 5)
	for k = 1, n do
		local o = (k - 1) * 5
		buffer.writeu16(b, o, math.clamp(math.floor(cp.D.v[k] * 100 + 0.5), 0, 65535))
		buffer.writei8(b, o + 2, math.clamp(math.floor(cp.VU.v[k] * 4 + 0.5), -127, 127))
		buffer.writei8(b, o + 3, math.clamp(math.floor(cp.VV.v[k] * 4 + 0.5), -127, 127))
		buffer.writeu8(b, o + 4, math.clamp(math.floor(cp.EDGE.v[k] * 255 + 0.5), 0, 255))
	end
	return b
end

function World.unpackColdPool(cp: any, b: buffer)
	local n = #cp.D.v
	if buffer.len(b) < n * 5 then
		return
	end
	for k = 1, n do
		local o = (k - 1) * 5
		cp.D.v[k] = buffer.readu16(b, o) / 100
		cp.VU.v[k] = buffer.readi8(b, o + 2) / 4
		cp.VV.v[k] = buffer.readi8(b, o + 3) / 4
		cp.EDGE.v[k] = buffer.readu8(b, o + 4) / 255
	end
end

return World
