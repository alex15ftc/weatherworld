# Next-generation weather core

The implementation under `js/core/` is the new simulation boundary described
by `newarchitecture.md`.

The pipeline is:

`ScenarioEngine` → `AnalogMatcher` → `ForecastEnsemble` → `EnvironmentalGrid`
→ `FeatureProjector` → probabilistic initiation → stateful storms → compact
snapshots.

Important invariants:

- A seeded scenario owns the causal weather story.
- Forecast members may read that scenario, but never future storm objects.
- The authoritative grid uses typed arrays and defaults to 100 × 100 cells at
  10 km spacing.
- Environmental potential, storm opportunity, and realization probability are
  distinct values.
- Synoptic, mesoscale, storm, visual, and outlook work run on independent
  clocks.
- Only active regions evaluate initiation at storm cadence.
- Storms consume instability and moisture and leave stabilization/cold-pool
  fields behind.
- Snapshots contain storm-level state, never particles or radar pixels.

## Compatibility

The existing `Atmosphere`, product renderer, and browser pages remain intact
while they are migrated to consume `WeatherSimulationCore.snapshot()`. This
keeps the current product API stable and gives the new core a testable boundary
instead of embedding another generation of rules into the legacy cell model.

Run `npm run test:next-core` for the architectural contract.
