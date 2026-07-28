import { clamp, gaussian, lerp } from './math.js?v=2.20.1';

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
}

export function advanceAirMassEngine(world, pattern, dtHours = 1) {
  if (!world.airMassEngine) initializeAirMassEngine(world, pattern);
  const eml = world.airMassEngine.eml;
  eml.centerX += eml.transportEastPerHour * dtHours;
  eml.centerY -= eml.transportNorthPerHour * dtHours;
  eml.ageHours += dtHours;
  const stormCoverage = Math.min(1, (world.storms?.length ?? 0) / 20);
  eml.strength = clamp(eml.strength - dtHours * (0.004 + stormCoverage * 0.012), 0.12, 1);
  projectAirMassAndEml(world, pattern, dtHours);
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
    if (influence > 0.02) {
      const adjustment = dtHours > 0 ? Math.min(1, dtHours * 0.35) : 1;
      cell.levels[700].temperature += influence * 3.8 * adjustment;
      cell.levels[500].temperature -= influence * 1.8 * adjustment;
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
