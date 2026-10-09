# Weather World 2.42.1 — Archive Acquisition Engine

The historical archive is now driven by SQLite acquisition jobs rather than a monolithic downloader.

## Included

- schema v2 with providers, acquisition jobs, attempts, and download ledger;
- atomic job claiming for concurrent workers;
- idempotent queue population;
- stale-lock recovery and exponential retry scheduling;
- provider command adapters for SPC, NOAA, and ERA5;
- archive status, verification, repair, and doctor commands;
- persistent completion state on each historical case;
- lightweight source distribution cleanup.

## Commands

```bash
npm run archive:init
npm run archive:populate -- --start 2003-01-01 --end 2025-12-31 --workers 2 --python "C:\\path\\to\\python.exe"
npm run archive:resume -- --workers 2 --python "C:\\path\\to\\python.exe"
npm run archive:status
npm run archive:verify
npm run archive:repair
npm run archive:doctor
npm run test:2.42.1
```

Use conservative worker counts for remote providers. Completed jobs are never repeated; failed or interrupted work resumes from SQLite.

## SPC limitation

The queue prevents repeated probing and preserves every failure, but it cannot override an upstream HTTP 403. SPC acquisition remains isolated in its provider so a catalog or mirror strategy can replace it without changing the queue engine.
