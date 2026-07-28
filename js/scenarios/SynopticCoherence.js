import { clamp } from './math.js?v=2.20.1';

export function diagnoseSynopticCoherence(world) {
  const boundaries = world.mesoscale?.boundaries ?? [];
  let scoreSum = 0, count = 0;
  const issues = [];
  for (const boundary of boundaries) {
    const geometry = boundaryGeometry(boundary);
    let score = 1;
    if (boundary.type === 'dryline') {
      score -= clamp(Math.abs(geometry.axisEastComponent) - 0.62, 0, 0.38) * 1.3;
      if (boundary.velocityKph.east < -10 && daytime(world.validHourUtc)) issues.push(`${boundary.id}: daytime dryline retreat too fast`);
    }
    if (boundary.type === 'cold') {
      if (boundary.velocityKph.east < -12) { score -= 0.35; issues.push(`${boundary.id}: cold front moving strongly westward`); }
      if (boundary.velocityKph.north > 18) { score -= 0.30; issues.push(`${boundary.id}: cold front moving too far poleward`); }
    }
    if (boundary.type === 'warm') {
      if (boundary.velocityKph.north < -18) { score -= 0.35; issues.push(`${boundary.id}: warm front moving strongly southward`); }
    }
    boundary.coherence = clamp(score, 0, 1);
    scoreSum += boundary.coherence; count += 1;
  }
  let windPenalty = 0;
  world.forEachCell(cell => {
    const dir = cell.levels[500].windDirection;
    if (dir > 25 && dir < 155) windPenalty += 1;
  });
  const windFraction = windPenalty / Math.max(1, world.width * world.height);
  const score = clamp((count ? scoreSum / count : 1) - windFraction * 0.55, 0, 1);
  world.synopticCoherence = { score, issues, implausibleMidlevelFlowFraction: windFraction };
  world.forEachCell(cell => { cell.features.synopticCoherence = score; });
  return world.synopticCoherence;
}

export function constrainBoundaryMotion(boundary, world) {
  const hour = ((world.validHourUtc % 24) + 24) % 24;
  if (boundary.type === 'dryline') {
    const daytimeEastFloor = hour >= 15 && hour <= 23 ? -3 : -16;
    boundary.velocityKph.east = clamp(boundary.velocityKph.east, daytimeEastFloor, 48);
    boundary.velocityKph.north = clamp(boundary.velocityKph.north, -18, 18);
  } else if (boundary.type === 'cold') {
    boundary.velocityKph.east = clamp(boundary.velocityKph.east, -8, 62);
    boundary.velocityKph.north = clamp(boundary.velocityKph.north, -48, 14);
  } else if (boundary.type === 'warm') {
    boundary.velocityKph.east = clamp(boundary.velocityKph.east, -12, 42);
    boundary.velocityKph.north = clamp(boundary.velocityKph.north, -10, 38);
  }
}

function boundaryGeometry(boundary) {
  const first = boundary.pointsKm[0], last = boundary.pointsKm[boundary.pointsKm.length - 1];
  const dx = last.x - first.x, dy = last.y - first.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  return { axisEastComponent: Math.abs(dx) / length };
}
function daytime(hour) { const h = ((hour % 24) + 24) % 24; return h >= 15 && h <= 23; }
