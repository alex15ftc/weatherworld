# Weather World 2.41.1 — Fictional-World Seed-to-Grid Synthesis

This milestone combines the proposed 2.41.0.3 analog contribution diagnostics with initial seed-to-grid atmospheric synthesis.

## Scope isolation

The new grid generator is an offline/explicit command and does **not** replace or modify the live outlook-generation pipeline. Existing Day 1–3 outlooks continue to use the current authoritative scenario/evolution engine. A later integration milestone can opt the live authority into generated seed grids after the expanded analog corpus is calibrated.

## Commands

```bash
npm run training:seed-grid -- --seed 824591
npm run test:2.41.0.3
npm run test:2.41.1
```

## Fictional geography

Historical analogs provide atmospheric ranges and relationships only. Synoptic anchors and fields are transformed into Weather World's normalized fictional-map coordinates and respond to its fixed regional/elevation framework.
