import { Storm } from './Storm.js';
import { findInitiationCandidates } from './InitiationEngine.js';
import { diagnoseStormMotion, sampleStormEnvironment } from './environmentSampling.js';
import { describeStormMode, shouldSplitStorm, rotatingShare, lineShare, lineOrganizationTarget } from './StormModeEngine.js';
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
  const buoyancy = clamp((environment.cape ?? 0) / 3200, 0, 1.25);
  const shearSupport = clamp(((environment.bulkShear ?? 0) - 16) / 44, 0, 1);
  const readiness = clamp(environment.readiness ?? 0, 0, 1);
  const forcing = clamp(environment.forcing ?? 0, 0, 1);
  const initiation = clamp(environment.initiation ?? 0, 0, 1);
  const capPenalty = clamp((environment.cin ?? 0) / 180, 0, 1);
  const linear = lineShare(storm);
  const modeSupport = linear * forcing * 0.08;

  storm.intensity = clamp(0.08 + readiness * 0.20 + buoyancy * 0.08 + initiation * 0.05 + modeSupport - capPenalty * 0.04, 0.08, 0.38);
  storm.organization = clamp(0.08 + shearSupport * 0.25 + forcing * 0.08 + (storm.modeConfidence ?? 0) * 0.10, 0.08, 0.42);
  storm.updraftStrength = clamp(storm.intensity * (0.68 + buoyancy * 0.30), 0.08, 0.48);
  storm.coldPoolStrength = clamp(storm.intensity * (0.10 + 0.14 * linear), 0, 0.18);
  storm.coldPoolRadiusKm = clamp(4 + storm.coldPoolStrength * 18, 4, 9);
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
  const surfaceFuel = (Number(environment.cin) || 0) <= 150 ? Number(environment.cape) || 0 : 0;
  const elevatedFuel = (Number(environment.mostUnstableCin) || 0) <= 60 ? 0.85 * (Number(environment.mostUnstableCape) || 0) : 0;
  storm.fuelCape = Math.max(surfaceFuel, elevatedFuel);
  storm.elevatedFeed = elevatedFuel > surfaceFuel;
  const feedEnvironment = storm.elevatedFeed ? { ...environment, cape: elevatedFuel, cin: Number(environment.mostUnstableCin) || 0 } : environment;
  const starving = storm.fuelCape < 150;

  const physics = diagnoseStormRealizationPhysics(feedEnvironment, storm);
  storm.physics = physics;
  const buoyancy = clamp(physics.realizedUpdraft, 0, 1.25);
  const capPenalty = clamp(1 - physics.inhibitionEfficiency, 0, 1);
  const shearSupport = clamp((environment.bulkShear - 16) / 44, 0, 1);
  // A rotating updraft draws its inflow from farther out and is less disturbed by worked-over
  // air and by its neighbours.
  const processedWeight = 0.55 - 0.25 * rotating;
  const interactionWeight = 0.50 - 0.28 * rotating;
  const processedPenalty = clamp(environment.processedAir * processedWeight + storm.interactionSuppression * interactionWeight, 0, 0.8);
  storm.inflowQuality = clamp(1 - processedPenalty, 0.15, 1);
  storm.interactions ??= { mergerBoost: 0, inflowCompetition: 0, lastType: null };
  storm.interactions.inflowCompetition = clamp(storm.interactionSuppression ?? 0, 0, 1);
  storm.interactions.mergerBoost *= Math.max(0, 1 - dtHours * 0.7);
  const modeBoost = rotating * 0.10 * shearSupport + lineShare(storm) * 0.08 * environment.forcing;
  const targetIntensity = starving ? 0 : clamp((environment.readiness * 0.30 + buoyancy * 0.42 + physics.initiationProbability * 0.18 + modeBoost - capPenalty * 0.20) * storm.inflowQuality, 0, 1);
  const response = starving ? 0.75 : targetIntensity > storm.intensity ? 0.52 : 0.23;
  storm.intensity += (targetIntensity - storm.intensity) * clamp(response * dtHours * 2, 0, 1);
  const targetOrganization = clamp(physics.organizationProbability * 0.58 + shearSupport * 0.16 + physics.balanceSupport * 0.10 + Math.max(rotating, lineShare(storm)) * 0.16, 0, 1);
  // Strongly sheared environments organize updrafts within ~1 h (supercell maturation).
  storm.organization += (targetOrganization - storm.organization) * clamp((0.34 + 0.5 * shearSupport) * dtHours, 0, 1);
  storm.updraftStrength = clamp(physics.realizedUpdraft * (0.55 + storm.intensity * 0.45), 0, 1);
  // Cold pool: rain evaporating into dry air below cloud; a line's merged outflow is deeper.
  const downdraught = clamp((Number(environment.dcape) || 0) / COLD_POOL.strongDcape, 0, 1.2);
  const coldPoolTarget = clamp(storm.intensity * (COLD_POOL.base + COLD_POOL.dryness * downdraught + COLD_POOL.line * lineShare(storm)), 0, 1);
  storm.coldPoolStrength += (coldPoolTarget - storm.coldPoolStrength) * clamp(COLD_POOL.responsePerHour * dtHours, 0, 1);
  // Line organization follows the forcing and the cold pool's balance with the shear.
  storm.lineOrganization = lineShare(storm) + (lineOrganizationTarget(storm, environment) - lineShare(storm)) * clamp(LINE_RESPONSE_PER_HOUR * dtHours, 0, 1);
  storm.coldPoolRadiusKm = clamp(5 + storm.ageHours * 5 + storm.coldPoolStrength * 24, 5, 52);
  updateStormColdPool(world, storm, environment, dtHours);
  updateLifecycleEvolution(storm, environment, targetIntensity, dtHours);
  updateStormConfidence(storm, environment, dtHours);
  updateMesocyclone(storm, environment, dtHours);
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
  else if (storm.ageHours > 1.7 && storm.intensity < 0.07) { storm.active = false; storm.dissipationReason = 'environmental-decay'; }
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
    child.mesocycloneStrength = (storm.mesocycloneStrength ?? 0) * 0.85;
    storm.children.push(child.id);
    world.stormEngine.totalSplits += 1;
  }
}

