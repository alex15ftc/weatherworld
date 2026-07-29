
﻿# Fake Plains Weather Simulator

**Current version: 2.34.5.2.** The authoritative development plan is [`docs/ROADMAP.md`](docs/ROADMAP.md).


A deterministic severe-weather simulation for a fictional Plains domain. It evolves
an authoritative atmosphere, mesoscale boundaries, persistent storms, tornado/hail/wind
hazards, Day 1–3 outlooks, soundings, map tiles, and forecast verification.

Current release: **2.34.5.2 — Canonical Historical Archive Population**

## Start here

Requirements: a current Node.js LTS release. The project has no third-party runtime
dependencies.

```powershell
npm start
```

Then open `http://localhost:3000`. Set `WEATHER_SEED` before starting to reproduce a
particular scenario; the default seed is deterministic.

Useful validation commands:

```powershell
npm test
npm run test:2.29.0
npm run test:2.30.0
npm run test:2.31.0
npm run test:2.32.0
npm run test:2.32.1
npm run test:2.32.2
npm run test:2.32.3
npm run test:2.32.6
npm run test:2.32.5
npm run test:regression-2.29.0
npm run test:regression-2.30.0
npm run test:regression-2.31.0
npm run test:regression-2.32.0
npm run test:regression-2.32.1
npm run test:regression-2.32.2
npm run test:regression-2.32.3
npm run test:regression-2.32.6
npm run test:regression-2.32.5
npm run benchmark:seed -- 63869760 6 3
```

The full regression suite is intentionally much slower than the primary test suite.

## Documentation

- [Historical archive](docs/HISTORICAL_ARCHIVE.md) — canonical paths, population workflow, and validation
- [Architecture](docs/ARCHITECTURE.md) — authorities, data flow, clocks, and major modules
- [Development](docs/DEVELOPMENT.md) — setup, validation tiers, and change workflow
- [Performance](docs/PERFORMANCE.md) — baseline, profiling method, budgets, and optimization roadmap
- [Current milestone](MILESTONE-2.34.5.2.md) — canonical historical archive population
- [2.32.0 milestone](MILESTONE-2.32.0.md) — severe-pattern climatology and all-scenario physical lifecycle contracts
- [2.31.0 milestone](MILESTONE-2.31.0.md) — lifecycle-aware outlooks and storm-population calibration
- [2.29.0 milestone](MILESTONE-2.29.0.md) — authoritative profile diagnostics and cap evolution
- [2.30.0 milestone](MILESTONE-2.30.0.md) — strengthening analog environments and corrected STP

## Core model

The model follows one directional authority chain:

```text
seed + scenario
      ↓
synoptic atmosphere → mesoscale fields and boundaries
      ↓
storm initiation → storm lifecycle and internal structure
      ↓
observed hazards + forecast outlooks
      ↓
verification and calibration
```

Atmospheric state is authoritative for the environment. Storms are persistent entities
that sample and feed back into that environment. Forecast products diagnose projected
atmospheric and storm support; they do not mutate the simulated truth.

## Project status

The import sweep and the 2.29.0 thermodynamics/cap-evolution regression pass. On the
reference development machine, seed `63869760` over six simulated hours has a median
runtime of 10.50 seconds across three runs after the first measured optimization pass.
Treat that number as a local baseline, not
a cross-machine target; see the performance guide for the measurement protocol.

---

## Historical release notes

The material below is the existing development log. It is retained for provenance;
new contributors should begin with the documentation links above.

## Milestone 2.28.14.3 — Six-Hour Verification Environment Samples

Verification exports now include a top-level `atmosphericEnvironmentSamples` array at every 00Z/06Z/12Z/18Z checkpoint in the simulated timeline. Each checkpoint contains domain mean, maximum, minimum, and 90th-percentile diagnostics plus representative grid-cell samples for severe composite, instability, low-level rotation, forcing, initiation, hail, and wind environments. Representative samples include thermodynamics, surface conditions, 850/700/500/250-mb winds and temperatures, forcing diagnostics, storm coverage, realized updraft, and cold-pool diagnostics.

# Version 2.28.14 — Storm Realization and Outlook Physics Reconstruction

# Fake Plains Weather Simulator


## Milestone 2.28.9 — Universal Synoptic Narratives

- Added 13 universal atmosphere narratives, with tornado-oriented localized and conditional setups favored.
- Kept classic large-outbreak narratives uncommon and extreme outbreak envelopes rarer still.
- Limited explicit cap-bust and stable-day narratives to 1.5% combined.
- Narrative profiles alter atmosphere generation only; outlooks remain atmosphere-authoritative.
- Regional climatology narratives are deferred for the fictional-world region system.

# Weather Simulator 2.28.8 — Analog-Driven Atmosphere Generation

Version 2.28.8 strengthens upstream analog selection and atmosphere generation while preserving the atmosphere-authoritative forecasting rule introduced in 2.28.7.

## Changes

- Replaced generic analog members with impactful severe-weather archetypes: tornadic supercells, regional tornado outbreaks, giant hail, derechos, QLCS, MCS, warm-front tornado corridors, and High Plains events.
- Analog selection is weighted toward the active gameplay narrative and synoptic setup.
- Analog guidance now modifies only generated moisture, instability, lapse rates, wind profiles, forcing timing, and pattern coherence.
- Analog metadata never multiplies outlook hazard probabilities.
- Conditional analogs retain legitimate bust pathways such as cap failure, cloud contamination, boundary displacement, upscale growth, and weak moisture depth.
- Outlook supporting and limiting factors are diagnosed from the actual representative forecast atmosphere and hazard fields.
- Mesoscale discussions are intentionally deferred to the next update.

## Validation targets

Run the existing import, synoptic analog, outlook discussion, forecast cycle, and verification tests. Recheck known outbreak and bust seeds to evaluate the frequency—not merely the existence—of bust outcomes.


## 2.28.7 — Hazard Semantics and Outlook Consistency

- Makes probability × CIG conversion authoritative for tornado, hail, and wind categorical outlooks.
- Removes independent categorical downgrades from the synthesis stage and records mapping-consistency violations in product metadata.
- Adds forecast-horizon occurrence-confidence decay for Day 2 and Day 3 while leaving conditional intensity unchanged.
- Keeps CIG as conditional intensity rather than allowing it to manufacture occurrence probability.
- Fully decouples VTP from tornado genesis, intensity, wind ceilings, duration, probabilities, CIG, and categorical risk.
- Rescales VTP to a display-only 0–5 analysis range.
- Adds regression tests for authoritative outlook mapping and VTP independence.


## Current milestone: 2.28.5

