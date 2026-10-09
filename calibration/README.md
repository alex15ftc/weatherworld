# WeatherWorld calibration

## Corpus
`cases/benchmark-corpus-v1.json` contains 30 entries: 12 active deterministic scenario-family benchmarks and 18 historical reference entries. Historical references are intentionally `reference-only`; they are excluded from suites until authoritative atmospheric checkpoints and SPC products are imported.

## Commands
- `npm run calibrate:validate`
- `npm run calibrate:status`
- `npm run calibrate:suite -- --split calibration`
- `npm run calibrate:audit -- --start 100000 --count 25 --hours 72`
- `npm run calibrate:import -- calibration/import/my-case.json`
- `npm run calibrate:baseline -- --source calibration/reports/<report>.json`

Use 72-hour audits when evaluating outlook distributions. Shorter audits report the latest issued category with `INCOMPLETE_TRUTH_WINDOW`; they do not pretend it was fully verified.
