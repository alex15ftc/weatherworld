-- The piece-by-piece mobile home (roblox/Shared/StormLab/Sim/MobileHome.luau) against the EF
-- scale's single-wide indicator (DI 3) and the physics it rests on:
--   1. geometry: the pieces weigh what a 14 x 56 ft single-wide does (6.5-8 t), and every piece
--      gets a Sim/Debris class;
--   2. force balance: the broadside gust that slides or tips the unit, unanchored, poorly and
--      fully anchored, against DOD 3 (slides off its piers) and DOD 5 (rolls);
--   3. a ramp of broadside wind (exposure-C gust profile, 0.5 m/s per second) through 60 homes
--      of random variant and anchoring: the 10-m gust at which each degree first appears, its
--      median against the DOD's bounds, and the load path (nothing fails before what covers it);
--   4. debris: pieces and the units coverings tear into, released into a 50 m/s wind, fly by drag
--      and lift: plates with a Tachikawa number K >> 1 fly far, the chassis only slides.
--   lune run tools/stormlab/test_mobile_home.luau [-v]

local MobileHome = require("../../roblox/Shared/StormLab/Sim/MobileHome")
local Damage = require("../../roblox/Shared/StormLab/Sim/Damage")
local Debris = require("../../roblox/Shared/StormLab/Sim/Debris")

local process = require("@lune/process")
local verbose = process.args[1] == "-v"
local fails = 0
local function check(ok: boolean, what: string)
	if not ok then
		fails += 1
		print("FAIL " .. what)
	end
end

local MPH = 0.44704
local DI = Damage.DI.mobileHome
local function bounds(degree: number): (number, number, number)
	local row = DI[degree]
	return row[3], row[4], row[5]
end

-- 1. geometry ---------------------------------------------------------------------------------
print("== 1. geometry")
local full = MobileHome.new({ seed = 1, foundation = "Skirting", porch = "Steps", shutters = "On", gable = "Off", anchors = 0 })
local props = MobileHome.unitProps(full)
print(string.format("unit (skirted, shutters, no gable): %.0f kg, broadside %.1f m2 (load centre %.2f m), end %.1f m2, plan %.1f m2, CoM %.2f m",
	props.mass, props.areaSide, props.loadY, props.areaEnd, props.areaPlan, props.comY))
check(props.mass > 6500 and props.mass < 8000, string.format("unit mass %.0f kg outside 6.5-8 t", props.mass))
check(props.areaSide > 65 and props.areaSide < 82, string.format("broadside area %.1f m2 (17.4 m x 4.3 m, ground to ridge, expected)", props.areaSide))
local byCat = {}
for name, p in MobileHome.PIECES do
	local c = byCat[p.cat] or { n = 0, mass = 0, area = 0 }
	c.n += 1
	c.mass += p.mass
	c.area += p.area
	byCat[p.cat] = c
	check(Debris.CLASSES["mh:" .. name] ~= nil, "no debris class for " .. name)
end
if verbose then
	local cats = {}
	for k in byCat do
		table.insert(cats, k)
	end
	table.sort(cats)
	print("  category       n    kg/piece   drag area m2   Tachikawa K at 40 m/s   DOD")
	for _, k in cats do
		local c = byCat[k]
		local cls = { mass = c.mass / c.n, area = c.area / c.n }
		print(string.format("  %-12s %3d %10.1f %14.2f %22.2f %5d", k, c.n, cls.mass, cls.area,
			Debris.tachikawa(cls :: any, 40), MobileHome.CATEGORIES[k].dod))
	end
end

-- 2. force balance --------------------------------------------------------------------------------
print("== 2. force balance (broadside gust at the unit -> 10-m gust in open country, mph)")
local f = MobileHome.profile(4.3)
local lo3, hi3 = select(2, bounds(3)), select(3, bounds(3))
local lo5, hi5 = select(2, bounds(5)), select(3, bounds(5))
for _, a in { 0, 0.3, 0.6, 1 } do
	local h = MobileHome.new({ seed = 2, foundation = "Piers", porch = "Steps", shutters = "Off", gable = "Off", anchors = a })
	local slide = MobileHome.slideSpeed(h) / f / MPH
	local tip = MobileHome.tipSpeed(h) / f / MPH
	print(string.format("  anchors %3.0f%%: slides at %5.1f mph, tips at %5.1f mph   (DOD 3 %d-%d, DOD 5 %d-%d)",
		a * 100, slide, tip, lo3, hi3, lo5, hi5))
	if a == 0 then
		-- an unanchored unit moves at or below the low end (the published ranges assume typical ties)
		check(math.min(slide, tip) < lo3 + 5, string.format("unanchored unit holds to %.0f mph", math.min(slide, tip)))
	elseif a == 1 then
		check(math.min(slide, tip) >= lo3 and math.min(slide, tip) <= hi5,
			string.format("fully anchored unit first moves at %.0f mph, outside DOD 3-5", math.min(slide, tip)))
	end
