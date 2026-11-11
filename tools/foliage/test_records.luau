-- Tree and damage records (roblox/Shared/Foliage/Records.luau) survive encoding as the server
-- and the clients read them.
--   lune run tools/foliage/test_records.luau
local Records = require("../../roblox/Shared/Foliage/Records")
local Rig = require("../../roblox/Shared/Foliage/Rig")

local fails = 0
local function check(ok: boolean, what: string)
	if not ok then
		fails += 1
		print("FAIL " .. what)
	end
end

local names = Rig.names()
local trees = {}
for i = 1, 37 do
	table.insert(trees, Records.quantise({ x = i * 101.5 - 3000, y = 12.25 + i, z = -i * 77.75, name = names[(i % #names) + 1], scale = 0.85 + (i % 7) * 0.05, yaw = i * 0.7 }))
end
local back = Records.decodeTrees(Records.encodeTrees(trees))
check(#back == #trees, "tree count")
for i, t in trees do
	local b = back[i]
	check(b.name == t.name and math.abs(b.x - t.x) < 1e-3 and math.abs(b.z - t.z) < 1e-3 and math.abs(b.y - t.y) < 1e-3, `tree {i} place/name`)
	check(math.abs(b.scale - t.scale) < 1e-6 and math.abs(b.yaw - t.yaw) < 1e-6, `tree {i} scale/yaw (quantised alike)`)
end
local dmg = {}
for i = 1, 9 do
	local dx, dz = Records.quantiseDir(math.cos(i), math.sin(i))
	table.insert(dmg, { tree = i * 3, bone = i % 5, dirX = dx, dirZ = dz, at = 1.7e9 + i * 0.25, gust = 30 + i })
end
local db = Records.decodeDamage(Records.encodeDamage(dmg))
check(#db == #dmg, "damage count")
for i, d in dmg do
	local b = db[i]
	check(b.tree == d.tree and b.bone == d.bone and b.at == d.at and math.abs(b.gust - d.gust) < 1e-4, `damage {i}`)
	check(math.abs(b.dirX - d.dirX) < 1e-9 and math.abs(b.dirZ - d.dirZ) < 1e-9, `damage {i} direction (quantised alike)`)
end
check(#Records.decodeDamage("") == 0, "empty damage")

print(if fails == 0 then "test_records: ok" else `test_records: {fails} failed`)
if fails > 0 then
	error("failed", 0)
end
