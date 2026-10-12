import assert from 'node:assert/strict';
import { Storm } from '../js/storms/Storm.js';
import { setUpdraught } from '../js/storms/StormBudgets.js';
import { stepStormRotation } from '../js/storms/StormRotation.js';
import { buildStormGeometry } from '../js/storms/StormGeometry.js';
import { evolveStormStructure } from '../js/storms/StormStructureEngine.js';
import { gustMph, stepRearInflow } from '../js/storms/StormHazards.js';
import { leftSplitShare, shouldSplitStorm } from '../js/storms/StormModeEngine.js';

// A storm moving north-east at 50 km/h under a 60 kt westerly aloft.
const air = { cape: 3000, cin: 20, lcl: 900, srh: 250, bulkShear: 50, dcape: 900, dewpoint: 66, wind500: { eastKt: 60, northKt: 0 }, surfaceWind: { eastKt: -5, northKt: 15 } };
function storm(state = {}) {
  const s = new Storm({ id: 'S1', xKm: 300, yKm: 300, velocityEastKph: 35, velocityNorthKph: 35, sourceCell: { x: 18, y: 18 }, createdHourUtc: 20 });
  setUpdraught(s, 42);
  Object.assign(s, { ageHours: 2, organization: 0.8, precipitation: 0.8, coldPoolStrength: 0.2, coldPoolRadiusKm: 25, mesocycloneStrength: 0.7, lowRotation: 0.4, lowRotationFree: 0.45, occlusion: 0.1, orientationDeg: 135, ...state });
  return s;
}

// --- Shape: where the parts are follows from the storm's state and the wind through it.
const supercell = storm(), g = buildStormGeometry(supercell, air);
// Wind aloft relative to the storm: 111 - 35 = 76 km/h east, -35 north: the rain falls east-south-east.
assert.ok(g.rain.xKm > g.updraught.xKm + 5 && g.rain.yKm > g.updraught.yKm, `the rain core lies downwind of the updraught (${(g.rain.xKm - g.updraught.xKm).toFixed(0)} km east, ${(g.rain.yKm - g.updraught.yKm).toFixed(0)} km south)`);
assert.ok(Math.abs(g.anvil.bearingDeg - 115) < 10, `the anvil spreads the same way (toward ${g.anvil.bearingDeg.toFixed(0)} degrees)`);
assert.ok(g.wallCloud.strength > 0.5 && g.wallCloud.loweringM > 300, 'low-level rotation shows as a lowering under the updraught');
assert.equal(buildStormGeometry(storm({ lowRotation: 0, lowRotationFree: 0 }), air).wallCloud.loweringM, 0, 'and there is none without it');
assert.ok(g.updraught.topM > 12000 && g.updraught.baseM === 900, 'cloud base is the lifting level; the top rises with the updraught');
assert.ok(buildStormGeometry(storm({ ageHours: 0.5 }), air).anvil.lengthKm < g.anvil.lengthKm, 'the anvil grows with the storm\'s age');
assert.equal(g.tornado, null);
const tornadic = storm(); tornadic.tornado = { onGround: true, positionKm: { x: 297, y: 303 }, widthYards: 400, windSpeedMph: 150 };
assert.deepEqual(buildStormGeometry(tornadic, air).tornado, { xKm: 297, yKm: 303, widthYards: 400, windMph: 150 });

// --- The radar picture reads the state, not the name or the phase.
const plain = storm(), renamed = storm({ mode: 'QLCS', lifecycleState: 'dissipating' });
evolveStormStructure(plain, air, 0, 'k'); evolveStormStructure(renamed, air, 0, 'k');
assert.deepEqual(renamed.structure, plain.structure, 'the same state gives the same picture whatever the storm is called');
const kinds = s => new Set(s.structure.features.filter(f => f.intensity > 0.05).map(f => f.type));
assert.ok(kinds(plain).has('hookArc') && kinds(plain).has('forwardFlank') && !kinds(plain).has('convectiveLine'), 'a rotating storm on its own shows a hook and a forward flank');
const line = storm({ lineOrganization: 0.9, mesocycloneStrength: 0.15, lowRotation: 0, lowRotationFree: 0, rearInflow: 0.8, lineHalfLengthKm: 90 });
evolveStormStructure(line, air, 0, 'k');
assert.ok(kinds(line).has('convectiveLine') && !kinds(line).has('hookArc'), 'a line shows a line');
const calm = storm({ lineOrganization: 0.9, mesocycloneStrength: 0.15, lowRotation: 0, lowRotationFree: 0, rearInflow: 0, lineHalfLengthKm: 90 });
evolveStormStructure(calm, air, 0, 'k');
const bow = s => s.structure.features.find(f => f.type === 'convectiveLine').bowKm;
assert.ok(bow(line) > 2 * bow(calm), `and bows where air is driven down behind it (${bow(line).toFixed(0)} against ${bow(calm).toFixed(0)} km)`);
const dry = storm({ precipitation: 0.1 }); evolveStormStructure(dry, air, 0, 'k');
assert.ok(dry.structure.precipitationEfficiency < 0.5 * plain.structure.precipitationEfficiency, 'a storm holding little rain shows little echo');

