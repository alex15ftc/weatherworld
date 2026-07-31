#!/usr/bin/env node
import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { ensureTrainingLayout } from '../js/training/TrainingCorpusManager.js';
import { readSpatialManifest, validateSpatialManifest } from '../js/training/SpatialTrainingCorpus.js';

const [command = 'status', ...rawArgs] = process.argv.slice(2);
const args = parseArgs(rawArgs);
const paths = await ensureTrainingLayout(args.root, args.cacheRoot, { createExternalCache: command !== 'status' });
const files = (await readdir(paths.era5SpatialManifests, { withFileTypes: true }))
  .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
  .map(entry => path.join(paths.era5SpatialManifests, entry.name)).sort();

let valid = 0, invalid = 0, warnings = 0;
for (const file of files) {
  const manifest = await readSpatialManifest(file);
  const result = await validateSpatialManifest(manifest, {
    cacheRoot: paths.cacheRoot,
    verifyFile: command === 'validate',
    verifyChecksum: args.checksum,
  });
  warnings += result.warnings.length;
  if (result.valid) valid += 1;
  else {
    invalid += 1;
    console.error(`${manifest.eventDate ?? path.basename(file)}: ${result.errors.join('; ')}`);
  }
}
console.log(JSON.stringify({ schemaVersion: '2.37.0', manifests: files.length, valid, invalid, warnings, cacheRoot: paths.cacheRoot }, null, 2));
if (command === 'validate' && invalid) process.exitCode = 1;

function parseArgs(values) {
  const out = { root: 'training', checksum: false };
  for (let i = 0; i < values.length; i += 1) {
    if (values[i] === '--root') out.root = values[++i];
    else if (values[i] === '--cache-root') out.cacheRoot = values[++i];
    else if (values[i] === '--checksum') out.checksum = true;
  }
  return out;
}
