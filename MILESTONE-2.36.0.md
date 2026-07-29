# Weather World 2.36.0 — Training Corpus Foundation

Version 2.36.0 removes the historical-viewer architecture and makes historical source data an internal training corpus for the procedural atmosphere and outlook engines.

## Canonical layout

```text
training/
  catalog/              compact indexes, progress, and statistics
  targets/spc/          normalized SPC outlook targets
  atmospheric/era5/     compact ERA5-derived atmospheric summaries
  atmospheric/noaa/     compact NOAA severe-weather outcomes
  paired/               joined simulator-training cases
  validation/           disposable validation reports
```

Raw downloads do not belong in the repository. They use the external cache selected by `WEATHERWORLD_TRAINING_CACHE`, defaulting to `~/WeatherWorldTrainingCache`.

## Commands

```bash
npm run training:init
npm run training:validate-targets
npm run training:pair
npm run training:prepare
npm run training:status
npm run training:populate-targets -- --dates 2011-04-27
```

The old mandatory rasterization, historical case builder, duplicate case archive, and historical viewer pipeline have been removed.
