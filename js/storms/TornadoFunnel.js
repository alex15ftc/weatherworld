// The tornado's condensation funnel: one rule for the frames (StormStructure buildStormFrame, the funnel
// the game's views and the lab draw) and the engine's appearance (StormAppearance tornadoAppearance, the
// feed's and the look's shape names, condensed share and radii). Until 2026-11-19 the appearance kept
// its own: the ground-relative wind (the swirl and the storm's motion) with a pressure deficit of 2.6
// rho V^2 under the wall cloud's base - on seed 2's first EF1 (98 mph, 25 m/s storm motion) a funnel
// 80% of the way down where the frame's, from the vortex's own swirl (18.7 m/s), stopped at 509 m. A
// Rankine vortex's central drop is rho V^2 (a Burgers-Rott vortex's 1.7 rho Vmax^2); observed drops fit
// these (Lee et al. 2004, Manchester SD: ~100 hPa), so the deficit is the vortex's, with no factor.
//
// Two heights hang it:
//   wallBaseM  the cloud base over the tornado, lowered by the mesocyclone's drop (the wall cloud's)
//   coreBaseM  where the air the core draws in at the ground condenses (its own condensation level,
//              lowered by the same drop): the surface layer at its contact, which is the storm's rain-
//              cooled outflow wherever the cold pool lies and, as the rear-flank downdraught wraps round
//              it, more of it. Outflow air, cooled toward its wet bulb, condenses far lower.
// Below coreBaseM the funnel is where the vortex's own drop lifts that air to its condensation level
// (the drop's radius: the vortex's own, Burgers-Rott, as StormVortices draws its wind - 2026-11-19; it took a Rankine
// vortex's, rho V^2 at the centre for 1.70 rho V^2, and every funnel stopped ~40% short); between the two it is condensed out to where the core draws its air
// from (coreAirR core radii); at the wall cloud's base it is the cloud.
import { qsat, dewFromQ, CP, LV, G } from './UpdraughtParcel.js';
import { burgersDrop, burgersDropRadius } from './StormVortices.js';
import { clamp } from '../scenarios/math.js';

export const TORNADO_FUNNEL = Object.freeze({
  capM: 500,                           // the widest the funnel is drawn, where it meets the cloud
  coreAirR: 3                          // how far out (core radii) the core draws its surface air in: the corner flow's condensed annulus
});

// The wet bulb (C) of air at tc (C), mixing ratio q (kg/kg), pressure p (hPa).
export const wetBulb = (tc, q, p) => { let tw = tc; for (let n = 0; n < 20; n++) { const qs = qsat(tw, p); tw -= (tw - tc + LV / CP * (qs - q)) / (1 + LV / CP * qs * 17.67 * 243.5 / (tw + 243.5) ** 2); } return Math.min(tc, tw); };

// The condensation level (m) of surface air with share f of the storm's outflow mixed in: the outflow
// is the surface parcel (t0 C, q0 kg/kg, p0 hPa; lclIn its own condensation level, m) cooled by the
// cold pool's deficit (K) toward its wet bulb, so moister; the level falls 125 m a degree its spread
// narrows. Returns f -> metres.
export function outflowMixLcl({ t0, q0, p0, lclIn, deficitK }) {
  const tw = wetBulb(t0, q0, p0), cool = Math.min(deficitK, t0 - tw);
  const tOut = t0 - cool, qOut = q0 + CP * cool / LV;
  const spreadIn = t0 - dewFromQ(q0, p0);
  return f => { const t = t0 + f * (tOut - t0), q = q0 + f * (qOut - q0); return Math.max(0, lclIn - 125 * (spreadIn - (t - dewFromQ(q, p0)))); };
}

// The air the core draws in: share of it outflow, from the outflow's share of the ground at the tornado
// (outflowAtCore) and the storm's occlusion (the rear-flank downdraught wrapping round it).
export const coreOutflowShare = (outflowAtCore, occlusion) => 1 - (1 - clamp(outflowAtCore ?? 0, 0, 1)) * (1 - clamp(occlusion ?? 0, 0, 1));

