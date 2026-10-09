import { clamp } from '../scenarios/math.js';
import { createSharedStormState, evolveSharedStormState, snapshotSharedStormState, SHARED_STORM_KERNEL_VERSION } from './SharedStormEvolutionKernel.js';

export function initializeStormTrackIntelligence(storm) {
  storm.trackIntelligence ??= {
    version: '2.60.0',
    kernelVersion: SHARED_STORM_KERNEL_VERSION,
    confidence: 0.35,
    preferredBoundaryId: null,
    preferredBoundaryType: null,
    boundaryFollowingStrength: 0,
    instabilityAttraction: 0,
    motionHistory: [],
    interactionHistory: [],
    cycles: [],
    trackCorridor: { centerline: [], radius50Km: 12, radius90Km: 28 },
    swaths: { tornado: [], hail: [], wind: [] },
    stateHistory: [],
    sharedState: null
  };
  return storm.trackIntelligence;
}

export function updateStormTrackIntelligence(world, storm, environment, dtHours) {
  const ti = initializeStormTrackIntelligence(storm);
  const boundary = storm.boundaryInteraction ?? {};
  const initial = ti.sharedState ?? createSharedStormState({
    mode: storm.mode,
    ageHours: storm.ageHours,
    intensity: storm.intensity,
    organization: storm.organization,
    inflowQuality: storm.inflowQuality,
    coldPoolStrength: storm.coldPoolStrength,
    boundaryFollowingStrength: ti.boundaryFollowingStrength,
    boundaryId: ti.preferredBoundaryId,
    boundaryType: ti.preferredBoundaryType,
    confidence: ti.confidence,
    mesocyclonePhase: storm.mesocycloneCycle?.phase,
    remainingLifetimeHours: Math.max(0.5, 12 - (storm.ageHours ?? 0)),
    motion: { east: storm.velocityKph.east, north: storm.velocityKph.north }
  });
  const next = evolveSharedStormState(initial, {
    ...environment,
    boundaryStrength: boundary.strength,
    boundaryPropagation: boundary.propagation,
    boundaryId: boundary.id,
    boundaryType: boundary.type,
    competition: storm.interactionSuppression,
    baseMotion: { east: storm.velocityKph.east, north: storm.velocityKph.north }
  }, dtHours, { mode: 'realized' });
  ti.sharedState = next;
  ti.version = '2.60.0';
  ti.kernelVersion = SHARED_STORM_KERNEL_VERSION;
  ti.confidence = next.confidence;
  ti.boundaryFollowingStrength = next.boundaryFollowingStrength;
  ti.preferredBoundaryId = next.boundaryId;
  ti.preferredBoundaryType = next.boundaryType;
  ti.instabilityAttraction = clamp(((environment.cape ?? 0) / 4000) * 0.45 + (environment.openWarmSectorSupport ?? environment.warmSector ?? 0) * 0.35, 0, 1);
  storm.velocityKph.east = next.motion.east;
  storm.velocityKph.north = next.motion.north;

  const uncertainty = 1 - ti.confidence;
  const linear = next.mode === 'linear';
  ti.trackCorridor.radius50Km = clamp(8 + uncertainty * 20 + (linear ? 8 : 0), 8, 40);
  ti.trackCorridor.radius90Km = clamp(18 + uncertainty * 45 + (linear ? 14 : 0), 18, 78);
  const hourUtc = world.stormEngine?.validHourUtc ?? world.validHourUtc;
  ti.trackCorridor.centerline.push({ x: storm.positionKm.x, y: storm.positionKm.y, hourUtc });
  if (ti.trackCorridor.centerline.length > 180) ti.trackCorridor.centerline.splice(0, ti.trackCorridor.centerline.length - 180);
  ti.motionHistory.push({ hourUtc, eastKph: storm.velocityKph.east, northKph: storm.velocityKph.north, confidence: ti.confidence, mode: next.mode });
  if (ti.motionHistory.length > 180) ti.motionHistory.splice(0, ti.motionHistory.length - 180);
  ti.stateHistory.push(snapshotSharedStormState(next, hourUtc, { x: storm.positionKm.x, y: storm.positionKm.y }));
  if (ti.stateHistory.length > 180) ti.stateHistory.splice(0, ti.stateHistory.length - 180);
  if ((boundary.strength ?? 0) > 0.28) {
    ti.interactionHistory.push({ hourUtc, type: boundary.type, id: boundary.id, strength: boundary.strength });
    if (ti.interactionHistory.length > 60) ti.interactionHistory.splice(0, ti.interactionHistory.length - 60);
  }
  return ti;
}

export function updateStormHazardSwaths(world, storm) {
  const ti = initializeStormTrackIntelligence(storm);
  const p = { x: storm.positionKm.x, y: storm.positionKm.y, hourUtc: world.stormEngine?.validHourUtc ?? world.validHourUtc };
  const tornado = clamp(Math.max(storm.tornado?.probability ?? 0, storm.hazards?.tornadoProbability ?? 0), 0, 1);
  const hail = clamp(storm.hazards?.hailProbability ?? 0, 0, 1);
  const wind = clamp(storm.hazards?.windProbability ?? 0, 0, 1);
  if (tornado > 0.08) ti.swaths.tornado.push({ ...p, widthKm: clamp(1.5 + tornado * 7 + (storm.mesocycloneCycle?.cyclesCompleted ?? 0) * 0.6, 1.5, 12), probability: tornado, cycle: storm.mesocycloneCycle?.cyclesCompleted ?? 0 });
  if (hail > 0.08) ti.swaths.hail.push({ ...p, widthKm: clamp(8 + hail * 24, 8, 36), probability: hail });
  if (wind > 0.08) ti.swaths.wind.push({ ...p, widthKm: clamp(12 + wind * 42 + (['QLCS','MCS'].includes(storm.mode) ? 14 : 0), 12, 70), probability: wind });
  for (const values of Object.values(ti.swaths)) if (values.length > 240) values.splice(0, values.length - 240);
}
