import assert from 'node:assert/strict';
import { Atmosphere } from '../js/atmosphere.js';
import { generateScenario } from '../js/scenarios/scenarioGenerator.js';
import { initializeEvolution, advanceAtmosphere } from '../js/evolution.js';

for (const seed of [1, 4, 5, 8]) {
  const world = new Atmosphere(50, 40);
  const config = generateScenario(world, seed);

  assert.equal(config.patternOrientation, 0, `seed ${seed}: cardinal rotation returned`);
  assert.equal(config.patternMirror, false, `seed ${seed}: geographic source regions were mirrored`);
  assert.ok(
    Math.abs(config.patternRotationDegrees) <= 18,
    `seed ${seed}: implausible pattern rotation ${config.patternRotationDegrees}`
  );

  initializeEvolution(world, config);
  validateTopology(world, config, seed, 0);
  advanceAtmosphere(world, 6);
  validateTopology(world, config, seed, 6);
}

console.log('Structural realism passed: coherent primary fronts across four seeds and six forecast hours.');

function validateTopology(world, config, seed, hour) {
  const boundaries = world.mesoscale?.boundaries ?? [];
  const types = boundaries.map(boundary => boundary.type);
  assert.equal(new Set(types).size, types.length, `seed ${seed} +${hour}h: duplicate primary boundary`);
  assert.deepEqual(
    [...types].sort(),
    [...config.boundaryTopology].sort(),
    `seed ${seed} +${hour}h: setup topology was not preserved`
  );

  for (const boundary of boundaries) {
    assert.equal(
      selfIntersections(boundary.pointsKm),
      0,
      `seed ${seed} +${hour}h: ${boundary.type} front self-intersects`
    );
  }
}

function selfIntersections(points) {
  let count = 0;
  for (let i = 0; i < points.length - 1; i++) {
    for (let j = i + 2; j < points.length - 1; j++) {
      if (segmentsIntersect(points[i], points[i + 1], points[j], points[j + 1])) count++;
    }
  }
  return count;
}

function segmentsIntersect(a, b, c, d) {
  const cross = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0;
}
