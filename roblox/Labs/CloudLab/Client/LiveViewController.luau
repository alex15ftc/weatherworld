--!strict
-- Live mode's client (LiveFeedService): the engine's storms drawn straight from their
-- client frames, with the barebones boxes of Shared/CloudModel/FrameView.luau (what is drawn, and how
-- a storm moves between frames, is explained there), at the live game's size (its own Config,
-- Shared/World/Config; as Client/Controllers/LiveStormsController.luau): across at the map's scale
-- (Config.STUDS_PER_MILE), up - and a tornado's widths - at the sky scale for the storm's distance
-- from the camera (Config.skyScaleAt: true scale near, 1 stud a metre far).
-- Workspace attribute CloudLabPuffs (true): the cloud body as lit billboard puffs instead
-- (Shared/CloudModel/PuffView.luau, visuals prototype 1), CloudLabPuffMax puffs a storm at most
-- (default 600); rain, the nest and the tornado stay FrameView's. The HUD shows the frame time.

local LiveViewController = {}

function LiveViewController.Start()
	if workspace:GetAttribute("CloudLabLive") ~= true then return end

	local ReplicatedStorage = game:GetService("ReplicatedStorage")
	local EncodingService = game:GetService("EncodingService")
	local Players = game:GetService("Players")
	local RunService = game:GetService("RunService")

	local Shared = ReplicatedStorage.Shared
	local CloudLabNet = require(Shared.Net.CloudLabNet)
	local Model = Shared.CloudModel
	local ClientFrame = require(Model.ClientFrame) :: any
	local FrameView = require(Model.FrameView) :: any
	local PuffView = require(Model.PuffView) :: any
	local MeshView = require(Model.MeshView) :: any -- (CloudLabMeshes true, with puffs: the body as stacked cloud meshes instead)
	local BaseView = require(Model.BaseView) :: any
	local TornadoView = require(Model.TornadoView) :: any
	local PUFFS = workspace:GetAttribute("CloudLabPuffs") == true
	-- CloudLabNoRain (false): FrameView's rain shafts left out (to see a tornado in the rain)
	-- CloudLabBaseSheet (false): the cloud base as one mesh sheet (Shared/CloudModel/BaseView.luau, visuals prototype 2)
	local BASE_SHEET = workspace:GetAttribute("CloudLabBaseSheet") == true
	-- CloudLabTornadoView (true, with puffs): the tornado as lit puffs from the frame's vortex
	-- (Shared/CloudModel/TornadoView.luau) instead of FrameView's debug cylinders
	local TORNADO_VIEW = PUFFS and workspace:GetAttribute("CloudLabTornadoView") ~= false
	local Config = require(Shared.World.Config) :: any
	local remote = CloudLabNet.LiveFrame:Client()

	local H = Config.STUDS_PER_MILE / (Config.KM_PER_MILE * 1000) -- studs per metre across

	local root = Instance.new("Folder")
	root.Name = "CloudLabLive"
	root.Parent = workspace

	type View = { view: any, puffs: any?, base: any?, tornado: any?, folder: Folder, text: string, x: number, z: number }
	local views: { [string]: View } = {}

	-- The HUD.
	local gui = Instance.new("ScreenGui")
	gui.Name = "CloudLabLiveHud"
	gui.ResetOnSpawn = false
	-- (sized to its text, small and faint so it hides as little sky as it can; H hides it)
	local label = Instance.new("TextLabel")
	label.AutomaticSize = Enum.AutomaticSize.XY
	label.Size = UDim2.fromOffset(0, 0)
	label.Position = UDim2.fromOffset(8, 8)
	label.BackgroundTransparency = 0.7
	label.BackgroundColor3 = Color3.new(0, 0, 0)
	label.TextColor3 = Color3.new(1, 1, 1)
	label.TextXAlignment = Enum.TextXAlignment.Left
	label.TextYAlignment = Enum.TextYAlignment.Top
	label.Font = Enum.Font.Code
	label.TextSize = 11
	label.Text = "Cloud Lab live: waiting for frames..."
	label.Parent = gui
	gui.Parent = Players.LocalPlayer:WaitForChild("PlayerGui")
	local received = 0
	local frameMs, frames, frameT = 0, 0, 0
	local function refresh()
		local lines = { "Cloud Lab live  " .. tostring(workspace:GetAttribute("CloudLabLiveStatus") or ""), ("received %.1f KB  |  frame %.1f ms (%.0f fps)"):format(received / 1024, frameMs, if frameMs > 0 then 1000 / frameMs else 0) }
		for _, v in views do table.insert(lines, v.text) end
		label.Text = table.concat(lines, "\n")
	end
	workspace:GetAttributeChangedSignal("CloudLabLiveStatus"):Connect(refresh)

	RunService.RenderStepped:Connect(function(dt)
		for _, v in views do
			v.view:place(0)
			if v.puffs then
				local ax, az = v.view:anchorAt(os.clock())
				v.puffs:place(ax, 0, az)
			end
			if v.base then
				local ax, az = v.view:anchorAt(os.clock())
				v.base:place(ax, 0, az)
			end
			if v.tornado then
				local ax, az = v.view:anchorAt(os.clock())
				v.tornado:place(ax, 0, az)
			end
		end
		-- the average frame time over each second
		frames += 1
		frameT += dt
		if frameT >= 1 then
			frameMs, frames, frameT = 1000 * frameT / frames, 0, 0
			refresh()
		end
	end)

	remote:On(function(kind: string, id: string, east: number?, north: number?, frame: buffer?, near: boolean?, ue: number?, ve: number?)
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
					v = { view = FrameView.new(folder, { hScale = H, vScale = Config.SKY_STUDS_PER_METRE, noClouds = PUFFS, noRain = workspace:GetAttribute("CloudLabNoRain") == true, noTornado = TORNADO_VIEW }), puffs = if PUFFS then (if workspace:GetAttribute("CloudLabMeshes") == true and MeshView.ready() then MeshView else PuffView).new(folder, { max = workspace:GetAttribute("CloudLabPuffMax") or 600, seed = (string.gsub(id, "~engine$", "")) }) else nil, base = if BASE_SHEET then BaseView.new(folder) else nil, tornado = if TORNADO_VIEW then TornadoView.new(folder, { max = workspace:GetAttribute("CloudLabTornadoMax") or 300, seed = (string.gsub(id, "~engine$", "")) }) else nil, folder = folder, text = "", x = 0, z = 0 }
					views[id] = v
				end
				local view = (v :: View).view
				local x, z = east * H, -north * H -- (east, north in metres from LiveFeed)
				local cam = workspace.CurrentCamera
				local dist = if cam then math.sqrt((cam.CFrame.Position.X - x) ^ 2 + (cam.CFrame.Position.Z - z) ^ 2) else 0
				view.vScale = Config.skyScaleAt(dist)
				view:setAnchor(x, z, (ue or 0) * H, -(ve or 0) * H)
				local puffText = if (v :: View).puffs then "\n  " .. (v :: View).puffs:draw(f, H, view.vScale) else ""
				-- (near storms only: the client's budget holds about 8 editable meshes, and a far storm's base can't be seen)
				if (v :: View).base then
					if near == true then
						local cx, cz = if cam then cam.CFrame.Position.X - x else 0, if cam then cam.CFrame.Position.Z - z else 0
						puffText ..= "\n  " .. (v :: View).base:draw(f, H, view.vScale, cx, cz)
					else
						(v :: View).base:clear()
					end
				end
				if (v :: View).tornado then
					local tt = (v :: View).tornado:draw(f, H, view.vScale)
					if tt ~= "" then puffText ..= "\n  " .. tt end
				end
				;(v :: View).text = ("%s  %.1f km from the camera, %.2f studs/m up  %s%s"):format(id, dist / H / 1000, view.vScale, view:draw(f, near == true), puffText)
			end)
			if not ok then warn("[LiveView] " .. tostring(err)) end
		end
		refresh()
	end)
	-- (listening: the server may send this client its frames now)
	CloudLabNet.Ready:Client():Fire("live")

	-- A close-up of a tornado (debug): T frames the nearest storm's tornado - its ground ring, drawn by
	-- FrameView - from CLOSE_STUDS away at a low angle, looking at LOOK_STUDS up, following it;
	-- Left/Right orbit, Up/Down zoom; T again gives the camera back. (Studs: at the true scale near,
	-- 3.57 a metre, a 25 m core is 90 studs across and a 500 m cloud base 1,800 up.) With no tornado it
	-- frames the nearest storm's anchor instead (the puff view's), from STORM_STUDS away, STORM_LOOK up.
	-- Q/E lower and raise the eye (down to GROUND_STUDS: from under the cloud base, looking up).
	local UserInputService = game:GetService("UserInputService")
	local CLOSE_STUDS, LOOK_STUDS, ORBIT_RAD_S, ZOOM_S = 2500, 400, 0.8, 1.5
	local STORM_STUDS, STORM_LOOK = 30000, 6000
	local GROUND_STUDS, RISE_S = 20, 0.4
	local closeUp, yaw, dist = false, 0, CLOSE_STUDS
	local rise = 0.15 -- the eye's height above the look point, a share of dist
	local lastKind = ""
	-- Y picks which storm T frames (each press the next, by id; the engine-built copies are "<id>~engine").
	local focusId: string? = nil
	local function focused(): { any }
		local ids = {}
		for id in views do table.insert(ids, id) end
		table.sort(ids)
		if focusId and views[focusId] then return { views[focusId] } end
		local out = {}
		for _, id in ids do table.insert(out, views[id]) end
		return out
	end
	local function tornadoAt(): (Vector3?, string)
		local list = focused()
		-- (a FrameView ring's Y is its own; the look height below is LOOK_STUDS unless the point gives one)
		for _, v in list do
			for _, p in v.folder:GetChildren() do
				if p.Name == "TornadoRing" and (p :: BasePart).Transparency < 1 then return (p :: BasePart).Position, "tornado" end
			end
			local tv = v.tornado
			if tv and tv.shape then
				local s = tv:eased(os.clock())
				-- (Y: where to look, half way up to the base)
				return tv.anchor.Position + Vector3.new(s.gx, 0.5 * math.max(s.Bt, 200) * s.V, s.gy), "tornado"
			end
		end
		for _, v in list do
			local a = v.folder:FindFirstChild("PuffAnchor") :: BasePart?
			if a then return a.Position, "storm" end
		end
		return nil, ""
	end
	UserInputService.InputBegan:Connect(function(input, processed)
		if not processed and input.KeyCode == Enum.KeyCode.H then gui.Enabled = not gui.Enabled end
		if not processed and input.KeyCode == Enum.KeyCode.Y then
			local ids = {}
			for id in views do table.insert(ids, id) end
			table.sort(ids)
			local at = table.find(ids, focusId or "") or 0
			focusId = ids[at % math.max(1, #ids) + 1]
			print("[cloudlab] T frames " .. tostring(focusId))
		end
		if processed or input.KeyCode ~= Enum.KeyCode.T then return end
		closeUp = not closeUp
		local cam = workspace.CurrentCamera
		cam.CameraType = if closeUp then Enum.CameraType.Scriptable else Enum.CameraType.Custom
	end)
	RunService.RenderStepped:Connect(function(dt)
		if not closeUp then return end
		local at, kind = tornadoAt()
		if not at then return end
		if kind ~= lastKind then
			lastKind = kind
			dist = if kind == "storm" then STORM_STUDS else CLOSE_STUDS
			rise = if kind == "storm" then 0.05 else 0.15
		end
		if UserInputService:IsKeyDown(Enum.KeyCode.Left) then yaw -= ORBIT_RAD_S * dt end
		if UserInputService:IsKeyDown(Enum.KeyCode.Right) then yaw += ORBIT_RAD_S * dt end
		if UserInputService:IsKeyDown(Enum.KeyCode.Up) then dist = math.max(100, dist / (ZOOM_S ^ dt)) end
		if UserInputService:IsKeyDown(Enum.KeyCode.Down) then dist = math.min(40000, dist * (ZOOM_S ^ dt)) end
		if UserInputService:IsKeyDown(Enum.KeyCode.Q) then rise -= RISE_S * dt end
		if UserInputService:IsKeyDown(Enum.KeyCode.E) then rise += RISE_S * dt end
		local look = Vector3.new(at.X, if kind == "storm" then STORM_LOOK elseif at.Y > LOOK_STUDS then at.Y else LOOK_STUDS, at.Z)
		rise = math.clamp(rise, (GROUND_STUDS - look.Y) / dist, 1)
		local eye = look + Vector3.new(math.sin(yaw) * dist, rise * dist, math.cos(yaw) * dist)
		workspace.CurrentCamera.CFrame = CFrame.lookAt(eye, look)
	end)
end

return LiveViewController
