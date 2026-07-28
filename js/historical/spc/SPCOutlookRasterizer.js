export const SPC_RASTERIZER_VERSION = '2.34.3';
export const SPC_RASTERIZER_IMPLEMENTATION_VERSION = '2.34.5.1';

export const DEFAULT_SPC_CELL_SIZE_KM = 10;
export const DEFAULT_COVERAGE_SAMPLES = 4;

const KM_PER_DEGREE_LATITUDE = 111.32;
const CATEGORY_RANK = Object.freeze({ TSTM: 1, MRGL: 2, SLGT: 3, ENH: 4, MDT: 5, HIGH: 6 });
const RASTER_HAZARDS = Object.freeze([
  'categorical', 'tornado', 'wind', 'hail',
  'significantTornado', 'significantWind', 'significantHail'
]);

/**
 * Build a north-up geographic grid using a local equirectangular projection.
 * Rows increase southward; columns increase eastward.
 */
export function createSpcGeographicGrid({
  minLon,
  maxLon,
  minLat,
  maxLat,
  cellSizeKm = DEFAULT_SPC_CELL_SIZE_KM,
  referenceLat = (Number(minLat) + Number(maxLat)) / 2,
  paddingCells = 0
} = {}) {
  validateBounds({ minLon, maxLon, minLat, maxLat });
  if (!(Number(cellSizeKm) > 0)) throw new RangeError('cellSizeKm must be greater than zero');
  if (!Number.isInteger(paddingCells) || paddingCells < 0) throw new RangeError('paddingCells must be a non-negative integer');

  const kmPerDegreeLon = longitudeScale(referenceLat);
  const paddedMinLon = Number(minLon) - paddingCells * cellSizeKm / kmPerDegreeLon;
  const paddedMaxLon = Number(maxLon) + paddingCells * cellSizeKm / kmPerDegreeLon;
  const paddedMinLat = Number(minLat) - paddingCells * cellSizeKm / KM_PER_DEGREE_LATITUDE;
  const paddedMaxLat = Number(maxLat) + paddingCells * cellSizeKm / KM_PER_DEGREE_LATITUDE;
  const width = Math.max(1, Math.ceil((paddedMaxLon - paddedMinLon) * kmPerDegreeLon / cellSizeKm));
  const height = Math.max(1, Math.ceil((paddedMaxLat - paddedMinLat) * KM_PER_DEGREE_LATITUDE / cellSizeKm));

  return deepFreeze({
    projection: 'local-equirectangular',
    orientation: 'north-up',
    rowDirection: 'south',
    columnDirection: 'east',
    cellSizeKm: Number(cellSizeKm),
    width,
    height,
    referenceLat: Number(referenceLat),
    kmPerDegreeLat: KM_PER_DEGREE_LATITUDE,
    kmPerDegreeLon,
    bounds: {
      minLon: paddedMinLon,
      maxLon: paddedMinLon + width * cellSizeKm / kmPerDegreeLon,
      minLat: paddedMaxLat - height * cellSizeKm / KM_PER_DEGREE_LATITUDE,
      maxLat: paddedMaxLat
    }
  });
}

export function createSpcGridForOutlook(normalizedProduct, options = {}) {
  const bounds = collectOutlookBounds(normalizedProduct);
  if (!bounds) throw new TypeError('The SPC outlook contains no polygon geometry');
  return createSpcGeographicGrid({ ...bounds, cellSizeKm: options.cellSizeKm ?? DEFAULT_SPC_CELL_SIZE_KM, paddingCells: options.paddingCells ?? 1 });
}

/**
 * Rasterize a normalized SPC outlook into sparse geographic grid cells.
 * coverageFraction uses deterministic sub-cell sampling for edge cells.
 */
