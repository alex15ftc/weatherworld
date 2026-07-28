import { Storm } from './Storm.js?v=2.20.1';
import { findInitiationCandidates } from './InitiationEngine.js?v=2.20.1';
import { diagnoseStormMotion, sampleStormEnvironment } from './environmentSampling.js?v=2.20.1';
import { diagnosePreferredMode, shouldSplitStorm, shouldBecomeQlcs, shouldBecomeMcs, shouldUpscaleIntoLine } from './StormModeEngine.js?v=2.20.1';
import { clamp } from '../scenarios/math.js?v=2.20.1';
import { createStormInternalField, evolveStormInternalField } from './StormInternalField.js?v=2.22.0';
import { initializeTornadoState, updateTornadoState } from './TornadoEngine.js?v=2.22.0';
import { initializeStormStructure, evolveStormStructure } from './StormStructureEngine.js?v=2.24.0';
import { initializeStormCoupling, sampleEffectiveInflowEnvironment, updateCoupledStormMotion, updateStormColdPool, advanceStormOutflows } from './StormEnvironmentCoupling.js?v=2.25.2';
import { diagnoseStormRealizationPhysics } from './StormRealizationPhysics.js?v=2.28.14';

export function initializeStormEngine(world) {
  world.storms = [];
  world.stormEngine = { schemaVersion: 4, cadenceMinutes: 5, validHourUtc: world.validHourUtc, revision: 0, nextId: 1, totalCreated: 0, totalSplits: 0, totalMergers: 0, totalTornadoes: 0, activeTornadoes: 0, lastInitiationHourUtc: null, feedbackApplied: false, archiveRetentionHours: 3, maxArchiveEntries: 120, calibrationVersion: '2.28.14-storm-realization-physics' };
  world.stormArchive = [];
  initializeStormCoupling(world);
}

export function advanceStormEngine(world, dtHours = 1, { initiate = true, applyFeedback = true } = {}) {
  if (!world.stormEngine) initializeStormEngine(world);
  world.stormEngine.validHourUtc = Number(((world.stormEngine.validHourUtc ?? world.validHourUtc) + Math.max(0, dtHours)).toFixed(6));
  const substeps = Math.max(1, Math.ceil(dtHours * 12));
  const substepHours = dtHours / substeps;
  for (let step = 0; step < substeps; step++) {
    const spatialIndex = buildStormSpatialIndex(world.storms);
    updateInteractionSuppression(world, spatialIndex);
    for (const storm of world.storms) updateStorm(world, storm, substepHours);
    handleSplits(world);
    handleMergersAndOrganization(world, buildStormSpatialIndex(world.storms));
  }
  advanceStormOutflows(world, dtHours);
  archiveEndedStorms(world);
  world.storms = world.storms.filter(storm => storm.active);
  if (initiate) initiateStorms(world);
  if (applyFeedback) applyStormFeedback(world, dtHours);
  world.stormEngine.activeTornadoes = world.storms.filter(storm => storm.tornado?.onGround).length;
  world.stormEngine.revision = (world.stormEngine.revision ?? 0) + 1;
}

function createStorm(world, candidate, environment, modeHint = null, parentId = null, offset = {x:0,y:0}) {
  const preferred = modeHint ?? diagnosePreferredMode(environment, world.setupForecast?.key, world.evolution?.config?.patternLifecycle, world.evolution?.elapsedHours ?? 0).mode;
  const motion = diagnoseStormMotion(environment, preferred);
  const storm = new Storm({
    id: `S${String(world.stormEngine.nextId++).padStart(4, '0')}`,
    xKm: candidate.xKm + offset.x, yKm: candidate.yKm + offset.y,
    velocityEastKph: motion.east, velocityNorthKph: motion.north,
    sourceCell: candidate, createdHourUtc: world.validHourUtc, modeHint: preferred, parentId
  });
  storm.environment = environment;
  initializeTornadoState(storm);
  createStormInternalField(storm, environment, `${world.evolution?.config?.seed ?? 1}|${storm.id}`);
  initializeStormStructure(storm, environment, `${world.evolution?.config?.seed ?? 1}|${storm.id}`);
  initializeStormDiagnostics(storm, environment);
  world.storms.push(storm); world.stormEngine.totalCreated += 1;
  return storm;
}


function initializeStormDiagnostics(storm, environment) {
  const buoyancy = clamp((environment.cape ?? 0) / 3200, 0, 1.25);
  const shearSupport = clamp(((environment.bulkShear ?? 0) - 16) / 44, 0, 1);
  const readiness = clamp(environment.readiness ?? 0, 0, 1);
  const forcing = clamp(environment.forcing ?? 0, 0, 1);
  const initiation = clamp(environment.initiation ?? 0, 0, 1);
  const capPenalty = clamp((environment.cin ?? 0) / 180, 0, 1);
  const supercell = storm.mode.includes('supercell');
  const linear = ['linear segment', 'QLCS', 'MCS'].includes(storm.mode);
  const modeSupport = supercell ? shearSupport * 0.11 : linear ? forcing * 0.08 : 0;

  storm.intensity = clamp(0.08 + readiness * 0.20 + buoyancy * 0.08 + initiation * 0.05 + modeSupport - capPenalty * 0.04, 0.08, 0.38);
  storm.organization = clamp(0.08 + shearSupport * 0.25 + forcing * 0.08 + (storm.modeConfidence ?? 0) * 0.10, 0.08, 0.42);
  storm.updraftStrength = clamp(storm.intensity * (0.68 + buoyancy * 0.30), 0.08, 0.48);
  storm.coldPoolStrength = clamp(storm.intensity * (linear ? 0.24 : 0.10), 0, 0.18);
  storm.coldPoolRadiusKm = clamp(4 + storm.coldPoolStrength * 18, 4, 9);
  diagnoseObservedStorm(storm, environment);
  storm.maxIntensity = storm.intensity;
  storm.peakRotationStrength = storm.rotationStrength ?? 0;
  storm.peakUpdraftStrength = storm.updraftStrength;
}

