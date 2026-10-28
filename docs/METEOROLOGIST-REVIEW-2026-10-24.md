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

## Second review round (same seeds and weather, after the day's fixes)

Packages in `data/day-reviews/2026-10-24-b`.

**Means:**

| | Synoptic | Mesoscale | Outcome | Outlook |
|---|---|---|---|---|
| Earlier today | 6.8 | 5.3 | 5.5 | 5.8 |
| Now | 6.8 | 5.4 | 5.6 | 6.5 |

**Helped (all reviewers):**
- **Outlook categories now follow the CIG matrix.** The seed 2112 day 2 Moderate tornado area verified 11 tornadoes against a middle of 9; seed 31's bogus Day 3 tornado area and its time window are gone.
- **Tornado durations are no longer stuck at 10 minutes.** 0 of 18 on seed 8181 last exactly 10, and seed 8181's EF mix is now 56 / 28 / 17%.
- **Night and morning instability is down 15-25%,** with far fewer morning storms (seed 2112: 15 to 2).
- **Track jogs are mostly gone.**
- **Some false fronts are removed,** and left-movers are down on 3 of 4 seeds.

**Remaining:**
1. **Afternoon instability is unchanged (MLCAPE p90 4,700-4,900, peaks 5,900).** The 850-700 mb layer on the extreme day is nearly saturated, and the convective adjustment holds it only at the dry adiabat (about 9.6-10 C/km), where a saturated layer should be held near the moist adiabat (5-6 C/km). The region's moisture also runs 15-16 g/kg where the large-scale field shows 9-11.
2. **Reports.** Seed 2112 day 2 has 775 hail (up from 617, since hail is no longer limited by the place rule) and 809 wind reports along supercell tracks. Ordinary storms in hail environments give none (seed 8181 day 3: 28 storms, 0 reports). Lines still give few wind reports.
3. **No strong tornadoes on seeds 2112 and 1000** in STP 4-6.
4. **The cap breaks under rising heights** (seed 2112 day 3: storms all morning and a 9:30 am tornado).
5. **Text slips:**
   - the flow called "weak (35 kt)" and "moderate" at 50-55 kt (the same rounding issue as shear had);
   - height wording read against the issue time, while the text describes the late afternoon;
   - the trough not named for falls of 3-5 dam.
6. **Smaller:**
   - 0-minute tornadoes, one an EF1 with a 0.0 mi path;
   - a dryline possibly missing on seed 1000 day 3 (front check?);
   - edge environments;
   - the night jet collapsing (seed 2112 day 2);
   - heat lows.

## After the second round (2026-10-24)

**Engine batch:**
- **Moist adiabat** (RegionalAtmosphere `moistAdjustmentK` 2, `moistAdiabatTo`): where 850 mb is within 2 K of saturation, 700 mb may not be colder than the moist adiabat from it, and the two meet halfway, with 850 mb drying. Seed 1000 day 3 21Z MLCAPE p90 went from 4,821 to 3,371; nights and mornings fell 15-30%. 40-day probe: supercells 41 to 38 a day, tornado days 78 to 75%.
- Text: the flow's label judged on its printed speed; height wording reads "by late afternoon".
- A tornado lasts at least a minute.

**Dryline (seed 1000 day 3).** It was not the ground check: a fresh analysis drew a 411-582 km dryline with or without it. In the live analysis, every front crest, outflow boundaries and undrawn crests among them, kept drylines off it. Now only lines drawn as fronts (or followed drylines) do (BoundaryAnalysis); the live analysis draws a 528-582 km dryline. Maps and outlook text only.

**Regional moisture against the large-scale model.** No mismatch. The map's air follows its target (inflowMoisture), and the large-scale air itself has 13.6-15.1 g/kg there on seed 1000 day 3, from the Gulf supply (14.75 g/kg). The extreme days are rich-moisture days.

