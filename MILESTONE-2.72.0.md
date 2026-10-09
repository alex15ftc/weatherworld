# WeatherWorld 2.72.0 — Engine Contracts, Performance, and Realism Foundations

This update makes engine boundaries measurable and prepares deeper physical calibration
without rewriting established seeded behavior in one step.

## Included

- A canonical storm-mode registry shared by production code and regression tests.
- Central application, API, physics, state-schema, and tile metadata.
- Current release metadata in authority and performance API responses.
- Profile-specific analog audit cadences; integrity enforcement remains at the
  atmospheric cadence until diagnosis and correction are separated.
- Atmospheric revision counters and per-phase work-unit telemetry.
- Explicit integrity-correction ownership and cause counts.
- Multi-regime fixtures for Plains dryline, Dixie high-shear/low-CAPE, progressive
  QLCS, elevated nocturnal, and pulse regimes.

## Staged follow-ups

- Move dense timeline state to typed buffers, keyframes, and deltas.
- Split outlook issuance, projection, topology, and serialization responsibilities.
- Split verification truth capture, matching, scoring, and reporting.
- Derive analog expectation distributions from the historical corpus.
- Expand realism validation to multi-seed reliability and climatological distributions.
- Separate integrity diagnosis from optional constraint application.

## Validation

```powershell
npm run test:2.72.0
npm test
```
