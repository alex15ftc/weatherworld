-- Weisman-Klemp supercell with a fine nest under its low-level rotation.
--   luau --codegen tools/cloudlab/nest.luau -a [minutes] [nestStartMin] [ratio] [nestCells] [z0] [hodoR] [hodoD]
local CloudModel = require("../../roblox/Shared/CloudModel/CloudModel")
local Sounding = require("../../roblox/Shared/CloudModel/Sounding")
local Nest = require("../../roblox/Shared/CloudModel/Nest")
local a = { ... }
local minutes = tonumber(a[1]) or 120
local start = tonumber(a[2]) or 50
local ratio = tonumber(a[3]) or 4
local ncell = tonumber(a[4]) or 48
local z0 = tonumber(a[5]) or 0.1
local hodoR = tonumber(a[6]) or 7
local hodoD = tonumber(a[7]) or 2000

local m = CloudModel.new({ nx = 64, ny = 64, dx = 1000, dzmin = 100, dzmax = 700, stretch = 1.12, ztop = 16000, dt = 6, cs = 150, K = 75, umove = 13.6, vmove = 2.1, z0 = z0, follow = false }, Sounding.wk82({ hodoR = hodoR, hodoD = hodoD }))
m:bubble(32000, 28800, 1400, 10000, 1400, 2)
local nest = nil
local t0 = os.clock()
local nextRep = 120
local tn = 0
while m.time < minutes * 60 do
	if not nest and m.time >= start * 60 then
		local i0, j0 = Nest.place(m, ncell, ratio)
		nest = Nest.new(m, { nx = ncell, ny = ncell, ratio = ratio, i0 = i0, j0 = j0 })
		print(string.format("nest %dx%d at %.0f m, parent cells %d-%d, %d-%d (storm at %s,%s)", ncell, ncell, nest.dx, i0, i0 + ncell // ratio - 1, j0, j0 + ncell // ratio - 1, tostring(m.stormI), tostring(m.stormJ)))
	end
	local c = os.clock()
	Nest.step(m, nest)
	if nest then
		tn += os.clock() - c
	end
	if m.time >= nextRep then
		nextRep += 120
		local line = string.format("t %5.1f min  UH %4.0f", m.time / 60, m.uhMax or 0)
		if nest then
			local d = Nest.diag(nest)
			line ..= string.format(" | nest zeta(50 m) %.3f /s at (%+.1f, %+.1f) km from centre  p' min %5.0f Pa  wind max %4.1f m/s  cloud base %4.0f lowest %4.0f m  nest at %d,%d", d.zeta, (d.i - nest.nx / 2) * nest.dx / 1000, (d.j - nest.ny / 2) * nest.dx / 1000, d.pmin, d.vmax, d.cloudBase, d.cloudLow, nest.i0, nest.j0)
		end
		print(line)
		local probe = m.w[m:idx(32, 32, 5)]
		if probe ~= probe or (nest and nest.w[nest:idx(10, 10, 5)] ~= nest.w[nest:idx(10, 10, 5)]) then
			print("NaN")
			break
		end
	end
end
print(string.format("wall %.0f s (nest part %.0f s)", os.clock() - t0, tn))
