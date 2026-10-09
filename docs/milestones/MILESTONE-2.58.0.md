# WeatherWorld 2.58.0 — Ensemble Forecast and Probabilistic Outlook Engine

## Summary

Version 2.58.0 replaces the single deterministic forecast-storm solution with a reproducible structured ensemble. Each member perturbs physically uncertain object placement, initiation, storm motion, longevity, mode, and hazard intensity without changing the authoritative realized atmosphere.

## Major changes

- Deterministic Day 1–3 ensemble member seeds derived from world seed, issue hour, forecast day, member index, and ensemble version.
- Correlated object-family displacement rather than independent grid-cell noise.
- Member-specific forecast storms, tracks, modes, lifetimes, and hazard swaths using the 2.57.0 projection engine.
- Neighborhood hazard probabilities based on member occurrence frequencies and mean member support.
- Lead-time-dependent spread and member counts: 8 Day 1, 12 Day 2, and 16 Day 3 members by default.
- Scenario clustering by dominant storm mode and initiation realization.
- Per-cell member frequency and mean-support attribution for tornado, hail, and wind.
- Probability ceilings preserve the highest hazard tier supported by the base atmospheric forecast.
- Ensemble diagnostics report spread area, 50% cores, mean frequency, and cluster weights.

## Architecture

The authoritative atmosphere remains unchanged. Ensemble members are lightweight forecast interpretations generated from a shared issued grid, allowing future caching and rescoring without rerunning the realized simulation.
