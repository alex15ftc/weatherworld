import { clamp } from '../scenarios/math.js';

const KT_TO_KPH = 1.852;
const BUNKERS_DEVIATION_KT = 14.6;   // 7.5 m/s
// A line moves with the cloud layer's mean wind plus its propagation (Corfidi et al. 1996; Corfidi 2003): k times the
// cloud-layer wind less the low-level jet, k from LINE_PROPAGATION_K[0] for a weak cold pool to [1] for a strong one (the
// forward-propagating system, 2 x mean - jet). The cloud layer's mean (850-300 mb in practice) is taken from the levels
// carried, CLOUD_LAYER_WEIGHTS. (2026-10-25: lines moved with the 0-6 km mean plus 0.6 of it less 850 mb, at a median
// of 14 m/s; MCSs move at about 18 m/s, most at 6-30, and nine derechos in ten faster than 18; Feng et al. 2019,
// Cohen et al. 2007.)
const LINE_PROPAGATION_K = [0.3, 1], LINE_COLD_POOL = [0.2, 0.6];
const CLOUD_LAYER_WEIGHTS = Object.freeze({ 850: 0.4, 500: 0.6 });
export const MEAN_WIND_WEIGHTS = Object.freeze({ surface: 0.13, 850: 0.5, 500: 0.37 });
const LINEAR_MODES = ['broken line', 'linear segment', 'QLCS with embedded supercells', 'QLCS', 'MCS'];
const UNDERCUTTING_RANGE_F = [1.5, 6];
const ramp = (value, low, high) => clamp(((Number(value) || 0) - low) / (high - low), 0, 1);

