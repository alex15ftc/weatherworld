--!nonstrict
-- The 3-s gust at 10 m over a point of the map, for the trees' breaking (FoliageService). The
-- same weather on every server, from what StormHostService and LiveStormsService hold:
--   lab world (StormHost runs the sim: the lab, or engine mode without frame-fed cards):
--           World.windAt at 10 m - the environment, cold pools, storms and their tornadoes;
--   frame-fed (engine, no lab world): the window's environment (Sim/Environment from the
--           window's data) and, inside each engine storm's box, its full frame's ground wind
--           (FrameCodec.box / nestColumn), which holds the storm's mesocyclone and tornado - the
--           ones the radar's velocity shows (js/storms/StormVortices.js). The nest's 250 m cells
--           are wider than a tornado's core, so near one the tornado as the cell's centre had it
--           is taken out and put back at the point itself: the same vortex (at the ground a Rankine
--           core of the frame's radius R, swirl V = the engine's wind less the storm's motion,
--           falling as 1/r and fading beyond its parent circulation's radius), at full detail.
--           (Until 2026-11-13 a second, full-strength tornado was added on top of the nest's.)
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
local VisualAtmosphere = require(Shared.CloudModel.VisualAtmosphere)

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
	local mx, my = WorldMap.worldMilesAt(xStuds, zStuds)
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

-- The tornado's ground wind (m/s, east, north) at dx, dy (box m) from its centre, as
-- js/storms/StormVortices.js addTornadoWind has it at the ground: cyclonic for spin 1.
local function tornadoWind(R: number, V: number, fadeR: number, spin: number, dx: number, dy: number): (number, number)
	local r = math.sqrt(dx * dx + dy * dy)
	if r < 0.5 or r > 4 * fadeR then
		return 0, 0
	end
	local q = r / fadeR
	local vt = spin * (if r < R then V * r / R else V * R / r) / (1 + q * q * q)
	return -dy / r * vt, dx / r * vt
end

-- a storm's frame wind at a map point (km, y south), or nil outside its box: ground wind (m/s,
-- east, north) with the tornado at full detail
local function frameWind(s: any, kx: number, ky: number): (number?, number?, number, number)
	local f = s.frame
	local bx = f.anchorX + (kx - s.xKm) * 1000
	local by = f.anchorY + (s.yKm - ky) * 1000
	local u, v = nil, nil
	local cx, cy = nil, nil -- the nest cell's centre (box m), where its wind was worked out
	local n = f.nest
	if n then
		local i, j = math.floor((bx - n.X0) / n.dx) + 1, math.floor((by - n.Y0) / n.dx) + 1
		if i >= 1 and j >= 1 and i <= n.nx and j <= n.ny then
			local _, nu, nv = FrameCodec.nestColumn(f, i, j)
			u, v = nu, nv
			cx, cy = n.X0 + (i - 0.5) * n.dx, n.Y0 + (j - 0.5) * n.dx
		end
	end
	if not u then
		local i, j = math.floor(bx / f.dx) + 1, math.floor(by / f.dx) + 1
		if i >= 1 and j >= 1 and i <= f.nx and j <= f.ny then
			local _, _, _, _, _, _, _, bu, bv = FrameCodec.box(f, i, j)
			u, v = bu, bv
		end
	end
	local t = f.tornado
	if u and t and t.mph > 0 and t.R > 0 then
		local V = math.max(0, t.mph * 0.44704 - math.sqrt(f.um * f.um + f.vm * f.vm))
		local vx = VisualAtmosphere.vortexFrom(f)
		local fadeR = math.max(4 * t.R, if vx then vx.mesoR else 1500)
		-- (its turn from the nest's spin there: a left mover's tornado turns the other way)
		local spin = 1
		if n then
			local i, j = math.floor((t.x - n.X0) / n.dx) + 1, math.floor((t.y - n.Y0) / n.dx) + 1
			if i >= 1 and j >= 1 and i <= n.nx and j <= n.ny then
				local _, _, _, z = FrameCodec.nestColumn(f, i, j)
				if z < 0 then
					spin = -1
				end
			end
		end
		local pu, pv = tornadoWind(t.R, V, fadeR, spin, bx - t.x, by - t.y)
		if cx then
			local cu, cv = tornadoWind(t.R, V, fadeR, spin, cx - t.x, cy - t.y)
			pu, pv = pu - cu, pv - cv
		end
		return u, v, pu, pv
	end
	return u, v, 0, 0
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
					-- (the tornado's own detail is a 3-s gust already, the EF scale's)
					u, v = fu * FoliageWind.GUST + tu, fv * FoliageWind.GUST + tv
				end
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
