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

-- where the lab scenes are built (sim metres): the scenario's south-west corner, away from its
-- storms (ground tiles follow the camera)
VisualTests.SITE = { x = -80000, y = -80000 }

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
		storm = { W = 40, Ru = 3200, vmid = 20, vlow = 27, base = 670, lowering = 150, u = 11, v = 5, rearShare = 0.05, rfdDeficit = 0.5, seed = 102 },
		run = 150, hold = true,
		client = { localHour = 16.5, camera = { dist = 1500, yaw = -110 } },
	},
	{
		id = "stovepipe_day", label = "3 Stovepipe, daylight",
		-- (vlow 36: condensed 53 m wide at the ground to ~126 m at 250 m - a column with a broad
		-- ground contact. At 30 it condensed only above ~20 m and tapered to a point, 2026-10-30)
		storm = { W = 45, Ru = 2600, vmid = 26, vlow = 36, base = 750, lowering = 150, u = 12, v = 4, rearShare = 0.05, rfdDeficit = 0.5, seed = 103 },
		run = 150, hold = true,
		client = { localHour = 16.0, camera = { dist = 1500, yaw = -110 } },
	},
	{
		id = "wedge_rain", label = "4 Wedge",
		-- (2026-10-30: Ru 6000 made ~2700 t/s of rain over a ~9 km footprint that swallowed the
		-- tornado - sight 0.09, a grey ceiling. Ru 4500 and a drier air mass (pw, rhMid: lower
		-- precipitation efficiency) keep it a wedge that can be seen; the rain-wrap toggle still
		-- wraps it)
		storm = { W = 48, Ru = 4500, vmid = 26, vlow = 26, base = 600, lowering = 250, u = 14, v = 6, rearShare = 0.05, rfdDeficit = 0.5, seed = 104, pw = 12, rhMid = 0.2 },
		run = 240, hold = true,
		client = { localHour = 16.5, camera = { dist = 3000, yaw = -110 } },
	},
	{
		id = "uncondensed", label = "5 Nearly uncondensed, ground dust",
		storm = { W = 38, Ru = 3000, vmid = 18, vlow = 17, base = 2000, lowering = 60, u = 12, v = 3, rearShare = 0.05, rfdDeficit = 0.5, seed = 105 },
		run = 150, hold = true,
		client = { localHour = 15.0, camera = { dist = 1000, yaw = -110 } },
	},
	{
		id = "multivortex", label = "6 Multi-vortex",
		storm = { W = 30, Ru = 8000, vmid = 20, vlow = 22, base = 700, lowering = 150, u = 12, v = 5, rearShare = 0.05, rfdDeficit = 0.5, seed = 106 },
		run = 200, hold = true,
		-- (a 550 m base: the parent condenses only aloft, so the sub-vortices show below it - at a
		-- 350 m base it was a wedge that hid them; and ~2 km wide: from 1.6 km it filled the view)
		client = { localHour = 16.5, camera = { dist = 2600, yaw = -110 } },
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
	-- tornadogenesis, live (not held: watch it form). Each storm differs only in its fields - how
	-- wide and strong its low-level circulation, how high its cloud base - and the way its tornado
	-- forms follows from them (Sim/Tornado: the young vortex is the parent's circulation before the
	-- updraft has stretched it). Spotter references: a funnel lowering from the wall cloud; a
	-- debris whirl on the ground before the condensation reaches it (Wikipedia "Funnel cloud";
	-- NWS spotter guides); the wall cloud contracting and lowering as genesis nears (VORTEX2 wall
	-- cloud studies, AMS 27SLS paper 254110).
	{
		id = "gen_funnel", label = "G1 Genesis: thin funnel lowers (key .)",
		storm = { W = 48, Ru = 1600, vmid = 22, vlow = 26, base = 650, lowering = 150, u = 10, v = 4, rearShare = 0.05, rfdDeficit = 0.5, seed = 111, occl = 0.2 },
		run = 0, hold = false,
		client = { localHour = 17.0, camera = { dist = 1500, yaw = -110 } },
	},
	{
		id = "gen_bowl", label = "G2 Genesis: broad bowl lowers (key /)",
		storm = { W = 48, Ru = 4500, vmid = 26, vlow = 40, base = 750, lowering = 250, u = 12, v = 5, rearShare = 0.05, rfdDeficit = 0.5, seed = 112, occl = 0.2 },
		run = 0, hold = false,
		client = { localHour = 16.5, camera = { dist = 2200, yaw = -110 } },
	},
	{
		id = "gen_whirl", label = "G3 Genesis: ground whirl, then condenses (key *)",
		storm = { W = 45, Ru = 2400, vmid = 22, vlow = 38, base = 1100, lowering = 100, u = 12, v = 3, rearShare = 0.05, rfdDeficit = 0.5, seed = 113, occl = 0.2 },
		run = 0, hold = false,
		client = { localHour = 15.5, camera = { dist = 1500, yaw = -110 } },
	},
	{
		id = "gen_multi", label = "G4 Genesis: several vortices draw together (key +)",
		storm = { W = 34, Ru = 4500, vmid = 22, vlow = 28, base = 650, lowering = 150, u = 12, v = 5, rearShare = 0.05, rfdDeficit = 0.5, seed = 114, occl = 0.2 },
		run = 0, hold = false,
		client = { localHour = 16.5, camera = { dist = 2400, yaw = -110 } },
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
		client = { localHour = 17.0, camera = { dist = 4500, yaw = -45, pitch = 6 } },
	},
	-- a tube: a narrow single-celled vortex (swirl ~0.46, no sub-vortices) from a tight low-level
	-- circulation (Ru 1500), condensed ~50 m wide at the ground and ~80 m at 150 m - a near-uniform
	-- column, drawn as every funnel is (its thin body is tube pieces end to end). User 2026-10-30:
	-- the look of the sub-vortex that orbited the cone. (Narrow columns condensed to the ground
	-- come out intense here: EF4)
	{
		id = "tube", label = "K Tube (key K)",
		storm = { W = 35, Ru = 1500, vmid = 18, vlow = 30, base = 700, lowering = 120, u = 10, v = 4, rearShare = 0.05, rfdDeficit = 0.5, seed = 112 },
		run = 150, hold = true,
		client = { localHour = 16.5, camera = { dist = 1200, yaw = -110 } },
	},
	-- the stovepipe in direct sun (2026-10-30, after the "murky" review: is it opacity or light?).
	-- The sun low in the west (~7 deg, ~35 min before the scenario's 7 pm sunset) gets in under the base
	-- on the storm's rear side; the camera stands west of the tornado with the sun behind it.
	-- (Higher suns are blocked: SceneLight's storm shapes are discs ~2.5 Ru round each storm)
	{
		id = "stovepipe_sun", label = "S Stovepipe, low sun (key G)",
		storm = { W = 45, Ru = 2600, vmid = 26, vlow = 36, base = 750, lowering = 150, u = 12, v = 4, rearShare = 0.05, rfdDeficit = 0.5, seed = 103 },
		run = 150, hold = true,
		client = { localHour = 18.4, camera = { dist = 1500, yaw = 180 } },
	},
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
