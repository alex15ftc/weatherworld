# Engine-physics storms: plan (2026-11-06)

The proposal: take the cloud model out of the game. Move the physics we learned from it into the engine, in cheap pieces, so the engine both decides storms and gives them their 3-D shape. The C model stays as an offline teacher for fitting constants. Status: **approved 2026-11-06; Phase 0 passed; Phase 1 next** (decisions and first results at the end).

## Why

- **The model doesn't decide anything.** The engine is the authority; strength and counts never come back from the model. All it adds is a look, and that look has to be pushed and pinned to stay on the engine's storm.
- **Most open problems come from the two disagreeing:**
  - the mesocyclone 3-6 km off (E3);
  - the model's spin 11-13 km from the wall cloud (T1 live check);
  - no vortex before the engine's tornado, so T1 has no cue;
  - the model's tornado topping out near 35 m/s against the engine's 49;
  - flicker (T2 showed the controller isn't the limit).
- **Cost and scale.** A worker runs only near players: 8-34% of a core and about 110 MB per storm, plus warm-up. That doesn't fit a shared-weather MMO with many servers and storms. Engine physics costs microseconds and covers every storm on the map, identically on every server.
- **Roblox can't use the model's detail.** We can only draw billboard puffs and a few mesh sheets. The base sheet failed because the model's cloud-base field steps by hundreds of metres; a field built from the storm's own LCL is smooth.
- **Less upkeep.** There's no C/Luau twin to keep bit-identical.

## The rule: storm-changing or display-only

Anything that changes how a storm lives (its strength, life or tornadoes) must also run in the forecast copies, or the outlooks forecast a different world. So:

- **Storm-changing physics** goes into the engine and must cost microseconds a storm. It's covered by the regression suite and the forecast check.
- **Display-only physics** can be heavier. It runs only for storms near players, at draw time, and never feeds back. It needs no regression run.

## What moves from the model to the engine

| Model physics | Engine version | Gives | Role |
|---|---|---|---|
| Updraught buoyancy and entrainment | 1-D entraining parcel from the storm's sounding (E5) | Updraught speed with height, cloud top, overshoot, anvil level | Changes the storm |
| Rain and hail growth and fall-out | Simple column microphysics; fall-out drifted by the storm-relative winds | Rain rate, hail size, where the core and hook land | Display first, then changes the storm |
| Cold pool | Done (E2, js/storms/ColdPool.js); add a spreading gust front (density current) | Gust front position, shelf cloud, outflow winds | Changes the storm |
| Rotation | Spin budget: tilting of the inflow's spin into the updraught (from SRH), stretching near the ground | Mesocyclone strength; when a tornado can form | Changes the storm |
| 3-D cloud and rain fields | Built from the column above, spread around the storm by motion, shear and the cold pool | The frame Roblox draws; a smooth base for the base sheet | Display only |
| Tornado and ground winds | Standard vortex profile (Rankine or Burgers-Rott) plus inflow, sized from the engine's mph, width and stage | Tornado shape, debris, damage winds | Display only |

The rotation row replaces T1. The near-ground stretching term rises before touchdown, so the engine times tornadoes from its own physics instead of waiting on a model that never supplied a vortex.

## Steps

### Phase 0: prototype, display only (about 1-2 days)

1. A new module, js/storms/StormStructure.js. For one storm it computes the column parcel, rain fall-out, spin budget, cloud fields and vortex from the engine's state, with no feedback.
2. It writes the same client frame the Roblox views already read (ClientFrame.luau: base1/top1, rain, hail, nest and tornado blocks). FrameView, PuffView and BaseView barely change.
3. A side-by-side in Studio against the model's frame of the same supercell, from the default view, orbiting left and right, far away and from under. It also measures fps and build ms, and gives the base sheet a second try on the smooth base.
4. **Pass if** it looks as good or better than the model's frame, without hard-coded shapes, at no more than today's frame rate and network bytes.

### Phase 1: the game switches to engine frames

1. The feed sends engine-built frames for every storm a player is near. Workers are off in the game (the code stays).
2. Retire T1 + X1's hints, the push and the pin. They only exist to tie the model to the engine.
3. Finish the base sheet on the smooth base. Then the far card (visuals prototype 3).

### Phase 2: physics into the storm's evolution, one piece at a time

Each piece gets: regression baseline before, regression check after, a forecast check (seeds 41-50, 3 mornings) and a refit only if a day drops clearly.

1. Rotation (spin budget), so meso strength and tornado timing come from tilting and stretching.
2. The entraining parcel (E5), for updraught strength and storm tops.
3. Rain fall-out, for the hook, the core and hail size.
4. Gust front spreading, so outflow boundaries come from the density current.

### Phase 3: the C model as offline teacher

Run it on paired cases. Fit the engine's constants: the entrainment rate, the fall-out drift, the meso offset from the updraught (it measured about 2 km right and behind on seed 2), and the cold pool depth. This is the old plan's offline calibration item.

## What happens to existing work

- **Kept:** the engine authority and every engine fix (E2 cold pool, M2 maintenance lift); the Roblox views and frame format; the C model and cloudlab as offline tools; the old billboard tornado until the new one works.
- **Retired in the game:** storm workers, the push and the pin, T1 + X1, and the C/Luau parity burden on the game path.
- **Dropped:** the 11-13 km offset check, and T2.

## Risks

- **Rule-built storms can look samey.** Variety must come from fields: history, shear, age, the cold pool. Fine detail may need a seed by storm id (decision 2).
- **The climate is tuned** (outbreak climate, outlook calibration). Phase 2 changes storm evolution, so each piece goes through the regression suite and the forecast check, and may need a refit.
- **The look may fall short of the model's.** Phase 0 is the test. If it fails, we've lost a day or two and keep the model.

## Waiting until after Phase 0

- Forecast follow-ups: sharpen the truth's smoothing so I3 can go on, the Day 1 update table, I4.
- The short-range model change (approved, in its turn).

## Decisions for you

1. **Go-ahead for Phase 0.**
2. **Seeded fine detail:** is texture seeded by storm id acceptable? The large shapes come from fields; small puff jitter and edge breakup would need a seed.
3. **The tornado:** is it OK for the engine's vortex rules to draw it, reversing the plan for a cloud-model tornado?

**Answered 2026-11-06:** 1 go ahead. 2 yes, but seeded detail must make sense and not deviate from reality (it may only vary detail within what the fields allow). 3 engine vortex rules, but the tornado must join the storm smoothly, as one closed system with the wall cloud.

## Phase 0 first results (2026-11-06)

- **Built:** js/storms/StormStructure.js (display only). From the engine's storm and its inflow sounding it computes:
  - an entraining parcel, carried through a capped sounding to its free convection;
  - an updraught leaning from the mesocyclone;
  - a spin budget (the inflow's streamwise vorticity, scaled by the engine's mesocyclone and low-level rotation);
  - precipitation particles carried through the updraught and round both mesocyclones, with the rain scaled to the engine's dBZ;
  - an anvil, a cold pool, and a shelf at the inflow edge;
  - **one cloud-base surface**: the LCL of the rising air (inflow mixed with moist outflow, which gives the wall cloud), lowered by the meso and tornado pressure drop.

  The tornado's funnel is that same surface (the Rankine drop from the engine's mph and width), upright at the ground and curving into the meso at the wall-cloud base. It writes the model's full frame format, so the Roblox views are unchanged.
- **Feed:** `WEATHER_ENGINE_FRAMES=side` (js/game/StormWorkers.js) adds an `<id>~engine` frame beside each model worker. `only` builds engine frames for the storms wanted in detail and starts no workers (Phase 1). In the cloudlab, CloudLabEngineSideKm places the copy, and Y picks which storm T frames.
- **Numbers, seed 2, 20-21Z supercells:**
  - base 0.7-1.2 km, EL 11 km, top 13.7-13.9 km;
  - parcel peak 43-46 m/s against the engine's 50;
  - rain 30-100 mm/h, hail 120-140 mm/h as melted water;
  - 107-200 ms to build a frame;
  - near frame 3.4-4.4 KB Zstd, against 9.7 KB for the model's.
