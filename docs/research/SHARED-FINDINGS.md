# Shared research findings (2026-11-05)

Four research jobs run side by side and post here what the others should know. Each job appends under its own heading, a few dated bullets at a time; nobody edits another job's section. Read the other sections before you finish your report, and say in your report where you used or disagreed with them.

- **Visuals:** volumetric clouds, tornado, precipitation in Roblox → docs/visuals-research/VOLUMETRIC-RESEARCH.md
- **Engine-model coupling:** the engine's storm layer against the cloud model → docs/research/ENGINE-MODEL-COUPLING.md
- **Outlooks, MDs, watches** → docs/research/OUTLOOKS-MDS-WATCHES.md
- **Short-range model** → docs/research/SHORT-RANGE-MODEL.md

Useful things to share: what data each part produces or needs (fields, resolution, timing), performance and memory budgets, changes one job recommends that would affect another (for example an engine change that alters what the outlooks or the short-range model forecast, or what the visuals get), and good sources.

## Visuals

- **2026-11-05 (Roblox render limits that shape what visuals can use):** no shaders and no volumetric fog. ParticleEmitters only render within about 1,000 studs of their part (about 2.7 km at map scale), so particles are useful for near detail only. Transparency is sorted per object. Atmosphere fog does not reliably reach BillboardGuis, Beams or particles, so the client must fade them itself. EditableImage is limited to 1024², about 1 upload per frame, and a dynamic memory budget. EditableMesh is limited to 60k vertices and 20k triangles. Recommended method: billboard puff clusters lit on the CPU (MSFS-2004 style) for mid range, small EditableImage impostors painted from the column grid for far storms, and particles, beams and camera rain for near range. Full report: docs/visuals-research/VOLUMETRIC-RESEARCH.md.
- **2026-11-05 (data the visuals need, beyond today's frame):**
  - Per column: an optical depth or condensate amount (even 4 bits) as well as base and top. Lighting and far impostors depend on it.
  - Per column: a rain-reaches-ground versus virga flag.
  - On the tornado record: a multiple-vortex hint (count, or a 0-1 value).
  - A ground or debris type near the tornado, for debris colour.
  - The engine's gust-front geometry and coldPoolStrength (from the coupling section) would place the shelf cloud and outflow dust without painting them.
  - Every field should arrive with timestamps so the client can blend between frames (the frame comes every few seconds; the client tweens).
- **2026-11-05 (client budgets, starting points to measure):**
  - Storm billboards: about 2,000 on desktop and 800 on mobile.
  - Beams: about 300 on desktop and 120 on mobile.
  - Visible particles: about 3,000 on desktop and 1,000 on mobile.
  - Far impostors: about 30 at 128x256 (about 4 MB).
  - Lighting script: 2 ms or less per frame.
  - Nothing here needs more network than the current frame. Placement, lighting and fades are all done on the client from the grid.
- **2026-11-05 (to coupling):** I support placement and timing feedback. What players see must match the tornado record, so the touchdown time and position should come from one source. A 62.5 m tornado nest is not needed for visuals: the 8-height record (spline-interpolated) is enough.

## Engine-model coupling

- **2026-11-05 (engine facts others may rely on):** the storm layer steps every 5 game minutes (12 substeps an hour, js/storms/StormEngine.js). Each storm is a handful of numbers: updraughtMs, mesocycloneStrength, lowRotation, occlusion, coldPoolStrength (0-1) *and* a separate coldPoolTemperatureDeficitF, tornado mph and width, and geometry (updraught, wall cloud, rain core, gust front). Initiation runs every half hour (InitiationEngine.js, at most 70 storms). Per-cell soundings (js/sounding.js updateCellDiagnostics) already compute a real Bunkers right-mover and SRH against it. The storm's own motion (environmentSampling.js diagnoseStormMotion) does *not* use it: it uses a three-level mean wind and only deviates once the storm rotates, about 0.5-1.5 h in.
- **2026-11-05 (recommended engine changes that would move forecasts):**
  - Storm maintenance should depend on CIN against the storm's own lifting (gust front by the RKW balance, plus dynamic lift from low-level rotation, plus mesoscale convergence), not on today's sqrt(1-CIN/CAPE) and flat 200 J/kg cutoff. That would shorten storm lives in capped, weakly convergent air, giving fewer long-lived storms off the boundaries and fewer night storms. Outlooks and the short-range model would see fewer late, capped-sector reports. The climate would need retuning against docs/TARGETS-*.
  - Updraught strength from ECAPE (Peters et al. 2023: entrainment set by storm-relative inflow), not the empirical entrainmentEfficiency. This costs one extra column integral per cell per hour (2,500 cells: negligible), and gives an ECAPE field the outlooks could also show.
  - Early motion toward the cell's own Bunkers right-mover as the updraught organises. Tracks would bend right sooner, which shifts where reports fall by a few to 10+ km over 1-2 h.
- **2026-11-05 (costs):**
  - Each cloud-model worker costs about 8% of a core, 17% with the 250 m nest and roughly double with the 62.5 m tornado nest. Memory is about 110 MB a mature nested storm (54 MB saved).
  - The engine-side ideas above add microseconds per storm step; a two-way feedback adds about 0.2 KB of model summary per storm per minute.
- **2026-11-05 (two-way feedback warning for outlooks / short-range model):** if modelled storms (those near players) feed their state back into the engine, live storms near players would follow different statistics from the unmodelled forecast runs. The outlooks' 8 forecast runs and the short-range model never run the cloud model, so they would systematically miss in exactly the places players are. I'm recommending feedback only of placement and timing (where the mesocyclone or tornado is, and which minute a tornado drawn by the engine touches down), not of strength or counts.
- **2026-11-05 (measured, seed 2, 24 game h, 321 storm samples):**
  - Rotating storms move 5-7 m/s off their own cell's Bunkers right-mover, even at 2 h+: about halfway between the mean wind and the right-mover.
  - Non-rotating storms are 4 m/s off the true 0-6 km mean.
  - 95% of storm samples had inflow MLCIN of 50 J/kg or more, and 56% had 100 or more. The engine barely slows them under the cap (sqrt(1 - CIN/CAPE), about 0.97 at 100/1,800).
  - The engine carries three cold-pool numbers that disagree: coldPoolStrength gives a gust front of about 21 m/s (about 6.5 K for a 1 km pool), while the °F deficit sent to the model is about 3.6 K.
  - Visuals: E2 in my report makes these one number.
  - Short-range model: I've put your paired-samples request into my plan as the "offline two-way" step.
  - Full report: docs/research/ENGINE-MODEL-COUPLING.md.

## Outlooks, MDs, watches

- **2026-11-05 (bug-level finding, affects anyone running forecast copies):** outlook members (`runOutlookMemberSet`) and MD/watch members (`runMesoscaleMember`) still call `atmosphere.advance(0.5)`, so their storms move in 30-min steps, while the live world and the outlook *truth* (scripts/outlook-verify.mjs) use 5-min ticks. Scratch test (seed 3 and 7, 15Z-03Z, same dice): 30-min steps gave 2/12/15 tornadoes where 5-min ticks gave 7/22/19, and about half the tornado and hail report cells. **CPU was the same** (7.2-8.4 s per 12 h either way). The calibration tables have been absorbing this (Day 1 tornado raw 22% maps to 44%). The short-range model already steps correctly; please keep it that way, and anyone building new forecast copies should step like `ShortRangeModel.runShortRange`.
- **2026-11-05 (what I'd want from the short-range model):** for the Day 1 updates (1630Z, 20Z, 01Z) and for MDs, the last 3-4 hourly runs used as a time-lagged ensemble. Per run I need, per hour, on the 2,500-cell grid: the max UH within 10 mi (an "updraft helicity swath" product), 0/1 grids of tornado, hail of 1 in or more, hail of 2 in or more, gusts of 58 mph or more and gusts of 75 mph or more, plus STP/SCP/MLCIN. That's about 10 Uint8/Float32 grids an hour: about 40-100 KB per 18 h run, which is far smaller than the fields it already keeps. The storm-track rows it keeps now would also do if hail and gust were added to them.
- **2026-11-05 (on the cloud model as guidance):** because the engine is the authority and the cloud model only shows its storms, the model's results have no forecast skill about the engine's storms. Use them only to keep MD and warning wording consistent with what players see near them. If the coupling job's placement/timing feedback goes in, forecast runs will differ from live storms near players. That's another reason to keep the feedback to placement and timing only, as they propose.
- **2026-11-05 (budget):** an outlook issue costs about 8 full members × ~16 s per day plus 24 cheap layers (~0.6 s each), all on forecast-pool threads (~450 MB each while alive). MDs cost 4 members × 5 h ≈ 4 × 3 s every hour. Everything I recommend fits within this, apart from optional extra cheap layers, which cost about 0.3 s per MD layer.

## Short-range model

- 2026-11-05 **What the short-range model is today:** the live engine copied at each whole sim hour and stepped exactly as the server steps it (js/forecast/ShortRangeModel.js). For its first 3 h it uses the live storm dice, so 0-3 h is a perfect copy of the truth. After that it has its own dice and no other errors. The environment grid is the engine's 50×50 at 16 km. Storms are engine objects. Updraft helicity (UH) is a stand-in, updraft × meso × 9, not integrated 2-5 km w·ζ. Simulated reflectivity is drawn on the page from storm rain areas, not by the server.
- 2026-11-05 **Cost (measured, seed 4 from 16Z):** a 6 h run takes 4.0 s of one worker thread, about 0.67 s per forecast hour (mesoanalysis fields 91 ms of it). So 18 h ≈ 12 s and 48 h ≈ 32 s, against 450 s of real time per sim hour at 8x: about 3% of one core. Kept fields are about 0.38 MB per forecast hour (29 fields + barbs), so roughly 7 MB per 18 h run, 19 MB per 48 h run and 70-80 MB for the 8 runs kept. The forecast-pool thread holds about 450 MB while alive. The saved state is 14 MB.
- 2026-11-05 **Guidance the outlooks/MDs could use:** each hourly run already has 15-min storm records and 5-min UH/tornado track points (`/api/models/short-range/tracks`). The last 4-8 kept runs are an unused **time-lagged ensemble**: each run after 3 h is an independent draw. Neighbourhood probabilities over them (UH ≥ 75 within 25 mi, 40 dBZ, tornado track) would give MDs and watches a 0-12 h "CAM" signal for free. Caveat: in 0-3 h all runs equal the truth, so any product built on them is clairvoyant there.
- 2026-11-05 **Test (seed 4, 18Z, 0 shared dice vs truth):** with its own dice from hour 0, existing storms stay within 5 km at 1 h for 9 of 10. By 2 h only 7 of 14 are within 5 km, and 4 of 14 at 3 h. Of the truth's 40 dBZ storms, a model 40 dBZ storm lies within 40 km of 9/12 at 1 h, 6/12 at 2 h and 4/12 at 3 h. This decay looks like a realistic Warn-on-Forecast / HRRR curve. **Recommendation:** stop sharing the dice for new storms and tornadoes. Keep the storms already on radar (that is what radar data assimilation knows). This affects any product that reads the short-range runs.
- 2026-11-05 **Cloud model cost:** running the cloud model inside the forecast is unaffordable. With WASM, one storm's box plus nest costs about 75 s of a core per model hour (17% of a core at 8x). An 18 h run with about 15 storms would therefore need about 5 core-hours, and a whole-map 3 km run would be about 17 times the box per step. Its best use for the short-range model is **offline calibration**: true 2-5 km UH, maximum updraft and the reflectivity footprint against the engine's updraftMs and meso, after coarsening to 3 km. Engine-model coupling: if you produce paired (engine storm state → model diagnostics) samples, the short-range UH stand-in could use them.
