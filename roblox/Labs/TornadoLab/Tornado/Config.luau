--!strict
-- Everything the particle tornado can be tuned by, in one table. The lab's debug panel
-- (src/lab) edits this table live and can print it back as Luau to paste here.
-- Look target: docs/tornado-reference (ref1_image.png: the mature cone).
--
-- Units: studs. STUDS_PER_METRE turns real wind speeds (m/s) into studs/s.
local Config = {}

Config.STUDS_PER_METRE = 1

-- Smoke textures (tools/smoke/smoke_flipbook.py). Names listed in SHEETS are 4x4 looping
-- flipbooks; the rest are single images.
Config.textures = {
	soft = "rbxassetid://93779649150061", -- --variant soft --single: nearly featureless soft blob
	softSheet = "rbxassetid://133517483141983", -- --variant soft (4x4)
	-- --variant soft --single --flat: pure white, shape in the alpha only. Overlapping particles of
	-- one flat colour blend the same in any draw order, so they don't flicker when Roblox re-sorts
	-- them each frame (the shaded textures did, in the dense core and body).
	softFlat = "rbxassetid://116883477687095",
	funnelProfile = "rbxassetid://96620544429330", -- tools/smoke/funnel_profile.py (beam cross-section)
	softSheetFlat = "rbxassetid://75569785912211", -- --variant soft --flat (4x4)
	wispFlat = "rbxassetid://77502166035387", -- --variant wisp --flat (4x4)
	footFlat = "rbxassetid://76974068107327", -- --variant soft --single --flat --foot: crisp flat bottom
	footLowFlat = "rbxassetid://127942101371000",
	ceiling = "rbxassetid://125850054637818", -- tools/smoke/ceiling_tile.py --beta 4.2 --soft 0.55 --cover 0.72: seamless cloud cover
	shredFlat = "rbxassetid://91728136123515", -- --variant shred --flat (4x4): torn stretched shred (scud)
	lumpyFlat = "rbxassetid://127742324022128", -- --variant body --flat (4x4): lumpy puff, the base's ragged underside -- --variant wide --single --flat --foot --low 0.3: short wide foot
	firmFlat = "rbxassetid://112795362770716", -- --variant firm --single --flat: near-disc, narrow soft rim
	sliceFlat = "rbxassetid://78396908460708", -- --variant firm --single --flat --slice: crisp sides, soft top and bottom
	mediumFlat = "rbxassetid://111690557879064", -- --variant medium --single --flat: defined but not hard rim
	wideFlat = "rbxassetid://101986960654906", -- --variant wide --single --flat: ellipse 0.88 x 0.29 of the frame -- --variant soft --single --flat --foot: crisp flat bottom
	body = "rbxassetid://107651069089548", -- --variant body (4x4): lumpier puff
	wisp = "rbxassetid://103662863598917", -- --variant wisp (4x4): streaky
	builtin = "rbxasset://textures/particles/smoke_main.dds", -- Roblox's own smoke (diagnosis)
	-- the Severity wisp look (tools/smoke/wisp_flipbook.py, 4x4, white, alpha only): a soft dense
	-- middle whose edge frays into curling strands. Layered big and faint, edges turn to wisps.
	wispyFlat = "rbxassetid://139989680557727", -- --variant wispy: a puff with a torn fibrous fringe
	strandsFlat = "rbxassetid://120187806290235", -- --variant strands: a tall streaky smoke column
}
Config.SHEETS = { softSheet = true, body = true, wisp = true, softSheetFlat = true, wispFlat = true, lumpyFlat = true, shredFlat = true, wispyFlat = true, strandsFlat = true }

