#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { retrieveAnalogs, classifySynopticPattern, orderedGroupEntries } from './training-analogs.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FEATURE_INDEX = path.join(ROOT, 'training', 'features', 'index.json');
const NORMALIZATION = path.join(ROOT, 'training', 'features', 'normalization.json');
const OUTPUT_DIR = path.join(ROOT, 'training', 'generated-seeds');
const SCHEMA_VERSION = '2.41.0';
const EPSILON = 1e-9;

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function clamp(value, min = 0, max = 1) { return Math.min(max, Math.max(min, Number(value) || 0)); }
function finite(value, fallback = 0) { return Number.isFinite(Number(value)) ? Number(value) : fallback; }
function round(value, digits = 5) { const factor = 10 ** digits; return Math.round(finite(value) * factor) / factor; }

export function canonicalSeed(seed) {
  const text = String(seed ?? '').trim();
  if (!text) throw new Error('A non-empty seed is required.');
  return text;
}

function xmur3(text) {
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i += 1) { h = Math.imul(h ^ text.charCodeAt(i), 3432918353); h = h << 13 | h >>> 19; }
  return () => { h = Math.imul(h ^ h >>> 16, 2246822507); h = Math.imul(h ^ h >>> 13, 3266489909); return (h ^= h >>> 16) >>> 0; };
}
function sfc32(a, b, c, d) {
  return () => { a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0; let t = (a + b) | 0; a = b ^ b >>> 9; b = c + (c << 3) | 0; c = c << 21 | c >>> 11; d = d + 1 | 0; t = t + d | 0; c = c + t | 0; return (t >>> 0) / 4294967296; };
}
export function createSeededRandom(seed) { const hash = xmur3(canonicalSeed(seed)); return sfc32(hash(), hash(), hash(), hash()); }
function normal(random) { const u = Math.max(EPSILON, random()); const v = Math.max(EPSILON, random()); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function pick(random, values) { return values[Math.min(values.length - 1, Math.floor(random() * values.length))]; }
function weightedPick(random, values) { const total = values.reduce((sum, item) => sum + item.weight, 0); let cursor = random() * total; for (const item of values) { cursor -= item.weight; if (cursor <= 0) return item.value; } return values.at(-1).value; }

function setPath(object, dotted, value) { const parts = dotted.split('.'); let cursor = object; for (let i = 0; i < parts.length - 1; i += 1) cursor = cursor[parts[i]] ??= {}; cursor[parts.at(-1)] = value; }
function flattenNumeric(object, prefix = '', output = {}) { for (const [key, value] of Object.entries(object ?? {})) { const name = prefix ? `${prefix}.${key}` : key; if (typeof value === 'number' && Number.isFinite(value)) output[name] = value; else if (value && typeof value === 'object' && !Array.isArray(value)) flattenNumeric(value, name, output); } return output; }

function buildLatentState(random, options = {}) {
  const season = options.season ?? weightedPick(random, [
    { value: 'early-spring', weight: 0.16 }, { value: 'mid-spring', weight: 0.27 }, { value: 'late-spring', weight: 0.32 },
    { value: 'summer', weight: 0.18 }, { value: 'cool-season', weight: 0.07 }
  ]);
  const region = options.region ?? weightedPick(random, [
    { value: 'southern-plains', weight: 0.25 }, { value: 'central-plains', weight: 0.34 }, { value: 'northern-plains', weight: 0.18 },
    { value: 'high-plains', weight: 0.15 }, { value: 'lower-mississippi-valley', weight: 0.08 }
  ]);
  const seasonThermo = { 'early-spring': -0.25, 'mid-spring': 0.12, 'late-spring': 0.45, summer: 0.70, 'cool-season': -0.65 }[season];
  const seasonDynamics = { 'early-spring': 0.55, 'mid-spring': 0.42, 'late-spring': 0.22, summer: -0.15, 'cool-season': 0.75 }[season];
  const regionMoisture = { 'southern-plains': 0.52, 'central-plains': 0.24, 'northern-plains': -0.08, 'high-plains': -0.32, 'lower-mississippi-valley': 0.68 }[region];
  const severity = clamp(0.50 + normal(random) * 0.21, 0.05, 0.98);
  return {
    season, region, severity,
    instability: seasonThermo + severity * 1.35 + normal(random) * 0.35,
    dynamics: seasonDynamics + severity * 1.05 + normal(random) * 0.34,
    moisture: regionMoisture + seasonThermo * 0.55 + severity * 0.70 + normal(random) * 0.28,
    cap: (season === 'late-spring' || season === 'summer' ? 0.45 : 0.05) + normal(random) * 0.45,
    forcing: seasonDynamics * 0.6 + severity * 0.85 + normal(random) * 0.34,
    spatialOrganization: severity * 0.9 + normal(random) * 0.35,
    nocturnal: clamp((season === 'summer' ? 0.25 : 0) + random() * 0.75)
  };
}

const FEATURE_INFLUENCE = {
  thermodynamics: { instability: 0.68, moisture: 0.24, cap: 0.08 },
  windProfile: { dynamics: 0.78, forcing: 0.22 },
  synoptic: { dynamics: 0.40, forcing: 0.45, moisture: 0.15 },
  spatial: { spatialOrganization: 0.45, instability: 0.22, moisture: 0.16, forcing: 0.17 },
  spatialDirect: { spatialOrganization: 0.58, instability: 0.15, moisture: 0.12, forcing: 0.15 }
};

function targetZScore(featureName, latent, random) {
  const group = featureName.split('.')[0]; const weights = FEATURE_INFLUENCE[group] ?? {};
  let z = Object.entries(weights).reduce((sum, [name, weight]) => sum + finite(latent[name]) * weight, 0);
  if (/cin/i.test(featureName)) z = latent.cap * 0.72 - latent.forcing * 0.30 + normal(random) * 0.25;
  if (/pressure/i.test(featureName) && !/gradient|range/i.test(featureName)) z = -latent.forcing * 0.72 + normal(random) * 0.22;
  if (/cape/i.test(featureName)) z += latent.instability * 0.35;
  if (/dewpoint|moisture|tcwv|precipitable/i.test(featureName)) z += latent.moisture * 0.30;
  if (/jet|wind|shear|turning/i.test(featureName)) z += latent.dynamics * 0.24;
  if (/peakTimeFraction/i.test(featureName)) z = (latent.nocturnal - 0.5) * 2;
  if (/Centroid[XY]/i.test(featureName)) z = normal(random) * 0.55;
  if (/OrientationDeg/i.test(featureName)) z = normal(random) * 0.85;
  return clamp(z + normal(random) * 0.32, -2.35, 2.35);
}

function createAtmosphericInputs(normalization, latent, random) {
  const raw = {}, normalized = {};
  for (const [name, stats] of Object.entries(normalization.features ?? {})) {
    let z = targetZScore(name, latent, random);
    let value = finite(stats.mean) + z * Math.max(EPSILON, finite(stats.standardDeviation));
    if (Number.isFinite(stats.p10) && Number.isFinite(stats.p90)) value = clamp(value, stats.p10 - (stats.p90 - stats.p10) * 0.55, stats.p90 + (stats.p90 - stats.p10) * 0.55);
    if (/Coverage|Overlap|Fraction|strengthProxy|spatialTensorAvailable/i.test(name)) value = clamp(value, 0, 1);
    if (/Centroid[XY]/i.test(name)) value = clamp(0.5 + z * 0.16, 0.02, 0.98);
    if (/OrientationDeg/i.test(name)) value = ((value % 180) + 180) % 180;
    if (/Elongation/i.test(name)) value = Math.max(0, value);
    setPath(raw, name, round(value));
    setPath(normalized, name, round(z));
  }
  return { raw, normalized };
}


function getPath(object, dotted) { return dotted.split('.').reduce((cursor, key) => cursor?.[key], object); }
function enforcePhysicalRelationships(inputs, normalization) {
  const raw = inputs.raw;
  const capeMean = finite(getPath(raw, 'thermodynamics.capeMeanJkg'));
  const capeP90 = finite(getPath(raw, 'thermodynamics.capeP90Jkg'), capeMean);
  const capeMax = finite(getPath(raw, 'thermodynamics.capeMaxJkg'), capeP90);
  setPath(raw, 'thermodynamics.capeP90Jkg', Math.max(capeMean, capeP90));
  setPath(raw, 'thermodynamics.capeMaxJkg', Math.max(capeMean, capeP90, capeMax));
  for (const name of ['windProfile.wind850MeanMs','windProfile.wind500MeanMs','windProfile.wind250MeanMs','windProfile.wind250P90Ms','windProfile.shear850To500Ms','windProfile.shear500To250Ms']) {
    if (getPath(raw, name) !== undefined) setPath(raw, name, Math.max(0, finite(getPath(raw, name))));
  }
  const flat = flattenNumeric(raw);
  for (const [name, value] of Object.entries(flat)) {
    const stats = normalization.features?.[name];
    const z = stats?.standardDeviation > EPSILON ? (value - finite(stats.mean)) / stats.standardDeviation : 0;
    setPath(inputs.normalized, name, round(z));
    setPath(inputs.raw, name, round(value));
  }
  return inputs;
}

function narrativeFrom(latent, record, random) {
  const raw = record.inputs.raw; const thermo = raw.thermodynamics ?? {}; const wind = raw.windProfile ?? {}; const syn = raw.synoptic ?? {};
  const pattern = classifySynopticPattern(record);
  const boundaries = latent.region === 'high-plains' ? ['lee trough', 'upslope convergence zone'] : latent.moisture > 0.75 ? ['dryline', 'warm front'] : ['cold front', 'pre-frontal confluence zone'];
  if (random() > 0.72) boundaries.push('remnant outflow boundary');
  const cap = latent.cap > 0.65 ? 'strong elevated mixed-layer cap' : latent.cap > 0.15 ? 'moderate cap with afternoon erosion' : 'weak or locally absent cap';
  const evolution = latent.forcing > 1.0 && latent.spatialOrganization > 0.8 ? 'Discrete initiation transitions toward organized clusters or a QLCS.' : latent.cap > 0.65 ? 'Conditional discrete initiation is delayed until focused forcing erodes the cap.' : 'Scattered initiation develops near the primary boundary and remains semi-discrete.';
  return {
    climate: { season: latent.season, region: latent.region, activityLevel: latent.severity > .78 ? 'very active' : latent.severity > .52 ? 'active' : 'conditional' },
    synopticPattern: pattern,
    upperPattern: latent.dynamics > 1.0 ? 'amplified trough with a strong upper-level jet' : latent.dynamics > 0.35 ? 'progressive trough and supportive jet streak' : 'subtle wave with modest upper support',
    surfacePattern: latent.forcing > 0.8 ? 'deepening surface cyclone and sharpening warm sector' : 'modest lee cyclone with diffuse pressure falls',
    boundaries,
    moisture: latent.moisture > 1.0 ? 'exceptional moisture return' : latent.moisture > 0.35 ? 'seasonably rich moisture return' : 'limited or narrow moisture return',
    cap,
    expectedEvolution: evolution,
    diagnostics: { capeMaxJkg: round(thermo.capeMaxJkg, 1), cinMeanJkg: round(thermo.cinMeanJkg, 1), deepLayerShearProxyMs: round(wind.shear850To500Ms, 1), jetStrengthMs: round(syn.jetStrengthMs, 1) }
  };
}

function validateGenerated(record, normalization) {
  const errors = [], warnings = []; const flatRaw = flattenNumeric(record.inputs.raw); const flatNormalized = flattenNumeric(record.inputs.normalized);
  for (const name of Object.keys(normalization.features ?? {})) {
    if (!Number.isFinite(flatRaw[name])) errors.push(`Missing or non-finite raw feature: ${name}`);
    if (!Number.isFinite(flatNormalized[name])) errors.push(`Missing or non-finite normalized feature: ${name}`);
    if (Math.abs(finite(flatNormalized[name])) > 3.25) warnings.push(`Feature outside preferred historical envelope: ${name}`);
  }
  const t = record.inputs.raw.thermodynamics ?? {}; const w = record.inputs.raw.windProfile ?? {};
  if (finite(t.capeMaxJkg) < finite(t.capeMeanJkg)) errors.push('CAPE maximum is less than CAPE mean.');
  if (finite(w.wind250MeanMs) < 0 || finite(w.wind500MeanMs) < 0 || finite(w.wind850MeanMs) < 0) errors.push('Wind speed cannot be negative.');
  return { valid: errors.length === 0, errors, warnings, checks: { finiteFeatures: Object.keys(flatRaw).length, expectedFeatures: Object.keys(normalization.features ?? {}).length } };
}

function loadFeatureRecords() {
  const index = readJson(FEATURE_INDEX); const featureRoot = path.join(ROOT, 'training');
  return (index.records ?? []).map(item => readJson(path.resolve(featureRoot, item.path)));
}

export function generateAtmosphericSeed(seed, options = {}) {
  if (!options.normalization && (!fs.existsSync(NORMALIZATION) || (options.analogs !== false && !fs.existsSync(FEATURE_INDEX)))) throw new Error('Feature dataset is missing. Run npm run training:features first.');
  const canonical = canonicalSeed(seed); const random = createSeededRandom(canonical); const normalization = options.normalization ?? readJson(NORMALIZATION);
  const latent = buildLatentState(random, options); const inputs = enforcePhysicalRelationships(createAtmosphericInputs(normalization, latent, random), normalization);
  const seedHash = crypto.createHash('sha256').update(canonical).digest('hex');
  const record = { schemaVersion: SCHEMA_VERSION, generator: 'atmosphere-first-seed-generator', seed: canonical, seedHash, generatedAt: new Date().toISOString(), eventDate: `seed:${canonical}`, corpusRoles: [], inputs, latentState: Object.fromEntries(Object.entries(latent).map(([key, value]) => [key, typeof value === 'number' ? round(value) : value])), quality: { score: 1, generated: true } };
  record.narrative = narrativeFrom(latent, record, random);
  record.validation = validateGenerated(record, normalization);
  if (!record.validation.valid) throw new Error(`Generated atmosphere failed validation: ${record.validation.errors.join('; ')}`);
  if (options.analogs !== false) record.analogs = retrieveAnalogs(record, options.candidateRecords ?? loadFeatureRecords(), { top: options.top ?? 8, role: options.role ?? 'event' });
  record.atmosphericIdentity = { pattern: classifySynopticPattern(record), analogConfidence: record.analogs?.confidence ?? null, novelty: record.analogs?.confidence?.novelty ?? null };
  return record;
}

function parseArgs(args) { const out = { write: true, top: 8, role: 'event' }; for (let i = 0; i < args.length; i += 1) { const value = args[i]; if (value === '--seed') out.seed = args[++i]; else if (value === '--season') out.season = args[++i]; else if (value === '--region') out.region = args[++i]; else if (value === '--top') out.top = Number(args[++i]); else if (value === '--role') out.role = args[++i]; else if (value === '--json') out.json = true; else if (value === '--no-write') out.write = false; else if (value === '--no-analogs') out.analogs = false; else if (value === '--output') out.output = args[++i]; } return out; }
const GROUP_LABELS = Object.freeze({
  thermodynamics: 'Thermodynamics',
  windProfile: 'Wind profile',
  synoptic: 'Synoptic',
  spatial: 'Spatial summary',
  spatialDirect: 'Direct spatial'
});

function formatGroupSimilarities(groupSimilarities = {}) {
  return orderedGroupEntries(groupSimilarities)
    .map(([name, similarity]) => `${GROUP_LABELS[name] ?? name}: ${(finite(similarity) * 100).toFixed(1)}%`)
    .join(' | ');
}

function printSummary(record) {
  console.log('\nAtmosphere-First Seed');
  console.log(`Seed: ${record.seed}`);
  console.log(`Pattern: ${record.atmosphericIdentity.pattern}`);
  console.log(`Season/region: ${record.narrative.climate.season} / ${record.narrative.climate.region}`);
  console.log(`Moisture: ${record.narrative.moisture}`);
  console.log(`Cap: ${record.narrative.cap}`);
  console.log(`Evolution: ${record.narrative.expectedEvolution}`);
  console.log(`Validation: ${record.validation.valid ? 'PASS' : 'FAIL'}`);
  if (record.analogs) {
    console.log(`Analog confidence: ${record.analogs.confidence.level}`);
    for (const item of record.analogs.results.slice(0, 5)) {
      console.log(`  ${item.rank}. ${item.eventDate} ${(item.similarity * 100).toFixed(1)}%`);
      const groups = formatGroupSimilarities(item.groupSimilarities);
      if (groups) console.log(`     ${groups}`);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const options = parseArgs(process.argv.slice(2)); if (!options.seed) throw new Error('Specify --seed <value>.'); const record = generateAtmosphericSeed(options.seed, options); if (options.write) { const output = path.resolve(options.output ?? path.join(OUTPUT_DIR, `${record.seedHash.slice(0, 16)}.json`)); writeJson(output, record); record.output = path.relative(ROOT, output).replaceAll('\\', '/'); } if (options.json) console.log(JSON.stringify(record, null, 2)); else { printSummary(record); if (record.output) console.log(`Record: ${record.output}`); } } catch (error) { console.error(error.stack ?? error.message); process.exitCode = 1; }
}
