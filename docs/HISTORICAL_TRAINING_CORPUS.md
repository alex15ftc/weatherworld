# Historical training corpus

Weather World's historical data is backend training material, not a player-facing archive viewer.

## Purpose

NOAA and ERA5 data describe the atmospheric environment and observed severe-weather outcome. SPC outlooks provide the forecast target paired to that environment. Together, these records train and calibrate the procedural atmosphere generator and outlook engine for fictional but physically plausible severe-weather days.

## Canonical layout

```text
data/historical/
  raw/spc/                 disposable acquisition cache
  normalized/spc/          canonical normalized SPC polygons
  validation/spc/          generated geometry/record reports
  catalog/training-corpus.json
  pipeline-manifest.json
  population-report.json
```

Normalized records are the source of truth. Raster grids and duplicated case files are not part of the training pipeline.

## Pipeline

```text
SPC acquisition -> normalization -> validation/catalog
```

Run:

```bash
npm run historical:populate -- --manifest archive/manifests/validation-batch-01.json
npm run historical:validate
```

The validator checks record structure, coordinate ranges, broad SPC geographic plausibility, contour counts, polygon counts, and source metadata. Invalid records are excluded from the usable count and produce reports under `data/historical/validation/spc`.

## Storage policy

Keep in source control only compact, reusable derived inputs. Do not commit downloads, rasterized grids, duplicated case payloads, population reports, validation reports, verification runs, or the full merged NOAA Storm Events CSV. These are reproducible caches or generated artifacts.