Tornado forecast diagnostics and calibration now include 2/5/10/15/30% threshold verification, exact-track versus neighborhood truth reporting, measured tornado-corridor broadening, and spatial support requirements for Moderate/High categorical risk. See `MILESTONE-2.28.4.md`.

## Milestone 2.28.1 — Storm Realization & Hazard Transition

Active, organized storms now carry evolving organization, persistence, and hazard confidence. Short-range outlooks project those realized storms forward so mature convection can increase tornado, hail, and wind probabilities without loosening the 2.28.0 initiation gates. See `MILESTONE-2.28.1.md`.

## Milestone 2.28.0 — CI Probability Rewrite

Convective guidance now separates broad environmental potential from actual initiation probability. Cap-failure probability and forcing confidence gate storm occurrence, reducing false CI coverage on capped null days while retaining focused boundary initiation in strongly forced setups. See `MILESTONE-2.28.0.md`.

## Milestone 2.27.0 — Performance foundation

Verification reports now include phase timings and simulated-hours-per-second. Run `npm run benchmark:seed -- <seed> <hours> <runs>` for repeatable local benchmarks. Storm interactions use spatial buckets, atmosphere snapshots reuse typed-array buffers, and incomplete forecast truth windows are excluded from scores. Weather calibration is intentionally unchanged in this release.

# Fake Plains Weather Simulator

# Fake Plains Weather Simulator — Milestone 2.24.0

## Storm-owned structure and radar physics

- Storm objects now own persistent structural anatomy: hydrometeor lobes, updraft and downdraft regions, hail cores, hook arcs, mesocyclones, inflow notches, convective lines, rear-stratiform shields, rear-inflow jets and tornado debris zones.
- The radar engine consumes those storm-owned fields and samples them onto the independent 1,024 × 1,024 radar grid. Radar no longer decides storm mode or invents storm anatomy.
- Reflectivity, radial velocity and correlation coefficient are generated from one shared structural state.
- Supercells, ordinary cells, QLCSs and MCSs use distinct physical field layouts.
- Storm labels are hidden from the normal radar product; radar-site labels remain visible.
- The older analytic blob renderer remains only as a compatibility fallback for saved storms that predate the 2.24.0 structure schema.


## Radar and outlook correction

- Analytic high-resolution reflectivity structures with forward-flank precipitation, weak-echo notches, hook echoes, hail cores, bow echoes, and stratiform regions.
- Storm-relative velocity with inbound/outbound mesocyclone couplets and inflow.
- Correlation coefficient now uses a no-echo mask and displays hail mixture and tornado debris only where meteorological echo exists.
- Outlook valid periods are aligned to operational 12Z-to-12Z convective days.
- Each outlook cell samples its full valid period and selects the time where storm coverage, initiation likelihood, and conditional hazard intensity overlap.
- Hail and wind probability guidance is derived independently from tornado realization and can reach meaningful levels in favorable supercell and linear environments.


## Dedicated radar grid and storm-structure rendering

- Radar products now rasterize to a dedicated 1,024 × 1,024 grid (roughly 0.49 km pixels across a 500 km domain), independent of the 10 km atmospheric analysis grid.
- Storm-relative microphysics remain compact while the radar display independently samples them onto the much denser 1,024 × 1,024 radar grid.
- Supercells develop separated updraft, forward-flank precipitation, inflow notch, wrapping hook and mesocyclone/debris structure.
- Linear/QLCS/MCS modes develop line-oriented updrafts, bowing cores, stronger downdrafts and rear stratiform precipitation.
- Reflectivity, velocity and correlation coefficient remain derived from those storm-relative fields.
- Live analysis has an explicit **Show storms and tracks** toggle, disabled by default.
- Day 1–3 categorical and hazard-probability pages no longer fetch, draw or select live storms or tracks.

# Milestone 2.22.0 — Storm Lifecycle Engine

This build separates storm evolution from atmospheric evolution. The authority updates storms every 5 simulated minutes while the broader atmospheric grid updates every 30 simulated minutes. Storm objects now expose motion speed/direction, sustained and gust wind estimates, explicit tornado lifecycle state, tornado ground position, path length, width, estimated wind speed/EF rating, and tornado history. Radar snapshots use the storm clock and retain these fields for the future radar physics rewrite.

Key API metadata fields: `stormValidHourUtc`, `atmosphereValidHourUtc`, `stormCadenceMinutes`, `atmosphereCadenceMinutes`, `activeTornadoes`, and `totalTornadoes`.


## Milestone 2.20.1 — Selectable NEXRAD-style radar endpoint

- Radar is now a first-class page linked from Live Analysis and every Day 1–3 outlook page.
- Five fictional WSR stations expose selectable single-radar views and a network composite.
- Stations complete a severe-weather volume scan every five in-game minutes.
- Reflectivity, radial velocity, and correlation coefficient use product-specific radial ranges.
- Range degradation, beam-height loss, terrain blockage, and deterministic coverage holes affect detections.
- Clicking a radar marker switches to that station and redraws only its detected weather.

## 2.13.1 — Perpetual live atmosphere and predictive outlook cycle

- Added separate predictive **Day 1, Day 2, and Day 3** outlook products.
- Day 1 products issue every 6 simulated hours, Day 2 every 12 hours, and Day 3 every 24 hours.
- Forecast maps are frozen between issuance times instead of changing every frame with the live analysis.
- Forecast guidance projects the current synoptic environment downstream, broadens with lead-time uncertainty, and accounts for the afternoon/evening heating maximum.
- Morning convection can be diagnosed as disruptive, mixed, or enhancing for the later severe-weather corridor.
- Added a selectable outlook product in the viewer; categorical, tornado, hail, and wind layers follow the selected forecast day.
- Added a live world clock where **2 real minutes = 30 simulated minutes**, producing a **96-minute simulated day**.
- The atmosphere now evolves in 30-minute steps, while fast preview remains available for development.
- Added a procedural weather director that hands the world to a queued new seed after the current system and mesoscale remnants fade, with a 72-hour hard handoff so the active pattern never stalls indefinitely.
- Predictive risk geometry retains the nested-risk correction introduced in 2.10.4.8.


## 2.13.1 — Canvas sounding selection reliability

- Restored native `click` as the authoritative grid-selection event.
- Removed pointer capture from the scrollable map, which could swallow `pointerup` and prevent a synthesized click.
- Added drag-distance suppression so scrolling does not open a sounding.
- Added pointer-cancel handling and robust canvas-coordinate bounds checks.
- Added cache-busting version updates so browsers do not retain the broken 2.10.4.2 interaction module.

# Fake Plains Weather Simulator

# Fake Plains Weather Simulator — Milestone 2.10.2

## Convective readiness and triggering

Milestone 2.10.2 replaces the old single-factor convective-initiation diagnostic with three related fields:

