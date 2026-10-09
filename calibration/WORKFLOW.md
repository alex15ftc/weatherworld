# Generate → Critique → Calibrate workflow

1. Generate or select deterministic seeds with the existing scenario generator.
2. Run `npm run calibrate:audit -- --start 100000 --count 25 --hours 18` to measure long-run consistency and risk frequencies.
3. Run `npm run calibrate:suite -- --split calibration` after any engine change.
4. Tune only against calibration cases. Use validation cases to choose between changes, and never tune directly against holdout cases.
5. Inspect `aggregate.biasSignals`, member `critic.flags`, and environmental component scores in `calibration/reports/`.
6. Change one physical coupling at a time in the existing engine, document the hypothesis, then rerun the same seed set.
7. Accept a change only when calibration improves without materially degrading validation, holdout, or long-run climatology.

The critic does not replace the simulator. It consumes the existing verification truth, six-hour environmental samples, storms, and outlook products.

## Spatial verification (2.46.0)

Fully scored forecast products now include `spatialVerification` with:

- `categoricalContours`: at-least-category IoU, detection, false alarms, area ratio, and centroid displacement.
- `hazards`: tornado, hail, and wind probability-field error plus contour metrics.
- `initiation`: forecast initiation-corridor overlap and displacement.
- `summary.spatialScore`: 70% contour overlap and 30% displacement skill.

Spatial skill is only meaningful when a forecast product has a complete truth window. Use 72-hour audits for final Day 1 spatial calibration:

```bash
npm run calibrate:audit -- --start 100000 --count 25 --hours 72
```

Inspect each member's `critic.spatialProduct` and the aggregate `meanSpatialScore`. Reuse the same seed range when comparing engine changes.
