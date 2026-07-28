# Weather World 2.34.5 — Historical Archive Pipeline and Categorical Rasterization Corrections

## Purpose

Make the historical archive a repeatable staged subsystem while keeping real-world SPC geography separate from the fictional Weather World grid.

## Canonical layout

- `data/historical/raw/spc/`
- `data/historical/normalized/spc/`
- `data/historical/rasterized/spc/`
- `data/historical/cases/`
- `data/historical/catalog/`
- `data/historical/pipeline-manifest.json`

The pipeline detects legacy normalized locations, supports explicit `--input`, recursively scans nested years/dates, creates missing directories, and writes the compatibility dataset consumed by the 2.34.4 viewer.

## Commands

- `npm run historical:rasterize`
- `npm run historical:cases`
- `npm run historical:catalog`
- `npm run historical:build`
- `npm run historical:migrate -- --input <existing-normalized-directory>`

## TSTM correction

SPC open categorical boundaries can be force-closed by a long straight chord during polygon normalization. Filling the chord-created polygon can paint the no-risk/opposite side of the boundary. The rasterizer now rejects unrecognized/background contours and skips ambiguous long-chord TSTM polygons with explicit diagnostics instead of rendering an inverted region.

This is intentionally conservative: ambiguous geometry is omitted rather than fabricated. Later geographic clipping can reconstruct open contours against a formal CONUS analysis mask.
