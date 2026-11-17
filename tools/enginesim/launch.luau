-- Straight-line launch test: engine model + Drivetrain + tires on a 1-D car body.
-- Reports 0-100 km/h, quarter mile, shift points and checks for instability.
-- Run from roblox/:  lune run ../tools/enginesim/launch.luau [mode] [Pickup|CrownVic] [gearbox]
--   mode     launch (default), flat (ignition-cut upshifts), brake (100-0 km/h),
--            idle (in gear, foot on the brake, 10 s), creep (in gear, no pedals, 10 s),
--            cruise (full throttle to 90 km/h, then a light foot: the converter's lockup)
--   gearbox  Automatic (default), Sequential or Manual (Manual: the clutch is dumped at 3,500 rpm)
--   range    2H (default), 4H or 4L (a car with a transfer case)
local fs = require("@lune/fs")
local luau = require("@lune/luau")
local H = require("./harness")
local EngineSim = H.require("Client/Modules/EngineSim")
local Drivetrain = H.require("Client/Modules/Vehicle/Drivetrain")
local function loadConfig(file: string)
	local env = setmetatable({
		Vector3 = { new = function(x, y, z) return { X = x, Y = y, Z = z } end },
		script = { Parent = { VehicleConfig = "Shared/VehicleConfig.luau" } },
		require = function(path) return loadConfig(path) end,
	}, { __index = _G })
	return luau.load(fs.readFile(file), { environment = env })()
end
local args = (require("@lune/process")).args
local car = args[2] or "Pickup"
local Config = loadConfig("Shared/VehicleConfig" .. car .. ".luau")

local preset = EngineSim.Presets[Config.Drivetrain.EnginePreset]
local engine = EngineSim.EngineModel.new(preset)
engine.ignition = true
engine.omega = preset.IdleRpm * math.pi / 30

local wheels = {}
for _, spec in { { "FL", -1, true }, { "FR", 1, true }, { "RL", -1, false }, { "RR", 1, false } } do
	local axle = if spec[3] then Config.Front else Config.Rear
	table.insert(wheels, {
		Name = spec[1], Side = spec[2], Front = spec[3], Driven = axle.Driven, Steered = axle.Steered,
		Radius = Config.Tire.Radius, Inertia = Config.Tire.Inertia, omega = 0,
		grounded = true, vx = 0, vy = 0, fz = 0, mu = 1, brakeTorque = 0, handbrakeTorque = 0, tcsBrake = 0, escBrake = 0,
		fx = 0, fy = 0, kappa = 0, alpha = 0, absActive = false, _fxSum = 0, _fySum = 0,
	})
end
local Tire = H.require("Client/Modules/Vehicle/Tire")
local dt = Drivetrain.new(Config, wheels)
local gearbox = args[3] or "Automatic"
dt:setMode(gearbox :: any)
if args[4] then
	assert(dt:setTransfer(args[4] :: any))
end

local M, g = Config.Mass, 9.81
local L = Config.Wheelbase
local v, x, a = 0, 0, 0
local t = 0
local frame = 1 / 60
local h = 1 / preset.SimulationFrequency
local t100, tq, lastGear = nil, nil, dt.gear
local mode = args[1] or "launch"
local still = mode == "idle" or mode == "creep"
local minRpm = math.huge
-- "flat": a launch with the ignition cut on, so the upshifts are flat shifts
if mode == "flat" then
	EngineSim.FuelMap.forPreset(preset).IgnitionCut = true
end
local brakeAt = nil
while t < (if still then 10 else 40) do
	local throttle = if still then 0 else 1
	local brake = if mode == "idle" then 1 else 0
	local cruising = mode == "cruise" and (t > 20 or v > 90 / 3.6)
	if cruising then
		throttle = 0.22
	end
	if gearbox == "Manual" then
		-- hold the clutch in and rev it, then dump it
		dt.clutchPedal = if t < 1 then 1 else 0
		if t < 1 then throttle = if engine:getRpm() < 3500 then 1 else 0 end
	end
	if mode == "brake" and v > 100 / 3.6 then brakeAt = brakeAt or t end
	if brakeAt then throttle = 0; brake = 1 end
	-- load transfer from last frame's acceleration
	local dfz = M * a * Config.CgHeight / L
	for _, w in wheels do
		local static = M * g * (if w.Front then Config.FrontWeight else 1 - Config.FrontWeight) / 2
		w.fz = math.max(0, static + (if w.Front then -dfz / 2 else dfz / 2))
		w.mu = Tire.mu(Config.Tire, w.fz, 1)
		w.vx = v
		w.brakeTorque = brake * (if w.Front then Config.Front.BrakeTorque else Config.Rear.BrakeTorque)
	end
	dt.throttleInput = throttle
	engine.throttle = if dt:isShifting() and not dt.flatShifting then 0 else throttle * dt.tcsFactor
	dt:updateControls(frame, engine)
	dt:beginFrame()
	for _ = 1, math.floor(frame / h + 0.5) do
		engine:step(h)
		dt:step(engine, h)
	end
	dt:endFrame()
	local fx = 0
	for _, w in wheels do fx += w.fx end
	local drag = 0.5 * Config.Aero.AirDensity * Config.Aero.DragArea * v * v
	a = (fx - drag) / M
	v += a * frame
	x += v * frame
	t += frame
	if v ~= v or engine.omega ~= engine.omega then error("NaN at t=" .. t) end
	if dt.gear ~= lastGear then
		print(string.format("  t=%5.2f shift %d->%d at %4.0f rpm, %5.1f km/h", t, lastGear, dt.gear, engine:getRpm(), v * 3.6))
		lastGear = dt.gear
	end
	if t > 1 then minRpm = math.min(minRpm, engine:getRpm()) end
	if math.floor(t * 60) % 30 == 0 and (t < 3 or still or (cruising and math.floor(t * 60) % 120 == 0)) then
		local r = wheels[3]
		print(string.format("  t=%4.2f rpm %5.0f clutch %.2f slip %.3f v %5.1f a %.2fg  clutch %4.0f Nm  wheels %5.0f Nm", t, engine:getRpm(), dt.clutch, r.kappa, v * 3.6, a / g, dt.clutchTorque, dt.wheelTorque))
	end
	if not t100 and v >= 100 / 3.6 then t100 = t end
	if not tq and x >= 402.3 then tq = t; print(string.format("  quarter mile %.2f s @ %.0f km/h", t, v * 3.6)) end
	if brakeAt and v <= 0.05 then
		print(string.format("  100-0 km/h in %.2f s, %.1f m", t - brakeAt, x - (x - 0)))
		break
	end
end
print(string.format("0-100 km/h: %s s, final %.0f km/h, rpm %.0f, gear %d", tostring(t100 and string.format("%.2f", t100)), v * 3.6, engine:getRpm(), dt.gear))
print(string.format('afterfires %d, lowest rpm after 1 s %.0f', engine.afterfires, minRpm))
