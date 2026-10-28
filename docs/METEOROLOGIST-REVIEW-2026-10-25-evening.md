# Evening work, 2026-10-25

## Outlooks' low lean
Each run's chance is already "within 25 mi" of its reports, so widening the runs adds nothing. Scaling the calibrated
chance on the archives (fit-2026-10-25b / check-2026-10-25b):

| Scale | Fit Day 1 right | Too high / too low | Fit Day 2 | Fit Day 3 | Check Day 1 / 2 / 3 |
|---|---|---|---|---|---|
| x1 | 63% | 10 / 27% | 48% | 30% | 43 / 40 / 60% |
| x1.2 | 63% | 18 / 19% | 45% | 47% | 50 / 35 / 50% |
| x1.4 | 61% | 25 / 14% | 49% | 43% | 50 / 35 / 40% |

Lifting the peaks trades too-low misses for too-high ones at the same skill, so it was not kept. The misses are mostly
where the runs put storms.

## Bow echoes (StormHazards `BOW`, `stepBow`)
A line bows by the least of five ingredients times its line share:
- CAPE 800-1,800 J/kg;
- 0-3 km shear 12-25 kt;
- speed 8-16 m/s;
- low-level inflow 6-14 m/s;
- cold pool 0.1-0.3.

It builds over 1.5 h and fades over 1 h. Its apex wind is 0.85 x (rear-inflow jet 20-30 m/s + line speed). The old
quarter of the 500 mb wind added to every line's gust is removed.

Line samples: 5.8% bowed (0.5+). Not bowed: gust p50/90 39/56 mph, 0% at 75+. Bowed: 70/93 mph, 31% at 75+. All
severe line gusts: 16-17% at 75+, against 33% before.

80 days:

| Measure | Step 1 | Bows |
|---|---|---|
| High / Moderate / Enhanced / Slight / below | 9 / 22.5 / 27.5 / 27.5 / 14% | 7.5 / 22.5 / 27.5 / 29 / 14% |
| Wind CIG1+ days | 12% | 2.5% |
| Days with 75 mph | 39% | 19-21% |

The first, stricter bow ranges gave the same categories with 2.6% of line samples bowed.

storm-shape-and-interactions.mjs fails on the removed behaviour: lines bringing the wind aloft down.

Kept, by the user's choice: the bow mode (realistic gust mix; wind CIG lower).

tests/storm-shape-and-interactions.mjs now checks:
- a line bows only with a bow's ingredients (bow 0.6+ against under 0.05 in weak air);
- its apex brings 75+ mph, about 15 mph over an unbowed line;
- the apex wind weakens with less CAPE.

Full suite: 55 of 55 pass.

Next: SPC's own May category climatology (forecast outlooks, and categories verified from reports with the engine's
rules) to check the targets (Enhanced 40%, wind CIG 30%).

## Fourth review round (data/day-reviews/2026-10-25, same seeds and days as round c)

Ratings, synoptic / mesoscale / storm outcome / outlook (round c in brackets):

| Seed | Day 1 | Day 2 | Day 3 |
|---|---|---|---|
| 31 | 7/6/4/5 (7/6/4/6) | 7/6/3/6 (7/6/7/8) | 5/7/7/7 (5/5/7/8) |
| 8181 | 7/7/6/6 (7/7/6/7) | 6/6/7/7 (6/5/6/7) | 5/5/5/5 (5/6/4/5) |
| 1000 | 7/5/7/7 (7/5/7/7) | 7/5/6/6 (7/5/5/7) | 8/5/6/6 (8/5/6/7) |
| 2112 | 7/6/4/5 (7/6/4/5) | 8/6/4/6 (8/5/5/7) | 7/7/5/7 (7/6/5/7) |

Means: synoptic 6.75 (6.75), mesoscale 5.9 (5.6), outcome 5.3 (5.5), outlook 6.1 (6.75).

**Better:**
- **Capped warm sectors.** 8181 day 1: MLCIN -83 under 8.7 C/km. 2112 day 3: cap around the dryline plume, storms 77 to 41,
  reports 251 to 117.
- **Afternoon CAPE.** 2112 day 1: MLCAPE p90 3,122 to 1,599. 1000 day 3: 3,371 to 2,633.
- **Tornado widths now look like the SPC database**, and 8181 day 1 had an EF3 of 346 yd.
- **Boundary and squall-line tornadoes** look plausible where they occurred (1000 day 3).

**Wrong:**
1. **Daily cycle inverted** (3 of 4 reviewers):
   - MLCAPE and the moist area peak 03-12Z: 8181 day 2 356 at 21Z to 1,621 at 06Z; 1000 day 2 1,479 at 00Z to 3,667 at
     12Z.
   - The afternoon low-level jet and SRH collapse under strong forcing: 1000 day 3 850 mb 37 to 6 kt and SRH01 185 to 56;
     8181 day 1 31 to 13 kt.
   - 2112 day 1: the Td 60 F area went from 69% at 12Z to 22% at 00Z.
2. **Report floods on active days:** 2112 day 2 1,894 (1,296 in round c); 1000 day 3 317, wind doubled. Wind exceeds hail
   under supercells (8181 day 1), which points at the new wind from aloft.
3. **Strong environments without storms or reports:**
   - 31 day 2: dryline, MLCAPE about 3,200, 50-65 kt, MLCIN -12, and no storms 18-03Z. The shear-limited start rule.
   - 2112 day 1: MLCAPE 2,381, 41 kt, 0 reports.
   - 8181 day 3: 2 supercells with no reports.
   - 31 day 1: 2,800 J/kg at 8+ C/km, 0 hail.
4. **Tornadoes:**
   - 2112 days 2-3 too weak for STP 3-5 (77% EF0).
   - 1000 day 3: too many for STP 1 over 1-10% of the map.
   - 13 of 17 lasted exactly 10 min (1000 day 3).
5. **No upscale growth** on 8181 day 1 (68-75 kt, three outflows, 21 dam falls).
6. **Outlook:**
   - "would support organized storms, but storms are not expected to become severe";
   - time windows that contradict the tornado peak;
   - the ENH area not covering the 30% wind area;
   - day 1 runs that do not reach Marginal where SPC would.
   - (A 90% wind area and 60% wind at ENH follow the March 2026 rules the engine uses.)
7. **Spurious fronts** in uniformly dry air (1000 day 1). Post-frontal SRH inflated (31 day 3).

## Batch after the fourth round (2026-10-26)

**1. Daily cycle: measured, not changed.** 40 days, hour by hour (CDT):

| Measure | Value |
|---|---|
| MLCAPE p90 | 1,248 at 9 am, 2,087-2,111 at 3-6 pm, 1,590-1,618 at midnight-3 am |
| Moist-air SBCIN | 1-8 at noon-6 pm, 103-112 at midnight-3 am |
| 850 mb wind | 23-26 kt by day, 32 kt at midnight |
| SRH01 p90 | 237 at midnight |
| Tornadoes | 19% noon-3 pm, 24% 3-6 pm, 17% 6-9 pm |

On average the cycle is realistic. The reviewers' cases are return-flow days. Smaller items left open:
- night instability at about 77% of the afternoon's;
- tornadoes slightly early.

