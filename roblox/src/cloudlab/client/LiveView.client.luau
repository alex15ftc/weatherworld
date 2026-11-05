--!strict
-- Live mode's client (server/LiveFeed.server.luau): the engine's storms drawn on the lab's tabletop
-- (the same scale as the lab's own view, init.client.luau: 1 km = 100 studs) straight from their
-- client frames, with the barebones boxes of shared/Model/FrameView.luau (what is drawn, and how
-- a storm moves between frames, is explained there).
if workspace:GetAttribute("CloudLabLive") ~= true then return end

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local EncodingService = game:GetService("EncodingService")
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")

local Folder = ReplicatedStorage:WaitForChild("CloudLab")
local Model = Folder:WaitForChild("Model")
local ClientFrame = require(Model:WaitForChild("ClientFrame")) :: any
local FrameView = require(Model:WaitForChild("FrameView")) :: any
local remote = Folder:WaitForChild("LiveFrame") :: RemoteEvent

local SCALE = 0.1 -- studs per metre, across and up

local root = Instance.new("Folder")
root.Name = "CloudLabLive"
root.Parent = workspace

type View = { view: any, folder: Folder, text: string }
local views: { [string]: View } = {}

-- The HUD.
local gui = Instance.new("ScreenGui")
gui.Name = "CloudLabLiveHud"
gui.ResetOnSpawn = false
local label = Instance.new("TextLabel")
label.Size = UDim2.fromOffset(720, 140)
label.Position = UDim2.fromOffset(12, 12)
label.BackgroundTransparency = 0.4
label.BackgroundColor3 = Color3.new(0, 0, 0)
label.TextColor3 = Color3.new(1, 1, 1)
label.TextXAlignment = Enum.TextXAlignment.Left
label.TextYAlignment = Enum.TextYAlignment.Top
label.Font = Enum.Font.Code
label.TextSize = 14
label.Text = "Cloud Lab live: waiting for frames..."
label.Parent = gui
gui.Parent = Players.LocalPlayer:WaitForChild("PlayerGui")
local received = 0
local function refresh()
	local lines = { "Cloud Lab live  " .. tostring(workspace:GetAttribute("CloudLabLiveStatus") or ""), ("received %.1f KB"):format(received / 1024) }
	for _, v in views do table.insert(lines, v.text) end
	label.Text = table.concat(lines, "\n")
end
workspace:GetAttributeChangedSignal("CloudLabLiveStatus"):Connect(refresh)

RunService.RenderStepped:Connect(function()
	for _, v in views do v.view:place(0) end
end)

remote.OnClientEvent:Connect(function(kind: string, id: string, east: number?, north: number?, frame: buffer?, near: boolean?, ue: number?, ve: number?)
	if kind == "gone" then
		local v = views[id]
		if v then v.folder:Destroy(); views[id] = nil end
	elseif kind == "frame" and frame and east and north then
		received += buffer.len(frame)
		local ok, err = pcall(function()
			local f = ClientFrame.decode(EncodingService:DecompressBuffer(frame, Enum.CompressionAlgorithm.Zstd))
			local v = views[id]
			if not v then
				local folder = Instance.new("Folder")
				folder.Name = id
				folder.Parent = root
				v = { view = FrameView.new(folder, { hScale = SCALE, vScale = SCALE }), folder = folder, text = "" }
				views[id] = v
			end
			local view = (v :: View).view
			view:setAnchor(east * SCALE, -north * SCALE, (ue or 0) * SCALE, -(ve or 0) * SCALE)
			;(v :: View).text = id .. "  " .. view:draw(f, near == true)
		end)
		if not ok then warn("[LiveView] " .. tostring(err)) end
	end
	refresh()
end)
