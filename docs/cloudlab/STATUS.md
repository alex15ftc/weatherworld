# Cloud Lab: storms from the equations (started 2026-11-04)

The Storm Lab rebuilt from scratch on a real 3-D cloud model, the user's option A from docs/stormlab/DIAGNOSIS-2026-11-04.md. The old lab (roblox/src/stormlab) is untouched.

## Model (roblox/src/cloudlab/shared/Model)

- **CloudModel.luau** solves the following, all on an Arakawa C grid:
  - quasi-compressible momentum with buoyancy;
  - pressure perturbation (p′);
  - θ, qv, qc and qr.
- **Numerics:**
  - Wicker-Skamarock RK3 with acoustic substeps;
  - 3rd-order upwind advection;
  - constant-K diffusion;
  - Rayleigh sponge.
- **Boundaries:** free-slip ground, open sides.
- **Microphysics:** Kessler warm rain with Klemp-Wilhelmson coefficients, saturation adjustment.
- **Sounding.luau:** the Weisman-Klemp 1982 sounding with the CM1 quarter-circle hodograph (Us 31 m/s).

## First test (tools/cloudlab/wk82.luau, 2 h)

- **Grid:** 64×64×32 points, dx 1 km, dz 500 m, dt 6 s.
- **Speed:** 201 ms per step, 30× real time on one thread.
- **What came out of the equations:**
  - updrafts of 40-50 m/s and downdrafts down to −26 m/s;
  - a cold pool of −8 K and surface rain of 150-250 mm/h. Kessler is known to be heavy on both.
  - **The storm split at 35 min.** The right-mover stays dominant, at 25-29 m/s with ζ(5 km) about 0.03 s⁻¹. Low-level ζ is about 0.01-0.018 s⁻¹, and new cells form on the gust front.
- **Right-mover motion:** about (13.6, 2.1) m/s ground-relative, now the test's frame motion.

## Round 2 (2026-11-04)

- **Stretched vertical grid:** 100 m at the ground growing by 12% a level to 700 m, 33 levels to 16 km. Vertical sound waves are now implicit, with w and p′ solved together per column (Klemp-Wilhelmson / CM1), so the thin levels don't limit the step.
- **Surface drag:** log-law drag, Cd 0.0041 with z0 0.1 m, using base-state substitution (Roberts et al. 2016).
- **Storm following:** 2-5 km updraft helicity, 3×3-smoothed, searched within 12 km of the box target, moving at most one cell per step. It holds the right-mover at cell (31-33, 26-29) for 2 h.
- **2 h results:**
  - 50 m vorticity grows to 0.03-0.04 s⁻¹ after 70 min.
  - The friction and free-slip runs are much alike at dx 1 km. That's expected: friction's role in tornadogenesis shows at 100-250 m.
  - 287 ms per step, about 21× real time with two runs sharing the machine.
- **Roblox:**
  - roblox/cloudlab.project.json, built with `rojo build cloudlab.project.json -o build/cloudlab.rbxl`.
  - The server steps the model within a frame budget (`model.yieldFn`, Workspace attribute CloudLabBudgetMs, default 6) and sends Snapshot buffers.
  - The client draws a tabletop at 1 km = 100 studs: cold-pool ground, cloud runs, rain shafts, and rotation posts (red: 50 m ζ > 0.01; magenta: 1 km).

## Round 3: the fine nest (2026-11-04)

- **Nest.luau:** a one-way nest of 48×48 cells at 250 m (ratio 4, dt 1.5 s) on the parent's vertical grid.
  - Its boundary is interpolated from the parent: bilinear in space, linear in time.
  - It starts at 50 min under the smoothed low-level circulation, and is placed by `Nest.place` on the ~250 m-smoothed 50 m ζ.
  - It moves with the parent's storm-following shifts. **The strip that enters is re-sampled from the parent, not copied.** A copied edge made a fake shear line that read as a 50 m/s "vortex".
  - Recentring keeps a nest vortex (≥ 0.01 s⁻¹) near the centre. With no vortex, it steers back to the parent's circulation; chasing weak maxima walked the nest off the storm.
- **Diffusion now acts on perturbations only.** The base state's own diffusion is subtracted. Before, it warmed the lowest level by 1.2 K an hour and diffused the low-level shear away. With no storm, the environment now holds exactly for 60 min.
- **Saturation uses the full pressure p0 + p′,** so a low-pressure core cools and condenses.
- **Sounding.wk82:** takes `hodoR` / `hodoD` for a stronger, shallower low-level hodograph curve. R12 over 1 km moved the storm differently; tune the frame motion before using it.
- **Result, default WK82, z0 0.1:**
  - A mesovortex forms in the nest on its own at 66-90 min: 50 m ζ up to 0.057 s⁻¹ at 86 min, p′ −2 to −3.4 hPa, cloud base lowering from 1.2 to 1.0 km, the lowest cloud at 212 m.
  - **It is not a tornado:** the wind is only about 20 m/s. A 250 m grid can't hold a tornado core (it needs ≲ 50-100 m), so the next level is a third nest at about 60 m.
  - The nest costs about 650 s wall per 70 model minutes, about 6.5× real time in the CLI.
- **Roblox:**
  - The server starts the nest at `CloudLabNestStart` (default 45 min, negative = off) and sends `NestSnapshot`: the lowest cloud below 3 km, 50 m ζ, wind and p′ per 250 m column.
  - The client draws dark-grey nest cloud columns and red posts where ζ > 0.02, and adds a HUD line.
  - The place is rebuilt in build/cloudlab.rbxl but has **not yet been checked in Studio.**

