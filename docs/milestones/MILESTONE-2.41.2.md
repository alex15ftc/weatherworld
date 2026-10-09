# Weather World 2.41.2 — Bulk Marginal-Plus Training Population

Adds one resumable command that discovers archived SPC Day 1 outlooks, selects every date with a categorical risk of MRGL or greater, validates SPC targets, downloads matching NOAA Storm Events and ERA5 atmospheres, pairs the corpus, and rebuilds the analog feature dataset.

The default common period begins at 2000-01-01. Before MRGL became an SPC category, SLGT-or-higher days still qualify because SLGT ranks above the requested MRGL threshold.

```bash
npm run training:populate-marginal-plus -- \
  --cache-root "C:\\Users\\alex1\\WeatherWorldTrainingCache" \
  --python "C:\\Users\\alex1\\anaconda3\\python.exe"
```

The workflow is intentionally resumable and stores large raw/spatial data outside the repository. Re-running the same command reuses cached SPC and NOAA files and asks the acquisition manager for missing ERA5/NOAA cases only.
