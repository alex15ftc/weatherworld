# Milestone 2.34.2.1 — SPC Acquisition Performance and Resilience

This patch hardens the SPC archive acquisition workflow without changing parsed-product semantics.

## Included

- bounded concurrent product and artifact downloads;
- exponential retry/backoff for HTTP 408, 425, 429, 500, 502, 503, and 504 responses;
- per-request timeouts;
- cached annual archive listings used when SPC index requests fail;
- incremental manifest checkpoints after each completed product;
- explicit progress counters;
- `--max-products` for quick validation runs;
- configurable `--concurrency`, `--retries`, and `--timeout-ms` options.

## Example

```bash
npm run fetch:spc-outlooks -- --start 2024-05-06 --end 2024-05-06 --days day1 --concurrency 4 --max-products 5
```
