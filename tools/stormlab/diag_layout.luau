-- The lab supercell's layout against the conceptual model (docs/stormlab/RESEARCH-SUPERCELL-LAYOUT.md):
-- each feature's bearing (degrees clockwise from the storm's motion: 0 front, +90 right flank,
-- 180 rear, -90 left flank) and distance (km) from the low-level mesocyclone (LLM), next to
-- the expected range.
--   luau --codegen tools/stormlab/diag_layout.luau
local Json = require("../../roblox/src/stormlab/shared/Sim/Json")
local World = require("../../roblox/src/stormlab/shared/Sim/World")
local Storm = require("../../roblox/src/stormlab/shared/Sim/Storm")
local data = Json.decode(require("../../roblox/src/stormlab/data/Supercell"))
local world = World.new(data)
world:spinUp(600)
for _ = 1, 240 do
	world:step(5)
end
local p = world.precip
-- the rotating storm with the most low-level precipitation round it
local s, bestN = nil, -1
for _, st in world.storms do
	if not st.dead and (st.rot or 0) > 0.5 then
		local n = 0
		for i = 1, #p.px do
			if p.alive[i] and p.pz[i] < 1500 and (p.px[i] - st.x) ^ 2 + (p.py[i] - st.y) ^ 2 < 1e8 then
				n += 1
			end
		end
		if n > bestN then
			s, bestN = st, n
		end
	end
end
local hx, hy = Storm.heading(s)
local lx, ly = Storm.lowMesoAt(s)
local function rel(x: number, y: number): (number, number)
	local dx, dy = x - lx, y - ly
	local d = math.sqrt(dx * dx + dy * dy)
	-- clockwise from motion: motion angle minus the feature's angle
	local am = math.atan2(hy, hx)
	local af = math.atan2(dy, dx)
	local th = math.deg(am - af)
	th = (th + 180) % 360 - 180
	return th, d / 1000
end
local function row(name: string, x: number, y: number, want: string)
	local th, d = rel(x, y)
	print(string.format("%-34s %6.0f deg %6.1f km    expected %s", name, th, d, want))
end
print(string.format("storm %s: motion %.0f deg compass, Ru %.1f km, base %.0f m, W %.0f m/s, rot %.2f",
	tostring(s.id), (90 - math.deg(math.atan2(hy, hx))) % 360, s.Ru / 1000, s.base, s.W, s.rot or 0))
local _, ux, uy = Storm.wprofAt(s, s.base)
row("updraft at the base (RFB centre)", s.x + ux, s.y + uy, "low-level updraft +45..+100, 1-4 km")
local _, ux5, uy5 = Storm.wprofAt(s, 5000)
local mx, my = Storm.midMesoAt(s, 5000)
row("updraft at 5 km (BWER)", s.x + ux5, s.y + uy5, "-30..+30, 2-6 km")
row("mid meso (5 km)", mx, my, "-30..+30, 2-6 km")
local fx, fy = Storm.ffdAt(s)
row("FFD centre", fx, fy, "-60..+10, 5-20 km")
local rx, ry = Storm.rfdAt(s)
row("RFD centre", rx, ry, "+150..+240 (i.e. -120..+150 via rear), 1-5 km")
for _, t in world.tornadoes do
	if not t.ended then
		row("tornado " .. tostring(t.id), t.x, t.y, "0-2 km from the LLM")
	end
end
-- the low-level rain: centroid of the heaviest (top 10% of 500 m cells, z < 1.5 km)
local cells, dx = {}, 500
for i = 1, #p.px do
	if p.alive[i] and p.pz[i] < 1500 and p.pk[i] ~= 3 then
		local gx, gy = math.floor(p.px[i] / dx), math.floor(p.py[i] / dx)
		if math.abs(p.px[i] - s.x) < 30000 and math.abs(p.py[i] - s.y) < 30000 then
			local k = gx * 100003 + gy
			local c = cells[k]
			if not c then
				c = { x = (gx + 0.5) * dx, y = (gy + 0.5) * dx, m = 0 }
				cells[k] = c
			end
			c.m += p.pm[i]
		end
	end
end
local list = {}
for _, c in cells do
	table.insert(list, c)
end
table.sort(list, function(a, b)
	return a.m > b.m
end)
local nTop = math.max(1, math.floor(#list * 0.1))
local sx, sy, sm = 0, 0, 0
for i = 1, nTop do
	sx += list[i].x * list[i].m
	sy += list[i].y * list[i].m
	sm += list[i].m
end
row("low-level rain core (top 10%)", sx / sm, sy / sm, "-60..+10, 5-20 km")
-- the nearest heavy low-level rain to the LLM, and the rain right over it
local near = math.huge
for i = 1, nTop do
	local d = math.sqrt((list[i].x - lx) ^ 2 + (list[i].y - ly) ^ 2)
	near = math.min(near, d)
end
print(string.format("nearest heavy low-level rain cell to the LLM: %.1f km (the tornado should be 5-15 km from the main core, at the hook tip)", near / 1000))
-- the deck the cards draw (CardPlan base: radius 2.2 Ru at the base round the updraft)
local Rb = math.clamp(2.2 * Storm.updraftRadiusAt(s, s.base), 1500, 15000)
-- (shifted 0.3 Rb away from the low meso, as CardPlan does for rotating storms)
local ddx, ddy = s.x + ux - lx, s.y + uy - ly
local dl0 = math.sqrt(ddx * ddx + ddy * ddy)
local dkx, dky = s.x + ux + ddx / dl0 * 0.3 * Rb, s.y + uy + ddy / dl0 * 0.3 * Rb
local dRB = math.sqrt((dkx - lx) ^ 2 + (dky - ly) ^ 2)
print(string.format("rain-free base (card deck) radius %.1f km; the LLM / wall cloud is %.1f km from its centre (%.0f%% of the radius; expected near the rear edge nearest the rain, not the middle)",
	Rb / 1000, dRB / 1000, 100 * dRB / Rb))
