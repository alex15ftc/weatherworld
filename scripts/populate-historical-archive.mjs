#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

class StageError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.name = 'StageError';
    this.code = code;
  }
}

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args.root ?? 'data/historical');
const dates = await resolveDates(args);
const forecastDays = normalizeDays(args.days ?? 'day1');
const downloadConcurrency = args.downloadConcurrency ?? args.concurrency ?? 4;
const normalizeConcurrency = args.normalizeConcurrency ?? Math.max(1, Math.min(4, args.concurrency ?? 4));
const pipelineConcurrency = args.pipelineConcurrency ?? Math.max(1, args.concurrency ?? 4);
const startedAt = Date.now();

await mkdir(path.join(root, 'raw', 'spc'), { recursive: true });
await mkdir(path.join(root, 'normalized', 'spc'), { recursive: true });

const jobs = dates.map(date => {
  const compact = date.replaceAll('-', '');
  const rawRoot = path.join(root, 'raw', 'spc', compact);
  return { date, rawRoot, manifest: path.join(rawRoot, 'manifest.json'), fetch: null, normalize: null };
});

console.log('Historical training population 2.35.0');
console.log(`Dates: ${dates.length}; products: ${forecastDays.join(', ')}`);
console.log(`Concurrency: downloads=${downloadConcurrency}, normalization=${normalizeConcurrency}, pipeline=${pipelineConcurrency}`);
console.log(`Failure mode: ${args.failFast ? 'fail-fast' : 'continue and summarize'}`);

console.log('\nStage 1/3 — acquiring SPC products');
let acquireCompleted = 0;
await runPool(jobs, downloadConcurrency, async job => {
  const fetchArgs = [
    args.fetchScript ?? 'scripts/fetch-spc-outlooks.mjs', '--start', job.date, '--end', job.date,
    '--days', forecastDays.join(','), '--output', job.rawRoot, '--manifest', job.manifest,
    '--concurrency', String(args.requestConcurrency ?? 4), '--retries', String(args.retries ?? 4),
    '--timeout-ms', String(args.timeoutMs ?? 30000)
  ];
  if (args.force) fetchArgs.push('--overwrite');
  job.fetch = await runNode(fetchArgs, { quiet: args.quietChildren });
  printProgress('Acquire', ++acquireCompleted, jobs.length, startedAt, `${job.date} ${statusLabel(job.fetch.code)}`);
  if (job.fetch.code !== 0) {
    printChildFailure('Acquisition', job.date, job.fetch);
    if (args.failFast) throw new StageError(`Acquisition failed for ${job.date}`, job.fetch.code);
  }
});
printStageSummary('Acquisition', jobs.map(job => ({ key: job.date, result: job.fetch })));

const normalizable = [];
for (const job of jobs) {
  if (job.fetch?.code === 0 && await exists(job.manifest)) normalizable.push(job);
  else job.normalize = { code: 1, skipped: true, reason: 'manifest unavailable' };
}

console.log(`\nStage 2/3 — normalizing ${normalizable.length} acquisition manifests`);
let normalizeCompleted = 0;
await runPool(normalizable, normalizeConcurrency, async job => {
  job.normalize = await runNode([
    args.parseScript ?? 'scripts/parse-spc-outlooks.mjs', '--manifest', job.manifest,
    '--output', path.join(root, 'normalized', 'spc')
  ], { quiet: args.quietChildren });
  printProgress('Normalize', ++normalizeCompleted, normalizable.length, startedAt, `${job.date} ${statusLabel(job.normalize.code)}`);
  if (job.normalize.code !== 0) {
    printChildFailure('Normalization', job.date, job.normalize);
    if (args.failFast) throw new StageError(`Normalization failed for ${job.date}`, job.normalize.code);
  }
});
printStageSummary('Normalization', jobs.map(job => ({ key: job.date, result: job.normalize })));

console.log('\nStage 3/3 — validating normalized training records');
const build = await runNode([
  args.pipelineScript ?? 'scripts/historical-pipeline.mjs', '--stage', 'build', '--root', root,
  '--input', path.join(root, 'normalized', 'spc'), '--concurrency', String(pipelineConcurrency),
  '--progress', '--write-reports'
], { quiet: false });
if (build.code !== 0) printChildFailure('Historical pipeline', 'archive build', build);

