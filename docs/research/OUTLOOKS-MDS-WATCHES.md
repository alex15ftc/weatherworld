# Convective outlooks, mesoscale discussions and watches: research (2026-11-05)

Research only; no code was changed. The two short scratch tests are in C:/Users/alex1/.claude/jobs/f592f53b/tmp (stepcheck.mjs, nostorm.mjs).

## 1. Summary

The products already follow SPC's layout closely:
- the March 2026 probability levels, conditional intensity groups (CIGs) and category tables;
- the SPC issue times;
- MD watch probabilities at 5/20/40/60/80/95, and "most probable peak" ranges;
- county-based watches with a probability table and PDS wording.

They are verified against "practically perfect" truth (PP: what a forecaster with perfect knowledge of the reports would have drawn), and the fit is checked on worlds kept out of the fitting. What holds them back is mostly **how the forecast runs are made and scored**, not the product rules.

1. **The forecast runs move storms in 30-minute steps, while the world they forecast moves them in 5-minute ticks.**
   - This holds for both the outlook members and the MD/watch members (`atmosphere.advance(0.5)`).
   - Measured from the same saved worlds, the 30-min runs made 2 / 12 / 15 tornadoes where 5-min ticks made 7 / 22 / 19. They also made about half the tornado and hail report cells.
   - **CPU cost was the same.**
   - The calibration tables have been quietly correcting this model error: the Day 1 tornado table maps a raw 22% to 44%. They are refit by hand about 30 times.
   - The fix costs nothing at run time. It needs one refit.
2. **Tornado probabilities have almost no skill.** The Brier skill score is 0 / 5 / 7% at 8 / 16 / 32 runs, against 57-61% for any severe weather (memory note on the short-range model, tmp/ens). The spread comes from the storms' random draws, not from errors in the air.
   - The storm engine already knows each storm's tornado rate per hour (`tornadoRatePerHour`) and how strong its tornadoes would be (`tornadoShareReaching`).
   - Adding up the *expected* tornadoes in each run, instead of the tornadoes its draws happened to make, removes most of that noise for almost no CPU. Statisticians call this conditioning on the rate ("Rao-Blackwellising"). It is the cheapest skill gain on offer.
3. **Day 3 is made from ingredients with no storms.** It forecasts Slight on 94-100% of days while 59-70% verify higher, and it never hatches.
   - Running storms in the Day 2 members' Day 3 costs only about 10-20% more (measured: 7.0-7.2 s against 7.8-8.7 s per 12 h).
   - SPC's Day 3 now also carries a significant-severe probability.
4. **The MD and watch members are too few and too coarse.** With 4 runs, every probability comes in steps of 25%, so a tornado watch needs 2 runs in 4.
   - Adding cheap storm layers (the outlooks already use them) and expected hazards would smooth this out for about 0.3 s per layer.
5. **Watch text and behaviour differ from SPC in small but visible ways:**
   - the probability table uses the MD steps and wrong Low/Moderate/High bands (SPC: Low up to 20%, Moderate 30-60%, High 70% and over, in 10% steps);
   - every watch lasts exactly 6 h;
   - a watch is never cleared county by county.
   - Nobody has reviewed MDs or watches as a meteorologist; every review round so far scored only the Day 1 outlook.
6. **Guidance to reuse:**
   - The short-range model's hourly runs are a free time-lagged ensemble for the Day 1 updates and the MDs, once it stops sharing the live random draws for new storms (as the short-range job recommends).
   - The cloud model has **no** forecast skill about the engine's storms, because the engine decides them and the model only shows them. Use it only to keep the wording consistent with what players see.

## 2. How each product works now, and its weaknesses

### 2.1 Outlooks (Day 1-3)

**Pipeline.**
- **Issuing.** `server/OutlookRuntime.js` `issue()` saves the live world once (`shareState`) and sends 8 members to the forecast pool (`ForecastPool.js`, `forecastWorker.js`).
- **Members.** `js/forecast/DayOneOutlook.js` `runOutlookMemberSet()`:
  - restores the world and gives the member its own errors (`ensemblePerturbation.js`): a timing error of 1.2 m/s, upstream PV waves, and errors in cap, moisture and lift that come in ± pairs;
  - steps the world `OUTLOOK.stepHours` = 0.5 h with `atmosphere.advance()`;
  - records each step with `captureTruth`.
- **Cheap runs.** Each member carries 3 "cheap" storm layers. Each is a separate storm set moved through the host's air without feeding back into it. That gives Day 1 = 8 + 24 runs and Day 2 = 4 + 12.
- **Day 3.** Its members run without storms and add up `diagnoseInitiation` rate × severity from MLCAPE and shear (`INGREDIENTS`).
- **Combining.** `combineOutlook()`:
  - averages each run's PP chance field and smooths it again (`spreadOut`);
  - blends in the last issue (`continuity` 0.35 / 0.2);
  - maps the result through piecewise curves (`outlookCalibration.js` `calibrateChance`, with a guard that stops it raising a chance past the 30% tornado or 45% wind/hail contour);
  - caps each level by the share of runs that agree (`categoryAgreement`: 2/3/4/6/7 runs in 8 for MRGN to HIGH);
  - judges the intensity groups per contour ring (`worldRiskCategories.js` `contourCigAreas`, `CIG_SHARE`);
  - caps by lead time (Day 2 at MDT, Day 3 at ENH) and allows at most one category rise per issue;
  - builds the category from SPC's tables (`spcOutlookRules.js`) and writes the text with `writeDiscussion()`.
- **Truth.** `js/verification/truth.js`: PP on an 80 × (10/25) km grid with σ = 120 km, chance within `RISK_RADIUS_MILES` = 10.

**What is right.**
- Issue times: Day 1 at 01/06/13/1630/20Z, Day 2 at 06/1730Z, Day 3 at 0730/1930Z.
- The probability levels, the CIG matrix (checked against spc.noaa.gov/exper/conditional-intensity-information) and the 75/90% wind levels.
- Continuity between issues, a one-category cap on upgrades, and caps at longer leads.
- The CIG judged by the typical run rather than the pooled runs.
- Reliability tables in `scripts/outlook-verify.mjs`, plus checks on worlds kept out of the fit.

**Weaknesses, with the evidence:**

