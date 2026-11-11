-- One process versus the nest on its own process, stepped side by side from the same start:
-- per minute, the box's strongest updraft and 1 km rotation and the nest's vortex in each.
--   lune run tools/cloudlab/worker/compare.luau [scenario] [model minutes] [nest start min]
local fs = require("@lune/fs")
local serde = require("@lune/serde")
local process = require("@lune/process")
local EngineRun = require("../../../roblox/Shared/CloudModel/EngineRun")
local Nest = require("../../../roblox/Shared/CloudModel/Nest")
local NestLink = require("./nestlink")
local a = process.args
local name, minutes = a[1] or "SupercellB", tonumber(a[2]) or 12
EngineRun.NEST_START = (tonumber(a[3]) or 6) * 60
local data = serde.decode("json", string.match(fs.readFile("roblox/Shared/StormLab/Data/" .. name .. ".luau"), "%[==%[(.*)%]==%]"))
local A = EngineRun.fromScenario(data, { nest = true })
local B = EngineRun.fromScenario(data, { nest = true })
require("../../../roblox/Shared/CloudModel/NestRemote").GAIN = tonumber(a[4]) or 1
local link = NestLink.start(8891, B.initRecord, B.initOpts)
B.nestLink = link
local function stats(m)
	local wmax, bad, at = 0, 0, 0
	for n = 1, m.N do
		local w = m.w[n]
		if w ~= w then
			bad += 1
		elseif math.abs(w) > wmax then
			wmax, at = math.abs(w), n
		end
	end
	local k = (at - 1) // m.SXY - 1
	local r = (at - 1) % m.SXY
	return wmax, bad, string.format("(%d,%d,%d)", r % m.SX - 1, r // m.SX - 1, k)
end
local ok, err = pcall(function()
	while A.model.time < minutes * 60 do
		A:replayStep()
		B:replayStep()
		local t = A.model.time
		if t % 60 == 0 or false then
			local wa, ba, pa = stats(A.model)
			local wb, bb, pb = stats(B.model)
			local da = if A.nest then Nest.diag(A.nest) else nil
			local db = if B.nestInfo then B.nestInfo.diag else nil
			print(pa, pb, B.nestInfo and string.format("feed I %d-%d J %d-%d", B.nestInfo.I1, B.nestInfo.I2, B.nestInfo.J1, B.nestInfo.J2) or "")
			print(string.format("%5.1f min | w max %5.1f / %5.1f  NaN %d / %d | ox %d/%d oy %d/%d | nest zeta %s / %s  i0 %s/%s", t / 60, wa, wb, ba, bb, A.model.ox, B.model.ox, A.model.oy, B.model.oy,
				if da then string.format("%.4f", da.zeta) else "-", if db and db.zeta then string.format("%.4f", db.zeta) else "-",
				if A.nest then tostring(A.nest.i0) else "-", if B.remote then tostring(B.remote.i0) else "-"))
			local ja, jb = A.model.feedJump or {}, B.model.feedJump or {}
			print(string.format("        jumps u %.2f/%.2f  w %.2f/%.2f  th %.2f/%.2f  qv %.5f/%.5f", ja.u or 0, jb.u or 0, ja.w or 0, jb.w or 0, ja.th or 0, jb.th or 0, ja.qv or 0, jb.qv or 0))
			if bb > 0 then
				error("NaN in B")
			end
		end
	end
end)
if not ok then
	print(err)
end
link:stop()
