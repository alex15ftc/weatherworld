# Weather World 2.36.1 — ERA5 and NOAA Acquisition Manager

This milestone adds resumable, status-tracked acquisition for the backend training corpus.

## Commands

```bash
npm run training:acquire -- --missing-only
npm run training:acquire-era5 -- --dates 2020-08-10,2024-05-06
npm run training:acquire-noaa -- --dates 2020-08-10,2024-05-06
npm run training:resume
```

Append `--dry-run` to inspect the queue without downloading anything. Raw ERA5 and NOAA bulk files stay beneath `WEATHERWORLD_TRAINING_CACHE`; compact per-date records are written to `training/atmospheric/*/records`.

## ERA5 prerequisites

- Accepted CDS terms for pressure-level and single-level ERA5 datasets.
- `~/.cdsapirc` or `CDSAPI_KEY`.
- Python packages: `cdsapi`, `xarray`, `cfgrib`, `eccodes`, and `numpy`.

The downloader requests a severe-weather profile at three-hour intervals and creates checksummed compact records. It never marks extraction complete unless a compact JSON record is actually written.

## NOAA behavior

The NOAA manager caches one current Storm Events details archive per required year, extracts only requested dates, normalizes tornado/hail/wind reports, removes duplicate event IDs, and writes source checksums.

## State model

Each date is tracked through `missing`, `queued`, `downloading`, `downloaded`, `extracting`, `complete`, `warning`, or `failed`. `training/catalog/acquisition.json` is written atomically and retains recent failure messages for safe resume.
