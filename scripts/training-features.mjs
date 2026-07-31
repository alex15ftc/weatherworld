#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TRAINING = path.join(ROOT, 'training');
const ERA5_RECORDS = path.join(TRAINING, 'atmospheric', 'era5', 'records');
const NOAA_RECORDS = path.join(TRAINING, 'atmospheric', 'noaa', 'records');
const NOAA_AGGREGATE = path.join(TRAINING, 'atmospheric', 'noaa', 'outcomes.json');
const PAIRED = path.join(TRAINING, 'paired', 'cases.json');
const FEATURES = path.join(TRAINING, 'features');
const FEATURE_RECORDS = path.join(FEATURES, 'records');
const INDEX = path.join(FEATURES, 'index.json');
const NORMALIZATION = path.join(FEATURES, 'normalization.json');

const FEATURE_SCHEMA_VERSION = '2.39.1';
const ERA5_SPATIAL_MANIFESTS = path.join(TRAINING, 'atmospheric', 'era5', 'spatial');
const SPATIAL_DIAGNOSTICS = path.join(FEATURES, 'spatial-diagnostics.json');
const EPSILON = 1e-9;

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function finite(value, fallback = 0) { return Number.isFinite(Number(value)) ? Number(value) : fallback; }
function clamp(value, min = 0, max = 1) { return Math.min(max, Math.max(min, finite(value))); }
function magnitude(u, v) { return Math.hypot(finite(u), finite(v)); }
function range(stats) { return finite(stats?.p90) - finite(stats?.p10); }
function ratioAbove(stats, threshold) {
  const p10 = finite(stats?.p10); const p90 = finite(stats?.p90); const max = finite(stats?.max);
  if (max <= threshold) return 0;
  if (p10 >= threshold) return 1;
  if (p90 <= p10 + EPSILON) return clamp((max - threshold) / Math.max(Math.abs(max), 1));
  return clamp((p90 - threshold) / (p90 - p10));
}
function sha256(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function level(record, pressure) { return record.levels?.[String(pressure)] ?? {}; }
function windMean(record, pressure) { const l = level(record, pressure); return magnitude(l.u?.mean, l.v?.mean); }
function windP90(record, pressure) { const l = level(record, pressure); return magnitude(l.u?.p90, l.v?.p90); }
function vectorDifference(a, b) { return magnitude(finite(a?.u?.mean) - finite(b?.u?.mean), finite(a?.v?.mean) - finite(b?.v?.mean)); }
function angularDifferenceDeg(a, b) {
  const aDir = Math.atan2(finite(a?.v?.mean), finite(a?.u?.mean));
  const bDir = Math.atan2(finite(b?.v?.mean), finite(b?.u?.mean));
  let d = Math.abs((aDir - bDir) * 180 / Math.PI) % 360;
  return d > 180 ? 360 - d : d;
}

function extractInputs(era5) {
  const s = era5.surface ?? {};
  const l1000 = level(era5, 1000), l850 = level(era5, 850), l700 = level(era5, 700), l500 = level(era5, 500), l250 = level(era5, 250);
  const deepShear = vectorDifference(l850, l500);
  const upperShear = vectorDifference(l500, l250);
  const moistureSpread = range(s.d2m);
  const capeSpread = range(s.cape);
  const pressureSpread = range(s.msl);
  const tcwvSpread = range(s.tcwv);
  const capeCoverage1000 = ratioAbove(s.cape, 1000);
  const capeCoverage2000 = ratioAbove(s.cape, 2000);
  const moistureCorridor = clamp((finite(s.d2m?.p90) - 273.15) / 25) * clamp(1 - moistureSpread / 35);
  const pressureGradientProxy = Math.abs(pressureSpread) / 100;
  const jetStrength = windP90(era5, 250);
  const forcingOverlapProxy = Math.sqrt(clamp(capeCoverage1000) * clamp((deepShear - 5) / 35));
  const boundarySharpness = (Math.abs(moistureSpread) / 10 + pressureGradientProxy / 8 + Math.abs(tcwvSpread) / 15) / 3;

  return {
    thermodynamics: {
      capeMaxJkg: finite(s.cape?.max), capeMeanJkg: finite(s.cape?.mean), capeP90Jkg: finite(s.cape?.p90),
      cinMeanJkg: finite(s.cin?.mean), cinP90Jkg: finite(s.cin?.p90), dewpointMeanK: finite(s.d2m?.mean),
      dewpointP90K: finite(s.d2m?.p90), temperatureMeanK: finite(s.t2m?.mean), precipitableWaterMeanKgM2: finite(s.tcwv?.mean),
      lowLevelLapseProxyK: finite(l1000.t?.mean) - finite(l850.t?.mean), midLevelLapseProxyK: finite(l700.t?.mean) - finite(l500.t?.mean)
    },
    windProfile: {
      wind850MeanMs: windMean(era5, 850), wind500MeanMs: windMean(era5, 500), wind250MeanMs: windMean(era5, 250),
      wind250P90Ms: jetStrength, shear850To500Ms: deepShear, shear500To250Ms: upperShear,
      turning850To500Deg: angularDifferenceDeg(l850, l500), turning850To250Deg: angularDifferenceDeg(l850, l250)
    },
    synoptic: {
      meanSeaLevelPressurePa: finite(s.msl?.mean), pressureP10Pa: finite(s.msl?.p10), pressureRangePa: pressureSpread,
      height500MeanM2s2: finite(l500.z?.mean), height500RangeM2s2: range(l500.z), jetStrengthMs: jetStrength,
      moistureTransportProxy: windMean(era5, 850) * finite(l850.q?.mean) * 1000
    },
    spatial: {
      capeCoverage1000Proxy: capeCoverage1000, capeCoverage2000Proxy: capeCoverage2000,
      instabilityGradientProxy: capeSpread / 1000, moistureGradientProxy: moistureSpread,
      pressureGradientProxy, precipitableWaterGradientProxy: tcwvSpread, moistureCorridorStrengthProxy: moistureCorridor,
      forcingInstabilityOverlapProxy: forcingOverlapProxy, boundarySharpnessProxy: boundarySharpness,
      spatialTensorAvailable: era5.spatialRecord ? 1 : 0
    }
  };
}

function flattenNumeric(object, prefix = '', out = {}) {
  for (const [key, value] of Object.entries(object ?? {})) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'number') out[name] = value;
    else if (value && typeof value === 'object' && !Array.isArray(value)) flattenNumeric(value, name, out);
  }
  return out;
}
function unflatten(flat) {
  const result = {};
  for (const [key, value] of Object.entries(flat)) {
    const parts = key.split('.'); let cursor = result;
    for (let i = 0; i < parts.length - 1; i += 1) cursor = cursor[parts[i]] ??= {};
    cursor[parts.at(-1)] = value;
  }
  return result;
}
function percentile(sorted, p) {
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * p; const low = Math.floor(index); const high = Math.ceil(index);
  return low === high ? sorted[low] : sorted[low] + (sorted[high] - sorted[low]) * (index - low);
}
function buildNormalization(records) {
  const names = Object.keys(flattenNumeric(records[0]?.inputs?.raw ?? {}));
  const features = {};
  for (const name of names) {
    const values = records.map(r => flattenNumeric(r.inputs.raw)[name]).filter(Number.isFinite).sort((a,b)=>a-b);
    const mean = values.reduce((a,b)=>a+b,0) / Math.max(values.length,1);
    const variance = values.reduce((sum,v)=>sum+(v-mean)**2,0) / Math.max(values.length,1);
    features[name] = { count: values.length, mean, standardDeviation: Math.sqrt(variance), min: values[0] ?? null,
      max: values.at(-1) ?? null, median: percentile(values,.5), p10: percentile(values,.1), p25: percentile(values,.25), p75: percentile(values,.75), p90: percentile(values,.9) };
  }
  return { schemaVersion: FEATURE_SCHEMA_VERSION, generatedAt: new Date().toISOString(), method: 'population-z-score', featureCount: names.length, recordCount: records.length, features };
}
function normalizeInputs(raw, normalization) {
  const flat = flattenNumeric(raw), normalized = {};
  for (const [name, value] of Object.entries(flat)) {
    const stats = normalization.features[name];
    normalized[name] = stats?.standardDeviation > EPSILON ? (value - stats.mean) / stats.standardDeviation : 0;
  }
  return unflatten(normalized);
}
function buildLabels(noaa, pair) {
  const counts = noaa?.counts ?? noaa?.intensity?.counts ?? pair?.outcomes?.counts ?? pair?.outcomes?.intensity?.counts ?? {};
  const maxima = pair?.spc?.issuances?.reduce((acc, issuance) => {
    const h = issuance.hazardMaxima ?? {};
    for (const key of ['tornado','wind','hail']) acc[key] = Math.max(acc[key] ?? 0, finite(h[key]));
    const rank = {TSTM:1,MRGL:2,SLGT:3,ENH:4,MDT:5,HIGH:6};
    if ((rank[h.categorical] ?? 0) > (rank[acc.categorical] ?? 0)) acc.categorical = h.categorical;
    return acc;
  }, {}) ?? {};
  return {
    outcomes: { reportCount: finite(noaa?.reportCount ?? noaa?.intensity?.reportCount), tornadoReports: finite(counts.tornado), significantTornadoReports: finite(counts.significantTornado), violentTornadoReports: finite(counts.violentTornado), hailReports: finite(counts.hail), significantHailReports: finite(counts.significantHail), windReports: finite(counts.wind), destructiveWindReports: finite(counts.destructiveWind) },
    forecast: pair?.corpusMembership?.forecast?.complete ? { categoricalMaximum: maxima.categorical ?? null, tornadoMaximum: maxima.tornado ?? 0, windMaximum: maxima.wind ?? 0, hailMaximum: maxima.hail ?? 0 } : null
  };
}
function quality(era5, noaa, pair) {
  const checks = { era5Record: Boolean(era5), spatialManifest: Boolean(era5?.spatialRecord), diagnosticCompleteness: finite(era5?.derived?.diagnosticCompleteness, 0), noaaOutcomes: Boolean(noaa), forecastTargets: Boolean(pair?.corpusMembership?.forecast?.complete) };
  const atmosphere = (checks.era5Record ? .45 : 0) + (checks.spatialManifest ? .2 : 0) + .15 * clamp(checks.diagnosticCompleteness);
  const event = checks.noaaOutcomes ? .2 : 0;
  const score = clamp(atmosphere + event);
  return { score: Number(score.toFixed(4)), atmosphereComplete: checks.era5Record && checks.diagnosticCompleteness >= .99, spatialComplete: checks.spatialManifest, outcomesComplete: checks.noaaOutcomes, forecastTargetsAvailable: checks.forecastTargets, checks };
}
function listRecords(directory) { return fs.existsSync(directory) ? fs.readdirSync(directory).filter(f=>/^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort() : []; }

const DIRECT_SPATIAL_DEFAULTS = {
  peakTimeIndex: 0, peakTimeFraction: 0, capeCentroidX: 0.5, capeCentroidY: 0.5,
  capeCorridorOrientationDeg: 0, capeCorridorElongation: 0, capeCoverage1000Direct: 0,
  capeCoverage2000Direct: 0, capeLargestRegionFraction: 0, moistureCentroidX: 0.5, moistureCentroidY: 0.5,
  moistureAxisOrientationDeg: 0, moistureAxisElongation: 0, jetCentroidX: 0.5, jetCentroidY: 0.5,
  jetAxisOrientationDeg: 0, jetAxisElongation: 0, jetCoreP90Ms: 0, forcingCentroidX: 0.5, forcingCentroidY: 0.5,
  forcingInstabilityOverlapDirect: 0, moistureTransportOverlapDirect: 0, dewpointGradientMeanKCell: 0,
  dewpointGradientP90KCell: 0, pressureGradientMeanPaCell: 0, pressureGradientP90PaCell: 0,
  tcwvGradientMeanKgM2Cell: 0, tcwvGradientP90KgM2Cell: 0
};

function resolveCacheRoot(explicit = null) {
  return path.resolve(explicit ?? process.env.WEATHERWORLD_TRAINING_CACHE ?? path.join(os.homedir(), 'WeatherWorldTrainingCache'));
}

function extractDirectSpatialFeatures({ cacheRoot, python = null, dates = [] } = {}) {
  const output = SPATIAL_DIAGNOSTICS;
  const command = python ?? process.env.PYTHON ?? 'python';
  const args = ['scripts/extract-era5-spatial-features.py', '--manifest-root', ERA5_SPATIAL_MANIFESTS, '--cache-root', resolveCacheRoot(cacheRoot), '--output', output];
  if (dates.length) args.push('--dates', dates.join(','));
  const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) throw new Error(`Direct spatial feature extraction failed (${command}): ${result.stderr || result.stdout}`);
  if (result.stdout?.trim()) console.log(result.stdout.trim());
  return fs.existsSync(output) ? readJson(output) : { records: {} };
}

