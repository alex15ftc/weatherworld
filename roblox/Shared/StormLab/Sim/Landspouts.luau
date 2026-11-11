--!nonstrict
-- Non-supercell tornadoes (landspouts), 2026-11-03 (docs/stormlab/research/TORNADO-MORPH-RESEARCH.md
-- P9; Wakimoto & Wilson 1989, Lee & Wilhelmson 1997). No mesocyclone: the spin is already at the
-- ground, along a boundary, and a growing updraft stretches it.
--   * Misocyclones: a boundary (Sim/Boundaries: outflow, dryline, front) with the wind turning or
--     changing across it holds vertical vorticity, ~dV / width. Shear instability rolls the
--     sheet up into misocyclones a few km apart, ~0.5-1.5 km across, spinning at ~dV / 2. They ride
--     the boundary, and spin down when the shear across it weakens.
--   * Stretching: a cell's updraft over one (its w at 1 km) converges it - its circulation kept, it
--     contracts and spins up (v ~ circulation / radius). Young cells do this best: nothing has
--     rained out under them yet.
--   * Genesis: a G integrator like the squall-line mesovortex's (Systems), on the stretched
--     vorticity x the stretching. Once the cell's own outflow undercuts it (its rain-cooled air
--     at the misocyclone), it is cut off - the landspout's short life.
-- The tornado itself is the same vortex as any other (Sim/Tornado); its look - a dust column,
-- then a thin smooth tube from a high flat base - follows from its small radius, low swirl and the
-- cell's high base. Nothing here draws or shapes it.
local function dep(name: string): any
	if script then
		return require((script :: any).Parent:FindFirstChild(name))
	end
	return (require :: any)("./" .. name)
end
local Noise = dep("Noise")
local Storm = dep("Storm")

local Landspouts = {}

local sqrt, exp = math.sqrt, math.exp

local function ramp(x: number, a: number, b: number): number
	return math.clamp((x - a) / (b - a), 0, 1)
end

local nextId = 0
local SPACING = 6000 -- m, misocyclones along a boundary (Wakimoto & Wilson 1989: 3-8 km)
-- the across-boundary sampling half-width: one surface-grid cell either side (the boundary is a
-- feature of that grid - a sharp wind change somewhere within the cell; sampled closer, both sides
-- read the same interpolated wind, 2026-11-03). Its spin is ~dV / 2 whatever the true width
local function widthOf(world: any): number
	local g = world.env and world.env.surfT
	return math.max(1500, if g then g.dx else 1500)
end
local KINDS = { outflow = true, dryline = true, cold = true, stationary = true, warm = true }

