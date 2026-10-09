# WeatherWorld 2.68.0 — Runtime Consolidation and Performance Reset

## Purpose

2.68.0 separates the fast gameplay runtime from calibration-grade verification. Normal seed creation now builds only the authoritative initial atmosphere and deterministic analysis; ensemble outlooks and long timeline work are deferred to the background worker.

## Changes

- Added explicit `gameplay`, `benchmark`, and `calibration` runtime profiles.
- Deferred Day 1 ensemble generation from the synchronous seed path; Day 2 and Day 3 remain scheduled products instead of startup requirements.
- Changed background timeline precomputation to hourly authoritative frames rather than 144 half-hour full-world solves.
- Reduced gameplay full-profile thermodynamic recomputation to a two-hour cadence while keeping surface and boundary evolution active each step.
- Reduced gameplay storm internal cadence from five to ten minutes; calibration retains five-minute updates.
- Reduced gameplay forecast ensembles to 4/6/8 members and background benchmark ensembles to 3/4/6; calibration retains 8/12/16.
- Removed duplicate post-storm full-grid sounding recalculation from gameplay. Calibration still performs the complete feedback diagnostics.
- Added compact timeline serialization that omits cached vertical profiles, old product archives, and transient spatial indexes.
- Strengthened initiation gating around coherent corridors, valid air masses, and persistent support.
- Added performance and phase-skip telemetry plus a runtime regression test.

## Runtime expectations

- Synchronous 50×50 seed initialization should complete in under five seconds on the test environment and is typically near one second.
- Long timeline and ensemble generation occurs in a worker and no longer blocks the initial map.
- Calibration mode remains intentionally slower and preserves detailed histories and full ensemble sizes.
