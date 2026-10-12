import assert from 'node:assert/strict';
import v8 from 'node:v8';
import { AtmosphereWorld } from '../js/world/AtmosphereWorld.js';

// Storms on the redesigned atmosphere: three days from a short spin-up. The checks are on
// what must hold whatever the weather: the storm engine gets every field it reads, storms
// form only in unstable air, and what they do to the air lasts and then fades. (When they
// form is not checked on three days: a passing system can set storms off at any hour.
// scripts/storm-prototype.mjs reports the hours over a longer run.)
const atmosphere = new AtmosphereWorld({ seed: 2, spinUpDays: 10 });
const world = atmosphere.world;

// --- Every cell carries what the storm engine reads.
world.forEachCell(cell => {
  for (const value of [cell.derived.cape, cell.derived.cin, cell.derived.srh, cell.derived.bulkShear, cell.derived.sounding.mlcape, cell.features.convergenceLift, cell.features.synopticAscent, cell.features.surfaceHeating, cell.features.warmSector, cell.dynamics.terrainLiftMs, cell.dynamics.forcingScore, cell.dynamics.convectiveReadiness, cell.mesoscaleFields.effectiveInflow])
    assert.ok(Number.isFinite(value), 'a field the storm engine reads is missing');
  assert.ok(cell.features.convergenceLift >= 0 && cell.features.convergenceLift <= 1 && cell.features.synopticAscent >= 0 && cell.features.synopticAscent <= 1);
});
assert.ok(world.cells[25][3].terrain.slopeX < 0, 'the ground rises to the west');
assert.ok(Array.isArray(world.mesoscale.boundaries), 'the analysed lines are kept for the maps');
// Nothing is drawn around a line for storms to find, and there are no outflow rings: a front,
// a dryline or a cold pool reaches a storm only through the winds and the air.
assert.equal(world.synopticObjects, undefined);
world.forEachCell(cell => { assert.equal(cell.features.explicitBoundaryInfluence ?? 0, 0); });

// --- Three days of weather.
const born = [], seen = new Set();
let coolest = 0, peakActive = 0;
for (let step = 0; step < 3 * 48; step++) {
  atmosphere.advance(0.5);
  assert.equal(world.validHourUtc, world.stormEngine.validHourUtc, 'atmosphere and storms keep the same time');
  peakActive = Math.max(peakActive, world.storms.filter(s => s.active).length);
  for (const storm of world.storms) {
    if (seen.has(storm.id)) continue;
    seen.add(storm.id);
    if (storm.parentId) continue;   // the left-moving member of a split: it came from its parent, not from the air
    const cell = world.cells[storm.sourceCell.y][storm.sourceCell.x];
    born.push({ utc: ((storm.createdHourUtc % 24) + 24) % 24, cape: storm.sourceCell.cape, x: storm.positionKm.x, y: storm.positionKm.y, dewpoint: cell.surface.dewpoint });
  }
  for (const value of atmosphere.regional.coldPool) coolest = Math.max(coolest, value);
}
assert.ok(born.length >= 10, `storms form (${born.length} in three days)`);
assert.ok(born.every(s => s.cape >= 300), 'only where there is instability to feed them');
assert.ok(born.every(s => s.x >= 0 && s.y >= 0 && s.x <= world.domainWidthKm && s.y <= world.domainHeightKm), 'on the map');
assert.ok(coolest > 1.5, `storms leave rain-cooled air behind them (${coolest.toFixed(1)} K at most)`);

// --- The cooled air recovers once the storms are gone.
// --- A saved world carries on exactly as the original does (storms, cold pools and all).
{
  const print = a => { let t = 0, cape = 0; a.world.forEachCell(cell => { t += cell.surface.temperature; cape += cell.derived.cape; }); return [a.world.validHourUtc, t.toFixed(6), cape.toFixed(3), a.world.storms.map(s => `${s.id}:${s.positionKm.x.toFixed(3)}:${s.intensity.toFixed(5)}`).join(','), Math.max(...a.regional.coldPool).toFixed(5), a.model.psi1[777].toFixed(3)].join('|'); };
  const resumed = AtmosphereWorld.restore(v8.deserialize(v8.serialize(atmosphere.saveState())));
  assert.equal(print(resumed), print(atmosphere), 'the restored world is the saved one');
  atmosphere.advance(6); resumed.advance(6);
  assert.equal(print(resumed), print(atmosphere), 'and six hours later they still agree');
  assert.equal(AtmosphereWorld.restore({ version: 0 }), null, 'a state in another layout is refused');
}

// --- A cold pool is the atmosphere's own: it shows in the temperature and pressure, its edge
// is found as an outflow boundary, and it warms back up once the storm is gone.
world.storms = [];
atmosphere.stormsEnabled = false;
atmosphere.regional.coldPool.fill(0);
atmosphere.regional.addColdPool(520, 400, 45, 6);
// The wind carries the pool along, so it is looked for where it has got to: the cell that is
// coldest against its air mass half an hour later, compared with a cell well clear of it.
const cell = k => world.cells[Math.floor(k / world.width)][k % world.width];
const before = { t: [], p: [] }; world.forEachCell(c => { before.t.push(c.surface.temperature); before.p.push(c.surface.seaLevelPressure); });
atmosphere.advance(0.5);
const pool = atmosphere.regional.coldPool, at = pool.indexOf(Math.max(...pool)), away = at + (at % world.width < world.width - 14 ? 12 : -12);
assert.ok(pool[at] > 3, `the pool is still there half an hour on (${pool[at].toFixed(1)} K)`);
assert.ok((cell(at).surface.temperature - before.t[at]) - (cell(away).surface.temperature - before.t[away]) < -5, 'the air in the pool is colder');
assert.ok((cell(at).surface.seaLevelPressure - before.p[at]) - (cell(away).surface.seaLevelPressure - before.p[away]) > 0.5, 'and the pressure under it higher');
assert.ok(atmosphere.boundaries.some(line => line.type === 'outflow'), `its edge is an outflow boundary (found: ${atmosphere.boundaries.map(b => b.type).join(', ')})`);
const strongest = () => Math.max(...atmosphere.regional.coldPool);
const early = strongest();
atmosphere.advance(18);
assert.ok(strongest() < 0.25 * early, `it warms back up (${early.toFixed(1)} K, then ${strongest().toFixed(1)} K 18 hours later)`);

// --- Deterministic.
const run = () => { const a = new AtmosphereWorld({ seed: 5, spinUpDays: 4 }); a.advance(18); return a.world.storms.map(s => `${s.id}:${s.positionKm.x.toFixed(2)}:${s.intensity.toFixed(4)}`).join('|') + a.world.cells[20][30].derived.cape.toFixed(3); };
assert.equal(run(), run());
console.log(`atmosphere world passed (${born.length} storms in three days, up to ${peakActive} at once, ${world.stormEngine.totalTornadoes} tornadoes)`);
