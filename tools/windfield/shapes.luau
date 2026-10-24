-- Funnel shapes the wind field holds: condensation where the pressure deficit (x condense)
-- reaches the fall from the ground to the cloud base. luau tools/windfield/shapes.luau
local WF = require("../../roblox/src/shared/Tornado/WindField")

local EF = { 33.5, 43.8, 55.0, 67.0, 81.8, 98.3 }
local RC = { 30, 45, 70, 100, 150, 250 }
local function params(e, rc, top)
	local p = {
		vc = 1, rc = rc, alpha = 0.6, eta = 0.5, z0 = 3, zj = 30, jet = 0.2, top = top, widen = 0.3,
		inflow = 0.5, depth = 0.15, twoCell = 0, cellWidth = 0.6, subCount = 0, subShare = 0,
		subRadius = 0.1, subSpeed = 0.4, subOrbit = 1, subRate = 0.7, subDecay = 150,
		turb = 0, turbScale = 0.5, pulseAmp = 0, pulsePeriod = 40, taperIn = 8, taperOut = 15,
		moveX = 13, moveZ = 0, ambientX = 13, ambientZ = 0, blend = 5, seed = 1,
	}
	WF.calibrate(p, EF[e + 1], 10)
	return p
end

local function bar(r, scale)
	local n = math.floor(r / scale + 0.5)
	return string.rep(" ", math.max(30 - n, 0)) .. string.rep("#", math.min(n, 30)) .. "|" .. string.rep("#", math.min(n, 30))
end

for _, case in {
	{ "EF1 narrow, base 500", 1, 30, 500 },
	{ "EF2, base 500", 2, 70, 500 },
	{ "EF3, base 700", 3, 100, 700 },
	{ "EF3, high base 1100", 3, 100, 1100 },
	{ "EF4 wide, low base 400", 4, 250, 400 },
	{ "EF5 wide, base 600", 5, 300, 600 },
	{ "EF1 weakening (rope), base 700", 1, 15, 700 },
} do
	local p = params(case[2], case[3], case[4])
	print(string.format("\n%s  (core %d m, spin %.0f m/s)", case[1], case[3], p.vc))
	local widest = 0
	local rows = {}
	for i = 10, 0, -1 do
		local z = case[4] * i / 10
		local r = math.min(WF.funnelRadius(p, z, 9.81, 1.5), 3 * case[4])
		table.insert(rows, { z, r })
		widest = math.max(widest, math.min(r, case[4]))
	end
	local scale = math.max(widest, 1) / 30
	for _, row in rows do
		print(string.format("%5.0f m %6.0f m  %s", row[1], row[2], bar(math.min(row[2], widest), scale)))
	end
end