export function rasterizeSpcOutlook(normalizedProduct, {
  grid = null,
  cellSizeKm = DEFAULT_SPC_CELL_SIZE_KM,
  paddingCells = 1,
  coverageSamples = DEFAULT_COVERAGE_SAMPLES,
  minimumCoverage = 0,
  includeEmptyCells = false
} = {}) {
  if (!normalizedProduct?.hazards) throw new TypeError('normalizedProduct.hazards is required');
  if (!Number.isInteger(coverageSamples) || coverageSamples < 1 || coverageSamples > 16) {
    throw new RangeError('coverageSamples must be an integer from 1 through 16');
  }
  if (!(minimumCoverage >= 0 && minimumCoverage <= 1)) throw new RangeError('minimumCoverage must be between 0 and 1');

  const gridSpec = validateGrid(grid ?? createSpcGridForOutlook(normalizedProduct, { cellSizeKm, paddingCells }));
  const cells = new Map();
  const contourSummaries = [];
  const skippedContours = [];
  const skippedPolygons = [];

  for (const hazardType of RASTER_HAZARDS) {
    for (const contour of normalizedProduct.hazards[hazardType] ?? []) {
      const contourDecision = classifyContour(contour, hazardType);
      if (!contourDecision.render) {
        skippedContours.push({ contourId: contour.id ?? null, hazardType, value: contour.value ?? null, reason: contourDecision.reason });
        continue;
      }
      let touchedCells = 0;
      let coveredCellEquivalents = 0;
      let renderedPolygonCount = 0;
      for (let polygonIndex = 0; polygonIndex < (contour.polygons ?? []).length; polygonIndex += 1) {
        const polygon = contour.polygons[polygonIndex];
        const polygonDecision = classifyPolygon(polygon, contour, gridSpec);
        if (!polygonDecision.render) {
          skippedPolygons.push({ contourId: contour.id ?? null, hazardType, value: contour.value ?? null, polygonIndex, reason: polygonDecision.reason, closingSegmentKm: polygonDecision.closingSegmentKm ?? null });
          continue;
        }
        renderedPolygonCount += 1;
        const range = polygonCellRange(polygon.bbox ?? calculateRingBounds(polygon.outer), gridSpec);
        for (let y = range.minY; y <= range.maxY; y += 1) {
          for (let x = range.minX; x <= range.maxX; x += 1) {
            const coverageFraction = estimateCellCoverage(polygon, x, y, gridSpec, coverageSamples);
            if (coverageFraction <= minimumCoverage) continue;
            const cell = getOrCreateCell(cells, x, y, gridSpec);
            applyContour(cell, contour, coverageFraction);
            touchedCells += 1;
            coveredCellEquivalents += coverageFraction;
          }
        }
      }
      contourSummaries.push(deepFreeze({
        contourId: contour.id,
        hazardType: contour.hazardType,
        value: contour.value,
        significant: Boolean(contour.significant),
        touchedCells,
        coveredCellEquivalents: round(coveredCellEquivalents),
        estimatedGridCells: (contour.polygons ?? []).reduce((sum, polygon) => sum + Number(polygon.estimatedGridCells ?? 0), 0),
        renderedPolygonCount,
        skippedPolygonCount: (contour.polygons ?? []).length - renderedPolygonCount
      }));
    }
  }

  if (includeEmptyCells) {
    for (let y = 0; y < gridSpec.height; y += 1) {
      for (let x = 0; x < gridSpec.width; x += 1) getOrCreateCell(cells, x, y, gridSpec);
    }
  }

  const orderedCells = [...cells.values()]
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map(finalizeCell);
  const totalCellCount = gridSpec.width * gridSpec.height;

  return deepFreeze({
    schemaVersion: SPC_RASTERIZER_VERSION,
    coordinateSpace: 'historical-geographic',
    rasterizerVersion: SPC_RASTERIZER_VERSION,
    rasterizerImplementationVersion: SPC_RASTERIZER_IMPLEMENTATION_VERSION,
    sourceSchemaVersion: normalizedProduct.schemaVersion ?? null,
    forecastDay: normalizedProduct.forecastDay ?? null,
    issuedAt: normalizedProduct.issuedAt ?? null,
    validStart: normalizedProduct.validStart ?? null,
    validEnd: normalizedProduct.validEnd ?? null,
    grid: gridSpec,
    cells: orderedCells,
    contours: contourSummaries,
    diagnostics: {
      contourCount: contourSummaries.length,
      populatedCellCount: orderedCells.filter(cell => cell.contourIds.length > 0).length,
      emittedCellCount: orderedCells.length,
      totalCellCount,
      coverageSamples,
      minimumCoverage,
      skippedContourCount: skippedContours.length,
      skippedPolygonCount: skippedPolygons.length,
      skippedContours,
      skippedPolygons
    }
  });
}

