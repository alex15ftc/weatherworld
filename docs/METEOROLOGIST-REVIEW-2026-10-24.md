# Meteorologist review after the pressure, line-wind, rating and outlook changes (2026-10-24)

Seeds 1000, 2112, 8181 and 31, three days each, made with `scripts/day-review-pack.mjs` after
the changes of 2026-10-23/24 (docs/FIX-PLAN-2026-10-22.md):
- the region's air no longer lags the large-scale air (carryDeparture);
- the ground column's weight counts in surface pressure;
- line winds come down in cores and patchy swaths, and a place reports once;
- tornado truth uses damage ratings, with more EF4 damage indicators;
- the outlook was refitted on 100 mornings.

The per-day reviews are in `data/day-reviews/2026-10-24/seed-*/day-*/review.md`. Most days played
out differently from the previous round, so the ratings compare different weather, not the same
day improved.

## Days and ratings

Ratings are synoptic / meso / outcome / outlook.

| Seed / day | What happened | Ratings (previous) |
|---|---|---|
| 1000/1 | Cool air near a cut-off low; thunder only, correctly forecast | 7/5/7/7 (7/5/7/7) |
| 1000/2 | Overnight rotating storms in a corridor; CAPE built through the night | 7/5/5/7 (7/6/6/5) |
| 1000/3 | 289 storms in 5,000 J/kg; Moderate risk; 159 hail, 123 wind, 4 tornadoes | 8/4/6/6 (8/6/5/5) |
| 2112/1 | Warm sector under a 1031 hPa high; 86 storms, 1 hail and 3 wind reports; outlook TSTM | 7/6/4/3 (6/5/6/4) |
| 2112/2 | Uncapped warm sector under the jet entrance; 217 storms, 617 hail, 818 wind, 11 tornadoes | 8/5/4/6 (8/7/6/7) |
| 2112/3 | Cap broke under rising heights; about 15 supercells, 6 tornadoes from 12:30 pm | 7/5/5/6 (7/6/7/6) |
| 8181/1 | Dryline outbreak; 22 tornadoes, one EF5 and nothing EF3-EF4; outlook ENH (should be MDT) | 7/7/6/5 (7/7/6/6) |
| 8181/2 | Capped ridge day, heat low | 6/5/6/7 (7/6/6/6) |
| 8181/3 | 42 pulse and multicell storms in 2,000-2,900 J/kg; no reports at all | 5/6/4/5 (6/6/5/5) |
| 31/1 | NW-flow ridge-rider; lines and a QLCS gave 0 wind reports | 7/6/4/6 (7/6/4/4) |
| 31/2 | High Plains lee trough under the jet; 82 hail reports up to 4 in, 47 wind; MDT verified well | 7/6/8/8 (7/7/6/6) |
| 31/3 | Capped null day under a closed upper high; 1036-1038 hPa high in warm air; 2% tornado from 0 of 8 runs | 5/4/7/4 (6/5/7/8) |

**Means:** synoptic 6.8 (6.9), meso 5.3 (6.0), outcome 5.5 (5.9), outlook 5.8 (5.8).

## What improved
- **Highs over hot air are mostly gone** (seed 2112 day 1: 1036-1046 hPa before, now only 1036-1038
  in the cool NE corner). Warm-sector pressures look right on most days.
- **Line and cluster days give wind reports** (seed 8181 day 1: 7 to 68; seed 31 day 2: 47; seed
  1000 day 3: 123), with no ~2,000-report flood.
- **Hail days look real:** seed 31 day 2 had 82 reports up to 4 in; 3.5 in hatching verified (4.5 in).
- **Outlook hatching:** tornado hatching only on the core, none on days with no EF2+, and the tiny
  High blob is gone. Several outlooks verified very well (seed 31 day 2, seed 1000 day 2, seed 2112
  day 2).

## What is wrong (by how many reviewers raised it)

