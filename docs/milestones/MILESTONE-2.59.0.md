# WeatherWorld 2.59.0 — Probability Calibration and Spatial Optimization

This release calibrates the 2.58.0 ensemble rather than adding another atmospheric system.

## Changes

- Quality-weighted ensemble members using perturbation coherence, candidate support, and hazard attribution.
- Spatial consensus weighting that reduces the influence of displaced member swaths.
- Agreement-core, plausible-envelope, and outlier classification per hazard and cell.
- Separate storm-occurrence, conditional-hazard, and unconditional-hazard probabilities.
- Hazard-specific probability calibration and minimum support gates for higher tiers.
- Dominant scenario-cluster support and effective ensemble sample-size diagnostics.
- Reduced deterministic background contribution so ensemble disagreement cannot preserve broad risk fields.
- Deterministic member generation remains reproducible from world seed, issue time, day, and member index.

## Validation

Run:

```bash
npm run test:2.59.0
npm run test:2.58.0
npm run test:2.57.0
npm run calibrate:audit -- --start 100000 --count 5 --hours 24
npm run calibrate:audit -- --start 200000 --count 5 --hours 24
```
