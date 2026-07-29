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
