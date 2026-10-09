import { clamp, gaussian, lerp, smoothstep } from './math.js';
import { effectivePatternHours, dayCharacterFactors, waveAt } from './ActivePattern.js';

// Pattern coordinates: nx east, ny SOUTH, both 0..1 across the domain (domainKm wide).
const G = 9.80665;
const CORIOLIS = 1e-4;           // s^-1, ~43° N
const MS_TO_KT = 1.943844;
const DEG = Math.PI / 180;

// Translation speeds and boundary behaviour per setup family (pattern units per hour).
const SETUP_PROFILES = {
  dryline_cyclone: { speedX: 0.010, speedY: -0.002, moisture: 1.0, coldPush: 0.72, dryline: 1.0 },
  progressive_cold_front: { speedX: 0.018, speedY: 0.000, moisture: 0.9, coldPush: 1.15, dryline: 0.15 },
  warm_front_wave: { speedX: 0.012, speedY: -0.004, moisture: 1.0, coldPush: 0.48, dryline: 0.05 },
  lee_cyclogenesis: { speedX: 0.009, speedY: -0.002, moisture: 0.95, coldPush: 0.66, dryline: 0.72 },
  shortwave_ejection: { speedX: 0.016, speedY: -0.004, moisture: 0.95, coldPush: 0.82, dryline: 0.32 },
  northwest_flow: { speedX: 0.021, speedY: 0.006, moisture: 0.9, coldPush: 0.92, dryline: 0.0 },
  high_plains_upslope: { speedX: 0.006, speedY: -0.003, moisture: 0.9, coldPush: 0.35, dryline: 0.0 }
};

// The large-scale setup. Every field is physical (dam, kt, hPa) and comes from the narrative's
// ingredients; nothing downstream reads the narrative itself to shape the atmosphere.
export function createSynopticPattern(random, setupName, intensity, s = {}) {
  const profile = SETUP_PROFILES[setupName] ?? SETUP_PROFILES.shortwave_ejection;
  const troughX = s.troughX ?? lerp(0.0, 0.25, random());
  const troughY = s.troughY ?? lerp(0.25, 0.5, random());
  const lowX = clamp(s.lowX ?? troughX + lerp(0.14, 0.26, random()), 0.2, 0.75);
  const lowY = clamp(s.lowY ?? troughY - lerp(0.04, 0.12, random()), 0.12, 0.5);
  return {
    setupName, intensity, profile,
    moistureFactor: profile.moisture, coldPush: profile.coldPush, drylineFactor: profile.dryline,
    phase: random() * Math.PI * 2,
    domainKm: s.domainKm ?? 805,
    flowFromDeg: s.flowFromDeg ?? 235,
    flow500Kt: s.flow500Kt ?? 40,
    troughX, troughY, lowX, lowY,
    troughDm: s.troughDm ?? 12,
    troughAlongWidth: lerp(0.45, 0.6, random()),
    troughAcrossWidth: lerp(0.75, 0.95, random()),
    ridgeDm: (s.troughDm ?? 12) * lerp(0.4, 0.7, random()),
    shortwaveDm: (s.troughDm ?? 12) * lerp(0.25, 0.4, random()),
    shortwaveOffsetX: lerp(0.0, 0.12, random()),
    shortwaveOffsetY: lerp(-0.05, 0.12, random()),
    negativeTilt: s.tilt ?? 0.5,
    baseHeight500Dm: lerp(568, 582, random()),
    highX: s.highX ?? lerp(0.85, 1.1, random()),
    highY: lerp(0.3, 0.7, random()),
    jetOffsetX: lerp(0.06, 0.18, random()),
    jetOffsetY: lerp(-0.04, 0.1, random()),
    jetPeakKt: s.jetPeakKt ?? 60,
    lljKt: s.lljKt ?? 40,
    lowDepthHpa: s.lowDepthHpa ?? 14,
    highStrengthHpa: lerp(3, 7, random()),
    motionXPerHour: profile.speedX * lerp(0.75, 1.25, random()),
    motionYPerHour: profile.speedY,
    warmFrontOffset: lerp(0.02, 0.10, random()),
    coldFrontSlope: lerp(0.24, 0.55, random()),
    drylineOffset: lerp(-0.13, 0.02, random()),
    waveAmplitude: lerp(0.018, 0.060, random()),
    frontTroughHpa: lerp(1.2, 2.6, intensity)
  };
}

// Positions of the moving pattern elements at pattern time t.
function patternGeometry(pattern, t) {
  const shiftX = pattern.motionXPerHour * t, shiftY = pattern.motionYPerHour * t;
  return {
    troughX: pattern.troughX + shiftX, troughY: pattern.troughY + shiftY,
    lowX: pattern.lowX + shiftX * 0.92, lowY: pattern.lowY + shiftY * 0.75,
    highX: pattern.highX + shiftX * 0.35, highY: pattern.highY
  };
}

// Unit vector the background flow blows TOWARD, as (east, north).
function flowVector(pattern) {
  const toward = ((pattern.flowFromDeg ?? 235) + 180) * DEG;
  return { e: Math.sin(toward), n: Math.cos(toward) };
}

