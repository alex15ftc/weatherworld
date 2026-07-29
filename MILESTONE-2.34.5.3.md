# Milestone 2.34.5.3 — High-Performance Historical Population

This milestone accelerates the canonical SPC archive population workflow without changing its archive layout.

## Changes

- Acquisition jobs run concurrently across dates.
- Normalization jobs run concurrently after acquisition completes.
- Rasterization and case construction use a configurable worker pool.
- `historical:build` is genuinely incremental; `build` no longer forces every raster and case to be rewritten.
- The catalog is written once after all case work finishes.
- Existing raw, normalized, rasterized, and case artifacts are reused unless their source or pipeline version changes.
- Progress output includes completed jobs, elapsed time, and estimated remaining time.
- Population and pipeline reports include elapsed time and concurrency settings.
- `--force` remains available for explicit full regeneration.

## Recommended command

```powershell
npm run historical:populate -- `
  --manifest archive/manifests/validation-batch-01.json `
  --download-concurrency 4 `
  --normalize-concurrency 4 `
  --pipeline-concurrency 4
```

Increase the three concurrency values gradually. Four is the conservative default. On an eight-core desktop, `--pipeline-concurrency 6` is a reasonable next test. Avoid excessive download concurrency against NOAA/SPC services.

## Resume behavior

Rerun the same command after an interruption. Cached downloads are reused, normalized products are reparsed only by the normalization stage, and unchanged raster/case outputs are skipped by the incremental build. Use `--force` only when the source data or parser output must be regenerated deliberately.