| # | Weakness | Evidence |
|---|---|---|
| O1 | The members' storms move in 30-min steps; the truth's and the live world's in 5-min ticks. | `DayOneOutlook.js` calls `atmosphere.advance(OUTLOOK.stepHours)`. `outlook-verify.mjs` line 77 ticks the truth at 1/12 h, with the comment "advance(0.5), whose storms made fewer tornadoes than the live world's". Test below. |
| O2 | The calibration absorbs O1 and other model errors, and goes stale with every engine change. | Day 1 tornado curve: raw 22.3 → 43.6, 33.8 → 64.3. About 30 refits are noted in the file header. The `day1update` table is still the 2026-10-24 fit, made from 8 runs. |
| O3 | Tornado probabilities have almost no skill. | Brier skill 0 / 5 / 7% at 8 / 16 / 32 runs (memory note on the short-range model). The spread is "mostly from storm dice". |
| O4 | Day 3 has no storms and no hatching. It forecasts Slight on 94-100% of days, while 59-70% verify higher. | `stormShare.day3 = 0`. Outbreak-climate memory note; the Day 3 tornado range always reads 0-0. |
| O5 | A stack of hand-set gates sits on top of the calibration, so the issued probability is no longer reliable by construction. | The gates: the agreement vetoes, the GUARD_LEVEL, `highRunShare`, the one-step rise, the lead caps, `CIG_SHARE` 1.01 (never) and the hand-set tornado CIG shares. 2026-10-25 review: forecasts "lean a category low"; lifting the peaks traded misses for false alarms at the same skill. |
| O6 | Smoothing is applied twice: each run's chance is already a 120 km PP field, then it is smoothed again by `spreadFor(day)` (40 km for Day 2, 69 km for Day 3). PP σ stays 120 km while the grid was scaled to 32 km for the 10-mile radius. | `truth.js` lines 211-215. The 2026-10-25 note says "widening the runs adds nothing". Worth checking that the 10-mile chances are not blurred at 25-mile scale. |
| O7 | The discussion gives exact figures, against its own rule. | `writeDiscussion` `area()` prints "(15% tornado area, CIG1)". The text uses compass ninths of the map and one regional section. Real SPC text has one section per region, with reasoning about storm mode and how it evolves. |
| O8 | Every Day 1 update (5 a day) reruns the full 8 + 24 runs. The short-range model already runs every hour and is ignored. | `OutlookRuntime.issue`, `ShortRangeRuntime`. |
| O9 | Hail is still too small in the most favourable air. This is an engine problem the outlooks inherit: the hail CIG verifies seldom and `CIG_SHARE.day1.hail` cannot reach CIG2. | Every review round (memory note on meteorologist day reviews); TARGETS-2026-10-25: hail CIG1 on 29% of days against 45% central US. |

**Test of O1** (`tmp/stepcheck.mjs`). Each pair of runs starts from the same saved 15Z world with the same random-draw seed and runs 12 h:

| World, draw seed | 30-min steps: tornadoes / tornado, hail, wind cells | 5-min ticks: the same | ms (steps / ticks) |
|---|---|---|---|
| seed 3, a | 2 / 4, 2, 28 | 7 / 11, 4, 96 | 8157 / 7593 |
| seed 3, b | 0 / 1, 1, 25 | 0 / 1, 1, 22 | 7851 / 7869 |
| seed 7, a | 12 / 22, 97, 437 | 22 / 54, 203, 602 | 8388 / 7624 |
| seed 7, b | 15 / 20, 143, 443 | 19 / 32, 196, 490 | 7247 / 7310 |

The coarse steps lose up to about half the tornadoes and hail. The cost is the same because the runs' time goes on the atmosphere: soundings, the large-scale (QG) model and the regional model.

`tmp/nostorm.mjs` (seed 7, 12 h): 7.0-7.2 s without storms against 7.8-8.7 s with 5-min storm ticks.

### 2.2 Mesoscale discussions

**Pipeline.** `server/MesoscaleRuntime.js` runs a look ahead every hour, or every 2 h when things are settled.
- It runs 4 members 5 h ahead (`MesoscaleDiscussion.js` `runMesoscaleMember`). They have their own storm draws but **no errors in the air**, and they step 30 min (O1 again).
- Areas of concern (`concernAreas`) are where at least half the runs have severe weather within 10 miles, joined up, with at least 40 cells, plus tornado-only areas of 12 or more cells.
- `assessArea` gives:
  - the watch probability, as the share of runs reaching a watch's worth (10 severe cells, 2 tornadoes, or 1 strong tornado);
  - the peaks, as the median of the runs;
  - the watch type from the chance of 2 or more tornadoes or a strong one.
- The text (`describeSetting`, `writeMesoscaleDiscussion`) describes the air **now** (`describeNow`). The rules on lead time, repeats and replacement are in `Watch.js` `lookAhead`.

**What is right.**
- The probability steps and "Concerning..." lines.
- Peak ranges like SPC's (e.g. "85-115 MPH", "1.50-2.50 IN").
- MDs about a watch in effect; replacing an earlier MD and saying so; a discussion before every watch.
- Measured verification: "watch likely 80%" verified 71% and 95% verified 97% (STATUS.md, 2026-10-14).

**Weaknesses:**

| # | Weakness | Evidence |
|---|---|---|
| M1 | 4 runs give probabilities in steps of 25%. 1 run in 4 → 25% → `watchStep` gives 20%, which is not above `tornadoChanceLow` = 20, so a tornado watch needs 2 runs in 4. The peaks are medians of 4 values. | `assessArea`, `watchStep`. |
| M2 | 30-min storm steps (O1). The MD's own check (`scripts/mesoscale-report.mjs` line 46, `atmosphere.advance(MESOSCALE.stepHours)`) also steps the *truth* at 30 min, so the verification above is of the wrong world. | Code. |
| M3 | No uncertainty in when storms start. With no errors in the cap or lift, the runs agree on initiation more than reality would, and "watch likely" goes out only about an hour ahead (47% before any storm). | `runMesoscaleMember` has no `perturbMesoscale`. STATUS: "fewer go out before any storm has formed (47%)". |
| M4 | The text has no **trends**. Real MDs are mostly about change: "MLCIN continues to erode", "the low-level jet will strengthen after 00Z and enlarge hodographs", "storms along the dryline are deepening". This one speaks only of the air now and the storms now. | `describeHere` takes single values (quantiles of now). |
| M5 | No ATTN...WFO line, no LAT...LON polygon text, no forecaster sign-off. No "Severe potential...Watch unlikely" status MDs for marginal events. | `writeMesoscaleDiscussion`. The map's NWS areas exist (memory note on map design). |
| M6 | Never reviewed by a meteorologist. | No MD or watch mentions in any METEOROLOGIST-REVIEW-*.md. |
| M7 | Cost: 4 × 5 h ≈ 4 × 3 s of a pool thread every hour. That is cheap, but it is a separate copy of the world, independent of the short-range run made the same hour from almost the same state. | `MesoscaleRuntime.issue`, `ShortRangeRuntime`. |

### 2.3 Watches

**Pipeline.** `js/forecast/Watch.js`:
- a watch comes from an area assessed at 80% or more (`WATCH.leastPercent`);
- its ground is drawn one cell wide and made of whole counties, at most about 22,000 sq mi;
- it goes out when storms fire, or `startsInHours - issueLeadHours` ahead, with an MD at least 0.5 h before;
- it lasts a fixed 6 h, is never changed or cancelled, and is followed without a gap where the threat goes on.
- Its probability table (`watchProbabilities`) treats each run's count as the mean of a Poisson count for the 10-event rows, and uses the share of runs for the tornado rows.
- PDS: an 80% chance of 2 or more strong tornadoes and a peak of 136 mph or more; or a derecho-scale wind case.
- The text follows the SPC SEL layout, with the watch outline update (WOU) listing the counties.

