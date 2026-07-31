import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { REQUIRED_DERIVED_CHANNELS, REQUIRED_SURFACE_CHANNELS, validateSpatialManifest } from '../js/training/SpatialTrainingCorpus.js';
import { trainingPaths, TRAINING_CORPUS_VERSION } from '../js/training/TrainingCorpusManager.js';

assert.equal(TRAINING_CORPUS_VERSION, '2.37.0');
const paths = trainingPaths('training', '/tmp/weatherworld-cache');
assert.match(paths.era5SpatialManifests, /spatial$/);
assert.match(paths.cacheEra5Spatial, /era5[\\/]spatial$/);

const names = [...REQUIRED_SURFACE_CHANNELS, ...REQUIRED_DERIVED_CHANNELS];
const manifest = {
  schemaVersion: '2.37.0', eventDate: '2020-08-10',
  storage: { format: 'npz', externalCacheRelativePath: 'era5/spatial/2020-08-10/atmosphere.npz', bytes: 1, sha256: 'x' },
  grid: { rows: 100, cols: 100, north: 52, south: 22, west: -115, east: -80, nominalCellKm: 10 },
  time: { count: 8, validTimes: Array.from({ length: 8 }, (_, i) => `2020-08-10T${String(i * 3).padStart(2, '0')}:00:00Z`) },
  channels: names.map(name => ({ name, shape: [8, 100, 100], dtype: 'float32', units: null }))
};
const result = await validateSpatialManifest(manifest, { verifyFile: false });
assert.equal(result.valid, true, result.errors.join('\n'));

const extractor = await readFile(new URL('../scripts/acquire-era5-training.py', import.meta.url), 'utf8');
assert.match(extractor, /np\.savez_compressed/);
assert.match(extractor, /arrays\[f"surface__\{name\}"\]/);
assert.match(extractor, /derived__lapse_rate_850_500/);
assert.match(extractor, /sourceResolutionNote/);
console.log('2.37.0 spatial training corpus regression passed.');

const acquisitionSource = await readFile(new URL('../js/training/acquisition/AcquisitionManager.js', import.meta.url), 'utf8');
assert.match(acquisitionSource, /era5Spatial/);
assert.match(acquisitionSource, /ACQUISITION_SCHEMA_VERSION = '2.37.0'/);
