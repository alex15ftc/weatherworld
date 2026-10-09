// Synoptic objects (surface low, fronts, dryline, triple point, upper-level features) built
// each step from the large-scale state that SynopticDynamics advances. Objects are a view of
// that state for the mesoscale, storm and forecast engines; they never rewrite cell fields.
import { clamp } from '../scenarios/math.js';
import { sampleSynopticPattern, boundaryGeometry } from '../scenarios/synopticPattern.js';
import { advanceSynopticState, initializeSynopticDynamics } from './SynopticDynamics.js';

export function initializeSynopticObjects(world, config = world.evolution?.config ?? world.scenarioMetadata) {
  const pattern = config?.synopticPattern;
  if (pattern && !pattern.dynamics) initializeSynopticDynamics(pattern, config.seed);
  world.synopticObjects = buildSynopticObjects(world, config, null, 0);
  diagnoseKinematics(world, 0);
  projectSynopticObjectSectors(world);
  return world.synopticObjects;
}

export function advanceSynopticObjects(world, dtHours = 1) {
  const config = world.evolution?.config ?? world.scenarioMetadata;
  advanceSynopticState(world, dtHours);
  world.synopticObjects = buildSynopticObjects(world, config, world.synopticObjects, dtHours);
  diagnoseKinematics(world, dtHours);
  projectSynopticObjectSectors(world);
  return world.synopticObjects;
}

function buildSynopticObjects(world, config, previous = null, dtHours = 0) {
  const pattern = config?.synopticPattern;
  if (!pattern) return null;
  const dyn = pattern.dynamics ?? {};
  const elapsedHours = Number(world.evolution?.elapsedHours) || 0;
  const lowSample = sampleSynopticPattern(pattern, pattern.lowX, pattern.lowY, elapsedHours);
  const depthFraction = clamp(pattern.lowDepthHpa / Math.max(1, pattern.maxLowDepthHpa), 0, 1);
  const deepening = Number(dyn.deepeningHpaPerHour) || 0;
  const phase = deepening > 0.15 ? 'developing' : deepening < -0.15 ? (depthFraction < 0.4 ? 'decaying' : 'occluding') : depthFraction > 0.55 ? 'mature' : 'developing';
  const lowVelocity = displayVelocityKph(world, config, dyn.lowVelocity ?? { x: 0, y: 0 });

  const topology = Array.isArray(pattern.boundaryTopology) ? pattern.boundaryTopology : ['cold', 'warm'];
  const fronts = [];
  const frontStrength = type => clamp((0.44 + pattern.intensity * 0.38 + (type === 'dryline' ? pattern.drylineFactor * 0.12 : 0)) * (0.7 + 0.3 * depthFraction), 0, 1);
  const front = (type, velocity) => ({
    id: type === 'cold' ? 'OBJ-COLD-001' : type === 'warm' ? 'OBJ-WARM-001' : 'OBJ-DRYLINE-001',
    type, pointsKm: frontPoints(world, config, pattern, type), authoritative: true,
    strength: frontStrength(type), widthKm: type === 'dryline' ? 24 : 32,
    velocityKph: displayVelocityKph(world, config, velocity),
    lifecyclePhase: phase, segmentBudget: type === 'dryline' ? 4 : 3, parentId: 'SFC-LOW-001'
  });
  // Each boundary reports its own (cross-boundary) motion, not the low's travel along it.
  if (topology.includes('warm')) fronts.push(front('warm', { x: 0, y: Number(dyn.warmFrontSpeed) || 0 }));
  if (topology.includes('cold')) fronts.push(front('cold', { x: Number(dyn.coldFrontSpeed) || 0, y: 0 }));
  if (topology.includes('dryline') && pattern.drylineFactor > 0.2) fronts.push(front('dryline', { x: Number(dyn.drylineSpeed) || 0, y: 0 }));

  const lowPoint = toWorldKm(world, config, pattern.lowX, pattern.lowY);
  const surfaceLow = {
    id: 'SFC-LOW-001', type: 'surface-low', positionKm: lowPoint,
    pressureHpa: lowSample.seaLevelPressureHpa, depthHpa: pattern.lowDepthHpa,
    intensity: depthFraction, velocityKph: lowVelocity, deepeningHpaPerHour: deepening,
    lifecyclePhase: phase, ageHours: (previous?.surfaceLow?.ageHours ?? 0) + dtHours
  };
  const previousBudget = previous?.convectiveBudget;
  return {
    version: 3, authoritative: true, elapsedHours,
    surfaceLow, fronts,
    triplePoint: diagnoseObjectTriplePoint(world, fronts, lowPoint, previous?.triplePoint),
    upperObjects: {
      shortwaves: (pattern.shortwaves ?? []).map(sw => ({ id: `SW-${sw.id}`, type: 'shortwave', amplitudeDm: sw.dm, positionKm: toWorldKm(world, config, sw.x, sw.y) })),
      shortwave: { id: 'SW', type: 'shortwave', intensity: clamp(lowSample.shortwaveCore, 0, 1), lifecyclePhase: phase },
      jetStreak: { id: 'JET-001', type: 'jet-streak', intensity: clamp(lowSample.jetCore, 0, 1), lifecyclePhase: phase }
    },
    lifecycle: { phase },
    events: (dyn.events ?? []).slice(-12),
    environmentalTendencies: { pressureDeepeningHpaPerHour: deepening, lifecyclePhase: phase },
    convectiveMemory: diagnoseConvectiveMemory(world),
    // Initiation bookkeeping only (storms are limited by their environment, not a budget).
    convectiveBudget: {
      remaining: Infinity, consumed: previousBudget?.consumed ?? 0,
      segmentUsage: decaySegmentUsage(previousBudget?.segmentUsage, dtHours), lastUpdatedHour: elapsedHours
    }
  };
}

