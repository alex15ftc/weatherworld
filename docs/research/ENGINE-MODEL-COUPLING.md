# Engine and cloud model: making them agree (research, 2026-11-05)

Read-only research. No code was changed. Scratch measurements are in C:/Users/alex1/.claude/jobs/f592f53b/tmp/motioncheck.mjs.
Related: docs/cloudlab/STATUS.md (newest sections), docs/cloudlab/PLAN.md, docs/research/SHARED-FINDINGS.md.

## 1. Summary

### Why the model needs steering

The cloud model needs steering because of choices the engine makes, not because the model is wrong. Each choice is visible in the engine's code:

- **Storms barely feel the cap.** The engine keeps a storm going almost regardless of the cap.
  - StormRealizationPhysics takes off only `sqrt(1 - CIN/CAPE)`.
  - stormFuel has a flat 200 J/kg cut-off.
  - A storm in 1,800 J/kg under a 100 J/kg cap keeps 97% of its updraught, and nothing asks what lifts its inflow through the cap.
  - The model's storms need that lift and die without it.
- **Motion does not match the engine's own helicity.** The engine moves storms by a three-level wind rule that turns right only once the storm rotates. But its helicity is computed against the sounding's true Bunkers right-mover.
  - Measured: rotating storms on seed 2 move 5-7 m/s off the Bunkers vector of their own cell's sounding.
  - The engine therefore describes a storm-relative inflow, and so a helicity, that its own storm does not have.
  - The model, which moves itself, sees something else.
- **Three cold pools.** The engine keeps three different cold-pool descriptions (a 0-1 strength, a °F deficit, and a depth guess) that imply different gust-front speeds.
- **Shape and tornadoes are rules, not dynamics.** The engine places the low-level mesocyclone directly behind the updraught and picks tornado minutes by a dice draw. In the model both follow from the hodograph and the storm's own evolution.

### What I recommend

1. **Make the engine consistent with itself first.** Cheap, and no change to the climate's intent:
   - storm motion from the cell's own Bunkers vector;
   - one cold pool;
   - mesocyclone placement from the hodograph's streamwise share.
2. **Give the model, as an explicit engine field, the lift the engine already assumes keeps its storms alive** (the "maintenance lift"). The updraught push then becomes feed-forward instead of a gap controller. Storm lives stay as long as they are now: they are deliberately long.
3. **Let the model feed back only placement and timing for the storms it runs:**
   - where the mesocyclone and tornado are;
   - the minute an engine-drawn tornado touches down, within a short window.
   - Not strength or counts. The outlooks, the short-range model and the climate tuning all run without the cloud model, so the statistics must stay the engine's.

All of these cost microseconds per storm per tick. None needs more memory worth counting.

## 2. Where the engine and the model disagree

Evidence strength: **strong** = measured here or in STATUS, with the cause in code. **Moderate** = in STATUS, cause inferred. **Weak** = plausible, not measured.

### 2.1 Storms under a cap; storms in weak convergence (strong)

- **Seen (STATUS "The mesocyclone: convergence lift...", "Engine against model: sync check"):**
  - Unsteered, SupercellB was dead by 40 min and SupercellLife by about 100 min.
  - Cooling 850-700 hPa by 3 K, or lifting the sounding by the engine's own convergence, kept SupercellLife alive for 140 min with no steering.
  - Most live storms sit in 0-3e-5 /s convergence at their inflow point and still need the push (PUSH_MAX 0.35 m/s²).
- **Measured here (seed 2, 24 game hours, 321 storm samples):**
  - 95% of storm samples had inflow MLCIN of 50 J/kg or more, and 56% had 100 or more.
  - 36% had cell convergence under 3e-5 /s; the median at the storm's cell was 7e-5 /s.
- **Cause in code:**
  - **Only a mild slowdown under the cap.** In js/storms/StormRealizationPhysics.js `diagnoseStormRealizationPhysics`, `inhibitionEfficiency = sqrt((CAPE-CIN)/CAPE)` is the only way CIN slows a running storm. Its own comment (2026-10-16) explains that the stronger form was removed because it emptied the climate.
  - **A flat cut-off.** js/storms/StormHazards.js `stormFuel` keeps surface fuel at any CIN up to 200 J/kg, then switches.
  - **Lift is never compared with CIN.** `liftingWorkJkg` and `initiationMarginJkg` are computed but feed only `organizationProbability`. Nothing compares a running storm's lift with its CIN. `balanceSupport` (the RKW ratio) is computed and not used in the budgets.
  - **The target ignores lift.** js/storms/StormBudgets.js `stepStormBudgets` targets `potential × (1 - loading) × (1 - undercut) × inflowQuality`. Nothing in it is lift.
- **Physics:**
  - A running storm keeps ingesting capped air only if something lifts it through the CIN:
    - its gust front, most effectively when the cold pool and the low-level shear are in balance (Rotunno, Klemp and Weisman 1988; Weisman and Rotunno 2004);
    - in a supercell, the dynamic low pressure under the rotating updraught;
    - mesoscale ascent.
  - Parameterisations make this explicit: lift energy against CIN (Kain 2004; Mapes 2000; Rio et al. 2009, and Grandpeix and Lafore 2010 with a cold-pool ALE).
  - Explicit simulations over stable layers (Nowotarski et al. 2011) keep supercells going over a moderate cap, but with weaker low-level updraughts and rotation, and with fewer near-ground parcels as CIN grows.
