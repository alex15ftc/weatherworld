import assert from 'node:assert/strict';
import { spacingFor, acceptedSpacing } from '../js/storms/InitiationEngine.js';
import { initializeCoupledAtmosphere } from '../js/coupling/CoupledAtmosphereEngine.js';

const world = { cellSizeKm: 10 };
const clusteredCell = {
  derived: { cinMagnitude: 20 },
  forecast: { stormCoverage: 0.8, discreteFraction: 0.25, linearFraction: 0.65, initiationCorridor: 0.8 },
  mesoscaleFields: { convergenceCorridor: 0.8 },
  features: { stormProcessedAir: 0.05 }
};
const isolatedCell = {
  derived: { cinMagnitude: 100 },
  forecast: { stormCoverage: 0.3, discreteFraction: 0.9, linearFraction: 0.05, initiationCorridor: 0.2 },
  mesoscaleFields: { convergenceCorridor: 0.2 },
  features: { stormProcessedAir: 0.05 }
};
assert.ok(spacingFor(world, clusteredCell) >= 9, 'spacing must respect roughly one grid-cell scale');
assert.ok(spacingFor(world, clusteredCell) < 20, 'clustered convection should allow neighboring 10 km cells');
assert.ok(spacingFor(world, isolatedCell) > spacingFor(world, clusteredCell), 'discrete storms should retain wider spacing than clustered storms');
assert.ok(acceptedSpacing(world, { corridorId:'a', corridorStrength:.8 }, { corridorId:'a' }) < acceptedSpacing(world, { corridorId:'a', corridorStrength:.2 }, { corridorId:'b' }), 'same strong corridor should allow denser initiation');

const mockWorld = { cellSizeKm:10, validHourUtc:0, forEachCell(){} };
initializeCoupledAtmosphere(mockWorld);
assert.equal(mockWorld.coupledAtmosphere.cellAreaKm2, 100, '10 km cells must be treated as 100 km²');
console.log('2.52.0 environmental feedback and density regression: PASS');
