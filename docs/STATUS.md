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
category (`js/forecast/spcOutlookRules.js`, checked against the published table 2026-10-13).

**Intensity groups** are conditional, as the centre's are: a group says how large a share
of the severe weather is significant where it happens (tornado EF2+, wind 75 mph, hail 2
in). The centre's tornado groups go with about 7% of tornadoes EF2+ where none is drawn,
20% in CIG1, 30% in CIG2 and 40% in CIG3. Each area inside a contour is judged as a whole
from the reports in it (`contourCigAreas`), so the hatching follows the contours.

Where the bars between groups stand is this world's own (`CIG_BOUNDS` in
`js/forecast/worldRiskCategories.js`), because the centre's would make one day in five a
High risk here (strong tornadoes are a larger share of this world's, and a 30% tornado
contour is reached on a quarter of days):

| Least share of an area's reports that is significant | CIG1 | CIG2 | CIG3 |
|---|---|---|---|
| The centre's tornado groups imply about | 13% | 25% | 35% |
| Tornado (EF2+) | 20% | 50% | 65% |
| Wind (75 mph) | 30% | 65% | 85% |
| Hail (2 in) | 15% | 30% | - |
| Any severe weather, Day 3 | 30% | 60% | - |

| 320 days, eight worlds | Below Slight | Slight | Enhanced | Moderate | High |
|---|---|---|---|---|---|
| First wanted | 5% | 30% | 40% | 20% | 5% |
| Measured (upper wind bars at 60% and 80%; since raised a little) | 7% | 11% | 44% | 27% | 11% |

How often a contour that is reached comes hatched: tornado 15% contour 42% of the time,
30% contour 53%, 60% contour 63% (23%, 32% and 39% before the tornado change and these
groups); wind CIG1 on about 15% of days and CIG2 on 2-4%; hail CIG1 on about 11% of days
(1-2% before). The upper groups stay rare because the centre's table makes a 30% tornado
contour or a 60% wind contour with CIG2 a High risk. `npm run inspect:risk` prints the mix.

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
made as the server makes them; 56 Day 1, 48 Day 2 and 40 Day 3 outlooks; 2026-10-13, with
the tornado numbers and intensity groups as they are now):

| | Day 1 | Day 2 | Day 3 |
|---|---|---|---|
| Highest category of the day right | 70% | 67% | 70% |
| Within one category | 100% | 94% | 98% |
| Forecast too high / too low | 14% / 16% | 10% / 23% | 10% / 20% |
| Category right, place by place | 75% of the map | 57% | 47% |
| Forecast High / verified High | 11% / 13% | 6% / 13% | Day 3 stops at Moderate |

Share of the places inside each contour (up to the next) where it then happened within 25 miles:

| | 2% | 5% | 10% | 15% | 30% | 45% | 60% | 75% | 90% |
|---|---|---|---|---|---|---|---|---|---|
| Day 1 tornado | 2% | 7% | 11% | 23% | 47% | 77% | 86% | | |
| Day 2 tornado | 3% | 8% | 13% | 26% | 48% | 70% | - | | |
| Day 1 wind | | 3% | | 15% | 46% | 77% | 93% | 99% | 100% |
| Day 1 hail | | 5% | | 17% | 47% | 72% | 89% | | |
| Day 3 any severe | | 16% | | 26% | 45% | 69% | 88% | | |

Intensity groups, at the places the hazard came within 25 miles (Day 1): with no group
drawn 11% had an EF2+ tornado nearby, in CIG1 32%; wind 18%, 63% and 84% had a 75 mph gust
(none, CIG1, CIG2); hail 12%, 36% and 49% had 2 inch hail. On Day 2 the wind and hail groups
hold (22% / 64% / 82%; 13% / 30%) and the tornado groups do not (15% against 22%): four runs
are too few to say how strong the tornadoes will be. Day 2 is also too low more often than
too high. Day 3 leaves 12% of the places with severe weather outside its contours.

Not yet done:

## Mesoscale discussions

Page: `/mesoscale.html`. After the Storm Prediction Center's: a short-range statement about
one area where severe thunderstorms are developing or changing. Each has an outlined area,
a "concerning" line, a valid time (two hours), the probability that a watch will be needed
(only 5, 20, 40, 60, 80 or 95 percent, with the centre's wording: watch unlikely, possible,
tornado or severe thunderstorm watch likely), a summary, a technical discussion written
from the air over the area, and the most probable peak tornado intensity, wind gust and hail
size as ranges ("85-115 MPH", "65-80 MPH", "1.50-2.50 IN").

Once in each hour of the world, the world is copied and run three hours ahead four times
(1.5 s a run; about 145 s of processor time a world day, against about 275 s for the
outlooks). An area of concern is where at least half the runs have severe weather within 25
miles, at least 4,000 sq mi. The watch probability is the share of the runs in which the
area gets what calls for a watch (ten cells with severe hail or wind, two tornadoes, or one
strong tornado); the peaks are the middle of the runs' strongest. No discussion is issued
for ground that discussions of the last eight hours already cover with as much concern,
unless the concern has stepped up.

On 16 world days (`npm run inspect:mesoscale`): 5.6 a day (a day's count from 3 to 11),
most between 16Z and 23Z; 57% for severe weather already under way, 20% before any storm
has formed in the area.

| Probability given | 20% | 40% | 60% | 80% | 95% |
|---|---|---|---|---|---|
| Issued | 20 | 1 | 8 | 5 | 56 |
| The area then had what calls for a watch | 10% | - | 38% | 60% | 98% |

The peak gust fell in the range given in 88% of discussions and the peak hail in 83%
(within one range: 97% and 99%). Where a tornado peak was given, a tornado came in 58%;
where none was given, in 3%. Of those saying a tornado watch was likely, 63% had the
tornadoes for one.

Not done: discussions about a watch in effect (there are no watches yet) or about a coming
change to the outlook; the ranges of the peaks are taken from the centre's products as
seen, not from a published list.

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
