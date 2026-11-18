// One storm's rotating winds: its mesocyclone and, while one is down, its tornado - worked out once
// from the engine's storm and read by everything that shows the storm's wind, so they agree:
//   the frames the Roblox views draw (StormStructure.js: ground and nest winds, the 1 km spin, the
//     wall cloud's lowering and the funnel, both from the vortices' pressure drop) and, through the
//     frames, the trees' wind (roblox FoliageWind.luau);
//   the radar's velocity (RadarSimulator.js stormWindAt: what it sees, through its beam);
//   the rain and hail the rotation carries round, and the tornado's debris (PrecipitationField.js),
//     which the radar scans and the frames rain from.
// Until 2026-11-13 each of these had its own vortex: the frames' a 1.6 km mesocyclone from the
// inflow's spin (12 m/s on the radar test's EF3 supercell), the radar's a 3.4 km one from the
// engine's mesocyclone strength (38 m/s), the debris and fallout their own tails, and the trees
// a second tornado on top of the frame's.
//
// The mesocyclone: as strong as the engine says (its mesocyclone strength, the authority on the
// storm's rotation), as wide as the storm's structure says, strongest at mid levels and present
// down to the ground; near the ground a strengthening low-level circulation (the engine's
// low-level rotation) is tighter and faster. Its swirl at its radius (6 + 30 x strength m/s) spans
// the radar rotation speeds of real supercells (Smith et al. 2015: median peak Vrot 17.5-37.6 m/s for
// EF0-EF4+ tornadoes; docs/storm-reference/mesocyclone-rotation-2026-11-06.md). It turns round the
// tornado while one is down (a tornado forms inside its parent circulation) or round the place the
// storm's structure puts it, and leans to the updraught's centre by leanM.
// The tornado: the engine's, where the engine put it; its swirl is its ground wind less the storm's
// motion, and its core radius is the one that gives the engine's damage width at the EF0 wind.
// Both are modified Rankine vortices: solid rotation inside the core, falling as r^-tail outside it.
// The mesocyclone's tail is 1/r (Rankine), and its wind fades beyond about fadeRadii of its radius (it
// is one storm's rotation, not the air's). The tornado's tail flattens with height: at the ground,
// where friction holds the outer flow back, it is 1/r, so its core and the engine's damage width go
// together (the EF0 wind at half the width); aloft, from tailDepthM up, it falls off as r^-0.6 (Wood
// and White 2011: mobile Doppler radar, a few hundred metres up) - the tornado cyclone, the broad
// circulation round a tornado that a radar's beam sees (a tornado 250 m across shows a couplet a
// kilometre wide). Its core widens with height too, at the same speed: from the ground's to half the
// damage path's width by tailDepthM, 500 m (the radius of the strongest wind grows through the lowest
// few hundred metres while the peak wind holds, Kosiba and Wurman 2013 and others, mobile Doppler radar; the
// height is where Wood and White measured the r^-0.6 tail; 1 km left the radar test's tornado 40 km out
// adding 15 m/s to the couplet against 28 before), so
// there is more circulation aloft than at the ground. With the ground's vortex at all heights the
// radar test's EF3 showed no TVS, and a tornado 40 km from a radar added 9 m/s to the couplet
// where it had added 28 (2026-11-13). Map frame: km from the storm's centre, x east and y south; winds east and north (m/s).
import { clamp } from '../scenarios/math.js';
import { buildStormGeometry } from './StormGeometry.js';