**Weaknesses:**

| # | Weakness | SPC practice |
|---|---|---|
| W1 | Probabilities take only 5/20/40/60/80/95, with `LEVEL` set to High ≥ 80 and Mod ≥ 40. | Watch probabilities run in 10% steps from <2% (strong tornado) or <5% to >95%. Low is up to 20%, Moderate 30-60%, High 70% and over (SPC watch probability pages). |
| W2 | Every watch lasts 6 h. | SPC sizes the length to the threat, commonly 4-8 h. Local offices extend in time or cancel counties early as a line passes (watch county notification, WCN). |
| W3 | Not cleared behind a line: the ground stays under the watch until it expires. Players see watches over cleared air. | WFOs clear counties hourly once the threat has passed. |
| W4 | The watch type is quantised by 4 runs (M1). On 2026-10-14 there were 13 tornado watches to 80 severe thunderstorm watches; that was before the outbreak climate, and the ratio needs measuring again. | A large share of SPC watches are tornado watches on active Plains days. In 2003-08 about half of tornado watches verified fully, about 80% of PDS tornado watches (Christenberry et al.). |
| W5 | About 5 watches a day on a 500 × 500 mi map, partly because of the chain of 6 h watches that follow each other. | Corfidi (1999): watches average about 25,000 sq mi; the NWS guideline is severe weather over 8,000 sq mi or more for at least 2 h. Chains exist, but long events often get one longer watch, or a replacement that covers the leading edge. |

## 3. Improvements

The CPU and memory costs below are for the live server: a 50 × 50 grid (about 16 km cells), and forecast-pool threads of about 450 MB each while alive.

### I1. Step every forecast copy as the server does (outlook, MD and the MD check)
- **Practice:** the forecast model should be the same model that makes the weather. SPC calibrates guidance for model bias, not for a bias in how the runs are stepped.
- **Change:**
  - In `runOutlookMemberSet`, `runMesoscaleMember` and `scripts/mesoscale-report.mjs` `liveHour`, replace `atmosphere.advance(0.5)` with 6 × `advanceStormLayer(1/12)` then `advance(0.5, { advanceStorms: false })`, as `ShortRangeModel.runShortRange` and `outlook-verify` already do.
  - The cheap layers call `advanceStormEngine(world, 0.5, { applyFeedback: false })`. Step those in 5-min ticks too, and apply the host's feedback once per half hour as now.
  - Then do the single refit the user prefers (archives `fit-*` / `check-*`, about 1.5 h offline).
- **Gain:**
  - raw chances near the truth's, so the calibration curves come back toward the diagonal and drift less with engine changes;
  - the runs' random draws behave as the live world's do;
  - expect better tornado and hail reliability at the top levels, where the curves are steepest now.
  - The MD verification becomes valid.
- **Cost:** ±0 CPU (measured). The cheap layers' storm time rises: about 6 × the storm part of 0.58 s, so 24 layers may add a few seconds per issue. Measure before the refit. No memory change.

### I2. Expected hazards in each run (conditioning on the rate)
- **Practice:** surrogate severe and calibrated CAM guidance. Sobash et al. (2011, 2016) treat model storm attributes such as UH above a threshold as stand-in reports, then smooth and calibrate them. SPC's HREF/SREF calibrated guidance (SPC-Post, 2021) does this with UH neighbourhood probabilities. Here the "model" is the storm engine itself, so its exact hazard rate can be used.
- **Change:**
  - In `track()` (DayOneOutlook) and `runMesoscaleMember`, at each storm tick add to per-cell Float32 grids:
    - `rate × dt` for each storm not on the ground (`tornado.probability` / `tornadoRatePerHour(tornadoImminence(storm))`, at the wall-cloud cell);
    - `rate × dt × tornadoShareReaching(scale, 111 / 136 / 166 mph)` for the EF2+, EF3+ and EF4+ tiers;
    - smooth analogues for hail and gusts where the engine has a distribution. Otherwise keep the realised reports for those.
  - The run's tornado chance at a point becomes 1 − exp(−Σ expected within the radius). Keep the realised tracks for the text's counts and for verification.
  - In `combineOutlook`, use the expected-hazard chance for tornadoes and the tornado CIG shares (`contourCigAreas` already takes per-run amount and tier grids).
- **Gain:** this takes the tornado draws' noise out of each run. The rotation history still differs between runs. It should lift the tornado Brier skill above the current 0-7% without more runs, and give the CIG judgement a smoother tier share. Check it with the Brier skill score, as in I7.
- **Cost:** a few flops per storm per tick, plus about 4-6 Float32 grids of 2,500 cells per run-day (40-60 KB). Negligible.

### I3. Neighbourhood ensemble probabilities instead of the mean of smoothed fields
- **Practice:** Schwartz & Sobash (2017) neighbourhood maximum ensemble probability (NMEP), as HREF does it: for each run, mark whether the event fell within r of the point (here 10 mi), take the fraction of runs, then apply one Gaussian smoothing.
- **Change:**
  - Use the runs' `reports` grids (already returned), dilated by the radius, as the 0/1 field. The average across runs is the raw chance; smooth once with σ set per day.
  - Drop the PP smoothing *inside* each run for the forecast, and keep PP for the truth.
  - The agreement vetoes become largely unnecessary: an NMEP is itself the share of runs that agree.
  - Also check O6: scale `PP_SIGMA_KM` with the radius (120 × 10/25 = 48 km) or justify keeping 120.
- **Gain:** sharper, more honest chances at a 10-mile scale. One smoothing step to fit instead of two. It also removes one hand-set gate (O5).
- **Cost:** about the same as now (one smoothing instead of two).

### I4. Day 3 with storms and a significant-severe probability
- **Practice:** since March 2026 SPC's Day 3 carries total severe, its CIG, and a total significant-severe probability (spc.noaa.gov/exper/conditional-intensity-information).
- **Change:**
  - Set `OUTLOOK.stormShare.day3` to 0.5, so the four Day 2 members keep their storms through Day 3. Their 12 cheap layers can stop at Day 2 to bound the cost.
  - Compute a significant-severe chance from the runs' `severeSig` tier, plus I2's expected strong-tornado grid. Add an ingredients term (STP and SCP from the cell soundings, at the Thompson et al. 2012 conditional rates) for the cells where the runs have no storms.
  - Hatch the Day 3 CIG1 from it (`WORLD_MAX_CIG.severe` = 1 already).
- **Gain:** this removes the 0-0 tornado range and the near-permanent Slight on Day 3 (O4). Day 3 Enhanced days come from storms, not from a calibration curve. It matches the new SPC product.
- **Cost:** about +10-20% of the Day 3 member time (measured 7.0 → 7.8-8.7 s per 12 h), about +6 s of pool CPU per Day 3 issue. No new memory.

