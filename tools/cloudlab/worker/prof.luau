local fs = require("@lune/fs")
local serde = require("@lune/serde")
local CM = require("../../../roblox/Shared/CloudModel/CloudModel")
local EngineRun = require("../../../roblox/Shared/CloudModel/EngineRun")
local Nest = require("../../../roblox/Shared/CloudModel/Nest")
local T = {}
local cur = nil
for _, name in { "slow", "fast", "micro", "fill", "relaxEnvironment", "applyColdPool", "applyDrive", "followStorm" } do
	local f = CM[name]
	CM[name] = function(self, ...)
		local key = (if self.parent then "nest." else "box.") .. name
		local t0 = os.clock()
		local a, b = f(self, ...)
		T[key] = (T[key] or 0) + os.clock() - t0
		return a, b
	end
end
for _, name in { "feed", "recentre", "applyBoundary" } do
	local f = Nest[name]
	if f then Nest[name] = function(...) local t0 = os.clock(); local a = f(...); T["nest." .. name] = (T["nest." .. name] or 0) + os.clock() - t0; return a end end
end
EngineRun.NEST_START = 60
local text = fs.readFile("roblox/Shared/StormLab/Data/SupercellB.luau")
local run = EngineRun.fromScenario(serde.decode("json", string.match(text, "%[==%[(.*)%]==%]")), { nest = true })
while run.model.time < 120 do run:replayStep() end
T = {}
local t0 = os.clock()
while run.model.time < 420 do run:replayStep() end
local tot = os.clock() - t0
print(string.format("nz %d, nest %dx%d steps %d; %.0f ms/step", run.model.nz, run.nest.nx, run.nest.ny, run.nest.steps, tot * 1000 / 50))
local keys = {}
for k in T do table.insert(keys, k) end
table.sort(keys, function(a, b) return T[a] > T[b] end)
for _, k in keys do print(string.format("%-24s %5.1f%%", k, 100 * T[k] / tot)) end