const DEG = Math.PI / 180, MPH = 0.44704;
export const VORTICES = Object.freeze({
  leanM: 3500,                        // the mesocyclone reaches the updraught's centre by this height
  mesoV: [6, 30],                     // its swirl at its radius: mesoV[0] + mesoV[1] x the engine's mesocyclone strength (m/s)
  mesoStrength: [0, 1.25], mesoRadiusKm: [1.5, 8],
  // fades beyond fadeRadii radii; none beyond reachRadii. (A mesocyclone is the inflow's horizontal spin
  // tilted upright: a pair of opposite vortices with no circulation between them, so its wind dies away
  // beyond the updraught rather than falling off as 1/r for ever. Until 2026-11-14 it faded from 3 radii and
  // reached 12: 6 m/s of swirl 11 km out at every height, which over the hour or two its fallout is followed
  // carried a supercell's rain round into an echo 150 km across, where without the swirl it was a forward
  // flank 20 km wide - seed 7's S0226.)
  fadeRadii: 2, reachRadii: 8,
  // strongest at peakM, depthFloor of that at the ground and far aloft; aboveTop of it above the storm's top
  depthPeakM: 4500, depthWidthM: 2600, depthFloor: 0.55, aboveTop: 0.2,
  // the low-level circulation: below lowFullM narrower by up to lowTighten of the radius and faster by
  // up to lowSpinUp, in proportion to the engine's low-level rotation, fading to the mesocyclone's own by lowDepthM
  lowFullM: 1000, lowDepthM: 3000, lowTighten: 0.55, lowSpinUp: 0.4,
  mesoTail: 1, tailGround: 1, tailAloft: 0.6, tailDepthM: 500, // the wind outside a core falls as r^-tail (the tornado's: tailGround at the ground to tailAloft by tailDepthM)
  cycloneShare: 1 / 3, vrotShare: 0.5, // the tornado cyclone: its radius as a share of its parent low-level circulation's; the wind at it as a share of the tornado's ground wind
  ef0Mph: 65, tornadoMinRM: 10,       // the damage width's edge is the EF0 wind; the narrowest core (m)
  // how deep a tornado's circulation reaches (m): depth[0] + depth[1] x (ground wind - depth[2] m/s), within depth[3..4] -
  // a weak one only the lowest kilometre, a violent one several (the radar's relation since 2026-10); it fades over its top fadeShare
  depth: [800, 36, 30, 700, 3500], depthFadeShare: 0.4,
  tornadoMph: 90, tornadoYards: 300   // (an engine tornado without its wind or width)
});

// A mesocyclone's description: at the ground at `ground`, under the updraught at `aloft` (km from the
// storm's centre), its radius (km), and the engine's strength and low-level strength for it.
export function mesoOf(ground, aloft, radiusKm, strength, lowStrength) {
  const C = VORTICES;
  return {
    x: ground.x, y: ground.y, aloftX: aloft.x, aloftY: aloft.y,
    R: clamp(Number(radiusKm) || 4, C.mesoRadiusKm[0], C.mesoRadiusKm[1]),
    V: C.mesoV[0] + C.mesoV[1] * clamp(Number(strength) || 0, C.mesoStrength[0], C.mesoStrength[1]),
    low: clamp(Number(lowStrength) || 0, 0, 1)
  };
}

