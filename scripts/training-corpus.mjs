#!/usr/bin/env node
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { readdir } from 'node:fs/promises';
import { pairTrainingCorpus } from './pair-training-corpus.mjs';
import { ensureTrainingLayout, writeCorpusStatus, copyJsonTree, writeJson, readJsonIfExists } from '../js/training/TrainingCorpusManager.js';

export async function getTrainingCorpusStatus(options = {}) {
  const paths = await ensureTrainingLayout(options.root ?? 'training', options.cacheRoot, { createExternalCache: false });
  const { progress, stats } = await writeCorpusStatus(paths);
  return {
    totals: progress.totals,
    stages: progress.stages,
    repositoryDataBytes: stats.repositoryDataBytes,
    cacheRoot: progress.cacheRoot,
    progress,
    paths
  };
}

export async function getCaseDiagnostics(options = {}) {
  const status = await getTrainingCorpusStatus(options);
  const paired = await readJsonIfExists(status.paths.pairedCases, { cases: [] });
  const spatialDates = new Set(await readdir(status.paths.era5SpatialManifests, { withFileTypes: true })
    .then(entries => entries.filter(entry => entry.isFile() && entry.name.endsWith('.json')).map(entry => entry.name.replace(/\.json$/, '')))
    .catch(() => []));
  const cases = (paired.cases ?? []).map(item => {
    const hasSpc = Boolean(item.completeness?.spc);
    const hasEra5 = Boolean(item.completeness?.era5);
    const hasNoaa = Boolean(item.completeness?.noaa);
    const hasSpatial = spatialDates.has(item.eventDate);
    const eventMissing = [
      ...(!hasEra5 ? ['era5Atmosphere'] : []),
      ...(!hasNoaa ? ['noaaOutcomes'] : [])
    ];
    const forecastMissing = [
      ...(!hasSpc ? ['spcTargets'] : []),
      ...(!hasEra5 ? ['era5Atmosphere'] : []),
      ...(!hasSpatial ? ['era5Spatial'] : []),
      ...(!hasNoaa ? ['noaaOutcomes'] : [])
    ];
    const eventComplete = eventMissing.length === 0;
    const forecastEligible = hasSpc;
    const forecastComplete = forecastEligible && forecastMissing.length === 0;
    return {
      caseId: item.caseId ?? `training-${item.eventDate}`,
      eventDate: item.eventDate,
      status: eventComplete ? 'event-ready' : 'partial',
      usable: eventComplete || forecastComplete,
      eventTraining: {
        complete: eventComplete,
        quality: Math.round(((Number(hasEra5) + Number(hasNoaa)) / 2) * 100),
        missing: eventMissing
      },
      forecastTraining: {
        eligible: forecastEligible,
        complete: forecastComplete,
        quality: Math.round(((Number(hasSpc) + Number(hasEra5) + Number(hasSpatial) + Number(hasNoaa)) / 4) * 100),
        missing: forecastMissing
      },
      completeness: {
        spcTargets: hasSpc,
        era5Atmosphere: hasEra5,
        era5Spatial: hasSpatial,
        noaaOutcomes: hasNoaa
      }
    };
  });
  return { status, cases };
}

export async function validateTrainingCorpus(options = {}) {
  const { status, cases } = await getCaseDiagnostics(options);
  const integrityIssues = [];
  for (const item of cases) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(item.eventDate ?? '')) {
      integrityIssues.push({ type: 'invalidDate', caseId: item.caseId, eventDate: item.eventDate });
    }
  }

  const eventIncomplete = cases.filter(item => !item.eventTraining.complete);
  const forecastEligible = cases.filter(item => item.forecastTraining.eligible);
  const forecastIncomplete = forecastEligible.filter(item => !item.forecastTraining.complete);
  return {
    valid: integrityIssues.length === 0,
    eventCorpusComplete: eventIncomplete.length === 0,
    forecastCorpusComplete: forecastIncomplete.length === 0,
    eventDates: cases.length,
    eventReadyDates: cases.length - eventIncomplete.length,
    forecastEligibleDates: forecastEligible.length,
    forecastCompleteDates: forecastEligible.length - forecastIncomplete.length,
    integrityIssues,
    eventIncomplete: eventIncomplete.map(item => ({ eventDate: item.eventDate, missing: item.eventTraining.missing })),
    forecastIncomplete: forecastIncomplete.map(item => ({ eventDate: item.eventDate, missing: item.forecastTraining.missing })),
    cases,
    status
  };
}

export async function diagnoseTrainingCorpus(options = {}) {
  const validation = await validateTrainingCorpus(options);
  const lines = [
    'Dual Training Corpus Diagnosis',
    `Cases: ${validation.eventDates}`,
    `Event corpus ready: ${validation.eventReadyDates}/${validation.eventDates}`,
    `Forecast corpus ready: ${validation.forecastCompleteDates}/${validation.forecastEligibleDates} eligible`,
    `Integrity: ${validation.valid ? 'PASS' : 'FAIL'}`,
    ''
  ];

  if (validation.eventIncomplete.length) {
    lines.push('Event corpus cases needing acquisition:');
    for (const item of validation.eventIncomplete) lines.push(`${item.eventDate}  missing=${item.missing.join(', ')}`);
  } else {
    lines.push('Event corpus: all cases ready.');
  }

  if (validation.forecastIncomplete.length) {
    lines.push('', 'Forecast-eligible cases needing data:');
    for (const item of validation.forecastIncomplete) lines.push(`${item.eventDate}  missing=${item.missing.join(', ')}`);
  } else {
    lines.push('', 'Forecast corpus: all eligible cases ready.');
  }

  const historicalEventOnly = validation.cases.filter(item => item.eventTraining.complete && !item.forecastTraining.eligible);
  lines.push('', `Historical event-only cases: ${historicalEventOnly.length} (SPC target not required)`);
  return { ...validation, text: lines.join('\n') };
}

