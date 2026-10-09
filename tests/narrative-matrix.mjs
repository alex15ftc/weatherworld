import assert from 'node:assert/strict';
import { Atmosphere } from '../js/atmosphere.js';
import { generateScenario } from '../js/scenarios/scenarioGenerator.js';
import { initializeEvolution } from '../js/evolution.js';

const matrix = {};
for (let seed = 1; seed <= 400; seed += 1) {
  const world = new Atmosphere(50, 50);
  const config = generateScenario(world, seed);
  initializeEvolution(world, config);
  const narrative = config.narrative ?? 'unknown';
  const risk = world.evolution.outlookAnalysis.overallRisk;
  matrix[narrative] ??= { TSTM: 0, MRGN: 0, SLGT: 0, ENH: 0, MDT: 0, HIGH: 0 };
  assert.ok(risk in matrix[narrative], `Unknown risk category: ${risk}`);
  matrix[narrative][risk] += 1;
}
console.log(JSON.stringify(matrix, null, 2));
