# Storm lab: architecture and interfaces

The storm lab (`roblox/src/stormlab`, Rojo project `roblox/stormlab.project.json`) rebuilds the tornado lab from scratch around the guide *Building a Maximum-Realism Tornado in Roblox* (both parts: the tornado, and thunderstorms / supercells / squall lines). One shared, physically informed simulation drives every visual, the radar, the damage and the debris. Nothing is painted or keyed on storm-type labels.

The weather engine (the Node.js server in this repo) supplies the starting state: `scripts/export-lab-scenario.mjs` dumps a 15×15-cell window (16 km cells, about 240 km square) of the engine's own soundings, surface fields, boundaries and storms around one storm at one moment, plus what the engine then did with that storm (`track`, for comparison).

```
node scripts/export-lab-scenario.mjs --seed 8181 --days 2 --name Supercell
node scripts/export-lab-scenario.mjs --seed 2112 --days 3 --focus line --name SquallLine
```

## Layout

| Path (under `roblox/src/stormlab`) | In the place | What |
|---|---|---|
| `shared/Sim/*.luau` | `ReplicatedStorage.StormLab.Sim` | Pure simulation (no Roblox APIs). Runs in Roblox and in the plain Luau CLI. |
| `shared/LabConfig.luau` | `ReplicatedStorage.StormLab.LabConfig` | Coordinates, remotes, asset ids, draw limits. |
| `data/*.luau` | `ReplicatedStorage.StormLab.Data` | Engine scenarios (JSON text). |
| `server/` | `ServerScriptService.StormLab` | Authoritative world, replication, town damage, vehicles, debris. |
| `client/` | `StarterPlayerScripts.StormLab` | `init.client.luau`, `Context`, `Net`, `CameraRig`, `Panel`, and renderers in `Render/` and `UI/`. |
| `../shared/Weather/CloudKit` | `ReplicatedStorage.Shared.Weather.CloudKit` | The uploaded cloud-kit mesh pieces (reused, not rewritten). |

## Units and coordinates

- 1 stud = 1 m.
- **Simulation frame:** x east, y north, z up. Metres from the scenario window's centre (lab origin).
- **Roblox frame:** X east, Y up, Z south.
- Always convert with `LabConfig.toWorld(x, y, z) -> Vector3(x, z, -y)` and `LabConfig.fromWorld(v)`. For a horizontal sim vector (u east, v north) use `LabConfig.dirWorld(u, v)`.
- Winds: u east, v north, w up (m/s).
- Time: simulation seconds since the scenario started (`ctx:simTime()`).

## The simulation (shared/Sim)

| Module | Guide section | Role |
|---|---|---|
| `Thermo` | 10 | Parcel CAPE/CIN/LCL/LFC/EL (SB/ML/MU), shear, Bunkers motion, SRH, PW, lapse rates, downdraft-parcel deficit. Matches the engine's own numbers to ~1-3%. |
| `Environment` | 10 | Engine soundings on a 0-16 km/250 m grid, blended horizontally. Surface T/Td advected and heated, anvil shade, cold pool folded into the low levels, analyses on an 8 km grid. |
| `ColdPool` | 12B | Deficit field D (2 km grid) fed by rain-driven downdrafts and melting. Spreads as a density current (c = 0.75√(g′h)) plus momentum surges. Its contours are the gust fronts. |
| `Precip` | 11C | Lagrangian hydrometeor parcels (rain, graupel/hail, anvil ice), carried by the 3-D wind. They fall, evaporate, melt and sublimate. Binned to a 1 km voxel volume of dBZ and hail share; surface rain rate and hail grids. |
| `Storm` | 11, 13 | One convective cell. Updraft from the inflow parcel; mesocyclones from storm-relative helicity, baroclinity and boundaries; FFD/RFD; occlusion cycles; wall cloud from rain-moistened inflow; anvil; precipitation release; splitting; Bunkers-type deviant motion from rotation; tornado genesis potential. |
| `Systems` | 12 | Squall lines and bows as systems: leading-edge segments with cold-pool / shear balance (RKW), rear-inflow jet descent → bowing, mesovortices and bookend vortices (the QLCS tornado pathway). |
| `Initiation` | 12C, 13 | New cells where lift (convergence, gust fronts) beats CIN. Rates scale with lift strength. |
| `Boundaries` | 13 | Fronts, drylines and outflow boundaries detected from the fields, with persistent identity. |
| `Tornado` | 6, 7 | Lifecycle fed by the parent's low-level circulation: organisation, contraction, pulses, swirl regimes, left-turning track during occlusion, rope-out, dissipation. Debris lofting for radar. |
| `Vortex` | 1, 2, 7 | The tornado's 3-D wind field. Wood–White profile; streamfunction inflow and updraft (mass-conserving; one- and two-celled); jet; sub-vortices; turbulence; curved, tilted axis with travelling waves; translation; pressure deficit → condensation-funnel radius. ~1.2 µs/sample. |
| `Debris` | 4 | Drag on the relative wind (exact quadratic relaxation), plate lift, tumbling, ground contact. Classes from fine (leaves) to heavy (cars). |
| `Damage` | 5 | EF degree-of-damage components with drawn failure speeds, accumulation over time, breach → internal pressure, staged structures. |
| `Lightning` | 15 | Flash rates from updraft volume (Deierling & Petersen 2008), IC/CG/+CG placement, seeded branching channels, thunder at 343 m/s. |
| `Radar` | 16 | Reflectivity / radial velocity / correlation coefficient sampled from the same fields. Beam height, beam-width smoothing, clear-air fine lines, tornado debris signature, aliasing. |
| `World` | 8, 17 | Composes everything. `windAt(x, y, z [, noTornado])` sums environment + cold pool + storms + vortices + tornadoes; `stepFast` (tornadoes) and `stepSlow` (the rest, cooperative yields); snapshots. |
| `ClientWorld` | 8 | The client mirror: the same `windAt` evaluated from snapshots. |

