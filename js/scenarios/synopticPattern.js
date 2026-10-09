import { clamp, gaussian, lerp, smoothstep } from './math.js';

// The large-scale (synoptic) state of the simulation, in pattern coordinates: nx east and ny
// SOUTH, both 0..1 across the domain (domainKm wide). The narrative builds the initial state
// (scenarioGenerator); SynopticDynamics advances it each step by physical rules. Sampling is
// a pure function of the current state: nothing here moves on a timetable.
const G = 9.80665;
const CORIOLIS = 1e-4;           // s^-1, ~43° N
const MS_TO_KT = 1.943844;
const DEG = Math.PI / 180;

const DRYLINE_FACTOR = {
  dryline_cyclone: 1.0, lee_cyclogenesis: 0.72, shortwave_ejection: 0.32, progressive_cold_front: 0.15,
  warm_front_wave: 0.05, northwest_flow: 0, high_plains_upslope: 0
};

export function createSynopticPattern(random, setupName, intensity, s = {}) {
  const troughX = s.troughX ?? lerp(0.0, 0.25, random());
  const troughY = s.troughY ?? lerp(0.25, 0.5, random());
  const lowX = clamp(s.lowX ?? troughX + lerp(0.14, 0.26, random()), 0.2, 0.75);
  const lowY = clamp(s.lowY ?? troughY - lerp(0.04, 0.12, random()), 0.12, 0.5);
  const troughDm = s.troughDm ?? 8;
  // The first shortwave sits upstream of the surface low so the low starts under its support
  // (cyclonic vorticity advection ahead of the wave).
  const toward = ((s.flowFromDeg ?? 235) + 180) * DEG, fe = Math.sin(toward), fn = Math.cos(toward);
  const upstream = lerp(0.16, 0.24, random());
  return {
    setupName, intensity,
    drylineFactor: DRYLINE_FACTOR[setupName] ?? 0.3,
    phase: random() * Math.PI * 2,
    domainKm: s.domainKm ?? 805,
    flowFromDeg: s.flowFromDeg ?? 235,
    flow500Kt: s.flow500Kt ?? 40,
    troughX, troughY, troughDm,
    troughAlongWidth: lerp(0.45, 0.6, random()),
    troughAcrossWidth: lerp(0.75, 0.95, random()),
    ridgeDm: troughDm * lerp(0.4, 0.7, random()),
    negativeTilt: s.tilt ?? 0.5,
    baseHeight500Dm: lerp(568, 582, random()),
    highX: s.highX ?? lerp(0.85, 1.1, random()),
    highY: lerp(0.3, 0.7, random()),
    // Shortwaves riding through the trough; SynopticDynamics moves them and adds new ones.
    shortwaves: [{ id: 1, x: lowX - upstream * fe, y: lowY + upstream * fn, dm: troughDm * lerp(0.3, 0.45, random()) }],
    shortwaveDmRange: [troughDm * 0.28, troughDm * 0.5],
    jetPeakKt: s.jetPeakKt ?? 60,
    lljKt: s.lljKt ?? 40,
    lowX, lowY,
    lowDepthHpa: s.lowDepthHpa ?? 14,
    maxLowDepthHpa: (s.lowDepthHpa ?? 14) * 1.25,
    highStrengthHpa: lerp(3, 7, random()),
    // Boundary geometry relative to the low (evolved by SynopticDynamics).
    warmFrontOffset: lerp(0.02, 0.10, random()),
    coldFrontOffset: 0,
    coldFrontSlope: lerp(0.24, 0.55, random()),
    drylineOffset: lerp(-0.13, 0.02, random()),
    frontTroughHpa: lerp(1.2, 2.6, intensity)
  };
}

// Unit vector the background flow blows TOWARD, as (east, north).
export function flowVector(pattern) {
  const toward = ((pattern.flowFromDeg ?? 235) + 180) * DEG;
  return { e: Math.sin(toward), n: Math.cos(toward) };
}

