# Milestone 2.37.2 — Corpus Diagnostics and Repair Planning

This incremental update adds per-case corpus diagnostics and repair planning.

## Changes

- Paired cases now include `missing` component names and a baseline quality score.
- Spatial tensor availability is included in per-case diagnostics.
- `training:diagnose` lists every partial date, its quality, and missing components.
- `training:validate` distinguishes integrity validity from corpus coverage completeness.
- `training:repair` refreshes pairing/status manifests and prints targeted acquisition commands.
- Added regression coverage for paired-case quality and missing-component metadata.

## Commands

```bash
npm run training:diagnose
npm run training:validate
npm run training:repair
npm run test:2.37.2
```