function frontPoints(world, config, pattern, type) {
  const points = [], n = 25;
  for (let i = 0; i < n; i++) {
    let nx, ny;
    if (type === 'warm') {
      nx = clamp(pattern.lowX + (i / (n - 1)) * 0.65, 0, 1);
      ny = boundaryGeometry(pattern, nx, 0.5).warmFrontY;
    } else {
      ny = clamp(pattern.lowY + (i / (n - 1)) * 0.75, 0, 1);
      const g = boundaryGeometry(pattern, 0.5, ny);
      nx = type === 'cold' ? g.coldFrontX : g.drylineX;
    }
    points.push(toWorldKm(world, config, nx, ny));
  }
  return points;
}

// Kinematic diagnostics from the current fields (no field is modified): surface convergence,
// frontogenesis, upper-jet divergence and the resulting synoptic-scale vertical motion.
function diagnoseKinematics(world, dtHours) {
  world.forEachCell((cell, x, y) => {
    const convergence = diagnoseMassConvergence(world, x, y);
    const frontogenesis = diagnoseFrontogenesis(world, x, y);
    const jetDivergence = diagnoseJetDivergence(cell);
    cell.dynamics ??= {};
    cell.features ??= {};
    cell.dynamics.kinematicConvergence = convergence;
    cell.dynamics.verticalVelocity = clamp(convergence * 0.48 + frontogenesis * 0.30 + jetDivergence * 0.22, -1, 1);
    cell.features.frontogenesis = frontogenesis;
    cell.features.jetDivergence = jetDivergence;
    const memory = dtHours > 0 ? 0.72 : 0;
    cell.features.boundaryConvergence = clamp((Number(cell.features.boundaryConvergence) || 0) * memory + Math.max(0, convergence) * (1 - memory), 0, 1);
  });
}

function diagnoseMassConvergence(world, x, y) {
  const east = windVector(world.getCell(x + 1, y)?.surface?.wind), west = windVector(world.getCell(x - 1, y)?.surface?.wind);
  const north = windVector(world.getCell(x, y - 1)?.surface?.wind), south = windVector(world.getCell(x, y + 1)?.surface?.wind);
  return clamp(-(((east.eastKt - west.eastKt) + (north.northKt - south.northKt)) / (2 * world.cellSizeKm * 8)), -1, 1);
}
function diagnoseFrontogenesis(world, x, y) {
  const c = world.getCell(x, y), e = world.getCell(x + 1, y), n = world.getCell(x, y + 1); if (!c || !e || !n) return 0;
  const tg = Math.hypot((Number(e.surface?.temperature) || 0) - (Number(c.surface?.temperature) || 0), (Number(n.surface?.temperature) || 0) - (Number(c.surface?.temperature) || 0));
  const dg = Math.hypot((Number(e.surface?.dewpoint) || 0) - (Number(c.surface?.dewpoint) || 0), (Number(n.surface?.dewpoint) || 0) - (Number(c.surface?.dewpoint) || 0));
  return clamp(tg / 12 + dg / 18, 0, 1);
}
function diagnoseJetDivergence(cell) { const w250 = cell.levels?.[250], w500 = cell.levels?.[500]; return clamp(((Number(w250?.windSpeed) || 0) - (Number(w500?.windSpeed) || 0)) / 120, 0, 1); }
function windVector(w = {}) { const speed = Number(w?.speed) || 0, dir = (Number(w?.direction) || 0) * Math.PI / 180; return { eastKt: -Math.sin(dir) * speed, northKt: -Math.cos(dir) * speed }; }

