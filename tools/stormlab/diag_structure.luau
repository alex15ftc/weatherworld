-- The lab supercell seen from above: for the main rotating storm at a few sim times, grids of
-- 0.5 deg radar reflectivity (site 30 km SW, Radar.gate as the game), CAPPIs at 1/3/5/8 km and
-- composite reflectivity (max over 0.5..13 km) from the binned precipitation volume, anvil ice
-- (column count of ice parcels above 7 km), the updraft at 1 km and 5 km, and the cold-pool
-- deficit; plus the conceptual-model points (updraft, BWER, low/mid meso, FFD, RFD, tornadoes,
-- motion, anvil). tools/stormlab/structure_png.py draws them.
--   luau --codegen tools/stormlab/diag_structure.luau -a 20,30,45 > structure.txt
local Json = require("../../roblox/src/stormlab/shared/Sim/Json")
local World = require("../../roblox/src/stormlab/shared/Sim/World")
local Storm = require("../../roblox/src/stormlab/shared/Sim/Storm")
local Radar = require("../../roblox/src/stormlab/shared/Sim/Radar")
local args = { ... }
local times = {}
for t in string.gmatch(args[1] or "20,30,45", "[^,]+") do
	table.insert(times, tonumber(t))
end
local data = Json.decode(require("../../roblox/src/stormlab/data/Supercell"))
local world = World.new(data)
world:spinUp(600)

local N, HALF = 120, 30000
local p = world.precip

local function pick(): any
	local best, bestN = nil, -1
	for _, st in world.storms do
		if not st.dead and (st.rot or 0) > 0.3 then
			local n = 0
			for i = 1, #p.px do
				if p.alive[i] and p.pz[i] < 1500 and (p.px[i] - st.x) ^ 2 + (p.py[i] - st.y) ^ 2 < 1e8 then
					n += 1
				end
			end
			if n > bestN then
				best, bestN = st, n
			end
		end
	end
	return best
end

local function grid(name: string, cx: number, cy: number, f: (number, number) -> number)
	print("GRID " .. name .. " " .. N)
	for j = N - 1, 0, -1 do
		local row = table.create(N)
		for i = 0, N - 1 do
			local x = cx - HALF + (i + 0.5) * (2 * HALF / N)
			local y = cy - HALF + (j + 0.5) * (2 * HALF / N)
			row[i + 1] = string.format("%.0f", f(x, y))
		end
		print(table.concat(row, " "))
	end
end

