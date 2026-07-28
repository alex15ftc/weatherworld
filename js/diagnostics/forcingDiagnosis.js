import { clamp } from '../scenarios/math.js?v=2.20.1';

const KNOT_TO_MS = 0.514444;
const G = 9.80665;
const RD = 287.05;
const BL_DEPTH_M = 1200;

export function diagnoseForcing(world, previous = null) {
  const dx = world.cellSizeKm * 1000;
  world.forEachCell((cell, x, y) => {
    const w = world.getCell(Math.max(0, x - 1), y) ?? cell;
    const e = world.getCell(Math.min(world.width - 1, x + 1), y) ?? cell;
    const n = world.getCell(x, Math.max(0, y - 1)) ?? cell;
    const s = world.getCell(x, Math.min(world.height - 1, y + 1)) ?? cell;

    const sw = windComponents(w.surface.wind.direction, w.surface.wind.speed);
    const se = windComponents(e.surface.wind.direction, e.surface.wind.speed);
    const sn = windComponents(n.surface.wind.direction, n.surface.wind.speed);
    const ss = windComponents(s.surface.wind.direction, s.surface.wind.speed);
    const divergence = (se.u - sw.u + ss.v - sn.v) / (2 * dx);
    const objectBoundaryConvergence = (cell.features?.boundaryConvergence ?? 0) * 2.2e-4;
    const stormOutflowConvergence = (cell.features?.stormOutflowConvergence ?? 0) * 2.8e-4;
    const convergence = -divergence + objectBoundaryConvergence + stormOutflowConvergence;

    // q is kg/kg. The flux divergence therefore has units kg kg^-1 s^-1.
    const qw = specificHumidity(w.surface.dewpoint, w.surface.pressure);
    const qe = specificHumidity(e.surface.dewpoint, e.surface.pressure);
    const qn = specificHumidity(n.surface.dewpoint, n.surface.pressure);
    const qs = specificHumidity(s.surface.dewpoint, s.surface.pressure);
    const moistureFluxConvergence = -(((qe * se.u) - (qw * sw.u) + (qs * ss.v) - (qn * sn.v)) / (2 * dx));

    const tempGrad = horizontalGradient(e.surface.temperature, w.surface.temperature, s.surface.temperature, n.surface.temperature, world.cellSizeKm);
    const oldGrad = previous ? previousGradient(previous, x, y, world.width, world.height, 'temperature', world.cellSizeKm) : tempGrad;
    // Change in horizontal temperature-gradient magnitude over the one-hour model step.
    const frontogenesis = tempGrad - oldGrad;

    const local = windComponents(cell.surface.wind.direction, cell.surface.wind.speed);
    const terrainLift = clamp((local.u * cell.terrain.slopeX + local.v * cell.terrain.slopeY) / 1000, -2, 2);

    const uw = windComponents(w.levels[250].windDirection, w.levels[250].windSpeed);
    const ue = windComponents(e.levels[250].windDirection, e.levels[250].windSpeed);
    const un = windComponents(n.levels[250].windDirection, n.levels[250].windSpeed);
    const us = windComponents(s.levels[250].windDirection, s.levels[250].windSpeed);
    const upperDivergence = (ue.u - uw.u + us.v - un.v) / (2 * dx);

    const vortW = relativeVorticity(world, Math.max(0, x - 1), y, 500);
    const vortE = relativeVorticity(world, Math.min(world.width - 1, x + 1), y, 500);
    const vortN = relativeVorticity(world, x, Math.max(0, y - 1), 500);
    const vortS = relativeVorticity(world, x, Math.min(world.height - 1, y + 1), 500);
    const mid = windComponents(cell.levels[500].windDirection, cell.levels[500].windSpeed);
    const vorticityAdvection = -(mid.u * (vortE - vortW) / (2 * dx) + mid.v * (vortS - vortN) / (2 * dx));

    const heating = clamp((cell.surface.temperature - 72) / 24, 0, 1);
    const convScore = signedPositiveScore(convergence, 0.5e-4, 4.0e-4);
    const mfcScore = signedPositiveScore(moistureFluxConvergence, 0.2e-7, 2.5e-7);
    const frontScore = signedPositiveScore(frontogenesis, 0.05, 1.25);
    const terrainScore = signedPositiveScore(terrainLift, 0.03, 0.75);
    const upperScore = signedPositiveScore(upperDivergence, 0.5e-5, 4.0e-5);
    const pvaScore = signedPositiveScore(vorticityAdvection, 0.5e-9, 2.5e-8);

    // Multiplicative synergy prevents weak traces of every ingredient from
    // looking stronger than one coherent, focused lifting mechanism.
    const kinematic = .27 * convScore + .22 * mfcScore + .14 * frontScore + .11 * terrainScore + .16 * upperScore + .10 * pvaScore;
    const focusedLift = Math.max(convScore, mfcScore, frontScore, terrainScore, upperScore, pvaScore);
    const synopticFeatureLift =
      clamp((cell.features.synopticAscent ?? 0) * 0.16, 0, 0.18) +
      (cell.features.shortwaveTrough ? 0.06 : 0) +
      (cell.features.upperTrough ? 0.03 : 0) +
      (cell.features.leeTrough ? 0.05 : 0) +
      (cell.features.jetStreak ? 0.025 : 0);
    const forcingScore = clamp(kinematic * (0.72 + 0.28 * focusedLift) + heating * 0.05 + synopticFeatureLift, 0, 1);

    // Estimate grid-scale ascent from boundary-layer mass convergence, terrain
    // displacement, and a smaller deep-layer response to upper divergence/PVA.
    const convergenceLift = clamp(convergence * BL_DEPTH_M, -0.35, 0.55);
    const upperLift = clamp(upperDivergence * 7000 * 0.35, -0.18, 0.35);
    const pvaLift = clamp(vorticityAdvection * 8.0e6, -0.12, 0.25);
    const verticalVelocity = clamp(convergenceLift + terrainLift * 0.55 + upperLift + pvaLift, -0.5, 1.25);

    const cape = Math.max(0, cell.derived.cape);
    const cin = Math.max(0, cell.derived.cin);
    const lclAgl = Math.max(0, (cell.derived.lcl ?? cell.terrain.elevationM + 1200) - cell.terrain.elevationM);
    const instability = 1 - Math.exp(-cape / 1400);
    const moistureDepth = clamp(1 - lclAgl / 2400, 0, 1);
    const liftEnergy = 0.5 * Math.pow(Math.max(0, verticalVelocity) * 35, 2);

    // 2.13.2 separates parcel readiness from the mechanism that actually
    // initiates convection. Readiness can be high on a strongly capped day;
    // trigger strength can be high along a front embedded in poor instability.
    // Meaningful initiation requires both fields to overlap.
    const capBreakability = 1 / (1 + Math.exp((cin - (35 + heating * 45)) / 24));
    const convectiveReadiness = clamp(
      (0.56 * instability + 0.27 * moistureDepth + 0.17 * heating) *
      (0.42 + 0.58 * capBreakability),
      0, 1
    );

    const triggerStrength = clamp(
      0.54 * forcingScore +
      0.22 * focusedLift +
      0.14 * clamp(Math.max(0, verticalVelocity) / 0.75, 0, 1) +
      0.10 * synopticFeatureLift / 0.18,
      0, 1
    );

    const dynamicCapRelease = 1 / (1 + Math.exp((cin - (18 + liftEnergy + triggerStrength * 95 + heating * 30)) / 18));
    const overlap = Math.sqrt(convectiveReadiness * triggerStrength);
    const initiationPotential = clamp(
      Math.pow(overlap, 1.10) * dynamicCapRelease,
      0, 1
    );

    // This is the occurrence-support term consumed by every hazard outlook.
    // It preserves a small conditional-risk floor for isolated initiation while
    // strongly rewarding broad, credible convective coverage.
    const initiationCoverage = clamp(
      0.42 + 0.58 * Math.pow(initiationPotential, 0.72),
      0.42, 1
    );

    cell.dynamics = {
      surfaceConvergenceS1: convergence,
      moistureFluxConvergence,
      frontogenesis,
      terrainLiftMs: terrainLift,
      upperDivergenceS1: upperDivergence,
      vorticityAdvection,
      verticalVelocityMs: verticalVelocity,
      capErosionRate: Math.max(0, Math.max(0, verticalVelocity) * 16 + forcingScore * 7 + heating * 3 - cin * .018),
      forcingScore,
      convectiveReadiness,
      triggerStrength,
      initiationPotential,
      initiationCoverage
    };
  });
}