export function generateFeatures(options = {}) {
  fs.mkdirSync(FEATURE_RECORDS, { recursive: true });
  const paired = fs.existsSync(PAIRED) ? readJson(PAIRED) : { cases: [] };
  const pairByDate = new Map((paired.cases ?? []).map(c => [c.eventDate, c]));
  const noaaAggregate = fs.existsSync(NOAA_AGGREGATE) ? readJson(NOAA_AGGREGATE) : { records: [] };
  const noaaByDate = new Map((noaaAggregate.records ?? []).map(record => [record.eventDate, record]));
  const recordFiles = listRecords(ERA5_RECORDS);
  const directSpatial = extractDirectSpatialFeatures({ ...options, dates: recordFiles.map(file => file.slice(0, 10)) });
  const rawRecords = [];
  for (const file of recordFiles) {
    const era5 = readJson(path.join(ERA5_RECORDS, file)); const eventDate = era5.eventDate ?? file.slice(0,10);
    const noaaPath = path.join(NOAA_RECORDS, `${eventDate}.json`); const noaa = fs.existsSync(noaaPath) ? readJson(noaaPath) : (noaaByDate.get(eventDate) ?? null);
    const pair = pairByDate.get(eventDate) ?? null; const inputs = extractInputs(era5);
    const spatialResult = directSpatial.records?.[eventDate] ?? { available: false, reason: 'not-extracted' };
    inputs.spatialDirect = { ...DIRECT_SPATIAL_DEFAULTS, ...(spatialResult.available ? spatialResult.features : {}), spatialTensorRead: spatialResult.available ? 1 : 0 };
    rawRecords.push({ schemaVersion: FEATURE_SCHEMA_VERSION, eventDate, corpusRoles: [noaa ? 'event' : null, pair?.corpusMembership?.forecast?.complete ? 'forecast' : null].filter(Boolean), inputs: { raw: inputs }, labels: buildLabels(noaa, pair), quality: { ...quality(era5,noaa,pair), directSpatialComplete: Boolean(spatialResult.available), directSpatialReason: spatialResult.reason ?? null }, provenance: { era5Record: path.relative(TRAINING, path.join(ERA5_RECORDS,file)).replaceAll('\\','/'), noaaRecord: noaa ? path.relative(TRAINING,noaaPath).replaceAll('\\','/') : null, pairedRecord: pair ? 'paired/cases.json' : null, sourceFingerprint: sha256({ era5: era5.provenance, spatial: spatialResult.available ? spatialResult.features : spatialResult.reason, noaa: noaa?.eventDate, pair: pair?.provenance }) } });
  }
  if (!rawRecords.length) throw new Error('No ERA5 records found; feature extraction cannot continue.');
  const normalization = buildNormalization(rawRecords); writeJson(NORMALIZATION, normalization);
  const indexRecords = [];
  for (const record of rawRecords) {
    record.inputs.normalized = normalizeInputs(record.inputs.raw, normalization);
    record.featureCount = Object.keys(flattenNumeric(record.inputs.raw)).length;
    const target = path.join(FEATURE_RECORDS, `${record.eventDate}.json`); writeJson(target, record);
    indexRecords.push({ eventDate: record.eventDate, path: path.relative(TRAINING,target).replaceAll('\\','/'), corpusRoles: record.corpusRoles, featureCount: record.featureCount, qualityScore: record.quality.score, sourceFingerprint: record.provenance.sourceFingerprint });
  }
  const directSpatialRecordCount = rawRecords.filter(record => record.quality.directSpatialComplete).length;
  const index = { schemaVersion: FEATURE_SCHEMA_VERSION, generatedAt: new Date().toISOString(), recordCount: indexRecords.length, featureCount: normalization.featureCount, eventRecordCount: indexRecords.filter(r=>r.corpusRoles.includes('event')).length, forecastRecordCount: indexRecords.filter(r=>r.corpusRoles.includes('forecast')).length, directSpatialRecordCount, records: indexRecords };
  writeJson(INDEX,index);
  return index;
}

