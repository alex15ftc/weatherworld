-- Dumps a mature box state and the Luau slow() tendencies on it, and times slow(): the reference
-- for native ports of the kernel (tools/cloudlab/native).
--   lune run tools/cloudlab/native/dump_slow.luau <out dir> [scenario] [minutes]
local fs = require("@lune/fs")
local serde = require("@lune/serde")
local process = require("@lune/process")
local EngineRun = require("../../../roblox/src/cloudlab/shared/Model/EngineRun")
local a = process.args
local out, name, minutes = a[1], a[2] or "SupercellB", tonumber(a[3]) or 40
local data = serde.decode("json", string.match(fs.readFile("roblox/src/stormlab/data/" .. name .. ".luau"), "%[==%[(.*)%]==%]"))
local run = EngineRun.fromScenario(data, { nest = false })
local m = run.model
while m.time < minutes * 60 do
	run:replayStep()
end
m:slow() -- (warm: the tendencies a slow() call starts from)
local t0 = os.clock()
local REPS = 20
for _ = 1, REPS do
	m:slow()
end
local ms = 1000 * (os.clock() - t0) / REPS
local function dumpGrid(names)
	for _, f in names do
		local t = m[f]
		local b = buffer.create(m.N * 8)
		for n = 1, m.N do
			buffer.writef64(b, (n - 1) * 8, t[n])
		end
		fs.writeFile(out .. "/" .. f .. ".bin", buffer.tostring(b))
	end
end
local function dumpLevels(names)
	for _, f in names do
		local t = m[f]
		local b = buffer.create((m.nz + 5) * 8)
		for k = -1, m.nz + 3 do
			buffer.writef64(b, (k + 1) * 8, t[k] or 0)
		end
		fs.writeFile(out .. "/" .. f .. ".lev", buffer.tostring(b))
	end
end
dumpGrid({ "u", "v", "w", "th", "qv", "qc", "qr", "qh", "qsn", "Ru", "Rv", "Rw", "Rth", "Rqv", "Rqc", "Rqr", "Rqh", "Rqsn", "B" })
dumpLevels({ "th0", "qv0", "u0", "v0", "zc", "zf", "dzc", "dzw", "lapTh", "lapQv", "lapU", "lapV" })
fs.writeFile(out .. "/meta.json", serde.encode("json", {
	nx = m.nx, ny = m.ny, nz = m.nz, SX = m.SX, SXY = m.SXY, N = m.N, dx = m.dx, K = m.K, Kh = m.Kh,
	zdamp = m.zdamp, ztop = m.ztop, umove = m.umove, vmove = m.vmove, cd = m.cd, luauMs = ms, time = m.time,
}))
print(string.format("dumped at %.0f min; Luau slow() %.1f ms", m.time / 60, ms))
