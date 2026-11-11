--!strict
-- A tornado's state: the small set of numbers the server owns and sends about ten times a
-- second. Clients interpolate it and build every visual from it. Motion (wobble, the travelling
-- kinks, the width pulses) comes from noise and waves keyed on the seed and the shared clock, so
-- it never crosses the network: only its strengths do.
local Config = require(script.Parent.Config)
local Shape = require(script.Parent.Shape)

local State = {}

export type State = {
	position: Vector3, -- ground contact point
	velocity: Vector3, -- studs/s (translation)
	topOffset: Vector3, -- where the funnel meets the cloud, relative to the ground point (horizontal)
	bendLow: Vector3, -- extra sideways offset of the axis a third of the way up (horizontal)
	bendHigh: Vector3, -- and two thirds of the way up: S-bends, elephant trunks, rope-outs
	width: number, -- funnel diameter at the ground, studs
	ef: number, -- intensity, fractional EF rating
	shape: { [string]: number }, -- Shape preset weights
	stage: string, -- "forming" | "descending" | "mature" | "ropeout"
	stageT: number, -- 0-1 through the stage
	cloudBase: number, -- studs above the ground point
	wobble: number, -- studs of noise sway mid-funnel
	kink: number, -- studs: strength of the helical kinks travelling up the funnel (snaking)
	pulse: number, -- share: strength of the width bulges travelling up the funnel (+ breathing)
	bottom: number, -- 0-1: where the condensation funnel ends (0 on the ground; >0 lowering or lifting)
	seed: number,
}

State.STAGES = { "forming", "descending", "mature", "ropeout" }

function State.fromProfile(profile: any, position: Vector3, cloudBase: number, seed: number): State
	local shape = {}
	for k, v in profile.shape do
		shape[k] = v
	end
	return {
		position = position,
		velocity = Vector3.zero,
		topOffset = Vector3.zero,
		bendLow = Vector3.zero,
		bendHigh = Vector3.zero,
		width = profile.width,
		ef = profile.ef,
		shape = shape,
		stage = "mature",
		stageT = 0.5,
		cloudBase = cloudBase,
		wobble = 0,
		kink = 0,
		pulse = 0,
		bottom = 0,
		seed = seed,
	}
end

-- The shared clock wrapped to keep noise inputs small (float precision); wraps every ~2.3 hours.
local function clock(time: number): number
	return time % 8192
end

-- Funnel radius (studs) at height share t (0 ground, 1 cloud base); with `time`, including the
-- width bulges that travel up the funnel and its slow breathing (Config.motion).
function State.radiusAt(state: State, t: number, time: number?): number
	local r = state.width * 0.5 * Shape.radius(state.shape, t)
	local pulse = state.pulse or 0
	if time and pulse > 0 then
		local M = Config.motion
		local tm = clock(time)
		local s = state.seed % 1000 * 0.413
		local bulge = math.noise(s + t / M.pulseLength - tm * M.pulseSpeed / M.pulseLength, 3.7, s)
		local breathe = math.sin(2 * math.pi * tm / M.breathePeriod + s)
		r *= 1 + pulse * (2 * bulge * (1 - M.breatheShare) + breathe * M.breatheShare)
	end
	local bottom = state.bottom or 0
	if bottom > 0 then
		-- a funnel lowering from (or lifting into) the cloud narrows to its tip. The tip follows a
		-- pressure surface, near a paraboloid: blunt and rounded for a wide funnel (the bowl of a
		-- lowering, ref5/ref6), sharper for a narrow one (exponent 1 = straight cone, 0.5 = bowl)
		local M = Config.motion
		local f = math.clamp((t - bottom) / M.tipLength, 0, 1)
		local wide = math.clamp(state.width / math.max(state.cloudBase * M.tipWideAt, 1), 0, 1)
		local taper = M.tipMin + (1 - M.tipMin) * f ^ (1 - M.tipRound * wide)
		-- eased in as the tip leaves the ground (and out as it touches down): no snap at contact
		local b = math.clamp(bottom / 0.1, 0, 1)
		r *= 1 + (taper - 1) * b * b * (3 - 2 * b)
	end
	return r
end

-- Sideways bend through 0 at the foot, bendLow at 1/3, bendHigh at 2/3 and 0 at the top: a
-- cubic Hermite curve, flat at both ends (leaves the ground and meets the cloud smoothly).
local function bendAt(low: Vector3, high: Vector3, t: number): Vector3
	if low == Vector3.zero and high == Vector3.zero then
		return Vector3.zero
	end
	local nodes = { Vector3.zero, low, high, Vector3.zero }
	local slopes = { Vector3.zero, (high - Vector3.zero) * 1.5, (Vector3.zero - low) * 1.5, Vector3.zero }
	local i = math.clamp(math.floor(t * 3) + 1, 1, 3)
	local s = t * 3 - (i - 1)
	local h = 1 / 3
	local s2, s3 = s * s, s * s * s
	return nodes[i] * (2 * s3 - 3 * s2 + 1)
		+ slopes[i] * h * (s3 - 2 * s2 + s)
		+ nodes[i + 1] * (-2 * s3 + 3 * s2)
		+ slopes[i + 1] * h * (s3 - s2)
end