- **Convective readiness** — thermodynamic ability to sustain deep convection if parcels are lifted. It uses CAPE, moisture depth, daytime heating, CIN, and cap breakability.
- **Trigger strength** — the ability of boundaries and larger-scale ascent to lift parcels. It uses convergence, moisture-flux convergence, frontogenesis, terrain lift, upper divergence, PVA, vertical motion, and diagnosed synoptic features.
- **Convective initiation potential** — the overlap of readiness and trigger strength after dynamic cap erosion is considered.

High readiness without a trigger now represents a loaded but capped warm sector. A strong front in stable air can have high trigger strength but low initiation potential. Widespread convection requires both.

## Risk integration

Tornado, hail, and wind probability products now all use an occurrence-support term derived from convective initiation potential. The environmental hazard scores remain conditional-intensity diagnostics, but published probabilities are reduced when storms are unlikely to form.

This means:

- A highly tornadic environment with little credible initiation can retain a meaningful conditional signal without automatically producing a broad high tornado probability.
- Widespread forcing overlapping a ready warm sector supports broader wind and hail probabilities.
- The overall categorical outlook changes only through the authoritative tornado, hail, and wind products; no separate category quota or renderer adjustment is applied.
- Gameplay climatology promotion cannot create a hazard core where initiation potential is negligible.

The occurrence-support floor intentionally accounts for isolated or nearby initiation and storm motion into a cell. A displayed 15% initiation potential is not a forecast of 0.15 storms; it indicates weak but nonzero confidence that the cell participates in an initiation corridor.

## Viewer changes

New map layers:

- Convective readiness
- Trigger strength
- Convective initiation potential

The selected-cell panel now reports all three fields plus the hazard occurrence-support value used by the risk diagnosis.

## Validation

- JavaScript syntax validation passes for all modules.
- Initialized and displayed outlooks remain identical.
- A 100-seed browser-path smoke test produced 37 Slight, 31 Enhanced, 24 Moderate, 3 High, and 5 Marginal cases. This is a small sample, but it confirms that initiation affects every hazard without recreating the earlier High-risk inflation.
- Storm-motion and risk-geometry behavior from 2.9.6 is preserved.

## Milestone 2.10.2 cleanup audit

This release is a behavior-preserving cleanup before the storm-engine work begins.

### Corrected

- Removed an obsolete narrative test that still expected `generateScenario()` to return an outlook. Since 2.9.4, the authoritative outlook is produced only after `initializeEvolution()`, so the old test generated `undefined`/`NaN` output.
- Removed unused risk-analysis and map-analysis imports from the scenario generator. Scenario generation remains atmosphere-only.
- Removed dead wind-transform helpers left behind after spatial orientation and background wind orientation were separated in 2.9.6.
- Removed an unused snapshot parameter from terrain forcing.
- Replaced a misleading `rediagnoseEnvironment(world, false)` function with the single-purpose `updateSoundingDiagnostics(world)` operation.
- Centralized pressure levels and initial/outlook timing constants.
- Replaced milestone-specific validator scripts with repeatable npm test commands.

### Architectural findings retained for 2.10.x

- `riskDiagnosis.js` remains intentionally monolithic for this cleanup release. It should be split into hazard scoring, probability hierarchy, categorical lookup, and outlook-summary modules when the storm-level hazard engine is introduced.
- Browser state caching still clones full atmospheric cells. This is acceptable for the current 50×50 domain, but storm snapshots should use compact immutable records or typed arrays rather than extending this clone-heavy approach.
- Environmental outlook probabilities and future storm-observed hazards must remain separate products. The 2.9.x outlook engine should not become the storm lifecycle engine.

### Validation

Run:

```bash
npm test
npm run test:narratives
```

## Milestone 2.10.0 — Storm engine foundation

Milestone 2.10.0 introduces a separate persistent storm layer while keeping the atmospheric grid authoritative for the environment.

### Included

- Continuous storm positions in kilometers, independent of the 10 km atmospheric cells.
- Deterministic initiation candidates derived from convective readiness, trigger strength, initiation potential, CIN, and storm spacing.
- Persistent storm identifiers and a world-level storm registry.
- Five lifecycle states: tower, developing, mature, weakening, and dissipating.
- Bilinear environmental sampling as storms move between cells.
- Environment-derived steering and right-moving supercell deviation without post-generation direction clamping.
- Twelve internal storm substeps per simulated hour, allowing motion and intensity to evolve more smoothly than the atmospheric timestep.
- Browser storm overlays with identity, lifecycle-sensitive symbols, and motion vectors.
- Storm state included in hourly cache restoration.

This milestone intentionally does not include mergers, splitting, storm-generated outflow, tornado objects, damage, or storm-derived radar. Environmental outlook risk remains separate from observed storm hazards.

### Validation

Run:

```bash
npm test
npm run test:narratives
```

The storm test checks deterministic registry creation, finite positions and motion, and formation across a multi-seed sample.

## Milestone 2.10.2 — Dynamic Mesoscale Boundaries

This release turns diagnosed fronts and drylines into persistent mesoscale objects rather than leaving them only as cell-by-cell labels.

### Boundary registry

The new `MesoscaleEngine` creates continuous objects for:

- cold fronts
- warm fronts
- drylines

Each object stores an ID, continuous polyline points in kilometers, translation velocity, width, strength, age, and active state. Initial objects are extracted from connected diagnosed boundary regions, reduced to ordered polylines, and then advanced independently of the 10 km cells.

### Atmosphere coupling

Moving boundary objects project a smooth influence back onto nearby atmospheric cells. Their influence contributes to convergence and boundary strength and applies weak, type-specific thermodynamic tendencies:

- cold fronts cool and dry the post-frontal side
- warm fronts reinforce cool-side and warm-sector contrasts
- drylines mix moisture down on the dry side while preserving richer moisture to the east

The tendencies are intentionally modest so the explicit objects guide the atmosphere without replacing the existing synoptic evolution or diagnostic calculations.

### Convective initiation

Initiation candidates now receive a limited bonus where readiness and triggering overlap an explicit boundary object. A boundary cannot create storms in an otherwise unsuitable environment; it only focuses initiation where the atmospheric ingredients already support it.

### Viewer and state restoration

The browser draws the authoritative continuous boundary polylines with stable IDs. Mesoscale state is included in hourly cache snapshots, seeking, and cached-state detachment so boundaries do not jump or regenerate when the timeline is scrubbed.

Storm-generated outflow boundaries remain reserved for the storm-feedback milestone because they require storm cold pools and local atmospheric stabilization.

### Validation

`npm run test:boundaries` verifies that boundary registries are created, points remain finite, objects translate across the domain, and their influence is projected onto atmospheric cells. The eight-seed test produced explicit boundaries in all eight worlds and confirmed movement in 24 tracked objects.

