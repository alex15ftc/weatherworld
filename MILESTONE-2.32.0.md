# Milestone 2.32.0 — Pattern climatology and physical lifecycle contracts

This revision restores occasional upper-tier events by strengthening the
generated atmosphere and its storm-realization opportunity. Outlooks remain a
strictly downstream analysis and never modify atmospheric or storm state.

## Changes

- Favorable severe-weather narratives now dominate gameplay draws; stable,
  pulse, and cap-bust days are rare.
- Classic outbreak, derecho, mixed-mode, and other significant families draw
  from stronger and broader thermodynamic/kinematic envelopes.
- Obsolete narrative identifiers in setup coverage calibration were replaced
  with the active scenario names.
- Setup guidance no longer acts as a ceiling on atmosphere-derived tornado
  intensity.
- Expected tornado realization was calibrated against coherent initiation,
  mode-survival, and environmental support.
- Pattern lifecycle contracts describe boundary type, initiation geometry,
  mature storm mode, transition timing, cold-pool behavior, and post-boundary
  thermodynamic wakes.
- Progressive cold fronts now favor linear convection, sweep eastward, and
  leave persistent cooler/drier air behind them.
- Every active narrative now has an explicit initial, mature, and late stage.
  These stages control initiation timing, coverage evolution, preferred storm
  mode, cold-pool behavior, aftermath, and environmental recovery:
  - isolated and giant-hail supercells remain discrete before later multicells;
  - loaded-gun events remain capped before explosive discrete initiation;
  - mixed-mode and outbreak events transition only after a discrete phase;
  - QLCS, derecho, and progressive-MCS events organize into mature convective systems;
  - elevated MCS events follow a delayed elevated-to-MCS trajectory;
  - pulse convection decays rapidly, while cap-bust and stable scenarios retain
    their intended failure modes.
- Narrative trajectories are families rather than fixed scripts. The selected
  analog members continuously vary phasing, delay, coverage, transition speed,
  cold-pool strength, and recovery within the narrative's physical bounds.
- Outlook trajectories now couple upstream initiation and storm coverage with
  the downstream environment encountered along the projected storm track.
  Risk maxima therefore follow storm/environment overlap instead of merely
  following the best stationary sounding.

## Calibration guard

Seed 306 produces a physically supported HIGH outlook from a coherent 30%
tornado/CIG2 corridor. Seeds 6161 and 10959 provide additional HIGH examples.
The focused regression also samples 5,000 lightweight pattern draws so weak
patterns cannot silently become common again.
