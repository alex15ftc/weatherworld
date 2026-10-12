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

| | Region fixed | Region steered (now) |
|---|---|---|
| Quiet days (no severe report on the map) | 21% | 3-6% |
| Below Slight | 25% | 3-6% |
| Slight / Enhanced / Moderate / High | 21 / 20 / 14-24 / 9-16% | 12 / 36 / 27 / 20% |
| Days with a tornado | 64-70% | 88-93% |
| Days with a tornado with EF2+ winds | 37-41% | 64% |
| Days with 1 in hail / 58 mph wind / 75 mph wind | 75 / 55 / 4% | 92 / 76 / 2% |
| Storms per day, median | 50 | about 100 |

The floor is met. The top end is not: the categories are the real-world ones, and a world
made more violent than the real one passes their thresholds often. Decided: the categories
are to be defined for this world's own climate when the outlooks are rebuilt, not tuned
through the atmosphere.

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
| Storm strength (intensity), organization | weighted scores relaxing toward a target | formula |
| Rotation (mesocyclone) | weighted score of helicity, shear, cloud base, inflow | formula |
| Splits and mergers | threshold and distance rules | formula |
| Life-cycle phase | thresholds on age and strength; scales the radar picture, and weakens rotation in the "weakening" phase | formula |
| Whether a tornado forms | a rate from rotation and the inflow's ingredients | statistical, from the fields |
| How long a tornado lasts and how strong it gets | drawn once per tornado; the scale follows the ingredients | drawn |
| Hazard "probabilities", confidence, event tags | display scores | formula (display only) |
| Radar picture and storm shape | templates scaled by the storm's properties | drawn |

In short: the atmosphere is natural throughout. For storms, where they are, when, how they
move and how big their hail and wind get are natural; how strong, organized and rotating a
storm becomes is by formula; a tornado's own details are drawn, because nothing at this scale
can decide them. Nothing reads a storm's type name (tested by scrambling the names).

What is not natural enough yet:

- **Storm strength never passes 0.8** of full, which caps gusts.
- **No 75 mph winds to speak of** (2% of days): downdraught energy stays below real
  derecho values and there is no mechanism for a bowing line to bring fast air down.
- **Fronts are weak**: 4-5 F across 60 miles (real 10-25), 11 mph, warm fronts rare.
- **A storm crossing an old outflow boundary gets no boost** to its low-level shear.
- **Low-level shear is high**: afternoon helicity is about double the real median.

## What a player would find

From `npm run inspect:players`. The clock runs 15 times real time, so a simulated day is 96
real minutes.

**On the whole 500 x 500 mile map**

| | |
|---|---|
| Days with a tornado | 88% |
| Days with a tornado on the ground 10 minutes or more | 72% |
| Days with EF2+ winds / EF4+ winds | 64% / 34% |
| Tornadoes per day (10th / median / 90th) | 0 / 7 / 35 |
| Minutes of the day with a tornado on the ground somewhere (10th / median / 90th) | 0 / 76 / 357 |
| Hours of the day with a severe storm somewhere (median) | 10 |
| Wait from one tornado to the next, when there is a gap (median / 90th / longest) | 1 h / 9 h / 53 h |
| Gaps of 24 simulated hours or more with no tornado | 14 in 90 days |

**The tornadoes**

| | |
|---|---|
| Time on the ground (median / 90th / longest) | 4 / 25 / 62 minutes |
| Lasting 10 minutes or more / 20 or more | 25% / 13% |
| Path (median / 90th / longest) | 1.3 / 12 / 69 miles |
| By peak wind, EF0 to EF5 | 41 / 32 / 14 / 8 / 4 / 1% |
| Starting between noon and midnight local | 76% |

**From one 10 x 10 mile place**

| On a given day | |
|---|---|
| A storm passes within 10 miles | 40% |
| A severe storm within 10 miles / 25 miles | 14% / 28% |
| A tornado inside the place (within 5 miles) | 1% |
| A tornado within 25 / 60 / 120 miles | 10% / 26% / 48% |
| A tornado lasting 10 minutes or more within 60 miles | 13% |
| Distance to the day's nearest tornado (median) | 108 miles |

What this means for the game:

- **The map is active; a single place is not.** A tornado is somewhere on the map most
  days, but it enters any one place about one day in a hundred (about 160 real hours at the
  present clock). Players must be able to go to the weather, or be sent to it.
- **Most tornadoes are too brief to chase.** Three in four are down for under 10 simulated
  minutes, which is 40 real seconds at the present clock; the median is 16 real seconds.
- **There are still dead stretches**: 14 gaps of a simulated day or more without a tornado
  in 90 days.
- **The clock decides the feel.** At 15 times real time a storm crosses a place in about a
  minute. The clock is a setting still to be chosen.

## Open

1. Risk categories defined for this world's climate; Day 1-3 outlooks, watches and warnings.
2. Getting players to the weather: place selection, travel, or a smaller map.
3. Longer-lived tornadoes, or a slower clock, so that tornadoes can be chased.
4. Storm size and shape for 3D objects in Roblox.
5. Physical storm strength in place of the weighted score; wind from bowing lines.
6. Stronger fronts and real warm fronts.
7. The Roblox region feed and hosting.
8. Remove or replace the old outlook pages and tile routes (see `ARCHITECTURE.md`).
