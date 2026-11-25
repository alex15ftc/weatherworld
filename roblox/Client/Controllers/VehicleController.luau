--!strict
-- Drives the car you own (see VehicleService) and makes the engine-sim
-- synthesizer its engine.
--
-- Frame order (RunService.PreSimulation, before Roblox steps physics):
--   chassis:prepare      spherecast suspension, steering, contact kinematics
--   drivetrain controls  shift timing, auto box, clutch actuator, TCS
--   sim:update           engine-sim steps the engine at 10 kHz; after every
--                        step the drivetrain/tires step on the same crank
--   chassis:apply        averaged tire + suspension + aero forces -> Roblox
--
-- Controls (keyboard / gamepad):
--   W / Up / RT        throttle          S / Down / LT    brake (reverse when stopped, automatic)
--   A D / Left Right / left stick      steer
--   Space / A          handbrake         LeftShift / LB   clutch pedal
--   E / B   Q / X      shift up / down   N / DPadDown     Automatic -> Sequential -> Manual
--     Automatic   gears are automatic, through a torque converter where the car's config has
--                 one (else an automatic clutch); it waits in neutral for the throttle
--     Sequential  you shift (E/Q), the clutch is automatic with anti-stall
--     Manual      you shift AND work the clutch; shifting without the clutch
--                 grinds, and you can stall it. The pedal goes down fast and
--                 comes up over ~0.5 s when you let go, so tapping Shift slips it.
--   T / DPadLeft       traction + stability control on/off
--   L / L3             transfer case 2H -> 4H -> 4L (a car whose config has one)
--   DPadUp             ignition (it also cranks itself when you sit down, and on the throttle
--                      after a stall)            DPadRight      reset the car upright
--   X / Y / Select     get out (the seat's prompt gets you in)
--   (WeatherWorld 2026-11-14: no F, R, K, P, I or G on the keyboard - F flies, M is the map.)
--   A car that ends up on its side or roof and comes to rest is set back on its wheels.
--   Doors: click a door (Misc/FL, FR) to open or close it, on foot or seated.
--   V / View           camera: chase near/mid/far, driver, hood (CharacterController)
--   Gamepad rumbles on impacts.

local ContextActionService = game:GetService("ContextActionService")
local HapticService = game:GetService("HapticService")
local Players = game:GetService("Players")
local ReplicatedFirst = game:GetService("ReplicatedFirst")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local UserInputService = game:GetService("UserInputService")
local Workspace = game:GetService("Workspace")

local Modules = ReplicatedFirst:WaitForChild("Modules")
local State = require(Modules:WaitForChild("EngineAudioState"))
local Chassis = require(Modules:WaitForChild("Vehicle"):WaitForChild("Chassis"))
local Cockpit = require(Modules:WaitForChild("Vehicle"):WaitForChild("Cockpit"))
local CarAudio = require(Modules:WaitForChild("Vehicle"):WaitForChild("CarAudio"))
local VehicleConfigs = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("VehicleConfigs"))
local TireCompounds = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("TireCompounds"))

local VehicleController = {}

local player = Players.LocalPlayer

local chassis: Chassis.Chassis? = nil
local cockpit: Cockpit.Cockpit? = nil
local carAudio: CarAudio.CarAudio? = nil
local car: Model? = nil
local driving = false
local stepAccumulator = 0
local hookedSim: any = nil

