# The short-range model: research and improvements (2026-11-05)

This is a research report; no code was changed. It looks at the HRRR-style "short range model" on the model page and asks how it could give useful, realistic guidance on storms (timing, placement, mode, updraft helicity, reflectivity, soundings) without large CPU or memory costs. The other three research jobs' findings are in docs/research/SHARED-FINDINGS.md; section 6 says where this report uses or differs from them.

## 1. Summary

- **What it is.** Every simulated hour, the model is a copy of the live engine stepped exactly as the server steps it.
  - For the first 3 hours it uses the live world's storm dice, so those hours are **a perfect copy of the truth**. A player who reads the model page knows, three hours ahead, exactly which storms will form, where they will be and which will make tornadoes.
  - After 3 hours it uses its own dice and nothing else differs. It then behaves like one member of a perfect-model ensemble: the environment is right, and the storm details are a fresh draw.
- **How that compares with real models.** Real convection-allowing models (HRRR, RRFS, WoFS) do the opposite:
  - Storms already on radar are known well for about an hour, through radar data assimilation.
  - New storms in hours 0-6 are the main source of error: when storms start, where, and how many.
  - Forecasters cope with this through neighbourhood probabilities, time-lagged ensembles, paintballs and updraft-helicity swaths, not single exact tracks.