function relativeVorticity(world, x, y, level) {
  const dx = world.cellSizeKm * 1000;
  const w = world.getCell(Math.max(0, x - 1), y) ?? world.getCell(x,y);
  const e = world.getCell(Math.min(world.width - 1, x + 1), y) ?? world.getCell(x,y);
  const n = world.getCell(x, Math.max(0, y - 1)) ?? world.getCell(x,y);
  const s = world.getCell(x, Math.min(world.height - 1, y + 1)) ?? world.getCell(x,y);
  const cw = windComponents(w.levels[level].windDirection, w.levels[level].windSpeed);
  const ce = windComponents(e.levels[level].windDirection, e.levels[level].windSpeed);
  const cn = windComponents(n.levels[level].windDirection, n.levels[level].windSpeed);
  const cs = windComponents(s.levels[level].windDirection, s.levels[level].windSpeed);
  return (ce.v - cw.v - (cs.u - cn.u)) / (2 * dx);
}
function previousGradient(grid, x, y, width, height, key, cellSizeKm) {
  const values = grid[key];
  const w = values[y * width + Math.max(0, x - 1)];
  const e = values[y * width + Math.min(width - 1, x + 1)];
  const n = values[Math.max(0, y - 1) * width + x];
  const s = values[Math.min(height - 1, y + 1) * width + x];
  return horizontalGradient(e, w, s, n, cellSizeKm);
}
function horizontalGradient(e, w, s, n, cellSizeKm) {
  return Math.hypot(e - w, s - n) / (2 * cellSizeKm) * 100;
}
function windComponents(direction, speedKt) {
  const r = direction * Math.PI / 180;
  const speed = speedKt * KNOT_TO_MS;
  return { u: -Math.sin(r) * speed, v: Math.cos(r) * speed };
}
function specificHumidity(dewpointF, pressureHpa) {
  const tdC = (dewpointF - 32) * 5 / 9;
  const vaporPressure = 6.112 * Math.exp((17.67 * tdC) / (tdC + 243.5));
  const mixingRatio = 0.622 * vaporPressure / Math.max(1, pressureHpa - vaporPressure);
  return mixingRatio / (1 + mixingRatio);
}
function signedPositiveScore(value, onset, strong) {
  if (value <= onset) return 0;
  return clamp((value - onset) / (strong - onset), 0, 1);
}
