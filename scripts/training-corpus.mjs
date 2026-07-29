#!/usr/bin/env node
import process from 'node:process';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { ensureTrainingLayout, trainingPaths, writeCorpusStatus, copyJsonTree, writeJson } from '../js/training/TrainingCorpusManager.js';

const [command = 'status', ...rest] = process.argv.slice(2);
const args = parseArgs(rest);
const paths = await ensureTrainingLayout(args.root, args.cacheRoot, { createExternalCache: command === 'init' });
if (command === 'init') {
  await writeJson('training.config.json', { schemaVersion: '2.36.0', trainingRoot: args.root, cacheRoot: paths.cacheRoot, rawFilesStoredInRepository: false });
  console.log(`Training corpus initialized at ${paths.root}`);
  console.log(`External cache: ${paths.cacheRoot}`);
} else if (command === 'status') {
  const { progress, stats } = await writeCorpusStatus(paths);
  console.log(JSON.stringify({ totals: progress.totals, stages: progress.stages, repositoryDataBytes: stats.repositoryDataBytes, cacheRoot: progress.cacheRoot }, null, 2));
} else if (command === 'migrate') {
  const source = args.from;
  if (!source) throw new TypeError('training:migrate requires --from <legacy normalized SPC directory>');
  const result = await copyJsonTree(source, paths.spcTargets, { overwrite: args.overwrite });
  console.log(`Migrated SPC targets: ${result.copied} copied, ${result.skipped} unchanged.`);
} else {
  console.error(`Unknown training corpus command: ${command}`);
  process.exitCode = 2;
}
function parseArgs(values) { const out = { root: 'training', overwrite: false }; for (let i = 0; i < values.length; i += 1) { if (values[i] === '--root') out.root = values[++i]; else if (values[i] === '--cache-root') out.cacheRoot = values[++i]; else if (values[i] === '--from') out.from = values[++i]; else if (values[i] === '--overwrite') out.overwrite = true; } return out; }
