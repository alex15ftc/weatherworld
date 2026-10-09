# WeatherWorld 2.63.0 — Outlook Assimilation Engine

2.63.0 converts full ensemble storm histories into support-limited SPC-style probability corridors.

## Included
- time-integrated hazard density from forecast storm state histories;
- unique-member and unique-storm-family support rather than point-count voting;
- genealogy-aware contribution masks;
- scenario/mode corridor separation;
- directional along-track and cross-track kernels;
- hazard-specific lifecycle weighting;
- core, envelope, and outlier reconstruction;
- high-tier support gates and probability ceilings;
- unsupported-contour diagnostics;
- track, density, and probability-core centroids for outlook-stage attribution;
- per-cell outlook assimilation metadata.

The atmospheric and realized storm engines are unchanged.
