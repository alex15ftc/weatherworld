# Status (2026-10-12)

What the world does now, how natural each part is, what a player would find, and what is
open. Numbers are from 90 simulated days on three seeds unless noted. The working log with
every measurement is `ATMOSPHERE-REDESIGN.md`.

## Goals

- A storm's behaviour comes only from the fields. How common severe weather is comes only
  from the climate settings and from where the region sits.
- Slight risk or better on 95% of days, higher risks rarer as they go, some tornado risk
  every day, no quiet days.
- More severe than real life, with storms that can be shown as 3D objects in Roblox.

## How active it is

Eight worlds (seeds 1 to 8), 240 to 320 days. Earlier figures in the working log from three
worlds ran high.

| | |
|---|---|
| Days with a tornado | 83-85% (world by world: 77, 93, 70, 87, 90, 97, 93, 70%) |
| Days with no severe weather anywhere | 5% |
| Tornadoes on a Slight / Enhanced / Moderate / High day (medians) | 1 / 10 / 28 / 65 |
| Storms on a Slight / Enhanced / Moderate / High day (medians) | 100 / 167 / 219 / 345 |

**Risk categories** are built as the Storm Prediction Center builds its own (as changed in
March 2026): the chance of each hazard only at fixed contour levels, a conditional intensity
group (CIG1-3; two for hail), and a table that turns the two into a category. The table's
entries are this world's own (`js/forecast/worldRiskCategories.js`); by the real table 44% of
days here would be High.

| | Below Slight | Slight | Enhanced | Moderate | High |
|---|---|---|---|---|---|
| Wanted | 5% | 30% | 40% | 20% | 5% |
| 320 days, eight worlds | 7% | 28% | 40% | 20% | 5% |

Category by contour level (rows) and intensity group (columns):

| Tornado | none | CIG1 (EF2+) | CIG2 (EF3+) | CIG3 (EF4+) |
|---|---|---|---|---|
| 2% | Marginal | Marginal | Slight | - |
| 5% | Slight | Slight | Slight | - |
| 10% | Slight | Slight | Slight | Enhanced |
| 15% | Slight | Slight | Enhanced | Enhanced |
| 30% | Slight | Enhanced | Enhanced | Moderate |
| 45% | Enhanced | Enhanced | Moderate | Moderate |
| 60% | Enhanced | Moderate | Moderate | High |

| Wind | none | CIG1 (75 mph) | CIG2 (85 mph) | CIG3 (96 mph) |
|---|---|---|---|---|
| 5% | Marginal | Marginal | Slight | - |
| 15%, 30% | Slight | Slight | Slight | - |
| 45% | Slight | Slight | Slight | Enhanced |
| 60% | Slight | Slight | Enhanced | Enhanced |
| 75%, 90% | Slight | Enhanced | Enhanced | Moderate |

| Hail | none | CIG1 (2 in) | CIG2 (3.5 in) |
|---|---|---|---|
| 5% | Marginal | Marginal | Slight |
| 15%, 30% | Slight | Slight | Slight |
| 45% | Slight | Slight | Enhanced |
| 60% | Slight | Enhanced | Enhanced |

A High day is a 60% tornado area with violent tornadoes. Medians: Slight 2 tornadoes,
Enhanced 9, Moderate 31, High 53. `npm run inspect:risk` records what each day reaches and
prints the mix the tables give (`--from file` re-reads a saved run after a table is edited).

**Across the map, and from day to day.** The map roams along the geography: each day it
moves 50 to 150 miles one way or the other, between having the high ground over its western
edge and sitting wholly on the eastern plains, at no more than 7 mph. The dryline and the
storms that form along it therefore fall on a different part of the map each day.

| | Map fixed on the high ground (before) | Map fixed in the moist air | Map roaming (now) |
|---|---|---|---|
| Severe weather, west half / east half (share of days) | 13% / 53% | 54% / 61% | 37% / 57% |
| A tornado, west half / east half | 1% / 14% | 14% / 14% | 10% / 12% |
| Tornadoes by tenth of the map, west to east | 0 0 0 1 5 11 16 17 15 11 | 0 6 16 23 26 23 18 12 9 6 | 1 6 12 15 18 18 16 12 10 7 |
| Share of the map with severe weather on a median day | 43% | 68% | 51% |
| Overlap with the day before (1 = the same places) | 0.43 | 0.57 | 0.44 |
| Same for two unrelated days | 0.37 | 0.38 | 0.33 |
| Share of the map with a tornado on a median day | 8% | 9% | 7% |