**Outlook archive** (`outlook-verify --save/--from`, `scripts/refit-from-archive.mjs`, data/outlook-archive, git-ignored). Re-scoring two saved mornings gave identical results in 1.2 s; 1.2 MB per 2 mornings.

**Server cost of the ingredient Day 3: unsettled.** Timed while a refit ran, so contended, one storm-free Day 3 took 37 s and one with storms 29 s; idle earlier, 8 s against 14 s a day. If the contended figure holds, 4 ingredient runs cost about 90 s more CPU per issue than the 2 storm runs did. To time again idle; the fallback is 2 ingredient runs.

**Refit from the archive (sixth of the day, about 5 s).** `scripts/refit-from-archive.mjs
data/outlook-archive/fit-2026-10-24 --check data/outlook-archive/check-2026-10-24 --install`.

| Check set (seeds 21-30 x 3) | Right / within one, before | After |
|---|---|---|
| Day 1 | 53% / 90% | 60% / 90% |
| Day 2 | 65% / 80% | 65% / 80% |
| Day 3 | 60% / 90% | 60% / 90% |

Installed groups:

| | Day 1 | Day 2 |
|---|---|---|
| Tornado | [0.625, 0.625, 0.75] (CIG1 61% at 5 of 8) | never |
| Wind | [0.5, 0.625, 0.75] (CIG1 78% at 4 of 8) | |
| Hail | [0.375, never] | [0.5, 0.75] |

Full suite: 55 of 55 pass.

**Ingredient Day 3, timed idle:** 15 s per run without storms against 18 s with them, so 4 runs cost
58 s against the old 36 s, about 22 s more per Day 3 issue. Re-scored from the archive (60 Day 3
outlooks):

| | Right / within one |
|---|---|
| 4 runs | 53% / 85% |
| 2 runs | 47% / 83% |

Contours with 4 runs: 15, 30, 45 and 60% verified 22, 39, 49 and 72%. Kept at 4 for now.

## Third review round (2026-10-24-c, same weather)

**Means:** synoptic 6.75, mesoscale 5.6, outcome 5.5, outlook 6.75.

**Helped:**
- **Moist adiabat:** seed 1000 day 3 MLCAPE p90 fell 4,813 to 3,371, with storms 285 to 205; seed 2112 day 3 lost its 9:30 am tornado.
- **Drylines** are drawn again beside outflows.
- **Outlook categories** are consistent with the CIG matrix: seed 1000 day 3 went MDT to ENH, the reviewer's own call.
- **Tornadoes** no longer have 0-minute or 0 mi paths.

**Side effects of the moist adiabat** (seed 1000):
- The 2 K threshold acts as a switch: columns at 2.2-2.4 K escape it, and day 3's MLCAPE maps show stripes and blocky steps a large-scale cell wide.
- It cools 850 mb but not the ground, leaving about 11.5-12.5 C/km from the ground to 850 mb; SBCAPE is 1,500-1,800 above MLCAPE.

**Remaining:**
1. **Afternoon moisture.** The daytime mixed layer carries the ground's moisture up through 850 mb (Td 17.5-17.9 C, about 13 g/kg) with no drying by entrainment, so afternoon CAPE is unchanged where 850 mb is not near saturation.
2. **Ordinary storms give no reports** in 2,000-3,000 J/kg (seed 8181 day 3, three builds running; seed 2112 day 1). The runs give none either, so Day 1 stays TSTM where the SPC would draw SLGT.
3. **Tornadoes and hail are weak at the top.** Seed 2112 had 1 EF2 in 22; the largest hail is 2.0-2.75 in where 3-4 in is expected. The top end swings between builds (8181: EF5, EF2, EF1).
4. **Supercells live 6-9 hours** (250-450 mi).
5. **Night:** the 850 mb flow collapses (seed 2112 day 2), and day 2 CAPE builds overnight on seed 1000.
6. **Text:**
   - the wind direction from the map mean, not mid-map;
   - the height change too small (map mean);
   - "weak shear (30 kt)" on a 37-42 kt day;
   - timing windows before storm onset.
