# Milestone 2.34.2 — SPC Product Parsing

## Implemented

- Parses SPC KML placemarks, polygons, multipolygons, and interior holes.
- Parses legacy SPC `LAT...LON` coordinate blocks.
- Classifies categorical, tornado, wind, hail, and significant-severe contours.
- Preserves source labels, source indexes, timestamps, forecast day, and artifact provenance.
- Closes open rings, rejects invalid geometry, removes duplicate contours, and records structured warnings.
- Produces policy-era-aware normalized outlook objects without altering the original acquisition record.
- Adds a manifest-driven batch parsing command that writes one normalized JSON record per issuance.

## Commands

```bash
npm run test:2.34.2
npm run parse:spc-outlooks -- --manifest data/spc/manifest.json
```

## Deferred to 2.34.3

Polygon rasterization, fractional 10 km cell coverage, map clipping, boundary distance, and significant-severe masks remain part of 2.34.3.
