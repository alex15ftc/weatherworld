-- The RFD gust front model (Sim/GustFront) run alongside the lab's own storms, uncoupled, or
-- coupled (Storm.GUST_FRONT on): per rotating storm each 2 min, the clock occlusion vs the front's,
-- the meso-to-occlusion-point separation along the front, the front's size, where the meso sits.
--   luau --codegen tools/stormlab/diag_gustfront.luau -a [minutes] [coupled]
local Json = require("../../roblox/src/stormlab/shared/Sim/Json")
local World = require("../../roblox/src/stormlab/shared/Sim/World")
local Storm = require("../../roblox/src/stormlab/shared/Sim/Storm")
local GustFront = require("../../roblox/src/stormlab/shared/Sim/GustFront")
local args = { ... }
local minutes = tonumber(args[1]) or 90
local coupled = args[2] == "coupled"
if coupled then
	Storm.GUST_FRONT = true
end
local world = World.new(Json.decode(require("../../roblox/src/stormlab/data/Supercell")))
world:spinUp(600)
local env = world.env
local fronts = {}
local function heading(s)
	local m = math.sqrt(s.u * s.u + s.v * s.v)
	return s.u / m, s.v / m
end
local function srcFor(s, mx, my)
	local hx, hy = heading(s)
	local a = math.pi + 0.2
	local ox, oy = hx * math.cos(a) - hy * math.sin(a), hx * math.sin(a) + hy * math.cos(a)
	return mx + ox * 0.35 * s.Ru, my + oy * 0.35 * s.Ru
end
local cycles = {}
for m = 1, minutes do
	for sec = 1, 60 do
		world:step(1)
		if not coupled and sec % 10 == 0 then
			error("uncoupled mode retired (2026-11-03: GustFront.step takes a ctx now) - pass coupled")
			for _, s in world.storms do
				if not s.dead and (s.rot or 0) > 0.3 then
					local f = fronts[s.id]
					local function wind(x, y, z)
						local u, v = env:windAt(x, y, z)
						local a, b = Storm.windAt(s, x, y, z, true)
						return u + a, v + b
					end
					if not f then
						local mx, my = Storm.lowMesoAt(s)
						local sx, sy = srcFor(s, mx, my)
						f = GustFront.new(s, mx, my, sx, sy)
						fronts[s.id] = f
					end
					GustFront.step(s, f, 10, wind)
					if f.occl >= 1 then
						cycles[s.id] = (cycles[s.id] or 0) + 1
						print(string.format("  m %3d %s FRONT CYCLE %d (age %.0f min, perim %.1f km)", m, tostring(s.id), cycles[s.id], f.age / 60, f.perim / 1000))
						local sx, sy = srcFor(s, f.jx, f.jy)
						local jx, jy = f.jx, f.jy
						f = GustFront.new(s, jx, jy, sx, sy)
						fronts[s.id] = f
					end
				end
			end
		end
	end
	-- (dump: the front, meso, occlusion point and source in the storm's frame, x along its heading)
	if os.getenv and false then end
	if args[3] and m % 2 == 0 then
		for _, s in world.storms do
			local f = if coupled then s.gf else fronts[s.id]
			if f and tostring(s.id) == args[3] then
				local hx, hy = heading(s)
				local function rel(x, y)
					local dx, dy = x - s.x, y - s.y
					return hx * dx + hy * dy, -hy * dx + hx * dy
				end
				local row = {}
				for i = 1, f.n do
					local a, b = rel(f.pts[2 * i - 1], f.pts[2 * i])
					table.insert(row, string.format("%.0f,%.0f", a, b))
				end
				local ma, mb = rel(f.mx, f.my)
				local ja, jb = rel(f.jx, f.jy)
				local sa, sb = rel(s.x + f.sox, s.y + f.soy)
				local ca, cb = rel(Storm.lowMesoAt(s))
				print(string.format("DUMP %d %s M %.0f,%.0f J %.0f,%.0f S %.0f,%.0f C %.0f,%.0f Ru %.0f P %s", m, tostring(s.id), ma, mb, ja, jb, sa, sb, ca, cb, s.Ru, table.concat(row, ";")))
			end
		end
	end
	if m % 2 == 0 then
		for _, s in world.storms do
			local f = if coupled then s.gf else fronts[s.id]
			if f and not s.dead then
				local hx, hy = heading(s)
				local dx, dy = f.mx - s.x, f.my - s.y
				local ang = math.atan2(hx * dy - hy * dx, hx * dx + hy * dy)
				local jdx, jdy = f.jx - s.x, f.jy - s.y
				print(string.format("m %3d %s rfd %4.1f vlow %4.1f vmid %4.1f | clock occl %.2f cyc %d | front occl %.2f depth %5.0f sep %4.0f m perim %4.1f km n %3d | triple point %s | meso ang %5.2f r %.2f Ru | occ pt r %.2f Ru", m, tostring(s.id), s.rfd or 0, s.vlow, s.vmid, s.occl, s.cycle or 0, f.occl, f.depth or 0, f.sep or 0, (f.perim or 0) / 1000, f.n, tostring(f.tp), ang, math.sqrt(dx * dx + dy * dy) / s.Ru, math.sqrt(jdx * jdx + jdy * jdy) / s.Ru))
			end
		end
	end
end
for id, c in cycles do print("front cycles", id, c) end
