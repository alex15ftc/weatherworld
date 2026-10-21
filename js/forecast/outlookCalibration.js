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
// Refitted 2026-10-21 on 40 mornings (seeds 1-8, 5 each) with that day's climate (hail melting, the
// stronger mesocyclones): the record had drifted, 45% hail and wind areas verifying about 62% and
// 30-35% tornado areas 57% on Day 1.
export const CALIBRATION = Object.freeze({"day1": {"tornado":[[1.4,1],[3.2,2.8],[6.1,3.5],[8.7,7.1],[11.2,12.3],[13.7,17.2],[17.1,23.7],[22.4,28.9],[27.3,28.9],[33.9,57.2]],
  "wind":[[1.5,0.2],[3.4,0.5],[6.2,0.6],[8.7,1.2],[11.2,6.3],[13.7,7.1],[17.4,10.3],[22.4,16.6],[27.5,24.8],[34.9,38.5],[45,62.1],[54.7,81.2],[67.1,91.5],[83.6,99]],
  "hail":[[1.5,0],[2.7,0.6],[4.2,1.5],[6.2,1.5],[8.7,2.6],[11.2,6.4],[13.7,9.6],[17.4,12.9],[22.4,19.8],[27.4,25.8],[34.8,41.2],[44.9,62.1],[54.7,71.3],[66.9,86.4],[82.4,96.2]]},"day2": {"tornado":[[1.5,3],[2.7,3.3],[5.2,3.9],[8.7,7.4],[11.2,10],[13.7,14.4],[26,15.3]],
  "wind":[[2.1,2.1],[4.2,3.5],[6.2,4.8],[8.7,5.5],[11.2,8.8],[13.7,10.6],[17.4,14.2],[22.3,20],[27.5,27.5],[34.5,39],[44.9,58.3],[55,70.3],[66.6,78.7],[81.5,90.1]],
  "hail":[[2.1,1.3],[4.2,2.5],[6.2,5.5],[8.8,6.6],[11.2,10.2],[13.7,13.7],[17.4,18.3],[22.5,26.3],[27.5,30],[34.4,40.6],[44.9,52.4],[54.9,66.9],[66.8,75.7],[79.4,93.4]]}});

// Intensity groups (2026-10-21): for each outlook day and hazard, the share of the runs whose own
// reports in a contour area reach group g that a group needs to be drawn there, set where the group
// then verified there more often than not (scripts/fit-cig-calibration.mjs, from outlook-verify
// --cig-data). Without an entry an area takes its median run's group and the runs' agreement
// (OUTLOOK.groupAgreement), as before. Fitted 2026-10-21 on the same 40 mornings; groups with fewer
// than 40 areas there keep the agreement they needed before, and 1.01 is never.
export const CIG_SHARE = Object.freeze({"day1":{"tornado":[0.375,0.625,0.75],"wind":[0.5,0.625,0.75],"hail":[0.5,0.75]},"day2":{"tornado":[0.5,0.625,0.75],"wind":[1.01,0.625,0.75],"hail":[0.5,0.75]}});

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
