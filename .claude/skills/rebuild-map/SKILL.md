---
name: rebuild-map
description: Rebuild the WeatherWorld world map and export it to Roblox, including changing the map scale. Use when map generation (js/worldmap), scale, towns, roads or radars change.
---

# Rebuild and export the map

## Scale (only if changing it)
Two settings, always kept equal:
- `js/worldmap/scale.js`: `STUDS_PER_MILE` (and AT_1000, STUDS)
- `roblox/Shared/World/Config.luau`: `STUDS_PER_MILE`
Character-scale things (roads, lots, blocks, interchanges) stay in studs; map-scale things (town spacing, section lines, counties) stay in miles. Suburb blocks (300 studs) must divide STUDS_PER_MILE.

## Build and export
```
node scripts/build-world-map.mjs --seed 1
node scripts/export-world-roblox.mjs --seed 1
```
The export writes `Meta.studsPerMile`; WorldMap.luau warns on a mismatch.

## Check
- `node scripts/run-tests.mjs world-map`
- Radar codes come from town names: if towns changed, check `AIRFIELD_DEFAULTS.removedRadars` for seed 1 still names the right sites (the user removed KPLM, KDGL, KWAP, KGRG; 11 radars remain).
- Open in Studio and look at a town, an interchange and a suburb from the ground.
