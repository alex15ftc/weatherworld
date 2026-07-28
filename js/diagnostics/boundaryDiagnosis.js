import { clamp } from '../scenarios/math.js?v=2.20.1';

// Diagnoses mesoscale boundaries from the current evolving fields. Values are
// normalized to 100 km so thresholds remain physically meaningful on the 10-mile grid.
export function diagnoseBoundaries(world, previous = null) {
  let coldCount = 0;
  let warmCount = 0;
  let drylineCount = 0;

  world.forEachCell((cell, x, y) => {
    const diagnostics = calculateBoundaryDiagnostics(world, previous, x, y);
    const prior = cell.features ?? {};

    cell.features = {
      ...prior,
      front: diagnostics.front,
      dryline: diagnostics.dryline,
      warmSector: diagnostics.warmSector,
      moistureAxis: diagnostics.moistureAxis,
      convergence: diagnostics.convergence,
      windShift: diagnostics.windShift,
      temperatureGradient: diagnostics.temperatureGradient,
      dewpointGradient: diagnostics.dewpointGradient,
      pressureTendency: diagnostics.pressureTendency,
      boundaryStrength: diagnostics.boundaryStrength,
      environmentalBoundarySignal: diagnostics.environmentalBoundarySignal
    };

    if (diagnostics.front === 'cold') coldCount++;
    if (diagnostics.front === 'warm') warmCount++;
    if (diagnostics.dryline) drylineCount++;
  });

  world.evolution.boundaries = { coldCount, warmCount, drylineCount };
}

function calculateBoundaryDiagnostics(world, previous, x, y) {
  const cell = world.getCell(x, y);
  const west = world.getCell(Math.max(0, x - 1), y);
  const east = world.getCell(Math.min(world.width - 1, x + 1), y);
  const north = world.getCell(x, Math.max(0, y - 1));
  const south = world.getCell(x, Math.min(world.height - 1, y + 1));
  const spacingKm = world.cellSizeKm * 2;
  const scale100 = 100 / Math.max(1, spacingKm);

  const tDx = (east.surface.temperature - west.surface.temperature) * scale100;
  const tDy = (south.surface.temperature - north.surface.temperature) * scale100;
  const tdDx = (east.surface.dewpoint - west.surface.dewpoint) * scale100;
  const tdDy = (south.surface.dewpoint - north.surface.dewpoint) * scale100;
  const temperatureGradient = Math.hypot(tDx, tDy);
  const dewpointGradient = Math.hypot(tdDx, tdDy);

  const westWind = windComponents(west.surface.wind);
  const eastWind = windComponents(east.surface.wind);
  const northWind = windComponents(north.surface.wind);
  const southWind = windComponents(south.surface.wind);
  const divergencePer100Km = ((eastWind.u - westWind.u) + (southWind.v - northWind.v)) * scale100;
  const convergence = clamp(-divergencePer100Km / 45, -1, 1.5);
  const windShift = Math.max(
    angularDifference(west.surface.wind.direction, east.surface.wind.direction),
    angularDifference(north.surface.wind.direction, south.surface.wind.direction)
  );

  const previousPressure = previous?.seaLevelPressure?.[y * world.width + x];
  const pressureTendency = Number.isFinite(previousPressure)
    ? cell.surface.seaLevelPressure - previousPressure
    : 0;

  const eastMoister = east.surface.dewpoint - west.surface.dewpoint;
  const drylineScore =
    clamp((dewpointGradient - 5) / 13, 0, 1.4) * 0.48 +
    clamp((eastMoister - 3) / 14, 0, 1.2) * 0.28 +
    clamp((convergence + 0.05) / 0.75, 0, 1.2) * 0.16 +
    clamp(windShift / 85, 0, 1) * 0.08;

  const thermalScore = clamp((temperatureGradient - 3.5) / 11, 0, 1.4);
  const convergenceScore = clamp((convergence + 0.08) / 0.8, 0, 1.25);
  const shiftScore = clamp((windShift - 12) / 70, 0, 1.2);
  const frontScore = thermalScore * 0.58 + convergenceScore * 0.24 + shiftScore * 0.18;

  const allowed = world.evolution?.config?.boundaryTopology
    ?? world.scenarioMetadata?.boundaryTopology
    ?? ['cold', 'warm', 'dryline'];
  const dryline = allowed.includes('dryline')
    && drylineScore >= 0.43
    && dewpointGradient >= 7
    && eastMoister >= 3
    && dewpointGradient >= temperatureGradient * 0.75;
  let front = null;
  if (!dryline && frontScore >= 0.40 && temperatureGradient >= 4) {
    const coldAllowed = allowed.includes('cold');
    const warmAllowed = allowed.includes('warm');
    if (coldAllowed && !warmAllowed) front = 'cold';
    else if (warmAllowed && !coldAllowed) front = 'warm';
    else if (coldAllowed && warmAllowed) {
      // A warm front is principally a cross-front north/south thermal zone
      // with warmer air equatorward. A trailing cold front generally has a
      // stronger east/west component with warmer air ahead.
      const pattern = world.evolution?.config?.synopticPattern;
      const elapsed = Number(world.evolution?.elapsedHours) || 0;
      const currentLowX = pattern ? pattern.lowX + pattern.motionXPerHour * elapsed * 0.92 : 0;
      const currentLowY = pattern ? pattern.lowY + pattern.motionYPerHour * elapsed * 0.75 : 0;
      const tripleY = currentLowY + (Number(pattern?.warmFrontOffset) || 0);
      const patternX = Number.isFinite(cell.features?._patternX)
        ? cell.features._patternX
        : x / Math.max(1, world.width - 1);
      const patternY = Number.isFinite(cell.features?._patternY)
        ? cell.features._patternY
        : y / Math.max(1, world.height - 1);
      const warmGeometry = patternX >= currentLowX - 0.03
        && tDy > 0
        && Math.abs(tDy) > Math.abs(tDx) * 1.05;
      if (warmGeometry) front = 'warm';
      else if (patternY >= tripleY - 0.03 && Math.abs(tDx) >= Math.abs(tDy) * 0.55) front = 'cold';
    }
  }
  const environmentalBoundarySignal = Math.max(frontScore, drylineScore);
  const warmSector =
    cell.surface.temperature >= 67 &&
    cell.surface.dewpoint >= 55 &&
    cell.surface.wind.direction >= 120 &&
    cell.surface.wind.direction <= 230;

  const moistureAxis =
    cell.surface.dewpoint >= 61 &&
    cell.surface.dewpoint >= west.surface.dewpoint - 1 &&
    cell.surface.dewpoint >= east.surface.dewpoint - 1 &&
    cell.surface.dewpoint >= north.surface.dewpoint - 1 &&
    cell.surface.dewpoint >= south.surface.dewpoint - 1;

  return {
    front,
    dryline,
    warmSector,
    moistureAxis,
    convergence,
    windShift,
    temperatureGradient,
    dewpointGradient,
    pressureTendency,
    boundaryStrength: clamp(Math.max(frontScore, drylineScore), 0, 1),
    environmentalBoundarySignal
  };
}

function windComponents(wind) {
  const rad = wind.direction * Math.PI / 180;
  return {
    u: -wind.speed * Math.sin(rad),
    v: wind.speed * Math.cos(rad)
  };
}

function angularDifference(a, b) {
  return Math.abs(((a - b + 540) % 360) - 180);
}
