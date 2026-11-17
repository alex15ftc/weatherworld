--!strict
-- The cities a player may choose as home (ExploreService, SpawnNet): the map's metro, city and
-- small cities, largest first. Each city's spawn point is on the road nearest where the start
-- point has always been for the mid-size city: a mile past the city's east edge, on the line
-- through its centre (out of the buildings, with the city in view).

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerStorage = game:GetService("ServerStorage")

local Config = require(ReplicatedStorage.Shared.World.Config)
local WorldMap = require(ServerStorage.World.WorldMap)
local RoadNet = require(ServerStorage.World.Props.RoadNet)

local HomeCity = {}

local KINDS = { metro = true, city = true, smallCity = true }

export type City = { name: string, kind: string, population: number, x: number, y: number, extentMi: number }

local list: { City } = {}
local byName: { [string]: City } = {}
for _, s in WorldMap.meta.settlements do
	if KINDS[s.kind] and type(s.name) == "string" and byName[s.name] == nil then
		local city: City = {
			name = s.name,
			kind = s.kind,
			population = s.population or 0,
			x = s.x,
			y = s.y,
			extentMi = s.extentMi or 0,
		}
		table.insert(list, city)
		byName[s.name] = city
	end
end
table.sort(list, function(a, b)
	return a.population > b.population
end)

-- What the picker shows.
function HomeCity.list(): { { name: string, kind: string, population: number } }
	local out = {}
	for _, c in list do
		table.insert(out, { name = c.name, kind = c.kind, population = c.population })
	end
	return out
end

function HomeCity.has(name: string): boolean
	return byName[name] ~= nil
end

-- Spawning on a road: the nearest stretch of an ordinary road (not a freeway or its ramps, where
-- a player on foot has no business) with room for a car, CLEAR design studs at least from either
-- end of its graph edge so it is not in a junction. The spot is the middle of the right-hand
-- (outer) lane, facing along the road; the graph and its cross-sections are in the generator's
-- studs (WorldMap.roadEdges, RoadNet.KINDS), the place in Config.WORLD_SCALE of them.
local NOT_ON_FOOT = { interstate = true, expressway = true, ramp = true }
local CLEAR = 90 -- (the car, set down ahead of the player, stays short of the junction too)
local SEARCH = { 300, 900, 2400 } -- half-widths of the boxes searched, in turn (design studs)

-- (yaw for CFrame.Angles(0, yaw, 0) facing along (dx, dz))
local function yawAlong(dx: number, dz: number): number
	return math.atan2(-dx, -dz)
end

-- A spot on a road near (x, z) place studs: place studs and the yaw along the road, or nil when
-- no road is near.
function HomeCity.roadSpotNear(x: number, z: number): (number?, number?, number?)
	local s = Config.WORLD_SCALE
	local tx, tz = x / s, z / s
	for _, r in SEARCH do
		local best, bestD = nil, math.huge
		for _, e in WorldMap.roadEdges(tx - r, tz - r, tx + r, tz + r) do
			local spec = RoadNet.KINDS[e.kind]
			if NOT_ON_FOOT[e.kind] or not spec then
				continue
			end
			local ex, ez = e.bx - e.ax, e.bz - e.az
			local len = math.sqrt(ex * ex + ez * ez)
			if len < 2 * CLEAR then
				continue
			end
			local dx, dz = ex / len, ez / len
			local t = math.clamp((tx - e.ax) * dx + (tz - e.az) * dz, CLEAR, len - CLEAR)
			local px, pz = e.ax + dx * t, e.az + dz * t
			local d = (px - tx) ^ 2 + (pz - tz) ^ 2
			if d < bestD then
				-- the right-hand lane's middle: right of the way along is (-dz, dx)
				local off = spec.median + spec.innerShoulder + spec.lane * (spec.lanesEach - 0.5)
				best, bestD = { px - dz * off, pz + dx * off, yawAlong(dx, dz) }, d
			end
		end
		if best then
			return best[1] * s, best[2] * s, best[3]
		end
	end
	return nil, nil, nil
end

local spots: { [string]: { number } } = {}

-- The city's spawn point in place studs (x, z) and the way to face, or nil for a name that is not
-- a home city: on a road near the point a mile past the city's east edge.
function HomeCity.spawnStuds(name: string): (number?, number?, number?)
	local c = byName[name]
	if not c then
		return nil, nil, nil
	end
	local spot = spots[name]
	if not spot then
		-- (kept off the map's edge, as the debug teleport is)
		local edge = Config.MAP_STUDS / 2 - 600 * Config.WORLD_SCALE
		local x, z = WorldMap.worldStudsAt(c.x + c.extentMi + 1, c.y)
		x, z = math.clamp(x, -edge, edge), math.clamp(z, -edge, edge)
		local rx, rz, yaw = HomeCity.roadSpotNear(x, z)
		spot = if rx and rz and yaw then { rx, rz, yaw } else { x, z, math.pi / 2 }
		spots[name] = spot
	end
	return spot[1], spot[2], spot[3]
end

return HomeCity
