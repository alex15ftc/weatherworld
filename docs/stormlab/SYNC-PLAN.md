# Syncing the storm lab with the main game (plan, 2026-10-25)

Goal: the lab's billboard renderers (storm cards, tornado cards, rain shafts, scud, dust, debris,
near rain, lightning, sky) draw the main game's storms. Every server shows the same weather from
the one engine (the MMO goal: one engine feeding all servers; ~50 engine miles a place at a fixed 12x
clock).

## Where the two sides stand

| | Main game | Lab |
|---|---|---|
| **Source** | Engine frames over HTTP every ~25 s (40 s lag) or a replay (`server/WeatherFeed.luau`, `server/GameFeed.js`) | Its own Luau sim (`stormlab/shared/Sim`), seeded once from an engine scenario export |
| **Per storm** | ~1.4 KB of *appearance* (`js/storms/StormAppearance.js`): km positions, radii, a 2-D dBZ grid | *Physical state*: W, Ru, a 65-level updraft profile + tilt, el, vmid/vlow, storm-relative winds, lowering, precipRate |
| **Air motion** | none (no wind field) | `World.windAt` (environment soundings + cold pool + analytic storm and tornado winds) |
| **Rain** | 2-D dBZ grid per storm | 3-D precipitation volume (`cw.vol`) |
| **Units** | ~0.62 stud/m across, 1 stud/m up; y south; ground height | 1 stud = 1 m; y north; flat ground |
| **Clock** | 12x | 1x by default (`timeScale`) |

The renderers read the lab's state through `ctx.cw`, `ctx.Config.toWorld` and `ctx:simTime()`. Those three are the seam where the game can plug in.

## Recommended approach: make the engine send the lab's state, and treat the lab as a client of a "storm frame v2"

The lab's storm winds, profiles and precipitation are *functions of a small state* (`Storm.windAt` is analytic). If the engine sends that state, every client can rebuild `windAt`, the cards and the shafts locally, and all servers agree, because the engine is the only thing that decides the weather. Only cosmetic detail (scud, dust, debris, near rain) is simulated per client, and that detail is driven by the shared wind field.

**Rejected alternative: run the lab sim on each game server, nudged toward the feed.** It works with no engine changes, but every server's storms would drift apart in their details, and each place pays the server cost of the sim. It is useful as a stop-gap (step 3b).

## Steps

1. **Define the contract (`docs/stormlab/FRAME-V2.md`).** Write down exactly what `ClientWorld` receives today, and adopt that as the frame:
   - storms (the `Storm.snapshot` fields: x, y, u, v, W, Ru, base, el, top, age, rot, vmid, vlow, lowX/lowY, ffd/rfd points, lowering, wallBase, precipRate, srU/srV, anvil and upper winds, seed);
   - profiles (wprof, tilt);
   - tornadoes (the Tornado snapshot: vc, rc, swirl, inflow, O, cloudBase, top/bend, stage, ef, seed, time);
   - env (soundings on the analysis grid), cold pool grid, precip volume (or a coarser rain-rate + hail grid), systems/segments, flashes (channel geometry), clock.

   Units are metres and seconds, x east, y north, from a stated origin.
2. **Put a source switch in the lab.** `ClientWorld` gets a `source` interface: `local` (today's remotes from the lab server) or `frames` (the v2 frames, interpolated like `shared/Weather/StormTrack`). The renderers don't change. Test it with a replay file, as the main game does.
3. **Engine side (`js/`):**
   - **a.** Add a `StormStateV2` export next to `StormAppearance`: map the engine's storm model to the lab's fields. Most exist there or can be derived; `scripts/export-lab-scenario.mjs` and `Storm.fromEngine` already do part of the mapping.
   - **b.** Until the engine has a 3-D precipitation and cold-pool model the lab accepts, send soundings plus the 2-D precip grid, and let the client run the lab's `Precip` and `ColdPool` locally from them. This is deterministic from the same inputs.
4. **Coordinates.** Renderers already go through `Config.toWorld`. Give the game a `toWorld` with ~0.62 stud/m across, 1 up and y flipped, plus the ground height (`groundStuds`). Then check sizes that are hard-coded in studs (card size floors, ranges such as `RANGE`, `MAX_RANGE` and `NEAR_MIN`) and scale them by the factor.
   - *Decision needed:* would the game rather draw weather at 1 stud = 1 m around the player (as the lab does) and scale only the map? It is simpler for the visuals.
5. **Clock.** Feed `ctx:simTime()` from the game's 12x clock (frame times). Motion that the renderers integrate per frame (scud, card motion) already uses sim time.
6. **One renderer tree.** Move `stormlab/client/Render`, `Tornado/` and the parts of `shared/Sim` the client needs (Storm, Vortex, Precip, Environment, ColdPool, Noise, Thermo, World.windAt) to `src/shared/StormRender` (or keep them in `stormlab` and map them into the game's project). Both projects load the same files, and the lab becomes a harness: its own sim, scenes, F4 tests.
7. **Retire the old game renderers** (`StormView`, `StormKit`, `TornadoArt`, `CloudVolume`, `StormMesh`) once the cards look right in the game place.

## First concrete tasks (small, in order)

1. Write `FRAME-V2.md` from `ClientWorld.luau` and the server's replication code: fields, units, rates.
2. Add the `source` switch to `ClientWorld` and record a lab session to a frames file (lab server → frames), then play it back with `source = frames`. This proves the contract without the engine.
3. Make `Config.toWorld` and the hard-coded stud constants in the renderers scale-aware.
4. Engine: `StormStateV2` export, starting with storms and tornadoes. Profiles, soundings, precip and the cold pool follow.

## Staged (2026-10-25)

Lab side, done:

- **The contract in code:** `shared/Sim/Frames.luau` (kinds, required fields, `Frames.check`, JSON-safe encoding with base64 buffers), documented in `FRAME-V2.md`.
  - The test `tools/stormlab/test_frames.luau` passes: the lab's own frames meet the contract, and buffers survive encoding byte for byte.
- **One send path:** every frame the server sends goes through `server/Publisher` (broadcast, the latest state for newcomers, recording).
- **Source switch:** `LabConfig.SOURCE.mode` (or the `StormLabSource` Workspace attribute) picks:
  - `sim`: the lab's simulation;
  - `replay`: `server/Relay` plays a recording;
  - `feed`: `server/Relay` polls an HTTP frame source, `GET url?after=seq` → `{v=2, seq, scenario?, frames}`, played `lag` s behind.
  - The clients are unchanged; a scenario event can carry the environment JSON.
- **F4:** a **record** button (frames to `ServerStorage.StormLabRecordings.<name>`) and a **replay last** button (switches a running server to the relay and back).

Decided 2026-10-26 (user):
- **Scale:** weather at Roblox's standard 1 stud = 0.28 m (about 3.57 studs per metre), the game's scale (was 0.3 until 2026-10-26).
- **Ground:** the ground is not flat, and the renderers must handle that.
- **Rain:** add a light rain frame.
- **Later:** shared folders and the engine side wait (the user is still editing).

Done for that:
- `LabConfig.SCALE` and the scale helpers, with every renderer converted (`SCALE-RULES.md`).
- `LabConfig.groundAt` (the lab's Terrain hills round the town, built by `server/Terrain`).
- `precipLite`.

Still to do for the port:

- The relay converts the engine's km into the lab frame (metres from the place's origin), and the game's terrain replaces `LabConfig.groundAt`.
- **The engine's `StormStateV2` frames**, served as the `feed` JSON.
- **Moving the renderer tree** to where the game place can load it.
