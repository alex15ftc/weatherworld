---
name: engine-batch
description: Run an engine change batch safely in WeatherWorld - regression baseline, change, regression check, fingerprint equivalence, scorecard. Use before and after any change under js/storms, js/world, js/atmosphere or js/mesoscale that can alter storm or atmosphere behaviour.
---

# Engine batch

`git diff` shows what the batch changed; commit only when the user asks.

## 1. Baseline (before any edit)
- Check whether a current baseline exists in the scratch folder (the latest is noted in the regression-suite memory). If not, run one:
  `REG_OUT=<scratch> node tools/regression/run.mjs base` (~7 min, run in the background, wait on `<scratch>/base/scorecard.txt`).
- For refactors that should change nothing, take a fingerprint instead:
  `node tools/engine/fingerprint.mjs <seed> <hours> <scratch>/before.json`.
- Note uncommitted changes from other sessions (`git status`) so the batch's own diff stays clear.

## 2. Make the change
- Drive behaviour from fields with continuous relations: no label-keyed rules, vetoes, stepped caps or painted values.
- Audits of storm timing, warnings or tornado lives must step storms like the server (5-min `advanceStormLayer` ticks), not `advance(0.5)`.

## 3. Check
- Pure refactor: `node tools/engine/fingerprint.mjs <seed> <hours> <scratch>/after.json`, then `--compare before.json after.json`. Must be identical.
- Behaviour change: `REG_OUT=<scratch> node tools/regression/run.mjs <name> base`, then read `<scratch>/<name>/scorecard.txt`.
  - A regression = a measure further from its target than baseline by more than its tolerance. Judge MDT+HIGH together. Category shares move 2-4 points from chaos alone.
  - Revert or adjust any fix that regresses.
- Run only the tests the change touches: `node scripts/run-tests.mjs <filter>`.
- Forecast check (~25 min) only after a real engine batch; refit (~80 min) only if a day's score drops clearly. Ask before either.

## 4. Report
The scorecard lines that moved, what was not re-measured, and anything that breaks the no-hard-coding rule.
