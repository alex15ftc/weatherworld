import { clamp } from '../scenarios/math.js';

const KT_TO_KPH = 1.852;
const BUNKERS_DEVIATION_KT = 14.6;   // 7.5 m/s
const LINEAR_MODES = ['broken line', 'linear segment', 'QLCS with embedded supercells', 'QLCS', 'MCS'];

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
  const boundaryInfluence = mean(cell => cell.features?.explicitBoundaryInfluence ?? 0);
  const organization = diagnoseOrganizationTendency(world, xKm, yKm, surfaceWind, wind500, boundaryInfluence);
  return {
    cape: mean(cell => cell.derived.cape), surfaceCape: mean(cell => cell.derived.cape),
    mostUnstableCape: mean(cell => cell.derived?.sounding?.mucape ?? cell.derived.cape),
    mostUnstableCin: mean(cell => Math.abs(cell.derived?.sounding?.mucin ?? cell.derived.cin ?? 0)),
    surfaceBasedCape: mean(cell => cell.derived?.sounding?.sbcape ?? cell.derived.cape),
    dewpoint: mean(cell => cell.surface.dewpoint),
    cin: mean(cell => cell.derived.cin), srh: mean(cell => cell.derived.srh),
    stp: mean(cell => cell.derived.stp ?? 0), rawStp: mean(cell => cell.derived.rawStp ?? cell.derived.stp ?? 0),
    vtp: mean(cell => cell.derived.vtp ?? 0), synopticTornadoSupport: mean(cell => cell.derived.synopticTornadoSupport ?? 0), scp: mean(cell => cell.derived.scp ?? 0),
    bulkShear: mean(cell => cell.derived.bulkShear), lcl: mean(cell => cell.derived.lclAgl ?? Math.max(0, (cell.derived.lcl ?? 0) - (cell.terrain?.elevationM ?? 0))),
    readiness: mean(cell => cell.dynamics?.convectiveReadiness ?? 0), trigger: mean(cell => cell.dynamics?.triggerStrength ?? 0),
    initiation: mean(cell => cell.dynamics?.initiationPotential ?? 0), forcing: mean(cell => cell.dynamics?.forcingScore ?? 0),
    // Storm organization from the environment itself: storm crowding and deep-layer shear
    // relative to the nearest boundary (shear along a forcing boundary organizes lines).
    stormCoverage: organization.coverage, linearFraction: organization.linear, discreteFraction: organization.discrete,
    boundaryParallelShear: organization.boundaryParallel,
    warmSector: mean(cell => cell.features?.warmSector ? 1 : 0),
    openWarmSectorSupport: mean(cell => cell.forecast?.openWarmSectorSupport ?? 0),
    projectedStormTrackSupport: mean(cell => cell.forecast?.projectedStormTrackSupport ?? 0),
    prefrontalSupercellSupport: mean(cell => cell.forecast?.prefrontalSupercellSupport ?? 0),
    tornadicEnvironmentSupport: mean(cell => cell.forecast?.tornadicEnvironmentSupport ?? 0),
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

// Line versus discrete tendency. Storms initiated along a boundary whose deep-layer shear
// runs along it stay in the boundary's lift and merge into lines; shear across the boundary
// carries updrafts away from it and keeps them discrete. Crowded storms interact and grow
// upscale.
function diagnoseOrganizationTendency(world, xKm, yKm, surfaceWind, wind500, boundaryInfluence) {
  const shear = { x: wind500.eastKt - surfaceWind.eastKt, y: -(wind500.northKt - surfaceWind.northKt) }; // screen frame (y south)
  const shearMagnitude = Math.hypot(shear.x, shear.y) || 1;
  let nearest = null;
  for (const front of world.synopticObjects?.fronts ?? []) {
    const points = front.pointsKm ?? [];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
      const t = clamp(((xKm - a.x) * dx + (yKm - a.y) * dy) / l2, 0, 1);
      const d = Math.hypot(xKm - (a.x + t * dx), yKm - (a.y + t * dy));
      if (!nearest || d < nearest.d) nearest = { d, tx: dx / Math.sqrt(l2), ty: dy / Math.sqrt(l2) };
    }
  }
  const boundaryParallel = nearest ? Math.abs((shear.x * nearest.tx + shear.y * nearest.ty) / shearMagnitude) : 0;
  const nearBoundary = nearest ? Math.exp(-((nearest.d / 60) ** 2)) : 0;
  let neighbours = 0;
  for (const storm of world.storms ?? []) {
    if (storm.active === false) continue;
    const d = Math.hypot(storm.positionKm.x - xKm, storm.positionKm.y - yKm);
    if (d > 1 && d < 60) neighbours++;
  }
  const coverage = clamp(neighbours / 5, 0, 1);
  const linear = clamp(0.1 + 0.7 * Math.max(nearBoundary, boundaryInfluence) * boundaryParallel ** 2 + 0.25 * coverage, 0.05, 0.95);
  return { linear, discrete: clamp(1 - 0.85 * linear, 0.05, 0.95), coverage, boundaryParallel };
}

// Storm motion. Ordinary cells move with the 0-6 km mean wind. Supercells deviate 7.5 m/s
// to the right (or left, for left movers) of the 0-6 km shear vector (Bunkers). Lines and
// MCSs propagate along their cold pools: the Corfidi downwind vector adds the mean wind
// minus the low-level jet, scaled by how cold-pool driven the system is.
export function diagnoseStormMotion(environment, mode = 'developing convection') {
  const meanEast = environment.wind850.eastKt * 0.42 + environment.wind500.eastKt * 0.58;
  const meanNorth = environment.wind850.northKt * 0.42 + environment.wind500.northKt * 0.58;
  const shearEast = environment.wind500.eastKt - environment.surfaceWind.eastKt;
  const shearNorth = environment.wind500.northKt - environment.surfaceWind.northKt;
  const shearMagnitude = Math.hypot(shearEast, shearNorth) || 1;
  let east = meanEast, north = meanNorth;
  if (mode.includes('supercell')) {
    const sign = mode.includes('left-moving') ? -1 : 1;
    east += sign * shearNorth / shearMagnitude * BUNKERS_DEVIATION_KT;
    north += sign * -shearEast / shearMagnitude * BUNKERS_DEVIATION_KT;
  }
  if (LINEAR_MODES.includes(mode)) {
    const forward = clamp(0.3 + 0.7 * (Number(environment.linearFraction) || 0), 0, 1) * (mode === 'MCS' || mode === 'QLCS' ? 1 : 0.6);
    east += forward * (meanEast - environment.wind850.eastKt);
    north += forward * (meanNorth - environment.wind850.northKt);
  }
  east = east * KT_TO_KPH + (environment.coldPoolPropagation?.east ?? 0) * (mode === 'MCS' || mode === 'QLCS' ? 0.35 : 0.1);
  north = north * KT_TO_KPH + (environment.coldPoolPropagation?.north ?? 0) * (mode === 'MCS' || mode === 'QLCS' ? 0.35 : 0.1);
  east += environment.boundaryPropagation?.east ?? 0;
  north += environment.boundaryPropagation?.north ?? 0;
  return { east, north };
}
