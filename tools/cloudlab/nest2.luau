-- Weisman-Klemp supercell with two nests: 250 m under the low-level rotation, 62.5 m inside it.
--   luau --codegen tools/cloudlab/nest2.luau -a [minutes] [nest1StartMin] [nest2StartMin; negative = start when the 250 m 50 m vorticity reaches -value] [nest1Steps] [nest2Cells] [nest2Steps] [hodoR] [hodoD] [kvScale 1] [dzmin] [feedback 0 = one-way]
local CloudModel = require("../../roblox/src/cloudlab/shared/Model/CloudModel")
local Sounding = require("../../roblox/src/cloudlab/shared/Model/Sounding")
local Nest = require("../../roblox/src/cloudlab/shared/Model/Nest")
local a = { ... }
local minutes = tonumber(a[1]) or 105
local start1 = tonumber(a[2]) or 50
local start2 = tonumber(a[3]) or 75
local steps = tonumber(a[4]) or 2
local steps2 = tonumber(a[6]) or 4
local c2 = tonumber(a[5]) or 32
local kvScale = a[9] == "1" -- nests mix vertically in proportion to their spacing too
local dzmin = tonumber(a[10]) or 100
local feedback = a[11] ~= "0"
local snd = Sounding.wk82({ hodoR = tonumber(a[7]) or 7, hodoD = tonumber(a[8]) or 2000 })
local um, vm = 13.6, 2.1
if tonumber(a[7]) then -- ("-" keeps the measured WK82 frame)
	um, vm = Sounding.bunkers(snd)
end
print(string.format("frame motion (%.1f, %.1f) m/s", um, vm))

local m = CloudModel.new({ nx = 64, ny = 64, dx = 1000, dzmin = dzmin, dzmax = 700, stretch = 1.12, ztop = 16000, dt = 6, cs = 150, K = 75, umove = um, vmove = vm, z0 = 0.1, follow = false }, snd)
m:bubble(32000, 28800, 1400, 10000, 1400, 2)
local n1, n2 = nil, nil
local t0 = os.clock()
local nextRep = 120
local function line(tag: string, n: any): string
	local d = Nest.diag(n)
	return string.format("%s zeta %.3f drop %4.0f Pa th' %+.1f wind %4.1f cloud low %4.0f base %4.0f at (%+.1f,%+.1f) km", tag, d.zeta, d.pdrop, d.thv, d.vmax, d.cloudLow, d.cloudBase, (d.i - n.nx / 2) * n.dx / 1000, (d.j - n.ny / 2) * n.dx / 1000)
end
while m.time < minutes * 60 do
	if not n1 and m.time >= start1 * 60 then
		print(string.format("levels %d, lowest %.0f m thick, Cd %.4f", m.nz, m.dzc[1], m.cd))
		local i0, j0 = Nest.place(m, 48, 4)
		n1 = Nest.new(m, { nx = 48, ny = 48, ratio = 4, steps = steps, i0 = i0, j0 = j0, K = if kvScale then m.K / 4 else nil, feedback = feedback })
		print("nest 1 at", i0, j0, "Kh", n1.Kh)
	end
	local d1 = if n1 and not n2 then Nest.diag(n1) else nil
	if d1 and (if start2 < 0 then d1.zeta >= -start2 else m.time >= start2 * 60) then
		local d = Nest.diag(n1)
		-- centred on nest 1's strongest 50 m vortex
		local h = c2 // 8
		local i0 = math.clamp(d.i - h + 1, 3, n1.nx - 2 * h - 2)
		local j0 = math.clamp(d.j - h + 1, 3, n1.ny - 2 * h - 2)
		n2 = Nest.new(n1, { nx = c2, ny = c2, ratio = 4, steps = steps2, i0 = i0, j0 = j0, vortex = 0.03, K = if kvScale then n1.K / 4 else nil, feedback = feedback })
		print("nest 2 at", i0, j0, "dx", n2.dx, "Kh", n2.Kh, "dt", n2.dt)
		nextRep = m.time + 60
	end
	Nest.step(m, n1)
	if m.time >= nextRep then
		nextRep += if n2 then 60 else 120
		local s = string.format("t %5.1f  UH %4.0f", m.time / 60, m.uhMax or 0)
		if n1 then
			-- the low-level mesocyclone: strongest 3x3-smoothed vorticity at 1 km in the 250 m nest
			local k1, z1 = n1:levelAt(1000), 0
			for j = 3, n1.ny - 2 do
				for i = 3, n1.nx - 2 do
					local q = 0
					for dj = -1, 1 do for di = -1, 1 do q += n1:zeta(i + di, j + dj, k1) end end
					z1 = math.max(z1, q / 9)
				end
			end
			s ..= string.format(" | meso 1km %.3f", z1) .. " | " .. line("250m", n1)
		end
		if n2 then s ..= " | " .. line("62m", n2) .. string.format(" n2@%d,%d", n2.i0, n2.j0) end
		print(s)
		local w = (n2 or n1 or m).w
		if w[(n2 or n1 or m):idx(10, 10, 5)] ~= w[(n2 or n1 or m):idx(10, 10, 5)] then print("NaN") break end
	end
end
print(string.format("wall %.0f s", os.clock() - t0))