export function sampleStormEnvironment(world, xKm, yKm) {
  const gx = clamp(xKm / world.cellSizeKm - 0.5, 0, world.width - 1);
  const gy = clamp(yKm / world.cellSizeKm - 0.5, 0, world.height - 1);
  const x0 = Math.floor(gx), y0 = Math.floor(gy);
  const x1 = Math.min(world.width - 1, x0 + 1), y1 = Math.min(world.height - 1, y0 + 1);
  const tx = gx - x0, ty = gy - y0;
  const cells = [world.getCell(x0, y0), world.getCell(x1, y0), world.getCell(x0, y1), world.getCell(x1, y1)];
  const weights = [(1 - tx) * (1 - ty), tx * (1 - ty), (1 - tx) * ty, tx * ty];
  const mean = getter => cells.reduce((sum, cell, i) => sum + getter(cell) * weights[i], 0);
  const directionVector = getter => {
    let u = 0, v = 0;
    cells.forEach((cell, i) => {
      const direction = getter(cell) * Math.PI / 180;
      u += -Math.sin(direction) * weights[i];
      v += -Math.cos(direction) * weights[i];
    });
    return { u, v };
  };
  const wind = level => {
    const speed = mean(cell => level === 'surface' ? cell.surface.wind.speed : cell.levels[level].windSpeed);
    const vector = directionVector(cell => level === 'surface' ? cell.surface.wind.direction : cell.levels[level].windDirection);
    const norm = Math.hypot(vector.u, vector.v) || 1;
    return { eastKt: vector.u / norm * speed, northKt: vector.v / norm * speed };
  };
  const surfaceWind = wind('surface'), wind850 = wind(850), wind500 = wind(500);
  // How strongly the surface winds converge here (0-1): the only way a front, a dryline or
  // an outflow edge is felt.
  const boundaryInfluence = mean(cell => cell.features?.convergenceLift ?? 0);
  // How sharply rain-cooled air changes across this place (K between neighbouring cells): the
  // edge of a cold pool. Air crossing it is turned about a horizontal axis along the edge.
  const pools = cells.map(cell => Number(cell.features?.coldPoolK) || 0), outflowContrastK = Math.max(...pools) - Math.min(...pools);
  // How fast the air masses' density changes here (K per 100 km; AtmosphereWorld): a front.
  // Along it the winds back into the front and the density contrast turns the air about a
  // horizontal axis along it.
  const densityGradient = mean(cell => Number(cell.features?.densityGradientK100) || 0);
  // ...and how fast the moisture does (g/kg per 100 km): a dryline.
  const moistureGradient = mean(cell => Number(cell.features?.moistureGradientGkg100) || 0);
  // Temperature contrast across the storm's surroundings (deg F per cell): a dense air mass
  // undercutting the warm air (cold front, outflow) forces a solid line; a dryline does not.
  const temperatures = cells.map(cell => cell.surface.temperature);
  const undercutting = ramp(Math.max(...temperatures) - Math.min(...temperatures), UNDERCUTTING_RANGE_F[0], UNDERCUTTING_RANGE_F[1]);
  // The boundary's orientation, from the density gradient (weighted by its strength): its normal points into the dense air.
  const normal = cells.reduce((sum, cell) => { const s = Number(cell.features?.densityGradientK100) || 0; sum.e += s * (Number(cell.features?.densityGradientEast) || 0); sum.n += s * (Number(cell.features?.densityGradientNorth) || 0); return sum; }, { e: 0, n: 0 });
  const organization = diagnoseOrganizationTendency(world, xKm, yKm, surfaceWind, wind500, boundaryInfluence, undercutting, normal, densityGradient);
  const cape = mean(cell => cell.derived.cape), srh = mean(cell => cell.derived.srh), bulkShear = mean(cell => cell.derived.bulkShear);
  const lcl = mean(cell => cell.derived.lclAgl ?? Math.max(0, (cell.derived.lcl ?? 0) - (cell.terrain?.elevationM ?? 0)));
  const warmSector = mean(cell => Number(cell.features?.warmSector) || 0);
  // Ingredient diagnostics of the sampled air: a warm-sector environment favouring discrete
  // supercells, and low-level shear with low cloud bases favouring tornadoes.
  const supercellEnvironment = ramp(bulkShear, 30, 50) * ramp(cape, 500, 1500);
  const tornadicEnvironment = ramp(srh, 100, 300) * ramp(1700 - lcl, 0, 800) * ramp(bulkShear, 25, 45);
  return {
    cape, surfaceCape: cape,
    mostUnstableCape: mean(cell => cell.derived?.sounding?.mucape ?? cell.derived.cape),
    mostUnstableCin: mean(cell => Math.abs(cell.derived?.sounding?.mucin ?? cell.derived.cin ?? 0)),
    surfaceBasedCape: mean(cell => cell.derived?.sounding?.sbcape ?? cell.derived.cape),
    dewpoint: mean(cell => cell.surface.dewpoint),
    // The shear and helicity above the lowest km too: what a storm fed from above the ground takes in.
    srh03: mean(cell => cell.derived?.sounding?.srh03 ?? cell.derived.srh), shear01: mean(cell => cell.derived?.sounding?.shear01 ?? 0), shear03: mean(cell => cell.derived?.sounding?.shear03 ?? 0),
    // Height of the wet-bulb zero above the ground (m): how far hail falls through melting air.
    wetBulbZeroAglM: mean(cell => cell.derived?.sounding?.wetBulbZeroAglM ?? 3000),
    cin: mean(cell => cell.derived.cin), sbcin: mean(cell => cell.derived.sbcinMagnitude ?? cell.derived.cin), srh, outflowContrastK, densityGradient, moistureGradient,
    stp: mean(cell => cell.derived.stp ?? 0), rawStp: mean(cell => cell.derived.rawStp ?? cell.derived.stp ?? 0),
    vtp: mean(cell => cell.derived.vtp ?? 0), synopticTornadoSupport: mean(cell => cell.derived.synopticTornadoSupport ?? 0), scp: mean(cell => cell.derived.scp ?? 0),
    bulkShear, lcl,
    lapseRate700500: mean(cell => cell.derived?.lapseRate700500 ?? 6.5), lapseRate03: mean(cell => cell.derived?.lapseRate03km ?? 6.5), lapseRate01: mean(cell => cell.derived?.lapseRate01km ?? 8),
    // Energy available to downdraughts (J/kg): rain evaporating into dry air aloft and below cloud.
    dcape: mean(cell => cell.derived?.dcape ?? 600),
    readiness: mean(cell => cell.dynamics?.convectiveReadiness ?? 0), trigger: mean(cell => cell.dynamics?.triggerStrength ?? 0),
    initiation: mean(cell => cell.dynamics?.initiationPotential ?? 0), forcing: mean(cell => cell.dynamics?.forcingScore ?? 0),
    // Storm organization from the environment itself: storm crowding and deep-layer shear
    // relative to the nearest boundary (shear along a forcing boundary organizes lines).
    stormCoverage: organization.coverage, linearFraction: organization.linear, discreteFraction: organization.discrete,
    boundaryParallelShear: organization.boundaryParallel,
    warmSector, openWarmSectorSupport: warmSector,
    prefrontalSupercellSupport: warmSector * organization.discrete * supercellEnvironment,
    tornadicEnvironmentSupport: tornadicEnvironment,
    synopticAscent: mean(cell => cell.features?.synopticAscent ?? 0),
    synopticCoherence: mean(cell => cell.features?.synopticCoherence ?? world.synopticCoherence?.score ?? 1),
    moisturePooling: mean(cell => cell.mesoscaleFields?.moisturePooling ?? 0),
    capErosion: mean(cell => cell.mesoscaleFields?.capErosion ?? 0),
    boundaryInfluence,
    processedAir: mean(cell => cell.features?.stormProcessedAir ?? 0),
    outflowConvergence: mean(cell => cell.features?.stormOutflowConvergence ?? 0),
    mesoscale: {
      effectiveInflow: mean(cell => cell.mesoscaleFields?.effectiveInflow ?? 0),
      ascent: mean(cell => cell.mesoscaleFields?.ascent ?? 0),
      convergenceCorridor: mean(cell => cell.mesoscaleFields?.convergenceCorridor ?? 0),
      moisturePooling: mean(cell => cell.mesoscaleFields?.moisturePooling ?? 0),
      capErosion: mean(cell => cell.mesoscaleFields?.capErosion ?? 0),
      stretchingPotential: mean(cell => cell.mesoscaleFields?.stretchingPotential ?? 0),
      boundaryLayerDepthM: mean(cell => cell.mesoscaleFields?.boundaryLayerDepthM ?? 1000)
    },
    kinematicConvergence: mean(cell => cell.dynamics?.kinematicConvergence ?? 0), verticalVelocity: mean(cell => cell.dynamics?.verticalVelocity ?? 0),
    frontogenesis: mean(cell => cell.features?.frontogenesis ?? 0), jetDivergence: mean(cell => cell.features?.jetDivergence ?? 0),
    surfaceWind, wind850, wind500
  };
}

