import { clamp, gaussian, lerp } from './math.js';
import { effectivePatternHours, waveAt } from './ActivePattern.js';

// Peak 700 mb warming under the EML core. 3.8 C stacked on the generator's warm-sector
// boost produced 13-15 C caps that suppressed nearly all surface-based convection.
const EML_700_WARMING_C = 2.6;

export function initializeAirMassEngine(world, pattern) {
  world.airMassEngine = {
    initializedHourUtc: world.validHourUtc,
    eml: {
      id: 'EML001',
      source: 'Southwest Plateau',
      centerX: pattern.lowX - 0.17,
      centerY: pattern.lowY + 0.20,
      axisAngleDeg: 28 + pattern.negativeTilt * 22,
      majorRadius: 0.46,
      minorRadius: 0.22,
      baseHpa: 790,
      topHpa: 540,
      strength: clamp(0.48 + pattern.intensity * 0.42, 0.35, 0.95),
      transportEastPerHour: clamp(pattern.motionXPerHour * 0.82 + 0.004, 0.004, 0.022),
      transportNorthPerHour: clamp(-pattern.motionYPerHour * 0.35 + 0.001, -0.004, 0.008),
      ageHours: 0
    }
  };
  projectAirMassAndEml(world, pattern, 0);
  projectAuthoritativeAirMassFractions(world);
}

export function advanceAirMassEngine(world, pattern, dtHours = 1) {
  if (!world.airMassEngine) initializeAirMassEngine(world, pattern);
  const eml = world.airMassEngine.eml;
  eml.ageHours += dtHours;
  const stormCoverage = Math.min(1, (world.storms?.length ?? 0) / 20);
  const sequence = pattern?.activeSequence;
  if (sequence) {
    // Active sequence: the plume follows the pattern's daily ejection/reload, and fresh
    // plateau air re-establishes it overnight under the southwesterly flow.
    eml.originX ??= eml.centerX - eml.transportEastPerHour * (eml.ageHours - dtHours);
    eml.originY ??= eml.centerY + eml.transportNorthPerHour * (eml.ageHours - dtHours);
    const hours = effectivePatternHours(sequence, Number(world.evolution?.elapsedHours) || eml.ageHours);
    eml.centerX = eml.originX + eml.transportEastPerHour * hours;
    eml.centerY = eml.originY - eml.transportNorthPerHour * hours;
    const night = waveAt(sequence, Number(world.evolution?.elapsedHours) || 0).hoursIntoDay >= 16;
    eml.baseStrength ??= eml.strength;
    eml.strength = night
      ? clamp(eml.strength + (eml.baseStrength - eml.strength) * dtHours * 0.15, 0.12, 1)
      : clamp(eml.strength - dtHours * (0.004 + stormCoverage * 0.012), 0.12, 1);
  } else {
    eml.centerX += eml.transportEastPerHour * dtHours;
    eml.centerY -= eml.transportNorthPerHour * dtHours;
    eml.strength = clamp(eml.strength - dtHours * (0.004 + stormCoverage * 0.012), 0.12, 1);
  }
  projectAirMassAndEml(world, pattern, dtHours);
  projectAuthoritativeAirMassFractions(world);
}

