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
-- Rain and hail drawn: the shafts, the hail core and the rain wrapping round the rotation, and the
-- haze of being in them (client/StormView, client/SkyLight). Off for now (2026-10-22): as smooth
-- shapes they read as walls hiding the tornado; back on once they are textured curtains. The rain
-- falling at the camera is drawn either way.
Config.SHOW_PRECIPITATION = false
-- The storm's smaller cloud features: scud turning under the wall cloud, the tail cloud, inflow
-- bands and the shelf cloud (client/StormView). Off for now (2026-10-22): as smooth shapes, the
-- inflow bands and shelf (kilometres long, low) stood in front of the tornado. The towers, base,
-- anvil and wall cloud are drawn either way.
Config.SHOW_CLOUD_DETAIL = false
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
