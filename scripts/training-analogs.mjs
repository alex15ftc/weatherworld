#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TRAINING = path.join(ROOT, 'training');
const FEATURE_INDEX = path.join(TRAINING, 'features', 'index.json');
const REPORT_DIR = path.join(TRAINING, 'analogs', 'reports');
const SCHEMA_VERSION = '2.40.0';
const EPSILON = 1e-9;

export const ANALOG_GROUP_ORDER = Object.freeze([
  'thermodynamics',
  'windProfile',
  'synoptic',
  'spatial',
  'spatialDirect'
]);

export const EXCLUDED_RETRIEVAL_FEATURES = Object.freeze(new Set([
  'spatial.spatialTensorAvailable',
  'spatialDirect.spatialTensorRead',
  'spatialDirect.peakTimeIndex'
]));

export const DEFAULT_GROUP_WEIGHTS = Object.freeze({
  thermodynamics: 0.30,
  windProfile: 0.30,
  synoptic: 0.20,
  spatial: 0.08,
  spatialDirect: 0.12
});

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function finite(value, fallback = 0) { return Number.isFinite(Number(value)) ? Number(value) : fallback; }
function clamp(value, min = 0, max = 1) { return Math.min(max, Math.max(min, finite(value))); }

export function flattenNumeric(object, prefix = '', out = {}) {
  for (const [key, value] of Object.entries(object ?? {})) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'number' && Number.isFinite(value)) out[name] = value;
    else if (value && typeof value === 'object' && !Array.isArray(value)) flattenNumeric(value, name, out);
  }
  return out;
}

function groupForFeature(name) { return name.split('.')[0]; }
export function isRetrievalFeature(name) {
  if (EXCLUDED_RETRIEVAL_FEATURES.has(name)) return false;
  const leaf = name.split('.').at(-1) ?? '';
  return !/(?:available|read|complete|completeness)$/i.test(leaf);
}
export function orderedGroupEntries(groups = {}) {
  const known = ANALOG_GROUP_ORDER.filter(name => Object.hasOwn(groups, name)).map(name => [name, groups[name]]);
  const extras = Object.keys(groups).filter(name => !ANALOG_GROUP_ORDER.includes(name)).sort().map(name => [name, groups[name]]);
  return [...known, ...extras];
}
function normalizedGroupWeights(featureNames, groupWeights = DEFAULT_GROUP_WEIGHTS) {
  const present = [...new Set(featureNames.map(groupForFeature))];
  const sum = present.reduce((total, group) => total + Math.max(0, finite(groupWeights[group])), 0);
  return Object.fromEntries(present.map(group => [group, sum > EPSILON ? Math.max(0, finite(groupWeights[group])) / sum : 1 / present.length]));
}
function perFeatureWeights(featureNames, groupWeights = DEFAULT_GROUP_WEIGHTS) {
  const normalized = normalizedGroupWeights(featureNames, groupWeights);
  const counts = Object.fromEntries(Object.keys(normalized).map(group => [group, featureNames.filter(name => groupForFeature(name) === group).length]));
  return Object.fromEntries(featureNames.map(name => [name, normalized[groupForFeature(name)] / Math.max(1, counts[groupForFeature(name)])]));
}

