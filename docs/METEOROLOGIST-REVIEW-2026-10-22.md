# Meteorologist review of 18 days (2026-10-22)

Six seeds were run for three days each (1000, 2112, 8181, 31, 77, 404). After each convective day
(12Z to 12Z), a day package was made with `scripts/day-review-pack.mjs`. Each package has:

- the whole large-scale model (500 mb heights with the 250 mb jet, MSLP with lows and highs, the
  850 mb jet and moisture, and ascent with rain), four times a day;
- the region's mesoanalysis four times a day;
- the day's storm and tornado tracks and reports;
- a text summary with soundings.

A reviewer acting as a meteorologist read each seed's three days in order. It named each day's
setup type and found real analog days, all checked by web search.

Per-day reviews: `data/day-reviews/2026-10-22/seed-*/day-*/review.md` (git-ignored, with the
charts).

## Setups and analogs

| Seed / day | Setup type | Real analogs (match) | Tornadoes | Category issued at 13Z / justified | Ratings: synoptic / meso / outcome |
|---|---|---|---|---|---|
| 1000 / 1 | Fast near-zonal westerlies, strong EML: capped warm sector, high-based dryline supercells | 25 May 2016 (moderate); 1 May 2018 (loose) | 0 | SLGT / MRGL | 6 / 5 / 4 |
| 1000 / 2 | Progressive short wave, deepening Plains cyclone; region dry-slotted in the jet's left exit; nocturnal-LLJ tornado | 13 Apr 2018 (moderate); 6 Mar 2017 (loose) | 1 (EF2, 2 am, unreported) | MRGL / SLGT | 7 / 5 / 6 |
| 1000 / 3 | Dryline bulge east of a slow, nearly stacked low under a weak trough | 24 May 2016 (strong meso, moderate synoptic); 22 May 2016 (loose) | 10 (2 EF2) | ENH / ENH | 7 / 8 / 6 |
| 2112 / 1 | Fast, positively tilted short wave in strong SW flow, too early in the day; dryline + Pacific front | 26 Apr 2016 (moderate); 26 Apr 2009, 1 May 2018 (loose) | 3 | ENH / MRGL | 6 / 5 / 4 |
| 2112 / 2 | Fast zonal flow on the northern edge of a ridge; stationary front + outflow boundaries; messy mixed-mode | 3 Jun 2014 (moderate); 19 May 2010 (moderate) | 8 (EF0-1) | ENH / MDT on reports, ENH physically | 7 / 6 / 3 |
| 2112 / 3 | Surface ridge behind the front, weak flow: a down day | 4 May 2018 (moderate); 4 Jun 2014 (loose) | 0 | TSTM / TSTM | 7 / 7 / 7 |
| 8181 / 1 | High Plains upslope in weak flow off a strong surface high | 31 May 2010 Campo CO (moderate); 5 Jun 2009 Goshen Co. WY (moderate) | 5 (EF0-1) | SLGT / SLGT | 6 / 6 / 6 |
| 8181 / 2 | Strong SW flow and jet streak ahead of an open trough; lee low at the NW corner, dryline, capped EML warm sector | 10 May 2010 OK (strong); 24 May 2011 (moderate); 23 May 2008 (loose-moderate) | 12 (2 EF4) | MDT / MDT | 7 / 7 / 4 |
| 8181 / 3 | Fast zonal flow behind the trough; Pacific front + dryline; high shear, low SRH | 10 Apr 2001 MO hailstorm (moderate); 21 Jun 2020 (loose) | 1 | SLGT / SLGT | 7 / 6 / 5 |
| 31 / 1 | Fast low-amplitude WNW flow, weak low and warm front; high shear, moderate CAPE | 1 May 2018 (moderate-loose); 19 May 2010 (loose) | 0 | ENH / SLGT | 6 / 6 / 5 |
| 31 / 2 | Post-trough NW flow, then a ridge and return flow; late-night dryline supercells on the LLJ | 13 Apr 2012 (moderate); 14-15 Apr 2012 Woodward (loose) | 2 (EF0) | MRGL / MRGL | 7 / 6 / 7 |
| 31 / 3 | SW flow ahead of a slow, amplified western trough; very moist, barely capped; supercells to QLCS | 20 May 2019 (strong); 18 May 2017 (moderate); 24 May 2016 (loose) | 11 (1 EF3) | MDT / ENH | 6 / 6 / 7 |
| 77 / 1 | Upper ridge passing, surface high retreating: first day of return flow, weak upslope dryline | 16 May 2005 (strong); 4 Jun 2009 (moderate); 15 May 2016 (loose) | 1 (EF0) | MRGL / MRGL | 7 / 5 / 7 |
| 77 / 2 | Morning short wave, then WNW flow; outflow-boundary and dryline day | 15 May 2022 (moderate); 4 May 2020 (moderate) | 1 (EF1) | SLGT / SLGT | 7 / 7 / 5 |
| 77 / 3 | Strong zonal jet over an EML-capped warm sector, lee cyclone; storms only at night (tornado cap bust) | 1 Apr 2025 (moderate); 30-31 May 2008 (moderate, night only); 12 Apr 2022 (loose) | 0 | ENH / SLGT | 7 / 7 / 6 |
| 404 / 1 | Low-amplitude short wave in backing westerlies; dryline + evening LLJ ramp | 25 May 2016 (moderate); 28 May 2013 (moderate) | 6 (1 EF3) | SLGT / SLGT | 6 / 6 / 5 |
| 404 / 2 | Fast zonal-WNW flow, jet streak overhead, deep lee low + dryline under an EML: capped, high shear | 29 May 2008 (moderate pattern, poor outcome); 20 May 2019 (loose) | 2 (EF0) | ENH / MRGL-SLGT | 6 / 6 / 5 |
| 404 / 3 | Zonal flow + EML, moisture-boundary "ring of fire"; hail and wind supercells growing upscale | 31 May 2008 (moderate); 3 Jun 2014 (moderate) | 1 | ENH / ENH | 7 / 7 / 8 |

