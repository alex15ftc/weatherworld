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

Eight worlds (seeds 1 to 8), 160 to 320 days. Earlier figures in the working log from three
worlds ran high: two of the eight are quieter than the rest.

| | |
|---|---|
| Days with a tornado | 85-88% (world by world: 78, 88, 85, 93, 93, 95, 98, 55%) |
| Days with no severe weather anywhere | 4-5% |
| Days with EF2+ winds / EF4+ winds | 61% / 26% |
| Tornadoes per day, median (90th) | 10 (60) |
| Storms per day, median | 235 |
| Days with 1 in hail / 2 in hail | 89% / 58% |
| Days with 58 mph wind / 75 mph wind | 96% / 77% |

**Risk categories** are this world's own (`js/forecast/worldRiskCategories.js`), fitted to its
climate so that the mix of days is the one wanted. By the real-world rules the same days
would be 47% Moderate and 31% High.

| | Below Slight | Slight | Enhanced | Moderate | High |
|---|---|---|---|---|---|
| Wanted | 5% | 30% | 40% | 20% | 5% |
| On 160 days not used in the fit | 5% | 28% | 41% | 21% | 5% |

| Category | Tornado | EF2+ tornado | 1 in hail | 2 in hail | 58 mph wind | 75 mph wind |
|---|---|---|---|---|---|---|
| Slight | any | any | any | any | 17% | any |
| Enhanced | 39% | 13% | 79% | 16% | 96% | 63% |
| Moderate | 70% | 35% | 93% | 48% | - | 93% |
| High | 91% | 63% | - | - | - | 97% |

(Chance within 25 miles of a point; a place reaches a category when any one hazard does.)

| A day in each category (medians) | Tornadoes | Storms | Days with a tornado |
|---|---|---|---|
| Slight | 2 | 146 | 71% |
| Enhanced | 15 | 230 | 98% |
| Moderate | 43 | 292 | 100% |
| High | 80 | 353 | 100% |

**Across the map.** The playable 500 miles starts at the foot of the high ground
(`geographyOffset` 15): the dry high plains and the dryline's home lie just west of it.
Share of days with severe weather in each tenth of the map, west to east:
14, 47, 65, 72, 71, 68, 64, 61, 58, 52%. West half 54% against east half 61%; for tornadoes
14% against 14% (they peak mid-map: 0, 6, 16, 23, 26, 23, 18, 12, 9, 6%). North to south it is
even. The westernmost and southernmost 50 miles are low (edge effects).

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
| Radar picture | built from that state and geometry; the fine texture is drawn | part drawn |

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

## Open

1. Day 1-3 outlooks, watches and warnings, on this world's risk categories (done: the categories themselves).
   Also: the quiet world (seed 8), and the low western and southern edge strips.
2. Getting players to the weather: place selection, travel, or a smaller map.
3. Longer-lived tornadoes, or a slower clock, so that tornadoes can be chased.
4. Storm size and shape for 3D objects in Roblox.
5. Storm update done (budgets, rotation and tornado lifetime, shape, interactions). Left over: 75 mph wind on about 70% of days may be more than wanted; ordinary storms in weak shear last too long; mergers are still a distance rule.
6. Stronger fronts and real warm fronts.
7. The Roblox region feed and hosting.
8. Remove or replace the old outlook pages and tile routes (see `ARCHITECTURE.md`).
