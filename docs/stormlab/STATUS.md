# Storm lab: status (2026-10-24)

The TornadoLab place has been rebuilt from scratch around `GUIDE-maximum-realism.md`, covering both of its parts. `roblox/tornadolab.project.json` now serves the new lab. The previous lab is kept unchanged as `roblox/tornadolab-old.project.json` (copy it back over `tornadolab.project.json` to restore). Interfaces are in `ARCHITECTURE.md`.

## Guide coverage

| Guide section | Where |
|---|---|
| 1-2 Wind field: Rankine/Wood–White, inflow, updraft, translation, tilt/curved axis, sub-vortices, temporal variability | `Sim/Vortex` |
| 3 Funnel: ring mesh r(z,θ,t), layered shells, condensation from pressure deficit, morphologies from swirl | `Sim/Vortex`, `client/Render/Funnel` |
| 3-4 Ground dust / debris cloud | `client/Render/TornadoDust` |
| 4 Debris: drag on relative wind, classes, inertia, tumbling | `Sim/Debris`, `server/ServerDebris`, `client/Render/DebrisView` |
| 5 Damage: q = ½ρV², component resistances (EF DOD), accumulation, staged destruction; vehicles | `Sim/Damage`, `server/Town`, `server/Vehicles` |
| 6 Lifecycle: genesis potential, organisation, pulses, occlusion, rope-out, dissipation | `Sim/Storm`, `Sim/Tornado` |
| 7 Sub-vortices as real wind maxima | `Sim/Vortex` |
| 8 Server-authoritative state, client rendering, compact replication, interpolation, deterministic seeds, LOD | `server/init`, `client/*`, `Sim/ClientWorld` |
| 9 Stage-1 wind vectors | `client/Render/WindViz` (J) |
| 10 Environment from engine soundings (CAPE, CIN, LCL, shear, SRH, PW…) | `Sim/Thermo`, `Sim/Environment`, `scripts/export-lab-scenario.mjs` |
| 11 Supercells: updraft, mesocyclones, FFD/RFD, wall cloud, precipitation field, classic/HP/LP | `Sim/Storm`, `Sim/Precip`, `Sim/ColdPool` |
| 12 Squall lines: gust front from the cold pool, c ≈ √(g′h), RKW balance, rear-inflow jet, bows, mesovortices, bookends | `Sim/Systems`, `Sim/ColdPool`, `Sim/Initiation` |
| 13 Boundaries and interactions: detection, mergers, splits, outflow undercutting | `Sim/Boundaries`, `Sim/World` |
| 14 Cloud rendering: cloud-kit pieces placed from the fields; anvil from upper winds; shelf clouds; rain shafts | `client/Render/Clouds` (+ `CloudParts/`) |
| 15 Lightning, thunder, rain, hail, visibility, lighting | `Sim/Lightning`, `client/Render/Lightning`, `NearPrecip`, `Sky` |
| 16 Radar: reflectivity, radial velocity, correlation coefficient (with debris signature) | `Sim/Radar`, `client/UI/Radar` (R), `client/UI/Map` (M) |

## Verified

**Offline** (plain Luau, `tools/stormlab/*.luau`):
- **Thermodynamics** agrees with the engine's own diagnostics to ~1-3% (CAPE, LCL, SRH, shear, PW).
- **Vortex:**
  - Exact mass conservation for a straight axis.
  - Peak at the core radius.
  - One- and two-celled regimes.
  - Central deficit 2.06 ρ vc².
  - A weak vortex shows a funnel aloft only.
  - About 1.2 µs per sample.
- **Supercell scenario (seed 8181):**
  - The focus storm reaches a 46 m/s updraft and a 25-28 m/s mid-level mesocyclone, with low-level rotation cycling through occlusions.
  - A tornado forms 43-52 simulated minutes in, as an EF3-EF4, and lives about 15-45 minutes. The engine's tornado came at 60 min, at 141-209 mph.
- **Squall-line scenario (seed 2112):**
  - The cold pool holds 5-7 K.
  - Cells form continuously along the gust front, and the discrete supercell ahead of the line is undercut and dies, as in the engine.
  - No mesovortices form: line-normal shear is weak here, and the engine had no QLCS tornado either.
- **Client mirror** reproduces the server's wind to within 0.05 m/s.

**In Studio** (one playtest, 2026-10-24):
- The server spins up 600 s in 2.3-4.8 s and builds a 189-structure town with 10 vehicles.
- The client starts 13 modules with no runtime errors.
- Tornado T01 formed from C001 at t = 3137 s, peaked at EF3 and roped out after a 10.8 km path. 93 debris pieces and dust were flying.
- The server costs 4-9 ms/frame at 60x.

## Known gaps and next steps