Offline checks (plain Luau, no Studio), run from the repo root:

```
luau tools/stormlab/test_env.luau
luau tools/stormlab/test_vortex.luau
luau --codegen tools/stormlab/test_world.luau -a Supercell 90
luau --codegen tools/stormlab/test_world.luau -a SquallLine 120
luau --codegen tools/stormlab/test_client.luau
```

## Replication (server → client)

| Remote (`ReplicatedStorage.StormLabNet`) | Rate | Payload |
|---|---|---|
| `State` | 2 Hz | `World.snapshot()`: `{ time, clockUtc, storms = { Storm.snapshot }, systems = Systems.snapshot, boundaries, parcels }`, then `settings` `{ timeScale, paused, genesis, initiation }`. |
| `Profiles` | on change | `{ { id, version, wprof, tiltX, tiltY } }`: each storm's 65-level (0-16 km, 250 m) normalised updraft profile and tilt (m). |
| `Tornado` (unreliable) | 15 Hz | `{ Tornado.snapshot }, time`. |
| `ColdPool` | ~10 s | A buffer, unpacked into `cw.coldPool.D / VU / VV / EDGE` (2 km grids). |
| `Precip` | ~10 s | A buffer → `cw.vol`. `vol:sample(x, y, z) -> dBZ (-999 = none), hailShare`; `Precip.surface(cw.vol, x, y) -> rain mm/h, hail cm`. |
| `Flash` | as they happen | `{ { t, kind = "ic" \| "cg" \| "+cg", x0, y0, z0, x1, y1, z1, seed, current, stormId } }`. |
| `Event` | as they happen | `{ kind = "tornado" \| "initiation" \| "merge" \| "damage" \| "debris" \| "rest" \| "scenario", ... }`. |
| `Command` (client → server) | — | `{ cmd = "timeScale" \| "pause" \| "scenario" \| "forceTornado" \| "townHere" \| ..., ... }`. |

### Storm snapshot fields (`Storm.snapshot`)