export function validateFeatures() {
  const errors = [], warnings = [];
  if (!fs.existsSync(INDEX) || !fs.existsSync(NORMALIZATION)) return { valid:false, errors:['Feature index or normalization file is missing. Run npm run training:features.'], warnings, recordCount:0 };
  const index = readJson(INDEX), normalization = readJson(NORMALIZATION); const expectedNames = Object.keys(normalization.features ?? {}).sort();
  for (const item of index.records ?? []) {
    const file = path.join(TRAINING,item.path);
    if (!fs.existsSync(file)) { errors.push(`${item.eventDate}: missing feature record ${item.path}`); continue; }
    const record = readJson(file); const raw = flattenNumeric(record.inputs?.raw); const normalized = flattenNumeric(record.inputs?.normalized);
    const rawNames = Object.keys(raw).sort(); const normalizedNames = Object.keys(normalized).sort();
    if (rawNames.join('|') !== expectedNames.join('|')) errors.push(`${item.eventDate}: inconsistent raw feature schema`);
    if (normalizedNames.join('|') !== expectedNames.join('|')) errors.push(`${item.eventDate}: inconsistent normalized feature schema`);
    for (const [name,value] of [...Object.entries(raw),...Object.entries(normalized)]) if (!Number.isFinite(value)) errors.push(`${item.eventDate}: non-finite feature ${name}`);
    if ('labels' in (record.inputs ?? {})) errors.push(`${item.eventDate}: labels leaked into atmospheric inputs`);
    if (record.inputs?.raw?.spatialDirect?.spatialTensorRead !== 1) warnings.push(`${item.eventDate}: direct spatial tensor was not read`);
    if (record.quality?.score < 0 || record.quality?.score > 1) errors.push(`${item.eventDate}: quality score outside 0..1`);
    if (record.provenance?.sourceFingerprint !== item.sourceFingerprint) warnings.push(`${item.eventDate}: index fingerprint differs from record`);
  }
  if ((index.featureCount ?? 0) !== expectedNames.length) errors.push('Index feature count does not match normalization schema.');
  if ((index.directSpatialRecordCount ?? 0) !== (index.records ?? []).filter(item => { const record = fs.existsSync(path.join(TRAINING,item.path)) ? readJson(path.join(TRAINING,item.path)) : null; return record?.inputs?.raw?.spatialDirect?.spatialTensorRead === 1; }).length) errors.push('Direct spatial record count does not match feature records.');
  return { valid: errors.length === 0, schemaVersion: index.schemaVersion, recordCount: index.recordCount ?? 0, featureCount: expectedNames.length, errors, warnings };
}

