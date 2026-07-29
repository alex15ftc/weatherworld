#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { pairTrainingCorpus } from '../js/training/TrainingCorpus.js';
import { ensureTrainingLayout, writeJson, writeCorpusStatus } from '../js/training/TrainingCorpusManager.js';

const args = parseArgs(process.argv.slice(2));
const paths = await ensureTrainingLayout(args.root, args.cacheRoot);
const [spcCatalog, era5ByDate, noaaCatalog] = await Promise.all([
  readJson(args.spc ?? paths.casesCatalog),
  readJson(args.era5 ?? paths.era5Derived),
  readJson(args.noaa ?? paths.noaaOutcomes)
]);
const paired = pairTrainingCorpus({ spcCatalog, era5ByDate, noaaCatalog });
await writeJson(args.output ?? paths.pairedCases, paired);
await writeCorpusStatus(paths);
console.log(`Paired training corpus: ${paired.summary.caseCount} cases, ${paired.summary.completeCount} complete, ${paired.summary.partialCount} partial.`);
console.log(`SPC=${paired.summary.spcCaseCount}, ERA5=${paired.summary.era5CaseCount}, NOAA=${paired.summary.noaaCaseCount}`);
async function readJson(file) { return JSON.parse(await readFile(file, 'utf8')); }
function parseArgs(values) { const out = { root: 'training' }; for (let i = 0; i < values.length; i += 1) { if (values[i] === '--root') out.root = values[++i]; else if (values[i] === '--cache-root') out.cacheRoot = values[++i]; else if (values[i] === '--spc') out.spc = values[++i]; else if (values[i] === '--era5') out.era5 = values[++i]; else if (values[i] === '--noaa') out.noaa = values[++i]; else if (values[i] === '--output') out.output = values[++i]; } return out; }
