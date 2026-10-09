# Milestone 2.32.5 — Tornado-track outlook verification

This revision distinguishes forecasting the correct event magnitude from placing
the highest tornado risk where tornado paths actually occur. It changes
verification only; it does not alter atmosphere generation, storm evolution,
tornado genesis, or outlook production.

## What is verified

- Tornado truth retains storm ID, position, valid time, and EF rating at each
  sampled track point.
- Track exposure reports the path-length fraction in every tornado and overall
  risk category.
- Contour capture reports the path-length fraction inside the 2%, 5%, 10%, 15%,
  and 30% tornado contours.
- Intensity-weighted capture gives stronger tornadoes more influence without
  changing their generation.
- Bullseye hit rate measures the fraction of tornadoes entering the forecast's
  maximum tornado-risk area.
- Core utilization measures how much of that maximum-risk area lies within 25
  miles of a tornado path.
- Median and 90th-percentile displacement report how far tracks fall outside
  each probability contour.

## Scoring

Each product now exposes separate magnitude, track-placement, and combined
scores. The combined score is 65% magnitude and 35% placement when tornado
tracks exist. A broad low-end contour cannot fully verify a displaced MDT or
HIGH bullseye: the forecast's maximum tornado tier selects its expected core
contour (ENH 10%, MDT 15%, HIGH 30%) for core-capture and displacement credit.

This separation is important when an outlook correctly predicts a major event
but places its highest category away from the eventual tornado corridor.

## Representative 24-hour runs

| Seed | Forecast / observed | Tornadoes | Magnitude | Placement | Key finding |
|---|---:|---:|---:|---:|---|
| 306 | HIGH / HIGH | 38 | 51.0 | 54.3 | 77.8% of tornadoes enter the HIGH core, but only 18.7% of intensity-weighted path mileage is captured by the 30% contour. |
| 25 | MDT / HIGH | 7 | 54.1 | 30.3 | No tornado enters the MDT core; 98.2% of track mileage falls in SLGT or ENH. |

The generated reports are:

- `verification-runs/seed-306-24h-2.32.5.json`
- `verification-runs/seed-25-24h-2.32.5.json`

These deterministic cases diagnose spatial placement. Probability reliability
and category-frequency calibration still require a large multi-seed sample.
