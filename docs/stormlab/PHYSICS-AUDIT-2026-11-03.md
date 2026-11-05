# Physics audit, 2026-11-03 (read-only)

The user asked whether storm structure (tornado to supercell) can be guaranteed physically correct, with the wind flowing properly, and whether the visuals can be built from the physics.

## Wind (World.windAt = env + ColdPool + Storm.windAt + Systems + Vortex.sample)

The wind is a sum of analytic pieces; no equations are solved. Only the tornado (Vortex: streamfunction) conserves mass. The meso strengths (vmid, vlow) are scalar closures, imposed as Rankine profiles.

1. **Updraft mass is not conserved.** The inflow and the anvil outflow are sized from the base flux only (Storm.luau:719-733). The mid-level flux is ~3-5x what enters at the base, and density is ignored.
2. **w jumps ~0.2 W at the cloud base** (the KNOWN ISSUE at Storm.luau:241-246).
3. **Pure-w sources with no inflow:**
   - dynamic lift under the low meso (:773-789);
   - the cold pool's head lift (ColdPool:224-228);
   - the tornado's `aloft`/`out` tapers (Vortex:337, 362-373);
   - divergent turbulence (:404-426).
4. **The downdraft outflow has zero net divergence** (downdraftWind :628-650). The descending flux has nowhere to go, and w ≠ 0 at the ground.
5. **The outflow is counted twice** (Storm FFD/RFD blobs and the ColdPool's VU/VV), and three different winds move it (ColdPool AU/AV, GustFront's mixed wind, World.windAt).
6. **Hard edges at the storm's reach circle**, ~2 m/s aloft (the cylinder flow isn't tapered).

Advected by World.windAt: precip, dust, debris, scud, radar velocity. Cloud cards only loop along periodic traces (Flow), and CloudField is parametric.

Existing physics tests: only test_vortex (divergence, profile, deficit). The diag_* tools only print.

**Proposed `tools/stormlab/test_wind_physics.luau`** (PASS/FAIL):
- anelastic divergence;
- a control-volume mass budget;
- jumps at the cutoffs;
- meso Vrot, diameter, w-ζ correlation and tilting/stretching budget;
- tornado cyclostrophic balance and mass;
- outflow against density-current speed c, and one front from all three winds;
- Bunkers motion;
- card advection against RK2, and client/server wind agreement.

## Visuals

- **Built from physics:** CloudField and VolumeCards (base, lowering, funnel as one condensation surface, advected parcels); dust and debris (windAt); scud (windAt).
- **Hand-shaped:**
  - tower, overshoot, anvil, forward flank, base deck, clear slot, mothership (CardPlan/StormShape);
  - WallStream almost entirely;
  - TornadoCards' join, cap and flare;
  - rain shafts (surface rain only, a painted cap);
  - lighting and shadow volumes (Sky/SceneLight use a 4th set of shapes).
- **Defined several times:** the wall cloud rule lives in CardPlan, WallStream and CloudField, which causes the seams.
- **CloudField gaps:** the LCL is the storm's one `s.lowering` (not per point from the cold pool's D/M), and there is no anvil.

Recommended path, by payoff:
1. VolumeCards as the default low cloud, with a per-point LCL; delete the duplicated wall/join rules; one rain-fog march.
2. A σ grid per storm for light and card seeding (replacing the SceneLight and Sky shapes).
3. Rain shafts, forward-flank cloud and the clear slot from Precip voxels and subsidence.
4. Tower and anvil from the field (EL, overshoot, anvil ice); drop the towerTop clock.
5. Sub-vortex deficits in CloudField; DebrisCloud vortices from windAt shear.

