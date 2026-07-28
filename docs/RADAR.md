# Radar Architecture

## Current status
Radar is not a primary development dependency for the historical outlook program. Background atmospheric, forecasting and storm-realization engines take priority.

## Future responsibilities
Radar should derive reflectivity, velocity and correlation-coefficient-like fields from storm objects and their internal state. It must not act as the source of storm truth.

## Constraints
- Products should be reproducible from the authoritative checkpoint.
- Rendering detail should scale independently from atmospheric grid resolution.
- Storage and browser quotas must be respected.
- Radar signatures must correspond to simulated storm structure and hazards.
