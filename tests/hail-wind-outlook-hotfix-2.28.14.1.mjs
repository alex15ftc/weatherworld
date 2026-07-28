import assert from 'node:assert/strict';
import { diagnoseOutlookRealizationChain } from '../js/storms/StormRealizationPhysics.js';
import { WeatherAuthorityRuntime } from '../server/WeatherAuthorityRuntime.js';

const cell = {
  forecast: { stormCoverage: 0.72, discreteFraction: 0.35, linearFraction: 0.78 },
  derived: { diagnostics: { forcing: 0.76, boundaryInfluence: 0.42, processedAir: 0.05 } }
};
const projected = {
  cape: 2400, cin: 25, srh: 80, shear: 38, lcl: 1450,
  capErosion: 0.85, moistureTransport: 0.75, initiationProbability: 0.82
};
const chain = diagnoseOutlookRealizationChain(cell, projected);
assert.ok(chain.atLeastOneHailStorm > 0, 'hail opportunity should exist');
assert.ok(chain.atLeastOneWindStorm > 0, 'wind opportunity should exist');
assert.ok(chain.atLeastOneWindStorm > 0.25, 'wind opportunity should remain meaningful for a linear/cold-pool setup');

const runtime = new WeatherAuthorityRuntime({ seed: 20270503, checkpointPath: '/tmp/wsim-hotfix-checkpoint.json' });
runtime.atmosphere.storms = [{
  id:'TEST-HAIL', active:true, positionKm:{x:100,y:100}, previousPositionKm:{x:99,y:100}, velocityKph:{east:20,north:0},
  lifecycleState:'mature', ageHours:2, intensity:.8, maxIntensity:.9, organization:.6, updraftStrength:.8,
  mode:'multicell', surfaceWind:{maxSustainedMph:54,maxGustMph:69}, hazards:{hailSizeInches:1.5},
  hazardExtremes:{tornado:{maxWindMph:0,maxEfRating:null,maxWidthYards:0,maxPathLengthKm:0,cycles:0},wind:{maxSustainedMph:54,maxGustMph:69},hail:{maxSizeInches:2.25}}
}];

let maxHail = 0, maxWind = 0;
for (const row of runtime.atmosphere.cells) for (const c of row) for (const day of ['day1','day2','day3']) {
  const outlook = c.predictiveOutlook?.[day] ?? {};
  maxHail = Math.max(maxHail, Number(outlook.hailProbability) || 0);
  maxWind = Math.max(maxWind, Number(outlook.windProbability) || 0);
}
assert.ok(maxHail >= 5, 'hail outlook should publish at least a 5% contour in the regression seed');
assert.ok(maxWind >= 5, 'wind outlook should publish at least a 5% contour in the regression seed');

const snapshot = runtime.storms().storms[0];
assert.equal(snapshot.hazardExtremes.hail.maxSizeInches, 2.25, 'maximum hail must survive public authority snapshot');
assert.equal(snapshot.hazardExtremes.wind.maxGustMph, 69, 'maximum wind must survive public authority snapshot');
assert.equal(runtime.metadata().version, '2.28.14.1');
console.log('2.28.14.1 hail/wind hotfix regression passed');
