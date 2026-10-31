--!nonstrict
-- Storm lab configuration shared by the server and clients (roblox/src/stormlab).
-- Units. Everything the simulation and the renderers compute is in METRES (x east, y north, z up
-- from the scenario window's centre; z is height above the datum, the flat ground's level). Roblox
-- is in STUDS (X east, Y up, Z south) at SCALE studs per metre, the same on every axis - the game's
-- scale. Cross between them only through these helpers:
--   toWorld(x, y, z)        metres -> a stud position (absolute)
--   toLocal(x, y, z)        metres -> a stud offset from an anchor (no origin, no datum)
--   fromWorld(v)            a stud position -> metres (x, y, z)
--   studs(m) / metres(s)    a length (sizes of billboards, parts, particles; camera offsets)
--   groundAt(x, y)          the ground's height above the datum (m) under a point
--   toWorldGround(x, y, h)  h metres above the ground there, as a stud position
-- The main game sets its own frame with setFrame (its map scale, origin, a smooth ground datum and
-- its terrain: client/Weather in the game, docs/stormlab/SYNC-PLAN.md); the lab uses the defaults.
local LabConfig = {}

LabConfig.SCALE = 1 / 0.28 -- studs per metre (~3.57): Roblox's own convention, 1 stud = 0.28 m (a character
-- is ~5 studs; Roblox's "realistic" gravity of 35 studs/s^2 = 9.81 x SCALE). Set 2026-10-26, replacing 0.3.

-- The frame metres -> studs. Lab defaults: SCALE on every axis, origin at stud (0, 0), a flat
-- datum. The game: kh its map's studs per metre across, kv up, ks for sizes; ox, oz the stud
-- position of the frame's (0, 0); datum(x, y) the datum's stud height there (a smooth surface
-- that follows the land on the large scale: clouds sit over it); ground(x, y) the ground's
-- height above the datum (m) where the game knows its terrain.
local F = {
	kh = LabConfig.SCALE, kv = LabConfig.SCALE, ks = LabConfig.SCALE, ox = 0, oz = 0,
	datum = nil :: ((number, number) -> number)?, ground = nil :: ((number, number) -> number)?,
	sky = nil :: ((number, number) -> number)?, -- studs a metre for things about (cx, cy) (scaleAbout)
	precipVisibility = 1, -- how strongly rain and hail cut visibility (rainExtinction); 1 = physical
}
LabConfig.frame = F

function LabConfig.setFrame(t: { [string]: any })
	for k, v in t do
		F[k] = v
	end
	LabConfig.SCALE = F.ks
end

function LabConfig.toWorld(x: number, y: number, z: number): Vector3
	local d = F.datum
	return Vector3.new(F.ox + x * F.kh, (if d then d(x, y) else 0) + z * F.kv, F.oz - y * F.kh)
end

function LabConfig.toLocal(x: number, y: number, z: number): Vector3
	return Vector3.new(x * F.kh, z * F.kv, -y * F.kh)
end

function LabConfig.fromWorld(v: Vector3): (number, number, number)
	local x, y = (v.X - F.ox) / F.kh, (F.oz - v.Z) / F.kh
	local d = F.datum
	return x, y, (v.Y - (if d then d(x, y) else 0)) / F.kv
end

function LabConfig.studs(m: number): number
	return m * F.ks
end

-- A storm (or tornado, shaft, flash...) drawn as a whole at one scale about its centre (cx, cy):
-- the centre sits at its map position (toWorld), everything else about it - offsets across, heights,
-- sizes - at scaleAbout(cx, cy) studs a metre. The lab: SCALE everywhere (the same as toWorld).
-- The game: true scale near the camera, less far away (Config.skyScaleAt: client/WeatherClient),
-- so a near storm is true against the houses and a far one stands at a believable angle.
function LabConfig.scaleAbout(cx: number, cy: number): number
	local f = F.sky
	return if f then f(cx, cy) else F.ks
