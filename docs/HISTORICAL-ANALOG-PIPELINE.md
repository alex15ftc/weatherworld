# Historical analog and ensemble pipeline

The simulator can build its analog catalog from two joined sources:

1. NOAA NCEI Storm Events bulk CSV rows provide observed tornado, hail, and
   thunderstorm-wind outcomes.
2. ERA5-derived daily summaries provide the atmospheric pattern for each event
   date.

No machine-learning model is required. The initial implementation uses an
auditable outbreak score, weighted nearest-neighbor analog selection, and
seeded ensemble perturbations.

## Intensity score

`OutbreakIntensity.scoreOutbreak()` combines significant and violent tornadoes,
significant hail, destructive wind, spatial coverage, and three-hour temporal
concentration. Saturating transforms prevent raw report counts from dominating,
and an era factor partially compensates for historical under-reporting.

Bands are `localized`, `organized`, `significant`, `major`, and `exceptional`.
The band selects analog candidates; it does not force the simulated outcome.

## Building the catalog

Download NOAA Storm Events bulk CSV data from the NCEI archive. Produce a JSON
object keyed by `YYYY-MM-DD` containing normalized ERA5 pattern summaries:

```json
{
  "2011-04-27": {
    "family": "shortwave_ejection",
    "troughAmplitude": 0.92,
    "troughTilt": -0.76,
    "lowLevelJetStrength": 0.91,
    "moistureQuality": 0.88,
    "capStrength": 0.39,
    "forcingTiming": 0.87,
    "discreteBias": 0.76
  }
}
```

The repository includes resumable acquisition helpers:

```sh
npm run fetch:noaa-events -- 1996 2025
node scripts/select-noaa-candidate-days.mjs storm-events-2011.csv.gz dates-2011.json 40 8
python scripts/request-era5-event-days.py candidate-dates.json
python scripts/derive-era5-analog-summaries.py
```

The NOAA helper resolves the newest bulk-file revision for each requested year.
The ERA5 helper requests only four synoptic hours on candidate event dates over
the central United States, avoiding a multi-terabyte full-history download.
ERA5 access requires `cdsapi`, an accepted dataset license, and the user's CDS
personal access token in `.cdsapirc`.

Then run:

```sh
npm run build:analogs -- storm-events.csv era5-derived.json
```

`generateScenario(world, seed, { targetBand: "major" })` constrains historical
selection to the 60–80 band. `minScore`, `maxScore`, and `targetScore` provide
finer control for calibration and seed-search tooling.

This writes the audit catalog to `data/analogs/` and the browser-loadable
generated module to `js/analogs/generatedHistoricalAnalogCatalog.js`.

When that generated catalog is empty, the existing synthetic archetypes remain
an explicit fallback. Forecast discussions expose `analogSource`, so fallback
operation cannot be mistaken for real-data guidance.

When historical records are available, their weighted ERA5 descriptors modify
the upstream scenario: moisture return, cap persistence, low-level-jet
kinematics, forcing timing, frontal coherence, storm-mode bias, and the
narrative intensity envelope. Similarity controls the influence, so a distant
analog cannot overwhelm the selected narrative. The historical report outcome
never writes storms directly; authoritative realization and bust mechanisms
remain stochastic and environment-dependent.

## Future ML

Once the catalog and verification archive are large enough, metric learning or
gradient-boosted calibration can replace hand-tuned similarity weights.
Machine learning should calibrate probabilities; it should not directly write
future storm objects into the authoritative simulation.

## Ensemble calibration

Ensemble members sample complete historical residual vectors rather than
perturbing each ingredient independently. This preserves relationships such as
stronger moisture return occurring alongside a stronger low-level jet, or
strong forcing coinciding with reduced discrete-mode longevity. Historical
outcome support is corrected with leave-one-event-out linear calibration before
it contributes to member realization probability. The calibration diagnostics
and RMSE are exposed in the ensemble result.
