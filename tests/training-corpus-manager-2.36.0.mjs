import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { trainingPaths, ensureTrainingLayout, buildCorpusProgress, copyJsonTree } from '../js/training/TrainingCorpusManager.js';
import { validateNormalizedSpcRecord } from '../js/training/TrainingCorpus.js';

const tmp = await mkdtemp(path.join(os.tmpdir(), 'ww-training-'));
try {
  const root = path.join(tmp, 'training');
  const cache = path.join(tmp, 'cache');
  const paths = await ensureTrainingLayout(root, cache, { createExternalCache: true });
  assert.equal(paths.root, path.resolve(root));
  assert.equal(paths.cacheRoot, path.resolve(cache));
  assert.notEqual(paths.cacheRoot.startsWith(paths.root), true, 'heavy cache must not live inside the training corpus');

  const sample = JSON.parse(await (await import('node:fs/promises')).readFile('training/targets/spc/day1_20110427_1300.json', 'utf8'));
  const validation = validateNormalizedSpcRecord(sample, { sourceFile: 'targets/spc/day1_20110427_1300.json' });
  assert.equal(validation.valid, true);

  await writeFile(paths.casesCatalog, JSON.stringify({ records: [{ eventDate: '2011-04-27' }] }));
  await writeFile(paths.era5Derived, JSON.stringify({ '2011-04-27': {} }));
  await writeFile(paths.noaaOutcomes, JSON.stringify({ records: [{ eventDate: '2011-04-27' }] }));
  await writeFile(paths.pairedCases, JSON.stringify({ cases: [{ eventDate: '2011-04-27', status: 'complete' }] }));
  const progress = await buildCorpusProgress(paths);
  assert.equal(progress.totals.eventDates, 1);
  assert.equal(progress.totals.completeDates, 1);

  const legacy = path.join(tmp, 'legacy');
  await mkdir(legacy, { recursive: true });
  await writeFile(path.join(legacy, 'sample.json'), '{}');
  const migrated = await copyJsonTree(legacy, paths.spcTargets);
  assert.equal(migrated.copied, 1);
  console.log('2.36.0 training corpus manager regression passed.');
} finally {
  await rm(tmp, { recursive: true, force: true });
}
