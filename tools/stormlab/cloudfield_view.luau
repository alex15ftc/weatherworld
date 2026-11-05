-- Offline look at CloudField (docs/stormlab/PHYSICAL-VOLUME-PLAN.md, phase 1): a lab scene's cloud
-- round its tornado, ray-marched from several cameras (Beer-Lambert, sun with shadows, sky light,
-- ground), plus a vertical slice. No Studio needed.
--   cd roblox && luau --codegen ../tools/stormlab/cloudfield_view.luau -a <sceneId> [step m] > out.txt
--   python tools/stormlab/cloudfield_png.py out.txt <prefix>
-- Prints "IMG name w h" then h rows of hex RGB.
local Json = require("../../roblox/src/stormlab/shared/Sim/Json")
local World = require("../../roblox/src/stormlab/shared/Sim/World")
local Vortex = require("../../roblox/src/stormlab/shared/Sim/Vortex")
local CloudField = require("../../roblox/src/stormlab/shared/Sim/CloudField")
local VisualTests = require("../../roblox/src/stormlab/shared/VisualTests")
local args = { ... }
local sceneId = args[1] or "wedge_rain"
local STEP = tonumber(args[2] or "") or 40
local data = Json.decode(require("../../roblox/src/stormlab/data/Supercell"))
local world = World.new(data)
local scene
for _, sc in VisualTests.SCENES do
	if sc.id == sceneId then
		scene = sc
	end
end
assert(scene, "no scene " .. sceneId)
local t = world:labScene(scene, VisualTests.SITE)
assert(t, "scene made no tornado")
local storm
for _, s in world.storms do
	if tostring(s.id) == tostring(t.parentId) then
		storm = s
	end
end
assert(storm, "no parent storm")
local p = t.params or Vortex.params(t)
t.params = p
local function log(...)
	print("#", string.format(...))
end
log("scene %s: tornado vc %.1f rc %.0f base %.0f coreZb %.0f | storm base %.0f wallBase %.0f lowMixL %s vlow %.1f Ru %.0f gammaL %s",
	sceneId, t.vc, t.rc, t.cloudBase, Vortex.coreBase(p), storm.base, storm.wallBase or -1, tostring(storm.lowMixL), storm.vlow, storm.Ru, tostring(storm.gammaL))

-- the grid round the tornado
local HX = math.max(3000, 1.2 * storm.Ru)
local ZT = storm.base + 1500
local nx = math.floor(2 * HX / STEP) + 1
local nz = math.floor(ZT / STEP) + 1
local X0, Y0 = t.x - HX, t.y - HX
local N = nx * nx * nz
local SIG = table.create(N, 0)
local function idx(i: number, j: number, k: number): number
	return i + (j - 1) * nx + (k - 1) * nx * nx
end
local c0 = os.clock()
for k = 1, nz do
	local z = (k - 1) * STEP
	for j = 1, nx do
		local y = Y0 + (j - 1) * STEP
		for i = 1, nx do
			local x = X0 + (i - 1) * STEP
			local q, ice = CloudField.storm(storm, t, x, y, z)
			SIG[idx(i, j, k)] = CloudField.sigmaOf(q, ice)
		end
	end
end
log("grid %dx%dx%d (%d samples) in %.1f s: %.2f us/sample", nx, nx, nz, N, os.clock() - c0, (os.clock() - c0) / N * 1e6)

-- the funnel's width the field gives against Vortex.condensationRadius
for _, z in { 20, 100, 200, 300, 400 } do
	if z < t.cloudBase then
		local ax, ay = Vortex.axisAt(p, z)
		local rEdge = 0
		for r = 0, 3000, 2 do
			local q = CloudField.storm(storm, t, t.x + ax + r, t.y + ay, z)
			if q <= 0 then
				break
			end
			rEdge = r
		end
		log("z %4d: funnel edge %4.0f m (Vortex.condensationRadius %4.0f)", z, rEdge, Vortex.condensationRadius(p, z))
	end
end

