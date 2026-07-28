# Historical Data Architecture

## Dataset roles
Historical information is stored as three independent evidence streams:

- ERA5 or equivalent reanalysis: the atmosphere that occurred.
- SPC outlooks: the forecast that was issued.
- NOAA observations: the weather that was reported or verified.

These streams are joined by event and issuance identifiers, but they remain semantically separate.

## Canonical record
Each record should contain:
- Event identifier and valid window.
- Product issuance time and lead time.
- Atmospheric features available at issuance.
- Original and normalized SPC products.
- Normalized gridded observations.
- Provenance, source version and processing version.

## Analog roles
- Scenario analogs may use an explicitly requested gameplay intensity band to synthesize an interesting world.
- Forecast analogs use atmospheric features only.
- Outlooks and reports are targets for calibration and verification, not hidden forecast inputs.

## Storage policy
Raw ERA5, NOAA and SPC archives are not committed to Git. Git tracks download scripts, manifests, checksums, schemas, compact fixtures and deterministic build scripts.

## Temporal coverage
Important cases should eventually use at least three-hourly data from the previous day through the following day so that moisture return, cap evolution, forcing and nocturnal transitions are represented.
