# WeatherWorld 2.72.1 — Integrity Separation and Compact Timelines

## Integrity ownership

`diagnoseMeteorologicalIntegrity()` is read-only and returns a constraint plan.
`applyMeteorologicalConstraints()` performs explicit state changes. The compatibility
wrapper runs diagnosis, application, and publication in the established order, keeping
seeded simulation behavior stable.

Integrity reports distinguish proposed corrections from applied corrections and retain
owner/cause telemetry.

## Dependency revisions

Runtime state now tracks atmosphere, profile, boundary, storm, and forecast revisions.
These counters establish cache-invalidation boundaries for later per-cell dependency
tracking.

## Timeline storage

Background timeline cells use:

- typed numeric field buffers;
- keyframes every six frames;
- numeric deltas between keyframes;
- structural patches for changed non-numeric cell state;
- reconstruction from the nearest keyframe;
- retained-byte telemetry.

Sounding profiles remain omitted from compact gameplay frames and are reconstructed
through the existing lazy product path.

## Validation

```powershell
npm run test:2.72.1
npm test
npm run benchmark:runtime -- 100000 6 gameplay
```

Reference 2.72.1 run for seed `100000`, six gameplay hours:

- initialization: approximately 1.00 s;
- evolution: approximately 10.07 s;
- throughput: approximately 0.596 simulated hours per second.

This local run attributes roughly 6.96 s to predictive outlook work, making forecast
invalidation and issuance scheduling the next measured optimization target.
