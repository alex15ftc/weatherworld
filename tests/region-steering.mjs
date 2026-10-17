import assert from 'node:assert/strict';
import { AtmosphereWorld } from '../js/world/AtmosphereWorld.js';
import { STEERING_DEFAULTS } from '../js/world/RegionSteering.js';

// The region slides along the large-scale model toward the support wanted for the day. Only
// where it reads that model moves: nothing on the map is shifted.
const build = steering => new AtmosphereWorld({ seed: 4, spinUpDays: 6, storms: false, steering });

// --- Left alone, the region stays where it starts.
const fixed = build(false), fixedStart = fixed.regional.origin.x;
fixed.advance(6);
assert.equal(fixed.steering, null);
assert.equal(fixed.regional.origin.x, fixedStart, 'a region that is not steered does not move');

// --- Steered: a plan from the start, a slide no faster than the weather systems, and the
// region where that slide puts it.
const steered = build({}), regional = steered.regional, length = steered.model.lengthX;
const first = steered.steering.plan;
assert.ok(first, 'a plan is made when the world is built');
assert.ok(Math.abs(first.slideMs) <= STEERING_DEFAULTS.systemSpeedMs + 1e-9, `the slide is within the systems' own speed (${first.slideMs} m/s)`);
// A warm-sector day aims for a support in range; a day aimed at a low or an upper trough for
// the low (and slides north or south no faster than allowed).
if (first.kind.startsWith('warmSector')) assert.ok(first.support >= -1 && first.support <= 1 && first.wanted >= STEERING_DEFAULTS.wantedLow && first.wanted <= STEERING_DEFAULTS.wantedHigh, 'support and the support wanted are in range');
else assert.ok(Number.isFinite(first.missKm) && first.missKm <= STEERING_DEFAULTS.maxMissKm, `the day aims for a ${first.kind} within reach (${first.missKm} km)`);
assert.ok(Math.abs(first.slideNorthMs ?? 0) <= STEERING_DEFAULTS.northSpeedMs + 1e-9, 'the north-south slide is within its limit');
const start = regional.origin.x, startNorth = regional.origin.y, moisture = Float64Array.from(regional.moisture);
steered.advance(3);
const moved = ((regional.origin.x - start) % length + length) % length, expected = ((first.slideMs * 3 * 3600) % length + length) % length;
assert.ok(Math.abs(moved - expected) < 1, `after 3 hours the region has slid ${(first.slideMs * 3 * 3.6).toFixed(0)} km`);
assert.ok(Math.abs(regional.origin.y - startNorth - (first.slideNorthMs ?? 0) * 3 * 3600) < 1, 'and north or south as planned');
// The air on the map is carried by the wind as before, not shifted with the slide: a slide of
// several cells would otherwise move the whole moisture pattern by that much.
const change = moisture.reduce((sum, value, k) => sum + Math.abs(regional.moisture[k] - value), 0) / moisture.length;
assert.ok(change < 1, `the moisture on the map changes only as the weather changes it (${change.toFixed(2)} g/kg in 3 hours)`);

// --- A new plan each day at the planning hour, never faster than the limit.
const plans = new Set([first.day]);
for (let hour = 0; hour < 60; hour += 0.5) {
  steered.advance(0.5);
  const plan = steered.steering.plan;
  plans.add(plan.day);
  assert.ok(Math.abs(regional.slideMs) <= STEERING_DEFAULTS.systemSpeedMs + 1e-9);
  assert.equal(plan.hourUtc % 24 === STEERING_DEFAULTS.planHourUtc || plan.day === first.day, true, 'later plans are made at the planning hour');
  for (const row of steered.world.cells) for (const cell of row) assert.ok(Number.isFinite(cell.levels[500].heightTendencyDm12h ?? 0), 'height changes stay finite while sliding');
}
assert.ok(plans.size >= 3, `a plan for each day (${plans.size} in two and a half days)`);

// --- The same seed slides the same way.
const again = build({}); again.advance(3);
assert.equal(again.regional.origin.x, (() => { const other = build({}); other.advance(3); return other.regional.origin.x; })());

// --- Given a range, the map roams along the geography: a new place each day within it, reached
// slowly, with the ground under the map following and the air on the map left where it is.
{
  const range = { roamLow: -6, roamHigh: 30 };
  const roaming = build(range), r = roaming.regional, P = { ...STEERING_DEFAULTS, ...range }, places = new Set(), nx = roaming.world.width;
  const elevationAt = x => roaming.world.cells[10][x].terrain.elevationM;
  assert.ok(r.geographyTarget >= P.roamLow && r.geographyTarget <= P.roamHigh, 'the first day has a place in range');
  let lastOffset = r.geographyOffset, lastTarget = r.geographyTarget, moved = 0;
  for (let hour = 0; hour < 96; hour += 0.5) {
    const moistureBefore = Float64Array.from(r.moisture), offsetBefore = r.geographyOffset;
    r.driftGeography(1800);   // the move on its own: nothing on the map shifts with it
    assert.deepEqual(r.moisture, moistureBefore, 'moving the map does not shift the air on it');
    r.geographyOffset = offsetBefore; r.geographyVersion--;
    roaming.advance(0.5);
    assert.ok(Math.abs(r.geographyOffset - lastOffset) <= P.roamCellsPerHour * 0.5 + 1e-9, 'the map moves no faster than its limit');
    assert.ok(r.geographyOffset >= P.roamLow - 1e-9 && r.geographyOffset <= Math.max(P.roamHigh, 15) + 1e-9 && r.geographyTarget >= P.roamLow && r.geographyTarget <= P.roamHigh, 'and stays in its range');
    if (r.geographyTarget !== lastTarget) { const stride = Math.abs(r.geographyTarget - lastTarget); assert.ok(stride <= P.roamStep[1] + 1e-9, `a day's move is within the step (${stride.toFixed(1)} cells)`); places.add(r.geographyTarget); lastTarget = r.geographyTarget; }
    moved += Math.abs(r.geographyOffset - lastOffset); lastOffset = r.geographyOffset;
    // The ground is the geography at the map's present place: high to the west, the plains flat beyond it.
    assert.ok(Math.abs(elevationAt(0) - r.terrainAt(0)) < 1e-9 && elevationAt(0) >= elevationAt(nx - 1), 'the ground under the map follows');
  }
  assert.ok(places.size >= 3 && moved > 10, `a new place each day (${places.size} in four days, ${moved.toFixed(0)} cells travelled)`);
  // Held still when no range is given (the default: the Roblox world's ground is fixed).
  const still = build({}); still.advance(30);
  assert.equal(still.regional.geographyOffset, 15, 'without a range the map stays where it is');
}
console.log(`region steering passed (${plans.size} plans; first slide ${first.slideMs} m/s for support ${first.support.toFixed(2)}, wanted ${first.wanted.toFixed(2)})`);
