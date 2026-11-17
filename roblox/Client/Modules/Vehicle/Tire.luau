--!strict
--!native
-- Tire force model: Pacejka "Magic Formula" with combined slip and load sensitivity.
--
--   F(x) = D sin(C atan(Bx - E(Bx - atan(Bx))))
--
-- Longitudinal slip ratio kappa and slip angle alpha are each normalised by the
-- slip where their own curve peaks. The combined slip s = |(kappa/kp, alpha/ap)|
-- is fed back through both curves and the result is split along the slip
-- direction. That gives a friction circle: a tire spinning up under power or
-- locked under braking loses cornering grip, as a real tire does.

local Tire = {}

local atan = math.atan
local sin = math.sin
local sqrt = math.sqrt
local tan = math.tan
local max = math.max

export type Params = {
	LongB: number,
	LongC: number,
	LongE: number,
	LatB: number,
	LatC: number,
	LatE: number,
	Mu: number,
	NominalLoad: number,
	LoadSensitivity: number,
}

export type Curve = {
	B: number,
	C: number,
	E: number,
	peak: number, -- slip where the curve reaches D
}

local function shape(x: number, B: number, C: number, E: number): number
	local bx = B * x
	return sin(C * atan(bx - E * (bx - atan(bx))))
end

-- Slip where the curve peaks: C * atan(...) = pi/2. Found by bisection once.
local function findPeak(B: number, C: number, E: number): number
	local target = tan(math.pi / (2 * C))
	local lo, hi = 0, 10 / B
	for _ = 1, 60 do
		local mid = 0.5 * (lo + hi)
		local bx = B * mid
		if bx - E * (bx - atan(bx)) < target then
			lo = mid
		else
			hi = mid
		end
	end
	return 0.5 * (lo + hi)
end

function Tire.curves(p: Params): (Curve, Curve)
	local long = { B = p.LongB, C = p.LongC, E = p.LongE, peak = findPeak(p.LongB, p.LongC, p.LongE) }
	local lat = { B = p.LatB, C = p.LatC, E = p.LatE, peak = findPeak(p.LatB, p.LatC, p.LatE) }
	return long, lat
end

-- Peak friction coefficient at load fz: grip grows less than linearly with load,
-- which is why weight transfer (and anti-roll bars) change the balance.
function Tire.mu(p: Params, fz: number, surfaceMu: number): number
	local m = p.Mu * (1 - p.LoadSensitivity * (fz / p.NominalLoad - 1))
	return max(m, 0.2 * p.Mu) * surfaceMu
end

-- Returns (Fx, Fy) in N for slip ratio kappa, slip angle alpha (rad),
-- vertical load fz and the friction coefficient mu (from Tire.mu).
-- Fx is + along the wheel heading. Fy is + to the wheel's left when alpha > 0
-- means the contact patch slides to the right (alpha = atan(-vy / |vx|)).
function Tire.forces(long: Curve, lat: Curve, kappa: number, alpha: number, fz: number, mu: number): (number, number)
	if fz <= 0 then
		return 0, 0
	end
	local sx = kappa / long.peak
	local sy = alpha / lat.peak
	local s = sqrt(sx * sx + sy * sy)
	if s < 1e-9 then
		return 0, 0
	end
	local d = mu * fz
	local fx = d * shape(s * long.peak, long.B, long.C, long.E) * (sx / s)
	local fy = d * shape(s * lat.peak, lat.B, lat.C, lat.E) * (sy / s)
	return fx, fy
end

-- d(Fx)/d(kappa) at zero slip divided by fz: used for stability limits.
function Tire.longStiffness(long: Curve, mu: number): number
	return long.B * long.C * mu
end

return Tire
