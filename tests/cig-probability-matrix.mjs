import assert from 'node:assert/strict';
import { categoryFromHazard, diagnoseCellEnvironment } from '../js/diagnostics/riskDiagnosis.js';

const tornado = {
  2: ['MRGN','MRGN','SLGT','TSTM'],
  5: ['SLGT','SLGT','ENH','TSTM'],
  10:['SLGT','ENH','ENH','ENH'],
  15:['ENH','ENH','MDT','MDT'],
  30:['ENH','MDT','HIGH','HIGH'],
  45:['ENH','MDT','HIGH','HIGH'],
  60:['ENH','HIGH','HIGH','HIGH']
};
const wind = {
  5:['MRGN','MRGN','SLGT','TSTM'],
  15:['SLGT','SLGT','ENH','TSTM'],
  30:['SLGT','ENH','ENH','TSTM'],
  45:['ENH','ENH','MDT','HIGH'],
  60:['ENH','MDT','HIGH','HIGH'],
  75:['ENH','MDT','HIGH','HIGH'],
  90:['ENH','MDT','HIGH','HIGH']
};
const hail = {
  5:['MRGN','MRGN','SLGT'],
  15:['SLGT','SLGT','ENH'],
  30:['SLGT','ENH','ENH'],
  45:['ENH','ENH','MDT'],
  60:['ENH','MDT','MDT']
};
for (const [hazard, table] of Object.entries({tornado,wind,hail})) {
  for (const [probability,row] of Object.entries(table)) {
    for (let cig=0;cig<row.length;cig++) {
      const expected=row[cig];
      if (expected==='TSTM') continue; // chart marks these combinations "not used"
      assert.equal(categoryFromHazard(hazard, Number(probability), cig), expected, `${hazard} ${probability}% CIG${cig}`);
    }
  }
}

function makeCell(overrides={}) {
  return {
    surface:{dewpoint:62,seaLevelPressure:1005},
    features:{front:'none',dryline:false,outflowBoundary:false},
    levels:{500:{windSpeed:50},700:{temperatureC:0},850:{temperatureC:10}},
    dynamics:{convectiveReadiness:.7,triggerStrength:.7,initiationPotential:.7},
    forecast:{stormCoverage:.95,discreteFraction:.95,linearFraction:.05,conditionalTornadoIntensity:.95},
    derived:{cape:1200,cin:80,bulkShear:40,srh:130,lcl:1650,stp:.8,scp:4,...overrides}
  };
}
const marginal=makeCell();
diagnoseCellEnvironment(marginal);
assert.ok(marginal.derived.hazards.tornadoProbability <= 5, 'MRGL TOR environment cannot reach 10-15%');
assert.ok(marginal.derived.hazards.categories.tornado === 'MRGN' || marginal.derived.hazards.categories.tornado === 'SLGT');

const strong=makeCell({cape:2400,bulkShear:48,srh:290,lcl:1050,stp:5.5,cin:55});
diagnoseCellEnvironment(strong);
assert.ok(strong.derived.hazards.tornadoCig >= 2, 'high-end conditional intensity should reach CIG2+ independently');
assert.equal(strong.derived.hazards.categories.tornado, categoryFromHazard('tornado', strong.derived.hazards.tornadoProbability, strong.derived.hazards.tornadoCig));
console.log('cig-probability-matrix: ok');