const failures = collectFailures(jobs, build);
const elapsedMs = Date.now() - startedAt;
const summary = {
  schemaVersion: '2.35.0',
  generatedAt: new Date().toISOString(),
  root,
  requestedDates: dates,
  forecastDays,
  force: args.force,
  failureMode: args.failFast ? 'fail-fast' : 'continue-and-summarize',
  concurrency: { downloads: downloadConcurrency, normalization: normalizeConcurrency, pipeline: pipelineConcurrency },
  reports: jobs,
  build,
  failures,
  counts: {
    requestedDates: jobs.length,
    acquisitionSucceeded: jobs.filter(job => job.fetch?.code === 0).length,
    acquisitionFailed: jobs.filter(job => job.fetch?.code !== 0).length,
    normalizationSucceeded: jobs.filter(job => job.normalize?.code === 0).length,
    normalizationFailedOrSkipped: jobs.filter(job => job.normalize?.code !== 0).length,
    totalFailures: failures.length
  },
  elapsedMs,
  elapsedSeconds: Number((elapsedMs / 1000).toFixed(2)),
  success: failures.length === 0
};
const reportPath = path.join(root, 'population-report.json');
await writeFile(reportPath, `${JSON.stringify(summary, null, 2)}\n`);

console.log(`\nCompleted in ${formatDuration(elapsedMs)}. Population report: ${path.relative(process.cwd(), reportPath)}`);
printFinalFailureSummary(failures);
if (!summary.success) process.exitCode = 1;

async function runPool(items, concurrency, worker) {
  let cursor = 0;
  let firstError = null;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length || firstError) return;
      try {
        await worker(items[index], index);
      } catch (error) {
        firstError ??= error;
      }
    }
  });
  await Promise.all(runners);
  if (firstError) throw firstError;
}

function printProgress(label, completed, total, start, detail = '') {
  const pct = total ? Math.round((completed / total) * 100) : 100;
  const elapsed = Date.now() - start;
  const rate = completed / Math.max(elapsed / 1000, 0.001);
  const remainingMs = rate > 0 ? ((total - completed) / rate) * 1000 : 0;
  console.log(`[${label}] ${completed}/${total} (${pct}%) | elapsed ${formatDuration(elapsed)} | ETA ${formatDuration(remainingMs)}${detail ? ` | ${detail}` : ''}`);
}

function printStageSummary(label, entries) {
  const succeeded = entries.filter(entry => entry.result?.code === 0).length;
  const skipped = entries.filter(entry => entry.result?.skipped).length;
  const failed = entries.length - succeeded - skipped;
  console.log(`${label} summary: ${succeeded} succeeded, ${failed} failed, ${skipped} skipped.`);
}

function printChildFailure(stage, key, result) {
  console.error(`\n[${stage} failure] ${key}`);
  console.error(`Exit code: ${result?.code ?? 1}`);
  if (result?.command) console.error(`Command: ${result.command}`);
  const stderr = result?.stderr?.trim();
  const stdout = result?.stdout?.trim();
  if (stderr) console.error(`stderr:\n${stderr}`);
  if (stdout) console.error(`stdout:\n${stdout}`);
  if (!stderr && !stdout) console.error('The child process did not return captured output. Re-run with --verbose-children for live output.');
}

function collectFailures(items, build) {
  const failures = [];
  for (const job of items) {
    if (job.fetch?.code !== 0) {
      failures.push({ stage: 'acquisition', date: job.date, code: job.fetch?.code ?? 1, reason: job.fetch?.reason ?? 'SPC acquisition failed' });
      continue;
    }
    if (job.normalize?.code !== 0) {
      failures.push({ stage: 'normalization', date: job.date, code: job.normalize?.code ?? 1, reason: job.normalize?.reason ?? 'SPC normalization failed' });
    }
  }
  if (build?.code !== 0) failures.push({ stage: 'pipeline', date: null, code: build?.code ?? 1, reason: 'Historical training-corpus validation failed' });
  return failures;
}

function printFinalFailureSummary(failures) {
  if (!failures.length) {
    console.log('All requested dates and pipeline stages completed successfully.');
    return;
  }
  console.error(`\nPopulation completed with ${failures.length} failure${failures.length === 1 ? '' : 's'}:`);
  for (const failure of failures) {
    console.error(`- ${failure.stage}${failure.date ? ` ${failure.date}` : ''}: ${failure.reason} (exit ${failure.code})`);
  }
  console.error('Successful dates remain in the archive. Fix the reported failures and rerun the same command to resume.');
}

