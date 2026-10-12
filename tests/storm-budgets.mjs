import assert from 'node:assert/strict';
import { Storm } from '../js/storms/Storm.js';
import { BUDGET, startStormBudgets, stepStormBudgets, stormIsOver } from '../js/storms/StormBudgets.js';
import { diagnoseStormRealizationPhysics } from '../js/storms/StormRealizationPhysics.js';

// A storm's life from its three budgets alone, in air that does not change. What differs
// between the runs is only the air.
const STEP = 1 / 12;
function life(environment, hours = 6, rotation = 0) {
  const storm = new Storm({ id: 'T', xKm: 0, yKm: 0, velocityEastKph: 30, velocityNorthKph: 0, sourceCell: { x: 0, y: 0 }, createdHourUtc: 18 });
  startStormBudgets(storm);
  storm.mesocycloneStrength = rotation;   // the storm's rotation, held fixed (this test steps the budgets alone)
  const record = { storm, peakMs: 0, peakRain: 0, peakPool: 0, endedAt: null, updraughtPeakAt: 0, rainPeakAt: 0 };
  for (let hour = STEP; hour <= hours + 1e-9; hour += STEP) {
    storm.ageHours = hour;
    stepStormBudgets(storm, environment, diagnoseStormRealizationPhysics(environment, storm), STEP);
    for (const value of [storm.updraughtMs, storm.precipitation, storm.coldPoolStrength, storm.organization, storm.intensity]) assert.ok(Number.isFinite(value) && value >= 0, 'budgets stay finite and non-negative');
    if (storm.updraughtMs > record.peakMs) { record.peakMs = storm.updraughtMs; record.updraughtPeakAt = hour; }
    if (storm.precipitation > record.peakRain) { record.peakRain = storm.precipitation; record.rainPeakAt = hour; }
    record.peakPool = Math.max(record.peakPool, storm.coldPoolStrength);
    if (stormIsOver(storm)) { record.endedAt = hour; break; }
  }
  return record;
}
const air = { cape: 2500, cin: 20, lcl: 1100, srh: 150, dcape: 900, forcing: 0.4, bulkShear: 45, stormCoverage: 0.1 };

// --- Shear decides how long a storm lasts.
const weak = life({ ...air, bulkShear: 12 }), strong = life({ ...air, bulkShear: 50 }, 6, 0.4);
assert.ok(weak.endedAt !== null && weak.endedAt < 2.5, `in weak shear the storm rains into itself, is undercut and ends (${weak.endedAt?.toFixed(1)} h)`);
assert.equal(strong.endedAt, null, 'in strong shear it is still going after six hours');
assert.ok(strong.peakMs > weak.peakMs, `and it grows stronger (${strong.peakMs.toFixed(0)} against ${weak.peakMs.toFixed(0)} m/s)`);
assert.ok(strong.storm.organization > 0.4 && weak.storm.organization < 0.3, `organization follows from the updraught staying clear of its rain (${strong.storm.organization.toFixed(2)} against ${weak.storm.organization.toFixed(2)})`);
// The same air without rotation: the storm's own outflow holds it down.
const unrotating = life({ ...air, bulkShear: 50 });
assert.ok(strong.storm.updraughtMs > unrotating.storm.updraughtMs * 1.2, `a rotating updraught holds its inflow against its outflow (${strong.storm.updraughtMs.toFixed(0)} against ${unrotating.storm.updraughtMs.toFixed(0)} m/s after six hours)`);

// --- The rain follows the updraught, and the cold pool follows the rain.
assert.ok(weak.rainPeakAt > weak.updraughtPeakAt, `the rain peaks after the updraught (${weak.rainPeakAt.toFixed(2)} against ${weak.updraughtPeakAt.toFixed(2)} h)`);
const dry = life({ ...air, dcape: 1500 }), humid = life({ ...air, dcape: 300 });
assert.ok(dry.peakPool > humid.peakPool * 1.3, `dry air below cloud makes a stronger cold pool (${dry.peakPool.toFixed(2)} against ${humid.peakPool.toFixed(2)})`);

// --- More instability, a stronger updraught; strength is no longer capped below full.
const modest = life({ ...air, cape: 1000 }, 6, 0.4), extreme = life({ ...air, cape: 5500, bulkShear: 55 }, 6, 0.4);
assert.ok(modest.peakMs < strong.peakMs && strong.peakMs < extreme.peakMs, 'the updraught grows with the instability of the inflow');
assert.ok(extreme.storm.intensity > 0.9, `a storm in extreme instability reaches full strength (${extreme.storm.intensity.toFixed(2)})`);
assert.ok(extreme.peakMs < Math.sqrt(2 * 5500), 'and stays under the parcel-theory limit');

// --- No air to feed on: the storm ends.
const capped = life({ ...air, cin: 400 });
assert.ok(capped.endedAt !== null && capped.endedAt <= BUDGET.youngHours + 1.5, `under a strong cap it ends (${capped.endedAt?.toFixed(1)} h)`);

// --- What the storm is called plays no part.
const named = (() => { const a = life(air, 2).storm.updraughtMs; const b = (() => { const e = { ...air }; const s = new Storm({ id: 'T', xKm: 0, yKm: 0, velocityEastKph: 30, velocityNorthKph: 0, sourceCell: { x: 0, y: 0 }, createdHourUtc: 18, modeHint: 'QLCS' }); startStormBudgets(s); for (let h = STEP; h <= 2 + 1e-9; h += STEP) { s.ageHours = h; s.mode = 'renamed'; stepStormBudgets(s, e, diagnoseStormRealizationPhysics(e, s), STEP); } return s.updraughtMs; })(); return [a, b]; })();
assert.equal(named[0], named[1], 'the same air gives the same storm whatever its name');
console.log(`storm budgets passed (weak shear ends at ${weak.endedAt.toFixed(1)} h; peak updraught ${weak.peakMs.toFixed(0)} / ${strong.peakMs.toFixed(0)} / ${extreme.peakMs.toFixed(0)} m/s)`);
