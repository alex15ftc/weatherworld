--!native
--!optimize 2
-- A fine grid inside the cloud model (two-way nest: after its steps, its fields are averaged back
-- onto the parent cells it covers, so the storm on the coarse grid feels what the fine grid
-- resolves - e.g. a low-level mesocyclone only a few coarse cells wide). The same equations at `ratio` times finer
-- horizontal spacing and time step, on the parent's vertical levels; its side boundaries take the
-- parent's fields, bilinear in space and linear in time between the parent's two step states.
-- The nest sits where the storm's low-level rotation is and moves with the parent's grid (the
-- parent follows the storm), so tornado-scale vortices can form from the equations - their size
-- is whatever the flow gives, not a formula.
local function dep(name: string): any
	if script then
		return require((script :: any).Parent:FindFirstChild(name))
	end
	return (require :: any)("./" .. name)
end
local CloudModel = dep("CloudModel")

local Nest = {}

local PROG = { "u", "v", "w", "p", "th", "qv", "qc", "qr", "qh", "qsn" }
Nest.VORTEX = 0.01 -- 1/s: smoothed ~250 m vorticity that counts as the nest's own vortex

-- parent fractional index of a point x, y (m from the parent box's south-west corner) for a field
-- of this kind: cell centres at (i - 0.5) dx, u faces at (i - 1) dx, v faces at (j - 1) dx
local function parentIndex(kind: number, x: number, y: number, dx: number): (number, number)
	local fi = x / dx + (if kind == 1 then 1 else 0.5)
	local fj = y / dx + (if kind == 2 then 1 else 0.5)
	return fi, fj
end

-- interpolation stencil (4 parent offsets within a level, 4 weights) for nest point (i, j)
local function stencil(nest: any, parent: any, kind: number, i: number, j: number): { number }
	local dxn = nest.dx
	local x = nest.X0 + (i - (if kind == 1 then 1 else 0.5)) * dxn
	local y = nest.Y0 + (j - (if kind == 2 then 1 else 0.5)) * dxn
	local fi, fj = parentIndex(kind, x, y, parent.dx)
	fi = math.clamp(fi, -1, parent.nx + 1.999)
	fj = math.clamp(fj, -1, parent.ny + 1.999)
	local i0, j0 = math.floor(fi), math.floor(fj)
	local a, b = fi - i0, fj - j0
	local SX = parent.SX
	local o = (i0 + 2) + (j0 + 1) * SX
	return { o, o + 1, o + SX, o + SX + 1, (1 - a) * (1 - b), a * (1 - b), (1 - a) * b, a * b }
end

-- the boundary points of each kind: nest in-level offset + parent stencil
local function buildBoundary(nest: any, parent: any)
	local nx, ny, SXn = nest.nx, nest.ny, nest.SX
	local lists = {}
	for kind = 0, 3 do
		local list = {}
		local hk = if kind == 3 then 0 else kind
		for j = -1, ny + 2 do
			for i = -1, nx + 2 do
				local edgeX = i <= 0 or i >= nx + 1 or (hk == 1 and i == 1)
				local edgeY = j <= 0 or j >= ny + 1 or (hk == 2 and j == 1)
				if edgeX or edgeY then
					local st = stencil(nest, parent, hk, i, j)
					table.insert(list, { (i + 2) + (j + 1) * SXn, st })
				end
			end
		end
		lists[kind] = list
	end
	nest.boundary = lists
end

-- nest points i1..i2, j1..j2 (all levels) from the parent: the starting state, and the strip a
-- shift brings in (a copied edge there left stale columns - a fake shear line the nest chased as a
-- vortex, 2026-11-04)
local function sampleRegion(nest: any, parent: any, i1: number, i2: number, j1: number, j2: number)
	local nz, SXn, SXYn, SXYp = nest.nz, nest.SX, nest.SXY, parent.SXY
	for _, name in PROG do
		local kind = CloudModel.KINDS[name]
		local hk = if kind == 3 then 0 else kind
		local fn, fp = nest[name], parent[name]
		for j = j1, j2 do
			for i = i1, i2 do
				local st = stencil(nest, parent, hk, i, j)
				local on = (i + 2) + (j + 1) * SXn
				for k = -1, nz + 3 do
					local po = (k + 1) * SXYp
					fn[on + (k + 1) * SXYn] = st[5] * fp[st[1] + po] + st[6] * fp[st[2] + po] + st[7] * fp[st[3] + po] + st[8] * fp[st[4] + po]
				end
			end
		end
	end
end

local function sampleAll(nest: any, parent: any)
	sampleRegion(nest, parent, -1, nest.nx + 2, -1, nest.ny + 2)
	-- the parent's fields are smooth on the nest's scale: a nest started from them alone stays
	-- axisymmetric-smooth until its own eddies grow. Nothing is added (no noise): they grow from
	-- the flow's own instabilities, seeded by the interpolation's grid-scale steps.
end

-- New nest of nx x ny cells at `ratio`, its south-west corner at parent cell (i0, j0).
-- Its horizontal mixing scales with the spacing (eddy viscosity ~ grid length: K 75 m^2/s at 1 km
-- held a 250 m nest's vortex at 20 m/s and would smear a 60 m one's core in ~2 min); the vertical
-- mixing stays the parent's (same levels).
-- `steps` (default ratio) is how many nest steps fit in one parent step: the time step only has to
-- keep the wind under about one cell a step, so a nest can take fewer, longer steps than its
-- spacing ratio (2 at ratio 4: Courant ~0.4-0.7 at 30-60 m/s).
function Nest.new(parent: any, opts: { nx: number?, ny: number?, ratio: number?, steps: number?, i0: number, j0: number, K: number?, Kh: number?, vortex: number?, feedback: boolean? })
	local r = opts.ratio or 4
	local ns = opts.steps or r
	local nest = CloudModel.new({
		nx = opts.nx or 48, ny = opts.ny or 48, dx = parent.dx / r, zf = parent.zf,
		dt = parent.dt / ns, cs = parent.cs, K = opts.K or parent.K, Kh = opts.Kh or parent.Kh / r,
		umove = parent.umove, vmove = parent.vmove, hail = parent.hail, n0h = parent.n0h, zdamp = parent.zdamp, z0 = parent.z0, follow = false,
	}, parent.snd)
	nest.ratio = r
	nest.steps = ns
	nest.feedback = opts.feedback ~= false
	nest.vortex = opts.vortex or Nest.VORTEX
	nest.i0, nest.j0 = opts.i0, opts.j0
	nest.X0, nest.Y0 = (opts.i0 - 1) * parent.dx, (opts.j0 - 1) * parent.dx
	nest.parent = parent
	parent.child = nest
	nest.time = parent.time
	-- the parent's air as it is now (its environment may have moved on from the sounding)
	nest.psfc = parent.psfc
	for _, f in { "th0", "qv0", "u0", "v0" } do
		nest[f] = table.clone(parent[f])
	end
	CloudModel.hydrostatic(nest)
	buildBoundary(nest, parent)
	sampleAll(nest, parent)
	-- the parent's state at the start of its current step, for the boundary's time interpolation
	nest.pOld = {}
	for _, name in PROG do
		nest.pOld[name] = table.clone(parent[name])
	end
	nest.bcA = 1
	nest.bc = Nest.applyBoundary
	nest:fill()
	return nest
end

-- side boundary of one nest field from the parent, between its old and new states (bcA 0..1)
function Nest.applyBoundary(nest: any, name: string, f: { number }, kind: number)
	local parent = nest.parent
	local new, old = parent[name], nest.pOld[name]
	local a = nest.bcA
	local b = 1 - a
	local nz, SXYn, SXYp = nest.nz, nest.SXY, parent.SXY
	local k1 = if kind == 3 then nz + 1 else nz
	for _, e in nest.boundary[kind] do
		local on, st = e[1], e[2]
		local p1, p2, p3, p4 = st[1], st[2], st[3], st[4]
		local w1, w2, w3, w4 = st[5], st[6], st[7], st[8]
		for k = 1, k1 do
			local po = (k + 1) * SXYp
			local vn = w1 * new[p1 + po] + w2 * new[p2 + po] + w3 * new[p3 + po] + w4 * new[p4 + po]
			local vo = w1 * old[p1 + po] + w2 * old[p2 + po] + w3 * old[p3 + po] + w4 * old[p4 + po]
			f[on + (k + 1) * SXYn] = b * vo + a * vn
		end
	end
end

-- A model's fields moved by `cells` of its own cells toward (di, dj) (each -1, 0 or 1): the strip
-- that enters is re-sampled from its parent (if it is a nest), and its own nest, which keeps its
-- place in it, moves `ratio` times as many of its cells - the whole chain stays matched.
function Nest.shiftBy(m: any, di: number, dj: number, cells: number)
	for _ = 1, cells do
		m:shift(di, dj)
	end
	local parent = m.parent
	if parent then
		local nx, ny, r = m.nx, m.ny, cells
		if di > 0 then
			sampleRegion(m, parent, nx - r, nx + 2, -1, ny + 2)
		elseif di < 0 then
			sampleRegion(m, parent, -1, r + 1, -1, ny + 2)
		end
		if dj > 0 then
			sampleRegion(m, parent, -1, nx + 2, ny - r, ny + 2)
		elseif dj < 0 then
			sampleRegion(m, parent, -1, nx + 2, -1, r + 1)
		end
		m:fill()
	end
	if m.child then
		Nest.shiftBy(m.child, di, dj, cells * m.child.ratio)
	end
end

-- Two-way feedback: each parent cell inside the nest (away from the nest's edges by FEED_MARGIN
-- parent cells, where the nest is still settling to its boundary) takes the average of the nest
-- cells that make it up - scalars and w over the ratio x ratio cells, u (v) over the ratio nest
-- faces on its west (south) face. Pressure is left to the parent's own sound waves.
local FEED = { "u", "v", "w", "th", "qv", "qc", "qr", "qh", "qsn" }
Nest.FEED_MARGIN = 2
function Nest.feed(parent: any, nest: any)
	local r = nest.ratio
	local inv = 1 / r
	local inv2 = inv * inv
	local mg = Nest.FEED_MARGIN
	local npx, npy = nest.nx // r, nest.ny // r
	local SXn, SXYn, SXp, SXYp = nest.SX, nest.SXY, parent.SX, parent.SXY
	local nz = parent.nz
	local jumps = {}
	parent.feedJump = jumps -- (the largest change feedback made to each field: a check)
	for _, name in FEED do
		local kind = CloudModel.KINDS[name]
		local fp, fn = parent[name], nest[name]
		local jmax = 0
		local k0, k1 = 1, nz
		if kind == 3 then
			k0 = 2 -- (w at the ground is zero; the lid's too)
		end
		for k = k0, k1 do
			local kn, kp = (k + 1) * SXYn, (k + 1) * SXYp
			for J = mg + 1, npy - mg do
				local j1 = (J - 1) * r + 1
				local Jp = nest.j0 + J - 1
				for I = mg + 1, npx - mg do
					local i1 = (I - 1) * r + 1
					local Ip = nest.i0 + I - 1
					local sum = 0
					if kind == 1 then
						for j = j1, j1 + r - 1 do
							sum += fn[(i1 + 2) + (j + 1) * SXn + kn]
						end
						sum *= inv
					elseif kind == 2 then
						for i = i1, i1 + r - 1 do
							sum += fn[(i + 2) + (j1 + 1) * SXn + kn]
						end
						sum *= inv
					else
						for j = j1, j1 + r - 1 do
							local o = (j + 1) * SXn + kn + 2
							for i = i1, i1 + r - 1 do
								sum += fn[o + i]
							end
						end
						sum *= inv2
					end
					local at = (Ip + 2) + (Jp + 1) * SXp + kp
					local dj = math.abs(sum - fp[at])
					if dj > jmax then
						jmax = dj
					end
					fp[at] = sum
				end
			end
		end
		jumps[name] = jmax
	end
	parent:fill()
end

-- One step of a model and, inside it, `ratio` steps of its nest (recursively); the nest's side
-- boundary runs between the model's states before and after its step. Once a minute the nest
-- recentres on its vortex.
function Nest.advance(m: any)
	local child = m.child
	if child then
		for _, name in PROG do
			table.move(m[name], 1, m.N, 1, child.pOld[name])
		end
	end
	m:step()
	if child then
		-- the engine's steering reaches the nests too: the changing air, the cold pool rate, the lifts
		child.env, child.cpRate, child.drive, child.drive2 = m.env, m.cpRate, m.drive, m.drive2
	end
	if child then
		for s = 1, child.steps do
			child.bcA = s / child.steps
			Nest.advance(child)
		end
		if child.feedback then
			Nest.feed(m, child)
		end
		if math.floor(child.time / 60) ~= math.floor((child.time - m.dt) / 60) then
			Nest.recentre(m, child)
		end
	end
end

-- One step of the whole chain: the root follows the storm first (a whole-cell shift) and its
-- nests move with it, so they stay on the storm.
function Nest.step(parent: any, nest: any?)
	local ox, oy = parent.ox, parent.oy
	parent:followStorm()
	local di, dj = parent.ox - ox, parent.oy - oy
	if (di ~= 0 or dj ~= 0) and parent.child then
		Nest.shiftBy(parent.child, di, dj, parent.child.ratio)
	end
	Nest.advance(parent)
end

-- 3x3-smoothed vertical vorticity at level k around cell (i, j) of a model
local function zetaSmooth(m: any, i: number, j: number, k: number): number
	local s = 0
	for dj = -1, 1 do
		for di = -1, 1 do
			s += m:zeta(i + di, j + dj, k)
		end
	end
	return s / 9
end

-- Where to put a nest: centred on the storm's low-level circulation - the strongest smoothed
-- vorticity at ~250 m within R cells of the parent's storm. Returns the south-west corner cell.
function Nest.place(parent: any, nxn: number, ratio: number, R: number?): (number, number)
	local k = parent:levelAt(250)
	local ci, cj = parent.stormI or parent.nx // 2, parent.stormJ or parent.ny // 2
	local best, bi, bj = -1, ci, cj
	-- a nest inside a nest has no storm centre of its own: search all of its parent (it went to the
	-- parent's middle instead and lost the vortex, 2026-11-04)
	local rr = R or (if parent.stormI then 8 else math.max(parent.nx, parent.ny))
	for j = math.max(3, cj - rr), math.min(parent.ny - 2, cj + rr) do
		for i = math.max(3, ci - rr), math.min(parent.nx - 2, ci + rr) do
			local z = zetaSmooth(parent, i, j, k)
			if z > best then
				best, bi, bj = z, i, j
			end
		end
	end
	local half = nxn / ratio / 2
	local i0 = math.clamp(bi - math.floor(half) + 1, 3, parent.nx - 2 * half - 2)
	local j0 = math.clamp(bj - math.floor(half) + 1, 3, parent.ny - 2 * half - 2)
	return i0, j0
end

-- Keep the nest on its own low-level vortex: if the strongest smoothed ~250 m vorticity in the
-- nest is more than 2 parent cells from the nest's centre, move the nest one parent cell toward
-- it (its fields shift by `ratio` cells; the side boundary is re-derived for the new position).
function Nest.recentre(parent: any, nest: any)
	local k = nest:levelAt(250)
	local best, bi, bj = 0, 0, 0
	for j = 3, nest.ny - 2 do
		for i = 3, nest.nx - 2 do
			local z = zetaSmooth(nest, i, j, k)
			if z > best then
				best, bi, bj = z, i, j
			end
		end
	end
	local r = nest.ratio
	local di, dj = 0, 0
	if best >= nest.vortex then
		-- a vortex of its own: keep it near the centre
		local off = 2 * r
		local ci, cj = nest.nx / 2, nest.ny / 2
		di = if bi > ci + off then 1 elseif bi < ci - off then -1 else 0
		dj = if bj > cj + off then 1 elseif bj < cj - off then -1 else 0
	else
		-- none yet: back toward the storm's low-level circulation on the parent grid (chasing the
		-- nest's own weak maxima walked it off the storm, 2026-11-04)
		local ti, tj = Nest.place(parent, nest.nx, r)
		di = if ti > nest.i0 then 1 elseif ti < nest.i0 then -1 else 0
		dj = if tj > nest.j0 then 1 elseif tj < nest.j0 then -1 else 0
	end
	local half = nest.nx / r
	if nest.i0 + di < 3 or nest.i0 + di + half > parent.nx - 2 then
		di = 0
	end
	if nest.j0 + dj < 3 or nest.j0 + dj + nest.ny / r > parent.ny - 2 then
		dj = 0
	end
	if di == 0 and dj == 0 then
		return
	end
	nest.i0 += di
	nest.j0 += dj
	nest.X0 += di * parent.dx
	nest.Y0 += dj * parent.dx
	buildBoundary(nest, parent)
	Nest.shiftBy(nest, di, dj, r)
end

-- Near-ground vortex diagnostics of the nest: strongest vertical vorticity at the lowest level
-- (and where), the lowest pressure perturbation there (Pa), the strongest ground-relative wind.
function Nest.diag(nest: any): { [string]: number }
	local zmax, zi, zj, pmin, vmax = 0, 0, 0, 0, 0
	local um, vm = nest.umove, nest.vmove
	for j = 3, nest.ny - 1 do
		for i = 3, nest.nx - 1 do
			local z = nest:zeta(i, j, 1)
			if z > zmax then
				zmax, zi, zj = z, i, j
			end
			local n = nest:idx(i, j, 1)
			if nest.p[n] < pmin then
				pmin = nest.p[n]
			end
			local u = 0.5 * (nest.u[n] + nest.u[n + 1]) + um
			local v = 0.5 * (nest.v[n] + nest.v[n + nest.SX]) + vm
			local s = math.sqrt(u * u + v * v)
			if s > vmax then
				vmax = s
			end
		end
	end
	-- the lowest cloud (qc > 1e-4) over the nest: a lowering or funnel below the storm's base
	local zlow, med = math.huge, {}
	for j = 3, nest.ny - 2 do
		for i = 3, nest.nx - 2 do
			for k = 1, nest.nz do
				if nest.qc[nest:idx(i, j, k)] > 1e-4 then
					local zb = nest.zf[k]
					if zb < zlow then
						zlow = zb
					end
					table.insert(med, zb)
					break
				end
			end
		end
	end
	table.sort(med)
	local base = med[math.max(1, math.floor(#med / 2))] or 0
	-- the vortex's pressure drop: the mean lowest-level p' over the nest less the lowest p' within
	-- 2 cells of the vorticity max (under a cold pool p' is raised everywhere, so p' alone hides it)
	local mean, nm, plo = 0, 0, math.huge
	for j = 3, nest.ny - 2 do
		for i = 3, nest.nx - 2 do
			mean += nest.p[nest:idx(i, j, 1)]
			nm += 1
		end
	end
	mean /= nm
	for j = math.max(1, zj - 2), math.min(nest.ny, zj + 2) do
		for i = math.max(1, zi - 2), math.min(nest.nx, zi + 2) do
			plo = math.min(plo, nest.p[nest:idx(i, j, 1)])
		end
	end
	local nv = nest:idx(math.max(1, zi), math.max(1, zj), 1)
	return { zeta = zmax, i = zi, j = zj, pmin = pmin, pdrop = mean - plo, thv = nest.th[nv] - nest.th0[1], vmax = vmax, cloudLow = if zlow < math.huge then zlow else 0, cloudBase = base }
end

return Nest
