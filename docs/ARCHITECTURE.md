# Architecture

## Layers

| Layer | File | Grid | Step |
|---|---|---|---|
| Large-scale model | `js/atmosphere/QuasiGeostrophicModel.js` | 128 x 64 at 80 km, wraps east-west and north-south | 5 min |
| Regional layer | `js/atmosphere/RegionalAtmosphere.js` | 50 x 50 at 10 miles (16 km) | 30 min |
| Line analysis | `js/atmosphere/BoundaryAnalysis.js` | regional grid | each regional step |
| Storms | `js/storms/` | objects with their own small fields | 5 min |
| World | `js/world/AtmosphereWorld.js` | couples the above; save and restore | - |
| Region steering | `js/world/RegionSteering.js` | plans once a day at 06Z | - |

### Large-scale model

Two layers (about 250 and 750 mb) with a prescribed mean wind in each. Potential vorticity is
advected with an Arakawa Jacobian and inverted by a Fourier transform east-west and a cyclic
tridiagonal solve north-south; third-order Adams-Bashforth in time. Thermal relaxation,
surface drag that grows with wind speed, and biharmonic damping keep it bounded. Settings
are in `QG_DEFAULTS`.

### Regional layer

Reads the large-scale model at its own position and adds what that model cannot hold:

- terrain rising from 300 m in the east to 1,500 m in the west, and the mountains' blocking
  of the low-level westerly flow;
- air carried by the wind (semi-Lagrangian): air-mass temperature, moist-layer mixing ratio,
  elevated mixed-layer air, cold pools;
- a mixed boundary layer with daily heating, the dryline by mixing, the night-time jet by
  inertial oscillation, the lee trough and the thermal low;
- Gulf moisture that is scoured by northerly flow and recovers;
- density currents (cold air pushing under warm).

It writes every cell's surface values, the 850/700/500/250 mb levels and `features`.
Settings are in `REGIONAL_DEFAULTS`.

### Storms

| File | Does |
|---|---|
| `InitiationEngine.js` | where storms start: lift (surface convergence, ascent aloft, upslope, heating) against inhibition |
| `environmentSampling.js` | the air a storm is in; storm motion from the winds |
| `StormEnvironmentCoupling.js` | the inflow a storm draws on, upstream of its own outflow |
| `StormRealizationPhysics.js` | updraught speed from parcel theory less entrainment, loading and inhibition |
| `StormBudgets.js` | the storm's three linked budgets: updraught, rain, cold pool; strength and organization follow from them |
| `StormEngine.js` | each storm's step: budgets, hail, gusts, splits, mergers |
| `StormModeEngine.js` | rotating and line shares; the type name (a description only) |
| `StormRotation.js` | mid-level rotation, low-level rotation and occlusion, from the storm's state and its inflow |
| `TornadoEngine.js` | the tornado: forms from low-level rotation, lasts while the storm holds it, wind follows it |
| `StormGeometry.js` | where the storm's parts are (updraught, wall cloud, rain and hail cores, gust front, anvil, tornado): one description for the radar and the game's 3D object |
| `StormStructureEngine.js`, `StormInternalField.js` | where a storm's rotation and its line's cores are, and its inner fields, built from the storm's state and geometry |
| `js/radar/PrecipitationField.js` | where a storm's rain, snow, hail and debris are, at ten heights: precipitation of several sizes followed from each updraught through the storm-relative wind and the mesocyclone as it falls, sticks together, melts and evaporates. The forward flank, hook, overhang, anvil and a line's rain shield are where the wind puts them |
| `js/radar/RadarSimulator.js` | what each radar measures of that through its beam (reflectivity, velocity, dual-pol), and the network mosaic of composite reflectivity |

`AtmosphereWorld.prepare()` gives the storms what they read: soundings, convergence lift,
ascent from 500 mb height falls, and the mesoscale diagnoses in
`js/diagnostics/forcingDiagnosis.js` and `js/mesoscale/MesoscaleFieldEngine.js`.
`withStormEffects()` puts each storm's rain-cooled air into the regional layer as a cold pool.

### Region steering

The region's own state stays on the map. `RegionalAtmosphere.origin.x` (where it reads the
large-scale model) slides at `slideMs`. Once a day `RegionSteering` copies the large-scale
model, runs the copy to 21Z and 02Z, and picks the slide speed (within the systems' own
speed either way) that brings the wanted large-scale support over the region. Support is
wind aloft times southerly low-level flow, 0 to 1, negative behind a trough. Settings are in
`STEERING_DEFAULTS`; `steering: false` keeps the region fixed.

## Server

`server/index.js` (routes), `server/WeatherAuthorityRuntime.js` (the one world, its clock and
its saved state), `server/SurfaceAnalysisRuntime.js` (the surface page's analysis and 36
frames of history), `server/mesoanalysisParameters.js` (27 overlay fields).

Clock: storms every 5 simulated minutes, the atmosphere every half hour, 15 simulated
minutes per real minute. The world is saved every simulated hour.

| Route | Returns |
|---|---|
| `GET /api/health`, `/api/live/metadata` | version, seed, clock |
| `GET /api/authority/state` | clock and revision |
| `POST /api/authority/reset` `{seed}`, `/advance` `{hours}`, `/seek`, `/clock` `{enabled}` | control |
| `GET /api/atmosphere/surface[?frame=]` | observations, isobars, lines, storms |
| `GET /api/atmosphere/parameter?key=&frame=` | one overlay field |
| `GET /api/live/storms`, `/boundaries`, `/field`, `/cell`, `/sounding` | live data by cell |
| `GET /api/radar/catalog`, `/scan`, `/mosaic` | radar |
| `GET /api/outlooks/day1..3` | `{ enabled: false }` until outlooks are rebuilt |
| `GET /api/tiles/...`, `/api/map/manifest` | map tiles for the old outlook pages |

## Risk categories

`js/forecast/worldRiskCategories.js` holds this world's own category thresholds and
`worldCategory()`. `js/verification/truth.js` gives every cell its unrounded chance of each
hazard (`chance`) and its category (`worldRisk`) beside the real-world ones (`risk`).
`scripts/risk-climate.mjs` fits the thresholds; refit whenever the climate changes.

## Where the map sits

The geography (rise to the high ground, lee trough, sources of dry, continental and Gulf
air) is laid out over `geographyColumns` cells; the map sits `geographyOffset` cells east of
its western edge. That place is a state of the regional layer (`geographyOffset`,
`geographyTarget`, `driftGeography()`): each day `RegionSteering` sends the map `roamStep`
cells one way or the other within `roamLow`..`roamHigh`, and it drifts there at no more than
`roamCellsPerHour`. The air, the storms and their cold pools stay where they are on the map;
only the ground under it changes. With `roamLow`/`roamHigh` null the map stays put, and
`steering: false` holds everything still (the geography's own tests use offset 0: the whole
geography, high ground included).

## Not used by the live server

`js/verification/truth.js` and `js/forecast/spcOutlookRules.js` are used by the reports and
kept for the outlooks. The Day 1-3 pages, `js/remoteProductPage.js`, `js/map/`,
`server/tiles/` and the tile and outlook routes are from the old outlook product and only
show a notice; they are to be replaced or removed when the outlooks are rebuilt.

Retired code is kept outside the repository in
`weatherworld-trimmed-2026-10-09` (old engine, inert storm code, old documentation).