function initiateStorms(world) {
  const stormHour = world.stormEngine?.validHourUtc ?? world.validHourUtc;
  const initiationSlot = Math.floor(stormHour * 2) / 2;
  if (world.stormEngine.lastInitiationHourUtc === initiationSlot) return;
  world.stormEngine.lastInitiationHourUtc = initiationSlot;
  for (const candidate of findInitiationCandidates(world, world.storms, initiationSlot)) {
    const environment = sampleStormEnvironment(world, candidate.xKm, candidate.yKm);
    const jitter = deterministicJitter(world.evolution?.config?.seed ?? 'seed', initiationSlot, candidate.x, candidate.y);
    createStorm(world, candidate, environment, null, null, jitter);
  }
}

function updateStorm(world, storm, dtHours) {
  if (!storm.active) return;
  storm.previousPositionKm = { ...storm.positionKm };
  const environment = sampleEffectiveInflowEnvironment(world, storm);
  const preferred = diagnosePreferredMode(environment, world.setupForecast?.key, world.evolution?.config?.patternLifecycle, world.evolution?.elapsedHours ?? 0);
  const discreteProtection = (environment.prefrontalSupercellSupport ?? 0) >= 0.44 || (environment.tornadicEnvironmentSupport ?? 0) >= 0.55;
  const protectedSupercell = storm.mode.includes('supercell') && discreteProtection && storm.ageHours < 5.5;
  if (!storm.mode.includes('left-moving') && storm.lifecycleState !== 'tower' && !protectedSupercell && preferred.confidence > storm.modeConfidence + 0.10 && storm.modeAgeHours > 0.55) {
    storm.mode = preferred.mode; storm.modeConfidence = preferred.confidence; storm.modeAgeHours = 0;
  }
  updateCoupledStormMotion(world, storm, environment, dtHours);
  const dx = storm.velocityKph.east * dtHours, dy = -storm.velocityKph.north * dtHours;
  storm.positionKm.x += dx; storm.positionKm.y += dy; storm.trackKm += Math.hypot(dx,dy);
  storm.trackPoints ??= [{ ...storm.previousPositionKm, hourUtc: (world.stormEngine?.validHourUtc ?? world.validHourUtc) - dtHours }];
  const lastTrackPoint = storm.trackPoints.at(-1);
  if (!lastTrackPoint || Math.hypot(storm.positionKm.x-lastTrackPoint.x, storm.positionKm.y-lastTrackPoint.y) >= 2.5) {
    storm.trackPoints.push({ x: storm.positionKm.x, y: storm.positionKm.y, hourUtc: world.stormEngine?.validHourUtc ?? world.validHourUtc });
    if (storm.trackPoints.length > 240) storm.trackPoints.splice(0, storm.trackPoints.length-240);
  }
  storm.ageHours += dtHours; storm.modeAgeHours += dtHours; storm.environment = environment;

  const physics = diagnoseStormRealizationPhysics(environment, storm);
  storm.physics = physics;
  const buoyancy = clamp(physics.realizedUpdraft, 0, 1.25);
  const capPenalty = clamp(1 - physics.inhibitionEfficiency, 0, 1);
  const shearSupport = clamp((environment.bulkShear - 16) / 44, 0, 1);
  const processedWeight = storm.mode.includes('supercell') && discreteProtection ? 0.30 : 0.55;
  const interactionWeight = storm.mode.includes('supercell') && discreteProtection ? 0.22 : 0.50;
  const processedPenalty = clamp(environment.processedAir * processedWeight + storm.interactionSuppression * interactionWeight, 0, 0.8);
  storm.inflowQuality = clamp(1 - processedPenalty, 0.15, 1);
  storm.interactions ??= { mergerBoost: 0, inflowCompetition: 0, outflowBoundaryBoost: 0, lastType: null };
  storm.interactions.inflowCompetition = clamp(storm.interactionSuppression ?? 0, 0, 1);
  storm.interactions.mergerBoost *= Math.max(0, 1 - dtHours * 0.7);
  const boundaryStrength = clamp(storm.boundaryInteraction?.strength ?? 0, 0, 1);
  storm.interactions.outflowBoundaryBoost += (boundaryStrength - storm.interactions.outflowBoundaryBoost) * clamp(dtHours * 1.1, 0, 1);
  let modeBoost = storm.mode.includes('supercell') ? 0.10 * shearSupport + 0.12 * (environment.prefrontalSupercellSupport ?? 0) : storm.mode === 'MCS' ? 0.08 * environment.forcing : 0;
  const targetIntensity = clamp((environment.readiness * 0.30 + buoyancy * 0.42 + physics.initiationProbability * 0.18 + modeBoost - capPenalty * 0.20) * storm.inflowQuality, 0, 1);
  const response = targetIntensity > storm.intensity ? 0.52 : 0.23;
  storm.intensity += (targetIntensity - storm.intensity) * clamp(response * dtHours * 2, 0, 1);
  const targetOrganization = clamp(physics.organizationProbability * 0.58 + shearSupport * 0.16 + physics.balanceSupport * 0.10 + preferred.confidence * 0.08 + (environment.prefrontalSupercellSupport ?? 0) * 0.08, 0, 1);
  storm.organization += (targetOrganization - storm.organization) * clamp(0.34 * dtHours, 0, 1);
  storm.updraftStrength = clamp(physics.realizedUpdraft * (0.55 + storm.intensity * 0.45), 0, 1);
  storm.rotationTendency = physics.verticalVorticityTendency;
  storm.updraftHelicity = { lowLevel: physics.lowlevelUH, midlevel: physics.midlevelUH };
  const supercellColdPoolReduction = storm.mode.includes('supercell') ? 0.22 * (environment.prefrontalSupercellSupport ?? 0) : 0;
  const lifecycle = world.evolution?.config?.patternLifecycle ?? {};
  const coldPoolMultiplier = Number(lifecycle.coldPoolMultiplier) || 1;
  const coldPoolTarget = clamp(storm.intensity * (0.31 + environment.linearFraction * 0.34 + clamp((environment.lcl - 900)/1500,0,1)*0.24 - supercellColdPoolReduction) * coldPoolMultiplier, 0, 1);
  storm.coldPoolStrength += (coldPoolTarget - storm.coldPoolStrength) * clamp(0.22 * dtHours, 0, 1);
  storm.coldPoolRadiusKm = clamp(5 + storm.ageHours * 5 + storm.coldPoolStrength * 24, 5, 52);
  updateStormColdPool(world, storm, environment, dtHours);
  updateLifecycleEvolution(storm, environment, targetIntensity, dtHours);
  updateStormConfidence(storm, environment, dtHours);
  updateMesocyclone(storm, environment, dtHours);
  evolveStormInternalField(storm, environment, dtHours);
  evolveStormStructure(storm, environment, dtHours, `${world.evolution?.config?.seed ?? 1}|${storm.id}`);
  diagnoseObservedStorm(storm, environment);
  const wasOnGround = Boolean(storm.tornado?.onGround);
  updateTornadoState(world, storm, environment, dtHours);
  if (!wasOnGround && storm.tornado?.onGround) world.stormEngine.totalTornadoes = (world.stormEngine.totalTornadoes ?? 0) + 1;
  storm.hazards.tornadoProbability = Math.max(storm.hazards.tornadoProbability, storm.tornado?.probability ?? 0);
  if (storm.tornado?.onGround && !storm.eventTags.includes('tornado on ground')) storm.eventTags.push('tornado on ground');
  storm.maxIntensity = Math.max(storm.maxIntensity, storm.intensity);
  storm.peakRotationStrength = Math.max(storm.peakRotationStrength ?? 0, storm.rotationStrength ?? 0);
  storm.peakUpdraftStrength = Math.max(storm.peakUpdraftStrength ?? 0, storm.updraftStrength ?? 0);
    storm.peakColdPoolStrength = Math.max(storm.peakColdPoolStrength ?? 0, storm.coldPoolStrength ?? 0);

  const outside = storm.positionKm.x < -30 || storm.positionKm.y < -30 || storm.positionKm.x > world.domainWidthKm + 30 || storm.positionKm.y > world.domainHeightKm + 30;
  if (outside) { storm.active = false; storm.dissipationReason = 'left-domain'; }
  else if (storm.ageHours > 1.7 && storm.intensity < 0.07) { storm.active = false; storm.dissipationReason = 'environmental-decay'; }
  else if (storm.ageHours > maxAgeForMode(storm.mode)) { storm.active = false; storm.dissipationReason = 'maximum-lifecycle'; }
}