local function frame(tmin: number)
	local s = pick()
	if not s then
		print("NOSTORM " .. tmin)
		return
	end
	local cx, cy = s.x, s.y
	local function pt(name: string, x: number, y: number)
		print(string.format("PT %s %.2f %.2f", name, (x - cx) / 1000, (y - cy) / 1000))
	end
	local hx, hy = Storm.heading(s)
	print(string.format("FRAME t=%d storm=%s age=%.0fmin W=%.0f rot=%.2f vlow=%.0f occl=%.2f Ru=%.1fkm base=%.0f el=%.0f motion=%.0fdeg(%.1f m/s) lowAngle=%.2f precipRate=%.0f",
		tmin, tostring(s.id), s.age / 60, s.W, s.rot or 0, s.vlow or 0, s.occl or 0, s.Ru / 1000, s.base, s.el,
		(90 - math.deg(math.atan2(hy, hx))) % 360, math.sqrt(s.u ^ 2 + s.v ^ 2), s.lowAngle, s.precipRate or 0))
	print(string.format("VEC motion %.3f %.3f", hx, hy))
	print(string.format("VEC anvil %.3f %.3f", s.anvilU, s.anvilV))
	local ru, rv = s.upperU - s.u, s.upperV - s.v
	print(string.format("VEC upperSR %.3f %.3f", ru, rv))
	if s.prof then
		local Thermo = require("../../roblox/src/stormlab/shared/Sim/Thermo")
		local parts = {}
		for _, z in { 500, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 9000, 11000 } do
			local eu, ev = Thermo.windAt(s.prof, z)
			local ru_, rv_ = eu - s.u, ev - s.v
			table.insert(parts, string.format("%dm:%.0fm/s@%.0f", z, math.sqrt(ru_ * ru_ + rv_ * rv_),
				-math.deg(math.atan2(rv_, ru_) - math.atan2(hy, hx)) % 360))
		end
		print("SRWIND (toward, deg clockwise from motion) " .. table.concat(parts, " "))
	end
	pt("storm", s.x, s.y)
	local _, ux, uy = Storm.wprofAt(s, s.base)
	pt("updraftBase", s.x + ux, s.y + uy)
	local _, ux5, uy5 = Storm.wprofAt(s, 5000)
	pt("updraft5km", s.x + ux5, s.y + uy5)
	local lx, ly = Storm.lowMesoAt(s)
	pt("LLM", lx, ly)
	local mx, my = Storm.midMesoAt(s, 5000)
	pt("midMeso", mx, my)
	local fx, fy = Storm.ffdAt(s)
	pt("FFD", fx, fy)
	local rx, ry = Storm.rfdAt(s)
	pt("RFD", rx, ry)
	for _, t in world.tornadoes do
		if not t.ended then
			pt("tornado", t.x, t.y)
		end
	end
	for _, o in world.storms do
		if o ~= s and not o.dead and math.abs(o.x - cx) < HALF and math.abs(o.y - cy) < HALF then
			pt(if o.leftMover then "otherL" else "other", o.x, o.y)
		end
	end
	local site = Radar.site(cx - 21213, cy - 21213, { seed = 11 })
	local ctx = {
		vol = p, tornadoes = world.tornadoes, coldPool = world.coldPool,
		freezing = (s.freezing and s.freezing > 500) and s.freezing or 4000,
		wind = function(x: number, y: number, z: number)
			return world:windAt(x, y, z)
		end,
	}
	grid("ppi05", cx, cy, function(x, y)
		local dx, dy = x - site.x, y - site.y
		local d = math.sqrt(dx * dx + dy * dy)
		local dbz = Radar.gate(site, ctx, math.deg(math.atan2(dx, dy)) % 360, d, 0.5, math.floor(tmin))
		return dbz or -99
	end)
	for _, z in { 1000, 3000, 5000, 8000 } do
		grid("cappi" .. z, cx, cy, function(x, y)
			local d = p:sample(x, y, z)
			return if d > -50 then d else -99
		end)
	end
	grid("composite", cx, cy, function(x, y)
		local m = -99
		for z = 500, 13000, 500 do
			local d = p:sample(x, y, z)
			if d > m then
				m = d
			end
		end
		return m
	end)
	-- anvil ice: column counts of ice parcels above 7 km, binned 500 m
	local cnt = {}
	local cell = 2 * HALF / N
	for i = 1, #p.px do
		if p.alive[i] and p.pk[i] == 3 and p.pz[i] > 7000 then
			local gi = math.floor((p.px[i] - cx + HALF) / cell)
			local gj = math.floor((p.py[i] - cy + HALF) / cell)
			if gi >= 0 and gj >= 0 and gi < N and gj < N then
				local k = gi + gj * N
				cnt[k] = (cnt[k] or 0) + 1
			end
		end
	end
	grid("anvilIce", cx, cy, function(x, y)
		local gi = math.floor((x - cx + HALF) / cell)
		local gj = math.floor((y - cy + HALF) / cell)
		return cnt[gi + gj * N] or 0
	end)
	grid("w1km", cx, cy, function(x, y)
		local _, _, w = world:windAt(x, y, 1000, true)
		return w * 10
	end)
	grid("w5km", cx, cy, function(x, y)
		local _, _, w = world:windAt(x, y, 5000, true)
		return w * 10
	end)
	grid("coldpool", cx, cy, function(x, y)
		local d = world.coldPool:deficitAt(x, y)
		return d * 10
	end)
end

local t = 0
for _, target in times do
	while t < target do
		world:step(5)
		t += 5 / 60
	end
	frame(target)
end