## Current 2.10.x roadmap

- **2.10.0 — Storm Engine Foundation:** persistent storms, continuous motion, basic lifecycle, environmental sampling, and browser visualization.
- **2.10.2 — Dynamic Mesoscale Boundaries:** persistent moving cold fronts, warm fronts, and drylines coupled to the atmosphere and initiation engine.
- **2.10.2 — Synoptic Air Masses and Elevated Mixed Layers:** advecting mT, cT, cP, and mP air masses; explicit EML base, depth, lapse rate, cap, transport, and decay.
- **2.13.1 — Storm Modes and Organization:** pulse, multicell, discrete supercell, LP/classic/HP tendencies, broken lines, and mode transitions.
- **2.13.1 — Storm Feedback and Interactions:** cold pools, outflow boundaries, stabilization, secondary initiation, competition, mergers, splitting, and upscale growth.
- **2.10.5 — Storm-Level Hazards:** tornado, hail, and damaging-wind production from actual storms while preserving environment-only outlook products.
- **2.10.6 — Radar Engine:** reflectivity, velocity, and correlation coefficient generated from storm structures.
- **2.10.7 — Roblox Replication Prototype:** compact authoritative storm snapshots, regional filtering, timestamped interpolation, and client visual targets.

## 2.10.2 — Unified Boundary Authority and Coupled Feedback

- Persistent mesoscale boundary objects are now the only authoritative fronts and drylines after initialization.
- The initial gradient diagnosis is used only to seed those objects.
- Grid boundary fields are cleared and reprojected from current object positions every model hour.
- Environmental gradient signals remain diagnostic and cannot create a second static boundary set.
- Risk, forcing, and initiation consume the current object projection.
- Storms now return buffered temperature, moisture, stabilization, and outflow-convergence tendencies to the atmosphere.
- Atmospheric diagnostics are recalculated after storm feedback before an outlook checkpoint.
- The viewer no longer draws the legacy analyzed boundary lines over the persistent boundary objects.


## Milestone 2.10.2 — Synoptic Air Masses, EMLs, Regions, and Pattern Realism

This release adds six labeled climatological regions, persistent elevated-mixed-layer state, air-mass origin and modification diagnostics, and a synoptic-coherence pass that identifies or constrains physically implausible boundary motion and midlevel flow.

### Regions

Every 10 km cell is assigned to one of six fictional Great Plains regions: Northwest High Plains, Southwest High Plains, North-Central Plains, South-Central Plains, Northeast Low Plains, or Southeast Low Plains. Region borders and labels can be independently toggled in the viewer. Regional metadata includes elevation class, typical severe-weather dewpoint baseline, EML frequency, and moisture-recovery tendency.

### Elevated mixed layer

The EML is represented as a transported elevated plume with source, base, top, depth, axis, footprint, strength, motion, age, and convective-decay behavior. It modifies the 700–500 mb thermal profile, lapse rates, cap strength, instability, initiation, and therefore the downstream tornado, hail, wind, and categorical outlook diagnostics.

### Synoptic consistency

Boundary motion is constrained by boundary type rather than allowed to drift arbitrarily. Daytime drylines generally mix eastward, cold fronts cannot persist with strong westward or poleward motion, and warm fronts cannot steadily surge far south. A coherence diagnostic also checks boundary geometry and widespread anomalous easterly midlevel flow. Corrections are gentle constraints on evolution, not post-processing changes to risk colors.

### New viewer layers

- Elevated mixed layer influence
- 700–500 mb lapse rate
- Air-mass class
- Synoptic coherence
- Toggleable regional borders and labels

### Validation

Module syntax and a targeted generate/evolve integration test passed with six regions, a finite EML plume, coherent boundary motion, and a valid authoritative outlook. The legacy 100-seed smoke test is retained but can be computationally expensive in constrained environments.

## Milestone 2.10.2.1 — Setup-driven convection and risk semantics

This patch separates three concepts that were previously blended together:

- **Forecast initiation probability** determines whether sustained convection forms.
- **Expected storm coverage** determines tornado, hail, and wind occurrence probabilities.
- **Conditional intensity** determines CIG hatching based on how intense a hazard could become if it occurs.

The synoptic setup selected at generation now projects coherent initiation corridors, expected storm mode fractions, coverage, and conditional intensity. Supported setup families include classic dryline supercells, lee-cyclone/triple-point events, warm-front supercells, cold-front squall lines, ejecting-wave outbreaks, High Plains upslope events, northwest-flow clusters, and nocturnal elevated MCS events.

Storm initiation now uses staged physical checks instead of multiplying several gates into near-zero values. Candidate storms are allowed along broad initiation corridors, with spacing and maximum storm counts determined by the setup's expected coverage.

New viewer layers:

- Forecast initiation probability
- Expected storm coverage
- Expected supercell fraction
- Expected linear-storm fraction
- Conditional tornado intensity
- Conditional hail intensity
- Conditional wind intensity

The map summary reports forecast storm count versus active realized storms. Timeline cache restoration includes the setup forecast state.

## Milestone 2.13.1 — Storm Modes, Lifecycles, and Interactions

This release turns persistent storm points into organizing convective systems.

### Storm modes

Storms now retain and transition among pulse, multicell, discrete right-moving supercell, left-moving supercell, linear segment, QLCS, MCS, and elevated-convection modes. Mode diagnosis uses CAPE, deep-layer shear, SRH, forcing, expected discrete/linear fractions, storm coverage, and the selected synoptic setup. Mode changes are persistent rather than being randomly reassigned each frame.

### Lifecycles and motion

The lifecycle now includes tower, developing, mature, organizing, weakening, and dissipating phases. Motion varies by mode: supercells receive right- or left-moving deviation, while lines and MCSs receive a cold-pool/downshear propagation component. Storms track distance traveled, peak intensity, inflow quality, and mode age.

### Splits, mergers, and upscale growth

Organized storms can split into persistent right- and left-moving members in strongly sheared environments. Nearby cells compete for inflow, merge when their cores and cold pools overlap, and can transition from multicells or line segments into QLCSs and MCSs. The storm engine records cumulative split and merger counts.

### Cold pools and feedback

Every mature storm now develops a mode- and environment-dependent cold pool with an explicit radius and strength. Cold pools cool and stabilize processed air while placing convergence near the gust-front ring. The viewer draws this ring as a moving dashed cyan outline. Storm feedback remains buffered and is applied after storm updates.

### Viewer

Storm symbols now distinguish supercells, ordinary cells, and linear systems. Labels include compact mode abbreviations, and the map summary reports active modes, split count, and merger count.

### Validation

Run `npm test` or `npm run test:organization`. The organization test checks recognized modes, finite cold-pool and track values, storm creation, and atmospheric feedback across multiple deterministic seeds.


