import { Storm } from './Storm.js';
import { findInitiationCandidates } from './InitiationEngine.js';
import { diagnoseStormMotion, sampleStormEnvironment } from './environmentSampling.js';
import { describeStormMode, shouldSplitStorm, leftSplitShare, rotatingShare, lineShare, lineOrganizationTarget } from './StormModeEngine.js';
import { BUDGET, setUpdraught, startStormBudgets, stepStormBudgets, stormIsOver } from './StormBudgets.js';
import { stepStormRotation } from './StormRotation.js';
import { hailSizeInches as diagnoseHailSize, gustMph as diagnoseGust, stormFuel, stepRearInflow } from './StormHazards.js';
import { clamp } from '../scenarios/math.js';
import { createStormInternalField, evolveStormInternalField } from './StormInternalField.js';
import { initializeTornadoState, updateTornadoState } from './TornadoEngine.js';
import { initializeStormStructure, evolveStormStructure } from './StormStructureEngine.js';
import { sampleEffectiveInflowEnvironment, updateCoupledStormMotion, updateStormColdPool } from './StormEnvironmentCoupling.js';
import { diagnoseStormRealizationPhysics } from './StormRealizationPhysics.js';

export function initializeStormEngine(world) {
  world.storms = [];
  world.stormEngine = { schemaVersion: 5, cadenceMinutes: 5, validHourUtc: world.validHourUtc, revision: 0, nextId: 1, totalCreated: 0, totalSplits: 0, totalMergers: 0, totalTornadoes: 0, activeTornadoes: 0, lastInitiationHourUtc: null, archiveRetentionHours: 3, maxArchiveEntries: 120, calibrationVersion: '2.66.0-convective-organization', dailyInitiations: {} };
  world.stormArchive = [];
  world.stormHistory = [];
}

export function advanceStormEngine(world, dtHours = 1, { initiate = true, applyFeedback = true } = {}) {
  if (!world.stormEngine) initializeStormEngine(world);
  world.stormEngine.validHourUtc = Number(((world.stormEngine.validHourUtc ?? world.validHourUtc) + Math.max(0, dtHours)).toFixed(6));
  const substepsPerHour = Number(world.runtime?.profile?.stormSubstepsPerHour) || 12;
  const substeps = Math.max(1, Math.ceil(dtHours * substepsPerHour));
  const substepHours = dtHours / substeps;
  for (let step = 0; step < substeps; step++) {
    const spatialIndex = buildStormSpatialIndex(world.storms);
    updateInteractionSuppression(world, spatialIndex);
    for (const storm of world.storms) updateStorm(world, storm, substepHours);
    handleSplits(world);
    handleMergersAndOrganization(world, buildStormSpatialIndex(world.storms));
  }
  archiveEndedStorms(world);
  world.storms = world.storms.filter(storm => storm.active);
  if (initiate) initiateStorms(world);
  if (applyFeedback) applyStormFeedback(world, dtHours);
  world.stormEngine.activeTornadoes = world.storms.filter(storm => storm.tornado?.onGround).length;
  world.stormEngine.revision = (world.stormEngine.revision ?? 0) + 1;
}

function createStorm(world, candidate, environment, modeHint = null, parentId = null, offset = {x:0,y:0}) {
  const initialLine = lineOrganizationTarget({ coldPoolStrength: 0 }, environment) * INITIAL_LINE_SHARE;
  const motion = diagnoseStormMotion(environment, { rotating: 0, linear: initialLine, leftMover: modeHint === 'left-moving supercell' });
  const storm = new Storm({
    id: `S${String(world.stormEngine.nextId++).padStart(4, '0')}`,
    xKm: candidate.xKm + offset.x, yKm: candidate.yKm + offset.y,
    velocityEastKph: motion.east, velocityNorthKph: motion.north,
    sourceCell: candidate, createdHourUtc: world.validHourUtc, modeHint, parentId
  });
  storm.environment = environment;
  storm.lineOrganization = initialLine;
  storm.leftMover = modeHint === 'left-moving supercell';
  storm.elevatedFeed = modeHint === 'elevated convection';
  initializeTornadoState(storm);
  createStormInternalField(storm, environment, `${world.evolution?.config?.seed ?? 1}|${storm.id}`);
  initializeStormStructure(storm, environment, `${world.evolution?.config?.seed ?? 1}|${storm.id}`);
  initializeStormDiagnostics(storm, environment);
  storm.mode = describeStormMode(storm, environment);
  world.storms.push(storm); world.stormEngine.totalCreated += 1;
  return storm;
}