export function cellBoundsFromGrid(x, y, grid) {
  const spec = validateGrid(grid);
  validateCellIndex(x, y, spec);
  const west = spec.bounds.minLon + x * spec.cellSizeKm / spec.kmPerDegreeLon;
  const east = spec.bounds.minLon + (x + 1) * spec.cellSizeKm / spec.kmPerDegreeLon;
  const north = spec.bounds.maxLat - y * spec.cellSizeKm / spec.kmPerDegreeLat;
  const south = spec.bounds.maxLat - (y + 1) * spec.cellSizeKm / spec.kmPerDegreeLat;
  return { minLon: west, maxLon: east, minLat: south, maxLat: north };
}

function collectOutlookBounds(product) {
  let result = null;
  for (const hazardType of RASTER_HAZARDS) {
    for (const contour of product?.hazards?.[hazardType] ?? []) {
      if (!classifyContour(contour, hazardType).render) continue;
      for (const polygon of contour.polygons ?? []) {
        const bbox = polygon.bbox ?? calculateRingBounds(polygon.outer);
        if (!bbox) continue;
        result = result ? {
          minLon: Math.min(result.minLon, bbox.minLon), maxLon: Math.max(result.maxLon, bbox.maxLon),
          minLat: Math.min(result.minLat, bbox.minLat), maxLat: Math.max(result.maxLat, bbox.maxLat)
        } : { ...bbox };
      }
    }
  }
  return result;
}

function classifyContour(contour, hazardType) {
  if (!contour || typeof contour !== 'object') return { render: false, reason: 'invalid-contour' };
  if (hazardType === 'categorical') {
    const value = String(contour.value ?? '').toUpperCase();
    if (!Object.hasOwn(CATEGORY_RANK, value)) return { render: false, reason: 'unrecognized-categorical-value' };
    const role = String(contour.role ?? contour.geometryRole ?? '').toLowerCase();
    if (['background', 'outline', 'no-risk', 'none', 'discarded'].includes(role)) return { render: false, reason: `non-risk-role:${role}` };
  }
  return { render: true };
}

function classifyPolygon(polygon) {
  if (!polygon?.outer || polygon.outer.length < 4) return { render: false, reason: 'invalid-polygon' };
  if (polygon.validation?.valid === false) return { render: false, reason: 'failed-geometry-validation' };
  if (polygon.discardedOutline === true || polygon.role === 'outline' || polygon.role === 'no-risk') return { render: false, reason: 'non-risk-outline' };
  return { render: true };
}


function polygonCellRange(bbox, grid) {
  const westKm = (bbox.minLon - grid.bounds.minLon) * grid.kmPerDegreeLon;
  const eastKm = (bbox.maxLon - grid.bounds.minLon) * grid.kmPerDegreeLon;
  const northKm = (grid.bounds.maxLat - bbox.maxLat) * grid.kmPerDegreeLat;
  const southKm = (grid.bounds.maxLat - bbox.minLat) * grid.kmPerDegreeLat;
  return {
    minX: clamp(Math.floor(westKm / grid.cellSizeKm), 0, grid.width - 1),
    maxX: clamp(Math.floor(eastKm / grid.cellSizeKm), 0, grid.width - 1),
    minY: clamp(Math.floor(northKm / grid.cellSizeKm), 0, grid.height - 1),
    maxY: clamp(Math.floor(southKm / grid.cellSizeKm), 0, grid.height - 1)
  };
}

function estimateCellCoverage(polygon, x, y, grid, samples) {
  const bounds = cellBoundsFromGrid(x, y, grid);
  const corners = [
    [bounds.minLon, bounds.minLat], [bounds.minLon, bounds.maxLat],
    [bounds.maxLon, bounds.minLat], [bounds.maxLon, bounds.maxLat]
  ];
  if (corners.every(point => pointInPolygon(point, polygon))) return 1;

  let inside = 0;
  const total = samples * samples;
  for (let sy = 0; sy < samples; sy += 1) {
    const lat = bounds.maxLat - (sy + 0.5) / samples * (bounds.maxLat - bounds.minLat);
    for (let sx = 0; sx < samples; sx += 1) {
      const lon = bounds.minLon + (sx + 0.5) / samples * (bounds.maxLon - bounds.minLon);
      if (pointInPolygon([lon, lat], polygon)) inside += 1;
    }
  }
  return inside / total;
}

