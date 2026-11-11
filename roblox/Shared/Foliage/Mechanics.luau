--!strict
-- How wind loads a tree, what breaks, and where the broken part comes to rest. Pure (no Roblox
-- types), so the server (which decides), every client (which animates the fall) and the Lune
-- tests compute the same. Tree-local metres: x, z across, y up from the tree's foot.
--
-- Load (each rig bone i, alive):
--   wind at its height   U(z) = U10 ln(z / Z0) / ln(10 / Z0)  (neutral log profile, z >= 1 m)
--   drag                 F = 1/2 rho U^2 (cdLeaf leafM2 PROJ_LEAF shelter (max(U, UREF)/UREF)^vogel
--                                         + CD_WOOD frontM2 PROJ_WOOD)
--                        - the leaves fold and streamline above UREF (Species.vogel); a crown's
--                        leaves shelter each other: their drag area is no more than the crown's
--                        outline (Rig.shelter)
--   weight               W = mass g
-- both acting at the bone's middle. The bending moment at a bone's base is the sum over
-- everything it carries of (r x F) + (r x W), r from its base. Stress = |moment| / section
-- (pi r0^3 / 4); the bone breaks when stress reaches the wood's modulus of rupture (at a branch's
-- attachment JUNCTION of it) times its
-- strength factor (each bone's own, from the tree's seed: knots, decay, included bark - lognormal,
-- STRENGTH_SPREAD). The tree overturns when the moment at its foot reaches the root anchorage
-- (Species.anchor x stem mass) times its own factor. Below that, loads near the limit fatigue the
-- wood (FATIGUE_*): a long blow does what one gust does not.
--
-- The wind U10 here is a 3-s gust at 10 m, the EF scale's measure; tools/foliage/test_mechanics
-- checks the kinds against the EF scale's hardwood-tree indicator (DI 27 in StormLab/Sim/Damage).
local function dep(path: string, robloxPath: { string }): any
	if script then
		local node: any = (script :: any).Parent
		for _, name in robloxPath do
			node = if name == ".." then node.Parent else node:FindFirstChild(name)
		end
		return require(node)
	end
	return (require :: any)(path)
end
local Noise = dep("../StormLab/Sim/Noise", { "..", "StormLab", "Sim", "Noise" })

local Mechanics = {}

local RHO = 1.2
local G = 9.81
Mechanics.Z0 = 0.1 -- m, roughness length of plains with scattered trees
Mechanics.PROJ_LEAF = 0.5 -- leaf cards face every way: half their area meets the wind
Mechanics.CD_WOOD = 1.2 -- a cylinder across the flow
Mechanics.PROJ_WOOD = 2 / math.pi -- stems lie every way: their mean projection
Mechanics.JUNCTION = 0.65 -- a branch's attachment breaks at this share of its wood's strength
-- (branch-pulling tests: Kane, Farrell, Zedaker & Loferski 2008; Slater 2018 - unions with
-- included bark lower still)
Mechanics.STRENGTH_SPREAD = 0.18 -- the log-normal spread of a bone's strength
Mechanics.ROOT_SPREAD = 0.2 -- and of the root plate's
Mechanics.FATIGUE_FROM = 0.6 -- a stress ratio above this tires the wood
Mechanics.FATIGUE_S = 300 -- s at a ratio of 1 that would break it by fatigue alone (ratio^4 law)

local UREF = 4 -- m/s (Species.UREF)

function Mechanics.windAt(U10: number, z: number): number
	local Z0 = Mechanics.Z0
	return U10 * math.log(math.max(z, 1) / Z0) / math.log(10 / Z0)
end

-- Per-bone strength factors and the root's, from a seed (the same on every machine).
function Mechanics.strengths(rig: any, seed: number): ({ number }, number)
	local function normal(k: number): number
		-- (the sum of four uniforms, centred and scaled: close enough to a normal)
		local s = 0
		for j = 1, 4 do
			s += Noise.hash(seed, k, j, 7331)
		end
		return (s - 2) / math.sqrt(4 / 12)
	end
	local f = {}
	for i = 1, rig.n do
		f[i] = math.exp(Mechanics.STRENGTH_SPREAD * normal(i))
	end
	return f, math.exp(Mechanics.ROOT_SPREAD * normal(0))
