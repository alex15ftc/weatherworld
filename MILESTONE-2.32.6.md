# Milestone 2.32.6 — Storm-corridor-centered outlook cores

This revision places outlook bullseyes where projected storms overlap the
hazard environment instead of simply centering them on the strongest static
environment.

## Forecast method

- Each valid-period sample backtracks the target along expected storm motion.
- Occupancy uses the same authoritative initiation opportunity consumed by
  storm formation: forecast initiation, initiation corridors, dynamic
  initiation potential, and trigger strength.
- Source coverage, projected-track support, organization, lifecycle
  persistence, target-environment support, and active storms contribute to the
  projected occupancy field.
- Hazard placement is ranked by projected occupancy multiplied by conditional
  hazard intensity.

The relocation moves each hazard's complete probability/CIG pair. It preserves
the exact pre-relocation inventory of tornado, hail, and wind probability/CIG
tiers, so it cannot create a stronger event merely to improve placement.
Existing 25-mile expansion, regionalization, nesting, and official
probability-times-CIG category rules remain authoritative afterward.

## One-way causality

The new field is outlook analysis only. It reads atmosphere, initiation, storm
motion, lifecycle, and active-storm state. It does not modify atmospheric
fields, initiate storms, change storm motion, or affect tornado genesis.

## Representative results

| Seed | Metric | 2.32.5 | 2.32.6 |
|---|---:|---:|---:|
| 25 | Forecast / observed | MDT / HIGH | MDT / HIGH |
| 25 | Tornadoes | 7 | 7 |
| 25 | Bullseye hit rate | 0.0% | 71.4% |
| 25 | Median core displacement | 60 mi | 30 mi |
| 25 | Placement score | 30.3 | 45.3 |
| 25 | Combined score | 45.8 | 49.9 |
| 306 | Forecast / observed | HIGH / HIGH | HIGH / HIGH |
| 306 | Tornadoes | 38 | 38 |
| 306 | Intensity-weighted core capture | 18.7% | 28.3% |
| 306 | Median core displacement | 72.1 mi | 20 mi |
| 306 | Placement score | 54.3 | 63.2 |
| 306 | Combined score | 52.1 | 53.1 |

Magnitude sub-scores decrease slightly because verification is spatial and the
same tier inventory is assigned to different cells. Combined scores improve
because the relocated cores better capture realized tornado corridors.

Reports:

- `verification-runs/seed-25-24h-2.32.6.json`
- `verification-runs/seed-306-24h-2.32.6.json`

## Overlay toggle repair

- Boundary, region-border, and region-label toggles now force a full overlay
  redraw even when the preceding timeline frame used fast-preview rendering.
- Region labels render independently from region borders, so either overlay can
  be enabled or disabled without silently controlling the other.
- The default Node/tiled viewer now binds all three controls; previously only
  the explicit `?local=1` viewer contained those handlers.
- Map manifests publish authoritative boundary polylines plus compact region
  cells and label centroids for the remote overlay renderer.
- Bootstrap cache keys were advanced on the live and Day 1–3 pages.
- A renderer regression covers full-versus-fast overlay dispatch and the
  independent label/border states, remote bindings, and manifest geometry.