const LINE_JOIN_OVERLAP = 0.75, MAX_LINE_HALF_LENGTH_KM = 160;
// A storm starts with part of the line organization its forcing implies and grows into the rest.
const INITIAL_LINE_SHARE = 0.6, LINE_RESPONSE_PER_HOUR = 1;
// Cold pool strength as a share of storm intensity, and how fast it builds.
// Cold pool strength (0-1): every storm has some; it deepens with the energy available to its
// downdraughts (dry air for the rain to evaporate into) and where storms share one in a line.
const COLD_POOL = { base: 0.25, dryness: 0.45, strongDcape: 1200, line: 0.2, responsePerHour: 0.5 };
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
    keeper.intensity = Math.max(keeper.intensity, absorbed.intensity);
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

function updateMesocyclone(storm, environment, dtHours) {
  const srh = clamp(((environment.srh ?? 0) - 60) / 300, 0, 1.2);
  const shear = clamp(((environment.bulkShear ?? 0) - 20) / 42, 0, 1.15);
  const lowLcl = clamp((1750 - (environment.lcl ?? 1800)) / 1100, 0, 1);
  const inflow = clamp(environment.mesoscale?.effectiveInflow ?? environment.readiness ?? 0, 0, 1);
  const warmSector = clamp(environment.openWarmSectorSupport ?? environment.warmSector ?? 0, 0, 1);
  const prefrontal = clamp(environment.prefrontalSupercellSupport ?? 0, 0, 1);
  const tornadic = clamp(environment.tornadicEnvironmentSupport ?? 0, 0, 1.15);
  const synoptic = clamp((environment.synopticAscent ?? 0) * 0.55 + (environment.moisturePooling ?? environment.mesoscale?.moisturePooling ?? 0) * 0.20, 0, 1);
  // Updrafts embedded in a line share their inflow and rotate less than discrete ones.
  const modeFactor = 1 - 0.45 * lineShare(storm);
  const structure = clamp(storm.organization * 0.34 + storm.updraftStrength * 0.30 + storm.intensity * 0.20 + storm.inflowQuality * 0.16, 0, 1.15);
  // The rotational environment sets the mesocyclone; storm structure modulates it. The former
  // product of two sub-unity terms capped mesocyclones near 0.25 even with 300 m2/s2 SRH.
  const rotationalEnvironment = clamp(0.20 * srh + 0.14 * shear + 0.13 * lowLcl + 0.12 * inflow + 0.08 * warmSector + 0.08 * prefrontal + 0.06 * tornadic + 0.11 * synoptic, 0, 1.25);
  const target = clamp(modeFactor * rotationalEnvironment * (0.45 + 0.75 * structure), 0, 1.25);
  storm.mesocycloneStrength ??= 0;
  const response = target > storm.mesocycloneStrength ? 1.6 : 0.42;
  storm.mesocycloneStrength += (target - storm.mesocycloneStrength) * clamp(dtHours * response, 0, 1);
  if (storm.lifecycleState === 'weakening' || storm.lifecycleState === 'dissipating') storm.mesocycloneStrength *= Math.max(0, 1 - dtHours * 0.65);
}

