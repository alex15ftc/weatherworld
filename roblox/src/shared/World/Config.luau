--!strict
-- World scale and chunk settings shared by server and client.
-- Distances are compressed (STUDS_PER_MILE); objects (houses, roads, trees, cars) stay true size.
-- See docs/ROBLOX-SCALE.md for why one engine region is about 50 miles wide.

local Config = {}

Config.SEED = 1

-- Horizontal: 1000 studs per engine mile. The map is centred on the origin, so every coordinate
-- stays under 262,144 studs (1/64-stud float precision). At the fixed 12x clock a 41 mph storm
-- moves 137 studs/s, so chasing needs cars around 170 studs/s on highways.
Config.STUDS_PER_MILE = 1000
Config.MAP_MILES = 500
Config.MAP_STUDS = Config.MAP_MILES * Config.STUDS_PER_MILE -- 500,000
Config.REGION_MILES = 50

-- Vertical: separate from horizontal so hills do not become cliffs.
Config.STUDS_PER_METRE_VERTICAL = 1

-- Storms (server/WeatherFeed, shared/Weather, client/StormView). Clouds and tornadoes go up at 1
-- stud a metre, as the ground does (STUDS_PER_METRE_VERTICAL), so a cloud base, a funnel and the
-- hills keep their true heights against each other (2026-10-15; it was 0.62, the map's scale
-- across, which made every funnel look squat). A tornado is drawn 1 stud a metre across too,
-- wider than the map scale, because houses and cars are true size and a tornado shrunk to the
-- map would be smaller than a farmstead.
Config.KM_PER_MILE = 1.609344
Config.SKY_STUDS_PER_METRE = Config.STUDS_PER_METRE_VERTICAL
Config.TORNADO_STUDS_PER_METRE = 1
Config.STORM_VIEW_MILES = 60 -- storms drawn within this distance of the camera
-- The map point (km east and south of the north-west corner) at stud x = z = 0. nil: the map's
-- centre (the game). The tornado lab puts its storm replay's touchdown there (the attribute
-- ViewOriginMiles, a Vector2 of map miles, on ReplicatedStorage, set before this loads), so the
-- storm plays over the lab's own field.
Config.VIEW_ORIGIN_KM = (function(): { x: number, y: number }?
	local miles = game:GetService("ReplicatedStorage"):GetAttribute("ViewOriginMiles")
	if typeof(miles) == "Vector2" then
		return { x = miles.X * 1.609344, y = miles.Y * 1.609344 }
	end
	return nil
end)()
-- Rain and hail drawn: the shafts, the hail core and the rain wrapping round the rotation, and the
-- haze of being in them (client/StormView, client/SkyLight). Off for now (2026-10-22): as smooth
-- shapes they read as walls hiding the tornado; back on once they are textured curtains. The rain
-- falling at the camera is drawn either way.
Config.SHOW_PRECIPITATION = true
-- The storm's smaller cloud features: scud turning under the wall cloud, the tail cloud, inflow
-- bands and the shelf cloud (client/StormView). Off for now (2026-10-22): as smooth shapes, the
-- inflow bands and shelf (kilometres long, low) stood in front of the tornado. The towers, base,
-- anvil and wall cloud are drawn either way.
Config.SHOW_CLOUD_DETAIL = true
-- The nearest storms (up to `storms`, within maxMiles) drawn as lit volumes instead of puffs
-- (client/CloudVolume): pixels square, steps along each ray; `workers` parallel threads render
-- them (budgetMs a frame on the main thread when none are ready); sigma the extinction per stud at
-- full density, lightStep the studs between light samples toward the sun, noise how far noise
-- moves the cloud's edge, sunLight / skyLight scale the two lights. Prototype (2026-10-22).
Config.VOLUME_CLOUDS = {
	enabled = false, -- (2026-10-22: too slow and not realistic enough in-game; puffs instead)
	maxMiles = 30,
	storms = 2,
	workers = 4,
	pixels = 224,
	steps = 48,
	budgetMs = 4,
	sigma = 0.004,
	lightStep = 500,
	noise = 0.45,
	sunLight = 1.0,
	skyLight = 0.8,
	-- In the world the image shows darker than its pixel values (as if a gamma of about 2 were
	-- applied again); its colours are raised by 1 / displayGamma to undo that.
	displayGamma = 1.0,
	-- The picture hangs at most this far from the camera (scaled to match): Roblox's distance
	-- haze would otherwise grey out a storm 10 miles off, toward the haze colour SkyLight darkens
	-- under storms. The cloud's own distance haze is applied in rendering instead: toward
	-- hazeColour, as far as hazeStuds sees.
	displayDepth = 2500,
	hazeStuds = 60000,
	hazeColour = Color3.fromRGB(176, 184, 196),
}
-- The clouds' art (tools/blender/cloud_puff.py, rain_curtain.py): clouds built of camera-facing
-- puffs that drift, turn and fade in and out, and rain and hail as streaked curtains falling from
-- the base. Empty ids fall back to plain shapes.
Config.CLOUD_ART = {
	puffs = {
		"rbxassetid://91801174733216",
		"rbxassetid://114182869199843",
		"rbxassetid://77345690330399",
		"rbxassetid://85375937451433",
	},
	rain = "rbxassetid://90181346392042",
	rainShaft = "rbxassetid://86246653635299", -- tools/rain/rain_shaft.py: a distant shaft (soft column, faint streaks)
	nearRain = "rbxassetid://105774957466433",
	hailstone = "rbxassetid://75884893304957", -- tools/rain/splash_hail.py (solid; needs a Studio restart to load when new)
	splash = "rbxassetid://139159847503182", -- tools/rain/near_rain.py: bold streaks for the rain round the camera
}
-- The older blob/puff storm clouds (StormView drawClouds), used for the storms StormMesh doesn't
-- draw: redrawn every intervalSeconds (staggered), every frame only within everyFrameMiles.
Config.STORM_OLD_CLOUDS = { intervalSeconds = 0.3, everyFrameMiles = 4 }
-- Storm-scale cloud as shaded shells (client/StormMesh, shared/Weather/CloudShell): the tower,
-- anvil and base (with the wall cloud) drawn from the storm's fields; replaces the blob/puff
-- tower, base, anvil and wall cloud. Shapes are rebuilt every reshapeSeconds; shading every frame.
Config.STORM_MESH = {
	enabled = true,
	-- "puffs": particles (the tornado's way: soft, volumetric) on the same shapes; "shells": meshes
	style = "hybrid", -- or "shells" (meshes only), "puffs" (particles only)
	-- hybrid: particle detail over the shells (rows, columns of the shape grid; size x the gap to
	-- the next puff; inset: its middle this share of its size inside the surface)
	detail = {
		-- (maxKm: no bigger; spaced round a base 10 km wide, puffs came out 6 km and hung to the
		-- ground as a grey skirt round the storm)
		-- (2026-10-23: denser and smaller; the cauliflower is the particles' job, the shell a smooth
		-- core under them, as the tornado's ribbon is under its puffs)
		tower = { 26, 40, texture = "lumpyFlat", sizeX = 1.8, maxKm = 1.3, inset = 0.25, transparency = 0.05 },
		-- (the underside and the rim: the rim's puffs bigger, so no hard plate edge shows)
		-- the shelf's underside (whale's mouth) and ragged leading edge
		shelf = { 30, 12, texture = "lumpyFlat", sizeX = 1.6, maxKm = 0.9, inset = 0.2, transparency = 0.2, albedo = 0.7,
			keep = function(_i: number, j: number, _rows: number, cols: number): boolean
				local a = 2 * math.pi * (j - 1) / cols
				return math.sin(a) < 0.2
			end },
		base = { 14, 44, texture = "lumpyFlat", sizeX = 1.7, maxKm = 0.9, inset = 0.1, transparency = 0.2, fromRow = 1, toRow = 10, albedo = 1.0 },
		-- the anvil: frayed sides all along; billows over the top of its young (upwind) part
		anvil = { 30, 24, texture = "lumpyFlat", sizeX = 2.0, maxKm = 2.2, inset = 0.1, transparency = 0.05,
			keep = function(i: number, j: number, rows: number, cols: number): boolean
				local a = 2 * math.pi * (j - 1) / cols
				-- the sides all along, and the whole top over the young two thirds
				-- (everywhere over the young two thirds, top and underside; the frayed sides beyond)
				return math.abs(math.cos(a)) > 0.6 or i < rows * 0.7
			end },
	},
	scud = {
		count = 24, -- at full wall cloud strength
		from = 0.8, to = 2.6, -- out from the wall cloud's middle, x its radius
		depthM = 350, -- they form this far under the base and rise into it
		cycle = 40, -- seconds from forming to merging
		sizeKm = 0.35,
		albedo = 0.55,
		transparency = 0.25,
		texture = "shredFlat",
	},
	-- rain shafts: streaked Beams (CLOUD_ART.rain), one a column
	rain = {
		columns = 12, -- (without the radar grid: spread over the rain ellipse)
		minDbz = 35, -- with the grid: a shaft over each cell this strong ...
		fullDbz = 60, -- ... fully dense at this
		maxCells = 40, -- the strongest this many cells
		cellWidth = 1.3, -- shaft width, x the cell size (overlapping)
		widthKm = 1.5,
		scroll = 0.15, -- texture lengths a second (the shaft's unevenness drifting down)
		streakStuds = 2000, -- one texture repeat, at full scale (slow, broad variation down the shaft)
		floor = 0.25, -- the least a shaft shows (light rain) ...
		opacity = 0.65, -- ... plus this x the intensity (heavier in the middle of the shaft)
		albedo = 0.4,
		hailWhite = 0.6,
		lit = 0.35, -- the sun reaching into a shaft
	},
	puffs = {
		reach = 650, -- the storm's copy drawn within this many studs (particles stop at ~800)
		exposure = 1.2,
		reshapeSeconds = 0.5,
		life = 10, -- seconds a particle lives (it fades in and out)
		perPuff = 2, -- particles alive per puff
		transparency = 0.05,
		-- rows, columns of the shape grid each body's puffs sit on; texture; size scale; rows used
		bodies = {
			tower = { 18, 26, texture = "mediumFlat", sizeX = 2.3, transparency = 0.05 },
			anvil = { 22, 16, texture = "softFlat", sizeX = 2.3, maxKm = 2.6, transparency = 0.05 }, -- (no rounder than the anvil is thick)
			base = { 12, 26, texture = "lumpyFlat", sizeX = 2.3, transparency = 0.05, fromRow = 1, toRow = 6 },
		},
	},
	storms = 1, -- the nearest this many storms (EditableMeshes share a memory budget); the rest as before
	reshapeSeconds = 3,
	-- the shelf cloud (StormMesh shelfShape), from the feed's shelf and gustFront: drawn above
	-- minStrength, full at fullStrength; depthKm from nose to where it meets the base; the nose at
	-- noseShare of shelf.heightM; the top riseM above the base at full strength; tiers stepped by
	-- tierStep of the rise; the underside lumpy (lumpM, lumps lumpKm across) and darker
	shelf = { minStrength = 0.08, fullStrength = 0.35, depthKm = 3.5, noseShare = 0.55, riseM = 300,
		tierStep = 0.35, lumpM = 220, lumpKm = 1.2, albedo = 0.85, underAlbedo = 0.5 },
	-- line storms: stretched along the line once its linear share passes fromShare; a bowing line's
	-- middle ahead by bowShare x its half length at full bow
	line = { fromShare = 0.3, bowShare = 0.25 },
	-- the storm's life (the feed's `life`): a young tower's lobes bigger by toweringLobes; a
	-- collapsing one slimmer by decaySlim and its puffs see-through by decayFray; an orphan
	-- anvil thins by anvilThin as it fades, its solid core gone after anvilShellUntil
	life = { toweringLobes = 0.8, decaySlim = 0.35, decayFray = 0.6, anvilThin = 0.7, anvilShellUntil = 0.5 }, -- (motion is smooth between reshapes; this is only the slow churn)
	shapeBudgetMs = 2, -- a reshape's work per frame (spread over frames)
	shadesPerFrame = 1, -- shells re-coloured a frame at most (only those whose light or view changed)
	-- soft edges: a see-through copy of each shell, this share of its size outside it, fading out
	-- where it turns edge-on (light.soft)
	fringe = { enabled = true, out = 0.012 }, -- (further out, its normals crossed in the creases: shards)
	resolution = { tower = { 72, 100 }, anvil = { 80, 48 }, base = { 26, 96 }, shelf = { 120, 24 } }, -- rows, columns
	tower = {
		squareness = 0.45, -- <1: straighter sides, flatter bottom (1: a sphere)
		taper = 0.18, -- narrower at the top by this share
		lean = 0.18, -- the top this far downwind, x the tower's height
		lobes = 0.1, -- (steeper, the lobes stepped between neighbouring columns: shards side-on) -- big lobes' bulge, x the radius, at the top of a fast updraught (the fine
		-- cauliflower is the detail particles'; more here folds the surface over itself)
		lobeKm = 1.7, -- the size of a cauliflower lobe (noise in real km, round)
		crease = 0.35, -- creases between lobes this much darker
		churn = 0.004, -- how fast the lobes rise (lobes a second)
		fastMs = 40, -- an updraught this fast (m/s) gets the full lobes
	},
	anvil = {
		lengthShare = 0.35, -- of the feed's anvil length: the thick, visible part
		thicknessM = 2400,
		rootWidth = 0.3, -- width at the tower, x the full width
		streaks = 0.35, -- fibrous streaks along the wind, this much darker
		thinning = 0.7, -- thinner downwind by this share
		back = 0.25, -- reaches back upwind of the tower, x the radius ...
		backPerSpeed = 0.012, -- ... plus this x the updraught speed (m/s): back-shear
		endRound = 0.35,
		squareness = 0.25, -- flat top and bottom
		fadeFrom = 0.45, -- fades out from this share of its length
		mammaDepthM = 450,
		knuckles = 0.45, -- cauliflower knuckles on the young anvil, x its half-thickness
		knuckleReach = 1.0, -- over this share of its length from the upwind end
	},
	base = {
		thicknessM = 450,
		albedo = 0.45, -- the base is wet, rain-laden cloud: darker than the tower
		squareness = 1.0, -- a lens tapering to its rim (lower: upright sides, a slab)
		rag = 0.3,
		lumps = 1.6, -- lumps under the base, x its thickness
		wallFlat = 0.45, -- the wall cloud's flat bottom, x its radius
		wallDark = 0.25,
		bandKm = 1.1, -- striation tiers this far apart
		bandTwist = 1.5, -- turns of the bands round the updraught at full rotation
		bandDark = 0.22,
		tierM = 120,
	},
	light = {
		sun = 1.0,
		sky = 0.3,
		skyColour = Color3.new(0.55, 0.66, 0.85),
		ground = Color3.new(0.42, 0.43, 0.46), -- light from below: the ground and the bright horizon round the storm
		haze = Color3.new(0.62, 0.7, 0.8),
		lowSunHaze = Color3.new(0.86, 0.76, 0.64), -- the haze lit by a low sun
		visibilityKm = 110,
		wrap = 0.0,
		silver = 2.2,
		soft = 0.35,
		exposure = 0.68, -- (self-lit Neon: a colour of 1 already glows past white)
		warmBelow = 0.7,
		-- the boundary layer's haze dims a low sun on the storm's lower parts
		haze_ = { layerM = 1800, perKm = 0.22 }, -- the sun warms (reddens) below this height (sun direction's y)
		anvilShadow = 0.8, -- the anvil takes this share of the sun from what is under it
		towerShadow = 0.85, -- the tower takes this share from the base and wall cloud in its shadow
	},
}
-- Storms put together from the cloud kit (client/StormKit, shared/Weather/CloudKit): reusable
-- cloud pieces placed, sized and tinted from each storm's fields; every storm in view. When on,
-- StormMesh draws only the scud and rain shafts, and the old renderer skips the cloud bodies.
-- scale: every storm drawn as a copy this size along the view (pieces up to ~30 km fit a part).
Config.STORM_KIT = {
	enabled = true,
	meshAsset = 111990332715428, -- the pieces uploaded as one Model (tools/blender/cloud_kit_glb.py)
	scale = 0.06,
	-- far pieces drawn further out (farScale by farFromKm + farOverKm), so Roblox's distance haze
	-- (the Atmosphere SkyLight sets from the weather) reaches them: far storms fade into the sky
	farScale = 0.14,
	farFromKm = 15,
	farOverKm = 40,
	underCamera = true, -- the parts under the camera (outside the physics world)
	layoutSeconds = 2,
	growSeconds = 1.5, -- a piece new to a storm's layout grows in over this long
	line = { fromShare = 0.3, bowShare = 0.25, cellSpacingKm = 12, towerWidth = 0.9 },
	life = { decaySlim = 0.35, decayFray = 0.6 },
	tower = {
		segmentAspect = 0.9, -- body pieces this tall, x their width
		capShare = 0.3, -- the cap's share of the tower's height (mature) ...
		youngCapShare = 0.55, -- ... and young (towering)
		capWidth = 1.15,
		taper = 0.15,
		lean = 0.12, -- the top this far downwind, x the tower's height
		-- smaller domes over the tower: `top` round the cap (more on a young, towering one), sized
		-- topSize x the cap's width, spread over topSpread of it; `side` a body piece bulging out
		-- sideOut x the radius, sized sideSize x its width
		cluster = { top = 5, topSize = { 0.3, 0.55 }, topSpread = 0.9, side = 2, sideSize = { 0.35, 0.6 }, sideOut = 0.75 },
	},
	anvil = { thicknessM = 2400, lengthShare = 0.35, sectionKm = 16, rootWidth = 0.3, thinning = 0.6, edgeFade = 0 },
	mammatus = { from = 0.15, panels = 6, depthM = 500 },
	-- hang: the slab's share hanging below the cloud base (its lumps); more hid the wall cloud
	base = { thicknessM = 600, sectionKm = 14, hang = 0.2 },
	wall = { from = 0.05, minM = 150, spin = 0.08 }, -- spin: radians a second at full rotation
	shelf = { minStrength = 0.08, fullStrength = 0.35, depthKm = 4, noseShare = 0.55, riseM = 300, segmentKm = 10, maxLeadKm = 8 },
	-- (the base, wall cloud and shelf are dark because the cloud above shades them, which Roblox's
	-- light doesn't know: the photos' bases are ~0.13 lightness against ~0.9 for the lit tower)
	albedo = { tower = 0.95, anvil = 0.9, base = 0.2, shelf = 0.55, wall = 0.16, mammatus = 0.7 },
	light = { anvilShadow = 0.6 },
	-- haze by the real distance: f = most x (1 - e^(-d / visibility)); "emissive": the piece dimmed
	-- by f and the haze colour added as a glow (strength scales it to the sky's brightness);
	-- "transparency" faded out instead (glassy: lobes show through), "none"
	-- detail puffs on the pieces, for the nearest storm (StormMesh draws them): per kind, count
	-- points on its open surface (AO over minAo), each puff share x the piece's width across, at
	-- most maxKm; below: only where the surface faces down past this (the base's ragged underside)
	-- (2026-10-23: tried and off: the puffs, coloured by StormMesh's own light model, came out as
	-- grey and orange dots over pieces lit by Roblox, and cost ~20 fps; detailOn to try again)
	detailOn = false,
	detailInset = 0.3, -- (a puff's middle this share of its size inside the surface)
	detailAlbedo = 1.0,
	detailTransparency = 0.1,
	detail = {
		tower_cap = { count = 45, minAo = 0.55, share = 0.16, maxKm = 1.4 },
		tower_body = { count = 30, minAo = 0.55, share = 0.16, maxKm = 1.4 },
		anvil = { count = 18, minAo = 0.6, share = 0.14, maxKm = 2.0 },
		base = { count = 22, minAo = 0.4, share = 0.1, maxKm = 0.9, below = -0.2 },
		shelf = { count = 14, minAo = 0.4, share = 0.12, maxKm = 0.9, below = -0.2 },
		wall_cloud = { count = 20, minAo = 0.4, share = 0.25, maxKm = 0.6 },
	},
	-- the puffy pieces as baked volumetric vapor (tools/blender/cloud_vapor_bake.py): a sheet a
	-- piece (1024, 2 x 2 cells of `cell`: lit, side / back, high), covering the piece's box plus
	-- margin each side; highFrom..highTo: the sun's height (direction y) blending in "high";
	-- exposure: the bake's brightness in game. Pieces without a sheet stay meshes.
	vapor = {
		enabled = true,
		cell = 512,
		margin = 0.15,
		highFrom = 0.55,
		highTo = 0.9,
		exposure = 1.0,
		brightness = 1.5, -- (the image's own brightness: a colour tint can only darken it)
		-- kinds seen from under them as the mesh (vapor only from outside the footprint; both
		-- within edgeShare of its edge)
		outsideOnly = { base = true, shelf = true, anvil = true },
		edgeShare = 0.1,
		maxStretch = 2.5, -- (an image no bigger than this x its box, however it projects)
		maxTall = { base = 2.5, shelf = 2.5 }, -- (these no taller than this x their thickness)
		-- relit live (client/VaporRelight; light bases from tools/blender/cloud_relight_bake.py):
		-- pieces of storms within maxKm, at most maxImages images (EditableImages share a memory
		-- budget), redrawn when a light changes by redrawStep, budgetMs a frame; sun / sky: the
		-- two lights' strength against the bake's
		relight = {
			enabled = true,
			maxKm = 45,
			maxImages = 16,
			redrawStep = 0.03,
			budgetMs = 4,
			freeAfter = 3,
			sun = 1.0,
			sky = 0.35, -- (the vapor bakes' sky: 0.35 of this blue)
			skyColour = Color3.new(0.42, 0.55, 0.8),
			-- the grids as uploaded images (tools/blender/relight_pack.py), read back at run time;
			-- pieces without one use their Luau data (CloudKit/Relight). scale: the grids' shared one
			scale = 6.185769,
			packs = {
				tower_cap_1 = "rbxassetid://130965727181897",
				tower_cap_2 = "rbxassetid://77889507720212",
				tower_cap_3 = "rbxassetid://129429340179500",
				tower_body_1 = "rbxassetid://90352394119118",
				tower_body_2 = "rbxassetid://105925776856417",
				anvil_1 = "rbxassetid://86941461234217",
				anvil_2 = "rbxassetid://77931993085008",
				shelf_1 = "rbxassetid://137966586649922",
				shelf_2 = "rbxassetid://104007499659003",
				mammatus_1 = "rbxassetid://119856051560804",
			},
		},
		sheets = {
			tower_cap_1 = "rbxassetid://122288516998620",
			tower_cap_2 = "rbxassetid://139822071023278",
			tower_cap_3 = "rbxassetid://115566492652891",
			tower_body_1 = "rbxassetid://133302711931353",
			tower_body_2 = "rbxassetid://71626184239056",
			-- (anvils, bases and shelves: the "join" bakes, dense to their ends so a row of them is
			-- one band; the first anvil bakes, 76175838643043 / 132603498347597, tapered at the
			-- ends and a row of them read as separate cigars)
			anvil_1 = "rbxassetid://117213745354613",
			anvil_2 = "rbxassetid://100834178156311",
			-- (bases: the mesh. Seen from outside a base is one continuous dark underside, which the
			-- mesh draws; the vapor images, kept to bands, showed the 2 x 2 slabs as two dark bands
			-- with sky between: 109361575350450, 116362951230676)
			base_1 = "",
			base_2 = "",
			shelf_1 = "rbxassetid://113179691006216",
			shelf_2 = "rbxassetid://111186623104757",
			mammatus_1 = "rbxassetid://123692627072116",
		},
	},
	-- scud and wisps under near storms (client/StormWisps; tools/blender/cloud_wisp_bake.py):
	-- storms within maxKm; grey: the shade the images take (base fringe dark, scud lighter, as in
	-- 05_scud_fractus_c); backShare: how much the backlit cell shows with the sun behind
	wisp = {
		enabled = true,
		maxKm = 40,
		brightness = 1.4,
		baseGrey = 0.12, -- (as dark as the base mesh looks, so the strips' solid top merges into it)
		scudGrey = 0.3, -- (lighter than the base, as in 05_scud_fractus_c, not white)
		backShare = 0.8,
		-- ragged strips hanging from the base's rim: one about widthKm wide, heightM tall
		fringe = { sheets = { "rbxassetid://132198295246933", "rbxassetid://122586888055367", "rbxassetid://123814679260350" }, widthKm = 3, heightM = 420, max = 40, alpha = 0.9 },
		-- torn fragments: count at full strength (least: the share always there), forming depthM
		-- under the base from..to x the wall cloud's radius out (inflowBias toward the inflow),
		-- rising and drawn in (drawIn) and swirled (swirl x rotation, radians) over cycleSeconds
		scud = { sheets = { "rbxassetid://117739110874568", "rbxassetid://106824660670141", "rbxassetid://122700082311521",
			"rbxassetid://114257167471944", "rbxassetid://71533572840183", "rbxassetid://100822357693244" }, count = 36, least = 0.25, sizeKm = 0.7, depthM = 450, from = 0.8, to = 4,
			inflowBias = 0.6, drawIn = 0.5, swirl = 1.2, cycleSeconds = 45, alpha = 0.7 },
	},
	haze = { mode = "none", most = 0.85, strength = 1.0, visibilityKm = 110, colour = Color3.fromRGB(176, 184, 196) },
}
-- The tornado's art (made by tools/blender, uploaded as images; client/TornadoArt). Empty ids fall
-- back to plain parts. Sprites are the distant tornado, one per shape, chosen by the funnel's
-- width / height (ratio, as rendered): `lit` rendered with the sun behind the viewer, `back` with
-- it behind the tornado; the game blends them by where the sun is.
Config.TORNADO_ART = {
	funnelCore = "rbxassetid://103842331190084", -- tools/blender/funnel_texture.py --variant core
	funnelWisp = "rbxassetid://118029183384379", -- --variant wisp
	dustPuff = "rbxassetid://111958192824447", -- tools/blender/dust_flipbook.py
	sprites = {
		-- tools/blender/tornado_sprite.py --shape rope|cone|wedge --light lit|back (ratio as it prints)
		{ ratio = 0.023, lit = "rbxassetid://87585016996597", back = "rbxassetid://92039694055366" }, -- rope
		{ ratio = 0.113, lit = "rbxassetid://119755655825236", back = "rbxassetid://128159900894869" }, -- cone
		{ ratio = 0.586, lit = "rbxassetid://89513143050666", back = "rbxassetid://70698707272770" }, -- wedge
	},
	-- Each sprite sheet: columns x rows frames of width x height px, played at fps (one turn).
	-- (square frames: the ground at the bottom edge, the cloud base at the top, the funnel centred)
	spriteSheet = { columns = 4, rows = 4, width = 256, height = 256, fps = 8 },
	spriteBeyondStuds = 7000, -- the sprite stands in for the mesh beyond this distance
	-- The baked tornado (tools/blender/tornado_bake.py from tz_0037_cone_R.blend: a Cycles volume),
	-- drawn at every distance when its sheets are here: a seamless spin loop of `frames` frames,
	-- `perSheet` to a 1024 sheet in `columns` columns of `cell` px; lit (sun behind the viewer)
	-- and back (sun behind it). groundRow / baseRow: where the ground and the cloud base sit in a
	-- frame (share of its height from the top); ratio: the funnel's width / height there.
	baked = {
		frames = 16,
		perSheet = 4,
		columns = 2,
		cell = 512,
		groundRow = 0.988, -- (measured from the baked frames)
		baseRow = 0.27,
		ratio = 0.19,
		lit = { "rbxassetid://91449336506622", "rbxassetid://138890314073561", "rbxassetid://109543245247817", "rbxassetid://120414281766723" },
		back = { "rbxassetid://97418229759344", "rbxassetid://86324609035161", "rbxassetid://130905273747767", "rbxassetid://128814277101338" },
	},
}
-- Where the frames come from: the live weather server (WEATHER_FEED_URL, or the Workspace
-- attribute WeatherFeedUrl; Studio's game servers cannot reach localhost, so a tunnel or a host
-- is needed), or a recorded replay (Workspace attribute StormSource = "replay";
-- scripts/export-storm-replay.mjs). The key, if the server wants one, is the experience secret
-- "weather_feed_key".
Config.WEATHER_FEED_URL = ""
Config.WEATHER_POLL_SECONDS = 5
-- The products (outlooks, and later radar, warnings...): the manifest is polled this often, on
-- the same URL and key (server/ProductFeed.luau). Workspace attribute ProductSource = "snapshot"
-- uses the recorded ServerStorage.WorldData.ProductSnapshot instead.
Config.PRODUCT_POLL_SECONDS = 10 -- radar frames come every 25 s (one storm tick)
-- The storm report days and damage surveys kept in a DataStore (server/ReportArchive.luau), in
-- days of the world's clock (12 a real day). A day is a few KB plus 1-6 KB a tornado survey,
-- about 40 KB on an active day: a year of the world's days is about 15 MB of the place's storage.
Config.REPORT_ARCHIVE_STORE = "StormReports"
Config.REPORT_ARCHIVE_DAYS = 365

-- Chunks (Minecraft-style): generated around players, unloaded beyond the radius plus a margin.
Config.VOXEL_STUDS = 4
Config.CHUNK_STUDS = 256
Config.LOAD_RADIUS_STUDS = 2048
Config.UNLOAD_MARGIN_STUDS = 512
Config.FILL_DEPTH_STUDS = 12 -- solid ground kept below the lowest column of each chunk

-- Chunk building: WORKERS parallel actors; 0 builds in serial within SERIAL_BUDGET_MS per frame.
Config.WORKERS = 4
Config.SERIAL_BUDGET_MS = 8

-- Streaming and vehicle tests (turned on by the Workspace attribute TestDrive; see server/TestDrive).
-- Workspace attributes TestOriginX, TestSpeed and TestSeconds override these defaults.
Config.TEST_SPEED_STUDS = 170 -- highway chase speed at 1000 studs/mile
Config.TEST_SECONDS = 60
Config.TEST_ORIGIN_X = 8000 -- clear of the Baseplate and SpawnLocation at the origin
Config.TEST_VEHICLE_X = { 8000, 250000, 480000 } -- near the centre, the map edge, beyond it

return table.freeze(Config)
