-- The foliage mechanics (roblox/Shared/Foliage/Mechanics.luau) against the EF scale's hardwood
-- tree indicator (DI 27, roblox/Shared/StormLab/Sim/Damage.luau): for every generated tree, the
-- 3-s gust at which, at average strength (factors 1), side branches (tier 2), limbs (tier 1) and
-- the stem (snapped) break and the roots give, must fall within the indicator's lower..upper
-- bounds for that degree of damage; and at rest every bone carries its own weight with room.
-- Also: a broken part's rest pose lies on the ground, and a fall reaches it.
--   luau tools/foliage/test_mechanics.luau

local Rig = require("../../roblox/Shared/Foliage/Rig")
local Mechanics = require("../../roblox/Shared/Foliage/Mechanics")
local Damage = require("../../roblox/Shared/StormLab/Sim/Damage")

local verbose = true
local fails = 0
local function check(ok: boolean, what: string)
	if not ok then
		fails += 1
		print("FAIL " .. what)
	end
end

local MPH = 0.44704
local DI = Damage.DI.tree
local function bounds(degree: number): (number, number, number)
	for _, row in DI do
		if row[1] == degree then
			return row[3], row[4], row[5]
		end
	end
	error("degree " .. degree)
end

-- DI 27's size classes by a branch's base diameter (in.): small limbs to 1, large branches 1-3,
-- and bigger (the crown's scaffold limbs, which the indicator does not name). The stem is tier 0.
local function sizeClass(rig: any, i: number): string
	if rig.tier[i] == 0 then
		return "stem"
	end
	local inches = 2 * rig.r0[i] / 0.0254
	return if inches <= 1 then "small" elseif inches <= 3 then "large" else "scaffold"
end

-- The gust (mph) at which the first bone of a size class breaks (or the roots: "root"), with
-- every strength factor 1 and nothing broken.
local function onset(rig: any, what: string): number?
	local st = Mechanics.newState(rig, 1)
	for i = 1, rig.n do
		st.strength[i] = 1
	end
	st.rootStrength = 1
	for mph = 20, 260 do
		local ratio, root = Mechanics.ratios(rig, st, mph * MPH, 1, 0)
		if what == "root" then
			if root >= 1 then
				return mph
			end
		else
			for i = 1, rig.n do
				if sizeClass(rig, i) == what and ratio[i] >= 1 then
					return mph
				end
			end
		end
	end
	return nil
end

for _, name in Rig.names() do
	local rig = Rig.get(name)
	-- at rest: every bone holds its own weight with room to spare
	local st = Mechanics.newState(rig, 1)
	for i = 1, rig.n do
		st.strength[i] = 1
	end
	local ratio = Mechanics.ratios(rig, st, 0, 1, 0)
	local worst = 0
	for i = 1, rig.n do
		worst = math.max(worst, ratio[i])
	end
	check(worst < 0.8, `{name}: a bone at {string.format("%.2f", worst)} of its strength under its own weight`)

	local small, large, scaffold, root, stem = onset(rig, "small"), onset(rig, "large"), onset(rig, "scaffold"), onset(rig, "root"), onset(rig, "stem")
	local first = math.min(root or 999, stem or 999)
	if verbose then
		print(string.format("%-14s %5.1f m  small limbs %s, large branches %s, scaffold limbs %s, roots %s, stem %s mph  (f trunk %.2f Hz)", name, rig.heightM,
			tostring(small), tostring(large), tostring(scaffold), tostring(root), tostring(stem), rig.freq[1]))
	end
	local _, lo1, hi1 = bounds(1)
	local _, lo2, hi2 = bounds(2)
	local _, lo3, hi3 = bounds(3)
	local _, lo4, hi4 = bounds(4)
	local SLACK = 10 -- mph either side: one tree at average strength, against the indicator's survey bounds
	check(small == nil or (small >= lo1 - SLACK and small <= hi1 + SLACK), `{name}: small limbs break at {small} mph (DI 27 {lo1}-{hi1})`)
	check(large == nil or (large >= lo2 - SLACK and large <= hi2 + SLACK) or large > first, `{name}: large branches break at {large} mph (DI 27 {lo2}-{hi2})`)
	check(scaffold == nil or scaffold >= lo2 and (scaffold <= hi4 or scaffold > first), `{name}: scaffold limbs break at {scaffold} mph (DI 27 large branches {lo2} .. snapped stem {hi4}, or after the tree is down)`)
	check(small ~= nil or large ~= nil or scaffold ~= nil, `{name}: no branch ever breaks`)
	check(first >= lo3 - SLACK and first <= hi4, `{name}: the tree goes down at {first} mph (DI 27 uproot {lo3}-{hi3}, snap {lo4}-{hi4})`)

	-- a toppled tree comes to rest on flat ground, lying down
	local flat = function(_x: number, _z: number): number
		return 0
	end
	local r = Mechanics.rest(rig, 0, 1, 0, 50, flat)
	check(r.angle > math.rad(60), `{name}: an overturned tree turned only {math.deg(r.angle)} degrees`)
	local top = 0
	for i = 1, rig.n do
		local _, y = Mechanics.place(r, r.angle, 1, rig.tx[i], rig.ty[i], rig.tz[i])
		top = math.max(top, y)
	end
	check(top < rig.heightM * 0.6, `{name}: the overturned tree still stands {top} m high`)
	-- a limb (the first tier-1 bone) falls free and lies on the ground
	for i = 1, rig.n do
		if rig.tier[i] == 1 then
			local rl = Mechanics.rest(rig, i, 1, 0, 40, flat)
			-- it lies down: its base no higher than a third of the part's spread off the ground
			local spread = 0
			for _, k in Mechanics.partBones(rig, i) do
				spread = math.max(spread, math.sqrt((rig.tx[k] - rig.hx[i]) ^ 2 + (rig.ty[k] - rig.hy[i]) ^ 2 + (rig.tz[k] - rig.hz[i]) ^ 2))
			end
			local _, hy = Mechanics.place(rl, rl.angle, 1, rig.hx[i], rig.hy[i], rig.hz[i])
			check(hy < spread / 3 + 0.5, `{name}: a fallen limb rests with its base {hy} m up (spread {spread} m)`)
			local a, s = Mechanics.fallAt(rl, rl.fallS)
			check(math.abs(a - rl.angle) < 1e-6 and s == 1, `{name}: the fall does not reach its rest`)
			break
		end
	end
end

-- a storm breaks things in order and each break unloads its parents
do
	local rig = Rig.get("hardwood_1")
	local st = Mechanics.newState(rig, 42)
	local broke = {}
	for mph = 40, 200, 5 do
		for _, b in Mechanics.step(rig, st, mph * MPH, 0, 1, 3) do
			table.insert(broke, { mph = mph, bone = b.bone })
		end
		if st.down then
			break
		end
	end
	check(#broke > 0 and st.down, "a rising storm never brings hardwood_1 down")
	if verbose then
		for _, b in broke do
			print(string.format("  %d mph: %s", b.mph, if b.bone == 0 then "uprooted" else rig.names[b.bone]))
		end
	end
end

print(if fails == 0 then "test_mechanics: ok" else `test_mechanics: {fails} failed`)
if fails > 0 then error("failed", 0) end
