--!nonstrict
-- Storm lab client (roblox/src/stormlab): mirrors the server's atmosphere (ClientWorld) and runs
-- the renderers. Every module in Render/ and UI/ exports new(ctx) -> object with :update(dt)
-- (each frame) and optionally :destroy(); a module that keeps failing is switched off with a
-- warning instead of breaking the others.
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local StarterGui = game:GetService("StarterGui")

local Context = require(script:WaitForChild("Context"))
local Net = require(script:WaitForChild("Net"))

pcall(function()
	StarterGui:SetCoreGuiEnabled(Enum.CoreGuiType.Backpack, false)
	StarterGui:SetCoreGuiEnabled(Enum.CoreGuiType.PlayerList, false)
end)

local lab = ReplicatedStorage:WaitForChild("StormLab")
local Sim = lab:WaitForChild("Sim")
local ClientWorld = require(Sim:WaitForChild("ClientWorld"))
local Json = require(Sim:WaitForChild("Json"))
local LabConfig = require(lab:WaitForChild("LabConfig"))

-- which scenario the server runs (its environment columns are loaded here too)
local folder = ReplicatedStorage:WaitForChild(LabConfig.NET_FOLDER)
local hello = folder:WaitForChild(LabConfig.REMOTES.hello)
local info = hello:InvokeServer()
-- (a relayed source may send the scenario's environment itself, when the client has no module of
-- that name: docs/stormlab/FRAME-V2.md)
local function scenarioData(name: string, json: string?): any
	if type(json) == "string" then
		return Json.decode(json)
	end
	return Json.decode(require(lab:WaitForChild("Data"):WaitForChild(name)))
end
local data = scenarioData(info.scenario, info.data)
local cw = ClientWorld.new(data)
local ctx = Context.new(cw)
ctx.scenario = info.scenario
if info.town then
	LabConfig.groundCentre = { x = info.town.x, y = info.town.y }
end
ctx.source = info.source or "sim"
ctx.scenarioData = data
ctx:noteServerTime(info.time or 0)
Net.connect(ctx)
-- listeners connected: the server may now send us its broadcasts and the full state
ctx:command({ cmd = "ready" })

-- the environment's analysed fields (CAPE, SRH, LCL... for the map and labels) are worked out
-- here too, a few cells a frame, then refreshed slowly
task.spawn(function()
	while true do
		local env = cw.env
		local total = env.ag.nx * env.ag.ny
		if env.analysed < total then
			env:analyse(6)
			task.wait()
		else
			env:analyse(4)
			task.wait(1)
		end
	end
end)

local running = {}
local function start(module: ModuleScript)
	local ok, mod = pcall(require, module)
	if not ok then
		warn("[StormLab] " .. module.Name .. " failed to load: " .. tostring(mod))
		return
	end
	if type(mod) ~= "table" or type(mod.new) ~= "function" then
		return
	end
	local ok2, obj = pcall(mod.new, ctx)
	if not ok2 then
		warn("[StormLab] " .. module.Name .. ".new failed: " .. tostring(obj))
		return
	end
	table.insert(running, { name = module.Name, obj = obj, errors = 0 })
end

-- the tornado state every tornado renderer reads (TornadoCards, DebrisCloud, TornadoDust):
-- smoothed from the server's snapshots, updated each frame before the renderers
ctx.tornadoAdapter = ctx.Tornado.StateAdapter.new(ctx)

-- the camera and panel first, then everything that draws
start(script:WaitForChild("CameraRig"))
start(script:WaitForChild("Panel"))
for _, sub in { "Render", "UI" } do
	local f = script:FindFirstChild(sub)
	if f then
		for _, m in f:GetChildren() do
			if m:IsA("ModuleScript") then
				start(m)
			end
		end
	end
end

-- when the server switches scenario, rebuild the client world from the new data
ctx.signals.event:Connect(function(e)
	if e.kind == "town" and e.x then
		-- the ground's relief is centred on the town (LabConfig.groundAt; the server built it)
		LabConfig.groundCentre = { x = e.x, y = e.y }
	end
	if e.kind == "scenario" then
		local d = scenarioData(e.scenario, e.data)
		local fresh = ClientWorld.new(d)
		for k, v in fresh do
			cw[k] = v
		end
		ctx.scenario = e.scenario
		ctx.scenarioData = d
		ctx.source = e.source or ctx.source
		ctx.signals.scenario:Fire(e.scenario)
	end
end)

RunService.RenderStepped:Connect(function(dt)
	if ctx.flashField then
		ctx.Tornado.FlashField.step(ctx.flashField, os.clock())
	end
	-- per-module cost (smoothed), shown in the F4 counters as ClientModuleMs (the biggest first)
	local now = os.clock()
	if now - (ctx.msShownAt or 0) > 0.5 then
		ctx.msShownAt = now
		local list, total = {}, 0
		for _, r in running do
			if r.ms then
				table.insert(list, r)
				total += r.ms
			end
		end
		table.sort(list, function(a, b)
			return a.ms > b.ms
		end)
		local parts = {}
		for i = 1, math.min(6, #list) do
			table.insert(parts, string.format("%s %.1f", list[i].name, list[i].ms))
		end
		ctx.root:SetAttribute("ClientModuleMs", string.format("scripts %.1f ms: ", total) .. table.concat(parts, " · "))
	end
	do
		local ok, err = pcall(ctx.tornadoAdapter.update, ctx.tornadoAdapter, dt)
		if not ok then
			warn("[StormLab] tornado adapter: " .. tostring(err))
		end
	end
	for _, r in running do
		if not r.off and r.obj.update then
			local t0 = os.clock()
			local ok, err = pcall(r.obj.update, r.obj, dt)
			r.ms = (r.ms or 0) * 0.9 + (os.clock() - t0) * 1000 * 0.1
			if not ok then
				r.errors += 1
				warn(string.format("[StormLab] %s.update: %s", r.name, tostring(err)))
				if r.errors >= 5 then
					r.off = true
					warn("[StormLab] " .. r.name .. " switched off after repeated errors")
				end
			end
		end
	end
	-- last: the near-field VFX re-draws the cards the renderers just wrote (Render/NearVfx)
	local nv = ctx.nearVfx
	if nv and not nv.broken then
		local ok, err = pcall(nv.post, nv, dt)
		if not ok then
			nv.broken = true
			warn("[StormLab] NearVfx.post: " .. tostring(err))
		end
	end
end)

print(string.format("[StormLab] client ready: scenario %s, %d modules", info.scenario, #running))
local _ = Players