function initializeStormDiagnostics(storm, environment) {
  startStormBudgets(storm);
  storm.coldPoolRadiusKm = 4;
  diagnoseObservedStorm(storm, environment);
  storm.maxIntensity = storm.intensity;
  storm.peakRotationStrength = storm.rotationStrength ?? 0;
  storm.peakUpdraftStrength = storm.updraftStrength;
}

// New storms come from parcel-physics initiation every half hour (see InitiationEngine).
function initiateStorms(world) {
  const stormHour = world.stormEngine?.validHourUtc ?? world.validHourUtc;
  const initiationSlot = Math.floor(stormHour * 2) / 2;
  if (world.stormEngine.lastInitiationHourUtc === initiationSlot) return;
  world.stormEngine.lastInitiationHourUtc = initiationSlot;
  for (const candidate of findInitiationCandidates(world, world.storms, initiationSlot, 0.5)) {
    const environment = sampleStormEnvironment(world, candidate.xKm, candidate.yKm);
    createStorm(world, candidate, environment, candidate.elevated ? 'elevated convection' : null);
  }
}

function updateStorm(world, storm, dtHours) {
  if (!storm.active) return;
  storm.previousPositionKm = { ...storm.positionKm };
  const environment = sampleEffectiveInflowEnvironment(world, storm);
  const rotating = rotatingShare(storm);
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
  // Fuel: an existing updraft can force surface-based parcels through moderate inhibition
  // (~150 J/kg); otherwise it can feed on an elevated parcel that is essentially uncapped.
  // Without either the storm has no buoyant inflow and collapses.
  const { fuelCape, elevatedFeed, feedEnvironment, starving } = stormFuel(environment);
  storm.fuelCape = fuelCape; storm.elevatedFeed = elevatedFeed;

  const physics = diagnoseStormRealizationPhysics(feedEnvironment, storm);
  storm.physics = physics;
  // A rotating updraft draws its inflow from farther out and is less disturbed by worked-over
  // air and by its neighbours.
  const processedWeight = 0.55 - 0.25 * rotating;
  const interactionWeight = 0.50 - 0.28 * rotating;
  const processedPenalty = clamp(environment.processedAir * processedWeight + storm.interactionSuppression * interactionWeight, 0, 0.8);
  storm.inflowQuality = clamp(1 - processedPenalty, 0.15, 1);
  storm.interactions ??= { mergerBoost: 0, inflowCompetition: 0, lastType: null };
  storm.interactions.inflowCompetition = clamp(storm.interactionSuppression ?? 0, 0, 1);
  storm.interactions.mergerBoost *= Math.max(0, 1 - dtHours * 0.7);
  // The storm's budgets: updraught, rain, and the cold pool the rain makes (StormBudgets.js).
  stepStormBudgets(storm, environment, physics, dtHours, { starving });
  stepRearInflow(storm, dtHours);
  // Line organization follows the forcing and the cold pool's balance with the shear.
  storm.lineOrganization = lineShare(storm) + (lineOrganizationTarget(storm, environment) - lineShare(storm)) * clamp(LINE_RESPONSE_PER_HOUR * dtHours, 0, 1);
  storm.coldPoolRadiusKm = clamp(5 + storm.ageHours * 5 + storm.coldPoolStrength * 24, 5, 52);
  updateStormColdPool(world, storm, environment, dtHours);
  updateLifecycleEvolution(storm, environment, dtHours);
  updateStormConfidence(storm, environment, dtHours);
  stepStormRotation(storm, environment, dtHours);
  evolveStormInternalField(storm, environment, dtHours);
  evolveStormStructure(storm, environment, dtHours, `${world.evolution?.config?.seed ?? 1}|${storm.id}`);
  diagnoseObservedStorm(storm, environment);
  storm.mode = describeStormMode(storm, environment);
  const wasOnGround = Boolean(storm.tornado?.onGround);
  updateTornadoState(world, storm, environment, dtHours);
  if (!wasOnGround && storm.tornado?.onGround) world.stormEngine.totalTornadoes = (world.stormEngine.totalTornadoes ?? 0) + 1;
  storm.hazards.tornadoProbability = Math.max(storm.hazards.tornadoProbability, storm.tornado?.probability ?? 0);
  if (storm.tornado?.onGround && !storm.eventTags.includes('tornado on ground')) storm.eventTags.push('tornado on ground');
  storm.maxIntensity = Math.max(storm.maxIntensity, storm.intensity);
  storm.peakRotationStrength = Math.max(storm.peakRotationStrength ?? 0, storm.rotationStrength ?? 0);
  storm.peakUpdraftStrength = Math.max(storm.peakUpdraftStrength ?? 0, storm.updraftStrength ?? 0);

  const outside = storm.positionKm.x < -10 || storm.positionKm.y < -10 || storm.positionKm.x > world.domainWidthKm + 10 || storm.positionKm.y > world.domainHeightKm + 10;
  if (outside) { storm.active = false; storm.dissipationReason = 'left-domain'; }
  else if (stormIsOver(storm)) { storm.active = false; storm.dissipationReason = 'environmental-decay'; }
}

