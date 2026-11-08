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
// (Refitted 2026-10-29 from data/outlook-archive/fit-2026-10-28-cheap by scripts/refit-from-archive.mjs.)
// (Refitted 2026-10-29 from data/outlook-archive/fit-2026-10-29 by scripts/refit-from-archive.mjs.)
// (Refitted 2026-11-06 from C:/Users/alex1/.claude/jobs/f592f53b/tmp/stepfix/arch-after by scripts/refit-from-archive.mjs.)
// (Refitted 2026-11-06 from C:/Users/alex1/.claude/jobs/f592f53b/tmp/i2i3/arch-all by scripts/refit-from-archive.mjs.)
// (Refitted 2026-11-06 from C:/Users/alex1/.claude/jobs/f592f53b/tmp/refit2/arch by scripts/refit-from-archive.mjs.)
// (Refitted 2026-11-07 from C:/Users/alex1/.claude/jobs/f592f53b/tmp/fc/fit-2026-11-07 by scripts/refit-from-archive.mjs.)
export const CALIBRATION = Object.freeze({"day1":{"tornado":[[1.5,1.2],[2.7,3],[4.2,4.7],[6.1,8.6],[8.7,13.4],[11.2,19.4],[13.6,24.1],[17.2,29.4],[22.2,38.1],[27.3,50.3],[34.4,59.7],[44.6,70]],"wind":[[1.5,0.6],[2.7,1.3],[4.2,2.4],[6.2,3.7],[8.7,8.5],[11.2,12.2],[13.7,16],[17.4,23.9],[22.4,35.5],[27.4,44.8],[34.5,56.4],[44.4,70.9],[54.3,83.1],[65.7,90.4]],"hail":[[1.5,0.7],[2.7,1.6],[4.2,3.5],[6.2,5],[8.7,7.9],[11.2,10],[13.7,13.6],[17.4,19.5],[22.4,30.6],[27.4,42.4],[34.7,55],[44.6,70.1],[54.6,83],[66.2,92.1],[77.9,99.2]]},"day2":{"tornado":[[1.4,1.4],[2.7,3.5],[4.2,6.1],[6.1,10],[8.6,14.9],[11.1,17.2],[13.6,23.8],[17.2,30.2],[22.3,49.4],[27.3,51.8],[34.2,68.3]],"wind":[[1.5,1.4],[2.7,2.4],[4.2,4.6],[6.2,7.1],[8.7,9.5],[11.2,15.1],[13.7,19.8],[17.4,28.2],[22.4,38.1],[27.3,46.6],[33.9,55.8],[43.7,74.6],[53.6,86.4]],"hail":[[1.5,1.7],[2.7,3.3],[4.2,4.9],[6.2,6.2],[8.7,7.9],[11.2,11.6],[13.7,15.1],[17.4,23.2],[22.4,34.7],[27.4,43.2],[34.5,54.7],[44.3,68.6],[54.3,84.5],[65.2,93.6]]},"day3":{"severe":[[0.6,8.1],[1.5,10.3],[2.8,16],[4.2,16.9],[6.2,18.9],[8.7,26.9],[11.2,29.7],[13.7,35],[17.1,39.2],[22.3,41.9],[27.1,59.2],[33.6,72.6],[44.3,86.1]]},"day1update":{"tornado":[[1.4,0.8],[2.7,1],[4.2,2.2],[6.2,3.1],[8.7,5.2],[11.2,7.1],[13.7,8.5],[17.4,13.1],[22.4,22.7],[27.4,27.2],[34.5,32.9],[47,45.5],[63.3,65.7]],"wind":[[1.5,0],[2.7,0.2],[4.2,0.4],[6.2,0.9],[8.7,2.3],[11.2,4],[13.7,5.1],[17.4,7.5],[22.4,9.4],[27.5,16.5],[34.9,35.4],[45,65.3],[54.8,85.6],[67.3,95.1],[84.4,99.3]],"hail":[[1.5,0.1],[2.7,0.6],[4.2,1],[6.1,2.2],[8.7,4],[11.2,5.9],[13.7,6.6],[17.4,9.7],[22.5,16.9],[27.4,25.1],[34.8,38.5],[44.8,60.7],[54.8,79.5],[67.2,89.5],[84.5,97.4]]}});

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
// (Refitted 2026-10-29 from data/outlook-archive/fit-2026-10-28-cheap by scripts/refit-from-archive.mjs, with the user's tornado-group rule:
// the first fit with the cheap runs (Day 1 8 full + 24 cheap, Day 2 4 + 12; OUTLOOK.cheapPerMember) and with the
// truth stepped as the server steps the live world. On those 100 mornings Day 1 went from right on 48% of days
// (37% too high) to 61% (23% too high). day1update is still the 2026-10-24 fit, made from 8 runs.)
// (Kept 2026-10-29: the refit on fit-2026-10-29 asked 3/8 runs for Day 1 tornado CIG2/CIG3 and cut Day 1 Moderate+High from 25% to 18% of days, 24% verified.)
// (2026-11-07: Day 3 any severe hatched where all its runs reach CIG1, judged with OUTLOOK.ingredientCigBounds; fit-new seeds 1-20:
// Day 3 right 48 -> 52%, too high 10%. Day 2 kept: the fitted hail 0.375 / tornado CIG2 0.375 lowered Day 2 to 51%.)
export const CIG_SHARE = Object.freeze({"day1":{"wind":[1.01,1.01,1.01],"hail":[0.5,0.875],"tornado":[0.25,0.25,0.25]},"day2":{"wind":[0.625,0.75,0.875],"hail":[1.01,1.01],"tornado":[0.25,0.25,0.75]},"day3":{"severe":[1.0]}});