1. **Cloud look:** it is crude. Towers are stacked puffs, the anvil underside is too white and glacier-like, and bases are thin dark discs. Next: shading of undersides, darker storm light, tower proportions. All renderer code lives in `client/Render/Clouds` and `CloudParts/`.
2. **Sky darkening:** the scene doesn't darken much under the anvil yet (`client/Render/Sky`).
3. **Not yet seen up close in Studio:** (funnel and dust now seen; see the Studio pass below) radar, map, rain, hail, lightning and damage. Each is type-checked, and the radar and map were tested headlessly.
4. **Thunder and rain sounds:** they need approved sound ids in `LabConfig.SOUNDS` (silent until then).
5. **Rain rates:** surface rates peak at ~25-55 mm/h, low for supercell cores. Precipitation parcels are coarse (~1.5e5 kg each).
6. **Initiation:** the rates are tuned by eye. The supercell day grows from 4 storms to ~10-18 in an hour.
7. **QLCS tornadoes:** this pathway is built but untriggered in the exported line case. Export a line scenario with stronger line-normal shear to exercise it.
8. **Server cost:** spikes up to ~30 ms on some frames at high time scales (the cold-pool advection and environment step don't yield inside).

## Tornado visual plan: Studio pass (2026-10-24)

Seen in Studio (F4 panel, scenes 2 and 3 run): scenes build in 2-4 s with no errors, and the client runs at ~17-19 ms/frame with one tornado at LOD0 (meshes ~2.7 ms). Fixes from this pass:

- **Funnel invisible by day:** the shells used a lit material whose up-pointing normals mirrored the bright sky. They are now always self-lit (Neon), with the scene light compensated.
- **Rain obscuration counted twice:** it both cut opacity by up to 88% and blended colour toward rain grey, so the sky showed through a condensed funnel. Now it is mostly the colour blend (opacity × 0.6-1.0).
- **Wedge at 1.5 km drawn as a sprite:** heavy rain dropped it a LOD level. That now applies only past 3 km.
- **Cloud deck hung ~230 m below the storm's cloud base** (`CloudParts/StormPlan` base piece). Its underside now sits at the base, with lumps ~0.1 thick below.
- **Dust:** lighter (it scatters sky light), max opacity 0.55. Non-rain scenes have `rearShare 0.05` so the camera isn't standing in the hook's rain.
- **Debug:** the LOD readout shows R, rc, fade, and per-ring condensation/alpha. The counters show rain at the camera and the camera position.

Open:
- Scenes 1, 4-10 (rope, uncondensed, multi-vortex, night + flashes, LOD dolly) are not yet captured in Studio after these fixes.
- In Studio the wedge scene read R 113 m / wedge 0.25, while offline gives R 539 m / wedge 1.0. Check what the client mirror's snapshot carries for `rc` and the condensation fields.
- Roblox reserves the keys `1` and `Shift+1`: use the panel buttons or the keypad.

## Funnel and performance pass (2026-10-24, later)

**Why funnels looked short and wide at the bottom:** the cloud renderer's far-draw pulled oversize pieces toward the camera to fit Roblox's 2048-stud part limit. A 14 km storm base was drawn ~600 m from the camera at 175-267 m height, in front of a tornado 1.6 km away, hiding everything above ~9°. Fixes (`CloudParts/Util`, `Clouds`):
- Oversize pieces are pulled in no nearer than `Util.NEAR_MIN` (2.5 km). Nearer ones keep their place and get a capped footprint (`Util.capSize`).
- Near pieces are split first (nearest-first order, their own budget `SPLIT_CAP` 90, depth 6).
- `CloudCapped` attribute = what still gets capped (debug).

**Funnel:**
- The core is drawn as the condensed tube (condensation radius) with optical-depth opacity, instead of the full envelope with opacity from the condensed share. Narrow condensed tubes used to be invisible.
- `Vortex.deficit` / `condensationRadius` no longer zero the deficit in the bottom metres. Stovepipe and LOD scenes now condense to the ground; the cone reaches ~100 m.

**Scenes:** labels renumbered to match their keys (3 = stovepipe, 4 = wedge, ... 0 = night burst, - = LOD). The earlier "wedge R mismatch" was key 3 running the stovepipe.

**Performance** (stovepipe/cone scene, LOD0, Studio; F4 counters now show per-module ms as `ClientModuleMs`):

| Module | Before | After |
|---|---|---|
| Clouds | 2.8 ms | 1.5 ms |
| DebrisView | 1.9 ms | 0.9 ms |
| TornadoVisuals | ~2.7 ms | ~2.5 ms |
| All lab scripts | 9.6 ms | 7.5-7.8 ms |

- Clouds: unmoved pieces are no longer re-sent to the engine.
- Debris: resting pieces check the wind every 4th frame and aren't re-moved.
- Tornado shells: azimuth-only work per column, no per-vertex allocations.
- Dust: size/fade/colour on alternate frames.
- `--!native` on the hot client modules.

The ~30 ms Studio frame is mostly the engine plus the in-process server, not lab scripts.

**Still open:**
- The cloud base overhead is ragged, with bright tower sides through gaps (a near base piece still capped at ~5 km).
- Multi-vortex: no visible funnel or sub-vortex tubes (condenses only above ~200 m).
- Night flash reveal not verified on screen (flashes end before a capture lands).
- Rope (1), uncondensed (5) and LOD dolly (-) not captured this pass.
- Dust is ~2 ms at ~270 puffs.