7. **Drawing:** fronts around cold pools and in uniform air; tile-edge steps in maps.

**Climate** (40 days, seeds 1-4, after the moist adiabat and the dryline fix):

| Measure | Now | Target |
|---|---|---|
| Tornadoes a day (mean) | 8.6 | 7.5 |
| Tornado days | 78% | 83% |
| Quiet days | 13% | under 10% |
| Days with 30+ tornadoes | 8% | 5% |
| High / Moderate / Enhanced / Slight / below | 10 / 25 / 20 / 25 / 21% | 5 / 20 / 40 / 30 / 5% |
| EF0-EF4 | 60.9 / 30.6 / 6.2 / 1.5 / 0.9 | 52 / 35 / 9 / 2.4 / 0.45 |
| Tornado CIG1+ / 2+ / 3+ | 27 / 10 / 5% | 35 / 12 / 4% |
| Wind CIG1+ | 13% | 30% |
| Hail CIG1+ / 2+ | 36 / 8% | 35 / 10% |

## Batch after the third round (2026-10-25)

**Changes:**
- **Moist adjustment, smooth** (`moistAdjustmentK` [1, 5]): all of it within 1 K of saturation, none from 5 K. Where 850 mb is inside the day's mixed layer, the ground cools with it.
- **Moist layer top** (`moistLayerTopM`) 2100 to 1700 m ASL: a deep afternoon mixed layer now takes in dry air above it.

**Effect:**

| | Before | After |
|---|---|---|
| Seed 2112 day 1 21Z MLCAPE p90 | 3,137 | 1,330 |
| Seed 2112 day 1 850 mb Td p90 | 17.2 C | 12.8 C |
| Seed 1000 day 3 21Z MLCAPE p90 | 3,253 | 2,685 |
| 4 pm MLCIN p50 (humid air) | 16 | 40 |
| New storms per day (40-day probe) | 85 | 69 |
| Supercells per day | 38 | 32 |
| Tornado days | 75% | 69% |

Full suite: 55 of 55 pass.

## Boundaries, squall-line and landspout tornadoes (2026-10-25)

Research: docs/storm-reference/boundaries-qlcs-landspouts-2026-10-25.md.

**A. Boundary zone** (StormEnvironmentCoupling `airMassContrast`, StormRotation `boundary*`):
- The inflow's air-mass density is compared with air within 16-32 km. Contrast is read on the cool side
  (full) and the warm side (half), at 0.6-1.8 K (a drawn front is about 2 K on the grid; the warm sector
  is 0.3-0.4).
- Exposure builds over 0.35 h and fades over 1 h.
- It adds up to 180 to the 0-1 km SRH and takes 150 m off the cloud base.
- Tornadoes starting in a zone went from 4% to 20%.

**B. Rotation without a mesocyclone** (StormRotation `line`, `landspout`; `tornado.source`):
- **Line mesovortices:** line-normal 0-3 km shear of 12-30 kt, the outflow balance and the rear-inflow
  surge.
- **Landspouts:** a young updraught on convergence, a steep 0-3 km lapse rate, deep shear under 25-35 kt.
- **Shares:** lines 16% and landspouts about 2% of tornadoes, against about 18% and 11% in the record.
- **Ratings:** line tornadoes are 96% EF0, against 46% EF0 and 44% EF1 in the record.
  - A higher line peak made more of them, not stronger ones.
  - Adding forward speed to the tornado wind didn't separate lines from supercells (supercell tornadoes
    here move as fast), so it was removed.

**D. Active season** (`jetMs` 10 to 12): tornado days 80% to 75%, so it was not kept.
- 6 of the 7 weak-flow days (500 mb under 30 kt) now have tornadoes, from B.
- The remaining tornado-free days had 37-70 kt aloft.

**40-day climate:**

