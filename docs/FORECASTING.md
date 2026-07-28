# Forecasting and Outlook Engine

## Purpose
The forecasting engine creates Day 1, Day 2 and Day 3 outlooks from information that would have been available at issuance time.

## Causality boundary
Forecast generation may use:
- Current and projected atmospheric states.
- Issuance-appropriate uncertainty.
- Atmosphere-only historical analog features.
- Calibration parameters learned from archived outlooks and observations.

Forecast generation must not use:
- Historical report totals or outbreak intensity when selecting forecast analogs.
- Future authoritative atmospheric states unavailable at issuance.
- Realized storms from the active seed.
- Verification labels for the event being forecast.

## Product cadence
- Day 1: update every six simulated hours.
- Day 2: update every twelve simulated hours.
- Day 3: update every twenty-four simulated hours.

## Required separation
1. Initiation probability.
2. Conditional storm severity if initiation occurs.
3. Hazard-specific probabilities.
4. Overall categorical risk derived from hazard probabilities.

## Output responsibilities
The engine produces hazard probability fields, categorical contours, significant-hazard areas, supporting and limiting factors, and an evidence-based discussion. Geometry should follow moisture, forcing, boundaries and projected storm corridors rather than generic radial blobs.
