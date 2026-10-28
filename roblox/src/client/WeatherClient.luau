--!nonstrict
-- The game's storms on the client (2026-10-27; replaces StormView, StormKit, StormMesh, StormWisps,
-- TornadoArt, CloudVolume, VaporRelight and SkyLight). The storm lab's billboard renderers
-- (stormlab/client/Render, mapped here as Weather/Render) draw the storm frames v2 the server's
-- StormHost publishes (docs/stormlab/FRAME-V2.md), through the lab's own client mirror
-- (Sim/ClientWorld) and network code (Weather/Net).
--   frame   lab metres -> game studs (LabConfig.setFrame): across at the map's scale
--           (Config.STUDS_PER_MILE), origin at the window centre's studs; up and for sizes at
--           WEATHER_STUDS_PER_METRE (below); a smooth ground datum (the terrain averaged over
--           ~DATUM_KM) that the clouds sit over; the ground's height for things on it (dust,
--           debris, the tornado's foot, rain splashes, scud) from the server's 1 km ground grid,
--           refined by raycasts near the camera
--   modules every module in Weather/Render except the lab-only ones (Ground: the game has its own
--           terrain; WindViz: a debug view)
--   storms  Weather.storms() lists them for DebugPage (map km, the old frame's field names)
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local Workspace = game:GetService("Workspace")

local Config = require(ReplicatedStorage.Shared.World.Config)

local Weather = {}

-- Scales (2026-10-27, the user's choice: each storm drawn whole at one scale). Across, positions
-- are at the map's scale. Each storm (tornado, shaft, flash...) is drawn about its centre at
-- Config.skyScaleAt(its distance from the camera): true (Config.STUDS_PER_METRE, 3.57) within
-- SKY_NEAR_MILES, easing to SKY_FAR_STUDS_PER_METRE beyond SKY_FAR_MILES. Things at the camera
-- (near rain, splashes) and the ground's height are at the true scale.
local KH = Config.STUDS_PER_MILE / 1609.344
Weather.WEATHER_STUDS_PER_METRE = Config.STUDS_PER_METRE
local DATUM_KM = 20
local SKIP = { Ground = true, WindViz = true }

local ctx = nil
local frameInfo = nil

-- the ground grid (studs, from the server) and its smooth datum
local function ground(blob: any)
	local n, cell, half = blob.n, blob.cell, blob.half
	local raw = table.create(n * n, 0)
	for k = 0, n * n - 1 do
		raw[k + 1] = buffer.readu16(blob.data, 2 * k) / 4
	end
	-- box-blurred twice over ~DATUM_KM: the datum the clouds sit over
	local r = math.max(1, math.floor(DATUM_KM * 1000 / cell / 2 + 0.5))
	local function blur(src: { number }): { number }
		local tmp, out = table.create(n * n, 0), table.create(n * n, 0)
		for j = 0, n - 1 do
			for i = 0, n - 1 do
				local s, c = 0, 0
				for d = -r, r do
					local ii = math.clamp(i + d, 0, n - 1)
					s += src[j * n + ii + 1]
					c += 1
				end
				tmp[j * n + i + 1] = s / c
			end
		end
		for j = 0, n - 1 do
			for i = 0, n - 1 do
				local s, c = 0, 0
				for d = -r, r do
					local jj = math.clamp(j + d, 0, n - 1)
					s += tmp[jj * n + i + 1]
					c += 1
				end
				out[j * n + i + 1] = s / c
			end
		end
		return out
	end
	local datum = blur(blur(raw))
	local function sample(t: { number }, x: number, y: number): number
		local gx = math.clamp((x + half) / cell, 0, n - 1.001)
		local gy = math.clamp((y + half) / cell, 0, n - 1.001)
		local i, j = math.floor(gx), math.floor(gy)
		local fx, fy = gx - i, gy - j
		local a = t[j * n + i + 1]
		local b = t[j * n + i + 2] or a
		local c = t[(j + 1) * n + i + 1] or a
		local d = t[(j + 1) * n + i + 2] or c
		return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy
	end
	return function(x, y)
		return sample(raw, x, y)
	end, function(x, y)
		return sample(datum, x, y)
	end
end

-- near the camera the terrain itself (streamed in round the player) is the ground: raycasts,
-- cached on a 16 m grid for 3 s
local rayParams = RaycastParams.new()
rayParams.FilterType = Enum.RaycastFilterType.Include
rayParams.FilterDescendantsInstances = { Workspace.Terrain }
local rayCache, rayCacheAt = {}, 0
local function terrainStuds(sx: number, sz: number): number?
	local now = os.clock()
	if now - rayCacheAt > 3 then
		table.clear(rayCache)
		rayCacheAt = now
	end
	local key = math.floor(sx / 16) * 65536 + math.floor(sz / 16)
	local v = rayCache[key]
	if v == nil then
		local hit = Workspace:Raycast(Vector3.new(sx, Config.RAY_TOP_STUDS, sz), Vector3.new(0, -Config.RAY_TOP_STUDS - 200, 0), rayParams)
		v = if hit then hit.Position.Y else false
		rayCache[key] = v
	end
	return if v then v else nil
end

local function setFrame(C: any, info: any)
	local cx, cy = info.centreKm.x, info.centreKm.y
	local spm = info.studsPerMile
	local ox = (cx / Config.KM_PER_MILE - info.mapMiles / 2) * spm
	local oz = (cy / Config.KM_PER_MILE - info.mapMiles / 2) * spm
	local kh = spm / 1609.344
	local kv = Weather.WEATHER_STUDS_PER_METRE
	local gridStuds, datumStuds = ground(info)
	local cam = Workspace.CurrentCamera
	C.setFrame({
		kh = kh, kv = kv, ks = kv, ox = ox, oz = oz,
		datum = datumStuds,
		-- a storm's scale from its centre's distance (studs across) to the camera
		sky = function(x: number, y: number): number
			local p = cam.CFrame.Position
			local sx, sz = ox + x * kh, oz - y * kh
			return Config.skyScaleAt(math.sqrt((sx - p.X) ^ 2 + (sz - p.Z) ^ 2))
		end,
		-- the ground above the datum (m): the terrain near the camera, else the grid
		ground = function(x: number, y: number): number
			local sx, sz = ox + x * kh, oz - y * kh
			local p = cam.CFrame.Position
			local g
			if (sx - p.X) ^ 2 + (sz - p.Z) ^ 2 < 1500 ^ 2 then
				g = terrainStuds(sx, sz)
			end
			g = g or gridStuds(x, y)
			return (g - datumStuds(x, y)) / kv
		end,
	})
	frameInfo = { ox = ox, oz = oz, kh = kh, kv = kv, cx = cx, cy = cy, datum = datumStuds }
end

function Weather.start()
	local lab = ReplicatedStorage:WaitForChild("StormLab")
	local Sim = lab:WaitForChild("Sim")
	local ClientWorld = require(Sim:WaitForChild("ClientWorld"))
	local Json = require(Sim:WaitForChild("Json"))
	local LabConfig = require(lab:WaitForChild("LabConfig"))
	local here = script.Parent:WaitForChild("Weather")
	local Context = require(here:WaitForChild("Context"))
	local Net = require(here:WaitForChild("Net"))

	local folder = ReplicatedStorage:WaitForChild(LabConfig.NET_FOLDER)
	-- the frame first (every renderer places through it)
	setFrame(LabConfig, folder:WaitForChild("WeatherGround"):InvokeServer())
	local info = folder:WaitForChild(LabConfig.REMOTES.hello):InvokeServer()
	local function scenarioData(name: string, json: string?): any
		if type(json) == "string" then
			return Json.decode(json)
		end
		return Json.decode(require(lab:WaitForChild("Data"):WaitForChild(name)))
	end
	local data = scenarioData(info.scenario, info.data)
	local cw = ClientWorld.new(data)
	ctx = Context.new(cw)
	ctx.scenario = info.scenario
	ctx.scenarioData = data -- (the sun's place and time zone: Render/Sky)
	ctx.source = info.source
	ctx.state.show.labels = false
	-- the weather runs at the game's 12x clock (storms move and evolve with it), but local motion
	-- - a tornado's spin, dust, debris, scud, cloud boiling, thunder's delay - at real speed
	ctx.state.visualScale = 1
	ctx:noteServerTime(info.time or 0)
	ctx.tornadoAdapter = ctx.Tornado.StateAdapter.new(ctx)
	Net.connect(ctx)
	ctx:command({ cmd = "ready" })
	-- (the environment's analysed fields, a few cells a frame: radar and labels use them)
	task.spawn(function()
		while true do
			local env = cw.env
			if env.analysed < env.ag.nx * env.ag.ny then
				env:analyse(4)
				task.wait()
			else
				env:analyse(2)
				task.wait(2)
			end
		end
	end)
	ctx.signals.event:Connect(function(e)
		if e.kind == "scenario" then
			-- (the window may have moved with the players: a new frame round its new centre)
			local g = folder:WaitForChild("WeatherGround"):InvokeServer()
			if g and g.centreKm and frameInfo and (g.centreKm.x ~= frameInfo.cx or g.centreKm.y ~= frameInfo.cy) then
				setFrame(LabConfig, g)
			end
			local d = scenarioData(e.scenario, e.data)
			ctx.scenarioData = d
			local fresh = ClientWorld.new(d)
			for k, v in fresh do
				cw[k] = v
			end
			ctx.signals.scenario:Fire(e.scenario)
		end
	end)

	local running = {}
	for _, m in here:WaitForChild("Render"):GetChildren() do
		if m:IsA("ModuleScript") and not SKIP[m.Name] then
			local ok, mod = pcall(require, m)
			if ok and type(mod) == "table" and type(mod.new) == "function" then
				local ok2, obj = pcall(mod.new, ctx)
				if ok2 then
					table.insert(running, { name = m.Name, obj = obj, errors = 0 })
				else
					warn("[Weather] " .. m.Name .. ".new: " .. tostring(obj))
				end
			elseif not ok then
				warn("[Weather] " .. m.Name .. ": " .. tostring(mod))
			end
		end
	end
	RunService.RenderStepped:Connect(function(dt)
		if ctx.flashField then
			ctx.Tornado.FlashField.step(ctx.flashField, os.clock())
		end
		pcall(ctx.tornadoAdapter.update, ctx.tornadoAdapter, dt)
		for _, r in running do
			if not r.off then
				local ok, err = pcall(r.obj.update, r.obj, dt)
				if not ok then
					r.errors += 1
					warn(string.format("[Weather] %s.update: %s", r.name, tostring(err)))
					if r.errors >= 5 then
						r.off = true
					end
				end
			end
		end
	end)
	print(string.format("[Weather] storms from the %s, %d renderers", tostring(info.source), #running))
end

-- The storms for DebugPage, in the old frame's terms (map km east and south of the north-west
-- corner, kph, metres)
function Weather.storms(): { any }
	local out = {}
	if not ctx or not frameInfo then
		return out
	end
	local f = frameInfo
	local function km(x: number, y: number): (number, number)
		return f.cx + x / 1000, f.cy - y / 1000
	end
	local torByParent = {}
	for _, t in ctx.cw.tornadoes do
		if not t.ended then
			torByParent[t.parentId] = t
		end
	end
	for _, s in ctx.cw.storms do
		if not s.dead then
			local xk, yk = km(s.x, s.y)
			local lx, ly = km(s.lowX or s.x, s.lowY or s.y)
			local t = torByParent[s.id]
			local tor = nil
			if t then
				local tx, ty = km(t.x, t.y)
				tor = { xKm = tx, yKm = ty, baseM = t.cloudBase or s.base, ef = t.ef, windMph = math.floor((t.peakWind or 0) * 2.237 + 0.5), widthYards = math.floor((t.rc or 0) * 2 * 1.094 + 0.5), shape = t.stage }
			end
			table.insert(out, {
				id = tostring(s.id), xKm = xk, yKm = yk, eastKph = (s.u or 0) * 3.6, northKph = (s.v or 0) * 3.6,
				mode = if (s.rot or 0) > 0.5 then "supercell" else "storm", intensity = math.clamp((s.W or 0) / 50, 0, 1.5),
				groundStuds = f.datum(s.x, s.y),
				updraft = { xKm = xk, yKm = yk, baseM = s.base or 1000, radiusKm = (s.Ru or 3000) / 1000 },
				wallCloud = { xKm = lx, yKm = ly, strength = math.clamp((s.lowering or 0) / 300, 0, 1) },
				tornado = tor, funnelAloft = false,
			})
		end
	end
	return out
end

local _ = Players
return Weather
