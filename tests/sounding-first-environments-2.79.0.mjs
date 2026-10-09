import assert from 'node:assert/strict';
import { Atmosphere } from '../js/atmosphere.js';
import { generateScenario } from '../js/scenarios/scenarioGenerator.js';
import { initializeEvolution, advanceAtmosphere } from '../js/evolution.js';

const world = new Atmosphere(32, 24);
const config = generateScenario(world, 4);
const schedule = config.soundingAnchors;
assert.equal(schedule.profileVersion, '2.79.0');
assert.ok(['sounding-first-12z-18z-00z-profile-contract','historical-knn-sounding-first-contract'].includes(schedule.source));

for (const anchor of schedule.anchors) {
  const p = anchor.profile;
  assert.ok(p?.surface && p[850] && p[700] && p[500] && p[250], `${anchor.hourUtc}Z has a complete target profile`);
  assert.ok(p.surface.temperatureF > p.surface.dewpointF, `${anchor.hourUtc}Z surface is unsaturated`);
  assert.ok(p[850].temperatureC > p[700].temperatureC && p[700].temperatureC > p[500].temperatureC, `${anchor.hourUtc}Z cools with height`);
  assert.ok(p[850].dewpointC <= p[850].temperatureC && p[700].dewpointC <= p[700].temperatureC, `${anchor.hourUtc}Z moisture is physical`);
  assert.ok(p[500].windSpeedKt > p.surface.windSpeedKt, `${anchor.hourUtc}Z has deep-layer shear`);
  assert.ok(p[250].windSpeedKt >= p[500].windSpeedKt, `${anchor.hourUtc}Z upper jet is vertically consistent`);
}

initializeEvolution(world, config);
advanceAtmosphere(world, 6, { advanceStorms: false });
const corridor = [];
world.forEachCell(cell => {
  if ((cell.features?.soundingCorridor?.influence ?? 0) >= 0.65) corridor.push(cell);
});
assert.ok(corridor.length >= 12);
const mean = getter => corridor.reduce((sum, cell) => sum + getter(cell), 0) / corridor.length;
assert.ok(mean(cell => cell.derived.cape) >= 1000, '18Z corridor realizes useful buoyancy from its profile');
assert.ok(mean(cell => cell.derived.cin) <= 60, '18Z corridor profile is broadly releasable');
assert.ok(mean(cell => cell.derived.bulkShear) >= 40, '18Z corridor realizes organized-storm shear');
assert.ok(corridor.every(cell => cell.severeWeather.targetSounding?.profile?.[500]), 'live guidance exposes the interpolated profile');

console.log({
  corridorCells: corridor.length,
  meanMlcape: Math.round(mean(cell => cell.derived.cape)),
  meanMlcin: Math.round(mean(cell => cell.derived.cin)),
  meanShearKt: Math.round(mean(cell => cell.derived.bulkShear)),
  meanSrh: Math.round(mean(cell => cell.derived.srh))
});
