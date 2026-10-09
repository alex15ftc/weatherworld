import { Boundary } from './Boundary.js';
import { clamp } from '../scenarios/math.js';
import { constrainBoundaryMotion } from '../scenarios/SynopticCoherence.js';

const TYPES = ['cold', 'warm', 'dryline'];

export function initializeMesoscaleEngine(world) {
  const boundaries = [];
  let nextId = 1;
  for (const type of TYPES) {
    const objectFront = world.synopticObjects?.fronts?.find(front => front.type === type);
    const pointsKm = objectFront?.pointsKm?.length >= 2 ? objectFront.pointsKm : legacyPrimaryPolyline(world, type);
    if (pointsKm.length < 2) continue;
    const environment = meanPolylineEnvironment(world, pointsKm);
    boundaries.push(new Boundary({
      id: objectFront?.id ?? `B${String(nextId++).padStart(3, '0')}`,
      type,
      pointsKm,
      velocityKph: boundaryVelocity(type, environment),
      strength: objectFront ? objectFront.strength : clamp(environment.boundaryStrength, 0.45, 1),
      widthKm: objectFront?.widthKm ?? (type === 'dryline' ? 24 : 32)
    }));
  }
  const cycloneAnchorKm = currentCycloneAnchorKm(world);
  world.mesoscale = {
    boundaries,
    nextId,
    initializedHourUtc: world.validHourUtc,
    topology: { cycloneAnchorKm, triplePointKm: diagnoseTriplePoint(world, boundaries, cycloneAnchorKm) }
  };
  clearBoundaryProjection(world);
  projectBoundaryInfluence(world, 0);
  projectBoundaryMetadata(world);
}

export function advanceMesoscaleEngine(world, dtHours = 1) {
  if (!world.mesoscale) initializeMesoscaleEngine(world);
  const cycloneAnchorKm = currentCycloneAnchorKm(world);
  if (cycloneAnchorKm) world.mesoscale.topology = { cycloneAnchorKm };
  const previousByType = new Map(world.mesoscale.boundaries.map(boundary => [boundary.type, boundary]));
  const diagnosed = [];
  for (const type of TYPES) {
    const objectFront = world.synopticObjects?.fronts?.find(front => front.type === type);
    const pointsKm = objectFront?.pointsKm?.length >= 2 ? objectFront.pointsKm : legacyPrimaryPolyline(world, type);
    if (pointsKm.length < 2) continue;
    const environment = meanPolylineEnvironment(world, pointsKm);
    const previous = previousByType.get(type);
    const boundary = new Boundary({
      id: previous?.id ?? `B${String(world.mesoscale.nextId++).padStart(3, '0')}`,
      type,
      pointsKm,
      velocityKph: objectFront?.velocityKph ?? boundaryVelocity(type, environment),
      strength: objectFront ? objectFront.strength : clamp(environment.boundaryStrength, 0.16, 1),
      widthKm: objectFront?.widthKm ?? (type === 'dryline' ? 24 : 32),
      ageHours: (previous?.ageHours ?? 0) + dtHours
    });
    if (!objectFront) constrainBoundaryMotion(boundary, world);
    diagnosed.push(boundary);
  }
  world.mesoscale.boundaries = diagnosed;
  world.mesoscale.topology = {
    cycloneAnchorKm,
    triplePointKm: diagnoseTriplePoint(world, diagnosed, cycloneAnchorKm)
  };
}

function diagnoseTriplePoint(world, boundaries, cycloneAnchorKm) {
  const cold = boundaries.find(boundary => boundary.type === 'cold');
  const warm = boundaries.find(boundary => boundary.type === 'warm');
  const dryline = boundaries.find(boundary => boundary.type === 'dryline');
  if (!cold || !warm || !dryline || !cycloneAnchorKm) return null;
  let best = null;
  world.forEachCell((cell, x, y) => {
    const px = (x + 0.5) * world.cellSizeKm;
    const py = (y + 0.5) * world.cellSizeKm;
    const lowDistance = Math.hypot(px - cycloneAnchorKm.x, py - cycloneAnchorKm.y);
    if (lowDistance > 220) return;
    const thermal = Number(cell.features?.temperatureGradient) || 0;
    const moisture = Number(cell.features?.dewpointGradient) || 0;
    const convergence = Math.max(0, Number(cell.features?.convergence) || 0);
    if (thermal < 3.5 || moisture < 5.5) return;
    const score = thermal / 12 + moisture / 16 + convergence * 0.45 - lowDistance / 500;
    if (!best || score > best.score) best = { x: px, y: py, score, thermal, moisture };
  });
  return best ? {
    x: best.x,
    y: best.y,
    confidence: clamp((best.thermal - 3.5) / 10 * 0.45 + (best.moisture - 5.5) / 14 * 0.55, 0, 1)
  } : null;
}

