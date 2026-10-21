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

**Intensity groups and how much is covered** (`node scripts/cig-climate.mjs`, 120 days of
what happened, 2026-10-14). The share of days with each group or higher somewhere:

| | CIG1+ | CIG2+ | CIG3+ |
|---|---|---|---|
| Tornado | 35% | 11% | 3% |
| Wind | 21% | 1% | 0% |
| Hail | 19% | 2% | - |

Day mix: below Slight 8%, Slight 10%, Enhanced 38%, Moderate 34%, High 10% (wanted 5, 30,
40, 20, 5). Wind and hail are hatched seldom because their chances are near the top already:
wind reaches its 90% contour on 43% of days and hail its 60% contour on 53%, where the
centre's tables make CIG2 wind a High risk. A line's wind is now reported once for each 25
miles of it at each half-hour capture, not in every cell along it (`js/verification/truth.js`),
which is how a real line's reports come in; that took the 90% wind days only from 48% to
43% (High days from 13% to 10%; tornado contours unchanged), so the coverage comes from how
many storms make severe wind, not from how lines were counted. Judging each group on its own
tier (CIG2 on EF3+ / 85 mph, CIG3 on EF4+ / 96 mph) would give wind 31% / 10% / 4% but High
days 18%; hail CIG2 cannot be reached that way (3.5 in hail is too rare). Not changed yet.

Then the gusts (2026-10-14, GUST in js/storms/StormHazards.js): 45% of storms reached 58 mph at
some time, 26% of storm-samples, because every mature storm drew a large share of sqrt(2
DCAPE) and DCAPE is 600 to 1,000 J/kg over most of the moist air; yet only 0.2% of samples
reached 85 mph. Now less of the downdraught's energy and of the storm's motion reaches the
ground (0.5 and 0.3 of them, from 0.6 and 0.35) and more of the middle-level wind behind an
organised line (0.9, from 0.3): 15% of samples reach 58 mph, 3% 75 mph, 1% 85 mph, most of
them in lines. On the same 120 days: wind CIG1+ 45% of days, CIG2+ 7%, CIG3+ 0%; the 90%
wind contour on 33% of days (from 43%); day mix below Slight 7%, Slight 10%, Enhanced 31%,
Moderate 38%, High 15% (more 75 mph wind inside high contours gives more High days).

Then fewer storms, and storms that cycle (2026-10-14). Measured on 6 worlds x 3 days:

| | Before | After |
|---|---|---|
| Thunderstorms a day | 127 | 56 |
| Severe storms a day | 49 | 21 |
| Tornadoes a day (strong) | 8.4 (1.2) | 7.7 (2.3) |
| Tornadic storms with 2 or more tornadoes | 12% | 31% (up to 4) |
| Tornadoes from storms that had more than one | 22% | 51% |

- Initiation: `FORCED_RATE_PER_HOUR` 0.012 to 0.005 (js/storms/InitiationEngine.js).
- Cycling: a storm whose tornado had ended usually lived on (2 hours, median) with a strong
  mesocyclone and high helicity, but its outflow had grown too strong for rotation to spin up
  near the ground again. Strong helicity near the ground now holds the outflow back
  (`outflowHold` 0.6 between `helicityHold` 150 and 400 m2/s2, js/storms/StormRotation.js), as
  strong inflow does in a real cyclic supercell; and the occlusion clears in 9 minutes, not 18.
  A storm's tornadoes are an hour apart (median).

On the same 120 days as above (`scripts/cig-climate.mjs`): the 90% wind contour on 18% of
days (from 33%), the 60% hail contour on 30% (from 53%). Intensity groups (as now judged):
tornado CIG1+ 35% / CIG2+ 21% / CIG3+ 8%, wind 39% / 8% / 2%, hail 21% / 6%; day mix below
Slight 11%, Slight 15%, Enhanced 24%, Moderate 33%, High 18%. With fewer weak storms a larger
share of each area's severe weather is significant, so the groups (judged on that share) come
more often and High days rose; the bars between the groups need refitting next. Judged on
each group's own tier with bars fitted to 35/12/4% (tornado), 30/10/3% (wind), 35/10% (hail),
High days would be 15%: the rest comes from the highest contours themselves (tornado 60% is
High in the centre's table whatever the group). [Corrected: with no group a 60% tornado contour is Enhanced; every High day needs a group (tornado 60% CIG1+, 30-45% CIG2+; wind 45% CIG3, 60-90% CIG2+). The High days that remain come from groups on the days that also reach the highest contours.]

Tornado tracks were rated by the strongest rating their storm had ever had, so a weak tornado from a cycling storm counted as strong. Each tornado is now rated by its own peak, along its whole track (js/verification/truth.js). On the same 120 days that changed little: tornado CIG1+ 34%, CIG2+ 20%, CIG3+ 8%; High days 17%. The groups come often because strong tornadoes are common: 2.3 of 7.7 tornadoes a day are EF2+ (30%; about 10% in the real record).

The intensity groups are now judged as the centre defines them, each on its own tier (js/forecast/worldRiskCategories.js): CIG1 on the share of an area's reports reaching EF2+ / 75 mph / 2 in, CIG2 on EF3+ / 85 mph / 3.5 in, CIG3 on EF4+ / 96 mph, each group needing the ones below it. Bars fitted on the same 120 days: tornado 14% / 24% / 2%, wind 42% / 32% / 22%, hail 8% / 2%. Days with each group or higher: tornado 35% / 11% / 3%, wind 32% / 11% / 3%, hail 37% / 2% (3.5 in hail is too rare for more). Day mix: below Slight 11%, Slight 16%, Enhanced 27%, Moderate 32%, High 15%. Day 3 (any severe weather) is hatched CIG1 at most, at 30% of its reports significant (not fitted).

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

## Mesoscale discussions and watches

Page: `/mesoscale.html`. After the Storm Prediction Center's.

**Discussions.** A short-range statement about one area where severe thunderstorms are
developing or changing. Each has an outlined area, a "concerning" line, a valid time (two
hours), the probability that a watch will be needed (only 5, 20, 40, 60, 80 or 95 percent,
with the centre's wording: watch unlikely, possible, tornado or severe thunderstorm watch
likely), a summary, a technical discussion written from the air over the area, and the most
probable peak tornado intensity, wind gust and hail size as ranges ("85-115 MPH", "65-80
MPH", "1.50-2.50 IN"). A discussion may instead concern a watch in effect ("Concerning...
TORNADO WATCH 12"): how the threat is going in the part of the watch still under it. It
gives no probability, and one goes out every two hours while the threat lasts.

**Watches.** A tornado watch or a severe thunderstorm watch, for six hours, with the
primary threats in the centre's words, and its table of probabilities (2 or more tornadoes,
a strong tornado, 10 or more wind events, a 75 mph gust, 10 or more hail events, 2 inch
hail, 6 or more hail and wind events together), each Low, Mod or High. The rules:

- A watch is issued for an area whose probability of a watch is 80% or more, when storms
  begin to fire there. If none has formed yet, the watch waits (the page shows it as
  waiting, and a discussion says a watch will be needed as storms form) and goes out the
  moment the first storm appears on its ground: this is checked every few seconds, not only
  at the hourly look.
- Which watch: a tornado watch when at least half the runs have two tornadoes or a strong
  one **and** the most probable peak tornado intensity is above the lowest range a
  discussion gives. A peak of "UP TO 95 MPH" goes with a severe thunderstorm watch, which
  then says "a tornado or two possible". The watch's own tornado chances come first: High
  (80%+) for 2 or more tornadoes or for a strong one always makes a tornado watch, and Low
  (20% or less) for both always a severe thunderstorm watch, whatever the wind chances; the
  rule above decides only when they are Mod.
- Particularly dangerous situation (PDS) wording: a tornado watch with an 80% chance of two
  or more strong (EF2+) tornadoes and a most probable peak of 136 mph (EF3) or more; a
  severe thunderstorm watch with an 80% chance of gusts of 100 mph with 25 or more cells of
  75 mph wind (a derecho). The centre's own least for a PDS tornado watch (an 80% chance of
  one strong tornado) would have marked 4 of 11 tornado watches here; it marks about 3 in
  100 of all its watches, so the bar is set higher.