end

function LabConfig.toWorldAbout(x: number, y: number, z: number, cx: number, cy: number, s: number?): Vector3
	local k = s or LabConfig.scaleAbout(cx, cy)
	local d = F.datum
	return Vector3.new(F.ox + cx * F.kh + (x - cx) * k, (if d then d(cx, cy) else 0) + z * k, F.oz - cy * F.kh - (y - cy) * k)
end

-- an offset from an anchor at the centre, at the centre's scale s
function LabConfig.localAbout(x: number, y: number, z: number, s: number): Vector3
	return Vector3.new(x * s, z * s, -y * s)
end

function LabConfig.metres(s: number): number
	return s / F.ks
end

-- Seeing through precipitation. The extinction (1/km) of rain at R mm/h (0.33 R^0.66: ~12 km
-- visibility in 1 mm/h, ~1 km in 50 mm/h) times frame.precipVisibility (the game's
-- Config.PRECIP_VISIBILITY; 1 in the lab). Every renderer that fogs by rain uses this, so the
-- Atmosphere, the storm cards, the shafts, the scud and the funnel stay in step.
function LabConfig.rainExtinction(r: number): number
	if r <= 0.05 then
		return 0
	end
	return 0.33 * r ^ 0.66 * F.precipVisibility
end

-- The length of a sight line across the map as it is DRAWN (m at the size scale): a sim distance
-- d metres is kh / ks as long on screen (the game's map is squashed across: ~0.1; the lab: 1). The
-- rain between the camera and a far point is crossed over this length, the same length the
-- Atmosphere fogs the terrain over, so a funnel and the ground beside it fog alike.
function LabConfig.sightPath(d: number): number
	return d * F.kh / F.ks
end

-- a simulation horizontal vector (east, north) as a Roblox direction (Y = 0)
function LabConfig.dirWorld(u: number, v: number): Vector3
	return Vector3.new(u, 0, -v)
end

LabConfig.SCENARIOS = { "Supercell", "SquallLine" }
-- Where the weather comes from (server/Relay; docs/stormlab/FRAME-V2.md). The Workspace attributes
-- StormLabSource / StormLabRecording override mode / recording.
--   sim     the lab's own simulation (default)
--   replay  a recording made with the F4 "record" button (ServerStorage.StormLabRecordings.<name>)
--   feed    storm frames from an HTTP source (url), polled every `poll` s, played `lag` s behind
LabConfig.SOURCE = { mode = "sim", recording = "", url = "", poll = 5, lag = 15 }
LabConfig.DEFAULT_SCENARIO = "Supercell"
LabConfig.DEFAULT_TIME_SCALE = 1
-- the scenario storms: "engine" = driven by the engine's 5-minute updates, as in the game
-- (Sim/EngineFollow); "own" = the lab's own dynamics (F4 panel: Storms button)
LabConfig.DEFAULT_STORMS = "engine"
-- the lab's own storms ("own" mode): a boost on the tornado genesis drive, so every scenario makes
-- tornadoes to look at (Storm.GENESIS_EASE; 1 = the physics as it is)
LabConfig.GENESIS_EASE = 3
LabConfig.SPIN_UP_SECONDS = 600 -- simulated before anyone watches (fills rain and cold pools)

-- Network: remotes live in ReplicatedStorage.StormLabNet (made by the server)
LabConfig.NET_FOLDER = "StormLabNet"
LabConfig.REMOTES = {
	state = "State", -- RemoteEvent  server -> client  World.snapshot ~2 Hz
	profiles = "Profiles", -- RemoteEvent  storm vertical profiles, when they change
	tornado = "Tornado", -- UnreliableRemoteEvent  Tornado snapshots ~15 Hz
	coldPool = "ColdPool", -- RemoteEvent  packed cold pool buffer ~every 10 s
	precip = "Precip", -- RemoteEvent  the full packed precipitation volume (RATES.precipFullEvery)
	precipLite = "PrecipLite", -- RemoteEvent  the light rain frame (Precip.packLite) ~every 10 s
	flash = "Flash", -- RemoteEvent  lightning flashes (list)
	event = "Event", -- RemoteEvent  { kind = ... } (tornado, initiation, damage, debris...)
	command = "Command", -- RemoteEvent  client -> server { cmd = ..., ... }
	hello = "Hello", -- RemoteFunction  client asks: scenario name, time, settings
}
LabConfig.RATES = {
	tornadoHz = 15,
	stateHz = 2,
	coldPoolEvery = 10,
	precipEvery = 10, -- s between light rain frames (precipLite: surface rain, hail, column summary)
	precipFullEvery = 60, -- s between full volumes (the radar's 3-D detail); 0: never (light only)
	slowBudgetMs = 6, -- server time per frame for the slow simulation (coroutine, World.pause)
}

-- Roblox drawing limits measured in this project (memory notes, Studio quality 8):
--   particles are not drawn beyond ~800 studs from the camera (fade 700-850);
--   parts / meshes are not drawn beyond ~7000 studs;
--   textured Beams near the camera did not render in Studio 0.744 (use parts with Textures);
--   the EditableMesh memory budget is tiny (~6 small meshes per client): pool and reuse meshes,
--   never destroy and rebuild;
--   overlapping particle layers of different colours flicker (draw-order swaps): one flat colour
--   per overlapping layer, shading from things that don't reorder.
LabConfig.LIMITS = {
	particleRange = 750,
	partRange = 6500,
	-- far objects are drawn as a copy scaled toward the camera so they stay within partRange
	-- (same angular size and direction; true-distance haze applied by colour)
	farDraw = 4500,
}

-- The flat overhead deck (client/Render/BaseDeck): the rain-free base near the camera as flat
-- down-facing tiles with the seamless ceiling texture (an approved exception to billboards-only,
-- 2026-10-29). range: m from the camera (inside LIMITS.partRange); beyond it the billboard deck.
-- OFF (2026-10-29): Roblox sorts see-through GUIs per object, not per pixel, so a tile nearer
-- than a billboard is drawn over all of it - even the lowering, scud and funnel top under the deck -
-- and its outline shows as straight lines across them. Kept for a try with smaller tiles or a
-- different primitive.
-- ON again 2026-10-30 as solid discs (BaseDeck): opaque parts write depth, so nothing sorts.
-- thick/lump: m; gain: colour factor against the engine lighting the solid parts get;
-- material: Enum.Material for the discs.
LabConfig.DECK = { enabled = true, range = 5500, thick = 60, lump = 30, gain = 1.7, material = Enum.Material.Neon }

-- Already-uploaded assets (ATGuardian, ids from roblox/src/shared/Tornado/Config.luau and
-- roblox/src/shared/World/Config.luau). Flat* textures are white alpha-only (tint with Color).
LabConfig.TEXTURES = {
	ceiling = "rbxassetid://125850054637818", -- seamless cloud cover (tools/smoke/ceiling_tile.py), the flat deck
	softFlat = "rbxassetid://116883477687095", -- soft featureless puff
	featherFlat = "rbxassetid://95121739839387", -- dense round puff, feathery rim (tools/feather_puff.py; read as sandpaper)
	wispSheetFlat = "rbxassetid://132403693605015", -- 2x2 soft broad wisps (2026-10-30; the fine-fibre sheet 77462082475988 read as fur), streaks along x (tools/wisp_sheet.py; WallStream, TornadoCards strands)
	smoothPuffFlat = "rbxassetid://94176229700995", -- smooth dense puff, broad lobes, no grain (tools/smooth_puff.py; Render/WallStream)
	streakSoft = "rbxassetid://115060594741751", -- soft condensation streak: gaussian across, tapered (tools/streak_puff.py; tornado filaments)
	hazePuffFlat = "rbxassetid://72760570308893", -- soft haze puff: slow falloff, no disc or rim, one tone (tools/haze_puff.py; tornado smoke body)
	-- a horizontal slice of a column: crisp sides (0.86 of the frame wide), soft top and bottom
	-- (smoke_flipbook.py --variant firm --single --flat --slice): the funnel's crisp core
	sliceFlat = "rbxassetid://78396908460708",
	gasPuffSheet = "rbxassetid://95569256182807", -- 2x2 soft cloud puffs, broad billowy edges (tools/smoke/gas_puff.py; TornadoCards style "gas", 2026-10-30)
	-- four separate 1024 px detailed puffs (tools/smoke/gas_puff2.py, 2026-10-30): soft billows, a
	-- frayed fringe and gentle relief; the 2x2 sheet gave 512 px a puff (low-res close up)
	gasPuff2A = "rbxassetid://96068099493528",
	gasPuff2B = "rbxassetid://133325231519630",
	gasPuff2C = "rbxassetid://75810324244346",
	gasPuff2D = "rbxassetid://105561077458853",
	-- tornado dust: 2x2 broad smooth wisps of 512 (tools/smoke/dust_wisp2.py, 2026-10-30; the 4x4
	-- wispFlat's 256 px frames drew grainy patches near the ground)
	dustWisp2 = "rbxassetid://118297975010401",
	funnelRibbon = "rbxassetid://116798715876728", -- funnel outline ribbon: flat across, faded ends (tools/smoke/funnel_ribbon.py, 2026-10-31)
	capsuleFlat = "rbxassetid://122340939095171",
	deckEdge = "rbxassetid://115445826136912", -- soft round cloud, opaque to 0.3 of the frame (tools/smoke/deck_edge.py; BaseDeck's edge discs, 2026-10-30) -- tube piece with crisp sides and round ends (tools/smoke/capsule.py; TornadoCards opaque rope pieces, 2026-10-30)
	softSheetFlat = "rbxassetid://75569785912211", -- 4x4 flipbook of soft puffs
	wispFlat = "rbxassetid://77502166035387", -- 4x4 streaky wisps
	shredFlat = "rbxassetid://91728136123515", -- 4x4 torn stretched shreds (scud)
	lumpyFlat = "rbxassetid://127742324022128", -- 4x4 lumpy cauliflower puffs
	mediumFlat = "rbxassetid://111690557879064", -- defined but soft-rimmed disc
	wispyFlat = "rbxassetid://139989680557727", -- a puff with a fibrous fringe
	strandsFlat = "rbxassetid://120187806290235", -- a tall streaky smoke column
	nearRain = "rbxassetid://105774957466433", -- rain streak tile for near-camera curtains
	rainShaft = "rbxassetid://86246653635299", -- distant rain shaft: soft column, faint streaks
	basePuffs = "rbxassetid://101768089677789", -- 4x4 rendered volumetric puffs seen from below
	hailstone = "rbxassetid://75884893304957", -- solid hailstone sprite (main game tools/rain/splash_hail.py)
	-- a wide, short soft ellipse (0.88 x 0.29 of the frame): anvil and flat cloud cards
	-- (main game tools/smoke smoke_flipbook.py --variant wide --single --flat)
	wideFlat = "rbxassetid://101986960654906",
	-- tools/smoke/storm_sheets.py (4x4 sheets, white alpha; uploaded 2026-10-25). Empty: the
	-- renderers fall back to softSheetFlat (curtain) or draw no band (striation)
	curtainFlat = "rbxassetid://79610318303479", -- rain shaft: fine vertical fibres, soft sides and top, feathered foot
	striationFlat = "rbxassetid://114024701514552", -- mesocyclone band: a lens of long horizontal ribs
	-- (uploaded 2026-10-25; empty: the renderers fall back to softFlat / shredFlat)
	dirtGrainFlat = "rbxassetid://118568148658026", -- tornado dust as dirt: dense grains thinning to a speckled edge
	fractusFlat = "rbxassetid://73789623374463", -- scud: ragged pieces with torn, fibrous ends
	-- a seamless looping 4x4 smoke flipbook (main game tools/smoke/smoke_flipbook.py --variant body,
	-- uploaded 2026-10-22 for the particle tornado): the near-field VFX clouds (Render/NearVfx)
	smokeLoop = "rbxassetid://107651069089548",
}
-- Near-field VFX (Render/NearVfx): cards within particle reach (~800 studs) are re-drawn as
-- particle smoke volumes. Key B toggles it. Shelved 2026-10-29 (user: billboards and shaders instead): off.
LabConfig.NEAR_VFX = { enabled = false, maxSlots = 64, nearEnd = 720, nearFull = 520 }
-- Moving cloud pieces (scud, tail cloud, inflow filaments, rising billows) carried by the wind
-- field and condensing / evaporating with their lift (Render/CloudParts/Flow). false: the old
-- scripted loops.
LabConfig.CLOUD_FLOW = true
-- The funnel's body (Render/TornadoCards): "spiral" - sprites spiralling up round the axis, shaded
-- by facing the sun (docs/stormlab/BILLBOARD-TORNADO-PLAN.md); "rings" - the stacked rings and core
-- slices. Key T switches.
-- the wall cloud and tail: "stream" (Render/WallStream: puffs carried by the rotation and the
-- inflow) or "cards" (StormCards' rings); key Y switches
LabConfig.WALL_STYLE = "stream" -- volumetric five-slot inflow cross-sections
LabConfig.TORNADO_STYLE = "smoke" -- (T cycles smoke -> gas -> volume -> rings; smoke = fibrous sprites riding the flow, 2026-10-31; gas = soft cloud puffs, 2026-10-30)
-- (Off 2026-10-29: user ditched shaders for performance; billboards only.) Lobe light computed in Luau (Render/CloudParts/LobeShader) into EditableImages, one sheet per
-- sun tilt in bins (-1 front lit .. 1 back lit), replacing the three Blender bakes in LOBES once
-- built (~budgetMs a frame in the background). frame / nearFrame: px a lobe.
LabConfig.LOBE_SHADER = { enabled = false, bins = { -0.8, -0.4, 0, 0.4, 0.8 }, frame = 128, nearFrame = 256, budgetMs = 3 }
-- Soft lit lobe sheets for cumuliform storm cards (tools/blender/lobe_bake.py renders the Cycles
-- passes, tools/blender/lobe_post.py makes these; Render/StormCards, docs/stormlab/CONDENSATION-DETAIL.md).
-- Smooth billows with the light baked in from the frame's top at low contrast, one image per card:
-- front (the sun behind the viewer), side, back (the sun behind the cloud). tower / under / soft are
-- 4x4 sheets of 256 px; *_near are 2x2 sheets of 512 px (the first four lobes) for big near cards.
-- A family with any id empty is not used (cards keep lumpyFlat). (2026-10-25, second look: the
-- first, cauliflower bake was replaced; v3 adds firmer edges + rim wisps: lobe_post.py defaults;
-- texture ids, not the decal ids)
LabConfig.LOBES = {
	tower = { front = "rbxassetid://121941071753311", side = "rbxassetid://123698015739299", back = "rbxassetid://133464692085506" },
	tower_near = { front = "rbxassetid://118622919688191", side = "rbxassetid://117517128675674", back = "rbxassetid://76294320666128" },
	under = { front = "rbxassetid://82982592888881", side = "rbxassetid://112805512722810", back = "rbxassetid://108262916366484", amb = "rbxassetid://112155991454430" },
	under_near = { front = "rbxassetid://125993815200044", side = "rbxassetid://120087859182739", back = "rbxassetid://88140543973231", amb = "rbxassetid://79628402846435" },
	soft = { front = "rbxassetid://73475574790419", side = "rbxassetid://100505461413407", back = "rbxassetid://120730874862236" },
}
-- Dynamic scud (client/Render/Scud): fragments that condense in lifted, nearly saturated air under
-- the base and ride World.windAt. max: fragments in all; range: m from the camera; spawnTries:
-- candidate points a sim second per storm; depth0 / depthRain: m below the base a parcel can
-- condense (unsaturated inflow / saturated rain-cooled air); size: m, a new fragment
LabConfig.SCUD = { enabled = true, max = 140, range = 30000, spawnTries = 30, depth0 = 120, depthRain = 450, size = { 90, 320 } }
-- mirror half the lobe cards (negative ImageRectSize) for twice the shapes
LabConfig.LOBE_MIRROR = true
LabConfig.CLOUD_KIT_ASSET = 111990332715428
-- optional sounds (empty: silent). Thunder is timed by distance / 343 m/s either way.
LabConfig.SOUNDS = {
	thunderNear = "",
	thunderFar = "",
	rain = "",
	wind = "",
}

-- The lab's ground: tiles that follow the camera (plain flat farmland), and the test town.
LabConfig.GROUND = {
	tile = 512, -- m, a farmland tile (at most 2048 studs: a Part's largest size)
	radius = 4, -- tiles each way around the camera (at least enough to reach LIMITS.partRange)
	colour = { 104, 128, 72 },
	material = "Grass",
	-- the lab's uneven ground: rolling hills round the play area (the town site), so the renderers
	-- and physics are tested on ground that is not flat. Built as Terrain by the server
	-- (server/Terrain) out to `radius`; hills only (never below the datum), fading to flat by the
	-- edge, with a flat pad of `flat` m round the town. amp = 0: flat everywhere.
	relief = { amp = 35, wavelength = 3500, radius = 9000, flat = 900, voxel = 4 },
}

-- Where the relief is centred (the town site): set when the town is placed (server) or announced
-- (client, the "town" event). Nil: flat.
LabConfig.groundCentre = nil :: { x: number, y: number }?

-- The ground's height above the datum (m) at (x, y): the lab's hills, or 0.
function LabConfig.groundAt(x: number, y: number): number
	if F.ground then
		return F.ground(x, y)
	end
	local R = LabConfig.GROUND.relief
	local c = LabConfig.groundCentre
	if not c or not R or R.amp <= 0 then
		return 0
	end
	local dx, dy = x - c.x, y - c.y
	local r = math.sqrt(dx * dx + dy * dy)
	if r >= R.radius then
		return 0
	end
	local k = 2 * math.pi / R.wavelength
	-- a few smooth waves (0..1), hills only
	local h = 0.5 + 0.25 * math.sin(x * k) * math.cos(y * k * 0.8)
		+ 0.15 * math.sin((x * 0.6 + y) * k * 1.7 + 1.3)
		+ 0.1 * math.cos((x - y * 0.7) * k * 3.1)
	local t = math.clamp((r - R.flat) / math.max(1, R.flat), 0, 1) -- (up from the town's pad)
	local fade = math.clamp((R.radius - r) / (0.3 * R.radius), 0, 1) -- (down to flat by the edge)
	t = t * t * (3 - 2 * t)
	fade = fade * fade * (3 - 2 * fade)
	return R.amp * math.clamp(h, 0, 1) * t * fade
end

-- h metres above the ground at (x, y), as a stud position
function LabConfig.toWorldGround(x: number, y: number, h: number): Vector3
	return LabConfig.toWorld(x, y, h + LabConfig.groundAt(x, y))
end

-- What a tornado can raise from the ground: loose soil fraction by ground kind
LabConfig.SOIL = { farmland = 0.8, grass = 0.5, town = 0.6, wet = 0.2 }

return LabConfig
