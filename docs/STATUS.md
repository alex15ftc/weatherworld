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
