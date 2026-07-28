import { REGIONS } from '../scenarios/regionalClimatology.js?v=2.20.1';

const REGION_BY_ID = new Map(REGIONS.map(region => [region.id, region]));

export function initializeWorldFramework(world) {
  const width = world.width;
  const height = world.height;
  const cells = Array.from({ length: height }, () => Array(width));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const nx = x / Math.max(1, width - 1);
      const ny = y / Math.max(1, height - 1);
      const regionId = regionIdAt(nx, ny);
      const westFrac = 1 - nx;
      const ridge = Math.pow(westFrac, 1.7);
      const elevationM = Math.round(180 + 1450 * ridge + 90 * Math.sin(y * 0.11) * ridge);
      const roughness = regionId.includes('HIGH') ? 0.34 : regionId.includes('CENTRAL') ? 0.48 : 0.62;
      const soilMoisture = clamp01(0.32 + nx * 0.34 + (ny > 0.5 ? 0.09 : 0));
      const landCover = regionId.includes('HIGH') ? 'shortgrass' : regionId.includes('CENTRAL') ? 'prairie' : 'mixed-grass';
      cells[y][x] = Object.freeze({ regionId, elevationM, roughness, soilMoisture, landCover });
    }
  }

  const regions = REGIONS.map(region => Object.freeze({
    ...region,
    centroid: regionCentroid(cells, region.id),
    bounds: regionBounds(cells, region.id)
  }));

  world.worldFramework = Object.freeze({
    version: '2.13.2',
    width,
    height,
    cellSizeKm: world.cellSizeKm,
    cells: Object.freeze(cells.map(row => Object.freeze(row))),
    regions: Object.freeze(regions)
  });
  applyStaticWorldToCells(world);
}

export function applyStaticWorldToCells(world) {
  const framework = world.worldFramework;
  if (!framework || framework.width !== world.width || framework.height !== world.height) {
    throw new Error('World framework does not match the atmospheric grid.');
  }
  world.regions = framework.regions;
  world.forEachCell((cell, x, y) => {
    const fixed = framework.cells[y][x];
    cell.features.regionId = fixed.regionId;
    cell.region = { ...REGION_BY_ID.get(fixed.regionId) };
    cell.terrain.elevationM = fixed.elevationM;
    cell.terrain.roughness = fixed.roughness;
    cell.terrain.soilMoisture = fixed.soilMoisture;
    cell.terrain.landCover = fixed.landCover;
  });
}

export function preserveStaticFeatures(world, cell, x, y) {
  const fixed = world.worldFramework?.cells?.[y]?.[x];
  if (!fixed) return;
  cell.features.regionId = fixed.regionId;
  cell.region = { ...REGION_BY_ID.get(fixed.regionId) };
  cell.terrain.elevationM = fixed.elevationM;
  cell.terrain.roughness = fixed.roughness;
  cell.terrain.soilMoisture = fixed.soilMoisture;
  cell.terrain.landCover = fixed.landCover;
}

export function validateWorldFramework(world) {
  const framework = world.worldFramework;
  if (!framework) return { valid: false, reason: 'missing framework' };
  let mismatches = 0;
  world.forEachCell((cell, x, y) => {
    const fixed = framework.cells[y][x];
    if (cell.features.regionId !== fixed.regionId || cell.terrain.elevationM !== fixed.elevationM) mismatches += 1;
  });
  return { valid: mismatches === 0, mismatches };
}

function regionIdAt(nx, ny) {
  const westBreak = 0.34;
  const eastBreak = 0.68;
  const north = ny < 0.5 + 0.035 * Math.sin(nx * Math.PI * 2);
  const band = nx < westBreak + 0.025 * Math.sin(ny * Math.PI * 2)
    ? 'HIGH'
    : nx < eastBreak + 0.025 * Math.cos(ny * Math.PI * 2) ? 'CENTRAL' : 'LOW';
  if (band === 'HIGH') return north ? 'NW_HIGH_PLAINS' : 'SW_HIGH_PLAINS';
  if (band === 'CENTRAL') return north ? 'N_CENTRAL_PLAINS' : 'S_CENTRAL_PLAINS';
  return north ? 'NE_LOW_PLAINS' : 'SE_LOW_PLAINS';
}

function regionCentroid(cells, id) {
  let xSum = 0, ySum = 0, count = 0;
  for (let y = 0; y < cells.length; y++) for (let x = 0; x < cells[y].length; x++) {
    if (cells[y][x].regionId !== id) continue;
    xSum += x + 0.5; ySum += y + 0.5; count += 1;
  }
  return count ? { x: xSum / count, y: ySum / count } : { x: 0, y: 0 };
}

function regionBounds(cells, id) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let y = 0; y < cells.length; y++) for (let x = 0; x < cells[y].length; x++) {
    if (cells[y][x].regionId !== id) continue;
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + 1); maxY = Math.max(maxY, y + 1);
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

function clamp01(value) { return Math.max(0, Math.min(1, value)); }
