const ANALYSIS_SCHEMA_VERSION = '2.7.2';
const MIN_BOUNDARY_LENGTH_KM = 100;

// Authoritative map-product layer. Raw grid fields and per-cell diagnostics are
// converted here into stable, renderer-ready products. The renderer should not
// diagnose meteorological features from cells on its own.
export function analyzeMapFeatures(world) {
  const pressureSystems = analyzePressureSystems(world);
  const boundaries = analyzeBoundaries(world);
  const upperAir = analyzeUpperAir(world);
  const airMasses = analyzeAirMasses(world);

  world.analysis = {
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    validHourUtc: world.validHourUtc,
    domain: {
      columns: world.width,
      rows: world.height,
      cellSizeKm: world.cellSizeKm,
      widthKm: world.domainWidthKm,
      heightKm: world.domainHeightKm
    },
    pressureSystems,
    // Compatibility alias for older consumers.
    pressureCenters: pressureSystems.centers,
    boundaries,
    upperAir,
    airMasses,
    outlook: world.outlook ?? null
  };
  return world.analysis;
}

function analyzePressureSystems(world) {
  const candidates = [];
  world.forEachCell((cell, x, y) => {
    if (x < 2 || y < 2 || x > world.width - 3 || y > world.height - 3) return;
    const pressure = seaLevelPressure(cell);
    let lowerThanAll = true;
    let higherThanAll = true;

    for (let oy = -2; oy <= 2; oy++) {
      for (let ox = -2; ox <= 2; ox++) {
        if (!ox && !oy) continue;
        const neighborPressure = seaLevelPressure(world.getCell(x + ox, y + oy));
        if (pressure >= neighborPressure) lowerThanAll = false;
        if (pressure <= neighborPressure) higherThanAll = false;
      }
    }

    if (lowerThanAll) candidates.push(buildPressureCandidate(world, cell, 'L', pressure));
    if (higherThanAll) candidates.push(buildPressureCandidate(world, cell, 'H', pressure));
  });

  const lows = candidates.filter(candidate => candidate.type === 'L').sort((a, b) => a.pressureHpa - b.pressureHpa);
  const highs = candidates.filter(candidate => candidate.type === 'H').sort((a, b) => b.pressureHpa - a.pressureHpa);
  const centers = [...selectSeparated(lows, 16, 2), ...selectSeparated(highs, 18, 2)];

  return {
    centers,
    primaryLow: centers.find(center => center.type === 'L') ?? null,
    primaryHigh: centers.find(center => center.type === 'H') ?? null
  };
}

function buildPressureCandidate(world, cell, type, pressureHpa) {
  const ring = [];
  for (let oy = -2; oy <= 2; oy++) {
    for (let ox = -2; ox <= 2; ox++) {
      if (!ox && !oy) continue;
      const neighbor = world.getCell(cell.x + ox, cell.y + oy);
      if (neighbor) ring.push(seaLevelPressure(neighbor));
    }
  }
  const ringMean = ring.reduce((sum, value) => sum + value, 0) / Math.max(1, ring.length);
  return {
    type,
    x: cell.x,
    y: cell.y,
    pressureHpa,
    prominenceHpa: Math.abs(ringMean - pressureHpa)
  };
}

function selectSeparated(candidates, minCells, limit) {
  const selected = [];
  for (const candidate of candidates) {
    if (selected.every(other => Math.hypot(candidate.x - other.x, candidate.y - other.y) >= minCells)) {
      selected.push(candidate);
      if (selected.length >= limit) break;
    }
  }
  return selected;
}

function analyzeBoundaries(world) {
  const features = [
    ...buildBoundaryFeatures(world, 'cold', cell => cell.features.front === 'cold'),
    ...buildBoundaryFeatures(world, 'warm', cell => cell.features.front === 'warm'),
    ...buildBoundaryFeatures(world, 'dryline', cell => Boolean(cell.features.dryline))
  ];

  const byType = {
    cold: features.filter(feature => feature.type === 'cold'),
    warm: features.filter(feature => feature.type === 'warm'),
    dryline: features.filter(feature => feature.type === 'dryline')
  };

  return {
    minimumDisplayLengthKm: MIN_BOUNDARY_LENGTH_KM,
    features,
    byType,
    totalsKm: {
      cold: sumLengths(byType.cold),
      warm: sumLengths(byType.warm),
      dryline: sumLengths(byType.dryline)
    }
  };
}

function buildBoundaryFeatures(world, type, predicate) {
  const components = collectComponents(world, predicate);
  const features = [];

  for (const cells of components) {
    if (cells.length < 2) continue;
    let points = extractCenterline(cells);
    if (points.length < 2) continue;
    points = smoothOpenPolyline(points, 2);
    points = chaikinOpen(points, 2);
    points = removeNearDuplicatePoints(points, 0.18);

    const lengthKm = polylineLength(points) * world.cellSizeKm;
    if (lengthKm < MIN_BOUNDARY_LENGTH_KM) continue;

    const strengths = cells.map(cell => Number(cell.features.boundaryStrength) || 0);
    const gradients = cells.map(cell => type === 'dryline'
      ? Number(cell.features.dewpointGradient) || 0
      : Number(cell.features.temperatureGradient) || 0);

    features.push({
      id: `${type}-${features.length + 1}`,
      type,
      points,
      lengthKm,
      meanStrength: mean(strengths),
      maxStrength: Math.max(...strengths, 0),
      meanGradientPer100Km: mean(gradients),
      sourceCellCount: cells.length
    });
  }

  return features.sort((a, b) => b.lengthKm - a.lengthKm);
}

