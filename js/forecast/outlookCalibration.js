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
// Refitted 2026-10-24 (third time) after the 850 mb moisture share, the 850-700 mb adjustment and the
// truth's tornado tracks rated whole again.
// Refitted 2026-10-24 (fourth time) after the tornado tracks cut to their life, the cold dome capped at
// 750 mb, fewer left-movers and line joins that glide.
// Refitted 2026-10-24 (fifth time): Day 3 from the ingredients for storms (DayOneOutlook INGREDIENTS; its raw
// chance verified close to itself: 35% 33%, 45% 46%), and day1update, the Day 1 issued after the day is under
// way, fitted on the 18Z and 00Z issues of 50 days (seeds 1-10, outlook-updates-verify --calibration-data).
// (Refitted 2026-10-25 from data/outlook-archive/fit-2026-10-24 by scripts/refit-from-archive.mjs.)
// (Refitted 2026-10-25 from data/outlook-archive/fit-2026-10-25 by scripts/refit-from-archive.mjs.)
// (Refitted 2026-10-25 from data/outlook-archive/fit-2026-10-25b by scripts/refit-from-archive.mjs.)
// (Refitted 2026-10-26 from data/outlook-archive/fit-2026-10-25c by scripts/refit-from-archive.mjs.)
// (Refitted 2026-10-26 from data/outlook-archive/fit-2026-10-26 by scripts/refit-from-archive.mjs.)
// (Refitted 2026-10-26 from data/outlook-archive/fit-2026-10-26b by scripts/refit-from-archive.mjs.)
// (Refitted 2026-10-26 from data/outlook-archive/fit-2026-10-26c by scripts/refit-from-archive.mjs.)
// (Refitted 2026-10-26 from data/outlook-archive/fit-2026-10-26d by scripts/refit-from-archive.mjs.)
// (Refitted 2026-10-26 from data/outlook-archive/fit-2026-10-26d by scripts/refit-from-archive.mjs.)
// (Refitted 2026-10-27 from data/outlook-archive/fit-2026-10-26e by scripts/refit-from-archive.mjs.)
// (Refitted 2026-10-27 from data/outlook-archive/fit-2026-10-26f by scripts/refit-from-archive.mjs.)
// (Refitted 2026-10-27 from data/outlook-archive/fit-2026-10-27a by scripts/refit-from-archive.mjs.)
// (Refitted 2026-10-27 from data/outlook-archive/fit-2026-10-27b by scripts/refit-from-archive.mjs.)
// (Refitted 2026-10-27 from data/outlook-archive/fit-2026-10-27c by scripts/refit-from-archive.mjs.)
// (Refitted 2026-10-27 from data/outlook-archive/fit-2026-10-27d by scripts/refit-from-archive.mjs.)
export const CALIBRATION = Object.freeze({"day1":{"tornado":[[1.5,0.9],[2.7,1.7],[4.2,2.8],[6.2,5.2],[8.7,7.7],[11.2,10.4],[13.7,13.6],[17.3,20.5],[22.3,26.7],[27.3,32.1],[34.5,44],[44,55.7],[54.7,72.4],[64.4,87.5]],"wind":[[1.5,0.7],[2.7,1.3],[4.2,2.4],[6.2,3.2],[8.7,4.4],[11.2,6.2],[13.7,9],[17.4,12.5],[22.4,19.5],[27.4,28],[34.9,40.5],[44.8,62.4],[54.6,78.4],[66.9,90.5],[82.6,95.7]],"hail":[[1.5,0.5],[2.7,1.1],[4.2,1.7],[6.2,1.8],[8.7,4.5],[11.2,5.9],[13.7,8.5],[17.4,12.8],[22.4,18.8],[27.4,26.9],[34.9,40.1],[44.7,59.9],[54.8,79.2],[67,89.7],[82.5,95.5]]},"day2":{"tornado":[[1.5,1],[2.7,2.3],[4.2,4.4],[6.1,5.8],[8.7,9.6],[11.2,12.2],[13.7,14.7],[17.3,19.7],[22.3,25.6],[27.3,29.6],[34.3,39.9],[44.2,55.1],[54.5,65.6]],"wind":[[1.5,2.7],[2.7,4.4],[4.2,4.6],[6.2,5.3],[8.7,6.2],[11.2,9.3],[13.7,11.6],[17.4,15.8],[22.4,22],[27.4,29.9],[34.6,43.1],[44.7,58],[54.6,70.7],[66.1,86.1],[80.9,92.8]],"hail":[[1.5,1.5],[2.7,1.9],[4.2,2.2],[6.2,3.5],[8.7,5.3],[11.2,8.1],[13.7,9.8],[17.4,15.7],[22.4,25],[27.4,36.7],[34.6,45.6],[44.8,57.3],[54.6,71.1],[66.2,84.8],[80.7,90.7]]},"day3":{"severe":[[1.5,7.9],[2.8,8.1],[4.3,11.3],[6.2,13.1],[8.7,15.4],[11.2,18.3],[13.8,21.8],[17.4,23.2],[22.4,28.6],[27.4,35.6],[34.6,43.4],[44.3,47.2],[54,63.7],[65.6,77.2],[80,98.8]]},"day1update":{"tornado":[[1.4,0.8],[2.7,1],[4.2,2.2],[6.2,3.1],[8.7,5.2],[11.2,7.1],[13.7,8.5],[17.4,13.1],[22.4,22.7],[27.4,27.2],[34.5,32.9],[47,45.5],[63.3,65.7]],"wind":[[1.5,0],[2.7,0.2],[4.2,0.4],[6.2,0.9],[8.7,2.3],[11.2,4],[13.7,5.1],[17.4,7.5],[22.4,9.4],[27.5,16.5],[34.9,35.4],[45,65.3],[54.8,85.6],[67.3,95.1],[84.4,99.3]],"hail":[[1.5,0.1],[2.7,0.6],[4.2,1],[6.1,2.2],[8.7,4],[11.2,5.9],[13.7,6.6],[17.4,9.7],[22.5,16.9],[27.4,25.1],[34.8,38.5],[44.8,60.7],[54.8,79.5],[67.2,89.5],[84.5,97.4]]}});

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
// Refitted 2026-10-24 (third time): Day 1 tornado CIG1 verified 73% from 5 of 8 runs (45% at 2 of 8);
// CIG2 33-39% at 1-2 of 8 (the fit: never), drawn as boldly as CIG1 allows (the user's wish); CIG3 too few
// areas, 6 of 8 as before. Hail CIG1 from 2 of 8 (59%), CIG2 from 4 of 8 (67%).
// Refitted 2026-10-24 (fourth time): Day 1 tornado CIG1 verified 60-63% from 3 of 8 runs; CIG2 10% (the
// fit: never), drawn with CIG1 (the user's wish); CIG3 too few areas, 6 of 8. Hail CIG1 77% from 3 of 8, CIG2
// 57% at 2 of 8, drawn with CIG1. Day 2 tornado CIG1 53% from 4 of 8.
// (Refitted 2026-10-25 from data/outlook-archive/fit-2026-10-24 by scripts/refit-from-archive.mjs, with the user's tornado-group rule.)
// (Refitted 2026-10-25 from data/outlook-archive/fit-2026-10-25 by scripts/refit-from-archive.mjs, with the user's tornado-group rule.)
// (Refitted 2026-10-25 from data/outlook-archive/fit-2026-10-25b by scripts/refit-from-archive.mjs, with the user's tornado-group rule.)
// (Refitted 2026-10-26 from data/outlook-archive/fit-2026-10-25c by scripts/refit-from-archive.mjs, with the user's tornado-group rule.)
// (Refitted 2026-10-26 from data/outlook-archive/fit-2026-10-26 by scripts/refit-from-archive.mjs, with the user's tornado-group rule.)
// (Refitted 2026-10-26 from data/outlook-archive/fit-2026-10-26b by scripts/refit-from-archive.mjs, with the user's tornado-group rule.)
// (Refitted 2026-10-26 from data/outlook-archive/fit-2026-10-26c by scripts/refit-from-archive.mjs, with the user's tornado-group rule.)
// (Refitted 2026-10-26 from data/outlook-archive/fit-2026-10-26d by scripts/refit-from-archive.mjs, with the user's tornado-group rule.)
// (Refitted 2026-10-26 from data/outlook-archive/fit-2026-10-26d by scripts/refit-from-archive.mjs, with the user's tornado-group rule.)
// (Refitted 2026-10-27 from data/outlook-archive/fit-2026-10-26e by scripts/refit-from-archive.mjs, with the user's tornado-group rule.)
// (Refitted 2026-10-27 from data/outlook-archive/fit-2026-10-26f by scripts/refit-from-archive.mjs, with the user's tornado-group rule.)
// (Refitted 2026-10-27 from data/outlook-archive/fit-2026-10-27a by scripts/refit-from-archive.mjs, with the user's tornado-group rule.)
// (Refitted 2026-10-27 from data/outlook-archive/fit-2026-10-27b by scripts/refit-from-archive.mjs, with the user's tornado-group rule.)
// (Refitted 2026-10-27 from data/outlook-archive/fit-2026-10-27c by scripts/refit-from-archive.mjs, with the user's tornado-group rule.)
// (Refitted 2026-10-27 from data/outlook-archive/fit-2026-10-27d by scripts/refit-from-archive.mjs, with the user's tornado-group rule.)
export const CIG_SHARE = Object.freeze({"day1":{"tornado":[0.375,0.375,0.75],"wind":[1.01,1.01,1.01],"hail":[0.625,1.01]},"day2":{"tornado":[0.5,0.625,0.75],"wind":[1.01,1.01,1.01],"hail":[0.5,0.75]}});

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
