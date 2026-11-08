# The plan after the research (2026-11-05)

> **2026-11-06, proposed:** take the cloud model out of the game and move its physics into the engine (docs/research/ENGINE-PHYSICS-PLAN.md). If you approve it, it replaces stage 1's T1 + X1 and the model-side parts of stage 2.

Built from the four reports:
- docs/visuals-research/VOLUMETRIC-RESEARCH.md
- docs/research/ENGINE-MODEL-COUPLING.md
- docs/research/OUTLOOKS-MDS-WATCHES.md
- docs/research/SHORT-RANGE-MODEL.md

It also uses their shared notes (docs/research/SHARED-FINDINGS.md). Each step keeps the standing rules: fields, not painting; short verification; regression baseline before and after engine batches; C and Luau stay identical.

## The big picture

- **The engine stays the authority.** All four reports agree on this. The cloud model only shows the engine's storms.
- **Feedback from the model into the engine is limited to placement and timing:**
  - where the mesocyclone or tornado sits;
  - which minute a tornado the engine has drawn touches down.
- **Strength and counts never feed back.** Forecast runs never run the cloud model, so if strength or counts came back, the world near players would drift from what the outlooks and the short-range model forecast.
- **Most of the nudging comes from the engine breaking its own rules, not from model errors.** Under a cap, the engine keeps storms alive almost for free. Storms move by a mean-wind rule even though the engine already computes the Bunkers right-mover. The engine carries three cold-pool numbers that disagree. Making the engine consistent with itself is cheap, and it shrinks the push and pin.
- **True volume rendering is impossible in Roblox,** because it has no shaders and no volumetric fog. The new visuals are soft billboard puffs lit by script, cheap painted "impostor" cards for far storms, and near-only detail.

## Stage 0: finish what is in progress (now)

1. **Vortex flicker.** Measured on SupercellLife with a forced 85 mph tornado, three fixes so far:
   - the 250 m nest follows the 62.5 m nest while that nest holds a vortex;
   - no tether snap while a tornado is held;
   - the tornado push steers by the gust 2 model minutes ahead (`TOR_LEAD`).

   Together they take the run from 20/36 minutes within 25% of the engine's wind, 1 collapse and 4.9 km maximum ground jumps, to 29/36 minutes, no collapses and a 0.66 km maximum jump.

   Still to do:
   - confirm on SupercellB at 110 mph;
   - port TOR_LEAD to EngineRun.luau;
   - parity check and tests (cloudmodel-restore, storm-workers, tornado-frame).

   This is the coupling report's T2, done early.
2. **Game-scale cloudlab in Studio.** Restart the play test and check the tornado at game size: default view, orbit left and right, far, and from under.

## Stage 1: engine and model agree (cheap; mostly model-side or self-consistency)

In order, each step with a quick test first:

1. ~~**E1: storm motion from the cell's own Bunkers vector.**~~ **Dropped after its test (2026-11-05).** The test script is tmp/motionab.mjs. It tracked the model storm's own ground track (frame travel, plus box shifts, plus the 5 km updraught in the box) against the engine's storm and the cell's Bunkers right-mover.
   - On seed 2's supercells, 2 of 3 model storms moved closer to the engine's motion than to the right-mover (off the engine by 3.4, 1.6 and 4.2 m/s; off the right-mover by 4.4, 3.4 and 2.0).
   - Moving the box at the right-mover made it chase its storm 4-5 times more for those two storms (1.7 → 8.2 and 3.1 → 11.8 km/h).
   - Seed 8181's two weak storms were mixed.
   - Survey 2026-11-06, seeds 5150, 7 and 42, 3 storms each over 3 h (both box motions per storm). With the box moving like the engine's storm, the model storm stayed closer to the engine's motion in 7 of 9 (one a near-tie) and drifted less from the engine's storm in 7 of 9. A Bunkers-moving box often put it 40-118 km off the engine's storm in 3 h. Box chasing was mixed (the engine frame chased less in 5 of 9). With seed 2: 9 of 12 closer with the engine frame. E1 stays dropped. (Output: tmp/e1survey.out.)

   The engine's storms are off the textbook right-mover, but so are the model's.
2. **Done 2026-11-05: M2, the engine names the lift its long-lived storms need** (js/storms/StormMaintenance.js; push ceiling 0.25 with it; results in docs/cloudlab/STATUS.md). It explains part of the push, not most of it. (CIN minus gust-front, rotation and mesoscale lift). That lift goes to the model as convergence, so the push shrinks to a trim and storm lives stay long.
   - Test PUSH_MAX at 0.35, 0.2 and 0.1.
   - Leave M1 (the cap killing engine storms) as a diagnostic only.
