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

**Risk categories** are the Storm Prediction Center's own (as changed in March 2026): the
chance of each hazard within 25 miles, only at the fixed contour levels; a conditional
intensity group (CIG1-3; two for hail); and the centre's own table turning the two into a
category (`js/forecast/spcOutlookRules.js`). Nothing in the table is this world's.

What is this world's own is how an intensity group is decided, since the centre's
forecasters judge it: each area inside a contour is given the highest tier that at least
30% of the reports in it reach (`CIG_SHARE`, `contourCig` in
`js/forecast/worldRiskCategories.js`). The same rule reads the forecast runs and the
reports that verify them.

| | Below Slight | Slight | Enhanced | Moderate | High |
|---|---|---|---|---|---|
| First wanted | 5% | 30% | 40% | 20% | 5% |
| 320 days, eight worlds | 7% | 10% | 52% | 23% | 8% |

The user accepted this mix to keep the centre's table and its 25 miles. Medians: Slight 1
tornado, Enhanced 7, Moderate 18, High 36. Slight is thin and Enhanced fat because damaging
wind is widespread here; only the storms' wind would change that. `npm run inspect:risk`
prints the mix. Tried and set aside: this world's own table (hit the wanted mix, but was not
the real table); a smaller radius (10 or 15 miles: thins the tornado contours but High stays
near 38%, since wind makes those days; `node scripts/risk-radius.mjs`); the group from the
single strongest report in a contour (High 43%); the group point by point (High 33%).

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

## The outlooks

| Outlook | Covers | Issued afresh | Gives |
|---|---|---|---|
| Day 1 (`/day1.html`) | the outlook day in progress (12Z to 12Z) | every 6 hours: 12Z, 18Z, 00Z, 06Z | tornado, wind and hail, each with intensity groups; up to High |
| Day 2 (`/day2.html`) | the next outlook day | every 12 hours: 12Z, 00Z | the same as Day 1 |
| Day 3 (`/day3.html`) | the one after | every 24 hours: 12Z | one chance, of any severe weather (5 to 60%), two intensity groups; up to Moderate |

All three are also issued when the server first has a world. Each is the centre's layout:
the categorical map, the chances only at the fixed contour levels, the intensity groups
hatched (CIG1 broken lines, CIG2 solid, CIG3 crossed), and a discussion that gives no exact
chances. The maps are drawn from outlines traced on the server, not from images.

One set of runs serves every outlook due, all started at the same time, one process each.
Day 1 is made from eight runs, Day 2 from four of them and Day 3 from two
(`OUTLOOK.memberShare`), so at 12Z two runs go 72 hours ahead, two more 48 and four 24; at
00Z four go 36 hours and four 12. That is 720 run-hours per world day; with all eight going
the whole way it was 1,056, and with one outlook a day 192.

Fewer runs make the later outlooks cheaper, not vaguer: without the doubts below, four runs
give the same Day 2 as eight and two the same Day 3 (peak tornado chance 42 against 42, and
34 against 35, averaged over four worlds), because the runs agree with one another.

**What a forecast run costs.** A 24-hour run took 14.2 s of one processor and takes 9.2 s,
with the same result to the last digit shown (same storms, same tornadoes, same chances):

| Saving | A 24-hour run |
|---|---|
| as it was | 14.2 s |
| the storms' radar pictures left out of forecast runs (nothing in a storm's behaviour reads them) | 11.4 s |
| fast Fourier transforms in the forecast runs' large-scale model (the live world keeps the plain ones, so its history is unchanged) | 10.7 s |
| the most unstable parcel found by lifting each candidate for its CAPE alone (every sounding identical; the live world gains too) | 10.0 s |
| the wet-bulb zero height without copying the profile; no plan made for a world that is about to be given its saved one | 9.2 s |

With the fewer runs for Days 2 and 3, a world day of outlooks costs about 275 s of processor
time against about 625 s. What is left of a run: soundings about half, the large-scale
model a tenth, tidying memory a seventh. Days 2 and 3 are also smoothed
(`OUTLOOK.spreadKm`: each run's weather stands for what could happen 40 km around it on
Day 2 and 69 km on Day 3), so two runs give one smooth area and not two blocks.

**What the forecast runs do not know** (`js/forecast/ensemblePerturbation.js`). Besides
drawing its storms' chances afresh, each run has two doubts about the atmosphere, and both
grow with the hours:

- a timing error: its weather systems travel a little faster or slower than they really
  will (1.2 m/s spread against about 22 m/s; about 50 km out through Day 1, 155 km through
  Day 2, 260 km through Day 3);
