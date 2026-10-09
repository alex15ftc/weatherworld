# Weather World 2.34.3 — SPC Polygon Rasterization

This milestone converts normalized historical SPC outlook polygons into a north-up geographic grid suitable for rendering, verification, and later projection into Weather World's synthetic domain.

## Included

- Configurable 10 km geographic grid generation using a local equirectangular projection.
- Deterministic polygon-to-cell rasterization with configurable sub-cell edge sampling.
- Sparse output by default, with optional full-grid emission.
- Per-cell categorical, tornado, wind, hail, and significant-hazard values.
- Per-cell contour provenance and coverage fractions.
- Per-contour touched-cell and covered-cell-equivalent diagnostics.
- `estimatedGridCells` polygon metadata, folded in from the planned parser cleanup.

## Coordinate convention

- Columns increase eastward.
- Rows increase southward.
- Cell `(0, 0)` is the northwest cell.
- The raster grid is geographic and independent from the current fixed synthetic 50×50 simulation domain.
