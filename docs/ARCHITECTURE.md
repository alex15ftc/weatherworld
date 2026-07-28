# Architecture

## Purpose

Fake Plains Weather Simulator is a deterministic, coupled severe-weather model and
product viewer. It is designed to create meteorologically coherent fictional events,
not to ingest or predict real weather.

## Authority and data flow

1. `scenarioGenerator.js` selects a seeded synoptic narrative and initializes the
   atmosphere.
2. `evolution.js` advances the environmental state and coordinates its coupled engines.
3. Mesoscale engines diagnose boundaries, forcing, and spatial fields.
4. Storm engines initiate persistent storms, evolve their structure and lifecycle,
   and apply bounded environmental feedback.
5. Forecast engines issue frozen Day 1–3 products from projected environmental support.
6. Verification samples simulated truth and scores eligible forecast windows.
7. The server authority publishes fields, cells, soundings, outlooks, and rendered tiles.

The dependency direction matters: generated metadata and narrative labels may shape the
initial atmosphere, but must not directly manufacture forecast hazards or realized storms.

## Significant-event evolution

Significant historical analogs define an evolving environmental trajectory rather than
a downstream hazard bonus. The analog controls the moisture reservoir, lapse-rate and
midlevel-temperature targets, forcing timing, and lifecycle peak. Cells still derive
CAPE, CIN, STP, and hazards from their actual profiles.

Storm initiation is lifecycle-aware: the initialized environment may advertise future
potential, but realized storms ramp up only as cap release and the configured development
window overlap. Storms remain emergent objects and may still fail, merge, or grow upscale.

## Clocks

- Atmospheric cadence: 30 simulated minutes.
- Storm cadence: 5 simulated minutes.
- Server wall-clock rate: 0.25 simulated hours per real minute.
- Forecast products have independent issuance and validity periods.

Do not make rendering cadence authoritative. A scenario must evolve identically when
run headlessly, through the server, or through a worker.

## Major modules

| Area | Responsibility |
| --- | --- |
| `js/scenarios` | Seeded narratives, analogs, climatology, and initial atmosphere |
| `js/mesoscale` | Boundaries and spatial mesoscale fields |
| `js/storms` | Initiation, lifecycle, structure, motion, and hazards |
| `js/forecast` | Outlook cycles, synthesis, discussions, and analog ensemble |
| `js/verification` | Truth capture, scoring, calibration, and benchmark timing |
| `js/world` | Shared state and browser authority coordination |
| `js/worker` | Background authority and timeline precomputation |
| `server` | Canonical runtime, cached products, tiles, and HTTP API |
| `tests` | Deterministic behavior and milestone regressions |

## State ownership

- Atmospheric cells own environmental truth.
- Storm objects own storm identity, history, structure, and realized hazards.
- Outlook products own issued forecast state and stay frozen until the next cycle.
- Renderers and clients consume snapshots; they must not modify model truth.
- Verification observes both issued forecasts and later truth without influencing either.

## Determinism contract

Given the same seed, configuration, start time, step sequence, and model version, the
simulation should produce the same meteorological state. Random values that affect the
model must therefore come from seeded generators, not `Math.random()`.

When changing physics:

1. Add a focused invariant or regression test.
2. Run the primary suite.
3. Run the latest milestone regression chain.
4. Benchmark at least one fixed seed.
5. Use a multi-seed calibration run before changing thresholds or climatology.

## Known architectural pressure points

- `evolution.js` is the central orchestration boundary and should remain thin.
- Full nested cell objects are convenient but expensive to clone and traverse.
- Timeline precomputation currently captures deep snapshots every half hour.
- Browser and server authorities must remain behaviorally equivalent.
- Version identifiers should eventually come from one build metadata source.
