import path from 'node:path';
import os from 'node:os';
import { access, mkdir, readdir, readFile, stat, writeFile, copyFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';

export const TRAINING_CORPUS_VERSION = '2.38.1';
export const DEFAULT_TRAINING_ROOT = 'training';

export function resolveCacheRoot(explicit = null) {
  const configured = explicit || process.env.WEATHERWORLD_TRAINING_CACHE;
  if (configured) return path.resolve(configured);
  return path.join(os.homedir(), 'WeatherWorldTrainingCache');
}

export function trainingPaths(root = DEFAULT_TRAINING_ROOT, cacheRoot = null) {
  const base = path.resolve(root);
  const cache = resolveCacheRoot(cacheRoot);
  return Object.freeze({
    root: base,
    catalog: path.join(base, 'catalog'),
    casesCatalog: path.join(base, 'catalog', 'cases.json'),
    progress: path.join(base, 'catalog', 'progress.json'),
    statistics: path.join(base, 'catalog', 'statistics.json'),
    targets: path.join(base, 'targets'),
    spcTargets: path.join(base, 'targets', 'spc'),
    atmosphere: path.join(base, 'atmospheric'),
    era5: path.join(base, 'atmospheric', 'era5'),
    era5Derived: path.join(base, 'atmospheric', 'era5', 'derived.json'),
    noaa: path.join(base, 'atmospheric', 'noaa'),
    noaaOutcomes: path.join(base, 'atmospheric', 'noaa', 'outcomes.json'),
    paired: path.join(base, 'paired'),
    pairedCases: path.join(base, 'paired', 'cases.json'),
    validation: path.join(base, 'validation'),
    spcValidation: path.join(base, 'validation', 'spc'),
    manifest: path.join(base, 'catalog', 'manifest.json'),
    acquisition: path.join(base, 'catalog', 'acquisition.json'),
    era5Records: path.join(base, 'atmospheric', 'era5', 'records'),
    era5SpatialManifests: path.join(base, 'atmospheric', 'era5', 'spatial'),
    noaaRecords: path.join(base, 'atmospheric', 'noaa', 'records'),
    cacheRoot: cache,
    cacheSpc: path.join(cache, 'spc'),
    cacheEra5: path.join(cache, 'era5'),
    cacheEra5Raw: path.join(cache, 'era5', 'raw'),
    cacheEra5Partial: path.join(cache, 'era5', 'partial'),
    cacheEra5Spatial: path.join(cache, 'era5', 'spatial'),
    cacheNoaa: path.join(cache, 'noaa'),
    cacheNoaaBulk: path.join(cache, 'noaa', 'bulk'),
    cacheTmp: path.join(cache, 'tmp')
  });
}

export async function ensureTrainingLayout(root = DEFAULT_TRAINING_ROOT, cacheRoot = null, { createExternalCache = false } = {}) {
  const paths = trainingPaths(root, cacheRoot);
  const repositoryDirs = [paths.catalog, paths.spcTargets, paths.era5, paths.era5Records, paths.era5SpatialManifests, paths.noaa, paths.noaaRecords, paths.paired, paths.spcValidation];
  await Promise.all(repositoryDirs.map(dir => mkdir(dir, { recursive: true })));
  if (createExternalCache) await Promise.all([paths.cacheSpc, paths.cacheEra5, paths.cacheEra5Raw, paths.cacheEra5Partial, paths.cacheEra5Spatial, paths.cacheNoaa, paths.cacheNoaaBulk, paths.cacheTmp].map(dir => mkdir(dir, { recursive: true })));
  return paths;
}

export async function listJsonFilesRecursive(root, { exclude = ['parse-summary.json', 'manifest.json', 'progress.json', 'statistics.json'] } = {}) {
  if (!(await isDirectory(root))) return [];
  const files = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name.endsWith('.json') && !exclude.includes(entry.name)) files.push(full);
    }
  }
  await walk(root);
  return files.sort();
}