end

-- 3. wind ramp -----------------------------------------------------------------------------------
print("== 3. ramp: broadside wind rising 0.5 m/s per s, 60 homes (random variant, anchors 0-1)")
local firsts = {} -- degree -> { 10-m gusts in mph }
local order = 0
local N = 60
for k = 1, N do
	local anchors = ((k * 37) % 100) / 100
	local h = MobileHome.new({ seed = 1000 + k, anchors = anchors })
	local v10 = 15
	local dt = 0.1
	local dirX, dirY = 0, 1 -- wind toward the north: broadside to a home along the east axis
	local function wind(_x: number, _y: number, z: number): (number, number, number)
		local s = v10 * MobileHome.profile(z)
		return dirX * s, dirY * s, 0
	end
	local goneAt = {}
	local t = 0
	while v10 < 75 do
		local failed, events = MobileHome.step(h, dt, wind)
		t += dt
		for _, fp in failed do
			goneAt[fp.name] = t
		end
		for _, e in events do
			firsts[e.degree] = firsts[e.degree] or {}
			table.insert(firsts[e.degree], v10 / MPH)
		end
		v10 += 0.5 * dt
	end
	-- the load path: nothing went before what covers it
	for name, at in goneAt do
		local p = MobileHome.PIECES[name]
		for _, r in p.req do
			if h.pieces[r] and p.cat ~= "Pier" then
				local rat = goneAt[r]
				if rat == nil or rat > at then
					order += 1
					if verbose then
						print(string.format("  load path: %s went before %s (home %d)", name, r, k))
					end
				end
			end
		end
	end
end
check(order == 0, string.format("%d pieces failed before the pieces covering them", order))
print("  DOD  first seen in   median   (DI 3 expected, lower-upper)   description")
for d = 1, #DI do
	local list = firsts[d] or {}
	table.sort(list)
	local med = list[math.max(1, math.floor(#list / 2 + 0.5))]
	local exp, lo, hi = bounds(d)
	print(string.format("  %3d  %3d / %d homes   %6s   (%d, %d-%d)   %s", d, #list, N,
		if med then string.format("%.0f", med) else "-", exp, lo, hi, DI[d][2]))
	if med and #list >= 5 and d ~= 3 and d ~= 5 and d ~= 7 then
		-- piece degrees: the median within the published bounds (the unit's moves depend on its ties)
		check(med >= lo - 3 and med <= hi + 3, string.format("DOD %d median %.0f mph outside %d-%d", d, med, lo, hi))
	end
end
check(#(firsts[1] or {}) == N, "every home shows visible damage by 75 m/s")
check(#(firsts[9] or {}) > 0, "some homes are completely destroyed by 75 m/s (168 mph)")

-- 4. debris --------------------------------------------------------------------------------------
print("== 4. debris: released at its height into a 50 m/s wind for 20 s")
local function wind50(_x: number, _y: number, z: number): (number, number, number)
	return 50 * MobileHome.profile(math.max(0.5, z)), 0, 0
end
local function fly(className: string, z: number): any
	local p = Debris.new(className, 0, 0, z, 0, 0, 0, 7)
	p.zMax = p.z
	for _ = 1, 200 do
		Debris.step(p, 0.1, wind50, 0)
		p.zMax = math.max(p.zMax, p.z)
	end
	return p
end
local far = {}
for _, name in { "Shingles_F1", "Shutter_F1L", "Sheathing_F2", "Window_B2", "Truss_05", "Wall_F2", "Floor_2", "Chassis" } do
	local b = MobileHome.PIECES[name]
	local tears = MobileHome.CATEGORIES[b.cat].tears
	local className = if tears then tears else "mh:" .. name
	local p = fly(className, b.pos[2] * 0.3048 + 1)
	local c = p.class
	far[name] = p
	print(string.format("  %-13s %-16s x%-2d %7.1f kg  K %5.2f  ->  %5.0f m downwind, top %5.1f m, fastest %4.1f m/s, impact %7.0f J",
		name, className, b.fragments or 1, c.mass, Debris.tachikawa(c, 50), p.x, p.zMax, p.maxSpeed, p.impact))
end
check(far.Shingles_F1.x > 300 and far.Shutter_F1L.x > 300, "shingle tabs and shutters should fly far (K >> 1)")
check(far.Chassis.zMax < 3, "the chassis should not be lofted")
check(far.Chassis.maxSpeed < 0.5 * far.Shingles_F1.maxSpeed, "the chassis should move far slower than light debris")
check(MobileHome.PIECES.Shingles_F1.fragments == 12, "a roof's shingles tear into tabs")

print(if fails == 0 then "PASS" else string.format("%d FAIL", fails))
if fails > 0 then
	error("test_mobile_home failed")
end