3. ~~**E3: mesocyclone placement from the hodograph.**~~ **Parked after its test (2026-11-06).** Test-only column in tools/cloudlab/synccheck.mjs, seeds 2 and 5150, 3 storms x 3 h each.
   - The planned share (SRH over |net 0-1 km shear| x |inflow|) ran 1.2-1.95 on curved hodographs, so it can't be a share; sin(critical angle) is used instead.
   - These storms' inflow is mostly streamwise (share 0.84-1.0), so the lean barely turns: the model-engine meso gap was 3.2-6.2 km today and the same with E3 (changes of 0.1 km at most).
   - The model's own meso sits about 2 km right of and slightly behind its updraught on seed 2 (as theory says), but is mixed on seed 5150 (left in 2 of 3). The gap is not the lean's direction; next suspects are the lean's length and the model's own scatter. The pin (PIN.MAX_KM) stays.
4. **Done 2026-11-06: E2, one cold pool** (js/storms/ColdPool.js). coldPoolStrength is the only state; the depth (500 + 1,900 x strength m) and the deficit (what 38 m/s x sqrt(strength) needs at that depth) come from it, and the storm modes, gust surge, RKW balance, maintenance lift and cloud model all use that one speed. The model now scales its cold air up to the engine's depth (cpTop, C and Luau identical) instead of a fixed 1.5 km.
   - Fitting the deficit to today's median would have meant 25 m/s, which breaks the storm-mode balance ranges tuned on 38, so the deficit rose instead: median 4.2 → 10.6 °F (2.3 → 5.9 K; real outflows 2-10 K). The atmosphere's pools already came from strength and did not change.
   - Regression suite (8 seeds x 10 days, against baseline): no regressions. Tornadoes 17.7 → 17.8 a day, wind and hail reports, storm modes, lives, outflow boundaries and boundary tornadoes all within noise. Days with an EF2+ tornado 58 → 41% (EF2+ a day 2.7 → 2.9), just over one tolerance, track only.
   - Tests: cloudmodel-restore, storm-workers, tornado-frame, storm-environment-coupling-2.25.2 pass; C/Luau parity identical with a depth set.
5. **Built 2026-11-06: T1 + X1** (js/storms/TornadoEngine.js `TORNADO_ARM`; hints from js/game/StormWorkers.js `world.modelHints`; tests/tornado-arming.mjs). When the dice give a modelled storm a tornado while the model's 0-1 km spin is under 0.01 /s (the spin the nests count as a vortex of their own), it is armed: down at the first storm tick the model's vortex is there, after 10 game minutes, or at once if the hint goes stale; it starts at the model's vortex if that is within the updraught's radius of the wall cloud. The hint is the worker's status pin, from workers caught up within 300 model s. Known gap: a storm that ends while armed loses its tornado.
   **Live check (2026-11-06, tmp/t1live.mjs and t1force.mjs, seed 2 19-21Z, 4 workers):** in 2 h no modelled storm rolled a tornado (7 touchdowns, all on storms without a worker: plain dice, as meant). With tornadoes armed by hand on two modelled storms, the model's 0-1 km spin stayed at 0.002-0.007 /s for the whole window and its spot was 11-13 km from the wall cloud, so both went down by the window at the wall cloud. Before the engine's tornado there is no push, and the model's own spin doesn't reach a vortex. As built, T1 only delays modelled tornadoes by 10 min, and X1 doesn't move them. Open: a cue the model really gives before touchdown (its spin rising, or its peak in the window), and why its spin is 11-13 km off.
   **T2 tried and dropped (2026-11-06):** a proportional part, a 2-min smoothed gust and a 10% dead band (tmp/flicker.mjs, SupercellLife, forced 85 mph, 37 min) gave 18 and 25 min within 25% of the engine's wind against 23 today, and 1 collapse against 2: within noise. The vortex dies with the push at its 2.0 ceiling for 5-10 min at a time, so the limit is the model holding a vortex at 62.5 m, not the controller.
   **T1 + X1: the engine arms a tornado and the model's vortex picks the touchdown minute,** within about 10 game minutes, as a placement hint that expires.
   - With no workers the world must stay bit-identical.
   - Counts and strengths don't change.

Later, together with a planned climate refit only: E4 (0-500 m helicity) and E5 (entraining CAPE).

Cost: microseconds per storm step. Model workers stay at about 8% of a core, 17% with the 250 m nest, and about 34% with the tornado nest, plus about 110 MB per mature nested storm.

