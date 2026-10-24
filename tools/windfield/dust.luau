-- Where wind-driven dust goes (DustView's tracer rules on the real wind field), offline:
--   luau tools/windfield/dust.luau
-- Prints, for a few tornadoes, how high and how far out the dust tracers get, so the pick-up
-- and lag settings can be tuned without Studio.
local WF = require("../../roblox/src/shared/Tornado/WindField")

local EF = { 33.5, 43.8, 55.0, 67.0, 81.8, 98.3 }
local function params(e, rc, top, S)
	local p = {
		vc = 1, rc = rc, alpha = 0.6, eta = 0.5, z0 = 3, zj = 30, jet = 0.2, top = top, widen = 0.3,
		inflow = 0.5, depth = 0.15, twoCell = 1.2 * math.clamp((S - 0.3) / 0.5, 0, 1), cellWidth = 0.6,
		subCount = 0, subShare = 0, subRadius = 0.1, subSpeed = 0.4, subOrbit = 1, subRate = 0.7, subDecay = 150,
		turb = 0.2, turbScale = 0.5, pulseAmp = 0.12, pulsePeriod = 40, taperIn = 8, taperOut = 15,
		moveX = 0, moveZ = 0, ambientX = 0, ambientZ = 0, blend = 5, seed = 3,
	}
	WF.calibrate(p, EF[e + 1], 10)
	return p
end

-- a small seeded generator (no Roblox Random here)
local function newRng(seed)
	local state = seed
	return {
		NextNumber = function(_, a, b)
			state = (state * 1103515245 + 12345) % 2147483648
			return a + (b - a) * state / 2147483648
		end,
	}
end

local function run(name, p, settings)
	local rng = newRng(5)
	local n, tries = 0, 0
	local hs, rs, maxh = {}, {}, 0
	local samples = 0
	while n < 300 and tries < 20000 do
		tries += 1
		local a = rng:NextNumber(0, 2 * math.pi)
		local r = p.rc * rng:NextNumber(settings.pickup[1], settings.pickup[2])
		local x, y, z = math.cos(a) * r, rng:NextNumber(settings.spawnH and settings.spawnH[1] or 1, settings.spawnH and settings.spawnH[2] or 6), math.sin(a) * r
		local wx, wy, wz = WF.at(p, x, y, z, 0)
		if math.sqrt(wx * wx + wz * wz) >= settings.threshold then
			n += 1
			local vx, vy, vz = wx * 0.5, wy * 0.5, wz * 0.5
			local lag = rng:NextNumber(settings.lag[1], settings.lag[2])
			local life = rng:NextNumber(settings.life[1], settings.life[2])
			local t, dt = 0, 1 / 30
			local gust = 0 -- turbulent vertical velocity (Ornstein-Uhlenbeck: lofting by eddies)
			while t < life do
				local ax, ay, az = WF.at(p, x, y, z, t)
				local hw = math.sqrt(ax * ax + az * az)
				local sigma = (settings.loft or 0) * hw
				local T = 2
				gust += -gust * dt / T + sigma * math.sqrt(2 * dt / T) * (rng:NextNumber(-1, 1) * 1.732)
				ay += gust
				local k = 1 - math.exp(-dt / lag)
				vx += (ax - vx) * k
				vy += (ay - vy) * k - settings.settle * dt
				vz += (az - vz) * k
				x, y, z = x + vx * dt, y + vy * dt, z + vz * dt
				if y < 0 then
					y, vy = 0, 0
					vx, vz = vx * 0.5, vz * 0.5
				end
				t += dt
				if y > p.top * settings.top then
					break
				end
				-- sample the dust's place every half second
				if math.floor(t * 2) ~= math.floor((t - dt) * 2) then
					table.insert(hs, y)
					table.insert(rs, math.sqrt(x * x + z * z) / p.rc)
					maxh = math.max(maxh, y)
					samples += 1
				end
			end
		end
	end
	table.sort(hs)
	table.sort(rs)
	local function q(list, f)
		return list[math.max(1, math.floor(#list * f))] or 0
	end
	print(string.format("%-34s picked %3d/%5d  height p50 %4.0f p90 %4.0f max %4.0f  |  r/rc p10 %.2f p50 %.2f p90 %.2f",
		name, n, tries, q(hs, 0.5), q(hs, 0.9), maxh, q(rs, 0.1), q(rs, 0.5), q(rs, 0.9)))
end

local base = { pickup = { 0.4, 2.6 }, threshold = 22, lag = { 0.3, 2.0 }, life = { 4, 10 }, settle = 2, top = 0.45 }
for _, case in {
	{ "Ref1 cone EF2 rc150 base520", 2, 150, 520, 0.5 },
	{ "rope EF1 rc15 base700", 1, 15, 700, 0.3 },
	{ "wedge EF4 rc280 base500", 4, 280, 500, 0.9 },
} do
	local p = params(case[2], case[3], case[4], case[5])
	print("== " .. case[1] .. string.format("  (vc %.0f)", p.vc))
	for _, c in {
		{ "lag 0.1-0.6, pickup 0.5-1.4", { 0.5, 1.4 }, { 0.1, 0.6 } },
		{ "lag 0.3-2.0, pickup 0.6-1.6", { 0.6, 1.6 }, { 0.3, 2.0 } },
		{ "lag 0.5-3.0, pickup 0.6-1.6", { 0.6, 1.6 }, { 0.5, 3.0 } },
		{ "lag 0.5-3.0, pickup 0.8-2.0", { 0.8, 2.0 }, { 0.5, 3.0 } },
	} do
		run(c[1] .. ", lift 0.25", p, { pickup = c[2], threshold = 22, lag = c[3], life = { 4, 10 }, settle = 0.5, top = 0.45, loft = 0.25, spawnH = { 2, 20 } })
	end
end
