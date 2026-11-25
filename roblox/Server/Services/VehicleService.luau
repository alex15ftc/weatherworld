--!strict
-- Rigs car models for the client chassis (Client/Modules/Vehicle) and manages
-- who simulates them.
--
-- Any Model laid out like an A-Chassis car is rigged at runtime:
--   <car>/.../Wheels/FL, FR, RL, RR    hub parts, with the rim/tire meshes under them
--   <car>/.../DriveSeat                the driver's Seat (or VehicleSeat)
-- The templates are ServerStorage.Vehicles (roblox/assets/vehicles: the Pickup and the
-- CrownVic), rigged once in Init; VehicleService.spawn sets down a rigged copy (CarService gives
-- each player one). A car model left in Workspace is rigged where it stands at Start. Each model
-- gets its config from Shared/VehicleConfigs (by name or its "VehicleConfig" attribute).
--
-- What the rig adds:
--   PhysicsBody    invisible box that carries ALL the mass, centred at the
--                  real centre of mass (FrontWeight split of the measured
--                  wheelbase, CgHeight above the ground), aligned with the car
--   PhysicsCabin   invisible massless box for the greenhouse, so a roll-over
--                  lands on a roof
--   Collider_XX    invisible frictionless spheres inside each tire. They keep
--                  the wheels out of walls, and their collision summaries tell
--                  the client about curb and wall strikes.
--   WheelMotor_XX  Motor6D from PhysicsBody to each hub at ride height. The
--                  owner's client animates Transform (suspension, steer, spin).
--   Cockpit_XX     Motor6D from PhysicsBody to an A-Chassis Misc pivot (Wheel/W,
--                  Tach/M, Fan/M) when the model has them; the client turns
--                  the steering wheel, tach needle and fan through Transform.
--                  The steering joint carries RimUp / RimAcross attributes (the
--                  rim's half-size) for the driver's hands.
--   SS.Motor       Motor from an A-Chassis hinge part (Misc/<piece>/.../SS: doors,
--                  an active spoiler) to PhysicsBody; the piece rides on the SS and
--                  the model's own scripts open it through DesiredAngle.
--   Sound_*        Attachments where the car's sounds come from (Config.Sound):
--                  Sound_Exhaust_N / Sound_Intake_N on PhysicsBody, and
--                  Sound_Tire on each hub. Each has a SoundSource attribute
--                  ("Exhaust" | "Intake" | "Tire", plus Wheel = "FL".. for
--                  tires); the client hangs an AudioEmitter on each.
-- Every cosmetic part is welded to PhysicsBody and made massless, non-colliding
-- and non-queryable, so the visual model has no effect on the physics.
-- A-Chassis suspension helpers (SuspensionGeometry, its hinges and springs)
-- are removed: the client simulates the suspension.
--
-- Network ownership goes to the player in the driver's seat and stays with
-- them after they get out (their client keeps the parked car on its springs).
-- When that player leaves, or gets into another car, the car is anchored where
-- it is.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Workspace = game:GetService("Workspace")

local ServerStorage = game:GetService("ServerStorage")

local VehicleConfigs = require(ReplicatedStorage.Shared.VehicleConfigs)
local VehicleNet = require(ReplicatedStorage.Shared.Net.VehicleNet)
local WorldConfig = require(ReplicatedStorage.Shared.World.Config)

type VehicleConfig = VehicleConfigs.VehicleConfig

local VehicleService = {}

local WHEEL_NAMES = { "FL", "FR", "RL", "RR" }
local SEAT_NAME = "DriveSeat"
-- Hinged doors and spoilers (Misc/.../SS) turn this fast, radians per physics step.
local HINGE_SPEED = 0.03
-- How long a car is held still after someone sits in it (see watchSeat).
local SEAT_SETTLE_TIME = 0.35

local function newPart(props: { [string]: any }): Part
	local p = Instance.new("Part")
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	for k, v in props do
		(p :: any)[k] = v
	end
	return p
end

local function weld(a: BasePart, b: BasePart)
	local w = Instance.new("WeldConstraint")
	w.Part0 = a
	w.Part1 = b
	w.Parent = b
end

-- A plain Seat or a VehicleSeat (whose own throttle and steering are switched off: the client
-- drives the car).
type DriveSeat = Seat | VehicleSeat

local function findLayout(model: Model): ({ [string]: BasePart }?, DriveSeat?)
	local wheelsFolder = model:FindFirstChild("Wheels", true)
	local seat = model:FindFirstChild(SEAT_NAME, true)
	if not wheelsFolder or not seat or not (seat:IsA("Seat") or seat:IsA("VehicleSeat")) then
		return nil, nil
	end
	local hubs: { [string]: BasePart } = {}
	for _, n in WHEEL_NAMES do
		local hub = wheelsFolder:FindFirstChild(n)
		if not hub or not hub:IsA("BasePart") then
			return nil, nil
		end
		hubs[n] = hub
	end
	return hubs, seat :: any
end

-- A part by path ("Body/Exhaust/Backfire1"): a BasePart named like the last
-- entry whose parents match the earlier entries, from the bottom up.
local function findByPath(model: Model, path: string): BasePart?
	local names = string.split(path, "/")
	local leaf = names[#names]
	for _, d in model:GetDescendants() do
		if d:IsA("BasePart") and d.Name == leaf then
			local node = d.Parent
			local ok = true
			for i = #names - 1, 1, -1 do
				if not node or node.Name ~= names[i] then
					ok = false
					break
				end
				node = node.Parent
			end
			if ok then
				return d
			end
		end
	end
	return nil
end

-- Sound emitter attachments (see Config.Sound). `bodyCF` is the PhysicsBody
-- frame and `cg` its position; the model has not moved yet, so part
-- positions are still their edit-time positions.
local function addSoundAttachments(model: Model, body: BasePart, hubs: { [string]: BasePart }, Config: VehicleConfig)
	local mps = Config.MetersPerStud
	local bodyCF = body.CFrame
	for _, source in { "Exhaust", "Intake" } do
		local specs = (Config.Sound :: any)[source] :: { VehicleConfigs.SoundEmitterSpec }
		for i, spec in specs do
			local origin = bodyCF.Position
			if spec.Part then
				local part = findByPath(model, spec.Part)
				if part then
					origin = part.Position
				else
					warn(`[VehicleService] {model.Name}: no part "{spec.Part}" for the {source} sound; using the centre of mass`)
				end
			end
			-- Offset is X right, Y up, Z forward; the body looks along -Z
			local o = spec.Offset or Vector3.zero
			local world = origin + bodyCF:VectorToWorldSpace(Vector3.new(o.X, o.Y, -o.Z) / mps)
			local att = Instance.new("Attachment")
			att.Name = `Sound_{source}_{i}`
			-- exhausts point out the back (for the emitter's angle attenuation)
			local facing = if source == "Exhaust" then CFrame.Angles(0, math.pi, 0) else CFrame.identity
			att.CFrame = CFrame.new(bodyCF:PointToObjectSpace(world)) * facing
			att:SetAttribute("SoundSource", source)
			att.Parent = body
		end
	end
	for name, hub in hubs do
		local att = Instance.new("Attachment")
		att.Name = "Sound_Tire"
		att:SetAttribute("SoundSource", "Tire")
		att:SetAttribute("Wheel", name)
		att.Parent = hub
	end
end

-- A-Chassis "Misc" pivots: { folder name, pivot part name, cockpit joint name }
local COCKPIT_PIVOTS = {
	{ "Wheel", "W", "SteeringWheel" },
	{ "Tach", "M", "Tach" },
	{ "Fan", "M", "Fan" },
}

-- The rim's half-size in the steering wheel's plane, measured from the pivot: along the
-- driver's up (the seat's up laid into the plane) and across. The driver's hands hold it there
-- (Shared/ProcRig/Seated). Round wheels give two equal numbers, a yoke a wide one.
local function rimExtents(pivot: CFrame, parts: { BasePart }, seatUp: Vector3): (number, number)
	local normal = pivot.ZVector
	local up = seatUp - normal * seatUp:Dot(normal)
	up = if up.Magnitude > 1e-3 then up.Unit else pivot.XVector
	local across = normal:Cross(up).Unit
	local function extent(dir: Vector3): number
		local lo, hi = 0, 0
		for _, p in parts do
			local half = p.Size / 2
			local cf = p.CFrame
			local reach = math.abs(dir:Dot(cf.XVector)) * half.X
				+ math.abs(dir:Dot(cf.YVector)) * half.Y
				+ math.abs(dir:Dot(cf.ZVector)) * half.Z
			local d = (p.Position - pivot.Position):Dot(dir)
			lo = math.min(lo, d - reach)
			hi = math.max(hi, d + reach)
		end
		return (hi - lo) / 2
	end
	return extent(up), extent(across)
end

local function rig(model: Model, hubs: { [string]: BasePart }, seat: DriveSeat, Config: VehicleConfig, key: string)
	local mps = Config.MetersPerStud
	local function studs(m: number): number
		return m / mps
	end

	-- A-Chassis suspension helpers would fight the wheel motors
	for _, d in model:GetDescendants() do
		if d:IsA("Model") and d.Name == "SuspensionGeometry" then
			d:Destroy()
		end
	end
	for _, d in model:GetDescendants() do
		if d:IsA("Constraint") then
			d:Destroy()
		end
	end

	-- Car frame from the wheel positions: forward from the rear axle to the
	-- front axle, up = world up (the car is expected to sit upright).
	local frontMid = (hubs.FL.Position + hubs.FR.Position) * 0.5
	local rearMid = (hubs.RL.Position + hubs.RR.Position) * 0.5
	local forward = frontMid - rearMid
	forward = Vector3.new(forward.X, 0, forward.Z).Unit
	local wheelbase = (frontMid - rearMid).Magnitude

	local hubY = 0
	for _, hub in hubs do
		hubY += hub.Position.Y * 0.25
	end
	local groundY = hubY - studs(Config.Tire.Radius)

	-- Centre of mass: FrontWeight * L ahead of the rear axle
	local cgFlat = rearMid + forward * (wheelbase * Config.FrontWeight)
	local cg = Vector3.new(cgFlat.X, groundY + studs(Config.CgHeight), cgFlat.Z)
	local bodyCF = CFrame.lookAlong(cg, forward, Vector3.yAxis)

	-- Every existing part becomes cosmetic
	local cosmetic: { BasePart } = {}
	for _, d in model:GetDescendants() do
		if d:IsA("BasePart") then
			d.Anchored = false
			d.CanCollide = false
			-- a ClickDetector (a door handle) needs its part under the mouse
			d.CanQuery = d:FindFirstChildOfClass("ClickDetector") ~= nil
			d.CanTouch = d:IsA("Seat") -- seats need touch to be sat in
			d.Massless = true
			table.insert(cosmetic, d)
		elseif d:IsA("JointInstance") or d:IsA("WeldConstraint") then
			d:Destroy()
		end
	end

	-- Mass-carrying body: ground clearance to beltline, centred on the CG
	local bodyHeight = 2 * (Config.CgHeight - Config.GroundClearance)
	local body = newPart({
		Name = "PhysicsBody",
		Size = Vector3.new(studs(Config.BodyWidth), studs(bodyHeight), studs(Config.BodyLength)),
		CFrame = bodyCF,
		Transparency = 1,
		CanQuery = false,
		Anchored = true,
		CustomPhysicalProperties = PhysicalProperties.new(0.7, 0.35, 0.05),
	})
	body.Parent = model
	model.PrimaryPart = body

	-- Greenhouse, centred on the driver's seat fore/aft
	local seatZ = bodyCF:PointToObjectSpace(seat.Position).Z
	local cabinH = Config.RoofHeight - Config.BeltlineHeight
	local cabin = newPart({
		Name = "PhysicsCabin",
		Size = Vector3.new(studs(Config.BodyWidth - 0.4), studs(cabinH), studs(2.1)),
		CFrame = bodyCF * CFrame.new(0, studs(Config.BeltlineHeight - Config.CgHeight + cabinH * 0.5), seatZ + studs(0.2)),
		Transparency = 1,
		CanQuery = false,
		Massless = true,
		CustomPhysicalProperties = PhysicalProperties.new(0.7, 0.35, 0.05),
	})
	cabin.Parent = model
	weld(body, cabin)

	-- Wheels: the hub (and everything under it) rides on a Motor6D
	local wheelParts: { [BasePart]: boolean } = {}
	for _, n in WHEEL_NAMES do
		local hub = hubs[n]
		wheelParts[hub] = true
		for _, d in hub:GetDescendants() do
			if d:IsA("BasePart") then
				wheelParts[d] = true
				weld(hub, d)
			end
		end
		local joint = CFrame.lookAlong(hub.Position, forward, Vector3.yAxis)
		local motor = Instance.new("Motor6D")
		motor.Name = "WheelMotor_" .. n
		motor.Part0 = body
		motor.Part1 = hub
		motor.C0 = bodyCF:ToObjectSpace(joint)
		motor.C1 = hub.CFrame:ToObjectSpace(joint)
		motor.Parent = body

		local collider = newPart({
			Name = "Collider_" .. n,
			Shape = Enum.PartType.Ball,
			Size = Vector3.one * studs(2 * Config.Tire.Radius * 0.75),
			CFrame = joint,
			Transparency = 1,
			Massless = true,
			CanQuery = false,
			CustomPhysicalProperties = PhysicalProperties.new(0.1, 0, 0, 100, 100),
		})
		collider.Parent = model
		weld(body, collider)
	end

	-- Cockpit pieces ride on a Motor6D around their pivot
	local misc = model:FindFirstChild("Misc")
	if misc and Config.Cockpit then
		for _, spec in COCKPIT_PIVOTS do
			local group = misc:FindFirstChild(spec[1])
			local pivot = group and group:FindFirstChild(spec[2])
			if not group or not pivot or not pivot:IsA("BasePart") then
				continue
			end
			wheelParts[pivot] = true
			for _, d in group:GetDescendants() do
				if d:IsA("BasePart") and d ~= pivot then
					wheelParts[d] = true
					weld(pivot, d)
				end
			end
			local motor = Instance.new("Motor6D")
			motor.Name = "Cockpit_" .. spec[3]
			motor.Part0 = body
			motor.Part1 = pivot
			motor.C0 = bodyCF:ToObjectSpace(pivot.CFrame)
			motor.C1 = CFrame.identity
			if spec[3] == "SteeringWheel" then
				local rim: { BasePart } = {}
				for _, d in group:GetDescendants() do
					if d:IsA("BasePart") and d ~= pivot then
						table.insert(rim, d)
					end
				end
				local up, across = rimExtents(pivot.CFrame, rim, seat.CFrame.UpVector)
				motor:SetAttribute("RimUp", up)
				motor:SetAttribute("RimAcross", across)
			end
			motor.Parent = body
		end
	end

	-- A-Chassis hinged pieces (doors, an active spoiler): a group under Misc with an "SS" part
	-- at the hinge. As A-Chassis does, the SS gets a Motor named "Motor" to the car, turning
	-- about the SS's Z axis, and the rest of the group rides on the SS; the model's own
	-- scripts set SS.Motor.DesiredAngle.
	if misc then
		for _, ss in misc:GetDescendants() do
			local group = ss.Parent
			if ss.Name ~= "SS" or not ss:IsA("BasePart") or not group or wheelParts[ss] then
				continue
			end
			wheelParts[ss] = true
			for _, d in group:GetDescendants() do
				if d:IsA("BasePart") and d ~= ss then
					wheelParts[d] = true
					weld(ss, d)
				end
			end
			local motor = Instance.new("Motor")
			motor.Name = "Motor"
			motor.Part0 = ss
			motor.Part1 = body
			motor.C0 = CFrame.identity
			motor.C1 = body.CFrame:ToObjectSpace(ss.CFrame)
			motor.MaxVelocity = HINGE_SPEED
			motor.Parent = ss
		end
	end

	for _, p in cosmetic do
		if not wheelParts[p] then
			weld(body, p)
		end
	end

	addSoundAttachments(model, body, hubs, Config)

	-- A 0.2-stud seat is hard to touch; widen it without moving its top face
	local seatPart: BasePart = seat
	seatPart.Size = Vector3.new(2, seatPart.Size.Y, 2)
	if seat:IsA("VehicleSeat") then
		seat.MaxSpeed = 0
		seat.Torque = 0
		seat.TurnSpeed = 0
		seat.HeadsUpDisplay = false
	end
	-- (the model's own seat prompts would show beside this one)
	for _, d in seat:GetDescendants() do
		if d:IsA("ProximityPrompt") then
			d:Destroy()
		end
	end
	local prompt = Instance.new("ProximityPrompt")
	prompt.Name = "DrivePrompt"
	prompt.ActionText = "Drive"
	prompt.ObjectText = VehicleConfigs.DisplayName[key] or model.Name
	prompt.KeyboardKeyCode = Enum.KeyCode.E
	prompt.GamepadKeyCode = Enum.KeyCode.ButtonY
	prompt.MaxActivationDistance = 12 * WorldConfig.WORLD_SCALE
	prompt.RequiresLineOfSight = false
	prompt.Parent = seat

	model:SetAttribute("VehicleConfig", key)
	model:SetAttribute("Rigged", true)
end

local function setOwner(model: Model, player: Player?)
	local body = model.PrimaryPart
	if not body then
		return
	end
	if player then
		body.Anchored = false
		body:SetNetworkOwner(player)
		model:SetAttribute("OwnerUserId", player.UserId)
	else
		model:SetAttribute("OwnerUserId", nil)
		if not body.Anchored then
			body.AssemblyLinearVelocity = Vector3.zero
			body.AssemblyAngularVelocity = Vector3.zero
			body.Anchored = true
		end
	end
end

-- Hooks up a rigged car (a Workspace model, or a template's copy: connections don't clone).
local function watchSeat(model: Model, seat: DriveSeat)
	local prompt = seat:FindFirstChild("DrivePrompt") :: ProximityPrompt?
	if prompt then
		prompt.Triggered:Connect(function(player)
			local character = player.Character
			local humanoid = character and character:FindFirstChildOfClass("Humanoid")
			if humanoid and not seat.Occupant and humanoid.Health > 0 then
				(seat :: any):Sit(humanoid)
			end
		end)
	end
	-- The hinged pieces' scripts (Misc/.../SS) look up SS.Motor as they start, which may have
	-- been before the rig made it: start them again now that it's there.
	local misc = model:FindFirstChild("Misc")
	if misc then
		for _, ss in misc:GetDescendants() do
			local group = ss.Parent
			if ss.Name == "SS" and ss:FindFirstChild("Motor") and group then
				for _, d in group:GetDescendants() do
					if d:IsA("Script") and d.Enabled then
						d.Enabled = false
						d.Enabled = true
					end
				end
			end
		end
	end
	seat:GetPropertyChangedSignal("Occupant"):Connect(function()
		if prompt then
			prompt.Enabled = seat.Occupant == nil
		end
		local humanoid = seat.Occupant
		local player = humanoid and Players:GetPlayerFromCharacter(humanoid.Parent)
		model:SetAttribute("DriverUserId", if player then player.UserId else nil)
		if player then
			-- A player simulates one car at a time: the one they last drove is parked
			local siblings: { Instance } = if model.Parent then model.Parent:GetChildren() else {}
			for _, other in siblings do
				if other ~= model and other:IsA("Model") and other:GetAttribute("OwnerUserId") == player.UserId then
					setOwner(other, nil)
				end
			end
			-- Hold the car still while the seat weld settles. The player's client owns their
			-- character and solves the new car + character assembly from where the character
			-- was (standing beside the seat): with the car free, that snapped the car up to it
			-- and threw it about. Anchored, the character snaps into the seat instead.
			local body = model.PrimaryPart
			if body then
				body.AssemblyLinearVelocity = Vector3.zero
				body.AssemblyAngularVelocity = Vector3.zero
				body.Anchored = true
			end
			task.delay(SEAT_SETTLE_TIME, function()
				if seat.Occupant == humanoid and model.Parent then
					setOwner(model, player)
				end
			end)
		end
	end)
end

local templates: { [string]: Model } = {}

-- Rigs a model where it stands (once); false if it isn't laid out as a car.
local function rigModel(model: Model): boolean
	if model:GetAttribute("Rigged") then
		return true
	end
	local hubs, seat = findLayout(model)
	if not hubs or not seat then
		return false
	end
	-- The models are built full size; the world is at WORLD_SCALE (VehicleConfigs' MetersPerStud
	-- is at that scale too).
	if math.abs(model:GetScale() - WorldConfig.WORLD_SCALE) > 1e-3 then
		model:ScaleTo(WorldConfig.WORLD_SCALE)
	end
	local h, st = hubs, seat
	local config, key = VehicleConfigs.forModel(model)
	local ok, err = pcall(function()
		rig(model, h, st, config, key)
	end)
	if not ok then
		warn(`[VehicleService] Could not rig {model:GetFullName()}: {err}`)
	end
	return ok
end

-- A rigged copy of a template (a VehicleConfigs key) with its pivot (the centre of mass,
-- VehicleService.pivotHeight above the ground) at `at`, parked and anchored until someone sits
-- in it. nil if there is no such car.
function VehicleService.spawn(key: string, at: CFrame): Model?
	local template = templates[key]
	if not template then
		return nil
	end
	local model = template:Clone()
	model:PivotTo(at)
	model.Parent = Workspace:WaitForChild("Vehicles")
	local _, seat = findLayout(model)
	if seat then
		watchSeat(model, seat)
	end
	return model
end

-- Studs from the ground up to a spawned car's pivot (its centre of mass at ride height).
function VehicleService.pivotHeight(key: string): number
	local config = VehicleConfigs.ByKey[key]
	return if config then config.CgHeight / config.MetersPerStud else 0
end

function VehicleService.has(key: string): boolean
	return (templates[key] :: Model?) ~= nil
end

function VehicleService.Init()
	-- (VehicleNet validates the shapes; the car must be one this player owns)
	local relay = VehicleNet.AudioRelay:Server()
	local lastUpdate: { [Player]: number } = {}
	VehicleNet.Audio:Server():On(function(player, model, preset, rpm, throttle, ignition, starter, impulse)
		local now = os.clock()
		if now - (lastUpdate[player] or 0) < 0.04 then return end
		if model.Parent ~= Workspace:FindFirstChild("Vehicles") or model:GetAttribute("OwnerUserId") ~= player.UserId then
			return
		end
		lastUpdate[player] = now
		relay:FireAll(model, preset, rpm, throttle, ignition, starter, impulse)
	end)
	Players.PlayerRemoving:Connect(function(player) lastUpdate[player] = nil end)
	if not Workspace:FindFirstChild("Vehicles") then
		local f = Instance.new("Folder")
		f.Name = "Vehicles"
		f.Parent = Workspace
	end
	local stored = ServerStorage:FindFirstChild("Vehicles")
	if stored then
		for _, m in stored:GetChildren() do
			if m:IsA("Model") and rigModel(m) then
				templates[VehicleConfigs.keyForModel(m)] = m
			end
		end
	end
	if not next(templates) then
		warn("[VehicleService] no car templates in ServerStorage.Vehicles")
	end
end

function VehicleService.Start()
	local folder = Workspace:WaitForChild("Vehicles")

	local candidates: { Model } = {}
	for _, m in Workspace:GetChildren() do
		if m:IsA("Model") then
			table.insert(candidates, m)
		end
	end
	for _, m in folder:GetChildren() do
		if m:IsA("Model") then
			table.insert(candidates, m)
		end
	end

	for _, model in candidates do
		if not model:GetAttribute("Rigged") and rigModel(model) then
			model.Parent = folder
			local _, seat = findLayout(model)
			if seat then
				watchSeat(model, seat)
			end
		end
	end

	Players.PlayerRemoving:Connect(function(player)
		for _, m in folder:GetChildren() do
			if m:IsA("Model") and m:GetAttribute("OwnerUserId") == player.UserId then
				setOwner(m, nil)
			end
		end
	end)
end

return VehicleService