- **Tornado** (S0067, 85 mph, 79 yd): core 28 m, 8.5 hPa. The funnel hangs 77 m from the 945 m wall-cloud base, narrowing from 51 to 22 m. The nest base around it is 925-975 m, so it joins. A weak tornado under a 1.2 km LCL condenses only partway down; the rest of the core is clear air. This is the physics, not a cap.
- **Studio** (S0030 and S0041 side by side, puffs):
  - at 8 km and 107 km the engine copy reads as a leaning tower with a spreading top, much like the model's;
  - the engine copy draws 1,634 cloud columns to the model's 3,528;
  - 23 fps with the engine copy framed, 14 with the model's (both on screen).
- **Not yet checked:** a tornado in Studio, orbit left and right, and the base sheet on the smooth base.
- **Open:**
  - the low-level spin is weak on most storms (meso drop under 1 hPa), so the wall cloud comes almost all from outflow mixing;
  - seeded detail is not added yet;
  - the build time could come down (fewer particles).

### Phase 0, second pass (2026-11-06)

1. **Tornado in Studio:** seed 2, S0067, 85 mph, frozen with tools served from $J/torserve.mjs.
   - The clear core rises from its ground ring and leans into a short funnel under the dark wall-cloud base. They read as one piece.
   - Fixed: the funnel ended in a flat dark disc about 1 km across, its radius capped at 500 m right at the base. The top level now takes the funnel's own width just below the base (about 85 m here), and the cloud and nest draw the base itself.
2. **Weak low-level spin:** left to Phase 2. The engine itself rates S0067's low-level rotation at 0.13 while an 85 mph tornado is down. Raising it in the display alone would make the picture disagree with the engine, so it belongs with the spin budget.
3. **Base sheet on the smooth base:** joins far more of the storm, 125 columns and 153 triangles, against 128 of 4,926 before. Roblox's limit of about 6 meshes still leaves 535 triangles out, and it takes 199 ms to build. **Dropped:** the puffs already give the storm a dark underside.
4. **Seeded detail** (PuffView): the seed is the storm id plus the block, run and puff.
   - A puff moves at most half its block across and half its spacing up, so it never leaves its block's cloud.
   - Its size varies by up to 25%.
   - All of this scales with the run's depth: towers get all of it, thin anvils and shelves little.
   - Studio: lumpier tower and an uneven dark base, still 60 fps.
5. **Build time:** coarser particles saved only about 20% and made the rain peak unsteady (67-115 mm/h). The fine setting stays. The rain scale now uses the mean of the five wettest cells, not one cell. About 110-130 ms a frame, once per storm tick: about 0.3% of a core per near storm.
- Also new: workspace attribute CloudLabNoRain hides FrameView's debug rain boxes.

**Still open before Phase 1:** the game's tornado is the old billboard one. Phase 1 must feed it this frame's vortex shape (ground point, lean, funnel radius by height, tip, wall-cloud base), so the game tornado meets the wall cloud the way the frame does.

**Phase 0 passed (your call, 2026-11-06).** Next is Phase 1, starting with the game tornado taking its shape from the engine frame.

### Phase 1, step 1: the tornado drawn from scratch (2026-11-06)

**User decisions:**
- The engine frame draws the whole storm in the game: cloud puffs, wall-cloud base and tornado. The lab sim's storm visuals go behind a setting.
- The tornado is built from scratch, the way the cloud-lab storm was. It does not reuse TornadoCards or the old billboard tornado.

**Built:** `roblox/src/cloudlab/shared/Model/TornadoView.luau`, soft lit billboard puffs taken entirely from the frame's tornado block.
- **Funnel:** cloud where the Rankine core's drop takes the condensation level down to that height. Its radius at height z is where the drop equals ρg(Bt − z). ρg comes from the frame's own tip, so the view and the engine share one surface.
- **The join:** near the base the radius grows, up to 4 core radii, so the funnel widens into the wall cloud.
- **Lean:** from the frame's levels.
- **Spin:** the Rankine angular speed at each ring's radius.
- **Light:** PuffView.light with the cloud column overhead. PuffView's rule is now a shared function, so the funnel is shaded like the base it hangs from.
- **Dust:** out to where the ground wind falls to 15 m/s, thinning exponentially with height.
- **Fades:** a new frame eases the shape over 5 s, and the tip ring is faint.
- **LiveView switch:** CloudLabTornadoView, on with puffs. FrameView's `noTornado` keeps its HUD line and drops its cylinders. T now looks half way up the vortex.

**Studio, S0067 frozen (85 mph, 8.5 hPa, 945 m base):**
- A smooth funnel bulge merges into the base with no seam, over a soft dust column at the ground. Clear air lies between them, because the drop lowers the cloud only 77 m.
- 60 fps.
- Checked from default, far, orbit right and low.

**Open:**
- The dust reads dark and smoke-like under the storm's shadow.
- Short funnels on most tornadoes. That is the weak low-level spin and drop, Phase 2's spin budget, not the view.
- The rotation is only seen live; stills can't show it.

**Next:** the game draws each LiveStorms storm with PuffView + TornadoView behind a setting, with the lab sim's storm renderers off. Then `WEATHER_ENGINE_FRAMES=only`.

### Phase 1, step 1b: the game draws engine storms (2026-11-06)

**Built:**
- `roblox/src/client/EngineStorms.luau`: each storm in client LiveStorms is drawn with PuffView for the body and TornadoView for the tornado, from its engine frame. Positions are at map scale and heights at `Config.skyScaleAt`. FrameView is used only for its moving anchor, and its debug boxes are not drawn.
  - Storms whose frame arrived before it started are drawn on start. In the first game test the frame came 2 ms before it began listening, and a frozen feed never sends another.
  - Budget: 600 puffs for a near storm, 200 far, 300 for a tornado.
- **Switch:** workspace `StormVisuals = "engine"`, plus `LiveStorms = true`.
  - WeatherClient then leaves out the lab sim's BaseDeck, NearVfx, Scud, StormCards, StormVolume, VolumeCards, WallStream, TornadoCards, TornadoDust, DebrisView and DebrisCloud.
  - Rain shafts, near rain, lightning and the sky's light stay with the lab sim for now.
- `default.project.json` maps PuffView and TornadoView into `Shared.CloudModel`.
- **Debug:** workspace `EngineStormsDebugCam` gives T to frame the nearest tornado, orbit, zoom and Q/E, plus one output line per frame. Server and client LiveStorms also print their status and frames.

**Game test** (a copy of the game place with HTTP on, `StormSource = lab`, and $J/torserve.mjs with `AT_PLAYER=1 AT_KM=12` placing frozen S0067 12 km from the player):
- The server polled and sent one 3.4 KB near frame.
- The client drew 496 puffs plus the tornado in 26 ms.
- It looked the same as in the cloud lab: dark base, funnel bulge, dust column.
- The test copy's ground never loaded (ChunkWorker waits on ChunkDone), so the character fell. Not looked into.

**Open:**
- Rain, lightning and sky light still come from the lab sim, at its storms' positions, so they disagree with the engine storms. Next: draw rain from the frame.
- Check in the real place with ground.
- Then `WEATHER_ENGINE_FRAMES=only`, and retire T1, X1, the push and the pin (regression suite).

### Phase 1, step 1c: rain and hail shafts from the frame (2026-11-06)