## Patch 2.13.1 — Outbreak-risk restoration and upscale-growth tuning

This patch fixes a regression where expected storm coverage was multiplied by boundary-corridor proximity a second time. That compressed hazard probabilities enough that Moderate and High outlooks became exceptionally rare even in regional and historic outbreak narratives. Coverage now remains a regional expectation, while initiation corridors continue to control where storms form. Regional outbreak, historic outbreak, derecho, and ejecting-wave setups receive their intended coverage support; hazard probabilities and CIG still independently determine the final category.

Long-lived storms now have an explicit upscale-growth tendency. Mature storms with overlapping cold pools, nearby convection, and adequate forcing or linear-mode support transition into line segments, then QLCS/MCS structures as mergers continue. Isolated discrete supercells can still remain discrete when forcing is weak, preventing every storm from automatically becoming a line.


## 2.13.1 fixes
- Connected upper-risk climatology, narrative ceilings, category calibration, and regional coherence to the active outlook pipeline.
- Coupled outbreak narratives to compatible significant/extreme atmospheric envelopes.
- Removed the extra regional-outbreak High-risk lottery and aligned promoted-core/coherence area thresholds.
- Restored cell sounding selection with pointer events, drag tolerance, keyboard focus, and explicit canvas hit handling.


### 2.13.1 interaction fix
The rendered canvas is now presentation-only. A transparent DOM interaction layer above it owns all pointer and keyboard input, so sounding selection no longer depends on canvas hit-testing behavior.


## Patch 2.13.1 — direct canvas sounding interaction

- Restores the canvas itself as the mouse/touch hit target, matching older working versions.
- Removes the transparent interaction overlay that could become zero-sized or misaligned.
- Restores visible hover and selected-cell outlines.
- Maps pointer coordinates from the displayed canvas directly to grid rows and columns.
- Clicking a cell immediately opens its sounding; the inspector button remains available.

## Patch 2.13.1 — UI startup and sounding interaction

The sounding interaction code in 2.10.4.6 never initialized because `main.js` attempted to attach listeners to missing `toggleRegionLabels` and `toggleGrid` elements. The resulting null `addEventListener` exception stopped module execution before the canvas hover and click listeners were registered. This patch restores both controls and makes optional-control binding defensive so a missing toolbar button cannot disable map interaction again.


## Patch 2.13.1 — nested risk topology

Categorical and hazard-probability analyses now fill fully enclosed lower-risk islands. Lower-risk areas connected to the outside remain unchanged, while impossible closed rings such as ENH surrounding SLGT are removed.


## 2.13.1 product endpoints

- `index.html` — live mesoanalysis and clickable soundings; outlook layers are intentionally absent.
- `day1.html` — frozen Day 1 outlook, reissued every 6 simulated hours.
- `day2.html` — frozen Day 2 outlook, reissued every 12 simulated hours.
- `day3.html` — frozen Day 3 outlook, reissued every 24 simulated hours.

At 48 hours into each 72-hour system cycle, the weather director pre-generates the next system. Outlook windows that extend beyond the handoff blend the queued pattern into their risk fields, so Day 2 and Day 3 show the incoming system before it becomes the live atmosphere.


## Milestone 2.13.1

- Continuous browser Weather Authority using elapsed real time.
- 2 real minutes advance the world by 30 simulated minutes.
- Day 1, Day 2, and Day 3 products remain frozen between scheduled issuances.
- Product issue/valid metadata and rolling issuance archives persist across pages.
- Upcoming systems are prepared before the 72-hour handoff and appear in future outlook valid periods.

## Milestone 2.13.1 — Single-writer cross-page Weather Authority

- Added a short renewable authority lease so only one open browser page advances the shared atmosphere at a time.
- Added monotonic world-state revisions and optimistic write checks, preventing an older tab from overwriting newer live state.
- Added writer identity and schema-v3 migration while retaining compatibility with 2.13.0 persisted worlds.
- Outlook archives, queued-system seeds, handoff timing, and the live clock remain shared across the live, Day 1, Day 2, and Day 3 endpoints.
- Authority ownership expires automatically if the active page closes or stalls, allowing another page to continue the world without resetting it.


## Milestone 2.13.3 — Authority Recovery and State Integrity

- Upgraded shared state to schema v4 with explicit migration from prior browser worlds.
- Added checksum-validated primary, staging, and last-known-good snapshots.
- Writes now stage, verify, back up the prior primary, commit, verify again, and only then clear staging.
- Startup selects the newest valid revision and automatically repairs a corrupt or incomplete primary snapshot.
- Authority leases now include fencing tokens and epochs, reducing simultaneous expired-lease takeover races.
- Added health diagnostics for writer ownership, lease expiration, revision, last successful update, simulation hour, and recovery source.
- Added regression coverage for corrupt state, interrupted commits, stale revisions, lease expiry, and schema migration.


## Milestone 2.13.3 — Forecast-Cycle Consistency
Outlook issuances now carry immutable cycle IDs and exact seed, system, and world-revision provenance. Current products and archives persist through the shared authority state so pages cannot mix products from different forecast cycles.


## Milestone 2.20.1 — Storm feedback and synthetic radar

- Storm cold pools cool, dry, stabilize and generate outflow convergence in processed cells.
- Storms diagnose observed modes and hazards including supercells, elevated hailstorms, QLCS/MCS organization, tornado signatures and long-track derecho qualification.
- `radar.html` is a dedicated radar endpoint with reflectivity, radial velocity and correlation coefficient products.
- Five synthetic radar stations have finite radial ranges, terrain/range degradation and deterministic radar holes.
- Every station completes a volume scan every five minutes of simulation time.
- Radar stations are selectable from the menu or directly by clicking their map marker.

## 2.20.1 — Radar detail and performance
- Replaced per-screen-pixel atmospheric resampling with a cached 512×512 scan raster.
- Added 1×–12× wheel/button zoom, drag panning, clickable stations, and storm-focus controls.
- Added reflectivity hook echoes, inflow notches, hail cores, bow echoes, velocity couplets, and CC debris/hail signatures.
- Added product/station/scan keyed raster caching and storm-bounded calculations.
- Persisted a lightweight radar snapshot in shared authority state for fast radar startup.
- Added a same-tab session atmosphere snapshot to avoid full history replay when navigating among product pages.


## 2.20.1 storm truth aggregation

Storms now publish compact observations every one simulated minute into cell-addressed shards. The radar authority aggregates the latest observations into five-minute frames, allowing future Roblox regional servers to send only storm-object deltas rather than full atmospheric grids. Radar scan rasters are converted to drawable canvas surfaces before rendering, fixing browsers that reject ImageData in drawImage().

