-- lune run Tools/test/dyno.luau [preset] [cam option: 0=stock]
-- Holds the crank at fixed rpm and averages net torque.
local H = require("./harness")
local EngineSim = H.require("Client/Modules/EngineSim")
local args = (require("@lune/process")).args
local name = args[1] or "GM_LS"
local preset = EngineSim.Presets[name]
local e = EngineSim.EngineModel.new(preset)
local camIndex = if args[2] then assert(tonumber(args[2]), "cam option must be a number") else preset.DefaultCamIndex or 0
if preset.CamOptions then
	e.camIndex = camIndex
end
if camIndex ~= 0 then
	local cam = assert(preset.CamOptions and preset.CamOptions[camIndex], "unknown cam option")
	name ..= " / " .. cam.Name
end
e.ignition = true
for _, thr in { 1.0, 0.0 } do
	e.throttle = thr
	print(string.format("%s throttle %.0f%%", name, thr * 100))
	local top = math.max(7000, math.ceil(e:getRedline() / 1000) * 1000)
	for rpm = 1000, top, 500 do
		local w = rpm * math.pi / 30
		local sum, n, boost, blower = 0, 0, 0, 0
		local h = 1 / preset.SimulationFrequency
		local steps = math.floor(0.6 / h)
		for i = 1, steps do
			e.omega = w
			e:step(h)
			if i > steps / 2 then
				sum += e.lastTorque
				boost += e:getBoost()
				blower += e.blowerTorque
				n += 1
			end
		end
		local tq = sum / n
		print(string.format("  %5d rpm  %7.1f Nm  %6.1f kW  (%5.0f hp)  MAP %+6.1f kPa (%+5.1f psi)  blower %5.1f Nm",
			rpm, tq, tq * w / 1000, tq * w / 745.7, boost / n / 1000, boost / n / 6895, blower / n))
	end
end