### I5. A blend of Day 1 updates and the short-range model (time-lagged)
- **Practice:** for Day 1 updates, SPC forecasters lean on the newest CAMs and their time-lagged ensembles: HRRR runs from several cycles, the HREF, and the HRRR time-lagged ensemble.
- **Change:**
  - At 1630Z, 20Z and 01Z, run 4 full members + 12 cheap layers instead of 8 + 24.
  - Add the last 3-4 hourly short-range runs as members, weighted by age. Each needs the per-hour 0/1 hazard grids (asked for in SHARED-FINDINGS).
  - **Precondition:** the short-range model stops sharing the live random draws for new storms. While it shares them, its 0-3 h is the truth (the short-range job's own finding and recommendation; I agree).
  - Its 0-3 h storms already on radar may keep their state; that stands in for radar data assimilation.
- **Gain:** fresher guidance for the afternoon updates, and more members at zero extra model time. The `day1update` table gets refit from this mix.
- **Cost:** about half the CPU of each of the three daily updates (−4 full members ≈ −4 × 10-15 s). Extra memory is about 100 KB per kept short-range run for the hazard grids.

### I6. MDs and watches: more runs, timing doubt, trends, real watch tables
- **Practice:** an MD is a short-range, trend-based statement. Recently SPC has used WoFS, the Warn-on-Forecast System (Heinselman et al. 2024; Silcott et al. 2026 on its use in MDs). Watch probabilities follow the SPC table.
- **Changes:**
  - **(a) Runs and quantisation.**
    - Give `runMesoscaleMember` 3 cheap layers each, like the outlooks (4 + 12 runs).
    - Use I2's expected tornadoes for `tornadoes2` and `strongTornado`, through the same Poisson treatment `watchProbabilities` already uses for wind and hail.
    - Then `watchStep` over 16 runs gives real 10% steps.
  - **(b) Timing doubt.** Apply `perturbMesoscale` with a small share (lift and cap only, ~0.35 as `MESOSCALE.leastShare`) so the runs differ on when the cap breaks (M3).
  - **(c) Trends.**
    - `describeNow` keeps a copy from the previous look: 2,500-cell Float32 grids of MLCAPE, MLCIN, SRH01, shear and dewpoint.
    - `describeSetting` words the 1-3 h change: "MLCIN has weakened to near −25 J/kg in the last two hours", "SRH01 increasing to 250-300 m2/s2 as the low-level jet strengthens".
    - The short-range run of the same hour can supply the next 3 h of the same fields.
  - **(d) Header lines.** Add "ATTN...WFO..." from the NWS areas the MD touches, and a LAT...LON-style list from `rings`.
  - **(e) Watch table.**
    - Use the SPC steps (<2, <5, 5, 10, 20 ... 90, >95).
    - Bands: Low up to 20, Mod 30-60, High 70 and over.
    - Make the tornado-watch rule "Mod or higher for 2+ tornadoes, or for a strong tornado".
  - **(f) Watch length and clearing.**
    - Set the length from the runs' last severe hour over the ground (4-8 h, rounded to the hour).
    - At each hourly look, clear counties where no run has severe weather in what is left of the watch and no storm is there. That is the WCN practice, and it fits the existing "a watch stands as issued" rule if clearing is treated as a local office's act.
- **Gain:**
  - smoother, more honest MD and watch probabilities, and more tornado watches when they are earned;
  - more lead before storms form;
  - text that reads like SPC's;
  - watches that end behind a line, which matters to players.
- **Cost:**
  - (a): 12 cheap layers × ~0.3 s ≈ +4 s of pool CPU per hourly look (less after I1 if storm ticks dominate);
  - (b), (d), (e): ~0;
  - (c): about 50 KB kept;
  - (f): one areaOutcome pass per watch per look.

### I7. Verification the way SPC does it, and calibration that follows the engine
- **Practice:**
  - The PP hindcast is the upper bound (Hitchens, Brooks & Kay 2013).
  - The Brier score and its skill against climatology, reliability diagrams, ROC area, and CSI / POD / FAR of the category areas against PP areas (Dean & Schneider, SPC verification).
  - Watch verification: a tornado watch verifies "fully" with a tornado, and otherwise as a severe thunderstorm watch (Christenberry et al.).
  - MD lead time to the watch and to the first report.
  - For rare events the Peirce skill score (Ebert & Milne 2022).
- **Change:**
  - `outlook-verify.mjs`: add Brier and Brier skill per hazard and level, CSI per category, and a reliability chart for each issue time.
  - `mesoscale-report.mjs`: add verified rates per probability step, the share of watches with full and with partial verification, and the share of watches with no reports.
  - `DayReviewRecorder` already writes each live day: add the issued 0/1 contours and the truth's PP grid to the package, so that **the live server keeps its own verification archive**.
  - Then `refit-from-archive.mjs` can refit the calibration from live days (e.g. weekly, isotonic and monotone, within limits), and stop the hand refit cycle (O2). After I1 to I3 the curves should be near-diagonal, so a slow refit like this is safe.
- **Gain:** measured skill instead of category hit rates; calibration that follows engine changes; evidence for which gates in O5 earn their place.
- **Cost:** offline scripts only. Live: a few hundred KB a day in day packages, already capped at 14 days.

### I8. Fewer hand gates (after I1 to I3)
- **Practice:** SPC draws calibrated probabilities. Its caution at long lead is a forecaster habit, mostly about High, not a run-agreement veto at every level.
- **Change:** once I1 to I3 are in, re-measure with I7.
  - Keep the lead caps, the one-step rise and continuity: they are product behaviour players see and they are realistic.
  - Test removing `categoryAgreement`, GUARD_LEVEL and `highRunShare`. With 32 smoothed, calibrated runs, the probability is already the agreement.
  - This is a decision for the user (these were the user's choices), so present the BSS and category tables with and without the gates.
- **Gain:** a reliable probability with simpler rules; fewer category-low leans (TARGETS-2026-10-25: Day 1 40% too low against 17% too high).
- **Cost:** 0.

### I9. Text closer to an SPC outlook
- **Practice:** SPC Day 1 text gives a summary, then sections by region (e.g. "...Southern Plains..."), covering the synoptic and mesoscale reasoning, storm mode and its evolution, timing, and the conditional nature of the threat. It gives no exact probabilities apart from occasional references to the levels.
- **Change in `writeDiscussion`:**
  - drop the "(15% tornado area, CIG1)" figures (O7), or keep them only in the map legend;
  - write one section for each joined SLGT+ area, named by `areaNames`;
  - describe storm mode from the runs' storm modes (supercell share versus line share, from `stormTrack`, `mode`);
  - write conditional wording for capped days ("any storm that forms in the warm sector would ...").
  - **Day 2 and Day 3:** say what the forecast doubt is about (timing of the trough from the timing error, return of moisture from the moisture error), from the members' errors, which are already known per run.
- **Gain:** realism (the reviewers' outlook score is already about 7, the highest of the four). Fewer contradictions with the map.
- **Cost:** ~0.

### I10. The cloud model: what it can and cannot do
- **Can't:** forecast the engine's storms. The engine is the authority and the model draws its storms (cloud-model game plan and lab diagnosis notes). Running it in forecast runs is far too costly: about 5 core-hours per 18 h run (short-range job).
- **Can:**
  - Wording consistency for storms near players. When a tier-1 or tier-2 storm is in an MD area, the MD may describe its visible structure (a wall cloud or a striated updraught) from the frames already produced, so players never read "storms are beginning to form" under a mature supercell.
  - Offline: a paired engine-to-model sample set to calibrate the short-range model's UH proxy, as the short-range job proposes. That would make UH-based ensemble products (paintball and UH75+ probabilities) more trustworthy as an outlook input.
- **Feedback caveat:** I agree with the coupling job. If modelled storms feed back strength or counts into the engine, forecast runs (which never run the model) will miss systematically near players. Feeding back placement and timing only keeps the forecast runs statistically the same as the live world.
- **Cost:** reading existing frames only.

### I11. Cheaper ensembles in general
- **What drives cost:** the atmosphere (soundings about 40%, QG model about 28%), not the storms. Spread comes mostly from the storms' random draws.
- **The efficient design is few atmosphere copies with many storm layers:** the cheap layers (already 3 per member), plus I2's expected hazards. Options, cheapest first:
  - **(a)** More cheap layers on Day 1 (e.g. 5 per member) instead of more full members. Earlier tests (tmp/ens) found 8 + 24 ≈ 32 full runs, at about 15% more than 8. Check whether 8 + 40 helps tornadoes after I2; it may not.
  - **(b)** Day 2: keep 4 full members (they carry the upstream and timing doubt, which matters most at that lead) and their cheap layers.
  - **(c)** Reuse: the 06Z Day 1 runs already cover the 13Z issue's first 7 h. A 13Z issue could restart only half the members and continue the other half, which are still in the pool's memory if kept as state bytes: about 14 MB each saved, so 4 × 14 MB.
  - **(d)** Time-lagged short-range runs (I5).
- **Don't:** add whole members for MDs, or make the cloud model part of any ensemble.

## 4. Recommended order of work

1. **I1** (stepping), with **I7**'s new Brier and CSI scores in the same pass. This needs no new code beyond the stepping, and gives the baseline every later step is measured against. One refit afterwards, as the user prefers batching.
2. **I2** (expected tornadoes) and **I3** (neighbourhood probabilities), measured with I7 on archives before any refit.
3. **I4** (Day 3 with storms and significant severe).
4. **I6** (a, b, e, f) for MDs and watches, then a first meteorologist review round of MDs and watches (M6) using docs/REVIEWER-BRIEF.md.
5. **I8**: a user decision on the gates, from the I7 numbers.
6. **I5**, once the short-range model stops sharing draws for new storms. Then refit `day1update`.
7. **I6c/d** and **I9** (text) at any time; they are independent and cost nothing.
8. **I7** live archive and slow refits once the curves are near-diagonal.
9. **I10** wording consistency, after the cloud model is in the live game.

## 5. Sources

- SPC, Conditional Intensity Information (in effect from the 1630Z Day 1, 3 March 2026; CIG levels, tables, Day 3 significant-severe): https://www.spc.noaa.gov/exper/conditional-intensity-information/
- SPC-Post notice on HREF/SREF calibrated severe probabilities (UH 99.85th percentile neighbourhood probabilities, 4 h and 24 h): https://www.weather.gov/media/notification/pdf2/scn21-50spc_post_v1.pdf
- Sobash et al., surrogate severe from convection-allowing ensembles (UH): https://ams.confex.com/ams/pdfpapers/176221.pdf and https://ckanprod.data-commons.k8s.ucar.edu/dataset/60d1c23e-a36f-4eb0-b9b6-0a9716f84a68
- NCAR ensemble probabilistic severe guidance (calibrated UH surrogates): https://ams.confex.com/ams/97Annual/webprogram/Paper315408.html
- SPC watch probability tables (bands Low / Mod / High; strong tornado <2-20% Low): https://spc.noaa.gov/products/watch/ww0277_prob.html and https://spc.noaa.gov/products/watch/2015/ww0319_prob_tabbed.html
- Dean, PDS watches (SPC publication): https://origin-east-www-spc.woc.noaa.gov/publications/dean/pdswatch.pdf
- Christenberry, Lamers, Mejia, Dean & Weiss, multi-tiered verification of SPC tornado watches, 2003-08: https://ams.confex.com/ams/25SLS/webprogram/Paper176209.html
- Dean & Schneider, overview of SPC outlook and watch verification: https://ams.confex.com/ams/39BROADCAST/webprogram/Paper189096.html and https://origin-east-www-spc.woc.noaa.gov/publications/dean/spcverf.pdf
- Watch size and NWS watch guideline (Corfidi 1999, cited in): https://reu.caps.ou.edu/reu07/finalpapers/Ram-finalpaper.pdf
- Example SPC MDs (format, watch probability, most probable peaks): https://origin-west-www-spc.woc.noaa.gov/products/md/2025/md0473.html, https://origin-west-www-spc.woc.noaa.gov/products/md/2025/md0903.html
- WoFS in SPC operations and MDs: https://wof.nssl.noaa.gov/experiments.php ; Heinselman et al. 2024: https://repository.library.noaa.gov/view/noaa/56453 ; Silcott et al. 2026 (JOM): https://nwafiles.nwas.org/file/nwafiles/jom/articles/2026/2026-JOM15/2026-JOM15.pdf
- Brooks & Kay, practically perfect forecasts and the limits of rare-event skill (Hitchens, Brooks & Kay 2013, WAF): https://typeset.io/pdf/objective-limits-on-forecasting-skill-of-rare-events-43vnuflyas.pdf
- Ebert & Milne 2022, verification of rare and severe events: https://nhess.copernicus.org/articles/22/539/2022/
- These are cited from knowledge and were not fetched in this session:
  - Schwartz & Sobash 2017 (MWR, neighbourhood ensemble probabilities, NMEP);
  - Thompson et al. 2012 (WAF, tornado ratings by STP and environment);
  - Roberts et al. 2020 (HREF).
- Project: docs/STATUS.md (outlook and MD/watch sections), docs/TARGETS-2026-10-25.md, docs/METEOROLOGIST-REVIEW-2026-10-25-evening.md, and docs/research/SHARED-FINDINGS.md (short-range and coupling sections).

## 6. Done 2026-11-05: I1 (stepping) and I7 (scores), with one refit

**Changes**
- `AtmosphereWorld.stormTicksTo` / `advanceLikeServer`: the one helper for stepping like the server (5-minute storm ticks up to each 30-minute atmosphere step, then the air). Used by the outlook members and their cheap layers (`runOutlookMemberSet`), the MD/watch members (`runMesoscaleMember`, which is also the MD check's truth), `runShortRange`, and the truths and warm-ups of `outlook-verify`, `outlook-updates-verify`, `outlook-spread` and `mesoscale-report`.
- A second bug, found on the way: the cheap layers shared the host's `reportLog`. Each run's hail and wind were therefore the reports of *all* its layers: with 2 layers a host's 77 hail cells read 281. Each layer now has its own log (`LAYER` in DayOneOutlook.js).
- `outlook-verify.mjs`:
  - section 4: Brier skill (raw, calibrated, issued), a reliability table of the calibrated chance, and CSI/POD/FAR per contour level and per category against PP;
  - section 5: tornadoes and report cells, runs against the day;
  - `--outlooks N`;
  - `--cheap` now reaches the workers (it was ignored).
- `mesoscale-report.mjs` section 6: Brier skill of the MD watch probability, and tornado watches verified fully or in part.
- `refit-from-archive.mjs`: keeps any table the fit has no data for; `--chances-only`.
- `calibrateChance`: past the last fitted point, never below the raw chance (it used to hold the last value).

**Measured** (scratch archives in the job's tmp/stepfix: seeds 1-6 × 2 mornings before and after, the same truth; Day 1 = 8 + 24 runs). The "before" run is the code as it was, so it carries both bugs.

| Day 1, seeds 1-6 | before | after, old table | after, refit (in sample) | after, refit, unseen seeds 7-12 |
|---|---|---|---|---|
| Brier skill tornado (raw / calibrated / issued) | 9 / 11 / 10% | 10 / 11 / 10% | 10 / 12 / 10% | 11 / 13 / 10% |
| Brier skill wind | 15 / 28 / 26% | 30 / 14 / 4% | 30 / 35 / 27% | 25 / 30 / 21% |
| Brier skill hail | 11 / 26 / 25% | 30 / 14 / 5% | 30 / 36 / 28% | 33 / 37 / 28% |
| CSI MRGN+ / SLGT+ / ENH+ | 0.82 / 0.74 / 0.61 | 0.79 / 0.70 / 0.58 | 0.88 / 0.85 / 0.61 | 0.90 / 0.84 / 0.57 |
| category right / within one | 75 / 100% | 75 / 100% | 83 / 100% | 42 / 92% |
| runs' tornadoes a day (full / cheap; the day) | 21.0 / 22.8; 22.4 | 23.0 / 23.0; 22.4 | | 20.7 / 21.2; 19.8 |
| runs' hail cells / wind cells (the day) | 381 / 442 (119 / 139) | 125 / 151 (119 / 139) | | 184 / 154 (191 / 162) |

- **Tornadoes.** In these mornings the 30-minute steps cost only about 10% of the tornadoes (21.0 against 23.0 a day), not the half the 12 h scratch test showed. Tornado skill barely moved (it needs I2).
- **Hail and wind.** The big change came from the report-log fix. The runs' cells now match the day's, and the raw chance's skill doubled.
- **Curves.** The refit brought them back toward the diagonal: the Day 1 tornado curve is near the diagonal (raw 22 → 26, was 22 → 44); wind 22 → 33 (was 22 → 10).
- **Small sample.** These counts are from 12 Day 1 and 6 Day 2 mornings. The unseen 42% "right" means 5 of 12 days.

**MDs and watches** (`mesoscale-report 1 --seeds 1-4`; the "before" run used the old stepping by a scratch preload):
- watch-probability Brier skill: 12% before, 15% after;
- tornado watches meeting 2+ tornadoes or a strong one: 61% (of 18) before, 80% (of 20) after;
- MDs saying a tornado watch is likely whose area met the tornado case: 31% before, 57% after;
- every watch had reports in both runs.

**Left open**
- A full refit: 40 seeds × 5 mornings plus a 10-seed check, about 80 min of a free machine.
- `CIG_SHARE` was not refit: too few areas, so the fit kept every group.
- Day 3 and `day1update` were not refit: these archives have no Day 3, and no update issues. Their tables are still fitted to runs that had the report-log leak.
- Reports are logged at the 30-minute captures in both the runs and the truths, while the live server logs at every 5-minute tick. Runs and truth match each other, but not the live log.
- `WeatherAuthorityRuntime.stormTicksTo` still has its own copy of the loop (another job is editing that file).

## 7. Done 2026-11-06: I2 (expected tornadoes), I3 (neighbourhood probabilities), and the full refit

**Changes**
- `js/forecast/expectedHazards.js` (new): the engine's own tornado rate, summed per tick.
  - Each 5-minute tick, a storm with no tornado on the ground adds `tornadoRatePerHour(tornadoImminence(storm))` × tick at its wall-cloud cell.
  - The EF2+/EF3+/EF4+ tiers add the same times `tornadoShareReaching` of the engine's wind spread at 111/136/166 mph.
  - A tornado already on the ground at a run's start counts as 1.
  - Hail and wind stay as reports. The engine draws no rate for them; the only chance in them is the report log's who-reports draws, and the truth has the same draws.
- **Outlook members** (`runOutlookMemberSet`, full runs and cheap layers): each storm day carries `expected` grids and `expectedTornadoes`.
  - In the archives these match the dice: full runs make 23.0 tornadoes a day against 22.3 expected; cheap runs 23.0 against 22.3.
- **MD/watch members** (`runMesoscaleMember`): they carry the expected tornadoes and the expected strong (111 mph+) tornadoes per cell.
  - `areaOutcome` sums them inside the area. The new `tornadoChances` turns them into the chance of 2+ tornadoes, of a strong one and of any (Poisson, each run, averaged).
  - `assessArea` (watch type, tornado percent), `watchProbabilities` (tornado rows) and the PDS rule use them. With 4 runs the steps are no longer 25%.
- **`combineOutlook`** takes `OUTLOOK.ensemble`:
  - `expected`: each run's tornado chance from its expected tornadoes (`practicallyPerfectExpected` in truth.js).
  - `method: 'nmep'`: the share of runs with the hazard within 10 mi, each run's 0/1 from its reports or 1 − exp(−expected) nearby, smoothed once by `sigmaKm[day]`.
  - The run-agreement gates keep counting runs by their practically perfect chances.
  - **Both are off by default**; the measurements below explain why.
- **Scripts:**
  - `outlook-verify.mjs`:
    - `--jobs` (default 6);
    - `OUTLOOK_ENSEMBLE` and `OUTLOOK_CALIBRATION` env overrides, for scoring from an archive;
    - a "raw recalibrated in sample" score (the raw chance's resolution: the skill any calibration of it could reach);
    - the runs' expected tornadoes in section 5;
    - the practically perfect sums in `--calibration-data`.
  - `fit-outlook-calibration.mjs --target pp`: fit to the practically perfect chance instead of the 10-mile event.
  - `refit-from-archive.mjs --jobs`.

**Measured before any refit** (Day 1 = 8 + 24 runs; the installed table; fit seeds 1-6 and unseen 7-12, 2 mornings each, as in section 6. The new archives reproduce section 6's figures exactly.) Brier skill is given as raw / calibrated / issued, then "recal" (the raw chance recalibrated in sample):

| Day 1 | current | I2 (expected, pp) | I3 (nmep, 32 km, realised) | I2+I3 |
|---|---|---|---|---|
| tornado, fit 1-6 | 10/12/10, recal 12 | 5/9/6, recal 12 | 14/13/14, recal 15 | 11/12/10, recal 13 |
| tornado, unseen 7-12 | 11/13/10, recal 16 | 5/8/5, recal 15 | 17/15/15, recal 19 | 11/14/10, recal 17 |
| wind, fit | 30/35/27, recal 36 | same | 41/39/39, recal 41 | same as I3 |
| wind, unseen | 25/30/21, recal 33 | same | 39/38/37, recal 40 | same as I3 |
| hail, fit | 30/36/28, recal 37 | same | 44/42/41, recal 44 | same as I3 |
| hail, unseen | 33/37/28, recal 42 | same | 47/45/42, recal 47 | same as I3 |
| right / within one, fit | 83 / 100% | 92 / 100% | 0 / 92% | 8 / 100% |
| right / within one, unseen | 42 / 92% | 50 / 100% | 17 / 75% | 50 / 92% |
| CSI MRGN+/SLGT+/ENH+/MDT+, unseen | .90/.84/.57/.19 | .89/.86/.48/.23 | .83/.80/.57/.16 | .82/.81/.60/.21 |

Day 2, unseen, Brier skill raw/calibrated (current → I3): tornado 6/8 → 7/4, wind 18/23 → 27/28, hail 19/22 → 27/27.

The categories under I3 here use a table fitted for the old raw chance, so only the "recal" column is a fair comparison before a refit.

- **I2 gives no resolution.** The recalibrated tornado skill is unchanged or a little lower. Also tried: widening the expected field's reach by 1-2 cells, in case it was track length; no change (13%).
  - With 32 runs the touchdown draws already average out. What differs between runs is where rotating storms are, and the rate does not know that any better.
  - The expected-tornado grids stay in the members: they cost about 40 KB a run-day. The MDs use them (below).
- **I3 is a large gain for the probabilities:** hail and wind Brier skill rise by 10-15 points, and tornado by 2-6.
  - This answers O6. Each run's 120 km practically perfect field blurs a 10-mile chance far more than needed: Day 1 skill is best at 0-32 km of smoothing, and Day 2 at 32-48 km.

**The practically perfect truth (O6)** (tmp/i2i3/ppcheck.mjs, on the 12 archived days). It is scored here as a chance of the hazard within 10 mi:

| PP sigma | Brier skill tornado / wind / hail | wind reliability at its top bins | highest category of the day |
|---|---|---|---|
| 120 km (now) | 11 / 33 / 33% | 25 → 42, 37 → 61, 51 → 73 | SLGT 50%, ENH 42%, MDT 8% |
| 80 km | 16 / 41 / 41% | 25 → 36, 52 → 72 | SLGT 8, ENH 67, MDT 25% |
| 48 km (120 × 10/25) | 25 / 50 / 49% | 25 → 28, 52 → 68 | ENH 33, MDT 33, HIGH 33% |

- At 120 km the truth is a low, under-confident 10-mile chance, and is less skilful than the I3 outlook itself.
- Scaling σ with the radius makes it far more reliable, but it would move the verified categories sharply up. The category tables and the user's 40/40/15/5 aim were set against 120 km. So this is **a decision for the user**; it was not changed.

**Choosing a method with the full refit** (each fitted on seeds 1-30 and scored on unseen seeds 41-50, 30 mornings):

| Day 1, unseen 41-50 | pp (installed) | nmep 32/48 km | nmep 64/80 | nmep 96/112 |
|---|---|---|---|---|
| Brier skill calibrated tornado / wind / hail | 17 / 39 / 45% | 20 / 47 / 53% | 19 / 45 / 51% | 18 / 43 / 49% |
| right / within one | 63 / 93% | 33 / 83% | 40 / 90% | 53 / 93% |
| too high / too low | 7 / 30% | 63 / 3% | 50 / 10% | 37 / 10% |
| CSI ENH+ / MDT+ | .75 / .37 | .64 / .29 | .69 / .31 | .69 / .29 |
| Day 2 right / within one | 75 / 90% | 50 / 90% | 60 / 90% | 60 / 95% |

- A sharper chance calibrated to the 10-mile event issues contours above the 120 km truth's, so the categories lean high with every width. The same happened with the fit's target set to the practically perfect chance (`--target pp`: on the 12-day test, in sample, still 42-58% too high).
- So `pp` stays the method. NMEP is one setting away (`OUTLOOK.ensemble = { method: 'nmep', sigmaKm: { day1: 32, day2: 48 } }`) if the truth's σ is scaled with the radius. That would then also need a refit, and a new look at the category aim.

**The refit** (`refit-from-archive.mjs --chances-only`):
- Fit set: `tmp/i2i3/arch-all`, seeds 1-30. Seeds 1-12 have 2 mornings and 13-30 have 3: 84 Day 1, 54 Day 2 and 24 Day 3 outlooks.
- Check set: `tmp/i2i3/arch-check`, seeds 41-50 × 3 mornings.
- The Day 1, Day 2 and Day 3 tables were refit. `day1update` and CIG_SHARE were kept.
- The previous table is backed up as tmp/stepfix/outlookCalibration.before-i2i3.js (also in tmp/i2i3).

| unseen 41-50 | old table | refit |
|---|---|---|
| Day 1 right / within one | 60 / 97% | 63 / 93% |
| Day 1 Brier skill calibrated tornado / wind / hail | 17 / 38 / 44% | 17 / 39 / 45% |
| Day 1 CSI MRGN+ / SLGT+ / ENH+ / MDT+ | .85 / .82 / .75 / .35 | .87 / .84 / .75 / .37 |
| Day 2 right / within one | 60 / 90% | 75 / 90% |
| Day 2 Brier skill calibrated tornado / wind / hail | 8 / 15 / 21% | 10 / 19 / 24% |
| Day 3 right / within one | 20 / 90% | 20 / 90% (Slight on every day; 70% too low) |

- In sample: Day 1 right 60%, Day 2 48%, Day 3 29%.
- Reliability of the refit on the check set:
  - tornado tracks the diagonal: 18 → 19, 23 → 27, 29 → 32;
  - wind and hail run high at the top: wind 45 → 56 and 60 → 79, hail 60 → 80.
- The tornado CIG fit (printed, not installed) would draw Day 1 CIG1 from 2/8 of the runs and CIG2 from 3/8, and never CIG3.

**MDs and watches** (`mesoscale-report 1 --seeds 1-4`, against section 6's "after"):
- watch-probability Brier skill: 15% (15%);
- tornado watches: 21 (20); 81% met 2+ tornadoes or a strong one (80%), and 90% had a tornado;
- MDs saying a tornado watch is likely: 16 (14), with the tornado case met in 50% (57%);
- severe thunderstorm watches that met the tornado case anyway: 0% (5%).

This is neutral within the noise of 4 days. The tornado probabilities are now smooth instead of steps of 25%.

**Tests:** day-one-outlook, mesoscale-discussion, short-range-model and counties all pass.

**Left open**
- The O6 decision: scale the truth's PP_SIGMA_KM with the radius (and revisit the category aim), which would let NMEP go in.
- The refit is 84 + 30 mornings, not 200 + 50. With at most 6 worker processes a morning costs about 6.5 min of a worker, so 40 × 5 would take about 4.5 h.
- `day1update`: its tool (`outlook-updates-verify`) has no archive and runs its own members, roughly an hour for a useful sample. Still the old fit.
- Day 3 is still Slight on every day (I4).
- CIG_SHARE was not installed.
- The expected-tornado tiers use wind thresholds, while the truth rates tornadoes by damage. An expected damage rating would need a function from js/storms (an expected rated share); none is exported.

## 8. Done 2026-11-06: refit after E2 (one cold pool), and I3 with fitted category cutoffs

**New archives** (engine with E2, `js/storms/ColdPool.js`): tmp/refit2/arch, built with `outlook-verify.mjs --save` in one job of 6 workers (1 h 50 min). Fit seeds 1-30 (the same 84 mornings as section 7: seeds 1-6 × 2, 7-30 × 3); check seeds 41-50 × 3 (30 mornings).

**1. The refit** (`refit-from-archive.mjs --chances-only --install`; Day 1, 2 and 3 tables; `day1update` and CIG_SHARE kept). Previous file backed up as tmp/refit2/outlookCalibration.before-refit2.js.

| unseen 41-50 | table before (section 7) | refit (installed) |
|---|---|---|
| Day 1 right / within one | 70 / 90% | 70 / 90% |
| Day 1 too high / too low | 7 / 23% | 7 / 23% |
| Day 1 Brier skill calibrated tornado / wind / hail | 17 / 39 / 46% | 17 / 39 / 46% |
| Day 1 CSI MRGN+ / SLGT+ / ENH+ / MDT+ | .87 / .83 / .76 / .32 | .87 / .83 / .76 / .32 |
| Day 2 right / within one | 50 / 90% | 55 / 90% |
| Day 2 too high / too low | 15 / 35% | 15 / 30% |
| Day 2 Brier skill calibrated tornado / wind / hail | 10 / 20 / 25% | 11 / 20 / 25% |
| Day 3 right / within one | 20 / 80% | 20 / 80% (still Slight every day) |

- A small change: E2 moved the runs and the truth alike, so the old table was nearly right. In sample: Day 1 right 58%, Day 2 50%, Day 3 33%.

**2. I3 with category cutoffs** (the user's question: can the thresholds bring the high days back down once I3 is in?).
- `OUTLOOK.categoryCutoffs` (DayOneOutlook.js, **null by default**): for each day and hazard, the chance each contour level needs before it counts for the category. The contours and chances shown are unchanged.
- `scripts/fit-category-cutoffs.mjs` fits one factor per hazard and day (cutoff = level × factor, 0.8-3.0), to match the mix of the day's highest category to the verified mix on the fit seeds. Its data come from `outlook-verify.mjs --category-data`; `OUTLOOK_CUTOFFS` scores a set of cutoffs from an archive.
- Fitted with I3 (`nmep`, σ 32 / 48 km) and I3's own chances' table (refit on the same 84 mornings). Factors: Day 1 tornado 2.4, wind 2.15, hail 2.25; Day 2 1.6 / 1.7 / 2.0. So a level counts only at about twice its chance; for example, Day 1 hail 15% counts from 34% and 30% from 68%.
- Stored, not in use: `CATEGORY_CUTOFFS_NMEP` and `CALIBRATION_NMEP` in outlookCalibration.js.
- On the fit seeds the mix then matches: Day 1 forecast SLGT 29 / ENH 37 / MDT 20 / HIGH 6% against verified 29 / 33 / 23 / 6%.

| unseen 41-50 | refit, current method | I3 alone | I3 + cutoffs |
|---|---|---|---|
| Day 1 right / within one | 70 / 90% | 23 / 87% | 50 / 93% |
| Day 1 too high / too low | 7 / 23% | 70 / 7% | 27 / 23% |
| Day 1 MDT+ / HIGH days (verified 27 / 7%) | 13 / 3% | 43 / 27% | 23 / 0% |
| Day 1 CSI MRGN+ / SLGT+ / ENH+ / MDT+ | .87 / .83 / .76 / .32 | .80 / .76 / .67 / .31 | .71 / .66 / .56 / .09 |
| Day 1 map share at ENH+ (verified 18%) | 19% | 24% | 11% |
| Day 1 Brier skill calibrated tornado / wind / hail | 17 / 39 / 46% | 21 / 47 / 54% | 21 / 47 / 54% |
| Day 2 right / within one | 55 / 90% | 40 / 95% | 55 / 85% |
| Day 2 too high / too low | 15 / 30% | 40 / 20% | 15 / 30% |
| Day 2 MDT+ / HIGH days (verified 20 / 5%) | 0 / 0% | 15 / 0% | 0 / 0% |
| Day 2 CSI MRGN+ / SLGT+ / ENH+ / MDT+ | .76 / .70 / .45 / .00 | .76 / .68 / .43 / .08 | .72 / .57 / .34 / .00 |
| Day 2 Brier skill calibrated tornado / wind / hail | 11 / 20 / 25% | 12 / 23 / 29% | 12 / 23 / 29% |

- **The cutoffs fix the day counts, not the places.** The high days come back down (Day 1 too high 70% → 27%), but the day is still right less often than now (50% against 70%). Place by place the categories are worse than either (CSI MRGN+ .87 → .71, MDT+ .32 → .09): doubled cutoffs shrink every category area (ENH+ covers 11% of the map against 18% verified). The 120 km truth's areas are wide and smooth; the sharp chance is high in a small core and falls off fast, and no single threshold per level gives both the right peak and the right width.
- **The probabilities keep I3's gain** (the cutoffs do not touch them): Day 1 Brier skill +4 / +8 / +8 points.
- **What a player would see.** The category and the numbers on the map would disagree. On unseen Day 1s under I3 + cutoffs: Slight days with 60% wind and 91% hail areas, or 60% wind and 60% hail; Enhanced days with 88% wind and 96% hail; Moderate days with 98% wind. Under the centre's tables a 45% hail area makes Enhanced on its own; here it needs about 101%, so unhatched hail (or wind) can never make Enhanced on Day 1; only hatched hail from 68% can. The probability maps would be sharper and more honest (on unseen Day 1s I3's 57% verifies at 58% and its 87% at 87%, where the current method's 60% verifies at 80%), but the category legend would no longer follow from them as on the real SPC product.
- **Verdict:** not installed; the current method (`pp`) stays. Cutoffs are a patch over the O6 mismatch (sharp chance against a 120 km truth). The cleaner route stays the one in section 7: scale the truth's σ with the radius, then refit and revisit the 40/40/15/5 aim, so categories and chances agree again.

**To try it** (all three together): `OUTLOOK.ensemble = { method: 'nmep', sigmaKm: { day1: 32, day2: 48 } }`, `OUTLOOK.categoryCutoffs = CATEGORY_CUTOFFS_NMEP`, and the calibration `CALIBRATION_NMEP`.

**Tests:** day-one-outlook and mesoscale-discussion.
