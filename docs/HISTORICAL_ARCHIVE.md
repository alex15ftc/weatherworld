# Historical SPC Outlook Archive

Weather World keeps historical U.S. SPC products separate from the fictional game world. The archive supplies analog statistics and verification data; geographic polygons are never projected onto the fictional map.

## Directory layout

The canonical root is `data/historical`:

```text
raw/spc/          Official downloaded artifacts and acquisition manifests
normalized/spc/   Uniform JSON outlook geometry
rasterized/spc/   10 km historical-geographic grids
cases/            Complete case records consumed by the API
catalog/          Searchable case catalog
```

Do not place new archive data in `data/spc/downloads` or `data/historical/spc-cases`.

## Populate a validation batch

The repository includes `archive/manifests/validation-batch-01.json`.

```powershell
npm run historical:populate -- --manifest archive/manifests/validation-batch-01.json
```

The command performs acquisition, normalization, rasterization, case construction, and catalog generation. Reruns use cached raw files and rebuild changed products.

Review:

```powershell
Get-Content data/historical/population-report.json
Get-Content data/historical/pipeline-manifest.json
npm start
```

Then open `http://localhost:3000/historical.html`.

## Validation checklist

For each issuance:

- normalized source format should preferably be `spc-shapefile`;
- TSTM should form the broad valid thunderstorm envelope;
- no-risk areas and polygon holes should remain unpainted;
- higher categories should overwrite lower categories;
- disconnected components should match the official product;
- tornado, wind, hail, and significant layers should load;
- the pipeline and population reports should have no unexplained failures.

## Scaling strategy

After the first batch passes visual and automated geometry checks, populate complete years in manageable ranges. Day 2 and Day 3 should be added after Day 1 geometry is consistently trustworthy. Large raw and generated datasets should generally remain outside Git; commit selection manifests, schemas, tests, and documentation.

## Performance and resuming (2.34.5.3)

Population now runs as three staged worker pools: acquisition, normalization, and archive construction. The default concurrency is four for each stage.

```powershell
npm run historical:populate -- `
  --manifest archive/manifests/validation-batch-01.json `
  --download-concurrency 4 `
  --normalize-concurrency 4 `
  --pipeline-concurrency 4
```

Available tuning options:

- `--download-concurrency`: number of dates acquired simultaneously.
- `--normalize-concurrency`: number of acquisition manifests parsed simultaneously.
- `--pipeline-concurrency`: number of normalized outlooks rasterized/built simultaneously.
- `--request-concurrency`: internal artifact requests used by each acquisition process.
- `--verbose-children`: display the full output of acquisition and normalization subprocesses.
- `--force`: redownload and rebuild intentionally; omit it for normal resumable runs.

The archive pipeline compares source modification times and pipeline versions. Unchanged raster and case files are loaded instead of rewritten. The catalog is generated once at the end of the batch. Rerunning a completed batch should therefore be much faster than its first run.
