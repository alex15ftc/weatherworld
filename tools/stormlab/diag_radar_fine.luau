-- Does the precipitation parcel field hold a hook / inflow notch at sub-km scale? Bins the low
-- level parcels (z < 1.5 km) round the strongest rotating storm at 250 m and 1 km and prints
-- both as ASCII reflectivity maps (diagnostic for the lab radar).
--   luau --codegen tools/stormlab/diag_radar_fine.luau
local Json = require("../../roblox/src/stormlab/shared/Sim/Json")
local World = require("../../roblox/src/stormlab/shared/Sim/World")
local data = Json.decode(require("../../roblox/src/stormlab/data/Supercell"))
local world = World.new(data)
world:spinUp(600)
for _ = 1, 240 do
	world:step(5)
end
local p = world.precip
-- the rotating storm with the most low-level precipitation round it
local best, bestN = nil, -1
for _, s in world.storms do
	if not s.dead and (s.rot or 0) > 0.5 then
		local n = 0
		for i = 1, #p.px do
			if p.alive[i] and p.pz[i] < 1500 and (p.px[i] - s.x) ^ 2 + (p.py[i] - s.y) ^ 2 < 1e8 then
				n += 1
			end
		end
		if n > bestN then
			best, bestN = s, n
		end
	end
end
print(string.format("parcels %d; storm %s at (%.1f, %.1f) km, rot %.2f, vlow %.1f, low meso (%.1f, %.1f) km",
	p.n, tostring(best.id), best.x / 1000, best.y / 1000, best.rot or 0, best.vlow or 0,
	(best.lowX or best.x) / 1000, (best.lowY or best.y) / 1000))
local function map(dx: number, half: number)
	local n = math.floor(2 * half / dx)
	local mass = {}
	local count = 0
	for i = 1, #p.px do
		if p.alive[i] and p.pz[i] < 1500 and p.pk[i] ~= 3 then
			local gx = math.floor((p.px[i] - best.x + half) / dx)
			local gy = math.floor((p.py[i] - best.y + half) / dx)
			if gx >= 0 and gy >= 0 and gx < n and gy < n then
				local k = gx + gy * n
				local m = p.pm[i]
				if p.pk[i] == 2 then
					m *= 4
				end
				mass[k] = (mass[k] or 0) + m
				count += 1
			end
		end
	end
	local vol = dx * dx * 1500
	local chars = " .:-=+*#%@"
	print(string.format("-- %d m cells, %d km square, %d low parcels (north up, storm centre in the middle)", dx, 2 * half / 1000, count))
	-- markers: L = low-level mesocyclone (Storm.lowMesoAt), T = a tornado of this storm
	local Storm = require("../../roblox/src/stormlab/shared/Sim/Storm")
	local lx, ly = Storm.lowMesoAt(best)
	local marks = {}
	local function mark(x: number, y: number, ch: string)
		local gx = math.floor((x - best.x + half) / dx)
		local gy = math.floor((y - best.y + half) / dx)
		if gx >= 0 and gy >= 0 and gx < n and gy < n then
			marks[gx + gy * n] = ch
		end
	end
	mark(lx, ly, "L")
	for _, t in world.tornadoes or {} do
		if not t.ended then
			mark(t.x, t.y, "T")
			print(string.format("tornado at (%.1f, %.1f) km, %.1f km from L", t.x / 1000, t.y / 1000, math.sqrt((t.x - lx) ^ 2 + (t.y - ly) ^ 2) / 1000))
		end
	end
	print(string.format("L (low meso) at (%.1f, %.1f) km = %.1f km from the storm centre", lx / 1000, ly / 1000, math.sqrt((lx - best.x) ^ 2 + (ly - best.y) ^ 2) / 1000))
	for j = n - 1, 0, -1 do
		local row = {}
		for i = 0, n - 1 do
			if marks[i + j * n] then
				table.insert(row, marks[i + j * n])
				continue
			end
			local m = mass[i + j * n] or 0
			local gm3 = m / vol * 1000
			local z = if gm3 > 0 then 10 * math.log10(2.4e4 * gm3 ^ 1.82) else -99
			local c = math.clamp(math.floor((z - 10) / 7) + 1, 0, 9)
			table.insert(row, string.sub(chars, c + 1, c + 1))
		end
		print(table.concat(row))
	end
end
map(1000, 20000)
map(500, 15000)