export function compareFeatureVectors(queryInput, candidateInput, options = {}) {
  const query = flattenNumeric(queryInput);
  const candidate = flattenNumeric(candidateInput);
  const featureNames = Object.keys(query).filter(name => isRetrievalFeature(name) && Number.isFinite(candidate[name])).sort();
  if (!featureNames.length) throw new Error('No shared numeric atmospheric features were found.');
  const weights = perFeatureWeights(featureNames, options.groupWeights);
  let squaredDistance = 0, dot = 0, queryNorm = 0, candidateNorm = 0;
  const featureContributions = [];
  const groupAccumulator = {};
  for (const name of featureNames) {
    const q = query[name], c = candidate[name], difference = q - c, weight = weights[name];
    const contribution = weight * difference * difference;
    squaredDistance += contribution;
    dot += weight * q * c; queryNorm += weight * q * q; candidateNorm += weight * c * c;
    const localSimilarity = Math.exp(-0.5 * difference * difference);
    featureContributions.push({
      feature: name, group: groupForFeature(name), query: q, candidate: c, difference,
      absoluteDifference: Math.abs(difference), weight, weightedSquaredDifference: contribution,
      supportContribution: weight * localSimilarity, penaltyContribution: weight * (1 - localSimilarity)
    });
    const group = groupAccumulator[groupForFeature(name)] ??= { weightedSquaredDistance: 0, squaredDifference: 0, absoluteDifference: 0, featureCount: 0 };
    group.weightedSquaredDistance += contribution;
    group.squaredDifference += difference * difference;
    group.absoluteDifference += Math.abs(difference);
    group.featureCount += 1;
  }
  const weightedDistance = Math.sqrt(squaredDistance);
  const euclideanSimilarity = 1 / (1 + weightedDistance);
  const cosineRaw = dot / Math.max(EPSILON, Math.sqrt(queryNorm) * Math.sqrt(candidateNorm));
  const cosineSimilarity = clamp((cosineRaw + 1) / 2);
  const mahalanobisSimilarity = Math.exp(-0.5 * squaredDistance);
  const metricWeights = options.metricWeights ?? { euclidean: 0.45, cosine: 0.20, mahalanobis: 0.35 };
  const metricWeightSum = Object.values(metricWeights).reduce((sum, value) => sum + Math.max(0, finite(value)), 0) || 1;
  const atmosphericSimilarity = (
    euclideanSimilarity * finite(metricWeights.euclidean) +
    cosineSimilarity * finite(metricWeights.cosine) +
    mahalanobisSimilarity * finite(metricWeights.mahalanobis)
  ) / metricWeightSum;
  const groups = Object.fromEntries(Object.entries(groupAccumulator).map(([name, value]) => {
    const rootMeanSquaredDifference = Math.sqrt(value.squaredDifference / Math.max(1, value.featureCount));
    const meanAbsoluteDifference = value.absoluteDifference / Math.max(1, value.featureCount);
    return [name, {
      ...value,
      rootMeanSquaredDifference,
      meanAbsoluteDifference,
      similarity: 1 / (1 + rootMeanSquaredDifference)
    }];
  }));
  featureContributions.sort((a, b) => b.weightedSquaredDifference - a.weightedSquaredDifference);
  return {
    sharedFeatureCount: featureNames.length,
    atmosphericSimilarity,
    metrics: { weightedDistance, euclideanSimilarity, cosineSimilarity, mahalanobisSimilarity },
    groups,
    largestDifferences: featureContributions.slice(0, options.explainCount ?? 6),
    strongestMatches: [...featureContributions].sort((a, b) => b.supportContribution - a.supportContribution || a.absoluteDifference - b.absoluteDifference).slice(0, options.explainCount ?? 6),
    positiveContributors: [...featureContributions].sort((a, b) => b.supportContribution - a.supportContribution).slice(0, options.explainCount ?? 6),
    negativeContributors: [...featureContributions].sort((a, b) => b.penaltyContribution - a.penaltyContribution).slice(0, options.explainCount ?? 6)
  };
}

