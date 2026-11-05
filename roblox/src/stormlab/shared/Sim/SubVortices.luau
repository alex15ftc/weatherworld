--!strict
-- Sub-vortices of a multi-vortex tornado as a small dynamical system (2026-10-31, user's research:
-- "a dynamically unstable parent vortex that develops smaller vortices within its circulation").
--
-- Each sub-vortex is a centre (angle th, radius r in core radii) and a strength a (0 .. ~1.3, a
-- share of Vortex's sub-vortex peak wind 0.45 vc). They are NOT a carousel: each centre is carried
-- by the parent's swirl where it sits, by the other sub-vortices' winds (so close ones orbit each
-- other, and the set never stays evenly spaced), and by an unresolved drift; two that come within
-- about a core of each other merge. Strength grows toward a target set by an instability index and
-- by where it sits (strongest near the radius of maximum wind; one carried inward is spun up by
-- stretching, one carried out decays and dies).
--
-- The instability index comes from the swirl ratio (the regime where laboratory and LES vortices
-- split: Vortex.params) and the tornado's strength, with hysteresis so it does not flicker on and
-- off. It is a game calibration, not a meteorological law: no single swirl ratio guarantees
-- sub-vortices in real tornadoes.
--
-- The state lives on the tornado (t.sv) and is stepped by the server (Tornado.step: winds for
-- damage, debris and radar) and by each client between snapshots (Tornado/StateAdapter); clients
-- are nudged to the server's copy, sent packed in the snapshot (pack / unpack: 4 bytes each).
-- Vortex.sample / Vortex.subvortices read it; the wind field decides where they are, the
-- condensation and dust renderers decide whether they are seen.

local function dep(name: string): any
	if script then
		return require((script :: any).Parent:FindFirstChild(name))
	end
	return (require :: any)("./" .. name)
end
local Noise = dep("Noise")

local SubVortices = {}

local MAXN = 6
local R_SUB = 0.12 -- core radius of a sub-vortex (parent core radii; Vortex.sample's rs)
local V_SUB = 0.8 -- its peak wind (share of the parent's vc; Vortex.SUB_V - 0.45 until 2026-10-31)

export type Sub = { id: number, th: number, r: number, a: number, age: number }
export type State = { list: { Sub }, on: boolean, I: number, nextId: number, spawnIn: number, n: number }

local function ramp(x: number, a: number, b: number): number
	return math.clamp((x - a) / (b - a), 0, 1)
end

function SubVortices.new(): State
	return { list = {}, on = false, I = 0, nextId = 1, spawnIn = 0, n = 0 }
end

-- The instability index (0..1): swirl in the multi-vortex regime (the old onset, swirl 1.0, stays
-- the onset), weighted by how strong the parent is and how organised.
function SubVortices.index(t: any): number
	local S = t.swirl or 0
	-- (not gated by organisation, 2026-11-03: a broad, high-swirl young circulation is already
	-- unstable before it organises - El Reno 2013 began as several sub-vortices round a broad
	-- centre (docs/stormlab/research/TORNADO-MORPH-RESEARCH.md P7). Gated by O, they appeared only
	-- once the swirl had halved, so no tornado could begin multi-vortex. The hollow core stays
	-- O-gated (Vortex.hollowR): the broad centre isn't two-celled yet)
	return ramp(S, 0.95, 1.5) * ramp(t.vc or 0, 8, 25) * (1 - math.clamp(t.decay or 0, 0, 1))
end

-- the swirl wind of a smooth vortex at distance d (core radius R): peaks at d = R
local function prof(d: number, R: number): number
	local q = d / R
	return 2 * q / (1 + q * q)
end

-- one step (dt seconds). t: the tornado (vc, rc, swirl, O, decay, seed); sv: its state.
local function step1(sv: State, t: any, dt: number, I: number)
	local vc = math.max(t.vc or 0, 1)
	local rc = math.max(t.rc or 30, 5)
	local seed = (t.seed or 0) + 4219
	local time = t.time or 0
	-- hysteresis: on above 0.25, off below 0.1
	if sv.on and I < 0.1 then
		sv.on = false
	elseif not sv.on and I > 0.25 then
		sv.on = true
	end
	local list = sv.list
	-- form: a new one now and then, up to the number the index supports (a perturbation on the
	-- radius of maximum wind that grows from nothing)
	local want = if sv.on then math.clamp(math.floor(1 + 5 * I + 0.5), 1, MAXN) else 0
	sv.spawnIn -= dt
	if #list < want and sv.spawnIn <= 0 then
		local id = sv.nextId
		sv.nextId = id % 250 + 1
		table.insert(list, {
			id = id,
			th = Noise.hash(id, 1, sv.n, seed) * 2 * math.pi,
			r = 0.7 + 0.25 * Noise.hash(id, 2, sv.n, seed),
			a = 0.02,
			age = 0,
		})
		sv.n += 1
		sv.spawnIn = 1.5 + 4 * Noise.hash(id, 3, sv.n, seed)
	end
	-- positions (in core radii, about the axis)
	local n = #list
	local xs, ys = table.create(n, 0), table.create(n, 0)
	for i, s in list do
		xs[i], ys[i] = s.r * math.cos(s.th), s.r * math.sin(s.th)
	end
	for i, s in list do
		local x, y = xs[i], ys[i]
		local r = math.max(s.r, 0.05)
		-- the parent's swirl carries it (counter-clockwise); sub-vortices are observed to travel
		-- at roughly half to three quarters of the peak wind - 0.6 here, a calibration
		local vt = 0.6 * vc * prof(r, 1)
		local u, v = -vt * y / r, vt * x / r
		-- the others' winds (each a smooth vortex, strength a)
		for j, o in list do
			if j ~= i then
				local dx, dy = x - xs[j], y - ys[j]
				local d = math.sqrt(dx * dx + dy * dy)
				if d > 1e-3 and d < 2.5 then
					local vj = V_SUB * vc * o.a * prof(d, R_SUB) * math.exp(-(d / 1.2) ^ 2)
					u += -vj * dy / d
					v += vj * dx / d
				end
			end
		end
		-- unresolved drift (turbulence, the instability itself): slowly wandering, ~0.12 vc
		local k = s.id * 3.7
		u += 0.12 * vc * Noise.value1(time / 4 + k, seed + 1)
		v += 0.12 * vc * Noise.value1(time / 4 + k + 50, seed + 2)
		-- kept within the parent's core region (0.3 .. 1.15 core radii): pushed back from outside
		local ur = (u * x + v * y) / r
		if r > 1.15 then
			ur -= 0.5 * vc * (r - 1.15)
		elseif r < 0.3 then
			ur += 0.5 * vc * (0.3 - r)
		end
		local ut = (-u * y + v * x) / r
		-- (to core radii per second)
		local dr = ur / rc * dt
		local dth = ut / rc / r * dt
		local rNew = math.clamp(r + dr, 0.05, 1.6)
		-- strength: toward the target; carried inward it is stretched and spun up, outward the
		-- reverse (circulation kept: a ~ 1/r over the step, softened)
		local target = if sv.on then I * ramp(rNew, 0.25, 0.5) * (1 - ramp(rNew, 0.95, 1.35)) else 0
		local tau = if target > s.a then 4 else 6
		s.a += (target - s.a) * (1 - math.exp(-dt / tau))
		s.a *= (r / rNew) ^ 0.5
		s.a = math.clamp(s.a, 0, 1.3)
		s.r = rNew
		s.th = (s.th + dth) % (2 * math.pi)
		s.age += dt
	end
	-- merge two that come within about one sub-vortex core diameter: the stronger keeps going, with
	-- both circulations (added in quadrature: a little lost to the mixing)
	for i = #list, 1, -1 do
		local s = list[i]
		for j = 1, i - 1 do
			local o = list[j]
			local dx = s.r * math.cos(s.th) - o.r * math.cos(o.th)
			local dy = s.r * math.sin(s.th) - o.r * math.sin(o.th)
			if dx * dx + dy * dy < (2 * R_SUB) ^ 2 then
				local keep, gone = if o.a >= s.a then o else s, if o.a >= s.a then s else o
				keep.a = math.min(1.3, math.sqrt(keep.a * keep.a + gone.a * gone.a))
				gone.a = 0
				gone.age = math.huge
				break
			end
		end
	end
	-- dissipated
	for i = #list, 1, -1 do
		local s = list[i]
		if s.age == math.huge or (s.age > 3 and s.a < 0.03) or s.r > 1.5 then
			table.remove(list, i)
		end
	end
end

function SubVortices.step(t: any, dt: number)
	local sv = t.sv
	if sv == nil then
		sv = SubVortices.new()
		t.sv = sv
	end
	local I = SubVortices.index(t)
	sv.I = I
	if dt <= 0 then
		return
	end
	local n = math.max(1, math.ceil(dt / 0.2))
	for _ = 1, n do
		step1(sv, t, dt / n, I)
	end
end

-- the effective count (sum of strengths, each at most 1): Vortex.params' subCount
function SubVortices.count(sv: State?): number
	if not sv then
		return 0
	end
	local c = 0
	for _, s in sv.list do
		c += math.min(s.a, 1)
	end
	return c
end

-- packed for the snapshot: 4 bytes a sub-vortex (id, angle, radius, strength) plus 1 for on/off
function SubVortices.pack(sv: State?): string
	if not sv then
		return ""
	end
	local parts = { string.char(if sv.on then 1 else 0) }
	for _, s in sv.list do
		table.insert(parts, string.char(
			s.id % 256,
			math.floor(s.th / (2 * math.pi) * 256 + 0.5) % 256,
			math.clamp(math.floor(s.r / 1.6 * 255 + 0.5), 0, 255),
			math.clamp(math.floor(s.a / 1.3 * 255 + 0.5), 0, 255)))
	end
	return table.concat(parts)
end

-- the server's copy into a client's: matched by id; new ones adopted, gone ones dropped, the rest
-- nudged by k (0..1) toward the server's (a client steps its own between snapshots)
function SubVortices.adopt(sv: State, packed: string?, k: number)
	if not packed or #packed < 1 then
		return
	end
	sv.on = string.byte(packed, 1) == 1
	local byId = {}
	for _, s in sv.list do
		byId[s.id] = s
	end
	local out = {}
	for i = 2, #packed - 3, 4 do
		local id, b1, b2, b3 = string.byte(packed, i, i + 3)
		local th, r, a = b1 / 256 * 2 * math.pi, b2 / 255 * 1.6, b3 / 255 * 1.3
		local s = byId[id]
		if s then
			local dth = (th - s.th + math.pi) % (2 * math.pi) - math.pi
			s.th = (s.th + k * dth) % (2 * math.pi)
			s.r += k * (r - s.r)
			s.a += k * (a - s.a)
		else
			s = { id = id, th = th, r = r, a = a, age = 1 }
		end
		table.insert(out, s)
	end
	sv.list = out
end

return SubVortices
