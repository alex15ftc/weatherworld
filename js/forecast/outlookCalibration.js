// Calibration of the outlooks' chances (agenda step 5 of the 2026-10-16 plan). The runs'
// average chance of a hazard near a place is not the chance it then happens there: averaged and
// spread out, the runs' chances run low (a Day 1 area at 30% for tornadoes verified about half
// the time), so Moderate was issued on 8% of days that verified Moderate on 20%. As forecast
// centres do with their guidance, the raw chance is mapped to the chance that verified, from a
// record of outlooks set against what happened (scripts/outlook-verify.mjs --calibration-data;
// fitted by scripts/fit-outlook-calibration.mjs): for each outlook day and hazard, points
// [raw chance, chance that verified] (percent), joined by straight lines, never falling. This
// changes what is issued, never the weather. A hazard with no points is issued as it is.
// Fitted 2026-10-17 on 40 mornings (seeds 1-8, 5 each) with the climate of that day and checked
// on 40 others (seeds 9-16): Day 1 and Day 2 only. Day 3, made from two runs, did not carry over
// to other seeds when tried (2026-10-16: its higher levels verified at half their value), so it is
// issued as it is.
export const CALIBRATION = Object.freeze({"day1": {"tornado":[[2,1.4], [4.2,2.9], [6.2,6], [8.7,6.3], [12.3,8.6], [17.4,10], [22.4,27.6], [27.1,39.1], [34.3,44.5], [46.5,68.7]],
  "wind":[[1.5,0], [2.7,0], [4.2,0.1], [6.2,1.4], [8.7,4.3], [11.2,5.9], [13.7,9.8], [17.4,12.3], [22.4,19], [27.4,24.6], [34.9,48.4], [44.9,67.8], [54.8,81.8], [66.4,91.2], [80.9,97.4]],
  "hail":[[2.1,0.4], [4.2,1.7], [6.2,3.3], [10.9,6.7], [17.4,11.1], [22.5,21.3], [27.5,26.7], [34.8,39.6], [44.6,56.4], [54.8,73.4], [66.6,85.7], [81.2,96.1]]},"day2": {"tornado":[[2,2], [4.2,3.7], [7.2,4], [11.2,7.9], [13.7,12.5], [17.2,17.3], [22.1,21.1], [27.2,39.2], [37.1,61.3]],
  "wind":[[2.1,4], [4.2,4.6], [6.2,7.9], [8.7,9.6], [11.2,12.8], [13.7,16.3], [17.4,21.3], [22.4,29.7], [34.9,36.6], [54.5,58.4], [68.8,93.1]],
  "hail":[[1.5,4], [2.7,4.2], [4.2,5.5], [6.2,8], [8.7,10.9], [11.2,14.3], [13.7,15.4], [17.4,17.8], [22.4,20], [27.5,34.1], [34.8,36], [44.7,43.6], [54.4,70.9], [66.8,87.5]]}});

import { PROBABILITY_LEVELS } from './spcOutlookRules.js';

// The calibrated chance (percent) for a raw one. It may lower a chance as far as the record says,
// but raise it by one contour level at most above the level the runs themselves reach, and not at
// all into a level from GUARD_LEVEL up (where Moderate and High come from): those the runs must
// reach themselves (2026-10-17; uncapped, and with one level allowed everywhere, Day 1 issued High
// on 10% of mornings against 5% that verified, and a false High costs players' trust).
const GUARD_LEVEL = { tornado: 30, wind: 45, hail: 45, severe: 45 };
export function calibrateChance(day, hazard, raw, table = CALIBRATION) {
  const calibrated = curve(day, hazard, raw, table), levels = PROBABILITY_LEVELS[hazard];
  if (!(calibrated > raw) || !levels) return calibrated;
  const reached = levels.filter(level => raw >= level - 1e-9).length;   // contour levels the raw chance reaches
  let next = reached;   // the index of the next level up, which the chance may reach
  if (next < levels.length && levels[next] >= (GUARD_LEVEL[hazard] ?? Infinity)) next = reached - 1;   // stay within the level reached
  const ceiling = next + 1 < levels.length ? levels[next + 1] - 0.01 : Infinity;
  return Math.min(calibrated, ceiling);
}

function curve(day, hazard, raw, table) {
  const points = table[day]?.[hazard];
  if (!points?.length || !(raw > 0)) return raw;
  if (raw <= points[0][0]) return raw * points[0][1] / Math.max(1e-6, points[0][0]);
  for (let k = 1; k < points.length; k++) if (raw <= points[k][0]) { const [x0, y0] = points[k - 1], [x1, y1] = points[k]; return y0 + (y1 - y0) * (raw - x0) / Math.max(1e-6, x1 - x0); }
  return Math.min(100, points.at(-1)[1]);
}