function projectSynopticObjectSectors(world) {
  if (!world.synopticObjects) return;
  const config = world.evolution?.config ?? world.scenarioMetadata;
  const pattern = config?.synopticPattern;
  const elapsed = Number(world.evolution?.elapsedHours) || 0;
  let warmCount = 0, warmDewpointSum = 0;
  world.forEachCell((cell, x, y) => {
    const native = fromDisplay((x + 0.5) / world.width, (y + 0.5) / world.height, config);
    const sample = sampleSynopticPattern(pattern, native.x, native.y, elapsed);
    const fraction = clamp(sample.warmSector, 0, 1);
    cell.features.synopticWarmSectorFraction = fraction;
    cell.features.warmSector = fraction > 0.30;
    cell.features.synopticSector = fraction > 0.30 ? 'warm' : sample.hotDry > 0.45 ? 'dry' : sample.postFrontal > 0.45 ? 'post-frontal' : 'cool';
    projectBoundaryInfluences(world.synopticObjects, cell, (x + 0.5) * world.cellSizeKm, (y + 0.5) * world.cellSizeKm);
    if (cell.features.warmSector) { warmCount++; warmDewpointSum += Number(cell.surface?.dewpoint) || 0; }
  });
  world.synopticObjects.warmSectorCoverage = warmCount / Math.max(1, world.width * world.height);
  world.synopticObjects.meanWarmSectorDewpointF = warmCount ? warmDewpointSum / warmCount : null;
}

function distanceToPolyline(x, y, points = []) { let best = Infinity; for (let i = 1; i < points.length; i++) { const a = points[i - 1], b = points[i], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy; const t = l2 ? clamp(((x - a.x) * dx + (y - a.y) * dy) / l2, 0, 1) : 0; best = Math.min(best, Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy))); } return best; }
function projectBoundaryInfluences(objects, cell, x, y) {
  const influences = {}; let primary = null, best = 0;
  for (const front of objects?.fronts ?? []) { const d = distanceToPolyline(x, y, front.pointsKm); const width = Math.max(18, Number(front.widthKm) || 30); const value = clamp(Math.exp(-d / (width * 1.8)) * (.45 + .55 * (front.strength ?? .5)), 0, 1); influences[front.type] = { id: front.id, distanceKm: d, influence: value }; if (value > best) { best = value; primary = front; } }
  cell.features.synopticBoundaryInfluences = influences;
  cell.features.primaryBoundaryInfluence = best;
  if (primary && best > .12) { cell.features.primaryBoundaryId = primary.id; cell.features.primaryBoundaryType = primary.type; cell.features.explicitBoundaryInfluence = Math.max(Number(cell.features.explicitBoundaryInfluence) || 0, best); }
}

export function diagnoseSynopticInitiationBudget(world, corridorId) {
  const objects = world.synopticObjects;
  const boundaryMatch = /^boundary:(OBJ-[^:]+):segment:(\d+)/.exec(String(corridorId ?? ''));
  const segmentKey = boundaryMatch ? `${boundaryMatch[1]}:segment:${boundaryMatch[2]}` : `generic:${corridorId ?? 'unknown'}`;
  const front = boundaryMatch ? objects?.fronts?.find(item => item.id === boundaryMatch[1]) : null;
  return { allowed: true, cost: 0, segmentKey, segmentUsed: Number(objects?.convectiveBudget?.segmentUsage?.[segmentKey]) || 0, parentId: front?.parentId ?? objects?.surfaceLow?.id ?? null };
}

export function consumeSynopticInitiationBudget(world, diagnosis) {
  const budget = world.synopticObjects?.convectiveBudget;
  if (!budget || !diagnosis?.segmentKey) return;
  budget.consumed = (budget.consumed ?? 0) + 1;
  budget.segmentUsage ??= {};
  budget.segmentUsage[diagnosis.segmentKey] = (budget.segmentUsage[diagnosis.segmentKey] ?? 0) + 1;
}

