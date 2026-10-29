# Storm frames v2: the weather contract for the billboard renderers

The renderers (`roblox/src/stormlab/client/Render/*`) draw whatever arrives as **storm frames**. The lab's own simulation is one producer. A recording, the engine, or the main game's server are others. Code: `shared/Sim/Frames.luau` (kinds, required fields, encoding, `Frames.check`). Test: `tools/stormlab/test_frames.luau`.

## Frames

| Kind | Arguments | Lab rate | Client applies with |
|---|---|---|---|
| `state` | snapshot, settings? | ~2 Hz | `ClientWorld.applySnapshot` |
| `profiles` | `{ {id, version, wprof, tiltX, tiltY} }` | when a storm's profile changes | `ClientWorld.applyProfiles` |
| `tornado` | `{ tornado snapshot }`, time | ~15 Hz (unreliable remote) | `ClientWorld.applyTornadoes` |
| `coldPool` | buffer (`World.packColdPool`: per analysis cell, deficit 0.01 K u16, outflow u/v 0.25 m/s i8, edge u8) | ~10 s | `ClientWorld.applyColdPool` |
| `precipLite` | buffer (`Precip.packLite`: 9 bytes per column with echo, holding surface rain, hail size, peak dBZ, echo top and hail share; ~12 KB for 4 storms) | ~10 s | `ClientWorld.applyPrecipLite` |
| `precip` | buffer (`Precip.pack`: the full 3-D volume plus the 500 m fine field; ~235 KB) | optional, ~60 s (`RATES.precipFullEvery`; 0 = never) | `ClientWorld.applyPrecip` |
| `flash` | `{ flash }` (channel geometry, kind, stormId) | as they happen | `ctx.signals.flash` |
| `event` | `{ kind = ... }`: `scenario` (+ `data`, the environment JSON, when the client lacks it), `tornado`, `damage`, `town`, `recording`, ... | as they happen | `ctx.signals.event` |

On the wire, a frame is `{ k = kind, t = sim time (s), a = { arguments }, n = #arguments }`. Buffers travel as `{ b64 = "..." }`, so a frame is plain JSON (`Frames.encode` / `Frames.decode`).

## Units and frame of reference

- Metres and seconds. x east, y north, z up (height above the ground).
- The origin is the scenario window's centre (the lab), or whatever origin the producer states. **The producer converts into this frame.** For example, the main game converts the engine's km (y south, from the map's north-west corner) to metres from the place's origin.
- The renderers draw at `LabConfig.SCALE` studs per metre (1 / 0.28, about 3.57: Roblox's standard 1 stud = 0.28 m and the game's scale; the same on every axis) through `LabConfig.toWorld` (X east, Y up, Z south). See `SCALE-RULES.md`.
- Heights in frames are above the datum (cloud bases, tops), except the tornado's own heights, which are above the ground. The renderers place ground-attached things with `LabConfig.groundAt`, and a game replaces that with its terrain.
- Clock: `state.time` is sim seconds and `state.clockUtc` is the UTC hour. Clients interpolate between frames with the time scale in `settings`.

## Required fields (`Frames.STORM_FIELDS`, `TORNADO_FIELDS`, `PROFILE_FIELDS`)

- **Storm** (live storms):
  - `id, x, y, u, v, age, seed`
  - `W` (updraft m/s), `Ru` (updraft radius m)
  - `base, el, top` (m)
  - `rot` (0..1), `vmid, vlow` (rotation m/s)
  - `lowX, lowY` (low-level mesocyclone), `ffdX, ffdY, rfdX, rfdY`
  - `lowering, wallBase` (m)
  - `precipRate` (kg/s)
  - `srU, srV` (storm-relative low-level wind)
  - `anvilLen, anvilU, anvilV, upperU, upperV`
  - `profVersion`

  `Storm.snapshot` sends more; the radar, map and labels use some of the extra fields.
- **Profile:** `id, version, wprof` (65 normalised levels), `tiltX, tiltY`. `Storm.windAt` and the card layout need it.
- **Tornado** (live): `id, parentId, x, y, ut, vt, envU, envV, vc, rc, swirl, inflow, cloudBase, topX, topY, bendX, bendY, wave, seed, time, O, decay, stage, ef, peakWind, hold, debrisLoft, debrisTop`. Optional `orbit` (rad): the sub-vortices' integrated orbit angle (Vortex uses it over `sOrbit x time`, which jumped whenever vc or rc changed).
- **State:** `time, clockUtc, storms, systems` (`{systems, vortices, fronts}`), `boundaries`.

The client rebuilds the wind (`World.windAt`) from the environment soundings, the cold pool, the storms with their profiles, and the tornadoes. Because nothing else is needed, every client sees the same air motion from the same frames.

## Sources (`LabConfig.SOURCE`; Workspace attributes `StormLabSource`, `StormLabRecording`)

- `sim`: the lab simulates; `server/Publisher` sends its frames.
- `replay`: `server/Relay` plays a recording. Recordings are made with the F4 **record** button, and stored in `ServerStorage.StormLabRecordings.<name>` as JSON lines in StringValues. A recording can also be saved as a ModuleScript under `Data/Recordings`. F4 **replay last** switches a running server to its last recording and back.
- `feed`: `server/Relay` polls `GET <url>?after=<seq>`, which returns `{ v = 2, seq, scenario?, frames = { frame } }`, and plays frames `lag` s behind the newest. This is the main game's path, and it already exists on the lab server.

Every source goes through the same Publisher and remotes, so the clients can't tell them apart.

The renderers only read surface rain and hail, which `precipLite` carries exactly. The client rebuilds an approximate reflectivity profile from it (on average within ~4 dB of the full volume at 1.5 km in heavy rain), so the map and radar still work. When a full volume arrives, the radar prefers it (`cw.volFull`). A producer can send `precipLite` alone.

## Sizes (lab Supercell, 4 storms)

- `precipLite` is ~12 KB every 10 s.
- The full `precip` is ~235 KB (~315 KB as base64), so it is optional.
- `state` is a few KB; `tornado` is under 1 KB per tornado.

## To port a producer (engine / main game)

1. Emit the frames above in this frame of reference, starting with `event:scenario` (with `data` if the client has no module), `profiles`, `state`, `coldPool` and `precip`.
2. Validate with `Frames.check` (`tools/stormlab/test_frames.luau` shows how).
3. Serve them as the `feed` JSON, or relay them through `server/Publisher` from a game server.