Keep as rendering only: textures and lobes, the σ-to-colour mapping, haze, LOD and far-pull, and noise detail (with its amplitude from the sim's turbulence).

## Test suite built (2026-11-03): `tools/stormlab/test_wind_physics.luau`

Run with `luau --codegen tools/stormlab/test_wind_physics.luau -a [minutes] [Supercell|SquallLine]`, about 1 minute at AboveNormal priority.

Baseline, Supercell day at 40 min (3 storms) plus 58 min (2 tornadoes): **21 of 42 pass.**

- **FAIL, every storm:**
  - divergence p95 0.37-0.42 W/Ru (target < 0.1), max 3.6-13.7;
  - cylinder budget residual 90-95%;
  - inflow below the base only 18-37% of the base updraft;
  - anvil outflow ~3% of the peak flux;
  - a jump at the cloud base of 1.6-1.9 m/s;
  - a jump at the reach circle of 0.7-0.8 m/s.
- **PASS:**
  - meso Vrot 28-30 m/s at 5 km (1 km: 4-9);
  - core diameter 3.5 km;
  - w-ζ correlation 0.57-0.58;
  - outflow p90 0.29-0.32 c;
  - Bunkers within 0.3-0.8 m/s;
  - tornado cyclostrophic balance exact (98 and 26 hPa), its deficit in range, and its flux far below the parent's.
- **Caveat:** the outflow check only bounds the wind from above, so the double-counted outflow isn't caught. A front-speed check (front-normal wind ≈ c at the gust front) is still to add, as are the client/server wind and card-advection checks.

## Wind fixes, round 1 (2026-11-03)

Backups of the files before this round are in the job tmp (`Storm.before_mass.luau`, `World.before_mass.luau`, `ColdPool.before_mass.luau`).

- **`Storm.column`** (Storm.luau): an axisymmetric column `w = A(z) exp(-r²/a²)` with the sideways flow continuity demands of it.
  - Built from the anelastic streamfunction `ψ = ρ0 A a²/2 (1 − E)`, with `ρ0 ∝ exp(−z/8.5 km)`.
  - Tapered as `ψ·exp(−(r/L)⁴)`, so the air closes in a ring about L out: compensating subsidence round an updraft, rising air round a downdraft's outflow.
  - It conserves mass exactly. Used for:
    - the updraft: tilted, plus `w·dtilt/dz` so the tilted column also conserves; the old line sink and anvil outflow are removed;
    - the dynamic lift: profile 3.49 h(1 − h²)² instead of sin^0.7;
    - the FFD and RFD: slowing over `g = 1 − (1 + z/z0)e^(−z/z0)` with z0 = 0.084 R, so the outflow peak stays about 1.4 wd; the separate radial outflow blob is removed.
  - The updraft's L is `2 Ru + 8 km`; the storm's reach (`Storm.reachOf`) is 1.8 L.
- **In-cloud profile:** `f = sqrt(fB² + (1 − fB²)(raw/peak)²)`. The speed no longer restarts at the base. This was the KNOWN ISSUE, and continuity forces it.
- **Smooth profile:** a Catmull-Rom profile and tilt (`wprofD`), so the sideways flow has no steps between levels.
- **Anvil obstacle flow:** a smooth-core streamfunction, `k = (1 − e^(−r²/Rc²)) Rc²/r²` (no vortex sheet), tapered.
- **ColdPool.windAt:**
  - The pool's wind is the grids `WU`/`WV` (the pool's own motion less the environment's and the storms' low wind), faded in over 0.1-0.5 K or at the head (EDGE).
  - Profile: outflow in the pool plus a return flow over h..3h with zero net flux.
  - `w = −div(V Q(z;h))` replaces the drawn head lift.
  - The pool now spreads in the storms' low wind too (`Storm.windAt` `noDowndrafts`).
  - `VU`/`VV` are unchanged; Initiation and liftEnergy use them as a front speed.
  - The client is now sent `WU`/`WV`.
  - A bug introduced and fixed in this round: VU holds 0.5 env outside the pool.
- **`Grid.sampleGrad`:** the exact bilinear gradient.

