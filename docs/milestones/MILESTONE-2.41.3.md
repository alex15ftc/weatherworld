# Weather World 2.41.3 — Unified Archive Finalization

The SLGT+ archive population command now continues through validation, pairing, feature and normalization rebuilds, a master case catalog, and data-derived analog calibration. When the command finishes successfully, `training/ready.json` marks the corpus as seed-ready.

## One command

```bash
npm run training:populate-slgt-plus -- \
  --start 2000-01-01 \
  --cache-root "C:\\Users\\alex1\\WeatherWorldTrainingCache" \
  --python "C:\\Users\\alex1\\anaconda3\\python.exe"
```

After completion, generate seeds directly:

```bash
npm run training:seed -- --seed 824591
```

The finalizer can also be rerun without downloading data:

```bash
npm run training:finalize -- \
  --cache-root "C:\\Users\\alex1\\WeatherWorldTrainingCache" \
  --python "C:\\Users\\alex1\\anaconda3\\python.exe"
```

Outputs include `training/catalog/master-cases.json`, `training/analogs/calibration.json`, and `training/ready.json`. Analog retrieval and seed generation automatically use the generated group weights and confidence thresholds.
