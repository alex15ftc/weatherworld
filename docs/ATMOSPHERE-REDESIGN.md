# Atmosphere redesign

This is the working log of the redesign: every stage, measurement and change of plan, in the
order they happened. For the present state read `STATUS.md`; for how the code is laid out,
`ARCHITECTURE.md`.

Status (2026-10-12): stages 1 to 4 done and the old engine retired. Climate tuning ended with
the region steered along the large-scale model (quiet days 3-6%, a tornado on about 90% of
days). Inert storm-layer code removed. Next: risk categories for this world's climate and
the outlooks (stage 6). Open in stage 4: storm size and shape.

## Why

The current atmosphere draws the surface low, the upper trough, the temperatures and the air
masses from separate formulas and pulls the fields back toward them every step. They are not
mutually consistent: `scripts/physics-inspection.mjs` shows the 500 mb heights and the
temperatures beneath them are negatively correlated (-0.25 to -0.44), winds barely turn
between 850 and 500 mb, and drawn fronts sit 25-75 miles from the gradients they mark. Two
attempts to make the drawn pieces consistent after the fact failed (see the roadmap notes).
In the real atmosphere those pieces are one object, a wave growing on the contrast between
warm and cold air. The redesign simulates that wave instead of drawing it.

## Goals

1. The atmosphere matches real behaviour from the basics up: balanced winds, thermal
   structure, fronts, the daily cycle, soundings, forcing, storms, hazards.
2. The weather is one continuous world: patterns come and go on their own, with no resets,
   no blocks of days and nothing chosen by a seed. (The original plan had a seed choose a
   regime every three days; dropped on 2026-10-11, see "Climate tuning".)
3. Severe weather is deliberately more common than in reality, through a few documented
   settings of the world's climate, not by bending the physics.
4. Storms end as objects with enough geometry to be built as 3D objects in Roblox.

## Activity target

- A day with no severe weather anywhere on the 500 x 500 mile map: about 1 in 20 or rarer.
- Most days reach at least a Slight-level event somewhere.
- A lull is a day with isolated severe storms, not an empty map.

- No long quiet spells: the longest run of quiet days is measured as its own number.

Checked by running a few hundred simulated days and counting real storm reports.

## Architecture

### Outer model: layered quasi-geostrophic flow

- Two layers (upper and lower troposphere) in a doubly periodic domain about 6,400 by 3,200
  miles. The game map is a window in the middle of it, because the waves that make weather
  systems are about 2,500 miles long and cannot live inside a 500-mile map.
- Each layer has a prescribed mean west wind (stronger aloft), standing for the
  north-south temperature contrast. That state is unstable, so waves, troughs and cyclones
  form, move and decay on their own and never run out. The weather is statistically the same
  everywhere in the domain.
- State: potential vorticity of the disturbances in each layer. Winds follow from the
  streamfunction, and the temperature of the layer between them from the difference of the
  two streamfunctions, so mass, temperature and wind are consistent by construction.
- Limits on the systems: relaxation of temperature disturbances, surface drag that increases
  with wind speed, and scale-selective damping.
- Supplies to the regional layer: winds at any level (linear in pressure between the two
  layers), layer-mean temperature, surface pressure and the 500 mb height tendency.

### Regional layer: the 500 x 500 mile map at 10-mile cells

Adds what the outer model lacks, each as a process:

- terrain rising to the west;
- a boundary layer with a daily heating cycle and night-time decoupling;
- Gulf moisture carried north by the low-level wind;
- hot, dry, deeply mixed air from the high terrain overrunning the moist layer (the cap) and
  meeting it at the surface (the dryline);
- the night-time low-level jet;
- lee troughing east of the high terrain;
- fronts that sharpen where the wind squeezes the temperature contrast, with labels drawn
  from the fields.

### Storms and hazards

Kept as objects with continuous properties (rotation, cold pool, line organisation), rebuilt
against pinned reference numbers: motion relative to the mean wind, lifetimes, initiation
timing, hail and wind distributions, tornado duration, path, width and rating mix.

### Climate tuning (stage 5)