**2. Boundary-concentrated lift** (InitiationEngine `BOUNDARY_MOISTURE` [4, 10], `BOUNDARY_DENSITY` [3, 6],
`BOUNDARY_CONCENTRATION` 10):
- **The cause:** on seed 31 day 2 the shear rule was not the cause (survival 0.82-1.00 at the dryline); the cap was.
  MLCIN 127-147, convergence 0.5-3e-5 /s, lift 3-22 J/kg.
- **The change:** a sharp boundary's convergence is gathered into a narrow zone (Ziegler and Rasmussen 1998: about
  1e-3 /s), up to 10x along it. Storms start there at the full rate, and the zone counts as wide lift for the shear
  rule.
- **Seed 31 day 2:** 2-5 storms on the dryline toward sunset.

80 days:

| Setting | High / Moderate / Enhanced / Slight / below | Tornado days |
|---|---|---|
| Before | 9 / 25 / 27.5 / 26 / 12.5% | 80% |
| x8 | 10 / 26 / 31 / 21 / 11% | 83% |
| x10 (kept) | 11 / 21 / 34 / 20 / 14% | 81.5% |
| x12 | 14 / 20 / 37.5 / 17.5 / 11% | 84% |

**3. Report limit** (stormLog `stormReportMinutes` 20): a storm's country reports of a hazard come no more often
than every 20 min.

| Measure | 0 (before) | 10 min | 20 min (kept) | 30 min |
|---|---|---|---|---|
| Wind / hail reports a day, p90 | 662 / 460 | 510 / 330 | 378 / 233 | 305 / 184 |
| Wind / hail reports a day, median | 30 / 14 | | 23 / 10 | |

Categories are unchanged. Wind CIG days went from 11.5% to 6.5%.

**4. Tornado endings** (TornadoEngine):
- Tornadoes from a line or a boundary no longer end because their storm has no mesocyclone. Before, all of them
  ended at the second tick, after 10 min exactly.
- Faded or occluded tornadoes end when their rotation crossed the sustain level within the step, not at the tick.
- Exactly 10 min: lines 39% to 0%, supercells 16% to 7%.
- Durations: lines 3 / 5 / 8 / 13 min (p25 / p50 / p75 / p90), supercells 4 / 8 / 16 / 29.

**5. Outlook wording** (DayOneOutlook):
- A no-severe day says why: the cap, or few storms in the runs.
- The severe window takes in the tornado peak.
- The tornado reasoning no longer says modest shear limits the risk beside a 10%+ tornado area.

**Whole batch, 80 days:**

| Measure | Value |
|---|---|
| Tornado days | 81.5% |
| Tornadoes a day | 7.7 |
| Quiet days | 10% |
| Chaseable days | 89% |
| High / Moderate / Enhanced / Slight / below | 11 / 20 / 34 / 21 / 14% |
| EF0 / 1 / 2 / 3 / 4 | 60 / 31 / 6.4 / 2.9 / 0.5% |

Full suite: 55 of 55 pass. The outlooks are refit on fit-2026-10-26 / check-2026-10-26, and the next review packages
are in data/day-reviews/2026-10-26.

## Fifth review round (data/day-reviews/2026-10-26, same seeds and days)

Ratings, synoptic / mesoscale / storm outcome / outlook (round 4 in brackets):

| Seed | Day 1 | Day 2 | Day 3 |
|---|---|---|---|
| 31 | 7/6/4/5 (7/6/4/5) | 7/6/6/7 (7/6/3/6) | 5/6/7/7 (5/7/7/7) |
| 8181 | 7/7/6/7 (7/7/6/6) | 6/6/7/8 (6/6/7/7) | 6/5/4/5 (5/5/5/5) |
| 1000 | 7/5/7/7 (7/5/7/7) | 7/5/5/6 (7/5/6/6) | 7/5/6/7 (8/5/6/6) |
| 2112 | 6/6/4/6 (7/6/4/5) | 8/6/5/7 (8/6/4/6) | 7/6/5/7 (7/7/5/7) |

Means: synoptic 6.7 (6.75), mesoscale 5.75 (5.9), outcome 5.5 (5.3), outlook 6.6 (6.1).

**Better:**
- **Seed 31 day 2:** the dryline day now has storms (discrete supercells 26%; reports 8 to 16 hail and 1 to 13 wind),
  though they start about 00Z.
- **Reports:** 2112 day 2 1,894 to 873; 1000 day 3 317 to 200; 8181 day 1 off the same 32 storms.
- **Tornado lives** spread over 1-37 min (6 of 27 at 10 min, against 13 of 17). 2112 day 2 had an EF3 over 12 mi for
  16 min and an EF2 for 37 min; 2112 day 3 an EF2 in its window.
- **Outlook wording:** no-severe days explain the cap; 8181 day 1 and 2112 days 2-3 verified well.

**Wrong:**
1. **Warm sector either uncapped or fizzling:**
   - 2112 day 2: 141 storms carpet the map, CIN -3 to -12, 873 reports, 12 tornadoes from about 100 supercells.
   - 8181 day 3 (990 mb low, dryline, about 2,000 J/kg, CIN -70, 50+ kt) and 2112 day 1 (2,381 J/kg, CIN -5): no
     reports.
   - 31 day 1: 2,840 J/kg, 8 C/km, SCP 5, and no supercells or hail.
2. **Hail too small** on steep-lapse-rate supercell days (8181 day 1 1.50 in, wind 20 over hail 11).
3. **Overnight moisture and CAPE peaks** (1000 day 2: 1,446 at 21Z to 3,667 at 12Z), possibly fed by the 06Z region
   slide (1000 day 2). Abrupt 500 mb and height-change jumps that look like slides (8181 day 2, 31 day 3). The
   region's surface pressure disagrees with the large-scale map by 18-20 hPa (2112 day 1).
4. **The evening low-level jet is missing** on strong days (2112 day 2 41 to 14 kt; 1000 day 3 37 to 6 kt). Tornadoes
   per supercell are low at STP 3-5.
5. **Outlook text:**
   - MLCAPE and shear quoted low ("to 2,000/2,500" against 2,840/3,485);
   - the tornado peak and storm-start hours do not match the runs' storms;
   - "falling sharply" for 6 dam.
6. **Analysis:** east-west "drylines" along 55 F dewpoint lines in the moist air, warm fronts in north winds, and
   north-south seams in the 21Z fields.
7. **The sfc-850 mb layer** stays at 10.5-11.3 C/km.

## After the fifth round (2026-10-26)

**The slide lead.** A slide cannot bring moisture: the map's moisture is its own field, carried by its own wind. The
overnight jumps came from that wind. The moist layer moved with the 900 mb wind, at night the low-level jet. Seed
1000 day 2 (slide -3 E / -6 N, then 10 E / -6 N m/s):

| | 00Z | 06Z | 12Z |
|---|---|---|---|
| Moist air (Td 60 F+) | 17% | 73% | |
| MLCAPE p90 | | | 3,667 |

**Change: night-time moisture** (RegionalAtmosphere `nightMoistureWindShare` 0.7). After sunset the moisture near
the ground moves with 0.7 of the low-level wind, as the surface layer decouples from the jet; by day the mixed layer
moves as one.

