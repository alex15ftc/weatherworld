# Milestone 2.30.0 — Evolving Significant-Event Environments

This release changes significant historical analogs from strong initial-condition
templates into environments that strengthen toward a first-day convective peak.

## Model changes

- Effective STP now uses mixed-layer LCL height above ground level.
- STP LCL, CIN, and effective-shear terms follow SPC-style caps and cutoffs.
- Surface-rooted eligibility prevents capped or elevated profiles from publishing
  surface significant-tornado parameter values.
- Classic tornado-outbreak narratives always use the first-cycle rapid-development
  timeline. Mixed-mode, HP-supercell, derecho, and QLCS narratives may also use it.
- Significant and extreme regional envelopes retain their analog moisture axes
  instead of relaxing toward a weaker generic maritime-tropical profile.
- Approaching significant systems maintain analog-consistent 500-mb cooling where
  ascent and forcing overlap the warm sector.
- Significant-event storm initiation ramps with lifecycle release, reducing storms
  generated from an overpowered initial state.
- The initial morning moisture calculation now applies the intended dewpoint offset.

## Protected behavior

`tests/significant-event-strengthening-2.30.0.mjs` verifies:

- STP cloud-base terms are terrain-independent and use AGL.
- SPC-style LCL and CIN terms never exceed one.
- Classic outbreak seeds peak during the first convective cycle.
- A reference classic-outbreak environment gains STP, CAPE, and moisture while
  developing toward its configured peak.

## Reference trajectory

For classic-outbreak seed `25`, the warm-sector maximum evolves as follows:

| Elapsed | Maximum STP | Maximum CAPE | Maximum dewpoint |
| ---: | ---: | ---: | ---: |
| 0 h | 3.13 | 3,727 J/kg | 69.3°F |
| 3 h | 4.45 | 4,195 J/kg | 69.8°F |
| 6 h | 6.63 | 4,985 J/kg | 70.6°F |
| 9 h | 9.96 | 5,872 J/kg | 71.3°F |

These are deterministic simulator diagnostics, not a claim that every historical
significant event should reach the same magnitude.
