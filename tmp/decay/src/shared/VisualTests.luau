--!nonstrict
-- Deterministic visual test scenes (docs/stormlab/TORNADO-VISUALS.md; the visual plan's section
-- 10 test list). Each scene builds a lab storm at a fixed place with pinned fields (Storm.applyPin)
-- and a fixed seed, starts its tornado, runs it for `run` seconds and (optionally) holds its life
-- stage (Tornado hold: it keeps moving and animating). Everything you then see - funnel shape,
-- condensation, rain, dust, sub-vortices - comes from the same physics as a natural tornado; the
-- pins only make the scene repeatable.
--   storm    pinned storm fields (sim units): W, Ru, vmid, vlow, base, lowering, u, v, rearShare
--            (share of rain released round the rear flank: rain wrapping); evolve + occl: the
--            storm runs its own occlusion cycle from occl (vlow and the RFD air are then only its
--            start), so its tornado is at the life stage the storm has brought it to after run
--   run      seconds the tornado runs before the shot; hold: keep that stage
--   client   localHour (visual clock override, local solar time), flashes = { {at, kind,
--            distance, bearing, height, current} } relative to the tornado (seconds after the
--            scene starts, repeating every `flashEvery` if set), camera preset, show toggles
-- Every scene is built dry and in daylight. Two panel toggles change that for any scene:
--   rain-wrap  rebuilds the scene with RAIN_WRAP_SHARE of its rain released round the rear flank
--              (pin rearShare): the hook wraps rain round the tornado
--   night      the visual clock at NIGHT_HOUR instead of the scene's daytime hour
local VisualTests = {}

VisualTests.RAIN_WRAP_SHARE = 0.7
VisualTests.NIGHT_HOUR = 22.5

-- The hills toggle (2026-11-02, user: elevation changes under the same storm and tornado): the scene
-- is built as usual, then the lab's relief (LabConfig.GROUND.relief) is laid across its tornado's
-- path - steeper and more local than the town's - centred on the track, with the town (on its
-- flat pad) `side` m to the left of it. The tornado starts `ahead` m short of the hills' centre,
-- so it climbs and descends the slopes in the first few minutes. A storm-only scene (the lifecycle scenes:
-- the tornado forms later) centres them on where its storm will be `hillsLead` s in.
-- Max slope ~ amp x 2 pi / wavelength x 0.9 ~ 0.2 (11 deg): hilly plains, Flint Hills to Dixie.
VisualTests.HILLS = { amp = 70, wavelength = 1800, radius = 5000, flat = 700, voxel = 4, ahead = 1500, side = 3000 }

-- where the lab scenes are built (sim metres): the scenario's south-west corner, away from its
-- storms (ground tiles follow the camera)
VisualTests.SITE = { x = -80000, y = -80000 }

-- how long a scene's tornado runs under its fixed storm before it is held (2026-11-02): long
-- enough to settle (its organisation 90 s, swirl 90 s, core 60 s, wind 45 s time constants), so
-- the held tornado is the one its storm keeps - the one its lifecycle counterpart (SC2-SCK below)
-- touches down and keeps. At 150 s it was half-settled: the stovepipe held vc 60 / rc 88 m while
-- its counterpart, same storm and seed, settled to vc 77 / rc 64 m - thinner, a different tornado
VisualTests.SETTLE = 600
-- (the tornado scenes' cameras ~0.6x closer the same day: from 1.5-3 km they all looked alike, user)
-- The tornado scenes' storms were refit for it the same day (cone, stovepipe, wedge, uncondensed,
-- multi-vortex, tube): the swirl a tornado settles to is 0.25 vlow rlow / (700 wLow), wLow = W
-- fW + vmid / 2 (fW ~0.15), its core 0.05 rlow (0.5 + 2.2 S), its wind ~ vlow (rlow / rc)^0.4 - so
-- each storm is refit (Ru up ~15%, vlow down ~16%, W to 0.8x, the rest of wLow from vmid) to settle
-- on the core wind, radius and swirl its old 150 s snapshot showed: the same look, now steady.
-- (Older notes in the scenes below give the storm values of their day)

