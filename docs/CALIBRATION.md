# Calibration and Verification

## Purpose
Calibration adjusts generated probabilities so their long-run frequencies and spatial behavior resemble historical forecasts and observations without leaking outcomes into individual forecasts.

## Verification units
Use gridded neighborhood fields for tornado, hail and wind rather than a single daily outbreak score. Preserve null days and weak events to prevent severe-event selection bias.

## Metrics
- Reliability by probability bin.
- Brier score and skill score.
- Spatial displacement and overlap.
- False-alarm and miss rates.
- Category frequency and transition behavior.
- Setup-stratified performance.
- Lead-time-specific performance.

## Calibration rules
- Calibrate by hazard and lead time.
- Maintain monotonic probabilities.
- Keep categorical risks dependent on hazard probabilities.
- Evaluate geometry separately from magnitude.
- Version every calibration artifact and record its training period.
