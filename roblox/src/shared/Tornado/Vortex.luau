--!strict
-- The tornado's wind field, from its state. One field drives everything that feels the wind:
-- player and object physics (WindPhysics), damage, and the funnel's visual spin. The maths is in
-- WindField (plain numbers, shared with the offline tests); this module turns a tornado's state
-- into its parameters, follows the funnel's bent axis, and works in Vector3s.
--
-- What sets what (Config.wind; docs/tornado-physics/README.md):
--   peak wind      the EF rating is the peak 3-s, 10 m, ground-relative wind: the vortex's own
--                  peak is what is left after the forward speed and the near-ground jet
--   core radius    radius of maximum wind: at or just outside the condensation funnel, or the
--                  engine's coreRadiusM when the state carries it
--   swirl ratio    S (the engine's swirl, else typical for the rating): one-celled below ~0.3,
--                  two-celled (downdraught on the axis) by ~0.8, sub-vortices from ~1
-- Spin is cyclonic (anticlockwise seen from above), the same sense as the funnel's rings.
local Config = require(script.Parent.Config)
local State = require(script.Parent.State)
local WindField = require(script.Parent.WindField)

local Vortex = {}

local function ramp(x: number, a: number, b: number): number
	return math.clamp((x - a) / (b - a), 0, 1)
end

-- Linear lookup in a table indexed by fractional EF rating (entries for EF0..EF5).
local function byEf(list: { number }, ef: number): number
	local e = math.clamp(ef, 0, #list - 1)
	local i = math.floor(e)
	local f = e - i
	local a = list[i + 1]
	local b = list[math.min(i + 2, #list)]
	return a + (b - a) * f
end

-- Peak wind (studs/s) for a fractional EF rating.
function Vortex.peakSpeed(ef: number): number
	return byEf(Config.wind.efSpeeds, ef) * Config.STUDS_PER_METRE
end

-- Fractional EF rating for a wind speed (studs/s): for damage.
function Vortex.efFor(speed: number): number
	local speeds = Config.wind.efSpeeds
	local ms = speed / Config.STUDS_PER_METRE
	if ms <= speeds[1] then
		return ms / speeds[1] - 1 -- below EF0: negative
	end
	for i = 1, #speeds - 1 do
		if ms <= speeds[i + 1] then
			return (i - 1) + (ms - speeds[i]) / (speeds[i + 1] - speeds[i])
		end
	end
	return #speeds - 1
end

-- Radius of maximum wind at the ground (studs).
function Vortex.coreRadius(state: State.State): number
	local W = Config.wind
	local given = (state :: any).coreRadius :: number?
	if given then
		return math.max(given, 1)
	end
	return math.max(state.width * 0.5 * W.coreRadius, W.minCore * Config.STUDS_PER_METRE)
end

-- Swirl ratio: the engine's when the state carries it, else typical for the rating.
function Vortex.swirl(state: State.State): number
	return (state :: any).swirl or byEf(Config.wind.swirlByEf, state.ef)
end

-- The field's parameters for a state. Build once a frame and pass to Vortex.sample for many
-- points. ambient: the environment's wind far from the tornado (studs/s; default: the
-- tornado's own motion, so nothing changes with distance).
function Vortex.params(state: State.State, ambient: Vector3?): WindField.Params
	local W = Config.wind
	local spm = Config.STUDS_PER_METRE
	local S = Vortex.swirl(state)
	local rc = Vortex.coreRadius(state)
	local move = state.velocity
	local amb = ambient or move
	local jet = byEf(W.jetByEf, state.ef) * (1 + 0.5 * (1 - ramp(S, 0.2, 0.8)))
	-- sub-vortices from the swirl: 2 at S = 1, one more each 1/3 (up to 6), fading in from 0.9
	local subShare = ramp(S, W.multiple - 0.1, W.multiple + 0.1)
	local subCount = if subShare > 0 then math.clamp(2 + 3 * (S - W.multiple), 2, 6) else 0
	local p: WindField.Params = {
		vc = 1, -- set below
		rc = rc,
		alpha = W.alpha,
		eta = W.eta,
		z0 = W.z0 * spm,
		zj = W.jetHeight * spm,
		jet = jet,
		top = math.max(state.cloudBase, 10),
		widen = W.widen,
		inflow = byEf(W.inflowByEf, state.ef),
		depth = W.inflowDepth,
		twoCell = W.twoCell * ramp(S, W.breakdown, W.twoCellFull),
		cellWidth = W.cellWidth,
		subCount = subCount,
		subShare = subShare,
		subRadius = W.subRadius,
		subSpeed = W.subSpeed,
		subOrbit = W.subOrbit,
		subRate = W.subRate,
		subDecay = W.subDecay * spm,
		turb = W.turbulence,
		turbScale = W.turbScale,
		pulseAmp = W.pulse,
		pulsePeriod = W.pulsePeriod,
		taperIn = W.taperIn,
		taperOut = W.taperOut,
		moveX = move.X,
		moveZ = move.Z,
		ambientX = amb.X,
		ambientZ = amb.Z,
		blend = W.blend,
		seed = state.seed,
	}
	-- The rating is the ground-relative peak at 10 m on the right of the track: the vortex's own
	-- peak is what is left after the forward speed, the inflow and the jet (less a little when
	-- sub-vortices will add their own short peaks on top).
	local target = Vortex.peakSpeed(state.ef) * (1 - 0.1 * subShare)
	WindField.calibrate(p, target, W.ratingHeight * spm)
	return p
end

-- The same, remembered while the state's numbers don't change (the visuals ask every frame
-- for every puff).
local cached: { state: any, key: { any }, p: WindField.Params? } = { state = nil, key = {}, p = nil }
function Vortex.cachedParams(state: State.State): WindField.Params
	local key = cached.key
	local v = state.velocity
	local fresh = cached.state == state
		and key[1] == state.ef and key[2] == state.width and key[3] == state.cloudBase
		and key[4] == v.X and key[5] == v.Z and key[6] == state.seed
		and key[7] == (state :: any).swirl and key[8] == (state :: any).coreRadius
	if fresh and cached.p then
		return cached.p
	end
	local p = Vortex.params(state)
	cached.state = state
	cached.key = { state.ef, state.width, state.cloudBase, v.X, v.Z, state.seed, (state :: any).swirl, (state :: any).coreRadius }
	cached.p = p
	return p
end

-- The axis's position (studs) at a world height, and the height above the ground.
local function axisAt(state: State.State, y: number, time: number): (Vector3, number)
	local z = y - state.position.Y
	local h = math.clamp(z / math.max(state.cloudBase, 1), 0, 1)
	return State.centreAt(state, h, time), z
end

-- Wind (studs/s, ground-relative) at a world position and time, from prebuilt parameters.
function Vortex.sample(p: WindField.Params, state: State.State, pos: Vector3, time: number): Vector3
	local centre, z = axisAt(state, pos.Y, time)
	local wx, wy, wz = WindField.at(p, pos.X - centre.X, z, pos.Z - centre.Z, time % 8192)
	return Vector3.new(wx, wy, wz)
end

-- Wind (studs/s) at a world position. time: the shared clock (Workspace:GetServerTimeNow()).
function Vortex.windAt(state: State.State, pos: Vector3, time: number?, ambient: Vector3?): Vector3
	return Vortex.sample(Vortex.params(state, ambient), state, pos, time or 0)
end

-- Pressure deficit (Pa when studs are metres) at a world position.
function Vortex.pressureDeficit(state: State.State, pos: Vector3, time: number?): number
	local p = Vortex.cachedParams(state)
	local centre, z = axisAt(state, pos.Y, time or 0)
	local r = Vector3.new(pos.X - centre.X, 0, pos.Z - centre.Z).Magnitude
	return WindField.deficit(p, Config.wind.airDensity, r, z)
end

-- Radius (studs) of the condensation funnel the wind field would hold at height z above the
-- ground: for checking the drawn funnel against the wind (the engine draws from the same rule).
function Vortex.funnelRadius(state: State.State, z: number): number
	local p = Vortex.cachedParams(state)
	return WindField.funnelRadius(p, z, 9.81 * Config.STUDS_PER_METRE, Config.wind.condense)
end

-- Horizontal storm-relative wind speed at distance r from the axis, at the rating height.
function Vortex.tangentialAt(state: State.State, r: number): number
	local p = Vortex.cachedParams(state)
	return WindField.tangential(p, r, Config.wind.ratingHeight * Config.STUDS_PER_METRE)
end

-- How fast (radians/s) the funnel visibly turns at radius r: the air's own angular speed at
-- mid-funnel (v / r from the field), times Config.puffs.spinShare, capped for narrow ropes.
function Vortex.spinRate(state: State.State, r: number): number
	local P = Config.puffs
	local p = Vortex.cachedParams(state)
	local rr = math.max(r, 1)
	local v = WindField.tangential(p, rr, 0.5 * state.cloudBase)
	return math.min(v * P.spinShare / rr, P.maxSpinRate)
end

return Vortex