| Measure | Before | After A + B | Target |
|---|---|---|---|
| Tornado days | 78% | 80% | 83% |
| Quiet days | 13% | 10% | under 10% |
| Tornadoes per day | 8.6 | 10.0 | 7.5 |
| Days with 30+ tornadoes | 8% | 13% | 5% |
| High | 10% | 20% | 5% |
| Moderate | 25% | 13% | 20% |
| Enhanced | 20% | 23% | 40% |
| Slight | 25% | 30% | 30% |
| EF0 / EF1 / EF2 | 61 / 31 / 6.2 | 63 / 29 / 5.3 | 52 / 35 / 9 |

High days are mostly reached by tornadoes alone (7 of 8). Full suite: 55 of 55 pass.

**Follow-up, same day.** Boundary boost fades where the inflow's 0-1 km helicity is already strong
(`boundaryAmbientSrh` [100, 300], Garner 2012). High 20% to 18%, other figures about the same.

The doubling of High days was not from A or B. The same 40 days with A and B switched off gave High 18% and
13% days with 30+ tornadoes, the same as with them. A and B together:

| Measure | A and B off | A and B on |
|---|---|---|
| Tornado days | 70% | 80% |
| Quiet days | 13% | 10% |
| Tornadoes per day | 8.4 | 9.9 |
| High | 18% | 18% |

So High went from 10% to 18% with the moisture batch earlier today (`moistAdjustmentK` [1, 5],
`moistLayerTopM` 1700): stronger caps and fewer, more discrete storms. (An earlier comparison counted one
tornado per storm a day and was wrong.)

**Moist-layer depth and outbreak days (2026-10-25).**

80 days (seeds 1-8):

| Measure | 1700 m | 1900 m |
|---|---|---|
| High days | 18% | 11% |
| Tornado days | 80% | 88% |
| Quiet days | 11% | 6% |
| Tornadoes per day | 10.2 | 11.4 |

Seeds 1-4 alone gave High 18% at 1700 m, 5% at 1900 m and 13% at 2100 m, and seeds 5-8 gave 18% at both,
so 40 days cannot separate them. 1900 m gives back most of the afternoon-moisture fix on the flagged day
(seed 2112 day 1, 21Z 850 mb Td p90 12.8 to 16.1 C, MLCAPE p90 1,330 to 2,315), so 1700 m is kept.

Outbreak days come from the number of supercells, not their efficiency:

| Day type | Supercells a day | Tornadic storms a day | Share tornadic |
|---|---|---|---|
| 30+ tornadoes | 125 | 31 | 25% |
| 10-29 tornadoes | 74 | 16 | 22% |
| 1-9 tornadoes | 20 | 3.7 | 18% |

The real share of tornadic mesocyclones is about 26% (Trapp et al. 2005), and each tornadic storm makes 1-2
tornadoes (at most 4). Next: why the strong days start so many supercells.

**Outbreak days: storm initiation (2026-10-25).**

On two outbreak days (seed 4 day 5, seed 1 day 3) there were 198 and 140 fresh storms, in air with
a median CIN of 3 J/kg at their birth, about 55 km apart:
- by boundaries 116 / 77, by the day's heating alone 51 / 54, by large-scale ascent 30 / 8;
- 59 / 35 of them before noon;
- 30-41 rotating storms at once.

Spreading the storms' warming aloft outward as gravity waves (100 km/h, total kept) changed nothing
(144 fresh storms against 145) and was removed.

**Change: shear-limited initiation** (InitiationEngine `WIDE_LIFT_J_KG`, `SHEAR_LOSS_KT`, `SHEAR_LOSS`; Peters et al. 2019, 2020).
- In strong 0-6 km shear, a narrow updraught is diluted by the air it entrains, and only wide ones grow.
- Width follows the organised lift's Kain-Fritsch energy (10-50 J/kg). Heating alone makes narrow updraughts.
- Narrow ones lose up to 60% of their rate as the shear rises from 30 to 60 kt.
- With 85% over 25-50 kt the outbreak day had 103 storms, but over 40 days tornado days fell to 65% and quiet days rose to 20%.

