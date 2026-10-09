import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSeedVerification } from '../js/verification/ForecastVerificationEngine.js';
import { critiqueVerification, aggregateCritiques } from '../js/verification/CalibrationCritic.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEIGHTS = JSON.parse(fs.readFileSync(path.join(ROOT, 'calibration/config/weights.json'), 'utf8')).weights;
const CORPUS_PATH = path.join(ROOT, 'calibration/cases/benchmark-corpus-v1.json');
const REPORT_DIR = path.join(ROOT, 'calibration/reports');
const RISK_RANK = Object.freeze({ NONE: 0, TSTM: 1, MRGL: 2, SLGT: 3, ENH: 4, MDT: 5, HIGH: 6 });

function readCorpus() {
  return JSON.parse(fs.readFileSync(CORPUS_PATH, 'utf8'));
}

function assertRange(name, range) {
  if (!Array.isArray(range) || range.length !== 2 || !range.every(Number.isFinite) || range[0] > range[1]) {
    throw new Error(`${name} must be an ascending two-number range.`);
  }
}

function validateCase(item, ids) {
  const errors = [];
  if (![1,2].includes(item?.schemaVersion)) errors.push('schemaVersion must equal 1 or 2');
  if (!/^[a-z0-9][a-z0-9-]+$/.test(item?.caseId ?? '')) errors.push('caseId is invalid');
  if (ids.has(item?.caseId)) errors.push('caseId is duplicated');
  ids.add(item?.caseId);
  if (!['calibration', 'validation', 'holdout'].includes(item?.split)) errors.push('split is invalid');
  if (!Number.isInteger(item?.simulation?.seed)) errors.push('simulation.seed must be an integer');
  if (!(item?.simulation?.hours >= 0.5 && item.simulation.hours <= 72)) errors.push('simulation.hours must be between 0.5 and 72');
  if (!(Number.isInteger(item?.simulation?.members) && item.simulation.members >= 1)) errors.push('simulation.members must be a positive integer');
  for (const key of ['riskRange', 'initiationRange', 'tornadoRange']) {
    try { assertRange(`targets.${key}`, item?.targets?.[key]); } catch (error) { errors.push(error.message); }
  }
  return errors;
}

function validateCorpus(corpus) {
  const failures = [];
  const ids = new Set();
  if (![1,2].includes(corpus?.schemaVersion)) failures.push('Corpus schemaVersion must equal 1 or 2.');
  if (!Array.isArray(corpus?.cases) || corpus.cases.length === 0) failures.push('Corpus must contain cases.');
  for (const item of corpus?.cases ?? []) {
    const errors = validateCase(item, ids);
    if (errors.length) failures.push(`${item?.caseId ?? '<unknown>'}: ${errors.join('; ')}`);
  }
  const splits = new Set((corpus?.cases ?? []).map(item => item.split));
  for (const split of ['calibration', 'validation', 'holdout']) {
    if (!splits.has(split)) failures.push(`Corpus is missing the ${split} split.`);
  }
  const hasNegative = (corpus?.cases ?? []).some(item => ['null', 'tstm'].includes(item.classification?.severity));
  const hasBust = (corpus?.cases ?? []).some(item => item.classification?.tags?.includes('bust'));
  if (!hasNegative) failures.push('Corpus needs at least one null/TSTM negative-control case.');
  if (!hasBust) failures.push('Corpus needs at least one bust/failed-initiation case.');
  return failures;
}

function latestRisk(report) {
  const verified = report?.forecast?.byDay?.day1?.latest?.forecastOverallRisk;
  const issued = report?.forecast?.latestIssuedByDay?.day1?.forecastOverallRisk;
  const label = verified ?? issued ?? 'UNAVAILABLE';
  return { label, rank: RISK_RANK[label] ?? 0, verificationStatus: verified ? 'VERIFIED' : (issued ? 'INCOMPLETE_TRUTH_WINDOW' : 'UNAVAILABLE') };
}

function rangeScore(value, [minimum, maximum]) {
  if (value >= minimum && value <= maximum) return 1;
  const span = Math.max(1, maximum - minimum + 1);
  const distance = value < minimum ? minimum - value : value - maximum;
  return Math.max(0, 1 - distance / span);
}

