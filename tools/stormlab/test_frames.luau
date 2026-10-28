-- Storm frames v2 (roblox/src/stormlab/shared/Sim/Frames.luau): the lab's own output must meet
-- the contract, and frames must survive encoding (buffers as base64) unchanged.
--   luau --codegen tools/stormlab/test_frames.luau
local Json = require("../../roblox/src/stormlab/shared/Sim/Json")
local World = require("../../roblox/src/stormlab/shared/Sim/World")
local Frames = require("../../roblox/src/stormlab/shared/Sim/Frames")

local fails = 0
local function check(ok: boolean, what: string)
	if not ok then
		fails += 1
		print("FAIL " .. what)
	end
end

-- base64 round trip, every length mod 3
for n = 0, 40 do
	local b = buffer.create(n)
	for i = 0, n - 1 do
		buffer.writeu8(b, i, (i * 37 + n) % 256)
	end
	local back = Frames.fromBase64(Frames.toBase64(b))
	check(buffer.len(back) == n and buffer.tostring(back) == buffer.tostring(b), "base64 length " .. n)
end

-- the lab's frames meet the contract
local data = Json.decode(require("../../roblox/src/stormlab/data/Supercell"))
local world = World.new(data)
world:spinUp(600)
for _ = 1, 60 do
	world:step(5)
end
local kinds = {
	{ "state", { world:snapshot(), { timeScale = 1 } } },
	{ "profiles", { world:profileSnapshot({}) } },
	{ "tornado", { world:tornadoSnapshot(), world.time } },
	{ "coldPool", { world:packColdPool() } },
	{ "precip", { world.precip:pack() } },
	{ "precipLite", { world.precip:packLite() } },
}
for _, k in kinds do
	local problems = Frames.check(k[1], k[2])
	check(#problems == 0, k[1] .. " meets the contract: " .. table.concat(problems, ", "))
	-- encode / decode keeps buffers byte for byte
	local kind, t, args = Frames.decode(Frames.encode(k[1], world.time, k[2]))
	check(kind == k[1] and t == world.time, k[1] .. " kind and time")
	for i, v in k[2] do
		if typeof(v) == "buffer" then
			check(buffer.tostring(args[i]) == buffer.tostring(v), k[1] .. " buffer " .. i)
		end
	end
end
-- the light rain frame: much smaller, the same surface rain and hail, a usable profile
do
	local Precip = require("../../roblox/src/stormlab/shared/Sim/Precip")
	local full = Precip.unpack(world.precip:pack(), world.env.extent)
	local liteB = world.precip:packLite()
	local lite = Precip.unpackLite(liteB, world.env.extent)
	local n, same, worst = 0, 0, 0
	for col, rr in full.rain do
		n += 1
		local r2 = lite.rain[col] or 0
		if math.abs(r2 - rr) < 1e-6 and math.abs((lite.hail[col] or 0) - (full.hail[col] or 0)) < 1e-6 then
			same += 1
		end
	end
	-- the low-level reflectivity where it rains hard, full vs light
	local cmp, diff = 0, 0
	for col, rr in full.rain do
		if rr > 10 then
			local x = full.x0 + (col % full.nxv + 0.5) * Precip.VOX
			local y = full.x0 + (col // full.nxv + 0.5) * Precip.VOX
			local a = full:sample(x, y, 1500)
			local b = lite:sample(x, y, 1500)
			if a > -100 and b > -100 then
				cmp += 1
				diff += math.abs(a - b)
				worst = math.max(worst, math.abs(a - b))
			end
		end
	end
	check(same == n, string.format("light rain keeps surface rain and hail (%d of %d columns)", same, n))
	check(buffer.len(liteB) < buffer.len(world.precip:pack()) / 3, "light rain is under a third of the full volume")
	print(string.format("precip: full %d bytes, light %d bytes (%.0f%%); 1.5 km dBZ where rain > 10 mm/h: mean diff %.1f dB, worst %.1f (%d columns)",
		buffer.len(world.precip:pack()), buffer.len(liteB), 100 * buffer.len(liteB) / buffer.len(world.precip:pack()),
		if cmp > 0 then diff / cmp else 0, worst, cmp))
end
-- a broken storm is caught
local bad = world:snapshot()
if bad.storms[1] then
	bad.storms[1].vmid = nil
	bad.storms[1].dead = nil
	check(#Frames.check("state", { bad }) > 0, "a storm without vmid is reported")
end
print(string.format("frames: %d storms, %d tornadoes, precip %d bytes · %s", #world.storms, #world.tornadoes,
	buffer.len(world.precip:pack()), if fails == 0 then "all passed" else fails .. " failed"))
