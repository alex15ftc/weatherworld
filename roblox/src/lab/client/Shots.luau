--!strict
-- The capture shot list (Phase 0 of the A+ plan): fixed framings so every grade compares like
-- with like. U steps to the next shot, Y back; the panel hides while shots are on (H shows it).
-- Each shot is printed to the output as "[Shot] n/N name", and tools/lookmetrics/shots.json has
-- the matching crop and measuring rows for the ones with a reference.
--
--   reference shots   a look framed like its reference image (same horizon height, funnel size)
--   sweep             every look from 8 bearings at 3 heights, plus from underneath
local Shots = {}

export type Shot = {
	name: string,
	look: string, -- Presets.LOOKS name
	camera: { [string]: number }, -- LabConfig.camera fields
	ref: string?, -- docs/tornado-reference file
}

-- Framed to match the reference images (tuned with tools/lookmetrics).
Shots.REFERENCE = {
	{ name = "ref1", look = "Ref1 cone", ref = "ref1_image.png",
		camera = { yaw = 0, distance = 600, eyeHeight = 6, lookHeight = 360, fov = 75 } },
	{ name = "ref3", look = "Sepia cone", ref = "ref3_spoiler_image.png",
		camera = { yaw = 0, distance = 1400, eyeHeight = 6, lookHeight = 300, fov = 60 } },
	{ name = "ref4", look = "Rope-out", ref = "ref4_ropeout.png",
		camera = { yaw = 0, distance = 700, eyeHeight = 6, lookHeight = 320, fov = 60 } },
	{ name = "iov14", look = "Dark wedge", ref = "frames/full/iov_14.png",
		camera = { yaw = 0, distance = 700, eyeHeight = 6, lookHeight = 240, fov = 85 } },
	{ name = "ref5", look = "Forming", ref = "ref5_subs1.png",
		camera = { yaw = 0, distance = 600, eyeHeight = 6, lookHeight = 300, fov = 70 } }, -- within the ~800-stud particle range
	{ name = "whitecone", look = "White cone", ref = "frames/clip_2026-02-28_11-04-14_sheet.jpg",
		camera = { yaw = 0, distance = 650, eyeHeight = 6, lookHeight = 330, fov = 70 } },
} :: { Shot }

-- Storm mode (key N): the replay's tornado storm from a chaser's distances (yaw 45: from the
-- south-east, the usual view of a supercell's updraft with the rain beyond it). Horizontal
-- scale ~621 studs a km, vertical 1 stud a metre. `frame`: the replay frame to show.
Shots.STORM = {
	-- matched to references (tools/lookmetrics/storm_metrics.py): hourShift moves the replay's
	-- clock (12:20 local at frame 14) so the light matches the photo's
	{ name = "storm / ref S1 classic structure (01_classic_supercell_b)", frame = 14, localHour = 17.5, ref = "real/01_classic_supercell_b.jpg",
		camera = { yaw = 292, distance = 13000, eyeHeight = 6, lookHeight = 6000, fov = 66 } }, -- (the low sun behind-left; the storm filling the frame, as in the photo)
	{ name = "storm / ref S2 base edge (12_mesocyclone_striations_c)", frame = 14, localHour = 16.5, ref = "real/12_mesocyclone_striations_c.jpg",
		camera = { yaw = 45, distance = 5000, eyeHeight = 6, lookHeight = 1100, fov = 70 } }, -- (the inflow side: out of the rain)
	{ name = "storm / structure 40 km", frame = 14, camera = { yaw = 45, distance = 25000, eyeHeight = 6, lookHeight = 5000, fov = 50 } },
	{ name = "storm / structure 20 km", frame = 14, camera = { yaw = 45, distance = 12500, eyeHeight = 6, lookHeight = 3000, fov = 60 } },
	{ name = "storm / base 8 km", frame = 14, camera = { yaw = 45, distance = 5000, eyeHeight = 6, lookHeight = 800, fov = 70 } },
	{ name = "storm / base 3 km", frame = 14, camera = { yaw = 45, distance = 2000, eyeHeight = 6, lookHeight = 600, fov = 80 } },
	{ name = "storm / under the base", frame = 14, camera = { yaw = 45, distance = 600, eyeHeight = 6, lookHeight = 1500, fov = 90 } },
	{ name = "storm / aerial 30 km", frame = 14, camera = { yaw = 45, distance = 20000, eyeHeight = 6000, lookHeight = 3000, fov = 60 } },
	{ name = "storm / from the rain side", frame = 14, camera = { yaw = 225, distance = 12500, eyeHeight = 6, lookHeight = 3000, fov = 60 } },
	{ name = "storm / before touchdown", frame = 10, camera = { yaw = 45, distance = 5000, eyeHeight = 6, lookHeight = 800, fov = 70 } },
	-- ahead of a line (key 0: the line replay), facing its shelf cloud (yaw from the storm's shelf)
	{ name = "storm / line ahead of the shelf 15 km", frame = 19, yawFrom = "shelf", camera = { distance = 9000, eyeHeight = 6, lookHeight = 1500, fov = 75 } },
	{ name = "storm / line under the shelf 4 km", frame = 19, yawFrom = "shelf", camera = { distance = 2500, eyeHeight = 6, lookHeight = 1200, fov = 85 } },
	-- from the west, 20 km: a late-day sun behind the camera (shift the hour with ' to ~5 pm)
	{ name = "storm / from the west 20 km", frame = 14, camera = { yaw = 270, distance = 12500, eyeHeight = 6, lookHeight = 3000, fov = 60 } },
}

local BEARINGS = { 0, 45, 90, 135, 180, 225, 270, 315 }
local HEIGHTS = {
	{ tag = "ground", eyeHeight = 6, lookHeight = 330 },
	{ tag = "raised", eyeHeight = 250, lookHeight = 250 },
	{ tag = "aerial", eyeHeight = 1100, lookHeight = 150 },
}

-- Every look from every side: 8 bearings x 3 heights, plus underneath (looking up the funnel).
function Shots.sweep(looks: { any }): { Shot }
	local list = {}
	for _, look in looks do
		for _, h in HEIGHTS do
			for _, yaw in BEARINGS do
				table.insert(list, {
					name = string.format("%s / %s %d", look.name, h.tag, yaw),
					look = look.name,
					camera = { yaw = yaw, distance = 700, eyeHeight = h.eyeHeight, lookHeight = h.lookHeight, fov = 70 },
				})
			end
		end
		table.insert(list, {
			name = look.name .. " / underneath",
			look = look.name,
			camera = { yaw = 0, distance = 40, eyeHeight = 4, lookHeight = 2000, fov = 90 },
		})
	end
	return list
end

-- The full list: reference shots first, then the sweep.
function Shots.all(looks: { any }): { Shot }
	local list = table.clone(Shots.REFERENCE)
	for _, s in Shots.sweep(looks) do
		table.insert(list, s)
	end
	return list
end

return Shots