export function projectAirMassAndEml(world, pattern, dtHours = 0) {
  const eml = world.airMassEngine?.eml;
  if (!eml) return;
  const angle = eml.axisAngleDeg * Math.PI / 180;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  world.forEachCell((cell, x, y) => {
    const nx = x / Math.max(1, world.width - 1);
    const ny = y / Math.max(1, world.height - 1);
    const dx = nx - eml.centerX, dy = ny - eml.centerY;
    const along = dx * cos + dy * sin;
    const across = -dx * sin + dy * cos;
    const footprint = Math.exp(-0.5 * ((along / eml.majorRadius) ** 2 + (across / eml.minorRadius) ** 2));
    const sourceSupport = cell.region?.emlFrequency ?? 0.65;
    const warmMoistOverlap = clamp((cell.surface.dewpoint - 48) / 22, 0, 1);
    const influence = clamp(footprint * eml.strength * (0.55 + sourceSupport * 0.45), 0, 1);
    cell.features.emlInfluence = influence;
    cell.features.emlBaseHpa = eml.baseHpa;
    cell.features.emlDepthHpa = eml.baseHpa - eml.topHpa;
    cell.features.airMassOrigin = airMassOrigin(cell.features.airMass);
    cell.features.airMassModification = clamp((eml.ageHours / 30) + warmMoistOverlap * 0.15, 0, 1);
    // The EML warms 700 mb and cools 500 mb relative to the air mass's own profile. Relax
    // toward that target; adding the increment every step warmed 700 mb without bound.
    const l700 = cell.levels[700], l500 = cell.levels[500];
    l700.emlFreeTemperature ??= l700.temperature;
    l500.emlFreeTemperature ??= l500.temperature;
    if (influence > 0.02 || cell.features.emlApplied) {
      const adjustment = dtHours > 0 ? Math.min(1, dtHours * 0.35) : 1;
      l700.temperature += (l700.emlFreeTemperature + influence * EML_700_WARMING_C - l700.temperature) * adjustment;
      l500.temperature += (l500.emlFreeTemperature - influence * 1.8 - l500.temperature) * adjustment;
      cell.features.emlApplied = influence > 0.02;
    }
    if (influence > 0.02) {
      cell.features.midlevelLapseRateCkm = lerp(6.2, 8.9, influence);
      cell.features.capStrength = clamp(influence * (0.62 + warmMoistOverlap * 0.38), 0, 1);
    } else {
      cell.features.midlevelLapseRateCkm = cell.features.midlevelLapseRateCkm ?? 6.3;
      cell.features.capStrength = cell.features.capStrength ?? 0;
    }
  });
}

function airMassOrigin(type) {
  return ({ mT: 'Gulf source', cT: 'Southwest desert source', cP: 'Northern continental source', mP: 'Cool maritime source', upslope: 'Modified High Plains', elevated: 'Elevated warm layer' })[type] ?? 'Modified continental source';
}

export function projectAuthoritativeAirMassFractions(world) {
  world.forEachCell(cell => {
    const sector = cell.airMass?.sector ?? 'ambient';
    const dew = Number(cell.surface?.dewpoint) || 45;
    const temp = Number(cell.surface?.temperature) || 60;
    const moisture = clamp((dew - 38) / 32, 0, 1);
    const warmth = clamp((temp - 42) / 48, 0, 1);
    const fractions = {
      maritimeTropical: moisture * warmth,
      dryMixed: clamp((1 - moisture) * warmth, 0, 1),
      continentalPolar: clamp((1 - warmth) * (1 - moisture * 0.35), 0, 1),
      coolStable: clamp((1 - warmth) * moisture, 0, 1),
      outflowModified: clamp(Number(cell.features?.stormProcessedAir ?? cell.memory?.processedAir) || 0, 0, 1)
    };
    if (sector === 'warm-moist-sector' || sector === 'warm-sector') fractions.maritimeTropical += 0.85;
    if (sector === 'dry-sector') fractions.dryMixed += 1.15;
    if (sector === 'post-cold-front') fractions.continentalPolar += 1.25;
    if (sector === 'cool-sector') fractions.coolStable += 1.05;
    const total = Object.values(fractions).reduce((sum, value) => sum + Math.max(0, value), 0) || 1;
    for (const key of Object.keys(fractions)) fractions[key] = clamp(fractions[key] / total, 0, 1);
    const dominant = Object.entries(fractions).sort((a,b) => b[1]-a[1])[0]?.[0] ?? 'modifiedContinental';
    cell.airMassFractions = fractions;
    cell.airMassAuthority = {
      version: '2.69.0', dominant,
      confidence: clamp(Math.max(...Object.values(fractions)), 0.2, 1),
      warmMoistFraction: fractions.maritimeTropical,
      dryFraction: fractions.dryMixed,
      coldFraction: fractions.continentalPolar + fractions.coolStable,
      boundaryDerived: true
    };
  });
  return world;
}