// The storm's vortices (plain data: the radar's threads take it as it is), or null without structure.
// topM: the storm's top above the ground (m).
export function stormVortices(storm, topM) {
  const structure = storm?.structure;
  if (!structure) return null;
  const C = VORTICES, geometry = storm.geometry ?? buildStormGeometry({ ...storm });
  const theta = (Number(structure.orientationDeg ?? storm.orientationDeg) || 0) * DEG;
  const mx = Math.sin(theta), my = Math.cos(theta), rx = -my, ry = mx;
  const meso = structure.mesocyclone ?? {}, a = Number(meso.offsetXKm) || 0, b = Number(meso.offsetYKm) || 0;
  const at = { x: a * mx + b * rx, y: a * my + b * ry };
  const pos = storm.positionKm ?? { x: 0, y: 0 }, upd = geometry.updraught ?? {};
  const aloft = { x: (Number(upd.xKm) || pos.x) - pos.x, y: (Number(upd.yKm) || pos.y) - pos.y };
  let tornado = null;
  const tor = storm.tornado;
  if (tor?.onGround) {
    const Vg = (Number(tor.windSpeedMph) || C.tornadoMph) * MPH, W = (Number(tor.widthYards) || C.tornadoYards) * 0.9144;
    const motion = Math.hypot(Number(storm.velocityKph?.east) || 0, Number(storm.velocityKph?.north) || 0) / 3.6;
    // (the core whose wind at the ground falls to the EF0 wind at half the damage width)
    const R = Math.max(C.tornadoMinRM, Math.min(W / 2, (W / 2) * (C.ef0Mph * MPH / Vg) ** (1 / C.tailGround)));
    const gt = geometry.tornado, t = tor.positionKm ? { x: tor.positionKm.x - pos.x, y: tor.positionKm.y - pos.y }
      : Number.isFinite(gt?.xKm) ? { x: gt.xKm - pos.x, y: gt.yKm - pos.y } : at;
    const depthM = clamp(C.depth[0] + C.depth[1] * (Vg - C.depth[2]), C.depth[3], C.depth[4]);
    tornado = { x: t.x, y: t.y, R: R / 1000, Raloft: Math.max(R, W / 2) / 1000, V: Math.max(0, Vg - motion), Vg, depthM };
  }
  const ground = tornado ?? at;
  const d = {
    spin: storm.leftMover ? -1 : 1, topM: Number(topM) || 12000,
    meso: mesoOf(ground, aloft, meso.radiusKm, meso.strength, meso.lowStrength),
    tornado
  };
  if (tornado) {
    // The tornado cyclone: aloft, round the tornado's own sharp vortex, the middle of its parent
    // low-level circulation is drawn in round it - a broader vortex cycloneShare of the parent's
    // radius (tornado cyclones are 0.5-1 km in radius inside low-level mesocyclones of 1.5-3 km: Brown,
    // Lemon and Burgess 1978 and later Doppler studies). Its swirl brings the wind at its radius, with the
    // tornado's own tail there, to vrotShare of the tornado's ground wind: a radar's rotational velocity
    // on tornadoes is about half their ground wind from EF0 to EF4+ (Smith et al. 2015, Thompson et al.
    // 2017: median peak Vrot 17.5-37.6 m/s). Neither turns faster than the parent's angular momentum
    // allows at its radius (air drawn in from the parent keeps V r at most), and both are as deep as the
    // low-level circulation the engine's low-level rotation gives. Until 2026-11-13 there was only the
    // tornado's vortex aloft, its core half the damage path: 40 m for a 93 yd tornado, and the radar's TDA
    // found no tornado-scale shear at all on 32 of 58 of the engine's tornadoes (12 seeds x a day).
    const parent = mesoLevel(d, 0), momentum = parent.V * parent.R;
    tornado.Valoft = Math.min(tornado.V, momentum / tornado.Raloft);
    const Rc = C.cycloneShare * parent.R;
    const own = Rc > tornado.Raloft ? rankineV(Rc, tornado.Raloft, tornado.Valoft, C.tailAloft) : Infinity;
    // (The cyclone is as deep as the mesocyclone it is the middle of: up to the mesocyclone's strongest level,
    // by the engine's strength for it - tornadic vortex signatures commonly reach 3-6 km whatever the tornado's
    // strength, Trapp et al. 1999. The tornado's own vortex keeps the depth its wind gives it. Until 2026-11-14
    // both had that depth, and the radar's TDA, which wants shear on 3 tilts, lost tornadoes beyond 70 km where
    // only one or two beams were under 2 km: 17 of 58, an EF3 at 94 km among them.)
    const strength = clamp((d.meso.V - C.mesoV[0]) / C.mesoV[1], 0, 1);
    tornado.cyclone = { R: Rc, V: clamp(C.vrotShare * tornado.Vg - own, 0, momentum / Rc), depthM: Math.max(tornado.depthM, C.depthPeakM * strength) };
    tornado.depthM = Math.max(tornado.depthM, C.lowFullM + (C.lowDepthM - C.lowFullM) * d.meso.low);
  }
  return d;
}

// A modified Rankine vortex's swirl speed at r (any unit, as R).
export const rankineV = (r, R, V, tail = 1) => (R <= 0 ? 0 : r < R ? V * r / R : V * (R / r) ** tail);
// Its pressure drop at r (Pa; cyclostrophic: rho V^2 (1/2 + 1/(2 tail)) at the centre, rho V^2 / (2 tail) at R).
export function rankineDrop(r, R, V, rho, tail = 1) {
  if (R <= 0 || V <= 0) return 0;
  const k = rho * V * V;
  return r < R ? k * (0.5 / tail + 0.5 * (1 - (r / R) ** 2)) : k * 0.5 / tail * (R / r) ** (2 * tail);
}
// Where that drop is need (Pa): the radius (0 if the centre's drop is less).
export function rankineDropRadius(need, R, V, rho, tail = 1) {
  const k = rho * V * V;
  if (!(R > 0) || !(k > 0) || need >= k * (0.5 + 0.5 / tail)) return 0;
  if (need <= 0) return Infinity;
  return need >= 0.5 * k / tail ? R * Math.sqrt(1 - 2 * (need / k - 0.5 / tail)) : R * (0.5 * k / (tail * need)) ** (1 / (2 * tail));
}

