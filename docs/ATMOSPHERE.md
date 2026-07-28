# Atmospheric Simulation

## Purpose
The atmospheric engine is the authoritative physical state of Weather World. It evolves continuously and must remain independent from forecast products, player observations, and realized storm reports.

## Core principles
- The atmosphere is generated from a seeded synoptic narrative and evolves through physically constrained transitions.
- Forecasts describe uncertain future states; they do not modify the authoritative atmosphere.
- Storms consume the environment and boundaries but do not rewrite large-scale fields arbitrarily.
- Shared thermodynamic profiles drive soundings, mesoanalysis, cap behavior, lapse rates, and convective diagnostics.

## State hierarchy
1. Synoptic state: cyclone, trough, jet structure, air masses, pressure fields.
2. Mesoscale state: fronts, drylines, outflow boundaries, moisture corridors, convergence and forcing.
3. Column state: temperature, moisture, winds, CAPE, CIN, LCL, LFC, lapse rates, shear and SRH.
4. Storm-relative state: motion vectors, inflow quality, boundary interactions and local modification.

## Invariants
- Signed CIN and CIN magnitude must not be conflated.
- Cap erosion and rebuilding must evolve over time rather than use cumulative penalties.
- Environmental fields shown in products must come from the same shared profiles used by the simulation.
- Atmospheric trajectories must remain consistent with the selected scenario narrative.
