import assert from 'node:assert/strict';
import { Atmosphere } from '../js/atmosphere.js';
import { generateScenario } from '../js/scenarios/scenarioGenerator.js';
import { initializeEvolution } from '../js/evolution.js';
import { snapshotWorld } from '../js/world/worldSnapshot.js';
import { initializeOutlookCycle, scheduleOutlookIssuance, outlookWindow, day1PeriodStart, buildOutlookProducts, runOutlookMembers, memberSpecs, nextMemberSpecs } from '../js/forecast/EnsembleOutlookEngine.js';
import { PROBABILITY_LEVELS, RISK_ORDER } from '../js/forecast/spcOutlookRules.js';
import { TRUTH_FIELDS } from '../js/verification/truth.js';
import { nextSystemSeed } from '../js/world/systemBuilder.js';

// --- Convective days and issuance schedule (SPC: 12Z-12Z days; the 06Z issuance looks ahead).
assert.equal(day1PeriodStart(12), 12);
assert.equal(day1PeriodStart(24), 12, '00Z Day 1 still covers the current period');
assert.equal(day1PeriodStart(30), 36, '06Z Day 1 covers the coming 12Z-12Z period');
assert.deepEqual(outlookWindow('day1', 20), { key: 'day1', start: 20, end: 36 });
assert.deepEqual(outlookWindow('day2', 41.5), { key: 'day2', start: 60, end: 84 });
assert.deepEqual(outlookWindow('day3', 30), { key: 'day3', start: 84, end: 108 });

const fake = (hour = 12) => ({
  width: 4, height: 4, cellSizeKm: 16, cellSizeMiles: 10, validHourUtc: hour,
  cells: Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => ({ surface: {} }))),
  evolution: { config: { seed: 7 } }, runtime: { profile: { outlookIssuance: 'async', outlookMembers: 3 } },
  forEachCell(fn) { this.cells.forEach((row, y) => row.forEach((cell, x) => fn(cell, x, y))); }
});
const world = fake(12);
initializeOutlookCycle(world);
assert.deepEqual(world.outlookCycle.pending.map(r => r.windows.map(w => w.key)), [['day1', 'day2', 'day3']]);
world.validHourUtc = 18;
scheduleOutlookIssuance(world, 17.5);
assert.deepEqual(world.outlookCycle.pending.map(r => r.windows.map(w => w.key)), [['day3'], ['day1', 'day2']], 'a newer issuance supersedes the queued days');
world.validHourUtc = 30;
scheduleOutlookIssuance(world, 29.5);
const last = world.outlookCycle.pending.at(-1);
assert.deepEqual(last.windows.map(w => [w.key, w.start, w.end]), [['day1', 36, 60], ['day2', 60, 84]]);
// Day 3 now lies beyond this system: it is the next system's first day, in that system's hours.
assert.deepEqual(last.next.windows.map(w => [w.key, w.start, w.end, w.sourceStart, w.sourceEnd]), [['day3', 84, 108, 12, 36]]);
assert.equal(last.next.seed, nextSystemSeed(7));
assert.ok(last.next.amplitude > 2, 'members for a system 54 h away are perturbed more');
assert.deepEqual(nextMemberSpecs(last)[0].windows, [{ key: 'day3', start: 12, end: 36 }]);
assert.equal(memberSpecs(last).length, 3);
const isolated = fake(30);
isolated.runtime.profile.outlookNextSystem = false;
initializeOutlookCycle(isolated);
assert.equal(isolated.outlookCycle.products.day3.status, 'beyond-system', 'without look-ahead, periods after the system ends are not forecast');

