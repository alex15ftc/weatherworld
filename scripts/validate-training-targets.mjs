#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { ensureTrainingLayout, listJsonFilesRecursive, trainingPaths, writeJson } from '../js/training/TrainingCorpusManager.js';
import { validateNormalizedSpcRecord, createTrainingCorpusCatalog } from '../js/training/TrainingCorpus.js';

const args = parseArgs(process.argv.slice(2));
const startedAt = Date.now();
const paths = await ensureTrainingLayout(args.root, args.cacheRoot);
const sourceRoot = path.resolve(args.input ?? paths.spcTargets);
const files = await listJsonFilesRecursive(sourceRoot);
if (!files.length) {
  console.error(`No normalized SPC target JSON files found under ${sourceRoot}`);
  process.exit(2);
}
const counters = { scanned: files.length, valid: 0, validWithWarnings: 0, invalid: 0, failures: [] };
const records = new Array(files.length);
let completed = 0;
await runPool(files, args.concurrency, async (sourceFile, index) => {
  const relative = path.relative(sourceRoot, sourceFile).replaceAll('\\', '/');
  try {
    const payload = JSON.parse(await readFile(sourceFile, 'utf8'));
    const validation = validateNormalizedSpcRecord(payload, { sourceFile: `targets/spc/${relative}` });
    records[index] = { sourceFile: `targets/spc/${relative}`, validation };
    if (!validation.valid) counters.invalid += 1;
    else if (validation.warnings.length) counters.validWithWarnings += 1;
    else counters.valid += 1;
    if (args.writeReports || !validation.valid) {
      const reportFile = path.join(paths.spcValidation, relative.replace(/\.json$/i, '.validation.json'));
      await mkdir(path.dirname(reportFile), { recursive: true });
      await writeFile(reportFile, `${JSON.stringify(validation, null, 2)}\n`);
    }
  } catch (error) {
    counters.failures.push({ sourceFile: relative, message: error.message });
    counters.invalid += 1;
  } finally {
    completed += 1;
    if (args.progress) printProgress(completed, files.length, startedAt);
  }
});
const catalog = createTrainingCorpusCatalog(records.filter(Boolean));
await writeJson(paths.casesCatalog, { pipelineVersion: '2.36.0', ...catalog, failures: counters.failures });
await writeJson(paths.manifest, {
  schemaVersion: '2.36.0', generatedAt: new Date().toISOString(), stage: 'validate-targets',
  purpose: 'simulator-training-corpus', sourceRoot, cacheRoot: paths.cacheRoot, counters,
  elapsedMs: Date.now() - startedAt
});
console.log(`Training targets: ${counters.scanned} scanned, ${counters.valid} valid, ${counters.validWithWarnings} valid with warnings, ${counters.invalid} invalid.`);
if (counters.invalid || counters.failures.length) process.exitCode = 1;

async function runPool(items, concurrency, worker) { let cursor = 0; await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, async () => { while (true) { const index = cursor++; if (index >= items.length) return; await worker(items[index], index); } })); }
function printProgress(done, total, started) { const elapsed = Date.now() - started; const rate = done / Math.max(elapsed / 1000, .001); const eta = rate > 0 ? ((total - done) / rate) * 1000 : 0; console.log(`[Targets] ${done}/${total} (${Math.round(done / Math.max(total, 1) * 100)}%) | elapsed ${formatDuration(elapsed)} | ETA ${formatDuration(eta)}`); }
function formatDuration(ms) { if (!Number.isFinite(ms) || ms < 1000) return `${Math.max(0, Math.round(ms))}ms`; const sec = Math.round(ms / 1000); const min = Math.floor(sec / 60); return min ? `${min}m ${sec % 60}s` : `${sec}s`; }
function parseArgs(values) { const out = { root: 'training', progress: false, writeReports: false, concurrency: Math.max(1, Math.min(8, Number(process.env.TRAINING_CONCURRENCY) || 4)) }; for (let i = 0; i < values.length; i += 1) { if (values[i] === '--input') out.input = values[++i]; else if (values[i] === '--root') out.root = values[++i]; else if (values[i] === '--cache-root') out.cacheRoot = values[++i]; else if (values[i] === '--concurrency') out.concurrency = Math.max(1, Number(values[++i]) || 1); else if (values[i] === '--progress') out.progress = true; else if (values[i] === '--write-reports') out.writeReports = true; } return out; }