function handleSplits(world) {
  for (const storm of [...world.storms]) {
    if (!storm.active || !shouldSplitStorm(storm, storm.environment)) continue;
    storm.hasSplit = true;
    const shear = { x: storm.environment.wind500.eastKt - storm.environment.surfaceWind.eastKt, y: -(storm.environment.wind500.northKt - storm.environment.surfaceWind.northKt) };
    const mag = Math.hypot(shear.x, shear.y) || 1;
    const offset = { x: -shear.y / mag * 6, y: shear.x / mag * 6 };
    const candidate = { x: storm.sourceCell.x, y: storm.sourceCell.y, xKm: storm.positionKm.x, yKm: storm.positionKm.y };
    const child = createStorm(world, candidate, storm.environment, 'left-moving supercell', storm.id, offset);
    child.ageHours = 0.45; child.intensity = storm.intensity * 0.72; child.organization = storm.organization * 0.85;
    storm.children.push(child.id); storm.mode = 'discrete supercell'; storm.modeConfidence = Math.max(storm.modeConfidence, 0.7);
    world.stormEngine.totalSplits += 1;
  }
}

function handleMergersAndOrganization(world, spatialIndex) {
  const active = spatialIndex.active;
  for (const storm of active) {
    const neighbors = nearbyStorms(spatialIndex, storm, 90).filter(other => other !== storm && distance(storm, other) < interactionRadius(storm, other));
    if (shouldBecomeMcs(storm, neighbors.length, storm.environment)) storm.mode = 'MCS';
    else if (shouldBecomeQlcs(storm, neighbors.length, storm.environment)) storm.mode = 'QLCS';
    else if (shouldUpscaleIntoLine(storm, neighbors.length, storm.environment)) {
      storm.mode = 'linear segment';
      storm.modeConfidence = Math.max(storm.modeConfidence, 0.62);
      storm.modeAgeHours = 0;
    }
  }
  const checked = new Set();
  for (const a of active) for (const b of nearbyStorms(spatialIndex, a, 65)) {
    if (a === b || !a.active || !b.active) continue;
    const pairKey = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
    if (checked.has(pairKey)) continue;
    checked.add(pairKey);
    const d=distance(a,b);
    if (d > Math.max(7, (a.coldPoolRadiusKm+b.coldPoolRadiusKm)*0.20)) continue;
    if (a.mode.includes('supercell') && b.mode.includes('supercell') && d > 8) continue;
    const keeper = a.intensity >= b.intensity ? a : b, absorbed = keeper===a?b:a;
    const total = Math.max(0.1, keeper.intensity + absorbed.intensity);
    keeper.positionKm.x = (keeper.positionKm.x*keeper.intensity + absorbed.positionKm.x*absorbed.intensity)/total;
    keeper.positionKm.y = (keeper.positionKm.y*keeper.intensity + absorbed.positionKm.y*absorbed.intensity)/total;
    keeper.intensity = clamp(Math.max(keeper.intensity, absorbed.intensity) + Math.min(keeper.intensity, absorbed.intensity)*0.22,0,1);
    keeper.coldPoolStrength = Math.max(keeper.coldPoolStrength, absorbed.coldPoolStrength);
    keeper.organization = clamp((keeper.organization+absorbed.organization)*0.55,0,1);
    keeper.mergeCount += 1 + absorbed.mergeCount;
    keeper.mergedStormIds ??= []; keeper.mergedStormIds.push(absorbed.id, ...(absorbed.mergedStormIds ?? [])); keeper.mergedStormIds = [...new Set(keeper.mergedStormIds)].slice(-20);
    keeper.lastInteractionHourUtc = world.stormEngine?.validHourUtc ?? world.validHourUtc;
    keeper.interactions ??= { mergerBoost: 0, inflowCompetition: 0, outflowBoundaryBoost: 0, lastType: null };
    keeper.interactions.mergerBoost = clamp((keeper.interactions.mergerBoost ?? 0) + 0.34, 0, 1);
    keeper.interactions.lastType = 'merger';
    absorbed.active=false; absorbed.dissipationReason=`merged-into-${keeper.id}`; world.stormEngine.totalMergers += 1;
  }
}