// The mesocyclone at height z (m): its centre (km), radius (km) and swirl at the radius (m/s).
export function mesoLevel(d, z, out = {}) {
  const C = VORTICES, m = d.meso, lean = clamp(z / C.leanM, 0, 1);
  const low = m.low * clamp((C.lowDepthM - z) / (C.lowDepthM - C.lowFullM), 0, 1);
  // (present down to the ground, depthFloor of its most; above its peak it dies away to nothing - the storm's
  // top is its outflow, spreading apart, not turning. Until 2026-11-14 the floor held aloft as well, and the
  // anvil's snow went round with the mesocyclone.)
  const bell = Math.exp(-(((z - C.depthPeakM) / C.depthWidthM) ** 2)), depth = z > C.depthPeakM ? bell : C.depthFloor + (1 - C.depthFloor) * bell;
  out.x = m.x + (m.aloftX - m.x) * lean; out.y = m.y + (m.aloftY - m.y) * lean;
  out.R = m.R * (1 - C.lowTighten * low);
  out.V = m.V * depth * (1 + C.lowSpinUp * low) * (z > d.topM ? C.aboveTop : 1);
  return out;
}

// Add a vortex's wind at (dx, dy) km from its centre (map frame, y south) to out {u, v}: cyclonic for
// a positive V, fading beyond fadeR (km: 1 / (1 + (r / fadeR)^3)), none beyond reachRadii x fadeR / fadeRadii.
export function addRankine(out, dx, dy, R, V, fadeR, tail = 1) {
  if (!V || !(R > 0) || !(fadeR > 0)) return;
  const reach = fadeR * VORTICES.reachRadii / VORTICES.fadeRadii, r2 = dx * dx + dy * dy;
  if (r2 > reach * reach) return;
  const r = Math.sqrt(r2);
  if (r < 1e-6) return;
  const q = r / fadeR, vt = rankineV(r, R, V, tail) / (1 + q * q * q);
  // anticlockwise on a north-up map: east component -(north offset), north component the east offset
  out.u += vt * dy / r;
  out.v += vt * dx / r;
}

const level = {};
// The mesocyclone's wind at (x, y) km from the storm's centre, height z (m), times share.
export function addMesoWind(d, x, y, z, out, share = 1) {
  mesoLevel(d, z, level);
  addRankine(out, x - level.x, y - level.y, level.R, d.spin * share * level.V, VORTICES.fadeRadii * level.R, VORTICES.mesoTail);
}
// The tornado's tail at height z (m).
const aloftShare = z => { const q = clamp(z / VORTICES.tailDepthM, 0, 1); return q * q * (3 - 2 * q); };
export const tornadoTail = z => VORTICES.tailGround + (VORTICES.tailAloft - VORTICES.tailGround) * aloftShare(z);
// The tornado's core radius at height z (km): the ground's, widening to Raloft by tailDepthM.
export const tornadoCoreKm = (t, z) => t.R + ((t.Raloft ?? t.R) - t.R) * aloftShare(z);
// Its swirl at that radius (m/s): the ground's, easing to the tornado cyclone's by tailDepthM.
export const tornadoSwirlMs = (t, z) => t.V + ((t.Valoft ?? t.V) - t.V) * aloftShare(z);
// The tornado's wind at (x, y) km, height z (m): its own fades into its parent circulation's beyond
// that circulation's radius at the ground. seenKm: how wide a sample takes it (a radar's gate): the
// core is seen as no narrower than that, with the wind the vortex has at that radius.
export function addTornadoWind(d, x, y, out, share = 1, seenKm = 0, z = 0) {
  const t = d.tornado;
  if (!t) return;
  // (each at full strength up to the last fadeShare of its depth, then fading out smoothly to its top)
  const within = depthM => { const f = clamp((depthM - z) / (VORTICES.depthFadeShare * depthM), 0, 1); return f * f * (3 - 2 * f); };
  const parent = d.meso.R * (1 - VORTICES.lowTighten * d.meso.low);
  if (z < t.depthM) {
    const tail = tornadoTail(z), Rc = tornadoCoreKm(t, z), R = seenKm > 0 ? Math.hypot(Rc, seenKm) : Rc;
    addRankine(out, x - t.x, y - t.y, R, d.spin * share * within(t.depthM) * rankineV(R, Rc, tornadoSwirlMs(t, z), tail), Math.max(4 * R, parent), tail);
  }
  // (the tornado cyclone round it, aloft)
  const c = t.cyclone, up = aloftShare(z);
  if (c && c.V > 0 && up > 0 && z < (c.depthM ?? t.depthM)) addRankine(out, x - t.x, y - t.y, c.R, d.spin * share * up * within(c.depthM ?? t.depthM) * c.V, Math.max(VORTICES.fadeRadii * c.R, parent), VORTICES.mesoTail);
}

