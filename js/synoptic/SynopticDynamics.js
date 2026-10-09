// Advances the large-scale state (js/scenarios/synopticPattern.js) by physical rules each step.
// Nothing here follows a timetable: the setup persists because the parked long-wave trough
// keeps sending shortwaves across the Plains, and each one drives the surface low, fronts and
// jet the same way a real one would.
//   - The long-wave trough drifts slowly along the flow (a few kt).
//   - Shortwaves ride the 500 mb flow; a new one enters upstream every 20-30 h.
//   - The surface low is steered by the 500 mb flow, propagates toward the upper support ahead
//     of the strongest shortwave, and deepens or fills toward the depth that support sustains.
//     If it leaves the domain or loses its support, a new lee low forms under the next wave.
//   - The cold front advances with the post-frontal low-level wind, the warm front lifts with
//     the warm-sector flow, and the dryline mixes east in the afternoon and retreats at night.
import { clamp, lerp } from '../scenarios/math.js';
import { samplePatternWinds, upperLevelSupport, flowVector, boundaryGeometry, seaLevelPressureAt } from '../scenarios/synopticPattern.js';

const TROUGH_PHASE_FRACTION = 0.08;   // long-wave phase speed / 500 mb flow speed
const SHORTWAVE_STEERING = 0.8;       // shortwaves move at ~80% of the 500 mb wind
const LOW_STEERING = 0.35;            // surface lows move at about a third of the 500 mb wind
const LOW_PROPAGATION = 0.008;        // pattern units/h per unit support gradient
const MAX_LOW_SPEED_KT = 45;
const DEEPENING_HOURS = 9;            // relaxation time of the low's depth
const COLD_FRONT_FACTOR = 0.7, WARM_FRONT_FACTOR = 0.4;
const DRYLINE_MIXING_KMH = 14, DRYLINE_RETREAT_KMH = 9;
const SHORTWAVE_INTERVAL_HOURS = [20, 30];
const RHO = 1.15, CORIOLIS = 1e-4, MS_TO_KT = 1.943844;

export function initializeSynopticDynamics(pattern, seed) {
  pattern.dynamics = {
    rng: (Number(seed) >>> 0) ^ 0x51ed2701,
    nextShortwaveHour: null,
    nextShortwaveId: 2,
    lowVelocity: { x: 0, y: 0 },
    deepeningHpaPerHour: 0,
    coldFrontSpeed: 0, warmFrontSpeed: 0, drylineSpeed: 0,
    lastCyclogenesisHour: -Infinity,
    events: []
  };
  pattern.dynamics.nextShortwaveHour = lerp(SHORTWAVE_INTERVAL_HOURS[0] - 6, SHORTWAVE_INTERVAL_HOURS[1] - 6, nextRandom(pattern.dynamics));
  pattern.initialBoundaryOffsets = { warm: pattern.warmFrontOffset, dryline: pattern.drylineOffset };
}

