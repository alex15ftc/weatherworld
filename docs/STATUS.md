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