const ORGANIZATION = { undercut: 0.45, along: 0.45, crowding: 0.2, frontK100: [1, 3] };

// Line versus discrete tendency, from the fields around the storm: converging winds organise a line where a dense air mass
// undercuts them or where the deep-layer shear runs along the boundary (storms then stay on it and merge; shear across it
// carries them off it as discrete cells: Dial, Racy & Thompson 2010, Bluestein & Weisman 2000); crowded storms interact and
// grow upscale. (2026-10-26: the along-boundary share was a placeholder 0, and line organisation followed the storm count,
// r 0.66, more than the shear.)
function diagnoseOrganizationTendency(world, xKm, yKm, surfaceWind, wind500, boundaryInfluence, undercutting = 0, normal = { e: 0, n: 0 }, densityGradient = 0) {
  let neighbours = 0;
  for (const storm of world.storms ?? []) {
    if (storm.active === false) continue;
    const d = Math.hypot(storm.positionKm.x - xKm, storm.positionKm.y - yKm);
    if (d > 1 && d < 75) neighbours++;
  }
  const coverage = clamp(neighbours / 4, 0, 1);
  // A dense air mass undercutting the warm air where the winds converge forces a solid line.
  const shearE = (wind500?.eastKt ?? 0) - (surfaceWind?.eastKt ?? 0), shearN = (wind500?.northKt ?? 0) - (surfaceWind?.northKt ?? 0), shear = Math.hypot(shearE, shearN);
  const n = Math.hypot(normal.e, normal.n), across = shear > 1 && n > 0 ? Math.abs(shearE * normal.e + shearN * normal.n) / (shear * n) : 0.5;
  // Along the boundary: 1 for shear parallel to it, 0 across it, and nothing where there is no front to line up along.
  const front = clamp((densityGradient - ORGANIZATION.frontK100[0]) / (ORGANIZATION.frontK100[1] - ORGANIZATION.frontK100[0]), 0, 1), boundaryParallel = front * Math.sqrt(Math.max(0, 1 - across * across));
  const linear = clamp(0.1 + boundaryInfluence * (ORGANIZATION.undercut * undercutting + ORGANIZATION.along * boundaryParallel) + ORGANIZATION.crowding * coverage, 0.05, 0.95);
  return { linear, discrete: clamp(1 - 0.85 * linear, 0.05, 0.95), coverage, boundaryParallel };
}

