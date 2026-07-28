import assert from 'node:assert/strict';
import { buildSounding, updateCellDiagnostics } from '../js/sounding.js';

function cell(overrides={}){
  return {
    validHourUtc:18,
    surface:{pressure:980,temperature:82,dewpoint:66,wind:{direction:165,speed:15}},
    terrain:{elevationM:450},
    levels:{
      850:{temperature:19,windDirection:190,windSpeed:32},
      700:{temperature:10,windDirection:215,windSpeed:40},
      500:{temperature:-15,windDirection:235,windSpeed:52},
      250:{temperature:-48,windDirection:250,windSpeed:75}
    },
    features:{warmSector:true,synopticAscent:.65,synopticCoherence:.8},
    mesoscaleFields:{ascent:.5,moisturePooling:.6,capErosion:.5},
    dynamics:{forcingScore:.6,triggerStrength:.55,convectiveReadiness:.7,initiationPotential:.4},
    derived:{}, ...overrides
  };
}

const c=cell();
const sounding=updateCellDiagnostics(c);
assert.ok(c.thermodynamics?.profile?.length>20,'shared profile exists');
assert.equal(c.derived.mlcinSigned<=0,true,'MLCIN is signed negative/zero');
assert.equal(c.derived.mlcinMagnitude,Math.abs(c.derived.mlcinSigned),'magnitude matches signed CIN');
assert.equal(c.derived.cin,c.derived.mlcinMagnitude,'legacy CIN aliases ML magnitude');
for(const key of ['lapseRate01km','lapseRate03km','lapseRate700500','lapseRate850500']) assert.ok(Number.isFinite(c.derived[key]),`${key} exists`);
assert.equal(c.derived.sounding.lapseRate700500,c.thermodynamics.lapseRates.mb700_500,'sounding and mesoanalysis share lapse rate');
assert.equal(c.derived.sounding.lapseRate01km,c.thermodynamics.lapseRates.km0_1,'low-level lapse rate is shared');
for(const key of ['capeTerm','srhTerm','shearTerm','lclTerm','cinTerm','rawStp','adjustedStp']) assert.ok(Number.isFinite(c.derived.stpComponents[key]),`STP component ${key}`);
assert.equal(sounding.params.mlcin,c.derived.mlcinSigned,'rendered sounding uses same signed MLCIN');

const first=c.derived.mlcinMagnitude;
c.surface.temperature+=5;
updateCellDiagnostics(c);
assert.ok(Number.isFinite(c.cap.tendencyJkgPerHour),'cap tendency exists');
assert.ok(c.cap.erosionJkgPerHour>=0 && c.cap.rebuildingJkgPerHour>=0,'erosion/rebuilding are nonnegative');
assert.ok(c.derived.mlcinMagnitude>=0 && c.derived.mlcinMagnitude<1000,'CIN remains stable after evolution');
for(let i=0;i<24;i++) updateCellDiagnostics(c);
assert.ok(c.derived.mlcinMagnitude>=0 && c.derived.mlcinMagnitude<1000,'multi-step CIN does not accumulate penalties');
assert.equal(c.derived.mlcinMagnitude,Math.abs(c.derived.mlcinSigned));
console.log('2.29.0 thermodynamics/cap evolution regression passed');
