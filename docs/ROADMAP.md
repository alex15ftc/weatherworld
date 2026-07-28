# Weather Simulator Development Roadmap

**Status:** Source of truth  
**Baseline:** 2.33.5  
**Current milestone:** 2.34.2 — SPC Product Parsing

This document is the authoritative roadmap for historical outlook, reanalysis, verification, forecast calibration, and later storm-realization work. Milestone documents describe completed implementation details; this roadmap defines intended sequencing and scope.

## Governing data contract

- **ERA5 and other reanalysis data describe the reconstructed atmosphere.**
- **SPC outlooks describe what forecasters predicted at a specific issuance.**
- **Storm reports and verification grids describe observed outcomes.**
- Forecast code must never use later outlook cycles, realized storms, report totals, or final event intensity as predictors.
- Scenario generation may use an explicitly requested historical outcome band to create a particular game seed, but that information is generation-only and must be redacted before forecast analog selection.

## 2.34.x — Historical SPC Outlook Foundation

### 2.34.0 — Historical data architecture

- Separate scenario-generation analogs from forecast analogs.
- Prevent report totals and outbreak intensity from influencing forecast analog selection.
- Add canonical issuance-aware historical record schemas.
- Add original and normalized SPC hazard-product schemas.
- Add provenance and processing-version contracts.
- Add no-outcome-leakage and timestamp-alignment tests.
- Establish a migration path for consolidating the duplicate analog engines.

### 2.34.1 — SPC outlook acquisition — Complete

- Added resumable archive download, product manifests, SHA-256 checksums, duplicate detection, and missing-product reporting.
- Preserves original source files, source URLs, issued timestamps, and valid timestamps.
- Added archive request dry runs and atomic partial-file replacement.

### 2.34.2 — SPC product parsing — Complete

- Parses categorical, tornado, hail, wind, and significant-severe polygons from KML and legacy LAT...LON products.
- Preserves original products, source provenance, structured warnings, and policy-era-aware normalized products.

### 2.34.3 — Outlook rasterization

- Rasterize polygons to the simulator's 10 km grid while preserving original geometry.
- Support fractional coverage, holes, disconnected areas, and significant-severe masks.

### 2.34.4 — Historical record joining

- Join issuance-specific SPC products, issuance-time atmospheric snapshots, event windows, and observations.
- Handle events crossing 00Z and retain ambiguous joins for review.

### 2.34.5 — Analog-engine consolidation

- Replace parallel production/prototype matchers with one repository, one atmospheric similarity implementation, and separate scenario/forecast selectors.

## 2.35.x — ERA5 Environmental Reconstruction

- 2.35.0: Three-hourly expanded-domain retrieval and event windows.
- 2.35.1: Terrain-aware vertical profiles and physically meaningful shear/lapse-rate diagnostics.
- 2.35.2: Storm motion, SRH, Corfidi vectors, and boundary-relative flow.
- 2.35.3: Spatial lows, boundaries, corridors, overlap objects, and compact descriptors.
- 2.35.4: Trajectory analogs based on atmospheric evolution rather than one snapshot.

## 2.36.x — Historical Observation and Verification

- 2.36.0: Storm-report normalization, segment consolidation, quality flags, and source metadata.
- 2.36.1: Neighborhood-based gridded hazard observations.
- 2.36.2: Null and bust cases as first-class catalog records.
- 2.36.3: Brier, reliability, ROC, fractions skill, area bias, and displacement metrics.

## 2.37.x — Historical Hindcast Framework

- 2.37.0: Blind issuance-time hindcast runner.
- 2.37.1: Lead-dependent forecast uncertainty rather than treating reanalysis as perfect guidance.
- 2.37.2: Forecast revision trajectories across Day 3, Day 2, and Day 1 cycles.
- 2.37.3: Historical comparison viewer with difference maps and analog diagnostics.

## 2.38.x — SPC-Style Outlook Calibration

- 2.38.0: Hazard-specific probability calibration.
- 2.38.1: Spatial geometry calibration independent of probability magnitude.
- 2.38.2: Calibrated categorical derivation and significant-area rules.
- 2.38.3: Setup, region, season, lead, and storm-mode calibration hierarchy.

## 2.39.x — Outlook Discussion Generation

- Evidence-backed meteorological discussions.
- Confidence and uncertainty language derived from ensemble spread.
- Update-aware explanations tied to actual changes in forecast fields.

## 2.40.x — Generated Weather Integration

- Historical atmospheric analog synthesis without copying outcomes.
- Separate forecast and authoritative realized timelines.
- Persistent Day 3 → Day 2 → Day 1 → live-analysis scenario continuity.
- Player planning loop built around imperfect but explainable forecasts.

## Later milestones

- **2.41.x:** Convective initiation and cap evolution.
- **2.42.x:** Storm-mode evolution, interactions, and upscale growth.
- **2.43.x:** Tornado, hail, wind, flood, and damage realization.
- **2.44.x:** Active-region performance, typed arrays, spatial indexes, workers, delta networking, and deterministic replay.

## Acceptance rule for historical forecasting work

A historical feature is not complete until it proves all of the following:

1. Inputs are limited to information available at issuance.
2. Original data and normalized data remain distinguishable.
3. Issued and valid timestamps are explicit.
4. Outcome labels are inaccessible to forecast predictors.
5. Generated outlooks can be independently verified against both SPC forecasts and observed outcomes.


## 2.34.2.2 targeted SPC acquisition

`fetch:spc-outlooks` now uses date-targeted product discovery by default, avoiding slow annual archive listings. Use `--discovery annual` only for completeness audits or broad archive reconciliation.
