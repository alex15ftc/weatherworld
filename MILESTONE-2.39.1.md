# Weather World 2.39.1 — Direct Spatial Feature Diagnostics

This milestone upgrades analog feature extraction from distribution proxies to direct analysis of the ERA5 spatial tensors.

## Added

- Direct NPZ tensor extraction through `scripts/extract-era5-spatial-features.py`.
- CAPE corridor centroid, orientation, elongation, threshold coverage, and connected-region concentration.
- Moisture-axis centroid, orientation, and elongation.
- 250 mb jet-core placement, orientation, elongation, and p90 wind speed.
- Direct forcing/instability and moisture-transport/instability overlap metrics.
- Dewpoint, pressure, and precipitable-water gradient diagnostics.
- Peak convective time index and normalized peak-time fraction.
- Spatial extraction status and diagnostics in every analog feature record.
- `training/features/spatial-diagnostics.json` batch output.
- `test:2.39.1` regression coverage with a synthetic ERA5 tensor.

## Commands

```bash
npm run training:features -- --cache-root "C:\\Users\\alex1\\WeatherWorldTrainingCache"
npm run training:features:validate
npm run test:2.39.1
```

The default cache remains `%USERPROFILE%\\WeatherWorldTrainingCache`; `--cache-root` is only needed for a custom location.
