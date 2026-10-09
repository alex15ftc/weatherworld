# Milestone 2.46.0 — Spatial Verification Framework

WeatherWorld now evaluates whether forecast risk and hazards occur in the correct location, not only whether their maximum category is correct.

## Metrics

- At-least-category contour intersection-over-union for TSTM through HIGH.
- Forecast and observed contour centroids with displacement in miles.
- Probability of detection, false-alarm ratio, and forecast/observed area ratio.
- Tornado, hail, and wind probability-contour overlap at operationally meaningful thresholds.
- Full probability-field MAE and RMSE.
- Convective-initiation corridor overlap and displacement.
- Existing event-to-adequate-risk and tornado-track placement diagnostics remain available.

## Calibration role

Spatial skill contributes 20% of benchmark score. Final maximum outlook category remains 5%, preventing a correctly named but geographically misplaced risk from receiving a strong grade.

Short verification runs with no fully scored product retain an unscored neutral spatial value. Use 72-hour audits for final Day 1 spatial-outlook calibration.
