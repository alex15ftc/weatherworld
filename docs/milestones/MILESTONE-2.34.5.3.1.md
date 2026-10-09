# Weather World 2.34.5.3.1 — Historical Population Failure Handling

This hotfix repairs the population command's failure path and makes partial archive imports resumable and diagnosable.

## Changes

- Defines `StageError` before top-level population work begins, eliminating the class temporal-dead-zone crash.
- Continues processing independent dates after acquisition or normalization failures by default.
- Adds `--fail-fast` for operators who explicitly prefer immediate termination.
- Prints captured child-process stderr/stdout when a date fails.
- Uses completion-based progress counters so concurrent jobs report `1/N`, `2/N`, and so on in the correct order.
- Writes stage summaries and a final list of failed dates.
- Always writes `population-report.json` after a non-fatal partial failure.
- Exits nonzero after the report when any date or the final pipeline failed, while preserving successful archive work for the next resume run.

## Resume

Rerun the same population command after correcting or investigating failed dates. Existing successful downloads and generated products remain eligible for incremental skipping.

```powershell
npm run historical:populate -- --manifest archive/manifests/validation-batch-01.json
```

For live child output:

```powershell
npm run historical:populate -- --manifest archive/manifests/validation-batch-01.json --verbose-children
```

To stop at the first failed child process:

```powershell
npm run historical:populate -- --manifest archive/manifests/validation-batch-01.json --fail-fast
```
