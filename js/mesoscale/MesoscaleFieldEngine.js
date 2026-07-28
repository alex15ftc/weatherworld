import { clamp } from '../scenarios/math.js?v=2.20.1';

const KNOT_TO_MS = 0.514444;

/**
 * Builds the explicit mesoscale bridge between the seed-driven synoptic state
 * and individual storms. Every value is diagnosed from the atmospheric grid,
 * terrain, diurnal cycle, and authoritative boundary/outflow objects.
 */
export function updateMesoscaleFields(world, dtHours = 0.5) {
  const dxKm = world.cellSizeKm;
  const next = new Array(world.width * world.height);
  const localHour = ((world.validHourUtc % 24) + 24) % 24;
  const solar = Math.max(0, Math.sin((localHour - 6) / 12 * Math.PI));

  world.forEachCell((cell, x, y) => {
    const w = world.getCell(Math.max(0, x - 1), y) ?? cell;
    const e = world.getCell(Math.min(world.width - 1, x + 1), y) ?? cell;
    const n = world.getCell(x, Math.max(0, y - 1)) ?? cell;
    const s = world.getCell(x, Math.min(world.height - 1, y + 1)) ?? cell;

    const thetaE = equivalentPotentialTemperature(cell);
    const thetaEW = equivalentPotentialTemperature(w);
    const thetaEE = equivalentPotentialTemperature(e);
    const thetaEN = equivalentPotentialTemperature(n);
    const thetaES = equivalentPotentialTemperature(s);
    const thetaEGradientKPer100Km = Math.hypot(thetaEE - thetaEW, thetaES - thetaEN) / (2 * dxKm) * 100;

    const dewpointGradientFPer100Km = Math.hypot(
      e.surface.dewpoint - w.surface.dewpoint,
      s.surface.dewpoint - n.surface.dewpoint
    ) / (2 * dxKm) * 100;
    const temperatureGradientFPer100Km = Math.hypot(
      e.surface.temperature - w.surface.temperature,
      s.surface.temperature - n.surface.temperature
    ) / (2 * dxKm) * 100;

    const convergence = Math.max(0, cell.dynamics?.surfaceConvergenceS1 ?? 0);
    const moistureFlux = Math.max(0, cell.dynamics?.moistureFluxConvergence ?? 0);
    const explicitBoundary = cell.features?.explicitBoundaryInfluence ?? 0;
    const outflow = cell.features?.stormOutflowConvergence ?? 0;
    const terrainLift = Math.max(0, cell.dynamics?.terrainLiftMs ?? 0);
    const upperSupport = clamp(
      (cell.features?.synopticAscent ?? 0) * 0.60 +
      (cell.features?.shortwaveTrough ? 0.18 : 0) +
      (cell.features?.jetStreak ? 0.12 : 0),
      0, 1
    );

    const soilMoisture = cell.terrain?.soilMoisture ?? 0.45;
    const elevation = cell.terrain?.elevationM ?? 0;
    const heating = solar * clamp(1.15 - soilMoisture * 0.55, 0.55, 1.05);
    const boundaryLayerDepthM = clamp(
      450 + heating * 1500 + Math.max(0, cell.surface.temperature - cell.surface.dewpoint) * 24 - elevation * 0.10,
      300, 2600
    );

    const moisturePooling = clamp(
      0.34 * scorePositive(moistureFlux, 0.15e-7, 2.4e-7) +
      0.24 * scorePositive(dewpointGradientFPer100Km, 3, 16) +
      0.22 * explicitBoundary +
      0.20 * outflow,
      0, 1
    );

    const differentialHeating = clamp(
      Math.abs(cell.surface.temperature - neighborhoodMean([w,e,n,s], c => c.surface.temperature)) / 7 +
      heating * Math.abs((cell.terrain?.soilMoisture ?? 0.45) - neighborhoodMean([w,e,n,s], c => c.terrain?.soilMoisture ?? 0.45)) * 1.8,
      0, 1
    );

    const convergenceCorridor = clamp(
      0.32 * scorePositive(convergence, 0.35e-4, 3.5e-4) +
      0.25 * explicitBoundary +
      0.18 * outflow +
      0.13 * moisturePooling +
      0.12 * terrainLift / 0.7 +
      0.10 * upperSupport,
      0, 1
    );

    const cape = Math.max(0, cell.derived?.cape ?? 0);
    const cin = Math.max(0, cell.derived?.cin ?? 0);
    const lclAgl = Math.max(0, cell.derived?.lclAgl ?? ((cell.derived?.lcl ?? elevation + 1500) - elevation));
    const instabilityReservoir = clamp((1 - Math.exp(-cape / 1600)) * (1 - clamp(lclAgl / 3000, 0, 0.7)), 0, 1);
    const capErosion = clamp(
      0.31 * heating +
      0.27 * convergenceCorridor +
      0.18 * upperSupport +
      0.14 * differentialHeating +
      0.10 * clamp((cell.dynamics?.capErosionRate ?? 0) / 20, 0, 1),
      0, 1
    );
    const capRemaining = clamp(cin / 180 * (1 - capErosion * 0.70), 0, 1);

    const surfaceVorticity = verticalVorticity(world, x, y, 'surface');
    const lowLevelVorticity = verticalVorticity(world, x, y, 850);
    const stretchingPotential = clamp(
      scorePositive(Math.abs(surfaceVorticity), 1e-5, 1.6e-4) *
      (0.45 + 0.55 * convergenceCorridor),
      0, 1
    );

    const effectiveInflow = clamp(
      0.38 * instabilityReservoir +
      0.22 * moisturePooling +
      0.18 * (1 - capRemaining) +
      0.12 * convergenceCorridor +
      0.10 * clamp((cell.derived?.bulkShear ?? 0) / 55, 0, 1),
      0, 1
    );

    const ascent = clamp(
      0.34 * convergenceCorridor +
      0.20 * upperSupport +
      0.16 * terrainLift / 0.7 +
      0.16 * moisturePooling +
      0.14 * differentialHeating,
      0, 1
    );

    const diagnosedInitiationFocus =
      Math.sqrt(effectiveInflow * Math.max(0, ascent)) *
      (0.38 + 0.62 * capErosion) *
      (0.52 + 0.48 * Math.max(convergenceCorridor, explicitBoundary, upperSupport * 0.55)) +
      upperSupport * instabilityReservoir * 0.16;
    const initiationFocus = clamp(Math.max(diagnosedInitiationFocus, upperSupport * 0.38), 0, 1);

    next[y * world.width + x] = {
      thetaE,
      thetaEGradientKPer100Km,
      dewpointGradientFPer100Km,
      temperatureGradientFPer100Km,
      boundaryLayerDepthM,
      moisturePooling,
      differentialHeating,
      convergenceCorridor,
      upperSupport,
      instabilityReservoir,
      capErosion,
      capRemaining,
      surfaceVorticityS1: surfaceVorticity,
      lowLevelVorticityS1: lowLevelVorticity,
      stretchingPotential,
      effectiveInflow,
      ascent,
      initiationFocus,
      source: 'atmospheric-grid'
    };
  });

  world.forEachCell((cell, x, y) => {
    const diagnosed = next[y * world.width + x];
    const previous = cell.mesoscaleFields;
    if (!previous || dtHours <= 0) {
      cell.mesoscaleFields = diagnosed;
      return;
    }
    const alpha = clamp(dtHours * 0.65, 0.18, 0.55);
    cell.mesoscaleFields = blendFields(previous, diagnosed, alpha);
  });

  world.mesoscale = world.mesoscale ?? {};
  world.mesoscale.fieldValidHourUtc = world.validHourUtc;
  world.mesoscale.fieldSource = 'surface, vertical profile, terrain, boundaries, outflow, diurnal heating';
}