function handleSplits(world) {
  for (const storm of [...world.storms]) {
    if (!storm.active || !shouldSplitStorm(storm, storm.environment)) continue;
    storm.hasSplit = true;
    const leftShare = leftSplitShare(storm.environment);
    if (!leftShare) continue;
    const shear = { x: storm.environment.wind500.eastKt - storm.environment.surfaceWind.eastKt, y: -(storm.environment.wind500.northKt - storm.environment.surfaceWind.northKt) };
    const mag = Math.hypot(shear.x, shear.y) || 1;
    const offset = { x: -shear.y / mag * 6, y: shear.x / mag * 6 };
    const candidate = { x: storm.sourceCell.x, y: storm.sourceCell.y, xKm: storm.positionKm.x, yKm: storm.positionKm.y };
    const child = createStorm(world, candidate, storm.environment, 'left-moving supercell', storm.id, offset);
    child.ageHours = 0.45; setUpdraught(child, storm.updraughtMs * (0.4 + 0.45 * leftShare)); child.precipitation = storm.precipitation * 0.5; child.organization = storm.organization * 0.85;
    child.mesocycloneStrength = (storm.mesocycloneStrength ?? 0) * 0.85; child.lowRotation = 0; child.occlusion = 0;
    storm.children.push(child.id);
    world.stormEngine.totalSplits += 1;
  }
}

const LINE_JOIN_OVERLAP = 0.75, MAX_LINE_HALF_LENGTH_KM = 160;
// A storm starts with part of the line organization its forcing implies and grows into the rest.
const INITIAL_LINE_SHARE = 0.6, LINE_RESPONSE_PER_HOUR = 1;
const isLine = storm => lineShare(storm) >= 0.5;
// Half-length of a line along its axis (a single segment until it joins its neighbours).
const lineHalfLengthKm = storm => storm.lineHalfLengthKm ?? storm.radar?.radiusXKm ?? 20;

