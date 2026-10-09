# WeatherWorld 2.69.0 — Air-Mass-First Atmosphere and Early Outlook Restoration

- Gameplay startup now issues a compact but complete Day 1 forecast from six forecast checkpoints.
- Day 1 issuance is gated on thermodynamic, corridor, and diagnostic readiness; missing inputs no longer silently become TSTM.
- Cells retain normalized authoritative air-mass fractions used by the forecast projection.
- Surface-based forecast potential is reduced in dry and cold air masses while elevated support remains separate.
- Day 2, Day 3, full ensembles, and detailed verification remain deferred for performance.
- The next scheduled Day 1 cycle replaces the startup trajectory product with the full gameplay ensemble.
