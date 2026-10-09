# Weather World 2.41.0 — Atmosphere-First Seed Generator

## Purpose

2.41.0 introduces deterministic world seeds as an input to the historical training and analog stack. A seed now creates a coherent latent atmospheric narrative, a complete normalized feature record, a validated raw atmospheric feature state, and an attached historical analog report.

## Command

```bash
npm run training:seed -- --seed 824591
```

Optional controls:

```bash
npm run training:seed -- --seed 824591 --season late-spring --region central-plains --top 10
npm run training:seed -- --seed 824591 --json --no-write
npm run training:seed -- --seed 824591 --no-analogs
```

## Determinism

The same seed, feature normalization dataset, and generator version produce the same atmospheric inputs and latent state. Generated timestamps and output paths are metadata and are not part of deterministic meteorology.

## Architecture

1. Seeded deterministic PRNG
2. Seasonal and regional climate state
3. Correlated instability, moisture, dynamics, cap, forcing, and spatial-organization latent variables
4. Corpus-normalized atmospheric feature generation
5. Physical and structural validation
6. Historical analog retrieval using atmosphere-only features
7. Human-readable atmospheric narrative

## Important boundary

This milestone generates the atmospheric feature representation used by the training and analog systems. It does not yet rasterize a full simulation grid or replace the existing live scenario generator. Grid-field synthesis and integration with the runtime simulation are planned for 2.41.1 and 2.42.0.
