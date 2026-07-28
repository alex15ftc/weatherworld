# Performance guide

## Goal

Improve simulated-hours-per-second and UI responsiveness without changing deterministic
meteorological output. Optimize from measurements, one hypothesis at a time.

## Current baseline

Reference command:

```powershell
npm run benchmark:seed -- 63869760 6 3
```

Original 2.29.0 baseline on the reference development machine:

| Metric | Result |
| --- | ---: |
| Fastest | 31.07 s |
| Median | 31.34 s |
| Slowest | 37.04 s |
| Mean | 33.15 s |
| Median throughput | 0.19 simulated hr/s |

A separate two-hour instrumented run reported:

| Phase | Time | Approximate share |
| --- | ---: | ---: |
| Initialization | 1.72 s | 23% |
| Simulation | 5.62 s | 74% |
| Truth capture | 0.05 s | <1% |
| Scoring | <0.01 s | <1% |

These figures identify evolution as the first profiling target. They are local observations,
not portable performance guarantees.

## Optimization results

### 2026-07-26: parcel virtual-temperature calculation

The CPU profile identified `diagnoseParcel()`, `moistLift()`, and
`saturationVaporPressure()` as the dominant self-time. `virtualTemperatureK()` evaluated
the same dewpoint vapor pressure twice for every parcel/environment level. Reusing that
value preserves the formula and seeded results while removing one expensive exponential
evaluation per call.

The same six-hour, three-run benchmark after the change:

| Metric | Before | After | Change |
| --- | ---: | ---: | ---: |
| Fastest | 31.07 s | 10.26 s | -67.0% |
| Median | 31.34 s | 10.50 s | -66.5% |
| Slowest | 37.04 s | 11.05 s | -70.2% |
| Mean | 33.15 s | 10.60 s | -68.0% |
| Median throughput | 0.19 sim hr/s | 0.57 sim hr/s | 3.0× |

Import, 2.29.0 thermodynamics/cap evolution, sounding/VTP, tornado-sounding coherence,
and environmental-calibration regressions pass. Evolution timing now records snapshot,
transport, thermodynamics, boundary diagnosis, mesoscale, storms, coupling, and predictive
outlook phases for the next profiling pass.

The 2.30.0 evolving-event changes retain the optimized performance profile. The same
six-hour, three-run benchmark produced a 10.09-second median (0.59 simulated hr/s).

## Measurement protocol

1. Pin the Node version and record it with `node --version`.
2. Use a fixed seed, duration, and step size.
3. Warm up once before collecting comparison runs.
4. Collect at least five runs for small changes.
5. Compare medians and tail latency; report output equivalence.
6. Change one optimization variable per experiment.
7. Reject improvements that alter seeded results unintentionally.

The existing verifier uses high-resolution phase timing. Add nested marks around the
major calls inside `advanceAtmosphere()` before rewriting data structures. Node's
`node:perf_hooks` provides standardized marks, measures, observers, and event-loop
utilization: <https://nodejs.org/api/perf_hooks.html>.

For CPU attribution, collect a V8 CPU profile after warm-up:

```powershell
node --cpu-prof scripts/benchmark-seed.mjs 63869760 6 1
```

Open the resulting `.cpuprofile` in browser developer tools. Do not commit profiles;
they are machine-specific artifacts.

## Prioritized optimization roadmap

### 1. Instrument evolution by subsystem

Measure atmosphere diagnostics, mesoscale evolution, storm substeps/interactions,
outlook updates, soundings/profile recomputation, and snapshot capture separately.
The current top-level `simulationMs` number cannot identify which engine dominates.

Success criterion: at least 90% of simulation time is attributable to named phases,
with counters for cells, storms, interactions, and forecast builds.

### 2. Eliminate avoidable full-grid passes

The domain contains 2,500 cells and many engines independently map, flatten, sort, or
re-diagnose the full grid. Combine compatible read-only diagnostics into a single pass,
cache values until their dependencies change, and avoid allocating temporary arrays for
reductions.

Likely first experiments:

- Replace `flat().map()` extrema checks with one loop.
- Avoid sorting all cells when only a maximum or top-k sample is required.
- Recompute profile diagnostics only when their thermodynamic inputs change.
- Update outlook products only at issuance or when explicitly invalidated.

Measure each change; modern JavaScript engines can make intuitive micro-optimizations
neutral or worse.

### 3. Reduce snapshot cloning and memory churn

Timeline precomputation deep-clones the complete cell grid and several world structures
for every half-hour frame. That increases allocation, garbage collection, worker transfer
cost, and retained memory.

Prefer:

- Keyframes plus compact deltas for unchanged fields.
- Struct-of-arrays typed buffers for dense numeric cell fields.
- Transferable `ArrayBuffer` objects when ownership can move between worker and client.
- A bounded frame cache based on byte size, not only frame count.

Worker messages otherwise use the structured clone algorithm, which recursively copies
complex graphs. Transferable buffers move their backing storage instead of copying it:
<https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects>.

### 4. Use parallelism only after reducing work

CPU-intensive, independent seed verification and tile generation are good candidates for
a reusable Node worker pool. Atmosphere evolution for one world has sequential state
dependencies and should not be split across threads until ownership and boundary exchange
costs are measured.

Node recommends workers for CPU-intensive JavaScript, not ordinary I/O, and recommends a
pool rather than spawning one worker per task:
<https://nodejs.org/api/worker_threads.html>.

Good parallel units:

- Different verification seeds.
- Independent tile render requests from immutable snapshots.
- Read-only forecast diagnostics over a frozen snapshot.

Poor initial parallel units:

- Individual cells with frequent shared-state exchange.
- Every five-minute storm tick in a newly spawned worker.

### 5. Keep rendering off the interaction path

The browser already uses workers for authority and timeline work. Profile long tasks and,
if map rendering remains a source of input latency, evaluate `OffscreenCanvas` as a
progressive enhancement. It can transfer canvas ownership to a worker and free the main
thread: <https://web.dev/articles/offscreen-canvas>.

Also cache static layers, redraw only dirty overlays, batch canvas paths, and avoid
rebuilding DOM panels when their selected-cell revision has not changed.

### 6. Add performance budgets

After subsystem instrumentation is stable, enforce generous regression thresholds:

- Median simulated-hours-per-second for a fixed seed.
- Initialization time.
- Peak retained timeline bytes.
- Product tile p95 build time.
- Browser long tasks over 50 ms during interaction.

Use thresholds to detect large regressions, not to reject normal machine variance.

## Recommended first implementation

The highest-value low-risk change is not a worker rewrite. First add nested timings and
operation counters inside `advanceAtmosphere()`, run representative quiet, outbreak, and
linear-convection seeds, then optimize the consistently dominant engine. In parallel,
prototype compact typed-array timeline frames because the current deep-clone design has
a clear scaling cost independent of the meteorological profile.

## Experiment record template

```text
Date / commit:
Node / OS / power mode:
Hypothesis:
Seed, hours, step, runs:
Baseline median / slowest:
Candidate median / slowest:
Output equivalence check:
Memory or profile evidence:
Decision:
```
