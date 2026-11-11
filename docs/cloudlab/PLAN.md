# Cloud model in the game: plan (2026-11-05)

Where the cloud model (roblox/Labs/CloudLab) goes from here, after the 2026-11-04/05 discussion.
Status and results so far: [STATUS.md](STATUS.md) (rounds 1-10). Review prompts point at
[../REVIEWER-BRIEF.md](../REVIEWER-BRIEF.md).

## Decisions

1. **The engine decides every storm.** Where and when it starts, its track, strength, cold pool,
   tornadoes and end. It also owns the air: storms use it up there (`applyStormFeedback`:
   mid-level warming and inflow drying; cold pools carried in the atmosphere).
2. **The cloud model shows the physics of a storm**, steered toward the engine's storm
   (`EngineRun`: inflow air, motion, lift, cold pool, tornado-time lift, decay). It never
   decides anything the game reads as fact.
3. **The cloud model runs beside the engine.** One worker process per detailed storm, shared by
   every Roblox server, sending compact frames. Not on clients (too heavy for phones, and players
   would see different storms) and not on each Roblox server (limited CPU, duplicated work).
4. **Visuals are client-side only**, drawn with billboards (no parts, no shaders), from the
   frames. Art is the friend's; we do the placement code and the field-to-visual mapping.
5. **The tornado comes from the tornado wind field** (roblox/Labs/TornadoLab/Tornado), not the cloud
   model. 250 m (even 62.5 m) can show the rotation that makes a tornado but not the tornado; a
   tornado needs 10-20 m. The engine says whether a tornado is down and how strong it is, and the
   cloud model's nest says where its rotation is.
6. **Level of detail:**
   - every storm gets an engine-described look;
   - storms near players get a 1 km cloud-model box;
   - the storm being chased also gets the 250 m nest and the tornado wind field;
   - squall lines get a coarse long box;
   - ordinary clouds stay on the engine's sky grid.

## Layers

| Layer | Runs where | Feeds |
|---|---|---|
| Engine air grid (16 km cells, full soundings; storms use it up) | Node engine | everything |
| Storm decisions (start, track, strength, cold pool, tornado, end) | Node engine | workers, Roblox servers |
| Roblox server air copy (Sim/Environment: 4 km surface grid, heating, anvil shade, cold pool) | each Roblox server | probes, gameplay wind, local effects |
| Cloud model storm (1 km box, 250 m nest) | worker beside the engine | frames |
| Storm-scale winds (inflow, outflow, rear-flank downdraft, gust front) | from the frames, on the Roblox server | damage, probes, chase feel |
| Tornado wind field (WindField / Vortex / WindPhysics) | Roblox server (authority), clients (effects) | damage, lofting, debris, dust, radar |
| Visuals (storm cards, anvil, rain and hail curtains, wall cloud, tornado billboards) | clients | the player |

## Phase A: storm worker beside the engine

Goal: the engine runs `EngineRun` for chosen storms and serves their frames.

1. **Runtime.** Lune 0.8.9 (a Luau runtime with files, HTTP and processes). **Done 2026-11-05.**
   The model modules load unchanged under Lune, so Roblox and the worker run the same code. It is
   not yet in roblox/aftman.toml: aftman's install failed because rojo.exe was in use. For now it
   lives in the job's scratch folder.