- **Where the engine stands:** it already does this for starting storms (js/storms/InitiationEngine.js `kainFritschLift`, `overcomeShare`) but not for keeping them going.
- **The model is not blameless:**
  - At 1 km it under-resolves the updraught and entrainment (Bryan, Wyngaard and Fritsch 2003).
  - Its Kessler-type rain and missing surface fluxes make cold pools too strong (STATUS rounds 7-10: -7 to -20 K unsteered).
  - It has no Coriolis.
  - Some of the deaths are therefore the model's. But the cap test isolates the cap: the same storm lives once the cap is removed.

### 2.2 Early motion off the Bunkers right-mover (strong)

- **Measured here** (seed 2; rotating means mesocyclone ≥ 0.35 and line share < 0.3; each storm's velocity against its own cell's sounding):

  | Storm age | Samples | Off the sounding's Bunkers RM (median, p90) | Off the 0-6 km mean wind |
  |---|---|---|---|
  | 0.5-1 h, rotating | 19 | 7.4, 8.7 m/s | 5.3 m/s |
  | 1-2 h, rotating | 28 | 5.7, 7.1 m/s | 5.7 m/s |
  | 2 h+, rotating | 17 | 4.9, 6.5 m/s | 5.6 m/s |
  | not rotating | 257 | 7.6 m/s | 4.2 m/s |

  - Rotating storms sit about halfway between the mean wind and the right-mover even at 2 h+.
  - Non-rotating storms are 4 m/s off the true 0-6 km mean.
  - STATUS round 9 saw the model storm drift 85 km south of the frame in 5 h (about 4.7 m/s).
- **Cause in code:**
  - js/storms/environmentSampling.js `diagnoseStormMotion` builds the mean wind from three levels (`MEAN_WIND_WEIGHTS` surface 0.13, 850 0.5, 500 0.37). Its shear is 500 mb minus the surface, and the deviation is scaled by `rotatingShare × (1 - linear)`.
  - These are read from the inflow blend 10-40 km upstream (`sampleEffectiveInflowEnvironment`), not from the storm's column.
  - js/storms/StormEnvironmentCoupling.js `updateCoupledStormMotion` then eases the velocity over 0.5-0.7 h. So a young storm moves with an approximate mean wind and turns right an hour or more after the model's storm has split (the model splits at about 35 min, STATUS round 1).
  - Meanwhile js/sounding.js `bunkers` (line 579) computes the real right-mover from the full profile, and `diagnoseKinematics` computes srh01 and srh03 against it. Those helicities feed the engine's rotation (StormRotation.js), but not its motion.
- **Effect on the model:**
  - The model box moves at the engine's motion (`setMotion`), so its storm-relative inflow and helicity differ from what the engine assumed when it set the mesocyclone.
  - `followStorm` keeps shifting the box after the model's own right-mover.
  - The frames are then drawn at the engine's updraught, and the pin shift absorbs the difference.
- **Caveat:** one seed, sampled at the storm's own cell, which may be partly its own outflow. The size (5-7 m/s against a 7.5 m/s deviation) is too big for that alone.

### 2.3 Where the mesocyclone sits (moderate)

- **Seen:** the engine puts the low-level mesocyclone 1-2 km directly behind the updraught (165-180° from the motion). The model puts it 2-3 km to the right (south for east-moving storms). The unpinned miss is about 3 km (STATUS "Hook check and pinning").
- **Cause in code:** js/storms/StormGeometry.js `buildStormGeometry` leans the updraught from the mesocyclone along the storm-relative 500 mb wind (`TILT`). The direction is fixed by that wind alone. The hodograph's shape (streamwise against crosswise vorticity) is not used.
- **Physics:**
  - Where the updraught tilts **crosswise** vorticity (a straight hodograph), the cyclonic member of the vorticity pair lies on the right flank of the updraught, across the shear.
  - Where the inflow's vorticity is **streamwise** (a curved hodograph, high SRH), rotation and updraught coincide (Davies-Jones 1984; Rotunno and Klemp 1982).
  - The low-level mesocyclone then sits at the rear-right edge where outflow meets inflow (Lemon and Doswell 1979).
  - The sounding already has `criticalAngle` (js/sounding.js `diagnoseKinematics`), and the streamwise share follows from it and from srh against shear.
  - The model's "right of the updraught" is what moderate-streamwise hodographs give. The engine's "directly behind" is the fully streamwise case.

### 2.4 The engine's tornadoes are drawn; the model is forced into them (strong)

- **Seen:** the model is pushed under its fine nest's spin from the gap between its gust and the engine's mph (EngineRun `steerTornado`, TOR_PUSH_MAX 2 m/s², 2 min). Its vortex flickers (spin 0.01-0.09 /s frame to frame) and overshoots. 62.5 m cannot hold EF3+.
- **Cause in code:** js/storms/TornadoEngine.js `updateTornadoState`.
  - Touchdown is a hazard rate on `lowRotation` (`fullRatePerHour` 0.23, `power` 1) with a hashed dice draw per tick.
  - Strength, life and steadiness are drawn too (`drawTornadoCharacter`).
  - Position is the wall cloud plus the occlusion orbit.
  - None of it can know when the model's low-level vortex is ready.