80 days (seeds 1-8):

| Measure | Before | After | Target |
|---|---|---|---|
| High | 18% | 4% | 5% |
| Moderate | 18% | 29% | 20% |
| Enhanced | 23% | 26% | 40% |
| Slight | 27% | 25% | 30% |
| Tornadoes per day | 10.2 | 7.7 | 7.5 |
| Days with 30+ tornadoes | 12% | 1.5% | 5% |
| Tornado days | 80% | 77.5% | 83% |
| Quiet days | 11% | 9% | under 10% |
| EF0 / EF1 / EF2 / EF3 / EF4 | | 62 / 33 / 3.9 / 1.2 / 0.15 | 52 / 35 / 9 / 2.4 / 0.45 |

Wind CIG1+ is on 0-5% of days. Full suite: 55 of 55 pass.

**Open:**
- Moderate is a bit high and Enhanced low.
- EF2-EF3 tornadoes are too few.
- Wind intensity groups are rare.
- The outlooks need a refit for the changed engine: `outlook-verify --save`, then `refit-from-archive --install --check`.

**Outlook refit for the changed engine (2026-10-25).**
- Archives: data/outlook-archive/fit-2026-10-25 (seeds 1-20 x 5) and check-2026-10-25 (seeds 21-30 x 3).
- Command: `node scripts/refit-from-archive.mjs data/outlook-archive/fit-2026-10-25 --check data/outlook-archive/check-2026-10-25 --install`.
- Tables before the refit: outlookCalibration.js as of the morning.

Forecast right / within one category:

| | Fit set, old tables | Fit set, new tables | Check set, old tables | Check set, new tables |
|---|---|---|---|---|
| Day 1 | 59 / 93% | 59 / 94% | 50 / 93% | 50 / 90% |
| Day 2 | 44 / 90% | 49 / 89% | 30 / 80% | 50 / 80% |
| Day 3 | 37 / 82% | 40 / 80% | 50 / 100% | 60 / 90% |

All days still lean low: Day 1 too low 32%, too high 9%. On the check set Marginal is forecast on 30% of
mornings and verified on 10%, Slight forecast on 20% and verified on 43%.

Intensity groups:
- Day 1 tornado CIG1 now needs 3 of 8 runs.
- Hail CIG1 needs 4 of 8 on Day 1 and 6 of 8 on Day 2.
- Wind and the higher groups had too few areas to fit and keep their values.

**Strong tornadoes and the forecasts' lean (2026-10-25).**

Supercell tornadoes form in realistic environments: STP median 1.5 for EF0-1 and 2.5 for EF2+ (Thompson et al.
2012). Only 9.7% reached EF3 winds, against EF4 winds in about 10-20% of supercell tornadoes on mobile radar.
The strength scale had been fitted when the afternoon air was too unstable, so `rotationScaleMph` went from 50
to 80. Tornadoes per day did not change. 40 days:

| | EF0 | EF1 | EF2 | EF3 | EF4 |
|---|---|---|---|---|---|
| Before | 62% | 33% | 3.9% | 1.2% | 0.15% |
| After | 57% | 33% | 8.0% | 1.0% | 0.7% |
| US record | 52% | 35% | 9% | 2.4% | 0.45% |

Squall-line tornadoes, 15% of all, are still 86% EF0 and 14% EF1.

The forecasts' lean is not the agreement bars. With Slight at 1/8 of the runs, Enhanced 2/8 and Moderate 4/8,
refitted on the same archive, Day 1 scored the same (59% fit set, 50% check set) and Day 2 slightly worse. The
user's bars and the refit tables were restored. The lean is in the chances themselves: with fewer, more
scattered storms the runs disagree on where storms go, so the chance at any place stays below 15% where a Slight
area verifies.

