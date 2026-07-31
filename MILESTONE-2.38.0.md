# Milestone 2.38.0 — Dual Forecast and Event Training Corpora

Weather World now distinguishes two supervised datasets built from the same paired case manifests.

## Event corpus

Trains atmosphere-to-observed-outcome relationships. ERA5 atmosphere and NOAA Storm Events outcomes are required. Archived SPC outlooks are optional, allowing historical events from eras without modern digital outlook products to remain usable.

## Forecast corpus

Trains atmosphere-to-official-forecast relationships. A valid SPC target, ERA5 atmosphere, a spatial ERA5 tensor, and NOAA outcomes are required. Only cases with an SPC target are considered forecast-eligible.

## Commands

- `npm run training:pair` rebuilds dual membership metadata.
- `npm run training:diagnose` reports event readiness and forecast readiness independently.
- `npm run training:validate` validates both corpora without treating absent historical SPC targets as integrity failures.
- `npm run training:repair` prints source-specific ERA5 and NOAA acquisition commands.
