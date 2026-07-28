import { clamp } from '../scenarios/math.js?v=2.20.1';

export function sampleStormEnvironment(world, xKm, yKm) {
  const gx = clamp(xKm / world.cellSizeKm - 0.5, 0, world.width - 1);
  const gy = clamp(yKm / world.cellSizeKm - 0.5, 0, world.height - 1);
  const x0 = Math.floor(gx), y0 = Math.floor(gy);
  const x1 = Math.min(world.width - 1, x0 + 1), y1 = Math.min(world.height - 1, y0 + 1);
  const tx = gx - x0, ty = gy - y0;
  const cells = [world.getCell(x0,y0), world.getCell(x1,y0), world.getCell(x0,y1), world.getCell(x1,y1)];
  const weights = [(1-tx)*(1-ty), tx*(1-ty), (1-tx)*ty, tx*ty];
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
  const surfaceCape = mean(cell => cell.derived.cape);
  const mostUnstableCape = mean(cell => cell.derived?.sounding?.mucape ?? cell.derived.cape);
  const setupKey = world.setupForecast?.key ?? world.evolution?.config?.setupType ?? '';
  const cape = ['northwest_flow', 'elevated_mcs'].includes(setupKey)
    ? Math.max(surfaceCape, mostUnstableCape * 0.65)
    : surfaceCape;
  return {
    cape, surfaceCape, mostUnstableCape,
    cin: mean(cell => cell.derived.cin), srh: mean(cell => cell.derived.srh),
    stp: mean(cell => cell.derived.stp ?? 0), rawStp: mean(cell => cell.derived.rawStp ?? cell.derived.stp ?? 0),
    vtp: mean(cell => cell.derived.vtp ?? 0), synopticTornadoSupport: mean(cell => cell.derived.synopticTornadoSupport ?? 0), scp: mean(cell => cell.derived.scp ?? 0),
    bulkShear: mean(cell => cell.derived.bulkShear), lcl: mean(cell => cell.derived.lclAgl ?? Math.max(0,(cell.derived.lcl??0)-(cell.terrain?.elevationM??0))),
    readiness: mean(cell => cell.dynamics?.convectiveReadiness ?? 0), trigger: mean(cell => cell.dynamics?.triggerStrength ?? 0),
    initiation: mean(cell => cell.dynamics?.initiationPotential ?? 0), forcing: mean(cell => cell.dynamics?.forcingScore ?? 0),
    stormCoverage: mean(cell => cell.forecast?.stormCoverage ?? 0.4), discreteFraction: mean(cell => cell.forecast?.discreteFraction ?? 0.4),
    linearFraction: mean(cell => cell.forecast?.linearFraction ?? 0.4),
    warmSector: mean(cell => cell.features?.warmSector ? 1 : 0),
    openWarmSectorSupport: mean(cell => cell.forecast?.openWarmSectorSupport ?? 0),
    projectedStormTrackSupport: mean(cell => cell.forecast?.projectedStormTrackSupport ?? 0),
    prefrontalSupercellSupport: mean(cell => cell.forecast?.prefrontalSupercellSupport ?? 0),
    tornadicEnvironmentSupport: mean(cell => cell.forecast?.tornadicEnvironmentSupport ?? 0),
    synopticAscent: mean(cell => cell.features?.synopticAscent ?? 0),
    synopticCoherence: mean(cell => cell.features?.synopticCoherence ?? world.synopticCoherence?.score ?? 1),
    moisturePooling: mean(cell => cell.mesoscaleFields?.moisturePooling ?? 0),
    capErosion: mean(cell => cell.mesoscaleFields?.capErosion ?? 0),
    boundaryInfluence: mean(cell => cell.features?.explicitBoundaryInfluence ?? 0),
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
    surfaceWind: wind('surface'), wind850: wind(850), wind500: wind(500)
  };
}

export function diagnoseStormMotion(environment, mode = 'developing convection') {
  const KT_TO_KPH = 1.852;
  const meanEast = environment.wind850.eastKt * 0.42 + environment.wind500.eastKt * 0.58;
  const meanNorth = environment.wind850.northKt * 0.42 + environment.wind500.northKt * 0.58;
  const shearEast = environment.wind500.eastKt - environment.surfaceWind.eastKt;
  const shearNorth = environment.wind500.northKt - environment.surfaceWind.northKt;
  const shearMagnitude = Math.hypot(shearEast, shearNorth) || 1;
  let deviationKt = 0;
  if (mode.includes('supercell')) deviationKt = 7.5 * clamp((environment.bulkShear - 22) / 30, 0, 1);
  const sign = mode.includes('left-moving') ? -1 : 1;
  const devEast = sign * shearNorth / shearMagnitude * deviationKt;
  const devNorth = sign * -shearEast / shearMagnitude * deviationKt;
  let east = meanEast + devEast, north = meanNorth + devNorth;
  if (mode === 'MCS' || mode === 'QLCS' || mode === 'linear segment') {
    const coldPoolPush = 3 + 7 * clamp(environment.linearFraction, 0, 1);
    east += shearEast / shearMagnitude * coldPoolPush;
    north += shearNorth / shearMagnitude * coldPoolPush;
  }
  east = east * KT_TO_KPH + (environment.coldPoolPropagation?.east ?? 0) * (mode === 'MCS' || mode === 'QLCS' ? 0.55 : 0.18);
  north = north * KT_TO_KPH + (environment.coldPoolPropagation?.north ?? 0) * (mode === 'MCS' || mode === 'QLCS' ? 0.55 : 0.18);
  east += environment.boundaryPropagation?.east ?? 0;
  north += environment.boundaryPropagation?.north ?? 0;
  return { east, north };
}