// --- Rear inflow: only behind a line with a cold pool and rain, and it adds to the gust.
const bowing = storm({ lineOrganization: 1, coldPoolStrength: 0.6 }), alone = storm({ lineOrganization: 0, coldPoolStrength: 0.6 }), shallow = storm({ lineOrganization: 1, coldPoolStrength: 0.1 });
for (let step = 0; step < 36; step++) for (const s of [bowing, alone, shallow]) stepRearInflow(s, 1 / 12);
assert.ok(bowing.rearInflow > 0.6 && alone.rearInflow === 0 && shallow.rearInflow === 0, `rear inflow builds behind a line with a deep cold pool (${bowing.rearInflow.toFixed(2)})`);
const without = gustMph({ ...bowing, rearInflow: 0 }, air, 70), withIt = gustMph(bowing, air, 70);
assert.ok(withIt > without + 10, `and brings the wind aloft to the ground (${withIt.toFixed(0)} against ${without.toFixed(0)} mph)`);
assert.ok(gustMph(bowing, { ...air, wind500: { eastKt: 20, northKt: 0 } }, 70) < withIt, 'less of it under a weaker wind aloft');

// --- An outflow boundary in the inflow adds rotation near the ground.
const spin = (environment, state = {}) => { const s = storm({ mesocycloneStrength: 0, lowRotation: 0, lowRotationFree: 0, occlusion: 0, ...state }); for (let step = 0; step < 24; step++) stepStormRotation(s, environment, 1 / 12); return s; };
const modest = { ...air, srh: 110 }, open = spin(modest), onBoundary = spin({ ...modest, outflowContrastK: 6 });
assert.ok(onBoundary.lowRotation > 1.2 * open.lowRotation, `a storm drawing in air across an outflow boundary rotates more near the ground (${onBoundary.lowRotation.toFixed(2)} against ${open.lowRotation.toFixed(2)})`);
assert.equal(onBoundary.mesocycloneStrength, open.mesocycloneStrength, 'its rotation aloft is the same');

// --- Splits follow the turning of the wind with height.
assert.equal(leftSplitShare({ srh: 40 }), 1, 'shear that does not turn splits a storm evenly');
assert.equal(leftSplitShare({ srh: 300 }), 0, 'shear that turns strongly clockwise leaves no left-mover');
assert.ok(shouldSplitStorm(storm({ ageHours: 1 }), air) && !shouldSplitStorm(storm({ ageHours: 1, hasSplit: true }), air) && !shouldSplitStorm(storm({ ageHours: 1, lineOrganization: 0.8 }), air), 'a rotating storm on its own splits once');
const leftMover = spin({ ...air, srh: 60 }, { leftMover: true }), leftInTurning = spin(air, { leftMover: true });
assert.ok(leftMover.mesocycloneStrength > 0.2 && leftMover.lowRotation === 0, 'a left-mover rotates aloft but not near the ground');
assert.ok(leftInTurning.mesocycloneStrength < leftMover.mesocycloneStrength, 'and fades where the shear turns clockwise');
console.log(`storm shape and interactions passed (rain core ${Math.hypot(g.rain.xKm - g.updraught.xKm, g.rain.yKm - g.updraught.yKm).toFixed(0)} km downwind; rear inflow adds ${(withIt - without).toFixed(0)} mph; boundary lifts low rotation ${open.lowRotation.toFixed(2)} to ${onBoundary.lowRotation.toFixed(2)})`);
