# Meteorologist review of the jet-stream days (2026-10-23)

These are seeds 1000, 2112, 8181 and 31, three days each, made with
`scripts/day-review-pack.mjs` after the jet stream went in (docs/FIX-PLAN-2026-10-22.md, "Done: the
jet stream"). One reviewer read each seed. The per-day reviews are in
`data/day-reviews/2026-10-23-jet/seed-*/day-*/review.md` (git-ignored, with the charts). All four
reviewers read the season as mid-May to June.

## Setups and analogs

| Seed / day | Setup | Analogs (match) | Tornadoes | Ratings: synoptic / meso / outcome |
|---|---|---|---|---|
| 1000/1 | Post-frontal null day under split flow; cut-off low to the south | 10 May 2012 (fair), 11 Jun 2024 (partial) | 0 | 6 / 5 / 8 |
| 1000/2 | High Plains upslope / dryline under a ridge, isolated supercells | 5 Jun 2009 Goshen Co. WY (good), 4 Jun 2015 CO (fair) | 2 (EF1) | 7 / 6 / 7 |
| 1000/3 | Near the surface low under a trough closing off; collapsing mid-level flow, pulse storms | 19 May 2010 (fair), 21 Jun 2020 (partial) | 0 | 7 / 6 / 3 |
| 2112/1 | Cold front clears under NW flow, post-frontal high | 22 Jun 2014 (fair), 13 Jun 2026 (fair-poor) | 1 (EF0) | 6 / 5 / 5 |
| 2112/2 | SW flow ahead of a positively tilted trough, right entrance of a 130-150 kt jet streak; evening and night supercells | 23 May 2008 Quinter (good), 24-25 May 2016 (fair-good) | 2 (EF2, EF0) | 8 / 7 / 6 |
| 2112/3 | Zonal jet overhead, strong cap, dryline bust (a correct null day) | 12 Apr 2022 (fair), 7 Jun 1994 (poor-fair) | 0 | 7 / 6 / 7 |
| 8181/1 | Progressive shortwave over a dryline: supercell outbreak growing into a QLCS | 10 May 2010 (good), 23 May 2008 (fair-good), 25 May 2016 (fair) | 20 (EF4, 2 EF3, 2 EF2) | 7 / 8 / 7 |
| 8181/2 | Ridging behind the trough, hard cap, moisture return | 13 Apr 2012 (fair), 7 Jun 1994 (poor-fair) | 0 | 6 / 5 / 4 |
| 8181/3 | Dry slot under a stacked, filling closed low; dryline wrapping round it | 12 Apr 2022 (fair-good), 7 Jun 1994 (fair) | 0 | 7 / 6 / 3 |
| 31/1 | NW flow aloft, post-frontal high | 27 Jun 2013 (fair on the regime) | 0 | 7 / 6 / 4 |
| 31/2 | SW flow ahead of a weak cut-off; supercells on an outflow boundary, night clusters | 23 May 2016 (good), 24 May 2021 (fair) | 2 | 7 / 7 / 5 |
| 31/3 | Compact trough lifting out, dryline + Pacific front into 5,000-5,900 J/kg; hail/wind line | 20 May 2019 (good), 18 May 2017 (good env.), 3 Jun 2014 (fair) | 2 | 7 / 6 / 5 |

**Mean ratings:** synoptic 6.8, meso 6.1, outcome 5.3. On 2026-10-22 (no jet) the means were about
6.6 / 6.1 / 5.4.

**New setup types:** a closed low over a stacked surface low, a cut-off low south of the jet, a
jet-streak right-entrance day, an Omega/Rex block, a dry slot under a filling low, and one
negatively tilted trough (8181/2, just east of the region).

## The jet stream: the verdict

**All four call it a clear improvement and mostly realistic.**

- Closed and cut-off lows now form and decay believably: a southern cut-off drifting 10-12 m/s and
  dying over 2 days, a subtropical cut-off retrograding under the ridge, and two 528-534 dam lows in
  a 48-hour block.
- Jet streaks have sensible entrance and exit regions.
- The waves are longer and slower.
- Front labels are stable.
- More storms carry on through the night.

**Problems they found.**

1. **The jet is too strong for the season and too uniform.**
   - It runs 130-160 kt beside 606-612 dam subtropical highs. The US record is about 600 dam.
   - It is one ribbon of even width round the channel, pinned to the region's latitude, so every
     day has strong deep shear (0-6 km 90th percentile 40-78 kt) and weak-shear days will be rare.
2. **Closed lows are not cold-core.**
   - The 500 mb air under them is about -10 to -13 C; real ones are -18 to -24 C.
   - Some small 570 dam closed contours over the region are not credible, and one has the jet
     running through it.
   - The cause is the two-layer model: its temperature is only the 250-750 mb layer mean.
3. **Cut-offs rarely reach the region.** They form in the slack flow north and south, and steering
   ("no upperLow in reach") seldom gets the region under one.
4. **Surface lows under the jet are uneven.** Lee cyclones are missing under jet streaks
   (2112/2). One cut-off had a stacked 993 hPa surface low in 95-105 F air, which behaves like a
   tropical storm (1000/1).
5. **Regional pressure is still mixed.**
   - Better on 31 and 8181/1.
   - Still off on 2112/1 (1036-1044 hPa regional high against 1027-1031 large-scale) and 1000/2
     and 8181/2 (1028 against 1018-1022).
6. **Low-level moisture** is a straight east-west wall near 35-37N with weak tongues.

## Storm problems still open (group 3)

- **Hail and wind.** Zero reports on 8 of 12 days. This is the storms, not the reports:
  - seed 2112 day 2 had about 20 supercells but only 35 km of path with a core of 1 in or more,
    and 61 km of 58+ mph gust;
  - seed 1000 day 3 had 117 storms and 16 km;
  - seed 31 day 3 (100 hail reports, 3 in) and seed 8181 day 1 (67) report normally.
- **Initiation.**
  - No storms on a weakly capped dryline next to a low (8181/3).
  - The cap is too weak in the morning on 31/3: STP 5-7 over 35-49% of the region at 7-10 am, and
    27-40 storms already by 12-15Z.
- **Night.** No new storms under 45-51 kt low-level jets (8181/2, 2112/3). Storms that carry on
  from the evening do occur.
- **Mode.** Multicells dominate in strong shear (2112/1: 58% multicell; 31: 34-53%).
- **Tornado strength and timing.** This followed the environment on 8181/1 and 2112/2, but not on
  31/3 (no tornadoes 21-03Z at STP 4).
- **Best environment at the map's edge** on several days.
