-- Times each part of one World step.  luau tools/stormlab/profile_world.luau
local Json = require("../../roblox/src/stormlab/shared/Sim/Json")
local World = require("../../roblox/src/stormlab/shared/Sim/World")
local Systems = require("../../roblox/src/stormlab/shared/Sim/Systems")
local Initiation = require("../../roblox/src/stormlab/shared/Sim/Initiation")
local Boundaries = require("../../roblox/src/stormlab/shared/Sim/Boundaries")
local Storm = require("../../roblox/src/stormlab/shared/Sim/Storm")
local data = Json.decode(require("../../roblox/src/stormlab/data/Supercell"))
local function time(label, f)
	local t0 = os.clock(); f(); print(string.format("%-28s %8.1f ms", label, (os.clock() - t0) * 1000))
end
local world
time("World.new", function() world = World.new(data) end)
time("updateSurface", function() world:updateSurface() end)
time("storm step x1 (all)", function() for _, s in world.storms do Storm.step(s, 2, world) end end)
time("storm environment (all)", function() for _, s in world.storms do Storm.environment(s, world) end end)
time("emit precip 60 s", function() for _, s in world.storms do Storm.emitPrecip(s, 60, world) end end)
print("parcels", world.precip.n)
local function air(x, y, z) return world:windAt(x, y, z, true) end
local function base(x, y) return world:cloudBaseAt(x, y) end
time("precip step", function() world.precip:step(5, air, base) end)
time("windAt x10000", function() for i = 1, 10000 do world:windAt(i, i, 1000, true) end end)
time("bin", function() world.precip:bin() end)
time("coldPool step", function() world.coldPool:step(20, function() return 5, 5 end, 5400) end)
time("env step", function() world.env:step(60) end)
time("env analyse(6)", function() world.env:analyse(6) end)
time("systems", function() Systems.analyse(world.systems, world, 30) end)
time("initiation", function() Initiation.run(world, 60) end)
time("boundaries", function() Boundaries.analyse(world, world.boundaries, 120) end)
