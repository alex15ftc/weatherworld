# Milestone 2.37.0 — Spatial Training Corpus Foundation

This milestone begins the transition from a parameter-first simulator to an atmosphere-first procedural system.

## Implemented

- ERA5 fields are preserved as compressed time/channel/grid tensors in the external training cache.
- Surface and seven pressure levels are interpolated to a deterministic 100×100 Weather World training grid.
- Latitude, longitude, and eight 3-hour valid times are retained.
- Initial derived maps include 10 m wind speed, dewpoint depression, 1000–500 hPa bulk shear, and 850–500 hPa lapse rate.
- Compact repository manifests describe tensor shape, units, provenance, checksums, and cache location.
- Spatial corpus status and validation commands verify required channels, dimensions, external files, sizes, and optional SHA-256 checksums.
- Existing compact ERA5 summaries remain available for cataloging and backward compatibility.

## Storage boundary

Large `.npz` tensors stay under `WEATHERWORLD_TRAINING_CACHE/era5/spatial`. Only compact manifests belong in `training/atmospheric/era5/spatial`.

## Commands

```bash
npm run training:resume
npm run training:spatial-status
npm run training:validate-spatial
npm run training:validate-spatial -- --checksum
npm run test:2.37.0
```

ERA5 is interpolated to the simulator grid for a consistent tensor shape. This does not imply that ERA5 resolves true 10 km-scale boundaries.