-- The along-boundary wind change across the boundary (m/s, signed: + cyclonic) at point i of b,
-- and the boundary's local direction.
local function shearAt(world: any, b: any, i: number): (number, number, number)
	local pts = b.points
	local p0 = pts[math.max(1, i - 1)]
	local p1 = pts[math.min(#pts, i + 1)]
	local tx, ty = p1[1] - p0[1], p1[2] - p0[2]
	local tl = sqrt(tx * tx + ty * ty)
	if tl < 1 then
		return 0, 1, 0
	end
	tx, ty = tx / tl, ty / tl
	local nx, ny = ty, -tx -- (to the right of the boundary's direction)
	local WIDTH = widthOf(world)
	local x, y = pts[i][1], pts[i][2]
	local ua, va = world.env:windAt(x + nx * WIDTH, y + ny * WIDTH, 10)
	local ub, vb = world.env:windAt(x - nx * WIDTH, y - ny * WIDTH, 10)
	local cp = world.coldPool
	if cp then
		local cu, cv = cp:windAt(x + nx * WIDTH, y + ny * WIDTH, 10)
		ua, va = ua + cu, va + cv
		cu, cv = cp:windAt(x - nx * WIDTH, y - ny * WIDTH, 10)
		ub, vb = ub + cu, vb + cv
	end
	-- vertical vorticity dv/dn: the along-boundary wind on the right minus the left, across 2 WIDTH;
	-- with n to the right of t, cyclonic (counter-clockwise) spin has the left side's along wind larger
	local along = (ub * tx + vb * ty) - (ua * tx + va * ty)
	return along, tx, ty
end

local function nearestOnBoundaries(world: any, x: number, y: number): (any, number, number)
	local best, bd, bi = nil, math.huge, 0
	for _, b in world.boundaries or {} do
		if KINDS[b.type] then
			for i, p in b.points do
				local d = (p[1] - x) ^ 2 + (p[2] - y) ^ 2
				if d < bd then
					best, bd, bi = b, d, i
				end
			end
		end
	end
	return best, sqrt(bd), bi
end

function Landspouts.new(): { [string]: any }
	return { list = {}, rng = Noise.rng(5150), t = 0 }
end

-- The stretching updraft over (x, y): the strongest cell's w at its cloud base there, and the cell.
-- (Its convergence below - w at the base over the base's height - stretches the whole sub-cloud
-- layer; w at 1 km under a 1.7 km base is the sub-cloud air's ~3 m/s and stretched nothing, 2026-11-03)
local function updraftOver(world: any, x: number, y: number): (number, any)
	local best, bs = 0, nil
	for _, s in world.storms do
		if not s.dead and (s.W or 0) > 1 then
			local r = math.max(s.Ru or 1200, 600)
			local d2 = ((x - s.x) ^ 2 + (y - s.y) ^ 2) / (r * r)
			if d2 < 4 then
				-- (the base's w: ~1/3 of the peak in a growing cell. Storm.wprofAt restarts the speed
				-- from zero at the base - its KNOWN ISSUE (Storm.environment) - and gave ~0.2 of it)
				local zb = math.max(500, s.base or 1000)
				local w = s.W * math.max(Storm.wprofAt(s, zb), 0.35) * exp(-d2)
				if w > best then
					best, bs = w, s
				end
			end
		end
	end
	return best, bs
end

function Landspouts.step(L: { [string]: any }, world: any, dt: number)
	local rng = L.rng
	-- spawning along the boundaries, one per SPACING of line where it is sheared enough
	for _, b in world.boundaries or {} do
		if KINDS[b.type] and #b.points >= 2 then
			for i, p in b.points do
				local dv = shearAt(world, b, i)
				local a = math.abs(dv)
				L.maxShear = math.max(L.maxShear or 0, a)
				-- (2-6 m/s: the wind change the 4 km surface grid resolves across a boundary - it smooths a
				-- real shift of ~5-10 m/s over a cell; the Supercell day's boundaries resolve 2-3.4 m/s)
				local tendency = ramp(a, 2, 6)
				if tendency > 0 then
					L.candidates = (L.candidates or 0) + 1
					local near = false
					for _, m in L.list do
						if (m.x - p[1]) ^ 2 + (m.y - p[2]) ^ 2 < SPACING * SPACING then
							near = true
							break
						end
					end
					-- (a sheared boundary rolls up within ~5-15 min - Lee & Wilhelmson 1997)
					if not near and rng:next() < tendency * dt / 300 then
						nextId += 1
						L.spawned = (L.spawned or 0) + 1
						local r0 = rng:range(600, 1400)
						table.insert(L.list, {
							id = string.format("S%02d", nextId), kind = "misocyclone", boundaryId = b.id,
							x = p[1], y = p[2], u = 0, v = 0, r0 = r0, rlow = r0,
							circ = 0.5 * a * r0, vlow = 0.5 * a, cyclonic = dv > 0,
							age = 0, seed = nextId * 173 + 9, G = 0, wLow = 0,
						})
					end
				end
			end
		end
	end
	for _, m in L.list do
		if not m.dead then
			m.age += dt
			-- the boundary it rides: the shear there sets the circulation it is fed
			local b, d, i = nearestOnBoundaries(world, m.x, m.y)
			local fed = 0
			if m.pinCirc then
				-- (a lab scene's: its boundary's circulation given - Landspouts.labMiso - riding
				-- under the scene's cell, as a cell growing on a boundary moves with it)
				fed = m.pinCirc
				b, d = nil, 0
				local s = nil
				for _, c in world.storms do
					if c.id == m.rideId then
						s = c
					end
				end
				if s then
					m.u, m.v = s.u, s.v
				end
			elseif b and d < 5000 then
				local dv, tx, ty = shearAt(world, b, i)
				fed = 0.5 * math.abs(dv) * m.r0
				-- carried with the air at the boundary, held to it (it lives in the shear zone)
				local p = b.points[i]
				local eu, ev = world.env:windAt(m.x, m.y, 300)
				local k = 1 - exp(-dt / 120)
				m.u += (eu + (p[1] - m.x) / 300 - m.u) * k
				m.v += (ev + (p[2] - m.y) / 300 - m.v) * k
				m.tx, m.ty = tx, ty
			end
			m.circ += (fed - m.circ) * (1 - exp(-dt / (if fed > m.circ then 300 else 600)))
			if not world.holdStill then
				m.x += m.u * dt
				m.y += m.v * dt
			end
			-- stretched: the updraft's convergence below 1 km (w / 1 km) pulls it in, its
			-- circulation kept; unstretched it spreads back to the shear zone's width over ~10 min
			local w, s = updraftOver(world, m.x, m.y)
			local conv = w / math.max(500, if s then s.base or 1000 else 1000)
			m.rlow += (-0.5 * conv * m.rlow + (m.r0 - m.rlow) / 600) * dt
			m.rlow = math.clamp(m.rlow, 150, m.r0)
			m.vlow = m.circ / m.rlow
			m.wLow = w
			-- the cell above: its base, and its own outflow - rain-cooled air under it undercuts
			-- the misocyclone (deficit at its centre)
			local cp = world.coldPool
			local def = if cp then cp:deficitAt(m.x, m.y) else 0
			m.rfdDeficit = def
			if s then
				m.stormId = s.id
				m.cloudBase = s.base or 1500
			end
			-- genesis: the stretched vorticity x the stretching, less where outflow has undercut it
			if not m.tornado then
				local zeta = 2 * m.vlow / m.rlow
				local warm = math.clamp(1 - (def - 1) / 2, 0, 1)
				-- (scaled to a misocyclone's ~0.02 /s stretched at ~0.005 /s - Wakimoto & Wilson 1989,
				-- Lee & Wilhelmson 1997 - the threshold drive ~0.9 with the wobble)
				local drive = (zeta * conv) / (0.02 * 0.005) * warm
				m.genesisDrive = drive
				m.G = math.max(0, m.G + (drive + 0.3 * Noise.value1(m.age / 200, m.seed) - 0.9) * dt / 240)
			end
			if (m.age > 900 and m.vlow < 1.5) or (not m.pinCirc and (b == nil or d > 15000) and not m.tornado) then
				m.dead = true
			end
		end
	end
	local keep = {}
	for _, m in L.list do
		if not m.dead or m.tornado then
			table.insert(keep, m)
		end
	end
	L.list = keep
end

-- A lab scene's misocyclone (World.labScene, scene.miso = { dx, dy, r0, dv }): at (x, y), its
-- boundary's wind change dv (m/s) over radius r0 given, riding under storm rideId.
function Landspouts.labMiso(L: { [string]: any }, x: number, y: number, o: any, rideId: string): any
	for _, m in L.list do
		if m.lab then
			m.dead = true
			m.tornado = nil
		end
	end
	nextId += 1
	local r0 = o.r0 or 1000
	local m = {
		id = string.format("S%02d", nextId), kind = "misocyclone", lab = true, rideId = rideId,
		x = x, y = y, u = 0, v = 0, r0 = r0, rlow = r0, pinCirc = 0.5 * (o.dv or 8) * r0,
		circ = 0.5 * (o.dv or 8) * r0, vlow = 0.5 * (o.dv or 8), cyclonic = true,
		age = 0, seed = nextId * 173 + 9, G = 0, wLow = 0,
	}
	table.insert(L.list, m)
	return m
end

-- The tornado's parent (World.parentOf): what Tornado.supply reads.
function Landspouts.parentView(m: any): any
	return {
		id = m.id, kind = "misocyclone", seed = m.seed, x = m.x, y = m.y, u = m.u, v = m.v,
		vlow = m.vlow, rlow = m.rlow, wLow = m.wLow, rfdDeficit = m.rfdDeficit or 0,
		cloudBase = m.cloudBase or 1500, updraftBase = m.cloudBase or 1500, occl = 0,
		dead = m.dead or m.wLow < 1,
	}
end

function Landspouts.byId(L: { [string]: any }, id: string): any?
	for _, m in L.list do
		if m.id == id then
			return m
		end
	end
	return nil
end

return Landspouts
