--!strict
-- One tree's rig as the mechanics use it: the generated bone data (Foliage/Kinds/<kind>_<n>,
-- tools/blender/foliage_trees.py) turned into flat arrays (index order is parents first), with
-- what follows from it and the kind's wood (Foliage/Species):
--   mass        the bone's own wood and leaves (kg; leaves LEAF_KG a m2 of leaf, with their twigs)
--   mx, my, mz  where that mass and the bone's drag act (m from the foot: the bone's middle)
--   z           (Roblox y) height of that point above the foot (m)
--   section     the section modulus at the bone's base (m3): bending stress = moment / section
--   compliance  the bone's base as a rotational spring (rad per N m): length / (E I)
--   chain       the compliance from the ground to this bone's base and through it (rad per N m)
--   inertia     the moment of inertia of the bone and everything it carries about its base (kg m2)
--   freq        the natural frequency of that load on that spring (Hz)
--   stemKg      the stem's (tier 0) wood mass: the root anchorage's measure
--   joint       the strength share at the bone's base: Mechanics.JUNCTION where a branch joins
--               the stem or limb it grows from, else 1
--   shelter     the share of the leaves' drag area the crown's outline lets through: the crown
--               (its width by its leafy height, an ellipse) over the leaves' projected area, at
--               most 1
-- Pure: plain numbers, no Roblox types, so the server, the clients and Lune evaluate the same.
local function dep(name: string): any
	if script then
		return require((script :: any).Parent:FindFirstChild(name))
	end
	return (require :: any)("./" .. name)
end
local Species = dep("Species")
-- (the generated data, loaded now: a chunk worker asks for it in the parallel phase, where
-- require is not allowed)
local Kinds = dep("Kinds")
local Mechanics = dep("Mechanics")

local Rig = {}

Rig.LEAF_KG = 0.12 -- kg a m2 of (one-sided) leaf, with the twigs that hold it

export type Rig = {
	name: string,
	kind: string,
	heightM: number,
	wood: any,
	n: number,
	names: { string },
	index: { [string]: number },
	parent: { number }, -- 0: the root bone
	children: { { number } },
	tier: { number },
	hx: { number }, hy: { number }, hz: { number },
	tx: { number }, ty: { number }, tz: { number },
	mx: { number }, my: { number }, mz: { number },
	length: { number },
	r0: { number },
	leafM2: { number },
	frontM2: { number },
	mass: { number },
	section: { number },
	compliance: { number },
	chain: { number },
	inertia: { number },
	freq: { number },
	subtreeKg: { number },
	stemKg: number,
	joint: { number },
	shelter: number,
	impostor: any,
}

local cache: { [string]: Rig } = {}

function Rig.build(name: string, data: any): Rig
	local wood = Species.of(data.kind)
	local n = #data.bones
	local r: any = {
		name = name, kind = data.kind, heightM = data.heightM, wood = wood, n = n, names = {}, index = {},
		parent = {}, children = {}, tier = {}, hx = {}, hy = {}, hz = {}, tx = {}, ty = {}, tz = {}, mx = {}, my = {}, mz = {},
		length = {}, r0 = {}, leafM2 = {}, frontM2 = {}, mass = {}, section = {}, compliance = {}, chain = {},
		inertia = {}, freq = {}, subtreeKg = {}, stemKg = 0, joint = {}, shelter = 1, impostor = data.impostor,
	}
	for i, b in data.bones do
		r.names[i] = b.name
		r.index[b.name] = i
		r.children[i] = {}
	end
	for i, b in data.bones do
		local p = if b.parent then r.index[b.parent] else 0
		assert(p == 0 or p < i, "rig bones must come parents first")
		r.parent[i] = p
		if p > 0 then
			table.insert(r.children[p], i)
		end
		r.tier[i] = b.tier
		r.hx[i], r.hy[i], r.hz[i] = b.head[1], b.head[2], b.head[3]
		r.tx[i], r.ty[i], r.tz[i] = b.tail[1], b.tail[2], b.tail[3]
		r.mx[i], r.my[i], r.mz[i] = (b.head[1] + b.tail[1]) / 2, (b.head[2] + b.tail[2]) / 2, (b.head[3] + b.tail[3]) / 2
		r.length[i] = b.lengthM
		r.r0[i] = math.max(b.r0, 0.005)
		r.leafM2[i] = b.leafM2
		r.frontM2[i] = b.frontM2
		r.mass[i] = b.woodM3 * wood.density + b.leafM2 * Rig.LEAF_KG
		r.section[i] = math.pi * r.r0[i] ^ 3 / 4
		local I = math.pi * r.r0[i] ^ 4 / 4
		r.compliance[i] = math.max(b.lengthM, 0.05) / (wood.e * I)
		if b.tier == 0 then
			r.stemKg += b.woodM3 * wood.density
		end
	end
	-- branch attachments, and the crown's shelter
	local leafSum, crownLo, crownHi, halfW = 0, math.huge, 0, 0
	for i = 1, n do
		local p = r.parent[i]
		r.joint[i] = if p > 0 and r.tier[p] < r.tier[i] then Mechanics.JUNCTION else 1
		if r.leafM2[i] > 0 then
			leafSum += r.leafM2[i]
			crownLo = math.min(crownLo, r.hy[i])
			crownHi = math.max(crownHi, r.ty[i])
		end
		halfW = math.max(halfW, math.sqrt(r.tx[i] ^ 2 + r.tz[i] ^ 2))
	end
	if leafSum > 0 then
		local width = if data.impostor then data.impostor.widthM else 2 * (halfW + 1)
		local outline = math.pi / 4 * width * math.max(crownHi - crownLo, 1)
		r.shelter = math.min(1, outline / (Mechanics.PROJ_LEAF * leafSum))
	end
	-- the chain's compliance from the ground down
	for i = 1, n do
		local p = r.parent[i]
		r.chain[i] = r.compliance[i] + (if p > 0 then r.chain[p] else 0)
	end
	-- what each bone carries (children come after parents: run backwards)
	for i = n, 1, -1 do
		local kg = r.mass[i]
		for _, c in r.children[i] do
			kg += r.subtreeKg[c]
		end
		r.subtreeKg[i] = kg
	end
	for i = 1, n do
		-- the inertia about the bone's base of every mass it carries
		local J = 0
		local stack = { i }
		while #stack > 0 do
			local k = table.remove(stack) :: number
			local dx, dy, dz = r.mx[k] - r.hx[i], r.my[k] - r.hy[i], r.mz[k] - r.hz[i]
			J += r.mass[k] * (dx * dx + dy * dy + dz * dz)
			for _, c in r.children[k] do
				table.insert(stack, c)
			end
		end
		r.inertia[i] = math.max(J, 1e-3)
		r.freq[i] = math.sqrt(1 / (r.chain[i] * r.inertia[i])) / (2 * math.pi)
	end
	return r :: Rig
end

-- The rig of a generated tree by name ("hardwood_1"), built once.
function Rig.get(name: string): Rig
	local hit = cache[name]
	if hit then
		return hit
	end
	local data = Kinds.byName[name]
	assert(data, "no foliage kind " .. name)
	local r = Rig.build(name, data)
	cache[name] = r
	return r
end

-- Every generated tree's name.
function Rig.names(): { string }
	local out = {}
	for name in Kinds.byName do
		table.insert(out, name)
	end
	table.sort(out)
	return out
end

-- The variants of a kind ("hardwood" -> { "hardwood_1", ... }), or nil.
function Rig.variants(kind: string): { string }?
	return Kinds.variants[kind]
end

return Rig
