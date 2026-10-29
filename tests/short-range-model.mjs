// The short range model (js/forecast/ShortRangeModel.js): stepped as the server steps the live world,
// it matches the live world storm for storm while it shares its dice, then goes its own way; and it
// keeps the hour's fields, the storm records and the tracks.
import assert from 'node:assert/strict';
import { avoidBackgroundThrottling } from '../js/runtime/processPriority.node.js';
import { AtmosphereWorld } from '../js/world/AtmosphereWorld.js';
import { runShortRange, shortRangeHours, SHORT_RANGE } from '../js/forecast/ShortRangeModel.js';
import { MESOANALYSIS_PARAMETERS, buildParameterField } from '../server/mesoanalysisParameters.js';
avoidBackgroundThrottling();

const live = new AtmosphereWorld({ seed: 4 }); live.advance(4);   // 16Z, storms going
const state = live.saveState({ forecast: true });
const fieldsOf = world => Object.fromEntries(MESOANALYSIS_PARAMETERS.filter(p => ['mlcape', 'stp', 'dewpoint'].includes(p.key)).map(p => [p.key, buildParameterField(world, p)]));
const run = runShortRange(structuredClone(state), { hours: 5, fieldsOf });

// The live world, as the server steps it, with a storm record every 15 minutes.
const world = live.world, init = world.validHourUtc, positions = new Map();
const stormHour = () => world.stormEngine?.validHourUtc ?? world.validHourUtc;
let next = 0.25;
for (let step = 0; step < 10; step++) {
  const target = world.validHourUtc + 0.5;
  for (let guard = 0; guard < 64; guard++) {
    const left = target - stormHour();
    if (left <= 1e-3) { if (left > 0) world.stormEngine.validHourUtc = target; break; }
    live.advanceStormLayer(Math.min(1 / 12, left));
    if (stormHour() - init >= next - 1e-3) { positions.set(Math.round((stormHour() - init) * 60), world.storms.filter(s => s.active && s.intensity >= 0.15).map(s => `${s.id}@${s.positionKm.x.toFixed(2)},${s.positionKm.y.toFixed(2)}`).sort().join(' ')); next += 0.25; }
  }
  live.advance(0.5, { advanceStorms: false });
}
const model = minute => run.storms.find(f => f.minute === minute)?.list.map(s => `${s.id}@${s.x.toFixed(2)},${s.y.toFixed(2)}`).sort().join(' ');
for (let minute = 15; minute <= 60 * SHORT_RANGE.shareHours; minute += 15) assert.ok(positions.get(minute) && model(minute) === positions.get(minute), `the same storms in the same places at +${minute} min while the dice are shared`);
const differs = [240, 270, 300].some(minute => model(minute) !== positions.get(minute));
assert.ok(differs, 'its own storms once the dice are its own');

// What it keeps.
assert.equal(run.fields.length, 6, 'fields at hours 0-5'); assert.deepEqual(run.fields.map(f => f.hour), [0, 1, 2, 3, 4, 5]);
assert.ok(run.fields.every(f => f.values.mlcape instanceof Float32Array && f.values.mlcape.length === run.width * run.height));
assert.deepEqual(run.parameters.map(p => p.key).sort(), ['dewpoint', 'mlcape', 'stp']); assert.ok(run.parameters.every(p => !('values' in p)));
assert.equal(run.storms.length, 21, 'a storm record every 15 minutes, start included');
assert.ok(run.storms.some(f => f.list.some(s => s.rain && s.dbz > 0)), 'storms carry their rain area and reflectivity');
assert.ok(run.tracks.every(p => p.uh >= SHORT_RANGE.trackLeastUh || p.tornado), 'tracks keep rotating storms and tornadoes');
assert.equal(shortRangeHours(12), 48); assert.equal(shortRangeHours(13), 18); assert.equal(shortRangeHours(24), 48);
console.log(`short range model passed (5 h in ${(run.ms / 1000).toFixed(1)} s; ${run.storms.at(-1).list.length} storms at +5 h, ${run.tracks.length} track points)`);
