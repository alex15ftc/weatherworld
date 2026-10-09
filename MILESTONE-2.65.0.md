# WeatherWorld 2.65.0 — Forecast Confidence Engine

Introduces an explicit confidence layer between forecast storm ensembles and issued outlook probabilities.

- Separates hazard potential from confidence.
- Scores initiation, maintenance, track, timing, hazard, corridor, synoptic, and mesoscale confidence.
- Measures member agreement and corridor concentration rather than occurrence alone.
- Propagates synoptic and mesoscale uncertainty into storm and outlook confidence.
- Applies stronger confidence penalties to high-tier probabilities than to low-tier uncertainty envelopes.
- Preserves per-cell confidence telemetry and product-level diagnostics.
- Provides reliability-adjustment hooks for later self-calibration against archived verification.