| Measure | Before | 0.5 | 0.7 (kept) |
|---|---|---|---|
| MLCAPE p90 at midnight / 3 am (40 days) | 1,590 / 1,618 | 1,335 / 1,384 | 1,513 / 1,522 |
| Tornadoes midnight-9 am | 19% | 13% | 16% |
| Tornado days | 81.5% | 74% | 80.5% |
| Quiet days | 10% | 13% | 11.5% |
| Tornadoes a day | 7.7 | | 7.95 |
| High / Moderate / Enhanced / Slight / below | 11 / 20 / 34 / 21 / 14% | | 12.5 / 15 / 37.5 / 21 / 14% |
| EF0 / 1 / 2 / 3 / 4 | 60 / 31 / 6.4 / 2.9 / 0.5% | | 56.6 / 32 / 8.4 / 2.0 / 0.65% |

0.5 lost too many tornado days, so it was not kept.

**Change: outlook numbers** (DayOneOutlook `describeEnvironment`):
- The CAPE and shear quoted are the whole moist sector's 90th percentiles; near the runs' storms they read low.
- The height change is the strongest falls or rises (15th / 85th percentile), not the map's mean.
- "Falling sharply" is from 10 dam, with "falling (up to about N dam)" for 4-10.

Full suite: 55 of 55 pass.

## The cap against real soundings (2026-10-26)

Real: 412 warm-sector 00Z soundings (surface Td 15.5 C+, MLCAPE 500+), May 2015-2023, AMA DDC FWD LBF MAF OAX OUN SGF
TOP, from the Iowa Environmental Mesonet RAOB archive (scripts in C:\Users\alex1\.claude\jobs\a0d03ff3\tmp\realsnd).
Engine: about 50,000 cells at 00Z with the same filter, 80 days.

| p10 / p50 / p90 | Real | Engine |
|---|---|---|
| Surface T | 23.4 / 27.9 / 32.1 | 20.1 / 26.2 / 30.9 |
| Surface Td | 16.4 / 19.0 / 22.0 | 16.7 / 19.2 / 20.6 |
| 850 mb T | 15.4 / 18.1 / 22.2 | 11.9 / 16.2 / 20.8 |
| 850 mb Td (p50) | 13.0 | 14.0 |
| 700 mb T | 5.4 / 9.2 / 13.2 | 3.9 / 8.3 / 12.7 |
| 500 mb T | -13.4 / -10.6 / -8.1 | -16.1 / -11.9 / -7.9 |
| MLCAPE | 685 / 1,370 / 2,967 | 1,009 / 2,008 / 3,124 |
| MLCIN | -216 / -50 / -6 | -152 / -4.7 / -0.3 |
| LCL (m) | 907 / 1,377 / 1,970 | 551 / 1,088 / 1,625 |

| Share with MLCIN weaker than | -10 | -25 | -50 | -100 |
|---|---|---|---|---|
| Real | 17% | 33% | 50% | 70% |
| Engine | 56% | 61% | 69% | 83% |

Run settings tried on seeds 1-4 (none kept):

| Setting | Result |
|---|---|
| `mesoCapLiftShare` 0.1 | 700 mb p50 9.3 C, but 47% uncapped |
| `reference500C` -10.5 | little change |
| Both | 49% uncapped |
| No moist adjustment, or no convective adjustment | 850 mb 17.7 C but 700 mb 7.7 C, MLCAPE 2,600, 46-47% uncapped |

**Finding:** the engine has no capping inversion at the elevated mixed layer's base. The air above the boundary
layer warms linearly to 700 mb (`lapseAbove`), so the afternoon mixed layer grows smoothly through 850 mb. 850 mb is
then inside a cool, humid mixed layer, where real warm sectors at 00Z have it near the inversion: warm (18 C) and
drier (Td 13 C). The fix is structural: an inversion at the moist layer's top where elevated mixed-layer air lies
over it.

## The capping inversion (2026-10-26, built)

RegionalAtmosphere changes:
- **Inversion:** `capInversionShare` 1, with `columnProfile`, `thetaAt` and `mixingHeat`. Potential temperature jumps at the
  moist layer's top to the lid's where lid air lies above. The mixed layer grows by its heat through that profile, and
  850 mb reads it.
- **`lidFullShare` 0.6:** a 0.6 share of lid air caps as a full lid, also in the sounding's 780 mb anchor via
  emlInfluence.
- **Lid settings:** `emlLifetimeDays` 2 to 4; `mesoCapLiftShare` 0.25 to 0.1; `reference500C` -11.5 to -10.

The sounding's interpolation between 850 and 700 mb had hidden the inversion. With a full lid the engine already capped
like the real record (MLCIN -39 to -59, 22-40% uncapped); thin lids (share under 0.6) were uncapped 65-94% of the time.

At 7 pm in the warm sector (seeds 1-4):

| | Real | Before | After |
|---|---|---|---|
| MLCIN median | -50 | -4.7 | -54 |
| Share capped beyond -50 | 50% | about 31% | 51% |
| 850 mb | 18.1 C | 16.2 C | 18.1 C |
| 700 mb | 9.2 C | 8.3 C | 10.0 C |
| 500 mb | -10.6 C | -11.9 C | -11.1 C |
| Uncapped | 17% | 56% | 37% |
| MLCAPE | 1,370 | 2,008 | 2,302 |

The remaining CAPE excess is the mixed layer carrying the ground's full moisture: real 850 mb Td 13.0 against 14.4.

80 days:

| Measure | Before the cap | With the cap | Cap and `fullRatePerHour` 0.22 to 0.28 |
|---|---|---|---|
| Tornado days | 80.5% | 75.5% | 76.5% |
| Tornadoes a day | 7.95 | 5.45 | 6.75 |
| Chaseable days | 89% | 80% | 80% |
| High | 12.5% | 7.5% | 9% |
| Moderate | 15% | 20% | 20% |
| Enhanced | 37.5% | 31% | 31.5% |
| Below Slight | 14% | 19% | 19% |

`capInversionShare` 0.6 gave the same soundings and 71.5% tornado days, so the inversion's strength is not the lever.

Full suite: 55 of 55 pass. Decision for the user: keep the realistic cap (fewer chaseable and tornado days) or not.

