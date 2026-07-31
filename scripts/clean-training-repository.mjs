#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { createHash } from 'node:crypto';
import { access, readdir, readFile, rm, stat } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ensureTrainingLayout, writeCorpusStatus } from '../js/training/TrainingCorpusManager.js';
import { pairTrainingCorpus } from './pair-training-corpus.mjs';

export async function cleanTrainingRepository(paths, options = {}) {
  const dryRun = Boolean(options.dryRun);
  const deep = Boolean(options.deep || options.vacuum);
  const removed = [];
  const duplicateCandidates = [];
  let bytesRecovered = 0;

  const junkRoots = [paths.root];
  for (const root of junkRoots) {
    for (const file of await walkFiles(root)) {
      if (isSafeJunk(file)) {
        const size = (await stat(file)).size;
        removed.push(file); bytesRecovered += size;
        if (!dryRun) await rm(file, { force: true });
      }
    }
  }

  // Remove only explicitly regenerable cache areas in deep mode.
  if (deep) {
    for (const dir of [paths.cacheTmp, paths.cacheEra5Partial]) {
      if (!(await exists(dir))) continue;
      const size = await directorySize(dir);
      removed.push(dir); bytesRecovered += size;
      if (!dryRun) await rm(dir, { recursive: true, force: true });
    }
  }

  // Safe duplicate cleanup: only common copy-name variants whose bytes exactly
  // match the canonical sibling. Semantic files with different names are never removed.
  for (const root of [paths.root, ...(deep ? [paths.cacheRoot] : [])]) {
    if (!(await exists(root))) continue;
    for (const file of await walkFiles(root)) {
      const canonical = canonicalSibling(file);
      if (!canonical || !(await exists(canonical))) continue;
      if ((await stat(file)).size !== (await stat(canonical)).size) continue;
      if (await sha256(file) !== await sha256(canonical)) continue;
      duplicateCandidates.push({ duplicate: file, canonical });
      const size = (await stat(file)).size;
      removed.push(file); bytesRecovered += size;
      if (!dryRun) await rm(file, { force: true });
    }
  }

  let rebuilt = false;
  let validation = null;
  if (!dryRun && (options.rebuild || options.vacuum)) {
    await pairTrainingCorpus({ root: paths.root, cacheRoot: paths.cacheRoot, quiet: true });
    await writeCorpusStatus(paths);
    rebuilt = true;
    const { validateTrainingCorpus } = await import('./training-corpus.mjs');
    validation = await validateTrainingCorpus({ root: paths.root, cacheRoot: paths.cacheRoot });
  }

  return { removed, duplicateCandidates, bytesRecovered, rebuilt, validation };
}

function isSafeJunk(file) {
  const name = path.basename(file).toLowerCase();
  const parts = file.split(path.sep).map(part => part.toLowerCase());
  return name.endsWith('.pyc') || name.endsWith('.pyo') || name.endsWith('.rej') ||
    name.endsWith('.orig') || name.endsWith('.tmp') || name.endsWith('~') ||
    parts.includes('__pycache__');
}

function canonicalSibling(file) {
  const dir = path.dirname(file);
  const ext = path.extname(file);
  const stem = path.basename(file, ext);
  const patterns = [
    /^(.*) \(\d+\)$/i,
    /^(.*)[ _-]copy(?: \(\d+\))?$/i,
    /^(.*)[._-]duplicate(?:\d+)?$/i
  ];
  for (const pattern of patterns) {
    const match = stem.match(pattern);
    if (match?.[1]) return path.join(dir, `${match[1]}${ext}`);
  }
  return null;
}

async function walkFiles(root) {
  if (!(await exists(root))) return [];
  const files = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) files.push(full);
    }
  }
  await walk(root);
  return files;
}

async function sha256(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex');
}
async function directorySize(root) {
  let total = 0;
  for (const file of await walkFiles(root)) total += (await stat(file)).size;
  return total;
}
async function exists(file) { try { await access(file, fsConstants.F_OK); return true; } catch { return false; } }

function parseArgs(values) {
  const out = { root: 'training', dryRun: false, deep: false, rebuild: false, vacuum: false };
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (value === '--root') out.root = values[++i];
    else if (value === '--cache-root') out.cacheRoot = values[++i];
    else if (value === '--dry-run') out.dryRun = true;
    else if (value === '--deep') out.deep = true;
    else if (value === '--rebuild') out.rebuild = true;
    else if (value === '--vacuum') out.vacuum = true;
    else throw new TypeError(`Unknown argument: ${value}`);
  }
  return out;
}

function printReport(report, args) {
  console.log(`Training Repository Cleanup${args.dryRun ? ' (dry run)' : ''}`);
  console.log(`Files/directories removed: ${report.removed.length}`);
  console.log(`Verified duplicate copies removed: ${report.duplicateCandidates.length}`);
  console.log(`Disk space recovered: ${formatBytes(report.bytesRecovered)}`);
  console.log(`Indexes rebuilt: ${report.rebuilt ? 'yes' : 'no'}`);
  if (report.validation) {
    console.log(`Integrity: ${report.validation.valid ? 'PASS' : 'FAIL'}`);
    console.log(`Event corpus: ${report.validation.eventReadyDates}/${report.validation.eventDates}`);
    console.log(`Forecast corpus: ${report.validation.forecastCompleteDates}/${report.validation.forecastEligibleDates}`);
  }
  if (args.dryRun && report.removed.length) console.log('\nRun without --dry-run to apply these removals.');
}
function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes; let index = 0;
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index += 1; }
  return `${value.toFixed(index ? 2 : 0)} ${units[index]}`;
}

function isDirectExecution() {
  return process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
}

if (isDirectExecution()) {
  const args = parseArgs(process.argv.slice(2));
  const paths = await ensureTrainingLayout(args.root, args.cacheRoot, { createExternalCache: false });
  const report = await cleanTrainingRepository(paths, args);
  printReport(report, args);
}
