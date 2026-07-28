import fs from 'node:fs';
import { Atmosphere } from '../js/atmosphere.js';
import { generateScenario } from '../js/scenarios/scenarioGenerator.js';
import { runSeedVerification } from '../js/verification/ForecastVerificationEngine.js';

const seeds = (process.argv[2] ?? '1,2,3,4,5,9,20,69')
  .split(',').map(Number).filter(Number.isFinite);
const hours = Number(process.argv[3] ?? 12);
const output = process.argv[4] ?? 'verification-runs/setup-sample.json';
const rows = [];

for (const seed of seeds) {
  const setupWorld = new Atmosphere(4, 4);
  const config = generateScenario(setupWorld, seed);
  console.log(`VERIFY seed=${seed} setup=${config.setupType} topology=${config.boundaryTopology.join('+') || 'none'}`);
  const report = runSeedVerification(seed, { hours });
  const day1 = report.forecast?.byDay?.day1;
  rows.push({
    seed,
    setupType: config.setupType,
    narrative: config.narrative,
    topology: config.boundaryTopology,
    event: report.event,
    forecast: {
      products: day1?.count ?? 0,
      meanScore: day1?.meanScore ?? null,
      forecastRisk: day1?.latest?.forecastOverallRisk ?? null,
      observedRisk: day1?.latest?.observedOverallRisk ?? null
    },
    recommendations: report.recommendations
  });
}

const summary = {
  seeds,
  hours,
  stormsCreated: rows.reduce((sum, row) => sum + row.event.stormsCreated, 0),
  tornadoes: rows.reduce((sum, row) => sum + row.event.totalTornadoes, 0),
  rows
};
fs.mkdirSync('verification-runs', { recursive: true });
fs.writeFileSync(output, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
