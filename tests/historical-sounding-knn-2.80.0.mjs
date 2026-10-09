import assert from 'node:assert/strict';
import { Atmosphere } from '../js/atmosphere.js';
import { generateScenario } from '../js/scenarios/scenarioGenerator.js';

function scenario(seed) {
  return generateScenario(new Atmosphere(4, 4), seed);
}

const first = scenario(41);
const replay = scenario(41);
assert.deepEqual(first.soundingAnchors, replay.soundingAnchors, 'historical sounding sampling is deterministic');
assert.equal(first.analogGuidance.analogModel?.type, 'distance-weighted-k-nearest-neighbors');
assert.equal(first.soundingAnchors.learnedModelVersion, '2.81.0');
assert.equal(first.soundingAnchors.source, 'historical-knn-sounding-first-contract');
assert.ok(first.soundingAnchors.analogIds.length >= 10);

const rows = Array.from({ length: 60 }, (_, index) => scenario(index + 1)).map(config => {
  const anchor18 = config.soundingAnchors.anchors[1];
  const coherence = config.ingredientCoherence.score;
  const moisture = Math.max(0, Math.min(1, (anchor18.dewpointF + 1 - 55) / 17));
  return {
    learnedCape: config.soundingAnchors.learnedEnvironment.cape95Jkg,
    targetCape: anchor18.mlcape,
    coherenceNormalizedCape: anchor18.mlcape / ((0.82 + 0.38 * coherence) * (0.64 + 0.24 * moisture)),
    learnedShear: config.soundingAnchors.learnedEnvironment.shear06Ms * 1.94384,
    targetShear: anchor18.shearKt,
    learnedCin: config.soundingAnchors.learnedEnvironment.cinJkg,
    targetCin12: config.soundingAnchors.anchors[0].mlcin
  };
});

assert.ok(rows.every(row => Object.values(row).every(Number.isFinite)));
console.log({
  cases: rows.length,
  capeCorrelation: round(correlation(rows, 'learnedCape', 'targetCape')),
  normalizedCapeCorrelation: round(correlation(rows, 'learnedCape', 'coherenceNormalizedCape')),
  shearCorrelation: round(correlation(rows, 'learnedShear', 'targetShear')),
  cinCorrelation: round(correlation(rows, 'learnedCin', 'targetCin12')),
  targetCapeSpread: Math.round(standardDeviation(rows.map(row => row.targetCape)))
});
assert.ok(correlation(rows, 'learnedCape', 'coherenceNormalizedCape') > 0.25, 'historical CAPE controls target profiles');
assert.ok(correlation(rows, 'learnedShear', 'targetShear') > 0.90, 'historical shear controls target hodographs');
assert.ok(correlation(rows, 'learnedCin', 'targetCin12') > 0.30, 'historical inhibition controls translated morning caps');
assert.ok(standardDeviation(rows.map(row => row.targetCape)) > 180, 'learned seeds retain environmental diversity');

function correlation(rows, a, b) {
  const meanA = rows.reduce((sum, row) => sum + row[a], 0) / rows.length;
  const meanB = rows.reduce((sum, row) => sum + row[b], 0) / rows.length;
  let covariance = 0, varianceA = 0, varianceB = 0;
  for (const row of rows) {
    const da = row[a] - meanA, db = row[b] - meanB;
    covariance += da * db;
    varianceA += da * da;
    varianceB += db * db;
  }
  return covariance / Math.sqrt(varianceA * varianceB);
}
function standardDeviation(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / values.length);
}
function round(value) { return Number(value.toFixed(3)); }
