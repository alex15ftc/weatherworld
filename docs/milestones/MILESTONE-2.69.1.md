# WeatherWorld 2.69.1 — Diurnal STP Continuity and Air-Mass Consistency

- Establishes boundary-relative sectors before the first sounding calculation.
- Replaces categorical STP air-mass penalties with fractional air-mass and parcel-validity weighting.
- Refreshes effective STP every gameplay half hour without rebuilding full soundings.
- Prevents cumulative degradation of cached raw STP between full thermodynamic cycles.
- Bounds air-mass-factor changes and permits a larger transition only during a diagnosed boundary crossing.
- Adds `world.stpContinuity` and `world.stpContinuityHistory` diagnostics.
- Flags artificial displayed-STP collapses when raw ingredients remain nearly unchanged.
