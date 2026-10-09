# WeatherWorld 2.66.0 — Convective Organization & Regional Outlook Intelligence

This release adds persistent convective clusters, intermediate storm modes, gradual upscale growth, grouped tier-aware forecast confidence, and corridor-aware regional topology cleanup.

## Highlights
- Intermediate modes: isolated discrete, semi-discrete, discrete/mixed supercell clusters, broken line, and QLCS with embedded supercells.
- Persistent cluster objects with size, spacing, alignment, cold-pool overlap, organization score, and membership.
- Regional confidence groups replace repeated multiplication of correlated confidence terms.
- Potential determines maximum eligible hazard tier; confidence limits downgrade distance.
- Regional topology fills small holes, bridges supported one-cell gaps, removes unsupported islands, and preserves nested probability tiers.
- New diagnostics: `stormEngine.convectiveOrganization` and `ensembleForecast.regionalTopology`.