end

export type Moments = { x: { number }, y: { number }, z: { number }, mag: { number } }

function Mechanics.newMoments(n: number): Moments
	return { x = table.create(n, 0), y = table.create(n, 0), z = table.create(n, 0), mag = table.create(n, 0) }
end

-- The bending moment at every bone's base (N m, a vector: the axis it bends about times the
-- moment), into out. alive[i] false drops bone i and everything it carries. gravity: with the
-- weight's moment (the server's breaking), without it (the sway: the rest pose already holds the
-- tree up against its weight).
local sf, srx, sry, srz, sw, sgx, sgy, sgz = {}, {}, {}, {}, {}, {}, {}, {}
function Mechanics.moments(rig: any, U10: number, wx: number, wz: number, alive: { boolean }?, gravity: boolean, out: Moments): Moments
	local wood = rig.wood
	local n = rig.n
	local recon0 = wood.cdLeaf * Mechanics.PROJ_LEAF
	local woodCd = Mechanics.CD_WOOD * Mechanics.PROJ_WOOD
	for i = 1, n do
		sf[i], srx[i], sry[i], srz[i], sw[i], sgx[i], sgy[i], sgz[i] = 0, 0, 0, 0, 0, 0, 0, 0
	end
	for i = n, 1, -1 do
		if alive and not alive[i] then
			out.x[i], out.y[i], out.z[i], out.mag[i] = 0, 0, 0, 0
			continue
		end
		local U = Mechanics.windAt(U10, rig.my[i])
		local recon = (math.max(U, UREF) / UREF) ^ wood.vogel
		local F = 0.5 * RHO * U * U * (recon0 * rig.shelter * rig.leafM2[i] * recon + woodCd * rig.frontM2[i])
		local W = rig.mass[i] * G
		local mx, my, mz = rig.mx[i], rig.my[i], rig.mz[i]
		sf[i] += F
		srx[i] += F * mx
		sry[i] += F * my
		srz[i] += F * mz
		sw[i] += W
		sgx[i] += W * mx
		sgy[i] += W * my
		sgz[i] += W * mz
		-- the moment at this bone's base
		local hx, hy, hz = rig.hx[i], rig.hy[i], rig.hz[i]
		local Rx, Ry, Rz = srx[i] - hx * sf[i], sry[i] - hy * sf[i], srz[i] - hz * sf[i]
		-- R x w, w = (wx, 0, wz)
		local Mx, My, Mz = Ry * wz, Rz * wx - Rx * wz, -Ry * wx
		if gravity then
			local gx, gz = sgx[i] - hx * sw[i], sgz[i] - hz * sw[i]
			-- R_g x (0, -1, 0)
			Mx += gz
			Mz -= gx
		end
		out.x[i], out.y[i], out.z[i] = Mx, My, Mz
		out.mag[i] = math.sqrt(Mx * Mx + My * My + Mz * Mz)
		-- carried on to the parent
		local p = rig.parent[i]
		if p > 0 then
			sf[p] += sf[i]
			srx[p] += srx[i]
			sry[p] += sry[i]
			srz[p] += srz[i]
			sw[p] += sw[i]
			sgx[p] += sgx[i]
			sgy[p] += sgy[i]
			sgz[p] += sgz[i]
		end
	end
	return out
end

-- One tree's breaking state on the server.
export type State = {
	alive: { boolean },
	fatigue: { number },
	rootFatigue: number,
	strength: { number },
	rootStrength: number,
	down: boolean, -- overturned or snapped at the foot: nothing left standing to load
}

function Mechanics.newState(rig: any, seed: number): State
	local s, r = Mechanics.strengths(rig, seed)
	return { alive = table.create(rig.n, true), fatigue = table.create(rig.n, 0), rootFatigue = 0, strength = s, rootStrength = r, down = false }
end

-- Marks bone i and everything it carries as gone.
function Mechanics.drop(rig: any, st: State, i: number)
	local stack = { i }
	while #stack > 0 do
		local k = table.remove(stack) :: number
		st.alive[k] = false
		for _, c in rig.children[k] do
			table.insert(stack, c)
		end
	end
	if i == 1 then
		st.down = true
	end
