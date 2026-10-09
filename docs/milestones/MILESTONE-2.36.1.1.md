# Milestone 2.36.1.1 — ERA5 Decoder Repair

This patch repairs ERA5 extraction after successful CDS downloads.

## Changes

- Replaced the invalid `xarray.open_datasets()` call.
- Opens each GRIB variable explicitly through `xarray.open_dataset()` and `cfgrib` filters.
- Separates pressure-level fields by GRIB short name and extracts every requested pressure level.
- Separates single-level fields by GRIB short name.
- Disables persistent cfgrib index files for temporary acquisition products.
- Reports the exact missing field names when decoding is incomplete.
- Keeps downloaded GRIB files after any extraction failure so `training:resume` can retry without re-downloading.
- Deletes raw files only after the compact JSON record is written successfully, unless `--keep-raw` is supplied.

## Recovery

After replacing the previous repository with this patch, rerun:

```bash
npm run training:resume
```

The already-downloaded 2020-08-10 GRIB files should be reused from the external cache.
