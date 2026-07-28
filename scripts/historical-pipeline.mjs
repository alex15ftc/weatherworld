#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { rasterizeSpcOutlook } from '../js/historical/spc/SPCOutlookRasterizer.js';
import { createHistoricalOutlookCase, createHistoricalOutlookCatalog } from '../js/historical/HistoricalOutlookDataset.js';
import {
  HISTORICAL_PIPELINE_VERSION, ensureHistoricalLayout, resolveNormalizedSpcInput,
  listJsonFilesRecursive, migrateNormalizedSpcFiles, needsRebuild, writePipelineManifest
} from '../js/historical/HistoricalArchivePipeline.js';

const args = parseArgs(process.argv.slice(2));
const stage = args.stage ?? 'build';
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
const cases = [];

if (['rasterize', 'cases', 'catalog', 'build'].includes(stage)) {
  for (const sourceFile of normalizedFiles) {
    const relative = path.relative(source.inputRoot, sourceFile);
    const rasterFile = path.join(paths.rasterizedSpc, relative.replace(/\.json$/i, '.grid.json'));
    const caseFileBase = relative.replace(/[\\/]/g, '__').replace(/\.json$/i, '.case.json');
    const caseFile = path.join(paths.cases, caseFileBase);
    try {
      const payload = JSON.parse(await readFile(sourceFile, 'utf8'));
      if (!payload.normalizedProduct?.hazards) throw new Error('normalizedProduct.hazards is missing');
      let raster;
      if (stage === 'rasterize' || stage === 'build' || await needsRebuild(sourceFile, rasterFile)) {
        raster = rasterizeSpcOutlook(payload.normalizedProduct, { coverageSamples: args.coverageSamples });
        await mkdir(path.dirname(rasterFile), { recursive: true });
        await writeFile(rasterFile, `${JSON.stringify({ pipelineVersion: HISTORICAL_PIPELINE_VERSION, sourceFile: relative, ...raster })}\n`);
        counters.rasterized += 1;
      } else {
        raster = JSON.parse(await readFile(rasterFile, 'utf8'));
        counters.rasterSkipped += 1;
      }
      if (stage !== 'rasterize') {
        let historicalCase;
        if (stage === 'build' || await needsRebuild(rasterFile, caseFile)) {
          historicalCase = createHistoricalOutlookCase({ ...payload, rasterizedOutlook: raster, sourceFile: relative });
          const casePayload = { pipelineVersion: HISTORICAL_PIPELINE_VERSION, ...historicalCase };
          await writeFile(caseFile, `${JSON.stringify(casePayload)}\n`);
          counters.casesBuilt += 1;
        } else {
          historicalCase = JSON.parse(await readFile(caseFile, 'utf8'));
          counters.casesSkipped += 1;
        }
        cases.push(historicalCase);
      }
    } catch (error) {
      counters.failures.push({ sourceFile: relative, message: error.message });
    }
  }
}

if (['catalog', 'build'].includes(stage)) {
  const catalog = createHistoricalOutlookCatalog(cases);
  const catalogPayload = { pipelineVersion: HISTORICAL_PIPELINE_VERSION, ...catalog, failures: counters.failures };
  await writeFile(path.join(paths.catalog, 'cases.json'), `${JSON.stringify(catalogPayload, null, 2)}\n`);
  // Compatibility output consumed by the 2.34.4 viewer/server.
  await writeFile(path.join(paths.legacyDataset, 'catalog.json'), `${JSON.stringify(catalogPayload, null, 2)}\n`);
  for (const historicalCase of cases) {
    const sourceCase = path.join(paths.cases, path.basename(historicalCase.sourceFile ?? historicalCase.caseId).replace(/\.json$/i, '.case.json'));
    const destination = path.join(paths.legacyDataset, 'cases', `${historicalCase.caseId}.json`);
    await writeFile(destination, `${JSON.stringify({ pipelineVersion: HISTORICAL_PIPELINE_VERSION, ...historicalCase })}\n`);
  }
}

await writePipelineManifest(paths.manifest, { stage, sourceRoot: source.inputRoot, paths, counters });
console.log(`Historical pipeline ${stage}: ${counters.scanned} scanned, ${counters.rasterized} rasterized, ${counters.casesBuilt} cases, ${counters.failures.length} failures.`);
if (counters.failures.length) process.exitCode = 1;

function parseArgs(values) {
  const out = { coverageSamples: 4, root: 'data/historical', migrate: false, overwrite: false };
  for (let i = 0; i < values.length; i += 1) {
    if (values[i] === '--stage') out.stage = values[++i];
    else if (values[i] === '--input') out.input = values[++i];
    else if (values[i] === '--root') out.root = values[++i];
    else if (values[i] === '--coverage-samples') out.coverageSamples = Number(values[++i]);
    else if (values[i] === '--migrate') out.migrate = true;
    else if (values[i] === '--overwrite') out.overwrite = true;
  }
  return out;
}
