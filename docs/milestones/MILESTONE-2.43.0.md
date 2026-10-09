# Milestone 2.43.0 — Benchmark and Calibration Framework

WeatherWorld now treats simulator improvement as constrained calibration of a procedural atmosphere rather than bulk archival or black-box category prediction.

## Added

- Versioned calibration case schema and starter corpus.
- Calibration, validation, and holdout splits.
- Required negative-control and failed-initiation cases.
- Central parameter and objective-weight configuration.
- Deterministic ensemble case runner and JSON reports.
- Commands for corpus validation, coverage status, individual cases, and suites.

## Removed

- Bundled raw/normalized SPC downloads.
- Generated historical validation products and old archive manifests.
- Empty training/archive directories and obsolete population commands.
- Archived radar copy and stray patch/artifact files.

## Next

Add 25–50 curated cases with compact atmospheric checkpoints and provenance. Do not restore a bulk all-date archive until the benchmark runner can score those fields.
