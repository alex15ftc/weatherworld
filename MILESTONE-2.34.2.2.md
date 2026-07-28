# Weather World 2.34.2.2 — Reliable Targeted SPC Discovery

This maintenance milestone removes the annual archive index as the default bottleneck for narrow historical requests.

## Changes

- Date-targeted SPC URL discovery is now the default.
- Known Day 1–3 issuance cycles are probed directly and concurrently.
- Missing candidate products (HTTP 404) are treated as normal archive gaps.
- Timeouts and temporary failures are recorded without terminating the entire run.
- Successfully probed HTML is reused during archival instead of downloaded twice.
- `--max-products` can stop discovery after enough products are found.
- Annual archive scanning remains available with `--discovery annual`.
- Manifests record discovery mode and nonfatal discovery failures.
