import assert from 'node:assert/strict';
import { categoryFromHazard, categoryFromDay3TotalSevere } from '../js/diagnostics/riskDiagnosis.js';

const tornado={
  2:['MRGN','MRGN','MRGN'],5:['SLGT','SLGT','SLGT'],10:['SLGT','ENH','ENH','ENH'],
  15:['ENH','ENH','MDT','MDT'],30:['ENH','MDT','HIGH','HIGH'],45:['ENH','MDT','HIGH','HIGH'],60:['ENH','HIGH','HIGH','HIGH']
};
const wind={
  5:['MRGN','MRGN','SLGT'],15:['SLGT','SLGT','ENH'],30:['SLGT','ENH','ENH'],
  45:['ENH','ENH','MDT','HIGH'],60:['ENH','MDT','HIGH','HIGH'],75:['ENH','MDT','HIGH','HIGH'],90:['ENH','MDT','HIGH','HIGH']
};
const hail={5:['MRGN','MRGN','SLGT'],15:['SLGT','SLGT','ENH'],30:['SLGT','ENH','ENH'],45:['ENH','ENH','MDT'],60:['ENH','MDT','MDT']};
for(const [hazard,table] of Object.entries({tornado,wind,hail})) for(const [prob,row] of Object.entries(table)) row.forEach((risk,cig)=>assert.equal(categoryFromHazard(hazard,Number(prob),cig),risk,`${hazard} ${prob} CIG${cig}`));
const day3={5:['MRGN','MRGN','SLGT'],15:['SLGT','SLGT','ENH'],30:['SLGT','ENH','ENH'],45:['ENH','ENH','MDT'],60:['ENH','MDT','MDT']};
for(const [prob,row] of Object.entries(day3)) row.forEach((risk,cig)=>assert.equal(categoryFromDay3TotalSevere(Number(prob),cig),risk));
assert.equal(categoryFromHazard('tornado',5,3),'SLGT','not-used tornado CIG3 falls to nearest valid SPC column');
assert.equal(categoryFromHazard('wind',30,3),'ENH','not-used wind CIG3 falls to nearest valid SPC column');
console.log('2.28.12 SPC matrix tests passed');