export function advanceSynopticState(world, dtHours) {
  const p = world.evolution?.config?.synopticPattern;
  if (!p || !(dtHours > 0)) return;
  if (!p.dynamics) initializeSynopticDynamics(p, world.evolution?.config?.seed);
  const dyn = p.dynamics;
  const elapsed = Number(world.evolution?.elapsedHours) || 0;
  const perHour = kt => kt * 1.852 / (p.domainKm ?? 805); // kt -> pattern units per hour
  const f = flowVector(p);

  // Long-wave trough and downstream ridge drift slowly along the flow.
  const drift = perHour(p.flow500Kt * TROUGH_PHASE_FRACTION) * dtHours;
  p.troughX += f.e * drift; p.troughY -= f.n * drift;
  p.highX += f.e * drift; p.highY -= f.n * drift;

  // Shortwaves ride the flow (steered by the wind without their own circulation).
  for (const sw of p.shortwaves) {
    const w = samplePatternWinds(p, sw.x, sw.y, { excludeShortwave: sw });
    sw.x += perHour(w.u500Kt) * SHORTWAVE_STEERING * dtHours;
    sw.y -= perHour(w.v500Kt) * SHORTWAVE_STEERING * dtHours;
  }
  p.shortwaves = p.shortwaves.filter(sw => sw.x > -1.2 && sw.x < 2.0 && sw.y > -1.2 && sw.y < 2.0
    && ((sw.x - 0.5) * f.e - (sw.y - 0.5) * f.n) < 1.3);
  if (elapsed >= dyn.nextShortwaveHour) {
    // A new wave enters on the upstream side of the long-wave trough, toward its base.
    const across = lerp(0, 0.25, nextRandom(dyn));
    p.shortwaves.push({
      id: dyn.nextShortwaveId++,
      x: p.troughX - 0.55 * f.e + across * f.n,
      y: p.troughY + 0.55 * f.n + across * f.e,
      dm: lerp(p.shortwaveDmRange[0], p.shortwaveDmRange[1], nextRandom(dyn))
    });
    dyn.events.push({ hour: elapsed, type: 'shortwave-entered' });
    dyn.nextShortwaveHour = elapsed + lerp(SHORTWAVE_INTERVAL_HOURS[0], SHORTWAVE_INTERVAL_HOURS[1], nextRandom(dyn));
  }

  // Surface low: steering plus propagation toward upper support; depth relaxes toward what
  // the support at its position sustains.
  const steer = samplePatternWinds(p, p.lowX, p.lowY);
  const h = 0.02;
  const gradX = (upperLevelSupport(p, p.lowX + h, p.lowY) - upperLevelSupport(p, p.lowX - h, p.lowY)) / (2 * h);
  const gradY = (upperLevelSupport(p, p.lowX, p.lowY + h) - upperLevelSupport(p, p.lowX, p.lowY - h)) / (2 * h);
  let vx = perHour(steer.u500Kt) * LOW_STEERING + LOW_PROPAGATION * gradX;
  let vy = -perHour(steer.v500Kt) * LOW_STEERING + LOW_PROPAGATION * gradY;
  const speed = Math.hypot(vx, vy), maxSpeed = perHour(MAX_LOW_SPEED_KT);
  if (speed > maxSpeed) { vx *= maxSpeed / speed; vy *= maxSpeed / speed; }
  p.lowX += vx * dtHours; p.lowY += vy * dtHours;
  dyn.lowVelocity = { x: vx, y: vy };
  const support = upperLevelSupport(p, p.lowX, p.lowY);
  const targetDepth = p.maxLowDepthHpa * clamp(0.3 + support, 0.3, 1);
  const previousDepth = p.lowDepthHpa;
  p.lowDepthHpa += (targetDepth - p.lowDepthHpa) * clamp(dtHours / DEEPENING_HOURS, 0, 1);
  dyn.deepeningHpaPerHour = (p.lowDepthHpa - previousDepth) / dtHours;
  maybeFormNewLow(p, dyn, elapsed, support);

  advanceBoundaries(world, p, dyn, dtHours, perHour);
}

// A new lee low forms under the strongest upper support once the old low has lost its own
// support (the old system occludes away downstream) or has moved far beyond the domain. A low
// tracking just outside the domain still trails its fronts and dryline across it.
function maybeFormNewLow(p, dyn, elapsed, supportAtLow) {
  const gone = p.lowX > 1.6 || p.lowX < -0.6 || p.lowY < -0.6 || p.lowY > 1.4;
  if (elapsed - dyn.lastCyclogenesisHour < 18 && !gone) return;
  let best = null;
  for (let x = 0.1; x <= 0.75; x += 0.05) for (let y = 0.15; y <= 0.65; y += 0.05) {
    const s = upperLevelSupport(p, x, y);
    if (!best || s > best.s) best = { x, y, s };
  }
  if (!best || !(gone || (supportAtLow < 0.15 && best.s > 0.6 && Math.hypot(best.x - p.lowX, best.y - p.lowY) > 0.3))) return;
  p.lowX = best.x; p.lowY = best.y;
  p.lowDepthHpa = Math.max(5, 0.4 * p.maxLowDepthHpa);
  p.coldFrontOffset = 0;
  p.warmFrontOffset = p.initialBoundaryOffsets?.warm ?? 0.05;
  p.drylineOffset = p.initialBoundaryOffsets?.dryline ?? -0.06;
  dyn.lastCyclogenesisHour = elapsed;
  dyn.events.push({ hour: elapsed, type: 'lee-cyclogenesis', x: best.x, y: best.y });
}