- its own weather far upstream: nothing differs within 700 km west of the map, and the
  difference is full from 4,200 km west (about two days' travel). In the large-scale model
  the difference over the map is nil at issue time, 15% of the model's own variation after
  one day, 31% after two and 41% after three.

On four worlds (`node scripts/outlook-spread.mjs`), the runs' severe weather was centred 14,
9 and 8 miles apart on Days 1, 2 and 3 without these doubts, and 17, 30 and 43 miles apart
with them; on one world the runs' Day 3 tornado counts went from 42-56 to 28-119. What
"vaguer" looks like depends on the day: where the severe weather is a compact area, the
later outlooks spread it wider at lower chances; where it would cover the whole map
whatever happens upstream, the chances stay high and the doubt shows in the numbers of
storms and in the discussion. A quiet Day 3 can be forecast with a chance of severe
weather, because most of what could arrive from upstream here is severe.

**Verification** (`npm run inspect:outlook`; eight worlds, seven mornings each, the outlooks
made as the server makes them; 56 Day 1, 48 Day 2 and 40 Day 3 outlooks):

| | Day 1 | Day 2 | Day 3 |
|---|---|---|---|
| Highest category of the day right | 77% | 71% | 68% |
| Within one category | 100% | 98% | 98% |
| Forecast too high / too low | 11% / 13% | 10% / 19% | 10% / 23% |
| Category right, place by place | 75% of the map | 58% | 48% |
| Within one, place by place | 97% | 90% | 81% |
| Forecast High / verified High | 9% / 7% | 4% / 6% | never / never (Day 3 stops at Moderate) |

Share of the places inside each contour (up to the next) where it then happened within 25 miles:

| | 2% | 5% | 10% | 15% | 30% | 45% | 60% | 75% | 90% |
|---|---|---|---|---|---|---|---|---|---|
| Day 1 tornado | 2% | 6% | 12% | 23% | 45% | 72% | 90% | | |
| Day 2 tornado | 4% | 7% | 13% | 24% | 48% | 63% | 91% | | |
| Day 1 wind | | 3% | | 15% | 46% | 77% | 93% | 99% | 100% |
| Day 2 wind | | 6% | | 22% | 50% | 74% | 89% | 98% | 100% |
| Day 1 hail | | 5% | | 17% | 47% | 72% | 89% | | |
| Day 2 hail | | 7% | | 26% | 53% | 75% | 89% | | |
| Day 3 any severe | | 16% | | 26% | 45% | 69% | 88% | | |

Every contour holds at least what it says. The later days are right about the day's highest
category nearly as often as Day 1 and much less often about where. Day 3's weak point is
outside its contours: 13% of the places it left out had severe weather within 25 miles.
**Intensity groups.** A group is a promise about how strong the weather is where it
happens, so it is checked at the places the hazard came within 25 miles (Day 1 outlooks):

| Group drawn | Tornado: EF2+ / EF3+ / EF4+ nearby | Wind: 75 / 85 / 96 mph | Hail: 2 in |
|---|---|---|---|
| none | 19% / 7% / 1% | 18% / 2% / 0% | 14% |
| CIG1 | 35% / 13% / 2% | 65% / 32% / 5% | 49% |
| CIG2 | too little drawn | 99% / 84% / 29% | never drawn |
| CIG3 | 46% / 44% / 12% | never drawn | - |

The groups mean what they say on Day 1; on Day 2 (four runs) the wind groups still do and
the tornado groups do not. The upper groups are rare because strong weather is a small share
of the weather here: of a day's reports, a median 10% of tornadoes are EF2+, 8% of gusts 75
mph and 4% of hail 2 inches, and 3.5 inch hail does not occur. Tornadoes have lower bars
for the upper groups (`CIG_SHARES.tornado`: 30%, 25%, 15%; all 30% gave CIG2 on 4% of days
and CIG3 on none, though EF3+ tornadoes come on 29% of days and EF4+ on 12%). They cannot go
much lower: a 30% tornado contour with CIG2 is a High risk in the centre's table, so 30/20/15
gives 10% High days and 20/20/20 gives 13% (8% before, about 9% now). With the lower bars
Day 2 forecast High on 10% of days against 6% verified.

Not yet done:

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

1. Outlooks: Days 1 to 3 are issued and updated. Still to do: verify them, make the runs cheaper, give Days 2 and 3 an uncertain atmosphere, watches and warnings.
   Also: the quiet world (seed 8), and the low western and southern edge strips.
2. Getting players to the weather: place selection, travel, or a smaller map.
3. Longer-lived tornadoes, or a slower clock, so that tornadoes can be chased.
4. Storm size and shape for 3D objects in Roblox.
5. Storm update done (budgets, rotation and tornado lifetime, shape, interactions). Left over: 75 mph wind on about 70% of days may be more than wanted; ordinary storms in weak shear last too long; mergers are still a distance rule.
6. Stronger fronts and real warm fronts.
7. The Roblox region feed and hosting.
8. Remove or replace the old outlook pages and tile routes (see `ARCHITECTURE.md`).
