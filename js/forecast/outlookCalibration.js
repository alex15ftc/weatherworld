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
// Refitted again 2026-10-23 on 100 mornings (seeds 1-20, 5 each), after the review fixes (hatching by
// contour ring, gusts with the outflow surge, wind reports, tornado strength by STP); before that on 70 mornings (seeds 1-10, 4 each, and 21-30, 3 each) after the jet stream and the storm changes of
// docs/FIX-PLAN-2026-10-22.md (group 3), with hail and wind now verified by reports (truth.js): with the
// 2026-10-22 table Day 1 45% hail areas verified 75% and 45% wind areas 80%.
// Refitted 2026-10-24 on the same 100 mornings, after the regional air stopped lagging the large-scale
// air (RegionalAtmosphere carryDeparture), the ground column's weight, the line winds' cores and the
// truth's tornadoes judged by their damage ratings (verification/truth.js).
// Refitted 2026-10-24 again on the same 100 mornings after the EF4 damage indicators (TornadoEngine).
export const CALIBRATION = Object.freeze({"day1":{"tornado":[[1.5,0.4],[2.7,1.5],[4.2,3],[6.2,4.7],[8.7,8.4],[11.2,11.4],[13.7,13.9],[17.4,16.9],[22.4,28.3],[27.4,34.6],[34.5,42.4],[44.1,59.1],[54.2,66.5],[66.3,89.3]],"wind":[[1.5,0.4],[2.7,1.1],[5.3,2],[8.7,2.2],[11.2,4.2],[13.7,6],[17.4,7.7],[22.5,11.9],[27.5,21.9],[34.8,38.9],[45,66.1],[54.8,87],[67.3,96.5],[85.4,99.4]],"hail":[[2.1,0.5],[4.2,1.8],[6.2,2.5],[8.7,4.3],[11.2,4.9],[13.7,7.7],[17.4,11.4],[22.5,17.5],[27.5,26.2],[34.7,37.8],[45,60.4],[54.7,79.5],[67.4,92.4],[85,97.9]]},"day2":{"tornado":[[1.5,2.3],[2.7,2.5],[4.2,4.1],[6.2,5],[8.7,7.3],[11.2,10.7],[13.7,14.3],[17.4,18],[22.3,26.9],[27.3,29.9],[34.3,36.9],[44.1,40],[57,45.8]],"wind":[[1.5,1.1],[2.7,1.8],[4.2,2.2],[6.2,2.8],[8.7,3.3],[11.2,6],[13.7,7.7],[17.5,12.8],[22.5,19.3],[27.5,28.7],[34.9,39.3],[44.8,57.6],[54.9,73.4],[66.7,84.3],[83.5,96.9]],"hail":[[2.1,1.7],[4.2,2.6],[6.2,3.3],[8.7,5.3],[11.2,8.8],[13.7,10.4],[17.5,15.5],[22.4,20.3],[27.5,27.1],[34.8,39.7],[44.8,57.2],[54.7,70.1],[66.9,86.3],[83.3,96.5]]},"day3":{"severe":[[1.5,19],[7.5,22.1],[17.5,28.7],[25,36],[34.9,41.8],[44.8,49.5],[54.7,60.2],[66.6,68],[82.8,83.7]]}});

// Intensity groups (2026-10-21): for each outlook day and hazard, the share of the runs whose own
// reports in a contour area reach group g that a group needs to be drawn there, set where the group
// then verified there more often than not (scripts/fit-cig-calibration.mjs, from outlook-verify
// --cig-data). Without an entry an area takes its median run's group and the runs' agreement
// (OUTLOOK.groupAgreement), as before. Fitted 2026-10-21 on the same 100 mornings, the tornado
// groups by the EF of the tornadoes' peak wind (verification/truth.js); groups with fewer
// than 40 areas there keep the agreement they needed before, and 1.01 is never.
// Refitted 2026-10-22 on the same 100 mornings as the chances above (with them): with the 2026-10-21
// shares Day 1 drew tornado CIG1 on 52% of outlooks against 19% verified.
// Refitted again on the same 100 mornings. Day 1 tornado CIG2 (EF3+) verified 50% at 3 of 8 runs and
// CIG3 (EF4+) 76%, so both are drawn from 3 of 8 (the fit would hold them to CIG1's 5 of 8, as a
// higher group never asks less; the user wants the top groups drawn boldly, and the data bears it).
// (On 70 mornings both had come out never.) Set by hand instead
// (the user's choice, 2026-10-23): the top groups are drawn more boldly, as forecasters do for the
// most dangerous days, CIG2 (EF3+) from 2 of 8 runs and CIG3 (EF4+) from 3 of 8, so they appear now
// and then; about half the CIG2 areas then verify.
// Refitted 2026-10-24 with the tornadoes judged by their damage ratings (truth.js). Day 1 tornado CIG1
// (EF2+) verified 64% from 4 of 8 runs; CIG2 (EF3+) about a quarter of the time at 1-2 of 8 (the fit:
// never), and is drawn from 4 of 8, as boldly as CIG1 allows, so that it appears now and then (the
// user's wish); CIG3 (EF4+) is never drawn, as no tornado was rated EF4 in 40 days of this world.
// Day 2 tornado CIG1 never verified more often than not (45% at 6 of 8). Hail CIG2 (3.5 in) never.
// Refitted 2026-10-24 again, after the EF4 damage indicators: Day 1 tornado CIG1 verified 53-87% from 3 of
// 8 runs; CIG2 about a quarter of the time at 1-2 of 8 (the fit: never), drawn from 3 of 8, as boldly as
// CIG1 allows (the user's wish); CIG3 (EF4+), now rated now and then (verified on 7% of mornings), had
// too few areas to fit and is drawn where 6 of 8 runs have it, so it appears on the most extreme days.
// Hail CIG2 (3.5 in) verified 83% at 4 of 8 (12 areas).
export const CIG_SHARE = Object.freeze({"day1":{"hail":[0.5,0.5],"tornado":[0.375,0.375,0.75],"wind":[0.5,0.625,0.75]},"day2":{"tornado":[1.01,1.01,1.01],"wind":[0.5,0.625,0.75],"hail":[0.5,0.75]}});

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