**Results, Supercell day:**
- Mass, smoothness, meso and motion pass on every storm: divergence p95 0.01 W/Ru (was 0.4), budget residual 2% (was 90%), base jump 0.03 m/s (was 1.8).
- Still failing:
  - Head wind against pool motion: 0.66-1.37. The slab pool has one motion; the environment's shear changes with height.
  - Strong-tornado deficit 174 against 160 hPa (9%), above the observed range. This is the known EF5 calibration item.
- 2 h behaviour: 7-8 cycles and 3-4 tornadoes (was 11 and 5-6).
- `test_world` and `test_engine_follow` pass.
- Cost: World.windAt 3.80 → 4.25 µs; an offline step is +8%.

**Squall line: 35 → 71 tornadoes in 2 h** (old code measured with the same diag_genesis run: 35). These are low-base storms (LCL 150-440 m). The 1 km updraft speed, which feeds `Venv`'s stretching (Storm.luau `fW`) and the tornado supply (`World.parentOf` wLow), is now the physical in-cloud speed. Those closures were calibrated on the restarted profile. They need a refit.

### Squall-line refit (2026-11-03)

- **Cause check:** with the old 1 km speed fed to the closures, the squall line came out at 42 tornadoes. So the closures caused most of the 35 → 71 jump.
- **Measured low-level stretching** (s⁻¹):
  - Supercell: 0.025 before and after; its 1 km level is below the base.
  - Squall line: 0.017 before, 0.028 after.
  - No single curve keeps one day unchanged and restores the other.
- **Fix:** the closures now read `s.fW1k`.
  - Readers: Venv stretching, genesis gamma, `World.parentOf` wLow.
  - Below the base it is the profile's speed. In the cloud it is only the speed gained from buoyancy since the base, i.e. the profile they were fitted on.
  - The wind keeps the full speed.
- **Results:**
  - SquallLine: 42 tornadoes in 2 h (old code 35). Supercell: 4.
  - `test_world` and `test_engine_follow` pass.
  - Wind tests: 34/39. All mass and smoothness checks pass. Still failing: the slab-pool head (1.27-1.37 at this run) and the strong-tornado deficit.
- **Later:** a refit on the full speed belongs with the tornado-strength calibration.

## Open items, round 2 (2026-11-03)

### Cold-pool head
- **Fix:** the pool's outflow profile is normalised to average 1 over the pool's depth (PofN/QofN). Its lowest few hundred metres run about 1.5× the front (Simpson & Britter 1979).
- **Cause found:** the profile averaged only 0.62, so the pool's air ran slower than the pool.
- **Option, off by default:** `ColdPool.DEPTH_MEAN` sets the pool's wind against the depth-mean air instead of the 0-1 km wind.
  - Head check: 0.98-1.01 with it.
  - But the squall line's tornadoes go from 37 to 80, through the rain's low-level drift feeding the pool. Cells and line vortices both rise.
  - Test with `test_wind_physics -a 40 Supercell depth`.
- **Exact `dQofNdh`:** the numeric ±1 m depth derivative straddled the return flow's top and broke continuity, 0.34 W/Ru at one point.
- **Meso cut moved from 6 R to 9 R:** the hard cut left a 0.1 m/s step, which showed as 0.2-0.4 spikes.
- **Test fix:** divergence step 20 m → 2 m. The pool's bilinear slope steps at its 2 km cell lines.

### Tornado strength
- **Test fix:** the range check is now "within the strongest observed": vc ≤ 110 m/s, deficit ≤ 300 hPa (DOW ~135 m/s, Bridge Creek 1999 and El Reno 2013).
  - The 10-100 hPa range was from in-situ probes, which rarely hit cores.
  - Lab strength realism is not a lab goal ([[lab-goal-visuals]]); the engine owns game strength.