function collectComponents(world, predicate) {
  const visited = new Uint8Array(world.width * world.height);
  const components = [];
  const neighbors = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]];

  world.forEachCell((cell, x, y) => {
    const startIndex = y * world.width + x;
    if (visited[startIndex] || !predicate(cell)) return;
    const queue = [cell];
    const component = [];
    visited[startIndex] = 1;

    for (let head = 0; head < queue.length; head++) {
      const current = queue[head];
      component.push(current);
      for (const [dx, dy] of neighbors) {
        const nx = current.x + dx;
        const ny = current.y + dy;
        const neighbor = world.getCell(nx, ny);
        if (!neighbor) continue;
        const index = ny * world.width + nx;
        if (visited[index] || !predicate(neighbor)) continue;
        visited[index] = 1;
        queue.push(neighbor);
      }
    }
    components.push(component);
  });

  return components;
}

// Fits a single centerline through a diagnosed band by projecting cells onto
// the component's principal axis and taking the median cross-axis position in
// each one-cell bin. Coordinates are stored in grid-cell units, not pixels.
function extractCenterline(cells) {
  const meanX = mean(cells.map(cell => cell.x));
  const meanY = mean(cells.map(cell => cell.y));
  let xx = 0;
  let yy = 0;
  let xy = 0;

  for (const cell of cells) {
    const dx = cell.x - meanX;
    const dy = cell.y - meanY;
    xx += dx * dx;
    yy += dy * dy;
    xy += dx * dy;
  }

  const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
  const axis = { x: Math.cos(angle), y: Math.sin(angle) };
  const normal = { x: -axis.y, y: axis.x };
  const bins = new Map();

  for (const cell of cells) {
    const dx = cell.x - meanX;
    const dy = cell.y - meanY;
    const along = dx * axis.x + dy * axis.y;
    const across = dx * normal.x + dy * normal.y;
    const key = Math.round(along);
    if (!bins.has(key)) bins.set(key, []);
    bins.get(key).push({ along, across });
  }

  return [...bins.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, values]) => {
      const along = mean(values.map(value => value.along));
      const offsets = values.map(value => value.across).sort((a, b) => a - b);
      const across = offsets[Math.floor(offsets.length / 2)];
      return {
        x: meanX + axis.x * along + normal.x * across + 0.5,
        y: meanY + axis.y * along + normal.y * across + 0.5
      };
    });
}

function analyzeUpperAir(world) {
  let strongestJet = null;
  let lowest500Height = null;
  let strongestAscent = null;
  let strongestPva = null;

  world.forEachCell((cell, x, y) => {
    const jetKt = cell.levels[250].windSpeed;
    const height500Dm = cell.levels[500].heightDm;
    const ascentMs = cell.dynamics?.verticalVelocityMs ?? 0;
    const pva = cell.dynamics?.vorticityAdvection ?? 0;

    if (!strongestJet || jetKt > strongestJet.value) strongestJet = pointDiagnostic(x, y, jetKt, 'kt');
    if (Number.isFinite(height500Dm) && (!lowest500Height || height500Dm < lowest500Height.value)) {
      lowest500Height = pointDiagnostic(x, y, height500Dm, 'dam');
    }
    if (!strongestAscent || ascentMs > strongestAscent.value) strongestAscent = pointDiagnostic(x, y, ascentMs, 'm/s');
    if (!strongestPva || pva > strongestPva.value) strongestPva = pointDiagnostic(x, y, pva, 's^-2');
  });

  return { strongestJet, lowest500Height, strongestAscent, strongestPva };
}

function analyzeAirMasses(world) {
  const counts = {};
  world.forEachCell(cell => {
    const type = cell.features.airMass ?? 'unknown';
    counts[type] = (counts[type] ?? 0) + 1;
  });
  const total = world.width * world.height;
  const coverage = Object.fromEntries(Object.entries(counts).map(([type, count]) => [type, count / total]));
  const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown';
  return { counts, coverage, dominant };
}

function pointDiagnostic(x, y, value, units) {
  return { x, y, value, units };
}

function seaLevelPressure(cell) {
  return cell.surface.seaLevelPressure ?? cell.surface.pressure;
}

function sumLengths(features) {
  return features.reduce((sum, feature) => sum + feature.lengthKm, 0);
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function polylineLength(points) {
  let length = 0;
  for (let index = 1; index < points.length; index++) {
    length += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
  }
  return length;
}

function smoothOpenPolyline(points, passes = 2) {
  let result = points.map(point => ({ ...point }));
  for (let pass = 0; pass < passes && result.length >= 3; pass++) {
    const next = [result[0]];
    for (let index = 1; index < result.length - 1; index++) {
      next.push({
        x: result[index - 1].x * 0.25 + result[index].x * 0.5 + result[index + 1].x * 0.25,
        y: result[index - 1].y * 0.25 + result[index].y * 0.5 + result[index + 1].y * 0.25
      });
    }
    next.push(result[result.length - 1]);
    result = next;
  }
  return result;
}

function chaikinOpen(points, iterations = 2) {
  let result = points.map(point => ({ ...point }));
  for (let iteration = 0; iteration < iterations && result.length >= 2; iteration++) {
    const next = [result[0]];
    for (let index = 0; index < result.length - 1; index++) {
      const a = result[index];
      const b = result[index + 1];
      next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      next.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    next.push(result[result.length - 1]);
    result = next;
  }
  return result;
}

function removeNearDuplicatePoints(points, minimumDistanceCells) {
  const result = [];
  for (const point of points) {
    const previous = result[result.length - 1];
    if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) >= minimumDistanceCells) result.push(point);
  }
  return result;
}
