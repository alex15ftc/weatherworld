# Weather World 2.34.5.3.2 — SPC Acquisition Resilience

This hotfix prevents missing supplemental SPC archive files from invalidating otherwise usable historical outlook issuances.

## Changes

- SPC geometry (`shapefile` and `kml`) remains required.
- Supplemental HTML and text links are optional.
- Optional HTTP 404 responses are retained in the acquisition manifest as `unavailable` artifacts and warnings.
- Product acquisition continues across issuance-level failures.
- A date succeeds when at least one issuance is usable; the fetch command exits nonzero only when every discovered issuance fails.
- Partial manifests are written after each completed or failed issuance.
- Permanent HTTP 404 responses are not retried; transient status codes retain exponential retry behavior.
- `historical:populate -- --retry-failed` reuses the prior population report and processes only failed dates.

## Retry the validation failures

```bash
npm run historical:populate -- --retry-failed
```

Or select dates explicitly:

```bash
npm run historical:populate -- --dates 2011-04-27,2011-05-24,2013-05-19
```