- **The controller adds to the problem:** EngineRun `steerTornado` and `steerPush` integrate the gap (push += MAX × gap × 60/TAU). That is an integral-only controller acting on a lagged, chaotic plant: it will overshoot and ring, which is what STATUS reports.
- **Physics:** tornado timing, duration and intensity have very little intrinsic predictability even in a fixed environment. Markowski (2020): 25 members at 75 m in one environment gave EF0 to EF3 vortices at very different times. A rate from the environment plus a random minute is therefore a fair engine design. But it also means **any** minute in a window is as "right" as the dice's. Nothing is lost if the model chooses the minute.

### 2.5 Cold pool scaling (strong, from code)

The engine carries three cold-pool numbers that do not agree:
- **The model's steering target** is `coldPoolTemperatureDeficitF`: js/storms/StormEnvironmentCoupling.js `updateStormColdPool`, target `1.2 + 8.5 × intensity × (0.65 + 0.35 × dryness)` °F. That is about 3.6 K for a typical 0.75 storm.
- **The behaviour** reads `coldPoolStrength` (0-1, StormBudgets.js `COLD_POOL`), turned into a gust-front speed `38 × sqrt(strength)` m/s (StormModeEngine.js `coldPoolBalance`). At strength 0.3 that is 21 m/s, which for a 1 km pool is about 6.5 K, not 3.6. The behaviour covers undercutting, line growth, rotation's outflow factor and the occlusion.
- **`StormRealizationPhysics`** computes a third speed from the °F deficit and a depth of `500 + 1900 × strength`.

So the model is steered toward a deficit that is not the one setting the engine's storm behaviour. Its gust front cannot match the engine's undercutting.
- STATUS saw cold-pool r 0.43-0.49 and "within about 1 K after the first hour": the deficit tracks, the behaviour need not.
- Observations: tornadic rear-flank outflow is only a few K colder (θv) than the inflow, non-tornadic outflow colder (Markowski, Straka and Rasmussen 2002). The engine's lowRotation `outflow` factor encodes that through `coldPoolStrength`, not the deficit the model gets.

### 2.6 Early hail too heavy (moderate; mostly the model's)

- **Seen:** ground hail peaks of 330-500 mm/h early (STATUS "Hail steered by the engine").
- **Cause:**
  - The EngineRun constructor's start drive pulls w to `min(10, updraftMs)` in a 10 km ball for 15 min, which makes a w5 33 m/s pulse by minute 15 (round 8).
  - Meanwhile the engine's updraught grows from 6 m/s over `growthHours` 0.35 (StormBudgets.js), and its hail follows that slower rise.
  - Single-moment hail with a fixed intercept also over-produces hail from one strong first pulse.
- **What the engine can do:** little, beyond giving the model its updraught trend (2.1, option M2) so the start lift can follow it.

### 2.7 Smaller items found on the way

- The worker record sends `updraftMs`, but the push compares it with the model's peak w anywhere within 16 km (`steerPush`). The engine's number is a storm-scale "realised updraught", nearer a 5 km core mean than a grid-point peak. The comparison is apples to oranges at 1 km grid spacing. The nest's peak w, or a 3×3 mean at 5 km, would match the engine's meaning better (weak).
- The inflow sounding is the cell 24 km back along the 0-1 km storm-relative wind (LabWindow `inflowCell`), while the engine's own environment is a 10/25/40 km blend (`sampleEffectiveInflowEnvironment`). The two differ by up to a cell in gradients, for example near a dryline (weak).

## 3. Options

Costs are per storm per 5-minute tick unless stated otherwise. Today's engine storm tick is a few hundred microseconds a storm, and at most 70 storms (InitiationEngine `MAX_ACTIVE_STORMS`).

### E1. Storm motion from the cell's own Bunkers vector

- **Physics:**
  - Bunkers et al. (2000): a right-mover moves at the 0-6 km non-pressure-weighted mean wind plus 7.5 m/s to the right of the 0-0.5 km to 5.5-6 km shear.
  - Storms deviate after splitting, roughly in the first hour.
  - Bunkers (2018): significantly tornadic supercells sit about 1.2 m/s slower and farther right than forecast.
  - Lines follow Corfidi.
- **Changes:**
  - js/sounding.js: keep `p.stormMotion` (right, left) and `p.meanWind` in `cell.derived.sounding`. They are already computed.
  - js/storms/environmentSampling.js: sample them into the environment, and have `diagnoseStormMotion` use them in place of the three-level mean and 500 mb shear.
  - Ease toward the right-mover by an organisation measure that grows from the updraught's first half hour, not by `rotatingShare` of the slow-spinning mesocyclone. This could be the updraught's tilting term (StormRotation `tilting`) times the updraught share.
  - Keep `updateCoupledStormMotion`'s easing.
- **Effect on nudging:**
  - The box's frame motion equals the motion the engine's helicity was computed for, so the model's storm-relative inflow and SRH match the engine's.
  - `followStorm` shifts and the drift (85 km in 5 h) should mostly go.
  - The pin shift's along-track part shrinks.
- **Cost:** zero CPU (fields already computed per cell each hour). About 32 bytes a cell more in `derived.sounding` (2,500 cells: 80 KB).
- **Risk:**
  - Tracks bend right sooner, so reports, swaths and outlook truth move several km.
  - SRH-based rotation is unchanged, because SRH already used Bunkers.
  - Storm-relative inflow strength changes, and with it `stepBow` inflow, `sampleEffectiveInflowEnvironment` direction and LabWindow `inflowCell`. Expect small changes in line and bow statistics.
  - Run the regression suite and one 40-day climate check (tornadoes a day, EF2+ share, High days against docs/TARGETS-2026-10-25.md).