// The tornado's tilt: one rule for the frames' funnel and the engine's appearance. A tornado leans from
// its ground point toward its parent low-level mesocyclone - the storm's own (StormGeometry's wall
// cloud), which the occluding tornado falls behind (TornadoEngine occlusionStep) - and joins it at the
// top of its own circulation (depthM, StormVortices: deeper for a stronger tornado), so it is near upright
// at touchdown and leans as it occludes. Radar: mature tornadoes 10-35 deg (Mahre et al. 2018, Tipton:
// <=10 deg over 0.6-2 km; Griffin et al. 2019, Canadian: 25-35 deg in the lowest km), rising to ~55 deg
// and more through dissipation as the low levels are displaced from the mesocyclone (Griffin et al.).
// Decaying, the rope-out: the top also sits to the right of its track by up to ROPE_LEAN of the base's
// height. (Until 2026-11-19 the frames drew it upright and the appearance leaned it by the whole
// mesocyclone's slope to the updraught - 30-45 deg from touchdown on, mature or not.)
export const ROPE_LEAN = 0.8;
// The lean it can take (2026-11-19, the tornado lab: leans of 60-77 deg once the surge push and the decay drift had
// carried the tornado 5-7 km from the wall cloud). Farther than the vortex's own depth from the storm's wall cloud,
// what it hangs from is the occluded circulation it carries with it, not the new wall cloud: its lean at the base
// bends softly (a soft minimum, sharpness LEAN_LIMIT.sharpness, as the path width bends to the wall cloud) to
// LEAN_LIMIT.matureDeg, rising with its decay to ropeDeg (Griffin et al. 2019: ~55 deg and more as it dissipates).
// (2026-11-19, the lab again: matureDeg 45 to 35 - every mature tornado sat at 44-45 deg, at the bend, and could not lean
// further through its decay; mature tornadoes lean 10-35 deg, Mahre et al. 2018, Griffin et al. 2019, above)
export const LEAN_LIMIT = Object.freeze({ matureDeg: 35, ropeDeg: 60, sharpness: 8 });
const ramp = (v, lo, hi) => clamp(((Number(v) || 0) - lo) / (hi - lo), 0, 1);
const smooth = q => { q = clamp(q, 0, 1); return q * q * (3 - 2 * q); };
// Decay: its wind fallen away from its peak (TornadoEngine ties the wind to the occlusion).
// (a tornado still spinning up or mature, TornadoEngine's life stages, is not decaying, though its wind is under its peak)
// (its contortion through the six stages where it has one, TornadoStages: 0 through organizing and mature, 0.35 at the
// end of shrinking, 1 at the end of the rope; else, for one down in a world saved before them, as its wind falls)
export const tornadoDecay = t => Number.isFinite(t?.contortion) ? clamp(t.contortion, 0, 1) : (t?.lifeStage === 'organizing' || t?.lifeStage === 'mature') ? 0 : ramp((t?.peakWindSpeedMph ?? 0) > 0 ? clamp(1 - t.windSpeedMph / t.peakWindSpeedMph, 0, 1) : 0, 0.12, 0.35);
// Its lean (m east, north of its ground point) at a height, under a base baseM; depthM its circulation's depth.
export function tornadoTilt(storm, { depthM, baseM }) {
  const t = storm.tornado, wc = storm.geometry?.wallCloud, p = t?.positionKm;
  const offE = wc && p ? (wc.xKm - p.x) * 1000 : 0, offN = wc && p ? -(wc.yKm - p.y) * 1000 : 0;
  const decay = tornadoDecay(t), v = storm.velocityKph ?? {}, ve = Number(v.east) || 0, vn = Number(v.north) || 0, speed = Math.hypot(ve, vn) || 1;
  const ropeE = vn / speed * decay * ROPE_LEAN * baseM, ropeN = -ve / speed * decay * ROPE_LEAN * baseM;
  const depth = Math.max(1, Number(depthM) || 1000), base = Math.max(1, baseM);
  const s0 = smooth(base / depth), topE = offE * s0 + ropeE, topN = offN * s0 + ropeN, lean = Math.hypot(topE, topN);
  const L = LEAN_LIMIT, room = base * Math.tan((L.matureDeg + (L.ropeDeg - L.matureDeg) * decay) * Math.PI / 180);
  const k = lean > 0 ? Math.pow(Math.pow(lean, -L.sharpness) + Math.pow(room, -L.sharpness), -1 / L.sharpness) / lean : 1;
  const at = z => { const s = smooth(z / depth), r = smooth(z / base); return { east: k * (offE * s + ropeE * r), north: k * (offN * s + ropeN * r) }; };
  return { decay, offsetM: Math.hypot(offE, offN), leanShare: k, at };
}

// The funnel of a Rankine vortex (core radius R m, swirl V m/s, air density rho kg/m3) under those two
// heights: its tip (m; 0 on the ground) and its radius (m) at a height.
export function tornadoFunnel({ R, V, rho, wallBaseM, coreBaseM }) {
  const rhoG = rho * G, Bt = Math.max(0, wallBaseM), Bc = clamp(coreBaseM, 0, Bt);
  const drop = burgersDrop(0, R, V, rho), tipM = Math.max(0, Bc - drop / rhoG);
  const radiusAt = z => {
    if (!(R > 0)) return 0;
    if (z >= Bt) return TORNADO_FUNNEL.capM;
    const cap = Math.min(TORNADO_FUNNEL.capM, TORNADO_FUNNEL.coreAirR * R);
    if (z >= Bc) return cap;
    return Math.min(cap, burgersDropRadius(rhoG * (Bc - z), R, V, rho));
  };
  return { tipM, dropPa: drop, wallBaseM: Bt, coreBaseM: Bc, radiusAt };
}
