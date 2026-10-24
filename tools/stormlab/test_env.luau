-- Offline check: the lab's Thermo/Environment against the engine's own diagnostics.
--   luau tools/stormlab/test_env.luau
local Json = require("../../roblox/src/stormlab/shared/Sim/Json")
local Environment = require("../../roblox/src/stormlab/shared/Sim/Environment")
local Thermo = require("../../roblox/src/stormlab/shared/Sim/Thermo")
local data = Json.decode(require("../../roblox/src/stormlab/data/Supercell"))
local t0 = os.clock()
local env = Environment.new(data)
print(string.format("built in %.0f ms", (os.clock() - t0) * 1000))
t0 = os.clock()
env:analyse()
print(string.format("analysed %d cells in %.0f ms", env.analysed, (os.clock() - t0) * 1000))
for _, c in data.cells do
	if (c.i == 0 and c.j == 0) or (c.i == -4 and c.j == 3) or (c.i == 5 and c.j == -5) then
		local a = Thermo.analyse(env:profileAt(c.pos[1], c.pos[2]))
		local e = c.engine
		print(string.format("cell %d,%d  SBCAPE %d/%d  MLCAPE %d/%d  MLCIN %d/%d  LCL %d/%d  SRH01 %d/%d  SRH03 %d/%d  S06 %.1f/%.1f  PW %.1f/%.1f  STP %.2f/%.2f",
			c.i, c.j, a.sb.cape, e.sbcape, a.ml.cape, e.mlcape, a.ml.cin, e.mlcin, a.ml.lclZ, e.lclAgl, a.srh01, e.srh01, a.srh03, e.srh03, a.shear06, e.shear06, a.pw, e.pwMm, a.stp, e.stp))
		print("   right mover", string.format("%.1f %.1f", a.rightU, a.rightV), "fz", math.floor(a.freezingZ), "el", a.mu.elZ)
	end
end
print(env:describe(0, 0))