### E2. One cold pool

- **Physics:**
  - A cold pool's gust front moves at the density-current speed `C = sqrt(2 g h Δθv/θv)` (Benjamin 1968; RKW 1988), with its depth h and deficit Δθv.
  - Its strength should come from rain evaporation in dry sub-cloud air (DCAPE, rain rate). That is what `COLD_POOL` already does for `coldPoolStrength`.
- **Changes:**
  - js/storms/StormBudgets.js: make `coldPoolStrength` the one state and derive from it both the deficit (K) and the depth (m), for example depth 500-2,000 m and deficit 1-10 K. Choose them so that `C = 38 × sqrt(strength)` (StormModeEngine.js `COLD_POOL_SPEED_MS`) holds exactly.
  - js/storms/StormEnvironmentCoupling.js `updateStormColdPool`: write `coldPoolTemperatureDeficitF` from that, not its own formula.
  - js/storms/StormRealizationPhysics.js: use the same speed.
  - js/game/LabWindow.js: send the depth as well as `coldPoolK`, so cloudmodel.c `applyColdPool` (now a fixed 1.5 km top) scales the right layer.
- **Effect:**
  - The model's gust front is steered to the speed the engine's undercutting and RKW balance assume, so outflow-dominance and occlusion behave alike on both sides.
  - The cold-pool steering factor should sit nearer 1.
- **Cost:** none.
- **Risk:**
  - The atmosphere's cold pools (RegionalAtmosphere `addColdPool`, fed from the deficit) would change strength. That changes outflow boundaries, `outflowContrastK`, boundary tornadoes and new cells on gust fronts.
  - This is the riskiest of the cheap options for the climate. Fit the derived deficit so its median matches today's, and change only the spread.

### E3. Mesocyclone placement from the hodograph

- **Physics:** as in 2.3. Streamwise vorticity in the inflow puts rotation on the updraught. Crosswise puts it on the right flank. The low-level mesocyclone sits at the rear-right, where the RFD and the inflow meet. The streamwise share comes from the critical angle and from SRH against shear × depth.
- **Changes:**
  - js/sounding.js: put `criticalAngle` and a streamwise share (for example `srh01 / (|shear01| × |Vsr0-1|)`) into `derived.sounding`.
  - js/storms/StormGeometry.js `buildStormGeometry`: turn the lean direction from "along the storm-relative mid-level wind" toward "left of the shear vector" as the streamwise share falls. In the storm's frame, the updraught then sits ahead-left of the mesocyclone, so the mesocyclone is at the updraught's rear-right.
  - TornadoEngine reads the wall cloud, so tornadoes follow.
- **Effect:**
  - The unpinned miss (about 3 km) should shrink toward the model's own scatter, so `PIN.MAX_KM` and the eased pin shift do less.
  - The radar hook and couplet in the engine's picture move to match.
- **Cost:** none.
- **Risk:** low. Geometry feeds radar pictures, the wall cloud and tornado positions, so report positions move by 1-3 km. No counts change.

### E4. Low-level rotation from the layers that matter

- **Physics:**
  - Tornadic and non-tornadic supercells differ most in 0-500 m SRH and streamwise vorticity (Coffer and Parker 2017; Coffer et al. 2019: 159 against 80 m²/s² in the VORTEX2 composites).
  - The low-level mesocyclone's strength is controlled mainly by streamwise vorticity, more weakly by storm-relative flow and updraught width (Peters, Nowotarski and Mullendore 2020; Peters, Coffer et al. 2023).
- **Changes:**
  - js/sounding.js: add srh0-500 m against Bunkers.
  - js/storms/StormRotation.js: `nearGround` to read it, or a blend, alongside 0-1 km.
