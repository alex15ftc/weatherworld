import assert from 'node:assert/strict';
import { Atmosphere } from '../js/atmosphere.js';
import { generateScenario } from '../js/scenarios/scenarioGenerator.js';
import { initializeEvolution, advanceAtmosphere } from '../js/evolution.js';
import { SIMULATION_CONFIG } from '../js/simulationConfig.js';
import { updateCellDiagnostics } from '../js/sounding.js';

function soundingCell(elevationM) {
  return {
    validHourUtc: 18,
    surface: { pressure: 960, temperature: 82, dewpoint: 67, wind: { direction: 165, speed: 17 } },
    terrain: { elevationM },
    levels: {
      850: { temperature: 19, windDirection: 185, windSpeed: 34 },
      700: { temperature: 8, windDirection: 215, windSpeed: 42 },
      500: { temperature: -17, windDirection: 235, windSpeed: 54 },
      250: { temperature: -49, windDirection: 250, windSpeed: 82 }
    },
    features: { warmSector: true, synopticAscent: 0.7, synopticCoherence: 0.85 },
    mesoscaleFields: { ascent: 0.55, moisturePooling: 0.65, capErosion: 0.5 },
    dynamics: { forcingScore: 0.62, triggerStrength: 0.56, convectiveReadiness: 0.75, initiationPotential: 0.4 },
    derived: {}
  };
}

const low = soundingCell(100);
const high = soundingCell(1100);
updateCellDiagnostics(low);
updateCellDiagnostics(high);
assert.ok(Math.abs(low.derived.stpComponents.lclTerm - high.derived.stpComponents.lclTerm) < 1e-9,
  'STP cloud-base term must use AGL rather than penalizing elevated terrain');
assert.ok(low.derived.stpComponents.lclTerm <= 1 && high.derived.stpComponents.lclTerm <= 1,
  'SPC-style LCL contribution is capped at one');
assert.ok(low.derived.stpComponents.cinTerm <= 1, 'SPC-style CIN contribution is capped at one');

for (const seed of [1, 16]) {
  const sample = new Atmosphere(2, 2);
  const config = generateScenario(sample, seed);
  assert.equal(config.narrative, 'classic_tornado_outbreak');
  assert.equal(config.scenarioEvolution.fastTornadogenesis, true);
  assert.ok(config.scenarioEvolution.peakHour >= 8 && config.scenarioEvolution.peakHour <= 18,
    'classic outbreak must peak in its first convective cycle');
}

const world = new Atmosphere(SIMULATION_CONFIG.fixedColumns, SIMULATION_CONFIG.fixedRows);
const config = generateScenario(world, 25);
initializeEvolution(world, config);
const warmSector = () => world.cells.flat().filter(cell =>
  cell.features?.warmSector || (cell.forecast?.openWarmSectorSupport ?? 0) > 0.35);
const maximum = selector => Math.max(...warmSector().map(cell => Number(selector(cell)) || 0));
const initial = {
  stp: maximum(cell => cell.derived.stp),
  cape: maximum(cell => cell.derived.cape),
  dewpoint: maximum(cell => cell.surface.dewpoint)
};
advanceAtmosphere(world, 3);
const developing = {
  stp: maximum(cell => cell.derived.stp),
  cape: maximum(cell => cell.derived.cape),
  dewpoint: maximum(cell => cell.surface.dewpoint)
};
assert.ok(developing.stp > initial.stp, 'significant-event STP should strengthen toward peak');
assert.ok(developing.cape > initial.cape, 'significant-event CAPE should strengthen toward peak');
assert.ok(developing.dewpoint >= initial.dewpoint, 'significant-event moisture axis should not dry before peak');

console.log('2.30.0 significant-event strengthening regression passed');