function advanceBoundaries(world, p, dyn, dtHours, perHour) {
  const geo = (x, y) => boundaryGeometry(p, x, y);
  const tripleY = geo(p.lowX, p.lowY).tripleY;

  // Cold front: pushed by the post-frontal low-level wind (normal component), never stalling
  // completely while the low is active.
  const coldY = tripleY + 0.25;
  const coldX = geo(p.lowX, coldY).coldFrontX - 0.07;
  const behind = lowLevelWindKt(p, coldX, coldY);
  const slope = p.coldFrontSlope;
  const n = { x: 1 / Math.hypot(1, slope), y: slope / Math.hypot(1, slope) }; // toward the warm side (x east, y south)
  const coldNormalKt = behind.e * n.x - behind.n * n.y;
  const coldSpeedKt = COLD_FRONT_FACTOR * Math.max(0.2 * Math.hypot(behind.e, behind.n), coldNormalKt);
  dyn.coldFrontSpeed = perHour(coldSpeedKt) / n.x;
  p.coldFrontOffset = clamp(p.coldFrontOffset + (dyn.coldFrontSpeed - dyn.lowVelocity.x) * dtHours, -0.3, 0.6);

  // Warm front: lifts north with the warm-sector flow across it (slower than the wind).
  const warmX = p.lowX + 0.25;
  const warmY = geo(warmX, p.lowY).warmFrontY + 0.07;
  const warmSide = lowLevelWindKt(p, warmX, warmY);
  const wn = { x: 0.22 / Math.hypot(1, 0.22), y: -1 / Math.hypot(1, 0.22) }; // toward the cool (north) side
  const warmNormalKt = warmSide.e * wn.x - warmSide.n * wn.y;
  dyn.warmFrontSpeed = -perHour(WARM_FRONT_FACTOR * warmNormalKt) / Math.abs(wn.y); // change of y (south positive)
  p.warmFrontOffset = clamp(p.warmFrontOffset + (dyn.warmFrontSpeed - dyn.lowVelocity.y) * dtHours, -0.15, 0.3);

  // Dryline: afternoon boundary-layer mixing pushes it east; at night the moist low levels
  // return west. Strong westerlies on the dry side (behind a passing wave) add to the push.
  const localHour = (((Number(world.validHourUtc) || 0) - 6) % 24 + 24) % 24;
  const mixing = localHour > 10 && localHour < 19 ? Math.sin(Math.PI * (localHour - 10) / 9) : 0;
  const night = localHour >= 20 || localHour < 8 ? 1 : 0;
  const dryY = tripleY + 0.3;
  const drySide = lowLevelWindKt(p, geo(p.lowX, dryY).drylineX - 0.08, dryY);
  const drylineKmh = DRYLINE_MIXING_KMH * mixing - DRYLINE_RETREAT_KMH * night + 0.1 * Math.max(0, drySide.e) * 1.852;
  dyn.drylineSpeed = drylineKmh / (p.domainKm ?? 805);
  p.drylineOffset = clamp(p.drylineOffset + (dyn.drylineSpeed - dyn.lowVelocity.x) * dtHours, -0.8, 0.45);
}

// Boundary-layer wind (kt, east/north): 80% of the geostrophic wind from the sea-level
// pressure gradient of the current state.
function lowLevelWindKt(p, nx, ny) {
  const h = 0.01, metres = h * (p.domainKm ?? 805) * 1000;
  const dpdx = (seaLevelPressureAt(p, nx + h, ny) - seaLevelPressureAt(p, nx - h, ny)) * 100 / (2 * metres);
  const dpdNorth = (seaLevelPressureAt(p, nx, ny - h) - seaLevelPressureAt(p, nx, ny + h)) * 100 / (2 * metres);
  return { e: -0.8 * dpdNorth / (RHO * CORIOLIS) * MS_TO_KT, n: 0.8 * dpdx / (RHO * CORIOLIS) * MS_TO_KT };
}

// Deterministic generator whose state lives in the (checkpointed) synoptic state.
function nextRandom(dyn) {
  dyn.rng = (dyn.rng + 0x6D2B79F5) >>> 0;
  let t = dyn.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
