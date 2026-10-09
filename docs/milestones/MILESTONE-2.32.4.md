# Milestone 2.32.4 — Verification truth and balanced hazards

This revision repairs deterministic seed verification and improves hail/wind
representation without weakening the simulator's aggressive tornado climatology.

## Verification repairs

- Initiation truth now comes from actual storm births. Storms moving into a new
  grid cell no longer count as new initiation.
- Hail truth requires measured hail size of at least one inch.
- Wind truth requires a measured gust of at least 58 mph.
- Convective-day event summaries use 12Z–12Z windows.
- Spatial diagnostics use the actual grid dimensions and cell spacing.
- Seed provenance is retained in issued forecast cycle IDs.
- Simulation timing no longer subtracts initialization truth-capture time.
- Partial final timesteps no longer overshoot the requested duration.
- CLI inputs are validated, the default run is 24 hours, and terminal output is
  a concise summary unless a JSON output path is supplied.
- Deterministic spatial-density tiers are explicitly identified as something
  different from ensemble probability calibration.

## Model calibration

- Linear storms receive stronger cold-pool/forcing contributions to realized
  severe gusts.
- Supercell hail realization includes the diagnosed updraft, instability, and
  shear environment rather than relying only on a small internal hail field.
- Outlook hail and wind opportunity are strengthened.
- Repeated source-corridor initiation opportunities are converted into a valid-
  period probability within outlook analysis only. This does not spawn storms.
- Tornado genesis thresholds and tornado opportunity were not reduced.

## Representative result

For seed 306, tornadoes remain unchanged at 38 from 43 storms. Mean forecast
initiation probability rises from 1.7% to 7.3%, a 5% hail area is introduced,
and the Day-1 verification score improves from 48.6 to 51.0.

True probability reliability still requires a multi-member ensemble; a single
deterministic seed can verify placement and occurrence but not event frequency.
