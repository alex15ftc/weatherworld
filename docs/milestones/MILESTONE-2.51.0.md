# WeatherWorld 2.51.0 — Synoptic Evolution Engine

## Purpose
Make persistent synoptic objects evolve as interacting weather systems instead of fixed moving geometry.

## Changes
- Scenario-aware developing, mature, occluding, and decaying lifecycle phases.
- Shortwave/jet coupling modifies cyclone deepening, motion, and frontal evolution.
- Recharge requires fresh air, moisture, heating, cap release, and forcing; processed air suppresses recharge.
- Processed-air memory increases repeat-initiation cost and can block initiation in heavily worked-over air.
- Object-derived pressure, wind, moisture-transport, and convergence tendencies are exposed for staged downstream coupling.
- Surface-low and front lifecycle progress, velocity, object interactions, convective memory, and recharge attribution are included in verification reports.
- Synoptic-object state remains checkpoint-safe and deterministic.

## Verification
Run `npm run test:2.51.0` and compare the same calibration seeds with `npm run calibrate:audit -- --start 100000 --count 5 --hours 24`.
