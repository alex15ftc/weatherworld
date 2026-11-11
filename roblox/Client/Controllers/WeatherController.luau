--!nonstrict
-- The game's storms on the client (2026-10-27; replaces StormView, StormKit, StormMesh, StormWisps,
-- TornadoArt, CloudVolume, VaporRelight and SkyLight). The storm lab's billboard renderers
-- (Client/Modules/Weather/Render, shared with the storm lab) draw the storm frames v2 the server's
-- StormHostService publishes (docs/stormlab/FRAME-V2.md), through the lab's own client mirror
-- (Sim/ClientWorld) and network code (Modules/Weather/Net, Shared/Net/StormNet).
--   frame   lab metres -> game studs (LabConfig.setFrame): across at the map's scale
--           (Config.STUDS_PER_MILE), origin at the window centre's studs; up and for sizes at
--           WEATHER_STUDS_PER_METRE (below); a smooth ground datum (the terrain averaged over
--           ~DATUM_KM) that the clouds sit over; the ground's height for things on it (dust,
--           debris, the tornado's foot, rain splashes, scud) from the server's 1 km ground grid,
--           refined by raycasts near the camera
--   modules every module in Weather/Render except WindViz (a debug view); Ground draws only its
--           far-land rings here (the game's terrain is the ground near the camera)
--   storms  Weather.storms() lists them for DebugPageController (map km, the old frame's field names)
local ReplicatedFirst = game:GetService("ReplicatedFirst")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local Workspace = game:GetService("Workspace")

local Shared = ReplicatedStorage.Shared
local Config = require(Shared.World.Config)
local Profiler = require(Shared.Profiler)
local StormNet = require(Shared.Net.StormNet)

local Weather = {}

-- Scales (2026-10-27, the user's choice: each storm drawn whole at one scale). Across, positions
-- are at the map's scale. Each storm (tornado, shaft, flash...) is drawn about its centre at
-- Config.skyScaleAt(its distance from the camera): true (Config.STUDS_PER_METRE, 3.57) within
-- SKY_NEAR_STUDS, easing to SKY_FAR_STUDS_PER_METRE beyond SKY_FAR_STUDS. Things at the camera
-- (near rain, splashes) and the ground's height are at the true scale.
local KH = Config.STUDS_PER_MILE / 1609.344
Weather.WEATHER_STUDS_PER_METRE = Config.STUDS_PER_METRE
local DATUM_KM = 20
local SKIP = { WindViz = true } -- (Ground draws only its far-land rings in the game: the terrain is the ground near)
-- (the lab's alternate bodies stay out of the game: the cards are its body. StormVolume's mesh body
-- came on with the lab's F key - an ordinary key in the game - and drew far storms as dark rock,
-- user 2026-11-07; VolumeCards with Backspace)
SKIP.StormVolume = true
SKIP.VolumeCards = true
SKIP.RainShafts = true -- (no rain curtains in the game, user 2026-11-07; on again with the frame-fed cards, user 2026-11-08)
local RAIN_FROM_FRAMES = true -- (the rain round the camera is the engine frames': ctx.precipAt, below)
-- With workspace StormVisuals = "engine" the storms' cloud and tornadoes are drawn from the engine's
-- frames (EngineStormsController), so the lab sim's cloud, tornado and rain-shaft renderers are left
-- out. The rest reads the frames: the rain round the camera (ctx.precipAt, Render/NearPrecip), the
-- sky's light (ctx.cloudAt, Render/Sky) and the lightning (the engine storms' flashes from
-- LiveStormsService, drawn by Render/Lightning; StormHost stops sending the lab's own).
-- Near the storm the tornado, its dust and the wall cloud are the engine's own (EngineStormsController:
-- TornadoView, WallCloudView), drawn only from the shared frames, the storm's seed and the shared
-- clock, so every server and player sees the same storm (2026-11-07, the user). With workspace
-- StormNearLab = true the lab sim's tornado, dust, debris, wall cloud, inflow tail and scud draw
-- them instead (its billboards, but each server's own sim: they differ between servers). The lab sim follows the engine (Sim/EngineFollow: the engine's storms and
-- tornadoes, where and as strong as the engine says), so it is still the one engine's weather.
-- StormCards then runs only for their light, colour and rain fog (ctx.stormShade, ctx.stormBase;
-- ctx.state.cardsShadeOnly): the body is the engine's (EngineStormsController), which leaves out
-- its own TornadoView and WallCloudView by the same rule.
-- Cards (2026-11-07, the user's choice; default in engine mode unless StormBody is "puff" or
-- "mesh"): the lab's card renderers - StormCards, WallStream, Scud, BaseDeck - draw the body,
-- wall cloud, base and scud, but from storms this client builds from the engine's shared numbers
-- (Modules/FrameWorld; the server's own lab sim is not taken: Modules/Weather/Net), with the
-- frames' rain; the tornado is the lab's TornadoCards and TornadoDust, fed the frame's tornado
-- the same way (FrameWorld), with the painted TornadoView's wind overlay on TornadoDebug / J
-- (EngineStormsController). The same on every server.
local ENGINE_VISUALS = workspace:GetAttribute("StormVisuals") == "engine" and workspace:GetAttribute("LiveStorms") == true
local NEAR_LAB = ENGINE_VISUALS and workspace:GetAttribute("StormNearLab") == true
local FRAME_CARDS = ENGINE_VISUALS and not NEAR_LAB and workspace:GetAttribute("StormBody") ~= "puff" and workspace:GetAttribute("StormBody") ~= "mesh"
if ENGINE_VISUALS then
	local off = { "BaseDeck", "StormVolume", "VolumeCards", "RainShafts" }
	if FRAME_CARDS then
		-- (the curtains read the frames' rain as 1 km columns: Modules/FrameWorld; "a dark curtain under
		-- the storm that hides the bright horizon", the lifecycle review 2026-11-08)
		off = { "NearVfx", "StormVolume", "VolumeCards", "DebrisView", "DebrisCloud" }
		SKIP.RainShafts = nil
	elseif not NEAR_LAB then
		off = { "BaseDeck", "NearVfx", "Scud", "StormCards", "StormVolume", "VolumeCards", "WallStream", "TornadoCards", "TornadoDust", "DebrisView", "DebrisCloud", "RainShafts" }
	end
	for _, name in off do
		SKIP[name] = true
	end
end

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
local rayCache, rayAt, rayCacheAt = {}, {}, 0
local function terrainStuds(sx: number, sz: number): number?
	local now = os.clock()
	-- (each entry kept 3-4 s from its own ray, so they expire spread out, not all in one frame;
	-- stale ones swept now and then)
	if now - rayCacheAt > 10 then
		rayCacheAt = now
		for k, t in rayAt do
			if now - t > 6 then
				rayCache[k], rayAt[k] = nil, nil
			end
		end
	end
	local key = math.floor(sx / 16) * 65536 + math.floor(sz / 16)
	local v = rayCache[key]
	if v ~= nil and now - rayAt[key] > 3 + (key % 8) * 0.125 then
		v = nil
	end
	if v == nil then
		local hit = Workspace:Raycast(Vector3.new(sx, Config.RAY_TOP_STUDS, sz), Vector3.new(0, -Config.RAY_TOP_STUDS - 200, 0), rayParams)
		v = if hit then hit.Position.Y else false
		rayCache[key] = v
		rayAt[key] = now
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
		-- (the engine draws the storm body at the map's scale: the lab's wall cloud and scud ease to
		-- it away from a funnel, LabConfig.radial. Off with the lab's own body - the storm cards draw
		-- it at the storm's one scale, and a squeezed wall cloud kept its full depth at a third of its
		-- width: a round bulb hanging into the funnel, regrade 2026-11-07)
		radialMap = ENGINE_VISUALS and not FRAME_CARDS and not NEAR_LAB,
		precipVisibility = Config.PRECIP_VISIBILITY,
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

-- The ground grid and the hello, asked of StormHostService (each waits there until it is ready).
local function ask(request: any, what: string): any
	while true do
		local ok, answer = request:Client():Await()
		if ok then
			return answer
		end
		warn(`[Weather] {what}: {answer}; asking again`)
		task.wait(2)
	end
end

function Weather.Start()
	local lab = Shared.StormLab
	local Sim = lab.Sim
	local ClientWorld = require(Sim.ClientWorld)
	local Json = require(Sim.Json)
	local LabConfig = require(lab.LabConfig)
	local here = ReplicatedFirst.Modules.Weather
	local Context = require(here.Context)
	local Net = require(here.Net)

	-- the frame first (every renderer places through it)
	setFrame(LabConfig, ask(StormNet.Ground, "ground"))
	local info = ask(StormNet.Hello, "hello")
	local function scenarioData(name: string, json: string?): any
		if type(json) == "string" then
			return Json.decode(json)
		end
		return Json.decode(require(lab.Data:WaitForChild(name)))
	end
	local data = scenarioData(info.scenario, info.data)
	local cw = ClientWorld.new(data)
	ctx = Context.new(cw)
	ctx.scenario = info.scenario
	ctx.scenarioData = data -- (the sun's place and time zone: Render/Sky)
	ctx.source = info.source
	ctx.state.show.labels = false
	-- the weather runs at the game's 8x clock (storms move and evolve with it), but local motion
	-- - a tornado's spin, dust, debris, scud, cloud boiling, thunder's delay - at real speed
	ctx.state.visualScale = 1
	ctx.state.cardsShadeOnly = NEAR_LAB -- (StormCards: light and colour for the near renderers, no body)
	ctx:noteServerTime(info.time or 0)
	ctx.tornadoAdapter = ctx.Tornado.StateAdapter.new(ctx)
	-- Each storm drawn about one point (LabConfig.stormAnchor, 2026-11-07): its tornado's foot as the
	-- funnel is drawn (the adapter's smoothed position), else its low-level circulation. When that
	-- point changes over (a tornado touching down or lifting) the storm glides to the new one over
	-- ~2 s, so nothing jumps; otherwise it is exactly the tornado's, so funnel and cloud agree.
	if not ENGINE_VISUALS or FRAME_CARDS then
		local anchors = {}
		-- (where each storm was last found in cw.storms: checked, then scanned for as before when it
		-- has moved; anchors not asked for in a minute let go)
		local slotOf: { [string]: number } = {}
		local sweptAt = os.clock()
		ctx.Config.anchorFn = function(id: string): (number?, number?)
			local s
			local storms = ctx.cw.storms
			local i0 = slotOf[id]
			local st0 = i0 and storms[i0]
			if st0 and tostring(st0.id) == id then
				s = st0
			else
				for i, st in storms do
					if tostring(st.id) == id then
						s = st
						slotOf[id] = i
						break
					end
				end
			end
			if not s then
				slotOf[id] = nil
				return nil, nil
			end
			if os.clock() - sweptAt > 10 then
				sweptAt = os.clock()
				for aid, a in anchors do
					if sweptAt - a.t > 60 then
						anchors[aid] = nil
						slotOf[aid] = nil
					end
				end
			end
			local tx, ty, kind = s.lowX or s.x, s.lowY or s.y, "low"
			for tid, e in ctx.tornadoAdapter.entries do
				local pid = e.snap and e.snap.parentId
				if pid ~= nil and tostring(pid) == id and e.x and (e.fade or 1) > 0.05 then
					tx, ty, kind = e.x, e.y, tostring(tid)
					break
				end
			end
			local now = os.clock()
			local a = anchors[id]
			if not a then
				a = { x = tx, y = ty, rx = 0, ry = 0, kind = kind, t = now }
				anchors[id] = a
			end
			if a.kind ~= kind then
				-- (glide from where it was drawn about)
				a.rx, a.ry, a.kind = a.x - tx, a.y - ty, kind
			end
			local keep = math.exp(-math.clamp(now - a.t, 0, 1) / 2)
			a.t = now
			a.rx *= keep
			a.ry *= keep
			if a.rx * a.rx + a.ry * a.ry > 8000 * 8000 then
				a.rx, a.ry = 0, 0
			end
			a.x, a.y = tx + a.rx, ty + a.ry
			return a.x, a.y
		end
	end
	-- (engine storms: the rain round the camera from their frames, Render/NearPrecip)
	if RAIN_FROM_FRAMES then
		local EngineStorms = require(script.Parent.EngineStormsController) :: any
		ctx.precipAt = EngineStorms.precipAt
		-- (the sky's light from the frames' cloud: Render/Sky; sim metres -> world studs)
		ctx.cloudAt = function(x: number, y: number)
			local v = ctx.Config.toWorld(x, y, 0)
			return EngineStorms.cloudAt(v.X, v.Z)
		end
		-- (the engine storms' lightning, made by LiveStormsService in map km: into the lab's
		-- flash signal in sim metres, for Render/Lightning to draw, light and thunder)
		-- (and the flashes' light on the engine storms' cloud: the lab's flash field, at a world place)
		-- (x, z studs; hM metres up; hx, hz the region's half size across and up, m)
		-- (the debug camera's target, EngineStorms: the nearest lab tornado drawn, half way up to its base)
		EngineStorms.labTornadoAt = function(): Vector3?
			local cam = Workspace.CurrentCamera
			local best, bestD = nil, math.huge
			for _, e in ctx.tornadoAdapter.entries do
				if (e.fade or 0) > 0.05 then
					local p = ctx.Config.toWorldAbout(e.x, e.y, 0.5 * math.max(e.cloudBase or 0, 200), e.x, e.y)
					local d = if cam then (cam.CFrame.Position - p).Magnitude else 0
					if d < bestD then best, bestD = p, d end
				end
			end
			return best
		end
		EngineStorms.rainExtinction = ctx.Config.rainExtinction -- (the rain's fog on the storm's billboards)
		EngineStorms.flashAt = function(x: number, z: number, hM: number, hx: number?, hz: number?): number
			local ff = ctx.flashField
			if not ff then return 0 end
			local sx, sy = ctx.Config.fromWorld(Vector3.new(x, 0, z))
			return ctx.Tornado.FlashField.atBox(ff, sx, sy, hM, hx or 0, hz or 0)
		end
		EngineStorms.flashLive = function(): boolean
			local ff = ctx.flashField
			return ff ~= nil and #ff.flashes > 0
		end
		local LiveStorms = require(script.Parent.LiveStormsController) :: any
		local WorldConfig = Config :: any
		local function sim(xKm: number, yKm: number): (number, number)
			local half = WorldConfig.MAP_MILES / 2
			local sx, sz = (xKm / WorldConfig.KM_PER_MILE - half) * WorldConfig.STUDS_PER_MILE, (yKm / WorldConfig.KM_PER_MILE - half) * WorldConfig.STUDS_PER_MILE
			local x, y = ctx.Config.fromWorld(Vector3.new(sx, 0, sz))
			return x, y
		end
		if FRAME_CARDS then
			ctx.sharedClock = require(Shared.CloudModel.SharedClock) :: any
			require(ReplicatedFirst.Modules.FrameWorld).attach(ctx, LiveStorms, EngineStorms, sim)
		end
		local seen, seenAt = { cg = 0, ["+cg"] = 0, ic = 0 }, os.clock()
		LiveStorms.flash:Connect(function(list)
			-- (debug: how many came, each 10 s)
			if workspace:GetAttribute("EngineStormsDebugCam") == true then
				for _, e in list do seen[e.kind] = (seen[e.kind] or 0) + 1 end
				if os.clock() - seenAt > 10 then
					print(("[Lightning] engine flashes in %.0f s: %d cg, %d +cg, %d ic (sky: sun %.2f, light %.2f, cover %.2f)"):format(os.clock() - seenAt, seen.cg, seen["+cg"], seen.ic,
						ctx.root:GetAttribute("SkyDirect") or -1, ctx.root:GetAttribute("SkyDiffuse") or -1, ctx.root:GetAttribute("SkyCover") or -1))
					seen, seenAt = { cg = 0, ["+cg"] = 0, ic = 0 }, os.clock()
				end
			end
			for _, e in list do
				local x0, y0 = sim(e.x0, e.y0)
				local x1, y1 = sim(e.x1, e.y1)
				ctx.signals.flash:Fire({ kind = e.kind, seed = e.seed, current = e.current, x0 = x0, y0 = y0, z0 = e.z0, x1 = x1, y1 = y1, z1 = e.z1 })
			end
		end)
	end
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
			local _, g = StormNet.Ground:Client():Await()
			if g and g.centreKm and frameInfo and (g.centreKm.x ~= frameInfo.cx or g.centreKm.y ~= frameInfo.cy) then
				-- (lab metres from the old centre to the new, as StormHostService's own: Modules/FrameWorld
				-- carries its built storms over so they keep their map spot)
				ctx.frameShift = { x = (frameInfo.cx - g.centreKm.x) * 1000, y = -(frameInfo.cy - g.centreKm.y) * 1000 }
				setFrame(LabConfig, g)
			end
			local d = scenarioData(e.scenario, e.data)
			ctx.scenarioData = d
			local fresh = ClientWorld.new(d)
			-- (frame-fed: the storms, tornadoes and rain are Modules/FrameWorld's, from the engine's
			-- frames - a new window must not swap them for the empty lab ones)
			local keep = if ctx.frameFed then { vol = true, storms = true, tornadoes = true } else {}
			for k, v in fresh do
				if not keep[k] then
					cw[k] = v
				end
			end
			ctx.signals.scenario:Fire(e.scenario)
		end
	end)

	local running = {}
	for _, m in here.Render:GetChildren() do
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
		Profiler.Begin("Weather")
		if ctx.flashField then
			ctx.Tornado.FlashField.step(ctx.flashField, os.clock())
		end
		pcall(ctx.tornadoAdapter.update, ctx.tornadoAdapter, dt)
		for _, r in running do
			if not r.off then
				Profiler.Begin(r.name)
				local ok, err = pcall(r.obj.update, r.obj, dt)
				Profiler.End()
				if not ok then
					r.errors += 1
					warn(string.format("[Weather] %s.update: %s", r.name, tostring(err)))
					if r.errors >= 5 then
						r.off = true
					end
				end
			end
		end
		-- last, as in the storm lab: the near-field VFX fades out the cards it has replaced with
		-- particles (Render/NearVfx). Without this the near cards and their particles both drew.
		local nv = ctx.nearVfx
		if nv and not nv.broken then
			local ok, err = pcall(nv.post, nv, dt)
			if not ok then
				nv.broken = true
				warn("[Weather] NearVfx.post: " .. tostring(err))
			end
		end
		Profiler.End()
	end)
	print(string.format("[Weather] storms from the %s, %d renderers", tostring(info.source), #running))
end

-- The storms for DebugPageController, in the old frame's terms (map km east and south of the north-west
-- corner, kph, metres)
-- The wind (m/s at 10 m: the lab's field, cw:windAt) over a world point and the way it blows
-- (unit, world X and Z), for the trees' sway (FoliageController); 0 before the weather is up.
function Weather.windAtStuds(x: number, z: number): (number, number, number)
	if not ctx or not ctx.cw then
		return 0, 1, 0
	end
	local lx, ly = ctx.Config.fromWorld(Vector3.new(x, 0, z))
	local ok, u, v = pcall(ctx.cw.windAt, ctx.cw, lx, ly, 10)
	if not ok then
		return 0, 1, 0
	end
	local s = math.sqrt(u * u + v * v)
	if s < 1e-6 then
		return 0, 1, 0
	end
	return s, u / s, -v / s
end

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
	local function tornadoOf(t: any, base: number?): any
		local tx, ty = km(t.x, t.y)
		return { xKm = tx, yKm = ty, baseM = t.cloudBase or base or 1000, ef = t.ef, windMph = math.floor((t.peakWind or 0) * 2.237 + 0.5), widthYards = math.floor((t.rc or 0) * 2 * 1.094 + 0.5), shape = t.stage }
	end
	local stormRows = {}
	for _, s in ctx.cw.storms do
		if not s.dead then
			local xk, yk = km(s.x, s.y)
			local lx, ly = km(s.lowX or s.x, s.lowY or s.y)
			local t = torByParent[s.id]
			local row = {
				id = tostring(s.id), xKm = xk, yKm = yk, eastKph = (s.u or 0) * 3.6, northKph = (s.v or 0) * 3.6,
				mode = if (s.rot or 0) > 0.5 then "supercell" else "storm", intensity = math.clamp((s.W or 0) / 50, 0, 1.5),
				groundStuds = f.datum(s.x, s.y),
				updraft = { xKm = xk, yKm = yk, baseM = s.base or 1000, radiusKm = (s.Ru or 3000) / 1000 },
				wallCloud = { xKm = lx, yKm = ly, strength = math.clamp((s.lowering or 0) / 300, 0, 1) },
				tornado = if t then tornadoOf(t, s.base) else nil, funnelAloft = false,
			}
			stormRows[s.id] = row
			table.insert(out, row)
		end
	end
	-- Every live tornado as a row of its own (id "tor:<id>"), centred and moving with the tornado,
	-- so the page can teleport to and follow it even when its storm has two or has died.
	for _, t in ctx.cw.tornadoes do
		if not t.ended then
			local parent = stormRows[t.parentId]
			local tor = tornadoOf(t, if parent then parent.updraft.baseM else nil)
			table.insert(out, {
				id = `tor:{t.id}`, parentId = if parent then parent.id else nil,
				xKm = tor.xKm, yKm = tor.yKm, eastKph = (t.ut or 0) * 3.6, northKph = (t.vt or 0) * 3.6,
				mode = "tornado", intensity = if parent then parent.intensity else 0,
				groundStuds = f.datum(t.x, t.y),
				updraft = if parent then parent.updraft else { xKm = tor.xKm, yKm = tor.yKm, baseM = tor.baseM, radiusKm = 3 },
				wallCloud = if parent then parent.wallCloud else nil,
				tornado = tor, funnelAloft = false,
			})
		end
	end
	return out
end

return Weather