| Field | Meaning |
|---|---|
| `id`, `kind`, `seed`, `age` (s) | Identity. |
| `x`, `y` | Updraft base centre (m). |
| `u`, `v` | Motion (m/s). |
| `W` | Peak updraft (m/s). |
| `Ru` | Updraft e-folding radius (m). Use `Storm.updraftRadiusAt(s, z)`. |
| `base` | Cloud base / LCL of the inflow (m). |
| `el` | Equilibrium level (m). |
| `top` | Cloud top including the overshoot (m). |
| `freezing` | 0 °C level (m). |
| `vmid`, `vlow` | Mid- and low-level rotational velocity (m/s; negative only if a left mover is anticyclonic). |
| `rot` | 0..1, how supercellular. |
| `occl`, `cycle`, `lowAngle` | Occlusion progress, cycle count, low-meso bearing. |
| `lowX`, `lowY` | Low-level mesocyclone centre (the wall cloud and tornado sit here). |
| `ffdX`, `ffdY`, `ffd` | Forward-flank downdraft centre (the main rain core) and its strength (m/s). |
| `rfdX`, `rfdY`, `rfd`, `rfdDeficit` | Rear-flank downdraft centre (the hook / clear slot), strength (m/s) and cold-pool deficit under it (K). |
| `lowering`, `wallBase` | Wall-cloud lowering (m) and wall-cloud base height (m). |
| `anvilLen`, `anvilU`, `anvilV` | Anvil length (m) and unit direction (east, north). |
| `upperU`, `upperV` | Anvil-level wind (m/s). |
| `precipRate`, `efficiency` | Precipitation production (kg/s) and precipitation efficiency. |
| `hailMax` | Largest hail (cm). |
| `lightning` | Flash rate (flashes/min). |
| `G` | Tornado genesis potential (0..1+; > ~0.5 shows a rotating dust whirl / organising lowering). |
| `tornado` | Tornado id or nil. |
| `cape`, `cin`, `srh01`, `srh03`, `shear06`, `lcl`, `rkw` | Inflow environment. `rkw` is the cold-pool / shear ratio. |
| `loading`, `surfaceBased`, `systemId` | Precipitation loading, surface-based flag, the line system it rides (or nil). |
| `dead`, `deadFor`, `leftMover` | `dead` storms keep decaying anvils and rain. |
| `wprof`, `tiltX`, `tiltY` | Attached by ClientWorld from `Profiles`. |

Helpers: `Storm.updraftAt(s, x, y, z)` (w m/s), `Storm.wprofAt(s, z) -> f, tiltX, tiltY`, `Storm.heading(s)`.

### Tornado snapshot fields (`Tornado.snapshot`)

| Field | Meaning |
|---|---|
| `id`, `parentId` | Identity. |
| `x`, `y` | Ground contact. |
| `ut`, `vt` | Translation (m/s). |
| `vc` | Vortex-relative peak tangential wind (m/s). |
| `rc` | Core radius at 10 m (m). |
| `swirl` | Swirl ratio S: 0.1 rope … 2 wide multi-vortex. |
| `cloudBase` | Cloud base at the tornado (m; the wall-cloud base). |
| `topX`, `topY`, `bendX`, `bendY`, `wave` | Axis shape. Use `Vortex.axisAt(t, z)`. |
| `seed`, `time` | Deterministic phases. |
| `age`, `O` | Age and organisation (0..1). |
| `decay` | 0..1 dissipation. |
| `stage` | Text: organizing / mature / mature (multi-vortex) / shrinking / rope / dissipating / ended. |
| `ef`, `peakEf`, `peakWind` | Ground-relative 10 m peak (m/s). |
| `funnelGround` | Condensation radius at 5 m; 0 = the funnel doesn't reach the ground. |
| `debrisLoft`, `debrisTop` | Lofted debris (0..1) and debris-cloud top (m). |
| `ended`, `endedFor` | End-of-life flags. |
| `params` | Attached by ClientWorld: `Vortex.params(t)`. Use with `Vortex.sample(params, x, y, z)`, `Vortex.condensationRadius(t, z)`, `Vortex.subvortices(params, z)`, `Vortex.rcAt(params, z)`. |

### Systems snapshot (`cw.systemsSnap`)

- `systems`: `{ id, mode = "squall line" | "bow echo" | "line segment", length, age, bow, segments = { {x, y, nx, ny, c, du, rij, bow, active, deficit} } }`. `(nx, ny)` is the outward (forward) normal of the leading edge.
- `fronts`: every gust-front contour, as lists of `{x, y, nx, ny, c, deficit}`.
- `vortices`: `{ id, kind = "mesovortex" | "bookend", x, y, vlow, rlow, cyclonic, dead, G }`.

## The client renderer contract

Every ModuleScript in `client/Render/` and `client/UI/` is started automatically by `client/init.client.luau`:

```lua
local M = {}
function M.new(ctx) -- ctx: client/Context.luau
	local self = {}
	-- build instances under ctx.root (3-D, client-only) or ctx.ui (ScreenGui)
	function self:update(dt) end -- every RenderStepped; keep it cheap, time-slice heavy work
	function self:destroy() end
	return self
end
return M
```

- Read state from `ctx.cw` (and the signals). Respect `ctx.state.show.<layer>` toggles.
- Never write to ClientWorld state.
- Use `ctx.Sim.<Module>` for the pure modules.
- A module that errors five times in `update` is switched off, so test defensively.

## Roblox rendering constraints (measured in this project)

- **Particles** are not drawn beyond about 800 studs from the camera (they fade from 700 to 850). Use particles only for near detail.
- **Parts and meshes** are not drawn beyond about 7000 studs. Draw far objects as copies scaled toward the camera. For a point P at distance d > D (`LabConfig.LIMITS.farDraw`): draw position = cam + (P − cam)·(D/d), size × D/d. That gives the same angular size and direction; apply the true-distance haze yourself by blending the colour toward the sky/haze colour. Per-piece scaling changes the depth order between pieces, which is acceptable for clouds. Keep anything near the tornado at true scale.
- **Max part size** is 2048 studs per axis.
- **EditableMesh:** the memory budget is tiny (about 6 small meshes per client). Pool and reuse meshes; never destroy and rebuild. Share one mesh between many MeshParts where possible. Any vertex alpha < 1 puts the mesh in the transparent pass with no self depth-sort.
- **Textured Beams near the camera** did not render in Studio 0.744. Use camera-facing Parts with Textures (scroll `OffsetStudsV`, decreasing for downward motion).
- **Overlapping particle layers of different colours flicker** (draw-order swaps). Give each overlapping layer one flat colour, and take shading from something that doesn't reorder.
- **Cloud-kit parts:** keep them under the camera (`ctx.root`), not in Workspace (their physics cost dropped the lab to 15 fps). Transparency looks glassy; prefer opaque pieces with haze by colour or distance scale.
- **Uploaded textures:** use only the ids in `LabConfig.TEXTURES`. Nothing new is uploaded without the user's approval.
- **Performance target:** 60 fps on a laptop, playable on mobile. Budget about 2 ms/frame per renderer; pool instances; batch moves with `workspace:BulkMoveTo`.

## Lighting ownership and debug attributes

- `Render/Sky` is the only writer of `Lighting` and `Lighting.Atmosphere`. `Render/NearPrecip` publishes `PrecipExtinction` and `PrecipDust` on `ctx.root`, and Sky folds them into the Density.
- Each renderer has its own ColorCorrection: `StormLabSky` and `StormLabLightning`.
- **Debug attributes on `ctx.root`:** `SkyDirect`, `SkyDiffuse`, `LastThunderIn`, `LastThunderDistance`, `ThunderPending`, `CloudParts`, `CloudShafts`, `CloudMs`, `DustPuffs`, `DebrisPieces`.
- **On Workspace (server):** `StormLabFrameMs`, `StormLabSimTime`, `StormLabParcels`.
- **Array format:** boundary points, gust-front points and system segments are positional arrays (`{x, y, ...}`), not `{x=, y=}` tables.

## Ownership

| Area | Files |
|---|---|
| Core | `client/init.client.luau`, `Context`, `Net`, `CameraRig`, `Panel`; `server/*`; `Render/Funnel`, `Render/TornadoDust`, `Render/DebrisView`, `Render/WindViz`, `Render/Ground` |
| Storm clouds | `Render/Clouds.luau` (+ `Render/CloudParts/*` if needed): towers, overshooting tops, anvils, bases, wall clouds, shelf clouds, mammatus, scud, distant rain shafts |
| Radar and map | `UI/Radar.luau`, `UI/Map.luau` |
| Atmosphere effects | `Render/NearPrecip.luau` (rain/hail near the camera, splashes, visibility), `Render/Lightning.luau` (bolts, flashes, thunder), `Render/Sky.luau` (lighting under storms) |

## Type-checking Roblox code

luau-lsp with the Roblox definitions and a Rojo sourcemap, run from `roblox/`:

```
rojo sourcemap stormlab.project.json -o sourcemap.stormlab.json
luau-lsp analyze --sourcemap=sourcemap.stormlab.json --definitions=globalTypes.d.luau src/stormlab
```