## Milestone 2.20.1 — Explicit Mesoscale Field Layer

The simulation now contains a causal mesoscale bridge between the seed-driven synoptic pattern and storm initiation. Each atmospheric cell diagnoses and evolves boundary-layer depth, equivalent-potential-temperature gradients, moisture pooling, differential heating, convergence corridors, cap erosion, effective inflow, ascent, vertical vorticity/stretching, and initiation focus. Storm initiation and storm-environment sampling consume these fields rather than jumping directly from broad synoptic forcing to storm labels.


## Milestone 2.20.1
Adds atmospheric-derived storm-local field grids sampled directly by radar, plus a session-first Live Analysis startup path and throttled snapshot serialization.

### Performance notes
- Live Analysis attempts a direct same-tab session restore before procedural regeneration.
- Large session snapshots are serialized at most once every 15 seconds and once on page exit when dirty.
- Radar continues to cache five-minute scan rasters; zoom and pan do not recompute storm physics.
- Only active storms own 32×32 typed-array internal grids.

## 2.20.1 storage and radar hotfix

Storm-local fields are now persisted as quantized base64 binary payloads instead of expanded JSON number arrays. Shared state moved to schema/key v6 and automatically migrates prior v5 snapshots while removing oversized legacy copies before repair. Radar restores and samples the same compact hydrometeor, wind, vorticity, and debris fields used before persistence.


## 2.20.1
Repairs legacy numeric-key storm fields, rejects invalid radar snapshots, rebuilds missing storm truth, and defers Live Analysis history cloning/persistence until after first render.

## 2.20.1 weather-authority service

The recommended way to run the simulator is now:

```bash
npm start
```

Then open `http://localhost:3000`. The Node process owns the atmospheric world and serves product-specific endpoints. No database is required; current state remains in memory and a small checkpoint marker is written atomically to `data/authority-checkpoint.json`.

Key endpoints:

- `GET /api/health`
- `GET /api/authority/state`
- `GET /api/live/field?product=temperature`
- `GET /api/live/boundaries`
- `GET /api/live/storms`
- `GET /api/live/sounding?row=20&column=25`
- `GET /api/radar/snapshot`
- `GET /api/radar/stations`
- `GET /api/outlooks/day1`
- `GET /api/outlooks/day2`
- `GET /api/outlooks/day3`

When pages are opened directly without the Node service, they retain the local-storage and module-worker fallback.

## Milestone 2.20.1 — Thin product clients and cached server products

Normal browser pages no longer download `/api/authority/state`. Live Analysis requests one compact field grid, storm summaries, metadata, and soundings only when selected. Day 1–3 request compact outlook grids. Radar requests a server-generated, quantized scan through `/api/radar/scan` and no longer rasterizes storm internal fields in the browser while the Node authority is available.

The Node authority now advances on a background timer, caches products by revision, supports ETags/304 responses, uses asynchronous gzip, and warms the composite reflectivity cache after startup and each authority revision. Full local simulation modules are loaded only when the service health check fails.

## Milestone 2.20.5 — Performance instrumentation and lazy-startup diagnostics

Open `http://localhost:3000/performance.html` to inspect browser Navigation/Resource Timing, application spans, API request timing and payloads, long tasks, authority endpoint timing, product-cache hits/misses, and recent server requests. Product pages retain their lightweight 2.20.1 paths and now publish a profile at `window.__WEATHER_PROFILE__`. The dashboard can export a combined client/server JSON report.

The instrumentation deliberately distinguishes observable module resource timing from unavailable engine-internal JavaScript parse timing. Explicit spans cover authority detection, dynamic imports, API fetch/parse, field decoding, canvas-surface construction, rendering, and readiness.

## Milestone 2.20.5 — Viewport tile service

The browser feature pages now behave like a map client instead of downloading and repainting full weather grids.

- Live Analysis, Day 1, Day 2, and Day 3 request 256×256 PNG tiles only for the visible viewport.
- Radar uses the same tile pyramid and no longer downloads or colorizes the full radar raster in the browser.
- Zoom levels 0–3 provide level-of-detail loading; panning requests only newly visible tiles.
- Tiles are revision-addressed, immutable, ETag-enabled, and cached in both the authority and browser.
- Storms, radar sites, and labels remain lightweight vector overlays.
- Soundings remain exact, on-demand point queries through `/api/live/sounding` after a map click.
- `/api/map/manifest` publishes domain and tile-pyramid metadata.
- `/api/tiles/{live|outlook|radar}/{z}/{x}/{y}.png` serves generated product tiles.
- Browser bootstrap no longer uses top-level await, and performance elapsed time is measured from navigation start.

Run `npm start`, then open `http://localhost:3000`.

## 2.20.5 interaction hotfix
- Feature pages are now server-backed by default and no longer silently import the complete browser simulation when an authority probe fails.
- Opening an HTML file directly redirects to the Node authority at `http://localhost:3000`.
- Local simulation mode is still available explicitly with `?local=1`.
- Tile PNG compression is asynchronous, allowing sounding and control requests to be served while tiles are being encoded.
- Duplicate tile requests share one in-flight promise.
- Soundings are cached per authority revision.
- Initial map paint no longer waits for storm overlays.


## Milestone 2.21.4 — Classic grid and consolidated soundings

- Restores a fixed full-domain 50 × 50 clickable grid while retaining high-resolution server tiles.
- Decouples tile source resolution from map zoom and uses a 4 × 4 tile mosaic for a crisp classic grid.
- Clicking any cell opens its sounding immediately.
- Consolidates surface, forcing, terrain, boundary, and forecast diagnostics into the sounding modal.
- Restores STP and SCP with explicit units and consistent metric formatting.
- Adds forecast-style tornado environment box plots for STP, SCP, SRH, shear, CAPE, and LCL.
- Standardizes sounding table units and typography.

## 2.21.4 authority controls

The visible seed, time, preview, and clock controls now operate the Node weather authority instead of loading the full simulation into the browser. Control routes are POST-only:

- `/api/authority/reset`
- `/api/authority/advance`
- `/api/authority/seek`
- `/api/authority/clock`

Each mutation increments the authority revision and invalidates server tile/product caches. Feature pages then request the new manifest and revision-specific tiles.

## Milestone 2.21.4

Day 1–3 pages are forecast-product-only views: categorical, tornado probability, wind probability, and hail probability. Hazard fills use discrete SPC/NWS probability bins instead of interpolated gradients. Diagonal significant-severe hatching is composited directly into hazard tiles. In soundings, the Skew-T and hodograph are the primary visual pair; the Effective Layer STP (with CIN) distribution is a smaller secondary diagnostic below them.


## 2.21.4
Corrected SPC probabilistic palettes, queued authority controls, debounced time seeking, view-specific tile prewarming, and compact Effective-Layer STP plus possible hazard type.