**Built:**
- `roblox/src/cloudlab/shared/Model/RainView.luau` draws the frame's rain and hail planes as soft, overlapping billboard curtains. It follows the research in `docs/visuals-research/RAIN-AND-HAIL-AT-DISTANCE.md`:
  - The rate field is smoothed, and curtains sit on a jittered lattice, 2.5 spacings wide.
  - Opacity is rate × path, from the lidar fit 0.16 R^0.74 per km. Hail gets a fifth of rain's extinction. Each curtain is capped at 0.3 so its soft edges survive the overlaps.
  - The light is the light under the deepest cloud within 3 columns, dimmed by the rain itself.
  - Forward scatter brightens a curtain only when the sun is behind it and reaches it. Hail gets twice the gain, so it only looks white when sunlit.
  - Far curtains are hazed toward the sky colour.
  - The top is the lowest cloud base, at most 3 km, plus 250 m inside the cloud.
- **Texture:** `tools/rain/distant_shaft.py` → `roblox/assets/rain/distant_shaft.png` → rbxassetid://82911237877361 (decal 90860655799119). It is a bell across, ramps in at the top and feathers at the foot.
- **EngineStorms** draws one RainView per storm (160 curtains). `EngineStorms.precipAt` gives the rain at a point.
- **WeatherClient** in engine mode:
  - skips the lab sim's RainShafts;
  - sets `ctx.precipAt`, so NearPrecip's rain round the camera and its visibility come from the frames;
  - draws no near hail stones, because the frames don't carry hail size.

**Game test** (S0067 frozen, 12.5 km away):
- 159 curtains every 2.6 km, peak 127 mm/h, built in 9 ms.
- From the player and far views it reads as a dark grey veil under the base, with soft sides.

**Earlier tries, kept for the record:**
- One curtain per block with the fibre texture: a picket fence.
- Opaque overlapping curtains: a solid white block. The white came from rain lit as if no cloud were above it.

**Open:**
- no lean (the frame has no low-level wind);
- no rain-foot flare;
- no white hail ground or hail fog;
- curtain colours are only worked out when a frame arrives, not as the camera moves;
- lightning and sky light still come from the lab sim;
- not yet checked in the real place with ground.

### Phase 1, step 1d: lightning and sky light from the engine storms (2026-11-06)

**Built:**
- **Bundle version 3** (`js/game/StormWorkers.js frames()`): each shown storm now also carries its flashes a minute (`flashRatePerMin` of its updraught), the share reaching the ground, and the share of those that are positive (`chargeOf`, js/storms/Lightning.js). Model workers' storms send zeros. `StormFrames.luau` reads versions 1-3. `tests/storm-workers.mjs` checks version 3 and passes.
- **server/LiveStorms** makes the flashes, a game second at a time. Each second's flashes are seeded by the storm id and the second, so every server makes the same ones.
  - Ground strikes fall about the precipitation core, with columns weighted by rain and hail from the near frame.
  - Positive strikes come from the anvil (columns whose cloud starts above 5 km).
  - Cloud flashes go through cloud reaching above 5 km, weighted by depth.
  - Flashes go to clients as ("flash", list in map km).
