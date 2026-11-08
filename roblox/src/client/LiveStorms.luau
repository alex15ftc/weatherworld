--!strict
-- The cloud model's storms on this client (server/LiveStorms.luau sends them): each storm's newest
-- client frame (Shared.CloudModel.ClientFrame), unpacked, with where the storm is and how it moves.
-- This is the store the game's storm visuals will draw from (which visuals is still to be chosen):
--   LiveStorms.storms[id]  { frame, near, xKm, yKm (map km, y south, when it came), ue, ve (m a
--                          real second, east and north), at (os.clock), look (the engine's
--                          numbers, StormFrames.Look, its xKm/yKm when it came; or nil) }
--   LiveStorms.positionKm(id)  where the storm is now (moved on at its motion)
--   LiveStorms.changed     an event fired with the storm's id on each new frame, and on "gone"
--   LiveStorms.flash       an event fired with each list of the engine storms' flashes (map km,
--                          y south; heights m): { kind, seed, current, x0, y0, z0, x1, y1, z1 }
-- With workspace attribute LiveStormsDebug = true each storm is also drawn as plain grey boxes at
-- full scale (Shared.CloudModel.FrameView: cloud runs, rain shafts, the nest's lowest cloud), at
-- the sky's height scale for its distance (Config.skyScaleAt), with a line of numbers on screen.
-- Off unless workspace attribute LiveStorms = true (as the server).
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local EncodingService = game:GetService("EncodingService")
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")

local Config = require(ReplicatedStorage.Shared.World.Config)
local CloudModel = ReplicatedStorage.Shared:WaitForChild("CloudModel")
local ClientFrame = require(CloudModel:WaitForChild("ClientFrame")) :: any
local FrameView = require(CloudModel:WaitForChild("FrameView")) :: any

local LiveStorms = {}

export type Storm = { frame: any, near: boolean, xKm: number, yKm: number, ue: number, ve: number, at: number, look: any? }
LiveStorms.storms = {} :: { [string]: Storm }
local changed = Instance.new("BindableEvent")
LiveStorms.changed = changed.Event
local flash = Instance.new("BindableEvent")
LiveStorms.flash = flash.Event

local H = Config.STUDS_PER_MILE / (Config.KM_PER_MILE * 1000) -- studs per metre across

function LiveStorms.positionKm(id: string): (number?, number?)
	local s = LiveStorms.storms[id]
	if not s then return nil, nil end
	local age = os.clock() - s.at
	return s.xKm + s.ue * age / 1000, s.yKm - s.ve * age / 1000
end

-- map km (y south) -> studs (x, z)
local function studsAt(xKm: number, yKm: number): (number, number)
	local half = Config.MAP_MILES / 2
	return (xKm / Config.KM_PER_MILE - half) * Config.STUDS_PER_MILE, (yKm / Config.KM_PER_MILE - half) * Config.STUDS_PER_MILE
end

-- The debug drawing.
type Debug = { view: any, folder: Folder, text: string, groundY: number }
local debugViews: { [string]: Debug } = {}
local debugRoot: Folder? = nil
local label: TextLabel? = nil
local received = 0

local function groundAt(x: number, z: number): number
	local hit = workspace:Raycast(Vector3.new(x, 5000, z), Vector3.new(0, -10000, 0))
	return if hit then hit.Position.Y else 0
end

local function refreshLabel()
	if not label then return end
	local lines = { "Live storms  " .. tostring(workspace:GetAttribute("LiveStormsStatus") or ""), ("received %.1f KB"):format(received / 1024) }
	for _, d in debugViews do table.insert(lines, d.text) end
	label.Text = table.concat(lines, "\n")
end

local function drawDebug(id: string, s: Storm)
	if workspace:GetAttribute("LiveStormsDebug") ~= true then return end
	if not debugRoot then
		local root = Instance.new("Folder")
		root.Name = "LiveStormsDebug"
		root.Parent = workspace
		debugRoot = root
		local gui = Instance.new("ScreenGui")
		gui.Name = "LiveStormsDebugHud"
		gui.ResetOnSpawn = false
		local l = Instance.new("TextLabel")
		l.Size = UDim2.fromOffset(720, 110)
		l.Position = UDim2.new(0, 12, 1, -122)
		l.BackgroundTransparency = 0.4
		l.BackgroundColor3 = Color3.new(0, 0, 0)
		l.TextColor3 = Color3.new(1, 1, 1)
		l.TextXAlignment = Enum.TextXAlignment.Left
		l.TextYAlignment = Enum.TextYAlignment.Top
		l.Font = Enum.Font.Code
		l.TextSize = 14
		l.Parent = gui
		gui.Parent = Players.LocalPlayer:WaitForChild("PlayerGui")
		label = l
	end
	local d = debugViews[id]
	if not d then
		local folder = Instance.new("Folder")
		folder.Name = id
		folder.Parent = debugRoot
		d = { view = FrameView.new(folder, { hScale = H, vScale = Config.SKY_STUDS_PER_METRE }), folder = folder, text = "", groundY = 0 }
		debugViews[id] = d
	end
	local dv = d :: Debug
	local x, z = studsAt(s.xKm, s.yKm)
	local cam = workspace.CurrentCamera
	local dist = if cam then math.sqrt((cam.CFrame.Position.X - x) ^ 2 + (cam.CFrame.Position.Z - z) ^ 2) else 0
	dv.view.vScale = Config.skyScaleAt(dist)
	dv.view:setAnchor(x, z, s.ue * H, -s.ve * H)
	dv.groundY = groundAt(x, z)
	dv.text = ("%s  %.0f km away  %s"):format(id, dist / H / 1000, dv.view:draw(s.frame, s.near))
end

function LiveStorms.start()
	if workspace:GetAttribute("LiveStorms") ~= true then return end
	local remote = ReplicatedStorage:WaitForChild("LiveStormNet"):WaitForChild("Frame") :: RemoteEvent
	remote.OnClientEvent:Connect(function(kind: string, id: string, xKm: number?, yKm: number?, frame: buffer?, near: boolean?, ue: number?, ve: number?, look: any?)
		if kind == "flash" then
			flash:Fire(id :: any)
			return
		elseif kind == "gone" then
			LiveStorms.storms[id] = nil
			local d = debugViews[id]
			if d then d.folder:Destroy(); debugViews[id] = nil end
			changed:Fire(id)
		elseif kind == "frame" and frame and xKm and yKm then
			received += buffer.len(frame)
			if workspace:GetAttribute("EngineStormsDebugCam") == true then
				print(("[LiveStorms] frame %s %d bytes at %.1f, %.1f km"):format(id, buffer.len(frame), xKm, yKm))
			end
			local ok, err = pcall(function()
				local f = ClientFrame.decode(EncodingService:DecompressBuffer(frame, Enum.CompressionAlgorithm.Zstd))
				local s: Storm = { frame = f, near = near == true, xKm = xKm, yKm = yKm, ue = ue or 0, ve = ve or 0, at = os.clock(), look = look }
				LiveStorms.storms[id] = s
				drawDebug(id, s)
				changed:Fire(id)
			end)
			if not ok then warn("[LiveStorms] " .. tostring(err)) end
		end
		refreshLabel()
	end)
	workspace:GetAttributeChangedSignal("LiveStormsStatus"):Connect(refreshLabel)
	RunService.RenderStepped:Connect(function()
		for _, d in debugViews do d.view:place(d.groundY) end
	end)
end

return LiveStorms