2. **Worker** (tools/cloudlab/worker/worker.luau). **Done 2026-11-05.**
   - a small localhost HTTP service: POST /start, POST /update (engine record or ended),
     GET /frame (FrameCodec bytes), GET /status (lag, step time), POST /stop;
   - it steps `EngineRun` until the model reaches the storm's engine time, so it never runs
     ahead and reports how far behind it is;
   - tools/cloudlab/worker/drive.mjs drives it from an exported scenario at the game clock's
     pace (the engine's part, until A3).
3. **Scheduler in the engine** (js/game/StormWorkers.js). **Done 2026-11-05** (tests/storm-workers.mjs):
   detail within 60 km of a player, nest within 20 km, let go after 2 min beyond 90 km; cap
   WEATHER_STORM_WORKERS (default a quarter of the cores, at most 8). Players are reported by
   POST /api/game/v1/storm/players. The nest is only ever added, never dropped.
   - chooses which storms get a worker (Phase D tiers), from the player positions the Roblox
     servers report;
   - starts, feeds and stops workers;
   - caps the count by the cores available;
   - a storm that loses its worker keeps its engine look.
4. **Frame endpoint:** **done 2026-11-05** as `/api/game/v1/storm/frames?have=id:seq,...&parts=full,near,far`:
   one binary bundle of the frames newer than the caller holds, each Zstd, with the full frame
   and both client frames (reader: shared/Model/StormFrames.luau; status at /storm/workers). Was planned as `?ids=...`, the newest frame per storm with a
   sequence number, so a Roblox server only fetches what changed.
5. **Catch-up and restarts.** (Warm-up from the environment: **done 2026-11-05**, STATUS "Live mode".)
   - `EngineRun` save and restore (all fields plus the run's state) for engine restarts.
   - A storm that becomes detailed when it's already mature starts from the engine's state at
     the time: a short warm-up at higher speed from its own track, or its environment and a
     strong start lift, then nudging.
   - Test which gives a believable storm sooner.
6. **Acceptance:**
   - a seed's day in the engine with two detailed storms;
   - the frames match the command-line `engine_storm` results for the same storm;
   - the worker keeps up with the 8x clock;
   - killing the engine and restoring resumes the storms.

## Phase B: frames

Goal: as little data as possible, enough for the visuals and the storm-scale winds.

1. **Frame format:** `roblox/Shared/CloudModel/FrameCodec.luau` (encode and decode).
   **Done 2026-11-05.**
   - 1 km box, 12 bytes a column: two cloud runs (base and top), ground rain and hail, cold pool,
     ground wind, 5 km updraft, 1 km rotation, anvil snow.
   - 250 m nest, 5 bytes a column: cloud base below 3 km, ground wind, ground rotation, pressure
     drop.
   - Measured: box 49 KB raw, 3.5-8 KB compressed; with the nest 61 KB, about 13 KB compressed.
2. **Client frames are cut down** ([NETWORK.md](NETWORK.md)). **Done 2026-11-05:** FrameCodec.js
   clientFrame and shared/Model/ClientFrame.luau, planar visual fields; near about 3 KB (box and
   nest visuals), far about 1 KB (half resolution, no nest), against 13-14 KB full. 2 near and
   8 far storms come to about 1.9 KB/s a player. Planned as: visual fields only, sent every
   60 game seconds, half resolution for far storms. The server keeps the full frames.
3. **A few 3-D slabs**, only if the cards need them (for example cloud water at 3 levels for
   towers). Decide in Phase E.
4. **Rate:**
   - a frame every 10-20 s of game time;
   - clients blend between the last two frames, and storms move between frames by the engine's
     motion;
   - Roblox server fetch: one request per poll for all storms (HttpService allows 500 a minute);
   - replication to clients: only storms within view range, sent as RemoteEvent buffers. Budget
     about 4 KB/s a player for a sky of 10 storms ([NETWORK.md](NETWORK.md)).
5. **Placement:** the model storm (the box's follow target) is drawn at the engine storm's
   position. The model storm drifts off the engine's track (about 85 km in 5 h for S0008).
6. **Acceptance:**
   - frame size and replication bandwidth measured per client with 3 detailed storms in view;
   - the client view matches the lab's debug view.

## Phase C: speed

Goal: every worker faster than the 8x clock, with headroom.

1. **Measured under Lune** (2026-11-05, SupercellB, 8x clock):
   - the 1 km box takes about 440-530 ms a 6 s step, about 13x real time: it keeps pace;
   - box plus nest takes about 1000 ms a step, about 6x real time: it falls behind by about
     1 game minute every 3.
   - Lune is about 15% slower than the command-line luau with native code.
2. **The nest has to get faster** (needed only for the chased storm, tier 2). Options, in order:
   - faster code with the same results: **done (round 12), 15%**; the mature storm still runs at
     5.7x real time;
   - run the nest in a second worker process: **done (round 13)**. The mature box plus nest runs
     at 10.2x real time and the live worker keeps pace with the 8x clock. Each detailed storm with
     a nest uses two cores;
   - start the nest later, only when a player is within chase range.
3. Studio lab speed separately: a foreground check (it ran at about 3x unfocused). Parallel Actors
   only if the lab needs it; the game doesn't run the model in Roblox.

## Phase D: many storms, squall lines, level of detail

1. **Tiers:**
   - **Tier 0, every storm:** the engine's appearance (updraft size, anvil length, rain area,
     tops, line shape), drawn as billboards. No worker.
   - **Tier 1, within view range of a player** (about 60-100 km): a 1 km box, capped by cores;
     nearest storms first, then the strongest.
   - **Tier 2, the storm a player is chasing** (within about 20 km): the 250 m nest plus the
     tornado wind field.
   - Moving between tiers blends over a minute (fades, not switches).
2. **Squall lines:** a coarse long box (2 km over 256 x 64 km, or a box aligned with the line).
   Test on the SquallLine export: line structure, a bow, rear inflow. If it costs too much, a
   chain of 1 km boxes along the line's leading edge.
3. **Merging and splitting:** when engine storms merge, their runs merge (keep the stronger box).
   When the model splits a storm and the engine has two, the second gets its own box only if the
   engine says so.
4. **Client budget:**
   - measured cards per storm and frame time with a sky of 10+ storms in view;
   - tier 0 storms use few, large cards;
   - the tornado keeps its 500-billboard budget.

## Phase E: client visuals (billboards)

The friend's art; our placement and lighting from the fields.

1. **Storm body and towers:** cards on the 1 km cloud surface. Their size comes from the grid,
   their brightness from how much cloud lies between them and the sun (the column's cloud water
   and snow above).
2. **Anvil:** from the snow layer; its spread and thinning come from the frames.
3. **Rain and hail curtains:** where and how heavy from the ground rates, whiter where hail; the
   visibility inside from the same numbers (PRECIP_VISIBILITY in the main game).
4. **Wall cloud and lowerings:** from the nest's cloud base under its rotation.
5. **Tornado:** the existing TornadoArt billboards, placed at the nest's low-level rotation (the
   engine's position when it disagrees by more than about a nest width), sized and spun by the
   tornado wind field, life stages from the engine (rope, multi-vortex), dust from the wind field.
6. **Ordinary sky:** unchanged (the engine's sky grid, SkyLight).
7. **Acceptance:** the reference shots (docs/stormlab/SHOTS.md) for a cloud-model storm, viewed
   from several angles and distances.

## Phase F: wind field upgrades

What the inspiration game has that we don't yet:

1. **Gust and instantaneous wind:** a 3-s running gust alongside the instantaneous wind at each
   point. The EF rating stays the 3-s gust; probes and radar show both, so instantaneous readings
   well above the rating come out naturally.
2. **Swirl ratio and corner flow varying with height** relative to the vortex.
3. **Damage by exposure, not just peak:** how long the damaging wind acts on a point (a slow
   tornado lingers, a fast one can't do violent damage), in WindPhysics' failure model.
4. **Radar velocity sampled from the same fields:**
   - the tornado wind field near the tornado;
   - the cloud model's winds for the storm (couplet, rear-flank downdraft, outflow);
   - the engine elsewhere.
5. **Storm-scale winds in gameplay:** the frames' surface winds (outflow, rear-flank downdraft,
   gust front) for straight-line damage and probes, with the tornado wind field added inside.
6. **Debug views:**
   - EF-coloured wind;
   - pressure;
   - radar velocity;
   - vorticity;
   - instantaneous and gust.

## Phase G: physics open items

1. **Ground heating in the box:** sensible and moisture fluxes from the ground (the engine's
   surface state), so cold pools recover after a storm. Now a -3 K pool sits forever. The engine
   still owns how much the air is used up.
2. **Full nested life rerun** after rounds 9-10 (the lift fix, snow, hail). About an hour; once.
3. **High-precipitation hodographs** (S0008: nearly all shear below 3 km). Check the storm type
   matches what that shape should give, and say so in the engine's mode if not.
4. **Tornado-time behaviour:** whether the low lift under the rotation gives a visible wall cloud
   and a tightening rotation at the engine's tornado time in the nest. Tune only toward visible
   structure.
5. Later, only if a review asks: Coriolis, radiation.

## Phase H: staging, then the live game

1. **Studio lab, replay:** done (CloudLabScenario, round 10). Next, one foreground watch at speed.
2. **Studio lab, live engine:** the lab reads frames from the local engine's endpoint (Phases A
   and B) instead of running the model itself, and draws them with the Phase E cards.
3. **Main game in Studio:** StormHost fetches frames for its region, replicates by view range,
   and the clients draw tiers 0-2; damage and probes use the Phase F winds. Test with Studio in
   the foreground; the camera stays the user's.
4. **Live game:** workers on the engine's machine, sized by the count of storms near players;
   watch frame lag, bandwidth and client frame time; storms fall back to tier 0 if workers fall
   behind.

## Order

| Step | Phases | Why first |
|---|---|---|
| 1 | A1-A2, B1, C1 | runtime, worker, frames and speed (**done 2026-11-05**) |
| 2 | C2 (**done**; option B done: the whole model as WebAssembly, 6-8x faster, STATUS rounds 14-15), NETWORK tests 1-2 (**done**: byte-exact; full frames 4.4x the client budget, so B2 cut-down frames are needed), A3-A4 | nest speed, the Studio HTTP binary test, scheduler and endpoint |
| 2b | A3, A4, B2 (**done 2026-11-05**) | scheduler, frame bundle endpoint, client frames |
| 3 | G1, G2 | cold pool recovery, then the one long nested check |
| 4 | H2 with D1 tier 1 (**done 2026-11-05**: cloudlab live mode, see STATUS) | first live engine view in the lab |
| 5 | E1-E4 | cards from frames (with the friend's art) |
| 6 | F1-F6 | gust and instantaneous winds, exposure damage, radar, debug views |
| 7 | D2-D4, E5 | squall lines, many storms, tornado placement |
| 8 | H3-H4 | main game, then live (H3 loop built 2026-11-05, debug boxes only; see STATUS "Main game live storms") |

Verification stays short: the 1 km command-line runs (about 20 min) for physics, the one nested
life only when the physics changes, and Studio checks in the foreground.
