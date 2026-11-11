# Cloud Lab: storms from the equations (started 2026-11-04)

The Storm Lab rebuilt from scratch on a real 3-D cloud model, the user's option A from docs/stormlab/DIAGNOSIS-2026-11-04.md. The old lab (roblox/Labs/StormLab) is untouched.

## Model (roblox/Shared/CloudModel)

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
- `roblox/Shared/StormLab/Data/SupercellLife.luau`: seed 8181, S0008 from age 10 min, 5 h of
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
- **Studio, main game ("plains" place, seed 8181, StartMiles 420,340):**
  - The player was reported, and S0001 got a worker with its nest. It warmed up to 52 model minutes in about 50 s.
  - The client then showed it 10 km away, which matches the engine's stud positions (3,835 studs apart).
  - Model 54 min, 419 cloud columns, 140 mm/h. The existing StormHost storms ran alongside, and no errors appeared.
- **Open:** the visuals (to be chosen).

## Live loop hardening (2026-11-05)

- **Restarts (PLAN A5, rest):** the storm models are saved each time the world is (the runtime's saveState calls StormWorkers.saveModels), so a restart resumes both from the same moment.
  - Each worker writes its own file, data/cache/storm-models/<id>.cms: "CMS1", a JSON head (meta, the worker's clock, EngineRun's fields), then the module memory, Zstd level 1.
  - A mature storm with its nest is 110 MB of memory, about 54 MB saved, in about 0.25 s.
  - When a storm gets a worker and a save exists, it carries on from the save. The save must have the same world tag (code version and seed, read fresh each time) and be within restoreKm (15 km) plus the storm's motion since. Otherwise the storm warms up as before.
  - Saves are removed when a storm ends; any older than a day are cleared at start. WEATHER_PERSIST=off saves nothing.
  - The restore is bit for bit: tests/cloudmodel-restore.mjs (a 35-minute storm, 40 steps after the restore, the whole memory equal).
- **Frame numbers** now start at the Unix time in seconds. A storm's new worker (after a restart, or when shown again) used to start at 1, below what the Roblox servers held, so they ignored its frames.
- **tests/storm-workers.mjs** covers the restart: the model is saved (26 MB young), every worker is closed, and new workers restore it with its nest and higher frame numbers.
- **Load test** (tools/cloudlab/loadtest.mjs; seed 2, 9 to 18 storms, a player beside each, 6 workers, every nest on, 4 minutes):
  - Five old storms warmed up together to 57 model minutes in about 85 s.
  - Then every model kept pace: steps of 160-220 ms against the 750 ms the clock allows, about a quarter of a core each.
  - Storms beyond 6 got no worker and keep the engine's look. The machine's CPU was about 30% of 24 threads, Studio included.
- **Tunnel:** the main game (plains) through cloudflared and the proxy showed the storm as before (423 cloud columns, 140 mm/h).
  - With WEATHER_GAME_KEY set, both storm routes return 401 through the tunnel without the key and 200 with it.
  - Studio can't read the weather_feed_key secret in local runs, so the game sending the key is still untested; it uses the same header as StormHost.

## Model storms dying after about 2 hours: the lift's fallback (2026-11-05)

- **Seen:** on seed 2, a 3-hour run of S0001 fed the engine's record every tick lost its updraft (5 km w from 25 to 1-3 m/s) from about 110 minutes, while the engine kept the storm at intensity 0.73-0.79.
- **Not the cold pool:** the same storm with tight, weaken-only or no cold-pool steering, and S0002 with and without steering, lived or died without pattern. The cold pool's size or steering didn't decide it.
- **The cause:** the lift froze. liftSpot only moved the lift when it found an updraft over 3 m/s at 3 km. After a dip it stayed at a stale spot, likely in the outflow, where no new cell could start.
- **Fix** (js/cloudmodel/EngineRun.js and the Luau lab's EngineRun.luau, liftSpot):
  - With no updraft, the walk into the low-level inflow starts from the middle of the cold pool (weighted by its coldness, ground air more than COLD_K = 1 K below the environment).
  - So the lift goes to the gust front's warm side, where a new cell starts. With no cold pool either, it stays as before.
- **After the fix:** all six runs (S0001 normal, tight, weaken-only and none; S0002 normal and none) reached 3 hours. Each recovered after its dips, e.g. S0001 normal went from 4 m/s at 110-120 min back to 29 m/s.

## Painting audit of the cloud model (2026-11-05, read-only; nothing changed yet)

Most player-visible first:
1. **Main lift** (EngineRun.js setDrive 1; cloudmodel.c applyDrive):
   - A 10 km cos² ball at 1.5 km pulls w up to 8 m/s × the engine's intensity within 5 s, forever.
   - It is an analytic shape written onto w, and the 8 stands in for the record's updraftMs.
   - Alternative: drive it through buoyancy or low-level convergence, with its strength set from the gap between the model's measured updraft and updraftMs.
2. **Tornado lift** (EngineRun.js setDrive 2):
   - Keyed on the engine's tornado label: a 2.5 km ball at 700 m, w = 6 × min(1, mph/100), switched on above 0.005 /s spin at 1 km.
   - The nest's pressure drop, and so any drawn funnel, comes mostly from it. This belongs with the model-driven tornado work.
3. **Cold-pool steering** (cloudmodel.c cm_cold_pool_rate / applyColdPool):
   - It scales every cool anomaly below 1.5 km by one factor toward the engine's coldPoolK.
   - Alternative: steer the process that makes the cold air (evaporation and melting) instead.
4. **Environment easing** (cloudmodel.c relaxEnvironment, borderline):
   - The same increment is added to every cell of a level, inside the storm too.
   - Alternative: ease only the inflow edge and let the wind bring the new air in.
5. **Frame thresholds** (FrameCodec.js, borderline): rain and hail weighted 0.3 in what counts as cloud; the 1e-4 cloud cut; snow only above a fixed 6 km; the nest's cloud base only below 3 km; the pressure drop measured against the nest's own mean.
6. **Debug drawing only** (FrameView.luau): the 2 km rain top where there's no cloud, the 200 m wall box, the constant 12 Pa per m.
7. **Start-up lift** (EngineRun constructor): start-up only.

Checked and fine: dynamics, boundaries, sponge, drag, microphysics (a fixed hail intercept is a normal simplification), box following, the nest (placement, feedback, blending), setMotion, soundings, and the engine record itself.

## Engine against model: sync check (2026-11-05)

Tool: `node tools/cloudlab/synccheck.mjs [seed=2] [storms=3] [hours=3]`. It runs young storms through 3 game hours with the nest on and the engine's record every tick, then scores how closely each engine/model pair moves together (r).

Seed 2, S0001-S0003:
- **Cold pool:** r 0.43-0.49. It tracks, within about 1 K after the first hour.
- **Strength and updraft:** r 0.39-0.61. The engine eases smoothly from 1.0 to about 0.7, but the model pulses between 2 and 36 m/s at 5 km. S0003's model storm was nearly gone twice, for 30-40 minutes each (60-90 and 140-160 min), while the engine had it at 0.67-0.73.
- **Rain:** r 0.32-0.59. It follows the pulses; the engine holds 60-75 dBZ throughout.
- **Hail:** r -0.06 to 0.40. The model only puts hail on the ground in its first hour or so; after about 100 minutes it has none, while the engine says 0.8-1.2 inch.
- **Rotation:** 1 km r 0.16-0.25; 50 m r -0.23 to 0.44. Unrelated: the engine's mesocyclone is steady at 0.4-0.6.
- **Tornadoes:** the engine had none in these runs, so tornado timing is untested.

## The lift as a push (2026-11-05; painting audit item 1)

- **Was:** a 10 km cos² ball at 1.5 km that pulled w up to 8 m/s × the engine's intensity within 5 s. It overwrote the wind, and the 8 stood in for the record's updraftMs.
- **Now** (js/cloudmodel/EngineRun.js steerPush, the Luau lab's EngineRun.luau, and a push mode for drives in cloudmodel.c and CloudModel.luau):
  - The lift is an upward acceleration in an 8 km ball (PUSH_R) at 0-3 km, added to the wind, which the pressure and buoyancy answer. Nothing is overwritten.
  - Its strength is up to PUSH_MAX = 0.2 m/s² at the middle. Once a model minute it is set from the gap between the model's peak updraft (within 16 km of the storm point) and the engine's updraftMs. A whole gap swings it from none to full in PUSH_TAU = 8 min.
  - The spot is still liftSpot's.
  - The old pull stays as opts.lift = a number (synccheck: SYNC_LIFT=8).
- **Tuning** (S0001 and S0003, seed 2):
  - A 0.05 push let every storm die by 50 min: a wide, flat push is mostly cancelled by the pressure it builds.
  - Narrow 4 km balls at 0.1-0.2 died too.
  - 0.3-0.4, or a 5 min reaction, swung between nothing and full and overshot (66 m/s against the engine's 34-46).
- **Sync check against the old pull** (3 storms, 3 h):
  - 10-minute readings with the model storm nearly gone (peak w < 10 m/s) fell from 8 to 1.
  - S0003's two 30-40 minute gaps are gone.
  - Hail reached the ground in 33 readings, up from 22. S0001 and S0002 keep some hail late; S0003 still has little.
  - The r scores fell (strength 0.21-0.49): the engine barely changes after the first hour, so r mostly measures the first hour's fall, which the model now doesn't copy as closely. The gap count is the better measure.
- **tests/cloudmodel-restore.mjs** now leaves out the first 16 MB (Zig's call stack, which holds only what the last calls left behind). Since the 17-argument drive call, 8 bytes there differ between the two processes; model state is unchanged.
- **Not done:** Studio check of the lab with the push. Next: hail and rotation steering (audit items 2-3, the tornado lift with the tornado discussion).

## Hail steered by the engine; rotation left to the shear (2026-11-05)

- **Hail** (EngineRun.js and EngineRun.luau hailSize / steerHail; cm_get/cm_set id 41 n0h; the worker record now carries hailIn):
  - Once a model minute the model's biggest stone at the ground is measured. It is the size at which about one stone that large or larger reaches a square metre in 10 minutes, from the model's own exponential size distribution and fall speed (c √D), in the column with the most ground hail.
  - That size is compared with the engine's hail size, and the hail intercept n0h is moved by up to a factor-of-e gap in 10 minutes (n0h ∝ size⁻⁴), in both the model and its nest. Its range is 1e2-4e5 m⁻⁴, about 0.4-4.5 inch stones.
  - Hail held aloft but melting before the ground counts as too small, so the stones grow.
  - Sync check (seed 2, 3 storms, 3 h):
    - Model stones follow the engine's size. S0001 from 70 min was within about 0.1-0.3 inch (1.29 against 1.2, 1.00 against 1.0); S0002 and S0003 were within about 0.5-1 inch. Stone-size r 0.40-0.69.
    - Readings with ground hail: 47, against 33 with the push alone and 22 with the old pull.
    - Near-gone storms stayed at 0-1 readings each.
  - Open: early ground hail peaks of 330-500 mm/h (liquid) at single cells look high.
- **Rotation:** not steered.
  - The engine's mesocyclone strength comes from the inflow's helicity and shear times its updraft (js/storms/StormRotation.js). The model gets the same inflow winds and now follows the engine's updraft, so its rotation grows from the same ingredients.
  - Across storms they agree: the engine's two more rotating storms (0.5-0.6) have model 1 km spin mostly at 0.01-0.035 /s, and its weakest (0.39) has the weakest, mostly under 0.01.
  - The low r within a life comes from the engine's number barely changing. Steering spin toward the engine's index would be painting.

## Tornado physics, step 1: the model makes the engine's tornado (2026-11-05; audit item 2)

- **The old tornado lift did nothing.** On SupercellB, runs with it and without it (torLift 0) were near identical. While the engine had 141-185 mph down, the 250 m nest had 25-27 mph and its spin was weakening. 250 m is too coarse to hold a tornado.
- **Now** (js/cloudmodel/EngineRun.js and EngineRun.luau steerTornado; the C core and Nest.luau):
  - **The 62.5 m nest** (FINE: 32², 2 km across, 4 steps a 250 m step) starts in the 250 m nest on its strongest 50 m spin when the engine has a tornado down. There is no way to free a nest, so it then stays until the storm ends.
    - The lab server and the run share it (the lab still starts its own at 0.04 /s, and the run takes it).
    - It doubles the step cost: 125 → 250 ms on SupercellB, against a 750 ms budget.
  - **A push** under the finest nest's strongest 50 m spin, which stretches it into a tornado:
    - A 1 km ball (TOR_R) over 0-800 m (TOR_Z 400), up to 2 m/s² (TOR_PUSH_MAX).
    - Set each model minute from the gap between that nest's peak ground wind and the engine's tornado wind, so a whole gap reaches full push in 2 min.
    - Off once the engine's tornado lifts, so the model's vortex winds down by itself. The old pull is still available as opts.torLift = a number.
  - **Nests keep their place over the ground** when their parent's grid moves (keepPlace), and follow their own vortex by recentring.
    - Before, a nest moved with its parent: the 1 km box jumping 2 km to a new updraft cell took the 2 km fine nest off its tornado, which then "died" in a minute.
    - Recentring now moves up to RECENTRE_MAX = 4 parent cells a minute (was 1, which is 4 m/s for the fine nest), with or without a vortex of its own. Where staying would leave the parent's grid, a nest moves with it as before.
- **Tuning** (tornado time):
  - 0.25-1 m/s² made no tornado, nor did a 500 m ball.
  - 2 in a 1 km ball at 0-1.5 km made 76-85 mph but lost it once the box jumped.
  - With the nests keeping their place, low (0-800 m) beat 0-1.5 km and stronger (3-4) or narrower (700 m) pushes.
- **Result:**
  - SupercellB: 10 min of tornado at 60-93 mph (engine 141-185), 50 m spin up to 0.86 /s, a 14 hPa low.
  - SupercellLife: 12 min of spin over 0.1 /s at 48-61 mph (engine 78-83), a low of only about 2.4 hPa.
  - Both are weaker than the engine: 62.5 m can't hold its strongest winds.
- **Checks:**
  - JS and Luau identical over SupercellB to 40 min with the nest and a forced 100 mph tornado from 30 min (per-minute values and the box, nest and fine checksums).
  - The restore and storm-workers tests pass.
  - Sync check (seed 2, 3 storms, no tornadoes): 0-1 near-gone readings and 46 hail readings, as before.
- **Not done:** the fine nest isn't in the frames yet (step 3), and it isn't Studio-tested.

## Tornado strength: gusts, mixing and who decides what (2026-11-05)

- **Gust comparison (TOR_GUST 1.4):** the engine's tornado mph is an EF-scale peak gust; the model's is its strongest cell mean at the lowest level. The push now compares the engine's mph with 1.4 × the model's (peak gusts over land run 1.3-1.5 × the mean), and run.torWind is that gust.
  - SupercellLife: model gust 73-86 mph against the engine's 78-83. In step.
  - SupercellB: 72-80 mph against 141-185. 62.5 m can't hold an EF3+ core.
- **Lighter mixing in the fine nest was tried and rejected:** 19 and 4.7 m²/s, against the box's 75, made weaker, shorter tornadoes on both storms (spin over 0.1 /s for 2-8 min, against 6-11). The setter stays (model.K / model.Kh, cm_set 27/28; ENGINE_RUN.FINE.K) but is unused.
- **No 31 m nest for now:** it would take the tornado step to about 500 ms of the 750 ms budget. Revisit only if tornadoes look too broad up close.
- **Who decides what:**
  - The cloud model decides the tornado's look and place: position, size, shape, track, funnel (pressure drop, condensation) and the local wind pattern.
  - The engine's mph decides its strength for damage, reports, surveys and warnings, as for every other storm product.
  - Where the model's wind is weaker than the engine's (strong tornadoes), ground winds for damage are to be scaled to the engine's mph (step 4), not taken raw.
- **Checks:** JS and Luau identical (SupercellB to 40 min, nest and forced tornado); restore and storm-workers tests pass.

## Tornado physics, step 3: the tornado in the frames (2026-11-05)

- **The block:** while the engine has a tornado down, every frame carries a 92-byte tornado block: full frames flags bit 2, client frames bit 3, near and far alike.
  - Layout: js/cloudmodel/FrameCodec.js TORNADO.
  - Written from EngineRun.tornadoShape once a model minute. It only reads the model, so the model's state is untouched.
  - Read by FrameCodec.decodeHeader and decodeClientFrame (JS), and FrameCodec.decodeHeader and ClientFrame.decode / readTornado (Luau).
- **From the model** (where and how it looks):
  - The vortex at the ground: the finest nest's strongest spin averaged over 0-1 km (TOR_COLUMN), a column joining the ground to the storm.
  - Its centre at 8 heights (50 m to 3 km), each the strongest spin within a 45° lean of the height below, and where it leaves the nest.
  - The cloud base over it: the lowest cloud within 500 m, the wall cloud.
  - Its own gust, spin, spin trend and pressure drop.
- **From the engine's wind and damage width, by vortex physics** (what 62.5 m can't hold):
  - Core: a Rankine core whose wind falls to EF0's 65 mph at the edge of the damage path, so R = (width/2) × 65 / mph.
  - Swirl: the engine's peak wind less the storm's motion.
  - Pressure drop: cyclostrophic, ρv² at the centre.
  - Condensation funnel: where the core's drop reaches what condenses at that height, ρg(base − z). That gives the funnel tip and its radius at each height.
  - Examples:
    - 185 mph, 705 yd: core 113 m, drop 43 hPa, funnel from an 812 m base down to 418 m.
    - 80 mph, 67 yd: core 25 m, 5 hPa, about 50 m of funnel under a 1.75 km base. A weak tornado under a high base shows only a short funnel, as in reality; the debris whirl will come from the ground winds (step 4).
- **Steering changes found on the way** (these change the model, in C, JS and Luau):
  - The push now goes under the column spin, not the strongest 50 m spin. On SupercellB that was inflow at the fine nest's edge from the coarser grid, with the real column elsewhere.
  - Nests recentre on a vortex from the second cell in, not the third. A vortex drifting to the edge was missed.
  - Results:
    - SupercellB: the model's gust went from 72-80 to 30-44 m/s (up to 98 mph), and the column is upright to 1 km, leaning 300-800 m above.
    - SupercellLife: 28-44 m/s (engine 78-83 mph), with model drops up to 7 hPa.
- **Checks:**
  - tests/tornado-frame.mjs: a known shape round-trips through full, near and far frames, with and without a nest. With --luau <dir> it writes frames for a Lune check of the Luau readers, which passed.
  - JS and Luau identical over SupercellB to 40 min with a forced tornado.
  - The restore and storm-workers tests pass.
  - Sync check (seed 2, 3 storms, no tornadoes) unchanged to the digit.
- **Open:**
  - On SupercellB the 250 m nest ended against the box's west edge (i0 3). The box was following a newer updraft cell east while the tornado's storm was west of it. If the box leaves the tornado behind, the tornado is lost. Look at this in step 5.
  - Not Studio-tested.

## Nests tethered to the updraft; the model's missing mesocyclone (2026-11-05)

- **What looked like the box leaving the tornado wasn't.** The box stays on the storm's updraft, where the engine puts the storm.
  - On SupercellB from minute 60, the 250 m nest followed a low-level spin carried south-west on the gust front at about 7 m/s relative to the storm.
  - At minute 86 the model's tornado formed there, 20-25 km from the updraft. The engine has its tornado at the storm's centre.
- **Fix: TETHER = 8 parent cells** (cloudmodel.c recentre, Nest.luau). A nest follows a vortex of its own only within 8 cells (8 km for the 250 m nest) of its parent's storm centre, the same reach place() searches; beyond that it goes back to the spin near the updraft. Nests whose parent has no storm centre (the fine nest) are untethered.
- **Results:**
  - SupercellLife: tornado 3-6 km from the updraft, spin to 0.52 /s, gust to 36 m/s.
  - SupercellB: 10 km away, weak (spin 0.07 /s or less, gust 32 m/s or less).
  - JS and Luau identical. Sync check (seed 2): strength r 0.44 / 0.26 / 0.33 (was 0.49 / -0.01 / 0.31), hail 0.72 / 0.47 / 0.68 (was 0.73 / 0.70 / 0.76), near-gone readings 0 / 2 / 1. Within three storms' scatter.
- **The real gap: the model's storms often have no mesocyclone when the engine's do.**
  - SupercellB 60-96 min and SupercellLife 122-140 min: the model's updraft helicity (2-5 km) is at the follow floor, 50 m²/s², while the engine's meso is 0.9.
  - The sync check's rotation pair is r -0.31 to 0.32.
  - Rotation was left to the shear (the same SRH and shear the engine uses), but that isn't enough at 1 km: the tornado push then works on whatever spin is near the updraft.
  - Next decision: steer the mesocyclone by a field, the way the lift, hail and tornado are steered.

## The mesocyclone: convergence lift, a stronger push, drawn at the updraught (2026-11-05)

- **Why the model had no mesocyclone:** its updraught didn't last. With all steering off, SupercellB was a supercell by 16 min (w5 21 m/s, UH 855) and dead by 40; SupercellLife died by about 100 min. When the updraught was strong the 250 m nest rotated (UH to 1,800), so rotation followed the updraught.
- **What it wasn't:**
  - The wind profile: helicity 230-280 (B) and 200-400 (Life) m²/s² against the box's motion.
  - The box's motion: bare runs at the Bunkers right-mover motion died the same way.
  - Mixing (K 10-25), ice.
  - The inflow air: box edges stay environmental, and cold air covers 10% or less.
  - The core physics: tools/cloudlab/wk82.luau, unsteered, holds its supercell the full 120 min (w 45-56 m/s, UH 400-500).
  - The exported soundings: they match the engine's numbers (CAPE 1,900-2,800, CIN -50 to -100 J/kg).
- **What it was:** the cap. Cooling the 850-700 hPa layer 3 K, or lifting the soundings by the engine's own surface convergence, made SupercellLife a self-sustaining supercell for 140 min unsteered. The model's box has a uniform environment with none of the mesoscale rising air the engine's convergence implies.
- **Built (EngineRun.js and .luau, liftRows; JS and Luau identical):**
  - The inflow (and start) sounding is lifted by the engine's surface convergence at the inflow point: LabWindow inflowConvergence, record.convergence; scenarios use the nearest exported cell.
  - Each level takes the air from w(z) × LIFT_S (1 h) below, where w = C·z to 1.5 km, falling to 0 at 6 km; divergence sinks it.
  - The feed gains a field (inflowConvergence); the engine and world are untouched.
- **Most live storms sit in weak convergence** (0-3 × 10⁻⁵ /s; they move away from the boundaries that started them), so they still need the push.
  - PUSH_MAX 0.2 → 0.35. Sync check (seed 2, 3 storms, 3 h): no near-gone readings (was 0/2/1), rotating 14/17/9 of 18 readings (15/11/6), rotation r with the engine's meso 0.45/0.57/0.25 (-0.05/0.21/0.29), low-spin r 0.20/0.20/0.03 (-0.40/-0.47/-0.25). Hail r 0.72/0.55/0.18 (0.73/0.70/0.76): worse for one storm.
  - Narrower pushes (3-5 km) were worse.
- **Drawn at the engine's updraught:** the box follows the model's updraught, but frames were drawn at the engine storm's position, its low-level mesocyclone, 1-5 km behind the updraught in a rotating storm. Now js/game/StormWorkers.js drawnAt uses storm.geometry.updraught (and the save check uses the same point).
- **Engine placement checked against docs/stormlab/RESEARCH-SUPERCELL-LAYOUT.md:**
  - The engine puts the low-level mesocyclone and wall cloud directly behind the updraught: 165-180° from the motion, 1-2 km, the updraught leaning along the storm-relative mid-level wind.
  - The tornado forms under it and drifts left-rear as the storm occludes (at most 0.4 updraught radii).
  - That matches the research: the BWER is 2-6 km ahead within ±30° of the motion, and the tornado is at the occlusion point on the rear edge. The engine's 1-2 km is at the short end.
- **The model's mesocyclone sits elsewhere:** 2-3 km to the right of its updraught (south for these east-moving storms), the median 3 km from the engine's once both are drawn from the updraught. Open: which point to pin when drawing (see Next).
- **Tools:** sync check columns "meso from updraught (km): engine / model"; scratch diagnostics in the job folder (mesodiag, mesovar, capecheck, convcheck).

## Hook check and pinning the mesocyclone (2026-11-05)

- **Hook check** (scratch hookcheck.mjs; seed 2, S0001/S0002 at 60, 100, 140 min; ground rain as dBZ):
  - At the 250 m nest the model makes a crude hook: S0002 at 140 min has an appendage curling south from the rear of the core, with the model's mesocyclone inside the curl.
  - At the 1 km box it is only a blob with a notch.
  - The model's rain core sits on its updraught. The engine's rain-core centre (the radar's) is 6-10 km downwind. Sky rain and radar core will not coincide; the radar is the engine's either way.
  - The nest's rain is not in the frames (2 bytes a nest column more if wanted).
- **Pinning:** StormWorkers drawnPos shifts the drawn position from the engine's updraught so that the model's pin point (worker status pin: EngineRun pinPoint, the model's tornado else its strongest 0-1 km spin) lands on the engine's tornado, else its wall cloud.
  - The shift scales with the engine's mesocyclone (0.2-0.5) × the model's spin (zeta 0.005-0.01, or 1 with a tornado).
  - It eases over 10 game min, drifts at most 0.1 km a game minute, and drops out if it would exceed 8 km.
  - The model and engine are untouched (sync numbers identical).
- **Result** (sync check, new column "miss km: unpinned / pinned"; median distance from the model's pin point to the engine's): S0001 3.0 → 0.8 km, S0002 2.6 → 0.5 km, S0003 3.1 → 1.9 km (weak, jumpy model meso).

## First tornado on the ground in the cloudlab debug view (2026-11-05)

- **Drawn from the frame's tornado block only** (FrameView.luau drawTornado, live mode):
  - The condensation funnel: upright cylinder slices from the cloud base to the funnel tip, each on the model's centre at that height, at the block's condensation radius.
  - The wind core (radius R, faint red) below the tip, or up to 1 km when there is no cloud over the vortex.
  - A flat ground ring out to the EF0 radius, R × mph / 65 (Rankine).
  - A HUD line with the block's numbers.
- **Close-up camera** (LiveView.client.luau): T frames the tornado; Left/Right orbit; Up/Down zoom; T again gives the camera back.
- **Place:** cloudlab.project.json now sets HttpService.HttpEnabled. Built to roblox/build/cloudlab.rbxl; workspace CloudLabLive = true, CloudLabLiveCentre "x,y".
- **How it was set up:** a fresh seed-2 world on port 3000, products off. A scratch keeper (job folder tornadokeeper2.mjs):
  - stands a stand-in player at the likeliest tornado storm;
  - pauses the engine's clock once a tornado is down and the model is caught up. The worker keeps the last record, tornado down, while paused.
- **Seen (S0016, 85 mph, 71 yd):**
  - The engine's figures: core R 25 m, EF0 out to 33 m, drop 13 hPa.
  - The model's cloud base came and went between 337 and 478 m. The funnel hung about 120 m below it; the core leaned down to the ground ring.
  - Physically right: to reach the ground the funnel needs a drop of about 12 Pa per metre of cloud base (about 40-60 hPa here).
- **Open:**
  - The model's vortex flickers: spin 0.01-0.09 /s from frame to frame, sometimes with no cloud found over it (base 0).
  - At tabletop scale (1 km = 100 studs) the tornado is about 5 studs across.

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

## Vortex flicker fixed (2026-11-05)

The model tornado kept collapsing and jumping, measured with tmp/flicker.mjs: a forced engine tornado, recording each minute the gust, the 0-1 km spin, and the ground point in ground metres. The ground point is box metres plus the box's shift; the apparent jumps at box shifts were a measuring artefact. There were two causes and one overshoot:
- **The 250 m nest wandered off.** It searched its own grid, jumped about 4 km to another spin and dragged the 62.5 m nest, which must stay inside it, off the tornado. Now a nest whose child holds a vortex (`holding`) follows the child's middle instead (C recentre, Nest.luau).
- **The tether snapped.** A held tornado drifting more than 8 km behind the storm point tripped it. There is now no tether while the child holds a vortex.
- **The push overshot.** It steered by the gust now, so it peaked at 58 m/s against a target of 38 and rang. It now steers by the gust TOR_LEAD = 2 model minutes ahead (EngineRun.js/.luau).

Results:

| Test | Measure | Before | After |
|---|---|---|---|
| SupercellLife, 85 mph | minutes within 25% of the engine's wind | 20/36 | 29/36 |
| | collapses | 1 | 0 |
| | largest jump in a minute | 4.9 km | 0.66 km |
| SupercellB, 110 mph | collapses | | 0 |
| | largest jump in a minute | | 0.7 km |

On SupercellB the model still tops out near 35 m/s against the engine's 49, a strength limit rather than flicker. JS/Luau parity2 matches; cloudmodel-restore, storm-workers and tornado-frame pass.

## The engine's maintenance lift (M2, 2026-11-05)

The engine keeps its storms alive under a cap almost regardless of the cap. The model's storms die there without lift, which is why most of the push was needed. js/storms/StormMaintenance.js `maintenanceLift` names the lift the engine is assuming. It is read-only: the engine's own behaviour is unchanged.

How it works:
- The deficit is the storm cell's ML CIN minus the storm's own lift. That lift is the gust front (½(a·c)²: the engine's cold-pool speed c and its RKW balance a) plus the low-level rotation's dynamic low ((0.01·lowRotation·2 km)²/2).
- The deficit is turned into rising air at cloud base by inverting the engine's initiation lift (kainFritschLift), then into a convergence: w over the LCL height.
- It reaches the model as `record.maintenance` (LabWindow labStorm `maintenanceConvergence` → StormWorkers workerRecord) and is added to the convergence lift (EngineRun liftRows, JS and Luau).
- With it, the push ceiling is PUSH_MAX_M2 0.25. Records without it, such as lab scenarios, keep 0.35.

Typical size: CIN 66 J/kg against 13-53 J/kg of lift gives 1-2.6 ×10⁻⁵/s. The deficit shrinks as the gust front builds.

Tests (tools/cloudlab/synccheck.mjs, 3 storms × 3 h; `SYNC_M2=0` turns M2 off):

| Seed | Setting | Survival (readings with model wmax < 8 m/s) | Strength r | Updraft r | Rotation r |
|---|---|---|---|---|---|
| 5150 | today, push 0.35 | 0/3/0 | 0.53/0.30/0.14 | 0.40/0.24/0.09 | 0.28/0.54/0.19 |
| 5150 | M2 + push 0.25 | 1/2/0 | 0.49/0.41/0.16 | 0.53/0.33/0.27 | 0.37/0.66/0.26 |
| 2 | M2 + push 0.2 | storms lived where push 0.2 alone had let them fade | 0.44/0.37/0.72 | | |
| 2 | M2 + push 0.1 | 7/9/3 | | | |
| 2 | push 0.1 without M2 | 7/10/11 | | | |

On seed 2, M2 + push 0.2 tracked strength better (0.44/0.37/0.72 against 0.41/0.34/0.24 today) and rotation worse.

Findings:
- M2 explains part of the push, not most of it. The rest is likely the model's own: under-resolved updraughts at 1 km and strong cold pools.
- E1 (Bunkers motion) was tested first and dropped: the model's storms don't move at the right-mover either (docs/research/PLAN.md).
- JS/Luau parity matches on both paths (parity2 without M2; parity3 with maintenance 1.5 and pushMax 0.25). cloudmodel-restore, storm-workers and tornado-frame pass.

## Puff storm prototype, first Studio look (2026-11-06)

Live mode, seed 2, S0003; `CloudLabPuffs` true (shared/Model/PuffView.luau). T now frames the storm when there is no tornado.
- Fixed: LiveView multiplied LiveFeed's metres by 1000 again (storms drawn about 1000x too far away, "9134 km from the camera").
- Look: the first version was stacked bright beads, because light added to more than 1 and clipped white. With the light now normalised (sun 0.7 + sky 0.3 above a floor), larger fainter puffs (PUFF_GROW 2.6, opacity 0.2 + 0.5 x cover) and the texture flipped 0/180 per block, shading shows and the near cloud blends into a sheet. It is still lumpy and scalloped, not yet the smooth look wanted. Turning the texture to any angle makes feathers, because the texture is an oval.
- Cost: about 420 puffs held 60 fps (16.6 ms); 936 puffs (CloudLabPuffMax 1200) fell to 66.7 ms (15 fps). The cost is overdraw from large see-through cards, not the build (16-24 ms once a frame, every 7.5 s). Keep the limit at 600 or below.
- Next: a softer, rounder texture; fewer, larger puffs with the size from cover; then check from under the base and from far out.
- Textures compared on the same storm (2026-11-06): `soft` (LabConfig softFlat) blends into one smooth tower and is now PuffView's default (attribute CloudLabPuffTexture: soft, smooth, haze, deck); `smooth` scallops, `haze` is speckled dots with no body, `deck` is smooth but harder-edged. Puff size now also scales with block cover (COVER_SIZE 0.5).
- The flat "slab" above the tower looked the same with every texture, and its top sits at the HUD's bottom edge in every capture: most likely the storm's upper part half hidden behind the HUD, not a drawing fault. Check again with the storm framed lower.
- While the engine clock is paused the model storm runs on and decays (S0003 near frame later: tops up to 2.1 km only, a low deck running off the frame's west edge), so look at a storm soon after warming it.
- Re-measured with `soft`, two storms in detail (S0026 fresh, S0003), 14 node processes running: 1,104 puffs 18.8 ms (53 fps), 992 puffs 19.8 ms (51 fps). Earlier 936 puffs gave 66.7 ms with the old texture, full-size fringe puffs and a closer camera. The cost follows how much screen the puffs cover more than the count. Cloud showed through the HUD above both storms, supporting the HUD explanation for the "slab".

### Puff storm, second Studio look: HUD, under the base, far (2026-11-06)
- Place rebuilt (roblox/build/cloudlab-e2.rbxl) with E2's model scripts (the cold pool's depth) and two LiveView changes: the HUD sizes to its text (11 pt, faint; H hides it), and Q/E lower and raise the T camera's eye down to the ground.
- Seed 2, 20-21Z, S0042 and S0031 (51-63 model minutes): 60 fps throughout, 164-479 puffs a storm, 2-5 ms to build.
- With the small HUD the storm top is in clear sky: the earlier "slab" was the HUD.
- From 80 km: a soft grey tower, reads well.
- From under and low (7 and 29 km, eye near the ground): a pale, even grey mass with no darker flat base; it fades into the haze. Camera-facing billboards can't draw a flat underside, so this is the base sheet's job (stage 2, prototype 2). FrameView's rain box still shows as a grey block.

## Base sheet, first Studio look (2026-11-06)

`roblox/Shared/CloudModel/BaseView.luau`, switched on by the workspace attribute `CloudLabBaseSheet` (LiveView; near storms only). One vertex sits at each cloudy column's lowest base (base1). Neighbours make a triangle when their bases are within 300 m (JOIN_M). The shade comes from the column's rain and depth, and the edges fade.
Seed 2, place roblox/build/cloudlab-base3.rbxl, S0026 at 3.4 km, eye under the storm: no errors, 54-60 fps, 85-120 ms to build each frame.

What Roblox allows:
- A mesh is at most 2,048 studs on each axis. Near the camera the sky is at game scale (3.6 studs/m up), so the sheet is cut into tiles across and bands up.
- The client holds only about 6-8 editable meshes. Every mesh must be destroyed with its part, or they pile up and new ones come back nil. So the sheet draws the 6 groups nearest the camera.

Result: it doesn't read as a base yet. There are a few dark spiky shards near the camera (128 of 4,926 triangles in 6 meshes, out of 220 groups). Neighbouring columns' lowest bases step by hundreds of metres, which is a 1,000-stud cliff at game scale.
Next, one of:
- the base from the nest's finer field (ClientFrame.nestBaseM) under the camera;
- the base as the cloud's own lowest level over a neighbourhood, a field of its own sent in the frame;
- the mid-band fallback the plan names (a row of dark puffs at the base).

## Engine-built frames, first side-by-side (2026-11-06)

See docs/research/ENGINE-PHYSICS-PLAN.md, "Phase 0 first results". Place roblox/build/cloudlab-eng.rbxl; lab server on 3001 with `WEATHER_ENGINE_FRAMES=side`; attributes CloudLabEngineSideKm (15), CloudLabPuffs. Y cycles the storm T frames (ids sorted; copies are "<id>~engine").
- Romcp play tests end after about 2 minutes. Pass timeoutSeconds, or be quick.
- A storm drifting more than 30 km from the table's centre (NEAR_KM) gets far frames (2 km columns). Re-centre on it to judge the near look.

## Tornado and wall-cloud rendering from one visual model (2026-11-07)

Full write-up: docs/visuals/RENDER-ARCHITECTURE.md.
- New `Model/VisualAtmosphere.luau`: condensation from adiabatic liquid water above the pressure-lowered condensation level, swirl ratio from the new updraught block, subvortices from it, flow, dust, coherent noise, nest lowering.
- `Model/TornadoView.luau` rewritten (body slices + flow tracers + subvortices + lagging dust; no rings). New `Model/WallCloudView.luau` draws the nest (never drawn in the game before). Both on in client/EngineStorms.
- Frame (display only): low-level mesocyclone centred on the tornado while down (S0057 funnel lean 3.3 km -> 0); tornado core cloudy in the nest; updraught block (FrameCodec UPDRAUGHT, client flags bit 5).
- Checks: tools/cloudlab/test_visual_atmosphere.luau (lune, all pass); tornado-frame, storm-appearance, storm-workers pass; runs clean in a standalone Studio test place. Not yet seen visually.
