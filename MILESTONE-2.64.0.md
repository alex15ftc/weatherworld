# Milestone 2.64.0 — Dynamic Synoptic Reconciliation

Version 2.64.0 adds one authoritative hourly reconciliation stage between atmospheric prediction and mesoscale/storm processing.

The solver jointly reconciles the surface low, pressure minimum, low-level wind curvature, fronts, attachment topology, warm-sector geometry, and upper-level support. It performs two to five bounded passes, rolls back worsening passes, retains the best state, and records a compact hourly reconciliation history.

## New state

- `synopticObjects.reconciliation`
- `synopticObjects.reconciliationHistory`
- reconciled `alignment.surfaceLowFieldErrorKm`
- reconciled front residual diagnostics
- confidence and atmospheric-consistency values derived from the finalized state

## Ordering

Atmosphere and object prediction → coupled and kinematic updates → dynamic reconciliation → warm-sector projection → mesoscale processing → storms → outlooks.

## Validation

Run:

```bash
npm run test:2.64.0
npm run test:2.55.0
npm run test:2.56.0
npm run test:imports
```
