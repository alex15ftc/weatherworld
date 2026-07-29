import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseSpcShapefileZip } from '../js/training/spc/SPCShapefileParser.js';

const fixture = process.env.SPC_20131117_ZIP;
if (!fixture || !fs.existsSync(fixture)) {
  console.log('2.35.2 layer-classification fixture skipped (set SPC_20131117_ZIP for archive regression)');
  process.exit(0);
}
const { normalizedProduct } = await parseSpcShapefileZip(fs.readFileSync(fixture), { forecastDay:'day1', issuedAt:'2013-11-17T13:00:00Z' });
assert.deepEqual([...new Set(normalizedProduct.hazards.categorical.map(x=>x.value))].sort(), ['HIGH','MDT','SLGT','TSTM']);
assert.deepEqual([...new Set(normalizedProduct.hazards.wind.map(x=>x.value))].sort((a,b)=>a-b), [0.05,0.15,0.30,0.45]);
assert.equal(normalizedProduct.hazards.significantTornado.length, 1);
assert.equal(normalizedProduct.hazards.significantWind.length, 1);
assert.equal(normalizedProduct.hazards.tornado.filter(x=>x.value===0.10).length, 1);
console.log('2.35.2 SPC shapefile layer classification: passed');