North to south it is even. The westernmost and southernmost 50 miles stay low whatever the
map does: storms only start inside the map and need most of an hour to mature (see "Later,
if wanted" below).

## How natural it is

"From the fields" means the result follows from the air at that place and time. "Formula"
means a weighted score fed by the fields: no labels, vetoes or painted values, but not
physics either. "Drawn" means random or template-made by design.

| Part | How it is decided | Kind |
|---|---|---|
| Troughs, ridges, jet, pressure systems | two-layer dynamics | from the fields |
| Air masses, moisture, cap, dryline, night-time jet, cold pools | carried by the wind; heating, mixing, inertia | from the fields |
| Fronts, dryline and outflow lines on the maps | found from the fields each step | from the fields |
| Lee trough position; cap cooled by ascent; terrain as a smooth slope | fixed shapes and shares | formula |
| Where the region sits | chosen daily by look-ahead; the atmosphere itself is untouched | selection |
| Where and when storms start | lift against inhibition, with a tuned rate | from the fields |
| Storm motion | winds, rotation's deviation, cold-pool push | from the fields |
| Updraught speed | parcel theory less entrainment, loading, inhibition | from the fields |
| Hail size; gust speed | updraught speed; downdraught energy plus storm motion | from the fields |
| Cold pool strength; line organization | storm strength x downdraught energy; cold pool against shear | from the fields |
| Storm strength, organization, how long a storm lasts | three linked budgets: updraught from the inflow, rain from the updraught, cold pool from the rain; shear keeps them apart or does not | from the fields |
| Rotation aloft and near the ground | the updraught tilting the shear; near the ground it needs helicity there, a low cloud base and outflow that does not outrun the storm | from the fields |
| Splits | a rotating storm in strong shear; the left-mover's share follows how the wind turns with height | from the fields, with thresholds |
| Mergers | distance rule | formula |
| Wind from a bowing line | a share of the wind aloft, where a line has a deep cold pool and heavy rain | from the storm's state and the fields |
| Help from an outflow boundary | extra rotation near the ground where the inflow crosses the edge of older rain-cooled air | from the fields |
| Life-cycle phase | a name for where the budgets are heading; scales the radar picture only | description |
| Whether a tornado forms | a rate set by the storm's low-level rotation, which builds for minutes first; chance decides only the minute | statistical, from the storm's state |
| How long a tornado lasts | until the storm's outflow wraps around it (occlusion), sooner under weak rotation or strong outflow | from the storm's state |
| How strong a tornado gets | its wind follows the low-level rotation; each tornado has its own draw within that | part drawn |
| Hazard "probabilities", confidence, event tags | display scores | formula (display only) |
| Storm shape (geometry) | from the storm's state and the wind through its depth | from the storm's state and the fields |
| Radar picture | where the wind through the storm carries the precipitation its updraughts make (`PrecipitationField.js`); how each updraught's output varies from minute to minute is drawn | from the storm's state and the fields; part drawn |

In short: the atmosphere is natural throughout. For storms, where they are, when, how they
move and how big their hail and wind get are natural; how strong, organized and rotating a
storm becomes is by formula; a tornado's own details are drawn, because nothing at this scale
can decide them. Nothing reads a storm's type name (tested by scrambling the names).

What is not natural enough yet:

- **Tornado days are 80-82%**, down from about 90% before the storm update: a tornado now
  needs low-level rotation, which favours the evening (56% start between 6 pm and midnight).
- **Fronts are weak**: 4-5 F across 60 miles (real 10-25), 11 mph, warm fronts rare.
- **A storm crossing an old outflow boundary gets no boost** to its low-level shear.
- **Low-level shear is high**: afternoon helicity is about double the real median.

## The Day 1 outlook

Issued by the server when it starts and at each 12Z, from eight forecast runs (about 25
seconds). Page: `/day1.html`. Laid out as the Storm Prediction Center's: the categorical map;
tornado, wind and hail maps showing the chance only at the fixed contour levels, with the
intensity groups hatched over them (CIG1 broken lines, CIG2 solid, CIG3 crossed); and a
discussion that gives no exact chances.

Checked on 30 outlooks (six worlds, five days each, six runs per outlook), with the first
version of the category table:

| | |
|---|---|
| Highest category of the day right / within one | 63% / 100% |
| Category right, place by place | 78% of the map (within one: 97%) |
| The day's tornado count inside the range of the forecast runs | 83% of days |

| Places inside the contour | 2% | 5% | 10% | 15% | 30% | 45% | 60% | 75% | 90% |
|---|---|---|---|---|---|---|---|---|---|
| A tornado came within 25 miles | 2% | 6% | 12% | 25% | 42% | 64% | 87% | | |
| 58 mph wind did | | 3% | | 16% | 44% | 77% | 89% | 97% | 100% |
| 1 in hail did | | 5% | | 16% | 46% | 70% | 86% | | |

| Inside the intensity group | EF2+ within 25 miles | EF3+ | EF4+ |
|---|---|---|---|
| none drawn | 2% | 0% | 0% |
| CIG1 | 15% | 5% | 3% |
| CIG2 | 45% | 22% | 7% |

Not yet done: the outlook has not been re-verified since the category table was set; one
outlook a day with no updates; Days 2 and 3.

**Open decision: the real table with a smaller radius.** The user would rather keep the Storm
Prediction Center's own table and make High days rare by taking the chance within 10 or 15
miles of a point instead of 25. Measured on 320 days (`node scripts/risk-radius.mjs`), by the
real table:

| Chance within | Intensity group from | Below Slight | Slight | Enhanced | Moderate | High |
|---|---|---|---|---|---|---|
| 25 miles | the strongest report in the contour | 8% | 9% | 18% | 23% | 43% |
| 15 miles | the strongest report in the contour | 12% | 12% | 15% | 23% | 38% |
| 10 miles | the strongest report in the contour | 16% | 11% | 16% | 20% | 37% |
| 25 miles | 30% of the reports in the contour | 8% | 11% | 52% | 22% | 8% |
| 15 miles | 30% of the reports in the contour | 12% | 13% | 47% | 23% | 5% |
| 10 miles | 30% of the reports in the contour | 16% | 13% | 45% | 22% | 4% |

The radius alone does not do it: it thins the tornado contours (a 60% tornado area is reached
on 10% of days at 25 miles, 1% at 15, never at 10), but the High days come from wind, which
covers most of the map at any radius and reaches the top intensity groups on a single gust.
What moves High is how the intensity group is decided. Nothing has been changed in the
outlook yet; it still uses 25 miles and this world's table.

## What a player would find

From `npm run inspect:players` on eight worlds (160 days). The clock runs 15 times real
time, so a simulated day is 96 real minutes.

| On the whole map | |
|---|---|
| Days with a tornado (all last 10 minutes or more) | 87% |
| Days with one down 20 minutes or more | 66% |
| Minutes of the day with a tornado on the ground somewhere (median / 90th) | 155 / 625 |
| Hours of the day with a severe storm somewhere (median) | 18.5 |
| Gaps of 24 simulated hours or more with no tornado | 17 in 160 days |

| The tornadoes | |
|---|---|
| Time on the ground (median / 90th / longest) | 15 / 30 / 60 minutes |
| Path (median / 90th / longest) | 6.5 / 22 / 76 miles |
| By peak wind, EF0 to EF4+ | 47 / 30 / 12 / 7 / 3% |
| Starting between 6 pm and midnight local | 60% |

| From one 10 x 10 mile place, on a given day | |
|---|---|
| A storm passes within 10 miles | 69% |
| A severe storm within 10 / 25 miles | 35% / 61% |
| A tornado inside the place (within 5 miles) | 2% |
| A tornado within 25 / 60 / 120 miles | 15% / 37% / 62% |
| Distance to the day's nearest tornado (median) | 72 miles |

- A tornado within an hour's drive on 37% of days (it was 13% before the storm update and
  the map change); inside one's own place on about one day in fifty.
