# Milestone 2.34.1 — SPC Outlook Acquisition

## Purpose

Build a reproducible, resumable acquisition layer for historical Storm Prediction Center convective outlook products. This milestone preserves original products and acquisition metadata; polygon interpretation is intentionally deferred to 2.34.2.

## Added

- Official SPC yearly archive enumeration for Day 1, Day 2, and Day 3 outlooks.
- Date-range and forecast-day filtering.
- Resumable original-artifact downloads with atomic `.part` writes.
- SHA-256 checksums and byte counts for every preserved artifact.
- Issuance and valid-time extraction from archived outlook pages.
- Product manifests with source URLs, local paths, status, and pipeline version.
- Duplicate issuance detection.
- Missing date/product reporting.
- A dry-run mode for auditing an archive request without downloading products.

## Boundaries

- No outlook polygons are parsed or normalized in this milestone.
- No SPC forecast is allowed to influence scenario realization or historical forecast selection.
- Raw downloaded products remain under `data/spc/downloads/` and are excluded from Git.
- Manifests may be copied into a tracked metadata directory when a stable historical batch is approved.

## Command

```bash
npm run fetch:spc-outlooks -- --start 2024-05-20 --end 2024-05-22 --days day1,day2,day3
```

Useful options:

```text
--output <directory>
--manifest <file>
--overwrite
--dry-run
```

## Verification

```bash
npm run test:2.34.1
npm run test:current
```