export async function copyJsonTree(sourceRoot, destinationRoot, { overwrite = false } = {}) {
  const files = await listJsonFilesRecursive(sourceRoot);
  let copied = 0;
  let skipped = 0;
  for (const source of files) {
    const relative = path.relative(sourceRoot, source);
    const destination = path.join(destinationRoot, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    if (!overwrite && await exists(destination)) { skipped += 1; continue; }
    await copyFile(source, destination);
    copied += 1;
  }
  return { copied, skipped, total: files.length };
}

export async function writeJson(filePath, payload) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

export async function readJsonIfExists(filePath, fallback = null) {
  try { return JSON.parse(await readFile(filePath, 'utf8')); } catch (error) { if (error?.code === 'ENOENT') return fallback; throw error; }
}


export async function readDateRecordMap(directory) {
  const files = (await listJsonFilesRecursive(directory)).filter(file => /^\d{4}-\d{2}-\d{2}\.json$/.test(path.basename(file)));
  const entries = await Promise.all(files.map(async file => {
    const record = await readJsonIfExists(file, null);
    const eventDate = record?.eventDate ?? path.basename(file, '.json');
    return eventDate && record ? [eventDate, record] : null;
  }));
  return Object.fromEntries(entries.filter(Boolean));
}

export async function readNoaaRecordCatalog(directory) {
  const byDate = await readDateRecordMap(directory);
  return {
    schemaVersion: TRAINING_CORPUS_VERSION,
    records: Object.values(byDate).map(record => ({
      analogId: `us-${record.eventDate}`,
      eventDate: record.eventDate,
      season: seasonForDate(record.eventDate),
      intensity: {
        score: null,
        band: null,
        reportCount: record.reportCount ?? record.reports?.length ?? 0,
        counts: record.counts ?? {}
      },
      outcomes: record.counts ?? {},
      reports: record.reports ?? [],
      provenance: record.provenance ?? { reports: record.source ?? 'NOAA NCEI Storm Events' }
    })).sort((a, b) => a.eventDate.localeCompare(b.eventDate))
  };
}

function seasonForDate(eventDate) {
  const month = Number(String(eventDate).slice(5, 7));
  return month <= 2 || month === 12 ? 'winter' : month <= 5 ? 'spring' : month <= 8 ? 'summer' : 'fall';
}

export async function buildCorpusProgress(paths, { generatedAt = new Date().toISOString() } = {}) {
  const [spcCatalog, paired, era5Aggregate, noaaAggregate, era5Records, noaaRecordCatalog, spatialFiles] = await Promise.all([
    readJsonIfExists(paths.casesCatalog, { records: [] }),
    readJsonIfExists(paths.pairedCases, { cases: [] }),
    readJsonIfExists(paths.era5Derived, {}),
    readJsonIfExists(paths.noaaOutcomes, { records: [] }),
    readDateRecordMap(paths.era5Records),
    readNoaaRecordCatalog(paths.noaaRecords),
    listJsonFilesRecursive(paths.era5SpatialManifests)
  ]);
  const era5 = { ...era5Aggregate, ...era5Records };
  const noaaByDate = new Map([...(noaaAggregate.records ?? []), ...(noaaRecordCatalog.records ?? [])].map(record => [record.eventDate, record]));
  const noaa = { ...noaaAggregate, records: [...noaaByDate.values()].sort((a, b) => a.eventDate.localeCompare(b.eventDate)) };
  const allDates = new Set([
    ...(spcCatalog.records ?? []).map(record => record.eventDate),
    ...Object.keys(era5 ?? {}),
    ...(noaa.records ?? []).map(record => record.eventDate)
  ].filter(Boolean));
  const cases = paired.cases ?? [];
  const progress = {
    schemaVersion: TRAINING_CORPUS_VERSION,
    generatedAt,
    cacheRoot: paths.cacheRoot,
    totals: {
      eventDates: allDates.size,
      spcIssuances: (spcCatalog.records ?? []).length,
      spcDates: new Set((spcCatalog.records ?? []).map(record => record.eventDate).filter(Boolean)).size,
      era5Dates: Object.keys(era5 ?? {}).length,
      era5SpatialDates: spatialFiles.length,
      noaaDates: (noaa.records ?? []).length,
      pairedDates: cases.length,
      completeDates: cases.filter(item => item.status === 'complete').length
    },
    stages: {
      spcTargets: stageSummary(new Set((spcCatalog.records ?? []).map(record => record.eventDate).filter(Boolean)).size, allDates.size),
      era5Atmosphere: stageSummary(Object.keys(era5 ?? {}).length, allDates.size),
      era5Spatial: stageSummary(spatialFiles.length, allDates.size),
      noaaOutcomes: stageSummary((noaa.records ?? []).length, allDates.size),
      paired: stageSummary(cases.filter(item => item.status === 'complete').length, allDates.size)
    }
  };
  return progress;
}

export async function writeCorpusStatus(paths) {
  const progress = await buildCorpusProgress(paths);
  const stats = {
    schemaVersion: TRAINING_CORPUS_VERSION,
    generatedAt: progress.generatedAt,
    ...progress.totals,
    repositoryDataBytes: await directorySize(paths.root)
  };
  await Promise.all([writeJson(paths.progress, progress), writeJson(paths.statistics, stats)]);
  return { progress, stats };
}

function stageSummary(completed, total) {
  return { completed, total, percent: total ? Number((completed / total * 100).toFixed(2)) : 0 };
}

async function directorySize(root) {
  if (!(await exists(root))) return 0;
  let total = 0;
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) total += (await stat(full)).size;
    }
  }
  await walk(root);
  return total;
}
async function exists(filePath) { try { await access(filePath, fsConstants.F_OK); return true; } catch { return false; } }
async function isDirectory(filePath) { try { return (await stat(filePath)).isDirectory(); } catch { return false; } }