// 500 mb height (dam): background gradient balancing the regime's flow, a tilted trough
// (elongated across the flow), a downstream ridge and the shortwaves riding through.
function height500Dm(pattern, nx, ny, excludeShortwave = null) {
  const L = (pattern.domainKm ?? 805) * 1000;
  const f = flowVector(pattern);
  const gradient = (pattern.flow500Kt / MS_TO_KT) * CORIOLIS / G; // m per m
  const east = (nx - 0.5) * L, north = -(ny - 0.5) * L;
  // Heights rise to the right of the flow (Northern Hemisphere).
  const background = gradient * (east * f.n - north * f.e) / 10;
  const dx = nx - pattern.troughX, dy = ny - pattern.troughY;
  const a = dx * f.e - dy * f.n;          // downstream positive
  const c = dx * f.n + dy * f.e;          // right of flow (toward higher heights)
  // Negative tilt: the trough axis runs from upstream-left to downstream-right.
  const tilt = -0.35 + 1.0 * (pattern.negativeTilt ?? 0.5);
  const troughShape = Math.exp(-((a - tilt * c) ** 2) / (2 * pattern.troughAlongWidth ** 2) - (c * c) / (2 * pattern.troughAcrossWidth ** 2));
  const ridgeShape = gaussian(nx - pattern.highX, ny - pattern.highY, 0.38);
  let shortwaveDip = 0, shortwaveShape = 0;
  for (const sw of pattern.shortwaves ?? []) {
    if (sw === excludeShortwave) continue;
    const shape = gaussian(nx - sw.x, ny - sw.y, 0.28);
    shortwaveDip += sw.dm * shape;
    shortwaveShape = Math.max(shortwaveShape, shape * clamp(sw.dm / Math.max(1, pattern.shortwaveDmRange?.[1] ?? 4), 0, 1.2));
  }
  return {
    height: pattern.baseHeight500Dm + background - pattern.troughDm * troughShape + pattern.ridgeDm * ridgeShape - shortwaveDip,
    troughShape, ridgeShape, shortwaveShape
  };
}

// Geostrophic wind (kt, east/north) from a height function, by central differences.
function geostrophicKt(heightAt, nx, ny, domainKm) {
  const h = 0.01, metres = h * domainKm * 1000;
  const dZdx = (heightAt(nx + h, ny) - heightAt(nx - h, ny)) * 10 / (2 * metres);
  const dZdNorth = (heightAt(nx, ny - h) - heightAt(nx, ny + h)) * 10 / (2 * metres);
  return { e: -(G / CORIOLIS) * dZdNorth * MS_TO_KT, n: (G / CORIOLIS) * dZdx * MS_TO_KT };
}

// The strongest shortwave's jet streak sits on its downstream side.
function jetStreakCore(pattern, nx, ny) {
  const f = flowVector(pattern);
  let best = 0;
  for (const sw of pattern.shortwaves ?? []) {
    const jx = sw.x + 0.14 * f.e + 0.05 * f.n, jy = sw.y - 0.14 * f.n + 0.05 * f.e;
    const strength = clamp(sw.dm / Math.max(1, pattern.shortwaveDmRange?.[1] ?? 4), 0, 1.3);
    best = Math.max(best, gaussian(nx - jx, ny - jy, 0.26) * strength);
  }
  return best;
}

// Upper-level support for ascent and surface cyclogenesis: the region just downstream of
// each shortwave (cyclonic vorticity advection), scaled by the shortwave's amplitude.
export function upperLevelSupport(pattern, nx, ny) {
  const f = flowVector(pattern);
  let support = 0;
  for (const sw of pattern.shortwaves ?? []) {
    const px = sw.x + 0.2 * f.e, py = sw.y - 0.2 * f.n;
    const strength = clamp(sw.dm / Math.max(1, pattern.shortwaveDmRange?.[1] ?? 4), 0, 1.3);
    support = Math.max(support, gaussian(nx - px, ny - py, 0.3) * strength);
  }
  return support;
}