-- Centre of the funnel at height share t, at shared clock time `time` (seconds).
function State.centreAt(state: State, t: number, time: number): Vector3
	local lean = t * t * (3 - 2 * t) -- the top leans with the storm, the foot stays put
	local p = state.position
		+ Vector3.new(0, t * state.cloudBase, 0)
		+ state.topOffset * lean
		+ bendAt(state.bendLow or Vector3.zero, state.bendHigh or Vector3.zero, t)
	local tm = clock(time)
	if state.wobble > 0 then
		local s = state.seed % 1000 * 0.731
		local amp = state.wobble * math.sin(math.pi * t)
		local nx = math.noise(s + t * 2.3, tm * 0.15, 0.5)
		local nz = math.noise(s + t * 2.3, tm * 0.15, 7.5)
		p += Vector3.new(nx, 0, nz) * amp * 2
	end
	local kink = state.kink or 0
	if kink > 0 then
		-- helical kinks travelling up the funnel (each wave turns round the axis as it climbs), so
		-- the funnel snakes in three dimensions and reads as bent from every side. Anchored in the
		-- cloud (0 at the top), swinging most mid-funnel; the foot still sways a little.
		local M = Config.motion
		local s = state.seed % 1000 * 0.577
		local total, rope = 0, state.shape.rope or 0
		for _, w in state.shape do
			total += w
		end
		local foot = M.footSway + (M.ropeFootSway - M.footSway) * (if total > 0 then rope / total else 0)
		local env = math.sin(math.pi * (foot + (1 - foot) * t))
		local off = Vector3.zero
		for k, w in M.waves do
			local amp = kink * w.weight * env * (1 + M.irregular * 2 * math.noise(s + k * 1.7, tm * 0.05, 0.3))
			local theta = 2 * math.pi * (t / w.length - tm * w.speed / w.length) + s * k
			off += Vector3.new(math.cos(theta), 0, math.sin(theta) * w.twist) * amp
		end
		p += off
	end
	return p
end

-- Direction of the funnel's axis at t (for tilting rings along a bent funnel).
function State.axisAt(state: State, t: number, time: number): Vector3
	local dt = 0.02
	local a = State.centreAt(state, math.max(t - dt, 0), time)
	local b = State.centreAt(state, math.min(t + dt, 1), time)
	local d = b - a
	return if d.Magnitude > 1e-6 then d.Unit else Vector3.yAxis
end

-- Compact form for the network: a flat array of numbers (+ the stage index).
local SHAPES = { "rope", "cone", "stovepipe", "wedge" }

function State.pack(state: State): { number }
	local stageIndex = table.find(State.STAGES, state.stage) or 3
	local out = {
		state.position.X, state.position.Y, state.position.Z,
		state.velocity.X, state.velocity.Z,
		state.topOffset.X, state.topOffset.Z,
		state.width, state.ef, stageIndex, state.stageT, state.cloudBase, state.wobble, state.seed,
	}
	for _, name in SHAPES do
		table.insert(out, state.shape[name] or 0)
	end
	local low, high = state.bendLow or Vector3.zero, state.bendHigh or Vector3.zero
	table.insert(out, low.X)
	table.insert(out, low.Z)
	table.insert(out, high.X)
	table.insert(out, high.Z)
	table.insert(out, state.kink or 0)
	table.insert(out, state.pulse or 0)
	table.insert(out, state.bottom or 0)
	table.insert(out, state.shape.horn or 0) -- added later than the others: kept at the end
	return out
end

function State.unpack(a: { number }): State
	local shape = {}
	for i, name in SHAPES do
		local w = a[14 + i]
		if w and w > 0 then
			shape[name] = w
		end
	end
	if (a[26] or 0) > 0 then
		shape.horn = a[26]
	end
	return {
		position = Vector3.new(a[1], a[2], a[3]),
		velocity = Vector3.new(a[4], 0, a[5]),
		topOffset = Vector3.new(a[6], 0, a[7]),
		bendLow = Vector3.new(a[19] or 0, 0, a[20] or 0),
		bendHigh = Vector3.new(a[21] or 0, 0, a[22] or 0),
		width = a[8],
		ef = a[9],
		stage = State.STAGES[a[10]] or "mature",
		stageT = a[11],
		cloudBase = a[12],
		wobble = a[13],
		kink = a[23] or 0,
		pulse = a[24] or 0,
		bottom = a[25] or 0,
		seed = a[14],
		shape = shape,
	}
end

-- Interpolate between two received states (a at alpha 0, b at 1).
function State.lerp(a: State, b: State, alpha: number): State
	local function mix(x: number, y: number): number
		return x + (y - x) * alpha
	end
	return {
		position = a.position:Lerp(b.position, alpha),
		velocity = a.velocity:Lerp(b.velocity, alpha),
		topOffset = a.topOffset:Lerp(b.topOffset, alpha),
		bendLow = a.bendLow:Lerp(b.bendLow, alpha),
		bendHigh = a.bendHigh:Lerp(b.bendHigh, alpha),
		width = mix(a.width, b.width),
		ef = mix(a.ef, b.ef),
		shape = Shape.blend(a.shape, b.shape, alpha),
		stage = if alpha < 0.5 then a.stage else b.stage,
		stageT = if a.stage == b.stage then mix(a.stageT, b.stageT) else b.stageT,
		cloudBase = mix(a.cloudBase, b.cloudBase),
		wobble = mix(a.wobble, b.wobble),
		kink = mix(a.kink or 0, b.kink or 0),
		pulse = mix(a.pulse or 0, b.pulse or 0),
		bottom = mix(a.bottom or 0, b.bottom or 0),
		seed = b.seed,
	}
end

return State
