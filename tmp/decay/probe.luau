local Noise = require("./src/shared/Sim/Noise")
local r = Noise.rng(5150)
local t = {}
for i = 1, 8 do table.insert(t, string.format("%.3f", r:next())) end
print(table.concat(t, " "))
