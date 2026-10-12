import assert from 'node:assert/strict';
import { AtmosphereWorld } from '../js/world/AtmosphereWorld.js';
import { describeStormMode, lineOrganizationTarget, coldPoolBalance, outflowDominance, rotatingShare } from '../js/storms/StormModeEngine.js';
import { diagnoseStormMotion } from '../js/storms/environmentSampling.js';

// --- The name describes the properties.
const calm = { bulkShear: 40, stormCoverage: 0.05 };
assert.equal(describeStormMode({ mesocycloneStrength: 0.5, lineOrganization: 0.05 }, calm), 'isolated supercell');
assert.equal(describeStormMode({ mesocycloneStrength: 0.5, lineOrganization: 0.05, leftMover: true }, calm), 'left-moving supercell');
assert.equal(describeStormMode({ mesocycloneStrength: 0.05, lineOrganization: 0.05 }, calm), 'multicell');
assert.equal(describeStormMode({ mesocycloneStrength: 0.05, lineOrganization: 0.05 }, { bulkShear: 15 }), 'pulse storm');
assert.equal(describeStormMode({ mesocycloneStrength: 0.1, lineOrganization: 0.8, lineHalfLengthKm: 80 }, calm), 'QLCS');
assert.equal(describeStormMode({ mesocycloneStrength: 0.5, lineOrganization: 0.8, lineHalfLengthKm: 80 }, calm), 'QLCS with embedded supercells');
assert.equal(describeStormMode({ mesocycloneStrength: 0.1, lineOrganization: 0.8, lineHalfLengthKm: 130, coldPoolStrength: 0.3, ageHours: 5 }, calm), 'MCS');
assert.equal(describeStormMode({ mesocycloneStrength: 0.1, lineOrganization: 0.1, elevatedFeed: true }, calm), 'elevated convection');

// --- Line organization: a strong cold pool shared with neighbours overpowers the shear; a
// lone storm, a weak cold pool or strong shear keeps the convection cellular.
const crowded = { bulkShear: 35, stormCoverage: 0.7, linearFraction: 0.1 };
assert.ok(lineOrganizationTarget({ coldPoolStrength: 0.35 }, crowded) > 0.8);
assert.ok(lineOrganizationTarget({ coldPoolStrength: 0.35 }, { ...crowded, stormCoverage: 0.1 }) < 0.2, 'no neighbours, no line');
assert.ok(lineOrganizationTarget({ coldPoolStrength: 0.02 }, crowded) < 0.2, 'weak cold pool, no line');
assert.ok(coldPoolBalance({ coldPoolStrength: 0.2 }, { bulkShear: 30 }) > coldPoolBalance({ coldPoolStrength: 0.2 }, { bulkShear: 60 }), 'stronger shear holds the cold pool back');
assert.ok(lineOrganizationTarget({ coldPoolStrength: 0 }, { bulkShear: 40, stormCoverage: 0, linearFraction: 0.8 }) > 0.9, 'linear forcing organizes a line from the start');
assert.ok(outflowDominance({ coldPoolStrength: 0.5 }, { bulkShear: 30 }) > outflowDominance({ coldPoolStrength: 0.1 }, { bulkShear: 30 }));
assert.equal(rotatingShare({ mesocycloneStrength: 0 }), 0);

// --- Motion blends continuously between the regimes.
const flow = { wind850: { eastKt: 20, northKt: 8 }, wind500: { eastKt: 45, northKt: 18 }, surfaceWind: { eastKt: 8, northKt: 2 } };
const speedEast = character => diagnoseStormMotion(flow, character).east;
assert.ok(speedEast({ rotating: 0, linear: 1 }) > speedEast({ rotating: 0, linear: 0.5 }) && speedEast({ rotating: 0, linear: 0.5 }) > speedEast({ rotating: 0, linear: 0 }));
assert.notDeepEqual(diagnoseStormMotion(flow, { rotating: 1, linear: 0 }), diagnoseStormMotion(flow, { rotating: 1, linear: 0, leftMover: true }));

// --- Nothing in the simulation reads the name: scrambling it leaves the evolution unchanged.
const fingerprint = world => world.storms.map(s => [s.id, s.active, Math.round(s.positionKm.x * 1000), Math.round(s.positionKm.y * 1000), Math.round(s.intensity * 1e6), Math.round((s.mesocycloneStrength ?? 0) * 1e6),
  Math.round((s.lineOrganization ?? 0) * 1e6), Math.round((s.coldPoolStrength ?? 0) * 1e6), Math.round((s.currentHailSizeInches ?? 0) * 1e4), Math.round((s.surfaceWind?.gustMph ?? 0) * 100), s.tornadoHistory?.length ?? 0]);
// The plain run goes on until the world has had enough storms to compare (at least a day,
// at most four); the scrambled run then covers the same hours.
const run = (scramble, hours = null) => {
  const atmosphere = new AtmosphereWorld({ seed: 2, spinUpDays: 10 }), world = atmosphere.world;
  let hour = 0;
  for (; hours === null ? hour < 96 && (hour < 24 || world.stormEngine.totalCreated < 8 || !world.storms.length) : hour < hours; hour += 0.5) {
    if (scramble) for (const storm of world.storms) storm.mode = 'renamed';
    atmosphere.advance(0.5);
  }
  world.hoursRun = hour;
  return world;
};
const plain = run(false), scrambled = run(true, plain.hoursRun);
// Storms that have ended are compared through the counters; the ones still going, in full.
assert.ok(plain.stormEngine.totalCreated >= 5 && plain.storms.length >= 1, `the test world has storms (${plain.stormEngine.totalCreated} so far, ${plain.storms.length} now)`);
assert.equal(scrambled.stormEngine.totalCreated, plain.stormEngine.totalCreated);
assert.deepEqual(fingerprint(scrambled), fingerprint(plain), 'storm evolution depends on the type name');
assert.equal(scrambled.stormEngine.totalTornadoes, plain.stormEngine.totalTornadoes);
const names = {}; for (const storm of plain.storms) names[storm.mode] = (names[storm.mode] ?? 0) + 1;
console.log(`storm character passed (${plain.storms.length} storms: ${Object.entries(names).map(([k, v]) => `${v} ${k}`).join(', ')})`);
