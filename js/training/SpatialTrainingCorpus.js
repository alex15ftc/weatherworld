import path from 'node:path';
import { access, readFile, stat } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { createHash } from 'node:crypto';

export const SPATIAL_CORPUS_VERSION = '2.37.0';
export const REQUIRED_SURFACE_CHANNELS = Object.freeze([
  'surface__u10', 'surface__v10', 'surface__t2m', 'surface__d2m',
  'surface__msl', 'surface__sp', 'surface__cape', 'surface__cin', 'surface__tcwv'
]);
export const REQUIRED_DERIVED_CHANNELS = Object.freeze([
  'derived__wind10_speed', 'derived__dewpoint_depression',
  'derived__bulk_shear_1000_500', 'derived__lapse_rate_850_500'
]);

export async function validateSpatialManifest(manifest, { cacheRoot, verifyFile = true, verifyChecksum = false } = {}) {
  const errors = [];
  const warnings = [];
  if (manifest?.schemaVersion !== SPATIAL_CORPUS_VERSION) errors.push(`schemaVersion must be ${SPATIAL_CORPUS_VERSION}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(manifest?.eventDate ?? '')) errors.push('eventDate must be YYYY-MM-DD');
  const grid = manifest?.grid ?? {};
  if (!Number.isInteger(grid.rows) || grid.rows < 2) errors.push('grid.rows must be an integer >= 2');
  if (!Number.isInteger(grid.cols) || grid.cols < 2) errors.push('grid.cols must be an integer >= 2');
  if (!(grid.north > grid.south)) errors.push('grid.north must be greater than grid.south');
  if (!(grid.east > grid.west)) errors.push('grid.east must be greater than grid.west');
  if (grid.nominalCellKm !== 10) warnings.push('nominalCellKm differs from the Weather World 10 km display grid');

  const time = manifest?.time ?? {};
  if (!Number.isInteger(time.count) || time.count < 1) errors.push('time.count must be positive');
  if (!Array.isArray(time.validTimes) || time.validTimes.length !== time.count) errors.push('time.validTimes length must equal time.count');

  const channels = Array.isArray(manifest?.channels) ? manifest.channels : [];
  const byName = new Map(channels.map(channel => [channel.name, channel]));
  for (const name of [...REQUIRED_SURFACE_CHANNELS, ...REQUIRED_DERIVED_CHANNELS]) {
    if (!byName.has(name)) errors.push(`missing required channel ${name}`);
  }
  for (const [name, channel] of byName) {
    const expected = [time.count, grid.rows, grid.cols];
    if (JSON.stringify(channel.shape) !== JSON.stringify(expected)) errors.push(`${name} shape must be ${expected.join('x')}`);
    if (channel.dtype !== 'float32') warnings.push(`${name} uses ${channel.dtype}; float32 is recommended`);
  }

  let tensorPath = null;
  if (cacheRoot && manifest?.storage?.externalCacheRelativePath) {
    tensorPath = path.resolve(cacheRoot, manifest.storage.externalCacheRelativePath);
    if (verifyFile && !(await exists(tensorPath))) errors.push(`external tensor missing: ${tensorPath}`);
    if (verifyFile && await exists(tensorPath)) {
      const info = await stat(tensorPath);
      if (Number(manifest.storage.bytes) !== info.size) errors.push(`tensor byte count mismatch for ${tensorPath}`);
      if (verifyChecksum && manifest.storage.sha256 !== await sha256File(tensorPath)) errors.push(`tensor checksum mismatch for ${tensorPath}`);
    }
  } else if (verifyFile) {
    warnings.push('cacheRoot was not supplied; external tensor was not checked');
  }
  return { valid: errors.length === 0, errors, warnings, tensorPath };
}

export async function readSpatialManifest(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function exists(filePath) { try { await access(filePath, fsConstants.F_OK); return true; } catch { return false; } }
async function sha256File(filePath) { return createHash('sha256').update(await readFile(filePath)).digest('hex'); }
