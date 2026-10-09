# Weather World 2.34.5.1 — Unified SPC Categorical Geometry

- Prefer official downloaded SPC zipped shapefiles during normalization.
- Use completed GeoJSON polygon and multipolygon geometry for every categorical level.
- Preserve polygon holes as explicit no-risk/lower-risk exclusions.
- Remove TSTM-specific long-chord rejection from the rasterizer.
- Apply one categorical precedence path: NONE < TSTM < MRGL < SLGT < ENH < MDT < HIGH.
- Keep compact outline text as a fallback only when a shapefile is unavailable.

Existing normalized files created from compact text must be regenerated to receive the corrected TSTM geometry.