## Round 4: the 62.5 m nest and a faster setup (2026-11-04)

- **Nests are recursive:** `Nest.advance` steps a model and then its child, and `Nest.shiftBy` carries a shift down the chain. tools/cloudlab/nest2.luau runs 1 km → 250 m (from 50 min) → 62.5 m (from 75 min, on the 250 m grid's 50 m ζ max).
- **Horizontal mixing scales with spacing** in nests: Kh = parent Kh / ratio, so 75 → 18.75 → 4.7 m²/s. Vertical mixing stays at 75.
- **`steps` option:** nest steps per parent step, which can be fewer than the spacing ratio.
  - The fast setup uses 2 for the 250 m grid (3 s) and 4 for the 62.5 m one (0.75 s), with a 32×32 box (2 km) for the 62.5 m grid.
  - The whole 105 min run takes 741 s, about 4× faster than 4/4 with 48×48.
  - The 250 m results match within a few percent (ζ 0.070 at 84-85 min in both).
- **Result:**
  - The 62.5 m grid reaches 50 m ζ of 0.11-0.16 s⁻¹ at 83-91 min and again at 102-103 min.
  - But the wind is only 14-18 m/s, there is no pressure low (lowest-level p′ min about 0), and the lowest cloud is about 635 m.
  - That's a shear-zone vorticity strip under a cold pool, not a closed tornado.
  - The air near the ground under the meso is −5 to −7 K (Kessler), and air that cold resists being lifted and stretched. Cold RFD/outflow air is a known tornado killer (Markowski et al. 2002).

## Round 5: hail, stronger low-level shear, mixing (2026-11-04)

- **Hail/graupel category qh** (CloudModel.micro, Lin et al. 1983 forms):
  - graupel from cloud below 0 °C, riming of cloud, collection of rain, Bigg freezing;
  - shedding and melting above 0 °C, latent heat of fusion;
  - fast fall (mass-weighted 10-25 m/s, subcycled), plus hail loading in buoyancy.
- **Hail size is a setting:** `cfg.n0h`, default 4e2 m⁻⁴ (large hail; Snook & Xue 2008, Dawson et al. 2010). Off with `cfg.hail = false`. A single-column check (5 g/kg at 5 km in calm air) brings about half the hail to the ground.
- **1 km cold pool, 60-120 min:**
  - Kessler alone: −8 to −8.5 K;
  - n0h 4e4 (graupel-like, all melts): −10 to −11 K;
  - n0h 4e3: −7.3 to −9.7 K;
  - n0h 4e2: −6 to −7.7 K.
  - Surface precipitation, liquid equivalent including hail, reaches 500-1000 mm/h in the hail core, which is too much.
- **Three grids with large hail, default WK82:**
  - The air at the 62.5 m vortex is now −1 to −3 K, down from −5 to −7.
  - 50 m ζ 0.10-0.16 s⁻¹, wind 18-26 m/s, pressure drop vs the nest mean 0.5-1.2 hPa, lowest cloud 100-212 m.
  - Still not a tornado.
- **`Sounding.bunkers`** gives right-mover motion as the frame. The 0-1 km SRH is: WK82 R7/2 km 80, R10/1 km 229, R12/1 km 281 m²/s².
  - R10 and R12 (250 m nest from 30 min; 62.5 m nest auto-started when the 250 m ζ ≥ 0.04): more mid-level rotation (UH 700-900) but *weaker* near-ground rotation (250 m ζ 0.02-0.05).
  - In R12 the 62.5 m nest lost its vortex and wandered. **Stronger shear alone didn't help.**
- **Vertical mixing scaled down in the nests** (tool flag `kvScale`): no better. The vortex peaked at 0.125 s⁻¹ and 15-18 m/s, with colder air at it (−3 to −4 K). **Mixing isn't the limiter**, so it stays at the parent's K.
- **nest2.luau:** `[nest2StartMin]` negative means auto-start on the 250 m ζ; the tool also prints the vortex's pressure drop and θ′.

## Round 6: thin bottom levels, a vortex profile, two-way nests (2026-11-04)

- **Thinner bottom levels** (tool arg `dzmin`): 50 m (39 levels, Cd 0.0052) and 25 m (45 levels, Cd 0.0069).
  - At 50 m the vortex is about the same as at 100 m: ζ up to 0.16 s⁻¹, about 21 m/s.
  - At 25 m it's weaker, mostly ζ < 0.06. **The near-ground layer isn't the limit**, so the grid stays at 100 m.
- **Vortex profile at 82 min:**
  - Near the ground, 62.5 m ζ is 0.109 s⁻¹ at 50 m, 0.062 at 275 m, 0.010 at 557 m, and only about 0.004 at 1-3 km over the vortex.
  - The updraft over it is 8-10 m/s, and p′ at the ground there is +0.5 to +0.8 hPa.
  - The spin is shallow, with no rotation directly above it.
- **Two-way nesting** (`Nest.feed`, on by default; `feedback = false` for one-way): after its steps, each nest's u, v, w, θ, qv, qc, qr and qh are averaged onto the parent cells it covers, more than 2 parent cells from its edges. p is left to the parent.
  - Two-way vs one-way: the 1 km mesocyclone in the 250 m nest is 0.013-0.027 vs 0.013-0.039 s⁻¹, and the 62.5 m vortex peaks at 0.199 / 0.177 s⁻¹ with about 22 / 24 m/s. **No real difference.**
  - The 1 km rotation (0.02-0.04 s⁻¹) is a reasonable low-level mesocyclone, but it isn't over the ground vortex.
- **The fine nest's search** now covers its whole parent when the parent has no storm centre, so it follows the 250 m vortex, not the 250 m nest's middle.
- **Roblox:**
  - The server runs the 250 m nest from 30 min (`CloudLabNestStart`) with 2 steps, and the 62.5 m nest (32², 4 steps) once the 250 m 50 m ζ reaches `CloudLabFineStart` (0.04), checked once a minute. It sends `FineSnapshot`.
  - Nest snapshots carry their position in the outer box.
  - The main snapshot has an 11th field, surface hail, and the client tints rain shafts white by the hail share.
  - The client draws both nests (`nestView`).
  - All lab scripts compile (luau-compile); a broken HUD string from round 3 was fixed. **Not yet checked in Studio.**

## Round 7: the engine decides, the cloud model shows it (2026-11-04)

Decision (user): the engine makes every storm decision: where and when a storm starts, its track,
its strength, tornadoes, decay. Roblox uses the cloud model only to show the physics of that storm,
from initiation to decay. So the cloud model follows the engine and is steered toward it
(nudging, the way forecast models are pulled toward observations).

Built:
- `Sounding.fromProfile(rows)`: an engine sounding (LabWindow rows: p, T, Td, u, v) as the base
  state. Heights come from the hypsometric equation. Checked on S0008: the model's parcel has
  CAPE 2316 J/kg and LCL 2.2 km, against the engine's MLCAPE 1891 / SBCAPE 2530 and LCL 2.1 km.
- `CloudModel.drive`: updraft nudging (Naylor & Gilmore 2012) inside an ellipsoid. It lifts air
  toward a target w wherever w is weaker. `inBox` keeps the lift under the followed storm.
- `tools/cloudlab/json.luau`: JSON reader for command-line runs.
- `tools/cloudlab/engine_storm.luau`: runs the model in an engine scenario (an export from
  scripts/export-lab-scenario.mjs). Base state from the focus storm's cell, frame moving at the
  engine storm's motion. It lifts for 15 min at the start, then keeps lifting at
  `lift x engine intensity` for the rest of the life. Prints the model's storm next to the
  engine's track every 15 min.
- `roblox/src/stormlab/data/SupercellLife.luau`: seed 8181, S0008 from age 10 min, 5 h of
  engine track. It covers birth, a tornado at +140 min and decay to intensity 0.33.

Results (S0008, 1 km box):
- A warm bubble does nothing (the high LCL, 2.1 km).
- A 15-min lift with a 5 km radius gives a 15 m/s pulse that dies by 45 min.
- Steady lifting with a 4 km radius at 4 or 8 m/s keeps only a weak cell (w5km 1-3 m/s).
- A 10 km radius (the standard size) at 8 m/s gives a real supercell at first: UH 800,
  w 33 m/s, -7.5 K cold pool, 200 mm/h rain and hail. Then it collapses by 45-60 min and
  stays weak, while the engine's storm stays at intensity 0.7-1.0 for 4 hours.
- Why: this sounding is hot and dry underneath (T 31 C, Td 15-17 C, LCL about 2 km). The
  model's rain makes a strong cold pool that undercuts the updraft: an outflow-dominant storm.
  The engine's own cold pool target is about 4 K (`updateStormColdPool`), so the deficits are
  similar. The difference is that the engine storm doesn't depend on its inflow staying warm.
- The mature-stage environment (`Supercell` export: S0008 at age 80 min, MLCAPE 2558, LCL 1.9 km),
  with the same 10 km / 8 m/s lift, lasts the whole 2 h. But it pulses rather than staying a
  steady supercell: w5km 37 -> 16 -> 4 -> 23 -> 17 m/s and UH 976 -> 50 -> 169. The followed core
  jumps between cells (box shifts -1,6 -> -7,-1 -> -11,6), and the cold pool reaches -10 K. Hail
  is about 90% of the surface precipitation, which looks too high (the n0h 4e2 large-hail
  setting).
- The environment is also frozen at the start cell. The engine storm moves about 100 km into
  air that keeps heating through the afternoon. The model has no surface fluxes and no refreshed
  inflow.

## Round 8: following the engine through the whole life (2026-11-04)

Built (all steering comes from an engine field; the structure is the model's own):
- **Moving air:** `CloudModel.relaxEnvironment`. The base state eases (15 min) toward a new
  sounding (`m.env`), and every point of a level takes the same change, so the storm's own
  disturbance rides on the new air. Base-state code is now `CloudModel.profiles` +
  `CloudModel.hydrostatic`; a standard 20-min test is identical to before.
- **Engine motion:** `CloudModel.setMotion` changes the frame's speed (nests follow).
- **Cold pool:** `CloudModel.coldPoolRate` / `applyColdPool`. The cold air's deficit (below
  1.5 km) is scaled toward the engine's `coldPoolK` over 10 min; the shape and gust front are the
  model's.
- **Two lifts:** `drive` and `drive2`, passed to nests (offset by the nest corner). While the
  engine has a tornado down, `drive2` is a low lift (z 700 m, r 2.5 km) under the model's
  strongest 1 km rotation.
- **Following updrafts:** `followStorm` falls back to the strongest 4 km updraft when nothing
  rotates yet, so the box (and the lift) stays with a young or pulsing storm.
- **Nests** copy the parent's current air when they start and take its env, cold-pool rate and
  lifts every step.
- **`EngineRun.luau`** (shared/Model): one engine storm shown by the model.
  `EngineRun.new(record, { startRows, nest, lift, liftR, torLift, env, cold })`,
  `run:update(record)` (nil = the engine ended it), `run:step()`. The inflow air is held until
  the 15-min start lift is over. `tools/cloudlab/engine_storm.luau` now replays an export
  through it.
- **Engine side:**
  - `LabWindow.inflowSounding` (the cell 24 km back along the 0-1 km storm-relative wind);
  - `labStorms` now carries `coldPoolK`;
  - `/api/game/v1/lab/storms?inflow=1` adds each storm's inflow sounding;
  - the export's track has `motion`, `coldPoolK`, `active` and `inflow` every 15 min.
  - `SupercellLife` now has an 8 h track: the engine ends S0008 at about 360 min.

Bug found and fixed: `applyDrive` returned nothing, so the 15-min start lift was dropped after
one step (the later lifts are re-made every step). With it fixed, the start matches the engine:
w5 33 m/s and UH 815 at 15 min.

Results (S0008, 5 h, everything on, before the start-lift fix):
- **Air only, no cold-pool steering:** the storm dies at 120 min and never returns.
- **1 km box, all steering:** pulses, with dead gaps (w5 2-4 m/s) while the engine says 0.7,
  then a blow-up (-19.7 K, 700 mm/h).
- **With the 250 m nest, all steering:** alive from 75 min to 300 min (w5 15-32 m/s, UH 100-460).
  The cold pool mean is held at 3.1-3.6 K (engine 3.5 K), and 250 m spin is 0.06-0.12 /s around
  the engine's tornado time.
- **Decay:** at 300 min the engine is at 0.33 and the model storm is still strong.
- **Still high:** hail is about 85-90% of the surface precipitation, and peak rates reach
  300-700 mm/h.
- **Speed:** the nested run is about 7.3x real time on one core (the game clock is 8x).

Full life after the fix (nest on, 420 min, engine ends S0008 at about 355 min; 57 min wall):

| Stage (min) | Engine | Model |
|---|---|---|
| 0-30 start | intensity 0.76-0.96 | w5 33 m/s, UH 815 at 15; 195 mm/h by 30 |
| 45-165 mature, tornado at 135 | 0.7-1.0 | weak: w5 3-11 m/s, no rain from 90 to 165; 250 m spin 0.06 at 120-135 but no rotating updraft above it |
| 180-255 | 0.68-0.71 | strong again (w5 23-33 m/s, 170-660 mm/h, cold pool 4-6 K) but not rotating (UH at the 50 floor) |
| 270-345 decay | 0.50 -> 0.16 | 21 -> 12 -> 4 -> 2 m/s: dies with the engine |
| 355+ ended | gone | stays dead; a -3 K cold pool lingers (no surface heating to remove it) |

So the start and the decay follow the engine. The mature stage doesn't do so reliably: the run
before the fix (same steering) stayed alive and rotating from 75 to 300 min, and this one has a
75-min gap and a non-rotating middle. The model storm is chaotic, and the lift, kept at the box's
follow target, can sit over the cold pool instead of the inflow.

## Round 9: a mature stage that holds (2026-11-04)

- **The lift goes on the inflow side** (`EngineRun.liftSpot`, every minute, moving at most 2 km a
  minute). It starts under the model's 3 km updraft and walks upwind against the 0-1 km
  storm-relative wind until the ground air is out of the cold pool (theta' > -0.5 K), then 1.5 km
  further. Option `liftAt = "box"` keeps the old fixed spot.
- **The real fault was the lift's strength, not its place.** A trace under the lift (seed 5150,
  CIN -8 to -17, cloud base 700-900 m: very favourable air) showed the 8 m/s target held only
  about 3.3 m/s. The model's pressure answers each nudge and takes most of it back at a 30 s
  nudging time, leaving a broad weak rise that the low-level shear swept through without a storm.
  The start lift (5 s) reached its target, which is why the start worked and the middle didn't.
  `EngineRun.LIFT_TAU = 5` now.
- **Second test storm:** `SupercellB` (seed 5150, S0002, 90 min track ending in a 185 mph
  tornado; 0-6 km shear 33-34 m/s).
- **S0008's hodograph** puts almost all its shear below 3 km (0-3 km 28 of 29 m/s), weak flow
  aloft: an HP setting. With the weak lift this cycled and collapsed.

Results (1 km box, all steering, inflow-side lift, 5 s nudging):

| | S0008 (5 h) | S0002 (2 h) |
|---|---|---|
| start | w5 33 m/s, UH 815 at 15 min | w5 21, UH 453 at 15 min |
| mature | rotating supercell with no gaps from 30 to 255 min: w5 21-40 m/s, UH 143-653 | rotating 15-90 min: w5 14-21, UH 93-172 |
| tornado time | strongest low-level spin just after it (UH 653, 1 km 0.078 /s at 150 min) | 1 km spin rising at 90 min (0.019) |
| decay | follows the engine: 22 -> 8 -> 3 m/s at 270-300 min | dies after the engine's track ends (90 min) |
| problems | ground rates 400-1300 mm/h, ~85-90% hail; the model storm drifts about 85 km south of the frame over 5 h | ground rates 400-680 mm/h |

Notes:
- The drift is the model's own propagation against the engine's motion. The renderer should put
  the model storm (the box's follow target) at the engine storm's position: the engine decides
  where.
- Not re-run with the nest (a full nested life takes about an hour).

## Round 10: snow, smaller hail, and the first Studio staging (2026-11-04)

The hail terms (fall speed, collection, melting, Bigg freezing) checked out against Lin et al.
(1983). The fault was a missing category: with no cloud ice or snow, everything the cold cloud
made became large hail (n0h 4e2, about 25 m/s) falling in the core. At 5 g/kg that alone is about
440 mm/h.

Built:
- **Snow `qsn`** (Lin et al. 1983 forms; prognostic everywhere hail is: advection, buoyancy,
  nests, nest feedback, shifts):
  - cold cloud glaciates to snow, faster the colder (300 s at -40 C, scaling (Tc/-40)^2), and all
    of it at -40 C;
  - deposition and sublimation over ice (Bergeron: cloud then evaporates to feed the snow);
  - riming of cloud water;
  - heavily rimed snow turns into graupel (PGAUT);
  - melting below 0 C into rain;
  - falls at about 1-2 m/s;
  - counts as visible cloud in the snapshot, so the anvil shows.
- **Rain first:** cloud collecting into drops below 0 C now makes rain, which freezes by the Bigg
  rate (Lin's form). `autoToIce = true` restores the old shortcut.
- **Hail intercept default 4e4** (Lin's hail) instead of 4e2.
- **Test tool** reports the anvil (9 km cloud, km2), peak snow and the hail share of what
  reaches the ground.

Results (1 km box, all engine steering):

| | old (no snow, 4e2) | snow, 4e2 | snow, 4e4 (now) |
|---|---|---|---|
| S0008 peak at ground (mm/h) | 400-1300 | 225-710 | 70-280 |
| S0008 hail share | 85-90% | 60-73% | 1-20% |
| S0002 peak / hail share | 400-680 / - | 95-640 / 15-40% | 115-330 / ~0% |
| anvil at 9 km | almost none | 500-1700 km2 | 600-1700 km2 |

- The supercell still holds through the mature stage and decays with the engine (S0008
  UH 270-580, S0002 UH 125-215).
- S0008's cold pool mean is 3-5 K (engine 3.5 K).
- The WK82 case still splits (UH 426, w 37 m/s at 30 min).

Studio staging:
- **Lab server engine mode:** workspace attribute `CloudLabScenario` (default "SupercellLife";
  "" = the WK82 case). The scenario modules come from `ServerStorage.CloudLabData`
  (= src/stormlab/data), decoded with HttpService:JSONDecode.
- `EngineRun.fromScenario` / `replayStep` / `trackNow` are the replay the tool and the lab both
  use.
- The HUD's first line is the engine's side (`CloudLabEngine`).
- **Tested in Studio** (build/cloudlab.rbxl, play test):
  - no errors;
  - the scenario decodes;
  - EngineRun steps and the view folders fill;
  - about 1.9 s per 6 s model step at the 12 ms/frame budget: about 3x real time. The window was
    not in the foreground, so this may be Windows throttling.
  - A full life at that speed takes hours, so it was stopped after 2 model minutes.

### The path to the live game
1. **Lab staging (now):** replayed engine exports, as above. Next, watch one in Studio in the
   foreground at speed; the visuals stay barebones until the friend's art pass.
2. **Live engine in the lab:** StormHost or the lab fetches `/api/game/v1/lab/storms?inflow=1`
   every poll (HttpService, the game's existing feed). It starts an EngineRun when the engine
   starts a storm (the record carries `inflow`; the start sounding comes from the window cell at
   the storm) and calls `run:update(record)` on each poll, nil when the storm is gone.
3. **Speed against the 8x clock:**
   - the nested setup runs at 7.3x real time on one core (command line);
   - the 1 km box alone at about 16x;
   - Studio at about 3x (maybe throttled);
   - options: split the model's columns across Actors (parallel Luau), run the 1 km box for every
     storm and the 250 m nest only for the storm nearest players, or run the model next to the
     engine (one process per storm, shared by all servers) and send frames.
4. **Placement:** the renderer puts the model storm (the box's follow target) at the engine
   storm's position, since the model storm drifts off the engine's track (about 85 km in 5 h for
   S0008).
5. **Many storms:** one EngineRun per active storm near players, level of detail by distance; the
   engine stays the authority for every storm, drawn or not.

## Round 11: the storm worker beside the engine (2026-11-05)

This follows [PLAN.md](PLAN.md) (the run-beside-the-engine decision). The Roblox networking
diagnosis is in [NETWORK.md](NETWORK.md).

Built:
- **Lune 0.8.9** runs the model's modules unchanged.
- **The worker:** `tools/cloudlab/worker/worker.luau`, an HTTP service for one storm that keeps
  pace with the engine clock.
- **The test driver:** `drive.mjs`.
- **The frame format:** `FrameCodec.luau`.

Measured (SupercellB at the 8x clock):

| Setup | Step time | Speed | Keeps pace? | Frames |
|---|---|---|---|---|
| 1 km box | 440-530 ms | about 13x real time | yes (0-6 s behind) | 49 KB raw, 3.5-8 KB compressed |
| box + nest | about 1 s | about 6x real time | no (7.5 game min behind after 25) | 61 KB raw, 13 KB compressed |

Networking: HTTP into the Roblox servers is fine (one poll a second of 500 allowed a minute). The
limits are elsewhere:
- server to client: full frames would cost about 4-7 KB/s a storm, so client frames are cut down;
- binary HTTP bodies are undocumented, so test them in Studio first;
- live servers can't stream; they must poll.

## Round 12: faster code, same storm (2026-11-05)

The aim was to speed up the box plus nest (PLAN C2, option 1) without changing the results.

The work:
- **Timing split:** advection and mixing (`slow`) take 64% of a step, split evenly between the box
  and the nest; the sound-wave substeps (`fast`) 18%.
- **`slow` skips clear air:** cloud water, rain, hail and snow are worked out only where their
  stencil reaches a value that isn't exactly 0 (`rowSpans`). Elsewhere the result is exactly 0,
  which is what the full sum gave.
- **`fast` restructured:**
  - the column solve runs level by level;
  - the damped pressure is computed once per substep.
- **Checked:** the checksums of every field, box and nest, are identical before and after.

Results (Lune, SupercellB, the nest from 30 min, mature steps from 35 to 45 min):

| | Before | After |
|---|---|---|
| ms per step | 1251 | 1059 |
| Speed (real time) | 4.8x | 5.7x |

That's 15% faster, still short of the 8x clock (750 ms a step).

Tried with no gain:
- array type annotations;
- `fast` restructuring on its own;
- buffers instead of tables (a micro-test, 1.04x);
- Lune 0.11.1 (8% on the box alone, nothing with the nest).

Native code gains only 8% on this table-heavy code. So the stencil sums are near what the runtime
can do, and the rest has to come from running the nest on its own core (PLAN C2, option 2) or
from a smaller nest.

The test harness is `tools/cloudlab/worker/bench.luau` (time and field checksums) and
`tools/cloudlab/worker/prof.luau` (the timing split).

## Round 13: the nest on its own process (2026-11-05)

PLAN C2, option 2: the 1 km box and the 250 m nest step at the same time on two cores.

How it works:
- **`NestRemote.luau`** is the coupling, in pure Luau, so Roblox could use it with Actors later.
- **`tools/cloudlab/worker/nest_worker.luau`** is the nest process; **`nestlink.luau`** is the
  link to it over localhost HTTP.
- **Each box step**, the box sends the region of its fields around the nest and the steering
  (air, cold pool, lifts, motion, shifts). The nest process keeps a mirror of the box from the
  same start, and steps the nest across that box step while the box does the next one.
- **Feedback:** the nest returns its averages over the box cells it covers. The box moves those
  cells to them one step (6 s) late; in one process they're replaced right away.
- **What didn't work:** adding the nest-minus-box difference from 6 s before. It re-added old
  differences as the two drifted apart: the wind correction grew from 2 to 118 m/s in 4 minutes
  and the box went NaN. Halving it only delayed the same thing.
- **The worker** starts a nest process on the next port by default (`nestProcess = false` turns
  it off).
- **Robustness:**
  - a token on /ping, so a link never talks to a stray process holding the port;
  - the nest process exits on /stop, or after 2 minutes without a request once stepping;
  - a step error is logged and exits rather than leaving a server that never replies;
  - `NEST_DEBUG=<file>` logs each request and step.
- **Needs Lune 0.11.1** (`process.create`, `ServeHandle:stop`).

Checked with `tools/cloudlab/worker/compare.luau`, both ways side by side from the same start
(SupercellB, nest from 30 min):

| | One process | Nest process |
|---|---|---|
| Box w max, minutes 30-45 | | within 0.1 m/s |
| Nest ground vorticity | | within about 5% (45 min: 0.0078 both) |
| Feedback sizes | | the same |
| Shifts and recentring | | at the same times |
| Box UH at 45 min | 126 | 126 |
| Nest wind at 45 min | 18.0 m/s | 17.9 m/s |
| Mature steps, minutes 35-45 | 864 ms (6.9x real time) | 586 ms (10.2x) |

**Live worker test:** `drive.mjs` at the 8x clock stayed 0-3 s behind through game minute 55,
with the nest in the frames (61 KB raw, about 13 KB compressed). Before, it was 7.5 game minutes
behind by minute 56.

## Round 14: is native code worth it? (option B, step 1, 2026-11-05)

Before porting the whole model, its slowest part, `slow()`, was rewritten in C and in JavaScript,
line for line. `slow()` covers advection, mixing, buoyancy, the sponge and drag, and is 64% of a
step. All versions ran on the same mature box: SupercellB at 40 min, dumped by
`tools/cloudlab/native/dump_slow.luau`.

| Version | One `slow()` call | vs Luau |
|---|---|---|
| Luau (Lune, native code on) | 62.5 ms | 1x |
| JavaScript (Node 22, typed arrays) | 30.4 ms | 2.1x |
| C compiled to WebAssembly, run in Node | 7.4 ms | 8.5x (the SIMD build gained nothing) |
| C, native (zig cc -O3) | 5.4 ms | **11.6x** |

**Same answers:** 99.5% of the 1.76 million values are bit-identical to the Luau's. The other
0.5% differ by at most 1 part in 10^12, which is rounding in the cos and sqrt library calls.

Files:
- `tools/cloudlab/native/slow.c`: the C kernel and its timing harness;
- `tools/cloudlab/native/run_slow.mjs`: the JavaScript copy and the comparison runner.

To rerun:
1. `lune run tools/cloudlab/native/dump_slow.luau <dir>`
2. `node tools/cloudlab/native/run_slow.mjs <dir> 50 <slow.exe>`

The C compiler was Zig 0.13; no other compiler is installed. (Since 2026-11-05 Zig 0.13.0 is installed by winget, `winget install zig.zig --version 0.13.0`, and build.sh finds it; the rebuilt wasm is byte-for-byte the same.)

**What it means:** if the rest of the step speeds up the same way:
- a storm's box falls from about 0.6 of a core to about 0.05;
- a box plus nest falls from about 1.3 cores to about 0.1;
- 15 chased storms need 2-3 cores instead of 30-35;
- the nest no longer needs its own process.

This still has to be checked once `fast()` and `micro()` are ported. `micro()` is full of pow and
exp calls, so it may gain less.

## Round 15: the whole model in WebAssembly (2026-11-05)

The whole cloud model now runs as C compiled to WebAssembly, run from Node. That covers the 1 km
box, the 250 m nest, microphysics, boundaries, storm following and the nest's moves. The engine
steering and frames are in JavaScript and read the fields straight from the module's memory.

| Part | File |
|---|---|
| C core (CloudModel.luau + Nest.luau, line for line) | `native/cloudmodel/cloudmodel.c` |
| Built module (66 KB) | `js/cloudmodel/cloudmodel.wasm` |
| Loader, base state, soundings, field views, nest diagnostics | `js/cloudmodel/CloudModel.js` |
| Steering (EngineRun.luau) | `js/cloudmodel/EngineRun.js` |
| Frames, byte for byte FrameCodec.luau's format | `js/cloudmodel/FrameCodec.js` |
| Worker (worker.luau's HTTP API, nest in the same process) | `tools/cloudlab/worker/worker.mjs` |
| Bench (bench.luau's checksum lines) | `tools/cloudlab/native/bench.mjs` |
| Build (Zig 0.13 from winget, or `ZIG=<zig.exe>`: `sh tools/cloudlab/native/build.sh`) | `tools/cloudlab/native/build.sh` |

`drive.mjs` now starts the Node worker by default; give it a lune path to run the Luau worker.

**Same storm:** the box and nest checksums match the Luau's to all 11 printed digits at 1, 2 and
45 minutes (SupercellB, nest from minute 30), with rain, hail and snow active by then. The nest
diagnostics are identical too: zeta 0.0078 /s, wind 18.0 m/s, cloud base 812 m, UH 126.

**Speed** (mature steps, minutes 35-45):

| Run | Luau | WebAssembly | Faster by | Share of one core at the 8x clock |
|---|---|---|---|---|
| Box alone | about 460 ms (13x real time, rounds 11-12) | 56 ms (107x real time) | about 8x | 7.5% (was about 60%) |
| Box plus nest, one process | 776 ms (7.7x) | 127 ms (47x) | 6.1x | 17% (was about 130% over two processes) |

**Live worker test:** `drive.mjs` ran at the 8x clock for 7 real minutes (game minutes 0-56). The
Node worker stayed on the clock the whole way, never more than about 6 s off, nest included from
minute 30. Steps took 110-140 ms with the nest. Frames were the same size as the Luau worker's:
61 KB raw, about 13.5 KB compressed.

The whole step gains less than `slow()` alone did (8.5x as WebAssembly). The difference is in
`micro()`'s pow and exp calls and the memory copies.

**What changes:**
- The nest no longer needs its own process; NestRemote and nest_worker stay for the Luau worker.
- 15 chased storms need about 2.5 cores instead of 30-35.

**Keeping the two in step:**
- The Luau model stays the reference and the Studio lab's model.
- A change to one must go into the other.
- `bench.mjs` and `bench.luau` print the same checksum lines for the check.

## Live mode (2026-11-05): the engine's own storms in the lab

The Roblox server's half of the live link, run in the cloudlab place.
- **Server:** server/LiveFeed.server.luau.
  - Reports players to /api/game/v1/storm/players and polls /storm/frames (StormFrames.luau).
  - Gets the storms' current positions from /lab/storms.
  - Sends each player the newest near or far client frame per storm, once a game minute, as RemoteEvent buffers.
- **Client:** client/LiveView.client.luau draws the frames on the tabletop (1 km = 100 studs).
  - Cloud runs, rain and hail shafts.
  - The nest's lowest cloud.
  - The lowering from its pressure drop (drop / 12 Pa per m).
- **To run:**
  - Set the workspace attribute CloudLabLive = true (CloudLabLiveUrl if the engine is not on port 3000).
  - Have the engine running, then Play.
  - Players count as at the table's middle unless CloudLabLiveWalk = true.
  - The lab's own model stays idle.
- **First run** (seed 8181, a throwaway engine on port 3999):
  - Storm S0001 got a worker as soon as Studio reported its player. The worker kept pace with the clock (step 48 ms, then 129 ms with the nest).
  - At 32 model minutes the storm stood over the table: 475 cloud columns, 55 mm/h rain, and the nest's wall cloud.
  - Frames were about 1.7 KB near and 0.5 KB far: 0.1-0.2 KB/s a player for the storm.
- **Fixes the same day (seed 8181 again, the storm 2.4 h old):**
  - Motion: the server sends each storm's position now (its tick position plus its motion since) and its motion. The client slides the storm at that motion between frames (one BulkMoveTo a storm) and eases each new frame's jump out over 2 s. Measured in Studio: it moves the way the engine's track does, at about 15 studs/s (19 m/s at 8x).
  - The 100 m cloud: real. This storm's inflow is 94-97% humid through the lowest km, and rain fills it to saturation: cloud from the ground up, 2-4 km deep, in the rain. The nest's base plane stored a base of 0 m as "none" (so 100 m was only the lowest left). A ground base is now stored as 25 m.
  - Warm-up (PLAN A5, first part): a storm already old when it gets a worker starts its model up to 45 model minutes back (warmMaxS; its age if less) and runs flat out with no frames until within 30 s of the clock. Measured: 0 to 52 model minutes in about 50 s real, then frames of a grown storm (111 mm/h). The status and the players reply show "warming".
- **Open:**
  - Warm-up from the storm's own past track (now it uses today's environment throughout).
  - EngineRun save and restore for engine restarts (rest of A5).
  - The main game's version of the loop (H3).

## Main game live storms (2026-11-05)

The same live loop in the main game. The storm visuals are still to be chosen, so only plain debug boxes are drawn.
- **Server:** src/server/LiveStorms.luau, started from init.server.luau.
  - Players are reported at their real map positions (WorldMap.milesAt).
  - Uses StormHost's engine URL (WeatherFeedUrl or Config.WEATHER_FEED_URL) and the weather_feed_key secret.
  - Sends near or far frames by each player's distance (30 km) once a game minute, on ReplicatedStorage.LiveStormNet.Frame.
- **Client:** src/client/LiveStorms.luau is the store for the visuals to come: storms[id] (frame, position, motion), positionKm(id), and a changed event.
  - With LiveStormsDebug = true it also draws Shared.CloudModel.FrameView boxes at full scale, using the sky scale for the storm's distance.
- **Shared:** ClientFrame, StormFrames and FrameView are mapped into ReplicatedStorage.Shared.CloudModel (default.project.json) from src/cloudlab/shared/Model. The cloudlab's LiveView now uses FrameView too.
- **Bundle version 2** (js/game/StormWorkers.js frames):
  - Every storm in the live list also carries its map position and motion (as of the storm tick) and a warming flag.
  - The bundle ends with the tick hour and whether the engine is paused.
  - So one request places every storm wherever the players are, with no /lab/storms window. StormFrames.luau still reads version 1.
- **Proxy** (scripts/game-feed-proxy.mjs) now passes GET storm/frames and POST storm/players (JSON only, at most 16 KB). storm/workers stays blocked.
- **To run:** workspace LiveStorms = true, an engine in WeatherFeedUrl (http://127.0.0.1:<port> works in a Studio playtest), and optionally LiveStormsDebug = true and StartMiles beside a storm.
- **Checked so far:**
  - tests/storm-workers.mjs reads version 2, including the position, motion, tick and paused flag.
  - Lune reads the same bundle with StormFrames.luau.
  - The proxy passes the two routes and refuses the rest, bad bodies (400) and large bodies (413).
  - The cloudlab live mode still works on the shared FrameView.

## Next

0. **Engine following** (round 8 did the first four; the Run API is EngineRun). Remaining:
   - ~~a reliable mature stage~~ (round 9);
   - surface heating, so cold pools recover after a storm;
   - ~~too much hail~~ (round 10);
   - speed (7.3x real time vs the 8x clock);
   - StormHost wiring.
   The round 7 list was:
   - refresh the inflow along the track: relax the box's far field toward the engine sounding
     under the engine storm's current position and time (polls + cells), so the storm keeps
     ingesting what the engine says is there;
   - nudge the cold pool toward the engine's deficit (it's an engine decision), with relaxation
     at the lowest levels only, so the outflow strength follows the engine;
   - tornado timing: when the engine puts a tornado down, strengthen the low-level lift under
     the meso (the field-driven route to a vortex) rather than inserting one;
   - decay: the lift follows the engine intensity down, and once the engine ends the storm the
     lift stops and the model storm dies naturally;
   - then a Run API (start from an engine storm record, step, frame out) for StormHost.

1. ~~Storm following~~ (done). ~~250 m nest~~ (done, round 3).
2. **Tornado scale:** the 62.5 m nest exists but makes no tornado. Hail (round 5) warmed the vortex's air, but it stalls at about 20-25 m/s. Candidates:
   - thinner lowest levels (25-50 m; Roberts et al. 2016 used 20 m), so the near-ground inflow layer and the corner flow are resolved;
   - a 62.5 m nest that follows its vortex better, not the nest centre when the vortex weakens;
   - two-way feedback. Later: Smagorinsky/TKE mixing in the nests, two-way feedback.
3. **Surface physics:**
   - surface friction (drag on the lowest level), which drives the near-ground inflow and the corner flow;
   - surface heat and moisture fluxes;
   - ice and hail microphysics (or a better rain scheme) to temper the Kessler cold pool.
4. **Roblox:** run on the server, split across parallel Actors. Barebones visuals drawn straight from the fields: a cloud surface from qc, rain shading from qr, the funnel where the pressure falls enough to condense.
