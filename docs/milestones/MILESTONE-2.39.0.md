# Weather World 2.39.0 — Analog Feature Dataset Foundation

This milestone converts each historical ERA5 case into a stable numerical representation for future atmosphere-only analog retrieval.

## Commands

```bash
npm run training:features
npm run training:features:validate
npm run training:features:status
npm run test:2.39.0
```

## Outputs

- `training/features/records/YYYY-MM-DD.json` — raw and normalized atmospheric inputs, separately stored labels, quality, and provenance.
- `training/features/index.json` — compact feature-record catalog.
- `training/features/normalization.json` — corpus-wide population z-score statistics and percentiles.

## Leakage boundary

`inputs` contains ERA5-derived atmospheric information only. NOAA outcomes and SPC targets live under `labels` and are never included in the similarity vector.

## Spatial scope

2.39.0 derives spatial-distribution proxies from the ERA5 summary percentiles and records whether the full tensor is available. Direct NPZ tensor morphology (axis orientation, connected corridors, and feature placement) is reserved for 2.39.1 so the initial feature format remains portable and can be generated without loading multi-gigabyte external caches.