local function sample(x: number, y: number, z: number): number
	local fi, fj, fk = (x - X0) / STEP + 1, (y - Y0) / STEP + 1, z / STEP + 1
	if fi < 1 or fj < 1 or fk < 1 or fi >= nx or fj >= nx or fk >= nz then
		return 0
	end
	local i, j, k = math.floor(fi), math.floor(fj), math.floor(fk)
	local a, b, c = fi - i, fj - j, fk - k
	local function at(di, dj, dk)
		return SIG[idx(i + di, j + dj, k + dk)]
	end
	local c00 = at(0, 0, 0) * (1 - a) + at(1, 0, 0) * a
	local c10 = at(0, 1, 0) * (1 - a) + at(1, 1, 0) * a
	local c01 = at(0, 0, 1) * (1 - a) + at(1, 0, 1) * a
	local c11 = at(0, 1, 1) * (1 - a) + at(1, 1, 1) * a
	return (c00 * (1 - b) + c10 * b) * (1 - c) + (c01 * (1 - b) + c11 * b) * c
end

-- sun from the WSW, 30 deg up (afternoon)
local SAZ, SEL = math.rad(250), math.rad(30)
local sx, sy, sz = math.sin(SAZ) * math.cos(SEL), math.cos(SAZ) * math.cos(SEL), math.sin(SEL)
-- light: the sun's transmittance at a coarser grid, and sky light from the optical depth upward
-- and along 4 horizontal headings (prefix sums)
local LS = 2
local lnx, lnz = math.floor((nx - 1) / LS) + 1, math.floor((nz - 1) / LS) + 1
local TS = table.create(lnx * lnx * lnz, 1)
local SKY = table.create(lnx * lnx * lnz, 1)
local function lidx(i, j, k)
	return i + (j - 1) * lnx + (k - 1) * lnx * lnx