## Stage 2: new storm visuals (prototypes first, measured on a phone)

Visuals are split into three bands by distance:

| | Near (under ~2.7 km) | Mid (to ~15-25 km) | Far |
|---|---|---|---|
| Cloud | Billboard puffs at full detail plus the nest | Puffs from merged columns, lit by script toward the sun | One painted card per storm (EditableImage 128×256) |
| Base / wall cloud | EditableMesh sheet from base heights plus the nest | Coarser sheet or a row of puffs | In the card |
| Tornado | Smoothed spine, rings of billboards, beams, debris skirt | Spine beams and about 80 billboards | A dark line |
| Rain and hail | Camera rain, curtain ring, fog from rain rate | Beam curtains per rain area | In the card |

Prototypes, in this order:
1. A billboard puff storm at 300, 600 and 1,200 puffs on a phone.
2. The base sheet. **First look 2026-11-06** (BaseView.luau, docs/cloudlab/STATUS.md): it runs, but Roblox's 2,048-stud mesh size and the client's ~6-8 editable meshes limit it to a small patch near the camera, and the frame's lowest-base field is too stepped to make a flat base. It needs a smoother base field (nest base, or a frame field) first.
3. The far card.
4. The spine tornado through a rope-out.
5. Rain curtains and fog, driving through a hook.

Starting budgets (to be measured):

| | Desktop | Mobile |
|---|---|---|
| Billboards | 2,000 | 800 |
| Beams | 300 | 120 |
| Visible particles | 3,000 | 1,000 |
| Lighting script | 2 ms or less per frame | about 1.5 ms per frame |

No extra network traffic is needed.

Small additions to the model's frame:
- a per-column cloud thickness (4 bits is enough);
- a virga flag;
- a multiple-vortex hint;
- a ground type for debris colour.

The old billboard tornado stays until the new one works.

## Stage 3: forecasts (can run alongside stages 1-2; different files)

1. **I1: step every forecast copy as the server does** (5-minute storm ticks, not 30-minute ones). This is a bug fix with no CPU cost: today the outlook members make about half the tornadoes they should, and the calibration tables hide it.
   - Fix the MD check script's truth at the same time.
   - Add Brier skill, reliability and CSI scores.
   - Then one refit.
2. **Short-range model 3.1: start each run from the storms already present, with its own dice from minute 0.** Today it copies the future for 3 hours. Needs your decision (see below).
3. **Short-range model hazard grids** (max UH within 10 mi; tornado, hail and gust masks), about 100 KB a run, plus a shared reflectivity module. These are the outlooks' inputs.
4. **I2 + I3: expected tornadoes from each storm's rate, and neighbourhood probabilities across runs.** Tornado probabilities today have almost no skill (Brier skill 0-7%).
5. **I4: Day 3 with storms** (+10-20% CPU), so it stops forecasting Slight almost every day.
6. **MDs and watches:**
   - cheap storm layers and expected tornadoes, so the probabilities stop jumping in 25% steps;
   - timing doubt;
   - trend wording;
   - SPC's watch probability bands and 4-8 h lengths.

   Then a first meteorologist review round.
7. **I5: blend the Day 1 updates with the short-range model's last 3-4 runs** as a time-lagged ensemble. This needs step 2, and cuts about half the CPU of each update.
8. **Short-range model:**
   - time-lagged products on the page;
   - forecast soundings;
   - verification;
   - 4 cheap members an hour (+13% CPU).
9. **Offline calibration:** paired engine-to-model samples set the short-range model's UH stand-in and the engine's constants. This can run at any time.

Forecast budgets stay about where they are:
- Outlook issue: 8 members × about 16 s.
- MD: 4 members × 3 s an hour.
- Short-range model: about 3.5% of a core and about 100 MB after its steps.

## After that (the earlier plan)

- Ground winds and damage from the model.
- The whole chain in the game.
- LOD tiers.
- Cleanups.

## Decisions for you

1. **Particles: approved (2026-11-05).** Use them for near detail within about 1,000 studs: tornado edges and debris, scud, near rain and hail.
2. **Short-range model stops copying the future: approved, 2026-11-05 (full change: no shared rolls for new storms or tornadoes; storms already on the map kept). Do it in its turn in stage 3, not now.** (step 3.2 above). This reverses your 2026-10-28 choice. It doesn't add errors; it removes the 0-3 h clairvoyance. The ensemble products and the outlook blend depend on it.
3. **EditableMesh and EditableImage: approved (2026-11-05),** beta status and the ID-verified owner setting included.
4. **Later, from the new scores:** whether the outlooks' hand gates (run-agreement rules) are still needed.
