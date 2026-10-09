import assert from 'node:assert/strict';
import { Atmosphere } from '../js/atmosphere.js';
import { advanceConservativeTransport } from '../js/atmosphere/ConservativeTransportEngine.js';
import { initializeBoundaryLayer, advanceBoundaryLayer } from '../js/atmosphere/BoundaryLayerEngine.js';
import { diagnoseStormRealizationPhysics } from '../js/storms/StormRealizationPhysics.js';

const world = new Atmosphere(8, 6);
world.validHourUtc = 18;
world.forEachCell((cell, x) => {
  cell.surface.temperature = 65 + x;
  cell.surface.dewpoint = 48 + x * 0.7;
  cell.surface.seaLevelPressure = 1004 + x * 0.4;
  cell.surface.wind = { direction: 270, speed: 35 };
});
const initialTemperatures = world.cells.flat().map(cell => cell.surface.temperature);
const initialDewpoints = world.cells.flat().map(cell => cell.surface.dewpoint);
advanceConservativeTransport(world, 0.5);
assert.equal(world.transportDiagnostics.method, 'mass-normalized-finite-volume-upwind');
assert.ok(world.transportDiagnostics.substeps >= 1);
assert.ok(world.transportDiagnostics.conservationError.temperature < 1e-10);
assert.ok(world.transportDiagnostics.conservationError.moisture < 1e-10);
assert.ok(world.transportDiagnostics.conservationError.pressureAnomaly < 1e-10);
assert.ok(world.transportDiagnostics.conservationError.mass < 1e-10);
const transportedTemperatures = world.cells.flat().map(cell => cell.surface.temperature);
const transportedDewpoints = world.cells.flat().map(cell => cell.surface.dewpoint);
assert.ok(Math.max(...transportedTemperatures) <= Math.max(...initialTemperatures) + 1e-9);
assert.ok(Math.min(...transportedTemperatures) >= Math.min(...initialTemperatures) - 1e-9);
assert.ok(Math.max(...transportedDewpoints) <= Math.max(...initialDewpoints) + 1e-9);
assert.ok(Math.min(...transportedDewpoints) >= Math.min(...initialDewpoints) - 1e-9);

initializeBoundaryLayer(world);
const beforeDepth = world.getCell(3, 2).boundaryLayer.depthM;
advanceBoundaryLayer(world, 1);
const boundaryLayer = world.getCell(3, 2).boundaryLayer;
assert.ok(boundaryLayer.depthM > beforeDepth);
assert.ok(boundaryLayer.sensibleHeatFluxWm2 > 0);
assert.ok(Number.isFinite(boundaryLayer.inversionStrength));

const base = {
  cape: 2600, cin: 45, bulkShear: 42, srh: 180, lcl: 900, lfc: 1450,
  equilibriumLevel: 11000, forcing: 0.65, moisturePooling: 0.65,
  parcelReleaseFraction: 0.85, boundaryLayerDepthM: 1400,
  surfaceDewpointDepressionF: 12, midlevelLapseRate: 7.4
};
const moist = diagnoseStormRealizationPhysics(base);
const dryShallow = diagnoseStormRealizationPhysics({
  ...base, boundaryLayerDepthM: 350, surfaceDewpointDepressionF: 38, parcelReleaseFraction: 0.45
});
assert.ok(moist.realizedUpdraftMs > dryShallow.realizedUpdraftMs);
assert.ok(moist.entrainmentEfficiency > dryShallow.entrainmentEfficiency);
assert.ok(moist.parcelReleaseFraction > dryShallow.parcelReleaseFraction);
console.log('2.74.0 conservative transport, boundary layer, lift release, and entrainment checks passed');
