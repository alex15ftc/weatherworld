#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { HISTORICAL_PIPELINE_VERSION, ensureHistoricalLayout, resolveNormalizedSpcInput, listJsonFilesRecursive, migrateNormalizedSpcFiles, writePipelineManifest } from '../js/historical/HistoricalArchivePipeline.js';
import { validateNormalizedSpcRecord, createTrainingCorpusCatalog } from '../js/historical/HistoricalTrainingCorpus.js';

const args = parseArgs(process.argv.slice(2));
const startedAt = Date.now();
const paths = await ensureHistoricalLayout(args.root);
let source;
try { source = await resolveNormalizedSpcInput({ explicitInput: args.input, root: args.root }); }
catch (error) { console.error(error.message); process.exit(2); }
console.log(`${source.detected ? 'Detected' : 'Using'} normalized SPC source: ${source.inputRoot}`);
if (args.migrate && path.resolve(source.inputRoot) !== path.resolve(paths.normalizedSpc)) {
  const result = await migrateNormalizedSpcFiles(source.inputRoot, paths.normalizedSpc, { overwrite: args.overwrite });
  console.log(`Migrated normalized files: ${result.copied} copied, ${result.skipped} unchanged.`);
  source.inputRoot = paths.normalizedSpc;
}

const files = await listJsonFilesRecursive(source.inputRoot);
const counters = { scanned: files.length, valid: 0, validWithWarnings: 0, invalid: 0, failures: [] };
const records = new Array(files.length);
let completed = 0;
await runPool(files, args.concurrency, async (sourceFile, index) => {
  const relative = path.relative(source.inputRoot, sourceFile).replaceAll('\\', '/');
  try {
    const payload = JSON.parse(await readFile(sourceFile, 'utf8'));
    const validation = validateNormalizedSpcRecord(payload, { sourceFile: relative });
    records[index] = { sourceFile: relative, validation };
    if (!validation.valid) counters.invalid += 1;
    else if (validation.warnings.length) counters.validWithWarnings += 1;
    else counters.valid += 1;
    if (args.writeReports || !validation.valid) {
      const reportFile = path.join(paths.validationSpc, relative.replace(/\.json$/i, '.validation.json'));
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
await mkdir(paths.catalog, { recursive: true });
await writeFile(paths.trainingCatalog, `${JSON.stringify({ pipelineVersion: HISTORICAL_PIPELINE_VERSION, ...catalog, failures: counters.failures }, null, 2)}\n`);
const elapsedMs = Date.now() - startedAt;
await writePipelineManifest(paths.manifest, { stage: 'validate', purpose: 'backend-training-corpus', sourceRoot: source.inputRoot, paths, concurrency: args.concurrency, elapsedMs, counters });
console.log(`Historical training corpus: ${counters.scanned} scanned, ${counters.valid} valid, ${counters.validWithWarnings} valid with warnings, ${counters.invalid} invalid, ${counters.failures.length} processing failures in ${formatDuration(elapsedMs)}.`);
if (counters.invalid || counters.failures.length) process.exitCode = 1;

async function runPool(items, concurrency, worker) { let cursor = 0; await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, async () => { while (true) { const index = cursor++; if (index >= items.length) return; await worker(items[index], index); } })); }
function printProgress(done, total, started) { const elapsed = Date.now() - started; const rate = done / Math.max(elapsed / 1000, .001); const eta = rate > 0 ? ((total - done) / rate) * 1000 : 0; console.log(`[Validate] ${done}/${total} (${Math.round(done / Math.max(total, 1) * 100)}%) | elapsed ${formatDuration(elapsed)} | ETA ${formatDuration(eta)}`); }
function formatDuration(ms) { if (!Number.isFinite(ms) || ms < 1000) return `${Math.max(0, Math.round(ms))}ms`; const sec = Math.round(ms / 1000); const min = Math.floor(sec / 60); return min ? `${min}m ${sec % 60}s` : `${sec}s`; }
function parseArgs(values) { const out = { root: 'data/historical', migrate: false, overwrite: false, progress: false, writeReports: false, concurrency: Math.max(1, Math.min(8, Number(process.env.HISTORICAL_CONCURRENCY) || 4)) }; for (let i = 0; i < values.length; i += 1) { if (values[i] === '--input') out.input = values[++i]; else if (values[i] === '--root') out.root = values[++i]; else if (values[i] === '--concurrency') out.concurrency = Math.max(1, Number(values[++i]) || 1); else if (values[i] === '--migrate') out.migrate = true; else if (values[i] === '--overwrite') out.overwrite = true; else if (values[i] === '--progress') out.progress = true; else if (values[i] === '--write-reports') out.writeReports = true; } return out; }
