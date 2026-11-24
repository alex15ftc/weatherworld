--!strict
-- What a tornado sounds like from where the listener stands: the vortex's own fields (the
-- StateAdapter entry: core wind vc, core radius rc, debris loft, sub-vortices) and the distance
-- to its axis, turned into the levels and frequencies of the sound's layers. Pure: no game
-- services, so the synth and the tests run it offline (tools/tornadoaudio).
--
-- Every relation is continuous; nothing is keyed on the tornado's stage or EF label.
--   loudness  aeroacoustic (dipole) sound power goes as U^6, so pressure as U^3; a wider vortex has
--             more of that wind (amplitude x rc), heard with spherical spreading: rc / hypot(d, rc).
--             Standing inside the core, the size no longer matters.
--   rumble    the low "freight train": large eddies scouring the ground. Wider is deeper,
--             faster is higher: f = 30 Hz (vc / 40)^0.5 (60 / rc)^0.3. Its share of the sound grows
--             with ground contact (the debris loft) and with the vortex's width.
--   roar      Aeolian (Strouhal) tones of the wind past what stands in it: f = 0.2 U / D. Branches
--             and poles (D ~ 5 cm) make the mid roar, twigs, wires and grass (D ~ 8 mm) the hiss,
--             so both climb as the wind does (the "waterfall" at 60-80 m/s).
--   churn     the vortex's asymmetry turning: the core's rotation vc / (2 pi rc) and the
--             sub-vortices passing (count x orbit rate); deeper with more sub-vortices.
--   debris    impacts at a Poisson rate that grows with the lofted debris and the wind's square.
--   air       absorption ~ 5 dB/km at 1 kHz rising as f^2: the low-pass corner is where the
--             path's absorption reaches 6 dB, f = 1 kHz sqrt(1.2 / d_km). Far away, the hiss and
--             crackle go first and the rumble carries.
-- (The vortex's infrasound, 0.5-10 Hz from its radial modes, ~c / R, is below hearing and left out.)

local Acoustics = {}

export type Source = {
	vc: number, -- m/s: core (maximum) wind
	rc: number, -- m: core radius
	debrisLoft: number?, -- 0..1: lofted debris (the sim's ground contact x soil x organisation)
	subCount: number?, -- effective number of sub-vortices (Vortex.params subCount)
	sOrbit: number?, -- rad/s: the sub-vortices' orbit rate
	fade: number?, -- 0..1: the entry's life (StateAdapter)
}

export type Params = {
	level: number, -- the sound pressure at the listener (1: inside a 60 m/s, 100 m core)
	gain: number, -- the level as played, compressed (0..0.9)
	rumbleLevel: number,
	rumbleHz: number,
	roarLevel: number,
	roarHz: number,
	hissLevel: number,
	hissHz: number,
	debrisLevel: number,
	debrisRate: number, -- impacts a second
	churnHz: number, -- the core's turning
	churnDepth: number,
	subHz: number, -- sub-vortex passing
	subDepth: number,
	gustHz: number, -- how fast the turbulence surges
	airHz: number, -- the air's low-pass corner
	distance: number, -- m, to the axis
}

Acoustics.U_REF = 60 -- m/s
Acoustics.R_REF = 100 -- m
Acoustics.D_MID = 0.05 -- m: branches, poles
Acoustics.D_HIGH = 0.008 -- m: twigs, wires, grass
Acoustics.STROUHAL = 0.2
Acoustics.AIR_DB_PER_KM_1K = 5 -- dB/km at 1 kHz (ISO 9613-1, ~20 C, ~60% humidity)
Acoustics.DEBRIS_RATE = 400 -- impacts a second at full loft and the reference wind, close by

local sqrt, exp, max = math.sqrt, math.exp, math.max
local TAU = 2 * math.pi

-- The air's low-pass corner for a path of d metres: where the absorption, a f^2, reaches 6 dB.
function Acoustics.airCorner(d: number): number
	local dkm = max(d, 0) / 1000 + 0.005 -- (~5 m of air even at the axis: tops out near 15 kHz)
	return 1000 * sqrt(6 / (Acoustics.AIR_DB_PER_KM_1K * dkm))
end

-- The Rankine-like wind of the vortex at r metres from its axis (the listener's own wind).
function Acoustics.windAt(s: Source, r: number): number
	local rc = max(s.rc, 1)
	if r <= rc then
		return s.vc * r / rc
	end
	return s.vc * (rc / r) ^ 0.6
end

function Acoustics.params(s: Source, d: number, out: Params?): Params
	local p: Params = out or ({} :: any)
	local vc = max(s.vc, 0)
	local rc = max(s.rc, 1)
	local loft = math.clamp(s.debrisLoft or 0, 0, 1)
	local life = math.clamp(if s.fade == nil then 1 else s.fade, 0, 1)
	local u = vc / Acoustics.U_REF
	d = max(d, 0)

	local spread = rc / sqrt(d * d + rc * rc)
	local size = sqrt(rc / Acoustics.R_REF) -- (amplitude: the power grows with the windy area)
	-- (beyond spreading and the air: the ground, terrain and the wind's refraction take more over
	-- long paths, ~10 log10(1 + d / 700 m) dB: ~4 dB at 1 km, ~10 dB at 6 km; ISO 9613-2's ground
	-- term and the meteorological correction together are of this size)
	local excess = 1 / sqrt(1 + d / 700)
	p.level = life * u * u * u * size * spread * excess
	-- (a game can't play the ~70 dB from 10 km off to inside a wedge: the heard gain compresses
	-- the level, ~0.8 dB per dB, and saturates smoothly toward 0.9)
	local L = p.level ^ 0.8
	p.gain = 0.9 * L / (1 + L)
	p.distance = d

	-- the wind the listener hears close up is the vortex's own there; far off, its core's
	local uNear = max(Acoustics.windAt(s, d), vc * spread)

	p.rumbleHz = 30 * sqrt(max(vc, 1) / 40) * (60 / rc) ^ 0.3
	local wide = rc / (rc + 80)
	p.rumbleLevel = 0.35 + 0.65 * (0.4 * wide + 0.6 * loft)

	p.roarHz = Acoustics.STROUHAL * max(uNear, 2) / Acoustics.D_MID
	p.roarLevel = 0.8
	p.hissHz = Acoustics.STROUHAL * max(uNear, 2) / Acoustics.D_HIGH
	-- the hiss grows faster than the roar with the wind (the higher tones need the faster flow)
	local un = uNear / Acoustics.U_REF
	p.hissLevel = 0.55 * un * un / (1 + 0.5 * un * un) * 1.5

	p.debrisRate = Acoustics.DEBRIS_RATE * loft * u * u
	-- (the impacts are small sources on the ground, screened by what stands round them: they fall
	-- off faster than the vortex's roar, by the square root of its spreading again)
	p.debrisLevel = loft * (0.5 + 0.75 * u / (1 + 0.5 * u)) * sqrt(spread)

	p.churnHz = vc / (TAU * rc)
	p.churnDepth = 0.12
	local n = max(s.subCount or 0, 0)
	p.subHz = n * max(s.sOrbit or 0, 0) / TAU
	p.subDepth = 0.3 * (1 - exp(-n / 2))
	-- eddies of size ~rc / 3 sweep by at the core wind: their surging, a fraction of a hertz
	local sweep = vc / (rc / 3 + 10)
	p.gustHz = 0.3 + 1.5 * sweep / (sweep + 3)

	p.airHz = Acoustics.airCorner(d)
	return p
end

return Acoustics