// Hail. The largest stone an updraught can hold up grows steeply with its speed, so size goes
// as a power of the updraught speed the storm realises (parcel theory less entrainment,
// loading and inhibition, scaled by how mature the storm is). A rotating updraught keeps
// stones in the growth zone longer; steep mid-level lapse rates put more of the buoyancy
// there. Fitted on the redesigned atmosphere so that a typical mature storm is near half an
// inch, about one mature storm-sample in ten reaches 2 in, and the strongest pass 3 in.
const HAIL = { scaleInches: 2.3, referenceUpdraftMs: 55, power: 2.6, nonRotating: 0.5, fullRotation: 0.4, lapseRange: [6.5, 8.5], lapseGain: 0.3, largestInches: 5.5 };
// Gusts. The downdraught's speed from the energy available to it (a share of sqrt(2 DCAPE),
// more as the storm matures), plus a share of the storm's own motion carried to the ground
// (fast storms in strong flow are windier). Nothing is added for what kind of storm it is.
const GUST = { downdraughtShare: 0.6, matureShare: 0.65, motionShare: 0.35 };
const MPH_PER_MS = 2.23694;

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
  const downdraughtMs = Math.sqrt(2 * Math.max(0, Number(environment.dcape) || 0)) * GUST.downdraughtShare * (1 - GUST.matureShare + GUST.matureShare * storm.intensity);
  const motionMs = motionSpeedKph / 3.6 * GUST.motionShare;
  const gustMph = clamp((downdraughtMs + motionMs) * MPH_PER_MS, 10, 130);
  const sustainedMph = gustMph / 1.45;
  const maxSustainedMph = Math.max(storm.surfaceWind?.maxSustainedMph ?? 0, sustainedMph);
  const maxGustMph = Math.max(storm.surfaceWind?.maxGustMph ?? 0, gustMph);
  storm.surfaceWind = { sustainedMph, gustMph, maxSustainedMph, maxGustMph };

  // Store physically diagnosed storm-scale extremes for inspection and verification.
  // Hail size is an outcome diagnostic, not a forecast probability multiplier.
  const lapseRate = Number(environment.lapseRate700500 ?? environment.midLevelLapseRate ?? 6.5);
  const updraughtMs = (storm.physics?.realizedUpdraftMs ?? storm.updraftStrength * 65) * (0.5 + 0.5 * storm.intensity);
  const rotation = HAIL.nonRotating + (1 - HAIL.nonRotating) * clamp((storm.mesocycloneStrength ?? 0) / HAIL.fullRotation, 0, 1);
  const lapse = 1 + HAIL.lapseGain * (clamp((lapseRate - HAIL.lapseRange[0]) / (HAIL.lapseRange[1] - HAIL.lapseRange[0]), 0, 1) - 0.35);
  const hailSizeInches = clamp(HAIL.scaleInches * (updraughtMs / HAIL.referenceUpdraftMs) ** HAIL.power * rotation * lapse, 0, HAIL.largestInches);
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

function updateLifecycleEvolution(storm, environment, target, dtHours) {
  storm.lifecycle ??= { phase: 'tower', previousPhase: null, phaseAgeHours: 0, cycleNumber: 0, cyclePhase: 0, transitionCount: 0, peakPhase: 'tower' };
  storm.mesocycloneCycle ??= { phase: 0, strengthening: false, occlusion: 0, cyclesCompleted: 0 };
  const lc = storm.lifecycle;
  const supercell = rotatingShare(storm) >= 0.5;
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
  } else {
    lc.cyclePhase = 0;
    storm.mesocycloneCycle.phase = 0;
    storm.mesocycloneCycle.strengthening = false;
    storm.mesocycloneCycle.occlusion *= Math.max(0, 1 - dtHours * 0.8);
  }
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

