-- Tornado core radius (rc, m) from the fields on both lab days: per-tornado peak rc, its swirl,
-- the parent's rlow, wLow and vlow, and the median of rc over each tornado's life.
-- Target (positioning plan item 5): median core radius 100-150 m.
local Json = require("../../roblox/src/stormlab/shared/Sim/Json")
local World = require("../../roblox/src/stormlab/shared/Sim/World")
local function median(t)
	if #t == 0 then return 0 end
	table.sort(t)
	return t[(#t + 1) // 2]
end
for _, name in { "SquallLine", "Supercell" } do
	local world = World.new(Json.decode(require("../../roblox/src/stormlab/data/" .. name)))
	world:spinUp(600)
	local seen = {}
	local all = {}
	for step = 1, 1440 do
		world:step(5)
		if step % 6 == 0 then
			for _, t in world.tornadoes do
				local r = seen[t.id]
				if not r then
					r = { id = t.id, eng = t.eng ~= nil, rcs = {}, peak = 0, sw = 0, vc = 0, pw = 0, kind = t.parentKind }
					seen[t.id] = r
				end
				table.insert(r.rcs, t.rc)
				table.insert(all, t.rc)
				if t.rc > r.peak then r.peak, r.sw = t.rc, t.swirl end
				r.vc = math.max(r.vc, t.vc)
				if (t.peakWind or 0) > r.pw then
					r.pw = t.peakWind or 0
					for _, st in world.storms do
						if st.id == t.parentId then r.vl = math.abs(st.vlow) end
					end
				end
			end
		end
	end
	local list = {}
	for _, r in seen do table.insert(list, r) end
	table.sort(list, function(a, b) return a.id < b.id end)
	local meds, eng = {}, 0
	for _, r in list do
		table.insert(meds, median(table.clone(r.rcs)))
		if r.eng then eng += 1 end
	end
	-- EF by peak ground wind (m/s, 3-s gust): EF0 29, EF1 38, EF2 49, EF3 61, EF4 74, EF5 89
	local ef = { [-1] = 0, [0] = 0, 0, 0, 0, 0, 0 }
	for _, r in list do
		local e = if r.pw >= 89 then 5 elseif r.pw >= 74 then 4 elseif r.pw >= 61 then 3 elseif r.pw >= 49 then 2 elseif r.pw >= 38 then 1 elseif r.pw >= 29 then 0 else -1
		ef[e] += 1
	end
	local ratios = {}
	for _, r in list do
		if r.vl and r.vl > 1 then table.insert(ratios, r.pw / r.vl) end
	end
	print(string.format("%s: peak ground wind / parent vlow at that time: median %.2f (target ~2, Vrot-EF relation)", name, median(ratios)))
	print(string.format("%s: below EF0 %d | EF0 %d EF1 %d EF2 %d EF3 %d EF4 %d EF5 %d", name, ef[-1], ef[0], ef[1], ef[2], ef[3], ef[4], ef[5]))
	print(string.format("%s: %d tornadoes (%d engine-led) | median rc over all samples %.0f m | median of per-tornado medians %.0f m", name, #list, eng, median(all), median(meds)))
	for i, r in list do
		if i <= 12 then
			print(string.format("  %s %-5s %s life-median rc %4.0f m, peak %4.0f m (swirl %.2f), peak vc %4.1f m/s, peak ground wind %4.1f m/s (vlow %4.1f)", r.id, r.kind, r.eng and "eng" or "own", median(table.clone(r.rcs)), r.peak, r.sw, r.vc, r.pw, r.vl or 0))
		end
	end
end
