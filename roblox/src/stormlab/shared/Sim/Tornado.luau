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
	local t: Tornado = {
		id = string.format("T%02d", nextId),
		parentId = parent.id,
		parentKind = parent.kind or "cell",
		x = parent.x, y = parent.y,
		ut = parent.u or 0, vt = parent.v or 0,
		envU = eu, envV = ev,
		vc = 8,
		rc = 40,
		swirl = 0.2,
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

function Tornado.step(t: Tornado, dt: number, parent: any?, world: any)
	t.age += dt
	t.time = (t.time + dt) % 8192
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

	-- organisation and dissipation
	local warm = math.clamp(1 - (rfdDef - 1.5) / 3.5, 0, 1)
	local supplyOk = alive and vlow > 6 and warm > 0.15
	local tiltM = sqrt(t.topX * t.topX + t.topY * t.topY)
	if supplyOk and tiltM < 2.2 * t.cloudBase then
		t.O = math.min(1, t.O + dt / 90)
		t.decay = math.max(0, t.decay - dt / 600)
	else
		t.decay = math.min(1, t.decay + dt / 150)
	end
	-- strength from the parent circulation
	local S = math.clamp(0.25 * (vlow * rlow) / (2 * math.max(5, wLow) * 350), 0.08, 2.2)
	S *= 1 - 0.6 * t.decay -- narrowing as it ropes out
	t.swirl += (S - t.swirl) * (1 - exp(-dt / 90))
	local rc0 = 0.05 * rlow
	local rcT = rc0 * (0.5 + 2.2 * t.swirl) * (1 - 0.45 * t.decay)
	t.rc += (math.clamp(rcT, 15, 900) - t.rc) * (1 - exp(-dt / 60))
	local pulse = 1 + 0.12 * Noise.value1(t.age / 40, t.seed) + 0.2 * Noise.value1(t.age / 240, t.seed + 3)
	local q = t.quality * (0.45 + 0.4 * warm)
	local vT = q * vlow * (rlow / math.max(15, t.rc)) ^ 0.4 * pulse
	vT *= (0.25 + 0.75 * t.O) * (1 - t.decay)
	if not alive then
		vT = 0
	end
	t.vc += (vT - t.vc) * (1 - exp(-dt / (if vT > t.vc then 45 else 90)))
	t.inflow = 0.6 - 0.15 * ramp(t.swirl, 0.3, 1.2)

	-- track: the contact follows the circulation; the top stays under it at the cloud base
	local px, py = t.x, t.y
	local pu, pv = t.ut, t.vt
	if parent then
		local cx, cy = parent.x, parent.y
		local follow = 50 + 250 * t.decay -- a dissipating vortex's base lags behind
		local du, dv = (parent.u or 0), (parent.v or 0)
		local nx = t.x + du * dt + (cx - t.x) * (1 - exp(-dt / follow))
		local ny = t.y + dv * dt + (cy - t.y) * (1 - exp(-dt / follow))
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
	local mu, mv = (t.x - px) / dt, (t.y - py) / dt
	t.ut += (mu - pu) * (1 - exp(-dt / 8))
	t.vt += (mv - pv) * (1 - exp(-dt / 8))
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
	elseif stretch > 1.0 then
		t.stage = "rope"
	elseif t.decay < 0.6 then
		t.stage = "shrinking"
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
		seed = t.seed, time = t.time, age = t.age, O = t.O, decay = t.decay, stage = t.stage,
		ef = t.ef, peakEf = t.peakEf, peakWind = t.peakWind, ended = t.ended, endedFor = t.endedFor,
		funnelGround = t.funnelGround, pathLength = t.pathLength, hold = t.hold, lab = t.lab,
		debrisLoft = t.debrisLoft, debrisTop = t.debrisTop, peak = t.peak,
	}
end

return Tornado
