# Milestone 2.34.0 — Historical SPC Outlook Foundation

## Implemented

- Added `docs/ROADMAP.md` as the authoritative project roadmap.
- Added an issuance-aware canonical historical forecast-record schema.
- Added explicit original-versus-normalized SPC product storage.
- Added structured source and processing provenance.
- Added an atmosphere-only forecast analog selector that returns redacted records.
- Removed historical outcome intensity and intensity residuals from the forecast ensemble realization calculation.
- Kept outcome-targeted analog selection only in scenario generation, where it is marked generation-only.
- Added regression tests proving forecast analog selection cannot read or return outcome labels.

## Causality contract

Scenario generation may request an outcome band to build a desired gameplay seed. Forecast production may consume only atmospheric pattern information available at issuance. Historical intensity, reports, observations, and future outlook cycles are labels used later for verification, never forecast predictors.