**EF2 and EF3 (2026-10-25, later).**

Median width and path by rating, SPC database 2008-2022:

| | EF0 | EF1 | EF2 | EF3 | EF4 | EF5 |
|---|---|---|---|---|---|---|
| Width (yd) | 50 | 125 | 300 | 600 | 900 | 1,600 |
| Path (mi) | 0.6 | 2.8 | 6.5 | 12.5 | 23 | 37 |

The engine's tornadoes were about half as wide at EF2-EF4 winds (195 / 294 / 459 yd), so their paths showed too
little damage: of 18 tornadoes with EF3 winds none was rated EF3.

Changes:
- Width curve `30 + 0.66 (wind - 65)^1.5`, from `30 + 1.3 (wind - 65)^1.25`.
- EF3 and EF4 indicator densities 0.72 and 0.6 to 0.4 and 0.13 per sq mi. With the two nearly equal, a path showing
  EF3 almost always showed EF4. Fitted offline over all draws on 286 tornadoes: expected 58.4 / 29.8 / 9.0 / 2.25 /
  0.50 / 0.06, US 52 / 35 / 9 / 2.4 / 0.45 / 0.05.
- 40 days: EF2 10.1%, EF3 1.0%, EF4 0.7% (3 and 2 tornadoes). Tornado CIG1+ days 22% to 30%.

**Below-Slight days.** 13 of 80 days:
- **4 are quiet for good reason:** no CAPE, a capped day with no storms, or pulse storms in 11 kt of shear.
- **The other 9 had storms in the weaker air.** Three days profiled: storms drew in 840-1,500 J/kg against about
  2,000 in the warm sector's median, with 700-500 mb lapse rates of 6.2-7.2 C/km, the wet-bulb zero near 2.5 km and
  updraughts of 23-34 m/s. They made hail of 0.3-1.5 in and gusts of 44-61 mph, just short of severe.
- **Two causes:**
  - storms not forming in the best air (on high-shear days the shear limit needs organised lift there);
  - weak mid-level lapse rates (no elevated mixed layer) on those days.

Full suite: 55 of 55 pass.

**Hail-driven Moderate days (2026-10-25, later).**

On 16 of 23 Moderate days hail reached the 60% contour with 2 in hatching, Moderate on hail alone. Those days had
30-100 hail storms and 33-115 supercells, against about 10 and 11 on a median Slight or Enhanced day.

Tried and removed: rear-flank cycling of rotating updraughts (wrap 0.8-0.3 h, recovery 0.25 h, up to 35% of the
inflow).

| 80 days | Before | With cycling |
|---|---|---|
| High | 5% | 7.5% |
| Moderate | 29% | 26% |
| Enhanced | 25% | 20% |
| Slight | 25% | 30% |
| Below Slight | 16% | 16% |
| Hail-only Moderate days | 8 | 8 |
| Quiet days, seeds 1-4 | 10% | 15% |

A gap of 10-20 minutes in a swath is 5-10 mi at storm speeds, small against the 25 mi of the chances, so with
dozens of hail storms the coverage stays at 60%. The excess is the number of hail-producing storms on stormy days.

**Supercell counts on stormy days (2026-10-25, later).**

Two Moderate days traced: seed 7 day 6 had 106 fresh storms (CIN 4 J/kg at birth, a third started by heating
alone in 40-50 kt of shear) and seed 4 day 10 had 85 (CIN 43).

Across 40 days at 3 pm CDT in the moist air (Td 60 F+, CAPE 500+), the elevated mixed layer is there:
- 700-500 mb lapse rate median 8.0 C/km (days p10 6.3, p90 8.4);
- EML share 0.77.

But it does not cap the moist air: MLCIN median 4 J/kg, and only 15% of the moist air has CIN of 50 or more.

Tried as a run setting only: `lidCoolingKPerDay` 1.5 to 0.75.