// The share of the rain and hail still at (x, y) km, height z (m), inside a tornado's vortices (0-1;
// 1 outside them): the swirl flings them out. A drop or stone falling at vt through a swirl V(r)
// drifts outward at about vt V^2 / (g r) (its drag holds it to the air within a second or so,
// against a turn of half a minute and more); followed down, that drift spreads what falls apart at
// (1 / (g r)) d(V^2)/dr for each metre it falls, whatever its fall speed (a fast stone drifts faster
// but is in the vortex for less time). What is left at z is exp(-that summed over the fall from the
// top of the vortices). The swirl is the tornado's own and its tornado cyclone's at each height, as
// addTornadoWind gives them, each drawn as a Burgers-Rott vortex of the same core radius and peak
// wind (smooth, so the spreading falls to nothing at the cores' edges, where the wind peaks; beyond
// them what was flung out gathers in a ring, which is not added). Real tornadoes' low-level cores are
// debris with little rain or hail: a weak-echo eye inside a ring of hydrometeors (Dowell et al.
// 2005, JAS 62; Bluestein et al. 2007, MWR 135). (2026-11-17: until then the rain fell through the
// vortex as everywhere else and outweighed a violent tornado's debris on the radar in moist air.)
const BURGERS = { alpha: 1.2564, steps: 16 }, GRAVITY_MS2 = 9.81;
const burgersV = (r, R, V) => (r <= 0 || R <= 0 || V <= 0 ? 0 : (1 + 0.5 / BURGERS.alpha) * V * (R / r) * (1 - Math.exp(-BURGERS.alpha * (r / R) ** 2)));
export function vortexClearing(d, x, y, z) {
  const t = d?.tornado;
  if (!t) return 1;
  const c = t.cyclone?.V > 0 ? t.cyclone : null, cycloneTop = c ? (c.depthM ?? t.depthM) : 0, top = Math.max(t.depthM, cycloneTop);
  const r = Math.hypot(x - t.x, y - t.y);
  if (z >= top || r >= Math.max(t.R, t.Raloft ?? t.R, c?.R ?? 0)) return 1;
  const within = (depthM, zz) => { const f = clamp((depthM - zz) / (VORTICES.depthFadeShare * depthM), 0, 1); return f * f * (3 - 2 * f); };
  const dz = (top - z) / BURGERS.steps;
  let spread = 0;
  for (let k = 0; k < BURGERS.steps; k++) {
    const zz = z + (k + 0.5) * dz;
    const Rt = tornadoCoreKm(t, zz), Vt = zz < t.depthM ? within(t.depthM, zz) * tornadoSwirlMs(t, zz) : 0;
    const up = c && zz < cycloneTop ? aloftShare(zz) * within(cycloneTop, zz) : 0;
    const swirl = rr => burgersV(rr, Rt, Vt) + (up > 0 ? burgersV(rr, c.R, up * c.V) : 0);
    // (d(V^2)/dr by a difference across a twentieth of the narrower core; km to m)
    const h = 0.05 * Math.min(Rt, c?.R ?? Rt), rr = Math.max(r, h);
    const rate = (swirl(rr + h) ** 2 - swirl(rr - h) ** 2) / (2 * h * 1000) / (GRAVITY_MS2 * rr * 1000);
    if (rate > 0) spread += rate * dz;
  }
  return Math.exp(-spread);
}