function legacyPrimaryPolyline(world, type) {
  const components = connectedBoundaryComponents(world, type)
    .sort((a, b) => b.length - a.length);
  const component = components.find(candidate => candidate.length >= 4)
    ?? (components.reduce((sum, candidate) => sum + candidate.length, 0) >= 4
      ? components.flat()
      : null);
  return component ? componentToPolyline(component, world.cellSizeKm) : [];
}

function meanPolylineEnvironment(world, pointsKm) {
  let windEast = 0;
  let windNorth = 0;
  let boundaryStrength = 0;
  let count = 0;
  for (const point of pointsKm) {
    const cell = world.getCell(
      clamp(Math.floor(point.x / world.cellSizeKm), 0, world.width - 1),
      clamp(Math.floor(point.y / world.cellSizeKm), 0, world.height - 1)
    );
    if (!cell) continue;
    const rad = cell.surface.wind.direction * Math.PI / 180;
    windEast += -cell.surface.wind.speed * 1.852 * Math.sin(rad);
    windNorth += -cell.surface.wind.speed * 1.852 * Math.cos(rad);
    boundaryStrength += cell.features.boundaryStrength ?? 0.6;
    count++;
  }
  return {
    windEast: windEast / Math.max(1, count),
    windNorth: windNorth / Math.max(1, count),
    boundaryStrength: boundaryStrength / Math.max(1, count)
  };
}

function currentCycloneAnchorKm(world) {
  const config = world.evolution?.config ?? world.scenarioMetadata;
  const pattern = config?.synopticPattern;
  if (!pattern) return null;
  const patternPoint = { x: pattern.lowX, y: pattern.lowY };
  const displayPoint = patternToDisplay(patternPoint.x, patternPoint.y, config);
  return {
    x: world.cellSizeKm * 0.5 + displayPoint.x * Math.max(world.cellSizeKm, world.domainWidthKm - world.cellSizeKm),
    y: world.cellSizeKm * 0.5 + displayPoint.y * Math.max(world.cellSizeKm, world.domainHeightKm - world.cellSizeKm)
  };
}

function patternToDisplay(x, y, config = {}) {
  let px = x;
  let py = y;
  const radians = -(Number(config.patternRotationDegrees) || 0) * Math.PI / 180;
  if (radians) {
    const dx = px - 0.5;
    const dy = py - 0.5;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    px = 0.5 + dx * cos - dy * sin;
    py = 0.5 + dx * sin + dy * cos;
  }
  if (config.patternMirror) px = 1 - px;
  switch ((((Number(config.patternOrientation) || 0) % 4) + 4) % 4) {
    case 1: return { x: 1 - py, y: px };
    case 2: return { x: 1 - px, y: 1 - py };
    case 3: return { x: py, y: 1 - px };
    default: return { x: px, y: py };
  }
}

export function clearBoundaryProjection(world, dtHours = 0) {
  world.forEachCell(cell => {
    const features = cell.features ?? (cell.features = {});
    features.boundaryObjectIds = [];
    features.primaryBoundaryId = null;
    features.primaryBoundaryType = null;
    features.explicitBoundaryInfluence = 0;
    features.boundaryConvergence = 0;
    features.coldFrontInfluence = 0;
    features.warmFrontInfluence = 0;
    features.drylineInfluence = 0;
  });
}

export function projectBoundaryInfluence(world, dtHours = 1) {
  clearBoundaryProjection(world, dtHours);
  if (!world.mesoscale?.boundaries?.length) return;

  world.forEachCell((cell, x, y) => {
    const px = (x + 0.5) * world.cellSizeKm;
    const py = (y + 0.5) * world.cellSizeKm;
    let strongest = null;
    const ids = [];

    for (const boundary of world.mesoscale.boundaries) {
      const nearest = nearestPointOnPolyline(px, py, boundary.pointsKm);
      if (!nearest || nearest.distance > boundary.widthKm * 1.7) continue;
      const influence = Math.exp(-Math.pow(nearest.distance / boundary.widthKm, 2)) * boundary.strength;
      if (influence < 0.04) continue;
      ids.push(boundary.id);
      if (!strongest || influence > strongest.influence) strongest = { boundary, nearest, influence };
      if (boundary.type === 'cold') cell.features.coldFrontInfluence = Math.max(cell.features.coldFrontInfluence, influence);
      if (boundary.type === 'warm') cell.features.warmFrontInfluence = Math.max(cell.features.warmFrontInfluence, influence);
      if (boundary.type === 'dryline') cell.features.drylineInfluence = Math.max(cell.features.drylineInfluence, influence);
      cell.features.explicitBoundaryInfluence = Math.max(cell.features.explicitBoundaryInfluence, influence);
      cell.features.boundaryConvergence = Math.max(cell.features.boundaryConvergence, influence * 0.75);
    }

    cell.features.boundaryObjectIds = ids;
    if (strongest) {
      cell.features.primaryBoundaryId = strongest.boundary.id;
      cell.features.primaryBoundaryType = strongest.boundary.type;
    }
  });
}