- **Effect:** the engine's lowRotation would follow the same ingredient the model's 250 m and 62.5 m nests respond to, so the times the engine wants a tornado are times the model can make one. This prepares T1.
- **Cost:** one more helicity integral per cell per hour (negligible).
- **Risk:** medium. The tornado climate has been tuned on 0-1 km for weeks (StormRotation's comment history). Refit `lowHelicity` so the median tornado rate and EF mix hold.

### E5. Updraught strength from entraining CAPE (ECAPE)

- **Physics:**
  - Peters et al. (2023) give an analytic entraining CAPE in which the entrainment rate follows from the updraught radius, and the radius from the storm-relative inflow: stronger inflow, a wider updraught, less dilution.
  - It predicts the peak w of simulations better than CAPE or fixed-rate ECAPE.
  - This replaces the engine's fitted `entrainmentEfficiency` (0.48 + 0.25 ramp(shear) + 0.18 ramp(CAPE) - 0.16 ramp(LCL) + convergence).
- **Changes:**
  - js/sounding.js: compute ECAPE per cell from the profile, with V_sr the 0-1 km storm-relative wind against Bunkers RM.
  - js/storms/StormRealizationPhysics.js: `potentialMs = sqrt(2 × ECAPE) × inhibition × inflow`, keeping the loading and undercut terms.
  - Fit one overall factor so the median updraught and hail stay the same.
- **Effect:**
  - The engine's updraftMs becomes what a well-resolved model would produce in that inflow, so the push gap is smaller where the model is good (the nest).
  - It also ties updraught width to rotation, as E3 and E4 use.
- **Cost:** one column integral with a quadratic solve per cell per hour (2,500 cells: a few ms an hour). Zero per storm tick.
- **Risk:** medium. Hail size is a steep power of the updraught (`HAIL.power` 2.5). Refit `HAIL.scaleInches` against the SPC hail record (docs/REVIEWER-BRIEF.md: 2 in or larger in 13.5% of reports). The outlooks' hail probabilities follow.
- **Bonus:** ECAPE is a useful map field for the outlooks.

### M1. Storm maintenance from lift against CIN (the honest gate)

- **Physics:** keep the storm's inflow only as far as its lifting energy beats the CIN, the way initiation already works:
  - `L = L_gustfront + L_dynamic + L_meso`;
  - `L_gustfront ≈ ½ (a C)²`, where C is the gust-front speed (E2) and a falls from about 1 at RKW balance (C ≈ Δu0-3) to less when the outflow runs ahead or the shear dominates (ALE of wakes, Grandpeix and Lafore 2010; RKW 1988);
  - `L_dynamic ≈ (ζ r)²/2`, the dynamic pressure deficit under a low-level mesocyclone per unit mass. ζ 0.01 /s over r 2 km gives about 200 J/kg; scale it from `lowRotation`;
  - `L_meso` is the existing Kain-Fritsch lift from `kainFritschLift`;
  - surface-fed share = `overcomeShare(L, CIN)`, the same function as initiation. The rest of the inflow comes from above the cap (the existing elevated path).
- **Changes:**
  - js/storms/StormHazards.js `stormFuel`: replace the 200 J/kg switch with the smooth share.
  - js/storms/StormRealizationPhysics.js: use the share for the inhibition term.
  - js/storms/StormRotation.js `fromGround` could read the same share in place of its own CIN ramp.
- **Effect:** engine storms die or go elevated where the model's do, so the steady push largely goes away.
- **Cost:** none.
- **Risk to the live world:** high, and against a standing rule.
  - Supercell lives of 4-9 hours are deliberate (REVIEWER-BRIEF item 2; memory note "long-lived storms for play").
  - The 2026-10-16 comment in StormRealizationPhysics records that a real CIN effect took quiet days from 8% to a third.
  - **Recommended only as a diagnostic:** compute `L - CIN` and the share, log them and show them on the lab page, but do not act on them.

### M2. The engine names the lift that keeps its storms alive (recommended)

- **Idea:** if the engine's storms are long-lived by design, then the engine itself is assuming lift that its grid cannot show. Put that assumption into one engine field, and give it to the model as large-scale rising air. The model then gets it as a cause, not as a controller chasing a gap.
- **Physics:**
  - The deficit is `D = max(0, CIN − L)` from M1, in J/kg. That is the lifting energy the engine's storm needs and does not get from resolved fields.
  - Turn it into an equivalent mesoscale ascent w at cloud base by inverting `kainFritschLift` (InitiationEngine.js), then into a convergence `C = w / zLCL`.
  - The model already applies convergence lift to its inflow sounding (EngineRun `liftRows`, record.convergence).
- **Changes:**
  - js/storms/StormRealizationPhysics.js: compute `maintenanceLiftJkg = D` (about 10 lines).
  - js/game/LabWindow.js `labStorm`: send `maintenanceConvergence`.
  - js/cloudmodel/EngineRun.js and EngineRun.luau: `liftRows(record.inflow, record.convergence + record.maintenanceConvergence)`. Keep the push as a small feedback trim only, with PUSH_MAX lowered after testing.
  - Optionally add a feed-forward push from the engine's updraught trend (`updraughtTrend`), so the model follows growth and decay without lag.
- **Effect:**
  - The cap no longer kills model storms, for the engine's own reason.
  - The push turns from a large integral controller into a trim, so the over- and under-shooting (66 against 34-46 m/s, STATUS "The lift as a push") should ease.
  - The field also says where the engine's storms are living on assumption: useful for reviewers and as evidence for any later M1-style change.
- **Cost:** none in the engine. A few floats more per worker record.
- **Risk:**
  - None to the climate, because the engine's behaviour is unchanged.
  - The no-painting rule: this is a forcing that comes from an engine quantity, not a painted value. Document it as the engine's maintenance assumption so it is never mistaken for observed convergence.

### T1. Tornado timing: the engine arms, the model fires (recommended)

- **Physics:** tornado timing within a favourable spell is essentially unpredictable (Markowski 2020). So the engine's rate decides **how many**, and either the dice or the model can decide **which minute**.
- **Changes:**
  - js/storms/TornadoEngine.js `updateTornadoState`: when the draw fires for a storm flagged `modelled`, set `tornado.armed = { untilHourUtc: now + W }` (W about 10 game minutes) instead of `beginTornado`.
  - It touches down at the first tick in the window when the model reports its low-level vortex has crossed a threshold. The fine nest's 0-1 km column spin rising through about 0.05-0.1 /s would do; EngineRun `columnSpin` and `tornadoShape` already compute it.
  - Either way it touches down by the window's end.
  - Its position is the model's (via the pin point), within the updraught radius already used by `leftBehind`.
  - The worker status carries `{ vortexZeta, vortexTrend, pinEast, pinNorth }`. StormWorkers.js passes them in through a small "model hints" map the storm tick reads.
  - Strength, life and rating stay the engine's draws, as STATUS's "who decides what" already settles.
- **Effect:**
  - The tornado push only has to finish a vortex the model is already building, not create one on command, so flicker and overshoot should fall.
  - The pin shift can drop to zero while a tornado is down.
- **Cost:** a few floats a storm a minute over the existing worker HTTP, and one map lookup per storm tick.
- **Risk:**
  - Counts and strengths are unchanged by construction (each armed draw makes exactly one tornado). Timing shifts by at most W.
  - Tracks start up to about 10 game minutes later (about 8 km at 50 km/h). Reports, warnings and the DAT survey follow the engine's track, so they stay consistent with what players see.

### T2. Tornado push as a feed-forward with a damped trim (model side)

- **Changes** (js/cloudmodel/EngineRun.js `steerTornado`, `steerPush`, and the Luau twin):
  - Replace the integral-only update with a feed-forward set from the engine's target: for example the push that gave the target mph in the SupercellB tuning, as a table of mph against push.
  - Add a proportional-integral trim, with a clamp on the integral and a dead band of about 10% of the target.
  - Smooth the measured gust over 2-3 minutes before comparing.
  - The same goes for the updraught push. Gradual forcing (incremental analysis update, Bloom et al. 1996) avoids the shocks a step nudge gives.
- **Effect:** less ringing. It does not fix the 62.5 m ceiling.
- **Cost:** none.
- **Risk:** none to the engine.

### T3. Tornado intensity informed by the model's mesocyclone width (later, optional)

- **Physics:** pre-tornadic mesocyclone width predicts EF rating better than its rotational velocity (Trapp et al. 2017; Sessa and Trapp 2020: R² 0.75, 0.82 for discrete supercells).
- **Idea:**
  - The engine's draw `strengthUniform` could be replaced, for modelled storms only, by the quantile of the model's 1 km mesocyclone width among modelled storms.
  - The rank is used, not the value, so the distribution stays the engine's.
- **Risk:** medium (see X below). Only after T1 has run for a while.

### X. The two-way option: the model's results feeding the engine's storm state

**What could flow back, from least to most invasive:**

| Level | Feeds back | Changes engine statistics? | Verdict |
|---|---|---|---|
| X0 | nothing (today) | no | needs all the pinning and pushing |
| X1 | placement: the mesocyclone, wall cloud and tornado position, as an offset the engine adopts for the storm's geometry; the model's motion as a small correction (≤ 2 m/s) to the storm's velocity | positions only, by a few km | **recommended with T1** |
| X2 | timing: T1's armed tornado fires on the model's vortex | timing within W only | **recommended** |
| X3 | rank-preserving character: T3, the tornado's strength quantile from the model's mesocyclone width | no change to the distribution if it is done by rank | later, optional |
| X4 | state: updraught, mesocyclone, cold pool or hail from the model replace the engine's for modelled storms (superparameterisation-style; Grabowski 2001; Khairoutdinov and Randall 2001) | yes, large | **not recommended** |

**What X1-X4 mean for consistency across game servers:**
- **No conflicting copies.** One engine runs and every Roblox server gets the same storm state and frames, so feedback does not split the world between servers: the engine adopts the hint and every server sees the same storm.
- **The world would depend on who is watching (the real issue).** Modelled storms are the ones near players (StormWorkers `detailKm` 60 km, capped at WEATHER_STORM_WORKERS). With feedback, a storm's history depends on whether, and when, a player came near. When its worker started also matters: the warm-up starts the model at most 45 minutes back. For X1-X2 this is harmless: positions and minutes. For X4 the climate near players would differ from the climate away from them, and from the tuned targets.
- **Forecasts.** The outlooks' 8 members, the MD members and the short-range model never run the cloud model (SHARED-FINDINGS: unaffordable). Under X4 they would miss systematically exactly where players are. Under X1-X2 they miss only by placement and timing, which they already miss by.
- **Restarts and reproducibility.**
  - Models restore bit for bit (STATUS "Live loop hardening"), so feedback survives restarts. But the hints must go into the world's saved state too, or a restart replays a storm differently.
  - The dice are hashed from seed, storm id and tick (TornadoEngine `deterministicUnit`). Under T1 the dice still decide whether a tornado comes, so a world with no players still reproduces exactly.
- **Failures.** If a worker falls behind or dies, its storm must fall back to the engine's own rule at once:
  - armed tornadoes fire at the window's end;
  - placement hints expire after a few minutes.
  - Then no server ever sees a storm frozen on a missing hint.
- **Determinism tests.** tests/storm-workers.mjs and the regression suite should run with feedback off and on. With it off, the world must be bit-identical to today.

**Offline two-way (recommended alongside):** run the model offline on sample engine storms and fit the engine's empirical constants to it. This is the "learned parameterisation" route (for example Rasp, Pritchard and Gentine 2018; Brenowitz and Bretherton 2018), kept simple: fitted tables, not a network. Use paired (engine state → model diagnostic) samples for:
- the updraught against the nest's w;
- the mesocyclone strength against the model's 2-5 km UH;
- cold-pool strength against the model's gust-front speed.

The short-range job asked for exactly these pairs to replace its UH stand-in (SHARED-FINDINGS). The pairs move the engine toward the model in every storm, modelled or not, so nothing depends on players. synccheck.mjs already produces most of the pairs.

## 4. Recommended order of work, with quick tests first

Each step: regression baseline before and after (memory note "regression suite"), and only the tests the change needs.

1. **Quick test: the motion (30 s, no code change).**
   - Rerun the scratch check (tmp/motioncheck.mjs) on seeds 2, 8181 and 5150.
   - Then a synccheck run of 3 storms × 2 h with the worker record's `motion` replaced by the cell's Bunkers right-mover for rotating storms (a local edit in synccheck only).
   - Expect: smaller box `followStorm` drift and a smaller "miss km: unpinned".
   - If it holds, do E1.
2. **Quick test: the maintenance lift (synccheck, 3 storms × 3 h).**
   - Compute M2's `maintenanceConvergence` in synccheck from the record's inflow CIN and the engine's cold pool and lowRotation, and add it to `convergence`.
   - Run with PUSH_MAX at 0.35, 0.2 and 0.1.
   - Expect: near-gone readings stay at 0 with a smaller push.
   - If so, do M2 in the engine and the record.
3. **T2** (model side only): the feed-forward and damped trims. Test on SupercellB and SupercellLife with a forced tornado, plus one synccheck run. Judge by frame-to-frame spin variance and overshoot.
4. **E3** (geometry). Test with synccheck's "meso from updraught" columns and "miss km" unpinned. One day-review check that hooks and couplets still look right.
5. **E2** (one cold pool). Synccheck's cold-pool pair, then one climate check (40 days): tornadoes a day, boundary tornado share, wind reports, against docs/TARGETS-2026-10-25.md.
6. **T1 + X1** (timing and placement hints).
   - The tornado keeper scenario from STATUS "First tornado on the ground": the engine arms, and the model fires within W.
   - With no workers the world must be bit-identical.
   - tests/storm-workers.mjs extended for hint expiry.
7. **E4 and E5** (0-500 m SRH, ECAPE): engine physics with climate refits. Do them only together with a planned climate pass, since each needs the tornado or hail tables refitted.
8. **Offline pairs** for the short-range model's UH and the engine's constants. These can run any time, alongside the rest.

I'd leave alone: M1 as a behaviour change (keep it as a diagnostic), X3 and X4, and a 31 m nest (STATUS already set it aside for cost).

## 5. Sources

- Benjamin, T. B., 1968: Gravity currents and related phenomena. J. Fluid Mech., 31, 209-248.
- Bloom, S. C., L. L. Takacs, A. M. da Silva and D. Ledvina, 1996: Data assimilation using incremental analysis updates. Mon. Wea. Rev., 124, 1256-1271.
- Brenowitz, N. D., and C. S. Bretherton, 2018: Prognostic validation of a neural network unified physics parameterization. Geophys. Res. Lett., 45, 6289-6298.
- Bryan, G. H., J. C. Wyngaard and J. M. Fritsch, 2003: Resolution requirements for the simulation of deep moist convection. Mon. Wea. Rev., 131, 2394-2416.
- Bunkers, M. J., et al., 2000: Predicting supercell motion using a new hodograph technique. Wea. Forecasting, 15, 61-79. https://www.weather.gov/media/unr/soo/scm/BKZTW00.pdf
- Bunkers, M. J., 2018: Observations of right-moving supercell motion forecast errors. Wea. Forecasting, 33, 145-159. https://repository.library.noaa.gov/view/noaa/52733
- Coffer, B. E., and M. D. Parker, 2017: Simulated supercells in nontornadic and tornadic VORTEX2 environments. Mon. Wea. Rev., 145, 149-180.
- Coffer, B. E., M. D. Parker, R. L. Thompson, B. T. Smith and R. E. Jewell, 2019: Using near-ground storm relative helicity in supercell tornado forecasting. Wea. Forecasting, 34, 1417-1435. https://par.nsf.gov/servlets/purl/10289107
- Davies-Jones, R., 1984: Streamwise vorticity: the origin of updraft rotation in supercell storms. J. Atmos. Sci., 41, 2991-3006.
- Grabowski, W. W., 2001: Coupling cloud processes with the large-scale dynamics using the cloud-resolving convection parameterization (CRCP). J. Atmos. Sci., 58, 978-997.
- Grandpeix, J.-Y., and J.-P. Lafore, 2010: A density current parameterization coupled with Emanuel's convection scheme. Part I. J. Atmos. Sci., 67, 881-897. https://typeset.io/pdf/a-density-current-parameterization-coupled-with-emanuel-s-k25gahr254.pdf
- Kain, J. S., 2004: The Kain-Fritsch convective parameterization: an update. J. Appl. Meteor., 43, 170-181.
- Khairoutdinov, M. F., and D. A. Randall, 2001: A cloud resolving model as a cloud parameterization in the NCAR Community Climate System Model. Geophys. Res. Lett., 28, 3617-3620.
- Lemon, L. R., and C. A. Doswell, 1979: Severe thunderstorm evolution and mesocyclone structure as related to tornadogenesis. Mon. Wea. Rev., 107, 1184-1197.
- Mapes, B. E., 2000: Convective inhibition, subgrid-scale triggering energy, and stratiform instability in a toy tropical wave model. J. Atmos. Sci., 57, 1515-1535.
- Markowski, P. M., J. M. Straka and E. N. Rasmussen, 2002: Direct surface thermodynamic observations within the rear-flank downdrafts of nontornadic and tornadic supercells. Mon. Wea. Rev., 130, 1692-1721.
- Markowski, P. M., 2020: What is the intrinsic predictability of tornadic supercell thunderstorms? Mon. Wea. Rev., 148, 3157-3180. https://par.nsf.gov/biblio/10186158
- Naylor, J., and M. S. Gilmore, 2012: Convective initiation in an idealized cloud model using an updraft nudging technique. Mon. Wea. Rev., 140, 3699-3705.
- Nowotarski, C. J., P. M. Markowski and Y. P. Richardson, 2011: The characteristics of numerically simulated supercell storms situated over statically stable boundary layers. Mon. Wea. Rev., 139, 3139-3162. https://pure.psu.edu/en/publications/the-characteristics-of-numerically-simulated-supercell-storms-sit/
- Peters, J. M., C. J. Nowotarski and G. L. Mullendore, 2020: Are supercells resistant to entrainment because of their rotation? J. Atmos. Sci., 77, 1475-1495.
- Peters, J. M., B. E. Coffer, M. D. Parker, C. J. Nowotarski, J. P. Mulholland, C. Nixon and J. T. Allen, 2023: Disentangling the influences of storm-relative flow and horizontal streamwise vorticity on low-level mesocyclones in supercells. J. Atmos. Sci., 80, 129-149.
- Peters, J. M., D. R. Chavas, C.-Y. Su, H. Morrison and B. E. Coffer, 2023: An analytic formula for entraining CAPE in midlatitude storm environments. J. Atmos. Sci., 80, 2165-2186. https://ar5iv.arxiv.org/html/2301.04712
- Rasp, S., M. S. Pritchard and P. Gentine, 2018: Deep learning to represent subgrid processes in climate models. PNAS, 115, 9684-9689.
- Rio, C., F. Hourdin, J.-Y. Grandpeix and J.-P. Lafore, 2009: Shifting the diurnal cycle of parameterized deep convection over land. Geophys. Res. Lett., 36, L07809. https://typeset.io/pdf/shifting-the-diurnal-cycle-of-parameterized-deep-convection-b1z1voav3o.pdf
- Rio, C., et al., 2013: Control of deep convection by sub-cloud lifting processes: the ALP closure in the LMDZ5B general circulation model. Clim. Dyn., 40, 2271-2292. https://www.cnrm-game-meteo.fr/IMG/pdf/rioetal_clidyn_2012.pdf
- Rotunno, R., and J. B. Klemp, 1982: The influence of the shear-induced pressure gradient on thunderstorm motion. Mon. Wea. Rev., 110, 136-151.
- Rotunno, R., J. B. Klemp and M. L. Weisman, 1988: A theory for strong, long-lived squall lines. J. Atmos. Sci., 45, 463-485.
- Sessa, M. F., and R. J. Trapp, 2020: Observed relationship between tornado intensity and pretornadic mesocyclone characteristics. Wea. Forecasting, 35, 1243-1261. https://www.inscc.utah.edu/~krueger/5230/Tornado%20Intensity%20and%20Pretornadic%20Mesocyclone%20Characteristics.pdf
- Thompson, R. L., et al., 2003: Close proximity soundings within supercell environments obtained from the Rapid Update Cycle. Wea. Forecasting, 18, 1243-1261.
- Thompson, R. L., C. M. Mead and R. Edwards, 2007: Effective storm-relative helicity and bulk shear in supercell thunderstorm environments. Wea. Forecasting, 22, 102-115.
- Thompson, R. L., B. T. Smith, J. S. Grams, A. R. Dean and C. Broyles, 2012: Convective modes for significant severe thunderstorms in the contiguous United States. Part II. Wea. Forecasting, 27, 1136-1154.
- Trapp, R. J., G. R. Marion and S. W. Nesbitt, 2017: The regulation of tornado intensity by updraft width. J. Atmos. Sci., 74, 4199-4211.
- Weisman, M. L., and R. Rotunno, 2004: "A theory for strong long-lived squall lines" revisited. J. Atmos. Sci., 61, 361-382.

Project sources read: js/storms/StormEngine.js, Storm.js, StormBudgets.js, StormRotation.js, TornadoEngine.js, StormGeometry.js, StormEnvironmentCoupling.js, StormRealizationPhysics.js, StormModeEngine.js, StormHazards.js, InitiationEngine.js, environmentSampling.js; js/sounding.js; js/cloudmodel/EngineRun.js; js/game/StormWorkers.js, LabWindow.js; native/cloudmodel/cloudmodel.c (followStorm, micro, drives); tools/cloudlab/synccheck.mjs; docs/cloudlab/STATUS.md, PLAN.md; docs/REVIEWER-BRIEF.md; docs/STATUS.md (climate targets).

## 6. Where this used or disagreed with the other research jobs (docs/research/SHARED-FINDINGS.md)

- **Outlooks:**
  - They found that forecast members step storms in 30-minute steps while the live world steps in 5-minute ticks. That supports keeping any feedback out of the statistics (section X): forecast copies already differ from the truth for other reasons, and X4 would add a bias tied to where players are.
  - They agree that the feedback should be placement and timing only.
- **Short-range model:**
  - They confirmed that running the cloud model inside forecasts is unaffordable, and asked for paired engine-to-model samples. I adopted those pairs as the "offline two-way" route, step 8.
  - Their stand-in UH (updraft × meso × 9) would improve with E5 and the pairs.
- **Visuals:**
  - They want coldPoolStrength and gust-front geometry for the shelf cloud and outflow dust. E2 (one cold pool) makes that one consistent number, the same one the model is steered to.
  - They support placement and timing feedback, so the touchdown and position come from one source (T1/X1).
  - **One difference:** they say a 62.5 m nest is not needed for visuals. I agree for drawing, but T1 needs a vortex signal to fire on. The 250 m nest's 0-1 km column spin could serve where the fine nest is not run. That saves about half the tornado-time step cost, at the price of a coarser firing time and position (roughly ±250-500 m).