- **StormHost** stops sending the lab's own flashes in engine mode.
- **client/LiveStorms** passes the flashes on as `LiveStorms.flash`. **WeatherClient** converts them to sim metres and fires them into `ctx.signals.flash`, so `Render/Lightning` draws them unchanged (channel, light, thunder; one in eight shown at the 8x clock).
- **Sky** (`Render/Sky`): with `ctx.cloudAt` (`EngineStorms.cloudAt`, the frames' two cloud layers at a point), the sun ray, the overhead depth and the dome cover all come from the frames' cloud, with the same 2.5 km light-fall rule as the puffs. Without it, the lab's storm shapes are used unchanged.

**Game test** (S0067 held still, clock running; `torserve RUN=1`):
- 30 flashes a minute, 11.6% to the ground, 7% of those positive.
- The client received about 40-47 flashes per 10 s (about 11% ground), with one positive strike.
- Sky from 12.5 km away: sun 1.00, light 1.00, cover 0.23.
- Sky under the base by the tornado: sun 0.12, light 0.18, cover 0.78.

**Open:**
- no lightning hole over the strongest updraught;
- flash light on the engine puffs (Render/Lightning lights the scene, not the puffs);
- the green tint now only shows under deep, heavily raining cloud;
- not yet checked in the real place.

### Real-place check (2026-11-06)

Ran in the user's place (terrain, map 600 studs/mile) with a frozen test tornado storm 12 km from the player:
- It works: 496 puffs, 135 rain curtains, flashes (about 5-10 cg and 30-70 ic per 10 s), and the sky dims under the cloud (sun 0.04) and is clear away from it (1.00). From the sunlit side the tower is white on top with a soft grey veil.
- Open:
  - The storm stands beyond the loaded ground (2048-stud radius), so it sits on the blue void. It needs the far-land rings under it, or a far card.
  - In the far view a hard-edged block shows at the left of the rain foot.
  - The funnel was a 77 m nub (a funnel cloud, no dust) in this frame.
- Test note: the game's StormHost needs /api/game/v1/lab/window before the client starts, so a storm-only test server must pass other GETs through to the engine.

### Step 1 fixes and step 2 (2026-11-06)

- **The light strip at the rain foot** had two causes:
  - The curtains' camera-dependent colour (forward scatter, haze) was set only when a frame came. Now RainView:recolour and PuffView:recolour redo it once the camera moves 300 m across.
  - Only the rain was hazed. Billboards ignore Atmosphere, so the cloud stayed dark over hazed rain. There is now one rule, PuffView.haze (60 km visibility scale), for puffs, rain and funnel (TornadoView), so they fade together.
- **The hard straight edge was the frame box.** The storm's cloud and rain ran past the 64 km box's downwind side and were cut there.
  - js/storms/StormStructure.js now places the box from the storm's own winds: the storm sits upwind by up to boxLean (0.25) of the box along the equilibrium-level storm-relative wind, full at 10 m/s.
  - S0067: rain columns in the box went from 1015 to 1338, cloud from 1095 to 1812.
  - A long anvil still runs past, so PuffView.edgeFade thins puffs and curtains over the box's last 6 km.
  - This is display only, with no regression run needed.
  - Cost: with more cloud in the box, the 600-puff budget gives 12x12 blocks (318 puffs) where it gave 8x8 (496).
- **Still open (far, high views only):** the curtain tops make a flat line at the cloud base where the base puffs are thin. From the ground the storm reads as one wall with a soft veil.
- **Step 2:** server/index.js now gives StormWorkers `engineFrames: process.env.WEATHER_ENGINE_FRAMES ?? 'only'`. "model" brings back the cloud model workers, "side" runs both. Engine-only mode:
  - caps engine frames at STORM_WORKERS.engineMax (6);
  - keeps a shown storm out to releaseKm, as workers did;
  - lists its frames in reportPlayers' `detailed`.
  - Checked: frame built, no worker started, kept at 75 km, dropped at 120 km. tests/storm-workers.mjs passes.

### Step 3: the model ties retired (2026-11-06)

- **T1 + X1** are out of js/storms/TornadoEngine.js: TORNADO_ARM, modelHint, arming, and touchdown at the model's vortex. The dice alone decide touchdown, which is what they always did without hints. A saved world's leftover armed, timing and atModel fields are cleared at the next touchdown.
- **The hints and the pin** are out of js/game/StormWorkers.js: world.modelHints, hintBehindS, PIN, pinShift and drawnPos. In model or side mode a worker's storm is drawn at drawnAt, the engine's updraught.
  - js/game/LabWindow.js drops timing and tornadoArmed.
  - tools/cloudlab/synccheck.mjs reports the unpinned miss in both slots.
  - tests/tornado-arming.mjs is deleted (it tested only T1 + X1).
- **Kept:** the model-side push (EngineRun steerPush and steerTornado). It lives inside the cloud model, never touches the engine or the game, and keeps the storm lab's side-by-side model with the engine's storm. It can go with the model whenever the lab stops using it.
- **Checked:** the regression suite (pre-t1x1 baseline, then t1x1-out) is identical in every measure (1399 tornadoes, no regressions). tests/storm-workers.mjs passes. No forecast check: forecasts never had hints, and the suite shows a null change.

### Phase 2 step 1, stage 1: spin budget measured (2026-11-06)

js/storms/SpinBudget.js is measured only and not wired into anything. It has three parts:
- tilting (Beltrami: zeta = lambda w, lambda = SRH / (D Vsr^2));
- lift from the mesocyclone's Rankine pressure drop, less the surface inhibition and the outflow's negative buoyancy;
- stretching of the 0-1 km spin.

Probe: 6 seeds x 10 days (job tmp/spin: probe.mjs, analyse.cjs), 286k storm ticks, 951 tornadoes.
- **Ranking is sound.** Rank correlation with today's values: mesocyclone 0.68, low-level 0.65. AUC for a tornado in the next 30 minutes:

  | Measure | AUC |
  |---|---|
  | wLow | 0.76 |
  | zetaLow | 0.74 |
  | zetaMid | 0.71 |
  | srh alone | 0.70 |
  | today's lowRotationFree | 0.82 (biased: it is the rate the tornado dice use) |

- **The sizes are not usable yet.**
  - zetaMid: median 0.026, 99th percentile 0.16 /s. Real mesocyclones are 0.01-0.05.
  - The lift then reaches 100-280 m/s, and stretching amplifies it further.
- **Cause found: slow storm-relative winds.** 0-3 km Vsr has a median of 6.5 m/s and 0-1 km 11.4; real right-movers are about 10-15 for 0-3 km.
  - In the worked case (seed 2) the engine moved the supercell at about 2 m/s, near the mean wind. Bunkers' right-mover motion is about 7 m/s right of that, which would give Vsr03 about 10 m/s rather than 5.
- **Next:** check engine supercell motion against Bunkers' right-mover motion across the probe. If supercells don't deviate right, fix the motion first; that is storm-changing and needs the regression suite. It changes the helicity a storm actually ingests and its tornado tracks. Then re-measure the spin budget before any switch-over.
- **Motion checked** (job tmp/spin/motion.mjs, seeds 1 and 3, 5 days, 3563 supercell samples with mesocyclone >= 0.3): engine supercells deviate right of the 0-6 km shear by a median of 3.7-3.9 m/s (10th-90th percentile 1.2-6.3). Bunkers' right-mover deviation is 7.5 m/s, fitted to observed supercells. Their median miss from Bunkers' motion is 6.2-6.7 m/s. So the engine's supercells deviate about half as much as real ones, which leaves their storm-relative inflow too slow. Fix that first (storm-changing, regression suite).
- **Correction (same day): storm motion is fine.**
  - Against the engine's own 0-6 km mean wind (MEAN_WIND_WEIGHTS: 0.13 surface, 0.5 850 mb, 0.37 500 mb), its supercells deviate right by a median of 4.8-5.0 m/s. The target is 5.8-5.9 m/s: 7.5 x rotating x (1 - line), with a line share of about 0.2.
  - They miss Bunkers' motion by a median of 3.9-4.1 m/s, about Bunkers' own error on real supercells. The "half" above came from measuring against a plain three-level mean. Motion is not changed.
  - The engine's SRH is from the full sounding against Bunkers' right-mover motion, so it is consistent with how its supercells move.
- **The slow Vsr was SpinBudget's own layer mean**, which took in the 500 mb wind (about 5.7 km) for the 0-3 km layer. It now uses the bottom, middle and top of each layer, interpolated in height. Re-probe (job tmp/spin2):
  - Vsr03: median 8.7 m/s, 10.7 at tornado start.
  - zetaMid: median 0.020, 0.033 at tornado start (real mesocyclones are 0.01-0.05). The top tail is still high: 90th percentile 0.06, 99th 0.12-0.13.
  - Lift: median 17 m/s, but 100-180 m/s in the top tail. zetaLow is not physical yet (stretching at 3 e-folds gives x20).
  - AUC: wLow 0.74, zetaLow 0.72.
- **Open for stage 2:** a bound on the tail from the updraught's own energy (the mesocyclone's rotation cannot hold more kinetic energy than the updraught that spins it up). Also a stretching limit set by what a low-level mesocyclone really reaches (0.01-0.05 /s; tornado scale is the next step, not this one). Then compare again before any switch-over.
- **Stage 2 limits** (job tmp/spin3).
  - Energy: rotation speed at most the updraught's w at the core radius 0.5 x (2.5 + 0.1 w) km.
  - Low level: zeta at most 2 w_low / 1.5 km.
  - Results:
    - zetaMid: median 0.017, 99th percentile 0.028 /s, in range but pinned at the energy limit for most supercells (2w/R is 0.025-0.028 at w 40-60).
    - zetaLow: median 0.035, 0.065 at tornado start, 99th percentile 0.11.
    - Lift: median 31, 90th percentile 65-83 m/s, too strong. The bound lets V_rot reach w, where radar shows 20-30 m/s.
    - AUC: zetaLow 0.72, zetaMid 0.71.
  - **Not ready to switch over.** Linear (Beltrami) tilting overestimates, because real updraughts and vorticity are not fully correlated.
  - Next: set the tilting efficiency from observed radar rotational velocities by environment (e.g. Smith et al. 2015; Thompson et al. 2017), not from a picked factor. Then re-probe.
- **Streamwise share, against radar** (job tmp/spin5; reference docs/storm-reference/mesocyclone-rotation-2026-11-06.md).
  - The tilting is now scaled by the inflow's relative helicity, SRH / (Vsr x shear), the share Davies-Jones ties to the w-zeta correlation.
  - Peak low-level Vrot per event (zeta_low x 750 m), against Smith et al. 2015 medians:

    | Storms | Spin budget (m/s) | Smith et al. 2015 (m/s) |
    |---|---|---|
    | Nontornadic supercells | 65 | about 10-15 (inferred) |
    | EF0 | 49 | 17.5 |
    | EF1 | 52 | 20.6 |
    | EF2 | 59 | 25.7 |
    | EF3 | 65 | 32.4 |
    | EF4+ | 62 | 37.6 |

  - Mid-level Vrot is 36-47 m/s, against about 15-30. That is about 2-3 times too strong, and the spread is too flat, because most supercells sit at the energy limit (V = w).
  - AUC: zetaLow 0.71-0.73.
  - **Not switched over;** today's rotation rules stay.
  - One physically grounded try is left: drive the budget with the updraught core's mean w rather than the engine's peak updraughtMs. If that still misses the radar table, shelve the spin budget (kept, measured only) and move Phase 2 on to the parcel (E5).