## Milestone 2.21.4 — cache-safe outlook switching and reliable authority controls

- Adds a unique authority-instance namespace and tile-style revision to immutable tile URLs, preventing browsers from reusing tiles generated by an older server process or palette.
- Makes map manifests non-cacheable and adds a client request nonce so seed and time changes cannot reload stale authority metadata.
- Atomically preloads the 4 × 4 classic-grid tile set before swapping layers, eliminating mixed products and black partial tiles during rapid switching or page navigation.
- Uses white no-risk outlook backgrounds and retries a failed tile once.
- Verifies random-seed reset responses against the requested seed before accepting the update.
- Uses the official NOAA/NWS SPC polygon fill RGB values for tornado, wind, and hail probability products.

## Milestone 2.21.4 — Spatial integrity and revision-bound cell data

- Cell summaries and soundings are now fetched with the active authority instance and revision.
- Cell and sounding API responses are `no-store` so browser HTTP caches cannot reuse profiles from an older seed.
- JavaScript and CSS are revalidated on reload instead of being held for one hour.
- Every generated atmosphere is checked for spatial variance in temperature, dewpoint, CAPE, shear, and SRH samples.
- A collapsed or uniform generation is rejected before it becomes the active authority state.
- Authority metadata exposes `spatialIntegrity` diagnostics for troubleshooting.

## Milestone 2.21.4 — Horizontal Tile Sampling Fix

Fixed a server tile-renderer indexing defect that sampled only the first cell in each grid row (`gy * width`) instead of the actual cell (`gy * width + gx`). The defect flattened all horizontal spatial variation into row-wide bands on live and outlook products. Added a PNG regression test that verifies horizontally distinct source cells render as distinct colors.

## Milestone 2.21.4

- Replaced full-grid atmospheric memory allocation with a sparse active-cell map.
- Quiet cells carry no memory record; weak, inactive feedback records are pruned after 18 simulated hours.
- Preserved a compatibility diagnostic view on active cells only.
- CIG overlays now require a minimum matching hazard probability and coherent 3-cell area.
- Tornado CIG requires adequate CAPE, SRH, cloud-base height, and shear.
- Hail CIG is restricted to supercell-supportive storm modes.
- Wind CIG requires adequate CAPE and linear organization.
- CIG1 remains broken diagonal, CIG2 solid diagonal, and CIG3 crossed solid diagonal.


## Milestone 2.21.4 — CIG visibility and sounding coherence

- Replaced nearly indistinguishable black CIG hatching with three clearly different treatments: amber stipple (CIG1), red diagonal bands (CIG2), and magenta cross-grid (CIG3).
- Added colored nested boundaries and explicit CIG1/CIG2/CIG3 labels at connected-area centroids.
- Added a local sounding plausibility tier that caps tornado probabilities before categorical risks are assigned.
- Marginal tornado environments are capped at 5% and cannot receive CIG.
- CIG1 now requires TOR-quality local support and at least 10% tornado probability; CIG2 requires at least 15%; CIG3 requires a PDS-quality environment and at least 30%.
- Regional scenario climatology can no longer force a 15%+ tornado corridor through cells that fail the local sounding check.

## Milestone 2.21.4 — Probability × CIG Matrix

- Uses the supplied tornado, wind, and hail probability/CIG categorical matrices.
- Diagnoses CIG independently from occurrence probability.
- Applies local sounding-based probability ceilings before spatial hazard processing.
- Prevents topology and climatology passes from promoting cells above their local matrix-supported category.
- Adds regression coverage for every valid matrix combination.

## Milestone 2.21.4 — CIG Rendering Regression Fix

- Preserves diagnosed CIG1/CIG2/CIG3 values through the server tile pipeline instead of collapsing every significant area to CIG1.
- Restores the established operational hatch language on both local canvas and remote product tiles:
  - CIG1: broken diagonal lines
  - CIG2: solid diagonal lines
  - CIG3: crossed solid diagonal lines
- Keeps hail capped at CIG2.
- Updates the remote outlook legend and adds a rendering regression test for all three patterns.

## Milestone 2.22.1–2.22.3 — Storm lifecycle stabilization

### 2.22.1 Storm inspector
- Clickable lifecycle-aware storm symbols on the live analysis map.
- Dedicated storm inspector with lifecycle, motion, organization, updraft, rotation, cold pool, gust, tornado, genealogy, split, and merger information.
- Explicit on-ground tornado marker and bounded tornado-track rendering.
- Storm motion vectors and selected-storm highlighting.

### 2.22.2 Lifecycle calibration
- Stricter tornado genesis gates for supercells and QLCS structures.
- Minimum storm age, intensity, and organization requirements.
- Smoother tornado intensity/width evolution and capped track-point histories.
- Peak updraft/rotation tracking and explicit dissipation reasons.
- Merger genealogy and interaction timestamps.

### 2.22.3 Persistence and API hardening
- World-state schema v7 with migration from v6 and older records.
- Compact public storm snapshots separated from authority-owned internal fields.
- Recent-ended storm archive with configurable retention and hard entry limits.
- Compressed radar recovery fields retained while redundant environment payloads are removed.
- Tornado histories and live path geometry are bounded to prevent unbounded storage growth.

### 2.22.7 Storm inspector live-data fix
- New storms now receive environment-specific initial intensity, organization, updraft, cold-pool, wind, rotation, and motion diagnostics before their first five-minute lifecycle tick.
- Internal storm fields use a storm-specific deterministic seed rather than sharing one seed across every newly initiated storm.
- Live storm snapshots bypass stale HTTP caching and refresh every five real seconds.
- Selected-storm inspector values update in place as storm truth advances.
- Initial storm motion direction is calculated from the motion vector instead of defaulting to 0 degrees.


## Milestone 2.22.7 — Warm-sector realization and tornado-rich gameplay

- Adds open warm-sector convective initiation support away from exact boundary axes.
- Aligns hazard probabilities with initiation and projected storm-track support.
- Makes tornadoes a common gameplay event for mature, organized supercells.
- Lowers supercell tornado genesis gates while preserving storm-structure and environmental dependence.
- Extends strong supercell tornado persistence and supports more frequent cycling.

## Milestone 2.22.8 — Predictive Outlook and Emergent Tornado Calibration

- Tornado production is no longer driven by outlook risk values or scenario narrative promotion.
- Supercells accumulate favorable tornadic-opportunity time from storm structure, inflow quality, mesoscale interactions, contamination, competition, and cold-pool balance.
- Strong environments produce tornadoes commonly, but individual supercells can still fail.
- Tornado random sampling now uses an avalanche-mixed deterministic hash so adjacent storm ticks do not receive correlated trigger values.
- Outlook tornado probabilities now estimate expected tornadic storms from initiation coverage, predicted storm mode, storm survival, storm-track support, and environmental ingredients.
- Enhanced, Moderate, and High tornado-driven risks can be reached from predicted realization rather than observed tornado outcomes.
- Scenario narratives no longer manufacture or promote risk categories.

