--!nonstrict
-- Deterministic visual test scenes (docs/stormlab/TORNADO-VISUALS.md; the visual plan's section
-- 10 test list). Each scene builds a lab storm at a fixed place with pinned fields (Storm.applyPin)
-- and a fixed seed, starts its tornado, runs it for `run` seconds and (optionally) holds its life
-- stage (Tornado hold: it keeps moving and animating). Everything you then see - funnel shape,
-- condensation, rain, dust, sub-vortices - comes from the same physics as a natural tornado; the
-- pins only make the scene repeatable.
--   storm    pinned storm fields (sim units): W, Ru, vmid, vlow, base, lowering, u, v, rearShare
--            (share of rain released round the rear flank: rain wrapping), vlowLater / laterAt
--            (the circulation's supply changing during the run: rope-out)
--   run      seconds the tornado runs before the shot; hold: keep that stage
--   client   localHour (visual clock override, local solar time), flashes = { {at, kind,
--            distance, bearing, height, current} } relative to the tornado (seconds after the
--            scene starts, repeating every `flashEvery` if set), camera preset, show toggles
local VisualTests = {}

-- where the lab scenes are built (sim metres): the scenario's south-west corner, away from its
-- storms (ground tiles follow the camera)
VisualTests.SITE = { x = -80000, y = -80000 }

VisualTests.SCENES = {
	{
		id = "rope_day", label = "1 Rope, daylight",
		storm = { W = 32, Ru = 2000, vmid = 16, vlow = 22, base = 380, lowering = 100, u = 9, v = 4, vlowLater = 5, laterAt = 85, rearShare = 0.05, rfdDeficit = 0.5, seed = 101 },
		run = 135, hold = true,
		client = { localHour = 17.5, camera = { dist = 1400, yaw = -110 } },
	},
	{
		id = "cone_partial", label = "2 Cone, condensed to the ground",
		storm = { W = 40, Ru = 3200, vmid = 20, vlow = 20, base = 670, lowering = 150, u = 11, v = 5, rearShare = 0.05, rfdDeficit = 0.5, seed = 102 },
		run = 150, hold = true,
		client = { localHour = 16.5, camera = { dist = 1500, yaw = -110 } },
	},
	{
		id = "stovepipe_day", label = "3 Stovepipe, daylight",
		storm = { W = 45, Ru = 2600, vmid = 26, vlow = 30, base = 750, lowering = 150, u = 12, v = 4, rearShare = 0.05, rfdDeficit = 0.5, seed = 103 },
		run = 150, hold = true,
		client = { localHour = 16.0, camera = { dist = 1500, yaw = -110 } },
	},
	{
		id = "wedge_rain", label = "4 Wedge, rain-wrapped",
		storm = { W = 48, Ru = 6000, vmid = 26, vlow = 26, base = 600, lowering = 250, u = 14, v = 6, rearShare = 0.7, rfdDeficit = 0.5, seed = 104 },
		run = 240, hold = true,
		client = { localHour = 16.5, camera = { dist = 3500, yaw = -110 } },
	},
	{
		id = "uncondensed", label = "5 Nearly uncondensed, ground dust",
		storm = { W = 38, Ru = 3000, vmid = 18, vlow = 17, base = 2000, lowering = 60, u = 12, v = 3, rearShare = 0.05, rfdDeficit = 0.5, seed = 105 },
		run = 150, hold = true,
		client = { localHour = 15.0, camera = { dist = 1000, yaw = -110 } },
	},
	{
		id = "multivortex", label = "6 Multi-vortex",
		storm = { W = 30, Ru = 8000, vmid = 20, vlow = 22, base = 500, lowering = 150, u = 12, v = 5, rearShare = 0.05, rfdDeficit = 0.5, seed = 106 },
		run = 200, hold = true,
		client = { localHour = 16.5, camera = { dist = 1600, yaw = -110 } },
	},
	{
		id = "night_dark", label = "7 Night, no lightning",
		storm = { W = 40, Ru = 3400, vmid = 20, vlow = 21, base = 800, lowering = 200, u = 11, v = 4, rearShare = 0.05, rfdDeficit = 0.5, seed = 107 },
		run = 150, hold = true,
		client = { localHour = 22.5, camera = { dist = 1500, yaw = -110 } },
	},
	{
		id = "night_ic_near", label = "8 Night, nearby intracloud flash",
		storm = { W = 40, Ru = 3400, vmid = 20, vlow = 21, base = 800, lowering = 200, u = 11, v = 4, rearShare = 0.05, rfdDeficit = 0.5, seed = 107 },
		run = 150, hold = true,
		client = { localHour = 22.5, camera = { dist = 1500, yaw = -110 }, flashEvery = 6,
			flashes = { { at = 2, kind = "ic", distance = 2500, bearing = 30, height = 6000, current = 0 } } },
	},
	{
		id = "night_cg_far", label = "9 Night, distant ground flash",
		storm = { W = 40, Ru = 3400, vmid = 20, vlow = 21, base = 800, lowering = 200, u = 11, v = 4, rearShare = 0.05, rfdDeficit = 0.5, seed = 107 },
		run = 150, hold = true,
		client = { localHour = 22.5, camera = { dist = 1500, yaw = -110 }, flashEvery = 6,
			flashes = { { at = 2, kind = "cg", distance = 14000, bearing = 70, height = 6000, current = 30 } } },
	},
	{
		id = "night_multi", label = "0 Night, closely spaced flashes",
		storm = { W = 40, Ru = 3400, vmid = 20, vlow = 21, base = 800, lowering = 200, u = 11, v = 4, rearShare = 0.05, rfdDeficit = 0.5, seed = 107 },
		run = 150, hold = true,
		client = { localHour = 22.5, camera = { dist = 1500, yaw = -110 }, flashEvery = 8,
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