function handleMergersAndOrganization(world, spatialIndex) {
  const active = spatialIndex.active;
  const checked = new Set();
  for (const a of active) for (const b of nearbyStorms(spatialIndex, a, 65)) {
    if (a === b || !a.active || !b.active) continue;
    const pairKey = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
    if (checked.has(pairKey)) continue;
    checked.add(pairKey);
    const d=distance(a,b);
    // Neighbouring line segments whose ends overlap join into one longer line.
    const joining = isLine(a) && isLine(b) && d <= (lineHalfLengthKm(a) + lineHalfLengthKm(b)) * LINE_JOIN_OVERLAP;
    const joinedHalfLengthKm = joining ? clamp((lineHalfLengthKm(a) + lineHalfLengthKm(b) + d) / 2, 0, MAX_LINE_HALF_LENGTH_KM) : 0;
    if (!joining && d > Math.max(7, (a.coldPoolRadiusKm+b.coldPoolRadiusKm)*0.20)) continue;
    if (rotatingShare(a) >= 0.5 && rotatingShare(b) >= 0.5 && !joining && d > 8) continue;
    const keeper = a.intensity >= b.intensity ? a : b, absorbed = keeper===a?b:a;
    const total = Math.max(0.1, keeper.intensity + absorbed.intensity);
    keeper.positionKm.x = (keeper.positionKm.x*keeper.intensity + absorbed.positionKm.x*absorbed.intensity)/total;
    keeper.positionKm.y = (keeper.positionKm.y*keeper.intensity + absorbed.positionKm.y*absorbed.intensity)/total;
    setUpdraught(keeper, Math.max(keeper.updraughtMs, absorbed.updraughtMs)); keeper.precipitation = Math.max(keeper.precipitation, absorbed.precipitation);
    keeper.coldPoolStrength = Math.max(keeper.coldPoolStrength, absorbed.coldPoolStrength);
    keeper.organization = clamp((keeper.organization+absorbed.organization)*0.55,0,1);
    keeper.lineOrganization = Math.max(lineShare(keeper), lineShare(absorbed));
    keeper.mergeCount += 1 + absorbed.mergeCount;
    if (joining) keeper.lineHalfLengthKm = Math.max(joinedHalfLengthKm, keeper.lineHalfLengthKm ?? 0);
    keeper.mergedStormIds ??= []; keeper.mergedStormIds.push(absorbed.id, ...(absorbed.mergedStormIds ?? [])); keeper.mergedStormIds = [...new Set(keeper.mergedStormIds)].slice(-20);
    keeper.lastInteractionHourUtc = world.stormEngine?.validHourUtc ?? world.validHourUtc;
    keeper.interactions ??= { mergerBoost: 0, inflowCompetition: 0, lastType: null };
    keeper.interactions.mergerBoost = clamp((keeper.interactions.mergerBoost ?? 0) + 0.34, 0, 1);
    keeper.interactions.lastType = 'merger';
    absorbed.active=false; absorbed.dissipationReason=`merged-into-${keeper.id}`; world.stormEngine.totalMergers += 1;
  }
}

