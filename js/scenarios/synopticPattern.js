import { clamp, gaussian, lerp, smoothstep } from './math.js?v=2.20.1';

const SETUP_PROFILES = {
  dryline_cyclone: { troughAmp: 22, wavelength: 0.68, speedX: 0.010, speedY: -0.002, moisture: 1.0, coldPush: 0.72, dryline: 1.0 },
  progressive_cold_front: { troughAmp: 28, wavelength: 0.58, speedX: 0.018, speedY: 0.000, moisture: 0.76, coldPush: 1.15, dryline: 0.15 },
  warm_front_wave: { troughAmp: 18, wavelength: 0.78, speedX: 0.012, speedY: -0.004, moisture: 1.08, coldPush: 0.48, dryline: 0.05 },
  lee_cyclogenesis: { troughAmp: 24, wavelength: 0.72, speedX: 0.009, speedY: -0.002, moisture: 0.92, coldPush: 0.66, dryline: 0.72 },
  shortwave_ejection: { troughAmp: 31, wavelength: 0.54, speedX: 0.016, speedY: -0.004, moisture: 0.88, coldPush: 0.82, dryline: 0.32 },
  northwest_flow: { troughAmp: 20, wavelength: 0.45, speedX: 0.021, speedY: 0.006, moisture: 0.55, coldPush: 0.92, dryline: 0.0 },
  high_plains_upslope: { troughAmp: 14, wavelength: 0.84, speedX: 0.006, speedY: -0.003, moisture: 0.72, coldPush: 0.35, dryline: 0.0 },
  elevated_mcs: { troughAmp: 17, wavelength: 0.70, speedX: 0.013, speedY: -0.002, moisture: 1.12, coldPush: 0.52, dryline: 0.0 }
};

export function createSynopticPattern(random, setupName, intensity, anchors = {}) {
  const profile = SETUP_PROFILES[setupName] ?? SETUP_PROFILES.shortwave_ejection;
  const troughX = anchors.troughX ?? lerp(0.20, 0.42, random());
  const troughY = anchors.troughY ?? lerp(0.25, 0.58, random());
  const lowX = anchors.lowX ?? clamp(troughX + lerp(0.10, 0.22, random()), 0.25, 0.62);
  const lowY = anchors.lowY ?? clamp(troughY - lerp(0.06, 0.14, random()), 0.15, 0.55);
  return {
    setupName,
    intensity,
    profile,
    moistureFactor: profile.moisture,
    coldPush: profile.coldPush,
    drylineFactor: profile.dryline,
    phase: random() * Math.PI * 2,
    troughX,
    troughY,
    lowX,
    lowY,
    highX: lerp(0.78, 1.04, random()),
    highY: lerp(0.28, 0.70, random()),
    jetOffsetX: lerp(0.10, 0.24, random()),
    jetOffsetY: lerp(-0.03, 0.12, random()),
    shortwaveOffsetX: lerp(-0.08, 0.05, random()),
    shortwaveOffsetY: lerp(-0.03, 0.10, random()),
    negativeTilt: random() < 0.67 ? lerp(0.35, 1.0, random()) : lerp(0, 0.35, random()),
    baseHeight500Dm: lerp(574, 590, random()),
    northHeightDropDm: lerp(20, 36, random()),
    troughAmplitudeDm: profile.troughAmp * lerp(0.72, 1.22, intensity),
    ridgeAmplitudeDm: lerp(8, 18, random()),
    jetBaseKt: lerp(38, 62, random()),
    jetPeakKt: lerp(78, 145, intensity),
    lowDepthHpa: lerp(8, 28, intensity),
    highStrengthHpa: lerp(3, 8, random()),
    motionXPerHour: profile.speedX * lerp(0.75, 1.25, random()),
    motionYPerHour: profile.speedY,
    warmFrontOffset: lerp(0.02, 0.10, random()),
    coldFrontSlope: lerp(0.24, 0.55, random()),
    drylineOffset: lerp(-0.13, 0.02, random()),
    waveAmplitude: lerp(0.018, 0.060, random()),
    moistureFactor: profile.moisture,
    coldPush: profile.coldPush,
    drylineFactor: profile.dryline
  };
}