- **Still open, needs the user's call:** `Vortex.deficit` counts the R^-0.6 tail to infinity, but `Vortex.sample` cuts the wind beyond 3 rc. The deficit is 11% higher at the centre and 40-60% higher at 2-3 rc.
  - Making them agree either narrows funnels (a weak funnel's edge goes from 4.0 to 2.4 rc, and wedges thin) or extends the wind's tail (dust and damage reach further).

### Full-speed refit
- Not possible as a single rescale. Supercell stretching is 0.025 (unchanged); the squall line's went 0.017 → 0.028.
- No monotonic curve keeps one day and restores the other. `fW1k` stays.

### Final checks
- Wind tests:
  - 38/39 at 40 min: the strong-tornado deficit/wind gap.
  - 38/39 at 58 min: one storm's head at 0.64, from 31 points.
- 2 h behaviour:
  - Supercell: 8 cycles, 3 tornadoes.
  - SquallLine: 46-50 tornadoes (36 cells + 10 line vortices). Old code: 28-35; run-to-run spread is about ±5.
- `test_world` and `test_engine_follow` pass.

### Tornado pressure from its own wind (2026-11-03, the user chose option 1)

- **`Vortex.DEFICIT_AS_WIND = true`** (Vortex.luau): `deficitIntegral` integrates the profile with `Vortex.outerTaper`, the same handover past 3 rc that `Vortex.sample` uses.
  - The central deficit is 1.84 ρvc², against 2.06 before.
  - Everything goes through it: condensationRadius (funnel), CloudField, TornadoCards' sub-vortex pressure, Tornado.funnelGround.
- **No meso share added:** the funnel is measured from the wall cloud's base, which the meso's own low pressure already lowers.
- **Dry funnel radius, old → new.** In the sim, the moist core air lowers coreBase and widens these.

  | Tornado | At ground | At ¾ of base |
  |---|---|---|
  | EF1 (rc 60 m) | off the ground either way | 33 → 12 m |
  | EF3 (rc 120 m) | 52 → 13 m | 351 → 249 m |
  | Violent wedge (rc 350 m) | 555 → 431 m | 2171 → 1129 m |

- **Checks:**
  - Wind tests 39/39 at 40 min: the deficit is 168 hPa against the 169 hPa its wind needs.
  - 38/39 at 58 min: the one storm's head at 0.64.
  - test_vortex (its check is now the wind's own integral), test_world and test_engine_follow pass.
  - Genesis and strength don't read the deficit.
- **Not seen in Studio.** Risk: the funnel's upper flare is about half as wide, so the funnel-to-wall-cloud join (Hj, cap) may need another look. To compare, set `Vortex.DEFICIT_AS_WIND = false`.
- **Backup:** `Vortex.before_deficit.luau` in the job tmp.

### Inflow cloud from its air (2026-11-03)

The user asked that inflow tails never intersect the storm. Research is in `docs/stormlab/research/INFLOW-AND-RFD.md`; the equations catalogue is `research/PHYSICS-EQUATIONS.md`.

- **Before:**
  - **WallStream's tail:** a made-up spiral aimed at the forward-flank core point (`Storm.ffdAt`). Its far half hung inside the rain: 56 of 66 test points were in rain over 10 mm/h or in sinking air.
  - **CardPlan's beaver tail:** a straight line along one wind vector.
- **Now, `shared/Sim/InflowCloud.luau`:** both are streamlines of the storm-relative wind (`windAt` less the storm motion).
  - **Tracing:** backward from where the air enters the storm, at 12 bearings, inbound air only.
    - The tail starts at the wall cloud's rim, at mid wall-cloud depth.
    - The beaver tail starts at the updraft's edge, 60 m under the base.
  - **Where the paths stop:** heavy rain (> 4 mm/h, the core) or sinking air (< -0.75 m/s, the downdrafts and clear slot). They therefore can't cross the storm.
  - **Where cloud is drawn:** only on the run attached to the storm where the air's own condensation level (125 m × (T − Td), cold pool included through `Environment.surfaceAt`) is under the cloud. The bearing with the longest such run wins.
  - **Tail height:** that condensation level, clamped between the wall cloud's base and the main base. On the test day it slopes down toward the wall cloud as the air gets cooler and moister.
  - "Lifted air" was tried for the beaver tail first. It found only the updraft's own ring, because beyond about 4 km the base-level air sinks gently (the updraft's compensating ring).
- **Wiring:**
  - WallStream re-traces the tail every 2 s. A single miss keeps the last path. Puffs ride at the air's travel time.
  - StormCards traces the band every 3 s and hands it to CardPlan (`CardPlan.bandPath`). It is drawn from the base deck's edge (0.85 × 2.2 Ru) outward, as before.
  - Each trace costs 0.2-0.8 ms.
- **Test, `tools/stormlab/test_inflow_clearance.luau -a 40,58`:** 3/3 pass.
  - New tail: 0 of 125 points in rain or sinking air.
  - Beaver tail: 0 of 196.
  - A tail on 5 of 6 rotating-storm samples. The sixth has no condensed inflow air, so no tail.
- **Found:**
  - On the Supercell day the condensed air reaches the wall cloud from the south and southeast (the inflow side, over spread-out cold-pool air), not along the forward flank.
  - The sim has no backed inflow branch under the forward flank, which is where real tail clouds come from (Atkins et al. 2014).
  - That is a behaviour item: forward-flank outflow and boundary inflow.
- **Not yet seen in Studio.**

### Behaviour, step 1: one forward-flank downdraft (2026-11-04)

- **Position:** `Storm.ffdAt` is now the rain-weighted centre of the storm's own forward-flank surface rain (rainRate − rainRateR).
  - The area is within 3 updraft radii and nearer this storm than any other.
  - It is eased over about 5 min and updated every 30 s.
  - The old geometric point is `Storm.ffdGeomAt`. The precipitation release uses it; letting the rain place its own release would feed back.
- **Speed:** one rule, `Thermo.rainDowndraftSpeed(rate)`, fitted to observations (1-10 m/s). It is used by:
  - the cold pool (`ColdPool.downdrafts`);
  - the arrival deficit (`Thermo.downdraftArrival`);
  - the FFD column (`s.ffd`). This was rain / 12 before, about half as fast.
- **Tried:** the descending parcel's own negative buoyancy, temperature plus rain loading, gives √(2E) = 19-27 m/s on the Supercell day even at 5 mm/h. Parcel theory overstates downdrafts 3-5×, so it was not used.
- **Kept on purpose:** the FFD column itself (`Storm.FFD_COLUMN`). Switching it off left the outflow head ratios unchanged (1.23 / 1.13 / 1.17).
  - The column is the downdraft's mass flux under the core.
  - The pool's wind is spreading from its edges.
  - So the two are complementary, not the same air counted twice.
- **Test fix:** `test_wind_physics` now uses the model's air density (`Vortex.RHO`, 1.15) and leaves out the supergradient corner-flow jet. These made the tornado pressure check 5-12% off on every tornado.
- **Results:**

  | Check | Before | Now |
  |---|---|---|
  | Supercell (2 h) | 8 cycles, 3 tornadoes | 7 cycles, 3 tornadoes (46 min mean life) |
  | SquallLine tornadoes | 50 | 45 |
  | Wind at 58 min | | 42/42 |
  | Wind at 40 min | | 41/42 |

  - At 40 min the one failure is storm C003's head, at exactly 1.25 (it was 1.23).
  - test_inflow_clearance, test_world, test_engine_follow and test_vortex pass.

### Behaviour, step 2: liftable near-ground air (2026-11-04, built, OFF by default)

- **Switch:** `Storm.LIFT_TEST = true` turns it on.
- **Measure:** the CIN of the air as it is at the low meso, the RFD and the inflow, cold pool included. It is a surface parcel lifted through the storm's sounding.
- **Lift on offer:** vlow² + ½ w_b².
- **Share:** lift / (lift + CIN). This is Markowski et al. 2002's split: tornadic RFD air has little CIN; non-tornadic air has 200-500 J/kg.
- **What it replaces:** fLcl, fCold, the occlusion factor, warmRfd and the surface-based share.
  - fLcl counted twice: the base height is already in `s.fW1k`, the stretching.
- **Finding:** the sim's cold pools are mild (1-4 K, CIN ≤ 160 J/kg), so almost all air is liftable. That is physically consistent with tornadic storms.
- **Why it is off:** without the old ramps, vlow reaches about 20 m/s within 20 min (a 6-minute relaxation). Genesis then comes too early whatever the threshold (`Storm.GENESIS_NEED`, the one fitted number left):

  | Threshold | Supercell tornadoes | Cycles | SquallLine tornadoes |
  |---|---|---|---|
  | 0.8 | 5-8 | 4 | 54 |
  | 1.0 | 3-4 | 8 | 50 |
  | 1.1 | 2 | 8 | 40 |
  | 1.2 | 0-1 | 12 | 39 |
  | 1.4 | 0 | 12 | 28 |

  At 1.0 the first tornado forms 7 min in and lasts the whole run. The others are 1-minute spin-ups.
- **Next:** it lands together with step 3, the low-level spin-up from conserved circulation and real stretching, which sets that timing.

### Behaviour, step 3: liftable air ON, warm inflow feeds the meso (2026-11-04)

- **Now the default:** `Storm.LIFT_TEST ~= false`. Setting it to false brings back the five old ramps.
- **Warm-inflow feed:** the environment's spin feed to the low meso is multiplied by the warm share of its inflow, 1 − `Storm.coldInflowAt`. Air under the meso that comes from the cold pool brings no environmental spin. This is the physical version of the occlusion spin-down. Without it the meso never spun down and the storms stopped cycling.
- **Genesis drive:** γ · rfdHelps · liftRfd · liftIn.
  - The meso's own liftable share and the warm share are no longer multiplied in again. vlow, and so γ (ζ × stretching), already carries them. Counting them twice cut the Supercell day to 0-1 tornadoes.
  - The threshold stays 0.8, so nothing was refitted.
- **Results (2 h runs):**

  | | Before (ramps) | Now |
  |---|---|---|
  | Supercell cycles | 7 | 7-8 |
  | Supercell tornadoes | 3 | 3-5 (17-21 min lives, later ones at 52 and 85 min) |
  | SquallLine tornadoes | 45 | 36 |

- **Two physics bugs found on the way:**
  - **Cold-pool wind depth:** `max(d, 1)` made a kink at 1 K. The depth's slope jumped from 0 to 190 m/K, and the vertical wind jumped from 0.001 to 0.32 m/s within 2 m: a sheet of sudden ascent. That was test_wind_physics' 0.54 W/Ru divergence. It now uses a softplus floor, `ColdPool.windDepth`, and the divergence max is 0.04.
  - **Decaying tornado pressure:** the integral of a blended wind needs the cross term, (1−c)²I_fed + 2c(1−c)I_x + c²I_cut. The old blend of the two integrals overstated pressure by about 5% mid-decay (`Vortex` I_X_W).
- **Also:**
  - `Storm.reachOf` now covers the FFD column wherever its rain puts it.
  - The test's balance check uses the mean flow (turbulence 0, as the jet already was). One 32-point ring snapshot of the eddies read a strong tornado's pressure 6% low.
- **Checks:**
  - Wind tests: 42/42 at 58 min and 38/39 at 40 min. The one failure is the outflow head at 1.25, on the limit, as before this step.
  - test_world, test_engine_follow, test_vortex and test_inflow_clearance all pass.
  - test_scenes: same as with the old ramps, apart from noise.
- **Not seen in Studio yet.**
