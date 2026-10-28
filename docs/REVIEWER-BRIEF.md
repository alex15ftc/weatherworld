# Brief for meteorologist reviewers

WeatherWorld is the weather engine for an open-world storm-chasing MMO on Roblox. It should be as realistic as possible
within the game's requirements. Some departures from reality below are deliberate; judge everything else as you would
real days. When something is realistic only because of these choices, say so instead of counting it against the engine.

## How to rate

Rate each day 1-10 on four scales:

| Scale | What it covers |
|---|---|
| Synoptic | The large-scale pattern |
| Mesoscale | Moisture, instability, cap, boundaries, soundings |
| Storm outcome | Modes, counts, tornadoes, hail, wind, timing, reports |
| Outlook | The Day 1 outlook and its text |

Where a problem would matter to a player, say how: a storm nobody can reach, a forecast that sends chasers to the wrong
place, weather that is never interesting. Players notice those long before a 2 K error at 700 mb.

## The game's requirements and deliberate choices

1. **One shared world.** One engine runs the weather and every Roblox server shows it. Nothing is per-player or painted
   on.
2. **A 12x clock.** A game day is 2 real hours, so a 2-hour supercell lasts 10 real minutes.
   - Storms are deliberately long-lived: supercells often last 4-9 hours of game time, against 1-4 in reality, so players
     can chase them.
   - Do not count long lifetimes, or the long tracks and larger report totals they bring, as errors.
3. **The map follows the weather.** The playable map is a fixed 500 x 500-mile Plains region with fixed ground. The
   large-scale model slides under it each day so that the weather is usually interesting, much as a chaser covers the
   whole Plains. So:
   - Judge activity against "anywhere in the central US that day", not a fixed 500-mile box. A tornado on about 80% of
     days is intended.
   - Sudden changes in height tendencies or pressure at the map's middle can come from the slide. Note them, but they are
     known.
4. **Chaseable days.** The engine aims for a ground-fed supercell on as many days as is realistic (now 89%) and few days
   with no severe weather at all (now 8%).
5. **Outlook rules.** The outlooks use SPC's March 2026 category matrix and intensity groups.
   - Wind probabilities go to 90%; 30% wind with no group is Slight, 60% with none is Enhanced.
   - The outlook comes from 8 forecast runs plus a calibration, so it can honestly miss where the runs miss.
6. **Reports.** Reports come from a model of who is there to see: towns and spotters along the storm's path, at most one
   report per storm and hazard every 20 minutes. Tornadoes are all logged, seen or not.
7. **No hard-coding.** Storm behaviour comes from the fields (CAPE, shear, CIN, boundaries, cold pools), not from labels
   or painted values. A fix you suggest should be a physical one.

## What has been checked against real data

- **Warm-sector soundings at 7 pm** against 412 real Plains soundings from May 2015-2023:

  | | Engine median | Real median |
  |---|---|---|
  | Cap (MLCIN) | -56 | -50 |
  | Cloud base | 1,426 m | 1,374 m |
  | 700 mb dewpoint depression | 11.1 C | 11.6 C |

  The p10 and p90 of all three match as well.
  - MLCAPE still runs high: median 1,800 against 1,370, though the top 10% matches.
  - The sounding's heights and mixed-layer parcel follow the standard definitions since 2026-10-26.
- **Hail report sizes** against the SPC database: 2 in or larger in 13.5% of reports, against 14.1%.
- **Day categories** against SPC reports scored with the engine's own rules: close to the central US except High, about
  twice as often (10% against 4%).
- **Tornado path widths and ratings** fitted to the SPC database; damage ratings come from a survey model, not the peak wind.
  Ratings by STP band match Thompson et al. 2012 within a few points.
- **The drivers** were audited on 2026-10-26 against the literature and comparable engines:
  - severe wind follows DCAPE and storm mode;
  - line mode follows the forcing and the shear along the boundary;
  - mid-level moisture comes from the large-scale field.

## Known open items

You may confirm or refine these; they need not be rediscovered.

- **Low-level jet:** its wind directions and evening helicity match real soundings since 2026-10-26, but the overnight rise in
  0-1 km helicity is smaller than real: in 45-60 kt of deep shear the median goes about 125 to 150 from 7 pm to 7 am, against a
  real 95 to 173.
- **Time of day:** too many night and late-morning tornadoes (37% and 15%, against a real 27% and 2.5%), mostly from the
  deliberately long storm lives.
- **High days** run about four times reality (18% against 4%).
- **Rare extreme days:** shallow, superheated afternoon layers over dry ground can still reach 41-45 C (real max about 39 C).
- **Moisture spread at 500 mb:** too narrow; the median is about right.
- **Storm counts** run high on some outbreak days; the long lives are deliberate, but there are also more storm starts than
  needed.
