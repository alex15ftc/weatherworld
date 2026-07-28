import assert from 'node:assert/strict';
import { buildAtmosphericEnvironmentSample, summarizeStorms } from '../js/verification/ForecastVerificationEngine.js';

const cells = Array.from({ length: 2 }, (_, y) => Array.from({ length: 2 }, (_, x) => ({
  surface: { temperature: 64 + x * 6, dewpoint: 55 + y, pressure: 990, wind: { direction: 180, speed: 25 } },
  levels: { 850:{temperature:14,heightDm:145,windDirection:190,windSpeed:35},700:{temperature:5,heightDm:300,windDirection:220,windSpeed:45},500:{temperature:-18,heightDm:570,windDirection:250,windSpeed:60},250:{temperature:-48,heightDm:1040,windDirection:270,windSpeed:95} },
  features: { warmSector: x === 1 },
  derived: { cape: 1000 + x * 1200, cin: 80 - x * 50, dcape: 650, srh: 180, bulkShear: 50, lcl: 900, stp: 1.2, risk:'SLGT', diagnostics:{ energyBudget:{ netTemperatureTendencyFph: x ? 1.4 : 0.1, netDewpointTendencyFph: x ? .2 : -.1, preConvectiveRecovery: x ? .8 : 0 } } },
  dynamics: { forcingScore:.4, initiationPotential:.2 }, forecast:{ initiationProbability:.2, stormCoverage:.2, openWarmSectorSupport:x }
})));
const world={width:2,height:2,cellSizeKm:10,forEachCell(cb){for(let y=0;y<2;y++)for(let x=0;x<2;x++)cb(cells[y][x],x,y);}};
const sample=buildAtmosphericEnvironmentSample(world,18);
assert.equal(sample.warmSectorSummary.cellCount,2);
assert.ok(sample.warmSectorSummary.mean.surfaceTemperatureF > sample.domainSummary.mean.surfaceTemperatureF);
assert.ok(sample.warmSectorSummary.mean.netTemperatureTendencyFph > 1);

const [storm]=summarizeStorms([{
  id:'storm-1', parentId:null, mode:'discrete supercell', createdHourUtc:23.5, active:true, ageHours:1.5,
  maxIntensity:.8, peakUpdraftStrength:.9, peakRotationStrength:.7, peakColdPoolStrength:.5,
  mesocycloneCycle:{cyclesCompleted:2}, lifecycle:{transitionCount:3}, hazardExtremes:{tornado:{},wind:{},hail:{}}, surfaceWind:{}, trackKm:30
}]);
assert.equal(storm.startedHourUtc,23.5);
assert.equal(storm.startedDay,1);
assert.equal(storm.startedTimeLabel,'Day 1 23:30Z');
assert.equal(storm.diagnostics.peakColdPoolStrength,.5);
console.log('2.28.15 verification diagnostics regression passed');
