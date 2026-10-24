--!nonstrict
-- The lab camera (no character):
--   chase  (default) a ground observer (eye height 2 m) at a distance from the focus, keeping it
--          framed as it moves: what a storm chaser sees. Right-drag / arrow keys move round it,
--          the wheel changes the distance.
--   orbit  round the focus at any height and angle (right-drag, wheel).
--   free   fly: WASD, E/Q up/down, Shift faster, right-drag to look, wheel changes speed.
-- C cycles the modes; Tab cycles the focus (tornadoes first, then storms).
local ContextActionService = game:GetService("ContextActionService")
local UserInputService = game:GetService("UserInputService")

local CameraRig = {}

local MODES = { "chase", "orbit", "free" }

function CameraRig.new(ctx: any): any
	local C = ctx.Config
	local cam = ctx.camera
	cam.CameraType = Enum.CameraType.Scriptable
	cam.FieldOfView = 70
	local self = {
		mode = "chase",
		yaw = math.rad(-50), -- bearing of the camera FROM the focus (radians, from east toward north): south-east, the inflow side
		pitch = math.rad(12),
		dist = 900,
		target = nil,
		free = { pos = Vector3.new(0, 30, 0), yaw = 0, pitch = 0, speed = 60 },
		dragging = false,
		lastKind = nil,
	}
	ctx.state.cameraMode = self.mode

	local keys = {}
	UserInputService.InputBegan:Connect(function(input, processed)
		if UserInputService:GetFocusedTextBox() then
			return
		end
		if input.UserInputType == Enum.UserInputType.MouseButton2 and not processed then
			self.dragging = true
			UserInputService.MouseBehavior = Enum.MouseBehavior.LockCurrentPosition
		end
		if processed then
			return
		end
		keys[input.KeyCode] = true
		if input.KeyCode == Enum.KeyCode.C then
			local i = table.find(MODES, self.mode) or 1
			self.mode = MODES[i % #MODES + 1]
			ctx.state.cameraMode = self.mode
			if self.mode == "free" then
				local cf = cam.CFrame
				self.free.pos = cf.Position
				local look = cf.LookVector
				self.free.yaw = math.atan2(-look.X, -look.Z)
				self.free.pitch = math.asin(math.clamp(look.Y, -1, 1))
			end
		elseif input.KeyCode == Enum.KeyCode.Tab then
			-- next focus: tornadoes first, then storms by strength
			local list = {}
			for _, t in ctx.cw.tornadoes do
				if not t.ended then
					table.insert(list, { "tornado", t.id })
				end
			end
			local storms = {}
			for _, s in ctx.cw.storms do
				if not s.dead then
					table.insert(storms, s)
				end
			end
			table.sort(storms, function(a, b)
				return a.W * (1 + a.rot) > b.W * (1 + b.rot)
			end)
			for _, s in storms do
				table.insert(list, { "storm", s.id })
			end
			local cur = 0
			for i, e in list do
				if e[2] == ctx.state.focusId then
					cur = i
				end
			end
			local nxt = list[cur % math.max(1, #list) + 1]
			if nxt then
				ctx.state.focusKind, ctx.state.focusId = nxt[1], nxt[2]
			end
		end
	end)
	UserInputService.InputEnded:Connect(function(input)
		keys[input.KeyCode] = nil
		if input.UserInputType == Enum.UserInputType.MouseButton2 then
			self.dragging = false
			UserInputService.MouseBehavior = Enum.MouseBehavior.Default
		end
	end)
	UserInputService.InputChanged:Connect(function(input, processed)
		if input.UserInputType == Enum.UserInputType.MouseMovement and self.dragging then
			local d = input.Delta
			if self.mode == "free" then
				self.free.yaw -= d.X * 0.004
				self.free.pitch = math.clamp(self.free.pitch - d.Y * 0.004, -1.55, 1.55)
			else
				self.yaw -= d.X * 0.005
				self.pitch = math.clamp(self.pitch + d.Y * 0.004, math.rad(-5), math.rad(85))
			end
		elseif input.UserInputType == Enum.UserInputType.MouseWheel and not processed then
			local z = input.Position.Z
			if self.mode == "free" then
				self.free.speed = math.clamp(self.free.speed * (if z > 0 then 1.25 else 0.8), 5, 4000)
			else
				self.dist = math.clamp(self.dist * (if z > 0 then 0.85 else 1.18), 60, 90000)
			end
		end
	end)
	-- keep the arrow keys from moving anything else
	ContextActionService:BindAction("StormLabCameraSink", function()
		return Enum.ContextActionResult.Pass
	end, false, Enum.KeyCode.Up)

	local function focusInfo(): (number, number, number, string)
		local x, y, kind, id = ctx:focus()
		local lookZ = 300
		if kind == "tornado" then
			for _, t in ctx.cw.tornadoes do
				if t.id == id then
					lookZ = math.max(60, t.cloudBase * 0.45)
				end
			end
		elseif kind == "storm" then
			for _, s in ctx.cw.storms do
				if s.id == id then
					lookZ = s.base + 1500
				end
			end
		end
		return x, y, lookZ, kind
	end

	-- a scripted shot (UI/VisualTests): { dist, yaw (deg), height, dollyTo, dollyTime }
	local function applyPreset(dt: number)
		local p = ctx.state.cameraPreset
		if not p then
			return
		end
		if not p.applied then
			p.applied = true
			p.started = os.clock()
			self.mode = p.mode or "chase"
			ctx.state.cameraMode = self.mode
			self.dist = p.dist or self.dist
			self.yaw = math.rad(p.yaw or -50)
			self.pitch = math.rad(p.pitch or 12)
			self.lastKind = "tornado"
			self.target = nil
		end
		if p.dollyTo and p.dollyTime then
			local f = math.clamp((os.clock() - p.started) / p.dollyTime, 0, 1)
			self.dist = p.dist * (p.dollyTo / p.dist) ^ f -- (geometric: even through the LOD ranges)
		end
	end

	function self:update(dt: number)
		local x, y, lookZ, kind = focusInfo()
		applyPreset(dt)
		if kind ~= self.lastKind then
			-- a sensible distance for what we look at
			if kind == "storm" then
				self.dist = math.max(self.dist, 18000)
			elseif kind == "tornado" and self.dist > 6000 then
				self.dist = 900
			end
			self.lastKind = kind
		end
		-- smooth the focus point (it moves and switches)
		local tgt = Vector3.new(x, y, lookZ)
		if not self.target or (self.target - tgt).Magnitude > 40000 then
			self.target = tgt
		end
		self.target = self.target:Lerp(tgt, 1 - math.exp(-dt * 3))
		local fx, fy, fz = self.target.X, self.target.Y, self.target.Z
		-- arrow keys turn round the focus
		if keys[Enum.KeyCode.Left] then
			self.yaw += dt * 0.8
		end
		if keys[Enum.KeyCode.Right] then
			self.yaw -= dt * 0.8
		end
		if self.mode == "chase" then
			local cx = fx + math.cos(self.yaw) * self.dist
			local cy = fy + math.sin(self.yaw) * self.dist
			local eye = C.toWorld(cx, cy, 2 + self.dist * 0.002)
			cam.CFrame = CFrame.lookAt(eye, C.toWorld(fx, fy, fz))
		elseif self.mode == "orbit" then
			local h = self.dist * math.sin(self.pitch)
			local r = self.dist * math.cos(self.pitch)
			local cx = fx + math.cos(self.yaw) * r
			local cy = fy + math.sin(self.yaw) * r
			local eye = C.toWorld(cx, cy, math.max(3, fz + h))
			cam.CFrame = CFrame.lookAt(eye, C.toWorld(fx, fy, fz))
		else
			local f = self.free
			local rot = CFrame.fromEulerAnglesYXZ(f.pitch, f.yaw, 0)
			local move = Vector3.zero
			if keys[Enum.KeyCode.W] then
				move += rot.LookVector
			end
			if keys[Enum.KeyCode.S] then
				move -= rot.LookVector
			end
			if keys[Enum.KeyCode.D] then
				move += rot.RightVector
			end
			if keys[Enum.KeyCode.A] then
				move -= rot.RightVector
			end
			if keys[Enum.KeyCode.E] then
				move += Vector3.yAxis
			end
			if keys[Enum.KeyCode.Q] then
				move -= Vector3.yAxis
			end
			local sp = f.speed * (if keys[Enum.KeyCode.LeftShift] then 6 else 1)
			if move.Magnitude > 0 then
				f.pos += move.Unit * sp * dt
			end
			f.pos = Vector3.new(f.pos.X, math.max(1.5, f.pos.Y), f.pos.Z)
			cam.CFrame = CFrame.new(f.pos) * rot
		end
	end

	return self
end

return CameraRig