function blendFields(previous, next, alpha) {
  const result = { ...next };
  for (const [key, value] of Object.entries(next)) {
    if (typeof value === 'number' && Number.isFinite(previous?.[key])) result[key] = previous[key] + (value - previous[key]) * alpha;
  }
  return result;
}

function equivalentPotentialTemperature(cell) {
  const tC = (cell.surface.temperature - 32) * 5 / 9;
  const tdC = (cell.surface.dewpoint - 32) * 5 / 9;
  const p = Math.max(700, cell.surface.pressure ?? 1000);
  const e = 6.112 * Math.exp(17.67 * tdC / (tdC + 243.5));
  const mixingRatio = 0.622 * e / Math.max(1, p - e);
  const theta = (tC + 273.15) * Math.pow(1000 / p, 0.286);
  return theta * Math.exp((2.5e6 * mixingRatio) / (1004 * Math.max(230, tC + 273.15)));
}

function verticalVorticity(world, x, y, level) {
  const dx = world.cellSizeKm * 1000;
  const w = world.getCell(Math.max(0, x - 1), y) ?? world.getCell(x, y);
  const e = world.getCell(Math.min(world.width - 1, x + 1), y) ?? world.getCell(x, y);
  const n = world.getCell(x, Math.max(0, y - 1)) ?? world.getCell(x, y);
  const s = world.getCell(x, Math.min(world.height - 1, y + 1)) ?? world.getCell(x, y);
  const ww = wind(w, level), we = wind(e, level), wn = wind(n, level), ws = wind(s, level);
  return ((we.v - ww.v) - (ws.u - wn.u)) / (2 * dx);
}

function wind(cell, level) {
  const source = level === 'surface' ? cell.surface.wind : { direction: cell.levels[level].windDirection, speed: cell.levels[level].windSpeed };
  const r = source.direction * Math.PI / 180;
  return { u: -Math.sin(r) * source.speed * KNOT_TO_MS, v: Math.cos(r) * source.speed * KNOT_TO_MS };
}

function neighborhoodMean(cells, getter) { return cells.reduce((sum, cell) => sum + getter(cell), 0) / cells.length; }
function scorePositive(value, onset, strong) { return value <= onset ? 0 : clamp((value - onset) / Math.max(1e-9, strong - onset), 0, 1); }