-- driver inputs (smoothed pedals)
local throttlePedal = 0
local brakePedal = 0
local clutchPedal = 0
local CLUTCH_DOWN_RATE = 10 -- 1/s
local CLUTCH_UP_RATE = 2 -- 1/s (0.5 s to fully engage)
local Drivetrain = require(Modules:WaitForChild("Vehicle"):WaitForChild("Drivetrain"))
local MODES: { Drivetrain.Mode } = { "Automatic" :: Drivetrain.Mode, "Sequential" :: Drivetrain.Mode, "Manual" :: Drivetrain.Mode }
local reverseHold = 0
-- the brake actually applied (after the automatic's reverse swap), for the driver's right foot
local brakeShown = 0
local crankUntil = 0
local hud: { [string]: TextLabel } = {}
local lastImpactText = ""
local lastImpactTime = 0
local savedMassless: { [BasePart]: boolean } = {}
local rumble = 0 -- 0..1, decays each frame
local rumbleSent = 0
local RUMBLE_DECAY = 4 -- 1/s
local PAD = Enum.UserInputType.Gamepad1
-- Steering-wheel turns per road-wheel turn for a car whose config has no Cockpit section.
local DEFAULT_STEERING_RATIO = 15

---------------------------------------------------------------------------
-- Input
---------------------------------------------------------------------------

local function keyDown(...: Enum.KeyCode): boolean
	if UserInputService:GetFocusedTextBox() then
		return false
	end
	for _, k in { ... } do
		if UserInputService:IsKeyDown(k) then
			return true
		end
	end
	return false
end

local STICK_DEADZONE = 0.12
local TRIGGER_DEADZONE = 0.04
local STEER_EXPONENT = 1.4 -- >1 gives finer control near the centre

-- Removes the deadzone and rescales what's left back to 0..1, so the stick
-- doesn't jump to 12% steering the moment it leaves the deadzone.
local function deadzone(v: number, dz: number): number
	local a = math.abs(v)
	if a <= dz then
		return 0
	end
	return math.sign(v) * math.min(1, (a - dz) / (1 - dz))
end

local function usingGamepad(): boolean
	local t = UserInputService:GetLastInputType()
	return t.Name:sub(1, 7) == "Gamepad"
end

local function hint(keys: string, pad: string): string
	return if usingGamepad() then pad else keys
end

local function gamepadState(): (number, number, number, boolean, boolean)
	local steer, rt, lt = 0, 0, 0
	local handbrake, clutch = false, false
	if not UserInputService.GamepadEnabled or UserInputService:GetFocusedTextBox() then
		return steer, rt, lt, handbrake, clutch
	end
	for _, input in UserInputService:GetGamepadState(Enum.UserInputType.Gamepad1) do
		if input.KeyCode == Enum.KeyCode.Thumbstick1 then
			local x = deadzone(input.Position.X, STICK_DEADZONE)
			steer = -math.sign(x) * math.abs(x) ^ STEER_EXPONENT
		elseif input.KeyCode == Enum.KeyCode.ButtonR2 then
			rt = deadzone(input.Position.Z, TRIGGER_DEADZONE)
		elseif input.KeyCode == Enum.KeyCode.ButtonL2 then
			lt = deadzone(input.Position.Z, TRIGGER_DEADZONE)
		elseif input.KeyCode == Enum.KeyCode.ButtonA then
			handbrake = input.UserInputState == Enum.UserInputState.Begin
				or input.UserInputState == Enum.UserInputState.Change
		elseif input.KeyCode == Enum.KeyCode.ButtonL1 or input.KeyCode == Enum.KeyCode.ButtonR1 then
			if input.UserInputState == Enum.UserInputState.Begin or input.UserInputState == Enum.UserInputState.Change then
				clutch = true
			end
		end
	end
	return steer, rt, lt, handbrake, clutch
end

local function approach(x: number, target: number, up: number, down: number, dt: number): number
	if target > x then
		return math.min(target, x + up * dt)
	end
	return math.max(target, x - down * dt)
end

local function startCrank()
	local sim = State.Simulator
	if not sim then
		return
	end
	sim.engine.ignition = true
	crankUntil = os.clock() + 2.5
end

-- Auto-flip: on its side or roof (the body's up below FLIP_UP of the world's) and nearly
-- still (under FLIP_SPEED m/s) for FLIP_DELAY s.
local FLIP_UP = 0.35
local FLIP_SPEED = 3
local FLIP_DELAY = 1.5
local flipTimer = 0

local function onDriveAction(name: string, inputState: Enum.UserInputState, _input: InputObject): Enum.ContextActionResult
	if not driving or not chassis or State.InputCaptured then
		return Enum.ContextActionResult.Pass
	end
	if inputState ~= Enum.UserInputState.Begin then
		return Enum.ContextActionResult.Sink
	end
	local c = chassis
	local dt = c.drivetrain
	local sim = State.Simulator

	if name == "VehShiftUp" or name == "VehShiftDown" then
		if not dt.automatic then
			local ok, reason = dt:shift((dt.pendingGear or dt.gear) + (if name == "VehShiftUp" then 1 else -1))
			if not ok then
				State.LastMessage = reason or "Can't shift"
			end
		end
	elseif name == "VehMode" then
		local i = table.find(MODES, dt.mode) or 1
		local mode = MODES[i % #MODES + 1]
		dt:setMode(mode :: any)
		State.LastMessage = if mode == "Automatic"
			then "Automatic"
			elseif mode == "Sequential" then `Sequential: {hint("E/Q", "B/X")} to shift`
			else `Manual: {hint("Shift", "LB")} = clutch, {hint("E/Q", "B/X")} to shift (clutch in!)`
	elseif name == "VehIgnition" and sim then
		if sim.engine.ignition then
			sim.engine.ignition = false
			State.LastMessage = "Ignition off"
		elseif dt.manualClutch and dt.gear ~= 0 and dt.clutchPedal < 0.8 then
			State.LastMessage = `Clutch in ({hint("Shift", "LB")}) or neutral to start`
		else
			startCrank()
			State.LastMessage = "Cranking"
		end
	elseif name == "VehReset" then
		c:reset()
		flipTimer = 0
	elseif name == "VehTransfer" then
		if not dt.transferCase then
			State.LastMessage = "Two-wheel drive only"
		else
			local order = { "2H", "4H", "4L" }
			local nextMode = order[(table.find(order, dt.transfer) or 1) % #order + 1]
			local ok, reason = dt:setTransfer(nextMode :: any)
			State.LastMessage = if ok then nextMode else reason or "Can't shift the transfer case"
		end
	elseif name == "VehTCS" then
		-- one button for both, as on a real console: off is for sliding about
		dt.tcs = not dt.tcs
		c.esc = dt.tcs and c.config.Assists.ESC ~= false
		State.LastMessage = if dt.tcs then "Traction and stability control on" else "Traction and stability control off"
	elseif name == "VehExit" then
		local character = player.Character
		local humanoid = character and character:FindFirstChildOfClass("Humanoid")
		if humanoid then
			humanoid.Sit = false
			humanoid.Jump = true
		end
	end
	-- "VehSink" (Space / A / LB / RB) only exists so jumping can't throw you out;
	-- the handbrake and clutch are read by polling
	return Enum.ContextActionResult.Sink
end

local function bindDriveKeys()
	local prio = Enum.ContextActionPriority.High.Value + 200
	-- L1/R1 (clutch) are polled in gamepadState; sink them so nothing else reacts (LB would duck)
	ContextActionService:BindActionAtPriority("VehSink", onDriveAction, false, prio, Enum.KeyCode.Space, Enum.KeyCode.ButtonA, Enum.KeyCode.ButtonL1, Enum.KeyCode.ButtonR1)
	ContextActionService:BindActionAtPriority("VehShiftUp", onDriveAction, false, prio, Enum.KeyCode.E, Enum.KeyCode.ButtonB)
	ContextActionService:BindActionAtPriority("VehShiftDown", onDriveAction, false, prio, Enum.KeyCode.Q, Enum.KeyCode.ButtonX)
	ContextActionService:BindActionAtPriority("VehMode", onDriveAction, false, prio, Enum.KeyCode.N, Enum.KeyCode.DPadDown)
	ContextActionService:BindActionAtPriority("VehIgnition", onDriveAction, false, prio, Enum.KeyCode.DPadUp)
	ContextActionService:BindActionAtPriority("VehTCS", onDriveAction, false, prio, Enum.KeyCode.T, Enum.KeyCode.DPadLeft)
	ContextActionService:BindActionAtPriority("VehTransfer", onDriveAction, false, prio, Enum.KeyCode.L, Enum.KeyCode.ButtonL3)
	ContextActionService:BindActionAtPriority("VehReset", onDriveAction, false, prio, Enum.KeyCode.DPadRight)
	ContextActionService:BindActionAtPriority("VehExit", onDriveAction, false, prio, Enum.KeyCode.X, Enum.KeyCode.ButtonY, Enum.KeyCode.ButtonSelect)
end

local function unbindDriveKeys()
	for _, name in { "VehSink", "VehShiftUp", "VehShiftDown", "VehMode", "VehIgnition", "VehTCS", "VehTransfer", "VehReset", "VehExit" } do
		ContextActionService:UnbindAction(name)
	end
end

local function setRumble(value: number)
	-- only talk to the motor when the value actually changes
	if math.abs(value - rumbleSent) < 0.02 and not (value == 0 and rumbleSent ~= 0) then
		return
	end
	rumbleSent = value
	if HapticService:IsVibrationSupported(PAD) and HapticService:IsMotorSupported(PAD, Enum.VibrationMotor.Large) then
		HapticService:SetMotor(PAD, Enum.VibrationMotor.Large, value)
	end
end

local function updateRumble(dt: number)
	if not driving or not usingGamepad() then
		rumble = 0
	else
		rumble = math.max(0, rumble - RUMBLE_DECAY * dt)
	end
	setRumble(rumble)
end

---------------------------------------------------------------------------
-- HUD
---------------------------------------------------------------------------

local function buildHud()
	local gui = Instance.new("ScreenGui")
	gui.Name = "VehicleHud"
	gui.ResetOnSpawn = false
	gui.IgnoreGuiInset = true
	gui.Enabled = false

	local frame = Instance.new("Frame")
	frame.AnchorPoint = Vector2.new(1, 1)
	frame.Position = UDim2.new(1, -16, 1, -16)
	frame.Size = UDim2.fromOffset(300, 150)
	frame.BackgroundColor3 = Color3.fromRGB(16, 17, 20)
	frame.BackgroundTransparency = 0.25
	frame.Parent = gui
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, 8)
	corner.Parent = frame
	local pad = Instance.new("UIPadding")
	pad.PaddingLeft = UDim.new(0, 12)
	pad.PaddingTop = UDim.new(0, 8)
	pad.Parent = frame

	local function label(name: string, y: number, size: number, color: Color3): TextLabel
		local l = Instance.new("TextLabel")
		l.Name = name
		l.BackgroundTransparency = 1
		l.Position = UDim2.fromOffset(0, y)
		l.Size = UDim2.new(1, -12, 0, size + 4)
		l.FontFace = Font.new("rbxasset://fonts/families/RobotoMono.json", Enum.FontWeight.Bold)
		l.TextSize = size
		l.TextXAlignment = Enum.TextXAlignment.Left
		l.TextColor3 = color
		l.Text = ""
		l.Parent = frame
		hud[name] = l
		return l
	end
	label("Speed", 0, 34, Color3.fromRGB(240, 240, 240))
	label("Gear", 42, 16, Color3.fromRGB(255, 140, 40))
	label("Drive", 64, 14, Color3.fromRGB(180, 185, 195))
	label("Aids", 84, 14, Color3.fromRGB(180, 185, 195))
	label("Impact", 106, 14, Color3.fromRGB(255, 110, 90))

	gui.Parent = player:WaitForChild("PlayerGui")
	return gui
end

local hudGui: ScreenGui? = nil

local function gearText(dt: any): string
	local range = if dt.transferCase then " " .. dt.transfer else ""
	if dt.gear < 0 then
		return "R" .. range
	elseif dt.gear == 0 then
		return "N" .. range
	end
	return tostring(dt.gear) .. range
end

local function updateHud()
	local gui = hudGui
	local c = chassis
	if not gui then
		return
	end
	gui.Enabled = driving and c ~= nil and not State.CameraOverride -- (the replay editor has its own)
	if not gui.Enabled or not c then
		return
	end
	local dt = c.drivetrain
	local sim = State.Simulator
	local rpm = if sim then sim.engine:getRpm() else 0
	hud.Speed.Text = string.format("%3.0f km/h", math.abs(c.speed) * 3.6)
	hud.Gear.Text = string.format(
		"%s  %s  %5.0f rpm%s",
		if dt.mode == "Automatic" then "AUTO" elseif dt.mode == "Sequential" then "SEQ " else "MAN ",
		gearText(dt),
		rpm,
		if sim and not sim.engine.ignition then "  OFF" elseif rpm < 300 then "  STALLED" else ""
	)
	local boost = if sim then sim.engine:getBoost() / 6895 else 0
	hud.Drive.Text = string.format(
		"%s %3.0f%%  %4.0f Nm  %s %+5.1f psi",
		if dt:usesConverter() then "lockup" else "clutch",
		dt.clutch * 100,
		dt.clutchTorque,
		if sim and sim.engine:hasSupercharger() then "boost" else "MAP",
		boost
	)
	local abs = false
	for _, w in dt.wheels do
		abs = abs or w.absActive
	end
	hud.Aids.Text = string.format(
		"TCS %s%s ESC %s%s ABS%s dmg %.0f",
		if dt.tcs then "on" else "off",
		if dt.tcsFactor < 0.99 then "*" else " ",
		if c.esc then "on" else "off",
		if c.escActive then "*" else " ",
		if abs then "*" else " ",
		c.damage
	)
	hud.Impact.Text = if os.clock() - lastImpactTime < 3 then lastImpactText else ""
end

---------------------------------------------------------------------------
-- Ownership / seating
---------------------------------------------------------------------------

local function setCharacterMassless(on: boolean)
	local character = player.Character
	if not character then
		return
	end
	if on then
		for _, d in character:GetDescendants() do
			if d:IsA("BasePart") then
				savedMassless[d] = d.Massless
				d.Massless = true
			end
		end
	else
		for part, value in savedMassless do
			if part.Parent then
				part.Massless = value
			end
		end
		table.clear(savedMassless)
	end
end

local baseTire: any = nil -- the driven car's own tire, before any compound

local function release()
	if chassis then
		chassis:destroy()
	end
	if cockpit then
		cockpit:destroy()
	end
	if carAudio then
		carAudio:destroy()
	end
	chassis = nil
	cockpit = nil
	carAudio = nil
	car = nil
	State.Chassis = nil
	State.CarModel = nil
	State.CarAudio = nil
	State.ExternalDriver = false
	local sim = State.Simulator
	if sim then
		sim.stepHook = nil
		sim.engine.ignition = false
	end
	hookedSim = nil
end

local function adopt(model: Model)
	if car == model then
		return
	end
	release()
	local config = VehicleConfigs.forModel(model)
	local ok, result = pcall(Chassis.new, model, config)
	if not ok then
		warn("[VehicleController] Could not set up chassis:", result)
		return
	end
	car = model
	chassis = result
	State.Chassis = result
	State.CarModel = model
	State.ExternalDriver = true
	local c = result :: Chassis.Chassis
	-- the tire compound picked in the F4 menu carries over between cars
	baseTire = config.Tire
	if State.TireCompound ~= "Stock" then
		c:setTire(TireCompounds.apply(baseTire, State.TireCompound))
	end
	cockpit = Cockpit.new(c.body, config.Cockpit)
	-- engine (exhaust / intake) and tire sounds from their places on the car
	if State.Audio then
		carAudio = CarAudio.new(model, c, State.Audio, config.MetersPerStud)
		State.CarAudio = carAudio
	end
	-- this car's engine (EngineAudioController owns the simulator)
	local presetName = config.Drivetrain.EnginePreset
	local sim = State.Simulator
	if State.LoadPreset and (not sim or sim.preset ~= (State.Presets :: any)[presetName]) then
		State.LoadPreset(presetName)
	end
	c.onImpact.Event:Connect(function(e: Chassis.ImpactEvent)
		if e.Kind == "Body" or e.Kind == "Wheel" then
			lastImpactText = string.format("%s hit %.1f m/s (%s)", e.Corner or "body", e.Speed, e.Part.Name)
			lastImpactTime = os.clock()
			rumble = math.max(rumble, math.clamp(e.Speed / 12, 0.25, 1))
		end
	end)
end

local function setDriving(on: boolean)
	if driving == on then
		return
	end
	driving = on
	setCharacterMassless(on)
	if on then
		bindDriveKeys()
		local sim = State.Simulator
		if sim and sim.engine:getRpm() < 300 then
			startCrank()
		end
		if chassis then
			-- (a torque-converter automatic sits in neutral until the throttle puts it in drive,
			-- or it would creep off as you sit down)
			local d = chassis.drivetrain
			d:shift(if d.automatic and not d:usesConverter() then 1 else 0)
		end
	else
		unbindDriveKeys()
		local sim = State.Simulator
		if sim then
			sim.engine.ignition = false
		end
	end
end

local function scanOwnership()
	local character = player.Character
	local humanoid = character and character:FindFirstChildOfClass("Humanoid")
	local seat = humanoid and humanoid.SeatPart

	-- The car we own; the one we're sitting in if ownership is still moving over to it.
	local folder = Workspace:FindFirstChild("Vehicles")
	local mine: Model? = nil
	if folder then
		for _, m in folder:GetChildren() do
			if m:IsA("Model") and m:GetAttribute("OwnerUserId") == player.UserId then
				if not mine or (seat and seat:IsDescendantOf(m)) then
					mine = m
				end
			end
		end
	end
	if mine and mine ~= car then
		setDriving(false)
		adopt(mine)
	elseif not mine and car then
		setDriving(false)
		release()
	end

	setDriving(car ~= nil and seat ~= nil and seat:IsDescendantOf(car :: Model) and seat.Name == "DriveSeat")
end

---------------------------------------------------------------------------
-- Simulation
---------------------------------------------------------------------------

local function physicsStep(dt: number)
	local c = chassis
	local sim = State.Simulator
	if not c or not sim then
		return
	end
	dt = math.min(dt, 1 / 20)
	local drivetrain = c.drivetrain
	local engine = sim.engine

	-- Rolled over and come to rest: back on its wheels (driven or parked; this client owns it)
	local moving = c.body.AssemblyLinearVelocity.Magnitude * c.config.MetersPerStud
	if c.body.CFrame.UpVector.Y < FLIP_UP and moving < FLIP_SPEED then
		flipTimer += dt
		if flipTimer > FLIP_DELAY then
			flipTimer = 0
			c:reset()
			State.LastMessage = "Flipped back over"
		end
	else
		flipTimer = 0
	end

	-- (Re)attach the drivetrain to the current engine; P swaps the simulator.
	if hookedSim ~= sim then
		hookedSim = sim
		sim.stepHook = function(h: number)
			drivetrain:step(engine :: any, h)
		end
		-- (a part swap in the exhaust garage keeps a parked engine running)
		if not driving and not State.GarageOpen then
			engine.ignition = false
		end
	end

	-- Driver inputs
	local throttleIn, brakeIn, steerIn, handbrakeIn, clutchIn = 0, 0, 0, 0, 0
	local steerAnalog = false
	-- the replay editor has the keyboard: the car stops where it is
	if driving and not State.InputCaptured then
		local gSteer, gRt, gLt, gHand, gClutch = gamepadState()
		local up = keyDown(Enum.KeyCode.W, Enum.KeyCode.Up)
		local down = keyDown(Enum.KeyCode.S, Enum.KeyCode.Down)
		local left = keyDown(Enum.KeyCode.A, Enum.KeyCode.Left)
		local right = keyDown(Enum.KeyCode.D, Enum.KeyCode.Right)
		throttlePedal = approach(throttlePedal, if up then 1 else 0, 5, 8, dt)
		brakePedal = approach(brakePedal, if down then 1 else 0, 6, 10, dt)
		throttleIn = math.max(throttlePedal, gRt)
		brakeIn = math.max(brakePedal, gLt)
		steerIn = (if left then 1 else 0) - (if right then 1 else 0)
		if gSteer ~= 0 then
			steerIn = gSteer
		end
		-- a stick is already smoothed by a thumb; keys get a slower rack
		steerAnalog = gSteer ~= 0 or (steerIn == 0 and usingGamepad())
		handbrakeIn = if keyDown(Enum.KeyCode.Space) or gHand then 1 else 0
		local clutchHeld = keyDown(Enum.KeyCode.LeftShift) or gClutch
		clutchPedal = approach(clutchPedal, if clutchHeld then 1 else 0, CLUTCH_DOWN_RATE, CLUTCH_UP_RATE, dt)
		clutchIn = clutchPedal

		-- Automatic: the brake pedal selects reverse once stopped, and in
		-- reverse the pedals swap (common racing-game convention).
		if drivetrain.automatic and not drivetrain:isShifting() then
			local stopped = math.abs(c.speed) < 0.8
			if drivetrain.gear >= 0 then
				reverseHold = if stopped and brakeIn > 0.5 and throttleIn < 0.05 then reverseHold + dt else 0
				if reverseHold > 0.3 then
					drivetrain:shift(-1)
					reverseHold = 0
				elseif drivetrain.gear == 0 and throttleIn > 0.05 then
					drivetrain:shift(1)
				end
			elseif stopped and throttleIn > 0.5 and brakeIn < 0.05 then
				drivetrain:shift(1)
			end
			if drivetrain.gear < 0 then
				throttleIn, brakeIn = brakeIn, throttleIn
			end
		end
	else
		-- Parked: handbrake on, foot on the brake; the exhaust garage revs it
		handbrakeIn, brakeIn = 1, 1
		if State.GarageOpen then
			throttleIn = math.clamp(State.GarageThrottle, 0, 1)
		end
	end
	drivetrain.clutchPedal = clutchIn
	drivetrain.throttleInput = throttleIn
	brakeShown = brakeIn

	c:prepare(dt, { steer = steerIn, analog = steerAnalog, brake = brakeIn, handbrake = handbrakeIn })

	-- Engine controls
	drivetrain:updateControls(dt, engine :: any)
	local throttle = throttleIn * drivetrain.tcsFactor * c.escThrottle
	if drivetrain:isShifting() and drivetrain.automatic and not drivetrain.flatShifting
		and not drivetrain:usesConverter() then
		throttle = 0 -- the TCU cuts torque during the shift (a flat shift cuts the spark instead;
		-- a torque converter keeps pulling through it)
	end
	engine.throttle = throttle

	local rpm = engine:getRpm()
	-- push-button restart after a stall; with a manual box the starter is
	-- interlocked on the clutch pedal (or neutral), as in the real car
	local interlock = not drivetrain.manualClutch or clutchIn > 0.8 or drivetrain.gear == 0
	if driving and engine.ignition and rpm < 200 and throttleIn > 0.1 and interlock and os.clock() > crankUntil then
		startCrank()
	end
	local cranking = os.clock() < crankUntil and rpm < engine.preset.IdleRpm * 0.7
	if not cranking and os.clock() < crankUntil and rpm >= engine.preset.IdleRpm * 0.7 then
		crankUntil = 0
	end
	engine.starter = cranking
	State.SpeedSetting = throttle

	-- Engine + drivetrain substeps
	if State.Running then
		-- Audio available: engine-sim's own latency control picks the step count
		sim:update(dt)
	else
		-- No audio device (published game): step the physics in real time only
		local h = sim:getTimestep()
		stepAccumulator += dt
		local n = math.floor(stepAccumulator / h)
		stepAccumulator -= n * h
		local hook = sim.stepHook
		for _ = 1, n do
			engine:step(h)
			if hook then
				hook(h)
			end
		end
	end
	drivetrain:endFrame()

	c:apply(dt)
	c:updateMarks()
	if carAudio then
		carAudio:update(State.TireVolume * State.Volume)
	end
end

function VehicleController.Init()
	State.BenchMode = false
end

function VehicleController.Start()
	State.SetTireCompound = function(name: string)
		State.TireCompound = name
		if chassis and baseTire then
			(chassis :: Chassis.Chassis):setTire(TireCompounds.apply(baseTire, name))
			State.LastMessage = `{name} tires fitted`
		end
	end
	State.CrankEngine = startCrank
	local sim = State.Simulator
	if sim then
		sim.engine.ignition = false
		sim.engine.starter = false
	end
	hudGui = buildHud()

	RunService.PreSimulation:Connect(function(dt)
		scanOwnership()
		physicsStep(dt)
	end)

	RunService.RenderStepped:Connect(function(dt)
		local c = chassis
		local driver = State.Driver
		if c then
			c:render(dt)
			local sim = State.Simulator
			local steer = (c.byName.FL.steer + c.byName.FR.steer) * 0.5
			local cp = cockpit
			if cp then
				cp:render(dt, steer, if sim then sim.engine:getRpm() else 0, if sim then sim.engine.throttle else 0)
			end
			-- for the seated body's hands and feet (CharacterController)
			local ratio = if cp then cp.settings.SteeringRatio else DEFAULT_STEERING_RATIO
			driver.WheelAngle = steer * ratio
			driver.Throttle = if driving then c.drivetrain.throttleInput else 0
			driver.Brake = if driving then brakeShown else 0
			driver.Clutch = if driving then clutchPedal else 0
		else
			driver.WheelAngle, driver.Throttle, driver.Brake, driver.Clutch = 0, 0, 0, 0
		end
		updateHud()
		updateRumble(dt)
	end)

	State.LastMessage = "Find the car and sit in the driver's seat"
end

return VehicleController