export function sampleSynopticPattern(pattern, nx, ny, elapsedHours = 0) {
  const cycleHour = ((12 + elapsedHours) % 24 + 24) % 24;
  const maturity = clamp(elapsedHours / 30, 0, 1);
  const analog = pattern.analogGuidance ?? {};
  const moistureReturnPhase = clamp((elapsedHours - 3) / 18, 0, 1) * (0.72 + 0.28 * (analog.moistureReturn ?? 0.75));
  const ejectionPhase = clamp((elapsedHours - 6) / 20, 0, 1);
  const clearingPhase = clamp((elapsedHours - 4) / 12, 0, 1) * (analog.clearing ?? 0.72);
  const nocturnalLlJ = Math.exp(-0.5 * Math.pow(Math.min(Math.abs(cycleHour-4),24-Math.abs(cycleHour-4))/4.2,2));
  const shiftX = pattern.motionXPerHour * elapsedHours;
  const shiftY = pattern.motionYPerHour * elapsedHours;
  const troughX = pattern.troughX + shiftX;
  const troughY = pattern.troughY + shiftY;
  const lowX = pattern.lowX + shiftX * 0.92;
  const lowY = pattern.lowY + shiftY * 0.75;
  const highX = pattern.highX + shiftX * 0.35;
  const highY = pattern.highY;

  const wave = pattern.waveAmplitude * Math.sin((ny * Math.PI * 2 / pattern.profile.wavelength) + pattern.phase);
  const tilt = pattern.negativeTilt * (ny - troughY) * 0.22;
  const troughAxisX = troughX + wave - tilt;
  const troughDistance = nx - troughAxisX;
  const troughCore = Math.exp(-(troughDistance * troughDistance) / (2 * 0.075 * 0.075)) * gaussian(nx - troughX, ny - troughY, 0.42);
  const ridgeCore = gaussian(nx - highX, ny - highY, 0.42);
  const shortwaveX = troughX + pattern.shortwaveOffsetX;
  const shortwaveY = troughY + pattern.shortwaveOffsetY;
  const shortwaveCore = gaussian(nx - shortwaveX, ny - shortwaveY, 0.16);

  const height500Dm = pattern.baseHeight500Dm
    - ny * pattern.northHeightDropDm
    - pattern.troughAmplitudeDm * troughCore
    - pattern.troughAmplitudeDm * 0.55 * shortwaveCore
    + pattern.ridgeAmplitudeDm * ridgeCore;

  const jetX = lowX + pattern.jetOffsetX;
  const jetY = lowY + pattern.jetOffsetY;
  const jetCore = gaussian(nx - jetX, ny - jetY, 0.24) * clamp(0.55 + 0.75 * troughCore + 0.55 * shortwaveCore, 0, 1.5);
  const jet250Kt = clamp(pattern.jetBaseKt + pattern.jetPeakKt * jetCore, 35, 190);
  const jet500Kt = clamp(28 + jet250Kt * 0.42 + 18 * troughCore, 22, 105);

  const lowCore = gaussian(nx - lowX, ny - lowY, 0.25);
  const highCore = gaussian(nx - highX, ny - highY, 0.38);
  const upperSupport = clamp((0.50 * shortwaveCore + 0.35 * troughCore + 0.32 * jetCore) * (0.70 + 0.30 * ejectionPhase), 0, 1.3);
  const seaLevelPressureHpa = 1018
    - pattern.lowDepthHpa * lowCore * (0.76 + 0.35 * upperSupport)
    + pattern.highStrengthHpa * highCore;

  const tripleY = lowY + pattern.warmFrontOffset - elapsedHours * 0.00045;
  const southOfTriple = clamp((ny - tripleY) / 0.18, 0, 1);
  const warmFrontY = tripleY + 0.22 * (nx - lowX)
    + 0.018 * Math.sin((nx - lowX) * Math.PI * 2);
  // The air-mass boundaries share an underlying junction near the cyclone,
  // then separate naturally: the cold front trails southwest while the
  // dryline extends south and develops its westward bulge.
  const coldFrontX = lowX + pattern.coldPush * elapsedHours * 0.0015
    - pattern.coldFrontSlope * (ny - tripleY)
    + southOfTriple * 0.020 * Math.sin((ny - tripleY) * Math.PI * 2 + pattern.phase * 0.7);
  const drylineX = lowX + southOfTriple * (
    pattern.drylineOffset + elapsedHours * 0.00055
    + 0.035 * Math.sin((ny - tripleY) * Math.PI * 2 + pattern.phase * 1.2)
  );

  const topology = Array.isArray(pattern.boundaryTopology) ? pattern.boundaryTopology : ['cold', 'warm'];
  const warmFrontActivation = smoothstep(lowX - 0.02, lowX + 0.08, nx);
  const trailingBoundaryActivation = smoothstep(tripleY - 0.02, tripleY + 0.08, ny);
  const southOfWarmFront = topology.includes('warm')
    ? lerp(1, smoothstep(warmFrontY - 0.055, warmFrontY + 0.055, ny), warmFrontActivation)
    : 1;
  const aheadOfColdFront = topology.includes('cold')
    ? lerp(1, smoothstep(coldFrontX - 0.050, coldFrontX + 0.050, nx), trailingBoundaryActivation)
    : 1;
  const eastOfDryline = smoothstep(drylineX - 0.040, drylineX + 0.040, nx);
  const drylineActive = topology.includes('dryline') && pattern.drylineFactor > 0.2;
  const effectiveEastOfDryline = drylineActive
    ? lerp(1, eastOfDryline, pattern.drylineFactor * trailingBoundaryActivation)
    : 1;

  const warmSector = southOfWarmFront * aheadOfColdFront * effectiveEastOfDryline;
  const postFrontal = 1 - aheadOfColdFront;
  const coolSector = 1 - southOfWarmFront;
  const hotDry = southOfWarmFront * aheadOfColdFront * (1 - effectiveEastOfDryline);

  let airMass = 'mT';
  if (postFrontal > 0.55 || coolSector > 0.62) airMass = ny < 0.48 ? 'cP' : 'mP';
  if (hotDry > 0.52) airMass = 'cT';
  if (pattern.setupName === 'high_plains_upslope' && nx < 0.55) airMass = 'upslope';
  if (pattern.setupName === 'elevated_mcs' && ny < lowY + 0.24) airMass = 'elevated';

  return {
    troughAxisX, troughCore, shortwaveCore, ridgeCore, jetCore,
    height500Dm, jet250Kt, jet500Kt, seaLevelPressureHpa,
    lowCore, highCore, upperSupport,
    warmFrontY, coldFrontX, drylineX, drylineActive,
    southOfWarmFront, aheadOfColdFront, eastOfDryline: effectiveEastOfDryline,
    warmSector, postFrontal, coolSector, hotDry, airMass,
    lifecycle: { maturity, moistureReturnPhase, ejectionPhase, clearingPhase, nocturnalLlJ },
    coherence: pattern.coherence ?? 0.7, analogGuidance: analog
  };
}

export function airMassThermodynamics(type, ny, intensity = 0.6) {
  switch (type) {
    case 'cP': return { temperatureF: lerp(40, 62, ny), dewpointF: lerp(24, 43, ny), lapseModifier: -0.05 };
    case 'mP': return { temperatureF: lerp(48, 66, ny), dewpointF: lerp(38, 53, ny), lapseModifier: 0.00 };
    case 'cT': return { temperatureF: lerp(76, 96, ny), dewpointF: lerp(22, 42, ny), lapseModifier: 0.24 };
    case 'upslope': return { temperatureF: lerp(58, 76, ny), dewpointF: lerp(44, 58, ny), lapseModifier: 0.12 };
    case 'elevated': return { temperatureF: lerp(50, 68, ny), dewpointF: lerp(45, 58, ny), lapseModifier: 0.08 };
    default: return { temperatureF: lerp(68, 88, ny) + intensity * 2, dewpointF: lerp(58, 74, ny), lapseModifier: 0.16 };
  }
}