function scoreMember(caseDef, report) {
  const risk = latestRisk(report);
  const event = report.event ?? {};
  const initiationScore = rangeScore(event.initiations ?? 0, caseDef.targets.initiationRange);
  const tornadoScore = rangeScore(event.totalTornadoes ?? 0, caseDef.targets.tornadoRange);
  const riskScore = rangeScore(risk.rank, caseDef.targets.riskRange);
  const expectedModes = new Set(caseDef.targets.dominantModes ?? []);
  const observedModes = (event.dominantModes ?? []).map(mode => String(mode).toUpperCase());
  const modeScore = expectedModes.size === 0
    ? (observedModes.length === 0 ? 1 : 0.5)
    : (observedModes.some(mode => expectedModes.has(mode)) ? 1 : 0);
  const critic = critiqueVerification(report, caseDef.targets);
  const hazardScore = (tornadoScore * 0.55) + (initiationScore * 0.45);
  const score = (critic.environmentScore * WEIGHTS.environment) +
    (critic.consistencyScore * WEIGHTS.evolution) +
    (initiationScore * WEIGHTS.initiation) +
    (modeScore * WEIGHTS.stormMode) +
    (hazardScore * WEIGHTS.hazards) +
    (critic.spatialScore * WEIGHTS.spatial) +
    (riskScore * WEIGHTS.outlookCategory);
  return {
    seed: report.seed,
    score,
    risk,
    initiations: event.initiations ?? 0,
    tornadoes: event.totalTornadoes ?? 0,
    dominantModes: observedModes,
    components: { environment: critic.environmentScore, evolutionConsistency: critic.consistencyScore, spatial: critic.spatialScore, risk: riskScore, initiation: initiationScore, tornado: tornadoScore, stormMode: modeScore },
    critic,
    performance: report.performance
  };
}

function runCase(caseDef, memberOverride) {
  const count = memberOverride ?? caseDef.simulation.members;
  const members = [];
  for (let index = 0; index < count; index += 1) {
    const seed = caseDef.simulation.seed + index;
    const report = runSeedVerification(seed, { hours: caseDef.simulation.hours });
    members.push(scoreMember(caseDef, report));
    console.log(`[calibration] ${caseDef.caseId} member ${index + 1}/${count}: score=${members.at(-1).score.toFixed(3)}`);
  }
  const meanScore = members.reduce((sum, member) => sum + member.score, 0) / members.length;
  return {
    frameworkVersion: 1,
    generatedAt: new Date().toISOString(),
    caseId: caseDef.caseId,
    split: caseDef.split,
    classification: caseDef.classification,
    targets: caseDef.targets,
    simulation: { ...caseDef.simulation, members: count },
    meanScore,
    aggregate: aggregateCritiques(members),
    members
  };
}

function writeReport(name, report) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const destination = path.join(REPORT_DIR, `${name}.json`);
  fs.writeFileSync(destination, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`[calibration] wrote ${path.relative(ROOT, destination)}`);
}

function parseFlag(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const command = process.argv[2] ?? 'status';
const corpus = readCorpus();

if (command === 'validate') {
  const failures = validateCorpus(corpus);
  if (failures.length) {
    console.error(failures.map(item => `- ${item}`).join('\n'));
    process.exit(1);
  }
  console.log(`Calibration corpus valid: ${corpus.cases.length} cases across calibration, validation, and holdout splits.`);
} else if (command === 'status') {
  const counts = {};
  for (const item of corpus.cases) {
    const key = `${item.split}:${item.classification.severity}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  console.log(JSON.stringify({ corpusId: corpus.corpusId, cases: corpus.cases.length, coverage: counts }, null, 2));
} else if (command === 'case') {
  const caseId = process.argv[3];
  const caseDef = corpus.cases.find(item => item.caseId === caseId);
  if (!caseDef) throw new Error(`Unknown case '${caseId}'. Run npm run calibrate:status to inspect the corpus.`);
  const members = Number(parseFlag('--members')) || undefined;
  const report = runCase(caseDef, members);
  writeReport(`case-${caseDef.caseId}`, report);
} else if (command === 'suite') {
  const split = parseFlag('--split');
  const members = Number(parseFlag('--members')) || undefined;
  const selected = (split ? corpus.cases.filter(item => item.split === split) : corpus.cases).filter(item => item.status !== 'reference-only');
  if (!selected.length) throw new Error(`No cases matched split '${split}'.`);
  const reports = selected.map(item => runCase(item, members));
  const summary = {
    frameworkVersion: 1,
    corpusId: corpus.corpusId,
    split: split ?? 'all',
    generatedAt: new Date().toISOString(),
    meanScore: reports.reduce((sum, report) => sum + report.meanScore, 0) / reports.length,
    cases: reports.map(report => ({ caseId: report.caseId, split: report.split, meanScore: report.meanScore })),
    aggregate: aggregateCritiques(reports.flatMap(report => report.members)),
    reports
  };
  writeReport(`suite-${split ?? 'all'}`, summary);
} else {
  throw new Error(`Unknown calibration command '${command}'.`);
}