// --- Products from synthetic members: 10 members, tornado tracks near the centre in 6.
const W = 30, H = 30, n = W * H;
const grid = { width: W, height: H, cellSizeKm: 16.09, cellSizeMiles: 10, forEachCell() {} };
const member = (index, tornado) => {
  const masks = Object.fromEntries(TRUTH_FIELDS.map(f => [f, new Uint8Array(n)]));
  for (let y = 8; y < 22; y++) for (let x = 8; x < 22; x++) { masks.storm[y * W + x] = 1; masks.hail[y * W + x] = (x + y + index) % 3 === 0 ? 1 : 0; }
  if (tornado) for (let x = 13; x < 17; x++) { masks.tornado[15 * W + x + (index % 2)] = 1; masks.tornadoSig[15 * W + x + (index % 2)] = 1; }
  return { index, windows: [{ key: 'day1', start: 12, end: 36, storms: 10, tornadoes: tornado ? 1 : 0, masks }] };
};
const members = Array.from({ length: 10 }, (_, i) => member(i, i < 6));
const request = { id: 'test', issuedHourUtc: 12, windows: [{ key: 'day1', start: 12, end: 36 }], members: 10 };
const product = buildOutlookProducts(grid, request, members).day1;
const at = (x, y) => product.grid[y * W + x];
assert.equal(product.memberCount, 10);
assert.equal(product.ensemble.membersWithTornadoes, 6);
for (const g of product.grid) {
  assert.ok(g.tornadoProbability === 0 || PROBABILITY_LEVELS.tornado.includes(g.tornadoProbability), 'tornado probability on SPC levels');
  assert.ok(g.hailProbability === 0 || PROBABILITY_LEVELS.hail.includes(g.hailProbability), 'hail probability on SPC levels');
  assert.ok(RISK_ORDER.includes(g.risk));
}
assert.ok(at(15, 15).tornadoProbability >= 30, `tornado core probability ${at(15, 15).tornadoProbability}`);
assert.ok(at(15, 15).tornadoProbability >= at(15, 10).tornadoProbability && at(15, 10).tornadoProbability >= at(15, 3).tornadoProbability, 'probability decreases away from the tracks');
assert.equal(at(0, 0).risk, 'NONE', 'no thunder far from all storms');
assert.equal(at(0, 0).tornadoProbability, 0);
assert.ok(at(15, 15).tornadoCig >= 1, 'significant tornadoes in every tornadic member give a CIG');
assert.ok(RISK_ORDER.indexOf(at(15, 15).risk) >= RISK_ORDER.indexOf('MDT'), `core category ${at(15, 15).risk}`);
assert.deepEqual(buildOutlookProducts(grid, request, members).day1.grid, product.grid, 'products are deterministic');

// --- The next system's outlooks are carried over when the authority switches to it.
const before = fake(78);
initializeOutlookCycle(before);
const handover = before.outlookCycle.pending.at(-1);
assert.deepEqual(handover.windows, [], 'at the last 06Z every outlook day belongs to the next system');
assert.deepEqual(handover.next.windows.map(w => [w.key, w.sourceStart, w.sourceEnd]), [['day1', 12, 36], ['day2', 36, 60], ['day3', 60, 84]]);
const nextMember = index => ({ index, windows: handover.next.windows.map(w => ({ ...member(index, index < 2).windows[0], key: w.key, start: w.sourceStart, end: w.sourceEnd })) });
const small = { ...grid, cells: before.cells, forEachCell: before.forEachCell };
const nextProducts = buildOutlookProducts(grid, handover, [], [0, 1, 2].map(nextMember));
assert.deepEqual(Object.values(nextProducts).map(p => [p.key, p.system, p.systemSeed, p.validStartHour]), [['day1', 'next', handover.next.seed, 84], ['day2', 'next', handover.next.seed, 108], ['day3', 'next', handover.next.seed, 132]]);
before.outlookCycle.products = nextProducts;
const after = fake(12);
after.evolution.config.seed = handover.next.seed;
initializeOutlookCycle(after, before);
assert.deepEqual(Object.values(after.outlookCycle.products).map(p => [p.key, p.validStartHour, p.validEndHour, p.issuedHourUtc, p.system]), [['day1', 12, 36, 6, undefined], ['day2', 36, 60, 6, undefined], ['day3', 60, 84, 6, undefined]]);
assert.equal(after.outlookCycle.pending.length, 0, 'carried outlooks need no start-of-system issuance');
const stranger = fake(12);
initializeOutlookCycle(stranger, before);
assert.equal(stranger.outlookCycle.pending.length, 1, 'another seed does not inherit them');

// --- Real members: a short forecast from an initialized world is deterministic and complete.
const real = new Atmosphere(50, 50);
initializeEvolution(real, generateScenario(real, 42), { profile: { name: 'gameplay', outlookIssuance: 'off' } });
const shortRequest = { id: 'short', issuedHourUtc: 12, windows: [{ key: 'day1', start: 12, end: 14 }], endHour: 14, members: 2, memberSeed: 11 };
const run = () => runOutlookMembers(snapshotWorld(real, { clone: true }), shortRequest);
const a = run(), b = run();
assert.equal(a.length, 2);
assert.deepEqual(Object.keys(a[0].windows[0].masks), TRUTH_FIELDS);
assert.deepEqual(a.map(m => Array.from(m.windows[0].masks.storm)), b.map(m => Array.from(m.windows[0].masks.storm)), 'members are deterministic');
assert.equal(real.validHourUtc, 12, 'running members leaves the authoritative world untouched');
console.log(`ensemble outlook passed (core ${at(15, 15).risk}, tornado ${at(15, 15).tornadoProbability}% CIG${at(15, 15).tornadoCig})`);