export function classifySynopticPattern(record) {
  const raw = record?.inputs?.raw ?? record ?? {};
  const thermo = raw.thermodynamics ?? {}, wind = raw.windProfile ?? {}, syn = raw.synoptic ?? {}, spatial = raw.spatial ?? {}, direct = raw.spatialDirect ?? {};
  const cape = finite(thermo.capeMaxJkg); const shear = finite(wind.shear850To500Ms); const jet = finite(syn.jetStrengthMs ?? wind.wind250P90Ms);
  const moisture = finite(syn.moistureTransportProxy); const turning = finite(wind.turning850To500Deg); const overlap = finite(direct.forcingInstabilityOverlap ?? spatial.forcingInstabilityOverlapProxy);
  const nocturnal = finite(direct.peakTimeFraction) >= 0.72;
  if (nocturnal && shear >= 18) return 'Elevated or nocturnal severe-weather regime';
  if (cape >= 3000 && shear >= 20 && jet >= 35 && overlap >= 0.45) return 'Classic Plains cyclone / dryline outbreak';
  if (cape >= 1800 && turning >= 55 && moisture >= 0.08) return 'Warm-front or strongly curved-hodograph regime';
  if (cape >= 1200 && shear >= 22 && jet >= 40) return 'Strongly forced trough severe-weather regime';
  if (cape >= 1800 && finite(direct.capeCorridorElongation) >= 1.8) return 'Focused instability-corridor / dryline regime';
  if (cape < 1500 && shear >= 20) return 'Low-CAPE high-shear regime';
  if (cape >= 2000 && shear < 15) return 'High-instability weak-forcing regime';
  return 'Mixed severe-weather regime';
}

function confidenceFromResults(results) {
  if (!results.length) return { level: 'NONE', score: 0, novelty: 1 };
  const best = results[0].similarity;
  const second = results[1]?.similarity ?? best;
  const separation = Math.max(0, best - second);
  const score = clamp(best * 0.85 + Math.min(0.15, separation * 1.5));
  const level = score >= 0.82 ? 'HIGH' : score >= 0.68 ? 'MODERATE' : score >= 0.52 ? 'LOW' : 'VERY LOW';
  return { level, score, novelty: clamp(1 - best), bestSimilarity: best, bestSecondSeparation: separation };
}

export function retrieveAnalogs(queryRecord, candidateRecords, options = {}) {
  const role = options.role ?? 'event'; const top = Math.max(1, Math.floor(finite(options.top, 5)));
  const queryNormalized = queryRecord?.inputs?.normalized ?? queryRecord?.normalized ?? queryRecord;
  const results = [];
  for (const candidate of candidateRecords) {
    if (!candidate || candidate.eventDate === queryRecord.eventDate) continue;
    if (role !== 'all' && !(candidate.corpusRoles ?? []).includes(role)) continue;
    const comparison = compareFeatureVectors(queryNormalized, candidate.inputs?.normalized ?? candidate.normalized ?? candidate, options);
    const qualityScore = clamp(candidate.quality?.score ?? 1);
    const qualityFactor = 0.85 + 0.15 * qualityScore;
    const similarity = clamp(comparison.atmosphericSimilarity * qualityFactor);
    results.push({
      rank: 0, eventDate: candidate.eventDate, similarity, atmosphericSimilarity: comparison.atmosphericSimilarity,
      qualityScore, corpusRoles: candidate.corpusRoles ?? [], pattern: classifySynopticPattern(candidate),
      metrics: comparison.metrics,
      groupSimilarities: Object.fromEntries(Object.entries(comparison.groups).map(([name, value]) => [name, value.similarity])),
      groupDiagnostics: Object.fromEntries(Object.entries(comparison.groups).map(([name, value]) => [name, {
        similarity: value.similarity,
        rootMeanSquaredDifference: value.rootMeanSquaredDifference,
        meanAbsoluteDifference: value.meanAbsoluteDifference,
        featureCount: value.featureCount
      }])),
      explanation: {
        strongestMatches: comparison.strongestMatches,
        largestDifferences: comparison.largestDifferences,
        positiveContributors: comparison.positiveContributors,
        negativeContributors: comparison.negativeContributors
      },
      labels: candidate.labels ?? null
    });
  }
  results.sort((a, b) => b.similarity - a.similarity || a.eventDate.localeCompare(b.eventDate));
  const selected = results.slice(0, top).map((result, index) => ({ ...result, rank: index + 1 }));
  return {
    schemaVersion: SCHEMA_VERSION, generatedAt: new Date().toISOString(), query: { eventDate: queryRecord.eventDate ?? null, pattern: classifySynopticPattern(queryRecord), role },
    candidateCount: results.length, resultCount: selected.length, confidence: confidenceFromResults(selected), results: selected
  };
}