| 80 days | Now | With 0.75 |
|---|---|---|
| High | 5% | 9% |
| Moderate | 29% | 24% |
| Enhanced | 25% | 27.5% |
| Slight | 25% | 24% |
| Below Slight | 16% | 16% |
| Tornado days | 77.5% | 75% |

Within chance (each share is about +-5 points on 80 days); not kept.

**Why the cap is weak (2026-10-25, later).**

At 3 pm CDT in the moist air, medians of 38 afternoons:

| Measure | Median | Days p10-p90 |
|---|---|---|
| The lid's own 700 mb temperature | 11.0 C | 6.0 to 16.0 |
| The 700 mb temperature | 7.3 C | |
| `capLift` (the cooling of the cap by lift) | 2.3 K | 0.6 to 4.4 |
| MLCIN | 3.8 J/kg | |
| LFC | 1,380 m | |

A surface parcel of 25 C over 18 C reaches 700 mb near 9-10 C: capped by the lid, not by the 700 mb temperature.

Of the 2.3 K, the mesoscale part (`mesoCapLiftShare`, isentropic and low-level-jet lift, added 2026-10-23 so that
night storms could start) is about 1.8 K, and its cooling lasts into the next afternoon (`capLiftHours` 24):

| | MLCIN median | MLCIN p75 | LFC |
|---|---|---|---|
| Now | 4 J/kg | 38 | 1,380 m |
| Mesoscale part off | 8 J/kg | 78 | 2,150 m |
| Large-scale part at ratio 1 | 5 J/kg | 45 | 1,590 m |

80 days (run settings only; not kept):

| Measure | 0.25 (now) | 0.1 | 0 |
|---|---|---|---|
| High | 5% | 11% | 9% |
| Moderate | 29% | 19% | 17.5% |
| Enhanced | 25% | 25% | 22.5% |
| Slight | 25% | 27.5% | 24% |
| Below Slight | 16% | 17.5% | 27.5% |
| Tornado days | 77.5% | 78% | 64% |
| Quiet days | 9% | 12.5% | 17.5% |
| Tornadoes per day | 7.7 | 6.75 | 6.0 |

A stronger cap moves Moderate days both up to High and down, but does not fill Enhanced or lower the below-Slight
days.

**Wind (2026-10-25, later).**

Research notes on downbursts, wind-report climatology and bow echoes are in this session's research summary (Smith
et al. 2013; Edwards et al. 2018; Evans and Doswell 2001; Cohen et al. 2007; Weisman 1993).

Coverage of 45% verifies on 33 of 80 days. What is missing is the significant tier: 5.4% of wind reports reach 75 mph,
and the group needs a fifth of an area's reports there, which only clustered damaging winds (bows, derechos) give.

Tried and removed:
- Downdraught energy plus rain loading (150 J/kg at full rain), with a share of 0.55.
- The rear-inflow jet as its own gust: 5-28 m/s with CAPE and 0-3 km shear, reaching the ground at 0.75 x (jet + line
  speed), in place of a quarter of the 500 mb wind added to every line's gust.
- Rear inflow from the cold pool alone. It had also been multiplied by the rain: median 0.07, now 0.30.

| 80 days | Before | With the changes |
|---|---|---|
| Categories (High / Moderate / Enhanced / Slight / below) | 5 / 29 / 25 / 25 / 16% | 6 / 26 / 26 / 25 / 16% |
| Days with 58 mph | 77% | 84% |
| Days with 75 mph | 29% | 11.5% |
| Wind CIG days | 2.5% | 0% |

The lines cannot drive a bow. Line storms (organisation 0.5+, 1 h+ old, 4,762 samples) have medians of:
- updraught 18 m/s (90th 38);
- speed 14 m/s (90th 21; about 90% of derechos move faster than 18, Cohen et al. 2007);
- cold pool 0.25, rain 0.38;
- gust 45 mph (90th 64).