function printValidation(result) {
  console.log('\nAnalog Feature Dataset Validation');
  console.log(`Records: ${result.recordCount}`); console.log(`Features: ${result.featureCount ?? 0}`); console.log(`Integrity: ${result.valid ? 'PASS' : 'FAIL'}`);
  for (const warning of result.warnings ?? []) console.log(`WARN: ${warning}`);
  for (const error of result.errors ?? []) console.error(`ERROR: ${error}`);
}

const command = process.argv[2] ?? 'build';
const cliOptions = parseCliOptions(process.argv.slice(3));
function parseCliOptions(values) {
  const out = {};
  for (let i = 0; i < values.length; i += 1) {
    if (values[i] === '--cache-root') out.cacheRoot = values[++i];
    else if (values[i] === '--python') out.python = values[++i];
  }
  return out;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (command === 'build' || command === 'generate') {
      const index = generateFeatures(cliOptions);
      console.log(`Generated ${index.recordCount} analog feature records with ${index.featureCount} atmospheric inputs.`);
      console.log(`Event=${index.eventRecordCount}, Forecast=${index.forecastRecordCount}, Direct spatial=${index.directSpatialRecordCount}/${index.recordCount}`);
    } else if (command === 'validate') { const result = validateFeatures(); printValidation(result); if (!result.valid) process.exitCode = 1; }
    else if (command === 'status') { const result = validateFeatures(); printValidation(result); }
    else throw new Error(`Unknown command: ${command}`);
  } catch (error) { console.error(error.stack ?? error.message); process.exitCode = 1; }
}
