# Weather World 2.41.0.2 — Analog Retrieval Feature Hygiene

This corrective milestone removes non-meteorological availability flags and duplicated raw timing indexes from atmospheric analog distance calculations.

## Retrieval exclusions

The analog engine no longer uses:

- `spatial.spatialTensorAvailable`
- `spatialDirect.spatialTensorRead`
- `spatialDirect.peakTimeIndex`
- numeric fields whose names end in `available`, `read`, `complete`, or `completeness`

These values may remain in records as quality/provenance diagnostics, but they do not affect Euclidean, cosine, Mahalanobis, group-level, strongest-match, or largest-difference calculations. `spatialDirect.peakTimeFraction` remains the canonical portable timing feature.

## Reporting

Group similarities are always displayed in meteorological order:

1. thermodynamics
2. wind profile
3. synoptic
4. spatial summary
5. direct spatial

## Regression

```bash
npm run test:2.41.0.2
```
