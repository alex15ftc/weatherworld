// Weather systems follow one another in a deterministic sequence: each seed names the next.
// A system's starting world depends only on its seed, so it can be built ahead of time (for
// the outlooks that look past the end of the current system, and for the switch itself).
import { Atmosphere } from '../atmosphere.js';
import { generateScenario } from '../scenarios/scenarioGenerator.js';
import { initializeEvolution } from '../evolution.js';
import { SIMULATION_CONFIG } from '../simulationConfig.js';

export function nextSystemSeed(seed) {
  let h = (Math.imul((Number(seed) >>> 0) ^ 0x9e3779b9, 2654435761) + 0x85ebca6b) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h = (h ^ (h >>> 12)) >>> 0;
  return h % 100000000;
}

// The system's world at its first hour. Outlooks are not issued here; the host starts the
// outlook cycle when the world becomes the authoritative one.
export function buildSystemWorld(seed, profile = { name: 'gameplay', outlookIssuance: 'off' }) {
  const world = new Atmosphere(SIMULATION_CONFIG.fixedColumns, SIMULATION_CONFIG.fixedRows);
  const config = generateScenario(world, seed);
  initializeEvolution(world, config, { profile });
  return world;
}
