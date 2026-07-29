import path from 'node:path';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { createHash } from 'node:crypto';

export const ACQUISITION_SCHEMA_VERSION = '2.36.1';
export const ACQUISITION_STATES = Object.freeze([
  'missing', 'queued', 'downloading', 'downloaded', 'extracting', 'complete', 'warning', 'failed'
]);

export function createCaseAcquisition(date, previous = {}) {
  return {
    eventDate: date,
    updatedAt: previous.updatedAt ?? null,
    spc: normalizeStage(previous.spc, 'missing'),
    era5Raw: normalizeStage(previous.era5Raw, 'missing'),
    era5Extracted: normalizeStage(previous.era5Extracted, 'missing'),
    noaa: normalizeStage(previous.noaa, 'missing'),
    paired: normalizeStage(previous.paired, 'missing'),
    eligibleForTraining: Boolean(previous.eligibleForTraining),
    attempts: Number(previous.attempts ?? 0),
    errors: Array.isArray(previous.errors) ? previous.errors : []
  };
}

export function normalizeStage(value, fallback = 'missing') {
  const stage = typeof value === 'string' ? { status: value } : (value ?? {});
  const status = ACQUISITION_STATES.includes(stage.status) ? stage.status : fallback;
  return {
    status,
    updatedAt: stage.updatedAt ?? null,
    message: stage.message ?? null,
    files: Array.isArray(stage.files) ? stage.files : [],
    checksum: stage.checksum ?? null
  };
}

export function setStage(record, key, status, details = {}) {
  if (!ACQUISITION_STATES.includes(status)) throw new RangeError(`Invalid acquisition status: ${status}`);
  const now = details.updatedAt ?? new Date().toISOString();
  record[key] = normalizeStage({ ...record[key], ...details, status, updatedAt: now });
  record.updatedAt = now;
  if (status === 'failed') {
    record.attempts = Number(record.attempts ?? 0) + 1;
    if (details.message) record.errors = [...(record.errors ?? []), { stage: key, at: now, message: details.message }].slice(-20);
  }
  record.eligibleForTraining = ['complete', 'warning'].includes(record.spc.status)
    && record.era5Extracted.status === 'complete'
    && record.noaa.status === 'complete';
  return record;
}

export function planAcquisition({ dates, cases = {}, missingOnly = false, include = ['era5', 'noaa'] }) {
  const tasks = [];
  for (const date of [...new Set(dates)].sort()) {
    const item = createCaseAcquisition(date, cases[date]);
    if (include.includes('era5')) {
      const shouldQueue = !missingOnly || !['complete', 'downloading', 'extracting'].includes(item.era5Extracted.status);
      if (shouldQueue) tasks.push({ date, source: 'era5', action: item.era5Raw.status === 'downloaded' ? 'extract' : 'download-and-extract' });
    }
    if (include.includes('noaa')) {
      const shouldQueue = !missingOnly || item.noaa.status !== 'complete';
      if (shouldQueue) tasks.push({ date, source: 'noaa', action: 'download-year-and-extract' });
    }
  }
  return tasks;
}

export async function loadAcquisitionCatalog(filePath) {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8'));
    return { schemaVersion: ACQUISITION_SCHEMA_VERSION, generatedAt: parsed.generatedAt ?? null, cases: parsed.cases ?? {} };
  } catch (error) {
    if (error?.code === 'ENOENT') return { schemaVersion: ACQUISITION_SCHEMA_VERSION, generatedAt: null, cases: {} };
    throw error;
  }
}

export async function saveAcquisitionCatalog(filePath, catalog) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const payload = { ...catalog, schemaVersion: ACQUISITION_SCHEMA_VERSION, generatedAt: new Date().toISOString() };
  const temp = `${filePath}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(payload, null, 2)}\n`);
  await rename(temp, filePath);
  return payload;
}

export async function sha256File(filePath) {
  const buffer = await readFile(filePath);
  return createHash('sha256').update(buffer).digest('hex');
}

export async function fileExists(filePath) {
  try { await access(filePath, fsConstants.F_OK); return true; } catch { return false; }
}

export function summarizeAcquisition(catalog) {
  const records = Object.values(catalog.cases ?? {});
  const count = key => records.filter(record => record[key]?.status === 'complete').length;
  const countAvailable = key => records.filter(record => ['downloaded', 'complete'].includes(record[key]?.status)).length;
  return {
    cases: records.length,
    spc: count('spc'),
    era5Raw: countAvailable('era5Raw'),
    era5Extracted: count('era5Extracted'),
    noaa: count('noaa'),
    paired: count('paired'),
    ready: records.filter(record => record.eligibleForTraining).length,
    failed: records.filter(record => Object.values(record).some(value => value?.status === 'failed')).length
  };
}