// Storm motion. Ordinary cells move with the 0-6 km mean wind. Supercells deviate 7.5 m/s
// to the right (or left, for left movers) of the 0-6 km shear vector (Bunkers). Lines and
// MCSs propagate along their cold pools: the Corfidi downwind vector adds the mean wind
// minus the low-level jet, scaled by how cold-pool driven the system is.
// character: { rotating, linear, leftMover } (shares 0-1 from the storm's properties).
export function diagnoseStormMotion(environment, character = {}) {
  const rotating = clamp(Number(character.rotating) || 0, 0, 1), linear = clamp(Number(character.linear) || 0, 0, 1);
  // Mean wind of the lowest 6 km from the three levels carried (the surface, 850 mb near
  // 1.5 km and 500 mb near 5.7 km), each weighted by the depth it stands for.
  const meanEast = environment.surfaceWind.eastKt * MEAN_WIND_WEIGHTS.surface + environment.wind850.eastKt * MEAN_WIND_WEIGHTS[850] + environment.wind500.eastKt * MEAN_WIND_WEIGHTS[500];
  const meanNorth = environment.surfaceWind.northKt * MEAN_WIND_WEIGHTS.surface + environment.wind850.northKt * MEAN_WIND_WEIGHTS[850] + environment.wind500.northKt * MEAN_WIND_WEIGHTS[500];
  const shearEast = environment.wind500.eastKt - environment.surfaceWind.eastKt;
  const shearNorth = environment.wind500.northKt - environment.surfaceWind.northKt;
  const shearMagnitude = Math.hypot(shearEast, shearNorth) || 1;
  // A rotating updraft deviates from the mean wind; an organized line moves with its cold pool.
  const deviation = (character.leftMover ? -1 : 1) * rotating * (1 - linear) * BUNKERS_DEVIATION_KT;
  let east = meanEast + deviation * shearNorth / shearMagnitude;
  let north = meanNorth - deviation * shearEast / shearMagnitude;
  const cloudEast = environment.wind850.eastKt * CLOUD_LAYER_WEIGHTS[850] + environment.wind500.eastKt * CLOUD_LAYER_WEIGHTS[500];
  const cloudNorth = environment.wind850.northKt * CLOUD_LAYER_WEIGHTS[850] + environment.wind500.northKt * CLOUD_LAYER_WEIGHTS[500];
  const k = LINE_PROPAGATION_K[0] + (LINE_PROPAGATION_K[1] - LINE_PROPAGATION_K[0]) * ramp(character.coldPool, LINE_COLD_POOL[0], LINE_COLD_POOL[1]);
  east += linear * (cloudEast + k * (cloudEast - environment.wind850.eastKt) - east);
  north += linear * (cloudNorth + k * (cloudNorth - environment.wind850.northKt) - north);
  const coldPoolShare = 0.1 + 0.25 * linear;
  east = east * KT_TO_KPH + (environment.coldPoolPropagation?.east ?? 0) * coldPoolShare;
  north = north * KT_TO_KPH + (environment.coldPoolPropagation?.north ?? 0) * coldPoolShare;
  return { east, north };
}
