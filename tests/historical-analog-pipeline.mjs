import assert from 'node:assert/strict';
import { scoreOutbreak, intensityBand } from '../js/analogs/OutbreakIntensity.js';
import { generateSeedFromAnalogs, selectAnalogEnsemble } from '../js/analogs/AnalogSeedGenerator.js';

const events=[];
for(let i=0;i<18;i++)events.push({eventType:'Tornado',torFScale:i<3?'EF4':i<11?'EF2':'EF1',latitude:33+i*.12,longitude:-99+i*.2,beginHourUtc:20+(i%4)});
for(let i=0;i<42;i++)events.push({eventType:'Hail',magnitude:i<25?2.5:1.25,latitude:32+i*.08,longitude:-100+i*.13,beginHourUtc:19+(i%6)});
for(let i=0;i<55;i++)events.push({eventType:'Thunderstorm Wind',magnitude:i<38?80:60,latitude:34+i*.06,longitude:-101+i*.11,beginHourUtc:21+(i%7)});
const intensity=scoreOutbreak(events,{year:2011});
assert.ok(intensity.score>45);
assert.equal(intensity.band,intensityBand(intensity.score));
assert.equal(intensity.counts.violentTornado,3);

const pattern={family:'shortwave_ejection',troughAmplitude:.88,troughTilt:-.7,lowLevelJetStrength:.86,moistureQuality:.9,capStrength:.45,forcingTiming:.82};
const catalog=Array.from({length:14},(_,i)=>({analogId:`event-${i}`,eventDate:`20${String(10+i).padStart(2,'0')}-05-01`,season:'spring',intensity:{score:61+i,band:'major'},pattern:{...pattern,troughAmplitude:pattern.troughAmplitude-i*.005}}));
const selected=selectAnalogEnsemble(catalog,{seed:42,targetBand:'major',family:'shortwave_ejection',count:10});
assert.equal(selected.length,10);
assert.ok(Math.abs(selected.reduce((sum,row)=>sum+row.weight,0)-1)<1e-9);
const generated=generateSeedFromAnalogs(catalog,{seed:42,targetBand:'major',family:'shortwave_ejection'});
assert.equal(generated.analogDriven,true);
assert.equal(generated.targetIntensityBand,'major');
assert.ok(generated.latentPattern.moistureQuality>0);
console.log('historical analog pipeline passed');