**Variety.** The setups span:

- capped zonal-flow days and capped high-shear busts;
- progressive short waves and cyclones with dry slots;
- dryline bulges near a slow low;
- upslope days;
- northwest-flow and outflow-boundary days;
- ring-of-fire hail days;
- quiet days behind a front.

**What was missing.** None of the 18 days was:

- a closed or cut-off upper low;
- a negatively tilted trough;
- a derecho.

All six 3-day sequences were judged realistic, typical of late spring in the Plains. The
reviewers judged the large-scale flow the most convincing part, with synoptic ratings of 6-7 on
every day.

The analogs cluster in late April to early June. Seed 77 day 3 mixed March-strength jets with
June heat.

## Problems found on several days

Ordered by how many reviewers raised them.

1. **Hail is too small and too rare** (all 6 seeds).
   - The largest stones were 1.25-2.5 in on days with 3,000-5,000 J/kg MLCAPE and 8-9 C/km lapse
     rates. Several supercell days had zero hail reports. The real analogs had 150-270 hail
     reports and 3-4.5 in stones.
   - Wind reports are rare too, except seed 2112 day 2. That day had 362 wind reports from
     scattered supercells in one 500-mile box, more than some national single-day totals.
   - Wind reports are laid along supercell tracks whatever the storm type.
2. **The regional surface pressure does not follow the large-scale model.**
   - Highs of 1026-1040 hPa sit in 80s/60s F air.
   - A 992 hPa region low appeared under a ~1016 large-scale field.
   - Pressure jumped about 11 hPa in 3 h at the 06Z region slide.
   - Fronts are drawn without pressure troughs.
3. **The front labels are unstable.** The same moisture edge is called cold, then stationary,
   then dryline, then warm, from one 3-hourly analysis to the next. Some fronts appear and vanish.
   No warm front was drawn even with a 983 hPa low in the region.
4. **Storm mode and initiation.**
   - Multicells dominate in 55-85 kt deep shear, where splitting supercells are expected.
   - Elevated and nocturnal convection is under-produced: 50-60 kt LLJs and height falls gave
     nothing after 03Z on several nights.
   - Initiation follows CIN and forcing loosely: none in an uncapped warm sector on one day,
     dozens from 7 am on another.
   - The cap was absent (CIN -2 to -9) on seed 31 day 3.
5. **Tornado strength and timing don't follow the environment.**
   - On seed 8181 day 2 both EF4s came at midday in STP 3-4. The evening peak (STP 6-7 over 35%
     of the region) gave only EF0-1s.
   - 43 of 57 EF0-1 tornadoes last exactly 10 minutes. This is the 5-minute storm tick: a tornado
     cannot end before its second tick, so short lifetimes all log as 10 min.
6. **The best environment sits at the region's edge.** All 11 of seed 31 day 3's tornadoes were
   on the north edge.
7. **Moisture is a continent-wide wall** of 15-17 g/kg south of about 35N in the large-scale model,
   not a return-flow tongue.
8. **Smaller points.**
   - The 80 km large-scale grid shows as stripes in CAPE and STP.
   - 250 mb wind was sometimes weaker than 500 mb.
   - Steering missed its targets: two "upperLow" days found none within reach (missed by 414 and
     472 km).
   - The world's first 3 hours jump while the new world settles (seed 2112 day 1: 850 mb wind
     17 to 81 kt).

### Chart issues fixed after the review

- The 12-hour height change appeared only when the region had not slid since the chart before.
  It now lines up by model column.
- Overnight times are marked "overnight". "Day 1 1130Z" was the next morning, not before the day
  began.
- The README now says why the first chart's ascent panel is blank.

## Running it again

```
node scripts/day-review-pack.mjs --seeds 1000,2112 --days 3 --out data/day-reviews/<date>
```

This takes about 25 s per simulated day; seeds run in parallel (6 seeds x 3 days took 3 min).
Charts are SVG turned into PNG by headless Chrome or Edge (`CHROME=` picks one; `--no-png` skips
the PNGs). Then a reviewer reads each `seed-*/` folder with `README.md` and writes `review.md` per
day.
