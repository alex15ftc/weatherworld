--!nonstrict
-- Convective initiation (guide sections 12C and 13): new updrafts start where lifting can push
-- boundary-layer air through its inhibition to its LFC - never at fixed spacings or intervals.
-- Lift comes from the surface wind field's convergence (drylines, fronts, outflow boundaries in
-- the engine's own winds), from gust fronts (the cold pool's head) and from storm inflow; it is
-- set against the local CIN, CAPE and low-level moisture from the environment's analysis
-- (which already includes cold air spread under the cell). A probability per area and time keeps
-- it stochastic but deterministic (seeded).
local function dep(name: string): any
	if script then
		return require((script :: any).Parent:FindFirstChild(name))
	end
	return (require :: any)("./" .. name)
end
local Noise = dep("Noise")
local Storm = dep("Storm")

local Initiation = {}

local function ramp(x: number, a: number, b: number): number
	return math.clamp((x - a) / (b - a), 0, 1)
end

-- Evaluate the surface grid and start new cells. Returns the cells started.
function Initiation.run(world: any, dt: number): { any }
	local env, cp = world.env, world.coldPool
	local rng = world.initRng
	if not rng then
		rng = Noise.rng(world.seed + 99)
		world.initRng = rng
	end
	local started = {}
	local live = 0
	for _, s in world.storms do
		if not s.dead then
			live += 1
		end
	end
	if live >= (world.maxCells or 30) then
		return started
	end
	local g = env.surfT
	local area = g.dx * g.dx
	-- base rate: one start per 2500 km2 per 10 min where everything favours it
	-- base rate: one start per 10,000 km2 per 15 min where everything favours it
	local base = 1 / (10000e6 * 900)
	local candidates = {}
	world.initField = world.initField or table.create(g.nx * g.ny, 0)
	for j = 2, g.ny - 1 do
		if j % 6 == 0 then
			world:pause()
		end
		for i = 2, g.nx - 1 do
			local x, y = g:centre(i, j)
			local k = g:index(i, j)
			local conv = world:convergenceAt(x, y) -- 1/s, positive converging
			local edge = cp.EDGE:sample(x, y)
			local c = math.sqrt(cp.VU:sample(x, y) ^ 2 + cp.VV:sample(x, y) ^ 2)
			-- vertical motion at the boundary-layer top and how long it lasts
			local wConv = math.max(0, conv) * 1500
			local wGust = 0.7 * edge * c
			local lift = 0.5 * wGust * wGust + wConv * 1500 * 0.05
			local cape = env:field("sbcape", x, y)
			local cin = -env:field("sbcin", x, y)
			local lfc = env:field("lfc", x, y)
			-- displacement needed: from the top of the boundary layer to the LFC
			local reach = (wConv * 1200 + wGust * 400) - math.max(0, lfc - 1500)
			local f = ramp(cape, 150, 1200) * ramp((lift + 5) / (cin + 5), 0.6, 1.6) * ramp(reach, -800, 600)
			-- no new towers inside the cold pool (stable, rain-cooled air) or under an existing updraft
			local d = cp:deficitAt(x, y)
			f *= 1 - ramp(d, 1.5, 4)
			-- under an anvil the boundary layer is shaded and capped by the storms already there
			f *= 1 - 0.85 * env.shade:sample(x, y)
			world.initField[k] = f
			if f > 0.02 then
				-- stronger, more persistent lifting starts towers far more often: a gust front
				-- lifting at 5 m/s keeps throwing up new cells; gentle convergence rarely does
				local boost = 1 + 30 * (wGust / 5) ^ 2 + 3 * (wConv / 0.3) ^ 2
				table.insert(candidates, { x, y, f * boost })
			end
		end
	end
	for _, cnd in candidates do
		local p = base * area * dt * cnd[3]
		if rng:next() < p then
			local x = cnd[1] + rng:range(-0.5, 0.5) * g.dx
			local y = cnd[2] + rng:range(-0.5, 0.5) * g.dx
			-- too close to a live updraft: it feeds that one instead (flanking towers do form
			-- close in, and merge: allow down to 1.3 Ru of a mature storm)
			local ok = true
			for _, s in world.storms do
				if not s.dead then
					local dmin = if s.W > 15 then 1.6 * s.Ru + 5000 else 9000
					if (s.x - x) ^ 2 + (s.y - y) ^ 2 < dmin * dmin then
						ok = false
						break
					end
				end
			end
			if ok then
				local mu, mv = env:windAt(x, y, 3000)
				local cell = Storm.new({ x = x, y = y, u = mu, v = mv, W = 3, Ru = 1200, seed = math.floor(rng:next() * 1e6) })
				table.insert(world.storms, cell)
				table.insert(started, cell)
				live += 1
				if live >= (world.maxCells or 30) then
					break
				end
			end
		end
	end
	return started
end

return Initiation
