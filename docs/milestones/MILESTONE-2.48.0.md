# Milestone 2.48.0 — Mesoscale Forcing Corridors

This milestone makes convective initiation corridor-driven rather than treating neighboring grid-cell maxima as unrelated storm sources.

## Changes

- Assigns each initiation candidate to an authoritative boundary, outflow, or broad forcing corridor.
- Combines boundary convergence, boundary influence, mesoscale focus, trigger strength, ascent, and outflow support into a coherent corridor-strength signal.
- Limits births per corridor and initiation cycle.
- Adds corridor cooldowns and scenario-aware daily initiation budgets.
- Preserves secondary outflow initiation with shorter cooldowns.
- Records each storm's source corridor, boundary type, and forcing components.
- Adds verification summaries for unique corridors and boundary-rooted initiation fraction.
- Adds `EXCESSIVE_STORM_BIRTHS` and `INITIATION_CORRIDOR_COLLAPSE` critic flags.
- Reports an unscored environment aggregate as `null` instead of a misleading zero.