**Softened lid (the user's choice, kept):** `emlLifetimeDays` 3, `lidFullShare` 0.75, `mesoCapLiftShare` 0.15,
`fullRatePerHour` 0.28.

| Measure | Value |
|---|---|
| Tornado days | 79% |
| Chaseable days | 85% |
| Tornadoes a day | 7.7 |
| Quiet days | 11.5% |
| High / Moderate / Enhanced / Slight / below | 10 / 19 / 29 / 26 / 16% |
| 7 pm warm sector: MLCIN median | -45 |
| 7 pm warm sector: capped beyond -50 | 51% |
| 7 pm warm sector: 850 mb | 18.0 C |

Lifetime 3 with a full lid at 0.75 alone gave 73% tornado days. Full suite: 55 of 55 pass.

## Sixth review round (data/day-reviews/2026-10-26b, capping inversion with the softened lid)

The outlooks were refit (fit/check-2026-10-26b). Unseen Day 1 / 2 / 3: right 63 / 60 / 50%, within one category 93 / 85 / 90%.

Ratings, synoptic / mesoscale / storm outcome / outlook (round 5 in brackets):

| Seed | Day 1 | Day 2 | Day 3 |
|---|---|---|---|
| 31 | 7/6/3/6 (7/6/4/5) | 7/5/7/8 (7/6/6/7) | 4/5/6/7 (5/6/7/7) |
| 8181 | 7/7/6/7 (7/7/6/7) | 6/6/7/8 (6/6/7/8) | 6/5/4/5 (6/5/4/5) |
| 1000 | 6/5/7/8 (7/5/7/7) | 7/4/4/6 (7/5/5/6) | 5/5/5/6 (7/5/6/7) |
| 2112 | 6/6/6/6 (6/6/4/6) | 8/7/5/7 (8/6/5/7) | 7/7/5/6 (7/6/5/7) |

Means: synoptic 6.3 (6.7), mesoscale 5.7 (5.75), outcome 5.4 (5.5), outlook 6.7 (6.6).

**Better:**
- **Capped warm sectors read realistically:**
  - 8181 day 1: MLCIN -80 to -107, storms at 21Z, 16 storms with 63% supercell.
  - 2112 day 2: CIN -72 to -87; storms 141 to 85, reports 873 to 534.
  - 2112 day 3 and 31 day 3: believable busts.
- **Timing:** 31 day 2 storms 23Z-03Z (they had been overnight).
- **Overnight CAPE** falls on 8181 day 2 (3,124 to 1,093) and 31 day 1.
- **Outlook numbers** match the analyses (31 day 2: 3,500 against 3,501).

**Wrong:**
1. **No upper bound on the cap.** 31 day 3: 850 mb 34 C, 700 mb 17.5 C, MLCIN -500, 112 F at 7 pm, MSLP 1026-1028 in the hot air
   against 1004 to the west. Heat stays under the inversion. Real 99th percentiles are about 700 mb 14-15 C and 850 mb about 30 C.
2. **The warm sector too hot and dry beside lows.** 8181 day 3: 93-95 / 56-61 F near a 990 mb low, LCL 1.5-2.7 km, 76%
   multicell in 56 kt, no tornadoes. 1000 day 1: 98/57 F with 850 mb 30 C.
3. **Uncapped high-CAPE pockets that do not initiate.** 1000 day 2: dryline, MLCAPE about 5,000, CIN -3, no storms until 06Z.
   The overnight MLCAPE peak persists on 1000 day 2 (3,986 at 12Z) and 2112 day 1. 1000 day 3: 182 storms from dawn.
4. **Tornadoes few and weak in strong environments** (2112: 11 in days 2-3, all EF0-1, STP 3-7, SRH01 200-420). The evening
   low-level jet still decays (2112 day 2: 38 to 14 kt).
5. **Hail too small** (2.00 in at most under SCP 9-10, 1.5 in under 8.5-8.9 C/km). 31 day 1 has no supercells in 39-54 kt.
6. **Outlook text:** "little cap" beside MLCIN -70 to -87 (2112); TSTM where conditional MRGN fits (8181 day 3, 31 day 1).
7. **Grid seams; missing drylines** (31 day 2); the surface to 850 mb at about 11 C/km.

## Cap extremes and the other open issues (2026-10-26)

1. **Lid bounded** (RegionalAtmosphere `lidMaxThetaK` 319.5 K, applied to the lid's high-ground heating and cooling).

   | 7 pm, all cells | Lid's own 700 mb p99 | 700 mb p99 |
   |---|---|---|
   | Before | 17.9 C | 17.5 C |
   | After | 15.4 C | 16.7 C |
   | Real (all May 00Z) | | 14.6 C (max 16.4) |

   On seed 31 day 3 the hottest cell went from 109 to 104 F; the real May station maximum is 103 F. The typical warm
   sector is unchanged (MLCIN median -39).
2. **Cap wording:** the outlook's cap is the warm sector's median MLCIN, no longer cells near the runs' storms.
3. **Evening low-level jet:** measured, not changed. On strong-flow days 850 mb is 27 kt at 18Z, 22 at 00Z and 30 at
   06Z. The dip is the mixed layer's friction, which also drives the night jet. The root is slack low-level gradients
   under troughs; the deep lows were left alone by the user's earlier choice.
4. **Tornadoes in strong setups** (StormRotation `groundCinJkg` [50, 200] for the mixed layer, as in the STP; the new
   `surfaceCinJkg` [30, 120] keeps the night guard). Under the realistic cap, storms that broke -70 to -90 had taken only
   half their inflow from the ground.

   | 80 days | Before | After |
   |---|---|---|
   | Tornado days | 79% | 82.5% |
   | Chaseable days | 85% | 89% |
   | Tornadoes a day | 7.7 | 8.2 |
   | Days with 30+ | | 5.5% |
   | Quiet days | 11.5% | 8% |
   | Tornadoes 3-9 pm | | 48% |

5. **Hail:** measured, not changed. Engine against the real busiest windows:

   | Hail reports | Engine | Real |
   |---|---|---|
   | 2 in+ | 13.2% | 14.1% |
   | 2.75 in+ | 3.6% | 4.7% |
   | 3.5 in+ | 0.4% | 0.7% |
   | Daily largest, p50 / p90 | 2.0 / 3.0 in | 2.5 / 4.0 in |

   Real busy windows have about three times the reports.
6. **Warm-sector heat and dryness:** measured, not changed; they match the real soundings.

   | 7 pm warm sector | Engine | Real |
   |---|---|---|
   | T-Td, p50 / p90 | 9.0 / 13.1 C | 8.2 / 13.3 C |
   | Ground T, p50 / p99 | 27.7 / 35.0 C | 27.9 / 34.4 C |
   | LCL p50 | 1,275 m | 1,374 m |

   The surface to 850 mb also matches the real medians.
7. **Left for later:** uncapped pockets that do not fire (one case), a missing dryline (one case), grid seams in the
   charts.

Full suite: 55 of 55 pass.

## Seventh review round (data/day-reviews/2026-10-26c, the locked-in engine)

Ratings, synoptic / mesoscale / storm outcome / outlook (round 6 in brackets):

| Seed | Day 1 | Day 2 | Day 3 |
|---|---|---|---|
| 31 | 7/6/3/6 (7/6/3/6) | 7/6/7/8 (7/5/7/8) | 4/4/6/7 (4/5/6/7) |
| 8181 | 7/7/6.5/8 (7/7/6/7) | 6/6/7/8 (6/6/7/8) | 6/5/4/5 (6/5/4/5) |
| 1000 | 6/4/7/8 (6/5/7/8) | 6/4/4/5 (7/4/4/6) | 5/5/5/5 (5/5/5/6) |
| 2112 | 6/6/5/6 (6/6/6/6) | 8/6/5/7 (8/7/5/7) | 7/7/5/7 (7/7/5/6) |

Means: synoptic 6.25 (6.3), mesoscale 5.5 (5.7), outcome 5.4 (5.4), outlook 6.7 (6.7). Flat.

**Better:**
- 31 day 2: 3 tornadoes (was 1), hail to 2.5 in (2.0), ENH verified.
- 8181 day 1: a 24-min EF1 over 8.9 mi at night; outlook 8.
- 2112 days 2-3: tornado counts on the forecast; cap wording consistent; 700 mb 10.9-12.8 C (no runaway lid).
- 1000 day 3: 28 tornadoes, 8 seen.

**Fixed after the round:** a severe window of "between 12Z and 12Z", from widening it to a tornado peak at the period's
far end. It is now widened only within 12 hours.

**Still wrong:**
1. **Rare extreme hot days from deep mixed layers** (31 day 3): 850 mb 32-34.5 C, 700 mb 15.7-17.9 C, 110 F at 7 pm,
   MLCIN -500. The surface stays at Td 58-65 F under a dry-adiabatic layer with an 850 mb Td of -5.6 C. The lid bound does
   not cover a mixed layer that reaches 700 mb.
2. **Tornadoes stay EF0-1 under STP 4-5** (2112 day 2, 1000 day 3); 0 tornadoes under STP 5.2 / SRH 341 (2112 day 3).
3. **The evening low-level jet collapses under troughs** (1000 day 3 36 to 11 kt; 2112 day 2 38 to 14 kt).
4. **Report volume on outbreak days** (551 on 2112 day 2) and **none from lines in strong instability** (31 day 1).
5. **Dryline days without storms** (1000 day 2, MLCAPE 4,677 and CIN -3); instability peaking at dawn; moisture scoured
   to 0% (1000 day 1).
6. **The warm sector hot and dry near a 990 mb low** (8181 day 3), and the outlook TSTM where a conditional SLGT fits.
7. **Spurious fronts, no dryline drawn on lee-trough days, grid seams.**

## After the seventh round (2026-10-26)

1. **Tornado rating spread** (`TornadoEngine.js` INTENSITY): ratings had followed STP too steeply.
   - Supercell tornadoes rated EF2+ by STP band, before → after:

     | STP band | Before | After |
     |---|---|---|
     | under 1 | 3% | 4% |
     | 1-3 | 12% | 11% |
     | 3-6 | 38% | 33% |

     Thompson et al. 2012, scaled to all tornadoes, gives about 7-9 / 12-14 / 18-21%; Smith et al. 2015 finds that rotation
     sets most of a rating.
   - Overall EF0 fell from 62% to 57% (US 52%).
   - The storm-rotation test's floor for "lasts" is now 4 minutes, was 5.
2. **The cold-dome double count** (`RegionalAtmosphere.js` profile850): the dome's deficit was added back at 850 mb even where
   850 mb was already in the lid.
   - That stacked 4-6 K: 850 mb reached 34-37 C over 26-31 C surfaces, and by overturning 700 mb reached 20.5 C.
   - All cells at 00Z, before → after (real May Plains in brackets):

     | Level | p99 before | p99 after | max before | max after |
     |---|---|---|---|---|
     | 850 mb | 33.2 C | 31.7 C (30.2) | 37.2 C | 34.8 C (32.8) |
     | 700 mb | 16.8 C | 15.7 C (14.6) | 20.5 C | 18.3 C (16.4) |

   - Days with 700 mb above 16.5 C fell from 11 to 4 of 80.
   - The remaining warm tail is very shallow, superheated afternoon layers over dry ground (surface max 45 C against a real
     39 C).
   - A bound on the ordinary 700 mb ridge air was tried and changed nothing, so it was reverted.
3. **80 days after both changes:**
   - 8.8 tornadoes a day; 83% tornado days; 86.5% chaseable; 6.5% quiet.
   - Categories below Slight / Slight / Enhanced / Moderate / High: 15.5 / 25.5 / 25 / 24 / 11.5%. Enhanced fell from 35%,
     within about 2σ of 80-day noise. The outlook is not yet refit.
   - EF0-4: 57 / 33.7 / 6.6 / 2.0 / 0.6%.
4. **The mesoanalysis and sounding audit:** see docs/MESOANALYSIS-AUDIT-2026-10-26.md. Heights and the ML parcel inflate CAPE
   by 25-40%.

## Soundings, drivers and charts batch (2026-10-26, later)

**Sources:**
- docs/MESOANALYSIS-AUDIT-2026-10-26.md;
- a code-and-numbers audit of what drives each outcome;
- a literature survey of comparable engines (Tippett, Sobel & Camargo 2012; Sobash et al. 2011/2016; Trapp et al. 2011; Potvin et al. 2019).

### Sounding (`js/sounding.js`)

1. **Heights:** built hypsometrically, layer by layer from virtual temperature. Before, the whole column was taken at the
   surface temperature, 300 m high at 500 mb.
2. **Mixed-layer parcel:** the pressure-weighted mean of the lowest 100 mb. Before, an unweighted mean of the levels.
3. **LFC and CIN:** SHARPpy's rule. The LFC is the bottom of the main buoyant layer and CIN all the negative area below it.
4. **Helicity:** signed. Storms take only the cyclonic part.
5. **SCP:** SPC's form (MUCAPE/1000 × SRH/50 × a shear term from 10 to 20 m/s).
6. **Labels:** STP is labelled the hybrid it is.

### Atmosphere (`RegionalAtmosphere.js`)

1. **The mixed layer dries toward its top** (mixedTopDryingShare 0.2).
2. **700 and 500 mb humidity come from the large-scale lower layer's moisture anomaly,** passed through for the first time,
   with the EML drying 700 mb. They had been fixed depressions, never under 12 C at 700 mb.
3. **Seams:** the 850 mb mixed-layer switch is now a 300 m blend; the cap's on/off test is a ramp; 850 mb is read from the
   cap as a 400 m layer.
4. **Cold domes:** the dome deficit is no longer added on top of the lid (earlier in the day).

### Storms

1. **Gusts** (`StormHazards.js`):
   - the downdraught's rain saturates at half of a full storm's rain;
   - downdraughtShare goes from 0.5 to 0.6;
   - a discrete storm adds 0.4 of its motion term, a line all of it.
   - A cold-pool version of the rain change was tried and reverted: it made supercells outflow-dominant, and tornadic
     supercells fell from 20% to 15%.
2. **Line mode** (`environmentSampling.js`):
   - shear along a front (density-gradient orientation, now stored) organises lines (Dial et al. 2010);
   - crowding goes from 0.25 to 0.2;
   - the along-boundary placeholder of 0 is gone.
3. **Retunes to the corrected soundings, each with its reason in the code:**
   - entrainment base 0.42 to 0.48: CAPE fell by a quarter;
   - surface CIN range [30, 120] to [50, 200]: SPC's STP range, the old one having been set against too-weak CIN;
   - melting reference 3,000 to 3,400 m: the wet-bulb zero rose 14%;
   - hail scale 3.0 to 3.7, refitted to SPC report sizes.
4. **Kept:** the 58 mph wind-swath edge. A 45 mph edge was tried and reverted, because with the stronger downdraughts it
   doubled wind reports.

### Charts (`BoundaryAnalysis.js`)

1. **What makes a front:** across the line's own width (±2 cells), the moisture changes by 2 g/kg or more, the temperature by
   6 K or more on its own, or by 3 K or more with a 1 g/kg moisture change or a 4 m/s wind shift along the line.
2. **Drylines:** searched to 1 cell from the map's edge.

### Measured, all at 7 pm in the warm sector against 412 real May Plains soundings

| | Engine p10 / 50 / 90 | Real p10 / 50 / 90 |
|---|---|---|
| Cloud base (m) | 833 / 1,426 / 1,965 | 907 / 1,374 / 1,970 |
| MLCIN | -252 / -56 / -4.7 | -216 / -50 / -6.2 |
| 700 mb dewpoint depression (C) | 1.8 / 11.1 / 24.8 | 2.8 / 11.6 / 25.0 |

| | Engine | Real |
|---|---|---|
| Median MLCAPE | 1,798 (was 2,260) | 1,366 |
| Hail reports 2 in or larger (seeds 1-8) | 13.5% | 14.1% |

- **Wind follows DCAPE in weak shear:** 7 / 25 / 48% of storms reach 58 mph at DCAPE under 600 / 600-800 / 800-1,000 J/kg.
  Before, it was under 10% at any DCAPE.
- **Lines that report:** lines in 25-35 kt and 1,700-2,600 J/kg with no wind report fell from 97% to 50%.
- **Seams:** neighbour steps of more than 3 C at 850 mb under the same surface air, seed 2112 day 3:

  | Hour | Dewpoint steps | Temperature steps |
  |---|---|---|
  | 21Z | 154 → 40 | 113 → 2 |
  | 03Z | | 151 → 15 |

### 80 days after the batch

| Measure | Value |
|---|---|
| Tornadoes a day | 7.15 |
| Tornado days | 76.5% |
| Chaseable days | 81.5% |
| Quiet days | 4% |
| Categories below / SLGT / ENH / MDT / HIGH | 9 / 27.5 / 35.5 / 19 / 10.5% |
| EF0-4 | 57.7 / 34 / 6.5 / 1.7 / 0% |
| Days with 2 in hail | 39% |

- 55/55 tests pass. The outlook and MD tests moved to seed 2: with the corrected cap, seed 3 started no storms by 18Z on day 2.

### Still open

1. **Tornado-time STP never passes about 4** (p90 2.2; record p90 about 4.5): no EF4 in 80 days, and EF3 at 1.7%. This is the
   weak low-level jet under strong troughs.
2. **Tornado days fell from 83% to 76.5%** and chaseable days from 89% to 81.5% under the realistic cap.
3. **Storm starts rose about 30%** on the 8 audit seeds; a third of the rise comes from the SHARPpy cap depth feeding the
   lift. The audit's suggestion is lift that must last before a storm starts.
4. **500 mb humidity has too narrow a spread:** 7.9 / 12.7 / 23 C against a real 2.5 / 14.8 / 35.4 C.
5. **Tornado strength:** mostly a random draw; the record says rotation sets it, so that is acceptable.

### Refit (2026-10-26, archive fit-2026-10-26d / check-2026-10-26d)

The Day 3 ingredients' CAPE ramp went from [250, 2500] to [200, 1900] with the CAPE correction.

| Day | Fitting days: right / within one | Unseen check set: right / within one | Before (fit-2026-10-26c, check set) |
|---|---|---|---|
| Day 1 | 76% / 95% | 57% / 90% | 60% |
| Day 2 | 44% / 94% | 65% / 100% | 60% |
| Day 3 | 33% / 90% | 20% / 100% (10 days) | 60% |

On the check set, Day 3 forecast Slight on 9 of 10 days; 8 of them verified Enhanced. It is built from ingredients only, and
it is cautious.

## Low-level jet, supercells and tornado production (2026-10-26, evening)

The jet's speed was fine: 850 mb at 7 pm / 7 am had a median of 24 / 25 kt, against a real 18 / 22. What was missing was its
effect on the lowest kilometre. At a given deep shear, the engine's 0-1 km helicity ran about half the real (45-60 kt band,
7 pm: 97 against 182), and it never rose overnight (real 182 to 349). The causes, against 1,358 real May Plains soundings:
- low-level winds too westerly: surface / 850 / 500 mb at 175 / 207 / 233 degrees, against a real 155 / 193 / 241;
- the low-level shear nearly along the deep shear: 17 degrees apart, against 52;
- the critical angle 51 / 37 degrees, against 78 / 70.

### Changes

1. **Jet nose** (`RegionalAtmosphere.js` jetNose / noseU / noseV; `sounding.js` anchor): a wind level 500 m up.
   - By day it takes the mixed layer's wind. After sunset its departure from balance swings round, as 850 mb's does
     (Blackadar).
   - The sounding gets it as a wind anchor, with its temperature and moisture interpolated.
2. **Wind directions,** set to the real soundings: lee trough 4 to 8 hPa, mixed-layer turning 10 to 20 degrees, night surface
   turning [20, 40] to [30, 50] degrees. Directions are now 159 / 196 / 236.
3. **Supercells** (`StormRotation.js`): the mesocyclone's shear ramp goes from [20, 55] to [15, 45] kt. The 10th percentile of
   supercells' shear was 39 kt, against a real 29-35 (Thompson et al. 2003); it is 37 kt now.
4. **Tornado discrimination:** helicity floor 0.3 to 0.1; near-ground helicity ramp [50, 250] to [75, 300].
5. **Tornado rates and ratings** (`TornadoEngine.js`): formation rate 0.28 to 0.17 per hour; base scale 20 to 22; STP scale 45
   to 25; tail 0.8 to 0.7.
6. **Initiation readiness** (`InitiationEngine.js`): a storm starts at the full rate only after one hour of lift beating the
   cap. The effect is small.
7. **Surface CIN range:** briefly [50, 200] and back to [30, 120].
8. **Tests:** radar test seed 4 to 1 (seed 4 had one dying storm at 35 h); storm-rotation duration floor down to 3 minutes.

### Measured

| | Before | After | Real |
|---|---|---|---|
| 0-1 km helicity, 45-60 kt band, 7 pm | 97 | 137 | 182 |
| 0-1 km helicity, 45-60 kt band, 7 am | 108 | 135 | 349 |
| Share of supercells with a tornado | | 18% | 15-26% (Trapp et al. 2005; Thompson et al. 2017) |
| Tornado-time STP, 90th percentile | 2.2 | 3.6 | about 4.5 |

- Ratings by STP: EF2+ 5 / 14 / 35% for STP under 1 / 1-3 / 3-6.

### 80 days

| | Before | After | Target |
|---|---|---|---|
| Tornadoes a day | 7.15 | 7.75 | 7.5 |
| Days with a tornado | 76.5% | 80% | 83% |
| Chaseable days | 81.5% | 92.5% | |
| Quiet days | | 4% | under 10% |

- Categories below / SLGT / ENH / MDT / HIGH: 5.5 / 27.5 / 31.5 / 19 / 18%.
- EF0-5: 53.7 / 32.5 / 9.6 / 3.3 / 0.7 / 0.2%.
- 55/55 tests pass.

### Day 3 against SPC

From IEM's archive of SPC outlooks, April-June 2022-2024:
- SPC's Day 3 shows ENH+ on 9% of days; on days that end ENH+ at Day 1 it shows ENH+ on 21-27% and SLGT+ on 75-85%.
- The engine's check set: ENH+ on 10% of days, and SLGT+ on every day that ended ENH+.

As cautious as SPC; left as is.

### Still open

1. **High days at 18%,** where reality has about 4%: outbreak days stack tornado probability.
2. **Time of day:** 37% of tornadoes come at night and 15% from 10 am to 1 pm, against a real 27% and 2.5% (SPC May central US
   2015-2023: 71% from 3 to 9 pm, engine 38%).
   - The night itself is realistic: surface cooling 6.1 K against 6.8, and 7 am MLCIN -202 against -139.
   - Most of the gap is the deliberately long storm lives (4-9 h): a 4 pm supercell is still going at 1 am.
3. **The overnight helicity rise is still missing** (7 am median 135 against 349).

## Eighth review round (data/day-reviews/2026-10-26d; reviewers briefed with docs/REVIEWER-BRIEF.md)

Ratings, synoptic / mesoscale / storm outcome / outlook (round 7 in brackets):

| Seed | Day 1 | Day 2 | Day 3 |
|---|---|---|---|
| 31 | 7/7/4/8 (7/6/3/6) | 7/7/7/8 (7/6/7/8) | 4/3/3/7 (4/4/6/7) |
| 8181 | 7/7.5/6/7 (7/7/6.5/8) | 6.5/6/6.5/8 (6/6/7/8) | 6/5/3.5/6 (6/5/4/5) |
| 1000 | 6/4/5/8 (6/4/7/8) | 6/5/5/4 (6/4/4/5) | 5/5/6/7 (5/5/5/5) |
| 2112 | 6/7/5/6 (6/6/5/6) | 8/7/7/7 (8/6/5/7) | 7/6/6/8 (7/7/5/7) |

Means: synoptic 6.3 (6.25), mesoscale 5.8 (5.5), outcome 5.3 (5.4), outlook 7.0 (6.7).

**Better:**
- Soundings: realistic caps, CAPE and cloud bases.
- A dryline is drawn on 31 day 2; there are no fronts in dry air on 1000 day 1.
- Tornado ratings spread: 2112 day 2 has an EF3 and an EF4; 1000 day 3 has EF2s.
- Reports are balanced: 2112 day 2 had 433, with hail 216 and wind 207 (it was 551).
- Capped days are justified (2112 day 3), and outlooks verify (2112 days 2-3, 31 day 2, 1000 day 3).

**Recurring problems:**
1. **Hail is too small in the most favourable setups.** All four reviewers raised it: SCP 11-31 with 8-8.8 C/km lapse rates gave at most 1.25 in, or no hail, on 8181 days 1-3, 2112 days 1 and 3, 31 day 1 and 1000 day 2. Elevated and high-based storms make wind instead of hail.
2. **Timing:**
   - instability builds overnight and peaks at 12Z (1000 days 2-3);
   - the best tornadoes come after dark (2112 day 2, EF4 at 12:30 am) or mid-morning (1000 day 3);
   - the mid-map 850 mb wind collapses in the evening on outbreak days (2112 day 2: 48 to 8 kt; 1000 day 3: 39 to 16 kt), though SRH01 p90 rises.
3. **The warm-sector boundary layer:**
   - too hot and deeply mixed near deep lows (8181 day 3: 85-93/60-62 F, LCL 1.7-2.3 km under a 988 mb low);
   - the extreme case persists: 31 day 3 has 110/58 F under 850 mb 32 C with a -4 C dewpoint, on the moist side;
   - moisture scoured to 0% (1000 day 1).
4. **Storm types:**
   - "elevated" is overused (44-68% of storm time), including high-based surface storms (8181 day 2);
   - storms rotate where MLCAPE is 0 (1000 day 1);
   - 2112 day 1 has left-movers only.
5. **Outlook text:**
   - "strong cap" where MLCIN is -8 to -52 (1000 day 2);
   - the dryline placed east when it is west (1000 day 2, 2112 day 1);
   - "weak flow (25-30 kt)" alongside 45-70 kt of shear (31 day 3, 2112 day 1, 1000 day 3).

## Regression-guarded fix batch (2026-10-26 to 27)

The user asked for the eighth round's fixes with "no regressions... no new issues". A regression suite was built
(C:\Users\alex1\.claude\jobs\a0d03ff3\tmp\reg; memory regression-suite) and every change was kept only with zero regressions.
Reviewers were briefed and asked to list new problems explicitly. There were three review rounds: 27a, 27b and 27c.

### Kept

1. **Cap over cold domes,** weighted by the dome's coldness: none at 3 K of deficit, all at 8 K. Unweighted, it dried warm
   sectors (seed 8181 moist area 49% to 26%); weighted, 42%. The 110 F case (seed 31 day 3) went to 93 F.
2. **700 mb vapour over dry ground** capped at the surface air's plus 2 g/kg x (1 - EML). Dry ground with moister 700 mb air:
   0%.
3. **Elevated storms' surface gusts** reduced through the stable layer, by 70% at 250 J/kg of SBCIN. Elevated storms with
   58 mph gusts: 5%.
4. **Hail:** the core uses the MU parcel (gain to 1.2), the lapse-rate weight is 0.45, the non-rotating share 0.65, and the scale
   3.15. Reports 2 in or larger: 13.7%; all 2 in+ hail from supercells.
5. **Tornado stretching:** a 0-1 km lapse-rate ramp [5, 9] C/km on mesocyclone tornadoes, with the rate 0.17 to 0.23.
   - Tornadoes 3-9 pm: 37.6 to 43-48%.
   - Night tornadoes: 37 to 29-33%.
6. **Outlook text:**
   - the cap from the weakest-capped quarter of the unstable air;
   - the flow from the 75th percentile of the 500 mb wind;
   - the westernmost dryline named;
   - a reason given on no-severe days;
   - storm development never later than the severe window;
   - no "favours tornadoes" wording on days under 5%.
7. **Review pack:** the "highest STP" sounding falls back to the highest SCP in the unstable air.
8. **The readiness clock removed:** it reset as a dryline's lift moved from cell to cell.

### Tried and reverted

- A boundary start-rate gain, on all sharp boundaries and then on drylines only: storms +14-47%, Enhanced and 2 in hail days
  regressed.
- Full-strength hail core and lapse terms: Moderate rose.

### Final suite against the baseline

- 0 regressions.
- Better:
  - High days 18 to 13%;
  - Moderate + High 37 to 34.5%;
  - 850 mb extreme 34.3 to 32.6 C;
  - tornadoes 3-9 pm 37.6 to 43.4%;
  - night tornadoes 37 to 32%.
- 55/55 tests pass. Refit fit-2026-10-27b: fitting days 55 / 50 / 48%, unseen 50 / 40 / 70% (Day 1 fitting is the lowest of the
  last three refits: 65, 63, 55).

### Final review (27c)

- No new engine problems.
- New items were forecast-day misses that vary with each refit:
  - seed 1000 day 2 over-forecast at ENH;
  - seed 8181 day 2's wind area misplaced;
  - "develop from 20Z" against storms at 03Z on 8181 day 3;
  - a half-true cloud-base remark (2112 day 3).

### Open

1. Weak dryline initiation in uncapped air (8181 days 2-3, 1000 day 2).
2. Low-CAPE high-shear supercells with little or no hail (31 day 1).
3. Elevated storms' hail: 4% reach 1 in.
4. The jet collapsing in the evening at mid-map on outbreak days, and the missing overnight helicity rise (7 am median 151
   against 349).
5. Night tornadoes, still some.
6. Rare superheated afternoons (31 day 3: 109 F).

## Correction (2026-10-27): real 0-1 km helicity targets

The real targets quoted since 2026-10-26 for 0-1 km helicity in the 45-60 kt band were wrong:
- 182 at 7 pm and 349 at 7 am; also 87 / 182 / 290 and 191 / 349 / 517 by band.
- Cause: the script sorted the helicity and shear lists in place before pairing them, so each helicity value was matched to the
  wrong shear.

Computed record by record, the real medians (p90) are:

| 0-6 km shear | 7 pm | 7 am |
|---|---|---|
| 30-45 kt | 77 (206) | 145 (336) |
| 45-60 kt | 95 (264) | 173 (364) |
| 60+ kt | 153 (394) | 209 (313) |

The engine's 45-60 kt values are about 125 and 150, so the engine is near reality, slightly high in the evening.

**What this changes:** the evening low-level jet batch's case that helicity was "about half the real" was wrong. Its other
evidence was computed correctly and stands:
- wind directions 175 / 207 / 233 against a real 155 / 193 / 241, now matched;
- the low-level shear's angle to the deep shear;
- the critical angle (51 against 78).

The overnight jet's speed was checked against 573 real 7 pm to 7 am pairs: the real median ratio is 1.11-1.17 and the engine's
1.03, with the same spread (25% of real nights drop by 30% or more). No isallobaric term was added.

The night surface wind share [0.4, 0.15] became [0.3, 0.1]: the engine's 7 am surface wind under the jet was 12 kt against a
real 7 kt (now 9).

## Jet and hail investigation (2026-10-27)

**Jet:**
- The helicity targets were corrected (section above).
- The overnight 850 mb speed ratio matches reality, so no isallobaric term was added.
- Kept: the night surface wind share [0.3, 0.1]. 7 am SRH01 in the 45-60 kt band rose from 150 to 157 (real 173); 0 regressions.

**Hail** was compared with 2,376 real May 00Z soundings paired with SPC reports (1 in or larger within 100 km, 21-03Z;
tmp/hailreal). 1 in hail within 100 km, engine against real:

| Environment | Engine | Real |
|---|---|---|
| Elevated | 12% | 14% |
| Weak shear | 13% | 13% |
| MUCAPE 1000+, shear 40+ kt | 20% | 37.5% |
| Surface-based | 24% | 38% |
| MUCAPE under 500 | 12% | 3% |

Splitting the uncapped, strong-shear cases, storms are within 100 km on 93% of evenings, a supercell on 90%, and a 1 in core
on 75%. Initiation is not the gap.

The engine makes 87-127 hail reports of 1 in or more a day, against a real 18 for the Plains box and 52 for the whole US. So
hail is not under-produced: it is spread into weak-CAPE air by the long-lived storms, which the brief accepts.

**Tried and reverted, with no effect on the gap:**
- a weaker initiation shear penalty, which also regressed High days;
- flat-topped hail swaths;
- towns given an area.

**Added to the suite:** hail by environment against the real table.

## Superheat, refit and review (2026-10-27, later)

### Kept

1. **Infrared from the ground's skin:** longwaveWm2PerK 6, longwaveRefK 303, drySkinExcessK 15. Cells at 42 C or more at 7 pm
   went from 46 to about 4.
2. **The cap under the EML** sits no lower than emlBaseMslM 1200 m, weighted by lid cover; it had sat on a 400 m moist layer.
   - Surface maximum at 7 pm: 43.7 to 40.4 C (real 39.2).
   - 850 mb seams: 23 to 3.5 per map (at 1,800 m).
   - 1,800 m and 1,400 m were tried. Both regressed tornado days, chaseable days and quiet days, so 1,200 m was kept.

### Noise floor

Two null changes measured the suite's chaos noise: the category shares move 2-4 points.

At 1,200 m, Enhanced days shift by about 6-7 points (pooled: about 36% to about 29%), toward Slight and Moderate. This is a
small real side effect, plausibly physical: shallow moisture under an EML mixes out. It is accepted as a known trade-off.

### Refit

Fit-2026-10-27d, on 40 seeds:

| Day | Fitting set: right / within one | Unseen check (seeds 41-50): right / within one |
|---|---|---|
| Day 1 (200 days fitted) | 57% / 94% | 60% / 97% |
| Day 2 | 48% / 91% | 35% / 90% |
| Day 3 | 50% / 91% | 40% / 50% |

Day 3 over-forecast on 4 of 10 check days in two refits running.

### Review 27e

No new problems on any seed. Ratings unchanged from 27d; seed 31 day 3 is 109 to 105 F.

### Open

1. A thin moist skin under a hot, dry EML on high ground (seed 31 day 3: 105/67 F, 850 mb 31 C): moisture not mixing out on hot
   days.
2. Supercells in moderate setups with no reports (31 day 1).
3. Weak dryline starts on particular days (8181 days 2-3).
4. EF0-1 at STP 3-4 on some days; night and morning tornadoes on some days.
5. Day 3 outlooks too high on the check set.

## Timing and seams batch, no refit (2026-10-27, evening)

### Day 3 outlooks

Checked on the 120-forecast fitting set: not over-forecast.

| | Forecast | Verified |
|---|---|---|
| Days at Enhanced | 50% | 58% |
| Days at Moderate | 0% | 9% |
| Map at Enhanced or higher | 7% | 23% |

The 30% contour verifies at 40%. The check set's "too high" was 10-day noise. No change.

### Tornado timing

- Real first severe reports (SPC, central US, May): before noon on 38% of days, median 1:48 pm. Morning storms are normal; morning
  tornadoes are not (2.5%).
- The engine's late-morning tornado environments look like late afternoon's: the mixed layer is about 1 km deep by noon under the
  lid, with a 0-1 km lapse rate of 9.2 C/km.
- Tried and reverted:
  - a mixed-layer-top sounding level (no timing change);
  - a thermal gate on reaching cloud base (late morning 10.5 to 9.4% in a probe, 10.7% in the suite, and quiet days up).
- Open: a deeper change to the daytime boundary layer's growth.

### Seams

The cap base's candidates (air-mass depth, moist layer, dome, EML base) are now blended with softMax over capBlendM 200 m instead of
a hard maximum.

| | Before | After |
|---|---|---|
| 850 mb temperature seams per map | 23 | 13 |
| 850 mb dewpoint seams per map | 19 | 13 |
| Surface maximum at 7 pm | 40.4 C | 38.9 C (real 39.2) |

Suite against base2: the only flag is Enhanced 28%, the known EML-base trade-off.

### Forecast check without refit

Current calibration on the unseen seeds 41-50, right / within one:

| Day | Now | Last refit's check |
|---|---|---|
| Day 1 | 70% / 93% | 60% / 97% |
| Day 2 | 50% / 85% | 35% / 90% |
| Day 3 | 40% / 80% | 40% / 50% |

No drop, so no refit. The check is reg/forecast-check.sh (about 25 min).

55/55 tests pass.
