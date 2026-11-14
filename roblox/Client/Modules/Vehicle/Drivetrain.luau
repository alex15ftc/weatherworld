--!strict
--!native
-- Engine -> clutch -> gearbox -> final drive -> differential -> wheels -> tires.
--
-- This runs at the engine model's own timestep (10 kHz for the presets), from
-- inside EngineAudioSimulator's step loop, so the crank the synthesizer listens
-- to is the same crank that is being loaded by the wheels. Rev-hang, bog on
-- launch, engine braking, wheelspin flare and stalling all come out of the
-- coupled physics rather than being faked in the audio.
--
-- The chassis (Roblox physics, ~60 Hz) is frozen for the frame: each wheel
-- gets its contact-patch velocity, vertical load and friction once per frame.
-- The tire forces computed on every substep are time-averaged and handed back
-- to the chassis.
--
-- Couplings that would be stiff springs (clutch, limited-slip clutch packs,
-- brakes) are solved as impulses that are clamped to their torque capacity.
-- A locked clutch therefore behaves as a rigid shaft without any spring
-- constant to tune, and a slipping one transmits exactly its capacity.
--
-- Automatic, on a car whose config has a Drivetrain.TorqueConverter, couples the engine through
-- a torque converter instead of the friction clutch (Sequential and Manual keep the clutch):
--   * the pump (impeller) absorbs (pump rpm / K)^2 N m, the capacity falling to nothing as the
--     turbine catches the pump past the coupling point; the turbine gets that times the torque
--     ratio, StallTorqueRatio at a stalled turbine down to 1 at the coupling point. So the
--     engine flares to its stall speed on a launch, creeps at idle in gear, is held against the
--     brake, and pulls through a shift without a break in drive.
--   * on overrun (the wheels driving) the coupling runs backwards, weaker (OverrunK).
--   * a lockup clutch (the `clutch` engagement, ClutchMaxTorque) closes in LockupGear and up,
--     above LockupSpeed and below LockupThrottle; it opens for a shift or a stab of throttle.
--
-- A car whose config has a Drivetrain.TransferCase can drive its other axle too (part time, as on
-- a truck): "2H" drives the driven axle only; "4H" locks the front and rear driveshafts together
-- (no centre differential: each axle keeps its own); "4L" does the same through the low range
-- (LowRatio). 2H and 4H change on the move below MaxShiftSpeed, low range only below
-- MaxLowShiftSpeed.

local Tire = require(script.Parent.Tire)

local abs = math.abs
local atan = math.atan
local max = math.max
local min = math.min
local clamp = math.clamp

local TAU = 2 * math.pi
local RPM = 60 / TAU

-- Below these contact speeds the slip definitions are blended to finite values.
-- The longitudinal update is implicit, so V_LOW_LONG only shapes low-speed feel.
local V_LOW_LONG = 0.5
local V_LOW_LAT = 2.0

export type Wheel = {
	Name: string,
	Side: number, -- -1 left, +1 right
	Front: boolean,
	Driven: boolean,
	Steered: boolean,
	Radius: number,
	Inertia: number,

	omega: number, -- rad/s, + = rolling forward

	-- Set by the chassis once per frame
	grounded: boolean,
	vx: number, -- contact patch velocity along the wheel heading, m/s
	vy: number, -- ... along the wheel's left axis
	fz: number, -- vertical load, N
	mu: number, -- peak friction (surface * load sensitivity)
	brakeTorque: number, -- N m requested by the pedal (ABS can release it)
	handbrakeTorque: number, -- N m from the handbrake: a cable, so no ABS
	tcsBrake: number, -- N m added by traction control
	escBrake: number, -- N m added by stability control (set by the chassis)

	-- Results (averaged over the frame)
	fx: number,
	fy: number,
	kappa: number,
	alpha: number,
	absActive: boolean,

	-- accumulators
	_fxSum: number,
	_fySum: number,
}

local Drivetrain = {}
Drivetrain.__index = Drivetrain

export type Mode = "Automatic" | "Sequential" | "Manual"
export type Transfer = "2H" | "4H" | "4L"

