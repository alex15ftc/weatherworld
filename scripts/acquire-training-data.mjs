#!/usr/bin/env node
import process from 'node:process';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { ensureTrainingLayout, readJsonIfExists, writeCorpusStatus } from '../js/training/TrainingCorpusManager.js';
import {
  createCaseAcquisition,
  loadAcquisitionCatalog,
  planAcquisition,
  saveAcquisitionCatalog,
  setStage,
  summarizeAcquisition
} from '../js/training/acquisition/AcquisitionManager.js';

const args = parseArgs(process.argv.slice(2));
const paths = await ensureTrainingLayout(args.root, args.cacheRoot, { createExternalCache: true });
const dates = await resolveDates(args, paths);
if (!dates.length) throw new Error('No training case dates were found. Supply --dates YYYY-MM-DD,... or populate the SPC catalog.');

const catalog = await loadAcquisitionCatalog(paths.acquisition);
await hydrateKnownStages(catalog, dates, paths);
const include = args.source === 'all' ? ['era5', 'noaa'] : [args.source];
const tasks = planAcquisition({ dates, cases: catalog.cases, missingOnly: args.missingOnly, include });

console.log(`Acquisition plan: ${tasks.length} task(s) across ${dates.length} date(s).`);
if (args.dryRun) {
  for (const task of tasks) console.log(`[dry-run] ${task.date} ${task.source}: ${task.action}`);
  console.log(JSON.stringify(summarizeAcquisition(catalog), null, 2));
  process.exit(0);
}
for (const task of tasks) {
  const record = catalog.cases[task.date] ?? createCaseAcquisition(task.date);
  catalog.cases[task.date] = record;
  const key = task.source === 'era5' ? 'era5Raw' : 'noaa';
  setStage(record, key, 'queued', { message: task.action });
}
await saveAcquisitionCatalog(paths.acquisition, catalog);

for (const task of tasks) {
  const record = catalog.cases[task.date];
  try {
    if (task.source === 'era5') await runEra5(task.date, record, paths, args);
    else await runNoaa(task.date, record, paths, args);
  } catch (error) {
    const key = task.source === 'era5' ? 'era5Raw' : 'noaa';
    setStage(record, key, 'failed', { message: error.message });
    if (task.source === 'era5') setStage(record, 'era5Extracted', 'failed', { message: error.message });
    console.error(`${task.date} ${task.source} failed: ${error.message}`);
    if (!args.continueOnError) {
      await saveAcquisitionCatalog(paths.acquisition, catalog);
      process.exitCode = 1;
      break;
    }
  }
  await saveAcquisitionCatalog(paths.acquisition, catalog);
}
await writeCorpusStatus(paths);
console.log(JSON.stringify(summarizeAcquisition(catalog), null, 2));

async function runEra5(date, record, paths, args) {
  setStage(record, 'era5Raw', 'downloading', { message: 'Requesting ERA5 pressure and single-level fields.' });
  await saveAcquisitionCatalog(paths.acquisition, catalog);
  const command = args.python ?? process.env.PYTHON ?? 'python';
  const scriptArgs = [
    'scripts/acquire-era5-training.py', '--dates', date,
    '--cache-root', paths.cacheEra5Raw,
    '--output-root', paths.era5Records
  ];
  if (args.keepRaw) scriptArgs.push('--keep-raw');
  await run(command, scriptArgs);
  setStage(record, 'era5Raw', 'downloaded', { message: 'ERA5 raw fields cached.' });
  setStage(record, 'era5Extracted', 'complete', { files: [path.relative(paths.root, path.join(paths.era5Records, `${date}.json`))] });
}

async function runNoaa(date, record, paths) {
  setStage(record, 'noaa', 'downloading', { message: 'Downloading/caching NOAA Storm Events year and extracting case.' });
  await saveAcquisitionCatalog(paths.acquisition, catalog);
  await run(process.execPath, [
    'scripts/acquire-noaa-training.mjs', '--dates', date,
    '--cache-root', paths.cacheNoaaBulk,
    '--output-root', paths.noaaRecords
  ]);
  setStage(record, 'noaa', 'complete', { files: [path.relative(paths.root, path.join(paths.noaaRecords, `${date}.json`))] });
}

async function hydrateKnownStages(catalog, dates, paths) {
  const spc = await readJsonIfExists(paths.casesCatalog, { records: [] });
  const spcDates = new Set((spc.records ?? []).map(item => item.eventDate));
  const era5 = await readJsonIfExists(paths.era5Derived, {});
  const noaa = await readJsonIfExists(paths.noaaOutcomes, { records: [] });
  const noaaDates = new Set((noaa.records ?? []).map(item => item.eventDate));
  for (const date of dates) {
    const record = catalog.cases[date] ?? createCaseAcquisition(date);
    catalog.cases[date] = record;
    if (spcDates.has(date)) setStage(record, 'spc', 'complete', { message: 'Validated SPC target present.' });
    if (era5[date]) {
      setStage(record, 'era5Raw', record.era5Raw.status === 'missing' ? 'warning' : record.era5Raw.status, { message: 'Legacy compact ERA5 summary present; raw cache not verified.' });
      setStage(record, 'era5Extracted', 'complete', { message: 'Compact ERA5 summary present.' });
    }
    if (noaaDates.has(date)) setStage(record, 'noaa', 'complete', { message: 'NOAA outcome record present.' });
  }
}

async function resolveDates(args, paths) {
  if (args.dates.length) return args.dates;
  const payload = JSON.parse(await readFile(paths.casesCatalog, 'utf8'));
  return [...new Set((payload.records ?? []).map(record => record.eventDate).filter(Boolean))].sort();
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: process.cwd(), stdio: 'inherit', env: process.env });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}`)));
  });
}

function parseArgs(values) {
  const out = { root: 'training', source: 'all', dates: [], missingOnly: false, dryRun: false, keepRaw: false, continueOnError: false };
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (value === '--root') out.root = values[++i];
    else if (value === '--cache-root') out.cacheRoot = values[++i];
    else if (value === '--source') out.source = values[++i];
    else if (value === '--dates') out.dates.push(...values[++i].split(',').map(item => item.trim()).filter(Boolean));
    else if (value === '--missing-only') out.missingOnly = true;
    else if (value === '--dry-run') out.dryRun = true;
    else if (value === '--keep-raw') out.keepRaw = true;
    else if (value === '--continue-on-error') out.continueOnError = true;
    else if (value === '--python') out.python = values[++i];
  }
  if (!['all', 'era5', 'noaa'].includes(out.source)) throw new RangeError('--source must be all, era5, or noaa');
  for (const date of out.dates) if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new TypeError(`Invalid date: ${date}`);
  return out;
}