- **Core-mean updraught, the last try** (job tmp/spin6).
  - The budget is now driven by the frame's own updraught (StormStructure.updraughtProfile, a new measuring export): its mean over 3-7 km and the Gaussian core's disc, about 18 m/s for supercells against a 45 m/s peak.
  - Peak low-level Vrot per event, against Smith et al. 2015:

    | Storms | Spin budget (m/s) | Smith et al. 2015 (m/s) |
    |---|---|---|
    | Nontornadic | 19.7 | about 10-15 |
    | EF0 | 12.7 | 17.5 |
    | EF1 | 13.9 | 20.6 |
    | EF2 | 17.8 | 25.7 |
    | EF3 | 18.5 | 32.4 |
    | EF4+ | 17.6 | 37.6 |

  - Mid-level Vrot is 14-17 m/s.
  - The sizes are now right, but the spread is gone, and nontornadic storms rank above tornadic ones. AUC fell: zetaLow 0.67, zetaMid 0.65 (today's lowFree 0.81).
  - **Shelved.** SpinBudget.js stays, measured only; today's rotation rules (StormRotation.js) keep driving the mesocyclone and tornadoes.
  - Why it fails: three winds (surface, 850, 500 mb) and one peak updraught carry too little of what separates real tornadic storms (low-level shear and its curvature, the RFD's thermodynamics, storm-scale timing). The tuned rules hold that information as fitted observed relationships.
  - Revisit after Phase 2 step 2 (parcel E5) gives the engine a physical updraught, and if the environment gets a fuller wind profile.

### Phase 2 step 2, stage 1: the parcel measured (2026-11-06)

The frame's entraining parcel (StormStructure.updraughtProfile: parcelPeakMs, topM, elM) was run beside the engine every half hour. Six seeds x 10 days, 50k storm samples (job tmp/parcel).

**Updraught, median (10-90%), m/s:**

| Storms | Engine's potential (sqrt(2 CAPE) x ramps) | Engine's updraught | Parcel |
|---|---|---|---|
| Supercells | 50 (33-63) | 40 (28-52) | 35 (21-45) |
| CAPE >= 2000 and shear >= 40 kt | 60 (54-66) | 47 (38-57) | 42 (36-48) |

- Observed peaks are 36-53 m/s, about 65 m/s at most.
- The parcel's share of parcel theory is 0.3-0.6, median 0.5; the engine's entrainment ramp gives 0.6-0.9, median 0.8. Observed is about 0.5-0.8.
- The two rank storms alike: Spearman 0.89 against the potential.

**Tops:**
- Parcel tops for supercells: 11.1-13.6 km, with an overshoot of 1.7-2.7 km above the equilibrium level (observed 1-3 km).
- The engine's ramp (7 km + 160 m per m/s) gives 11.5-15.4 km, with no tie to the equilibrium level.

**Foretelling hail >= 1 in or a tornado in the next hour (AUC, severe / significant):**
- Parcel: 0.907 / 0.904. Engine potential: 0.900 / 0.894. Parcel top: 0.87.
- The engine's own updraught scores 0.977, but that is circular: hail is computed from it.

**Verdict: passes.**
- Proposed switch-over: in StormBudgets, the potential becomes parcel peak x inhibitionEfficiency, replacing sqrt(2 CAPE) x the entrainment ramp. Storm tops come from the parcel top.
- Loading, undercutting and inflow quality stay as they are.

**Before switching:**
- Updraughts drop about 10-15%, so severe counts will fall. Hail sizes and the tuned climate would need the regression suite, the forecast check and likely a refit.
- The parcel needs a sounding per storm per step, so it needs timing.
- The core radius grows with updraughtMs (StormGeometry), a mild feedback.

### Phase 2 step 2, stage 2: switch tried and reverted (2026-11-06)

- The parcel moved into an engine module, js/storms/UpdraughtParcel.js (with inflowCell). StormStructure and LabWindow use it; the frame fingerprint is unchanged (hash 3f3ea616...).
- Regression baseline pre-parcel: identical to t1x1-out.
- **Switch:** StormEngine passed the parcel's kept share as entrainmentEfficiency, and StormGeometry took tops from the parcel. The cache key is inflow cell + hour + core rounded to 250 m. It added no step time.
- **Result:** a two-day sanity run (seed 3) collapsed.
  - Supercell updraught median 26 m/s (it was 40); kept share median 0.40 (the probe gave 0.50).
  - Supercell hail 90th percentile 0.48 in.
  - Cause: feedback through the core width. StormGeometry's updraught radius is 2.5 + 0.1 km per m/s, so a weaker updraught gets a narrower core, which mixes more and weakens it further. The probe hadn't shown this because its widths came from the old, stronger updraughts.
- **Reverted:** the StormEngine call was removed and the fingerprint matches the baseline again. Left in place, inactive:
  - StormRealizationPhysics' optional parcel argument;
  - StormGeometry's stormTops, which takes parcel tops only when storm.parcel is set.
- **Needed before a retry:** a core width set by the inflow and environment, not by the updraught. For example, Peters et al. 2019-2020 relate supercell updraught width to the storm-relative inflow and shear. Then re-probe with that width, and switch only if supercell updraughts stay near the observed 36-53 m/s.

### Phase 2 step 2, stage 3: the parcel switched in (2026-11-07)

- **Width from the environment** (UpdraughtParcel.js `environmentParcel`). Peters et al. 2023 (JAS 80:2165) give the updraught radius as R = 2σHV / (απ√(2 ECAPE)), and mixing at ε = 2k²L / (Pr R²). H is the equilibrium level and V the 0-1 km storm-relative inflow. ECAPE is iterated from the unmixed parcel, so the width never depends on the storm's own updraught, and the feedback that collapsed stage 2 is gone.
- **First try** (the parcel's mixed peak as the potential):
  - Supercells ran 35 m/s against 40, and big hail halved: 2 in+ reports went from 16% to 7%, and hail CIG1+ days from 11% to 4%. Reverted.
  - Its kept share alone, applied to √(2 CAPE), gave 31 m/s, because it discounted twice.
- **Cause** (job tmp/parcel: probe3, probe4). Most of the gap was at the potential.
  - The drawn parcel's peak stacks the dragged-along air (1/1.5) and momentum drag on top of Peters' √(2 ECAPE). Peters' constants are already fit to simulated updraught peaks, so together that cut the speed to about 0.73 of what it should be.
  - The parcel's 500 m feed layer also holds 4-59% more CAPE than the engine's 100 hPa mixed layer, so its absolute speeds can't be compared with the engine's.
  - Ruled out: rain loading (about 1 for supercells) and feedback (it wins back about 2.5 m/s).
- **Switch:** entrainment efficiency = the parcel's dilution, √(ECAPE / CAPE), both from the same parcel, applied to the engine's own CAPE. Tops are the parcel's overshoot, scaled by the updraught over this potential.
- **Results:**
  - Sanity (seed 3): supercells 30 / 39 / 47 m/s (10/50/90%).
  - Regression suite (parcel-dil against t1x1-out): no regressions, nothing moved. 2 in+ hail reports 15.5% (base 16.4%); hail CIG1+ days 10% (11%).
  - Forecast check (seeds 41-50, 3 mornings, against pre-parcel):
    - place by place: day 1 right over 69% of the map (66%), day 2 49% (47%), day 3 33% (32%);
    - day 1 MDT+ CSI 0.51 (0.32), HIGH+ 0.08 (0);
    - the day's highest category exactly right: day 1 53% (70%), but within one category 97% (90%); day 2 60% (55%); day 3 30% (20%).
- **Kept.** The day-1 highest-category drop is being checked for whether a refit is needed: the engine now verifies more Moderate and High days, and the outlooks lag behind (more "too low").
- **Next:** revisit the spin budget (Phase 2 step 1) with this physical updraught, then step 3 (rain fall-out).

### Phase 2 step 1, revisited with the parcel (2026-11-07)

- Job tmp/spin7: 6 seeds x 8 days, 208k ticks, 838 tornadoes.
- **The new updraught changed nothing.** The budget is still flat across EF ratings: peak low-level Vrot 17-20 m/s, against Smith et al.'s 17-38.
  - AUC for a tornado in the next 30 minutes: zetaLow 0.68; today's rules 0.81.
- **Low-level shear is not too low but too high, and too uniform** (against Coffer et al. 2019, right-moving supercells):

  | 0-500 m SRH, median (m²/s²) | Engine | Real |
  |---|---|---|
  | EF2+ | 310 | 224 |
  | EF0-1 | 249 | 127 |
  | Nontornadic | 189 | 64 |

  - The engine's STP runs 2-4 times real.
  - The daytime 10 m wind is 0.56 of the nose wind, backed 31°. Similarity theory gives about 0.75 and 10-20°.
- **The user keeps this** (the outbreak climate, 2026-10-28). The spin budget stays shelved, measured only. Tornado timing, strength and width stay with StormRotation and TornadoEngine.

### Phase 2 step 3, stage 1: rain fall-out measured (2026-11-07)

Job tmp/fallout (probe, probe2; seeds 3/5/8, 2 days each). No engine change.
- **Today:** hail size is a tuned power law on w (StormHazards.js:101-114); the rain and hail centres are tuned (StormGeometry.js:65-67, :78); the radar-shape lobes and hook are painted (StormStructureEngine.js:62-84). The radar field (PrecipitationField.js) already carries drops and hail through the storm-relative wind, but on tuned inputs and with no rear-flank downdraught.
- **Forward-flank core** (supercells, observed 5-15 km from the updraught):

  | Source | Median distance | Share in 5-15 km | Side |
  |---|---|---|---|
  | Tuned geometry | 7.5 km | 72% | right of motion (the inflow side, wrong) |
  | Column fall-out | 5.3 km | 53% | forward-left (right side) |

- **Hook:** the radar shows a clean hook and notch in only 2.7% of supercell samples. The notch fills, because nothing clears it.
- **Hail size:** no physical variant both ranks storms by updraught and reaches the 3.5 in tail. The fall-speed balance caps near 2.2 in at 53 m/s; trajectory models mis-rank storms and give 1 in hail to pulse and line cells. **Hail size stays tuned.**
- **Next:**
  - the rear-flank outflow in the radar field (hook and notch), measured with the ring test;
  - the column fall-out for the core side, once its short distance is understood.

### Phase 2 step 3, stage 2: the hook, first part (2026-11-07)

- **PrecipitationField.js:** each rain patch now narrows in converging air and widens in diverging air, at the rate −dw/dz inside the updraught (a tracer patch in a strain field; Batchelor 1952, Garrett 1983). Before, it widened with its age alone. This adds no new constant.
- **Ring test** (seeds 3/5/8, 2 days each; mature supercells, n = 845):
  - hook with a notch under 25 dBZ: 1.1% → 9.8%;
  - all supercells: 2.7% → 10.7%;
  - the rear ring holds at 58 dBZ;
  - a weak-echo region appears (p10 under the updraught 35 → 21 dBZ);
  - no false hooks on cells (2.1 → 2.6%) or lines (0.6 → 0.8%).
- **Cost:** build time +5.5%. Radar tests pass. Regression fallout-hook against t1x1-out: no regressions, nothing moved.
- **Tried and dropped:** an RFD density current at the cold-pool speed × low-level rotation. It changed the ring by under 1 dB, because low-level rotation is small (median 0.25).
- **Still open:** the median notch is about 45 dBZ. Hail and big drops fall into it directly, because this field's updraught is wide (0.45 × StormGeometry radius, about 3.6 km) and sits only about 1 km ahead of the mesocyclone. Fixing that is a geometry change, part of step 2's fall-out positions.

### Phase 2 step 3, stage 2: the core position, not switched (2026-11-07)

- **Stage 1's 5.3 km came from the probe, not the physics.** Its column didn't loft particles, and it measured the ≥45 dBZ centroid, which is the hail beside the weak-echo region. The radar field's own rain centroid for supercells is 13.0 km from the updraught (10/90%: 4.9 / 19.3), 55% inside 5-15 km.
- **Tried** (tmp/fallout/work2.js, PFdev2.mjs): falloutMoments, the radar field's particles reduced to mass moments, at about 1 ms per supercell. On n = 1,132 supercells:

  | Rain centre | Median from the updraught | Miss against the radar field's rain centroid |
  |---|---|---|
  | Tuned | 7.3 km | 7.2 km |
  | Fall-out on the storm's surface / 850 / 500 mb winds | 6.8 km | 7.3 km |
  | Fall-out on the radar's column | 15.9 km | 4.8 km |

- **No improvement is possible** while the storm's environment holds no 700 or 250 mb wind. Fall-out from 8-12 km sets the distance. The hail centre agrees within about 1 km either way.
- **To do it:** carry the inflow sounding's wind column on the storm (environmentSampling or StormEngine). Then StormGeometry's centres become falloutMoments on it, and the drawn rain box and the radar agree.

### Phase 2 step 3, stage 3: cores from each storm's wind column (2026-11-07)

- **New files:**
  - js/storms/StormColumn.js: the radar's inflow column (surface / 850 / 700 / 500 / 250 hPa, storm-relative, every 250 m), held in a WeakMap beside the storm. It is not saved or sent.
  - js/storms/StormFallout.js: falloutMoments, the radar field's own particles reduced to landing moments, 0.6-0.9 ms per supercell.
- **StormGeometry:** the rain and hail cores relax toward the fall-out centres over fallHours, blended with the old rule by line share. Without a column the old rule applies. Forecast runs (withoutStormPictures) keep the old rule.
- **Supercells** (seeds 3/5/8, 2 days):
  - rain core 7.5 → 10.8 km from the updraught;
  - miss against the radar's rain centroid 7.2 → 4.3 km;
  - hail core 2.2 → 4.2 km;
  - in 5-15 km: 72 → 56%, because the spread is wider (3.3-19.5 km).
- **Checks:** storm tests 13/13, radar tests 3/3. Regression fallout-column against t1x1-out: no regressions, nothing moved. Hail CIG1+ days 15% (11%), hail 2 in+ share 15.8% (16.4%).
- **Cost:** storm tick 31.5 → 47-50 ms, about +50%. At the server's 5-minute storm tick (37.5 s real at 8x) that is small.
- **Known split:** forecast runs place cores by the old rule, so forecast and truth hail swaths can differ by about 2 km.
- **Forecast check** (seeds 41-50, 3 mornings, fallout-column against parcel-dil):
  - Day 1 and day 2 scores are unchanged to the percent: forecast right 53% / 60%, place by place 69% / 49%.
  - Day 3 within one category 90% (80%); MDT+ CSI 0.49 (0.51).
  - Day-1 verified hail CIG1 days 13% (20%), now matching the 13% drawn.
  - **Kept.**

### The inflow notch: cause found, not changed (2026-11-07)

Job tmp/notch (diag, hodo, bunk, ringbk, PFdev variants). No engine change.
- **What fills the notch:** 97-98% of the reflectivity there is hail. It leaves the updraught at 4-6 km and is carried round the mid-level mesocyclone into the inflow.
- **Why:** for mature supercells the storm-relative wind above 3 km blows to the **right** of motion (median +2 to +9 m/s), so downstream aloft is the inflow side. The motion (environmentSampling.js diagnoseStormMotion, ~:156) scales Bunkers' 7.5 m/s deviation by rotating × (1 − line) and adds cold-pool propagation.
- **Test:** the same field with each column taken relative to the full Bunkers right-mover (ringbk.mjs; mature supercells, n = 837):

  | Measure | Now | Full Bunkers motion |
  |---|---|---|
  | Notch median, 2 km (dBZ) | 46 | 24 |
  | Hook with a notch under 25 dBZ | 10.6% | 51% |
  | Under the updraught, median (dBZ) | 41 | 23 |
  | Rear ring (dBZ) | 58 | 59 |
  | Forward flank, median (dBZ) | 48.5 | 39 |

- **Source placement variants** (Peters width, inflow-root, hail leaving downwind aloft, meso on the updraught's edge, and combinations): none cleared the notch without weakening the rear ring. None kept.
- **This conflicts with the spin-budget finding** that "storm motion is fine" (it deviates 4.8-5.0 m/s against a scaled target of 5.8-5.9, and misses Bunkers by about Bunkers' own error). The question is whether a mature right-mover should take the full 7.5 m/s deviation. It would change tracks, inflow and reports: regression suite plus forecast check.

### Phase 2 step 4, gust front: tried and reverted (2026-11-07)

Job tmp/gust; the tried files are kept as *.gust-tried.js.
- **Today:**
  - Cold pool Δθ and depth are already in the observed range (median 6.3 K, 0.6-1.5 km).
  - The storm's outflow radius and lead are painted (StormEngine.js:153, StormGeometry.js:112).
  - The deposit into the atmosphere is 12 K × strength in a painted Gaussian (AtmosphereWorld.js:44, 207-209).
  - Pools spread at 3.7-5.3 m/s and decay mostly by a tuned 300 km wind-run mixing.
- **Tried** (RegionalAtmosphere.js, ColdPool.js):
  - the pool spreads as a density current, Fr 0.9 × sqrt(g h ΔT/T), against the low-level wind;
  - depth from ColdPool's deficit-depth relation;
  - mixing held back by the bulk Richardson number;
  - the night e-fold dropped.
- **Probe:**
  - boundaries lasting 6 h+ 2.3% → 4.3%;
  - dying-storm pools last 3.5 → 7 h at night (observed 6-24 h);
  - depth 0.55-1.4 km;
  - tornadoes 214 → 219.
- **Regression:** EF1 share 40.9% against base 37.8% (target 35%), just over tolerance. Everything else was within tolerance; boundaries per analysis went 1.62 → 2.34. The flag couldn't be tied to a cause and may be noise, so the change was reverted.
- **Open:**
  - replace the wind-run mixing with an entrainment law;
  - the painted deposit and radius (AtmosphereWorld, StormEngine);
  - a retry, with a second baseline to size the EF1 noise.

### Supercell motion: the full right turn (2026-11-07)

- **Cause:** the 2026-11-06 "motion is fine" check measured against the engine's own scaled target, which hid a double cut.
  - The deviation was multiplied by (1 − line), and the line blend then took (1 − line) again: 7.5 × (1 − line)².
  - Mature supercells have rotating = 1 but a line share of 0.17 (from crowding), so they deviated 6.0 m/s instead of 7.5.
- **Change** (environmentSampling.js diagnoseStormMotion):
  - the line blend comes first;
  - then the Bunkers deviation × rotating × (1 − ramp(line, 0.25, 0.7));
  - the cold-pool push is scaled by (1 − that share), since Bunkers already includes it.
- **Mature supercells** (seeds 3/5/8):
  - deviation 6.0 → 7.6 m/s; miss against Bunkers 3.1 → 2.5 m/s;
  - 0-3 km SRH ingested 231 → 260.
- **Ring test:**
  - notch median 46 → 40 dBZ;
  - hook with a notch under 25 dBZ 10.6 → 18.3%;
  - weak-echo region 41 → 35 dBZ;
  - rear ring and forward flank kept.
- **Cores:** the rain core moved to the forward-left side (1.3 km right → 1.6 km left of motion).
- **Regression** (motion against t1x1-out): no regressions, nothing moved. EF2+ 3.08 a day (2.88), MDT+HIGH 22.5% (20%), storm speed 35.2 mph (36.1).

### Phase 2 step 4, gust front: installed (2026-11-07)

- The user accepted the EF1 shift. The boundary boost was checked (tmp/gust probe2): its outflow part already scales close to the physical c_b² = g·Δθ·h/θ, and weak or old boundaries give little boost, so it is unchanged.
- **Installed as tried:** RegionalAtmosphere.js coldPoolSpread (Fr 0.9), sun warming and mesohigh through the pool's own depth, mixing held back by Ri, the night e-fold removed; ColdPool.js coldPoolDepthForDeficitK.
- **Regression gust-boost** (with the motion change, against t1x1-out): no regressions. EF1 38.1% (base 37.8%), so the earlier 40.9% was seed noise.
  - Moved (track-only):
    - ground pools 1.5 K+ 12 → 23% of the map;
    - outflow boundaries 1.62 → 2.44 per analysis;
    - tornadoes within 40 mi of an outflow boundary 35 → 42%;
    - storms a day 94 → 101.
- **Open:**
  - analysed boundary life median still 1 h (the wind-run mixing and analysis thresholds);
  - the painted deposit in AtmosphereWorld.js;
  - the storm's own pool radius and lead.
- **Forecast check, motion + gust front** (seeds 41-50, 3 mornings, against fallout-column):
  - Map-wide scores flat: place by place day 1 68% (69), day 2 50% (49), day 3 34% (34).
  - The day's highest category exactly right fell: day 1 47% (53), day 2 45% (60). Day 1 within one category 90% (97).
  - The misses are nearly all "too low": day 1 43% (33), day 2 50% (35).
  - Day 1 MDT+ CSI 0.41 (0.49); probability skill slightly lower (tornado 15% against 16%, wind 31% against 33%).
  - Read: the engine now makes stronger days than the outlook calibration expects, so a refit is due.

### Outlook refit after Phase 2 (2026-11-07)

- **Fit set:** seeds 1-20 × 5 mornings, current engine (tmp/fc/fit-2026-11-07). Check set: seeds 41-50 × 3 (tmp/fc/motion-gust).
- **Full refit** (chances + CIG_SHARE): day 1 right 47 → 53%, within one 90 → 93%, but High never forecast (7 → 0%; verified 13%). Not kept; saved as tmp/fc/outlookCalibration.full-refit.js.
- **Installed: chances only** (--chances-only), with the old CIG_SHARE, as in the 2026-10-29 refit.
  - Day 1: right 53% (47), within one 90%; forecast High 7%, MDT 17% (verified 13%, 20%).
  - Days 2-3 unchanged (45% / 30%).
  - Outlook tests 3/3.
  - Backup: tmp/fc/outlookCalibration.pre-refit.js.
- Day 2 still never forecasts MDT or HIGH (20% and 10% verified), and day 3 is always SLGT. Those are open, as before.

### Day 2-3 outlooks (2026-11-07)

Job tmp/d23.
- **Day 3 was held at SLGT** by GUARD_LEVEL.severe 45 (outlookCalibration.js): places held at 43% verified 51%.
  - Raised to 60, where any-severe Moderate starts.
  - leadCaps.day3 ENH → MDT (SPC's own Day 3 maximum).
  - Day 3 right: fitting 40 → 47%, unseen 30 → 50%; too high 10% / 0%; mix now SLGT 80 / ENH 20.
- **Day 3 still can't hatch** (ingredient members carry no significant-severe tier, DayOneOutlook.js:239), so Day 3 MDT can't be issued.
- **Day 2 has no structural cap.** On the fitting set it issues MDT 13 / HIGH 3 (verified 15 / 8). The unseen set's big days have weak Day 2 signals: the raw tornado chance is about half of Day 1's, with tornado CIG2 run shares 0.06-0.19 against 0.25 needed. The live leadCaps.day2 = MDT also turns its rare HIGH into MDT.
- outlook-verify.mjs has a new --lead-caps option, to score with the server's caps.
- **Open for the user:**
  - a significant-severe tier for Day 3 members (new runs, about 105 min);
  - the perturbation size for Day 2;
  - the Day 2 HIGH cap.
- **Round 2** (new archives tmp/d23/fit-new and check-new, about 3 h of runs):
  - **Day 3 significant tier, kept.** DayOneOutlook.js severeComposite: max(STP, SCP/4) gives significant and intense shares on the ingredient runs, which hatch from 0.45 (ingredientCigBounds). Day 3 right: fitting 48 → 52%, unseen 50 → 50%; mix SLGT 70 / ENH 30. Day 3 MDT is still never issued: the raw chance never reaches the 60 guard.
  - **leadCaps.day2 now HIGH** (user's choice). Day 2 fitting 56 → 59% with caps.
  - **Flow-scaled spread, off** (FLOW.exponent 0, code kept). Day 2 fitting 59 → 53%, too high 11 → 16%; unseen 45 → 55%; Day 1 unseen 53 → 47%. Net worse.
  - **Refit not installed:** the new archives carry the flow scaling, and the fitted Day 2 CIG shares lowered Day 2.
  - Outlook tests 3/3.

### Storm cold pools and boundary life: tried twice, reverted (2026-11-07)

Job tmp/gust (*.pool-tried.js, *.pool-tried2.js, StormOutflow.pool-tried2.js, worker.pool-tried2.mjs). All files are restored.
- **Built:**
  - Ellison & Turner entrainment in place of the 300 km wind-run mixing;
  - a box model of each storm's pool (StormOutflow), fed through the downdraught's edge at its front speed;
  - a lead from the front speed plus the low-level wind;
  - a deposit conserving deficit × volume;
  - InitiationEngine blocking only inside the pool disk;
  - a gap-tolerant line tracker.
- **The outbreak climate failed:** tornadoes 230 → 125-179 across variants (final 148).
  - The cause is the source size. The flux through the downdraught's edge (about 5e9 K·m³/s for a strong storm) is plausible against evaporation, but 5-7× what an observed supercell pool holds. With about 100 storms a day the warm sector fills with 4-8 K air.
  - The engine carries only dimensionless shares (precipitation, coldPoolStrength), so it has no physical downdraught mass flux or evaporation rate to size the source without tuning.
- **Pool radius (final variant):** supercells 42 / 98 km p50 / p90 (too large); lines 61 / 111 km.
- **Lead:** supercells 12.5 / 42 km, against observed 5-20 km.
- **Tracker alone** (measuring only): boundary life p90 3.5 → 6.0 h, 6 h+ 2.7 → 10.5%; median still 0.5 h.
- **Options:**
  - (a) the tracker alone, with a new regression baseline;
  - (b) a physical downdraught mass flux or evaporation rate in StormBudgets, then the pool on top;
  - (c) the lead model alone, on the existing radius.

### Boundary tracker and gust-front lead (2026-11-07)

- **Tracker** (tools/regression/worker.mjs): gap-tolerant line matching (nearest points under 60 km, up to 2 missing analyses). Baseline tracker-base against gust-boost, same engine:
  - outflow boundary life median 1.0 → 2.0 h;
  - 6 h+ 4.5 → 15.1%.
  - Measuring only.
- **Gust-front lead** (js/storms/GustFront.js, from StormEngine; StormGeometry reads storm.gustFrontLeadKm):
  - dL/dt = Fr·√(g′h)·(r0/L)^(1/3) + (u_low − motion)·along: a constant-flux axisymmetric gravity current (Huppert 1982);
  - smooth bounds between the updraught radius and the pool radius.
  - Results (p10 / p50 / p90):
    - supercells 3.6 / 17.9 / 38.2 → 9.0 / 16.0 / 29.1 km;
    - lines 18.9 / 36.7 / 52.0 → 9.8 / 18.9 / 42.0 km.
  - Regression lead against tracker-base: no regressions, nothing moved (it is display only). Storm 13/13, radar 3/3.

### Meteorologist review of today's engine (2026-11-07)

Packs: data/day-reviews/review-2026-11-07 (seeds 2112 and 41, 3 days each). Scores 6-8 out of 10.
1. **Major: supercells move along the real mean wind, not right of it.**
   - The engine's mean wind (environmentSampling.js:150) is surface / 850 / 500 at 0.13 / 0.5 / 0.37, with no 700 mb. With a backed 850 mb jet (172-176°) under 230-241° at 700 mb, it backs the mean by about 15-20°.
   - Tracks run 31-47°, against a full-profile Bunkers of 56-66°. The sounding's own Bunkers (sounding.js:579, full profile) disagrees with the storms.
   - Fix: a full-column 0-6 km mean wind.
2. **Major: a primed warm sector at dawn** (2112 d1): EF3 by 1530Z and EF4s by 1630Z; the outlook says storms "from about 17Z". It needs a real 12-15Z CIN (nocturnal inversion and BL recovery).
3. **Moderate: violent tornadoes** 7% of all (10 of 137), against about 1% long-term and about 4% on 27 Apr 2011.
4. **Moderate:** spurious analysed drylines under an upper low, and weak-shear cells typed as lines (41 d2).
5. **Moderate:** the night LLJ and SRH tail is too large (850 mb 91 kt, SRH01 p90 about 1000 at 03-06Z).
- **Also:** the gust front 9-16 km ahead of a mature supercell seems large to the reviewer, who expects a few km.
- **Right:** Day 1 outlooks verified well; soundings are coherent; tracks curve right as storms mature; tornado widths and the 3-day variety look good.

### Full-column mean wind for storm motion (2026-11-07)

- **Change** (environmentSampling.js columnMeanAndShear, as sounding.js meanWindLayer and bunkers): the 0-6 km mean and shear from the surface / 850 / 700 / 500 / 250 anchors every 250 m. It reads only the cells, so forecast runs move the same way.
- **Mature supercells:**
  - bearing minus the sounding's Bunkers −8.6° → −0.7°;
  - |V − Bunkers| 4.7 → 2.1 m/s;
  - SRH01 ingested 196 → 266.
- **Ring test:**
  - notch median 40 → 29 dBZ;
  - hook with a notch under 25 dBZ 18 → 38%;
  - the echo at the mesocyclone 55 → 37 dBZ;
  - false hooks on lines 0.4 → 2.3%.
- **Cores:** the rain core is 8.2 km out, on the left (70% inside 5-15 km); hail miss 2.7 km.
- **Regression** meanwind against tracker-base: no regressions.
  - Hail CIG1+ days 10 → 20%; 3.5 in+ 0.17 → 0.61% (SPC 0.7).
  - Hail 2 in+ share 19.1% (target 14.1); EF3 share 4.8% (near its limit).
  - MDT+HIGH days 27.5% (20); EF2+ a day 3.17 (2.84).
- **Forecast check** (seeds 41-50, --lead-caps, current tables; meanwind against motion-gust rescored):
  - **Day 1:** right 57% (53), within one 97% (90), place by place 63% (68); forecast MDT 33%, HIGH 0% (verified 20% / 13%); MDT+ CSI 0.36 (0.41).
  - **Day 2:** right 50% (45), within one 80% (90), place by place 46% (50).
  - **Day 3:** right 50% (50), within one 70% (80).
  - Probability skill unchanged.
  - Mixed, inside the refit rule (more than 15 points right or 10 within one). Kept, with a refit to batch with the next engine change.
- **Refit check after the mean wind** (fit set tmp/fc/fit-meanwind, seeds 1-20 × 5):
  - **Current tables, 100 Day 1 outlooks:** right 70%, within one 97%; HIGH forecast 7% against 4% verified, MDT 12% against 23%. So HIGH is not gone: the unseen set's 0% was 2 of 30 days.
  - **Chances-only refit,** scored on the unseen set: right 53% (57), within one 100% (97), MDT 37% against 20% verified, HIGH still 0%. Not kept; restored. The tried table is tmp/fc/outlookCalibration.refit3-tried.js.
- **Day 1 guard test** (tmp/fc/guardtest.sh; fit set 100 outlooks / unseen 30):
  - **Current:** right 70% / 57%; too high 12% / 13%; MDT 12% against 23% verified; HIGH 7% against 4%.
  - **Hail and wind unguarded:** right 67% / 57%; too high 23% / 20%; MDT 14%. It mostly turned SLGT into ENH (53% against 34% verified).
  - **All unguarded:** right 58% / 60%; HIGH 13% against 4% verified (HIGH+ FAR 0.87).
  - **Guard kept.** The under-called MDT is limited by hatching: hail CIG2 and wind CIG are never drawn, because the runs seldom agree on significant hail or wind. It is not limited by the chances.
- **Environment signal for Day 1-2 hail and wind hatching** (SHIP, DCP; tmp/d23/fit-sig, check-sig):
  - Built, fitted, **off** (CIG_ENVIRONMENT = {}).
  - It lowered the deviance only slightly (Day 1 hail CIG1 176.7 → 172.7, wind CIG1 45.6 → 42.8).
  - On the unseen set MDT moved further from verified (33 → 37% against 20%), and hail CIG1 was over-drawn (33% against 17%).
  - The groups MDT needs (hail CIG2, wind CIG2+) are reached in under 1% of run areas, so too rare to fit. The Moderate shortfall is in the runs' significant hail and wind, not in the forecast rules.
  - Runs now save the composites, so a future fit is one line.