function decaySegmentUsage(usage = {}, dtHours = 0) {
  const factor = Math.pow(0.5, Math.max(0, dtHours) / 6);
  const out = {};
  for (const [key, value] of Object.entries(usage)) { const v = (Number(value) || 0) * factor; if (v >= 0.05) out[key] = v; }
  return out;
}

function diagnoseConvectiveMemory(world) {
  let n = 0, processed = 0, outflow = 0, cloud = 0;
  world.forEachCell(cell => {
    n++;
    processed += clamp(Number(cell.features?.stormProcessedAir) || 0, 0, 1);
    outflow += clamp(Number(cell.features?.stormOutflowConvergence) || 0, 0, 1);
    cloud += clamp(Number(cell.cloudCover ?? cell.features?.cloudCover) || 0, 0, 1);
  });
  n = Math.max(1, n);
  return { processedAirFraction: processed / n, outflowConvergenceMean: outflow / n, cloudFraction: cloud / n };
}

function diagnoseObjectTriplePoint(world, fronts, lowPoint, previous = null) {
  const warm = fronts.find(f => f.type === 'warm');
  const trailing = fronts.find(f => f.type === 'dryline') ?? fronts.find(f => f.type === 'cold');
  if (!warm || !trailing) return null;
  let best = null;
  for (const a of warm.pointsKm) for (const b of trailing.pointsKm) {
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (!best || d < best.d) best = { d, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
  if (!best || best.d > 160) return null;
  const fieldSupport = sampleTriplePointSupport(world, best.x, best.y);
  const distanceFromLowKm = Math.hypot(best.x - lowPoint.x, best.y - lowPoint.y);
  let confidence = clamp(clamp(1 - best.d / 160, 0, 1) * .45 + fieldSupport * .35 + Math.exp(-distanceFromLowKm / 150) * .20, 0, 1);
  if (previous && Number.isFinite(previous.x) && Number.isFinite(previous.y)) confidence = clamp(confidence * .82 + Math.exp(-Math.hypot(best.x - previous.x, best.y - previous.y) / 100) * .18, 0, 1);
  if (confidence < 0.22) return null;
  return { id: 'TRIPLE-001', x: best.x, y: best.y, confidence, distanceFromLowKm, fieldSupport, geometryErrorKm: best.d };
}
function sampleTriplePointSupport(world, xKm, yKm) {
  const cx = Math.floor(xKm / world.cellSizeKm), cy = Math.floor(yKm / world.cellSizeKm); let sum = 0, n = 0;
  for (let y = cy - 2; y <= cy + 2; y++) for (let x = cx - 2; x <= cx + 2; x++) { const cell = world.getCell(x, y); if (!cell) continue; n++; sum += clamp((Number(cell.features?.boundaryConvergence) || 0) * .45 + (Number(cell.features?.explicitBoundaryInfluence) || 0) * .30 + (Number(cell.derived?.srh) || 0) / 500 * .25, 0, 1); }
  return n ? sum / n : 0;
}

// Pattern-frame velocity (units/h, x east, y south) to display-frame km/h (east, north).
function displayVelocityKph(world, config, v) {
  const a = toDisplay(0.5, 0.5, config), b = toDisplay(0.5 + v.x, 0.5 + v.y, config);
  return { east: (b.x - a.x) * world.domainWidthKm, north: -(b.y - a.y) * world.domainHeightKm };
}
function toWorldKm(world, config, x, y) {
  const p = toDisplay(x, y, config);
  return { x: clamp(p.x, 0, 1) * world.domainWidthKm, y: clamp(p.y, 0, 1) * world.domainHeightKm };
}
function toDisplay(x, y, config = {}) {
  let px = x, py = y;
  const r = -(Number(config.patternRotationDegrees) || 0) * Math.PI / 180;
  if (r) { const dx = px - .5, dy = py - .5, c = Math.cos(r), s = Math.sin(r); px = .5 + dx * c - dy * s; py = .5 + dx * s + dy * c; }
  return { x: px, y: py };
}
function fromDisplay(x, y, config = {}) {
  let px = x, py = y;
  const r = (Number(config.patternRotationDegrees) || 0) * Math.PI / 180;
  if (r) { const dx = px - .5, dy = py - .5, c = Math.cos(r), s = Math.sin(r); px = .5 + dx * c - dy * s; py = .5 + dx * s + dy * c; }
  return { x: px, y: py };
}
