#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { rasterizeSpcOutlook } from '../js/historical/spc/SPCOutlookRasterizer.js';
import { createHistoricalOutlookCase, createHistoricalOutlookCatalog } from '../js/historical/HistoricalOutlookDataset.js';
import { HISTORICAL_PIPELINE_VERSION, ensureHistoricalLayout, resolveNormalizedSpcInput, listJsonFilesRecursive, migrateNormalizedSpcFiles, needsRebuild, writePipelineManifest } from '../js/historical/HistoricalArchivePipeline.js';

const args = parseArgs(process.argv.slice(2));
const stage = args.stage ?? 'build';
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

const normalizedFiles = await listJsonFilesRecursive(source.inputRoot);
const counters = { scanned: normalizedFiles.length, rasterized: 0, rasterSkipped: 0, casesBuilt: 0, casesSkipped: 0, failures: [] };
const caseSlots = new Array(normalizedFiles.length);
let completed = 0;

if (['rasterize', 'cases', 'catalog', 'build'].includes(stage)) {
  await runPool(normalizedFiles, args.concurrency, async (sourceFile, index) => {
    const relative = path.relative(source.inputRoot, sourceFile);
    const rasterFile = path.join(paths.rasterizedSpc, relative.replace(/\.json$/i, '.grid.json'));
    try {
      const payload = JSON.parse(await readFile(sourceFile, 'utf8'));
      if (!payload.normalizedProduct?.hazards) throw new Error('normalizedProduct.hazards is missing');
      let raster;
      const rebuildRaster = args.force || await needsRebuild(sourceFile, rasterFile);
      if (rebuildRaster) {
        raster = rasterizeSpcOutlook(payload.normalizedProduct, { coverageSamples: args.coverageSamples });
        await mkdir(path.dirname(rasterFile), { recursive: true });
        await writeFile(rasterFile, `${JSON.stringify({ pipelineVersion: HISTORICAL_PIPELINE_VERSION, sourceFile: relative, ...raster })}\n`);
        counters.rasterized += 1;
      } else {
        raster = JSON.parse(await readFile(rasterFile, 'utf8'));
        counters.rasterSkipped += 1;
      }
      if (stage !== 'rasterize') {
        const candidateCase = createHistoricalOutlookCase({ ...payload, rasterizedOutlook: raster, sourceFile: relative });
        const caseFile = path.join(paths.cases, `${candidateCase.caseId}.json`);
        const rebuildCase = args.force || rebuildRaster || await needsRebuild(rasterFile, caseFile);
        let historicalCase;
        if (rebuildCase) {
          historicalCase = candidateCase;
          await writeFile(caseFile, `${JSON.stringify({ pipelineVersion: HISTORICAL_PIPELINE_VERSION, ...historicalCase })}\n`);
          counters.casesBuilt += 1;
        } else {
          historicalCase = JSON.parse(await readFile(caseFile, 'utf8'));
          counters.casesSkipped += 1;
        }
        caseSlots[index] = historicalCase;
      }
    } catch (error) {
      counters.failures.push({ sourceFile: relative, message: error.message });
    } finally {
      completed += 1;
      if (args.progress) printProgress(completed, normalizedFiles.length, startedAt);
    }
  });
}

if (['catalog', 'build'].includes(stage)) {
  const cases = caseSlots.filter(Boolean);
  const catalog = createHistoricalOutlookCatalog(cases);
  const catalogPayload = { pipelineVersion: HISTORICAL_PIPELINE_VERSION, ...catalog, failures: counters.failures };
  await writeFile(path.join(paths.catalog, 'cases.json'), `${JSON.stringify(catalogPayload, null, 2)}\n`);
}

const elapsedMs = Date.now() - startedAt;
await writePipelineManifest(paths.manifest, { stage, sourceRoot: source.inputRoot, paths, concurrency: args.concurrency, elapsedMs, counters });
console.log(`Historical pipeline ${stage}: ${counters.scanned} scanned, ${counters.rasterized} rasterized (${counters.rasterSkipped} skipped), ${counters.casesBuilt} cases (${counters.casesSkipped} skipped), ${counters.failures.length} failures in ${formatDuration(elapsedMs)}.`);
if (counters.failures.length) process.exitCode = 1;

async function runPool(items, concurrency, worker) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, async () => {
    while (true) { const index = cursor++; if (index >= items.length) return; await worker(items[index], index); }
  });
  await Promise.all(runners);
}
function printProgress(done, total, started) {
  const elapsed = Date.now() - started; const rate = done / Math.max(elapsed / 1000, .001); const eta = rate > 0 ? ((total - done) / rate) * 1000 : 0;
  console.log(`[Pipeline] ${done}/${total} (${Math.round(done / Math.max(total, 1) * 100)}%) | elapsed ${formatDuration(elapsed)} | ETA ${formatDuration(eta)}`);
}
function formatDuration(ms) { if (!Number.isFinite(ms) || ms < 1000) return `${Math.max(0, Math.round(ms))}ms`; const sec = Math.round(ms / 1000); const min = Math.floor(sec / 60); return min ? `${min}m ${sec % 60}s` : `${sec}s`; }
function parseArgs(values) {
  const out = { coverageSamples: 4, root: 'data/historical', migrate: false, overwrite: false, force: false, progress: false, concurrency: Math.max(1, Math.min(8, Number(process.env.HISTORICAL_CONCURRENCY) || 4)) };
  for (let i = 0; i < values.length; i += 1) {
    if (values[i] === '--stage') out.stage = values[++i];
    else if (values[i] === '--input') out.input = values[++i];
    else if (values[i] === '--root') out.root = values[++i];
    else if (values[i] === '--coverage-samples') out.coverageSamples = Number(values[++i]);
    else if (values[i] === '--concurrency') out.concurrency = Math.max(1, Number(values[++i]) || 1);
    else if (values[i] === '--migrate') out.migrate = true;
    else if (values[i] === '--overwrite') out.overwrite = true;
    else if (values[i] === '--force') out.force = true;
    else if (values[i] === '--progress') out.progress = true;
  }
  return out;
}