export function projectBoundaryMetadata(world) {
  if (!world.mesoscale?.boundaries) return;
  world.evolution.boundaryObjects = world.mesoscale.boundaries.map(boundary => ({
    id: boundary.id,
    type: boundary.type,
    strength: boundary.strength,
    velocityKph: { ...boundary.velocityKph },
    pointsKm: boundary.pointsKm.map(point => ({ ...point })),
    authoritative: Boolean(world.synopticObjects?.fronts?.some(front => front.id === boundary.id || front.type === boundary.type)),
    lifecyclePhase: world.synopticObjects?.fronts?.find(front => front.type === boundary.type)?.lifecyclePhase ?? null
  }));
}

function connectedBoundaryComponents(world, type) {
  const visited = new Uint8Array(world.width * world.height);
  const components = [];
  const matches = cell => type === 'dryline' ? Boolean(cell.features?.dryline) : cell.features?.front === type;
  for (let y = 0; y < world.height; y++) for (let x = 0; x < world.width; x++) {
    const index = y * world.width + x;
    if (visited[index] || !matches(world.getCell(x, y))) continue;
    const queue = [{ x, y }]; visited[index] = 1; const component = [];
    while (queue.length) {
      const point = queue.pop(); component.push(point);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = point.x + dx, ny = point.y + dy;
        if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height) continue;
        const ni = ny * world.width + nx;
        if (visited[ni] || !matches(world.getCell(nx, ny))) continue;
        visited[ni] = 1; queue.push({ x: nx, y: ny });
      }
    }
    components.push(component);
  }
  return components;
}

function componentToPolyline(component, cellSizeKm) {
  const meanX = component.reduce((sum, p) => sum + p.x, 0) / component.length;
  const meanY = component.reduce((sum, p) => sum + p.y, 0) / component.length;
  let xx = 0, yy = 0, xy = 0;
  for (const p of component) { const dx = p.x - meanX, dy = p.y - meanY; xx += dx * dx; yy += dy * dy; xy += dx * dy; }
  const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
  const ux = Math.cos(angle), uy = Math.sin(angle);
  const projected = component.map(point => ({
    point,
    along: (point.x - meanX) * ux + (point.y - meanY) * uy
  }));
  const minimum = Math.min(...projected.map(sample => sample.along));
  const maximum = Math.max(...projected.map(sample => sample.along));
  const binCount = Math.min(18, Math.max(6, Math.ceil(Math.sqrt(component.length))));
  const bins = Array.from({ length: binCount }, () => []);
  for (const sample of projected) {
    const fraction = (sample.along - minimum) / Math.max(1e-6, maximum - minimum);
    bins[Math.min(binCount - 1, Math.floor(fraction * binCount))].push(sample.point);
  }
  const points = bins.filter(bin => bin.length).map(bin => ({
    x: (bin.reduce((sum, point) => sum + point.x, 0) / bin.length + 0.5) * cellSizeKm,
    y: (bin.reduce((sum, point) => sum + point.y, 0) / bin.length + 0.5) * cellSizeKm
  }));
  return dedupeNearby(points, cellSizeKm * 0.7);
}

function dedupeNearby(points, minimum) {
  const result = [];
  for (const point of points) if (!result.length || Math.hypot(point.x - result.at(-1).x, point.y - result.at(-1).y) >= minimum) result.push(point);
  return result;
}

function boundaryVelocity(type, env) {
  if (type === 'cold') return { east: clamp(env.windEast * 0.45 + 18, 12, 46), north: clamp(env.windNorth * 0.18 + 3, -10, 18) };
  if (type === 'warm') return { east: clamp(env.windEast * 0.25 + 5, -5, 24), north: clamp(Math.abs(env.windNorth) * 0.18 + 10, 6, 28) };
  return { east: clamp(env.windEast * 0.18 + 7, 3, 22), north: clamp(env.windNorth * 0.08, -7, 8) };
}

function nearestPointOnPolyline(px, py, points) {
  let best = null;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1]; const vx = b.x - a.x, vy = b.y - a.y;
    const length2 = vx * vx + vy * vy || 1; const t = clamp(((px - a.x) * vx + (py - a.y) * vy) / length2, 0, 1);
    const qx = a.x + vx * t, qy = a.y + vy * t; const dx = px - qx, dy = py - qy; const distance = Math.hypot(dx, dy);
    if (!best || distance < best.distance) best = { distance, dx, dy, cross: vx * dy - vy * dx };
  }
  return best;
}