export type Engine = {
	omega: number,
	throttle: number,
	ignition: boolean,
	starter: boolean,
	inertia: number,
	preset: { IdleRpm: number, Redline: number },
	getRpm: (any) -> number,
	getRedline: (any) -> number,
	-- EngineSim.FuelMap: ignition cut settings for flat (no-lift) upshifts
	fuelMap: any?,
	cutSpark: ((any, number) -> ())?,
}

export type Drivetrain = typeof(setmetatable({} :: {
	config: any,
	wheels: { Wheel },
	driven: { Wheel },
	-- the other axle, driven through the transfer case in 4H / 4L (nil without one)
	frontAxle: { Wheel }?,
	transferCase: any?,
	transfer: Transfer,
	longCurve: Tire.Curve,
	latCurve: Tire.Curve,

	gear: number, -- -1 reverse, 0 neutral, 1..n
	-- "Automatic": TCU picks gears, auto clutch
	-- "Sequential": you pick gears (E/Q), auto clutch with anti-stall
	-- "Manual": you pick gears AND work the clutch; nothing stops a stall
	mode: Mode,
	automatic: boolean,
	manualClutch: boolean,
	clutch: number, -- current engagement 0..1
	clutchPedal: number, -- manual input 0..1 (1 = pedal down)
	shiftTimer: number,
	shiftLength: number, -- s, length of the shift in progress
	pendingGear: number?,
	-- flat shift: an upshift with the throttle held cuts the spark instead
	-- (the engine's FuelMap settings, seen at the last updateControls)
	flatShiftMap: any?,
	cutRequest: boolean,
	flatShifting: boolean,
	throttleInput: number,
	abs: boolean,
	tcs: boolean,
	tcsFactor: number, -- 0..1 engine torque request allowed by traction control
	shiftHold: number, -- s, blocks the automatic from hunting after a shift

	-- torque converter (Automatic only; nil = the auto clutch)
	converter: any?,
	converterRatio: number, -- turbine / pump speed, telemetry
	-- telemetry
	clutchTorque: number,
	wheelTorque: number,
	simTime: number,
	_clutchImpulse: number,
}, Drivetrain))

function Drivetrain.new(config: any, wheels: { Wheel }): Drivetrain
	local long, lat = Tire.curves(config.Tire)
	local driven = {}
	for _, w in wheels do
		if w.Driven then
			table.insert(driven, w)
		end
	end
	assert(#driven == 2, "Drivetrain expects one driven axle (2 wheels)")
	local transferCase = config.Drivetrain.TransferCase
	local frontAxle: { Wheel }? = nil
	if transferCase then
		local other = {}
		for _, w in wheels do
			if not w.Driven then
				table.insert(other, w)
			end
		end
		assert(#other == 2, "a transfer case needs the other axle (2 wheels)")
		frontAxle = other
	end

	return setmetatable({
		config = config,
		wheels = wheels,
		driven = driven,
		frontAxle = frontAxle,
		transferCase = transferCase,
		transfer = "2H" :: Transfer,
		longCurve = long,
		latCurve = lat,
		gear = 1,
		mode = "Automatic" :: Mode,
		automatic = true,
		manualClutch = false,
		clutch = 0,
		clutchPedal = 0,
		shiftTimer = 0,
		shiftLength = 0,
		pendingGear = nil,
		flatShiftMap = nil,
		cutRequest = false,
		flatShifting = false,
		throttleInput = 0,
		abs = config.Assists.ABS,
		tcs = config.Assists.TCS,
		tcsFactor = 1,
		shiftHold = 0,
		converter = config.Drivetrain.TorqueConverter,
		converterRatio = 0,
		clutchTorque = 0,
		wheelTorque = 0,
		simTime = 0,
		_clutchImpulse = 0,
	}, Drivetrain)
end

function Drivetrain.ratio(self: Drivetrain, gear: number?): number
	local g = gear or self.gear
	local dt = self.config.Drivetrain
	local low = if self.transfer == "4L" then self.transferCase.LowRatio else 1
	if g == 0 then
		return 0
	elseif g < 0 then
		return -dt.Reverse * dt.FinalDrive * low
	end
	return dt.Gears[g] * dt.FinalDrive * low
end

-- Whether both axles are driven (4H or 4L).
function Drivetrain.fourWheel(self: Drivetrain): boolean
	return self.frontAxle ~= nil and self.transfer ~= "2H"
end

-- Changes the transfer case; false with a reason when it can't (no transfer case, or too fast).
function Drivetrain.setTransfer(self: Drivetrain, mode: Transfer): (boolean, string?)
	local tc = self.transferCase
	if not tc then
		return false, "No transfer case"
	end
	if mode == self.transfer then
		return true
	end
	local d = self.driven
	local speed = abs(0.5 * (d[1].omega + d[2].omega) * d[1].Radius)
	if (mode == "4L" or self.transfer == "4L") and speed > tc.MaxLowShiftSpeed then
		return false, "Stop to shift the low range"
	end
	if speed > tc.MaxShiftSpeed then
		return false, "Too fast to shift the transfer case"
	end
	self.transfer = mode
	return true
end

-- Whether the torque converter couples the engine (Automatic on a car that has one).
function Drivetrain.usesConverter(self: Drivetrain): boolean
	return self.automatic and self.converter ~= nil
end

-- Mean driven-wheel speed seen at the clutch, in rad/s.
function Drivetrain.outputSpeed(self: Drivetrain, gear: number?): number
	local d = self.driven
	return self:ratio(gear) * 0.5 * (d[1].omega + d[2].omega)
end

function Drivetrain.isShifting(self: Drivetrain): boolean
	return self.shiftTimer > 0
end

function Drivetrain.setMode(self: Drivetrain, mode: Mode)
	self.mode = mode
	self.automatic = mode == "Automatic"
	self.manualClutch = mode == "Manual"
end

-- Returns false with a reason when a manual shift is refused.
function Drivetrain.shift(self: Drivetrain, target: number): (boolean, string?)
	local n = #self.config.Drivetrain.Gears
	target = clamp(target, -1, n)
	if target == self.gear and not self.pendingGear then
		return true
	end
	-- Flat shift: an upshift with the throttle held and the ignition cut
	-- enabled. The cut unloads the gearbox, so it needs no clutch or lift.
	local map = self.flatShiftMap
	local flat = map ~= nil and map.IgnitionCut and self.gear > 0 and target > self.gear
		and self.throttleInput >= map.CutThrottle
	if self.manualClutch and target ~= 0 and not flat then
		-- synchros need the clutch out of the way; reverse has none
		if self.clutchPedal < 0.6 then
			return false, "Grind! Clutch in to shift"
		end
		local d = self.driven
		local wheelSpeed = 0.5 * (d[1].omega + d[2].omega) * d[1].Radius
		if target < 0 and wheelSpeed > 1.5 then
			return false, "Grind! Stop before selecting reverse"
		end
	end
	self.pendingGear = target
	if flat then
		-- the gear goes in during the cut, quicker than a lifted shift
		self.shiftLength = math.min(self.config.Drivetrain.ShiftTime, math.max(0.05, map.CutTime))
		self.cutRequest = true
	else
		self.shiftLength = self.config.Drivetrain.ShiftTime
	end
	self.flatShifting = flat
	self.shiftTimer = self.shiftLength
	self.shiftHold = 1.0
	return true
end

---------------------------------------------------------------------------
-- Frame-rate control: shift timing, automatic gear choice, clutch actuator
---------------------------------------------------------------------------

local function smoothstep(e0: number, e1: number, x: number): number
	local t = clamp((x - e0) / (e1 - e0), 0, 1)
	return t * t * (3 - 2 * t)
end

function Drivetrain.updateControls(self: Drivetrain, dt: number, engine: Engine)
	local cfg = self.config.Drivetrain
	local idle = engine.preset.IdleRpm
	local rpm = engine:getRpm()
	self.flatShiftMap = engine.fuelMap

	-- Shift sequence: clutch out, change ratio halfway, clutch back in.
	if self.shiftTimer > 0 then
		self.shiftTimer -= dt
		local pending = self.pendingGear
		if pending and self.shiftTimer <= self.shiftLength * 0.5 then
			self.gear = pending
			self.pendingGear = nil
		end
		if self.shiftTimer < 0 then
			self.shiftTimer = 0
			self.flatShifting = false
		end
	end

	-- Traction control, as production systems do it: a proportional engine
	-- torque cut plus brake on the wheel that is spinning (which also stops an
	-- open/limited-slip diff from dumping torque into one wheel). Slip is taken
	-- against max(|v|, 4 m/s) so a standing start does not read as infinite.
	local worst = 0
	local front = self.frontAxle
	if front then
		for _, w in front do
			w.tcsBrake = 0
		end
	end
	local tcsWheels: { Wheel } = if front and self:fourWheel() then { self.driven[1], self.driven[2], front[1], front[2] } else self.driven
	for _, w in tcsWheels do
		w.tcsBrake = 0
		if self.tcs and w.grounded then
			local limit = self.config.Assists.TCSSlip
			local s = (w.omega * w.Radius - w.vx) / max(abs(w.vx), 4)
			local err = (s - limit) / limit
			if err > 0 then
				w.tcsBrake = min(1500, 600 * err)
			end
			worst = max(worst, err)
		end
	end
	if worst > 0 then
		self.tcsFactor = max(0.15, self.tcsFactor - dt * 3 * worst)
	else
		self.tcsFactor = min(1, self.tcsFactor + dt * 1.5)
	end

	if self.shiftHold > 0 then
		self.shiftHold -= dt
	end

	-- Automatic gear selection (forward gears only; D/R is chosen by the driver)
	if self.automatic and self.shiftTimer <= 0 and self.shiftHold <= 0 and self.gear > 0 then
		local n = #cfg.Gears
		local t = self.throttleInput
		local outRpm = self:outputSpeed() * RPM
		local redline = engine:getRedline()
		local fullThrottleUpshift = cfg.AutoUpshiftRpm + (redline - engine.preset.Redline)
		local up = 2800 + (fullThrottleUpshift - 2800) * t
		local down = 1300 + (cfg.AutoDownshiftRpm - 1300) * t
		-- (and up off the limiter: a slipping converter holds the gearbox input under the shift
		-- point while the engine is already at its limit)
		if self.gear < n and (outRpm > up or (t > 0.5 and rpm > redline - 150)) then
			self:shift(self.gear + 1)
		elseif self.gear > 1 then
			local lowerRpm = self:outputSpeed(self.gear - 1) * RPM
			local kickdown = t > 0.9 and lowerRpm < fullThrottleUpshift - 700
			if (outRpm < down or kickdown) and lowerRpm < redline - 300 then
				self:shift(self.gear - 1)
			end
		end
	end

	-- Clutch actuator. A centrifugal-style law on engine speed acts as an
	-- anti-stall: below idle the clutch opens; with throttle it bites
	-- progressively. Once the driveline is spinning above idle it stays shut.
	local target: number
	local tc = if self.automatic then self.converter else nil
	if tc then
		-- the lockup clutch: shut on a light foot at cruising speed in the top gears
		local d = self.driven
		local road = 0.5 * (d[1].omega + d[2].omega) * d[1].Radius
		local lock = self.gear >= tc.LockupGear and self.shiftTimer <= 0 and road > tc.LockupSpeed
			and self.throttleInput < tc.LockupThrottle
		target = if lock then 1 else 0
	elseif self.manualClutch then
		-- straight from the pedal: launch, slip and stall are up to the driver
		target = if self.gear == 0 then 0 else 1 - self.clutchPedal
	elseif self.gear == 0 or (self.shiftTimer > 0 and not self.flatShifting) then
		-- a flat shift keeps the clutch in: the ignition cut unloads the box
		target = 0
	else
		local lo = idle * 0.95
		local hi = idle + cfg.AutoClutchEngageRpm * (0.35 + 0.65 * self.throttleInput)
		target = smoothstep(lo, hi, rpm)
		local outRpm = abs(self:outputSpeed()) * RPM
		if outRpm > idle * 1.15 and rpm > idle * 0.9 then
			target = 1
		end
		target = min(target, 1 - self.clutchPedal)
	end
	local rate = if self.manualClutch then 40.0
		elseif tc then (if target > self.clutch then 1.5 else 20.0)
		elseif target > self.clutch then 5.0
		else 25.0
	self.clutch += clamp(target - self.clutch, -rate * dt, rate * dt)

	-- ignition cut for a flat shift started since the last frame (by the
	-- driver or by the automatic above)
	if self.cutRequest then
		self.cutRequest = false
		local map = engine.fuelMap
		if map and engine.cutSpark then
			engine.cutSpark(engine, map.CutTime)
		end
	end
end

---------------------------------------------------------------------------
-- Substep (engine rate)
---------------------------------------------------------------------------

function Drivetrain.beginFrame(self: Drivetrain)
	for _, w in self.wheels do
		w._fxSum = 0
		w._fySum = 0
		w.absActive = false
	end
	self.simTime = 0
	self._clutchImpulse = 0
end

-- Called right after engine:step(h).
function Drivetrain.step(self: Drivetrain, engine: Engine, h: number)
	local cfg = self.config
	local tireCfg = cfg.Tire
	local long, lat = self.longCurve, self.latCurve
	local rr = tireCfg.RollingResistance
	local absOn = self.abs
	local absSlip = cfg.Assists.ABSSlip
	local longK = long.B * long.C

	-- 1) Tires: contact forces from the current wheel speed. The wheel speed
	--    update is linearised-implicit in the tire's slip stiffness, so it is
	--    stable even when the contact patch is nearly stopped.
	for _, w in self.wheels do
		local r = w.Radius
		local fx, fy = 0, 0
		local pedal = w.brakeTorque
		local brake = w.handbrakeTorque + w.tcsBrake + w.escBrake
		if w.grounded and w.fz > 0 then
			local vx = w.vx
			local vxa = max(abs(vx), V_LOW_LONG)
			local kappa = (w.omega * r - vx) / vxa
			local alpha = atan(-w.vy / max(abs(vx), V_LOW_LAT))
			fx, fy = Tire.forces(long, lat, kappa, alpha, w.fz, w.mu)
			w.kappa = kappa
			w.alpha = alpha

			-- ABS: release the caliper while the wheel is past peak slip
			if absOn and pedal > 0 and kappa < -absSlip and abs(vx) > 2 then
				pedal *= 0.25
				w.absActive = true
			end

			local stiffness = longK * w.mu * w.fz * r * r / vxa -- d(torque)/d(omega)
			local torque = -fx * r
			w.omega += torque * h / (w.Inertia + stiffness * h)

			-- rolling resistance acts like a small brake
			brake += rr * w.fz * r
		else
			w.kappa = 0
			w.alpha = 0
		end
		brake += pedal
		w._fxSum += fx * h
		w._fySum += fy * h

		-- 2) Brakes (Coulomb friction: can hold the wheel at exactly zero)
		if brake > 0 then
			local dw = brake * h / w.Inertia
			local o = w.omega
			if abs(o) <= dw then
				w.omega = 0
			elseif o > 0 then
				w.omega = o - dw
			else
				w.omega = o + dw
			end
		end
	end

	-- 3) Clutch: impulse that would make engine and gearbox input turn together,
	--    clamped to what the friction plate can carry this substep.
	local ratio = self:ratio()
	local wl, wr = self.driven[1], self.driven[2]
	local clutchJ = 0
	local tc = if self.automatic then self.converter else nil
	if ratio ~= 0 and (self.clutch > 0 or tc) then
		local Ie = engine.inertia
		local invIout = ratio * ratio * 0.25 * (1 / wl.Inertia + 1 / wr.Inertia)
		local front = self.frontAxle
		if front and self:fourWheel() then
			-- the gearbox turns all four wheels together through the locked transfer case
			invIout = ratio * ratio / (wl.Inertia + wr.Inertia + front[1].Inertia + front[2].Inertia)
		end
		-- impulse at the engine (pumpJ) and at the gearbox input (turbineJ)
		local pumpJ, turbineJ = 0, 0
		if tc then
			local wp = engine.omega
			local wt = ratio * 0.5 * (wl.omega + wr.omega)
			local c = tc.CouplingPoint
			if wp >= wt then
				-- drive: the pump turns the turbine
				local sr = if wp > 1e-3 then clamp(wt / wp, 0, 1) else 1
				local capacity = if sr <= c then 1 else (1 - sr) / (1 - c)
				local n = wp * RPM / tc.K
				local tp = n * n * capacity
				local tr = if sr < c then tc.StallTorqueRatio - (tc.StallTorqueRatio - 1) * sr / c else 1
				pumpJ, turbineJ = tp * h, tp * tr * h
				self.converterRatio = sr
			else
				-- overrun: the turbine turns the pump, as a plain (weaker) coupling
				local sr = clamp(wp / wt, 0, 1)
				local capacity = if sr <= c then 1 else (1 - sr) / (1 - c)
				local n = wt * RPM / tc.OverrunK
				local tp = n * n * capacity
				pumpJ, turbineJ = -tp * h, -tp * h
				self.converterRatio = wt / max(wp, 1e-3)
			end
		end
		-- the clutch (or the converter's lockup clutch) on whatever slip is left
		if self.clutch > 0 then
			local slip = (engine.omega - pumpJ / Ie) - ratio * 0.5 * (wl.omega + wr.omega) - turbineJ * invIout
			local jLock = slip / (1 / Ie + invIout)
			local cap = self.clutch * cfg.Drivetrain.ClutchMaxTorque * h
			clutchJ = clamp(jLock, -cap, cap)
		end
		pumpJ += clutchJ
		turbineJ += clutchJ

		engine.omega -= pumpJ / Ie
		if engine.omega < 0 then
			engine.omega = 0
		end

		-- Gear mesh losses: the wheels get less torque on drive, the engine gets
		-- less back on overrun.
		local eff = cfg.Drivetrain.Efficiency
		local axleJ = turbineJ * ratio * (if turbineJ * ratio > 0 then eff else 1 / eff)
		clutchJ = pumpJ
		-- Open differential splits torque equally...
		wl.omega += 0.5 * axleJ / wl.Inertia
		wr.omega += 0.5 * axleJ / wr.Inertia

		-- 4) ...a limited-slip clutch pack can then move some across.
		local diff = cfg.Drivetrain.Differential
		local lockCap: number
		if diff.Type == "Locked" then
			lockCap = math.huge
		elseif diff.Type == "LSD" then
			local lock = if axleJ * (wl.omega + wr.omega) >= 0 then diff.PowerLock else diff.CoastLock
			lockCap = (diff.Preload + lock * abs(axleJ / h)) * h
		else
			lockCap = 0
		end
		if lockCap > 0 then
			local jd = (wl.omega - wr.omega) / (1 / wl.Inertia + 1 / wr.Inertia)
			jd = clamp(jd, -lockCap, lockCap)
			wl.omega -= jd / wl.Inertia
			wr.omega += jd / wr.Inertia
		end
		self.wheelTorque = axleJ / h
	else
		self.wheelTorque = 0
		-- Neutral: a locked/limited-slip diff still couples the axle
		local diff = cfg.Drivetrain.Differential
		if diff.Type ~= "Open" then
			local cap = if diff.Type == "Locked" then math.huge else diff.Preload * h
			local jd = clamp((wl.omega - wr.omega) / (1 / wl.Inertia + 1 / wr.Inertia), -cap, cap)
			wl.omega -= jd / wl.Inertia
			wr.omega += jd / wr.Inertia
		end
	end

	-- 5) Transfer case in 4H / 4L: the front driveshaft locked to the rear one (each axle mean
	--    speed carried by its own open diff), however the torque arrived
	local front = self.frontAxle
	if front and self:fourWheel() then
		local fl, fr = front[1], front[2]
		local mobRear = 0.25 * (1 / wl.Inertia + 1 / wr.Inertia)
		local mobFront = 0.25 * (1 / fl.Inertia + 1 / fr.Inertia)
		local jc = (0.5 * (wl.omega + wr.omega) - 0.5 * (fl.omega + fr.omega)) / (mobRear + mobFront)
		wl.omega -= 0.5 * jc / wl.Inertia
		wr.omega -= 0.5 * jc / wr.Inertia
		fl.omega += 0.5 * jc / fl.Inertia
		fr.omega += 0.5 * jc / fr.Inertia
	end

	self._clutchImpulse += clutchJ
	self.simTime += h
end

function Drivetrain.endFrame(self: Drivetrain)
	local t = self.simTime
	if t <= 0 then
		for _, w in self.wheels do
			w.fx, w.fy = 0, 0
		end
		return
	end
	local inv = 1 / t
	for _, w in self.wheels do
		w.fx = w._fxSum * inv
		w.fy = w._fySum * inv
	end
	self.clutchTorque = self._clutchImpulse * inv
end

Drivetrain.RPM = RPM

return Drivetrain