-- How the funnel moves and changes shape (State.centreAt / State.radiusAt; strengths come from
-- the state: kink, pulse). Lengths are in funnel heights, speeds in funnel heights per second.
Config.motion = {
	-- helical kinks travelling up the funnel: wavelength, upward speed, share of the kink
	-- strength, and twist (1 = a round helix, 0 = a flat side-to-side wave)
	-- (wavelengths in non-integer ratios so the pattern never visibly repeats; a mature funnel's
	-- kinks take ~15-30 s to climb it, a rope's faster: see docs/tornado-reference/NOTES.md)
	waves = {
		{ length = 1.6, speed = 0.055, weight = 1, twist = 0.8 },
		{ length = 0.99, speed = 0.075, weight = 0.5, twist = 1 },
		{ length = 0.66, speed = 0.1, weight = 0.25, twist = 0.6 },
	},
	footSway = 0.15, -- how much the foot still sways (0 = pinned, 1 = as much as mid-funnel) ...
	ropeFootSway = 0.6, -- ... and for a rope (its foot swings loose)
	tipLength = 0.4, -- a funnel not on the ground (state.bottom > 0) tapers to a point over this share
	tipMin = 0.06, -- of the height, down to this share of its width
	tipRound = 0.55, -- how blunt (rounded) the tip gets for a wide funnel (0 = always a cone)
	tipWideAt = 0.5, -- fully blunt once the funnel is this wide x its height
	irregular = 0.35, -- how much each wave's strength wanders over time
	pulseLength = 0.8, -- width bulges: length along the funnel (short ones read as egg-shaped lumps) ...
	pulseSpeed = 0.08, -- ... and how fast they climb
	breathePeriod = 30, -- seconds: the whole funnel slowly widening and narrowing ...
	breatheShare = 0.35, -- ... as this share of the pulse strength
}

-- Far stand-ins (FarSprite): Roblox stops drawing particles a few hundred studs from the camera
-- (~750 at graphics quality 8, less on lower settings), so past `start` each puff carrier and
-- cloud-base cell cross-fades (over `band` studs) to one soft camera-facing sprite.
Config.far = {
	enabled = true,
	start = 620, -- studs from the camera where the hand-over begins ...
	band = 150, -- ... and how long it takes (done before particles vanish at ~800)
	texture = "softSheetFlat", -- a sheet: each sprite takes a different frame and turn (no banding)
	funnelSize = 2.6, -- a carrier's sprite, x the funnel's radius there
	funnelOpacity = 0.97, -- how solid the stacked sprites read
	baseSize = 3.4, -- a cloud-base cell's sprite width, x the cell spacing ...
	baseSquash = 0.65, -- ... and height, x its width
	baseOpacity = 0.5,
}

-- Sub-vortices (SubVortexView): dark blobs sweeping round inside a wide funnel.
Config.subVortex = {
	enabled = true,
	minWidth = 330, -- studs: narrower funnels have none ...
	widthPer = 110, -- ... then one more per this many studs of width ...
	max = 5, -- ... up to this many
	nodes = 5, -- puffs up each one
	rate = { 1.1, 1.6 }, -- orbit speed, x the funnel's spin (random range)
	orbit = { 0.45, 0.8 }, -- orbit radius, x the funnel's radius
	top = { 0.35, 0.7 }, -- how far up they reach, share of the height
	life = { 6, 16 }, -- seconds each lasts
	fade = 2, -- seconds to fade in and out
	twist = 1.2, -- radians of curl from bottom to top
	texture = "softSheetFlat",
	count = 5, -- puffs alive per node
	puffLife = 1.5,
	size = 0.32, -- blob width, x the funnel's radius at the ground
	opacity = 0.55,
	shade = 0.55, -- x the funnel's colour ...
	tint = Color3.fromRGB(40, 50, 66), -- ... pulled this share toward blue-black
	tintShare = 0.35,
	zFront = 1.1, -- drawn this far (x the radius) toward the camera: over the funnel
	limb = 0.5, -- how far round the side they fade (0 = only straight-on, 1 = right to the far side)
	-- with the ribbon funnel: each sub-vortex is a thin ribbon (Ribbon.luau) instead of puffs
	ribbon = {
		enabled = false, -- off: the wedge clips show big soft dark masses (the puffs), not thin bands
		levels = 10,
		columns = { -1, -0.9, -0.7, -0.4, 0, 0.4, 0.7, 0.9, 1 },
		width = 0.13, -- radius, x the funnel's radius at the ground
		taper = 0.4, -- narrower by this share at its top
		front = 0.65, -- drawn this far towards the camera, x the funnel's radius (in front of its surface)
		opacity = 0.7,
		look = { edge = 0.35, dark = 0, wrap = 0.6, ambient = 0.8, sunShare = 0.25, rim = 0.15, backDark = 0.2, tint = 1, bulge = 0.4 },
	},
}

-- Which renderer draws the funnel body: "puffs" (PuffView: a chain of round puffs along the
-- centreline, as read from the reference clips) or "rings" (FunnelView's spinning rings + layers).
-- The cloud base, deck, foot and debris are drawn by FunnelView either way.
Config.render = {
	mode = "puffs",
}

-- The puff chain (PuffView).
-- The funnel drawn with Beams (BeamFunnel, prototype): camera-facing ribbons with a cross-section
-- texture, stacked along the bent axis. B in the lab switches the funnel between beams and puffs.
Config.beamFunnel = {
	enabled = false,
	texture = "funnelProfile",
	segments = 8, -- beams along the axis (fewer joints, fewer overlap steps)
	spacingPower = 1.4, -- >1: closer together near the ground
	overlap = 0.25, -- each beam runs past its joints by this share of its length (covers the gaps at bends)
	tint = 0.82, -- the funnel colour, darkened: beams take the sun fully (LightInfluence 1) and came out lighter than the puffs
	top = 0.97, -- share of the height the beams reach (into the cloud base)
	topFade = 0.18, -- fade into the cloud base over this share of the height
	footFade = 0.08, -- fade in above a lifted bottom
	lightInfluence = 1,
	brightness = 1,
	live = false, -- the live texture (FunnelImpostor, EditableImage). Off: tested 2026-10-22, a Beam takes an
	-- EditableImage as TextureContent but draws it as flat colour (no alpha, no shading)
	drawRate = 30, -- redraws a second
	spinShare = 1, -- streaks turn at this share of the air's angular speed
	impostor = {
		width = 128,
		height = 16,
		edge = 0.05,
		dark = 0.12,
		wrap = 0.6,
		ambient = 0.62,
		sunShare = 0.45,
		rim = 0.5,
		streaks = 0.10,
		streakCount = 18,
		seed = 11,
	},
	layers = {
		{ name = "Core", width = 1.0, opacity = 1, zOffset = 0 },
		{ name = "Veil", width = 1.12, opacity = 0.35, zOffset = -1 },
	},
}

-- The funnel as one camera-facing ribbon mesh (RibbonFunnel, EditableMesh): no joints, shading and
-- the soft edge in per-vertex colour and alpha, recomputed every frame. B in the lab cycles the
-- funnel's body: puffs -> beams -> ribbon.
Config.ribbonFunnel = {
	enabled = false,
	levels = 28, -- rows up the axis
	-- columns across, -1..1 (dense at the edges, where the alpha ramp and the dark band are)
	columns = { -1, -0.99, -0.975, -0.955, -0.93, -0.9, -0.86, -0.8, -0.72, -0.62, -0.48, -0.3, 0, 0.3, 0.48, 0.62, 0.72, 0.8, 0.86, 0.9, 0.93, 0.955, 0.975, 0.99, 1 },
	spacingPower = 1.3,
	top = 0.97,
	topFade = 0.3,
	footFade = 0.08,
	bulge = 0.6, -- the middle sits this far towards the camera, x the radius (a half-pipe)
	sink = 0.5, -- on the ground, the foot continues this far below it, x the radius
	-- colour: "scene" = cloud lit by the scene, thickness and dust (fields); "look" = the funnel colours
	colour = "look", -- "scene" waits on the looks carrying their tint in the lighting (plan 5.4)
	albedo = Color3.fromRGB(172, 174, 178), -- cloud (the scene's light does the rest)
	underLight = 0.55, -- "scene": light under the storm base (sky light only), x albedo ...
	sunLight = 0.75, -- ... plus this where the sun reaches it (a ray to the sun escapes the base)
	sunFacing = 1.5, -- ... times (how much the side we see faces the sun)^this (backlit: in its own shadow)
	core = 0.8, -- an opaque inner core this x the radius (0 = none): blocks the sun glaring through
	coreFrom = 0.97, -- ... only where the soft ribbon's opacity is at least this (it can't fade)
	coreBulge = 0.5, -- ... bulged toward the camera this x as much as the ribbon (so it stays behind it)
	baked = "", -- a baked volumetric funnel column (storm_volume_bake.py --what funnel): mapped across the
	-- visible width and scrolled upward instead of the drawn condensation texture ("" = drawn)
	bakedSpan = 0.44, -- the ribbon's edge sits this far from the column's middle, in texture widths
	meetAbove = 0.01, -- the ribbon ends this share of the height above the storm base's underside (fading out before it)
	thickDark = 0.6, -- the widest funnels lose up to this share of their light ...
	thickScale = 260, -- ... falling off over this radius (studs)
	dustTake = 0.55, -- dust colour share at the foot ...
	dustHeight = 0.45, -- ... thinning out by this share of the height ...
	dustFromEf = 0.5, -- ... starting from this rating (full by +3)
	tipDark = 0.3, -- a lifted funnel's underside: darker by this much (its own shadow), over the tip
	flareFade = 0.9, -- fade where the radius grows faster than this per stud of height (into the base)
	handover = false, -- hand over to the puff body (removed: puffs looked unrealistic); the ribbon stays
	handoverAlign = { 0.72, 0.9 }, -- hand over to the puff body as the view lines up with the axis ...
	handoverNear = { 1.0, 1.8 }, -- ... or the camera comes within this x the funnel's radius of it
	hidden = 0, -- (runtime) how far the ribbon has handed over
	detail = true, -- with the ribbon, keep the puffs' surface detail (lumps, fuzz, wisps); smooth looks (Ref1, ropes) turn it off
	edge = 0.075, -- alpha ramp, share of the full width at each side (0.09 measures as Ref1's ~0.044: the vertex fade is steeper than linear)
	dark = 0.05, -- darker band just inside the edge (Ref1 ~0.11; stronger reads as a glassy tube)
	wrap = 0.6,
	ambient = 0.7,
	sunShare = 0.35,
	rim = 0.08, -- backlit bright edge (strong = a plastic, glass-tube outline)
	backDark = 0.35,
	tint = 0.95,
	opacity = 1,
	partTransparency = 0.02, -- >0 so the part draws with the transparent (alpha-blended) pass
	-- the condensation texture (an EditableImage on the ribbon, redrawn as the funnel turns and the
	-- cloud climbs): the rotation and updraught cue, and the ragged edge (RibbonFunnel.drawCondensation)
	streaks = 0.02, -- helical band contrast (Ref1's surface is nearly smooth; stronger reads as stripes)
	streakWaves = 16,
	streakSeed = 5,
	patches = 0.06, -- soft lumps of denser / thinner cloud (Ref1: barely there; 0.2 read as stark blotches)
	patchAspect = 2.2, -- lumps this many times taller than wide (stretched along the flow)
	riseSpeed = 22, -- studs/s the condensation climbs (the air in the funnel rises; features ride it)
	fringe = 0.07, -- the ragged edge eats up to this share of the half width (the wisps layer frays it further) ...
	fringeSoft = 0.05, -- ... over this soft ramp (texture alpha; climbs and turns with the cloud; wide = blurry)
	twist = 0.8, -- radians the pattern winds round from the top to the ground (helical)
	spinShare = 1, -- turn at this share of the air's angular speed (Vortex.spinRate)
	textureSize = Vector2.new(128, 256), -- the condensation tile: once round the funnel x one vertical noise period (drawn once, moved by UVs)
	textureLevel = 240, -- the texture multiplies the shading: 255 leaves it unchanged
	drawRate = 20, -- (unused: the texture is drawn once and moved through the UVs every frame)
	bounds = 1020, -- studs: the mesh's fixed bounding box (half size; Roblox caps a mesh at 2048 a side)
	sortBack = 4, -- the part sits this far behind the funnel's foot, x its radius there (draw order: dust in front draws over)
}

Config.puffs = {
	enabled = true,
	spacing = 0.12, -- gap between release points along the axis, x the funnel's radius there
	minSpacing = 4, -- studs
	maxSpacing = 120, -- studs
	maxNodes = 120, -- the spacing widens to keep to this
	spinSpeed = 90, -- (unused: the spin comes from the wind, spinShare)
	spinShare = 1, -- the funnel's edge turns at this share of the peak wind (Vortex; EF rating)
	maxSpinRate = 3, -- radians/s cap (narrow ropes)
	dustTint = 0, -- off: the dust layer (puffLayers.dust) darkens the foot instead
	dustTake = 0.22, -- with debris, the lower funnel takes on this share of the dust's colour
	lowShade = 0.86, -- the funnel darkens toward the ground to this share of its colour (over dustHeight) ...
	dustMix = 0.5, -- ... (the dust layer, if on: this share toward the debris colour) -- the funnel takes on the debris colour near the ground (dust drawn into it) ...
	dustHeight = 1, -- over the whole height: a short gradient shows its edge as an egg-shaped dark foot -- ... fading out over this share of the height
	carrierFade = 1.5, -- seconds a carrier takes to fade in or out (a live tornado changing size)
	maxCarrierChange = 3, -- carriers added or retired per apply() at most
	riseSpeed = 45, -- studs/s: the puffs ride carriers up the axis (the funnel visibly streams upward)
	bottomFade = 0.06, -- share of the axis over which a carrier fades in leaving the ground
	topFadeLength = 0.06, -- and fades out going into the cloud (then restarts at the ground)
	refill = 0.6, -- a restarting carrier is refilled with this share of its usual puffs at once
	lightInfluence = 0.15, -- low: the references read as one flat colour per scene
	brightness = 1,
	footSize = 0.7, -- puffs at the ground are this share of their usual size ...
	footHeight = 0.4, -- ... growing to full size this high, x the funnel's width there
	groundReach = 0.3, -- how much of a puff's half-size counts when keeping it off the ground
	-- (the soft texture's visible edge is ~0.84 of its half-size, and only faint there)
	maxPerPoint = 40, -- puffs alive per layer per release point at most
}
-- Layers of every release point, all one flat colour (different colours flicker as orbiting
-- puffs swap draw order).
--   offset: spread of the release points round the axis, x the funnel's radius
--   size: puff width, x the funnel's width there (shrunk where a cone narrows below it)
--   sizeJitter: random +- share of the size; count: puffs alive per point
--   drift: slow outward drift, x the funnel's radius per second; grow: size at death / at birth
--   shell: release on a ring at the funnel's edge (count raised to go all round, x cover)
--   free: not carried with the funnel (left behind in the air); spread: degrees off straight out;
--   buoyancy: upward acceleration, studs/s/s; drag: how fast the throw dies away
--   upright: kept level (FacingCameraWorldUp); rotation: +- degrees of starting tilt (default 180)
Config.puffLayers = {
	{
		name = "body",
		shell = false,
		enabled = true,
		texture = "softFlat",
		offset = 0.25,
		size = 0.75,
		sizeJitter = 0.06,
		count = 36,
		lifetime = 3,
		opacity = 0.6,
		fadeIn = 0.3,
		fadeOut = 0.4,
		grow = 1.15,
		drift = 0.01,
		rotSpeed = 6,
		shade = 1,
		flipFps = 0,
		zOffset = 0,
	},
	{
		name = "lumps",
		lowFade = 0.12, -- faded out near the ground (small shrunk puffs read as bubbles there)
		cover = 2.2,
		shell = true,
		enabled = true,
		texture = "softSheetFlat",
		offset = 0.55,
		size = 0.4,
		sizeJitter = 0.35,
		count = 10,
		lifetime = 2.5,
		opacity = 0.25,
		fadeIn = 0.3,
		fadeOut = 0.4,
		grow = 1.3,
		drift = 0.03,
		rotSpeed = 10,
		shade = 1,
		flipFps = 3,
		zOffset = 0,
	},
	{
		-- shreds peeling off the edge as the funnel rises and turns (scud): faint torn level shreds
		-- carried round with the funnel while drifting outward and lifting, so they spiral off and fade
		name = "shed",
		upright = false, -- face the camera fully: kept upright, a shred goes paper-thin seen from below
		rotation = 12, -- +- degrees of tilt
		enabled = true,
		texture = "shredFlat",
		shell = true,
		free = false,
		cover = 0.6,
		offset = 0.95,
		size = 0.35,
		sizeJitter = 0.4,
		count = 6,
		lifetime = 4,
		opacity = 0.22,
		fadeIn = 0.25,
		fadeOut = 0.55,
		grow = 2,
		drift = 0.35,
		spread = 25,
		buoyancy = 4,
		drag = 0.8,
		rotSpeed = 3,
		shade = 1,
		flipFps = 4,
		zOffset = 0,
	},
	{
		-- an edge shell, always drawn in front and a little darker: holds the outline and darkens
		-- (soft texture: a firmer one showed as separate circles where the puffs are small)
		--
		-- the silhouette's edges (zFront: ZOffset x the funnel's radius)
		name = "rim",
		lowFade = 0.12, -- faded out over the lowest share of the height
		enabled = false, -- (replaced by edgeL/edgeR: a ring of firm puffs showed their round edges on the funnel's face)
		texture = "mediumFlat", -- solid middle, soft rim: overlapped 3 deep it draws a defined edge (ref1)
		shell = true,
		cover = 3,
		offset = 0.95,
		size = 0.22,
		sizeJitter = 0.25,
		count = 8,
		lifetime = 2.5,
		opacity = 0.32,
		fadeIn = 0.3,
		fadeOut = 0.4,
		grow = 1.1,
		drift = 0.01,
		rotSpeed = 4,
		shade = 0.86,
		flipFps = 0,
		zOffset = 0,
		zFront = 1.4,
	},
	{
		-- wisps: tall strand sprites on a shell at the funnel's edge, rising with it, drifting out
		-- and fading. Big and faint, so the silhouette frays into streaks the way Severity's does.
		-- Drawn with the ribbon body too, smooth looks included (always).
		name = "wisps",
		always = true,
		lowFade = 0.08,
		cover = 1.3,
		shell = true,
		enabled = false, -- replaced by WispSprites.funnel (sprites draw at any distance; these particles drew a pale glow on the funnel's face)
		upright = true, -- the strands run up the funnel
		rotation = 10,
		texture = "strandsFlat",
		offset = 0.85,
		size = 0.7,
		sizeJitter = 0.35,
		count = 8,
		lifetime = 5,
		opacity = 0.2,
		fadeIn = 0.3,
		fadeOut = 0.5,
		grow = 1.4,
		drift = 0.08,
		rotSpeed = 3,
		shade = 1,
		flipFps = 3,
		zOffset = 0,
	},
	{
		name = "fuzz",
		lowFade = 0.12, -- faded out near the ground (small shrunk puffs read as bubbles there)
		cover = 1.2,
		shell = true,
		enabled = true,
		texture = "softSheetFlat",
		offset = 0.9,
		size = 0.3,
		sizeJitter = 0.4,
		count = 8,
		lifetime = 2,
		opacity = 0.08,
		fadeIn = 0.3,
		fadeOut = 0.45,
		grow = 1.4,
		drift = 0.06,
		rotSpeed = 15,
		shade = 1,
		flipFps = 5,
		zOffset = 0,
	},
	{
		-- dust drawn into the funnel near the ground: debris-coloured, in front, fading with height
		-- (puffs.dustHeight); only while the debris cloud is on
		name = "dust",
		enabled = false, -- off: on wide funnels its stacked puffs band into rings (the body is shaded instead: puffs.lowShade)
		dust = true,
		texture = "softSheetFlat", -- grainy: smooth stacked puffs band into rings
		offset = 0.15,
		size = 0.9,
		sizeJitter = 0.05,
		count = 20,
		lifetime = 3,
		opacity = 0.12,
		fadeIn = 0.3,
		fadeOut = 0.4,
		grow = 1.1,
		drift = 0.01,
		rotSpeed = 4,
		shade = 1,
		flipFps = 2,
		zOffset = 0,
		zFront = 1.2,
	},
	{
		-- the funnel's edge, as the camera sees it (ref1: a soft but definite outline, the funnel
		-- about 13 percent darker just inside it): firm puffs kept at the left / right silhouette
		-- (silhouette = -1 / 1), their outer edges on the funnel's edge (inset: how far in, x the
		-- puff's radius), always drawn in front (zFront)
		name = "edgeL",
		enabled = true,
		silhouette = -1,
		reach = 1.08, -- the visible edge sits this far out, x the funnel's radius (the body puffs reach past it)
		inset = 0.6,
		texture = "mediumFlat",
		offset = 0,
		size = 0.25,
		sizeJitter = 0.1,
		count = 4,
		lifetime = 2,
		opacity = 0.38,
		fadeIn = 0.25,
		fadeOut = 0.35,
		grow = 1,
		drift = 0,
		rotSpeed = 0,
		shade = 0.88,
		flipFps = 0,
		zOffset = 0,
		zFront = 1.2,
		lowFade = 0.06,
	},
	{
		-- the funnel's edge, as the camera sees it (ref1: a soft but definite outline, the funnel
		-- about 13 percent darker just inside it): firm puffs kept at the left / right silhouette
		-- (silhouette = -1 / 1), their outer edges on the funnel's edge (inset: how far in, x the
		-- puff's radius), always drawn in front (zFront)
		name = "edgeR",
		enabled = true,
		silhouette = 1,
		reach = 1.08, -- the visible edge sits this far out, x the funnel's radius (the body puffs reach past it)
		inset = 0.6,
		texture = "mediumFlat",
		offset = 0,
		size = 0.25,
		sizeJitter = 0.1,
		count = 4,
		lifetime = 2,
		opacity = 0.38,
		fadeIn = 0.25,
		fadeOut = 0.35,
		grow = 1,
		drift = 0,
		rotSpeed = 0,
		shade = 0.88,
		flipFps = 0,
		zOffset = 0,
		zFront = 1.2,
		lowFade = 0.06,
	},
}

-- The funnel: rings of smoke stacked from the ground to the cloud base.
-- NB Roblox stops drawing particles some way from the camera (measured in Studio 2026-10-22:
-- gone by ~1700 studs, faint by ~1000; it depends on the graphics quality level). So the tornado
-- is sized for a camera within ~1000 studs, and a far stand-in (Phase 7) takes over beyond.
Config.funnel = {
	useBuiltinTexture = false, -- draw every layer with Roblox's smoke (to rule textures out)
	ringSpacing = 0.06, -- gap between rings, x the funnel's radius there (narrow parts get more rings)
	minSpacing = 6, -- studs
	maxRings = 60, -- the spacing widens to keep to this
	maxPerEmitter = 160, -- particles alive per ring layer at most
	minPerEmitter = 8, -- and at least (a few huge particles pulse visibly as each one fades in and out)
	spinSpeed = 70, -- studs/s at the funnel's edge (visual); narrower rings turn faster (rate = speed / radius)
	maxSpinRate = 1.2, -- radians/s cap for the narrowest rings
	colorBottom = Color3.fromRGB(128, 128, 128),
	colorTop = Color3.fromRGB(122, 123, 124),
	colorGamma = 1,
	groundFade = 0, -- share of the height over which the funnel fades in at the ground
	topFade = 0, -- share of the height over which it fades out at the top (0 when the base is drawn)
	lightInfluence = 0.25,
	brightness = 1,
	sizeMax = 1100, -- studs across; the largest particle drawn (the core spans the whole funnel)
	-- Every size in this file is studs across. Roblox draws a particle about twice its Size across
	-- (measured in the lab 2026-10-22: a 288 foot particle came out ~600 wide), so the emitters
	-- get size x sizeScale.
	sizeScale = 0.5,
	overlap = 1.5, -- a particle is at least this x the ring spacing tall, so rings blend
	groundSink = 0, -- share of a particle's size allowed below the ground. Keep 0: where the ground cuts a
	-- particle the two fight for depth along the cut and it shimmers. Config.foot makes the contact.
	groundClear = 1, -- studs every funnel particle stays above the ground (touching it shimmers too)
}

-- Layers of each funnel ring, inside to out. Every ring has one emitter per layer.
--   radius: where the layer sits, x the funnel's radius
--   size: particle size, x the funnel's radius (raised to cover the ring spacing, capped at sizeMax)
--   density: particles round the ring per particle width (>1 overlap)
--   opacity: at full life; fadeIn / fadeOut: share of the life spent fading
--   grow: size at the end of life / size at the start
--   squash: <0 widens the particles sideways (streaks along the spin)
--   shade: brightness multiplier; tint: colour multiplier. Keep them equal across layers that
--   overlap: different colours flicker as orbiting particles swap draw order.
--   flipFps: flipbook frames a second (sheet textures only)
--   enabled: false hides the layer (for finding which one misbehaves)
--   tall: how far the visible smoke reaches above and below the particle's centre, x its size
--   (0.5 for round textures, 0.15 for wideFlat): keeps particles off the ground (groundClear)
--   upright: particles stay upright (FacingCameraWorldUp) instead of turning with the camera, so a
--   texture's crisp sides stay vertical (the core's column slices)
--   spin: x the ring's spin. 0 for the dense layers: orbiting particles keep swapping draw order
--   (Roblox re-sorts them every frame) and each swap shows as a faint flicker where they overlap;
--   still particles keep a stable order. The thin outer layers carry the visible rotation.
Config.layers = {
	-- Big round particles near the axis, each about as wide as the funnel: their edges line up into
	-- the silhouette (particles out on the rim make a lumpy edge). The medium texture's rim is
	-- defined enough for a clear outline but soft enough that stacked rims don't show as bands.
	-- Wide short ellipses (wideFlat), kept upright: a round particle as wide as the funnel is as
	-- tall as it is wide, so the big ones near the wide top hang down over the narrow foot (a ball,
	-- not a cone). Flat ellipses stay near their own height and the outline follows the shape.
	-- size 2.27: the ellipse's half-width (0.44 of the frame) is the funnel's radius.
	-- (Tried: upright column slices, sliceFlat: blocky, stepped outline.)
	{
		name = "core",
		tall = 0.15,
		upright = true,
		enabled = true,
		texture = "wideFlat",
		spin = 0,
		radius = 0.05,
		size = 2.5,
		density = 3,
		lifetime = 10,
		opacity = 0.55,
		fadeIn = 0.35,
		fadeOut = 0.4,
		grow = 1.05,
		squash = 0,
		rotation = 0,
		rotSpeed = 0,
		shade = 1,
		tint = Color3.fromRGB(255, 255, 255),
		flipFps = 3,
		zOffset = 0,
	},
	{
		name = "body",
		tall = 0.15,
		upright = true,
		enabled = true,
		texture = "wideFlat",
		spin = 0,
		radius = 0.3,
		size = 1.6,
		density = 2.5,
		lifetime = 8,
		opacity = 0.22,
		fadeIn = 0.35,
		fadeOut = 0.4,
		grow = 1.1,
		squash = 0,
		rotation = 0,
		rotSpeed = 0,
		shade = 1,
		tint = Color3.fromRGB(255, 255, 255),
		flipFps = 3,
		zOffset = 0,
	},
	{
		-- thin at the rim. Every layer is one flat colour: overlapping particles of different
		-- colours flicker as they swap draw order while they orbit
		name = "skin",
		enabled = true,
		texture = "softSheetFlat",
		radius = 0.8,
		size = 0.6,
		density = 2.5,
		lifetime = 6,
		opacity = 0.2,
		fadeIn = 0.35,
		fadeOut = 0.4,
		grow = 1.15,
		squash = -0.25,
		rotation = 180,
		rotSpeed = 5,
		shade = 1,
		tint = Color3.fromRGB(255, 255, 255),
		flipFps = 4,
		zOffset = 0,
	},
	{
		name = "wisp",
		enabled = true,
		texture = "wispFlat",
		radius = 1,
		size = 0.5,
		density = 1,
		lifetime = 5,
		opacity = 0.1,
		fadeIn = 0.35,
		fadeOut = 0.45,
		grow = 1.3,
		squash = -0.4,
		rotation = 20,
		rotSpeed = 6,
		shade = 1,
		tint = Color3.fromRGB(255, 255, 255),
		flipFps = 6,
		zOffset = 0,
	},
}

-- Where the funnel meets the cloud it flares out into a wide, lowered cloud base of the same
-- smoke, with darker ragged wisps (scud) hanging under it. (The full parent storm is Phase 2.)
Config.base = {
	enabled = true,
	rings = 3, -- rings from the funnel's top out to the edge of the base (camera-facing volume)
	radius = 2.2, -- the base's outer radius, x the funnel's radius at the top. Larger breaks up: past
	-- ~1000 studs from the camera Roblox thins particles out (the far field is Phase 2's parent storm)
	maxRadius = 1600, -- studs
	minRadius = 500, -- studs: thin tornadoes (ropes) still hang from a broad base
	rise = 0, -- the outer edge sits this share of the funnel height above the funnel's top
	sag = 0.1, -- the inner rings sit this share of the funnel height below the top
	spin = 0, -- x the funnel's spin. 0: still rings can differ in colour without flickering
	color = Color3.fromRGB(122, 123, 124), -- next to the funnel (= funnel.colorTop: no colour seam to flicker)
	edgeColor = Color3.fromRGB(96, 100, 108), -- at the outer edge (darker; fine while the base doesn't spin)
}
-- The parent storm's cloud base under the puff chain (CloudBase): a ceiling of cells on a
-- jittered hex grid, lowered into a collar round the funnel. Colours: Config.base.color near the
-- funnel, Config.base.edgeColor at the rim. (The rings and deck below are the ring renderer's.)
Config.cloudBase = {
	enabled = true,
	radius = 3, -- x the funnel's radius at the top (ref1's base is ~3 funnel-top widths)
	minRadius = 700, -- studs
	maxRadius = 950, -- studs (particles thin out past ~1000 studs from the camera)
	spacing = 230, -- studs between cells
	thickness = 240, -- studs: how deep the ceiling is
	collar = 1.6, -- width of the lowered collar, x the funnel's radius at the top
	sag = 0.15, -- how far the collar hangs below the funnel's top, x the funnel height
	rise = 0.06, -- how far the outer base sits higher, x the funnel height
	lumpiness = 0.6, -- random up/down of cells, x thickness
	edgeFade = 0.7, -- share of the radius over which the particle part fades into the far ceiling
	underShade = 0.85, -- the underside (lumps, scud) is this much darker
	seed = 7,
	-- the far ceiling: textured layers (not particles), stacked from height down
	ceiling = {
		-- off: Roblox stops drawing parts a few thousand studs out (sooner at low quality), so the
		-- textured ceiling always showed a hard edge or seams; kept for experiments
		enabled = false,
		texture = "ceiling",
		layers = 3,
		height = 150, -- studs above the funnel's top: the top layer
		gap = 40, -- studs between layers
		tile = 1600, -- studs per texture repeat (lower layers repeat a little wider)
		size = 2048, -- studs per ceiling part (2048 = Roblox's limit)
		extent = 8000, -- studs out from the funnel the ceiling reaches (in parts of size)
		droopStart = 2500, -- studs out: the ceiling starts curving down ...
		droopEnd = 7000, -- ... reaching the ground here (its edge sits on the horizon)
		opacity = 0.95, -- the top layer
		thinning = 0.3, -- the lowest layer is this much more see-through
		shade = 1.6, -- the undersides are lit only by ambient light: brighten to match the cells
		backing = false :: any, -- false, or a colour: the top layer is a solid part (no sky through the gaps)
		gridYaw = 0, -- degrees the tile grid is turned (the lab turns it to face its camera)
		snapTile = false, -- round the texture repeat to a whole number per part (seamless tiles)
		roundCorners = false, -- leave out the corner tiles (a rounder edge)
		detailExtent = false :: any, -- false, or studs: the layers under the top one stop here
	},
}
-- The parent storm's base as mesh tiles (StormBase.luau): replaces the old storm-scale shells for
-- the view from under the storm. Lengths in studs (= metres); colours before the scene's light.
Config.stormBase = {
	enabled = false, -- looks turn it on (it takes over from cloudBase's cells and ceiling)
	heading = 45, -- degrees the storm moves toward, anticlockwise from +X seen from above (90 = -Z)
	seed = 4.2,
	extent = 7000, -- studs out from the tornado the tiles reach (Roblox stops drawing parts ~7000 out)
	segments = 24, -- the middle tile's grid, quads a side (85 studs apart): the wall cloud's shape
	texels = 64, -- each outer tile's texture, texels a side (32 studs each): colour, mottling and the ragged edge
	boundsHeight = 600, -- studs: the middle tile's fixed half height (heights must stay inside)
	castShadow = true, -- the base shades the ground and the tornado from the sun
	meshRelief = 1, -- the middle mesh takes this share of the field's heights (looks with impostor puffs: low)
	detailTexture = "", -- a baked cloud-underside tile (tools/blender/storm_volume_bake.py) multiplied in ("" = none) ...
	detailMean = 0.75, -- ... its mean brightness (normalised offline) ...
	detail = 1, -- ... and how strongly it shows on the outer tiles
	radius = 5200, -- the base's edge, studs from the tornado (the bright slot shows beyond it) ...
	stretch = 0.5, -- ... this much farther toward the rain core
	ragged = 0.12, -- the edge wanders in and out by this share ...
	raggedScale = 1400, -- ... over this many studs
	edgeSoft = 900, -- studs over which the edge fades out
	lumpScale = 700, -- studs: broad lumps
	lumpHeight = 25, -- studs: the wall cloud's underside lumps (the outer base is flat)
	lumpShade = 0.26, -- lumps darker / lighter by this share (three scales: 700, 230, 85 studs)
	thin = 0.55, -- outer parts thin out in patches by up to this much (the sky glows through: layers, not a plate) ...
	thinFrom = 0.4, -- ... from this share of the way to the edge
	thinScale = 900, -- studs: the patches
	lightBand = 2200, -- studs inside the edge where the base lightens toward edgeColor
	color = Color3.fromRGB(48, 54, 60), -- the middle of the base
	edgeColor = Color3.fromRGB(108, 116, 122), -- near its edge (lit from the clear sky beyond)
	coreColor = Color3.fromRGB(34, 38, 44), -- over the rain core
	coreShade = 0.7,
	precipAhead = 3500, -- the rain core's middle from the wall cloud: ahead ...
	precipLeft = 2500, -- ... and left of the storm's motion (the forward flank)
	precipRadius = 3000,
	wallCloud = {
		radius = 680, -- studs (it must fit inside the middle 2048-stud tile: StormBase)
		plateau = 0.7, -- flat underside out to this share of the radius, then the sides (steep: an abrupt lowering)
		ragged = 0.1, -- finer scallops round its rim (a smooth disc read as a solid block)
		drop = 0.28, -- hangs this share of the cloud base height below the base
		ahead = 200, -- its middle from the tornado (the tornado sits near its rear-right edge)
		left = 100,
		color = Color3.fromRGB(34, 39, 45), -- darker than the base (it was lighter: hard to see)
		bands = 5, -- curved striations round it ...
		twist = 2.5, -- ... spiralling in ...
		striation = 0.22, -- ... this strong
		spinRate = 0.05, -- radians/s (about two minutes a turn: visible rotation)
		redrawRate = 60, -- recolours a second (every frame: slower steps the turning bands visibly)
	},
	-- the clear slot: bright thin cloud round the wall cloud's rear (the rear-flank downdraught)
	slot = {
		from = 1.2, -- radians off the storm's motion where it starts ...
		to = 2.4, -- ... and is full (behind)
		leftShare = 0.6, -- weaker on the left side
		at = 1.35, -- x the wall cloud's radius
		width = 0.25,
		strength = 0.8,
		color = Color3.fromRGB(150, 160, 166),
		lift = 0.03, -- and higher, x the cloud base height
	},
}

-- The ground under the tornado: what its wind can loft (DebrisCloud). The game sets these from
-- the land and the weather (soil, crops, towns, recent rain); the lab has sliders and presets.
Config.ground = {
	loose = 0.8, -- 0-1: loose material available (bare dry dirt 1, crops/grass ~0.3, town ~0.6)
	moisture = 0.2, -- 0-1: wet soil binds dust and raises the lofting threshold
	fines = 0.6, -- 0-1: share of fine dust (rides the updraught high) vs coarse debris (the low skirt)
	water = 0, -- 0-1: over water: spray instead of dust
	color = Color3.fromRGB(118, 100, 78), -- dry soil (wet is darker)
}

-- The debris / dust cloud (DebrisCloud.luau; docs/tornado-physics/DEBRIS-CLOUD.md). Its look is
-- derived from the vortex (EF, core radius, swirl ratio, forward speed) and Config.ground; these
-- are the coefficients of those relations (trends from LES / lab / radar studies, numbers tuned).
Config.debrisCloud = {
	enabled = true,
	threshold = 10, -- m/s: ground wind that lofts dry dust (x 1 + 1.5 moisture)
	fullWind = 50, -- m/s: the supply is full once V^2 - threshold^2 reaches this squared
	sprayFrom = 20, -- m/s: over water, spray starts here (full 30 m/s higher)
	sprayFines = 0.25, -- spray drops are big: little rides up high
	sprayColor = Color3.fromRGB(214, 220, 226),
	radius = { 1.2, 0.4, 0.5 }, -- skirt radius / rc = a + b log10(Aa) + c min(S, 2) (Aa = V^2 / (rc g))
	maxRadius = 4, -- ... at most this x rc
	skirt = { 1.5, 0.35 }, -- skirt height / rc = a - b log10(Aa), 0.3-1.5 (stronger centrifuging: lower, wider)
	dustHeight = 5, -- fine dust height ~ this x rc x (V / 50)^0.6, x fines, x (1 - 0.6 moisture) ...
	dustCap = 0.9, -- ... at most this share of the cloud base height
	coneAngle = { 15, 12.5, 5 }, -- half-angle, degrees = a + b min(S, 2) + c log10(Aa)
	twoCell = { 0.25, 0.5 }, -- swirl over which the central column opens into a hollow ring
	hollow = 0.65, -- the hollow centre's radius, x rc (two-celled)
	mature = 8, -- seconds the cloud takes to build / die away (real ~120 s; short for tuning)
	swirl = 0.75, -- the debris turns at this share of the field's tangential wind
	eject = 0.3, -- coarse debris thrown out at this x V ...
	ejectTime = 1.5, -- ... dying away over this many seconds
	fall = 9.81, -- studs/s^2: coarse debris falls back
	rise = 0.12, -- fine dust rises at this x V (an annulus) ...
	jet = 0.12, -- ... plus this x V as a central jet (low swirl)
	spikeRise = 0.3, -- suction-vortex jets rise at this x V
	skirtCount = 90,
	dustCount = 80,
	spikeCount = 24,
	respawnsPerFrame = 24, -- pickups are rejection-sampled on the wind: many tries fail
	skirtTexture = "wispyFlat",
	dustTexture = "strandsFlat",
	spikeTexture = "strandsFlat",
	skirtSize = { 0.55, 1.0 }, -- x the skirt radius
	dustSize = { 1.2, 2.2 }, -- x rc
	spikeSize = { 0.5, 0.9 }, -- x rc
	skirtAspect = 0.7,
	dustAspect = 1.5,
	spikeAspect = 2.2,
	grow = 0.8, -- sprites grow by this share over their life (or height)
	skirtOpacity = 0.7,
	dustOpacity = 0.55,
	dustThin = 0.9, -- dust opacity falls as (1 - height share)^this: densest at the ground
	dustBase = 0.6, -- dust sprites start at this x their size at the ground and grow by `grow` to the top
	spikeOpacity = 0.45,
	skirtShade = 0.7, -- x the ground colour: coarse debris reads darker ...
	dustShade = 1.0, -- ... fine dust lighter
	spikeShade = 1.1,
	lightInfluence = 0.2,
	fadeInTime = 0.35, -- seconds a sprite takes to appear (fast: it must appear at the ground, not after rising)
	fadeOut = 0.35, -- share of the life fading out
	groundLift = 0.05, -- a sprite at the ground is centred this x its height up (its lower half sunk: the cloud starts at the contact)
	pickupReach = 1.6, -- coarse debris is picked up within this x rc (where the wind is strongest), then thrown out
	spriteSpin = 6, -- +- degrees/s
	flipFps = 1.2,
	oneShot = false, -- play a simulation flipbook once over each sprite's life (smoke_sim_flipbook.py)
	describeEvery = 4, -- seconds between the derived numbers in the output (0 = never)
}

-- Wisps at any distance (WispSprites.luau): faint fibrous smoke sprites (BillboardGuis, drawn past
-- the ~800-stud particle limit) fraying the funnel's edge and hanging from the wall cloud.
Config.wisps = {
	enabled = true,
	lightInfluence = 0.15, -- like the puffs: one flat colour per layer
	fadeIn = 0.25, -- share of a sprite's life spent fading in ...
	fadeOut = 0.4, -- ... and out
	spin = 4, -- +- degrees/s each sprite turns
	flipFps = 1.5, -- flipbook frames a second (slow: the wisps morph)
	funnel = {
		enabled = true,
		texture = "strandsFlat",
		count = 48,
		life = { 3, 6 }, -- seconds
		from = 0.04, -- height shares where they start ...
		to = 0.9, -- ... and fade into the cloud
		offset = { 0.85, 1.1 }, -- start this far out, x the funnel's radius (past the edge: the outline frays) ...
		drift = 0.06, -- ... drifting out this much a second
		size = { 0.6, 1.0 }, -- width, x the funnel's width there
		aspect = 1.6, -- height, x the width (the strands run up the funnel)
		opacity = 0.3,
		shade = 0.85, -- x the funnel's colour (unshaded sprites read brighter than the lit ribbon)
		rise = 22, -- studs/s they climb (with the condensation: ribbonFunnel.riseSpeed)
		spinShare = 0.6, -- turn at this share of the air's angular speed
	},
	wall = {
		enabled = true,
		texture = "wispyFlat",
		count = 40,
		life = { 8, 16 },
		reach = { 0.6, 1.2 }, -- spread from the wall cloud's middle, x its radius (mostly the rim, where they show against the brighter base)
		hang = { 40, 170 }, -- studs below its underside (ragged lumps and scud hanging from it)
		sink = 1.5, -- studs/s they sag as they age
		clear = 40, -- studs kept clear of the underside's lowest lumps
		size = { 260, 620 }, -- studs
		aspect = 0.7, -- height, x the width (hanging lumps, wider than tall)
		opacity = 0.3,
		shade = 0.78, -- x the wall cloud's colour: darker (wisps show by contrast, not by shape alone)
	},
	-- the debris cloud at the contact (refs: Severity clips 10-37-29 / 11-04-14, real/01_cone_a/b):
	-- dense and dark round the foot, 2-6 funnel widths across, frayed at its edges
	dust = {
		enabled = false, -- replaced by DebrisCloud (derived from the vortex and the ground)
		texture = "wispyFlat",
		count = 80,
		life = { 2.5, 5 },
		radius = 5, -- the cloud's radius, x the funnel's radius at the ground ...
		minRadius = 110, -- ... at least (studs)
		inner = 0, -- puffs start from this share of the radius out
		startHeight = 0.12, -- up to this x the radius above the ground
		size = { 0.55, 1.1 }, -- puff width, x the radius
		grow = 0.6, -- they grow by this share over their life
		aspect = 0.75,
		swirl = 0.5, -- turn round the contact at this share of the air's angular speed there
		spread = 4, -- studs/s outward
		rise = 5, -- studs/s up
		opacity = 0.5,
		shade = 1.0, -- x the debris colour (darker in the middle: see WispSprites; 0.75 read near black)
	},
	-- ragged scud under the whole base, drifting in toward the wall cloud (layers under the deck)
	scud = {
		enabled = true,
		texture = "wispyFlat",
		count = 36,
		life = { 12, 24 },
		distance = { 900, 4500 }, -- studs from the tornado
		hang = { 60, 260 }, -- studs below the base
		clear = 20,
		size = { 300, 800 },
		aspect = 0.5,
		inflow = 8, -- studs/s toward the wall cloud
		opacity = 0.28,
		shade = 0.8, -- darker than the base above (they show by contrast)
	},
	-- the base's underside as impostor cloud: rendered volumetric puffs (tools/blender/base_puff.py)
	-- hanging under the base mesh (which stays as a dark backing), so the base has a soft, lumpy,
	-- layered underside instead of a flat sheet with straight edges
	deck = {
		enabled = false, -- looks turn it on
		texture = "rbxassetid://101768089677789", -- 4 x 4 sheet of puffs seen from below
		flipFps = 0, -- each keeps one puff (no flipbook)
		count = 320,
		life = { 25, 50 },
		reach = 1.15, -- spread over this x the base's radius ...
		minCover = 0.4, -- ... where the base is at least this solid
		hang = { 0, 40 }, -- studs below the underside
		clear = 0,
		size = { 420, 900 }, -- studs across (the sheet's cell; the puff fills ~2/3 of it)
		aspect = 0.6, -- squashed: a flat lump of base, not a ball
		opacity = 0.65,
		sink = 0.15, -- its middle sits this x its height below the underside (just the belly shows)
		gain = 1.9, -- x the field's colour (the puffs are mid grey) ...
		maxBright = 0.62, -- ... no brighter than this (a pale puff against the dark base read as a lit cloud)
	},
	edge = {
		enabled = true,
		texture = "wispyFlat",
		count = 60,
		life = { 10, 20 },
		inside = { 0, 700 }, -- studs inside the base's edge (where its fade crosses one half)
		hang = { 0, 120 }, -- studs below the base
		sink = 2,
		clear = 20,
		size = { 600, 1400 }, -- studs (kilometres away: big)
		aspect = 0.55, -- ragged lumps hanging from the lip, wider than tall
		opacity = 0.35,
		shade = 0.82, -- x the base's colour there: darker against the bright sky beyond
	},
}

-- Rain under the parent storm (RainCurtains.luau), placed in Config.stormBase's frame.
Config.rainCurtains = {
	enabled = false, -- looks turn it on with stormBase
	texture = "rbxassetid://86246653635299", -- tools/rain/rain_shaft.py: a soft column, faint streaks, tiles vertically
	beamTexture = "rbxassetid://87922397061431", -- (unused: textured Beams this far out did not draw) the shaft turned 90 degrees
	lightInfluence = 0.35, -- mostly its own colour: lit fully by the scene under the dark base it went dark on dark
	reach = 0.98, -- curtains reach this share of the way up to the cloud base ...
	steps = { { 0.6, 1 }, { 0.72, 0.7 }, { 0.82, 0.45 }, { 0.9, 0.25 }, { 1, 0.1 } }, -- ... in pieces: {top as a share of the height, opacity x}: fading out up into the base
	fadeGround = 0.08, -- share of the length fading in at the ground (the curtain's top fades out into the base)
	seed = 3,
	count = 14, -- veils in the rain core
	coreRadius = 2600, -- studs: how far they spread from its middle
	width = { 900, 1900 }, -- studs
	tileAspect = 1.4, -- texture repeat height, x the width
	opacity = { 0.35, 0.85 }, -- at the core's edge, in its middle (the shaft texture's own alpha halves these)
	color = Color3.fromRGB(120, 128, 136), -- in the middle (dark, heavy rain) ...
	edgeColor = Color3.fromRGB(168, 176, 184), -- ... and at the edge (paler, lit)
	fallSpeed = 45, -- studs/s the streaks fall (texture scroll)
	wrapCount = 5, -- thin curtains round the wall cloud's rear ...
	wrapFrom = -200, -- ... from this many degrees off the storm's motion (- = right; -180 = straight behind) ...
	wrapTo = -280, -- ... round to here (behind the tornado's left, seen by a chaser to its south)
	intoBase = 200, -- studs each curtain reaches up inside the cloud base (its top edge hidden)
	nearFade = { 900, 1600 }, -- studs from the camera: curtains closer than this fade out
	wrapAt = 1.5, -- x the wall cloud's radius
	wrapOpacity = 0.22,
}

-- Layers of each cell. size and spread are x the cell spacing; height and y are x thickness
-- (y: where the layer hangs, 0 = the ceiling's middle); squash < 0 widens; under: underside colour.
Config.cloudBaseLayers = {
	{
		name = "sheet",
		enabled = true,
		texture = "softSheetFlat",
		size = 2.2,
		spread = 1,
		height = 0.5,
		y = 0,
		squash = -0.3,
		count = 8,
		lifetime = 16,
		opacity = 0.7,
		fadeIn = 0.3,
		fadeOut = 0.35,
		grow = 1.08,
		rotation = 6,
		rotSpeed = 0.5,
		upright = false, -- face the camera fully: kept upright, it goes paper-thin seen from below
		shade = 1,
		flipFps = 1,
		zOffset = 0,
	},
	{
		name = "lumps",
		upright = false, -- face the camera fully: kept upright, it goes paper-thin seen from below
		enabled = false,
		under = false,
		texture = "softSheetFlat",
		size = 0.75,
		spread = 0.9,
		height = 0.3,
		y = -0.55,
		squash = -0.4,
		count = 4,
		lifetime = 12,
		opacity = 0.45,
		fadeIn = 0.3,
		fadeOut = 0.35,
		grow = 1.1,
		rotation = 8,
		rotSpeed = 1,
		shade = 1,
		flipFps = 1.5,
		zOffset = 0,
	},
	{
		name = "scud",
		enabled = true,
		under = true,
		texture = "shredFlat",
		size = 0.9,
		spread = 1,
		height = 0.5,
		y = -1.3,
		squash = -0.2,
		count = 2,
		lifetime = 9,
		opacity = 0.15,
		fadeIn = 0.25,
		fadeOut = 0.45,
		grow = 1.8,
		rotation = 8,
		rotSpeed = 1,
		upright = false, -- face the camera fully: kept upright, it goes paper-thin seen from below
		drift = 6,
		shade = 1,
		flipFps = 3,
		zOffset = 0,
	},
}

-- Layers of each base ring (as Config.layers, plus y = studs above the ring; size is x sizeMax).
Config.baseLayers = {
	{
		name = "deck",
		enabled = true,
		texture = "softFlat",
		y = 0,
		radius = 1,
		size = 0.45,
		density = 3,
		lifetime = 12,
		opacity = 1,
		fadeIn = 0.35,
		fadeOut = 0.4,
		grow = 1.1,
		squash = -0.3,
		rotation = 180,
		rotSpeed = 2,
		shade = 1,
		tint = Color3.fromRGB(255, 255, 255),
		flipFps = 2,
		zOffset = 0,
	},
	{
		name = "scud",
		enabled = true,
		texture = "softSheetFlat",
		y = -40,
		radius = 0.9,
		size = 0.22,
		density = 3,
		lifetime = 10,
		opacity = 0.22,
		fadeIn = 0.35,
		fadeOut = 0.4,
		grow = 1.2,
		squash = -0.3,
		rotation = 180,
		rotSpeed = 2,
		shade = 0.85,
		tint = Color3.fromRGB(255, 255, 255),
		flipFps = 2,
		zOffset = 0,
	},
}

-- The foot of the funnel: upright particles with a flat, crisp bottom edge standing just above the
-- ground (so nothing cuts into it). Still (no spin, no rotation, no growth) so the edge stays put.
Config.foot = {
	enabled = true,
	lift = 1, -- studs between the ground and the particles' bottom edge (0 = touching: shimmers)
	withPuffs = false, -- off under the puff chain: the dust hides the contact (a flat foot looks forced)
}
-- Layers of the foot (as Config.layers; size is x the funnel's radius at the ground).
Config.footLayers = {
	{
		name = "foot",
		enabled = true,
		texture = "footLowFlat",
		radius = 0.05,
		size = 2.27,
		density = 3,
		lifetime = 10,
		opacity = 1,
		fadeIn = 0.35,
		fadeOut = 0.4,
		grow = 1, -- keep 1: growing would push the bottom edge into the ground
		squash = 0,
		rotation = 0,
		rotSpeed = 0,
		shade = 1,
		tint = Color3.fromRGB(255, 255, 255),
		flipFps = 0,
		zOffset = 0,
		spin = 0,
	},
}

-- The shade: a darker band down the funnel's shadow side (ref1 is lit from the left: its right
-- edge is ~15% darker). Placed each frame on the side away from the sun across the camera's
-- view, and always drawn in front of the funnel (ZOffset), so it never swaps draw order with it
-- (differently coloured particles swapping order flicker).
Config.shade = {
	enabled = true,
	every = 2, -- one shade ring per this many funnel rings
	offset = 0.45, -- how far toward the shadow side, x the funnel's radius
	darken = 0.86, -- colour x this
	zOffset = 1.4, -- drawn this far (x the funnel's radius) toward the camera: always in front
}
Config.shadeLayers = {
	{
		name = "shade",
		enabled = true,
		texture = "softFlat",
		radius = 0.05,
		size = 2,
		density = 2,
		lifetime = 8,
		opacity = 0.05,
		fadeIn = 0.35,
		fadeOut = 0.4,
		grow = 1.05,
		squash = 0,
		rotation = 180,
		rotSpeed = 2,
		shade = 1,
		tint = Color3.fromRGB(255, 255, 255),
		flipFps = 0,
		zOffset = 0,
		spin = 0,
	},
}

-- The debris cloud: dark dust thrown up from the ground round the contact: each puff starts
-- small at the ground (startSize) and billows up and out (rise studs/s, spread degrees, slowed by
-- drag) while growing (grow) and fading; not locked to the spinning ring, so it lags like real dust.
-- Wider than the funnel (nearly every
-- reference has one; its colour follows the ground: dark soil, brown dirt, grey rubble). Off in
-- the ref1 look; the lab's presets turn it on.
Config.debris = {
	enabled = false,
	radius = 1.4, -- x the funnel's radius at the ground
	height = 40, -- studs: how tall a band the dust starts in
	spin = 0.8, -- x the funnel's spin (the dust swirls round the contact as it rises)
	color = Color3.fromRGB(66, 62, 58), -- dark soil
	-- the dust takes its colour from the ground under the contact (sampled once a second):
	-- this share of the ground's dust colour, the rest the look's own colour above
	groundShare = 0.35,
	groundDust = nil :: Color3?, -- set at run time by FunnelView (the blended dust colour)
	zFront = 1, -- drawn this far (x its radius) toward the camera: always in front of the funnel
}
Config.debrisLayers = {
	{
		name = "cloud",
		startSize = 0.3,
		drag = 0.6,
		spread = 75,
		rise = 18,
		upright = false,
		enabled = true,
		texture = "softSheetFlat",
		radius = 1,
		size = 1,
		density = 4,
		lifetime = 7,
		opacity = 0.6,
		fadeIn = 0.3,
		fadeOut = 0.4,
		grow = 2.6,
		squash = 0,
		rotation = 180,
		rotSpeed = 8,
		shade = 1,
		tint = Color3.fromRGB(255, 255, 255),
		flipFps = 2,
		zOffset = 0,
		tall = 0.3,
	},
	{
		name = "puffs",
		startSize = 0.3,
		drag = 0.5,
		spread = 45,
		rise = 35,
		enabled = false,
		texture = "softSheetFlat",
		y = 0,
		radius = 0.8,
		size = 0.5,
		density = 2.5,
		lifetime = 4,
		opacity = 0.35,
		fadeIn = 0.3,
		fadeOut = 0.45,
		grow = 2.4,
		squash = 0,
		rotation = 180,
		rotSpeed = 10,
		shade = 0.85,
		tint = Color3.fromRGB(255, 255, 255),
		flipFps = 2,
		zOffset = 0,
		tall = 0.5,
	},
	{
		-- dust rolling out low along the ground
		name = "skirt",
		enabled = false,
		texture = "softSheetFlat",
		radius = 1.2,
		size = 0.9,
		density = 2.5,
		lifetime = 8,
		opacity = 0.35,
		fadeIn = 0.25,
		fadeOut = 0.45,
		grow = 3,
		squash = 0,
		rotation = 180,
		rotSpeed = 5,
		shade = 1,
		tint = Color3.fromRGB(255, 255, 255),
		flipFps = 2,
		zOffset = 0,
		tall = 0.5,
		rise = 6,
		spread = 88,
		drag = 0.3,
		startSize = 0.4,
	},
}

-- Sub-vortex strands under a lifted or lowering funnel (SubStrandView): thin dotted chains of
-- small dark puffs curling from the ground into the funnel's base (ref5_subs1.png, ref6_subs.png).
Config.subStrands = {
	enabled = true,
	minBottom = 0.08, -- only when the funnel ends at least this share of the way up
	perSwirl = 3, -- strands = 1 + this x the swirl ratio (EF2's 0.5 -> 2, 0.7 -> 3) ...
	max = 4, -- ... up to this many
	nodes = 26, -- puffs along each strand (spacing ~ size: dotted)
	size = 0.09, -- puff size, x the funnel's radius (width / 2) ...
	minSize = 5, -- ... studs
	maxSize = 22,
	puffs = 2, -- puffs alive per node
	puffLife = 1.4,
	orbit = { 0.25, 0.75 }, -- orbit radius, x the funnel's radius (width / 2)
	spread = 0.4, -- extra spread at the ground, x that radius
	converge = 0.85, -- narrows by this share up to the funnel (meets its tip)
	reach = 1.04, -- reaches this share of the funnel's bottom height (into its base)
	twist = 1.6, -- radians of curl from the ground to the funnel
	wiggle = 0.9, -- radians of slow wandering
	rate = { 0.8, 1.3 }, -- orbit speed, x the funnel's spin
	life = { 6, 14 }, -- seconds each strand lasts
	fade = 1.5,
	opacity = 0.5,
	shade = 0.62, -- x the funnel's colour ...
	tint = Color3.fromRGB(52, 62, 78), -- ... pulled toward this blue-grey
	tintShare = 0.4,
	texture = "softSheetFlat",
}

-- Dust that rides the wind (DustView): tracers picked up where the wind can loft dust, carried
-- by the wind field. Replaces the drawn debris cloud layer when on (the lab switches it).
Config.dustTracers = {
	enabled = true,
	count = 80, -- tracers
	threshold = 22, -- m/s: horizontal wind at the ground that lofts visible dust
	fromEf = 0, -- dust strength ramps from this rating to +2
	pickup = { 0.8, 2.0 }, -- picked up this far out, x the radius of maximum wind (the skirt sits just outside the funnel)
	pickupHeight = { 2, 20 }, -- m above the ground
	loft = 0.25, -- turbulent lift: vertical gusts of this share of the local wind ...
	gustTime = 2, -- ... changing over this many seconds (tools/windfield/dust.luau tuned these)
	triesPerFrame = 6,
	life = { 4, 10 }, -- seconds
	lag = { 0.5, 3.0 }, -- seconds to take up the wind (bigger = heavier grit, flung out further)
	settle = 0.5, -- m/s falling out
	top = 0.45, -- it thins out by this share of the cloud base's height
	rate = 7, -- puffs a second along each tracer's path
	puffLife = 2.2, -- seconds each puff lasts
	size = 0.38, -- puff size, x the radius of maximum wind ...
	minSize = 26, -- ... studs (small tornadoes still raise a visible bush)
	maxSize = 70,
	opacity = 0.17,
	haze = 0.35, -- dust colour mixed this far toward the funnel's colour (seen through haze)
	texture = "softSheetFlat",
	debug = false,
}

-- Dust colour by the ground material under the contact (FunnelView samples it).
Config.groundDust = {
	soil = Color3.fromRGB(78, 62, 48), -- grass, leafy grass, ground, mud: churned soil
	sand = Color3.fromRGB(150, 128, 96),
	rubble = Color3.fromRGB(110, 106, 100), -- concrete, asphalt, brick, plastic: grey rubble
	snow = Color3.fromRGB(205, 210, 216),
}

-- The scour track (ScourView): dark marks where the contact has been.
Config.scour = {
	enabled = true,
	width = 1.6, -- a mark's width, x the contact's width
	spacing = 0.35, -- a new mark each this many contact widths travelled
	opacity = 0.55,
	grind = 6, -- seconds over a spot to darken it fully
	life = 300, -- seconds to fade away
	maxMarks = 300,
	texture = "softFlat",
	color = Color3.fromRGB(58, 46, 36),
}

-- The underside of the cloud base: flat smoke sheets lying across a disc from the funnel out to
-- the base's edge (one emitter per layer; the particles lie flat, so from below they read as a
-- smooth ceiling rather than a pile of balls).
Config.deck = {
	enabled = true,
	hole = 0.6, -- the disc's hole, x the funnel's radius at the top
	y = 0.02, -- height above the funnel's top, x the funnel height
	maxParticles = 260,
	drift = 1, -- studs/s upward: gives the flat sheets a steady facing (near 0 they flip)
}
-- Layers of the deck (as Config.layers, plus y = studs above the deck; size is x sizeMax;
-- density = particles per particle-area of the disc).
Config.deckLayers = {
	{
		name = "sheet",
		enabled = true,
		texture = "softFlat",
		y = 0,
		radius = 1,
		size = 0.6,
		density = 3,
		lifetime = 14,
		opacity = 1,
		fadeIn = 0.35,
		fadeOut = 0.4,
		grow = 1.1,
		squash = 0,
		rotation = 180,
		rotSpeed = 2,
		shade = 1,
		tint = Color3.fromRGB(255, 255, 255),
		flipFps = 2,
		zOffset = 0,
	},
	{
		name = "under",
		enabled = true,
		texture = "softSheetFlat",
		y = -35,
		radius = 0.85,
		size = 0.3,
		density = 1,
		lifetime = 9,
		opacity = 0.35,
		fadeIn = 0.35,
		fadeOut = 0.4,
		grow = 1.15,
		squash = 0,
		rotation = 180,
		rotSpeed = 3,
		shade = 1,
		tint = Color3.fromRGB(255, 255, 255),
		flipFps = 3,
		zOffset = 0,
	},
}

-- Tornado profiles: what a tornado of each kind starts as. shape = weights of the shape
-- presets in Shape.luau, blended; width = funnel diameter at the ground (studs); ef =
-- intensity (EF scale, fractional); speed = translation speed (studs/s); cloudBase = studs from
-- the ground up to where the funnel meets the cloud.
Config.profiles = {
	rope = { width = 20, shape = { rope = 1 }, ef = 0.5, subVortices = 0, speed = 12, cloudBase = 600 },
	cone = { width = 280, shape = { cone = 1 }, ef = 2, subVortices = 0, speed = 15, cloudBase = 520 },
	stovepipe = { width = 360, shape = { stovepipe = 1 }, ef = 3, subVortices = 2, speed = 18, cloudBase = 520 },
	wedge = { width = 800, shape = { wedge = 1 }, ef = 4, subVortices = 5, speed = 20, cloudBase = 480 },
}

-- Wind model (Vortex.luau): Rankine vortex + inflow + updraft.
Config.wind = {
	-- The tornado's wind field (Vortex, WindField). Values from Doppler-radar fits, laboratory
	-- vortices and engineering models: docs/tornado-physics/README.md.
	-- EF scale centre speeds, m/s (EF0..EF5): the peak 3-s gust 10 m up, ground-relative
	efSpeeds = { 33.5, 43.8, 55.0, 67.0, 81.8, 98.3 },
	ratingHeight = 10, -- m: where the rating is measured
	coreRadius = 1.0, -- radius of maximum wind, x the funnel's radius at the ground (it sits at or outside the cloud)
	minCore = 15, -- m
	alpha = 0.6, -- outer decay r^-alpha (Doppler fits 0.5-0.8; 1 = Rankine)
	eta = 0.5, -- sharpness of the peak (Wood & White)
	z0 = 3, -- m: the wind rises from 0 at the ground over ~3 x this
	jetHeight = 30, -- m: the near-ground jet (strongest winds 10-50 m up)
	jetByEf = { 0.15, 0.15, 0.2, 0.2, 0.25, 0.25 }, -- jet overshoot share (more at low swirl)
	widen = 0.3, -- the core widens by this share from the ground to the cloud base
	inflowByEf = { 0.6, 0.6, 0.55, 0.5, 0.5, 0.45 }, -- peak inflow, x the vortex's peak wind
	inflowDepth = 0.15, -- inflow layer depth (where inflow peaks), x the core radius
	swirlByEf = { 0.2, 0.3, 0.5, 0.7, 0.9, 1.1 }, -- swirl ratio when the engine doesn't send one
	breakdown = 0.3, -- swirl where the vortex starts turning two-celled
	twoCellFull = 0.8, -- and is fully two-celled
	twoCell = 1.2, -- strength of the central downdraught when two-celled (1.5 = strong)
	cellWidth = 0.6, -- the downdraught's width, x the core radius
	multiple = 1.0, -- swirl where sub-vortices appear (2, then one more each +1/3, up to 6)
	subRadius = 0.1, -- sub-vortex radius, x the core radius
	subSpeed = 0.4, -- sub-vortex peak spin, x the vortex's peak
	subOrbit = 1.0, -- orbit radius, x the core radius
	subRate = 0.7, -- orbit angular speed, x peak / core radius
	subDecay = 150, -- m: sub-vortices fade with height over this
	turbulence = 0.2, -- gusts, share of the local wind
	turbScale = 0.5, -- eddy size, x the core radius
	pulse = 0.12, -- the whole vortex strengthens and weakens by this share
	pulsePeriod = 40, -- seconds
	taperIn = 8, -- the vortex fades out between taperIn and taperOut x the core radius
	taperOut = 15,
	blend = 5, -- the tornado's motion dominates within this x the core radius, the environment's beyond
	airDensity = 1.15, -- kg/m^3
	condense = 1.5, -- condensation funnel (Vortex.funnelRadius, a check only): x the dry cyclostrophic deficit; 1.5 puts an EF3 funnel at ~half the core radius under a 600 m base
}

-- Ranges for the lab's sliders: path -> { min, max, step? }. Anything missing gets a guess.
-- "layer.*" applies to every entry of Config.layers, baseLayers, deckLayers and footLayers.
Config.RANGES = {
	["ground.loose"] = { 0, 1, 0.01 },
	["ground.moisture"] = { 0, 1, 0.01 },
	["ground.fines"] = { 0, 1, 0.01 },
	["ground.water"] = { 0, 1, 0.01 },
	["debrisCloud.mature"] = { 0.5, 180, 0.5 },
	["debrisCloud.threshold"] = { 2, 40, 0.5 },
	["debrisCloud.dustHeight"] = { 0, 40, 0.5 },
	["funnel.ringSpacing"] = { 0.1, 2, 0.01 },
	["funnel.minSpacing"] = { 1, 60, 1 },
	["funnel.maxRings"] = { 4, 120, 1 },
	["funnel.maxPerEmitter"] = { 4, 400, 1 },
	["funnel.spinSpeed"] = { 0, 300, 1 },
	["funnel.maxSpinRate"] = { 0, 10, 0.1 },
	["funnel.colorGamma"] = { 0.2, 4, 0.05 },
	["funnel.groundFade"] = { 0, 0.3, 0.005 },
	["funnel.topFade"] = { 0, 0.5, 0.01 },
	["funnel.lightInfluence"] = { 0, 1, 0.01 },
	["funnel.brightness"] = { 0, 5, 0.05 },
	["funnel.sizeMax"] = { 5, 2000, 1 },
	["funnel.sizeScale"] = { 0.1, 2, 0.01 },
	["funnel.overlap"] = { 0.5, 4, 0.05 },
	["funnel.groundSink"] = { 0, 0.5, 0.01 },
	["funnel.groundClear"] = { 0, 20, 0.1 },
	["layer.y"] = { -400, 400, 1 },
	["layer.radius"] = { 0, 2, 0.01 },
	["layer.spin"] = { 0, 2, 0.01 },
	["layer.size"] = { 0.05, 4, 0.01 },
	["layer.density"] = { 0.2, 6, 0.05 },
	["layer.lifetime"] = { 0.5, 20, 0.1 },
	["layer.opacity"] = { 0, 1, 0.01 },
	["layer.fadeIn"] = { 0, 0.5, 0.01 },
	["layer.fadeOut"] = { 0, 0.5, 0.01 },
	["layer.grow"] = { 0.3, 3, 0.01 },
	["layer.squash"] = { -1, 1, 0.01 },
	["layer.rotation"] = { 0, 180, 1 },
	["layer.rotSpeed"] = { 0, 90, 1 },
	["layer.shade"] = { 0, 2, 0.01 },
	["layer.flipFps"] = { 0, 30, 0.5 },
	["layer.zOffset"] = { -50, 50, 0.5 },
	["base.rings"] = { 0, 16, 1 },
	["base.radius"] = { 1, 6, 0.05 },
	["base.maxRadius"] = { 100, 6000, 10 },
	["base.minRadius"] = { 0, 2000, 10 },
	["base.rise"] = { -0.3, 0.5, 0.005 },
	["base.sag"] = { -0.3, 0.5, 0.005 },
	["base.spin"] = { 0, 2, 0.01 },
	["deck.hole"] = { 0, 1.5, 0.01 },
	["deck.y"] = { -0.3, 0.3, 0.005 },
	["deck.maxParticles"] = { 10, 1000, 1 },
	["deck.drift"] = { 0.2, 20, 0.1 },
	["foot.lift"] = { 0, 20, 0.1 },
	["shade.every"] = { 1, 6, 1 },
	["puffs.spacing"] = { 0.05, 2, 0.01 },
	["puffs.minSpacing"] = { 1, 60, 1 },
	["puffs.maxSpacing"] = { 10, 400, 1 },
	["puffs.maxNodes"] = { 4, 300, 1 },
	["puffs.spinSpeed"] = { 0, 200, 1 },
	["puffs.maxSpinRate"] = { 0, 5, 0.05 },
	["puffs.riseSpeed"] = { 0, 300, 1 },
	["puffs.lowShade"] = { 0.2, 1.2, 0.01 },
	["puffs.dustMix"] = { 0, 1, 0.01 },
	["puffs.dustTake"] = { 0, 1, 0.01 },
	["subVortex.minWidth"] = { 0, 2000, 10 },
	["subVortex.widthPer"] = { 10, 1000, 5 },
	["subVortex.max"] = { 0, 8, 1 },
	["subVortex.nodes"] = { 1, 12, 1 },
	["subVortex.fade"] = { 0.1, 10, 0.1 },
	["subVortex.twist"] = { 0, 6, 0.05 },
	["subVortex.count"] = { 1, 20, 1 },
	["subVortex.puffLife"] = { 0.2, 8, 0.1 },
	["subVortex.size"] = { 0.05, 1.5, 0.01 },
	["subVortex.opacity"] = { 0, 1, 0.01 },
	["subVortex.shade"] = { 0.1, 1.2, 0.01 },
	["subVortex.tintShare"] = { 0, 1, 0.01 },
	["subVortex.zFront"] = { 0, 3, 0.05 },
	["subVortex.limb"] = { 0.05, 1, 0.01 },
	["far.start"] = { 0, 3000, 10 },
	["far.band"] = { 1, 1000, 5 },
	["far.funnelSize"] = { 0.5, 6, 0.05 },
	["far.funnelOpacity"] = { 0, 1, 0.01 },
	["far.baseSize"] = { 0.5, 6, 0.05 },
	["far.baseSquash"] = { 0.1, 2, 0.01 },
	["far.baseOpacity"] = { 0, 1, 0.01 },
	["cloudBase.radius"] = { 1, 20, 0.1 },
	["cloudBase.minRadius"] = { 0, 4000, 10 },
	["cloudBase.maxRadius"] = { 100, 4000, 10 },
	["cloudBase.spacing"] = { 60, 600, 5 },
	["cloudBase.thickness"] = { 10, 600, 5 },
	["cloudBase.collar"] = { 0, 6, 0.05 },
	["cloudBase.sag"] = { 0, 0.5, 0.01 },
	["cloudBase.rise"] = { 0, 0.5, 0.01 },
	["cloudBase.lumpiness"] = { 0, 2, 0.05 },
	["cloudBase.edgeFade"] = { 0.01, 1, 0.01 },
	["cloudBase.underShade"] = { 0.3, 1.2, 0.01 },
	["cloudBase.seed"] = { 1, 999, 1 },
	["cloudBase.ceiling.layers"] = { 0, 6, 1 },
	["cloudBase.ceiling.height"] = { -200, 600, 5 },
	["cloudBase.ceiling.gap"] = { 0, 300, 1 },
	["cloudBase.ceiling.tile"] = { 100, 6000, 10 },
	["cloudBase.ceiling.extent"] = { 0, 12000, 100 },
	["cloudBase.ceiling.droopStart"] = { 0, 12000, 100 },
	["cloudBase.ceiling.droopEnd"] = { 100, 14000, 100 },
	["cloudBase.ceiling.opacity"] = { 0, 1, 0.01 },
	["cloudBase.ceiling.thinning"] = { 0, 1, 0.01 },
	["cloudBase.ceiling.shade"] = { 0.2, 3, 0.01 },
	["layer.height"] = { 0, 3, 0.05 },
	["layer.zFront"] = { 0, 4, 0.05 },
	["layer.lowFade"] = { 0, 1, 0.01 },
	["layer.inset"] = { 0, 2, 0.01 },
	["layer.reach"] = { 0.5, 1.5, 0.01 },
	["layer.silhouette"] = { -1, 1, 2 },
	["puffs.dustTint"] = { 0, 1, 0.01 },
	["puffs.dustHeight"] = { 0, 1, 0.01 },
	["puffs.bottomFade"] = { 0, 0.5, 0.01 },
	["puffs.topFadeLength"] = { 0, 0.5, 0.01 },
	["puffs.refill"] = { 0, 1.5, 0.05 },
	["puffs.lightInfluence"] = { 0, 1, 0.01 },
	["puffs.brightness"] = { 0, 5, 0.05 },
	["puffs.groundReach"] = { 0, 1, 0.01 },
	["puffs.maxPerPoint"] = { 1, 200, 1 },
	["layer.cover"] = { 0.2, 4, 0.05 },
	["layer.offset"] = { 0, 1.5, 0.01 },
	["layer.sizeJitter"] = { 0, 0.9, 0.01 },
	["layer.count"] = { 1, 40, 1 },
	["layer.drift"] = { 0, 1, 0.005 },
	["debris.radius"] = { 0.5, 4, 0.05 },
	["debris.height"] = { 2, 200, 1 },
	["debris.spin"] = { 0, 2, 0.01 },
	["debris.zFront"] = { 0, 4, 0.05 },
	["debris.groundShare"] = { 0, 1, 0.01 },
	["puffs.spinShare"] = { 0, 3, 0.01 },
	["scour.width"] = { 0.2, 5, 0.05 },
	["scour.spacing"] = { 0.05, 3, 0.05 },
	["scour.opacity"] = { 0, 1, 0.01 },
	["scour.grind"] = { 0.1, 60, 0.1 },
	["scour.life"] = { 5, 3600, 5 },
	["scour.maxMarks"] = { 10, 2000, 10 },
	["layer.rise"] = { 0, 200, 1 },
	["layer.spread"] = { 0, 180, 1 },
	["layer.drag"] = { 0, 5, 0.05 },
	["layer.startSize"] = { 0.05, 1, 0.01 },
	["shade.offset"] = { 0, 1.5, 0.01 },
	["shade.darken"] = { 0.3, 1.2, 0.01 },
	["shade.zOffset"] = { 0, 4, 0.05 },
	["funnel.minPerEmitter"] = { 1, 40, 1 },
	["STUDS_PER_METRE"] = { 0.1, 4, 0.05 },
	["wind.coreRadius"] = { 0.3, 3, 0.01 },
	["wind.minCore"] = { 1, 100, 1 },
	["wind.alpha"] = { 0.3, 1, 0.01 },
	["wind.eta"] = { 0.2, 1, 0.01 },
	["wind.z0"] = { 0.2, 20, 0.1 },
	["wind.jetHeight"] = { 5, 100, 1 },
	["wind.widen"] = { 0, 1, 0.01 },
	["wind.inflowDepth"] = { 0.03, 1, 0.01 },
	["wind.breakdown"] = { 0, 1.5, 0.01 },
	["wind.twoCellFull"] = { 0.1, 2, 0.01 },
	["wind.twoCell"] = { 0, 2, 0.01 },
	["wind.cellWidth"] = { 0.2, 1.5, 0.01 },
	["wind.multiple"] = { 0.3, 2, 0.01 },
	["wind.subRadius"] = { 0.02, 0.5, 0.01 },
	["wind.subSpeed"] = { 0, 1, 0.01 },
	["wind.subOrbit"] = { 0.3, 1.5, 0.01 },
	["wind.subRate"] = { 0, 2, 0.01 },
	["wind.subDecay"] = { 10, 600, 1 },
	["wind.turbulence"] = { 0, 0.6, 0.01 },
	["wind.turbScale"] = { 0.1, 2, 0.01 },
	["wind.pulse"] = { 0, 0.4, 0.01 },
	["wind.pulsePeriod"] = { 5, 120, 1 },
	["wind.taperIn"] = { 2, 20, 0.5 },
	["wind.taperOut"] = { 3, 40, 0.5 },
	["wind.blend"] = { 1, 20, 0.5 },
	["wind.condense"] = { 0.5, 5, 0.05 },
	["wind.ratingHeight"] = { 1, 50, 1 },
}

return Config