function updateInteractionSuppression(world, spatialIndex) {
  for (const storm of spatialIndex.active) {
    let suppression=0;
    const protectedDiscrete = storm.mode.includes('supercell') && ((storm.environment?.prefrontalSupercellSupport ?? 0) >= 0.44 || (storm.environment?.tornadicEnvironmentSupport ?? 0) >= 0.55);
    const radius = protectedDiscrete ? 32 : 45;
    const weight = protectedDiscrete ? 0.09 : 0.18;
    for (const other of nearbyStorms(spatialIndex, storm, radius)) if (other!==storm) {
      const d=distance(storm,other); if (d<radius) suppression += (1-d/radius)*weight;
    }
    storm.interactionSuppression=clamp(suppression,0,protectedDiscrete?0.32:0.7);
  }
}

function buildStormSpatialIndex(storms, bucketKm = 50) {
  const active = storms.filter(storm => storm.active);
  const buckets = new Map();
  for (const storm of active) {
    const key = `${Math.floor(storm.positionKm.x / bucketKm)},${Math.floor(storm.positionKm.y / bucketKm)}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(storm); else buckets.set(key, [storm]);
  }
  return { active, buckets, bucketKm };
}

function nearbyStorms(index, storm, radiusKm) {
  const result = [];
  const span = Math.ceil(radiusKm / index.bucketKm);
  const bx = Math.floor(storm.positionKm.x / index.bucketKm);
  const by = Math.floor(storm.positionKm.y / index.bucketKm);
  for (let dy=-span; dy<=span; dy++) for (let dx=-span; dx<=span; dx++) {
    const bucket = index.buckets.get(`${bx+dx},${by+dy}`);
    if (bucket) result.push(...bucket);
  }
  return result;
}

export function applyStormFeedback(world, dtHours) {
  const size = world.width * world.height;
  const temp = new Float32Array(size), dew = new Float32Array(size), stabilization = new Float32Array(size), convergence = new Float32Array(size);
  for (const storm of world.storms) {
    if (!storm.active || storm.intensity < 0.14) continue;
    const radiusKm = Number.isFinite(storm.coldPoolRadiusKm) ? storm.coldPoolRadiusKm : clamp(8 + storm.intensity * 24 + (storm.coldPoolStrength ?? 0) * 18, 8, 52);
    const radiusCells = Math.max(1, Math.ceil(radiusKm / world.cellSizeKm));
    const cx = storm.positionKm.x / world.cellSizeKm - 0.5, cy = storm.positionKm.y / world.cellSizeKm - 0.5;
    for (let y=Math.max(0,Math.floor(cy-radiusCells)); y<=Math.min(world.height-1,Math.ceil(cy+radiusCells)); y++) for (let x=Math.max(0,Math.floor(cx-radiusCells)); x<=Math.min(world.width-1,Math.ceil(cx+radiusCells)); x++) {
      const dx=(x+0.5)*world.cellSizeKm-storm.positionKm.x, dy=(y+0.5)*world.cellSizeKm-storm.positionKm.y, dist=Math.hypot(dx,dy);
      if (dist>radiusKm) continue;
      const weight=Math.exp(-Math.pow(dist/Math.max(1,radiusKm*0.62),2)), index=y*world.width+x;
      const processed=weight*storm.intensity*dtHours;
      temp[index]-=processed*(0.38+storm.coldPoolStrength*1.0); dew[index]-=processed*(0.08+storm.coldPoolStrength*0.18);
      stabilization[index]=Math.max(stabilization[index],processed*0.34);
      const ring=Math.exp(-Math.pow((dist-radiusKm*0.78)/Math.max(2,radiusKm*0.14),2));
      convergence[index]=Math.max(convergence[index],ring*storm.coldPoolStrength*storm.intensity);
    }
  }
  for (const outflow of world.stormOutflows ?? []) {
    if (!outflow.active || outflow.strength < 0.08) continue;
    const radiusCells = Math.max(1, Math.ceil((outflow.radiusKm + 18) / world.cellSizeKm));
    const cx = outflow.centerKm.x / world.cellSizeKm - 0.5, cy = outflow.centerKm.y / world.cellSizeKm - 0.5;
    for (let y=Math.max(0,Math.floor(cy-radiusCells)); y<=Math.min(world.height-1,Math.ceil(cy+radiusCells)); y++) for (let x=Math.max(0,Math.floor(cx-radiusCells)); x<=Math.min(world.width-1,Math.ceil(cx+radiusCells)); x++) {
      const dx=(x+0.5)*world.cellSizeKm-outflow.centerKm.x, dy=(y+0.5)*world.cellSizeKm-outflow.centerKm.y, dist=Math.hypot(dx,dy), edge=Math.abs(dist-outflow.radiusKm);
      if (edge>20) continue;
      const ring=Math.exp(-Math.pow(edge/9,2))*outflow.strength, index=y*world.width+x;
      convergence[index]=Math.max(convergence[index],ring);
      stabilization[index]=Math.max(stabilization[index],Math.max(0,1-dist/Math.max(1,outflow.radiusKm))*outflow.strength*0.22);
    }
  }
  let applied=false;
  world.forEachCell((cell,x,y)=>{ const i=y*world.width+x;
    if (!temp[i]&&!dew[i]&&!stabilization[i]&&!convergence[i]) { cell.features.stormProcessedAir=0; cell.features.stormOutflowConvergence=0; return; }
    applied=true; cell.surface.temperature+=temp[i]; cell.surface.dewpoint+=dew[i];
    cell.features.stormProcessedAir=clamp(stabilization[i],0,1); cell.features.stormOutflowConvergence=clamp(convergence[i],0,1);
  });
  world.stormEngine.feedbackApplied=applied;
}



function updateStormConfidence(storm, environment, dtHours) {
  storm.confidence ??= { initiation: 0.18, organization: 0.08, persistence: 0.05, hazard: 0.04, tornado: 0, hail: 0, wind: 0 };
  const c = storm.confidence;
  const mature = storm.lifecycleState === 'mature' ? 1 : storm.lifecycleState === 'organizing' ? 0.72 : storm.lifecycleState === 'developing' ? 0.34 : 0.12;
  const supercell = storm.mode?.includes('supercell');
  const linear = ['linear segment', 'QLCS', 'MCS'].includes(storm.mode);
  const inflow = clamp(storm.inflowQuality ?? 0, 0, 1);
  const structural = clamp((storm.organization ?? 0) * 0.34 + (storm.intensity ?? 0) * 0.28 + (storm.updraftStrength ?? 0) * 0.22 + inflow * 0.16, 0, 1);
  const ageSupport = clamp((storm.ageHours ?? 0) / 1.5, 0, 1);
  const weakening = ['weakening', 'dissipating'].includes(storm.lifecycleState) ? 0.42 : 1;
  const targetOrganization = clamp(structural * mature, 0, 1);
  const targetPersistence = clamp((ageSupport * 0.30 + structural * 0.42 + inflow * 0.28) * weakening, 0, 1);
  const targetHazard = clamp((targetOrganization * 0.52 + targetPersistence * 0.30 + mature * 0.18) * weakening, 0, 1);
  const lowLcl = clamp((1700 - (environment.lcl ?? 1900)) / 1050, 0, 1);
  const rotation = clamp(Math.max(storm.rotationStrength ?? 0, storm.mesocycloneStrength ?? 0), 0, 1);
  const hailCore = clamp(Math.max(storm.internalField?.maxHail ?? 0, storm.updraftStrength ?? 0), 0, 1);
  const windCore = clamp((storm.coldPoolStrength ?? 0) * 0.55 + (storm.intensity ?? 0) * 0.25 + (linear ? 0.20 : 0), 0, 1);
  const targets = {
    organization: targetOrganization,
    persistence: targetPersistence,
    hazard: targetHazard,
    tornado: clamp(targetHazard * (supercell ? 0.48 : 0.20) + rotation * 0.38 + lowLcl * 0.14, 0, 1),
    hail: clamp(targetHazard * 0.52 + hailCore * 0.48, 0, 1),
    wind: clamp(targetHazard * 0.44 + windCore * 0.56, 0, 1)
  };
  c.initiation = Math.max(c.initiation ?? 0, clamp((environment.initiation ?? 0) * 0.55 + ageSupport * 0.45, 0, 1));
  for (const [key, target] of Object.entries(targets)) {
    const current = Number(c[key]) || 0;
    const rate = target > current ? 1.35 : 0.48;
    c[key] = clamp(current + (target - current) * clamp(dtHours * rate, 0, 1), 0, 1);
  }
}

function updateMesocyclone(storm, environment, dtHours) {
  const supercell = storm.mode?.includes('supercell');
  const qlcs = storm.mode === 'QLCS' || storm.mode === 'linear segment';
  const srh = clamp(((environment.srh ?? 0) - 60) / 300, 0, 1.2);
  const shear = clamp(((environment.bulkShear ?? 0) - 20) / 42, 0, 1.15);
  const lowLcl = clamp((1750 - (environment.lcl ?? 1800)) / 1100, 0, 1);
  const inflow = clamp(environment.mesoscale?.effectiveInflow ?? environment.readiness ?? 0, 0, 1);
  const warmSector = clamp(environment.openWarmSectorSupport ?? environment.warmSector ?? 0, 0, 1);
  const prefrontal = clamp(environment.prefrontalSupercellSupport ?? 0, 0, 1);
  const tornadic = clamp(environment.tornadicEnvironmentSupport ?? 0, 0, 1.15);
  const synoptic = clamp((environment.synopticAscent ?? 0) * 0.55 + (environment.synopticCoherence ?? 1) * 0.25 + (environment.moisturePooling ?? environment.mesoscale?.moisturePooling ?? 0) * 0.20, 0, 1);
  const modeFactor = supercell ? 1 : qlcs ? 0.56 : 0.20;
  const structure = clamp(storm.organization * 0.34 + storm.updraftStrength * 0.30 + storm.intensity * 0.20 + storm.inflowQuality * 0.16, 0, 1.15);
  const target = clamp(modeFactor * structure * (0.08 + 0.20 * srh + 0.14 * shear + 0.13 * lowLcl + 0.12 * inflow + 0.08 * warmSector + 0.08 * prefrontal + 0.06 * tornadic + 0.11 * synoptic), 0, 1.25);
  storm.mesocycloneStrength ??= 0;
  const response = target > storm.mesocycloneStrength ? (supercell ? 1.9 : 1.1) : 0.42;
  storm.mesocycloneStrength += (target - storm.mesocycloneStrength) * clamp(dtHours * response, 0, 1);
  if (storm.lifecycleState === 'weakening' || storm.lifecycleState === 'dissipating') storm.mesocycloneStrength *= Math.max(0, 1 - dtHours * 0.65);
}

function diagnoseObservedStorm(storm, environment) {
  const supercell = storm.mode.includes('supercell');
  const linear = ['linear segment','QLCS','MCS'].includes(storm.mode);
  const field = storm.internalField;
  storm.rotationStrength = clamp(Math.max((field?.maxVorticity ?? 0) * .8, (storm.mesocycloneStrength ?? 0) * .92), 0, 1);
  storm.orientationDeg = Math.atan2(storm.velocityKph.east, -storm.velocityKph.north) * 180 / Math.PI;
  const motionSpeedKph = Math.hypot(storm.velocityKph.east, storm.velocityKph.north);
  storm.motion = { speedKph: motionSpeedKph, speedMph: motionSpeedKph * 0.621371, directionDeg: (Math.atan2(storm.velocityKph.east, storm.velocityKph.north) * 180 / Math.PI + 360) % 360 };
  const tornadoProbability = clamp(Math.max((field?.maxDebris ?? 0) * .9, storm.rotationStrength * storm.intensity * clamp((1400-environment.lcl)/900,0,1) * (supercell ? 1 : .58)), 0, .95);
  const hailEnvironment = clamp(storm.updraftStrength * .42 + clamp((environment.cape ?? 0) / 3500, 0, 1.15) * .24 + clamp((environment.bulkShear ?? 0) / 55, 0, 1.1) * .20 + (supercell ? .14 : .04), 0, 1);
  const hailProbability = clamp(Math.max((field?.maxHail ?? 0) * .82, hailEnvironment * (supercell ? .62 : .38)), 0, .95);
  const linearForcing = clamp(Number(environment.forcing) || 0, 0, 1);
  const windProbability = clamp(storm.coldPoolStrength * storm.intensity * (linear ? 1.34 : .72) * clamp(environment.bulkShear/32,0,1) + (linear ? linearForcing * .10 : 0), 0, .98);
  const sustainedMph = clamp(22 + storm.intensity * (linear ? 43 : 38) + storm.coldPoolStrength * (linear ? 54 : 24) + (linear ? linearForcing * 8 : 0), 15, 110);
  const gustMph = clamp(sustainedMph + (linear ? 10 : 8) + windProbability * (linear ? 48 : 42) + (field?.maxVorticity ?? 0) * 8, 20, 150);
  const maxSustainedMph = Math.max(storm.surfaceWind?.maxSustainedMph ?? 0, sustainedMph);
  const maxGustMph = Math.max(storm.surfaceWind?.maxGustMph ?? 0, gustMph);
  storm.surfaceWind = { sustainedMph, gustMph, maxSustainedMph, maxGustMph };

  // Store physically diagnosed storm-scale extremes for inspection and verification.
  // Hail size is an outcome diagnostic, not a forecast probability multiplier.
  const lapseRate = Number(environment.lapseRate700500 ?? environment.midLevelLapseRate ?? 6.5);
  const hailGrowth = clamp((field?.maxHail ?? 0) * 0.44 + storm.updraftStrength * 0.30 + clamp((environment.cape ?? 0) / 4000, 0, 1.2) * 0.16 + clamp((lapseRate - 5.8) / 2.4, 0, 1) * 0.10, 0, 1.2);
  const hailSizeInches = hailProbability < 0.12 ? 0 : clamp(0.35 + hailGrowth * 3.65, 0.35, 4.5);
  storm.hazardExtremes ??= { tornado:{maxWindMph:0,maxEfRating:null,maxWidthYards:0,maxPathLengthKm:0,cycles:0}, wind:{maxSustainedMph:0,maxGustMph:0}, hail:{maxSizeInches:0} };
  storm.hazardExtremes.wind.maxSustainedMph = Math.max(storm.hazardExtremes.wind.maxSustainedMph ?? 0, sustainedMph);
  storm.hazardExtremes.wind.maxGustMph = Math.max(storm.hazardExtremes.wind.maxGustMph ?? 0, gustMph);
  storm.hazardExtremes.hail.maxSizeInches = Math.max(storm.hazardExtremes.hail.maxSizeInches ?? 0, hailSizeInches);
  const confidence = storm.confidence ?? {};
  const phase = storm.lifecycle?.phase ?? storm.lifecycleState;
  const phaseFactors = { tower: 0.35, developing: 0.62, organizing: 0.86, mature: 1, cyclic: 1.08, weakening: 0.58, dissipating: 0.22 };
  const phaseFactor = phaseFactors[phase] ?? 0.75;
  storm.hazardMemory ??= { tornado: 0, hail: 0, wind: 0, decayHours: 1.25 };
  const rawTornado = Math.max(tornadoProbability, storm.tornado?.probability ?? 0) * (0.55 + (confidence.tornado ?? confidence.hazard ?? 0) * 0.65) * phaseFactor;
  const rawHail = hailProbability * (0.58 + (confidence.hail ?? confidence.hazard ?? 0) * 0.68) * (phase === 'developing' ? 1.08 : phaseFactor);
  const rawWind = windProbability * (0.62 + (confidence.wind ?? confidence.hazard ?? 0) * 0.72) * (phase === 'weakening' ? 1.12 : phaseFactor);
  storm.hazardMemory.tornado = Math.max(rawTornado, storm.hazardMemory.tornado * 0.88);
  storm.hazardMemory.hail = Math.max(rawHail, storm.hazardMemory.hail * 0.84);
  storm.hazardMemory.wind = Math.max(rawWind, storm.hazardMemory.wind * 0.90);
  const realizedTornado = clamp(storm.hazardMemory.tornado, 0, .98);
  const realizedHail = clamp(storm.hazardMemory.hail, 0, .98);
  const realizedWind = clamp(storm.hazardMemory.wind, 0, .99);
  storm.hazards = { tornadoProbability: realizedTornado, hailProbability: realizedHail, windProbability: realizedWind };
  storm.radar = {
    maxReflectivityDbz: clamp(28 + storm.intensity * 42 + hailProbability * 9, 20, 78),
    radiusXKm: clamp(8 + storm.intensity * (linear ? 38 : 22) + storm.mergeCount * 3, 8, 85),
    radiusYKm: clamp(7 + storm.intensity * (linear ? 16 : 14), 7, 42)
  };
  const tags = [];
  if (supercell && storm.organization > .5) tags.push('supercell');
  if (storm.mode === 'elevated convection' && hailProbability > .3) tags.push('elevated hailstorm');
  if (storm.mode === 'MCS') tags.push('MCS');
  if (storm.mode === 'QLCS') tags.push('QLCS');
  if (tornadoProbability > .42 && storm.lifecycleState === 'mature') tags.push('tornado');
  const derechoDistance = storm.trackKm >= 400 && linear && windProbability > .62 && storm.ageHours >= 6;
  if (derechoDistance) tags.push('derecho');
  storm.eventTags = tags;
}

function updateLifecycleEvolution(storm, environment, target, dtHours) {
  storm.lifecycle ??= { phase: 'tower', previousPhase: null, phaseAgeHours: 0, cycleNumber: 0, cyclePhase: 0, transitionCount: 0, peakPhase: 'tower' };
  storm.mesocycloneCycle ??= { phase: 0, strengthening: false, occlusion: 0, cyclesCompleted: 0 };
  const lc = storm.lifecycle;
  const supercell = storm.mode?.includes('supercell');
  const boundaryBoost = clamp(storm.interactions?.outflowBoundaryBoost ?? 0, 0, 1);
  const mergerBoost = clamp(storm.interactions?.mergerBoost ?? 0, 0, 1);
  let next = 'dissipating';
  if (storm.ageHours < 0.30) next = 'tower';
  else if (storm.ageHours < 0.85 && storm.intensity < 0.50) next = 'developing';
  else if (storm.organization > 0.56 && (target >= 0.26 || storm.intensity >= 0.34)) next = 'organizing';
  else if (supercell && storm.ageHours > 1.4 && storm.organization > 0.58 && storm.inflowQuality > 0.42 && storm.intensity > 0.31) next = 'cyclic';
  else if (storm.intensity >= 0.28 && (target >= 0.20 || storm.organization >= 0.42)) next = 'mature';
  else if (supercell && storm.intensity >= 0.22 && storm.organization >= 0.42 && storm.inflowQuality >= 0.38) next = 'mature';
  else if (storm.intensity >= 0.11) next = 'weakening';

  if (next !== lc.phase) {
    lc.previousPhase = lc.phase; lc.phase = next; lc.phaseAgeHours = 0; lc.transitionCount += 1;
    const rank = { tower:0, developing:1, organizing:2, mature:3, cyclic:4, weakening:2, dissipating:0 };
    if ((rank[next] ?? 0) > (rank[lc.peakPhase] ?? 0)) lc.peakPhase = next;
  } else lc.phaseAgeHours += dtHours;
  storm.lifecycleState = next;

  if (next === 'cyclic') {
    const periodHours = clamp(1.15 + (1 - storm.inflowQuality) * 0.9, 0.9, 2.2);
    const oldPhase = lc.cyclePhase;
    lc.cyclePhase = (lc.cyclePhase + dtHours / periodHours) % 1;
    if (lc.cyclePhase < oldPhase) { lc.cycleNumber += 1; storm.mesocycloneCycle.cyclesCompleted += 1; }
    const wave = (Math.sin(lc.cyclePhase * Math.PI * 2 - Math.PI / 2) + 1) / 2;
    storm.mesocycloneCycle.phase = lc.cyclePhase;
    storm.mesocycloneCycle.strengthening = wave > 0.55;
    storm.mesocycloneCycle.occlusion = clamp((1 - wave) * 0.72 + mergerBoost * 0.18, 0, 1);
    storm.mesocycloneStrength = clamp((storm.mesocycloneStrength ?? 0) * (0.90 + wave * 0.22) + boundaryBoost * 0.035, 0, 1.25);
  } else {
    lc.cyclePhase = 0;
    storm.mesocycloneCycle.phase = 0;
    storm.mesocycloneCycle.strengthening = false;
    storm.mesocycloneCycle.occlusion *= Math.max(0, 1 - dtHours * 0.8);
  }
}
function maxAgeForMode(mode){ return mode==='pulse storm'?4.5:mode==='multicell'?7:mode.includes('supercell')?10:mode==='MCS'||mode==='QLCS'?14:9; }
function interactionRadius(a,b){ return Math.max(20,(a.coldPoolRadiusKm+b.coldPoolRadiusKm)*0.65); }
function distance(a,b){ return Math.hypot(a.positionKm.x-b.positionKm.x,a.positionKm.y-b.positionKm.y); }

function archiveEndedStorms(world) {
  world.stormArchive ??= [];
  const now = world.stormEngine?.validHourUtc ?? world.validHourUtc ?? 0;
  for (const storm of world.storms ?? []) {
    if (storm.active || storm.archived) continue;
    storm.archived = true;
    world.stormArchive.push({
      id: storm.id, parentId: storm.parentId ?? null, children: [...(storm.children ?? [])],
      mergedStormIds: [...(storm.mergedStormIds ?? [])], mode: storm.mode,
      createdHourUtc: storm.createdHourUtc, endedHourUtc: now, ageHours: storm.ageHours,
      trackKm: storm.trackKm, maxIntensity: storm.maxIntensity,
      peakRotationStrength: storm.peakRotationStrength ?? 0,
      peakUpdraftStrength: storm.peakUpdraftStrength ?? 0,
      surfaceWind: structuredClone(storm.surfaceWind ?? { sustainedMph:0, gustMph:0, maxSustainedMph:0, maxGustMph:0 }),
      hazardExtremes: structuredClone(storm.hazardExtremes ?? {
        tornado:{ maxWindMph:0, maxEfRating:null, maxWidthYards:0, maxPathLengthKm:0, cycles:0 },
        wind:{ maxSustainedMph:storm.surfaceWind?.maxSustainedMph ?? 0, maxGustMph:storm.surfaceWind?.maxGustMph ?? 0 },
        hail:{ maxSizeInches:0 }
      }),
      tornado: structuredClone(storm.tornado ?? {}),
      maxGustMph: Math.max(storm.hazardExtremes?.wind?.maxGustMph ?? 0, storm.surfaceWind?.maxGustMph ?? 0),
      trackPoints: (storm.trackPoints ?? []).slice(-240),
      tornadoHistory: (storm.tornadoHistory ?? []).slice(-8),
      dissipationReason: storm.dissipationReason ?? 'inactive'
    });
  }
  const retention = Math.max(0.5, world.stormEngine?.archiveRetentionHours ?? 3);
  const maxEntries = Math.max(20, world.stormEngine?.maxArchiveEntries ?? 120);
  world.stormArchive = world.stormArchive.filter(item => now - (item.endedHourUtc ?? now) <= retention).slice(-maxEntries);
}

function deterministicJitter(seed,hour,x,y){ const base=`${seed}|${hour}|${x}|${y}`; return {x:(hashUnit(base+'|x')-.5)*7,y:(hashUnit(base+'|y')-.5)*7}; }
function hashUnit(text){ let h=1779033703^text.length; for(let i=0;i<text.length;i++)h=Math.imul(h^text.charCodeAt(i),3432918353); h=h<<13|h>>>19; h=Math.imul(h^h>>>16,2246822507); h=Math.imul(h^h>>>13,3266489909); return ((h^h>>>16)>>>0)/4294967296; }
