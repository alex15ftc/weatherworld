import { Atmosphere } from '../atmosphere.js';
import { generateScenario } from '../scenarios/scenarioGenerator.js';
import { initializeEvolution, advanceAtmosphere } from '../evolution.js';
import { SIMULATION_CONFIG } from '../simulationConfig.js';
import { serializeStormInternalField } from '../storms/StormInternalField.js';

let atmosphere = null;
let config = null;
let seed = 20270503;

self.onmessage = async event => {
  const { id, type, payload = {} } = event.data ?? {};
  try {
    if (type === 'init') ensure(payload.seed);
    if (type === 'advance') { ensure(payload.seed); advanceAtmosphere(atmosphere, Number(payload.hours) || 0.5); }
    const result = handle(type, payload);
    self.postMessage({ id, ok: true, result });
  } catch (error) { self.postMessage({ id, ok: false, error: error?.message ?? String(error) }); }
};

function ensure(nextSeed = seed) {
  if (atmosphere && Number(nextSeed) === seed) return;
  seed = Number(nextSeed) || 20270503;
  atmosphere = new Atmosphere(SIMULATION_CONFIG.fixedColumns, SIMULATION_CONFIG.fixedRows);
  config = generateScenario(atmosphere, seed);
  initializeEvolution(atmosphere, config);
}

function handle(type, payload) {
  ensure(payload.seed);
  if (type === 'radar') throw new Error('Radar is archived in milestone 2.25.0');
  if (type === 'outlook') return atmosphere.outlookCycle?.products?.[payload.day] ?? null;
  if (type === 'state' || type === 'init' || type === 'advance') return compactState();
  if (type === 'field') return fieldProduct(payload.product);
  throw new Error(`Unknown worker request: ${type}`);
}

function fieldProduct(product = 'temperature') {
  const values = atmosphere.cells.map(row => row.map(cell => Number(resolveField(cell, product)) || 0));
  return { product, width: atmosphere.width, height: atmosphere.height, validHourUtc: atmosphere.validHourUtc, values };
}
function resolveField(cell, product) {
  const paths = {
    temperature: cell.surface?.temperatureF, dewpoint: cell.surface?.dewpointF, pressure: cell.surface?.pressureMb,
    cape: cell.thermodynamics?.capeJkg, cin: cell.thermodynamics?.cinJkg, srh: cell.kinematics?.srh01M2s2,
    shear: cell.kinematics?.bulkShear06Kt, forcing: cell.diagnostics?.forcingScore,
    verticalMotion: cell.diagnostics?.verticalVelocityMs, initiation: cell.mesoscale?.initiationFocus
  };
  return paths[product] ?? cell.surface?.temperatureF ?? 0;
}
function compactState() {
  return {
    seed, validHourUtc: atmosphere.validHourUtc, width: atmosphere.width, height: atmosphere.height,
    cells: atmosphere.cells, evolution: atmosphere.evolution, analysis: atmosphere.analysis,
    storms: (atmosphere.storms ?? []).map(s => ({ ...s, internalField: serializeStormInternalField(s.internalField) })),
    mesoscale: atmosphere.mesoscale, regions: atmosphere.regions, outlookCycle: atmosphere.outlookCycle,
    radarNetwork: atmosphere.radarNetwork, config
  };
}