end
local DS = STEP * 1.5
for k = 1, lnz do
	for j = 1, lnx do
		for i = 1, lnx do
			local x, y, z = X0 + (i - 1) * LS * STEP, Y0 + (j - 1) * LS * STEP, (k - 1) * LS * STEP
			local tau = 0
			local px, py, pz = x, y, z
			for _ = 1, 400 do
				px += sx * DS
				py += sy * DS
				pz += sz * DS
				if pz > ZT or px < X0 or py < Y0 or px > X0 + 2 * HX or py > Y0 + 2 * HX then
					break
				end
				tau += sample(px, py, pz) * DS
				if tau > 12 then
					break
				end
			end
			-- (above the grid: the storm's cloud over the base - the tower shades what is under it)
			if pz >= ZT then
				local q = CloudField.storm(storm, t, px, py, ZT + 200)
				tau += CloudField.sigmaOf(q, 0) * 3000
			end
			TS[lidx(i, j, k)] = math.exp(-tau)
			local tsk = 0
			for _, d in { { 0, 0, 1 }, { 0.7, 0, 0.7 }, { -0.7, 0, 0.7 }, { 0, 0.7, 0.7 }, { 0, -0.7, 0.7 } } do
				local ta = 0
				px, py, pz = x, y, z
				for _ = 1, 200 do
					px += d[1] * DS * 2
					py += d[2] * DS * 2
					pz += d[3] * DS * 2
					if pz > ZT or px < X0 or py < Y0 or px > X0 + 2 * HX or py > Y0 + 2 * HX then
						break
					end
					ta += sample(px, py, pz) * DS * 2
					if ta > 10 then
						break
					end
				end
				if pz >= ZT then
					local q = CloudField.storm(storm, t, px, py, ZT + 200)
					ta += CloudField.sigmaOf(q, 0) * 3000
				end
				tsk += math.exp(-ta)
			end
			SKY[lidx(i, j, k)] = tsk / 5
		end
	end
end
log("light grids in %.1f s", os.clock() - c0)
local function light(x, y, z)
	local fi, fj, fk = (x - X0) / (LS * STEP) + 1, (y - Y0) / (LS * STEP) + 1, z / (LS * STEP) + 1
	local i = math.clamp(math.floor(fi + 0.5), 1, lnx)
	local j = math.clamp(math.floor(fj + 0.5), 1, lnx)
	local k = math.clamp(math.floor(fk + 0.5), 1, lnz)
	local l = lidx(i, j, k)
	return TS[l], SKY[l]
end

local SUN = { 1.0, 0.95, 0.85 }
local SKYC = { 0.45, 0.55, 0.7 }
local W, H = 240, 150
local function render(name: string, ex: number, ey: number, ez: number, tx: number, ty: number, tz: number, fov: number)
	local fx, fy, fz = tx - ex, ty - ey, tz - ez
	local fl = math.sqrt(fx * fx + fy * fy + fz * fz)
	fx, fy, fz = fx / fl, fy / fl, fz / fl
	local rx, ry, rz = fy, -fx, 0
	local rl = math.sqrt(rx * rx + ry * ry)
	rx, ry = rx / rl, ry / rl
	local ux, uy, uz = ry * fz - rz * fy, rz * fx - rx * fz, rx * fy - ry * fx
	local th = math.tan(math.rad(fov) / 2)
	print(string.format("IMG %s %d %d", name, W, H))
	for py = 1, H do
		local row = table.create(W)
		for px = 1, W do
			local a = (2 * (px - 0.5) / W - 1) * th
			local b = (1 - 2 * (py - 0.5) / H) * th * H / W
			local dx, dy, dz = fx + rx * a + ux * b, fy + ry * a + uy * b, fz + rz * a + uz * b
			local dl = math.sqrt(dx * dx + dy * dy + dz * dz)
			dx, dy, dz = dx / dl, dy / dl, dz / dl
			-- the ground hit
			local tg = if dz < 0 then -ez / dz else 1e9
			local T = 1
			local cr, cg, cb = 0, 0, 0
			local s = 0
			local smax = math.min(tg, 20000)
			local cosT = dx * sx + dy * sy + dz * sz
			local phase = 0.6 + 0.8 * math.max(0, cosT) ^ 8 -- (forward scattering round the sun)
			while s < smax and T > 0.01 do
				local x, y, z = ex + dx * s, ey + dy * s, ez + dz * s
				local sg = sample(x, y, z)
				local ds = if sg > 0 then STEP * 0.4 else STEP
				if sg > 0 then
					local a1 = 1 - math.exp(-sg * ds)
					local ts, sk = light(x, y, z)
					local alb = 0.9
					cr += T * a1 * alb * (SUN[1] * ts * phase * 0.9 + SKYC[1] * sk * 1.2 + 0.03)
					cg += T * a1 * alb * (SUN[2] * ts * phase * 0.9 + SKYC[2] * sk * 1.2 + 0.03)
					cb += T * a1 * alb * (SUN[3] * ts * phase * 0.9 + SKYC[3] * sk * 1.2 + 0.035)
					T *= 1 - a1
				end
				s += ds
			end
			if T > 0.01 then
				if tg < 1e8 then
					local gx, gy = ex + dx * tg, ey + dy * tg
					local ts, sk = light(gx, gy, STEP)
					local g = 0.35 * ts + 0.25 * sk
					cr += T * 0.32 * g
					cg += T * 0.36 * g
					cb += T * 0.22 * g
				else
					local up = math.max(dz, 0)
					cr += T * (0.55 + 0.2 * (1 - up))
					cg += T * (0.65 + 0.15 * (1 - up))
					cb += T * 0.85
				end
			end
			local function h(v)
				return string.format("%02x", math.clamp(math.floor(255 * (v / (1 + v)) ^ (1 / 1.6) * 1.35 + 0.5), 0, 255))
			end
			row[px] = h(cr) .. h(cg) .. h(cb)
		end
		print(table.concat(row))
	end
end

-- the slice: log10 sigma across the tornado, west-east, through its axis
do
	print(string.format("IMG slice %d %d", nx, nz))
	local j = math.floor(nx / 2) + 1
	for k = nz, 1, -1 do
		local row = table.create(nx)
		for i = 1, nx do
			local sg = SIG[idx(i, j, k)]
			local v = if sg > 0 then math.clamp((math.log10(sg) + 5) / 5, 0, 1) else 0
			local c = math.floor(255 * v)
			row[i] = string.format("%02x%02x%02x", c, c, if sg > 0 then math.max(c, 40) else 0)
		end
		print(table.concat(row))
	end
end
local cx, cy = t.x, t.y
local zb = storm.base
-- 1 inflow side, ground, 3 km out; 2 same from the other side; 3 from under the base; 4 elevated
-- three-quarter view; 5 far, 6 km
render("v1_ground_E", cx + 3000, cy - 500, 2, cx, cy, 0.45 * zb, 70)
render("v2_ground_S", cx + 400, cy - 3000, 2, cx, cy, 0.45 * zb, 70)
render("v3_under", cx + 1200, cy - 900, 2, cx, cy, zb, 95)
render("v4_elevated", cx + 2600, cy - 2600, 0.9 * zb, cx, cy, 0.4 * zb, 70)
render("v5_far", cx + 6000, cy - 1500, 2, cx, cy, 0.6 * zb, 55)
log("done in %.1f s", os.clock() - c0)
