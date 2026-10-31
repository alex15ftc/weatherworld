-- The two outflows round the lab supercell (positioning plan 3.2): a map of the cold pool round
-- storm C001, 1 km cells, rotated so the storm moves up the page.
--   .  warm air (deficit < 0.5 K)    1-9  forward-flank air, deficit in K (rounded)
--   a-i  rear-flank air (ColdPool.R >= 0.5), deficit 1-9 K
--   U  updraft at the base           L  low-level meso       T  tornado
-- then, along the cold pool's edge (the 0.5 K contour) within 12 km of the LLM, where it is
-- forward- or rear-flank air: the junction is the triple point.
--   luau --codegen tools/stormlab/diag_fronts.luau
local name = "Supercell"
local Json = require("../../roblox/src/stormlab/shared/Sim/Json")
local World = require("../../roblox/src/stormlab/shared/Sim/World")
local Storm = require("../../roblox/src/stormlab/shared/Sim/Storm")
local world = World.new(Json.decode(require("../../roblox/src/stormlab/data/" .. name)))
world:spinUp(600)
local cp = world.coldPool
local HALF = 15
local function map(s)
	local hx, hy = Storm.heading(s)
	-- page axes: up = motion (hx, hy), right = (hy, -hx)
	local lx, ly = Storm.lowMesoAt(s)
	local _, ux, uy = Storm.wprofAt(s, s.base)
	local cx, cy = s.x, s.y
	local function cell(px, py)
		-- page offset (km) of a world point
		local dx, dy = (px - cx) / 1000, (py - cy) / 1000
		return math.floor(dx * hy - dy * hx + 0.5), math.floor(dx * hx + dy * hy + 0.5)
	end
	local marks = {}
	local function mark(px, py, ch)
		local a, b = cell(px, py)
		marks[a .. "," .. b] = ch
	end
	mark(s.x + ux, s.y + uy, "U")
	mark(lx, ly, "L")
	for _, t in world.tornadoes do
		if not t.ended then
			mark(t.x, t.y, "T")
		end
	end
	local nf, nr = 0, 0
	for b = HALF, -HALF, -1 do
		local row = {}
		for a = -HALF, HALF do
			local m = marks[a .. "," .. b]
			if not m then
				local px = cx + (a * hy + b * hx) * 1000
				local py = cy + (-a * hx + b * hy) * 1000
				local d = cp.D:sample(px, py)
				if d < 0.5 then
					m = "."
				else
					local k = math.clamp(math.floor(d + 0.5), 1, 9)
					if cp.R:sample(px, py) >= 0.5 then
						m = string.char(96 + k)
						nr += 1
					else
						m = tostring(k)
						nf += 1
					end
				end
			end
			table.insert(row, m)
		end
		print(table.concat(row))
	end
	print(string.format("cold cells: %d forward-flank, %d rear-flank; R at the LLM %.2f, deficit at the LLM %.1f K, occl %.2f",
		nf, nr, cp.R:sample(lx, ly), cp.D:sample(lx, ly), s.occl or 0))
end
for k = 1, 3 do
	for _ = 1, 240 do
		world:step(5)
	end
	for _, s in world.storms do
		if s.id == "C001" and not s.dead then
			print(string.format("== t = %d min, storm C001 (W %.0f, vlow %.1f), up = motion", k * 20, s.W, s.vlow))
			map(s)
		end
	end
end
