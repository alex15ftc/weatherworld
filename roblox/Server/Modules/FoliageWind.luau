--!nonstrict
-- The 3-s gust at 10 m over a point of the map, for the trees' breaking (FoliageService). The
-- same weather on every server, from what StormHostService and LiveStormsService hold:
--   lab world (StormHost runs the sim: the lab, or engine mode without frame-fed cards):
--           World.windAt at 10 m - the environment, cold pools, storms and their tornadoes;
--   frame-fed (engine, no lab world): the window's environment (Sim/Environment from the
--           window's data) and, inside each engine storm's box, its full frame's ground wind
--           (the cloud model's, FrameCodec.box / nestColumn), and its tornado (the frame's
--           tornado block: where, how strong, its core radius) as a modified Rankine vortex
--           V = Vmax r/R inside the core, Vmax (R/r)^0.6 beyond (Wood & White 2011's tail).
-- The mean winds become 3-s gusts by the gust factor GUST (open country, convective boundary
-- layer: about 1.45, ASCE 7 / Durst); a tornado's speed is a 3-s gust already (the EF scale's).
-- Returns the gust (m/s) and its direction (unit, world X east and Z south), or 0 with no data.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerStorage = game:GetService("ServerStorage")

local Shared = ReplicatedStorage.Shared
local Config = require(Shared.World.Config)
local WorldMap = require(ServerStorage.World.WorldMap)
local Environment = require(Shared.StormLab.Sim.Environment)
local Json = require(Shared.StormLab.Sim.Json)
local FrameCodec = require(Shared.CloudModel.FrameCodec)

local FoliageWind = {}

FoliageWind.GUST = 1.45
local Z = 10 -- m

local host, live = nil, nil
local env, envFrom = nil, nil

function FoliageWind.bind(stormHost: any, liveStorms: any)
	host, live = stormHost, liveStorms
end

-- the point in lab metres (x east, y north of the window's centre) and map km (y south)
local function toLab(xStuds: number, zStuds: number): (number?, number?, number, number)
	local mx, my = WorldMap.milesAt(xStuds, zStuds)
	local kx, ky = mx * Config.KM_PER_MILE, my * Config.KM_PER_MILE
	local c = host and host.state.centreKm
	if not c then
		return nil, nil, kx, ky
	end
	return (kx - c.x) * 1000, (c.y - ky) * 1000, kx, ky
end

local function environment(): any
	local st = host and host.state
	local json = st and st.dataJson
	if not json then
		return nil
	end
	if json ~= envFrom then
		envFrom = json
		local ok, e = pcall(function()
			return Environment.new(Json.decode(json))
		end)
		env = if ok then e else nil
	end
	return env
end

-- a storm's frame wind at a map point (km, y south), or nil outside its box: ground wind (m/s,
-- east, north) and the tornado's (gust, east, north)
local function frameWind(s: any, kx: number, ky: number): (number?, number?, number, number)
	local f = s.frame
	local bx = f.anchorX + (kx - s.xKm) * 1000
	local by = f.anchorY + (s.yKm - ky) * 1000
	local u, v = nil, nil
	local n = f.nest
	if n then
		local i, j = math.floor((bx - n.X0) / n.dx) + 1, math.floor((by - n.Y0) / n.dx) + 1
		if i >= 1 and j >= 1 and i <= n.nx and j <= n.ny then
			local _, nu, nv = FrameCodec.nestColumn(f, i, j)
			u, v = nu, nv
		end
	end
	if not u then
		local i, j = math.floor(bx / f.dx) + 1, math.floor(by / f.dx) + 1
		if i >= 1 and j >= 1 and i <= f.nx and j <= f.ny then
			local _, _, _, _, _, _, _, bu, bv = FrameCodec.box(f, i, j)
			u, v = bu, bv
		end
	end
	local tu, tv = 0, 0
	local t = f.tornado
	if t and t.mph > 0 and t.R > 0 then
		local dx, dy = bx - t.x, by - t.y
		local r = math.sqrt(dx * dx + dy * dy)
		if r < 12 * t.R and r > 0.5 then
			local vmax = t.mph * 0.44704
			local V = if r < t.R then vmax * r / t.R else vmax * (t.R / r) ^ 0.6
			-- cyclonic (anticlockwise seen from above), with a little inflow
			tu, tv = (-dy / r) * V - 0.25 * (dx / r) * V, (dx / r) * V - 0.25 * (dy / r) * V
		end
	end
	return u, v, tu, tv
end

function FoliageWind.gustAt(xStuds: number, zStuds: number): (number, number, number)
	local lx, ly, kx, ky = toLab(xStuds, zStuds)
	local u, v = 0, 0 -- the 3-s gust, east and north
	local st = host and host.state
	local world = st and st.world
	if world and lx then
		local bu, bv = world:windAt(lx, ly, Z, true)
		local au, av = world:windAt(lx, ly, Z)
		u, v = bu * FoliageWind.GUST + (au - bu), bv * FoliageWind.GUST + (av - bv)
	else
		local e = environment()
		if e and lx then
			local eu, ev = e:windAt(lx, ly, Z)
			u, v = eu * FoliageWind.GUST, ev * FoliageWind.GUST
		end
		if live then
			for _, s in live.stormsNow() do
				local fu, fv, tu, tv = frameWind(s, kx, ky)
				if fu then
					u, v = fu * FoliageWind.GUST, fv * FoliageWind.GUST
				end
				u += tu
				v += tv
			end
		end
	end
	local speed = math.sqrt(u * u + v * v)
	if speed < 1e-6 then
		return 0, 1, 0
	end
	-- world X is east, Z south
	return speed, u / speed, -v / speed
end

return FoliageWind
