-- Inflow cloud must never cross the storm (user 2026-11-03). For every rotating storm, the tail
-- cloud and beaver tail paths (Sim/InflowCloud) are checked point by point against the storm's
-- precipitation core (surface rain), its downdrafts (sinking air at the path's height) and its
-- updraft core; the old placements (WallStream's tail aimed at the forward-flank core,
-- CardPlan's straight band) are measured the same way for comparison.
--   luau --codegen tools/stormlab/test_inflow_clearance.luau -a [minutes] [day]
local Json = require("../../roblox/Shared/StormLab/Sim/Json")
local World = require("../../roblox/Shared/StormLab/Sim/World")
local Storm = require("../../roblox/Shared/StormLab/Sim/Storm")
local Precip = require("../../roblox/Shared/StormLab/Sim/Precip")
local InflowCloud = require("../../roblox/Shared/StormLab/Sim/InflowCloud")

local args = { ... }
local times = {}
for m in string.gmatch(args[1] or "40,58", "[^,]+") do
	table.insert(times, tonumber(m))
end
local day = args[2] or "Supercell"
local sqrt, max, min, clamp = math.sqrt, math.max, math.min, math.clamp
local RAIN_CORE = 10 -- mm/h: "in the core" for the report (the paths themselves stop at RAIN_MAX)

local world = World.new(Json.decode(require("../../roblox/Shared/StormLab/Data/" .. day)))
world:spinUp(600)
local function rain(x, y)
	return (Precip.surface(world.precip, x, y)) or 0
end

local fails, total = 0, 0
local function check(name: string, ok: boolean, detail: string)
	total += 1
	if not ok then
		fails += 1
	end
	print(string.format("  %s  %-44s %s", if ok then "PASS" else "FAIL", name, detail))
end

-- where a point (absolute, height z) sits: rain there, w there, inside the updraft core
local function probe(s, x, y, z)
	local _, _, w = world:windAt(x, y, z, true)
	local _, ux, uy = Storm.wprofAt(s, z)
	local ru = Storm.updraftRadiusAt(s, z)
	local du = sqrt((x - s.x - ux) ^ 2 + (y - s.y - uy) ^ 2)
	return rain(x, y), w, du < 0.5 * ru
end

local function measure(label, pts, s, skipEnd)
	-- pts absolute { x, y, z }; skipEnd: points at the end allowed inside the updraft (the join)
	local n, inRain, sink, core, maxR = 0, 0, 0, 0, 0
	for i, p in pts do
		local r, w, inCore = probe(s, p[1], p[2], p[3])
		n += 1
		maxR = max(maxR, r)
		if r > RAIN_CORE then
			inRain += 1
		end
		if w < -1 then
			sink += 1
		end
		if inCore and i <= #pts - (skipEnd or 0) then
			core += 1
		end
	end
	return n, inRain, sink, core, maxR
end

local agg = { oldTail = { 0, 0 }, newTail = { 0, 0 }, oldBand = { 0, 0 }, newBand = { 0, 0 } }
local nTail, nBand, nStorm = 0, 0, 0
local t0 = 0
for _, minutes in times do
	for _ = t0 + 1, minutes do
		for _ = 1, 60 do
			world:step(1)
		end
	end
	t0 = minutes
	print(string.format("%s day, %d min", day, minutes))
	for _, s in world.storms do
		if not s.dead and (s.rot or 0) > 0.3 and s.W > 8 then
			Storm.prepare(s)
			nStorm += 1
			local lx, ly = Storm.lowMesoAt(s)
			local fx, fy = Storm.ffdAt(s)
			local base = s.base or 1000
			local zb = max(s.wallBase or base, 60)
			local D = max(base - zb, 30)
			local R = 0.5 * clamp(0.9 * s.Ru, 1000, 3500)
			-- old tail: from the rim to 0.9R + min(0.8 dl, 4000) toward the FFD point
			local ddx, ddy = fx - lx, fy - ly
			local dl = sqrt(ddx * ddx + ddy * ddy)
			local old = {}
			if dl > 800 then
				local len = min(0.8 * dl, 4000)
				for k = 0, 10 do
					local r = 0.9 * R + len * k / 10
					table.insert(old, { lx + ddx / dl * r, ly + ddy / dl * r, zb + 0.5 * D })
				end
			end
			-- new tail
			local path, tipLen, nOut = InflowCloud.tail(world, s, lx, ly, R, zb, base)
			local new = {}
			if path then
				-- (only the run outside the rim: inside it the tail is the wall cloud, under the hook)
				for i, p in path do
					if i <= nOut then
						table.insert(new, { lx + p[1], ly + p[2], p[3] })
					end
				end
				nTail += 1
			end
			local on, orr, osk, _, omax = measure("old", old, s)
			local nn, nr, nsk, _, nmax = measure("new", new, s)
			agg.oldTail[1] += on
			agg.oldTail[2] += orr + osk
			agg.newTail[1] += nn
			agg.newTail[2] += nr + nsk
			print(string.format("  storm %s rot %.2f  tail old: %d pts, %d in rain, %d sinking, max %.0f mm/h | new: %s",
				tostring(s.id), s.rot, on, orr, osk, omax,
				if path then string.format("%d pts, %d in rain, %d sinking, max %.0f mm/h, %.1f km, z %.0f-%.0f (zb %.0f base %.0f)", nn, nr, nsk, nmax, tipLen / 1000, new[1][3], new[#new][3], zb, base) else "none (no condensed inflow air)"))
			-- old band: straight along -sr from 0.85 Ru0 out, pushed toward the FFD
			local sr = sqrt((s.srU or 0) ^ 2 + (s.srV or 0) ^ 2)
			local _, ux, uy = Storm.wprofAt(s, base)
			local ob = {}
			if sr > 4 then
				local Ru0 = clamp(2.2 * Storm.updraftRadiusAt(s, base), 1500, 15000)
				local dx, dy = -(s.srU or 0) / sr, -(s.srV or 0) / sr
				local px0, py0 = -dy, dx
				local gx, gy = fx - s.x - ux, fy - s.y - uy
				if gx * px0 + gy * py0 < 0 then
					px0, py0 = -px0, -py0
				end
				local len = clamp(1.1 * Ru0 + 300 * sr, 3000, 14000)
				for k = 0, 10 do
					local f = k / 10
					local along, side = 0.85 * Ru0 + f * len, 0.25 * Ru0 * (1 - 0.5 * f)
					table.insert(ob, { s.x + ux + dx * along + px0 * side, s.y + uy + dy * along + py0 * side, base - 60 })
				end
			end
			local band = InflowCloud.band(world, s, base)
			local nb = {}
			if band then
				for _, p in band do
					table.insert(nb, { s.x + p[1], s.y + p[2], p[3] })
				end
				nBand += 1
			end
			local bn, br, bsk, _, bmax = measure("oldBand", ob, s)
			local cn, cr, csk, _, cmax = measure("newBand", nb, s)
			agg.oldBand[1] += bn
			agg.oldBand[2] += br + bsk
			agg.newBand[1] += cn
			agg.newBand[2] += cr + csk
			print(string.format("             band old: %d pts, %d in rain, %d sinking, max %.0f mm/h | new: %s", bn, br, bsk, bmax,
				if band then string.format("%d pts, %d in rain, %d sinking, max %.0f mm/h, %.1f km", cn, cr, csk, cmax, InflowCloud.length(band) / 1000) else "none"))
		end
	end
end
print(string.format("%d storm samples: tail drawn %d, band drawn %d", nStorm, nTail, nBand))
print(string.format("old tail points in the storm: %d of %d; old band: %d of %d", agg.oldTail[2], agg.oldTail[1], agg.oldBand[2], agg.oldBand[1]))
check("tail never in rain > 10 mm/h or sinking air", agg.newTail[2] == 0, string.format("%d of %d points", agg.newTail[2], agg.newTail[1]))
check("beaver tail never in rain or sinking air", agg.newBand[2] == 0, string.format("%d of %d points", agg.newBand[2], agg.newBand[1]))
check("a tail exists on most rotating storms", nTail >= 0.5 * nStorm, string.format("%d of %d", nTail, nStorm))
print(string.format("%d of %d checks passed", total - fails, total))
