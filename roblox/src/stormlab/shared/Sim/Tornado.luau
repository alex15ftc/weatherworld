--!nonstrict
-- A tornado's life (guide sections 6 and 7), owned by the server and replicated to clients as the
-- Vortex.State its wind field is built from. A tornado is never spawned at full strength: it is
-- fed by its parent's low-level circulation (a supercell's low-level mesocyclone or a line's
-- mesovortex: any table with x, y of the circulation, vlow, rlow, wLow, cloudBase, rfdDeficit,
-- occl, u, v, dead) and evolves with it:
--   genesis       organisation O rises from 0 over ~1-2 min (a dust whirl under the lowering
--                 first; condensation follows as the pressure deficit deepens)
--   strength      partial angular-momentum contraction of the parent circulation onto the core:
--                 vc ~ q vlow (rlow / rc)^0.4, q the quality of near-ground stretching (warm RFD,
--                 low LCL) x a per-tornado organisation factor; pulses on ~40 s and ~4 min cycles
--   structure     swirl ratio S ~ circulation / (updraft x inflow depth): narrow one-celled at
--                 low S, wide two-celled and multi-vortex at high S; core radius grows with S
--   track         the contact follows the low-level circulation; as the parent occludes the
--                 circulation drifts to the storm's rear-left and the track turns left
--   dissipation   when the supply weakens, the RFD under it turns cold, or the parent dies: the
--                 contact lags (the axis tilts and stretches, travelling waves grow: rope), the
--                 core narrows and vc decays; the funnel lifts while the debris cloud lingers
local function dep(name: string): any
	if script then
		return require((script :: any).Parent:FindFirstChild(name))
	end
	return (require :: any)("./" .. name)
end
local Noise = dep("Noise")
local Vortex = dep("Vortex")
local Storm = dep("Storm") -- (Storm.rfdOutflow; Storm does not require Tornado)

local Tornado = {}

local exp, sqrt = math.exp, math.sqrt

local function ramp(x: number, a: number, b: number): number
	return math.clamp((x - a) / (b - a), 0, 1)
end

export type Tornado = { [string]: any }

local nextId = 0

function Tornado.new(parent: any, world: any): Tornado
	nextId += 1
	local seed = (parent.seed or 1) * 31 + nextId * 977
	local rng = Noise.rng(seed)
	local eu, ev = world.env:windAt(parent.x, parent.y, 300)
	-- the incipient vortex is the parent's near-ground circulation before the updraft has
	-- stretched it: as wide and as high in swirl as that circulation makes it (stepped below). How
	-- it forms then follows from the parent: a narrow one condenses as a thin funnel lowering, a
	-- wide one as a broad bowl, a high cloud base leaves only a ground whirl at first, a wide slow
	-- one starts as several small vortices round a broad centre that draw together. (All started
	-- as the same 40 m, swirl 0.2 vortex, 2026-10-29)
	local s0 = Tornado.swirlOf(parent, 0)
	local _, rlow0 = Tornado.supply(parent)
	local t: Tornado = {
		id = string.format("T%02d", nextId),
		parentId = parent.id,
		parentKind = parent.kind or "cell",
		x = parent.x, y = parent.y,
		ut = parent.u or 0, vt = parent.v or 0,
		envU = eu, envV = ev,
		vc = 8,
		rc = math.clamp(0.05 * rlow0 * (0.5 + 2.2 * s0), 15, 900),
		swirl = s0,
		inflow = 0.55,
		cloudBase = parent.cloudBase or 800,
		topX = 0, topY = 0,
		bendX = 0, bendY = 0,
		wave = 0,
		seed = seed % 100000,
		time = 0,
		-- lifecycle
		age = 0,
		O = 0, -- organisation 0..1
		decay = 0, -- 0..1 (dissipation progress)
		quality = math.clamp(exp(0.32 * rng:normal()), 0.55, 1.8),
		peak = 0,
		ef = -1,
		peakEf = -1,
		stage = "organizing",
		ended = false,
		endedFor = 0,
		track = {},
		lagX = 0, lagY = 0,
		bendPhase = rng:range(0, 6.28),
		pathLength = 0,
	}
	return t
