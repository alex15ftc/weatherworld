import assert from 'node:assert/strict';
import { generateSeededGrid } from '../scripts/generate-seeded-grid.mjs';
const normalization={features:{
 'thermodynamics.capeMeanJkg':{mean:1200,standardDeviation:500,p10:200,p90:3000},'thermodynamics.capeP90Jkg':{mean:2200,standardDeviation:700,p10:500,p90:4200},'thermodynamics.capeMaxJkg':{mean:3000,standardDeviation:900,p10:800,p90:5500},'thermodynamics.cinMeanJkg':{mean:65,standardDeviation:30,p10:5,p90:150},'thermodynamics.dewpointP90K':{mean:293,standardDeviation:4,p10:285,p90:300},
 'windProfile.shear850To500Ms':{mean:18,standardDeviation:5,p10:8,p90:30},'windProfile.wind250P90Ms':{mean:45,standardDeviation:10,p10:25,p90:70},'synoptic.jetStrengthMs':{mean:45,standardDeviation:10,p10:25,p90:75},'synoptic.forcingInstabilityOverlapProxy':{mean:.45,standardDeviation:.18,p10:.1,p90:.8},'spatialDirect.capeCorridorOrientationDeg':{mean:150,standardDeviation:25,p10:80,p90:179}
}};
const seedRecord=(await import('../scripts/generate-atmospheric-seed.mjs')).generateAtmosphericSeed('grid-test',{normalization,analogs:false});
const a=generateSeededGrid(seedRecord,{rows:18,cols:24,cellSizeKm:10,analogs:false});
const b=generateSeededGrid(seedRecord,{rows:18,cols:24,cellSizeKm:10,analogs:false});
assert.equal(a.grid.coordinateSystem,'fictional-world-grid'); assert.equal(a.fields.capeJkg.length,432); assert.equal(a.regions.length,432); assert.equal(a.validation.valid,true);
assert.deepEqual(a.fields,b.fields); assert.deepEqual(a.blueprint,b.blueprint);
assert.ok(new Set(a.regions).size>=4); assert.ok(Math.max(...a.fields.elevationM)>1200); assert.ok(Math.max(...a.fields.capeJkg)>500);
console.log('2.41.1 fictional-world seed-to-grid synthesis PASS');