- Watches do not overlap: a new one covers only ground under no watch in effect (it is
  drawn 20 miles beyond the area of concern, and stops at another watch's edge). The least
  a watch covers is 15,000 sq mi.
- Every watch has a discussion before it. Where storms are already firing on ground that no
  discussion has yet called a watch likely on, the discussion goes out at that look and the
  watch half an hour later at the soonest (`WATCH.afterDiscussionHours`). A watch that
  follows an expiring one is announced in a discussion about the expiring one.
- A watch stands as issued until it expires: it is not extended, upgraded, replaced or
  cancelled.
- A watch over severe weather that is still going is followed without a gap. At the last
  look before it expires, if its ground still calls for a watch with storms there (or has
  severe weather under way and a probability of 40% or more), a new watch is made ready and
  goes out at the hour the old one expires; a discussion about the old watch says "A new
  tornado watch will be needed when this one expires at 0200Z". The new one may be of the
  other kind, and takes in the area's ground that no later watch has.

**How they are made.** Once in each hour of the world, the world is copied and run five
hours ahead four times (about 2.4 s a run). An area of concern is where at least half the
runs have severe weather within 25 miles, at least 4,000 sq mi. The watch probability is
the share of the runs in which the area gets what calls for a watch (ten cells with severe
hail or wind, two tornadoes, or one strong tornado); the peaks are the middle of the runs'
strongest (a tornado's: of the runs that have one). A discussion goes out when storms are
in the area or expected within 1.5 hours, or within 2 hours where a tornado watch is in
prospect. A watch goes out as storms fire, so a discussion that says a watch is likely is
saying it is about an hour away, and says so ("will likely be needed within the hour"). No discussion is issued for ground that discussions of the last eight hours
already cover with as much concern, unless the concern has stepped up. After a look in
which no run has severe weather on ground under no watch, the next is two hours later.

Re-measured 2026-10-14 with every rule above in place (16 world days, the same 8 worlds):

| | 2026-10-13 | 2026-10-14 (all rules) |
|---|---|---|
| Discussions for ground under no watch | 2.9 a day | 5.2 a day |
| ...issued before any storm had formed there | 70% | 56% |
| ...issued with severe weather already under way | 7% | 14% |
| Discussions about a watch in effect | 8.0 a day | 12.1 a day |
| Watches | 5.1 a day | 5.8 a day (13 tornado, 80 severe thunderstorm; 4 PDS) |
| Watches with a discussion before them | about two thirds | 100% |
| Watches following an expired one with no gap | - | 94% (the rest: one hour) |
| Two watches on the same ground | never | never |
| "Watch likely, 80%": the area then called for a watch | 83% | 52% |
| "Watch likely, 95%": the same | 100% | 94% |

The 80% discussions verified too seldom, and there were too many discussions, since one was
forced before every watch and every piece of an area split by watches was discussed.

Then, after the centre's own practice (a discussion one to two hours before each watch, the
watch often set off by the first deep convection; spc.noaa.gov/misc/about.html): a watch is
made ready only when storms are within a discussion's lead; a discussion that steps up the
concern replaces the one still in effect over the same ground ("This discussion replaces
Mesoscale Discussion 0030"); and a leftover piece of an area cut apart by watches gets a
discussion or a watch only if it calls for a watch itself. Measured again the same way:

| | All rules, 2026-10-14 | With these three |
|---|---|---|
| Discussions for ground under no watch | 5.2 a day | 3.9 a day |
| ..."watch unlikely" (20%) | 15 | 5 |
| ...issued before any storm had formed there | 56% | 47% |
| Discussions about a watch in effect | 12.1 a day | 10.3 a day |
| Watches | 5.8 a day | 5.1 a day |
| Watches with a discussion before them | 100% | 100% |
| Following an expired watch with no gap | 94% | 91% (the rest: one hour) |
| "Watch likely, 80%": the area then called for a watch | 52% | 71% |
| "Watch likely, 95%": the same | 94% | 97% |
| Any watch: its ground got what calls for a watch | 97% | 99% |

The cost: a "watch likely" discussion now comes with the storms close, so fewer go out
before any storm has formed (47%). The discussion is still out before every watch.

The first measurement, 2026-10-13 (before the rules for following an expiring watch, a
discussion before every watch and one region each, with a 3-hour lead for tornado watches):

| | Before (three hours ahead, no watches) | Now |
|---|---|---|
| Discussions for ground under no watch | 5.6 a day | 2.9 a day |
| ...issued before any storm had formed there | 20% | 70% |
| ...issued with severe weather already under way | 57% | 7% |
| Discussions about a watch in effect | - | 8.0 a day |
| Watches | - | 5.1 a day (11 tornado, 71 severe thunderstorm; 4 PDS) |

Of the discussions issued ahead of the storms, the first storm came an hour later (median)
and the first severe weather an hour and a half later.

| Probability given | 20% | 40% | 60% | 80% | 95% |
|---|---|---|---|---|---|
| Issued | 13 | 3 | 7 | 6 | 17 |
| The area then had what calls for a watch | 23% | 33% | 71% | 83% | 100% |

The peak gust fell in the range given in 84% of discussions and the peak hail in 78%
(within one range: 99% and 99%). Where a tornado peak was given, a tornado came in 72%;
where none was given, in 5%.

Watches, checked against their own six hours:

| | |
|---|---|
| Two watches in effect on the same ground | never |
| Any watch: the ground got what calls for a watch | 98% of 82 |
| Tornado watch: two or more tornadoes, or a strong one | 100% of 11 |
| Tornado watch: a strong tornado | 36% of 11 |
| Severe thunderstorm watch: a strong tornado anyway | 6% of 71 |
| PDS tornado watch: two or more strong tornadoes | 1 of 1 |
| PDS severe thunderstorm watch: a gust of 100 mph or more | 3 of 3 |

Of the 38 watches on new ground, 29% waited for their storms and went out as they fired;
the middle one had 2 storms on its ground when issued, and 32% had severe weather already
under way (their areas reached 80% only once storms were going). The other 44 followed an
expired watch over storms that were still going, which is what "not changed until it
expires" comes to in a long event.

Short of what was wanted:

- Discussions with a tornado watch in prospect got no more lead than the others (4 in 16
  days; first storm an hour later) even when allowed 3 hours: the runs seldom agree on the
  tornadoes that early, and the tornado case usually shows only once storms are going.
- (Changed since: every watch now has a discussion before it; see the rules above.)
- Tornado watches are 1 in 7 of the watches (the centre's: about 4 in 10), because a
  tornado watch needs the most probable peak above 95 mph.
- A watch covers about 48,000 sq mi (median), a fifth of the map: the storms here are
  spread over much of the map on most days.
- Not done: warnings; discussions about a coming change to the outlook; keeping watches and
  discussions across a restart of the server. The ranges of the peaks are taken from the
  centre's products as seen, not from a published list.

**What the forecast runs cost** (outlooks, discussions and watches together). They are now
done by one pool of threads (`server/ForecastPool.js`, four on this machine), not a process
for each run:

| | Before | Now |
|---|---|---|
| Most cores busy at once (an outlook and a look ahead due together) | 12 | 4 |
| Most memory held by the runs at once | about 12 x 450 MB | about 4 x 450 MB, let go half a minute after the last run |
| The copy of the world a run starts from | 37 MB, written to disk, read by each process | 12 MB, in memory, shared |
| The live server stopped while the copy is taken | 125 ms | 50 ms |
| A mesoscale look ahead (four runs) | 2.9 s for three hours ahead | 2.4 s for five hours ahead |
| All three outlooks at 12Z | 12 processes at once with the look ahead | 56 s on three threads, the fourth kept for the look ahead (which takes 8 to 10 s while an outlook is being made) |

The processor time over a world day is about what it was (the look ahead is two hours
longer and costs the same; the outlooks' runs are the same runs). What is left is the
simulation itself: about half of every run is soundings for all 2,500 cells each half hour.

The soundings are now 18% cheaper (2,500 of them: 103 ms to 84 ms) with every figure the
same to the last digit (compared value by value on a saved world): each level's logarithm,
vapour pressure and Exner factor, and each anchor's sine and cosine, are worked out once for
a sounding and not once for each parcel lifted through it. A five-hour run went from 1.92 s
to 1.68 s. What remains is mostly the exponential in each lifted parcel's virtual
temperature (about 400 a sounding), which cannot be made cheaper without changing the last
digits (a table of vapour pressures would, and every world's weather would then go
differently from the same seed). `WEATHER_FORECAST_WORKERS=2` halves the cores used meanwhile (the
12Z outlooks would then take two to three minutes; not measured).

## Warnings

Tornado and severe thunderstorm warnings after the NWS's storm-based, impact-based ones
(`js/forecast/Warning.js`, served by `server/WarningRuntime.js` at `GET /api/warnings`, drawn on
the radar page). They are worked out at every volume scan (5 minutes of storm time) from what
the radar shows of each storm; nothing is run ahead and nothing is written onto the storms.

- Severe thunderstorm warning: hail of 1 inch or gusts of 58 mph. Damage threat tiers as the NWS
  uses them since 2021: CONSIDERABLE from 1.75 in hail or 70 mph gusts, DESTRUCTIVE (which sets
  off Wireless Emergency Alerts, so the text asks for EAS activation) from 2.75 in or 80 mph.
  "TORNADO...POSSIBLE" when the storm's rotation gives a 12% chance of a tornado in the next
  half hour. Hail and wind threats turn OBSERVED after 15 minutes of severe hail or wind.
- Tornado warning: a 30% chance of a tornado in the next half hour (TornadoEngine's, from the
  storm's low-level rotation), or a tornado on the ground. OBSERVED once the tornado has been
  down 10 minutes (confirmed); a particularly dangerous situation (TORNADO DAMAGE
  THREAT...CONSIDERABLE) when a confirmed tornado has EF2 winds (111 mph). The tornado
  emergency (CATASTROPHIC) is not done.
- 30 minutes for a tornado warning (the NWS default since 2012), 45 for a severe thunderstorm
  warning. The polygon runs from just behind the storm along its motion, 15% faster than it
  moves, widening 15 degrees each side; across the hail core, or along a line. Polygons do not
  move; a storm 10 minutes from leaving its warning, or under one 10 minutes from expiring, gets
  a new one downstream. A storm under a tornado warning gets no severe thunderstorm warning too.
- Severe weather statements when a tag or damage threat changes (or a size goes up), and a
  cancellation after two scans with no storm in the polygon still warranting it.

Checked on 6 worlds x 48 hours (2026-10-14, a scratch script, not a test): 154 tornado warnings
for 63 tornadoes, 46% with no tornado in them (the NWS's false alarm ratio is about 70%); every
tornado under a warning by the time it touched down, mean lead 8 minutes (NWS about 9); 18
tornado warnings were PDS at some time. 644 severe thunderstorm warnings: at issuance 70% base,
18% considerable, 12% destructive (the NWS says about 10% of severe storms reach destructive).
Median areas: tornado 700 sq mi, severe thunderstorm 2,850 sq mi (lines get long polygons; a
single cell's is about 900). Real tornado warnings are usually smaller; these storms move fast
(35-60 mph). `tests/warnings.mjs` covers the rules on made-up storms.

## What a player would find

From `npm run inspect:players` on eight worlds (160 days). The clock runs 12 times real
time, so a simulated day is 120 real minutes (12x; 96 minutes at 15x before 2026-10-15).

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

1. Outlooks: Days 1 to 3 are issued and updated; mesoscale discussions and watches are issued. Still to do: verify the outlooks, make the runs themselves cheaper (soundings), give Days 2 and 3 an uncertain atmosphere, warnings.
   Also: the quiet world (seed 8), and the low western and southern edge strips.
2. Getting players to the weather: place selection, travel, or a smaller map.
3. Longer-lived tornadoes, or a slower clock, so that tornadoes can be chased.
4. Storm size and shape for 3D objects in Roblox.
5. Storm update done (budgets, rotation and tornado lifetime, shape, interactions). Left over: 75 mph wind on about 70% of days may be more than wanted; ordinary storms in weak shear last too long; mergers are still a distance rule.
6. Stronger fronts and real warm fronts.
7. The Roblox region feed and hosting.
8. Remove or replace the old outlook pages and tile routes (see `ARCHITECTURE.md`).

## Playtest agenda (2026-10-17)

**Seed 1000, 3 days.** I played three days of seed 1000 as a chaser, using only the products a player sees: outlooks, discussions, watches, warnings, radar mosaics and site scans, soundings and mesoanalysis maps.
- **Rules:** a car limited to 90 mph, running at the speed limit + 10 on the road graph; fuel to buy; instant airport-to-airport travel for a fee.
- **Result:** rated 6/10. I never came within 5 miles of a tornado. The closest was 11 miles, to a 141 mph tornado on Day 2.
- **Totals:** 734 miles driven, 4 flights.
- **Game time:** about 60% of it was spent waiting.

In order:

1. **Keep the action off the map edges.** Every day, the best area touched an edge: STP 7 on the bottom row on Day 1, storms leaving east on Day 2, the 2% tornado area on the south edge on Day 3. This is the "Edge strips" item above. Use an outer strip, or a playable inner part.
2. **Roads a chaser can use.** Gravel makes up most rural miles, so routes average about 45 mph, and road distance is 1.3-1.6 times the straight line. Storms move 35-47 mph, so a storm moving away cannot be caught. Options:
   - pave more of the mile grid;
   - drive faster on dry gravel;
   - add a chase aid, such as where a storm crosses your road.
3. **Watches before tornadoes.**
   - Day 1: the watch came 70 minutes after the first tornado, and the "tornado watch likely" discussion 40 minutes after it.
   - Day 2: no watch at all, through three tornadoes (141 and 186 mph among them) and several PDS warnings. Its discussion said "watch unlikely, 20%" as the 141 mph tornado touched down.
   - Three days produced 1 watch and 4 discussions.
4. **The game loop.**
   - What a player can see: rain-wrapped tornadoes, darkness after sunset.
   - A sighting score: distance, angle, duration.
   - Damage: hail and wind on the car, debris and closed roads.
   - Driving through a 60+ dBZ core now does nothing.
5. **Something to do while waiting.** At 12x, waiting from 12Z to 21Z is about 45 real minutes.
   - A morning target-forecast contest, scored at the end of the day.
   - Scouting, and the 16Z and 20Z updates.
   - The clock is shared, so there is no time skip.
6. **Saturated moist sector.** At 18Z on Day 1, about 60% of cells had a surface dewpoint equal to the temperature (28/28 F at 12Z inside the Slight Risk), while the dry side ran 50+ F depressions. Only Day 3 had a normal 80/63.
7. **Outlook wording.**
   - Timing that contradicts itself: "storms from 18Z", "severe most likely 05Z-12Z", "tornado risk peaks near 20Z".
   - A Day 2 starting at 07Z whose tornado risk "peaks near 01Z".
   - A Marginal Risk worded "severe thunderstorms are expected".
8. **Storm-relative velocity.** Each storm shows nearly one sign, and the couplet is a round blob, not a tight pair at the hook.
9. **Warnings.**
   - One storm gets two or three warnings from different offices, sometimes with the same number. Group them by storm in the UI.
   - Lines with red cores go unwarned after warnings lapse.
   - The coordinate line is in km.
10. **Airport travel.** It was strong (instant) but healthy: it turned the slow roads into a choice. Revisit it after item 2.

### Realism, seed 4242 (2026-10-17, second playtest)

**What I ran.** Three days of chasing under the same rules as the first playtest.
- **The audit:** each run of the harness's grid-wide audit covered surface spread, LCL against Espy, precipitable water and CAPE by dewpoint, lapse rates, level temperatures, cross-isobar angle, wind against geostrophic, helicity, STP and gradients. It ran at 12Z, 15Z, 18Z, 00Z and 03Z.
- **Trip:** 451 miles, 3 flights.
- **Tornadoes:** 15 in all (9, 3 and 3 by day). None was seen. The closest was 13 miles away: an unwarned 78 mph tornado at 8:50 am.

**What holds up:**
- **Moisture and instability.** Precipitable water and CAPE scale properly with dewpoint (PW 1.06 in at 60-65 F, 1.26 at 65-70 F).
- **The dryline.** Contrasts of 13-19 F; it retreats west in the evening.
- **Evening winds.** The evening low-level jet and helicity rise (850 mb median 30 kt, 0-1 km helicity 150 at 00Z).
- **The Day 3 soundings.** Loaded-gun profiles: 77/69, CAPE 2,900, CIN -191 under a 13 C lid; later 82/67, CAPE 3,850, CIN -3, STP 4.2.
- **Watch timing on Day 1.** The tornado watch came at 12:30Z, ahead of the warnings, better than seed 1000.

**What doesn't, in order:**

11. **The surface goes saturated far too often.** T = Td in:
    - 69% of moist cells at 12Z on Day 2;
    - 83% of all cells at 12Z on Day 3;
    - 44% of all cells at 00Z on Day 2, in post-frontal 40-50 F air with 15-30 kt winds.

    Every cold-pool cell is saturated (727 of 727 at 00Z on Day 1). Outflow air should cool toward the wet bulb and keep a 2-6 F spread. Wind-mixed morning air should keep 2-5 F under stratus. Seed 1000 showed the same thing (item 6).
12. **Cold pools cover too much.** At 00Z on Day 1 they covered 77% of the moist sector (1,455 of 1,881 cells).
13. **Cold outbreaks that don't fit a warm-season model.**
    - At 12Z on Day 3, 40% of the map was below 35 F (18-25 F, saturated).
    - Day 2 ran from 15 to 97 F across the map.
    - One cell went from 91 to 24 F in a day.

    RegionalAtmosphere describes a warm-season Plains reference state.
14. **Edge rows and columns break away from the interior.** Row 0 at 65 F sat beside row 1 at 25 F, and column 0 at 61 F beside 21 F: 39 F jumps over 10 miles. Instability also enters as a 3-4-row strip on the south edge (MLCAPE 4,400-4,665, STP 3.8-4.2) on Days 2 and 3. Together with item 1.
15. **The surface wind is a fixed formula in quiet weather.** At 12Z on Day 1 the cross-isobar angle was 20-24 deg everywhere (real 10-50, varying with stability and roughness), and the speed 0.32-0.35 of geostrophic everywhere. It only varies where storms disturb it.
16. **The upper troposphere has no temperature gradient.** 250 mb ran -46 to -48 C across the map on every day (a spread of 0.5 C at 12Z on Day 3) under a 90-140 kt jet. That is inconsistent with thermal wind.
17. **Front analysis.**
    - A 43 F-contrast boundary moving 32 mph was typed outflow, beside a cold front of 38 F.
    - At 12Z on Day 3, a 20-40 F thermal boundary across the north had no front drawn.
    - 11-13 outflow boundaries were analysed at a time.
    - A 1018-1019 hPa High was drawn in the warm sector.
18. **Morning, low-helicity tornadoes.**
    - On Day 1, 6 of 9 tornadoes were before local noon, in 0-1 km helicity of 22-70 over a stable or saturated surface layer (inflow at 12Z: SBCAPE 266, MUCAPE 1,456, CIN -147).
    - The outlook put the tornado peak at 15Z.
    - Most were 5-20 minutes long.
    - One 78 mph tornado had no warning.
19. **Radar.**
    - One cluster drew a continuous 60+ dBZ block about 50 x 40 miles; overlapping storm echoes probably stack. Real systems have a narrow 50-55 dBZ line and 30-40 dBZ stratiform rain.
    - Concentric arc banding in two storms.
    - Storms combed into parallel NNW-SSE bands about 20 miles apart.
    - Storm-relative velocity mostly one sign (item 8).
20. **Product text against the data.**
    - The outlook gave a 90% wind area.
    - It said "moist air covers about half the region" when 94% was moist.
    - It said "a strong cap will hold storms back" with storms from 12Z.
    - An MD said "steep lapse rates" with 700-500 mb at 5.0 C/km domain-wide.
    - On Day 2 the 15% tornado area lay on the cold side of a fresh front.
21. **Warning volume and duplicates.**
    - One office's Severe Thunderstorm Warnings reached number 140 in two days.
    - One 112 mph tornado carried 4 tornado warnings at once (2 offices x 2 storm ids).
    - SCP reached 30-35.

### Products, as an NWS forecaster would see them (2026-10-19 review)

**What I ran.** Seeds 31415 and 2718, 72 hours each.
- **How:** the real server runtimes on a fake clock, stepped as the server steps. Every outlook, discussion, watch and warning was logged and checked against the storms.
- **Seed 31415:** an outbreak day (21 tornadoes), then a day with no storms, then 4 tornadoes.
- **Seed 2718:** quiet, with 4 night tornadoes.

**What holds up:**
- **The Day 1 Moderate.** Nearly all of the 21 tornadoes fell in the Enhanced or Moderate area.
- **Watch coverage on the big day.** 21 of 25 tornadoes were in a watch.
- **The products' look.** Watches with county lists (WOU) and the centre's table; warnings with damage tags.
- **Daytime surface air.** Dewpoint spreads of 10-14 F by afternoon.

**What doesn't, in order:**

22. **The outlooks for one day swing between issues.** For the same Day 3:
    - Day 3 (2 runs): Marginal.
    - Day 2 at 12Z (4 runs): Enhanced.
    - Day 2 at 00Z: High, with 45% tornado and CIG3.
    - Day 1 at 12Z (8 runs): Slight, over 0.4% of the map.
    - What came: 4 tornadoes, one of 159 mph.

    The centre has issued a Day 2 High only a handful of times. A 2-run Day 3 still says "the runs agree closely". A Day 2 Slight came for a day with no storms at all.
23. **Too many discussions.** 34 discussions and 12 watches on one day, over a 500 x 500 mile map. Most were "Watch N continues", about one per watch every 2 hours. The centre issues 10-20 on a big day for the whole country.
24. **Watches are too wide.** "Along and 115-155 statute miles either side of a line" is common (the centre's are usually 40-75). One watch was 64,659 sq mi, about a quarter of the map.
25. **The watch type contradicts its own discussion.** Discussion 1 gave a most probable peak tornado of 120-150 mph and "tornadoes, some of them intense", then called for a severe thunderstorm watch.
26. **Isolated and night tornadoes get no watch.** Seed 2718 had 4 night tornadoes in 4.5 hours, none in a watch; its discussion said "watch unlikely" with a tornado on the ground. This is the same thing as item 3.
27. **Tornado warnings have no lead time.** 25 of 25 tornadoes were warned, but the median lead was 0 minutes (the NWS's mean is about 8-10). The false-alarm ratio was 0.48 (the NWS's is about 0.7).
28. **Severe thunderstorm warning volume.** 620 in about 18 hours, for 90 storms (median 6 each, up to 25):
    - 182 were extra pieces in the same scan (counties of other offices);
    - 348 were re-issues at later scans;
    - 239 warnings were cancelled along the way.

    Polygons: median 1,180 sq mi, largest 6,088. The LOC line is still in km (item 9).
29. **Product text, more of it** (item 20):
    - "Beneath steep lapse rates" is printed whatever the lapse rate.
    - The tornado sentence ("modest low-level shear limits the risk") sits under "tornado watch likely".
    - "Hail events to 1 inches".
    - Local times are UTC-6, where summer is CDT (UTC-5).
    - Outlook headlines list six compass parts instead of the region names the discussions use.
    - Outlooks go out at 12, 18, 00 and 06Z. The centre's Day 1 goes at 06, 13, 1630, 20 and 01Z, and players wait for the 16Z and 20Z.
30. **The significant share of hail and wind is high.**
    - Of 5-minute storm samples with 1 inch hail or more, 38% had 2 inches or more (the reports' share is about 10%).
    - Of those with 58 mph or more, 33% had 75 mph or more.
    - Tornadoes are fine by rating: 3 of 25 were EF2 or more (12%). Their winds run higher than their ratings by design (estimatedEf is the damage survey, windEf the wind; TornadoEngine.js:131-135). Pages that show both should label both.
31. **The lowest pressure is on the map edge.** It sat at row 0, column 0 or another edge in nearly every hour of both seeds. See "Fronts and lows" (2026-10-15): the map is steered into the warm sector, and the low lies off the map.

### Causes and fixes (diagnosed 2026-10-19)

Read from the code against the runs above. Nothing here has been changed or measured as a fix yet.

**1, 14. Map edges.**
- **Cause, edge rows:** advection (RegionalAtmosphere.js:452) gives a cell whose air came from beyond the map a prescribed value from `inflowOf`:
  - temperature: the outer model's smooth air mass;
  - moisture: `inflowMoisture`;
  - rain-cooled air: none.

  A step is 30 minutes and a cell 16 km, so with wind above about 17 kt the whole edge row is replaced every step (two rows above 35 kt). The edge never carries what fronts, cold air and storms did inside, hence the 39 F jumps.
- **Cause, the south edge:** `inflowMoisture` (line 425) weights Gulf air by the row number (`south = y/(ny-1)`), and the moisture everywhere is drawn toward it (line 539). The bottom row is always the moistest and least disturbed, so the CAPE and STP maxima sit on row 49. A share set by map row is a painted value.
- **Fix:**
  - Run a buffer several cells wide around the playable map (the 56 x 56 plan under "Edge strips") and relax toward the outside values across it, instead of overwriting the edge row.
  - Take the inflow from the outer model plus the departure carried in from upstream.
  - Take Gulf moisture from where the low-level air has come from (the outer flow's trajectory), not from the row.

**3, 26. Watches before tornadoes, and none for isolated storms.**
- **Cause, waiting:** a watch waits until storms are firing on its ground (`readyHourUtc`, Watch.js:178). Where they fire quickly, or form just outside, the first tornado comes before or without it.
- **Cause, isolated storms:** an area of concern needs half the runs to have severe weather within 25 miles over 40 joined cells (4,000 sq mi; MesoscaleDiscussion.js:35). A watch needs 2 tornadoes, or one strong one, in a run. One or two supercells, the usual night case, never get there.
- **Fix:**
  - Issue a watch when the discussion's chance reaches 80% and storms are expected within about 2 hours, not only once they fire.
  - Let a strong-tornado chance of 40% or more (or the runs' median peak at EF2 or more) make an area of concern on its own, however small.

**6, 11, 13. The surface saturates at night; the cold mornings.**
- **Cause, cooling:** at night the surface temperature is `eveningTheta - nightDrop`, with `nightCoolingK` 16 K e-folding over 4 hours, times 0.7-1.3 for dryness (line 596). It does not depend on wind or cloud.
- **Cause, dewpoint:** the dewpoint is only clamped to the temperature (line 617). Nothing removes the extra vapour as dew or fog, and nothing releases its latent heat, which is what holds real nights a few degrees above the dewpoint.
- **Cause, sunset:** the layer goes from the day's mixed depth to 150 m (line 595), so its moisture is no longer diluted and the dewpoint rises.
- **What the numbers show:** with a 10-14 F afternoon spread, moist cells reach saturation 4-5 hours after sunset (58% of cells at 03Z, 67-94% at 06Z).
- **The cold mornings:** dry air cools up to 1.3 x 16 = 21 K, floored only at `airTheta - 12` (line 597). That gives 23-27 F mornings, and 91 F to 24 F with a front.
- **Fix:**
  - Scale the night cooling down with wind (with the low-level jet blowing a warm-sector night cools 5-10 F) and with cloud.
  - Stop the cooling near the dewpoint: take the extra vapour out as dew or fog and add its latent heat back.
  - Lower the dry-air cooling and its floor.

**12. Cold pools cover too much and saturate.**
- **Cause, spread:** each storm adds a Gaussian of rain-cooled air every step along its track (`addColdPool`, line 364). It fades only with sunshine, or at night with an 8-hour e-folding (line 550). There is no least value and no mixing with the air around it, so faint tails last all night and over most of the moist sector.
- **Cause, saturation:** the cooling is taken off the temperature (line 616) with the moisture unchanged, so any pool colder than the spread saturates (727 of 727 cells).
- **Cause, pressure:** the pool's pressure (line 557) also makes the High drawn in the warm sector (item 17).
- **Fix:**
  - Cool toward the wet bulb and add the vapour the rain gives up.
  - Mix the pool out faster where the wind over it is strong.
  - Drop pools below about 1 K.

**15. Surface wind is a fixed formula.**
- **Cause:** speed is a fixed share of the wind above (0.75 by day, 0.4 at night) and the turning a fixed angle (15 degrees by day, 25 at night; line 647), plus `airMassInflowDeg` 15.
- **Fix:** make both depend on the stability: the mixed layer's depth by day, the strength of the inversion and the wind at night. A deep mixed layer gives little turning and fast wind; a strong inversion, weak wind and 30-45 degrees.

**16. Flat temperature at 250 mb.**
- **Cause:** `t250 = -48 C + 0.3 x` the one layer anomaly the outer model has (line 566). With the outer model's gradient of about 1.7 K per 100 km, that gives about 4 C across the map, as measured.
- **Fix:** make the 500-250 mb thickness from the upper layer's own flow (thermal wind with the jet), or treat the tropopause as it is, so the jet has its temperature gradient.

**17. Front analysis.**
- **Cause, outflow typing:** a point of a front is typed outflow if there is 1.5 K of rain-cooled air on its cold side, whichever way it moves (BoundaryAnalysis.js:212). So a 43 F front with storms behind it became an outflow boundary.
- **Cause, too many lines:** with the faint pools of item 12 everywhere, and an outflow contrast of only 2.5 K per 100 km, there are 11-13 outflow lines at a time.
- **Cause, the warm-sector High:** the pools' pressure (item 12).
- **Fix:**
  - Type outflow only where the rain-cooled air makes up most of the contrast across the line.
  - Count only pools of at least 1-2 K, and require that they are young.
  - Fix item 12 first.

**18. Morning tornadoes in weak helicity.**
- **Cause, the helicity floor:** near-ground rotation keeps `helicityFloor` 0.5 of its strength at no 0-1 km helicity (StormRotation.js:82). Deep shear alone (65-85 kt) still builds a mesocyclone (`shearShare` 0.35).
- **Cause, the cloud base:** a saturated surface puts it at the ground, which makes the cloud-base term 1 (line 83).
- **What the runs show:** a 141 mph tornado formed in helicity 57 and STP 0.6. Item 11 is feeding this.
- **Fix:** fix item 11 first; then lower `helicityFloor` to about 0.1-0.2, so that real tornado environments (helicity at or above about 100) carry the rate.

**19. Radar: 60 dBZ blocks.**
- **Cause:** overlapping storms' echoes are added in linear Z (`addEcho`, RadarSimulator.js:517). Ten storm objects along a merged line, over the same ground, add up to 10 dB.
- **Fix:** make one precipitation field from all storms, with the water conserved, or combine where they overlap by maximum or by a weighted mean.
- **Not diagnosed:** the arc banding and the bands combed about 20 miles apart.

**8. Storm-relative velocity.**
- **Cause, the motion taken off:** the radar takes off one weighted mean motion of every storm within its range (`meanStormMotion`, line 237), not each storm's own. What is left of the environment's wind (10-25 m/s) swamps the vortex.
- **Cause, the vortex:** the mesocyclone is one round vortex of 4 km radius (1.5-8), at most 6 + 30 x strength m/s (PrecipitationField.js:121), centred near the storm's core and not at the hook.
- **Fix:**
  - Use each storm's motion near it, or let the player pick a storm, as AWIPS does.
  - Put a narrower vortex (1.5-3 km) at the rear-flank notch, with its strength from the low-level rotation.
  - Add the rear-flank surge and the inflow converging on it.

**7, 20, 29. Outlook and discussion wording.**
- **Cause, the severe timing:** `byHour.severe` counts whether there is severe weather anywhere on the map in each half hour (DayOneOutlook.js:151). On a busy day it sits at its top for most of the day, so `busiestHours` (line 316) gives "15Z to 11Z".
- **Cause, "develop from":** this is the start of the busiest run of new storms, not the first storm (`byHour.storms`), so it can be later than the storms already going.
- **Cause, the environment sentences:** the moisture share, cap and CAPE are taken at 22Z over every cell with a dewpoint of 58 F or more. A median CIN over all of it says "strong cap" where the storms are breaking it. The sentence is written even with MLCAPE 0 (line 374).
- **Cause, the discussions:**
  - "Steep lapse rates" is a fixed string (MesoscaleDiscussion.js:276).
  - The tornado sentence reads the helicity now (line 278), while the watch type comes from what the runs do later.
- **Cause, local time:** `localTime` is UTC-6 (DayOneOutlook.js:299).
- **Fix:**
  - Count reports and storms per hour, not whether there are any.
  - Give the hours that hold the middle 70% of the severe weather.
  - Say "ongoing" for storms going at issue time, and "develop" for the first starts in the risk area.
  - Read CIN and CAPE where storms form.
  - Write the lapse rate only when it is 7 C/km or more.
  - Give helicity "increasing this evening" from the runs.
  - Use CDT, and name the regions in the outlooks.

**9, 21, 28. Warning volume and duplicates.**
- **Cause, re-issues:** a severe thunderstorm warning runs 45 minutes (Warning.js:55). A storm within 10 minutes of leaving it, or of its expiry, gets a new one (line 85), and at 40 mph that is every 25-35 minutes.
- **Cause, cancellations:** two quiet scans cancel a warning (line 77). A storm whose hail sits near 1 inch is warned, cancelled and warned again, and a line with red cores lapses between.
- **Cause, the pieces:** every office the path crosses issues its own (182 pieces), as WarnGen does. That one is real practice, but the pages must group them by storm.
- **Fix:**
  - Run 60 minutes, and continue a warning downstream with a statement in place of a new one.
  - Cancel only after 3-4 quiet scans.
  - Give one warning to a line segment.
  - Write the LOC line as latitude and longitude (line 492), and add the LAT...LON block.

**27. No tornado warning lead.**
- **Cause:** a warning goes out at a 30% chance of a tornado in the next half hour (`tornadoChance`, Warning.js:59). That is only low-level rotation 0.15. At full rotation the touchdown rate is 8 an hour (TornadoEngine.js:47), 49% a scan, and rotation spins up over 0.3 hours, so the chance crosses 30% and the tornado touches down within the same scan or the next.
- **Cause, too accurate:** warnings also read the storm's true state, so they are both too late and too accurate.
- **Fix:** issue on the rotation's trend and the mesocyclone, as forecasters do, at a lower chance (10-15%), with radar-like uncertainty (range, beam height). That gives lead time and the NWS's false alarms. To be confirmed by logging the rotation before each touchdown.

**22. Outlooks that swing.**
- **Cause, few runs:** Day 2 has 4 runs and Day 3 has 2 (`memberShare`). A level needs `agreement` 0.75 of the runs at the top (DayOneOutlook.js:53), which is 3 of 4. One set of perturbations that lines up gives a High.
- **Cause, no memory:** nothing ties an issue to the one before. The uncertainty sentence is the same whatever the number of runs.
- **Fix:**
  - Hold Day 2 to Moderate and Day 3 to Enhanced unless every run agrees.
  - Allow at most a category up or down from the outlook before, except as the day comes nearer.
  - Write the uncertainty from the spread, and never "agree closely" from 2 runs.
  - Or more runs for Day 2 and 3, at the cost.

**23, 24, 25. Discussions and watches.**
- **Cause, the flood:** each watch in effect gets a "continues" discussion whenever 2 hours have passed and its ground is at 20% or more (Watch.js:251).
- **Cause, the size:** an area of concern is where half the runs have severe weather within 25 miles at any time in the next 5 hours. That is a 5-hour swath of storms moving 40 mph, widened by 2 cells and then rounded out to whole counties.
- **Cause, the type:** 4 runs make the chances 0, 25, 50, 75 or 100%, given as 5, 20, 60, 80 or 95. Two runs with a strong tornado make 40% for one strong tornado (under the 80% that makes a tornado watch) and 20% for 2 or more (not above 20; MesoscaleDiscussion.js:191).
- **Fix:**
  - Discuss a watch only when something changes: the threat steps up or ends, or the watch needs extending or replacing.
  - Draw the watch from the next 2-3 hours, held to about 70 miles either side.
  - Let a 40% chance of a strong tornado, or a median peak at EF2 or more, make it a tornado watch.
  - Allow extending a watch by its WOU, and cancelling it early.

**30. Significant hail and wind.**
- **Cause:** follows the agreed step-13 tuning (`GUST` in StormHazards.js, hail from updraught speed). The measure here is per storm sample, which counts long-lived big storms more than reports do.
- **Fix:** re-measure as reports (truth.js) before tuning.

**2, 4, 5, 10. Roads, game loop, waiting, airports.**
- **Roads:** the engine sets only the paving (`pavedShare` 0.15-0.7 by region, sectionRoads.js:42). Speeds are the game's.
- **The rest:** these are game-design choices, not engine causes.

### Applied 2026-10-19: the fields first (items 1, 6, 11-18 in part)

Done before the products, which come next: outlooks, watches, warnings, radar, text, map.

**How it was measured.** A field audit stepped as the server steps: 8 seeds (1-6, 31415, 4242), 72 hours each, about 30 s a seed. The "before" figures are from seeds 31415, 2718 and 4242. `npm test` passes, 51 of 51.

| | Before | After |
|---|---|---|
| Moist cells saturated, 1 and 6 am local (median) | 92% | 1% |
| Dewpoint spread in moist air at night (median) | 0 F | 4.7 F |
| Coldest 5% of the map at dawn | 41 F | 59 F |
| Rain-cooled cells saturated | 98% | 0% |
| Tornadoes in 0-1 km helicity under 100 | 40% | 7% |
| Tornadoes 6 am to noon | 17% | 5% |
| Tornadoes a day | 6.4 (3 seeds) | 8.0 (8 seeds; target about 7.5) |
| Surface wind / geostrophic, day and night | 0.40 and 0.38, alike everywhere | 0.40 and 0.37, quartiles 0.31-0.41 at night |
| Angle across the isobars, day and night | 12 and 23 degrees, fixed | 12 and 22 degrees, quartiles about 6-34 |
| 250 mb spread across the map, afternoon | 1.4 C | 3.5 C |
| Outflow lines at a time (same 8 seeds) | 3.8 (up to 16) | 2.0 (up to 12) |
| Edge-to-neighbour jump (median, 95th) | 20, 35 F | 7, 18 F (inside the map: 11, 20 F) |
| Southern strip | MLCAPE 4,400+ | +180-220 J/kg over the rows inside it, the gradient alone |

**What changed:**
- **Night (RegionalAtmosphere.js).**
  - Calm-night cooling is `nightCoolingK` 12 K (moist air 0.75 of it), shrinking with the wind near 900 mb including the night-time jet (`nightWindMs` 10, `nightWindFloor` 0.25).
  - Near saturation the cooling goes into dew. Its latent heat slows the air to 1/(1 + L dqs/dT / cp), and the wind keeps a spread (`nightSpreadK` 0.2-2 K).
  - The morning inversion is the night's own (`nightTheta`).
- **Cold pools.**
  - Evaporation cools toward the wet bulb and adds the vapour. Downdraught air arrives at no more than `coldPoolHumidity` 0.85.
  - The wind mixes pools out (`coldPoolMixingKm` 300), and pools under 0.3 K are dropped.
- **Tornadoes.** `helicityFloor` went from 0.5 to 0.15 (StormRotation.js). `fullRatePerHour` went back from 8 to 5 (TornadoEngine.js), since the night's storms are fed from the ground again.
- **Surface wind.**
  - By day the share (0.7-0.82) and the turning (20-10 degrees) follow the mixed layer's depth.
  - At night they follow a bulk Richardson number over 150 m (0.4-0.15, and 20-40 degrees).
- **250 mb.** The share of the layer anomaly went from 0.3 to 0.7, with a soft tropopause at -58 C.
- **Fronts (BoundaryAnalysis.js).**
  - Outflow only where the rain-cooled air is at least half the contrast across the line (`outflowShare`).
  - Pools of at least 2 K, and lines at least 120 km long.
- **Edges.**
  - Air entering keeps the edge's departure from the outer model, fading over `edgeMemoryCells` 6 (`advect`). The plateau's lid air and the dry west inflow keep their sources.
  - The Gulf share no longer falls by map row.
  - `gulfAir` had the outer model's northward moisture fall with the wrong sign (moister to the north). It is fixed, with an extra 2 g/kg per 1000 km, measured from a coast `gulfCoastSouthKm` 500 south of the map's middle.

**Left open:**
- **Tornadoes lean to night** (most from 8 pm to 3 am local), in night-time jet helicity of 250 or more. This is the "0-1 km helicity still high" item for step 13.
- **Cold pools cover 15-26% of the moist air at night** (12% before, with more storms now). Not tuned.
- **The 250 mb gradient** is as large as thermal wind allows in the outer model. Its mean shear between layers is 10 m/s (0.32 K per 100 km), and its jets are nearly equivalent-barotropic. More needs a more baroclinic outer model.
- **The lowest pressure is on the edge** in 84% of hours. That is where the steering puts the map (item 31; open decision).
- **The 56 x 56 strip** for storms to arrive grown is still not built. The boundary zone above removes the jumps, not the lack of storms coming in.

### Applied 2026-10-19, second pass: from the forecaster's mesoanalysis review

**The review.** Seed 6060, 72 hours, as a forecaster. Inputs every hour:
- the surface analysis and all the mesoanalysis fields;
- soundings from a network of 9 sites every 3 hours, and at the highest STP and every touchdown;
- maps of the fields.

It found:
- fronts grid-sharp (16-20 C across one cell at 850 mb), with no pressure trough or wind shift;
- the cold air behind them a flat slab under a lid, so 700 mb was 3 C or more warmer than 850 over 40-67% of the map;
- no closed low on the map in 73 hours;
- windy nights at 80 F or more;
- strong tornadoes in STP 0.5-1 at night.

The changes (RegionalAtmosphere.js unless noted):
- **Sloping cold dome.** Cold air deepens with distance behind the warmer air (`domeSlope` 1:120, 300 m to 4.5 km; `coldDome`, a chamfer distance transform).
  - Its coldness fades to none at its top, so 850 and 700 mb cool, and the lid rides over it.
  - Its weight is half its depth times its deficit. The shallow 400 m stays sharp at the front; the deeper part adjusts over the deformation radius (`thermalSmoothingCells`).
  - At 850 mb it counts by ((h - z) / h)^2.
- **Front width.** Mixing at the deformation's rate, K = D L^2 (`frontWidthKm` 25, D at most 4e-4 /s, sub-stepped).
- **Cyclones on the fronts** (Petterssen). The pressure falls at `cycloneGainHpa` 3 hPa an hour per K/h of the outer model's ascent where the air-mass contrast is 2-6 K per 100 km. The fall moves with 0.8 of the 700 mb wind and fills over 18 hours.
- **Cloud cover** (new; mesoanalysis `cloudTotal/Low/Mid/High`, station `skyCover`):
  - low: stratus within 1.5-0.3 K of saturation, cumulus at the mixed layer's cloud base, Sundqvist cloud at 850 mb;
  - mid and high: the outer model's ascent;
  - anvils: from storms (AtmosphereWorld.js), carried on the 250 mb wind.
  - Cloud cuts the sun's heating (0.5/0.3/0.1 of each layer's share) and the night's cooling (0.6/0.35/0.15).
- **Night cooling.** `nightCoolingK` 14 and `nightWindFloor` 0.4.
- **Cold pools.** `coldPoolDeficitK` 18 to 12 (AtmosphereWorld.js; observed 5-11 K, Engerer et al. 2008).
- **Surface wind by day.** 0.6-0.75 of the mixed layer's wind, turned 25-15 degrees.
- **Tornadoes.** `helicityFloor` 0.3, and the rate a steeper curve (`power` 3, `fullRatePerHour` 4.2; TornadoEngine.js). A lower rate alone left an ideal supercell one tornado in eight hours.

| Seed 6060, 72 h | Before | After |
|---|---|---|
| Steepest 850 mb change across one cell | 16-20 C | 2-3 C |
| Map with 700 mb 3 C+ warmer than 850 mb | 40-67% | 0% |
| Front in a trough (median, 10th percentile) | 0.35, 0.75 hPa | 0.40, 0.90 hPa |
| Wind shift across fronts (median) | 26 deg | 94 deg |
| Hours with a closed centre analysed | 0 of 73 | 8 of 73 (a 988 hPa low formed and crossed the map) |
| Cells 80 F or more at 1-5 am (night 2) | 360-374 | 193-256 (night 1: 0-2) |
| Tornado STP / 0-1 km helicity | 0-4.1 / 26-287 | 1.6-2.8 / 194-272 (all supercells) |
| Mean cloud cover | none | 28-40% |

On 8 seeds x 3 days (field audit; the "after" is the final code):
- **Tornadoes a day:** 6.9, of which 1% in helicity under 100.
- **Night saturation:** 8% of moist cells.
- **Edge jumps:** median 4.2 F, 95th percentile 10.5 F (inside the map: 5.9 and 10.7).

`npm test` passes, 51 of 51.

**Still open:**
- **Tornadoes lean to night: 58% from 9 pm to 6 am** (real Plains about 25-40%). Storms' inflow 0-1 km helicity is about 50 by day against about 140 at night. By day the mixed layer makes the low-level wind too uniform: there is little veering in the lowest kilometre. That is the step-13 helicity item.
- **The lowest pressure is still on the map edge** in 62 of 73 hours. Lows now form and cross the map, but the parent low is off-map most of the time (the steering decision).
- **Windy, cloudy nights** after a 90 F day still hold 80 F in places, which is the warm edge of real.
- **The daily range in the moist east is 12 F,** just inside the test's limit. Moist-ground heating (110 W/m2) keeps afternoons near 83 F.
- **Not changed:** the 850 mb jet of 70-90 kt on strong-flow days (seed 31415) is mostly the outer model's own, the dome adding about 40%. Shear over 100 kt (0-6 km) occurs in 1-3% of cell-hours on strong-jet days.

### Applied 2026-10-20: outlooks, discussions, watches and warnings (items 3, 7, 9, 20-29)

**Outlooks** (DayOneOutlook.js, OutlookRuntime.js):
- **Issue times are the centre's** (`issueTimesUtc`): Day 1 at 06, 13, 1630, 20 and 01Z; Day 2 at 06 and 1730Z; Day 3 at 0730 and 1930Z. An issue less than 6.5 hours before 12Z is for the coming day.
- **Caps** (`leadCaps`): Day 2 at most Moderate, Day 3 at most Enhanced.
- **One step per issue:** each issue may raise its day's category by at most one step from the last, until 4 hours into the day (`nowcastAfterHours`). When a cap holds the outlook down, the uncertainty section says so.
- **Timing from counts:** severe storms and tornadoes are now counted per hour, where before it was only whether there were any. The text gives the hours holding the middle 70%, from the period's start, and says "ongoing at the start of the period" when it is.
- **Environment read near the runs' storms:** the cap sentence now reads the air there (a strong cap only lets storms form where boundaries lift the air through it).
- **Wording:**
  - the moisture sentence names its measure (58 F dewpoints by late afternoon), with no instability sentence when MLCAPE is under 250;
  - a Marginal Risk says "isolated severe thunderstorms are possible";
  - local times are CDT, and headlines name the map's regions;
  - the uncertainty is written from the runs' spread, and two runs never "agree closely".

**Discussions** (MesoscaleDiscussion.js, Watch.js):
- **A tornado watch** also at a 40% chance of a strong tornado, or when the most probable peak is EF2 or more.
- **Small tornado-only areas** of 12 cells or more are areas of concern.
- **About a watch in effect, only when something changes:**
  - the threat turns to tornadoes in a severe thunderstorm watch;
  - 4 hours pass with a watch's worth of severe weather going on;
  - once, that the threat is waning, with 2 hours or more left;
  - a watch must follow one that is expiring.
- **Wording:**
  - "steep" mid-level lapse rates only at 7.5 C/km (fairly steep at 7);
  - a tornado call with low helicity now says so and why;
  - "1 inch" and "one of them" in place of "1 inches" and "1 of them".

**Watches:**
- **Drawn smaller:** a margin of 1 cell, and at most 220 cells drawn (about 22,000 sq mi). When the area is bigger, the ground where severe weather comes first is kept, cut again until the finished watch fits.
- **Issued earlier:** once the runs bring severe weather within 2 hours, not only once storms fire.

**Warnings** (Warning.js):
- **Tornado warnings earlier,** on a tightening rotation trend or a strong mesocyclone (`earlyTornadoChance` 0.08).
- **Severe thunderstorm warnings** run 60 minutes, and are cancelled after 4 quiet scans.
- **No re-issue churn at the edge:** a storm counts as covered ahead where its own warning's path runs past every office's counties. That had caused re-issues at every scan near the map's edge.
- **An office for every warning:** a path in no county warning area takes the office of the nearest county.
- **LAT...LON and TIME...MOT...LOC in degrees,** with the map's north-west corner at 40.9 N, 101.6 W.

**Measured.** Product runs, 72 hours each, server stepping. The "before" is seed 8181 earlier the same day, with the same atmosphere code.

| | Before (seed 8181) | After (seed 8181) | After (seed 31415) |
|---|---|---|---|
| Watch sizes | up to about 45,000 sq mi | 12,000-24,000 sq mi | 12,000-25,000 sq mi |
| Tornado warning lead (median) | 0 min (first review) | about 10 min (false alarms 0.50) | 5-10 min (0.55) |
| Severe thunderstorm warnings | 596 | 413 (3.3 a severe storm) | 1,104 for 240 severe storms |
| Same-storm re-issues 5 min apart | about a quarter | none (25th percentile 35 min) | 25th percentile 25 min |
| Warnings with no office | some | 0 | 0 |
| Day 2 / Day 3 above Moderate / Enhanced | yes (Day 2 High) | never | never |

`npm test` passes, 51 of 51.

**Still open:**
- **Tornadoes inside a watch:** 11 of 22 on seed 8181, now that watches are smaller; 17 of 21 on seed 31415. The centre's figure is about 75-80%.
- **Discussions about watches.** Final on seed 31415: 51 discussions for 32 watches.
  - About watches: 15 announce a following watch, 22 are updates at 3 hours (with 3 or more left) or a threat turning to tornadoes, and 3 say a threat is waning (the waning ones were about one a watch before the 2-hour limit).
  - Under no watch: 11.
  - 32 watches in 3 days is that world's 240 severe storms.
- **A small tornado-only area** can read "watch unlikely" with an intense most probable peak: the honest result of a few runs with a tornado.
- **Warning volume follows the storm climate:** 240 severe storms in 3 days on seed 31415.
- **The tornado wind against damage rating gap** (see the 2026-10-19 rating check).

### Chase and forecaster runs (2026-10-20), after the products pass

Same seeds as 2026-10-19 so the two can be compared: a 3-day chase on seed 5150 and a forecaster run (products plus mesoanalysis, 72 hours, server stepping) on seed 8181. The map was left out of scope.

**Better than 2026-10-19:**
- Watches came before the first tornado on seed 5150 (Tornado Watch 1 before the 09Z tornado); watch sizes 12-24k sq mi.
- Tornado warnings: POD 22/22, median lead about 7-8 min (was 0), every warning has an office.
- Day 2 stays at Moderate or below and Day 3 at Enhanced or below; the 06Z and 1630Z Day 1 High on seed 8181 verified (16 tornadoes, all inside Moderate or High).
- Real capping days: seed 5150 Days 2-3 had 700 mb at 11-13 C and MLCIN about -200 under 40-47 kt of shear.
- Seed 8181's outbreak had 9 of 16 tornadoes in daylight.
- Day 1 storms on seed 5150 moved 15-28 mph (was 37-46).

**Not better:**
- **Chase: 8 tornadoes, 0 seen**, again. All 8 came at night or in twilight (local 2:55, 6:20, 7:50, 19:15, 23:55, 0:35, 1:30, 4:00). The closest was 37 mi, at 1:30 am. On Day 2 (Moderate, 30%), STP 3-5 and 45-59 kt shear from 16-00Z brought no afternoon tornado.
- **Night lean:** 12 of 22 tornadoes from 8 pm to 6 am on seed 8181. By local hour, the median SRH01 over moist air is 47-56 from 11-18 against 120-139 from 0-5.
- **Too many violent tornadoes:** on seed 8181, 4 EF4 and 4 EF3 of 22 (EF2+ 55%; target about 15%).
- **No closed lows:** the lowest pressure sat on the map edge in 67 of 73 hours, with 0 closed centres.
- **Extreme night jet:** at 06Z on Day 3 the median SRH01 over moist air was 310, the 850 mb maximum 65-69 kt, and 58 cell-hours had SRH01 over 600.
- **Watch coverage:** 11 of 22 tornadoes inside a valid watch. The first tornado of a day and the early-morning ones are the ones missed; MD 32 said "tornado watch likely, 95%" at 08Z on Day 3, and the watch then held 1 of the 6 tornadoes.

**Found this time:**
1. **Left-movers outlive their right-moving parents.** Over 72 hours, left-moving splits held 34% (seed 5150) and 40% (seed 8181) of all supercell-hours. In 22 of 35 and 26 of 50 splits, the left child stayed a supercell at least as long as its parent. Parents were supercells for only 0.7-1.0 h of a 3-4 h life before turning into clusters or lines. In the chase, the tracked supercells in STP 2-4 air were mostly left-movers moving NNE at 40-50 mph. In a veering hodograph the right-mover should dominate and the left one weaken (handleSplits in StormEngine.js, leftSplitShare in StormModeEngine.js, leftHelicity in StormRotation.js).
2. **Discrete supercells don't last.** They are supercells for under an hour, and storms are fast: the median for split parents is 37-45 mph and for left-movers 41-49 mph. A chaser has almost nothing to stay with.
3. **Stacked warnings from one office.** 202 of 516 new warnings (53 tornado) were issued while the same office already had a valid warning of the same type for the same storm; one storm had 3 severe warnings from one office at once. The cause: `covered()` in Warning.js wants a warning with the full lead still left that also holds the projected position, so near expiry, or when the projection slips out of the polygon, a new one is issued beside the old. The new one should replace the old (or extend it). Cross-office pairs are fine, since each office warns its own counties.
4. **Warning wording and timing:**
   - **PDS overuse:** 31 of 103 tornado warnings were PDS.
   - **Tag inflation:** 147 of 413 severe warnings were "considerable" or "destructive".
   - **Late severe warnings:** they mostly come at or after a storm's first severe sample; the median lead is about 0, and many are 25-145 min late.
   - **Large polygons:** severe polygons have a median of 1,082 sq mi and a p90 of 4,854.
5. **Day 1 outlook flip-flops.** Seed 5150's Day 1 went ENH (12Z), SLGT (13Z), SLGT (1630Z), ENH (20Z), SLGT (01Z), because the one-step rule limits only raises. Day 3's 1630Z ENH with 15% tornado was drawn on SRH01 of 2-5 and verified with no tornadoes.
6. **Outlook text:**
   - The tornado timing windows are 16-19 h long ("16Z to 11Z", "16Z and 08Z, peaking near 06Z"), and they peak at 06-09Z even on daytime setups.
   - The summary names the Slight-risk area as where storms are expected, while the headline names the Moderate area.
   - "Adequate low-level shear" is written at SRH01 about 60.
   - The shear sentence reads the air near the runs' storms ("weak shear, 25 kt") when 42-47 kt sits beside it.
   - "Extreme instability" is written at MLCAPE 3,500.
7. **Discussions and watches:**
   - On seed 5150 Day 1 the first MD came at 03Z, so there were no daytime MDs.
   - "Watch unlikely" MDs carry a "120-150 MPH" tornado peak.
   - Watch probabilities contradict each other: Severe Thunderstorm Watch 13 has every hazard at 5% but combined at 95%, and Tornado Watch 3 has 2+ tornadoes at 5%.
8. **Mid-level lapse rates of 4.3-5.0 C/km** on non-plume days (seed 8181 Day 1, seed 5150 Day 1), more stable than a moist adiabat. Real warm-season Plains air rarely goes under about 5.5.
9. **Minor:**
   - Point fields jump near storms: at one point SRH01 went from 81 to 243 and 0-6 km shear from 38 to 59 kt in 30 minutes. In moist air, the hourly change in SRH01 is 76 or more in 5% of cell-hours and 133 or more in 1%.
   - Watch MD numbers are issued out of order within an hour.

### Applied 2026-10-20: the run's findings 1-9

**Storms:**
- **Splits** (StormModeEngine.js `leftSplitShare`) and a left-mover's own rotation (StormRotation.js) are read from 0-3 km helicity (ramp 50-200), not 0-1 km. Left-movers fell from 34-40% of supercell time to 2-5%.
- **Line organization** (`lineOrganizationTarget`) weighs the cold pool against the measured 0-3 km shear (new `shear03` in the storm environment) instead of half the 0-6 km. The soundings give 0.75-1.0 of it. Supercell phases on seed 8181: median 1.0 to 1.7 h, mean 1.3 to 1.7 h.
  - The outflow, rotation and occlusion uses of the balance keep the old definition, because their ranges were calibrated on it. Using the measured shear there too took seed 8181 from 21 to 49 tornadoes.
  - Tried and reverted: 0-3 km helicity for a ground-fed mesocyclone (more tornadoes, mostly at night).
- **Hail:** power 2 to 1.8, with the scale (2.12) keeping 1 inch at the same updraught. The 2-inch share of 1-inch-plus samples went from 17.6% to 13.7% on 4 worlds x 48 h.
- **The sounding's 700-500 and 850-500 mb lapse rates** use the layer's own mean temperature for its depth; they had read about 10% low. HAIL.lapseRange moves with it (7.2-9.4).
- Not changed: the reference profile (`reference500C` -9.5 still gives about 5.4 C/km without a plume). Steepening it to -11.5 removed quiet days and added hail, so it waits for the final tuning with the low-level moisture and CAPE.

**80 days (8 seeds x 10), before against after:**
- tornadoes a day 6.2 to 7.6, days with a tornado 73% to 81%;
- High 30% to 38% (High was already far over the 5% aim before this round), wind-only High 21% to 10%;
- days with 2-inch hail 76% to 66%, largest hail median 2.68 to 2.40 in.

**Warnings** (Warning.js):
- When an office re-warns a storm, its earlier warnings for that storm that no longer hold a storm warranting them are cancelled ("moved out").
- Severe thunderstorm warnings go out early on a growing core (`soon`: hail from 0.75 inch or gusts from 50 mph trending to severe within 15 minutes).
- Tags rise only on what two scans show, except on a new warning.

On seed 8181 over 48 h:
- **Stacking:** three at once from one office fell from common to 9 of 3,853 group-scans.
- **Severe lead:** median 5 min, p75 15 (was about 0).
- **PDS:** 21% of tornado warnings (was 40%).
- **Severe tags:** a damage tag on 39% of severe warnings (was 55%), destructive 4.5% (was 15%).
- **Severe polygons:** median 1,167 sq mi (was 1,515).

**Outlooks:**
- **Continuity:** each issue keeps 35% of the last issue's chances for the same day, 20% once the day is under way (OUTLOOK.continuity). Seed 5150's Day 1 was ENH, SLGT, SLGT, ENH, SLGT; it is now ENH, SLGT, SLGT, SLGT, ENH (the last raise came as night tornadoes began).
- **Timing:** the fewest hours holding 60% of the severe weather or tornadoes. Windows are 5-10 h, where they were 16-19.
- **Wording:** "the greatest risk" is said from Enhanced, and "extreme" instability from 4,000 J/kg (outlooks and MDs).

**Discussions and watches:**
- **MD watch chance:** where the tornadoes alone call for a tornado watch, the chance of a watch is at least the share of runs with a tornado, so there is no "watch unlikely" beside a 120-150 mph peak.
- **Watch table:** the 10-wind, 10-hail and 6-combined rows count each run's events as a Poisson mean. The tornado and peak rows stay plain shares.

**Not changed:**
- Daytime MDs on a weak-storm day (none were warranted).
- The shear and helicity sentences, which read the runs' storms by design.
- Field jumps near storms (outflow).
- MD numbering, which was in order; the harness listed them newest first.

`npm test` passes, 51 of 51.

**Still open (older items, unchanged):**
- the night lean (seed 5150 had 1 of 13 tornadoes by day in the probe);
- the EF mix (EF3+ about 23%);
- High days at 38%;
- lows off the map;
- the night jet;
- storm speeds of 40-50 mph on strong-flow days (Bunkers motion in that flow);
- the 75 mph gust share.

The next fix should be the final tuning pass: low-level winds by day and night, moisture and CAPE with the lapse rates, then the tornado rate and the category mix.

### Final tuning pass (2026-10-20)

Measured with a diurnal tuning audit (8 seeds x 5 days, server stepping: medians over moist air by local hour, tornado timing and ratings) and the activity report (8 seeds x 10 days).

**1. Low-level winds** (RegionalAtmosphere.js):
- Settings: `mixedLayerFriction` 0.4 to 0.15, `surfaceWindShare` 0.6-0.75 to 0.5-0.65, `surfaceBackingDeg` 25-15 to 40-30.
- Why: the afternoon's 850 mb wind was the mixed layer's at 0.6 of balanced, about 17 kt and nearly the surface wind. The night's jet swung from that deficit.
- 0-1 km helicity over moist air: by day (13-18 local) 53 to 89, at night (0-5) 147 to 129.
- 850 mb wind: 17 to 22 kt by day, 31 to 28 kt at night.
- Tornadoes from 9 pm to 6 am: 66% to 24%.

**2. Moisture, CAPE and lapse rates:**
- Settings: `reference500C` -9.5 to -11.5, `gulfMixingRatio` 16 to 14.75, hail scale 2.12 to 1.9.
- Lapse rate without a plume: 5.2 to 5.9 C/km.
- Afternoon MLCAPE over moist air: about 2,700 (unchanged).
- Dewpoint over moist air: 67 to 66 F.

**3. Tornado ratings** (TornadoEngine.js INTENSITY 70/70 to 40/30):
- Rated EF0-EF4 on 80 days: 49/32/10/6/1.6% (EF2+ 18%; the US record is 38/37/17/6/1.5).
- Peak winds about half a category above the ratings (EF4 winds 4-5%). Mobile radar suggests more; this mostly changes how many look violent.

**80 days, before this pass and after:**

| | Before | After | Aim |
|---|---|---|---|
| Tornadoes a day | 7.6 | 5.5 | about 5 |
| Days with a tornado | 81% | 61% | open (user to decide) |
| Night tornadoes (9 pm-6 am) | 66% | 24% | 25-40% |
| EF2+ rated | about 41% | 18% | about 15% |
| HIGH | 38% | 11% | 5% |
| MDT | 29% | 30% | 20% |
| ENH | 24% | 26% | 40% |
| SLGT | 6% | 25% | 30% |
| Marginal or less | 4% | 8% | under 5% |
| Quiet days | 3% | 5% | about 5% |

Other numbers after the pass:
- largest hail median 2.0 in;
- 2-inch hail on 54% of days;
- chaseable afternoons 68% (was 73%).

**Tried and not kept:**
- Gulf air at 15 g/kg: Moderate 44%. At 14.5: 17% of days under Slight and tornadoes on 58%.
- Tornado rate power 2: tornado days only 58% to 65%, more weak tornadoes, and it undoes the 2026-10-16 reason for power 3.
- Hail scale 1.75: little more gained, more quiet days.

**Left open:**
- **The spread between days:** moisture moves the quiet and the big days together, so Enhanced stays under its share and Moderate and High over theirs. It comes from how strongly the outer model's systems pass, which is a design question rather than tuning.
- **Tornado-free days** (39%).
- **Lows off the map.**
- **Fast storms** on strong-flow days.

**Chase after the pass** (seed 5150, the same 3 days as the morning's run):
- **Tornadoes:** 2 (was 8), both in daylight at 2:45 and 4:05 pm CST, where before all 8 were at night or in twilight. 0 seen; the closest was 104 mi.
- **Products:** Day 2's tornado peak was forecast for 22Z the day before. MD 3 and Tornado Watch 1 came ahead of the threat.
- **Supercells:** all three intercepted (two of them tornado-warned) turned into broken lines or clusters, or lost their rotation, within about an hour, by the time the car arrived (roads about 2x the straight line).
- **Moderate with 15% tornado** verified with 2 tornadoes: over-forecast.
- **Next for the game:** how long supercells stay discrete on busy days (coverage drives the line organization), and per-storm tornado odds by day.

**Forecaster review after the pass** (seeds 8181, against the morning's run, and 4096, new; 72 h each):

Better:
- **Watches:** 12 of 17 tornadoes inside a valid watch on seed 8181 (was 11 of 22); 3 of 3 on seed 4096.
- **Warnings on seed 8181:**
  - 161 severe thunderstorm warnings (was 413), with a median polygon of 559 sq mi (was 1,082);
  - "considerable" on 11% of severe warnings (was 36%) and PDS on 8% of tornado warnings (was 30%);
  - tornado POD 17/17.
- **The daily cycle on seed 8181:** 0-1 km helicity 72-97 by day against 99-113 at night. No cell-hours with 0-1 km helicity over 600 (was 58).
- **Outlooks on 8181:** the Day 2 forecast ran ENH, ENH, MDT, MDT; its tornadoes fell inside ENH/MDT.
- **Lows on seed 4096:** closed lows analysed in 19 of 73 hours, and the pressure minimum on the edge in only 38.

Found:
1. **Long-lived weak tornadoes.** On seed 8181, EF0s lasted 45-120 minutes (six of them an hour or more). A tornado lasts while its storm holds low-level rotation, whatever its own strength; with the wind scale lowered in the pass, the durations stayed. Real EF0s mostly last minutes; long tracks belong to strong tornadoes.
2. **Ratings bunched at the ends.** Seed 8181's Day 2 had 13 EF0, no EF1-2, 1 EF3 and 1 EF4.
3. **A heavy-handed High.** The 20Z Day 1 issue on 8181 went to High mid-event for a day of mostly EF0s.
4. **Short tornado warning lead:** median about 5 minutes on 8181, with false alarms at 0.55; 0.71 on 4096.
5. **An 850 mb jet of 75-90 kt** overnight in the north-west quadrant of a 986 hPa low on seed 4096 (726 cell-hours over 70 kt). This was earlier traced to the outer model's own flow.
6. **0-3 km lapse rates over 10 C/km** on the top map row only (seed 4096, 6 am-2 pm): an edge artifact.
7. **Weak-flow days have no afternoon low-level shear.** On seed 4096 the afternoon 850 mb wind is 9-10 kt and 0-1 km helicity 21-32; the night jet is 35 kt.
8. **Unchanged:** lows still pinned to the edge on 8181 (64 of 73 hours).

Causes, diagnosed the same day:
1. **Long-lived weak tornadoes.**
   - Cause: a tornado ends only when the storm's low-level rotation falls under `sustainRotation` 0.055 or the outflow occludes it, which takes up to 4.5 h of `occlusionHours`. Both are set by the storm, not by the tornado's own strength draw (`strengthUniform`).
   - Fix: let the tornado's own strength set how fast it dies (weak vortices in minutes, violent ones in tens of minutes), and keep the storm's rotation as the upper limit.
2. **and 3. Ratings bunched; a High on a day of EF0s.**
   - Cause: strength barely follows the environment. The 9 tornadoes after 20Z on 8181 were all EF0 in STP 4.3-5.5 and 0-1 km helicity 280-360, while the EF4 came in STP 2.1. The pass scaled all winds down alike (INTENSITY 40/30).
   - The High itself followed the rules: the runs, from storms that had just made an EF4 and an EF3, gave 30% with the EF3+ group.
   - Fix: steeper dependence on the storm's underlying rotation, with a lower base and a higher rotation scale, recalibrated to the same overall mix.
4. **Short tornado warning lead.**
   - Cause: warnings key on the same quantity that starts tornadoes (the chance from low-level rotation, rate as its cube), so a warning goes out only about when genesis becomes likely.
   - Fix: warn on a strong mesocyclone in a tornadic environment (the storm's own helicity, LCL and CIN), as forecasters do. That buys lead at some cost in false alarms, which are now 0.55-0.71 (the NWS's are about 0.7).
5. **The 75-90 kt 850 mb jet** (seed 4096).
   - Cause: not the night oscillation; the boundary layer's departure is 3-5 kt there. It is the balanced wind stacked: the outer model's 45-51 kt, plus the lee trough's 25-30 kt at 0.7, plus the low-level temperature pattern's up to 48 kt.
   - Fix: fade the lee and low-level thermal parts with height through their own depth, so they mostly affect the surface and the lowest km.
6. **0-3 km lapse over 10 C/km** (seed 4096). This is not an edge artifact: rows 0-3 all show it.
   - Cause: overnight 700 mb cooled from +4.8 to -5 C (cold advection aloft in the outer model) while 850 mb held 15 C and the surface 25 C, leaving 850-700 mb at about 13 C/km.
   - 850 mb comes from the regional air mass and 700 mb from the outer model, and nothing ties them.
   - Fix: a convective adjustment in RegionalAtmosphere, so the air under 700 mb is never left potentially warmer than the air above it; it mixes instead.
7. **Weak afternoon flow on 4096: a pooling artifact, not a fault.**
   - The 9 kt median is Day 1, a thunder-only day with 1,553 moist cells; Days 2-3 afternoons had 22-24 kt.
8. **Lows on the edge on 8181.** The region steering keeps the map in the warm sector and the parent low off-map (see the 2026-10-15 fronts and lows diagnosis); seed 4096 shows lows can cross when steered there.
   - Fix (a design choice): weight the steering toward "near the low" setups more often, or enlarge the regional domain.

**Applied 2026-10-20, the fixes for the review's causes** (in this order):
1. **Tornado lifetime** (TornadoEngine.js LIFE).
   - Each tornado draws its own life at touchdown, with a mean from 3 minutes (barely 65 mph possible) to 60 minutes (200 mph), as (way up)^1.5.
   - A spent vortex takes the low-level rotation with it (0.2 left), so the next tornado is a new cycle.
   - Median durations by rating EF0-4: 5/15/40/60/45 min (were 45-70 for all).
2. **Strength follows the air.**
   - INTENSITY is now 20 + 35 x rotation + 40 x the inflow STP (full at 6), with the damage survey's open-country share 0.4 to 0.25.
   - Ratings on 80 days: EF0-4 58/23/9.5/6/3% (EF2+ 19%); peak winds about a category above (EF4+ winds about 18%).
   - Median STP at touchdown: 3.7 for EF0 against 7.8-9.8 for EF3-4.
   - The sounding's hazard outlook uses the same scale.
3. **Convective adjustment** (RegionalAtmosphere.js adjustMarginK/adjustHours):
   - air near the ground potentially warmer than 700 mb mixes down within about an hour;
   - a mixed layer grown past 700 mb gives it its temperature.
   - Superadiabatic 0-3 km cell-hours on seed 4096: 486 to 60.
4. **The jet:** the lee trough's cyclogenesis gain fades where the outer model already has a low of 4-12 hPa (leeCycloneOuterLowHpa). 850 mb over 70 kt on seed 4096: 733 to 129 cell-hours, max 90 to 76 kt.
   - Tried and reverted: fading the lee and thermal winds with height. It missed the jet (on the high ground 850 mb is near the ground) and weakened the plains' own low-level jet.
5. **Tornado warnings:** no change. After step 1 the median lead was already 10 minutes on seed 8181 (false alarms 0.63, near the NWS's figures). An extra warning on a mesocyclone in high-STP air added no lead and raised false alarms to 0.68-0.87.
6. **Steering** (RegionSteering.js reaim): on days aimed at a low, the slide is worked out again every 6 hours.
   - Near-low miss: median 219 to 125 km.
   - Lowest pressure inside the map at 21Z: 17 to 27 of 80 days.
   - Most of the rest (39) is on the west edge, the lee trough along the foot of the high ground where the map ends: realistic as drawn.
7. **Tornado rate** fullRatePerHour 1.0 (tornado families: cyclic supercells), hail scale 1.8.

**80 days (8 seeds x 10):**
- tornadoes 5.7 a day; 30+ days 5%, 60+ days 1%;
- tornado days 59%;
- HIGH 13%, MDT 34% (hail alone reaches 56% of the Moderates), ENH 29%, SLGT 16%;
- quiet days 3%; chaseable afternoons 76%.

`npm test` 51/51 (storm-rotation's modest-air comparison now runs 120 storms).

**Reviews after these fixes** (the same seeds: the chase on 5150, the forecaster runs on 8181 and 4096):
- **Chase:** 2 tornadoes, both in daylight (1:10 pm, 89 mph; 4:45 pm CST, 136 mph). The closest was 22 mi, the best of three runs (37 and 104 before); 0 seen.
  - The 136 mph one came from S0134, intercepted on its NNE track at 2215Z. It turned NE, as a right-mover does, and passed east of the intercept point.
  - Two supercells within 40 mi went unchased: 20-minute looks are too coarse for 35-40 mph storms.
- **Tornadoes on 8181:** 11 (9 EF0, 2 EF2). EF0s last 0-10 minutes and EF2s 10-15 (were 45-120).
- **Watches:** 9 of 11 tornadoes inside a valid watch (82%).
- **Tornado warnings:** POD 11/11, median lead 10 min, 54 tornado warnings (was 104). False alarms 0.78, a little above the NWS's 0.7, now that tornadoes are fewer and briefer.
- **Fields:**
  - 0-3 km lapse over 10 C/km: 0 cell-hours on both seeds (was 486 on 4096);
  - 850 mb over 70 kt: 0 on 8181 and 105 on 4096 (was 726);
  - closed lows on 4096 in 13 of 73 hours; 8181's minimum still on the edge (66/73, the lee trough).
- **Outlooks:**
  - 8181's Day 2 ran ENH, SLGT, ENH, MDT (13Z), ENH, ENH, ENH, and its tornadoes fell inside ENH.
  - 4096's Day 3 went ENH to MDT (1630Z) to SLGT (20Z) on a hail and wind day with no tornadoes: a mid-day Moderate that came and went.
- **Seed 4096 warnings:** 247 severe thunderstorm warnings with a median polygon of 1,270 sq mi on a line-driven day.

**Diagnosed and fixed 2026-10-20 (the Moderates that come and go; tornado warning false alarms), with new-seed runs:**

1. **Moderate on hail days.**
   - The outlooks are honest: on 18 mornings, 60% hail areas verified 79-91% of the time, and the Day 1 Moderate rate forecast (11%) is under the verified one (17%).
   - The truth is that hail falls widely. 35 storms a day have 1 inch or more (48 on Moderate and High days), and on such days much of it comes from supercells.
   - Tried and reverted:
     - sampling hail like reports (35% of storm-cells): no change, because a hazard counts within 25 miles anyway;
     - less hail from storms that do not rotate (nonRotating 0.65 and 0.55): 35 to 25 hail storms a day, Moderate unchanged.
   - What is left needs a decision: fewer supercells per day, or refitted intensity bars (excluded by the rules).
   - Seed 4096's Moderate at 1630Z was a 3% area as the event reached the map's east edge; it went at 20Z with the storms. That is reasonable.
2. **Tornado warning false alarms.**
   - Pieces issued at once for a neighbouring office's counties were all false alarms (14 of 80 tornado warnings on seeds 8181 and 4242). Such a piece now goes out only when the storm is due there within downstreamMinutes (15).
   - Tried and not kept: dropping or tightening the strong-mesocyclone early path, which cut false alarms further but cost 5 minutes of lead.
   - With the final code: seed 8181 lead 10 min, false alarms 0.74; seed 1357 POD 53/54, lead 15 min, false alarms 0.54, tornado warnings 326 to 210; seed 2468 lead 20 min, false alarms 0.63.
3. **Found by the new-seed forecaster run: an 850 mb jet of 100-132 kt on seed 1357** (4,760 cell-hours over 70 kt, 3,252 over 600 of 0-1 km helicity).
   - Cause: the regional frontal cyclone (cycloneGainHpa) deepened to 17 hPa in a low about 50 km across (smoothed only 3 cells), with a balanced wind of 188 kt.
   - Now smoothed over 6 cells: 141 cell-hours, at most 76 kt, closed lows on 14 of 73 hours (16 before). Seed 4096's small closed lows (13 hours) are gone.
   - Tornado rate 1.0 to 1.25 to keep the climate: on 80 days 5.3 tornadoes a day, tornado days 53%, EF2+ 19%, HIGH 11%, MDT 31%.

**New-seed runs:**
- **Chase on seed 7777, 10-minute checks:** 0 tornadoes in 3 days, and the outlooks never went above 5% tornado, so they were right.
  - Day 1 (Enhanced; STP 1-1.6, SRH01 about 170, 36-50 kt) gave only fast multicells, lines and an MCS. No supercell formed in the capped, crowded air: a chaser's dud.
- **Forecaster on seeds 2468 (quiet, 1 tornado) and 1357 (outbreak):**
  - On 1357, 48 tornadoes from 10:45 am to 8 pm CDT, 6 rated EF3; 47 of 53 inside a watch.

`npm test` 51/51 (counties: the storm crossing an office line is now 6 miles out, and a new case checks that a storm 20 miles out gets no downstream piece).

**Chaser and forecaster on the same seed, 5000 (2026-10-20):**
- **The weather:** Day 1 was a Slight with no tornadoes; Day 2 a High-Risk outbreak; Day 3 dry behind the front.
  - Day 2 had 42 tornadoes: EF0-4 19/12/8/2/1, median 5 min, 16 between 9 am and 8 pm CDT and the rest in the evening and night.
  - Shear was 73-80 kt under an 80 kt 500 mb jet, and storms moved 49-63 mph.
- **The forecaster's view:**
  - Day 2 forecast: MDT the day before, then HIGH from 06Z through 01Z (45% to 60% tornado), and it verified.
  - Watches: 40 of 42 tornadoes inside a valid watch; MDs said "tornado watch likely" from 13Z.
  - Tornado warnings: POD 42/42, median lead about 7 min (a third had none on the fast storms), false alarms 0.73, 268 tornado warnings.
  - Severe thunderstorm warnings: 831 in 3 days, 30% "destructive" and 23% "considerable", median polygon 1,070 sq mi. That is too many, the warning-volume item.
  - Fields: 850 mb over 70 kt in 518 cell-hours, a strong synoptic day; 0-3 km lapse over 10 C/km in 109 (the dry deep mixing of Day 3); closed lows in 10 of 73 hours.
- **The chaser's view:** 0 seen of 42, 416 miles. The 77 and 112 mph tornadoes came at 12:40 pm, 38-52 mi away. Two tornado-warned supercells (S0038, S0077, couplet 0.43) passed within 4-5 mi without a tornado while near the car.
  - The 144 mph S0111 tracked to 20 mi at 7:25-7:55 pm: an intercept that a drive north-west at first sight would probably have made (a chaser's miss).
  - The closest was 10.5 mi just after dark.
  - At 50-60 mph only storms coming toward the car could be met; none could be caught from behind.

**More tornado days (2026-10-20):**
- **Diagnostic** (tordiag.mjs in the job tmp; 80 days): 30 days had ground-fed supercells and no tornado.
  - Near the ground they were fine: helicity factor 0.94, cloud base 0.89 (LCL 984 m), outflow 0.83, SRH01 about 226.
  - Their mesocyclones were about half as strong (0.41 against 0.75): the helicity turning took 0.36 of 0.65 against 0.59, the ramp saturating only at 350.
  - Expected tornadoes from their rates: 0.13 a day.
- **Change:** ROTATION.helicity [50, 350] to [50, 250], and the tornado rate 1.25 to 0.9.
- **80 days:** tornado days 53% to 59%, with the mean unchanged at 5.3 a day, 60+ days 1%, EF2+ 17%, HIGH 11%, MDT 31% to 33%, SLGT 16% to 19%. Chaseable days 89%; night share 25%.
- **Also tried:**
  - saturating at 200 (rate 0.75): tornado days 68% but MDT 38%, through hail, whose size follows the mesocyclone;
  - 225 (rate 0.82): tornado days 59%, MDT 39%.
  - Runs differ by about 4 points.

**Helicity 200 and hail (2026-10-21):**
- **Settings:** ROTATION.helicity [50, 200], tornado rate 0.75.
- **The extra Moderates came from more storms:** at 200 against 250, storms a day 88 to 93, hail storms 32 to 36, largest hail median 2.14 to 2.29 in, Moderate days 26 to 30.
- **Hail melting** (StormHazards.js, with wetBulbZeroAglM now in the sounding summary and the storm environment): loss 0.3 in x (wet-bulb zero / 3 km) / sqrt(size). The hail curve goes back to power 2, scale 2.0.
- **Hail CIG1 bar 0.08 to 0.2** (user's decision): 8% was below this world's own share of 2 in among 1 in hail.
- **80 days:**
  - Moderate 38% to 25%, Enhanced 28% to 38%, High 10%, quiet days 6%;
  - hail-only share of Moderates 63% to 45%;
  - hail CIG1 days 38% to 25%, CIG2 (3.5 in) 0% to 4%;
  - largest hail median 2.33 in (90th 3.29);
  - tornado days 68%, 5.2 a day, EF2+ 18%.
- **Also tried:**
  - melting with the old curve: Moderate 20% but no giant hail;
  - power 2 with scale 2.3: CIG2 on 13% of days and Moderate 36%;
  - power and scale 1.9: Moderate 25%, CIG2 1%.
- `npm test` 51/51. sounding-hazards tests melting; world-risk-categories' fixture has a 2/7 share of 2 in.

**Outlook spread and intensity groups (2026-10-21, 18 mornings):**
- **Outlooks run low:**
  - Day 1 Enhanced-or-more 10% of the map against 14% verified; Day 2 6% against 18%; most misses are too low.
  - Contours under-confident: 45% hail areas verify at 64-78%, 60% at 86%.
  - Groups drawn far less than they verify: Day 1 hail CIG1 6% against 17%, Day 2 0% against 25%; tornado CIG2 0% against 11%.
- **Tried:** groupAgreement [0.5, 0.75] to [0.375, 0.625] with the runs' perturbations at 70% of their size. It changed nothing beyond noise; reverted.
- **Likely causes:**
  - the chance calibration (outlookCalibration.js) was fitted on 2026-10-17's climate, and its guard keeps it from raising into the Moderate/High levels;
  - groups are judged on the typical run and need half or more of the runs to agree, with no calibration of their own.

**Outlook calibration refitted, intensity groups calibrated (2026-10-21):**
- **Chances:** CALIBRATION was refitted for Days 1-2 on 40 mornings (seeds 1-8, 5 each) of the current climate. Day 3 stays uncalibrated. The guard on raising into the Moderate/High levels is kept.
- **Groups:** new CIG_SHARE, fitted by the new scripts/fit-cig-calibration.mjs from outlook-verify --cig-data.
  - Each contour area records the share of runs whose own reports reach each group.
  - A group is drawn from the lowest share at which it verified on its area's reports more often than not; that replaces the median run plus OUTLOOK.groupAgreement.
  - Groups with fewer than 40 areas in the data keep the agreement they needed before.
  - Fitted: Day 1 tornado CIG1 from 3/8 of the runs (verified 54% there, 76% from 5/8); hail CIG1 from 4/8 on Days 1-2 (86% and 50%); Day 2 wind CIG1 never (0% of 47 areas).
- **On 18 unseen mornings (seeds 9-14)**, forecast against verified:
  - Day 1 Enhanced-or-more map share 13% against 15% (before, on seeds 1-6, 10 against 14);
  - Day 2 14% against 20% (before 6 against 18);
  - Day 1 groups drawn: tornado CIG1+ 22% against 18% verified, hail 6% against 6%, wind CIG2 6% against 6% (before: hail 6% against 17%, tornado 6% against 11%).
- **Still open:**
  - The top contours remain under-confident (Day 1 45% hail areas verify 81%, 60% verify 94%). The guard keeps calibration from raising into those levels.
  - Intense groups (tornado CIG2/3, hail CIG2) are still not drawn: too few cases to calibrate on.
- `npm test` 51/51.

**Refit on 100 mornings (seeds 1-20, 5 each), the same day:**
- **Chances and groups refitted.** The fit never asks less of the runs for a higher group than for a lower one.
- **The 40-morning fit had been noisy.** At 3 of 8 runs, Day 1 tornado CIG1 verified 24% in the larger data.
- **Fitted shares** (of the 8 runs needed to draw a group):

  | | Tornado | Wind | Hail |
  |---|---|---|---|
  | Day 1 | CIG1-2: 4/8 (CIG2 verified 93% from 3/8, 14 areas) | CIG1: 5/8 | CIG1: 5/8 |
  | Day 2 | 6/8 | 6/8 | 6/8 |

- **Still too few cases:** hail CIG2 (22 areas) and tornado CIG3 (35) keep the old agreement ramp.
- **On 18 unseen mornings (seeds 21-26):**
  - Day 1: 72% of categories right, 100% within one. Map share at Enhanced or more 29% forecast against 30% verified; at Moderate or more, 13% against 14%.
  - Tornado CIG2 drawn 6%, verified 6%.
  - Hail CIG1 is drawn too often (39% against 22%). Tornado CIG1 is drawn too rarely (6% against 17%).
  - Day 2 under-forecasts Moderate (6% of the map against 18%).

**Storm reports and damage surveys (2026-10-21):**
- **Storm log.** The live world keeps a daily storm log (js/reports/stormLog.js, `world.reportLog`, 14 days):
  - Days run 12Z to 12Z, as the SPC's do.
  - `world.stormHistory` is emptied at each 12Z.
  - Forecast snapshots skip the log.
  - It runs from `AtmosphereWorld.onStormTick`, which only the live runtime sets.
- **Reports page** (reports.html):
  - Tornado, hail and wind reports in SPC format: map, three tables, CSV.
  - A report is filed where people would see it: within a town's reach (less at night), one per storm, hazard and town, from where the storm passed closest.
  - Whether a town reports at all is a draw that rises with its population.
  - Hail is reported at the standard sizes. Wind is a measured gust near towns of 10,000 or more, otherwise damage of unknown speed.
- **Damage surveys page** (damage.html), after the NWS Damage Assessment Toolkit (js/reports/damageSurvey.js):
  - Each tornado's centreline, EF contours and damage points.
  - Damage indicators and degrees of damage come from the EF-scale tables (Texas Tech 2006, js/reports/damageIndicators.js): FR12, MHSW, MHDW, SBO, ES, MBS, TH, TS.
  - What stands on the ground comes from the map: town cores and extents, land cover, elementary schools, industrial parks (js/reports/surveyMap.node.js).
  - A tornado is rated from its worst surveyed damage, and EFU when nothing ratable was hit. Trees cap a rating at EF3.
- **Survey tracks follow the tornado's life.**
  - The engine moves a tornado through its last 5-minute step before ending it, so the log takes that stretch from `tornadoHistory`, which now carries `lifeMinutes`.
  - A tornado whose vortex ran out ends at its drawn life.
  - The path starts and ends at the 65 mph damage threshold and curves through the steps.
  - Durations on seed 5000, Day 2: 0.3-65 minutes. Before, 27 of 42 were exactly 5 minutes.
- **API:** /api/reports/days, /api/reports?day=N, /api/damage?day=N (server/ReportsRuntime.js).
- **Open:**
  - Wind reports are heavy on outbreak days (seed 5000 Day 2: 825 wind, 215 hail, 25 tornado). The storms' gusts are the cause, the same thing behind its 831 severe warnings.
  - Tracks are near-straight, because storms move 45-60 mph in a steady direction.
- **Occlusion now moves the tornado** (TornadoEngine.js, OCCLUSION_TRACK), at the user's request.
  - The rear-flank outflow carries the tornado left of and behind the wall cloud, in proportion to storm.occlusion (up to 1.5 updraught radii left, 1.0 back).
  - The tornado is carried by that shift, so "left behind" endings and tornado counts are unchanged.
  - Seed 5000, Day 2: same 42 tornadoes and durations; most tracks hook 15-60° left.
- **Non-occluding (steady) tornadoes** (STEADY), at the user's request.
  - A per-tornado draw stands in for the rear-flank downdraught's buoyancy, which this scale cannot resolve.
  - Odds: up to 0.35 for wind ceilings from 136 mph (full by 200) in 0-1 km SRH from 250 (full by 450).
  - Such a storm occludes at 0.1 of the usual rate, and the tornado lives 2.5 times as long: a long, near-straight track with steady wind and width.
  - In its last 10 minutes the outflow wraps round after all, and it hooks and dies.
  - About 1 in 8 tornadoes with 136+ mph winds (4 of 31 over seeds 1-6, 5000 and 8181). Examples:
    - 90 mi, 120 min, surveyed EF5 (seed 8181, with the SRH range at 150-400);
    - 61 mi, 170 min (seed 6).
  - The SRH range started at 150 at first; storm-rotation.mjs caught modest air (SRH 190) lengthening its tornadoes, so it now starts at 250.
- **Stepping no longer loses reports** (asked: are reports missed by the stepping?). Measured on seed 5000, 2 days:

  | Path | Lost before | Fix | After |
  |---|---|---|---|
  | Live clock (5-min storm ticks) | No tornadoes; hail and wind reports where a storm passed a town between samples (11% of passes) | stormLog judges each pass along the storm's path since the last tick | Hail 215 to 254, wind 825 to 986 |
  | Manual advance and catch-up after a pause (30-min storm steps) | 16 of 30 tornadoes, about 70% of reports | runtime.advance and the catch-up move storms in 5-min ticks (stormTicksTo, which sets the rounded storm clock to the hour rather than taking a sliver tick) | Same weather and log as the live clock |

  - Safety net: the log takes any tornado the engine recorded but never saw on the ground from its tornadoHistory.
  - Wind reports on outbreak days are heavier still (986 on seed 5000, Day 2).
- **Tornado rate on marginal supercell days.** The user was concerned about seed 1000: 17 tornadoes in 13 days, on 4 days.
  - Cause: on tornado-free supercell days (67% of them), the best storm's low-level rotation peaks near 0.23 (SRH01 about 178, shear about 53 kt). At rate power 3 that expects about 1% per supercell; in reality perhaps 20-25%.
  - TORNADO now has power 2 and full rate 0.6 (was 3 and 0.75). This is about 1.7 times the rate at rotation 0.23, and the same at 0.4.
  - Activity report, seeds 1-3 × 30 days:
    - days with a tornado 57% to 64%;
    - mean tornadoes a day 4.4 to 5.9 (median 1);
    - days with 30+ tornadoes 3% to 6%, the most on one day 42 to 61;
    - High-risk days 12 to 13.
  - Seeds 1000-1002, 13 days: days with a tornado 28% to 33%.
  - Power 2 at full rate 0.75 overshot: 69% of days, mean 7.2, the most on one day 74, 17 High days.
  - Still open:
    - EF0 is 71% of ratings (US about 38%);
    - spells of weak low-level helicity (seed 1000 days 9-13, SRH01 120-155) stay tornado-free, with the mesocyclone as the limit.
- **Physical tornado ratings** (the user's choice), measured on 362 tornadoes (seeds 1-6 × 10 days).
  - TornadoEngine DAMAGE_RATING: a tornado is rated EFk where its EFk contour held something able to show it. The contour area is the path width's share above the threshold (power-0.6 falloff) × 40% of the path. Indicator densities per sq mi: EF1 5.9, EF2 1.3, EF3 0.6, EF4 0.13, EF5 0.1.
  - Engine ratings EF0-EF5: 57 / 30 / 9.4 / 2.2 / 0.6 / 0.8 (were 59 / 23 / 10 / 4.7 / 2.5 / 0.3; US 2008-22: 52 / 35 / 9.3 / 2.4 / 0.45 / 0.05).
  - The activity report's reference was the F-scale era (EF0 38%); it now shows the US 2008-22 shares.
  - Survey (damage page):
    - estimates within each degree's bounds by construction quality, as surveyors do, never above the wind that occurred;
    - wood-pole distribution lines (ETL, degrees 1-4) on about half the section lines;
    - trees and poles capped at EF2 (135 mph) on their own.
  - Survey ratings 47 / 30 / 17 / 3.2 / 2.5 / 0.7, plus EFU 17% (short tracks over open farmland). The survey and the engine agree within one category on 90% of tornadoes.
  - Open:
    - the survey does not set the official rating (reports and verification use the engine's);
    - outlook intensity calibration should be refit, since EF2+ fell from about 18% to 13%.
- **More EF1s and EF4s** (the user's wish):
  - DAMAGE_RATING densities refit to 9.6 / 1.9 / 0.72 / 0.13 / 0.08 per sq mi.
  - On the same 362 tornadoes: EF0-EF5 46 / 38 / 11 / 3.9 / 1.1 / 0.3 (aim 45 / 38 / 11 / 4 / 1.5 / 0.15).
- **Tornado intensity groups go by EF-equivalent wind** (verification/truth.js uses windEf, not the damage rating), at the user's request.
- **Outlooks recalibrated** on 100 mornings: chances, and CIG_SHARE.
  - Tornado groups are fitted for the first time on Day 1 (CIG1 from 1/8 of the runs, CIG2-3 from 5/8) and on Day 2 (CIG1-2 from 4/8; CIG3 never, 48% at 4/8).
  - On 18 unseen mornings (seeds 21-26):
    - Day 1: 67% right, 100% within one; map share at Enhanced or more 31/30, at Moderate or more 14/14.
    - Tornado groups drawn 39% against 33% verified (Day 2: 50 against 42).
    - Day 2 Moderate still low (11 against 17).
- **Chase playability ideas** (travel compressed as much as time; a visible funnel before touchdown and rope-out after) are documented in docs/ROBLOX-SCALE.md for the Roblox side.
- **Occlusion motion without loops:** occlusion turns the tornado's velocity left (up to 60°) and slows it (to half), rather than moving its place. On three seeds no track runs back (before, steady tornadoes looped at their end); the most-turned tenth hook 27-76° left.
- **Path lengths stay about 3× the record** (the user chose not to shorten tornado lives or slow the clock). The causes are forward speed (38-44 mph against about 30) and life.
- **Housekeeping:** the old data/cache/authority-state.bin (42 MB, from before the redesign) was deleted.
- `npm test` 52/52 (new: storm-reports.mjs).

**Still open:**
- **The category mix:** Moderate and High are over their aims, more so with more near-low days. Hail-only Moderates, and wind on the High days.
- **Tornado-free days:** 41%.

Tests: `npm test` 51/51. In radar-range-and-coverage the debris assertions were eased (CC 0.8 to 0.82 near the radar, the near-far gap 0.1 to 0.09): the test's world now has a windier boundary layer that spreads the debris a little.

## Agenda (2026-10-15)

Done 2026-10-15: sharper fronts and drylines (cubic semi-Lagrangian advection, a pressure
trough along fronts from the air-mass contrast, friction carrying the air into troughs; front
width 129 to 80 km) and pressure centres marked by closed isobars. No "L" shows yet because
the region sits in the warm sector, east of the lows (step 7).

### What was measured (seeds 1-8, the same day)

- About 40-45% of days reach High (aim about 5-10%). Wind alone makes a third of them;
  tornado reports piling up on the biggest days make the rest.
- Storms never become MCSs, lines are rare, and tornado days look alike whatever made them.
- **Storms do not start on the lines.** Only 6% of new storms start within 30 km of a
  dryline (3% of the moist air is there); starts are no closer to fronts than the moist air is.
- **The cap is there in the morning and gone everywhere by afternoon.** Inhibition in the
  moist, unstable air (median): 94 J/kg at 15Z, 36 at 18Z, 4 at 21Z (real afternoon warm
  sector 25-75). At 21Z heating alone beats it in 56% of the moist air.
- **Large-scale ascent acts as a trigger, not as preparation.** It is read from 500 mb height
  falls; at 21Z it is at full strength over half the moist air, and on its own it beats the cap
  in 58% of it. Boundary lift is weak beside it (median 0.01, 90th 0.41 of full).

### How storms start in the real atmosphere (what the work below follows)

- **Large scale (the outer model).** Quasi-geostrophic ascent is a few cm/s, set by the
  vorticity advection that increases with height and by warm advection (the omega equation;
  Q-vector convergence). It does not set storms off. Over hours it lifts and cools the capping
  layer, deepens the moist layer, and decides *where* the cap can be broken that day. Under
  sinking air the cap strengthens and the day busts.
- **The cap.** Hot, dry air off the high ground (the elevated mixed layer) lies over the
  Gulf air. It keeps the warm sector capped through the afternoon, so storms come only where
  something lifts the air through it. Warm advection at 700 mb keeps it strong during the day.
- **Heating.** The sun deepens the mixed layer and lowers the inhibition, but not evenly:
  moist or rain-soaked ground, morning low cloud, and cloud left by storms heat more slowly.
  Where the heating differs, it makes boundaries of its own.
- **Mesoscale lift.** Convergence along drylines, fronts and outflow, strongest where they
  cross; confluence bands and pre-frontal troughs in the warm sector; upslope flow; and
  boundary-layer rolls, which alone seldom start storms but set the exact spot along a line
  (Weckwerth and Parsons 2006; Ziegler and Rasmussen 1998).
- **Night.** The low-level jet carries moisture and warm air north over the cooled ground;
  where it converges at its northern and eastern end (and over a warm front), lifted parcels
  start storms well above the ground. This is how most night storms and MCSs begin.
- **Moisture return.** After a front clears the Gulf, the air coming back is shallow and
  modest for a day or two before the sea moistens it again. A shallow moist layer mixes out
  by afternoon, which keeps such days marginal.

### How the outer model fits

- It supplies the right things for this: winds, the troughs and ridges, the temperature of
  the troposphere. It is coarse (80 km, systems about 1,000 km across), so its ascent is broad
  and slow, which is right for preparation and wrong for a trigger.
- Its own vertical motion is already in it: in a two-layer model the ascent follows from the
  change of thickness (the temperature between the layers) that the flow does not account
  for. That carries both terms of the omega equation, including warm advection, so ascent
  falls north and east of the low, over the warm front, as well as ahead of the trough.
  500 mb height falls see mostly the vorticity part.
- It has one temperature for 250-750 mb, so it cannot hold the cap or warm advection at
  850-700 mb. Those belong to the regional layer: its 850 and 700 mb air moved by its own
  winds, with the lifting of that air over cooler air (isentropic ascent) worked out from them.
- What it lacks (frontal circulations, the low-level jet, heating, the cap) is added in the
  regional layer, as with the fronts today.

### The climate to hold through all of it (agreed 2026-10-15)

The changes below move storm numbers a lot; these are the targets every check is held to, and
re-balancing (step 7) is done against them only.

| | Now (104 days, seeds 1-8) | Target |
|---|---|---|
| Tornadoes a day, mean | 7.5 | about the same |
| Days without a tornado | 25% | about 10% |
| Days with no severe weather | 1-3% | under 5% |
| High | 38-45% | about 5% |
| Moderate | 18-21% | 10-15% |
| Slight and Enhanced | 33-40% | most days (75-80%), a few tornadoes in a local area |
| Marginal or less | 2-6% | under 5% |
| Tornadoes that are EF2+ | about 30% | about 15% |

Keeping the mean while High falls means spreading the tornadoes over more days (fewer days
with none, fewer with 30+; days of 21+ now give 43% of all tornadoes) and fewer of them
strong: a day reaches High through the intensity group, which comes from the EF2+ share. The
category tables and their intensity bars stay as they are; the weather is what changes.

### One model (agreed 2026-10-15)

The atmosphere becomes one model with one state and one time step, built from tested reduced
models rather than patched piece by piece. WRF, MPAS and cloud models are ruled out (cost).
Each part writes fields the next reads; the storms feed back into the same state.

| Part | Built from | What it holds and does | Now |
|---|---|---|---|
| A. Weather systems | Moist two-layer quasi-geostrophic model (Lapeyre and Held 2004) | Troughs, lows, winds; a moisture field and latent heating, which make lows stronger and more compact; its own vertical motion (vorticity and warm advection) | Dry two-layer QG model; ascent read from 500 mb height falls |
| B. Boundary layer | Slab mixed layer as the model's lowest layer (UCLA model, Suarez, Arakawa and Randall 1983; the CLASS equations) | Per column: depth, temperature, moisture, the temperature jump at its top (the cap). Heating grows it into the cap; ascent from A cools the cap from above; sinking warms it | `RegionalAtmosphere` heat, mixed depth and moisture, worked out by rule |
| C. The lid | Elevated mixed layer (Carlson et al. 1983) | Hot, dry air made over the high ground and carried over the Gulf air by the 700 mb wind; its temperature and depth set the cap's strength | The `eml` share (0-1) |
| D. Convection | The storm engine as the model's convection scheme; start when lifting energy beats the cap (ALE, Rio et al.; Kain-Fritsch trigger) | Lifting energy from convergence (lines, their crossings, confluence), thermals, cold pools, upslope; storms put cold pools into B, warm and dry the air aloft, release latent heat into A | Fixed lift energies (170 / 60 / 90 / 30 J/kg) against CIN |

Cost stays close to today's: B and C are a few numbers per column on 2,500 columns, and A gains
one field on its 128 x 64 grid.

### Progress (2026-10-15, steps 1-6 applied)

1. Gusts: `GUST.downdraughtShare` 0.4.
2. Lee trough depth levels off (tanh) at 7 hPa instead of growing to 17.5: 850 mb wind median
   31 to 28 kt, 0-1 km helicity 158 to 129, STP 90th 4.9 to 3.5. The rest of the bias (the
   outer model's own southerly, the evening jet) is left for step 7.
3. Moist QG (`latentHeatShare` 1, 95% mean humidity): lows' cores sharper (rise within 160 km
   0.43 to 0.65 hPa), strongest ascent 0.28 to 0.40 K/h, rain over 7% of the domain; half-depth
   radius unchanged (set by the 80 km grid and the deformation radius). Its own ascent drives
   `capLift` (the cap cooled 2.4 times the column's cooling, carried with the 700 mb air) and no
   longer lifts surface parcels. Fixed on the way: latent heating had no balancing cooling (the
   domain warmed 1 K) and the arbitrary mean of the streamfunction leaked into pressure (sea-level
   pressure near 1,147 hPa); both corrected. Saved worlds from before are not resumed
   (`STATE_VERSION` 4).
4. Boundary layer: moist-layer top moves with the air, rises with ascent, arrives shallow after
   a front; ground wetted by storms' rain heats less and moistens the air; entrainment 0.2.
5. The lid: its own potential temperature, from the day's deepest mixed layer over the high
   ground and from the desert plateau beyond the map (`lidSourceThetaK` 318 entering from the west),
   cooling 1.5 K a day. 21Z inhibition in the moist air: median 4 to 24 J/kg (75th 129); 700 mb
   median 10 C, 90th 14 C.
6. Storm starts: Kain-Fritsch warming from the rising air at cloud base (surface convergence
   through the mixed layer, upslope, the outer model's ascent) over the capping layer, plus the
   thermals' lifting energy; elevated parcels lifted by 850 mb warm advection over the stability
   and the jet's convergence. `NET_LIFT_SCALE_J_KG` 30, `FORCED_RATE_PER_HOUR` 0.015.

Where the climate is now (40 days, seeds 1-4): storms a day median 60 (90th 177); no severe
weather on 23% of days (runs up to 5); a tornado on 65%; tornadoes a day median 1 (90th 9);
High 15%, Moderate 8%, Enhanced 35%, Slight 13%. Open for step 7: storms start only slightly more
often near lines (convergence on fronts is hardly above the background; the dryline about 1.5
times), so the capped, sheared, unstable air often stays capped while storms go up in weak,
uncapped air; and capped spells last several days.

Step 7 (2026-10-15, re-balance; checked on 40 days, seeds 1-4):

- Lines stand out: the cold air's push (`coldPushGradient`) now starts at a frontal contrast,
  2-4 K per 100 km instead of 0.5-1.5. The weaker gradients found all over the warm sector had
  been setting off most of the convergence away from the lines. Convergence (90th percentile)
  away from lines fell from 8.6e-5 to 1.9e-5 /s; near the dryline it is now 5 times that, near
  fronts 1.6 times.
- Storm starts: the share of a cell where lift beats the cap, with the lift spread within
  the cell (0.4 of the lift + 3 J/kg), times the base rate 0.015 an hour (in place of a rate
  in proportion to the surplus).
- Tornado rate 2.5 to 5 an hour (the environments are lower now), strength spread 52 to 40 mph;
  storms keep feeding from the ground through up to 200 J/kg of inhibition (was 150); rear
  inflow share 0.9 to 0.6; lid source 318 to 316 K.

| | Target | Before step 7 | Now |
|---|---|---|---|
| Days without severe weather | under 5% | 23% (runs of 5) | 10% (never two in a row) |
| Days with a tornado | about 90% | 60% | 88% |
| Tornadoes a day | mean about 7.5 | median 1 | median 6 (mean about 6.7) |
| High | about 5% | 13% | 8% |
| Moderate | 10-15% | 15% | 23% |
| Slight and Enhanced | 75-80% | 40% | 58% |
| Marginal or less | under 5% | 33% | 13% |

Environment (32 days): inhibition median 25 J/kg (90th 262), 700 mb 9.7 C (90th 13.6), lapse
rate 7.1 C/km, 850 mb wind 25 kt (90th 41), 0-1 km helicity 114 (still high; real 40-70), STP 90th 2.6.

Still open from step 7, decided 2026-10-16: the flickering fronts are looked at now (steps 8
and 10 rest on fronts); the rest waits for one tuning pass after step 12 (step 13), since steps
8-12 move the same numbers again.

2026-10-16:

- Flickering fronts: the outer model's latent heat came in 80 km patches that switched on and
  off; it is now spread over neighbouring cells (`latentHeatSpreadPasses` 2). Fronts move 1.4
  times as far between analyses as the wind carries them (1.6 before; 1.5 with no moisture).
- Step 8 done: storms near a front take in the spin it makes, from how fast the air masses'
  density changes there (`densityGradientK100`: virtual potential temperature, smoothed as
  the front analysis smooths, without storms' cold pools), full above 9 K per 100 km, none
  below 4. It reads the zone itself, not the drawn line (drawn, as analysts do, on the zone's
  warm edge). Frontal zones (4% of the map) have a median of 5.7 K/100 km; ordinary air 0.6;
  dryline zones 3.5 (moist air is lighter, so a dryline's density contrast is weaker).
- Fronts made stronger (2026-10-16). Measured on the frontal zones themselves (the core of each
  zone, 64 km either side), not on the drawn lines. The cause was supply: the outer model's
  250-750 mb temperature varies too little (about 1 K across 384 km at a front), and the
  regional layer took its air masses from it. Now:
  - the outer model carries the temperature of the air near the ground (`surfaceTheta`; Eady,
    surface QG) with its low-level flow over the whole country, on a mean that falls 10 K per
    1000 km northward, relaxed over 3 days; it does not change the flow. The regional air masses
    are drawn toward it (warm anomalies at 0.7: Gulf air stays near the sea's temperature);
  - cold air masses are dry: continental air holds 55% of what its temperature allows, both
    entering the map and as the air mass relaxes (moisture only ever comes down this way);
  - the front's trough: low-level air masses against the temperature the outer model's pressure
    already holds (its layer), smoothed over 2 cells, so the cold side's weight raises the
    pressure behind a front;
  - a front point walked to the warm edge of its zone stays on the map (a bug the stronger
    fronts showed).
  Strongest quarter of frontal zones: 10.8 F across 128 km (75th 16.7; was 6.2), 13.5 F across
  384 km (75th 23), wind turning 57 degrees (75th 92; was 17), trough 0.4 hPa (75th 0.9),
  dewpoint 4.4 F (75th 8.9; real 10-20, still short). Fronts move 1.16 times as far as the wind
  carries them.
  Side effects for step 13: warm sectors warmer (CAPE median 2,308 to 3,151; real 1,000-2,000),
  850 mb wind 25 to 31 kt and 0-1 km helicity 114 to 148 (the surface pressure now follows
  the low-level temperature); the analysis draws more lines (2.3 cold fronts per analysis).

Steps 9 and 10, together (2026-10-16):

- The map's reading point may slide north-south as well as east-west (`slideNorthMs`); only the
  weather overhead changes, not the map's climate (the mean north-south fall of temperature and
  the 500 mb height reference are taken about the map's own place).
- Steering aims each day for a kind of place in the weather (`kinds`): the warm sector (55%, as
  before), near a surface low (30%: the low 100 km north of the map's middle) or under the middle
  of an upper trough (15%); where none can be reached within 500 km, the warm sector. Its copy of
  the outer model now carries moisture and the near-surface temperature too (it ran dry before).
- The lee trough's axis lies on the map's western edge (`leeTroughColumn` 0.39, ground near
  1,000 m; it was 80 km off the map) and deepens where the outer model's ascent crosses it, by up
  to half again (lee cyclogenesis); its wind is worked out from its pressure in both directions.
- `scripts/setup-report.mjs` labels each tornado by the conditions where its storm started (line
  if its storm is in a squall line then) and each day by its main kind.

88 days (seeds 1-8): main setup of the day: front 23%, line 17%, triple point 8%, warm sector 9%,
mixed 7%, dryline 2%, outflow 1%, no tornado 33%. Tornadoes: front 33%, line 30%, warm sector 19%,
triple point 12%, dryline 3%; 44% at night. A closed low on the map at 21Z on 10% of days (13% of
the days steered near a low). For step 13: no tornado on a third of days (4.4 a day) since the
front fix and the new steering; days steered near a low go without a tornado most often (47%);
dryline tornadoes rare; many at night.

Steps 12 and 13, physics part (2026-10-16; tuning comes last):

- Clock test brought up to the 12x clock (25 s storm ticks).
- Lines keep the system's age through mergers (`systemAgeHours`), so MCSs and derechos can be
  recognised (days with an MCS: 0 before, about 10% now).
- Environment: the front pressure term counts a 400 m layer of near-ground air
  (`airMassPressureDepthM`), and warm anomalies reach the ground at 0.45 (`surfaceWarmShare`):
  surface temperature 90th 94 to 90 F (99th 107 to 97), 850 mb wind median 35 to 30 kt, 0-1 km
  helicity 167 to 138.
- Storm fuel: a storm feeds from the ground whenever the ground air can be lifted into it
  (inhibition up to 200 J/kg), and from aloft only when it cannot. It went elevated whenever the
  most unstable parcel had more energy than the mixed-layer one, which it nearly always has.
  Days without severe weather 13% to 3%, days with a tornado 77% to 98%, days steered near a low
  with a tornado 53% to 100%.
- Lift for parcels aloft: isentropic ascent follows the air (the local change of 850 mb potential
  temperature included, so a front moving with the wind lifts nothing), from fields smoothed as
  the front analysis smooths, with at least 3 K/km of stability; the jet's convergence from the
  smoothed 850 mb wind (90th percentile of each fell from 14-17 and 9-10 cm/s to about 7 and 4).
- Setup report: storm starts by setup, day and night, lines looked for within 2 cells.

Now (40 days, seeds 1-4): no severe weather 3%, a tornado on 98% of days, Marginal or less 3%;
too many tornadoes (mean 20.8, median 7) and High 30% (tornadoes) - for tuning. Storm starts
(8 seeds): most near a line; dryline and frontal zones overlap; dryline-born storms are the most
likely to make a tornado. Still to look at before tuning: the dewpoint drop across fronts, how
many fronts the analysis draws, hail from pulse storms.

Later the same day:

- Front analysis draws fronts from 5 K per 100 km over 250 km (`frontGradient`, `frontMinLengthKm`;
  drylines keep 200 km): 2.1 lines a map instead of 3.7, a front on 89% of maps.
- Hail grows with the square of the updraught (`HAIL.power` 2, reference 60 m/s): 1 in hail on 90%
  of days, 2 in on 30%; pulse and elevated storms now give the odd marginal stone.
- Squall-line gusts: `rearInflowShare` 0.5.

Tuning tried on 40 days (seeds 1-4), and what it showed:

| Change | Tornadoes a day mean (median) | No tornado | High |
|---|---|---|---|
| as now | 20.8 (7) | 3% | 30% |
| tornado rate 2.5 / 1.5 | 13.2 (4) / 9.2 (3) | 13% / 20% | 25% / 15% |
| a storm's recovery after a tornado 0.5 / 0.8 h | 20.1 / 19.3 | 3% | 28% / 25% |
| fewer storm starts (0.008), tornado rate 5 / 7 | 15.5 / 18.5 | 13% / 10% | 30% / 28% |
| storms 60 km apart | 19.9 | 10% | 25% |

None reaches the targets: the tornadoes are spread very unevenly over the days (a few days
with 60-100), and that comes from the environment rather than the storms: helicity in the lowest
km is still far above real (median 138 at 21Z, 192 at 00Z; real 40-70), so on a big day nearly
every supercell is tornadic. Next: bring the low-level winds and helicity down (the outer model's
low-level systems are carried to the ground undiminished, the lee trough's winds, the evening
jet), then set the tornado rate and strength.

Low-level winds and tuning (2026-10-16):

- Low-level spin down: lee trough at most 4 hPa (`leeTroughFlowHpa`), the wind near the ground
  turned 15 degrees toward low pressure by day and 25 at night (`surfaceBackingDeg`,
  `surfaceBackingNightDeg`; 22 and 38 before), boundary-layer friction 0.4. Helicity in the lowest
  km: median 138 to 96, 90th 311 to 220; 850 mb wind median 30 to 26 kt; STP 90th 3.0 to 1.9.
  Fronts lost some of their wind shift (strongest quarter: median 28 degrees).
- Tuning (40 and 120 days): neither the tornado rate, a storm's recovery after a tornado, the
  number of storm starts, their spacing, nor the share of steering kinds made the climate right.
  It is two-sided: too many quiet days (13-15%) and too many outbreak days (30+ tornadoes on 15%,
  60+ on 4-6%), too few ordinary days between. The outer model's systems pass about once a day at
  twice real speed, and steering puts the map in one; real Plains springs have a strong system
  every 3-6 days with moderate days between. Decided (the user): slow the outer model's systems
  down and space them out, then tune.
- Targets for the upper end (the user): days with 30+ tornadoes rare (about 5%), 60+ about 1%;
  quiet days rare (under 5%); the tornado mean about 5 a day, the rare big days allowed.

Slower, weaker systems and the tuning that followed (2026-10-16):

- Outer model: deformation radius 350 to 400 km, mean winds 26.5/17 to 22/14 m/s (less shear):
  a trough every 1.5-2 days, weaker than before, moving about 1,300 km a day (1,900 before).
  Steering slides no faster than 15 m/s (the systems' speed now).
- Gulf: scoured over 24 hours (12), back in 2.5 days (4.5): dry spells after fronts ran 5 days.
- Steering: warm-sector days search north-south as well as east-west; support wanted 0.2-0.35
  (0.35-0.8: with the weaker systems the support reached seldom passes 0.35, so steering took
  the most it could every day and the wanted value did nothing); lows counted from 2 hPa and
  upper troughs from 20 m (3 and 30), so those kinds of day are reached.
- Pulse storms: hail from non-rotating storms 0.8 of a rotating one's (0.5); downdraught share
  back to 0.5 (0.4). High-CAPE days in weak shear give the odd marginal report.
- Tornado rate kept at 5 (7 gave 30+ tornado days on 9%).
- Tests: region-steering checks a day aimed at a low as well as a warm-sector day, and the
  north-south slide.

80 days (seeds 1-8), against the targets:

| | Target | Now |
|---|---|---|
| Tornadoes a day | mean about 5, a few on most days | mean 7.8, median 4 (90th 22, most 47) |
| Days with 30+ / 60+ tornadoes | about 5% / 1% | 5% / 0% |
| Days without a tornado | about 10% | 16% |
| Days without severe weather | under 5% | 8% (longest run 3) |
| High / Moderate | about 5% / 10-15% | 4% / 11% |
| Slight and Enhanced | 75-80% | 70% |
| Marginal or less | under 5% | 15% |

Environment (32 days): 0-1 km helicity median 65 (90th 135), 850 mb wind 19 kt, 500 mb 41 kt,
0-6 km shear 40 kt, STP 90th 1.3; storm speed (median of days) 38 to 31 mph. Still off: CAPE median
3,093 J/kg (real 1,000-2,000) and the cap too weak (inhibition median 3; real 25-75). The slower
westerlies carry less of the high ground's hot, dry air over the map. Next: the cap and CAPE,
then quiet and tornado-free days.

The cap, CAPE, and the quiet and tornado-free days (2026-10-16, later):

- The lid: air entering at 700 mb across the western side (and the western half of the southern
  side) has come off the plateau, so it comes in as lid air whole (`eml` 1 there, as its
  temperature already did). It took its share from the edge cell's own terrain (about 1,050 m),
  so the lid never covered more than 0.6-0.7 of the moist air and the cap was gone by 21Z.
  `lidSourceThetaK` 316 to 315.5 (317 gave quiet days on half the days).
- Air masses: `airMassThetaK` 302.5 to 301, `surfaceWarmShare` 0.45 to 0.3 (the warm sector ran
  at 85-93 F with cloud bases near 1,500 m); Gulf air stays 16 g/kg; continental air 0.55 to 0.45
  of saturation (dewpoint drop across frontal zones, 64 km either side, median about 10 F, 75th
  12-36 F by seed; was about 8).
- A running updraught keeps CAPE - CIN of its energy (`inhibitionEfficiency` sqrt(1 - CIN/CAPE),
  was 1 - CIN/170): with a real cap the old form took 30% off every storm and quiet days rose to
  a third. Starting a storm and keeping its inflow are unchanged (liftingWork, stormFuel).
- Boundary-fed updraughts entrain less (`ENTRAINMENT_CONVERGENCE` 0.12 of the convergence under
  the storm): every storm in an air mass reached the same updraught before, and weak-flow days
  with dozens of storms made no severe report. Quiet days 14% to 9%.
- Fully undercut storms keep 5% of their potential (`undercutShare` 0.95, was 0.9): weak-shear
  storms on boundaries otherwise hung on at the 4 m/s that ends a storm.
- Lines lengthen on their own where they have fuel: each end moves out at 0.25 of the cold
  pool's speed (`LINE_GROWTH_SHARE`, full with a cold pool of 0.4 and 1,500 J/kg). Lines grew
  only by joining before; none reached the 220 km of an MCS. MCS days 0% to 33%.
- Reports: activity-report steps like the server (`--half-hour` for the old stepping; 14% and 15%
  quiet days on the same 80); setup-report takes key=value and counts MCS days.

Environment (32 days, 21Z and 00Z, moist air), before → now [real]: inhibition median 3 → 34
[25-75], 90th 207 [150-250]; 700 mb 9.7 → 10.4 C [8-10]; CAPE median 3,093 → about 2,500
[1,000-2,000]; cloud base 1,260 m; surface 83 F over 67 F; STP 90th 1.2, 99th 3.1 [0.5-1, 3-5];
supercell air with STP 1+ 31% [a quarter to a third].

80 days (seeds 1-8), against the targets:

| | Target | Before (morning) | Now |
|---|---|---|---|
| Days without a severe report | about 5% | 8% | 10% |
| Days without a tornado | about 10% | 16% | 27% (setup report 25%) |
| Tornadoes a day | mean about 5 | median 4 | median 2 (90th 14, most 32) |
| High / Moderate | about 5% / 10-15% | 4% / 11% | 6% / 10% |
| Enhanced / Slight | 40% / 30% | 70% together | 39% / 31% |
| Marginal or less | under 5% | 15% | 14% |
| MCS days | | 0% | 33% |
| Dryline share of tornadoes | | 3% | 10% |

Still open: the tornado-free days are mostly days where steering finds little support (31 of 80
days below 0.15) since the outer model's systems were made slower and weaker; CAPE a little high;
no closed low on the map at 21Z on any day (it was 10% after steps 9-10; already 0-1% this morning,
before these changes, and 0% with them undone, so it came with the slower, weaker systems).

Lows and tornado-free days, looked into (2026-10-16, nothing changed in the model):

- The outer model's low-level systems are half as strong as before they were slowed: pressure
  spread 3.2-3.7 hPa (was 7.2), deepest low about -9.5 hPa (was -19 to -20; real -15 to -25),
  95th-percentile ascent 0.06 K/h (0.15). Its systems' strength follows how far the shear between
  the layers exceeds the critical value set by beta and the deformation radius: 8 m/s against 2.6
  now (3.1 times), 9.5 against 2.0 before (4.9 times).
- Raising the shear and keeping the mean wind keeps the systems slow (about 1,280 km a day): 23.5
  over 13.5 m/s gives a spread of 6.7-7.3 hPa and lows of -17.5 to -19.3 on 4 seeds. But on 80
  days: quiet days 10% to 19%, 0-1 km helicity 90th 128 to 183 (99th 330), 0-6 km shear 90th 63
  kt, night tornadoes 33% to 42%; closed lows 3%. 23 over 14: quiet 18%, MCS 18%, no lows. The
  extra quiet days are mostly cap busts (2,500-3,000 J/kg, 30-40 kt, 0-8 storms) under the
  stronger ridges' sinking air.
- The map's lowest pressure at 21Z is on its western edge on nearly every day: the pressure rises
  6-13 hPa eastward across it, about a third each from the high ground's warmth (thermalHpa), the
  lee trough and the outer model (steering aims for the warm sector, east of the lows). Moving the
  lee trough's axis inside the map, narrowing it, or halving or removing the high ground's
  standing warmth in the pressure gave no more closed lows (1-2 of 40 maps): on the few days aimed
  near a low, the outer model's own low closes by only 0.5-0.6 hPa.
- Reports: activity-report prints the tornado mean, 30+ and 60+ tornado days and storm speed;
  setup-report takes qg.key=value.

Decided (the user, 2026-10-16): stronger systems, then repair. The outer model's winds are now 23.5
over 13.5 m/s (QuasiGeostrophicModel.js). Not yet repaired, 80 days: quiet days 19%, 0-1 km
helicity median 80, 90th 183, 99th 330; 0-6 km shear 90th 63 kt; night tornadoes 42%; closed lows
3%; tornado-free days 27%; MCS days 35%; storm speed 32 mph. Tried and not kept: the cap's response
to sinking air (capLiftRatio 1.6: quiet 14%), the Gulf's scouring threshold (9-12 m/s: little),
steering for stronger support (0.3-0.5 / 0.35-0.6: quiet 14-15%, but High 13-18%). Most of the
extra quiet days are dry spells after strong fronts (the moist air under 25% of the map), which the
steering cannot help: it moves where the map reads the outer model, not the map's own air. A time
jump past quiet days (the user's idea) is being designed; the rules are still to be settled.

Step 11 done (2026-10-16): forecasts with more of the uncertainty real ones have.

- Each forecast run also draws its own errors in the air over the map (ensemblePerturbation.js,
  MESOSCALE): the lid's temperature (1 K), the Gulf air's moisture on the map and offshore
  (0.8 g/kg) and its depth (150 m), and the lift that starts storms (a factor e^(0.3 x normal);
  InitiationEngine reads world.forecastLiftScale). Full when the afternoon (21Z) is 15 hours or
  more away, down to 0.35 of that just before it, so the runs come together through the day.
- Issued from the spread (the user's rule): a contour level is drawn only where enough runs had
  the hazard near (their own chance at least its lowest level): an eighth of them for the lowest
  level up to three quarters for the highest (OUTLOOK.agreement); an intensity group only where
  half (first group) to three quarters (highest) had its tier near (OUTLOOK.groupAgreement).
- outlook-verify.mjs takes OLD=1 for the outlooks as before. 5 mornings x seeds 1-4 (Day 1 20
  outlooks, Day 2 16, Day 3 12), before → after: category within one of what happened, Day 1 90%
  → 95%, Day 2 88% → 94%, Day 3 67% → 83%; Day 2 High issued 13% → 0% (verified 0%); the day's
  tornado count inside the runs' range on Day 1 85% → 95%; contours still verify at or above their
  level.
- The intensity groups are judged by the typical run (contourCigAreas with each run's own
  reports: the lower median of the groups of the runs that have the hazard in the area), not from
  all the runs' reports pooled, where one outbreak run set the group; and the runs' errors over the
  map go in pairs (opposite errors, same draw), so they average out to the atmosphere as it is.
  Before these two, Day 1 tornado groups were drawn on 35% of days against 20% verified (20 days).
- 40 days (5 mornings x seeds 1-8), old outlooks → now: Day 1 right 58% → 63% (within one 95% →
  93%), Day 3 within one 83% → 92%, the day's tornado count inside the runs' range Day 2 81% → 88%;
  groups drawn / verified: Day 1 tornado 0/13% → 10/13%, hail 28/30% → 25/30%; Day 2 tornado 9/9%
  (one CIG2) → 13/9%, hail 25/34% → 28/34%; Day 3 8/4% → 4/4%. Inside Day 1 hail CIG1 38% of the
  hail reached 2 in (8% outside). Still open (as before): Moderate issued on 8% of days, verified
  on 20%.

### In order

Order decided 2026-10-16: steps 1-10 done; steps 12 and 13 next, together; then step 11.

1. **Weaker downdraught gusts.** `GUST.downdraughtShare` 0.5 to about 0.35-0.4, or mixing
   losses in the downdraught. Tested at 0.4: High 45% to 38%, tornadoes unchanged.
2. **Low-level wind and helicity down to real values.** 0-1 km helicity median 158 (real
   40-70), 850 mb wind 31 kt (15-25), STP 90th 4.9 (0.5-1). Find where the excess comes from
   (lee-trough southerlies, night-time jet) first.
3. **Part A: moist QG and its own ascent.** Add moisture and latent heating to the outer
   model; diagnose its vertical motion from the change of thickness the flow does not account
   for. Check: lows deeper and smaller than now (7.6 hPa, 520 km half-depth radius); ascent
   north-east of the low and over the warm front as well as ahead of the trough.
4. **Part B: the slab boundary layer with the cap at its top.** Replace the rule-based heat,
   mixed depth and moisture with the mixed-layer equations: surface heat and moisture fluxes
   (less over moist ground, under cloud and on ground cooled by earlier storms), entrainment
   through the cap, the cap cooled by A's ascent and warmed by sinking. Moisture coming back
   from the Gulf shallow at first after a front. Check: 21Z inhibition in the warm sector
   median 25-75 J/kg; busts under sinking air; the dryline from the equations.
5. **Part C: the lid.** The elevated mixed layer as a layer with its own temperature and
   depth, made over the high ground and carried by the 700 mb wind, with warm advection at
   700 mb. Check: 700 mb 10-14 C on strong-cap days, weaker caps on others.
6. **Part D: storms as the convection scheme.** Start where lifting energy beats the cap,
   the lifting energy from the fields: convergence on lines and where they cross, confluence
   bands, thermals, cold pools, upslope, and, at night, the end of the low-level jet and warm,
   moist air lifted over cooler air (elevated storms). Storms feed back into A, B and C.
   Check: storm starts 2-4 times as common near lines as in the moist air at large, with a
   good share elsewhere on some days; night storms.
7. **Re-balance against the targets above.** Few settings, in this order: how often storms
   start, the tornado chance per supercell, how strong tornadoes get, the gusts. Check:
   activity report, 40 days.
8. **The zone along a front that matters to storms.** Near-ground spin is made in a narrow
   zone along a front, mostly on its cool side within about 10-30 km (Markowski et al. 1998,
   VORTEX-95): the winds back and converge into the front, and the temperature contrast makes
   horizontal spin along it. Storms riding along the front, or just on its cool side while still
   fed from the surface, take it in. The first part comes from the fields once fronts converge
   properly (step 7); the second is too narrow for the 16 km grid and is added the way outflow
   boundaries already are (`StormRotation.js` boundaryBoost, now from cold-pool contrast only),
   from the air-mass contrast beside the storm, only while the storm is surface-based. Already
   there and left alone: a storm that moves deep into the cold air feeds on air from above the
   stable layer and cannot make a tornado, and is surface-based again on the warm side
   (`stormFuel` checks every step).
9. **Lows and triple points on the map.** Let the region's reading point slide north-south
   as well as east-west, and let the lee trough close into a lee low where ascent aloft
   crosses it (helped by step 3's stronger, smaller lows).
10. **Setup variety.** Classify each day by what its storms and tornadoes started on
    (dryline, front, triple point, outflow, confluence, warm advection, upslope, under the
    upper low, line) and report the mix; let steering aim for different places in the wave
    instead of one support value.
11. **Forecasts with more of the uncertainty real ones have** (after 12-13). The runs already
    differ in timing (`ensemblePerturbation.js`: about 50 km by mid Day 1) and far upstream, but
    every run has the same cap, moisture return and boundaries, which is where real Day 1
    forecasts go wrong. Perturb those as well and issue from the spread. Rule (the user, 2026-10-16):
    a higher risk only where the runs agree on it; where confidence is low, the risk issued is
    lower too (broader, lower categories), with upgrades and downgrades through the day as the
    runs come together. This changes what players are told, not what happens.
12. **Upscale growth.** MCS and QLCS days, helped by step 6's night storms, which also bring
    line tornadoes and derechos.
13. **Final tuning, against the climate targets.** Moderate days (23% after step 7; aim 10-15%);
    days without severe weather (10%; aim under 5%), where weak-shear pulse storms should give
    the odd marginal hail or downburst report; 0-1 km helicity still above real values (median
    114; real 40-70); High, the tornado rate and the EF2+ share. One set of settings at a time,
    checked on the 40-day activity report.

Repairs for the stronger systems (2026-10-16, later; plan agreed with the user, no time jump):

- Moisture near the ground in the outer model (QuasiGeostrophicModel surfaceMoisture: passive,
  carried by the lower layer, mean falling 5 g/kg per 1000 km northward, relaxed over 2.5 days).
  The regional layer's Gulf air is gulfMixingRatio plus its anomaly there (at most +0.5 g/kg), in
  place of its own scouring and recovery; its air relaxes toward the air it would take in
  (inflowMoisture) both ways, as its temperature does (it was only ever dried, toward 45% of
  saturation: Gulf air in a warm sector at 16 g/kg was drawn toward about 9). Steering's support
  is cut where the outer model's air near the ground is drier than its mean (none at 4 g/kg
  below). A forecast run's moisture error is now gulfMoistureErrorGkg.
- Storms fed from the ground through inhibition draw less of their inflow from near the ground:
  their low-level spin is scaled by the inhibition term of the significant tornado parameter
  (StormRotation groundCinJkg 50-200). Night tornadoes 58% to 34%. Tornado rate 5 to 8.
- Tried and not kept: Gulf base 14 or 13.5 (quiet days 18-20%, inhibition median 90); steering for
  0.25-0.45 support (High 13%, 60+ tornado days 3%, tornado days unchanged).

80 days (seeds 1-8), against the targets:

| | Target | Stronger systems, unrepaired | Now |
|---|---|---|---|
| Quiet days | about 5% | 19% | 11% (longest run 2) |
| Days without a tornado | about 10% | 27% | 30% |
| Tornadoes a day | mean about 5 | 6.1 | 3.7 (median 2, most 18) |
| High / Moderate / Enhanced / Slight | 5 / 20 / 40 / 30% | 4 / 16 / 45 / 11% | 5 / 21 / 34 / 23% |
| Marginal or less | under 5% | 24% | 17% |
| Night tornadoes | | 42% | 33% |
| MCS days / closed low | | 35% / 3% | 49% / 3% |
| Storm speed | slow | 32 mph | 33 mph |

Environment (32 days): CAPE median 2,081 (90th 3,866), inhibition 56 (90th 246), cloud base 1,171 m,
dewpoint 65 F (90th 69), 0-1 km helicity 68 (90th 164), 850 mb 19 kt, 0-6 km shear 38 kt (90th 59),
500 mb 42 kt (90th 63), STP 90th 1.3. Fronts: dewpoint drop median 9-14 F (75th 20-26), cold side
37-47 F. Step 2 of the plan (friction growing with the wind) is not needed: the low-level tails
came down; the deep shear and 500 mb tails (a little high) are the outer model's upper winds.

Tornado-free days, what limits them (80 days): of 24, 14 had no supercell at all (weak shear),
9 had supercells only in strongly capped or elevated air, 1 weak helicity, none high cloud bases.
By steering kind: warm sector 35% without a tornado, near a low 25%, upper trough 14%.

Outlook calibration (2026-10-16, step 5 of the plan):

- The runs' averaged chance is mapped to the chance that verified before the agreement rule
  (js/forecast/outlookCalibration.js; combineOutlook keeps the raw one as rawChance). Fitted on 40
  mornings (seeds 1-8) with outlook-verify --calibration-data and fit-outlook-calibration.mjs
  (bins merged to at least 400 places, never falling); checked on 40 other mornings (seeds 9-16).
  NOCAL=1 turns it off in outlook-verify.
- Day 1 on seeds 9-16, how often the hazard came within 25 miles inside each level, uncalibrated →
  calibrated: tornado 15/30/45% 17/62/77% → 13/33/66%; wind 30/45/60% 42/82/93% → 28/43/61%; hail
  30/45/60% 41/71/91% → 36/43/77%. Category right 65% → 70% (within one 100% → 98%); Moderate
  issued on 18% of days (verified 10% on these seeds, about 20% on seeds 1-8). Day 2 near the
  diagonal too (tornado 30% → 31%, wind 45% → 45%), categories about the same.
- Day 3 is not calibrated: made from two runs, its fitted curve did not carry over to the other
  seeds (45% areas verified 27%; within one category 83% → 75%).

Step 6, boundaries and the first climate lever (2026-10-17):

- scripts/boundary-report.mjs: boundaries tracked point by point across the line between half-hour
  analyses (speed and direction), contrasts 64 km either side (afternoon and night), the dryline by
  local time, outflow lifetimes, fronts about closed lows. The activity report adds days with a
  supercell and with one fed from the ground.
- Measured (6 seeds x 8 days): cold fronts 7.6 m/s toward E-SE mostly (about a quarter toward
  N-W), wind turning about 50 degrees across them (real 45-90), temperature drop 7 F median
  (75th 12; real 10-15, still short: neither the cold air's depth in the trough pressure,
  slower relaxation, a stronger outer contrast nor less damping of the outer model's ground air
  moved it); warm fronts 5.7 m/s toward N-NE; stationary fronts 3 m/s.
- Front kinds keep continuity between analyses (BoundaryAnalysis typeHysteresisMs 1.5,
  continuityKm 48): points changing kind each half hour 8% to 4%.
- The dryline: air entering across the western side is dry, off the high ground (westInflowDry);
  it took the moisture of its place in the geography, mostly the Gulf's. The dryline now lies
  furthest west around noon (about 200 km in), moves east into the evening (about 275 km) and
  back west overnight (real: 100-200 km; it peaks a little late). Dewpoint across it 19 F. Slower
  erosion of the moist layer (moistureErosionHours, kept at 1) flattened the cycle; letting the
  map's air only dry toward its target, never moisten, blurred it and raised CAPE.
- Cold pools warm by the day's heating through their depth (a 4 K pool in full sun about five
  hours) instead of fading over 3 hours; outflow edges are followed from 2.5 K per 100 km next to
  storm-cooled air. Storm-cooled air is left at 9 am on 79% of days (11% of the map at the 90th);
  the tracked outflow lines still break up within 1-2 hours (the tracker follows fragments).
- A deep-shear floor in steering (support cut below 35-40 kt mid-level wind) did not help:
  supercell days 81% to 78-83%, tornado days unchanged, High 6% to 9-11%. Not kept.

Now (80 days): quiet 10%, a supercell on 81% of days but one fed from the ground on 60%; every
tornado-free day lacked a ground-fed supercell; tornado days 71%, mean 3.7; High 6%, Moderate 24%;
night tornadoes 40% (above the 35% guardrail).

Boundary realism, continued (2026-10-17):

- boundary-report.mjs also gives each line's orientation, cold fronts by orientation and motion,
  where the symbols face (the right air mass, the way the line moved, the compass), and
  interactions (two fronts side by side within 150 km, crossings, lines per analysis).
- The analysis types a front by how the line itself moves since the last analysis (the cold air's
  push only for a new line; continuity margin 2.5 m/s), keeps one front to a frontal zone (a crest
  must be the strongest within 7 cells across it), and draws a dryline only with its moist air to
  the east. Only the drawing changes; storms read the fields.
- 6 seeds x 8 days, before → after: symbols facing the way the line moves, cold 88% → 96%, warm
  87% → 94%; stationary fronts 3.1 → 1.9 m/s (90th 9.7 → 4.8); two fronts side by side 14% → 8%
  of analyses; dryline pieces lying E-W 31% → 6%, all drylines facing E/SE/NE; kind changing each
  half hour 4-8% → 5%. Cold fronts face E, SE or S 66%, NE 15% (NNW-SSE fronts pushing east-
  north-east), SW 9% (back-door), N, W or NW 10%. Warm fronts face N, NE or NW 81%. Open: fronts
  crossing in 25% of analyses (some are junctions at lows); the cold-front temperature drop (7 F).

Supercells, when and how (8 seeds x 8 days, 1,109 supercells): 30% ever fed from the ground.
By local hour of first rotation: 10-14h 115 (60% ground-fed), 14-18h 148 (81%), 18-22h 172 (52%),
22-2h 259 (12%), 2-6h 259 (2%), 6-10h 156 (12%). 61% form overnight on air from aloft (85% started
elevated, median start 5:30 am). Real supercells peak late afternoon and evening. Likely causes:
a storm fed from aloft is given the rotation of the near-ground shear and helicity it does not
take in, and the night's storms leave cold pools and worked-over air for the next afternoon.

Rotation from the layer a storm takes in (2026-10-17): a storm's mid-level rotation reads the
shear and helicity of its inflow: from the ground at 50 J/kg of inhibition or less, from above the
lowest km at 200 or when fed from aloft (0-3 km helicity less 0-1 km; 0-6 km shear less 0-1 km), in
between in proportion (StormRotation; environmentSampling adds srh03 and shear01). Supercells
1,109 → 742 (8 seeds x 8 days), those forming 10 pm - 10 am 674 → 362, ground-fed 30% → 43%; night
tornadoes 40% → 31%; quiet days 8%, Marginal or less 13%. Days with a ground-fed supercell
unchanged (58%), days with a tornado 68%.

Days without a ground-fed supercell (31 of 72): 12 dry (moist air under 15% of the map at 21Z), 9
in weak shear (under 30 kt in the moist air), 10 with moisture and shear but no supercell fed from
the ground; none capped everywhere, none short of afternoon storms. Days steered near a low had
one most often (11 of 16), warm-sector days 28 of 50, upper-trough days 2 of 6. Tried and not kept:
steering support cut harder in drier air (none at 2 g/kg below the mean: ground-fed supercell days
66%, but quiet days 11%, days without storms 5%, High 10%), and with it a kind mix of 45/45/10
(63%; quiet 13%, High 9%).

Game metrics and tornado strength (2026-10-17):

- activity-report.mjs adds, for the game: tornado-free days in a row, real hours between tornadoes,
  chaseable afternoons (a ground-fed supercell 1-10 pm local), the hazards that alone reach each
  day's category (tornado, wind, hail or a mix), intensity groups verified by hazard, tornado
  ratings and peak winds on the EF scale, and each tornado's look at its peak wind (cone,
  drillbit, wedge, stovepipe, rope, elephant trunk, uncondensed; multi-vortex, rain-wrapped).
- Before (160 days): ratings EF0 75%, EF1 20%, EF2 4%, EF3 1.5%, EF4 0%; High days wind only 78%,
  Moderate hail only 59%; tornado intensity group on 9% of days; looks drillbit 51%, multi-vortex 1%.
- Tornado winds wider (INTENSITY 80/90 mph, was 26/40) and the damage rating harsher (0.4 of the
  wind for a touchdown in open country, full over 20 km paths with luck from 0.35): ratings now
  follow the US record and peak winds run about a category above them, as mobile radar finds
  (Wurman et al. 2021, Kosiba and Wurman 2023). 160 days: ratings EF0 42%, EF1 34%, EF2 16%, EF3
  7%, EF4 1.5%; winds EF0 24%, EF1 27%, EF2 22%, EF3 18%, EF4 7%, EF5 2%. Looks: cone 41%, drillbit
  36%, wedge 15% (EF3 67%, EF4 88% wedges); multi-vortex 13%. High days 60% tornado-involved,
  Moderates 47%.
- Still open for the game: chaseable afternoons 47%; tornado-free runs of 3+ days (6 in 160 days,
  longest 7); High 9% and Moderate 27% (targets 5% and 20%); tornado days about 60-70%.
- Tried and not kept: drought-aware steering (after a day without a chaseable storm, aim near a
  low or for the warm sector at 0.35): on 160 days chaseable afternoons 47% → 43%, tornado days
  59% → 56%, quiet days 8% → 14%, runs of 3+ tornado-free days 6 → 9, 60+ tornado days 0 → 1%. A
  quiet day leaves the map's own air dry or in weak shear; aiming elsewhere the next day does not
  change that air, and it bunches the strong setups.
- Moisture: the Gulf's air at the map's edge was under 13 g/kg a third of the time (median 14.5) and
  the moist air covered under 15% of the map on 29% of afternoons: the outer model's moisture
  anomalies (gradient 5 g/kg per 1000 km) ran to +-6.5 g/kg. Gradient 3: moist air on about half
  the map on a typical afternoon, CAPE median 1,728, inhibition 38.
- Tornado rate 8, 6, 5 with it (160 days): High 15%, 11%, 10%; tornado days 64%, 60%, 59%. The
  ratings had moved up with the moister air (EF3 9-11%, EF4 4%); tornado winds 70/70 (from 80/90)
  bring them back near the record; High stays about 11%: it comes from many strong tornadoes close
  together on the best days, not from the strength of each.
- Now (160 days, rate 8): High 11%, Moderate 23%, Enhanced 26%, Slight 24%, Marginal or less 16%;
  quiet days 9%; a tornado on 64% of days (mean 4.4); chaseable afternoons 53%; tornado-free runs
  of 3+ days 6 (longest 4); ratings EF0 43%, EF1 31%, EF2 15%, EF3 8%, EF4 3%; storm speed 32 mph.
- Sounding fix (2026-10-17): a parcel's equilibrium level is where it last turns cold (sounding.js);
  under a cap the first turn, 2-3 km up, was kept with most of the CAPE above it, and the radar drew
  strong storms 2-3 km deep (one drew no echo). Debris echoes stronger than rain (DEBRIS_REFLECTIVITY
  1600 → 8000; 55-60 dBZ in violent tornadoes), as the fuller storms carried more rain about the
  tornado. The radar test asks for an echo only from storms with rain falling. All 51 test files pass.
- Climate now (160 days, unchanged by the sounding fix): a tornado on 64% of days (mean 4.4); chaseable
  afternoons 53%; tornado-free runs of 3+ days 6 (longest 4); quiet 9%; High 11% (tornado only 72%,
  wind only 22%), Moderate 23%, Enhanced 26%, Slight 24%, Marginal or less 16%; ratings EF0 43%, EF1
  31%, EF2 15%, EF3 8%, EF4 3%, EF5 0.1%; winds EF4+ 11%; looks cone 41%, drillbit 36%, wedge 16%,
  multi-vortex 14%. Environment: CAPE 1,728, inhibition 38, cloud base 1,052 m, dewpoint 65 F, 0-1 km
  helicity 73 (90th 178), 0-6 km shear 39 kt (90th 62), 500 mb 42 kt (90th 65), STP 90th 1.5.
- Still open: High 11% (target 5%); chaseable afternoons; Marginal or less 16%; the outlook
  calibration was fitted on the climate before these changes and needs refitting.
- Outlook calibration refitted (2026-10-17) for the climate of this day; seeds 9-16, Day 1 within 25
  miles, uncalibrated → calibrated: tornado 30%/45% 64%/83% → 42%/69%; wind 45%/60% 79%/93% → 49%/72%;
  hail 45%/60% 69%/89% → 43%/80%. Category right 73% → 65%; High issued on 10% of mornings against 5%
  verified (4 against 2 of 40). Day 2 and 3 about the same.
- High days (160 days, by verified category, afternoon medians): Enhanced 3 tornadoes, shear 44 kt,
  500 mb 46 kt; Moderate 9, 47, 50; High 14, 56, 58 (counts 1-33). High days are the strong-flow days.
  Tried: stronger drag in the outer model's low-level wind (dragReferenceMs 6): High 15%, the shear
  and 500 mb tails unchanged (99th 95 and 90 kt); chaseable afternoons 58%. Not kept.
- Calibration may lower a chance freely but raise it one contour level at most, and not into a
  level from 30% (tornado) or 45% (wind, hail) up: Moderate and High must come from the runs. Day 1
  on seeds 9-16: High issued 5% against 5% verified (10% uncapped), none too high (5%), category
  right 70% (65% uncapped, 73% uncalibrated); levels up to 15-30% stay calibrated, 30%+ tornado
  areas verify 64% (under-confident at the top, as forecasters hold back High).
- Days without a chaseable (ground-fed afternoon) supercell, current climate (72 days): 32; of
  them 11 in weak shear (under 30 kt), 11 moist and sheared with many storms but a weak cap
  (inhibition median 26 against 60 on the good days: storms form everywhere and grow into
  clusters and lines), 9 dry. A moderate cap keeps storms discrete.
