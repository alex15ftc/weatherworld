--!strict
-- The lab camera, in two modes (C switches):
--
-- Chaser (default): stands `distance` studs from the tornado at `eyeHeight` and aims at a point
-- `lookHeight` up the funnel (like a chaser in a field). Settings live in LabConfig.camera.
--   right-drag / one-finger drag: go round (sideways), aim up and down (vertical)
--   wheel / pinch / W S: nearer, further      A D: go round      R F: aim up, down
--   Q E: eye lower, higher                    Z X: zoom lens in, out
--
-- Free: fly anywhere, starting from where the chaser camera was.
--   right-drag or arrow keys: look round      W A S D: fly       E Q: up, down
--   V: mouse-look on/off (the mouse turns the view without holding a button)
--   Shift: fast                               wheel: flying speed       Z X: zoom lens
local RunService = game:GetService("RunService")
local UserInputService = game:GetService("UserInputService")
local Workspace = game:GetService("Workspace")

local CameraRig = {}

function CameraRig.start(settings: any, getCentre: () -> Vector3)
	local camera = Workspace.CurrentCamera
	camera.CameraType = Enum.CameraType.Scriptable

	-- free mode state
	local free = false
	local freePos = Vector3.zero
	local freeYaw, freePitch = 0, 0
	local freeSpeed = 120 -- studs/s
	local mouseLook = false
	local PITCH = math.rad(89.5) -- look straight up or down, short of flipping over

	local function enterFree()
		local cf = camera.CFrame
		freePos = cf.Position
		local look = cf.LookVector
		freeYaw = math.atan2(-look.X, -look.Z)
		freePitch = math.asin(math.clamp(look.Y, -1, 1))
		free = true
	end

	local dragging = false
	UserInputService.InputBegan:Connect(function(input, processed)
		if input.UserInputType == Enum.UserInputType.MouseButton2 then
			dragging = true
			return
		end
		if processed or UserInputService:GetFocusedTextBox() then
			return
		end
		if input.KeyCode == Enum.KeyCode.C then
			if free then
				free = false
				mouseLook = false
				UserInputService.MouseBehavior = Enum.MouseBehavior.Default
			else
				enterFree()
			end
			print("[TornadoLab] camera: " .. (if free then "free" else "chaser"))
		elseif input.KeyCode == Enum.KeyCode.V and free then
			mouseLook = not mouseLook
			if not mouseLook then
				UserInputService.MouseBehavior = Enum.MouseBehavior.Default
			end
			print("[TornadoLab] mouse-look: " .. tostring(mouseLook))
		end
	end)
	UserInputService.InputEnded:Connect(function(input)
		if input.UserInputType == Enum.UserInputType.MouseButton2 then
			dragging = false
		end
	end)
	UserInputService.InputChanged:Connect(function(input, processed)
		if input.UserInputType == Enum.UserInputType.MouseMovement and (dragging or (free and mouseLook)) then
			if free then
				freeYaw -= input.Delta.X * 0.004
				freePitch = math.clamp(freePitch - input.Delta.Y * 0.004, -PITCH, PITCH)
			else
				settings.yaw = (settings.yaw - input.Delta.X * 0.25 + 180) % 360 - 180
				settings.lookHeight = math.max(0, settings.lookHeight - input.Delta.Y * settings.distance * 0.002)
			end
		elseif input.UserInputType == Enum.UserInputType.MouseWheel and not processed then
			if free then
				freeSpeed = math.clamp(freeSpeed * 1.2 ^ input.Position.Z, 5, 4000)
			else
				settings.distance = math.clamp(settings.distance * 0.9 ^ input.Position.Z, 30, 8000)
			end
		end
	end)
	UserInputService.TouchPan:Connect(function(_, translation, velocity, state, processed)
		if processed or state ~= Enum.UserInputState.Change then
			return
		end
		if free then
			freeYaw -= velocity.X * 0.00006
			freePitch = math.clamp(freePitch - velocity.Y * 0.00006, -PITCH, PITCH)
		else
			settings.yaw = (settings.yaw - velocity.X * 0.004 + 180) % 360 - 180
			settings.lookHeight = math.max(0, settings.lookHeight - velocity.Y * settings.distance * 0.00003)
		end
	end)
	local lastScale = 1
	UserInputService.TouchPinch:Connect(function(_, scale, _, state, processed)
		if processed then
			return
		end
		if state == Enum.UserInputState.Begin then
			lastScale = 1
		end
		settings.distance = math.clamp(settings.distance * lastScale / math.max(scale, 0.01), 30, 8000)
		lastScale = scale
	end)

	local function held(key: Enum.KeyCode): number
		if UserInputService:GetFocusedTextBox() then
			return 0
		end
		return if UserInputService:IsKeyDown(key) then 1 else 0
	end

	RunService:BindToRenderStep("LabCamera", Enum.RenderPriority.Camera.Value, function(dt)
		settings.fov = math.clamp(settings.fov + (held(Enum.KeyCode.X) - held(Enum.KeyCode.Z)) * 30 * dt, 10, 110)
		camera.FieldOfView = settings.fov
		if free then
			-- arrow keys turn the view (90 degrees a second)
			freeYaw += (held(Enum.KeyCode.Left) - held(Enum.KeyCode.Right)) * math.rad(90) * dt
			freePitch = math.clamp(freePitch + (held(Enum.KeyCode.Up) - held(Enum.KeyCode.Down)) * math.rad(90) * dt, -PITCH, PITCH)
			-- mouse-look keeps the cursor locked in the middle (Roblox resets it, so every frame)
			if mouseLook then
				UserInputService.MouseBehavior = Enum.MouseBehavior.LockCenter
			end
			local rot = CFrame.Angles(0, freeYaw, 0) * CFrame.Angles(freePitch, 0, 0)
			local move = Vector3.new(
				held(Enum.KeyCode.D) - held(Enum.KeyCode.A),
				held(Enum.KeyCode.E) - held(Enum.KeyCode.Q),
				held(Enum.KeyCode.S) - held(Enum.KeyCode.W)
			)
			if move.Magnitude > 0 then
				local fast = if held(Enum.KeyCode.LeftShift) + held(Enum.KeyCode.RightShift) > 0 then 4 else 1
				local world = rot:VectorToWorldSpace(Vector3.new(move.X, 0, move.Z)) + Vector3.new(0, move.Y, 0)
				freePos += world.Unit * freeSpeed * fast * dt
			end
			-- stay above the ground (the lab's ground is at y = 0)
			freePos = Vector3.new(freePos.X, math.max(freePos.Y, 2), freePos.Z)
			camera.CFrame = CFrame.new(freePos) * rot
			return
		end
		settings.distance = math.clamp(settings.distance * (1 + (held(Enum.KeyCode.S) - held(Enum.KeyCode.W)) * dt), 30, 80000) -- (storm mode stands kilometres back)
		settings.yaw = (settings.yaw + (held(Enum.KeyCode.D) - held(Enum.KeyCode.A)) * 40 * dt + 180) % 360 - 180
		settings.lookHeight = math.max(0, settings.lookHeight + (held(Enum.KeyCode.R) - held(Enum.KeyCode.F)) * settings.distance * 0.3 * dt)
		settings.eyeHeight = math.max(1, settings.eyeHeight * (1 + (held(Enum.KeyCode.E) - held(Enum.KeyCode.Q)) * 1.5 * dt))

		local centre = getCentre()
		local yaw = math.rad(settings.yaw)
		local eye = Vector3.new(
			centre.X + math.sin(yaw) * settings.distance,
			centre.Y + settings.eyeHeight,
			centre.Z + math.cos(yaw) * settings.distance
		)
		local aim = centre + Vector3.new(0, settings.lookHeight, 0)
		camera.CFrame = CFrame.lookAt(eye, aim)
	end)

	-- for the shot list: back to the chaser camera
	return {
		chaser = function()
			free = false
			mouseLook = false
			UserInputService.MouseBehavior = Enum.MouseBehavior.Default
		end,
	}
end

return CameraRig
