# Weather World 2.40.0 — Historical Analog Retrieval Engine

This milestone turns the standardized 2.39.x atmospheric feature corpus into an explainable historical analog search system.

## Commands

```bash
npm run training:analogs -- --date 2024-05-06
npm run training:analogs -- --date 2024-05-06 --top 10 --role event
npm run training:analogs -- --date 2024-05-06 --role forecast --json
npm run training:analogs -- --record path/to/external-feature-record.json
npm run test:2.40.0
```

## Retrieval behavior

- Uses normalized atmospheric inputs only; NOAA outcomes and SPC targets are never similarity inputs.
- Combines weighted Euclidean, cosine, and diagonal-Mahalanobis similarity.
- Applies explicit feature-group weights for thermodynamics, wind profile, synoptic state, summary spatial structure, and direct tensor diagnostics.
- Applies a small candidate-quality adjustment without allowing labels to affect retrieval.
- Supports event, forecast, or all-corpus searches.
- Excludes the query date from its own result set.

## Explainability

Every result includes:

- overall and component similarity metrics;
- group-level similarities;
- strongest-matching atmospheric features;
- largest atmospheric differences;
- quality score and corpus roles;
- a deterministic synoptic-pattern description;
- labels attached only after retrieval for inspection.

Reports are written to `training/analogs/reports/` unless `--no-write` is supplied.