// Balanced upper-level winds (kt, east/north in the pattern frame): geostrophic flow from the
// 500 mb heights plus the jet streak along the local flow, strongest at 250 mb.
export function samplePatternWinds(pattern, nx, ny, { excludeShortwave = null } = {}) {
  const vg = geostrophicKt((x, y) => height500Dm(pattern, x, y, excludeShortwave).height, nx, ny, pattern.domainKm ?? 805);
  const vgSpeed = Math.hypot(vg.e, vg.n) || 1;
  const jetCore = jetStreakCore(pattern, nx, ny);
  const jet500Boost = 0.3 * pattern.jetPeakKt * jetCore, jet250Boost = pattern.jetPeakKt * jetCore;
  const u500Kt = vg.e * (1 + jet500Boost / vgSpeed), v500Kt = vg.n * (1 + jet500Boost / vgSpeed);
  // Thermal wind: 250 mb flow ~1.5x 500 mb in a baroclinic westerly, veered slightly.
  const veer = -6 * DEG, ue = vg.e * 1.5, vn = vg.n * 1.5;
  const u250Kt = ue * Math.cos(veer) + vn * Math.sin(veer) + (vg.e / vgSpeed) * jet250Boost;
  const v250Kt = -ue * Math.sin(veer) + vn * Math.cos(veer) + (vg.n / vgSpeed) * jet250Boost;
  return { u500Kt, v500Kt, u250Kt, v250Kt, jet500Kt: Math.hypot(u500Kt, v500Kt), jet250Kt: Math.hypot(u250Kt, v250Kt) };
}

// Boundary geometry: the warm front, cold front and dryline meet near the low (triple point).
export function boundaryGeometry(pattern, nx, ny) {
  const { lowX, lowY } = pattern;
  const tripleY = lowY + pattern.warmFrontOffset;
  const southOfTriple = clamp((ny - tripleY) / 0.18, 0, 1);
  const warmFrontY = tripleY + 0.22 * (nx - lowX) + 0.018 * Math.sin((nx - lowX) * Math.PI * 2);
  const coldFrontX = lowX + pattern.coldFrontOffset - pattern.coldFrontSlope * (ny - tripleY)
    + southOfTriple * 0.020 * Math.sin((ny - tripleY) * Math.PI * 2 + pattern.phase * 0.7);
  const drylineX = lowX + southOfTriple * (pattern.drylineOffset + 0.035 * Math.sin((ny - tripleY) * Math.PI * 2 + pattern.phase * 1.2));
  return { tripleY, southOfTriple, warmFrontY, coldFrontX, drylineX };
}

// Gradient-wind balance: flow curving around a low is sub-geostrophic. Scales a geostrophic
// wind (kt) at distance radiusKm from the cyclone centre (cyclonic curvature).
export function cyclonicGradientWindKt(vg, radiusKm) {
  const speed = Math.hypot(vg.e, vg.n) / MS_TO_KT;
  if (!(speed > 0)) return vg;
  const fR = CORIOLIS * Math.max(50, radiusKm) * 1000;
  const scale = (-fR / 2 + Math.sqrt(fR * fR / 4 + fR * speed)) / speed;
  return { e: vg.e * scale, n: vg.n * scale };
}

// Sea-level pressure (hPa) from the current state.
export function seaLevelPressureAt(pattern, nx, ny) {
  return sampleSynopticPattern(pattern, nx, ny).seaLevelPressureHpa;
}

