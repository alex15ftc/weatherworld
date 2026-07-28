# Weather World 2.34.4 — Historical Outlook Dataset Integration & Viewer

## Purpose

Connect normalized and rasterized SPC archive products to a canonical historical-case catalog and an inspectable research viewer without projecting United States data onto the fictional Weather World grid.

## Coordinate spaces

- `historical-geographic`: real-world SPC longitude/latitude raster data.
- `fictional-world`: Weather World's procedural game grid.

Direct row/column comparisons between these spaces are invalid and rejected by the dataset API.

## Build a dataset

```bash
npm run build:spc-dataset -- --input <normalized-spc-directory>
```

Default output:

```text
data/historical/spc-cases/catalog.json
data/historical/spc-cases/cases/<case-id>.json
```

A different output directory may be supplied with `--output`. Set `HISTORICAL_DATASET_ROOT` when starting the server if that directory is outside the default location.

## View

Start the authority server and open:

```text
http://localhost:3000/historical.html
```

The viewer supports case selection, hazard layers, fractional coverage, optional cell outlines, and click-to-inspect contour provenance.
