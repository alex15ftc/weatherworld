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
// Refitted 2026-10-21 (again, after the physical tornado ratings and the tornado groups judged
// by wind) on 100 mornings (seeds 1-20, 5 each) with that day's climate (hail melting, the
// stronger mesocyclones): the record had drifted, 45% hail and wind areas verifying about 62% and
// 30-35% tornado areas 57% on Day 1.
// Refitted 2026-10-22 on 100 mornings (seeds 1-20, 5 each) after the later sunset, the surface
// inhibition and the tornado rate of 2026-10-21: with the 2026-10-21 table Day 1 30% tornado areas
// verified 48% and 45% ones 75%, and Day 2 was too low on 36% of days. Day 3 is still issued as it is.
export const CALIBRATION = Object.freeze({"day1": {"tornado":[[1.4,0.8],[2.7,2.4],[4.2,3.6],[6.2,5.6],[8.7,7.9],[11.2,13],[13.7,16.1],[17.3,21.2],[22.3,31.2],[27.3,34.6],[34,46.4],[46.8,68.5]],
  "wind":[[1.5,0.3],[2.7,0.6],[4.2,0.9],[6.2,1.5],[8.7,3.1],[11.2,7],[13.7,9.5],[17.4,12.4],[22.4,19.5],[27.4,28],[34.7,43.9],[44.9,64.8],[54.7,82.4],[67.2,93.1],[83.6,96.6]],
  "hail":[[1.5,0.5],[2.7,0.6],[4.2,0.9],[6.2,2.2],[8.7,4.1],[11.2,6.9],[13.7,10.8],[17.4,14.7],[22.4,22.1],[27.5,30.2],[34.9,44.5],[44.7,59],[54.7,74.8],[67.2,88.1],[82.9,95.1]]},
 "day2": {"tornado":[[1.5,1.5],[2.7,3.6],[5.3,5.4],[8.6,8.4],[11.2,12.6],[13.7,16.5],[17.3,20.3],[26,24.3],[45.1,59.8]],
  "wind":[[1.5,0.6],[2.7,0.7],[4.2,3],[6.2,5.2],[8.7,9.6],[11.2,10.2],[13.7,12.2],[17.3,16.4],[22.4,24.7],[27.4,33.3],[34.7,46],[44.7,56.1],[54.4,69.5],[66.5,78.8],[79.6,96]],
  "hail":[[1.5,2.5],[2.7,3.1],[4.2,3.1],[6.2,4.6],[8.7,8.2],[11.2,11.7],[13.7,11.9],[17.4,18.8],[22.3,26.1],[27.4,32.6],[34.8,43.6],[44.9,56.1],[54.6,72.1],[66.7,78.8],[79.2,87.5]]}});

// Intensity groups (2026-10-21): for each outlook day and hazard, the share of the runs whose own
// reports in a contour area reach group g that a group needs to be drawn there, set where the group
// then verified there more often than not (scripts/fit-cig-calibration.mjs, from outlook-verify
// --cig-data). Without an entry an area takes its median run's group and the runs' agreement
// (OUTLOOK.groupAgreement), as before. Fitted 2026-10-21 on the same 100 mornings, the tornado
// groups by the EF of the tornadoes' peak wind (verification/truth.js); groups with fewer
// than 40 areas there keep the agreement they needed before, and 1.01 is never.
// Refitted 2026-10-22 on the same 100 mornings as the chances above (with them): with the 2026-10-21
// shares Day 1 drew tornado CIG1 on 52% of outlooks against 19% verified.
export const CIG_SHARE = Object.freeze({"day1":{"tornado":[0.5,0.5,0.5],"wind":[0.5,0.625,0.75],"hail":[0.375,0.75]},"day2":{"tornado":[0.75,1.01,1.01],"wind":[0.5,0.625,0.75],"hail":[0.5,0.75]}});

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