## Milestone 2.22.11 — Generalized Hazard Outlook and CIG Coherence

- Applied ingredient-based conditional-intensity diagnosis to tornado, wind, and hail hazards.
- Kept composite diagnostics such as STP non-causal; outlook and storm physics use their underlying atmospheric ingredients.
- Removed scenario-narrative ceilings from the authoritative categorical outlook. The day-level category is now derived from finalized tornado, wind, and hail probability × CIG matrices.
- Recomputed hazard categories after CIG spatial processing so displayed categories cannot become stale.
- Prohibited low-probability CIG3 artifacts: tornado CIG3 requires at least 30% probability and wind CIG3 requires at least 45%; hail remains limited to CIG2.
- Added increasing spatial-coherence requirements for CIG1, CIG2, and CIG3, with CIG3 reserved for broad highest-end corridors.
- Added ingredient-supported CIG1 guidance in qualifying 10%+ tornado corridors without allowing probability alone to manufacture hatching.

## Milestone 2.22.12 — Forecast Continuity, Atmospheric Recovery, and Peak Timing

- Predictive outlooks now evaluate the expected peak convective period inside each valid window instead of the window midpoint.
- Surface-based Plains convection is biased toward a broad 20–23Z maximum; elevated MCS setups retain a nocturnal maximum.
- Outlook products preserve their issued probability grids so later Day 1 forecasts can compare against prior Day 2/3 guidance for the same valid period.
- Prior guidance supplies continuity only when synoptic persistence and atmospheric recovery remain supported; it does not dictate storm outcomes.
- Forecast hazard probabilities now account for warm-sector persistence, moisture transport, synoptic ascent/coherence, projected storm coverage, and recovery from processed air.
- Coupled-atmosphere memory now dissipates processed air and cold pools faster during well-mixed, moist, synoptically supported recovery periods.
- Warm-sector temperature and dewpoint recovery are favored when moisture transport and large-scale ascent persist.

## Milestone 2.22.13 — Diurnal Convective Initiation

- New 12Z seeds begin predominantly capped instead of immediately spawning surface-based storms.
- Surface heating and cap erosion build through the afternoon, with the primary CI maximum from 20Z through 00Z.
- Strong forcing can still produce isolated early initiation.
- Nighttime cooling suppresses ordinary surface-based convection.
- Elevated instability, the low-level jet, and synoptic forcing can sustain nocturnal storms and tornadoes.
- Storm formation probability no longer has an artificial 24% minimum.

## 2.23.2 — Forecast CIG and trajectory correction

- Radar retains its 1024² data field but is presented in an aspect-preserving square stage matching the other map footprint.
- Predictive outlook cells now store tornado, hail, and wind CIG values diagnosed from the projected peak-hour environment.
- Outlook hatching reads forecast CIG rather than the live issuance-hour atmosphere.
- Overall categorical risk is derived from each hazard's probability × CIG matrix.
- Forecast storm trajectories include mode-dependent storm motion and right-mover deviation.
- Hazard maxima are selected from full valid-window coverage/intensity overlap and use upstream environmental trajectories.


## Milestone 2.25.6 — Grid geometry and VTP live filter
The atmospheric grid is authoritatively 10 × 10 statute miles per cell (16.09344 km internally). A 50 × 50 world therefore spans 500 × 500 miles. The server-backed VTP live-analysis field and tile palette are now wired end to end.

## Milestone 2.27.1

Atmospheric analysis now uses tiered update cadences. Fast storm-sensitive diagnostics remain on every 30-minute step, map/setup analysis runs hourly, and synoptic-coherence analysis runs every three hours. Immutable terrain slopes are cached, and phase-level counters are available in `world.evolution.performance`.

## 2.27.2 background timeline
The next 72-hour seed is generated in a dedicated worker beginning 36 simulated hours into the current cycle. The current seed remains active until the replacement timeline and handoff frame are ready, preventing loading intermissions during automatic system turnover.

## 2.27.3 Active Timeline Navigation

The active seed now begins 72-hour background precomputation immediately. Generated 30-minute frames can be retrieved progressively, nearby frames are prefetched into a bounded local cache, timeline steps use a lightweight render refresh, renderer resizing occurs only when dimensions change, and persistence is debounced. Live evolution remains available as a fallback when the requested future frame has not finished generating.


## 2.28.2 Storm Lifecycle & Evolution
Storms now evolve through explicit phases with mesocyclone cycles, hazard memory, cold-pool/interactions, merger boosts, and inflow competition.

## 2.28.3 Tornado Verification Correction

Tornado verification now uses actual tornado track positions created within each truth-sampling interval. Historical tornado occurrence no longer follows the parent storm after the tornado has lifted. This patch intentionally leaves forecast probabilities unchanged so calibration can be reassessed against corrected truth.


## 2.28.5 — Outlook Synthesis Rewrite

- Preserves finalized tornado, hail, wind, and CIG probability fields.
- Treats probability-to-category conversion as a ceiling rather than the final issued category.
- Synthesizes categorical risk from hazard strength, initiation/coverage, persistence, active-storm support, hazard overlap, confidence, and multi-hazard agreement.
- Applies connected-component continuity requirements to Marginal through High risk.
- Prevents a domain-wide 2% tornado floor from automatically producing domain-wide Marginal risk.
- Requires coherent ENH+ and multi-hazard or strong-tornado support for Moderate and High risk.
- Stores synthesis diagnostics and raw/gated/final category counts in each outlook product.


## 2.28.7 Atmosphere-Authoritative Forecasting

Predictive outlooks now consume hazard, initiation, coverage, and CIG diagnostics from the generated atmosphere. Synthetic CAPE/SRH recovery, initiation and coverage floors, analog hazard weighting, prior-cycle hazard persistence, and upward 80% probability quantization are no longer used to create outlook risk. Analogs remain upstream in active-pattern and atmospheric generation only.

### Validation performed

- Module import test: passed.
- Predictive outlook cycle test: passed.
- Outlook synthesis test: passed.
- Full legacy test suite was started but did not complete within the available execution window during the storm-engine test.
- Full 24-hour seed verification runs should be rerun locally for seeds 51566832, 54960592, 67397432, and 72776780.


## 2.34.2.2 targeted SPC acquisition

`fetch:spc-outlooks` now uses date-targeted product discovery by default, avoiding slow annual archive listings. Use `--discovery annual` only for completeness audits or broad archive reconciliation.
