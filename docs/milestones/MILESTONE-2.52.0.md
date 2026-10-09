# WeatherWorld 2.52.0 — Environmental Feedback and Density-Aware Storm Spacing

## Purpose

This milestone recognizes that every grid cell is 10 km × 10 km, or 100 km². Storm spacing therefore cannot be interpreted as one storm per cell or as a fixed 30–40 km exclusion radius. The engine now permits realistic neighboring and clustered storms while retaining environmental, corridor, active-capacity, and synoptic-budget controls.

## Changes

- Replaced fixed 18–48 km initiation spacing with grid-scale, storm-mode-aware spacing.
- Allows closer storm births along the same strong corridor and in outflow-driven clusters.
- Keeps wider spacing for isolated/discrete modes, strong CIN, and processed air.
- Expanded storm feedback footprints so a storm affects the 100 km² cells it overlaps rather than only cells whose centers fall inside a small cold pool.
- Strengthened processed-air, cloud, precipitation, and cold-pool memory persistence.
- Reduced environmental recovery in worked-over cells.
- Changed synoptic recharge to weight the relevant warm-sector and forcing corridors instead of averaging the entire domain.
- Reduced maximum recharge and made processed-air penalties stronger.

## Calibration intent

Storm counts should no longer be judged against an arbitrary low total. The audit should instead evaluate storm density per active convective area, excessive duplicate births within a corridor, active storm capacity, and whether convection repeatedly forms in worked-over air.