// elapsedHours only sets the time of day (for the nocturnal low-level jet diagnostic).
export function sampleSynopticPattern(pattern, nx, ny, elapsedHours = 0) {
  const cycleHour = ((12 + elapsedHours) % 24 + 24) % 24;
  const nocturnalLlJ = Math.exp(-0.5 * Math.pow(Math.min(Math.abs(cycleHour - 4), 24 - Math.abs(cycleHour - 4)) / 4.2, 2));
  const { lowX, lowY } = pattern;
  const upper = height500Dm(pattern, nx, ny);
  const troughCore = upper.troughShape, ridgeCore = upper.ridgeShape, shortwaveCore = upper.shortwaveShape;
  const troughAxisX = pattern.troughX - (pattern.negativeTilt ?? 0.5) * (ny - pattern.troughY) * 0.22;
  const jetCore = jetStreakCore(pattern, nx, ny);
  const upperSupport = clamp(0.7 * upperLevelSupport(pattern, nx, ny) + 0.2 * troughCore + 0.25 * jetCore, 0, 1.3);

  const { tripleY, warmFrontY, coldFrontX, drylineX } = boundaryGeometry(pattern, nx, ny);
  const topology = Array.isArray(pattern.boundaryTopology) ? pattern.boundaryTopology : ['cold', 'warm'];
  const warmFrontActivation = smoothstep(lowX - 0.02, lowX + 0.08, nx);
  const trailingBoundaryActivation = smoothstep(tripleY - 0.02, tripleY + 0.08, ny);
  const southOfWarmFront = topology.includes('warm') ? lerp(1, smoothstep(warmFrontY - 0.055, warmFrontY + 0.055, ny), warmFrontActivation) : 1;
  const aheadOfColdFront = topology.includes('cold') ? lerp(1, smoothstep(coldFrontX - 0.050, coldFrontX + 0.050, nx), trailingBoundaryActivation) : 1;
  const eastOfDryline = smoothstep(drylineX - 0.040, drylineX + 0.040, nx);
  const drylineActive = topology.includes('dryline') && pattern.drylineFactor > 0.2;
  const effectiveEastOfDryline = drylineActive ? lerp(1, eastOfDryline, clamp(pattern.drylineFactor, 0, 1) * trailingBoundaryActivation) : 1;

  // Sea-level pressure: cyclone, anticyclone and the pressure troughs along the fronts and
  // dryline (which is what produces their wind shifts).
  // A mature Plains cyclone spans ~600-900 km; a tighter core gives unrealistic gradients.
  const lowCore = gaussian(nx - lowX, ny - lowY, 0.45);
  const highCore = gaussian(nx - pattern.highX, ny - pattern.highY, 0.5);
  const frontTrough = pattern.frontTroughHpa ?? 1.8;
  // Frontal pressure troughs are ~70 km wide (narrower troughs imply unrealistic winds).
  const coldTrough = topology.includes('cold') ? Math.exp(-(((nx - coldFrontX) / 0.09) ** 2)) * trailingBoundaryActivation : 0;
  const drylineTrough = drylineActive ? 0.6 * Math.exp(-(((nx - drylineX) / 0.09) ** 2)) * trailingBoundaryActivation : 0;
  const warmTrough = topology.includes('warm') ? 0.5 * Math.exp(-(((ny - warmFrontY) / 0.09) ** 2)) * warmFrontActivation : 0;
  const seaLevelPressureHpa = 1016 - pattern.lowDepthHpa * lowCore + pattern.highStrengthHpa * highCore
    - frontTrough * Math.max(coldTrough, drylineTrough, warmTrough);

  const warmSector = southOfWarmFront * aheadOfColdFront * effectiveEastOfDryline;
  const postFrontal = 1 - aheadOfColdFront;
  const coolSector = 1 - southOfWarmFront;
  const hotDry = southOfWarmFront * aheadOfColdFront * (1 - effectiveEastOfDryline);

  let airMass = 'mT';
  if (postFrontal > 0.55 || coolSector > 0.62) airMass = ny < 0.48 ? 'cP' : 'mP';
  if (hotDry > 0.52) airMass = 'cT';
  if (pattern.setupName === 'high_plains_upslope' && nx < 0.55 && airMass !== 'cT') airMass = 'upslope';

  return {
    troughAxisX, troughCore, shortwaveCore, ridgeCore, jetCore,
    height500Dm: upper.height, seaLevelPressureHpa,
    lowCore, highCore, upperSupport,
    warmFrontY, coldFrontX, drylineX, drylineActive,
    southOfWarmFront, aheadOfColdFront, eastOfDryline: effectiveEastOfDryline,
    warmSector, postFrontal, coolSector, hotDry, airMass,
    lifecycle: { nocturnalLlJ }
  };
}