// 500 mb height (dam): background gradient balancing the regime's flow, a tilted trough
// (elongated across the flow), a downstream ridge and an embedded shortwave.
function height500Dm(pattern, geo, nx, ny) {
  const L = (pattern.domainKm ?? 805) * 1000;
  const f = flowVector(pattern);
  const gradient = (pattern.flow500Kt / MS_TO_KT) * CORIOLIS / G; // m per m
  const east = (nx - 0.5) * L, north = -(ny - 0.5) * L;
  // Heights rise to the right of the flow (Northern Hemisphere).
  const background = gradient * (east * f.n - north * f.e) / 10;
  const along = (dx, dy) => dx * f.e - dy * f.n;          // pattern units, downstream positive
  const across = (dx, dy) => dx * f.n + dy * f.e;         // right of flow (toward higher heights)
  const dx = nx - geo.troughX, dy = ny - geo.troughY;
  const a = along(dx, dy), c = across(dx, dy);
  // Negative tilt: the trough axis runs from upstream-left to downstream-right.
  const tilt = -0.35 + 1.0 * (pattern.negativeTilt ?? 0.5);
  const troughShape = Math.exp(-((a - tilt * c) ** 2) / (2 * pattern.troughAlongWidth ** 2) - (c * c) / (2 * pattern.troughAcrossWidth ** 2));
  const ridgeShape = gaussian(nx - geo.highX, ny - geo.highY, 0.38);
  const swX = geo.troughX + pattern.shortwaveOffsetX, swY = geo.troughY + pattern.shortwaveOffsetY;
  const shortwaveShape = gaussian(nx - swX, ny - swY, 0.28);
  return {
    height: pattern.baseHeight500Dm + background - pattern.troughDm * troughShape + pattern.ridgeDm * ridgeShape - pattern.shortwaveDm * shortwaveShape,
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

function jetStreakCore(pattern, geo, nx, ny, troughCore, shortwaveCore) {
  const jetX = geo.lowX + pattern.jetOffsetX, jetY = geo.lowY + pattern.jetOffsetY;
  return gaussian(nx - jetX, ny - jetY, 0.24) * clamp(0.55 + 0.75 * troughCore + 0.55 * shortwaveCore, 0, 1.5);
}

function patternHours(pattern, elapsedHours) {
  return pattern.activeSequence ? effectivePatternHours(pattern.activeSequence, elapsedHours) : elapsedHours;
}

// Balanced upper-level winds (kt, east/north in the pattern frame): geostrophic flow from the
// 500 mb heights plus the jet streak along the local flow, strongest at 250 mb. Separate from
// sampleSynopticPattern because only the atmosphere builder and the upper-air coupling need it.
export function samplePatternWinds(pattern, nx, ny, elapsedHours = 0) {
  const geo = patternGeometry(pattern, patternHours(pattern, elapsedHours));
  const upper = height500Dm(pattern, geo, nx, ny);
  const jetCore = jetStreakCore(pattern, geo, nx, ny, upper.troughShape, upper.shortwaveShape);
  const vg = geostrophicKt((x, y) => height500Dm(pattern, geo, x, y).height, nx, ny, pattern.domainKm ?? 805);
  const vgSpeed = Math.hypot(vg.e, vg.n) || 1;
  const jet500Boost = 0.3 * pattern.jetPeakKt * jetCore, jet250Boost = pattern.jetPeakKt * jetCore;
  const u500Kt = vg.e * (1 + jet500Boost / vgSpeed), v500Kt = vg.n * (1 + jet500Boost / vgSpeed);
  // Thermal wind: 250 mb flow ~1.5x 500 mb in a baroclinic westerly, veered slightly.
  const veer = -6 * DEG, ue = vg.e * 1.5, vn = vg.n * 1.5;
  const u250Kt = ue * Math.cos(veer) + vn * Math.sin(veer) + (vg.e / vgSpeed) * jet250Boost;
  const v250Kt = -ue * Math.sin(veer) + vn * Math.cos(veer) + (vg.n / vgSpeed) * jet250Boost;
  return { u500Kt, v500Kt, u250Kt, v250Kt, jet500Kt: Math.hypot(u500Kt, v500Kt), jet250Kt: Math.hypot(u250Kt, v250Kt) };
}

// elapsedHours is real time since initialization. With an active multi-day sequence the
// pattern's position follows effectivePatternHours (daily ejection + overnight reload);
// callers that already pass effective time set timeIsEffective.
export function sampleSynopticPattern(pattern, nx, ny, elapsedHours = 0, timeIsEffective = false, realElapsedHours = null) {
  const sequence = pattern.activeSequence;
  const t = sequence && !timeIsEffective ? effectivePatternHours(sequence, elapsedHours) : elapsedHours;
  const real = timeIsEffective ? (realElapsedHours ?? elapsedHours) : elapsedHours;
  const day = dayCharacterFactors(sequence, real);
  const hoursIntoWave = sequence ? waveAt(sequence, real).hoursIntoDay : t;
  const cycleHour = ((12 + elapsedHours) % 24 + 24) % 24;
  const maturity = clamp(t / 30, 0, 1);
  const moistureReturnPhase = clamp((elapsedHours - 3) / 18, 0, 1);
  const ejectionPhase = sequence ? clamp((hoursIntoWave - 2) / 10, 0, 1) : clamp((elapsedHours - 6) / 20, 0, 1);
  const clearingPhase = clamp(((sequence ? hoursIntoWave : elapsedHours) - 4) / 12, 0, 1) * 0.72;
  const nocturnalLlJ = Math.exp(-0.5 * Math.pow(Math.min(Math.abs(cycleHour - 4), 24 - Math.abs(cycleHour - 4)) / 4.2, 2));
  const geo = patternGeometry(pattern, t);
  const { troughX, troughY, lowX, lowY } = geo;

  const upper = height500Dm(pattern, geo, nx, ny);
  const troughCore = upper.troughShape, ridgeCore = upper.ridgeShape, shortwaveCore = upper.shortwaveShape;
  const wave = pattern.waveAmplitude * Math.sin((ny * Math.PI * 2 / 0.7) + pattern.phase);
  const troughAxisX = troughX + wave - (pattern.negativeTilt ?? 0.5) * (ny - troughY) * 0.22;

  const jetCore = jetStreakCore(pattern, geo, nx, ny, troughCore, shortwaveCore);

  const lowCore = gaussian(nx - lowX, ny - lowY, 0.25);
  const highCore = gaussian(nx - geo.highX, ny - geo.highY, 0.38);
  const upperSupport = clamp((0.50 * shortwaveCore + 0.35 * troughCore + 0.32 * jetCore) * (0.70 + 0.30 * ejectionPhase) * (0.65 + 0.35 * day.strength), 0, 1.3);

  const tripleY = lowY + pattern.warmFrontOffset - t * 0.00045;
  const southOfTriple = clamp((ny - tripleY) / 0.18, 0, 1);
  const warmFrontY = tripleY + 0.22 * (nx - lowX) + 0.018 * Math.sin((nx - lowX) * Math.PI * 2);
  // The air-mass boundaries share a junction near the cyclone, then separate: the cold front
  // trails southwest while the dryline extends south and develops its westward bulge.
  const coldFrontX = lowX + pattern.coldPush * day.coldPush * t * 0.0015
    - pattern.coldFrontSlope * (ny - tripleY)
    + southOfTriple * 0.020 * Math.sin((ny - tripleY) * Math.PI * 2 + pattern.phase * 0.7);
  const drylineX = lowX + southOfTriple * (pattern.drylineOffset + t * 0.00055 + 0.035 * Math.sin((ny - tripleY) * Math.PI * 2 + pattern.phase * 1.2));

  const topology = Array.isArray(pattern.boundaryTopology) ? pattern.boundaryTopology : ['cold', 'warm'];
  const warmFrontActivation = smoothstep(lowX - 0.02, lowX + 0.08, nx);
  const trailingBoundaryActivation = smoothstep(tripleY - 0.02, tripleY + 0.08, ny);
  const southOfWarmFront = topology.includes('warm') ? lerp(1, smoothstep(warmFrontY - 0.055, warmFrontY + 0.055, ny), warmFrontActivation) : 1;
  const aheadOfColdFront = topology.includes('cold') ? lerp(1, smoothstep(coldFrontX - 0.050, coldFrontX + 0.050, nx), trailingBoundaryActivation) : 1;
  const eastOfDryline = smoothstep(drylineX - 0.040, drylineX + 0.040, nx);
  const drylineActive = topology.includes('dryline') && pattern.drylineFactor > 0.2;
  const effectiveEastOfDryline = drylineActive ? lerp(1, eastOfDryline, clamp(pattern.drylineFactor * day.dryline, 0, 1) * trailingBoundaryActivation) : 1;

  // Sea-level pressure: cyclone, anticyclone and the pressure troughs along the fronts and
  // dryline (which is what produces their wind shifts).
  const frontTrough = pattern.frontTroughHpa ?? 1.8;
  const coldTrough = topology.includes('cold') ? Math.exp(-(((nx - coldFrontX) / 0.04) ** 2)) * trailingBoundaryActivation : 0;
  const drylineTrough = drylineActive ? 0.6 * Math.exp(-(((nx - drylineX) / 0.05) ** 2)) * trailingBoundaryActivation : 0;
  const warmTrough = topology.includes('warm') ? 0.5 * Math.exp(-(((ny - warmFrontY) / 0.05) ** 2)) * warmFrontActivation : 0;
  const seaLevelPressureHpa = 1016
    - pattern.lowDepthHpa * lowCore * (0.76 + 0.35 * upperSupport) * (0.7 + 0.3 * day.strength)
    + pattern.highStrengthHpa * highCore
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
    lifecycle: { maturity, moistureReturnPhase, ejectionPhase, clearingPhase, nocturnalLlJ },
    coherence: pattern.coherence ?? 0.8
  };
}