1. **Instability and the cap: the warm sector is uncapped and over-unstable** (3 reviewers).
   - **Seed 1000:** MLCAPE (90th percentile) rises through the night, 2,314 to 4,539 J/kg by 12Z, max
     5,092, and stays about 5,000 (max 5,920) all of day 3 while 30 storms run.
   - **Impossible profiles:** 850 mb 16.4 C over 700 mb -0.3 C, about 10.4 C/km.
   - **Seed 2112:** MLCIN 0 across the warm sector and 15 storms by 10 am; storms at 12-15Z under
     rising heights and sinking air.
   - Two reviewers suspect the region-air change (carryDeparture) of making the region warmer,
     moister and uncapped.
2. **Severe reports swing between none and far too many** (3 reviewers).
   - **Too many:** seed 2112 day 2 had 617 hail and 818 wind reports, mostly along supercell tracks
     every 5-10 miles.
   - **Too few:** seed 8181 day 3 had 0 reports from 42 storms in 2,000-2,900 J/kg; seed 2112 day 1
     had 1 hail and 3 wind from 86 storms; seed 31 day 1's lines gave 0 wind.
   - Seed 8181 day 1 hail fell from 250 to 69 reports with no hail change. The place-once rule also
     applies to hail.
3. **Surface pressure gradients and lows over hot ground** (3 reviewers).
   - Seed 1000 day 2: 994 to 1030 hPa across the map, about twice the large scale, with 30-47 kt
     sustained surface winds.
   - Seed 8181 day 3: a 990 hPa low against the large-scale 1000; day 2's heat low is 998 against 1024.
   - Since the column-weight change, hot air reads too low and cool corners still too high.
4. **Tornado strength and life** (3 reviewers).
   - No EF2+ in 19 tornadoes on seed 2112, in STP 5-6.
   - Seed 8181 day 1 had one EF5 and nothing EF3-EF4.
   - Most tornadoes last exactly 10 minutes (15 of 19, 5 of 5, 15 of 22).
5. **Outlook categories and text** (all 4).
   - **Categories:** seed 8181 day 1 issued ENH with 60% wind and 15% hatched tornado, which make
     at least MDT; seed 2112 day 1 issued TSTM with 5 of 8 runs tornadic; seed 31 day 3 drew 2%
     tornado from 0 of 8 runs.
   - **Text:** "weak shear 25-30 kt" at 45-53 kt; garbled time windows; "dry" air with 60 F dewpoints;
     the cap and short-wave never named.
6. **Smaller points:**
   - edge environments (most days);
   - fronts drawn in uniform air;
   - tracks jogging at right angles;
   - no MCS from many storms;
   - too many left-movers (seed 1000 day 2: 12%);
   - the night jet dying instead of strengthening (seed 2112 day 2).

## Follow-up: instability (2026-10-24)

**The region-air change (carryDeparture), on against off.** Seeds 1000 and 2112, 3 days each, every
3 hours:

| | carryDeparture on | off |
|---|---|---|
| 850 mb dewpoint (90th percentile) | 15-18 C | often 7-11 C |
| Night CAPE, seed 2112 day 1 (p90) | about 2,300 | 0 |
| CAPE p90 at 12Z, seed 1000 day 3 | 4,539 | 1,502 |

The old (off) version was dry aloft mostly because of its false cold domes, so neither is right.

**The impossible lapse rates** (850-700 mb past dry adiabatic, up to 12-13 C/km) occurred in both.
The cause: 850 mb takes the map's own warm air, and 700 mb the large-scale layer's less up to 6 K
of lift cooling.

