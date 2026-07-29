#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pairTrainingCorpus } from '../js/historical/HistoricalTrainingCorpus.js';

const args = parseArgs(process.argv.slice(2));
const [spcCatalog, era5ByDate, noaaCatalog] = await Promise.all([
  readJson(args.spc),
  readJson(args.era5),
  readJson(args.noaa)
]);
const paired = pairTrainingCorpus({ spcCatalog, era5ByDate, noaaCatalog });
await mkdir(path.dirname(args.output), { recursive: true });
await writeFile(args.output, `${JSON.stringify(paired, null, 2)}\n`);
console.log(`Paired training corpus: ${paired.summary.caseCount} cases, ${paired.summary.completeCount} complete, ${paired.summary.partialCount} partial.`);
console.log(`SPC=${paired.summary.spcCaseCount}, ERA5=${paired.summary.era5CaseCount}, NOAA=${paired.summary.noaaCaseCount}`);

async function readJson(file) { return JSON.parse(await readFile(file, 'utf8')); }
function parseArgs(values) {
  const out = {
    spc: 'data/historical/catalog/training-corpus.json',
    era5: 'data/analogs/era5-derived.json',
    noaa: 'data/analogs/historical-analog-catalog.json',
    output: 'data/historical/catalog/paired-training-cases.json'
  };
  for (let i = 0; i < values.length; i += 1) {
    if (values[i] === '--spc') out.spc = values[++i];
    else if (values[i] === '--era5') out.era5 = values[++i];
    else if (values[i] === '--noaa') out.noaa = values[++i];
    else if (values[i] === '--output') out.output = values[++i];
  }
  return out;
}
