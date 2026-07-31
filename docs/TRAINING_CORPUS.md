# Simulator Training Corpus

The Weather World corpus exists only to train and calibrate procedurally generated severe-weather scenarios and their synthetic SPC-style outlooks.

SPC polygons are forecast targets. ERA5 and NOAA-derived records are atmospheric inputs and observed outcomes. No historical viewer or rasterized outlook grid is required.

Raw GRIB, NetCDF, ZIP, and bulk NOAA files must remain in an external cache. Set it before acquisition:

```bash
# Git Bash / Linux / macOS
export WEATHERWORLD_TRAINING_CACHE="$HOME/WeatherWorldTrainingCache"

# PowerShell
$env:WEATHERWORLD_TRAINING_CACHE="$HOME\WeatherWorldTrainingCache"
```

Initialize and inspect the corpus:

```bash
npm run training:init
npm run training:status
```

Prepare compact paired records:

```bash
npm run training:prepare
```

## Spatial ERA5 cases (2.37.0)

Acquisition now writes compressed spatial tensors to the external cache:

```text
$WEATHERWORLD_TRAINING_CACHE/era5/spatial/YYYY-MM-DD/atmosphere.npz
```

Compact manifests are written to:

```text
training/atmospheric/era5/spatial/YYYY-MM-DD.json
```

The tensor retains eight 3-hour snapshots, a standardized 100×100 latitude/longitude grid, all requested surface and pressure-level channels, and initial derived diagnostic maps. The 100×100 grid is a simulator interface—not a claim that ERA5 contains native 10 km detail.

Validate the spatial corpus with:

```bash
npm run training:spatial-status
npm run training:validate-spatial
npm run training:validate-spatial -- --checksum
```