function loadFeatureRecords(indexFile = FEATURE_INDEX) {
  if (!fs.existsSync(indexFile)) throw new Error('Feature index is missing. Run npm run training:features first.');
  const index = readJson(indexFile); const base = path.dirname(path.dirname(indexFile));
  return (index.records ?? []).map(item => readJson(path.resolve(base, item.path.replace(/^features\//, 'features/'))));
}

function parseArgs(args) {
  const out = { top: 5, role: 'event', write: true };
  for (let i = 0; i < args.length; i += 1) {
    const value = args[i];
    if (value === '--date') out.date = args[++i];
    else if (value === '--record') out.record = args[++i];
    else if (value === '--top') out.top = Number(args[++i]);
    else if (value === '--role') out.role = args[++i];
    else if (value === '--json') out.json = true;
    else if (value === '--no-write') out.write = false;
    else if (value === '--output') out.output = args[++i];
  }
  return out;
}

function printReport(report) {
  console.log('\nHistorical Analog Report');
  console.log(`Query: ${report.query.eventDate ?? 'external record'}`);
  console.log(`Pattern: ${report.query.pattern}`);
  console.log(`Confidence: ${report.confidence.level} (${(report.confidence.score * 100).toFixed(1)}%)`);
  console.log(`Novelty: ${(report.confidence.novelty * 100).toFixed(1)}%`);
  for (const result of report.results) {
    console.log(`\n${result.rank}. ${result.eventDate}  similarity=${(result.similarity * 100).toFixed(1)}%`);
    console.log(`   Pattern: ${result.pattern}`);
    const groups = orderedGroupEntries(result.groupSimilarities ?? {})
      .map(([name, similarity]) => `${name}=${(similarity * 100).toFixed(1)}%`)
      .join(' | ');
    if (groups) console.log(`   Groups: ${groups}`);
    const matches = result.explanation.strongestMatches.slice(0, 3).map(item => item.feature).join(', ');
    const differences = result.explanation.largestDifferences.slice(0, 3).map(item => item.feature).join(', ');
    console.log(`   Strongest matches: ${matches || 'none'}`);
    console.log(`   Largest differences: ${differences || 'none'}`);
    const positive = (result.explanation.positiveContributors ?? []).slice(0, 3)
      .map(item => `${item.feature} +${(item.supportContribution * 100).toFixed(2)} pts`).join(' | ');
    const negative = (result.explanation.negativeContributors ?? []).slice(0, 3)
      .map(item => `${item.feature} -${(item.penaltyContribution * 100).toFixed(2)} pts`).join(' | ');
    if (positive) console.log(`   Positive contributors: ${positive}`);
    if (negative) console.log(`   Negative contributors: ${negative}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2)); const records = loadFeatureRecords();
    let query;
    if (options.record) query = readJson(path.resolve(options.record));
    else if (options.date) query = records.find(record => record.eventDate === options.date);
    else throw new Error('Specify a query with --date YYYY-MM-DD or --record path/to/feature-record.json.');
    if (!query) throw new Error(`No feature record found for ${options.date}.`);
    const report = retrieveAnalogs(query, records, options);
    if (options.write) {
      const output = options.output ? path.resolve(options.output) : path.join(REPORT_DIR, `${query.eventDate ?? 'external'}-${options.role}.json`);
      writeJson(output, report); report.output = path.relative(ROOT, output).replaceAll('\\', '/');
    }
    if (options.json) console.log(JSON.stringify(report, null, 2)); else { printReport(report); if (report.output) console.log(`\nReport: ${report.output}`); }
  } catch (error) { console.error(error.stack ?? error.message); process.exitCode = 1; }
}