- Tornadoes last long enough to chase: 15 simulated minutes is one real minute at the
  present clock, which is still short. The clock is a setting to be chosen.
- One world in eight is quiet (a tornado on 55% of its days), and there are still gaps of a
  day or more without a tornado.

## Later, if wanted

**Edge strips.** The westernmost and southernmost 50 miles of the map almost never get a
tornado (1% and 3-4% of days against 15-18% mid-map), because no storm can arrive from
outside the map and one that starts near the edge is not yet mature. The cure is to
simulate a strip beyond the playable area, on the west and the south, so that storms cross
into it already grown:

- make the regional layer about 56 x 56 cells and treat the eastern and northern 50 x 50 as
  the playable map (the Roblox feed crops to it; the weather pages can show all of it);
- about a quarter more computing (56 x 56 against 50 x 50);
- the geography settings (`geographyColumns`, `roamLow`, `roamHigh`) shift by the strip's
  width, and the risk categories need refitting on the playable part only.

Decided 2026-10-12: not now.

## Open

1. Outlooks: Day 1 is issued. Still to do: re-verify with the final category table, updates during the day, Days 2 and 3, watches and warnings.
   Also: the quiet world (seed 8), and the low western and southern edge strips.
2. Getting players to the weather: place selection, travel, or a smaller map.
3. Longer-lived tornadoes, or a slower clock, so that tornadoes can be chased.
4. Storm size and shape for 3D objects in Roblox.
5. Storm update done (budgets, rotation and tornado lifetime, shape, interactions). Left over: 75 mph wind on about 70% of days may be more than wanted; ordinary storms in weak shear last too long; mergers are still a distance rule.
6. Stronger fronts and real warm fronts.
7. The Roblox region feed and hosting.
8. Remove or replace the old outlook pages and tile routes (see `ARCHITECTURE.md`).