function updateInteractionSuppression(world, spatialIndex) {
  for (const storm of spatialIndex.active) {
    let suppression=0;
    const rotating = rotatingShare(storm);
    const radius = 45 - 13 * rotating;
    const weight = 0.18 - 0.09 * rotating;
    for (const other of nearbyStorms(spatialIndex, storm, radius)) if (other!==storm) {
      const d=distance(storm,other); if (d<radius) suppression += (1-d/radius)*weight;
    }
    storm.interactionSuppression=clamp(suppression,0,0.7-0.38*rotating);
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

// Peak 500 mb warming rate under a full-strength convective updraft footprint.
const CONVECTIVE_HEATING_C_PER_HOUR = 1.2;

export function applyStormFeedback(world, dtHours) {
  const size = world.width * world.height;
  // Convective heating aloft (latent heat released in updrafts) and moisture consumed from the
  // inflow layer: widespread convection stabilises its own surroundings. The cooling at the
  // ground and the convergence along the outflow are not set here: the atmosphere carries
  // each storm's rain-cooled air as a cold pool, and its winds do the rest.
  const midHeating = new Float32Array(size), inflowDrying = new Float32Array(size);
  for (const storm of world.storms) {
    if (!storm.active || storm.intensity < 0.14) continue;
    const radiusKm = clamp(10 + storm.intensity * 28 + (storm.coldPoolStrength ?? 0) * 24, 10, 58);
    const radiusCells = Math.max(1, Math.ceil(radiusKm / world.cellSizeKm));
    const cx = storm.positionKm.x / world.cellSizeKm - 0.5, cy = storm.positionKm.y / world.cellSizeKm - 0.5;
    const exposure = clamp(Math.PI * radiusKm * radiusKm / (world.cellSizeKm * world.cellSizeKm * 7.5), 0.32, 1);
    for (let y = Math.max(0, Math.floor(cy - radiusCells)); y <= Math.min(world.height - 1, Math.ceil(cy + radiusCells)); y++) for (let x = Math.max(0, Math.floor(cx - radiusCells)); x <= Math.min(world.width - 1, Math.ceil(cx + radiusCells)); x++) {
      const dist = Math.hypot((x + 0.5) * world.cellSizeKm - storm.positionKm.x, (y + 0.5) * world.cellSizeKm - storm.positionKm.y);
      if (dist > radiusKm) continue;
      const weight = Math.exp(-Math.pow(dist / Math.max(1, radiusKm * 0.62), 2)), index = y * world.width + x;
      midHeating[index] += weight * storm.intensity * (storm.updraftStrength ?? storm.intensity) * dtHours * CONVECTIVE_HEATING_C_PER_HOUR;
      inflowDrying[index] += weight * storm.intensity * dtHours * exposure * 0.6;
    }
  }
  world.forEachCell((cell, x, y) => {
    const i = y * world.width + x;
    if (!midHeating[i] && !inflowDrying[i]) return;
    cell.levels[500].temperature += midHeating[i]; cell.levels[700].temperature += 0.4 * midHeating[i];
    if (Number.isFinite(cell.levels[850].dewpoint)) cell.levels[850].dewpoint -= inflowDrying[i];
  });
}



function updateStormConfidence(storm, environment, dtHours) {
  storm.confidence ??= { initiation: 0.18, organization: 0.08, persistence: 0.05, hazard: 0.04, tornado: 0, hail: 0, wind: 0 };
  const c = storm.confidence;
  const mature = storm.lifecycleState === 'mature' ? 1 : storm.lifecycleState === 'organizing' ? 0.72 : storm.lifecycleState === 'developing' ? 0.34 : 0.12;
  const rotating = rotatingShare(storm), linear = lineShare(storm);
  const inflow = clamp(storm.inflowQuality ?? 0, 0, 1);
  const structural = clamp((storm.organization ?? 0) * 0.34 + (storm.intensity ?? 0) * 0.28 + (storm.updraftStrength ?? 0) * 0.22 + inflow * 0.16, 0, 1);
  const ageSupport = clamp((storm.ageHours ?? 0) / 1.5, 0, 1);
  const weakening = ['weakening', 'dissipating'].includes(storm.lifecycleState) ? 0.42 : 1;
  const targetOrganization = clamp(structural * mature, 0, 1);
  const targetPersistence = clamp((ageSupport * 0.30 + structural * 0.42 + inflow * 0.28) * weakening, 0, 1);
  const targetHazard = clamp((targetOrganization * 0.52 + targetPersistence * 0.30 + mature * 0.18) * weakening, 0, 1);
  const lowLcl = clamp((1700 - (environment.lcl ?? 1900)) / 1050, 0, 1);
  const rotation = clamp(Math.max(storm.rotationStrength ?? 0, storm.mesocycloneStrength ?? 0), 0, 1);
  const hailCore = clamp((storm.updraftStrength ?? 0), 0, 1);
  const windCore = clamp((storm.coldPoolStrength ?? 0) * 0.55 + (storm.intensity ?? 0) * 0.25 + linear * 0.20, 0, 1);
  const targets = {
    organization: targetOrganization,
    persistence: targetPersistence,
    hazard: targetHazard,
    tornado: clamp(targetHazard * (0.20 + 0.28 * rotating) + rotation * 0.38 + lowLcl * 0.14, 0, 1),
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

// The hail and gust formulas (and their HAIL and GUST settings) are in StormHazards.js, shared
// with the sounding's hazard outlook.

function diagnoseObservedStorm(storm, environment) {
  const rotating = rotatingShare(storm), linear = lineShare(storm);
  const field = storm.internalField;
  storm.rotationStrength = clamp((storm.mesocycloneStrength ?? 0) * .92, 0, 1);
  storm.orientationDeg = Math.atan2(storm.velocityKph.east, -storm.velocityKph.north) * 180 / Math.PI;
  const motionSpeedKph = Math.hypot(storm.velocityKph.east, storm.velocityKph.north);
  storm.motion = { speedKph: motionSpeedKph, speedMph: motionSpeedKph * 0.621371, directionDeg: (Math.atan2(storm.velocityKph.east, storm.velocityKph.north) * 180 / Math.PI + 360) % 360 };
  const tornadoProbability = clamp(storm.tornado?.probability ?? 0, 0, .95);
  const hailEnvironment = clamp(storm.updraftStrength * .42 + clamp((environment.cape ?? 0) / 3500, 0, 1.15) * .24 + clamp((environment.bulkShear ?? 0) / 55, 0, 1.1) * .20 + .04 + .10 * rotating, 0, 1);
  const hailProbability = clamp(hailEnvironment * (.38 + .24 * rotating), 0, .95);
  const linearForcing = clamp(Number(environment.forcing) || 0, 0, 1);
  const windProbability = clamp(storm.coldPoolStrength * storm.intensity * (.72 + .62 * linear) * clamp(environment.bulkShear/32,0,1) + linear * linearForcing * .10, 0, .98);
  const gustMph = diagnoseGust(storm, environment, motionSpeedKph);
  const sustainedMph = gustMph / 1.45;
  const maxSustainedMph = Math.max(storm.surfaceWind?.maxSustainedMph ?? 0, sustainedMph);
  const maxGustMph = Math.max(storm.surfaceWind?.maxGustMph ?? 0, gustMph);
  storm.surfaceWind = { sustainedMph, gustMph, maxSustainedMph, maxGustMph };

  // Store physically diagnosed storm-scale extremes for inspection and verification.
  // Hail size is an outcome diagnostic, not a forecast probability multiplier.
  const hailSizeInches = diagnoseHailSize(storm, environment);
  // Current hail size (hazardExtremes keeps only the lifetime maximum); used by verification.
  storm.currentHailSizeInches = hailSizeInches;
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
    radiusXKm: clamp(Math.max(8 + storm.intensity * (22 + 16 * linear) + storm.mergeCount * 3, linear >= 0.5 ? storm.lineHalfLengthKm ?? 0 : 0), 8, linear >= 0.5 ? MAX_LINE_HALF_LENGTH_KM : 85),
    radiusYKm: clamp(7 + storm.intensity * (14 + 2 * linear), 7, 42)
  };
  const tags = [];
  if (rotating >= .5 && storm.organization > .5) tags.push('supercell');
  if (storm.mode === 'elevated convection' && hailProbability > .3) tags.push('elevated hailstorm');
  if (storm.mode === 'MCS') tags.push('MCS');
  if (storm.mode === 'QLCS') tags.push('QLCS');
  if (tornadoProbability > .42 && storm.lifecycleState === 'mature') tags.push('tornado');
  const derechoDistance = storm.trackKm >= 400 && linear >= .5 && windProbability > .62 && storm.ageHours >= 6;
  if (derechoDistance) tags.push('derecho');
  storm.eventTags = tags;
}

function updateLifecycleEvolution(storm, environment, dtHours) {
  storm.lifecycle ??= { phase: 'tower', previousPhase: null, phaseAgeHours: 0, cycleNumber: 0, cyclePhase: 0, transitionCount: 0, peakPhase: 'tower' };
  storm.mesocycloneCycle ??= { phase: 0, strengthening: false, occlusion: 0, cyclesCompleted: 0 };
  const lc = storm.lifecycle;
  const supercell = rotatingShare(storm) >= 0.5;
  const mergerBoost = clamp(storm.interactions?.mergerBoost ?? 0, 0, 1);
  // A name for what the budgets are doing; nothing in the storm's behaviour reads it.
  const trend = storm.updraughtTrend ?? 0;
  let next = 'mature';
  if (storm.ageHours < 0.30) next = 'tower';
  else if (storm.intensity < 0.12) next = 'dissipating';
  else if (trend < -0.2) next = 'weakening';
  else if (trend > 0.2 && storm.intensity < 0.5) next = storm.organization > 0.5 ? 'organizing' : 'developing';
  else if (supercell && storm.ageHours > 1.4 && storm.organization > 0.5) next = 'cyclic';

  if (next !== lc.phase) {
    lc.previousPhase = lc.phase; lc.phase = next; lc.phaseAgeHours = 0; lc.transitionCount += 1;
    const rank = { tower:0, developing:1, organizing:2, mature:3, cyclic:4, weakening:2, dissipating:0 };
    if ((rank[next] ?? 0) > (rank[lc.peakPhase] ?? 0)) lc.peakPhase = next;
  } else lc.phaseAgeHours += dtHours;
  storm.lifecycleState = next;

  // The cycle shown on the radar is the storm's own occlusion (StormRotation.js).
  const cycle = storm.mesocycloneCycle;
  cycle.occlusion = clamp(Math.max(storm.occlusion ?? 0, mergerBoost * 0.18), 0, 1);
  cycle.phase = cycle.occlusion; cycle.strengthening = (storm.lowRotationTrend ?? 0) > 0;
  cycle.cyclesCompleted = storm.tornadoHistory?.length ?? 0;
  lc.cycleNumber = cycle.cyclesCompleted; lc.cyclePhase = cycle.phase;
}
function distance(a,b){ return Math.hypot(a.positionKm.x-b.positionKm.x,a.positionKm.y-b.positionKm.y); }

function archiveEndedStorms(world) {
  world.stormArchive ??= [];
  const now = world.stormEngine?.validHourUtc ?? world.validHourUtc ?? 0;
  for (const storm of world.storms ?? []) {
    if (storm.active || storm.archived) continue;
    storm.archived = true;
    const archivedRecord = {
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
      mesocycloneCycle: structuredClone(storm.mesocycloneCycle ?? null),
      modeHistory: structuredClone(storm.modeHistory ?? []),
      tornadoHistory: (storm.tornadoHistory ?? []).slice(-8),
      dissipationReason: storm.dissipationReason ?? 'inactive'
    };
    world.stormArchive.push(archivedRecord);
    world.stormHistory ??= [];
    if (!world.stormHistory.some(item => item.id === archivedRecord.id)) world.stormHistory.push(structuredClone(archivedRecord));
  }
  const retention = Math.max(0.5, world.stormEngine?.archiveRetentionHours ?? 3);
  const maxEntries = Math.max(20, world.stormEngine?.maxArchiveEntries ?? 120);
  world.stormArchive = world.stormArchive.filter(item => now - (item.endedHourUtc ?? now) <= retention).slice(-maxEntries);
}

