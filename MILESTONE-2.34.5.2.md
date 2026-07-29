# Milestone 2.34.5.2 — Canonical Historical Archive Population

Version 2.34.5.2 makes the existing `data/historical` tree the single authoritative SPC outlook archive and adds a resumable population command.

## Canonical paths

```text
data/historical/
├── raw/spc/<YYYYMMDD>/
├── normalized/spc/
├── rasterized/spc/
├── cases/
├── catalog/cases.json
├── pipeline-manifest.json
└── population-report.json
```

`data/spc/downloads` and `data/historical/spc-cases` are legacy locations. New builds do not write to them. The historical API now reads the canonical catalog and case directories directly.

## Population command

Populate one or more dates and then rebuild the archive:

```powershell
npm run historical:populate -- --dates 2011-04-27,2011-05-24 --days day1
```

A date range is also supported:

```powershell
npm run historical:populate -- --start 2024-05-01 --end 2024-05-07 --days day1
```

Or use a JSON selection manifest:

```json
{
  "dates": ["2011-04-27", "2011-05-24", "2024-05-06"],
  "days": ["day1"]
}
```

```powershell
npm run historical:populate -- --manifest archive/manifests/validation-batch-01.json
```

Downloads are cached by the acquisition client, so rerunning the same command resumes missing work. Add `--force` only when the raw source artifacts need to be downloaded again. `--continue-on-error` allows the remaining dates to run and records failures in `population-report.json`.

## Case provenance

Every built case now records:

- downloaded, normalized, rasterized, and case-built status;
- parser and geometry versions;
- source format;
- source artifact paths, URLs, and hashes when available;
- geometry warnings from normalization and rasterization.

This allows future parser upgrades to identify which historical cases need regeneration.

## Initial archive batch

Begin with a diverse Day 1 validation batch and inspect every issuance in `historical.html` before expanding to entire years. Confirm broad TSTM coverage, no-risk holes, disconnected regions, category precedence, and all hazard layers.