// The intensity groups of hail and wind weighed with the environment (2026-11-08; DayOneOutlook.js significantHailParameter and
// derechoCompositeParameter): for each day, hazard and group, [a, b, c, field] of a logistic fit of whether the group verified
// in a contour area on the share of the runs reaching it there and ln(1 + the area's composite) (scripts/fit-cig-environment.mjs
// from outlook-verify --cig-rows). A group with an entry is drawn where the fit gives one half or more and a run reaches it;
// without one, CIG_SHARE as before. Tornado groups never take one.
// Fitted 2026-11-08 on tmp/d23/fit-sig (seeds 1-20 x 5) and not installed: the environment lowered the deviance only a little
// (Day 1 hail CIG1 176.7 -> 172.7, wind CIG1 45.6 -> 42.8, Day 2 hail 148.7 -> 146.0; hail CIG2 and wind CIG2-3 too rare to fit).
// With it, Day 1 right 70 -> 69% (seeds 1-20) and 57 -> 57% (41-50), but Moderate went the wrong way on 41-50 (33 -> 37%, 20%
// verified) and hail CIG1 was drawn on 33% of them against 17% verified. The fit was
// {"day1":{"hail":[[-6.341,6.012,2.256,"envMax"]],"wind":[[-9.938,7.222,1.826,"envMax"]]},"day2":{"hail":[[-6.011,4.402,2.395,"envMax"]]}}.
export const CIG_ENVIRONMENT = Object.freeze({});

import { PROBABILITY_LEVELS } from './spcOutlookRules.js';

// The calibrated chance (percent) for a raw one. It may lower a chance as far as the record says,
// but raise it by one contour level at most above the level the runs themselves reach, and not at
// all into a level from GUARD_LEVEL up (where Moderate and High come from): those the runs must
// reach themselves (2026-10-17; uncapped, and with one level allowed everywhere, Day 1 issued High
// on 10% of mornings against 5% that verified, and a false High costs players' trust).
// Any severe (Day 3) is guarded from 60 (2026-11-07; 45 until then): its Moderate needs 60 with CIG1 (45 with CIG2, which Day 3
// never draws, WORLD_MAX_CIG), so a guard at 45 kept every Day 3 below Enhanced (seeds 1-20: SLGT on 97% of mornings,
// with places at the 43% the guard held them to verifying 51%).
const GUARD_LEVEL = { tornado: 30, wind: 45, hail: 45, severe: 60 };
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
  // Past the fitted data the runs' own chance, never less than the last fitted value (2026-11-05: until then held at the
  // last value, so a fit from days whose raw tornado chance never passed 23% capped the tornado chance at 26% for good).
  return Math.min(100, Math.max(points.at(-1)[1], raw));
}

