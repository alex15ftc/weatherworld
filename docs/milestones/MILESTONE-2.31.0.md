# Milestone 2.31.0 — Lifecycle-aware forecasts and storm populations

This revision makes outlook guidance follow the same evolving event lifecycle as
the simulated atmosphere. Forecast environments can now strengthen toward the
configured analog peak and weaken after it instead of inheriting optimistic
hazard and initiation floors.

## Changes

- Forecast CAPE, CIN, initiation, and hazard opportunity respond to the
  significant-event development, peak, and decay phases.
- Current diagnostics transition into projected diagnostics over the first six
  forecast hours; neighborhood guidance follows the same lifecycle trend.
- Post-peak initiation and hazard probabilities are allowed to decline.
- Repeated convective initiation is constrained by a setup-dependent active
  storm capacity (11–26 normally, 15–36 for significant-event modes).
- Capacity is checked before the expensive domain scan when the population is
  already saturated.

## Verification

Run `npm run test:2.31.0` for focused strengthening, weakening, and storm-capacity
coverage. Run `npm run test:regression-2.31.0` for the cumulative physics suite.
