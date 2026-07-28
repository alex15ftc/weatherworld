import assert from 'node:assert/strict';
import { captureSixHourlyEnvironmentSample } from '../js/verification/ForecastVerificationEngine.js';

const makeCell = (x, y) => ({
  surface: { temperature: 68 + x, dewpoint: 55 + y },
  derived: {
    cape: 800 + x * 250 + y * 100,
    cin: 25 + y * 5,
    dcape: 500 + x * 100,
    srh: 90 + y * 40,
    bulkShear: 25 + x * 8,
    lclAgl: 900 + y * 100,
    lapseRate700500: 6.5 + x * .2,
    stp: .4 + x * .3 + y * .2,
    risk: x + y > 1 ? 'SLGT' : 'MRGN',
    diagnostics: { forcing: .3 + x * .1, realizedUpdraftMs: 18 + x, coldPoolSpeedMs: 10 + y }
  },
  dynamics: { forcingScore: .35 + x * .1, initiationPotential: .25 + y * .15 },
  forecast: { initiationProbability: .3 + y * .2, stormCoverage: .2 + x * .15 }
});
const world = {
  width: 3, height: 2, cellSizeKm: 10, validHourUtc: 0,
  forEachCell(callback) { for (let y=0;y<this.height;y++) for (let x=0;x<this.width;x++) callback(makeCell(x,y),x,y); }
};
const samples=[];
captureSixHourlyEnvironmentSample(world,samples);
world.validHourUtc=3; captureSixHourlyEnvironmentSample(world,samples);
world.validHourUtc=6; captureSixHourlyEnvironmentSample(world,samples);
captureSixHourlyEnvironmentSample(world,samples);
world.validHourUtc=12; captureSixHourlyEnvironmentSample(world,samples);
assert.deepEqual(samples.map(sample=>sample.hourUtc),[0,6,12]);
for(const sample of samples){
  assert.equal(sample.sampleIntervalHours,6);
  assert.equal(sample.domainSummary.cellCount,6);
  assert.ok(Number.isFinite(sample.domainSummary.maximum.cape));
  assert.ok(Number.isFinite(sample.domainSummary.percentile90.bulkShear));
  assert.equal(sample.representativeSamples.length,7);
  assert.ok(sample.representativeSamples.every(point=>Number.isFinite(point.centerKm.x)&&Number.isFinite(point.centerKm.y)));
}
console.log('2.28.14.2 six-hour environment verification samples passed');