Decided 2026-10-11: no seeds and no regimes. The atmosphere makes its own patterns (a
trough about every two days, each one different), so a seed choosing a regime for a block
of days would be steering it toward a picked pattern, which is what the redesign removed.
One number still starts the world (the outer model's first disturbances); it never changes
afterwards and is what makes a world reproducible.

How active the world is overall is set by a few fixed settings, each already in the code:

| Setting | Where | What it does |
|---|---|---|
| Flow aloft | outer model's layer winds (both raised together) | fewer weak-flow days, more shear |
| System size and tempo | outer model's deformation radius | how often troughs arrive, how strong low-level winds are |
| Gulf moisture | regional layer's inflow moisture and moist-layer depth | instability, cloud bases, where the dryline sits |
| Cap | warmth of the plateau air aloft | how much lift storms need, how many form |
| Readiness to start storms | lift ranges in the storm coupling and initiation | storm counts |

Order (agreed 2026-10-11), because the hazard formulas read the environment and the activity
count reads the hazards:

1. **Environment.** The atmosphere's own statistics against real soundings, no storms
   involved: spread of instability, mid-level lapse rates, the cap, shear and low-level
   helicity, and a clean front analysis.
2. **Hazard refit** (the open part of stage 4). What a storm produces given its environment,
   against the pinned reference numbers. This does not depend on how often each environment
   occurs, so it survives step 3.
3. **Activity.** How often good environments occur, until the targets below hold. Done with
   the climate settings only (see "Storm layer: painting removed" and "Climate tuning, step
   3"); at 21% quiet days after the large-scale model was retuned on 2026-10-12.

Method for step 3: run a long stretch (about 60 simulated days on a few starting numbers), record
storm reports with `js/verification/truth.js` (the same definitions the outlooks will be
verified with), and adjust the settings until the targets hold:

- quiet days about 1 in 20;
- the longest run of quiet days short (a persistent ridge can give several in a row, and
  tuning the average does not remove that by itself);
- a sensible spread of day strengths, most days Slight-level or more, a few big days.

What is given up: control over when things happen (an outbreak scheduled for an event, a
guaranteed end to a quiet spell). If that is wanted later it can be an occasional nudge to
the large-scale flow; it is not the foundation.

The situations that should each be producing storms, as a checklist for the tuning runs:

| Situation | What produces storms |
|---|---|
| System approaching | Dryline and warm-sector supercells ahead of the low |
| System passing | Cold-front lines |
| Ridge between systems | Isolated late-afternoon dryline storms; high-terrain storms drifting east |
| Northwest flow behind a system | Night-time clusters running southeast |
| Any night | Low-level jet feeding elevated storms north of a boundary |

### Climate tuning, step 1 result: the environment

`node scripts/environment-report.mjs [days] [--seeds 1,2,3]` (about 4 minutes for 20 days on
three seeds) samples the soundings of the moist air at 21Z and 00Z with no storms running
and sets them beside real warm-season Plains values.

The reference ranges are approximate: they are the values usually quoted from the proximity
sounding studies (Rasmussen and Blanchard 1998; Thompson et al. 2003; Craven and Brooks
2004) and station climatologies, written from memory. The papers' tables could not be read
here to check them, so treat the right-hand column as a guide, not a pinned reference.

Sixty days (three seeds), moist air with CAPE of 250 or more, after the changes below:

| Quantity | 10th / median / 90th / 99th | Real, approximate |
|---|---|---|
| CAPE, mixed layer (J/kg) | 1,010 / 2,260 / 3,850 / 5,190 | median 1,000-2,000; 90th 3,000-3,500 |
| Inhibition (J/kg) | 2 / 50 / 235 / 460 | median 25-75; 90th 150-250 |
| Cloud base above ground (m) | 1,000 / 1,420 / 1,930 / 2,330 | median 1,000-1,500 |
| Lapse rate 700-500 mb (C/km) | 5.4 / 7.2 / 7.7 / 8.0 | median 7.0-7.5; 90th 8.0-8.5 |
| 700 mb / 500 mb temperature (C), median | 9.7 / -11.2 | 8-10 / -10 to -12 |
| Surface temperature / dewpoint (F), median (90th) | 81 (87) / 64 (67) | 80-86 (90-94) / 62-66 (70-72) |
| Shear, surface to 6 km (kt) | 20 / 43 / 74 / 91 | median 30-35; 90th 50-55 |
| Helicity, lowest 1 km | 11 / 64 / 207 / 391 | median 40-70; 90th 150-200 |
| 850 mb / 500 mb wind (kt), median (90th) | 17 (35) / 38 (69) | 15-25 (35-40) / 30-35 (50-60) |
| Significant tornado parameter | 0 / 0.1 / 1.7 / 5.0 | 90th 0.5-1; 99th 3-5 |
| Highest CAPE on the map per day, median (90th) | 3,570 (5,500) | 2,500-3,500 (4,500) |
| Highest tornado parameter per day, median (90th) | 1.2 (4.8) | 0.5-1.5 (4-6) |
| Days with a supercell environment over 5% of the map | 88% | - |

What the first run showed and what was changed:

- **Moisture was the same every day** (dewpoint 62 to 68 F across the whole sample), so
  instability was always near its top. The air offshore now loses its moisture when a front
  pushes northerly flow across the map's southern edge, and regains it over about four days
  (`gulfSupply`). Return flow after a front is modest at first, as it really is. Dewpoints
  now spread from 60 to 69 F and median CAPE fell from 2,810 to 2,260.
- **Mid-level lapse rates were too low** (median 6.8, nothing above 7.6 C/km). The plateau
  air is well mixed up to near 500 mb, so 500 mb is now colder where that air lies overhead
  (`emlLapseShare`). Median 7.2, 90th 7.7.
- **700 mb was a degree too warm**; lowered. 250 mb raised 2 C, which trims the instability
  that came from the top of the troposphere.
- **The front analysis drew too many lines** (two on a typical afternoon, up to six). A front
  now needs 4 K per 100 km and 200 km of length; that halves the count and the lines kept
  are stronger (6.3 K per 100 km).

Left as they are, on purpose or for later:

- **Instability and shear run above the real ranges** (CAPE about a third higher, shear's
  upper end well above). That is the direction wanted for the game, but the upper tail of
  the winds aloft (500 mb at 69 kt at the 90th percentile, 91 kt at the 99th) is more than
  intended and belongs to step 3.
- **The supercell composite is high** (median 5 against 0-2) because it multiplies CAPE,
  helicity and shear, all on the high side.
- **Dewpoints top out at 69-70 F**; real ones reach 72 F and more.
- Fronts are still weak at the ground (unchanged, see stage 3).

### Climate tuning, step 2 result: the hazards

What a storm produces given its environment, refitted on the new atmosphere
(`node scripts/storm-prototype.mjs [days] [--seed n]`). Three seeds, twelve simulated days
each, about 1,500 storms and 76 tornadoes:

| Check | Before | After | Reference |
|---|---|---|---|
| Storms reaching 1 in hail | 0-10% | 11-35% | - |
| Storms reaching 2 in hail | 0% | 0-5% | - |
| Largest hail | 1.1-2.3 in | 2.1-2.8 in | - |
| Storms reaching 58 mph gusts | 3-8% | 5-14% | - |
| Strongest gust | 80-101 mph | 72-84 mph | - |
| Rotating storms, turn from the 0-6 km mean wind | 0-2 degrees right | 16-19 degrees right | 20-30 right |
| Rotating storms, speed against that wind | 1.0 | 0.9 | 0.75-1.1 |
| Storm forward speed, median | 33-43 mph | 27-32 mph | 25-45 |
| Lines, speed against the mean wind | 1.1-1.5 | 1.2-1.3 | 1.0-1.3 |
| Tornado time on ground, median / 90th | 15-25 / 15-55 min | 2-7 / 23-24 min | about 5 / 20 |
| Tornado path, median / 90th | 8-13 / 9-41 miles | 0.6-1.7 / 9-11 miles | about 1-2 / 10 |
| Tornado width, median | 97-131 yards | 56-69 yards | about 50-75 |
| Tornado ratings | EF0 33-83%, EF1 17-62% | EF0 68%, EF1 24%, EF2 7%, EF4 2% (of 76) | EF0 64, EF1 26, EF2 7.6, EF3 2.2% |
| Cold pools in the evening, deepest (median; most) | 5-6 F; 9-10 F | 8-9 F; 14-17 F | 10-20 F under strong storms |

What was changed:

- **Hail** is now a power of the updraught speed the storm realises (parcel theory less
  entrainment, loading and inhibition, scaled by how mature the storm is), raised by rotation
  and by steep mid-level lapse rates. The old formula added up five weighted terms and could
  not exceed about 2.3 in.
- **Gusts** come from the energy available to the downdraught (DCAPE) and a share of the
  storm's own motion, plus a line's rear inflow. The old formula was fitted to cold pools
  that are now twice as strong and would have made most mature storms severe.
- **Cold pools** deepen with the energy available to downdraughts (dry air for the rain to
  evaporate into), not with cloud-base height. Storms here form in the moistest air, where
  cloud bases are low, so the old measure gave them almost no cold pool.
- **Storm motion had a feedback fault.** A tracking estimate that follows each storm's
  velocity with a lag was also being written back as the storm's velocity. The two filters
  in series took hours to respond, so rotating storms never turned right of the mean wind;
  and the estimate's cold-pool push was fed back every step, which ran lines tens of mph
  too fast. The estimate no longer steers the storm.
- **The mean wind for storm motion** is now the true 0-6 km mean (surface, 850 mb and 500 mb
  weighted by depth). It left out the surface, so every storm moved too fast.
- **Tornado lifetime** is drawn so that half last under five minutes and one in ten over
  twenty. A tornado shorter than a five-minute storm step is recorded with its own time and
  path, and stays on the ground through the step it formed in so that nothing misses it.
- **Tornado strength** follows the observed rating distribution (a tail exponent of 1 and a
  scale near 20 mph), with the scale rising with the ingredients. Width follows strength.

Tests: `tests/storm-character.mjs` (a storm's type name never drives its physics) and
`tests/radar-simulator.mjs` were rewritten on the new world; both pass.

Open after this step:

- **Severe days are 6-9 in 12 and tornado days 2-4 in 12.** How often is step 3's subject.
- **Gusts of 75 mph are rare** (0-2% of storms) and the strongest are in the low 80s.
- **Storms live long**: median 2.5-3.5 hours against 0.5-1 for ordinary cells.
- **No left-moving storms appear** (no storm splits were seen in these runs).
- **Storm counts swing widely** between days (a median of 20-50 with single days over 160).

### Storm layer: painting removed (2026-10-11)

An audit of the atmosphere, world and storm code found the atmosphere essentially all
field-driven, and about a third of the storm layer made of templates, scripts or draws. The
rule adopted: **a storm's behaviour comes only from the fields; how common severe weather is
comes only from the world's climate** (moisture, flow, cap). No storm-level knob is used to
reach an activity target.

Removed:

- **The footprint drawn around analysed fronts and drylines** (added when storms were first
  connected). Storms now feel a line only through the convergence of the surface winds and
  the air they draw in. The analysed lines are for the maps and the radar.
- **Outflow rings.** Expanding circles with fixed growth rates that lifted new storms and
  added convergence, on top of the cold-pool field that already does both.
- **The storm's own footprints of "processed air" and ring convergence**, and its direct
  cooling of the surface. The regional layer's cold pools carry that.
- **Random surges** in gusts and hail (added one step earlier to cut quiet days), **the gust
  bonus for being a line, the strength bonus for a merger, and the hail veto.**
- **Radar templates feeding hazards.** The drawn interior of a storm (hook, flanks, bow) is
  still used for the radar picture; its maxima no longer raise rotation, hail, gusts or
  tornado odds.
- **Lifetime caps and the sine wave** that modulated a long-lived storm's rotation. A storm
  lasts while its inflow has fuel.
- **A floor and a constant** in the rotation formula; the warm-sector flag is now a 0-1
  measure.
- **Clock-driven heating** in two places, one of which read UTC as local time and so peaked
  at 6 am. Both now use the heating the regional layer computes for that cell.
- **Dead inputs**: flags the new atmosphere never sets, a convergence term that counted the
  same wind convergence twice.
- **Tornado gates, vetoes and the cooldown.** See below.

Rewritten:

- **Tornadoes** (`js/storms/TornadoEngine.js`, 260 lines down to 183). A tornado cannot
  emerge from fields on a 10-mile grid, so this stays a statistical model, but a continuous
  one: a single rate that rises with the storm's rotation and the ingredients of its inflow
  and falls where it is part of a line or undercut by its outflow. There is no requirement to
  be a "supercell", so a line with some rotation can produce one. Lifetime and peak wind are
  still drawn once per tornado, because nothing at this scale decides them.
- **Tornado wind and rating are separate.** The rating is what a damage survey would find,
  which usually falls short of the wind, more so for a short track over open country.
- **Downdraught energy (DCAPE)** is now a parcel calculation in `js/sounding.js`: the driest,
  coolest air aloft cooled to its wet-bulb temperature and brought down the moist adiabat.
  It was a formula of surface dryness and lapse rate. Gusts and cold pools both rest on it.

Still painted or scripted, left for later:

- The storm's intensity is a weighted score of readiness, updraught and lift.
- Lifecycle phases still switch on thresholds; they now only label the storm and scale the
  hazard probabilities shown on the pages.
- The lee trough's position, and how much large-scale ascent cools the cap (atmosphere).
- An unused shadow copy of each storm (`SharedStormEvolutionKernel`, track intelligence).

**Activity with the painting out** (90 days, three seeds; nothing tuned to it):

| Check | With the painted parts | Without | Target |
|---|---|---|---|
| Quiet days | 32% | 43% | about 5% |
| Longest run of quiet days | 6 | 10 | 1-2 |
| Days with 1 in hail | 62% | 52% | - |
| Days with 58 mph wind | 56% | 41% | - |
| Days with 75 mph wind | 14% | 0% | - |
| Days with a tornado | 41% | 42% | - |
| Days with a tornado rated EF2+ / with EF2+ winds | 17% / 9% | 18% / 21% | - |
| Storms per day, median | 54 | 41 | - |

Tornadoes held up because the gates went with the props. Wind lost its upper end: the
strongest gust of a day is 55 mph at the median and 69 at the 90th percentile. The quiet days
are days with weaker instability and flow (CAPE near 2,000, shear near 33 kt) and about ten
weak storms. Closing that gap is step 3 below, and it is to be done with the climate.

### Climate tuning, step 3: activity through the large-scale model (2026-10-12)

With the storm layer left alone, the large-scale model was tuned so that tornado-favourable
air is on the map on nearly every day.

Screening the outer model alone (`node scripts/qg-prototype.mjs 200 key=value`, which now
also reports the weakest tenth of days and the longest spell of weak flow):

- **Weaker surface drag does not help.** It left the weak days as they were and only made
  the pressure swings larger.
- **A stronger mean flow does.** Raising both layers' mean winds by the same amount leaves
  the weather systems unchanged and lifts every day's wind. Days with under 25 kt at mid
  levels fell from 16% to 6-9%, and the longest such spell from 5 days to 1-3.
- The pressure-swing figure of that report varies by half from run to run on the same
  dynamics, so it is a poor guide; earlier conclusions drawn from it are less sure than
  stated.

Adopted: upper 26.5 and lower 17 m/s (was 22.5 and 13; the difference between them, which
sets the systems, is unchanged). Nothing else was changed.

| Check (60 days of environment, 90 days of activity) | Before | After | Aim |
|---|---|---|---|
| Days with a tornado parameter of 1+ somewhere | 55% | 93% | 90%+ |
| Highest tornado parameter of the day, median | 1.2 | 3.0 | about 3 |
| Afternoon low-level helicity, median (90th) | 64 (207) | 77 (224) | 100+ |
| Deep shear, median | 43 kt | 47 kt | - |
| Quiet days (no severe report anywhere) | 43% | 21% | about 5% |
| Longest run of quiet days | 10 | 3 | 1-2 |
| Days with a tornado | 42% | 66% | nearly every day |
| Days with a tornado rated EF2+ / with EF2+ winds | 18% / 21% | 36% / 37% | - |
| Tornadoes per day, median (90th) | 0 (7) | 2 (15) | - |
| Days with 1 in hail / 58 mph wind | 52% / 41% | 78% / 54% | - |
| Days with 75 mph wind | 0% | 2% | - |
| Strongest category of the day | - | High 10, Moderate 22, Enhanced 27, Slight 18, less 23% | High 5, Moderate 20, Enhanced 40, Slight 30, less 5 |

What it cost and what is left:

- **Storms now form at all hours more than before.** The late-afternoon peak is still
  there (20-00Z), but only a little over half of storms form between 18Z and 03Z.
- **Systems cross faster still** (a trough about every 1.3 days).
- **The top end of the winds aloft is high** (500 mb at 67 kt at the 90th percentile).
- **Quiet days are 21%, not 5%.** They are days of weak flow and modest instability (CAPE
  near 1,900, shear near 28 kt, 500 mb near 28 kt) with about ten weak storms. A larger rise
  of the mean flow gave no further gain in the environment report, so the rest is not in
  this setting.
- **Afternoon helicity is 77 against an aim of 100.** It peaks near midnight with the
  night-time jet, hours after storms peak. That timing is in the regional layer.
- **Severe gusts stop near 75 mph.**
- Three tests that judged the model on a single day or two of weather were rewritten to
  check the mechanism instead (the night-time jet against its balanced wind, the terrain
  contrasts over five afternoons, a cold pool followed downwind).

### Climate tuning, step 4: the daytime low-level wind (2026-10-12)

Afternoon helicity was low because of how the daytime boundary layer was written, not
because of when the night-time jet starts. By day the 850 mb wind was simply held 35% below
its balanced value everywhere, and the surface wind was taken from it, so the two were
nearly the same wind and there was little shear between them.

Now a mixed boundary layer has one wind through its depth: the mean balanced wind of the
layer, less a share lost to friction (`mixedLayerFriction` 0.3). The wind at the ground is
the slower, backed foot of it (`surfaceWindShare` 0.6, `surfaceBackingDeg` 22). 850 mb
takes the layer's wind only where the layer has grown up past it, and keeps its balanced
wind where it is still above the layer. At sunset the departure from balance swings freely
as before.

| Check (60 days of environment, 90 days of activity) | Step 3 | Step 4 | Real |
|---|---|---|---|
| Afternoon low-level helicity, median (90th) | 77 (224) | 139 (356) | 40-70 (150-200) |
| Surface to 1 km shear, median (90th) | 13 (26) kt | 16 (30) kt | 8-12 (20-25) |
| 850 mb wind, median (90th) | 18 (33) kt | 24 (44) kt | 15-25 (35-40) |
| Highest tornado parameter of the day, median | 3.0 | 4.8 | 0.5-1.5 |
| Days with a tornado parameter of 4+ somewhere | 30% | 57% | - |
| Days with a tornado parameter of 1+ somewhere | 93% | 93% | - |
| Days with a tornado | 66% | 64% | - |
| Days with a tornado rated EF2+ / with EF2+ winds | 36% / 37% | 38% / 41% | - |
| Tornadoes per day, 90th percentile (most) | 15 (39) | 19 (46) | - |
| Quiet days | 21% | 23% | - |
| Days with 75 mph wind | 2% | 4% | - |

**What this shows.** The environment is now more favourable than the real one on the days
that have storms, and those days produce more and stronger tornadoes. The number of tornado
days did not move. Favourable air is on the map on 93% of days and a tornado on about 65%,
so the gap is days when no mature rotating storm forms in that air. Quiet days still have
weak flow aloft (about 22 kt at 500 mb) and about fifteen weak storms. The next lever is
therefore where and whether storms start, not the environment they grow in.

### What the no-tornado days lack; outflow boundaries; fronts (2026-10-12)

Measured with `node scripts/tornado-day-report.mjs 30` (90 days), the same with
`--no-outflow`, and `node scripts/boundary-prototype.mjs 30` on two seeds. Nothing was
changed.

**No-tornado days (36% of days).** The step 4 reading ("favourable air on 93% of days, so
the gap is storms failing to form in it") was wrong. On no-tornado days the favourable air
is a scrap: 1.7% of the map over the day against 15.3% on tornado days, and a quarter of
those days have none. Two storms form in it and spend 3 storm-hours there (27 storms and 75
storm-hours on tornado days). The storms that do get there are nearly as good (rotating
0.61 against 0.74, mature 0.54 against 0.63). Ascent aloft over the favourable air is a
third as strong (0.12 against 0.36). So the limit is how much favourable air there is and
for how long, not the storms and not the triggering.

**Outflow boundaries.** With the storms' cold pools kept out of the atmosphere (same
large-scale weather): storms per day 45 -> 35, convergence lift in the favourable air 0.22
-> 0.11, tornado days 64% -> 67%, tornadoes 486 -> 500, hail and wind days unchanged. With
them, 28% of storms form within 40 miles of an outflow boundary (3.3 times chance) and 27%
on the edge of a pool. They are the model's main trigger of new storms after the first,
but add nothing to tornadoes or severe days: the extra storms form in or beside rain-cooled
air. A storm crossing an old outflow boundary gets no boost to its low-level shear here.

**Fronts.** Weak, and they do not focus storms.

| | Model | Real |
|---|---|---|
| Analyses with a front | 57-72% | - |
| Temperature change across a cold front (60 miles) | 4-5 F | 10-25 |
| Cold front speed | 11 mph | 15-35 |
| Wind shift across a cold front | 56-59 degrees | 45-120 |
| Warm fronts per analysis | 0.1 | - |
| Storms forming within 40 miles of a front | 9% (1.1 times chance) | - |
| Tornadoes within 40 miles of a front | 4% (0.5 times chance) | - |
| Wind shift across the dryline | 15-17 degrees | 45-120 |
| Storms forming within 40 miles of the dryline | 13% (1.1 times chance) | - |

**Why storms do not favour the lines** (45 days, the initiation rate's own terms by zone):

| Within 40 miles of | Storms per 1,000 cell-hours | Dewpoint | CAPE (afternoon) | Inhibition (afternoon) | Convergence lift | All lift (J/kg) |
|---|---|---|---|---|---|---|
| a front, warm side | 1.41 | 48 F | 1,400 | 122 | 0.43 | 102 |
| a front, cold side | 0.68 | 42 F | 700 | 226 | 0.36 | 91 |
| the dryline, moist side | 2.07 | 58 F | 2,030 | 109 | 0.27 | 74 |
| the dryline, dry side | 0.21 | 36 F | 100 | 252 | 0.39 | 95 |
| an outflow boundary | 3.52 | 65 F | 2,990 | 49 | 0.33 | 88 |
| no line | 0.87 | 51 F | 1,390 | 143 | 0.20 | 60 |

- The "1.1 times chance" above mixed the two sides of each line. On the unstable side
  storms do favour the lines: 1.6 times the open-map rate on the warm side of fronts, 2.4
  times on the moist side of the dryline.
- **Fronts lie in dry air.** The warm side of a front has a dewpoint of 48 F, drier than
  the map as a whole. The Gulf moisture and the fronts rarely meet.
- **Frontal lift is modest.** Convergence at a front is 0.43 of what the initiation code
  counts as full strength, worth about 70 J/kg against an afternoon cap of about 120.
- Nearby storms and storm-worked air hold back little (about 10%).

**Where the fronts are, and why they are weak** (60 days, two seeds, no storms; maps in
`docs/front-maps-2026-10-12`). "Fronts lie in dry air" was half right:

- About half of the front length (49-59%) has moist air on its warm side (dewpoint 64-65
  F). The other half is west of the dryline, over the high ground, in dry air (Pacific
  fronts). So moisture does reach the fronts that matter.
- The fronts in the moist air are weak: 3-4 F and about 4 K of air-mass contrast across 60
  miles, the dewpoint barely lower behind them (54-59 F against 64-65), 10-12 kt of wind
  into the line.
- Screened in the regional layer: letting it keep its contrasts longer
  (`airMassRelaxationDays` 4 and 8) left the temperature change at 4.7-5.0 F; a stronger
  cold push (`coldPushFactor` 0.7) raised the speed from 11 to 14 mph and the wind shift
  from 56 to 75 degrees, did not raise the contrast, and halved the warm and stationary
  fronts. Neither was adopted.
- The gradient at a front is sharp (7-12 K per 100 km) but narrow: the air masses on either
  side differ by only about 4 K. The large-scale model's low-level temperature swings 7.5 K
  in all, set by the wind difference between its layers, which cannot be raised without
  the systems overshooting. The regional layer's share of that swing (`temperatureShare`)
  is the setting that would widen it.

**Two tests, neither adopted (2026-10-12, 90 days of activity each).**

| | Now | Wider temperature share (lowCold 2.8, lowWarm 1.2) | Large-scale clock 1.5 times faster (`tempo`) |
|---|---|---|---|
| Temperature change across a cold front | 4.2 F | 5.7 F | not measured |
| Analyses with a front | 72% | 91% | - |
| Warm fronts per analysis | 0.13 | 0.22 | - |
| Analyses with a dryline at 21Z | 90% | 76% | - |
| Quiet days | 21-23% | 21% | 12% |
| Longest run of quiet days | 2-3 | 5 | 2 |
| Days with a tornado | 64-70% | 63% | 68% |
| Days with a tornado rated EF2+ | 31-38% | 30% | 37% |
| Days with 1 in hail / 58 mph wind | 74-76% / 53-56% | 74% / 53% | 84% / 58% |

The wider share gives more and somewhat stronger fronts, fewer drylines, and no change in
activity. The faster clock halves the quiet days.

### Climate tuning, step 5: a higher floor and a lower ceiling (2026-10-12)

Goal set by the user: Slight risk or better on 95% of days, higher risks rarer as they go,
some tornado risk every day, mechanics natural. That is a matter of making days more alike,
not more active. Three settings were changed; no storm code.

| Setting | Was | Now | What it does |
|---|---|---|---|
| `thermalRelaxationDays` (large-scale model) | 5 | 2 | damps the waves: mid-level wind 27-75 kt (weakest tenth of days to 90th percentile) becomes 32-58 kt |
| `tempo` (regional layer) | 1 | 2 | the large-scale clock runs twice as fast as the day, so each day holds a trough and a ridge |
| `surfaceWindShare` (regional layer) | 0.6 | 0.75 | less shear between the ground and 850 mb, which was double the real value |

| 90 days, three seeds | Before | relax 3 | relax 3, tempo 2 | relax 2, tempo 2 | + surface share 0.75 (adopted) |
|---|---|---|---|---|---|
| Quiet days | 21-23% | 7% | 3% | 3% | 0% |
| Below Slight | 25% | 10% | 7% | 4% | 3% |
| Slight | 21% | 17% | 17% | 13% | 13% |
| Enhanced | 20% | 38% | 43% | 43% | 40% |
| Moderate | 14-24% | 28% | 20% | 31% | 41% |
| High | 9-16% | 8% | 12% | 8% | 2% |
| Days with a tornado | 64-70% | 82% | 82% | 88% | 91% |
| Days with a tornado rated EF2+ | 31-38% | 39% | 37% | 37% | 31% |
| Days with 1 in hail / 58 mph wind | 75% / 55% | 92% / 64% | 97% / 69% | 97% / 68% | 100% / 67% |
| Tornadoes per day, median (90th, most) | 2 (19, 46) | 4 (14, 41) | 3 (15, 32) | 3 (9, 26) | 4 (10, 17) |

Also tried: `tempo` 2.5 alone (quiet 6%, High 9%); `mixedLayerFriction` 0.45 in place of
the surface share (quiet 3%, Moderate 40%, High 2%).

What is left:

- **Moderate days are 41% against an aim of 20%, Slight 13% against 30%.** The air is now
  very unstable on every day (CAPE median 3,700, 10th percentile 2,700) because the damped
  waves bring few cold intrusions. Gulf moisture is the lever and it is steep:
  `gulfMixingRatio` 15 gives below-Slight 16%, Slight 31%, Enhanced 43%, Moderate 9%, a
  tornado on 69% of days; 14 gives 23% quiet days. Something near 15.5 would trade floor
  for fewer Moderate days.
- **Weaker waves mean weaker fronts** (the low-level temperature swing fell to about 4 K).
- **Systems cross twice as fast** as before relative to the day.
- **75 mph gusts are on 0% of days.**
- Storms per day fell from about 50 to 49 at the median but the busiest days are far
  smaller (most 111 against 200).

### Change of plan: the region is chosen from the large-scale model (2026-10-12)

Step 5 kept one fixed patch active every day by calming the atmosphere, which cost the
fronts and the strongest winds (no gust reached 75 mph: downdraught energy never passed
1,050 J/kg and storm strength never passed 0.8). The user's alternative, adopted as the plan:

- The large-scale model is the whole country. Each day the 500 x 500 mile region is placed
  where that model gives the severe weather wanted; the terrain travels with the region
  (the day's atmosphere is laid over the same Plains terrain).
- Step 5's damping and faster clock are undone (`thermalRelaxationDays` 5, `tempo` 1).
  `surfaceWindShare` 0.75 is kept for now (it corrects low-level shear that was double the
  real value) and is to be re-checked once the region moves.

Check on the large-scale model alone (200 days, two seeds; "good" = 35 kt or more aloft and
8 kt or more of southerly low-level flow over the region; "strong" = 50 and 15):

| | Fixed region | Best place along the same latitude |
|---|---|---|
| Good days | 21-24% | 97-99% |
| Strong days | 6-8% | 57-65% |
| Wind aloft, 10th / median / 90th | - | 41-43 / 56-57 / 71 kt |
| Southerly low-level flow, 10th / median / 90th | - | 12-13 / 20-21 / 27 kt |

About 2,000 km of the 10,240 km belt is good on a typical day, so there is room to choose
a place by the kind of day wanted and not only the strongest. The best place moves about
2,000 km east a day, the speed of the systems: it is mostly the same trough followed.
Sliding east-west needs no adjustment (the model is the same along a latitude); moving
north-south would also change the mean temperature.

### Region steering built (2026-10-12)

`js/world/RegionSteering.js`; on by default in `AtmosphereWorld` (`steering: false` keeps
the region fixed; `node scripts/activity-report.mjs --fixed`, `steer.key=value`).

- The region never jumps. Its air, storms and cold pools stay on the map; only the place
  where it reads the large-scale model slides east or west (`RegionalAtmosphere.slideMs`),
  never faster than the systems travel (22 m/s). From the map a system lingers or crosses
  sooner; it never backs up.
- Once a day at 06Z a copy of the large-scale model is run ahead to 21Z and 02Z, and the
  slide speed for the next 24 hours is the one that brings the large-scale support over the
  region (wind aloft x southerly low-level flow, 0-1) closest to the support wanted that
  day, drawn evenly between `wantedLow` and `wantedHigh`.
- Height falls (the ascent ahead of troughs) are measured at a fixed place, so sliding with
  a trough does not switch its ascent off.
- Saved and restored with the world (state version 3). Test: `tests/region-steering.mjs`.

| 90-120 days, three seeds | Fixed region | Steered, wanted 0.3-0.75 | wanted 0.1-0.45 (default) | wanted 0.2-0.55 | wanted 0-0.9 |
|---|---|---|---|---|---|
| Quiet days | 21% | 3% | 6% | 3% | 5% |
| Below Slight | 25% | 4% | 6% | 3% | 6% |
| Slight | 21% | 18% | 12% | 7% | 13% |
| Enhanced | 20% | 31% | 36% | 29% | 28% |
| Moderate | 14-24% | 20% | 27% | 24% | 28% |
| High | 9-16% | 27% | 20% | 37% | 25% |
| Days with a tornado | 64-70% | 92% | 93% | 92% | 89% |
| Days with a tornado rated EF2+ | 31-38% | 54% | 59% | 67% | 52% |
| Days with 58 mph / 75 mph wind | 55% / 4% | 80% / 1% | 76% / 2% | 87% / 3% | 74% / 3% |
| Storms per day, median | 50 | 98 | 97 | 112 | 98 |

The floor is met without touching the atmosphere. The ceiling is not: High days are 20-37%.
From the 0-0.9 run, by the support the region was given:

| Support | Days | Slight or more | Moderate or more | High | Storms, median |
|---|---|---|---|---|---|
| 0-0.15 | 32 | 91% | 47% | 9% | 80 |
| 0.15-0.30 | 42 | 98% | 57% | 24% | 102 |
| 0.30-0.45 | 28 | 93% | 39% | 25% | 93 |
| 0.45-0.60 | 12 | 92% | 75% | 58% | 131 |
| 0.60+ | 6 | 100% | 67% | 50% | 113 |

Support does order the High days, but even the weakest support gives a Moderate day about
half the time and 80 storms. A steered region spends most of its time in warm sectors and
is seldom swept by a cold front, so the air stays primed and storm numbers double. The
wanted support alone will not shape the top end.

**Three attempts at the top end (2026-10-12, 90 days each, steered).** Each one trades the
floor for the ceiling; none makes the days more alike.

| | Default | Gulf moisture 15 | Gulf moisture 14.3 | Fronts let through (wantedLow -0.2) | More often (-0.45) |
|---|---|---|---|---|---|
| Below Slight | 6% | 16% | 24% | 17% | 22% |
| Slight | 12% | 21% | 30% | 16% | 24% |
| Enhanced | 36% | 38% | 33% | 23% | 29% |
| Moderate | 27% | 12% | 9% | 29% | 13% |
| High | 20% | 13% | 4% | 14% | 11% |
| Days with a tornado | 93% | 76% | 66% | 74% | 71% |

The support score is now signed (below 0 = northerly low-level flow behind a trough), so a
wanted value below 0 lets a cold front sweep the region; the default range (0.1 to 0.45)
does not ask for that. Nothing else from these runs was adopted.

The spread of outcomes is in the storms, not in the large-scale setting: with the tornado
rate and low-level shear deliberately above real values, the real-world category
thresholds are passed often. Shaping the top end is a matter for how the categories are
defined for this world (stage 6), not for the atmosphere.

### Clean-up and player check (2026-10-12)

- Removed from the storm layer, with an identical behaviour fingerprint before and after (72
  hours, 37 storms, 6 tornadoes): the convective-organization clusters, the track
  "intelligence" and its shadow kernel, the outflow-ring list, the boundary interaction that
  always returned zero, and fields nothing read. Three modules and one test moved to
  `weatherworld-trimmed-2026-10-09/phase7-inert-storm-code`.
- The old documentation moved to `phase7-old-docs`; `README.md`, `docs/ARCHITECTURE.md` and
  `docs/STATUS.md` written new.
- Left in place, for a decision: the Day 1-3 pages and the tile and outlook routes behind
  them, which only show a notice.
- `scripts/player-report.mjs` measures what a player finds; results are in `STATUS.md`.

### Storm update, stage 1: budgets (2026-10-12)

Storm strength, organization and life-cycle are no longer weighted scores and threshold
labels. `js/storms/StormBudgets.js`: a storm carries an updraught (m/s), its rain (0-1) and its
cold pool (0-1).

- The updraught heads for what the inflow supports (parcel theory less entrainment and
  inhibition), less the weight of rain, undercutting by its own outflow, and spoiled inflow.
- Rain follows the updraught by about 25 minutes. Shear of 15 to 45 kt carries it clear of
  the updraught; below that it falls back through it.
- The cold pool follows the rain, stronger in dry air. Where it outruns the low-level shear
  it cuts the inflow off. A rotating updraught resists 60% of that; a line resists it until
  the cold pool is well over the shear.
- A storm is over when its updraught falls below 4 m/s. The old rule that no storm could
  end before 1.7 hours is gone.
- Strength is the updraught over 50 m/s; hail takes the updraught directly (reference
  raised from 55 to 62 m/s); gusts scale with the rain now falling, so a collapsing storm's
  strongest gust comes as its core descends.
- The phase name is a description of the budgets' trend; rotation no longer reads it.

| 90 days, steered | Before | After |
|---|---|---|
| Storm lifetime in under 20 kt of shear / 30-55 kt (5 days, one seed) | 5.9 h / 3.5-4.4 h | 1.7 h / 3.8-4.3 h |
| Peak strength, median (90th) | about 0.55 (0.70) | 0.85 (1.00) |
| Quiet days | 3-6% | 4% |
| Slight / Enhanced / Moderate / High | 12 / 36 / 27 / 20% | 10 / 20 / 43 / 20% |
| Days with a tornado | 88-93% | 83-87% |
| Days with 58 mph / 75 mph wind | 76% / 2% | 93% / 36% |
| Days with 1 in / 2 in hail | 92% / 41% | 94% / 80% |
| Largest hail of the day, median (90th) | 1.9 in (2.2) | 2.9 in (4.2) |
| Strongest gust of the day, median (90th) | 63 mph (71) | 73 mph (83) |
| Storms per day, median | about 100 | 93 |
| Tornado time on the ground, median (90th) | 4 min (25) | 4 min (24) |

Open after stage 1: hail is too large (the day's largest stone 2.9 in at the median; raising
the reference to about 68 m/s would bring it near 2.3); ordinary storms in weak shear last
1.7 hours where real ones last under an hour; no left-moving splits; tornado duration
untouched (stage 2). Test: `tests/storm-budgets.mjs`.

### Storm update, stage 2: rotation and the tornado (2026-10-12)

`js/storms/StormRotation.js`, and `TornadoEngine.js` rewritten around it.

- **Mid-level rotation**: the updraught x (shear through the depth and helicity of the
  inflow) x how clear the updraught is of its rain, less along a line. Replaces the weighted
  score.
- **Low-level rotation**: the mid-level rotation x helicity near the ground x a low cloud
  base x outflow that does not outrun the storm. None for a storm fed from above the ground.
- **Tornado**: forms at a rate rising with low-level rotation (none below 0.08, one every 20
  minutes at 0.5), so it is seen coming. It lasts until the storm's outflow wraps around it:
  the occlusion takes up to 1.5 hours under strong rotation and balanced outflow, minutes
  under weak rotation or outflow that outruns the shear. Then the occlusion clears and the
  storm can build another. Its wind follows the storm's low-level rotation, with one draw
  per tornado for what cannot be resolved.
- Removed: the tornado parameter as the cause of tornadoes (kept as a map quantity), the
  drawn lifetime, the sine-wave "cyclic" phase.
- Hail reference raised to 68 m/s. The server publishes each storm's updraught, rain,
  low-level rotation and occlusion.
- Tests: `tests/storm-rotation.mjs` replaces three tests of the old tornado code (moved to
  `phase8-old-tornado-tests`).

| 90 days, steered | Before the storm update | After stage 1 | After stage 2 |
|---|---|---|---|
| Tornado time on the ground, median (90th, longest) | 4 (25, 62) min | 4 (24, 66) | 15 (30, 60) |
| Tornadoes down 10 minutes or more | 25% | 28% | 99% |
| Tornado path, median (90th) | 1.3 (12) miles | 1.5 (13) | 6.5 (19) |
| Days with a tornado | 88-93% | 83-87% | 80-82% |
| Days with EF2+ winds / EF4+ winds | 64% / 34% | 64% / 21% | 58% / 21% |
| Tornadoes per day, median (90th) | 7 (35) | 5 (22) | 7 (36) |
| Minutes of the day with a tornado down, median | 76 | 66 | 105 |
| By peak wind, EF0 to EF4+ | 41 / 32 / 14 / 8 / 5% | 44 / 27 / 16 / 8 / 4% | 45 / 32 / 14 / 5 / 4% |
| Starting between 6 pm and midnight local | 39% | 39% | 56% |
| Largest hail of the day, median | 1.9 in | 2.9 in | 2.3 in |
| Days with 75 mph wind | 2% | 36% | 37% |
| Quiet days | 3-6% | 4% | 3% |
| Slight / Enhanced / Moderate / High | 12 / 36 / 27 / 20% | 10 / 20 / 43 / 20% | 12 / 21 / 30 / 29% |
| A tornado within 60 miles of a place, lasting 10 min or more | 13% of days | 10% | 25% |

The first setting (no tornado below low-level rotation 0.12) gave 71% tornado days; the
adopted one (0.08, and a rate that rises in proportion) gives 80-82%. Open: tornado days are
below the 90% before the update; no tornado is shorter than 10 minutes (the storm step is 5
minutes and a tornado stays down through the step it formed in); days with none have long
gaps (12 gaps of a day or more in 90 days).

### Storm update, stages 3 and 4: shape and interactions (2026-10-12)

**Stage 3, shape.** `js/storms/StormGeometry.js` gives each storm a geometry from its state
and the wind through its depth: updraught (place, width, speed, base, top), wall cloud (the
lowering that low-level rotation makes), rain and hail cores (carried downwind by the wind
aloft relative to the storm), rear flank wrap, gust front, anvil, line (share, length, bow)
and tornado. The server publishes it with each storm, for the Roblox object.
`StormStructureEngine.js` was rewritten to build the radar picture from that state and
geometry with continuous shares of "rotating" and "line"; it no longer reads the storm's
type name or phase, and neither do the echo model or the inner fields.

**Stage 4, interactions.**

- **Outflow boundaries.** Where a storm's inflow crosses the edge of older rain-cooled air
  (the contrast in the regional layer's cold pools 25-40 km upstream of it), helicity is
  added near the ground: up to 150 at a contrast of 6 K.
- **Bowing lines.** Rear inflow (0-1) builds behind a line with a deep cold pool and heavy
  rain; the gust gains 30% of the 500 mb wind times that, and the radar line bows with it.
- **Splits.** A rotating storm on its own in 35 kt or more of shear splits once. The
  left-mover takes a share that falls from all to none as helicity rises from 80 to 250, so
  there is none on the usual tornado day. It rotates aloft, not near the ground. A bug was
  fixed: the two members used to merge back in the same step, so no left-mover ever lived.

Another agent moved the hail and gust formulas into `StormHazards.js` during this work (for
a sounding hazard outlook that runs a lone storm through these same modules); the rear
inflow was added there. That lone storm does not yet step the rear inflow.

| 90 days, steered | After stage 2 | After stages 3 and 4 |
|---|---|---|
| Days with a tornado | 80-82% | 87-89% |
| Days with EF2+ winds / EF4+ winds | 58% / 21% | 53-59% / 26% |
| Tornadoes per day, median (90th) | 7 (36) | 7-8 (40) |
| Tornado time on the ground, median (90th) | 15 (30) min | 15 (30) min |
| Days with 75 mph wind | 37% | 69% |
| Strongest gust of the day, median (90th) | 73 (83) mph | 83 (96) mph |
| Largest hail of the day, median | 2.3 in | 2.4 in |
| Storms per day, median | 92 | 111 |
| Left-moving splits, share of rotating storms (8 days) | 0% | 6% |
| Quiet days | 3% | 4% |
| Slight / Enhanced / Moderate / High | 12 / 21 / 30 / 29% | 9 / 18 / 38 / 29% |
| A 10-minute tornado within 60 miles of a place | 25% of days | 26% |

The first setting of the rear-inflow share (45%) gave 75 mph wind on 71% of days and a
strongest gust of 86 mph at the median; 30% was adopted and changed little (69%, 83 mph),
so most of the gain is not sensitive to that share. Tests: `tests/storm-shape-and-interactions.mjs`.

### Risk categories, the quiet worlds and an even map (2026-10-12)

**Eight worlds, not three.** Fitting the categories on eight seeds showed tornado days of 74%
where three seeds had given 87-89%: seeds 5 and 8 had a tornado on about half their days.
Headline figures are from eight seeds from here on.

**The quiet worlds.** Not a matter of latitude: the large-scale model offers them the same
support as the others at the region's latitude. The steering was asking for little support
(0.1-0.45, set to hold down High days before the categories were this world's own). Asking
for 0.35-0.8 took seed 5 from 63% to 83% tornado days and seed 8 from 47% to 60%; adopted.
Seed 8 is still weak: the steering often cannot reach the support it asks for there.

**An even map.** Severe weather by tenth of the map, west to east, was 0, 2, 7, 19, 38, 48,
57, 56, 54, 51% of days: the western 40% is the dry side of the dryline. Tried and dropped:
confining the high ground nearer the western edge (`terrainShape` 2.5 and 4: little change,
less activity) and a wider map (the geography stretched with it). Adopted: the map's place
along the geography is now a setting (`geographyColumns` 50, `geographyOffset` 15), so the
playable 500 miles starts at the foot of the high ground and flat plains continue east. With
offset 0 the storm behaviour is identical to before. Result on eight seeds: 14, 47, 65, 72,
71, 68, 64, 61, 58, 52%; west half 54% against east 61%; tornadoes 14% against 14%. The
dryline is now seldom on the map; storms that form on it arrive from the west.

**This world's risk categories.** `scripts/risk-climate.mjs`: each category's thresholds
sit at one common rarity of every hazard's own climate (the day's highest practically
perfect chance), found so that the share of days reaching it is the share wanted. Hail does
not make High; 58 mph wind does not go past Enhanced (it is close to certain on most days).
Fitted on 320 days after the two changes above; on 160 other days the mix is below-Slight
5, Slight 28, Enhanced 41, Moderate 21, High 5. Wired into `js/verification/truth.js`
(`chance`, `worldRisk`) and the activity report. Tests: `tests/world-risk-categories.mjs`.

| Eight seeds | Before | After |
|---|---|---|
| Days with a tornado | 74% | 85-88% |
| Days with no severe weather | 6-7% | 4-5% |
| Tornadoes per day, median (90th) | about 5 (30) | 10 (60) |
| Storms per day, median | about 100 | 235 |
| A tornado within 60 miles of a place | 26% of days | 37% |
| A severe storm within 10 miles of a place | 19% of days | 35% |

### Even over many days, different from day to day (2026-10-12)

The fixed map in the moist air made every day alike: severe weather over 68% of the map on a
median day, and two thirds of it Enhanced by the real-world rules. The user wanted storms
and tornadoes even over many days, with each day its own.

- **Measured** (`scripts/spatial-report.mjs`, section 6): the share of the map covered on a
  day, the overlap of one day's footprint with the next, how far the footprint's centre
  ranges.
- **Tried and removed**: steering the large-scale system to a chosen part of the map. It
  cut the daily coverage to 44% but did not move where the weather falls, and tornado days
  fell from 85% to 76%. The systems are wider than the map; what fixes the storm band in
  place is the geography.
- **Adopted: the map roams along the geography.** `geographyOffset` is now a state of the
  regional layer; each day the steering sends the map 5 to 15 cells one way or the other
  between -6 and 30 (a walk turned back at the ends, so every place comes up equally), and
  it drifts there at no more than 0.7 cells an hour. The air and the storms stay on the map;
  the ground under it changes.
- A world restored from its saved state diverged once the map could move (the slope update
  held the world it was built with); fixed, and the restore test covers it.

Eight seeds, 240 days: tornadoes by tenth of the map 1, 6, 12, 15, 18, 18, 16, 12, 10, 7%
(fixed in the moist air: 0, 6, 16, 23, 26, 23, 18, 12, 9, 6); severe weather on 51% of the
map on a median day (68%); overlap with the day before 0.44 against 0.33 for unrelated days
(0.57 against 0.38); tornado days 85%, no severe weather on 5%. Risk categories refitted:
Enhanced at tornado 36 / EF2+ 7 / hail 70 / 2 in 15 / wind 92 / 75 mph 49; Moderate 66 / 29 /
91 / 43 / - / 90; High 84 / 51 / - / - / - / 97.

Left: the western and southern edge strips (storms cannot arrive from outside the map; a
simulated strip beyond the playable area would cure it, written up in `STATUS.md` under
"Later, if wanted" and not done); severe weather as a whole still favours the east half (37%
against 57%).

### The Day 1 outlook (2026-10-12)

Asked for: a discussion, risk categories and hatching, like the real ones.

- `js/forecast/DayOneOutlook.js`: members (the world copied and run ahead, each with its own
  storm seed), their average practically perfect chance per hazard, this world's categories,
  hatching from the significant chances (10% and 30%), and a discussion in the real layout
  (headline, summary, synopsis, tornado, hail, wind, uncertainty) written from those numbers.
- `server/OutlookRuntime.js` and `server/outlookMember.js`: issued at start-up and at 12Z in
  separate processes, about 25 seconds for eight members; routes `/api/outlooks/day1` and
  `/api/outlooks/status`.
- `day1.html` and `js/pages/outlookPage.js` replace the old Day 1 page (kept in
  `phase9-old-day1-page`). Days 2 and 3 keep the old placeholder.
- **A bug found and fixed**: members run one after another in one process from the same
  serialized world did not start from the same state, because arrays read out of the same
  bytes can share memory and a member advances them in place. Each member now gets its own
  copy (`stateFromBytes`); the server's members always read their own. The first
  verification run was affected and was thrown away.
- `scripts/outlook-verify.mjs` (36 outlooks): highest category right on 72% of days and
  within one on all; too low on 25%, too high on 3%; tornado chances reliable (15-30% ->
  26%, 30-45% -> 41%, 45-60% -> 64%, 60%+ -> 87%); the day's tornado count inside the
  forecast range on 83% of days. Forecast mix Slight 42, Enhanced 47, Moderate 11, High 0
  against verified 33, 47, 14, 6.
- Tests: `tests/day-one-outlook.mjs`.

### The outlook redone to the Storm Prediction Center's rules (2026-10-13)

The user: the contours did not match what the real outlooks do; a chance like 26% should
never appear. Researched from the service change notice (SCN 26-11) and the centre's pages:
since March 2026 chances are drawn only at fixed levels (tornado 2, 5, 10, 15, 30, 45, 60%;
wind 5, 15, 30, 45, 60, 75, 90%; hail 5, 15, 30, 45, 60%), the single "significant" hatch is
replaced by conditional intensity groups (CIG1-3; two for hail) each with its own hatch, and
the category is read from a table of contour level against group.

- `worldRiskCategories.js` rewritten as such tables, with this world's own entries (set on
  320 days: below Slight 7, Slight 28, Enhanced 40, Moderate 20, High 5; the real table would
  give 44% High). `risk-climate.mjs` rewritten to record what each day reaches and to print
  the mix a table gives.
- `truth.js`: wind tiers moved to the real 75, 85 and 96 mph; unrounded chances for every
  tier; `worldRisk` from the contour level and the observed group.
- `DayOneOutlook.js`: contour levels, intensity groups (the highest tier with a 10% chance,
  held to what the contour allows), categories from the tables, and a discussion that
  describes hazards in words and cites only contour levels and groups.
- `outlookPage.js`: bands at the contour levels in the real colours, the three hatch styles,
  no figures on the map.
- Verification (30 outlooks, first version of the table): places inside the tornado contours
  had one within 25 miles 2, 6, 12, 25, 42, 64, 87% of the time (2% to 60% contours); wind 3,
  16, 44, 77, 89, 97, 100%; hail 5, 16, 46, 70, 86%.
- High days in the 320-day record (day N is the Nth 12Z-12Z day of a fresh world): seed 1:
  5; seed 2: 8, 9, 17, 25, 26; seed 3: 12, 36, 38; seed 4: 39; seed 5: 3; seed 6: 38; seed
  7: 19, 20, 33; seed 8: 8, 37.
- Three documentation files (README, STATUS, ARCHITECTURE) had lost the first outlook write-up
  to a concurrent edit; it was put back here in its present form.

### Outlines for the outlook, and the radius question (2026-10-13)

The user asked for three things and approved the first two steps: the real category table
with a smaller radius (measure first), contours as shapes like the live analysis page's and
not images, and a cheaper outlook (not started).

- `js/forecast/contourShapes.js` (new): marching squares into closed rings, closed along the
  map edge, corners rounded; `outlookShapes` in `DayOneOutlook.js` traces every category,
  contour level and intensity group. `publicOutlook` sends those and no longer sends the
  chances at all. `outlookPage.js` fills, outlines, labels and hatches the shapes; nothing is
  painted pixel by pixel. Test: `tests/contour-shapes.mjs`.
- `neighbourhoodChance` in `truth.js` (new): the chance of a report within any radius.
  `scripts/risk-radius.mjs` (new) records, for 320 days and each radius, what the real table
  gives. Result: High 43% at 25 miles, 38% at 15, 37% at 10. Wind alone makes those High
  days; tornadoes alone would give 23%, 14%, 8%. With the intensity group taken as the tier
  that 30% of the reports in a contour reach, High is 8%, 5%, 4%, but days below Slight rise
  from 8% to 12% to 16% as the radius shrinks. Left for the user to decide.
- `OutlookRuntime`: the copy of the world could be left behind on Windows (removal failed
  while the file was still held); removal is now retried.

## What is kept and what is replaced

Kept: soundings, the storm, tornado, hail and wind engines, the storm engine's forcing and
inflow diagnoses, radar, tiles, the server and its saved state, and the rules that define
severe reports and outlook categories (`js/verification/truth.js`,
`js/forecast/spcOutlookRules.js`).

Retired on 2026-10-11 (moved to `weatherworld-trimmed-2026-10-09/phase6-old-engine`, 64
files): the scenario generator and its narratives, the drawn synoptic pattern, the
rule-based motion of lows and fronts, the old evolution step and its closures, the old
boundary and coupling engines, the terrain and region framework, the outlook ensemble and its
calibration, the old audits, and the 19 tests that needed any of them. Three-day systems
went with them: the weather is continuous.

What was lost with that and has to come back:

- **Day 1-3 outlooks** (stage 6). The outlook pages show a notice meanwhile.
- **Named regions** on the maps (they came from the old terrain framework).
- **Tests of whole storms over a day** (`storm-engine`, `storm-character`, `radar-simulator`
  and others ran on old scenarios). The unit tests of the storm functions remain, and
  `tests/atmosphere-world.mjs` covers storms on the new atmosphere, but the check that a
  storm's name never drives its physics should be rewritten on the new world.

## Stages and acceptance checks

1. **Outer model prototype**, standalone. Accept when, over several simulated weeks:
   systems recur at a usable interval near the map window, move at realistic speeds
   (roughly 500-1,000 miles a day), surface pressure swings are about 10-25 hPa, upper winds
   at the window are about 35-60 kt in the mean, and the run is stable and fast (a simulated
   day well under a second).
2. **Regional layer.** Accept against the physics inspection: wind turning with height,
   warmest hour 21-23Z, a night-time low-level jet, realistic soundings in the warm sector.
3. **Fronts and drylines** diagnosed from the fields; labels within about 15 miles of the
   gradient and wind shift.
4. **Storms**, then **hazards**, against the reference numbers.
5. **Climate tuning**, against the activity target above (no seeds or regimes; see "Climate
   tuning").
6. **Outlooks and products**, recalibrated; then the Roblox region feed.

## Stage 1 result

`js/atmosphere/QuasiGeostrophicModel.js`, run by `node scripts/qg-prototype.mjs [days]`
(add `--png <dir>` for maps, `key=value` to change a setting). One seed, 160 simulated
days, sampled mid-domain:

| Check | Result | Target |
|---|---|---|
| Speed | under 1 s per simulated day | well under 1 s |
| Trough passages | median every 1.8 days (range about 0.3-4.4) | real 3-6; aim 1.5-2 |
| System speed | about 1,200 miles a day | 500-1,000 |
| Surface pressure swing (5th-95th percentile) | 30 hPa | 10-25 |
| Mid-level wind, mean / 90th percentile | 39 / 65 kt | 35-60 mean |
| Upper-level wind, mean / 90th percentile | 52 / 91 kt | - |
| Lower-layer wind, mean / 90th percentile | 30 / 47 kt | - |

What was tried and why this form was kept:

- **A channel with walls** (first version) produced good systems but fixed the mean wind of
  both layers, leaving a steady 15-25 mph westerly at the ground that flooded the map with
  dry air. Without quiet zones at the walls its jets also migrated to the walls.
- **The doubly periodic form** is very sensitive to the difference between the two layers'
  mean winds. At 12.5 m/s it settles with realistic systems. At 14 m/s and above the
  pressure swings reach 50-80 hPa, and at 17.5 m/s it never settles. Surface drag that
  increases with wind speed is what makes it settle at all.
- **Adding the same wind to both layers** changes nothing about the systems except how fast
  they travel. This is how the flow aloft was strengthened (upper 23, lower 10.5 m/s) after
  stage 2 showed that the quiet days were all weak-flow days.
- **Smaller systems** (deformation radius 350 km instead of 550, upper 22.5 and lower
  13 m/s) were adopted in stage 4. With the larger radius the lows were deep but broad, so
  their winds were slack (lower layer 19 kt in the mean) and storms had little low-level
  shear to work with. Smaller systems carry stronger winds for the same pressure change and
  arrive every 1.8 days instead of 2.6, which is the tempo wanted, with no separate tempo
  factor. They also move faster than the target (about 1,200 miles a day).
- **A domain half the size** holds a single wave, which keeps strengthening whatever the
  drag. The default domain size is a requirement, not a convenience.
- The time step is 300 s.

Open:

- **Tempo.** To reach a system every 1.5-2 days the large-scale clock can run faster than the
  daily cycle (the `tempo` setting of the regional layer). Not needed so far: see the quiet-day
  count in stage 2.

## Stage 2 result

The table below was measured before the outer model's systems were tightened in stage 4
(see "Stage 1 result"). Re-measured afterwards (three seeds, 12 days): 850 mb wind 30-38 kt at
night and 14-17 kt in the afternoon (90th percentile 23-25), 500 mb 35-41 kt, surface-500 mb
shear 41-43 kt, wind turning 26-28 degrees to 850 mb and 38-51 from there to 500 mb, CAPE
3,000-3,300 J/kg, inhibition 25-54, low-level helicity about 45 in the afternoon rising to
145-225 by 03Z, dryline 17-22 F across 20 miles, and 0-2 quiet days in 12. The fronts table
of stage 3 has not been re-measured.

`js/atmosphere/RegionalAtmosphere.js`, run by
`node scripts/regional-prototype.mjs [days] [--seed n] [--section] [--png <dir>]`
(`key=value` for regional settings, `qg.key=value` for the outer model; `--section` prints
the time-mean west-to-east cross-section). It fills the same cells the soundings and storms
read. It is not connected to the storm engine yet (stage 4). Test:
`tests/regional-atmosphere.mjs`.

What it contains, in the order the air meets it:

- **Terrain** rising from 300 m in the east to 1,500 m in the west.
- **Mountains west of the map** block most of the mean westerly below their crest (700 mb),
  so the low-level flow is free to be southerly while the flow aloft stays westerly.
- **Air masses** carried by the wind: low-level temperature, the moisture of the moist
  layer (Gulf air enters from the south and south-east), and hot, dry plateau air at 700 mb
  (the cap). Cold air masses are sharpest near the ground; warm patterns show aloft, over
  the moist air, which strengthens the cap instead of heating the surface.
- **Thermal low.** The pressure near the ground follows hydrostatically from the heat of
  the high ground and the heating of the day (smoothed over about 200 km), and the balanced
  wind follows from that pressure. It is not a drawn shape. Only heat the outer model does
  not hold is counted.
- **Lee trough** deepening with the westerly flow across the high ground (the one part that
  is set rather than derived, because the outer model has no mountains).
- **Boundary layer** with a daily heating cycle. Its depth belongs to the air: shallow in
  the moist layer, deep in dry air over high ground. Where it grows deeper than the moist
  layer it mixes dry air down: the dryline. Dry ground heats harder, which sharpens it.
- **Night-time jet**: the daytime wind deficit below 850 mb is released at sunset and swings
  around the balanced wind.
- **850 mb** takes the mixed layer's temperature and moisture when it is inside it, and the
  cap's base has the dry-adiabatic warmth of a layer mixed down from 700 mb.

Three seeds, 20 simulated days each, measured in the moist air (dewpoint 58 F or more):

| Check | Seeds 1 / 2 / 3 | Target |
|---|---|---|
| Warmest hour / coolest hour | 23Z / 12-13Z | 21-23Z / 11-12Z |
| Day-night temperature range | 20 / 18 / 20 F | 18-28 |
| Instability highest | 23Z | 21-00Z |
| Inhibition lowest / highest | 22-23Z / 12-13Z | late afternoon / near sunrise |
| 850 mb wind strongest | 07-08Z, 24-28 kt | 06-09Z, 30-45 kt |
| 850 mb wind, afternoon median (90th percentile) | 11-12 kt (15-20) | 20-40 on storm days |
| Wind turning, surface to 850 mb | 24 / 30 / 30 degrees | 20-50 |
| Wind turning, 850 to 500 mb | 80 / 71 / 73 degrees | 20-50 |
| 500 mb wind, afternoon median | 32 / 38 / 37 kt | 35-55 |
| Surface-500 mb shear, median (90th) | 34 / 45 / 41 kt (46-51) | 35-60 |
| Afternoon instability (CAPE), median | 3,260 / 4,090 / 3,850 J/kg | 1,500-3,500 |
| Afternoon inhibition, median | 32 / 26 / 31 J/kg | 25-100 |
| Cloud base above ground | 1,350 / 1,390 / 1,250 m | 800-1,500 |
| 700 mb temperature (cap) | 11.5 / 11.1 / 11.4 C | 8-12 |
| Low-level helicity, afternoon median (90th; best day) | about 40 (90; 146-291) | 100-300 on storm days |
| Low-level helicity through the evening | 62-99 at 00Z, 91-149 at 03Z, 137-202 at 06Z | rising after sunset |
| Mixed-layer depth, east / west | 1,250-1,360 / 2,250-2,580 m | 1,000-2,000 / 2,500-4,000 |
| Dryline: dewpoint change across 20 miles | 20 / 21 / 22 F | 15-30 |
| Dryline position (column of 50, west = 0) | 13 / 19 / 19 | western third |
| Moist air, share of the map | 51 / 46 / 44% | - |
| Days with under 5% of the map supportive | 3 / 2 / 1 of 20 | about 1 in 20 |

"Supportive" means CAPE of 1,500 J/kg or more with 30 kt or more of shear. It is a stand-in
until storms run on this atmosphere (stage 4); weaker shear still produces hail and wind.

What the runs showed:

- **Instability is never missing.** On every day 25-90% of the map has CAPE of 1,500 or more.
  The quiet days are all days with weak flow aloft (500 mb at 10-20 kt under a ridge).
  Strengthening the mean flow aloft cut them from 5-7 in 20 to 1-3 in 20.
- **The mean low-level picture matches the real warm season**: pressure 9 hPa lower in the
  west than the east, south-easterly surface wind, a southerly 850 mb wind of 13 kt by day
  and 26 kt at night along the axis east of the dryline.

Still short:

- **Low-level wind on the active days.** The 850 mb wind and the helicity are right on
  average and by night, but the strongest afternoons (15-20 kt, helicity about 90) are about
  half of a real storm day. The outer model's lows are broad, so the pressure gradient ahead
  of a trough does not tighten enough. To be judged again once storms run on it (stage 4),
  and a candidate for the severity setting (stage 5).
- Instability is at the high end (median 3,300-4,100 J/kg).
- The mixed layer over the high ground is 100-250 m shallower than the target.
- The step with soundings on all 2,500 cells takes several seconds per simulated day. The
  storm engine only needs soundings where it samples; to settle in stage 4.

## Stage 3 result

`js/atmosphere/BoundaryAnalysis.js` (`analyseBoundaries(world)`), run by
`node scripts/boundary-prototype.mjs [days] [--seed n] [--png <dir>]` (`key=value` for an
analysis setting, `regional.key=value` for the regional layer). Test:
`tests/boundary-analysis.mjs`. It works on any world's cells and returns lines in the same
form the map overlays already take (`type`, `pointsKm`), so it can replace the drawn fronts
when the new atmosphere is connected (stage 4).

How a line is found:

- **Front**: crest of the gradient of the air-mass temperature (potential temperature with
  the standing warmth of the high ground and the day's heating taken out, so neither the
  terrain nor the time of day is mistaken for a front). The line is placed on the warm edge
  of the zone, where analysts draw it.
- **Kind of front**: from the wind in the cold air. Advancing on the warm air faster than
  2 m/s is a cold front, retreating faster than that a warm front, otherwise stationary. The
  kind can change along one line.
- **Dryline**: crest of the moisture gradient where no front runs along it and the dry side
  is not the cold side.
- **Not a front**: moist air is usually the cooler air mass, so a dryline has a temperature
  contrast too. A contrast whose cool side is the moist side of a sharp moisture change is
  the dryline. (Found on the first surface map, where a stretch of dryline was labelled a
  cold front; the table below is from after the fix.)
- Each line carries the side its symbols go on, from its own gradient.
- Lines shorter than 160 km, and the outer three cells of the map, are left out.

The first run found drylines but almost no fronts: the atmosphere of stage 2 had none to
find (sharpest contrast 3 K per 100 km, a front in 27% of analyses). The outer model's air
masses are broad and nothing in the regional layer sharpened them. Two changes to the
regional layer fixed that:

- **Cold air pushes under warm air** like a density current (`coldPushFactor`). The colder
  the air than the warmest air within 100 miles, the faster it pushes, so an advancing cold
  edge catches up with itself and sharpens, and a retreating one spreads out. This also gives
  the wind shift.
- **Cold air masses are sharper near the ground** (`temperatureShare.lowCold` 1.4 to 1.8).

Three seeds, 16 simulated days each, analysed every 3 hours:

| Check | Seeds 1 / 2 / 3 | Target |
|---|---|---|
| Sharpest contrast on the map, median (largest) | 5.0 / 7.1 / 6.8 K per 100 km (14-23) | real fronts 5-15 |
| Analyses with at least one front | 44 / 80 / 69% | - |
| Fronts per analysis: cold / stationary / warm | 0.5-1.3 / 0.2-0.6 / 0.03 | - |
| Front length, median | 240-280 km | - |
| Wind turn across a cold front | 55 / 58 / 64 degrees | 45-120 |
| Surface temperature change across a cold front (60 miles) | about 4 F | 10-25 |
| Cold air advancing behind a cold front | 10 mph | 15-35 |
| Analyses with a dryline (at 21Z) | 87-95% (87-100%) | most afternoons |
| Dewpoint change across the dryline (60 miles) | 29-31 F | 20-40 |
| Dryline position by day / by night (column of 50) | 16-17 / 12-15 | further east by day |
| Front position against the one 3 hours earlier, median | 24-30 km | continuous |

The label check of the plan ("within about 15 miles of the gradient and wind shift") holds
by construction for the gradient: the line is the gradient's crest, moved to its warm edge.
The test confirms this on made-up fields with a known answer.

Still short:

- **Fronts are weaker than real ones at the ground**: about 4 F across 60 miles and 10 mph
  behind them. The air-mass contrast is there (5-7 K per 100 km at the sharpest point); the
  zone is three or four cells wide, which is as sharp as the 10-mile grid and its transport
  scheme allow.
- **Warm fronts almost never appear.** A retreating cold edge spreads out below the
  threshold. Real warm fronts on the Plains are diffuse too, but not this rare.
- **The wind barely turns across the dryline** (16-19 degrees against 45-120).
- **Not done here**: outflow boundaries (they need storms, stage 4), following one front
  from analysis to analysis under a stable name, and the stationary-front symbol on the page
  (the page draws cold, warm and dryline symbols only).

Stage 2 checks were re-run with these changes and still hold (instability came down into
range: median CAPE 3,000-3,800 J/kg).

## Stage 4 so far

Storms run on the new atmosphere. `js/world/AtmosphereWorld.js` owns the outer model, the
regional layer and the boundary analysis, and after every half-hour atmosphere step works
out what the storm engine reads from a cell, from the fields alone:

- soundings and the indices on them;
- lift where the surface winds converge;
- ascent where 500 mb heights fall (and sinking where they rise), which also cools or warms
  the cap;
- upslope flow from the slope of the terrain;
- distance to, and kind of, the nearest analysed front or dryline;
- the storm engine's own forcing and inflow diagnoses (`diagnoseForcing`,
  `updateMesoscaleFields`), which are diagnoses of the fields and are reused as they are;
- the warming aloft and drying of the inflow layer that storms leave behind, kept and faded
  over three hours (the regional layer rewrites its cells every step).

**Cold pools** are part of the atmosphere's own state (`RegionalAtmosphere.coldPool`). Each
storm puts its rain-cooled air in behind itself, as deep as its own cold-pool strength says.
From then on the air is carried by the wind, spreads under the warmer air around it by the
same density-current rule that sharpens cold fronts, raises the pressure under it, and warms
back up over 3 hours by day and 8 at night. Its edge is found by the boundary analysis as
an **outflow boundary** and drawn on the surface map as a dashed line. Storms form along it
because the surface winds converge there; nothing is added for it.

The storm, tornado, hail and wind engines themselves are unchanged. Run it with
`node scripts/storm-prototype.mjs [days] [--seed n]`; test: `tests/atmosphere-world.mjs`.
The surface map now shows these storms.

Two seeds, ten simulated days each, with cold pools:

| Check | Seed 1 / seed 2 | Reference |
|---|---|---|
| Days with a storm | 10 / 10 of 10 | - |
| Days with a severe storm (1 in hail, 58 mph, or a tornado) | 5 / 10 of 10 | about 19 in 20 |
| Days with a tornado / an EF2 or stronger | 4 / 3 and 1 / 1 of 10 | - |
| Days with 2 in hail / 75 mph wind | 0 / 0 and 2 / 3 of 10 | - |
| Storms per day, median (most) | 18 / 53 (133 / 108) | - |
| Initiation peak | 19-23Z, fewer overnight | 20-00Z, secondary overnight |
| Storm lifetime, median | 2.0 / 2.5 h | ordinary 0.5-1, supercell 2-4 |
| Forward speed, median | 46 / 34 mph | 25-45 |
| Largest hail | 1.7 / 1.6 in | - |
| Strongest gust | 96 / 94 mph | - |
| Largest source of lift where storms formed | surface convergence 51-59%, large-scale ascent 32-35%, heating 5-10%, storm outflow 3-4% | - |
| Storms formed within 40 miles of a front / the dryline / an outflow boundary / no line | 8-16% / 10-11% / 11-16% / 62-67% | - |
| Cold pools in the evening: deepest, median (most) | 5-7 F (8-10 F) | 10-20 F under strong storms |
| Tornado ratings (about 60 tornadoes) | EF0 30%, EF1 60%, EF2 7%, EF3 2% | EF0 64, EF1 26, EF2 7.6, EF3 2.2% |
| Tornado time on ground / path / width, median | 15-20 min / 11-14 miles / 130-140 yards | about 5 min / 1-2 miles / 50-75 yards |

What the first runs showed, and what was done:

- **Storms were weak until the storm engine got its own forcing and inflow diagnoses.**
  Without them every storm stayed below severe.
- **Low-level shear was the limit, as expected.** Tightening the outer model's systems
  (above) took the night-time jet to 30-38 kt, 500 mb to 35-41 kt, surface-500 mb shear to
  41-43 kt, and brought tornadoes (up to EF3) and severe storms on most days.
- **Storms sat under too much cap** (58 J/kg at the median against 11 in the old engine)
  because large-scale lifting did not erode it. It now does.

Open in stage 4:

- **Hail is too small** (nothing above 1.8 in with CAPE over 4,000 and 55 kt of shear).
  The hail, gust and tornado formulas were fitted to the old atmosphere and need refitting
  to this one. The old engine that shared them is retired now, so this is next.
- **Severe days are 5-8 in 10**, short of the target.
- **Tornadoes last too long and travel too far** (20 minutes, 10-15 miles at the median).
- **Rotating storms do not turn right** of the mean wind (0 to -3 degrees against -20 to -30).
- **Two thirds of storms form away from any analysed line.** Surface convergence is the
  largest source of lift for over half of them, so the convergence is there but mostly in
  zones too short or too weak to be drawn as a front or dryline. (An earlier note here said
  85% were started by ascent or heating; that came from ranking the sources without their
  weights and was wrong.)
- **Cold pools are shallower than real ones** (5-10 F against 10-20 F): the storm engine's
  own cold-pool strength rarely passes 0.5.
- Storm size and shape, saving state, moving the outlooks over.

### The live server

`npm start` runs every page on the new atmosphere: `server/WeatherAuthorityRuntime.js` owns
one `AtmosphereWorld` and serves the live page, radar, soundings, tiles and the surface map
from it (test: `tests/atmosphere-authority-runtime.mjs`). Storms move every five simulated
minutes and the atmosphere steps every half hour. Checked in a browser: the live page shows
the analysed fronts, radar shows the storms' echoes and fine lines, the outlook pages show
their notice. (That grid-based live page has since been replaced; see "The live page".)

Its state is saved every simulated hour to `data/cache/atmosphere-state.bin` (about 30 MB)
and resumed on the next start; a resumed world carries on exactly as the original would
have (tested). A fresh start (first run, `WEATHER_SEED=n`, or after the simulation code
changes) spends about a minute letting the large-scale weather develop before the server
answers. `WEATHER_PERSIST=off` keeps nothing on disk.

## The live page: surface observations and mesoanalysis

`index.html` (built 2026-10-11; it replaced the grid-based live page, which is in the
trimmed folder). It works like an operational mesoanalysis page. Nothing on it is drawn as
grid cells.

- **Base**: a fixed, irregular network of about 110 stations in the standard station model
  (temperature, dewpoint, coded sea-level pressure, wind barb); isobars and pressure centres;
  fronts, the dryline and outflow boundaries with their standard symbols; storms as discs
  coloured by what they are producing, with their heading, and a red triangle for a tornado
  on the ground.
- **Overlay**: one of 27 diagnosed fields from a menu, as smooth shading, labelled contours
  or both, with a colour bar. Groups: surface (temperature, dewpoint, cold pools, terrain),
  instability (three kinds of CAPE, inhibition, cloud base, lapse rates, the cap), wind shear
  (deep and low-level shear, helicity), composites (significant tornado parameter, supercell
  composite), forcing (surface and moisture convergence, 500 mb height change, upslope flow,
  where storms can start) and upper air (wind at 850, 700, 500 and 250 mb with barbs, and
  temperature or height as dashed lines). Each field is read straight from the cells
  (`server/mesoanalysisParameters.js`); nothing is computed specially for display.
- **Sounding**: click anywhere for the skew-T, hodograph and indices at that spot.
- **Time**: the server keeps the analysis and all fields of the last 18 simulated hours (one
  frame per atmosphere step, in memory only); the page steps back through them and loops them.
- **Readout**: station, storm or field values under the cursor.
- **World**: move the weather on half an hour, pause the clock, or start a new world.

Server: `server/SurfaceAnalysisRuntime.js` analyses the authority's world and advances
nothing itself. `GET /api/atmosphere/surface[?frame=hour]` returns the base analysis with the
list of frames and parameters; `GET /api/atmosphere/parameter?key=...[&frame=hour]` one field.
`?field=mlcape` and `?sounding=row,column` on the page URL open it with that overlay or
sounding. Tests: `tests/surface-analysis-runtime.mjs`, `tests/static-page-regression-2.25.2.mjs`.

Seen while checking it in a browser, for later stages:

- The front analysis is noisy on some days: several short parallel "cold fronts" in the dry
  air west of the dryline. (Stage 3 re-measure.)
- Instability is very high in the warm sector on some afternoons (over 5,000 J/kg with almost
  no inhibition) when a cold trough aloft passes over warm, moist air. (Climate tuning.)
- Soundings are always for the current time, not for an older frame being viewed.
- The frame history is lost on a restart.

Still to do on the display side: the outlook pages without the grid (with stage 6).

## Known limits and risks

- Quasi-geostrophic dynamics give broad fronts; sharpening must come from the regional
  layer, and a 10-mile grid limits how sharp a dryline can be.
- Wave timing has to be tuned by experiment. One system every 1.5-2 days is the aim.
- A 500-mile map can sit entirely under a ridge. The between-system situations in the table
  are what keep such days from being empty, so they are tested early.
- Storms remain described objects, not a fluid simulation; close-up detail comes from their
  geometry.

## Reference numbers pinned so far

- Tornado ratings: about 64% EF0, 26% EF1, 7.6% EF2, 2.2% EF3, 0.4% EF4, 0.04% EF5 (SPC
  study of 1995-2009 records).
- Supercell motion: about 30 degrees right of the 0-6 km mean wind at 75% of its speed;
  Bunkers deviation 7.5 m/s (observed range 3-16).
- Still to pin: tornado path length, width and duration; sounding climatology.
