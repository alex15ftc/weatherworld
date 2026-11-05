-- The cloud model following an engine storm through its life (EngineRun, the same code the game
-- will run): an engine scenario (scripts/export-lab-scenario.mjs) replayed as engine updates every
-- 5 minutes of its track, the model's storm printed next to the engine's every 15 min.
--   luau --codegen tools/cloudlab/engine_storm.luau -a [scenario] [minutes] [nest 0/1] [lift m/s]
--       [lift radius m] [env 0/1] [cold 0/1] [tornado lift m/s, 0 = off] [lift at: inflow / box] [n0h] [autoToIce 0/1]
local EngineRun = require("../../roblox/src/cloudlab/shared/Model/EngineRun")
local Nest = require("../../roblox/src/cloudlab/shared/Model/Nest")
local decode = require("./json")
local a = { ... }
local name = a[1] or "SupercellLife"
local minutes = tonumber(a[2]) or 300
local data = decode((require :: any)("../../roblox/src/stormlab/data/" .. name))
local opts = {
	nest = a[3] == "1", lift = tonumber(a[4]), liftR = tonumber(a[5]), env = (a[6] or "1") ~= "0",
	cold = (a[7] or "1") ~= "0", torLift = tonumber(a[8]), liftAt = a[9], n0h = tonumber(a[10]), autoToIce = a[11] == "1",
}
local run = EngineRun.fromScenario(data, opts)
local focus, storm = data.meta.focusStorm, run.scenario.storm
local m = run.model
print(string.format("%s storm %s age %d min; lift %.0f m/s r %.0f m; env %s cold %s tornado lift %.0f nest %s",
	name, focus, storm.ageMin, run.lift, run.liftR, tostring(run.useEnv), tostring(run.useCold), run.torLift, tostring(run.useNest)))
local k1, k5, k9 = m:levelAt(1000), m:levelAt(5000), m:levelAt(9000)
local nextRep = 15 * 60
local t0 = os.clock()
while m.time < minutes * 60 do
	run:replayStep()
	if m.time >= nextRep then
		nextRep += 15 * 60
		local wmax, pool, z0, z1, rmax, hmax = 0, 0, 0, 0, 0, 0
		local anvil, snMax, rTot, hTot = 0, 0, 0, 0
		for j = 1, m.ny do
			for i = 1, m.nx do
				if m.qsn[m:idx(i, j, k9)] + m.qc[m:idx(i, j, k9)] > 1e-4 then anvil += 1 end
				for k = 1, m.nz do snMax = math.max(snMax, m.qsn[m:idx(i, j, k)]) end
				rTot += m.rainSfc[(j + 1) * m.SX + i + 2]
				hTot += m.hailSfc[(j + 1) * m.SX + i + 2]
			end
		end
		for j = 2, m.ny - 1 do
			for i = 2, m.nx - 1 do
				wmax = math.max(wmax, m.w[m:idx(i, j, k5)])
				pool = math.min(pool, m.th[m:idx(i, j, 1)] - m.th0[1])
				z0 = math.max(z0, m:zeta(i, j, 1))
				z1 = math.max(z1, m:zeta(i, j, k1))
				rmax = math.max(rmax, m.rainSfc[(j + 1) * m.SX + i + 2])
				hmax = math.max(hmax, m.hailSfc[(j + 1) * m.SX + i + 2])
			end
		end
		local line = string.format("lift (%2.0f,%2.0f) km t %3d | w5 %4.1f UH %4.0f pool min %5.1f mean %4.1f K z50m %.3f z1k %.3f rain %4.0f hail %4.0f shift %d,%d",
			run.lx / 1000, run.ly / 1000, m.time // 60, wmax, m.uhMax or 0, pool, run.coldMean, z0, z1, rmax, hmax, m.ox, m.oy)
		if run.nest then
			local d = Nest.diag(run.nest)
			line ..= string.format(" | 250m z %.3f wind %.0f", d.zeta, d.vmax)
		end
		line ..= string.format(" | anvil %d km2 snow max %.1f g/kg hail share %.0f%%", anvil, 1000 * snMax, if rTot > 0 then 100 * hTot / rTot else 0)
		local e = run:trackNow()
		line ..= string.format(" || E +%d: int %.2f meso %.2f cpK %.1f%s", e.min, e.intensity, e.meso, e.coldPoolK or 0, if e.tornado then string.format(" TOR %d", e.tornado.mph) else "")
		print(line)
	end
end
print(string.format("wall %.0f s", os.clock() - t0))