end

-- The stress ratios now (bone stress over strength, root moment over anchorage): for the tests
-- and the debug view.
local scratch = Mechanics.newMoments(64)
function Mechanics.ratios(rig: any, st: State, U10: number, wx: number, wz: number): ({ number }, number)
	local m = Mechanics.moments(rig, U10, wx, wz, st.alive, true, scratch)
	local out = {}
	for i = 1, rig.n do
		out[i] = if st.alive[i] then m.mag[i] / (rig.section[i] * rig.wood.mor * rig.joint[i] * st.strength[i]) else 0
	end
	local root = if st.alive[1] then m.mag[1] / (rig.wood.anchor * rig.stemKg * st.rootStrength) else 0
	return out, root
end

export type Break = { bone: number, dirX: number, dirZ: number } -- bone 0: the roots

-- Loads the tree with a 3-s gust U10 (m/s) blowing toward (wx, wz) (unit, tree-local) for dt s;
-- returns what broke (at most a few at a time: each break unloads what it carried, so the rest is
-- loaded again without it).
function Mechanics.step(rig: any, st: State, U10: number, wx: number, wz: number, dt: number): { Break }
	local out = {}
	if st.down then
		return out
	end
	for _ = 1, 6 do
		local ratio, rootRatio = Mechanics.ratios(rig, st, U10, wx, wz)
		-- fatigue
		local worst, worstAt = 0, -1
		local function tire(r: number, f: number): (number, number)
			if r > Mechanics.FATIGUE_FROM then
				f += dt * ((r - Mechanics.FATIGUE_FROM) / (1 - Mechanics.FATIGUE_FROM)) ^ 4 / Mechanics.FATIGUE_S
			end
			return f, r + f
		end
		local f, score = tire(rootRatio, st.rootFatigue)
		st.rootFatigue = f
		if score >= 1 then
			worst, worstAt = score, 0
		end
		for i = 1, rig.n do
			if st.alive[i] then
				local fi, si = tire(ratio[i], st.fatigue[i])
				st.fatigue[i] = fi
				if si >= 1 and si > worst then
					worst, worstAt = si, i
				end
			end
		end
		dt = 0 -- (fatigue once a step; the repeats only redistribute the load)
		if worstAt < 0 then
			break
		end
		table.insert(out, { bone = worstAt, dirX = wx, dirZ = wz })
		Mechanics.drop(rig, st, if worstAt == 0 then 1 else worstAt)
		if st.down then
			break
		end
	end
	return out
end

