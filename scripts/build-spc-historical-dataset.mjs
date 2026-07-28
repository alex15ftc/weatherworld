#!/usr/bin/env node
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { rasterizeSpcOutlook } from '../js/historical/spc/SPCOutlookRasterizer.js';
import { createHistoricalOutlookCase, createHistoricalOutlookCatalog } from '../js/historical/HistoricalOutlookDataset.js';

const args = parseArgs(process.argv.slice(2));
if (!args.input) fail('Usage: node scripts/build-spc-historical-dataset.mjs --input <normalized-directory> [--output <dataset-directory>] [--coverage-samples 4]');
const inputRoot = path.resolve(args.input);
const outputRoot = path.resolve(args.output ?? 'data/historical/spc-cases');
const casesRoot = path.join(outputRoot, 'cases');
await mkdir(casesRoot, { recursive: true });

const files = (await readdir(inputRoot)).filter(name => name.endsWith('.json') && name !== 'parse-summary.json').sort();
const cases = [];
const failures = [];
for (const fileName of files) {
  try {
    const payload = JSON.parse(await readFile(path.join(inputRoot, fileName), 'utf8'));
    const rasterizedOutlook = rasterizeSpcOutlook(payload.normalizedProduct, { coverageSamples: args.coverageSamples });
    const historicalCase = createHistoricalOutlookCase({ ...payload, rasterizedOutlook, sourceFile: fileName });
    cases.push(historicalCase);
    await writeFile(path.join(casesRoot, `${historicalCase.caseId}.json`), `${JSON.stringify(historicalCase)}\n`);
  } catch (error) {
    failures.push({ fileName, message: error.message });
  }
}
const catalog = createHistoricalOutlookCatalog(cases);
const manifest = { ...catalog, failures };
await writeFile(path.join(outputRoot, 'catalog.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Built ${cases.length} historical SPC cases; ${failures.length} failures.`);
if (failures.length) process.exitCode = 1;

function parseArgs(values) {
  const out = { coverageSamples: 4 };
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === '--input') out.input = values[++index];
    else if (values[index] === '--output') out.output = values[++index];
    else if (values[index] === '--coverage-samples') out.coverageSamples = Number(values[++index]);
  }
  return out;
}
function fail(message) { console.error(message); process.exit(2); }