export async function repairTrainingCorpus(options = {}) {
  await pairTrainingCorpus({ ...options, quiet: true });
  const diagnosis = await diagnoseTrainingCorpus(options);
  const era5Dates = diagnosis.eventIncomplete.filter(item => item.missing.includes('era5Atmosphere')).map(item => item.eventDate);
  const noaaDates = diagnosis.eventIncomplete.filter(item => item.missing.includes('noaaOutcomes')).map(item => item.eventDate);
  const spatialDates = diagnosis.forecastIncomplete.filter(item => item.missing.includes('era5Spatial')).map(item => item.eventDate);
  const commands = [];
  if (era5Dates.length) commands.push(`npm run training:acquire-era5 -- --dates ${era5Dates.join(',')} --missing-only`);
  if (noaaDates.length) commands.push(`npm run training:acquire-noaa -- --dates ${noaaDates.join(',')} --missing-only`);
  if (spatialDates.length) commands.push(`npm run training:acquire-era5 -- --dates ${spatialDates.join(',')} --missing-only`);
  return {
    repairedManifests: true,
    era5Dates,
    noaaDates,
    spatialDates,
    commands,
    diagnosis,
    text: [
      'Dual Training Corpus Repair Plan',
      'Paired manifests and status files refreshed.',
      `ERA5 acquisition dates: ${era5Dates.length}`,
      `NOAA acquisition dates: ${noaaDates.length}`,
      `Forecast spatial rebuild dates: ${spatialDates.length}`,
      ...(commands.length ? ['', 'Suggested commands:', ...commands.map(command => `- ${command}`)] : ['', 'No repair actions are required.'])
    ].join('\n')
  };
}

export async function runTrainingCorpusCommand(command = 'status', options = {}) {
  const paths = await ensureTrainingLayout(options.root ?? 'training', options.cacheRoot, { createExternalCache: command === 'init' });
  if (command === 'init') {
    await writeJson('training.config.json', {
      schemaVersion: '2.38.0',
      trainingRoot: options.root ?? 'training',
      cacheRoot: paths.cacheRoot,
      rawFilesStoredInRepository: false
    });
    return { message: `Training corpus initialized at ${paths.root}\nExternal cache: ${paths.cacheRoot}` };
  }
  if (command === 'status') return getTrainingCorpusStatus(options);
  if (command === 'validate') return validateTrainingCorpus(options);
  if (command === 'diagnose') return diagnoseTrainingCorpus(options);
  if (command === 'repair') return repairTrainingCorpus(options);
  if (command === 'migrate') {
    if (!options.from) throw new TypeError('training:migrate requires --from <legacy normalized SPC directory>');
    const result = await copyJsonTree(options.from, paths.spcTargets, { overwrite: options.overwrite });
    return { message: `Migrated SPC targets: ${result.copied} copied, ${result.skipped} unchanged.`, result };
  }
  throw new RangeError(`Unknown training corpus command: ${command}`);
}

function inferMissing(item) {
  return [
    ...(!item.completeness?.spc ? ['spcTargets'] : []),
    ...(!item.completeness?.era5 ? ['era5Atmosphere'] : []),
    ...(!item.completeness?.noaa ? ['noaaOutcomes'] : [])
  ];
}

function parseArgs(values) {
  const out = { root: 'training', overwrite: false };
  for (let i = 0; i < values.length; i += 1) {
    if (values[i] === '--root') out.root = values[++i];
    else if (values[i] === '--cache-root') out.cacheRoot = values[++i];
    else if (values[i] === '--from') out.from = values[++i];
    else if (values[i] === '--overwrite') out.overwrite = true;
    else throw new TypeError(`Unknown argument: ${values[i]}`);
  }
  return out;
}

function printResult(command, result) {
  if (result.message) console.log(result.message);
  else if (command === 'diagnose' || command === 'repair') console.log(result.text);
  else if (command === 'validate') {
    console.log(JSON.stringify({
      valid: result.valid,
      eventCorpusComplete: result.eventCorpusComplete,
      forecastCorpusComplete: result.forecastCorpusComplete,
      eventDates: result.eventDates,
      eventReadyDates: result.eventReadyDates,
      forecastEligibleDates: result.forecastEligibleDates,
      forecastCompleteDates: result.forecastCompleteDates,
      eventIncomplete: result.eventIncomplete,
      forecastIncomplete: result.forecastIncomplete,
      integrityIssues: result.integrityIssues
    }, null, 2));
  } else {
    console.log(JSON.stringify({
      totals: result.totals,
      stages: result.stages,
      repositoryDataBytes: result.repositoryDataBytes,
      cacheRoot: result.cacheRoot
    }, null, 2));
  }
}

function isDirectExecution() {
  return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
}

if (isDirectExecution()) {
  const [command = 'status', ...rest] = process.argv.slice(2);
  runTrainingCorpusCommand(command, parseArgs(rest))
    .then(result => printResult(command, result))
    .catch(error => {
      console.error(error);
      process.exitCode = 1;
    });
}
