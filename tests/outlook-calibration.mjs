import assert from 'node:assert/strict';
import { CALIBRATION, calibrateChance } from '../js/forecast/outlookCalibration.js';

// A hazard or day without points is issued as it is; none means none.
assert.equal(calibrateChance('day3', 'severe', 37), 37);
assert.equal(calibrateChance('day1', 'tornado', 0), 0);
assert.equal(calibrateChance('day1', 'tornado', 20, {}), 20);
// Each fitted curve never falls, and the chances stay chances.
for (const [day, hazards] of Object.entries(CALIBRATION)) for (const hazard of Object.keys(hazards)) {
  let last = 0;
  for (let raw = 0; raw <= 100; raw += 0.5) { const c = calibrateChance(day, hazard, raw); assert.ok(c >= last - 1e-9 && c <= 100, `${day} ${hazard}: never falling, at most 100 (${raw} -> ${c})`); last = c; }
}
// Between two points the chance is read off the straight line joining them.
assert.ok(Math.abs(calibrateChance('day1', 'x', 15, { day1: { x: [[10, 5], [20, 25]] } }) - 15) < 1e-9);