end

-- The parent circulation's numbers in a common form.
function Tornado.supply(parent: any): (number, number, number, number, number)
	return math.abs(parent.vlow or 0), parent.rlow or 1500, parent.wLow or 15, parent.rfdDeficit or 0, parent.cloudBase or 900
end

-- the swirl ratio (circulation over the updraft's mass flux, Davies-Jones 1973) of the vortex fed
-- by this parent, organised to O: before the updraft has organised over it (O = 0) the flux
-- through it is ~half its full value, so a young vortex has ~2 times the swirl - broad, and
-- multi-vortex where the circulation is wide - and contracts as it organises
function Tornado.swirlOf(parent: any, O: number): number
	local vlow, rlow, wLow = Tornado.supply(parent)
	local S = 0.25 * (vlow * rlow) / (2 * math.max(5, wLow) * 350)
	return math.clamp(S / (0.5 + 0.5 * math.clamp(O, 0, 1)), 0.08, 2.2)
end

-- Where the engine's tornado is `age` s after its update: carried with the storm, and while it
-- occludes revolving round its mesocyclone (eng.omega, rad/s, counterclockwise seen from above;
-- the engine's occlusion orbit: js/storms/TornadoEngine.js). A strong tornado under a slow storm
-- revolves faster than the storm moves, and its track loops.
local function engineAt(eng: any, age: number): (number, number)
	local w = eng.omega or 0
	if w == 0 or not eng.cx then
		return eng.x + eng.u * age, eng.y + eng.v * age
	end
	local a = w * age
	local c, s_ = math.cos(a), math.sin(a)
	local dx, dy = eng.x - eng.cx, eng.y - eng.cy
	return eng.cx + eng.u * age + dx * c - dy * s_, eng.cy + eng.v * age + dx * s_ + dy * c
end

-- The weather engine's word on a tornado (the game: server/StormHost each poll). et: the engine's
-- { mph, yards, ef, orbit? } or nil once it has lifted; x, y: where it is at lab time `at` (lab
-- metres); u, v: its storm's motion; cx, cy: its mesocyclone then (for et.orbit, rad/s). A jump
-- from where the last update carried it is eased away (Tornado.step).
function Tornado.setEngine(t: Tornado, et: any?, x: number, y: number, u: number, v: number, at: number, cx: number?, cy: number?)
	local old = t.eng
	if not et then
		if old then
			old.on = false
		end
		return
	end
	local ox, oy = 0, 0
	if old then
		local wx, wy = engineAt(old, at - old.at)
		ox = old.ox + wx - x
		oy = old.oy + wy - y
	else
		-- (a new tornado starts where the engine's is, not at its parent's centre)
		t.x, t.y = x, y
	end
	t.eng = { on = true, mph = et.mph or 0, yards = et.yards or 100, x = x, y = y, u = u, v = v, at = at, ox = ox, oy = oy,
		omega = if cx then et.orbit or 0 else 0, cx = cx, cy = cy }
end

function Tornado.step(t: Tornado, dt: number, parent: any?, world: any)
	t.age += dt
	t.time = (t.time + dt) % 8192
	-- the sub-vortices' orbit angle, integrated (Vortex: p.orbit)
	t.orbit = (t.orbit or 0) + (if t.params then t.params.sOrbit else 0) * dt
	if t.ended then
		t.endedFor += dt
		return
	end
	-- held (lab visual tests): the life stage stays put; it keeps moving and animating
	if t.hold then
		-- (it still follows its parent's low-level circulation, so it stays in the storm's
		-- hook and couplet; without a parent it drifts at its own motion)
		if parent and not parent.dead then
			t.x += (parent.u or 0) * dt + (parent.x - t.x) * (1 - exp(-dt / 50))
			t.y += (parent.v or 0) * dt + (parent.y - t.y) * (1 - exp(-dt / 50))
		else
			t.x += t.ut * dt
			t.y += t.vt * dt
		end
		return
	end
	local vlow, rlow, wLow, rfdDef, cloudBase = 0, 1500, 10, 0, t.cloudBase
	local alive = parent ~= nil and not parent.dead
	if parent then
		vlow, rlow, wLow, rfdDef, cloudBase = Tornado.supply(parent)
	end
	t.cloudBase += (math.clamp(cloudBase, 150, 2500) - t.cloudBase) * (1 - exp(-dt / 60))
	-- an engine tornado (Tornado.setEngine): on the ground while the engine says so, as strong and
	-- as wide as it says, where it says; its shape (tilt, bend, rope, sub-vortices) is drawn here
	local eng = t.eng
	if eng then
		alive = eng.on
	end

	-- organisation and dissipation
	local warm = math.clamp(1 - (rfdDef - 1.5) / 3.5, 0, 1)
	-- (and once its parent has occluded - the RFD gust front wrapped round it - it is cut off
	-- from the warm inflow: Storm.occlusionFactor cuts the parent there too. Without it a tornado
	-- under an occluded storm faded in place for ~10 min as a "mature" EF0, 2026-10-29)
	-- (at 0.6: the RFD has wrapped round the low-level circulation by then. At 0.8 the tornado had
	-- followed its parent's weakening spin down for ~10 min and was a weak uncondensed vortex by
	-- the time it was cut off: no rope stage, 2026-10-29)
	local cutOff = parent ~= nil and (parent.occl or 0) >= 0.6
	local supplyOk = alive and vlow > 6 and warm > 0.15 and not cutOff
	local tiltM = sqrt(t.topX * t.topX + t.topY * t.topY)
	local tiltLen = tiltM
	if eng then
		supplyOk, tiltM = eng.on, 0
	end
	-- (the RFD undercutting the circulation: once the contact lags more than ~1.2 cloud-base
	-- heights behind the circulation aloft it is cut off from the updraft - NWS spotter guide:
	-- the RFD "undercuts the surface circulation" and the rope stage begins. At 2.2 every rope was
	-- already tilted past twice the base height when it began, 2026-10-29)
	if supplyOk and tiltM < 1.0 * t.cloudBase then
		t.O = math.min(1, t.O + dt / 90)
		t.decay = math.max(0, t.decay - dt / 600)
		if t.decay <= 0 then
			t.cut = nil
		end
	else
		t.decay = math.min(1, t.decay + dt / 150)
		-- cut off, the vortex carries the circulation it had: its parent's low-level spin, still
		-- weakening as the storm occludes, no longer sets it (it is no longer fed from there).
		-- Tracking it, a cut-off tornado faded with its parent instead of narrowing into a rope
		-- that "can still be dangerous" (NWS spotter guide, tornado life cycle), 2026-10-29
		if not t.cut and alive and not eng then
			t.cut = { vlow = vlow, rlow = rlow, wLow = wLow }
		end
	end
	if t.cut then
		vlow = math.max(vlow, t.cut.vlow)
		rlow, wLow = t.cut.rlow, t.cut.wLow
	end
	-- strength from the parent circulation
	local S = Tornado.swirlOf({ vlow = vlow, rlow = rlow, wLow = wLow }, t.O)
	S *= 1 - 0.6 * t.decay -- narrowing as it ropes out
	t.swirl += (S - t.swirl) * (1 - exp(-dt / 90))
	local rc0 = 0.05 * rlow
	-- a tilted vortex is a stretched one: its length from the ground to the cloud base grows
	-- with the tilt, and stretched with its volume and circulation kept the core narrows as
	-- 1 / sqrt(length) - why a rope-out is thin - and spins up through vT's (rlow / rc)^0.4 below
	-- (dividing vT by it as well counted the spin-up twice: tilt, spin-up and lag fed each other
	-- to a 115 m/s rope, 2026-10-29)
	local stretchK = sqrt(t.cloudBase / sqrt(t.cloudBase * t.cloudBase + tiltLen * tiltLen + 1))
	local rcT = rc0 * (0.5 + 2.2 * t.swirl) * (1 - 0.6 * t.decay) * stretchK
	if eng then
		-- the engine's damage-path width is about four core radii across
		rcT = 0.25 * eng.yards * 0.9144 * (1 - 0.6 * t.decay) * stretchK
	end
	t.rc += (math.clamp(rcT, 15, 900) - t.rc) * (1 - exp(-dt / 60))
	local pulse = 1 + 0.12 * Noise.value1(t.age / 40, t.seed) + 0.2 * Noise.value1(t.age / 240, t.seed + 3)
	-- (Tornado.VC_EFF: how much of the contraction's ideal spin-up the near-ground inflow delivers -
	-- friction, the corner flow's losses. Calibrated 2026-10-30 to the radar relation between the
	-- low-level rotational velocity and the damage rating (peak ground wind ~2x Vrot from EF0 to
	-- EF4, Thompson et al. 2017 / Smith et al. 2015, approximate): without it the core ran to
	-- 2.2x vlow, 80-117 m/s at vlow 20-27, and 30 of 84 squall-line tornadoes rated EF5)
	-- (OFF by default - Tornado.VC_EFF = 0.42 for the calibrated strength: the lab wants dramatic
	-- tornadoes to look at, realism of strength doesn't matter there, user 2026-10-30)
	local q = t.quality * (0.45 + 0.4 * warm) * (Tornado.VC_EFF or 1)
	local vT = q * vlow * (rlow / math.max(15, t.rc)) ^ 0.4 * pulse
	if eng then
		-- core wind scaled until the vortex's peak ground wind (the rating below) is the engine's
		-- (its translation and swirl are in that peak, so this is a feedback, not a formula)
		local target = eng.mph * 0.44704
		local peak = t.peakWind or 0
		local scale = if peak > 1 then math.clamp(target / peak, 0.5, 2) else 2
		vT = math.max(8, t.vc) * scale
	end
	-- dissipating: the core narrows (rcT x (1 - 0.6 decay), stretched) while the circulation it
	-- carries is spent late - cut off, a vortex spins down over minutes, slower than it narrows -
	-- and the core wind is circulation / radius: a roping-out funnel stays spun up and condensed
	-- until late, then lifts (NWS spotter guide: the rope "can still be dangerous"). With the
	-- circulation x (1 - decay) the rope had ~20 m/s and no condensed funnel, 2026-10-29
	vT *= (0.25 + 0.75 * t.O) * (1 - t.decay * t.decay) / (1 - 0.6 * t.decay)
	if not alive then
		vT = 0
	end
	t.vc += (vT - t.vc) * (1 - exp(-dt / (if vT > t.vc then 45 else 90)))
	t.inflow = 0.6 - 0.15 * ramp(t.swirl, 0.3, 1.2)

	-- track: the contact follows the circulation; the top stays under it at the cloud base
	local px, py = t.x, t.y
	local pu, pv = t.ut, t.vt
	if eng then
		-- the engine's track: carried on along its motion since the last update (held still while
		-- the engine's clock is paused), a jump between updates eased away over ~60 s
		if world.holdStill then
			eng.x, eng.y = t.x - eng.ox, t.y - eng.oy
			eng.cx, eng.omega = nil, 0
			eng.at = world.time
		end
		local keep = exp(-dt / 60)
		eng.ox *= keep
		eng.oy *= keep
		local wx, wy = engineAt(eng, world.time - eng.at)
		t.x = wx + eng.ox
		t.y = wy + eng.oy
		-- the top stays under the parent's circulation at the cloud base (the tilt)
		if parent then
			t.topX += ((parent.x - t.x) - t.topX) * (1 - exp(-dt / 20))
			t.topY += ((parent.y - t.y) - t.topY) * (1 - exp(-dt / 20))
		end
	elseif parent then
		local cx, cy = parent.x, parent.y
		-- a dissipating vortex's base lags behind: the dying circulation loses its hold on the
		-- contact and the outflow drags the foot out. (A 2000 decay^3 term here dragged ropes to
		-- ~4 times the cloud base height sideways - near flat, which the user disliked, 2026-10-29;
		-- the rope now starts sooner instead, below)
		local follow = 50 + 50 * t.decay
		local du, dv = (parent.u or 0), (parent.v or 0)
		-- the rear-flank outflow at the ground pushes the contact while the top stays under the
		-- meso aloft: a strong vortex is held by its parent (a small lean, 10-30 deg), a dissipating
		-- one is dragged off and stretched into a rope (docs/tornado-reference/NOTES.md: the
		-- contact is pushed by RFD outflow while the top follows the meso). A vortex is carried by
		-- the air round it, so the whole outflow moves the contact; the parent's pull (follow)
		-- holds it back, so the lean is outflow x follow time.
		-- (Without this the contact followed the parent exactly and ropes stood upright, 2026-10-29)
		local ou, ov = 0, 0
		if parent.storm and not world.holdStill then
			-- (until the RFD wraps round it the tornado sits where the RFD outflow meets the inflow
			-- and the two largely cancel: only the wrapped share pushes - the occlusion, or the
			-- vortex losing its hold as it decays. The full outflow leaned tornadoes 1.5 cloud-base
			-- heights during genesis, and with the storm's whole wind - whose inflow converges on
			-- the updraft, not the tornado - too, 2026-10-29)
			local wrap = math.max(0.5 * t.decay, ramp(parent.occl or 0, 0.4, 0.8))
			local uu, vv = Storm.rfdOutflow(parent.storm, t.x, t.y)
			ou, ov = wrap * uu, wrap * vv
		end
		local nx = t.x + (du + ou) * dt + (cx - t.x) * (1 - exp(-dt / follow))
		local ny = t.y + (dv + ov) * dt + (cy - t.y) * (1 - exp(-dt / follow))
		-- a little trochoidal wobble of the contact (the vortex's own wandering)
		local wob = 0.25 * t.rc
		nx += wob * (Noise.value1(t.age / 17, t.seed + 21) - Noise.value1((t.age - dt) / 17, t.seed + 21))
		ny += wob * (Noise.value1(t.age / 19, t.seed + 23) - Noise.value1((t.age - dt) / 19, t.seed + 23))
		t.x, t.y = nx, ny
		t.topX += ((cx - t.x) - t.topX) * (1 - exp(-dt / 20))
		t.topY += ((cy - t.y) - t.topY) * (1 - exp(-dt / 20))
	else
		t.x += t.ut * dt
		t.y += t.vt * dt
	end
	if eng then
		-- the engine's motion (none while it is paused): easing away an update's jump is not
		-- motion, and the translation adds to the ground wind the rating reads
		local hold = world.holdStill
		t.ut = if hold then 0 else eng.u
		t.vt = if hold then 0 else eng.v
		if not hold and (eng.omega or 0) ~= 0 and eng.cx then
			-- (plus its revolution round the mesocyclone: omega x its offset from it)
			local age = world.time - eng.at
			local rx = t.x - (eng.cx + eng.u * age)
			local ry = t.y - (eng.cy + eng.v * age)
			t.ut -= eng.omega * ry
			t.vt += eng.omega * rx
		end
	else
		local mu, mv = (t.x - px) / dt, (t.y - py) / dt
		t.ut += (mu - pu) * (1 - exp(-dt / 8))
		t.vt += (mv - pv) * (1 - exp(-dt / 8))
	end
	t.pathLength += sqrt((t.x - px) ^ 2 + (t.y - py) ^ 2)
	local eu, ev = world.env:windAt(t.x, t.y, 300)
	t.envU, t.envV = eu, ev

	-- axis shape: an S-bend that grows with tilt; travelling waves when thin and stretched
	tiltM = sqrt(t.topX * t.topX + t.topY * t.topY)
	local stretch = tiltM / math.max(200, t.cloudBase)
	local thin = ramp(1 / math.max(0.05, t.rc / 100), 0.6, 2.5)
	local bendAmp = (0.12 + 0.25 * stretch) * t.cloudBase * 0.3 * (0.3 + 0.7 * thin)
	t.bendPhase += dt * 0.05
	t.bendX = bendAmp * math.cos(t.bendPhase) * (0.5 + 0.5 * Noise.value1(t.age / 60, t.seed + 31))
	t.bendY = bendAmp * math.sin(t.bendPhase) * (0.5 + 0.5 * Noise.value1(t.age / 60, t.seed + 37))
	t.wave = math.clamp((0.15 + 1.6 * t.decay + 0.4 * stretch) * t.rc * thin, 0, 0.35 * t.cloudBase)

	-- rating and stage
	if t.vc > 5 then
		local p = Vortex.params(t :: any)
		local pk = Vortex.peakWind(p)
		t.peakWind = pk
		t.ef = Vortex.efOf(pk)
		t.peak = math.max(t.peak, pk)
		t.peakEf = math.max(t.peakEf, t.ef)
		t.funnelGround = Vortex.condensationRadius(t :: any, 5)
	else
		t.peakWind = 0
		t.ef = -1
		t.funnelGround = 0
	end
	if t.O < 0.98 and t.decay < 0.05 then
		t.stage = "organizing"
	elseif t.decay < 0.05 then
		t.stage = if t.swirl > 1.0 then "mature (multi-vortex)" else "mature"
	-- (NWS spotter guide: shrinking, then the rope stage - thin, often contorted - then gone. Named
	-- by how far it has narrowed, not by its tilt: a rope need not lie far over)
	elseif t.decay < 0.3 and stretch <= 1.0 then
		t.stage = "shrinking"
	elseif t.decay < 0.85 then
		t.stage = "rope"
	else
		t.stage = "dissipating"
	end
	-- lofted debris (what radar sees as a debris signature): needs winds that lift loose soil and
	-- wreckage, and something on the ground to lift
	local soil = 0.7
	if world.groundAt then
		soil = world:groundAt(t.x, t.y)
	end
	local pk = t.peakWind or 0
	t.debrisLoft = math.clamp((pk - 30) / 45, 0, 1) * math.clamp(soil + (t.wreckage or 0), 0, 1) * t.O
	t.debrisTop = math.clamp(30 * (pk - 25), 0, 3000)
	-- the record
	if #t.track == 0 or t.age - t.track[#t.track][1] >= 5 then
		table.insert(t.track, { t.age, t.x, t.y, t.peakWind, t.rc })
	end
	if t.decay >= 1 or (t.age > 60 and t.vc < 9 and t.decay > 0.4) then
		t.ended = true
		t.stage = "ended"
	end
end

-- what clients need (replicated 10-20 Hz): exactly the Vortex.State plus a few display numbers
-- (Size, 2026-10-27: this table serializes to roughly 550-650 bytes - 36 string keys plus
-- numbers and the stage string. The server sends the list of every tornado World still holds
-- (live ones and ones ended < 120 s ago, World forgets them after that) on the "tornado" remote,
-- an UnreliableRemoteEvent, whose payload limit is ~900 bytes: with TWO tornadoes in the list
-- (two live, or one live plus one that just ended) a frame is over the limit and Roblox drops it
-- (silently, every frame while both exist). Not redesigned here; the fix is a field trim / packed
-- buffer, one snapshot per send, or a reliable remote for the tornado list.)
function Tornado.snapshot(t: Tornado): { [string]: any }
	return {
		id = t.id, parentId = t.parentId, x = t.x, y = t.y, ut = t.ut, vt = t.vt, envU = t.envU, envV = t.envV,
		vc = t.vc, rc = t.rc, swirl = t.swirl, inflow = t.inflow, cloudBase = t.cloudBase,
		topX = t.topX, topY = t.topY, bendX = t.bendX, bendY = t.bendY, wave = t.wave,
		seed = t.seed, time = t.time, orbit = t.orbit, age = t.age, O = t.O, decay = t.decay, stage = t.stage,
		ef = t.ef, peakEf = t.peakEf, peakWind = t.peakWind, ended = t.ended, endedFor = t.endedFor,
		funnelGround = t.funnelGround, pathLength = t.pathLength, hold = t.hold, lab = t.lab,
		debrisLoft = t.debrisLoft, debrisTop = t.debrisTop, peak = t.peak,
	}
end

return Tornado