- **The highest-value changes are nearly free:**
  1. **Stop sharing future dice.** Keep only the storms that exist at the start, which is what radar data assimilation would know. A test on seed 4 (from 18Z) gives a decay like Warn-on-Forecast's: of the truth's 40 dBZ storms, a model storm lies within 40 km of 9/12 at 1 h, 6/12 at 2 h and 4/12 at 3 h. Cost: zero. This reverses the user's 2026-10-28 choice, so the user must decide.
  2. **Time-lagged ensemble products from the 8 runs already kept** (HRRR-TLE): neighbourhood probabilities of UH ≥ 75, 40 dBZ and tornadoes, a paintball, and run-to-run trends. No server cost.
  3. **Three or four cheap storm-layer members each hour**, using the mechanism already built for the outlooks (`runOutlookMemberSet`'s cheap runs): about 0.4 s each for 18 h. This turns the page into an HREF/REFS-style guidance view.
  4. **Hourly-max storm-attribute products:** a proper 2-5 km UH estimate, 0-3 km UH, maximum updraft, hail, and gusts of 58 and 75 mph. These are kept as small per-hour grids (the outlooks job asked for these) or as track rows.
  5. **Forecast soundings:** about 0.3 MB per forecast hour, reusing js/sounding.js.
- **The 3-D cloud model** is too expensive to run inside the forecast. Its value here is **offline calibration** of the UH, reflectivity and hail diagnostics.
- **Cost today:** about 0.67 s of one thread per forecast hour, about 3% of a core at the 8x clock, and 70-80 MB for the runs kept. The recommended changes add under 10% CPU and a few MB.

## 2. How it works now

### Files and functions

| Piece | Where | What it does |
|---|---|---|
| Scheduler | server/ShortRangeRuntime.js, `ShortRangeRuntime.maybeRun/start` | Called from `issueProducts` (server/index.js:66). At each whole sim hour it takes `engine.saveState({ forecast: true })`, shares the bytes (`shareState`) and sends a `shortRange` job to the forecast pool. It keeps `SHORT_RANGE.keepRuns` = 8 runs and does not retry a failed hour. |
| Thread pool | server/ForecastPool.js, server/forecastWorker.js | Shared with outlooks and MDs. It uses a third of the cores (1-8 threads), keeps one thread free for urgent jobs, and holds about 450 MB per live thread. `forecastWorker` passes `fieldsOf`, which builds all 29 mesoanalysis fields (`MESOANALYSIS_PARAMETERS`). |
| Model | js/forecast/ShortRangeModel.js, `runShortRange` | Restores the world (`AtmosphereWorld.restore`) and sets `withoutStormPictures` and `fastTransforms`. It then loops in 0.5 h atmosphere steps, ticking storms every 5 min up to each step, as `WeatherAuthorityRuntime.stormTicksTo` does. From `shareHours` = 3 on, the seed is switched to `${seed}\|short-range\|${init}`. |
| Kept output | same file | `fields` (each hour, Float32 per parameter), `storms` (every 15 min, `stormRecord`: position, motion, mode, dBZ, hail, updraft, meso, UH, rain/hail/line appearance, tornado) and `tracks` (every 5-min tick, storms with UH ≥ 25 or a tornado). |
| UH | `updraftHelicity` | `updraughtMs × mesocycloneStrength × 0.003 × 3000`: a stand-in, not ∫w·ζ dz. |
| Routes | server/index.js:103-107 | `/api/models/short-range/{runs,run,field,storms,tracks}` |
| Page | js/pages/modelPage.js (models.html) | Simulated composite reflectivity drawn **in the browser** from the storm records (`stormDbz`, `reflRaster`: analytic rain-core, hook and line shapes plus noise). It also shows 1 h max and run-total UH tracks, tornado tracks and the 29 fields. The ensemble tab (outlook members) has a paintball, UH ≥ 75 and tornado chance within 25 mi, and spaghetti. **There are no soundings.** |
| Test | tests/short-range-model.mjs | Matches live storms for 0-3 h and differs afterwards. |

Lengths: 18 h each hour, 48 h at 00/06/12/18Z (`shortRangeHours`), as the HRRR does. The new RRFS runs 18 h hourly and 84 h every 6 h.

### What drives the forecast

- **The same engine.** The environment comes from the same QG, regional and steering stack, so it is deterministic. The only differences from the truth are:
  - the storm dice (initiation draws in `InitiationEngine.findInitiationCandidates`, which hash `world.evolution.config.seed` with hour and cell);
  - storm structure and evolution (`StormEngine.js:60,61,146`);
  - tornado draws and cycles (`TornadoEngine.js:101,225`);
  - what those storms then do back to the air (cold pools, processed air).
- **No perturbations.** No initial-condition, mesoscale or timing perturbations are applied: the user rejected forecast errors on 2026-10-28. The outlook members do carry them (ensemblePerturbation.js: `perturbUpstream`, `timingErrorMs`, `perturbMesoscale`).
- **Grid.** The environment grid is the engine's: **50 × 50 cells of 16.1 km** (805 km square). Storms are engine objects, not resolved updrafts, so "convection-allowing" products come from storm records, not from grid fields.

### Measured cost (scratch runs, seed 4)

Scripts are in C:/Users/alex1/.claude/jobs/f592f53b/tmp.

| Item | Measured |
|---|---|
| Spin-up of a fresh world | 18.7 s (not paid live: the run starts from a copy) |
| Saved forecast state | 14.4 MB (v8-serialised) |
| 6 h run from 16Z | 4.0 s; mesoanalysis fields take 91 ms of that |
| Per forecast hour | about 0.67 s, so 18 h ≈ 12 s and 48 h ≈ 32 s |
| Share of a core | 12 s per 450 s of real time per sim hour at 8x ≈ **3% of a core** (48 h runs ≈ 7%) |
| Kept fields | about 0.38 MB per forecast hour, so 7 MB per 18 h run, 19 MB per 48 h run, about 70-80 MB for 8 runs |
| Storm records and tracks | 6 h: 25 storm frames, 134 KB as JSON; 620 track points |
| Worker thread | about 450 MB while alive, let go after 30 s idle (shared with outlooks) |

### Weaknesses

1. **0-3 h is clairvoyant.** New storms, their order and their tornadoes are exact. That is unlike any real model, it takes the game out of reading guidance, and it leaks into anything built on the runs, including a time-lagged ensemble.
2. **After 3 h the error is only "different dice".** There is no systematic error, which real models always have, and none in the environment. The environment fields are exactly right at every lead time, so reading STP or CAPE on the model page is as good as the truth, but storms are a coin toss after 3 h. Real models are the reverse mix: environment errors grow with lead time, and storm placement errors are partly caused by them.
3. **Mismatch with the ensemble tab.** The ensemble shown beside it (the outlook members) has timing and mesoscale errors and can disagree with a short-range model that is always right in 0-3 h. Players will learn to trust only the short-range model.
4. **The UH stand-in.**
   - It uses peak updraft × meso strength. HRRR UH integrates grid-scale w·ζ over 2-5 km, where w is well below the storm's peak. 3 km grids also smooth both w and ζ, and 1 km grids give larger UH than 3 km ones (Sobash et al. 2019).
   - Measured on seed 4, track points with UH ≥ 25 had a median of 94, a 90th percentile of 153 and a maximum of 193. The memory notes record 200-400 on outbreak days.
   - The page uses HRRR thresholds (75 for a rotating storm), so the calibration matters.
5. **Reflectivity lives only in the browser.** The page's `stormDbz` is its own analytic shape, separate from the engine's radar picture. Nothing server-side (outlooks, MDs, verification) can use a model reflectivity field, and the page's 40 dBZ threshold is not tied to the engine's `radar.maxReflectivityDbz`.
6. **Missing products forecasters rely on:**
   - forecast soundings and hodographs;
   - hourly-max fields: 0-3 km UH, max updraft, hail size (HAILCAST), 10 m gust;
   - neighbourhood and time-lagged probabilities;
   - run-to-run trends ("dprog/dt");
   - verification.
7. **No verification.** The truth is available every minute, yet nothing scores the runs. A Brier score, fractions skill score (FSS) or object match would show players and the developer how good the guidance is.

## 3. Improvements

### 3.1 Initialise like radar data assimilation: keep present storms, not future dice

- **Real practice.**
  - The HRRR initialises existing storms through its hourly cycle and radar-reflectivity latent heating (Radar-LHI: temperature tendencies from 3-D reflectivity during the forward model step; Weygandt et al. 2022, Dowell et al. 2022). WoFS does the same with EnKF radar assimilation every 15 min.
  - What data assimilation cannot know is **future** convective initiation. CAM errors in the first hours are dominated by when and where storms start, by dryline and boundary placement, and by location more than timing (PECAN nocturnal CI threat scores about 0.3).
  - WoFS 0-3 h skill comes from storms already present; skill drops quickly for storms not yet formed.
- **What changes.** The minimal change is `SHORT_RANGE.shareHours = 0`: all storms that exist at the start are copied, as now, and the run's own seed is used from minute 0. A finer version splits the seed by process:
  - **initiation:** own seed from 0 h;
  - **tornado draws and cycles:** own seed from 0 h, since touchdown is not predictable beyond tens of minutes;
  - **evolution of existing storms:** live seed for about 0.5-1 h, then own.

  This needs one small hook: for example `world.forecastSeeds = { initiation, storm, tornado }`, read where the code now uses `world.evolution.config.seed` (InitiationEngine.js:77, StormEngine.js:60/61/146, TornadoEngine.js:101/225). The live world would not change, and fingerprint.mjs must match.
- **Evidence (seed 4, init 18Z, 10 storms at the start; tmp/share0.mjs).** "Hit" means a model 40 dBZ storm within 40 km of a truth 40 dBZ storm:

  | Lead | Existing storms within 5 km | Truth 40 dBZ storms hit within 40 km | Storms with UH ≥ 75 (truth / model) |
  |---|---|---|---|
  | 30 min | 10/10 | 9/9 | 6/6 |
  | 1 h | 9/10 | 9/12 | 6/6 |
  | 2 h | 7/14 | 6/12 | 3/8 |
  | 3 h | 4/14 | 4/12 | 1/3 |

  - Both tornadoes in the truth (S0010, S0015) were missed.
  - Seed 8181 at 20Z had no storms, and the model made one or two late that the truth did not.
  - This is one case. It needs 8 seeds before deciding, in the style of tmp/ens/hrrr-check.mjs.
- **Expected gain.** The model behaves like a real 0-3 h CAM: existing supercells' tracks are good for about an hour, new initiation is uncertain, and tornadoes become probabilities. It makes 3.2 and 3.3 meaningful. Chasers still get useful guidance, from where storms are now and where the environment favours new ones, but must read it.
- **Cost.** None. **Decision:** this reverses the user's 2026-10-28 choice. It adds no errors: it removes knowledge of the future that no model has.

### 3.2 Time-lagged ensemble products from the kept runs (HRRR-TLE)

- **Real practice.**
  - SPC and GSL built probabilistic thunderstorm and severe guidance from the last several hourly HRRR runs (HCPF from 2009; HRRR-TL in the Hazardous Weather Testbed Spring Forecasting Experiments).
  - In SFE2018 the time-lagged HRRR was often rated above the formal HRRRE initial-condition ensemble, though it has too little spread.
  - HREF includes the HRRR and its 6 h time-lagged run.
  - Products: neighbourhood maximum ensemble probability (NMEP) of 40 dBZ and of UH above a threshold within 25 mi (40 km), smoothed with a Gaussian of about 40 km (Schwartz et al. 2010, Sobash et al. 2011, Gallo et al. 2018); paintballs; "dprog/dt" trend views.
- **What changes.**
  - modelPage.js: an "Short range, time-lagged" model fetches `/tracks` and storm frames for the runs valid at a time, and reuses the ensemble tab's `probRaster`, paintball and spaghetti code.
  - Optionally a server route `/api/models/short-range/lagged?valid=` merging the tracks.
  - Weight newer runs more (Wade and Jirak's age-weighted HREF/HRRR-TL blend).
- **Expected gain.** Hour-by-hour probabilities of rotating storms and tornadoes for the next 12-18 h, refreshed hourly, and run-to-run trends that show whether the threat is moving or growing. The outlooks job wants exactly this for the Day 1 updates and MDs.
- **Cost.** Server: none. The page fetches up to 8 track sets (estimated 0.2-1 MB each as JSON for 18 h; can be quantised). **It depends on 3.1:** with shared dice every run equals the truth in its first 3 h, so the probabilities near the present would be 0 or 100%.

### 3.3 Cheap storm-layer members each hour (a light HRRRE/REFS)

- **Real practice.** HRRRE (36 members, 3 km) and now REFS, the HREF replacement. Ensembles at storm scale mostly sample initiation and storm-scale uncertainty. Storm-attribute fields from the members, smoothed UH above all, carry more skill than environmental fields for 0-3 h severe probabilities (WoFS random-forest study).
- **What changes.**
  - runShortRange carries N cheap storm layers. They copy the storms at the start and each gets its own seed (`…|short-range|init|cheap j`), moved through the control run's air exactly as `runOutlookMemberSet` does (DayOneOutlook.js:170-277).
  - Each layer keeps only tracks and storm records.
  - The page gets an "ensemble" view of the short-range run: NMEP of 40 dBZ, UH ≥ 75 and tornadoes, a paintball, and member-max UH.
- **Expected gain.** Real spread from the first hour without touching the environment. It goes with 3.1 and 3.2, which add spread across issue times. Outlook testing showed cheap layers score like full runs for severe weather and tornadoes (8 full + 24 cheap ≈ 32 full).
- **Cost.**
  - About 0.58 s per cheap layer per 24 h, so about 0.4 s per 18 h layer: 4 layers add about 1.6 s per hourly run (+13%).
  - Memory: tracks and storm records, about 0.2-0.5 MB per layer per run.
- **Limitation.** Cheap layers miss the feedback of their own storms on the air (they use the control's air). That is acceptable at this cost and was accepted for the outlooks.

### 3.4 Storm-attribute products, hourly max (UH, updraft, hail, wind)

- **Real practice.**
  - HRRR outputs hourly-max 2-5 km UH, 0-2 km and 0-3 km UH, max updraft and downdraft, 1 km reflectivity, HAILCAST hail and 10 m gust.
  - The surrogate-severe method (Sobash et al. 2011, 2016) treats UH above a threshold as a stand-in severe report and smooths it at 40 km. The thresholds depend on the model and resolution: for example, HREF used member-climatology percentiles because members built on the NMMB core run higher. Sobash 2016 used UH25, UH03 and 1 km vorticity as tornado surrogates.
- **What changes.**
  1. **Make UH estimate the HRRR's.** Replace `updraftHelicity` with an estimate of ∫₂⁵ w ζ dz on a 3 km grid:
     - mean 2-5 km w as a share of peak (about 0.4-0.6);
     - ζ from `mesocycloneStrength`, smoothed to 3 km.

     **Fit both against the cloud model** (3.7). Then set the page's 25/75/150 thresholds on the fitted values, or use percentiles of the model's own climate, as HREF does.
  2. **Add 0-3 km UH** from `lowRotation` (the tornado surrogate, Sobash 2016), a max updraft field, hail size (`currentHailSizeInches`, already in records) and the storm gust (`storm.surfaceWind.gustMph`).
  3. **Grids for the outlooks and MDs** (the outlooks job asked for these): per forecast hour on the 50 × 50 grid, max UH within 10 mi plus 0/1 masks for tornado, hail ≥ 1 in and ≥ 2 in, and gusts ≥ 58 and ≥ 75 mph. Built in `keepTracks` from the 5-min ticks (a max over the hour). Alternatively, add `hail` and `gust` to the track rows and grid them where needed.
  4. **Move `stormDbz`/`reflRaster` into a shared module** (js/forecast) so the server can make the 40 dBZ masks the probabilities need. Better still, use the engine's own radar footprint (`buildStormAppearance` rain/hail/line, which the records already carry), so the model reflectivity, the live radar and the 40 dBZ test agree.
- **Expected gain.** UH and hail values that mean what they mean on Pivotal Weather, hazard-specific guidance (tornado vs hail vs wind) for chasers and products, and the inputs the outlooks job wants.
- **Cost.** Microseconds per storm per tick. The grids: 6-7 grids × 2,500 cells per hour = 15-60 KB per hour as Uint8/Float32, so ≤ 1 MB per 18 h run.

### 3.5 Forecast soundings

- **Real practice.** Forecasters lean heavily on HRRR and RAP forecast soundings (BUFKIT, SHARPpy, Pivotal's clickable soundings). They read cap erosion timing, LCL, hodograph shape and nighttime low-level jet growth. Near storms these soundings are "contaminated" by the model's own convection, and forecasters know to look upstream.
- **What changes.**
  - In `keepFields`, keep per cell the inputs `buildSounding` reads:
    - surface p, T, Td and wind;
    - T, Td, direction and speed at 850, 700 and 500, plus T and wind at 250;
    - `jetNose`;
    - `features.emlBaseExcessC` and `emlInfluence`;
    - terrain.

    That is about 31 Float32 per cell.
  - A route `/api/models/short-range/sounding?init&hour&row&col` returns `buildSounding` + `diagnoseSoundingDisplay`, like `/api/live/sounding`.
  - The page opens the existing `drawSounding`/`drawHodograph` (js/sounding.js) on a click.
- **Expected gain.** The single most-used forecaster tool, and it suits a chase game: "will the cap break by 21Z here?" With 3.1, the soundings stay truthful about the environment while storm placement is not, which is roughly how real HRRR soundings are used.
- **Cost.** About 0.31 MB per forecast hour. That is +5.6 MB per 18 h run and +15 MB per 48 h run, so about +50-60 MB for the 8 runs kept. Ways to cut it:
  - keep hourly soundings only for the newest 2 runs;
  - after 18 h keep them 3-hourly;
  - quantise to Int16 with fixed scales.

  Each halves the memory or better. CPU is negligible: the fields are already computed.

### 3.6 Verify against the truth, on the page and in tests

- **Real practice.**
  - Object-based (MODE) and neighbourhood scores (FSS, Brier, reliability) through METplus.
  - The HWT SFE subjective ratings.
  - SPC's surrogate-severe verification against reports.
- **What changes.**
  - ShortRangeRuntime scores each finished run as the live world catches up:
    - FSS for 40 dBZ at 40 km;
    - storm-object hits and centroid errors;
    - UH-surrogate Brier and reliability against the engine's own reports and tornadoes (the 25 mi neighbourhood);
    - bias of storm count and area.
  - A small "how good was the last run" panel on the page.
  - A test (tests/short-range-model.mjs or a tmp script) over 8 seeds to check 3.1-3.4.
- **Expected gain.** Tuning by numbers, and players learn how far to trust it. It is the honest way to show a forecast is "useful but not a copy".
- **Cost.** One pass over storm lists per hour, a few ms. Storage under 1 KB per run.

### 3.7 What the 3-D cloud model can and cannot do here

The facts (docs/cloudlab/STATUS.md, memory notes; costs for C/WASM):

- 64 × 64 × 33 box at 1 km, plus the 250 m nest; box + nest about 127 ms per step at dt 6 s.
- About 17% of a core at 8x, so about 75 s of CPU per model hour per storm.
- About 110 MB per mature nested storm.
- The engine is the authority: the model only shows the engine's storms, and its lift, hail and tornado are steered toward the engine's values.

| Option | Verdict | Cost |
|---|---|---|
| Whole-map coarse CAM, e.g. 3 km over 805 km (268 × 268 × 33 ≈ 17× the box's cells, dt about 18 s) | **No.** Hours of CPU per forecast hour, and it would fight the engine, which decides storms. | about 30-60 min CPU per forecast hour |
| A box per forecast storm (WoFS-like) | **No.** About 15 storms × 18 h × 75 s ≈ 5.6 core-hours per hourly run, and its storms are steered by the engine's own forecast anyway. | as stated |
| 0-1 h look-ahead of the one storm being chased: fork the live worker's state and run 60 model minutes ahead | **Possible but low value.** It would forecast the *look* of a storm whose behaviour the engine decides. Engine and model can disagree, which players would see as a wrong forecast with no physical reason. | about 75 s on a spare thread per look-ahead, plus about 110 MB |
| Seeding the short-range model's storms from the cloud model | **No.** Storms near players would then follow different statistics from the forecast runs; see the coupling job's warning in SHARED-FINDINGS. | — |
| **Offline calibration of diagnostics** | **Yes.** Use paired samples (engine storm state → model fields coarsened to 3 km): true 2-5 km UH (∫w·ζ dz), 0-3 km UH, max w, a 1 km and composite reflectivity footprint (Kessler/qh → Z), and the ground hail stone size. Fit `updraftHelicity` and the 40 dBZ footprint from them. This makes the page's numbers physical, not chosen. | zero live; a few hours of offline runs (synccheck.mjs already pairs engine and model storms) |

### 3.8 Optional: physically sourced model error (a "fraternal twin")

- **Real practice.**
  - In observing-system simulation experiments (OSSEs), forecasting a nature run with the same model (an "identical twin") is known to be **too optimistic**. The minimum accepted practice is a "fraternal twin": the same model type in a clearly different configuration (Hoffman and Atlas 2016; Halliwell et al. 2014).
  - Real CAMs carry systematic biases forecasters learn:
    - too many storms and too much storm area (HRRRv4 up to 66% more storm objects than HRRRE in 2020 cases; RRFS +40-60% area);
    - overforecast high-intensity objects;
    - too slow with timing in weakly forced, high-CAPE/low-shear cases;
    - too little upscale growth in RRFS and HRRR, with warm cold pools in HRRR;
    - underestimated extreme SRH in WoFS;
    - dryline placement errors tied to PBL schemes (MYNN eastward errors).
- **Options that are physics choices, not painted noise:**
  - The forecast uses literature-valid but different settings: a different Kain-Fritsch trigger threshold, initiation rate or subgrid lift spread (InitiationEngine.js constants have ranges in their own comments), or a different cold-pool strength.
  - A cycling analysis: analyse each hour from "observations" (town surface stations, 00/12Z soundings, radar storms) onto the previous run's 1 h forecast by Barnes/optimal interpolation (OI), as RAP/HRRR cycle. In this game the background differs from the truth only where storms changed the air, so the analysis would miss outflow boundaries and cold-pool edges between stations. That is a realistic and well-known HRRR failure. Cost: under 10 ms per hour on 2,500 cells, plus keeping the previous run's 14 MB state.
  - Reusing `perturbMesoscale` for the short-range model: already calibrated and accepted for the outlooks.
- **Expected gain.** Biases players can learn ("the model is often too early on the dryline"), a better match with the ensemble tab, and realism.
- **Risks.** The user explicitly rejected forecast errors for this model. Badly chosen biases could send chasers wrong systematically. Only after 3.1-3.6, with verification (3.6) in place, and only if the user wants it.

### 3.9 Housekeeping that saves memory

- **Quantise kept fields** to Int16 with the parameter's `decimals`: halves about 70-80 MB.
- **Thin 48 h runs to 3-hourly** after F018, as Pivotal shows extended HRRR.
- **Keep fields only for the parameters the page shows.**
- **Keep the 5-min storm stepping.** The outlooks job found that outlook and MD members step storms in 30-min blocks and lose about half their tornadoes; this model steps correctly and should stay that way.
- **A different idea, not recommended without tests:** a 15-min storm tick after F006, which would roughly halve the storm-layer cost. It changes storm statistics; see that finding.

## 4. Recommended order of work

| # | Step | Why first | Cost | Needs the user? |
|---|---|---|---|---|
| 1 | 3.1, after an 8-seed test of shareHours 0 vs 3 with split seeds | It removes the clairvoyance, and everything probabilistic depends on it | zero | **Yes** (reverses the 2026-10-28 choice) |
| 2 | 3.4 grids and track fields (max UH within 10 mi; tornado, hail and gust masks), shared reflectivity module | The outlooks job's inputs; cheap | ≤ 1 MB/run | no |
| 3 | 3.2 time-lagged products on the page (NMEP, paintball, trends) | Free guidance, and the core HRRR-TLE practice | page only | no |
| 4 | 3.5 forecast soundings | The most-used forecaster tool | +5-15 MB/run (less if quantised) | no |
| 5 | 3.6 verification panel and test | Keeps 1-4 honest; guides tuning | ms | no |
| 6 | 3.3 cheap storm-layer members (start with 4) | Real ensemble spread each hour | +13% CPU | no |
| 7 | 3.7 offline UH, reflectivity and hail calibration from the cloud model | Makes thresholds physical; needs coupling-job samples | offline | no |
| 8 | 3.9 memory trims | Only if memory gets tight | — | no |
| 9 | 3.8 fraternal-twin or cycling error | Only if the user wants learned biases | small | **Yes** |

After steps 1-6 the short-range model would cost about 3.5% of a core and about 100 MB. That stays within the budgets the other jobs posted: outlook issues of 8 × 16 s plus cheap layers, and MDs of 4 × 3 s per hour.

## 5. Sources

- Dowell, D. C., et al., 2022: The High-Resolution Rapid Refresh (HRRR): an hourly updating convection-allowing forecast model. Part I. *Weather and Forecasting* 37, 1371-1395. https://repository.library.noaa.gov/view/noaa/55036
- Weygandt, S. S., et al., 2022: Radar reflectivity-based model initialization using specified latent heating (Radar-LHI) within a diabatic digital filter or pre-forecast integration. *Weather and Forecasting* 37, 1419-1434. https://publications.gsl.noaa.gov/articles/2079
- Dowell et al.: radar assimilation in the RR/HRRR (conference). https://ams.confex.com/ams/14Meso15ARAM/webprogram/Handout/Paper191233/073_dowell.pdf ; https://ams.confex.com/ams/35Radar/webprogram/Paper191919.html
- HRRR v3/v4 object-based verification and storm-attribute biases. https://repository.library.noaa.gov/view/noaa/60237 ; https://repository.library.noaa.gov/view/noaa/61120 ; https://publications.gsl.noaa.gov/articles/2140
- MPAS/RRFS/HRRR storm frequency, cold pool and CAPE biases (WAF-NWP 2023 poster). https://ams.confex.com/ams/WAFNWPMS/webprogram/Handout/Paper425096/POSTER_MPAS_WAF-NWP-2023.pptx.pdf
- Wade, Jirak and Lyza: CAM near-surface biases. https://origin-east-www-spc.woc.noaa.gov/publications/wade/cambias.pdf ; HREF/HRRR blending: https://origin-east-www-spc.woc.noaa.gov/publications/wade/cam-nstm.pdf
- Albany NWS: HRRR/NAM-nest timing biases. https://www.weather.gov/media/aly/LocalResearch/Online%20LocalResearch/Local_Severe/MikeMain_CAMS_NROWPresentation.pdf
- Older HRRR warm/dry bias and DA timing (WRF workshop 2015). https://www2.mmm.ucar.edu/wrf/users/workshops/WS2015/ppts/2.3.pdf
- HRRR time-lagged ensemble: Jirak SLS 2018 poster https://ams.confex.com/ams/29SLS/webprogram/Handout/Paper348703/jirak_sls18_hrrr-tle_poster.pdf ; HCPF https://ams.confex.com/ams/23WAF19NWP/webprogram/Paper154254.html ; DTC HRRR-TLE https://dtcenter.org/sites/default/files/events/2016/postprocessing/HRRR_TLE_PP_RUA.pdf
- Roberts et al. 2020: WoFS vs HRRR-TL in the SFE. https://ams.confex.com/ams/2020Annual/webprogram/Handout/Paper368157/ams20-roberts-wofshrrrtl.pdf
- Gallo et al. 2018: HREF configurations, NMEP and UH surrogate severe. https://ams.confex.com/ams/29SLS/webprogram/Handout/Paper348791/sls18-galloetal-hrefconfigs.pdf
- METplus surrogate-severe recipe (Sobash et al. 2011 method). https://metplus.readthedocs.io/en/latest/generated/model_applications/short_range/GenEnsProd_fcstHRRR_fcstOnly_SurrogateSevere.html
- Sobash et al. 2016: explicit forecasts of low-level rotation for next-day tornado prediction. https://data.ucar.edu/dataset/ba61c2a6-8633-44c7-8c21-877d8db85ce6 ; Sobash et al. 2019: 1 km vs 3 km tornado surrogates https://ckanprod.data-commons.k8s.ucar.edu/dataset/87549f8f-5700-4bd6-a2f5-508b8f14ad31 ; workshop slides https://ral.ucar.edu/sites/default/files/docs//thursday-cpm-workshop-sobash.pdf
- WoFS machine-learning 0-3 h probabilities (storm attributes beat environment). https://dtcenter.org/node/2516 ; WoFS/WoF-Hybrid https://par.nsf.gov/biblio/10656708 ; https://repository.library.noaa.gov/view/noaa/45383
- RRFS/REFS. https://gsl.noaa.gov/rrfs ; https://gsl.noaa.gov/rrfs/rrfsv1/ ; https://www.weather.gov/media/wrn/calendar/RRFS_webinar_20260625.pdf
- OSSE identical vs fraternal twins. https://www.aoml.noaa.gov/phod/docs/Halliwell_2014.pdf ; https://ntrs.nasa.gov/api/citations/20160010369/downloads/20160010369.pdf ; https://www.emc.ncep.noaa.gov/research/JointOSSEs/forums/IdenticalTwinOSSE.070604.doc
- CI and dryline errors in CAMs: Clark et al. 2015 https://twister.caps.ou.edu/papers/ClarkEtal_WAF2015.pdf ; Coniglio et al. 2010 https://twister.caps.ou.edu/papers/Coniglio_Etal_WAF2010.pdf ; PECAN nocturnal CI https://repository.library.noaa.gov/view/noaa/65050/noaa_65050_DS1.pdf
- Project: js/forecast/ShortRangeModel.js, server/ShortRangeRuntime.js, js/forecast/DayOneOutlook.js (cheap runs), js/storms/InitiationEngine.js, js/sounding.js, js/pages/modelPage.js, docs/cloudlab/STATUS.md, docs/research/SHARED-FINDINGS.md.

## 6. Where this report uses or differs from the other jobs

- **Outlooks, MDs, watches**
  - *Used:* their request for a time-lagged ensemble and per-hour hazard grids (3.2 and 3.4 step 3). I agree the short-range model's 5-min stepping must stay.
  - *Added:* their time-lagged ensemble is clairvoyant in each run's first 3 h unless 3.1 is done.
- **Engine-model coupling**
  - *Agreed:* the cloud model has no forecast skill about engine storms, and feedback into the engine should be limited to placement and timing. Otherwise forecast runs, which never run the cloud model, miss near players.
  - *Asked:* paired engine-state → model-diagnostic samples for the UH and reflectivity calibration (3.7).
  - *Noted:* their proposed engine changes (CIN-based maintenance, ECAPE updraughts, earlier Bunkers motion) would change what this model forecasts automatically, because it runs the same engine. An ECAPE field would be a cheap addition to the kept fields.
- **Visuals:** no findings had been posted when this report was written.