**Fixed: convective adjustment** (RegionalAtmosphere `convectiveAdjustment`). Where 700 mb would be
cooler in potential temperature than 850 mb, the two mix to their shared value, keeping the heat.
Results:
- The steepest 850-700 lapse is now about dry adiabatic (10.0-10.4 by the probe's fixed 1.55 km depth).
- CAPE hardly changed (seed 1000 day 3 15Z p90 4,920 to 4,644).
- 40-day probe: supercells 48 a day either way; tornado days 88% to 85%.

**So the excess CAPE is moisture:** 850 mb dewpoints of 15-18 C and surface dewpoints near 70 F
over most of the warm sector, and MLCAPE rising overnight.

**Also fixed:** the place-once report rule now applies to wind only (hail reports had dropped 70% on
seed 8181 day 1).

Full suite: 55 of 55 pass.

**Moisture and nights (seeds 1000 and 2112 every 3 hours; seeds 1, 2, 1000 and 2112 at 09Z).**

| | Engine | Real outbreaks |
|---|---|---|
| Surface dewpoint p50 | 62-68 F | 62-70 F (fine) |
| Surface mixing ratio p90 | 15-16 g/kg | 14-17 (fine) |
| Gulf air | 14.7-15.3 g/kg | fine |
| Moist layer | 1,300-2,500 m above the ground (top about 2,100 m ASL) | 1-1.5 km |
| 850 mb moisture | 0.85 of the surface's (`0.85 * this.moisture`), Td p50 13-17.5 C | 12-14 C typical |
| Cooling 00-09Z | 6-13 F; clouds hold back little (clear-sky factor 0.7-1.0) | 8-12 F on windy warm-sector nights, 12-18 on calm clear ones |

Night cooling acts only on the lowest 150 m. So the deep moist layer keeps MLCAPE and SBCAPE high
all night, and the night jet's moisture raises them (seed 1000: SBCAPE p90 5,285 at 09Z, surface
77 F at 4 am).

**Levers:**
- the 850 mb moisture share;
- the moist-layer top (`moistLayerTopM` 2100);
- night cooling.

All lower CAPE everywhere, so they are expected to cost tornado days as the cap tests did. The
decision is with the user.

**Option (b): 850 mb moisture share 0.85 to 0.75** (RegionalAtmosphere `moisture850Share`, used
above the day's mixed layer and at night).

| Seed, time | 850 mb Td p50 | MLCAPE p90 |
|---|---|---|
| 2112, day 2 09Z | 14.9 to 13.2 C | 2,017 to 1,572 |
| 1000, day 2 09Z | 14.1 to 12.2 C | 3,477 to 3,080 |
| 1000, day 3 21Z | unchanged | 4,951 to 4,942 |

Nights and mornings lose about 2 C at 850 mb and 300-450 J/kg overnight. Afternoon peaks and
SBCAPE are unchanged, since the mixed layer sets 850 mb by day.

**40-day probe:**

| | Before | After |
|---|---|---|
| New storms per day | 110 | 94 |
| Supercells per day | 48 | 41 |
| Days with 40+ supercells | 40% | 36% |
| Tornado days | 85% | 79% |

Kept or reverted at the user's choice.

**The outlook category cases:**

| Case | Finding |
|---|---|
| Seed 8181 day 1 (ENH with 60% wind and 15% hatched tornado) | Correct: the SPC's published CIG matrix (spcOutlookRules.js) makes 15% tornado CIG1 and 60% wind CIG0 both ENH. The reviewer used the older rules. |
| Seed 2112 day 1 (TSTM with 5 of 8 runs tornadic) | Calibration, not a bug: the runs' tornadoes were in different places, so no place reached 2% after calibration. |
| Seed 31 day 3 (2% tornado from "0 of 8 runs") | Text bug: a run's tornado count left out tornadoes already down at 12Z. Fixed: DayOneOutlook counts every tornado in the period's frames. |

**Bug found and fixed in truth.js.** In `collectTornadoTruthPoints` the point's de-duplication key was
also named `key` and hid the tornado's key. Every track point was its own "tornado", so a tornado's
track was not rated as a whole by its strongest moment. (This touches the CIG truth; the refit
follows.)

**Outlook refit (third of the day).** 100 mornings (seeds 1-20 x 5). With the previous tables Day 1
was right 68% and within one 95%. Installed:
- CALIBRATION from the fit;
- Day 1 tornado CIG [0.625, 0.625, 0.75]: CIG1 verified 73% at 5 of 8, CIG2 drawn with CIG1 by the
  user's wish (verifies 33-39%);
- hail [0.25, 0.5].

**Check on seeds 21-30 x 3:**

| | Right | Within one | Too high | Too low |
|---|---|---|---|---|
| Day 1 | 53% | 97% | 7% | 40% |
| Day 2 | 50% | 100% | | |
| Day 3 | 70% | 100% | | |

Full suite: 55 of 55 pass.

**Tornado life (fixed).** A tornado could end only at a tick after the one it formed in, so every
short-lived one lasted exactly 10 minutes and ran 5-8 miles. Two changes:
- TornadoEngine `cutToLife`: a tornado whose drawn life ran out between ticks has its track cut
  back to that moment, with path, ground time and rating recomputed.
- stormLog trims its own points to the engine's cut track.

**Seeds 1-4 x 5 days (229 tornadoes)** — 44 still last exactly 10 minutes; they ended by losing
rotation, which is seen at a tick.

| | Duration (median) | Path (median) |
|---|---|---|
| All | 10 min (p25 3.2, p75 14.2) | 4.1 mi |
| Peak-wind EF0 | 6.6 min | 2.9 mi |
| Peak-wind EF1 | 10 min | 5.2 mi |
| Peak-wind EF2-3 | 28-29 min | 14 mi |
| Peak-wind EF4 | 65 min | 30 mi |

**40 days (seeds 1-4), with all of the day's changes:**

| | Value |
|---|---|
| Tornadoes | 394 |
| Ratings EF0-EF5 | 56.9 / 34.0 / 6.1 / 2.0 / 1.0 / 0 (US record 52 / 35 / 9 / 2.4 / 0.45 / 0.05) |
| Tornado days | 78% |
| Quiet days | 13% |
| High | 13% |
| Moderate | 28% |

**Pressure over hot ground.**

**The cool side (fixed).** The cool-corner highs (1031-1033 hPa) were mostly a cold-dome term of
+6 to +10 hPa. Air 14-15 K below a normal-temperature layer was weighed as a 3.8-4.5 km dome
(`domeDeficitKPerM` 0.0035, up to `domeMaxM` 4500). The dome is now capped at the 750 mb level
above the ground (`domeTopM`): from there up the outer layer holds the temperature, and the column
below is already counted in the ground pressure.

6 seeds x 4 days:

| | Before | After |
|---|---|---|
| Highest pressure p90 | 1030.4 hPa | 1028.2 hPa |
| Highest pressure max | 1039.5 hPa | 1036.1 hPa |
| Lows p10 | 990.6 hPa | 990.6 hPa |
| Warm highs | 11% | 11% |
| Fronts | unchanged | unchanged |

40-day probe: storms and supercells unchanged; tornado days 79% to 78%. Full suite: 55 of 55 pass.

**The deepest lows (984-987 hPa, 6 seeds), not changed:**
- **Hot western corner:** the outer model's own low (-20 hPa, its surface air 18-20 K above
  normal), plus lee (-2.5), high-ground warmth (-3.5) and heating (-2 to -3). The excess is the outer
  low stacked under a heat low.