-- Applies a recorded break (persistence, another server's word) to a state.
function Mechanics.apply(rig: any, st: State, bone: number)
	Mechanics.drop(rig, st, if bone == 0 then 1 else bone)
end

----------------------------------------------------------------------------------------------
-- Where a broken part comes to rest. p' = pivot + R(axis, angle) (p - pivot) + offset, applied to
-- every point of the part (bone `bone` and all it carries; 0 the whole tree). ground(x, z) is the
-- ground's height (tree-local m) there.

export type Rest = {
	bone: number,
	px: number, py: number, pz: number,
	ax: number, ay: number, az: number,
	angle: number,
	ox: number, oy: number, oz: number,
	hinged: boolean, -- turned about a hinge (uprooted, snapped stem) rather than dropped free
	fallS: number, -- how long the fall takes (s)
}

local function rotate(x: number, y: number, z: number, ax: number, ay: number, az: number, a: number): (number, number, number)
	-- Rodrigues: v cos a + (k x v) sin a + k (k . v)(1 - cos a)
	local c, s = math.cos(a), math.sin(a)
	local d = (ax * x + ay * y + az * z) * (1 - c)
	return x * c + (ay * z - az * y) * s + ax * d, y * c + (az * x - ax * z) * s + ay * d, z * c + (ax * y - ay * x) * s + az * d
end
Mechanics.rotate = rotate

-- One turn (axis, angle) that is turn 1 then turn 2 (both about axes through the same point).
local function compose(ax1: number, ay1: number, az1: number, a1: number, ax2: number, ay2: number, az2: number, a2: number): (number, number, number, number)
	local s1, s2 = math.sin(a1 / 2), math.sin(a2 / 2)
	local w1, x1, y1, z1 = math.cos(a1 / 2), ax1 * s1, ay1 * s1, az1 * s1
	local w2, x2, y2, z2 = math.cos(a2 / 2), ax2 * s2, ay2 * s2, az2 * s2
	-- q = q2 q1
	local w = w2 * w1 - x2 * x1 - y2 * y1 - z2 * z1
	local x = w2 * x1 + x2 * w1 + y2 * z1 - z2 * y1
	local y = w2 * y1 - x2 * z1 + y2 * w1 + z2 * x1
	local z = w2 * z1 + x2 * y1 - y2 * x1 + z2 * w1
	if w < 0 then
		w, x, y, z = -w, -x, -y, -z
	end
	local s = math.sqrt(x * x + y * y + z * z)
	if s < 1e-9 then
		return 1, 0, 0, 0
	end
	return x / s, y / s, z / s, 2 * math.atan2(s, w)
end

-- The points a part touches the ground with: each bone's head, middle and tail, the crown's ends
-- held off by CROWN_M.
local CROWN_M = 0.6
local function partBones(rig: any, bone: number): { number }
	local list = {}
	local stack = { if bone == 0 then 1 else bone }
	while #stack > 0 do
		local k = table.remove(stack) :: number
		table.insert(list, k)
		for _, c in rig.children[k] do
			table.insert(stack, c)
		end
	end
	return list
end
Mechanics.partBones = partBones

local function lowest(rig: any, bones: { number }, r: Rest, a: number, ground: (number, number) -> number, free: boolean): number
	-- the least clearance over the ground of the part turned by a (negative: in the ground). A
	-- hinged part counts only the points that stand clear of the ground at the start (its foot
	-- is on the ground already).
	local least = math.huge
	for _, i in bones do
		for k = 0, 2 do
			local t = k / 2
			local x = rig.hx[i] + (rig.tx[i] - rig.hx[i]) * t
			local y = rig.hy[i] + (rig.ty[i] - rig.hy[i]) * t
			local z = rig.hz[i] + (rig.tz[i] - rig.hz[i]) * t
			local pad = if rig.tier[i] >= 1 and k == 2 then CROWN_M else rig.r0[i]
			-- (a toppling stem comes to rest on its stem: the crown's branches crush and break under it)
			if free or (rig.tier[i] == 0 and y - pad - ground(x, z) > 0.5) then
				local qx, qy, qz = rotate(x - r.px, y - r.py, z - r.pz, r.ax, r.ay, r.az, a)
				qx, qy, qz = qx + r.px + r.ox, qy + r.py + r.oy, qz + r.pz + r.oz
				least = math.min(least, qy - pad - ground(qx, qz))
			end
		end
	end
	return least
end

function Mechanics.rest(rig: any, bone: number, wx: number, wz: number, U10: number, ground: (number, number) -> number): Rest
	local bones = partBones(rig, bone)
	local root = if bone == 0 then 1 else bone
	local hinged = rig.tier[root] == 0
	-- turned about the horizontal axis across the wind: up x w = (wz, 0, -wx)
	local r: Rest = {
		bone = bone, px = rig.hx[root], py = rig.hy[root], pz = rig.hz[root], ax = wz, ay = 0, az = -wx, angle = 0,
		ox = 0, oy = 0, oz = 0, hinged = hinged, fallS = 0,
	}
	if bone == 0 then
		-- an overturned tree turns about the edge of its root plate (about 3 stem diameters out)
		local plate = 3 * 2 * rig.r0[1]
		r.px, r.pz = r.px + wx * plate, r.pz + wz * plate
	end
	if hinged then
		-- over until it lies on the ground (or 100 degrees: on a slope falling away)
		local a = 0
		while a < math.rad(100) and lowest(rig, bones, r, a + math.rad(2), ground, false) > 0 do
			a += math.rad(2)
		end
		r.angle = a
		-- the time a rod toppling about its foot takes to fall that far (from a small lean): about
		-- 2.5 sqrt(L / g) for a uniform rod; L the part's centre of mass height above the pivot
		local L = 0
		local kg = 0
		for _, i in bones do
			L += rig.mass[i] * (rig.my[i] - r.py)
			kg += rig.mass[i]
		end
		L = math.max(L / math.max(kg, 1e-6), 0.5)
		r.fallS = 2.5 * math.sqrt(L / G) * (a / (math.pi / 2)) ^ 0.5
	else
		-- a limb falls free: it lands lying along its length (from its base to the middle of its
		-- mass), carried downwind as it falls
		local cx, cy, cz, kg = 0, 0, 0, 0
		for _, i in bones do
			cx += rig.mass[i] * rig.mx[i]
			cy += rig.mass[i] * rig.my[i]
			cz += rig.mass[i] * rig.mz[i]
			kg += rig.mass[i]
		end
		kg = math.max(kg, 1e-6)
		local dx, dy, dz = cx / kg - rig.hx[root], cy / kg - rig.hy[root], cz / kg - rig.hz[root]
		local len = math.max(math.sqrt(dx * dx + dy * dy + dz * dz), 1e-6)
		dx, dy, dz = dx / len, dy / len, dz / len
		-- the axis that lays it level: (d x up), turned by the angle between it and level
		local kx, kz = -dz, dx
		local kl = math.sqrt(kx * kx + kz * kz)
		if kl < 1e-4 then
			kx, kz, kl = wz, -wx, 1
		end
		kx, kz = kx / kl, kz / kl
		local lay = -math.asin(math.clamp(dy, -1, 1)) -- (about d x up: lowers a rising limb)
		-- then rolled about its now level length to the side it settles on: the roll that leaves
		-- its mass lowest (a limb lies on its side branches the way it is most stable)
		local hl = math.max(math.sqrt(dx * dx + dz * dz), 1e-6)
		local lx, lz = dx / hl, dz / hl
		if math.sqrt(dx * dx + dz * dz) < 1e-4 then
			lx, lz = -kz, kx
		end
		local best, bestH = nil :: any, math.huge
		for k = 0, 11 do
			local ax, ay, az, ang = compose(kx, 0, kz, lay, lx, 0, lz, k * math.pi / 6)
			local trial: Rest = table.clone(r)
			trial.ax, trial.ay, trial.az, trial.angle = ax, ay, az, ang
			local lowY = lowest(rig, bones, trial, ang, ground, true)
			-- the mass centre's height once the lowest point is on the ground
			local _, qy = rotate(cx / kg - r.px, cy / kg - r.py, cz / kg - r.pz, ax, ay, az, ang)
			local h = qy + r.py - lowY
			if h < bestH - 1e-6 then
				best, bestH = trial, h
			end
		end
		r.ax, r.ay, r.az, r.angle = best.ax, best.ay, best.az, best.angle
		len = rig.length[root]
		local h = math.max(r.py - ground(r.px, r.pz), 0)
		local tf = math.sqrt(2 * h / G)
		local drift = math.min(0.3 * U10 * tf, 3 * len)
		r.ox, r.oz = wx * drift, wz * drift
		-- down onto the ground
		r.oy = 0
		local clear = lowest(rig, bones, r, r.angle, ground, true)
		r.oy = -clear
		r.fallS = tf
	end
	return r
end

-- How far into its fall a part is after t s: the angle turned and the share of the offset made.
-- A hinged part topples (slowly at first: angle ~ (t / T)^2), a free one falls (offset share
-- (t / T)^2) turning as it goes.
function Mechanics.fallAt(r: Rest, t: number): (number, number)
	if r.fallS <= 0 then
		return r.angle, 1
	end
	local f = math.clamp(t / r.fallS, 0, 1)
	if r.hinged then
		return r.angle * f * f, 1
	end
	return r.angle * f, f * f
end

-- A point of the part (tree-local) where it is f into its fall: angle a, offset share s.
function Mechanics.place(r: Rest, a: number, s: number, x: number, y: number, z: number): (number, number, number)
	local qx, qy, qz = rotate(x - r.px, y - r.py, z - r.pz, r.ax, r.ay, r.az, a)
	return qx + r.px + r.ox * s, qy + r.py + r.oy * s, qz + r.pz + r.oz * s
end

return Mechanics
