# Weather World 2.35.1 — Historical Target Validation and Pairing

This milestone keeps the historical subsystem focused on backend training data.

## Changes

- Validates SPC issuance timestamps and validity windows across original, parsed, and normalized source layers.
- Validates supported categorical and probabilistic hazard levels.
- Requires the core Day 1 categorical, tornado, wind, and hail targets.
- Stores compact hazard-level and maximum-risk summaries in the training catalog.
- Pairs all SPC issuances for an event date with the existing ERA5-derived atmospheric summary and NOAA Storm Events outcome record.
- Classifies paired cases as `complete` or `partial`; missing source data is explicit rather than synthesized.
- Does not restore rasterization or the historical viewer.

## Commands

```bash
npm run historical:prepare-training
npm run test:2.35.1
```

Output:

```text
data/historical/catalog/training-corpus.json
data/historical/catalog/paired-training-cases.json
```