- **Eastern cyclones:** the outer low (-14) plus the map's own cyclone deepening (`cyc`, -9 to
  -13.5), which was added so that surface lows appear.

Both come from intended terms, so they are left for the user to decide.

**Reports too few on pulse-storm days: it is the storms, not the reporting.** Non-rotating storms
(intensity 0.3 or more):

| Seed / day | Storms | MLCAPE | DCAPE | Updraught p50 / p90 | Hail p90 | Hail 1 in+ | Gust p90 | Gust 58 mph+ |
|---|---|---|---|---|---|---|---|---|
| 8181/3 | 24 | 2,046 | 845 | 34 / 37 m/s | 0.54 in | 0 | 44 mph | 0 |
| 2112/1 | 59 | 2,255 | 889 | 35 / 46 m/s | 0.92 in | 5 | 55 mph | 5 |
| 31/1 | 30 | 2,315 | 929 | 44 / 48 m/s | 1.08 in | 5 | 57 mph | 2 |

`HAIL` (scale 3.0, power 2.5, nonRotating 0.8, melting 0.3 in per 3 km) grows 0.6-1.1 in at 34-44
m/s and melts it to 0.2-0.8 in. Pulse gusts are the downdraught alone, `downdraughtShare` 0.5 of
sqrt(2 DCAPE), about 40-48 mph. Real days like these give roughly 10-20% of pulse storms with 1 in
hail or a 58 mph gust.

**On the "too many" side:** seed 2112 day 2's 617 hail reports are about 6 per supercell. The
excess is the supercell count, not the report rate.

