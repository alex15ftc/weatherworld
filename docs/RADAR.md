# Radar Architecture

Radar derives reflectivity, velocity and dual-polarisation products from storm objects
and the environment. It never creates or alters weather: scans are a deterministic
function of the authoritative world state, the radar site and the elevation angle.

## Pipeline

```text
storm.structure (StormStructureEngine)      environment grid      mesoscale boundaries
        │  features: forward flank, updraft,      │ winds by height,        │ fronts, drylines,
        │  hail core, hook arc, inflow notch,      │ freezing level, EL,     │ outflow
        │  rear flank, line, RIJ, debris, meso     │ boundary-layer depth    │
        ▼                                          ▼                         ▼
StormEchoModel: storm-aligned 1 km hydrometeor raster + analytic vortices
        ▼
RadarSimulator.buildRadarScene (once per world revision)
        ▼
RadarSimulator.scanRadarTilt(site, tilt): 720 radials × 460 gates (0.5° × 0.5 km, 230 km)
   beam height from the 4/3-earth model, three samples across the vertical beam,
   terrain blockage, range-dependent sensitivity, low-SNR noise
        ▼
REF · VEL · SRV · CC · ZDR, one byte per gate (RadarFormat.js encodings)
        ▼
GET /api/radar/scan?site=&tilt=&product=   (gzip binary, metadata in x-radar-meta)
GET /api/radar/mosaic                       (1 km lowest-tilt reflectivity from all sites)
        ▼
radar.html / RadarViewer.js: WebGL2 shader maps polar bytes to screen + colour table
```

## Physical behaviour

- **Vertical structure.** Rain below the melting layer, ice above it (−7 dB and decreasing
  with height), a bright band in weak-updraft regions, a bounded weak-echo vault under
  strong updrafts, lofted precipitation (overhang) above the melting level, echo tops near
  the equilibrium level, and anvil ice carried downstream by the storm-relative upper flow.
- **Hail** produces 60–70 dBZ cores with depressed CC and near-zero ZDR.
- **Tornado debris** (from the structure's debris lobe while a tornado is on the ground)
  produces a low-CC debris signature at the hook tip.
- **Velocity** is the environmental wind profile plus storm perturbations: a mid-level-
  weighted mesocyclone, a tornado vortex, outflow away from downdraft cores near the
  ground, a descending rear-inflow jet in linear systems, and divergence near storm top.
  SRV subtracts the intensity-weighted mean motion of tracked storms.
- **Clear air.** Insects in the boundary layer (daytime returns, a dusk bloom) and fine
  lines along analysed boundaries. Because the beam rises with range, these appear only
  near the radar, as on real radars.
- **Network.** Nine sites ~270 km apart over the ~805 km domain. Storms between sites
  are sampled thousands of feet above the ground.
- **Mosaic (default view).** Each 1 km cell uses the nearest radar whose 0.5° beam
  samples it (same 1:2:1 beam pattern), falling back to the next radar when blocked or
  empty. Reflectivity only: velocity and dual-pol are relative to one radar. Double-click
  the mosaic to open the nearest site.

## Constraints

- Products are reproducible from the authoritative checkpoint (`tests/radar-simulator.mjs`
  checks byte-identical rescans).
- Rendering detail scales independently from atmospheric grid resolution.
- Radar signatures must correspond to simulated storm structure and hazards; the test
  builds a synthetic tornadic supercell and checks for a ≥55 dBZ core, a ≥45 m/s couplet
  and a CC ≤ 0.8 debris signature.

## Known limitations

- Velocity is not aliased and there is no range folding.
- Loops build from scans received while the page is open; the authority does not
  retain past volumes.
- Scans are built synchronously on the authority (≈0.3–0.8 s per tilt); a worker thread
  would keep the event loop free on busy days.
- `storm.internalField` (used by the hazard model) translates its contents by storm motion
  inside a storm-centred frame and accumulates without bound. Radar uses
  `storm.structure` instead; fixing the internal field changes hazard calibration.