function statusLabel(code) { return code === 0 ? 'done' : `failed(${code})`; }
function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

async function resolveDates(options) {
  if (options.retryFailed) {
    const reportPath = path.join(path.resolve(options.root ?? 'data/historical'), 'population-report.json');
    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    const failedDates = (report.failures ?? []).map(item => item.date).filter(Boolean);
    if (!failedDates.length) throw new TypeError(`No failed dates were found in ${reportPath}`);
    if (!options.days && report.forecastDays) options.days = Array.isArray(report.forecastDays) ? report.forecastDays.join(',') : report.forecastDays;
    return uniqueSorted(failedDates.map(normalizeDate));
  }
  if (options.manifest) {
    const payload = JSON.parse(await readFile(path.resolve(options.manifest), 'utf8'));
    const values = payload.dates ?? payload.requestedDates;
    if (!Array.isArray(values) || !values.length) throw new TypeError('Population manifest must contain a non-empty dates array');
    if (!options.days && payload.days) options.days = Array.isArray(payload.days) ? payload.days.join(',') : payload.days;
    return uniqueSorted(values.map(normalizeDate));
  }
  if (options.dates) return uniqueSorted(options.dates.split(',').map(normalizeDate));
  if (!options.start) throw new TypeError('Usage: npm run historical:populate -- --dates YYYY-MM-DD,... | --start YYYY-MM-DD [--end YYYY-MM-DD]');
  const start = normalizeDate(options.start);
  const end = normalizeDate(options.end ?? options.start);
  if (end < start) throw new TypeError('--end must not precede --start');
  const values = [];
  for (let cursor = new Date(`${start}T00:00:00Z`); cursor <= new Date(`${end}T00:00:00Z`); cursor.setUTCDate(cursor.getUTCDate() + 1)) values.push(cursor.toISOString().slice(0, 10));
  return values;
}

function parseArgs(tokens) {
  const out = { force: false, failFast: false, quietChildren: true, retryFailed: false };
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith('--')) throw new TypeError(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    if (key === 'force') out.force = true;
    else if (key === 'retry-failed') out.retryFailed = true;
    else if (key === 'fail-fast') out.failFast = true;
    else if (key === 'continue-on-error') out.failFast = false;
    else if (key === 'verbose-children') out.quietChildren = false;
    else if (['timeout-ms','concurrency','download-concurrency','normalize-concurrency','pipeline-concurrency','request-concurrency'].includes(key)) out[toCamel(key)] = positiveInteger(tokens[++index], `--${key}`);
    else if (key === 'retries') out.retries = nonNegativeInteger(tokens[++index], '--retries');
    else out[toCamel(key)] = tokens[++index];
  }
  return out;
}

function toCamel(value) { return value.replace(/-([a-z])/g, (_, char) => char.toUpperCase()); }
function normalizeDays(value) {
  const allowed = new Set(['day1','day2','day3']);
  const days = String(value).split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
  for (const day of days) if (!allowed.has(day)) throw new TypeError(`Unsupported forecast day: ${day}`);
  return [...new Set(days)];
}
function normalizeDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value)) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new TypeError(`Invalid date: ${value}`);
  return value;
}
function uniqueSorted(values) { return [...new Set(values)].sort(); }
function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new TypeError(`${label} must be positive`);
  return number;
}
function nonNegativeInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new TypeError(`${label} must be non-negative`);
  return number;
}
async function exists(target) {
  try { await access(target); return true; }
  catch { return false; }
}
function runNode(argv, { quiet = false } = {}) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, argv, { cwd: process.cwd(), stdio: quiet ? ['ignore','pipe','pipe'] : 'inherit' });
    let stdout = '';
    let stderr = '';
    if (quiet) {
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
    }
    child.once('error', reject);
    child.once('exit', code => resolve({
      code: code ?? 1,
      command: [process.execPath, ...argv].join(' '),
      elapsedMs: Date.now() - started,
      stdout: quiet ? stdout.slice(-12000) : undefined,
      stderr: quiet ? stderr.slice(-12000) : undefined
    }));
  });
}
