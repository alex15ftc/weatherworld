-- Where the time goes in a busy world (squall line after 30 sim min).
local Json = require("../../roblox/src/stormlab/shared/Sim/Json")
local World = require("../../roblox/src/stormlab/shared/Sim/World")
local mods = {
	Storm = require("../../roblox/src/stormlab/shared/Sim/Storm"),
	Systems = require("../../roblox/src/stormlab/shared/Sim/Systems"),
	Initiation = require("../../roblox/src/stormlab/shared/Sim/Initiation"),
	Boundaries = require("../../roblox/src/stormlab/shared/Sim/Boundaries"),
	Lightning = require("../../roblox/src/stormlab/shared/Sim/Lightning"),
	Tornado = require("../../roblox/src/stormlab/shared/Sim/Tornado"),
	Precip = require("../../roblox/src/stormlab/shared/Sim/Precip"),
	ColdPool = require("../../roblox/src/stormlab/shared/Sim/ColdPool"),
	Environment = require("../../roblox/src/stormlab/shared/Sim/Environment"),
	World = World,
}
local data = Json.decode(require("../../roblox/src/stormlab/data/SquallLine"))
local world = World.new(data)
world:spinUp(600)
for _ = 1, 1800 do world:step(1) end
local acc = {}
local skip = { windAt = true, deficitAt = true, sample = true, field = true, gradient = true, wprofAt = true, updraftRadiusAt = true, heading = true }
for mname, m in mods do
	for fname, f in m do
		if type(f) == "function" and not skip[fname] then
			local key = mname .. "." .. fname
			m[fname] = function(...)
				local t0 = os.clock()
				local a, b, c, d = f(...)
				acc[key] = (acc[key] or 0) + os.clock() - t0
				return a, b, c, d
			end
		end
	end
end
local t0 = os.clock()
for _ = 1, 300 do world:step(1) end
print(string.format("5 sim min in %.2f s, %d storms, %d parcels", os.clock() - t0, #world.storms, world.precip.n))
local list = {}
for k, v in acc do table.insert(list, { k, v }) end
table.sort(list, function(a, b) return a[2] > b[2] end)
for i = 1, math.min(18, #list) do print(string.format("%-32s %7.0f ms (inclusive)", list[i][1], list[i][2] * 1000)) end