Only 9% of them are in CAPE 2,000+ with 0-3 km shear of 30 kt or more. Next for wind: why lines stay weak and slow
(their updraughts, cold pools and propagation), the "MCS never forms" item of 2026-10-15.

**Squall lines and MCSs, step 1 (2026-10-25).** Research: docs/storm-reference/squall-lines-mcs-wind-2026-10-25.md.

Line storms' budget (medians, organisation 0.5+, 1 h+ old):
- potential updraught 32 m/s;
- undercut 0.50, so the target was 14.7 m/s (supercells: 49, 0.21 and 38.9);
- the line's cold-pool propagation added about 4 km/h.

Changes:
- **Line undercut** (StormBudgets `lineUndercutShare`): at most 0.5 of the updraught, against 0.95 for a lone storm (RKW).
- **Line motion, Corfidi** (environmentSampling `LINE_PROPAGATION_K`, `CLOUD_LAYER_WEIGHTS`): cloud-layer mean
  (0.4 x 850 + 0.6 x 500 mb) plus k x (that less 850 mb), k 0.3 to 1 as the cold pool goes 0.2 to 0.6. Until then:
  0-6 km mean plus 0.6 x (mean less 850).

Line storms:

| | Before | After |
|---|---|---|
| Updraught, median / 90th | 18 / 38 m/s | 17 / 37 m/s |
| Speed, median / 90th | 13.7 / 21.4 m/s | 13.3 / 26.2 m/s |
| Gust, median / 90th / 99th | 45 / 64 / 77 mph | 43 / 72 / 95 mph |
| Samples with 75+ mph | 2.0% | 7.9% |

80 days (seeds 1-8):

| Measure | Before | After |
|---|---|---|
| High / Moderate / Enhanced / Slight / below | 5 / 29 / 25 / 25 / 16% | 9 / 22.5 / 27.5 / 27.5 / 14% |
| Wind CIG1+ days | 2.5% | 11.5% |
| Tornado days | 77.5% | 80% |
| Tornadoes per day | 7.7 | 7.4 |

- 6 of 7 High days came from tornadoes; one was wind-only (s4d6, 60% wind with CIG3, 114 mph).
- EF mix 63 / 28 / 6.6 / 2.4 / 0.35%.
- Full suite: 55 of 55 pass.

**Open:**
- Line updraughts did not rise: the median line storm's CAPE is 1,350 J/kg, often in air storms have used.
- Line cold pools stay near 0.22, against about 0.6-0.9 (7-11 K) observed.
- How often an MCS forms on the map has not been measured yet.

**Squall lines and MCSs, step 2 (tried and removed, 2026-10-25).**

Line cold pools were fed by the system's rain, the leading rain x (1 + 0.67 x line) for a stratiform share of about
40% (Houze 2004), and deepened with the line's length, up to x1.5 from 25 to 100 km half-length. Line cold pools went
from a median of 0.22 to 0.32 (90th 0.48 to 0.64) and speeds to 15.3 m/s (90th 29).

| 80 days | Step 1 | Step 2, surge 0.85 | 0.7 | 0.55 |
|---|---|---|---|---|
| High | 9% | 11% | 9% | 9% |
| Moderate | 22.5% | 26% | 24% | 21% |
| Enhanced | 27.5% | 27.5% | 20% | 20% |
| Slight | 27.5% | 22.5% | 35% | 35% |
| Below Slight | 14% | 12.5% | 12.5% | 15% |
| Wind CIG1+ days | 11.5% | 25% | 4% | 0% |
| Days with 75 mph | about 39% | 55-68% | 33-40% | 5-15% |
| Tornadoes per day | 7.4 | 6.25 | 6.25 | 6.25 |

At 0.85 the line gusts were 46% at 75 mph or more among severe ones; at 0.55, 16%.

Stronger pools gave too much wind at the old surge share, and none clustered enough for the intensity group once gusts
were scaled back. They also undercut supercells (about a tornado a day fewer). Back to step 1.
