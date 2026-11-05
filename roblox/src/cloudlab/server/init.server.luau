--!strict
-- Cloud Lab server: runs the cloud model and sends each step's snapshot to the clients. Two modes:
--   the Weisman-Klemp supercell case (CloudLabScenario empty), or
--   an engine storm (CloudLabScenario = a module in ServerStorage.CloudLabData, exported by
--   scripts/export-lab-scenario.mjs, e.g. "SupercellLife"): EngineRun replays the engine's track
--   as the live game will get it from /api/game/v1/lab/storms?inflow=1, and the model shows that
--   storm from initiation to decay (CloudLabEngine shows the engine's side). One model step is spread over several frames (model.yieldFn) within a
-- per-frame budget, so the game keeps running while the model works.
--
-- Workspace attributes (set them in Studio while it runs):
--   CloudLabBudgetMs  model time per frame (ms), default 12
--   CloudLabPaused    true to pause
--   CloudLabRestart   set true to start over (it resets itself)
--   CloudLabNestStart model minute the 250 m nest starts under the storm's low-level circulation
--                     (default 30, about when the storm splits; negative = no nests). It then
--                     follows the circulation by itself.
--   CloudLabFineStart 50 m vorticity (1/s) in the 250 m nest at which the 62.5 m nest starts on
--                     it (default 0.04; negative = no fine nest)
--   CloudLabScenario  "" for the WK82 case, or an engine scenario's name (set it, then restart)
--   CloudLabLive      true: the engine's own storms, live (LiveFeed.server.luau), and this model idle
-- Nests take fewer steps than their spacing ratio (2 and 4 per parent step: the wind still
-- moves under a cell a step) and the fine nest is 2 km across - 4x cheaper, same results.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local Folder = ReplicatedStorage:WaitForChild("CloudLab")
local ModelDir = Folder:WaitForChild("Model")
local CloudModel = require(ModelDir:WaitForChild("CloudModel")) :: any
local Sounding = require(ModelDir:WaitForChild("Sounding")) :: any
local Snapshot = require(ModelDir:WaitForChild("Snapshot")) :: any
local Nest = require(ModelDir:WaitForChild("Nest")) :: any
local EngineRun = require(ModelDir:WaitForChild("EngineRun")) :: any
local HttpService = game:GetService("HttpService")
local DataDir = game:GetService("ServerStorage"):WaitForChild("CloudLabData")

local remote = Instance.new("RemoteEvent")
remote.Name = "Snapshot"
remote.Parent = Folder
local nestRemote = Instance.new("RemoteEvent")
nestRemote.Name = "NestSnapshot"
nestRemote.Parent = Folder
local fineRemote = Instance.new("RemoteEvent")
fineRemote.Name = "FineSnapshot"
fineRemote.Parent = Folder

workspace:SetAttribute("CloudLabBudgetMs", workspace:GetAttribute("CloudLabBudgetMs") or 12)
workspace:SetAttribute("CloudLabPaused", false)
workspace:SetAttribute("CloudLabRestart", false)
workspace:SetAttribute("CloudLabNestStart", workspace:GetAttribute("CloudLabNestStart") or 30)
workspace:SetAttribute("CloudLabFineStart", workspace:GetAttribute("CloudLabFineStart") or 0.04)
workspace:SetAttribute("CloudLabScenario", workspace:GetAttribute("CloudLabScenario") or "SupercellLife")

local CONFIG = {
	nx = 64, ny = 64, dx = 1000,
	dzmin = 100, dzmax = 700, stretch = 1.12, ztop = 16000,
	dt = 6, cs = 150, K = 75,
	umove = 13.6, vmove = 2.1, -- (the right-mover's own motion, measured in the offline test)
	z0 = 0.1, follow = false, -- (Nest.step does the following, so the nest moves with the grid)
}

local run: any = nil -- the engine storm being shown (engine mode)
local function newModel()
	run = nil
	local name = workspace:GetAttribute("CloudLabScenario") :: string? or ""
	local mod = if name ~= "" then DataDir:FindFirstChild(name) else nil
	if mod then
		local data = HttpService:JSONDecode((require :: any)(mod))
		-- (EngineRun keeps its own 250 m nest; the 62.5 m nest can still start in it)
		run = EngineRun.fromScenario(data, { nest = (workspace:GetAttribute("CloudLabNestStart") :: number? or 30) >= 0 })
		return run.model
	end
	local m = CloudModel.new(CONFIG, Sounding.wk82())
	local L = CONFIG.nx * CONFIG.dx
	m:bubble(0.5 * L, 0.45 * L, 1400, 10000, 1400, 2)
	return m
end

local model = newModel()
local nest: any = nil
local fine: any = nil
local frameStart = os.clock()
RunService.Heartbeat:Connect(function()
	frameStart = os.clock()
end)
local function yieldFn()
	local budget = (workspace:GetAttribute("CloudLabBudgetMs") :: number? or 12) / 1000
	if os.clock() - frameStart > budget then
		RunService.Heartbeat:Wait()
	end
end
model.yieldFn = yieldFn

local latest: buffer? = nil
game:GetService("Players").PlayerAdded:Connect(function(p)
	if latest then
		remote:FireClient(p, latest)
	end
end)

task.spawn(function()
	while true do
		if workspace:GetAttribute("CloudLabRestart") then
			workspace:SetAttribute("CloudLabRestart", false)
			model = newModel()
			model.yieldFn = yieldFn
			nest, fine = nil, nil
		end
		-- (live mode, LiveFeed.server.luau: the engine's storms are shown instead, and this model waits)
		if workspace:GetAttribute("CloudLabPaused") or workspace:GetAttribute("CloudLabLive") then
			RunService.Heartbeat:Wait()
		else
			local t0 = os.clock()
			local nestStart = workspace:GetAttribute("CloudLabNestStart") :: number? or 30
			if run then
				nest = run.nest
				if nest then
					nest.yieldFn = yieldFn
				end
			elseif not nest and nestStart >= 0 and model.time >= nestStart * 60 then
				local i0, j0 = Nest.place(model, 48, 4)
				nest = Nest.new(model, { nx = 48, ny = 48, ratio = 4, steps = 2, i0 = i0, j0 = j0 })
				nest.yieldFn = yieldFn
			end
			-- (checked once a model minute)
			local fineStart = workspace:GetAttribute("CloudLabFineStart") :: number? or 0.04
			if nest and not fine and fineStart >= 0 and math.floor(model.time / 60) ~= math.floor((model.time - model.dt) / 60) then
				local d = Nest.diag(nest)
				if d.zeta >= fineStart then
					local i0 = math.clamp(d.i - 3, 3, nest.nx - 10)
					local j0 = math.clamp(d.j - 3, 3, nest.ny - 10)
					fine = Nest.new(nest, { nx = 32, ny = 32, ratio = 4, steps = 4, i0 = i0, j0 = j0, vortex = 0.03 })
					fine.yieldFn = yieldFn
				end
			end
			if run then
				run:replayStep()
				local e = run:trackNow()
				workspace:SetAttribute("CloudLabEngine", string.format("engine +%d min: intensity %.2f meso %.2f cold pool %.1f K%s%s", e.min, e.intensity, e.meso, e.coldPoolK or 0,
					if e.tornado then string.format(" TORNADO %d mph", e.tornado.mph) else "", if run.ended then " (ended)" else ""))
			else
				Nest.step(model, nest)
			end
			if nest then
				nestRemote:FireAllClients(Snapshot.packNest(nest))
			end
			if fine then
				fineRemote:FireAllClients(Snapshot.packNest(fine))
			end
			local snap = Snapshot.pack(model)
			latest = snap
			remote:FireAllClients(snap)
			workspace:SetAttribute("CloudLabTime", math.floor(model.time))
			workspace:SetAttribute("CloudLabStepWall", math.floor((os.clock() - t0) * 1000))
			RunService.Heartbeat:Wait()
		end
	end
end)