function pointInPolygon(point, polygon) {
  if (!pointInRing(point, polygon.outer)) return false;
  return !(polygon.holes ?? []).some(hole => pointInRing(point, hole));
}

function pointInRing([x, y], ring = []) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / ((yj - yi) || Number.EPSILON) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function getOrCreateCell(cells, x, y, grid) {
  const key = `${x}:${y}`;
  let cell = cells.get(key);
  if (cell) return cell;
  const bounds = cellBoundsFromGrid(x, y, grid);
  cell = {
    id: `SPC_${String(y).padStart(4, '0')}_${String(x).padStart(4, '0')}`,
    x,
    y,
    center: { lon: (bounds.minLon + bounds.maxLon) / 2, lat: (bounds.minLat + bounds.maxLat) / 2 },
    bounds,
    hazards: {},
    contourIds: new Set()
  };
  cells.set(key, cell);
  return cell;
}

function applyContour(cell, contour, coverageFraction) {
  const type = contour.hazardType;
  const existing = cell.hazards[type];
  const value = contour.value;
  const incomingRank = type === 'categorical' ? (CATEGORY_RANK[value] ?? 0) : (typeof value === 'number' ? value : 1);
  const existingRank = existing ? (type === 'categorical' ? (CATEGORY_RANK[existing.value] ?? 0) : (typeof existing.value === 'number' ? existing.value : 1)) : -1;

  if (!existing || incomingRank > existingRank) {
    cell.hazards[type] = {
      value,
      significant: Boolean(contour.significant),
      coverageFraction,
      contourIds: new Set([contour.id])
    };
  } else if (incomingRank === existingRank) {
    existing.coverageFraction = Math.max(existing.coverageFraction, coverageFraction);
    existing.significant ||= Boolean(contour.significant);
    existing.contourIds.add(contour.id);
  }
  cell.contourIds.add(contour.id);
}

function finalizeCell(cell) {
  const hazards = {};
  for (const [type, hazard] of Object.entries(cell.hazards)) {
    hazards[type] = {
      value: hazard.value,
      significant: hazard.significant,
      coverageFraction: round(hazard.coverageFraction),
      contourIds: [...hazard.contourIds].sort()
    };
  }
  return deepFreeze({
    id: cell.id,
    x: cell.x,
    y: cell.y,
    center: { lon: round(cell.center.lon), lat: round(cell.center.lat) },
    bounds: Object.fromEntries(Object.entries(cell.bounds).map(([key, value]) => [key, round(value)])),
    hazards,
    contourIds: [...cell.contourIds].sort()
  });
}

function validateGrid(grid) {
  if (!grid || !Number.isInteger(grid.width) || !Number.isInteger(grid.height) || grid.width < 1 || grid.height < 1) {
    throw new TypeError('A valid grid with positive integer width and height is required');
  }
  if (!(grid.cellSizeKm > 0) || !(grid.kmPerDegreeLat > 0) || !(grid.kmPerDegreeLon > 0)) throw new TypeError('Grid distance metadata is invalid');
  validateBounds(grid.bounds);
  return grid;
}

function validateBounds({ minLon, maxLon, minLat, maxLat } = {}) {
  if (![minLon, maxLon, minLat, maxLat].every(Number.isFinite)) throw new TypeError('Finite geographic bounds are required');
  if (!(minLon < maxLon) || !(minLat < maxLat)) throw new RangeError('Geographic bounds must have positive width and height');
}

function validateCellIndex(x, y, grid) {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= grid.width || y >= grid.height) {
    throw new RangeError(`Cell index ${x},${y} lies outside the grid`);
  }
}

function calculateRingBounds(ring = []) {
  if (!ring.length) return null;
  const lon = ring.map(point => point[0]);
  const lat = ring.map(point => point[1]);
  return { minLon: Math.min(...lon), maxLon: Math.max(...lon), minLat: Math.min(...lat), maxLat: Math.max(...lat) };
}

function longitudeScale(latitude) {
  const value = KM_PER_DEGREE_LATITUDE * Math.cos(Number(latitude) * Math.PI / 180);
  if (!(value > 0.001)) throw new RangeError('referenceLat is too close to a pole for local equirectangular rasterization');
  return value;
}

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function round(value) { return Number(Number(value).toFixed(6)); }
function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
