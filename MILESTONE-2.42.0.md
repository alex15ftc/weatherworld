# Weather World 2.42.0 — Training Database & Archive Engine

Weather World's historical training archive now has a SQLite authority at:

`training/archive/weatherworld-training.sqlite`

The database stores searchable case metadata, SPC outlook references, NOAA event summaries, atmospheric asset references, analog feature vectors, pipeline runs, and calibration payloads. Large scientific artifacts such as ERA5 files and spatial tensors remain on disk and are referenced by path.

## Commands

```bash
npm run training:db:init
npm run training:db:import
npm run training:db:status
npm run training:db:validate
```

`npm run training:finalize` now synchronizes the completed feature corpus and calibration into SQLite automatically. Existing JSON records remain as compatibility artifacts while the database becomes the authoritative searchable archive.

## Design guarantees

- Idempotent UPSERTs make repeated imports safe.
- WAL mode and transactions protect long archive operations.
- Indexed readiness and risk fields support fast resume/status queries.
- One row represents one historical case; one-to-many outlooks and assets use related tables.
- NetCDF, GRIB, and tensor payloads are not copied into SQLite.
