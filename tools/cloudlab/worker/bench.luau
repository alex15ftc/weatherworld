-- Speed of the cloud model under Lune (the worker's runtime), with a checksum of the fields so a
-- code speed-up can be checked to give the same storm.
--   lune run tools/cloudlab/worker/bench.luau [scenario] [model minutes] [nest 0/1] [nest start min] [time from min] [nest process 0/1]
local fs = require("@lune/fs")
local serde = require("@lune/serde")
local process = require("@lune/process")
local EngineRun = require("../../../roblox/Shared/CloudModel/EngineRun")
local a = process.args
local name, minutes, nest = a[1] or "SupercellB", tonumber(a[2]) or 10, a[3] == "1"
EngineRun.NEST_START = (tonumber(a[4]) or 30) * 60
local text = fs.readFile("roblox/Shared/StormLab/Data/" .. name .. ".luau")
local json = string.match(text, "%[==%[(.*)%]==%]")
local run = EngineRun.fromScenario(serde.decode("json", json), { nest = nest })
local m = run.model
local link = nil
if a[6] == "1" then
	link = require("./nestlink").start(8890, run.initRecord, run.initOpts)
	run.nestLink = link
end
while m.time < (tonumber(a[5]) or 0) * 60 do run:replayStep() end
local t0, steps, tstart = os.clock(), 0, m.time
local ok, err = pcall(function()
	while m.time < minutes * 60 do
		run:replayStep()
		steps += 1
	end
end)
if not ok then
	print("failed: " .. tostring(err))
	if link then
		link:stop()
	end
	return
end
local el = os.clock() - t0
local function sum(x)
	local s, z = 0, 0
	for _, f in { "u", "v", "w", "th", "qv", "qc", "qr", "qh", "qsn", "p" } do
		local t = x[f]
		for i = 1, x.N do
			s += t[i] * (1 + (i % 7))
			if f == "qr" and t[i] == 0 then z += 1 end
		end
	end
	return s, z / x.N
end
local s, z = sum(m)
print(string.format("%s %d min, nest %s: %d steps in %.1f s -> %.1fx real time (%.0f ms/step)", name, minutes, tostring(nest), steps, el, (minutes * 60 - tstart) / el, 1000 * el / steps))
print(string.format("box checksum %.10e, qr exactly zero in %.0f%% of cells", s, 100 * z))
if run.nest then
	local s2, z2 = sum(run.nest)
	print(string.format("nest checksum %.10e, qr zero %.0f%%", s2, 100 * z2))
end
local d = if run.nest then require("../../../roblox/Shared/CloudModel/Nest").diag(run.nest) elseif run.nestInfo then run.nestInfo.diag else nil
if d then
	print(string.format("nest: zeta %.4f /s, pressure drop %.0f Pa, wind %.1f m/s, cloud base %.0f m; box UH %.0f", d.zeta, d.pdrop, d.vmax, d.cloudBase, m.uhMax or 0))
end
if link then
	link:stop()
end