// The category cutoffs fitted for I3 (OUTLOOK.ensemble method 'nmep', sigmaKm day1 32 / day2 48, with its own chances' table)
// on 2026-11-06 (scripts/fit-category-cutoffs.mjs; fit seeds 1-30, 84 Day 1 and 54 Day 2 outlooks; docs/research/OUTLOOKS-MDS-WATCHES.md
// section 8): each contour level counts for the category only at about twice its chance (Day 1 x2.15-2.4, Day 2 x1.6-2.0).
// Not in use: OUTLOOK.categoryCutoffs is null. To try I3 with it, set OUTLOOK.ensemble to { method: 'nmep', sigmaKm: { day1: 32,
// day2: 48 } }, OUTLOOK.categoryCutoffs to CATEGORY_CUTOFFS_NMEP, and the calibration to CALIBRATION_NMEP below.
export const CATEGORY_CUTOFFS_NMEP = Object.freeze({"day1":{"tornado":{"2":4.8,"5":12,"10":24,"15":36,"30":72,"45":108,"60":144},"wind":{"5":10.8,"15":32.3,"30":64.5,"45":96.8,"60":129,"75":161.3,"90":193.5},"hail":{"5":11.3,"15":33.8,"30":67.5,"45":101.3,"60":135}},"day2":{"tornado":{"2":3.2,"5":8,"10":16,"15":24,"30":48,"45":72,"60":96},"wind":{"5":8.5,"15":25.5,"30":51,"45":76.5,"60":102,"75":127.5,"90":153},"hail":{"5":10,"15":30,"30":60,"45":90,"60":120}}});
// I3's own chances' table, fitted with it on the same 84 mornings (day1update and Day 3 as in CALIBRATION). Not in use.
export const CALIBRATION_NMEP = Object.freeze({ ...CALIBRATION, ...{"day1":{"tornado":[[1.5,1.5],[2.7,2.5],[4.2,4.2],[6.2,6.4],[8.7,7.6],[11.2,10.9],[13.7,12.7],[17.4,17.4],[22.3,23.8],[27.4,27.5],[34.5,36.5],[44.6,49.9],[54.5,57.7],[68.4,74.2]],"wind":[[1.5,0.4],[2.7,1.4],[4.2,2.7],[6.2,3.9],[8.7,5.8],[11.2,7.8],[13.7,11.5],[17.4,16.8],[22.5,22.9],[27.5,27.8],[34.9,35.8],[45,48.6],[54.7,59.9],[66.9,72.8],[82.7,87.8]],"hail":[[1.5,0.7],[2.7,1],[4.2,2],[6.2,2.9],[8.7,5.4],[11.2,7.6],[13.7,11.5],[17.4,16.4],[22.5,22.3],[27.4,27.4],[35,36.3],[44.8,47.9],[55,59.9],[67.1,73.5],[86.4,91.4]]},"day2":{"tornado":[[1.5,1.5],[2.7,3],[4.2,4.7],[6.1,5.9],[8.7,8.7],[11.2,11.5],[13.7,14.9],[17.3,18.2],[22.3,24.9],[27.4,32.7],[34.3,44.7],[44.4,59.4],[55.1,67.6]],"wind":[[1.5,1.1],[2.7,1.8],[4.2,3.4],[6.2,5],[8.7,7.5],[11.2,9.8],[13.7,14.4],[17.4,18.5],[22.4,22.3],[27.4,28.9],[34.6,38.9],[44.7,52.4],[54.5,59.2],[65.6,69.3],[78.4,87.7]],"hail":[[1.5,1.2],[2.7,2.1],[4.2,3.4],[6.2,6.4],[8.7,7.4],[11.2,9.1],[13.7,12.6],[17.4,18],[22.4,20.8],[27.4,26.2],[34.8,35.5],[44.7,50],[54.8,62],[66.9,72.1],[81.6,92.1]]},"day3":{"severe":[[1.5,6.9],[3.6,9.4],[6.2,15.1],[8.7,21.8],[11.2,32.2],[13.7,38.8],[19,38.9],[27.1,59.2],[34.5,62]]}} });
