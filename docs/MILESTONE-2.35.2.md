# Weather World 2.35.2 — SPC Target Repair

This milestone repairs historical SPC shapefile interpretation for the training corpus.

## Fixes

- Classifies shapefile collections by their exact `_cat`, `_torn`, `_wind`, `_hail`, `_sigtorn`, `_sigwind`, and `_sighail` suffixes.
- Converts legacy categorical `DN` values to SPC categories.
- Prevents embedded `SIGN` features from being interpreted as ordinary 10% wind or hail probabilities.
- Treats absent tornado, wind, or hail layers as zero-probability training targets rather than invalid records.
- Keeps the categorical layer mandatory for Day 1 outlook records.

## Validation result

- 45 SPC issuance records scanned
- 42 valid
- 3 valid with warnings
- 0 invalid
- 0 processing failures

The three warnings are valid outlooks where one or more hazard layers are absent and therefore represent zero-probability targets.

## Pairing result

- 39 historical case dates
- 7 complete
- 32 partial
- 9 dates with SPC targets
- 37 dates with ERA5 summaries
- 37 dates with NOAA outcomes

ERA5 retrieval still requires the user's configured Copernicus CDS token. Raw ERA5 GRIB files and NOAA bulk download caches remain excluded from the repository.
