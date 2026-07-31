#!/usr/bin/env node
import process from 'node:process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pairTrainingCorpus as buildPairedCorpus } from '../js/training/TrainingCorpus.js';
import { ensureTrainingLayout, readDateRecordMap, readNoaaRecordCatalog, writeJson, writeCorpusStatus } from '../js/training/TrainingCorpusManager.js';

export async function pairTrainingCorpus(options = {}) {
  const args = {
    root: options.root ?? 'training',
    cacheRoot: options.cacheRoot,
    spc: options.spc,
    era5: options.era5,
    noaa: options.noaa,
    output: options.output,
    quiet: options.quiet ?? false
  };
  const paths = await ensureTrainingLayout(args.root, args.cacheRoot);
  const [spcCatalog, era5Aggregate, noaaAggregate, era5Records, noaaRecordCatalog] = await Promise.all([
    readJson(args.spc ?? paths.casesCatalog),
    readJson(args.era5 ?? paths.era5Derived),
    readJson(args.noaa ?? paths.noaaOutcomes),
    readDateRecordMap(paths.era5Records),
    readNoaaRecordCatalog(paths.noaaRecords)
  ]);
  const era5ByDate = { ...era5Aggregate, ...era5Records };
  const noaaByDate = new Map([...(noaaAggregate.records ?? []), ...(noaaRecordCatalog.records ?? [])].map(record => [record.eventDate, record]));
  const noaaCatalog = { ...noaaAggregate, records: [...noaaByDate.values()].sort((a, b) => a.eventDate.localeCompare(b.eventDate)) };
  const paired = buildPairedCorpus({ spcCatalog, era5ByDate, noaaCatalog });
  await writeJson(args.output ?? paths.pairedCases, paired);
  const corpusStatus = await writeCorpusStatus(paths);

  if (!args.quiet) {
    console.log(`Paired training corpus: ${paired.summary.caseCount} cases, ${paired.summary.usableCount} event-usable, ${paired.summary.forecastCompleteCount} forecast-complete.`);
    console.log(`Event=${paired.summary.eventCompleteCount}, Forecast eligible=${paired.summary.forecastEligibleCount}, SPC=${paired.summary.spcCaseCount}, ERA5=${paired.summary.era5CaseCount}, NOAA=${paired.summary.noaaCaseCount}`);
  }
  return { paired, paths, corpusStatus };
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

function parseArgs(values) {
  const out = { root: 'training' };
  for (let i = 0; i < values.length; i += 1) {
    if (values[i] === '--root') out.root = values[++i];
    else if (values[i] === '--cache-root') out.cacheRoot = values[++i];
    else if (values[i] === '--spc') out.spc = values[++i];
    else if (values[i] === '--era5') out.era5 = values[++i];
    else if (values[i] === '--noaa') out.noaa = values[++i];
    else if (values[i] === '--output') out.output = values[++i];
    else throw new TypeError(`Unknown argument: ${values[i]}`);
  }
  return out;
}

function isDirectExecution() {
  return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
}

if (isDirectExecution()) {
  pairTrainingCorpus(parseArgs(process.argv.slice(2))).catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