**Discussion text (fixed).** DayOneOutlook `describeEnvironment` and `writeDiscussion`:

| Problem | Fix |
|---|---|
| Shear quoted at its 75th percentile ("weak (25 kt)" beside maps of 45-53 kt) | 90th percentile, as the CAPE is; the label judged on the printed number |
| Flow aloft a vector mean (20-25 kt where mid-map had 27-31) | Mean speed |
| Upper trough or ridge never named | Named from the 500 mb height change over 12 hours ("falling sharply ... as an upper trough approaches" from -6 dam, "rising ... under a building ridge" from +6) |
| Storms still going at 12Z set the windows ("between 12Z and 13Z", "peaking near 12Z") | Their first hour leaves the severe and tornado windows |
| Windows of 9+ hours read "between 12Z and 11Z" | Now "spread through the period, greatest near HHZ" |

Seed 1000 day 3 now reads: heights falling as a trough approaches; severe 13Z-16Z; tornado
15Z-17Z. Full suite: 55 of 55 pass.

**Tried: pulse-storm hail and wind** (HAIL power 2.5 to 2, GUST downdraughtShare 0.5 to 0.6).

| Day | Effect |
|---|---|
| 8181/3 | 1 in hail 0 to 1 storm; 58 mph 0 to 1 |
| 2112/1 | 1 in hail 5 to 11 |
| 31/1 | 1 in hail 5 to 16; 58 mph 2 to 4 |
| 2112/2 (outbreak) | hail reports 617 to 1,145; wind 818 to 1,014 |

Both act on every storm, so the small gain on pulse days overshoots outbreak days. Reverted. Pulse
storms are left as they are.

**Batch of smaller items (2026-10-24), with one refit after:**

| Item | Finding | Change |
|---|---|---|
| Edge environments | Top-5% STP and CAPE in the 5-cell border band 27% and 32% of the time (36% if evenly spread); no edge bias | None |
| MCS | 223 line systems reached 220 km and 4 h in 40 days; MCS 3% and QLCS 8% of storm time. One MCS is one storm, so the share looks small. | None |
| Left-movers | 9.1% of storm time (20% of supercell time) | StormModeEngine `SPLIT.straightHelicity` [50, 200] to [25, 150]: 10% of supercell time; discrete supercells 7.5 to 9.8%; tornado days unchanged (78%) |
| Fronts in uniform air | Fronts are found in air-mass theta, which leaves out the day's heating | BoundaryAnalysis `groundShows`: across a front, surface theta 2 K, or moisture 2 g/kg, or wind 8 m/s, along half of it; removes only a few |
| Night jet | Peaks about 1.4 x the balanced wind at 3-9Z (2112 night 1: 24 to 43 kt). The "dying" night was the outer model's flow falling from 30 to 8 kt. | None |
| Track jogs | Line joins moved the keeper's centre at once along the line | StormEngine: line joins glide at MERGE_GLIDE_KPH, as cell mergers do |
| Pulse hail and wind | See "Tried: pulse-storm hail and wind" | Reverted |

Test storm-shape-and-interactions: helicity 40 to 20 for the even split. Full suite: 55 of 55 pass.

**Refit after the batch (fourth of the day).** 100 mornings (seeds 1-20 x 5). With the previous
tables, Day 1 was right 66% and within one 95%. Installed:
- CALIBRATION from the fit;
- Day 1 tornado CIG [0.375, 0.375, 0.75]: CIG1 verified 60-63% at 3 of 8, CIG2 kept by the user's
  wish;
- hail [0.375, 0.375];
- Day 2 tornado [0.5, 0.625, 0.75]: CIG1 53% at 4 of 8.

**Check on seeds 21-30 x 3:**

| | Right | Within one | Notes |
|---|---|---|---|
| Day 1 | 57% | 93% | too high 10%, too low 33% |
| Day 2 | 55% | 85% | |
| Day 3 | 50% | 90% | |

Day 1 EF2+ hatching was drawn on 3% of these outlooks and verified on 7%; Day 2 drew 10% and verified 10%.

Full suite: 55 of 55 pass.
