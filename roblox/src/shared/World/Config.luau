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

-- Vertical: separate from horizontal so hills do not become cliffs; tune in the map preview.
Config.STUDS_PER_METRE_VERTICAL = 0.8

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
