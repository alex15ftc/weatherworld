-- The sway (roblox/Shared/Foliage/Sway.luau): still air holds still, the bend grows with the
-- wind and stays within the profile's limits, and the same inputs give the same pose.
--   lune run tools/foliage/test_sway.luau
local Rig = require("../../roblox/Shared/Foliage/Rig")
local Sway = require("../../roblox/Shared/Foliage/Sway")
local Profiles = require("../../roblox/Shared/Foliage/Profiles")

local fails = 0
local function check(ok: boolean, what: string)
	if not ok then
		fails += 1
		print("FAIL " .. what)
	end
end

local profile = Profiles.DEFAULT
for _, name in Rig.names() do
	local rig = Rig.get(name)
	local out = Sway.newOut(rig.n)
	Sway.pose(rig, 0, 1, 0, 3.2, 10, 20, 7, nil, 2, profile, out)
	local still = 0
	for i = 1, rig.n do
		still = math.max(still, math.abs(out.x[i]) + math.abs(out.y[i]) + math.abs(out.z[i]))
	end
	check(still < 1e-3, `{name}: sways {still} rad in still air`)

	-- the crown's top: the summed turn of the trunk's bones, averaged over a minute
	local function trunkBend(U: number): (number, number)
		local sum, peak = 0, 0
		for k = 0, 59 do
			Sway.pose(rig, U, 1, 0, k * 1.01, 10, 20, 7, nil, 2, profile, out)
			local a = 0
			for i = 1, rig.n do
				if rig.tier[i] == 0 then
					a += math.sqrt(out.x[i] ^ 2 + out.y[i] ^ 2 + out.z[i] ^ 2)
				end
				local lim = math.rad(profile.bendLimit[rig.tier[i] + 1])
				peak = math.max(peak, math.sqrt(out.x[i] ^ 2 + out.y[i] ^ 2 + out.z[i] ^ 2) / lim)
			end
			sum += a
		end
		return math.deg(sum / 60), peak
	end
	local b5, p5 = trunkBend(5)
	local b12, p12 = trunkBend(12)
	local b25, p25 = trunkBend(25)
	print(string.format("%-14s trunk bend %.1f / %.1f / %.1f deg at 5 / 12 / 25 m/s", name, b5, b12, b25))
	check(b5 < b12 and b12 < b25, `{name}: the bend does not grow with the wind`)
	check(b12 > 0.3 and b12 < 15, `{name}: a {b12} degree trunk bend at 12 m/s`)
	check(math.max(p5, p12, p25) <= 1 + 1e-6, `{name}: a bone past its limit`)

	-- the same inputs, the same pose
	local a = Sway.newOut(rig.n)
	Sway.pose(rig, 9, 0.6, 0.8, 12.5, 3, 4, 11, nil, 2, profile, a)
	Sway.pose(rig, 9, 0.6, 0.8, 12.5, 3, 4, 11, nil, 2, profile, out)
	local same = true
	for i = 1, rig.n do
		same = same and a.x[i] == out.x[i] and a.y[i] == out.y[i] and a.z[i] == out.z[i]
	end
	check(same, `{name}: the pose is not deterministic`)
end

print(if fails == 0 then "test_sway: ok" else `test_sway: {fails} failed`)
if fails > 0 then
	error("failed", 0)
end
