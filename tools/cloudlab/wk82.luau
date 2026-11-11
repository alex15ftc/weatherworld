-- Weisman-Klemp (1982) supercell test for the cloud model: speed and physics check.
--   luau --codegen tools/cloudlab/wk82.luau -a [minutes] [nx] [dx] [dzmin] [dt] [z0] [follow 1/0] [hodoR] [hodoD] [hail 1/0] [n0h]
local CloudModel = require("../../roblox/Shared/CloudModel/CloudModel")
local Sounding = require("../../roblox/Shared/CloudModel/Sounding")
local a = { ... }
local minutes = tonumber(a[1]) or 30
local nx = tonumber(a[2]) or 64
local dx = tonumber(a[3]) or 1000
local dzmin = tonumber(a[4]) or 100
local dt = tonumber(a[5]) or 6
local z0 = tonumber(a[6]) or 0.1
local follow = (a[7] or "1") ~= "0"

local m = CloudModel.new({ nx = nx, ny = nx, dx = dx, dzmin = dzmin, dzmax = 700, stretch = 1.12, ztop = 16000, dt = dt, cs = 150, K = 75, umove = 13.6, vmove = 2.1, z0 = z0, follow = follow }, Sounding.wk82({ hodoR = tonumber(a[8]) or 7, hodoD = tonumber(a[9]) or 2000 }))
m.hail = (a[10] or "1") ~= "0"
m.n0h = tonumber(a[11]) or m.n0h
print(string.format("grid %dx%dx%d, dx %.0f m, dz %.0f-%.0f m, dt %.0f s, Cd %.4f; sfc theta %.1f qv %.1f g/kg", nx, nx, m.nz, dx, m.dzc[1], m.dzc[m.nz], dt, m.cd, m.th0[1], 1000 * m.qv0[1]))
local L = nx * dx
m:bubble(0.5 * L, 0.45 * L, 1400, 10000, 1400, 2)

local k0, k1, k5 = 1, m:levelAt(1000), m:levelAt(5000)

local function report()
	local wmax, wmin, rmax, dthmin, z0x, z1, z5 = 0, 0, 0, 0, 0, 0, 0
	local cores, hmax, ghmax = 0, 0, 0
	for k = 1, m.nz do for j = 1, nx do for i = 1, nx do ghmax = math.max(ghmax, m.qh[m:idx(i, j, k)]) end end end
	for k = 1, m.nz do
		for j = 1, nx do
			for i = 1, nx do
				local w = m.w[m:idx(i, j, k)]
				if w > wmax then wmax = w end
				if w < wmin then wmin = w end
			end
		end
	end
	for j = 2, nx do
		for i = 2, nx do
			local r = m.rainSfc[(j + 1) * m.SX + i + 2]
			if r > rmax then rmax = r end
			hmax = math.max(hmax, m.hailSfc[(j + 1) * m.SX + i + 2])
			local d = m.th[m:idx(i, j, 1)] - m.th0[1]
			if d < dthmin then dthmin = d end
			z0x = math.max(z0x, m:zeta(i, j, k0))
			z1 = math.max(z1, m:zeta(i, j, k1))
			z5 = math.max(z5, m:zeta(i, j, k5))
			local w = m.w[m:idx(i, j, k5)]
			if w > 10 and i < nx and j < nx then
				local peak = true
				for dj = -3, 3 do
					for di = -3, 3 do
						local ii, jj = math.clamp(i + di, 1, nx), math.clamp(j + dj, 1, nx)
						if m.w[m:idx(ii, jj, k5)] > w then peak = false end
					end
				end
				if peak then cores += 1 end
			end
		end
	end
	print(string.format("t %3.0f min shift %+3d,%+3d storm %s UH %4.0f | w %5.1f / %5.1f  rain %4.0f mm/h  pool %5.1f K | zeta max %3.0fm %.4f  1km %.4f  5km %.4f | cores %d | hail sfc %3.0f mm/h, max qh %.1f g/kg",
		m.time / 60, m.ox, m.oy, if m.stormI then string.format("(%2d,%2d)", m.stormI, m.stormJ) else "  -    ", m.uhMax or 0, wmax, wmin, rmax, dthmin, m.zc[1], z0x, z1, z5, cores, hmax, 1000 * ghmax))
end

local t0 = os.clock()
local steps = 0
local nextRep = 5 * 60
while m.time < minutes * 60 do
	m:step()
	steps += 1
	if m.time >= nextRep then
		report()
		nextRep += 5 * 60
	end
	local probe = m.w[m:idx(nx // 2, nx // 2, 5)]
	if probe ~= probe then
		print("NaN at", m.time)
		break
	end
end
local el = os.clock() - t0
print(string.format("%d steps in %.1f s: %.0f ms/step, %.1f model s per wall s", steps, el, 1000 * el / steps, steps * dt / el))
