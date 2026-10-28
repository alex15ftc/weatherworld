--!nonstrict
-- The storm lab client's shared context: one table every renderer and panel receives.
--   ctx.cw          ClientWorld (shared/Sim/ClientWorld): the mirror of the server's atmosphere.
--                   cw:windAt(x, y, z [, noTornado]) is the SAME wind field the server uses.
--                   cw.storms (Storm snapshots), cw.tornadoes (Tornado snapshots + .params),
--                   cw.systemsSnap / cw.systems, cw.boundaries, cw.vol (precip volume:
--                   vol:sample(x, y, z) -> dBZ, hail share), cw.coldPool, cw.env, cw.time
--   ctx.Sim         the pure simulation modules (Vortex, Storm, Precip, Radar, Lightning, Noise,
--                   Debris, Thermo, Damage, Systems, Environment, ColdPool)
--   ctx.Config      LabConfig (toWorld / fromWorld, TEXTURES, LIMITS...)
--   ctx.state       panel state: show.<layer> booleans, timeScale, paused, focus, windHeight...
--   ctx.signals     Signal objects: snapshot, tornado, profiles, coldPool, precip, flash, event
--   ctx.root        a Folder under the camera for client-only visuals (not physics-simulated)
--   ctx.ui          the lab's ScreenGui (put your own frames in it)
--   ctx.camera      Workspace.CurrentCamera
--   ctx:simCamera() -> x, y, z  the camera position in simulation metres
--   ctx:simTime()   -> the client's simulation time (server time + elapsed x time scale)
--   ctx:focus()     -> x, y, kind, id  of what the lab is following (tornado or storm)
--   ctx:command(t)  sends { cmd = ..., ... } to the server
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Workspace = game:GetService("Workspace")

local Context = {}
Context.__index = Context

-- a tiny signal
local Signal = {}
Signal.__index = Signal
function Signal.new()
	return setmetatable({ handlers = {} }, Signal)
end
function Signal:Connect(fn)
	table.insert(self.handlers, fn)
	local handlers = self.handlers
	return {
		Disconnect = function()
			local i = table.find(handlers, fn)
			if i then
				table.remove(handlers, i)
			end
		end,
	}
end
function Signal:Fire(...)
	for _, fn in table.clone(self.handlers) do
		local ok, err = pcall(fn, ...)
		if not ok then
			warn("[StormLab] signal handler: " .. tostring(err))
		end
	end
end
Context.Signal = Signal

function Context.new(cw: any): any
	local lab = ReplicatedStorage:WaitForChild("StormLab")
	local simFolder = lab:WaitForChild("Sim")
	local Sim = {}
	for _, m in simFolder:GetChildren() do
		if m:IsA("ModuleScript") then
			Sim[m.Name] = require(m)
		end
	end
	-- the tornado visual helpers (client/Tornado: not renderers, required by them)
	local Tornado = {}
	local tf = script.Parent:FindFirstChild("Tornado")
	if tf then
		for _, m in tf:GetChildren() do
			if m:IsA("ModuleScript") then
				Tornado[m.Name] = require(m)
			end
		end
	end
	local camera = Workspace.CurrentCamera
	local root = Instance.new("Folder")
	root.Name = "StormLabVisuals"
	root.Parent = camera
	local ui = Instance.new("ScreenGui")
	ui.Name = "StormLab"
	ui.ResetOnSpawn = false
	ui.IgnoreGuiInset = true
	ui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
	ui.Parent = Players.LocalPlayer:WaitForChild("PlayerGui")
	local self = setmetatable({
		cw = cw,
		Sim = Sim,
		Tornado = Tornado,
		flashField = if Tornado.FlashField then Tornado.FlashField.new(Sim.Noise) else nil,
		Config = require(lab:WaitForChild("LabConfig")),
		state = {
			timeScale = 1,
			paused = false,
			show = {
				funnel = true, dust = true, debris = true, clouds = true, rain = true, lightning = true,
				sky = true, radar = false, map = false, wind = false, labels = true,
			},
			windHeight = 10,
			focusKind = "tornado", -- "tornado" | "storm" | "free"
			clockOverride = nil, -- local solar hour: a VISUAL-only clock for tests (night); physics keeps the sim clock
			moonlight = 0, -- 0 dark night .. 1 bright moon (visual)
			cameraPreset = nil, -- { dist, yaw (deg), height, dollyTo, dollyTime } applied by CameraRig
			debug = {}, -- tornado visual debug views (UI/VisualTests)
			quality = 1, -- 0.5 low .. 1 full: secondary layers go first
			focusId = nil,
			radarSite = nil, -- {x, y} sim metres: set by UI/Map (Shift+click) and UI/Radar
		},
		signals = {
			snapshot = Signal.new(), tornado = Signal.new(), profiles = Signal.new(), coldPool = Signal.new(),
			precip = Signal.new(), flash = Signal.new(), event = Signal.new(), scenario = Signal.new(),
		},
		root = root,
		ui = ui,
		camera = camera,
		clockAt = os.clock(),
		serverTime = 0,
		net = nil,
	}, Context)
	return self
end

function Context:simCamera(): (number, number, number)
	return self.Config.fromWorld(self.camera.CFrame.Position)
end

function Context:simTime(): number
	if self.state.paused then
		return self.serverTime
	end
	return self.serverTime + (os.clock() - self.clockAt) * self.state.timeScale
end

-- The clock for local motion - a tornado's spin, dust, debris, scud, cloud boiling - as against
-- where storms are (simTime). The lab: the same as the sim clock (state.visualScale unset). The
-- game runs its weather at 12x but draws local motion at real speed (state.visualScale = 1):
-- a tornado spun or dust blown at 12x reads as a fast-forward.
function Context:visualScale(): number
	return self.state.visualScale or self.state.timeScale or 1
end

function Context:visualTime(): number
	if self.state.visualScale == nil then
		return self:simTime()
	end
	return os.clock() * self.state.visualScale
end

function Context:visualDt(dt: number): number
	if self.state.paused then
		return 0
	end
	return dt * self:visualScale()
end

function Context:noteServerTime(t: number)
	self.serverTime = t
	self.clockAt = os.clock()
end

-- what the lab follows: the chosen tornado/storm, else the strongest tornado, else the most
-- intense storm
function Context:focus(): (number, number, string, string?)
	local cw = self.cw
	local st = self.state
	if st.focusKind ~= "storm" then
		local best, bestV = nil, -1
		for _, t in cw.tornadoes do
			if not t.ended then
				if t.id == st.focusId then
					best = t
					break
				end
				if t.vc > bestV then
					best, bestV = t, t.vc
				end
			end
		end
		if best then
			return best.x, best.y, "tornado", best.id
		end
	end
	local best, bestW = nil, -1
	for _, s in cw.storms do
		if not s.dead then
			if s.id == st.focusId then
				best = s
				break
			end
			local score = s.W * (1 + s.rot)
			if score > bestW then
				best, bestW = s, score
			end
		end
	end
	if best then
		return best.x, best.y, "storm", best.id
	end
	return 0, 0, "none", nil
end

function Context:command(t: { [string]: any })
	if self.net then
		self.net.command:FireServer(t)
	end
end

return Context
