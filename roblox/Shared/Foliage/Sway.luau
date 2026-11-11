--!strict
-- How a tree sways: each rig bone's turn (a rotation vector, tree-local: axis times angle in
-- radians) at time t, from the wind at the tree. Pure, the clients' and the plugin's preview
-- alike; the server never needs it (a break starts from whatever pose the client shows).
--
--   mean bend   each bone's base is a rotational spring (Rig.compliance) under the bending moment
--               of the drag on everything it carries (Mechanics.moments, without the weight: the
--               rest pose holds the tree up already): turn = compliance x moment. The children
--               inherit their parents' turns (the bones are a hierarchy), so the whole tree bends.
--   gusts       the wind's speed varies by the turbulence intensity in gusts carried along with the
--               wind (smooth noise in the frame moving with the mean wind, GUST_M across): a gust
--               visibly runs through a stand of trees, tree after tree.
--   sway        each bone oscillates at its own natural frequency (Rig.freq) along and across the
--               wind, in proportion to its bend and the turbulence: the trunk slow, twigs quick.
--   flutter     the leaf-holding bones (tier 2) shiver with the wind's speed.
-- A profile (Foliage/Profiles) scales the result for looks (bend, sway speed, gust strength,
-- flutter) and softly limits each tier's turn (tanh: no step).
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
local Mechanics = dep("./Mechanics", { "Mechanics" })

local Sway = {}

Sway.GUST_M = 35 -- m: the size of a gust as it runs through the trees
local TAU = 2 * math.pi

export type Out = { x: { number }, y: { number }, z: { number } }

function Sway.newOut(n: number): Out
	return { x = table.create(n, 0), y = table.create(n, 0), z = table.create(n, 0) }
end

-- The gust factor (around 1) at a place (m, x east / z) and time for a mean wind U toward (wx, wz).
function Sway.gust(px: number, pz: number, t: number, U: number, wx: number, wz: number, intensity: number): number
	local along = (px * wx + pz * wz - U * t) / Sway.GUST_M
	local across = (-px * wz + pz * wx) / Sway.GUST_M
	local g = Noise.value3(along, across, t * 0.05, 9127) + 0.5 * Noise.value3(along * 2.3, across * 2.3, t * 0.11, 9128)
	return math.max(0, 1 + intensity * g / 1.5 * 2)
end

local moments = Mechanics.newMoments(64)

-- The bones' turns into out. U10 the mean wind (m/s at 10 m) toward (wx, wz) (unit, tree-local),
-- px, pz the tree's place (m) for the gusts, seed the tree's own phases, alive (nil: all), lod
-- the highest tier animated (others hold still: their turn 0), profile Profiles.Profile.
function Sway.pose(rig: any, U10: number, wx: number, wz: number, t: number, px: number, pz: number, seed: number, alive: { boolean }?, lod: number, profile: any, out: Out): Out
	local n = rig.n
	local Iu = profile.turbulence
	local g = Sway.gust(px, pz, t, U10, wx, wz, Iu * profile.gust)
	local m = Mechanics.moments(rig, U10 * g, wx, wz, alive, false, moments)
	local speed = profile.speed
	local flutter = profile.flutter * math.min(U10 / 12, 1.5)
	local limits = profile.bendLimit
	for i = 1, n do
		if rig.tier[i] > lod or (alive and not alive[i]) then
			out.x[i], out.y[i], out.z[i] = 0, 0, 0
			continue
		end
		local c = rig.compliance[i] * profile.bend
		local bx, by, bz = m.x[i] * c, m.y[i] * c, m.z[i] * c
		local theta = math.sqrt(bx * bx + by * by + bz * bz)
		local ph = Noise.hash(seed, i, 1, 4441) * TAU
		local ph2 = Noise.hash(seed, i, 2, 4441) * TAU
		local f = rig.freq[i] * speed
		-- along the bend: the mean bend breathing at the bone's frequency
		local k = 1 + 0.6 * Iu * math.sin(TAU * f * t + ph)
		bx, by, bz = bx * k, by * k, bz * k
		-- across: about the wind's own direction
		local side = 0.35 * Iu * theta * math.sin(TAU * f * 1.37 * t + ph2)
		bx += wx * side
		bz += wz * side
		if rig.tier[i] >= 2 and flutter > 0 then
			local q = 0.03 * flutter
			bx += q * math.sin(TAU * (2.7 + f) * t + ph)
			by += q * 0.6 * math.sin(TAU * (3.3 + f) * t + ph2)
			bz += q * math.sin(TAU * (3.1 + f) * t + ph * 1.7)
		end
		-- the tier's soft limit
		local a = math.sqrt(bx * bx + by * by + bz * bz)
		if a > 1e-9 then
			local lim = math.rad(limits[rig.tier[i] + 1] or 30)
			local s = lim * math.tanh(a / lim) / a
			bx, by, bz = bx * s, by * s, bz * s
		end
		out.x[i], out.y[i], out.z[i] = bx, by, bz
	end
	return out
end

return Sway
