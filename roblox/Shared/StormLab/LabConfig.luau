--!nonstrict
-- Storm lab configuration shared by the server and clients (roblox/Labs/StormLab).
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
-- its terrain: Modules/Weather in the game, docs/stormlab/SYNC-PLAN.md); the lab uses the defaults.
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
-- The game: true scale near the camera, less far away (Config.skyScaleAt: WeatherController),
-- so a near storm is true against the houses and a far one stands at a believable angle.
-- Storms drawn as meshes (client/Render/StormVolume) are scaled copies pulled toward the camera: a
-- point P is drawn at cam + (P - cam) * kv, which looks the same from the camera and fits a whole
-- storm inside one part (2048 studs at most, drawn only within ~7000 studs). Everything drawn
-- about a point of that storm (its wall cloud, scud, tornado, dust, rain shafts, flashes) is pulled
-- by the same kv through scaleAbout / toWorldAbout, so it keeps its depth order against the mesh.
-- LabConfig.pull: { { x, y (m), r2 (m^2: the storm's reach), k (kv) } }, set each frame by
-- StormVolume; empty on the server and with the mesh style off.
LabConfig.pull = {}
-- Far pull (the lab only, on clients): Roblox stops drawing billboards ~100000 studs (~28 km)
-- from the camera, so at true scale a storm farther than that lost its cloud while its rain
-- shafts and flashes (pulled in by their own renderers) still drew - rain and bolts out of a clear
-- sky, and a mature supercell gone from 34 km (SC check, 2026-11-01). Everything drawn about a
-- point beyond FAR_PULL studs is drawn as a copy pulled toward the camera (the same angular size
-- and direction), as the mesh bodies' pull does. The game sets F.sky (its own far scale) instead.
-- (Not onto one shell: until 2026-11-02 every point past FAR_PULL was drawn AT FAR_PULL, so a storm at
-- 20 km and one at 35 km behind it stood at the same distance and their billboards sorted against
-- each other - the far storm showed through the near one, user. The drawn distance now still grows
-- with the true one - FAR_PULL + FAR_SPAN (1 - e^-(d - FAR_PULL)/FAR_SPAN), continuous at FAR_PULL,
-- under FAR_PULL + FAR_SPAN - so storms keep their depth order: 20 vs 35 km are drawn ~2 km apart)
local FAR_PULL = 60000 -- studs (~17 km): where the pull starts
local FAR_SPAN = 15000 -- studs: the drawn distances past it, up to 75000 (room for a storm's reach)
local IS_CLIENT = game:GetService("RunService"):IsClient()
local camPos: Vector3? = nil
if IS_CLIENT then
	game:GetService("RunService"):BindToRenderStep("LabConfigFarPull", Enum.RenderPriority.Camera.Value + 1, function()
		local cam = workspace.CurrentCamera
		camPos = if cam then cam.CFrame.Position else nil
	end)
end
local function farPull(cx: number, cy: number): number
	if not camPos or F.sky then
		return 1
	end
	local dx, dz = F.ox + cx * F.kh - camPos.X, F.oz - cy * F.kh - camPos.Z
	local d2 = dx * dx + dz * dz
	if d2 <= FAR_PULL * FAR_PULL then
		return 1
	end
	local d = math.sqrt(d2)
	return (FAR_PULL + FAR_SPAN * (1 - math.exp(-(d - FAR_PULL) / FAR_SPAN))) / d
end

function LabConfig.pullAt(cx: number, cy: number): number
	local best, k = math.huge, nil
	for _, p in LabConfig.pull do
		local d2 = (cx - p.x) ^ 2 + (cy - p.y) ^ 2
		if d2 < p.r2 and d2 < best then
			best, k = d2, p.k
		end
	end
	return k or farPull(cx, cy)
end

function LabConfig.scaleAbout(cx: number, cy: number): number
	local f = F.sky
	local s = if f then f(cx, cy) else F.ks
	return s * LabConfig.pullAt(cx, cy)
end

function LabConfig.toWorldAbout(x: number, y: number, z: number, cx: number, cy: number, s: number?): Vector3
	local k = s or LabConfig.scaleAbout(cx, cy)
	local d = F.datum
	local G = Vector3.new(F.ox + cx * F.kh, if d then d(cx, cy) else 0, F.oz - cy * F.kh)
	local kv = LabConfig.pullAt(cx, cy)
	if kv < 1 then
		local cam = camPos or workspace.CurrentCamera.CFrame.Position
		G = cam + (G - cam) * kv
	end
	return G + Vector3.new((x - cx) * k, z * k, -(y - cy) * k)
end

-- The inverse of toWorldAbout: a world point (the camera, say) in the frame of a storm drawn about
-- (cx, cy) at scale s - metres as that storm's cards see it. In the game a storm is drawn ~10x the
-- map's scale about its anchor, so fromWorld's map metres put the camera ~10x too far from it and
-- too low: CardPlan foreshortened its base cards as if seen edge-on - flat saucers along the
-- horizon, regrade 2026-11-07
function LabConfig.fromWorldAbout(v: Vector3, cx: number, cy: number, s: number?): (number, number, number)
	local k = math.max(s or LabConfig.scaleAbout(cx, cy), 1e-6)
	local d = F.datum
	local G = Vector3.new(F.ox + cx * F.kh, if d then d(cx, cy) else 0, F.oz - cy * F.kh)
	local kv = LabConfig.pullAt(cx, cy)
	if kv < 1 then
		local cam = camPos or workspace.CurrentCamera.CFrame.Position
		G = cam + (G - cam) * kv
	end
	local r = v - G
	return cx + r.X / k, cy - r.Z / k, r.Y / k
end

-- Across about a centre, for the parts drawn beside a storm body that the game draws across at its
-- map's scale (F.kh; EngineStormsController): the scale k out to trueR metres from the centre (round a
-- funnel), easing to the map's over one more trueR, so a wall cloud or scud sits under the base it
-- hangs from (as Shared.CloudModel.WallCloudView). Returns the drawn distance (studs) and the scale
-- across there (studs a metre). In the lab (kh = ks) it is r * k.
-- (only while the game draws the storm body at its map's scale - F.radialMap, set by the game when
-- the engine draws the body: WeatherController. With the lab's own body every part of a storm
-- is at k about its anchor, LabConfig.stormAnchor, as in the lab)
function LabConfig.radial(r: number, trueR: number, k: number, cx: number, cy: number): (number, number)
	local H = math.min(k, F.kh * LabConfig.pullAt(cx, cy))
	if not F.radialMap or r <= trueR or H >= k then
		return r * k, k
	end
	local R = math.max(1, trueR)
	local function ease(x: number): number
		local w = math.clamp((x - trueR) / R, 0, 1)
		return k + (H - k) * w * w * (3 - 2 * w)
	end
	-- (the scale integrated from trueR out to r: two steps, enough for a smooth map)
	return trueR * k + (r - trueR) * ease(0.5 * (trueR + r)), ease(r)
end

-- The point a storm is drawn about (2026-11-07). The game's map is at its own scale across (F.kh,
-- ~0.37 studs/m) while a storm is drawn at Config.skyScaleAt (3.57 near): a storm's parts drawn
-- about different centres - the body about the storm's centre, the tornado about its own foot, the
-- wall cloud about the circulation - came apart by their distance x (k - kh): a tornado 2.7 km from
-- its storm's centre stood ~8,600 studs from the cloud it hangs from, and its funnel ran off at a
-- slant to a lowering that wasn't over it (user). So every part of a storm is drawn about one
-- point, the game's anchorFn(id): its tornado's foot, else its low-level circulation - the place on
-- the map that matters to a player - and the rest of the storm about it at one scale, as the lab
-- draws it. In the lab (no anchorFn; kh = ks) it is the centre the caller gives.
LabConfig.anchorFn = nil :: ((id: string) -> (number?, number?))?
function LabConfig.stormAnchor(id: any, x: number, y: number): (number, number)
	local f = LabConfig.anchorFn
	if f and id ~= nil then
		local ax, ay = f(tostring(id))
		if ax then
			return ax, ay :: number
		end
	end
	return x, y
end

-- toWorldAbout with the across distances from (cx, cy) through LabConfig.radial; also returns the
-- scale across at the point (for the drawn width of what is there)
function LabConfig.toWorldRadial(x: number, y: number, z: number, cx: number, cy: number, k: number, trueR: number): (Vector3, number)
	local dx, dy = x - cx, y - cy
	local r = math.sqrt(dx * dx + dy * dy)
	local rs, kA = LabConfig.radial(r, trueR, k, cx, cy)
	local f = if r > 1e-6 then rs / r else k
	local P = LabConfig.toWorldAbout(cx, cy, z, cx, cy, k)
	-- (third: the scale round the ring, rs / r - how far apart neighbours along it are drawn. A card
	-- sized across by kA alone, the radial squeeze, drew ~10x narrower than tall past trueR in the
	-- game: tall dark leaves round the wall cloud, regrade 2026-11-07)
	return P + Vector3.new(dx * f, 0, -dy * f), kA, f
end

-- The ground under (x, y), in metres at scale k about the centre (cx, cy): what to add to a height
-- above the ground so toWorldAbout puts it on the true ground. Heights above the ground scale with
-- the thing drawn (a far storm in the game is drawn small: Config.skyScaleAt), but the ground does
-- not - the terrain is at full scale. Scaling the ground with the storm sank a far tornado's foot
-- and dust into hills and floated them over valleys (2026-11-02). In the lab k = the true scale x
-- the pull, so this is groundAt.
function LabConfig.groundIn(x: number, y: number, cx: number, cy: number, k: number): number
	return LabConfig.groundAt(x, y) * LabConfig.groundScale(cx, cy, k)
end

-- the factor groundIn applies (1 in the lab): for a renderer converting many ground heights at once
function LabConfig.groundScale(cx: number, cy: number, k: number): number
	return F.kv * LabConfig.pullAt(cx, cy) / math.max(k, 1e-6)
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
-- tornadoes to look at (Storm.GENESIS_EASE; 1 = the physics as it is). 1 since 2026-11-03: with the
-- meso re-forming at the updraft after a cycle and the cloud-base factor counted once, the Supercell
-- day makes 5-6 tornadoes in 2 h and the SquallLine day 27 unboosted (3 gave 43)
LabConfig.GENESIS_EASE = 1
LabConfig.SPIN_UP_SECONDS = 600 -- simulated before anyone watches (fills rain and cold pools)

-- Network: the storm frames travel as Network events declared in Shared/Net/StormNet.luau (the
-- game and the lab use the same ones): State, Profiles, Tornado (unreliable), ColdPool, Precip,
-- PrecipLite, Flash, Event, Command (client -> server) and the Hello / Ground requests.
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
-- solid: opaque discs inside the soft edge band (off 2026-10-31: they drew as hard dark ovals);
-- thick/lump: m; gain: colour factor against the engine lighting the solid parts get;
-- material: Enum.Material for the discs.
-- Storm bodies as meshes (client/Render/StormVolume, 2026-10-31): the tower (with its top and
-- overshooting top), the anvil and the rain-free base of the most prominent storms as one opaque,
-- self-lit EditableMesh each, shaped from the same fields as the cards (CloudParts/StormShape);
-- their wall cloud, inflow band, scud, rain and tornado stay billboards. Key F: mesh / cards.
--   maxStorms   storms drawn as meshes (EditableMesh memory is tight on clients: ~3-6 meshes)
--   tower, anvil, base   grid rows x columns of each body (all three share one mesh, 20000 triangles max)
--   rebuildEvery   s between reshapes of a storm; buildMs: script time a frame for reshapes and shading
LabConfig.STORM_MESH = {
	enabled = true,
	-- the body at start: "cards" since 2026-10-31 (Round 17: the mesh read as dark rock and a black
	-- slab anvil in every reference shot; key F still cycles mesh / meshOnly / cards)
	defaultStyle = "cards",
	maxStorms = 3,
	tower = { 64, 56 },
	anvil = { 48, 36 },
	base = { 26, 72 },
	rebuildEvery = 3,
	buildMs = 2.5,
	lobe = 0.12, -- tower lobes: radius share
	normalSmooth = 1, -- normal smoothing passes (3 flattened the lobes' shading into a plain cone)
	lobeSize = 0.55, -- lobe wavelength as a share of the tower's radius
	detailEdgeOnly = true, -- detail cards mainly where the mesh meets the sky (its silhouette); faint over its face
	detailAlpha = 0.7, -- their opacity over a mesh (cards alone: 0.92-0.95)
	detailCards = true, -- the tower's lobe, billow and dome cards kept over the mesh as detail
	exposure = 0.6, -- mesh colour scale (Neon draws brighter than an unlit card of the same colour)
}
-- Render/Sky: also drive the Terrain Clouds layer from the storms' sky cover. Off: one even sheet
-- over the whole sky, it greyed the sunny side too and drew a stepped horizon edge (2026-11-01)
LabConfig.SKY_CLOUD_DECK = false
LabConfig.DECK = { enabled = true, range = 5500, thick = 60, lump = 30, gain = 1.7, material = Enum.Material.Neon, solid = false }

-- Already-uploaded assets (ATGuardian, ids from roblox/Labs/TornadoLab/Tornado/Config.luau and
-- roblox/Shared/World/Config.luau). Flat* textures are white alpha-only (tint with Color).
LabConfig.TEXTURES = {
	ceiling = "rbxassetid://125850054637818", -- seamless cloud cover (tools/smoke/ceiling_tile.py), the flat deck
	softFlat = "rbxassetid://116883477687095", -- soft featureless puff
	featherFlat = "rbxassetid://95121739839387", -- dense round puff, feathery rim (tools/feather_puff.py; read as sandpaper)
	wispSheetFlat = "rbxassetid://132403693605015", -- 2x2 soft broad wisps (2026-10-30; the fine-fibre sheet 77462082475988 read as fur), streaks along x (tools/wisp_sheet.py; WallStream, TornadoCards strands)
	smoothPuffFlat = "rbxassetid://94176229700995", -- smooth dense puff, broad lobes, no grain (tools/smooth_puff.py; Render/WallStream)
	wallTierFlat = "rbxassetid://112138404673588", -- a wall-cloud tier side-on: soft top, crisp flat bottom edge at 0.70 of the frame (tools/smoke/wall_tier.py; Render/WallStream, 2026-11-01)
	streakSoft = "rbxassetid://115060594741751", -- soft condensation streak: gaussian across, tapered (tools/streak_puff.py; tornado filaments)
	-- the smooth puff with its edge ramp 1/2 and 1/4 as wide (tools/smooth_puff_sharp.py, 2026-11-03):
	-- a wide funnel's body, so its edge stays ~25-35 m thick in metres as the cone's is
	smoothPuffSharp2 = "rbxassetid://138534512646957",
	smoothPuffSharp4 = "rbxassetid://95258316119524",
	-- (the firm-sided haze puff, 2026-11-09: firm across, soft along, no end - tools/haze_firm.py. The
	-- haze puff, "rbxassetid://72760570308893", tools/haze_puff.py, fell off slowly every way: stacked,
	-- a funnel with no outline - "very blurry even in close range", user)
	hazePuffFlat = "rbxassetid://94850258356163", -- tornado smoke body
	-- (the skin keeps the soft haze puff: its cards lie across a wide funnel's face, and the firm
	-- one's sides drew each as a vertical band down the wedge, 2026-11-09)
	hazeSoftFlat = "rbxassetid://72760570308893",
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
	deckSoft = "rbxassetid://138862961385378", -- round soft disc, opaque to 0.20 of the frame, clear by 0.48 (tools/smoke/deck_soft.py; BaseDeck when every disc is soft, 2026-10-31)
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
	-- (v2 2026-11-10: each frame's top and bottom rows faded to zero - the noise had left 0.19 / 0.32
	-- there, and a slanted shaft ended in a straight hard line across the base; v1 79610318303479)
	curtainFlat = "rbxassetid://92396738829507", -- rain shaft: fine vertical fibres, soft sides and top, feathered foot
	striationFlat = "rbxassetid://114024701514552", -- mesocyclone band: a lens of long horizontal ribs
	-- (uploaded 2026-10-25; empty: the renderers fall back to softFlat / shredFlat)
	dirtGrainFlat = "rbxassetid://118568148658026", -- tornado dust as dirt: dense grains thinning to a speckled edge
	fractusFlat = "rbxassetid://73789623374463", -- scud: ragged pieces with torn, fibrous ends
	-- a seamless looping 4x4 smoke flipbook (main game tools/smoke/smoke_flipbook.py --variant body,
	-- uploaded 2026-10-22 for the particle tornado): the near-field VFX clouds (Render/NearVfx)
	smokeLoop = "rbxassetid://107651069089548",
}
-- Wide puffs for flattened cards (tools/smoke/wide_puff.py, 2026-11-10). A billboard is an upright
-- rectangle; a card flattened as the camera sees a level sheet side-on (CardPlan seenHeight,
-- WallStream's bands) drew its square puff squashed up to 1:6 - smeared billows, "stretched from
-- certain angles", user 2026-11-10. A puff card wider than ~1.4:1 takes the texture made at the
-- nearest width:height (2, 4 or 8), so it is stretched by at most ~1.4x and its billows stay
-- round. detail: the gas-puff look (two each); haze: the same shape, no texture (small on screen).
-- enabled=false: the old squashed textures (to compare).
-- Rain and hail shafts as Beams, not billboards (2026-11-10, user: "a different solution for rain
-- and hail besides billboards"; docs/visuals-research/TORNADO-GAMES-RESEARCH.md section 7). Each
-- shaft (CloudParts/Shafts' bins of the rain field) is perShaft camera-facing ribbons through its
-- depth plus hailPerShaft for its hail, hung from the cloud base to the ground along the wind's drift,
-- their textures scrolling down at the fall speed (tools/smoke/rain_beam.py). enabled = false: the
-- billboard curtains. In Studio, Scroll Lock switches between the two on the client.
-- NEAR ONLY (2026-11-10). Beams are parts, drawn only within LIMITS.partRange (~6500 studs, under
-- 2 km of map at the game's scale). Pulled in from the storm's 13k+ studs, a shaft sorted in front of
-- every storm card beyond it (the rain behind the tornado drew a grey wall over it). Now a shaft takes
-- Beams only where its true place is in range, blending from its card over the outer quarter
-- (CloudParts/Shafts: bS); far shafts stay cards.
LabConfig.RAIN_BEAMS = {
	enabled = true,
	rain = "rbxassetid://106068821128086", -- (70385017359407: uploaded with no Studio selected, never loads)
	hail = "rbxassetid://96811168010482", -- (121552743909792: the same)
	perShaft = 6,
	hailPerShaft = 2,
}

LabConfig.WIDE_PUFFS = {
	enabled = true,
	-- (v2 2026-11-10: lit from the top with shaded undersides, broader relief - v1, the square
	-- puff's flat relief, drew the base as a flat haze: 2x 92609642181775 110194059910493, 4x
	-- 106021577822620 119485533826314, 8x 88187456794162 84795806300945)
	detail = {
		[2] = { "rbxassetid://105417825281363", "rbxassetid://98784999054732" },
		[4] = { "rbxassetid://92927739584921", "rbxassetid://115709628836370" },
		[8] = { "rbxassetid://92170928133029", "rbxassetid://109124262747635" },
	},
	-- (v2 2026-11-10: a fuller middle; the first, a gaussian - 2x 85091618545178, 4x 88617459363087,
	-- 8x 121121587707153 - drew a storm's flank as a featureless fade)
	-- the tornado funnel's smooth puff, flattened on a wedge's cards (TornadoCards smoke body), at
	-- each edge sharpness s1 / s2 / s4 (smoothPuffFlat, smoothPuffSharp2, smoothPuffSharp4):
	-- tools/smoke/wide_funnel_puff.py, mean alpha matched to the square ones
	funnel = {
		[2] = { "rbxassetid://100720958909946", "rbxassetid://129049397093455", "rbxassetid://72126502164804" },
		[4] = { "rbxassetid://98415367640961", "rbxassetid://127293120408605", "rbxassetid://94460056838339" },
		[8] = { "rbxassetid://75470066716483", "rbxassetid://124147068477518", "rbxassetid://97819017246244" },
	},
	haze = { [2] = "rbxassetid://127203466484652", [4] = "rbxassetid://80072171540423", [8] = "rbxassetid://120322983115951" },
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
LabConfig.WALL_TIER = false -- (Render/WallStream: the side-on tier texture - off, it drew a sawtooth rim, 2026-11-07)
LabConfig.WALL_STYLE = "stream" -- volumetric five-slot inflow cross-sections
LabConfig.TORNADO_STYLE = "smoke" -- (T cycles smoke -> gas -> volume -> rings; smoke = fibrous sprites riding the flow, 2026-10-31; gas = soft cloud puffs, 2026-10-30)
LabConfig.SMOKE_SURFACE = false -- (off until it reads well on a wedge: bubbles or too faint so far) (the smoke body's cards on the funnel's surface, one rule from rope to wedge; Ctrl+T: by radius, the old layout. 2026-11-03)
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
-- texture ids, not the decal ids. v4 2026-10-31: no rim wisps, raw passes denoised - lobe_post.py
-- --wisps 0 --denoise 3 - the speckled rim drew a grainy outline on cards big on screen)
-- v5 2026-11-09, now the *_firm sets (tools/blender/lobe_firm.py --contrast 1.8 --lo 0.12 --hi 0.6 on the v4 sheets): firmer
-- rims, ~1.8 x the shading inside each lobe - the storm read blurry at any range, user. v4 ids:
--   tower front 84014312486340 side 95586533131436 back 81705183469665
--   tower_near front 130507213899235 side 75604749825126 back 72524462222991
--   under front 121651235590542 side 93248647927015 back 80472779592124 amb 127369441479854
--   under_near front 78423612799463 side 71189308176184 back 122617935129173 amb 105165090577329
LabConfig.LOBES = {
	tower = { front = "rbxassetid://118195514095855", side = "rbxassetid://117760657263687", back = "rbxassetid://134967996624773" },
	tower_near = { front = "rbxassetid://130507213899235", side = "rbxassetid://75604749825126", back = "rbxassetid://72524462222991" },
	-- (the underside keeps v4: v5's firmer shading is the sun's on a lump, and a base is lit from the
	-- sky and ground - as v5 the hanging lumps and the lowering drew as round grey bubbles from far,
	-- grade 2026-11-09. v5 under: front 116850296978424 side 74941228897478 back 91883228394286
	-- amb 113449256956605)
	under = { front = "rbxassetid://121651235590542", side = "rbxassetid://93248647927015", back = "rbxassetid://80472779592124", amb = "rbxassetid://127369441479854" },
	under_near = { front = "rbxassetid://78423612799463", side = "rbxassetid://71189308176184", back = "rbxassetid://122617935129173", amb = "rbxassetid://105165090577329" },
	-- (v5's firm near sheets only on cards within a few km - StormCards.LOBE_FIRM_M: on every card big
	-- on screen the tower read as cauliflower and the base as fish-scale lenses from 4-8 km,
	-- supercell grade 2026-11-09; v4 near sheets above)
	tower_firm = { front = "rbxassetid://73282268460785", side = "rbxassetid://91274583250452", back = "rbxassetid://129399246130311" },
	-- (no under_firm: v5's firm rims and shading are a sunlit lump's; a base's underside is lit by the
	-- sky and the ground only, and the firm sheet drew it overhead as dark hard-rimmed ovals - close
	-- grade 2026-11-09. Its ids: front 72045382951777 side 124358417542767 back 130914096157647
	-- amb 120648780133046)
	soft = { front = "rbxassetid://128994249792191", side = "rbxassetid://131961352586350", back = "rbxassetid://95460841583476" },
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
	-- edge, with a flat pad of `flat` m round the town. amp = 0: flat everywhere. cx, cy (optional):
	-- the hills' own centre, the town's pad elsewhere (the scene hills toggle: hills on a tornado's
	-- track, the town beside it).
	relief = { amp = 35, wavelength = 3500, radius = 9000, flat = 900, voxel = 4 } :: any,
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
	local c = LabConfig.groundCentre -- (the town: the flat pad)
	if not R or R.amp <= 0 or not (c or R.cx) then
		return 0
	end
	local hx, hy = R.cx or c.x, R.cy or c.y -- (the hills' centre)
	local dx, dy = x - hx, y - hy
	local r = math.sqrt(dx * dx + dy * dy)
	if r >= R.radius then
		return 0
	end
	local rp = r -- (from the pad's centre)
	if R.cx then
		rp = if c then math.sqrt((x - c.x) ^ 2 + (y - c.y) ^ 2) else math.huge
	end
	local k = 2 * math.pi / R.wavelength
	-- a few smooth waves (0..1), hills only
	local h = 0.5 + 0.25 * math.sin(x * k) * math.cos(y * k * 0.8)
		+ 0.15 * math.sin((x * 0.6 + y) * k * 1.7 + 1.3)
		+ 0.1 * math.cos((x - y * 0.7) * k * 3.1)
	local t = math.clamp((rp - R.flat) / math.max(1, R.flat), 0, 1) -- (up from the town's pad)
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
