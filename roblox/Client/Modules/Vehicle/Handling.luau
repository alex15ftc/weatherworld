--!strict
--!native
-- Driver aids that sit between the player's inputs and the chassis. The physics
-- underneath (tires, suspension, drivetrain) is left alone: these only decide
-- what a keyboard or a thumbstick asks of it, the way a real driver's hands and
-- a real car's stability system would.
--
--   steer      turns a digital / analog input into a road-wheel angle:
--                * the lock on offer shrinks with speed to what the front tires
--                  can use: the angle of the tightest corner the grip allows at
--                  this speed, plus a little more than the slip angle where the
--                  fitted tire peaks. It follows the tire compound and the
--                  surface on its own.
--                * the wheels are also kept within that slip angle of where
--                  the front of the car is actually travelling. Holding a key
--                  at 150 km/h puts the front tires at their peak, not into 20
--                  degrees of scrubbing understeer, and a single tap of
--                  opposite lock in a slide is the right amount of it.
--                * the wheel takes the same time to reach that lock at any
--                  speed, and unwinds faster than it winds on
--                * once the car is sliding (sideslip past the tire's peak) the
--                  wheels caster towards where the car is going, as a real
--                  rack does when you loosen your grip. The driver's input is
--                  added on top, so a slide can still be held, or spun.
--   stability  ESC: compares the yaw rate with what the steering asks for and
--              the sideslip with what the tires can hold, and returns a yaw
--              moment for the chassis to make with one brake.
--
-- Signs: steering and yaw + = left (counter-clockwise from above); sideslip
-- + = the car is moving to the left of where it points.
-- No Roblox APIs, so Tools/test/handling.luau can run it offline.

local Handling = {}

local abs = math.abs
local atan = math.atan
local clamp = math.clamp
local exp = math.exp
local min = math.min
local max = math.max
local sign = math.sign
local tan = math.tan

export type SteerState = {
	frac: number, -- driver's part, -1..1 of the lock on offer
	assist: number, -- rad, caster towards the direction of travel
	travel: number, -- rad, filtered direction of travel at the front axle
	limit: number, -- rad, lock on offer at this speed (telemetry)
}

-- Defaults for cars whose config leaves these out
local SLIP_LIMIT = 1.15
local COUNTER_STEER = 0.9
local TIME_TO_LOCK = 0.25
local RETURN_TIME = 0.16
local ANALOG_TIME = 0.09
local ASSIST_TAU = 0.06 -- s
local REAR_LIMITED = 0.3

function Handling.newSteerState(): SteerState
	return { frac = 0, assist = 0, travel = 0, limit = 0 }
end

-- Returns the road-wheel angle (rad, inside wheel).
--   input      -1..1, + = left
--   analog     true for a stick (already smoothed by a thumb)
--   speed      m/s along the car's heading (negative in reverse)
--   beta       rad, sideslip at the rear axle
--   travel     rad, direction the front axle is moving in, relative to the car
--   aLat       m/s^2, lateral acceleration the front tires can make (mu * g)
--   peakSlip   rad, slip angle where the tire's lateral curve peaks
function Handling.steer(
	s: SteerState,
	cfg: any,
	dt: number,
	input: number,
	analog: boolean,
	speed: number,
	beta: number,
	travel: number,
	aLat: number,
	peakSlip: number,
	wheelbase: number
): number
	local maxAngle: number = cfg.MaxWheelAngle
	local v = abs(speed)
	local slipLimit: number = cfg.SlipLimit or SLIP_LIMIT
	local limit = maxAngle
	if v > 1 then
		limit = min(maxAngle, atan(wheelbase * aLat / (v * v)) + slipLimit * peakSlip)
	end
	s.limit = limit

	local target = clamp(input, -1, 1)
	local unwinding = target * s.frac < 0 or abs(target) < abs(s.frac)
	local t = if analog
		then ANALOG_TIME
		elseif unwinding then cfg.ReturnTime or RETURN_TIME
		else cfg.TimeToLock or TIME_TO_LOCK
	-- never faster than the rack itself
	local rate = min(1 / t, cfg.Rate / limit) * dt
	s.frac += clamp(target - s.frac, -rate, rate)

	-- Caster: nothing while the rear tires are within their peak, all of the
	-- sideslip (times CounterSteer) by a little over twice that.
	local fade = clamp((speed - 3) / 5, 0, 1)
	local k = 1 - exp(-dt / ASSIST_TAU)
	local slide = clamp((abs(beta) - peakSlip) / (1.2 * peakSlip), 0, 1)
	slide = slide * slide * (3 - 2 * slide)
	s.assist += (beta * slide * (cfg.CounterSteer or COUNTER_STEER) * fade - s.assist) * k
	s.travel += (travel * fade - s.travel) * k

	-- Window around the direction of travel; wide open at parking speeds.
	-- Turning further into the corner than the rear tires can follow only spins
	-- the car, so that side of the window closes (to REAR_LIMITED of it) as the
	-- rear passes its own peak. Opposite lock always has the whole window.
	local window = slipLimit * peakSlip
	local open = (1 - fade) * maxAngle
	local rear = clamp((abs(beta) - 0.6 * peakSlip) / (0.6 * peakSlip), 0, 1)
	rear = 1 - (1 - REAR_LIMITED) * rear * rear * (3 - 2 * rear) * fade
	local lo, hi = -window, window
	if beta < 0 then
		hi *= rear -- tail out to the right: less left lock
	else
		lo *= rear
	end
	local angle = clamp(s.frac * limit + s.assist, s.travel + lo - open, s.travel + hi + open)
	return clamp(angle, -maxAngle, maxAngle)
end

local ESC_MIN_SPEED = 8 -- m/s, fades in over the next 4
local ESC_YAW_DEADBAND = 0.12 -- rad/s
local ESC_YAW_GAIN = 6 -- 1/s
local ESC_SLIP_GAIN = 20 -- 1/s^2
local ESC_UNDERSTEER = 0.3 -- share of the yaw gain used against understeer
local ESC_CHARACTERISTIC_SPEED = 40 -- m/s, mild understeer reference

-- Yaw moment (N m, + = turn left) that would bring the car back in line; 0 when
-- it is behaving. `slipMargin` is how far past the tire's peak slip angle the
-- sideslip may go before the system steps in (rad): a loose setting lets the
-- tail move around, a tight one keeps the car on rails.
function Handling.stability(
	speed: number,
	yawRate: number,
	steer: number,
	beta: number,
	aLat: number,
	peakSlip: number,
	slipMargin: number,
	wheelbase: number,
	yawInertia: number
): number
	if speed < ESC_MIN_SPEED then
		return 0
	end
	local ratio = speed / ESC_CHARACTERISTIC_SPEED
	local wanted = speed * tan(steer) / (wheelbase * (1 + ratio * ratio))
	local most = 0.95 * aLat / speed
	wanted = clamp(wanted, -most, most)

	local err = yawRate - wanted
	local e = sign(err) * max(abs(err) - ESC_YAW_DEADBAND, 0)
	if abs(yawRate) < abs(wanted) and yawRate * wanted >= 0 then
		e *= ESC_UNDERSTEER
	end
	local b = sign(beta) * max(abs(beta) - (peakSlip + slipMargin), 0)

	local fade = clamp((speed - ESC_MIN_SPEED) / 4, 0, 1)
	return yawInertia * (ESC_SLIP_GAIN * b - ESC_YAW_GAIN * e) * fade
end

return Handling
