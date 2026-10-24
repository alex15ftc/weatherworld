# Meteorologist review after groups 3 and 4 (2026-10-23)

These are seeds 1000, 2112, 8181 and 31, three days each, made with `scripts/day-review-pack.mjs`
after the storm changes (group 3) and the report-based, recalibrated outlooks (group 4). Each day
package now has the Day 1 outlook issued at 12Z (`outlook.png`, `outlook.md`). The per-day reviews
are in `data/day-reviews/2026-10-23-g34/seed-*/day-*/review.md`.

## Days and ratings

Ratings are synoptic / meso / outcome / outlook.

| Seed / day | Setup | Tornadoes | Outlook (reviewer's call) | Ratings |
|---|---|---|---|---|
| 1000/1 | Cool air north of a stacked cut-off low | 0 | TSTM (fine) | 7 / 5 / 7 / 7 |
| 1000/2 | Moisture return under a departing high; one SW-corner supercell, storms on the night jet | 1 EF0 | SLGT (MRGL) | 7 / 6 / 6 / 5 |
| 1000/3 | Warm sector under a deep, slow trough closing off; mostly lines | 10 (1 EF2) | SLGT (ENH) | 8 / 6 / 5 / 5 |
| 2112/1 | High behind the front; upslope supercells in the SW corner | 2 | TSTM (MRGL) | 6 / 5 / 6 / 4 |
| 2112/2 | SW flow, jet-streak right entrance, warm front and dryline; night supercells | 3 EF0 | SLGT, verified well (ENH with hail hatching) | 8 / 7 / 6 / 7 |
| 2112/3 | Zonal jet, strong cap, null afternoon, storms after midnight | 0 | MRGL (right category, area too small) | 7 / 6 / 7 / 6 |
| 8181/1 | Dryline / weak lee-low outbreak under a fast short-wave | 25 (1 EF4, 1 EF2) | HIGH (MDT, upgrade possible later) | 7 / 7 / 6 / 6 |
| 8181/2 | Capped day after the trough; night jet brings moisture back | 0 | TSTM | 7 / 6 / 6 / 6 |
| 8181/3 | Conditional dryline near a 990 hPa low; the cap held | 0 | TSTM (MRGL/SLGT "if storms form") | 6 / 6 / 5 / 5 |
| 31/1 | NW-flow ridge-rider: storms on a moisture edge | 0 | TSTM (SLGT) | 7 / 6 / 4 / 4 |
| 31/2 | High Plains lee trough under strengthening SW flow | 2 EF0 | 2% tornado (more, with hail and wind) | 7 / 7 / 6 / 6 |
| 31/3 | Ridging, capped null day, night jet | 0 | TSTM (fine) | 6 / 5 / 7 / 8 |

**Mean ratings:** synoptic 6.9, meso 6.0, outcome 5.9, outlook 5.8. After the jet review the means
were synoptic 6.8, meso 6.1 and outcome 5.3.

## What improved

- **Night storms:** storms now start at night on the low-level jet, and others carry on overnight.
- **Supercells:** deep shear makes them; multicell time in strong shear fell (seed 2112 day 1: 58% to
  49%; day 2: 19%).
- **The cap holds,** with almost no morning storms.
- **Hail is better on some days** (seed 2112 day 2: 44 reports up to 2.5 in; seed 8181 day 1: 250
  reports up to 3 in).
- **Tornado strength follows the environment on several days:** the one EF4 came inside the High
  area at STP about 5, and EF0s came at STP about 1.
- **The jet has distinct speed maxima.**
- **Outlook placement and probabilities verify well.**
  - Seed 1000 day 3: all 10 tornadoes were inside the 2% area.
  - Seed 8181 day 1: the 30% and 45% areas held the EF4 and the EF2.
  - Seed 2112 day 2: the 30% hail centre sat on the swath.

## What is still wrong (by how many reviewers raised it)

1. **The top end is too weak** (all four reviewers).
   - Tornadoes:
     - seed 8181 day 1: 92% EF0-1 under STP 5-7 for 9 hours;
     - seed 2112 day 2: three EF0s from about 30 rotating storms at STP 4-5;
     - most weak tornadoes last exactly 10 minutes.
   - Hail on high-CAPE days:
     - seed 1000 day 3: 1.25 in largest from 11 reports at 4,000+ J/kg;
     - seed 8181 day 1: only 3 of 250 reports at 2 in or more.
   - Because of this, the bold EF3+ and 2 in hatching busts.
2. **Wind reports are almost absent** (all four). There were none on most days, 1 on seed 2112
   day 2, none from a QLCS (seed 31 day 1) and none from 219 storms (seed 1000 day 3). So the
   outlooks issue no wind probabilities. The report model's damage chance and narrow burst swath
   (group 1) look overcorrected.
3. **Outlook shapes and text** (all four).
   - Hatching covers every contour down to 5%, because inner areas inherit their parent's group.
     The SPC hatches the core.
   - The High area was a tiny blob, and the Marginal areas are too small.
   - The discussion text has factual slips:
     - "weak (25-35 kt) shear" when the data had 40-52 kt;
     - "most likely 06Z-09Z" when storms began at 18Z;
     - "the air is dry" with 60 F dewpoints;
     - "supercells possible" under "no severe areas";
     - fronts, troughs and lows are never named.
   - Categories run a step low on high-instability days.
4. **Regional pressure is still off on some days** (three reviewers): 1036-1046 hPa highs, and a low
   about 10 hPa too deep. That is the sliding-window design (docs/FIX-PLAN-2026-10-22.md group 2).
5. **The best environment sits at the map's edge** on most days (three reviewers).
6. **Smaller points.**
   - Storm tracks jog at right angles, likely identity swaps at mergers.
   - MLCAPE of 4,000-4,800 J/kg may be too high for the moisture.
   - The regional shear field is flat.
