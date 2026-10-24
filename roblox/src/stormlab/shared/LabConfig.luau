--!nonstrict
-- Storm lab configuration shared by the server and clients (roblox/src/stormlab).
-- Units: 1 stud = 1 m. The simulation's frame is x east, y north, z up (metres from the scenario
-- window's centre); Roblox's is X east, Y up, Z south. Always convert with toWorld / fromWorld.
local LabConfig = {}

function LabConfig.toWorld(x: number, y: number, z: number): Vector3
	return Vector3.new(x, z, -y)
end

function LabConfig.fromWorld(v: Vector3): (number, number, number)
	return v.X, -v.Z, v.Y
end

-- a simulation horizontal vector (east, north) as a Roblox direction (Y = 0)
function LabConfig.dirWorld(u: number, v: number): Vector3
	return Vector3.new(u, 0, -v)
end

LabConfig.SCENARIOS = { "Supercell", "SquallLine" }
LabConfig.DEFAULT_SCENARIO = "Supercell"
LabConfig.DEFAULT_TIME_SCALE = 1
LabConfig.SPIN_UP_SECONDS = 600 -- simulated before anyone watches (fills rain and cold pools)

-- Network: remotes live in ReplicatedStorage.StormLabNet (made by the server)
LabConfig.NET_FOLDER = "StormLabNet"
LabConfig.REMOTES = {
	state = "State", -- RemoteEvent  server -> client  World.snapshot ~2 Hz
	profiles = "Profiles", -- RemoteEvent  storm vertical profiles, when they change
	tornado = "Tornado", -- UnreliableRemoteEvent  Tornado snapshots ~15 Hz
	coldPool = "ColdPool", -- RemoteEvent  packed cold pool buffer ~every 10 s
	precip = "Precip", -- RemoteEvent  packed precipitation volume ~every 10 s
	flash = "Flash", -- RemoteEvent  lightning flashes (list)
	event = "Event", -- RemoteEvent  { kind = ... } (tornado, initiation, damage, debris...)
	command = "Command", -- RemoteEvent  client -> server { cmd = ..., ... }
	hello = "Hello", -- RemoteFunction  client asks: scenario name, time, settings
}
LabConfig.RATES = {
	tornadoHz = 15,
	stateHz = 2,
	coldPoolEvery = 10,
	precipEvery = 10,
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

-- Already-uploaded assets (ATGuardian, ids from roblox/src/shared/Tornado/Config.luau and
-- roblox/src/shared/World/Config.luau). Flat* textures are white alpha-only (tint with Color).
LabConfig.TEXTURES = {
	softFlat = "rbxassetid://116883477687095", -- soft featureless puff
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
	-- the main game's funnel art (tools/blender/funnel_texture.py; Config.TORNADO_ART): tileable
	-- streak noise made for a funnel surface
	funnelCore = "rbxassetid://103842331190084",
	funnelWisp = "rbxassetid://118029183384379",
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
}
-- the cloud kit: one Model asset of mesh pieces (ReplicatedStorage.Shared.Weather.CloudKit;
-- the server calls CloudKit.serverLoad(LabConfig.CLOUD_KIT_ASSET))
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
	tile = 2048,
	radius = 3, -- tiles each way around the camera
	colour = { 104, 128, 72 },
	material = "Grass",
}

-- What a tornado can raise from the ground: loose soil fraction by ground kind
LabConfig.SOIL = { farmland = 0.8, grass = 0.5, town = 0.6, wet = 0.2 }

return LabConfig