VisualTests.SCENES = {
	{
		id = "rope_day", label = "1 Rope-out (a life stage)",
		-- (a life stage, not a built rope: the storm evolves - Storm.applyPin evolve - from halfway
		-- through its occlusion cycle; its tornado forms and peaks (~63 m/s, 3 min), the RFD wraps
		-- round it at occlusion 0.6 and cuts it off; it keeps its spin while its core shrinks and
		-- it leans ~30 deg: held 5 min in, decay ~0.5, condensed ~1 core radius wide to the ground.
		-- (A 200 m cloud base condensed a wide translucent cone round it instead, 2026-10-29)
		storm = { W = 32, Ru = 2000, vmid = 16, vlow = 38, base = 700, lowering = 100, u = 9, v = 4, rearShare = 0.05, rfdDeficit = 0.5, seed = 101, evolve = true, occl = 0.5 },
		run = 300, hold = true,
		client = { localHour = 17.5, camera = { dist = 1600, yaw = -110 } },
	},
	{
		id = "cone_partial", label = "2 Cone, condensed to the ground",
		-- (vlow 27: condensed 28 m wide at the ground to ~590 m under the base. At 20 it condensed only
		-- above ~250 m of its 520 m and drew a stub under the lowering, 2026-10-30)
		-- (2026-11-03 refit: condensed to the ground through the tornado's own pulsing, vc +-20% -
		-- a live tornado's minutes, not one held moment. Settled vc 59, core 117 m, swirl 0.81: the
		-- funnel 30-160 m in radius at the ground, ~3x wider half way up. At vlow 25 under a 520 m
		-- base it needed vc >= 50 and held 52: its lifecycle counterpart at 47 showed only dust)
		storm = { W = 32, Ru = 3400, vmid = 16.5, vlow = 29, base = 600, lowering = 150, u = 11, v = 5, rearShare = 0.05, rfdDeficit = 0.5, seed = 102 },
		run = VisualTests.SETTLE, hold = true,
		client = { localHour = 16.5, camera = { dist = 900, yaw = -110 } },
	},
	{
		id = "stovepipe_day", label = "3 Stovepipe, daylight",
		-- (vlow 36: condensed 53 m wide at the ground to ~126 m at 250 m - a column with a broad
		-- ground contact. At 30 it condensed only above ~20 m and tapered to a point, 2026-10-30)
		storm = { W = 36, Ru = 3000, vmid = 19, vlow = 34, base = 750, lowering = 150, u = 12, v = 4, rearShare = 0.05, rfdDeficit = 0.5, seed = 103 }, -- (vlow 34, 2026-11-03: at 30 it left the ground at the weak end of its pulse)
		run = VisualTests.SETTLE, hold = true,
		client = { localHour = 16.0, camera = { dist = 900, yaw = -110 } },
	},
	{
		id = "wedge_rain", label = "4 Wedge",
		-- (2026-10-30: Ru 6000 made ~2700 t/s of rain over a ~9 km footprint that swallowed the
		-- tornado - sight 0.09, a grey ceiling. Ru 4500 and a drier air mass (pw, rhMid: lower
		-- precipitation efficiency) keep it a wedge that can be seen; the rain-wrap toggle still
		-- wraps it)
		-- (2026-11-03 refit, user: "the wedge did not pan out to be a wedge". A 175 m core at vc 42
		-- condensed only ~115 m wide at the ground - a cone - and looked solid only through rain.
		-- A wedge is a broad, strong low-level circulation: high swirl (1.27 - its sub-vortices
		-- inside the condensed funnel, as in real wedges), settled vc 59, core 321 m, the funnel
		-- 470-1100 m wide at the ground through the pulse, wider than the 350 m to its base)
		storm = { W = 45, Ru = 6500, vmid = 24, vlow = 34, base = 600, lowering = 250, u = 14, v = 6, rearShare = 0.05, rfdDeficit = 0.5, seed = 104, pw = 12, rhMid = 0.2 },
		run = VisualTests.SETTLE, hold = true,
		client = { localHour = 16.5, camera = { dist = 1200, yaw = -110 } }, -- (1200: ~750 m wide; from 1800 m 3-9 mm/h of its own rain greyed it out, 2026-11-03)
	},
	{
		id = "uncondensed", label = "5 Nearly uncondensed, ground dust",
		storm = { W = 30, Ru = 3400, vmid = 13, vlow = 14.4, base = 2000, lowering = 60, u = 12, v = 3, rearShare = 0.05, rfdDeficit = 0.5, seed = 105 },
		run = VisualTests.SETTLE, hold = true,
		client = { localHour = 15.0, camera = { dist = 700, yaw = -110 } },
	},
	{
		id = "multivortex", label = "6 Multi-vortex",
		-- (2026-10-31, user: a bowl lowering with thin vortices rising from the ground. Ru 8000 rained
		-- it out - a grey mass, nothing to see. The wide circulation (Ru 8000) is what makes the swirl
		-- high (Tornado.swirlOf: at Ru 4500 an EF3 single vortex); a weaker updraft raises the swirl
		-- and cuts the rain (Ru 8000, W 30 still rained ~2000 t/s); base 550 lowers the bowl;
		-- vlow 22: a bowl over the dust skirt (vc 37; its sub-vortices, 0.45 vc, don't condense - dust
		-- only, lost in the skirt). At 26 a murky mass, at 30 the parent condensed to the ground as a
		-- wide wedge. The filaments need renderer work, not a scene setting)
		storm = { W = 19, Ru = 7000, vmid = 15, vlow = 18.3, base = 550, lowering = 150, u = 12, v = 5, rearShare = 0.05, rfdDeficit = 0.5, seed = 106, pw = 10, rhMid = 0.15 },
		run = VisualTests.SETTLE, hold = true,
		-- (a 550 m base: the parent condenses only aloft, so the sub-vortices show below it - at a
		-- 350 m base it was a wedge that hid them; and ~2 km wide: from 1.6 km it filled the view)
		client = { localHour = 16.5, camera = { dist = 1300, yaw = -110 } },
	},
	{
		id = "night_dark", label = "7 Lightning test: none",
		storm = { W = 40, Ru = 3400, vmid = 20, vlow = 21, base = 800, lowering = 200, u = 11, v = 4, rearShare = 0.05, rfdDeficit = 0.5, seed = 107 },
		run = 150, hold = true,
		client = { localHour = 16.5, camera = { dist = 1500, yaw = -110 } },
	},
	{
		id = "night_ic_near", label = "8 Nearby intracloud flash",
		storm = { W = 40, Ru = 3400, vmid = 20, vlow = 21, base = 800, lowering = 200, u = 11, v = 4, rearShare = 0.05, rfdDeficit = 0.5, seed = 107 },
		run = 150, hold = true,
		client = { localHour = 16.5, camera = { dist = 1500, yaw = -110 }, flashEvery = 6,
			flashes = { { at = 2, kind = "ic", distance = 2500, bearing = 30, height = 6000, current = 0 } } },
	},
	{
		id = "night_cg_far", label = "9 Distant ground flash",
		storm = { W = 40, Ru = 3400, vmid = 20, vlow = 21, base = 800, lowering = 200, u = 11, v = 4, rearShare = 0.05, rfdDeficit = 0.5, seed = 107 },
		run = 150, hold = true,
		client = { localHour = 16.5, camera = { dist = 1500, yaw = -110 }, flashEvery = 6,
			flashes = { { at = 2, kind = "cg", distance = 14000, bearing = 70, height = 6000, current = 30 } } },
	},
	{
		id = "night_multi", label = "0 Closely spaced flashes",
		storm = { W = 40, Ru = 3400, vmid = 20, vlow = 21, base = 800, lowering = 200, u = 11, v = 4, rearShare = 0.05, rfdDeficit = 0.5, seed = 107 },
		run = 150, hold = true,
		client = { localHour = 16.5, camera = { dist = 1500, yaw = -110 }, flashEvery = 8,
			flashes = {
				{ at = 2.0, kind = "ic", distance = 3000, bearing = 10, height = 6500, current = 0 },
				{ at = 2.25, kind = "cg", distance = 1800, bearing = 80, height = 5500, current = 25 },
				{ at = 2.7, kind = "ic", distance = 4000, bearing = -30, height = 7000, current = 0 },
				{ at = 3.1, kind = "cg", distance = 2600, bearing = 120, height = 6000, current = 40 },
			} },
	},
	{
		id = "lod_dolly", label = "- LOD: camera dolly 300 m to 30 km",
		storm = { W = 42, Ru = 3400, vmid = 22, vlow = 21, base = 800, lowering = 250, u = 12, v = 4, rearShare = 0.05, rfdDeficit = 0.5, seed = 103 },
		run = 150, hold = true,
		client = { localHour = 16.0, camera = { dist = 300, yaw = -110, dollyTo = 30000, dollyTime = 40 } },
	},
	-- Lifecycle scenes (2026-10-31; replace the four genesis scenes on the same keys). Each runs
	-- live from genesis to rope-out: storm.keys change the STORM over time (its low-level
	-- circulation vlow / Ru, updraft W, cloud base and lowering, occlusion, RFD air: Storm.keysAt)
	-- and the tornado lives the life that gives it - nothing of the tornado is set. phases: what
	-- the reference shows then (the server's [Life] log prints them next to the tornado's stage,
	-- vc, rc, swirl and funnel tip every 10 s). Lengths are the reference cases' (sim seconds);
	-- watch at 5x-15x. Research: docs/stormlab/research/LIFECYCLE-RESEARCH.md.
	{
		-- Goshen County WY, 5 June 2009 (VORTEX2): rotating wall cloud ~15 min ahead, RFD surge,
		-- genesis with a dust whirl under a lowering cone, ~10 min steady (EF2), ~18 min shrinking
		-- and roping out, debris whirl to ~38 min. Touchdown here: the funnel lowers to the ground.
		id = "life_classic", label = "L1 Life: classic - cone, stovepipe, rope-out (key .)",
		storm = { W = 40, Ru = 2400, vmid = 22, base = 900, lowering = 200, u = 10, v = 4, rearShare = 0.05, rfdDeficit = 0.5, seed = 121,
			keys = {
				-- (vlow 38-40 ran it to ~100 m/s, EF5; Goshen was an EF2, ~60 m/s, 2026-10-31)
				{ t = 0, vlow = 14, occl = 0.15, lowering = 200, rfdDeficit = 0.5 },
				{ t = 180, vlow = 22 },
				{ t = 420, vlow = 25, lowering = 300 },
				{ t = 900, vlow = 25, occl = 0.3 },
				{ t = 1200, vlow = 23, occl = 0.5, rfdDeficit = 1.2 },
				{ t = 1380, occl = 0.68, rfdDeficit = 2.5 },
			} },
		phases = { { 0, "rotating wall cloud, funnel lowering" }, { 180, "touchdown: dust whirl, cone to the ground" },
			{ 420, "mature: cone to stovepipe" }, { 1000, "shrinking, tilting" }, { 1380, "rope-out" }, { 1800, "debris whirl lingers" } },
		life = 2100, run = 0, hold = false,
		client = { localHour = 17.0, camera = { dist = 2200, yaw = -110 } },
	},
	{
		-- Bowdle SD 2010 / El Reno OK 2013: bowl lowering, cone, stovepipe, widening to a wedge,
		-- multiple vortices as the circulation broadens (swirl past ~1), back to a wedge, narrowing
		-- as it occludes, rope-out.
		id = "life_wedge", label = "L2 Life: long-track wedge, multi-vortex (key /)",
		storm = { W = 48, Ru = 3000, vmid = 26, base = 750, lowering = 250, u = 12, v = 5, rearShare = 0.05, rfdDeficit = 0.5, seed = 122, pw = 12, rhMid = 0.2,
			-- (a drier air mass, as the wedge scene: at the default the wide circulation rained out the
			-- multi-vortex phase into a grey mass, 2026-10-31)
			keys = {
				{ t = 0, vlow = 18, Ru = 3000, W = 48, occl = 0.15 },
				{ t = 240, vlow = 30 },
				{ t = 540, vlow = 38, Ru = 3500 },
				-- (multi-vortex: swirl ~1.5 - W 18 - for strong sub-vortices, and the base ~100 m higher
				-- so the hollow parent's lowering ends ~230 m up and the sub-vortices condense under it
				-- without meeting it. At W 24 / base 750: swirl 1.12, three weak sub-vortices, a wedge
				-- condensed to the ground, 2026-10-31)
				-- (the swirl is the circulation's width over the low-level updraft, W f + vmid / 2:
				-- Ru 8000, W 18 and vmid 18 for ~1.6. W 18 alone left it at 1.14)
				{ t = 900, vlow = 34, Ru = 5500, W = 34, vmid = 26, base = 750 },
				{ t = 1300, base = 850 },
				{ t = 1500, vlow = 26, Ru = 8000, W = 18, vmid = 18 },
				{ t = 1800, base = 850 },
				{ t = 2000, vlow = 34, Ru = 4500, W = 40, vmid = 26, base = 750 },
				{ t = 2400, vlow = 32, Ru = 3000, occl = 0.5, rfdDeficit = 0.5 },
				{ t = 2600, occl = 0.7, rfdDeficit = 2.5 },
			} },
		phases = { { 0, "bowl lowering" }, { 240, "cone touchdown" }, { 540, "stovepipe" }, { 900, "widening to a wedge" },
			{ 1400, "multi-vortex" }, { 2000, "wedge again" }, { 2400, "narrowing, occluding" }, { 2600, "rope-out" } },
		life = 3000, run = 0, hold = false,
		client = { localHour = 16.5, camera = { dist = 3500, yaw = -110 } },
	},
	{
		-- High Plains, high base (Wray CO 2016-like; NWS spotter guide: the dust whirl under the
		-- base is the first sign). Ground-first: a debris whirl under a short funnel aloft; the
		-- condensation lowers toward it as the base comes down; fades from the bottom up.
		id = "life_highbase", label = "L3 Life: high base - dust whirl first (key *)",
		storm = { W = 40, Ru = 2400, vmid = 22, base = 1900, lowering = 100, u = 12, v = 3, rearShare = 0.05, rfdDeficit = 0.5, seed = 123,
			keys = {
				{ t = 0, vlow = 20, base = 1900, lowering = 100, occl = 0.15 },
				{ t = 240, vlow = 34 },
				{ t = 480, vlow = 40, base = 1400, lowering = 150 },
				{ t = 720, base = 1050, lowering = 200 },
				{ t = 900, occl = 0.3 },
				{ t = 960, occl = 0.68, rfdDeficit = 2.0 },
			} },
		phases = { { 0, "dust whirl under a high base" }, { 240, "funnel stub aloft over the whirl" },
			{ 480, "funnel lowers toward the ground" }, { 720, "condensed tube" }, { 960, "rope-out, fades from the bottom" } },
		life = 1200, run = 0, hold = false,
		client = { localHour = 15.5, camera = { dist = 2500, yaw = -110, pitch = 6 } },
	},
	{
		-- a brief rope: a thin funnel under a rotating wall cloud, quickly tilted and roped out by
		-- the RFD (most tornadoes last under 10 min)
		id = "life_rope", label = "L4 Life: brief rope (key +)",
		storm = { W = 32, Ru = 1600, vmid = 18, base = 700, lowering = 120, u = 9, v = 4, rearShare = 0.05, rfdDeficit = 0.5, seed = 124,
			keys = {
				{ t = 0, vlow = 26, occl = 0.3 },
				{ t = 90, vlow = 34 },
				{ t = 150, occl = 0.45 },
				{ t = 200, occl = 0.68, rfdDeficit = 2.5 },
			} },
		phases = { { 0, "funnel lowering" }, { 90, "thin funnel on the ground" }, { 150, "tilting" }, { 200, "rope-out" } },
		life = 420, run = 0, hold = false,
		client = { localHour = 17.5, camera = { dist = 1600, yaw = -110 } },
	},
	-- the mothership: the same supercell in a dry mid-level air mass (LP). Little rain veils its
	-- strongly rotating updraft, so the banded, flared updraft shows from base to anvil
	-- (stormtrack "typical supercell vs mothership"; NWS spotter guide; Moller et al. 1994)
	{
		id = "mothership", label = "M Mothership: LP supercell, dry mid-levels (key Enter)",
		storm = { W = 45, Ru = 3500, vmid = 28, vlow = 9, base = 1400, lowering = 120, u = 10, v = 4, rearShare = 0.05, rfdDeficit = 0.4, seed = 115, occl = 0.1, rhMid = 0.12, pw = 16 },
		run = 120, hold = true, noTornado = true,
		client = { localHour = 17.5, camera = { dist = 14000, yaw = -110, pitch = 8 } },
	},
	-- a wall cloud late in the cycle, no tornado: the RFD has wrapped part way round (occlusion
	-- 0.5), so its rear side is eaten into a horseshoe toward the clear slot (NWS spotter guide)
	{
		id = "wall_cloud", label = "W Wall cloud, occluding, no tornado (key =)",
		storm = { W = 45, Ru = 3000, vmid = 24, vlow = 22, base = 1000, lowering = 350, u = 10, v = 4, rearShare = 0.05, rfdDeficit = 0.5, seed = 116, occl = 0.5 },
		run = 60, hold = true, noTornado = true,
		-- (aimed at the base, as its photo 04_wall_cloud_a: the chase camera ignores pitch and aimed
		-- 1.5 km above the base by default - 29 deg up, the wall cloud at the frame's bottom edge, 2026-11-01)
		client = { localHour = 17.0, camera = { dist = 4500, yaw = -45, lookUp = 0 } },
	},
	-- a tube: a narrow single-celled vortex (swirl ~0.46, no sub-vortices) from a tight low-level
	-- circulation (Ru 1500), condensed ~50 m wide at the ground and ~80 m at 150 m - a near-uniform
	-- column, drawn as every funnel is (its thin body is tube pieces end to end). User 2026-10-30:
	-- the look of the sub-vortex that orbited the cone. (Narrow columns condensed to the ground
	-- come out intense here: EF4)
	{
		id = "tube", label = "K Tube (key K)",
		storm = { W = 28, Ru = 1700, vmid = 13, vlow = 25.3, base = 700, lowering = 120, u = 10, v = 4, rearShare = 0.05, rfdDeficit = 0.5, seed = 112 },
		run = VisualTests.SETTLE, hold = true,
		client = { localHour = 16.5, camera = { dist = 700, yaw = -110 } },
	},
	-- the stovepipe in direct sun (2026-10-30, after the "murky" review: is it opacity or light?).
	-- The sun low in the west (~7 deg, ~35 min before the scenario's 7 pm sunset) gets in under the base
	-- on the storm's rear side; the camera stands west of the tornado with the sun behind it.
	-- (Higher suns are blocked: SceneLight's storm shapes are discs ~2.5 Ru round each storm)
	{
		id = "stovepipe_sun", label = "S Stovepipe, low sun (key G)",
		storm = { W = 36, Ru = 3000, vmid = 19, vlow = 34, base = 750, lowering = 150, u = 12, v = 4, rearShare = 0.05, rfdDeficit = 0.5, seed = 103 }, -- (vlow 34, 2026-11-03: at 30 it left the ground at the weak end of its pulse)
		run = VisualTests.SETTLE, hold = true,
		client = { localHour = 18.4, camera = { dist = 900, yaw = 180 } },
	},
	{
		-- an HP supercell's rain-wrapped wedge (Joplin MO 2011, Hattiesburg MS 2013-like): a broad
		-- circulation with a low, moist base widens a cone into a wedge while the hook's rain wraps
		-- round it (rearShare: the share of the rain released round the rear flank, raised over its
		-- life); late on the RFD occludes it and it narrows in the rain. What hides it is the rain the
		-- storm drops round it, not a veil drawn over it. Swirl kept under ~1 (W 44 with Ru 4500):
		-- one broad vortex, not the L2 multi-vortex phase.
		id = "life_wrapped", label = "L5 Life: rain-wrapped wedge (key ;)",
		-- (base 700 under a 200 m lowering: at 550 / 250 the 300 m left under it was less than the
		-- young vortex's lean, so it was cut off (Tornado: lean past one base height) from birth and
		-- spent its first 4 min as a "rope", 2026-10-31)
		storm = { W = 44, Ru = 3000, vmid = 24, base = 700, lowering = 200, u = 13, v = 6, rfdDeficit = 0.5, seed = 125,
			keys = {
				{ t = 0, vlow = 20, Ru = 3000, occl = 0.15, rearShare = 0.15 },
				{ t = 240, vlow = 30 },
				{ t = 540, vlow = 34, Ru = 4500, rearShare = 0.35 },
				{ t = 900, rearShare = 0.7 },
				{ t = 1500, vlow = 32, occl = 0.5, rfdDeficit = 0.5 },
				{ t = 1700, occl = 0.7, rfdDeficit = 2.5 },
			} },
		phases = { { 0, "lowering in the hook's rain" }, { 240, "cone touchdown" }, { 540, "widening to a wedge" },
			{ 900, "wedge wrapped in rain" }, { 1500, "occluding, narrowing in the rain" }, { 1700, "rope-out, hidden" } },
		life = 2100, run = 0, hold = false,
		client = { localHour = 17.0, camera = { dist = 3000, yaw = -110 } },
	},
	-- Reference shots (2026-10-31, docs/stormlab/SHOTS.md): the whole storm judged against one photo
	-- each, same camera every round. The chaser stands on the inflow side (south-east of the updraft:
	-- camera yaw -50, the storms move east-north-east). lookUp: the aim point above the cloud base (m).
	-- F7 or comma steps through them with the panel open or shut; the status line names the photo.
	{
		id = "shot_classic", label = "P1 Shot: classic supercell, 6 km",
		ref = "docs/storm-reference/real/12_mesocyclone_striations_c.jpg (+ 01_classic_supercell_a.jpg)",
		storm = { W = 45, Ru = 3000, vmid = 24, vlow = 16, base = 1000, lowering = 200, u = 10, v = 4, rearShare = 0.1, rfdDeficit = 0.5, seed = 131, occl = 0.2 },
		run = 120, hold = true, noTornado = true,
		-- (6 km, aimed 2.5 km above the base: the primary photo is taken a few km from the storm with
		-- its striated base filling the upper frame. From 15 km the storm was small in a blue sky -
		-- 35% of the top third against the photo's 0 - whatever the clouds looked like, 2026-11-01)
		client = { localHour = 17.5, camera = { dist = 6000, yaw = -50, lookUp = 2500 } },
	},
	{
		id = "shot_under", label = "P3 Shot: under the base, 2.5 km",
		ref = "docs/storm-reference/real/04_wall_cloud_underside_c.jpg",
		storm = { W = 45, Ru = 3000, vmid = 24, vlow = 16, base = 1000, lowering = 200, u = 10, v = 4, rearShare = 0.1, rfdDeficit = 0.5, seed = 131, occl = 0.2 },
		run = 120, hold = true, noTornado = true,
		client = { localHour = 17.5, camera = { dist = 2500, yaw = -50, lookUp = 500 } },
	},
	{
		id = "shot_hp", label = "P4 Shot: HP supercell, 10 km",
		ref = "docs/storm-reference/real/03_hp_supercell_b.jpg",
		storm = { W = 45, Ru = 4000, vmid = 22, vlow = 18, base = 700, lowering = 200, u = 12, v = 5, rearShare = 0.5, rfdDeficit = 0.5, seed = 132, occl = 0.3, pw = 45, rhMid = 0.75 },
		run = 120, hold = true, noTornado = true,
		client = { localHour = 17.0, camera = { dist = 10000, yaw = -50, lookUp = 500 } },
	},
}

-- the supercell lifecycle (2026-10-31, user: build the supercell through its life). One storm born
-- in view - its tower rising from the cloud base (Storm cloudTop), its anvil spreading once the
-- top reaches the equilibrium level - through organisation, maturity, one occlusion and a new cycle,
-- and then its own physics (Round 38: no keyed decay). Stage times from RESEARCH-SUPERCELL-LIFECYCLE.md
-- (Burgess et al. 1982 cycles ~40-45 min; Klemp & Wilhelmson 1978 splitting 30-60 min). Storm only
-- (L adds a tornado). 2.5 h of storm: watch at 60x (~2.5 min); the server logs [Life] every 10 s.
-- Filmed from 20 km on the inflow side, aimed 3 km above the base so tower and anvil both show.
table.insert(VisualTests.SCENES, {
	id = "life_supercell", label = "SC Supercell + tornado lifecycle, 2.5 h (key ', 60x; tornado part 5-15x)",
	storm = { W = 8, Ru = 1200, vmid = 2, vlow = 2, lowering = 0, u = 10, v = 4, rearShare = 0.1, rfdDeficit = 0.5, seed = 141, fresh = true, genesis = true,
		keys = {
			{ t = 0, W = 8, Ru = 1200, vmid = 2, vlow = 2, lowering = 0, occl = 0, rfdDeficit = 0.5, rearShare = 0.1 },
			{ t = 900, W = 25, Ru = 2000, vmid = 8, vlow = 3 },
			{ t = 1800, W = 35, Ru = 2600, vmid = 16, vlow = 8, lowering = 100 },
			-- (the low-level meso tightens to vlow 30 by 3000 s: at 20 genesis drive peaked at ~0.8,
			-- the threshold, and no tornado formed before the occlusion, 2026-11-01)
			{ t = 2700, W = 42, Ru = 3000, vmid = 22, vlow = 20, lowering = 200 },
			{ t = 3000, vlow = 30, lowering = 300 },
			-- (the occlusion runs to completion before the new meso: a brief one, back to 0.1 within
			-- 5 min, left the tornado alive through both cycles - an hour, 2026-11-01)
			{ t = 3900, vlow = 30, lowering = 300, occl = 0.25 },
			{ t = 4500, vlow = 22, occl = 0.6, rfdDeficit = 2.5 },
			{ t = 5100, vlow = 12, occl = 0.75, rfdDeficit = 3, lowering = 150 },
			{ t = 5400, occl = 0.1, rfdDeficit = 0.8, vlow = 8, lowering = 100 },
			{ t = 6300, vlow = 18, lowering = 300, occl = 0.2, rfdDeficit = 0.8 },
			{ t = 6900, W = 40, occl = 0.5, rfdDeficit = 1.5 },
			-- (Round 38: the second occlusion completes, and from here the storm is its own -
			-- Storm.applyPin free: its updraft, size, rotation and motion ease over 15 min to what its
			-- inflow, shear and outflow give, and it decays only if they end it. The decay was keyed
			-- before - W 25 -> 10 -> 4, Ru 3000 -> 1800 by 9000 s - and drew a skinny tower)
			{ t = 7500, vlow = 6, lowering = 100, occl = 0.7, rfdDeficit = 3, rearShare = 0.4, free = true, dryK = 0 },
			-- (Round 39: and its air changes - the Supercell day's air never ends a free storm (CAPE
			-- 4000+, no CIN; a night's cooling still left 1400-2900 J/kg elevated, a 4 K warm layer
			-- aloft ~150). It runs off the moisture axis into drier air (Storm.environment dryK): the
			-- storm decays from the CAPE that takes - its remembered cloud erodes, its anvil drifts
			-- off, its outflow runs on)
			{ t = 9600, dryK = 16 },
		} },
	phases = { { 0, "towering cumulus" }, { 900, "cumulonimbus, anvil starting" }, { 1800, "organising: mid-level meso, split" },
		{ 2700, "mature: rain-free base, wall cloud" }, { 3000, "low-level meso tightening" }, { 3600, "tornado (cycle 1)" },
		{ 4200, "occluding: tornado ropes out" },
		{ 5400, "new meso to the SE (cycle 2)" }, { 6900, "second occlusion" },
		{ 7500, "free: its own physics" }, { 8400, "decaying: drier inflow" } },
	-- (no tornado is started for it: the storm makes its own when its low-level circulation
	-- organises - Storm genesis - and its occlusion ends it, 2026-11-01)
	life = 12600, run = 0, hold = false, noTornado = true, hillsLead = 3900,
	-- the camera moves in for the wall cloud and tornado and back out for the decay (sim time, so
	-- at any speed; watch the tornado part at 5-15x)
	client = { localHour = 15.0, camera = { dist = 20000, yaw = -50, lookUp = 3000,
		keys = {
			{ t = 0, dist = 20000, lookUp = 3000 },
			{ t = 2400, dist = 20000, lookUp = 3000 },
			{ t = 3000, dist = 9000, lookUp = 800 },
			-- (at 3 km the aim sits below the base - near the wall cloud - so the ground and the
			-- tornado's contact stay in frame; 500 m above it cut the ground off)
			{ t = 3400, dist = 3000, lookUp = -500 },
			{ t = 5100, dist = 3000, lookUp = -500 },
			{ t = 5900, dist = 12000, lookUp = 2000 },
			{ t = 7000, dist = 20000, lookUp = 3000 },
		} } },
})

-- A landspout (2026-11-03, L6; Sim/Landspouts): no mesocyclone. A young cell - no rotation, a high
-- dry-air base - grows over a misocyclone on a boundary (its wind changing 9 m/s across it, the
-- spin ~1 km across); the updraft stretches it, and if it spins up enough it becomes a tornado: a
-- dust column, a thin tube from the flat base, gone once the cell's own rain-cooled outflow
-- undercuts it. Nothing here starts the tornado or shapes it. Key Shift + ;, watch at 5-15x.
table.insert(VisualTests.SCENES, {
	id = "life_landspout", label = "L6 Life: landspout under a growing cell (Shift + ;, 5-15x)",
	storm = { W = 3, Ru = 1300, vmid = 0, vlow = 0, base = 1700, lowering = 0, u = 6, v = 2, rearShare = 0, rfdDeficit = 0, seed = 161,
		fresh = true, genesis = true, pw = 26, rhMid = 0.35,
		keys = {
			{ t = 0, W = 3, Ru = 1300, vmid = 0, vlow = 0, lowering = 0, occl = 0 },
			{ t = 600, W = 10, Ru = 1500 },
			{ t = 1200, W = 18, Ru = 1800 },
			-- (then its own physics: it rains, its outflow spreads, and it fades on its own)
			{ t = 1500, free = true },
		} },
	miso = { dx = 0, dy = 0, r0 = 1000, dv = 9 },
	phases = { { 0, "towering cumulus over a boundary" }, { 600, "updraft stretching the boundary's spin" }, { 1500, "free: its own physics" } },
	life = 2700, run = 0, hold = false, noTornado = true,
	client = { localHour = 16.0, camera = { dist = 3500, yaw = -60, lookUp = 300 } },
})

-- The same lifecycle under a low base (2026-11-02, user: "try a lower base storm"): a moist Gulf
-- air mass - base 800 m, wetter column (pw 40, rhMid 0.7) - as on a humid southern-plains or Dixie
-- day. Everything else (keys, camera, timing) is the SC scene's. Key Shift + '.
do
	local src
	for _, s in VisualTests.SCENES do
		if s.id == "life_supercell" then
			src = s
		end
	end
	if src then
		local sc = table.clone(src)
		sc.id = "life_supercell_low"
		sc.label = "SL Low-base supercell lifecycle, base 800 m (Shift + ', 60x)"
		sc.storm = table.clone(src.storm)
		sc.storm.base, sc.storm.pw, sc.storm.rhMid = 800, 40, 0.7
		local keys = {}
		for i, k in src.storm.keys do
			keys[i] = table.clone(k)
		end
		sc.storm.keys = keys
		table.insert(VisualTests.SCENES, sc)
	end
end

-- Tornado counterparts of the supercell lifecycle (2026-11-02, user: the lifecycle's tornado did
-- not match the stovepipe scene - "have it so our supercell scenarios have a tornado counterpart so
-- the exact tornado ends up touching down"). Each is the SC lifecycle - the storm born in view and
-- organising - whose mature storm IS one tornado scene's storm: its cloud base, air mass (pw,
-- rhMid), motion and seed throughout, and from ~65 min (after the low-level meso has tightened,
-- made its tornado at 40-60 min and broadened again) its updraft, width, mid and low-level meso, lowering, RFD air and
-- rain share. Its own genesis makes the tornado (World: a
-- lab storm's tornado gets the scene's identity, seed x 7 + 11), which lives under the same storm
-- the scene's forced one is run under (the scene holds it settled: SETTLE) - so a few minutes after
-- touchdown it is that scene's tornado. ~25 min of it, then one occlusion ropes it out and the
-- storm decays. The visual clock is the scene's (fixed). Keys from SC up to 30 min.
do
	local byId = {}
	for _, s in VisualTests.SCENES do
		byId[s.id] = s
	end
	local sc = byId.life_supercell
	local targets = {
		{ "cone_partial", "SC2 Life to cone" },
		{ "stovepipe_day", "SC3 Life to stovepipe" },
		{ "wedge_rain", "SC4 Life to wedge" },
		{ "uncondensed", "SC5 Life to uncondensed" },
		{ "multivortex", "SC6 Life to multi-vortex" },
		{ "tube", "SCK Life to tube" },
	}
	for _, tg in targets do
		local src = byId[tg[1]]
		if sc and src then
			local m = src.storm
			local st = table.clone(sc.storm)
			st.u, st.v, st.seed = m.u, m.v, m.seed
			st.pw, st.rhMid = m.pw, m.rhMid
			st.base = m.base
			st.rfdDeficit, st.rearShare = m.rfdDeficit, m.rearShare
			-- the scene's storm, every field the keys blend (occlusion none, as in the scene)
			local mature = { W = m.W, Ru = m.Ru, vmid = m.vmid, vlow = m.vlow, base = m.base, lowering = m.lowering,
				occl = 0, rfdDeficit = m.rfdDeficit, rearShare = m.rearShare }
			local function at(t, extra)
				local k = table.clone(mature)
				k.t = t
				for f, v in extra or {} do
					k[f] = v
				end
				return k
			end
			-- the low-level meso while it organises: at least as tight and strong as the SC scene's
			-- mature storm (W 42, Ru 3000, vlow 30), which makes its tornado ~10-15 min in. The wide
			-- or weak ones (multi-vortex: vlow 18 over Ru 7000) never organised - no tornado by 80
			-- min, 2026-11-02. Once the tornado is down the circulation broadens into the scene's
			-- over 5 min and the tornado settles into the scene's (its time constants are 45-90 s)
			local RuG = math.min(m.Ru, 3000)
			local gen = at(0, { W = math.max(m.W, 42), Ru = RuG, vlow = math.max(m.vlow, 30 * RuG / 3000) })
			-- (the broadening at most 2 m/s of the low meso's drift - it sits 0.6 Ru out from the
			-- updraft, Storm.lowMesoAt: widened from 3000 to 7000 m in 5 min it moved 8 m/s, the
			-- tornado lagged ~400 m behind - its wall cloud's height - and was cut off at once)
			local T1 = 3600 + math.max(300, 0.6 * (m.Ru - RuG) / 2)
			local T2 = T1 + 1500
			local function g(t)
				local k = table.clone(gen)
				k.t = t
				return k
			end
			st.keys = {
				{ t = 0, W = 8, Ru = 1200, vmid = 2, vlow = 2, lowering = 0, occl = 0, base = m.base, rfdDeficit = m.rfdDeficit, rearShare = m.rearShare },
				{ t = 900, W = 25, Ru = 2000, vmid = 8, vlow = 3 },
				{ t = 1800, W = 35, Ru = 2600, vmid = 16, vlow = 8, lowering = 100 },
				-- organising: the low-level meso tightens (the tornado comes ~10-15 min in)
				g(2400),
				-- (held here until the storm has made its tornado - Storm.applyPin waitTornado: at a
				-- fixed 3600-T1 the broadening started before a slow genesis and SC2 never made one)
				(function()
					local k = g(3600)
					k.waitTornado = true
					return k
				end)(),
				-- broadening into the scene's storm, then held through the tornado's mature life
				at(T1),
				at(T2),
				-- one occlusion: the RFD wraps round, the tornado ropes out
				at(T2 + 300, { occl = 0.3 }),
				at(T2 + 600, { vlow = 0.6 * m.vlow, occl = 0.6, rfdDeficit = 2.5 }),
				at(T2 + 900, { vlow = 0.3 * m.vlow, occl = 0.75, rfdDeficit = 3, lowering = 0.5 * m.lowering }),
				-- then the storm is its own (Round 38, Storm.applyPin free; the decay was keyed before)
				{ t = T2 + 1500, vlow = 6, lowering = 100, occl = 0.7, rfdDeficit = 3, rearShare = 0.4, free = true },
			}
			local cam = src.client.camera
			local near = cam.dist or 1000
			table.insert(VisualTests.SCENES, {
				id = "life_to_" .. tg[1], label = tg[2] .. " (60x)",
				counterpart = tg[1],
				storm = st,
				phases = { { 0, "towering cumulus" }, { 900, "cumulonimbus" }, { 1800, "organising" },
					{ 2400, "low-level meso tightening" }, { 3600, "tornado; the meso broadens to the scene's" },
					{ T1, "the " .. tg[1] .. " scene's tornado" }, { T2 + 300, "occluding: rope-out" }, { T2 + 1500, "free: its own physics" } },
				life = T2 + 3300, run = 0, hold = false, noTornado = true, hillsLead = 3400,
				client = { localHour = src.client.localHour or 16.5, camera = { dist = 20000, yaw = cam.yaw or -110, lookUp = 3000,
					waitAt = 3600, stormId = "LAB" .. tostring(st.seed),
					keys = {
						{ t = 0, dist = 20000, lookUp = 3000 },
						{ t = 2100, dist = 20000, lookUp = 3000 },
						{ t = 2700, dist = 9000, lookUp = 800 },
						{ t = 3200, dist = near, lookUp = -0.5 * m.base },
						{ t = T2 + 900, dist = near, lookUp = -0.5 * m.base },
						{ t = T2 + 1500, dist = 12000, lookUp = 2000 },
						{ t = T2 + 2400, dist = 20000, lookUp = 3000 },
					} } },
			})
		end
	end
end

-- the reference shots in F7 order: { scene id, photo } (P2 and P5 are existing scenes)
-- A cell merging into a supercell (2026-11-01): a mature supercell and a smaller cell 15 km to its
-- south-west, running in along its flank (~10 m/s faster toward the north-east). World stepStorms
-- draws the cell in once their updrafts are within 0.6 (Ru1 + Ru2): it hands its updraft over in
-- ~10 min and the supercell strengthens and widens for ~15 min after. Nothing here forces it.
table.insert(VisualTests.SCENES, {
	id = "merger", label = "MG Cell merging into a supercell, 50 min (key `, 15-60x)",
	storm = { W = 45, Ru = 3000, vmid = 24, vlow = 16, base = 1000, lowering = 200, u = 10, v = 4, rearShare = 0.1, rfdDeficit = 0.5, seed = 151, occl = 0.2 },
	storm2 = { W = 25, Ru = 1800, vmid = 8, vlow = 3, base = 1000, lowering = 0, u = 17, v = 11, rearShare = 0.1, rfdDeficit = 0.5, seed = 152, occl = 0, dx = -11000, dy = -11000 },
	phases = { { 0, "two storms: supercell + cell to its SW" }, { 600, "cell closing in" }, { 1200, "merging" }, { 2400, "merged: one stronger storm" } },
	life = 3000, run = 0, hold = false, noTornado = true,
	client = { localHour = 16.0, camera = { dist = 22000, yaw = -60, lookUp = 3000 } },
})

VisualTests.SHOTS = {
	{ id = "shot_classic", tag = "P1" },
	{ id = "wall_cloud", tag = "P2", ref = "docs/storm-reference/real/04_wall_cloud_a.jpg" },
	{ id = "shot_under", tag = "P3" },
	{ id = "shot_hp", tag = "P4" },
	{ id = "mothership", tag = "P5", ref = "docs/storm-reference/real/02_lp_supercell_b.jpg" },
	{ id = "life_supercell", tag = "SC", ref = "13_towering_cumulus_b -> 01_classic_supercell_a -> 07_shelf_cloud_a (stage by stage)" },
}

function VisualTests.byId(id: string): any?
	for _, s in VisualTests.SCENES do
		if s.id == id then
			return s
		end
	end
	return nil
end

return VisualTests
